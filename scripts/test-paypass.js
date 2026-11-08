#!/usr/bin/env node
// PayPass Operator (Yozora #721; modules/paypass.js, apps/paypass): openCreditIC's web API against a fake
// server on loopback. Run: node scripts/test-paypass.js
'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paypass-test-'));
process.env.PAYPASS_DATA_DIR = dir;
const paypass = require('../modules/paypass');
const { validateManifest } = require('../modules/melatonPackageStore');

const POS = 'C4:4F:33:6B:A4:41';
const hits = [];
const state = { pending: {} };
const HOME = `<html><body><h1 class="mt-5">Playland Gau</h1><select class="form-control" id="posTerminal" name="posTerminal"><option value="${POS}">Primary (Front Desk)</option></select><i class="fas fa-yen-sign"></i></body></html>`;
const FREEPLAY = '<div><label for="showFreePlayGlobal">Global:</label><div><label><input id="showFreePlayGlobal" type="checkbox" checked="checked"/></label></div>'
    + '<label for="showFreePlay94:B5:55:22:99:8C">Chunithm:</label><div><label><input id="showFreePlay94:B5:55:22:99:8C" type="checkbox"/></label></div></div>';
const now = Date.now();
const USERS = [
    { credits: 60.5, name: 'Emmy', locked: false, free_play: false, cards: [{ serial: '1576D061', user: 'emmy', name: 'Cave Card', locked: false }],
        history: [{ machine: '94:B5:55:22:99:8C', card: '1576D061', cost: 1, status: true, time: now - 5000 }], topup_history: [{ card: false, cost: '50', time: now - 9000 }] },
    { credits: 30, name: '', cards: [], history: [], topup_history: [] }
];
const DISPENSE = {
    '94:B5:55:22:99:8C': [
        { user: 'emmy', card: '1576D061', cost: 1, free_play: false, status: true, time: now - 3 * 60e3 },
        { user: 'emmy', card: '1576D061', cost: 1, free_play: false, status: false, time: now - 2 * 60e3 },
        { user: 'emmy', card: '1576D061', cost: 1, free_play: false, status: true, time: now - 60e3 }
    ]
};

const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    hits.push(decodeURIComponent(u.pathname) + (u.search ? `?${[...u.searchParams].filter(([k]) => k !== 'key').map(([k, v]) => `${k}=${v}`).join('&')}` : ''));
    const json = (o) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
    if (u.searchParams.get('key') !== 'test-key' && !u.pathname.startsWith('/wait_')) { res.statusCode = 401; res.end('Invalid Auth Provided'); return; }
    const p = decodeURIComponent(u.pathname);
    if (p === '/') return res.end(HOME);
    if (p === '/get/free_play') return res.end(FREEPLAY);
    if (p === '/get/user') return json(USERS);
    if (p === '/get/dispense/machine') return json(DISPENSE);
    if (p === '/get_pending') return json(state.pending);
    if (p === '/get/user/emmy') return json({ id: 'emmy', ...USERS[0] });
    if (p === '/get/card/1576D061') return json({ id: 'emmy', ...USERS[0] });
    if (p === `/deposit/user/emmy/5`) return res.end('65.5');
    if (p === `/deposit/scan/${POS}/10`) { state.pending[POS] = 'deposit_card'; setTimeout(() => { delete state.pending[POS]; }, 150); return res.end('Waiting for card scan'); }
    if (p === `/get/scan/${POS}`) { state.pending[POS] = 'info_card'; return res.end('Waiting'); }
    if (p === `/wait_pending/${POS}`) {
        const t = setInterval(() => { if (!state.pending[POS]) { clearInterval(t); res.end('Request Completed'); } }, 20);
        return undefined;
    }
    if (p === `/wait_data/${POS}`) { delete state.pending[POS]; return json({ id: 'emmy', ...USERS[0] }); }
    if (p.startsWith('/set/') || p.startsWith('/update/') || p.startsWith('/register/') || p.startsWith('/cancel_pending/')) return res.end('OK');
    res.statusCode = 404;
    return res.end('Unknown Card');
});

