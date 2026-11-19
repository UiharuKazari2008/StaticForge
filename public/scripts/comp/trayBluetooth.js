/*
 * The Bluetooth notification icon (#910, #798; docs/client-api/tray-providers.md "bluetooth"): Vista's own (bthprops.cpl
 * icon 2), left of the system icons, for a computer whose platform has a Bluetooth provider (the Android app's desktop
 * shell today: the phone's own radio).
 *
 *   Shown       while the provider says a radio is present and Bluetooth Settings' "Show the Bluetooth icon in the
 *               notification area" is on (HKLM\SYSTEM\CurrentControlSet\Services\BTHPORT\Parameters ShowTrayIcon,
 *               cplDialogs2.js); "Remove Bluetooth Icon" clears that value, as in Vista
 *   Tooltip     "Bluetooth Devices", with the connected devices under it ("Name (battery %)")
 *   Double-click / Enter   Control Panel > Bluetooth Devices
 *   Right-click Vista's menu (bthprops): Add a Bluetooth Device, Show Bluetooth Devices, Open Bluetooth Settings,
 *               Turn Adapter Off / On, Remove Bluetooth Icon, and each paired device to connect or disconnect
 *   Settings    the dialog's "Turn off the Bluetooth adapter" (AdapterOff) switches the radio through the provider
 *
 * Nothing polls: the provider pushes (melatonTray.onChange). Desktop shell only.
 */
(function (root) {
    'use strict';
    const doc = root.document;
    const appScopeSignal = (root.melatonSegments && typeof root.melatonSegments.callerSignal === 'function' && root.melatonSegments.callerSignal()) || undefined; // page listeners end with this file's segment (app-scope, #872/#890)
    const ICON_ID = 'bluetoothTrayIcon';
    const KEY = 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\BTHPORT\\Parameters';

    let state = null;
    let shownTitle = '';

    const provider = () => (root.melatonTray && root.melatonTray.provider('bluetooth')) || null;
    const reg = () => root.melatonRegistry || null;
    const iconEl = () => (doc ? doc.getElementById(ICON_ID) : null);

    function showIconSetting() {
        const r = reg();
        return !r || typeof r.get !== 'function' ? true : r.get(KEY, 'ShowTrayIcon', true) !== false;
    }

    function openDevices() {
        const cp = root.melatonControlPanel;
        if (cp && typeof cp.openItem === 'function') cp.openItem('bluetooth');
    }

    function openSettings() {
        if (root.cplDialogs && typeof root.cplDialogs.open === 'function') root.cplDialogs.open('bluetooth');
    }

    function title(st) {
        if (!st || !st.on) return 'Bluetooth Devices\nThe Bluetooth adapter is turned off';
        const on = (st.devices || []).filter((d) => d.connected);
        return ['Bluetooth Devices'].concat(on.map((d) => (d.battery !== null && d.battery !== undefined ? `${d.name} (${d.battery}%)` : d.name))).join('\n');
    }

    function paint() {
        const icon = iconEl();
        if (!icon) return;
        const show = !!(state && state.present) && showIconSetting();
        if (icon.classList.contains('hidden') === show) icon.classList.toggle('hidden', !show);
        if (!show) return;
        const off = !state.on;
        if (icon.classList.contains('is-off') !== off) icon.classList.toggle('is-off', off);
        const t = title(state);
        if (t !== shownTitle) { shownTitle = t; icon.title = t; }
    }

    function menuItems() {
        const st = state || {};
        const items = [
            { text: 'Add a Bluetooth Device', action: 'bt-add', disabled: !st.on },
            { text: 'Show Bluetooth Devices', action: 'bt-show' },
            { text: 'Open Bluetooth Settings', action: 'bt-settings' },
            { text: st.on ? 'Turn Adapter Off' : 'Turn Adapter On', action: 'bt-power' }
        ];
        const devs = (st.devices || []).slice(0, 12);
        const out = [{ type: 'list', items }];
        if (st.on && devs.length) {
            out.push({ type: 'list', items: devs.map((d) => ({ text: `${d.connected ? 'Disconnect' : 'Connect'} ${d.name}`, action: `bt-dev:${d.id}` })) });
        }
        out.push({ type: 'list', items: [{ text: 'Remove Bluetooth Icon', action: 'bt-remove' }] });
        return out;
    }

    function onAction(action) {
        const p = provider();
        if (action === 'bt-show') openDevices();
        else if (action === 'bt-settings') openSettings();
        else if (action === 'bt-add') { if (p && typeof p.pair === 'function') p.pair(); else openDevices(); }
        else if (action === 'bt-power') { if (p && typeof p.power === 'function') p.power(!(state && state.on)); }
        else if (action === 'bt-remove') { const r = reg(); if (r && typeof r.set === 'function') void r.set(KEY, { ShowTrayIcon: false }); paint(); }
        else if (action.startsWith('bt-dev:') && p) {
            const id = action.slice(7);
            const d = (state && state.devices || []).find((x) => x.id === id);
            if (!d) return;
            const fn = d.connected ? p.disconnect : p.connect;
            if (typeof fn === 'function') Promise.resolve(fn.call(p, id)).then((r) => { if (r && r.via === 'settings' && typeof p.openSettings === 'function') { /* Android opened its own settings */ } }).catch(() => {});
        }
    }

    function wire() {
        const icon = iconEl();
        if (!icon || icon.dataset.btWired === '1') return;
        icon.dataset.btWired = '1';
        icon.tabIndex = 0;
        icon.addEventListener('dblclick', (e) => { e.preventDefault(); openDevices(); });
        icon.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); openDevices(); } });
        const cm = root.contextMenu;
        if (cm && typeof cm.attachToElement === 'function') {
            // the menu is built when it opens: the devices and the adapter's state change
            const config = { sections: menuItems(), onAction, beforeShow: () => { config.sections = menuItems(); } };
            cm.attachToElement(icon, config);
        }
    }

    let lastOff = null;
    function onRegistry(key, values) {
        if (key !== KEY) return;
        paint();
        // Bluetooth Settings' "Turn off the Bluetooth adapter": the real radio
        const off = !!(values && values.AdapterOff);
        if (lastOff === null) { lastOff = off; return; }
        if (off === lastOff) return;
        lastOff = off;
        const p = provider();
        if (p && typeof p.power === 'function' && state && state.on === off) p.power(!off);
    }

    function start() {
        if (root.uiShell === 'mobile' || !iconEl() || !root.melatonTray) return;
        wire();
        const off = root.melatonTray.onChange('bluetooth', (st) => { state = st || null; paint(); });
        if (appScopeSignal) appScopeSignal.addEventListener('abort', off, { once: true });
        const p = provider();
        try { state = p && p.get ? p.get() : null; } catch (_) { state = null; }
        const r = reg();
        if (r && typeof r.onChange === 'function') {
            lastOff = r.get(KEY, 'AdapterOff', false) === true;
            const offReg = r.onChange(onRegistry);
            if (appScopeSignal) appScopeSignal.addEventListener('abort', offReg, { once: true });
        }
        paint();
    }

    root.trayBluetooth = { state: () => state, repaint: paint };
    if (!doc) return;
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start, { once: true, signal: appScopeSignal });
    else start();
})(typeof window !== 'undefined' ? window : globalThis);
