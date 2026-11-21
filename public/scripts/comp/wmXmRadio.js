/**
 * Melaton Mobile: XM Radio (Yozora #989), the phone's side of the desktop's SiriusXM radio (apps/xmradio).
 *
 * Yukimi, Nov 20 2026: "With today item and for titanium the item will show what's on air as LR pages and soft-key to
 * one touch record this where it records from the start. Really it should always ask do you want to record from the
 * start." The soft key reads Record on a channel, and REC while that channel is being recorded; the 6.5 panel's
 * superscript by its name is the current channel's number, or "rec" while a recording runs.
 *
 *   Today (6.1 block, 6.5 panel)  a page per channel: the one the phone plays, then preset bank A; left / right
 *                     (swipe, arrows) turn pages. Each page is what is on air now: the song's art (or the channel's
 *                     logo), the title, the artist, the channel. Tap = play that channel in the program. Record (the
 *                     6.5 page's soft key; the block's REC button on 6.1) asks "Record from the start?": Yes = the
 *                     cut from its first frame (the stream keeps five hours), No = from now; either way the server
 *                     records that one song into the deck's tape (packet xmradio_rec_start { song, fromStart }) and
 *                     stops when it ends. While that channel records the key reads REC and offers Stop.
 *   The program       the channel on air at the top (logo, art, artist, title, show), the presets or all channels
 *                     under it; left soft key Record / REC, right Menu (Play / Pause, channel up / down, Show,
 *                     Direct Tune, Add to Presets, Quality, Alert, Refresh Lineup, Stop Radio).
 *
 * Sound: the Dreamscape app's native player (window.AndroidVideos, DSApp videos/VideoPlayback.kt) plays the stream as
 * sound only, so it carries on with the screen off and the app in the background; without it (a browser, an app
 * that does not take radio addresses yet) the page plays it with hls.js.
 *
 * Data: statusHub feed `xmradio_phone` (presets and the channels this phone shows only; modules/xmRadio.js), joined
 * while Today shows this item or the program is on screen, with the screen on (never polled). Everything shown is kept
 * on the phone (localStorage wmXmRadioCache), so Today draws at once at start-up with no server wait
 * (installed-boot-zero-wait); the lineup is read once a month (or when the server's lineup moves).
 *
 * Art: wm61/app-xmradio*, wm65/start-xmradio*, ti-x-app-xmradio-lg*
 * (scripts/generate-wm-xmradio-art.js). Styles: public/css/wm-xmradio.css. Phones only; the account is the
 * administrator's (dev_admin test tabs listen).
 */
