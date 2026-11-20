/**
 * CaféReady machines in ActiveSync (DreamOS #910, Yukimi Nov 20 2026: "we should design in ActiveSync with the server
 * like the phones have, to push and get data from registered CaféReady clients"). A DreamOS machine's CaféReady host
 * (DreamOS cafeready/src/activesync.rs) is an ActiveSync device over the link it already keeps to this server: its
 * Melaton Café Miniport (modules/ws/virtualSocket.js), light sub "activesync". Wherever the machine is (home, roaming
 * on a hotel's Wi-Fi or a phone's hotspot) the server sees it and reaches it; nothing needs its LAN address.
 *
 * Registration (modules/activeSync.js hello): as_hello { kind: device, speaker: host, platform: cafeready, id, name,
 * model, os, app, ops, status }. Accepted only from a Miniport sub-client (never a page's own socket), signed in as an
 * administrator, for the device id the carrier connected with (?miniport=1&device=<id>). The machine is partnered by
 * that sign-in (permissions files + control); the row's platform is 'cafeready'. Its status (as_status, pushed by the
 * machine when something changed, never polled) carries `host`: base, slot, CaféReady, channel, addresses, interfaces,
 * power, the server address it uses and what it allows.
 *
 * Commands (admin only, each one written to the server log and to the device's ActiveSync log; never the command's
 * words, which may hold a secret: its first word, its length and a hash):
 *
 *   host.shell        { command, root?, timeoutMs? }  -> { output, error, exitCode, timedOut, truncated, user, ms }
 *                     /bin/sh -c as the machine's user (dream), or root; killed with its process group at the timeout
 *   host.screenshot   { token, output? }  the machine posts the picture to POST /api/activesync/host/<id>/blob/<token>
 *   host.diagnostics  { token, boot: 0 | -1, lines }  the bundle (journal, systemctl --failed, iwd, dmesg ...), the same way
 *   host.config       { updateChannel?, serverAddress? } -> the machine's channel and server address (get with {})
 *   host.packages     -> its components and hardware packs
 *   storage.stat / storage.list { root: 'fs', path }; files through modules/activeSyncTransfers.js with root 'fs':
 *                     GET /api/activesync/file/<id>/fs/<path> (Range), POST /api/activesync/upload/<id>/begin
 *                     { root: 'fs', dir, name, size, conflict, mkdirs } ... commit (resumable both ways, 4 GB at most)
 *
 * Consent (as a phone's Remote Commands, Android Bridge > Advanced Tools, off until the user turns it on): the machine
 * says what it allows (status.host.allow: commands, screenshots; killSwitch). This server refuses at once what the
 * machine does not allow, and the machine checks again (it has the last word). Nothing here changes those settings:
 * they are set on the machine only (`cafeready send activesync allow '{"commands":true}'`, or its page's bridge), and
 * REMOTE_COMMANDS=off in the machine's dreamos.conf refuses everything whatever they say.
 *
 * Routes (admin): POST /api/activesync/host/:deviceId/shell { command, root, timeoutMs }
 *                 GET  /api/activesync/host/:deviceId/screenshot[?output=N] -> image/png
 *                 GET  /api/activesync/host/:deviceId/diagnostics[?boot=-1&lines=N] -> text/plain
 *                 GET | PUT /api/activesync/host/:deviceId/config { updateChannel, serverAddress }
 *                 GET  /api/activesync/host/:deviceId/packages
 * The machine (its own session): POST /api/activesync/host/:deviceId/blob/:token (X-Blob-Kind png | rgb | text).
 */
'use strict';

const crypto = require('crypto');
const zlib = require('zlib');

const PLATFORM = 'cafeready';
const PERMISSIONS = ['files', 'control'];
const MAX_BLOB_BYTES = 64 * 1024 * 1024;
const BLOB_WAIT_MS = 120000;
const MAX_COMMAND = 8000;

