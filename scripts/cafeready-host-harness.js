'use strict';

/**
 * A test server for CaféReady's ActiveSync (#910, modules/cafeReadyHost.js) without the live Dreamscape: the real
 * Miniport carrier (modules/ws/virtualSocket.js acceptMiniport), the real ActiveSync relay (modules/activeSync.js) and
 * the real routes (cafeReadyHost.js, activeSyncTransfers.js) on a plain HTTP port, with one fixed session that is an
 * administrator. A DreamOS machine (or a VM) runs a second CaféReady against it:
 *
 *   CAFEREADY_MINIPORT_COOKIE='connect.sid=harness' cafeready run --passive --server http://<this host>:<port> \
 *       --state /tmp/cr/state --run /tmp/cr/run --port 47911
 *
 * and this script drives it (--drive): list, shell as the user and as root, a timeout, config, a screenshot, the
 * diagnostic bundle, a file put and get (Range too), and the allow / kill switch refusals the machine reports.
 *
 *   node scripts/cafeready-host-harness.js [--port 18977] [--drive] [--wait 120]
 *
 * Its ActiveSync database is a temporary one; nothing of the live server is touched.
 */

const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const WebSocket = require('ws');

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
const PORT = Number(opt('--port', 18977));
const DRIVE = args.includes('--drive');
const WAIT_S = Number(opt('--wait', 180));
const SID = 'harness';

const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'cafeready-harness-'));
const as = require('../modules/activeSync');
as.resetForTests(tmp);
const host = require('../modules/cafeReadyHost');
const virtualSocket = require('../modules/ws/virtualSocket');

const fake = {
    clients: new Map(),
    sendToClient(ws, msg) { try { ws.send(JSON.stringify(msg)); } catch (_) { /* closed */ } },
    broadcast() {}
};
const gr = { getPath: () => tmp, getWebSocketServer: () => fake, getConfig: () => ({}) };

const signedIn = (req) => /(?:^|;\s*)connect\.sid=harness(?:;|$)/.test(String(req.headers.cookie || ''));

const app = express();
app.use(express.json({ limit: '10mb' }));
const auth = (req, res, next) => {
    if (!signedIn(req)) { res.status(401).json({ success: false, code: 'NOT_SIGNED_IN' }); return; }
    req.userType = 'admin';
    req.sessionId = SID;
    next();
};
require('../modules/activeSyncTransfers').mount(app, auth, gr);
host.mount(app, auth, gr);
app.get('/devices', auth, (req, res) => res.json(as.list(gr, fake)));

const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });

function connect(vws, req) {
    const info = { authenticated: true, userType: 'admin', sessionId: SID, clientIP: req.socket && req.socket.remoteAddress, clientId: crypto.randomBytes(6).toString('hex'), light: !!vws.light };
    fake.clients.set(vws, info);
    console.log(`  sub-client ${vws.sub} opened${vws.light ? ' (light)' : ''}`);
    vws.on('message', (data) => {
        let m;
        try { m = JSON.parse(data); } catch (_) { return; }
        const body = m.data && typeof m.data === 'object' ? m.data : m;
        const reply = (type, d) => fake.sendToClient(vws, { type, requestId: m.requestId, data: d });
        try {
            if (m.type === 'as_hello') {
                let r;
                try { r = as.hello(gr, fake, info, body); } catch (e) { r = { success: false, code: e.code, error: e.message }; }
                if (r.success) { r.devices = r.device ? [r.device] : []; r.computers = []; }
                reply('as_hello_response', r);
            } else if (m.type === 'as_status') as.status(gr, fake, info, body);
            else if (m.type === 'as_reply') as.reply(info, body);
            else if (m.type === 'as_event') as.event(gr, fake, info, body);
        } catch (e) { console.warn('  packet failed:', e.message); }
    });
    vws.on('close', () => { as.onSocketClosed(gr, fake, info); fake.clients.delete(vws); console.log(`  sub-client ${vws.sub} closed`); });
}

server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://x');
    if (url.searchParams.get('miniport') !== '1') { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => {
        const info = { authenticated: signedIn(req), userType: 'admin', sessionId: SID, clientIP: req.socket.remoteAddress };
        virtualSocket.acceptMiniport(ws, req, info, connect);
    });
});

// ---------------------------------------------------------------- the drive

const base = `http://127.0.0.1:${PORT}`;
const H = { Cookie: `connect.sid=${SID}` };
async function api(method, p, body, raw) {
    const r = await fetch(base + p, { method, headers: Object.assign({}, H, body && !raw ? { 'Content-Type': 'application/json' } : {}), body: raw ? body : (body ? JSON.stringify(body) : undefined) });
    const type = r.headers.get('content-type') || '';
    return { status: r.status, headers: r.headers, body: type.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
}
const ok = (name, cond, extra) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  ${extra}` : ''}`); if (!cond) process.exitCode = 1; };

