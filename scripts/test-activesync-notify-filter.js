'use strict';

// ActiveSync notification filter (Yozora #979, modules/activeSyncNotifyFilter.js): the catalog learns apps and
// channels, the defaults (noise, handled by another program, silent channels), the user's choices, the phone's
// compiled filter (pushed only when its copy differs), the computers' map and the relay that keeps filtered
// notifications from the computers; plus the primary device (modules/activeSync.js).

const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asnf-'));
const as = require('../modules/activeSync');
as.resetForTests(tmpDir);
require('../modules/textMessagingAndroid')._setCacheDir(tmpDir);
const nf = require('../modules/activeSyncNotifyFilter');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = { clients: new Map(), sendToClient(ws, msg) { ws.inbox.push(msg); if (ws.onMessage) ws.onMessage(msg); }, broadcast() {} };
const CONFIG = {
    textMessaging: { accounts: [{ id: 'imessage', kind: 'bluebubbles', enabled: true }, { id: 'rcs', kind: 'rcs', enabled: true }, { id: 'app-discord', kind: 'android', package: 'com.discord', label: 'Discord', enabled: true }] },
    mailAccounts: { accounts: [{ id: 'm', email: 'Someone@Example.com', enabled: true }] }
};
const gr = { getPath: () => tmpDir, getWebSocketServer: () => server, getConfig: ({ path: p }) => CONFIG[p] };
nf._reset();
nf.tap(gr);

function connect(userType = 'admin') {
    const ws = { readyState: WebSocket.OPEN, inbox: [], onMessage: null };
    const info = { authenticated: true, userType, clientId: Math.random().toString(16).slice(2, 14), connectedAt: new Date() };
    server.clients.set(ws, info);
    return { ws, info };
}
const keepAlive = setInterval(() => {}, 1000);

