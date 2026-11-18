'use strict';

/**
 * CaféReady task code for the Android app (StaticForge #908, rule cafeready-background). Yukimi, Nov 17 2026: the
 * native status bar should be easy to set up from the server "instead of having to keep constantly updating the app".
 *
 *   GET /api/cafe-tasks/manifest        { api, files: [{ name, sha256 }], tasks: [{ name, api }], source }
 *   GET /api/cafe-tasks/file/:name      the file (only names the manifest lists); ETag = its sha256 (304 when same)
 *
 * The app (DSApp CafeTasks) fetches these when it starts and when the link comes up, verifies each file's sha256,
 * refuses a manifest or task whose api is above its own host interface, keeps the last good copy on disk, and falls
 * back to the copy bundled in the APK. So a task or statusFit change reaches the phones with a server deploy, and
 * can never get ahead of what an installed app can run.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = path.join(__dirname, '..', 'public', 'scripts', 'tasks');
let cache = null; // { key, manifest, files: Map name -> { sha, buf } }

function load() {
    let man;
    try { man = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8')); } catch (_) { return null; }
    const names = Array.isArray(man.files) ? man.files.filter((f) => /^[a-z0-9-]+\.js$/.test(f)) : [];
    const stamps = names.map((f) => { try { const st = fs.statSync(path.join(DIR, f)); return `${f}:${st.mtimeMs}:${st.size}`; } catch (_) { return `${f}:-`; } });
    let mst = 0;
    try { mst = fs.statSync(path.join(DIR, 'manifest.json')).mtimeMs; } catch (_) { /* none */ }
    const key = `${mst}|${stamps.join('|')}`;
    if (cache && cache.key === key) return cache;
    const files = new Map();
    for (const f of names) {
        let buf;
        try { buf = fs.readFileSync(path.join(DIR, f)); } catch (_) { return null; }
        files.set(f, { sha: crypto.createHash('sha256').update(buf).digest('hex'), buf });
    }
    const manifest = {
        api: man.api,
        files: names.map((f) => ({ name: f, sha256: files.get(f).sha })),
        tasks: Array.isArray(man.tasks) ? man.tasks : [],
        source: `server ${crypto.createHash('sha256').update(key).digest('hex').slice(0, 8)}`
    };
    cache = { key, manifest, files };
    return cache;
}

function mount(app, authMiddleware) {
    const auth = authMiddleware || ((req, res, next) => next());
    app.get('/api/cafe-tasks/manifest', auth, (req, res) => {
        const c = load();
        if (!c) { res.status(503).json({ success: false, code: 'NO_TASKS', error: 'The task files could not be read.' }); return; }
        res.set('Cache-Control', 'no-cache');
        res.json(c.manifest);
    });
    app.get('/api/cafe-tasks/file/:name', auth, (req, res) => {
        const c = load();
        const f = c && c.files.get(String(req.params.name || ''));
        if (!f) { res.status(404).json({ success: false, code: 'NOT_FOUND', error: 'No such task file.' }); return; }
        const etag = `"${f.sha}"`;
        res.set('ETag', etag);
        res.set('Cache-Control', 'no-cache');
        if (req.headers['if-none-match'] === etag) { res.status(304).end(); return; }
        res.type('application/javascript').send(f.buf);
    });
}

module.exports = { mount, _test: { load } };
