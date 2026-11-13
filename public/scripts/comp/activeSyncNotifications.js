/**
 * ActiveSync: a phone's notifications on the desktop (Yozora #747).
 *
 * The Dreamscape app's notification listener sends what the phone posts and what goes away
 * (events notify.posted / notify.removed, operations notify.list / notify.dismiss; DSApp-Kotlin
 * activesync/ActiveSyncNotifications.kt). Here they are a list per device and a tray popup at the
 * ActiveSync icon; one that leaves the phone leaves the list, and its popup if it is the one
 * showing. Dismissing one here dismisses it on the phone.
 *
 *   activeSyncNotifications.list(deviceId)        [{ key, app, package, title, text, time, icon }] newest first
 *   activeSyncNotifications.count(deviceId)
 *   activeSyncNotifications.dismiss(deviceId, key)
 *   activeSyncNotifications.on(fn)                fn(deviceId) after a device's list changed; returns an off()
 *
 * Popups: Taskbar properties lists them as "Phone notifications" (popup id activesync-notify);
 * HKCU\...\Melaton Mobile Device Center\ShowNotifications = 0 keeps the list without popups.
 * Desktop tabs only (activeSync.kind === 'computer').
 */
(function (root) {
    'use strict';

    const as = root.activeSync;
    if (!as || as.kind !== 'computer' || typeof document === 'undefined') return;

    const REG = 'HKCU\\Software\\Xyridian\\Melaton Mobile Device Center';
    const MAX_PER_DEVICE = 200;
    const lists = new Map();    // deviceId -> Map(key -> notification)
    const icons = new Map();    // deviceId -> Map(package -> data URL)
    const synced = new Set();   // devices whose current list was asked for since they connected
    const listeners = [];
    let showing = null;         // { deviceId, key } of the popup on screen

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const popupsOn = () => (root.melatonRegistry ? root.melatonRegistry.get(REG, 'ShowNotifications', 1) : 1) !== 0;
    const trayIcon = () => document.getElementById('activeSyncTrayIcon');

    function changed(deviceId) {
        listeners.slice().forEach((fn) => { try { fn(deviceId); } catch (e) { console.warn('[activeSync notifications] listener failed:', e); } });
    }

    /** Only a small PNG / JPEG / WebP data URL is ever used as an image source. */
    function safeIcon(v) {
        return typeof v === 'string' && v.length < 40000 && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v) ? v : null;
    }

    function take(deviceId, raw) {
        if (!raw || typeof raw.key !== 'string' || !raw.key) return null;
        if (!icons.has(deviceId)) icons.set(deviceId, new Map());
        const pkg = String(raw.package || '');
        const icon = safeIcon(raw.icon);
        if (icon && pkg) icons.get(deviceId).set(pkg, icon);
        return {
            key: raw.key.slice(0, 300),
            package: pkg.slice(0, 200),
            app: String(raw.app || pkg || 'Notification').slice(0, 80),
            title: String(raw.title || '').slice(0, 200),
            text: String(raw.text || '').slice(0, 1000),
            time: Number(raw.time) || Date.now(),
            icon: icon || icons.get(deviceId).get(pkg) || null
        };
    }

    function listOf(deviceId) {
        if (!lists.has(deviceId)) lists.set(deviceId, new Map());
        return lists.get(deviceId);
    }

    function popup(device, n) {
        const anchor = trayIcon();
        if (!anchor || anchor.classList.contains('hidden') || !popupsOn()) return;
        if (!root.PopoverManager || typeof root.PopoverManager.showPopover !== 'function') return;
        const img = n.icon ? `<img src="${n.icon}" alt="" width="32" height="32">` : '<img src="/static_images/activesync/activesync-32.png" alt="" width="32" height="32">';
        showing = { deviceId: device.deviceId, key: n.key };
        const mine = showing;
        // the popup renders title and message as HTML: a notification's words are escaped, always
        root.PopoverManager.showPopover(anchor, 'info', esc(n.title || n.app), `${esc(n.text)}${n.text ? '<br>' : ''}<small>${esc(n.title ? `${n.app} • ${device.name}` : device.name)}</small>`, false, 8000, img, null, {
            popupId: 'activesync-notify', position: 'top', arrowPosition: 'bottom-right',
            onHide: () => { if (showing === mine) showing = null; }
        });
    }

    function posted(device, raw) {
        const n = take(device.deviceId, raw);
        if (!n) return;
        const list = listOf(device.deviceId);
        const fresh = !list.has(n.key) || list.get(n.key).text !== n.text || list.get(n.key).title !== n.title;
        list.delete(n.key);
        list.set(n.key, n);
        while (list.size > MAX_PER_DEVICE) list.delete(list.keys().next().value);
        if (fresh) popup(device, n);
        changed(device.deviceId);
    }

    function removed(deviceId, key) {
        const list = lists.get(deviceId);
        if (!list || !list.delete(key)) return;
        if (showing && showing.deviceId === deviceId && showing.key === key) {
            const anchor = trayIcon();
            if (anchor && root.PopoverManager && typeof root.PopoverManager.hide === 'function') root.PopoverManager.hide(anchor);
            showing = null;
        }
        changed(deviceId);
    }

    function usable(d) {
        return d.online && (d.session === 'guest' || d.session === 'partner') && d.permissions.includes('notify');
    }

    /** What the phone shows now, once per connection (no popups for what was already there). */
    async function sync(d) {
        synced.add(d.deviceId);
        let res = null;
        try {
            res = await as.call(d.deviceId, 'notify.list', {}, { timeoutMs: 15000 });
        } catch (_) {
            return; // an older app, sending switched off on the phone, or no notification access there
        }
        const list = new Map();
        for (const raw of (res && res.notifications) || []) {
            const n = take(d.deviceId, raw);
            if (n) list.set(n.key, n);
        }
        lists.set(d.deviceId, list);
        changed(d.deviceId);
    }

    as.on('state', (st) => {
        const live = new Set();
        for (const d of st.devices) {
            if (!usable(d)) continue;
            live.add(d.deviceId);
            if (!synced.has(d.deviceId)) void sync(d);
        }
        // a device that left, or lost the permission: its notifications are not ours to show
        for (const id of [...synced]) {
            if (live.has(id)) continue;
            synced.delete(id);
            icons.delete(id);
            if (lists.delete(id)) changed(id);
            if (showing && showing.deviceId === id) {
                const anchor = trayIcon();
                if (anchor && root.PopoverManager && typeof root.PopoverManager.hide === 'function') root.PopoverManager.hide(anchor);
                showing = null;
            }
        }
    });

    as.on('event', (e) => {
        if (!e || !e.from || e.from.kind !== 'device') return;
        if (e.event === 'notify.posted') {
            const d = as.device(e.from.id);
            if (d && usable(d)) posted(d, e.detail);
        } else if (e.event === 'notify.removed' && e.detail && typeof e.detail.key === 'string') {
            removed(e.from.id, e.detail.key);
        }
    });

    root.activeSyncNotifications = {
        list: (deviceId) => [...(lists.get(deviceId) || new Map()).values()].sort((a, b) => b.time - a.time),
        count: (deviceId) => (lists.get(deviceId) || new Map()).size,
        dismiss: (deviceId, key) => as.call(deviceId, 'notify.dismiss', { key }).then((ok) => { if (ok) removed(deviceId, key); return ok; }),
        refresh: (deviceId) => { const d = as.device(deviceId); return d && usable(d) ? sync(d) : Promise.resolve(); },
        on: (fn) => { listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; }
    };
})(typeof window !== 'undefined' ? window : globalThis);
