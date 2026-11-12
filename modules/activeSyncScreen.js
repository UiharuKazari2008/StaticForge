/**
 * ActiveSync remote viewer: a phone's screen for the desktop (Yozora #747).
 *
 * The phone's app captures its screen once its user allowed it (Android's own prompt, after the
 * desktop asked with the screen.start operation) and posts JPEG frames here; the desktop reads
 * them as one never-ending multipart response, which an <img> shows as it arrives. View only.
 *
 *   POST /api/activesync/screen/:deviceId/frame    the phone, in its page's session; body = one JPEG.
 *        -> { viewers } or { stop: true } when nobody has looked for a while (the phone stops).
 *   GET  /api/activesync/screen/:deviceId/stream   an admin desktop: multipart/x-mixed-replace
 *        of the frames, the latest one first when there is one.
 *
 * Only a connected device (guest or partner) with the "screen" permission may post. Nothing is
 * kept: the latest frame lives in memory until the feed ends.
 */
'use strict';

const activeSync = require('./activeSync');

const MAX_FRAME_BYTES = 1500 * 1024;
const UNWATCHED_STOP_MS = 8000;   // frames with no viewer for this long: the phone is told to stop
const STALE_FEED_MS = 20000;      // no frame for this long: the feed is forgotten
const BOUNDARY = 'asframe';

const feeds = new Map(); // deviceId -> { frame, at, viewers:Set<res>, unwatchedSince }

function feedOf(deviceId) {
    let f = feeds.get(deviceId);
    if (!f) {
        f = { frame: null, at: 0, viewers: new Set(), unwatchedSince: Date.now() };
        feeds.set(deviceId, f);
    }
    return f;
}

function writeFrame(res, frame) {
    try {
        res.write(`--${BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`);
        res.write(frame);
        res.write('\r\n');
    } catch (_) { /* the viewer went away; its close event tidies up */ }
}

function readBody(req, limit) {
    return new Promise((resolve, reject) => {
        const parts = [];
        let size = 0;
        req.on('data', (c) => {
            size += c.length;
            if (size > limit) { reject(Object.assign(new Error('The frame is too large.'), { code: 'TOO_LARGE' })); req.destroy(); return; }
            parts.push(c);
        });
        req.on('end', () => resolve(Buffer.concat(parts)));
        req.on('error', reject);
    });
}

function mount(app, authMiddleware, globalResources) {
    const auth = authMiddleware || ((req, res, next) => next());
    const wsServer = () => (typeof globalResources.getWebSocketServer === 'function' ? globalResources.getWebSocketServer() : null);
    const refuse = (res, status, code, error) => { if (!res.headersSent) res.status(status).json({ success: false, code, error }); };

    const sweeper = setInterval(() => {
        const now = Date.now();
        for (const [id, f] of feeds) {
            if (!f.viewers.size && now - Math.max(f.at, f.unwatchedSince) > STALE_FEED_MS) feeds.delete(id);
        }
    }, 10000);
    if (sweeper.unref) sweeper.unref();

    app.post('/api/activesync/screen/:deviceId/frame', auth, async (req, res) => {
        const deviceId = String(req.params.deviceId || '').toLowerCase();
        if (!activeSync.isPeerId(deviceId)) { refuse(res, 400, 'BAD_REQUEST', 'Bad device id.'); return; }
        if (!activeSync.isDeviceSession(globalResources, wsServer(), deviceId, req.sessionId || (req.session && req.session.id))) {
            refuse(res, 403, 'NOT_DEVICE', 'Only the device itself sends its screen.'); return;
        }
        if (!activeSync.devicePermits(globalResources, wsServer(), deviceId, 'screen')) {
            refuse(res, 409, 'NOT_PERMITTED', 'No computer may view this screen.'); return;
        }
        let body;
        try { body = await readBody(req, MAX_FRAME_BYTES); } catch (e) { refuse(res, 413, 'TOO_LARGE', e.message); return; }
        if (body.length < 4 || body[0] !== 0xff || body[1] !== 0xd8) { refuse(res, 400, 'BAD_REQUEST', 'Not a JPEG.'); return; }
        const f = feedOf(deviceId);
        f.frame = body;
        f.at = Date.now();
        for (const v of f.viewers) writeFrame(v, body);
        if (f.viewers.size) { res.json({ viewers: f.viewers.size }); return; }
        if (Date.now() - f.unwatchedSince > UNWATCHED_STOP_MS) { feeds.delete(deviceId); res.json({ stop: true }); return; }
        res.json({ viewers: 0 });
    });

    app.get('/api/activesync/screen/:deviceId/stream', auth, (req, res) => {
        if (req.userType !== 'admin') { refuse(res, 403, 'INSUFFICIENT_PERMISSIONS', 'Admin access required'); return; }
        const deviceId = String(req.params.deviceId || '').toLowerCase();
        if (!activeSync.isPeerId(deviceId)) { refuse(res, 400, 'BAD_REQUEST', 'Bad device id.'); return; }
        if (!activeSync.devicePermits(globalResources, wsServer(), deviceId, 'screen')) {
            refuse(res, 409, 'NOT_PERMITTED', 'This device does not share its screen.'); return;
        }
        res.writeHead(200, {
            'Content-Type': `multipart/x-mixed-replace; boundary=${BOUNDARY}`,
            'Cache-Control': 'no-store, no-cache, must-revalidate',
            Pragma: 'no-cache',
            Connection: 'close',
            'X-Accel-Buffering': 'no'
        });
        const f = feedOf(deviceId);
        f.viewers.add(res);
        if (f.frame && Date.now() - f.at < STALE_FEED_MS) writeFrame(res, f.frame);
        const gone = () => {
            if (!f.viewers.delete(res)) return;
            if (!f.viewers.size) f.unwatchedSince = Date.now();
        };
        req.on('close', gone);
        res.on('error', gone);
    });
}

function resetForTests() {
    for (const f of feeds.values()) for (const v of f.viewers) { try { v.destroy(); } catch (_) { /* gone */ } }
    feeds.clear();
}

module.exports = { mount, resetForTests };
