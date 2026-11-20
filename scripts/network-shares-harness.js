'use strict';

/**
 * A test server for Network and shared folders (#910, modules/networkShares.js) without the live Dreamscape: the real
 * Miniport carrier, ActiveSync relay, networkShares and transfer routes on a plain HTTP port, for TWO DreamOS machines
 * (VMs) that each run a CaféReady against it (as scripts/cafeready-host-harness.js does for one):
 *
 *   CAFEREADY_MINIPORT_COOKIE='connect.sid=harness' cafeready run --passive --server http://<this host>:<port> ...
 *
 * Sessions: cookie connect.sid=harness is an administrator, connect.sid=harness-guest the guest account. A "page on
 * machine X" is one riding X's Miniport (its carrier), so this script checks what each machine's own page would see.
 *
 *   node scripts/network-shares-harness.js [--port 18978] [--drive] [--on-a '<cmd prefix>'] [--wait 180]
 *
 * --drive: both machines register; each one's page lists the other and never itself; then, with --on-a (a prefix
 * that runs a shell command on machine A, e.g. "ssh dreamos-vm-a"), A shares a folder (Reader for the guest, Owner
 * for the administrator) and the checks go on from B: the share is listed, browsed, read, written by the
 * administrator, refused to the guest's writes, and gone again after Stop sharing.
 */

const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
const express = require('express');
const WebSocket = require('ws');

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
const PORT = Number(opt('--port', 18978));
const DRIVE = args.includes('--drive');
const WAIT_S = Number(opt('--wait', 180));
const ON_A = opt('--on-a', '');
// A's Local Disk (CaféReady drives.rs: the session user's folder, or CAFEREADY_DRIVES_LOCAL) and how to reach its CaféReady
const A_LOCAL = opt('--a-local', '/home/dream');
const A_SEND = opt('--a-send', 'cafeready send');
const SESSIONS = { harness: 'admin', 'harness-guest': 'readonly' };

const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'netshares-harness-'));
const as = require('../modules/activeSync');
as.resetForTests(tmp);
const host = require('../modules/cafeReadyHost');
const ns = require('../modules/networkShares');
const virtualSocket = require('../modules/ws/virtualSocket');

const fake = {
    clients: new Map(),
    sendToClient(ws, msg) { try { ws.send(JSON.stringify(msg)); } catch (_) { /* closed */ } },
    broadcast() {}
};
const gr = { getPath: () => tmp, getWebSocketServer: () => fake, getConfig: () => ({}) };
const sessionOf = (req) => { const m = /(?:^|;\s*)connect\.sid=([\w-]+)/.exec(String(req.headers.cookie || '')); return m && SESSIONS[m[1]] ? m[1] : null; };

const app = express();
app.use(express.json({ limit: '10mb' }));
const auth = (req, res, next) => {
    const sid = sessionOf(req);
    if (!sid) { res.status(401).json({ success: false, code: 'NOT_SIGNED_IN' }); return; }
    req.userType = SESSIONS[sid];
    req.sessionId = sid;
    next();
};
require('../modules/activeSyncTransfers').mount(app, auth, gr);
host.mount(app, auth, gr);

const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });
const carriers = new Map(); // deviceId -> carrier socket

function connect(vws, req) {
    const sid = sessionOf(req) || 'harness';
    const info = { authenticated: true, userType: SESSIONS[sid], sessionId: sid, clientIP: req.socket && req.socket.remoteAddress, clientId: crypto.randomBytes(6).toString('hex'), light: !!vws.light };
    fake.clients.set(vws, info);
    if (vws.carrier && vws.carrier._dsDevice) carriers.set(vws.carrier._dsDevice, vws.carrier);
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
    vws.on('close', () => { as.onSocketClosed(gr, fake, info); fake.clients.delete(vws); });
}

server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://x');
    if (url.searchParams.get('miniport') !== '1') { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => {
        const sid = sessionOf(req);
        virtualSocket.acceptMiniport(ws, req, { authenticated: !!sid, userType: SESSIONS[sid] || 'admin', sessionId: sid, clientIP: req.socket.remoteAddress }, connect);
    });
});

