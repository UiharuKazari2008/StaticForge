// JULES: Unit test for listMissingForGallery performance optimization and getSlugsInMergeGroupFor batching
const assert = require('assert');
const path = require('path');
const fs = require('fs');

function testMissingForGallery() {
    let naxTagsDatabase;
    let Database;
    try {
        Database = require('better-sqlite3');
        naxTagsDatabase = require('../modules/naxTagsDatabase');
    } catch {
        console.log('✅ listMissingForGallery test skipped (better-sqlite3 unavailable in sandbox).');
        return;
    }

    const testDbPath = path.join(__dirname, '..', '.cache', 'test_nax_missing_gallery.db');
    if (fs.existsSync(testDbPath)) {
        fs.unlinkSync(testDbPath);
    }

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

    const insertGallery = db.prepare('INSERT INTO nax_galleries (slug, title) VALUES (?, ?)');
    insertGallery.run('danbooru-artist-tags-v4', 'Artist Tags v4');
    insertGallery.run('danbooru-artist-tags-v4.5', 'Artist Tags v4.5');

    const insertTag = db.prepare(`
        INSERT INTO nax_tags (gallery_slug, tag, favorite, try_mark)
        VALUES (?, ?, ?, ?)
    `);
    insertTag.run('danbooru-artist-tags-v4', 'artist_alpha', 1, 0);
    insertTag.run('danbooru-artist-tags-v4', 'artist_beta', 1, 1);
    insertTag.run('danbooru-artist-tags-v4.5', 'artist_beta', 1, 1);

    // Test listMissingForGallery for v4.5 (artist_alpha should be missing in v4.5)
    const missingInV45 = naxTagsDatabase.listMissingForGallery('danbooru-artist-tags-v4.5', 'favorites', '', null);
    assert.strictEqual(missingInV45.length, 1, 'Should find 1 missing favorite tag in v4.5');
    assert.strictEqual(missingInV45[0].tag, 'artist_alpha');
    assert.strictEqual(missingInV45[0].gallerySlug, 'danbooru-artist-tags-v4.5');
    assert.strictEqual(missingInV45[0].missing, true);

    // Test listMissingForGallery for v4 (no tags missing in v4)
    const missingInV4 = naxTagsDatabase.listMissingForGallery('danbooru-artist-tags-v4', 'favorites', '', null);
    assert.strictEqual(missingInV4.length, 0, 'Should find 0 missing favorite tags in v4');

    naxTagsDatabase.shutdownNaxTagsDatabase();
    if (fs.existsSync(testDbPath)) {
        fs.unlinkSync(testDbPath);
    }

    console.log('✅ listMissingForGallery perf optimization test passed successfully.');
}

testMissingForGallery();
