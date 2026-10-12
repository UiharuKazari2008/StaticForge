/**
 * Bind the HTTP port at the very top of web_server.js (Yozora #431), before the ~2–3 s of
 * module loading and route setup. Requests that arrive meanwhile wait in the listen backlog
 * instead of being refused, and are answered by the Express app (OPTIONS /status,
 * GET /status/stream) as soon as the event loop turns, so clients see "server booting" from
 * the start of a restart. globalResources.initializeExpressApp({ server }) attaches the app
 * to this server; startWebServer() just waits for the bind.
 *
 * The port comes straight from config.json (the full config loads later). EADDRINUSE (the old
 * process still releasing the port during a pm2 restart) retries every 250 ms for 10 s; any
 * other failure leaves the server unbound and startWebServer() binds it the usual way.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const RETRY_MS = 250;
const MAX_ATTEMPTS = 40;

function readConfiguredPort(root) {
    try {
        const config = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
        const port = Number(config && config.port);
        return Number.isInteger(port) && port > 0 ? port : null;
    } catch (_) {
        return null;
    }
}

function bindEarly(root) {
    const server = http.createServer((req, res) => {
        // Only reachable if a request lands before the app is attached (not normally possible:
        // the attach happens in the same tick as module loading)
        res.writeHead(503, { 'Content-Type': 'application/json', 'Retry-After': '1' });
        res.end(JSON.stringify({ success: false, error: 'Server starting', isReady: false, stage: 'loading_modules' }));
    });
    const port = readConfiguredPort(root);
    server.earlyPort = port;
    if (!port) {
        server.earlyListen = Promise.resolve(false);
        return server;
    }
    server.earlyListen = new Promise((resolve) => {
        let attempts = 0;
        const onError = (error) => {
            if (error && error.code === 'EADDRINUSE' && ++attempts < MAX_ATTEMPTS) {
                setTimeout(() => server.listen(port), RETRY_MS);
                return;
            }
            server.removeListener('error', onError);
            console.warn(`⚠️ Early HTTP bind on ${port} failed (${error && error.code ? error.code : error}); binding later`);
            resolve(false);
        };
        server.on('error', onError);
        server.once('listening', () => {
            server.removeListener('error', onError);
            resolve(true);
        });
        server.listen(port);
    });
    return server;
}

module.exports = { bindEarly, readConfiguredPort };
