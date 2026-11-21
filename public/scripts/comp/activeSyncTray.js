/**
 * ActiveSync in the notification area (Yozora #747): the green ActiveSync icon while a phone is
 * known to this computer (grey while none is connected), its balloons, and opening Melaton Mobile
 * Device Center (apps/activesync) when a new device connects. Desktop tabs only
 * (activeSync.kind === 'computer', public/scripts/comp/activeSyncAgent.js).
 *
 *   icon      click: Device Center; right-click: Open, each device, and the icon's own options (open
 *             Device Center for a new device, connect / disconnect balloons, the device's notifications)
 *   balloons  a device connected / disconnected (HKCU\...\Melaton Mobile Device Center\NotifyOnConnect),
 *             battery low (15% and under, not charging, once until it charges again), battery fully
 *             charged (100% while charging, once per charge); a click opens Device Center at that device
 *   new device   one that waits for the choice opens Device Center (OpenOnConnect); with a primary device set (#979) a
 *                new device never takes Device Center over: a balloon says it connected, and a click opens it there
 *   primary      the icon is the primary device's: green while it is connected, grey while it is away (other
 *                devices only add their line to the tooltip and the menu)
 */
(function (root) {
    'use strict';

    const a = root.activeSync;
    if (!a || a.kind !== 'computer' || typeof document === 'undefined') return;

    const ART = '/static_images/activesync';
    const REG = 'HKCU\\Software\\Xyridian\\Melaton Mobile Device Center';
    const LOW_BATTERY = 15;
    const seen = new Map();   // deviceId -> { online, session }
    const lowWarned = new Set();
    const fullTold = new Set();
    let icon = null;
    let first = true;

    const setting = (name) => (root.melatonRegistry ? root.melatonRegistry.get(REG, name, 1) : 1) !== 0;

    function openCenter(deviceId) {
        if (root.melatonApps && typeof root.melatonApps.launch === 'function') {
            void root.melatonApps.launch({ packageId: 'activesync', ...(deviceId ? { args: { deviceId } } : {}) });
        }
    }

    // the popup renders its text as HTML: a device's name is escaped, always
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    function balloon(type, title, text, deviceId) {
        if (!icon || !root.PopoverManager || typeof root.PopoverManager.showPopover !== 'function') return;
        root.PopoverManager.showPopover(icon, type, esc(title), esc(text), false, 8000, `<img src="${ART}/activesync-32.png" alt="" width="32" height="32">`, null,
            { popupId: 'activesync', position: 'top', arrowPosition: 'bottom-right', onClick: () => openCenter(deviceId) });
    }

    function line(d) {
        const b = d.status && d.status.battery;
        const parts = [d.online ? (d.session === 'pending' ? 'Waiting to be set up' : 'Connected') : 'Not Connected'];
        if (d.online && b && b.level != null) parts.push(`battery ${Math.round(b.level)}%${b.charging ? ' (charging)' : ''}`);
        return `${d.name}: ${parts.join(', ')}`;
    }

    function ensureIcon() {
        if (icon) return icon;
        icon = document.getElementById('activeSyncTrayIcon');
        if (!icon) return null;
        icon.addEventListener('click', () => openCenter());
        if (root.contextMenu && typeof root.contextMenu.attachToElement === 'function') {
            root.contextMenu.attachToElement(icon, {
                sections: [{
                    type: 'list',
                    initfn: (s) => {
                        const devices = a.state().devices.filter((d) => (d.online || d.partner) && d.platform !== 'cafeready');
                        s.items = [{ text: 'Open Melaton Mobile Device Center', action: 'open', default: true }];
                        if (devices.length) s.items.push({ separator: true }, ...devices.map((d) => ({ text: d.primary && devices.length > 1 ? `${line(d)} (primary)` : line(d), action: `dev:${d.deviceId}` })));
                        // the folder files sent to a phone go to (activeSyncRemoteStorage.js openReceived)
                        const sharing = devices.filter((d) => d.online && d.platform !== 'cafeready' && (d.permissions || []).includes('files'));
                        if (sharing.length && root.phoneStorage && typeof root.phoneStorage.openReceived === 'function') {
                            s.items.push({ separator: true }, ...sharing.map((d) => ({ text: sharing.length > 1 ? `Open Received Files on ${d.name}` : 'Open Received Files folder', action: `rx:${d.deviceId}` })));
                        }
                        // what this icon does on its own (Device Center's Connection Settings is WMDC's dialog and has no place for these)
                        s.items.push({ separator: true },
                            { text: 'Open Device Center when a new device connects', action: 'opt:OpenOnConnect', showIndicator: true, indicatorMark: 'check', checked: setting('OpenOnConnect') },
                            { text: 'Tell me when a device connects or disconnects', action: 'opt:NotifyOnConnect', showIndicator: true, indicatorMark: 'check', checked: setting('NotifyOnConnect') },
                            { text: 'Tell me when a device\'s battery is low or fully charged', action: 'opt:NotifyBattery', showIndicator: true, indicatorMark: 'check', checked: setting('NotifyBattery') },
                            { text: 'Show the device\'s notifications here', action: 'opt:ShowNotifications', showIndicator: true, indicatorMark: 'check', checked: setting('ShowNotifications') });
                    }
                }],
                onAction: (action) => {
                    if (action.startsWith('opt:')) {
                        const name = action.slice(4);
                        if (root.melatonRegistry) void root.melatonRegistry.set(REG, { [name]: setting(name) ? 0 : 1 });
                        return;
                    }
                    if (action.startsWith('rx:')) { void root.phoneStorage.openReceived(action.slice(3)); return; }
                    openCenter(action.startsWith('dev:') ? action.slice(4) : null);
                }
            });
        }
        return icon;
    }

    function paint(st) {
        const el = ensureIcon();
        if (!el) return;
        const known = st.devices.filter((d) => d.online || d.partner);
        const online = known.filter((d) => d.online);
        const img = el.querySelector('img');
        // the primary device's state when one is set (#979): another phone connecting does not light the icon
        const primary = known.find((d) => d.primary);
        const lit = primary ? primary.online : online.length > 0;
        const src = `${ART}/${lit ? 'activesync-16.png' : 'activesync-idle-16.png'}`;
        if (img && img.getAttribute('src') !== src) img.src = src;
        // written only when it changes: each write is a mutation the notification area counts as activity (#998)
        const title = known.length ? `Melaton Mobile Device Center\n${known.map(line).join('\n')}` : 'Melaton Mobile Device Center';
        if (el.title !== title) el.title = title;
        if (known.length && el.classList.contains('hidden')) {
            // revealTrayIconElement: public/scripts/comp/trayIndicators.js
            if (typeof root.revealTrayIconElement === 'function') root.revealTrayIconElement(el); else el.classList.remove('hidden');
        } else if (!known.length && !el.classList.contains('hidden')) {
            el.classList.add('hidden');
        }
    }

    function onState(raw) {
        // a DreamOS computer (platform cafeready, #910) is not a mobile device: no tray line, balloon or battery news for
        // it here (it is in Explorer's Network; Device Center keeps its own page for administrators)
        const st = Object.assign({}, raw, { devices: (raw.devices || []).filter((d) => d.platform !== 'cafeready') });
        if (!st.online) { paint({ devices: [] }); seen.clear(); first = true; return; }
        paint(st);
        for (const d of st.devices) {
            const was = seen.get(d.deviceId);
            // the first list after a (re)connect is the state of things, not news
            if (!first) {
                if (d.online && !(was && was.online)) {
                    // a primary device is set and this is another one: it joins the list, Device Center stays (#979)
                    const other = st.devices.some((x) => x.primary && x.deviceId !== d.deviceId);
                    if (d.session === 'pending' && !other) { if (setting('OpenOnConnect')) openCenter(d.deviceId); }
                    else if (d.session === 'pending') { if (setting('OpenOnConnect') || setting('NotifyOnConnect')) balloon('info', 'New device connected', `${d.name} is connected. Click here to set it up in Device Center.`, d.deviceId); }
                    else if (setting('NotifyOnConnect')) balloon('success', 'Device connected', `${d.name} is connected.`, d.deviceId);
                } else if (!d.online && was && was.online && was.session !== 'pending') {
                    if (setting('NotifyOnConnect')) balloon('info', 'Device disconnected', `${d.name} is no longer connected.`, d.deviceId);
                }
            }
            const b = d.online && d.status && d.status.battery;
            // fully charged: once per charge, said again only after it was unplugged or fell below 95%
            if (b && b.level != null) {
                if (b.level >= 100 && b.charging === true && !fullTold.has(d.deviceId)) {
                    fullTold.add(d.deviceId);
                    if (!first && setting('NotifyBattery')) balloon('success', 'Battery fully charged', `${d.name} is fully charged.`, d.deviceId);
                } else if (b.charging === false || b.level < 95) {
                    fullTold.delete(d.deviceId);
                }
            }
            if (b && b.level != null) {
                if (b.level <= LOW_BATTERY && b.charging === false && !lowWarned.has(d.deviceId)) {
                    lowWarned.add(d.deviceId);
                    if (!first && setting('NotifyBattery')) balloon('warning', 'Battery low', `${d.name} has ${Math.round(b.level)}% battery left.`, d.deviceId);
                } else if (b.charging || b.level > LOW_BATTERY + 5) {
                    lowWarned.delete(d.deviceId);
                }
            }
            seen.set(d.deviceId, { online: d.online, session: d.session });
        }
        first = false;
        prefetch(st);
    }

    /**
     * Device Center opens on a phone that is already drawn (#827): the picture's art and each known
     * phone's wallpapers are loaded ahead, when the phone is known or its wallpapers change.
     */
    function prefetch(st) {
        const devs = st.devices.filter((d) => d.online || d.partner);
        if (!devs.length || !root.featureLoader) return;
        root.featureLoader.loadFeature('activesync_device_art').then(() => {
            const D = root.activeSyncDeviceArt;
            if (D && typeof D.wallpapers === 'function') devs.forEach((d) => { void D.wallpapers(d); });
        }, () => {});
    }

    a.on('state', onState);
    root.activeSyncTray = { open: openCenter, _paint: () => paint(a.state()) };
})(typeof window !== 'undefined' ? window : globalThis);
