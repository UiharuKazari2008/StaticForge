/**
 * Lizumi (Yozora #1252, slice S4): the MMC console for XM Radio recording management, opened from the Start menu
 * as its own window. Read-only in this version. Pages:
 *
 *   Lizumi
 *     Virtual Radios    the four recorder slots (Lizumi-Recorder-1..4): each holds one recording or is on standby,
 *                       with the queue depth beside it
 *     Queue             the common queue in due order
 *     Schedules         timers, search terms and alerts as one list
 *     Recordings        the current tape's tracks
 *     Accounts          the SiriusXM login
 *     Live              a monitor player for one recording slot (its growing HLS playlist), Mute and volume, and the
 *                       tape's own progress; the player exists only while this page is shown
 *     Diagnostics       later update (empty state)
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
        { id: 'diagnostics', name: 'Diagnostics', icon: `${VI}/problem-reports-16.png` }
    ];

    const state = {
        console: null, account: null, deck: null, slots: { max: 4 }, loaded: false, error: '',
        channels: new Map(), lineupAsked: false,
        tracks: null, tracksFor: '', tracksLoading: false,
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

    function later(c, what) {
        return {
            html: c.listView([{ t: 'Name', w: 300, key: 'name', text: (d) => d.name }], [], { empty: `${what} will be available in a later update.` }),
            list: true
        };
    }

    const KIND = { song: 'Song', cut: 'Song on air', manual: 'Channel', channel: 'Channel', timer: 'Timer', alert: 'Alert', term: 'Search term' };

    function radiosPage(c) {
        const d = state.deck || {};
        const recs = Array.isArray(d.recordings) ? d.recordings : [];
        const pool = Array.isArray(d.pool) && d.pool.length ? d.pool : null;
        const max = pool ? pool.length : ((state.slots && state.slots.max) || 4);
        const now = Date.now();
        const rows = [];
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
                    ? { name: `Lizumi-Recorder-${i + 1}`, state: 'Recording', channel: chName(r.channelId), cut: cutText(r.cut), kind: KIND[r.kind] || 'Channel', running: span((now - (r.since || now)) / 1000), runningS: now - (r.since || now), back: r.back ? span(r.back) : '0:00', buffer: '-', segments: '-' }
                    : { name: `Lizumi-Recorder-${i + 1}`, state: ready ? 'Standby' : 'No account', channel: '', cut: '', kind: '', running: '', runningS: 0, back: '', buffer: '-', segments: '-' }
            });
        }
        return {
            html: c.listView([
                { t: 'Virtual Radio', w: 130, key: 'name', text: (x) => x.name },
                { t: 'State', w: 76, key: 'state', text: (x) => x.state },
                { t: 'Channel', w: 130, key: 'channel', text: (x) => x.channel },
                { t: 'On air', w: 200, key: 'cut', text: (x) => x.cut },
                { t: 'Kind', w: 64, key: 'kind', text: (x) => x.kind },
                { t: 'Running', w: 70, key: 'running', text: (x) => x.running, value: (x) => x.runningS },
                { t: 'Reached back', w: 90, key: 'back', text: (x) => x.back },
                { t: 'Buffer', w: 60, key: 'buffer', text: (x) => x.buffer },
                { t: 'Segments', w: 70, key: 'segments', text: (x) => x.segments }
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

    function schedulesPage(c) {
        const d = state.deck || {};
        const rows = [];
        (d.timers || []).forEach((t) => rows.push({
            key: `t:${t.id}`, icon: `${VI}/windows-update-16.png`,
            data: { kind: 'Timer', channel: chName(t.channelId), start: t.start || '', minutes: t.minutes ? String(t.minutes) : '', days: daysText(t.days), date: t.date || '', mode: t.mode || '', match: '', state: t.off ? 'Off' : 'On' }
        }));
        (d.terms || []).forEach((t) => rows.push({
            key: `s:${t.id}`, icon: `${VI}/search-16.png`,
            data: { kind: 'Search term', channel: t.channelId ? chName(t.channelId) : 'Any channel', start: '', minutes: '', days: '', date: '', mode: '', match: t.text || '', state: 'On' }
        }));
        (d.alerts || []).forEach((a) => rows.push({
            key: `a:${a.id}`, icon: `${VI}/search-16.png`,
            data: { kind: 'Alert', channel: a.channelId ? chName(a.channelId) : 'Any channel', start: '', minutes: '', days: '', date: '', mode: '', match: [a.artist, a.title].filter(Boolean).join(' - '), state: 'On' }
        }));
        return {
            html: c.listView([
                { t: 'Type', w: 110, key: 'kind', text: (x) => x.kind },
                { t: 'Channel', w: 130, key: 'channel', text: (x) => x.channel },
                { t: 'Start', w: 50, key: 'start', text: (x) => x.start },
                { t: 'Minutes', w: 56, key: 'minutes', text: (x) => x.minutes, value: (x) => Number(x.minutes) || 0 },
                { t: 'Days', w: 130, key: 'days', text: (x) => x.days },
                { t: 'Date', w: 76, key: 'date', text: (x) => x.date },
                { t: 'Mode', w: 50, key: 'mode', text: (x) => x.mode },
                { t: 'Matches', w: 180, key: 'match', text: (x) => x.match },
                { t: 'State', w: 44, key: 'state', text: (x) => x.state }
            ], rows, { sortId: 'lz-schedules', empty: EMPTY }),
            list: true
        };
    }

    function recordingsPage(c) {
        const d = state.deck;
        if (d) void loadTracks(c);
        const rows = (state.tracks || []).map((t) => ({
            key: `r:${t.id}`, icon: `${VI}/volume-high-16.png`,
            data: { name: t.name, size: `${Math.max(1, Math.round((t.size || 0) / 1024)).toLocaleString('en-US')} KB`, sizeB: t.size || 0, at: clock(t.at), atMs: t.at || 0 }
        }));
        return {
            html: c.listView([
                { t: 'Name', w: 330, key: 'name', text: (x) => x.name },
                { t: 'Size', w: 80, key: 'size', text: (x) => x.size, value: (x) => x.sizeB },
                { t: 'Recorded', w: 130, key: 'at', text: (x) => x.at, value: (x) => x.atMs }
            ], rows, { sortId: 'lz-recordings', empty: state.tracks ? 'This tape has no recordings.' : 'Reading the tape...' }),
            list: true
        };
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
            case 'diagnostics': return later(c, 'Diagnostics');
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
            commands: () => [],
            selCommands: () => null,
            action: () => false,
            rowOpen: (key, n, c) => { if (key && key.startsWith('n:')) c.select(key.slice(2), true); },
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
