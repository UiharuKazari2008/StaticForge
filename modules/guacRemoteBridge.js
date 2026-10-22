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
const net = require('net');
const express = require('express');

const expressRawJpeg = express.raw({ type: 'image/jpeg', limit: '2mb' });
const expressRawDownload = express.raw({ type: 'application/octet-stream', limit: '80mb' });

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
        // "quickconnect" is here once Komaki has guacamole-auth-quickconnect (Remote Desktop Connection)
        dataSources: Array.isArray(data.availableDataSources) ? data.availableDataSources.map(String) : [],
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

const GUAC_PROTOCOLS = new Set(['rdp', 'vnc', 'ssh', 'telnet', 'kubernetes']);
const GUAC_PREVIEW_DIR = path.join(ROOT, '.cache', 'guac-previews');
const GUAC_PREVIEW_MAX_BYTES = 2 * 1024 * 1024;
const GUAC_DOWNLOAD_MAX_BYTES = 80 * 1024 * 1024;
const GUAC_DOWNLOADS_FOLDER = 'Downloads';

function guacIdOk(id) {
    return /^[A-Za-z0-9_-]{1,64}$/.test(String(id || ''));
}

function previewFile(id) {
    return path.join(GUAC_PREVIEW_DIR, String(id) + '.jpg');
}

function previewStamp(id) {
    if (!guacIdOk(id)) return 0;
    try {
        return fs.statSync(previewFile(id)).mtimeMs;
    } catch (_) {
        return 0;
    }
}

// Connection groups are what Guacamole shows the logged-in user (the home tree).
// User-group records are a separate empty list on this server; they do not hold connections.
function flattenGuacTree(root) {
    const connections = [];
    const groups = [];
    const groupOptions = [];
    function takeConnections(node, groupName) {
        const rows = [];
        (node && node.childConnections || []).forEach((child) => {
            const row = publicConnection(child);
            if (!row) return;
            row.parentId = String(child.parentIdentifier || (node && node.identifier) || 'ROOT');
            row.groupName = groupName;
            rows.push(row);
            connections.push(row);
        });
        rows.sort((a, b) => a.name.localeCompare(b.name));
        return rows;
    }
    const rootRows = takeConnections(root, '');
    if (rootRows.length) groups.push({ id: 'ROOT', name: 'Connections', connections: rootRows });
    function walk(node, prefix) {
        (node && node.childConnectionGroups || []).forEach((child) => {
            const name = prefix ? prefix + ' / ' + String(child.name || '') : String(child.name || '');
            groupOptions.push({ id: String(child.identifier), name: name });
            const rows = takeConnections(child, name);
            if (rows.length) groups.push({ id: String(child.identifier), name: name, connections: rows });
            walk(child, name);
        });
    }
    walk(root || {}, '');
    return { connections: connections, groups: groups, groupOptions: groupOptions };
}

async function guacFetch(auth, suffix) {
    const url = auth.origin + '/api/session/data/' + encodeURIComponent(auth.dataSource) + suffix;
    try {
        return await fetch(url, {
            headers: { 'Guacamole-Token': auth.token },
            signal: AbortSignal.timeout(12000)
        });
    } catch (_) {
        throw fail(502, 'Guacamole at ' + hostOf(auth.origin) + ' is unreachable');
    }
}

async function listGuacConnections() {
    let auth = await ensureAuth(false);
    let response = await guacFetch(auth, '/connectionGroups/ROOT/tree');
    if (response.status === 403) {
        authCache = null;
        auth = await ensureAuth(true);
        response = await guacFetch(auth, '/connectionGroups/ROOT/tree');
    }
    if (!response.ok) {
        throw fail(502, 'Guacamole connection list failed (HTTP ' + response.status + ')');
    }
    const data = await response.json().catch(() => null);
    if (!data || data.identifier !== 'ROOT' && data.name !== 'ROOT') {
        throw fail(502, 'Guacamole connection list returned no groups');
    }
    const flat = flattenGuacTree(data);
    flat.connections.forEach((row) => {
        row.previewAt = previewStamp(row.id);
    });
    const current = authCache || auth;
    current.catalog = new Map(flat.connections.map((row) => [row.id, row]));
    return {
        ok: true,
        connections: flat.connections,
        groups: flat.groups,
        groupOptions: flat.groupOptions
    };
}

