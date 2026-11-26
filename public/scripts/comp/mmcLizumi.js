/**
 * Lizumi (Yozora #1252, slice S4): the MMC console for XM Radio recording management, opened from the Start menu
 * as its own window. Pages (Schedules is managed here, the rest read-only). Everything is said in Vista's own
 * console vocabulary - MMC's overview page, property lists (c.props), list views (c.listView) with a state cell
 * (c.state) and the kit's progress bar; there is no drawn chrome of the console's own.
 *
 *   Lizumi
 *     Virtual Radios    MMC's overview page with the plain-words verdict, then the counts as a property list,
 *                       then the virtual radios (Lizumi-Recorder-1..4) - one list row each (state, channel and cut
 *                       on air, running time, reach-back, buffer depth, segments written vs expected with the kit
 *                       progress bar and its percentage, gaps) - and the selected radio's detail below it: its
 *                       properties, a state line when the recording has stopped writing audio, and the splits the
 *                       cut store will make of it as a list
 *     Queue             the waiting / running / missed counts as a property list, then the common queue in due order
 *     Schedules         timers, search terms and alerts as one list
 *     Recordings        held recordings (segments on disk: Assemble, Re-assemble, Delete) with the selected one's
 *                       splits, then the current tape's tracks with their merged metadata
 *     Accounts          one SiriusXM login per virtual radio
 *     Live              a monitor player for one recording slot (its growing HLS playlist), Mute and the platform's
 *                       trackbar for volume, and the tape's own progress; the player exists only while this page is shown
 *     Diagnostics       MMC's overview page with the plain-words verdict, the recordings with trouble (a plain-words
 *                       reason on the row), then link, accounts and the health numbers as property lists, and the
 *                       missed queue entries
 *     Settings          streams per account, healthy buffer, behind seconds, re-fetch retries, keep segments hours
 *
 * Data: the admin packet xmradio_mmc_view ({ account, deck, slots }) once, then the statusHub feed `xmradio_mmc`
 * (pushType xmradio_mmc_status, items.deck / items.account) while the window is open; nothing is polled. Channel names
 * come from xmradio_lineup. The look is public/css/mmc-lizumi.css on public/css/mmc-lizumi-tokens.css.
 *
 *   window.openLizumi(node?)     opens it (node: a page id)
 *   window.mmcLizumi.def()       the snap-in's def
 */
