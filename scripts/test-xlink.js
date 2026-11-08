#!/usr/bin/env node
// XLink Operator Console (Yozora #719; modules/xlink.js, apps/xlink): AVS-Menu's menu.json semantics
// against a fake cabinet on loopback. Run: node scripts/test-xlink.js
'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xlink-test-'));
process.env.XLINK_DATA_DIR = dir;
const xlink = require('../modules/xlink');
const { validateManifest } = require('../modules/melatonPackageStore');

const state = { power: 'Active', game_power: 'Enabled', volume: '24', mute: '0', pre: 'Enabled', es: 'Ready', hits: [] };
const server = http.createServer((req, res) => {
    state.hits.push(req.url);
    const u = new URL(req.url, 'http://x');
    const send = (code, body) => { res.statusCode = code; res.end(body); };
    switch (u.pathname) {
        case '/power': return send(200, state.power);
        case '/power/on': state.power = 'Active'; return send(200, 'OK');
        case '/power/standby': state.power = 'Standby'; return send(200, 'OK');
        case '/power/off': state.power = 'Eco Mode'; return send(200, 'OK');
        case '/game_power': return send(200, state.game_power);
        case '/volume': return send(200, u.searchParams.get('mute') ? state.mute : state.volume);
        case '/volume/set':
            if (u.searchParams.has('percent')) state.volume = u.searchParams.get('percent');
            if (u.searchParams.has('mute')) state.mute = u.searchParams.get('mute') === 'true' ? '1' : '0';
            return send(200, 'OK');
        case '/pre': return send(200, state.pre);
        case '/es': return send(200, state.es);
        case '/select/game': return send(200, 'PL Omni');
        case '/select/game/air': return send(200, 'OK');
        case '/broken': return send(500, 'MCU busy');
        default: return send(404, 'nope');
    }
});

