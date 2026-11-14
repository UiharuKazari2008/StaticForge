/**
 * ActiveSync file bodies (Yozora #747): a phone's files to the desktop and files to a phone, over
 * HTTP through the server, in chunks both ways so a proxy's body limit, a slow link or a 4 GB video
 * never decide whether it works. Calls and listings stay on the socket (modules/activeSync.js).
 *
 * Phone -> desktop (Explorer thumbnails, opening, copying to the computer):
 *   GET  /api/activesync/file/:deviceId/:root/<path>[?thumb=N][&download=1]      administrators
 *        the server asks the phone to send (stream.send { transferId, root, path, thumb, range })
 *        and holds the response open;
 *   POST /api/activesync/transfer/:id/chunk?seq=N[&end=1]                        the device
 *        the phone posts the file in order (seq 0 carries x-as-status / -type / -length / -range /
 *        -mtime); each chunk is answered once it was written to the waiting response, so the phone
 *        never runs ahead of the desktop. 410: the desktop went away, stop.
 *
 * Desktop -> phone (Explorer paste and drops, Send To, a file for a partner that is away):
 *   POST   /api/activesync/upload/:deviceId/begin   { root, dir, name, size, conflict, mtime, id? }
 *   POST   /api/activesync/upload/:id/chunk?offset=N        raw bytes, in order; resumable: the
 *                                                           answer says how much is here
 *   POST   /api/activesync/upload/:id/commit  { queue?, install? }    the phone is asked to take it
 *          (stream.receive { transferId, root, dir, name, size, conflict, mtime }) and pulls it:
 *   GET    /api/activesync/transfer/:id/data                the device, with Range
 *          commit answers with the phone's entry, or { queued: true } when the device is an offline
 *          partner and queue was asked: the file waits here until its next hello;
 *   DELETE /api/activesync/upload/:id                       give up
 *
 * Programs (#795): commit with install: true sends an .apk and then asks the phone to install it
 * (apps.install: Android's installer opens, or a tap-to-install notification when the app is in the
 * background; the user always confirms). A phone that is away gets both queued, in order.
 *   POST   /api/activesync/install/:deviceId  { root, path }   an .apk already on the phone
 *
 * Files in flight to a phone live in <databases>/activesync-transfers/<id> (+ .json); what nobody
 * collected in 7 days is swept. A device's requests must come from the session of one of its open
 * sockets; a transfer id is 128 random bits.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const activeSync = require('./activeSync');

const START_TIMEOUT_MS = 30000;       // the phone must post its first chunk within this
const IDLE_TIMEOUT_MS = 60000;        // and keep them coming
const SEND_CALL_TIMEOUT_MS = 6 * 3600 * 1000;
const MAX_CHUNK_BYTES = 8 * 1024 * 1024;
const UPLOAD_CHUNK_BYTES = 4 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 16 * 1024 * 1024 * 1024;
const KEEP_MS = 7 * 24 * 3600 * 1000;
const MAX_STREAMS_PER_DEVICE = 6;

const streams = new Map(); // id -> { deviceId, res, nextSeq, headed, done, timer, fail }
const waiting = new Map(); // deviceId -> [resolve] (streams over the cap)
const active = new Map(); // deviceId -> count
let dir = null;

function isId(v) {
    return /^[0-9a-f]{32}$/.test(String(v || ''));
}

/**
 * ADB first (#818, Yukimi: installs go over 5555 when it is detected): null when ADB is not ready
 * for the phone or the link failed (the caller goes on to Android's installer); an install error
 * from the package manager is the answer (the installer would refuse the same file).
 */
async function adbInstall(globalResources, deviceId, run) {
    let deviceAdb;
    try { deviceAdb = require('./deviceAdb'); } catch (_) { return null; }
    // Allowed Features (#820): installs over ADB only when the phone allows them
    if (typeof deviceAdb.allowed === 'function' && !deviceAdb.allowed(globalResources, deviceId, 'install')) return null;
    let st = null;
    try { st = await deviceAdb.detect(globalResources, deviceId); } catch (_) { st = null; }
    if (!st || st.state !== 'ready') return null;
    try {
        return await run(deviceAdb);
    } catch (error) {
        if (error.code && String(error.code).startsWith('INSTALL_')) return { state: 'failed', via: 'adb', code: error.code, error: error.message };
        console.warn(`[activeSync] adb install fell back to the phone's installer: ${error.message}`);
        return null;
    }
}

