/**
 * Melaton Mobile: XM Radio (Yozora #989), the phone's side of the desktop's SiriusXM radio (apps/xmradio).
 *
 * Yukimi, Nov 20 2026: "With today item and for titanium the item will show what's on air as LR pages and soft-key to
 * one touch record this where it records from the start. Really it should always ask do you want to record from the
 * start." The soft key reads Record on a channel, and REC while that channel is being recorded.
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
    const prefs = Object.assign({ channel: '', quality: 'std', show: 'A', todayAt: 0 }, readJson(LS_PREFS, {}));
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
    const radio = { channelId: '', state: 'off', native: false, url: '', hls: null, audio: null, seq: 0 };

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
            else if (k === 'rec') cache.rec = Array.isArray(v) ? v : [];
            else if (k.startsWith('ch:')) { if (v) cache.now[k.slice(3)] = v; else delete cache.now[k.slice(3)]; }
        }
        saveSoon();
        if (lineupMoved || !cache.lineup || Date.now() - (cache.lineup.at || 0) > LINEUP_MS) void loadLineup(lineupMoved);
        changed();
    }

    async function loadLineup(force) {
        if (lineupAsked && !force) return;
        lineupAsked = true;
        try {
            const d = await ask('xmradio_lineup', {}, 120000);
            const channels = (d.channels || []).map((c) => ({ id: c.id, number: c.number, name: c.name, logo: c.logo || '', sub: c.sub === false ? false : undefined }));
            if (channels.length) cache.lineup = { at: Date.now(), channels };
            if (d.presets) cache.presets = Object.assign({ A: [], B: [], C: [] }, d.presets);
            indexLineup();
            saveSoon();
            changed();
            void wantLogos(todayChannels().concat(cache.presets.A || [], cache.presets.B || [], cache.presets.C || []));
        } catch (_) { lineupAsked = false; }
    }

    async function wantLogos(ids) {
        const want = [...new Set(ids.filter((id) => id && chan(id) && !chan(id).logo && !logoAsked.has(id)))].slice(0, 40);
        if (!want.length) return;
        want.forEach((id) => logoAsked.add(id));
        try {
            const d = await ask('xmradio_logos', { ids: want }, 60000);
            for (const [id, url] of Object.entries((d && d.logos) || {})) { const c = chan(id); if (c) c.logo = url; }
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
        radio.channelId = id;
        prefs.channel = id;
        saveSoon();
        radio.state = 'tuning';
        const seq = ++radio.seq;
        changed();
        tellWatch();
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
        await start(seq);
    }

    /** The native player when the app takes radio streams, else the page's own (hls.js). */
    async function start(seq) {
        dropPage();
        dropNative();
        const c = chan(radio.channelId);
        const now = nowOf(radio.channelId);
        const nv = nativePlayer();
        if (nv) {
            try {
                nv.watching(JSON.stringify({ url: radio.url, title: chanLabel(c), subtitle: now && !now.ad ? [now.a, now.t].filter(Boolean).join(' - ') : 'SiriusXM', audioOnly: true }));
                radio.native = nv.handOff() === true;
            } catch (_) { radio.native = false; }
            if (radio.native) { radio.state = 'playing'; changed(); return; }
            try { nv.watching(''); } catch (_) { /* older app */ }
        }
        if (!radio.audio) {
            radio.audio = document.createElement('audio');
            radio.audio.preload = 'none';
            for (const t of ['playing', 'pause', 'waiting', 'error']) radio.audio.addEventListener(t, () => onAudio(t), { signal: appScopeSignal });
        }
        let Hls = null;
        try { Hls = await loadHls(); } catch (_) { Hls = null; }
        if (seq !== radio.seq) return;
        const a = radio.audio;
        if (Hls && Hls.isSupported()) {
            const h = new Hls({ liveSyncDurationCount: 3, maxBufferLength: 30, backBufferLength: 120, enableWorker: true });
            radio.hls = h;
            h.on(Hls.Events.ERROR, (ev, d) => { if (d && d.fatal && radio.hls === h) { radio.state = 'error'; changed(); } });
            h.loadSource(radio.url);
            h.attachMedia(a);
        } else if (a.canPlayType('application/vnd.apple.mpegurl')) {
            a.src = radio.url;
        } else { radio.state = 'error'; changed(); return; }
        try { await a.play(); } catch (_) { radio.state = 'paused'; changed(); }
    }

    function onAudio(t) {
        if (radio.native) return;
        if (t === 'playing') radio.state = 'playing';
        else if (t === 'pause' && radio.state === 'playing') radio.state = 'paused';
        else if (t === 'waiting' && radio.state !== 'paused') radio.state = 'tuning';
        else if (t === 'error') radio.state = 'error';
        changed();
    }

    function playPause() {
        if (radio.state === 'off' || radio.state === 'error' || !radio.url) { const id = radio.channelId || prefs.channel || todayChannels()[0]; if (id) void tune(id); return; }
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

    function step(dir) {
        const list = ((cache.lineup && cache.lineup.channels) || []).filter((c) => c.sub !== false || c.id === radio.channelId);
        if (!list.length) return;
        const i = list.findIndex((c) => c.id === (radio.channelId || prefs.channel));
        const n = list.length;
        void tune(list[((i < 0 ? 0 : i + dir) % n + n) % n].id);
    }

    // ---------------------------------------------------------------- recording (one touch, from the start)

    /**
     * Record (Yukimi): the song on air on a channel, asking first whether from its start. REC (that channel records
     * now): offers to stop it.
     */
    async function recordAsk(id) {
        if (!isAdmin()) { void box('Recording is for the administrator.', 'info'); return; }
        const c = chan(id);
        if (!c) return;
        const rec = recOf(id);
        if (rec) {
            const stop = await ws.messageBox({ title: TITLE, icon: 'question', text: `${chanLabel(c)} is recording${rec.kind === 'song' ? ' this song' : ''}.\n\nStop the recording? What is recorded so far is saved to the tape.`, buttons: [{ text: 'Stop', value: true }, { text: 'Keep', value: false }] });
            if (!stop) return;
            try { await ws.busy(ask('xmradio_rec_stop', { rid: rec.rid }, 120000), { delay: 300, timeout: 120000 }); } catch (err) { void box((err && err.message) || 'The recording could not be stopped.'); return; }
            cache.rec = cache.rec.filter((r) => r.rid !== rec.rid);
            changed();
            return;
        }
        const now = nowOf(id);
        const what = now && !now.ad && now.t ? `"${now.t}"${now.a ? ` by ${now.a}` : ''}` : `what is on ${chanLabel(c)}`;
        // always asked (Yukimi: "it should always ask do you want to record from the start")
        const choice = await ws.messageBox({ title: TITLE, icon: 'question', text: `Record ${what} from the start?\n\nNo records from now. The song is saved to the cassette deck's tape when it ends.`, buttons: [{ text: 'Yes', value: 'start' }, { text: 'No', value: 'now' }, { text: 'Cancel', value: false }] });
        if (!choice) return;
        try {
            const r = await ws.busy(ask('xmradio_rec_start', { channelId: id, song: true, fromStart: choice === 'start' }, 30000), { delay: 300, timeout: 30000 });
            if (r && r.rid) cache.rec = (cache.rec || []).filter((x) => x.rid !== r.rid).concat({ rid: r.rid, channelId: id, kind: r.kind, since: r.since });
            saveSoon();
            changed();
        } catch (err) { void box((err && err.message) || 'The recording could not be started.'); }
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

    // ---------------------------------------------------------------- the program

    function build() {
        page.innerHTML = `<div class="xrm-now"><div class="xrm-top"><img class="xrm-logo" alt="" draggable="false" hidden><span class="xrm-ch"></span><span class="xrm-state"></span></div>
            <div class="xrm-body"><img class="xrm-art" alt="" draggable="false" hidden><div class="xrm-lines"><div class="xrm-t1"></div><div class="xrm-t2"></div><div class="xrm-t3"></div></div></div></div>
            <div class="xrm-head"><span class="xrm-show"></span><span class="xrm-count"></span></div>
            <div class="xrm-list wm-pg-scroll" role="listbox"></div>`;
        els = {
            logo: page.querySelector('.xrm-logo'), ch: page.querySelector('.xrm-ch'), state: page.querySelector('.xrm-state'),
            art: page.querySelector('.xrm-art'), t1: page.querySelector('.xrm-t1'), t2: page.querySelector('.xrm-t2'), t3: page.querySelector('.xrm-t3'),
            show: page.querySelector('.xrm-show'), count: page.querySelector('.xrm-count'), list: page.querySelector('.xrm-list')
        };
        els.list.addEventListener('click', (e) => {
            const row = e.target.closest('[data-id]');
            if (row) void tune(row.dataset.id);
        });
        page.querySelector('.xrm-now').addEventListener('click', () => playPause());
    }

    const setImg = (img, src) => { if (!src) { img.hidden = true; img.removeAttribute('src'); return; } if (img.getAttribute('src') !== src) img.src = src; img.hidden = false; };
    const setText = (el, t) => { if (el.textContent !== t) el.textContent = t; };
    let listKey = '';

    function listIds() {
        if (prefs.show === 'all') return ((cache.lineup && cache.lineup.channels) || []).filter((c) => c.sub !== false).map((c) => c.id);
        return (cache.presets[prefs.show] || []).filter((id) => id && chan(id));
    }

    function render() {
        if (!els) return;
        const id = radio.channelId || prefs.channel;
        const c = chan(id);
        const now = nowOf(id);
        const rec = recOf(id);
        setImg(els.logo, c && c.logo);
        setText(els.ch, c ? chanLabel(c) : (cache.lineup ? 'Choose a channel' : 'Reading the channels...'));
        const st = { off: 'Off', tuning: 'Tuning...', playing: radio.native ? 'Playing' : 'Playing', paused: 'Paused', error: 'No signal' }[radio.state] || '';
        setText(els.state, rec ? `REC  ${st}` : st);
        els.state.classList.toggle('is-rec', !!rec);
        setImg(els.art, now && !now.ad && now.i ? now.i : (c && c.logo) || '');
        setText(els.t1, now ? (now.ad ? 'SiriusXM' : now.t || '') : (c ? c.name : ''));
        setText(els.t2, now ? (now.ad ? 'Commercial' : now.a || '') : '');
        setText(els.t3, now && now.s ? now.s : '');
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

    function menu() {
        const playing = radio.state === 'playing' || radio.state === 'tuning';
        const id = radio.channelId || prefs.channel;
        const slots = (bank) => Array.from({ length: 10 }, (_, i) => { const cur = chan((cache.presets[bank] || [])[i]); return { label: `${i + 1}${cur ? `  ${cur.number} ${cur.name}` : '  (empty)'}`, action: () => { void setPreset(bank, i); } }; });
        return [
            { label: playing ? (radio.native ? 'Stop' : 'Pause') : 'Play', action: playPause },
            { label: 'Channel Up', action: () => step(1) },
            { label: 'Channel Down', action: () => step(-1) },
            '-',
            { label: 'Show', submenu: [['A', 'Presets A'], ['B', 'Presets B'], ['C', 'Presets C'], ['all', 'All Channels']].map(([v, t]) => ({ label: t, radio: prefs.show === v, action: () => { prefs.show = v; saveSoon(); render(); } })) },
            { label: 'Direct Tune...', action: () => { void directTune(); } },
            { label: 'Add to Presets', disabled: !id || !isAdmin(), submenu: ['A', 'B', 'C'].map((b) => ({ label: `Bank ${b}`, submenu: slots(b) })) },
            { label: 'Quality', submenu: QUALITIES.map(([v, t]) => ({ label: t, radio: prefs.quality === v, action: () => { prefs.quality = v; saveSoon(); if (radio.channelId && radio.state !== 'off') void tune(radio.channelId); } })) },
            { label: 'Alert', disabled: !isAdmin(), submenu: [{ label: 'This Artist', action: () => { void setAlert('artist'); } }, { label: 'This Song', action: () => { void setAlert('song'); } }] },
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
            render();
            void syncHub();
        },
        hide() {
            shown = false;
            void syncHub();
        },
        softKeys() {
            const id = radio.channelId || prefs.channel;
            return { left: recKey(id), right: { label: 'Menu', menu } };
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
        const recCount = (cache.rec || []).length;
        return {
            label: 'xm radio',
            count: recCount ? 'REC' : '',
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
