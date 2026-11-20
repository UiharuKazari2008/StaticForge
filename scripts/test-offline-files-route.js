#!/usr/bin/env node
'use strict';
/**
 * modules/offlineFilesRoute.js against a fake VFS (no server, no database): settings, folder listing, a chunked upload
 * with a resend and a resume, the md5 check, conflicts (created-exists, keep both, keep local), mkdirs, Range download.
 *   node scripts/test-offline-files-route.js
 *   node scripts/test-offline-files-route.js --serve PORT   the fake as a server, for a CaféReady host's own test
 *                     (cafeready tests/offline_live.rs): GET /_files lists what arrived; POST /_down?on=1|0 drops
 *                     every request (the link down); POST /_put?folder=&name= puts a file as if changed on the server
 */
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');

const md5 = (b) => crypto.createHash('md5').update(b).digest('hex');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'offline-files-'));

// ---- the fake VFS: folders by name path, files in them
const folders = new Map([['/Workspaces/ws1', { id: null }]]);
const files = []; // { id, folderPath, original_name, content_hash, size, mime_type, updated_at }
let seq = 0;
const vfsDb = {
    getUserFilesByLocation: async (scope, ws, folderId) => files.filter((f) => f.folderId === (folderId || null) && !f.trashed_at),
    getFoldersByParent: async (scope, ws, parentId) => [...folders.entries()].filter(([, f]) => f.parent === (parentId || null) && f.id).map(([p, f]) => ({ id: f.id, name: p.split('/').pop() })),
    getUserFileById: async (id) => files.find((f) => f.id === id) || null,
    getFolderById: async (id) => { const e = [...folders.entries()].find(([, f]) => f.id === id); return e ? { id, name: e[0].split('/').pop() } : null; }
};
require.cache[require.resolve('../modules/vfsDatabase')] = { id: 'vfsDatabase', filename: require.resolve('../modules/vfsDatabase'), loaded: true, exports: vfsDb };
require.cache[require.resolve('../modules/replicationJournal')] = { loaded: true, exports: { recordVfsFile: async () => {} } };
const blobs = path.join(tmp, 'blobs');
fs.mkdirSync(blobs);
const vfs = {
    resolvePathInput: async (p) => { if (!folders.has(p)) throw new Error(`Folder not found: ${p}`); return p; },
    resolveLocationFromPath: (p) => ({ scope: 'workspace', workspaceId: 'ws1', folderId: folders.get(p).id }),
    createFolderAtPath: async (parent, name) => { const id = `fold${++seq}`; folders.set(`${parent}/${name}`, { id, parent: folders.get(parent).id }); return { id }; },
    saveUserFileFromPath: async (file, o) => {
        const b = fs.readFileSync(file);
        const h = md5(b);
        fs.writeFileSync(path.join(blobs, h), b);
        const folderId = o.folderId || null;
        if (o.overwrite) {
            const ex = files.find((f) => f.folderId === folderId && f.original_name === o.originalName);
            if (ex) { Object.assign(ex, { content_hash: h, size: b.length, updated_at: ++seq }); return ex; }
        }
        const f = { id: `file${++seq}`, folderId, original_name: o.originalName, content_hash: h, size: b.length, mime_type: o.mimeType, updated_at: seq };
        files.push(f);
        return f;
    },
    getFileBlobPath: (h) => path.join(blobs, h)
};
let broadcasts = 0;
const gr = { getPath: () => tmp, getVfsManager: () => vfs, getWebSocketServer: () => ({ broadcast: () => { broadcasts += 1; } }) };