let activeSyncMod = null;
const activeSync = () => (activeSyncMod || (activeSyncMod = require('./activeSync')));
const blobWaits = new Map(); // token -> { deviceId, kind, resolve, reject, timer }

function fail(code, message) {
    return Object.assign(new Error(message), { code });
}

function clamp(v, max) {
    return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max);
}

/** The `host` part of a DreamOS machine's status (sanitizeStatus): every field optional, never guessed. */
function sanitizeHost(raw) {
    const out = {};
    const str = (k, max) => { if (raw[k] != null && raw[k] !== '') out[k] = clamp(raw[k], max); };
    ['base', 'slot', 'cafeready', 'kernel', 'vendor', 'channel', 'serverSource'].forEach((k) => str(k, 160));
    if (raw.power === 'ac' || raw.power === 'battery') out.power = raw.power;
    if (typeof raw.online === 'boolean') out.online = raw.online;
    const addr = (v) => clamp(v, 64);
    if (Array.isArray(raw.addresses)) out.addresses = raw.addresses.slice(0, 16).map(addr).filter(Boolean);
    if (Array.isArray(raw.serverAddress)) out.serverAddress = raw.serverAddress.slice(0, 8).map(addr).filter(Boolean);
    if (Array.isArray(raw.interfaces)) {
        out.interfaces = raw.interfaces.slice(0, 12).filter((i) => i && typeof i === 'object').map((i) => ({
            name: clamp(i.name, 32), kind: i.kind === 'wifi' ? 'wifi' : 'ethernet', up: i.up === true,
            ip: Array.isArray(i.ip) ? i.ip.slice(0, 8).map(addr) : [], ip6: Array.isArray(i.ip6) ? i.ip6.slice(0, 8).map(addr) : undefined,
            ssid: i.ssid == null ? undefined : clamp(i.ssid, 64), signal: Number.isFinite(Number(i.signal)) && i.signal != null ? Number(i.signal) : undefined
        }));
    }
    if (raw.allow && typeof raw.allow === 'object') {
        out.allow = { commands: raw.allow.commands === true, screenshots: raw.allow.screenshots === true, killSwitch: raw.allow.killSwitch === true };
    }
    if (Number.isFinite(Number(raw.uptime))) out.uptime = Math.max(0, Math.round(Number(raw.uptime)));
    return out;
}

/** The socket a clientInfo belongs to, in the server's client list. */
function socketOf(server, clientInfo) {
    if (!server || !server.clients) return null;
    for (const [ws, info] of server.clients) if (info === clientInfo) return ws;
    return null;
}

/**
 * May this socket say hello as a DreamOS machine? Only a Miniport sub-client (CaféReady's own link, never a page's
 * socket or a Continuity sub), signed in as an administrator, for the device id its carrier connected with.
 */
function checkHello(server, clientInfo, id) {
    if (!clientInfo || !clientInfo.authenticated || clientInfo.userType !== 'admin') throw fail('NOT_PERMITTED', 'A DreamOS machine signs in as an administrator.');
    const ws = socketOf(server, clientInfo);
    const carrier = ws && ws.virtual ? ws.carrier : null;
    if (!carrier || !carrier._dsMiniport) throw fail('NOT_PERMITTED', 'A DreamOS machine says hello over its Miniport only.');
    if (carrier._dsDevice && carrier._dsDevice !== id) throw fail('BAD_ID', 'The id is not the one this Miniport connected with.');
}

/** A machine registered: the server log says so (its name, base and address; never its session). */
function noteHello(globalResources, clientInfo, as) {
    const h = (as.status && as.status.host) || {};
    console.log(`🖥️ [activeSync] CaféReady ${as.name} (${as.id.slice(0, 8)}…) connected: DreamOS ${h.base || '?'} slot ${h.slot || '?'}, CaféReady ${h.cafeready || '?'}, from ${clientInfo.clientIP || 'unknown'}${h.allow ? `, remote commands ${h.allow.commands ? 'allowed' : 'off'}` : ''}`);
}

