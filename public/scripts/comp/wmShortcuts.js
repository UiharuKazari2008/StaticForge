/**
 * Pinned shortcuts while Melaton Mobile is the phone's home screen (Yozora #794). A program's
 * "Add to home screen" (Chrome, Contacts, Maps ...) reaches DSApp's PinShortcutActivity, which keeps
 * the request and sends window event 'melatonpin'. Here WM asks where the shortcut goes (Start /
 * Favorites / Cancel, no Android dialog) and answers AndroidShortcuts.answer(token, where).
 *
 * Every kept shortcut is a program of the shell ('android:shortcut:<package>:<id>', the Android
 * group of Programs; on the Start menu when put there), so Favorites and Start list it like any
 * Android program. Tap-and-hold: Move to Start / Move to Favorites / Remove.
 */
(function () {
    'use strict';

    if (window.uiShell !== 'mobile' || !document.documentElement.classList.contains('ui-mobile')) return;
    const bridge = window.AndroidShortcuts;
    if (!bridge || typeof bridge.list !== 'function') return;

    const START_MENU_KEY = 'wmStartMenu';
    let sh = null;
    let registered = new Set();
    let asking = false;

    const shellId = (s) => `android:shortcut:${s.key}`;

    function read() {
        try { const v = JSON.parse(bridge.list() || '[]'); return Array.isArray(v) ? v.filter((s) => s && s.key && s.label) : []; } catch (_) { return []; }
    }

    /** Settings > Menus keeps its own Start list once saved: a shortcut put on Start joins it. */
    function startListAdd(id) {
        try {
            const saved = JSON.parse(localStorage.getItem(START_MENU_KEY) || 'null');
            if (Array.isArray(saved) && !saved.includes(id)) { saved.push(id); localStorage.setItem(START_MENU_KEY, JSON.stringify(saved)); }
        } catch (_) { /* Start shows the programs' own places */ }
    }

    function addFavorite(id) {
        const t = window.wmTodayWidgets;
        if (t && typeof t.addFavorite === 'function') t.addFavorite(`a:${id}`);
    }

    function holdRows(s) {
        return [
            { label: 'Move to Start', disabled: s.where === 'start', action: () => { bridge.setWhere(s.key, 'start'); startListAdd(shellId(s)); sync(); } },
            { label: 'Move to Favorites', disabled: s.where === 'favorites', action: () => { bridge.setWhere(s.key, 'favorites'); sync(); addFavorite(shellId(s)); } },
            '-',
            { label: 'Remove', action: () => removeShortcut(s) }
        ];
    }

    async function removeShortcut(s) {
        const yes = await sh.messageBox({
            title: 'Remove Shortcut', icon: 'warning', text: `Remove the shortcut '${s.label}'?`,
            buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false, default: true }], cancelValue: false
        });
        if (!yes) return;
        bridge.remove(s.key);
        sync();
    }

    function sync() {
        if (!sh) return;
        const want = new Set();
        for (const s of read()) {
            const id = shellId(s);
            want.add(id);
            sh.registerApp({
                id,
                title: s.label,
                icon: s.icon || 'app-android',
                inStart: s.where === 'start' ? 'top' : 'programs',
                programsFolder: 'android',
                launch: async () => {
                    // with WM's wait cursor through the start (#816, wmAndroidApps)
                    const run = () => bridge.launch(s.key) === true;
                    const ok = typeof window.wmAndroidStartWithCursor === 'function' ? await window.wmAndroidStartWithCursor(run) : run();
                    if (ok === false) void sh.messageBox({ title: s.label, icon: 'warning', text: `${s.label} could not be started. The program that made it may have been removed.` });
                },
                holdMenu: () => holdRows(s)
            });
        }
        for (const id of registered) if (!want.has(id)) sh.removeApp(id);
        registered = want;
        document.dispatchEvent(new CustomEvent('wmAppsChanged'));
    }

    /** A pin request waiting: WM's question, then the answer to Android. */
    async function ask() {
        if (asking) return;
        let p = null;
        try { p = JSON.parse(bridge.pending() || 'null'); } catch (_) { p = null; }
        if (!p || !p.token) return;
        asking = true;
        try {
            const where = await sh.messageBox({
                title: 'Add Shortcut', icon: 'question', text: `Add '${p.label}' to the Start menu or to Favorites on Today?`,
                buttons: [{ text: 'Start', value: 'start', default: true }, { text: 'Favorites', value: 'favorites' }, { text: 'Cancel', value: 'cancel' }],
                cancelValue: 'cancel', modal: true
            });
            const ok = bridge.answer(p.token, String(where || 'cancel'));
            if (!ok || where === 'cancel') return;
            sync();
            const s = read().find((x) => x.label === p.label && x.package === p.package);
            if (!s) return;
            if (where === 'start') startListAdd(shellId(s));
            else addFavorite(shellId(s));
        } finally { asking = false; }
    }

    /**
     * Settings > System > Home Screen: Melaton Mobile as the phone's launcher (AndroidHome), the same
     * switch as the app's own settings. Android asks once which home app to use; off goes back to the
     * phone's launcher.
     */
    function registerHomeScreenPage() {
        const home = window.AndroidHome;
        if (!home || typeof home.setEnabled !== 'function') return;
        let page = null;
        const draw = () => {
            if (!page) return;
            const on = !!home.isHome();
            const ui = window.wmSettings && window.wmSettings.ui;
            const check = ui && typeof ui.check === 'function'
                ? ui.check('home', 'Use Melaton Mobile as the home screen', on)
                : `<label class="wm-check"><input type="checkbox" name="home"${on ? ' checked' : ''}><span>Use Melaton Mobile as the home screen</span></label>`;
            page.innerHTML = `<div class="wm-form-hdr">Home Screen</div><div class="wm-form wm-homescreen">${check}
                <p>The Home button brings Today. Android asks once which home app to use, and to let Melaton Mobile run in the background.</p>
                <p>Turn this off to go back to the phone's own launcher.</p></div>`;
            const box = page.querySelector('input[name="home"]');
            if (box) box.addEventListener('change', () => home.setEnabled(box.checked));
        };
        sh.registerApp({ id: 'home-screen', title: 'Home Screen', icon: 'set-today', inStart: false, mount(p) { page = p; draw(); }, show: draw });
        // back from Android's home chooser: the box follows what was picked
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && sh.current === 'home-screen') draw(); });
        const link = () => {
            if (window.wmSettings && typeof window.wmSettings.addLink === 'function') window.wmSettings.addLink({ id: 'link-home-screen', tab: 'system', label: 'Home Screen', icon: 'set-today', app: 'home-screen' });
            else setTimeout(link, 1500);
        };
        link();
    }

    function register() {
        sh = window.wmShell;
        if (!sh || typeof sh.registerApp !== 'function') return;
        registerHomeScreenPage();
        sync();
        window.addEventListener('melatonpin', () => { void ask(); });
        // a request that came while the page was starting
        const tryAsk = () => { if (document.documentElement.dataset.wmBoot === 'done') void ask(); else setTimeout(tryAsk, 1500); };
        tryAsk();
    }

    window.wmShortcuts = { sync, ask };

    if (window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