const route = require('../modules/offlineFilesRoute');
const app = express();
app.use(express.json());
const auth = (req, res, next) => { req.userType = req.headers['x-test-user'] === 'guest' ? 'user' : 'admin'; next(); };
let down = false;
const serveAt = process.argv.indexOf('--serve') > 0 ? Number(process.argv[process.argv.indexOf('--serve') + 1]) : 0;
if (serveAt) {
    app.use((req, res, next) => { if (down && !req.path.startsWith('/_')) { req.socket.destroy(); return; } next(); });
    app.get('/_files', (req, res) => res.json(files.map((f) => ({ ...f, folder: [...folders.entries()].find(([, x]) => x.id === f.folderId)?.[0] }))));
    app.post('/_down', (req, res) => { down = req.query.on === '1'; res.json({ down }); });
    app.post('/_put', express.raw({ type: '*/*', limit: '64mb' }), async (req, res) => {
        const f = path.join(tmp, 'put');
        fs.writeFileSync(f, req.body);
        res.json(await vfs.saveUserFileFromPath(f, { originalName: req.query.name, folderId: folders.get(req.query.folder).id, overwrite: true }));
    });
}
route.mount(app, auth, gr);
if (serveAt) {
    for (const p of ['/Workspaces/ws1/Documents']) folders.set(p, { id: `fold${++seq}`, parent: null });
    app.listen(serveAt, () => console.log(`fake offline-files server on :${serveAt}`));
}