function serverOf(globalResources) {
    try { return globalResources && typeof globalResources.getWebSocketServer === 'function' ? globalResources.getWebSocketServer() : null; } catch (_) { return null; }
}

/** The device's row, refused unless it is a DreamOS machine. */
function hostRow(globalResources, deviceId) {
    const id = String(deviceId || '').toLowerCase();
    const row = activeSync().isPeerId(id) ? activeSync().deviceRow(globalResources, id) : null;
    if (!row) throw fail('UNKNOWN_DEVICE', 'No such device.');
    if (row.platform !== PLATFORM) throw fail('NOT_CAFEREADY', 'This device is not a DreamOS machine.');
    return row;
}

function isHost(globalResources, deviceId) {
    try { hostRow(globalResources, deviceId); return true; } catch (_) { return false; }
}

/** What the machine said it allows (its last status): { commands, screenshots, killSwitch }. */
function allowedOf(globalResources, deviceId) {
    const d = activeSync().list(globalResources, serverOf(globalResources)).devices.find((x) => x.deviceId === deviceId);
    const a = d && d.status && d.status.host && d.status.host.allow;
    return a || { commands: false, screenshots: false, killSwitch: false };
}

function need(globalResources, deviceId, what) {
    const a = allowedOf(globalResources, deviceId);
    if (a.killSwitch) throw fail('REMOTE_COMMANDS_OFF', 'Remote commands are turned off on this computer (REMOTE_COMMANDS=off in its dreamos.conf).');
    if (what === 'screenshots' && !a.screenshots) throw fail('SCREENSHOTS_OFF', 'Screenshots are not allowed on this computer.');
    if (what === 'commands' && !a.commands) throw fail('NOT_ALLOWED', 'Allow remote commands is off on this computer. It is turned on at the computer: cafeready send activesync allow \'{"commands":true}\'.');
}

/** The audit line: the server log and the device's ActiveSync log. */
function audit(globalResources, row, op, who, detail) {
    const line = `${op}${detail ? ` ${detail}` : ''} by ${who || 'an administrator'}`;
    console.log(`🛂 [activeSync] CaféReady ${row.name} (${row.device_id.slice(0, 8)}…): ${line}`);
    try { activeSync().logEvent(globalResources, row.device_id, 'info', `Remote: ${line}`); } catch (_) { /* best effort */ }
}

/**
 * Every call relayed to a machine's socket (activeSync.js call / serverCall): file work is written down here (the
 * host.* commands were written down by their routes, status reads are not).
 */
function auditCall(globalResources, row, op, args, who) {
    if (!row || op === 'status.get' || op.startsWith('host.')) return;
    const a = args && typeof args === 'object' ? args : {};
    const what = op === 'stream.receive' ? `${a.dir || ''}/${a.name || ''} (${Number(a.size) || 0} bytes)` : String(a.path || '');
    audit(globalResources, row, op, who, clamp(what, 300));
}

function commandSummary(command, root) {
    const c = String(command || '');
    const word = (c.trim().split(/\s+/)[0] || '').slice(0, 40);
    const sha = crypto.createHash('sha256').update(c).digest('hex').slice(0, 12);
    return `(${word} ..., ${c.length} chars, sha256 ${sha}${root ? ', as root' : ''})`;
}

function callHost(globalResources, deviceId, op, args, timeoutMs) {
    const as = activeSync();
    if (!as.deviceOnline(globalResources, serverOf(globalResources), deviceId)) return Promise.reject(fail('NOT_ONLINE', 'The computer is not connected.'));
    return as.serverCall(globalResources, serverOf(globalResources), deviceId, op, args || {}, { timeoutMs: timeoutMs || 30000, fromName: 'Dreamscape server' });
}

// ---------------------------------------------------------------- the commands