(function () {
    'use strict';
    const appScopeSignal = (window.melatonSegments && typeof window.melatonSegments.callerSignal === 'function' && window.melatonSegments.callerSignal()) || undefined; // page listeners end with this file's segment (app-scope, #872/#890)

    if (window.uiShell !== 'mobile' || !document.documentElement.classList.contains('ui-mobile')) return;

    const APP_ID = 'xmradio-mobile';
    const TITLE = 'XM Radio';
    const LS_PREFS = 'wmXmRadio';
    const LS_CACHE = 'wmXmRadioCache';
    const LINEUP_MS = 30 * 86400000;
    const HLS_SRC = '/dist/hlsjs/hls.light.min.js';
    const QUALITIES = [['hi', 'High (256k)'], ['std', 'Standard (128k)'], ['low', 'Low (32k)'], ['eco24', 'Economy (24k)'], ['eco16', 'Economy (16k)']];
    const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    const canUse = () => { try { return /^(admin|dev_admin)$/.test(localStorage.getItem('userType') || ''); } catch (_) { return false; } };
    const isAdmin = () => { try { return localStorage.getItem('userType') === 'admin'; } catch (_) { return false; } };
    const client = () => (window.wsClient && (!window.wsClient.isConnected || window.wsClient.isConnected()) ? window.wsClient : null);
    const screenOn = () => !document.hidden && document.documentElement.dataset.screenOff === undefined;
    const nativePlayer = () => (window.AndroidVideos && typeof window.AndroidVideos.watching === 'function' ? window.AndroidVideos : null);

    function readJson(key, fallback) {
        try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v && typeof v === 'object' ? v : fallback; } catch (_) { return fallback; }
    }
    const prefs = Object.assign({ channel: '', quality: 'std', show: 'A', todayAt: 0, body: 'gloss', era: 'xm' }, readJson(LS_PREFS, {}));
    // Now Playing is the receiver's own screen (Yukimi, Nov 20 2026: "It should share the same LCD design"): the desktop
    // radio's display markup and theme (public/css/themes/vista/xmradio.css, whose rules also match .xrm-lcd), one of
    // the docked receivers' screens at its own size, scaled to the phone's width
    const BODIES = [['gloss', 'Gloss'], ['onyxplus', 'Onyx Plus'], ['onyxez', 'Onyx EZ'], ['stratus', 'Stratus'], ['roady', 'Roady XT']];
    const BODY_DISPLAY = { gloss: 'tft', onyxplus: 'tft', onyxez: 'lcd', stratus: 'lcd', roady: 'dotlcd' };
    const BODY_SCREEN = { gloss: [246, 184], onyxplus: [274, 194], onyxez: [236, 180], stratus: [372, 94], roady: [340, 152] };
    const ERAS = [['xm', 'XM'], ['sirius', 'Sirius'], ['sxm2011', 'SiriusXM (2011)'], ['sxm2023', 'SiriusXM (2023)']];
    if (!BODY_SCREEN[prefs.body]) prefs.body = 'gloss';
    if (!ERAS.some((e) => e[0] === prefs.era)) prefs.era = 'xm';
    // what Today and the program draw from, kept on the phone: { lineup: { at, channels }, presets, now: { id: cut }, rec: [] }
    const cache = Object.assign({ lineup: null, presets: { A: [], B: [], C: [] }, now: {}, rec: [], signedIn: false }, readJson(LS_CACHE, {}));
    let saveTimer = 0;
    function saveSoon() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            try { localStorage.setItem(LS_CACHE, JSON.stringify(cache)); } catch (_) { /* this load only */ }
            try { localStorage.setItem(LS_PREFS, JSON.stringify(prefs)); } catch (_) { /* this load only */ }
        }, 800);
    }

    let ws = null;          // wmShell
    let page = null;
    let els = null;
    let shown = false;
    let wired = false;
    let hubOn = false;
    let todayPlaced = false;
    let watchSaid = '';
    let byId = new Map();
    let lineupAsked = false;
    const logoAsked = new Set();
    // the radio: { channelId, state: 'off' | 'tuning' | 'playing' | 'paused' | 'error', native, url }
    const radio = { channelId: '', state: 'off', native: false, url: '', hls: null, audio: null, seq: 0, mode: 'live', track: null, startedAt: 0 };

    function indexLineup() { byId = new Map(((cache.lineup && cache.lineup.channels) || []).map((c) => [c.id, c])); }
    indexLineup();
    const chan = (id) => byId.get(id) || null;
    const chanLabel = (c) => (c ? `${c.number} ${c.name}` : '');
    const nowOf = (id) => cache.now[id] || null;
    const recOf = (id) => (cache.rec || []).find((r) => r.channelId === id) || null;

    async function ask(type, payload, ms = 30000) {
        const c = client();
        if (!c) throw new Error('Not connected to the server');
        const r = await Promise.race([
            c.sendMessage(type, payload || {}, false),
            new Promise((_, reject) => setTimeout(() => reject(new Error('The server did not answer in time')), ms))
        ]);
        return r && r.data && typeof r.data === 'object' ? r.data : r;
    }

    function box(text, icon) { if (ws) return ws.messageBox({ title: TITLE, icon: icon || 'error', text }); return Promise.resolve(false); }

    // ---------------------------------------------------------------- the feed

    /** Today's pages: the channel this phone plays, then preset bank A (each once). */
    function todayChannels() {
        const out = [];
        const add = (id) => { if (id && chan(id) && !out.includes(id)) out.push(id); };
        add(radio.channelId || prefs.channel);
        (cache.presets.A || []).forEach(add);
        if (!out.length) (cache.lineup && cache.lineup.channels || []).filter((c) => c.sub !== false).slice(0, 3).forEach((c) => add(c.id));
        return out;
    }

    function wantHub() {
        if (!ws || !canUse() || !screenOn()) return false;
        const cur = typeof ws.currentApp === 'function' ? ws.currentApp() : null;
        return (cur === 'today' && todayPlaced) || (cur === APP_ID && shown);
    }

    async function syncHub() {
        const want = wantHub();
        const c = client();
        if (!c) return;
        if (want) tellWatch();
        if (want === hubOn) return;
        hubOn = want;
        try {
            const r = await c.sendMessage(want ? 'status_subscribe' : 'status_unsubscribe', { feed: 'xmradio_phone' }, false);
            const items = r && (r.items || (r.data && r.data.items));
            if (want && hubOn && items) applyHub(items);
        } catch (_) { if (want) hubOn = false; }
    }

    /** The channels the server sends this phone beyond the presets (the one it plays, Today's pages). */
    function tellWatch() {
        const list = [radio.channelId || prefs.channel].concat(todayChannels()).filter(Boolean);
        const said = [...new Set(list)].slice(0, 12).join(',');
        if (said === watchSaid) return;
        const c = client();
        if (!c) return;
        watchSaid = said;
        try { c.sendMessage('xmradio_phone_watch', { channels: said.split(',').filter(Boolean) }, false).catch(() => { watchSaid = ''; }); } catch (_) { watchSaid = ''; }
    }

    function applyHub(items) {
        if (!items || typeof items !== 'object') return;
        let lineupMoved = false;
        for (const [k, v] of Object.entries(items)) {
            if (k === 'account') cache.signedIn = !!(v && v.signedIn);
            else if (k === 'lineup') { if (v && v.at && (!cache.lineup || v.at > (cache.lineup.at || 0))) lineupMoved = true; }
            else if (k === 'rec') { const was = (cache.rec || []).length; cache.rec = Array.isArray(v) ? v : []; if (cache.rec.length < was) tapes.stale = true; }
            else if (k.startsWith('ch:')) { if (v) cache.now[k.slice(3)] = v; else delete cache.now[k.slice(3)]; }
        }
        saveSoon();
        // the song changed on the channel shown: its programme (recently played, the song's length) is read again
        if (shown && tab === 'now' && radio.mode === 'live') void loadSchedule(radio.channelId || prefs.channel);
        if (shown && tab === 'recordings' && tapes.stale) void loadTapes(false);
        if (lineupMoved || !cache.lineup || Date.now() - (cache.lineup.at || 0) > LINEUP_MS) void loadLineup(lineupMoved);
        changed();
    }

    async function loadLineup(force) {
        if (lineupAsked && !force) return;
        lineupAsked = true;
        try {
            const d = await ask('xmradio_lineup', {}, 120000);
            const channels = (d.channels || []).map((c) => ({ id: c.id, number: c.number, name: c.name, logo: c.logo || '', bg: c.bg || '', sub: c.sub === false ? false : undefined }));
            if (channels.length) cache.lineup = { at: Date.now(), channels };
            if (d.presets) cache.presets = Object.assign({ A: [], B: [], C: [] }, d.presets);
            indexLineup();
            saveSoon();
            changed();
            void wantLogos(todayChannels().concat(cache.presets.A || [], cache.presets.B || [], cache.presets.C || []));
        } catch (_) { lineupAsked = false; }
    }

    async function wantLogos(ids) {
        const want = [...new Set(ids.filter((id) => id && chan(id) && (!chan(id).logo || !chan(id).bg) && !logoAsked.has(id)))].slice(0, 40);
        if (!want.length) return;
        want.forEach((id) => logoAsked.add(id));
        try {
            const d = await ask('xmradio_logos', { ids: want }, 60000);
            for (const [id, url] of Object.entries((d && d.logos) || {})) { const c = chan(id); if (c) c.logo = url; }
            for (const [id, url] of Object.entries((d && d.backgrounds) || {})) { const c = chan(id); if (c) c.bg = url; }
            saveSoon();
            changed();
        } catch (_) { /* the number alone */ }
    }

    function changed() {
        if (shown) render();
        todayHtml = '';
        if (ws && typeof ws.currentApp === 'function' && ws.currentApp() === 'today') {
            if (typeof ws.refreshTodayItem === 'function') ws.refreshTodayItem('xmradio');
            else if (typeof ws.refreshToday === 'function') ws.refreshToday();
        }
    }

    // ---------------------------------------------------------------- sound

    let hlsLoading = null;
    function loadHls() {
        if (window.Hls) return Promise.resolve(window.Hls);
        if (!hlsLoading) {
            hlsLoading = new Promise((resolve, reject) => {
                const s = document.createElement('script');
                s.src = HLS_SRC;
                s.onload = () => resolve(window.Hls);
                s.onerror = () => { hlsLoading = null; reject(new Error('The player did not load')); };
                document.head.appendChild(s);
            });
        }
        return hlsLoading;
    }

    function dropPage() {
        if (radio.hls) { try { radio.hls.destroy(); } catch (_) { /* gone */ } radio.hls = null; }
        if (radio.audio) { radio.audio.pause(); radio.audio.removeAttribute('src'); try { radio.audio.load(); } catch (_) { /* nothing */ } }
    }

    function dropNative() {
        const nv = nativePlayer();
        if (!nv) return;
        try { nv.watching(''); } catch (_) { /* older app */ }
        if (radio.native) { try { nv.stop(); } catch (_) { /* gone */ } }
        radio.native = false;
    }

    async function tune(id) {
        const c = chan(id);
        if (!c) return;
        if (c.sub === false) { void box(`${chanLabel(c)} is not in your SiriusXM plan.`, 'info'); return; }
        radio.mode = 'live';
        radio.track = null;
        radio.channelId = id;
        prefs.channel = id;
        saveSoon();
        radio.state = 'tuning';
        const seq = ++radio.seq;
        changed();
        tellWatch();
        void loadSchedule(id);
        let r;
        try {
            r = await ask('xmradio_tune', { channelId: id, quality: prefs.quality }, 30000);
        } catch (err) {
            if (seq !== radio.seq) return;
            radio.state = 'error';
            changed();
            if (err && err.code === 'XMRADIO_SIGNED_OUT') void box('Sign in to SiriusXM on the desktop radio (MENU > Sign In) first.', 'info');
            else if (err && err.code === 'XMRADIO_NOT_SUBSCRIBED') { c.sub = false; saveSoon(); void box(`${chanLabel(c)} is not in your SiriusXM plan.`, 'info'); }
            return;
        }
        if (seq !== radio.seq) return;
        radio.url = new URL(r.url, location.origin).toString();
        const now = nowOf(id);
        await start(seq, { title: chanLabel(c), subtitle: now && !now.ad ? [now.a, now.t].filter(Boolean).join(' - ') : 'SiriusXM', live: true });
    }

    /** A recording from a tape: { id, name, tape } of the list `list`, at index i. */
    async function playTrack(list, i) {
        const t = list[i];
        if (!t) { stopRadio(); return; }
        radio.mode = 'track';
        radio.track = { list, i, id: t.id, name: t.name.replace(/\.m4a$/i, ''), tape: t.tape };
        radio.url = new URL(`/api/xmradio/track/${encodeURIComponent(t.id)}`, location.origin).toString();
        radio.state = 'tuning';
        const seq = ++radio.seq;
        tab = 'now';
        changed();
        await start(seq, { title: radio.track.name, subtitle: `Tape: ${t.tape}`, live: false });
    }

    /**
     * The native player when the app takes the address (sound only: it carries on with the screen off), else the
     * page's own: hls.js for a channel, the audio element for a recording.
     */
    async function start(seq, { title, subtitle, live }) {
        dropPage();
        dropNative();
        const nv = nativePlayer();
        if (nv) {
            try {
                nv.watching(JSON.stringify({ url: radio.url, title, subtitle, audioOnly: true }));
                radio.native = nv.handOff() === true;
            } catch (_) { radio.native = false; }
            if (radio.native) { radio.state = 'playing'; radio.startedAt = Date.now(); changed(); return; }
            try { nv.watching(''); } catch (_) { /* older app */ }
        }
        if (!radio.audio) {
            radio.audio = document.createElement('audio');
            radio.audio.preload = 'none';
            for (const t of ['playing', 'pause', 'waiting', 'error', 'ended', 'timeupdate']) radio.audio.addEventListener(t, () => onAudio(t), { signal: appScopeSignal });
        }
        const a = radio.audio;
        if (live) {
            let Hls = null;
            try { Hls = await loadHls(); } catch (_) { Hls = null; }
            if (seq !== radio.seq) return;
            if (Hls && Hls.isSupported()) {
                const h = new Hls({ liveSyncDurationCount: 3, maxBufferLength: 30, backBufferLength: 120, enableWorker: true });
                radio.hls = h;
                h.on(Hls.Events.ERROR, (ev, d) => { if (d && d.fatal && radio.hls === h) { radio.state = 'error'; changed(); } });
                h.loadSource(radio.url);
                h.attachMedia(a);
            } else if (a.canPlayType('application/vnd.apple.mpegurl')) {
                a.src = radio.url;
            } else { radio.state = 'error'; changed(); return; }
        } else {
            a.src = radio.url;
        }
        try { await a.play(); } catch (_) { radio.state = 'paused'; changed(); }
    }

    function onAudio(t) {
        if (radio.native) return;
        if (t === 'timeupdate') { if (tab === 'now' && shown) paintProgress(); return; }
        if (t === 'ended' && radio.mode === 'track' && radio.track) { void playTrack(radio.track.list, radio.track.i + 1); return; }
        if (t === 'playing') radio.state = 'playing';
        else if (t === 'pause' && radio.state === 'playing') radio.state = 'paused';
        else if (t === 'waiting' && radio.state !== 'paused') radio.state = 'tuning';
        else if (t === 'error') radio.state = 'error';
        changed();
    }

    function playPause() {
        if (radio.state === 'off' || radio.state === 'error' || !radio.url) {
            if (radio.mode === 'track' && radio.track) { void playTrack(radio.track.list, radio.track.i); return; }
            const id = radio.channelId || prefs.channel || todayChannels()[0];
            if (id) void tune(id);
            return;
        }
        if (radio.native) { stopRadio(); return; }
        const a = radio.audio;
        if (!a) return;
        if (a.paused) void a.play().catch(() => {}); else a.pause();
    }

    function stopRadio() {
        radio.seq++;
        dropPage();
        dropNative();
        radio.state = 'off';
        changed();
    }

    /** Channel up / down live; the next / previous recording on a tape. */
    function step(dir) {
        if (radio.mode === 'track' && radio.track) {
            const a = radio.audio;
            if (dir < 0 && !radio.native && a && a.currentTime > 4) { a.currentTime = 0; return; }
            void playTrack(radio.track.list, Math.max(0, radio.track.i + dir));
            return;
        }
        const list = ((cache.lineup && cache.lineup.channels) || []).filter((c) => c.sub !== false || c.id === radio.channelId);
        if (!list.length) return;
        const i = list.findIndex((c) => c.id === (radio.channelId || prefs.channel));
        const n = list.length;
        void tune(list[((i < 0 ? 0 : i + dir) % n + n) % n].id);
    }

    // ---------------------------------------------------------------- the programme (now, up next, recently played)

    const sched = new Map(); // channelId -> { at, data, cutAt }
    async function loadSchedule(id, force) {
        if (!id) return;
        const have = sched.get(id);
        const cutAt = (nowOf(id) || {}).at || 0;
        // asked when the channel is shown and again when its song changes (never on a timer)
        if (have && !force && have.cutAt === cutAt && Date.now() - have.at < 120000) return;
        try {
            const d = await ask('xmradio_schedule', { channelId: id }, 30000);
            sched.set(id, { at: Date.now(), data: d, cutAt });
            if (sched.size > 12) sched.delete(sched.keys().next().value);
            if (shown) render();
        } catch (_) { /* the panel shows what the feed has */ }
    }

    // ---------------------------------------------------------------- recording

    /**
     * Record (Yukimi): the song on air on a channel, asking first whether from its start. REC (that channel records
     * now): offers to stop it.
     */
    async function recordAsk(id) {
        if (!isAdmin()) { void box('Recording is for the administrator.', 'info'); return; }
        const c = chan(id);
        if (!c) return;
        const rec = recOf(id);
        if (rec) { await stopRec(rec); return; }
        const now = nowOf(id);
        const what = now && !now.ad && now.t ? `"${now.t}"${now.a ? ` by ${now.a}` : ''}` : `what is on ${chanLabel(c)}`;
        // always asked (Yukimi: "it should always ask do you want to record from the start")
        const choice = await ws.messageBox({ title: TITLE, icon: 'question', text: `Record ${what} from the start?\n\nNo records from now. The song is saved to the cassette deck's tape when it ends.`, buttons: [{ text: 'Yes', value: 'start' }, { text: 'No', value: 'now' }, { text: 'Cancel', value: false }] });
        if (!choice) return;
        await recStart(id, { song: true, fromStart: choice === 'start' });
    }

    /** Record Channel: everything on the channel until stopped (up to 8 hours), as the deck's REC. */
    async function recordChannel(id) {
        const c = chan(id);
        if (!c || !isAdmin()) return;
        if (recOf(id)) { void box(`${chanLabel(c)} is already recording.`, 'info'); return; }
        const ok = await ws.messageBox({ title: TITLE, icon: 'question', text: `Record ${chanLabel(c)} until you stop it (up to 8 hours)?\n\nThe cassette deck's switch decides: a file per song, or one long file.`, buttons: [{ text: 'Record', value: true }, { text: 'Cancel', value: false }] });
        if (ok) await recStart(id, {});
    }

    async function recStart(id, opts) {
        try {
            const r = await ws.busy(ask('xmradio_rec_start', Object.assign({ channelId: id }, opts), 30000), { delay: 300, timeout: 30000 });
            if (r && r.rid) cache.rec = (cache.rec || []).filter((x) => x.rid !== r.rid).concat({ rid: r.rid, channelId: id, kind: r.kind, since: r.since });
            saveSoon();
            changed();
        } catch (err) { void box((err && err.message) || 'The recording could not be started.'); }
    }

    async function stopRec(rec) {
        const c = chan(rec.channelId);
        const stop = await ws.messageBox({ title: TITLE, icon: 'question', text: `${chanLabel(c) || 'A channel'} is recording${rec.kind === 'song' ? ' a song' : ''}.\n\nStop the recording? What is recorded so far is saved to the tape.`, buttons: [{ text: 'Stop', value: true }, { text: 'Keep', value: false }] });
        if (!stop) return;
        try { await ws.busy(ask('xmradio_rec_stop', { rid: rec.rid }, 120000), { delay: 300, timeout: 120000 }); } catch (err) { void box((err && err.message) || 'The recording could not be stopped.'); return; }
        cache.rec = cache.rec.filter((r) => r.rid !== rec.rid);
        tapes.stale = true;
        changed();
    }

    function recKey(id) {
        const rec = !!recOf(id);
        return { label: rec ? 'REC' : 'Record', disabled: !id || !isAdmin(), action: () => { void recordAsk(id); } };
    }

    async function setAlert(kind) {
        const id = radio.channelId || prefs.channel;
        const now = nowOf(id);
        if (!now || now.ad || !now.a) { void box('Nothing is playing to set an alert for.', 'info'); return; }
        try {
            await ask('xmradio_alert_add', { kind, artist: now.a, title: kind === 'song' ? now.t : '' });
            void box(kind === 'song' ? `"${now.t}" will be recorded whenever it plays on a channel in your plan.` : `${now.a} will be recorded whenever they play on a channel in your plan.`, 'info');
        } catch (err) { void box((err && err.message) || 'The alert could not be set.'); }
    }

    async function setPreset(bank, slot) {
        const id = radio.channelId || prefs.channel;
        if (!id) return;
        const next = { A: (cache.presets.A || []).slice(), B: (cache.presets.B || []).slice(), C: (cache.presets.C || []).slice() };
        while (next[bank].length < 10) next[bank].push(null);
        next[bank][slot] = id;
        try {
            const d = await ask('xmradio_presets_set', { presets: next });
            cache.presets = Object.assign({ A: [], B: [], C: [] }, (d && d.presets) || next);
            saveSoon();
            changed();
        } catch (err) { void box((err && err.message) || 'The preset could not be saved.'); }
    }

    async function directTune() {
        const v = await ws.messageBox({ title: 'Direct Tune', icon: null, text: 'Channel number:', input: { value: '', placeholder: '' }, buttons: [{ text: 'Tune', value: true }, { text: 'Cancel', value: false }] });
        const n = Number(v);
        if (!v || !Number.isFinite(n)) return;
        const c = ((cache.lineup && cache.lineup.channels) || []).find((x) => x.number === n);
        if (c) void tune(c.id); else void box(`There is no channel ${n}.`, 'info');
    }

    // ---------------------------------------------------------------- tapes (the Recordings tab)

    // { list: [names], deck: { tape, workspaceId, mode }, open: name | null, tracks: { name: [...] }, sel: id, stale }
    const tapes = { list: null, deck: null, open: null, tracks: {}, sel: '', stale: true, loading: false };

    async function loadTapes(force) {
        if (tapes.loading || (!force && !tapes.stale && tapes.list)) return;
        tapes.loading = true;
        try {
            const d = await ask('xmradio_deck_get', {}, 30000);
            tapes.deck = d.deck || null;
            tapes.list = (d.tapes || []).slice();
            if (tapes.deck && tapes.deck.tape && !tapes.list.includes(tapes.deck.tape)) tapes.list.unshift(tapes.deck.tape);
            tapes.stale = false;
            if (tapes.open) await loadTracks(tapes.open);
        } catch (err) { tapes.error = (err && err.message) || 'The tapes could not be read.'; }
        tapes.loading = false;
        if (shown) render();
    }

    async function loadTracks(name) {
        try {
            const d = await ask('xmradio_tape_tracks', { tape: name }, 30000);
            tapes.tracks[name] = (d.tracks || []).map((t) => Object.assign({}, t, { tape: name }));
        } catch (_) { tapes.tracks[name] = []; }
        if (shown) render();
    }

    function openTape(name) {
        tapes.open = name;
        tapes.sel = '';
        void loadTracks(name);
        render();
        if (ws) ws.refreshSoftKeys();
    }

    function closeTape() {
        tapes.open = null;
        tapes.sel = '';
        render();
        if (ws) ws.refreshSoftKeys();
    }

    async function tapeAction(kind, name) {
        const ask1 = (title, text, value) => ws.messageBox({ title, icon: null, text, input: { value: value || '', placeholder: '' }, buttons: [{ text: 'ok', value: true }, { text: 'Cancel', value: false }] });
        try {
            if (kind === 'new') {
                const n = await ask1('New Tape', 'Name the new tape:', '');
                if (!n) return;
                await ws.busy(ask('xmradio_tape_new', { name: n }), { delay: 300, timeout: 30000 });
            } else if (kind === 'rename') {
                const n = await ask1('Rename Tape', `New name for ${name}:`, name);
                if (!n || n === name) return;
                await ws.busy(ask('xmradio_tape_rename', { from: name, to: n }), { delay: 300, timeout: 30000 });
                if (tapes.open === name) tapes.open = n;
            } else if (kind === 'delete') {
                const ok = await ws.messageBox({ title: 'Delete Tape', icon: 'warning', text: `Move the tape ${name} and every recording on it to the Recycle Bin?`, buttons: [{ text: 'Delete', value: true }, { text: 'Cancel', value: false }] });
                if (!ok) return;
                await ws.busy(ask('xmradio_tape_delete', { name }), { delay: 300, timeout: 30000 });
                if (tapes.open === name) tapes.open = null;
            } else if (kind === 'load') {
                const d = await ask('xmradio_deck_set', { tape: name });
                tapes.deck = (d && d.deck) || tapes.deck;
            }
        } catch (err) { void box((err && err.message) || 'That did not work.'); }
        await loadTapes(true);
        if (ws) ws.refreshSoftKeys();
    }

    async function trackAction(kind, t) {
        if (!t) return;
        try {
            if (kind === 'rename') {
                const n = await ws.messageBox({ title: 'Rename', icon: null, text: 'New name:', input: { value: t.name.replace(/\.m4a$/i, ''), placeholder: '' }, buttons: [{ text: 'ok', value: true }, { text: 'Cancel', value: false }] });
                if (!n) return;
                await ws.busy(ask('xmradio_track_rename', { id: t.id, name: n }), { delay: 300, timeout: 30000 });
            } else if (kind === 'delete') {
                const ok = await ws.messageBox({ title: 'Delete', icon: 'warning', text: `Move "${t.name.replace(/\.m4a$/i, '')}" to the Recycle Bin?`, buttons: [{ text: 'Delete', value: true }, { text: 'Cancel', value: false }] });
                if (!ok) return;
                await ws.busy(ask('xmradio_track_delete', { id: t.id }), { delay: 300, timeout: 30000 });
            } else if (kind.startsWith('move:')) {
                await ws.busy(ask('xmradio_track_move', { id: t.id, tape: kind.slice(5) }), { delay: 300, timeout: 30000 });
                tapes.tracks[kind.slice(5)] = null;
            }
        } catch (err) { void box((err && err.message) || 'That did not work.'); }
        if (tapes.open) await loadTracks(tapes.open);
    }

    // ---------------------------------------------------------------- the program

    let tab = 'now'; // now | channels | recordings
    const TABS = [['now', 'Now Playing'], ['channels', 'Channels'], ['recordings', 'Recordings']];
    const mmss = (s) => { const v = Math.max(0, Math.floor(s)); return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`; };
    const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const sizeText = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

    function build() {
        page.innerHTML = `<div class="xrm-pane xrm-now-pane wm-pg-scroll" data-pane="now">
                <div class="xrm-np">
                    <div class="xrm-lcd"><div class="xr-radio is-on" data-docked="true"><div class="xr-bezel"><div class="xr-display" aria-live="polite">
                        <img class="xr-d-bg is-empty" data-f="bg" alt="" draggable="false"><i class="xrm-shade"></i>
                        <div class="xr-d-top"><span data-f="band"></span><span data-f="pre"></span><span class="xr-d-fill"></span><span data-f="replay"></span><span class="xr-sig" data-f="sig"><i></i><i></i><i></i></span><span data-f="clock"></span></div>
                        <div class="xr-d-main">
                            <img class="xr-d-art is-empty" data-f="art" alt="" draggable="false">
                            <div class="xr-d-text"><div class="xr-d-l1"><span class="xr-d-num" data-f="num"></span><span class="xr-d-name" data-f="name"></span></div><div class="xr-d-l2"><span class="xr-run" data-f="l2"></span></div><div class="xr-d-l3"><span class="xr-run" data-f="l3"></span></div></div>
                            <img class="xr-d-logo is-empty" data-f="logo" alt="" draggable="false">
                        </div>
                    </div></div></div></div>
                    <div class="xrm-np-bar"><i></i></div><div class="xrm-np-times"><span class="xrm-np-el"></span><span class="xrm-np-rem"></span></div>
                    <div class="xrm-np-keys">
                        <button type="button" data-k="prev" aria-label="Previous">&#x23EE;&#xFE0E;</button>
                        <button type="button" data-k="play" aria-label="Play or pause" class="is-big"></button>
                        <button type="button" data-k="next" aria-label="Next">&#x23ED;&#xFE0E;</button>
                        <button type="button" data-k="rec" aria-label="Record" class="xrm-np-rec">REC</button>
                    </div>
                </div>
                <div class="xrm-sec xrm-up"></div>
                <div class="xrm-sec xrm-played"></div>
            </div>
            <div class="xrm-pane" data-pane="channels" hidden><div class="xrm-head"><span class="xrm-show"></span><span class="xrm-count"></span></div><div class="xrm-list wm-pg-scroll" role="listbox"></div></div>
            <div class="xrm-pane xrm-rec-pane wm-pg-scroll" data-pane="recordings" hidden></div>
            <div class="wm-tabs" role="tablist">${TABS.map(([k, l]) => `<button type="button" class="wm-tab" role="tab" data-tab="${k}" aria-selected="${tab === k}">${l}</button>`).join('')}</div>`;
        const q = (s) => page.querySelector(s);
        if (!document.querySelector('link[data-xr-theme]')) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = '/css/themes/vista/xmradio.css';
            link.dataset.xrTheme = '1';
            document.head.appendChild(link);
        }
        const f = (n) => q(`.xrm-lcd [data-f="${n}"]`);
        els = {
            lcd: q('.xrm-lcd'), rad: q('.xrm-lcd .xr-radio'), bezel: q('.xrm-lcd .xr-bezel'),
            bg: f('bg'), band: f('band'), pre: f('pre'), replay: f('replay'), sig: f('sig'), clock: f('clock'),
            art: f('art'), num: f('num'), name: f('name'), l2: f('l2'), l3: f('l3'), logo: f('logo'),
            bar: q('.xrm-np-bar > i'), el: q('.xrm-np-el'), rem: q('.xrm-np-rem'),
            play: q('[data-k="play"]'), rec: q('[data-k="rec"]'), up: q('.xrm-up'), played: q('.xrm-played'),
            show: q('.xrm-show'), count: q('.xrm-count'), list: q('.xrm-list'), recPane: q('.xrm-rec-pane')
        };
        page.addEventListener('click', (e) => {
            const tb = e.target.closest('[data-tab]');
            if (tb) { setTab(tb.dataset.tab); return; }
            const k = e.target.closest('[data-k]');
            if (k) {
                const id = radio.channelId || prefs.channel;
                if (k.dataset.k === 'play') playPause();
                else if (k.dataset.k === 'prev') step(-1);
                else if (k.dataset.k === 'next') step(1);
                else if (k.dataset.k === 'rec') { const r = recOf(id); if (r) void stopRec(r); else void recordAsk(id); }
                return;
            }
            const row = e.target.closest('[data-id]');
            if (row && row.closest('.xrm-list')) { void tune(row.dataset.id); return; }
            const rs = e.target.closest('[data-rstop]');
            if (rs) { const r = (cache.rec || []).find((x) => x.rid === rs.dataset.rstop); if (r) void stopRec(r); return; }
            const tp = e.target.closest('[data-tape]');
            if (tp) { openTape(tp.dataset.tape); return; }
            const tr = e.target.closest('[data-track]');
            if (tr) {
                const list = tapes.tracks[tapes.open] || [];
                const i = list.findIndex((x) => x.id === tr.dataset.track);
                if (tapes.sel === tr.dataset.track || i < 0) { if (i >= 0) void playTrack(list, i); return; }
                tapes.sel = tr.dataset.track;
                render();
                if (ws) ws.refreshSoftKeys();
                return;
            }
            const back = e.target.closest('[data-back]');
            if (back) closeTape();
        });
    }

    function setTab(k) {
        if (!TABS.some((t) => t[0] === k)) return;
        tab = k;
        if (k === 'recordings') void loadTapes(false);
        if (k === 'now') void loadSchedule(radio.channelId || prefs.channel);
        render();
        if (ws) ws.refreshSoftKeys();
    }

    const setLcdImg = (img, src) => {
        img.classList.toggle('is-empty', !src);
        if (!src) { img.removeAttribute('src'); return; }
        if (img.getAttribute('src') !== src) img.src = src;
    };
    let lookKey = '';
    let lcdRo = null;
    /** The chosen receiver's screen: its display kind, the era's tint, its own size scaled to the phone's width. */
    function lookScreen() {
        const key = `${prefs.body}|${prefs.era}`;
        if (key !== lookKey) {
            lookKey = key;
            const r = els.rad;
            r.dataset.body = prefs.body;
            r.dataset.display = BODY_DISPLAY[prefs.body];
            r.dataset.era = prefs.era;
            const [w, h] = BODY_SCREEN[prefs.body];
            els.bezel.style.width = `${w}px`;
            els.bezel.style.height = `${h}px`;
            els.lcd.dataset.w = String(w);
            fitScreen();
        }
        if (!lcdRo && typeof ResizeObserver === 'function') {
            lcdRo = new ResizeObserver(() => fitScreen());
            lcdRo.observe(els.lcd);
        }
    }
    function fitScreen() {
        const w = Number(els.lcd.dataset.w) || 246;
        const avail = els.lcd.clientWidth;
        if (avail) els.rad.style.zoom = String(Math.round((avail / w) * 1000) / 1000);
    }

    const setImg = (img, src) => { if (!src) { img.hidden = true; img.removeAttribute('src'); return; } if (img.getAttribute('src') !== src) img.src = src; img.hidden = false; };
    const setText = (el, t) => { if (el.textContent !== t) el.textContent = t; };
    const setHtml = (el, h) => { if (el.dataset.h !== h) { el.dataset.h = h; el.innerHTML = h; } };

    function listIds() {
        if (prefs.show === 'all') return ((cache.lineup && cache.lineup.channels) || []).filter((c) => c.sub !== false).map((c) => c.id);
        return (cache.presets[prefs.show] || []).filter((id) => id && chan(id));
    }

    /** Where the song is: elapsed / remaining from its start and length (the programme), or the recording's place. */
    let progTimer = 0;
    function paintProgress() {
        clearTimeout(progTimer);
        if (!els || tab !== 'now' || !shown || !screenOn()) return;
        let el = 0;
        let dur = 0;
        if (radio.mode === 'track') {
            const a = radio.audio;
            if (a && !radio.native) { el = a.currentTime || 0; dur = Number.isFinite(a.duration) ? a.duration : 0; }
            else if (radio.startedAt) el = (Date.now() - radio.startedAt) / 1000;
        } else {
            const id = radio.channelId || prefs.channel;
            const now = nowOf(id);
            const s = sched.get(id);
            const cur = s && s.data && s.data.now && now && s.data.now.t === now.t ? s.data.now : null;
            const at = (cur && cur.at) || (now && now.at) || 0;
            dur = (cur && cur.dur) || 0;
            if (at) el = (Date.now() - at) / 1000;
            if (dur && el > dur) el = dur;
        }
        els.bar.style.width = dur ? `${Math.min(100, (el / dur) * 100).toFixed(1)}%` : '0%';
        setText(els.el, el ? mmss(el) : '');
        setText(els.rem, dur ? `-${mmss(dur - el)}` : '');
        // the clock moves once a second only while this tab is on screen with a time to show
        if (el && (radio.mode === 'track' ? radio.native : true)) progTimer = setTimeout(paintProgress, 1000 - (Date.now() % 1000) + 20);
    }

    function renderNow() {
        const id = radio.channelId || prefs.channel;
        const c = chan(id);
        const rec = recOf(id);
        const playing = radio.state === 'playing' || radio.state === 'tuning';
        const st = { off: 'Off', tuning: 'Tuning...', playing: 'Playing', paused: 'Paused', error: 'No signal' }[radio.state] || '';
        lookScreen();
        const scr = (o) => {
            // the receiver's screen, filled as the desktop radio's paint() fills it
            els.rad.dataset.state = { off: 'off', tuning: 'acquiring', playing: 'playing', paused: 'paused', error: 'nosignal' }[radio.state] || 'off';
            setText(els.num, o.num || '');
            setText(els.name, o.name || '');
            setText(els.l2, o.l2 || '');
            setText(els.l3, o.l3 || '');
            setText(els.replay, o.replay || '');
            setText(els.band, o.band || '');
            setText(els.pre, '');
            els.sig.dataset.bars = radio.state === 'playing' || radio.state === 'paused' ? '3' : radio.state === 'tuning' ? '1' : '0';
            const d = new Date();
            setText(els.clock, `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')}`);
            setLcdImg(els.art, o.art || '');
            setLcdImg(els.logo, o.logo || '');
            setLcdImg(els.bg, o.bg || '');
        };
        if (radio.mode !== 'track') { const cid = radio.channelId || prefs.channel; if (cid) void wantLogos([cid]); }
        if (radio.mode === 'track' && radio.track) {
            const m = /^(\d{4}-\d{2}-\d{2} \d{4}) (.*)$/.exec(radio.track.name);
            const rest = m ? m[2] : radio.track.name;
            const parts = rest.split(' - ');
            const tst = { tuning: 'LOADING', paused: 'PAUSED', error: 'CANNOT PLAY', off: 'STOPPED' }[radio.state];
            scr({ num: String(radio.track.i + 1), name: `TAPE ${radio.track.tape}`, l2: tst || (parts.length > 1 ? parts[0] : rest), l3: tst ? '' : (parts.length > 1 ? parts.slice(1).join(' - ') : ''), replay: 'TAPE' });
            els.rec.hidden = true;
            setHtml(els.up, '');
            const list = radio.track.list.slice(radio.track.i + 1, radio.track.i + 6);
            setHtml(els.played, list.length ? `<div class="xrm-sec-h">Up Next on the Tape</div>${list.map((t) => `<div class="xrm-sec-row"><span class="xrm-sec-t">${esc(t.name.replace(/\.m4a$/i, '').replace(/^\d{4}-\d{2}-\d{2} \d{4} /, ''))}</span></div>`).join('')}` : '');
        } else {
            const now = nowOf(id);
            const s = sched.get(id);
            const data = (s && s.data) || {};
            let l2 = now ? (now.ad ? 'SiriusXM' : now.a || '') : '';
            let l3 = now ? (now.ad ? 'Commercial' : now.t || '') : '';
            if (!c) { l2 = cache.lineup ? 'Choose a channel' : 'Channels loading'; l3 = ''; }
            else if (radio.state === 'tuning') { l2 = 'ACQUIRING SIGNAL'; l3 = ''; }
            else if (radio.state === 'error') { l2 = 'NO SIGNAL'; l3 = 'Check connection'; }
            const songArt = now && !now.ad && now.i ? now.i : '';
            const tft = BODY_DISPLAY[prefs.body] === 'tft';
            scr({
                num: c ? String(c.number || '') : '', name: c ? c.name : 'XM RADIO', l2, l3,
                replay: rec ? 'REC' : radio.state === 'paused' ? 'PAUSED' : '',
                band: prefs.show === 'all' ? '' : prefs.show,
                // the song's art (else the channel's logo) and the logo beside it; the channel's picture behind on colour
                art: songArt || (c && c.logo) || '', logo: songArt ? (c && c.logo) || '' : '',
                bg: tft && c && c.bg ? c.bg : ''
            });
            els.rec.hidden = !isAdmin() || !c;
            els.rec.classList.toggle('is-on', !!rec);
            setText(els.rec, rec ? 'STOP' : 'REC');
            // Up Next: the channel's shows to come (songs are known only once they air)
            const shows = (data.shows || []).filter((x) => !x.now).slice(0, 4);
            const onNow = (data.shows || []).find((x) => x.now);
            // SiriusXM names shows ahead only where it schedules them; otherwise the section is the show on now
            setHtml(els.up, (onNow || shows.length) ? `<div class="xrm-sec-h">${shows.length ? 'Up Next' : 'On Now'}</div>${onNow ? `<div class="xrm-sec-row is-now"><span class="xrm-sec-time">Now</span><span class="xrm-sec-t">${esc(onNow.show || onNow.name)}</span><span class="xrm-sec-s">until ${esc(clock(onNow.at + onNow.dur * 1000))}</span></div>` : ''}${shows.map((x) => `<div class="xrm-sec-row"><span class="xrm-sec-time">${esc(clock(x.at))}</span><span class="xrm-sec-t">${esc(x.show || x.name)}</span><span class="xrm-sec-s">${esc(x.show && x.name && x.name !== x.show ? x.name : '')}</span></div>`).join('')}` : '');
            const played = (data.played || []).slice(0, 8);
            setHtml(els.played, played.length ? `<div class="xrm-sec-h">Recently Played</div>${played.map((x) => `<div class="xrm-sec-row">${x.i ? `<span class="xrm-sec-pic"><img src="${esc(x.i)}" alt="" loading="lazy" draggable="false"></span>` : '<span class="xrm-sec-pic is-none"></span>'}<span class="xrm-sec-lines"><span class="xrm-sec-t">${esc(x.t)}</span><span class="xrm-sec-s">${esc(x.a)}</span></span><span class="xrm-sec-time">${esc(clock(x.at))}</span></div>`).join('')}` : '');
        }
        setText(els.play, playing ? (radio.native ? '⏹︎' : '⏸︎') : '▶︎');
        paintProgress();
    }

    let listKey = '';
    function renderChannels() {
        const id = radio.channelId || prefs.channel;
        setText(els.show, prefs.show === 'all' ? 'All Channels' : `Presets ${prefs.show}`);
        const ids = listIds();
        setText(els.count, String(ids.length));
        const key = JSON.stringify([ids, id, ids.map((x) => { const n = nowOf(x); const cc = chan(x); return [n && n.a, n && n.t, n && n.ad, cc && cc.logo, !!recOf(x)]; })]);
        if (key === listKey) return;
        listKey = key;
        els.list.innerHTML = ids.length ? ids.map((x) => {
            const cc = chan(x);
            const n = nowOf(x);
            const sub = n ? (n.ad ? 'Commercial' : [n.a, n.t].filter(Boolean).join(' - ')) : '';
            return `<div class="xrm-row${x === id ? ' is-current' : ''}" data-id="${esc(x)}" role="option"><span class="xrm-rlogo">${cc.logo ? `<img src="${esc(cc.logo)}" alt="" loading="lazy" draggable="false">` : `<b>${esc(cc.number)}</b>`}</span><span class="xrm-rlines"><span class="xrm-rname">${esc(chanLabel(cc))}${recOf(x) ? ' <i class="xrm-recdot">REC</i>' : ''}</span><span class="xrm-rsub">${esc(sub)}</span></span></div>`;
        }).join('') : `<div class="xrm-empty">${prefs.show === 'all' ? 'No channels yet.' : 'No presets in this bank. Menu > Add to Presets.'}</div>`;
        if (prefs.show !== 'all') void wantLogos(ids);
    }

    function renderRecordings() {
        const recs = cache.rec || [];
        const deckTape = tapes.deck && tapes.deck.tape;
        let h = '';
        if (recs.length) {
            h += `<div class="xrm-sec-h">Recording Now</div>${recs.map((r) => { const c = chan(r.channelId); const n = nowOf(r.channelId); return `<div class="xrm-sec-row is-rec"><span class="xrm-recdot">REC</span><span class="xrm-sec-lines"><span class="xrm-sec-t">${esc(chanLabel(c) || 'A channel')}</span><span class="xrm-sec-s">${esc(r.kind === 'song' ? 'This song' : r.kind === 'manual' ? 'Until stopped' : r.kind === 'timer' ? 'Timer' : 'Alert')}${n && !n.ad && n.t ? ` · ${esc(n.t)}` : ''} · since ${esc(clock(r.since))}</span></span><button type="button" class="xrm-sec-btn" data-rstop="${esc(r.rid)}">Stop</button></div>`; }).join('')}`;
        }
        if (tapes.open) {
            const list = tapes.tracks[tapes.open];
            h += `<div class="xrm-sec-h xrm-tape-h"><button type="button" class="xrm-back" data-back="1">&#x2039; Tapes</button><span>${esc(tapes.open)}${tapes.open === deckTape ? ' (in the deck)' : ''}</span></div>`;
            if (!list) h += '<div class="xrm-empty">Reading the tape...</div>';
            else if (!list.length) h += '<div class="xrm-empty">This tape is blank.</div>';
            else h += list.map((t) => {
                const playing = radio.mode === 'track' && radio.track && radio.track.id === t.id;
                // the file name is "<date> <time> <artist> - <title>": the song first, when it was recorded under it
                const m = /^(\d{4}-\d{2}-\d{2}) (\d{2})(\d{2}) (.*)$/.exec(t.name.replace(/\.m4a$/i, ''));
                const title = m ? m[4] : t.name.replace(/\.m4a$/i, '');
                const when = m ? `${m[1]} ${m[2]}:${m[3]} · ` : '';
                return `<div class="xrm-track${tapes.sel === t.id ? ' is-sel' : ''}${playing ? ' is-playing' : ''}" data-track="${esc(t.id)}"><span class="xrm-sec-lines"><span class="xrm-sec-t">${playing ? '&#x25B6;&#xFE0E; ' : ''}${esc(title)}</span><span class="xrm-sec-s">${esc(when + sizeText(t.size || 0))}</span></span></div>`;
            }).join('');
        } else {
            h += '<div class="xrm-sec-h">Tapes</div>';
            if (!tapes.list) h += `<div class="xrm-empty">${tapes.error ? esc(tapes.error) : 'Reading the tapes...'}</div>`;
            else if (!tapes.list.length) h += '<div class="xrm-empty">No tapes yet. Menu > New Tape, or record something.</div>';
            else h += tapes.list.map((n) => `<div class="xrm-tape" data-tape="${esc(n)}"><span class="xrm-tape-ic"></span><span class="xrm-sec-t">${esc(n)}</span><span class="xrm-sec-s">${n === deckTape ? 'In the deck' : ''}</span></div>`).join('');
        }
        setHtml(els.recPane, h);
    }

    function render() {
        if (!els) return;
        page.querySelectorAll('[data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== tab; });
        page.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
        if (tab === 'now') renderNow();
        else { clearTimeout(progTimer); if (tab === 'channels') renderChannels(); else renderRecordings(); }
    }

    function selTrack() { return (tapes.tracks[tapes.open] || []).find((t) => t.id === tapes.sel) || null; }

    function menu() {
        const playing = radio.state === 'playing' || radio.state === 'tuning';
        const id = radio.channelId || prefs.channel;
        const admin = isAdmin();
        if (tab === 'recordings') {
            const t = selTrack();
            const others = (tapes.list || []).filter((n) => n !== tapes.open);
            if (tapes.open) {
                return [
                    { label: 'Play', disabled: !t, action: () => { const list = tapes.tracks[tapes.open] || []; void playTrack(list, list.indexOf(t)); } },
                    { label: 'Play Tape', disabled: !(tapes.tracks[tapes.open] || []).length, action: () => { void playTrack(tapes.tracks[tapes.open], 0); } },
                    '-',
                    { label: 'Rename...', disabled: !t || !admin, action: () => { void trackAction('rename', t); } },
                    { label: 'Move to Tape', disabled: !t || !admin || !others.length, submenu: others.map((n) => ({ label: n, action: () => { void trackAction(`move:${n}`, t); } })) },
                    { label: 'Delete', disabled: !t || !admin, action: () => { void trackAction('delete', t); } },
                    '-',
                    { label: 'Load in Deck', disabled: !admin || (tapes.deck && tapes.deck.tape === tapes.open), action: () => { void tapeAction('load', tapes.open); } },
                    { label: 'Rename Tape...', disabled: !admin, action: () => { void tapeAction('rename', tapes.open); } },
                    { label: 'Delete Tape', disabled: !admin, action: () => { void tapeAction('delete', tapes.open); } }
                ];
            }
            return [
                { label: 'New Tape...', disabled: !admin, action: () => { void tapeAction('new'); } },
                { label: 'Refresh', action: () => { void loadTapes(true); } }
            ];
        }
        const slots = (bank) => Array.from({ length: 10 }, (_, i) => { const cur = chan((cache.presets[bank] || [])[i]); return { label: `${i + 1}${cur ? `  ${cur.number} ${cur.name}` : '  (empty)'}`, action: () => { void setPreset(bank, i); } }; });
        return [
            { label: playing ? (radio.native ? 'Stop' : 'Pause') : 'Play', action: playPause },
            { label: radio.mode === 'track' ? 'Next Recording' : 'Channel Up', action: () => step(1) },
            { label: radio.mode === 'track' ? 'Previous Recording' : 'Channel Down', action: () => step(-1) },
            '-',
            { label: 'Record This Song...', disabled: !id || !admin, action: () => { void recordAsk(id); } },
            { label: 'Record Channel...', disabled: !id || !admin || !!recOf(id), action: () => { void recordChannel(id); } },
            { label: 'Alert', disabled: !admin, submenu: [{ label: 'This Artist', action: () => { void setAlert('artist'); } }, { label: 'This Song', action: () => { void setAlert('song'); } }] },
            '-',
            { label: 'Show', submenu: [['A', 'Presets A'], ['B', 'Presets B'], ['C', 'Presets C'], ['all', 'All Channels']].map(([v, t]) => ({ label: t, radio: prefs.show === v, action: () => { prefs.show = v; saveSoon(); setTab('channels'); } })) },
            { label: 'Direct Tune...', action: () => { void directTune(); } },
            { label: 'Add to Presets', disabled: !id || !admin, submenu: ['A', 'B', 'C'].map((b) => ({ label: `Bank ${b}`, submenu: slots(b) })) },
            { label: 'Radio', submenu: BODIES.map(([v, t]) => ({ label: t, radio: prefs.body === v, action: () => { prefs.body = v; saveSoon(); render(); } })) },
            { label: 'Brand', submenu: ERAS.map(([v, t]) => ({ label: t, radio: prefs.era === v, action: () => { prefs.era = v; saveSoon(); render(); } })) },
            { label: 'Quality', submenu: QUALITIES.map(([v, t]) => ({ label: t, radio: prefs.quality === v, action: () => { prefs.quality = v; saveSoon(); if (radio.mode === 'live' && radio.channelId && radio.state !== 'off') void tune(radio.channelId); } })) },
            '-',
            { label: 'Refresh Lineup', action: () => { lineupAsked = false; void loadLineup(true); } },
            { label: 'Stop Radio', disabled: radio.state === 'off', action: stopRadio }
        ];
    }

    const APP = {
        id: APP_ID,
        title: TITLE,
        icon: 'app-xmradio',
        art65: 'xmradio',
        inStart: 'programs',
        mount(p) {
            page = p;
            p.classList.add('wm-xmradio');
            build();
        },
        show() {
            shown = true;
            if (!wired) wire();
            if (!cache.lineup) void loadLineup(false);
            if (tab === 'now') void loadSchedule(radio.channelId || prefs.channel);
            if (tab === 'recordings') void loadTapes(false);
            render();
            void syncHub();
        },
        hide() {
            shown = false;
            clearTimeout(progTimer);
            void syncHub();
        },
        softKeys() {
            const id = radio.channelId || prefs.channel;
            if (tab === 'recordings') {
                if (tapes.open) return { left: { label: tapes.sel ? 'Play' : 'Back', action: () => { if (tapes.sel) { const list = tapes.tracks[tapes.open] || []; const t = selTrack(); void playTrack(list, list.indexOf(t)); } else closeTape(); } }, right: { label: 'Menu', menu } };
                return { left: { label: 'New Tape', disabled: !isAdmin(), action: () => { void tapeAction('new'); } }, right: { label: 'Menu', menu } };
            }
            return { left: recKey(id), right: { label: 'Menu', menu } };
        },
        onBack() {
            if (tab === 'recordings' && tapes.open) { closeTape(); return true; }
            return false;
        }
    };

    // ---------------------------------------------------------------- Today (6.1 block, 6.5 panel)

    let todayHtml = '';
    let todayDir = '';

    function todayPageId() {
        const ids = todayChannels();
        if (!ids.length) return '';
        if (prefs.todayAt >= ids.length || prefs.todayAt < 0) prefs.todayAt = 0;
        return ids[prefs.todayAt];
    }

    function todayStep(d) {
        const n = todayChannels().length;
        if (n < 2) return;
        prefs.todayAt = (prefs.todayAt + d + n) % n;
        todayDir = d > 0 ? 'r' : 'l';
        saveSoon();
        changed();
    }

    function openChannel(id) {
        if (ws) ws.open(APP_ID);
        if (id && id !== radio.channelId) void tune(id);
        else if (radio.state === 'off') playPause();
    }

    function bindToday(el) {
        el.dataset.xrmBound = '1';
        el.classList.add('wtw', 'xrm-today');
        let down = null;
        let swiped = 0;
        const slide = () => el.querySelector('.xrm-td-slide');
        el.addEventListener('pointerdown', (e) => {
            if (e.button || e.target.closest('.xrm-td-arrow, .xrm-td-rec')) return;
            down = { x: e.clientX, y: e.clientY, id: e.pointerId, on: false };
        });
        el.addEventListener('pointermove', (e) => {
            if (!down || e.pointerId !== down.id) return;
            const dx = e.clientX - down.x;
            if (!down.on) {
                if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(e.clientY - down.y) * 1.3 || todayChannels().length < 2) return;
                down.on = true;
                try { el.setPointerCapture(e.pointerId); } catch (_) { /* a synthetic pointer */ }
            }
            const s = slide();
            if (s) { s.classList.remove('is-back', 'is-in-l', 'is-in-r'); s.style.transform = `translateX(${dx}px)`; }
        });
        const up = (e) => {
            if (!down || e.pointerId !== down.id) return;
            const dx = e.clientX - down.x;
            const on = down.on;
            down = null;
            if (!on) return;
            swiped = Date.now();
            const s = slide();
            if (e.type !== 'pointercancel' && Math.abs(dx) > Math.min(60, el.clientWidth * 0.2)) { todayStep(dx < 0 ? 1 : -1); return; }
            if (s) { s.classList.add('is-back'); s.style.transform = ''; }
        };
        el.addEventListener('pointerup', up);
        el.addEventListener('pointercancel', up);
        el.addEventListener('click', (e) => {
            if (Date.now() - swiped < 350) { e.stopPropagation(); return; }
            const a = e.target.closest('.xrm-td-arrow');
            if (a) { e.stopPropagation(); todayStep(a.dataset.dir === 'next' ? 1 : -1); return; }
            const r = e.target.closest('.xrm-td-rec');
            if (r) { e.stopPropagation(); void recordAsk(todayPageId()); return; }
            openChannel(todayPageId());
        });
    }

    function todayRender(el) {
        if (!canUse()) return false;
        todayPlaced = true;
        if (!wired) wire();
        if (!hubOn) void syncHub();
        if (!cache.lineup) void loadLineup(false);
        if (!el.dataset.xrmBound) bindToday(el);
        if (el.getAttribute('role') !== 'button') el.setAttribute('role', 'button');
        if (el.tabIndex !== 0) el.tabIndex = 0;
        const ids = todayChannels();
        const id = todayPageId();
        const c = chan(id);
        let inner;
        if (c) {
            const now = nowOf(id);
            const pic = now && !now.ad && now.i ? now.i : c.logo;
            const playing = id === radio.channelId && radio.state === 'playing';
            inner = `<span class="xrm-td-pic">${pic ? `<img src="${esc(pic)}" alt="" decoding="async" draggable="false">` : `<b>${esc(c.number)}</b>`}</span><span class="wtw-lines"><span class="wtw-title">${esc(now ? (now.ad ? 'Commercial' : now.t || c.name) : c.name)}</span><span class="wtw-sub">${esc(now && !now.ad && now.a ? now.a : '')}</span><span class="wtw-sub">${esc(chanLabel(c))}${playing ? ' · Playing' : ''}</span></span>`;
        } else {
            inner = `<img class="xrm-td-icon" src="${ws.art.url('app-xmradio-lg')}" srcset="${ws.art.srcset('app-xmradio-lg')}" alt="" draggable="false"><span class="wtw-lines"><span class="wtw-title">XM Radio</span><span class="wtw-sub">${esc(cache.lineup ? 'Tap to choose a channel' : 'Reading the channels...')}</span></span>`;
        }
        const many = ids.length > 1;
        const rec = !!(id && recOf(id));
        const recBtn = c && isAdmin() ? `<button type="button" class="xrm-td-rec${rec ? ' is-rec' : ''}" aria-label="${rec ? 'Recording: stop' : 'Record'}">${rec ? 'REC' : 'Record'}</button>` : '';
        const html = `<button type="button" class="xrm-td-arrow" data-dir="prev" aria-label="Previous channel"${many ? '' : ' disabled'}>&#x2039;</button><div class="xrm-td-slide">${inner}</div>${recBtn}<button type="button" class="xrm-td-arrow" data-dir="next" aria-label="Next channel"${many ? '' : ' disabled'}>&#x203A;</button>`;
        if (html !== todayHtml || !el.firstChild) {
            todayHtml = html;
            el.innerHTML = html;
            if (todayDir) { const s = el.querySelector('.xrm-td-slide'); if (s) s.classList.add(todayDir === 'r' ? 'is-in-r' : 'is-in-l'); todayDir = ''; }
        }
        return true;
    }

    function todayTitanium() {
        if (!canUse()) return null;
        todayPlaced = true;
        if (!wired) wire();
        if (!hubOn) void syncHub();
        if (!cache.lineup) void loadLineup(false);
        const ids = todayChannels();
        const go = () => openChannel(radio.channelId || prefs.channel);
        if (!ids.length) {
            return { label: 'xm radio', icon: 'x:app-xmradio-lg', pages: [{ title: 'XM Radio', line2: cache.lineup ? 'Tap to choose a channel' : 'Reading the channels...', line3: '' }], softKey: { label: 'Radio', action: go }, onTap: go };
        }
        // the superscript by the panel's name (Yukimi, Nov 20 2026): "rec" while a recording runs, else the current
        // channel's number
        const cur = chan(radio.channelId || prefs.channel);
        return {
            label: 'xm radio',
            count: (cache.rec || []).length ? 'rec' : cur ? String(cur.number) : '',
            icon: 'x:app-xmradio-lg',
            pages: ids.map((id) => {
                const c = chan(id);
                const now = nowOf(id);
                const pic = now && !now.ad && now.i ? now.i : c.logo;
                const playing = id === radio.channelId && radio.state === 'playing';
                return {
                    image: pic || undefined,
                    imageAspect: 1,
                    title: now ? (now.ad ? 'Commercial' : now.t || c.name) : c.name,
                    line2: now && !now.ad ? now.a || '' : '',
                    line3: `${chanLabel(c)}${playing ? ' · Playing' : ''}`,
                    softKey: recKey(id),
                    onTap: () => openChannel(id)
                };
            }),
            softKey: recKey(todayPageId()),
            onTap: go
        };
    }

    // ---------------------------------------------------------------- wiring

    function wire() {
        const c = window.wsClient;
        if (wired || !c || typeof c.on !== 'function') return !!wired;
        wired = true;
        c.on('xmradio_phone_status', (msg) => { if (hubOn && msg) applyHub(msg.changed || (msg.data && msg.data.changed)); }, { signal: appScopeSignal });
        // the server forgets a dropped socket's subscriptions and watched channels: tell it again
        c.on('connected', () => { hubOn = false; watchSaid = ''; void syncHub(); }, { signal: appScopeSignal });
        document.addEventListener('wmAppChange', () => { void syncHub(); }, { signal: appScopeSignal });
        document.addEventListener('visibilitychange', () => { void syncHub(); }, { signal: appScopeSignal });
        window.addEventListener('melatonscreen', () => { void syncHub(); }, { signal: appScopeSignal });
        // the native player's news (DSApp): stopped from its notification, or the stream ended
        window.addEventListener('dreamscape:videos', (e) => {
            let d = e.detail;
            if (typeof d === 'string') { try { d = JSON.parse(d); } catch (_) { d = null; } }
            if (!radio.native || !d) return;
            if (d.state === 'stopped' || d.state === 'ended' || d.state === 'lost') { radio.native = false; radio.state = 'off'; changed(); }
        }, { signal: appScopeSignal });
        void syncHub();
        return true;
    }

    function register() {
        ws = window.wmShell;
        if (!ws) return;
        ws.registerApp(APP);
        if (typeof ws.registerTodayItem === 'function') {
            ws.registerTodayItem({ id: 'xmradio', label: 'XM Radio', icon: 'app-xmradio', after: 'youtube', render: todayRender, titanium: todayTitanium });
        }
        if (!wire()) window.addEventListener('load', () => { wire(); }, { once: true, signal: appScopeSignal });
    }

    if (window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
