/**
 * Import NAX tag export JSON into SQLite for the NAXT applet.
 * Re-run clears and reimports; favorites and custom tags are preserved.
 *
 * Usage: node scripts/import-nax-tags.js
 * Source: ../nax_tags.json  →  ../.cache/nax_tags.db
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { NAX_FAVORITE_MERGE_GROUPS, propagateFavoritesInMergeGroups, propagateTryMarksInMergeGroups } = require('../modules/naxTagsDatabase');

const JSON_PATH = path.join(__dirname, '..', 'nax_tags.json');
const DB_PATH = path.join(__dirname, '..', '.cache', 'nax_tags.db');

function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function openDb() {
    ensureDir(path.dirname(DB_PATH));
    const db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('foreign_keys = ON');
    return db;
}

function createSchema(db) {
    db.exec(`
        DROP TABLE IF EXISTS nax_tags;
        DROP TABLE IF EXISTS nax_galleries;
        CREATE TABLE nax_galleries (
            slug TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            version TEXT NOT NULL,
            description TEXT,
            tag_count INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE nax_tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            gallery_slug TEXT NOT NULL,
            tag TEXT NOT NULL,
            filename TEXT NOT NULL,
            upvotes INTEGER NOT NULL,
            downvotes INTEGER NOT NULL,
            score INTEGER NOT NULL,
            favorite INTEGER NOT NULL DEFAULT 0,
            try_mark INTEGER NOT NULL DEFAULT 0,
            hidden_mark INTEGER NOT NULL DEFAULT 0,
            export_index INTEGER NOT NULL DEFAULT 0,
            is_custom INTEGER NOT NULL DEFAULT 0,
            UNIQUE(gallery_slug, tag),
            FOREIGN KEY (gallery_slug) REFERENCES nax_galleries(slug)
        );
        CREATE INDEX idx_nax_tags_gallery ON nax_tags(gallery_slug);
        CREATE INDEX idx_nax_tags_gallery_export ON nax_tags(gallery_slug, export_index);
    `);
}

function main() {
    if (!fs.existsSync(JSON_PATH)) {
        console.error('Missing input file:', JSON_PATH);
        process.exit(1);
    }

    console.log('Reading', JSON_PATH, '...');
    const raw = fs.readFileSync(JSON_PATH, 'utf8');
    const data = JSON.parse(raw);
    if (!data.galleries || typeof data.galleries !== 'object') {
        console.error('Invalid JSON: expected top-level "galleries" object');
        process.exit(1);
    }

    let db = null;
    let favorites = [];
    let tryMarks = [];
    let hiddenMarks = [];
    let customRows = [];

    try {
        if (fs.existsSync(DB_PATH)) {
            db = openDb();
            const hasTable = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='nax_tags'`).get();
            if (hasTable) {
                const cols = db.prepare('PRAGMA table_info(nax_tags)').all();
                const hasCustom = cols.some((c) => c.name === 'is_custom');
                const hasTry = cols.some((c) => c.name === 'try_mark');
                const hasHidden = cols.some((c) => c.name === 'hidden_mark');
                favorites = db.prepare('SELECT gallery_slug, tag FROM nax_tags WHERE favorite = 1').all();
                console.log('Backed up', favorites.length, 'favorite rows');
                if (hasTry) {
                    tryMarks = db.prepare('SELECT gallery_slug, tag FROM nax_tags WHERE try_mark = 1').all();
                    console.log('Backed up', tryMarks.length, 'try mark rows');
                }
                if (hasHidden) {
                    hiddenMarks = db.prepare('SELECT gallery_slug, tag FROM nax_tags WHERE hidden_mark = 1').all();
                    console.log('Backed up', hiddenMarks.length, 'hidden mark rows');
                }
                if (hasCustom) {
                    customRows = db.prepare(`
                        SELECT gallery_slug, tag, filename, upvotes, downvotes, score, favorite, export_index
                        FROM nax_tags WHERE is_custom = 1
                    `).all();
                    console.log('Backed up', customRows.length, 'custom tag rows');
                }
            }
            db.close();
        }

        db = openDb();
        createSchema(db);

        const insGallery = db.prepare(`
            INSERT INTO nax_galleries (slug, title, version, description, tag_count)
            VALUES (@slug, @title, @version, @description, @tag_count)
        `);
        const insTag = db.prepare(`
            INSERT INTO nax_tags (gallery_slug, tag, filename, upvotes, downvotes, score, favorite, export_index, is_custom)
            VALUES (@gallery_slug, @tag, @filename, @upvotes, @downvotes, @score, 0, @export_index, 0)
        `);

        const importTags = db.transaction((slug, gallery) => {
            const tags = gallery.tags || [];
            const title = gallery.title || slug;
            const version = gallery.version || '';
            const description = gallery.description || '';
            insGallery.run({
                slug,
                title,
                version,
                description,
                tag_count: tags.length
            });

            for (let i = 0; i < tags.length; i++) {
                const t = tags[i];
                const votes = t.votes || {};
                insTag.run({
                    gallery_slug: slug,
                    tag: t.tag,
                    filename: t.filename,
                    upvotes: Number(votes.up) || 0,
                    downvotes: Number(votes.down) || 0,
                    score: Number(votes.score) || 0,
                    export_index: i
                });
            }
        });

        const txAll = db.transaction(() => {
            for (const [slug, gallery] of Object.entries(data.galleries)) {
                importTags(slug, gallery);
            }
        });
        txAll();

        if (favorites.length) {
            const restore = db.prepare('UPDATE nax_tags SET favorite = 1 WHERE gallery_slug = ? AND tag = ?');
            const restoreMany = db.transaction((rows) => {
                for (const row of rows) {
                    restore.run(row.gallery_slug, row.tag);
                }
            });
            restoreMany(favorites);
            console.log('Restored', favorites.length, 'favorites');
        }

        propagateFavoritesInMergeGroups(db);
        console.log('Propagated favorites across', NAX_FAVORITE_MERGE_GROUPS.length, 'merge group(s)');

        if (tryMarks.length) {
            const restoreTry = db.prepare('UPDATE nax_tags SET try_mark = 1 WHERE gallery_slug = ? AND tag = ?');
            const restoreTryMany = db.transaction((rows) => {
                for (const row of rows) {
                    restoreTry.run(row.gallery_slug, row.tag);
                }
            });
            restoreTryMany(tryMarks);
            console.log('Restored', tryMarks.length, 'try marks');
        }

        propagateTryMarksInMergeGroups(db);
        console.log('Propagated try marks across', NAX_FAVORITE_MERGE_GROUPS.length, 'merge group(s)');

        if (hiddenMarks.length) {
            const restoreHidden = db.prepare('UPDATE nax_tags SET hidden_mark = 1 WHERE gallery_slug = ? AND tag = ?');
            const restoreHiddenMany = db.transaction((rows) => {
                for (const row of rows) {
                    restoreHidden.run(row.gallery_slug, row.tag);
                }
            });
            restoreHiddenMany(hiddenMarks);
            console.log('Restored', hiddenMarks.length, 'hidden marks');
        }

        if (customRows.length) {
            const insCustom = db.prepare(`
                INSERT OR IGNORE INTO nax_tags (gallery_slug, tag, filename, upvotes, downvotes, score, favorite, export_index, is_custom)
                VALUES (@gallery_slug, @tag, @filename, @upvotes, @downvotes, @score, @favorite, @export_index, 1)
            `);
            const bumpCount = db.prepare('UPDATE nax_galleries SET tag_count = tag_count + 1 WHERE slug = ?');
            let restored = 0;
            const restoreCustom = db.transaction((rows) => {
                for (const row of rows) {
                    const info = insCustom.run({
                        gallery_slug: row.gallery_slug,
                        tag: row.tag,
                        filename: row.filename,
                        upvotes: 0,
                        downvotes: 0,
                        score: 0,
                        favorite: row.favorite || 0,
                        export_index: row.export_index
                    });
                    if (info.changes > 0) {
                        bumpCount.run(row.gallery_slug);
                        restored++;
                    }
                }
            });
            restoreCustom(customRows);
            console.log('Restored', restored, 'custom tag rows');
        }

        const meta = data.metadata || {};
        console.log('Done. Galleries:', Object.keys(data.galleries).length,
            'metadata:', meta.generated_at || '', 'version', meta.version || '');
    } catch (e) {
        console.error(e);
        process.exit(1);
    } finally {
        if (db) db.close();
    }
}

main();