async function createGuacConnection(body) {
    const name = String(body && body.name || '').trim();
    const protocol = String(body && body.protocol || '').trim();
    const parentIdentifier = String(body && body.parentIdentifier || 'ROOT').trim() || 'ROOT';
    const parameters = body && body.parameters && typeof body.parameters === 'object' ? body.parameters : {};
    if (!name || !GUAC_PROTOCOLS.has(protocol)) {
        throw fail(400, 'Name and protocol are required');
    }
    if (!guacIdOk(parentIdentifier) && parentIdentifier !== 'ROOT') {
        throw fail(400, 'That group is not valid');
    }
    const hostname = String(parameters.hostname || '').trim();
    if (!hostname) throw fail(400, 'Host is required');
    const auth = await ensureAuth(false);
    const payload = {
        parentIdentifier: parentIdentifier,
        name: name,
        protocol: protocol,
        parameters: {
            hostname: hostname,
            port: String(parameters.port || '').trim(),
            username: String(parameters.username || ''),
            password: String(parameters.password || '')
        },
        attributes: {}
    };
    let response;
    try {
        response = await fetch(
            auth.origin + '/api/session/data/' + encodeURIComponent(auth.dataSource) + '/connections',
            {
                method: 'POST',
                headers: {
                    'Guacamole-Token': auth.token,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(12000)
            }
        );
    } catch (_) {
        throw fail(502, 'Guacamole at ' + hostOf(auth.origin) + ' is unreachable');
    }
    const text = await response.text();
    if (!response.ok) {
        let message = 'Guacamole refused the new connection';
        try {
            const data = JSON.parse(text);
            if (data && data.message) message = String(data.message);
        } catch (_) {}
        throw fail(response.status === 403 ? 403 : 502, message);
    }
    if (authCache) authCache.catalog = new Map();
    return { ok: true, id: text.replace(/"/g, '').trim() };
}

async function saveGuacDownload(workspaceId, filename, buffer) {
    if (!buffer || !buffer.length || buffer.length > GUAC_DOWNLOAD_MAX_BYTES) {
        throw fail(413, 'File is empty or too large');
    }
    const globalResources = require('./globalResources');
    const id = String(workspaceId || '');
    if (!globalResources.getWorkspaceManager().getWorkspaces()[id]) {
        throw fail(400, 'Unknown workspace');
    }
    let name = path.basename(String(filename || 'download')).replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_').slice(0, 200) || 'download';
    const vfs = globalResources.getVfsManager();
    const folder = await vfs._findWorkspaceFolderByName(id, null, GUAC_DOWNLOADS_FOLDER, { excludeDesktop: true })
        || await vfs.createFolderAtPath('/Workspaces/' + id, GUAC_DOWNLOADS_FOLDER);
    const file = await vfs.saveUserFileBuffer(buffer, {
        originalName: name,
        mimeType: 'application/octet-stream',
        scope: 'workspace',
        workspaceId: id,
        folderId: folder.id
    });
    const folderPath = '/Workspaces/' + id + '/' + folder.id;
    const wsServer = globalResources.getWebSocketServer();
    if (wsServer && wsServer.broadcast) {
        wsServer.broadcast({ type: 'vfs_updated', data: { path: folderPath }, timestamp: new Date().toISOString() });
    }
    return { ok: true, name: name, path: folderPath, fileId: file && file.id };
}

// ---- Remote Desktop Connection (quick connect) --------------------------------------------
// public/scripts/comp/desktop-apps/remoteDesktopConnection.js. Sessions are Guacamole's
// quickconnect extension (guacamole-auth-quickconnect 1.5.5 on Komaki): a rdp:// / ssh:// /
// vnc:// URI becomes a temporary connection in the "quickconnect" data source of our token,
// so nothing is stored in Guacamole or here. The protocol is the one the user chose.

const QUICK_DATA_SOURCE = 'quickconnect';
const QUICK_PROTOCOLS = new Set(['rdp', 'ssh', 'vnc']);
const QUICK_HOST_RE = /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.?$/;

function quickFail(status, message, code) {
    const err = fail(status, message);
    err.code = code;
    return err;
}

async function quickConnectStatus() {
    const auth = await ensureAuth(false);
    return { ok: true, available: (auth.dataSources || []).includes(QUICK_DATA_SOURCE) };
}

function quickConnectUri(body) {
    const protocol = String(body && body.protocol || '').toLowerCase();
    if (!QUICK_PROTOCOLS.has(protocol)) throw quickFail(400, 'Choose RDP, SSH or VNC.', 'protocol');
    let host = String(body && body.host || '').trim();
    const v6 = /^\[([0-9A-Fa-f:.]+)\]$/.exec(host);
    if (v6) host = v6[1];
    if (!host) throw quickFail(400, 'The computer name field is blank. Enter a remote computer name.', 'blank');
    if (!net.isIP(host) && !QUICK_HOST_RE.test(host)) {
        throw quickFail(400, 'The specified computer name contains invalid characters.', 'invalid');
    }
    const port = body && body.port ? Number(body.port) : 0;
    if (port && (!Number.isInteger(port) || port < 1 || port > 65535)) {
        throw quickFail(400, 'The remote computer name is not valid. Enter a valid remote computer name.', 'invalid');
    }
    let username = String(body && body.username || '');
    let domain = String(body && body.domain || '');
    // DOMAIN\user, as Windows Security takes it
    const slash = username.indexOf('\\');
    if (protocol === 'rdp' && slash > 0 && !domain) {
        domain = username.slice(0, slash);
        username = username.slice(slash + 1);
    }
    const password = String(body && body.password || '');
    const userInfo = username || password
        ? encodeURIComponent(username) + (password ? ':' + encodeURIComponent(password) : '') + '@'
        : '';
    const query = new URLSearchParams();
    if (protocol === 'rdp') {
        query.set('ignore-cert', 'true');
        query.set('security', 'any');
        if (domain) query.set('domain', domain);
    }
    const hostPart = net.isIPv6(host) ? '[' + host + ']' : host;
    const qs = query.toString();
    return {
        protocol: protocol,
        name: hostPart + (port ? ':' + port : ''),
        uri: protocol + '://' + userInfo + hostPart + (port ? ':' + port : '') + '/' + (qs ? '?' + qs : '')
    };
}

async function createQuickConnection(body) {
    const target = quickConnectUri(body);
    let auth = await ensureAuth(false);
    if (!(auth.dataSources || []).includes(QUICK_DATA_SOURCE)) {
        throw quickFail(501, 'Quick connect is not available on the Remote Desktop Gateway.', 'unavailable');
    }
    const post = (current) => fetch(current.origin + '/api/session/ext/' + QUICK_DATA_SOURCE + '/create', {
        method: 'POST',
        headers: { 'Guacamole-Token': current.token, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ uri: target.uri }),
        signal: AbortSignal.timeout(12000)
    });
    let response;
    try {
        response = await post(auth);
        if (response.status === 403) {
            authCache = null;
            auth = await ensureAuth(true);
            response = await post(auth);
        }
    } catch (err) {
        if (err && err.status) throw err;
        throw fail(502, 'Guacamole at ' + hostOf(auth.origin) + ' is unreachable');
    }
    const data = await response.json().catch(() => null);
    if (!response.ok || !data || data.identifier === undefined) {
        throw quickFail(response.status === 404 ? 501 : 502,
            (data && data.message) || 'The Remote Desktop Gateway refused the connection.',
            response.status === 404 ? 'unavailable' : 'refused');
    }
    const clientId = Buffer.from([String(data.identifier), 'c', QUICK_DATA_SOURCE].join('\0')).toString('base64url');
    return {
        ok: true,
        id: String(data.identifier),
        name: target.name,
        protocol: target.protocol,
        url: GUAC_WEB_PATH + '/#/client/' + clientId + '?token=' + encodeURIComponent(auth.token)
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

    app.post('/api/desktop-guac/connections', authMiddleware, async (req, res) => {
        try {
            res.json(await createGuacConnection(req.body || {}));
        } catch (err) {
            res.status(err.status || 502).json({ ok: false, error: err.message || 'Guacamole connection create failed' });
        }
    });

    app.get('/api/desktop-guac/preview/:id', authMiddleware, (req, res) => {
        const id = String(req.params.id || '');
        if (!guacIdOk(id)) {
            res.status(400).json({ ok: false, error: 'Unknown connection' });
            return;
        }
        const file = previewFile(id);
        if (!fs.existsSync(file)) {
            res.status(404).end();
            return;
        }
        res.set('Cache-Control', 'private, max-age=30');
        res.type('jpeg').sendFile(file);
    });

    app.post('/api/desktop-guac/preview/:id', authMiddleware, expressRawJpeg, async (req, res) => {
        const id = String(req.params.id || '');
        const body = req.body;
        if (!guacIdOk(id) || !Buffer.isBuffer(body) || !body.length || body.length > GUAC_PREVIEW_MAX_BYTES) {
            res.status(400).json({ ok: false, error: 'Preview was empty' });
            return;
        }
        try {
            let auth = await ensureAuth(false);
            if (!auth.catalog.has(id)) {
                await listGuacConnections();
                auth = authCache;
            }
            if (!auth || !auth.catalog.has(id)) {
                res.status(404).json({ ok: false, error: 'That connection is not in the Komaki list' });
                return;
            }
            fs.mkdirSync(GUAC_PREVIEW_DIR, { recursive: true });
            fs.writeFileSync(previewFile(id), body);
            res.json({ ok: true, previewAt: previewStamp(id) });
        } catch (err) {
            res.status(err.status || 502).json({ ok: false, error: err.message || 'Preview save failed' });
        }
    });

    app.post('/api/desktop-guac/download', authMiddleware, expressRawDownload, async (req, res) => {
        try {
            const filename = decodeURIComponent(String(req.get('x-filename') || 'download'));
            const workspaceId = String(req.get('x-workspace-id') || '');
            res.json(await saveGuacDownload(workspaceId, filename, req.body));
        } catch (err) {
            res.status(err.status || 502).json({ ok: false, error: err.message || 'Download save failed' });
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

    app.get('/api/desktop-guac/quick/status', authMiddleware, async (req, res) => {
        try {
            res.json(await quickConnectStatus());
        } catch (err) {
            res.status(err.status || 502).json({ ok: false, error: err.message || 'Guacamole is unavailable' });
        }
    });

    app.post('/api/desktop-guac/quick', authMiddleware, async (req, res) => {
        try {
            res.json(await createQuickConnection(req.body || {}));
        } catch (err) {
            res.status(err.status || 502).json({ ok: false, code: err.code || 'gateway', error: err.message || 'Quick connect failed' });
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
    readGuacConfig,
    flattenGuacTree,
    guacIdOk,
    quickConnectUri
};
