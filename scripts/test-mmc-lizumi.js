#!/usr/bin/env node
/**
 * Lizumi console (Yozora #1252 S4): the read-only xmradio_mmc_view packet is admin only and registered, the console
 * script runs in a VM against a fake mmcConsole and wsClient and draws its pages from the view, the feed is
 * subscribed on open and dropped on close, and nothing polls.
 *   node scripts/test-mmc-lizumi.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

// ---- wiring
assert(/mmcLizumi\.js/.test(read('public/scripts/comp/featureLoader.js')), 'mmc_snapins loads mmcLizumi.js');
assert(/launchId: 'mmc-lizumi'.*loadFeature\('mmc_snapins'\).*window\.openLizumi\(\)/.test(read('public/scripts/comp/modalUtils.js')), 'Start menu entry');
const src = read('public/scripts/comp/mmcLizumi.js');
assert(!/setInterval|alert\(|confirm\(|prompt\(|<select/.test(src), 'no polling, no native UI');
assert(!/setTimeout\([^)]*\b0\b\)/.test(src), 'no zero-delay loops');

// ---- the packet: admin only, read only
const handlerSrc = read('modules/ws/handlers/318-xmRadioHandler.js');
assert(/reg\('xmradio_mmc_view', packet\(true,/.test(handlerSrc), 'admin-only packet');
assert(!/xmradio_mmc_view'[^\n]*destructive/.test(handlerSrc), 'not destructive');

// ---- the console in a VM
const sent = [];
const listeners = {};
const wsClient = {
    on: (t, f) => { listeners[t] = f; },
    sendMessage: async (type, data) => {
        sent.push(type);
        if (type === 'xmradio_mmc_view') {
            return { success: true, data: {
                account: { signedIn: true, handle: 'ab***', since: 1 },
                deck: { tape: 'T', workspaceId: 'w', recordings: [{ rid: 'r1', url: '/api/xmradio/rec/r1/index.m3u8', channelId: 'c1', kind: 'song', since: Date.now() - 60000, back: 30, cut: { a: 'Artist', t: 'Title' } }],
                    queue: [{ id: 'q1', channelId: 'c1', a: 'A', t: 'T', expiresAt: 5, addedAt: 4, slot: 2, state: 'running' }], timers: [{ id: 't1', channelId: 'c1', start: '08:00', minutes: 30, days: [1, 2] }], alerts: [], terms: [{ id: 's1', text: 'abba' }] },
                slots: { max: 4 } } };
        }
        if (type === 'xmradio_lineup') return { success: true, data: { channels: [{ id: 'c1', number: 5, name: 'Hits' }] } };
        if (type === 'xmradio_tape_tracks') return { success: true, data: { tracks: [{ id: 'f1', name: 'x.m4a', size: 2048, at: 1 }] } };
        return { success: true, data: { items: {} } };
    }
};
let def = null;
const rowsSeen = {};
let timers = 0;
const audios = [];
class FakeAudio {
    constructor() { this.src = ''; this.paused = true; this.listeners = {}; audios.push(this); }
    addEventListener(t, f) { this.listeners[t] = f; }
    pause() { this.paused = true; }
    removeAttribute() { this.src = ''; }
    load() {}
    canPlayType() { return 'maybe'; }
    async play() { this.paused = false; if (this.listeners.playing) this.listeners.playing(); }
}
const con = {
    modal: { isConnected: true, querySelector: () => null },
    node: 'radios', refresh() {}, select() {}, sel: null,
    listView: (cols, rows, o) => { rowsSeen.last = { cols, rows, o }; return `<lv ${rows.length}>`; },
    page: (t, s, secs) => { rowsSeen.sections = secs; return `<page ${secs.length}>`; },
    props: (rows) => rows.map((r) => r.join(":")).join("|")
};
const sandbox = {
    console, Date, Math, Promise, setTimeout: (f, ms) => { timers++; return setTimeout(f, ms); }, clearTimeout, wsClient, Audio: FakeAudio, AbortController,
    document: { hidden: false, addEventListener() {}, createElement: () => ({ set src(v) { setTimeout(() => this.onerror(), 1); } }), head: { appendChild() {} } },
    featureLoader: { loadFeature: async () => {} },
    mmcConsole: { open: (d) => { def = d; d.onOpen(con); return con; } }
};
sandbox.window = sandbox;
vm.runInNewContext(src, sandbox);

(async () => {
    await sandbox.openLizumi();
    await new Promise((r) => setTimeout(r, 20));
    assert(sent.includes('xmradio_mmc_view') && sent.includes('status_subscribe'), 'view read and feed subscribed');
    assert.strictEqual(def.nodes()[0].children.length, 7, 'seven pages');
    const page = (id) => def.page({ id }, con);
    page('radios');
    assert.strictEqual(rowsSeen.last.rows.length, 4, 'four slots');
    assert.strictEqual(rowsSeen.last.rows[0].data.state, 'Recording');
    assert.strictEqual(rowsSeen.last.rows[1].data.state, 'Standby');
    page('queue'); assert.strictEqual(rowsSeen.last.rows.length, 1);
    assert.strictEqual(rowsSeen.last.rows[0].data.radio, 'Lizumi-Recorder-2', 'queue shows the virtual radio');
    assert.strictEqual(rowsSeen.last.rows[0].data.qstate, 'Running', 'queue shows the state');
    page('schedules'); assert.strictEqual(rowsSeen.last.rows.length, 2, 'timer and term');
    page('accounts'); assert.strictEqual(rowsSeen.last.rows[0].data.state, 'Signed in');
    page('recordings'); await new Promise((r) => setTimeout(r, 20));
    assert(sent.includes('xmradio_tape_tracks'), 'tape read');
    // Live: the recording list, then the player is torn down on a page change
    con.node = 'live';
    const live = page('live');
    assert.strictEqual(rowsSeen.last.rows.length, 1, 'Live lists the recording slots');
    assert.strictEqual(rowsSeen.last.rows[0].key, 'lv:r1');
    assert(/data-lz="play"/.test(rowsSeen.sections[1].body) && /data-lz="vol"/.test(rowsSeen.sections[1].body), 'player controls');
    assert(/data-lz="running"/.test(rowsSeen.sections[1].body), 'running time label');
    assert.strictEqual(sandbox.mmcLizumi._state.player, null, 'no player before Play');
    const btn = { addEventListener(t, f) { this.f = f; } };
    const pane = { querySelector: (q) => (/play/.test(q) ? btn : null) };
    live.mount(pane);
    btn.f();
    await new Promise((r) => setTimeout(r, 20));
    const pl = sandbox.mmcLizumi._state.player;
    assert(pl && pl.rid === 'r1' && audios.length === 1, 'Play creates the player');
    assert.strictEqual(pl.state, 'playing');
    page('queue');
    assert.strictEqual(sandbox.mmcLizumi._state.player, null, 'page change destroys the player');
    assert.strictEqual(audios[0].src, '', 'audio src removed');
    assert(audios[0].paused, 'audio stopped');
    con.node = 'queue';
    // a push updates the deck without a request
    listeners.xmradio_mmc_status({ changed: { deck: { tape: 'T', recordings: [], queue: [], timers: [], alerts: [], terms: [] } } });
    page('radios');
    assert.strictEqual(rowsSeen.last.rows[0].data.state, 'Standby', 'feed push applied');
    def.onClose(con);
    await new Promise((r) => setTimeout(r, 5));
    assert(sent.includes('status_unsubscribe'), 'feed dropped on close');
    console.log('test-mmc-lizumi: ok');
})().catch((e) => { console.error(e); process.exit(1); });
