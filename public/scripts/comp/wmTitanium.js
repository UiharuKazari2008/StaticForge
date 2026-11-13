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
    function builtin(id, st, rowEl) {
        if (id === 'date') {
            const now = new Date();
            const t = timeParts(now);
            return {
                clock: true, label: t.time, count: t.ampm, icon: 'ti-2051',
                pages: [{ time: t.time, ampm: t.ampm, date: fmtShort.format(now), network: st.connection ? st.connection.text : '' }],
                softKey: { label: 'Set', action: () => openSettings('clock') },
                onTap: () => {
                    if (st.connection && st.connection.tap === 'reconnect' && window.wsClient && typeof window.wsClient.manualReconnect === 'function') window.wsClient.manualReconnect();
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
        if (!wireMail.dove) { wireMail.dove = true; document.addEventListener('dovecoteMailboxUpdated', () => { mail.at = 0; if (mail.busy) mail.again = true; else recentMail(); }); }
    }
    function recentMail() {
        wireMail();
        const c = window.wsClient;
        if (!mail.busy && Date.now() - mail.at > 60000 && c && typeof c.isConnected === 'function' && c.isConnected() && c.initializationCompleted) {
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

    function buildPanels() {
        const st = sh.todayState() || {};
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
        // the date row switched off: the connection still needs a place
        if (!out.some((p) => p.clock) && ids.includes('connection') && st.connection) {
            out.unshift({ id: 'connection', label: 'connection', icon: 'ti-2603', pages: [{ title: st.connection.text }] });
        }
        return out;
    }

    // ---------------------------------------------------------------- drawing

    function unit() {
        return parseFloat(getComputedStyle(root).getPropertyValue('--wm-px')) || 1;
    }

    function build() {
        host = document.createElement('div');
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
    }

    function focusTop() {
        // centred in the list: (height - 140) / 2 in VGA pixels
        const u = unit();
        return Math.round(((host.clientHeight / u) - BAND) / 2 * 2) / 2;
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

    /** Place every row for the list position `pos` (rows) around the band. */
    function place() {
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
    function pageHtml(p, pg) {
        const icon = pg.icon || p.icon;
        const iconHtml = icon ? `<img class="wm-ti-icon" src="${esc(artUrl(icon))}" srcset="${esc(artSet(icon))}" alt="" draggable="false">` : '';
        if (p.clock) {
            return `${iconHtml}<div class="wm-ti-time">${esc(pg.time)}</div><div class="wm-ti-ampm">${esc(pg.ampm)}</div>
                <div class="wm-ti-date">${esc(pg.date)}</div><div class="wm-ti-network">${esc(pg.network)}</div>`;
        }
        const lines = [pg.title, pg.line2, pg.line3].filter(Boolean).length;
        const pic = pg.image ? `<span class="wm-ti-pic" style="background-image:url('${esc(pg.image)}')"></span>` : '';
        const small = !pg.image && pg.smallIcon ? `<img class="wm-ti-small" src="${esc(artUrl(pg.smallIcon))}" srcset="${esc(artSet(pg.smallIcon))}" alt="" draggable="false">` : '';
        // pg.bare: a picture without the white frame (the Music panel's album art and Play All Songs tile)
        return `${iconHtml}<div class="wm-ti-text" data-lines="${lines}"${pg.image ? ` data-pic="${pg.bare ? 'bare' : '1'}"` : ''}${small ? ' data-small="1"' : ''}>${pic}${small}
            ${lineHtml('is-1', pg.title)}${lineHtml('is-2', pg.line2)}${lineHtml('is-3', pg.line3)}</div>`;
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
        const key = JSON.stringify([p.id, p.icon, at, n, pg.time, pg.ampm, pg.date, pg.network, pg.title, pg.line2, pg.line3, pg.image, pg.bare, pg.smallIcon, pg.icon]);
        host.querySelectorAll('.wm-ti-arrow').forEach((a) => { a.hidden = n < 2; });
        if (slide.active || key === expKey) return; // a page on its way keeps what it shows
        expKey = key;
        exp.innerHTML = `<div class="wm-ti-pg">${pageHtml(p, pg)}</div>`;
        // the pages either side slide in with their picture already loaded
        if (n > 1) for (const d of [1, -1]) { const im = p.pages[(at + d + n) % n].image; if (im) { const pre = new Image(); pre.decoding = 'async'; pre.src = im; } }
    }

    // Left / right on a panel with pages (emulator, "getting started", sampled every 15-40 px): after
    // 45 px of travel the page, its text and its icon, follows the finger 1:1 and the next one follows
    // a screen width behind (the pages go round); the arrows are gone while it moves; let go past half
    // the width and it carries on to the next page, short of it the page slides back.
    const slide = { active: false, dir: 0, x: 0, raf: 0 };

    function slideBegin(dir) {
        const p = panels[sel];
        if (!p || p.pages.length < 2) return false;
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
            cancelAnimationFrame(settle); settle = 0; tw = null;
            clearTimeout(zoomTimer); zoomTimer = 0; host.classList.remove('is-zoom');
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
    function startTween(a, b, o) {
        cancelAnimationFrame(settle);
        flushZoom();
        const n = Math.abs(b - a);
        const e = (pos - a) * ROW; // where the finger left the list: units past a's place, + toward later items
        // the clock starts when the finger left the glass, not when the event got here
        tw = { a, b, n, e0: e, D: 0, p: 0, p0: 0, gain: 1, Tv: 0, end: BACK_MS, t0: (o && o.at) || performance.now(), open: false, nv: n };
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
        const t = Math.max(0, now - tw.t0);
        let p;
        if (tw.n) p = Math.max(tw.p0, Math.min(1, tw.gain * Math.pow(t / tw.Tv, FLING_POW)));
        else { const k = Math.pow(Math.min(1, t / BACK_MS), 1.3); p = k * k * (3 - 2 * k); } // 13 %, 65 %, 100 % of the way at 103, 206, 310 ms
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
            const e = tw.e0 * (1 - p);
            for (let i = 0; i < ys.length; i++) ys[i] = i <= a ? top - e - ROW * (a - i) : top - e + BAND + ROW * (i - a - 1);
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
        host.style.setProperty('--wm-ti-top', String(top));
        host.classList.remove('is-rest');
        panels.forEach((pn, i) => {
            const el = rowEl.get(pn.id);
            if (!el) return;
            const y = ys[i];
            el.style.transform = `translate3d(0, calc(${y} * var(--wm-px)), 0)`;
            const under = y + ROW / 2 > top && y + ROW / 2 < top + BAND;
            el.classList.toggle('is-under', under);
            el.classList.remove('is-sel');
            if (el.dataset.far !== '0') el.dataset.far = '0';
            const o = i === tw.b && fade < 1 ? String(Math.round(fade * (under ? 55 : 100)) / 100) : '';
            if (el.style.opacity !== o) el.style.opacity = o;
        });
    }

    /** The move is over: b is in the band, its panel grows in. */
    function arrive() {
        const b = tw.b;
        const open = tw.open;
        cancelAnimationFrame(settle);
        settle = 0;
        tw = null;
        sel = b;
        pos = b;
        place();
        drawExpanded();
        zoomIn(open);
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
    function zoomIn(open) {
        clearTimeout(zoomTimer);
        host.classList.remove('is-zoom');
        void host.offsetWidth; // restart the animation
        host.classList.add('is-zoom');
        zoomTimer = setTimeout(() => {
            zoomTimer = 0;
            host.classList.remove('is-zoom');
            skSel = sel;
            sh.refreshSoftKeys();
            if (open) openSelected();
        }, ZOOM_MS + KEY_MS);
    }

    /** The list moves on before the panel has finished arriving: its soft key is up at once. */
    function flushZoom() {
        if (!zoomTimer) return;
        clearTimeout(zoomTimer);
        zoomTimer = 0;
        host.classList.remove('is-zoom');
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
        const eat = (e) => { e.stopPropagation(); e.preventDefault(); };
        window.addEventListener('click', eat, { capture: true, once: true });
        setTimeout(() => window.removeEventListener('click', eat, { capture: true }), 400);
        try { act(pg); } catch (err) { console.warn('[wmTitanium] tap', p.id, err); }
    }

    /** List position p (rows): the selection moves on once the next item has travelled a whole row. */
    function moveTo(p) {
        pos = Math.max(0, Math.min(panels.length - 1, p));
        while (pos - sel >= 1) sel++;
        while (pos - sel <= -1) sel--;
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
        host.addEventListener('pointerdown', (e) => {
            if (id != null || (e.pointerType === 'mouse' && e.button !== 0)) return;
            if (e.target.closest('.wm-ti-arrow') || slide.active) return;
            id = e.pointerId;
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
        const t = e.target;
        if (t && t.closest && t.closest('input, textarea, select, [contenteditable="true"]')) return;
        if (document.querySelector('#wmShell > .wm-popup:not([hidden]), #wmShell .wm-msgbox-layer:not([hidden])')) return;
        const at = tw ? tw.b : sel; // a key while the list moves counts from the item it is going to
        if (e.key === 'ArrowDown') { select(at + 1, true); e.preventDefault(); }
        else if (e.key === 'ArrowUp') { select(at - 1, true); e.preventDefault(); }
        else if (e.key === 'ArrowLeft') { turnPage(-1); e.preventDefault(); }
        else if (e.key === 'ArrowRight') { turnPage(1); e.preventDefault(); }
        else if (e.key === 'Enter') { const p = panels[sel]; if (p && typeof p.onTap === 'function') { p.onTap(p.pages[pageIndex(p)]); e.preventDefault(); } }
    }

    // ---------------------------------------------------------------- the Today view

    const view = {
        refresh(todayPage) {
            page = todayPage;
            const on = enabled();
            page.classList.toggle('is-titanium', on);
            if (!on) { if (host) host.hidden = true; return; }
            if (!host) build();
            host.hidden = false;
            if (dragging || settle) return; // the list is moving: the next repaint (2 s) takes the new data
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
        softKeys(keys) {
            if (!host || host.hidden) return keys;
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
        window.addEventListener('resize', () => { if (host && !host.hidden) place(); });
        sh.setTodayView(view);
    }

    /**
     * Home (the phone's Home button, #794): the clock panel in the band at once and every panel back
     * on its first page, as the device's home screen comes back.
     */
    function home() {
        pageAt.clear();
        expKey = '';
        // a page on its way stops where it started, at once
        if (slide.active) { cancelAnimationFrame(slide.raf); slide.active = false; slide.x = 0; host.classList.remove('is-sliding'); }
        const at = panels.findIndex((p) => p.clock);
        if (host && !host.hidden && panels.length) select(at >= 0 ? at : 0, false);
        else homeDone = false; // drawn later: the first draw takes the clock again
    }

    window.wmTitanium = {
        enabled, home, select: (i) => select(i, true), panels: () => panels.map((p) => ({ id: p.id, label: p.label, pages: p.pages.length })), selected: () => sel,
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
