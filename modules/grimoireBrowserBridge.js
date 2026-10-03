'use strict';

/**
 * Dreamscape side of the Grimoire remote browser.
 * The Chromium process is services/grimoire-browser and may be another host.
 * This module only creates and deletes sessions. The client iframes viewUrl.
 *
 * Origin: GRIMOIRE_BROWSER_ORIGIN, else config.json grimoireBrowser.origin
 * Token:  GRIMOIRE_BROWSER_TOKEN, else secure.config.json grimoireBrowserToken,
 *         else config.json grimoireBrowser.token
 */

const fs = require('fs');
const path = require('path');
const { WebSocket } = require('ws');

const ROOT = path.join(__dirname, '..');

function readJson(file) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (_) {
        return null;
    }
}

function grimoireBrowserConfig() {
    const fileConfig = readJson(path.join(ROOT, 'config.json'));
    const secure = readJson(path.join(ROOT, 'secure.config.json'));
    const block = fileConfig && fileConfig.grimoireBrowser && typeof fileConfig.grimoireBrowser === 'object'
        ? fileConfig.grimoireBrowser
        : {};
    const origin = String(process.env.GRIMOIRE_BROWSER_ORIGIN || block.origin || '').replace(/\/+$/, '');
    const token = String(
        process.env.GRIMOIRE_BROWSER_TOKEN
        || (secure && secure.grimoireBrowserToken)
        || block.token
        || ''
    );
    return {
        origin,
        token,
        enabled: !!(origin && token)
    };
}

async function serviceFetch(config, pathname, options) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
        return await fetch(config.origin + pathname, {
            ...options,
            signal: controller.signal,
            headers: {
                Authorization: 'Bearer ' + config.token,
                ...(options && options.headers)
            }
        });
    } finally {
        clearTimeout(timer);
    }
}

const relays = new Map();

function sessionIdOk(id) {
    return /^[a-f0-9]{32}$/.test(String(id || ''));
}

function upstreamWebSocketUrl(config, id, token) {
    const wsOrigin = config.origin.replace(/^http/i, 'ws');
    return wsOrigin + '/sessions/' + id + '/stream?t=' + encodeURIComponent(token);
}

function openRelay(config, id, token) {
    const current = relays.get(id);
    if (current && current.token === token && (current.ws.readyState === 0 || current.ws.readyState === 1)) {
        return current;
    }
    if (current) {
        try { current.ws.close(); } catch (_) {}
        relays.delete(id);
    }
    const ws = new WebSocket(upstreamWebSocketUrl(config, id, token));
    const relay = { ws, token, queue: [], readers: 0 };
    relays.set(id, relay);
    ws.on('open', () => {
        const pending = relay.queue;
        relay.queue = [];
        for (const message of pending) {
            try { ws.send(message); } catch (_) {}
        }
    });
    ws.on('close', () => {
        if (relays.get(id) === relay) relays.delete(id);
    });
    return relay;
}

function sendRelay(relay, payload) {
    const text = JSON.stringify(payload);
    if (relay.ws.readyState === 1) relay.ws.send(text);
    else relay.queue.push(text);
}

function closeRelay(id) {
    const relay = relays.get(id);
    if (!relay) return;
    relays.delete(id);
    try { relay.ws.close(); } catch (_) {}
}

