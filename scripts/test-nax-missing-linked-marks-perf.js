const assert = require('assert');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const naxTagsDatabase = require('../modules/naxTagsDatabase');

// Test listMissingLinkedMarks using an in-memory SQLite database
function testMissingLinkedMarks() {
    const testDbPath = path.join(__dirname, '..', '.cache', 'test_nax_tags.db');
    if (fs.existsSync(testDbPath)) {
        fs.unlinkSync(testDbPath);
    }

    // getDb() returns null unless the DB file exists, so seed the schema first
    fs.mkdirSync(path.dirname(testDbPath), { recursive: true });
    const seed = new Database(testDbPath);
    seed.exec(`
        CREATE TABLE IF NOT EXISTS nax_galleries (
            slug TEXT PRIMARY KEY,
            title TEXT,
            version TEXT,
            description TEXT,
            tag_count INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS nax_tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            gallery_slug TEXT NOT NULL,
            tag TEXT NOT NULL,
            filename TEXT,
            upvotes INTEGER DEFAULT 0,
            downvotes INTEGER DEFAULT 0,
            score INTEGER DEFAULT 0,
            favorite INTEGER DEFAULT 0,
            try_mark INTEGER DEFAULT 0,
            hidden_mark INTEGER DEFAULT 0,
            export_index INTEGER DEFAULT 0,
            is_custom INTEGER DEFAULT 0
        );
    `);
    seed.close();

    naxTagsDatabase.initializeNaxTagsDatabase(testDbPath);
    const db = naxTagsDatabase.getDb();
    assert.ok(db, 'NAX tags DB should open');

    // Insert test galleries from first merge group: 'danbooru-artist-tags-v4' & 'danbooru-artist-tags-v4.5'
    const insertGallery = db.prepare('INSERT INTO nax_galleries (slug, title) VALUES (?, ?)');
    insertGallery.run('danbooru-artist-tags-v4', 'Artist Tags v4');
    insertGallery.run('danbooru-artist-tags-v4.5', 'Artist Tags v4.5');

    // Insert tag in v4 marked as favorite
    const insertTag = db.prepare(`
        INSERT INTO nax_tags (gallery_slug, tag, favorite, try_mark)
        VALUES (?, ?, ?, ?)
    `);
    insertTag.run('danbooru-artist-tags-v4', 'artist_alpha', 1, 0);
    insertTag.run('danbooru-artist-tags-v4', 'artist_beta', 1, 1);
    // Insert artist_beta into v4.5 as well
    insertTag.run('danbooru-artist-tags-v4.5', 'artist_beta', 1, 1);

    // Test listMissingLinkedMarks for favorites
    const missingFavs = naxTagsDatabase.listMissingLinkedMarks('favorites');
    assert.strictEqual(missingFavs.length, 1, 'Should find exactly 1 missing favorite tag in v4.5');
    assert.strictEqual(missingFavs[0].tag, 'artist_alpha');
    assert.strictEqual(missingFavs[0].gallerySlug, 'danbooru-artist-tags-v4.5');
    assert.strictEqual(missingFavs[0].missing, true);

    // Test listMissingLinkedMarks for try marks
    const missingTry = naxTagsDatabase.listMissingLinkedMarks('try');
    assert.strictEqual(missingTry.length, 0, 'artist_beta exists in both v4 and v4.5, so 0 missing try marks');

    naxTagsDatabase.shutdownNaxTagsDatabase();
    if (fs.existsSync(testDbPath)) {
        fs.unlinkSync(testDbPath);
    }

    console.log('✅ listMissingLinkedMarks perf optimization test passed successfully.');
}

testMissingLinkedMarks();