async function main() {
    const DEV = 'a1b2c3d4e5f60718a1b2c3d4e5f60718';
    const DEV2 = 'b1b2c3d4e5f60718a1b2c3d4e5f60718';
    const PC = '00112233445566778899aabbccddeeff';
    const pc = connect();
    as.hello(gr, server, pc.info, { kind: 'computer', id: PC, name: 'PC' });

    // the phone: its page partners, then its background link says which filter it holds (none yet)
    const page = connect();
    as.hello(gr, server, page.info, { kind: 'device', id: DEV, name: 'Fold', speaker: 'webview', ops: ['partnership.*'] });
    page.ws.onMessage = (msg) => { if (msg.type === 'as_request') as.reply(page.info, { callId: msg.data.callId, ok: true, result: { accept: true, permissions: ['notify', 'files'] } }); };
    const r = await as.partnership(gr, server, pc.info, { action: 'propose', deviceId: DEV, mode: 'partner', name: 'Fold' });
    assert.strictEqual(r.accepted, true);
    const link = connect();
    const filters = [];
    link.ws.onMessage = (msg) => {
        if (msg.type !== 'as_request') return;
        if (msg.data.op === 'notify.filter') { filters.push(msg.data.args); as.reply(link.info, { callId: msg.data.callId, ok: true, result: { v: msg.data.args.v } }); }
    };
    as.hello(gr, server, link.info, { kind: 'device', id: DEV, name: 'Fold', speaker: 'service', ops: ['notify.*', 'notify.filter'], nfv: '' });
    await sleep(1300);
    assert.strictEqual(filters.length, 1, 'a phone without the filter gets it after its hello');
    const f0 = filters[0];
    assert.strictEqual(f0.p['com.android.systemui'], 0, 'known noise is dropped on the phone from the start');
    assert.ok(f0.keep.includes('com.discord'), 'Messenger\'s Android app accounts keep coming from the phone');

    // a second hello with the same version: nothing new is sent
    const link2 = connect();
    link2.ws.onMessage = link.ws.onMessage;
    as.hello(gr, server, link2.info, { kind: 'device', id: DEV, name: 'Fold', speaker: 'service', ops: ['notify.*', 'notify.filter'], nfv: f0.v });
    await sleep(1300);
    assert.strictEqual(filters.length, 1, 'the same version is not sent again');
    server.clients.delete(link2.ws);

    // posts: learned, relayed or kept from the computers
    pc.ws.inbox.length = 0;
    const post = (detail) => as.event(gr, server, link.info, { event: 'notify.posted', detail });
    assert.strictEqual(post({ key: 'k1', package: 'com.twitter.android', app: 'X', channel: 'loud', channelName: 'Mentions', importance: 4, title: 'a', text: 'b' }), 1);
    let ev = pc.ws.inbox.filter((m) => m.type === 'as_event' && m.data.event === 'notify.posted').pop();
    assert.strictEqual(ev.data.detail.tray, true, 'a real alerting channel shows a balloon');
    pc.ws.inbox.length = 0;
    post({ key: 'k2', package: 'com.twitter.android', app: 'X', channel: 'quiet', channelName: 'Silent', importance: 2, title: 'a', text: 'b' });
    ev = pc.ws.inbox.filter((m) => m.type === 'as_event' && m.data.event === 'notify.posted').pop();
    assert.strictEqual(ev.data.detail.tray, false, 'a Low channel is listed without a balloon');
    assert.strictEqual(post({ key: 'k3', package: 'com.android.systemui', app: 'System UI', channel: 'CHR', title: 'Charging' }), 0, 'noise never reaches a computer');
    assert.strictEqual(post({ key: 'k4', package: 'com.bluebubbles.messaging', app: 'BlueBubbles', channel: 'new', title: 'Hi' }), 0, 'handled by Messenger');
    assert.strictEqual(post({ key: 'k5', package: 'com.discord', app: 'Discord', channel: 'directMessages', title: 'Hi' }), 0, 'Discord is Messenger\'s, kept from the computers');
    assert.strictEqual(post({ key: 'k6', package: 'com.example.shop', app: 'Shop', channel: 'promo', channelName: 'Promotions', importance: 3, title: 'Sale' }), 0, 'promotions are off');
    const hash = nf.javaHash('someone@example.com');
    assert.strictEqual(post({ key: 'k7', package: 'com.samsung.android.email.provider', app: 'Email', channel: `email_channel_new_emails_1_${hash}`, channelName: 'New emails', importance: 4, title: 'Mail' }), 0, 'the mail account\'s channel is Dovecote\'s');
    assert.strictEqual(post({ key: 'k8', package: 'com.samsung.android.email.provider', app: 'Email', channel: 'email_channel_new_emails_2_123', channelName: 'New emails', importance: 4, title: 'Mail' }), 1, 'another mail address is not handled');
    // a notify.seen (the phone kept it) is learned and never relayed
    assert.strictEqual(as.event(gr, server, link.info, { event: 'notify.seen', detail: { package: 'com.samsung.android.lool', app: 'Device care', channel: 'BATTERY', channelName: 'Battery', importance: 3 } }), 0);

    const s = nf.settings(DEV);
    const byPkg = Object.fromEntries(s.apps.map((a) => [a.package, a]));
    assert.strictEqual(byPkg['com.android.systemui'].kind, 'noise');
    assert.strictEqual(byPkg['com.bluebubbles.messaging'].handledBy, 'Melaton Messenger (iMessage)');
    assert.strictEqual(byPkg['com.discord'].handledBy, 'Melaton Messenger (Discord)');
    assert.strictEqual(byPkg['com.samsung.android.lool'].channels[0].name, 'Battery');
    const mailCh = byPkg['com.samsung.android.email.provider'].channels.find((c) => c.id.endsWith(String(hash)));
    assert.strictEqual(mailCh.handledBy, 'Dovecote Express (Someone@Example.com)');

    // the new channels went to the phone (debounced) and to the computers
    await sleep(2300);
    const f1 = filters[filters.length - 1];
    assert.notStrictEqual(f1.v, f0.v);
    assert.strictEqual(f1.c['com.example.shop'].promo, 0, 'the promotions channel is dropped on the phone');
    assert.strictEqual(f1.p['com.bluebubbles.messaging'], 0);
    assert.ok(pc.ws.inbox.some((m) => m.type === 'as_event' && m.data.event === 'notify.filter' && m.data.detail.deviceId === DEV), 'computers hear of the new map');

    // the user turns X's quiet channel's balloon on and the whole of Device care on (sent, no balloon)
    const before = filters.length;
    nf.save(DEV, { apps: { 'com.twitter.android': { send: true, tray: true, ch: { quiet: { send: true, tray: true } } }, 'com.samsung.android.lool': { send: true, tray: false } } });
    await sleep(100);
    assert.strictEqual(filters.length, before + 1, 'a save goes to the phone at once');
    assert.strictEqual(filters[filters.length - 1].p['com.samsung.android.lool'], undefined, 'a noise app the user switched on is sent');
    assert.deepStrictEqual(nf.decide(DEV, 'com.twitter.android', 'quiet'), { send: true, tray: true });
    assert.deepStrictEqual(nf.decide(DEV, 'com.samsung.android.lool', 'BATTERY'), { send: false, tray: false }, 'its battery channel keeps its own default (status)');
    // only differences from the defaults are stored
    const stored = as.db(gr).prepare('SELECT prefs FROM as_notify_prefs WHERE device_id = ?').get(DEV);
    assert.deepStrictEqual(JSON.parse(stored.prefs), { apps: { 'com.twitter.android': { ch: { quiet: { tray: true } } }, 'com.samsung.android.lool': { send: true } } });

    // the primary device
    const page2 = connect();
    as.hello(gr, server, page2.info, { kind: 'device', id: DEV2, name: 'A53', speaker: 'webview' });
    assert.throws(() => as.setPrimary(gr, server, DEV2), (e) => e.code === 'NOT_PARTNER');
    as.setPrimary(gr, server, DEV);
    let list = as.list(gr, server).devices;
    assert.strictEqual(list.find((d) => d.deviceId === DEV).primary, true);
    assert.strictEqual(list.find((d) => d.deviceId === DEV2).primary, false);
    // ending the partnership clears the primary and the notification settings
    await as.partnership(gr, server, pc.info, { action: 'end', deviceId: DEV });
    assert.strictEqual(as.primaryOf(gr), '');
    assert.strictEqual(as.db(gr).prepare('SELECT COUNT(*) AS n FROM as_notify_apps WHERE device_id = ?').get(DEV).n, 0);
    list = as.list(gr, server).devices;
    assert.strictEqual(list.find((d) => d.deviceId === DEV).primary, false);

    console.log('test-activesync-notify-filter: ok');
}

main().then(() => { clearInterval(keepAlive); process.exit(0); }, (err) => { console.error(err); clearInterval(keepAlive); process.exit(1); });
