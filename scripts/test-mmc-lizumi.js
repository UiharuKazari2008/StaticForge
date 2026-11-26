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
const payloads = [];
const listeners = {};
const wsClient = {
    on: (t, f) => { listeners[t] = f; },
    sendMessage: async (type, data) => {
        sent.push(type);
        payloads.push({ type, data });
        if (type === 'xmradio_timers_set') return { success: true, data: { timers: data.timers.map((t, i) => Object.assign({ id: t.id || `n${i}` }, t)) } };
        if (type === 'xmradio_terms_set') return { success: true, data: { terms: data.terms.map((t, i) => Object.assign({ id: t.id || `m${i}` }, t)) } };
        if (type === 'xmradio_alert_remove') return { success: true, data: { alerts: [] } };
        if (type === 'xmradio_alert_add') return { success: true, data: { alerts: [{ id: 'al1', kind: data.kind, artist: data.artist, title: data.title, destination: data.destination }] } };
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
const dialogsOpened = [];
const fakeCtx = (init) => {
    const v = {};
    const ctx = { vals: v, texts: {}, opts: {}, modal: {}, set: (id, x) => { v[id] = x; }, get: (id) => v[id], text: (id, t) => { ctx.texts[id] = t; }, options: (id, list, val) => { ctx.opts[id] = list; if (val !== undefined) v[id] = val; } };
    init(ctx);
    return ctx;
};
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
    boxAnswer: true,
    box(html, buttons) { rowsSeen.box = { html, buttons }; return Promise.resolve(this.boxAnswer); },
    note(t) { rowsSeen.note = t; },
    page: (t, s, secs) => { rowsSeen.sections = secs; return `<page ${secs.length}>`; },
    props: (rows) => rows.map((r) => r.join(":")).join("|")
};
const sandbox = {
    console, Date, Math, Promise, setTimeout: (f, ms) => { timers++; return setTimeout(f, ms); }, clearTimeout, wsClient, Audio: FakeAudio, AbortController,
    document: { hidden: false, addEventListener() {}, createElement: () => ({ set src(v) { setTimeout(() => this.onerror(), 1); } }), head: { appendChild() {} } },
    featureLoader: { loadFeature: async () => {} },
    // a fake Vista dialog host: the dialog's own init and ok run against a plain value store
    vistaDialogTemplate: { openDialog: (o) => { dialogsOpened.push(o); } },
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
    // ---- Schedules: the Action pane, the dialogs and the saves (the whole list, as the radio app saves it)
    const sch = def.nodes()[0].children.find((x) => x.id === 'schedules');
    assert.deepStrictEqual([...def.commands(sch, con).map((x) => x.text)], ['New Timer...', 'New Search Term...'], 'node actions');
    assert.strictEqual(def.commands({ id: 'queue' }, con).length, 0, 'no actions on other pages');
    assert.deepStrictEqual([...def.selCommands(sch, 't:t1', con).items.map((x) => x.text || 'sep')], ['Properties...', 'Turn Off', 'sep', 'Delete'], 'a timer\'s actions');
    assert.deepStrictEqual([...def.selCommands(sch, 's:s1', con).items.map((x) => x.text || 'sep')], ['Properties...', 'sep', 'Delete'], 'a term\'s actions');
    assert.strictEqual(def.selCommands(sch, 'q:q1', con), null, 'nothing for a row that is not a schedule');
    page('schedules');
    assert(rowsSeen.last.cols.some((x) => x.key === 'tape') && rowsSeen.last.cols.some((x) => x.key === 'rules'), 'Tape and Rules columns');
    // New Search Term: every rule is read back from the dialog into the saved list, with the existing term kept
    con.sel = null;
    assert.strictEqual(await def.action('sch-new-term', con), true);
    let dlg = dialogsOpened.pop();
    assert(/New Search Term/.test(dlg.title) && Array.isArray(dlg.tpl.c), 'a Vista dialog for the term');
    let ctx = fakeCtx(dlg.init);
    ctx.vals[301] = 'c1'; ctx.vals[302] = ' trance '; ctx.vals[303] = 'Armin'; ctx.vals[313] = true; ctx.vals[402] = true; ctx.vals[404] = true;
    ctx.vals[306] = '22'; ctx.vals[307] = '4'; ctx.vals[308] = '3'; ctx.vals[309] = true; ctx.vals[310] = true; ctx.vals[311] = true; ctx.vals[312] = 'Live';
    assert.strictEqual(await dlg.ok(ctx), true, 'saved');
    const ts = payloads.filter((p) => p.type === 'xmradio_terms_set').pop().data.terms;
    assert.strictEqual(ts.length, 2, 'the whole list');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(ts[1])), { text: 'trance', channelId: 'c1', artist: 'Armin', artistExact: true, title: '', titleExact: false, show: '', showExact: false, days: [1, 3], afterHour: 22, beforeHour: 4, minDuration: 180, allowShows: true, fastTrigger: true, notify: true, destination: 'Live' });
    page('schedules');
    assert.strictEqual(rowsSeen.last.rows.length, 3, 'the list re-renders from the saved answer');
    assert(/Artist is Armin/.test(rowsSeen.last.rows[2].data.rules) && /Hours 22-04/.test(rowsSeen.last.rows[2].data.rules), 'rules summary');
    // a bad hour keeps the dialog open and says why; a term naming nothing is refused
    ctx.vals[306] = '99';
    assert.strictEqual(await dlg.ok(ctx), false);
    assert(/0 to 23/.test(ctx.texts[320]));
    ctx = fakeCtx(dlg.init);
    assert.strictEqual(await dlg.ok(ctx), false);
    assert(/what to look for/.test(ctx.texts[320]));
    // Properties of a timer: the radio app's fields plus Tape and Notify; saved with the whole timers list
    con.sel = 't:t1';
    await def.action('sch-props', con);
    dlg = dialogsOpened.pop();
    ctx = fakeCtx(dlg.init);
    assert.strictEqual(ctx.vals[302], '08:00'); assert.strictEqual(ctx.vals[402], true, 'Mon pressed');
    ctx.vals[306] = 'Mornings'; ctx.vals[307] = true;
    assert.strictEqual(await dlg.ok(ctx), true);
    const tm = payloads.filter((p) => p.type === 'xmradio_timers_set').pop().data.timers;
    assert.strictEqual(tm.length, 1);
    assert.strictEqual(tm[0].id, 't1', 'the same timer');
    assert.strictEqual(tm[0].destination, 'Mornings'); assert.strictEqual(tm[0].notify, true);
    ctx.vals[302] = '25:00';
    assert.strictEqual(await dlg.ok(ctx), false, 'a bad time is refused');
    // Turn Off, then Delete asks first and Cancel keeps it
    await def.action('sch-toggle', con);
    assert.strictEqual(payloads.filter((p) => p.type === 'xmradio_timers_set').pop().data.timers[0].off, true, 'Turn Off saves off');
    con.boxAnswer = false;
    await def.action('sch-delete', con);
    assert(/delete this timer/.test(rowsSeen.box.html), 'the kit\'s confirmation names it');
    assert.strictEqual(con.sel, 't:t1', 'Cancel keeps the selection');
    con.boxAnswer = true;
    await def.action('sch-delete', con);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(payloads.filter((p) => p.type === 'xmradio_timers_set').pop().data.timers)), [], 'Delete saves the list without it');
    // an alert's Properties moves its destination through the same alert packet; Delete removes it
    def.page({ id: 'schedules' }, con);
    sandbox.mmcLizumi._state.deck.alerts = [{ id: 'al1', kind: 'artist', artist: 'ABBA', title: '', channelId: null }];
    await def.rowOpen('a:al1', { id: 'schedules' }, con);
    dlg = dialogsOpened.pop();
    ctx = fakeCtx(dlg.init);
    ctx.vals[303] = 'Alerts';
    assert.strictEqual(await dlg.ok(ctx), true);
    assert.strictEqual(payloads.filter((p) => p.type === 'xmradio_alert_add').pop().data.destination, 'Alerts');
    con.sel = 'a:al1';
    await def.action('sch-delete', con);
    assert.strictEqual(payloads.filter((p) => p.type === 'xmradio_alert_remove').pop().data.id, 'al1');
    assert.strictEqual(await def.action('sch-nothing', con), false, 'an unknown action is left to the shell');
    // restore the view's own timers and terms for the pages after this
    sandbox.mmcLizumi._state.deck.timers = [{ id: 't1', channelId: 'c1', start: '08:00', minutes: 30, days: [1, 2] }];
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
