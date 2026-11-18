/**
 * Melaton Mobile 6.5: the "Melaton Default" home screen (Windows Mobile 6.5's "Windows Default"
 * Today item, code name Titanium) (Yozora #739).
 *
 * Measured on Windows Mobile 6.5 Professional (VGA emulator) and read from the ROM's own layout,
 * \Windows\Titanium_480x640.cpr (plain XML; lengths below are its VGA pixels, halved to WM units
 * in wm-titanium.css):
 *   - one column of items, 68 high when condensed (label Tahoma 18 pt at 20,8), under a fixed
 *     focus band 140 high centred in the list ((height - 140) / 2: 198 of 536, 118 of 376);
 *     the band art is 480 x 164 (RCDATA 3000), stretched to the screen width
 *   - the item in the band is expanded: panel icon 86 x 114 at 376,-26, lines at 20,34 / 20,68 /
 *     20,98 (three lines), 20,52 / 20,86 (two), 20,66 (one), bold 10 pt then regular 8 pt; with a
 *     picture (86 x 86 at 20,34, white 2 px frame) the lines start at 118; page arrows 8 x 18 at
 *     4,74 and right 4
 *   - at rest the items fade with distance from the band; while a finger drags the list every
 *     label is full white and slides 1:1 under the band's glass (dim inside it), the selected
 *     item's label waits centred in the band, and the selection moves on when the next item has
 *     travelled one full row; a drag starts after 36 px
 *   - when the finger lifts, the list runs to an item on its own clock (startTween): a flick goes
 *     5.9 items for each px/ms of the finger's speed at 30 + 175 ms an item, fast at first and
 *     still moving when it stops; a lift without speed returns to the item in the band in
 *     310 ms; a tap on another item or a key takes 45 ms an item. Then the panel grows in from
 *     80 % (zoomIn) and the right soft key changes last (Yozora #748)
 *   - left / right on a panel with pages: after 45 px the page follows the finger, the next one a
 *     screen width behind; past half the width it carries on, short of it the page slides back
 *   - soft keys: left the Today key, right the panel's own (Set, Compose, Messaging, Library ...);
 *     the clock panel's "Set" gives way to a right key chosen in Settings > Buttons (6.1's Today key);
 *     a page may bring its own right key and tap (pages[].softKey / onTap)
 *
 * Panels come from Today's items: the shell's rows (date + connection = the clock panel, as 6.5
 * shows the network under the time) and each registered item's titanium() (wmTodayWidgets.js,
 * wmAccounts.js, wmXLink.js); an item without one gets a generic panel from its row.
 *
 * Settings > Today > Items lists "Melaton Default" first (6.5 only); unchecked, Today shows its
 * rows as in 6.1. The other items' check boxes and order pick the panels.
 */