function transfersDir(globalResources) {
    if (dir) return dir;
    const base = globalResources && typeof globalResources.getPath === 'function' ? globalResources.getPath('databases') : path.resolve(__dirname, '..', '.cache');
    dir = path.join(base, 'activesync-transfers');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function metaPath(globalResources, id) {
    return path.join(transfersDir(globalResources), `${id}.json`);
}

function dataPath(globalResources, id) {
    return path.join(transfersDir(globalResources), id);
}

function readMeta(globalResources, id) {
    if (!isId(id)) return null;
    try {
        return JSON.parse(fs.readFileSync(metaPath(globalResources, id), 'utf8'));
    } catch (_) {
        return null;
    }
}

function writeMeta(globalResources, meta) {
    fs.writeFileSync(metaPath(globalResources, meta.id), JSON.stringify(meta));
}

function removeUpload(globalResources, id) {
    if (!isId(id)) return;
    for (const p of [dataPath(globalResources, id), metaPath(globalResources, id)]) {
        try { fs.unlinkSync(p); } catch (_) { /* gone */ }
    }
}

function sweep(globalResources) {
    let names = [];
    try { names = fs.readdirSync(transfersDir(globalResources)); } catch (_) { return; }
    const now = Date.now();
    for (const name of names) {
        if (!name.endsWith('.json')) continue;
        const id = name.slice(0, -5);
        const meta = readMeta(globalResources, id);
        if (!meta || now - (meta.created || 0) > KEEP_MS) removeUpload(globalResources, id);
    }
    // a data file whose description is gone
    for (const name of names) {
        if (isId(name) && !fs.existsSync(metaPath(globalResources, name))) {
            try { fs.unlinkSync(dataPath(globalResources, name)); } catch (_) { /* gone */ }
        }
    }
}

function cleanName(v) {
    return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f/\\]+/g, ' ').trim().slice(0, 255);
}

function refuse(res, status, code, error) {
    if (res.headersSent) { res.destroy(); return; }
    res.status(status).json({ success: false, code, error });
}

function statusOf(code) {
    return { UNKNOWN_DEVICE: 404, OFFLINE: 503, NOT_CONNECTED: 409, NOT_PERMITTED: 403, UNSUPPORTED: 501, TIMEOUT: 504, DISCONNECTED: 502, ENOENT: 404, enoent: 404, 'not-found': 404 }[code] || 502;
}

/** One of a device's stream slots; resolves with a release(). */
function slot(deviceId) {
    const take = () => {
        active.set(deviceId, (active.get(deviceId) || 0) + 1);
        let released = false;
        return () => {
            if (released) return;
            released = true;
            active.set(deviceId, Math.max(0, (active.get(deviceId) || 1) - 1));
            const q = waiting.get(deviceId);
            if (q && q.length) q.shift()();
        };
    };
    if ((active.get(deviceId) || 0) < MAX_STREAMS_PER_DEVICE) return Promise.resolve(take());
    return new Promise((resolve) => {
        if (!waiting.has(deviceId)) waiting.set(deviceId, []);
        waiting.get(deviceId).push(() => resolve(take()));
    });
}

function readBody(req, limit) {
    return new Promise((resolve, reject) => {
        const parts = [];
        let size = 0;
        req.on('data', (c) => {
            size += c.length;
            if (size > limit) { reject(Object.assign(new Error('The chunk is too large.'), { code: 'TOO_LARGE' })); req.destroy(); return; }
            parts.push(c);
        });
        req.on('end', () => resolve(Buffer.concat(parts)));
        req.on('error', reject);
    });
}

