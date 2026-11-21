/**
 * Notifications in the DeX desktop's tray (StaticForge #1005).
 *
 * A Bell icon (Windows Calendar's reminder bell, WinCal.exe icon 116) shown by default (Customize Notification Icons can
 * hide it like any other). It rings (the bell with its six lines) while a notification has come that the user has not
 * seen in the flyout yet, and is the plain bell once every one has been seen (wincal-116-seen-16.png, the same art
 * without the lines; Yukimi, Nov 21).
 *
 * The flyout: the phone's notifications by app (the app's icon as the phone's Start menu draws it, its name, how many),
 * each one drawn with everything Android gives it: the large icon (a sender's face, an album), the title or the
 * conversation's name, its own time or a running clock (calls, timers), the sub / info text, the text (the collapsed line,
 * all of it when expanded), an inbox's lines, a chat's messages with each sender's picture, a progress bar (or Vista's
 * marquee when it has no end), the big picture, the summary line, its buttons and a reply box. The newest one opens
 * expanded; the expando opens or closes any other. A notification opens its app on the DeX display, the X dismisses it,
 * the app's X clears its notifications, Clear all clears every one that can be cleared.
 *
 * Source: the Android app's AndroidPhoneNotifications bridge in this window (list / image / open / action / dismiss /
 * access / requestAccess; 'androidnotifications' when they change, coalesced by the app). The list is read once the
 * desktop is up and idle and then on each change (the bell must ring), never on a timer and never on the start path.
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
    const SYSTEM_RIGHT = ['nightshadeTrayIcon', 'powerTrayIcon', 'modemTrayIcon', 'volumeTrayIcon'];
    // the bell and the bell without its lines, each with its DPI tiers (the plain one is not in the tiers' img.css)
    const bellArt = (name) => {
        const one = `/static_images/vista-dlg/${name}`;
        const tier = (t) => `/static_images/hidpi/${t}/vista-dlg/${name}`;
        return { src: one, srcset: `${one} 1x, ${tier(125)} 1.25x, ${tier(150)} 1.5x, ${tier(175)} 1.75x, ${tier(200)} 2x` };
    };
    const BELL_RING = bellArt('wincal-116-16.png');
    const BELL_SEEN = bellArt('wincal-116-seen-16.png');
    const IMAGE_CAP = 80;

    let icon = null;
    let flyout = null;
    let list = [];
    let read0 = false;
    let reply = null;           // { key, index, label, draft }
    const expanded = new Map(); // key -> true / false the user chose (else: the newest is open)
    const images = new Map();   // image id -> data URL (AndroidPhoneNotifications.image), newest last
    let clockTimer = 0;

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const call = (name, ...args) => { try { return typeof N[name] === 'function' ? N[name](...args) : undefined; } catch (_) { return undefined; } };
    const hasAccess = () => call('access') !== false;
    const isOpen = () => !!(flyout && !flyout.classList.contains('hidden'));
    const postedAt = (n) => Number(n.time) || 0;

    // ---- seen / unseen ----

    function readSeen() {
        try { const v = JSON.parse(localStorage.getItem(SEEN_KEY) || 'null'); return v && typeof v === 'object' ? v : {}; } catch (_) { return {}; }
    }
    function writeSeen(map) {
        try { localStorage.setItem(SEEN_KEY, JSON.stringify(map)); } catch (_) { /* private mode: rings until the next look */ }
    }
    /** A notification is new until the flyout has shown it (a notification posted again with new content is new again). */
    const unseen = () => { const seen = readSeen(); return list.filter((n) => !(seen[n.key] >= postedAt(n))); };
    function markAllSeen() {
        const next = {};
        list.forEach((n) => { next[n.key] = postedAt(n); }); // only the notifications still on the phone are kept
        writeSeen(next);
        paintIcon();
    }

    function read() {
        read0 = true;
        let next = [];
        try { next = JSON.parse(N.list() || '[]'); } catch (_) { next = []; }
        list = (Array.isArray(next) ? next : []).filter((n) => n && n.key);
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

    /** An app's (or a notification's) program picture as the phone's Start menu draws it (androidDesktopPrograms.js). */
    function appPic(n, px) {
        const P = root.melatonAndroidPrograms;
        const pic = P && typeof P.iconFor === 'function' ? P.iconFor({ package: n.package, icon: '' }, px) : { src: '', srcset: '' };
        if (pic.src) return `<img src="${esc(pic.src)}" srcset="${esc(pic.srcset)}" alt="" width="${px}" height="${px}" draggable="false">`;
        // not in the Program Icons store: Android's own icon, as the bridge gives it
        return n.icon ? `<img src="${esc(n.icon)}" alt="" width="${px}" height="${px}" draggable="false">` : '';
    }
    const imageTag = (id, cls, px) => (id ? `<img class="${cls}" data-img="${esc(id)}" alt=""${px ? ` width="${px}" height="${px}"` : ''} draggable="false">` : '');

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
        const title = n.conversation && n.conversation !== n.title ? n.conversation : (n.title || n.app || n.package);
        const sub = [n.subText, n.infoText].filter(Boolean).join(' · ');
        const when = n.chronometer ? `<span class="android-notify-chrono" data-base="${esc(n.chronometer.base)}" data-down="${n.chronometer.countDown ? 1 : 0}">${esc(chronoText(n.chronometer))}</span>` : esc(whenText(n));
        const pic = n.large ? imageTag(n.large, 'android-notify-large', 32) : appPic(n, 32);
        return `<div class="android-notify-note vista-treelist-row${open ? ' is-open' : ''}${n.ongoing ? ' is-ongoing' : ''}" data-key="${esc(n.key)}" role="listitem" tabindex="0">
            <div class="android-notify-main" data-act="open">
                <span class="android-notify-pic">${pic}</span>
                <div class="network-flyout-text android-notify-content">
                    <span class="android-notify-top"><span class="network-flyout-name">${esc(title)}</span><span class="network-flyout-sub android-notify-time">${when}</span></span>
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

    function flyoutHtml() {
        if (!hasAccess()) {
            return `<div class="network-flyout-body"><div class="network-flyout-heading">Notifications</div>
                <span class="network-flyout-sub">Allow notification access on the phone to see its notifications here.</span></div>
                <div class="network-flyout-links"><button type="button" class="network-flyout-link" data-act="access">Turn on notification access</button></div>`;
        }
        if (!list.length) {
            return '<div class="network-flyout-body"><div class="network-flyout-heading">Notifications</div><span class="network-flyout-sub">No new notifications</span></div>';
        }
        // by app, the app with the newest first; inside it the newest first; the newest of all opens expanded
        const sorted = list.slice().sort((a, b) => postedAt(b) - postedAt(a));
        const newest = sorted[0] && sorted[0].key;
        const groups = new Map();
        sorted.forEach((n) => {
            const k = n.package || n.app || '';
            if (!groups.has(k)) groups.set(k, []);
            groups.get(k).push(n);
        });
        const clearable = list.some((n) => n.clearable !== false);
        return `<div class="network-flyout-body android-notify-body win7">
            <div class="network-flyout-heading">Notifications</div>
            ${Array.from(groups.values()).map((notes) => {
                const head = notes[0];
                const count = notes.reduce((s, n) => s + Math.max(1, Number(n.number) || 0), 0);
                const canClear = notes.some((n) => n.clearable !== false);
                return `<div class="android-notify-app" role="list" aria-label="${esc(head.app || head.package)}" data-pkg="${esc(head.package)}">
                    <div class="android-notify-app-head network-flyout-heading">${appPic(head, 16)}<span>${esc(head.app || head.package)}</span>${count > 1 ? `<span class="android-notify-count">(${count})</span>` : ''}
                    ${canClear ? '<button type="button" class="tray-balloon-close" data-act="clearapp" title="Clear these notifications" aria-label="Clear these notifications"></button>' : ''}</div>
                    ${notes.map((n) => noteHtml(n, expanded.has(n.key) ? expanded.get(n.key) : n.key === newest)).join('')}
                </div>`;
            }).join('')}
        </div>
        ${clearable ? '<div class="network-flyout-links"><button type="button" class="network-flyout-link" data-act="clear">Clear all</button></div>' : ''}`;
    }

    /** After a draw: the pictures from the app (cached by id), the progress bars' fill, the running clocks. */
    function afterRender() {
        flyout.querySelectorAll('img[data-img]').forEach((img) => {
            const id = img.dataset.img;
            let url = images.get(id);
            if (url == null) {
                url = String(call('image', id) || '');
                if (url) {
                    images.set(id, url);
                    if (images.size > IMAGE_CAP) images.delete(images.keys().next().value);
                }
            }
            if (url && img.getAttribute('src') !== url) img.setAttribute('src', url);
            if (!url) img.hidden = true;
        });
        // pictures no notification shows any more are let go
        const live = new Set();
        list.forEach((n) => { [n.large, n.picture].concat((n.messages || []).map((m) => m.avatar)).forEach((id) => { if (id) live.add(id); }); });
        Array.from(images.keys()).forEach((id) => { if (!live.has(id)) images.delete(id); });
        flyout.querySelectorAll('.android-notify-progress[aria-valuenow] > div').forEach((bar) => {
            const w = `${bar.parentElement.getAttribute('aria-valuenow')}%`;
            if (bar.style.width !== w) bar.style.width = w;
        });
        syncClock();
    }

    /** Calls and timers count while the flyout shows them (a once-a-second text tick, stopped when it closes). */
    function syncClock() {
        const want = isOpen() && !!flyout.querySelector('.android-notify-chrono');
        if (want && !clockTimer) {
            clockTimer = setInterval(() => { // perf: allow a running call / timer clock while the flyout shows it
                if (!isOpen()) { syncClock(); return; }
                flyout.querySelectorAll('.android-notify-chrono').forEach((el) => {
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
        const typing = flyout.querySelector('.android-notify-reply-text');
        if (typing && doc.activeElement === typing) { reply.draft = typing.value; return; }
        if (reply && !list.some((n) => n.key === reply.key)) reply = null;
        const html = flyoutHtml();
        if (flyout.dataset.html !== html) {
            const body = flyout.querySelector('.android-notify-body');
            const top = body ? body.scrollTop : 0;
            flyout.dataset.html = html;
            flyout.innerHTML = html;
            const nb = flyout.querySelector('.android-notify-body');
            if (nb && top) nb.scrollTop = top;
            const box = flyout.querySelector('.android-notify-reply-text');
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

    function onClick(e) {
        e.stopPropagation();
        const el = e.target.closest('[data-act]');
        if (!el) return;
        const act = el.dataset.act;
        if (act === 'access') { call('requestAccess'); hideFlyout(); return; }
        if (act === 'clear') { list.filter((n) => n.clearable !== false).forEach((n) => call('dismiss', n.key)); return; }
        if (act === 'clearapp') {
            const pkg = el.closest('.android-notify-app').dataset.pkg;
            list.filter((n) => n.package === pkg && n.clearable !== false).forEach((n) => call('dismiss', n.key));
            return;
        }
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
                flyout.dataset.html = '';
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
                flyout.dataset.html = '';
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
        if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.android-notify-note')) {
            e.preventDefault();
            const n = list.find((x) => x.key === e.target.dataset.key);
            if (n) openNote(n);
        }
    }

    function ensureFlyout() {
        if (flyout) return flyout;
        flyout = doc.createElement('div');
        flyout.id = 'androidNotifyFlyout';
        flyout.className = 'network-flyout android-notify-flyout hidden';
        flyout.setAttribute('role', 'dialog');
        flyout.setAttribute('aria-label', 'Notifications');
        flyout.addEventListener('click', onClick);
        flyout.addEventListener('keydown', onKey);
        // a list change that came while a reply was being typed is drawn when the box loses focus
        flyout.addEventListener('focusout', (e) => {
            if (!e.target.matches('.android-notify-reply-text') || !reply) return;
            reply.draft = e.target.value;
            setTimeout(render, 0);
        });
        doc.body.appendChild(flyout);
        doc.addEventListener('pointerdown', (ev) => {
            if (!isOpen()) return;
            if (flyout.contains(ev.target) || (icon && icon.contains(ev.target))) return;
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
        read();
        expanded.clear();
        flyout.dataset.html = '';
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
            const typing = flyout.querySelector('.android-notify-reply-text');
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
        root.melatonAndroidNotifications = { open: showFlyout, close: hideFlyout };
    }
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start, { once: true, signal: appScopeSignal });
    else start();
})();
