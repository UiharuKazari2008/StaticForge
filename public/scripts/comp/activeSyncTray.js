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
 *             charged (100% while charging, once per charge)
 *   new device   one that waits for the choice opens Device Center (OpenOnConnect)
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

    function balloon(type, title, text) {
        if (!icon || !root.PopoverManager || typeof root.PopoverManager.showPopover !== 'function') return;
        root.PopoverManager.showPopover(icon, type, esc(title), esc(text), false, 8000, `<img src="${ART}/activesync-32.png" alt="" width="32" height="32">`, null, { popupId: 'activesync', position: 'top', arrowPosition: 'bottom-right' });
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
                        const devices = a.state().devices.filter((d) => d.online || d.partner);
                        s.items = [{ text: 'Open Melaton Mobile Device Center', action: 'open', default: true }];
                        if (devices.length) s.items.push({ separator: true }, ...devices.map((d) => ({ text: line(d), action: `dev:${d.deviceId}` })));
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
        if (img) img.src = `${ART}/${online.length ? 'activesync-16.png' : 'activesync-idle-16.png'}`;
        el.title = known.length ? `Melaton Mobile Device Center\n${known.map(line).join('\n')}` : 'Melaton Mobile Device Center';
        if (known.length && el.classList.contains('hidden')) {
            // revealTrayIconElement: public/scripts/comp/trayIndicators.js
            if (typeof root.revealTrayIconElement === 'function') root.revealTrayIconElement(el); else el.classList.remove('hidden');
        } else if (!known.length) {
            el.classList.add('hidden');
        }
    }

    function onState(st) {
        if (!st.online) { paint({ devices: [] }); seen.clear(); first = true; return; }
        paint(st);
        for (const d of st.devices) {
            const was = seen.get(d.deviceId);
            // the first list after a (re)connect is the state of things, not news
            if (!first) {
                if (d.online && !(was && was.online)) {
                    if (d.session === 'pending') { if (setting('OpenOnConnect')) openCenter(d.deviceId); }
                    else if (setting('NotifyOnConnect')) balloon('success', 'Device connected', `${d.name} is connected.`);
                } else if (!d.online && was && was.online && was.session !== 'pending') {
                    if (setting('NotifyOnConnect')) balloon('info', 'Device disconnected', `${d.name} is no longer connected.`);
                }
            }
            const b = d.online && d.status && d.status.battery;
            // fully charged: once per charge, said again only after it was unplugged or fell below 95%
            if (b && b.level != null) {
                if (b.level >= 100 && b.charging === true && !fullTold.has(d.deviceId)) {
                    fullTold.add(d.deviceId);
                    if (!first && setting('NotifyBattery')) balloon('success', 'Battery fully charged', `${d.name} is fully charged.`);
                } else if (b.charging === false || b.level < 95) {
                    fullTold.delete(d.deviceId);
                }
            }
            if (b && b.level != null) {
                if (b.level <= LOW_BATTERY && b.charging === false && !lowWarned.has(d.deviceId)) {
                    lowWarned.add(d.deviceId);
                    if (!first && setting('NotifyBattery')) balloon('warning', 'Battery low', `${d.name} has ${Math.round(b.level)}% battery left.`);
                } else if (b.charging || b.level > LOW_BATTERY + 5) {
                    lowWarned.delete(d.deviceId);
                }
            }
            seen.set(d.deviceId, { online: d.online, session: d.session });
        }
        first = false;
    }

    a.on('state', onState);
    root.activeSyncTray = { open: openCenter, _paint: () => paint(a.state()) };
})(typeof window !== 'undefined' ? window : globalThis);
