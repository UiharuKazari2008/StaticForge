/**
 * Lizumi (Yozora #1252, slice S4): the MMC console for XM Radio recording management, opened from the Start menu
 * as its own window. Pages (Schedules is managed here, the rest read-only):
 *
 *   Lizumi
 *     Virtual Radios    the four recorder slots (Lizumi-Recorder-1..4): each holds one recording or is on standby,
 *                       with the queue depth beside it
 *     Queue             the common queue in due order
 *     Schedules         timers, search terms and alerts as one list
 *     Recordings        held recordings (segments on disk: Assemble, Re-assemble, Delete), then the current tape's tracks
 *     Accounts          the SiriusXM login
 *     Live              a monitor player for one recording slot (its growing HLS playlist), Mute and volume, and the
 *                       tape's own progress; the player exists only while this page is shown
 *     Diagnostics       link state, accounts, per recording gaps / re-fetches / pauses, missed queue entries (read-only)
 *     Settings          streams per account, healthy buffer, behind seconds, re-fetch retries, keep segments hours
 *
 * Data: the admin packet xmradio_mmc_view ({ account, deck, slots }) once, then the statusHub feed `xmradio_mmc`
 * (pushType xmradio_mmc_status, items.deck / items.account) while the window is open; nothing is polled. Channel names
 * come from xmradio_lineup.
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

    const state = {
        console: null, account: null, deck: null, slots: { max: 4 }, loaded: false, error: '',
        channels: new Map(), lineup: [], lineupAsked: false,
        tracks: null, tracksFor: '', tracksLoading: false,
        held: null, heldFor: '', heldLoading: false,
        feedOn: false,
        liveRid: '', vol: 80, muted: false, player: null
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

    // ---- pages ------------------------------------------------------------------------------------------

    const EMPTY = 'There are no items to show in this view.';

    const KIND = { song: 'Song', cut: 'Song on air', manual: 'Channel', channel: 'Channel', timer: 'Timer', alert: 'Alert', term: 'Search term' };

    /** "2 (14s)" for holes in the audio; "None" when there are none. */
    const gapText = (n, sec) => (n > 0 ? `${n} (${sec}s)` : 'None');
    /** Holes show with the kit's warning state; none is plain text. */
    function gapCell(c, idle, n, sec) {
        if (idle) return '<i></i>';
        return n > 0 ? c.state(false, gapText(n, sec), true) : `<i>${gapText(n, sec)}</i>`;
    }

    function radiosPage(c) {
        const d = state.deck || {};
        const recs = Array.isArray(d.recordings) ? d.recordings : [];
        const pool = Array.isArray(d.pool) && d.pool.length ? d.pool : null;
        const max = pool ? pool.length : ((state.slots && state.slots.max) || 4);
        const now = Date.now();
        const rows = [];
        const stateWord = (r) => (r.state === 'buffering' ? 'Buffering' : r.state === 'paused-refilling' ? 'Paused - refilling' : r.state === 'behind' ? `Behind ${Math.round(r.behindS || 0)}s` : 'Recording');
        const segText = (r) => {
            const w = Number(r.segsWritten) || 0;
            const e = Number(r.segsExpected) || 0;
            if (!e && !w) return '-';
            return `${w} / ${e} (${e ? Math.min(100, Math.round((w / e) * 100)) : 100}%)${r.held != null ? `, ${r.held} held` : ''}`;
        };
        // each recording on its own virtual radio (its slot, #1252 S3); before the server sent slots, in list order
        const bySlot = new Map();
        recs.forEach((x, i) => { const n = x.slot || (pool ? 1 : i + 1); if (!bySlot.has(n)) bySlot.set(n, x); });
        for (let i = 0; i < max; i++) {
            const r = bySlot.get(i + 1) || null;
            const ready = pool ? pool[i].ready : true;
            rows.push({
                key: `slot:${i + 1}`,
                // standby is idle, not a fault: the quiet speaker, never the muted one's red cross
                icon: `${VI}/volume-${r ? 'high' : 'low'}-16.png`,
                data: r
                    ? { name: `Lizumi-Recorder-${i + 1}`, state: stateWord(r), warn: r.state === 'behind', channel: chName(r.channelId), cut: cutText(r.cut), kind: KIND[r.kind] || 'Channel', running: span((now - (r.since || now)) / 1000), runningS: now - (r.since || now), back: r.back ? span(r.back) : '0:00', buffer: r.bufferSegs != null ? String(r.bufferSegs) : '-', segments: segText(r), gaps: Number(r.gaps && r.gaps.length != null ? r.gaps.length : r.gaps) || 0, gapS: Number(r.gapSeconds) || 0 }
                    : { name: `Lizumi-Recorder-${i + 1}`, state: ready ? 'Standby' : 'No account', channel: '', cut: '', kind: '', running: '', runningS: 0, back: '', buffer: '-', segments: '-', gaps: 0, gapS: 0, idle: true }
            });
        }
        return {
            html: c.listView([
                { t: 'Virtual Radio', w: 130, key: 'name', text: (x) => x.name },
                { t: 'State', w: 120, key: 'state', text: (x) => x.state, html: (x) => (x.warn ? c.state(false, x.state, true) : `<i>${esc(x.state)}</i>`) },
                // the health columns next to the state, so they are seen without scrolling
                { t: 'Buffer', w: 56, key: 'buffer', text: (x) => x.buffer },
                { t: 'Segments', w: 150, key: 'segments', text: (x) => x.segments },
                { t: 'Gaps', w: 80, key: 'gaps', text: (x) => (x.idle ? '' : gapText(x.gaps, x.gapS)), html: (x) => gapCell(c, x.idle, x.gaps, x.gapS), value: (x) => x.gaps },
                { t: 'Channel', w: 130, key: 'channel', text: (x) => x.channel },
                { t: 'On air', w: 180, key: 'cut', text: (x) => x.cut },
                { t: 'Kind', w: 84, key: 'kind', text: (x) => x.kind },
                { t: 'Running', w: 70, key: 'running', text: (x) => x.running, value: (x) => x.runningS },
                { t: 'Reached back', w: 90, key: 'back', text: (x) => x.back }
            ], rows, { sortId: 'lz-radios', empty: EMPTY }),
            list: true
        };
    }

    const QSTATE = { queued: 'Queued', running: 'Running', missed: 'Missed', done: 'Done', cancelled: 'Cancelled' };
    const QKIND = { song: 'Song', cut: 'Song on air', channel: 'Channel', timer: 'Timer', alert: 'Alert', term: 'Search term' };

    function queuePage(c) {
        const d = state.deck || {};
        // waiting in due order, then what runs, then the last ones that ended (missed ones say why)
        const list = [].concat(Array.isArray(d.queue) ? d.queue : [], Array.isArray(d.jobs) ? d.jobs : [], (Array.isArray(d.history) ? d.history : []).slice(0, 50));
        // a running entry with no song of its own (a channel, a timer) names what its recording has on air
        const onAir = (e) => { const r = e.rid && (d.recordings || []).find((x) => x.rid === e.rid); return r ? r.cut : null; };
        const rows = list.map((e, i) => ({
            key: `q:${e.id}`,
            icon: e.state === 'missed' ? `${VI}/warning-16.png` : `${VI}/service-worker-16.png`,
            data: { n: i + 1, cut: cutText(e) || cutText(onAir(e)) || chName(e.channelId), kind: QKIND[e.kind] || '', channel: chName(e.channelId), radio: e.slot ? `Lizumi-Recorder-${e.slot}` : '-', qstate: QSTATE[e.state] || 'Queued', reason: e.reason || '', expires: clock(e.expiresAt), expiresAt: e.expiresAt || 0, added: clock(e.addedAt), addedAt: e.addedAt || 0 }
        }));
        return {
            html: c.listView([
                { t: 'Order', w: 50, key: 'n', text: (x) => String(x.n), value: (x) => x.n },
                { t: 'Song', w: 220, key: 'cut', text: (x) => x.cut },
                { t: 'Kind', w: 80, key: 'kind', text: (x) => x.kind },
                { t: 'State', w: 70, key: 'qstate', text: (x) => x.qstate },
                { t: 'Virtual Radio', w: 120, key: 'radio', text: (x) => x.radio },
                { t: 'Channel', w: 140, key: 'channel', text: (x) => x.channel },
                { t: 'Expires', w: 120, key: 'expires', text: (x) => x.expires, value: (x) => x.expiresAt },
                { t: 'Added', w: 120, key: 'added', text: (x) => x.added, value: (x) => x.addedAt },
                { t: 'Why', w: 260, key: 'reason', text: (x) => x.reason }
            ], rows, { sortId: 'lz-queue', empty: 'The queue is empty.' }),
            list: true
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
        const d = state.deck || {};
        const rows = [];
        (d.timers || []).forEach((t) => rows.push({
            key: `t:${t.id}`, icon: `${VI}/windows-update-16.png`,
            data: { kind: 'Timer', channel: chName(t.channelId), start: t.start || '', minutes: t.minutes ? String(t.minutes) : '', days: daysText(t.days), date: t.date || '', mode: t.mode || '', match: '', rules: t.notify ? 'Notify' : '', tape: t.destination || '', state: t.off ? 'Off' : 'On' }
        }));
        (d.terms || []).forEach((t) => rows.push({
            key: `s:${t.id}`, icon: `${VI}/search-16.png`,
            data: { kind: 'Search term', channel: t.channelId ? chName(t.channelId) : 'Any channel', start: '', minutes: '', days: daysText(t.days), date: '', mode: '', match: t.text || '', rules: ruleText(t), tape: t.destination || '', state: 'On' }
        }));
        (d.alerts || []).forEach((a) => rows.push({
            key: `a:${a.id}`, icon: `${VI}/search-16.png`,
            data: { kind: 'Alert', channel: a.channelId ? chName(a.channelId) : 'Any channel', start: '', minutes: '', days: '', date: '', mode: '', match: [a.artist, a.title].filter(Boolean).join(' - '), rules: '', tape: a.destination || '', state: 'On' }
        }));
        return {
            html: c.listView([
                { t: 'Type', w: 120, key: 'kind', text: (x) => x.kind },
                { t: 'Channel', w: 120, key: 'channel', text: (x) => x.channel },
                { t: 'Start', w: 46, key: 'start', text: (x) => x.start },
                { t: 'Minutes', w: 52, key: 'minutes', text: (x) => x.minutes, value: (x) => Number(x.minutes) || 0 },
                { t: 'Days', w: 110, key: 'days', text: (x) => x.days },
                { t: 'Date', w: 74, key: 'date', text: (x) => x.date },
                { t: 'Mode', w: 46, key: 'mode', text: (x) => x.mode },
                { t: 'Matches', w: 150, key: 'match', text: (x) => x.match },
                { t: 'Rules', w: 190, key: 'rules', text: (x) => x.rules },
                { t: 'Tape', w: 90, key: 'tape', text: (x) => x.tape },
                { t: 'State', w: 44, key: 'state', text: (x) => x.state }
            ], rows, { sortId: 'lz-schedules', empty: 'There are no timers, search terms or alerts. Use New Timer or New Search Term.' }),
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

    function recordingsPage(c) {
        const d = state.deck;
        if (d) { void loadTracks(c); void loadHeld(c, false); }
        const hrows = (state.held || []).map((h) => ({
            key: `h:${h.rid}`, icon: `${VI}/${h.state === 'failed' ? 'warning' : 'volume-high'}-16.png`,
            data: {
                channel: chName(h.channelId), kind: KIND[h.kind] || 'Channel', radio: slotName((h.slot || 1) - 1),
                state: HSTATE[h.state] || h.state, bad: h.state === 'failed', started: clock(h.since), startedAt: h.since || 0, ended: clock(h.endedAt), endedAt: h.endedAt || 0,
                segs: Number(h.segs) || 0, gaps: (h.gaps || []).length, gapS: Number(h.gapSeconds) || 0,
                files: (h.files || []).length ? String(h.files.length) : '', keep: h.keepUntil ? clock(h.keepUntil) : '', keepAt: h.keepUntil || 0, error: h.error || ''
            }
        }));
        const held = c.listView([
            { t: 'Channel', w: 140, key: 'channel', text: (x) => x.channel },
            { t: 'Kind', w: 80, key: 'kind', text: (x) => x.kind },
            { t: 'Virtual Radio', w: 120, key: 'radio', text: (x) => x.radio },
            { t: 'State', w: 90, key: 'state', text: (x) => (x.error ? `${x.state}: ${x.error}` : x.state), html: (x) => (x.bad ? c.state(false, x.state, true) : `<i>${esc(x.state)}</i>`) },
            { t: 'Started', w: 110, key: 'started', text: (x) => x.started, value: (x) => x.startedAt },
            { t: 'Ended', w: 110, key: 'ended', text: (x) => x.ended, value: (x) => x.endedAt },
            { t: 'Segments', w: 70, key: 'segs', text: (x) => String(x.segs), value: (x) => x.segs },
            { t: 'Gaps', w: 90, key: 'gaps', text: (x) => gapText(x.gaps, x.gapS), html: (x) => gapCell(c, false, x.gaps, x.gapS), value: (x) => x.gaps },
            { t: 'Files', w: 44, key: 'files', text: (x) => x.files },
            { t: 'Keep until', w: 110, key: 'keep', text: (x) => x.keep, value: (x) => x.keepAt }
        ], hrows, { sortId: 'lz-held', empty: state.held ? 'No recording holds segments.' : 'Reading the held recordings...' });
        // a track's time comes in seconds from the file store (read as ms it showed January 1970)
        const trackMs = (v) => { const n = Number(v) || 0; return n && n < 1e12 ? n * 1000 : n; };
        const rows = (state.tracks || []).map((t) => ({
            key: `r:${t.id}`, icon: `${VI}/volume-high-16.png`,
            data: { name: t.name, size: `${Math.max(1, Math.round((t.size || 0) / 1024)).toLocaleString('en-US')} KB`, sizeB: t.size || 0, at: clock(trackMs(t.at)), atMs: trackMs(t.at) }
        }));
        const tape = c.listView([
            { t: 'Name', w: 330, key: 'name', text: (x) => x.name },
            { t: 'Size', w: 80, key: 'size', text: (x) => x.size, value: (x) => x.sizeB },
            { t: 'Recorded', w: 130, key: 'at', text: (x) => x.at, value: (x) => x.atMs }
        ], rows, { sortId: 'lz-recordings', empty: state.tracks ? 'This tape has no recordings.' : 'Reading the tape...' });
        return { html: c.page('Recordings', '', [{ id: 'lz-held', title: 'Held recordings', body: held }, { id: 'lz-tape', title: 'On the tape', body: tape }]) };
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
        const max = (state.slots && state.slots.max) || 4;
        // one SiriusXM login per virtual radio (xmradio slots, #1252 S2); before the server sent the list, slot 1 only
        const list = (state.slots && Array.isArray(state.slots.list)) ? state.slots.list : null;
        const rows = [];
        for (let i = 0; i < max; i++) {
            const s = list ? list.find((x) => x.slot === i + 1) : null;
            const own = i === 0;
            const data = s
                ? {
                    name: s.name || `Lizumi-Recorder-${i + 1}`, handle: s.handle || '',
                    state: s.signedIn ? 'Signed in' : s.handle ? 'Signed out' : 'Not set up',
                    since: s.since ? clock(s.since) : '', token: s.tokenExp ? clock(s.tokenExp) : '-',
                    entitlement: s.entitlementHash ? `${s.entitlementHash}${s.refused ? ` (${s.refused} refused)` : ''}` : '-',
                    error: s.lastError ? `${s.lastErrorAt ? `${clock(s.lastErrorAt)} ` : ''}${s.lastError}` : ''
                }
                : {
                    name: `Lizumi-Recorder-${i + 1}`,
                    handle: own ? (a.handle || '') : '',
                    state: own ? (a.signedIn ? 'Signed in' : a.expired ? 'Expired' : 'Signed out') : 'Not set up',
                    since: own && a.since ? clock(a.since) : '', token: '-', entitlement: '-', error: ''
                };
            rows.push({ key: `acc:${i + 1}`, icon: `${VI}/account-manager-16.png`, data });
        }
        return {
            html: c.listView([
                { t: 'Virtual Radio', w: 130, key: 'name', text: (x) => x.name },
                { t: 'Handle', w: 150, key: 'handle', text: (x) => x.handle },
                { t: 'State', w: 90, key: 'state', text: (x) => x.state },
                { t: 'Signed in since', w: 120, key: 'since', text: (x) => x.since },
                { t: 'Token expiry', w: 90, key: 'token', text: (x) => x.token },
                { t: 'Entitlement', w: 120, key: 'entitlement', text: (x) => x.entitlement },
                { t: 'Last sign-in failure', w: 220, key: 'error', text: (x) => x.error }
            ], rows, { sortId: 'lz-accounts', empty: EMPTY }),
            list: true
        };
    }


    // ---- Diagnostics (read-only) --------------------------------------------------------------------------

    function diagnosticsPage(c) {
        const d = state.deck || {};
        const list = (state.slots && Array.isArray(state.slots.list)) ? state.slots.list : [];
        const pool = Array.isArray(d.pool) ? d.pool : [];
        const signed = pool.length ? pool.filter((x) => x.ready).length : list.filter((x) => x.signedIn).length;
        const link = c.props([
            ['Recorder service', d.offline ? c.state(false, 'Offline: the recorder service is not answering', false) : c.state(true, 'Online')],
            ['Signed-in virtual radios', esc(`${signed} of ${pool.length || (state.slots && state.slots.max) || 4}`)],
            ['Recordings running', esc(String(recs().length))],
            ['Held recordings', esc(d.held ? `${d.held.n || 0} (${d.held.assembling || 0} assembling, ${d.held.failed || 0} failed)` : '0')]
        ]);
        const arows = list.map((s2) => ({
            key: `da:${s2.slot}`, icon: `${VI}/account-manager-16.png`,
            data: { name: s2.name || slotName((s2.slot || 1) - 1), state: s2.signedIn ? 'Signed in' : s2.handle ? 'Signed out' : 'Not set up', error: s2.lastError ? `${s2.lastErrorAt ? `${clock(s2.lastErrorAt)} ` : ''}${s2.lastError}` : 'None' }
        }));
        const accounts = c.listView([
            { t: 'Virtual Radio', w: 130, key: 'name', text: (x) => x.name },
            { t: 'State', w: 90, key: 'state', text: (x) => x.state },
            { t: 'Last sign-in failure', w: 420, key: 'error', text: (x) => x.error }
        ], arows, { sortId: 'lz-diag-acc', empty: 'No accounts were reported.' });
        const rrows = recs().map((r) => ({
            key: `dr:${r.rid}`, icon: `${VI}/volume-high-16.png`,
            data: { name: slotName((r.slot || 1) - 1), channel: chName(r.channelId), gaps: Number(r.gaps && r.gaps.length != null ? r.gaps.length : r.gaps) || 0, gapS: Number(r.gapSeconds) || 0, refetches: Number(r.refetches) || 0, pauses: Number(r.pauses) || 0, behind: Number(r.behindS) || 0 }
        }));
        const health = c.listView([
            { t: 'Virtual Radio', w: 130, key: 'name', text: (x) => x.name },
            { t: 'Channel', w: 150, key: 'channel', text: (x) => x.channel },
            { t: 'Gaps', w: 90, key: 'gaps', text: (x) => gapText(x.gaps, x.gapS), html: (x) => gapCell(c, false, x.gaps, x.gapS), value: (x) => x.gaps },
            { t: 'Re-fetches', w: 76, key: 'refetches', text: (x) => String(x.refetches), value: (x) => x.refetches },
            { t: 'Pauses', w: 60, key: 'pauses', text: (x) => String(x.pauses), value: (x) => x.pauses },
            { t: 'Behind', w: 70, key: 'behind', text: (x) => `${Math.round(x.behind)}s`, value: (x) => x.behind }
        ], rrows, { sortId: 'lz-diag-rec', empty: 'No recording is running.' });
        const mrows = (Array.isArray(d.history) ? d.history : []).filter((e) => e.state === 'missed').map((e) => ({
            key: `dm:${e.id}`, icon: `${VI}/warning-16.png`,
            data: { cut: cutText(e) || chName(e.channelId), channel: chName(e.channelId), when: clock(e.endedAt || e.expiresAt), whenAt: e.endedAt || e.expiresAt || 0, reason: e.reason || '' }
        }));
        const missed = c.listView([
            { t: 'Song', w: 240, key: 'cut', text: (x) => x.cut },
            { t: 'Channel', w: 150, key: 'channel', text: (x) => x.channel },
            { t: 'When', w: 120, key: 'when', text: (x) => x.when, value: (x) => x.whenAt },
            { t: 'Why', w: 320, key: 'reason', text: (x) => x.reason }
        ], mrows, { sortId: 'lz-diag-miss', empty: 'No queue entry was missed.' });
        return {
            html: c.page('Diagnostics', '', [
                { id: 'lz-diag-link', title: 'Link', body: link },
                { id: 'lz-diag-acc', title: 'Accounts', body: accounts },
                { id: 'lz-diag-rec', title: 'Recording health', body: health },
                { id: 'lz-diag-miss', title: 'Missed queue entries', body: missed }
            ])
        };
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

    const recs = () => (state.deck && Array.isArray(state.deck.recordings) ? state.deck.recordings : []);
    const recOf = (rid) => recs().find((r) => r.rid === rid) || null;
    const slotName = (i) => `Lizumi-Recorder-${i + 1}`;

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
        const list = recs();
        const r = liveRec();
        if (state.player && (!r || state.player.rid !== r.rid)) stopPlayer(); // the recording ended, or another is shown
        const p = state.player;
        const rows = list.map((x, i) => ({ key: `lv:${x.rid}`, icon: `${VI}/volume-high-16.png`, data: { name: slotName(i), channel: chName(x.channelId), cut: cutText(x.cut) } }));
        if (r && String(c.sel) !== `lv:${r.rid}`) c.sel = `lv:${r.rid}`;
        const listHtml = c.listView([
            { t: 'Virtual Radio', w: 130, key: 'name', text: (x) => x.name },
            { t: 'Channel', w: 160, key: 'channel', text: (x) => x.channel },
            { t: 'On air', w: 300, key: 'cut', text: (x) => x.cut }
        ], rows, { sortId: 'lz-live', empty: 'No virtual radio is recording.' });
        let monitor = '<p>Pick a recording virtual radio to monitor it.</p>';
        if (r) {
            const i = list.indexOf(r);
            monitor = `<div class="mmc-buttons">
                <button type="button" class="btn-standard" data-lz="play">${p ? 'Stop' : 'Play'}</button>
                <button type="button" class="btn-standard" data-lz="mute">${state.muted ? 'Unmute' : 'Mute'}</button>
                <label>Volume <input type="range" min="0" max="100" step="1" value="${state.vol}" data-lz="vol" aria-label="Volume"></label>
            </div>
            ${c.props([
                ['Monitor', esc(`${slotName(i)} - ${p ? PSTATE[p.state] : 'stopped'}`)],
                ['Channel', esc(chName(r.channelId))],
                ['On air', esc(cutText(r.cut))],
                ['Tape running', `<span data-lz="running">${esc(runningText(r))}</span>`],
                ['Reached back', esc(r.back ? span(r.back) : '0:00')]
            ])}`;
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
            case 'radios': void loadLineup(); return radiosPage(c);
            case 'queue': void loadLineup(); return queuePage(c);
            case 'schedules': void loadLineup(); return schedulesPage(c);
            case 'recordings': return recordingsPage(c);
            case 'accounts': return accountsPage(c);
            case 'live': void loadLineup(); return livePage(c);
            case 'diagnostics': return diagnosticsPage(c);
            case 'settings': return settingsPage(c);
            default: return '';
        }
    }

    function status(n) {
        const d = state.deck;
        if (!d || n.id === 'root') return '';
        const pool = Array.isArray(d.pool) && d.pool.length ? d.pool : null;
        const r = pool ? pool.filter((x) => x.streaming > 0).length : (d.recordings || []).length;
        const max = pool ? pool.length : ((state.slots && state.slots.max) || 4);
        const ready = pool ? pool.filter((x) => x.ready).length : max;
        const q = (d.queue || []).length;
        if (n.id === 'recordings') return `Tape: ${d.tape}`;
        return `${r} of ${max} virtual radios recording (${ready} signed in), ${q} ${q === 1 ? 'entry' : 'entries'} waiting`;
    }

    function def() {
        return {
            id: ID,
            title: TITLE,
            icon16: APP,
            icon32: APP,
            taskbarIcon: APP,
            treeWidth: 170,
            // the pool's columns (radio, state, channel, on air, kind, running, reach-back, buffer, segments) fit without scrolling
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
                if (!n || n.id !== 'live' || !key || !key.startsWith('lv:')) return;
                const rid = key.slice(3);
                if (rid !== state.liveRid) { state.liveRid = rid; stopPlayer(); }
                c.refresh();
            },
            onClose: () => {
                stopPlayer();
                state.console = null;
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
