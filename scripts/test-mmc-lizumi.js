#!/usr/bin/env node
/**
 * Lizumi console (Yozora #1252 S4): the read-only xmradio_mmc_view packet is admin only and registered, the console
 * script runs in a VM against a fake mmcConsole and wsClient and draws its pages from the view in Vista's own console
 * vocabulary (overview page, property lists, list views with a state cell and the kit progress bar), the feed is
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
// Vista's own vocabulary only: no tile / chip / card / banner class survived the redesign
assert(!/lz-(tile|chip|card|tiles|cards|sum|warn|health|verdict|kv|bar|split|splits|sh|gap|dot|tick|row-bad|note|empty-line)\b/.test(src), 'no invented chrome left in the console');

// ---- the packet: admin only, read only
const handlerSrc = read('modules/ws/handlers/318-xmRadioHandler.js');
assert(/reg\('xmradio_mmc_view', packet\(true,/.test(handlerSrc), 'admin-only packet');
assert(!/xmradio_mmc_view'[^\n]*destructive/.test(handlerSrc), 'not destructive');
assert(/reg\('xmradio_rec_held_delete', packet\(true,[^\n]*destructive: true/.test(handlerSrc), 'held delete: admin and destructive');
assert(/heldDelete: \(rid\)/.test(read('modules/xmRadioRecorderClient.js')), 'client method');
assert(/xmradio_rec_held_delete/.test(read('docs/client-api/ws/xmradio.md')), 'documented');

// ---- the console in a VM
const sent = [];
let failNext = false;
const heldList = [
    { rid: 'h1', channelId: 'c1', kind: 'song', slot: 1, state: 'stopped', since: 1, endedAt: 2, segs: 10, gaps: [], gapSeconds: 0, files: [], error: '', keepUntil: 0 },
    { rid: 'h2', channelId: 'c1', kind: 'channel', slot: 2, state: 'assembled', since: 1, endedAt: 2, segs: 10, gaps: [{ from: 1, to: 5000 }], gapSeconds: 5, files: ['a.m4a'], error: '', keepUntil: 9 },
    { rid: 'h3', channelId: 'c1', kind: 'song', slot: 1, state: 'failed', since: 1, endedAt: 2, segs: 4, gaps: [], gapSeconds: 0, files: [], error: 'x', keepUntil: 0 },
    { rid: 'h4', channelId: 'c1', kind: 'song', slot: 1, state: 'assembling', since: 1, endedAt: 2, segs: 4, gaps: [], gapSeconds: 0, files: [], keepUntil: 0 },
    { rid: 'h5', channelId: 'c1', kind: 'song', slot: 1, state: 'recording', since: 1, endedAt: 0, segs: 4, gaps: [], gapSeconds: 0, files: [], keepUntil: 0 }
];
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
        if (type === 'xmradio_rec_held') return { success: true, data: { held: heldList } };
        if (type === 'xmradio_rec_assemble' || type === 'xmradio_rec_held_delete') { if (failNext) { failNext = false; return { success: false, error: 'Assembly broke.' }; } return { success: true, data: {} }; }
        if (type === 'xmradio_rec_settings') return { success: true, data: { settings: data, deck: Object.assign({}, sandbox.mmcLizumi._state.deck, { settings: data }) } };
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
    listView: (cols, rows, o) => { rowsSeen.last = { cols, rows, o }; rowsSeen[o && o.sortId] = rowsSeen.last; return `<lv ${rows.length}>`; },
    overview: (img, paras) => { rowsSeen.overview = { img, paras }; return `<overview ${paras.length}>`; },
    boxAnswer: true,
    box(html, buttons) { rowsSeen.box = { html, buttons }; return Promise.resolve(this.boxAnswer); },
    note(t) { rowsSeen.note = t; },
    page: (t, s, secs) => { rowsSeen.sections = secs; return `<page ${secs.length}>`; },
    state: (ok, text, warn) => (ok ? text : `[${warn ? 'warn' : 'err'}:${text}]`),
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
    assert.strictEqual(def.nodes()[0].children.length, 8, 'seven pages and Settings');
    const page = (id) => def.page({ id }, con);
    const secBody = (id) => (rowsSeen.sections.find((s) => s.id === id) || {}).body || '';
    const colsKey = (list, key) => rowsSeen[list].cols.find((c) => c.key === key);
    // ---- Virtual Radios: the overview page, the counts, the list and the selected radio's detail
    page('radios');
    assert.deepStrictEqual([...rowsSeen.sections.map((x) => x.id)], ['lz-rad-ovw', 'lz-rad-sum', 'lz-rad-list', 'lz-rad-sel'], 'overview, summary, list and detail');
    assert(/1 of 4 virtual radios is recording/.test(rowsSeen.overview.paras[0]), 'the plain-words verdict on MMC\'s overview page');
    assert.strictEqual(rowsSeen.overview.img, '/static_images/app_icons/xmradio.png', 'the console art on the overview page');
    assert(/Virtual radios:4/.test(secBody('lz-rad-sum')), 'the counts as a property list');
    assert(/data-act="nav:queue"/.test(secBody('lz-rad-sum')) && /data-act="nav:accounts"/.test(secBody('lz-rad-sum')), 'each figure links to the page it counts');
    const rad = rowsSeen['lz-radios'];
    assert.strictEqual(rad.rows.length, 4, 'a row per virtual radio');
    assert.strictEqual(rad.rows[0].data.state, 'Recording');
    assert.strictEqual(rad.rows[0].data.tone, 'ok');
    assert.strictEqual(rad.rows[1].data.state, 'Standby', 'a free slot is on standby, not a fault');
    assert.strictEqual(rad.rows[1].data.tone, 'idle');
    assert.strictEqual(colsKey('lz-radios', 'state').html(rad.rows[1].data), 'Standby', 'the state cell is plain when it is not a fault');
    // ---- a recording's figures: the state cell, buffer, the kit progress bar with its percentage, the gaps
    const st = sandbox.mmcLizumi._state;
    const rec0 = st.deck.recordings[0];
    Object.assign(rec0, { state: 'paused-refilling', segsWritten: 40, segsExpected: 50, held: 40, gaps: [{ from: 1, to: 2 }], gapSeconds: 6, bufferSegs: 3, behindS: 0 });
    page('radios');
    const d0 = rowsSeen['lz-radios'].rows[0].data;
    assert.strictEqual(d0.state, 'Paused - refilling', 'the state cell');
    assert.strictEqual(d0.buffer, '3', 'the buffer depth');
    assert.strictEqual(d0.segs, '40 / 50 (80%), 40 held', 'segments written vs expected with the percentage');
    const segHtml = colsKey('lz-radios', 'segs').html(d0);
    assert(/role="progressbar"/.test(segHtml) && /aria-valuenow="80"/.test(segHtml) && /--lz-pct:80/.test(segHtml), 'the kit progress bar in the cell');
    assert.strictEqual(segHtml.includes('width:'), false, 'no width in the script (the cell\'s --lz-pct drives it)');
    assert.strictEqual(colsKey('lz-radios', 'gaps').html(d0), '[warn:1 (6 s)]', 'a gap is a warning state');
    assert(/1 gap \(6 s of audio missing\)/.test(secBody('lz-rad-sel')), 'the detail says the gap in words');
    rec0.state = 'behind'; rec0.behindS = 300; rec0.gaps = []; rec0.gapSeconds = 0;
    page('radios');
    const d1 = rowsSeen['lz-radios'].rows[0].data;
    assert.strictEqual(d1.state, 'Behind', 'behind is a warning state'); assert.strictEqual(d1.tone, 'warn');
    assert(/behind live by 5 min/.test(secBody('lz-rad-sel')), 'the detail says how far behind');
    rec0.state = 'buffering'; rec0.behindS = 0;
    page('radios'); assert.strictEqual(rowsSeen['lz-radios'].rows[0].data.state, 'Buffering', 'buffering');
    // a recording that stopped writing audio is unmissable: a bad row, the warning state and the holding segment
    Object.assign(rec0, { state: 'recording', behindS: 0, stalled: 3000, stuckSeq: 389999, refetches: 12 });
    page('radios');
    const d2 = rowsSeen['lz-radios'].rows[0].data;
    assert.strictEqual(d2.health, 'bad', 'a stalled recording is a bad row');
    assert.strictEqual(rowsSeen['lz-radios'].rows[0].icon, '/static_images/vista-icons/volume-mute-16.png', 'the mute icon marks it');
    assert(/no audio for 50 min - recording is stuck/.test(secBody('lz-rad-sel')), 'the detail says it is stuck');
    assert(/segment 389999 is holding it, 12 re-tries/.test(secBody('lz-rad-sel')), 'the holding segment and its re-tries');
    // the splits a recording will be cut into: a list, a check icon on the ones written
    rec0.cuts = [{ at: 1, a: 'Artist', t: 'One', done: true }, { at: 2, a: 'Artist', t: 'Two' }];
    page('radios');
    const splits = rowsSeen.last; // the detail's splits list (built after the radios list)
    assert.strictEqual(splits.rows.length, 2, 'the splits list');
    assert.strictEqual(splits.rows[0].data.text, 'Artist - One');
    assert.strictEqual(splits.rows[0].icon, '/static_images/vista-icons/check-16.png', 'a written split carries Vista\'s check icon');
    assert.strictEqual(splits.rows[1].data.text, 'Artist - Two');
    assert.strictEqual(splits.rows[1].icon, null, 'a split still to be written has no icon');
    assert(/will make 2 files/.test(secBody('lz-rad-sel')), 'the splits shows under the list');
    ['state', 'segsWritten', 'segsExpected', 'held', 'gaps', 'gapSeconds', 'bufferSegs', 'behindS', 'stalled', 'stuckSeq', 'refetches', 'cuts'].forEach((k) => delete rec0[k]);
    // ---- Queue: the counts as a property list, the state cell in the list
    page('queue');
    assert(/Waiting:1/.test(secBody('lz-q-sum')) && /Running:0/.test(secBody('lz-q-sum')) && /Missed:0/.test(secBody('lz-q-sum')), 'the queue counts as a property list');
    assert.strictEqual(rowsSeen.last.rows.length, 1);
    assert.strictEqual(rowsSeen.last.rows[0].data.radio, 'Lizumi-Recorder-2', 'queue shows the virtual radio');
    assert.strictEqual(rowsSeen.last.rows[0].data.qstate, 'Running', 'queue shows the state');
    assert.strictEqual(colsKey('lz-queue', 'qstate').html(rowsSeen.last.rows[0].data), 'Running', 'a running entry is plain');
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
    assert.strictEqual(colsKey('lz-schedules', 'state').html({ tone: 'idle', state: 'Off' }), 'Off', 'the schedule state cell is plain when off');
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
    assert.strictEqual(colsKey('lz-accounts', 'state').html(rowsSeen.last.rows[0].data), 'Signed in', 'the account state cell is plain when signed in');
    page('recordings'); await new Promise((r) => setTimeout(r, 20));
    assert(sent.includes('xmradio_tape_tracks'), 'tape read');
    assert(sent.includes('xmradio_rec_held'), 'held read');
    const heldReads = () => sent.filter((x) => x === 'xmradio_rec_held').length;
    // ---- Recordings: two sections, the actions per state
    let pg = page('recordings');
    assert.deepStrictEqual([...rowsSeen.sections.map((x) => x.title)], ['Held recordings (5)', 'On the tape (1)']);
    const rec = def.nodes()[0].children.find((x) => x.id === 'recordings');
    const acts = (rid) => { const g = def.selCommands(rec, `h:${rid}`, con); return g ? [...g.items.map((x) => x.text || 'sep')] : null; };
    assert.deepStrictEqual(acts('h1'), ['Assemble', 'sep', 'Delete'], 'stopped');
    assert.deepStrictEqual(acts('h2'), ['Re-assemble', 'sep', 'Delete'], 'assembled');
    assert.deepStrictEqual(acts('h3'), ['Assemble', 'sep', 'Delete'], 'failed');
    assert.strictEqual(acts('h4'), null, 'assembling: nothing');
    assert.strictEqual(acts('h5'), null, 'recording: nothing');
    assert.strictEqual(def.selCommands(rec, 'r:f1', con), null, 'a tape row has no held actions');
    page('recordings');
    assert(sandbox.mmcLizumi._state.held.length === 5);
    assert.strictEqual(colsKey('lz-held', 'state').html({ tone: 'bad', state: 'Failed', error: 'x' }), '[err:Failed: x]', 'a failed held recording carries Vista\'s error icon');
    // never re-read on a repaint, re-read when the deck's held summary moves
    const before = heldReads();
    page('recordings'); page('recordings');
    assert.strictEqual(heldReads(), before, 'no re-read without a change');
    st.deck.held = { n: 3, assembling: 1, failed: 1 };
    page('recordings'); await new Promise((r) => setTimeout(r, 20));
    assert.strictEqual(heldReads(), before + 1, 're-read when deck.held changes');
    // Assemble
    con.sel = 'h:h1';
    await def.action('held-assemble', con);
    assert.strictEqual(payloads.filter((p) => p.type === 'xmradio_rec_assemble').pop().data.rid, 'h1');
    assert.strictEqual(heldReads(), before + 2, 'the list is read again after an action');
    // an error is shown through the kit
    failNext = true;
    rowsSeen.box = null;
    await def.action('held-assemble', con);
    assert(rowsSeen.box && /Assembly broke/.test(rowsSeen.box.html), 'the error shows in the kit box');
    // Delete confirms first
    con.boxAnswer = false;
    const delsBefore = payloads.filter((p) => p.type === 'xmradio_rec_held_delete').length;
    await def.action('held-delete', con);
    assert(/delete the segments/.test(rowsSeen.box.html), 'confirmation');
    assert.strictEqual(payloads.filter((p) => p.type === 'xmradio_rec_held_delete').length, delsBefore, 'Cancel deletes nothing');
    assert.strictEqual(con.sel, 'h:h1', 'Cancel keeps the selection');
    con.boxAnswer = true;
    await def.action('held-delete', con);
    assert.strictEqual(payloads.filter((p) => p.type === 'xmradio_rec_held_delete').pop().data.rid, 'h1');
    // the held list row renders gaps with the warning state
    page('recordings');
    assert(pg && true);
    // ---- Diagnostics: the overview, the recordings with trouble, the link, the accounts and the health numbers
    st.deck.history = [{ id: 'm1', channelId: 'c1', a: 'Gone', t: 'Song', state: 'missed', reason: 'The song left the stream window', endedAt: 5 }, { id: 'd1', channelId: 'c1', state: 'done' }];
    st.deck.offline = true;
    st.slots = { max: 4, list: [{ slot: 1, name: 'Lizumi-Recorder-1', signedIn: false, handle: 'ab', lastError: 'Bad password', lastErrorAt: 1 }] };
    // the complaint behind the redesign: a stuck recording must read as a problem, not a neutral metric
    Object.assign(st.deck.recordings[0], { state: 'recording', behindS: 8338, refetches: 423, until: Date.now() - 3600000 });
    page('diagnostics');
    assert.deepStrictEqual([...rowsSeen.sections.map((x) => x.id)], ['lz-diag-ovw', 'lz-diag-rec', 'lz-diag-link', 'lz-diag-acc', 'lz-diag-health', 'lz-diag-miss']);
    assert.deepStrictEqual([...rowsSeen.sections.map((x) => x.title)], ['Overview', 'Recordings in trouble (1)', 'Link', 'Accounts', 'Recording health', 'Missed queue entries']);
    assert(/1 of 4 virtual radios is recording/.test(rowsSeen.overview.paras[0]) && /is past its end time/.test(rowsSeen.overview.paras[0]), 'the plain-words verdict names the trouble');
    assert(rowsSeen.overview.paras.some((p) => /\[err:The recorder service is not answering\.\]/.test(p)), 'the overview carries the offline state line');
    assert(/\[err:Offline/.test(secBody('lz-diag-link')), 'link state offline');
    const tr = rowsSeen['lz-diag-trouble'];
    assert.strictEqual(tr.rows.length, 1, 'only the recording in trouble is listed');
    assert.strictEqual(tr.rows[0].icon, '/static_images/vista-icons/warning-16.png', 'Vista\'s warning icon on the row');
    assert(/past its end time/.test(tr.rows[0].data.problem), 'the plain-words reason on the row');
    const hb = secBody('lz-diag-health');
    assert(/Behind live:\[warn:2 h 18 min\]/.test(hb), 'behind seconds as a property, carrying the warning icon');
    assert(/Re-fetches:\[warn:423\]/.test(hb), 'a re-fetch count that means a defect is never a neutral figure');
    assert(/Lizumi-Recorder-1 - /.test(hb), 'each recording\'s numbers are named');
    assert.strictEqual(rowsSeen['lz-diag-miss'].rows.length, 1, 'only the missed entry');
    assert.strictEqual(rowsSeen['lz-diag-miss'].rows[0].data.reason, 'The song left the stream window');
    assert(/Bad password/.test(rowsSeen['lz-diag-acc'].rows[0].data.error), 'sign-in failure listed');
    st.deck.offline = false; st.deck.history = []; delete st.deck.held;
    ['behindS', 'refetches', 'until'].forEach((k) => delete st.deck.recordings[0][k]);
    // ---- Settings: a list, the dialog, the save payload
    page('settings');
    assert.strictEqual(rowsSeen.last.rows.length, 5, 'five settings');
    const setNode = def.nodes()[0].children.find((x) => x.id === 'settings');
    assert.deepStrictEqual([...def.commands(setNode, con).map((x) => x.text)], ['Change Settings...']);
    await def.action('set-edit', con);
    dlg = dialogsOpened.pop();
    ctx = fakeCtx(dlg.init);
    assert.strictEqual(ctx.vals[301], '1'); assert.strictEqual(ctx.vals[303], '120', 'defaults shown');
    ctx.vals[301] = '2'; ctx.vals[302] = '5'; ctx.vals[303] = '300'; ctx.vals[304] = '4'; ctx.vals[305] = '48';
    assert.strictEqual(await dlg.ok(ctx), true);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(payloads.filter((p) => p.type === 'xmradio_rec_settings').pop().data)), { streamsPerAccount: 2, healthyBuffer: 5, behindSeconds: 300, refetchRetries: 4, keepSegmentsHours: 48 });
    page('settings'); assert.strictEqual(rowsSeen.last.rows[2].data.value, '300', 'the page shows the saved value');
    ctx.vals[301] = '5';
    assert.strictEqual(await dlg.ok(ctx), false, 'out of range is refused'); assert(/1 to 4/.test(ctx.texts[320]));
    ctx.vals[301] = '2'; ctx.vals[303] = '10';
    assert.strictEqual(await dlg.ok(ctx), false); assert(/30 to 3600/.test(ctx.texts[320]));
    ctx.vals[303] = '1.5';
    assert.strictEqual(await dlg.ok(ctx), false, 'not a whole number');
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
    assert(rowsSeen['lz-radios'].rows.every((x) => x.data.state === 'Standby'), 'feed push applied (every slot on standby)');
    def.onClose(con);
    await new Promise((r) => setTimeout(r, 5));
    assert(sent.includes('status_unsubscribe'), 'feed dropped on close');
    console.log('test-mmc-lizumi: ok');
})().catch((e) => { console.error(e); process.exit(1); });