async function shell(globalResources, deviceId, input = {}, who) {
    const row = hostRow(globalResources, deviceId);
    const command = String(input.command || '').trim();
    if (!command) throw fail('BAD_REQUEST', 'No command.');
    if (command.length > MAX_COMMAND) throw fail('BAD_REQUEST', 'The command is too long.');
    need(globalResources, row.device_id, 'commands');
    const root = input.root === true;
    const timeoutMs = Math.min(600000, Math.max(1000, Number(input.timeoutMs) || 60000));
    audit(globalResources, row, 'shell', who, commandSummary(command, root));
    return callHost(globalResources, row.device_id, 'host.shell', { command, root, timeoutMs }, timeoutMs + 15000);
}

/** A picture or a bundle the machine posts back: wait for its token. */
function waitBlob(deviceId, kind, ms) {
    const token = crypto.randomBytes(16).toString('hex');
    const got = new Promise((resolve, reject) => {
        const timer = setTimeout(() => { blobWaits.delete(token); reject(fail('TIMEOUT', 'The computer did not send it.')); }, ms);
        if (timer.unref) timer.unref();
        blobWaits.set(token, { deviceId, kind, resolve, reject, timer });
    });
    got.catch(() => { /* awaited by the caller */ });
    const drop = () => { const w = blobWaits.get(token); if (w) { clearTimeout(w.timer); blobWaits.delete(token); } };
    return { token, got, drop };
}

async function screenshot(globalResources, deviceId, input = {}, who) {
    const row = hostRow(globalResources, deviceId);
    need(globalResources, row.device_id, 'screenshots');
    audit(globalResources, row, 'screenshot', who, '');
    const w = waitBlob(row.device_id, 'image', BLOB_WAIT_MS);
    let meta;
    try {
        meta = await callHost(globalResources, row.device_id, 'host.screenshot', { token: w.token, output: Number(input.output) || 0 }, BLOB_WAIT_MS);
    } catch (err) { w.drop(); throw err; }
    const png = await w.got;
    return { png, meta };
}

async function diagnostics(globalResources, deviceId, input = {}, who) {
    const row = hostRow(globalResources, deviceId);
    need(globalResources, row.device_id, 'commands');
    const boot = Number(input.boot) === -1 ? -1 : 0;
    audit(globalResources, row, 'diagnostics', who, `(boot ${boot})`);
    const w = waitBlob(row.device_id, 'text', 180000);
    try {
        await callHost(globalResources, row.device_id, 'host.diagnostics', { token: w.token, boot, lines: Number(input.lines) || 3000 }, 180000);
    } catch (err) { w.drop(); throw err; }
    return (await w.got).toString('utf8');
}

async function config(globalResources, deviceId, patch = {}, who) {
    const row = hostRow(globalResources, deviceId);
    const args = {};
    if (patch.updateChannel !== undefined) args.updateChannel = patch.updateChannel == null ? '' : String(patch.updateChannel);
    if (patch.serverAddress !== undefined) args.serverAddress = patch.serverAddress;
    need(globalResources, row.device_id, 'commands');
    if (Object.keys(args).length) audit(globalResources, row, 'config', who, `(${Object.keys(args).join(', ')})`);
    return callHost(globalResources, row.device_id, 'host.config', args, 60000);
}

async function packages(globalResources, deviceId) {
    const row = hostRow(globalResources, deviceId);
    return callHost(globalResources, row.device_id, 'host.packages', {}, 30000);
}