function mount(app, authMiddleware, globalResources) {
    const auth = authMiddleware || ((req, res, next) => next());
    const wsServer = () => (typeof globalResources.getWebSocketServer === 'function' ? globalResources.getWebSocketServer() : null);
    const isAdmin = (req) => req.userType === 'admin';
    const fromDevice = (req, deviceId) => activeSync.isDeviceSession(globalResources, wsServer(), deviceId, req.sessionId || (req.session && req.session.id));

    sweep(globalResources);
    const sweeper = setInterval(() => sweep(globalResources), 6 * 3600 * 1000);
    if (sweeper.unref) sweeper.unref();

    // a queued file got its answer, or its partnership ended: the copy here has done its job
    activeSync.onQueueItemDone((item) => {
        if (item.op === 'stream.receive' && item.args && isId(item.args.transferId)) removeUpload(globalResources, item.args.transferId);
    });

    // ---------------------------------------------------------------- phone -> desktop

    app.get('/api/activesync/file/:deviceId/:root/*', auth, async (req, res) => {
        if (!isAdmin(req)) { refuse(res, 403, 'INSUFFICIENT_PERMISSIONS', 'Admin access required'); return; }
        const deviceId = String(req.params.deviceId || '').toLowerCase();
        const rootId = String(req.params.root || '');
        const filePath = `/${String(req.params[0] || '')}`;
        const thumb = Number(req.query.thumb) > 0 ? Math.max(32, Math.min(1024, Math.round(Number(req.query.thumb)))) : 0;
        const id = crypto.randomBytes(16).toString('hex');
        const release = await slot(deviceId);
        if (req.destroyed || res.destroyed) { release(); return; }
        const st = { deviceId, res, nextSeq: 0, headed: false, done: false, timer: null, closed: false };
        const finish = () => {
            if (st.done) return;
            st.done = true;
            clearTimeout(st.timer);
            streams.delete(id);
            release();
        };
        const arm = (ms) => {
            clearTimeout(st.timer);
            st.timer = setTimeout(() => {
                if (st.done) return;
                if (!st.headed) refuse(res, 504, 'TIMEOUT', 'The device did not send the file.'); else res.destroy();
                finish();
            }, ms);
            if (st.timer.unref) st.timer.unref();
        };
        st.arm = arm;
        st.finish = finish;
        streams.set(id, st);
        res.on('close', () => { st.closed = true; finish(); });
        arm(START_TIMEOUT_MS);
        try {
            await activeSync.serverCall(globalResources, wsServer(), deviceId, 'stream.send', {
                transferId: id, root: rootId, path: filePath, thumb, range: req.headers.range ? String(req.headers.range).slice(0, 100) : null
            }, { timeoutMs: SEND_CALL_TIMEOUT_MS, maxTimeoutMs: SEND_CALL_TIMEOUT_MS });
            // the phone says it sent everything: a response that never got its end chunk ends here
            if (!st.done) {
                if (!st.headed) refuse(res, 502, 'EMPTY', 'The device sent nothing.'); else res.end();
                finish();
            }
        } catch (error) {
            if (!st.done) {
                if (!st.headed) refuse(res, statusOf(error.code), error.code || 'ERROR', error.message); else res.destroy();
                finish();
            }
        }
    });

    app.post('/api/activesync/transfer/:id/chunk', auth, async (req, res) => {
        const id = String(req.params.id || '');
        const st = streams.get(id);
        if (!isId(id) || !st || st.done || st.closed) { res.status(410).json({ success: false, code: 'GONE' }); return; }
        if (!fromDevice(req, st.deviceId)) { res.status(403).json({ success: false, code: 'NOT_THE_DEVICE' }); return; }
        const seq = Number(req.query.seq);
        if (seq !== st.nextSeq) { res.status(409).json({ success: false, code: 'OUT_OF_ORDER', expected: st.nextSeq }); return; }
        let body;
        try {
            body = await readBody(req, MAX_CHUNK_BYTES);
        } catch (error) {
            res.status(413).json({ success: false, code: error.code || 'ERROR' });
            return;
        }
        if (st.done || st.closed) { res.status(410).json({ success: false, code: 'GONE' }); return; }
        st.nextSeq += 1;
        const out = st.res;
        if (!st.headed) {
            st.headed = true;
            const status = Number(req.headers['x-as-status']) === 206 ? 206 : 200;
            const type = String(req.headers['x-as-type'] || 'application/octet-stream').slice(0, 120);
            const length = Number(req.headers['x-as-length']);
            out.status(status);
            out.set('Content-Type', /^[\w.+-]+\/[\w.+-]+/.test(type) ? type : 'application/octet-stream');
            out.set('X-Content-Type-Options', 'nosniff');
            out.set('Accept-Ranges', 'bytes');
            // a file from a phone never runs as a page of this site
            out.set('Content-Security-Policy', "sandbox; default-src 'none'");
            if (Number.isFinite(length) && length >= 0) out.set('Content-Length', String(length));
            if (status === 206 && req.headers['x-as-range']) out.set('Content-Range', String(req.headers['x-as-range']).slice(0, 100));
            const mtime = Number(req.headers['x-as-mtime']);
            if (Number.isFinite(mtime) && mtime > 0) out.set('Last-Modified', new Date(mtime).toUTCString());
            out.set('Cache-Control', req.query.thumb || /[?&]thumb=/.test(out.req.url) ? 'private, max-age=300' : 'private, no-store');
            if (out.req.query.download) {
                const name = cleanName(decodeURIComponent(String(out.req.params[0] || '').split('/').pop() || 'file')) || 'file';
                out.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
            }
        }
        const end = req.query.end === '1';
        const done = () => {
            if (end) { out.end(); st.finish(); } else st.arm(IDLE_TIMEOUT_MS);
            res.json({ success: true });
        };
        if (!body.length) { done(); return; }
        // answered once the desktop took it: the phone's next chunk waits for a slow reader
        if (out.write(body)) done(); else out.once('drain', done);
    });

    // ---------------------------------------------------------------- desktop -> phone

    app.post('/api/activesync/upload/:deviceId/begin', auth, (req, res) => {
        if (!isAdmin(req)) { refuse(res, 403, 'INSUFFICIENT_PERMISSIONS', 'Admin access required'); return; }
        const deviceId = String(req.params.deviceId || '').toLowerCase();
        const b = req.body && typeof req.body === 'object' ? req.body : {};
        const size = Number(b.size);
        const name = cleanName(b.name);
        if (!activeSync.isPeerId(deviceId)) { refuse(res, 400, 'BAD_DEVICE', 'deviceId is not valid'); return; }
        if (!name || !Number.isFinite(size) || size < 0) { refuse(res, 400, 'BAD_FILE', 'name and size are required'); return; }
        if (size > MAX_UPLOAD_BYTES) { refuse(res, 413, 'TOO_LARGE', 'The file is too large.'); return; }
        const id = isId(b.id) && !readMeta(globalResources, b.id) ? b.id : crypto.randomBytes(16).toString('hex');
        const meta = {
            id, deviceId, name, size, received: 0, created: Date.now(), committed: false,
            root: String(b.root || '').slice(0, 64), dir: String(b.dir || '/').slice(0, 2048),
            conflict: ['fail', 'replace', 'rename'].includes(b.conflict) ? b.conflict : 'fail',
            mtime: Number.isFinite(Number(b.mtime)) && Number(b.mtime) > 0 ? Number(b.mtime) : null
        };
        try {
            fs.writeFileSync(dataPath(globalResources, id), Buffer.alloc(0));
            writeMeta(globalResources, meta);
        } catch (error) {
            refuse(res, 500, 'IO', error.message);
            return;
        }
        res.json({ success: true, id, chunkSize: UPLOAD_CHUNK_BYTES, received: 0 });
    });

    app.post('/api/activesync/upload/:id/chunk', auth, async (req, res) => {
        if (!isAdmin(req)) { refuse(res, 403, 'INSUFFICIENT_PERMISSIONS', 'Admin access required'); return; }
        const meta = readMeta(globalResources, req.params.id);
        if (!meta || meta.committed) { refuse(res, 404, 'NOT_FOUND', 'No such upload'); return; }
        const offset = Number(req.query.offset);
        // a resent chunk after a lost answer: say where the file stands, write nothing twice
        if (offset !== meta.received) { res.status(409).json({ success: false, code: 'OFFSET', received: meta.received }); return; }
        let body;
        try {
            body = await readBody(req, MAX_CHUNK_BYTES);
        } catch (error) {
            refuse(res, 413, error.code || 'ERROR', error.message);
            return;
        }
        if (meta.received + body.length > meta.size) { refuse(res, 400, 'TOO_MUCH', 'More bytes than the file has'); return; }
        try {
            fs.appendFileSync(dataPath(globalResources, meta.id), body);
            meta.received += body.length;
            writeMeta(globalResources, meta);
        } catch (error) {
            refuse(res, 500, 'IO', error.message);
            return;
        }
        res.json({ success: true, received: meta.received });
    });

    app.post('/api/activesync/upload/:id/commit', auth, async (req, res) => {
        if (!isAdmin(req)) { refuse(res, 403, 'INSUFFICIENT_PERMISSIONS', 'Admin access required'); return; }
        const meta = readMeta(globalResources, req.params.id);
        if (!meta || meta.committed) { refuse(res, 404, 'NOT_FOUND', 'No such upload'); return; }
        if (meta.received !== meta.size) { res.status(409).json({ success: false, code: 'INCOMPLETE', received: meta.received }); return; }
        meta.committed = true;
        writeMeta(globalResources, meta);
        const args = { transferId: meta.id, root: meta.root, dir: meta.dir, name: meta.name, size: meta.size, conflict: meta.conflict, mtime: meta.mtime };
        const wantQueue = !!(req.body && req.body.queue);
        const wantInstall = !!(req.body && req.body.install);
        if (wantInstall && !/\.apk$/i.test(meta.name)) { refuse(res, 400, 'NOT_APK', 'Only an .apk can be installed'); return; }
        // a program lands under its own name (a newer build replaces the last one sent), so the queued
        // install finds it where the queued copy put it
        if (wantInstall) args.conflict = 'replace';
        if (wantInstall) {
            // the program straight from here over ADB; adb install wants a name ending in .apk
            const src = dataPath(globalResources, meta.id);
            const apk = `${src}.apk`;
            const viaAdb = await adbInstall(globalResources, meta.deviceId, async (deviceAdb) => {
                try { fs.unlinkSync(apk); } catch (_) { /* none */ }
                fs.linkSync(src, apk);
                try { return await deviceAdb.install(globalResources, meta.deviceId, apk); } finally { try { fs.unlinkSync(apk); } catch (_) { /* gone */ } }
            });
            if (viaAdb) {
                removeUpload(globalResources, meta.id);
                res.json({ success: true, entry: null, install: viaAdb });
                return;
            }
        }
        const online = activeSync.deviceOnline(globalResources, wsServer(), meta.deviceId);
        const filePath = `${String(meta.dir || '/').replace(/\/+$/, '')}/${meta.name}`;
        try {
            if (!online && wantQueue) {
                activeSync.queueFor(globalResources, wsServer(), meta.deviceId, 'stream.receive', args);
                if (wantInstall) activeSync.queueFor(globalResources, wsServer(), meta.deviceId, 'apps.install', { root: meta.root, path: filePath });
                res.json({ success: true, queued: true, install: wantInstall ? 'queued' : undefined });
                return;
            }
            // the phone pulls at its own pace: an hour per GB is generous on any link
            const timeoutMs = Math.max(120000, Math.ceil(meta.size / (1024 * 1024 * 1024)) * 3600 * 1000);
            const entry = await activeSync.serverCall(globalResources, wsServer(), meta.deviceId, 'stream.receive', args, { timeoutMs, maxTimeoutMs: SEND_CALL_TIMEOUT_MS });
            removeUpload(globalResources, meta.id);
            let install;
            if (wantInstall) {
                const at = (entry && entry.path) || filePath;
                try {
                    install = await activeSync.serverCall(globalResources, wsServer(), meta.deviceId, 'apps.install', { root: meta.root, path: at }, { timeoutMs: 30000 });
                } catch (error) {
                    install = { state: 'failed', code: error.code || 'ERROR', error: error.message };
                }
            }
            res.json({ success: true, entry: entry == null ? null : entry, install });
        } catch (error) {
            removeUpload(globalResources, meta.id);
            refuse(res, statusOf(error.code), error.code || 'ERROR', error.message);
        }
    });

    // an .apk already on the phone: Android's installer, or a tap-to-install notification (#795)
    app.post('/api/activesync/install/:deviceId', auth, async (req, res) => {
        if (!isAdmin(req)) { refuse(res, 403, 'INSUFFICIENT_PERMISSIONS', 'Admin access required'); return; }
        const deviceId = String(req.params.deviceId || '').toLowerCase();
        const root = String((req.body && req.body.root) || 'internal');
        const p = String((req.body && req.body.path) || '');
        if (!/\.apk$/i.test(p)) { refuse(res, 400, 'NOT_APK', 'Only an .apk can be installed'); return; }
        const viaAdb = await adbInstall(globalResources, deviceId, (deviceAdb) => deviceAdb.installOnPhone(globalResources, deviceId, root, p));
        if (viaAdb) { res.json({ success: true, install: viaAdb }); return; }
        try {
            const online = activeSync.deviceOnline(globalResources, wsServer(), deviceId);
            if (!online && req.body && req.body.queue) {
                activeSync.queueFor(globalResources, wsServer(), deviceId, 'apps.install', { root, path: p });
                res.json({ success: true, queued: true });
                return;
            }
            res.json({ success: true, install: await activeSync.serverCall(globalResources, wsServer(), deviceId, 'apps.install', { root, path: p }, { timeoutMs: 30000 }) });
        } catch (error) {
            refuse(res, statusOf(error.code), error.code || 'ERROR', error.message);
        }
    });

    app.delete('/api/activesync/upload/:id', auth, (req, res) => {
        if (!isAdmin(req)) { refuse(res, 403, 'INSUFFICIENT_PERMISSIONS', 'Admin access required'); return; }
        const meta = readMeta(globalResources, req.params.id);
        if (meta && !meta.committed) removeUpload(globalResources, meta.id);
        res.json({ success: true });
    });

    app.get('/api/activesync/transfer/:id/data', auth, (req, res) => {
        const meta = readMeta(globalResources, req.params.id);
        if (!meta || !meta.committed) { refuse(res, 404, 'NOT_FOUND', 'No such transfer'); return; }
        if (!fromDevice(req, meta.deviceId)) { refuse(res, 403, 'NOT_THE_DEVICE', 'Not this device'); return; }
        const m = /^bytes=(\d+)-(\d*)$/.exec(String(req.headers.range || ''));
        const start = m ? Number(m[1]) : 0;
        const end = m && m[2] !== '' ? Math.min(Number(m[2]), meta.size - 1) : meta.size - 1;
        res.set('Cache-Control', 'private, no-store');
        res.set('Content-Type', 'application/octet-stream');
        if (meta.size === 0) { res.status(200).set('Content-Length', '0').end(); return; }
        if (start > end || start >= meta.size) { res.status(416).set('Content-Range', `bytes */${meta.size}`).end(); return; }
        res.status(m ? 206 : 200);
        if (m) res.set('Content-Range', `bytes ${start}-${end}/${meta.size}`);
        res.set('Content-Length', String(end - start + 1));
        const stream = fs.createReadStream(dataPath(globalResources, meta.id), { start, end });
        stream.on('error', () => res.destroy());
        stream.pipe(res);
    });
}

function resetForTests() {
    dir = null;
    for (const st of streams.values()) clearTimeout(st.timer);
    streams.clear();
    waiting.clear();
    active.clear();
}

module.exports = { mount, sweep, resetForTests, UPLOAD_CHUNK_BYTES };
