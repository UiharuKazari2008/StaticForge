/**
 * Melaton Videos (Yozora #861), first Melaton Mobile: YouTube (Yozora #839). Since #861 the program is
 * called Videos: its Feed mixes YouTube with Kick live streams (channels added by name under Channels) and
 * the notifications of chosen Android apps (relayed by the phone over ActiveSync); what is live now leads
 * the Feed and Today. The program's id, files and packets keep the name youtube.
 *
 * The first brief: Yukimi, Nov 15 2026: "a youtube app for mobile that you login
 * to and it shows you polished HTC Sense like UI where you can see your subscriptions, Watch Later,
 * Search"; tapping a video opens it in Android's YouTube app; a Today item for 6.1 and 6.5 pages left
 * and right through the latest uploads of a chosen list of favourite channels.
 *
 * Our own design in the manner of the HTC Sense programs of 2009-2010: black glass, a glossy header,
 * framed thumbnails, a red accent and press glow (Yukimi: "make the app theme red") and Sense's bottom tab strip whose glass slider follows the
 * finger (Subscriptions, Watch Later, Search, Channels). The first video of a list is shown large.
 *
 * Data: the server's YouTube service (modules/youtubeService.js, 308-youtubeHandler.js). Sign-in is
 * Google's device flow: the program shows a code to enter on google.com/device and the server waits
 * for Google. Status (account, favourite channels, their latest uploads, settings) is pushed through
 * the statusHub feed `youtube` while Today's item or this program is on screen; this file never polls.
 * The Subscriptions list is answered at once from what the server holds; when its look for new uploads
 * finishes, the status feed's `feed.at` moves and the list is read again (no call to YouTube).
 * Lists (youtube_feed, youtube_watch_later, youtube_search, youtube_subscriptions, youtube_channel)
 * are read when their page is opened, on Refresh, or when they are older than 15 minutes on return.
 *
 * Holding a video offers Mark as Watched / Unwatched and Add to / Remove from Watch Later. Watched is the
 * account's own YouTube watch history (Yukimi: she watches with friends and in the YouTube app): the server's
 * browser reads it and makes the mark there. Watched videos are dimmed and sit below the rest of the
 * Subscriptions list; a started one shows how far it was played. A clock on the picture says a video
 * is in Watch Later.
 *
 * A video opens in the phone's YouTube app through the Dreamscape app's link bridge
 * (window.AndroidLinks.openNative); without the bridge the link opens the way the browser opens it.
 *
 * window.wmYouTube: open(tab?), state(), reload().
 * Art: public/static_images/wm61/app-youtube*, wm65 start-youtube and the ti-x panel
 * (scripts/generate-wm-youtube-art.js). Styles: public/css/wm-youtube.css. Phones only. The account is
 * the administrator's (dev_admin test tabs may read).
 */