async function drive() {
    let dev = null;
    for (let i = 0; i < WAIT_S && !dev; i++) {
        dev = as.list(gr, fake).devices.find((d) => d.platform === 'cafeready' && d.online) || null;
        if (!dev) await new Promise((r) => setTimeout(r, 1000));
    }
    ok('a CaféReady machine registered', !!dev, dev ? `${dev.name} ${dev.model} / ${dev.os} / ${dev.app}` : 'none within the wait');
    if (!dev) return;
    const id = dev.deviceId;
    const h = (dev.status && dev.status.host) || {};
    ok('its status carries host facts', !!h.base, JSON.stringify({ base: h.base, slot: h.slot, cafeready: h.cafeready, power: h.power, addresses: h.addresses, allow: h.allow, battery: dev.status.battery, wifi: dev.status.wifi, active: dev.status.active }));
    if (!(h.allow && h.allow.commands)) {
        const r = await api('POST', `/api/activesync/host/${id}/shell`, { command: 'id' });
        ok('refused while the machine does not allow commands', r.status === 409 && r.body.code === 'NOT_ALLOWED', `${r.status} ${r.body.code}`);
        console.log('      (turn it on at the machine: cafeready send activesync allow \'{"commands":true}\' for the rest)');
        return;
    }
    let r = await api('POST', `/api/activesync/host/${id}/shell`, { command: 'id -un; echo $HOME; echo err >&2; exit 3' });
    ok('shell as the user', r.status === 200 && /dream/.test(r.body.output) && r.body.exitCode === 3 && /err/.test(r.body.error), JSON.stringify(r.body));
    r = await api('POST', `/api/activesync/host/${id}/shell`, { command: 'id -u', root: true });
    ok('shell as root', r.status === 200 && r.body.output.trim() === '0', JSON.stringify(r.body));
    r = await api('POST', `/api/activesync/host/${id}/shell`, { command: 'sleep 30 & sleep 30; echo never', timeoutMs: 2000 });
    ok('a timeout kills the whole group', r.status === 200 && r.body.timedOut === true && !/never/.test(r.body.output), `${r.body.ms} ms`);
    r = await api('GET', `/api/activesync/host/${id}/config`);
    ok('config read', r.status === 200 && typeof r.body.config.channel === 'string', JSON.stringify(r.body.config && { updateChannel: r.body.config.updateChannel, channel: r.body.config.channel, url: r.body.config.url }));
    r = await api('GET', `/api/activesync/host/${id}/packages`);
    ok('packages', r.status === 200 && Array.isArray(r.body.packages), `${(r.body.packages || []).map((p) => `${p.package} ${p.version || ''}`).join(', ')}`);
    r = await api('GET', `/api/activesync/host/${id}/screenshot`);
    const png = Buffer.isBuffer(r.body) && r.body[0] === 0x89;
    if (png) { const f = path.join(tmp, 'shot.png'); fs.writeFileSync(f, r.body); console.log(`      screenshot saved: ${f}`); }
    ok('screenshot', r.status === 200 && png, `${r.status} ${r.headers.get('x-captured-via') || ''} ${Buffer.isBuffer(r.body) ? r.body.length : JSON.stringify(r.body)} bytes`);
    r = await api('GET', `/api/activesync/host/${id}/diagnostics?lines=500`);
    const diag = Buffer.isBuffer(r.body) ? r.body.toString('utf8') : '';
    if (diag) fs.writeFileSync(path.join(tmp, 'diag.txt'), diag);
    ok('diagnostic bundle', r.status === 200 && /systemctl --failed/.test(diag) && /journal/.test(diag) && !/connect\.sid=harness/.test(diag), `${diag.length} chars -> ${path.join(tmp, 'diag.txt')}`);
    // a file put (resumable upload, then the machine pulls it in ranges) and a get (with a Range)
    const data = crypto.randomBytes(9 * 1024 * 1024 + 123);
    r = await api('POST', `/api/activesync/upload/${id}/begin`, { root: 'fs', dir: '/tmp/as-harness', name: 'blob.bin', size: data.length, conflict: 'replace', mkdirs: true });
    const up = r.body.id;
    for (let off = 0; off < data.length; off += 4 * 1024 * 1024) {
        r = await api('POST', `/api/activesync/upload/${up}/chunk?offset=${off}`, data.subarray(off, off + 4 * 1024 * 1024), true);
    }
    r = await api('POST', `/api/activesync/upload/${up}/commit`, {});
    ok('file put', r.status === 200 && r.body.entry && r.body.entry.size === data.length, JSON.stringify(r.body.entry));
    r = await api('GET', `/api/activesync/file/${id}/fs/tmp/as-harness/blob.bin`);
    ok('file get', r.status === 200 && Buffer.isBuffer(r.body) && r.body.equals(data), `${r.body.length} bytes`);
    const rr = await fetch(`${base}/api/activesync/file/${id}/fs/tmp/as-harness/blob.bin`, { headers: Object.assign({ Range: 'bytes=100-199' }, H) });
    const part = Buffer.from(await rr.arrayBuffer());
    ok('file get with a Range', rr.status === 206 && part.equals(data.subarray(100, 200)), `${rr.status} ${rr.headers.get('content-range')}`);
    r = await api('POST', `/api/activesync/host/${id}/shell`, { command: 'sha256sum /tmp/as-harness/blob.bin; stat -c "%U %s" /tmp/as-harness/blob.bin; rm -rf /tmp/as-harness', root: true });
    ok('the file on the machine', r.status === 200 && r.body.output.includes(crypto.createHash('sha256').update(data).digest('hex')), r.body.output.trim().replace(/\n/g, ' | '));
    // as_call from a computer tab may not run host commands (only the audited routes)
    const log = as.getLog(gr, id, 20).map((l) => l.text);
    ok('every command is in the device log', log.some((t) => /Remote: shell/.test(t)) && log.some((t) => /Remote: stream.receive/.test(t)), log.slice(0, 6).join(' / '));
}

server.listen(PORT, '0.0.0.0', () => {
    console.log(`CaféReady ActiveSync harness on :${PORT} (database ${tmp})`);
    if (DRIVE) drive().then(() => { console.log('drive done'); if (!args.includes('--stay')) process.exit(process.exitCode || 0); }, (e) => { console.error(e); process.exit(1); });
});