if (!serveAt) (async () => {
    const server = app.listen(0);
    const base = `http://127.0.0.1:${server.address().port}/api/offline-files`;
    const j = async (method, p, body, headers) => {
        const r = await fetch(`${base}${p}`, { method, headers: { 'Content-Type': 'application/json', ...(headers || {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
        return [r.status, await r.json().catch(() => null)];
    };
    const chunk = async (id, offset, b) => { const r = await fetch(`${base}/upload/${id}/chunk?offset=${offset}`, { method: 'POST', body: b }); return [r.status, await r.json()]; };
    try {
        // rules and settings
        assert.deepStrictEqual(route._test.ruleFor('/Workspaces/ws1/Camera Roll/Camcorder'), { caching: 'none', writeBack: true, rule: 'Camera Roll' });
        assert.strictEqual(route._test.ruleFor('/Workspaces/ws1/Pictures'), null);
        assert.strictEqual((await j('GET', '/settings', undefined, { 'x-test-user': 'guest' }))[0], 403);
        let [st, v] = await j('POST', '/settings', { path: '/Workspaces/ws1/Docs', caching: 'auto', writeBack: false, optimized: true });
        assert.strictEqual(st, 200);
        [st, v] = await j('GET', '/settings');
        assert.deepStrictEqual(v.folders['/Workspaces/ws1/Docs'], { caching: 'auto', writeBack: false, optimized: true });
        assert.strictEqual((await j('POST', '/settings', { path: '/x', caching: 'sometimes' }))[0], 400);

        // a 9 MB recording into Camera Roll/Camcorder (both made by the commit), with a resend and a resume
        const data = crypto.randomBytes(9 * 1024 * 1024 + 7);
        const id = crypto.randomBytes(16).toString('hex');
        const meta = { folder: '/Workspaces/ws1/Camera Roll/Camcorder', name: 'Video 1.webm', size: data.length, md5: md5(data), base: null, id, mime: 'video/webm', computer: 'Mac' };
        [st, v] = await j('POST', '/upload/begin', meta);
        assert.strictEqual(st, 200);
        assert.strictEqual(v.received, 0);
        const C = v.chunkSize;
        assert.strictEqual((await chunk(id, 0, data.subarray(0, C)))[1].received, C);
        // a resent chunk is refused with the count
        [st, v] = await chunk(id, 0, data.subarray(0, C));
        assert.deepStrictEqual([st, v.received], [409, C]);
        // the client restarts: begin again with its id
        [st, v] = await j('POST', '/upload/begin', meta);
        assert.strictEqual(v.received, C);
        for (let o = C; o < data.length; o += C) assert.strictEqual((await chunk(id, o, data.subarray(o, o + C)))[0], 200);
        [st, v] = await j('POST', `/upload/${id}/commit`, {});
        assert.strictEqual(st, 200, JSON.stringify(v));
        assert.strictEqual(v.file.md5, md5(data));
        assert.ok(folders.has('/Workspaces/ws1/Camera Roll/Camcorder'), 'folders made');
        assert.ok(broadcasts >= 1, 'vfs_updated broadcast');
        [st, v] = await j('GET', `/folder?path=${encodeURIComponent('/Workspaces/ws1/Camera Roll/Camcorder')}`);
        assert.strictEqual(v.files[0].name, 'Video 1.webm');
        [st, v] = await j('GET', `/folder?path=${encodeURIComponent('/Workspaces/ws1/Camera Roll')}`);
        assert.strictEqual(v.folders[0].name, 'Camcorder');
        assert.strictEqual((await j('GET', '/folder?path=%2FWorkspaces%2Fws1%2FNope'))[0], 404);

        // Range download
        const fid = files[0].id;
        const r = await fetch(`${base}/file/${fid}`, { headers: { Range: 'bytes=10-19' } });
        assert.strictEqual(r.status, 206);
        assert.ok(Buffer.from(await r.arrayBuffer()).equals(data.subarray(10, 20)));

        // bytes that do not match their md5
        const bad = Buffer.from('picture bytes');
        const id2 = crypto.randomBytes(16).toString('hex');
        await j('POST', '/upload/begin', { folder: '/Workspaces/ws1/Camera Roll', name: 'P.png', size: bad.length, md5: md5(Buffer.from('other')), id: id2 });
        await chunk(id2, 0, bad);
        assert.strictEqual((await j('POST', `/upload/${id2}/commit`, {}))[0], 422);

        // created on a client while the server has another file of that name: conflict, then keep both / keep local
        const up = async (name, b, base0, keep) => {
            const i = crypto.randomBytes(16).toString('hex');
            await j('POST', '/upload/begin', { folder: '/Workspaces/ws1/Camera Roll', name, size: b.length, md5: md5(b), base: base0, id: i, computer: 'Mac' });
            await chunk(i, 0, b);
            const out = await j('POST', `/upload/${i}/commit`, {});
            if (out[0] !== 409 || !keep) return out;
            return j('POST', `/upload/${i}/commit`, { keep });
        };
        assert.strictEqual((await up('Same.png', Buffer.from('server copy'), null))[0], 200);
        [st, v] = await up('Same.png', Buffer.from('client copy'), null);
        assert.deepStrictEqual([st, v.code, v.kind], [409, 'CONFLICT', 'created-exists']);
        [st, v] = await up('Same.png', Buffer.from('client copy'), null, 'both');
        assert.deepStrictEqual([st, v.renamed], [200, 'Same (Mac v1).png']);
        // changed here from the server's copy it knew: no conflict, the server's copy is replaced
        [st, v] = await up('Same.png', Buffer.from('client edit'), md5(Buffer.from('server copy')));
        assert.strictEqual(st, 200);
        // changed on both sides (base is stale): conflict; keep local replaces it
        [st, v] = await up('Same.png', Buffer.from('client again'), md5(Buffer.from('server copy')));
        assert.deepStrictEqual([st, v.kind], [409, 'both-changed']);
        [st, v] = await up('Same.png', Buffer.from('client again'), md5(Buffer.from('server copy')), 'local');
        assert.strictEqual(st, 200);
        assert.strictEqual(files.find((f) => f.original_name === 'Same.png').content_hash, md5(Buffer.from('client again')));
        // the same bytes again: nothing to store
        [st, v] = await up('Same.png', Buffer.from('client again'), null);
        assert.deepStrictEqual([st, v.same], [200, true]);
        console.log('offline files route: ok');
    } finally {
        server.close();
        fs.rmSync(tmp, { recursive: true, force: true });
    }
})().catch((e) => { console.error(e); process.exit(1); });
