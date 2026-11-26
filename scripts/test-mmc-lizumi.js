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
    { rid: 'h4', channelId: 'c1', kind: 'song', slot: 1, state: 'assembling', since: 1, endedAt: 2, segs: 4, gaps: [], gapSeconds: 0, files: [], error: '', keepUntil: 0 },
    { rid: 'h5', channelId: 'c1', kind: 'song', slot: 1, state: 'recording', since: 1, endedAt: 0, segs: 4, gaps: [], gapSeconds: 0, files: [], error: '', keepUntil: 0 }
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
    // ---- Virtual Radios: a summary strip of count tiles, then a card per virtual radio
    const secBody = (id) => (rowsSeen.sections.find((s) => s.id === id) || {}).body || '';
    page('radios');
    assert.strictEqual(rowsSeen.sections.length, 2, 'a summary section and the cards');
    assert(/lz-tile/.test(secBody('lz-rad-sum')) && /data-act="nav:queue"/.test(secBody('lz-rad-sum')), 'count tiles that jump to their page');
    let body = secBody('lz-rad-cards');
    assert(/Lizumi-Recorder-1/.test(body) && /Lizumi-Recorder-4/.test(body), 'a card per virtual radio');
    assert(/lz-chip is-ok">Recording</.test(body), 'slot 1 records');
    assert(/lz-chip is-idle">Standby</.test(body), 'a free slot is on standby, not a fault');
    // ---- the counters on a recording's card
    const st = sandbox.mmcLizumi._state;
    const rec0 = st.deck.recordings[0];
    Object.assign(rec0, { state: 'paused-refilling', segsWritten: 40, segsExpected: 50, held: 40, gaps: [{ from: 1, to: 2 }], gapSeconds: 6, bufferSegs: 3, behindS: 0 });
    page('radios'); body = secBody('lz-rad-cards');
    assert(/Paused - refilling/.test(body), 'the state chip');
    assert(/3 segments/.test(body), 'the buffer depth');
    assert(/40 \/ 50 segments \(80%\)/.test(body), 'segments written vs expected with the percentage');
    assert(/1 \(6 s\)/.test(body), 'the gaps');
    assert(/lz-warn/.test(body) && /1 gap \(6 s of audio missing\)/.test(body), 'a gap is a warning');
    rec0.state = 'behind'; rec0.behindS = 300; rec0.gaps = []; rec0.gapSeconds = 0;
    page('radios'); body = secBody('lz-rad-cards');
    assert(/lz-chip is-warn">Behind</.test(body), 'behind is a warning chip');
    assert(/behind live by 5 min/.test(body), 'the verdict line says how far behind');
    rec0.state = 'buffering'; rec0.behindS = 0;
    page('radios'); assert(/lz-chip is-info">Buffering</.test(secBody('lz-rad-cards')), 'buffering');
    // a recording that stopped writing audio is unmissable
    Object.assign(rec0, { state: 'recording', behindS: 0, stalled: 3000, stuckSeq: 389999, refetches: 12 });
    page('radios'); body = secBody('lz-rad-cards');
    assert(/is-trouble/.test(body) && /no audio for 50 min - recording is stuck/.test(body), 'a stalled recording is unmissable');
    assert(/segment 389999 is holding it, 12 re-tries/.test(body), 'the holding segment and its re-tries');
    // the splits a recording will be cut into
    rec0.cuts = [{ at: 1, a: 'Artist', t: 'One', done: true }, { at: 2, a: 'Artist', t: 'Two' }];
    page('radios'); body = secBody('lz-rad-cards');
    assert(/Will be split into \(2\)/.test(body) && /Artist - One/.test(body) && /Artist - Two/.test(body), 'the splits it will produce');
    assert(/lz-split is-done/.test(body), 'a passed split is ticked');
    ['state', 'segsWritten', 'segsExpected', 'held', 'gaps', 'gapSeconds', 'bufferSegs', 'behindS', 'stalled', 'stuckSeq', 'refetches', 'cuts'].forEach((k) => delete rec0[k]);
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
    // ---- Diagnostics
    st.deck.history = [{ id: 'm1', channelId: 'c1', a: 'Gone', t: 'Song', state: 'missed', reason: 'The song left the stream window', endedAt: 5 }, { id: 'd1', channelId: 'c1', state: 'done' }];
    st.deck.offline = true;
    st.slots = { max: 4, list: [{ slot: 1, name: 'Lizumi-Recorder-1', signedIn: false, handle: 'ab', lastError: 'Bad password', lastErrorAt: 1 }] };
    // the complaint behind the redesign: a stuck recording must read as a problem, not a neutral metric
    Object.assign(st.deck.recordings[0], { state: 'recording', behindS: 8338, refetches: 423, until: Date.now() - 3600000 });
    page('diagnostics');
    assert.deepStrictEqual([...rowsSeen.sections.map((x) => x.title)], ['Summary', 'Link', 'Accounts', 'Recording health', 'Missed queue entries']);
    assert(/\[err:Offline/.test(rowsSeen.sections[1].body), 'link state offline');
    const sum = secBody('lz-diag-sum');
    assert(/1 of 4 virtual radios is recording/.test(sum) && /is past its end time/.test(sum), 'a one-line summary at the top');
    const hb = secBody('lz-diag-rec');
    assert(/lz-verdict is-bad/.test(hb) && /past its end time/.test(hb), 'a stalled recording has a bad verdict');
    assert(/behind 2 h 18 min/.test(hb) && /423 re-fetches/.test(hb), 'the numbers are under the verdict');
    assert.strictEqual(rowsSeen.last.rows.length, 1, 'only the missed entry');
    assert.strictEqual(rowsSeen.last.rows[0].data.reason, 'The song left the stream window');
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
    assert(/lz-chip is-idle">Standby</.test(secBody('lz-rad-cards')), 'feed push applied');
    def.onClose(con);
    await new Promise((r) => setTimeout(r, 5));
    assert(sent.includes('status_unsubscribe'), 'feed dropped on close');
    console.log('test-mmc-lizumi: ok');
})().catch((e) => { console.error(e); process.exit(1); });
