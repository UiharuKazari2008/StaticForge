/**
 * GET /status/stream (Yozora #431): the server's boot progress as a live NDJSON stream, for
 * clients that found the server booting and wait for it (websocket.js pingHost).
 *
 *   { "type": "status", ...publicStatus }   on every boot change (at most every 150 ms) and a
 *                                           heartbeat every 5 s while the server boots
 *   { "type": "done", ...publicStatus }     when the boot completes; the response then ends
 *
 * A server that is already up answers one "done" line and closes at once, so the stream is
 * also a cheap "are you up" check. publicStatus is modules/serverStartupStatus.js
 * getPublicStatus() plus the extras the caller adds (the same ones as OPTIONS /status).
 * Not compressed (web_server.js skips paths ending in /stream) and not buffered by nginx
 * (X-Accel-Buffering: no).
 */

const serverStartupStatus = require('./serverStartupStatus');

const HEARTBEAT_MS = 5000;
const MIN_INTERVAL_MS = 150;

function handleStatusStream(req, res, getExtra = () => ({})) {
    const snapshot = () => serverStartupStatus.getPublicStatus(getExtra(req) || {});
    res.writeHead(200, {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, no-transform',
        'X-Accel-Buffering': 'no',
        Connection: 'keep-alive'
    });
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    let closed = false;
    let lastSent = 0;
    let pending = null;
    let heartbeat = null;
    let unsubscribe = null;

    const finish = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        if (pending) clearTimeout(pending);
        if (unsubscribe) unsubscribe();
    };

    const write = (type) => {
        if (closed) return;
        res.write(`${JSON.stringify({ type, ...snapshot() })}\n`);
        lastSent = Date.now();
        if (type === 'done') {
            finish();
            res.end();
        }
    };

    const push = () => {
        if (closed) return;
        if (serverStartupStatus.isReady()) {
            write('done');
            return;
        }
        const wait = MIN_INTERVAL_MS - (Date.now() - lastSent);
        if (wait > 0) {
            if (!pending) {
                pending = setTimeout(() => {
                    pending = null;
                    push();
                }, wait);
            }
            return;
        }
        write('status');
    };

    req.on('close', finish);
    res.on('close', finish);

    if (serverStartupStatus.isReady()) {
        write('done');
        return;
    }
    write('status');
    unsubscribe = serverStartupStatus.subscribe(push);
    heartbeat = setInterval(() => push(), HEARTBEAT_MS);
}

module.exports = { handleStatusStream, HEARTBEAT_MS, MIN_INTERVAL_MS };