(function () {
    'use strict';
    const appScopeSignal = (window.melatonSegments && typeof window.melatonSegments.callerSignal === 'function' && window.melatonSegments.callerSignal()) || undefined; // page listeners end with this file's segment (app-scope, #872/#890)

    const MOBILE = window.uiShell === 'mobile' && document.documentElement.classList.contains('ui-mobile');
    if (!MOBILE) return;

    const APP_ID = 'youtube';
    const TITLE = 'Videos';
    const KICK_PACKAGE = 'com.kick.mobile';
    const YT_PACKAGE = 'com.google.android.youtube';
    const STALE_MS = 15 * 60000;
    const DAY = 86400000;
    const LS_TAB = 'wmYouTubeTab';
    const LS_RECENT = 'wmYouTubeRecent';

    const I = {
        subs: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><rect x="1.5" y="5.5" width="13" height="8.5" rx="1.5"/><path d="M3.5 3.5h9M5.5 1.5h5" stroke-linecap="round"/><path d="M6.8 8.2l3.2 1.6-3.2 1.6z" fill="currentColor"/></svg>',
        later: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6.2"/><path d="M8 4.4V8l2.6 1.6"/></svg>',
        search: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="6.8" cy="6.8" r="4.4"/><path d="M10.2 10.2l4 4"/></svg>',
        channels: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M8 1.6l1.9 4 4.4.6-3.2 3 .8 4.4L8 11.5l-3.9 2.1.8-4.4-3.2-3 4.4-.6z"/></svg>',
        star: '<svg viewBox="0 0 20 20"><path d="M10 2l2.4 5 5.5.7-4 3.8 1 5.5-4.9-2.7L5.1 17l1-5.5-4-3.8L7.6 7z"/></svg>',
        later: '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="6" cy="6" r="4.6"/><path d="M6 3.4V6l1.9 1.2"/></svg>',
        bell: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M8 1.8a4 4 0 0 0-4 4v2.6L2.6 11h10.8L12 8.4V5.8a4 4 0 0 0-4-4z"/><path d="M6.5 13.2a1.6 1.6 0 0 0 3 0" stroke-linecap="round"/></svg>',
        clock: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><circle cx="8" cy="8" r="6.2"/><path d="M8 4.4V8l2.6 1.6"/></svg>',
        left: '<svg viewBox="0 0 7 11"><path d="M6 0.5L1 5.5l5 5z" fill="currentColor"/></svg>',
        right: '<svg viewBox="0 0 7 11"><path d="M1 0.5l5 5-5 5z" fill="currentColor"/></svg>'
    };
    const TABS = [
        { id: 'subs', label: 'Feed', icon: I.subs },
        { id: 'later', label: 'Watch Later', icon: I.later },
        { id: 'search', label: 'Search', icon: I.search },
        { id: 'channels', label: 'Channels', icon: I.channels }
    ];

    let ws = null;
    let page = null;
    let els = null;
    let shown = false;
    let stale = true; // the page was not drawn since the last change (hidden screens never draw)
    let wired = false;
    let loaded = false; // the server's status has arrived at least once
    let hub = { account: null, favourites: [], latest: { videos: [] }, live: { items: [] }, sources: { kick: [], apps: [], seenApps: [], kickReady: false }, settings: {} };
    let tab = (() => { try { const t = localStorage.getItem(LS_TAB); return TABS.some((x) => x.id === t) ? t : 'subs'; } catch (_) { return 'subs'; } })();
    const data = {
        subs: { videos: null, at: 0, loading: false, error: '', note: '', refreshing: false, feedAt: 0 },
        later: { videos: null, at: 0, loading: false, error: '', unavailable: false, why: '' },
        search: { query: '', videos: null, channels: [], next: '', loading: false, error: '' },
        channels: { list: null, at: 0, loading: false, error: '' }
    };
    let layer = null; // { id, channel, videos, loading, error, favourite }
    const seen = new Map(); // video id -> video, channel id -> channel (what the rows on screen stand for)
    let starBusy = false;
    let todayAt = 0;
    let todayHtml = '';
    let todayDir = '';

    const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const canUse = () => { try { return /^(admin|dev_admin)$/.test(localStorage.getItem('userType') || ''); } catch (_) { return false; } };
    const isAdmin = () => { try { return localStorage.getItem('userType') === 'admin'; } catch (_) { return false; } };
    const client = () => (window.wsClient && (!window.wsClient.isConnected || window.wsClient.isConnected()) ? window.wsClient : null);
    const acct = () => hub.account || {};
    const signedIn = () => !!acct().signedIn;
    const favIds = () => new Set((hub.favourites || []).map((f) => f.id));
    const latest = () => (hub.latest && Array.isArray(hub.latest.videos) ? hub.latest.videos : []);
    const liveNow = () => (hub.live && Array.isArray(hub.live.items) ? hub.live.items.filter((v) => !v.watched) : []);
    /** Today's pages: who is live now first, then the favourites' uploads still to watch. */
    const todayList = () => liveNow().concat(latest());
    const srcOf = (v) => v.source || 'youtube';

    // ---------------------------------------------------------------- formatting

    const fmtDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'} ago`;
    /** "5 minutes ago", "3 hours ago", "2 days ago", "3 weeks ago", else the date. */
    function age(at) {
        if (!at) return '';
        const ms = Date.now() - at;
        if (ms < 0) return fmtDate.format(new Date(at));
        const min = Math.floor(ms / 60000);
        if (min < 1) return 'Just now';
        if (min < 60) return plural(min, 'minute');
        const h = Math.floor(min / 60);
        if (h < 24) return plural(h, 'hour');
        const d = Math.floor(h / 24);
        if (d < 7) return plural(d, 'day');
        if (d < 35) return plural(Math.floor(d / 7), 'week');
        if (d < 365) return plural(Math.floor(d / 30.4), 'month');
        return fmtDate.format(new Date(at));
    }
    /** Seconds as 4:05 or 1:02:03. */
    function clock(sec) {
        if (typeof sec !== 'number' || !Number.isFinite(sec) || sec <= 0) return '';
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        const s = Math.floor(sec % 60);
        return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
    }
    /** "First in 3 weeks" for an upload that came a long while after the channel's one before it. */
    function rareText(v) {
        const d = typeof v.gap === 'number' ? Math.floor(v.gap / DAY) : 0;
        if (d < 14) return '';
        return d < 60 ? `First in ${Math.floor(d / 7)} weeks` : d < 730 ? `First in ${Math.floor(d / 30.4)} months` : `First in ${Math.floor(d / 365)} years`;
    }
    const lenText = (v) => (v.live === 'live' ? 'LIVE' : v.live === 'upcoming' ? 'SOON' : clock(v.length));
    const isNew = (v) => !!(v.at && Date.now() - v.at < DAY);
    const videoUrl = (id) => `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
    const channelUrl = (id) => `https://www.youtube.com/channel/${encodeURIComponent(id)}`;

    // ---------------------------------------------------------------- opening things on the phone

    /** Hands a link to Android's YouTube app, else to whichever app or browser takes it. */
    function openUrl(url, native, pkg) {
        const L = window.AndroidLinks;
        try {
            if (L && typeof L.openNative === 'function') {
                if (native !== false && L.openNative(url, pkg || YT_PACKAGE) === true) return true;
                if (native !== false && L.openNative(url, '') === true) return true;
                if (typeof L.openBrowser === 'function' && L.openBrowser(url) === true) return true;
            }
        } catch (_) { /* the plain way below */ }
        try { window.open(url, '_blank', 'noopener'); return true; } catch (_) { return false; }
    }
    /** Opens the video in the YouTube app (which records the viewing itself: the server reads the account's history). */
    const openVideo = (id) => openUrl(videoUrl(id));
    /** Starts an Android program by its package (an app whose notification is in the feed). */
    function launchApp(pkg, name) {
        let ok = false;
        try { ok = !!(window.AndroidApps && window.AndroidApps.launch(pkg) === true); } catch (_) { ok = false; }
        if (!ok) box(`${name || 'That program'} can only be started on the phone it is installed on.`, 'info');
        return ok;
    }
    /** A feed item, by where it comes from: YouTube's app, Kick's app (or its site), or the app that posted. */
    function openItem(v) {
        if (!v) return false;
        if (srcOf(v) === 'kick') return openUrl(v.url || `https://kick.com/${String(v.id).replace(/^kick:/, '')}`, true, KICK_PACKAGE);
        if (srcOf(v) === 'app') {
            // on the phone that posted the notification: what a tap on the notification itself opens (the stream)
            const A = window.AndroidActiveSync;
            try {
                if (v.key && A && typeof A.openNotification === 'function' && (!v.device || typeof A.getDeviceId !== 'function' || A.getDeviceId() === v.device) && A.openNotification(v.key) === true) return true;
            } catch (_) { /* the app itself below */ }
            return launchApp(v.package, v.channel);
        }
        return openVideo(v.id);
    }

    async function copyText(text) {
        try { await navigator.clipboard.writeText(text); return true; } catch (_) { /* older WebView */ }
        try {
            const t = document.createElement('textarea');
            t.value = text;
            t.style.cssText = 'position:fixed;left:-999px;top:0';
            document.body.appendChild(t);
            t.select();
            const ok = document.execCommand('copy');
            t.remove();
            return ok;
        } catch (_) { return false; }
    }

    // ---------------------------------------------------------------- server

    async function ask(type, payload, ms = 30000) {
        const c = client();
        if (!c) throw new Error('Not connected to the server');
        const r = await Promise.race([
            c.sendMessage(type, payload || {}, false),
            new Promise((_, reject) => setTimeout(() => reject(new Error('The server did not answer in time')), ms))
        ]);
        return r && r.data && typeof r.data === 'object' ? r.data : r;
    }

    const failText = (e, fallback) => (e && e.message) || fallback;
    function box(text, icon) {
        if (ws) ws.messageBox({ title: TITLE, icon: icon || 'error', text });
    }

    // The status feed: on while Today's item or this program is on screen (rule server-push-not-polling).
    let hubOn = false;
    let todayPlaced = false;
    const screenOn = () => !document.hidden && document.documentElement.dataset.screenOff === undefined;
    function wantHub() {
        if (!ws || !canUse() || !screenOn()) return false;
        const cur = typeof ws.currentApp === 'function' ? ws.currentApp() : null;
        return (cur === 'today' && todayPlaced) || (cur === APP_ID && shown);
    }
    function applyHub(items) {
        if (!items || typeof items !== 'object') return;
        const was = signedIn();
        ['account', 'favourites', 'latest', 'live', 'sources', 'settings'].forEach((k) => { if (items[k] !== undefined && items[k] !== null) hub[k] = items[k]; });
        // the server finished a look for new uploads: take the Subscriptions list it now holds (no call to YouTube)
        if (items.feed && typeof items.feed.at === 'number') {
            const t = data.subs;
            if (signedIn() && t.videos && !t.loading && items.feed.at > (t.feedAt || 0)) loadTab('subs', false, true);
        }
        loaded = true;
        if (was !== signedIn()) {
            // another account's lists are not this one's
            Object.assign(data.subs, { videos: null, at: 0, error: '' });
            Object.assign(data.later, { videos: null, at: 0, error: '', unavailable: false });
            Object.assign(data.channels, { list: null, at: 0, error: '' });
            layer = null;
            if (signedIn() && shown) ensureTab();
        }
        if (todayList().length <= todayAt) todayAt = 0;
        changed();
    }
    async function syncHub() {
        const want = wantHub();
        const c = window.wsClient;
        if (want === hubOn || !c || typeof c.sendMessage !== 'function') return;
        hubOn = want;
        try {
            const r = await c.sendMessage(want ? 'status_subscribe' : 'status_unsubscribe', { feed: 'youtube' }, false);
            if (!want || !hubOn) return;
            let items = r && (r.items || (r.data && r.data.items));
            // a server that answers the subscription without its snapshot: read what it holds once
            if (!items) { const d = await ask('youtube_get', {}, 15000); items = d && d.state; }
            applyHub(items);
        } catch (_) {
            if (want) hubOn = false;
        }
    }
    function wire() {
        const c = window.wsClient;
        if (wired || !c || typeof c.on !== 'function') return !!wired;
        wired = true;
        c.on('youtube_status', (msg) => { if (hubOn && msg) applyHub(msg.changed || (msg.data && msg.data.changed)); }, { signal: appScopeSignal });
        // the server forgets a dropped socket's subscriptions: subscribe again
        c.on('connected', () => { hubOn = false; void syncHub(); }, { signal: appScopeSignal });
        document.addEventListener('wmAppChange', () => { void syncHub(); }, { signal: appScopeSignal });
        document.addEventListener('visibilitychange', () => { void syncHub(); }, { signal: appScopeSignal });
        window.addEventListener('melatonscreen', () => { void syncHub(); }, { signal: appScopeSignal });
        void syncHub();
        return true;
    }

    function changed() {
        if (shown) render(); else stale = true;
        todayHtml = '';
        if (ws && typeof ws.currentApp === 'function' && ws.currentApp() === 'today') todayItemChanged();
    }

    /** Only this item drawn again (#890: not the whole of Today); a shell without refreshTodayItem draws it all. */
    function todayItemChanged() {
        if (!ws) return;
        if (typeof ws.refreshTodayItem === 'function') ws.refreshTodayItem('youtube');
        else if (typeof ws.refreshToday === 'function') ws.refreshToday();
    }

    // ---------------------------------------------------------------- lists

    async function loadTab(id, fresh, quiet) {
        const t = data[id];
        if (!t || t.loading || !signedIn() || id === 'search') return;
        t.loading = true;
        t.error = '';
        if (!quiet) renderPane(id);
        const work = (async () => {
            try {
                if (id === 'subs') {
                    const d = await ask('youtube_feed', { fresh: !!fresh }, 120000);
                    t.videos = d.videos || [];
                    t.note = d.partial ? 'Some channels could not be read' : `${d.channels || 0} channels`;
                    t.refreshing = !!d.refreshing;
                    t.feedAt = d.at || 0;
                } else if (id === 'later') {
                    const d = await ask('youtube_watch_later', { fresh: !!fresh }, 60000);
                    t.videos = d.videos || [];
                    t.unavailable = !!d.unavailable;
                    t.why = d.why || '';
                } else if (id === 'channels') {
                    const d = await ask('youtube_subscriptions', { fresh: !!fresh }, 90000);
                    t.list = d.channels || [];
                }
                t.at = Date.now();
            } catch (e) {
                t.error = failText(e, 'YouTube could not be read');
            } finally {
                t.loading = false;
                renderPane(id);
                renderHead();
            }
        })();
        if (ws && shown && !quiet) ws.busy(work, { delay: 250, timeout: 120000 }).catch(() => {});
        return work;
    }

    function ensureTab() {
        if (!signedIn() || tab === 'search') return;
        const t = data[tab];
        const has = tab === 'channels' ? t.list : t.videos;
        if (!t.loading && (!has || Date.now() - t.at > STALE_MS) && !(t.error && Date.now() - t.at < 5000)) loadTab(tab, false);
    }

    function recent() {
        try { const a = JSON.parse(localStorage.getItem(LS_RECENT) || '[]'); return Array.isArray(a) ? a.filter((x) => typeof x === 'string').slice(0, 8) : []; } catch (_) { return []; }
    }
    function remember(q) {
        try { localStorage.setItem(LS_RECENT, JSON.stringify([q].concat(recent().filter((x) => x.toLowerCase() !== q.toLowerCase())).slice(0, 8))); } catch (_) { /* private mode */ }
    }

    async function runSearch(query, more) {
        const s = data.search;
        const q = String(query == null ? (els && els.q.value) : query).trim();
        if (!q || s.loading) return;
        if (els) { els.q.value = q; els.q.blur(); els.clear.hidden = false; }
        s.loading = true;
        s.error = '';
        if (!more) { s.query = q; s.videos = null; s.channels = []; s.next = ''; }
        renderPane('search');
        const work = (async () => {
            try {
                const d = await ask('youtube_search', { query: q, page: more ? s.next : '' }, 45000);
                s.videos = (more && s.videos ? s.videos : []).concat(d.videos || []);
                if (!more) s.channels = d.channels || [];
                s.next = d.next || '';
                remember(q);
            } catch (e) {
                s.error = failText(e, 'The search failed');
                if (!more) s.videos = null;
            } finally {
                s.loading = false;
                renderPane('search');
            }
        })();
        if (ws) ws.busy(work, { delay: 250, timeout: 45000 }).catch(() => {});
        return work;
    }

    function clearSearch() {
        Object.assign(data.search, { query: '', videos: null, channels: [], next: '', error: '' });
        if (els) { els.q.value = ''; els.clear.hidden = true; }
        renderPane('search');
    }

    async function openChannel(id, known) {
        if (!id) return;
        layer = { id, channel: known || seen.get(id) || { id, title: 'Channel', thumb: '' }, videos: null, loading: true, error: '' };
        syncLayer();
        const mine = layer;
        const work = (async () => {
            try {
                const d = await ask('youtube_channel', { id }, 45000);
                if (layer !== mine) return;
                if (d.channel) mine.channel = d.channel;
                mine.videos = d.videos || [];
            } catch (e) {
                if (layer !== mine) return;
                mine.error = failText(e, 'The channel could not be read');
            } finally {
                mine.loading = false;
                if (layer === mine) renderLayer();
            }
        })();
        if (ws) ws.busy(work, { delay: 250, timeout: 45000 }).catch(() => {});
    }

    async function setFavourite(channel, on) {
        if (!channel || starBusy) return;
        if (!isAdmin()) { box('Only the administrator can change the favourite channels.', 'info'); return; }
        starBusy = true;
        try {
            const d = await ask('youtube_favourite', { channel: { id: channel.id, title: channel.title, thumb: channel.thumb }, on });
            if (Array.isArray(d.favourites)) { hub.favourites = d.favourites; changed(); }
        } catch (e) {
            box(failText(e, 'The favourite could not be saved'));
        } finally {
            starBusy = false;
        }
    }
    // ---- marks: watched (this program's own) and Watch Later

    /** Every copy of a video the lists hold (the same video can be in several). */
    function eachVideo(id, fn) {
        [data.subs.videos, data.later.videos, data.search.videos, layer && layer.videos, latest()].forEach((list) => {
            (list || []).forEach((v) => { if (v && v.id === id) fn(v); });
        });
        const v = seen.get(id);
        if (v) fn(v);
    }
    /** The Subscriptions list keeps watched videos below the rest (each part newest first). */
    function sinkWatched() {
        const list = data.subs.videos;
        if (list) data.subs.videos = list.filter((v) => !v.watched).concat(list.filter((v) => v.watched));
    }
    function redraw() {
        if (shown) { renderPane(tab); renderLayer(); renderHead(); } else stale = true;
        todayHtml = '';
    }

    const WATCH_WHY = {
        'browser-signin': 'YouTube was not told: the server\'s browser is not signed in to YouTube. Open youtube.com in Internet Explorer and sign in there.',
        'browser-offline': 'YouTube was not told: the server\'s browser (Internet Explorer) is not running.',
        failed: 'YouTube did not take the change.',
        'not-found': ''
    };
    /** Mark as Watched / Unwatched: in the account's own YouTube history (the server's browser does it). */
    async function setWatched(id, on) {
        if (!isAdmin()) { box('Only the administrator can mark videos.', 'info'); return; }
        const was = new Map();
        eachVideo(id, (v) => { was.set(v, [v.watched, v.progress]); v.watched = on; if (on) v.progress = 0; });
        sinkWatched();
        redraw();
        try {
            const d = await ws.busy(ask('youtube_mark', { id, watched: on }, 60000), { delay: 400, timeout: 60000 });
            eachVideo(id, (v) => { v.watched = !!d.watched; });
            sinkWatched();
            redraw();
            if (/^(kick|app):/.test(id)) return;
            if (on && d.youtube !== 'done') box(`Marked here. ${WATCH_WHY[d.youtube] || WATCH_WHY.failed}`, 'info');
            else if (!on && d.watched) box(`It is still marked watched on YouTube. ${WATCH_WHY[d.youtube] || WATCH_WHY.failed}`, 'info');
        } catch (e) {
            was.forEach(([w, p], v) => { v.watched = w; v.progress = p; });
            sinkWatched();
            redraw();
            box(failText(e, 'The mark could not be saved'));
        }
    }

    async function setLater(id, on) {
        if (!isAdmin()) { box('Only the administrator can change Watch Later.', 'info'); return; }
        eachVideo(id, (v) => { v.later = on; });
        if (!on && data.later.videos) data.later.videos = data.later.videos.filter((v) => v.id !== id);
        data.later.at = 0; // the Watch Later page reads its list again when it is next shown
        redraw();
        try {
            const d = await ask('youtube_later', { id, on }, 60000);
            eachVideo(id, (v) => { v.later = !!d.later; });
            redraw();
            // still on the account's own list: the server's browser could not take it off there
            if (!on && d.later) box(`It is still in your YouTube Watch Later list. ${BROWSER_WHY[d.youtube] || 'YouTube did not take the change.'}`, 'info');
            else if (d.youtube === 'failed') box(on ? 'Saved here, but YouTube did not add it to the account\'s own Watch Later list.' : 'YouTube did not take the change.', 'info');
            if (tab === 'later' && shown) loadTab('later', true, true);
        } catch (e) {
            eachVideo(id, (v) => { v.later = !on; });
            redraw();
            box(failText(e, 'Watch Later could not be changed'));
        }
    }

    /** Channels whose notification bell is set to All become Today favourites (read in the server's browser). */
    async function importBells() {
        if (!isAdmin()) { box('Only the administrator can change the favourite channels.', 'info'); return; }
        try {
            const d = await ws.busy(ask('youtube_import_bell', {}, 90000), { delay: 250, timeout: 90000 });
            if (d.why) { box(BROWSER_WHY[d.why] || BROWSER_WHY['browser-signin'], 'info'); return; }
            if (Array.isArray(d.favourites)) { hub.favourites = d.favourites; changed(); }
            const n = (k, word) => `${k} ${word}${k === 1 ? '' : 's'}`;
            let text = !d.found ? 'None of your channels has its bell set to All notifications.'
                : d.added ? `${n(d.added, 'channel')} with the bell set to All ${d.added === 1 ? 'was' : 'were'} added to Today.`
                    : `The ${n(d.found, 'channel')} with the bell set to All ${d.found === 1 ? 'is' : 'are'} on Today already.`;
            if (d.left) text += `\n\n${n(d.left, 'more channel')} did not fit in the favourites list.`;
            if (d.partial) text += '\n\nYouTube did not show the whole subscriptions list, so some channels may be missing.';
            box(text, 'info');
        } catch (e) {
            box(failText(e, 'The channels could not be imported'));
        }
    }
    const toggleFavourite = (channel) => setFavourite(channel, !favIds().has(channel.id));

    async function saveSettings(patch) {
        if (!isAdmin()) { box('Only the administrator can change the settings.', 'info'); return; }
        try {
            const d = await ask('youtube_settings_save', { settings: patch });
            if (d.settings) hub.settings = d.settings;
            if (patch.noShorts !== undefined) { Object.assign(data.subs, { videos: null, at: 0 }); ensureTab(); }
            changed();
        } catch (e) {
            box(failText(e, 'The settings could not be saved'));
        }
    }

    // ---------------------------------------------------------------- sign-in

    async function signIn() {
        if (!isAdmin()) { box('Only the administrator can sign in to YouTube.', 'info'); return; }
        try {
            const d = await ws.busy(ask('youtube_signin', {}), { delay: 250, timeout: 30000 });
            if (d && d.signIn) { hub.account = Object.assign({}, acct(), { signIn: d.signIn, error: '' }); changed(); }
        } catch (e) {
            box(failText(e, 'The sign-in could not be started'));
        }
    }
    async function cancelSignIn() {
        try { await ask('youtube_signin_cancel', {}); } catch (_) { /* the code runs out by itself */ }
        hub.account = Object.assign({}, acct(), { signIn: null });
        changed();
    }
    async function signOut() {
        if (!isAdmin()) { box('Only the administrator can sign out.', 'info'); return; }
        const name = (acct().account && acct().account.title) || 'YouTube';
        const ok = await ws.messageBox({ title: TITLE, icon: 'question', text: `Sign out of ${name}?\n\nThe favourite channels are kept for the next sign-in.`, buttons: [{ text: 'Sign Out', value: true }, { text: 'Cancel', value: false }] });
        if (!ok) return;
        try {
            const d = await ws.busy(ask('youtube_signout', {}), { delay: 250, timeout: 30000 });
            if (d && d.state) applyHub(d.state);
        } catch (e) {
            box(failText(e, 'The sign-out failed'));
        }
    }

    // ---------------------------------------------------------------- rows

    const people = (n) => (n >= 1000000 ? `${(n / 1000000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K` : String(n || 0));
    const SOURCE_TAG = { kick: 'KICK' };

    function videoRow(v, hero) {
        seen.set(v.id, v);
        const src = srcOf(v);
        const len = lenText(v);
        const live = v.live === 'live' || v.live === 'upcoming';
        const big = hero && src === 'youtube' ? `https://i.ytimg.com/vi/${encodeURIComponent(v.id)}/hqdefault.jpg` : v.thumb;
        // the lines under the title: who, then when (a live stream: how many watch and what; a notification: its text)
        const second = src === 'kick' ? [v.viewers ? `${people(v.viewers)} watching` : '', v.note].filter(Boolean).join(' · ') : src === 'app' ? [v.note, age(v.at)].filter(Boolean).join(' · ') : age(v.at);
        const sub = [v.channel, second].filter(Boolean);
        const tags = `${isNew(v) && !v.watched && !live ? '<i class="yt-new">NEW</i>' : ''}${SOURCE_TAG[src] ? `<i class="yt-new is-src">${SOURCE_TAG[src]}</i>` : ''}${v.members ? '<i class="yt-new is-members">MEMBERS</i>' : ''}`;
        const pic = src === 'app' && !v.thumb
            ? `<span class="yt-th is-app">${I.bell}<b>${esc(v.channel || '')}</b></span>`
            : `<span class="yt-th"><img src="${esc(big || v.thumb)}" data-alt="${esc(v.thumb)}" alt="" loading="lazy" decoding="async" draggable="false">${v.later ? `<i class="yt-wl" title="In Watch Later">${I.later}</i>` : ''}${v.progress > 0 && !v.watched ? `<i class="yt-prog"><b style="width:${Math.min(100, Math.round(v.progress))}%"></b></i>` : ''}${len ? `<i class="yt-len${live ? ' is-live' : ''}">${esc(len)}</i>` : ''}</span>`;
        return `<div class="yt-row${hero ? ' is-hero' : ''}${v.watched ? ' is-watched' : ''}" role="button" tabindex="0" data-v="${esc(v.id)}">
            ${pic}
            <span class="yt-tx"><span class="yt-t">${tags}${esc(v.title)}</span>${hero ? `<span class="yt-s">${esc(sub.join(' · '))}</span>` : `<span class="yt-s">${esc(v.channel || '')}</span><span class="yt-s">${esc(second)}</span>`}</span>
        </div>`;
    }

    function channelRow(c, sub) {
        seen.set(c.id, c);
        const on = favIds().has(c.id);
        return `<div class="yt-row is-chan" role="button" tabindex="0" data-ch="${esc(c.id)}">
            <img class="yt-av" src="${esc(c.thumb || '')}" alt="" loading="lazy" decoding="async" draggable="false">
            <span class="yt-tx"><span class="yt-t">${esc(c.title)}</span>${sub ? `<span class="yt-s">${esc(sub)}</span>` : ''}</span>
            <button type="button" class="yt-star${on ? ' is-on' : ''}" data-star="${esc(c.id)}" aria-pressed="${on}" aria-label="${on ? 'Remove from Today' : 'Show on Today'}">${I.star}</button>
        </div>`;
    }

    // Watch Later and the notification bells are shown only to a signed-in browser: the server reads
    // them in its own browser (Alchemy, Internet Explorer on the phone and the desktop), #840
    const BROWSER_WHY = {
        'browser-signin': 'YouTube shows this only to a signed-in browser. Open youtube.com in Internet Explorer and sign in to your Google account there once.',
        'browser-offline': 'YouTube shows this only to a signed-in browser, and the server\'s browser (Internet Explorer) is not running.'
    };
    const emptyHtml = (head, text, extra) => `<div class="yt-empty"><b>${esc(head)}</b>${esc(text || '')}${extra || ''}</div>`;
    const errorHtml = (text, act) => emptyHtml('YouTube did not answer', text, `<br><button type="button" class="yt-btn" data-act="${act}">Try Again</button>`);
    const videosHtml = (list) => list.map((v, i) => videoRow(v, i === 0 && !v.watched && srcOf(v) !== 'app')).join('');
    /** The feed: what is live now under its own heading, then the rest. */
    function feedHtml(list) {
        const live = list.filter((v) => v.live === 'live');
        if (!live.length) return videosHtml(list);
        const rest = list.filter((v) => v.live !== 'live');
        return `<div class="yt-sec is-live">Live now (${live.length})</div>${live.map((v, i) => videoRow(v, i === 0 && !v.watched)).join('')}<div class="yt-sec">Latest</div>${rest.map((v) => videoRow(v, false)).join('')}`;
    }

    /** Channels: the Kick channels (added by name) and the apps whose notifications join the feed. */
    function sourcesHtml() {
        const so = hub.sources || {};
        const kick = so.kick || [];
        const apps = so.apps || [];
        const chosen = new Set(apps.map((a) => a.package));
        const offered = apps.concat((so.seenApps || []).filter((a) => !chosen.has(a.package)));
        const kickRows = kick.map((c) => `<div class="yt-row is-chan is-plain" data-yt-kick="${esc(c.slug)}">
            <img class="yt-av" src="${esc(c.thumb || '')}" alt="" loading="lazy" decoding="async" draggable="false">
            <span class="yt-tx"><span class="yt-t">${c.live ? '<i class="yt-new is-livetag">LIVE</i>' : ''}${esc(c.name)}</span><span class="yt-s">kick.com/${esc(c.slug)}</span></span>
            <button type="button" class="yt-x" data-yt-kick-remove="${esc(c.slug)}" aria-label="Remove ${esc(c.name)}">&times;</button>
        </div>`).join('');
        const appRows = offered.map((a) => `<div class="yt-row is-chan is-plain" role="button" tabindex="0" data-yt-app="${esc(a.package)}" data-yt-label="${esc(a.label)}">
            <span class="yt-th is-app is-small">${I.bell}</span>
            <span class="yt-tx"><span class="yt-t">${esc(a.label)}</span><span class="yt-s">${chosen.has(a.package) ? 'Its notifications are in the feed' : 'Tap to bring its notifications into the feed'}</span></span>
            <span class="yt-check${chosen.has(a.package) ? ' is-on' : ''}" aria-hidden="true"></span>
        </div>`).join('');
        return `<div class="yt-sec">Kick (${kick.length})</div>
            ${so.kickReady ? `<form class="yt-search yt-kick-form" action="#" autocomplete="off"><label class="yt-field"><input class="yt-q yt-kick-q" type="text" enterkeyhint="done" placeholder="Kick channel name" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="60"></label><button type="submit" class="yt-btn is-go">Add</button></form>` : '<div class="yt-empty">Kick needs a key first: the administrator adds one on the desktop under Service keys &gt; Kick.</div>'}
            ${kickRows}
            <div class="yt-sec">Apps in the feed (${apps.length})</div>
            ${appRows || '<div class="yt-empty">An app shows here once it has posted a notification while ActiveSync\'s Send notifications is on. Tap it to bring its notifications into the feed.</div>'}`;
    }

    async function addKick(name) {
        if (!isAdmin()) { box('Only the administrator can change the channels.', 'info'); return; }
        const n = String(name || '').trim();
        if (!n) return;
        try {
            const d = await ws.busy(ask('youtube_kick_add', { name: n }, 30000), { delay: 250, timeout: 30000 });
            if (d.channels) { hub.sources = Object.assign({}, hub.sources, { kick: d.channels.map((c) => Object.assign({ live: d.channel && c.slug === d.channel.slug && d.live }, c)) }); changed(); }
        } catch (e) {
            box(failText(e, 'The Kick channel could not be added'));
        }
    }
    async function removeKick(slug) {
        if (!isAdmin()) { box('Only the administrator can change the channels.', 'info'); return; }
        try {
            const d = await ask('youtube_kick_remove', { slug });
            if (d.channels) { hub.sources = Object.assign({}, hub.sources, { kick: d.channels }); changed(); }
        } catch (e) {
            box(failText(e, 'The Kick channel could not be removed'));
        }
    }
    async function toggleApp(pkg, label) {
        if (!isAdmin()) { box('Only the administrator can change the apps.', 'info'); return; }
        const apps = ((hub.sources && hub.sources.apps) || []).slice();
        const at = apps.findIndex((a) => a.package === pkg);
        if (at >= 0) apps.splice(at, 1); else apps.push({ package: pkg, label });
        try {
            const d = await ask('youtube_apps_save', { apps });
            if (d.apps) { hub.sources = Object.assign({}, hub.sources, { apps: d.apps }); Object.assign(data.subs, { at: 0 }); changed(); }
        } catch (e) {
            box(failText(e, 'The apps could not be saved'));
        }
    }
    async function removeNotice(id) {
        try {
            await ask('youtube_notice_remove', { id });
            if (data.subs.videos) data.subs.videos = data.subs.videos.filter((v) => v.id !== id);
            redraw();
        } catch (e) {
            box(failText(e, 'The item could not be removed'));
        }
    }

    function paneHtml(id) {
        const t = data[id];
        if (id === 'subs') {
            if (t.error && !t.videos) return errorHtml(t.error, 'retry');
            if (!t.videos) return emptyHtml('Feed', t.loading ? 'Reading your channels\' newest videos...' : '');
            if (!t.videos.length) return emptyHtml('Nothing new', 'The channels you subscribe to have no videos to show. Find channels with Search.');
            return feedHtml(t.videos) + (t.error ? `<div class="yt-foot">${esc(t.error)}</div>` : '');
        }
        if (id === 'later') {
            if (t.error && !t.videos) return errorHtml(t.error, 'retry');
            if (!t.videos) return emptyHtml('Watch Later', t.loading ? 'Reading the list...' : '');
            if (t.unavailable) return emptyHtml(t.why === 'browser-offline' ? 'The server\'s browser is not running' : 'Sign in to YouTube in Internet Explorer', `${BROWSER_WHY[t.why] || BROWSER_WHY['browser-signin']} Until then the list opens in the YouTube app.`, '<br><button type="button" class="yt-btn is-go" data-act="open-later">Open Watch Later</button> <button type="button" class="yt-btn" data-act="retry">Try Again</button>');
            if (!t.videos.length) return emptyHtml('Nothing saved', 'Videos you save to Watch Later in YouTube show up here.');
            return videosHtml(t.videos) + (t.why ? `<div class="yt-foot">These are the videos added here. ${esc(BROWSER_WHY[t.why] || '')}<br><button type="button" class="yt-btn" data-act="open-later">Open Watch Later in YouTube</button></div>` : '');
        }
        if (id === 'channels') {
            if (t.error && !t.list) return errorHtml(t.error, 'retry');
            if (!t.list) return emptyHtml('Channels', t.loading ? 'Reading your subscriptions...' : '');
            const fav = favIds();
            const subIds = new Set(t.list.map((c) => c.id));
            // favourites first (those found by Search and not subscribed too), then the rest A to Z
            const favs = (hub.favourites || []).map((f) => t.list.find((c) => c.id === f.id) || f);
            const rest = t.list.filter((c) => !fav.has(c.id));
            return `<div class="yt-sec">On Today (${favs.length})</div>${favs.length ? favs.map((c) => channelRow(c, subIds.has(c.id) ? '' : 'Not subscribed')).join('') : '<div class="yt-empty">Tap a channel\'s star to see its newest videos on Today, or bring in every channel whose bell is set to All notifications.<br><button type="button" class="yt-btn is-go" data-act="import-bells">Import from Notifications</button></div>'}
                ${sourcesHtml()}
                <div class="yt-sec">YouTube subscriptions (${t.list.length})</div>${rest.length ? rest.map((c) => channelRow(c)).join('') : (t.list.length ? '' : '<div class="yt-empty">You do not subscribe to a channel yet. Find some with Search.</div>')}`;
        }
        // search
        if (t.error && !t.videos) return errorHtml(t.error, 'search-again');
        if (!t.videos) {
            if (t.loading) return emptyHtml('Search', `Looking for "${t.query}"...`);
            const r = recent();
            return r.length
                ? `<div class="yt-sec">Recent searches</div>${r.map((q) => `<div class="yt-row is-recent" role="button" tabindex="0" data-recent="${esc(q)}">${I.clock}<span>${esc(q)}</span></div>`).join('')}`
                : emptyHtml('Search YouTube', 'Type what to look for. Channels you find can be starred for Today.');
        }
        if (!t.videos.length && !t.channels.length) return emptyHtml('Nothing found', `YouTube has no match for "${t.query}".`);
        return `${t.channels.length ? `<div class="yt-sec">Channels</div>${t.channels.map((c) => channelRow(c)).join('')}<div class="yt-sec">Videos</div>` : ''}${videosHtml(t.videos)}${t.next ? `<div class="yt-foot"><button type="button" class="yt-btn" data-act="more"${t.loading ? ' disabled' : ''}>${t.loading ? 'Looking...' : 'More Results'}</button></div>` : ''}${t.error ? `<div class="yt-foot">${esc(t.error)}</div>` : ''}`;
    }

    function renderPane(id) {
        if (!els) return;
        if (!shown) { stale = true; return; }
        const list = els.lists[id];
        const html = paneHtml(id);
        if (list.dataset.html === html) return;
        list.dataset.html = html;
        list.innerHTML = html;
    }

    // ---------------------------------------------------------------- page

    function build() {
        page.innerHTML = `
            <div class="yt-root">
                <div class="yt-head"><img class="yt-me" alt="" draggable="false" hidden><span class="yt-title"></span><span class="yt-note"></span></div>
                <div class="yt-panes">
                    ${TABS.map((t) => `<div class="yt-pane" data-pane="${t.id}" hidden>${t.id === 'search' ? `<form class="yt-search" action="#" autocomplete="off"><label class="yt-field">${I.search}<input class="yt-q" type="search" enterkeyhint="search" placeholder="Search YouTube" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="120"><button type="button" class="yt-clear" aria-label="Clear" hidden>&times;</button></label><button type="submit" class="yt-btn is-go">Search</button></form>` : ''}<div class="yt-list${t.id === 'channels' ? '' : ' is-videos'}"></div></div>`).join('')}
                    <div class="yt-layer" hidden><div class="yt-chan"></div><div class="yt-list is-videos"></div></div>
                    <div class="yt-sign" hidden></div>
                </div>
                <div class="yt-tabs" role="tablist"><div class="yt-slider"><i></i></div>${TABS.map((t) => `<button type="button" class="yt-tab" role="tab" data-tab="${t.id}">${t.icon}<span>${t.label}</span></button>`).join('')}</div>
            </div>`;
        const q = (s) => page.querySelector(s);
        els = {
            root: q('.yt-root'), me: q('.yt-me'), title: q('.yt-title'), note: q('.yt-note'), panes: q('.yt-panes'),
            tabs: q('.yt-tabs'), slider: q('.yt-slider'), sign: q('.yt-sign'), layer: q('.yt-layer'), chan: q('.yt-chan'), layerList: q('.yt-layer .yt-list'),
            form: q('.yt-search'), q: q('.yt-q'), clear: q('.yt-clear'), lists: {}, paneEls: {}
        };
        TABS.forEach((t) => {
            els.paneEls[t.id] = q(`.yt-pane[data-pane="${t.id}"]`);
            els.lists[t.id] = els.paneEls[t.id].querySelector('.yt-list');
        });
        els.panes.addEventListener('click', onClick);
        els.panes.addEventListener('contextmenu', onHold);
        // a picture YouTube does not have in the large size falls back to the list size
        els.panes.addEventListener('error', (e) => {
            const img = e.target;
            if (img && img.tagName === 'IMG' && img.dataset.alt && img.src !== img.dataset.alt) { const alt = img.dataset.alt; img.dataset.alt = ''; img.src = alt; }
        }, true);
        els.form.addEventListener('submit', (e) => { e.preventDefault(); runSearch(); });
        // the Kick form is drawn with the Channels list: its Add comes through the panes
        els.panes.addEventListener('submit', (e) => {
            const f = e.target.closest('.yt-kick-form');
            if (!f) return;
            e.preventDefault();
            const q = f.querySelector('.yt-kick-q');
            const name = q.value;
            q.value = '';
            q.blur();
            addKick(name);
        });
        els.q.addEventListener('input', () => { els.clear.hidden = !els.q.value; });
        els.clear.addEventListener('click', () => { clearSearch(); els.q.focus(); });
        wireTabs();
        // its animations stop while the page is hidden or the screen is off (the page is not hidden then)
        const paused = () => { if (els) els.root.classList.toggle('is-paused', !screenOn()); };
        document.addEventListener('visibilitychange', paused, { signal: appScopeSignal });
        window.addEventListener('melatonscreen', paused, { signal: appScopeSignal });
    }

    // The tab strip: a tap picks a tab; a drag carries the glass slider and drops it on the nearest one.
    function wireTabs() {
        const bar = els.tabs;
        let down = null;
        const at = (x) => { const r = bar.getBoundingClientRect(); return Math.max(0, Math.min(TABS.length - 1, Math.floor(((x - r.left) / r.width) * TABS.length))); };
        bar.addEventListener('pointerdown', (e) => {
            if (e.button) return;
            down = { x: e.clientX, drag: false, id: e.pointerId };
            try { bar.setPointerCapture(e.pointerId); } catch (_) { /* a synthetic pointer */ }
        });
        bar.addEventListener('pointermove', (e) => {
            if (!down || e.pointerId !== down.id) return;
            if (!down.drag && Math.abs(e.clientX - down.x) < 8) return;
            down.drag = true;
            bar.classList.add('is-drag');
            const r = bar.getBoundingClientRect();
            const w = r.width / TABS.length;
            const x = Math.max(0, Math.min(r.width - w, e.clientX - r.left - w / 2));
            els.slider.style.transform = `translateX(${x}px)`;
            const i = at(e.clientX);
            bar.querySelectorAll('.yt-tab').forEach((b, n) => b.classList.toggle('is-on', n === i));
        });
        const up = (e) => {
            if (!down || e.pointerId !== down.id) return;
            const i = at(e.clientX);
            const cancelled = e.type === 'pointercancel';
            down = null;
            bar.classList.remove('is-drag');
            if (cancelled) { placeSlider(); return; }
            setTab(TABS[i].id);
        };
        bar.addEventListener('pointerup', up);
        bar.addEventListener('pointercancel', up);
    }

    function placeSlider() {
        if (!els) return;
        const i = Math.max(0, TABS.findIndex((t) => t.id === tab));
        els.slider.style.transform = `translateX(${i * 100}%)`;
        els.tabs.querySelectorAll('.yt-tab').forEach((b, n) => { b.classList.toggle('is-on', n === i); b.setAttribute('aria-selected', n === i ? 'true' : 'false'); });
    }

    function setTab(id) {
        if (!TABS.some((t) => t.id === id)) return;
        const same = id === tab;
        tab = id;
        try { localStorage.setItem(LS_TAB, id); } catch (_) { /* private mode */ }
        if (layer) { layer = null; syncLayer(); }
        render();
        if (same) els.lists[id].scrollTop = 0; // the open tab's own key goes back to the top
        ensureTab();
        if (ws) { ws.refreshSoftKeys(); ws.syncHistory(); }
    }

    function renderHead() {
        if (!els) return;
        const a = acct().account;
        const t = TABS.find((x) => x.id === tab);
        els.me.hidden = !(a && a.thumb);
        if (a && a.thumb && els.me.getAttribute('src') !== a.thumb) els.me.src = a.thumb;
        els.title.textContent = layer ? layer.channel.title : t.label;
        const d = data[tab];
        let note = '';
        if (layer) note = favIds().has(layer.id) ? 'On Today' : '';
        else if (tab === 'subs') note = d.loading && !d.videos ? 'Reading...' : d.refreshing ? 'Looking for new videos...' : d.videos ? d.note : '';
        else if (tab === 'later') note = d.videos && !d.unavailable ? `${d.videos.length} video${d.videos.length === 1 ? '' : 's'}` : '';
        else if (tab === 'channels') note = d.list ? `${(hub.favourites || []).length} on Today` : '';
        else if (tab === 'search') note = d.videos ? `"${d.query}"` : '';
        els.note.textContent = note;
    }

    function signHtml() {
        const a = acct();
        const art = '<img class="yt-sign-art" src="/static_images/wm65/start-youtube@4x.png" alt="" draggable="false">';
        if (!loaded) return `${art}<h2>YouTube</h2><div class="yt-wait"><i></i>Connecting...</div>`;
        if (!a.configured) return `${art}<h2>YouTube is not set up</h2><p>The server has no Google sign-in client for YouTube yet. The administrator adds one on the desktop under Service keys &gt; YouTube.</p>`;
        if (a.signIn) {
            const code = String(a.signIn.userCode || '');
            const site = String(a.signIn.url || 'https://www.google.com/device').replace(/^https?:\/\/(www\.)?/, '');
            return `<h2>Enter this code</h2>
                <p>On this phone or any computer, open <b>${esc(site)}</b>, sign in with your Google account and enter:</p>
                <div class="yt-code">${[...code].map((ch) => (ch === '-' || ch === ' ' ? '<span>-</span>' : `<b>${esc(ch)}</b>`)).join('')}</div>
                <div class="yt-btns"><button type="button" class="yt-btn is-go" data-act="open-device">Open ${esc(site)}</button><button type="button" class="yt-btn" data-act="copy-code">Copy Code</button></div>
                <div class="yt-wait"><i></i>Waiting for Google...</div>
                <div class="yt-btns"><button type="button" class="yt-btn" data-act="cancel-signin">Cancel</button></div>`;
        }
        return `${art}<h2>Sign in to YouTube</h2>
            <p>See the newest videos of the channels you subscribe to, your Watch Later list and Search. Favourite channels show their latest uploads on Today.</p>
            ${a.error ? `<p class="is-bad">${esc(a.error)}</p>` : ''}
            ${isAdmin() ? '<div class="yt-btns"><button type="button" class="yt-btn is-go" data-act="signin">Sign In</button></div>' : '<p>Only the administrator can sign in.</p>'}`;
    }

    function render() {
        if (!els || !shown) { stale = true; return; }
        stale = false;
        const out = !signedIn();
        const html = out ? signHtml() : '';
        if (els.sign.dataset.html !== html) { els.sign.dataset.html = html; els.sign.innerHTML = html; }
        els.sign.hidden = !out;
        els.tabs.hidden = out;
        els.root.querySelector('.yt-head').hidden = out;
        TABS.forEach((t) => { els.paneEls[t.id].hidden = out || t.id !== tab; });
        if (!out) {
            renderPane(tab);
            renderLayer();
            placeSlider();
        } else {
            els.layer.hidden = true;
        }
        renderHead();
        if (ws) { ws.setTitle(TITLE); ws.refreshSoftKeys(); ws.refreshTitleAction(); }
    }

    function renderLayer() {
        if (!els) return;
        els.layer.hidden = !layer;
        if (!layer) return;
        const c = layer.channel;
        const on = favIds().has(c.id);
        seen.set(c.id, c);
        const head = `<img class="yt-av" src="${esc(c.thumb || '')}" alt="" draggable="false"><span class="yt-tx"><span class="yt-t">${esc(c.title)}</span><span class="yt-s">${on ? 'Its newest videos show on Today' : 'Tap the star to see it on Today'}</span></span><button type="button" class="yt-star${on ? ' is-on' : ''}" data-star="${esc(c.id)}" aria-pressed="${on}" aria-label="${on ? 'Remove from Today' : 'Show on Today'}">${I.star}</button>`;
        if (els.chan.dataset.html !== head) { els.chan.dataset.html = head; els.chan.innerHTML = head; }
        const html = layer.error ? errorHtml(layer.error, 'retry-channel')
            : !layer.videos ? emptyHtml(c.title, 'Reading the newest videos...')
                : layer.videos.length ? videosHtml(layer.videos) : emptyHtml('No videos', 'This channel has no videos to show.');
        if (els.layerList.dataset.html !== html) { els.layerList.dataset.html = html; els.layerList.innerHTML = html; els.layerList.scrollTop = 0; }
    }

    function syncLayer() {
        renderLayer();
        renderHead();
        if (ws) { ws.syncHistory(); ws.refreshSoftKeys(); ws.refreshTitleAction(); }
    }

    function popLayer() {
        if (!layer) return false;
        layer = null;
        syncLayer();
        if (shown) renderPane(tab);
        return true;
    }

    // ---------------------------------------------------------------- taps and holds

    function onClick(e) {
        // Every attribute looked for here is the program's own (data-yt-*, data-v, data-ch...): the shell's page
        // element has a data-app of its own, and a closest() that reached it once took every video tap for an
        // app toggle (#861: videos would not open, and each tap saved the apps and read the feed again).
        const star = e.target.closest('[data-star]');
        if (star) { e.stopPropagation(); const c = seen.get(star.dataset.star); if (c) toggleFavourite(c); return; }
        const act = e.target.closest('[data-act]');
        if (act && !act.disabled) { doAct(act.dataset.act); return; }
        const rec = e.target.closest('[data-recent]');
        if (rec) { runSearch(rec.dataset.recent); return; }
        const kx = e.target.closest('[data-yt-kick-remove]');
        if (kx) { removeKick(kx.dataset.ytKickRemove); return; }
        const app = e.target.closest('[data-yt-app]');
        if (app) { toggleApp(app.dataset.ytApp, app.dataset.ytLabel); return; }
        const kc = e.target.closest('[data-yt-kick]');
        if (kc) { openUrl(`https://kick.com/${kc.dataset.ytKick}`, true, KICK_PACKAGE); return; }
        const v = e.target.closest('[data-v]');
        if (v) { openItem(seen.get(v.dataset.v) || { id: v.dataset.v }); return; }
        const ch = e.target.closest('[data-ch]');
        if (ch) openChannel(ch.dataset.ch);
    }

    function doAct(act) {
        if (act === 'signin') signIn();
        else if (act === 'cancel-signin') cancelSignIn();
        else if (act === 'open-device') openUrl((acct().signIn && acct().signIn.url) || 'https://www.google.com/device', false);
        else if (act === 'copy-code') copyText((acct().signIn && acct().signIn.userCode) || '').then((ok) => { if (!ok) box('The code could not be copied. Type it as shown.', 'info'); });
        else if (act === 'retry') loadTab(tab, true);
        else if (act === 'retry-channel' && layer) openChannel(layer.id, layer.channel);
        else if (act === 'open-later') openUrl('https://www.youtube.com/playlist?list=WL');
        else if (act === 'import-bells') importBells();
        else if (act === 'more') runSearch(data.search.query, true);
        else if (act === 'search-again') runSearch(data.search.query);
    }

    function onHold(e) {
        const row = e.target.closest('[data-v], [data-ch]');
        if (!row || !ws || typeof ws.menuAt !== 'function') return;
        e.preventDefault();
        const fav = favIds();
        let items;
        if (row.dataset.v && seen.get(row.dataset.v) && srcOf(seen.get(row.dataset.v)) !== 'youtube') {
            const v = seen.get(row.dataset.v);
            const kick = srcOf(v) === 'kick';
            items = [
                { label: kick ? 'Watch on Kick' : `Open ${v.channel || 'the App'}`, action: () => openItem(v) },
                kick ? { label: 'Open in Browser', action: () => openUrl(v.url, false) } : null,
                '-',
                { label: v.watched ? (kick ? 'Show Again' : 'Mark as Unread') : (kick ? 'Hide This Stream' : 'Mark as Read'), disabled: !isAdmin(), action: () => setWatched(v.id, !v.watched) },
                kick ? null : { label: 'Remove from the Feed', disabled: !isAdmin(), action: () => removeNotice(v.id) },
                kick ? '-' : null,
                kick ? { label: 'Copy Link', action: () => copyText(v.url) } : null
            ];
        } else if (row.dataset.v) {
            const v = seen.get(row.dataset.v);
            if (!v) return;
            const c = v.channelId ? { id: v.channelId, title: v.channel || 'Channel', thumb: (seen.get(v.channelId) || {}).thumb || '' } : null;
            items = [
                { label: 'Play in YouTube', action: () => openVideo(v.id) },
                { label: 'Open in Browser', action: () => openUrl(videoUrl(v.id), false) },
                '-',
                { label: v.watched ? 'Mark as Unwatched' : 'Mark as Watched', disabled: !isAdmin(), action: () => setWatched(v.id, !v.watched) },
                { label: v.later ? 'Remove from Watch Later' : 'Add to Watch Later', disabled: !isAdmin(), action: () => setLater(v.id, !v.later) },
                '-',
                c && !(layer && layer.id === c.id) ? { label: 'Go to Channel', action: () => openChannel(c.id, seen.get(c.id) || c) } : null,
                c ? { label: 'Show Channel on Today', checked: fav.has(c.id), action: () => toggleFavourite(seen.get(c.id) || c) } : null,
                '-',
                { label: 'Copy Link', action: () => copyText(videoUrl(v.id)) }
            ];
        } else {
            const c = seen.get(row.dataset.ch);
            if (!c) return;
            items = [
                { label: 'Open', action: () => openChannel(c.id, c) },
                { label: 'Show on Today', checked: fav.has(c.id), action: () => toggleFavourite(c) },
                '-',
                { label: 'Open in YouTube', action: () => openUrl(channelUrl(c.id)) },
                { label: 'Copy Link', action: () => copyText(channelUrl(c.id)) }
            ];
        }
        row.classList.add('is-held');
        setTimeout(() => row.classList.remove('is-held'), 400);
        ws.menuAt(e.clientX, e.clientY, items.filter(Boolean));
    }

    // ---------------------------------------------------------------- menus

    async function about() {
        // today's use is read for this box only (it is not part of the pushed status)
        let q = null;
        try { const d = await ask('youtube_get', {}, 8000); q = d && d.state && d.state.quota; } catch (_) { /* the box goes without it */ }
        ws.messageBox({
            title: TITLE,
            icon: 'info',
            text: `Melaton Videos\nVersion 2.0\n\nCopyright © 2026 Xyridian Corporation. All rights reserved.\n\nYouTube videos, channels and search: the YouTube Data API. Kick live streams: the Kick API. YouTube is a trademark of Google LLC and Kick of Kick Streaming Pty Ltd; videos and streams play in their own apps.${q ? `\n\nToday's use: ${q.used.toLocaleString()} of ${q.budget.toLocaleString()} units.` : ''}`
        });
    }

    function refresh() {
        if (layer) { openChannel(layer.id, layer.channel); return; }
        if (tab === 'search') { if (data.search.query) runSearch(data.search.query); else if (els) els.q.focus(); return; }
        loadTab(tab, true);
    }

    function mainMenu() {
        const s = hub.settings || {};
        const n = Number(s.todayCount) || 12;
        const admin = isAdmin();
        return [
            { label: 'Refresh', disabled: !signedIn(), action: refresh },
            '-',
            { label: 'Leave Out Shorts', checked: s.noShorts !== false, disabled: !admin || !signedIn(), action: () => saveSettings({ noShorts: s.noShorts === false }) },
            { label: 'Rare Uploads First on Today', checked: s.rareFirst !== false, disabled: !admin || !signedIn(), action: () => saveSettings({ rareFirst: s.rareFirst === false }) },
            { label: 'Videos on Today', disabled: !admin || !signedIn(), submenu: [6, 12, 20, 30].map((k) => ({ label: String(k), radio: n === k, action: () => saveSettings({ todayCount: k }) })) },
            { label: 'Favourite Channels...', disabled: !signedIn(), action: () => setTab('channels') },
            { label: 'Import from Notifications', disabled: !admin || !signedIn(), action: importBells },
            '-',
            { label: 'Open YouTube', action: () => openUrl('https://www.youtube.com/') },
            { label: 'Kick Channels and Apps...', disabled: !signedIn(), action: () => setTab('channels') },
            signedIn() ? { label: 'Sign Out', disabled: !admin, action: signOut } : { label: 'Sign In', disabled: !admin || !acct().configured || !!acct().signIn, action: signIn },
            { label: 'About', action: about }
        ];
    }

    // ---------------------------------------------------------------- app

    function open(to) {
        if (ws) ws.open(APP_ID);
        if (to && TABS.some((t) => t.id === to) && els) setTab(to);
    }

    const APP = {
        id: APP_ID,
        title: TITLE,
        icon: 'app-youtube',
        art65: 'youtube',
        inStart: 'programs',
        sip: true,
        mount(p) {
            page = p;
            p.classList.add('wm-youtube');
            build();
        },
        show() {
            shown = true;
            if (!wired) wire();
            render();
            const sync = syncHub();
            if (!loaded) ws.busy(sync, { delay: 250, timeout: 20000 }).catch(() => {});
            ensureTab();
        },
        hide() { shown = false; if (els) els.q.blur(); void syncHub(); },
        historyDepth: () => (layer ? 1 : 0),
        onBack: () => popLayer(),
        titleKind: () => (layer ? 'ok' : 'close'),
        onTitleOk: () => popLayer(),
        onTitleClose() { layer = null; },
        softKeys() {
            if (!signedIn()) {
                const a = acct();
                return {
                    left: a.signIn ? { label: 'Cancel', action: cancelSignIn } : { label: 'Sign In', disabled: !isAdmin() || !a.configured, action: signIn },
                    right: { label: 'Menu', menu: mainMenu }
                };
            }
            if (layer) {
                const on = favIds().has(layer.id);
                return { left: { label: 'Back', action: popLayer }, right: { label: 'Menu', menu: () => [{ label: 'Show on Today', checked: on, action: () => toggleFavourite(layer.channel) }, { label: 'Refresh', action: refresh }, '-', { label: 'Open in YouTube', action: () => openUrl(channelUrl(layer.id)) }] } };
            }
            return {
                left: tab === 'search' ? { label: 'Search', action: () => { if (els.q.value.trim()) runSearch(); else els.q.focus(); } } : { label: 'Refresh', action: refresh },
                right: { label: 'Menu', menu: mainMenu }
            };
        }
    };

    // ---------------------------------------------------------------- Today (6.1 row, 6.5 panel)

    function todayStep(d) {
        const n = todayList().length;
        if (n < 2) return;
        todayAt = (todayAt + d + n) % n;
        todayDir = d > 0 ? 'r' : 'l';
        todayHtml = '';
        todayItemChanged();
    }

    function bindToday(el) {
        el.dataset.ytBound = '1';
        el.classList.add('wtw', 'yt-today');
        let down = null;
        let swiped = 0;
        const slide = () => el.querySelector('.yt-td-slide');
        el.addEventListener('pointerdown', (e) => {
            if (e.button || e.target.closest('.yt-td-arrow')) return;
            down = { x: e.clientX, y: e.clientY, id: e.pointerId, on: false };
        });
        el.addEventListener('pointermove', (e) => {
            if (!down || e.pointerId !== down.id) return;
            const dx = e.clientX - down.x;
            if (!down.on) {
                if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(e.clientY - down.y) * 1.3 || todayList().length < 2) return;
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
            const a = e.target.closest('.yt-td-arrow');
            if (a) { e.stopPropagation(); todayStep(a.dataset.dir === 'next' ? 1 : -1); return; }
            const v = todayList()[todayAt];
            if (signedIn() && v) openItem(v);
            else open(signedIn() ? ((hub.favourites || []).length ? 'subs' : 'channels') : null);
        });
    }

    function todayRender(el) {
        if (!canUse()) return false;
        todayPlaced = true;
        if (!wired) wire();
        if (!hubOn) void syncHub();
        if (!loaded) return false;
        const a = acct();
        if (!a.configured || (!signedIn() && !isAdmin())) return false;
        if (!el.dataset.ytBound) bindToday(el);
        // (only when they differ: written on every Today draw they were mutation records, #849)
        if (el.getAttribute('role') !== 'button') el.setAttribute('role', 'button');
        if (el.tabIndex !== 0) el.tabIndex = 0;
        const vids = todayList();
        if (todayAt >= vids.length) todayAt = 0;
        const v = signedIn() ? vids[todayAt] : null;
        let inner;
        if (v) {
            const len = lenText(v);
            inner = `<span class="yt-td-th"><img src="${esc(v.thumb)}" alt="" decoding="async" draggable="false">${len ? `<i>${esc(len)}</i>` : ''}</span><span class="wtw-lines${v.watched ? ' is-watched' : ''}"><span class="wtw-title">${esc(v.title)}</span><span class="wtw-sub">${esc(v.live === 'live' ? [v.channel, v.viewers ? `${people(v.viewers)} watching` : '', v.note].filter(Boolean).join(' · ') : [v.channel, age(v.at), rareText(v)].filter(Boolean).join(' · '))}</span></span><span class="yt-td-n">${todayAt + 1}/${vids.length}</span>`;
        } else {
            const line = !signedIn() ? 'Tap to sign in' : !(hub.favourites || []).length ? 'Tap to choose favourite channels' : hub.latest && hub.latest.caughtUp ? 'You have watched everything new' : a.error ? a.error : 'Looking for new videos...';
            inner = `<img class="yt-td-icon" src="${ws.art.url('app-youtube-lg')}" srcset="${ws.art.srcset('app-youtube-lg')}" alt="" draggable="false"><span class="wtw-lines"><span class="wtw-title">Videos</span><span class="wtw-sub">${esc(line)}</span></span>`;
        }
        const many = !!v && vids.length > 1;
        const html = `<button type="button" class="yt-td-arrow" data-dir="prev" aria-label="Previous video"${many ? '' : ' disabled'}>${I.left}</button><div class="yt-td-slide">${inner}</div><button type="button" class="yt-td-arrow" data-dir="next" aria-label="Next video"${many ? '' : ' disabled'}>${I.right}</button>`;
        if (html !== todayHtml || !el.firstChild) {
            todayHtml = html;
            el.innerHTML = html;
            if (todayDir) { const s = el.querySelector('.yt-td-slide'); if (s) s.classList.add(todayDir === 'r' ? 'is-in-r' : 'is-in-l'); todayDir = ''; }
        }
        return true;
    }

    function todayTitanium() {
        if (!canUse()) return null;
        todayPlaced = true;
        if (!wired) wire();
        if (!hubOn) void syncHub();
        if (!loaded) return null;
        const a = acct();
        if (!a.configured || (!signedIn() && !isAdmin())) return null;
        const go = () => open();
        const key = { label: 'Videos', action: go };
        const vids = signedIn() ? todayList() : [];
        if (!vids.length) {
            const line = !signedIn() ? 'Tap to sign in' : !(hub.favourites || []).length ? 'Choose favourite channels' : hub.latest && hub.latest.caughtUp ? 'You have watched everything new' : 'Looking for new videos...';
            const to = () => open(signedIn() ? ((hub.favourites || []).length ? 'subs' : 'channels') : null);
            return { label: 'videos', icon: 'x:app-youtube-lg', pages: [{ title: 'Videos', line2: line, line3: '' }], softKey: key, onTap: to };
        }
        const fresh = vids.filter((v) => isNew(v) && v.live !== 'live').length;
        const liveCount = vids.filter((v) => v.live === 'live').length;
        return {
            label: 'videos',
            count: liveCount ? 'live' : fresh ? String(fresh) : '',
            icon: 'x:app-youtube-lg',
            pages: vids.map((v) => ({ image: v.thumb, imageAspect: 16 / 9, title: v.title, line2: v.channel || '', line3: v.live === 'live' ? ['LIVE', v.viewers ? `${people(v.viewers)} watching` : '', v.note].filter(Boolean).join(' · ') : [age(v.at), rareText(v) || lenText(v)].filter(Boolean).join(' · '), softKey: key, onTap: () => openItem(v) })),
            softKey: key,
            onTap: go
        };
    }

    // ---------------------------------------------------------------- register

    function register() {
        ws = window.wmShell;
        if (!ws) return;
        ws.registerApp(APP);
        if (typeof ws.registerTodayItem === 'function') {
            ws.registerTodayItem({ id: 'youtube', label: 'Videos', icon: 'app-youtube', after: 'lapis', render: todayRender, titanium: todayTitanium });
        }
        // the socket may come up after the shell: wire once it exists (a local wait, no server call)
        if (!wire()) { let n = 0; const t = setInterval(() => { if (wire() || ++n > 120) clearInterval(t); }, 1000); }
    }

    window.wmYouTube = {
        open,
        state: () => ({ hub, tab, data, layer }),
        /** Read the open tab again (the server answers from what it holds when that is young). */
        reload: () => loadTab(tab, true)
    };

    if (window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
