const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const SQLiteAsyncWrapper = require('../modules/sqliteAsyncWrapper');

async function run() {
    // mock out winston to avoid missing modules in test environment
    const Module = require('module');
    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
        if (request === 'winston') {
            return {
                createLogger: () => ({ info: () => {}, error: () => {}, warn: () => {}, debug: () => {} }),
                format: { combine: () => {}, timestamp: () => {}, json: () => {} },
                transports: { Console: class Console {} }
            };
        }
        return originalLoad.apply(this, arguments);
    };

    const tmpFile = path.join(os.tmpdir(), `taglookup-test-${Date.now()}.db`);

    // We create a dummy global resources object that tag-lookup expects
    const globalResources = {
        getGlobalSettings() { return {}; }
    };

    const TagLookup = require('../modules/tag-lookup');
    const tagLookup = new TagLookup(globalResources);

    // Set the db wrapper directly to bypass file path initialization logic
    tagLookup.dbPath = tmpFile;
    tagLookup.db = new SQLiteAsyncWrapper(tmpFile);
    await tagLookup.db.initialize();

    // Seed some test data
    await tagLookup.db.exec(`
        CREATE TABLE IF NOT EXISTS tags (id INTEGER PRIMARY KEY, title TEXT, category INTEGER);
        CREATE TABLE IF NOT EXISTS wikis (id INTEGER PRIMARY KEY, title TEXT, source TEXT);
        CREATE TABLE IF NOT EXISTS tag_wikis (tag_id INTEGER, wiki_id INTEGER);
        CREATE TABLE IF NOT EXISTS tag_wiki_links (tag_id INTEGER, wiki_id INTEGER, relationship INTEGER);
        CREATE TABLE IF NOT EXISTS wiki_pages (id INTEGER PRIMARY KEY, title TEXT, danbooru_wiki_id INTEGER, e621_wiki_id INTEGER, category INTEGER);
        CREATE TABLE IF NOT EXISTS wiki_page_links (linked_tag_id INTEGER, page_id INTEGER);
    `);

    // Test parameters
    const wikiCount = 50;
    const tagsPerWiki = 20;

    await tagLookup.db.run(`INSERT INTO tags (id, title, category) VALUES (1, 'main_tag', 0)`);

    // Create wikis and wiki pages that reference the tag
    for (let i = 1; i <= wikiCount; i++) {
        await tagLookup.db.run(`INSERT INTO wiki_pages (id, title, danbooru_wiki_id, e621_wiki_id, category) VALUES (?, ?, ?, ?, ?)`, [i, `page_${i}`, i, null, 0]);
        await tagLookup.db.run(`INSERT INTO wiki_page_links (linked_tag_id, page_id) VALUES (1, ?)`, [i]);

        await tagLookup.db.run(`INSERT INTO wikis (id, title, source) VALUES (?, ?, ?)`, [i, `wiki_${i}`, 'danbooru']);

        for (let j = 1; j <= tagsPerWiki; j++) {
            const tagId = i * 1000 + j;
            await tagLookup.db.run(`INSERT INTO tags (id, title, category) VALUES (?, ?, 0)`, [tagId, `tag_${tagId}`]);
            await tagLookup.db.run(`INSERT INTO tag_wiki_links (tag_id, wiki_id, relationship) VALUES (?, ?, 0)`, [tagId, i]);
        }
    }

    const start = Date.now();
    const results = await tagLookup.fetchTagWikiMentions(1, 1000);
    const time = Date.now() - start;

    console.log(`fetchTagWikiMentions time: ${time}ms, results: ${results.length}`);

    // The previous n^2 approach took around 3000ms for these constants in testing.
    // The new approach takes <50ms.
    assert(time < 1000, `Expected time < 1000ms, but took ${time}ms`);
    assert(results.length === 1000, `Expected 1000 results, got ${results.length}`);

    fs.unlinkSync(tmpFile);
    console.log('Passed scaling test successfully!');
    process.exit(0);
}
run();
