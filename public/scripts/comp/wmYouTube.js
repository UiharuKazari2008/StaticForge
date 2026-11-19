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
 * A Kick stream that is live plays inside the program (#918): the server relays it in the quality chosen under
 * Quality (Kick's own lower renditions, server re-encodes at 30 fps, or Audio First), see the live player below.
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
    // On the desktop the same program runs in a window: videosDesktop.js is its shell there (window.videosDesktopShell,
    // the handful of wmShell calls this file makes), and loads this file when its window is first opened (the desktop
    // does not carry it otherwise: app.html lists it for the phone shell only).
    const HOST = { desktop: !MOBILE && !!window.videosDesktopShell };
    if (!MOBILE && !HOST.desktop) return;

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
        pause: '<svg viewBox="0 0 16 16" fill="currentColor"><rect x="3.5" y="2.5" width="3.2" height="11" rx="0.6"/><rect x="9.3" y="2.5" width="3.2" height="11" rx="0.6"/></svg>',
        play: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M4 2.3v11.4L13.4 8z"/></svg>',
        sound: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6.2h2.4L8 3.2v9.6L4.4 9.8H2z" fill="currentColor"/><path d="M10.4 5.6a3.4 3.4 0 0 1 0 4.8M12.3 3.8a6 6 0 0 1 0 8.4"/></svg>',
        mute: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6.2h2.4L8 3.2v9.6L4.4 9.8H2z" fill="currentColor"/><path d="M10.6 6l3.6 4M14.2 6l-3.6 4"/></svg>',
        stop: '<svg viewBox="0 0 16 16" fill="currentColor"><rect x="3.2" y="3.2" width="9.6" height="9.6" rx="1"/></svg>',
        out: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2.5h4.5V7M13.3 2.7L7.5 8.5M11.5 9.5v3.3a.7.7 0 0 1-.7.7H3.2a.7.7 0 0 1-.7-.7V5.2a.7.7 0 0 1 .7-.7h3.3"/></svg>',
        full: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"/></svg>',
        back: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 3.2v9.6L1.6 8zM14.4 3.2v9.6L8 8z"/></svg>',
        fwd: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 3.2v9.6L14.4 8zM1.6 3.2v9.6L8 8z"/></svg>',
        pop: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><rect x="1.5" y="2.5" width="13" height="10.5" rx="1"/><rect x="8" y="7.5" width="5" height="4" fill="currentColor" stroke="none"/></svg>',
        chat: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M2.5 3h11a1 1 0 0 1 1 1v6.2a1 1 0 0 1-1 1H8.2L5 14v-2.8H2.5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/></svg>',
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
        if (srcOf(v) === 'kick') { watchLive(v); return true; }
        if (srcOf(v) === 'app') {
            // on the phone that posted the notification: what a tap on the notification itself opens (the stream)
            const A = window.AndroidActiveSync;
            try {
                if (v.key && A && typeof A.openNotification === 'function' && (!v.device || typeof A.getDeviceId !== 'function' || A.getDeviceId() === v.device) && A.openNotification(v.key) === true) return true;
            } catch (_) { /* the app itself below */ }
            return launchApp(v.package, v.channel);
        }
        // the desktop has no YouTube app: a video plays in the window; the phone hands it to YouTube's app (hold: Play Here)
        if (HOST.desktop) { watchVideo(v); return true; }
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
    let hubSig = ''; // the last snapshot applied, while no push has changed the hub since
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
        // the server finished a look for new uploads: take the Subscriptions list it now holds (no call to
        // YouTube) while the program shows it; otherwise when it shows again (#890: the 150-row list was
        // read on every bump while only Today was on screen)
        if (items.feed && typeof items.feed.at === 'number') {
            const t = data.subs;
            if (signedIn() && t.videos && !t.loading && items.feed.at > (t.feedAt || 0)) {
                if (shown && screenOn()) loadTab('subs', false, true); else t.feedStale = true;
            }
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
        if (player && shown) plSide();
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
            // the same snapshot as last time and no push since (back on Today): nothing to apply or draw
            // again (#890: Today's item was rebuilt and its picture decoded again on every return)
            let sig = '';
            try { sig = JSON.stringify(items); } catch (_) { sig = ''; }
            if (sig && sig === hubSig && loaded) return;
            hubSig = sig;
            applyHub(items);
        } catch (_) {
            if (want) hubOn = false;
        }
    }
    function wire() {
        const c = window.wsClient;
        if (wired || !c || typeof c.on !== 'function') return !!wired;
        wired = true;
        c.on('youtube_status', (msg) => { if (hubOn && msg) { hubSig = ''; applyHub(msg.changed || (msg.data && msg.data.changed)); } }, { signal: appScopeSignal });
        c.on('youtube_chat', (msg) => { chatTake(msg && msg.data && msg.data.messages ? msg.data : msg); }, { signal: appScopeSignal });
        // the server forgets a dropped socket's subscriptions: subscribe again
        c.on('connected', () => { hubOn = false; void syncHub(); if (player && player.chatOpen) { player.chatOpen = false; chatSync(); } }, { signal: appScopeSignal });
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
            <span class="yt-tx"><span class="yt-t">${c.live ? '<i class="yt-new is-livetag">LIVE</i>' : ''}${esc(c.name)}</span><span class="yt-s">${c.notify ? 'Tells you when it goes live' : `kick.com/${esc(c.slug)}`}</span></span>
            <button type="button" class="yt-bell${c.notify ? ' is-on' : ''}" data-yt-kick-notify="${esc(c.slug)}" aria-pressed="${!!c.notify}" aria-label="${c.notify ? 'Stop telling me when ' + esc(c.name) + ' goes live' : 'Tell me when ' + esc(c.name) + ' goes live'}">${I.bell}</button>
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
            ${so.kickReady ? `<div class="yt-row is-chan is-plain" role="button" tabindex="0" data-yt-chat="setup">
                <span class="yt-th is-app is-small">${I.chat}</span>
                <span class="yt-tx"><span class="yt-t">Chat</span><span class="yt-s">${chatOn() ? 'On: read only while a stream\'s chat is open' : 'Off: nothing is received from Kick'}</span></span>
                <span class="yt-check${chatOn() ? ' is-on' : ''}" aria-hidden="true"></span>
            </div>${chatOn() ? `<div class="yt-row is-chan is-plain" role="button" tabindex="0" data-yt-chat="link">
                <span class="yt-th is-app is-small">${I.out}</span>
                <span class="yt-tx"><span class="yt-t">Kick account</span><span class="yt-s">${chatLinked() ? 'Linked: you can write in chat. Tap to remove it' : 'Tap to link an account for writing in chat'}</span></span>
                <span class="yt-check${chatLinked() ? ' is-on' : ''}" aria-hidden="true"></span>
            </div>` : ''}` : ''}
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
    /** The bell on a Kick channel: the server tells this phone the moment the channel goes live (a notification). */
    async function notifyKick(slug) {
        if (!isAdmin()) { box('Only the administrator can change the channels.', 'info'); return; }
        const c = ((hub.sources && hub.sources.kick) || []).find((x) => x.slug === slug);
        if (!c) return;
        try {
            const d = await ask('youtube_kick_notify', { slug, on: !c.notify });
            if (d.channels) { hub.sources = Object.assign({}, hub.sources, { kick: d.channels }); changed(); }
        } catch (e) {
            box(failText(e, 'The setting could not be saved'));
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
                    <div class="yt-player" hidden>
                        <div class="yt-stage">
                            <video class="yt-video" playsinline preload="none" disablepictureinpicture disableremoteplayback></video>
                            <div class="yt-frame" hidden></div>
                            <div class="yt-pl-status" hidden><i></i><span></span></div>
                            <button type="button" class="yt-pl-key is-play" data-pl="toggle" aria-label="Play" hidden></button>
                            <div class="yt-hud" hidden>
                                <div class="yt-seek" role="slider" tabindex="0" aria-label="Place in the video" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0" hidden><div class="yt-seek-track"><i class="yt-seek-buf"></i><i class="yt-seek-fill"></i><span class="yt-seek-marks"></span><i class="yt-seek-thumb"></i></div></div>
                                <button type="button" class="yt-hud-key" data-pl="toggle" aria-label="Pause">${I.pause}</button>
                                <button type="button" class="yt-hud-key" data-pl="mute" aria-label="Sound off">${I.sound}</button>
                                <button type="button" class="yt-hud-key" data-pl="stop" aria-label="Stop">${I.stop}</button>
                                <button type="button" class="yt-hud-key is-seek" data-pl="back" aria-label="Back 10 seconds" hidden>${I.back}</button>
                                <button type="button" class="yt-hud-key is-seek" data-pl="fwd" aria-label="Forward 10 seconds" hidden>${I.fwd}</button>
                                <span class="yt-hud-live"><i class="yt-new is-livetag">LIVE</i><span class="yt-pl-up"></span><span class="yt-pl-mode"></span></span>
                                <button type="button" class="yt-hud-key" data-pl="chat" aria-label="Chat" aria-pressed="false">${I.chat}</button>
                                <button type="button" class="yt-hud-key" data-pl="pop" aria-label="Pop out" hidden>${I.pop}</button>
                                <button type="button" class="yt-hud-key" data-pl="kick" aria-label="Watch in Kick's app">${I.out}</button>
                                <button type="button" class="yt-hud-key" data-pl="full" aria-label="Full screen">${I.full}</button>
                            </div>
                        </div>
                        <div class="yt-side"><div class="yt-side-title"></div><div class="yt-side-sub"></div><div class="yt-side-sub yt-side-live"><i class="yt-new is-livetag">LIVE</i><span class="yt-side-up"></span></div>
                            <div class="yt-more" hidden></div>
                            <div class="yt-chat" hidden><div class="yt-chat-list" aria-live="off"></div><form class="yt-search yt-chat-form" action="#" autocomplete="off" hidden><label class="yt-field"><input class="yt-q yt-chat-q" type="text" enterkeyhint="send" placeholder="Say something" autocomplete="off" maxlength="500"></label><button type="submit" class="yt-btn is-go">Send</button></form></div>
                        </div>
                    </div>
                    <div class="yt-sign" hidden></div>
                </div>
                <div class="yt-tabs" role="tablist"><div class="yt-slider"><i></i></div>${TABS.map((t) => `<button type="button" class="yt-tab" role="tab" data-tab="${t.id}">${t.icon}<span>${t.label}</span></button>`).join('')}</div>
            </div>`;
        const q = (s) => page.querySelector(s);
        els = {
            root: q('.yt-root'), me: q('.yt-me'), title: q('.yt-title'), note: q('.yt-note'), panes: q('.yt-panes'),
            player: q('.yt-player'), video: q('.yt-video'), plMode: q('.yt-pl-mode'), plStatus: q('.yt-pl-status'), plKey: q('.yt-pl-key'),
            plUp: q('.yt-pl-up'), hud: q('.yt-hud'), sideTitle: q('.yt-side-title'), sideSub: q('.yt-side-sub'), sideUp: q('.yt-side-up'), frame: q('.yt-frame'), seek: q('.yt-seek'), seekMarks: q('.yt-seek-marks'), more: q('.yt-more'), chat: q('.yt-chat'), chatList: q('.yt-chat-list'), chatForm: q('.yt-chat-form'), chatQ: q('.yt-chat-q'),
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
        wirePlayer();
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
        els.tabs.hidden = out || !!player;
        els.root.querySelector('.yt-head').hidden = out || !!player;
        TABS.forEach((t) => { els.paneEls[t.id].hidden = out || t.id !== tab; });
        if (!out) {
            renderPane(tab);
            renderLayer();
            placeSlider();
        } else {
            els.layer.hidden = true;
        }
        renderHead();
        if (ws) { ws.setTitle(player ? player.channel : TITLE); ws.refreshSoftKeys(); ws.refreshTitleAction(); }
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
        const kn = e.target.closest('[data-yt-kick-notify]');
        if (kn) { notifyKick(kn.dataset.ytKickNotify); return; }
        const kx = e.target.closest('[data-yt-kick-remove]');
        if (kx) { removeKick(kx.dataset.ytKickRemove); return; }
        const cs = e.target.closest('[data-yt-chat]');
        if (cs) { if (cs.dataset.ytChat === 'setup') chatSetup(!chatOn()); else chatLink(); return; }
        const app = e.target.closest('[data-yt-app]');
        if (app) { toggleApp(app.dataset.ytApp, app.dataset.ytLabel); return; }
        const kc = e.target.closest('[data-yt-kick]');
        if (kc) { openUrl(`https://kick.com/${kc.dataset.ytKick}`, true, KICK_PACKAGE); return; }
        const v = e.target.closest('[data-v]');
        if (v) {
            const item = seen.get(v.dataset.v) || { id: v.dataset.v };
            // in the player's "more to watch" list the next video plays here too
            if (player && player.vod && v.closest('.yt-more') && srcOf(item) === 'youtube') watchVideo(item); else openItem(item);
            return;
        }
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
                { label: kick ? 'Watch Here' : `Open ${v.channel || 'the App'}`, action: () => openItem(v) },
                kick ? { label: 'Watch in Kick\'s App', action: () => openUrl(v.url, true, KICK_PACKAGE) } : null,
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
                { label: 'Play Here', action: () => watchVideo(v) },
                { label: HOST.desktop ? 'Open on youtube.com' : 'Play in YouTube', action: () => openVideo(v.id) },
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

    // ---------------------------------------------------------------- the live player (Kick, through the server; #918)
    //
    // A Kick stream is played here, not in Kick's app: the server pulls it and hands the phone a steady, lighter
    // stream (HLS pieces under /api/videos/live/<id>/). The picture is a plain <video> with the program's own
    // keys (no browser controls); hls.js (public/dist/hlsjs, loaded when the player first opens) does the
    // fetching and rides out a weak connection. When the program or the app is left, the Dreamscape app's native
    // player carries the stream on (a floating window over Today and other apps, or sound alone); without the
    // app (a plain browser) loading stops until the program is in front again. With the screen off only Audio
    // First keeps going.

    const LS_MODE = 'wmVideosLiveMode';
    const HLS_SRC = '/dist/hlsjs/hls.light.min.js';
    let player = null; // { slug, title, channel, url, mode, modes, id, hls, state, held, lock, tries, keyTimer }
    let hlsLoading = null;

    // The Dreamscape app's native player (DSApp videos/VideoPlayback.kt): when this program or the app is left,
    // the stream carries on there as a floating window or as sound, so it never depends on this page running.
    const nativePlayer = () => (window.AndroidVideos && typeof window.AndroidVideos.watching === 'function' ? window.AndroidVideos : null);
    /**
     * Tells the app what the page's player shows (or that it shows nothing): it takes over when the app is left.
     * Only a stream that is on screen and playing counts (Yukimi, Nov 18 2026: "the pip also should only show if we
     * are watching a video player not just randomly like it did"): paused, closed, left for the lists or the program
     * ended, the app is told nothing plays, so another Android app coming up starts no player. A stream the app
     * already carries (handed over, or popped out) stays told.
     */
    function plTell() {
        const nv = nativePlayer();
        if (!nv) return;
        const p = player;
        const on = !!(p && !p.vod && p.state === 'live' && p.url && (p.handed || p.popped || (shown && !p.suspended && els && !els.video.paused)));
        const said = on ? JSON.stringify({ url: new URL(p.url, location.origin).toString(), title: p.title, subtitle: modeLabel(p.mode), audioOnly: p.mode === 'audio' }) : '';
        if (said === plTold) return;
        plTold = said;
        try {
            nv.watching(said);
        } catch (_) { /* an older app build */ }
    }
    let plTold = null;
    /** The native player gives the stream back to the page (Videos is in front again). */
    function plTakeBack() {
        const p = player;
        const nv = nativePlayer();
        if (!p || !nv) return;
        let active = false;
        try { active = nv.isActive() === true; } catch (_) { active = false; }
        if (p.handed || p.popped || active) { p.handed = false; p.popped = false; try { nv.stop(); } catch (_) { /* gone */ } }
    }

    /**
     * The pop-out key (Yukimi, Nov 18 2026: "add a button on the video hud to pop out and if the chat is shown it
     * will stay in the app otherwise drop to the today screen"): the app's native player takes the stream into
     * Android's picture-in-picture at once, the page's own video stops (one sound), and the program stays for the
     * chat when it is shown, or else gives way to Today.
     */
    const canPop = () => { const nv = nativePlayer(); return !!(nv && typeof nv.popOut === 'function'); };
    function plPop() {
        const p = player;
        const nv = nativePlayer();
        if (!p || p.vod || p.state !== 'live' || !canPop()) return;
        if (els.video.paused) { box('Start the stream first, then pop it out.', 'info'); return; }
        plTell();
        let ok = false;
        try { ok = nv.popOut() === true; } catch (_) { ok = false; }
        if (!ok) { box('The stream could not be popped out.', 'info'); return; }
        p.handed = true;
        p.popped = true;
        if (p.full) plFull(false);
        plSuspend(true);
        plStatus('Playing in its own window. Tap here to bring it back.', false);
        els.hud.hidden = true;
        if (!p.chatOn && ws) ws.open('today');
    }
    /** A popped-out stream comes back into the page (its window was tapped, or the picture here was). */
    function plPopBack() {
        const p = player;
        if (!p || !p.popped) return;
        plTakeBack();
        plSuspend(false);
    }

    const liveMode = () => { const first = HOST.desktop ? 'hw720' : '480'; try { return localStorage.getItem(LS_MODE) || first; } catch (_) { return first; } };
    const modeLabel = (id) => { const m = ((player && player.modes) || []).find((x) => x.id === id); return m ? m.label : ''; };

    function loadHls() {
        if (window.Hls) return Promise.resolve(window.Hls);
        if (!hlsLoading) {
            hlsLoading = new Promise((resolve, reject) => {
                const el = document.createElement('script');
                el.src = HLS_SRC;
                el.onload = () => resolve(window.Hls);
                el.onerror = () => { hlsLoading = null; reject(new Error('The player could not be loaded')); };
                document.head.appendChild(el);
            });
        }
        return hlsLoading;
    }

    function plStatus(text, busy) {
        if (!els) return;
        const want = text || '';
        els.plStatus.hidden = !want;
        const span = els.plStatus.lastElementChild;
        if (span.textContent !== want) span.textContent = want;
        els.plStatus.classList.toggle('is-busy', !!busy);
    }

    function plHead() {
        if (!els || !player) return;
        const m = modeLabel(player.mode);
        if (els.plMode.textContent !== m) els.plMode.textContent = m;
    }

    /** Keeps the page (and for a picture, the screen) awake while a stream plays; off again when it stops. */
    function plHold(on) {
        if (!player) return;
        const mc = window.melatonContinuity;
        const wantPage = on && /audio$/.test(player.mode || '');
        if (mc && typeof mc.holdAwake === 'function' && !!player.held !== wantPage) { player.held = wantPage; mc.holdAwake('videos-live', wantPage); }
        const wantScreen = on && !/audio$/.test(player.mode || '');
        if (wantScreen && !player.lock && navigator.wakeLock && typeof navigator.wakeLock.request === 'function') {
            navigator.wakeLock.request('screen').then((l) => { if (player && !player.lock) player.lock = l; else l.release().catch(() => {}); }).catch(() => {});
        } else if (!wantScreen && player.lock) {
            player.lock.release().catch(() => {});
            player.lock = null;
        }
    }

    function plDetach() {
        if (!player) return;
        if (player.hls) {
            // hls.js finishes a piece it was unpacking after destroy() and then throws inside itself (seen as "Melaton
            // Desktop has stopped working" when a video was left while it loaded): stop and let go first, end it a moment later
            const h = player.hls;
            player.hls = null;
            try { h.stopLoad(); h.detachMedia(); } catch (_) { /* gone */ }
            setTimeout(() => { try { h.destroy(); } catch (_) { /* gone */ } }, 2000); // perf: allow one deferred clean-up of a closed player
        }
        if (els) { els.video.removeAttribute('src'); try { els.video.load(); } catch (_) { /* nothing loaded */ } }
    }

    async function plAttach() {
        const p = player;
        if (!p || !p.url || !els) return;
        const video = els.video;
        let Hls = null;
        try { Hls = await loadHls(); } catch (_) { Hls = null; }
        if (player !== p) return;
        plDetach();
        if (Hls && Hls.isSupported()) {
            // a live stream on a connection that drops out: stay five pieces (20 s) behind so there is a reserve
            // to play from through a gap (nobody chats here, the delay costs nothing), try again patiently, and never climb to a heavier rendition (there is only this one)
            const hls = new Hls({ lowLatencyMode: false, liveSyncDurationCount: 5, liveMaxLatencyDurationCount: 13, maxBufferLength: 30, maxMaxBufferLength: 48, backBufferLength: 8,
                manifestLoadingMaxRetry: 8, levelLoadingMaxRetry: 10, fragLoadingMaxRetry: 10, fragLoadingRetryDelay: 800, levelLoadingRetryDelay: 800 });
            p.hls = hls;
            hls.on(Hls.Events.MANIFEST_PARSED, () => { video.play().catch(plNeedsTap); });
            hls.on(Hls.Events.ERROR, (_e, d) => {
                if (!d || !d.fatal || player !== p) return;
                if (d.type === Hls.ErrorTypes.MEDIA_ERROR && p.tries < 6) { p.tries++; hls.recoverMediaError(); return; }
                plLost();
            });
            hls.loadSource(p.url);
            hls.attachMedia(video);
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = p.url;
            video.play().catch(plNeedsTap);
        } else {
            plStatus('This phone\'s browser cannot play the stream.', false);
        }
    }

    /** The browser will not start playing by itself (no touch came with it): the play key, and nothing that looks busy. */
    /** While a stream is watched the header and the tab strip step aside: the picture has the whole page. */
    function plChrome() {
        if (!els) return;
        const off = !signedIn() || !!player;
        if (els.tabs.hidden !== off) els.tabs.hidden = off;
        const head = els.root.querySelector('.yt-head');
        if (head.hidden !== off) head.hidden = off;
    }

    function plNeedsTap() {
        if (!player) return;
        plStatus('', false);
        plHud(true);
    }

    /** The stream stopped arriving: ask the server what became of it, then start again or say it ended. */
    async function plLost() {
        const p = player;
        if (!p || p.vod || p.state === 'starting') return;
        plDetach();
        plStatus('Reconnecting...', true);
        let st = null;
        try { st = p.id ? await ask('youtube_live_state', { id: p.id }, 10000) : null; } catch (_) { st = null; }
        if (player !== p) return;
        if (st && st.state === 'ended') { p.state = 'ended'; plStatus('The stream has ended.', false); plHold(false); plTell(); refreshKeys(); return; }
        if (st && (st.state === 'live' || st.state === 'restarting') && p.tries < 30) {
            p.tries++;
            p.retry = setTimeout(() => { if (player === p && p.state === 'live' && shown) plAttach(); }, st.state === 'live' ? 1500 : 5000); // perf: allow one reconnect after a lost stream, not a poll
            return;
        }
        plStart(p.mode);
    }

    async function plStart(mode) {
        const p = player;
        if (!p) return;
        clearTimeout(p.retry);
        plDetach();
        p.mode = mode;
        p.state = 'starting';
        p.tries = 0;
        try { localStorage.setItem(LS_MODE, mode); } catch (_) { /* private mode */ }
        plHead();
        plStatus(mode === 'audio' || /^(e|hw)/.test(mode) ? 'Starting the stream (the server is encoding it)...' : 'Starting the stream...', true);
        refreshKeys();
        try {
            const d = await ask('youtube_live_start', { slug: p.slug, mode }, 75000);
            if (player !== p || p.mode !== mode) return;
            p.id = d.id;
            p.url = d.url;
            p.modes = d.modes || p.modes;
            p.mode = d.mode || mode;
            p.state = 'live';
            plHead();
            plHold(true);
            plTell();
            plSide();
            plClock(true);
            refreshKeys();
            if (shown) await plAttach(); else p.suspended = true;
        } catch (e) {
            if (player !== p) return;
            p.state = e && e.code === 'KICK_OFFLINE' ? 'ended' : 'error';
            plStatus(p.state === 'ended' ? 'That channel is not live right now.' : failText(e, 'The stream could not be started'), false);
            refreshKeys();
        }
    }

    let pendingWatch = null; // a stream asked for before the program's page existed (a tap on Today)
    function watchLive(v) {
        if (!isAdmin()) { box('Only the administrator can watch a stream through the server.', 'info'); return; }
        const slug = String(v.id || '').replace(/^kick:/, '');
        if (!slug) return;
        if (ws && ws.currentApp && ws.currentApp() !== APP_ID) { pendingWatch = v; ws.open(APP_ID); if (pendingWatch !== v) return; pendingWatch = null; }
        // the program's page is made on its first open: the stream starts once it is there (show())
        if (!els) { pendingWatch = v; return; }
        if (player && player.slug === slug && player.state !== 'ended' && player.state !== 'error') return;
        if (player) stopPlayer();
        player = { slug, channel: v.channel || slug, streamTitle: v.title || '', title: `${v.channel || slug}: ${v.title || ''}`, startedAt: v.at || 0, kickUrl: v.url || `https://kick.com/${slug}`, mode: liveMode(), modes: (player && player.modes) || [], id: '', url: '', hls: null, state: 'starting', tries: 0 };
        els.player.hidden = false;
        plChrome();
        plSide();
        syncPlayer();
        plStart(player.mode);
    }

    /** Leaves the player: the stream stops on the phone and, a moment later with nobody asking, on the server. */
    function stopPlayer() {
        const p = player;
        if (!p) return false;
        clearTimeout(p.retry);
        clearTimeout(p.keyTimer);
        clearInterval(p.clock);
        chatDrop(p);
        if (page) page.classList.remove('is-full');
        if (p.vod) ytClose(p);
        plDetach();
        plHold(false);
        if (p.id) ask(p.kind === 'ytr' ? 'youtube_video_stop' : 'youtube_live_stop', { id: p.id }, 8000).catch(() => {});
        player = null;
        plTell();
        const nv = nativePlayer();
        if (nv) { try { nv.stop(); } catch (_) { /* gone */ } }
        if (els) { els.player.hidden = true; els.hud.hidden = true; els.plKey.hidden = true; plChrome(); plStatus('', false); }
        syncPlayer();
        return true;
    }

    /** Not in front (or the screen off on a picture mode): stop fetching; back again: carry on at the live edge. */
    function plSuspend(off) {
        const p = player;
        if (p && p.kind === 'yt') { if (off && !p.paused) ytCmd('pauseVideo'); return; }
        if (p && p.kind === 'ytr') { if (off && els && !els.video.paused) els.video.pause(); return; }
        if (!p || p.state !== 'live') return;
        if (off && !p.suspended) { p.suspended = true; clearTimeout(p.retry); plClock(false); plDetach(); plHold(false); } else if (!off && p.suspended) { p.suspended = false; plHold(true); plClock(true); plLost(); }
        chatSync();
        plTell();
    }

    /** "4 h 27 min" since the stream began (its start time comes with the live item). */
    function upText() {
        const p = player;
        if (!p || !p.startedAt) return '';
        const min = Math.max(0, Math.floor((Date.now() - p.startedAt) / 60000));
        return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
    }
    const setText = (el, text) => { if (el && el.textContent !== text) el.textContent = text; };

    /** What is beside (under) the picture when there is room: the stream's title, who and how many, how long. */
    function plSide() {
        const p = player;
        if (!els || !p) return;
        if (p.vod) { ytSide(); return; }
        const now = liveNow().find((x) => x.id === `kick:${p.slug}`) || (hub.live && hub.live.items || []).find((x) => x.id === `kick:${p.slug}`);
        if (now) { if (now.title) p.streamTitle = now.title; if (now.at) p.startedAt = now.at; p.viewers = now.viewers; p.note = now.note; }
        const up = upText();
        setText(els.sideTitle, p.streamTitle || p.channel);
        setText(els.sideSub, [p.channel, p.viewers ? `${people(p.viewers)} watching` : '', p.note || ''].filter(Boolean).join(' · '));
        setText(els.sideUp, [up, modeLabel(p.mode)].filter(Boolean).join(' · '));
        setText(els.plUp, up);
    }

    /** The minute tick of "live for": only while the player is on screen. */
    function plClock(on) {
        const p = player;
        if (!p || p.vod) return;
        clearInterval(p.clock);
        p.clock = null;
        if (on && shown && p.state === 'live') p.clock = setInterval(plSide, 60000); // perf: allow a clock while it shows (stopped with the player and when it is not in front)
    }

    /** The keys over the picture (pause, sound, stop, Kick's app, full screen): a tap shows them, they go by themselves. */
    function plHud(show) {
        if (!els || !player) return;
        const paused = plPaused();
        const live = player.state === 'live';
        clearTimeout(player.keyTimer);
        if (els.hud.hidden === show) els.hud.hidden = !show;
        // the big key in the middle only while paused (or when the browser wants a touch before it plays)
        const big = live && paused;
        if (els.plKey.hidden === big) els.plKey.hidden = !big;
        const t = els.hud.querySelector('[data-pl="toggle"]');
        const tHtml = paused ? I.play : I.pause;
        if (t.dataset.g !== (paused ? 'play' : 'pause')) { t.dataset.g = paused ? 'play' : 'pause'; t.innerHTML = tHtml; t.setAttribute('aria-label', paused ? 'Play' : 'Pause'); }
        const m = els.hud.querySelector('[data-pl="mute"]');
        const muted = player.kind === 'yt' ? !!player.muted : !!els.video.muted;
        if (m.dataset.g !== (muted ? 'mute' : 'sound')) { m.dataset.g = muted ? 'mute' : 'sound'; m.innerHTML = muted ? I.mute : I.sound; m.setAttribute('aria-label', muted ? 'Sound on' : 'Sound off'); }
        const pk = els.hud.querySelector('[data-pl="pop"]');
        const popOk = !player.vod && canPop();
        if (pk.hidden === popOk) pk.hidden = !popOk;
        if (show) { plSide(); if (!paused) player.keyTimer = setTimeout(() => { if (els && player) els.hud.hidden = true; }, 4000); }
    }
    const plKey = (show) => plHud(show);

    /** Full screen: the picture over the whole display, bars and all. auto: it was the turn to landscape that asked. */
    function plFull(on, auto) {
        if (!page || !player) return;
        if (HOST.desktop) {
            // the desktop's full screen is the browser's (the player element over the whole display)
            try { if (on && !document.fullscreenElement) els.player.requestFullscreen().catch(() => {}); else if (!on && document.fullscreenElement) document.exitFullscreen().catch(() => {}); } catch (_) { /* refused */ }
            player.full = !!on;
            chatSync();
            return;
        }
        player.full = !!on;
        player.fullAuto = !!on && !!auto;
        page.classList.toggle('is-full', !!on);
        chatSync();
    }
    // a phone-sized screen turned on its side (the Fold's cover screen, a phone): the picture takes all of it
    function plTurned() {
        const p = player;
        if (!p || Math.min(window.innerWidth, window.innerHeight) >= 560) return;
        const land = window.innerWidth > window.innerHeight;
        if (land && !p.full) plFull(true, true);
        else if (!land && p.fullAuto) plFull(false);
    }

    function plToggle() {
        if (!player || player.state !== 'live' || !els) return;
        if (player.kind === 'yt') { ytToggle(); return; }
        if (player.kind === 'ytr') { if (els.video.paused) els.video.play().catch(() => {}); else els.video.pause(); return; }
        const v = els.video;
        if (v.paused) {
            // a live stream carries on without us: back at the newest picture, not where it was paused
            if (player.hls && player.hls.liveSyncPosition) { try { v.currentTime = player.hls.liveSyncPosition; } catch (_) { /* not seekable yet */ } }
            v.play().catch(() => {});
        } else v.pause();
    }

    // ---------------------------------------------------------------- a YouTube video played here
    //
    // YouTube's own embedded player in a frame (youtube-nocookie.com/embed), driven over its message interface:
    // none of its script runs in this page, and its own controls are off (the keys are the program's). A video
    // its owner does not let play elsewhere, or one for members, is handed to YouTube itself. The frame is not
    // signed in, so a video played most of the way here is marked as watched in the account's history
    // (the same mark as the hold menu's).

    const YT_EMBED = 'https://www.youtube-nocookie.com';
    function ytCmd(func, args) {
        const p = player;
        const f = p && p.frame;
        if (!f || !f.contentWindow) return;
        try { f.contentWindow.postMessage(JSON.stringify({ event: 'command', func, args: args || [] }), YT_EMBED); } catch (_) { /* the frame went */ }
    }
    const plPaused = () => (player && player.kind === 'yt' ? player.paused !== false : !!(els && els.video.paused));
    function ytToggle() { ytCmd(player.paused === false ? 'pauseVideo' : 'playVideo'); }
    function ytSeek(to, auto) {
        const p = player;
        const t = Math.max(0, Math.min(to, (p.len || to) - 1));
        // the viewer moved into a marked part on purpose: that one plays
        if (!auto) p.segKept = (p.segs || []).find((x) => t >= x.start && t < x.end) || null;
        if (p.kind === 'ytr') {
            // inside what the server has written: the player moves; outside it: the server starts from there
            const v = els.video;
            const local = t - (p.offset || 0);
            const end = v.seekable && v.seekable.length ? v.seekable.end(v.seekable.length - 1) : 0;
            if (p.state === 'live' && local >= 0 && local <= end) { p.pos = t; try { v.currentTime = local; } catch (_) { /* not ready */ } ytSide(); } else if (p.state !== 'starting') ytrStart(p.mode, t);
            return;
        }
        p.pos = t;
        ytCmd('seekTo', [t, true]);
        ytSide();
    }
    function ytSide() {
        const p = player;
        if (!els || !p) return;
        const at = p.len ? `${clock(Math.floor(p.pos || 0))} / ${clock(Math.floor(p.len))}` : '';
        setText(els.sideTitle, p.streamTitle || 'YouTube');
        setText(els.sideSub, p.channel || '');
        setText(els.sideUp, at);
        setText(els.plUp, at);
        setText(els.plMode, p.kind === 'ytr' ? modeLabel(p.mode) : '');
        seekDraw();
    }

    // ---------------------------------------------------------------- the seek bar, and SponsorBlock's marked parts
    //
    // The program's own slider (rule sliders-platform: a drawn one for a drawn player, never the browser's): a
    // track with what is written so far, what is played, SponsorBlock's parts as marks, and a thumb. Drag or tap
    // moves; Left / Right step 5 seconds, Home / End go to the ends. It is drawn only while the keys show.

    const SKIPPED = { sponsor: 'sponsor', selfpromo: 'self-promotion', interaction: 'reminder' };
    const skipOn = () => !hub.settings || hub.settings.skipSegments !== false;
    function seekDraw(at) {
        const p = player;
        if (!els || !p || !p.vod || els.seek.hidden || (p.dragging && at === undefined)) return;
        const len = p.len || 0;
        const pos = at === undefined ? (p.pos || 0) : at;
        const f = len ? Math.max(0, Math.min(1, pos / len)) : 0;
        let b = f;
        if (p.kind === 'ytr') { const v = els.video; const end = v.seekable && v.seekable.length ? v.seekable.end(v.seekable.length - 1) : 0; b = len ? Math.max(f, Math.min(1, ((p.offset || 0) + end) / len)) : f; }
        els.seek.style.setProperty('--p', f.toFixed(4));
        els.seek.style.setProperty('--b', b.toFixed(4));
        els.seek.setAttribute('aria-valuemax', String(Math.floor(len)));
        els.seek.setAttribute('aria-valuenow', String(Math.floor(pos)));
        els.seek.setAttribute('aria-valuetext', `${clock(Math.floor(pos))} of ${clock(Math.floor(len))}`);
    }
    function seekMarks() {
        const p = player;
        if (!els) return;
        els.seekMarks.textContent = '';
        if (!p || !p.vod || !p.len || !p.segs) return;
        p.segs.forEach((s) => {
            const m = document.createElement('i');
            m.className = SKIPPED[s.category] ? 'is-skip' : '';
            m.style.left = `${Math.min(100, (s.start / p.len) * 100)}%`;
            m.style.width = `${Math.max(0.4, ((Math.min(s.end, p.len) - s.start) / p.len) * 100)}%`;
            els.seekMarks.appendChild(m);
        });
    }
    /** Asks for SponsorBlock's parts of the video being played (the server asks SponsorBlock, privately). */
    function segsLoad(p) {
        p.segs = [];
        seekMarks();
        ask('youtube_segments', { id: p.vid }, 12000).then((d) => { if (player === p && d && Array.isArray(d.segments)) { p.segs = d.segments; seekMarks(); } }).catch(() => {});
    }
    /** Playing has come into a marked part: on to its end (unless the viewer moved into it on purpose). */
    function segSkip(p) {
        if (!p.segs || !p.segs.length || !skipOn() || p.dragging) return;
        const pos = p.pos || 0;
        const s = p.segs.find((x) => SKIPPED[x.category] && pos >= x.start && pos < x.end - 1 && x !== p.segKept);
        if (!s) return;
        const to = Math.min(s.end, (p.len || s.end) - 1);
        ytSeek(to, true);
        plStatus(`Skipped a ${SKIPPED[s.category]}`, false);
        clearTimeout(p.skipNote);
        p.skipNote = setTimeout(() => { if (player === p && els.plStatus.lastElementChild.textContent.startsWith('Skipped')) plStatus('', false); }, 2500); // perf: allow one note that clears itself
    }
    function wireSeek() {
        const bar = els.seek;
        const at = (e) => { const r = bar.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width))) * ((player && player.len) || 0); };
        const show = (t) => { seekDraw(t); setText(els.plUp, `${clock(Math.floor(t))} / ${clock(Math.floor(player.len || 0))}`); };
        bar.addEventListener('pointerdown', (e) => {
            const p = player;
            if (!p || !p.vod || !p.len) return;
            e.preventDefault();
            try { bar.setPointerCapture(e.pointerId); } catch (_) { /* no capture */ }
            p.dragging = true;
            p.dragTo = at(e);
            clearTimeout(p.keyTimer);
            show(p.dragTo);
        });
        bar.addEventListener('pointermove', (e) => { const p = player; if (p && p.dragging) { p.dragTo = at(e); show(p.dragTo); } });
        const done = (e) => {
            const p = player;
            if (!p || !p.dragging) return;
            p.dragging = false;
            try { bar.releasePointerCapture(e.pointerId); } catch (_) { /* gone */ }
            if (e.type === 'pointerup') ytSeek(p.dragTo); else seekDraw();
            plHud(true);
        };
        bar.addEventListener('pointerup', done);
        bar.addEventListener('pointercancel', done);
        bar.addEventListener('keydown', (e) => {
            const p = player;
            if (!p || !p.vod || !p.len) return;
            const step = { ArrowLeft: -5, ArrowRight: 5, ArrowDown: -30, ArrowUp: 30 }[e.key];
            const to = step ? (p.pos || 0) + step : e.key === 'Home' ? 0 : e.key === 'End' ? p.len - 5 : null;
            if (to === null) return;
            e.preventDefault();
            ytSeek(to);
            plHud(true);
        });
    }
    /** What the frame says: it is ready, its state, where it is. */
    function ytHear(e) {
        const p = player;
        if (!p || p.kind !== 'yt' || !p.frame || e.source !== p.frame.contentWindow || e.origin !== YT_EMBED) return;
        let d = null;
        try { d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch (_) { d = null; }
        if (!d || typeof d !== 'object') return;
        if (d.event === 'onError') {
            const id = p.vid;
            stopPlayer();
            if (HOST.desktop) box('YouTube does not let this video play outside its own pages (its owner\'s choice, or a video for members).', 'info');
            else openVideo(id);
            return;
        }
        const info = d.info && typeof d.info === 'object' ? d.info : null;
        if (!info) return;
        if (typeof info.duration === 'number' && info.duration > 0) p.len = info.duration;
        if (typeof info.currentTime === 'number') {
            const sec = Math.floor(info.currentTime);
            p.pos = info.currentTime;
            if (p.len) p.best = Math.max(p.best || 0, (p.pos / p.len) * 100);
            // the clock is written when its second changes, and only while the keys or the panel show it
            if (sec !== p.sec) {
                p.sec = sec;
                if (shown && (!els.hud.hidden || !p.full)) ytSide();
                // where it is, every half minute of playing: the rows' progress line and where it carries on
                if (sec > 0 && sec % 30 === 0) ytProgress(p);
                segSkip(p);
            }
        }
        if (typeof info.playerState === 'number' && info.playerState !== p.ytState) {
            p.ytState = info.playerState;
            const was = p.paused;
            p.paused = !(info.playerState === 1 || info.playerState === 3);
            if (info.playerState === 1) { plStatus('', false); p.started = true; } else if (info.playerState === 3) plStatus('Buffering...', true);
            if (info.playerState === 0) { p.best = 100; stopPlayer(); return; }
            if (was !== p.paused) { plHold(!p.paused); plHud(p.paused ? true : !els.hud.hidden); }
        }
    }
    function ytProgress(p) {
        if (!p.len || !isAdmin()) return;
        const pct = Math.round(((p.pos || 0) / p.len) * 1000) / 10;
        if (pct === p.sentPct) return;
        p.sentPct = pct;
        eachVideo(p.vid, (v) => { if (!v.watched) { v.progress = pct; v.resume = Math.floor(p.pos || 0); } });
        stale = true;
        ask('youtube_progress', { id: p.vid, pct, pos: Math.floor(p.pos || 0) }, 10000).catch(() => {});
    }
    /** Under the picture: more to watch, the feed's unwatched videos (a tap plays the next one here). */
    function ytMore(p) {
        const list = (data.subs.videos || []).filter((v) => srcOf(v) === 'youtube' && v.id !== p.vid && !v.watched && v.live !== 'upcoming').slice(0, 12);
        els.more.innerHTML = list.length ? `<div class="yt-sec">More from your subscriptions</div>${list.map((v) => videoRow(v, false)).join('')}` : '';
        els.more.hidden = !list.length;
    }
    function ytClose(p) {
        if ((p.best || 0) < 60 && (p.pos || 0) > 5) ytProgress(p);
        // the rows show the new place at once
        redraw();
        els.more.hidden = true;
        els.more.textContent = '';
        els.seek.hidden = true;
        clearTimeout(p.skipNote);
        if (p.frame) { p.frame.remove(); p.frame = null; }
        clearTimeout(p.ytTimer);
        if (els) { els.frame.hidden = true; els.player.classList.remove('is-yt', 'is-vod'); els.hud.querySelectorAll('.is-seek').forEach((k) => { k.hidden = true; }); els.hud.querySelector('[data-pl="chat"]').hidden = false; }
        // played most of the way: watched, in the account's own history
        const v = seen.get(p.vid);
        if ((p.best || 0) >= 60 && isAdmin() && !(v && v.watched)) setWatched(p.vid, true);
    }

    // ---------------------------------------------------------------- a YouTube video through the server
    //
    // Yukimi, Nov 18 2026: "for youtube are you performing the transcording on the server like we should" / "yes use
    // yt-dlp with autoupdate". The server (modules/videosYoutubeRelay.js) pulls the video at the chosen size and
    // hands it over as HLS, played by the program's own <video> like a Kick stream. What a server is not given (a
    // members' video, an age gate, a refusal) falls back to YouTube's embedded player below.

    const LS_VMODE = 'wmVideosVideoMode';
    const vodMode = () => { const first = HOST.desktop ? 'v720' : 'v480'; try { return localStorage.getItem(LS_VMODE) || first; } catch (_) { return first; } };

    function watchVideo(v) {
        const id = String((v && v.id) || '');
        if (!/^[\w-]{6,20}$/.test(id) || !els) { if (id) openVideo(id); return; }
        if (!isAdmin() || v.live === 'live' || v.live === 'upcoming') { watchEmbed(v); return; }
        if (player) stopPlayer();
        const at = v.resume > 5 && v.progress > 0 && v.progress < 95 && !v.watched ? Math.floor(v.resume) : 0;
        player = { kind: 'ytr', vod: true, item: v, vid: id, slug: '', channel: v.channel || 'YouTube', streamTitle: v.title || '', title: v.title || '', state: 'starting', mode: vodMode(), modes: [], id: '', url: '', hls: null, tries: 0, offset: at, pos: at, len: v.length || 0 };
        const p = player;
        els.player.hidden = false;
        els.player.classList.add('is-vod');
        els.hud.querySelectorAll('.is-seek').forEach((k) => { k.hidden = false; });
        els.hud.querySelector('[data-pl="chat"]').hidden = true;
        els.seek.hidden = false;
        ytMore(p);
        segsLoad(p);
        plChrome();
        ytSide();
        syncPlayer();
        ytrStart(p.mode, at);
    }

    async function ytrStart(mode, at) {
        const p = player;
        if (!p || p.kind !== 'ytr') return;
        plDetach();
        p.mode = mode;
        p.state = 'starting';
        try { localStorage.setItem(LS_VMODE, mode); } catch (_) { /* private mode */ }
        plStatus('Starting the video...', true);
        refreshKeys();
        try {
            const d = await ask('youtube_video_start', { id: p.vid, mode, at: Math.max(0, Math.floor(at || 0)) }, 90000);
            if (player !== p || p.mode !== mode) return;
            p.id = d.id;
            p.url = d.url;
            p.offset = d.at || 0;
            p.pos = Math.max(p.offset, at || 0);
            p.len = d.duration || p.len;
            p.modes = d.modes || p.modes;
            p.mode = d.mode || mode;
            p.state = 'live';
            plHold(true);
            ytSide();
            refreshKeys();
            if (shown) await ytrAttach();
        } catch (e) {
            if (player !== p) return;
            // not for a server (members, an age gate, a refusal, a live stream): YouTube's own player
            const item = p.item;
            stopPlayer();
            watchEmbed(item);
        }
    }

    async function ytrAttach() {
        const p = player;
        if (!p || p.kind !== 'ytr' || !p.url || !els) return;
        const video = els.video;
        let Hls = null;
        try { Hls = await loadHls(); } catch (_) { Hls = null; }
        if (player !== p) return;
        plDetach();
        if (Hls && Hls.isSupported()) {
            // the list grows while the server writes: start at its beginning, not at its newest end
            const hls = new Hls({ startPosition: 0, lowLatencyMode: false, maxBufferLength: 40, maxMaxBufferLength: 90, backBufferLength: 30, fragLoadingMaxRetry: 8, levelLoadingMaxRetry: 8 });
            p.hls = hls;
            hls.on(Hls.Events.MANIFEST_PARSED, () => { video.play().catch(plNeedsTap); });
            hls.on(Hls.Events.ERROR, (_e, d) => {
                if (!d || !d.fatal || player !== p) return;
                if (d.type === Hls.ErrorTypes.MEDIA_ERROR && p.tries < 4) { p.tries++; hls.recoverMediaError(); return; }
                // the server's files went (a long pause) or the pull broke: from where it was, a few times
                if (p.tries < 8) { p.tries++; ytrStart(p.mode, p.pos || 0); } else { const item = p.item; stopPlayer(); watchEmbed(item); }
            });
            hls.loadSource(p.url);
            hls.attachMedia(video);
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = p.url;
            video.play().catch(plNeedsTap);
        } else {
            const item = p.item;
            stopPlayer();
            watchEmbed(item);
        }
    }
    /** The <video>'s clock for a video through the server: its place, the progress line, the end. */
    function ytrTime() {
        const p = player;
        if (!p || p.kind !== 'ytr' || p.state !== 'live') return;
        p.pos = (p.offset || 0) + els.video.currentTime;
        if (p.len) p.best = Math.max(p.best || 0, (p.pos / p.len) * 100);
        const sec = Math.floor(p.pos);
        if (sec === p.sec) return;
        p.sec = sec;
        if (shown && (!els.hud.hidden || !p.full)) ytSide();
        if (sec > 0 && sec % 30 === 0) ytProgress(p);
        segSkip(p);
    }

    function watchEmbed(v) {
        const id = String((v && v.id) || '');
        if (!/^[\w-]{6,20}$/.test(id) || !els) { if (id) openVideo(id); return; }
        if (player) stopPlayer();
        player = { kind: 'yt', vod: true, vid: id, slug: '', channel: v.channel || 'YouTube', streamTitle: v.title || '', title: v.title || '', state: 'live', paused: true, muted: false, pos: 0, len: v.length || 0, modes: [], id: '', url: '', tries: 0 };
        const p = player;
        els.player.hidden = false;
        els.player.classList.add('is-yt', 'is-vod');
        els.hud.querySelectorAll('.is-seek').forEach((k) => { k.hidden = false; });
        els.hud.querySelector('[data-pl="chat"]').hidden = true;
        const f = document.createElement('iframe');
        f.className = 'yt-frame-el';
        f.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture');
        f.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
        f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation');
        f.title = 'YouTube';
        f.tabIndex = -1;
        f.addEventListener('load', () => {
            // the frame tells its state once it knows somebody listens
            try { f.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), YT_EMBED); } catch (_) { /* gone */ }
            ['onStateChange', 'onError'].forEach((name) => ytCmd('addEventListener', [name]));
        }, { once: true });
        // a video left part way carries on where it was
        const from = v.resume > 5 && v.progress > 0 && v.progress < 95 && !v.watched ? { start: String(Math.floor(v.resume)) } : {};
        els.seek.hidden = false;
        ytMore(p);
        segsLoad(p);
        f.src = `${YT_EMBED}/embed/${encodeURIComponent(id)}?${new URLSearchParams({ ...from, enablejsapi: '1', controls: '0', playsinline: '1', autoplay: '1', rel: '0', iv_load_policy: '3', fs: '0', disablekb: '1', origin: location.origin }).toString()}`;
        p.frame = f;
        els.frame.textContent = '';
        els.frame.appendChild(f);
        els.frame.hidden = false;
        plStatus('Starting the video...', true);
        // nothing after a while: the browser wants a touch first, so the play key shows
        p.ytTimer = setTimeout(() => { if (player === p && !p.started) { plStatus('', false); plHud(true); } }, 6000); // perf: allow one wait for a video to start
        plChrome();
        ytSide();
        syncPlayer();
    }

    // ---------------------------------------------------------------- a stream's chat (Kick, #919)
    //
    // Off until asked for (Yukimi: "we should not show the chat by default due to the data troughput"), and built
    // not to cost battery: the server sends nothing unless this panel is open and in front (chatSync closes it
    // with the program, full screen, the floating window and the screen), then one batch at most every 2 seconds;
    // a batch is one write into a list that only grows at its foot and holds 150 rows; nothing animates. Emote
    // pictures are fetched once and kept in the program's own cache (CACHE_NAME, which sw.js leaves alone).

    const CACHE_NAME = 'videos-cache-v1';
    const CHAT_ROWS = 150;
    const emotes = new Map(); // emote id -> Promise<object URL | ''>
    const chatOn = () => !!(hub.sources && hub.sources.chat && hub.sources.chat.enabled);
    const chatLinked = () => !!(hub.sources && hub.sources.chat && hub.sources.chat.linked);

    function emoteSrc(id) {
        if (emotes.has(id)) return emotes.get(id);
        const url = `/api/videos/kick/emote/${id}`;
        const job = (async () => {
            let res = null;
            let cache = null;
            try { cache = await caches.open(CACHE_NAME); res = await cache.match(url); } catch (_) { cache = null; }
            if (!res) {
                res = await fetch(url, { credentials: 'same-origin' });
                if (!res.ok) return '';
                if (cache) cache.put(url, res.clone()).catch(() => {});
            }
            return URL.createObjectURL(await res.blob());
        })().catch(() => '');
        emotes.set(id, job);
        return job;
    }

    /** A message's text as markup: emotes ([emote:<id>:<NAME>]) become pictures, with the name until they arrive. */
    function chatText(text) {
        let out = '';
        let at = 0;
        const re = /\[emote:(\d{1,12}):([^\]\s]{1,40})\]/g;
        let m;
        while ((m = re.exec(text))) {
            out += `${esc(text.slice(at, m.index))}<span class="yt-emote-w" data-e="${m[1]}">${esc(m[2])}</span>`;
            at = m.index + m[0].length;
        }
        return out + esc(text.slice(at));
    }
    const BADGE = { broadcaster: 'host', moderator: 'mod', subscriber: 'sub', vip: 'vip', og: 'og', founder: 'founder', verified: 'verified', sub_gifter: 'gifter' };
    function chatRow(m) {
        const tags = (m.badges || []).map((b) => BADGE[b]).filter(Boolean).map((b) => `<i class="yt-chat-tag">${b}</i>`).join('');
        // the name's own colour, lightened so a dark one still reads on the dark panel
        const tint = /^#[0-9a-fA-F]{6}$/.test(m.color || '') ? ` data-c="${m.color}"` : '';
        return `<div class="yt-chat-row">${tags}<b${tint}>${esc(m.name)}</b> ${chatText(String(m.text || ''))}</div>`;
    }

    function chatAppend(messages, skipped) {
        const list = els.chatList;
        const p = player;
        let html = skipped > 0 ? `<div class="yt-chat-row is-note">${skipped} more went by</div>` : '';
        html += messages.map(chatRow).join('');
        if (!html) return;
        list.insertAdjacentHTML('beforeend', html);
        let over = list.childElementCount - CHAT_ROWS;
        while (over-- > 0) list.firstElementChild.remove();
        list.querySelectorAll('b[data-c]').forEach((b) => { b.style.color = `color-mix(in srgb, ${b.dataset.c} 72%, white)`; b.removeAttribute('data-c'); });
        // the name stands in until the picture is there (from the program's cache after the first time)
        list.querySelectorAll('span.yt-emote-w').forEach((w) => {
            w.className = 'yt-emote-t';
            emoteSrc(w.dataset.e).then((u) => {
                if (!u || !w.isConnected) return;
                const img = new Image();
                img.className = 'yt-emote';
                img.alt = w.textContent;
                img.draggable = false;
                img.decoding = 'async';
                img.src = u;
                w.replaceWith(img);
            });
        });
        if (!p || p.chatStick !== false) list.scrollTop = list.scrollHeight;
    }

    function chatTake(batch) {
        const p = player;
        if (!els || !p || !p.chatOpen || !batch || batch.slug !== p.slug || !Array.isArray(batch.messages)) return;
        chatAppend(batch.messages, Number(batch.skipped) || 0);
    }

    /** Should the server be sending chat right now? Only while its panel can be seen. */
    const chatWanted = () => { const p = player; return !!(p && !p.vod && p.chatOn && shown && !p.full && (p.popped || (!p.suspended && !p.handed)) && p.state === 'live' && screenOn()); };

    function chatLayout() {
        const p = player;
        const on = !!(p && p.chatOn);
        if (!els) return;
        els.player.classList.toggle('has-chat', on);
        if (els.chat.hidden === on) els.chat.hidden = !on;
        const canSend = on && chatLinked() && isAdmin();
        if (els.chatForm.hidden === canSend) els.chatForm.hidden = !canSend;
        const k = els.hud.querySelector('[data-pl="chat"]');
        if (k) { k.classList.toggle('is-on', on); k.setAttribute('aria-pressed', String(on)); }
    }

    /** Opens or closes the server's sending to match what is on screen. */
    async function chatSync() {
        const p = player;
        if (!p || !els) return;
        chatLayout();
        const want = chatWanted();
        if (want === !!p.chatOpen || p.chatBusy) return;
        p.chatBusy = true;
        try {
            if (want) {
                const d = await ask('youtube_chat_open', { slug: p.slug }, 15000);
                if (player !== p) { ask('youtube_chat_close', { slug: p.slug }, 8000).catch(() => {}); return; }
                p.chatOpen = true;
                els.chatList.textContent = '';
                p.chatStick = true;
                chatAppend(d.messages || [], 0);
                if (!els.chatList.childElementCount) els.chatList.innerHTML = '<div class="yt-chat-row is-note">Chat shows here as people write. If a busy chat stays empty, Kick is not delivering: check that Webhooks is on, with this server\'s Webhook URL, in the Kick developer app.</div>';
            } else {
                p.chatOpen = false;
                await ask('youtube_chat_close', { slug: p.slug }, 8000).catch(() => {});
            }
        } catch (e) {
            if (player === p) { p.chatOn = false; chatLayout(); refreshKeys(); box(failText(e, 'Chat could not be opened'), 'info'); }
        } finally {
            p.chatBusy = false;
        }
        // what is wanted changed while the server was answering
        if (player === p && chatWanted() !== !!p.chatOpen) chatSync();
    }

    function chatToggle() {
        const p = player;
        if (!p) return;
        if (p.vod) return;
        if (!p.chatOn && !chatOn()) { box('Chat is switched off. Switch it on under Channels > Kick > Chat.', 'info'); return; }
        p.chatOn = !p.chatOn;
        if (p.chatOn && p.full) plFull(false);
        refreshKeys();
        chatSync();
    }

    /** The player is going: the server stops sending for it. */
    function chatDrop(p) {
        if (p.chatOpen) ask('youtube_chat_close', { slug: p.slug }, 8000).catch(() => {});
        p.chatOpen = false;
        p.chatOn = false;
        if (els) { els.player.classList.remove('has-chat'); els.chat.hidden = true; els.chatList.textContent = ''; els.chatQ.value = ''; const k = els.hud.querySelector('[data-pl="chat"]'); if (k) k.classList.remove('is-on'); }
    }

    let chatSending = false;
    async function chatSend() {
        const p = player;
        const text = els.chatQ.value.trim();
        if (!p || !text || chatSending) return;
        chatSending = true;
        try {
            await ask('youtube_chat_send', { slug: p.slug, text }, 15000);
            if (els.chatQ.value.trim() === text) els.chatQ.value = '';
        } catch (e) {
            box(failText(e, 'The message could not be sent'), 'info');
        } finally {
            chatSending = false;
        }
    }

    async function chatSetup(on) {
        if (!isAdmin()) { box('Only the administrator can change chat.', 'info'); return; }
        try {
            const d = await ws.busy(ask('youtube_chat_setup', { on }), { delay: 250 });
            hub.sources.chat = { enabled: !!d.chat.enabled, linked: !!d.chat.linked };
            changed();
            if (on && d.chat.webhookUrl) box(`Chat is on. Kick delivers it to this server, so the Kick developer app (the one whose key is under Service keys > Kick) needs:\n\nWebhooks: on\nWebhook URL: ${d.chat.webhookUrl}\nRedirect URL: ${d.chat.redirectUrl}\nScopes: events:subscribe, chat:write`, 'info');
        } catch (e) {
            box(failText(e, 'The setting could not be saved'));
        }
    }

    async function chatLink() {
        if (!isAdmin()) { box('Only the administrator can link an account.', 'info'); return; }
        try {
            if (chatLinked()) {
                const d = await ws.busy(ask('youtube_chat_unlink', {}), { delay: 250 });
                hub.sources.chat = { enabled: !!d.chat.enabled, linked: !!d.chat.linked };
                changed();
                return;
            }
            const d = await ws.busy(ask('youtube_chat_link', {}), { delay: 250 });
            openUrl(d.url, false);
        } catch (e) {
            box(failText(e, 'The sign-in could not be started'));
        }
    }

    function wirePlayer() {
        const v = els.video;
        wireSeek();
        window.addEventListener('message', ytHear, { signal: appScopeSignal });
        if (HOST.desktop) document.addEventListener('fullscreenchange', () => { if (player) { player.full = document.fullscreenElement === els.player; chatSync(); refreshKeys(); } }, { signal: appScopeSignal });
        els.chatForm.addEventListener('submit', (e) => { e.preventDefault(); chatSend(); });
        els.chatList.addEventListener('scroll', () => { const l = els.chatList; if (player) player.chatStick = l.scrollHeight - l.scrollTop - l.clientHeight < 40; }, { passive: true });
        els.player.addEventListener('click', (e) => {
            const k = e.target.closest('[data-pl]');
            if (e.target.closest('.yt-seek')) return;
            if (!k) { if (e.target.closest('.yt-stage')) { if (player && player.popped) plPopBack(); else plHud(els.hud.hidden); } return; }
            const p = player;
            if (!p) return;
            const act = k.dataset.pl;
            if (act === 'toggle') plToggle();
            else if (act === 'mute') { if (p.kind === 'yt') { p.muted = !p.muted; ytCmd(p.muted ? 'mute' : 'unMute'); } else els.video.muted = !els.video.muted; plHud(true); }
            else if (act === 'back' || act === 'fwd') { if (p.vod) { ytSeek((p.pos || 0) + (act === 'back' ? -10 : 10)); plHud(true); } }
            else if (act === 'stop') stopPlayer();
            else if (act === 'kick') { if (p.vod) { const id = p.vid; stopPlayer(); openVideo(id); } else { const u = p.kickUrl; stopPlayer(); openUrl(u, true, KICK_PACKAGE); } }
            else if (act === 'full') { plFull(!p.full); plHud(true); }
            else if (act === 'chat') { chatToggle(); plHud(true); }
            else if (act === 'pop') plPop();
        });
        try { if (window.screen && screen.orientation) screen.orientation.addEventListener('change', plTurned, { signal: appScopeSignal }); } catch (_) { /* no orientation API */ }
        window.addEventListener('resize', plTurned, { signal: appScopeSignal });
        v.addEventListener('playing', () => { if (player && player.state === 'live') { player.tries = 0; plStatus('', false); } plHud(!els.hud.hidden); plTell(); });
        v.addEventListener('pause', () => { plHud(true); plTell(); });
        v.addEventListener('timeupdate', ytrTime);
        v.addEventListener('ended', () => { const p = player; if (p && p.kind === 'ytr') { p.best = 100; stopPlayer(); } });
        v.addEventListener('waiting', () => { if (player && player.state === 'live') plStatus('Buffering...', true); });
        v.addEventListener('error', () => { if (player && !player.hls && player.state === 'live') plLost(); });
        // news from the app's native player: it took the stream (another Android app came up), its floating
        // window was tapped (back to this program), or it stopped (closed there, the stream ended or was lost)
        window.addEventListener('dreamscape:videos', (e) => {
            const p = player;
            const st = e && e.detail && e.detail.state;
            if (!p || !st) return;
            if (st === 'handed') { p.handed = true; plSuspend(true); }
            else if (st === 'open') { if (ws) ws.open(APP_ID); if (shown) plPopBack(); }
            else if (p.handed) { p.handed = false; p.popped = false; if (st === 'ended') { plStatus('The stream has ended.', false); p.state = 'ended'; plTell(); refreshKeys(); } else stopPlayer(); }
        }, { signal: appScopeSignal });
        // back in the app with this program still in front (the app had handed the stream over when it was left)
        document.addEventListener('visibilitychange', () => {
            if (document.hidden || !shown || !player || player.popped) return;
            const nv = nativePlayer();
            let active = false;
            try { active = !!nv && nv.isActive() === true; } catch (_) { active = false; }
            if (player.handed || active) { plTakeBack(); plSuspend(false); }
        }, { signal: appScopeSignal });
        // the screen going off stops a picture mode's fetching; Audio First plays on
        window.addEventListener('melatonscreen', () => { if (player && player.mode !== 'audio' && !player.handed) plSuspend(document.documentElement.dataset.screenOff !== undefined); }, { signal: appScopeSignal });
    }

    const refreshKeys = () => { if (ws) { ws.refreshSoftKeys(); ws.refreshTitleAction(); } };
    function syncPlayer() {
        if (ws) { ws.setTitle(player ? player.channel : TITLE); ws.syncHistory(); refreshKeys(); }
    }

    /**
     * The Quality list, kept short (Yukimi: the full list was too large): 1080p and 720p open their frame rates,
     * 480p and 360p are there directly, More holds the rest, Audio First closes it. Each row says its data rate.
     */
    function qualityMenu() {
        const p = player;
        if (!p) return [];
        const list = p.modes.length ? p.modes : [{ id: p.mode, label: p.mode, short: p.mode, group: '', kbit: 0 }];
        const rate = (m) => (m.kbit ? ` (${m.kbit >= 1000 ? `${(m.kbit / 1000).toFixed(1)} Mbit` : `${m.kbit} kbit`})` : '');
        const row = (m) => ({ label: `${m.short || m.label}${rate(m)}`, radio: m.id === p.mode, action: () => { if (player === p && m.id !== p.mode) plStart(m.id); } });
        const out = [];
        const done = new Set();
        list.forEach((m) => {
            if (!m.group) { out.push(m.id === 'audio' ? { tail: row(m) } : row(m)); return; }
            if (done.has(m.group)) return;
            done.add(m.group);
            const inside = list.filter((x) => x.group === m.group);
            out.push({ label: m.group, checked: inside.some((x) => x.id === p.mode) ? true : undefined, submenu: inside.map(row) });
        });
        // the sub-lists first (largest picture down), then the direct rows, More, and Audio First last
        const more = out.filter((x) => x.label === 'More');
        const tails = out.filter((x) => x.tail).map((x) => x.tail);
        const rest = out.filter((x) => !x.tail && x.label !== 'More');
        return rest.concat(more, tails.length ? ['-'] : [], tails);
    }

    function playerKeys() {
        const p = player;
        if (p.vod) {
            // through the server: its quality list; in YouTube's own player: Stop (the desktop) or YouTube's app
            const quality = () => (p.modes || []).map((m) => ({ label: m.label, radio: m.id === p.mode, action: () => { if (player === p && m.id !== p.mode) ytrStart(m.id, p.pos || 0); } }));
            return {
                left: p.kind === 'ytr' ? { label: 'Quality', disabled: p.state === 'starting', menu: quality } : { label: HOST.desktop ? 'Stop' : 'YouTube', action: () => { const id = p.vid; stopPlayer(); if (!HOST.desktop) openVideo(id); } },
                right: { label: 'Menu', menu: () => [
                    { label: 'Full Screen', checked: !!p.full, action: () => plFull(!p.full) },
                    { label: 'Skip Sponsors (SponsorBlock)', checked: skipOn(), disabled: !isAdmin(), action: () => saveSettings({ skipSegments: !skipOn() }) },
                    { label: 'Mark as Watched', disabled: !isAdmin(), action: () => { const id = p.vid; stopPlayer(); setWatched(id, true); } },
                    { label: 'Add to Watch Later', disabled: !isAdmin(), action: () => setLater(p.vid, true) },
                    '-',
                    { label: HOST.desktop ? 'Open on youtube.com' : 'Play in YouTube', action: () => { const id = p.vid; stopPlayer(); openVideo(id); } },
                    { label: 'Stop', action: stopPlayer }
                ] }
            };
        }
        const live = p.state === 'live';
        return {
            left: { label: 'Quality', disabled: p.state === 'starting', menu: qualityMenu },
            right: { label: 'Menu', menu: () => [
                { label: 'Chat', checked: !!p.chatOn, action: chatToggle },
                { label: 'Full Screen', checked: !!p.full, action: () => plFull(!p.full) },
                { label: 'Try Again', disabled: p.state === 'starting', action: () => plStart(p.mode) },
                '-',
                { label: 'Watch in Kick\'s App', action: () => { const u = p.kickUrl; stopPlayer(); openUrl(u, true, KICK_PACKAGE); } },
                { label: 'Stop', action: stopPlayer }
            ] }
        };
    }

    // ---------------------------------------------------------------- menus

    async function about() {
        // today's use is read for this box only (it is not part of the pushed status)
        let q = null;
        try { const d = await ask('youtube_get', {}, 8000); q = d && d.state && d.state.quota; } catch (_) { /* the box goes without it */ }
        ws.messageBox({
            title: TITLE,
            icon: 'info',
            text: `Melaton Videos\nVersion 2.0\n\nCopyright © 2026 Xyridian Corporation. All rights reserved.\n\nYouTube videos, channels and search: the YouTube Data API. Skipped parts: SponsorBlock data (sponsor.ajay.app), CC BY-NC-SA 4.0. Kick live streams: the Kick API. YouTube is a trademark of Google LLC and Kick of Kick Streaming Pty Ltd; videos and streams play in their own apps.${q ? `\n\nToday's use: ${q.used.toLocaleString()} of ${q.budget.toLocaleString()} units.` : ''}`
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
            { label: 'Skip Sponsors (SponsorBlock)', checked: s.skipSegments !== false, disabled: !admin || !signedIn(), action: () => saveSettings({ skipSegments: s.skipSegments === false }) },
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
        // 'kick:<channel>' (a go-live notification): that stream, when the channel is live
        if (/^kick:/.test(String(to || ''))) {
            const v = (hub.live && hub.live.items || []).find((x) => x.id === to) || (data.subs.videos || []).find((x) => x.id === to);
            if (v) { watchLive(v); return; }
            to = 'subs';
        }
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
            // new uploads the server found while the program was away: taken now, quietly, as a push would
            const t = data.subs;
            if (t.feedStale && signedIn() && t.videos && !t.loading) { t.feedStale = false; loadTab('subs', false, true); }
            if (pendingWatch) { const v = pendingWatch; pendingWatch = null; watchLive(v); }
            if (player) { syncPlayer(); plTakeBack(); plSuspend(false); plClock(true); chatSync(); }
        },
        hide() {
            shown = false;
            if (els) els.q.blur();
            // the program is left with a stream playing: the app's native player carries it on (a floating window, or sound)
            const nv = nativePlayer();
            if (player && !player.vod && player.state === 'live' && !player.suspended && nv) { try { player.handed = nv.handOff() === true; } catch (_) { player.handed = false; } }
            if (!(player && player.popped)) plSuspend(true);
            chatSync();
            plTell();
            void syncHub();
        },
        historyDepth: () => (player ? 1 : 0) + (layer ? 1 : 0),
        onBack: () => (player ? stopPlayer() : popLayer()),
        titleKind: () => (player || layer ? 'ok' : 'close'),
        onTitleOk: () => (player ? stopPlayer() : popLayer()),
        onTitleClose() { stopPlayer(); layer = null; },
        softKeys() {
            if (!signedIn()) {
                const a = acct();
                return {
                    left: a.signIn ? { label: 'Cancel', action: cancelSignIn } : { label: 'Sign In', disabled: !isAdmin() || !a.configured, action: signIn },
                    right: { label: 'Menu', menu: mainMenu }
                };
            }
            if (player) return playerKeys();
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
        ws = HOST.desktop ? window.videosDesktopShell : window.wmShell;
        if (!ws) return;
        ws.registerApp(APP);
        if (typeof ws.registerTodayItem === 'function') {
            ws.registerTodayItem({ id: 'youtube', label: 'Videos', icon: 'app-youtube', after: 'lapis', render: todayRender, titanium: todayTitanium });
        }
        // websocket.js (window.wsClient) loads before this file; should it not have, every script has run by 'load'
        if (!wire()) window.addEventListener('load', () => { wire(); }, { once: true, signal: appScopeSignal });
    }

    window.wmYouTube = {
        open,
        state: () => ({ hub, tab, data, layer }),
        /** Read the open tab again (the server answers from what it holds when that is young). */
        reload: () => loadTab(tab, true)
    };

    if (HOST.desktop || window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
