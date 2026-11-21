/**
 * Notifications in the DeX desktop's tray (StaticForge #1005).
 *
 * A Bell icon (Windows Calendar's reminder bell, WinCal.exe icon 116) shown by default (Customize Notification Icons can
 * hide it like any other). It rings (the bell with its six lines) while a notification has come that the user has not
 * seen in the flyout yet, and is the plain bell once every one has been seen (wincal-116-seen-16.png, the same art
 * without the lines; Yukimi, Nov 21). Right-click: Open, Manage Channels..., Clear All.
 *
 * The flyout: the phone's notifications, one group per app, the group with the newest notification first and each group
 * newest first (Yukimi: "sort by date"). A group of several is stacked as Android stacks them and collapsed by default:
 * its newest notification, then the next ones as one-line peeks over the stack's edges; a click on the stack or the
 * group's expando opens it. Each notification draws everything Android gives it (large icon, title / conversation, its
 * own time or a running clock, sub / info text, the text or BigText, inbox lines, chat messages with faces, progress or
 * marquee, big picture, summary, buttons, a reply box). Right-click on a notification or a group: Open, Dismiss, Hide This
 * Notification Group (the app), Hide "<channel>" Notifications, Manage Channels.... The flyout can be resized from its
 * top and left edges and remembers its size (localStorage melatonDexNotifySize).
 *
 * Manage Channels: every program that has notification channels on the phone (AndroidPhoneNotifications
 * requestChannelNames / channelNames, plus every program and channel seen here), in the kit's tree list with a "Show in
 * the Bell" check box per program and per channel. What is cleared is kept in localStorage melatonDexNotifyFilter
 * ({ apps: { pkg: false }, channels: { 'pkg|channel': false }, known: { pkg: { app, channels: [id] } } }); a hidden
 * notification is neither listed nor rings the bell (it stays on the phone).
 *
 * Source: the Android app's AndroidPhoneNotifications bridge in this window. The list is read once the desktop is up and
 * idle and then on each 'androidnotifications' (the bell must ring), never on a timer and never on the start path.
 * Delivering notifications stays the app's native work (cafeready-background): this only shows them.
 *
 * Only in the DeX window (AndroidDisplay.isDesktop() with the desktop shell and the bridge present).
 */
