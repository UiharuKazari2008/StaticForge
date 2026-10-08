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

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { WebSocket } = require('ws');

const ROOT = path.join(__dirname, '..');
const SITE_ICON_DIR = path.join(ROOT, '.cache', 'site-icons');
const SITE_ICON_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico' };
const ALCHEMY_DEFAULTS = Object.freeze({ jpegQuality: 55, minFps: 10, maxFps: 30, regionQuality: 78 });
const ALCHEMY_MAX_BOOKMARKS = 200;
const ALCHEMY_DOWNLOADS_FOLDER = 'Downloads';
const ALCHEMY_SAVE_MAX_BYTES = 512 * 1024 * 1024;
const DOWNLOAD_MIME_BY_EXT = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', pdf: 'application/pdf', zip: 'application/zip', json: 'application/json', txt: 'text/plain', mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg' };

function clampInt(value, fallback, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, Math.round(n)));
}

function normalizeAlchemyBookmarks(list) {
    const out = [];
    const seen = new Set();
    for (const row of Array.isArray(list) ? list : []) {
        const url = String((row && row.url) || '').trim();
        if (!/^(https?|chrome):\/\/\S+$/i.test(url) || seen.has(url)) continue;
        seen.add(url);
        out.push({ url: url.slice(0, 2000), title: String((row && row.title) || url).replace(/\s+/g, ' ').trim().slice(0, 200) });
        if (out.length >= ALCHEMY_MAX_BOOKMARKS) break;
    }
    return out;
}

/** userGlobalSettings.alchemy: stream settings and bookmarks (modules/websocketHandlers.js). */
function normalizeAlchemySettings(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const out = {
        jpegQuality: clampInt(src.jpegQuality, ALCHEMY_DEFAULTS.jpegQuality, 30, 90),
        minFps: clampInt(src.minFps, ALCHEMY_DEFAULTS.minFps, 1, 30),
        maxFps: clampInt(src.maxFps, ALCHEMY_DEFAULTS.maxFps, 5, 60),
        regionQuality: clampInt(src.regionQuality, ALCHEMY_DEFAULTS.regionQuality, 30, 90),
        audioEnabled: src.audioEnabled !== false,
        audioVolume: clampInt(src.audioVolume, 100, 0, 100),
        audioBackground: src.audioBackground === true,
        bookmarks: normalizeAlchemyBookmarks(src.bookmarks)
    };
    if (out.minFps > out.maxFps) out.minFps = out.maxFps;
    return out;
}

