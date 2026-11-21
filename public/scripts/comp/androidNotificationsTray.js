/**
 * Notifications in the DeX desktop's tray (StaticForge #1005).
 *
 * A Bell icon (Windows Calendar's reminder bell, WinCal.exe icon 116) shown by default (Customize Notification Icons
 * can hide it like any other), and its flyout: the phone's notifications by app, newest first. A notification opens
 * its app on the DeX display, the X dismisses it, its buttons run its actions, a Reply action opens a reply box.
 * "Clear all" dismisses every one that can be cleared.
 *
 * Source: the Android app's AndroidPhoneNotifications bridge in this window (list / open / action / dismiss / access /
 * requestAccess; 'androidnotifications' when they change). The list is a synchronous bridge call, so it is read when
 * the flyout opens, on a change while it shows, and for the tooltip on hover after a change, never on a timer and never
 * on the start path. The phone's notification delivery itself stays native (cafeready-background): this only shows them.
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
    const BELL = '/static_images/vista-dlg/wincal-116-16.png';
    const SYSTEM_RIGHT = ['nightshadeTrayIcon', 'powerTrayIcon', 'modemTrayIcon', 'volumeTrayIcon'];

    let icon = null;
    let flyout = null;
    let list = [];
    let stale = true;
    let reply = null; // { key, index, label, draft }

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const call = (name, ...args) => { try { return typeof N[name] === 'function' ? N[name](...args) : undefined; } catch (_) { return undefined; } };
    const hasAccess = () => call('access') !== false;

    function read() {
        stale = false;
        let next = [];
        try { next = JSON.parse(N.list() || '[]'); } catch (_) { next = []; }
        list = (Array.isArray(next) ? next : []).filter((n) => n && n.key);
        paintIcon();
    }

    // ---- the icon ----

    function paintIcon() {
        if (!icon) return;
        const n = list.length;
        const tip = !hasAccess() ? 'Notifications: access is off' : n ? `Notifications: ${n} from the phone` : 'Notifications: none';
        if (icon.title !== tip) icon.title = tip;
        const has = n ? '1' : '0';
        if (icon.dataset.has !== has) icon.dataset.has = has;
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
            icon.innerHTML = `<img src="${BELL}" alt="" width="16" height="16" draggable="false">`;
            const before = SYSTEM_RIGHT.map((id) => doc.getElementById(id)).find((el) => el && el.parentElement === box);
            box.insertBefore(icon, before || null);
        }
        icon.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); toggleFlyout(); });
        // the tooltip's count after a change while the flyout was shut: read when the pointer comes to it
        icon.addEventListener('pointerenter', () => { if (stale && !isOpen()) read(); });
        // no bridge call at boot (installed-boot-zero-wait): the tooltip's count comes with the first read
        return icon;
    }

    // ---- the flyout ----

    const isOpen = () => !!(flyout && !flyout.classList.contains('hidden'));

    function when(t) {
        const d = new Date(Number(t) || 0);
        if (!Number(t) || Number.isNaN(d.getTime())) return '';
        const now = new Date();
        const sameDay = d.toDateString() === now.toDateString();
        return sameDay ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : d.toLocaleDateString([], { month: 'numeric', day: 'numeric' });
    }

    function noteHtml(n) {
        const acts = Array.isArray(n.actions) ? n.actions.filter((a) => a && a.title) : [];
        const replying = reply && reply.key === n.key;
        return `<div class="android-notify-note vista-treelist-row" data-key="${esc(n.key)}" data-pkg="${esc(n.package)}" role="listitem" tabindex="0">
            <div class="android-notify-main" data-act="open">
                <div class="network-flyout-text">
                    <span class="network-flyout-name">${esc(n.title || n.app || n.package)}</span>
                    ${n.text ? `<span class="network-flyout-sub android-notify-text">${esc(n.text)}</span>` : ''}
                </div>
                <span class="network-flyout-sub android-notify-time">${esc(when(n.time))}</span>
            </div>
            ${n.clearable === false ? '' : '<button type="button" class="tray-balloon-close" data-act="dismiss" title="Dismiss" aria-label="Dismiss"></button>'}
            ${acts.length ? `<div class="android-notify-actions win7">${acts.map((a) => `<button type="button" data-act="action" data-i="${esc(a.index)}" data-reply="${a.reply ? '1' : '0'}" data-label="${esc(a.label || a.title)}">${esc(a.title)}</button>`).join('')}</div>` : ''}
            ${replying ? `<div class="android-notify-reply win7"><input type="text" class="android-notify-reply-text" placeholder="${esc(reply.label)}" value="${esc(reply.draft)}" autocomplete="off" spellcheck="false"><button type="button" data-act="send">Send</button></div>` : ''}
        </div>`;
    }

    function flyoutHtml() {
        if (!hasAccess()) {
            return `<div class="network-flyout-body"><div class="network-flyout-heading">Notifications</div>
                <span class="network-flyout-sub">Allow notification access on the phone to see its notifications here.</span></div>
                <div class="network-flyout-links"><button type="button" class="network-flyout-link" data-act="access">Turn on notification access</button></div>`;
        }
        if (!list.length) {
            return '<div class="network-flyout-body"><div class="network-flyout-heading">Notifications</div><span class="network-flyout-sub">No new notifications</span></div>';
        }
        // by app, the app with the newest first; inside it the newest first
        const groups = new Map();
        list.slice().sort((a, b) => (Number(b.time) || 0) - (Number(a.time) || 0)).forEach((n) => {
            const k = n.package || n.app || '';
            if (!groups.has(k)) groups.set(k, []);
            groups.get(k).push(n);
        });
        const clearable = list.some((n) => n.clearable !== false);
        return `<div class="network-flyout-body android-notify-body win7">
            <div class="network-flyout-heading">Notifications</div>
            ${Array.from(groups.values()).map((notes) => {
                const head = notes[0];
                const pic = head.icon ? `<img src="${esc(head.icon)}" alt="" width="16" height="16" draggable="false">` : '';
                return `<div class="android-notify-app" role="list" aria-label="${esc(head.app || head.package)}"><div class="android-notify-app-head network-flyout-heading">${pic}<span>${esc(head.app || head.package)}</span></div>${notes.map(noteHtml).join('')}</div>`;
            }).join('')}
        </div>
        ${clearable ? '<div class="network-flyout-links"><button type="button" class="network-flyout-link" data-act="clear">Clear all</button></div>' : ''}`;
    }

    function render() {
        if (!isOpen()) return;
        // a reply being typed keeps its words and its focus: the list waits until the box closes
        const typing = flyout.querySelector('.android-notify-reply-text');
        if (typing && doc.activeElement === typing) { reply.draft = typing.value; return; }
        if (reply && !list.some((n) => n.key === reply.key)) reply = null;
        const html = flyoutHtml();
        if (flyout.dataset.html !== html) {
            flyout.dataset.html = html;
            flyout.innerHTML = html;
            const box = flyout.querySelector('.android-notify-reply-text');
            if (box) box.focus({ preventScroll: true });
        }
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
        if (act === 'clear') {
            list.filter((n) => n.clearable !== false).forEach((n) => call('dismiss', n.key));
            return;
        }
        const row = el.closest('.android-notify-note');
        const n = row && list.find((x) => x.key === row.dataset.key);
        if (!n) return;
        if (act === 'open') { openNote(n); return; }
        if (act === 'dismiss') { call('dismiss', n.key); return; }
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
        // a reply's words survive a list change that arrives while the box has focus
        flyout.addEventListener('focusout', (e) => {
            if (!e.target.matches('.android-notify-reply-text') || !reply) return;
            reply.draft = e.target.value;
            if (stale) { read(); render(); }
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
        const width = flyout.offsetWidth || 320;
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
        flyout.dataset.html = '';
        flyout.classList.remove('hidden');
        render();
        positionFlyout();
    }

    function hideFlyout() {
        if (!flyout) return;
        flyout.classList.add('hidden');
        reply = null;
    }

    function toggleFlyout() {
        if (isOpen()) hideFlyout();
        else showFlyout();
    }

    // the app says the notifications changed (coalesced on its side): read now only while the flyout shows
    root.addEventListener('androidnotifications', () => {
        stale = true;
        if (!isOpen()) return;
        const typing = flyout.querySelector('.android-notify-reply-text');
        if (typing && doc.activeElement === typing) return; // read when the box closes
        read();
        render();
        positionFlyout();
    }, { signal: appScopeSignal });

    function start() {
        if (!ensureIcon()) return;
        root.melatonAndroidNotifications = { open: showFlyout, close: hideFlyout };
    }
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start, { once: true, signal: appScopeSignal });
    else start();
})();