// ---------------------------------------------------------------- the drive

const base = `http://127.0.0.1:${PORT}`;
async function api(sid, method, p, body, raw) {
    const r = await fetch(base + p, { method, headers: Object.assign({ Cookie: `connect.sid=${sid}` }, body && !raw ? { 'Content-Type': 'application/json' } : {}), body: raw ? body : (body ? JSON.stringify(body) : undefined) });
    const type = r.headers.get('content-type') || '';
    return { status: r.status, body: type.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
}
const ok = (name, cond, extra) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  ${extra}` : ''}`); if (!cond) process.exitCode = 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** What the page on a machine sees: a socket riding that machine's Miniport, signed in as sid. */
const pageOn = (deviceId, sid) => ({ ws: { virtual: true, carrier: carriers.get(deviceId) || { _dsMiniport: true, _dsDevice: deviceId } }, info: { authenticated: true, userType: SESSIONS[sid], sessionId: `${sid}@${deviceId.slice(0, 6)}`, as: { name: 'page' } } });
const viewOn = (deviceId, sid) => { const p = pageOn(deviceId, sid); return ns.computersFor(gr, fake, p.info, p.ws); };
const callOn = (deviceId, sid, data) => { const p = pageOn(deviceId, sid); return ns.shareCall(gr, fake, p.info, p.ws, data); };
const machines = () => as.list(gr, fake).devices.filter((d) => d.platform === 'cafeready' && d.online);
const onA = (cmd) => execSync(`${ON_A} ${JSON.stringify(cmd)}`, { encoding: 'utf8', timeout: 60000 });
async function until(what, fn, s = 60) {
    for (let i = 0; i < s; i++) { const v = fn(); if (v) return v; await sleep(1000); }
    ok(what, false, 'timed out');
    return null;
}

