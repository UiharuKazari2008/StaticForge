/**
 * Melaton Mobile 6.5: the Social Today item (Yukimi, Nov 21 2026: "add new 'social' item to today that a user can add
 * social apps to and the notifications for those apps will be ingested from android").
 *
 * The work is the app's (DSApp SocialNotifications.kt, window.AndroidSocialNotifications), page or no page
 * (cafeready-background): while an app is a social app its Android notifications are taken in (title, text, the
 * conversation's lines, the large icon, the big picture and the messages' pictures, the content intent, the buttons and
 * their inline reply) and cleared from Android's shade when the app can fire them again later; one with nothing to fire
 * stays in the shade and is mirrored. This file is the page's half:
 *
 *   Settings > Today > Items > Social > Options
 *     Social apps      the phone's programs (wmAndroidApps.list()), checked in the order they page; an app that is a
 *                      Messaging account (#885) is offered greyed, "(in Messaging)", and never taken in
 *     Left and right   "Show all notifications by date": a page per notification, newest first (up to 30);
 *                      "Page per App": a page per social app, its newest notification
 *   The panel          each page: the sender or conversation, the last line, the app and the time, the sender's face
 *                      (large icon) or the picture; the right soft key is named after the page's app and opens it
 *   A tap              the app's own bar (openBar): the band's glass rises to the top at the band's own height (it does
 *                      not grow, Yukimi), the app on it; left / right (swipe, the arrows, the keys) pages between the
 *                      social apps; under it the app's notifications in a list that scrolls, jumped to the one tapped.
 *                      A notification opens what it opens on the phone (its content intent), its X clears it, its
 *                      buttons and Reply work as in the shade. Back, Escape or a tap on the glass puts it away.
 *
 * Data: AndroidSocialNotifications.list() (a kept string in the app), read once at start and again on the app's
 * 'androidsocialnotifications' event (held by the app while the page is not seen); pictures are files the app serves
 * (//appassets.androidplatform.net/social-image/...). No server request, no timer. The chosen apps go to the app with
 * setApps when the option changes (and once at start if the app has another list).
 */
