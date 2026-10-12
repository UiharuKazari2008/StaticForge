/**
 * Melaton boot: the Windows loading on /launch for desktop starts (PWA and browser tabs).
 *
 *   boot     Vista boot screen (black, Enso, green marquee) while the checks run:
 *            offline → menu. /status: any JSON answer counts as connected, so a starting
 *            server keeps the marquee running until it says ready (no cap). A client-side
 *            timeout means alive but busy (menu after busyTimeoutMs without an answer).
 *            Network / proxy errors: menu after maxFailures in a row. Then the session
 *            (OPTIONS /app: 401/403 → login page, other errors → menu). F8 opens the menu.
 *   handoff  success: cut to black for modeSwitchMs (Windows switching graphics modes),
 *            then /app, which opens on teal; the logon dialog waits until tealHoldMs after
 *            that (app.html + websocket.js _deferPreStartupForTealHold)
 *   menu     failure: cut to black, Boot Manager text screen, countdownSec → retry
 *   confirm  Melaton Recovery: ENTER continue / ESC back; chosen by touch, a two-item menu
 *            (Continue / Return to Boot Menu) since there is no keyboard to assume
 *   recover  "Formatting startup disk..." + progress bar while the clean install runs
 *            (Cache Storage, SW, local/session storage, IndexedDB) → /launch
 *
 * Design mode (/launch?design=1) previews every screen: no checks, no wipe, no navigation.
 * Yozora #411 (plan), #416 (S2), #417 (S3). Test: scripts/test-melaton-boot.js.
 */