function mergeAlchemySettingsPatch(existing, patch) {
    return normalizeAlchemySettings({ ...normalizeAlchemySettings(existing), ...(patch && typeof patch === 'object' ? patch : {}) });
}

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
    const userSettings = fileConfig && fileConfig.userGlobalSettings;
    return {
        origin,
        token,
        enabled: !!(origin && token),
        alchemy: normalizeAlchemySettings(userSettings && userSettings.alchemy)
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
    // An unhandled 'error' (service down, ECONNREFUSED) crashes Dreamscape; 'close' follows and cleans up.
    ws.on('error', () => {});
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
        const popup = !!(req.body && req.body.popup);
        const { bookmarks, audioEnabled, audioVolume, audioBackground, ...settings } = config.alchemy;
        try {
            const upstream = await serviceFetch(config, '/sessions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url, width, height, popup, settings })
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

    app.get('/api/grimoire-browser/extensions', authMiddleware, async (req, res) => {
        const config = grimoireBrowserConfig();
        if (!config.enabled) {
            res.status(503).json({ error: 'remote browser is not configured' });
            return;
        }
        try {
            const upstream = await serviceFetch(config, '/extensions', { method: 'GET' });
            const payload = await upstream.json().catch(() => ({}));
            res.status(upstream.ok ? 200 : upstream.status).json(upstream.ok ? { extensions: payload.extensions || [] } : { error: 'remote browser could not list extensions' });
        } catch (_) {
            res.status(502).json({ error: 'remote browser unreachable' });
        }
    });

    app.post('/api/grimoire-browser/restart', authMiddleware, async (req, res) => {
        const config = grimoireBrowserConfig();
        if (!config.enabled) {
            res.status(503).json({ error: 'remote browser is not configured' });
            return;
        }
        try {
            const upstream = await serviceFetch(config, '/browser/restart', { method: 'POST' });
            res.status(upstream.ok ? 200 : upstream.status).json(upstream.ok ? { ok: true } : { error: 'remote browser could not restart' });
        } catch (_) {
            res.status(502).json({ error: 'remote browser unreachable' });
        }
    });

    // Best page icon saved under .cache/site-icons (served by /cache) so the shortcut outlives the session.
    app.get('/api/grimoire-browser/sessions/:id/page-icon', authMiddleware, async (req, res) => {
        const config = grimoireBrowserConfig();
        const id = String(req.params.id || '');
        const token = String(req.query.t || '');
        if (!config.enabled || !sessionIdOk(id) || !token) {
            res.status(config.enabled ? 400 : 503).json({ error: 'bad session' });
            return;
        }
        const base = config.origin + '/sessions/' + id;
        const query = '?t=' + encodeURIComponent(token);
        try {
            const infoRes = await fetch(base + '/page-info' + query);
            const info = await infoRes.json().catch(() => ({}));
            if (!infoRes.ok) {
                res.status(infoRes.status).json({ error: info.error || 'page info failed' });
                return;
            }
            let icon = '';
            for (const href of Array.isArray(info.icons) ? info.icons : []) {
                const fileRes = await fetch(base + '/resource' + query + '&url=' + encodeURIComponent(href)).catch(() => null);
                if (!fileRes || !fileRes.ok) continue;
                const type = String(fileRes.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
                const ext = SITE_ICON_TYPES[type];
                const bytes = ext ? Buffer.from(await fileRes.arrayBuffer()) : null;
                if (!bytes || !bytes.length || bytes.length > 2 * 1024 * 1024) continue;
                const name = crypto.createHash('sha1').update(bytes).digest('hex') + '.' + ext;
                await fs.promises.mkdir(SITE_ICON_DIR, { recursive: true });
                await fs.promises.writeFile(path.join(SITE_ICON_DIR, name), bytes);
                icon = '/cache/site-icons/' + name;
                break;
            }
            res.json({ url: info.url || '', title: info.title || '', icon });
        } catch (_) {
            res.status(502).json({ error: 'remote browser unreachable' });
        }
    });

    // A page download (body.download = guid) or a page resource (body.url) goes into that workspace's Downloads,
    // a normal VFS folder made on first use, so list, open, move, and trash work like any other folder.
    app.post('/api/grimoire-browser/sessions/:id/save', authMiddleware, async (req, res) => {
        const config = grimoireBrowserConfig();
        const id = String(req.params.id || '');
        const token = String(req.query.t || '');
        const body = req.body || {};
        const guid = String(body.download || '');
        const url = String(body.url || '');
        if (!config.enabled || !sessionIdOk(id) || !token || (!guid && !url) || (guid && !/^[A-Za-z0-9-]{8,80}$/.test(guid))) {
            res.status(config.enabled ? 400 : 503).json({ error: 'bad save' });
            return;
        }
        // globalResources is loaded lazily so scripts/test-grimoire-browser.js can mount this bridge alone
        const globalResources = require('./globalResources');
        const workspaceId = String(body.workspaceId || '');
        if (!globalResources.getWorkspaceManager().getWorkspaces()[workspaceId]) {
            res.status(400).json({ error: 'unknown workspace' });
            return;
        }
        const query = '?t=' + encodeURIComponent(token);
        const suffix = guid ? '/downloads/' + guid + query : '/resource' + query + '&url=' + encodeURIComponent(url);
        try {
            const upstream = await fetch(config.origin + '/sessions/' + id + suffix);
            if (!upstream.ok) {
                res.status(upstream.status).json({ error: 'remote browser could not read the file' });
                return;
            }
            const buffer = Buffer.from(await upstream.arrayBuffer());
            if (!buffer.length || buffer.length > ALCHEMY_SAVE_MAX_BYTES) {
                res.status(413).json({ error: 'file is empty or too large' });
                return;
            }
            const name = path.basename(String(body.filename || 'download')).replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_').slice(0, 200) || 'download';
            const ext = (name.match(/\.([a-z0-9]+)$/i) || [])[1] || '';
            const upstreamType = String(upstream.headers.get('content-type') || '').split(';')[0].trim();
            const mimeType = upstreamType && upstreamType !== 'application/octet-stream'
                ? upstreamType
                : (DOWNLOAD_MIME_BY_EXT[ext.toLowerCase()] || 'application/octet-stream');
            const vfs = globalResources.getVfsManager();
            const folder = await vfs._findWorkspaceFolderByName(workspaceId, null, ALCHEMY_DOWNLOADS_FOLDER, { excludeDesktop: true })
                || await vfs.createFolderAtPath('/Workspaces/' + workspaceId, ALCHEMY_DOWNLOADS_FOLDER);
            const file = await vfs.saveUserFileBuffer(buffer, { originalName: name, mimeType, scope: 'workspace', workspaceId, folderId: folder.id });
            const folderPath = '/Workspaces/' + workspaceId + '/' + folder.id;
            const wsServer = globalResources.getWebSocketServer();
            if (wsServer && wsServer.broadcast) wsServer.broadcast({ type: 'vfs_updated', data: { path: folderPath }, timestamp: new Date().toISOString() });
            res.json({ ok: true, name, path: folderPath, fileId: file && file.id });
        } catch (err) {
            if (!res.headersSent) res.status(502).json({ error: (err && err.message) || 'save failed' });
        }
    });

    // Live Ogg Opus with no timeout; closing the viewer's audio element aborts the upstream (and its ffmpeg).
    app.get('/api/grimoire-browser/sessions/:id/audio', authMiddleware, async (req, res) => {
        const config = grimoireBrowserConfig();
        const id = String(req.params.id || '');
        const token = String(req.query.t || '');
        if (!config.enabled || !sessionIdOk(id) || !token) {
            res.status(config.enabled ? 400 : 503).json({ error: 'bad session' });
            return;
        }
        const controller = new AbortController();
        res.on('close', () => controller.abort());
        try {
            const upstream = await fetch(config.origin + '/sessions/' + id + '/audio?t=' + encodeURIComponent(token), { signal: controller.signal });
            if (!upstream.ok || !upstream.body) {
                res.status(upstream.status || 502).json({ error: 'no audio' });
                return;
            }
            res.writeHead(200, { 'Content-Type': 'audio/ogg', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
            for await (const chunk of upstream.body) {
                if (res.writableEnded) break;
                res.write(chunk);
            }
        } catch (_) {
            if (!res.headersSent) res.status(502).json({ error: 'remote browser unreachable' });
        }
        if (!res.writableEnded) res.end();
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
    mountGrimoireBrowserBridge,
    normalizeAlchemySettings,
    mergeAlchemySettingsPatch
};
