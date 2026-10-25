#!/usr/bin/env node
// search_files (#649): the web client asks with includeSuggestions false and gets the same
// results with dimension-only metadata and no tagSuggestions; the default still includes them.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const metadataDb = require('../modules/metadataDatabase');
const searchHandler = require('../modules/ws/handlers/70-searchHandler');
const wsPacketRegistry = require('../modules/ws/wsPacketRegistry');

async function main() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'search-files-649-'));
    try {
        assert.strictEqual(await metadataDb.initializeDatabase(dir), true);
        await metadataDb.closeDatabase();
        const raw = await open({ filename: path.join(dir, 'metadata.db'), driver: sqlite3.Database });
        await raw.exec('BEGIN');
        const files = ['a.png', 'b.png', 'c.png'];
        for (const [i, f] of files.entries()) {
            await raw.run('INSERT INTO images (filename, md5, width, height, upscaled, size, mtime, metadata, search_indexes_ready) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)',
                [f, `md5${i}`, 832, 1216, i === 2 ? 1 : 0, 100 + i, 1700000000 + i, JSON.stringify({ forge_data: { prompt: 'x'.repeat(5000) } })]);
            await raw.run("INSERT INTO gallery_workspace_ownership (filename, workspace_id, bucket) VALUES (?, 'default', 'files')", [f]);
            await raw.run("INSERT INTO search_tags (filename, tag, original_tag, weight, source) VALUES (?, '1girl', '1girl', 1, 'prompt')", [f]);
        }
        await raw.run("INSERT INTO search_tags (filename, tag, original_tag, weight, source) VALUES ('a.png', 'smile', 'smile', 1, 'prompt')");
        await raw.exec('COMMIT');
        await raw.close();
        assert.strictEqual(await metadataDb.initializeDatabase(dir), true);

        const sent = [];
        const errors = [];
        const workspace = { id: 'default', files: files.slice(), scraps: [], pinned: [] };
        const handlers = {
            sendToClient(_ws, message) { sent.push(message); },
            sendError(_ws, message, details, requestId) { errors.push({ message, details, requestId }); },
            globalResources: {
                getMetadataDatabase() { return metadataDb; },
                getWorkspaceManager() {
                    return {
                        getActiveWorkspace() { return 'default'; },
                        getWorkspaces() { return { default: workspace }; },
                        getWorkspace(id) { return id === 'default' ? workspace : null; }
                    };
                },
                getConfig() { return {}; }
            }
        };
        const wsServer = { sendToClient(_ws, message) { sent.push(message); }, broadcast() {} };
        searchHandler.registerPackets(handlers);
        const handle = wsPacketRegistry.getWsPacketHandler('search_files');
        assert.ok(handle, 'search_files handler registered');

        async function request(message) {
            sent.length = 0; errors.length = 0;
            await handle({ handlers, ws: {}, message, clientInfo: { sessionId: 'sess-649' }, wsServer });
            assert.strictEqual(errors.length, 0, JSON.stringify(errors));
            const reply = sent.find((m) => m.type === 'search_files_response');
            assert.ok(reply, 'search_files_response sent');
            return reply.data;
        }

        const web = await request({ type: 'search_files', requestId: 'r1', action: 'search', query: '1girl', viewType: 'images', includeSuggestions: false });
        assert.strictEqual(web.status, 'complete');
        assert.strictEqual(web.count, 3);
        assert.deepStrictEqual(web.tagSuggestions, [], 'web client gets no first-term suggestions');
        const c = web.results.find((r) => r.filename === 'c.png');
        assert.deepStrictEqual(c.metadata, { width: 832, height: 1216, upscaled: true, size: 102, mtime: 1700000002 }, 'dimension-only metadata');
        assert.strictEqual(JSON.stringify(web).includes('xxxxxxxx'), false, 'no metadata JSON leaks into the reply');

        const legacy = await request({ type: 'search_files', requestId: 'r2', action: 'search', query: '1girl', viewType: 'images' });
        assert.strictEqual(legacy.count, 3);
        assert.ok(Array.isArray(legacy.tagSuggestions) && legacy.tagSuggestions.length > 0, 'default still includes suggestions');
        assert.ok(legacy.tagSuggestions.some((t) => t.tag === '1girl'));

        const narrow = await request({ type: 'search_files', requestId: 'r3', action: 'search', query: '1girl, smile', viewType: 'images', includeSuggestions: false });
        assert.strictEqual(narrow.count, 1);
        assert.strictEqual(narrow.results[0].filename, 'a.png');

        console.log('test-search-files-suggestions: ok');
    } finally {
        try { await metadataDb.closeDatabase(); } catch (_) {}
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

main().then(() => process.exit(0)).catch((err) => {
    console.error('test-search-files-suggestions: FAIL', err);
    process.exit(1);
});
