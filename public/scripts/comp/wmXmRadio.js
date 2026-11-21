/**
 * Melaton Mobile: XM Radio (Yozora #989), the phone's side of the desktop's SiriusXM radio (apps/xmradio).
 *
 * Yukimi, Nov 20 2026: a Today item and Titanium panel showing what is on air as left / right pages, with one-touch
 * Record that always asks whether to record from the start; then a large Now Playing with up next and recording
 * controls, playing and managing recordings, the receivers' own LCD design, and (asked as "add them all") replay,
 * gestures, lock-screen controls, data-aware quality, a Channel Guide, search, the cassette deck, Save to Phone,
 * lengths, the faceplate, a sleep timer, wake to radio and controls on Today.
 *
 *   Today (6.1 block, 6.5 panel)  a page per channel (the one the phone plays, then preset bank A), turned left /
 *                     right; what is on air; play / pause and Record on the block; on the 6.5 panel the soft key is
 *                     Record (REC while it records), tap-and-hold has Play / Pause, Channel Up / Down, Record. The
 *                     panel's superscript is the channel's number, or "rec" while a recording runs.
 *   Now Playing       the chosen receiver's screen (the desktop's display and theme: Menu > Radio, Brand), or its whole
 *                     faceplate with working keys (Menu > View > Faceplate, or the phone turned sideways). A swipe on
 *                     the screen changes channel, a tap changes what its lines show (song / channel / show). Under it:
 *                     the song's progress, the last hour (a tap plays from there), previous song / play / next song /
 *                     LIVE / REC, On Now or Up Next (the shows SiriusXM schedules), Recently Played (a tap plays that
 *                     song from its start: the stream keeps five hours).
 *   Channels          presets A / B / C, the Channel Guide by genre, all channels, or a search of what is on now.
 *   Recordings        Recording Now (Stop), the tapes with their counts and lengths, a tape's recordings with their
 *                     lengths: play, Save to Phone, rename, move, delete; tapes: new, rename, delete, load in the deck.
 *   Deck              the desktop's cassette deck (the theme's deck rules also match .xrm-deckwrap): REC records the
 *                     channel, PLAY plays the tape in the deck, REW / FF, STOP / EJECT, the SPLIT switch; under it
 *                     Timer Recording: scheduled recordings, alerts, search terms.
 *
 * Sound: the Dreamscape app's native player (window.AndroidVideos, DSApp videos/VideoPlayback.kt) plays the stream as
 * sound only, so it carries on with the screen off. It has the channel list (its notification's and the headset's
 * next / previous change channel with the page asleep), reads the song on air for its notification itself, runs the
 * sleep timer, and saves recordings to the phone (AndroidVideos.saveRecording). An alarm whose sound is a channel
 * plays the radio in the app (DeviceNotices.kt); with the page in front wmLock65.js sends 'xmradio:alarm'. Without the
 * app the page plays with hls.js, on Android's media notification through navigator.mediaSession. Quality Automatic
 * is High on Wi-Fi and Economy on a phone network.
 *
 * Data: statusHub feed `xmradio_phone` (presets and the channels this phone shows only; modules/xmRadio.js), joined
 * while Today shows this item or the program is on screen, with the screen on (never polled). Everything shown is kept
 * on the phone (localStorage wmXmRadioCache), so Today draws at once at start-up with no server wait
 * (installed-boot-zero-wait); the lineup is read once a month (or when the server's lineup moves).
 *
 * Art: wm61/app-xmradio*, wm65/start-xmradio*, ti-x-app-xmradio-lg* (scripts/generate-wm-xmradio-art.js). Styles:
 * public/css/wm-xmradio.css. Phones only; the account is the administrator's (dev_admin test tabs listen).
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
    const ASSETS = '/melaton-apps/xmradio/assets';
    // auto (Yukimi, Nov 20 2026: data-aware): High on Wi-Fi, Economy on a phone network
    const QUALITIES = [['auto', 'Automatic (Wi-Fi High, cellular Economy)'], ['hi', 'High (256k)'], ['std', 'Standard (128k)'], ['low', 'Low (32k)'], ['eco24', 'Economy (24k)'], ['eco16', 'Economy (16k)']];
    const SLEEP = [0, 15, 30, 45, 60, 90, 120];
    // the native player starts 20 s behind live (its reserve); replay adds the distance asked for
    const NATIVE_RESERVE = 20;
    const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    const canUse = () => { try { return /^(admin|dev_admin)$/.test(localStorage.getItem('userType') || ''); } catch (_) { return false; } };
    const isAdmin = () => { try { return localStorage.getItem('userType') === 'admin'; } catch (_) { return false; } };
    const client = () => (window.wsClient && (!window.wsClient.isConnected || window.wsClient.isConnected()) ? window.wsClient : null);
    const screenOn = () => !document.hidden && document.documentElement.dataset.screenOff === undefined;
    const nativePlayer = () => (window.AndroidVideos && typeof window.AndroidVideos.watching === 'function' ? window.AndroidVideos : null);

    function readJson(key, fallback) {
        try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v && typeof v === 'object' ? v : fallback; } catch (_) { return fallback; }
    }
    const prefs = Object.assign({ channel: '', quality: 'auto', show: 'A', todayAt: 0, body: 'gloss', era: 'xm', info: 'song', view: 'screen', saved: {} }, readJson(LS_PREFS, {}));
    // Now Playing is the receiver's own screen (Yukimi, Nov 20 2026: "It should share the same LCD design"): the desktop
    // radio's display markup and theme (public/css/themes/vista/xmradio.css, whose rules also match .xrm-lcd), one of
    // the docked receivers' screens at its own size, scaled to the phone's width; View > Faceplate (or the phone turned
    // sideways) shows the whole receiver, its keys working
    const BODIES = [['gloss', 'Gloss'], ['onyxplus', 'Onyx Plus'], ['onyxez', 'Onyx EZ'], ['stratus', 'Stratus'], ['roady', 'Roady XT']];
    const BODY_DISPLAY = { gloss: 'tft', onyxplus: 'tft', onyxez: 'lcd', stratus: 'lcd', roady: 'dotlcd' };
    const BODY_SCREEN = { gloss: [246, 184], onyxplus: [274, 194], onyxez: [236, 180], stratus: [372, 94], roady: [340, 152] };
    const NATURAL_W = { gloss: 560, onyxplus: 560, onyxez: 560, stratus: 560, roady: 520 };
    const ERAS = [['xm', 'XM'], ['sirius', 'Sirius'], ['sxm2011', 'SiriusXM (2011)'], ['sxm2023', 'SiriusXM (2023)']];
    const INFO = ['song', 'channel', 'show'];
    if (!BODY_SCREEN[prefs.body]) prefs.body = 'gloss';
    if (!ERAS.some((e) => e[0] === prefs.era)) prefs.era = 'xm';
    if (!QUALITIES.some((q) => q[0] === prefs.quality)) prefs.quality = 'auto';
    if (!INFO.includes(prefs.info)) prefs.info = 'song';
    if (!prefs.saved || typeof prefs.saved !== 'object') prefs.saved = {};
    // what Today and the program draw from, kept on the phone: { lineup: { at, channels }, presets, now: { id: cut }, rec: [], genres }
    const cache = Object.assign({ lineup: null, presets: { A: [], B: [], C: [] }, now: {}, rec: [], signedIn: false, genres: {} }, readJson(LS_CACHE, {}));
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
    let guideN = -1;
    const logoAsked = new Set();
    // the radio: state 'off' | 'tuning' | 'playing' | 'paused' | 'error'; back: seconds behind live it was started at
    const radio = { channelId: '', state: 'off', native: false, url: '', hls: null, audio: null, seq: 0, mode: 'live', track: null, startedAt: 0, back: 0, tuneAt: 0, prevId: '', alarm: false };
    const sleep = { at: 0, timer: 0 };

    function indexLineup() { byId = new Map(((cache.lineup && cache.lineup.channels) || []).map((c) => [c.id, c])); }
    indexLineup();
    const chan = (id) => byId.get(id) || null;
    const chanLabel = (c) => (c ? `${c.number} ${c.name}` : '');
    const nowOf = (id) => cache.now[id] || null;
    const recOf = (id) => (cache.rec || []).find((r) => r.channelId === id) || null;
    const curId = () => radio.channelId || prefs.channel;
    const mmss = (s) => { const v = Math.max(0, Math.floor(s)); return v >= 3600 ? `${Math.floor(v / 3600)}:${String(Math.floor(v / 60) % 60).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}` : `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`; };
    const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const sizeText = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

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
    const input = (title, text, value) => ws.messageBox({ title, icon: null, text, input: { value: value || '', placeholder: '' }, buttons: [{ text: 'ok', value: true }, { text: 'Cancel', value: false }] });

    // ---------------------------------------------------------------- the feed

    /** The radio is tuned to this channel and playing it (Today's first page, its superscript). */
    const onAir = (id) => !!id && id === radio.channelId && (radio.state === 'playing' || radio.state === 'tuning');

    /**
     * Today's pages (Yukimi, Nov 21 2026): the channel playing now first, then every preset in its order (banks A, B,
     * C); a playing channel that is also a preset moves up from its place instead of showing twice.
     */
    function todayChannels() {
        const out = [];
        const add = (id) => { if (id && chan(id) && !out.includes(id)) out.push(id); };
        if (onAir(radio.channelId)) add(radio.channelId);
        ['A', 'B', 'C'].forEach((b) => (cache.presets[b] || []).forEach(add));
        if (!out.length) add(curId());
        if (!out.length) (cache.lineup && cache.lineup.channels || []).filter((c) => c.sub !== false).slice(0, 3).forEach((c) => add(c.id));
        return out;
    }

    // Settings > Today > Items > Options... (Yukimi, Nov 21 2026): check boxes; the stored value lists the unchecked
    const TODAY_OPTS = [['direct', 'Direct Tune without Launch'], ['recsong', 'Record button records this single Song or Show from start']];
    function todayOpt(key) {
        const v = ws && typeof ws.todayOption === 'function' ? ws.todayOption('xmradio', 'today') : null;
        const unchecked = String(v == null ? TODAY_OPTS.map((o) => o[0]).join(',') : v).split(',');
        return !unchecked.includes(key);
    }

    /**
     * A channel's Today panel icon (Yukimi, Nov 21 2026: cropped, optimised, with its reflection like other apps, cached):
     * the server's drawing of the logo (/api/xmradio/tiicon, made once, kept a year), from the logo's own address.
     */
    function tiIconOf(c) {
        if (!c) return '';
        if (c.tiIcon) return c.tiIcon;
        if (!c.logo) return '';
        let u = null;
        try { u = new URL(c.logo, location.href); } catch (_) { return ''; }
        const k = u.searchParams.get('k');
        if (!k) return '';
        const w = Number(u.searchParams.get('s')) || 240;
        const h = Number(u.searchParams.get('h')) || w;
        return `/api/xmradio/tiicon?k=${encodeURIComponent(k)}&a=${Math.round((w / h) * 1000) / 1000}&x=4&v=1`;
    }
    // the next and previous pages' icons, read once ahead so a page turn shows its logo at once
    const tiWarm = new Set();
    function warmTiIcons(ids, at) {
        if (!ids.length) return;
        [at, at + 1, at - 1].map((i) => ids[(i + ids.length) % ids.length]).forEach((id) => {
            const url = tiIconOf(chan(id));
            if (!url || tiWarm.has(url)) return;
            tiWarm.add(url);
            const img = new Image();
            img.decoding = 'async';
            img.src = url;
        });
    }

    /** A tap on a Today page: tune it here (Direct Tune without Launch) or open the radio on it. */
    function todayTap(id) {
        if (!id) return;
        if (todayOpt('direct')) { if (!onAir(id)) void tune(id); return; }
        openChannel(id);
    }

    /** Today's Record: the song or show from its start at once (the item's option), else the question; stops a recording. */
    function todayRecord(id) {
        if (!id) return;
        if (!recOf(id) && todayOpt('recsong') && isAdmin()) { void recStart(id, { song: true, fromStart: true }); return; }
        void recordAsk(id);
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

    /** The channels the server sends this phone beyond the presets (the one it plays, Today's pages, a search's). */
    function tellWatch() {
        const list = [curId()].concat(todayChannels(), search.ids.slice(0, 4)).filter(Boolean);
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
            else if (k === 'guide') { if (v && v.n !== guideN) { guideN = v.n; if (shown && tab === 'channels' && prefs.show === 'guide') void loadGuide(); } }
            else if (k === 'rec') { const was = (cache.rec || []).length; cache.rec = Array.isArray(v) ? v : []; if (cache.rec.length < was) tapes.stale = true; }
            else if (k.startsWith('ch:')) { if (v) cache.now[k.slice(3)] = v; else delete cache.now[k.slice(3)]; }
            // the banks as the server keeps them (stored on any client): Today's pages follow at once
            else if (k === 'presets') { if (v && typeof v === 'object') { cache.presets = Object.assign({ A: [], B: [], C: [] }, v); tellWatch(); } }
        }
        saveSoon();
        // the song changed on the channel shown: its programme (recently played, the song's length) is read again
        if (shown && tab === 'now' && radio.mode === 'live') void loadSchedule(curId());
        if (shown && (tab === 'recordings' || tab === 'deck') && tapes.stale) void loadTapes(false);
        if (lineupMoved || !cache.lineup || Date.now() - (cache.lineup.at || 0) > LINEUP_MS) void loadLineup(lineupMoved);
        mediaMeta();
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

    /** The quality to tune at: the chosen one, or Automatic's by the phone's network now. */
    function quality() {
        if (prefs.quality !== 'auto') return prefs.quality;
        const c = navigator.connection;
        const type = c && c.type;
        if (type === 'cellular') return 'eco24';
        if (type === 'wifi' || type === 'ethernet') return 'hi';
        // no type: a slow link reads as Economy, otherwise Standard
        return c && /^(slow-2g|2g|3g)$/.test(c.effectiveType || '') ? 'eco24' : 'std';
    }

    /** The channels next / previous go through (the native player's list too): the list shown, else the whole plan. */
    function stepList() {
        const ids = listIds().filter((id) => chan(id) && chan(id).sub !== false);
        if (ids.length >= 2) return ids;
        return ((cache.lineup && cache.lineup.channels) || []).filter((c) => c.sub !== false).map((c) => c.id);
    }

    async function tune(id, { back = 0 } = {}) {
        const c = chan(id);
        if (!c) return;
        if (c.sub === false) { void box(`${chanLabel(c)} is not in your SiriusXM plan.`, 'info'); return; }
        if (radio.channelId && radio.channelId !== id) radio.prevId = radio.channelId;
        radio.mode = 'live';
        radio.track = null;
        radio.channelId = id;
        radio.back = Math.max(0, Math.round(back));
        prefs.channel = id;
        saveSoon();
        radio.state = 'tuning';
        const seq = ++radio.seq;
        changed();
        tellWatch();
        void loadSchedule(id);
        let r;
        try {
            r = await ask('xmradio_tune', { channelId: id, quality: quality(), back: radio.back }, 30000);
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
        radio.tuneAt = Date.now();
        const now = nowOf(id);
        const list = stepList();
        const at = Math.max(0, list.indexOf(id));
        // the native player's own list: next / previous on its notification and headset change channel with the page asleep
        const native = { channels: list.slice(Math.max(0, at - 60), at + 60).map((x) => ({ id: x, title: chanLabel(chan(x)) })), q: quality(), back: radio.back };
        native.index = native.channels.findIndex((x) => x.id === id);
        await start(seq, { title: chanLabel(c), subtitle: now && !now.ad ? [now.a, now.t].filter(Boolean).join(' - ') : 'SiriusXM', live: true, native });
    }

    /** A recording from a tape: { id, name, tape } of the list `list`, at index i. */
    async function playTrack(list, i) {
        const t = list[i];
        if (!t) { stopRadio(); return; }
        radio.mode = 'track';
        radio.track = { list, i, id: t.id, name: t.name.replace(/\.m4a$/i, ''), tape: t.tape, dur: t.dur || 0 };
        radio.url = new URL(`/api/xmradio/track/${encodeURIComponent(t.id)}`, location.origin).toString();
        radio.state = 'tuning';
        const seq = ++radio.seq;
        // the tab it was played from stays (Yukimi, Nov 21 2026: the deck's transport jumped to Now Playing)
        changed();
        await start(seq, { title: radio.track.name, subtitle: `Tape: ${t.tape}`, live: false });
    }

    /**
     * The native player when the app takes the address (sound only: it carries on with the screen off), else the
     * page's own: hls.js for a channel, the audio element for a recording.
     */
    async function start(seq, { title, subtitle, live, native }) {
        dropPage();
        dropNative();
        const nv = nativePlayer();
        if (nv) {
            try {
                nv.watching(JSON.stringify(Object.assign({ url: radio.url, title, subtitle, audioOnly: true }, native ? { radio: native } : {})));
                radio.native = nv.handOff() === true;
            } catch (_) { radio.native = false; }
            if (radio.native) {
                radio.state = 'playing';
                radio.startedAt = Date.now();
                // the sleep timer moves to the player that now plays
                if (sleep.at > Date.now()) { try { nv.sleep(Math.ceil((sleep.at - Date.now()) / 60000)); } catch (_) { /* older app */ } }
                changed();
                return;
            }
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
                // the playlist's own start (#EXT-X-START: replay) decides where it begins
                const h = new Hls({ liveSyncDurationCount: 3, maxBufferLength: 30, backBufferLength: 600, enableWorker: true, startPosition: -1 });
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
        pageMediaSession();
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
            const id = curId() || todayChannels()[0];
            if (id) void tune(id, { back: radio.back });
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
        setSleep(0, true);
        changed();
    }

    /** Channel up / down through the list shown (live); the next / previous recording on a tape. */
    function step(dir) {
        if (radio.mode === 'track' && radio.track) {
            const a = radio.audio;
            if (dir < 0 && !radio.native && a && a.currentTime > 4) { a.currentTime = 0; return; }
            void playTrack(radio.track.list, Math.max(0, radio.track.i + dir));
            return;
        }
        const list = stepList();
        if (!list.length) return;
        const i = list.indexOf(curId());
        const n = list.length;
        void tune(list[((i < 0 ? 0 : i + dir) % n + n) % n]);
    }

    // ---------------------------------------------------------------- replay (the stream keeps five hours)

    /** The instant the radio plays (ms, the broadcast's clock); null for a recording. */
    function posTime() {
        if (radio.mode !== 'live' || radio.state === 'off') return null;
        const h = radio.hls;
        if (h && !radio.native && h.playingDate instanceof Date && !Number.isNaN(h.playingDate.getTime())) return h.playingDate.getTime();
        return Date.now() - (radio.back + NATIVE_RESERVE) * 1000;
    }
    /** How far behind live (s); under half a minute counts as live. */
    function behind() { const t = posTime(); return t == null ? 0 : Math.max(0, (Date.now() - t) / 1000); }
    const replaying = () => radio.mode === 'live' && radio.back > 20;

    /** The channel's songs we know, oldest first (the programme: played, then now). */
    function songs(id) {
        const s = sched.get(id);
        const d = (s && s.data) || {};
        const list = (d.played || []).slice().reverse();
        if (d.now) list.push(d.now);
        return list;
    }

    /** The song at an instant: from the programme while replaying, the feed's at live. */
    function songAt(id, t) {
        if (!replaying() || t == null) {
            const n = nowOf(id);
            const s = songs(id);
            const cur = s.length && n && s[s.length - 1].t === n.t ? s[s.length - 1] : null;
            return n ? Object.assign({}, n, cur ? { dur: cur.dur, i: n.i || cur.i } : {}) : null;
        }
        const list = songs(id);
        let found = null;
        for (const x of list) if (x.at <= t) found = x;
        return found;
    }

    /** Play from a moment (a song's start): the stream tuned that far behind live. */
    function jumpTo(at) {
        const id = curId();
        if (!id || !at) return;
        const back = Math.max(0, (Date.now() - at) / 1000 - NATIVE_RESERVE + 2);
        void tune(id, { back: back < 25 ? 0 : back });
    }

    function goLive() { const id = curId(); if (id) void tune(id, { back: 0 }); }

    /** Previous: the start of this song, or (within its first five seconds) the one before. */
    function prevSong() {
        if (radio.mode === 'track') { step(-1); return; }
        const id = curId();
        const t = posTime();
        const list = songs(id);
        const cur = songAt(id, t == null ? Date.now() : t);
        if (!cur) return;
        const k = list.findIndex((x) => x.at === cur.at);
        if (t != null && t - cur.at > 5000) { jumpTo(cur.at); return; }
        const before = k > 0 ? list[k - 1] : null;
        if (before) jumpTo(before.at); else jumpTo(cur.at);
    }

    /** Next: the song after this one while replaying; at live there is none to go to. */
    function nextSong() {
        if (radio.mode === 'track') { step(1); return; }
        if (!replaying()) return;
        const id = curId();
        const t = posTime();
        const list = songs(id);
        const next = list.find((x) => x.at > (t || 0) + 1000);
        if (next && Date.now() - next.at > 45000) jumpTo(next.at); else goLive();
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
            mediaMeta();
        } catch (_) { /* the panel shows what the feed has */ }
    }

    // ---------------------------------------------------------------- the phone's own media controls (page player)

    /** The page's player on Android's media notification: the song, and next / previous for channel up / down. */
    function pageMediaSession() {
        const ms = navigator.mediaSession;
        if (!ms) return;
        try {
            ms.setActionHandler('nexttrack', () => step(1));
            ms.setActionHandler('previoustrack', () => step(-1));
            ms.setActionHandler('play', () => playPause());
            ms.setActionHandler('pause', () => playPause());
        } catch (_) { /* not all actions */ }
        mediaMeta();
    }
    let metaKey = '';
    function mediaMeta() {
        const ms = navigator.mediaSession;
        if (!ms || radio.native || !radio.audio || typeof window.MediaMetadata !== 'function') return;
        const id = curId();
        const c = chan(id);
        let m;
        if (radio.mode === 'track' && radio.track) m = { title: radio.track.name, artist: `Tape: ${radio.track.tape}`, album: TITLE, art: '' };
        else { const n = songAt(id, posTime()); m = { title: n && !n.ad ? n.t : (c ? c.name : TITLE), artist: n && !n.ad ? n.a : 'SiriusXM', album: chanLabel(c), art: (n && n.i) || (c && c.logo) || '' }; }
        const key = JSON.stringify(m);
        if (key === metaKey) return;
        metaKey = key;
        try { ms.metadata = new window.MediaMetadata({ title: m.title, artist: m.artist, album: m.album, artwork: m.art ? [{ src: m.art }] : [] }); } catch (_) { /* not supported */ }
    }

    // ---------------------------------------------------------------- the sleep timer

    /** Off (0) or minutes: the native player fades out and stops itself; the page's player stops here. */
    function setSleep(minutes, quiet) {
        clearTimeout(sleep.timer);
        sleep.at = minutes > 0 ? Date.now() + minutes * 60000 : 0;
        const nv = nativePlayer();
        if (radio.native && nv && typeof nv.sleep === 'function') { try { nv.sleep(minutes); } catch (_) { /* older app */ } }
        else if (minutes > 0) sleep.timer = setTimeout(() => { sleep.at = 0; stopRadio(); }, minutes * 60000);
        if (!quiet) changed();
    }
    function sleepLeft() {
        const nv = nativePlayer();
        let at = sleep.at;
        if (radio.native && nv && typeof nv.sleepAt === 'function') { try { at = Number(nv.sleepAt()) || 0; } catch (_) { /* older app */ } }
        return at > Date.now() ? Math.ceil((at - Date.now()) / 60000) : 0;
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
        // "Stop" while it records (Yukimi, Nov 21 2026)
        return { label: rec ? 'Stop' : 'Record', disabled: !id || !isAdmin(), action: () => todayRecord(id) };
    }

    async function setAlert(kind, from) {
        const n = from || nowOf(curId());
        if (!n || n.ad || !n.a) { void box('Nothing is playing to set an alert for.', 'info'); return; }
        try {
            await ask('xmradio_alert_add', { kind, artist: n.a, title: kind === 'song' ? n.t : '' });
            void box(kind === 'song' ? `"${n.t}" will be recorded whenever it plays on a channel in your plan.` : `${n.a} will be recorded whenever they play on a channel in your plan.`, 'info');
            tapes.stale = true;
        } catch (err) { void box((err && err.message) || 'The alert could not be set.'); }
    }

    async function setPreset(bank, slot, id = curId()) {
        if (!id) return;
        const next = { A: (cache.presets.A || []).slice(), B: (cache.presets.B || []).slice(), C: (cache.presets.C || []).slice() };
        while (next[bank].length < 10) next[bank].push(null);
        next[bank][slot] = id;
        cache.presets = next;
        changed();
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

    // ---------------------------------------------------------------- the guide and search

    async function loadGuide() {
        try {
            const d = await ask('xmradio_guide', {}, 30000);
            cache.genres = (d && d.genres) || {};
            guideMissing = (d && d.missing) || 0;
            saveSoon();
            if (shown) render();
        } catch (_) { /* the list as it was */ }
    }
    let guideMissing = 0;

    const search = { q: '', ids: [], results: [] };
    async function searchAsk() {
        const q = await input("Search What's On", 'Artist, song, show or channel:', search.q);
        if (!q) return;
        try {
            const d = await ws.busy(ask('xmradio_search', { q }, 30000), { delay: 300, timeout: 30000 });
            search.q = q;
            search.results = (d && d.results) || [];
            search.ids = search.results.map((x) => x.channelId);
            prefs.show = 'search';
            tellWatch();
            setTab('channels');
        } catch (err) { void box((err && err.message) || 'The search did not work.'); }
    }

    // ---------------------------------------------------------------- tapes (Recordings and the Deck)

    // { list: [names], info: { name: { n, dur } }, deck: { tape, mode, timers, alerts, terms }, open, tracks, sel, stale }
    const tapes = { list: null, info: {}, deck: null, open: null, tracks: {}, sel: '', stale: true, loading: false };

    async function loadTapes(force) {
        if (tapes.loading || (!force && !tapes.stale && tapes.list)) return;
        tapes.loading = true;
        try {
            const d = await ask('xmradio_deck_get', { info: true }, 60000);
            tapes.deck = d.deck || null;
            tapes.list = (d.tapes || []).slice();
            tapes.info = d.tapeInfo || {};
            if (tapes.deck && tapes.deck.tape && !tapes.list.includes(tapes.deck.tape)) tapes.list.unshift(tapes.deck.tape);
            tapes.stale = false;
            if (tapes.open) await loadTracks(tapes.open);
            if (tapes.deck && tapes.deck.tape && !tapes.tracks[tapes.deck.tape]) void loadTracks(tapes.deck.tape);
        } catch (err) { tapes.error = (err && err.message) || 'The tapes could not be read.'; }
        tapes.loading = false;
        if (shown) render();
    }

    async function loadTracks(name) {
        try {
            const d = await ask('xmradio_tape_tracks', { tape: name }, 60000);
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
        try {
            if (kind === 'new') {
                const n = await input('New Tape', 'Name the new tape:', '');
                if (!n) return;
                await ws.busy(ask('xmradio_tape_new', { name: n }), { delay: 300, timeout: 30000 });
            } else if (kind === 'rename') {
                const n = await input('Rename Tape', `New name for ${name}:`, name);
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
            } else if (kind === 'save') {
                const list = tapes.tracks[name] || [];
                for (const t of list) saveToPhone(t, true);
                void box(list.length ? `${list.length} recordings of ${name} are downloading to the phone's Music folder (XM Radio).` : 'This tape is blank.', 'info');
                return;
            }
        } catch (err) { void box((err && err.message) || 'That did not work.'); }
        await loadTapes(true);
        if (ws) ws.refreshSoftKeys();
    }

    /** Save to Phone: the app downloads the recording into Music/XM Radio/<tape> (offline, any music player). */
    function saveToPhone(t, quiet) {
        const nv = nativePlayer();
        if (!nv || typeof nv.saveRecording !== 'function') { if (!quiet) void box('Saving to the phone needs the Dreamscape app.', 'info'); return false; }
        let ok = false;
        try { ok = nv.saveRecording(new URL(`/api/xmradio/track/${encodeURIComponent(t.id)}`, location.origin).toString(), t.name.replace(/\.m4a$/i, ''), t.tape) === true; } catch (_) { ok = false; }
        if (ok) { prefs.saved[t.id] = Date.now(); saveSoon(); render(); }
        if (!quiet) void box(ok ? 'Downloading to the phone\'s Music folder (XM Radio). Android shows its progress.' : 'The recording could not be saved to the phone.', ok ? 'info' : 'error');
        return ok;
    }

    async function trackAction(kind, t) {
        if (!t) return;
        try {
            if (kind === 'rename') {
                const n = await input('Rename', 'New name:', t.name.replace(/\.m4a$/i, ''));
                if (!n) return;
                await ws.busy(ask('xmradio_track_rename', { id: t.id, name: n }), { delay: 300, timeout: 30000 });
            } else if (kind === 'delete') {
                const ok = await ws.messageBox({ title: 'Delete', icon: 'warning', text: `Move "${t.name.replace(/\.m4a$/i, '')}" to the Recycle Bin?`, buttons: [{ text: 'Delete', value: true }, { text: 'Cancel', value: false }] });
                if (!ok) return;
                await ws.busy(ask('xmradio_track_delete', { id: t.id }), { delay: 300, timeout: 30000 });
            } else if (kind.startsWith('move:')) {
                await ws.busy(ask('xmradio_track_move', { id: t.id, tape: kind.slice(5) }), { delay: 300, timeout: 30000 });
                tapes.tracks[kind.slice(5)] = null;
            } else if (kind === 'save') {
                saveToPhone(t);
                return;
            }
        } catch (err) { void box((err && err.message) || 'That did not work.'); }
        tapes.stale = true;
        if (tapes.open) await loadTracks(tapes.open);
    }

    // ---------------------------------------------------------------- the deck's timers, alerts and terms

    const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    function timerText(t) {
        const days = t.date ? `Once on ${t.date}` : (!t.days || !t.days.length || t.days.length === 7) ? 'Every day' : t.days.map((d) => DAYS[d]).join(' ');
        return `${t.off ? '(Off) ' : ''}${days} at ${t.start}, ${t.minutes} min: ${chanLabel(chan(t.channelId)) || 'a channel'}`;
    }

    /** Add a scheduled recording in four short steps: channel, start, length, days (or a date). */
    async function timerAdd() {
        const c0 = chan(curId());
        const num = await input('Scheduled Recording', 'Channel number:', c0 ? String(c0.number) : '');
        if (!num) return;
        const c = ((cache.lineup && cache.lineup.channels) || []).find((x) => x.number === Number(num));
        if (!c) { void box(`There is no channel ${num}.`, 'info'); return; }
        const start = await input('Scheduled Recording', 'Start at (24-hour, hh:mm):', '08:00');
        const m = /^(\d{1,2}):(\d{2})$/.exec(String(start || '').trim());
        if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) { if (start) void box('Write the time as hh:mm, for example 07:30.', 'info'); return; }
        const len = await input('Scheduled Recording', 'Length in minutes (up to 480):', '60');
        const minutes = Math.max(1, Math.min(480, Math.round(Number(len) || 0)));
        if (!len || !minutes) return;
        const when = await input('Scheduled Recording', 'Days (for example Mon-Fri, Sat Sun, every day) or a date (yyyy-mm-dd):', 'every day');
        if (!when) return;
        const t = { channelId: c.id, start: `${String(Number(m[1])).padStart(2, '0')}:${m[2]}`, minutes, days: [], date: null };
        const w = when.trim().toLowerCase();
        if (/^\d{4}-\d{2}-\d{2}$/.test(w)) t.date = w;
        else if (!/every|daily/.test(w)) {
            const idx = (d) => DAYS.findIndex((x) => x.toLowerCase() === d.slice(0, 3));
            for (const part of w.split(/[\s,]+/).filter(Boolean)) {
                const r = /^([a-z]{3})[a-z]*-([a-z]{3})[a-z]*$/.exec(part);
                if (r) { let a = idx(r[1]); const b = idx(r[2]); if (a >= 0 && b >= 0) { for (let k = 0; k < 8 && !t.days.includes(b); k++) { t.days.push(a); a = (a + 1) % 7; } } }
                else if (idx(part) >= 0) t.days.push(idx(part));
            }
            if (!t.days.length) { void box('Name the days (Mon-Fri, Sat Sun) or a date (2026-11-21).', 'info'); return; }
        }
        await saveTimers((tapes.deck && tapes.deck.timers || []).concat(t));
    }
    async function saveTimers(list) {
        try { await ws.busy(ask('xmradio_timers_set', { timers: list }), { delay: 300, timeout: 30000 }); } catch (err) { void box((err && err.message) || 'The timers could not be saved.'); }
        await loadTapes(true);
    }
    async function termAdd() {
        const q = await input('Search Terms', 'Words to match (artist, song or show): what matches is recorded.', '');
        if (!q) return;
        try { await ws.busy(ask('xmradio_terms_set', { terms: (tapes.deck && tapes.deck.terms || []).concat({ text: q }) }), { delay: 300, timeout: 30000 }); } catch (err) { void box((err && err.message) || 'The term could not be saved.'); }
        await loadTapes(true);
    }
    async function autoRemove(kind, id) {
        const d = tapes.deck || {};
        const ok = await ws.messageBox({ title: TITLE, icon: 'question', text: 'Remove this from Timer Recording?', buttons: [{ text: 'Remove', value: true }, { text: 'Cancel', value: false }] });
        if (!ok) return;
        try {
            if (kind === 'timer') await ask('xmradio_timers_set', { timers: (d.timers || []).filter((t) => t.id !== id) });
            else if (kind === 'alert') await ask('xmradio_alert_remove', { id });
            else await ask('xmradio_terms_set', { terms: (d.terms || []).filter((t) => t.id !== id) });
        } catch (err) { void box((err && err.message) || 'That did not work.'); }
        await loadTapes(true);
    }

    // ---------------------------------------------------------------- the program

    let tab = 'now'; // now | channels | recordings | deck
    const TABS = [['now', 'Now Playing'], ['channels', 'Channels'], ['recordings', 'Recordings'], ['deck', 'Deck']];

    function build() {
        page.innerHTML = `<div class="xrm-pane xrm-now-pane wm-pg-scroll" data-pane="now">
                <div class="xrm-np">
                    <div class="xrm-lcd"></div>
                    <div class="xrm-np-bar"><i></i></div><div class="xrm-np-times"><span class="xrm-np-el"></span><span class="xrm-np-mid"></span><span class="xrm-np-rem"></span></div>
                    <div class="xrm-np-buf" title="The last hour: tap to play from there"><b></b><i></i><span>-1 h</span><span>LIVE</span></div>
                    <div class="xrm-np-keys">
                        <button type="button" data-k="prev" aria-label="Previous song">&#x23EE;&#xFE0E;</button>
                        <button type="button" data-k="play" aria-label="Play or pause" class="is-big"></button>
                        <button type="button" data-k="next" aria-label="Next song">&#x23ED;&#xFE0E;</button>
                        <button type="button" data-k="live" aria-label="Back to live" class="xrm-np-live">LIVE</button>
                        <button type="button" data-k="rec" aria-label="Record" class="xrm-np-rec">REC</button>
                    </div>
                </div>
                <div class="xrm-sec xrm-up"></div>
                <div class="xrm-sec xrm-played"></div>
            </div>
            <div class="xrm-pane" data-pane="channels" hidden><div class="xrm-head"><span class="xrm-show"></span><span class="xrm-count"></span></div><div class="xrm-list wm-pg-scroll" role="listbox"></div></div>
            <div class="xrm-pane xrm-rec-pane wm-pg-scroll" data-pane="recordings" hidden></div>
            <div class="xrm-pane xrm-deck-pane wm-pg-scroll" data-pane="deck" hidden><div class="xrm-deckwrap"></div><div class="xrm-auto"></div></div>
            <div class="xrm-tabs" role="tablist">${TABS.map(([k, l]) => `<button type="button" class="xrm-tabk" role="tab" data-tab="${k}" aria-selected="${tab === k}"><i></i>${l}</button>`).join('')}</div>`;
        const q = (s) => page.querySelector(s);
        if (!document.querySelector('link[data-xr-theme]')) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = '/css/themes/vista/xmradio.css';
            link.dataset.xrTheme = '1';
            document.head.appendChild(link);
        }
        els = {
            lcd: q('.xrm-lcd'), bar: q('.xrm-np-bar > i'), el: q('.xrm-np-el'), mid: q('.xrm-np-mid'), rem: q('.xrm-np-rem'),
            buf: q('.xrm-np-buf'), bufAt: q('.xrm-np-buf > i'), bufFill: q('.xrm-np-buf > b'), keys: q('.xrm-np-keys'),
            play: q('[data-k="play"]'), rec: q('[data-k="rec"]'), live: q('[data-k="live"]'), up: q('.xrm-up'), played: q('.xrm-played'),
            show: q('.xrm-show'), count: q('.xrm-count'), list: q('.xrm-list'), recPane: q('.xrm-rec-pane'), deck: q('.xrm-deckwrap'), auto: q('.xrm-auto')
        };
        mountScreen();
        bindScreen();
        page.addEventListener('click', (e) => {
            const tb = e.target.closest('[data-tab]');
            if (tb) { setTab(tb.dataset.tab); return; }
            const k = e.target.closest('[data-k]');
            if (k && !k.closest('.xrm-lcd')) {
                const id = curId();
                if (k.dataset.k === 'play') playPause();
                else if (k.dataset.k === 'prev') prevSong();
                else if (k.dataset.k === 'next') nextSong();
                else if (k.dataset.k === 'live') goLive();
                else if (k.dataset.k === 'rec') { const r = recOf(id); if (r) void stopRec(r); else void recordAsk(id); }
                return;
            }
            const jump = e.target.closest('[data-jump]');
            if (jump) { jumpTo(Number(jump.dataset.jump)); return; }
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
            if (back) { closeTape(); return; }
            const dk = e.target.closest('[data-dk]');
            if (dk) { void deckKey(dk.dataset.dk); return; }
            const sw = e.target.closest('.xr-dk-switch');
            if (sw) { void deckMode(); return; }
            const au = e.target.closest('[data-auto]');
            if (au) {
                const [kind, id] = au.dataset.auto.split(':');
                if (kind === 'add-timer') void timerAdd();
                else if (kind === 'add-term') void termAdd();
                else void autoRemove(kind, id);
            }
        });
        // the last hour: a tap plays from that point (the stream keeps five; the programme covers the last hour)
        els.buf.addEventListener('click', (e) => {
            const r = els.buf.getBoundingClientRect();
            const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
            const back = (1 - x) * 3600;
            const id = curId();
            if (id) void tune(id, { back: back < 30 ? 0 : back });
        });
        // the phone turned sideways: the whole receiver, as the faceplate view
        if (window.matchMedia) {
            const mq = window.matchMedia('(orientation: landscape)');
            const flip = () => { screenKey = ''; if (landscape()) tab = 'now'; mountScreen(); render(); if (ws) ws.refreshSoftKeys(); };
            try { mq.addEventListener('change', flip, { signal: appScopeSignal }); } catch (_) { /* older engine */ }
        }
        if (navigator.connection && typeof navigator.connection.addEventListener === 'function') {
            // Automatic quality follows the network: a channel playing live tunes again at the new one
            navigator.connection.addEventListener('change', () => {
                if (prefs.quality === 'auto' && radio.mode === 'live' && (radio.state === 'playing' || radio.state === 'tuning') && radio.channelId) void tune(radio.channelId, { back: radio.back });
            }, { signal: appScopeSignal });
        }
    }

    function setTab(k) {
        if (!TABS.some((t) => t[0] === k)) return;
        tab = k;
        if (k === 'recordings' || k === 'deck') void loadTapes(false);
        if (k === 'now') void loadSchedule(curId());
        if (k === 'channels' && prefs.show === 'guide') void loadGuide();
        render();
        if (ws) ws.refreshSoftKeys();
    }

    const setText = (el, t) => { if (el && el.textContent !== t) el.textContent = t; };
    const setHtml = (el, h) => { if (el.dataset.h !== h) { el.dataset.h = h; el.innerHTML = h; } };
    const setLcdImg = (img, src) => {
        if (!img) return;
        img.classList.toggle('is-empty', !src);
        if (!src) { img.removeAttribute('src'); return; }
        if (img.getAttribute('src') !== src) img.src = src;
    };

    // ---- the receiver: its screen alone, or its whole faceplate

    const faceView = () => prefs.view === 'faceplate' || (window.matchMedia && window.matchMedia('(orientation: landscape)').matches);
    const SVG = {
        back: '<svg viewBox="0 0 16 10" aria-hidden="true"><path d="M8 0v10L1 5zM15 0v10L8 5z"/></svg>',
        play: '<svg viewBox="0 0 20 10" aria-hidden="true"><path d="M1 0v10l7-5zM11 0h3v10h-3zM16 0h3v10h-3z"/></svg>',
        fwd: '<svg viewBox="0 0 16 10" aria-hidden="true"><path d="M1 0v10l7-5zM8 0v10l7-5z"/></svg>'
    };
    function displayHtml() {
        return `<div class="xr-bezel"><div class="xr-display" aria-live="polite">
            <img class="xr-d-bg is-empty" data-f="bg" alt="" draggable="false"><i class="xrm-shade"></i>
            <div class="xr-d-top"><span data-f="band"></span><span data-f="pre"></span><span class="xr-d-fill"></span><span data-f="replay"></span><span class="xr-sig" data-f="sig"><i></i><i></i><i></i></span><span data-f="clock"></span></div>
            <div class="xr-d-main">
                <img class="xr-d-art is-empty" data-f="art" alt="" draggable="false">
                <div class="xr-d-text"><div class="xr-d-l1"><span class="xr-d-num" data-f="num"></span><span class="xr-d-name" data-f="name"></span></div><div class="xr-d-l2"><span class="xr-run" data-f="l2"></span></div><div class="xr-d-l3"><span class="xr-run" data-f="l3"></span></div></div>
                <img class="xr-d-logo is-empty" data-f="logo" alt="" draggable="false">
            </div>
        </div></div>`;
    }
    const numKey = (n, cls) => `<button type="button" class="${cls} xr-pre" data-pre="${n}"><img class="xr-pre-logo" alt="" draggable="false" hidden><span class="xr-pre-n">${n === 10 ? 0 : n}</span></button>`;
    /** The desktop radio's faceplates of the docked receivers (apps/xmradio/client/xmradio.js faceplateHtml), as they are. */
    function faceplateHtml(model) {
        const disp = displayHtml();
        const brand = `<div class="xr-brand" data-f="brand"><img class="xr-brand-img" src="${ASSETS}/brand-${prefs.era}.png" alt="" draggable="false"></div>`;
        const key = (b, label, sub, cls) => `<span class="xr-kw${cls ? ` ${cls}` : ''}"><button type="button" class="xr-sk" data-b="${b}">${label}</button>${sub ? `<i>${esc(sub)}</i>` : ''}</span>`;
        const transport = `<button type="button" class="xr-tk xr-glyph" data-b="back">${SVG.back}</button><button type="button" class="xr-tk xr-glyph" data-b="play">${SVG.play}</button><button type="button" class="xr-tk xr-glyph" data-b="fwd">${SVG.fwd}</button>`;
        if (model === 'gloss') {
            return `<div class="xr-g-edge"><button type="button" class="xr-ek" data-b="power">&#x23FB;</button>${brand}<span class="xr-g-edge-fill"></span><button type="button" class="xr-ek" data-b="menu">menu</button><button type="button" class="xr-ek" data-b="band">fav</button></div>
                ${disp}
                <div class="xr-g-pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => numKey(n, 'xr-rk')).join('')}<button type="button" class="xr-rk" data-b="direct">#</button></div>
                <div class="xr-g-knob" data-k="tune"><span class="xr-g-ring"></span><button type="button" class="xr-g-cap" data-nav="select" aria-label="Select"></button></div>
                <div class="xr-g-bottom">${transport}<button type="button" class="xr-tk" data-b="jump">jump</button><button type="button" class="xr-tk xr-g-arrow" data-nav="left">&#x2039;</button><button type="button" class="xr-tk xr-g-arrow" data-nav="right">&#x203A;</button></div>`;
        }
        if (model === 'stratus') {
            const sk = (attr, html, cls) => `<button type="button" class="xr-stk${cls ? ` ${cls}` : ''}" ${attr}>${html}</button>`;
            const pair = (a, b) => `<span class="xr-st-pair">${numKey(a, 'xr-stn')}<i class="xr-st-screw"></i>${numKey(b, 'xr-stn')}</span>`;
            return `<div class="xr-st-left">${sk('data-b="power"', '&#x23FB;', 'is-power')}${sk('data-b="menu"', '<i class="xr-st-tape"></i><span>menu</span>', 'is-blue')}${sk('data-b="jump"', '&#x21B7;', 'is-blue')}</div>
                <div class="xr-st-mid">${brand}${disp}<div class="xr-st-under">${sk('data-b="disp"', '', 'xr-st-square')}<span class="xr-st-rocker">${sk('data-nav="left"', '&#x25C0;', 'is-blue')}${sk('data-nav="right"', '&#x25B6;', 'is-blue')}</span></div></div>
                <div class="xr-st-right">${sk('data-nav="up"', '&#x25B2;', 'is-blue')}${sk('data-b="band"', '<i class="xr-st-dog"></i>', 'is-blue')}${sk('data-nav="down"', '&#x25BC;', 'is-blue')}</div>
                <div class="xr-st-nums">${pair(1, 2)}${pair(3, 4)}${pair(5, 6)}${pair(7, 8)}${pair(9, 10)}</div>`;
        }
        if (model === 'roady') {
            const rk = (b, label, nav) => `<button type="button" class="xr-rdk"${nav ? ` data-nav="${nav}"` : ` data-b="${b}"`}><span>${label}</span><i></i></button>`;
            const pair = (a, b) => `<span class="xr-rd-pair">${numKey(a, 'xr-rdn')}${numKey(b, 'xr-rdn')}</span>`;
            return `<div class="xr-rd-left">${rk('power', '&#x23FC;')}${rk('menu', 'menu')}${rk('disp', 'disp')}</div>
                <div class="xr-rd-win">${disp}<div class="xr-rd-print"><b class="xr-rd-maker">XYRIDIAN</b>${brand}<b class="xr-rd-model">roady<sup>xt</sup></b></div></div>
                <div class="xr-rd-right">${rk('', '&#x25B2;', 'up')}${rk('', 'select', 'select')}${rk('', '&#x25BC;', 'down')}</div>
                <div class="xr-rd-row"><i class="xr-rd-led"></i>${rk('direct', 'pre/dir')}${rk('band', 'memory')}${rk('jump', 'jump')}${rk('guide', 'search')}</div>
                <div class="xr-rd-nums">${pair(1, 2)}${pair(3, 4)}${pair(5, 6)}${pair(7, 8)}${pair(9, 10)}</div>`;
        }
        const ez = model === 'onyxez';
        const pad = ez
            ? '<div class="xr-o-pad" data-k="tune"><button type="button" class="xr-o-dir is-up" data-nav="up" aria-label="Up"><i class="xr-o-arr"></i></button><button type="button" class="xr-o-dir is-right" data-nav="right" aria-label="Right"><i class="xr-o-arr"></i></button><button type="button" class="xr-o-dir is-down" data-nav="down" aria-label="Down"><i class="xr-o-arr"></i></button><button type="button" class="xr-o-dir is-left" data-nav="left" aria-label="Left"><i class="xr-o-arr"></i></button><button type="button" class="xr-o-center" data-nav="select" aria-label="Select"></button></div>'
            : '<div class="xr-o-ring" data-k="tune"><button type="button" class="xr-o-zone is-up" data-nav="up" aria-label="Up"></button><button type="button" class="xr-o-zone is-right" data-nav="right" aria-label="Right"></button><button type="button" class="xr-o-zone is-down" data-nav="down" aria-label="Down"></button><button type="button" class="xr-o-zone is-left" data-nav="left" aria-label="Left"></button><button type="button" class="xr-o-center" data-nav="select" aria-label="Select"><i></i></button></div>';
        const side = ez
            ? key('power', '&#x23FB;', '', 'is-power') + key('menu', 'menu', '', 'is-menu') + key('band', 'band', '') + key('jump', 'jump', '')
            : key('power', '&#x23FB;', 'power', 'is-power') + key('menu', 'menu', 'guide', 'is-menu') + key('disp', 'info', 'disp') + key('jump', '&#x21B6;', 'jump');
        const last = ez ? '<button type="button" class="xr-bk" data-b="direct">direct</button>' : '<button type="button" class="xr-bk" data-b="band">b/#</button>';
        return `${brand}${disp}<div class="xr-o-nav">${pad}${ez ? '' : `<div class="xr-o-transport">${transport}</div>`}</div>
            <div class="xr-o-side">${side}</div>
            <div class="xr-o-keys">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => numKey(n, 'xr-bk')).join('')}${last}</div>`;
    }

    let screenKey = '';
    let lcdRo = null;
    /** The receiver mounted in .xrm-lcd: its screen, or its faceplate; its kind, era and natural width. */
    function mountScreen() {
        if (!els) return;
        const face = faceView();
        const key = `${prefs.body}|${prefs.era}|${face}`;
        if (key === screenKey) return;
        screenKey = key;
        const w = face ? NATURAL_W[prefs.body] : BODY_SCREEN[prefs.body][0];
        els.lcd.dataset.w = String(w);
        els.lcd.classList.toggle('is-face', face);
        els.lcd.innerHTML = `<div class="xr-radio is-on" data-docked="true" data-body="${prefs.body}" data-display="${BODY_DISPLAY[prefs.body]}" data-era="${prefs.era}">${face ? `<div class="xr-shell">${faceplateHtml(prefs.body)}</div>` : displayHtml()}</div>`;
        const r = els.lcd.querySelector('.xr-radio');
        if (!face) { const [bw, bh] = BODY_SCREEN[prefs.body]; const bz = r.querySelector('.xr-bezel'); bz.style.width = `${bw}px`; bz.style.height = `${bh}px`; }
        const f = (n) => r.querySelector(`[data-f="${n}"]`);
        Object.assign(els, { rad: r, bg: f('bg'), band: f('band'), pre: f('pre'), replay: f('replay'), sig: f('sig'), clock: f('clock'), art: f('art'), num: f('num'), name: f('name'), l2: f('l2'), l3: f('l3'), logo: f('logo') });
        page.querySelector('.xrm-np').classList.toggle('is-face', face);
        page.classList.toggle('is-land', landscape());
        fitScreen();
        paintPresetKeys();
        if (!lcdRo && typeof ResizeObserver === 'function') {
            lcdRo = new ResizeObserver(() => fitScreen());
            lcdRo.observe(els.lcd);
        }
    }
    /**
     * The receiver's size: the width it has; turned sideways (Yukimi, Nov 21 2026: "rotating does not just show the
     * radio and size it correctly") the radio alone, as large as both the width and the height allow.
     */
    function fitScreen() {
        if (!els || !els.rad) return;
        const w = Number(els.lcd.dataset.w) || 246;
        const avail = els.lcd.clientWidth;
        if (!avail) return;
        let z = avail / w;
        // the receiver keeps its own width (scaled as a whole: it stretched sideways when the height decided)
        if (els.rad.style.width !== `${w}px`) els.rad.style.width = `${w}px`;
        if (landscape() && page && page.clientHeight) {
            els.rad.style.zoom = '1';
            const natural = els.rad.offsetHeight || 1;
            z = Math.min(z, (page.clientHeight - 8) / natural);
        }
        const zs = String(Math.round(z * 1000) / 1000);
        if (els.rad.style.zoom !== zs) els.rad.style.zoom = zs;
    }
    const landscape = () => !!(window.matchMedia && window.matchMedia('(orientation: landscape)').matches);
    function paintPresetKeys() {
        if (!els || !els.rad) return;
        const bank = prefs.show === 'B' || prefs.show === 'C' ? prefs.show : 'A';
        const list = cache.presets[bank] || [];
        els.rad.querySelectorAll('[data-pre]').forEach((b) => {
            const c = chan(list[Number(b.dataset.pre) - 1]);
            const img = b.querySelector('.xr-pre-logo');
            const src = c && c.logo ? c.logo : '';
            if (src && img.getAttribute('src') !== src) img.src = src;
            img.hidden = !src;
            b.classList.toggle('has-logo', !!src);
        });
    }

    /** The screen: a swipe changes channel, a tap changes what its lines show; the faceplate's keys work as on the desktop. */
    function bindScreen() {
        let down = null;
        let held = 0;
        els.lcd.addEventListener('pointerdown', (e) => {
            down = { x: e.clientX, y: e.clientY, t: Date.now(), on: e.target.closest('button, [data-k], [data-pre]') };
            const p = e.target.closest('[data-pre]');
            clearTimeout(held);
            if (p) held = setTimeout(() => { held = -1; const bank = prefs.show === 'B' || prefs.show === 'C' ? prefs.show : 'A'; void setPreset(bank, Number(p.dataset.pre) - 1); if (ws && ws.vibrate) { try { ws.vibrate('tap'); } catch (_) { /* no motor */ } } }, 900);
        });
        els.lcd.addEventListener('pointerup', (e) => {
            const d = down;
            down = null;
            const wasHeld = held === -1;
            clearTimeout(held);
            held = 0;
            if (!d || wasHeld) return;
            const dx = e.clientX - d.x;
            const dy = e.clientY - d.y;
            if (!d.on && Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) { step(dx < 0 ? 1 : -1); return; }
            if (Math.abs(dx) > 10 || Math.abs(dy) > 10) return;
            const p = e.target.closest('[data-pre]');
            if (p) { const bank = prefs.show === 'B' || prefs.show === 'C' ? prefs.show : 'A'; const id = (cache.presets[bank] || [])[Number(p.dataset.pre) - 1]; if (id && chan(id)) void tune(id); else void box(`Preset ${bank}${p.dataset.pre} is empty. Hold the key to store the channel playing.`, 'info'); return; }
            const n = e.target.closest('[data-nav]');
            if (n) { const v = n.dataset.nav; if (v === 'up' || v === 'right') step(1); else if (v === 'down' || v === 'left') step(-1); else playPause(); return; }
            const b = e.target.closest('[data-b]');
            if (b) { faceKey(b.dataset.b); return; }
            const k = e.target.closest('[data-k]');
            if (k) { const r = k.getBoundingClientRect(); step(e.clientX < r.left + r.width / 2 ? -1 : 1); return; }
            // a tap on the screen: what its lines show, as DISP does
            prefs.info = INFO[(INFO.indexOf(prefs.info) + 1) % INFO.length];
            saveSoon();
            render();
        });
        els.lcd.addEventListener('pointercancel', () => { down = null; clearTimeout(held); held = 0; });
    }
    function faceKey(b) {
        if (b === 'power') { if (radio.state === 'off') playPause(); else stopRadio(); }
        else if (b === 'play') playPause();
        else if (b === 'back') prevSong();
        else if (b === 'fwd') nextSong();
        else if (b === 'jump') { if (radio.prevId) void tune(radio.prevId); }
        else if (b === 'band') { const order = ['A', 'B', 'C']; prefs.show = order[(order.indexOf(prefs.show) + 1) % 3] || 'A'; saveSoon(); paintPresetKeys(); render(); }
        else if (b === 'disp') { prefs.info = INFO[(INFO.indexOf(prefs.info) + 1) % INFO.length]; saveSoon(); render(); }
        else if (b === 'direct') void directTune();
        else if (b === 'menu' || b === 'guide') { prefs.show = 'guide'; saveSoon(); setTab('channels'); }
    }

    function listIds() {
        if (prefs.show === 'all' || prefs.show === 'guide') return ((cache.lineup && cache.lineup.channels) || []).filter((c) => c.sub !== false).map((c) => c.id);
        if (prefs.show === 'search') return search.ids.filter((id) => chan(id));
        return (cache.presets[prefs.show] || []).filter((id) => id && chan(id));
    }

    /** Where the song is (elapsed / remaining), where replay is in the last hour; the clock runs only while seen. */
    let progTimer = 0;
    function paintProgress() {
        clearTimeout(progTimer);
        if (!els || tab !== 'now') return;
        let el = 0;
        let dur = 0;
        if (radio.mode === 'track') {
            const a = radio.audio;
            dur = radio.track ? radio.track.dur || 0 : 0;
            if (a && !radio.native) { el = a.currentTime || 0; if (Number.isFinite(a.duration)) dur = a.duration; }
            else if (radio.startedAt) el = (Date.now() - radio.startedAt) / 1000;
        } else {
            const id = curId();
            const t = posTime();
            const n = songAt(id, t == null ? Date.now() : t);
            const at = n && n.at;
            dur = (n && n.dur) || 0;
            if (at) el = ((t == null ? Date.now() : t) - at) / 1000;
            if (dur && el > dur) el = dur;
        }
        els.bar.style.width = dur ? `${Math.min(100, (el / dur) * 100).toFixed(1)}%` : '0%';
        setText(els.el, el ? mmss(el) : '');
        setText(els.rem, dur ? `-${mmss(dur - el)}` : '');
        const b = radio.mode === 'live' && radio.state !== 'off' ? behind() : 0;
        const rep = replaying();
        setText(els.mid, rep ? `REPLAY -${mmss(b)}` : '');
        els.buf.hidden = radio.mode !== 'live';
        els.bufAt.style.left = `${Math.max(0, Math.min(100, 100 - (b / 3600) * 100)).toFixed(2)}%`;
        els.bufFill.style.width = els.bufAt.style.left;
        els.live.hidden = !rep;
        if (els.replay) setText(els.replay, recOf(curId()) ? 'REC' : rep ? `-${mmss(b)}` : radio.state === 'paused' ? 'PAUSED' : sleepLeft() ? `Zz ${sleepLeft()}` : '');
        // the clock moves once a second only while this tab is on screen with a time to show
        if ((el || rep) && shown && screenOn()) progTimer = setTimeout(paintProgress, 1000 - (Date.now() % 1000) + 20);
    }

    function renderNow() {
        mountScreen();
        const id = curId();
        const c = chan(id);
        const rec = recOf(id);
        const playing = radio.state === 'playing' || radio.state === 'tuning';
        if (radio.mode !== 'track' && id) void wantLogos([id]);
        const scr = (o) => {
            // the receiver's screen, filled as the desktop radio's paint() fills it
            els.rad.dataset.state = { off: 'off', tuning: 'acquiring', playing: 'playing', paused: 'paused', error: 'nosignal' }[radio.state] || 'off';
            setText(els.num, o.num || '');
            setText(els.name, o.name || '');
            setText(els.l2, o.l2 || '');
            setText(els.l3, o.l3 || '');
            setText(els.band, o.band || '');
            setText(els.pre, '');
            if (els.sig) els.sig.dataset.bars = radio.state === 'playing' || radio.state === 'paused' ? '3' : radio.state === 'tuning' ? '1' : '0';
            const d = new Date();
            setText(els.clock, `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')}`);
            setLcdImg(els.art, o.art || '');
            setLcdImg(els.logo, o.logo || '');
            setLcdImg(els.bg, o.bg || '');
        };
        if (radio.mode === 'track' && radio.track) {
            const m = /^(\d{4}-\d{2}-\d{2} \d{4}) (.*)$/.exec(radio.track.name);
            const rest = m ? m[2] : radio.track.name;
            const parts = rest.split(' - ');
            const tst = { tuning: 'LOADING', paused: 'PAUSED', error: 'CANNOT PLAY', off: 'STOPPED' }[radio.state];
            scr({ num: String(radio.track.i + 1), name: `TAPE ${radio.track.tape}`, l2: tst || (parts.length > 1 ? parts[0] : rest), l3: tst ? '' : (parts.length > 1 ? parts.slice(1).join(' - ') : '') });
            els.rec.hidden = true;
            setHtml(els.up, '');
            const list = radio.track.list.slice(radio.track.i + 1, radio.track.i + 6);
            setHtml(els.played, list.length ? `<div class="xrm-sec-h">Up Next on the Tape</div>${list.map((t) => `<div class="xrm-sec-row"><span class="xrm-sec-t">${esc(t.name.replace(/\.m4a$/i, '').replace(/^\d{4}-\d{2}-\d{2} \d{4} /, ''))}</span><span class="xrm-sec-time">${t.dur ? esc(mmss(t.dur)) : ''}</span></div>`).join('')}` : '');
        } else {
            const s = sched.get(id);
            const data = (s && s.data) || {};
            const t = posTime();
            const now = songAt(id, t);
            let l2;
            let l3;
            if (prefs.info === 'channel') { l2 = c ? c.name : ''; l3 = (c && cache.genres[c.id]) || ''; }
            else if (prefs.info === 'show') { const on = (data.shows || []).find((x) => x.now); l2 = (now && now.s) || (on && (on.show || on.name)) || (c ? c.name : ''); l3 = on ? `until ${clock(on.at + on.dur * 1000)}` : ''; }
            else { l2 = now ? (now.ad ? 'SiriusXM' : now.a || '') : ''; l3 = now ? (now.ad ? 'Commercial' : now.t || '') : ''; }
            if (!c) { l2 = cache.lineup ? 'Choose a channel' : 'Channels loading'; l3 = ''; }
            else if (radio.state === 'tuning') { l2 = 'ACQUIRING SIGNAL'; l3 = ''; }
            else if (radio.state === 'error') { l2 = 'NO SIGNAL'; l3 = 'Check connection'; }
            const songArt = now && !now.ad && now.i ? now.i : '';
            const tft = BODY_DISPLAY[prefs.body] === 'tft';
            scr({
                num: c ? String(c.number || '') : '', name: c ? c.name : 'XM RADIO', l2, l3,
                band: prefs.show === 'B' || prefs.show === 'C' ? prefs.show : 'A',
                art: songArt || (c && c.logo) || '', logo: songArt ? (c && c.logo) || '' : '',
                bg: tft && c && c.bg ? c.bg : ''
            });
            els.rec.hidden = !isAdmin() || !c;
            els.rec.classList.toggle('is-on', !!rec);
            setText(els.rec, rec ? 'STOP' : 'REC');
            // Up Next: the channel's shows to come (songs are known only once they air)
            const shows = (data.shows || []).filter((x) => !x.now).slice(0, 4);
            const onNow = (data.shows || []).find((x) => x.now);
            setHtml(els.up, (onNow || shows.length) ? `<div class="xrm-sec-h">${shows.length ? 'Up Next' : 'On Now'}</div>${onNow ? `<div class="xrm-sec-row is-now"><span class="xrm-sec-time">Now</span><span class="xrm-sec-t">${esc(onNow.show || onNow.name)}</span><span class="xrm-sec-s">until ${esc(clock(onNow.at + onNow.dur * 1000))}</span></div>` : ''}${shows.map((x) => `<div class="xrm-sec-row"><span class="xrm-sec-time">${esc(clock(x.at))}</span><span class="xrm-sec-t">${esc(x.show || x.name)}</span><span class="xrm-sec-s">${esc(x.show && x.name && x.name !== x.show ? x.name : '')}</span></div>`).join('')}` : '');
            // Recently Played: a tap plays the song from its start (the stream keeps five hours)
            const played = (data.played || []).slice(0, 10);
            const cur = now && now.at;
            setHtml(els.played, played.length ? `<div class="xrm-sec-h">Recently Played <span class="xrm-sec-note">tap to play it again</span></div>${played.map((x) => `<div class="xrm-sec-row is-tap${x.at === cur ? ' is-now' : ''}" data-jump="${x.at}">${x.i ? `<span class="xrm-sec-pic"><img src="${esc(x.i)}" alt="" loading="lazy" draggable="false"></span>` : '<span class="xrm-sec-pic is-none"></span>'}<span class="xrm-sec-lines"><span class="xrm-sec-t">${esc(x.t)}</span><span class="xrm-sec-s">${esc(x.a)}</span></span><span class="xrm-sec-time">${esc(clock(x.at))}</span></div>`).join('')}` : '');
        }
        setText(els.play, playing ? (radio.native ? '⏹︎' : '⏸︎') : '▶︎');
        els.keys.hidden = faceView();
        // (mounted while its pane was hidden it had no width to scale to: checked on each draw)
        fitScreen();
        mediaMeta();
        paintProgress();
    }

    let listKey = '';
    function renderChannels() {
        const id = curId();
        const ids = listIds();
        const label = { all: 'All Channels', guide: 'Channel Guide', search: `Search: ${search.q}` }[prefs.show] || `Presets ${prefs.show}`;
        setText(els.show, label);
        setText(els.count, prefs.show === 'guide' && guideMissing ? `${ids.length} (reading genres...)` : String(ids.length));
        const key = JSON.stringify([prefs.show, search.q, ids.length, id, guideMissing, ids.slice(0, 400).map((x) => { const n = nowOf(x); const cc = chan(x); return [x, n && n.a, n && n.t, n && n.ad, cc && cc.logo, !!recOf(x), cache.genres[x]]; })]);
        if (key === listKey) return;
        listKey = key;
        const row = (x, sub) => {
            const cc = chan(x);
            const n = nowOf(x);
            const line = sub != null ? sub : n ? (n.ad ? 'Commercial' : [n.a, n.t].filter(Boolean).join(' - ')) : '';
            return `<div class="xrm-row${x === id ? ' is-current' : ''}" data-id="${esc(x)}" role="option"><span class="xrm-rlogo">${cc.logo ? `<img src="${esc(cc.logo)}" alt="" loading="lazy" draggable="false">` : `<b>${esc(cc.number)}</b>`}</span><span class="xrm-rlines"><span class="xrm-rname">${esc(chanLabel(cc))}${recOf(x) ? ' <i class="xrm-recdot">REC</i>' : ''}</span><span class="xrm-rsub">${esc(line)}</span></span></div>`;
        };
        if (!ids.length) {
            els.list.innerHTML = `<div class="xrm-empty">${{ all: 'No channels yet.', guide: 'No channels yet.', search: `Nothing on now matches "${esc(search.q)}".` }[prefs.show] || 'No presets in this bank. Menu > Add to Presets, or hold a preset key on the faceplate.'}</div>`;
            return;
        }
        if (prefs.show === 'guide') {
            // by genre, as SiriusXM files its channels; those not read yet under the last heading
            const groups = new Map();
            // (genres placed by their words before the server took SiriusXM's own spelling)
            const SAME = { 'Dance/Electronic': 'Dance & Electronic', 'Jazz/Standards': 'Jazz & Standards', 'Hip-Hop/R&B': 'Hip-Hop & R&B' };
            for (const x of ids) { const raw = cache.genres[x] || (x in cache.genres ? 'Other' : 'Not read yet'); const g = SAME[raw] || raw; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(x); }
            const names = [...groups.keys()].sort((a, b) => (a === 'Not read yet') - (b === 'Not read yet') || (a === 'Other') - (b === 'Other') || a.localeCompare(b));
            els.list.innerHTML = names.map((g) => `<div class="xrm-sec-h xrm-genre">${esc(g)} <span class="xrm-sec-note">${groups.get(g).length}</span></div>${groups.get(g).map((x) => row(x)).join('')}`).join('');
            return;
        }
        if (prefs.show === 'search') {
            els.list.innerHTML = search.results.filter((r) => chan(r.channelId)).map((r) => row(r.channelId, [r.a, r.t].filter(Boolean).join(' - ') || r.s)).join('');
            return;
        }
        els.list.innerHTML = ids.map((x) => row(x)).join('');
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
            const total = (list || []).reduce((t, x) => t + (x.dur || 0), 0);
            h += `<div class="xrm-sec-h xrm-tape-h"><button type="button" class="xrm-back" data-back="1">&#x2039; Tapes</button><span class="xrm-sec-note">${tapes.open === deckTape ? 'In the deck' : ''}</span></div><div class="xrm-jcard"><div class="xrm-jc-head"><span class="xrm-jc-side">A</span><span class="xrm-jc-name">${esc(tapes.open)}</span><span class="xrm-jc-total">${list && list.length ? `${list.length} songs · ${esc(mmss(total))}` : ''}</span></div>`;
            if (!list) h += '<div class="xrm-empty">Reading the tape...</div>';
            else if (!list.length) h += '<div class="xrm-empty">This tape is blank.</div>';
            else h += list.map((t) => {
                const playing = radio.mode === 'track' && radio.track && radio.track.id === t.id;
                // the file name is "<date> <time> <artist> - <title>": the song first, when it was recorded under it
                const m = /^(\d{4}-\d{2}-\d{2}) (\d{2})(\d{2}) (.*)$/.exec(t.name.replace(/\.m4a$/i, ''));
                const title = m ? m[4] : t.name.replace(/\.m4a$/i, '');
                const when = m ? `${m[1]} ${m[2]}:${m[3]} · ` : '';
                return `<div class="xrm-track${tapes.sel === t.id ? ' is-sel' : ''}${playing ? ' is-playing' : ''}" data-track="${esc(t.id)}"><span class="xrm-jc-n">${list.indexOf(t) + 1}.</span><span class="xrm-sec-lines"><span class="xrm-sec-t">${playing ? '&#x25B6;&#xFE0E; ' : ''}${esc(title)}</span><span class="xrm-sec-s">${esc(when + sizeText(t.size || 0))}${prefs.saved[t.id] ? ' · on the phone' : ''}</span></span><span class="xrm-sec-time">${t.dur ? esc(mmss(t.dur)) : ''}</span></div>`;
            }).join('') + '</div>';
        } else {
            h += '<div class="xrm-sec-h">Tapes</div>';
            if (!tapes.list) h += `<div class="xrm-empty">${tapes.error ? esc(tapes.error) : 'Reading the tapes...'}</div>`;
            else if (!tapes.list.length) h += '<div class="xrm-empty">No tapes yet. Menu > New Tape, or record something.</div>';
            else h += `<div class="xrm-shelf">${tapes.list.map((n, k) => { const inf = tapes.info[n]; return `<div class="xrm-tape${n === deckTape ? ' is-in' : ''}" data-tape="${esc(n)}" data-hue="${k % 5}"><span class="xrm-sp-brand">XYRIDIAN<b>C-90</b></span><span class="xrm-sp-label"><span class="xrm-sp-name">${esc(n)}</span><span class="xrm-sp-meta">${inf ? `${inf.n} song${inf.n === 1 ? '' : 's'}${inf.dur ? ` · ${esc(mmss(inf.dur))}` : ''}` : ''}</span></span>${n === deckTape ? '<span class="xrm-sp-in">IN DECK</span>' : ''}</div>`; }).join('')}</div>`;
        }
        setHtml(els.recPane, h);
    }

    // ---- the cassette deck: the desktop's own (theme xmradio.css, whose deck rules also match .xrm-deckwrap)

    const DECK_SVG = {
        rec: '<svg viewBox="0 0 10 10" aria-hidden="true"><circle cx="5" cy="5" r="4"/></svg>',
        rew: '<svg viewBox="0 0 16 10" aria-hidden="true"><path d="M8 0v10L1 5zM15 0v10L8 5z"/></svg>',
        play: '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M1 0v10l8-5z"/></svg>',
        ff: '<svg viewBox="0 0 16 10" aria-hidden="true"><path d="M1 0v10l7-5zM8 0v10l7-5z"/></svg>',
        stop: '<svg viewBox="0 0 16 10" aria-hidden="true"><path d="M1 1h8v8H1z"/><path d="M11 6h4L13 2.5zM11 8h4v1.2h-4z"/></svg>',
        pause: '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M1 0h3v10H1zM6 0h3v10H6z"/></svg>'
    };
    let deckBuilt = false;
    function buildDeck() {
        if (deckBuilt) return;
        deckBuilt = true;
        const key = (k, label, glyph) => `<button type="button" class="xr-dk-key" data-dk="${k}" aria-label="${label}">${glyph || ''}<span>${label}</span></button>`;
        els.deck.innerHTML = `<div class="xr-deck" aria-label="Cassette Deck">
            <div class="xr-dk-top"><span class="xr-dk-brand">XYRIDIAN</span><span class="xr-dk-model">STEREO CASSETTE DECK &nbsp;XD-989</span></div>
            <div class="xr-dk-main">
                <div class="xr-dk-door"><div class="xr-dk-tape"><div class="xr-dk-label"><span class="xr-dk-side">A</span><span class="xr-dk-name"></span></div><div class="xr-dk-window"><i class="xr-dk-reel is-l"></i><i class="xr-dk-reel is-r"></i></div></div><div class="xr-dk-empty">NO TAPE</div></div>
                <div class="xr-dk-panel">
                    <div class="xr-dk-row"><div class="xr-dk-counter" aria-label="Counter"></div><div class="xr-dk-leds"><span class="xr-dk-led is-rec"><i></i>REC</span><span class="xr-dk-led is-auto"><i></i>TIMER</span><span class="xr-dk-led is-mute"><i></i>MUTE</span></div></div>
                    <div class="xr-dk-vfd"><div class="xr-dk-v1"></div><div class="xr-dk-v2"></div></div>
                    <div class="xr-dk-row"><div class="xr-dk-switch" role="switch" tabindex="0" aria-label="Split"><span class="xr-dk-sw-cap">SPLIT</span><span class="xr-dk-sw-track"><i></i></span><span class="xr-dk-sw-pos"><b data-pos="song">SONG</b><b data-pos="long">CONT</b></span></div><button type="button" class="xr-dk-small" data-dk="timer">TIMER</button><button type="button" class="xr-dk-small" data-dk="mute">MUTE</button></div>
                </div>
            </div>
            <div class="xr-dk-keys">${key('rec', 'REC', DECK_SVG.rec)}${key('rew', 'REW', DECK_SVG.rew)}${key('play', 'PLAY', DECK_SVG.play)}${key('ff', 'FF', DECK_SVG.ff)}${key('stop', 'STOP/EJECT', DECK_SVG.stop)}${key('pause', 'PAUSE', DECK_SVG.pause)}</div>
        </div>`;
        if (typeof ResizeObserver === 'function') new ResizeObserver(() => fitDeck()).observe(els.deck);
        fitDeck();
    }
    function fitDeck() {
        const d = els.deck.firstElementChild;
        if (!d || !els.deck.clientWidth) return;
        // the wrapper's own padding is not the deck's to fill (it ran off the right edge, Yukimi Nov 21 2026)
        const cs = getComputedStyle(els.deck);
        const inner = els.deck.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
        d.style.zoom = String(Math.floor((inner / 540) * 1000) / 1000);
    }
    const manualRec = () => (cache.rec || []).find((r) => r.kind === 'manual') || null;
    let deckTimer = 0;
    function renderDeck() {
        buildDeck();
        const d = els.deck.querySelector('.xr-deck');
        const st = tapes.deck || {};
        const rec = manualRec();
        const tapePlaying = radio.mode === 'track' && radio.track && radio.track.tape === st.tape;
        const muted = !!(radio.audio && radio.audio.muted);
        d.classList.toggle('has-tape', !!st.tape);
        d.dataset.mode = st.mode || 'song';
        d.dataset.era = prefs.era;
        d.querySelector('.xr-dk-name').textContent = st.tape || '';
        d.querySelector('.xr-dk-led.is-rec').classList.toggle('is-on', (cache.rec || []).length > 0);
        d.querySelector('.xr-dk-led.is-auto').classList.toggle('is-on', !!((st.timers || []).some((t) => !t.off) || (st.alerts || []).length || (st.terms || []).length));
        d.querySelector('.xr-dk-led.is-mute').classList.toggle('is-on', muted);
        const running = (!!rec || (tapePlaying && radio.state === 'playing')) && screenOn() && tab === 'deck';
        d.classList.toggle('is-running', running);
        d.classList.toggle('is-recording', !!rec);
        d.querySelector('[data-dk="rec"]').classList.toggle('is-down', !!rec);
        d.querySelector('[data-dk="play"]').classList.toggle('is-down', tapePlaying && radio.state === 'playing');
        d.querySelector('[data-dk="pause"]').classList.toggle('is-down', tapePlaying && radio.state === 'paused');
        let v1;
        let v2;
        let sec = 0;
        if (rec) { const c = chan(rec.channelId); const n = nowOf(rec.channelId); v1 = `REC  ${c ? `${c.number} ${c.name}` : ''}`; v2 = n ? (n.ad ? 'Commercial' : [n.a, n.t].filter(Boolean).join(' - ')) : ''; sec = (Date.now() - rec.since) / 1000; }
        else if (tapePlaying) { v1 = `${radio.state === 'playing' ? 'PLAY' : 'PAUSE'}  ${radio.track.i + 1}/${radio.track.list.length}`; v2 = radio.track.name.replace(/^\d{4}-\d{2}-\d{2} \d{4} /, ''); sec = radio.audio && !radio.native ? radio.audio.currentTime : (Date.now() - radio.startedAt) / 1000; }
        else if ((cache.rec || []).length) { const a = cache.rec[0]; const c = chan(a.channelId); v1 = `${a.kind === 'timer' ? 'TIMER' : a.kind === 'song' ? 'SONG' : 'ALERT'} REC  ${c ? c.number : ''}`; v2 = c ? c.name : ''; }
        else { v1 = st.tape ? 'STOP' : 'NO TAPE'; v2 = st.tape ? `Tape: ${st.tape}` : 'STOP/EJECT: choose a tape'; }
        d.querySelector('.xr-dk-v1').textContent = v1;
        d.querySelector('.xr-dk-v2').textContent = v2;
        const s = Math.floor(sec);
        const txt = `${Math.floor(s / 3600)}${String(Math.floor(s / 60) % 60).padStart(2, '0')}${String(s % 60).padStart(2, '0')}`.slice(-5);
        const ctr = d.querySelector('.xr-dk-counter');
        if (ctr.dataset.v !== txt) { ctr.dataset.v = txt; ctr.innerHTML = [...txt].map((x) => `<b>${x}</b>`).join(''); }
        clearTimeout(deckTimer);
        if ((rec || tapePlaying) && screenOn() && tab === 'deck' && shown) deckTimer = setTimeout(() => { if (tab === 'deck') renderDeck(); }, 1000 - (Date.now() % 1000) + 20);
        // Timer Recording: the deck's schedule, the radio's alerts and search terms (each tap removes, after asking)
        const tl = (st.timers || []).map((t) => `<div class="xrm-sec-row is-tap" data-auto="timer:${esc(t.id)}"><span class="xrm-sec-t">${esc(timerText(t))}</span></div>`).join('');
        const al = (st.alerts || []).map((a) => `<div class="xrm-sec-row is-tap" data-auto="alert:${esc(a.id)}"><span class="xrm-sec-t">${esc(a.kind === 'song' ? `Song: ${a.artist} - ${a.title}` : `Artist: ${a.artist}`)}</span></div>`).join('');
        const tm = (st.terms || []).map((t) => `<div class="xrm-sec-row is-tap" data-auto="term:${esc(t.id)}"><span class="xrm-sec-t">${esc(t.text)}</span></div>`).join('');
        setHtml(els.auto, `<div class="xrm-sec-h">Scheduled Recordings <button type="button" class="xrm-sec-btn" data-auto="add-timer">Add...</button></div>${tl || '<div class="xrm-empty">None. Add one, or set them on the desktop deck (TIMER).</div>'}
            <div class="xrm-sec-h">Alerts <span class="xrm-sec-note">Menu > Alert while it plays</span></div>${al || '<div class="xrm-empty">None.</div>'}
            <div class="xrm-sec-h">Search Terms <button type="button" class="xrm-sec-btn" data-auto="add-term">Add...</button></div>${tm || '<div class="xrm-empty">None.</div>'}`);
    }
    async function deckKey(k) {
        const st = tapes.deck || {};
        if (k === 'rec') { const r = manualRec(); if (!r) await recordChannel(curId()); }
        else if (k === 'stop') {
            const r = manualRec();
            if (r) await stopRec(r);
            else if (radio.mode === 'track') stopRadio();
            else setTab('recordings');
        } else if (k === 'play') {
            if (!st.tape) return;
            if (radio.mode === 'track' && radio.track && radio.track.tape === st.tape && radio.state === 'paused') { playPause(); return; }
            if (!tapes.tracks[st.tape]) await loadTracks(st.tape);
            const list = tapes.tracks[st.tape] || [];
            if (list.length) void playTrack(list, 0); else void box('This tape is blank.', 'info');
        } else if (k === 'pause') { if (radio.mode === 'track') playPause(); }
        else if (k === 'rew' || k === 'ff') { if (radio.mode === 'track') step(k === 'ff' ? 1 : -1); }
        else if (k === 'mute') {
            if (radio.native) { void box('The phone\'s player is playing: use the volume keys.', 'info'); return; }
            if (radio.audio) radio.audio.muted = !radio.audio.muted;
        } else if (k === 'timer') { els.auto.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
        renderDeck();
    }
    async function deckMode() {
        const st = tapes.deck || {};
        const mode = st.mode === 'long' ? 'song' : 'long';
        tapes.deck = Object.assign({}, st, { mode });
        renderDeck();
        try { const d = await ask('xmradio_deck_set', { mode }); if (d && d.deck) tapes.deck = d.deck; } catch (_) { /* kept here */ }
        renderDeck();
    }

    function render() {
        if (!els) return;
        page.querySelectorAll('[data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== tab; });
        page.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
        if (tab !== 'now') clearTimeout(progTimer);
        if (tab !== 'deck') clearTimeout(deckTimer);
        if (tab === 'now') renderNow();
        else if (tab === 'channels') renderChannels();
        else if (tab === 'recordings') renderRecordings();
        else renderDeck();
    }

    function selTrack() { return (tapes.tracks[tapes.open] || []).find((t) => t.id === tapes.sel) || null; }

    function menu() {
        const playing = radio.state === 'playing' || radio.state === 'tuning';
        const id = curId();
        const admin = isAdmin();
        if (tab === 'recordings') {
            const t = selTrack();
            const others = (tapes.list || []).filter((n) => n !== tapes.open);
            if (tapes.open) {
                return [
                    { label: 'Play', disabled: !t, action: () => { const list = tapes.tracks[tapes.open] || []; void playTrack(list, list.indexOf(t)); } },
                    { label: 'Play Tape', disabled: !(tapes.tracks[tapes.open] || []).length, action: () => { void playTrack(tapes.tracks[tapes.open], 0); } },
                    '-',
                    { label: 'Save to Phone', disabled: !t, action: () => { void trackAction('save', t); } },
                    { label: 'Rename...', disabled: !t || !admin, action: () => { void trackAction('rename', t); } },
                    { label: 'Move to Tape', disabled: !t || !admin || !others.length, submenu: others.map((n) => ({ label: n, action: () => { void trackAction(`move:${n}`, t); } })) },
                    { label: 'Delete', disabled: !t || !admin, action: () => { void trackAction('delete', t); } },
                    '-',
                    { label: 'Save Tape to Phone', action: () => { void tapeAction('save', tapes.open); } },
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
        if (tab === 'deck') {
            return [
                { label: 'Record Channel...', disabled: !id || !admin || !!manualRec(), action: () => { void recordChannel(id); } },
                { label: 'Stop Recording', disabled: !manualRec(), action: () => { void stopRec(manualRec()); } },
                { label: 'Split', submenu: [['song', 'Each Song'], ['long', 'One Continuous File']].map(([v, l]) => ({ label: l, radio: ((tapes.deck || {}).mode || 'song') === v, action: () => { if (((tapes.deck || {}).mode || 'song') !== v) void deckMode(); } })) },
                { label: 'Change Tape...', action: () => setTab('recordings') },
                '-',
                { label: 'Add Scheduled Recording...', disabled: !admin, action: () => { void timerAdd(); } },
                { label: 'Add Search Term...', disabled: !admin, action: () => { void termAdd(); } },
                { label: 'Refresh', action: () => { void loadTapes(true); } }
            ];
        }
        const slots = (bank) => Array.from({ length: 10 }, (_, i) => { const cur = chan((cache.presets[bank] || [])[i]); return { label: `${i + 1}${cur ? `  ${cur.number} ${cur.name}` : '  (empty)'}`, action: () => { void setPreset(bank, i); } }; });
        const sl = sleepLeft();
        return [
            { label: playing ? (radio.native ? 'Stop' : 'Pause') : 'Play', action: playPause },
            { label: radio.mode === 'track' ? 'Next Recording' : 'Channel Up', action: () => step(1) },
            { label: radio.mode === 'track' ? 'Previous Recording' : 'Channel Down', action: () => step(-1) },
            { label: 'Back to Live', disabled: !replaying(), action: goLive },
            '-',
            { label: 'Record This Song...', disabled: !id || !admin, action: () => { void recordAsk(id); } },
            { label: 'Record Channel...', disabled: !id || !admin || !!recOf(id), action: () => { void recordChannel(id); } },
            { label: 'Alert', disabled: !admin, submenu: [{ label: 'This Artist', action: () => { void setAlert('artist'); } }, { label: 'This Song', action: () => { void setAlert('song'); } }] },
            '-',
            { label: 'Show', submenu: [['A', 'Presets A'], ['B', 'Presets B'], ['C', 'Presets C'], ['guide', 'Channel Guide'], ['all', 'All Channels']].map(([v, t]) => ({ label: t, radio: prefs.show === v, action: () => { prefs.show = v; saveSoon(); setTab('channels'); } })) },
            { label: "Search What's On...", action: () => { void searchAsk(); } },
            { label: 'Direct Tune...', action: () => { void directTune(); } },
            { label: 'Add to Presets', disabled: !id || !admin, submenu: ['A', 'B', 'C'].map((b) => ({ label: `Bank ${b}`, submenu: slots(b) })) },
            '-',
            { label: 'View', submenu: [['screen', 'Screen'], ['faceplate', 'Faceplate']].map(([v, t]) => ({ label: t, radio: prefs.view === v, action: () => { prefs.view = v; saveSoon(); setTab('now'); } })) },
            { label: 'Radio', submenu: BODIES.map(([v, t]) => ({ label: t, radio: prefs.body === v, action: () => { prefs.body = v; saveSoon(); render(); } })) },
            { label: 'Brand', submenu: ERAS.map(([v, t]) => ({ label: t, radio: prefs.era === v, action: () => { prefs.era = v; saveSoon(); render(); } })) },
            { label: 'Quality', submenu: QUALITIES.map(([v, t]) => ({ label: t, radio: prefs.quality === v, action: () => { prefs.quality = v; saveSoon(); if (radio.mode === 'live' && radio.channelId && radio.state !== 'off') void tune(radio.channelId, { back: radio.back }); } })) },
            { label: sl ? `Sleep Timer (${sl} min)` : 'Sleep Timer', submenu: SLEEP.map((m) => ({ label: m ? `${m} minutes` : 'Off', radio: m ? Math.abs(sl - m) < 1 : !sl, disabled: !m ? false : radio.state === 'off', action: () => setSleep(m) })) },
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
            if (tab === 'now') void loadSchedule(curId());
            if (tab === 'recordings' || tab === 'deck') void loadTapes(false);
            if (tab === 'channels' && prefs.show === 'guide') void loadGuide();
            render();
            void syncHub();
        },
        hide() {
            shown = false;
            clearTimeout(progTimer);
            clearTimeout(deckTimer);
            void syncHub();
        },
        softKeys() {
            const id = curId();
            if (tab === 'recordings') {
                if (tapes.open) return { left: { label: tapes.sel ? 'Play' : 'Back', action: () => { if (tapes.sel) { const list = tapes.tracks[tapes.open] || []; const t = selTrack(); void playTrack(list, list.indexOf(t)); } else closeTape(); } }, right: { label: 'Menu', menu } };
                return { left: { label: 'New Tape', disabled: !isAdmin(), action: () => { void tapeAction('new'); } }, right: { label: 'Menu', menu } };
            }
            if (tab === 'deck') { const r = manualRec(); return { left: r ? { label: 'Stop', action: () => { void stopRec(r); } } : { label: 'Record', disabled: !id || !isAdmin(), action: () => { void recordChannel(id); } }, right: { label: 'Menu', menu } }; }
            return { left: recKey(id), right: { label: 'Menu', menu } };
        },
        onBack() {
            if (tab === 'recordings' && tapes.open) { closeTape(); return true; }
            if (tab === 'channels' && prefs.show === 'search') { prefs.show = 'A'; render(); return true; }
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

    /** Today's play / pause (Yukimi: controls on Today): plays the page's channel, or pauses / stops it when it plays. */
    function todayPlay(id) {
        if (!id) return;
        const on = id === radio.channelId && (radio.state === 'playing' || radio.state === 'tuning');
        if (on) playPause();
        else void tune(id);
    }

    function bindToday(el) {
        el.dataset.xrmBound = '1';
        el.classList.add('wtw', 'xrm-today');
        let down = null;
        let swiped = 0;
        const slide = () => el.querySelector('.xrm-td-slide');
        el.addEventListener('pointerdown', (e) => {
            if (e.button || e.target.closest('.xrm-td-arrow, .xrm-td-rec, .xrm-td-play')) return;
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
            if (r) { e.stopPropagation(); todayRecord(todayPageId()); return; }
            const p = e.target.closest('.xrm-td-play');
            if (p) { e.stopPropagation(); todayPlay(todayPageId()); return; }
            todayTap(todayPageId());
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
        const playing = !!id && id === radio.channelId && (radio.state === 'playing' || radio.state === 'tuning');
        if (c) {
            const now = nowOf(id);
            const pic = now && !now.ad && now.i ? now.i : c.logo;
            inner = `<span class="xrm-td-pic">${pic ? `<img src="${esc(pic)}" alt="" decoding="async" draggable="false">` : `<b>${esc(c.number)}</b>`}</span><span class="wtw-lines"><span class="wtw-title">${esc(now ? (now.ad ? 'Commercial' : now.t || c.name) : c.name)}</span><span class="wtw-sub">${esc(now && !now.ad && now.a ? now.a : '')}</span><span class="wtw-sub">${esc(chanLabel(c))}${playing ? ' · Playing' : ''}</span></span>`;
        } else {
            inner = `<img class="xrm-td-icon" src="${ws.art.url('app-xmradio-lg')}" srcset="${ws.art.srcset('app-xmradio-lg')}" alt="" draggable="false"><span class="wtw-lines"><span class="wtw-title">XM Radio</span><span class="wtw-sub">${esc(cache.lineup ? 'Tap to choose a channel' : 'Reading the channels...')}</span></span>`;
        }
        const many = ids.length > 1;
        const rec = !!(id && recOf(id));
        const playBtn = c ? `<button type="button" class="xrm-td-play" aria-label="${playing ? 'Pause' : 'Play'}">${playing ? '&#x23F8;&#xFE0E;' : '&#x25B6;&#xFE0E;'}</button>` : '';
        const recBtn = c && isAdmin() ? `<button type="button" class="xrm-td-rec${rec ? ' is-rec' : ''}" aria-label="${rec ? 'Stop recording' : 'Record'}">${rec ? 'Stop' : 'Record'}</button>` : '';
        const html = `<button type="button" class="xrm-td-arrow" data-dir="prev" aria-label="Previous channel"${many ? '' : ' disabled'}>&#x2039;</button><div class="xrm-td-slide">${inner}</div>${playBtn}${recBtn}<button type="button" class="xrm-td-arrow" data-dir="next" aria-label="Next channel"${many ? '' : ' disabled'}>&#x203A;</button>`;
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
        const go = () => openChannel(curId());
        if (!ids.length) {
            return { label: 'xm radio', icon: 'x:app-xmradio-lg', pages: [{ title: 'XM Radio', line2: cache.lineup ? 'Tap to choose a channel' : 'Reading the channels...', line3: '' }], softKey: { label: 'Radio', action: go }, onTap: go };
        }
        warmTiIcons(ids, Math.max(0, ids.indexOf(todayPageId())));
        // the superscript by the panel's name: "rec" while a recording runs, else the channel's number only while the
        // radio is tuned to it and playing (Yukimi, Nov 21 2026)
        const cur = onAir(radio.channelId) ? chan(radio.channelId) : null;
        return {
            label: 'xm radio',
            count: (cache.rec || []).length ? 'rec' : cur ? String(cur.number) : '',
            icon: 'x:app-xmradio-lg',
            pages: ids.map((id) => {
                const c = chan(id);
                const now = nowOf(id);
                const playing = onAir(id);
                const pic = now && !now.ad && now.i ? now.i : c.logo;
                return {
                    // the song's picture at the left; the channel's logo is the panel icon at the top right
                    // (Yukimi, Nov 21 2026), the radio's own icon only for a channel with no logo
                    icon: tiIconOf(c) || undefined,
                    image: pic || undefined,
                    imageAspect: 1,
                    title: now ? (now.ad ? 'Commercial' : now.t || c.name) : c.name,
                    line2: now && !now.ad ? now.a || '' : '',
                    line3: `${chanLabel(c)}${playing ? ' · Playing' : ''}`,
                    softKey: recKey(id),
                    onTap: () => todayTap(id),
                    // tap-and-hold: the radio's own controls from Today (Yukimi, Nov 20 2026)
                    menu: () => [
                        { label: playing ? (radio.native ? 'Stop' : 'Pause') : 'Play', action: () => todayPlay(id) },
                        { label: 'Channel Up', action: () => { if (playing) step(1); else todayStep(1); } },
                        { label: 'Channel Down', action: () => { if (playing) step(-1); else todayStep(-1); } },
                        '-',
                        { label: recOf(id) ? 'Stop Recording' : todayOpt('recsong') ? 'Record This Song' : 'Record This Song...', disabled: !isAdmin(), action: () => todayRecord(id) },
                        { label: 'Open XM Radio', action: () => openChannel(id) }
                    ]
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
        document.addEventListener('visibilitychange', () => { void syncHub(); if (shown) render(); }, { signal: appScopeSignal });
        window.addEventListener('melatonscreen', () => { void syncHub(); }, { signal: appScopeSignal });
        // the native player's news (DSApp): stopped from its notification, the stream ended, or a channel changed there
        window.addEventListener('dreamscape:videos', (e) => {
            let d = e.detail;
            if (typeof d === 'string') { try { d = JSON.parse(d); } catch (_) { d = null; } }
            if (!radio.native || !d) return;
            if (d.state === 'channel' && d.id && chan(d.id)) {
                if (radio.channelId !== d.id) radio.prevId = radio.channelId;
                radio.channelId = d.id;
                prefs.channel = d.id;
                radio.back = 0;
                saveSoon();
                tellWatch();
                void loadSchedule(d.id);
                changed();
                return;
            }
            if (d.state === 'stopped' || d.state === 'ended' || d.state === 'lost') { radio.native = false; radio.state = 'off'; sleep.at = 0; changed(); }
        }, { signal: appScopeSignal });
        // wake to the radio (Settings > Clock & Alarms: an alarm whose sound is a channel, wmLock65.js): the page rings
        // it here while it is in front (the app plays it itself while the page sleeps)
        document.addEventListener('xmradio:alarm', (e) => {
            const d = e.detail || {};
            if (d.on && d.channelId && chan(d.channelId)) { radio.alarm = true; void tune(d.channelId); }
            else if (!d.on && radio.alarm) { radio.alarm = false; stopRadio(); }
        }, { signal: appScopeSignal });
        void syncHub();
        return true;
    }

    function register() {
        ws = window.wmShell;
        if (!ws) return;
        ws.registerApp(APP);
        if (typeof ws.registerTodayItem === 'function') {
            ws.registerTodayItem({
                id: 'xmradio', label: 'XM Radio', icon: 'app-xmradio', after: 'youtube', render: todayRender, titanium: todayTitanium,
                options: [{ key: 'today', label: 'XM Radio', type: 'checks', value: TODAY_OPTS.map((o) => o[0]).join(','), choices: TODAY_OPTS }]
            });
        }
        if (!wire()) window.addEventListener('load', () => { wire(); }, { once: true, signal: appScopeSignal });
    }

    if (window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