(async () => {
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    assert.strictEqual(paypass.info().configured, false);
    await assert.rejects(paypass.overview(), /not configured/);
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ url: `http://127.0.0.1:${server.address().port}`, key: 'test-key' }));

    // ---- dashboard
    const o = await paypass.overview();
    assert.strictEqual(o.arcade, 'Playland Gau');
    assert.deepStrictEqual(o.pos, [{ mac: POS, name: 'Primary (Front Desk)' }]);
    assert.strictEqual(o.freePlay, true, 'global free play read from the checked box');
    assert.deepStrictEqual(o.currency, { symbol: '¥', rate: 100 });
    const chuni = o.machines.find((m) => m.mac === '94:B5:55:22:99:8C');
    assert.strictEqual(chuni.name, 'Chunithm');
    assert.strictEqual(chuni.freePlay, false);
    assert.strictEqual(chuni.active, true);
    assert.deepStrictEqual([chuni.session.count, chuni.session.total], [2, 2], 'a refused play is not counted');
    assert.deepStrictEqual(chuni.day, { users: 1, plays: 2, earned: 2 });
    assert.strictEqual(chuni.last.userName, 'Emmy');
    assert.ok(!o.machines.some((m) => m.mac === POS), 'POS terminals are not machines');
    assert.strictEqual(o.users[0].id, 'emmy');
    assert.strictEqual(o.users[1].id, null, 'a customer with no card has no ID in /get/user');

    // ---- customer
    const c = await paypass.customer({ card: '1576d061' });
    assert.strictEqual(c.id, 'emmy');
    assert.strictEqual(c.topups[0].credits, 50, 'string top-up amounts become numbers');

    // ---- operations
    let r = await paypass.action({ op: 'deposit', target: 'user', id: 'emmy', credits: 5 });
    assert.deepStrictEqual([r.ok, r.message, r.scan], [true, '65.5', false]);
    r = await paypass.action({ op: 'freeplay', target: 'card', card: '1576D061', hours: 2 });
    assert.ok(r.ok);
    assert.ok(hits.includes('/set/card/freeplay/1576D061/enable?timeLimit=2'), 'enable, not the original client\'s "enabled"');
    await paypass.action({ op: 'updateuser', id: 'emmy', name: 'Emmy', freePlay: false });
    assert.ok(hits.includes('/update/user/emmy?free_play=false&user_name=Emmy&user_contact=&user_notes='), 'every field is sent');
    r = await paypass.action({ op: 'deposit', target: 'scan', pos: POS.toLowerCase(), credits: 10 });
    assert.deepStrictEqual([r.ok, r.scan], [true, true]);
    assert.deepStrictEqual(await paypass.wait({ pos: POS }), { done: true });
    r = await paypass.action({ op: 'lookup', pos: POS });
    assert.deepStrictEqual([r.scan, r.lookup], [true, true]);
    const w = await paypass.wait({ pos: POS, lookup: true });
    assert.strictEqual(w.customer.name, 'Emmy');
    r = await paypass.action({ op: 'deletecard', card: 'FFFF0000' });
    assert.deepStrictEqual([r.ok, r.code, r.message], [false, 404, 'Unknown Card']);

    // ---- validation: nothing reaches the server
    const before = hits.length;
    for (const bad of [
        { op: 'deposit', target: 'user', id: '../get/user', credits: 1 },
        { op: 'deposit', target: 'card', card: 'not-hex', credits: 1 },
        { op: 'deposit', target: 'scan', pos: 'nope', credits: 1 },
        { op: 'deposit', target: 'user', id: 'emmy', credits: -1 },
        { op: 'freeplay', target: 'user', id: 'emmy', hours: 'x' },
        { op: 'clear_dead_account_data' }
    ]) await assert.rejects(paypass.action(bad), /Invalid|Unknown operation/);
    assert.strictEqual(hits.length, before);

    // ---- the key never leaves the server half
    assert.ok(!JSON.stringify(o).includes('test-key'));

    // ---- wrong key
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ url: `http://127.0.0.1:${server.address().port}`, key: 'wrong', x: 1 }));
    await assert.rejects(paypass.overview(), /refused the key/);

    // ---- the package
    const manifest = validateManifest(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'apps/paypass/manifest.json'), 'utf8')), { trusted: true });
    assert.strictEqual(manifest.id, 'paypass');
    for (const f of ['client/paypass.js', 'assets/paypass.css', 'assets/paypass-48.png', 'assets/icons/scan.png']) assert.ok(fs.existsSync(path.join(__dirname, '..', 'apps/paypass', f)), f);

    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
    console.log('test-paypass: ok');
})().catch((err) => {
    console.error(err);
    server.close();
    process.exit(1);
});
