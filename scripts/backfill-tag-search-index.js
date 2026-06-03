#!/usr/bin/env node
/**
 * Backfill tag_words, tag_word_sequences, and tags_title_fts for tags missing index data.
 *
 * Usage:
 *   node scripts/backfill-tag-search-index.js
 *   node scripts/backfill-tag-search-index.js --no-fts
 *   node scripts/backfill-tag-search-index.js --batch=5000
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { buildTitleSearchIndexData } = require('../modules/tagTitleIndex');

const DATABASE_PATH = path.join(__dirname, '..', '.cache', 'tag_wiki.db');

function main() {
    const rebuildFts = !process.argv.includes('--no-fts');
    const batchArg = process.argv.find(a => a.startsWith('--batch='));
    const batchSize = batchArg ? parseInt(batchArg.split('=')[1], 10) : 5000;

    if (!fs.existsSync(DATABASE_PATH)) {
        console.error(`Database not found: ${DATABASE_PATH}`);
        process.exit(1);
    }

    const db = new Database(DATABASE_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');

    db.exec(`
        CREATE TABLE IF NOT EXISTS tag_search_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_tag_words_prefix ON tag_words(substr(word, 1, 3), word);
    `);

    const totalMissing = db.prepare(`
        SELECT COUNT(*) AS c FROM tags t
        WHERE t.title IS NOT NULL AND TRIM(t.title) != ''
          AND NOT EXISTS (SELECT 1 FROM tag_word_sequences tws WHERE tws.tag_id = t.id LIMIT 1)
    `).get().c;

    console.log(`Tag search backfill: ${totalMissing} tags missing word sequences`);

    const selectBatch = db.prepare(`
        SELECT t.id, t.title
        FROM tags t
        WHERE t.id > ?
          AND t.title IS NOT NULL AND TRIM(t.title) != ''
          AND NOT EXISTS (SELECT 1 FROM tag_word_sequences tws WHERE tws.tag_id = t.id LIMIT 1)
        ORDER BY t.id
        LIMIT ?
    `);

    const insertWord = db.prepare('INSERT OR IGNORE INTO tag_words (tag_id, word) VALUES (?, ?)');
    const insertSequence = db.prepare(`
        INSERT OR IGNORE INTO tag_word_sequences (tag_id, sequence, sequence_length, start_position)
        VALUES (?, ?, ?, ?)
    `);

    let processed = 0;
    let lastId = 0;

    while (true) {
        const rows = selectBatch.all(lastId, batchSize);
        if (!rows.length) break;

        const insertBatch = db.transaction((batchRows) => {
            for (const row of batchRows) {
                const { words, sequences } = buildTitleSearchIndexData(row.title);
                for (const word of words) {
                    insertWord.run(row.id, word);
                }
                for (const seq of sequences) {
                    insertSequence.run(row.id, seq.sequence, seq.sequenceLength, seq.startPosition);
                }
            }
        });

        insertBatch(rows);
        lastId = rows[rows.length - 1].id;
        processed += rows.length;

        if (processed % 20000 === 0 || rows.length < batchSize) {
            console.log(`  … indexed ${processed}/${totalMissing}`);
        }
    }

    if (rebuildFts) {
        console.log('Rebuilding tags_title_fts…');
        const ftsExists = db.prepare(`
            SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'tags_title_fts'
        `).get();
        if (!ftsExists) {
            db.exec(`
                CREATE VIRTUAL TABLE tags_title_fts USING fts5(
                    tag_id UNINDEXED,
                    title,
                    tokenize='trigram'
                )
            `);
        } else {
            db.exec('DELETE FROM tags_title_fts');
        }
        db.exec(`
            INSERT INTO tags_title_fts(tag_id, title)
            SELECT id, LOWER(title) FROM tags WHERE title IS NOT NULL AND TRIM(title) != ''
        `);
        console.log('tags_title_fts rebuilt');
    }

    db.prepare(`
        INSERT OR REPLACE INTO tag_search_meta (key, value) VALUES ('words_index_version', ?)
    `).run(String(Date.now()));

    db.close();
    console.log(`Done (${processed} tags indexed)`);
}

main();