(function () {
    'use strict';
    const appScopeSignal = (window.melatonSegments && typeof window.melatonSegments.callerSignal === 'function' && window.melatonSegments.callerSignal()) || undefined; // page listeners end with this file's segment (app-scope, #872/#890)

    const root = document.documentElement;
    if (window.uiShell !== 'mobile' || root.dataset.wmVersion !== '6.5') return;

    const ART = '/static_images/wm65/';
    const ROW = 34;      // condensed item, WM units (68 VGA px)
    const BAND = 70;     // focus band (140)
    const DRAG_START = 18; // a drag starts after 36 VGA px of travel
    const SLIDE_START = 22.5; // a page starts to follow the finger after 45
    // The list's own moves, timed on the 6.5 emulator (device frames with device times, 100+ lifts;
    // the device draws about ten frames a second, the clocks below are what its positions fit):
    const EXTRA = BAND - ROW;   // what the item in the band has over a condensed one (72 px)
    const FLING_ROWS = 11.8;    // items a flick travels per WM unit/ms of finger speed (5.9 per VGA px/ms)
    const FLICK_MIN = 0.08;     // slower than this is no flick (0.15 px/ms: none, 0.19 px/ms: one item)
    const FLING_BASE_MS = 30;   // a flick over n items lasts 30 + 175 n ms (220, 375, 555, 730, 905,
    const FLING_ROW_MS = 175;   // 1080, 1255 ms for 1..7 items) ...
    const FLING_POW = 0.57;     // ... and is at (t / T) ^ 0.57 of the way: within 1 % for every lift
    const TAP_ROW_MS = 45;      // tap on another item, up / down key: there in about 50, 90, 130 ms for 1, 2, 3
    const BACK_MS = 310;        // lift without speed: back to the item in the band, whatever the distance
    const ZOOM_MS = 150;        // the panel grows from 80 % to full size, evenly (wm-titanium.css)
    const KEY_MS = 70;          // the right soft key changes 210 - 230 ms after the list stops
    const FADE_MS = 120;        // the arriving item's label fades out under the glass (by eye, not timed)
    // Coming back to Today (Yukimi, Nov 13, #800): the band is already there, empty; the list scales in
    // from the top left while it runs up into the clock (the lift-without-speed move, BACK_MS), then
    // the clock panel grows in as after any move. ENTER_ROWS: how far below its place the list starts.
    const ENTER_MS = 550;       // the entrance's run up into the clock (and its scale-in, wm-titanium.css)
    const ENTER_ZOOM_MS = 450;  // ... then the clock panel grows and fades in (wm-ti-zoom-enter), larger than a move's
    let enterLockUntil = 0;     // touches and keys are held off until the entrance and its panel grow are over (#800)
    const entryLocked = () => performance.now() < enterLockUntil;
    const ENTER_RECENT_MS = 1500; // a Home press this soon after the page came back belongs to that return
    // A Home press while Today is in front blinks the page hidden for a moment (Android pauses and
    // resumes the launcher: 16 ms on the Fold7); hidden longer, the user was in another app
    const AWAY_MS = 700;
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    // wm65 art by name ('ti-2051'); 's:owner' / 'x:app-studio-lg' / 'p:wren' = a 6.5 Start icon / a 6.1 set
    // icon / a Director persona's picture; 'w:rain' = a weather condition (ti-w-*)
    // icon in the panel icons' frame with their mirror image (ti-s-*, ti-x-*: made for the items 6.5
    // has no panel art for); or a path
    const artUrl = (name, scale) => {
        const n = String(name || '');
        if (n.startsWith('/')) return n;
        const file = n.startsWith('x:') ? `ti-x-${n.slice(2)}` : n.startsWith('s:') ? `ti-s-${n.slice(2)}` : n.startsWith('p:') ? `ti-p-${n.slice(2)}` : n.startsWith('w:') ? `ti-w-${n.slice(2)}` : n;
        return `${ART}${file}${scale > 1 ? `@${scale}x` : ''}.png`;
    };
    // 1x = the ROM art halved, 2x = the ROM art, 4x = it upscaled (GPU) for dense phone screens
    const artSet = (name) => (String(name || '').startsWith('/') ? `${name} 1x` : `${artUrl(name)} 1x, ${artUrl(name, 2)} 2x, ${artUrl(name, 4)} 4x`);
    const artImageSet = (name) => `image-set(url("${artUrl(name)}") 1x, url("${artUrl(name, 2)}") 2x, url("${artUrl(name, 4)}") 4x)`;

    let sh = null;
    let host = null;     // .wm-ti inside Today's page
    let page = null;
    let panels = [];     // [{ id, label, count, icon, pages, softKey, onTap, clock }]
    let sel = 0;         // selected panel
    let pos = 0;         // list position in rows while dragging / settling (sel at rest)
    let pageAt = new Map(); // panel id -> page index
    let dragging = false;
    let settle = 0;      // rAF id of the list's own move (tw)
    let tw = null;       // that move: { a: item it left, b: item it goes to, n, D, e0, p, ... }
    let skSel = 0;       // the panel whose right soft key is up (it changes after the panel has grown in)
    let menuAt = 0;      // when a tap-and-hold last brought a panel's menu up
    const rowEl = new Map(); // panel id -> its condensed row
    let panelsKey = '';
    let homeDone = false;

    const fmtTime = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
    const fmtShort = new Intl.DateTimeFormat(undefined, { year: '2-digit', month: 'numeric', day: 'numeric' });


    // ---- wide pictures (#903): the box is 43 units square; a wider picture widens it, up to 2.5 times
    const picAspects = new Map(); // picture URL -> width / height, once it loaded ('auto')
    function picAspect(url, want) {
        if (typeof want === 'number' && want > 1.05) return want;
        if (want !== 'auto') return null;
        if (picAspects.has(url)) return picAspects.get(url);
        picAspects.set(url, null);
        const im = new Image();
        im.onload = () => {
            const ar = im.naturalWidth && im.naturalHeight ? im.naturalWidth / im.naturalHeight : null;
            picAspects.set(url, ar && ar > 1.05 ? ar : null);
            if (!ar || ar <= 1.05) return;
            // the rows already drawn with it take its shape now
            document.querySelectorAll('.wm-ti-pic[data-auto-src]').forEach((el) => {
                if (el.dataset.autoSrc !== url || !el.parentElement) return;
                el.parentElement.setAttribute('style', picWideStyle(ar));
            });
        };
        im.src = url;
        return null;
    }
    function picWideStyle(ar) {
        const w = Math.round(43 * Math.min(2.5, Math.max(1, ar)) * 10) / 10;
        return `--ti-pic-w:calc(${w} * var(--u));--ti-line-left:calc(${Math.round((w + 16) * 10) / 10} * var(--u))`;
    }

    function timeParts(d) {
        let time = '';
        let ampm = '';
        try {
            for (const p of fmtTime.formatToParts(d)) {
                if (p.type === 'dayPeriod') ampm = p.value;
                else if (p.type !== 'literal' || p.value.trim()) time += p.value;
            }
        } catch (_) { time = fmtTime.format(d); }
        return { time: time.trim(), ampm };
    }

    // ---------------------------------------------------------------- settings

    function storedItems() {
        // the shell's copy, parsed once per change (#890: enabled() and buildPanels read it on every draw)
        if (typeof sh.todayItems === 'function') return sh.todayItems();
        try { const v = JSON.parse(localStorage.getItem(sh.todayItemsKey) || 'null'); return Array.isArray(v) ? v : null; } catch (_) { return null; }
    }

    /** "Melaton Default" checked in Settings > Today > Items (on until switched off). */
    function enabled() {
        const list = storedItems();
        const it = list && list.find((x) => x && x.id === 'titanium');
        return !(it && it.on === false);
    }

    // ---------------------------------------------------------------- panels

    const lower = (s) => String(s || '').toLowerCase();

    /** The shell's own rows as panels. */
    /** The clock's pages: the clock (with the weather now), then the next hours, then the coming days. */
    function clockPages(clockPage) {
        let cur = null; let hours = []; let days = [];
        const W = window.wmWeather;
        try {
            cur = W && typeof W.current === 'function' ? W.current() : null;
            if (cur) {
                hours = typeof W.hourly === 'function' ? W.hourly(6) : [];
                days = typeof W.forecast === 'function' ? W.forecast().slice(0, 5) : [];
            }
        } catch (_) { cur = null; }
        if (!cur) return [clockPage];
        const openWx = () => { if (W && typeof W.open === 'function') W.open(); };
        const wxKey = { label: 'Weather', action: openWx };
        const out = [Object.assign({}, clockPage, { wx: { temp: cur.temp, condition: cur.condition, iconUrl: cur.iconUrl, iconUrl2x: cur.iconUrl2x } })];
        if (hours.length) out.push({ cells: hours.map((h) => ({ label: h.label, iconUrl: h.iconUrl, iconUrl2x: h.iconUrl2x, value: h.temp })), softKey: wxKey, onTap: openWx });
        if (days.length) out.push({ cells: days.map((d) => ({ label: String(d.day || '').slice(0, 3), iconUrl: d.iconUrl, iconUrl2x: d.iconUrl2x, value: d.hi != null ? `${d.hi}\u00b0` : '', sub: d.lo != null ? `${d.lo}\u00b0` : '' })), softKey: wxKey, onTap: openWx });
        return out;
    }

    /** The temperature now (Melaton Weather's selected place), for the time item: '52°' or ''. */
    function clockTemp() {
        try {
            const c = window.wmWeather && typeof window.wmWeather.current === 'function' ? window.wmWeather.current() : null;
            return c && c.temp != null ? `${c.temp}\u00b0` : '';
        } catch (_) { return ''; }
    }

    function builtin(id, st, rowEl) {
        if (id === 'date') {
            const now = new Date();
            const t = timeParts(now);
            return {
                // the time item carries the temperature as its superscript, as the weather item does (Nov 15)
                clock: true, label: t.time, count: [t.ampm, clockTemp()].filter(Boolean).join(' '), icon: 'ti-2051',
                // with Melaton Weather's data the clock carries the weather (Yukimi, Nov 15): the
                // condition icon for the clock's, the temperature and condition above the date, the next
                // hours and the coming days as its pages to the right and left; Today's weather item goes
                pages: clockPages({ time: t.time, ampm: t.ampm, date: fmtShort.format(now), network: st.connection ? st.connection.text : '' }),
                softKey: { label: 'Set', action: () => openSettings('clock') },
                onTap: () => {
                    if (st.connection && st.connection.tap === 'reconnect' && window.wsClient && typeof window.wsClient.manualReconnect === 'function') window.wsClient.manualReconnect();
                    // Effects > Super Bar: the clock opens it (Yukimi, Nov 15)
                    else if (fx.superbar) openSuper();
                    else openSettings('clock');
                }
            };
        }
        if (id === 'connection') return null; // 6.5 shows the network on the clock panel
        if (id === 'owner') {
            return { label: 'owner', icon: 's:owner', pages: [{ title: st.owner || 'Owner' }], softKey: { label: 'Edit', action: () => openSettings('owner') }, onTap: () => openSettings('owner') };
        }
        if (id === 'messages') {
            // the newest unread mail of Dreamscape Mail and the IMAP accounts (#789), newest first, a page
            // each: subject over sender and time, the account under them
            const n = st.mailUnread;
            const list = recentMail();
            // the panel opens Dreamscape Mail's Inbox (#763); its Messaging key, "Select an Account" (Yukimi, Nov 13)
            const go = () => { const a = window.wmMessaging; if (a && typeof a.goTo === 'function') a.goTo('mail'); else sh.open('messaging'); };
            const accounts = () => { const a = window.wmMessaging; if (a && typeof a.showAccounts === 'function') a.showAccounts(); else go(); };
            return {
                label: 'e-mail', count: n ? String(n) : '', icon: 'ti-2008',
                pages: list.length
                    ? list.map((m) => ({ title: m.subject || '(no subject)', line2: [m.from, mailWhen(m.at)].filter(Boolean).join(', '), line3: m.account, onTap: () => m.open(go) }))
                    : [{ title: 'No New E-mails' }],
                softKey: { label: 'Messaging', action: accounts },
                onTap: go
            };
        }
        if (id === 'tasks') {
            // the Tasks program's count, its second line under it; the panel and its key open Tasks
            const lines = String(st.tasks || 'No tasks').split('\n');
            const go = () => { if (window.wmTasks && typeof window.wmTasks.open === 'function') window.wmTasks.open(); else sh.open('gallery'); };
            return { label: 'tasks', icon: 's:tasks', pages: [{ title: lines[0], line2: lines.slice(1).join(', ') }], softKey: { label: 'Tasks', action: go }, onTap: go };
        }
        if (id === 'search') {
            // a page each for Search Internet / Grimoire / Files / Pictures, its program's icon at the
            // top right (#829); the tap opens Search there with the field focused, in the tap itself
            // (Android raises the keyboard only for a tap's focus)
            const scopes = window.wmSearch && typeof window.wmSearch.scopes === 'function' ? window.wmSearch.scopes() : [];
            if (scopes.length) {
                // Search Phone first, as before #829 (Yukimi, Nov 14): Search on everything on the phone
                const phone = { title: 'Search Phone', icon: 's:search', softKey: { label: 'Search', action: () => searchPictures() }, onTap: () => searchPictures() };
                return {
                    label: 'search', icon: 's:search',
                    pages: [phone].concat(scopes.map((sc) => {
                        // Search Internet goes where Today's Search options say (#830, wmShell todayWebSearch)
                        const go = () => (sc.type === 'web' && typeof window.wmTodayWebSearch === 'function' && window.wmTodayWebSearch()) || window.wmSearch.open(null, sc.type, { focus: true });
                        return { title: sc.title, icon: sc.panelIcon, softKey: { label: 'Search', action: go }, onTap: go };
                    }))
                };
            }
            return { label: 'search', icon: 's:search', pages: [{ title: window.wmSearch ? 'Search Phone' : 'Search pictures' }], softKey: { label: 'Search', action: () => searchPictures() }, onTap: () => searchPictures() };
        }
        if (id === 'workspace') {
            // the current workspace (Change opens Teleport), the favourites picked in the item's
            // options (Change travels there), then Manage Workspaces (Create)
            const all = st.workspaces || [];
            const count = (w) => (w.count == null ? '' : (w.count === 1 ? '1 picture' : `${w.count.toLocaleString()} pictures`));
            const teleport = () => sh.open('teleport');
            const cur = all.find((w) => w.active);
            const pages = [{ title: cur ? cur.name : (st.workspace || 'Workspace'), line2: cur ? count(cur) : '', softKey: { label: 'Change', action: teleport }, onTap: teleport }];
            all.filter((w) => w.favorite && !w.active).forEach((w) => {
                const travel = () => st.switchWorkspace(w.id);
                pages.push({ title: w.name, line2: count(w), softKey: { label: 'Change', action: travel }, onTap: travel });
            });
            pages.push({ title: 'Manage Workspaces', line2: all.length === 1 ? '1 workspace' : `${all.length} workspaces`, softKey: { label: 'Create', action: createWorkspaceAsk }, onTap: teleport });
            return { label: 'workspace', icon: 's:fileexp', pages };
        }
        if (id === 'prints') {
            const prints = (st.prints || []).filter((p) => p.filename);
            if (!prints.length) return { label: 'pictures', icon: 'ti-2451', pages: [{ title: 'No Photos' }], softKey: { label: 'Pictures', action: () => sh.open('gallery') }, onTap: () => sh.open('gallery') };
            return {
                label: 'pictures', icon: 'ti-2451',
                pages: prints.map((p) => ({ image: p.preview, title: printName(p.filename), line2: printWhen(p), file: p.filename })),
                softKey: { label: 'Pictures', action: () => sh.open('gallery') },
                onTap: (pg) => { sh.open('gallery'); try { if (pg && pg.file && typeof showLightbox === 'function') showLightbox({ filename: pg.file }); } catch (_) { /* the gallery opens without the viewer */ } }
            };
        }
        // a shell row this file does not know: its text
        const text = rowEl ? rowEl.textContent.trim() : '';
        return text ? { label: lower(id), icon: 'x:app-programs-lg', pages: [{ title: text }] } : null;
    }

    // ---- recent unread mail: Dreamscape Mail (dovecote_list_mail) and the IMAP accounts (#789,
    // window.mailAccounts.messages unseenOnly); listing marks nothing read. Read again a minute on,
    // or at once when mail comes, is read or goes (the accounts' events, Dovecote's push) ----
    const MAIL_PAGES = 5;
    const mail = { list: [], at: 0, busy: false, key: '', wired: null };
    function wireMail() {
        const M = window.mailAccounts;
        if (M && M !== mail.wired && typeof M.on === 'function') {
            mail.wired = M;
            const again = () => { mail.at = 0; if (mail.busy) mail.again = true; else recentMail(); };
            ['new', 'flags', 'removed', 'account'].forEach((e) => M.on(e, again));
        }
        if (!wireMail.dove) {
            wireMail.dove = true;
            document.addEventListener('dovecoteMailboxUpdated', (ev) => pushedMail(ev && ev.detail));
            const ws = window.wsClient;
            if (ws && typeof ws.on === 'function') ws.on('connected', () => { mail.at = 0; });
        }
    }
    /**
     * dovecote_mailbox_updated carries the person's unread inbox: the Dreamscape Mail pages come from
     * it, with no read of the list, and a change to another mailbox (an agent's) is ignored. The IMAP
     * accounts' pages follow their own events, not this push.
     */
    function pushedMail(d) {
        const owner = typeof DESKTOP_DOVECOTE_HUMAN_OWNER !== 'undefined' ? DESKTOP_DOVECOTE_HUMAN_OWNER : 'yukimi';
        const owners = d && Array.isArray(d.owners) ? d.owners : null;
        if (owners && !owners.includes(owner)) return;
        const unread = d && d.unreadInbox && d.unreadInbox[owner];
        if (!Array.isArray(unread)) { mail.at = 0; if (mail.busy) mail.again = true; else recentMail(); return; }
        const W = window.wmMessaging;
        const dove = unread.filter((m) => !m.read).slice(0, MAIL_PAGES)
            .map((m) => ({ subject: m.subject, from: mailFrom(m), at: mailWhenMs(m.createdAt), account: 'Dreamscape Mail', open: (go) => { if (W && typeof W.openMail === 'function') W.openMail(m.id); else go(); } }));
        mail.list = dove.concat(mail.list.filter((m) => m.account !== 'Dreamscape Mail')).sort((x, y) => (y.at || 0) - (x.at || 0)).slice(0, MAIL_PAGES);
        const key = mail.list.map((m) => `${m.account}|${m.subject}|${m.at}`).join('\n');
        if (key !== mail.key) { mail.key = key; if (sh && typeof sh.refreshToday === 'function') sh.refreshToday(); }
    }

    function recentMail() {
        wireMail();
        const c = window.wsClient;
        // read once, then only when a change arrives (IMAP events, the mailbox push) or after a
        // reconnect: no re-read every minute from Today's redraw (rule server-push-not-polling)
        if (!mail.busy && mail.at === 0 && c && typeof c.isConnected === 'function' && c.isConnected() && c.initializationCompleted) {
            mail.busy = true;
            const M = window.mailAccounts;
            const W = window.wmMessaging;
            const dove = Promise.resolve(c.sendMessage('dovecote_list_mail', { folder: 'inbox', limit: 30 }, false)).then((r) => ((r && (r.mail || (r.data && r.data.mail))) || [])
                .filter((m) => !m.read).slice(0, MAIL_PAGES)
                .map((m) => ({ subject: m.subject, from: mailFrom(m), at: mailWhenMs(m.createdAt), account: 'Dreamscape Mail', open: (go) => { if (W && typeof W.openMail === 'function') W.openMail(m.id); else go(); } })), () => null);
            const imap = M && typeof M.accounts === 'function'
                ? Promise.resolve(M.accounts()).then((d) => Promise.all(((d && d.accounts) || []).filter((a) => a && a.enabled !== false).map((a) => Promise.resolve(M.messages(a.id, 'INBOX', { limit: MAIL_PAGES, unseenOnly: true }))
                    .then((r) => ((r && r.messages) || []).filter((m) => !m.seen).map((m) => ({
                        subject: m.subject, from: mailFrom({ from: (m.from && m.from[0]) || m.sender }), at: Number(m.date) || 0, account: a.displayName || a.name || a.email,
                        open: (go) => { if (W && typeof W.openImapMessage === 'function') W.openImapMessage(a.id, m.folder || 'INBOX', m.uid, m); else go(); }
                    })), () => [])))).then((lists) => [].concat(...lists), () => [])
                : Promise.resolve([]);
            Promise.all([dove, imap]).then(([d, i]) => {
                // a failed Dreamscape Mail read keeps its pages from before
                const keep = d == null ? mail.list.filter((m) => m.account === 'Dreamscape Mail') : d;
                mail.list = keep.concat(i).sort((x, y) => (y.at || 0) - (x.at || 0)).slice(0, MAIL_PAGES);
                const key = mail.list.map((m) => `${m.account}|${m.subject}|${m.at}`).join('\n');
                if (key !== mail.key) { mail.key = key; if (typeof sh.refreshToday === 'function') sh.refreshToday(); }
            }).finally(() => {
                mail.at = Date.now();
                mail.busy = false;
                // a change while this read was out: once more
                if (mail.again) { mail.again = false; mail.at = 0; recentMail(); }
            });
        }
        return mail.list;
    }

    const mailWhenMs = (v) => { const t = v ? new Date(typeof v === 'number' && v < 1e11 ? v * 1000 : v) : null; return t && !Number.isNaN(t.getTime()) ? t.getTime() : 0; };

    function mailFrom(m) {
        const f = (m.fromLabel && !m.labelSuspicious) ? m.fromLabel : m.from;
        if (f && typeof f === 'object') return String(f.name || f.display || f.address || f.id || '');
        return String(f || '').replace(/\s*<[^>]*>\s*$/, '').replace(/^"(.*)"$/, '$1');
    }

    function mailWhen(v) {
        const t = v ? new Date(typeof v === 'number' && v < 1e11 ? v * 1000 : v) : null;
        if (!t || Number.isNaN(t.getTime())) return '';
        return t.toDateString() === new Date().toDateString() ? fmtTime.format(t) : `${fmtTime.format(t)} ${fmtShort.format(t)}`;
    }

    /** Manage Workspaces > Create: the name in a message box, then the desktop's own createWorkspace. */
    async function createWorkspaceAsk() {
        const name = await sh.messageBox({ title: 'Workspaces', text: 'Name of the new workspace:', input: { value: '' }, buttons: [{ text: 'Create', value: true }, { text: 'Cancel', value: false }], cancelValue: false });
        const text = typeof name === 'string' ? name.trim() : (name && typeof name.value === 'string' ? name.value.trim() : '');
        if (!text) return;
        try { if (typeof createWorkspace === 'function') await sh.busy(() => createWorkspace(text), { paint: true }); } catch (err) { console.warn('[wmTitanium] create workspace', err); }
    }

    function printName(file) {
        return String(file || '').replace(/\.[a-z0-9]+$/i, '');
    }

    function printWhen(p) {
        const t = p.time ? new Date(typeof p.time === 'number' && p.time < 1e11 ? p.time * 1000 : p.time) : null;
        if (!t || Number.isNaN(t.getTime())) return '';
        return `${fmtTime.format(t)} ${fmtShort.format(t)}`;
    }

    function openSettings(id) {
        if (window.wmSettings && typeof window.wmSettings.open === 'function') window.wmSettings.open(id);
    }

    function searchPictures() {
        // the Search program (programs, settings, notes, messages, pictures); Pictures' own search without it
        if (window.wmSearch && typeof window.wmSearch.open === 'function') window.wmSearch.open();
        else sh.open('gallery');
    }

    /** An item's 6.1 icon name as its panel icon (the large one of the set: ti-x-app-<x>-lg). */
    function panelIcon(name) {
        const n = String(name || '');
        if (!n || n.startsWith('/')) return n || 'x:app-programs-lg';
        if (/^(ti-|s:|x:|p:|w:)/.test(n)) return n;
        return `x:${n.replace(/^today-/, 'app-').replace(/-lg$/, '')}-lg`;
    }

    /** A registered item (registerTodayItem) as a panel: its titanium(), or a generic one from its row. */
    function widgetPanel(w, rowEl) {
        const option = (key) => sh.todayOption(w.id, key);
        if (typeof w.titanium === 'function') {
            let p = null;
            try { p = w.titanium({ option }); } catch (err) { console.warn('[wmTitanium] panel', w.id, err); }
            if (!p) return null;
            return Object.assign({ label: lower(w.label || w.id), icon: panelIcon(w.icon) }, p);
        }
        if (rowEl && rowEl.hidden) return null;
        const icon = panelIcon(w.icon);
        if (typeof w.text === 'function') {
            let text = '';
            try { text = String(w.text() || ''); } catch (_) { text = ''; }
            if (!text) return null;
            return { label: lower(w.label || w.id), icon, pages: [{ title: w.label || w.id, line2: text }], onTap: w.onTap };
        }
        // a block: the lines it drew in its (hidden) Today row
        const lines = [];
        if (rowEl) {
            const walk = (el) => {
                for (const n of el.childNodes) {
                    if (n.nodeType === 3) { const t = n.nodeValue.replace(/\s+/g, ' ').trim(); if (t) lines.push(t); }
                    else if (n.nodeType === 1 && !n.hidden) walk(n);
                }
            };
            walk(rowEl);
        }
        if (!lines.length) return null;
        return { label: lower(w.label || w.id), icon, pages: [{ title: lines[0], line2: lines[1] || '', line3: lines[2] || '' }], onTap: () => { const b = rowEl && rowEl.querySelector('button, [role="button"]'); if (b) b.click(); else if (rowEl) rowEl.click(); } };
    }

    // with no order chosen in Settings the panels follow 6.5's own (wmShell.todayOrder65): the
    // clock is home, in the middle of the list, the places above it and what arrives below

    let lastSt = {}; // Today's state the panels were last built from (the minute's clock panel reuses it)
    function buildPanels() {
        const st = sh.todayState() || {};
        lastSt = st;
        const defs = new Map(sh.todayItemDefs().map((w) => [w.id, w]));
        const rows = [...page.querySelectorAll(':scope > [data-row]')];
        let ids = rows.filter((r) => !r.classList.contains('wm-today-off')).map((r) => r.dataset.row);
        if (!storedItems()) ids = sh.todayOrder65(ids);
        const out = [];
        for (const id of ids) {
            const rowEl = rows.find((r) => r.dataset.row === id);
            const w = defs.get(id);
            let p = null;
            if (w) p = widgetPanel(w, rowEl);
            else if (!(rowEl && rowEl.hidden && id !== 'prints' && id !== 'tasks' && id !== 'messages')) p = builtin(id, st, rowEl);
            else p = null;
            if (!p || !Array.isArray(p.pages) || !p.pages.length) continue;
            p.id = id;
            out.push(p);
        }
        // the clock carries the weather: Today's own weather item goes (Yukimi, Nov 15)
        if (out.some((p) => p.clock && p.pages[0] && p.pages[0].wx)) {
            const i = out.findIndex((p) => p.id === 'weather');
            if (i >= 0) out.splice(i, 1);
        }
        // the date row switched off: the connection still needs a place
        if (!out.some((p) => p.clock) && ids.includes('connection') && st.connection) {
            out.unshift({ id: 'connection', label: 'connection', icon: 'ti-2603', pages: [{ title: st.connection.text }] });
        }
        return out;
    }

    // ---------------------------------------------------------------- the Super Bar (#800)

    /*
     * A tap on the clock (Effects > Super Bar, Yukimi Nov 15): the band's glass grows to the whole
     * screen while the clock rises to its top and the list steps away. Under the clock: Today's items
     * with something to catch up on (weather, the next event, texts, e-mail, tasks...), each opening
     * as its panel does, then the phone's own notifications (DSApp AndroidPhoneNotifications, through
     * ActiveSync's notification listener), each opening its app or cleared with its X. The clock, the
     * Close key, Back or Escape put it away the way it came. The glass is the band's frosted picture.
     */
    let superOpen = false;
    let superEl = null;
    let superAnim = null;
    let superBusy = false;
    // an even ease in and out: a fast-start curve put 60 % of the rise in its first 40 ms, which a
    // phone that drops a frame showed as a jump (A53 recording, Nov 15)
    const SUPER_MS = 420;
    const SUPER_EASE = 'cubic-bezier(0.45, 0, 0.2, 1)';
    let superGrow = 0; // units the card grows by: the weather (drawSuper)
    const CLOCK_TO = { y: 26, scale: 0.85 }; // the analog clock's move beside the digital one (units, size): larger (Yukimi, Nov 15), its face on the time's line, clear of the weather

    /*
     * The card is the band itself: the band art as a nine-slice (its glass lines stay put as it grows),
     * the band's frost under it lined up with the picture, and the clock panel's own markup. Its first
     * frame is the band and panel exactly, so they are hidden only while it lies over them, and shown
     * again only once it is back (Yukimi, Nov 15: no glitch, no jump). It rises to the top as it grows
     * by the weather row; below it the phone's notifications, on a darkening that fades in (no blur).
     */
    function openSuper() {
        if (!host || host.hidden || superOpen || superBusy || slide.active || dragging) return;
        const clock = panels.find((x) => x.clock);
        if (!clock) return;
        if (!superEl) buildSuper();
        superOpen = true;
        superBusy = true;
        const u = unit();
        const bandTop = focusTop() * u;
        drawSuper(clock);
        const card = superEl.querySelector('.wm-ti-super-card');
        const frost = superEl.querySelector('.wm-ti-super-frost');
        const shade = superEl.querySelector('.wm-ti-super-shade');
        const body = superEl.querySelector('.wm-ti-super-body');
        const T = frostTransform();
        const y0 = bandTop;
        // the glass's top line meets the title bar (the art's shadow above it goes off the top); the
        // analog clock moves down beside the digital one, so nothing is cut (Yukimi, Nov 15)
        const y1 = -9 * u;
        const h0 = 82 * u;
        const h1 = (82 + superGrow) * u;
        const aclock = superEl.querySelector('.wm-ti-super-panel .wm-ti-aclock');
        const fxl = superEl.querySelector('.wm-ti-super-fx');
        if (superAnim) superAnim.forEach((a) => a.cancel());
        superEl.hidden = false;
        if (aclock) aclock.dataset.swing = '1'; // set before the tick can touch it; swingHands below
        ensureClockTick(); // its live clock turns while the bar is open
        // the first frame: the card exactly where the band is, before the band goes
        card.style.transform = `translateY(${y0}px)`;
        card.style.height = `${h0}px`;
        frost.style.transform = `translateY(${-y0}px) ${T}`;
        host.classList.add('is-super');
        enterLockUntil = performance.now() + SUPER_MS + 40;
        const opt = { duration: SUPER_MS, easing: SUPER_EASE, fill: 'forwards' };
        superAnim = [
            card.animate([{ transform: `translateY(${y0}px)`, height: `${h0}px` }, { transform: `translateY(${y1}px)`, height: `${h1}px` }], opt),
            frost.animate([{ transform: `translateY(${-y0}px) ${T}` }, { transform: `translateY(${-y1}px) ${T}` }], opt),
            superEl.querySelector('.wm-ti-super-extra').animate([{ opacity: 0 }, { opacity: 1 }], { duration: SUPER_MS * 0.6, delay: SUPER_MS * 0.4, easing: 'linear', fill: 'both' }),
            // the darkening comes once the card has grown (Yukimi, Nov 15), and is light
            shade.animate([{ opacity: 0 }, { opacity: 1 }], { duration: SUPER_MS * 0.5, delay: SUPER_MS * 0.6, easing: 'linear', fill: 'both' }),
            // the notifications come once the card is on its way, not under the band before it moves
            body.animate([{ opacity: 0, transform: `translateY(${18 * u}px)` }, { opacity: 1, transform: 'none' }], { duration: SUPER_MS * 0.6, delay: SUPER_MS * 0.4, easing: 'cubic-bezier(0.2, 0, 0.2, 1)', fill: 'both' }),
            host.querySelector('.wm-ti-list').animate([{ opacity: 1 }, { opacity: 0 }], { duration: SUPER_MS * 0.5, easing: 'linear', fill: 'forwards' }),
            fxl.animate([{ opacity: 0 }, { opacity: 1 }], { duration: SUPER_MS, delay: SUPER_MS * 0.6, easing: 'linear', fill: 'both' })
        ];
        if (aclock) superAnim.push(aclock.animate([{ transform: 'none' }, { transform: `translateY(${CLOCK_TO.y * u}px) scale(${CLOCK_TO.scale})` }], opt));
        // the clock carrying the weather: its condition icon (the band's) gives way to the live clock as
        // the card rises, and comes back as it lands
        const wxi = superEl.querySelector('.wm-ti-super-panel .wm-ti-wxicon');
        if (aclock && wxi) {
            superAnim.push(wxi.animate([{ opacity: 1 }, { opacity: 0 }], { duration: SUPER_MS * 0.6, easing: 'linear', fill: 'forwards' }));
            superAnim.push(aclock.animate([{ opacity: 0 }, { opacity: 1 }], { duration: SUPER_MS * 0.6, delay: SUPER_MS * 0.3, easing: 'linear', fill: 'both' }));
        }
        // the hands leave the icon's resting places for the time
        if (aclock) superAnim.push(...swingHands(aclock, true, { duration: SUPER_MS, easing: SUPER_EASE }));
        superAnim[0].finished.then(() => { superBusy = false; }).catch(() => { superBusy = false; });
        haptic('land');
        sh.refreshSoftKeys();
        refreshNotes();
    }

    function closeSuper(now) {
        if (!superOpen || !superEl) return;
        superOpen = false;
        if (superAnim) superAnim.forEach((a) => a.cancel());
        const finish = () => {
            if (superOpen) return;
            // the card lies on the band again: the band and panel come back under it, then it goes
            host.classList.remove('is-super');
            superEl.hidden = true;
            if (superAnim) superAnim.forEach((a) => a.cancel());
            superAnim = null;
            superBusy = false;
            sh.refreshSoftKeys();
        };
        if (now) { finish(); return; }
        superBusy = true;
        const u = unit();
        const card = superEl.querySelector('.wm-ti-super-card');
        const frost = superEl.querySelector('.wm-ti-super-frost');
        const shade = superEl.querySelector('.wm-ti-super-shade');
        const body = superEl.querySelector('.wm-ti-super-body');
        const T = frostTransform();
        const y0 = focusTop() * u;
        const y1 = -9 * u;
        const h0 = 82 * u;
        const h1 = (82 + superGrow) * u;
        const aclock = superEl.querySelector('.wm-ti-super-panel .wm-ti-aclock');
        const fxl = superEl.querySelector('.wm-ti-super-fx');
        const ms = Math.round(SUPER_MS * 0.85);
        enterLockUntil = performance.now() + ms + 40;
        const opt = { duration: ms, easing: SUPER_EASE, fill: 'forwards' };
        superAnim = [
            card.animate([{ transform: `translateY(${y1}px)`, height: `${h1}px` }, { transform: `translateY(${y0}px)`, height: `${h0}px` }], opt),
            frost.animate([{ transform: `translateY(${-y1}px) ${T}` }, { transform: `translateY(${-y0}px) ${T}` }], opt),
            superEl.querySelector('.wm-ti-super-extra').animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms * 0.4, easing: 'linear', fill: 'forwards' }),
            shade.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms * 0.45, easing: 'linear', fill: 'forwards' }),
            body.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms * 0.5, easing: 'linear', fill: 'forwards' }),
            host.querySelector('.wm-ti-list').animate([{ opacity: 0 }, { opacity: 1 }], { duration: ms * 0.7, delay: ms * 0.3, easing: 'linear', fill: 'both' }),
            fxl.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms * 0.4, easing: 'linear', fill: 'forwards' })
        ];
        if (aclock) superAnim.push(aclock.animate([{ transform: `translateY(${CLOCK_TO.y * u}px) scale(${CLOCK_TO.scale})` }, { transform: 'none' }], opt));
        const wxi = superEl.querySelector('.wm-ti-super-panel .wm-ti-wxicon');
        if (aclock && wxi) {
            superAnim.push(aclock.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms * 0.5, easing: 'linear', fill: 'forwards' }));
            superAnim.push(wxi.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ms * 0.6, delay: ms * 0.4, easing: 'linear', fill: 'both' }));
        }
        // and go back to the icon's resting places, so the static icon under it matches when it goes
        if (aclock) superAnim.push(...swingHands(aclock, false, opt));
        superAnim[0].finished.then(finish).catch(() => { /* a new open took over */ });
        sh.refreshSoftKeys();
    }

    /** The band's frost as it stands (parallax, tilt, zoom): the card's copy matches it exactly. */
    function frostTransform() {
        if (!blurInner) return '';
        const t = getComputedStyle(blurInner).transform;
        return t && t !== 'none' ? t : '';
    }

    function buildSuper() {
        superEl = document.createElement('div');
        superEl.className = 'wm-ti-super';
        superEl.setAttribute('role', 'dialog');
        superEl.setAttribute('aria-label', 'Super Bar');
        superEl.hidden = true;
        superEl.innerHTML = '<div class="wm-ti-super-shade"></div><div class="wm-ti-super-fx" aria-hidden="true"></div>'
            + '<div class="wm-ti-super-body"><div class="wm-ti-super-sub" hidden>notifications</div><div class="wm-ti-super-notes"></div></div>'
            + '<div class="wm-ti-super-card"><div class="wm-ti-super-frostclip"><div class="wm-ti-super-frost"></div></div><div class="wm-ti-super-art"></div><div class="wm-ti-super-panel"></div><div class="wm-ti-super-extra"></div></div>';
        superEl.querySelector('.wm-ti-super-art').style.borderImageSource = artImageSet('ti-3000');
        // the list's own touch handling stays out of the sheet; its rows scroll and take taps
        ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'click', 'contextmenu'].forEach((t) => superEl.addEventListener(t, (e) => e.stopPropagation()));
        // the card puts the bar away; its weather opens Weather (the delegate below)
        superEl.querySelector('.wm-ti-super-card').addEventListener('click', (e) => { if (!superBusy && !e.target.closest('[data-super]')) closeSuper(); });
        superEl.addEventListener('click', (e) => {
            const row = e.target.closest('[data-super]');
            if (!row || superBusy) return;
            const kind = row.dataset.super;
            if (kind === 'weather') {
                closeSuper(true);
                if (window.wmWeather && typeof window.wmWeather.open === 'function') window.wmWeather.open();
                return;
            }
            const N = window.AndroidPhoneNotifications;
            if (!N) return;
            if (kind === 'access') { try { N.requestAccess(); } catch (_) { /* old app */ } return; }
            noteAction(N, kind, row);
        });
        superEl.addEventListener('keydown', (e) => {
            // Enter sends a reply (Shift+Enter is a new line)
            if (e.key !== 'Enter' || e.shiftKey || !e.target.matches('.wm-ti-super-reply textarea')) return;
            e.preventDefault();
            const send = e.target.closest('.wm-ti-super-reply').querySelector('[data-super="send"]');
            if (send) send.click();
        });
        host.appendChild(superEl);
        window.addEventListener('androidnotifications', () => { if (superOpen) refreshNotes(); });
        // an app added to or removed from Messaging (#885) leaves or rejoins the list
        const t = window.textMessaging;
        if (t && typeof t.on === 'function') t.on('account', () => { if (superOpen) setTimeout(refreshNotes, 300); });
    }

    function drawSuper(clock) {
        // the page the band shows (the clock, or one of its forecast pages): the card is that page
        const cp = clock.pages[pageIndex(clock)] || clock.pages[0];
        // the clock panel's own markup and classes: it draws exactly as the panel in the band
        superEl.querySelector('.wm-ti-super-panel').innerHTML = `<div class="wm-ti-pg">${pageHtml(clock, cp, { live: true })}</div>`;
        // the expanded card's weather (Melaton Weather's selected place): its condition icon, temperature
        // and condition, then the next hours; the card grows by it; a tap opens Weather
        const W = window.wmWeather;
        let cur = null; let hours = [];
        try { cur = W && typeof W.current === 'function' ? W.current() : null; hours = cur && typeof W.hourly === 'function' ? W.hourly(6) : []; } catch (_) { cur = null; hours = []; }
        const extra = superEl.querySelector('.wm-ti-super-extra');
        const wxSet = (u1, u2) => `${esc(u1)} 1x, ${esc(u2 || u1)} 2x, ${esc(String(u2 || u1).replace('@2x.png', '@4x.png'))} 4x`;
        if (cur) {
            const hiLo = cur.hi != null && cur.lo != null ? `H ${cur.hi}\u00b0 L ${cur.lo}\u00b0` : '';
            const line = [cur.condition, cur.place, hiLo].filter(Boolean).join(' \u00b7 ');
            extra.innerHTML = `<button type="button" class="wm-ti-super-wx" data-super="weather" aria-label="Weather">
                <span class="wm-ti-super-wxnow"><img src="${esc(cur.iconUrl)}" srcset="${wxSet(cur.iconUrl, cur.iconUrl2x)}" alt="" draggable="false"><span class="wm-ti-super-wxt">${esc(cur.temp != null ? `${cur.temp}\u00b0` : '')}</span><span class="wm-ti-super-wxc">${esc(line)}</span></span>
                ${hours.length ? `<span class="wm-ti-super-hours">${hours.map((h) => `<span class="wm-ti-super-hour"><span>${esc(h.label)}</span><img src="${esc(h.iconUrl)}" srcset="${wxSet(h.iconUrl, h.iconUrl2x)}" alt="" draggable="false"><span>${esc(h.temp)}</span></span>`).join('')}</span>` : ''}
            </button>`;
            superGrow = hours.length ? 74 : 28;
        } else {
            extra.innerHTML = '';
            superGrow = 0;
        }
        const uu = unit();
        superEl.querySelector('.wm-ti-super-body').style.top = `${(62 + superGrow) * uu}px`;
        superEl.style.setProperty('--fall', `${Math.round(host.clientHeight * 1.15)}px`);
        drawWeatherFx(cur);
        // the frost: the band's blurred copy, placed on the picture as the band's is (the card's own
        // translate is undone on it while it moves, so it stays lined up with the picture)
        const frost = superEl.querySelector('.wm-ti-super-frost');
        if (fx.blur && blurInner && blurInner.style.backgroundImage && blurClip && !blurClip.hidden && wallEl) {
            const wr = wallEl.getBoundingClientRect();
            const hr = host.getBoundingClientRect();
            Object.assign(frost.style, { display: '', backgroundImage: blurInner.style.backgroundImage, backgroundSize: blurInner.style.backgroundSize, backgroundPosition: blurInner.style.backgroundPosition, left: `${wr.left - hr.left}px`, top: `${wr.top - hr.top - 9 * unit()}px`, width: `${wr.width}px`, height: `${wr.height}px` });
        } else frost.style.display = 'none';
    }

    /**
     * The weather inside the bar (Yukimi, Nov 15): rain or drizzle falling, snow drifting, sleet both,
     * a storm's flashes, fog banks and clouds drifting, the sun's glow and turning rays by day, stars by
     * night. A few dozen small layers on transform / opacity animations, made when the bar opens.
     */
    function drawWeatherFx(cur) {
        const box = superEl.querySelector('.wm-ti-super-fx');
        let still = false;
        try { still = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { /* no media queries */ }
        const scene = cur && cur.scene;
        if (!scene || still) { box.innerHTML = ''; box.dataset.scene = ''; return; }
        if (box.dataset.scene === `${scene}|${cur.isDay}`) return;
        box.dataset.scene = `${scene}|${cur.isDay}`;
        const rnd = (a, b) => a + Math.random() * (b - a);
        const drops = (n, slow) => Array.from({ length: n }, () => `<i class="wm-wx-drop" style="left:${rnd(-5, 105).toFixed(1)}%;--t:${rnd(slow ? 0.9 : 0.55, slow ? 1.4 : 0.85).toFixed(2)}s;--d:-${rnd(0, 2).toFixed(2)}s;--l:${rnd(7, 13).toFixed(1)}"></i>`).join('');
        const flakes = (n) => Array.from({ length: n }, () => `<i class="wm-wx-flake" style="left:${rnd(-3, 103).toFixed(1)}%;--t:${rnd(7, 12).toFixed(1)}s;--d:-${rnd(0, 12).toFixed(1)}s;--s:${rnd(1.4, 3.2).toFixed(1)};--x:${rnd(-6, 6).toFixed(1)}"></i>`).join('');
        const clouds = (n, a) => Array.from({ length: n }, (_, i) => `<i class="wm-wx-cloud" style="top:${(8 + i * 22 + rnd(-4, 4)).toFixed(0)}%;--t:${rnd(38, 60).toFixed(0)}s;--d:-${rnd(0, 60).toFixed(0)}s;--a:${a}"></i>`).join('');
        let html = '';
        if (scene === 'storm') html = drops(60) + '<i class="wm-wx-flash"></i>';
        else if (scene === 'heavy') html = drops(60);
        else if (scene === 'rain') html = drops(40);
        else if (scene === 'drizzle') html = drops(24, true);
        else if (scene === 'snow') html = flakes(40);
        else if (scene === 'sleet') html = drops(18, true) + flakes(20);
        else if (scene === 'fog') html = '<i class="wm-wx-fog"></i><i class="wm-wx-fog" style="--d:-14s;top:55%"></i>';
        else if (scene === 'cloudy') html = clouds(4, 0.14);
        else if (scene === 'partly') html = (cur.isDay ? '<i class="wm-wx-sun"></i>' : '') + clouds(3, 0.11);
        else if (cur.isDay) html = '<i class="wm-wx-sun"></i><i class="wm-wx-rays"></i>';
        else html = Array.from({ length: 32 }, () => `<i class="wm-wx-star" style="left:${rnd(2, 98).toFixed(1)}%;top:${rnd(2, 70).toFixed(1)}%;--t:${rnd(2.5, 5).toFixed(1)}s;--d:-${rnd(0, 5).toFixed(1)}s"></i>`).join('');
        box.innerHTML = html;
    }

    const SUPER_NOTES_KEY = 'wmSuperBarNotes'; // { phone, apps: { pkg: false }, channels: { 'pkg|ch': false }, known: { pkg: { app, channels } } }
    /** Android apps that are Messaging accounts (#885): the Super Bar leaves them to Messaging. */
    function messagingPackages() {
        const t = window.textMessaging;
        try { return t && typeof t.androidPackages === 'function' ? t.androidPackages() : new Set(); } catch (_) { return new Set(); }
    }

    function superNotesCfg() {
        let c = null;
        try { c = JSON.parse(localStorage.getItem(SUPER_NOTES_KEY) || 'null'); } catch (_) { c = null; }
        c = c && typeof c === 'object' ? c : {};
        return { phone: c.phone, apps: c.apps || {}, channels: c.channels || {}, known: c.known || {} };
    }
    /** Keep the apps and their channels seen in the bar (for the settings page), written only when new ones come. */
    function rememberNotes(cfg, list) {
        let changed = false;
        for (const n of list) {
            if (!n.package) continue;
            const k = cfg.known[n.package] || (cfg.known[n.package] = { app: n.app || n.package, channels: [] });
            if (!cfg.known[n.package].app || k.app !== (n.app || k.app)) { k.app = n.app || k.app; changed = true; }
            if (!k.seen) { k.seen = true; changed = true; }
            if (n.channel && !k.channels.includes(n.channel) && k.channels.length < 24) { k.channels.push(n.channel); changed = true; }
        }
        if (!changed) return;
        const pkgs = Object.keys(cfg.known);
        if (pkgs.length > 80) pkgs.slice(0, pkgs.length - 80).forEach((p) => delete cfg.known[p]);
        try { localStorage.setItem(SUPER_NOTES_KEY, JSON.stringify(cfg)); } catch (_) { /* storage off */ }
    }

    /*
     * The phone's notifications, one card per app (Yukimi, Nov 16, #877): the app's most important
     * notification (Android's ranking of its channel, then the newest) in full, the count of the rest
     * beside the app's name; a tap on the app's line (or its count) opens the app's card to show all
     * of them at once, its X clears the app's clearable ones. Each shows what Android's shade shows:
     * the sender's face or thumbnail (large icon), the big picture, a progress bar, the conversation's
     * last messages or an inbox's lines, and its buttons (Reply opens a box under it).
     */
    const superExpanded = new Set(); // packages opened to show every notification
    let superReply = null; // { key, index, label, draft } while a reply box is open
    const superImages = new Map(); // image id -> data URL (AndroidPhoneNotifications.image)
    let superNoteRows = new Map(); // key -> row, as last listed

    function noteAction(N, kind, row) {
        const key = row.dataset.key;
        const pkg = row.dataset.pkg;
        if (kind === 'expand') {
            if (superExpanded.has(pkg)) superExpanded.delete(pkg); else superExpanded.add(pkg);
            refreshNotes();
            return;
        }
        if (kind === 'dismiss') { try { N.dismiss(key); } catch (_) { /* gone */ } return; }
        if (kind === 'clearapp') {
            for (const n of superNoteRows.values()) if (n.package === pkg && n.clearable !== false) { try { N.dismiss(n.key); } catch (_) { /* gone */ } }
            superExpanded.delete(pkg);
            return;
        }
        if (kind === 'note') {
            let ok = false;
            try { ok = !!N.open(key); } catch (_) { ok = false; }
            // its intent gone (or an old app): the app itself
            if (!ok && pkg && window.AndroidApps && typeof window.AndroidApps.launch === 'function') { try { ok = window.AndroidApps.launch(pkg) === true; } catch (_) { ok = false; } }
            if (ok) closeSuper(true);
            return;
        }
        if (kind === 'act') {
            const i = Number(row.dataset.i);
            if (row.dataset.reply === '1') {
                superReply = superReply && superReply.key === key && superReply.index === i ? null : { key, index: i, label: row.dataset.label || 'Reply', draft: '' };
                refreshNotes(true);
                const ta = superEl.querySelector('.wm-ti-super-reply textarea');
                if (ta) ta.focus();
                return;
            }
            try { N.action(key, i, null); } catch (_) { /* old app */ }
            return;
        }
        if (kind === 'send') {
            const ta = row.closest('.wm-ti-super-reply')?.querySelector('textarea');
            const text = ta ? ta.value.trim() : '';
            if (!text || !superReply) return;
            let ok = false;
            try { ok = !!N.action(superReply.key, superReply.index, text); } catch (_) { ok = false; }
            if (ok) { superReply = null; refreshNotes(true); }
        }
    }

    function noteRank(n) {
        const cat = { call: 3, alarm: 3, navigation: 2, msg: 1, email: 1, event: 1, reminder: 1 }[n.category] || 0;
        return (Number(n.importance) || 3) * 10 + cat;
    }

    function noteHtml(n, when, head) {
        const imp = noteRank(n);
        const big = (id, cls) => (id ? `<img class="${cls}" data-img="${esc(id)}" alt="" draggable="false">` : '');
        let body = '';
        if (Array.isArray(n.messages) && n.messages.length) {
            // a one-to-one chat names its sender in the title already: only other senders are named
            const solo = n.messages.every((m) => !m.sender || m.sender === n.title);
            body = `<span class="wm-ti-super-msgs">${n.messages.slice(head ? -3 : -6).map((m) => `<span class="wm-ti-super-msg">${m.sender && !solo ? `<b>${esc(m.sender)}</b> ` : ''}${esc(m.text)}</span>`).join('')}</span>`;
        } else if (Array.isArray(n.lines) && n.lines.length) {
            body = `<span class="wm-ti-super-lines">${n.lines.slice(0, 6).map((l) => `<span>${esc(l)}</span>`).join('')}</span>`;
        } else if (n.text) body = `<span class="wm-ti-super-note-body">${esc(n.text)}</span>`;
        let prog = '';
        if (n.progress) {
            const p = n.progress.indeterminate || !(n.progress.max > 0) ? -1 : Math.max(0, Math.min(1, n.progress.value / n.progress.max));
            prog = `<span class="wm-ti-super-prog${p < 0 ? ' is-marquee' : ''}" style="--p:${p < 0 ? 0 : p.toFixed(3)}"><span></span></span>`;
        }
        const title = n.conversation && n.conversation !== n.title ? n.conversation : n.title;
        const acts = Array.isArray(n.actions) && n.actions.length ? `<div class="wm-ti-super-acts">${n.actions.slice(0, 3).map((a) => `<button type="button" class="wm-ti-super-act${superReply && superReply.key === n.key && superReply.index === a.index ? ' is-on' : ''}" data-super="act" data-key="${esc(n.key)}" data-i="${a.index}" data-reply="${a.reply ? 1 : 0}" data-label="${esc(a.label || '')}">${esc(a.title)}</button>`).join('')}</div>` : '';
        const reply = superReply && superReply.key === n.key ? `<div class="wm-ti-super-reply"><textarea class="wm-edit" rows="2" placeholder="${esc(superReply.label)}">${esc(superReply.draft || '')}</textarea><button type="button" class="wm-ti-super-act" data-super="send">Send</button></div>` : '';
        return `<div class="wm-ti-super-note${imp >= 40 ? ' is-high' : ''}" data-key="${esc(n.key)}">
            <div class="wm-ti-super-note-row">
            <button type="button" class="wm-ti-super-note-open" data-super="note" data-key="${esc(n.key)}" data-pkg="${esc(n.package)}"><span class="wm-ti-super-note-text"><span class="wm-ti-super-note-top"><span class="wm-ti-super-note-title">${esc(title)}</span><span class="wm-ti-super-note-when">${esc(when(n.time))}</span></span>${n.subText ? `<span class="wm-ti-super-note-app">${esc(n.subText)}</span>` : ''}${body}${prog}</span>${big(n.large, 'wm-ti-super-large')}</button>
            ${n.clearable === false ? '<span class="wm-ti-super-note-xgap"></span>' : `<button type="button" class="wm-ti-super-note-x" data-super="dismiss" data-key="${esc(n.key)}" aria-label="Clear"></button>`}
            </div>${n.picture ? `<button type="button" class="wm-ti-super-pic" data-super="note" data-key="${esc(n.key)}" data-pkg="${esc(n.package)}">${big(n.picture, '')}</button>` : ''}${acts}${reply}</div>`;
    }

    function refreshNotes(force) {
        if (!superEl) return;
        const box = superEl.querySelector('.wm-ti-super-notes');
        const sub = superEl.querySelector('.wm-ti-super-sub');
        const N = window.AndroidPhoneNotifications;
        const plain = (html) => { box.innerHTML = html; superNoteRows = new Map(); pruneNoteImages(); };
        if (!N || typeof N.list !== 'function') { sub.hidden = true; plain('<div class="wm-ti-super-empty">The phone\'s notifications show here with the Dreamscape app.</div>'); return; }
        sub.hidden = false;
        let ok = false;
        try { ok = !!N.access(); } catch (_) { ok = false; }
        if (!ok) { plain('<button type="button" class="wm-ti-super-item" data-super="access"><span class="wm-ti-super-line">Allow notification access to see the phone\'s notifications here.</span></button>'); return; }
        let list = [];
        try { list = JSON.parse(N.list() || '[]'); } catch (_) { list = []; }
        // Settings > Today > Super Bar: the phone's notifications off, or some apps or channels hidden;
        // the apps and channels seen are kept for that page to list
        const cfg = superNotesCfg();
        rememberNotes(cfg, list);
        if (cfg.phone === false) { sub.hidden = true; plain(''); return; }
        // an app that is a Messaging account (Discord, #885): its notifications are conversations there
        const managed = messagingPackages();
        list = list.filter((n) => n && n.key && !managed.has(n.package) && cfg.apps[n.package] !== false && !(n.channel && cfg.channels[`${n.package}|${n.channel}`] === false));
        superNoteRows = new Map(list.map((n) => [n.key, n]));
        // a reply box whose notification went: gone with it; one being typed in keeps its words
        const ta = box.querySelector('.wm-ti-super-reply textarea');
        if (superReply && ta) superReply.draft = ta.value;
        if (superReply && !superNoteRows.has(superReply.key)) superReply = null;
        if (!list.length) { plain('<div class="wm-ti-super-empty">No notifications</div>'); return; }
        const when = (t) => { const d = new Date(Number(t) || 0); if (isNaN(d)) return ''; const p = timeParts(d); return p.time + (p.ampm ? ` ${p.ampm}` : ''); };
        // by app: most important first, then the newest
        const groups = new Map();
        for (const n of list) {
            const k = n.package || n.key;
            if (!groups.has(k)) groups.set(k, []);
            groups.get(k).push(n);
        }
        const order = [...groups.entries()].map(([pkg, ns]) => {
            ns.sort((a, b) => noteRank(b) - noteRank(a) || (Number(b.time) || 0) - (Number(a.time) || 0));
            return { pkg, ns, high: noteRank(ns[0]) >= 40, latest: Math.max(...ns.map((n) => Number(n.time) || 0)) };
        }).sort((a, b) => (b.high - a.high) || b.latest - a.latest).slice(0, 30);
        for (const p of [...superExpanded]) if (!groups.has(p)) superExpanded.delete(p);
        const html = order.map(({ pkg, ns, latest }) => {
            const open = superExpanded.has(pkg) && ns.length > 1;
            const h = ns[0];
            const more = ns.length - 1;
            const shown = open ? ns : [h];
            const anyClear = ns.some((n) => n.clearable !== false);
            return [pkg, `<div class="wm-ti-super-grp${open ? ' is-open' : ''}${more && !open ? ' is-stacked' : ''}" data-pkg="${esc(pkg)}">
                <div class="wm-ti-super-grp-head">
                    <button type="button" class="wm-ti-super-grp-name" data-super="${more ? 'expand' : 'note'}" data-pkg="${esc(pkg)}" data-key="${esc(h.key)}"${more ? ` aria-expanded="${open}"` : ''}>${h.icon ? `<img src="${esc(h.icon)}" alt="" draggable="false">` : '<span class="wm-ti-super-noicon"></span>'}<span class="wm-ti-super-grp-app">${esc(h.app)}</span><span class="wm-ti-super-grp-when">${esc(when(latest))}</span>${more ? `<span class="wm-ti-super-grp-count">${open ? ns.length : `+${more}`}<i class="wm-ti-super-chev"></i></span>` : ''}</button>
                    ${anyClear && more ? `<button type="button" class="wm-ti-super-note-x" data-super="clearapp" data-pkg="${esc(pkg)}" aria-label="Clear all from ${esc(h.app)}"></button>` : ''}
                </div>
                ${shown.map((n) => noteHtml(n, when, !open)).join('')}
            </div>`];
        });
        // only the apps whose cards changed are redrawn (a progress tick redraws its own card)
        const have = new Map([...box.querySelectorAll(':scope > .wm-ti-super-grp')].map((el) => [el.dataset.pkg, el]));
        if (!have.size) box.innerHTML = '';
        let prev = null;
        for (const [pkg, h] of html) {
            let el = have.get(pkg);
            have.delete(pkg);
            // never under a reply being typed (its box would lose the keyboard)
            const typing = el && !force && document.activeElement && document.activeElement.tagName === 'TEXTAREA' && el.contains(document.activeElement);
            if (!typing && (!el || force || el._html !== h)) {
                const t = document.createElement('template');
                t.innerHTML = h.trim();
                const fresh = t.content.firstElementChild;
                fresh._html = h;
                if (el) el.replaceWith(fresh); else box.appendChild(fresh);
                el = fresh;
                fillNoteImages(N, el);
            }
            const want = prev ? prev.nextElementSibling : box.firstElementChild;
            if (want !== el) box.insertBefore(el, want);
            prev = el;
        }
        have.forEach((el) => el.remove());
        [...box.children].forEach((el) => { if (!el.classList.contains('wm-ti-super-grp')) el.remove(); });
        pruneNoteImages();
    }

    /**
     * The pictures of notifications no longer listed go (#890): up to 60 data URLs (big pictures,
     * faces) stayed after they were dismissed. A listed one keeps its copy while its card is folded,
     * so opening the card asks the app for nothing again.
     */
    function pruneNoteImages() {
        if (!superImages.size) return;
        const keep = new Set();
        superNoteRows.forEach((n) => { if (n.large) keep.add(String(n.large)); if (n.picture) keep.add(String(n.picture)); });
        for (const id of [...superImages.keys()]) if (!keep.has(id)) superImages.delete(id);
    }

    /** The pictures and faces, asked of the app once each (a data URL per id, kept while listed). */
    function fillNoteImages(N, el) {
        el.querySelectorAll('img[data-img]').forEach((img) => {
            const id = img.dataset.img;
            let url = superImages.get(id);
            if (url == null && typeof N.image === 'function') {
                try { url = N.image(id) || ''; } catch (_) { url = ''; }
                if (url) { superImages.set(id, url); if (superImages.size > 60) superImages.delete(superImages.keys().next().value); }
            }
            if (url) img.src = url; else img.remove();
        });
    }

    // ---------------------------------------------------------------- drawing

    // the unit and the list's height, kept between frames (#907 wake profile): read on every frame of a move, right
    // after its --wm-ti-top write, they forced a style recalc and a layout of the whole page per frame (Today's
    // entrance after a return on the A53). They change only with the screen's size, the UI scale or the version:
    // read again after a resize, a change on <html>, or the list's own size changing (ResizeObserver, no forced read)
    let unitKept = 0;
    let hostHKept = 0;
    function unit() {
        if (!unitKept) unitKept = parseFloat(getComputedStyle(root).getPropertyValue('--wm-px')) || 1;
        return unitKept;
    }
    function hostHeight() {
        if (!hostHKept && host) hostHKept = host.clientHeight;
        return hostHKept;
    }
    const forgetSizes = () => { unitKept = 0; hostHKept = 0; };
    window.addEventListener('resize', forgetSizes, { signal: appScopeSignal });
    new MutationObserver(() => { unitKept = 0; }).observe(root, { attributes: true, attributeFilter: ['style', 'class', 'data-wm-version', 'data-wm-scale'] });

    function build() {
        host = document.createElement('div');
        hostHKept = 0;
        if (typeof ResizeObserver === 'function') new ResizeObserver(() => { hostHKept = 0; }).observe(host);
        host.className = 'wm-ti';
        host.innerHTML = `<div class="wm-ti-list"></div>
            <div class="wm-ti-band" aria-hidden="true"></div>
            <div class="wm-ti-focus">
                <button type="button" class="wm-ti-arrow" data-dir="-1" aria-label="Previous" hidden></button>
                <button type="button" class="wm-ti-arrow" data-dir="1" aria-label="Next" hidden></button>
                <div class="wm-ti-exp"></div>
            </div>`;
        host.querySelector('.wm-ti-band').style.backgroundImage = artImageSet('ti-3000');
        host.querySelectorAll('.wm-ti-arrow').forEach((b) => {
            const id = b.dataset.dir === '1' ? 'ti-3601' : 'ti-3600';
            b.style.backgroundImage = artImageSet(id);
            b.addEventListener('click', (e) => { e.stopPropagation(); turnPage(Number(b.dataset.dir)); });
        });
        bindPointer();
        // tap-and-hold on the panel: its page's own menu (pages[].menu / panel.menu, an item list or
        // a function giving one), e.g. Music's Previous / Next; the lift after it opens nothing
        host.addEventListener('contextmenu', (e) => {
            // only on the panel in the band (the list under it takes the press: the focus layer lets it through)
            const y = (e.clientY - host.getBoundingClientRect().top) / unit();
            const top = focusTop();
            if (y < top || y >= top + BAND) return;
            const p = panels[sel];
            const pg = p && p.pages[pageIndex(p)];
            let m = (pg && pg.menu) || (p && p.menu);
            if (typeof m === 'function') { try { m = m(pg); } catch (_) { m = null; } }
            if (!Array.isArray(m) || !m.length || slide.active || dragging || settle) return;
            e.preventDefault();
            menuAt = Date.now();
            sh.menuAt(e.clientX, e.clientY, m);
        });
        page.appendChild(host);
        requestAnimationFrame(() => syncBlur());
    }

    function focusTop() {
        // centred in the list: (height - 140) / 2 in VGA pixels
        const u = unit();
        return Math.round(((hostHeight() / u) - BAND) / 2 * 2) / 2;
    }

    function drawRows() {
        const list = host.querySelector('.wm-ti-list');
        const have = new Map([...list.children].map((el) => [el.dataset.id, el]));
        panels.forEach((p) => {
            let el = have.get(p.id);
            if (!el) {
                el = document.createElement('div');
                el.className = 'wm-ti-row';
                el.dataset.id = p.id;
                el.innerHTML = '<span class="wm-ti-label"></span><span class="wm-ti-count"></span>';
                list.appendChild(el);
            }
            have.delete(p.id);
            const l = el.firstElementChild;
            const c = el.lastElementChild;
            if (l.textContent !== p.label) l.textContent = p.label;
            if (c.textContent !== (p.count || '')) c.textContent = p.count || '';
            // a drawn mark in the count's place (music: play / pause), as the e-mail count sits by its label
            const ci = p.countIcon || '';
            if ((c.dataset.icon || '') !== ci) { if (ci) c.dataset.icon = ci; else delete c.dataset.icon; }
        });
        have.forEach((el) => el.remove());
        rowEl.clear();
        for (const el of list.children) rowEl.set(el.dataset.id, el);
    }

    /*
     * Settings > Today > Effects (Yukimi, Nov 15): what 2009's hardware could not draw, kept in the
     * 6.5 look. All are on unless switched off (wmTodayFx { name: false }); the moving ones are off
     * under prefers-reduced-motion. Everything runs on transform / opacity of a few layers, and the
     * frosted band is a picture blurred once (cached), not a backdrop filter run every frame.
     *   parallax  the picture, zoomed in, follows the list (wmTodayParallax, Distance wmTodayParallaxLevel)
     *   tilt      ... and leans with the phone (deviceorientation, only while Today is on screen)
     *   breathe   the picture settles from a slight zoom as Today comes back
     *   stagger   the list comes back stretched and closes up as it lands (a cascade)
     *   overshoot ... passing the band by a few pixels and settling back
     *   catch     the glass band lights up as the list lands
     *   exit      the list drops away when an item opens a program
     *   gloss     labels pick up light as they pass under the glass
     *   digits    the clock's changed digits roll over
     *   blur      the band frosts the picture behind it
     *   haptics   a tick as items cross the band, a firmer one when the list lands
     */
    const PARALLAX_KEY = 'wmTodayParallax';
    const PARALLAX_LEVEL_KEY = 'wmTodayParallaxLevel'; // 1 - 10: zoom 1 + 2 % a step, travel 7/8 of the margin
    const FX_KEY = 'wmTodayFx';
    // Settings > Today > Text (Yukimi, Nov 17): the labels' weight and the glass item's (wm-titanium.css)
    const ROW_WEIGHT_KEY = 'wmTodayRowWeight';
    const BAND_WEIGHT_KEY = 'wmTodayBandWeight';
    const WEIGHTS = ['bold', 'regular', 'semilight', 'light'];
    function readTextWeights() {
        [[ROW_WEIGHT_KEY, 'wmTiRow'], [BAND_WEIGHT_KEY, 'wmTiBand']].forEach(([k, attr]) => {
            let v = null;
            try { v = localStorage.getItem(k); } catch (_) { v = null; }
            if (WEIGHTS.includes(v)) { if (root.dataset[attr] !== v) root.dataset[attr] = v; } else delete root.dataset[attr];
        });
        syncClockWidth();
    }
    /**
     * The clock's box (wm-titanium.css --ti-time-w, WM units): "00:00" in the face and weight the time is drawn
     * in, at its 28 pt (37.333 units); the ROM's 93 when that is Tahoma regular. Worked out when the weight or
     * the system font changes, once the face is in (measured, never per frame).
     */
    let clockFace = '';
    function syncClockWidth() {
        const band = root.dataset.wmTiBand || 'bold';
        const segoe = band === 'semilight' || band === 'light' || (() => { try { return localStorage.getItem('wmSystemFont') === 'segoe'; } catch (_) { return false; } })();
        // (the time is never bold: Bold is the first line's, the clock keeps the ROM's regular)
        const weight = { semilight: 350, light: 300 }[band] || 400;
        const face = `${weight}|${segoe ? 's' : 't'}`;
        if (face === clockFace) return;
        clockFace = face;
        if (!segoe && weight === 400) { root.style.removeProperty('--ti-time-w'); return; }
        const font = `${weight} 100px ${segoe ? "'Segoe UI'" : 'Tahoma'}`;
        const measure = () => {
            if (clockFace !== face) return;
            try {
                const g = document.createElement('canvas').getContext('2d');
                g.font = font;
                const w = g.measureText('00:00').width; // at 100 px; the time is 37.333 units
                if (w > 0) root.style.setProperty('--ti-time-w', String(Math.round(w * 0.37333 * 10) / 10));
            } catch (_) { /* the ROM's box */ }
        };
        if (document.fonts && document.fonts.load) document.fonts.load(font, '0123456789:').then(measure, measure);
        else measure();
    }
    // ... and Start's (wmStart65.js, wm65-start.css): startopen (icons in from the corner), startfrost
    // (the frosted picture under its dark sheet), startlaunch (a program grows out of its icon),
    // startticks (a tick a row while it scrolls)
    // superbar: a tap on the clock opens the Super Bar (openSuper)
    const FX_NAMES = ['tilt', 'breathe', 'stagger', 'overshoot', 'catch', 'exit', 'gloss', 'digits', 'blur', 'haptics', 'startopen', 'startfrost', 'startlaunch', 'startticks', 'superbar'];
    const FX_MOTION = ['tilt', 'breathe', 'stagger', 'overshoot', 'exit', 'digits', 'startopen', 'startlaunch'];
    const fx = {};
    let parallaxOn = false;
    let parallaxZoom = 1.08;
    let wallZoom = 1;
    let wallEl = null;
    let wallVarsSet = {};
    let fxLayer = null;
    let frostLayer = null;
    let fxKey = '';
    const sizedCache = new Map();
    let blurClip = null;
    let blurInner = null;
    let blurMo = null;
    let blurKey = '';
    const blurCache = new Map();
    // both caches are small LRUs of blob-URL promises (#890): every large picture ever shown kept its
    // screen-sized WebP and its blurred copy for the life of the page. An evicted blob is revoked once
    // no layer shows it (the moving copy, Start's frost, the band, the Super Bar's frost).
    const SIZED_MAX = 4;
    const BLUR_MAX = 8;
    const blobRetired = new Set();
    function blobShown(url) {
        const frost = superEl && superEl.querySelector('.wm-ti-super-frost');
        return [fxLayer, frostLayer, blurInner, frost].some((el) => !!el && String(el.style.backgroundImage || '').includes(url));
    }
    function lruGet(cache, k) {
        if (!cache.has(k)) return null;
        const pr = cache.get(k);
        cache.delete(k);
        cache.set(k, pr);
        return pr;
    }
    function lruPut(cache, k, pr, max) {
        cache.set(k, pr);
        while (cache.size > max) {
            const [oldK, oldPr] = cache.entries().next().value;
            cache.delete(oldK);
            // retired, then swept a task later: a draw still waiting on it puts it on a layer first
            Promise.resolve(oldPr).then((url) => {
                if (!url) return;
                blobRetired.add(url);
                setTimeout(sweepRetired, 0);
            });
        }
        return pr;
    }
    /** After a layer took a new picture: blobs evicted while still shown go now they are not. */
    function sweepRetired() {
        for (const url of blobRetired) {
            if (blobShown(url)) continue;
            blobRetired.delete(url);
            URL.revokeObjectURL(url);
        }
    }
    function readEffects() {
        try { parallaxOn = localStorage.getItem(PARALLAX_KEY) === '1'; } catch (_) { parallaxOn = false; }
        let lv = 4;
        try { lv = Math.max(1, Math.min(10, Math.round(Number(localStorage.getItem(PARALLAX_LEVEL_KEY)) || 4))); } catch (_) { /* default */ }
        parallaxZoom = 1 + 0.02 * lv;
        let st = null;
        try { st = JSON.parse(localStorage.getItem(FX_KEY) || 'null'); } catch (_) { st = null; }
        st = st && typeof st === 'object' ? st : {};
        let still = false;
        try { still = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { /* no media queries */ }
        FX_NAMES.forEach((n) => { fx[n] = st[n] !== false && !(still && FX_MOTION.includes(n)); });
        // the picture's margin: the parallax Distance, or a little for the tilt alone
        wallZoom = parallaxOn ? parallaxZoom : (fx.tilt ? 1.04 : 1);
        if (parallaxOn || fx.tilt || fx.breathe) root.dataset.wmWallfx = '';
        else delete root.dataset.wmWallfx;
        const on = FX_NAMES.filter((n) => fx[n]).join(' ');
        if (root.dataset.wmTiFx !== on) root.dataset.wmTiFx = on;
        wallEl = null; // the next use sets the zoom and travel again
        ensureWall();
        syncTilt();
        if (host) syncBlur();
    }

    /** The picture layer (.wm-wall65, wmShell.js) with this setting's zoom and travel on it. */
    function ensureWall() {
        if (wallEl && wallEl.isConnected) return true;
        const el = document.querySelector('#wmShell > .wm-wall65');
        if (!el) return false;
        if (el !== wallEl && blurMo) { blurMo.disconnect(); blurMo = null; }
        if (el !== wallEl && fxLayer) { fxLayer.remove(); fxLayer = null; fxKey = ''; }
        if (el !== wallEl && frostLayer) { frostLayer.remove(); frostLayer = null; }
        wallEl = el;
        wallVarsSet = {};
        // the moving copy of the picture: a child of the layer (wm65.css hides the layer's own picture
        // under it, so the full-size original is not drawn twice) that wallPicture() fills
        if (!fxLayer) {
            fxLayer = document.createElement('div');
            fxLayer.className = 'wm-wall65-fx';
            fxLayer.setAttribute('aria-hidden', 'true');
            wallEl.appendChild(fxLayer);
        }
        // Start's frosted picture (Effects > Start): the band's blurred copy, full screen, under the sheet
        if (!frostLayer) {
            frostLayer = document.createElement('div');
            frostLayer.className = 'wm-wall65-frost';
            frostLayer.setAttribute('aria-hidden', 'true');
            wallEl.appendChild(frostLayer);
        }
        wallEl.classList.add('has-fx');
        watchWall();
        wallVar('--wm-ti-zoom', wallZoom.toFixed(2));
        // 0.55 of the parallax travel stays inside the zoomed margin, with room left for the tilt
        wallVar('--wm-ti-shift', parallaxOn ? `${(-(wallZoom - 1) * 87.5).toFixed(2)}%` : '0%');
        if (!parallaxOn) wallVar('--wm-ti-par', '0');
        if (!fx.tilt) { wallVar('--wm-ti-tx', '0%'); wallVar('--wm-ti-ty', '0%'); }
        return true;
    }

    /** One custom property on the picture layer and on the band's frosted copy of it (only they restyle). */
    function wallVar(name, v) {
        if (wallVarsSet[name] === v) return;
        wallVarsSet[name] = v;
        if (fxLayer) fxLayer.style.setProperty(name, v);
        if (blurInner) blurInner.style.setProperty(name, v);
    }

    /** The list stands at row `at` (fractions while it moves): -0.5 at the first item, 0.5 at the last. */
    function parallax(at) {
        if (!parallaxOn || !ensureWall()) return;
        const n = panels.length;
        const f = n > 1 ? Math.max(-0.55, Math.min(0.55, at / (n - 1) - 0.5)) : 0;
        wallVar('--wm-ti-par', f.toFixed(4));
    }

    // ---- tilt: the phone's lean, against a resting hold that drifts in slowly (so any way of holding
    // it is the middle); smoothed per frame. #890: written in whole device pixels (the travel of a
    // percent is worked out from the picture's size), a reading that would move it by less than a quarter
    // of a pixel is left (the hand's tremor; the resting hold still drifts in), and the frames stop once
    // the rest of the way is under a pixel. Idle (Yukimi, Nov 17): 30 s without a touch or a key the sensor
    // goes off and the lean settles where the last reading put it; a touch, a key, the screen coming on or
    // Today shown again start it, and while it rests on screen it reads the phone for a second each minute
    // (the shell's minute tick) so the resting hold stays current. The look while in use is the same.
    const TILT_IDLE_MS = 30000;
    const TILT_PEEK_MS = 1000;
    let tiltOn = false;
    let tiltBase = null;
    let tiltRaw = null;
    const tiltNow = { x: 0, y: 0 };
    let tiltRaf = 0;
    let tiltPx = null;          // percent of the picture per device pixel { x, y }
    let tiltListening = false;
    let tiltIdle = false;
    let tiltIdleTimer = 0;
    let tiltPeekTimer = 0;
    let tiltInputAt = 0;
    function tiltWanted() {
        return !!(fx.tilt && host && !host.hidden && root.dataset.wmApp === 'today' && document.visibilityState === 'visible' && root.dataset.screenOff === undefined);
    }
    function tiltListen(on) {
        if (on === tiltListening) return;
        tiltListening = on;
        if (on) window.addEventListener('deviceorientation', onOrient);
        else window.removeEventListener('deviceorientation', onOrient);
    }
    function syncTilt() {
        const want = tiltWanted();
        if (want === tiltOn) return;
        tiltOn = want;
        clearTimeout(tiltIdleTimer); tiltIdleTimer = 0;
        clearTimeout(tiltPeekTimer); tiltPeekTimer = 0;
        tiltIdle = false;
        if (want) {
            // Today shown or the screen on: in use again from now
            tiltPx = null;
            tiltInputAt = performance.now();
            tiltListen(true);
            tiltIdleTimer = setTimeout(tiltIdleCheck, TILT_IDLE_MS + 50);
            return;
        }
        tiltListen(false);
        tiltBase = null;
        tiltRaw = null;
        tiltNow.x = 0; tiltNow.y = 0;
        cancelAnimationFrame(tiltRaf); tiltRaf = 0;
        wallVar('--wm-ti-tx', '0%');
        wallVar('--wm-ti-ty', '0%');
    }
    function tiltIdleCheck() {
        tiltIdleTimer = 0;
        if (!tiltOn || tiltIdle) return;
        const left = TILT_IDLE_MS - (performance.now() - tiltInputAt);
        if (left > 0) { tiltIdleTimer = setTimeout(tiltIdleCheck, left + 50); return; }
        // idle: the sensor off; the frames still running ease to where the last reading put the lean, and stop
        tiltIdle = true;
        tiltListen(false);
    }
    /** A touch or a key on the page: the tilt is in use (again). */
    function tiltTouched() {
        tiltInputAt = performance.now();
        if (!tiltOn) return;
        if (tiltIdle) {
            tiltIdle = false;
            clearTimeout(tiltPeekTimer); tiltPeekTimer = 0;
            tiltListen(true);
        }
        if (!tiltIdleTimer) tiltIdleTimer = setTimeout(tiltIdleCheck, TILT_IDLE_MS + 50);
    }
    /** The minute tick while it rests on screen: a second of readings keeps the resting hold current. */
    function tiltPeek() {
        if (!tiltOn || !tiltIdle || tiltPeekTimer) return;
        tiltListen(true);
        tiltPeekTimer = setTimeout(() => { tiltPeekTimer = 0; if (tiltIdle) tiltListen(false); }, TILT_PEEK_MS);
    }
    document.addEventListener('pointerdown', tiltTouched, { signal: appScopeSignal, capture: true, passive: true });
    document.addEventListener('keydown', tiltTouched, { signal: appScopeSignal, capture: true, passive: true });
    document.addEventListener('wmminute', tiltPeek, { signal: appScopeSignal });
    window.addEventListener('resize', () => { tiltPx = null; }, { signal: appScopeSignal });
    function tiltMeasure() {
        const el = wallEl && wallEl.isConnected ? wallEl : document.querySelector('#wmShell > .wm-wall65');
        const dpr = window.devicePixelRatio || 1;
        const w = (el && el.clientWidth) || window.innerWidth || 1;
        const h = (el && el.clientHeight) || window.innerHeight || 1;
        tiltPx = { x: 100 / Math.max(1, w * dpr), y: 100 / Math.max(1, h * dpr) };
    }
    const tiltK = () => (wallZoom - 1) * 15; // 0.3 of the margin each way, in percent
    function onOrient(e) {
        if (e.beta == null || e.gamma == null) return;
        const angle = (screen.orientation && screen.orientation.angle) || 0;
        // the screen's own axes: a turned phone swaps them
        let x = e.gamma; let y = e.beta;
        if (angle === 90) { x = e.beta; y = -e.gamma; } else if (angle === 270) { x = -e.beta; y = e.gamma; } else if (angle === 180) { x = -e.gamma; y = -e.beta; }
        if (!tiltBase) tiltBase = { x, y };
        tiltBase.x += (x - tiltBase.x) * 0.01;
        tiltBase.y += (y - tiltBase.y) * 0.01;
        const c = (v) => Math.max(-1, Math.min(1, v / 18));
        const raw = { x: c(x - tiltBase.x), y: c(y - tiltBase.y) };
        if (tiltRaw && tiltPx) {
            const k = tiltK();
            if (Math.abs(raw.x - tiltRaw.x) * k < 0.25 * tiltPx.x && Math.abs(raw.y - tiltRaw.y) * k < 0.25 * tiltPx.y) return;
        }
        tiltRaw = raw;
        if (!tiltRaf) tiltRaf = requestAnimationFrame(tiltFrame);
    }
    function tiltFrame() {
        tiltRaf = 0;
        if (!tiltOn || !tiltRaw || !ensureWall()) return;
        if (!tiltPx) tiltMeasure();
        const k = tiltK();
        tiltNow.x += (tiltRaw.x - tiltNow.x) * 0.2;
        tiltNow.y += (tiltRaw.y - tiltNow.y) * 0.2;
        // the rest of the way under a device pixel: there now, and no more frames until a reading moves it
        const done = Math.abs(tiltRaw.x - tiltNow.x) * k < tiltPx.x && Math.abs(tiltRaw.y - tiltNow.y) * k < tiltPx.y;
        if (done) { tiltNow.x = tiltRaw.x; tiltNow.y = tiltRaw.y; }
        // whole device pixels (wallVar writes only a value that changed)
        const qx = Math.round((-tiltNow.x * k) / tiltPx.x) * tiltPx.x;
        const qy = Math.round((-tiltNow.y * k) / tiltPx.y) * tiltPx.y;
        wallVar('--wm-ti-tx', `${(qx || 0).toFixed(4)}%`);
        wallVar('--wm-ti-ty', `${(qy || 0).toFixed(4)}%`);
        if (!done) tiltRaf = requestAnimationFrame(tiltFrame);
    }

    // ---- the frosted band: the picture blurred once into a small cached image, shown in the band's
    // glass and lined up with the picture layer (the same zoom, travel and tilt). No filter runs per
    // frame; Android's own wallpaper (drawn behind the page) has none.
    function syncBlur() {
        const want = fx.blur && host && !host.hidden && ensureWall();
        if (!want) {
            if (blurClip) blurClip.hidden = true;
            // Start's frost still wants the blurred picture
            if (fx.startfrost && ensureWall()) { blurKey = ''; blurPicture(); }
            return;
        }
        if (!blurClip) {
            blurClip = document.createElement('div');
            blurClip.className = 'wm-ti-blur';
            blurClip.setAttribute('aria-hidden', 'true');
            blurClip.hidden = true;
            blurInner = document.createElement('div');
            blurInner.className = 'wm-ti-blur-in';
            blurClip.appendChild(blurInner);
            host.insertBefore(blurClip, host.firstChild);
        }
        for (const [k, v] of Object.entries(wallVarsSet)) blurInner.style.setProperty(k, v);
        watchWall();
        blurKey = '';
        blurPicture();
    }
    /** The picture layer's own picture changing (wmShell.js applyTodayBackground): the copies follow. */
    function watchWall() {
        if (blurMo || !wallEl) return;
        blurMo = new MutationObserver(() => { wallPicture(); blurPicture(); });
        blurMo.observe(wallEl, { attributes: true, attributeFilter: ['style', 'hidden'] });
        wallPicture();
    }
    /**
     * The moving copy draws a screen-sized version of the picture (made once per picture, cached):
     * the original can be a 4K upscale, and decoding and drawing it again on every return home was a
     * good part of the wait before Today showed (Fold7 trace, Nov 15: two frames of 94 and 136 ms
     * with no script). Placement and sizes stay the layer's own, so it lines up exactly.
     */
    function wallPicture() {
        if (!fxLayer || !wallEl) return;
        const w = wallEl.style;
        const key = `${w.backgroundImage}|${w.backgroundSize}|${w.backgroundPosition}|${w.backgroundRepeat}|${w.backgroundColor}`;
        if (key === fxKey) return;
        fxKey = key;
        Object.assign(fxLayer.style, { backgroundImage: w.backgroundImage, backgroundSize: w.backgroundSize, backgroundPosition: w.backgroundPosition, backgroundRepeat: w.backgroundRepeat, backgroundColor: w.backgroundColor || '#000' });
        const img = w.backgroundImage;
        const urls = img ? [...img.matchAll(/url\((['"]?)(.*?)\1\)/g)].map((m) => m[2]) : [];
        if (!urls.length) return;
        if (blobRetired.size) sweepRetired();
        Promise.all(urls.map(sizedUrl)).then((outs) => {
            if (key !== fxKey || !fxLayer) return;
            let out = img;
            urls.forEach((u, i) => { if (outs[i]) out = out.split(u).join(outs[i]); });
            if (out !== img) fxLayer.style.backgroundImage = out;
            if (blobRetired.size) sweepRetired();
        });
    }
    /** The picture at the size the screen can show (its long side cover-fitted to the screen with the zoom's margin), as a WebP blob; null when it is already that small. */
    function sizedUrl(u) {
        const dpr = window.devicePixelRatio || 1;
        const tw = Math.ceil(Math.max(screen.width, screen.height, window.innerWidth, window.innerHeight) * dpr * 1.25);
        const k = `${u}|${tw}`;
        const had = lruGet(sizedCache, k);
        if (had) return had;
        const pr = new Promise((resolve) => {
            const im = new Image();
            im.decoding = 'async';
            if (!/^(blob|data):/.test(u)) im.crossOrigin = 'anonymous';
            im.onload = () => {
                try {
                    const nw = im.naturalWidth; const nh = im.naturalHeight;
                    // cover: the short side must still fill the screen's long side
                    const scale = Math.min(1, tw / Math.min(nw, nh));
                    if (scale > 0.85) { resolve(null); return; }
                    const c = document.createElement('canvas');
                    c.width = Math.round(nw * scale); c.height = Math.round(nh * scale);
                    const x = c.getContext('2d');
                    x.imageSmoothingQuality = 'high';
                    x.drawImage(im, 0, 0, c.width, c.height);
                    c.toBlob((b) => resolve(b ? URL.createObjectURL(b) : null), 'image/webp', 0.94);
                } catch (_) { resolve(null); }
            };
            im.onerror = () => resolve(null);
            im.src = u;
        });
        return lruPut(sizedCache, k, pr, SIZED_MAX);
    }
    function blurPicture() {
        if (!wallEl || !(fx.blur || fx.startfrost)) return;
        const w = wallEl.style;
        const key = `${wallEl.hidden}|${w.backgroundImage}|${w.backgroundSize}|${w.backgroundPosition}|${w.backgroundRepeat}`;
        if (key === blurKey) return; // the per-frame property writes land here too: nothing to redo
        blurKey = key;
        const img = w.backgroundImage;
        const urls = wallEl.hidden || !img ? [] : [...img.matchAll(/url\((['"]?)(.*?)\1\)/g)].map((m) => m[2]);
        if (!urls.length) { if (blurClip) blurClip.hidden = true; if (frostLayer) { frostLayer.classList.remove('is-ready'); wallEl.classList.remove('has-frost'); } return; }
        Promise.all(urls.map(blurredUrl)).then((outs) => {
            if (key !== blurKey || !outs.some(Boolean)) return;
            let out = img;
            urls.forEach((u, i) => { if (outs[i]) out = out.split(u).join(outs[i]); });
            const bg = { backgroundImage: out, backgroundSize: w.backgroundSize, backgroundPosition: w.backgroundPosition, backgroundRepeat: w.backgroundRepeat };
            if (frostLayer) { Object.assign(frostLayer.style, bg); frostLayer.classList.add('is-ready'); wallEl.classList.add('has-frost'); }
            if (blurClip && fx.blur) {
                Object.assign(blurInner.style, bg);
                blurClip.hidden = false;
                blurPlace();
            }
            if (blobRetired.size) sweepRetired();
        });
    }
    /** The picture at 320 px wide, blurred 5 px with its edges carried out (no dark rim), as a WebP blob. */
    function blurredUrl(u) {
        const had = lruGet(blurCache, u);
        if (had) return had;
        const pr = new Promise((resolve) => {
            const im = new Image();
            im.decoding = 'async';
            // the app's Android wallpaper (appassets.androidplatform.net, sent with Allow-Origin *) is
            // another origin: without CORS the canvas is tainted and gives no blur (Fold7, Nov 15)
            if (!/^(blob|data):/.test(u)) im.crossOrigin = 'anonymous';
            im.onload = () => {
                try {
                    const W = Math.max(1, Math.min(320, im.naturalWidth));
                    const H = Math.max(1, Math.round(im.naturalHeight * W / im.naturalWidth));
                    const m = 12;
                    const c = document.createElement('canvas');
                    c.width = W + 2 * m; c.height = H + 2 * m;
                    const x = c.getContext('2d');
                    x.drawImage(im, m, m, W, H);
                    x.drawImage(c, m, m, 1, H, 0, m, m, H);
                    x.drawImage(c, m + W - 1, m, 1, H, m + W, m, m, H);
                    x.drawImage(c, 0, m, c.width, 1, 0, 0, c.width, m);
                    x.drawImage(c, 0, m + H - 1, c.width, 1, 0, m + H, c.width, m);
                    const o = document.createElement('canvas');
                    o.width = W; o.height = H;
                    const y = o.getContext('2d');
                    y.filter = 'blur(5px)';
                    y.drawImage(c, -m, -m);
                    o.toBlob((b) => resolve(b ? URL.createObjectURL(b) : null), 'image/webp', 0.85);
                } catch (_) { resolve(null); }
            };
            im.onerror = () => resolve(null);
            im.src = u;
        });
        return lruPut(blurCache, u, pr, BLUR_MAX);
    }
    /** Line the band's copy up with the picture layer (on show, resize and a new picture only). */
    function blurPlace() {
        if (!blurClip || blurClip.hidden || !wallEl) return;
        const w = wallEl.getBoundingClientRect();
        const c = blurClip.getBoundingClientRect();
        if (!w.width || !c.width) return;
        Object.assign(blurInner.style, { left: `${w.left - c.left}px`, top: `${w.top - c.top}px`, width: `${w.width}px`, height: `${w.height}px` });
    }

    /** The picture settles from a slight zoom (the entrance). */
    function breathe() {
        if (!fx.breathe || !ensureWall()) return;
        // a Web Animation, not a class restarted through a forced layout: the entrance's first frame
        // after a return paid for three whole-page layouts that way (A53 trace, Nov 15: 170 ms)
        for (const el of [fxLayer, blurInner]) {
            if (!el || typeof el.animate !== 'function') continue;
            try { el.animate([{ scale: '1.035' }, { scale: '1' }], { duration: 900, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }); } catch (_) { /* no Web Animations */ }
        }
    }

    /**
     * Ready the return (Yukimi, Nov 15: no stale frame and jump coming home): Today takes the
     * entrance's first pose, the picture and the empty band with the list gone, so whatever Android
     * shows of the page while it comes back (its snapshot, the last frame) is where the entrance
     * starts. The Android app calls it as Melaton goes behind another program (before the WebView is
     * paused); the screen going off does too. The next entrance, or Today being shown, clears it.
     */
    function prime(opts) {
        // a program started from the Start menu: Start closes as the program comes up, as on Windows Mobile, so the
        // way back is Today's entrance, not a moment of the Start menu first (Yukimi, Nov 18)
        if (!(opts && opts.screenOff) && root.dataset.wmApp === 'start' && sh && typeof sh.back === 'function') { try { sh.back({ app: true }); } catch (_) { /* stays */ } }
        if (!host || host.hidden || root.dataset.wmApp !== 'today') return false;
        host.classList.add('is-primed');
        primedAt = Date.now();
        // nothing went over Melaton after all (a permission prompt pauses the app too): Today shows again
        const at = primedAt;
        setTimeout(() => { if (!focusWait && primedAt === at && document.visibilityState === 'visible' && root.dataset.screenOff === undefined) unprime(); }, 2500);
        return true;
    }
    let primedAt = 0;
    function unprime() {
        if (!host) return;
        host.classList.remove('is-primed');
        primedAt = 0;
    }

    /** The glass catches the light as the list lands. */
    function catchLight() {
        if (!fx.catch || !host) return;
        const band = host.querySelector('.wm-ti-band');
        if (!band || typeof band.animate !== 'function') return;
        // the band's ::after sheen as a Web Animation (no forced layout to restart it)
        try { band.animate([{ opacity: 0 }, { opacity: 1, offset: 0.35 }, { opacity: 0 }], { duration: 600, easing: 'ease-in-out', pseudoElement: '::after' }); } catch (_) { /* no pseudo-element animations */ }
    }

    /** Haptics: 'tick' as an item crosses the band, 'land' when the list stops (the Vibration tab's level). */
    function haptic(kind) {
        if (!fx.haptics || !sh || typeof sh.vibrate !== 'function') return;
        try { sh.vibrate(kind); } catch (_) { /* no motor */ }
    }

    readEffects();
    readTextWeights();
    document.addEventListener('wmSettingsChange', (e) => {
        const keys = (e && e.detail && e.detail.keys) || [];
        if (keys.includes(ROW_WEIGHT_KEY) || keys.includes(BAND_WEIGHT_KEY) || keys.includes('wmSystemFont')) readTextWeights();
        if (keys.includes(PARALLAX_KEY) || keys.includes(PARALLAX_LEVEL_KEY) || keys.includes(FX_KEY)) { readEffects(); if (host && !host.hidden) place(); }
        if (keys.includes('wmSuperBarNotes') && superOpen) refreshNotes();
    });

    /** Place every row for the list position `pos` (rows) around the band. */
    function place() {
        parallax(pos);
        const top = focusTop();
        const e = (pos - sel) * ROW;
        const rest = !dragging && !settle;
        host.style.setProperty('--wm-ti-top', String(top));
        host.classList.toggle('is-rest', rest);
        panels.forEach((p, i) => {
            const el = rowEl.get(p.id);
            if (!el) return;
            el.classList.remove('is-under');
            if (el.style.opacity) el.style.opacity = '';
            let y;
            if (i < sel) y = top - ROW * (sel - i) - e;
            else if (i > sel) y = top + BAND + ROW * (i - sel - 1) - e;
            else y = top + (BAND - ROW) / 2;
            el.style.transform = `translate3d(0, calc(${y} * var(--wm-px)), 0)`;
            el.classList.toggle('is-sel', i === sel);
            const d = Math.abs(i - sel);
            el.dataset.far = rest ? String(Math.min(d, 3)) : '0';
        });
    }

    function lineHtml(cls, text) {
        return text ? `<div class="wm-ti-line ${cls}">${esc(text)}</div>` : '';
    }

    /** One page of a panel as markup (positions are the layout's, inside the 480 x 164 expanded box). */
    function pageHtml(p, pg, opts = {}) {
        const icon = pg.icon || p.icon;
        // the clock's icon: the live analog clock (the art's face without its hands, ti-2051-face, and
        // three hands turned once a second) only in the Super Bar; the idle Today shows the device's
        // own static clock icon (Yukimi, Nov 15: the live one kept the phones drawing and hot)
        const wxImg = (u1, u2, cls) => `<img class="${cls}" src="${esc(u1)}" srcset="${esc(u1)} 1x, ${esc(u2 || u1)} 2x, ${esc(String(u2 || u1).replace('@2x.png', '@4x.png'))} 4x" alt="" draggable="false">`;
        // the forecast pages of the clock: a row of cells (an hour or a day, its icon, its temperature)
        if (pg.cells) {
            return `<div class="wm-ti-cells">${pg.cells.map((c) => `<span class="wm-ti-cell"><span>${esc(c.label)}</span>${wxImg(c.iconUrl, c.iconUrl2x, '')}<span>${esc(c.value)}${c.sub ? ` <i>${esc(c.sub)}</i>` : ''}</span></span>`).join('')}</div>`;
        }
        // the clock with the weather: the condition icon in the clock icon's place (the Super Bar keeps
        // its live clock under it, faded in as the bar opens)
        const iconHtml = p.clock && pg.wx ? wxImg(pg.wx.iconUrl, pg.wx.iconUrl2x, 'wm-ti-icon wm-ti-wxicon') + (opts.live ? liveClockHtml() : '')
            : icon === 'ti-2051' && pg.time && opts.live ? liveClockHtml()
                : icon ? `<img class="wm-ti-icon" src="${esc(artUrl(icon))}" srcset="${esc(artSet(icon))}" alt="" draggable="false">` : '';
        if (p.clock) {
            // the weather's line above the date, after an invisible copy of AM / PM (12-hour clocks)
            const wx = pg.wx ? `<div class="wm-ti-wx">${pg.ampm ? `<span class="wm-ti-ph">${esc(pg.ampm)} </span>` : ''}${esc(pg.wx.temp != null ? `${pg.wx.temp}\u00b0 ` : '')}${esc(pg.wx.condition || '')}</div>` : '';
            return `${iconHtml}<div class="wm-ti-time">${esc(pg.time)}</div><div class="wm-ti-ampm">${esc(pg.ampm)}</div>${wx}
                <div class="wm-ti-date">${esc(pg.date)}</div><div class="wm-ti-network">${esc(pg.network)}</div>`;
        }
        const lines = [pg.title, pg.line2, pg.line3].filter(Boolean).length;
        // a wide picture keeps its shape (Yukimi, Nov 17, #903: a video's thumbnail, a barcode): pg.imageAspect
        // (width / height, or 'auto' = the picture's own once it loaded) widens the box, the lines follow it
        const ar = pg.image ? picAspect(pg.image, pg.imageAspect) : null;
        const wide = ar ? picWideStyle(ar) : '';
        const pic = pg.image ? `<span class="wm-ti-pic"${pg.imageAspect === 'auto' ? ` data-auto-src="${esc(pg.image)}"` : ''} style="background-image:url('${esc(pg.image)}')"></span>` : '';
        const small = !pg.image && pg.smallIcon ? `<img class="wm-ti-small" src="${esc(artUrl(pg.smallIcon))}" srcset="${esc(artSet(pg.smallIcon))}" alt="" draggable="false">` : '';
        // pg.bare: a picture without the white frame (the Music panel's album art and Play All Songs tile)
        return `${iconHtml}<div class="wm-ti-text" data-lines="${lines}"${pg.image ? ` data-pic="${pg.bare ? 'bare' : '1'}"` : ''}${small ? ' data-small="1"' : ''}${wide ? ` style="${wide}"` : ''}>${pic}${small}
            ${lineHtml('is-1', pg.title)}${lineHtml('is-2', pg.line2)}${lineHtml('is-3', pg.line3)}</div>`;
    }

    // The live clock's hands move once a second (#800 look kept: the hour and minute hands where they
    // belong, the second hand stepping with its quartz jiggle). Its hands were three infinite CSS
    // animations, and an infinite animation draws a frame on every display refresh: both phones ran
    // Today at 120 fps untouched and reached thermal status 2 (Yukimi, Nov 15: "the fold is getting
    // pretty hot"). Now one timer per second, only while a clock is on screen; the jiggle is a 220 ms
    // animation, so the phone draws for a fifth of each second.
    function clockAngles(d) {
        const s = d.getSeconds();
        const m = d.getMinutes() * 60 + s;
        const h = (d.getHours() % 12) * 3600 + m;
        return { h: (h / 43200) * 360, m: (m / 3600) * 360, s: s * 6 };
    }
    const TICK_FRAMES = [[0, -6], [50, 1.6], [100, -0.7], [160, 0.25], [220, 0]];
    let clockTimer = null;
    function clocksOnScreen() {
        if (document.hidden || document.documentElement.dataset.screenOff !== undefined) return [];
        return Array.from(document.querySelectorAll('.wm-ti-aclock')).filter((c) => c.isConnected && !c.closest('[hidden]'));
    }
    function tickClocks() {
        clockTimer = null;
        const clocks = clocksOnScreen();
        if (!clocks.length) return; // started again when one is drawn or the screen comes back
        const a = clockAngles(new Date());
        for (const c of clocks) {
            if (c.dataset.swing) continue; // its hands are swinging to the time or home (swingHands)
            const ah = c.querySelector('.wm-ti-ah');
            const am = c.querySelector('.wm-ti-am');
            const as = c.querySelector('.wm-ti-as');
            const set = (el, deg) => { const t = `rotate(${deg.toFixed(2)}deg)`; if (el && el.style.transform !== t) el.style.transform = t; };
            set(ah, a.h);
            set(am, a.m);
            if (as) {
                set(as, a.s);
                if (typeof as.animate === 'function' && c.dataset.lastSec !== String(a.s)) {
                    c.dataset.lastSec = String(a.s);
                    as.animate(TICK_FRAMES.map(([at, off]) => ({ offset: at / 220, transform: `rotate(${(a.s + off).toFixed(2)}deg)` })), { duration: 220, easing: 'linear' });
                }
            }
        }
        clockTimer = setTimeout(tickClocks, 1000 - (Date.now() % 1000) + 5);
    }
    // Where the static clock icon's hands point (ti-2051 art: hour at 9, minute at 1:30, second at 25 s).
    // Opening the Super Bar swings the live hands from there to the time; closing swings them home
    // (Yukimi, Nov 15), over the bar's own opening / closing time.
    const CLOCK_HOME = { h: 270, m: 45, s: 151 };
    const HAND_SEL = { h: '.wm-ti-ah', m: '.wm-ti-am', s: '.wm-ti-as' };
    function swingHands(aclock, toTime, opt) {
        if (!aclock || typeof aclock.animate !== 'function') return [];
        const now = clockAngles(new Date());
        const fwd = (a, b) => ((b - a) % 360 + 360) % 360; // clockwise distance a -> b
        aclock.dataset.swing = '1';
        const anims = [];
        for (const k of Object.keys(HAND_SEL)) {
            const el = aclock.querySelector(HAND_SEL[k]);
            if (!el) continue;
            // forward to the time on open; back the same way on close
            const from = toTime ? CLOCK_HOME[k] : now[k];
            const to = toTime ? CLOCK_HOME[k] + fwd(CLOCK_HOME[k], now[k]) : now[k] - fwd(CLOCK_HOME[k], now[k]);
            el.style.transform = `rotate(${to.toFixed(2)}deg)`;
            anims.push(el.animate([{ transform: `rotate(${from.toFixed(2)}deg)` }, { transform: `rotate(${to.toFixed(2)}deg)` }], opt));
        }
        Promise.all(anims.map((a) => a.finished)).then(() => {
            delete aclock.dataset.swing;
            if (toTime) { anims.forEach((a) => a.cancel()); ensureClockTick(); }
        }, () => { delete aclock.dataset.swing; });
        return anims;
    }

    function ensureClockTick() {
        if (clockTimer) return;
        clockTimer = setTimeout(tickClocks, 0);
    }
    document.addEventListener('visibilitychange', () => { if (!document.hidden) ensureClockTick(); });
    window.addEventListener('melatonscreen', (e) => { if (e && e.detail && e.detail.on) ensureClockTick(); });
    document.addEventListener('wmAppChange', () => ensureClockTick());

    function liveClockHtml() {
        const a = clockAngles(new Date());
        ensureClockTick();
        const rot = (deg) => `transform:rotate(${deg.toFixed(2)}deg)`;
        return `<span class="wm-ti-icon wm-ti-aclock" aria-hidden="true">`
            + `<img src="${esc(artUrl('ti-2051-face'))}" srcset="${esc(artSet('ti-2051-face'))}" alt="" draggable="false">`
            + `<i class="wm-ti-ah" style="${rot(a.h)}"></i><i class="wm-ti-am" style="${rot(a.m)}"></i><i class="wm-ti-as" style="${rot(a.s)}"></i><b></b>`
            // the art's glass sheen (its light wedge and two fine lines) over the hands, as on a real clock
            + `<img class="wm-ti-aglass" src="${esc(artUrl('ti-2051-gloss'))}" srcset="${esc(artSet('ti-2051-gloss'))}" alt="" draggable="false"></span>`;
    }

    function pageIndex(p) {
        const at = pageAt.get(p.id) || 0;
        return at < p.pages.length ? at : 0;
    }

    let expKey = '';
    function drawExpanded() {
        const p = panels[sel];
        const exp = host.querySelector('.wm-ti-exp');
        if (!p) { exp.innerHTML = ''; expKey = ''; return; }
        const n = p.pages.length;
        const at = pageIndex(p);
        const pg = p.pages[at];
        const key = JSON.stringify([p.id, p.icon, at, n, pg.time, pg.ampm, pg.date, pg.network, pg.title, pg.line2, pg.line3, pg.image, pg.bare, pg.smallIcon, pg.icon, pg.wx, pg.cells]);
        host.querySelectorAll('.wm-ti-arrow').forEach((a) => { a.hidden = n < 2; });
        if (n > 1 && key !== expKey) arrowsAwake();
        if (slide.active || key === expKey) return; // a page on its way keeps what it shows
        // Effects > digits: the clock in the band at rest keeps its time and only the changed digits
        // roll; a forced redraw (expKey cleared: the entrance, Home) or another panel just draws
        const oldTime = expKey && p.clock && exp.dataset.panel === p.id ? (exp.dataset.time || '') : '';
        expKey = key;
        exp.dataset.panel = p.id;
        exp.dataset.time = p.clock ? (pg.time || '') : '';
        exp.innerHTML = `<div class="wm-ti-pg">${pageHtml(p, pg)}</div>`;
        if (fx.digits && oldTime && pg.time && oldTime !== pg.time && host.classList.contains('is-rest') && !zoomTimer) rollDigits(exp.querySelector('.wm-ti-time'), oldTime, pg.time);
        // the pages either side slide in with their picture already loaded
        if (n > 1) for (const d of [1, -1]) { const im = p.pages[(at + d + n) % n].image; if (im) { const pre = new Image(); pre.decoding = 'async'; pre.src = im; } }
    }

    /** The time's changed characters roll: the old one up and out, the new one up from below (right aligned: compared from the end). */
    function rollDigits(el, from, to) {
        if (!el) return;
        const a = [...from];
        const b = [...to];
        const off = b.length - a.length;
        el.innerHTML = b.map((ch, i) => {
            const old = a[i - off];
            if (old === ch) return esc(ch);
            return `<span class="wm-ti-dg"><span class="wm-ti-dg-in">${esc(ch)}</span>${old != null ? `<span class="wm-ti-dg-out">${esc(old)}</span>` : ''}</span>`;
        }).join('');
    }

    // Left / right on a panel with pages (emulator, "getting started", sampled every 15-40 px): after
    // 45 px of travel the page, its text and its icon, follows the finger 1:1 and the next one follows
    // a screen width behind (the pages go round); the arrows are gone while it moves; let go past half
    // the width and it carries on to the next page, short of it the page slides back.
    const slide = { active: false, dir: 0, x: 0, raf: 0 };

    /**
     * A panel's page arrows fade 5 s after it arrives or its page turns, and come back with the next
     * swipe or turn (Yukimi, Nov 15: on all items).
     */
    let arrowsTimer = 0;
    function arrowsAwake() {
        if (!host) return;
        host.classList.remove('arrows-idle');
        clearTimeout(arrowsTimer);
        arrowsTimer = setTimeout(() => { if (host) host.classList.add('arrows-idle'); }, 5000);
    }

    function slideBegin(dir) {
        const p = panels[sel];
        if (!p || p.pages.length < 2) return false;
        arrowsAwake();
        const exp = host.querySelector('.wm-ti-exp');
        const cur = exp.querySelector('.wm-ti-pg');
        if (!cur) return false;
        if (slide.active && slide.dir === dir) return true;
        exp.querySelectorAll('.wm-ti-pg.is-next').forEach((el) => el.remove());
        const n = p.pages.length;
        const next = document.createElement('div');
        next.className = 'wm-ti-pg is-next';
        next.innerHTML = pageHtml(p, p.pages[(pageIndex(p) + dir + n) % n]);
        exp.appendChild(next);
        slide.active = true;
        slide.dir = dir;
        host.classList.add('is-sliding');
        return true;
    }

    /** x: how far the page has moved, px (negative = to the left, the next page comes from the right). */
    function slideMove(x) {
        const dir = x < 0 ? 1 : -1;
        if (!slideBegin(dir)) return;
        slide.x = x;
        const exp = host.querySelector('.wm-ti-exp');
        const w = host.clientWidth;
        const cur = exp.querySelector('.wm-ti-pg:not(.is-next)');
        const next = exp.querySelector('.wm-ti-pg.is-next');
        if (cur) cur.style.transform = `translate3d(${x}px, 0, 0)`;
        if (next) next.style.transform = `translate3d(${x + dir * w}px, 0, 0)`;
    }

    /** Finish a slide: on to the next page (commit) or back, eased; then the panel is redrawn. */
    function slideEnd(commit) {
        if (!slide.active) return;
        cancelAnimationFrame(slide.raf);
        const w = host.clientWidth;
        const from = slide.x;
        const dir = slide.dir;
        const to = commit ? -dir * w : 0;
        const ms = Math.max(120, Math.min(320, 320 * Math.abs(to - from) / w));
        const t0 = performance.now();
        const done = () => {
            const p = panels[sel];
            if (commit && p) { const n = p.pages.length; pageAt.set(p.id, (pageIndex(p) + dir + n) % n); }
            slide.active = false;
            slide.x = 0;
            host.classList.remove('is-sliding');
            expKey = '';
            drawExpanded();
            if (commit) sh.refreshSoftKeys(); // a page can bring its own right soft key
        };
        const step = (now) => {
            const k = Math.min(1, (now - t0) / ms);
            const eased = 1 - (1 - k) * (1 - k);
            slideMove(from + (to - from) * eased || (dir > 0 ? -0.01 : 0.01));
            if (k < 1) slide.raf = requestAnimationFrame(step); else done();
        };
        slide.raf = requestAnimationFrame(step);
    }

    /** The arrows and the left / right keys: the same slide, run on its own. */
    function turnPage(dir) {
        const p = panels[sel];
        if (!p || p.pages.length < 2 || slide.active) return;
        if (!slideBegin(dir)) return;
        slide.x = 0;
        slideEnd(true);
    }

    function select(i, animate) {
        i = Math.max(0, Math.min(panels.length - 1, i));
        if (!animate) {
            enterLockUntil = 0;
            host.classList.remove('is-entering');
            cancelAnimationFrame(settle); settle = 0; tw = null;
            clearTimeout(zoomTimer); zoomTimer = 0; host.classList.remove('is-zoom', 'is-zoom-enter');
            sel = i; pos = i; skSel = i; place(); drawExpanded(); sh.refreshSoftKeys();
            return;
        }
        // a second key while the list still moves: the first move is over at once (device: three
        // down keys 100 ms apart each landed on their item)
        if (tw) { const b = tw.b; cancelAnimationFrame(settle); settle = 0; tw = null; sel = b; pos = b; }
        if (i === sel) { if (host.classList.contains('is-rest')) return; place(); drawExpanded(); zoomIn(); return; }
        startTween(sel, i, { tap: true });
    }

    // ---------------------------------------------------------------- the list's own move
    //
    // What the device does once the finger is off (rows found in device frames, rec/ + col*.txt in
    // the #748 scroll study):
    //   - the item that was in the band (a) and the one the move ends on (b) are fixed at the lift.
    //     A flick goes round(5.9 x finger speed in px/ms) items from a, whatever the finger's
    //     offset was; under 0.16 px/ms, or after a pause, it is not a flick and b = a. At an end
    //     of the list the move keeps the pace of the items it asked for and stops at the last one.
    //   - the list is then a plain stack: every item one row high, a's slot shrinking from the
    //     band's height and b's growing to it by the same progress p that carries b's row to the
    //     band; labels sit at the top of their slots, dim under the glass; b's own label fades
    //     out as it arrives.
    //   - p runs on a clock, not from the finger's speed: (t / T) ^ 0.57 with T = 30 + 175 n ms for
    //     n items, so a long flick starts at about 9 items a second, is at 3.5 when it stops, and
    //     it stops without easing to rest; nothing overshoots, at the ends either. The device
    //     shows its first frame of this about 100 ms after the lift, where the curve is already
    //     past where the finger left the list; drawn at a phone's frame rate the list waits
    //     where the finger left it until the curve reaches that point (p0), then follows it.
    //   - b = a: the list returns in 310 ms from any offset, slow - fast - slow.
    //   - a tap on another item and the up / down keys use the same stack at 45 ms an item.
    //   - a touch does not stop the move. A tap on an item while it runs ends it on the next item
    //     to reach the band; a tap on the band lets it finish and opens the item it ends on; a
    //     finger that travels the drag distance takes the list over where it is.
    // None of these times is scaled: the same lifts gave the same positions at every recorder
    // rate, and they hold from 1 to 8 items.

    /** Start the move from item a to item b. o.tap: a tap or key; o.nv: the items the flick asked for; o.at: when (ms). */
    // a frame this late is a hold-up (the page busy waking): the entrance's clock waits it out, keeping STALL_KEEP_MS
    // of it. Slower frames run on the real clock: a phone drawing 10-15 frames a second while it wakes (A53) ran
    // the rise four times slow when every late frame counted (50 ms)
    const STALL_MS = 120;
    const STALL_KEEP_MS = 50;
    function startTween(a, b, o) {
        cancelAnimationFrame(settle);
        flushZoom();
        const n = Math.abs(b - a);
        const e = (pos - a) * ROW; // where the finger left the list: units past a's place, + toward later items
        // the clock starts when the finger left the glass, not when the event got here
        const back = (o && o.backMs) || BACK_MS;
        tw = { a, b, n, e0: e, D: 0, p: 0, p0: 0, gain: 1, Tv: 0, end: back, back, ease: (o && o.ease) || null, t0: (o && o.at) || performance.now(), open: false, nv: n, entry: null, x: 0 };
        // the entrance's effects: rows spread below (the cascade, S units more per row, closing up as
        // they land) and a spring past the band (bump units at most, in the run's last 40 %; the list is still a few units
        // short of the band then, so it passes it by about half the bump)
        if (o && o.entry && !n) tw.entry = { spread: o.entry.stagger ? 14 : 0, bump: o.entry.overshoot ? 10 : 0 };
        // the entrance runs on its own frames' clock (Yukimi, Nov 18 recording: "not fluid"): it starts at its first
        // drawn frame and a late frame (the page busy waking) moves its start on, so a stall pauses the run instead
        // of skipping it - the list had shown up already halfway up, 250 ms into a 550 ms run. A finger's fling
        // keeps the real clock (its start is when the finger left the glass)
        if (tw.entry) tw.frameClock = { last: 0 };
        if (n) {
            const nv = Math.max(n, (o && o.nv) || n);
            tw.D = b > a ? BAND + ROW * (n - 1) : ROW * n;                 // b's row to the band top, from a's rest layout
            tw.nv = nv;
            tw.gain = (tw.D + ROW * (nv - n)) / tw.D;
            tw.Tv = o && o.tap ? TAP_ROW_MS * nv : FLING_BASE_MS + FLING_ROW_MS * nv;
            tw.end = tw.Tv * Math.pow(1 / tw.gain, 1 / FLING_POW);
            tw.p0 = Math.max(0, Math.min(0.999, (b > a ? e : -e) / tw.D));
            tw.p = tw.p0;
        }
        sel = a;
        placeTween(tw.p, 1);
        settle = requestAnimationFrame(tweenStep);
    }

    function tweenStep(now) {
        if (!tw) return;
        const fc = tw.frameClock;
        if (fc) {
            if (!fc.last) tw.t0 = now;
            else if (now - fc.last > STALL_MS) tw.t0 += now - fc.last - STALL_KEEP_MS;
            fc.last = now;
        }
        const t = Math.max(0, now - tw.t0);
        let p;
        if (tw.n) p = Math.max(tw.p0, Math.min(1, tw.gain * Math.pow(t / tw.Tv, FLING_POW)));
        else if (tw.ease) { tw.x = Math.min(1, t / (tw.back || BACK_MS)); p = tw.ease(tw.x); }
        else { const k = Math.pow(Math.min(1, t / (tw.back || BACK_MS)), 1.3); p = k * k * (3 - 2 * k); } // 13 %, 65 %, 100 % of the way at 103, 206, 310 ms
        if (t >= tw.end || p >= 1) { arrive(); return; }
        tw.p = p;
        placeTween(p, Math.min(1, (tw.end - t) / FADE_MS));
        settle = requestAnimationFrame(tweenStep);
    }

    /** Row tops (WM units) of the stack at progress p of the move. */
    function tweenYs(top, p) {
        const { a, b, n } = tw;
        const ys = new Array(panels.length);
        if (a === b) {
            let e = tw.e0 * (1 - p);
            const en = tw.entry;
            const sg = Math.sign(tw.e0) || -1;
            if (en && en.bump) { const u = Math.max(0, Math.min(1, (tw.x - 0.6) / 0.4)); e -= sg * en.bump * Math.sin(Math.PI * u); }
            for (let i = 0; i < ys.length; i++) {
                // the cascade: each row further out by `spread` units than the one above, gone as p reaches 1
                const ei = en && en.spread ? e + sg * en.spread * i * (1 - p) : e;
                ys[i] = i <= a ? top - ei - ROW * (a - i) : top - ei + BAND + ROW * (i - a - 1);
            }
            return ys;
        }
        const grow = ROW + EXTRA * p;         // b's slot
        const shrink = ROW + EXTRA * (1 - p); // a's slot
        if (b > a) {
            const yb = top + tw.D * (1 - p);
            const ya = yb - ROW * (n - 1) - shrink;
            for (let i = 0; i < ys.length; i++) ys[i] = i > b ? yb + grow + ROW * (i - b - 1) : i > a ? yb - ROW * (b - i) : ya - ROW * (a - i);
        } else {
            const yb = top - tw.D * (1 - p);
            const ya = yb + grow + ROW * (n - 1);
            for (let i = 0; i < ys.length; i++) ys[i] = i <= b ? yb - ROW * (b - i) : i < a ? yb + grow + ROW * (i - b - 1) : i === a ? ya : ya + shrink + ROW * (i - a - 1);
        }
        return ys;
    }

    /** Draw the stack: transforms only. fade: what is left of the arriving label (1 .. 0). */
    function placeTween(p, fade) {
        const top = focusTop();
        const ys = tweenYs(top, p);
        parallax(tw.n ? tw.a + (tw.b - tw.a) * p : tw.a + tw.e0 * (1 - p) / ROW);
        host.style.setProperty('--wm-ti-top', String(top));
        host.classList.remove('is-rest');
        // the entrance (#800) fades every row in to the dimness it keeps at rest (its distance from the
        // band), not to full, so nothing drops darker once the list has settled (Yukimi, Nov 15)
        const entering = host.classList.contains('is-entering');
        let underNow = -1;
        panels.forEach((pn, i) => {
            const el = rowEl.get(pn.id);
            if (!el) return;
            const y = ys[i];
            el.style.transform = `translate3d(0, calc(${y} * var(--wm-px)), 0)`;
            const under = y + ROW / 2 > top && y + ROW / 2 < top + BAND;
            if (under) underNow = i;
            el.classList.toggle('is-under', under);
            el.classList.remove('is-sel');
            const far = entering ? String(Math.min(Math.abs(i - tw.b), 3)) : '0';
            if (el.dataset.far !== far) el.dataset.far = far;
            const o = i === tw.b && fade < 1 ? String(Math.round(fade * (under ? 55 : 100)) / 100) : '';
            if (el.style.opacity !== o) el.style.opacity = o;
        });
        // a tick as another item crosses into the glass (not while Today comes back)
        if (!entering && underNow >= 0 && underNow !== lastUnder) haptic('tick');
        lastUnder = underNow;
    }
    let lastUnder = -1;

    /** The move is over: b is in the band, its panel grows in. */
    function arrive() {
        const b = tw.b;
        const open = tw.open;
        const entering = host.classList.contains('is-entering');
        host.classList.remove('is-entering');
        cancelAnimationFrame(settle);
        settle = 0;
        tw = null;
        sel = b;
        pos = b;
        place();
        drawExpanded();
        if (entering || homeArrival) catchLight();
        haptic('land');
        lastUnder = -1;
        zoomIn(open, entering);
    }

    /** A tap on an item while the list runs: it ends on the next item to reach the band. */
    function stopAtNext() {
        if (!tw || !tw.n) return;
        const top = focusTop();
        const ys = tweenYs(top, tw.p);
        const dir = tw.b > tw.a ? 1 : -1;
        let j = tw.b;
        for (let i = tw.a + dir; i !== tw.b; i += dir) { if (dir > 0 ? ys[i] >= top : ys[i] <= top) { j = i; break; } }
        if (j === tw.b) return;
        const n = Math.abs(j - tw.a);
        const D = dir > 0 ? BAND + ROW * (n - 1) : ROW * n;
        const p = Math.max(0.001, Math.min(0.999, 1 - Math.abs(ys[j] - top) / D));
        const T = FLING_BASE_MS + FLING_ROW_MS * n;
        Object.assign(tw, { b: j, n, D, gain: 1, Tv: T, end: T, p0: p, p, t0: performance.now() - T * Math.pow(p, 1 / FLING_POW) });
    }

    /** A finger takes the running list over: the item nearest the band is the one it holds. */
    function takeOver() {
        if (!tw) return sel;
        const top = focusTop();
        const ys = tweenYs(top, tw.p);
        let best = tw.a;
        ys.forEach((y, i) => { if (Math.abs(y - top) < Math.abs(ys[best] - top)) best = i; });
        cancelAnimationFrame(settle);
        settle = 0;
        tw = null;
        sel = best;
        pos = best;
        return best;
    }

    /**
     * The panel arriving in the band. Device: the band is empty until the list stops, then the
     * whole panel, text and icon as one picture, is there at 80 % about the middle of the band and
     * grows evenly to full size in 150 ms (text bounds against the full-size frame: 0.85 at 35 ms,
     * 0.94 at 100, 0.97 at 127, 0.98 at 139, 1 by 210; the anchor came out at x 221 - 250 of 480,
     * y 322 - 344 where the band's middle is 320); so the text moves out toward the left edge and
     * the icon toward the right. It plays after every move, a return to the same item included.
     * The right soft key changes 210 - 230 ms after the stop; a tap made on the band while the
     * list ran opens the item then.
     */
    let zoomTimer = 0;
    function zoomIn(open, entering) {
        // after the entrance or a Home press (#800): the bigger grow with the panel fading in
        entering = !!entering || homeArrival;
        homeArrival = false;
        clearTimeout(zoomTimer);
        // restart the grow only when one is still running (a forced layout otherwise for nothing)
        if (host.classList.contains('is-zoom') || host.classList.contains('is-zoom-enter')) {
            host.classList.remove('is-zoom', 'is-zoom-enter');
            void host.offsetWidth;
        }
        // after the entrance (#800): a bigger grow with the panel fading in, so it reads after the run
        host.classList.add(entering ? 'is-zoom-enter' : 'is-zoom');
        zoomTimer = setTimeout(() => {
            zoomTimer = 0;
            host.classList.remove('is-zoom', 'is-zoom-enter');
            skSel = sel;
            sh.refreshSoftKeys();
            if (open) openSelected();
            // what came in while the list moved (a refresh it skipped) draws now it has landed and grown in
            else if (missed && page && sh.current === 'today' && !dragging && !settle) { missed = false; view.refresh(page); }
        }, (entering ? ENTER_ZOOM_MS : ZOOM_MS) + KEY_MS);
    }

    /** The list moves on before the panel has finished arriving: its soft key is up at once. */
    function flushZoom() {
        if (!zoomTimer) return;
        clearTimeout(zoomTimer);
        zoomTimer = 0;
        host.classList.remove('is-zoom', 'is-zoom-enter');
        skSel = sel;
        sh.refreshSoftKeys();
    }

    function openSelected() {
        const p = panels[sel];
        const pg = p && p.pages[pageIndex(p)];
        const act = (pg && pg.onTap) || (p && p.onTap);
        if (typeof act !== 'function') return;
        // the panel opens on the pen's lift; the click that follows it must not land on the program
        // that has just come up (a tap on the IE panel went on to follow a link on IE's start page)
        // (the finger's own click only: a panel whose tap is its Today row's click, as Notes', sends a
        // made one, and eating that left the panel dead)
        const eat = (e) => { if (!e.isTrusted) return; window.removeEventListener('click', eat, true); e.stopPropagation(); e.preventDefault(); };
        window.addEventListener('click', eat, true);
        const run = () => {
            setTimeout(() => window.removeEventListener('click', eat, true), 400);
            try { act(pg); } catch (err) { console.warn('[wmTitanium] tap', p.id, err); }
        };
        // Effects > exit: the list drops away first (170 ms, no input meanwhile); still on Today after
        // the program's open (a box, a menu) it comes back
        if (!fx.exit || host.hidden || (p.clock && fx.superbar)) { run(); return; }
        host.classList.add('is-exiting');
        enterLockUntil = performance.now() + 200;
        setTimeout(() => {
            run();
            setTimeout(() => { if (root.dataset.wmApp === 'today' && document.visibilityState === 'visible') host.classList.remove('is-exiting'); }, 450);
        }, 170);
    }

    /** List position p (rows): the selection moves on once the next item has travelled a whole row. */
    function moveTo(p) {
        pos = Math.max(0, Math.min(panels.length - 1, p));
        const was = sel;
        while (pos - sel >= 1) sel++;
        while (pos - sel <= -1) sel--;
        if (sel !== was) haptic('tick');
    }

    function bindPointer() {
        let id = null;
        let y0 = 0;
        let x0 = 0;
        let pos0 = 0;
        let axis = '';   // '' until the travel passes a start distance, then 'y' (the list) or 'x' (the pages)
        let lastX = 0;
        let lastT = 0;
        let velX = 0; // px per ms
        let inBand = false;
        let trail = [];  // the finger's last points { t, y }, for its speed at the lift
        let downAt = 0;
        // the entrance takes no input until it is over (Yukimi, Nov 14): touches on the list, the
        // arrows and the panel are swallowed here, before any other handler sees them
        const eatWhileEntering = (e) => {
            if (!entryLocked()) return;
            // the lift of a press that began before the entrance (a finger already down as Today came
            // back): no tap, but the press ends here. Swallowed whole it left the list waiting on a
            // finger that was gone, and Today took no taps until a restart (Fold, Nov 15). A drag that
            // took the entrance over ends as any drag does.
            if (e.type === 'pointerup' && e.pointerId === id) { if (axis) return; id = null; }
            e.stopImmediatePropagation();
            e.preventDefault();
        };
        ['pointerdown', 'pointerup', 'click', 'contextmenu'].forEach((t) => host.addEventListener(t, eatWhileEntering, { capture: true }));
        // a press whose lift never arrives is dropped: nothing may be left waiting for a finger that
        // is gone (the page hidden under it; its lift lost some other way)
        let lastSeen = 0; // time of the tracked pointer's last event
        const drop = () => {
            if (id == null) return;
            const was = axis;
            id = null;
            axis = '';
            if (was === 'x') slideEnd(false);
            else if (was === 'y') { dragging = false; startTween(sel, sel, {}); }
        };
        document.addEventListener('visibilitychange', () => { if (document.hidden) drop(); });
        host.addEventListener('pointerdown', (e) => {
            // a new first finger, or any press half a second after the last sign of the old one: the
            // old one is gone (as on Start, wmStart65.js)
            if (id != null && (e.isPrimary || e.timeStamp - lastSeen > 500)) drop();
            if (id != null || (e.pointerType === 'mouse' && e.button !== 0)) return;
            if (e.target.closest('.wm-ti-arrow') || slide.active) return;
            id = e.pointerId;
            lastSeen = e.timeStamp;
            downAt = Date.now();
            y0 = e.clientY;
            x0 = lastX = e.clientX;
            lastT = e.timeStamp;
            velX = 0;
            axis = '';
            trail = [{ t: e.timeStamp, y: e.clientY }];
            // a list on its way is not stopped by the touch (device): it goes on until the finger
            // has travelled the drag distance, or ends early on the tap
            pos0 = pos;
            const top = focusTop();
            const y = (e.clientY - host.getBoundingClientRect().top) / unit();
            inBand = y >= top && y < top + BAND;
        });
        host.addEventListener('pointermove', (e) => {
            if (e.pointerId !== id) return;
            lastSeen = e.timeStamp;
            const u = unit();
            const dy = (e.clientY - y0) / u;
            const dx = (e.clientX - x0) / u;
            if (!axis) {
                const p = panels[sel];
                if (inBand && !tw && p && p.pages.length > 1 && Math.abs(dx) >= SLIDE_START && Math.abs(dx) > Math.abs(dy)) axis = 'x';
                else if (Math.abs(dy) >= DRAG_START) {
                    axis = 'y';
                    if (tw) pos0 = takeOver();
                    flushZoom();
                    dragging = true;
                    host.classList.remove('is-entering');
                } else return;
                try { host.setPointerCapture(id); } catch (_) { /* capture is a nicety */ }
            }
            const dt = e.timeStamp - lastT;
            if (axis === 'x') {
                if (dt > 0) { velX = 0.7 * velX + 0.3 * ((e.clientX - lastX) / dt); lastX = e.clientX; lastT = e.timeStamp; }
                // the page starts where the finger is once the start distance is passed
                const x = (dx - Math.sign(dx) * SLIDE_START) * u;
                slideMove(x || (dx < 0 ? -0.01 : 0.01));
                return;
            }
            trail.push({ t: e.timeStamp, y: e.clientY });
            if (trail.length > 24) trail.shift();
            moveTo(pos0 - dy / ROW);
            place();
        });
        // the finger's speed when it lifts, WM units a ms, + toward later items: its travel over the
        // last 100 ms; a finger that stood still for 80 ms has none (device: after a 400 ms hold the
        // list always returned to the item in the band, 66 of the 68 px to the next one included)
        const liftSpeed = (now) => {
            const last = trail[trail.length - 1];
            if (!last || now - last.t > 80) return 0;
            let first = last;
            for (let i = trail.length - 1; i >= 0 && last.t - trail[i].t <= 100; i--) first = trail[i];
            const dt = last.t - first.t;
            return dt > 0 ? -(last.y - first.y) / unit() / dt : 0;
        };
        const end = (e) => {
            if (e.pointerId !== id) return;
            id = null;
            if (!axis) {
                if (e.type !== 'pointerup' || menuAt >= downAt) return; // a hold that brought a menu
                if (!tw) { tap(e); return; }
                // the list is running: a tap on the band opens the item it ends on, a tap anywhere
                // else ends the move on the next item
                const top = focusTop();
                const y = (e.clientY - host.getBoundingClientRect().top) / unit();
                if (y >= top && y < top + BAND) tw.open = true;
                else stopAtNext();
                return;
            }
            if (axis === 'x') {
                // past half the width, or a flick the way the page is going
                const w = host.clientWidth;
                const flick = e.timeStamp - lastT < 80 && Math.abs(velX) > 0.5 && Math.sign(velX) === Math.sign(slide.x);
                slideEnd(e.type === 'pointerup' && (Math.abs(slide.x) > w / 2 || flick));
                return;
            }
            dragging = false;
            // from the item in the band: as many items as the flick's speed asks for, or back to it
            const v = e.type === 'pointerup' ? liftSpeed(e.timeStamp) : 0;
            const n = Math.abs(v) >= FLICK_MIN ? Math.round(Math.abs(v) * FLING_ROWS) : 0;
            const b = Math.max(0, Math.min(panels.length - 1, sel + (v > 0 ? n : -n)));
            startTween(sel, b, { nv: n, at: e.timeStamp });
        };
        host.addEventListener('pointerup', end);
        host.addEventListener('pointercancel', end);
    }

    function tap(e) {
        const u = unit();
        const r = host.getBoundingClientRect();
        const y = (e.clientY - r.top) / u;
        const top = focusTop();
        if (y >= top && y < top + BAND) { openSelected(); return; }
        const i = y < top ? sel - Math.ceil((top - y) / ROW) : sel + 1 + Math.floor((y - top - BAND) / ROW);
        if (i >= 0 && i < panels.length && i !== sel) select(i, true);
    }

    function onKey(e) {
        if (!host || sh.current !== 'today' || !page.classList.contains('is-titanium')) return;
        if (superOpen) { if (e.key === 'Escape' || e.key === 'Backspace' || e.key === 'BrowserBack') { closeSuper(); e.preventDefault(); } return; }
        const t = e.target;
        if (t && t.closest && t.closest('input, textarea, select, [contenteditable="true"]')) return;
        if (document.querySelector('#wmShell > .wm-popup:not([hidden]), #wmShell .wm-msgbox-layer:not([hidden])')) return;
        if (entryLocked()) { if (/^Arrow|^Enter$/.test(e.key)) e.preventDefault(); return; }
        const at = tw ? tw.b : sel; // a key while the list moves counts from the item it is going to
        if (e.key === 'ArrowDown') { select(at + 1, true); e.preventDefault(); }
        else if (e.key === 'ArrowUp') { select(at - 1, true); e.preventDefault(); }
        else if (e.key === 'ArrowLeft') { turnPage(-1); e.preventDefault(); }
        else if (e.key === 'ArrowRight') { turnPage(1); e.preventDefault(); }
        else if (e.key === 'Enter') { const p = panels[sel]; if (p && typeof p.onTap === 'function') { p.onTap(p.pages[pageIndex(p)]); e.preventDefault(); } }
    }

    // ---------------------------------------------------------------- the Today view

    let missed = false; // a repaint came while the list moved: it lands, then draws
    const view = {
        refresh(todayPage) {
            page = todayPage;
            const on = enabled();
            page.classList.toggle('is-titanium', on);
            if (!on) { if (host) host.hidden = true; return; }
            if (!host) build();
            host.hidden = false;
            // the list is moving: it draws the new data once it has landed (arrive); there is no timed repaint
            if (dragging || settle) { missed = true; return; }
            missed = false;
            const selId = panels[sel] && panels[sel].id;
            panels = buildPanels();
            const key = panels.map((p) => p.id).join('|');
            if (key !== panelsKey) {
                panelsKey = key;
                let at = panels.findIndex((p) => p.id === selId);
                // the first time: the clock is home, as on 6.5
                if (!homeDone && panels.length) { homeDone = true; at = panels.findIndex((p) => p.clock); }
                sel = Math.max(0, at);
                pos = sel;
                skSel = sel;
            }
            if (!zoomTimer) skSel = sel;
            drawRows();
            place();
            drawExpanded();
        },
        /**
         * Only these panels built again (#890: the minute tick's clock, an item's own data): drawn in place.
         * false when that is not enough (a panel came or went, the weather that the clock carries): the
         * shell then runs refresh.
         */
        update(todayPage, ids) {
            page = todayPage;
            const on = enabled();
            if (!on) return !host || host.hidden; // off and already put away: nothing to draw
            if (!host || host.hidden || !page.classList.contains('is-titanium')) return false;
            if (dragging || settle) { missed = true; return true; }
            if (ids.includes('weather')) return false; // the clock carries the weather (buildPanels)
            const defs = new Map(sh.todayItemDefs().map((w) => [w.id, w]));
            const rows = [...page.querySelectorAll(':scope > [data-row]')];
            let touched = false;
            for (const id of new Set(ids)) {
                const i = panels.findIndex((p) => p.id === id);
                const rowEl = rows.find((r) => r.dataset.row === id) || null;
                if (rowEl && rowEl.classList.contains('wm-today-off')) { if (i >= 0) return false; continue; }
                const w = defs.get(id);
                let p = null;
                if (w) p = widgetPanel(w, rowEl);
                else if (id === 'date') p = builtin('date', lastSt, rowEl);
                else if (i >= 0) return false; // a shell row on show: the whole list
                else continue; // not an item here
                const ok = !!(p && Array.isArray(p.pages) && p.pages.length);
                if (ok !== (i >= 0)) return false; // a panel came or went
                if (!ok) continue;
                // the clock with or without the weather decides whether the weather item shows: the whole list
                if (id === 'date' && !!(p.pages[0] && p.pages[0].wx) !== !!(panels[i].pages[0] && panels[i].pages[0].wx)) return false;
                p.id = id;
                panels[i] = p;
                touched = true;
            }
            if (!touched) return true;
            drawRows();
            drawExpanded();
            return true;
        },
        softKeys(keys) {
            if (!host || host.hidden) return keys;
            if (superOpen) return { left: keys.left, right: { label: 'Close', action: () => closeSuper() } };
            // the key of the panel that has arrived: it stays while the list moves and changes after
            // the next panel has grown in
            const p = panels[skSel] || panels[sel];
            const pg = p && p.pages[pageIndex(p)];
            // the clock (home) panel: a right key chosen in Settings > Buttons replaces its "Set", as
            // the key does on 6.1's Today (Yukimi, Nov 13, #796); <None> leaves it blank
            if (p && p.clock && keys.custom && keys.custom.right) return { left: keys.left, right: keys.right || { label: '', disabled: true } };
            return { left: keys.left, right: (pg && pg.softKey) || (p && p.softKey) || keys.right };
        }
    };

    function init() {
        sh = window.wmShell;
        if (!sh || typeof sh.setTodayView !== 'function') return;
        document.addEventListener('keydown', onKey);
        window.addEventListener('resize', () => { if (host && !host.hidden) { place(); requestAnimationFrame(blurPlace); } });
        sh.setTodayView(view);
    }

    /**
     * Home (the phone's Home button, #794): the clock panel in the band at once and every panel back
     * on its first page, as the device's home screen comes back.
     */
    function home(opts) {
        pageAt.clear();
        expKey = '';
        // a page on its way stops where it started, at once
        if (slide && slide.active) { cancelAnimationFrame(slide.raf); slide.active = false; slide.x = 0; host.classList.remove('is-sliding'); }
        const at = Math.max(0, panels.findIndex((p) => p.clock));
        if (!(host && !host.hidden && panels.length)) { homeDone = false; return; } // drawn later: the first draw takes the clock again
        // the press that brought Dreamscape back from an Android app: that return's entrance plays
        // (now, or when the page shows: the visibility handler)
        const hiddenNow = document.visibilityState !== 'visible';
        const span = hiddenNow ? Date.now() - hiddenAt : (Date.now() - shownAt < ENTER_RECENT_MS ? hiddenSpan : 0);
        if (span > AWAY_MS) { if (!hiddenNow && !host.classList.contains('is-entering')) entrance(); return; }
        // Today is on screen and stays: a press of Home here also paused the app for a moment (Android
        // calls prime() as it goes behind), which hid the list until a 2.5 s fallback - or for good when
        // the page was not visible yet at that moment (Yukimi, Nov 15: Home on the home screen hides
        // everything). The list shows again now; the press's own animation plays over it.
        unprime();
        // Home while Today is already on screen (#800): the list runs back to the clock (the key's
        // pace, 45 ms an item), then the clock panel grows in
        if (opts && opts.animate) {
            homeArrival = true;
            if (sel !== at || tw || !host.classList.contains('is-rest')) { select(at, true); return; }
            // already on the clock: the panel still grows and fades in, so the press shows
            expKey = '';
            drawExpanded();
            zoomIn(false);
            return;
        }
        select(at, false);
    }

    // the entrance's run is logarithmic, not even (Yukimi, Nov 14): fast off the bottom, then a long
    // settle into the clock (exponential ease-out, scaled so it ends at exactly 1); 78 %, 95 %, 99 % of
    // the way at a quarter, half and three quarters of the run
    const ENTER_K = 6;
    const enterEase = (x) => (1 - Math.exp(-ENTER_K * x)) / (1 - Math.exp(-ENTER_K));

    /** Today comes back (#800): the empty band, the list running up from below into the clock as it fades and grows in. */
    function entrance() {
        // a readied Today that gets no entrance shows at once (never left with its list hidden)
        if (!host || host.hidden || !panels.length || dragging) { unprime(); return; }
        if ((root.dataset.wmBoot && root.dataset.wmBoot !== 'done') || root.dataset.screenOff !== undefined) { if (root.dataset.screenOff === undefined) unprime(); return; } // the boot reveal / a dark screen
        // the screen just came on: no show for that, unless Today was readied for it (prime: the screen went off on Today)
        if (Date.now() - screenOnAt < ENTER_RECENT_MS && !host.classList.contains('is-primed')) return;
        if (slide && slide.active) { cancelAnimationFrame(slide.raf); slide.active = false; slide.x = 0; host.classList.remove('is-sliding'); }
        pageAt.clear();
        expKey = '';
        cancelAnimationFrame(settle); settle = 0; tw = null;
        clearTimeout(zoomTimer); zoomTimer = 0; host.classList.remove('is-zoom', 'is-zoom-enter');
        const at = Math.max(0, panels.findIndex((p) => p.clock));
        // geometry first, before this frame's writes dirty the layout again
        const u = unit();
        const ft = focusTop();
        const screenUnits = (hostHeight() || window.innerHeight) / u;
        sel = at;
        skSel = at;
        drawExpanded();
        if (host.classList.contains('is-entering')) {
            host.classList.remove('is-entering');
            void host.offsetWidth; // restart the scale-in (only when one is still running)
        }
        host.classList.add('is-entering');
        // the list starts all the way below the screen (its first item under the bottom edge) and runs
        // up into the clock while it fades in (Yukimi, Nov 14: from below, fading in, a slight grow
        // that is done halfway; wm-titanium.css); no input until the clock panel has grown in
        const below = screenUnits - (ft - ROW * at) + ROW;
        pos = at - below / ROW;
        host.classList.remove('is-exiting');
        unprime();
        enterLockUntil = performance.now() + ENTER_MS + ENTER_ZOOM_MS + KEY_MS;
        startTween(at, at, { backMs: ENTER_MS, ease: enterEase, entry: { stagger: fx.stagger, overshoot: fx.overshoot } });
        breathe();
        syncTilt();
        if (blurClip && !blurClip.hidden) requestAnimationFrame(blurPlace);
        sh.refreshSoftKeys();
    }

    /**
     * Today's entrance waits for Melaton's window to have the focus (Yukimi, Nov 18: "it should not animate until
     * the app is focused"): coming back from an Android program, the page is shown while Android's home animation and
     * the app's return picture still cover it, and the entrance ran out under them ("most of the animation is
     * gone"). The app says when its window has the focus (window event 'melatonfocus', DSApp onWindowFocusChanged
     * once the return picture is gone); the page's own window focus counts too, and 2.5 s at most. Meanwhile Today
     * holds the entrance's opening pose (prime()), which is also what the return picture shows.
     */
    let focusWait = null;
    function whenFocused(fn) {
        if (focusWait) focusWait.cancel();
        const inApp = !!(window.AndroidBars || window.AndroidHome);
        if (!inApp || (document.hasFocus() && !window.AndroidBars)) { fn(); return; }
        let done = false;
        const go = () => {
            if (done) return;
            done = true;
            window.removeEventListener('melatonfocus', onApp);
            window.removeEventListener('focus', go);
            clearTimeout(t);
            focusWait = null;
            fn();
        };
        const onApp = (e) => { if (!e.detail || e.detail.focused !== false) go(); };
        window.addEventListener('melatonfocus', onApp, { signal: appScopeSignal });
        window.addEventListener('focus', go, { signal: appScopeSignal });
        const t = setTimeout(go, 2500);
        focusWait = { cancel() { done = true; clearTimeout(t); window.removeEventListener('melatonfocus', onApp); window.removeEventListener('focus', go); focusWait = null; } };
    }

    // when Today comes back: the page from the background (an Android app, the recents list), or Today
    // from another program
    let homeArrival = false; // the move under way was started by Home: its panel grows and fades in
    let shownAt = 0;
    let hiddenAt = 0;
    let hiddenSpan = 0;
    let screenOnAt = 0;
    window.addEventListener('melatonscreen', (e) => { if (e && e.detail && e.detail.on) screenOnAt = Date.now(); });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') { hiddenAt = Date.now(); return; }
        shownAt = Date.now();
        hiddenSpan = hiddenAt ? shownAt - hiddenAt : 0;
        // back from another app (not the blink of a Home press on Today)
        if (root.dataset.wmApp === 'today' && hiddenSpan > AWAY_MS) whenFocused(() => requestAnimationFrame(entrance));
        else if (host) { unprime(); host.classList.remove('is-exiting'); }
    });
    let lastApp = root.dataset.wmApp || '';
    new MutationObserver(() => {
        const now = root.dataset.wmApp || '';
        // (not for a Today readied for the way back: prime() closing Start under a program; it plays on the return)
        if (now === 'today' && lastApp && lastApp !== 'today') requestAnimationFrame(() => { if (!host || !host.classList.contains('is-primed')) entrance(); });
        if (now !== 'today' && host) host.classList.remove('is-exiting');
        // another program came up: the Super Bar is put away at once (Today comes back without it)
        if (now !== 'today' && superOpen) closeSuper(true);
        lastApp = now;
        syncTilt();
        if (now === 'today' && host) requestAnimationFrame(() => { syncBlur(); blurPlace(); });
    }).observe(root, { attributes: true, attributeFilter: ['data-wm-app'] });
    document.addEventListener('visibilitychange', syncTilt);
    window.addEventListener('melatonscreen', (e) => {
        setTimeout(syncTilt, 0);
        // the screen going off on Today readies the entrance for the unlock; on, it plays (the lock
        // screen, when there is one, comes first and the entrance runs as Today shows)
        const on = !!(e && e.detail && e.detail.on);
        if (!on) prime({ screenOff: true });
        else if (host && host.classList.contains('is-primed')) requestAnimationFrame(() => { if (root.dataset.wmApp === 'today' && document.visibilityState === 'visible') entrance(); else unprime(); });
    });
    // a readied Today that comes back on screen with no entrance on its way is never left without its
    // list (prime()'s own fallback only looks once, 2.5 s in, and gives up if the page is hidden then)
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible' || !host || !host.classList.contains('is-primed')) return;
        setTimeout(() => { if (!focusWait && host.classList.contains('is-primed') && !host.classList.contains('is-entering')) unprime(); }, 600);
    });

    window.wmTitanium = {
        enabled, home, select: (i) => select(i, true),
        // the coming-back entrance on demand (tests, #800)
        enter: () => entrance(),
        // the Android app readies the return before Melaton goes behind another program (#800)
        prime: () => prime(), unprime: () => unprime(),
        panels: () => panels.map((p) => ({ id: p.id, label: p.label, pages: p.pages.length })), selected: () => sel,
        // where the list is (tests): the move under way { a, b, n, p } or null, and the dragged position in rows
        motion: () => ({ sel, pos, dragging, move: tw ? { a: tw.a, b: tw.b, n: tw.n, asked: tw.nv, p: tw.p } : null })
    };

    /** A panel's page by number (Music's "Go To Playing", #796): drawn now when the panel is in the band. */
    window.wmTitanium.showPage = (id, i) => {
        const p = panels.find((x) => x.id === id);
        if (!p || slide.active) return;
        pageAt.set(id, Math.max(0, Math.min(p.pages.length - 1, Number(i) || 0)));
        if (panels[sel] === p) { drawExpanded(); sh.refreshSoftKeys(); }
    };

    if (window.wmShell) init();
    else document.addEventListener('wmShellReady', init, { once: true });
})();
