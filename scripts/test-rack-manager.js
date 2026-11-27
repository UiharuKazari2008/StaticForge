'use strict';

// Rack Manager server side (modules/rackManager, the rack_* WS handler, rack.sock, the iLO service's LAN allowlist).
// A fake rackd (HTTP + SSE on a local port, config override rackdUrl: no tunnel) and a fake iLO service (HTTP on a
// unix socket). Covers: the guard, confirm rules, audit lines, event fan-out start / stop on subscribe /
// unsubscribe, rack.sock round trip, the supervisor-run tunnel (a fake ssh) and the LAN allowlist.
//
// node scripts/test-rack-manager.js

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const net = require('net');
const { EventEmitter } = require('events');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-rack-manager-test-'));
const TOKEN_FILE = path.join(SANDBOX, 'rackd.token');
fs.writeFileSync(TOKEN_FILE, 'test-token-123\n');
process.env.RACK_MANAGER_DISABLED = '0';

const rack = require('../modules/rackManager');
const wsPacketRegistry = require('../modules/ws/wsPacketRegistry');
const handler = require('../modules/ws/handlers/322-rackManagerHandler');
const ilo = require('../modules/rackManager/ilo/lan.js');

let passed = 0;
const failures = [];
async function t(name, fn) {
    try { await fn(); passed += 1; console.log(`ok   ${name}`); } catch (e) { failures.push(name); console.log(`FAIL ${name}\n     ${e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n     ') : e}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(20); } return false; };

// ---------------------------------------------------------------- fakes
const rackdLog = [];
let sseOpen = 0;
let sseOpened = 0;
let sseRes = null;
let idleState = { idle: false, idleSince: 0, busy: [{ kind: 'job', id: 'j1', why: 'apt' }] };
const fakeRackd = http.createServer((req, res) => {
    if (req.headers.authorization !== 'Bearer test-token-123') { res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end('{"error":"unauthorized"}'); }
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
        const u = new URL(req.url, 'http://x');
        rackdLog.push(`${req.method} ${u.pathname}${body ? ' ' + body : ''}`);
        const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
        if (u.pathname === '/v1/events') {
            sseOpen += 1; sseOpened += 1; sseRes = res;
            res.writeHead(200, { 'Content-Type': 'text/event-stream' });
            res.write(': ping\n\n');
            res.on('close', () => { sseOpen -= 1; });
            return;
        }
        if (u.pathname === '/v1/metrics/history') return json(200, { range: u.searchParams.get('range'), points: Number(u.searchParams.get('points')), samples: [{ t: 1, cpu: 3, load: [0.1, 0.2, 0.3], counts: { vms: 2 } }], junk: u.searchParams.get('evil') });
        if (u.pathname === '/v1/idle') return json(200, idleState);
        if (u.pathname === '/v1/host/shutdown') return json(202, { ok: true });
        if (u.pathname === '/v1/info') return json(200, { host: 'fake', roles: { vms: { installed: true, ready: true, summary: '3 VMs', missing: [] } } });
        if (u.pathname === '/v1/jobs') return json(200, [{ id: 'j1', role: 'updates', title: 'apt', state: 'running' }, { id: 'j0', state: 'done' }]);
        if (u.pathname === '/v1/builds') return json(200, { pipelines: [], runs: [{ id: 'r1', pipeline: 'dsapp', ref: 'main', state: 'running', by: 'x' }, { id: 'r0', state: 'done' }] });
        if (u.pathname === '/v1/jobs/j1/cancel') return json(200, { id: 'j1', state: 'cancelled' });
        if (u.pathname === '/v1/vms' && req.method === 'GET') return json(200, { vms: [] });
        if (u.pathname === '/v1/vms/destroy') return json(200, { ok: true });
        if (u.pathname === '/v1/vms/clone') return json(202, { job: { id: 'j2' } });
        if (u.pathname === '/v1/terminal/exec') return json(200, { code: 0, stdout: 'hi\n', stderr: '', ms: 3 });
        if (u.pathname === '/v1/files/artifacts/r1/app.apk') { res.writeHead(req.headers.range ? 206 : 200, { 'Content-Type': 'application/octet-stream', 'Accept-Ranges': 'bytes' }); return res.end('APKDATA'); }
        return json(404, { error: 'no such thing', code: 'NOT_FOUND' });
    });
});

const iloLog = [];
const iloClients = new Set();
const emitIlo = (o) => iloClients.forEach((c) => c.write(`data: ${JSON.stringify(o)}\n\n`));
const ILO_SOCK = path.join(SANDBOX, 'ilo.sock');
const fakeIlo = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
        iloLog.push(`${req.method} ${req.url}${body ? ' ' + body : ''}`);
        const json = (obj) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
        if (req.url === '/api/power-events') { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(': hello\n\n'); iloClients.add(res); res.on('close', () => iloClients.delete(res)); return; }
        if (req.url === '/api/servers') return json([{ name: 'misaka', label: 'Misaka', gen: 3, driveLayout: [['1']], sensorNames: { 'Temp 1': 'x' }, driveTemp: 'Temp 17', connected: true, power: true }, { name: 'pwr', connected: false, power: null }]);
        if (req.url.startsWith('/api/misaka/health')) return json({ HEALTH_AT_A_GLANCE: {} });
        if (req.url === '/api/isos') return json([{ name: 'a.iso', size: 3, url: 'http://x/iso/a.iso' }]);
        if (req.url.startsWith('/api/iso/upload')) return json({ ok: true, name: new URL(req.url, 'http://x').searchParams.get('name'), bytes: body.length });
        if (/^\/api\/\w+\/ilo\/users$/.test(req.url)) return json([{ login: 'bob' }]);
        if (/^\/api\/\w+\/powerop$/.test(req.url)) return json({ ok: true });
        res.writeHead(404); res.end('{}');
    });
});

const listen = (srv, arg) => new Promise((r) => srv.listen(arg, r));
const auditLines = () => { try { return fs.readFileSync(path.join(SANDBOX, 'audit.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch (_) { return []; } };
const sockAsk = (file, req, wait = true) => new Promise((resolve, reject) => {
    let buf = '';
    const s = net.createConnection(file, () => s.write(`${JSON.stringify(req)}\n`));
    s.setEncoding('utf8');
    s.on('data', (c) => { buf += c; if (!wait && buf.includes('\n')) resolve({ sock: s, first: JSON.parse(buf.split('\n')[0]) }); });
    s.on('end', () => { try { resolve(JSON.parse(buf.trim())); } catch (e) { reject(e); } });
    s.on('error', reject);
});

function fakeWs() {
    const ws = new EventEmitter();
    ws.sent = [];
    return ws;
}

(async () => {
    await listen(fakeRackd, 0);
    await listen(fakeIlo, ILO_SOCK);
    const pstate0 = (n) => rack.powerBrief(n).state;
    const rackdUrl = `http://127.0.0.1:${fakeRackd.address().port}`;
    const SOCK = path.join(SANDBOX, 'rack.sock');
    rack._test.setRoot(SANDBOX);
    rack._test.setNoSpawn(true);
    rack._test.setIloSock(ILO_SOCK);
    rack._test.setSocket(SOCK);
    rack._test.setServers([
        { name: 'misaka', label: 'Fat Misaka', model: 'DL580', ilo: 'misaka', host: '127.0.0.1', ssh: 'fat-misaka', rackdPort: 8791, tokenFile: TOKEN_FILE, rackdUrl },
        { name: 'asuka', label: 'Chubby Asuka', model: 'DL380', ilo: 'asuka', host: '127.0.0.1', ssh: 'chubby-asuka', rackdPort: 8791, tokenFile: path.join(SANDBOX, 'missing.token') }
    ]);
    rack._test.serveSocket();
    await sleep(100);

    await t('servers.json defaults are created when missing', async () => {
        const dir = fs.mkdtempSync(path.join(SANDBOX, 'defaults-'));
        rack._test.setRoot(dir);
        const list = rack.loadServers();
        assert.deepStrictEqual(list.map((s) => s.name), ['misaka', 'asuka']);
        assert.ok(fs.existsSync(path.join(dir, 'servers.json')));
        // back to the fixture
        rack._test.setRoot(SANDBOX);
        rack._test.setServers([
            { name: 'misaka', label: 'Fat Misaka', model: 'DL580', ilo: 'misaka', host: '127.0.0.1', ssh: 'fat-misaka', rackdPort: 8791, tokenFile: TOKEN_FILE, rackdUrl },
            { name: 'asuka', label: 'Chubby Asuka', model: 'DL380', ilo: 'asuka', host: '127.0.0.1', ssh: 'chubby-asuka', rackdPort: 8791, tokenFile: path.join(SANDBOX, 'missing.token') }
        ]);
    });

    await t('list: rackd up with info, iLO from the iLO service, a missing token is not-deployed', async () => {
        const l = await rack.list();
        const m = l.find((s) => s.name === 'misaka');
        assert.strictEqual(m.rackd.state, 'up');
        assert.strictEqual(m.rackd.info.host, 'fake');
        assert.deepStrictEqual(m.ilo, { connected: true, power: true });
        assert.strictEqual(l.find((s) => s.name === 'asuka').rackd.state, 'not-deployed');
    });

    await t('get / action: bearer token from the token file, result vs job, role validation', async () => {
        assert.deepStrictEqual((await rack.get('misaka', 'vms')).data, { vms: [] });
        const r = await rack.action('misaka', 'vms', 'clone', { source: 'a', name: 'b' }, { via: 'ws', who: 'u' });
        assert.deepStrictEqual(r, { job: { id: 'j2' } });
        await assert.rejects(rack.get('misaka', 'nope'), (e) => e.code === 'BAD_REQUEST');
        await assert.rejects(rack.get('misaka', 'containers'), (e) => e.code === 'RACKD_ERROR');
        await assert.rejects(rack.get('asuka', 'vms'), (e) => e.code === 'NOT_DEPLOYED');
        await assert.rejects(rack.get('nowhere', 'vms'), (e) => e.code === 'UNKNOWN_SERVER');
    });

    await t('metrics role: GET only, range/points passed, other params dropped, HOST_OFF like any role', async () => {
        const g = await rack.get('misaka', 'metrics', { range: '1h', points: 90, evil: 'x' });
        assert.deepStrictEqual([g.role, g.data.range, g.data.points, g.data.junk], ['metrics', '1h', 90, null]);
        await assert.rejects(rack.action('misaka', 'metrics', 'x', {}, { via: 'ws', who: 'u' }), (e) => e.code === 'BAD_REQUEST');
        const r = await sockAsk(SOCK, { op: 'role', server: 'misaka', role: 'metrics', params: { range: '6h' } });
        assert.strictEqual(r.result.data.range, '6h');
        const off = rack._test.rtOf('asuka');
        off.power.state = 'off';
        await assert.rejects(rack.get('asuka', 'metrics', {}), (e) => e.code === 'HOST_OFF');
        off.power.state = 'unknown';
    });

    await t('confirm rules: Fleet needs confirm:true for destructive actions, WS does not', async () => {
        const fleet = { via: 'fleet', who: 'agent:a1' };
        for (const [role, act, p] of [['vms', 'destroy', { name: 'x' }], ['vms', 'delete', { name: 'x' }], ['storage', 'lv-delete', {}], ['storage', 'ramdisk-delete', { sync: false }],
            ['android', 'delete', {}], ['containers', 'prune', {}], ['containers', 'remove', {}], ['builds', 'pipeline-delete', {}], ['builds', 'artifact-remove', {}]]) {
            await assert.rejects(rack.action('misaka', role, act, p, fleet), (e) => e.code === 'CONFIRM_REQUIRED', `${role} ${act}`);
        }
        await assert.rejects(rack.iloAction('misaka', 'power', { op: 'press' }, fleet), (e) => e.code === 'CONFIRM_REQUIRED');
        const before = rackdLog.length;
        assert.deepStrictEqual(await rack.action('misaka', 'vms', 'destroy', { name: 'x', confirm: true }, fleet), { result: { ok: true } });
        assert.ok(rackdLog.length > before);
        assert.deepStrictEqual(await rack.action('misaka', 'vms', 'destroy', { name: 'y' }, { via: 'ws', who: 'u' }), { result: { ok: true } });
        assert.strictEqual(rack.needsConfirm('storage', 'ramdisk-delete', {}), false);
        assert.strictEqual(rack.needsConfirm('vms', 'start', {}), false);
    });

    await t('iLO power: press/hold/cold/reset map to ops 0-3 on the iLO service; bad op refused', async () => {
        iloLog.length = 0;
        for (const op of ['press', 'hold', 'cold', 'reset']) await rack.iloAction('misaka', 'power', { op, confirm: true }, { via: 'fleet', who: 'agent:a' });
        assert.deepStrictEqual(iloLog.map((l) => l.replace(/^POST \/api\/misaka\/powerop /, '')), ['{"op":0}', '{"op":1}', '{"op":2}', '{"op":3}']);
        await assert.rejects(rack.iloAction('misaka', 'power', { op: 'explode' }, { via: 'ws' }), (e) => e.code === 'BAD_REQUEST');
        assert.deepStrictEqual((await rack.iloGet('misaka', 'health', {})).data, { HEALTH_AT_A_GLANCE: {} });
    });

    await t('audit: one line per write with who / via / server / role / action, secrets dropped, failures logged, reads not logged', async () => {
        await rack.action('misaka', 'terminal', 'exec', { cmd: 'echo hi', password: 'hunter2', token: 'abc', nested: { apiKey: 'k', ok: 1 } }, { via: 'ws', who: 'yukimi' });
        await assert.rejects(rack.action('misaka', 'nothing', 'x', {}, { via: 'ws', who: 'yukimi' }));
        await assert.rejects(rack.action('misaka', 'containers', 'start', { id: 'z' }, { via: 'ws', who: 'yukimi' }));
        const lines = auditLines();
        const exec = lines.find((l) => l.action === 'exec');
        assert.strictEqual(exec.who, 'yukimi'); assert.strictEqual(exec.via, 'ws'); assert.strictEqual(exec.server, 'misaka'); assert.strictEqual(exec.role, 'terminal'); assert.strictEqual(exec.ok, true);
        assert.deepStrictEqual(exec.params, { cmd: 'echo hi', nested: { ok: 1 } });
        assert.ok(!JSON.stringify(lines).includes('hunter2'));
        assert.ok(lines.some((l) => l.ok === false && l.role === 'containers' && l.error));
        assert.ok(lines.some((l) => l.role === 'ilo' && l.action === 'power'));
        assert.ok(!lines.some((l) => l.action === 'vms' || l.role === 'vms' && l.action === undefined));
        await rack.get('misaka', 'vms');
        assert.strictEqual(auditLines().length, lines.length);
    });

    await t('event fan-out: SSE opens with the first subscriber, closes with the last, nothing before', async () => {
        assert.strictEqual(sseOpen, 0);
        await rack.list(); await rack.get('misaka', 'vms');
        assert.strictEqual(sseOpened, 0, 'no stream without a subscriber');
        const got1 = []; const got2 = [];
        rack.subscribe('misaka', 'k1', (e) => got1.push(e));
        assert.ok(await until(() => sseOpen === 1));
        rack.subscribe('misaka', 'k2', (e) => got2.push(e));
        await sleep(100);
        assert.strictEqual(sseOpened, 1, 'one stream for two subscribers');
        sseRes.write('event: rack\ndata: {"role":"vms","kind":"state","id":"a","data":{"state":"running"}}\n\n');
        assert.ok(await until(() => got1.length === 1 && got2.length === 1));
        assert.deepStrictEqual(got1[0], { server: 'misaka', role: 'vms', kind: 'state', id: 'a', data: { state: 'running' } });
        assert.strictEqual(rack.subscriberCount('misaka'), 2);
        rack.unsubscribe('misaka', 'k1');
        await sleep(100);
        assert.strictEqual(sseOpen, 1);
        rack.unsubscribe('misaka', 'k2');
        assert.ok(await until(() => sseOpen === 0), 'last unsubscribe closes the stream');
        assert.strictEqual(rack.streamOpen('misaka'), false);
        // a dropped stream is retried only while subscribed
        rack.subscribe('misaka', 'k3', () => {});
        assert.ok(await until(() => sseOpen === 1));
        sseRes.destroy();
        assert.ok(await until(() => sseOpened >= 3, 5000), 'reconnects while subscribed');
        rack.unsubscribeAll('k3');
        assert.ok(await until(() => sseOpen === 0));
        const opened = sseOpened;
        await sleep(2500);
        assert.strictEqual(sseOpened, opened, 'no reconnect after the last unsubscribe');
    });

    await t('rack.sock round trip: status (with running jobs and build runs), role, exec, job, bad op', async () => {
        const st = await sockAsk(SOCK, { op: 'status' });
        assert.ok(st.ok);
        const m = st.result.servers.find((s) => s.name === 'misaka');
        assert.strictEqual(m.rackd.state, 'up');
        assert.deepStrictEqual(m.jobs.map((j) => j.id), ['j1']);
        assert.deepStrictEqual(m.builds.map((b) => b.id), ['r1']);
        assert.strictEqual(m.roles.vms.summary, '3 VMs');
        assert.strictEqual((await sockAsk(SOCK, { op: 'role', server: 'misaka', role: 'vms' })).result.data.vms.length, 0);
        const ex = await sockAsk(SOCK, { op: 'exec', server: 'misaka', cmd: 'echo hi', by: 'a9' });
        assert.strictEqual(ex.result.result.stdout, 'hi\n');
        assert.ok(auditLines().some((l) => l.who === 'agent:a9' && l.via === 'fleet' && l.action === 'exec'));
        const refused = await sockAsk(SOCK, { op: 'role', server: 'misaka', role: 'vms', action: 'destroy', params: { name: 'q' }, by: 'a9' });
        assert.strictEqual(refused.ok, false); assert.strictEqual(refused.code, 'CONFIRM_REQUIRED');
        assert.strictEqual((await sockAsk(SOCK, { op: 'role', server: 'misaka', role: 'vms', action: 'destroy', params: { name: 'q', confirm: true }, by: 'a9' })).ok, true);
        assert.strictEqual((await sockAsk(SOCK, { op: 'job', server: 'misaka', id: 'j1', cancel: true, by: 'a9' })).result.job.state, 'cancelled');
        assert.strictEqual((await sockAsk(SOCK, { op: 'role', server: 'misaka', role: 'ilo', action: 'power', params: { op: 'press' }, by: 'a9' })).code, 'CONFIRM_REQUIRED');
        assert.strictEqual((await sockAsk(SOCK, { op: 'nope' })).ok, false);
        assert.strictEqual((await sockAsk(SOCK, { op: 'status', server: 'nowhere' })).code, 'UNKNOWN_SERVER');
    });

    await t('rack.sock follow: a Fleet follow is a subscriber (stream opens, events arrive, closing the socket closes the stream)', async () => {
        const { sock, first } = await sockAsk(SOCK, { op: 'follow', server: 'misaka' }, false);
        assert.strictEqual(first.follow, true);
        assert.ok(await until(() => sseOpen === 1));
        sseRes.write('data: {"role":"android","kind":"added","id":"x","data":{}}\n\n');
        const line = await new Promise((r) => sock.once('data', (c) => r(JSON.parse(String(c).trim()))));
        assert.strictEqual(line.event.role, 'android');
        sock.destroy();
        assert.ok(await until(() => sseOpen === 0));
    });

    await t('WS guard: only a full admin sign-in; expected refusals come back in the response', async () => {
        wsPacketRegistry.withRegistrar('rack-test', () => handler.registerPackets());
        const call = async (type, msg, info, session) => {
            const sent = []; const errors = [];
            const ws = fakeWs();
            await wsPacketRegistry.getWsPacketHandler(type)({
                ws, message: Object.assign({ requestId: 'r1' }, msg), clientInfo: info,
                wsServer: { sendToClient: (w, p) => sent.push(p) },
                handlers: { sendError: (w, text, code) => errors.push(code), globalResources: { getSessionStore: () => ({ get: (id, cb) => cb(null, session) }) } }
            });
            return { sent, errors, ws };
        };
        const admin = { authenticated: true, userType: 'admin', sessionId: 's1', authMethod: 'session', userName: 'yukimi' };
        const full = { authenticated: true, userType: 'admin' };
        const good = await call('rack_list', {}, admin, full);
        assert.strictEqual(good.errors.length, 0);
        assert.strictEqual(good.sent[0].type, 'rack_list_response');
        assert.strictEqual(good.sent[0].data.servers.length, 2);
        const user = await call('rack_list', {}, Object.assign({}, admin, { userType: 'user' }), full);
        assert.deepStrictEqual(user.errors, ['INSUFFICIENT_PERMISSIONS']);
        const key = await call('rack_action', { server: 'misaka', role: 'vms', action: 'start', params: {} }, Object.assign({}, admin, { authMethod: 'application_key' }), full);
        assert.deepStrictEqual(key.errors, ['INSUFFICIENT_PERMISSIONS']);
        const cert = await call('rack_action', { server: 'misaka', role: 'vms', action: 'start', params: {} }, admin, { authenticated: true, userType: 'admin', clientCertSerial: 'abc' });
        assert.deepStrictEqual(cert.errors, ['INSUFFICIENT_PERMISSIONS']);
        const refused = await call('rack_get', { server: 'asuka', role: 'vms' }, admin, full);
        assert.strictEqual(refused.errors.length, 0);
        assert.strictEqual(refused.sent[0].data.success, false);
        assert.strictEqual(refused.sent[0].data.code, 'NOT_DEPLOYED');
        const act = await call('rack_action', { server: 'misaka', role: 'vms', action: 'clone', params: { source: 'a', name: 'b' } }, admin, full);
        assert.deepStrictEqual(act.sent[0].data.job, { id: 'j2' });
        assert.ok(auditLines().some((l) => l.who === 'yukimi' && l.via === 'ws' && l.action === 'clone'));
        const ia = await call('rack_ilo_action', { server: 'misaka', action: 'power', params: { op: 'press' } }, admin, full);
        assert.strictEqual(ia.sent[0].data.success, true);
        // subscribe pushes rack_event to that socket, close ends it
        const sub = await call('rack_subscribe', { server: 'misaka' }, admin, full);
        assert.strictEqual(sub.sent[0].data.success, true);
        assert.ok(await until(() => sseOpen === 1));
        sub.ws.emit('close');
        assert.ok(await until(() => sseOpen === 0), 'socket close unsubscribes');
    });

    await t('HTTP guard and files: full admin only; artifacts stream with Range', async () => {
        const express = require('express');
        const app = express();
        let who = { userType: 'admin', session: { authenticated: true, userType: 'admin' } };
        const auth = (req, res, next) => { Object.assign(req, who); next(); };
        rack.mount(app, auth);
        const srv = http.createServer(app);
        await listen(srv, 0);
        const get = (p, headers) => new Promise((resolve) => http.get({ port: srv.address().port, path: p, headers }, (r) => { let b = ''; r.on('data', (c) => { b += c; }); r.on('end', () => resolve({ status: r.statusCode, body: b, headers: r.headers })); }));
        const ok = await get('/rack/misaka/files/artifacts/r1/app.apk', { Range: 'bytes=0-3' });
        assert.strictEqual(ok.status, 206); assert.strictEqual(ok.body, 'APKDATA');
        assert.strictEqual((await get('/rack/misaka/files/artifacts/r1/..%2f..%2fetc')).status, 400);
        assert.strictEqual((await get('/rack/nowhere/files/shots/a.png')).status, 404);
        assert.strictEqual((await get('/rack/asuka/files/shots/a.png')).status, 503);
        who = { userType: 'admin', applicationAuth: { id: 1 }, session: { authenticated: true, userType: 'admin' } };
        assert.strictEqual((await get('/rack/misaka/files/shots/a.png')).status, 403);
        who = { userType: 'admin', session: { authenticated: true, userType: 'admin', approvedIpId: 3 } };
        assert.strictEqual((await get('/rack/misaka/files/shots/a.png')).status, 403);
        who = { userType: 'user', session: { authenticated: true, userType: 'user' } };
        assert.strictEqual((await get('/rack/misaka/files/shots/a.png')).status, 403);
        srv.close();
    });

    await t('iLO views and writes: servers / isos, user management (dream_admin protected, password never audited), ISO upload streamed', async () => {
        const sv = (await rack.iloGet('misaka', 'servers')).data;
        assert.deepStrictEqual([sv.gen, sv.driveTemp, sv.driveLayout, sv.sensorNames], [3, 'Temp 17', [['1']], { 'Temp 1': 'x' }]);
        assert.strictEqual((await rack.iloGet('misaka', 'isos')).data[0].name, 'a.iso');
        iloLog.length = 0;
        await rack.iloAction('misaka', 'users', { action: 'add', login: 'bob', password: 'Sup3rSecret!', privs: ['ADMIN_PRIV'] }, { via: 'ws', who: 'yukimi' });
        assert.ok(iloLog.some((l) => /POST \/api\/misaka\/ilo\/users/.test(l) && /Sup3rSecret/.test(l)), 'the password reaches the iLO service');
        for (const act of ['add', 'modify', 'delete']) await assert.rejects(rack.iloAction('misaka', 'users', { action: act, login: 'dream_admin', password: 'x' }, { via: 'ws' }), (e) => e.code === 'BAD_REQUEST');
        await assert.rejects(rack.iloAction('misaka', 'users', { action: 'explode', login: 'bob' }, { via: 'ws' }), (e) => e.code === 'BAD_REQUEST');
        await assert.rejects(rack.iloAction('misaka', 'users', { action: 'delete', login: 'bob' }, { via: 'fleet', who: 'agent:a' }), (e) => e.code === 'CONFIRM_REQUIRED');
        await sleep(50);
        assert.ok(!JSON.stringify(auditLines()).includes('Sup3rSecret'), 'no password in the audit log');
        assert.ok(auditLines().some((l) => l.role === 'ilo' && l.action === 'users' && l.params.login === 'bob'));
        const express = require('express');
        const app = express();
        let ok = true;
        rack.mount(app, (req, res, next) => { Object.assign(req, { userType: ok ? 'admin' : 'user', session: { authenticated: true, userType: ok ? 'admin' : 'user' } }); next(); });
        const srv = http.createServer(app); await listen(srv, 0);
        const post = (p, data) => new Promise((resolve) => { const r = http.request({ port: srv.address().port, path: p, method: 'POST' }, (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, body: b })); }); r.end(data); });
        const up = await post('/rack/misaka/ilo/iso-upload?name=t.iso', 'ISO-BYTES');
        assert.strictEqual(up.status, 200); assert.deepStrictEqual(JSON.parse(up.body), { ok: true, name: 't.iso', bytes: 9 });
        assert.strictEqual((await post('/rack/misaka/ilo/iso-upload?name=../evil.sh', 'x')).status, 400);
        ok = false;
        assert.strictEqual((await post('/rack/misaka/ilo/iso-upload?name=t.iso', 'x')).status, 403);
        srv.close();
    });

    await t('iLO pushes: power and health changes of the iLO service reach subscribers as rack_event role ilo', async () => {
        rack._test.setServers([{ name: 'misaka', label: 'Fat Misaka', model: 'DL580', ilo: 'misaka', host: '127.0.0.1', ssh: 'fat-misaka', rackdPort: 8791, tokenFile: TOKEN_FILE, rackdUrl }]);
        rack._test.startIloFeed();
        assert.ok(await until(() => iloClients.size === 1));
        const got = [];
        rack.subscribe('misaka', 'ik', (e) => got.push(e));
        emitIlo({ server: 'misaka', on: true, t: 5 });
        emitIlo({ server: 'misaka', health: { colour: 'yellow', glance: { FANS: 'Degraded' } } });
        assert.ok(await until(() => got.some((e) => e.role === 'ilo' && e.kind === 'power' && e.data.on === true) && got.some((e) => e.role === 'ilo' && e.kind === 'health' && e.data.colour === 'yellow')));
        rack.unsubscribe('misaka', 'ik');
        assert.ok(await until(() => pstate0('misaka') === 'up'), 'a host that is on is booting, then up once rackd answers');
        rack._test.setPower('misaka', 'off'); // closes the idle stream again
        assert.ok(await until(() => sseOpen === 0));
        rack._test.stopIloFeed();
        assert.ok(await until(() => iloClients.size === 0));
        rack._test.setNoSpawn(true);
    });

    await t('iLO WebSocket upgrade: unauthenticated 401, not full admin 403, other paths untouched', async () => {
        const mkReq = (url, headers) => ({ url, headers: Object.assign({ host: 'x', 'sec-websocket-key': 'k' }, headers || {}) });
        const run = (url, session, headers) => new Promise((resolve) => {
            const sock = new EventEmitter(); sock.end = (s) => resolve(String(s).split('\r\n')[0]); sock.destroy = () => resolve('destroyed');
            const taken = rack.handleUpgrade(mkReq(url, headers), sock, Buffer.alloc(0), (req, res, next) => { req.session = session; next(); });
            if (!taken) resolve('not ours');
        });
        assert.strictEqual(await run('/other/ws', null), 'not ours');
        assert.strictEqual(await run('/rack/misaka/ilo/ws', null), 'HTTP/1.1 401 Unauthorized');
        assert.strictEqual(await run('/rack/misaka/ilo/ws', { authenticated: true, userType: 'user' }), 'HTTP/1.1 403 Forbidden');
        assert.strictEqual(await run('/rack/misaka/terminal/ws?cols=80', { authenticated: true, userType: 'admin' }, { origin: 'https://evil.example', host: 'dream' }), 'HTTP/1.1 403 Forbidden');
    });

    // ------------------------------------------------------------ power on demand
    const PWR = { name: 'pwr', label: 'Pwr', model: 'x', ilo: 'pwr', host: '127.0.0.1', ssh: 'pwr', rackdPort: 8791, tokenFile: TOKEN_FILE, rackdUrl, power: { auto: true, idleShutdownMin: 0.02, wakeOnDemand: true } };
    const DEAD = { name: 'dead', label: 'Dead', model: 'x', ilo: 'dead', host: '127.0.0.1', ssh: 'dead', rackdPort: 8791, tokenFile: TOKEN_FILE, rackdUrl: 'http://127.0.0.1:1', power: { auto: false } };
    const fixture = () => rack._test.setServers([PWR, DEAD]);
    const pstate = (n) => rack.powerBrief(n).state;
    const wsCall = async (type, msg, info, session) => {
        const sent = []; const errors = []; const ws = fakeWs();
        await wsPacketRegistry.getWsPacketHandler(type)({ ws, message: Object.assign({ requestId: 'r1' }, msg), clientInfo: info, wsServer: { sendToClient: (w, p) => sent.push(p) },
            handlers: { sendError: (w, text, code) => errors.push(code), globalResources: { getSessionStore: () => ({ get: (id, cb) => cb(null, session) }) } } });
        return { sent, errors, ws };
    };
    const ADMIN = { authenticated: true, userType: 'admin', sessionId: 's1', authMethod: 'session', userName: 'yukimi' };
    const FULL = { authenticated: true, userType: 'admin' };

    await t('power: an off host refuses role calls at once, with no tunnel and no stream attempt; list says so', async () => {
        fixture();
        rack._test.startIloFeed();
        assert.ok(await until(() => iloClients.size === 1));
        emitIlo({ server: 'pwr', on: false });
        assert.ok(await until(() => pstate('pwr') === 'off'));
        const before = rackdLog.length; const opened = sseOpened;
        await assert.rejects(rack.get('pwr', 'vms', undefined, {}), (e) => e.code === 'HOST_OFF' && e.power === 'off');
        await assert.rejects(rack.action('pwr', 'vms', 'start', { name: 'a' }, { via: 'ws', who: 'u' }), (e) => e.code === 'HOST_OFF');
        rack.subscribe('pwr', 'k0', () => {});
        await sleep(150);
        assert.strictEqual(sseOpened, opened, 'no stream against an off host');
        rack.unsubscribe('pwr', 'k0');
        const row = (await rack.list()).find((x) => x.name === 'pwr');
        assert.strictEqual(row.power.state, 'off');
        assert.strictEqual(row.rackd.state, 'down'); assert.ok(/off/.test(row.rackd.error));
        assert.strictEqual(rackdLog.length, before, 'rackd was not called');
        const r = await sockAsk(SOCK, { op: 'role', server: 'pwr', role: 'vms' });
        assert.strictEqual(r.ok, true); assert.deepStrictEqual([r.result.refused, r.result.code, r.result.power], [true, 'HOST_OFF', 'off']);
        assert.strictEqual(rack._test.state().rt.get('pwr').tunnel.state, 'down');
    });

    await t('power: wake:true powers on through the iLO press, pushes POST progress, waits for rackd, audits who/why', async () => {
        iloLog.length = 0;
        const seen = [];
        rack.subscribe('pwr', 'pk', (e) => seen.push(e));
        const call = rack.get('pwr', 'vms', undefined, { wake: true, who: 'agent:w1' });
        assert.ok(await until(() => iloLog.some((l) => /powerop/.test(l))));
        assert.strictEqual(iloLog.filter((l) => /powerop/.test(l)).length, 1);
        assert.strictEqual(iloLog.find((l) => /powerop/.test(l)), 'POST /api/pwr/powerop {"op":0,"watch":true}');
        assert.strictEqual(pstate('pwr'), 'powering-on');
        emitIlo({ server: 'pwr', on: true });
        emitIlo({ server: 'pwr', post: { code: '5218', pct: 40, stage: 'Initialising memory', eta: 90, elapsed: 60, done: false } });
        assert.ok(await until(() => rack.powerBrief('pwr').post && rack.powerBrief('pwr').post.pct === 40));
        assert.ok(seen.some((e) => e.role === 'power' && e.kind === 'state' && e.data.state === 'powering-on' && e.data.post && e.data.post.pct === 40 && e.data.post.stage === 'Initialising memory' && e.data.post.eta === 90 && e.data.post.code === '5218'));
        emitIlo({ server: 'pwr', post: { pct: 100, done: true } });
        assert.deepStrictEqual((await call).data, { vms: [] });
        assert.strictEqual(pstate('pwr'), 'up');
        assert.ok(seen.some((e) => e.data && e.data.state === 'booting') && seen.some((e) => e.data && e.data.state === 'up'));
        const on = auditLines().find((l) => l.role === 'power' && l.action === 'on');
        assert.strictEqual(on.who, 'agent:w1'); assert.strictEqual(on.via, 'wake'); assert.ok(/wake/.test(on.params.reason));
        rack.unsubscribe('pwr', 'pk');
        assert.strictEqual(rack.powerAction ? (await rack.powerAction('pwr', 'on', { via: 'ws', who: 'u' })).state : '', 'up');
        assert.strictEqual(iloLog.filter((l) => /powerop/.test(l)).length, 1, 'no second press when up');
    });

    await t('power: Fleet off needs confirm, is refused while a lease or busy item is open, fallback never holds or cold boots', async () => {
        const noConfirm = await sockAsk(SOCK, { op: 'power', server: 'pwr', action: 'off', by: 'a1' });
        assert.strictEqual(noConfirm.ok, false); assert.strictEqual(noConfirm.code, 'CONFIRM_REQUIRED');
        const lease = await sockAsk(SOCK, { op: 'lease', server: 'pwr', purpose: 'build', minutes: 30, by: 'a1' });
        assert.ok(lease.ok && lease.result.lease.id);
        const stored = JSON.parse(fs.readFileSync(path.join(SANDBOX, 'leases.json'), 'utf8'));
        assert.ok(stored.some((l) => l.id === lease.result.lease.id && l.purpose === 'build'));
        const refused = await sockAsk(SOCK, { op: 'power', server: 'pwr', action: 'off', confirm: true, by: 'a1' });
        assert.strictEqual(refused.result.refused, true); assert.strictEqual(refused.result.code, 'LEASES_OPEN'); assert.strictEqual(refused.result.leases.length, 1);
        const st = await sockAsk(SOCK, { op: 'power', server: 'pwr', action: 'status' });
        assert.strictEqual(st.result.state, 'up'); assert.strictEqual(st.result.leases.length, 1); assert.deepStrictEqual(Object.keys(st.result.leases[0]).sort(), ['ends', 'id', 'purpose', 'since', 'who']);
        assert.strictEqual(st.result.idle.busy.length, 1, 'rackd busy item is in idle.busy'); assert.strictEqual(st.result.idle.idle, false); assert.strictEqual(st.result.deadline, null);
        assert.deepStrictEqual(st.result.settings, { auto: true, idleShutdownMin: 0.02, wakeOnDemand: true });
        assert.strictEqual((await sockAsk(SOCK, { op: 'lease_release', id: lease.result.lease.id, by: 'a1' })).result.released, true);
        assert.strictEqual(JSON.parse(fs.readFileSync(path.join(SANDBOX, 'leases.json'), 'utf8')).length, 0);
        assert.ok(auditLines().some((l) => l.role === 'lease' && l.action === 'take' && l.who === 'agent:a1'));
        // rackd unreachable: the momentary press (op 0) only
        iloLog.length = 0;
        rack._test.setPower('dead', 'up');
        const r = await rack.powerAction('dead', 'off', { via: 'fleet', who: 'agent:a2', reason: 'test', confirm: true });
        assert.strictEqual(r.state, 'shutting-down');
        assert.deepStrictEqual(iloLog.filter((l) => /powerop/.test(l)), ['POST /api/dead/powerop {"op":0}']);
        const off = auditLines().find((l) => l.server === 'dead' && l.action === 'off');
        assert.strictEqual(off.params.how, 'ilo-press'); assert.strictEqual(off.who, 'agent:a2');
    });

    await t('power: WS packets rack_power / rack_power_settings, refusals in the response, the console lease follows the socket', async () => {
        const st = await wsCall('rack_power', { server: 'pwr', action: 'status' }, ADMIN, FULL);
        assert.strictEqual(st.sent[0].data.state, 'up'); assert.ok(Array.isArray(st.sent[0].data.leases) && st.sent[0].data.idle && 'deadline' in st.sent[0].data && st.sent[0].data.settings);
        const bad = await wsCall('rack_power', { server: 'pwr', action: 'status' }, Object.assign({}, ADMIN, { userType: 'user' }), FULL);
        assert.deepStrictEqual(bad.errors, ['INSUFFICIENT_PERMISSIONS']);
        const set = await wsCall('rack_power_settings', { server: 'pwr', settings: { idleShutdownMin: 90, auto: true } }, ADMIN, FULL);
        assert.strictEqual(set.sent[0].data.settings.idleShutdownMin, 90);
        assert.strictEqual(JSON.parse(fs.readFileSync(path.join(SANDBOX, 'servers.json'), 'utf8')).find((x) => x.name === 'pwr').power.idleShutdownMin, 90);
        const worse = await wsCall('rack_power_settings', { server: 'pwr', settings: { idleShutdownMin: 0 } }, ADMIN, FULL);
        assert.strictEqual(worse.sent[0].data.code, 'BAD_REQUEST');
        PWR.power.idleShutdownMin = 0.02; // the fixture's fast clock again
        const sub = await wsCall('rack_subscribe', { server: 'pwr' }, ADMIN, FULL);
        assert.ok(await until(() => rack._test.openLeases('pwr').some((l) => l.purpose === 'console' && l.ephemeral !== true && l.key === sub.ws)));
        sub.ws.emit('close');
        assert.ok(await until(() => !rack._test.openLeases('pwr').some((l) => l.purpose === 'console')), 'socket close releases the console lease');
        // busy items from rackd are automatic leases: no deadline while busy
        rack._test.recompute('pwr');
        assert.strictEqual(rack._test.idleDeadline('pwr'), null);
    });

    await t('idle shutdown: one deadline timer, recomputed on rackd idle events and lease changes; shutdown goes through rackd', async () => {
        const r = rack._test.state().rt.get('pwr');
        await sleep(100);
        sseRes.write(`data: ${JSON.stringify({ role: 'host', kind: 'idle', data: { idle: true, idleSince: Date.now() + 60000, busy: [] } })}\n\n`);
        assert.ok(await until(() => r.idleAt !== null));
        const first = r.idleAt;
        assert.ok(first >= Date.now() + 60000, 'deadline follows idleSince');
        const timer = r.idleTimer;
        rack._test.recompute('pwr'); rack._test.recompute('pwr');
        assert.ok(r.idleTimer && r.idleTimer !== timer, 'recompute replaces the one timer');
        // a page holds the host awake: no deadline; release: back
        rack.subscribe('pwr', 'page', () => {}, { lease: true });
        assert.ok(await until(() => r.idleAt === null && r.idleTimer === null));
        rack.unsubscribe('pwr', 'page');
        assert.ok(await until(() => r.idleAt !== null));
        // a timed lease pushes the deadline past its expiry
        const lease = await rack.leaseTake('pwr', { purpose: 'tests', minutes: 5, who: 'agent:l' });
        assert.ok(r.idleAt >= Date.now() + 5 * 60000);
        await rack.leaseRelease(lease.lease.id, { who: 'agent:l' });
        // busy again: no deadline
        sseRes.write(`data: ${JSON.stringify({ role: 'host', kind: 'idle', data: { idle: false, busy: [{ kind: 'vm', id: 'a', why: 'running' }] } })}\n\n`);
        assert.ok(await until(() => r.idleAt === null && r.idleTimer === null));
        // idle since now, a 1.2 s window: the host is shut down by rackd, audited as auto
        idleState = { idle: true, idleSince: Date.now(), busy: [] };
        sseRes.write(`data: ${JSON.stringify({ role: 'host', kind: 'idle', data: idleState })}\n\n`);
        assert.ok(await until(() => rackdLog.some((l) => /POST \/v1\/host\/shutdown/.test(l)), 8000), 'rackd shutdown called');
        assert.ok(/"reason":"idle for/.test(rackdLog.find((l) => /host\/shutdown/.test(l))));
        assert.ok(await until(() => auditLines().some((l) => l.server === 'pwr' && l.role === 'power' && l.action === 'off')));
        assert.strictEqual(pstate('pwr'), 'shutting-down');
        const line = auditLines().find((l) => l.server === 'pwr' && l.role === 'power' && l.action === 'off');
        assert.strictEqual(line.via, 'auto'); assert.strictEqual(line.who, 'rackManager'); assert.strictEqual(line.params.how, 'rackd');
        assert.strictEqual(iloLog.filter((l) => /\/api\/pwr\/powerop/.test(l) && !/"watch"/.test(l)).length, 0, 'no iLO press when rackd answered');
        emitIlo({ server: 'pwr', on: false });
        assert.ok(await until(() => pstate('pwr') === 'off'));
        assert.strictEqual(r.tunnel.state, 'down');
        assert.ok(await until(() => sseOpen === 0), 'the stream is closed once the host is off');
        assert.strictEqual(r.idleTimer, null);
    });

    await t('power: wakeOnDemand off refuses wake; leases survive a restart; no timer without work', async () => {
        await rack.setPowerSettings('pwr', { wakeOnDemand: false }, { via: 'ws', who: 'yukimi' });
        await assert.rejects(rack.get('pwr', 'vms', undefined, { wake: true }), (e) => e.code === 'HOST_OFF');
        const l = await rack.leaseTake('dead', { purpose: 'survive', minutes: 10, who: 'agent:s' });
        const keep = rack.serverOf('dead');
        rack._test.setRoot(SANDBOX);
        rack._test.setServers([PWR, DEAD]);
        rack._test.loadLeases();
        assert.ok(rack._test.openLeases('dead').some((x) => x.id === l.lease.id && x.purpose === 'survive'), 'lease restored from leases.json');
        assert.strictEqual(keep.name, 'dead');
        rack._test.recompute('pwr');
        assert.strictEqual(rack._test.state().rt.has('pwr') ? rack._test.state().rt.get('pwr').idleTimer : null, null);
        rack._test.stopIloFeed();
        rack._test.setServers([
            { name: 'misaka', label: 'Fat Misaka', model: 'DL580', ilo: 'misaka', host: '127.0.0.1', ssh: 'fat-misaka', rackdPort: 8791, tokenFile: TOKEN_FILE, rackdUrl }]);
    });

    await t('tunnel: a supervised ssh (fake) comes up, state connecting -> up, restarts after exit', async () => {
        const fakeSsh = path.join(SANDBOX, 'fake-ssh.js');
        fs.writeFileSync(fakeSsh, `#!/usr/bin/env node
const a = process.argv.slice(2); const l = a[a.indexOf('-L') + 1].split(':');
require('net').createServer((s) => s.destroy()).listen(Number(l[1]), '127.0.0.1');
`);
        fs.chmodSync(fakeSsh, 0o755);
        rack._test.setNoSpawn(false);
        rack._test.setSshCmd(fakeSsh);
        rack._test.setServers([{ name: 'tun', label: 'Tun', model: 'x', ilo: 'tun', host: '127.0.0.1', ssh: 'tun-alias', rackdPort: 8791, tokenFile: TOKEN_FILE }]);
        const states = [];
        rack.events.on('state', (e) => states.push(e.state));
        const tun = await rack._test.ensureTunnel('tun', 10000);
        assert.strictEqual(tun.state, 'up');
        assert.ok(states.includes('connecting') && states.includes('up'));
        // kill the fake ssh: the supervisor restarts it (backoff 2 s) and the state follows
        const { execFileSync } = require('child_process');
        execFileSync('pkill', ['-f', fakeSsh]);
        assert.ok(await until(() => states.includes('down'), 4000));
        assert.ok(await until(() => rack._test.rtOf('tun').tunnel.state === 'up', 9000), 'tunnel back up after the restart');
        await rack.stop();
        rack._test.setNoSpawn(true);
    });

    await t('LAN allowlist: iso GET/HEAD any LAN source; health/history/power GET only from 192.168.100.40-43; all else refused', async () => {
        const a = ilo.lanAllowed;
        assert.ok(a('GET', '/iso/debian.iso', '192.168.100.43'));
        assert.ok(a('HEAD', '/iso/debian.iso', '192.168.100.77'));
        assert.ok(!a('POST', '/iso/debian.iso', '192.168.100.43'));
        assert.ok(!a('GET', '/iso/a/b.iso', '192.168.100.43'));
        for (const p of ['health', 'history', 'power']) {
            assert.ok(a('GET', `/api/misaka/${p}`, '192.168.100.42'), p);
            assert.ok(a('GET', `/api/misaka/${p}?range=1h&points=90`, '::ffff:192.168.100.40'), p);
            assert.ok(!a('GET', `/api/misaka/${p}`, '192.168.100.44'), p);
            assert.ok(!a('GET', `/api/misaka/${p}`, '10.0.0.5'), p);
            assert.ok(!a('POST', `/api/misaka/${p}`, '192.168.100.42'), p);
        }
        for (const p of ['/api/servers', '/api/misaka/powerop', '/api/misaka/powercap', '/api/misaka/vm', '/api/misaka/ilo/users', '/api/misaka/screenshot.png', '/api/isos', '/api/iso/upload', '/', '/ws/misaka', '/api/misaka/logs']) {
            assert.ok(!a('GET', p, '192.168.100.42'), p);
            assert.ok(!a('POST', p, '192.168.100.42'), p);
        }
    });

    await t('LAN listener over real HTTP: allowed path reaches the handler, everything else 404, EADDRINUSE tolerated', async () => {
        const { spawnSync, spawn } = require('child_process');
        // the iLO service itself on a temp socket, LAN bind on 127.0.0.1 (so the source ip is not in the host list: health refused, iso answered)
        const port = 18790 + Math.floor(Math.random() * 500);
        const isoDir = path.join(SANDBOX, 'iso'); fs.mkdirSync(isoDir); fs.writeFileSync(path.join(isoDir, 't.iso'), 'ISOBYTES');
        const sock = path.join(SANDBOX, 'ilo-real.sock');
        const blocker = http.createServer(); await listen(blocker, port);   // holds the port: EADDRINUSE path
        const child = spawn(process.execPath, [path.join(__dirname, '..', 'modules', 'rackManager', 'ilo', 'server.js')], { env: Object.assign({}, process.env, { RACK_ILO_SOCK: sock, RACK_ILO_LAN_BIND: `127.0.0.1:${port}`, DATA_DIR: path.join(SANDBOX, 'ilo-data'), ISO_DIR: isoDir, PASSFILE: path.join(SANDBOX, 'nopass') }), stdio: ['ignore', 'pipe', 'pipe'] });
        let log = '';
        child.stdout.on('data', (c) => { log += c; });
        try {
            assert.ok(await until(() => fs.existsSync(sock), 5000), 'unix socket up');
            assert.ok(await until(() => /retrying every 60 s/.test(log), 5000), 'EADDRINUSE logged once');
            assert.strictEqual((log.match(/retrying every 60 s/g) || []).length, 1);
            blocker.close();
            // the retry is 60 s away: start a second instance on a free port to test the real listener
            const port2 = port + 1;
            const sock2 = path.join(SANDBOX, 'ilo-real2.sock');
            const child2 = spawn(process.execPath, [path.join(__dirname, '..', 'modules', 'rackManager', 'ilo', 'server.js')], { env: Object.assign({}, process.env, { RACK_ILO_SOCK: sock2, RACK_ILO_LAN_BIND: `127.0.0.1:${port2}`, DATA_DIR: path.join(SANDBOX, 'ilo-data2'), ISO_DIR: isoDir, PASSFILE: path.join(SANDBOX, 'nopass') }), stdio: 'ignore' });
            try {
                const lan = (p, method) => new Promise((resolve) => { const r = http.request({ port: port2, host: '127.0.0.1', path: p, method: method || 'GET' }, (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, body: b })); }); r.on('error', () => resolve({ status: 0 })); r.end(); });
                assert.ok(await until(async () => (await lan('/iso/t.iso')).status === 200, 5000));
                assert.strictEqual((await lan('/iso/t.iso')).body, 'ISOBYTES');
                assert.strictEqual((await lan('/iso/missing.iso')).status, 404);
                assert.strictEqual((await lan('/api/servers')).status, 404);
                assert.strictEqual((await lan('/api/misaka/health')).status, 404, 'loopback is not a rack host');
                assert.strictEqual((await lan('/api/misaka/powerop', 'POST')).status, 404);
                assert.strictEqual((await lan('/')).status, 404);
            } finally { child2.kill('SIGTERM'); }
        } finally { child.kill('SIGTERM'); try { blocker.close(); } catch (_) { /* closed */ } }
        void spawnSync;
    });

    await rack.stop();
    fakeRackd.close(); fakeIlo.close();
    try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch (_) { /* kept */ }
    console.log(`\n${passed} passed, ${failures.length} failed${failures.length ? ': ' + failures.join(', ') : ''}`);
    process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