async function drive() {
    const both = await until('two CaféReady machines registered', () => (machines().length >= 2 ? machines() : null), WAIT_S);
    if (!both) return;
    let [a, b] = both.sort((x, y) => x.name.localeCompare(y.name));
    console.log(`      A = ${a.name} (${a.deviceId.slice(0, 8)}), B = ${b.name} (${b.deviceId.slice(0, 8)})`);
    const va = viewOn(a.deviceId, 'harness');
    const vb = viewOn(b.deviceId, 'harness');
    ok("A's page never lists A", !va.computers.some((c) => c.deviceId === a.deviceId), JSON.stringify(va.computers.map((c) => c.name)));
    ok("A's page lists B", va.computers.some((c) => c.deviceId === b.deviceId));
    ok("B's page never lists B", !vb.computers.some((c) => c.deviceId === b.deviceId), JSON.stringify(vb.computers.map((c) => c.name)));
    ok("B's page lists A (shares or not)", vb.computers.some((c) => c.deviceId === a.deviceId), JSON.stringify(vb.computers.find((c) => c.deviceId === a.deviceId)));
    if (!ON_A) { console.log('      (give --on-a to go on with sharing a folder on A)'); return; }

    onA(`mkdir -p ${A_LOCAL}/nstest/sub && echo hello-from-a > ${A_LOCAL}/nstest/hello.txt && chown -R dream: ${A_LOCAL}/nstest || true`);
    const shared = onA(`${A_SEND} shares share '{"drive":"local-disk","path":"/nstest","name":"NSTest","people":[{"account":"administrator","level":"owner"},{"account":"guest","level":"reader"}]}'`);
    console.log(`      on A: ${shared.slice(0, 300)}`);
    // A is the machine --on-a reaches (its own deviceId in the answer)
    const aid = (/"deviceId":"([0-9a-f]{32})"/.exec(shared) || [])[1];
    if (aid && aid === b.deviceId) [a, b] = [b, a];
    const listed = await until('B sees A\'s new share (pushed status)', () => {
        const c = viewOn(b.deviceId, 'harness').computers.find((x) => x.deviceId === a.deviceId);
        return c && c.shares.find((s) => s.name === 'NSTest');
    });
    if (!listed) return;
    ok('the administrator (Owner) has full access', listed.access === 'full', listed.access);
    const g = viewOn(b.deviceId, 'harness-guest').computers.find((x) => x.deviceId === a.deviceId).shares.find((s) => s.name === 'NSTest');
    ok('the guest (Reader) has read access', g && g.access === 'read', g && g.access);
    let r = await callOn(b.deviceId, 'harness', { deviceId: a.deviceId, share: 'NSTest', op: 'list', path: '/' });
    ok('browse the share from B', r.result && r.result.entries.some((e) => e.name === 'hello.txt') && r.result.entries.every((e) => !String(e.path).startsWith('/data')), JSON.stringify(r.result.entries.map((e) => e.path)));
    try { await callOn(b.deviceId, 'harness', { deviceId: a.deviceId, share: 'NSTest', op: 'list', path: '/../..' }); ok('.. cannot leave the share', false); } catch (e) { ok('.. cannot leave the share', true, e.code); }
    const got = await api('harness-guest', 'GET', `/api/activesync/file/${a.deviceId}/share/NSTest/hello.txt`);
    ok('the guest reads a file (transfer route)', got.status === 200 && String(got.body).includes('hello-from-a'), `${got.status}`);
    const data = crypto.randomBytes(5 * 1024 * 1024 + 7);
    const put = async (sid, name) => {
        let x = await api(sid, 'POST', `/api/activesync/upload/${a.deviceId}/begin`, { root: 'share', dir: '/NSTest/sub', name, size: data.length, conflict: 'replace' });
        if (x.status !== 200) return x;
        const id = x.body.id;
        for (let off = 0; off < data.length; off += 4 * 1024 * 1024) x = await api(sid, 'POST', `/api/activesync/upload/${id}/chunk?offset=${off}`, data.subarray(off, off + 4 * 1024 * 1024), true);
        return api(sid, 'POST', `/api/activesync/upload/${id}/commit`, {});
    };
    r = await put('harness', 'from-b.bin');
    ok('the administrator copies a file into the share', r.status === 200 && r.body.entry && r.body.entry.size === data.length, JSON.stringify(r.body.entry || r.body));
    r = await put('harness-guest', 'guest.bin');
    ok('a Reader cannot write into it', r.status === 403 && r.body.code === 'ACCESS_DENIED', `${r.status} ${r.body.code}`);
    try { await callOn(b.deviceId, 'harness-guest', { deviceId: a.deviceId, share: 'NSTest', op: 'mkdir', path: '/new' }); ok('a Reader cannot make a folder', false); } catch (e) { ok('a Reader cannot make a folder', e.code === 'ACCESS_DENIED', e.code); }
    ok('the file is on A', onA(`sha256sum ${A_LOCAL}/nstest/sub/from-b.bin`).includes(crypto.createHash('sha256').update(data).digest('hex')));
    console.log(`      on A: ${onA(`${A_SEND} shares stop '{"name":"NSTest"}' | head -c 200`)}`);
    const gone = await until('Stop sharing: the share leaves B\'s list', () => {
        const c = viewOn(b.deviceId, 'harness').computers.find((x) => x.deviceId === a.deviceId);
        return c && !c.shares.some((s) => s.name === 'NSTest');
    });
    if (gone) {
        try { await callOn(b.deviceId, 'harness', { deviceId: a.deviceId, share: 'NSTest', op: 'list', path: '/' }); ok('and it can no longer be opened', false); } catch (e) { ok('and it can no longer be opened', e.code === 'NO_SUCH_SHARE', e.code); }
        ok('A still listed after Stop sharing', viewOn(b.deviceId, 'harness').computers.some((c) => c.deviceId === a.deviceId));
    }
    onA(`rm -rf ${A_LOCAL}/nstest`);
}

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Network shares harness on :${PORT} (database ${tmp})`);
    if (DRIVE) drive().then(() => { console.log('drive done'); if (!args.includes('--stay')) process.exit(process.exitCode || 0); }, (e) => { console.error(e); process.exit(1); });
});