(function () {
    'use strict';

    const root = typeof window !== 'undefined' ? window : null;
    const doc = typeof document !== 'undefined' ? document : null;
    if (!root || !doc) return;
    const isDesktop = (() => {
        try { return !!(root.AndroidDisplay && typeof root.AndroidDisplay.isDesktop === 'function' && root.AndroidDisplay.isDesktop()); } catch (_) { return false; }
    })();
    const N = root.AndroidPhoneNotifications;
    if (!isDesktop || root.uiShell === 'mobile' || !N || typeof N.list !== 'function') return;

    const appScopeSignal = (root.melatonSegments && typeof root.melatonSegments.callerSignal === 'function' && root.melatonSegments.callerSignal()) || undefined;

    const ICON_ID = 'androidNotifyTrayIcon';
    const SEEN_KEY = 'melatonDexNotifySeen';
    const FILTER_KEY = 'melatonDexNotifyFilter';
    const SIZE_KEY = 'melatonDexNotifySize';
    const SYSTEM_RIGHT = ['nightshadeTrayIcon', 'powerTrayIcon', 'modemTrayIcon', 'volumeTrayIcon'];
    const MENU_ID = 'android-notify-menu';
    const TRAY_MENU_ID = 'android-notify-tray-menu';
    // the bell and the bell without its lines, each with its DPI tiers (the plain one is not in the tiers' img.css)
    const bellArt = (name) => {
        const one = `/static_images/vista-dlg/${name}`;
        const tier = (t) => `/static_images/hidpi/${t}/vista-dlg/${name}`;
        return { src: one, srcset: `${one} 1x, ${tier(125)} 1.25x, ${tier(150)} 1.5x, ${tier(175)} 1.75x, ${tier(200)} 2x` };
    };
    const BELL_RING = bellArt('wincal-116-16.png');
    const BELL_SEEN = bellArt('wincal-116-seen-16.png');
    const PEEKS = 2;           // a collapsed stack shows this many more notifications as one-line peeks
    const MIN_W = 300;
    const MIN_H = 220;

    let icon = null;
    let flyout = null;
    let frame = null;
    let all = [];              // every notification the phone has
    let list = [];             // the ones the Bell shows (not hidden in Manage Channels)
    let read0 = false;
    let reply = null;           // { key, index, label, draft }
    const expanded = new Map(); // notification key -> open (the user's choice; else the newest single one is open)
    const stacks = new Map();   // package -> open (the user's choice; stacks start collapsed)
    let clockTimer = 0;

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const call = (name, ...args) => { try { return typeof N[name] === 'function' ? N[name](...args) : undefined; } catch (_) { return undefined; } };
    const hasAccess = () => call('access') !== false;
    const isOpen = () => !!(flyout && !flyout.classList.contains('hidden'));
    const postedAt = (n) => Number(n.time) || 0;
    const readJson = (key, fallback) => { try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v && typeof v === 'object' ? v : fallback; } catch (_) { return fallback; } };
    const writeJson = (key, v) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch (_) { /* private mode: this visit only */ } };

    // ---- what the Bell shows (Manage Channels, Hide This Notification Group) ----

    function readFilter() {
        const f = readJson(FILTER_KEY, {});
        return { apps: f.apps && typeof f.apps === 'object' ? f.apps : {}, channels: f.channels && typeof f.channels === 'object' ? f.channels : {}, known: f.known && typeof f.known === 'object' ? f.known : {} };
    }
    let filter = readFilter();
    const shows = (n) => filter.apps[n.package] !== false && !(n.channel && filter.channels[`${n.package}|${n.channel}`] === false);

    /** The programs and channels seen here, kept for Manage Channels (written only when something new came). */
    function remember(notes) {
        let changed = false;
        notes.forEach((n) => {
            if (!n.package) return;
            const k = filter.known[n.package] || (filter.known[n.package] = { app: '', channels: [] });
            if (n.app && k.app !== n.app) { k.app = n.app; changed = true; }
            if (n.channel && !k.channels.includes(n.channel)) { k.channels.push(n.channel); changed = true; }
        });
        if (changed) writeJson(FILTER_KEY, filter);
    }

    function setShown(pkg, channel, on) {
        filter = readFilter();
        if (channel) {
            if (on) delete filter.channels[`${pkg}|${channel}`]; else filter.channels[`${pkg}|${channel}`] = false;
        } else if (on) delete filter.apps[pkg];
        else filter.apps[pkg] = false;
        writeJson(FILTER_KEY, filter);
        apply();
    }

    /** The list again through the filter: the icon, and the flyout when it shows. */
    function apply() {
        list = all.filter(shows);
        paintIcon();
        if (isOpen()) { render(); positionFlyout(); }
    }

    // ---- seen / unseen ----

    /** A notification is new until the flyout has shown it (a notification posted again with new content is new again). */
    const unseen = () => { const seen = readJson(SEEN_KEY, {}); return list.filter((n) => !(seen[n.key] >= postedAt(n))); };
    function markAllSeen() {
        const next = {};
        all.forEach((n) => { if (shows(n)) next[n.key] = postedAt(n); }); // only the notifications still on the phone are kept
        writeJson(SEEN_KEY, next);
        paintIcon();
    }

    function read() {
        read0 = true;
        let next = [];
        try { next = JSON.parse(N.list() || '[]'); } catch (_) { next = []; }
        all = (Array.isArray(next) ? next : []).filter((n) => n && n.key);
        remember(all);
        list = all.filter(shows);
        paintIcon();
    }

    // ---- the icon ----

    function paintIcon() {
        if (!icon) return;
        const fresh = read0 ? unseen().length : 0;
        const art = fresh ? BELL_RING : BELL_SEEN;
        const img = icon.querySelector('img');
        if (img && img.getAttribute('src') !== art.src) { img.setAttribute('src', art.src); img.setAttribute('srcset', art.srcset); }
        const state = fresh ? 'new' : 'seen';
        if (icon.dataset.state !== state) icon.dataset.state = state;
        const n = list.length;
        const tip = !read0 ? 'Notifications'
            : !hasAccess() ? 'Notifications: access is off'
            : fresh ? `Notifications: ${fresh} new${n > fresh ? ` (${n} in all)` : ''}`
            : n ? `Notifications: ${n}` : 'Notifications: none';
        if (icon.title !== tip) icon.title = tip;
    }

    function ensureIcon() {
        if (icon) return icon;
        const box = doc.querySelector('#desktopTaskbar .taskbar-tray-icons, .taskbar-tray-icons');
        if (!box) return null;
        icon = doc.getElementById(ICON_ID);
        if (!icon) {
            icon = doc.createElement('div');
            icon.className = 'taskbar-tray-icon';
            icon.id = ICON_ID;
            icon.title = 'Notifications';
            // the plain bell until the first read (no bridge call at boot, installed-boot-zero-wait)
            icon.innerHTML = `<img src="${BELL_SEEN.src}" srcset="${BELL_SEEN.srcset}" alt="" width="16" height="16" draggable="false">`;
            const before = SYSTEM_RIGHT.map((id) => doc.getElementById(id)).find((el) => el && el.parentElement === box);
            box.insertBefore(icon, before || null);
        }
        icon.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); toggleFlyout(); });
        icon.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); showTrayMenu(e); });
        return icon;
    }

    // ---- one notification ----

    function clockText(ms) {
        const t = Math.max(0, Math.floor(ms / 1000));
        const h = Math.floor(t / 3600);
        const m = Math.floor((t % 3600) / 60);
        const s = String(t % 60).padStart(2, '0');
        return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
    }
    const chronoText = (c) => clockText(c.countDown ? Number(c.base) - Date.now() : Date.now() - Number(c.base));

    function whenText(n) {
        if (n.showWhen === false) return '';
        const t = Number(n.when) || postedAt(n);
        const d = new Date(t);
        if (!t || Number.isNaN(d.getTime())) return '';
        return d.toDateString() === new Date().toDateString()
            ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
            : d.toLocaleDateString([], { month: 'numeric', day: 'numeric' });
    }

    /** A program's picture as the phone's Start menu draws it (androidDesktopPrograms.js iconFor). */
    function programPic(pkg, px) {
        const P = root.melatonAndroidPrograms;
        return P && typeof P.iconFor === 'function' ? P.iconFor({ package: pkg, icon: '' }, px) : { src: '', srcset: '' };
    }
    function appPic(n, px) {
        const pic = programPic(n.package, px);
        if (pic.src) return `<img src="${esc(pic.src)}" srcset="${esc(pic.srcset)}" alt="" width="${px}" height="${px}" draggable="false">`;
        // not in the Program Icons store: Android's own icon, as the bridge gives it
        return n.icon ? `<img src="${esc(n.icon)}" alt="" width="${px}" height="${px}" draggable="false">` : '';
    }
    const imageTag = (id, cls, px) => (id ? `<img class="${cls}" data-img="${esc(id)}" alt=""${px ? ` width="${px}" height="${px}"` : ''} draggable="false">` : '');
    const titleOf = (n) => (n.conversation && n.conversation !== n.title ? n.conversation : (n.title || n.app || n.package));

    function isExpandable(n) {
        return !!((n.shortText && n.text && n.shortText !== n.text) || n.picture || (Array.isArray(n.lines) && n.lines.length > 2)
            || (Array.isArray(n.messages) && n.messages.length > 2) || (n.text && n.text.length > 140));
    }

    function bodyHtml(n, open) {
        if (Array.isArray(n.messages) && n.messages.length) {
            // a one-to-one chat names its sender in the title already: only other senders are named
            const solo = !n.group && n.messages.every((m) => !m.sender || m.sender === n.title);
            const msgs = open ? n.messages : n.messages.slice(-2);
            return `<div class="android-notify-msgs">${msgs.map((m) => `<div class="android-notify-msg">${m.avatar && !solo ? imageTag(m.avatar, 'android-notify-avatar', 16) : ''}<span class="android-notify-msg-text">${m.sender && !solo ? `<b>${esc(m.sender)}</b> ` : ''}${m.text ? esc(m.text) : (m.image ? '<i>Picture</i>' : '')}</span></div>`).join('')}</div>`;
        }
        if (Array.isArray(n.lines) && n.lines.length) {
            const lines = open ? n.lines : n.lines.slice(0, 2);
            return `<div class="android-notify-lines">${lines.map((l) => `<span class="network-flyout-sub">${esc(l)}</span>`).join('')}${!open && n.lines.length > 2 ? `<span class="network-flyout-sub">+${n.lines.length - 2} more</span>` : ''}</div>`;
        }
        const text = open ? (n.text || n.shortText) : (n.shortText || n.text);
        return text ? `<span class="network-flyout-sub android-notify-text${open ? ' is-open' : ''}">${esc(text)}</span>` : '';
    }

    /** One line for a notification under a collapsed stack: its title and what it says. */
    function peekText(n) {
        const m = Array.isArray(n.messages) && n.messages.length ? n.messages[n.messages.length - 1] : null;
        const said = m ? `${m.sender && m.sender !== n.title ? `${m.sender}: ` : ''}${m.text || (m.image ? 'Picture' : '')}`
            : (Array.isArray(n.lines) && n.lines.length ? n.lines[0] : (n.shortText || n.text || ''));
        return { title: titleOf(n), said };
    }

    function progressHtml(n) {
        const p = n.progress;
        if (!p) return '';
        const marquee = p.indeterminate || !(Number(p.max) > 0);
        const pct = marquee ? 0 : Math.max(0, Math.min(100, Math.round((Number(p.value) / Number(p.max)) * 100)));
        // the kit progress bar (7.css [role=progressbar]); its fill's width is set after the row is drawn (no style= here)
        return `<div class="android-notify-progress${marquee ? ' marquee' : ''}" role="progressbar" aria-valuemin="0" aria-valuemax="100"${marquee ? '' : ` aria-valuenow="${pct}"`}>${marquee ? '' : '<div></div>'}</div>`;
    }

    function noteHtml(n, open) {
        const acts = Array.isArray(n.actions) ? n.actions.filter((a) => a && a.title) : [];
        const replying = reply && reply.key === n.key;
        const sub = [n.subText, n.infoText].filter(Boolean).join(' · ');
        const when = n.chronometer ? `<span class="android-notify-chrono" data-base="${esc(n.chronometer.base)}" data-down="${n.chronometer.countDown ? 1 : 0}">${esc(chronoText(n.chronometer))}</span>` : esc(whenText(n));
        // the large icon (a face, an album), with the app's own picture to fall back to when it cannot be read
        let pic = appPic(n, 32);
        if (n.large) {
            const app = programPic(n.package, 32);
            const fb = app.src ? ` data-fb-src="${esc(app.src)}" data-fb-srcset="${esc(app.srcset)}"` : (n.icon ? ` data-fb-src="${esc(n.icon)}"` : '');
            pic = imageTag(n.large, 'android-notify-large', 32).replace('<img ', `<img${fb} `);
        }
        return `<div class="android-notify-note vista-treelist-row${open ? ' is-open' : ''}${n.ongoing ? ' is-ongoing' : ''}" data-key="${esc(n.key)}" role="listitem" tabindex="0">
            <div class="android-notify-main" data-act="open">
                <span class="android-notify-pic">${pic}</span>
                <div class="network-flyout-text android-notify-content">
                    <span class="android-notify-top"><span class="network-flyout-name">${esc(titleOf(n))}</span><span class="network-flyout-sub android-notify-time">${when}</span></span>
                    ${sub ? `<span class="network-flyout-sub android-notify-subtext">${esc(sub)}</span>` : ''}
                    ${bodyHtml(n, open)}
                    ${progressHtml(n)}
                    ${open && n.picture ? `<span class="android-notify-picture">${imageTag(n.picture, '', 0)}</span>` : ''}
                    ${open && n.summaryText ? `<span class="network-flyout-sub android-notify-summary">${esc(n.summaryText)}</span>` : ''}
                </div>
            </div>
            ${isExpandable(n) ? `<button type="button" class="android-notify-expando${open ? ' is-open' : ''}" data-act="expand" title="${open ? 'Show less' : 'Show more'}" aria-label="${open ? 'Show less' : 'Show more'}" aria-expanded="${open ? 'true' : 'false'}"></button>` : ''}
            ${n.clearable === false ? '' : '<button type="button" class="tray-balloon-close" data-act="dismiss" title="Dismiss" aria-label="Dismiss"></button>'}
            ${acts.length ? `<div class="android-notify-actions">${acts.map((a) => `<button type="button" data-act="action" data-i="${esc(a.index)}" data-reply="${a.reply ? '1' : '0'}" data-label="${esc(a.label || a.title)}">${esc(a.title)}</button>`).join('')}</div>` : ''}
            ${replying ? `<div class="android-notify-reply"><input type="text" class="android-notify-reply-text" placeholder="${esc(reply.label)}" value="${esc(reply.draft)}" autocomplete="off" spellcheck="false"><button type="button" data-act="send">Send</button></div>` : ''}
        </div>`;
    }

    // ---- the flyout ----

    /** The groups: one per app, newest first; inside each the newest first (Yukimi: "sort by date"). */
    function groupsOf(notes) {
        const sorted = notes.slice().sort((a, b) => postedAt(b) - postedAt(a));
        const groups = new Map();
        sorted.forEach((n) => {
            const k = n.package || n.app || '';
            if (!groups.has(k)) groups.set(k, []);
            groups.get(k).push(n);
        });
        return Array.from(groups.values());
    }

    function groupHtml(notes, newestKey) {
        const head = notes[0];
        const pkg = head.package || '';
        const count = notes.reduce((s, n) => s + Math.max(1, Number(n.number) || 0), 0);
        const canClear = notes.some((n) => n.clearable !== false);
        const stacked = notes.length > 1;
        const open = stacked && stacks.get(pkg) === true;
        const noteOpen = (n) => (expanded.has(n.key) ? expanded.get(n.key) : (!stacked && n.key === newestKey));
        let body;
        if (!stacked || open) {
            body = notes.map((n) => noteHtml(n, noteOpen(n))).join('');
        } else {
            // collapsed, as Android stacks a group: the newest in full, the next ones as peeks over the stack's edges
            const more = notes.slice(1);
            const peeks = more.slice(0, PEEKS).map((n) => { const p = peekText(n); return `<span class="android-notify-peek"><b>${esc(p.title)}</b>${p.said ? ` ${esc(p.said)}` : ''}</span>`; }).join('');
            const rest = more.length - PEEKS;
            body = `${noteHtml(head, expanded.get(head.key) === true)}
                <div class="android-notify-stack vista-treelist-row" data-act="stack" tabindex="0" aria-label="Show all ${notes.length} notifications from ${esc(head.app || pkg)}">
                    ${peeks}${rest > 0 ? `<span class="android-notify-peek network-flyout-sub">+${rest} more</span>` : ''}
                    <span class="android-notify-stack-edge"></span><span class="android-notify-stack-edge is-back"></span>
                </div>`;
        }
        return `<div class="android-notify-app${stacked ? ' is-stack' : ''}${open ? ' is-open' : ''}" role="list" aria-label="${esc(head.app || pkg)}" data-pkg="${esc(pkg)}">
            <div class="android-notify-app-head network-flyout-heading" data-act="head">${appPic(head, 16)}<span>${esc(head.app || pkg)}</span>${count > 1 ? `<span class="android-notify-count">(${count})</span>` : ''}
            ${stacked ? `<button type="button" class="android-notify-expando${open ? ' is-open' : ''}" data-act="stack" title="${open ? 'Stack these notifications' : 'Show all of them'}" aria-label="${open ? 'Stack these notifications' : 'Show all of them'}" aria-expanded="${open ? 'true' : 'false'}"></button>` : ''}
            ${canClear ? '<button type="button" class="tray-balloon-close" data-act="clearapp" title="Clear these notifications" aria-label="Clear these notifications"></button>' : ''}</div>
            ${body}
        </div>`;
    }

    function flyoutHtml() {
        if (!hasAccess()) {
            return `<div class="network-flyout-body"><div class="network-flyout-heading">Notifications</div>
                <span class="network-flyout-sub">Allow notification access on the phone to see its notifications here.</span></div>
                <div class="network-flyout-links"><button type="button" class="network-flyout-link" data-act="access">Turn on notification access</button></div>`;
        }
        const hidden = all.length - list.length;
        // Manage channels on the left, Clear all on the right (Yukimi, Nov 21)
        const links = `<div class="network-flyout-links">
            <button type="button" class="network-flyout-link" data-act="channels">Manage channels${hidden ? ` (${hidden} hidden)` : ''}...</button>
            ${list.some((n) => n.clearable !== false) ? '<button type="button" class="network-flyout-link" data-act="clear">Clear all</button>' : ''}</div>`;
        if (!list.length) {
            return `<div class="network-flyout-body android-notify-body"><div class="network-flyout-heading">Notifications</div><span class="network-flyout-sub">No new notifications</span></div>${links}`;
        }
        const groups = groupsOf(list);
        const newestKey = groups[0][0].key;
        return `<div class="network-flyout-body android-notify-body win7">
            <div class="network-flyout-heading">Notifications</div>
            ${groups.map((notes) => groupHtml(notes, newestKey)).join('')}
        </div>${links}`;
    }

    /**
     * Where the app serves a picture by id (DSApp imageBase(): its file in the app's cache folder, deleted when the
     * notification goes). Pictures are never base64 strings in the page (no-base64-images rule, Yukimi Nov 21 2026): an
     * older app without imageBase() shows the program's icon in place of a large icon, and no other picture.
     */
    let imageBaseUrl = null;
    function imageBase() {
        if (imageBaseUrl === null) imageBaseUrl = typeof N.imageBase === 'function' ? String(call('imageBase') || '') : '';
        return imageBaseUrl;
    }

    /** The program's icon in place of a picture the app cannot give (a large icon), else nothing. */
    function pictureMissing(img) {
        if (img.dataset.fbSrc) {
            img.setAttribute('src', img.dataset.fbSrc);
            if (img.dataset.fbSrcset) img.setAttribute('srcset', img.dataset.fbSrcset);
            delete img.dataset.fbSrc;
        } else img.hidden = true;
    }

    /** After a draw: the pictures from the app, the progress bars' fill, the running clocks. */
    function afterRender() {
        const base = imageBase();
        frame.querySelectorAll('img[data-img]').forEach((img) => {
            if (!base) { pictureMissing(img); return; }
            // loaded by the WebView from the app's file (no copy kept by the page)
            const url = base + encodeURIComponent(img.dataset.img);
            if (img.getAttribute('src') !== url) {
                img.addEventListener('error', () => pictureMissing(img), { once: true });
                img.setAttribute('src', url);
            }
        });
        frame.querySelectorAll('.android-notify-progress[aria-valuenow] > div').forEach((bar) => {
            const w = `${bar.parentElement.getAttribute('aria-valuenow')}%`;
            if (bar.style.width !== w) bar.style.width = w;
        });
        syncClock();
    }

    /** Calls and timers count while the flyout shows them (a once-a-second text tick, stopped when it closes). */
    function syncClock() {
        const want = isOpen() && !!frame.querySelector('.android-notify-chrono');
        if (want && !clockTimer) {
            clockTimer = setInterval(() => { // perf: allow a running call / timer clock while the flyout shows it
                if (!isOpen()) { syncClock(); return; }
                frame.querySelectorAll('.android-notify-chrono').forEach((el) => {
                    const t = chronoText({ base: el.dataset.base, countDown: el.dataset.down === '1' });
                    if (el.textContent !== t) el.textContent = t;
                });
            }, 1000);
        } else if (!want && clockTimer) {
            clearInterval(clockTimer);
            clockTimer = 0;
        }
    }

    function render() {
        if (!isOpen()) return;
        // a reply being typed keeps its words and its focus: the list waits until the box closes
        const typing = frame.querySelector('.android-notify-reply-text');
        if (typing && doc.activeElement === typing) { reply.draft = typing.value; return; }
        if (reply && !list.some((n) => n.key === reply.key)) reply = null;
        const html = flyoutHtml();
        if (frame.dataset.html !== html) {
            const body = frame.querySelector('.android-notify-body');
            const top = body ? body.scrollTop : 0;
            frame.dataset.html = html;
            frame.innerHTML = html;
            const nb = frame.querySelector('.android-notify-body');
            if (nb && top) nb.scrollTop = top;
            const box = frame.querySelector('.android-notify-reply-text');
            if (box) box.focus({ preventScroll: true });
        }
        afterRender();
    }

    function openNote(n) {
        let ok = !!call('open', n.key);
        // its intent gone (or an older app): the app itself
        if (!ok && n.package && root.AndroidApps && typeof root.AndroidApps.launch === 'function') {
            try { ok = root.AndroidApps.launch(n.package) === true; } catch (_) { ok = false; }
        }
        if (ok) hideFlyout();
    }

    const toggleStack = (pkg) => { stacks.set(pkg, !(stacks.get(pkg) === true)); render(); positionFlyout(); };
    const clearApp = (pkg) => list.filter((n) => n.package === pkg && n.clearable !== false).forEach((n) => call('dismiss', n.key));

    function onClick(e) {
        e.stopPropagation();
        const el = e.target.closest('[data-act]');
        if (!el) return;
        const act = el.dataset.act;
        if (act === 'access') { call('requestAccess'); hideFlyout(); return; }
        if (act === 'clear') { list.filter((n) => n.clearable !== false).forEach((n) => call('dismiss', n.key)); return; }
        if (act === 'channels') { hideFlyout(); openChannels(); return; }
        const group = el.closest('.android-notify-app');
        const pkg = group ? group.dataset.pkg : '';
        if (act === 'clearapp') { clearApp(pkg); return; }
        if (act === 'stack') { toggleStack(pkg); return; }
        if (act === 'head') { if (group && group.classList.contains('is-stack')) toggleStack(pkg); return; }
        const row = el.closest('.android-notify-note');
        const n = row && list.find((x) => x.key === row.dataset.key);
        if (!n) return;
        if (act === 'open') { openNote(n); return; }
        if (act === 'dismiss') { call('dismiss', n.key); return; }
        if (act === 'expand') {
            expanded.set(n.key, !row.classList.contains('is-open'));
            render();
            positionFlyout();
            return;
        }
        if (act === 'action') {
            const i = Number(el.dataset.i);
            if (el.dataset.reply === '1') {
                reply = reply && reply.key === n.key && reply.index === i ? null : { key: n.key, index: i, label: el.dataset.label || 'Reply', draft: '' };
                frame.dataset.html = '';
                render();
                return;
            }
            call('action', n.key, i, null);
            return;
        }
        if (act === 'send') {
            const box = row.querySelector('.android-notify-reply-text');
            const text = box ? box.value.trim() : '';
            if (!text || !reply) return;
            if (call('action', reply.key, reply.index, text)) {
                reply = null;
                if (box) box.blur();
                frame.dataset.html = '';
                render();
            }
        }
    }

    function onKey(e) {
        if (e.key === 'Escape') { hideFlyout(); return; }
        if (e.key === 'Enter' && e.target.matches('.android-notify-reply-text')) {
            e.preventDefault();
            const send = e.target.closest('.android-notify-reply').querySelector('[data-act="send"]');
            if (send) send.click();
            return;
        }
        if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.android-notify-stack')) {
            e.preventDefault();
            toggleStack(e.target.closest('.android-notify-app').dataset.pkg);
            return;
        }
        if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.android-notify-note')) {
            e.preventDefault();
            const n = list.find((x) => x.key === e.target.dataset.key);
            if (n) openNote(n);
        }
    }

    // ---- right-click ----

    /** The channels' real names, read on the phone once per visit (dumpsys through its shell) for the menus' text. */
    let namesAsked = false;
    function askChannelNames() {
        if (namesAsked) return;
        namesAsked = true;
        call('requestChannelNames');
    }

    function channelName(pkg, ch) {
        let names = {};
        try { names = JSON.parse(call('channelNames') || '{}') || {}; } catch (_) { names = {}; }
        return (names[pkg] && names[pkg][ch]) || ch;
    }

    function showMenu(e, cfg) {
        const cm = root.contextMenu;
        if (!cm || typeof cm.showMenu !== 'function') return;
        if (!cm.configs) cm.configs = {};
        cm.configs[cfg.id] = { sections: [{ type: 'list', items: cfg.items }], onAction: cfg.onAction };
        cfg.target.dataset.contextMenu = cfg.id;
        cm.showMenu(e, cfg.target);
    }

    /** A notification or a group: Open, Dismiss, Hide This Notification Group, Hide the channel, Manage Channels. */
    function onContextMenu(e) {
        const group = e.target.closest('.android-notify-app');
        if (!group) return;
        e.preventDefault();
        e.stopPropagation();
        const pkg = group.dataset.pkg;
        const row = e.target.closest('.android-notify-note');
        const n = row ? list.find((x) => x.key === row.dataset.key) : null;
        const items = [];
        if (n) {
            items.push({ text: 'Open', action: 'an-open', className: 'context-menu-item-default' });
            if (n.clearable !== false) items.push({ text: 'Dismiss', action: 'an-dismiss' });
        } else if (group.classList.contains('is-stack')) {
            items.push({ text: group.classList.contains('is-open') ? 'Stack' : 'Show All', action: 'an-stack', className: 'context-menu-item-default' });
            if (list.some((x) => x.package === pkg && x.clearable !== false)) items.push({ text: 'Clear These Notifications', action: 'an-clearapp' });
        } else if (list.some((x) => x.package === pkg && x.clearable !== false)) {
            items.push({ text: 'Clear These Notifications', action: 'an-clearapp' });
        }
        if (items.length) items.push({ separator: true });
        items.push({ text: 'Hide This Notification Group', action: 'an-hide-app' });
        if (n && n.channel) items.push({ text: `Hide "${channelName(pkg, n.channel)}" Notifications`, action: 'an-hide-channel' });
        items.push({ separator: true }, { text: 'Manage Channels...', action: 'an-channels' });
        showMenu(e, {
            id: MENU_ID,
            target: row || group,
            items,
            onAction: (action) => {
                if (action === 'an-open' && n) openNote(n);
                else if (action === 'an-dismiss' && n) call('dismiss', n.key);
                else if (action === 'an-stack') toggleStack(pkg);
                else if (action === 'an-clearapp') clearApp(pkg);
                else if (action === 'an-hide-app') setShown(pkg, null, false);
                else if (action === 'an-hide-channel' && n) setShown(pkg, n.channel, false);
                else if (action === 'an-channels') { hideFlyout(); openChannels(); }
            }
        });
    }

    /** The Bell's own menu: Open, Manage Channels..., Clear All. */
    function showTrayMenu(e) {
        hideFlyout();
        if (!read0) read();
        showMenu(e, {
            id: TRAY_MENU_ID,
            target: icon,
            items: [
                { text: 'Open', action: 'at-open', className: 'context-menu-item-default' },
                { text: 'Manage Channels...', action: 'at-channels' },
                { separator: true },
                { text: 'Clear All', action: 'at-clear', disabled: !list.some((n) => n.clearable !== false) }
            ],
            onAction: (action) => {
                if (action === 'at-open') showFlyout();
                else if (action === 'at-channels') openChannels();
                else if (action === 'at-clear') list.filter((n) => n.clearable !== false).forEach((n) => call('dismiss', n.key));
            }
        });
    }

    // ---- Manage Channels ----

    /** Every program with channels on the phone (or seen here), each with its channels, by name. */
    function channelModel() {
        let names = {};
        try { names = JSON.parse(call('channelNames') || '{}') || {}; } catch (_) { names = {}; }
        const P = root.melatonAndroidPrograms;
        const programs = P && typeof P.items === 'function' ? P.items() : [];
        const labelOf = (pkg) => {
            const k = filter.known[pkg];
            if (k && k.app) return k.app;
            const it = programs.find((x) => String(x.launchId || '').startsWith(`android:${pkg}/`));
            return (it && it.text) || pkg;
        };
        const pkgs = new Set(Object.keys(names).concat(Object.keys(filter.known)));
        return Array.from(pkgs).map((pkg) => {
            const ids = new Set(Object.keys(names[pkg] || {}).concat((filter.known[pkg] && filter.known[pkg].channels) || []));
            return {
                pkg,
                app: labelOf(pkg),
                channels: Array.from(ids).map((id) => ({ id, name: (names[pkg] && names[pkg][id]) || id }))
                    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
            };
        }).sort((a, b) => a.app.localeCompare(b.app, undefined, { sensitivity: 'base' }));
    }

    async function openChannels() {
        if (typeof root.showConfirmationDialog !== 'function') return;
        filter = readFilter();
        // the draft: OK keeps it, Cancel drops it
        const draft = { apps: Object.assign({}, filter.apps), channels: Object.assign({}, filter.channels) };
        const open = new Set();
        let tree = null;
        let model = channelModel();
        const appOn = (pkg) => draft.apps[pkg] !== false;
        const chOn = (pkg, id) => draft.channels[`${pkg}|${id}`] !== false;
        const P = root.melatonAndroidPrograms;
        const programs = P && typeof P.items === 'function' ? P.items() : [];
        const androidIcon = (pkg) => {
            const it = programs.find((x) => String(x.launchId || '').startsWith(`android:${pkg}/`));
            if (it && it.imageIcon && !/\/static_images\/wm-android\//.test(it.imageIcon)) return it.imageIcon;
            const n = all.find((x) => x.package === pkg && x.icon);
            return n ? n.icon : '';
        };
        const rows = () => model.map((a) => {
            const pic = programPic(a.pkg, 16).src || androidIcon(a.pkg);
            return {
                id: `a\u0001${a.pkg}`,
                label: a.app,
                tip: `${a.app} (${a.pkg})`,
                icon: pic || undefined,
                cells: { show: { checked: appOn(a.pkg), label: `${a.app}: Show in the Bell` } },
                children: a.channels.map((c) => ({
                    id: `c\u0001${a.pkg}\u0001${c.id}`,
                    label: c.name,
                    tip: `${c.name} (${c.id})`,
                    cells: { show: { checked: appOn(a.pkg) && chOn(a.pkg, c.id), disabled: !appOn(a.pkg), label: `${a.app}, ${c.name}: Show in the Bell` } }
                }))
            };
        });
        const status = (text) => { const el = doc.querySelector('#confirmationDialog .android-notify-channels-status'); if (el && el.textContent !== text) el.textContent = text; };
        const html = `<div class="android-notify-channels win7">
            <p>Choose which of the phone's notifications show in the Bell. A program or channel that is cleared is not listed and does not ring the bell; its notifications stay on the phone.</p>
            <div class="android-notify-channels-list"></div>
            <p class="android-notify-channels-status"></p>
        </div>`;
        const ok = await root.showConfirmationDialog(html, [
            { text: 'OK', value: true, className: 'btn-standard primary' },
            { text: 'Cancel', value: false, className: 'btn-standard' }
        ], null, {
            title: 'Manage Notification Channels',
            width: 560,
            showCloseButton: true,
            onDialogReady: async (signal) => {
                const host = doc.querySelector('#confirmationDialog .android-notify-channels-list');
                if (!host) return;
                const fl = root.featureLoader;
                if (!root.vistaTreeList && fl) { try { await fl.loadFeature('vista_tree_list'); } catch (_) { /* below */ } }
                if (!root.vistaTreeList || (signal && signal.aborted) || !host.isConnected) return;
                tree = root.vistaTreeList.create(host, {
                    label: 'Notification channels',
                    columns: [{ id: 'name', title: 'Program', kind: 'tree' }, { id: 'show', title: 'Show in the Bell', kind: 'check', width: 120 }],
                    rows: rows(),
                    onToggle: (id, isOpenRow) => { if (isOpenRow) open.add(id); else open.delete(id); },
                    onCheck: (id, col, checked) => {
                        const [kind, pkg, ch] = id.split('\u0001');
                        if (kind === 'a') { if (checked) delete draft.apps[pkg]; else draft.apps[pkg] = false; }
                        else if (checked) delete draft.channels[`${pkg}|${ch}`];
                        else draft.channels[`${pkg}|${ch}`] = false;
                        tree.update(rows());
                    }
                });
                // the channels' real names are read on the phone in the background (dumpsys through its shell)
                const asked = call('requestChannelNames');
                status(asked ? "Reading the phone's notification channels..." : (model.length ? '' : 'No program has posted a notification yet.'));
                root.addEventListener('androidnotificationchannels', () => {
                    model = channelModel();
                    if (tree) tree.update(rows());
                    status(model.length ? '' : 'No program has posted a notification yet.');
                }, { signal });
            }
        });
        if (tree && typeof tree.destroy === 'function') { try { tree.destroy(); } catch (_) { /* gone with the dialog */ } }
        if (ok !== true) return;
        filter = readFilter();
        filter.apps = draft.apps;
        filter.channels = draft.channels;
        writeJson(FILTER_KEY, filter);
        apply();
    }

    // ---- the frame: resizing from the top and left edges (anchored at the tray), its size remembered ----

    function savedSize() {
        const s = readJson(SIZE_KEY, null);
        return s && Number(s.w) > 0 && Number(s.h) > 0 ? { w: Number(s.w), h: Number(s.h) } : null;
    }

    function applySize(size) {
        if (!flyout) return;
        const maxW = Math.max(MIN_W, root.innerWidth - 16);
        const maxH = Math.max(MIN_H, root.innerHeight - 60);
        if (!size) {
            if (flyout.dataset.sized) { delete flyout.dataset.sized; flyout.style.width = ''; flyout.style.height = ''; }
            return;
        }
        const w = `${Math.round(Math.min(maxW, Math.max(MIN_W, size.w)))}px`;
        const h = `${Math.round(Math.min(maxH, Math.max(MIN_H, size.h)))}px`;
        if (flyout.dataset.sized !== '1') flyout.dataset.sized = '1';
        if (flyout.style.width !== w) flyout.style.width = w;
        if (flyout.style.height !== h) flyout.style.height = h;
    }

    function wireResize(handle) {
        handle.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();
            const edge = handle.dataset.edge;
            const r = flyout.getBoundingClientRect();
            const start = { x: e.clientX, y: e.clientY, w: r.width, h: r.height };
            try { handle.setPointerCapture(e.pointerId); } catch (_) { /* a synthetic pointer: the moves still come */ }
            let size = { w: r.width, h: r.height };
            const move = (ev) => {
                // the flyout keeps its bottom-right corner at the tray: dragging up / left makes it bigger
                size = {
                    w: edge === 'top' ? start.w : start.w + (start.x - ev.clientX),
                    h: edge === 'left' ? start.h : start.h + (start.y - ev.clientY)
                };
                applySize(size);
                positionFlyout();
            };
            const end = () => {
                handle.removeEventListener('pointermove', move);
                handle.removeEventListener('pointerup', end);
                handle.removeEventListener('pointercancel', end);
                const rr = flyout.getBoundingClientRect();
                writeJson(SIZE_KEY, { w: Math.round(rr.width), h: Math.round(rr.height) });
            };
            handle.addEventListener('pointermove', move);
            handle.addEventListener('pointerup', end);
            handle.addEventListener('pointercancel', end);
        });
    }

    function ensureFlyout() {
        if (flyout) return flyout;
        flyout = doc.createElement('div');
        flyout.id = 'androidNotifyFlyout';
        flyout.className = 'network-flyout android-notify-flyout hidden';
        flyout.setAttribute('role', 'dialog');
        flyout.setAttribute('aria-label', 'Notifications');
        flyout.innerHTML = '<div class="android-notify-frame"></div>'
            + '<div class="android-notify-size" data-edge="top" aria-hidden="true"></div>'
            + '<div class="android-notify-size" data-edge="left" aria-hidden="true"></div>'
            + '<div class="android-notify-size" data-edge="corner" aria-hidden="true"></div>';
        frame = flyout.querySelector('.android-notify-frame');
        flyout.querySelectorAll('.android-notify-size').forEach(wireResize);
        frame.addEventListener('click', onClick);
        frame.addEventListener('keydown', onKey);
        frame.addEventListener('contextmenu', onContextMenu);
        // a list change that came while a reply was being typed is drawn when the box loses focus
        frame.addEventListener('focusout', (e) => {
            if (!e.target.matches('.android-notify-reply-text') || !reply) return;
            reply.draft = e.target.value;
            setTimeout(render, 0);
        });
        doc.body.appendChild(flyout);
        doc.addEventListener('pointerdown', (ev) => {
            if (!isOpen()) return;
            if (flyout.contains(ev.target) || (icon && icon.contains(ev.target))) return;
            // the flyout's own right-click menu is outside it
            if (ev.target.closest && ev.target.closest('.context-menu, .context-menu-overlay')) return;
            hideFlyout();
        }, { capture: true, signal: appScopeSignal });
        return flyout;
    }

    function positionFlyout() {
        if (!flyout || !icon) return;
        const rect = icon.getBoundingClientRect();
        const width = flyout.offsetWidth || 360;
        const margin = 8;
        let left = rect.right + 12 - width;
        left = Math.max(margin, Math.min(root.innerWidth - width - margin, left));
        flyout.style.left = `${left}px`;
        flyout.style.bottom = `${Math.max(margin, root.innerHeight - rect.top + 6)}px`;
    }

    function showFlyout() {
        if (!ensureFlyout()) return;
        // the other tray panels close (Vista shows one at a time)
        try { if (root.melatonControlPanel && root.melatonControlPanel.hideTrayFlyout) root.melatonControlPanel.hideTrayFlyout(); } catch (_) { /* none */ }
        filter = readFilter();
        read();
        // as Android's shade: every stack collapsed and only the newest single notification open each time it opens
        expanded.clear();
        stacks.clear();
        askChannelNames();
        frame.dataset.html = '';
        applySize(savedSize());
        flyout.classList.remove('hidden');
        render();
        positionFlyout();
        // everything in the list has now been seen: the bell stops ringing
        markAllSeen();
    }

    function hideFlyout() {
        if (!flyout) return;
        flyout.classList.add('hidden');
        reply = null;
        syncClock();
    }

    function toggleFlyout() {
        if (isOpen()) hideFlyout();
        else showFlyout();
    }

    // the app says the notifications changed (coalesced on its side): read now, so the bell rings for a new one
    root.addEventListener('androidnotifications', () => {
        if (isOpen()) {
            const typing = frame.querySelector('.android-notify-reply-text');
            read();
            if (typing && doc.activeElement === typing) return; // drawn when the box closes
            render();
            positionFlyout();
            markAllSeen(); // what arrives while it shows is seen
            return;
        }
        read();
    }, { signal: appScopeSignal });

    function desktopUp() {
        try { return typeof root.getClientDesktopState === 'function' && root.getClientDesktopState() === 'desktop'; } catch (_) { return false; }
    }
    /** The first read once the desktop is up and idle: the bell rings for what came while it was away. */
    function firstRead() {
        if (read0) return;
        const idle = root.requestIdleCallback || ((fn) => setTimeout(fn, 1000));
        idle(() => { if (!read0) read(); }, { timeout: 4000 });
    }

    function start() {
        if (!ensureIcon()) return;
        if (desktopUp()) firstRead();
        else doc.addEventListener('desktopBootDone', firstRead, { once: true, signal: appScopeSignal });
        root.melatonAndroidNotifications = { open: showFlyout, close: hideFlyout, manageChannels: openChannels };
    }
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start, { once: true, signal: appScopeSignal });
    else start();
})();
