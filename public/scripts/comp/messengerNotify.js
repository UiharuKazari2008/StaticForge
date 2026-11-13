/**
 * Melaton Messenger's notifications on the desktop (Yozora #779): a new text message (a Text
 * Messaging 'message' event whose detail.notify is true: the server's rule, incoming, known or
 * "Notify me about unknown senders" on) shows a tray balloon at Melaton Messenger's tray icon,
 * titled with the sender (and the group), the text or "Picture" under it; a click opens Melaton
 * Messenger at that chat. The new-message sound (the scheme's Notify) plays unless Melaton
 * Messenger's Options turn it off. Text messages are their own event class, 'sms' (the chat
 * personas, Dreamscape Messenger, are 'chat').
 *
 *   tray icon   shown while there is a Text Messaging account; click = open Melaton Messenger
 *   popup id    'text-messages' (Taskbar properties can hide these popups)
 *
 * Desktop only: not in the phone shell, the Android app or agent tabs. Everything from a message
 * is escaped (the balloon renders HTML).
 */
(function (root) {
    'use strict';

    if (typeof document === 'undefined') return;

    const ICON16 = '/static_images/melaton-messenger/messenger-16.png';
    const ICON32 = '/static_images/melaton-messenger/messenger-32.png';
    const SOUND_KEY = 'melaton-messenger-sound';
    const TRAY_ID = 'melatonMessengerTrayIcon';
    const EVENT_CLASS = 'sms';
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const tm = () => root.textMessaging || null;
    let icon = null;
    let wiredTo = null;
    let showing = null;

    /** A desktop tab: not the phone shell, the Android app or an agent tab (activeSyncAgent's rule). */
    function isDesktopTab() {
        if (root.uiShell === 'mobile') return false;
        if (root.activeSync && root.activeSync.kind !== 'computer') return false;
        try { if (new URLSearchParams(root.location.search).get('agent') === '1') return false; } catch (_) { /* no location */ }
        return root.isDesktop !== false;
    }

    function soundOn() {
        try { return localStorage.getItem(SOUND_KEY) !== 'off'; } catch (_) { return true; }
    }

    function open(args) {
        if (root.melatonApps && typeof root.melatonApps.launch === 'function') void root.melatonApps.launch({ packageId: 'messenger', ...(args ? { args } : {}) });
    }

    function ensureIcon() {
        if (icon && icon.isConnected) return icon;
        icon = document.getElementById(TRAY_ID);
        if (!icon) {
            // beside Device Center's icon in the notification area
            const near = document.getElementById('activeSyncTrayIcon') || document.getElementById('dovecoteTrayIcon');
            if (!near || !near.parentNode) return null;
            icon = document.createElement('div');
            icon.className = 'taskbar-tray-icon hidden';
            icon.id = TRAY_ID;
            icon.title = 'Melaton Messenger';
            icon.innerHTML = `<img src="${ICON16}" alt="" width="16" height="16" draggable="false">`;
            near.parentNode.insertBefore(icon, near);
        }
        if (!icon.dataset.mmWired) {
            icon.dataset.mmWired = '1';
            icon.addEventListener('click', () => open());
            if (root.contextMenu && typeof root.contextMenu.attachToElement === 'function') {
                root.contextMenu.attachToElement(icon, {
                    sections: [{ type: 'list', items: [{ text: 'Open Melaton Messenger', action: 'open' }, { text: 'New Message', action: 'new' }] }],
                    onAction: (a) => { if (a === 'open') open(); else if (a === 'new') open({ compose: { to: '' } }); }
                });
            }
        }
        return icon;
    }

    /** The tray icon shows while there is at least one account (a new session finds out on load). */
    async function syncIcon() {
        if (!isDesktopTab()) return;
        const t = tm();
        const el = ensureIcon();
        if (!t || !el) return;
        let n = 0;
        try { const d = await t.accounts(); n = ((d && d.accounts) || []).length; } catch (_) { n = 0; }
        const want = n > 0;
        if (want && el.classList.contains('hidden')) {
            if (typeof root.revealTrayIconElement === 'function') root.revealTrayIconElement(el); else el.classList.remove('hidden');
        } else if (!want) el.classList.add('hidden');
    }

    function text(m) {
        if (root.melatonMessenger && typeof root.melatonMessenger.snippet === 'function') return root.melatonMessenger.snippet(m) || 'New message';
        if (m.text) return String(m.text).replace(/\s+/g, ' ').trim();
        const atts = m.attachments || [];
        if (atts.length) return atts.every((a) => /^image\//.test(a.mime || '')) ? 'Picture' : 'Attachment';
        return 'New message';
    }

    function onMessage(d) {
        if (!d || d.notify !== true || !d.message || d.message.fromMe || !isDesktopTab()) return;
        const m = d.message;
        const who = (m.sender && (m.sender.name || m.sender.address)) || d.chatTitle || 'Unknown';
        const title = d.isGroup && d.chatTitle && d.chatTitle !== who ? `${who} (${d.chatTitle})` : who;
        let body = text(m);
        if (body.length > 160) body = `${body.slice(0, 157)}...`;
        if (soundOn() && root.desktopSounds && typeof root.desktopSounds.play === 'function') root.desktopSounds.play('notify');
        const anchor = ensureIcon();
        if (!anchor || !root.PopoverManager || typeof root.PopoverManager.showPopover !== 'function') return;
        if (anchor.classList.contains('hidden')) {
            if (typeof root.revealTrayIconElement === 'function') root.revealTrayIconElement(anchor); else anchor.classList.remove('hidden');
        }
        const target = { accountId: d.accountId, chatGuid: d.chatGuid };
        showing = target;
        // the balloon renders title and message as HTML: a message's words are escaped, always
        const pop = root.PopoverManager.showPopover(anchor, 'info', esc(title), esc(body), false, 8000,
            `<img src="${ICON32}" alt="" width="32" height="32">`, null,
            { popupId: 'text-messages', position: 'top', arrowPosition: 'bottom-right', onHide: () => { if (showing === target) showing = null; } });
        if (pop) {
            pop.dataset.eventClass = EVENT_CLASS;
            pop.style.cursor = 'pointer';
            pop.onclick = () => {
                const at = showing || target;
                if (root.PopoverManager.hide) root.PopoverManager.hide(anchor);
                open({ accountId: at.accountId, chatGuid: at.chatGuid });
            };
        }
    }

    /** Attach to the current window.textMessaging (a test can replace it; we follow). */
    function wire() {
        const t = tm();
        if (!t || typeof t.on !== 'function' || wiredTo === t) return;
        if (wiredTo && typeof wiredTo.off === 'function') { wiredTo.off('message', onMessage); wiredTo.off('account', syncIcon); }
        wiredTo = t;
        t.on('message', onMessage);
        t.on('account', syncIcon);
        void syncIcon();
    }

    function startup() {
        if (!isDesktopTab()) return;
        wire();
        // window.textMessaging may be swapped later (tests); and the tray exists only after the desktop builds
        const timer = setInterval(wire, 5000);
        setTimeout(() => void syncIcon(), 15000);
        root.addEventListener('pagehide', () => clearInterval(timer), { once: true });
    }

    root.messengerNotify = { onMessage, syncIcon, wire, EVENT_CLASS };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startup);
    else startup();
})(typeof window !== 'undefined' ? window : globalThis);