(function () {
    'use strict';
    const appScopeSignal = (window.melatonSegments && typeof window.melatonSegments.callerSignal === 'function' && window.melatonSegments.callerSignal()) || undefined; // page listeners end with this file's segment (app-scope, #872/#890)

    if (window.uiShell !== 'mobile' || !document.documentElement.classList.contains('ui-mobile')) return;

    const ID = 'social';
    const MAX_PAGES = 30;
    // the bar: the band's card (82 units: the art's shadow, its glass 9 - 68, its bottom line and shadow) at the band's
    // height open or not; it rises to where the Super Bar's card stands (its glass's top line on the title bar), the list
    // under it as the Super Bar's (its bottom shadow fades onto it)
    const BAR_H = 82;
    const BAR_TOP = -9;
    const BODY_TOP = 62;
    const BAR_MS = 420; // the Super Bar's even ease in and out (wmTitanium.js SUPER_MS / SUPER_EASE)
    const BAR_EASE = 'cubic-bezier(0.45, 0, 0.2, 1)';
    const SLIDE_START = 22.5; // a swipe on the glass turns the page after 45 VGA px, as a panel's pages
    const PAGE_MS = 220;
    const PAGING = [['date', 'Show all notifications by date'], ['app', 'Page per App']];

    let sh = null;
    let notes = []; // what the app keeps, newest first
    let notesRaw = null;
    let access = true;
    let sentApps = null; // the apps last told to the app (sorted JSON)
    let bar = null; // the open bar (openBar)
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const fmtTime = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
    const fmtDay = new Intl.DateTimeFormat(undefined, { month: 'numeric', day: 'numeric' });

    const bridge = () => { const b = window.AndroidSocialNotifications; return b && typeof b.list === 'function' ? b : null; };

    /** Android apps that are Messaging accounts (#885): their notifications are conversations there, never here. */
    function messagingPackages() {
        const t = window.textMessaging;
        try { return t && typeof t.androidPackages === 'function' ? t.androidPackages() : new Set(); } catch (_) { return new Set(); }
    }

    function option(key) { return sh && typeof sh.todayOption === 'function' ? sh.todayOption(ID, key) : null; }

    /** The social apps, in the order they page (Options' checked list), without Messaging's. */
    function chosen() {
        const managed = messagingPackages();
        const out = [];
        for (const p of String(option('apps') || '').split(',')) {
            const k = p.trim();
            if (k && !managed.has(k) && !out.includes(k)) out.push(k);
        }
        return out;
    }
    const paging = () => (option('paging') === 'app' ? 'app' : 'date');
    // the social apps for the rest of the shell: the clock's Super Bar leaves their notifications to Social (Nov 21 2026)
    // app-scope: allow export on purpose (wmTitanium reads it; phone shell, loaded once from app.html)
    window.wmSocial = { apps: () => chosen() };

    // ---------------------------------------------------------------- the phone's programs

    // package -> { id, label, icon }: wmAndroidApps' list (its own cache), kept until the programs change
    let progs = null;
    window.addEventListener('androidapps', () => { progs = null; }, { signal: appScopeSignal });
    document.addEventListener('wmAppsChanged', () => { progs = null; }, { signal: appScopeSignal });
    function programs() {
        if (progs) return progs;
        let list = [];
        try { list = window.wmAndroidApps && typeof window.wmAndroidApps.list === 'function' ? window.wmAndroidApps.list() : []; } catch (_) { list = []; }
        const m = new Map();
        for (const a of list) if (a && a.package && !m.has(a.package)) m.set(a.package, { id: a.id, label: a.label || a.package, icon: a.icon || '' });
        if (m.size) progs = m; // none yet: asked again next time (the programs come after boot)
        return m;
    }
    function appInfo(pkg) {
        const a = programs().get(pkg);
        const n = a ? null : notes.find((x) => x.package === pkg);
        return { id: a ? a.id : null, label: (a && a.label) || (n && n.app) || pkg };
    }
    /** The program's Windows Mobile icon when it has one (wm-direct-replacement icons), else its own. */
    function iconOf(pkg) {
        let wm = null;
        try { wm = window.wmAndroidApps && typeof window.wmAndroidApps.wmIcon === 'function' ? window.wmAndroidApps.wmIcon(pkg) : null; } catch (_) { wm = null; }
        const a = programs().get(pkg);
        return wm || (a && a.icon) || '';
    }
    function appChoices() {
        const managed = messagingPackages();
        return [...programs().entries()]
            .map(([pkg, a]) => (managed.has(pkg) ? [pkg, `${a.label} (in Messaging)`, iconOf(pkg), true] : [pkg, a.label, iconOf(pkg)]))
            .sort((x, y) => String(x[1]).localeCompare(String(y[1]), undefined, { sensitivity: 'base' }));
    }

    function launchApp(pkg) {
        if (bar) closeBar(true);
        const a = programs().get(pkg);
        if (a && typeof window.wmAndroidLaunch === 'function') { void window.wmAndroidLaunch(a.id, a.label); return; }
        const A = window.AndroidApps;
        if (A && typeof A.launch === 'function') { try { A.launch(pkg); } catch (_) { /* gone */ } }
    }
    const appKey = (pkg) => ({ label: appInfo(pkg).label, action: () => launchApp(pkg) });

    /** Settings > Today > Items > Social > Options... (as Music's and Favorites' do). */
    function openOptions() {
        const S = window.wmSettings;
        if (!S) return;
        if (typeof S.openTodayOptions === 'function') { S.openTodayOptions(ID); return; }
        if (typeof S.open !== 'function') return;
        S.open('today', 'items');
        let tries = 0;
        const press = () => {
            const pg = [...document.querySelectorAll('#wmShell .wm-page')].find((p) => !p.hidden && p.querySelector(`.wm-listbox-row input[name="it-${ID}"]`));
            const box = pg && pg.querySelector(`input[name="it-${ID}"]`);
            const row = box && box.closest('.wm-listbox-row');
            if (!row) { if (++tries < 20) setTimeout(press, 100); return; }
            if (!row.classList.contains('is-selected')) row.click();
            const btn = pg.querySelector('.wm-button[data-act="options"]');
            if (btn && !btn.disabled) btn.click();
        };
        setTimeout(press, 0);
    }
    function requestAccess() {
        const N = window.AndroidPhoneNotifications;
        if (N && typeof N.requestAccess === 'function') { try { N.requestAccess(); } catch (_) { /* old app */ } }
    }

    // ---------------------------------------------------------------- the app's list

    /** Reads the app's list (and whether notification access is on); true when it changed. */
    function readNotes() {
        const B = bridge();
        let raw = '[]';
        let ok = true;
        if (B) {
            try { raw = String(B.list() || '[]'); } catch (_) { raw = '[]'; }
            try { ok = typeof B.access !== 'function' || !!B.access(); } catch (_) { ok = true; }
        }
        if (raw === notesRaw && ok === access) return false;
        access = ok;
        if (raw !== notesRaw) {
            notesRaw = raw;
            let list = [];
            try { list = JSON.parse(raw); } catch (_) { list = []; }
            notes = Array.isArray(list) ? list.filter((n) => n && n.id && n.package) : [];
        }
        return true;
    }
    function notesOf(pkg) { return notes.filter((n) => n.package === pkg); }
    function shownNotes() { const want = new Set(chosen()); return notes.filter((n) => want.has(n.package)); }

    /** The chosen apps to the app (it takes in what they post from now, and what they have in the shade). */
    function syncApps() {
        const B = bridge();
        if (!B || typeof B.setApps !== 'function') return;
        const want = JSON.stringify(chosen().slice().sort());
        if (want === sentApps) return;
        if (sentApps == null && typeof B.apps === 'function') {
            let have = null;
            try { have = JSON.stringify(JSON.parse(B.apps() || '[]').map(String).sort()); } catch (_) { have = null; }
            if (have === want) { sentApps = want; return; }
        }
        let ok = false;
        try { ok = B.setApps(want) !== false; } catch (_) { ok = false; }
        if (ok) sentApps = want;
    }

    function repaint() {
        if (sh && typeof sh.refreshTodayItem === 'function') sh.refreshTodayItem(ID);
    }

    function onChange() {
        if (!readNotes()) return;
        repaint();
        if (bar && !bar.closing) { drawHead(); drawList(); }
    }

    // ---------------------------------------------------------------- the panel

    function when(t) {
        const d = new Date(Number(t) || 0);
        if (!(d.getTime() > 0)) return '';
        return d.toDateString() === new Date().toDateString() ? fmtTime.format(d) : fmtDay.format(d);
    }
    /** The line a page shows: the newest message (its sender named in a group), else the text, else an inbox line. */
    function lastLine(n) {
        const ms = Array.isArray(n.messages) ? n.messages : [];
        const m = ms[ms.length - 1];
        if (m && (m.text || m.image)) {
            const t = m.text || 'Picture';
            // the page's title is the conversation then: the line says who wrote
            return m.sender && n.conversation && m.sender !== n.conversation ? `${m.sender}: ${t}` : t;
        }
        if (n.text) return String(n.text).replace(/\s+/g, ' ').trim();
        return Array.isArray(n.lines) && n.lines.length ? String(n.lines[0]) : '';
    }
    function notePage(n, count) {
        const a = appInfo(n.package);
        return {
            title: n.conversation || n.title || a.label,
            line2: lastLine(n),
            line3: [a.label, count > 1 ? `${count} new` : '', when(n.time)].filter(Boolean).join(', '),
            icon: iconOf(n.package) || undefined,
            image: n.large || n.picture || undefined,
            inPlace: true, // its bar opens over Today: the list does not drop away first
            softKey: appKey(n.package),
            onTap: () => openBar(n.package, n.id),
            pkg: n.package,
            noteId: n.id
        };
    }

    /** The panel (wmTitanium.js titanium() contract). */
    function panel() {
        const base = { label: 'social', icon: 's:contacts' };
        const B = bridge();
        if (!B) return Object.assign(base, { pages: [{ title: 'Social', line2: "Social apps' notifications show here", line3: 'with the Dreamscape app' }] });
        const apps = chosen();
        const add = { label: 'Add', action: openOptions };
        if (!apps.length) return Object.assign(base, { pages: [{ title: 'Add Social Apps', line2: 'Choose the apps in Options', inPlace: true, softKey: add, onTap: openOptions }], softKey: add, onTap: openOptions });
        if (!access) {
            const allow = { label: 'Allow', action: requestAccess };
            return Object.assign(base, { pages: [{ title: 'Allow Notification Access', line2: "Social reads the apps' notifications", softKey: allow, onTap: requestAccess }], softKey: allow, onTap: requestAccess });
        }
        const list = shownNotes();
        let pages;
        if (paging() === 'app') {
            pages = apps.map((pkg) => {
                const mine = list.filter((n) => n.package === pkg);
                if (mine.length) return notePage(mine[0], mine.length);
                return { title: appInfo(pkg).label, line2: 'No new notifications', icon: iconOf(pkg) || undefined, inPlace: true, softKey: appKey(pkg), onTap: () => openBar(pkg, null), pkg };
            });
        } else {
            pages = list.slice(0, MAX_PAGES).map((n) => notePage(n, 0));
            if (!pages.length) pages = [{ title: 'No New Notifications', line2: apps.map((p) => appInfo(p).label).join(', '), inPlace: true, softKey: appKey(apps[0]), onTap: () => openBar(apps[0], null), pkg: apps[0] }];
        }
        return Object.assign(base, {
            count: list.length ? String(list.length) : '',
            pages,
            softKey: appKey(apps[0]),
            onTap: (pg) => openBar((pg && pg.pkg) || apps[0], (pg && pg.noteId) || null)
        });
    }

    function rowText() {
        if (!chosen().length) return 'Tap to add social apps';
        const n = shownNotes().length;
        return n ? `${n} new social ${n === 1 ? 'notification' : 'notifications'}` : 'No new notifications';
    }

    // ---------------------------------------------------------------- the app's bar

    const mk = (tag, cls) => { const el = document.createElement(tag); if (cls) el.className = cls; return el; };

    /**
     * Opens the bar on [pkg]'s notifications, the list at [id] (null: its top). False when the home screen cannot lend
     * the band now (another bar, a move under way, not the 6.5 home screen).
     */
    function openBar(pkg, id) {
        const T = window.wmTitanium;
        const g = T && typeof T.bandBar === 'function' ? T.bandBar() : null;
        if (!g || bar || g.busy()) return false;
        const heads = chosen();
        if (!heads.length) return false;
        let at = heads.indexOf(pkg);
        if (at < 0) at = 0;
        const u = g.unit;
        const el = mk('div', 'wm-ti-super is-bar');
        el.setAttribute('role', 'dialog');
        el.setAttribute('aria-label', 'Social');
        const shade = mk('div', 'wm-ti-super-shade');
        const body = mk('div', 'wm-ti-super-body');
        const list = mk('div', 'wm-ti-super-notes');
        body.appendChild(list);
        const card = mk('div', 'wm-ti-super-card');
        const clip = mk('div', 'wm-ti-super-frostclip');
        const frost = mk('div', 'wm-ti-super-frost');
        clip.appendChild(frost);
        const art = mk('div', 'wm-ti-super-art');
        art.style.borderImageSource = g.art;
        const head = mk('div', 'wm-ti-super-panel');
        const arrow = (dir, img, label) => { const b = mk('button', 'wm-ti-arrow'); b.type = 'button'; b.dataset.dir = String(dir); b.setAttribute('aria-label', label); b.style.backgroundImage = img; return b; };
        const prev = arrow(-1, g.arrows.prev, 'Previous');
        const next = arrow(1, g.arrows.next, 'Next');
        card.appendChild(clip);
        card.appendChild(art);
        card.appendChild(head);
        card.appendChild(prev);
        card.appendChild(next);
        el.appendChild(shade);
        el.appendChild(body);
        el.appendChild(card);
        bar = { el, card, frost, shade, body, list, head, prev, next, heads, at, g, u, rows: new Map(), anims: [], busy: true, closing: false, reply: null, sel: null, swipe: null, headKey: '' };
        bindBar(bar);
        // the band's own height, open or closed (Yukimi: "it uses the same height as the normal center bar, it does not grow")
        card.style.height = `${BAR_H * u}px`;
        body.style.top = `${BODY_TOP * u}px`;
        if (g.frost) Object.assign(frost.style, g.frost); else frost.style.display = 'none';
        drawHead();
        drawList();
        g.host.appendChild(el);
        if (typeof T.setOverlay === 'function') T.setOverlay({ softKeys: barSoftKeys, key: barKey, close: closeBar });
        // the first frame: the card exactly on the band, before the band goes
        const y0 = g.bandTop;
        const y1 = BAR_TOP * u;
        const ft = g.frostTransform || '';
        card.style.transform = `translateY(${y0}px)`;
        frost.style.transform = `translateY(${-y0}px) ${ft}`;
        g.host.classList.add('is-super');
        const opt = { duration: BAR_MS, easing: BAR_EASE, fill: 'forwards' };
        bar.anims = [
            card.animate([{ transform: `translateY(${y0}px)` }, { transform: `translateY(${y1}px)` }], opt),
            frost.animate([{ transform: `translateY(${-y0}px) ${ft}` }, { transform: `translateY(${-y1}px) ${ft}` }], opt),
            shade.animate([{ opacity: 0 }, { opacity: 1 }], { duration: BAR_MS * 0.5, delay: BAR_MS * 0.6, easing: 'linear', fill: 'both' }),
            body.animate([{ opacity: 0, transform: `translateY(${18 * u}px)` }, { opacity: 1, transform: 'none' }], { duration: BAR_MS * 0.6, delay: BAR_MS * 0.4, easing: 'cubic-bezier(0.2, 0, 0.2, 1)', fill: 'both' })
        ];
        if (g.list) bar.anims.push(g.list.animate([{ opacity: 1 }, { opacity: 0 }], { duration: BAR_MS * 0.5, easing: 'linear', fill: 'forwards' }));
        const b = bar;
        const done = () => { if (bar === b) b.busy = false; };
        if (b.anims[0] && b.anims[0].finished) b.anims[0].finished.then(done, done); else done();
        jumpTo(id);
        return true;
    }

    function closeBar(now) {
        const b = bar;
        if (!b || b.closing) return;
        b.closing = true;
        b.anims.forEach((a) => a.cancel());
        const T = window.wmTitanium;
        const finish = () => {
            b.anims.forEach((a) => a.cancel());
            b.g.host.classList.remove('is-super');
            b.el.remove();
            if (bar === b) bar = null;
            if (T && typeof T.setOverlay === 'function') T.setOverlay(null);
        };
        if (now) { finish(); return; }
        const u = b.u;
        const y0 = b.g.bandTop;
        const y1 = BAR_TOP * u;
        const ft = b.g.frostTransform || '';
        const ms = Math.round(BAR_MS * 0.85);
        const opt = { duration: ms, easing: BAR_EASE, fill: 'forwards' };
        b.anims = [
            b.card.animate([{ transform: `translateY(${y1}px)` }, { transform: `translateY(${y0}px)` }], opt),
            b.frost.animate([{ transform: `translateY(${-y1}px) ${ft}` }, { transform: `translateY(${-y0}px) ${ft}` }], opt),
            b.shade.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms * 0.45, easing: 'linear', fill: 'forwards' }),
            b.body.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms * 0.5, easing: 'linear', fill: 'forwards' })
        ];
        if (b.g.list) b.anims.push(b.g.list.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ms * 0.7, delay: ms * 0.3, easing: 'linear', fill: 'both' }));
        if (sh) sh.refreshSoftKeys();
        if (b.anims[0] && b.anims[0].finished) b.anims[0].finished.then(finish, finish); else finish();
    }

    // the bar's right key is a Menu (Yukimi, Nov 21 2026): Open App (the app on screen), Clear All (its notifications here and
    // in the shade)
    function clearApp(pkg) {
        const B = bridge();
        if (B && typeof B.clear === 'function') { try { B.clear(pkg); } catch (_) { /* gone */ } }
    }
    function barSoftKeys(keys) {
        if (!bar || bar.closing) return keys;
        const pkg = bar.heads[bar.at];
        return { left: keys.left, right: { label: 'Menu', icon: 'menu', menu: () => [
            { label: 'Open App', action: () => launchApp(pkg) },
            { label: 'Clear All', action: () => clearApp(pkg) }
        ] } };
    }

    function barKey(e) {
        if (!bar) return false;
        const typing = e.target && e.target.closest && e.target.closest('textarea, input');
        if (e.key === 'Escape' || e.key === 'BrowserBack' || (e.key === 'Backspace' && !typing)) { closeBar(); return true; }
        if (typing) return false;
        if (e.key === 'ArrowLeft') { turn(-1); return true; }
        if (e.key === 'ArrowRight') { turn(1); return true; }
        return false;
    }

    function bindBar(b) {
        // the home screen's own touch handling stays out of the bar; its rows scroll and take taps
        ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'click', 'contextmenu'].forEach((t) => b.el.addEventListener(t, (e) => e.stopPropagation()));
        // a swipe on the glass turns to the next or previous app
        b.card.addEventListener('pointerdown', (e) => { b.swipe = { x: e.clientX, y: e.clientY, moved: false }; });
        b.card.addEventListener('pointermove', (e) => {
            const s = b.swipe;
            if (!s || s.moved) return;
            const dx = e.clientX - s.x;
            if (Math.abs(dx) > SLIDE_START * b.u && Math.abs(dx) > Math.abs(e.clientY - s.y)) { s.moved = true; turn(dx < 0 ? 1 : -1); }
        });
        b.card.addEventListener('pointercancel', () => { b.swipe = null; });
        b.el.addEventListener('click', (e) => {
            if (bar !== b || b.busy || b.closing) return;
            const t = e.target && e.target.closest ? e.target.closest('[data-act], .wm-ti-arrow') : null;
            const swiped = b.swipe && b.swipe.moved;
            b.swipe = null;
            if (t && t.classList.contains('wm-ti-arrow')) { turn(Number(t.dataset.dir) || 1); return; }
            if (t) { const row = t.closest('.wm-ti-super-note'); act(t.dataset.act, row ? row.dataset.id : '', t); return; }
            // the glass puts it away, as the Super Bar's card does
            if (!swiped && e.target && e.target.closest && e.target.closest('.wm-ti-super-card')) closeBar();
        });
        b.el.addEventListener('keydown', (e) => {
            // Enter sends a reply (Shift+Enter is a new line)
            if (e.key !== 'Enter' || e.shiftKey || !e.target.matches || !e.target.matches('.wm-ti-super-reply textarea')) return;
            e.preventDefault();
            act('send', b.reply ? b.reply.id : '', e.target);
        });
    }

    /** The app on the glass: its icon, its name and how many it has, drawn as a panel page. */
    function drawHead(dir) {
        const b = bar;
        if (!b) return;
        const pkg = b.heads[b.at];
        const mine = notesOf(pkg);
        const pg = {
            title: appInfo(pkg).label,
            line2: mine.length ? `${mine.length} ${mine.length === 1 ? 'notification' : 'notifications'}` : 'No new notifications',
            line3: mine.length ? `Latest ${when(mine[0].time)}` : ''
        };
        const html = `<div class="wm-ti-pg">${b.g.pageHtml({ icon: iconOf(pkg) || 's:contacts' }, pg)}</div>`;
        if (html !== b.headKey) {
            b.headKey = html;
            b.head.innerHTML = html;
            const el = b.head.firstElementChild || b.head.firstChild;
            // a turn slides the new app in from the side it came from
            if (dir && el && typeof el.animate === 'function') el.animate([{ transform: `translateX(${dir * 100}%)`, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: PAGE_MS, easing: 'cubic-bezier(0.2, 0, 0.2, 1)' });
        }
        const one = b.heads.length < 2;
        if (b.prev.hidden !== one) b.prev.hidden = one;
        if (b.next.hidden !== one) b.next.hidden = one;
    }

    function turn(dir) {
        const b = bar;
        if (!b || b.closing || b.heads.length < 2) return;
        const n = b.heads.length;
        b.at = (b.at + dir + n) % n;
        b.reply = null;
        b.sel = null;
        drawHead(dir);
        drawList();
        b.body.scrollTop = 0;
        if (sh) sh.refreshSoftKeys();
    }

    function noteHtml(n, b) {
        const img = (src, cls) => (src ? `<img${cls ? ` class="${cls}"` : ''} src="${esc(src)}" alt="" draggable="false">` : '');
        let body = '';
        const ms = Array.isArray(n.messages) ? n.messages : [];
        if (ms.length) {
            const solo = ms.every((m) => !m.sender || m.sender === n.title);
            body = `<span class="wm-ti-super-msgs">${ms.slice(-6).map((m) => `<span class="wm-ti-super-msg">${m.sender && !solo ? `<b>${esc(m.sender)}</b> ` : ''}${m.me ? '<b>Me</b> ' : ''}${esc(m.text || (m.image ? 'Picture' : ''))}</span>`).join('')}</span>`;
        } else if (Array.isArray(n.lines) && n.lines.length) {
            body = `<span class="wm-ti-super-lines">${n.lines.slice(0, 6).map((l) => `<span>${esc(l)}</span>`).join('')}</span>`;
        } else if (n.text) body = `<span class="wm-ti-super-note-body">${esc(n.text)}</span>`;
        const title = n.conversation && n.conversation !== n.title ? n.conversation : (n.title || appInfo(n.package).label);
        const pic = n.picture || (ms.slice().reverse().find((m) => m.image) || {}).image || '';
        // its buttons (gone once the app's process that kept them restarted: stale)
        const acts = !n.stale && Array.isArray(n.actions) && n.actions.length
            ? `<div class="wm-ti-super-acts">${n.actions.slice(0, 3).map((a) => `<button type="button" class="wm-ti-super-act${b.reply && b.reply.id === n.id && b.reply.index === a.index ? ' is-on' : ''}" data-act="${a.reply ? 'reply' : 'act'}" data-i="${Number(a.index) || 0}" data-label="${esc(a.label || '')}">${esc(a.title)}</button>`).join('')}</div>`
            : '';
        const reply = b.reply && b.reply.id === n.id
            ? `<div class="wm-ti-super-reply"><textarea class="wm-edit" rows="2" placeholder="${esc(b.reply.label)}">${esc(b.reply.draft || '')}</textarea><button type="button" class="wm-ti-super-act" data-act="send">Send</button></div>`
            : '';
        return `<div class="wm-ti-super-note-row"><button type="button" class="wm-ti-super-note-open" data-act="open"><span class="wm-ti-super-note-text"><span class="wm-ti-super-note-top"><span class="wm-ti-super-note-title">${esc(title)}</span><span class="wm-ti-super-note-when">${esc(when(n.time))}</span></span>${n.subText ? `<span class="wm-ti-super-note-app">${esc(n.subText)}</span>` : ''}${body}</span>${img(n.large, 'wm-ti-super-large')}</button>`
            + `<button type="button" class="wm-ti-super-note-x" data-act="dismiss" aria-label="Clear"></button></div>`
            + `${pic ? `<button type="button" class="wm-ti-super-pic" data-act="open">${img(pic, '')}</button>` : ''}${acts}${reply}`;
    }

    /** The app's notifications, newest first; only rows whose notification changed are drawn again. */
    function drawList() {
        const b = bar;
        if (!b) return;
        const pkg = b.heads[b.at];
        const mine = notesOf(pkg);
        // a reply being typed keeps its words; its notification gone, the box goes with it
        const ta = b.list.querySelector && b.list.querySelector('.wm-ti-super-reply textarea');
        if (b.reply && ta) b.reply.draft = ta.value;
        if (b.reply && !mine.some((n) => n.id === b.reply.id)) b.reply = null;
        const keep = new Set();
        let prev = null;
        for (const n of mine) {
            const html = noteHtml(n, b);
            let row = b.rows.get(n.id);
            const typing = row && document.activeElement && row.contains && row.contains(document.activeElement) && document.activeElement.tagName === 'TEXTAREA';
            if (!row) { row = mk('div', 'wm-ti-super-note'); row.dataset.id = n.id; b.rows.set(n.id, row); }
            if (!typing && row._html !== html) { row.innerHTML = html; row._html = html; }
            const want = prev ? prev.nextSibling : b.list.firstChild;
            if (want !== row) b.list.insertBefore(row, want || null);
            prev = row;
            keep.add(n.id);
        }
        for (const [id, row] of b.rows) if (!keep.has(id)) { row.remove(); b.rows.delete(id); if (b.sel === id) b.sel = null; }
        let empty = b.list.querySelector ? b.list.querySelector('.wm-ti-super-empty') : null;
        if (!mine.length && !empty) { empty = mk('div', 'wm-ti-super-empty'); empty.textContent = 'No notifications'; b.list.appendChild(empty); }
        else if (mine.length && empty) empty.remove();
    }

    /** The list at [id]: it scrolls so the notification is at the top, selected (null: the top of the list). */
    function jumpTo(id) {
        const b = bar;
        if (!b) return;
        const row = id ? b.rows.get(id) : null;
        if (b.sel && b.sel !== id) { const old = b.rows.get(b.sel); if (old) old.classList.remove('is-sel'); }
        b.sel = row ? id : null;
        if (!row) { b.body.scrollTop = 0; return; }
        if (!row.classList.contains('is-sel')) row.classList.add('is-sel');
        b.body.scrollTop = Math.max(0, row.offsetTop - 4 * b.u);
    }

    function act(kind, id, t) {
        const B = bridge();
        const b = bar;
        if (!B || !b) return;
        const n = notes.find((x) => x.id === id);
        if (kind === 'open') {
            let ok = false;
            try { ok = !!B.open(id); } catch (_) { ok = false; }
            // its intent gone (an old app): the app itself
            if (!ok && n) { launchApp(n.package); return; }
            if (ok) closeBar(true);
            return;
        }
        if (kind === 'dismiss') { try { B.dismiss(id); } catch (_) { /* gone */ } return; }
        if (kind === 'act') { try { B.action(id, Number(t.dataset.i) || 0, null); } catch (_) { /* old app */ } return; }
        if (kind === 'reply') {
            const i = Number(t.dataset.i) || 0;
            b.reply = b.reply && b.reply.id === id && b.reply.index === i ? null : { id, index: i, label: t.dataset.label || 'Reply', draft: '' };
            drawList();
            const ta = b.list.querySelector && b.list.querySelector('.wm-ti-super-reply textarea');
            if (ta && typeof ta.focus === 'function') ta.focus();
            return;
        }
        if (kind === 'send') {
            const box = t.closest ? t.closest('.wm-ti-super-reply') : null;
            const ta = box && box.querySelector ? box.querySelector('textarea') : null;
            const text = ta ? String(ta.value || '').trim() : '';
            if (!text || !b.reply) return;
            let ok = false;
            try { ok = !!B.action(b.reply.id, b.reply.index, text); } catch (_) { ok = false; }
            if (ok) { b.reply = null; drawList(); }
        }
    }

    // ---------------------------------------------------------------- the item

    const OPTIONS = [
        // the checked apps in their order (the order they page in "Page per App" and on the bar)
        { key: 'apps', label: 'Social apps', type: 'orderedChecks', value: '', get choices() { return appChoices(); } },
        { key: 'paging', label: 'Left and right', type: 'combo', value: 'date', choices: PAGING }
    ];

    function register() {
        sh = window.wmShell;
        if (!sh || sh.version !== '6.5' || typeof sh.registerTodayItem !== 'function') return;
        readNotes();
        window.addEventListener('androidsocialnotifications', onChange, { signal: appScopeSignal });
        // notification access allowed in Android's settings: seen when the page comes back
        document.addEventListener('visibilitychange', () => { if (!document.hidden && !access) onChange(); }, { signal: appScopeSignal });
        document.addEventListener('wmSettingsChange', (e) => {
            const keys = (e && e.detail && e.detail.keys) || [];
            if (keys.includes(sh.todayOptionsKey || 'wmTodayOptions')) { syncApps(); repaint(); }
        }, { signal: appScopeSignal });
        // an app made a Messaging account (#885) leaves Social, and comes back when it is one no more
        const t = window.textMessaging;
        if (t && typeof t.on === 'function') {
            const onAccount = () => { syncApps(); repaint(); };
            t.on('account', onAccount);
            if (appScopeSignal && typeof t.off === 'function') appScopeSignal.addEventListener('abort', () => t.off('account', onAccount), { once: true });
        }
        sh.registerTodayItem({
            id: ID,
            label: 'Social',
            icon: 'app-contacts',
            after: 'text',
            // its times are clock times (today) or dates: a new day redraws Today whole; no minute tick (#890)
            wantsMinute: false,
            options: OPTIONS,
            text: rowText,
            onTap: () => {
                const apps = chosen();
                if (!apps.length) { openOptions(); return; }
                const n = shownNotes()[0];
                launchApp(n ? n.package : apps[0]);
            },
            titanium: () => panel()
        });
        syncApps();
    }

    if (window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true, signal: appScopeSignal });
})();