function mountGrimoireBrowserBridge(app, authMiddleware) {
    app.get('/api/grimoire-browser/status', authMiddleware, (req, res) => {
        const config = grimoireBrowserConfig();
        res.json({
            enabled: config.enabled,
            origin: config.enabled ? config.origin : ''
        });
    });

    app.post('/api/grimoire-browser/sessions', authMiddleware, async (req, res) => {
        const config = grimoireBrowserConfig();
        if (!config.enabled) {
            res.status(503).json({ error: 'remote browser is not configured' });
            return;
        }
        const url = req.body && req.body.url;
        const width = req.body && req.body.width;
        const height = req.body && req.body.height;
        try {
            const upstream = await serviceFetch(config, '/sessions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url, width, height })
            });
            const payload = await upstream.json().catch(() => ({}));
            if (!upstream.ok) {
                res.status(upstream.status).json({ error: payload.error || 'remote browser rejected the session' });
                return;
            }
            res.status(201).json({
                sessionId: payload.id,
                viewUrl: '/api/grimoire-browser/view/' + payload.id + '?t=' + encodeURIComponent(payload.viewerToken)
            });
        } catch (err) {
            res.status(502).json({ error: err.name === 'AbortError' ? 'remote browser timed out' : 'remote browser unreachable' });
        }
    });

    app.delete('/api/grimoire-browser/sessions/:id', authMiddleware, async (req, res) => {
        const config = grimoireBrowserConfig();
        if (!config.enabled) {
            res.status(503).json({ error: 'remote browser is not configured' });
            return;
        }
        const id = String(req.params.id || '');
        if (!sessionIdOk(id)) {
            res.status(400).json({ error: 'bad session id' });
            return;
        }
        closeRelay(id);
        try {
            const upstream = await serviceFetch(config, '/sessions/' + id, { method: 'DELETE' });
            if (!upstream.ok && upstream.status !== 404) {
                res.status(upstream.status).json({ error: 'remote browser could not close the session' });
                return;
            }
            res.json({ ok: true });
        } catch (_) {
            res.status(502).json({ error: 'remote browser unreachable' });
        }
    });

    app.get('/api/grimoire-browser/view/:id', authMiddleware, async (req, res) => {
        const config = grimoireBrowserConfig();
        if (!config.enabled) {
            res.status(503).type('text/plain').send('remote browser is not configured');
            return;
        }
        const id = String(req.params.id || '');
        const token = String(req.query.t || '');
        if (!sessionIdOk(id) || !token) {
            res.status(400).type('text/plain').send('bad session');
            return;
        }
        try {
            const upstream = await fetch(config.origin + '/view/' + id + '?t=' + encodeURIComponent(token));
            const html = await upstream.text();
            res.status(upstream.status);
            res.set('Content-Type', 'text/html; charset=utf-8');
            res.set('Cache-Control', 'no-store');
            res.set('Content-Security-Policy', "frame-ancestors 'self'");
            res.send(html);
        } catch (_) {
            res.status(502).type('text/plain').send('remote browser unreachable');
        }
    });

    app.get('/api/grimoire-browser/sessions/:id/frames', authMiddleware, (req, res) => {
        const config = grimoireBrowserConfig();
        if (!config.enabled) {
            res.status(503).json({ error: 'remote browser is not configured' });
            return;
        }
        const id = String(req.params.id || '');
        const token = String(req.query.t || '');
        if (!sessionIdOk(id) || !token) {
            res.status(400).json({ error: 'bad session' });
            return;
        }
        const relay = openRelay(config, id, token);
        relay.readers += 1;
        let closed = false;
        let drainWait = false;
        let pendingFrame = null;
        const pendingControl = [];
        res.writeHead(200, {
            'Content-Type': 'application/x-ndjson; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Accel-Buffering': 'no'
        });
        const flush = () => {
            if (closed || drainWait || res.writableEnded) return;
            while (pendingControl.length) {
                if (!res.write(pendingControl.shift())) {
                    drainWait = true;
                    res.once('drain', () => {
                        drainWait = false;
                        flush();
                    });
                    return;
                }
            }
            if (!pendingFrame) return;
            if (res.writableLength > 256 * 1024) {
                pendingFrame = null;
                return;
            }
            const bytes = pendingFrame;
            pendingFrame = null;
            const line = JSON.stringify({ type: 'frame', data: bytes.toString('base64') }) + '\n';
            if (!res.write(line)) {
                drainWait = true;
                res.once('drain', () => {
                    drainWait = false;
                    flush();
                });
            }
        };
        const onMessage = (data, isBinary) => {
            if (closed || res.writableEnded) return;
            if (isBinary) pendingFrame = Buffer.isBuffer(data) ? data : Buffer.from(data);
            else pendingControl.push(String(data) + '\n');
            flush();
        };
        const finish = () => {
            if (closed) return;
            closed = true;
            relay.ws.off('message', onMessage);
            relay.ws.off('close', finish);
            relay.ws.off('error', finish);
            relay.readers -= 1;
            if (relay.readers <= 0) closeRelay(id);
            if (!res.writableEnded) res.end();
        };
        relay.ws.on('message', onMessage);
        relay.ws.on('close', finish);
        relay.ws.on('error', finish);
        res.on('close', finish);
    });

    app.post('/api/grimoire-browser/sessions/:id/input', authMiddleware, (req, res) => {
        const config = grimoireBrowserConfig();
        if (!config.enabled) {
            res.status(503).json({ error: 'remote browser is not configured' });
            return;
        }
        const id = String(req.params.id || '');
        const token = String(req.query.t || '');
        if (!sessionIdOk(id) || !token || !req.body || typeof req.body !== 'object') {
            res.status(400).json({ error: 'bad input' });
            return;
        }
        const relay = openRelay(config, id, token);
        sendRelay(relay, req.body);
        res.json({ ok: true });
    });

    app.get('/api/grimoire-browser/sessions/:id/resource', authMiddleware, async (req, res) => {
        await proxySessionFile(req, res, '/resource?t=' + encodeURIComponent(String(req.query.t || '')) + '&url=' + encodeURIComponent(String(req.query.url || '')));
    });

    app.get('/api/grimoire-browser/sessions/:id/downloads/:guid', authMiddleware, async (req, res) => {
        const guid = String(req.params.guid || '');
        if (!/^[A-Za-z0-9-]{8,80}$/.test(guid)) {
            res.status(400).json({ error: 'bad download' });
            return;
        }
        await proxySessionFile(req, res, '/downloads/' + guid + '?t=' + encodeURIComponent(String(req.query.t || '')));
    });
}

async function proxySessionFile(req, res, suffix) {
    const config = grimoireBrowserConfig();
    if (!config.enabled) {
        res.status(503).json({ error: 'remote browser is not configured' });
        return;
    }
    const id = String(req.params.id || '');
    const token = String(req.query.t || '');
    if (!sessionIdOk(id) || !token) {
        res.status(400).json({ error: 'bad session' });
        return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    try {
        const upstream = await fetch(config.origin + '/sessions/' + id + suffix, { signal: controller.signal });
        if (!upstream.ok) {
            res.status(upstream.status).json({ error: 'remote browser could not read the file' });
            return;
        }
        res.status(200);
        res.set('Content-Type', upstream.headers.get('content-type') || 'application/octet-stream');
        res.set('Content-Disposition', upstream.headers.get('content-disposition') || 'attachment');
        res.set('Cache-Control', 'no-store');
        res.send(Buffer.from(await upstream.arrayBuffer()));
    } catch (_) {
        if (!res.headersSent) res.status(502).json({ error: 'remote browser unreachable' });
    } finally {
        clearTimeout(timer);
    }
}

module.exports = {
    grimoireBrowserConfig,
    mountGrimoireBrowserBridge
};
