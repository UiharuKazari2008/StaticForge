'use strict';

/**
 * Same-origin bridge for the MeletonFX remote desktop.
 * Komaki (othinus) already logs into Apache Guacamole and lists connections:
 *   /home/kanmi/othinus/server.js  GET /console
 *   POST {origin}/api/tokens
 *   GET  {origin}/api/session/data/{dataSource}/connections
 * The catalog prefers Komaki's LAN API (console_api_server,
 * http://192.168.200.1:8080/guacamole); the public webapp
 * (console_pop_server, https://console.737.jp.net) is the fallback while
 * that port refuses this host. Sessions are Komaki's native Guacamole client
 * served same-origin at /api/desktop-guac/web/ (pages, API, and the
 * websocket-tunnel upgrade), so desktop windows can read the frame's title
 * and route. index.html gains public/scripts/comp/desktop-apps/guacFrameMirror.js,
 * which sends Guacamole's status boxes out to the hosting window.
 *
 * Credentials: GUAC_ORIGIN / GUAC_USERNAME / GUAC_PASSWORD, else config.json
 * guacRemote, else secure.config.json guacUsername/guacPassword, else Komaki's
 * local config.json (console_pop_server, console_username, console_password).
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const KOMAKI_CONFIG = '/home/kanmi/othinus/config.json';
const TOKEN_CHECK_MS = 60 * 1000;

let authCache = null;

function readJson(file) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (_) {
        return null;
    }
}

function hostOf(origin) {
    try {
        const url = new URL(origin);
        const pathName = url.pathname.replace(/\/$/, '');
        return url.host + pathName;
    } catch (_) {
        return 'the configured host';
    }
}

function readGuacConfig() {
    const fileConfig = readJson(path.join(ROOT, 'config.json'));
    const secure = readJson(path.join(ROOT, 'secure.config.json'));
    const block = fileConfig && fileConfig.guacRemote && typeof fileConfig.guacRemote === 'object'
        ? fileConfig.guacRemote
        : {};
    const komaki = readJson(KOMAKI_CONFIG) || {};
    const localOrigin = String(komaki.console_api_server || '').replace(/\/+$/, '');
    const publicOrigin = String(komaki.console_pop_server || '').replace(/\/+$/, '');
    const explicit = String(process.env.GUAC_ORIGIN || block.origin || '').replace(/\/+$/, '');
    const origin = explicit || localOrigin || publicOrigin;
    const fallbackOrigin = (!explicit && localOrigin && publicOrigin && origin === localOrigin)
        ? publicOrigin
        : '';
    const username = String(
        process.env.GUAC_USERNAME
        || (secure && secure.guacUsername)
        || block.username
        || komaki.console_username
        || ''
    );
    const password = String(
        process.env.GUAC_PASSWORD
        || (secure && secure.guacPassword)
        || block.password
        || komaki.console_password
        || ''
    );
    const missing = [];
    if (!origin) {
        missing.push('Guacamole origin (GUAC_ORIGIN, config.json guacRemote.origin, or Komaki console_api_server)');
    }
    if (!username) {
        missing.push('Guacamole username (GUAC_USERNAME, secure.config.json guacUsername, or Komaki console_username)');
    }
    if (!password) {
        missing.push('Guacamole password (GUAC_PASSWORD, secure.config.json guacPassword, or Komaki console_password)');
    }
    return {
        origin: origin,
        fallbackOrigin: fallbackOrigin,
        username: username,
        password: password,
        configured: missing.length === 0,
        missing: missing.length
            ? 'Guacamole catalog is not configured. Missing ' + missing.join('; ') + '.'
            : ''
    };
}

function fail(status, message) {
    const err = new Error(message);
    err.status = status;
    return err;
}

async function loginAt(origin, username, password) {
    const body = new URLSearchParams({ username: username, password: password });
    let response;
    try {
        response = await fetch(origin + '/api/tokens', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body,
            signal: AbortSignal.timeout(12000)
        });
    } catch (_) {
        throw fail(502, 'Guacamole at ' + hostOf(origin) + ' is unreachable');
    }
    if (!response.ok) {
        throw fail(502, 'Guacamole login at ' + hostOf(origin) + ' failed (HTTP ' + response.status + ')');
    }
    const data = await response.json().catch(() => null);
    if (!data || !data.authToken || !data.dataSource) {
        throw fail(502, 'Guacamole login at ' + hostOf(origin) + ' returned no session');
    }
    return {
        token: data.authToken,
        dataSource: String(data.dataSource),
        origin: origin,
        catalog: new Map(),
        checked: Date.now()
    };
}

async function tokenAlive(auth) {
    try {
        const response = await fetch(auth.origin + '/api/session/tunnels', {
            headers: { 'Guacamole-Token': auth.token },
            signal: AbortSignal.timeout(8000)
        });
        return response.ok;
    } catch (_) {
        return false;
    }
}

// Every iframe shares this one token. Komaki's webapp revokes the token in its
// localStorage when a frame arrives with a different one
// (authenticationService.authenticate), so a new login drops open sessions.
// Keep the token while Guacamole still accepts it.
async function ensureAuth(force) {
    const config = readGuacConfig();
    if (!config.configured) throw fail(503, config.missing);
    const usable = authCache
        && (authCache.origin === config.origin || authCache.origin === config.fallbackOrigin);
    if (!force && usable) {
        if (authCache.checked > Date.now() - TOKEN_CHECK_MS) return authCache;
        if (await tokenAlive(authCache)) {
            authCache.checked = Date.now();
            return authCache;
        }
    }
    try {
        authCache = await loginAt(config.origin, config.username, config.password);
    } catch (err) {
        if (!config.fallbackOrigin) throw err;
        authCache = await loginAt(config.fallbackOrigin, config.username, config.password);
    }
    return authCache;
}

function publicConnection(row) {
    if (!row || typeof row !== 'object') return null;
    const id = String(row.identifier || row.id || '');
    const name = String(row.name || id);
    if (!id || !name) return null;
    return {
        id: id,
        name: name,
        protocol: String(row.protocol || '')
    };
}

async function listGuacConnections() {
    const auth = await ensureAuth(false);
    const url = auth.origin + '/api/session/data/' + encodeURIComponent(auth.dataSource) + '/connections';
    let response;
    try {
        response = await fetch(url, {
            headers: { 'Guacamole-Token': auth.token },
            signal: AbortSignal.timeout(12000)
        });
    } catch (_) {
        throw fail(502, 'Guacamole at ' + hostOf(auth.origin) + ' is unreachable');
    }
    if (response.status === 403) {
        authCache = null;
        const retry = await ensureAuth(true);
        response = await fetch(
            retry.origin + '/api/session/data/' + encodeURIComponent(retry.dataSource) + '/connections',
            {
                headers: { 'Guacamole-Token': retry.token },
                signal: AbortSignal.timeout(12000)
            }
        );
    }
    if (!response.ok) {
        throw fail(502, 'Guacamole connection list failed (HTTP ' + response.status + ')');
    }
    const data = await response.json().catch(() => null);
    const rows = Array.isArray(data) ? data : (data && typeof data === 'object' ? Object.values(data) : []);
    const connections = rows.map(publicConnection).filter(Boolean);
    connections.sort((a, b) => a.name.localeCompare(b.name));
    const current = authCache || auth;
    current.catalog = new Map(connections.map((row) => [row.id, row]));
    return {
        ok: true,
        connections: connections
    };
}

const GUAC_WEB_PATH = '/api/desktop-guac/web';
const GUAC_DROP_REQUEST_HEADERS = ['cookie', 'authorization', 'host', 'connection', 'content-length', 'accept-encoding'];
// Must load after Guacamole's own scripts and before Angular boots on DOMContentLoaded
const GUAC_FRAME_SCRIPT_NAME = 'dreamscape-frame.js';
const GUAC_FRAME_SCRIPT_TAG = '<script src="' + GUAC_FRAME_SCRIPT_NAME + '"></script></body>';
const GUAC_FRAME_SCRIPT_FILE = path.join(__dirname, '..', 'public', 'scripts', 'comp', 'desktop-apps', 'guacFrameMirror.js');

// Client ids are base64url(id \0 type \0 dataSource), unpadded
// (Komaki's guacamole.js ClientIdentifier.toString). The token rides in the
// hash like Othinus /console, so it never reaches a request log.
async function guacSessionUrl(id) {
    let auth = await ensureAuth(false);
    if (!auth.catalog.has(id)) {
        await listGuacConnections();
        auth = authCache;
        if (!auth.catalog.has(id)) {
            throw fail(404, 'That connection is not in the Komaki list');
        }
    }
    const clientId = Buffer.from([id, 'c', auth.dataSource].join('\0')).toString('base64url');
    return GUAC_WEB_PATH + '/#/client/' + clientId + '?token=' + encodeURIComponent(auth.token);
}

async function guacHomeUrl() {
    const auth = await ensureAuth(false);
    return GUAC_WEB_PATH + '/#/?token=' + encodeURIComponent(auth.token);
}

// express.json / express.urlencoded (web_server.js) already drained the body.
function proxiedBody(req) {
    if (!req._body) return null;
    const type = String(req.headers['content-type'] || '');
    if (type.includes('application/json')) return Buffer.from(JSON.stringify(req.body));
    const form = new URLSearchParams();
    Object.entries(req.body || {}).forEach(([key, value]) => {
        (Array.isArray(value) ? value : [value]).forEach((item) => form.append(key, String(item)));
    });
    return Buffer.from(form.toString());
}

function upstreamTarget(auth, rest) {
    const base = new URL(auth.origin);
    return {
        client: base.protocol === 'https:' ? https : http,
        options: {
            protocol: base.protocol,
            hostname: base.hostname,
            port: base.port || (base.protocol === 'https:' ? 443 : 80),
            path: base.pathname.replace(/\/+$/, '') + rest
        },
        host: base.host,
        basePath: base.pathname.replace(/\/+$/, '')
    };
}

function forwardHeaders(req, host) {
    const headers = {};
    Object.entries(req.headers).forEach(([key, value]) => {
        if (!GUAC_DROP_REQUEST_HEADERS.includes(key)) headers[key] = value;
    });
    headers.host = host;
    return headers;
}

async function proxyGuacWeb(req, res) {
    let auth;
    try {
        auth = await ensureAuth(false);
    } catch (err) {
        res.status(err.status || 502).type('text/plain').send(err.message || 'Guacamole is unavailable');
        return;
    }
    const target = upstreamTarget(auth, req.url === '/' ? '/' : req.url);
    const headers = forwardHeaders(req, target.host);
    const isIndex = req.method === 'GET' && (req.path === '/' || req.path === '/index.html');
    if (isIndex) {
        delete headers['if-none-match'];
        delete headers['if-modified-since'];
    }
    const body = proxiedBody(req);
    if (body) headers['content-length'] = String(body.length);
    else if (req.headers['content-length']) headers['content-length'] = req.headers['content-length'];
    const upstream = target.client.request({ ...target.options, method: req.method, headers: headers }, (upstreamRes) => {
        const location = upstreamRes.headers.location;
        if (location) {
            upstreamRes.headers.location = String(location)
                .replace(auth.origin, GUAC_WEB_PATH)
                .replace(new RegExp('^' + target.basePath + '(?=/|$)'), GUAC_WEB_PATH);
        }
        delete upstreamRes.headers['set-cookie'];
        if (isIndex && String(upstreamRes.headers['content-type'] || '').includes('text/html')) {
            const chunks = [];
            upstreamRes.on('data', (chunk) => chunks.push(chunk));
            upstreamRes.on('end', () => {
                const html = Buffer.from(Buffer.concat(chunks).toString('utf8').replace('</body>', GUAC_FRAME_SCRIPT_TAG));
                const out = { ...upstreamRes.headers, 'content-length': String(html.length) };
                delete out.etag;
                delete out['last-modified'];
                delete out['transfer-encoding'];
                res.writeHead(upstreamRes.statusCode || 200, out);
                res.end(html);
            });
            return;
        }
        res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
        upstreamRes.pipe(res);
    });
    upstream.on('error', () => {
        if (!res.headersSent) res.status(502).type('text/plain').send('Guacamole is unreachable');
        else res.destroy();
    });
    res.on('close', () => upstream.destroy());
    if (body) upstream.end(body);
    else req.pipe(upstream);
}

// websocket-tunnel upgrade: raw socket relay after Guacamole answers 101.
async function proxyGuacUpgrade(req, socket, head) {
    let auth;
    try {
        auth = await ensureAuth(false);
    } catch (_) {
        socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
        return;
    }
    const target = upstreamTarget(auth, req.url.slice(GUAC_WEB_PATH.length));
    const headers = forwardHeaders(req, target.host);
    headers.connection = 'Upgrade';
    const upstream = target.client.request({ ...target.options, method: 'GET', headers: headers });
    upstream.on('upgrade', (upstreamRes, upstreamSocket, upstreamHead) => {
        let reply = 'HTTP/1.1 101 Switching Protocols\r\n';
        for (let i = 0; i < upstreamRes.rawHeaders.length; i += 2) {
            reply += upstreamRes.rawHeaders[i] + ': ' + upstreamRes.rawHeaders[i + 1] + '\r\n';
        }
        socket.write(reply + '\r\n');
        if (upstreamHead && upstreamHead.length) socket.write(upstreamHead);
        if (head && head.length) upstreamSocket.write(head);
        upstreamSocket.pipe(socket).pipe(upstreamSocket);
        upstreamSocket.on('error', () => socket.destroy());
        socket.on('error', () => upstreamSocket.destroy());
    });
    upstream.on('response', (upstreamRes) => {
        socket.end('HTTP/1.1 ' + upstreamRes.statusCode + ' ' + (upstreamRes.statusMessage || '') + '\r\nConnection: close\r\n\r\n');
        upstreamRes.resume();
    });
    upstream.on('error', () => socket.destroy());
    upstream.end();
}

// The app WebSocket server (modules/websocket.js) listens with { server } and
// answers every upgrade, so this path is routed ahead of it.
function attachGuacWebUpgrade(server, sessionMiddleware) {
    const existing = server.listeners('upgrade');
    server.removeAllListeners('upgrade');
    server.on('upgrade', (req, socket, head) => {
        if (!req.url.startsWith(GUAC_WEB_PATH + '/')) {
            existing.forEach((listener) => listener.call(server, req, socket, head));
            return;
        }
        sessionMiddleware(req, {}, () => {
            if (!req.session || !req.session.authenticated) {
                socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
                return;
            }
            proxyGuacUpgrade(req, socket, head);
        });
    });
}

function mountGuacRemoteBridge(app, authMiddleware) {
    app.get('/api/desktop-guac/connections', authMiddleware, async (req, res) => {
        try {
            res.json(await listGuacConnections());
        } catch (err) {
            res.status(err.status || 502).json({ ok: false, error: err.message || 'Guacamole connection list failed' });
        }
    });

    app.get('/api/desktop-guac/session/:id', authMiddleware, async (req, res) => {
        try {
            res.json({ ok: true, url: await guacSessionUrl(String(req.params.id || '')) });
        } catch (err) {
            res.status(err.status || 502).json({ ok: false, error: err.message || 'Guacamole session failed' });
        }
    });

    app.get('/api/desktop-guac/home', authMiddleware, async (req, res) => {
        try {
            res.json({ ok: true, url: await guacHomeUrl() });
        } catch (err) {
            res.status(err.status || 502).json({ ok: false, error: err.message || 'Guacamole home failed' });
        }
    });

    app.get(GUAC_WEB_PATH + '/' + GUAC_FRAME_SCRIPT_NAME, authMiddleware, (req, res) => {
        res.set('Cache-Control', 'no-cache');
        res.sendFile(GUAC_FRAME_SCRIPT_FILE);
    });

    app.use(GUAC_WEB_PATH, authMiddleware, proxyGuacWeb);
}

module.exports = {
    mountGuacRemoteBridge,
    attachGuacWebUpgrade,
    listGuacConnections,
    readGuacConfig
};
