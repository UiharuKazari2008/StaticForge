/**
 * Melaton Mobile: shared bits for the Dreamscape suite phone apps (Yozora #732, parent #709):
 * Spellcaster (wmSpellcaster.js), Characters (wmCharacters.js), Expanders (wmExpanders.js),
 * Atelier (wmAtelier.js), eMotion LIVE (wmEmotion.js), Phasewalker (wmPhasewalker.js).
 *
 * Each app is a real WM 6.1 program in its own file; this only holds what they all repeat: HTML
 * escaping, the server connection, loading a desktop feature bundle (the desktop's own code the apps
 * call), tap-and-hold menus, "answer or notify" for errors (Yukimi's rule: in-app information is a
 * message box, background information a notification), and the WM combo box. Styles shared by the
 * apps: public/css/wm-suite-kit.css (.wsk-*). Only on phones.
 */
(function () {
    'use strict';

    if (window.uiShell !== 'mobile' || !document.documentElement.classList.contains('ui-mobile')) return;

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const wsc = () => window.wsClient || null;
    const connected = () => { const c = wsc(); return !!(c && typeof c.isConnected === 'function' && c.isConnected()); };

    /** The desktop feature bundle (featureLoader.js) whose code an app reuses; resolves false when it failed. */
    async function feature(name) {
        try {
            if (window.featureLoader && typeof window.featureLoader.loadFeature === 'function') await window.featureLoader.loadFeature(name);
            return true;
        } catch (err) {
            console.warn('[wmSuiteKit] feature', name, err);
            return false;
        }
    }

    /**
     * Run fn once a desktop feature bundle has loaded, by whatever route (the desktop Start entry, Run,
     * a viewer button): the phone apps point the bundle's window openers at themselves there.
     */
    const featureHooks = new Map(); // name -> [fn]
    let loaderWrapped = false;
    function afterFeature(name, fn) {
        if (!featureHooks.has(name)) featureHooks.set(name, []);
        featureHooks.get(name).push(fn);
        const fl = window.featureLoader;
        if (fl && !loaderWrapped && typeof fl.loadFeature === 'function') {
            loaderWrapped = true;
            const orig = fl.loadFeature;
            fl.loadFeature = async function (n, ...rest) {
                const r = await orig.call(this, n, ...rest);
                for (const f of featureHooks.get(n) || []) { try { f(); } catch (err) { console.warn('[wmSuiteKit] feature hook', n, err); } }
                return r;
            };
        }
        // already loaded before the app registered
        try { if (fl && typeof fl.isLoaded === 'function' && fl.isLoaded(name)) fn(); } catch (_) { /* next load */ }
    }

    /**
     * Tell the user something about their own action (a message box over the app) when the app is in
     * front, else a notification (it happened in the background).
     */
    function tell(appId, { title, text, icon = 'info', buttons = null } = {}) {
        const sh = window.wmShell;
        if (!sh) return Promise.resolve(null);
        if (sh.current === appId && !buttons) return sh.messageBox({ title, text, icon: icon === 'success' ? 'info' : icon, modal: true });
        return sh.notify({ title, text, icon, asNote: true, buttons });
    }

    const errText = (err) => String((err && (err.message || err.error)) || err || '').trim();

    /** Tap-and-hold (and right click) on rows matching selector: fn(row, x, y); the click after a hold is eaten. */
    function onHold(el, selector, fn) {
        let timer = null;
        let start = null;
        let held = false;
        const clear = () => { clearTimeout(timer); timer = null; };
        el.addEventListener('pointerdown', (e) => {
            if (e.button !== 0 && e.pointerType === 'mouse') return;
            held = false;
            const row = e.target.closest(selector);
            if (!row) return;
            start = { x: e.clientX, y: e.clientY };
            clear();
            timer = setTimeout(() => { held = true; fn(row, start.x, start.y); }, 550);
        });
        el.addEventListener('pointermove', (e) => { if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) clear(); });
        ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => el.addEventListener(t, clear));
        el.addEventListener('contextmenu', (e) => {
            const row = e.target.closest(selector);
            if (!row) return;
            e.preventDefault();
            if (held) return;
            held = true;
            clear();
            fn(row, e.clientX, e.clientY);
        });
        el.addEventListener('click', (e) => {
            if (!held) return;
            held = false;
            e.stopPropagation();
            e.preventDefault();
        }, true);
    }

    /**
     * A WM combo box (the value and the drop arrow); a tap opens the shell's drop-down with the
     * choices, the current one dotted. choices: [{ value, label }]; onPick(value).
     */
    function combo(btn, choices, current, onPick) {
        const sh = window.wmShell;
        const list = typeof choices === 'function' ? choices() : choices;
        sh.dropdown(btn, list.map((c) => ({ label: c.label, radio: c.value === current(), action: () => onPick(c.value) })));
    }

    function comboHtml(cls, label) {
        return `<button type="button" class="wsk-combo ${cls}"><span class="wsk-combo-text">${esc(label)}</span><span class="wsk-combo-arrow" aria-hidden="true"></span></button>`;
    }

    /** img src / srcset of a WM art name (public/static_images/wm61: name.png, @2x, @4x). */
    function artAttrs(name) {
        const b = `/static_images/wm61/${name}`;
        return `src="${b}.png" srcset="${b}@2x.png 2x, ${b}@4x.png 4x"`;
    }

    /** Copy text the desktop's way (copyTextToClipboard, utilities.js), else the async clipboard. */
    async function copy(text) {
        /* global copyTextToClipboard */
        if (typeof copyTextToClipboard === 'function') { await copyTextToClipboard(text); return true; }
        if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); return true; }
        return false;
    }

    /** Is Studio's form (the desktop #manualModal the phone's Studio app hosts) open? */
    const studioOpen = () => {
        const m = document.getElementById('manualModal');
        return !!(m && !m.classList.contains('hidden') && getComputedStyle(m).display !== 'none');
    };

    window.wmSuiteKit = { esc, wsc, connected, feature, afterFeature, tell, errText, onHold, combo, comboHtml, artAttrs, copy, studioOpen };
})();
