/**
 * Melaton Mobile: the phone's own Android programs (Yozora #747), before the app becomes a launcher.
 *
 * The Dreamscape app lists the phone's launcher programs (window.AndroidApps, DSApp-Kotlin
 * AndroidApps.kt: list / launch / info, icons as files, the window event 'androidapps'). Here each
 * becomes a program of the shell that starts instead of showing a page (registerApp({ launch })):
 *
 *   Programs > Android      every program that is not hidden, under its own name and icon
 *   Programs                the phone's own Phone, Camera and store ("Marketplace"), linked out of the folder
 *   Settings > System       "Android": the phone's own Settings; "Android Programs": this file's page
 *   Start                   the programs picked on the page's Start Menu tab
 *
 * Android Programs (Settings > System) has two lists: Programs (unchecked = hidden everywhere, for
 * the dozens a phone ships that nobody starts) and Start Menu (checked = on Start itself).
 * Stored on the phone: wmAndroidHidden, wmAndroidStart (JSON arrays of "package/activity").
 * Only inside the app, on phones.
 */
(function () {
    'use strict';

    if (window.uiShell !== 'mobile' || !document.documentElement.classList.contains('ui-mobile')) return;
    const bridge = window.AndroidApps;
    if (!bridge || typeof bridge.list !== 'function') return;

    const HIDDEN_KEY = 'wmAndroidHidden';
    const START_KEY = 'wmAndroidStart';
    const START_MENU_KEY = 'wmStartMenu'; // Settings > Menus' own list (wmPrograms.js)
    const FOLDER = 'android';
    // linked out of the folder under the device's names and with Windows Mobile's own pictures
    // (icon: the 6.1 set, art65: the 6.5 Start icon), never Android's
    const ROLES = {
        phone: { label: 'Phone', icon: 'app-phone', art65: 'phone' },
        camera: { label: 'Camera', icon: 'app-camera', art65: 'camera' },
        store: { label: 'Marketplace', icon: 'app-marketplace', art65: 'marketplace' }
    };
    let sh = null;
    let apps = [];
    const registered = new Set();

    const readSet = (key) => {
        try {
            const v = JSON.parse(localStorage.getItem(key) || '[]');
            return new Set(Array.isArray(v) ? v.map(String) : []);
        } catch (_) { return new Set(); }
    };
    const writeSet = (key, set) => { try { localStorage.setItem(key, JSON.stringify([...set])); } catch (_) { /* this session only */ } };
    const shellId = (a) => `android:${a.id}`;

    function read() {
        try {
            const list = JSON.parse(bridge.list());
            return Array.isArray(list) ? list.filter((a) => a && typeof a.id === 'string' && a.label) : [];
        } catch (_) { return []; }
    }

    function start(a) {
        let ok = false;
        try { ok = bridge.launch(a.id) === true; } catch (_) { ok = false; }
        if (!ok) void sh.messageBox({ title: a.label, text: `${a.label} could not be started. It may have been removed from the device.`, icon: 'warning' });
    }

    /** Programs, Start and Settings follow the phone's list and the two stored choices. */
    function sync() {
        apps = read();
        const hidden = readSet(HIDDEN_KEY);
        const onStart = readSet(START_KEY);
        const want = new Set();
        for (const a of apps) {
            const role = ROLES[a.role] ? a.role : null;
            // the phone's own Settings is "Android" in Settings, never a program of Programs
            if (a.role === 'settings') {
                want.add(shellId(a));
                sh.registerApp({ id: shellId(a), title: 'Android', icon: a.icon, inStart: false, launch: () => start(a) });
                if (window.wmSettings && typeof window.wmSettings.addLink === 'function') {
                    window.wmSettings.addLink({ id: 'link-android', tab: 'system', label: 'Android', icon: a.icon, app: shellId(a) });
                }
                continue;
            }
            if (hidden.has(a.id)) continue;
            want.add(shellId(a));
            sh.registerApp({
                id: shellId(a),
                title: role ? ROLES[role].label : a.label,
                icon: (role && ROLES[role].icon) || a.icon,
                art65: role ? ROLES[role].art65 : undefined,
                // 'bottom': on Start under the pinned programs; 'programs': in Programs only
                inStart: onStart.has(a.id) ? 'bottom' : 'programs',
                programsFolder: role ? undefined : FOLDER,
                launch: () => start(a)
            });
        }
        for (const id of [...registered]) if (!want.has(id)) sh.removeApp(id);
        registered.clear();
        want.forEach((id) => registered.add(id));
        // Settings > Menus keeps one list of what Start shows: the picks here are part of it once it exists
        try {
            const saved = JSON.parse(localStorage.getItem(START_MENU_KEY) || 'null');
            if (Array.isArray(saved)) {
                const next = saved.filter((id) => !String(id).startsWith('android:'));
                for (const a of apps) if (onStart.has(a.id) && !hidden.has(a.id)) next.push(shellId(a));
                if (JSON.stringify(next) !== JSON.stringify(saved)) localStorage.setItem(START_MENU_KEY, JSON.stringify(next));
            }
        } catch (_) { /* Start shows the programs' own places */ }
    }

    function registerPage() {
        const ws = window.wmSettings;
        if (!ws || typeof ws.registerPage !== 'function' || !ws.ui) return;
        const esc = (s) => sh.escapeHtml(s);
        const coll = new Intl.Collator(undefined, { sensitivity: 'base' });
        ws.registerPage({
            id: 'android-programs', tab: 'system', label: 'Android Programs', icon: 'app-folder-android',
            tabs: [['programs', 'Programs'], ['start', 'Start Menu']],
            init() {
                const list = read().filter((a) => a.role !== 'settings').sort((x, y) => coll.compare(x.label, y.label));
                return { list, hidden: readSet(HIDDEN_KEY), start: readSet(START_KEY) };
            },
            render(el, tab, d) {
                const row = (a, on) => `<div class="wm-listbox-row">${ws.ui.check(`aa-${tab}-${a.id}`, a.label, on, `data-id="${esc(a.id)}"`)}</div>`;
                if (tab === 'start') {
                    const shown = d.list.filter((a) => !d.hidden.has(a.id));
                    el.innerHTML = `<p>Checked programs appear in the Start menu.</p>
                        <div class="wm-listbox" style="max-height:calc(190 * var(--wm-px))">${shown.map((a) => row(a, d.start.has(a.id))).join('')}</div>`;
                    el.querySelectorAll('input[data-id]').forEach((c) => c.addEventListener('change', () => {
                        if (c.checked) d.start.add(c.dataset.id); else d.start.delete(c.dataset.id);
                    }));
                    return;
                }
                el.innerHTML = `<p>Checked programs appear in Programs. Clear the ones you never start.</p>
                    <div class="wm-listbox" style="max-height:calc(190 * var(--wm-px))">${d.list.map((a) => row(a, !d.hidden.has(a.id))).join('')}</div>`;
                el.querySelectorAll('input[data-id]').forEach((c) => c.addEventListener('change', () => {
                    if (c.checked) d.hidden.delete(c.dataset.id); else d.hidden.add(c.dataset.id);
                }));
            },
            commit(d) {
                // a program that left the phone leaves the lists with it
                const have = new Set(d.list.map((a) => a.id));
                writeSet(HIDDEN_KEY, new Set([...d.hidden].filter((id) => have.has(id))));
                writeSet(START_KEY, new Set([...d.start].filter((id) => have.has(id) && !d.hidden.has(id))));
                sync();
                return [HIDDEN_KEY, START_KEY, START_MENU_KEY];
            }
        });
    }

    function register() {
        sh = window.wmShell;
        if (window.wmSettings && typeof window.wmSettings.addProgramFolder === 'function') {
            window.wmSettings.addProgramFolder(FOLDER, { label: 'Android', icon: 'app-folder-android' });
        }
        sync();
        registerPage();
        // a program was installed, removed or changed
        let timer = null;
        window.addEventListener('androidapps', () => { clearTimeout(timer); timer = setTimeout(sync, 800); });
    }

    window.wmAndroidApps = { sync, list: () => apps.slice() };

    if (window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