(function (root) {
    'use strict';

    const config = {
        minBootMs: 2500,        // the boot screen shows at least this long
        pollMs: 2000,
        probeTimeoutMs: 4000,
        sessionTimeoutMs: 8000,
        maxFailures: 6,         // network / proxy errors in a row (~12 s) before the menu
        busyTimeoutMs: 120000,  // client timeouts with no answer before the menu
        blackCutMs: 600,
        modeSwitchMs: 1500,     // black between the boot screen and /app (graphics mode switch)
        countdownSec: 10,
        tealHoldMs: 2000,
        recoverStepMs: 350      // each recovery line stays at least this long
    };

    const ENTRIES = [
        { id: 'melaton', label: 'Dreamscape Melaton' },
        { id: 'recovery', label: 'Melaton Recovery (Reinstall)' }
    ];

    const INFO = {
        offline: 'This device is not connected to a network.',
        unreachable: 'The server did not respond.',
        busy: 'The server stopped responding while it was starting.',
        session: 'The server could not confirm this session.'
    };

    // weight = share of the formatting progress bar
    const RECOVERY_STEPS = [
        { id: 'caches', label: 'Removing downloaded files', weight: 0.45 },
        { id: 'serviceWorker', label: 'Removing the offline service', weight: 0.1 },
        { id: 'storage', label: 'Clearing settings', weight: 0.1 },
        { id: 'indexedDb', label: 'Removing local databases', weight: 0.35 }
    ];

    const CONFIRM_OPTIONS = [
        { id: 'continue', label: 'Continue' },
        { id: 'menu', label: 'Return to Boot Menu' }
    ];

    function timeoutSignal(ms) {
        if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
            return AbortSignal.timeout(ms);
        }
        if (typeof AbortController === 'undefined') return undefined;
        const ctrl = new AbortController();
        setTimeout(() => ctrl.abort(), ms);
        return ctrl.signal;
    }

    /** One /status probe → { kind: 'json' | 'http' | 'timeout' | 'network' | 'offline' } */
    async function probeStatus(env) {
        if (env.navigator && env.navigator.onLine === false) return { kind: 'offline' };
        try {
            const res = await env.fetch('/status', {
                method: 'OPTIONS',
                cache: 'no-cache',
                signal: timeoutSignal(config.probeTimeoutMs)
            });
            if (!res.ok) return { kind: 'http', status: res.status };
            let data = null;
            try {
                data = await res.json();
            } catch (_) {
                return { kind: 'http', status: res.status };
            }
            if (!data || typeof data !== 'object' || typeof data.isReady !== 'boolean') {
                return { kind: 'http', status: res.status };
            }
            return { kind: 'json', data };
        } catch (err) {
            const name = err && err.name;
            if (name === 'TimeoutError' || name === 'AbortError') return { kind: 'timeout' };
            return { kind: 'network' };
        }
    }

    /** OPTIONS /app → 'ok' | 'login' | 'error' */
    async function checkSession(env) {
        try {
            const res = await env.fetch('/app', {
                method: 'OPTIONS',
                cache: 'no-cache',
                signal: timeoutSignal(config.sessionTimeoutMs)
            });
            if (res.ok) return 'ok';
            if (res.status === 401 || res.status === 403) return 'login';
            return 'error';
        } catch (_) {
            return 'error';
        }
    }

    function withTimeout(promise, ms) {
        return Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve('timeout'), ms))]);
    }

    /**
     * Clean install: everything this device holds for Dreamscape. onStep(id, state) reports
     * 'start' / 'done' / 'failed' per RECOVERY_STEPS entry; a failed step does not stop the rest.
     * onProgress(fraction 0..1) drives the formatting bar (step weights, per cache / database
     * inside the big steps).
     */
    async function cleanInstall(env, onStep, onProgress) {
        const w = env.window || {};
        let base = 0;
        let current = null;
        const report = (within) => {
            if (!onProgress || !current) return;
            onProgress(Math.min(1, base + current.weight * Math.max(0, Math.min(1, within))));
        };
        const eachWithProgress = async (items, fn) => {
            let done = 0;
            await Promise.all(items.map(async (item) => {
                await fn(item);
                done += 1;
                report(done / items.length);
            }));
        };
        const actions = {
            async caches() {
                if (!w.caches) return;
                const names = await w.caches.keys();
                await eachWithProgress(names, (name) => w.caches.delete(name));
            },
            async serviceWorker() {
                const sw = w.navigator && w.navigator.serviceWorker;
                if (!sw || typeof sw.getRegistrations !== 'function') return;
                const regs = await sw.getRegistrations();
                await Promise.all(regs.map((reg) => reg.unregister()));
            },
            async storage() {
                try { if (w.localStorage) w.localStorage.clear(); } catch (_) { /* blocked */ }
                try { if (w.sessionStorage) w.sessionStorage.clear(); } catch (_) { /* blocked */ }
            },
            async indexedDb() {
                const idb = w.indexedDB;
                if (!idb || typeof idb.databases !== 'function') return;
                const dbs = (await idb.databases()).filter((db) => db && db.name);
                await eachWithProgress(dbs, (db) => withTimeout(new Promise((resolve) => {
                    const req = idb.deleteDatabase(db.name);
                    req.onsuccess = req.onerror = req.onblocked = () => resolve();
                }), 2000));
            }
        };
        const results = {};
        for (const step of RECOVERY_STEPS) {
            current = step;
            if (onStep) onStep(step.id, 'start');
            report(0);
            const started = env.now();
            let ok = true;
            try {
                await actions[step.id]();
            } catch (err) {
                ok = false;
                if (typeof console !== 'undefined' && console.warn) console.warn(`Melaton Recovery: ${step.id} failed`, err);
            }
            const rest = config.recoverStepMs - (env.now() - started);
            if (rest > 0) await env.sleep(rest);
            results[step.id] = ok;
            report(1);
            base += step.weight;
            if (onStep) onStep(step.id, ok ? 'done' : 'failed');
        }
        if (onProgress) onProgress(1);
        return results;
    }

    function createController(env, view) {
        const ctl = {
            screen: null,
            runId: 0,
            selected: 0,
            countdown: null,
            countdownTimer: null,
            info: null,
            confirmMode: 'keyboard',
            confirmSelected: 0,
            recoverProgress: 0,
            lastProbe: null,
            serverStatus: null
        };

        function show(screen, data) {
            ctl.screen = screen;
            view.render(screen, data || {});
        }

        function menuData() {
            return { entries: ENTRIES, selected: ctl.selected, countdown: ctl.countdown, info: ctl.info };
        }

        function stopCountdown() {
            if (ctl.countdownTimer) env.clearInterval(ctl.countdownTimer);
            ctl.countdownTimer = null;
            if (ctl.countdown != null) {
                ctl.countdown = null;
                if (ctl.screen === 'menu') show('menu', menuData());
            }
        }

        function startCountdown() {
            stopCountdown();
            ctl.countdown = config.countdownSec;
            ctl.countdownTimer = env.setInterval(() => {
                if (ctl.screen !== 'menu') return stopCountdown();
                ctl.countdown -= 1;
                if (ctl.countdown <= 0) {
                    const pick = ctl.selected;
                    stopCountdown();
                    choose(pick);
                    return;
                }
                show('menu', menuData());
            }, 1000);
        }

        async function cutToBlack() {
            show('black');
            await env.sleep(config.blackCutMs);
        }

        async function openMenu(reason, options = {}) {
            ctl.runId += 1; // cancels a running check loop
            ctl.info = reason && INFO[reason] ? INFO[reason] : null;
            ctl.selected = 0;
            if (options.cut !== false) await cutToBlack();
            show('menu', { entries: ENTRIES, selected: 0, countdown: config.countdownSec, info: ctl.info });
            if (options.countdown !== false) startCountdown();
            else show('menu', menuData());
        }

        /** Boot screen → black (the graphics mode switch) → /app, which opens on teal. */
        async function handOff() {
            show('black');
            if (env.designMode) return;
            await env.sleep(config.modeSwitchMs);
            try {
                env.sessionStorage.setItem('dreamscapeLaunchHandoff', 'teal');
                env.sessionStorage.setItem('dreamscapeBootTealHoldUntil', String(env.now() + config.tealHoldMs));
            } catch (_) { /* the logon dialog just shows without the hold */ }
            env.location.replace('/app');
        }

        async function runChecks() {
            const run = ++ctl.runId;
            const startedAt = env.now();
            let failures = 0;
            let busySince = null;
            show('boot');
            if (env.designMode) return 'design';
            for (;;) {
                const probe = await probeStatus(env);
                if (run !== ctl.runId) return 'cancelled';
                ctl.lastProbe = probe;
                if (probe.kind === 'offline') {
                    await openMenu('offline');
                    return 'menu';
                }
                if (probe.kind === 'json') {
                    failures = 0;
                    busySince = null;
                    ctl.serverStatus = probe.data;
                    if (probe.data.isReady) break;
                } else if (probe.kind === 'timeout') {
                    if (busySince == null) busySince = env.now();
                    if (env.now() - busySince >= config.busyTimeoutMs) {
                        await openMenu('busy');
                        return 'menu';
                    }
                } else {
                    failures += 1;
                    if (failures >= config.maxFailures) {
                        await openMenu('unreachable');
                        return 'menu';
                    }
                }
                await env.sleep(config.pollMs);
                if (run !== ctl.runId) return 'cancelled';
            }
            const session = await checkSession(env);
            if (run !== ctl.runId) return 'cancelled';
            if (session === 'error') {
                await openMenu('session');
                return 'menu';
            }
            const rest = startedAt + config.minBootMs - env.now();
            if (rest > 0) await env.sleep(rest);
            if (run !== ctl.runId) return 'cancelled';
            if (session === 'login') {
                env.location.replace('/');
                return 'login';
            }
            await handOff();
            if (run !== ctl.runId) return 'cancelled';
            return 'teal';
        }

        async function retry() {
            stopCountdown();
            await cutToBlack();
            return runChecks();
        }

        function confirmData() {
            return { mode: ctl.confirmMode, options: CONFIRM_OPTIONS, selected: ctl.confirmSelected };
        }

        /** mode 'touch': a two-item menu (no keyboard to assume); 'keyboard': ENTER / ESC */
        function showConfirm(mode) {
            stopCountdown();
            ctl.confirmMode = mode === 'touch' ? 'touch' : 'keyboard';
            ctl.confirmSelected = 0;
            show('confirm', confirmData());
        }

        function backToMenu() {
            show('menu', menuData());
            return null;
        }

        async function recover() {
            ctl.recoverProgress = 0;
            show('recover', { progress: 0, restarting: false });
            const onProgress = (fraction) => {
                ctl.recoverProgress = fraction;
                show('recover', { progress: fraction, restarting: false });
            };
            if (env.designMode) {
                let base = 0;
                for (const step of RECOVERY_STEPS) {
                    await env.sleep(config.recoverStepMs);
                    base += step.weight;
                    onProgress(base);
                }
            } else {
                await cleanInstall(env, null, onProgress);
            }
            show('recover', { progress: 1, restarting: true });
            await env.sleep(config.blackCutMs);
            await cutToBlack();
            if (env.designMode) return 'design';
            env.location.replace('/launch');
            return 'restart';
        }

        function choose(index, mode) {
            const entry = ENTRIES[index];
            if (!entry || ctl.screen !== 'menu') return null;
            ctl.selected = index;
            stopCountdown();
            if (entry.id === 'melaton') return retry();
            showConfirm(mode);
            return null;
        }

        function confirmOption(index) {
            const option = CONFIRM_OPTIONS[index];
            if (!option) return null;
            return option.id === 'continue' ? recover() : backToMenu();
        }

        /** Keyboard: returns true when the key was used. */
        function handleKey(key) {
            if (ctl.screen === 'boot') {
                if (key === 'F8') {
                    // Asked for: no countdown, nothing starts until a choice is made
                    openMenu(null, { cut: true, countdown: false });
                    return true;
                }
                return false;
            }
            if (ctl.screen === 'menu') {
                stopCountdown(); // any key stops the countdown, like Windows
                if (key === 'ArrowUp') {
                    ctl.selected = Math.max(0, ctl.selected - 1);
                } else if (key === 'ArrowDown') {
                    ctl.selected = Math.min(ENTRIES.length - 1, ctl.selected + 1);
                } else if (key === 'Enter') {
                    choose(ctl.selected);
                    return true;
                }
                show('menu', menuData());
                return true;
            }
            if (ctl.screen === 'confirm') {
                if (key === 'Escape') {
                    backToMenu();
                    return true;
                }
                if (ctl.confirmMode === 'touch') {
                    if (key === 'ArrowUp' || key === 'ArrowDown') {
                        ctl.confirmSelected = key === 'ArrowUp' ? 0 : CONFIRM_OPTIONS.length - 1;
                        show('confirm', confirmData());
                        return true;
                    }
                    if (key === 'Enter') {
                        confirmOption(ctl.confirmSelected);
                        return true;
                    }
                    return false;
                }
                if (key === 'Enter') {
                    recover();
                    return true;
                }
                return false;
            }
            return false;
        }

        /**
         * Touch / mouse: a tap on an entry chooses it; any press on the menu stops the countdown.
         * pointerType 'touch' / 'pen' choosing Recovery gets the touch confirm menu.
         */
        function handlePointer(action, index, pointerType) {
            const mode = pointerType === 'touch' || pointerType === 'pen' ? 'touch' : 'keyboard';
            if (ctl.screen === 'menu') {
                stopCountdown();
                if (action === 'choose') return choose(typeof index === 'number' ? index : ctl.selected, mode);
                return null;
            }
            if (ctl.screen === 'confirm') {
                if (action === 'option' && typeof index === 'number') return confirmOption(index);
                if (action === 'continue') return recover();
                if (action === 'cancel') return backToMenu();
            }
            return null;
        }

        /** Design mode: show one screen without running anything. */
        function preview(name) {
            ctl.runId += 1;
            stopCountdown();
            if (name === 'boot') return show('boot');
            if (name === 'black') return show('black');
            if (name === 'teal') return show('teal');
            if (name === 'menu' || name === 'menu-info') {
                ctl.info = name === 'menu-info' ? INFO.unreachable : null;
                ctl.selected = 0;
                ctl.countdown = config.countdownSec;
                return show('menu', menuData());
            }
            if (name === 'confirm' || name === 'confirm-touch') {
                ctl.confirmMode = name === 'confirm-touch' ? 'touch' : 'keyboard';
                ctl.confirmSelected = 0;
                return show('confirm', confirmData());
            }
            if (name === 'recover') return show('recover', { progress: 0.42, restarting: false });
            return null;
        }

        Object.assign(ctl, { runChecks, openMenu, retry, choose, confirmOption, handleKey, handlePointer, preview, recover, stopCountdown, handOff });
        return ctl;
    }

    // ---------- DOM view ----------

    function el(doc, tag, cls, text) {
        const node = doc.createElement(tag);
        if (cls) node.className = cls;
        if (text != null) node.textContent = text;
        return node;
    }

    function textScreen(doc, title, bodyNodes, footerButtons) {
        const frag = doc.createDocumentFragment();
        frag.appendChild(el(doc, 'div', 'melaton-text-band', title));
        const body = el(doc, 'div', 'melaton-text-body');
        bodyNodes.forEach((n) => body.appendChild(n));
        frag.appendChild(body);
        const footer = el(doc, 'div', 'melaton-text-band melaton-text-footer');
        if (!footerButtons.length) footer.textContent = '\u00a0'; // the band keeps its line
        footerButtons.forEach(([label, action]) => {
            const btn = el(doc, 'button', 'melaton-text-key', label);
            btn.type = 'button';
            btn.dataset.action = action;
            footer.appendChild(btn);
        });
        frag.appendChild(footer);
        return frag;
    }

    function createDomView(doc) {
        const rootEl = doc.getElementById('melatonBoot');
        const textEl = doc.getElementById('melatonBootText');
        return {
            render(screen, data) {
                if (!rootEl) return;
                rootEl.dataset.screen = screen;
                if (!textEl) return;
                if (screen === 'menu') {
                    const list = el(doc, 'ul', 'melaton-boot-entries');
                    data.entries.forEach((entry, i) => {
                        const li = el(doc, 'li', i === data.selected ? 'selected' : '', entry.label);
                        li.dataset.index = String(i);
                        li.setAttribute('role', 'option');
                        li.setAttribute('aria-selected', i === data.selected ? 'true' : 'false');
                        list.appendChild(li);
                    });
                    list.setAttribute('role', 'listbox');
                    const nodes = [
                        el(doc, 'p', 'melaton-text-tight', 'Choose an operating system to start:'),
                        el(doc, 'p', null, '(Use the arrow keys to highlight your choice, then press ENTER.)'),
                        list,
                        el(doc, 'p', 'melaton-boot-countdown', data.countdown != null
                            ? `Seconds until the highlighted choice will be started automatically: ${data.countdown}`
                            : ' ')
                    ];
                    if (data.info) nodes.push(el(doc, 'p', 'melaton-boot-info', `Info: ${data.info}`));
                    textEl.replaceChildren(textScreen(doc, 'Melaton Boot Manager', nodes, [['ENTER=Choose', 'choose']]));
                } else if (screen === 'confirm') {
                    const intro = [
                        el(doc, 'p', null, 'Melaton Recovery will remove MeletonFX from this device and install it again.'),
                        el(doc, 'p', null, 'Everything stored on this device is deleted: downloaded files, the offline service, settings and local databases. Your images and data on the server are not affected. You may have to sign in again.')
                    ];
                    if (data.mode === 'touch') {
                        const list = el(doc, 'ul', 'melaton-boot-entries melaton-confirm-options');
                        list.setAttribute('role', 'listbox');
                        data.options.forEach((option, i) => {
                            const li = el(doc, 'li', i === data.selected ? 'selected' : '', option.label);
                            li.dataset.option = String(i);
                            li.setAttribute('role', 'option');
                            li.setAttribute('aria-selected', i === data.selected ? 'true' : 'false');
                            list.appendChild(li);
                        });
                        textEl.replaceChildren(textScreen(doc, 'Melaton Recovery', [...intro, list], [['ENTER=Choose', 'option-selected']]));
                    } else {
                        textEl.replaceChildren(textScreen(doc, 'Melaton Recovery', [
                            ...intro,
                            el(doc, 'p', null, 'Press ENTER to continue, or ESC to return to the boot menu.')
                        ], [['ENTER=Continue', 'continue'], ['ESC=Cancel', 'cancel']]));
                    }
                } else if (screen === 'recover') {
                    const pct = Math.round(Math.max(0, Math.min(1, data.progress || 0)) * 1000) / 10;
                    const bar = el(doc, 'div', 'melaton-format-bar');
                    bar.setAttribute('role', 'progressbar');
                    bar.setAttribute('aria-valuemin', '0');
                    bar.setAttribute('aria-valuemax', '100');
                    bar.setAttribute('aria-valuenow', String(Math.round(pct)));
                    const fill = el(doc, 'div', 'melaton-format-bar-fill');
                    fill.style.width = `${pct}%`;
                    bar.appendChild(fill);
                    const nodes = [el(doc, 'p', 'melaton-text-tight', 'Formatting startup disk...'), bar];
                    if (data.restarting) nodes.push(el(doc, 'p', 'melaton-recover-restart', 'Restarting...'));
                    textEl.replaceChildren(textScreen(doc, 'Melaton Recovery', nodes, []));
                } else {
                    textEl.replaceChildren();
                }
            }
        };
    }

    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    /** Wire the controller to the page (launch.html). */
    function start(win) {
        const doc = win.document;
        const env = {
            window: win,
            fetch: win.fetch.bind(win),
            navigator: win.navigator,
            sessionStorage: win.sessionStorage,
            location: win.location,
            now: () => Date.now(),
            sleep,
            setInterval: win.setInterval.bind(win),
            clearInterval: win.clearInterval.bind(win),
            designMode: !!win.dreamscapeDesignModeActive
        };
        const ctl = createController(env, createDomView(doc));
        win.melatonBoot = Object.assign(win.melatonBoot || {}, { controller: ctl, preview: ctl.preview });

        win.addEventListener('keydown', (ev) => {
            if (ev.repeat && ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') return;
            if (ctl.handleKey(ev.key)) ev.preventDefault();
        });
        const text = doc.getElementById('melatonBootText');
        if (text) {
            let lastPointerType = 'mouse';
            text.addEventListener('pointerdown', (ev) => {
                lastPointerType = ev.pointerType || 'mouse';
                ctl.stopCountdown();
            });
            text.addEventListener('click', (ev) => {
                const pointerType = ev.pointerType || lastPointerType;
                const entry = ev.target.closest('[data-index]');
                if (entry) {
                    ctl.handlePointer('choose', Number(entry.dataset.index), pointerType);
                    return;
                }
                const option = ev.target.closest('[data-option]');
                if (option) {
                    ctl.handlePointer('option', Number(option.dataset.option), pointerType);
                    return;
                }
                const key = ev.target.closest('[data-action]');
                if (!key) return;
                if (key.dataset.action === 'option-selected') ctl.handleKey('Enter');
                else ctl.handlePointer(key.dataset.action, undefined, pointerType);
            });
        }
        ctl.runChecks();
        if (env.designMode) {
            // /launch?design=1&screen=menu opens one screen directly (review links, screenshots)
            let screen = null;
            try { screen = new URLSearchParams(win.location.search || '').get('screen'); } catch (_) { /* ignore */ }
            if (screen) ctl.preview(screen);
        }
        return ctl;
    }

    const api = { config, ENTRIES, INFO, RECOVERY_STEPS, CONFIRM_OPTIONS, probeStatus, checkSession, cleanInstall, createController, createDomView, start };
    if (root) {
        root.melatonBoot = Object.assign(root.melatonBoot || {}, api);
        const doc = root.document;
        const active = doc && doc.documentElement && doc.documentElement.classList.contains('melaton-boot');
        if (active) {
            if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', () => start(root));
            else start(root);
        }
    }
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null);