/** The machine's upload for a token it was given (its own session only). */
async function takeBlob(globalResources, deviceId, token, kind, encoding, headers, body) {
    const w = blobWaits.get(token);
    if (!w || w.deviceId !== deviceId) return false;
    blobWaits.delete(token);
    clearTimeout(w.timer);
    try {
        let data = encoding === 'gzip' ? zlib.gunzipSync(body, { maxOutputLength: 256 * 1024 * 1024 }) : body;
        if (w.kind === 'image') {
            if (kind === 'rgb') {
                const width = Number(headers['x-width']);
                const height = Number(headers['x-height']);
                if (!(width > 0 && height > 0 && data.length >= width * height * 3)) throw fail('BAD_PICTURE', 'The picture is not the size it says.');
                data = await require('sharp')(data, { raw: { width, height, channels: 3 } }).png({ compressionLevel: 6 }).toBuffer();
            } else if (!(data[0] === 0x89 && data[1] === 0x50)) throw fail('BAD_PICTURE', 'Not a PNG.');
        }
        w.resolve(data);
    } catch (err) {
        w.reject(err);
    }
    return true;
}

// ---------------------------------------------------------------- agents (MCP device_shell / device_screenshot / device_packages)

function brief(d) {
    const h = (d.status && d.status.host) || {};
    return { deviceId: d.deviceId, name: d.name, model: d.model, platform: d.platform, online: d.online, os: d.os, app: d.app,
        addresses: h.addresses, power: h.power, battery: d.status && d.status.battery ? d.status.battery.level : undefined, allow: h.allow || null };
}

async function agentShell(globalResources, dev, input = {}) {
    return { success: true, device: dev.name, platform: PLATFORM, ...(await shell(globalResources, dev.deviceId, { command: input.command, root: input.root === true, timeoutMs: Number(input.timeout) > 0 ? Number(input.timeout) * 1000 : undefined }, 'an agent (MCP device_shell)')) };
}

async function agentScreenshot(globalResources, dev, input = {}) {
    if (!dev.online) return { meta: { success: false, code: 'NOT_ONLINE', device: brief(dev) }, images: [] };
    const { png, meta } = await screenshot(globalResources, dev.deviceId, { output: input.display && /^\d+$/.test(String(input.display)) ? Number(input.display) : 0 }, 'an agent (MCP device_screenshot)');
    const sharp = require('sharp');
    const info = await sharp(png).metadata();
    const bytes = await sharp(png).resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
    return { meta: { success: true, device: brief(dev), shots: [{ display: 'main', width: info.width, height: info.height, via: meta && meta.via }] }, images: [{ mimeType: 'image/jpeg', bytes }] };
}

async function agentPackages(globalResources, dev, input = {}) {
    if (input.action) return { success: false, code: 'UNSUPPORTED', error: 'A DreamOS machine\'s components change through Melaton Update, not package actions.' };
    const r = await packages(globalResources, dev.deviceId);
    const q = String(input.filter || '').toLowerCase();
    const list = (r && r.packages) || [];
    return { success: true, device: dev.name, platform: PLATFORM, base: r && r.base, update: r && r.update, count: list.length,
        packages: q ? list.filter((p) => String(p.label || '').toLowerCase().includes(q) || String(p.package || '').toLowerCase().includes(q)) : list };
}

// ---------------------------------------------------------------- HTTP