(function (root) {
    'use strict';

    const ID = 'lizumi';
    const TITLE = 'Lizumi';
    const APP = '/static_images/app_icons/xmradio.png';
    const VI = '/static_images/vista-icons';
    const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const NODES = [
        { id: 'radios', name: 'Virtual Radios', icon: `${VI}/volume-high-16.png` },
        { id: 'queue', name: 'Queue', icon: `${VI}/service-worker-16.png` },
        { id: 'schedules', name: 'Schedules', icon: `${VI}/windows-update-16.png` },
        { id: 'recordings', name: 'Recordings', icon: `${VI}/search-folder-16.png` },
        { id: 'accounts', name: 'Accounts', icon: `${VI}/account-manager-16.png` },
        { id: 'live', name: 'Live', icon: `${VI}/net-internet-16.png` },
        { id: 'diagnostics', name: 'Diagnostics', icon: `${VI}/problem-reports-16.png` },
        { id: 'settings', name: 'Settings', icon: `${VI}/application-16.png` }
    ];
    const IC = {
        rec: `${VI}/volume-high-16.png`, mute: `${VI}/volume-mute-16.png`, idle: `${VI}/volume-low-16.png`,
        queue: `${VI}/service-worker-16.png`, warn: `${VI}/warning-16.png`
    };
    // a recording that has written nothing for this long is stuck, not slow (the stalled marker)
    const STALL = 120;

    const state = {
        console: null, account: null, deck: null, slots: { max: 4 }, loaded: false, error: '',
        channels: new Map(), lineup: [], lineupAsked: false,
        tracks: null, tracksFor: '', tracksLoading: false,
        held: null, heldFor: '', heldLoading: false,
        feedOn: false,
        liveRid: '', vol: 80, muted: false, player: null,
        segWatch: new Map() // rid -> { n: segsWritten, at: when it last moved } - the stalled marker when the server sends none
    };
    const HLS_SRC = '/dist/hlsjs/hls.light.min.js';
    const appScopeSignal = (root.melatonSegments && typeof root.melatonSegments.callerSignal === 'function' && root.melatonSegments.callerSignal()) || undefined;
    let wired = false;

    function active(c) {
        return !!c && !!c.modal && c.modal.isConnected && (typeof c.isActive !== 'function' || c.isActive());
    }

    function repaint() {
        const c = state.console;
        if (active(c)) c.refresh();
    }

    async function send(type, data) {
        const ws = root.wsClient;
        if (!ws || typeof ws.sendMessage !== 'function') throw new Error('Melaton is not connected to the server.');
        const r = await ws.sendMessage(type, data || {}, false);
        if (!r || r.success === false) throw new Error((r && r.error) || 'The server did not answer.');
        return r.data && typeof r.data === 'object' ? r.data : r;
    }

    // ---- formatting -------------------------------------------------------------------------------------

    const esc = (x) => String(x == null ? '' : x).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    // until the lineup has come in a channel shows no name rather than the word "Channel"
    const chName = (id) => state.channels.get(id) || '';
    const cutText = (cut) => (cut ? [cut.a, cut.t || cut.s].filter(Boolean).join(' - ') : '');
    const clock = (ms) => (ms ? new Date(ms).toLocaleString([], { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

    function span(sec) {
        const s = Math.max(0, Math.round(Number(sec) || 0));
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        return h ? `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`;
    }

    /** A length as m:ss (a tape track's length, the Live page). */
    const mss = (sec) => { const s = Math.max(0, Math.round(Number(sec) || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

    /** Plain words for a span, for a verdict line: "2 h 29 min", "42 min", "35 s". */
    function durText(sec) {
        const s = Math.max(0, Math.round(Number(sec) || 0));
        if (s < 60) return `${s} s`;
        const m = Math.floor(s / 60);
        if (m < 60) return `${m} min`;
        const h = Math.floor(m / 60);
        const mm = m % 60;
        return mm ? `${h} h ${mm} min` : `${h} h`;
    }

    /** A short span for a cell: "3h 20m", "12m", "35s". */
    function durShort(sec) {
        const s = Math.max(0, Math.round(Number(sec) || 0));
        if (s < 60) return `${s}s`;
        const m = Math.floor(s / 60);
        if (m < 60) return `${m}m`;
        const h = Math.floor(m / 60);
        const mm = m % 60;
        return mm ? `${h}h ${mm}m` : `${h}h`;
    }

    /** "in 3h 20m" / "12m ago" for a future / past moment. */
    function relText(at) {
        if (!at) return '';
        const d = Math.round((at - Date.now()) / 1000);
        return d >= 0 ? `in ${durShort(d)}` : `${durShort(-d)} ago`;
    }

    /** Explorer's sizes (bytes / KB / MB / GB), from the shell. */
    const sizeText = (n) => (root.mmcConsole && root.mmcConsole.size ? root.mmcConsole.size(n) : `${Math.round(Number(n) || 0)} bytes`);

    function daysText(days) {
        const d = Array.isArray(days) ? days : [];
        if (!d.length) return '';
        return d.length === 7 ? 'Every day' : d.slice().sort().map((x) => DAYS[x]).join(' ');
    }

    // ---- data: the view once, then the feed -------------------------------------------------------------

    async function loadView() {
        try {
            const r = await send('xmradio_mmc_view', {});
            state.account = r.account || null;
            state.deck = r.deck || null;
            if (r.slots && r.slots.max) state.slots = r.slots;
            state.error = '';
        } catch (err) {
            state.error = (err && err.message) || 'The server did not answer.';
        }
        state.loaded = true;
        repaint();
    }

    async function loadLineup() {
        if (state.lineupAsked) return;
        state.lineupAsked = true;
        try {
            const r = await send('xmradio_lineup', {});
            state.lineup = r.channels || [];
            (r.channels || []).forEach((ch) => state.channels.set(ch.id, ch.number ? `${ch.number} ${ch.name}` : ch.name));
            repaint();
        } catch (_) { state.lineupAsked = false; }
    }

    async function loadTracks(c) {
        const d = state.deck;
        if (!d || state.tracksLoading) return;
        const key = `${d.workspaceId}/${d.tape}/${(d.recordings || []).length}`;
        if (state.tracksFor === key) return;
        state.tracksLoading = true;
        try {
            const r = await send('xmradio_tape_tracks', { workspaceId: d.workspaceId, tape: d.tape });
            state.tracks = r.tracks || [];
        } catch (_) {
            state.tracks = [];
        }
        state.tracksFor = key;
        state.tracksLoading = false;
        if (active(c)) c.refresh();
    }

    function applyItems(items) {
        if (!items) return;
        if (items.deck) state.deck = items.deck;
        if (items.account) state.account = items.account;
        if (items.slots && items.slots.max) state.slots = items.slots;
    }

    /** Lizumi's own feed (xmradio_mmc, statusHub): only while the console is open; never the radio app's xmradio feed. */
    async function want(on) {
        const ws = root.wsClient;
        if (on === state.feedOn || !ws || typeof ws.sendMessage !== 'function') return;
        state.feedOn = on;
        if (!on) { try { await ws.sendMessage('status_unsubscribe', { feed: 'xmradio_mmc' }, false); } catch (_) { /* gone */ } return; }
        if (!wired && typeof ws.on === 'function') {
            wired = true;
            ws.on('xmradio_mmc_status', (msg) => {
                if (!state.feedOn || !msg) return;
                applyItems((msg.changed || (msg.data && msg.data.changed)) || {});
                repaint();
            }, { signal: appScopeSignal });
            // the server forgets a dropped socket's subscriptions
            ws.on('connected', () => { if (state.feedOn) { state.feedOn = false; void want(true); } }, { signal: appScopeSignal });
        }
        try {
            const r = await ws.sendMessage('status_subscribe', { feed: 'xmradio_mmc' }, false);
            applyItems(r && (r.items || (r.data && r.data.items)));
        } catch (_) {
            state.feedOn = false;
        }
        repaint();
    }

    // ---- the shape of the deck: slots, health, verdicts -------------------------------------------------

    const EMPTY = 'There are no items to show in this view.';
    const KIND = { song: 'Song', cut: 'Song on air', manual: 'Channel', channel: 'Channel', timer: 'Timer', alert: 'Alert', term: 'Search term' };
    const recs = () => (state.deck && Array.isArray(state.deck.recordings) ? state.deck.recordings : []);
    const recOf = (rid) => recs().find((r) => r.rid === rid) || null;
    const slotName = (i) => `Lizumi-Recorder-${i + 1}`;
    const settings = () => (state.deck && state.deck.settings) || {};
    const poolOf = () => { const d = state.deck || {}; return Array.isArray(d.pool) && d.pool.length ? d.pool : null; };
    const maxSlots = () => (poolOf() ? poolOf().length : ((state.slots && state.slots.max) || 4));
    const gapCount = (r) => Number(r.gaps && r.gaps.length != null ? r.gaps.length : r.gaps) || 0;

    /** Signed-in virtual radios: the pool's readiness, else the slot list's sign-ins. */
    function signedIn() {
        const pool = poolOf();
        if (pool) return pool.filter((x) => x.ready).length;
        const list = state.slots && Array.isArray(state.slots.list) ? state.slots.list : null;
        return list ? list.filter((x) => x.signedIn).length : maxSlots();
    }

    /** How long a recording has written no segment: the server's `stalled`, else how long its segment count has stood still. */
    function stalledOf(r) {
        const server = Math.round(Number(r.stalled) || 0);
        if (server) return server;
        const n = Number(r.segsWritten) || 0;
        const w = state.segWatch.get(r.rid);
        if (!w) { state.segWatch.set(r.rid, { n, at: Date.now() }); return 0; }
        if (w.n !== n) { w.n = n; w.at = Date.now(); return 0; }
        return Math.max(0, Math.round((Date.now() - w.at) / 1000));
    }

    /** A recording's numbers and its plain-words verdict (see the server's healthOf). */
    function health(r) {
        const bs = Number(settings().behindSeconds) || 120;
        const behindS = Math.round(Number(r.behindS) || 0);
        const stalled = stalledOf(r);
        const refetches = Number(r.refetches) || 0;
        const pauses = Number(r.pauses) || 0;
        const holes = Number(r.holes) || 0;
        const gaps = gapCount(r);
        const gapS = Math.round(Number(r.gapSeconds) || 0);
        const segsW = Number(r.segsWritten) || 0;
        const segsE = Number(r.segsExpected) || 0;
        const held = Number(r.held) || 0;
        const pct = segsE ? Math.min(100, Math.round((segsW / segsE) * 100)) : (segsW ? 100 : 0);
        const until = Number(r.until) || 0;
        const pastEnd = !!(until && Date.now() > until);
        const behind = behindS > bs;
        const tone = stalled > STALL || pastEnd ? 'bad' : (behind || holes > 0 || gaps > 0) ? 'warn' : 'ok';
        return { behindS, stalled, refetches, pauses, holes, gaps, gapS, segsW, segsE, held, pct, until, pastEnd, behind, tone };
    }

    /** The one short line that says a recording is in trouble (or null when it is fine). */
    function marker(r, h) {
        h = h || health(r);
        const bits = [];
        let tone = 'ok';
        if (h.stalled > STALL) {
            tone = 'bad';
            const hold = r.stuckSeq != null ? ` (segment ${r.stuckSeq} is holding it${h.refetches ? `, ${h.refetches} re-tries` : ''})` : (h.refetches ? ` (${h.refetches} re-fetches)` : '');
            bits.push(`no audio for ${durText(h.stalled)} - recording is stuck${hold}`);
        }
        if (h.pastEnd) { tone = 'bad'; bits.push(`past its end time by ${durText((Date.now() - h.until) / 1000)} - it should have stopped`); }
        if (h.behind) { if (tone === 'ok') tone = 'warn'; bits.push(`behind live by ${durText(h.behindS)}${h.refetches ? ` (${h.refetches} re-fetches)` : ''}`); }
        if (h.holes > 0) { if (tone === 'ok') tone = 'warn'; bits.push(`${h.holes} unreadable segment${h.holes === 1 ? '' : 's'}${r.stuckSeq != null ? ` (segment ${r.stuckSeq} is holding it)` : ''}`); }
        else if (h.gaps > 0) { if (tone === 'ok') tone = 'warn'; bits.push(`${h.gaps} gap${h.gaps === 1 ? '' : 's'} (${h.gapS} s of audio missing)`); }
        return bits.length ? { tone, text: bits.join('; ') } : null;
    }

    /** The list's State cell text: a warn tone only for real trouble. */
    function stateOf(r, h) {
        h = h || health(r);
        if (h.behind) return { text: 'Behind', tone: 'warn' };
        if (r.state === 'buffering') return { text: 'Buffering', tone: 'info' };
        if (r.state === 'paused-refilling') return { text: 'Paused - refilling', tone: 'info' };
        if (r.state === 'behind') return { text: 'Behind', tone: 'warn' };
        return { text: 'Recording', tone: 'ok' };
    }

    /** Everything a list row or a verdict needs about one recording. */
    function assess(r) { const h = health(r); return { h, st: stateOf(r, h), mk: marker(r, h) }; }

    /** The splits a recording will be cut into (the merged cut store), one line each. */
    function splitLine(c) {
        const a = c && !c.ad && c.a ? c.a : '';
        const t = c && c.t ? c.t : (c && c.s) || '';
        return [a, t].filter(Boolean).join(' - ') || (c && c.ad ? 'Ad break' : 'Untitled');
    }
    const splitsOf = (r) => (Array.isArray(r && r.cuts) ? r.cuts : []).map((c) => ({ at: c.at, ad: !!c.ad, done: !!c.done, show: c.s || '', text: splitLine(c) }));

    /** The splits a recording will be cut into, as Vista's list view (Vista's check icon on the ones written). */
    function splitsSection(c, list, heading) {
        if (!list.length) return '';
        const rows = list.map((x) => ({ key: null, icon: x.done ? `${VI}/check-16.png` : null, data: x }));
        const cols = [
            { t: 'Split', w: 300, key: 'text', text: (x) => x.text },
            { t: 'Show', w: 150, key: 'show', text: (x) => x.show },
            { t: 'Kind', w: 70, key: 'kind', text: (x) => (x.ad ? 'Ad break' : 'Song') },
            { t: 'State', w: 80, key: 'state', text: (x) => (x.done ? 'Written' : 'Pending') }
        ];
        return `<p class="mmc-note">${esc(heading)}</p>${c.listView(cols, rows, { fit: true, empty: 'No splits.' })}`;
    }

    // ---- Vista's own vocabulary: state cells, summary props, the overview page -------------------------

    /** Vista's state: plain when it is good, its warning or error icon when it is not (never a chip). */
    function stateCell(c, tone, text) {
        if (tone === 'bad' || tone === 'error') return c.state(false, text, false);
        if (tone === 'warn') return c.state(false, text, true);
        return c.state(true, text);
    }

    /** The counts as Vista's property list (a figure that means a defect carries Vista's icon, never a plain one);
     *  each figure is a link to the page it counts, as the shell draws them. */
    function summaryProps(c) {
        const d = state.deck || {};
        const recsL = recs();
        const troubled = recsL.filter((r) => health(r).tone !== 'ok').length;
        const q = (d.queue || []).length;
        const held = d.held || {};
        const tape = Array.isArray(state.tracks) ? state.tracks.length : 0;
        const heldN = (held.n || 0) + recsL.length;
        const link = (id, label) => `<span class="mmc-link" data-act="nav:${id}">${esc(label)}</span>`;
        const badHeld = held.failed ? c.state(false, `${held.failed} failed`, false) : held.assembling ? c.state(false, `${held.assembling} assembling`, true) : '';
        return c.props([
            ['Virtual radios', esc(String(maxSlots()))],
            ['Recording now', `${esc(String(recsL.length))}${troubled ? ` ${c.state(false, `${troubled} with trouble`, true)}` : ''} ${link('radios', 'Virtual Radios')}`],
            ['Signed in', `${esc(String(signedIn()))} of ${esc(String(maxSlots()))} ${link('accounts', 'Accounts')}`],
            ['Queue waiting', `${esc(String(q))} ${link('queue', 'Queue')}`],
            ['Held recordings', `${esc(String(heldN))}${badHeld ? ` ${badHeld}` : ''} ${link('recordings', 'Recordings')}`],
            ['On the tape', `${esc(String(tape))} ${link('recordings', 'Recordings')}`]
        ]);
    }

    /** MMC 3.0's own overview page: the plain-words verdict, and Vista's state line for one wrong fact. */
    function overviewBlock(c) {
        const paras = [esc(verdictSummary().text)];
        const d = state.deck || {};
        if (d.offline) paras.push(c.state(false, 'The recorder service is not answering.', false));
        return c.overview(APP, paras);
    }

    /** A recording's trouble as a phrase that follows its name in a sentence. */
    function troublePhrase(r, h) {
        const bits = [];
        if (h.stalled > STALL) bits.push(`has written nothing for ${durText(h.stalled)}`);
        if (h.behind) bits.push(`is behind live by ${durText(h.behindS)}`);
        if (h.pastEnd) bits.push(`is past its end time by ${durText((Date.now() - h.until) / 1000)}`);
        if (h.holes > 0) bits.push(`has ${h.holes} unreadable segment${h.holes === 1 ? '' : 's'}`);
        else if (h.gaps > 0 && !bits.length) bits.push(`has ${h.gaps} gap${h.gaps === 1 ? '' : 's'}`);
        if (!bits.length && h.refetches >= 20) bits.push(`has re-fetched ${h.refetches} times`);
        return bits.join(' and ');
    }

    /** The one plain-words line: what is running and what is wrong with it. */
    function verdictSummary() {
        const recsL = recs();
        const max = maxSlots();
        const line = `${recsL.length} of ${max} virtual radios ${recsL.length === 1 ? 'is' : 'are'} recording`;
        const bad = recsL.map((r) => {
            const h = health(r);
            const mk = marker(r, h);
            return mk ? { r, mk, phrase: troublePhrase(r, h) } : null;
        }).filter(Boolean);
        if (!bad.length) return { tone: recsL.length ? 'ok' : '', text: recsL.length ? `${line}; every recording is writing audio.` : `${line}.` };
        const tone = bad.some((x) => x.mk.tone === 'bad') ? 'bad' : 'warn';
        const parts = bad.map((x) => `${slotName((x.r.slot || 1) - 1)} ${x.phrase}`);
        return { tone, text: `${line}; ${parts.join('; ')}.` };
    }

    // ---- Virtual Radios: the list, and the selected radio's detail below it ------------------------------

    /** One virtual radio as a list row: what it is playing, how far along it is, its segments and its gaps. */
    function radioRows() {
        const pool = poolOf();
        const max = maxSlots();
        const bySlot = new Map();
        recs().forEach((x, i) => { const n = x.slot || (pool ? 1 : i + 1); if (!bySlot.has(n)) bySlot.set(n, x); });
        const rows = [];
        for (let i = 0; i < max; i++) {
            const r = bySlot.get(i + 1) || null;
            if (!r) {
                const ready = pool ? pool[i].ready : true;
                rows.push({ key: `s:${i + 1}`, icon: IC.idle, data: {
                    slot: slotName(i), idle: true, state: ready ? 'Standby' : 'No account', tone: 'idle', health: 'ok',
                    channel: '', cut: '', kind: '', running: '', back: '', buffer: '', segs: '', segsW: 0, segsE: 0, held: 0, pct: 0, gaps: 0, gapS: 0, cuts: [],
                    note: ready ? 'On standby; no queue entry is running.' : 'No account is signed in. Sign it in on the Accounts page to use it.'
                } });
                continue;
            }
            const { h, st, mk } = assess(r);
            rows.push({ key: `s:${i + 1}`, icon: h.stalled > STALL ? IC.mute : IC.rec, data: {
                slot: slotName(i), idle: false, state: st.text, tone: st.tone, health: h.tone,
                channel: chName(r.channelId) || '-', cut: cutText(r.cut) || '-', kind: KIND[r.kind] || 'Channel',
                running: span((Date.now() - (r.since || Date.now())) / 1000), back: r.back ? span(r.back) : '0:00',
                buffer: r.bufferSegs != null ? String(r.bufferSegs) : '-',
                segsW: h.segsW, segsE: h.segsE, held: h.held, pct: h.pct,
                segs: (h.segsE || h.segsW) ? `${h.segsW} / ${h.segsE || h.segsW}${h.segsE ? ` (${h.pct}%)` : ''}${h.held ? `, ${h.held} held` : ''}` : 'Not reported',
                gaps: h.gaps, gapS: h.gapS, cuts: splitsOf(r), note: mk ? mk.text : 'Writing audio normally.'
            } });
        }
        return rows;
    }

    /** The segments cell: the kit's Vista progress bar and the same figure in words. */
    function segCell(x) {
        if (!x.segsE && !x.segsW) return `<i>${esc(x.segs || 'Not reported')}</i>`;
        const cls = x.health === 'bad' ? ' class="error"' : x.health === 'warn' ? ' class="paused"' : '';
        return `<div class="lz-seg"><div class="mmc-progress"><div role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${x.pct}"${cls} style="--lz-pct:${x.pct}"><div></div></div><span>${esc(x.segs)}</span></div></div>`;
    }

    /** The selected virtual radio: its properties (a state line when it is in trouble) and the splits it will make. */
    function radioDetail(c, row) {
        if (!row) return '<p class="mmc-note">Select a virtual radio to see its details.</p>';
        const d = row.data;
        if (d.idle) return `<p class="mmc-note">${esc(d.note)}</p>`;
        const props = c.props([
            ['State', stateCell(c, d.tone, d.state)],
            ['Channel', esc(d.channel)],
            ['On air', esc(d.cut)],
            ['Kind', esc(d.kind)],
            ['Running', esc(d.running)],
            ['Reached back', esc(d.back)],
            ['Buffer depth', d.buffer === '-' ? '-' : `${esc(d.buffer)} segments`],
            ['Segments', esc(d.segs)],
            ['Held', esc(String(d.held || 0))],
            ['Gaps', d.gaps > 0 ? stateCell(c, 'warn', `${d.gaps} (${d.gapS} s)`) : 'None'],
            ['Health', d.tone === 'ok' ? esc(d.note) : c.state(false, d.note, d.tone !== 'bad')]
        ]);
        const cuts = d.cuts || [];
        const splits = cuts.length ? splitsSection(c, cuts, `Splits - will make ${cuts.length} file${cuts.length === 1 ? '' : 's'}`) : '';
        return props + splits;
    }

    function radiosPage(c) {
        void loadLineup();
        if (state.deck) void loadTracks(c); // the tape count
        const rows = radioRows();
        const first = rows.find((x) => !x.data.idle);
        if (first && (!c.sel || !rows.some((x) => String(x.key) === String(c.sel)))) c.sel = first.key; // a recording's detail shows by default
        const cols = [
            { t: 'Virtual Radio', w: 116, key: 'slot', text: (x) => x.slot },
            { t: 'State', w: 100, key: 'state', text: (x) => x.state, html: (x) => stateCell(c, x.tone, x.state) },
            { t: 'Channel', w: 116, key: 'channel', text: (x) => x.channel },
            { t: 'On air', w: 150, key: 'cut', text: (x) => x.cut },
            { t: 'Kind', w: 62, key: 'kind', text: (x) => x.kind },
            { t: 'Running', w: 74, key: 'running', text: (x) => x.running },
            { t: 'Reached back', w: 88, key: 'back', text: (x) => x.back },
            { t: 'Buffer', w: 66, num: true, key: 'buffer', value: (x) => Number(x.buffer) || 0, text: (x) => x.buffer },
            { t: 'Segments', w: 158, key: 'segs', value: (x) => x.segsW, text: (x) => x.segs, html: segCell },
            { t: 'Gaps', w: 72, num: true, key: 'gaps', value: (x) => x.gaps, text: (x) => (x.gaps > 0 ? `${x.gaps} (${x.gapS} s)` : 'None'), html: (x) => (x.gaps > 0 ? stateCell(c, 'warn', `${x.gaps} (${x.gapS} s)`) : 'None') }
        ];
        const list = c.listView(cols, rows, { sortId: 'lz-radios', fit: true, empty: 'No virtual radios.' });
        const selRow = rows.find((x) => String(x.key) === String(c.sel)) || null;
        return { html: c.page('Virtual Radios', '', [
            { id: 'lz-rad-ovw', title: 'Overview', body: overviewBlock(c) },
            { id: 'lz-rad-sum', title: 'Summary', body: summaryProps(c) },
            { id: 'lz-rad-list', title: `Virtual radios (${maxSlots()})`, body: list },
            { id: 'lz-rad-sel', title: selRow ? selRow.data.slot : 'Selected virtual radio', body: radioDetail(c, selRow) }
        ]) };
    }

    // ---- Queue ------------------------------------------------------------------------------------------

    const QSTATE = { queued: 'Queued', running: 'Running', missed: 'Missed', done: 'Done', cancelled: 'Cancelled' };
    const QKIND = { song: 'Song', cut: 'Song on air', manual: 'Channel', channel: 'Channel', timer: 'Timer', alert: 'Alert', term: 'Search term' };
    const QTONE = { missed: 'bad', running: 'ok', queued: 'info' };

    function queuePage(c) {
        void loadLineup();
        const d = state.deck || {};
        const waiting = Array.isArray(d.queue) ? d.queue : [];
        const jobs = Array.isArray(d.jobs) ? d.jobs : [];
        const hist = Array.isArray(d.history) ? d.history : [];
        const missed = hist.filter((e) => e.state === 'missed').length;
        const tiles = c.props([
            ['Waiting', esc(String(waiting.length))],
            ['Running', esc(String(jobs.length))],
            ['Missed', missed ? c.state(false, String(missed), true) : '0']
        ]);
        // waiting in due order, then what runs, then the last ones that ended (missed ones say why)
        const list = [].concat(waiting, jobs, hist.slice(0, 50));
        // a running entry with no song of its own (a channel, a timer) names what its recording has on air
        const onAir = (e) => { const r = e.rid && recOf(e.rid); return r ? cutText(r.cut) : null; };
        const rows = list.map((e, i) => ({
            key: `q:${e.id}`,
            icon: e.state === 'missed' ? IC.warn : IC.queue,
            data: {
                n: i + 1, cut: cutText(e) || cutText(onAir(e)) || chName(e.channelId), kind: QKIND[e.kind] || '',
                channel: chName(e.channelId), radio: e.slot ? slotName(e.slot - 1) : '-', qstate: QSTATE[e.state] || 'Queued', tone: QTONE[e.state] || 'idle',
                reason: e.reason || '', expires: e.expiresAt ? `${relText(e.expiresAt)} (${clock(e.expiresAt)})` : '', expiresAt: e.expiresAt || 0,
                added: clock(e.addedAt), addedAt: e.addedAt || 0
            }
        }));
        const cols = [
            { t: 'Order', w: 44, key: 'n', text: (x) => String(x.n), value: (x) => x.n },
            { t: 'Song', w: 190, key: 'cut', text: (x) => x.cut },
            { t: 'Kind', w: 66, key: 'kind', text: (x) => x.kind },
            { t: 'State', w: 78, key: 'qstate', text: (x) => x.qstate, html: (x) => stateCell(c, x.tone, x.qstate) },
            { t: 'Virtual Radio', w: 112, key: 'radio', text: (x) => x.radio },
            { t: 'Added', w: 96, key: 'added', text: (x) => x.added, value: (x) => x.addedAt },
            { t: 'Expires', w: 150, key: 'expires', text: (x) => x.expires, value: (x) => x.expiresAt },
            { t: 'Why', w: 150, key: 'reason', text: (x) => x.reason }
        ];
        return {
            html: c.page('Queue', '', [
                { id: 'lz-q-sum', title: 'At a glance', body: tiles },
                { id: 'lz-q-list', title: `The queue (${list.length})`, body: c.listView(cols, rows, { sortId: 'lz-queue', fit: true, empty: 'The queue is empty.' }) }
            ])
        };
    }

    // ---- Schedules: manage timers, search terms and alerts ----------------------------------------------

    const LENGTHS = [[15, '15 minutes'], [30, '30 minutes'], [60, '1 hour'], [90, '1.5 hours'], [120, '2 hours'], [180, '3 hours'], [240, '4 hours'], [360, '6 hours'], [480, '8 hours']];
    // Vista dialog styles (the radio app's TIMER dialog uses the same)
    const SS = 0x50020000;
    const EDIT = 0x50810080;
    const COMBO = 0x50210003;
    const CHECK = 0x50010003;
    const DAYBTN = 0x50011003; // a check box drawn as a push button (WinCal's S M T W T F S)
    const PUSH = 0x50010000;
    const DEFPUSH = 0x50010001;
    const DLG_STYLE = 0x80C800C8;
    const pad2 = (n) => String(n).padStart(2, '0');

    const lineupList = () => (state.lineup || []).filter((x) => x.sub !== false).map((x) => ({ value: x.id, text: x.number ? `${x.number} ${x.name}` : x.name }));
    const deckList = (k) => (state.deck && Array.isArray(state.deck[k]) ? state.deck[k] : []);

    /** Rules a term carries past its words, as one short line for the list. */
    function ruleText(t) {
        const out = [];
        const f = (label, v, exact) => { if (v) out.push(`${label} ${exact ? 'is' : 'has'} ${v}`); };
        f('Artist', t.artist, t.artistExact);
        f('Title', t.title, t.titleExact);
        f('Show', t.show, t.showExact);
        const a = Number.isInteger(t.afterHour) ? t.afterHour : null;
        const b = Number.isInteger(t.beforeHour) ? t.beforeHour : null;
        if (a != null || b != null) out.push(`Hours ${a != null ? pad2(a) : '00'}-${b != null ? pad2(b) : '24'}`);
        if (t.minDuration > 0) out.push(`Over ${Math.round(t.minDuration / 6) / 10} min`);
        if (t.allowShows) out.push('Shows too');
        if (t.fastTrigger) out.push('At the start only');
        if (t.notify) out.push('Notify');
        return out.join('; ');
    }

    function schedulesPage(c) {
        void loadLineup();
        const d = state.deck || {};
        const rows = [];
        (d.timers || []).forEach((t) => rows.push({
            key: `t:${t.id}`, icon: `${VI}/windows-update-16.png`,
            data: { kind: 'Timer', channel: chName(t.channelId), start: t.start || '', minutes: t.minutes ? String(t.minutes) : '', days: daysText(t.days), date: t.date || '', mode: t.mode || '', match: '', rules: t.notify ? 'Notify' : '', tape: t.destination || '', state: t.off ? 'Off' : 'On', tone: t.off ? 'idle' : 'ok' }
        }));
        (d.terms || []).forEach((t) => rows.push({
            key: `s:${t.id}`, icon: `${VI}/search-16.png`,
            data: { kind: 'Search term', channel: t.channelId ? chName(t.channelId) : 'Any channel', start: '', minutes: '', days: daysText(t.days), date: '', mode: '', match: t.text || '', rules: ruleText(t), tape: t.destination || '', state: 'On', tone: 'ok' }
        }));
        (d.alerts || []).forEach((a) => rows.push({
            key: `a:${a.id}`, icon: `${VI}/search-16.png`,
            data: { kind: 'Alert', channel: a.channelId ? chName(a.channelId) : 'Any channel', start: '', minutes: '', days: '', date: '', mode: '', match: [a.artist, a.title].filter(Boolean).join(' - '), rules: '', tape: a.destination || '', state: 'On', tone: 'ok' }
        }));
        return {
            html: c.listView([
                { t: 'Type', w: 108, key: 'kind', text: (x) => x.kind },
                { t: 'Channel', w: 108, key: 'channel', text: (x) => x.channel },
                { t: 'Start', w: 44, key: 'start', text: (x) => x.start },
                { t: 'Minutes', w: 52, key: 'minutes', text: (x) => x.minutes, value: (x) => Number(x.minutes) || 0 },
                { t: 'Days', w: 100, key: 'days', text: (x) => x.days },
                { t: 'Date', w: 72, key: 'date', text: (x) => x.date },
                { t: 'Mode', w: 46, key: 'mode', text: (x) => x.mode },
                { t: 'Matches', w: 140, key: 'match', text: (x) => x.match },
                { t: 'Rules', w: 170, key: 'rules', text: (x) => x.rules },
                { t: 'Tape', w: 84, key: 'tape', text: (x) => x.tape },
                { t: 'State', w: 48, key: 'state', text: (x) => x.state, html: (x) => stateCell(c, x.tone, x.state) }
            ], rows, { sortId: 'lz-schedules', fit: true, empty: 'There are no timers, search terms or alerts. Use New Timer or New Search Term.' }),
            list: true
        };
    }

    const dialogs = () => root.vistaDialogTemplate || null;
    const keep = (x) => { const o = Object.assign({}, x); delete o.tmp; return o; };

    /** The whole list goes in, as the radio app saves it; the answer is what the server kept. */
    async function saveTimers(list) {
        const r = await send('xmradio_timers_set', { timers: list.map(keep) });
        if (state.deck && Array.isArray(r.timers)) state.deck.timers = r.timers;
        repaint();
        return r.timers || [];
    }

    async function saveTerms(list) {
        const r = await send('xmradio_terms_set', { terms: list.map(keep) });
        if (state.deck && Array.isArray(r.terms)) state.deck.terms = r.terms;
        repaint();
        return r.terms || [];
    }

    const dayButtons = (x0, y) => DAYS.map((d, i) => [401 + i, 'B', x0 + i * 25, y, 23, 14, DAYBTN, d.slice(0, 2), 0]);

    function timerDialog(c, t) {
        const V = dialogs();
        if (!V) throw new Error('The dialog could not be shown.');
        const chans = lineupList();
        if (!chans.length) throw new Error('The channel list has not come in yet. Try again in a moment.');
        const cur = t || { channelId: chans[0].value, start: '08:00', minutes: 60, days: [1, 2, 3, 4, 5], date: null, mode: null, destination: null, notify: false };
        V.openDialog({
            id: 'lizumiTimerDialog', owner: c.modal, title: t ? 'Timer Properties' : 'New Timer',
            tpl: { t: 'Timer', w: 256, h: 182, f: ['Segoe UI', 9], s: DLG_STYLE, c: [
                [-1, 'S', 7, 9, 52, 8, SS, '&Channel:', 0],
                [301, 'C', 62, 7, 187, 120, COMBO, '', 0],
                [-1, 'S', 7, 27, 52, 8, SS, '&Start at:', 0],
                [302, 'E', 62, 25, 40, 12, EDIT, '', 0],
                [-1, 'S', 106, 27, 100, 8, SS, '(24-hour, hh:mm)', 0],
                [-1, 'S', 7, 45, 52, 8, SS, '&Length:', 0],
                [303, 'C', 62, 43, 80, 120, COMBO, '', 0],
                [-1, 'S', 7, 62, 52, 8, SS, 'Repeat on:', 0],
                ...dayButtons(62, 60),
                [-1, 'S', 7, 82, 52, 8, SS, 'Or &once on:', 0],
                [304, 'E', 62, 80, 60, 12, EDIT, '', 0],
                [-1, 'S', 126, 82, 123, 8, SS, '(yyyy-mm-dd; no days pressed)', 0],
                [-1, 'S', 7, 100, 52, 8, SS, 'S&plit:', 0],
                [305, 'C', 62, 98, 120, 120, COMBO, '', 0],
                [-1, 'S', 7, 118, 52, 8, SS, '&Tape:', 0],
                [306, 'E', 62, 116, 120, 12, EDIT, '', 0],
                [-1, 'S', 186, 118, 66, 8, SS, '(blank: the deck\'s)', 0],
                [307, 'B', 62, 134, 120, 10, CHECK, '&Notify', 0],
                [320, 'S', 7, 150, 242, 10, SS, '', 0],
                [1, 'B', 143, 163, 50, 14, DEFPUSH, 'OK', 0],
                [2, 'B', 199, 163, 50, 14, PUSH, 'Cancel', 0]
            ] },
            init: (ctx) => {
                ctx.options(301, chans, cur.channelId);
                ctx.set(302, cur.start || '08:00');
                const lens = LENGTHS.map(([v, x]) => ({ value: String(v), text: x }));
                if (!LENGTHS.some(([v]) => v === Number(cur.minutes))) lens.push({ value: String(cur.minutes), text: `${cur.minutes} minutes` });
                ctx.options(303, lens, String(cur.minutes || 60));
                DAYS.forEach((d, i) => ctx.set(401 + i, !cur.date && (cur.days || []).includes(i)));
                ctx.set(304, cur.date || '');
                ctx.options(305, [{ value: '', text: "As the deck's switch" }, { value: 'song', text: 'Each song' }, { value: 'long', text: 'One continuous file' }], cur.mode || '');
                ctx.set(306, cur.destination || '');
                ctx.set(307, !!cur.notify);
            },
            ok: async (ctx) => {
                const start = String(ctx.get(302) || '').trim();
                const m = /^(\d{1,2}):(\d{2})$/.exec(start);
                if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) { ctx.text(320, 'Start at: type the time as hh:mm (24-hour).'); return false; }
                const days = DAYS.map((d, i) => (ctx.get(401 + i) ? i : -1)).filter((i) => i >= 0);
                const date = String(ctx.get(304) || '').trim();
                if (!days.length && !/^\d{4}-\d{2}-\d{2}$/.test(date)) { ctx.text(320, 'Press at least one day, or type the date as yyyy-mm-dd.'); return false; }
                const next = Object.assign({}, t || {}, {
                    channelId: String(ctx.get(301)), start: `${pad2(Number(m[1]))}:${m[2]}`, minutes: Number(ctx.get(303)) || 60,
                    days, date: days.length ? null : date, mode: String(ctx.get(305) || '') || null,
                    destination: String(ctx.get(306) || '').trim() || null, notify: !!ctx.get(307), off: t ? !!t.off : false
                });
                const list = deckList('timers').map((x) => Object.assign({}, x));
                const i = t ? list.findIndex((x) => x.id === t.id) : -1;
                if (i >= 0) list[i] = next; else list.push(next);
                try { await saveTimers(list); } catch (err) { ctx.text(320, (err && err.message) || 'The timer was not saved.'); return false; }
                return true;
            }
        });
    }

    function termDialog(c, t) {
        const V = dialogs();
        if (!V) throw new Error('The dialog could not be shown.');
        const cur = t || { text: '', channelId: null, days: [], minDuration: 0 };
        const row = (y, id, label, ex) => [[-1, 'S', 7, y + 2, 58, 8, SS, label, 0], [id, 'E', 66, y, ex ? 150 : 226, 12, EDIT, '', 0]].concat(ex ? [[ex, 'B', 222, y + 1, 70, 10, CHECK, 'E&xact', 0]] : []);
        V.openDialog({
            id: 'lizumiTermDialog', owner: c.modal, title: t ? 'Search Term Properties' : 'New Search Term',
            tpl: { t: 'Search Term', w: 300, h: 248, f: ['Segoe UI', 9], s: DLG_STYLE, c: [
                [-1, 'S', 7, 9, 58, 8, SS, '&Channel:', 0],
                [301, 'C', 66, 7, 226, 120, COMBO, '', 0],
                ...row(25, 302, '&Words:'),
                ...row(43, 303, '&Artist:', 313),
                ...row(61, 304, 'Ti&tle:', 314),
                ...row(79, 305, '&Show:', 315),
                [-1, 'S', 7, 99, 58, 8, SS, 'Only on:', 0],
                ...dayButtons(66, 97),
                [-1, 'S', 7, 119, 58, 8, SS, 'Between hours:', 0],
                [306, 'E', 66, 117, 24, 12, EDIT, '', 0],
                [-1, 'S', 94, 119, 14, 8, SS, 'and', 0],
                [307, 'E', 112, 117, 24, 12, EDIT, '', 0],
                [-1, 'S', 140, 119, 152, 8, SS, '(0-23, from the cut\'s start; blank: any time)', 0],
                [-1, 'S', 7, 137, 58, 8, SS, 'Longer than:', 0],
                [308, 'E', 66, 135, 30, 12, EDIT, '', 0],
                [-1, 'S', 100, 137, 190, 8, SS, 'minutes (0: any length)', 0],
                [309, 'B', 66, 153, 226, 10, CHECK, 'Also match a show\'s &episodes', 0],
                [310, 'B', 66, 165, 226, 10, CHECK, 'Only when caught at the start of the cut (within a minute)', 0],
                [311, 'B', 66, 177, 226, 10, CHECK, '&Notify', 0],
                [-1, 'S', 7, 195, 58, 8, SS, 'Ta&pe:', 0],
                [312, 'E', 66, 193, 120, 12, EDIT, '', 0],
                [-1, 'S', 190, 195, 102, 8, SS, '(blank: the deck\'s)', 0],
                [320, 'S', 7, 212, 285, 10, SS, '', 0],
                [1, 'B', 186, 228, 50, 14, DEFPUSH, 'OK', 0],
                [2, 'B', 242, 228, 50, 14, PUSH, 'Cancel', 0]
            ] },
            init: (ctx) => {
                ctx.options(301, [{ value: '', text: 'Any channel' }].concat(lineupList()), cur.channelId || '');
                ctx.set(302, cur.text || '');
                ctx.set(303, cur.artist || ''); ctx.set(313, !!cur.artistExact);
                ctx.set(304, cur.title || ''); ctx.set(314, !!cur.titleExact);
                ctx.set(305, cur.show || ''); ctx.set(315, !!cur.showExact);
                DAYS.forEach((d, i) => ctx.set(401 + i, (cur.days || []).includes(i)));
                ctx.set(306, Number.isInteger(cur.afterHour) ? String(cur.afterHour) : '');
                ctx.set(307, Number.isInteger(cur.beforeHour) ? String(cur.beforeHour) : '');
                ctx.set(308, cur.minDuration ? String(Math.round(cur.minDuration / 6) / 10) : '');
                ctx.set(309, !!cur.allowShows); ctx.set(310, !!cur.fastTrigger); ctx.set(311, !!cur.notify);
                ctx.set(312, cur.destination || '');
            },
            ok: async (ctx) => {
                const hour = (id) => {
                    const v = String(ctx.get(id) || '').trim();
                    if (!v) return { ok: true, v: null };
                    const n = Number(v);
                    return Number.isInteger(n) && n >= 0 && n <= 23 ? { ok: true, v: n } : { ok: false };
                };
                const after = hour(306);
                const before = hour(307);
                if (!after.ok || !before.ok) { ctx.text(320, 'Between hours: type whole hours from 0 to 23, or leave them blank.'); return false; }
                const mins = String(ctx.get(308) || '').trim();
                const minutes = mins ? Number(mins) : 0;
                if (!Number.isFinite(minutes) || minutes < 0 || minutes > 1440) { ctx.text(320, 'Longer than: type the minutes, or 0 for any length.'); return false; }
                const f = (id) => String(ctx.get(id) || '').trim();
                if (!f(302) && !f(303) && !f(304) && !f(305)) { ctx.text(320, 'Type what to look for: words, an artist, a title or a show.'); return false; }
                const next = Object.assign({}, t || {}, {
                    text: f(302), channelId: String(ctx.get(301) || '') || null,
                    artist: f(303), artistExact: !!ctx.get(313), title: f(304), titleExact: !!ctx.get(314), show: f(305), showExact: !!ctx.get(315),
                    days: DAYS.map((d, i) => (ctx.get(401 + i) ? i : -1)).filter((i) => i >= 0),
                    afterHour: after.v, beforeHour: before.v, minDuration: Math.round(minutes * 60),
                    allowShows: !!ctx.get(309), fastTrigger: !!ctx.get(310), notify: !!ctx.get(311), destination: f(312) || null
                });
                const list = deckList('terms').map((x) => Object.assign({}, x));
                const i = t ? list.findIndex((x) => x.id === t.id) : -1;
                if (i >= 0) list[i] = next; else list.push(next);
                try { await saveTerms(list); } catch (err) { ctx.text(320, (err && err.message) || 'The search term was not saved.'); return false; }
                return true;
            }
        });
    }

    /** An alert is set from the radio; here it only gets a destination tape (the same alert again moves it). */
    function alertDialog(c, a) {
        const V = dialogs();
        if (!V) throw new Error('The dialog could not be shown.');
        V.openDialog({
            id: 'lizumiAlertDialog', owner: c.modal, title: 'Alert Properties',
            tpl: { t: 'Alert', w: 250, h: 100, f: ['Segoe UI', 9], s: DLG_STYLE, c: [
                [-1, 'S', 7, 9, 52, 8, SS, 'Alert for:', 0],
                [301, 'S', 62, 9, 187, 8, SS, '', 0],
                [-1, 'S', 7, 27, 52, 8, SS, 'Channel:', 0],
                [302, 'S', 62, 27, 187, 8, SS, '', 0],
                [-1, 'S', 7, 47, 52, 8, SS, '&Tape:', 0],
                [303, 'E', 62, 45, 120, 12, EDIT, '', 0],
                [-1, 'S', 186, 47, 62, 8, SS, '(blank: the deck\'s)', 0],
                [320, 'S', 7, 63, 242, 10, SS, '', 0],
                [1, 'B', 139, 79, 50, 14, DEFPUSH, 'OK', 0],
                [2, 'B', 193, 79, 50, 14, PUSH, 'Cancel', 0]
            ] },
            init: (ctx) => {
                ctx.text(301, [a.artist, a.title].filter(Boolean).join(' - '));
                ctx.text(302, a.channelId ? chName(a.channelId) : 'Any channel');
                ctx.set(303, a.destination || '');
            },
            ok: async (ctx) => {
                try {
                    const r = await send('xmradio_alert_add', { kind: a.kind, artist: a.artist, title: a.title, channelId: a.channelId, destination: String(ctx.get(303) || '').trim() });
                    if (state.deck && Array.isArray(r.alerts)) state.deck.alerts = r.alerts;
                    repaint();
                } catch (err) { ctx.text(320, (err && err.message) || 'The alert was not saved.'); return false; }
                return true;
            }
        });
    }

    /** What a Schedules row key names: { type: 't' | 's' | 'a', item }. */
    function itemOf(key) {
        const m = /^([tsa]):(.+)$/.exec(String(key || ''));
        if (!m) return null;
        const item = deckList({ t: 'timers', s: 'terms', a: 'alerts' }[m[1]]).find((x) => x.id === m[2]);
        return item ? { type: m[1], item } : null;
    }

    const TYPE_NAME = { t: 'Timer', s: 'Search term', a: 'Alert' };

    function openProps(c, key) {
        const x = itemOf(key);
        if (!x) return;
        if (x.type === 't') timerDialog(c, x.item);
        else if (x.type === 's') termDialog(c, x.item);
        else alertDialog(c, x.item);
    }

    async function deleteItem(c, key) {
        const x = itemOf(key);
        if (!x) return;
        const ok = await c.box(`<p>Are you sure you want to delete this ${TYPE_NAME[x.type].toLowerCase()}?</p>`,
            [{ text: 'Delete', value: true, className: 'btn-standard primary' }, { text: 'Cancel', value: false, className: 'btn-standard' }], { icon: 'question' });
        if (ok !== true) return;
        if (x.type === 't') await saveTimers(deckList('timers').filter((i) => i.id !== x.item.id));
        else if (x.type === 's') await saveTerms(deckList('terms').filter((i) => i.id !== x.item.id));
        else {
            const r = await send('xmradio_alert_remove', { id: x.item.id });
            if (state.deck && Array.isArray(r.alerts)) state.deck.alerts = r.alerts;
        }
        c.sel = null;
        c.note(`${TYPE_NAME[x.type]} deleted.`);
        repaint();
    }

    function scheduleCommands(n) {
        if (n.id !== 'schedules') return [];
        return [{ text: 'New Timer...', action: 'sch-new-timer' }, { text: 'New Search Term...', action: 'sch-new-term' }];
    }

    function scheduleSelCommands(n, key) {
        if (n.id !== 'schedules') return null;
        const x = itemOf(key);
        if (!x) return null;
        const items = [{ text: 'Properties...', action: 'sch-props' }];
        if (x.type === 't') items.push({ text: x.item.off ? 'Turn On' : 'Turn Off', action: 'sch-toggle' });
        items.push({ separator: true }, { text: 'Delete', action: 'sch-delete' });
        return { title: TYPE_NAME[x.type], items };
    }

    async function scheduleAction(a, c) {
        switch (a) {
            case 'sch-new-timer': await loadLineup(); timerDialog(c, null); return true;
            case 'sch-new-term': await loadLineup(); termDialog(c, null); return true;
            case 'sch-props': openProps(c, c.sel); return true;
            case 'sch-delete': await deleteItem(c, c.sel); return true;
            case 'sch-toggle': {
                const x = itemOf(c.sel);
                if (x && x.type === 't') await saveTimers(deckList('timers').map((t) => (t.id === x.item.id ? Object.assign({}, t, { off: !t.off }) : t)));
                return true;
            }
            default: return false;
        }
    }

    // ---- Recordings: held recordings (segments on disk) and the tape -----------------------------------------

    const HSTATE = { recording: 'Recording', stopped: 'Stopped', assembling: 'Assembling', assembled: 'Assembled', failed: 'Failed' };
    const heldOf = (key) => { const m = /^h:(.+)$/.exec(String(key || '')); return m ? (state.held || []).find((x) => x.rid === m[1]) || null : null; };

    /** The held list is re-read when the deck's held summary moves or a recording ends (a push), never on a timer. */
    function heldKey() {
        const d = state.deck || {};
        const h = d.held || {};
        return `${h.n || 0}/${h.assembling || 0}/${h.failed || 0}/${(d.recordings || []).length}`;
    }

    async function loadHeld(c, force) {
        if (state.heldLoading || !state.deck) return;
        const key = heldKey();
        if (!force && state.heldFor === key) return;
        state.heldLoading = true;
        try {
            const r = await send('xmradio_rec_held', {});
            state.held = Array.isArray(r.held) ? r.held : [];
            state.heldFor = key;
        } catch (_) {
            if (!state.held) state.held = [];
            state.heldFor = key;
        }
        state.heldLoading = false;
        if (active(c)) c.refresh();
        else repaint();
    }

    /** The cuts a held recording was (or will be) made of: its own, else its live recording's. */
    function heldSplits(c, h) {
        const live = recOf(h.rid);
        const cuts = Array.isArray(h.cuts) ? h.cuts : (live && Array.isArray(live.cuts) ? live.cuts : []);
        const list = cuts.map((x) => ({ at: x.at, ad: !!x.ad, done: !!x.done, show: x.s || '', text: splitLine(x) }));
        const made = (h.files || []).length;
        if (!list.length) return { html: '', count: made };
        const files = made ? `${made} file${made === 1 ? '' : 's'} made` : `will make ${list.length} file${list.length === 1 ? '' : 's'}`;
        return { html: splitsSection(c, list, `Splits - ${files}`), count: made || list.length };
    }

    function recordingsPage(c) {
        const d = state.deck;
        if (d) { void loadTracks(c); void loadHeld(c, false); }
        const held = state.held || [];
        const hrows = held.map((h) => {
            const sp = heldSplits(c, h);
            return {
                key: `h:${h.rid}`, icon: `${VI}/${h.state === 'failed' ? 'warning' : 'volume-high'}-16.png`,
                data: {
                    channel: chName(h.channelId), kind: KIND[h.kind] || 'Channel', radio: slotName((h.slot || 1) - 1),
                    state: HSTATE[h.state] || h.state, bad: h.state === 'failed', tone: h.state === 'failed' ? 'bad' : h.state === 'assembling' ? 'warn' : h.state === 'assembled' ? 'ok' : 'info',
                    started: clock(h.since), startedAt: h.since || 0, ended: h.endedAt ? clock(h.endedAt) : '-', endedAt: h.endedAt || 0,
                    segs: Number(h.segs) || 0, gaps: gapCount(h), gapS: Number(h.gapSeconds) || 0,
                    files: h.files && h.files.length ? String(h.files.length) : (sp.count ? `~${sp.count}` : ''), filesN: (h.files || []).length || sp.count || 0,
                    keep: h.keepUntil ? clock(h.keepUntil) : '-', keepAt: h.keepUntil || 0, error: h.error || ''
                }
            };
        });
        const heldList = c.listView([
            { t: 'Channel', w: 130, key: 'channel', text: (x) => x.channel },
            { t: 'Kind', w: 74, key: 'kind', text: (x) => x.kind },
            { t: 'Virtual Radio', w: 112, key: 'radio', text: (x) => x.radio },
            { t: 'State', w: 96, key: 'state', text: (x) => (x.error ? `${x.state}: ${x.error}` : x.state), html: (x) => stateCell(c, x.tone, x.error ? `${x.state}: ${x.error}` : x.state) },
            { t: 'Started', w: 96, key: 'started', text: (x) => x.started, value: (x) => x.startedAt },
            { t: 'Ended', w: 96, key: 'ended', text: (x) => x.ended, value: (x) => x.endedAt },
            { t: 'Segs', w: 64, key: 'segs', text: (x) => String(x.segs), value: (x) => x.segs },
            { t: 'Gaps', w: 76, key: 'gaps', text: (x) => (x.gaps > 0 ? `${x.gaps} (${x.gapS}s)` : 'None'), value: (x) => x.gaps },
            { t: 'Files', w: 64, key: 'files', text: (x) => x.files, value: (x) => x.filesN },
            { t: 'Keep until', w: 104, key: 'keep', text: (x) => x.keep, value: (x) => x.keepAt }
        ], hrows, { sortId: 'lz-held', fit: true, empty: state.held ? 'No recording holds segments.' : 'Reading the held recordings...' });
        const sel = heldOf(c.sel);
        const splits = sel ? heldSplits(c, sel).html : '';
        const hint = !sel && held.length ? '<p class="mmc-note">Select a held recording to see the splits it will be cut into before it is assembled.</p>' : '';
        // a track's time comes in seconds from the file store (read as ms it showed January 1970)
        const trackMs = (v) => { const n = Number(v) || 0; return n && n < 1e12 ? n * 1000 : n; };
        const rows = (state.tracks || []).map((t) => {
            const m = trackMeta(t);
            return {
                key: `r:${t.id}`, icon: `${VI}/volume-high-16.png`,
                data: { name: t.name, title: m.title, artist: m.artist, show: m.show, dur: mss(t.dur), size: sizeText(t.size || 0), sizeB: t.size || 0, at: clock(trackMs(t.at)), atMs: trackMs(t.at) }
            };
        });
        const tape = c.listView([
            { t: 'Title', w: 250, key: 'title', text: (x) => x.title, html: (x) => `<i title="${esc(x.name)}">${esc(x.title)}</i>` },
            { t: 'Artist', w: 160, key: 'artist', text: (x) => x.artist },
            { t: 'Show', w: 120, key: 'show', text: (x) => x.show },
            { t: 'Length', w: 66, key: 'dur', text: (x) => x.dur },
            { t: 'Size', w: 84, key: 'size', text: (x) => x.size, value: (x) => x.sizeB },
            { t: 'Recorded', w: 120, key: 'at', text: (x) => x.at, value: (x) => x.atMs }
        ], rows, { sortId: 'lz-recordings', fit: true, empty: state.tracks ? 'This tape has no recordings.' : 'Reading the tape...' });
        return { html: c.page('Recordings', '', [{ id: 'lz-held', title: `Held recordings (${held.length})`, body: heldList + splits + hint }, { id: 'lz-tape', title: `On the tape (${(state.tracks || []).length})`, body: tape }]) };
    }

    /** A tape track's merged metadata (title / artist / show), else read out of its name. */
    function trackMeta(t) {
        if (t.title || t.artist) return { title: t.title || t.name || '', artist: t.artist || '', show: t.show || '' };
        const name = String(t.name || '');
        const m = /^\d{4}-\d{2}-\d{2} \d{4} (.+)\.(?:m4a|aac|mp4)$/i.exec(name);
        const rest = m ? m[1] : name.replace(/\.(m4a|aac|mp4)$/i, '');
        const i = rest.lastIndexOf(' - ');
        if (i > 0) return { title: rest.slice(i + 3), artist: rest.slice(0, i), show: '' };
        return { title: rest, artist: '', show: '' };
    }

    function heldSelCommands(n, key) {
        if (n.id !== 'recordings') return null;
        const h = heldOf(key);
        if (!h) return null;
        const items = [];
        if (h.state === 'stopped' || h.state === 'failed') items.push({ text: 'Assemble', action: 'held-assemble' });
        if (h.state === 'assembled') items.push({ text: 'Re-assemble', action: 'held-assemble' });
        if (h.state === 'stopped' || h.state === 'failed' || h.state === 'assembled') {
            if (items.length) items.push({ separator: true });
            items.push({ text: 'Delete', action: 'held-delete' });
        }
        return items.length ? { title: 'Held recording', items } : null;
    }

    async function heldFail(c, err) {
        await c.box(`<p>${esc((err && err.message) || 'The server did not answer.')}</p>`, [{ text: 'OK', value: true, className: 'btn-standard primary' }], { icon: 'error' });
    }

    async function heldAction(a, c) {
        const h = heldOf(c.sel);
        if (!h) return true;
        try {
            if (a === 'held-assemble') {
                c.note(`Assembling ${chName(h.channelId) || 'the recording'}...`);
                await send('xmradio_rec_assemble', { rid: h.rid });
                c.note('Assembled.');
            } else {
                const ok = await c.box(`<p>Are you sure you want to delete the segments of this recording? The files it already made on the tape stay.</p>`,
                    [{ text: 'Delete', value: true, className: 'btn-standard primary' }, { text: 'Cancel', value: false, className: 'btn-standard' }], { icon: 'question' });
                if (ok !== true) return true;
                await send('xmradio_rec_held_delete', { rid: h.rid });
                c.sel = null;
                c.note('Held recording deleted.');
            }
        } catch (err) {
            c.note('');
            await heldFail(c, err);
        }
        await loadHeld(c, true);
        return true;
    }

    function accountsPage(c) {
        const a = state.account || {};
        const max = maxSlots();
        // one SiriusXM login per virtual radio (xmradio slots, #1252 S2); before the server sent the list, slot 1 only
        const list = (state.slots && Array.isArray(state.slots.list)) ? state.slots.list : null;
        const rows = [];
        for (let i = 0; i < max; i++) {
            const s = list ? list.find((x) => x.slot === i + 1) : null;
            const own = i === 0;
            const data = s
                ? {
                    name: s.name || slotName(i), handle: s.handle || '',
                    state: s.signedIn ? 'Signed in' : s.handle ? 'Signed out' : 'Not set up',
                    tone: s.signedIn ? 'ok' : (s.lastError ? 'bad' : 'idle'),
                    since: s.since ? clock(s.since) : '-', token: s.tokenExp ? clock(s.tokenExp) : '-',
                    entitlement: s.entitlementHash ? `${s.entitlementHash}${s.refused ? ` (${s.refused} refused)` : ''}` : '-',
                    error: s.lastError ? `${s.lastErrorAt ? `${clock(s.lastErrorAt)} ` : ''}${s.lastError}` : ''
                }
                : {
                    name: slotName(i),
                    handle: own ? (a.handle || '') : '',
                    state: own ? (a.signedIn ? 'Signed in' : a.expired ? 'Expired' : 'Signed out') : 'Not set up',
                    tone: own && a.signedIn ? 'ok' : (own && a.expired ? 'warn' : 'idle'),
                    since: own && a.since ? clock(a.since) : '-', token: '-', entitlement: '-', error: ''
                };
            rows.push({ key: `acc:${i + 1}`, icon: `${VI}/account-manager-16.png`, data });
        }
        return {
            html: c.listView([
                { t: 'Virtual Radio', w: 172, key: 'name', text: (x) => x.name },
                { t: 'Handle', w: 120, key: 'handle', text: (x) => x.handle },
                { t: 'State', w: 96, key: 'state', text: (x) => x.state, html: (x) => stateCell(c, x.tone, x.state) },
                { t: 'Signed in since', w: 112, key: 'since', text: (x) => x.since },
                { t: 'Token expiry', w: 92, key: 'token', text: (x) => x.token },
                { t: 'Entitlement', w: 108, key: 'entitlement', text: (x) => x.entitlement },
                { t: 'Last sign-in failure', w: 180, key: 'error', text: (x) => x.error }
            ], rows, { sortId: 'lz-accounts', fit: true, empty: EMPTY }),
            list: true
        };
    }


    // ---- Diagnostics (read-only) --------------------------------------------------------------------------

    function diagnosticsPage(c) {
        const d = state.deck || {};
        if (d) void loadTracks(c); // the tape count
        const list = (state.slots && Array.isArray(state.slots.list)) ? state.slots.list : [];
        const recsL = recs();
        const link = c.props([
            ['Recorder service', d.offline ? c.state(false, 'Offline: the recorder service is not answering', false) : c.state(true, 'Online')],
            ['Signed-in virtual radios', esc(`${signedIn()} of ${maxSlots()}`)],
            ['Recordings running', esc(String(recsL.length))],
            ['Held recordings', esc(d.held ? `${d.held.n || 0} (${d.held.assembling || 0} assembling, ${d.held.failed || 0} failed)` : '0')]
        ]);
        const arows = list.map((s2) => ({
            key: `da:${s2.slot}`, icon: `${VI}/account-manager-16.png`,
            data: { name: s2.name || slotName((s2.slot || 1) - 1), state: s2.signedIn ? 'Signed in' : s2.handle ? 'Signed out' : 'Not set up', tone: s2.signedIn ? 'ok' : (s2.lastError ? 'bad' : 'idle'), error: s2.lastError ? `${s2.lastErrorAt ? `${clock(s2.lastErrorAt)} ` : ''}${s2.lastError}` : 'None' }
        }));
        const accounts = c.listView([
            { t: 'Virtual Radio', w: 130, key: 'name', text: (x) => x.name },
            { t: 'State', w: 96, key: 'state', text: (x) => x.state, html: (x) => stateCell(c, x.tone, x.state) },
            { t: 'Last sign-in failure', w: 420, key: 'error', text: (x) => x.error }
        ], arows, { sortId: 'lz-diag-acc', fit: true, empty: 'No accounts were reported.' });
        const trouble = troubleList(c);
        const troubleN = recsL.filter((r) => health(r).tone !== 'ok').length;
        const healthHtml = healthProps(c);
        const mrows = (Array.isArray(d.history) ? d.history : []).filter((e) => e.state === 'missed').map((e) => ({
            key: `dm:${e.id}`, icon: `${VI}/warning-16.png`,
            data: { cut: cutText(e) || chName(e.channelId), channel: chName(e.channelId), when: clock(e.endedAt || e.expiresAt), whenAt: e.endedAt || e.expiresAt || 0, reason: e.reason || '' }
        }));
        const missed = c.listView([
            { t: 'Song', w: 240, key: 'cut', text: (x) => x.cut },
            { t: 'Channel', w: 150, key: 'channel', text: (x) => x.channel },
            { t: 'When', w: 120, key: 'when', text: (x) => x.when, value: (x) => x.whenAt },
            { t: 'Why', w: 320, key: 'reason', text: (x) => x.reason }
        ], mrows, { sortId: 'lz-diag-miss', fit: true, empty: 'No queue entry was missed.' });
        return {
            html: c.page('Diagnostics', '', [
                { id: 'lz-diag-ovw', title: 'Overview', body: overviewBlock(c) },
                { id: 'lz-diag-rec', title: `Recordings in trouble (${troubleN})`, body: trouble },
                { id: 'lz-diag-link', title: 'Link', body: link },
                { id: 'lz-diag-acc', title: 'Accounts', body: accounts },
                { id: 'lz-diag-health', title: 'Recording health', body: healthHtml },
                { id: 'lz-diag-miss', title: 'Missed queue entries', body: missed }
            ])
        };
    }

    /** The recordings with trouble, one row each: Vista's warning icon and what is wrong, in plain words. */
    function troubleList(c) {
        const bad = recs().map((r) => ({ r, mk: marker(r) })).filter((x) => x.mk);
        const rows = bad.map((x) => ({
            key: null, icon: `${VI}/warning-16.png`,
            data: { radio: slotName((x.r.slot || 1) - 1), channel: chName(x.r.channelId) || '', problem: x.mk.text }
        }));
        const cols = [
            { t: 'Virtual Radio', w: 150, key: 'radio', text: (x) => x.radio },
            { t: 'Channel', w: 140, key: 'channel', text: (x) => x.channel },
            { t: 'Problem', w: 520, key: 'problem', text: (x) => x.problem }
        ];
        return c.listView(cols, rows, { sortId: 'lz-diag-trouble', fit: true, empty: 'Every recording is writing audio normally.' });
    }

    /** The numbers behind each recording, as property lists (a figure that means a defect carries Vista's icon). */
    function healthProps(c) {
        const recsL = recs();
        if (!recsL.length) return '<p class="mmc-note">No recording is running.</p>';
        return recsL.map((r) => {
            const h = health(r);
            const name = `${slotName((r.slot || 1) - 1)} - ${chName(r.channelId) || 'a channel'}`;
            const props = c.props([
                ['Behind live', h.behind ? c.state(false, durText(h.behindS), true) : esc(durText(h.behindS))],
                ['Segments', esc(`${h.segsW} of ${h.segsE || h.segsW}`)],
                ['Re-fetches', h.refetches >= 20 ? c.state(false, String(h.refetches), true) : esc(String(h.refetches))],
                ['Pauses', esc(String(h.pauses))],
                ['Unreadable segments', h.holes ? c.state(false, String(h.holes), false) : 'None'],
                ['Gaps', h.gaps ? c.state(false, `${h.gaps} (${h.gapS} s)`, true) : 'None']
            ]);
            return `<p class="mmc-note">${esc(name)}</p>${props}`;
        }).join('');
    }

    // ---- Settings -----------------------------------------------------------------------------------------

    const SETTINGS = [
        { key: 'streamsPerAccount', name: 'Streams per account', min: 1, max: 4, def: 1 },
        { key: 'healthyBuffer', name: 'Healthy buffer (segments)', min: 1, max: 20, def: 3 },
        { key: 'behindSeconds', name: 'Behind after (seconds)', min: 30, max: 3600, def: 120 },
        { key: 'refetchRetries', name: 'Re-fetch retries', min: 0, max: 10, def: 3 },
        { key: 'keepSegmentsHours', name: 'Keep raw segments (hours)', min: 0, max: 720, def: 24 }
    ];
    const settingValue = (x) => { const v = state.deck && state.deck.settings ? Number(state.deck.settings[x.key]) : NaN; return Number.isFinite(v) ? v : x.def; };

    function settingsPage(c) {
        const rows = SETTINGS.map((x) => ({ key: `set:${x.key}`, icon: `${VI}/application-16.png`, data: { name: x.name, value: String(settingValue(x)), range: `${x.min} to ${x.max}` } }));
        return {
            html: c.listView([
                { t: 'Setting', w: 240, key: 'name', text: (x) => x.name },
                { t: 'Value', w: 80, key: 'value', text: (x) => x.value, value: (x) => Number(x.value) },
                { t: 'Allowed', w: 120, key: 'range', text: (x) => x.range }
            ], rows, { sortId: 'lz-settings', empty: EMPTY }),
            list: true
        };
    }

    function settingsDialog(c) {
        const V = dialogs();
        if (!V) return;
        const ctl = (i) => 301 + i;
        const controls = [];
        SETTINGS.forEach((x, i) => {
            controls.push([-1, 'S', 7, 11 + i * 20, 130, 8, SS, `${x.name}:`, 0]);
            controls.push([ctl(i), 'E', 140, 9 + i * 20, 44, 12, EDIT, '', 0]);
            controls.push([-1, 'S', 190, 11 + i * 20, 70, 8, SS, `${x.min} to ${x.max}`, 0]);
        });
        controls.push([320, 'S', 7, 112, 253, 10, SS, '', 0], [1, 'B', 154, 128, 50, 14, DEFPUSH, 'OK', 0], [2, 'B', 208, 128, 50, 14, PUSH, 'Cancel', 0]);
        V.openDialog({
            id: 'lizumiSettingsDialog', owner: c.modal, title: 'Lizumi Settings',
            tpl: { t: 'Settings', w: 266, h: 148, f: ['Segoe UI', 9], s: DLG_STYLE, c: controls },
            init: (ctx) => { SETTINGS.forEach((x, i) => ctx.set(ctl(i), String(settingValue(x)))); },
            ok: async (ctx) => {
                const out = {};
                for (let i = 0; i < SETTINGS.length; i++) {
                    const x = SETTINGS[i];
                    const raw = String(ctx.get(ctl(i)) == null ? '' : ctx.get(ctl(i))).trim();
                    const n = Number(raw);
                    if (!/^\d+$/.test(raw) || n < x.min || n > x.max) { ctx.text(320, `${x.name} must be a whole number from ${x.min} to ${x.max}.`); return false; }
                    out[x.key] = n;
                }
                try {
                    const r = await send('xmradio_rec_settings', out);
                    if (state.deck) { if (r.deck) state.deck = r.deck; else state.deck.settings = Object.assign({}, state.deck.settings, r.settings || out); }
                    repaint();
                } catch (err) { ctx.text(320, (err && err.message) || 'The settings were not saved.'); return false; }
                return true;
            }
        });
    }

    // ---- Live: the monitor player ------------------------------------------------------------------------

    let hlsLoading = null;
    /** hls.js, the same light build the radio app loads (loaded once, when a monitor first plays). */
    function loadHls() {
        if (root.Hls) return Promise.resolve(root.Hls);
        if (!hlsLoading) {
            hlsLoading = new Promise((resolve, reject) => {
                const s = root.document.createElement('script');
                s.src = HLS_SRC;
                s.onload = () => (root.Hls ? resolve(root.Hls) : reject(new Error('The player did not load')));
                s.onerror = () => { hlsLoading = null; reject(new Error('The player did not load')); };
                root.document.head.appendChild(s);
            });
        }
        return hlsLoading;
    }

    /** The recording the Live page shows: the one picked while it still records, else the first. */
    function liveRec() {
        return recOf(state.liveRid) || recs()[0] || null;
    }

    /** Stop and destroy the player: hls.destroy(), the audio's source removed, the tick and listeners gone. */
    function stopPlayer() {
        const p = state.player;
        if (!p) return;
        state.player = null;
        p.ctl.abort();
        if (p.timer) root.clearTimeout(p.timer);
        if (p.hls) { try { p.hls.destroy(); } catch (_) { /* gone */ } }
        try { p.audio.pause(); p.audio.removeAttribute('src'); p.audio.load(); } catch (_) { /* nothing loaded */ }
    }

    function runningText(r) {
        return span((Date.now() - (r.since || Date.now())) / 1000);
    }

    /** One tick a second, only while the monitor plays and the page is visible; it writes the running time in place. */
    function tick(p) {
        if (p.timer) root.clearTimeout(p.timer);
        p.timer = 0;
        if (state.player !== p || p.state !== 'playing' || (root.document && root.document.hidden)) return;
        const c = state.console;
        const r = recOf(p.rid);
        if (!r || !active(c) || c.node !== 'live') { stopPlayer(); return; }
        const el = c.modal.querySelector('[data-lz="running"]');
        if (el) el.textContent = runningText(r);
        p.timer = root.setTimeout(() => tick(p), 1000);
    }

    async function startPlayer(r) {
        stopPlayer();
        if (state.console && typeof state.console.note === 'function') state.console.note(''); // a held-back note from the last try goes
        const audio = new root.Audio();
        audio.volume = state.vol / 100;
        audio.muted = state.muted;
        const p = { rid: r.rid, audio, hls: null, state: 'loading', timer: 0, retries: 0, ctl: new root.AbortController() };
        state.player = p;
        const set = (st) => { if (state.player !== p) return; p.state = st; repaint(); tick(p); };
        audio.addEventListener('playing', () => set('playing'), { signal: p.ctl.signal });
        audio.addEventListener('waiting', () => set('loading'), { signal: p.ctl.signal });
        root.document.addEventListener('visibilitychange', () => tick(p), { signal: p.ctl.signal });
        repaint();
        const url = r.url || `/api/xmradio/rec/${encodeURIComponent(r.rid)}/index.m3u8`;
        let Hls = null;
        try { Hls = await loadHls(); } catch (_) { Hls = null; }
        if (state.player !== p) return;
        if (Hls && Hls.isSupported()) {
            const h = new Hls({ liveSyncDurationCount: 3, maxBufferLength: 30, backBufferLength: 600, enableWorker: true });
            p.hls = h;
            h.on(Hls.Events.ERROR, (ev, d) => {
                if (!d || !d.fatal || state.player !== p) return;
                if (d.type === Hls.ErrorTypes.NETWORK_ERROR && (p.retries += 1) <= 3) { h.startLoad(); return; }
                set('error');
            });
            h.loadSource(url);
            h.attachMedia(audio);
        } else if (audio.canPlayType('application/vnd.apple.mpegurl')) {
            audio.src = url;
        } else { set('error'); return; }
        try { await audio.play(); } catch (err) {
            // the browser refused to start sound (no click of the person's own behind it): say so and let Play be pressed
            // again, instead of sitting on "Buffering..." for good (seen Nov 26 2026 with a scripted click)
            if (state.player && state.player.audio === audio) { stopPlayer(); if (state.console && typeof state.console.note === 'function') state.console.note(err && err.name === 'NotAllowedError' ? 'The browser held the sound back. Press Play to listen.' : 'The recording could not be played.'); repaint(); }
        }
    }

    const PSTATE = { loading: 'Buffering...', playing: 'Playing', error: 'The stream is not available' };

    function livePage(c) {
        void loadLineup();
        const list = recs();
        const r = liveRec();
        if (state.player && (!r || state.player.rid !== r.rid)) stopPlayer(); // the recording ended, or another is shown
        const p = state.player;
        const rows = list.map((x, i) => ({ key: `lv:${x.rid}`, icon: IC.rec, data: { name: slotName(i), channel: chName(x.channelId), cut: cutText(x.cut) } }));
        if (r && String(c.sel) !== `lv:${r.rid}`) c.sel = `lv:${r.rid}`;
        const listHtml = c.listView([
            { t: 'Virtual Radio', w: 130, key: 'name', text: (x) => x.name },
            { t: 'Channel', w: 160, key: 'channel', text: (x) => x.channel },
            { t: 'On air', w: 300, key: 'cut', text: (x) => x.cut }
        ], rows, { sortId: 'lz-live', fit: true, empty: 'No virtual radio is recording.' });
        let monitor = '<p class="mmc-note">Pick a recording virtual radio to monitor it.</p>';
        if (r) {
            const i = list.indexOf(r);
            const { mk } = assess(r);
            const warn = mk ? `<p>${c.state(false, mk.text, mk.tone !== 'bad')}</p>` : '';
            monitor = `<div class="mmc-buttons">
                <button type="button" class="btn-standard" data-lz="play">${p ? 'Stop' : 'Play'}</button>
                <button type="button" class="btn-standard" data-lz="mute">${state.muted ? 'Unmute' : 'Mute'}</button>
                <label class="lz-vol">Volume <input type="range" min="0" max="100" step="1" value="${state.vol}" data-lz="vol" aria-label="Volume"></label>
            </div>
            ${c.props([
                ['Monitor', esc(`${slotName(i)} - ${p ? PSTATE[p.state] : 'stopped'}`)],
                ['Channel', esc(chName(r.channelId))],
                ['On air', esc(cutText(r.cut))],
                ['Tape running', `<span data-lz="running">${esc(runningText(r))}</span>`],
                ['Reached back', esc(r.back ? span(r.back) : '0:00')]
            ])}${warn}`;
        }
        return {
            html: c.page('Live', '', [
                { id: 'lz-live-radios', title: 'Recording virtual radios', body: listHtml },
                { id: 'lz-live-monitor', title: 'Monitor', body: monitor }
            ]),
            mount: (pane) => {
                const q = (k) => pane.querySelector(`[data-lz="${k}"]`);
                const play = q('play');
                if (play) play.addEventListener('click', () => {
                    if (state.player) { stopPlayer(); repaint(); return; }
                    const cur = liveRec();
                    if (cur) void startPlayer(cur);
                });
                const mute = q('mute');
                if (mute) mute.addEventListener('click', () => {
                    state.muted = !state.muted;
                    if (state.player) state.player.audio.muted = state.muted;
                    repaint();
                });
                const vol = q('vol');
                if (vol) vol.addEventListener('input', () => {
                    state.vol = Math.max(0, Math.min(100, Number(vol.value) || 0));
                    if (state.player) state.player.audio.volume = state.vol / 100;
                });
            }
        };
    }

    function page(n, c) {
        if (n.id !== 'live') stopPlayer(); // the monitor exists only while its page is shown
        if (n.id === 'root') {
            return {
                html: c.listView([{ t: 'Name', w: 260, key: 'name', text: (x) => x.name }],
                    NODES.map((x) => ({ key: `n:${x.id}`, open: x.id, icon: x.icon, data: { name: x.name } })), { empty: EMPTY }),
                list: true
            };
        }
        if (!state.loaded) return { html: c.listView([{ t: 'Name', w: 300, key: 'name', text: (x) => x.name }], [], { empty: 'Reading XM Radio...' }), list: true };
        if (state.error && !state.deck) return { html: c.listView([{ t: 'Name', w: 300, key: 'name', text: (x) => x.name }], [], { empty: state.error }), list: true };
        switch (n.id) {
            case 'radios': return radiosPage(c);
            case 'queue': return queuePage(c);
            case 'schedules': return schedulesPage(c);
            case 'recordings': return recordingsPage(c);
            case 'accounts': return accountsPage(c);
            case 'live': return livePage(c);
            case 'diagnostics': return diagnosticsPage(c);
            case 'settings': return settingsPage(c);
            default: return '';
        }
    }

    function status(n) {
        const d = state.deck;
        if (!d || n.id === 'root') return '';
        const pool = poolOf();
        const r = pool ? pool.filter((x) => x.streaming > 0).length : recs().length;
        const max = maxSlots();
        const ready = signedIn();
        const q = (d.queue || []).length;
        const trouble = recs().filter((x) => health(x).tone !== 'ok').length;
        if (n.id === 'recordings') return `Tape: ${d.tape}`;
        return `${r} of ${max} virtual radios recording (${ready} signed in), ${q} ${q === 1 ? 'entry' : 'entries'} waiting${trouble ? `, ${trouble} with trouble` : ''}`;
    }

    function def() {
        return {
            id: ID,
            title: TITLE,
            icon16: APP,
            icon32: APP,
            taskbarIcon: APP,
            treeWidth: 170,
            // the card grid and the one-line tables fit the pane (fit lists) without scrolling sideways
            width: 1120,
            height: 640,
            expanded: ['root'],
            about: { version: '1.0', lines: ['Manages the XM Radio recorders, queue, schedules and accounts.'] },
            nodes: () => [{ id: 'root', name: TITLE, icon: APP, children: NODES.map((x) => ({ id: x.id, name: x.name, icon: x.icon })) }],
            page: (n, c) => page(n, c),
            commands: (n) => (n.id === 'settings' ? [{ text: 'Change Settings...', action: 'set-edit' }] : scheduleCommands(n)),
            selCommands: (n, key) => heldSelCommands(n, key) || scheduleSelCommands(n, key),
            action: (a, c) => {
                if (a.startsWith('sch-')) return scheduleAction(a, c);
                if (a.startsWith('held-')) return heldAction(a, c);
                if (a === 'set-edit') { settingsDialog(c); return true; }
                return false;
            },
            rowOpen: (key, n, c) => {
                if (key && key.startsWith('n:')) c.select(key.slice(2), true);
                else if (n && n.id === 'schedules') openProps(c, key);
                else if (n && n.id === 'settings') settingsDialog(c);
            },
            status: (n) => status(n),
            viewMenu: () => [],
            onOpen: (c) => {
                state.console = c;
                void loadView();
                void want(true);
            },
            onSelectRow: (key, n, c) => {
                if (!n) return;
                if (n.id === 'live') {
                    if (key && key.startsWith('lv:')) {
                        const rid = key.slice(3);
                        if (rid !== state.liveRid) { state.liveRid = rid; stopPlayer(); }
                    }
                    c.refresh();
                } else if (n.id === 'radios') {
                    // the selected virtual radio's detail (its properties and splits) shows under the list
                    c.render();
                } else if (n.id === 'recordings') {
                    // the selected held recording's splits show under the list
                    c.render();
                }
            },
            onClose: () => {
                stopPlayer();
                state.console = null;
                state.segWatch.clear();
                void want(false);
            }
        };
    }

    async function openLizumi(node) {
        if (root.featureLoader) await root.featureLoader.loadFeature('mmc_snapins');
        if (!root.mmcConsole) return null;
        return root.mmcConsole.open(def(), node ? { node } : {});
    }

    root.openLizumi = openLizumi;
    root.mmcLizumi = { open: openLizumi, def, _state: state };
})(typeof window !== 'undefined' ? window : globalThis);