(async () => {
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const B = `http://127.0.0.1:${server.address().port}`;
    const REPLACE = [['Eco Mode', 'Eco', 'gray'], ['Active', 'On', 'green'], ['Warning', 'Warning', 'red'], ['Standby', 'Standby', 'orange']];
    const menu = {
        devices: {
            b: { position: 1, name: 'Second', status: `${B}/power`, replace: REPLACE, items: [] },
            a: {
                position: 0,
                name: 'Chunithm',
                icon: 'joystick',
                status: `${B}/power`,
                replace: REPLACE,
                items: [
                    {
                        text: 'Power Switch', status: `${B}/power`, replace: REPLACE,
                        warning: { header: 'System Active', message: 'm', check: `${B}/game_power`, ok: 'OK', match: 'enabled' },
                        toggle: [
                            { text: 'I', url: `${B}/power/on`, match: [{ str: 'On' }, { str: 'Warning', bg: 'red' }] },
                            { text: 'STB', url: `${B}/power/standby`, bg: '#FED06C', match: [{ str: 'Standby' }] },
                            { text: 'O', url: `${B}/power/off`, match: [{ str: 'Eco', text: 'ECO', bg: 'gray', color: 'white' }] }
                        ]
                    },
                    {
                        text: 'Game Select', status: `${B}/select/game`,
                        warning: { header: 'Reboot Required', message: 'r', ok: 'Reboot Now', match: 'Active', check: `${B}/power` },
                        replace: [['PL Omni', 'PLOST Omni', 'yellow'], ['PL', 'Paradise', 'blue']],
                        children: [{ text: 'Air Plus', badges: [{ text: 'Custom', color: 'orange', text_color: 'white' }], url: `${B}/select/game/air` }]
                    },
                    {
                        text: 'Mute', status: `${B}/volume?mute=true`,
                        toggle: [{ url: `${B}/volume/set?mute=true`, bg: 'red', match: [{ str: '1' }] }, { url: `${B}/volume/set?mute=false` }]
                    },
                    { text: 'Speakers', status: `${B}/volume`, append: '%', slider: `${B}/volume/set?percent=` },
                    {
                        text: 'Enhanced Standby', status: `${B}/es`,
                        pre_status: { url: `${B}/pre`, match: 'Disabled', replace: [['Enabled', 'Blocked', 'red']] },
                        replace: [['Ready', 'Available', 'yellow']]
                    },
                    { text: 'Broken', url: `${B}/broken` },
                    { text: 'Nostalgia power', warning: { header: 'h', message: 'm', always: true }, toggle: [{ url: `${B}/power/on` }, { url: `${B}/power/off` }] }
                ]
            }
        }
    };
    fs.writeFileSync(path.join(dir, 'menu.json'), JSON.stringify(menu));

    // ---- replace: substring, case-insensitive, last match wins; no match = raw body
    assert.deepStrictEqual(xlink._applyReplace('PL Omni', [['PL Omni', 'PLOST Omni', 'yellow'], ['pl', 'Paradise', 'blue']]), ['Paradise', 'blue']);
    assert.deepStrictEqual(xlink._applyReplace(' raw \n', [['x', 'y', 'z']]), ['raw', '']);

    // ---- device list sorted by position, device status replaced
    const list = await xlink.devices();
    assert.deepStrictEqual(list.map((d) => d.key), ['a', 'b']);
    assert.deepStrictEqual(list[0].status, { text: 'On', color: 'green' });

    // ---- full snapshot
    let s = await xlink.device('a', { force: true });
    const [power, game, mute, speakers, es, broken, nost] = s.items;
    assert.deepStrictEqual(power.toggle.map((t) => t.active), [true, false, false], 'On lights I');
    assert.strictEqual(power.kind, 'toggle');
    assert.strictEqual(game.kind, 'folder');
    assert.deepStrictEqual(game.status, { text: 'Paradise', color: 'blue' }, 'last replace match wins');
    assert.strictEqual(game.children[0].badges[0].textColor, 'white');
    assert.deepStrictEqual(mute.toggle.map((t) => [t.label, t.active]), [['I', false], ['O', true]], 'no match lights the last; I/O labels');
    assert.strictEqual(speakers.kind, 'slider');
    assert.strictEqual(speakers.status.text, '24');
    assert.deepStrictEqual(es.status, { text: 'Blocked', color: 'red', gated: true }, 'pre_status gates the real status');
    assert.ok(!state.hits.includes('/es'), 'gated status is never asked');
    assert.strictEqual(nost.toggle.some((t) => t.active), false, 'no status: nothing lit');
    assert.ok(s.log.length > 0);

    // ---- cache
    const again = await xlink.device('a');
    assert.strictEqual(again.cached, true);

    // ---- warning (check matches, case-insensitive) then confirmed
    let r = await xlink.action({ device: 'a', path: [0], op: 'toggle', value: 1 });
    assert.ok(r.confirm, 'game_power Enabled warns');
    assert.strictEqual(r.confirm.header, 'System Active');
    assert.strictEqual(state.power, 'Active', 'not sent before confirmation');
    r = await xlink.action({ device: 'a', path: [0], op: 'toggle', value: 1, confirmed: true });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(state.power, 'Standby');
    assert.deepStrictEqual(r.snapshot.items[0].toggle.map((t) => t.active), [false, true, false], 'rescanned: STB lit');
    assert.strictEqual(r.snapshot.items[0].toggle[1].bg, '#FED06C');

    // match.bg / match.color on the lit button, match.text as its label
    state.game_power = 'Disabled';
    r = await xlink.action({ device: 'a', path: [0], op: 'toggle', value: 2 });
    assert.ok(!r.confirm, 'check no longer matches: no warning');
    const lit = r.snapshot.items[0].toggle[2];
    assert.deepStrictEqual([lit.active, lit.label, lit.bg, lit.color], [true, 'ECO', 'gray', 'white']);

    // ---- a parent's warning guards its children's plain buttons (power is Eco now: no match)
    r = await xlink.action({ device: 'a', path: [1, 0], op: 'send' });
    assert.ok(!r.confirm && r.ok);
    state.power = 'Active';
    r = await xlink.action({ device: 'a', path: [1, 0], op: 'send' });
    assert.strictEqual(r.confirm && r.confirm.ok, 'Reboot Now');

    // always
    r = await xlink.action({ device: 'a', path: [6], op: 'toggle', value: 0 });
    assert.ok(r.confirm);

    // ---- slider
    r = await xlink.action({ device: 'a', path: [3], op: 'slider', value: 45 });
    assert.ok(r.ok);
    assert.strictEqual(state.volume, '45');
    await assert.rejects(xlink.action({ device: 'a', path: [3], op: 'slider', value: 101 }), /slider/);

    // ---- failures
    r = await xlink.action({ device: 'a', path: [5], op: 'send' });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, 500);
    assert.match(r.failure, /MCU busy/);
    assert.ok(!('error' in r), 'an error key would read as a failed request on the client');
    await assert.rejects(xlink.action({ device: 'zz', path: [0] }), /Invalid Device ID/);
    await assert.rejects(xlink.action({ device: 'a', path: [99] }), /Invalid item/);
    await assert.rejects(xlink.action({ device: 'a', path: [3], op: 'send' }), /no action/);
    const dead = await xlink._get('http://127.0.0.1:1/x', 500);
    assert.strictEqual(dead.ok, false);

    // ---- captures: png only, newest first, 7 days unless all_captures
    const caps = path.join(dir, 'caps');
    fs.mkdirSync(caps);
    fs.writeFileSync(path.join(caps, 'new.png'), 'x');
    fs.writeFileSync(path.join(caps, 'old.PNG'), 'x');
    fs.writeFileSync(path.join(caps, 'note.txt'), 'x');
    const old = (Date.now() - 10 * 864e5) / 1000;
    fs.utimesSync(path.join(caps, 'old.PNG'), old, old);
    assert.strictEqual(xlink.captures().configured, false);
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ captures: caps }));
    assert.deepStrictEqual(xlink.captures().files.map((f) => f.name), ['new.png']);
    xlink.saveFile('config.json', JSON.stringify({ captures: caps, all_captures: true }));
    assert.deepStrictEqual(xlink.captures().files.map((f) => f.name), ['new.png', 'old.PNG']);
    assert.ok(xlink.capturePath('new.png'));
    assert.strictEqual(xlink.capturePath('../menu.json'), null);
    assert.strictEqual(xlink.capturePath('note.txt'), null);
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ captures: path.join(dir, 'missing') }));
    assert.strictEqual(xlink.captures().missing, true);

    // ---- import validation
    assert.throws(() => xlink.saveFile('menu.json', '{"nodevices":1}'), /devices/);
    assert.throws(() => xlink.saveFile('../x.json', '{}'), /Unknown/);

    // ---- the package
    const manifest = validateManifest(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'apps/xlink/manifest.json'), 'utf8')), { trusted: true });
    assert.strictEqual(manifest.id, 'xlink');
    for (const f of ['client/xlink.js', 'assets/xlink.css', 'assets/xlink-48.png']) assert.ok(fs.existsSync(path.join(__dirname, '..', 'apps/xlink', f)), f);

    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
    console.log('test-xlink: ok');
})().catch((err) => {
    console.error(err);
    server.close();
    process.exit(1);
});