function mount(app, authMiddleware, globalResources) {
    const auth = authMiddleware || ((req, res, next) => next());
    const refuse = (res, status, code, error) => { if (!res.headersSent) res.status(status).json({ success: false, code, error }); };
    const statusOf = (code) => ({ BAD_REQUEST: 400, UNKNOWN_DEVICE: 404, NOT_CAFEREADY: 409, NOT_ALLOWED: 409, SCREENSHOTS_OFF: 409, REMOTE_COMMANDS_OFF: 409, NOT_ONLINE: 409, OFFLINE: 409, UNSUPPORTED: 409, TIMEOUT: 504, NOT_PERMITTED: 403 })[code] || 502;
    const isAdmin = (req) => req.userType === 'admin';
    const who = (req) => `an administrator (session ${String(req.sessionId || (req.session && req.session.id) || '').slice(0, 8)}…, ${req.ip || 'unknown'})`;
    const guard = (fn) => async (req, res) => {
        if (!isAdmin(req)) { refuse(res, 403, 'INSUFFICIENT_PERMISSIONS', 'Admin access required'); return; }
        try { await fn(req, res, String(req.params.deviceId || '').toLowerCase()); } catch (err) { refuse(res, statusOf(err.code), err.code || 'ERROR', err.message); }
    };

    app.post('/api/activesync/host/:deviceId/shell', auth, guard(async (req, res, id) => {
        const b = req.body && typeof req.body === 'object' ? req.body : {};
        res.json({ success: true, ...(await shell(globalResources, id, { command: b.command, root: b.root === true, timeoutMs: b.timeoutMs }, who(req))) });
    }));

    app.get('/api/activesync/host/:deviceId/screenshot', auth, guard(async (req, res, id) => {
        const { png, meta } = await screenshot(globalResources, id, { output: req.query.output }, who(req));
        res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'no-store', 'X-Captured-Via': (meta && meta.via) || '' });
        res.send(png);
    }));

    app.get('/api/activesync/host/:deviceId/diagnostics', auth, guard(async (req, res, id) => {
        const text = await diagnostics(globalResources, id, { boot: req.query.boot, lines: req.query.lines }, who(req));
        res.set({ 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "sandbox; default-src 'none'" });
        res.send(text);
    }));

    app.get('/api/activesync/host/:deviceId/config', auth, guard(async (req, res, id) => {
        res.json({ success: true, config: await config(globalResources, id, {}, who(req)) });
    }));

    app.put('/api/activesync/host/:deviceId/config', auth, guard(async (req, res, id) => {
        res.json({ success: true, config: await config(globalResources, id, req.body || {}, who(req)) });
    }));

    app.get('/api/activesync/host/:deviceId/packages', auth, guard(async (req, res, id) => {
        res.json({ success: true, ...(await packages(globalResources, id)) });
    }));

    // the machine posts what it was asked for (its own session, a one-time token)
    app.post('/api/activesync/host/:deviceId/blob/:token', auth, (req, res) => {
        const id = String(req.params.deviceId || '').toLowerCase();
        const token = String(req.params.token || '');
        if (!/^[0-9a-f]{32}$/.test(token) || !activeSync().isPeerId(id)) { refuse(res, 400, 'BAD_REQUEST', 'Bad request.'); return; }
        if (!activeSync().isDeviceSession(globalResources, serverOf(globalResources), id, req.sessionId || (req.session && req.session.id))) {
            refuse(res, 403, 'NOT_THE_DEVICE', 'Only the computer itself sends this.');
            return;
        }
        const w = blobWaits.get(token);
        if (!w || w.deviceId !== id) { refuse(res, 410, 'GONE', 'Nobody is waiting for this.'); return; }
        const parts = [];
        let size = 0;
        let over = false;
        req.on('data', (c) => { if (over) return; size += c.length; if (size > MAX_BLOB_BYTES) { over = true; refuse(res, 413, 'TOO_LARGE', 'Too large.'); req.destroy(); return; } parts.push(c); });
        req.on('end', async () => {
            if (over) return;
            const kind = String(req.headers['x-blob-kind'] || '').toLowerCase();
            const ok = await takeBlob(globalResources, id, token, kind, String(req.headers['content-encoding'] || '').toLowerCase(), req.headers, Buffer.concat(parts));
            if (!ok) { refuse(res, 410, 'GONE', 'Nobody is waiting for this.'); return; }
            res.json({ success: true });
        });
    });
}

function resetForTests() {
    for (const w of blobWaits.values()) clearTimeout(w.timer);
    blobWaits.clear();
    activeSyncMod = null;
}

module.exports = {
    PLATFORM, PERMISSIONS, sanitizeHost, checkHello, noteHello, isHost, allowedOf, commandSummary, auditCall,
    shell, screenshot, diagnostics, config, packages, takeBlob,
    agentShell, agentScreenshot, agentPackages, mount, resetForTests
};
