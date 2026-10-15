/**
 * Desktop boot stages — the XP-style staged reveal, the top-left startup window's
 * text, per-step watchdogs, and the server-restart session lock.
 *
 * Reveal order after the logon dialog closes (websocket.js _completePreStartupHandoff):
 *   session  → solid colour only (body.windows-startup teal), splash opens
 *   settings → "Preparing your desktop..." (init steps before the wallpaper preload)
 *   wallpaper→ after "Loading wallpaper" (assetPreload.js) has decoded the bitmap
 *   icons    → after "Loading desktop icons"
 *   taskbar  → after "Loading desktop assets" (step 16 only unhides the taskbar element)
 *   windows  → "Preparing your desktop..." (step 31 Loading Gallery)
 *   done     → "Welcome", splash closes last (hideProgressNotification awaits finish())
 * Each stage holds for at least config.dwellMs[stage] so the sequence is visible even
 * when the real init steps finish in a few hundred milliseconds. body.boot-staged plus
 * the cumulative body.boot-reveal-* classes drive public/css/desktop-boot.css; each layer
 * appears at once, like Windows (no fade, no slide).
 *
 * Hardening:
 *   watchStep(step)         after config.stepWatchdogMs the splash names the step and
 *                           offers "Skip this step" (executeInitSteps races the step
 *                           against the skip promise)
 *   setConnectionState()    while booting, connection beats go into the splash instead
 *                           of the Connection Manager window, and the stage queue holds
 *   suspend() / resume()    server restarting or unreachable after boot: body.session-suspended
 *                           puts a solid-colour cover over every window, the taskbar,
 *                           icons, popovers and toasts while the logon dialog shows the
 *                           server's own boot progress, in Windows Classic like the first
 *                           logon; resume() once data is reloaded. Both ways go through a
 *                           black session-switch cut (#sessionSwitchOverlay); the lock and
 *                           the Aero swap happen under the black. While locked every
 *                           animation and render loop is paused (CSS + pause hooks), work
 *                           in progress keeps running.
 *
 *   isTaskbarVisible()      the taskbar is on screen: not the logon, not before the staged
 *                           taskbar reveal, not under a lock or the black switch. Tray
 *                           balloons go through this (#435): popoverManager.showPopover,
 *                           serviceWorkerManager._showServiceWorkerTrayPopup, the latency
 *                           warning. whenTaskbarVisible(key, fn) queues one per key (the
 *                           latest wins) and runs it once the taskbar is back.
 *
 * Test: scripts/test-desktop-boot.js. Yozora #401, #410, #412, #435.
 */
(function () {
    'use strict';

    // gadgets: the Vista Sidebar, drawn hidden and decoded at step 18.6 (Yozora #521)
    const STAGES = ['logon', 'session', 'settings', 'wallpaper', 'icons', 'taskbar', 'gadgets', 'windows', 'done'];
    const REVEAL_CLASS = {
        wallpaper: 'boot-reveal-wallpaper',
        icons: 'boot-reveal-icons',
        taskbar: 'boot-reveal-taskbar',
        gadgets: 'boot-reveal-gadgets',
        windows: 'boot-reveal-windows'
    };
    // Vista wording (Yukimi, 2026-10-12): one line, "Preparing your desktop..." for every
    // stage and "Welcome" at the end; the real init step goes to the console only
    const STAGE_TEXT = {
        session: 'Preparing your desktop...',
        settings: 'Preparing your desktop...',
        wallpaper: 'Preparing your desktop...',
        icons: 'Preparing your desktop...',
        taskbar: 'Preparing your desktop...',
        gadgets: 'Preparing your desktop...',
        windows: 'Preparing your desktop...',
        done: 'Welcome'
    };
    const BOOT_CLASSES = ['boot-staged', ...Object.values(REVEAL_CLASS)];
    const CLASSIC_THEME_CLASS = 'windows-classic-theme';
    // User Accounts "Use Vista Logon" (/status useVistaLogon): the Welcome screen, and the
    // boot windows in Windows Vista Basic instead of Classic
    const VISTA_LOGON_CLASS = 'vista-logon';
    const VISTA_BASIC_THEME_CLASS = 'vista-basic-theme';

    const config = {
        dwellMs: { session: 600, settings: 0, wallpaper: 700, icons: 450, taskbar: 450, gadgets: 300, windows: 500, done: 350 },
        stepWatchdogMs: 25000,
        connectionWaitText: 'Please wait...',
        connectionFailedText: 'The server is not responding…',
        suspendText: 'Restoring your session…',
        lockSwitchMs: 500,   // black hold after the fade, before the lock screen shows
        unlockSwitchMs: 1500, // black hold while the desktop comes back under it
        sessionFadeMs: 900   // fade to black, same pace as the winlogon power cover
    };

    const doc = typeof document !== 'undefined' ? document : null;
    const win = typeof window !== 'undefined' ? window : null;

    const state = {
        active: false,
        stage: null,          // last stage shown
        stageShownAt: 0,
        requested: null,      // highest stage requested so far
        queue: [],
        timer: null,
        advancing: false,
        connectionPaused: false,
        connectionText: '',
        finishResolvers: [],
        watchdog: null,
        watchdogStep: null,
        skipResolve: null,
        skipWired: false,
        suspended: false,
        suspendReason: null,
        lockTheme: null,            // theme class added by a lock (server restart or workstation)
        // server setting: app.html starts from the last /status answer, websocket.js _setVistaLogon follows /status
        vistaLogon: !!(doc && doc.body && doc.body.classList.contains(VISTA_LOGON_CLASS)),
        workstationLocked: false,   // manual lock (start menu Lock / Ctrl+Alt+L, workstationLock.js)
        pauseDepth: 0,              // both locks can be up; the pauses nest
        switchTimer: null,
        switchCoverTimer: null,
        pausedBy: [],         // resume functions from the pause hooks, run on unlock
        lastStepMessage: '',
        lastProgress: 0
    };

    function stageIndex(stage) {
        return STAGES.indexOf(stage);
    }

    function byId(id) {
        return doc ? doc.getElementById(id) : null;
    }

    function body() {
        return doc ? doc.body : null;
    }

    function isDesktop() {
        return !!(win && win.isDesktop);
    }

    function dispatch(name, detail) {
        if (!doc || typeof CustomEvent !== 'function') return;
        doc.dispatchEvent(new CustomEvent(name, { detail }));
    }

    // ---------- splash text ----------

    function setPrimaryText(text) {
        const el = byId('windowsStartupStatus');
        if (el && typeof text === 'string') el.textContent = text;
    }

    /** The real init step: kept on the (hidden, Vista has one line) detail element and the console. */
    function setDetailText(text) {
        const el = byId('windowsStartupDetail');
        if (el) el.textContent = text || '';
        if (text && typeof console !== 'undefined' && console.debug) console.debug(`[boot] ${text}`);
    }

    function setProgress(progress) {
        const bar = byId('windowsStartupProgressBar');
        if (bar && typeof progress === 'number' && Number.isFinite(progress)) {
            bar.style.width = `${Math.min(100, Math.max(0, progress))}%`;
        }
    }

    function refreshPrimaryText() {
        if (state.connectionPaused) {
            setPrimaryText(state.connectionText || config.connectionWaitText);
            return;
        }
        if (state.watchdogStep) {
            setPrimaryText(`Still working on: ${state.watchdogStep.message || 'this step'}`);
            return;
        }
        setPrimaryText(STAGE_TEXT[state.stage] || STAGE_TEXT.session);
    }

    /** Real init-step message and progress go to the small detail line (executeInitSteps). */
    function onStepMessage(message, progress) {
        state.lastStepMessage = message || '';
        if (typeof progress === 'number') state.lastProgress = progress;
        setDetailText(state.lastStepMessage);
        setProgress(progress);
        if (!state.active) {
            // Not staged (e.g. non-desktop or a reconnect after boot): behave like before
            setPrimaryText(message);
        }
    }

    // ---------- stage queue ----------

    function applyStageClasses(stage) {
        const b = body();
        if (!b) return;
        b.dataset.bootStage = stage;
        const reveal = REVEAL_CLASS[stage];
        if (reveal) b.classList.add(reveal);
        if (stage === 'windows') {
            // Window open animations may run from here on
            b.classList.remove('no-animation');
        }
    }

    function scheduleAdvance(delay) {
        clearTimeout(state.timer);
        state.timer = setTimeout(() => {
            state.timer = null;
            advance();
        }, Math.max(0, delay));
    }

    function advance() {
        if (!state.active || state.connectionPaused || state.timer) return;
        // The stage on screen keeps its minimum dwell even when the next request arrives late
        if (state.stage) {
            const dwell = config.dwellMs[state.stage] || 0;
            const elapsed = Date.now() - state.stageShownAt;
            if (elapsed < dwell) {
                scheduleAdvance(dwell - elapsed);
                return;
            }
        }
        const next = state.queue.shift();
        if (!next) {
            if (state.stage === 'done') settleFinish();
            return;
        }
        state.stage = next;
        state.stageShownAt = Date.now();
        applyStageClasses(next);
        refreshPrimaryText();
        dispatch('desktopBootStage', { stage: next });
        if (state.queue.length || next === 'done') {
            scheduleAdvance(config.dwellMs[next] || 0);
        }
    }

    /** Ask for a stage; every stage between the current request and it is shown in order. */
    function requestStage(stage) {
        const target = stageIndex(stage);
        if (target < 0) return false;
        if (!state.active) {
            if (stage === 'logon') return false;
            return false;
        }
        const from = stageIndex(state.requested);
        if (target <= from) return false;
        for (let i = from + 1; i <= target; i++) {
            state.queue.push(STAGES[i]);
        }
        state.requested = stage;
        if (!state.timer) advance();
        return true;
    }

    function begin() {
        if (!doc || !isDesktop()) return false;
        if (state.active) return true;
        state.active = true;
        state.stage = null;
        state.requested = 'logon';
        state.queue = [];
        state.connectionPaused = false;
        const b = body();
        if (b) {
            b.classList.add('boot-staged');
            b.classList.remove('boot-from-launch'); // solid colour from here, not the launch black
        }
        requestStage('session');
        dispatch('desktopBootBegin', {});
        return true;
    }

    function settleFinish() {
        const resolvers = state.finishResolvers.splice(0);
        state.active = false;
        clearWatchdog();
        const b = body();
        if (b) {
            BOOT_CLASSES.forEach((cls) => b.classList.remove(cls));
            delete b.dataset.bootStage;
        }
        dispatch('desktopBootDone', {});
        resolvers.forEach((fn) => fn());
    }

    /**
     * Resolves once the reveal has shown every stage up to done (splash closes after this).
     * options.timeoutMs caps the wait so a held queue (connection lost at the very end)
     * can never keep the startup window on screen.
     */
    function finish(options = {}) {
        if (!state.active) return Promise.resolve();
        return new Promise((resolve) => {
            state.finishResolvers.push(resolve);
            if (options.timeoutMs > 0) {
                setTimeout(() => {
                    if (state.active) settleFinish();
                }, options.timeoutMs);
            }
            requestStage('done');
            if (state.stage === 'done' && !state.queue.length && !state.timer) settleFinish();
        });
    }

    function reset() {
        clearTimeout(state.timer);
        state.timer = null;
        state.queue = [];
        state.finishResolvers.splice(0).forEach((fn) => fn());
        state.active = false;
        state.stage = null;
        state.requested = null;
        state.connectionPaused = false;
        clearWatchdog();
        const b = body();
        if (b) {
            BOOT_CLASSES.forEach((cls) => b.classList.remove(cls));
            delete b.dataset.bootStage;
        }
    }

    function isBooting() {
        return state.active;
    }

    // ---------- init step mapping ----------

    function onInitStep(step) {
        if (!step) return;
        if (state.active) {
            // Wallpaper, icons and the taskbar wait until their preload steps finish
            // (onStepDone). Revealing them from the priority alone painted empty art.
            if (step.priority >= 31) requestStage('windows');
            else if (step.priority < 12.2) requestStage('settings');
        }
        setDetailText(step.message || '');
    }

    function onStepDone(step) {
        if (!step || !state.active) return;
        // These three messages are the startup-bar preload stages (assetPreload.js).
        if (step.message === 'Loading wallpaper') requestStage('wallpaper');
        else if (step.message === 'Loading desktop icons') requestStage('icons');
        else if (step.message === 'Loading desktop assets') requestStage('taskbar');
        else if (step.message === 'Loading gadgets') requestStage('gadgets');
    }

    // ---------- watchdog ----------

    function wireSkipButton() {
        if (state.skipWired) return;
        const btn = byId('windowsStartupSkipStepBtn');
        if (!btn) return;
        btn.addEventListener('click', () => {
            if (state.skipResolve) {
                const resolve = state.skipResolve;
                state.skipResolve = null;
                resolve({ skipped: true });
            }
        });
        state.skipWired = true;
    }

    function showSkipButton(show) {
        const btn = byId('windowsStartupSkipStepBtn');
        if (btn) btn.classList.toggle('hidden', !show);
    }

    function clearWatchdog() {
        clearTimeout(state.watchdog);
        state.watchdog = null;
        state.watchdogStep = null;
        state.skipResolve = null;
        showSkipButton(false);
    }

    /**
     * Arm the watchdog for one init step. Returns { promise, clear }: the promise resolves
     * only if the user chooses to skip; clear() is called when the step settles.
     */
    function watchStep(step) {
        clearWatchdog();
        wireSkipButton();
        const promise = new Promise((resolve) => {
            state.skipResolve = resolve;
        });
        state.watchdog = setTimeout(() => {
            state.watchdog = null;
            state.watchdogStep = step || { message: 'this step' };
            refreshPrimaryText();
            showSkipButton(true);
            if (typeof console !== 'undefined' && console.warn) {
                console.warn(`⏱️ Init step still running after ${config.stepWatchdogMs}ms: ${step && step.message}`);
            }
            dispatch('desktopBootStepStalled', { step: step && step.message });
        }, config.stepWatchdogMs);
        return {
            promise,
            clear: () => {
                if (state.watchdogStep === step || !state.watchdogStep) {
                    clearWatchdog();
                    refreshPrimaryText();
                }
            }
        };
    }

    // ---------- connection during boot ----------

    /** websocket.js _renderConnectionDial routes beats here while the splash owns the screen. */
    function setConnectionState(phase, message) {
        const waiting = phase === 'dialing' || phase === 'failed' || phase === 'auth';
        if (waiting) {
            state.connectionPaused = true;
            // A dial beat is just a wait ("Please wait..."); a failure or the password prompt
            // keeps its own text
            state.connectionText = phase === 'failed'
                ? (message || config.connectionFailedText)
                : (phase === 'auth' ? (message || config.connectionWaitText) : config.connectionWaitText);
            clearTimeout(state.timer);
            state.timer = null;
            refreshPrimaryText();
            return;
        }
        if (!state.connectionPaused) return;
        state.connectionPaused = false;
        state.connectionText = '';
        refreshPrimaryText();
        if (state.active) advance();
    }

    // ---------- session switch: fade to black, change the lock under it, fade back ----------

    function switchOverlay() {
        let el = byId('sessionSwitchOverlay');
        if (!el && doc && typeof doc.createElement === 'function' && doc.body) {
            el = doc.createElement('div');
            el.id = 'sessionSwitchOverlay';
            el.setAttribute('aria-hidden', 'true');
            doc.body.appendChild(el);
        }
        return el;
    }

    /**
     * Fade the black cover in, run onCovered once it is opaque, hold, then fade it out.
     * coverLogon keeps the Welcome screen hidden until the fade out, so it does not pop
     * over the desktop while the cover is still rising.
     */
    function beginSessionFade(holdMs, onCovered, coverLogon) {
        const el = switchOverlay();
        const b = body();
        clearTimeout(state.switchTimer);
        clearTimeout(state.switchCoverTimer);
        state.switchTimer = null;
        state.switchCoverTimer = null;
        if (!el) {
            if (onCovered) onCovered();
            return;
        }
        if (b) b.classList.toggle('session-switch-cover', !!coverLogon);
        void el.offsetWidth;
        el.classList.add('active');
        const armHold = () => {
            state.switchCoverTimer = null;
            if (onCovered) onCovered();
            const lift = () => {
                state.switchTimer = null;
                if (b) b.classList.remove('session-switch-cover');
                el.classList.remove('active');
                dispatch('desktopSessionSwitchDone', { locked: state.suspended || state.workstationLocked });
            };
            if (holdMs <= 0) lift();
            else state.switchTimer = setTimeout(lift, holdMs);
        };
        const fade = Math.max(0, config.sessionFadeMs);
        if (fade <= 0) armHold();
        else state.switchCoverTimer = setTimeout(armHold, fade);
    }

    function isSwitching() {
        return !!(state.switchTimer || state.switchCoverTimer);
    }

    // ---------- pause while locked ----------
    // CSS animations pause through body.session-suspended (desktop-boot.css). Hooks cover
    // JS-driven motion; each pause() returns its own resume function (or nothing). Only
    // rendering stops: timers, alarms, network and generation keep running.

    const pauseHooks = [
        function pauseVideos() {
            if (!doc || typeof doc.querySelectorAll !== 'function') return null;
            const playing = Array.from(doc.querySelectorAll('video')).filter((v) => !v.paused
                && !(typeof v.closest === 'function' && v.closest('.boot-dialog')));
            playing.forEach((v) => v.pause());
            if (!playing.length) return null;
            return () => playing.forEach((v) => {
                if (v.isConnected === false || !v.paused) return;
                const p = v.play();
                if (p && typeof p.catch === 'function') p.catch(() => {});
            });
        },
        function pausePlanetSwitcher() {
            const ps = win && win.planetSwitcher;
            if (!ps || !ps.raf || typeof ps.stopLoop !== 'function') return null;
            ps.stopLoop();
            return () => {
                if (ps.state !== 'idle' && !ps.raf && typeof ps.startLoop === 'function') ps.startLoop();
            };
        }
    ];

    /** Features add { pause() → resume fn | void } to stop their own render loops while locked. */
    function registerPauseHook(hook) {
        if (typeof hook === 'function') pauseHooks.push(hook);
        else if (hook && typeof hook.pause === 'function') {
            pauseHooks.push(() => {
                const r = hook.pause();
                if (typeof r === 'function') return r;
                return typeof hook.resume === 'function' ? () => hook.resume() : null;
            });
        }
    }

    function pauseSession() {
        state.pauseDepth += 1;
        if (state.pauseDepth > 1) return; // already paused by the other lock
        state.pausedBy = [];
        pauseHooks.forEach((hook) => {
            try {
                const undo = hook();
                if (typeof undo === 'function') state.pausedBy.push(undo);
            } catch (err) {
                if (typeof console !== 'undefined' && console.warn) console.warn('Session pause hook failed:', err);
            }
        });
    }

    function resumeSession() {
        if (state.pauseDepth === 0) return;
        state.pauseDepth -= 1;
        if (state.pauseDepth > 0) return; // the other lock is still up
        state.pausedBy.splice(0).forEach((undo) => {
            try { undo(); } catch (err) {
                if (typeof console !== 'undefined' && console.warn) console.warn('Session resume hook failed:', err);
            }
        });
    }

    // ---------- shared lock plumbing ----------

    /** Theme of the boot windows: Vista Basic with Use Vista Logon, Windows Classic otherwise. */
    function bootThemeClass() {
        return state.vistaLogon ? VISTA_BASIC_THEME_CLASS : CLASSIC_THEME_CLASS;
    }

    /**
     * A lock layer takes the first logon's theme while either lock is up (Vista Basic with Use
     * Vista Logon, Windows Classic otherwise): the restart lock is the logon again, the
     * workstation lock is Vista's locked Welcome screen or Classic's Computer Locked
     * (workstationLock.js). Every other layer sits hidden, so the theme only shows on the lock
     * dialogs; it comes off with the last lock unless it was already on before.
     */
    function applyLockTheme() {
        const b = body();
        if (!b) return;
        const want = (state.suspended || state.workstationLocked) ? bootThemeClass() : null;
        if (state.lockTheme && state.lockTheme !== want) {
            b.classList.remove(state.lockTheme);
            state.lockTheme = null;
        }
        if (want && !b.classList.contains(want)) {
            b.classList.add(want);
            state.lockTheme = want;
        }
    }

    /**
     * Server setting from /status. body.vista-logon switches the logon dialog to the Welcome
     * screen; the boot theme on screen (app.html inline Classic, or a restart lock's) swaps
     * with it. workspaceUtils.js drops the first logon's boot theme once the desktop loads.
     */
    function setLogonTheme(on) {
        state.vistaLogon = !!on;
        const b = body();
        if (!b) return;
        b.classList.toggle(VISTA_LOGON_CLASS, state.vistaLogon);
        if (state.suspended) {
            applyLockTheme();
            return;
        }
        if (!b.classList.contains('windows-startup')) return;
        const from = state.vistaLogon ? CLASSIC_THEME_CLASS : VISTA_BASIC_THEME_CLASS;
        if (b.classList.contains(from)) {
            b.classList.remove(from);
            b.classList.add(bootThemeClass());
        }
    }

    function isVistaLogon() {
        return state.vistaLogon;
    }

    function closeTransientSurfaces() {
        try {
            const startMenu = byId('startMenu');
            if (startMenu && !startMenu.classList.contains('hidden') && typeof win.closeStartMenu === 'function') {
                win.closeStartMenu();
            }
        } catch (_) { /* best effort */ }
        // Tray flyouts would come back after the unlock (melatonControlPanel.js, walletTray.js)
        try {
            if (win.melatonControlPanel && typeof win.melatonControlPanel.hideTrayFlyout === 'function') {
                win.melatonControlPanel.hideTrayFlyout();
            }
            if (win.walletTray && typeof win.walletTray.hideFlyout === 'function') win.walletTray.hideFlyout();
        } catch (_) { /* best effort */ }
    }

    // ---------- taskbar visibility gate for tray balloons (#435) ----------

    /**
     * True when the taskbar is on screen: not the logon screen (#desktopTaskbar still hidden),
     * not before the staged taskbar reveal, not under the restart lock, the workstation lock or
     * the black session switch. Outside desktop mode there is no taskbar to anchor to: true.
     */
    function isTaskbarVisible() {
        if (!doc || !isDesktop()) return true;
        const taskbar = byId('desktopTaskbar');
        const body = doc.body;
        if (!taskbar || taskbar.classList.contains('hidden')) return false;
        if (body.classList.contains('boot-staged') && !body.classList.contains(REVEAL_CLASS.taskbar)) return false;
        if (body.classList.contains('session-suspended') || body.classList.contains('workstation-locked')) return false;
        if (isSwitching()) return false;
        return true;
    }

    const taskbarQueue = new Map();
    let taskbarWatch = null;

    function flushTaskbarQueue() {
        if (!taskbarQueue.size || !isTaskbarVisible()) return;
        const pending = [...taskbarQueue.values()];
        taskbarQueue.clear();
        stopTaskbarWatch();
        pending.forEach((fn) => {
            try {
                fn();
            } catch (error) {
                console.warn('[boot] deferred tray notice failed:', error);
            }
        });
    }

    function startTaskbarWatch() {
        if (taskbarWatch || !doc || typeof MutationObserver === 'undefined') return;
        // Class changes on body / the taskbar cover every way it comes back (staged reveal,
        // resume, unlock, the hideWindowsStartupModal fallback that skips desktopBootDone)
        taskbarWatch = new MutationObserver(() => {
            // after the switch-overlay classes settle in the same frame
            setTimeout(flushTaskbarQueue, 0);
        });
        taskbarWatch.observe(doc.body, { attributes: true, attributeFilter: ['class'] });
        const taskbar = byId('desktopTaskbar');
        if (taskbar) taskbarWatch.observe(taskbar, { attributes: true, attributeFilter: ['class'] });
    }

    function stopTaskbarWatch() {
        if (taskbarWatch) taskbarWatch.disconnect();
        taskbarWatch = null;
    }

    /**
     * Run fn now if the taskbar is visible, otherwise once it is. One entry per key: a newer
     * notice of the same kind replaces the queued one. Returns true when it ran now.
     */
    function whenTaskbarVisible(key, fn) {
        if (typeof fn !== 'function') return false;
        if (isTaskbarVisible()) {
            fn();
            return true;
        }
        taskbarQueue.delete(key);
        taskbarQueue.set(key, fn);
        startTaskbarWatch();
        return false;
    }

    function dropTaskbarQueued(key) {
        taskbarQueue.delete(key);
        if (!taskbarQueue.size) stopTaskbarWatch();
    }

    // ---------- session lock (server restart after boot) ----------

    function suspend(reason) {
        if (!doc || !isDesktop() || state.active) return false;
        if (state.suspended) return true;
        state.suspended = true;
        state.suspendReason = reason || 'server-restart';
        closeTransientSurfaces();
        pauseSession();
        // Desktop stays up under the rising cover; the lock screen is built once it is opaque
        beginSessionFade(config.lockSwitchMs, () => {
            const b = body();
            if (b) b.classList.add('session-suspended');
            applyLockTheme();
            dispatch('desktopSessionSuspended', { reason: state.suspendReason });
        }, true);
        return true;
    }

    function resume() {
        if (!state.suspended) return false;
        state.suspended = false;
        const reason = state.suspendReason;
        state.suspendReason = null;
        resumeSession();
        beginSessionFade(config.unlockSwitchMs, () => {
            const b = body();
            if (b) b.classList.remove('session-suspended');
            applyLockTheme();
            dispatch('desktopSessionResumed', { reason });
        }, false);
        return true;
    }

    function isSuspended() {
        return state.suspended;
    }

    // ---------- workstation lock (start menu Lock / Ctrl+Alt+L, Yozora #423) ----------
    // body.workstation-locked: the wallpaper stays, everything else hides and pauses under a
    // wallpaper cover; workstationLock.js shows Computer Locked / Unlock Computer on top. The
    // server-restart lock (teal) takes precedence while both are up.

    function lockWorkstation() {
        if (!doc || !isDesktop() || state.active || state.workstationLocked) return false;
        state.workstationLocked = true;
        closeTransientSurfaces();
        pauseSession();
        beginSessionFade(config.lockSwitchMs, () => {
            const b = body();
            if (b) b.classList.add('workstation-locked');
            applyLockTheme();
            dispatch('desktopWorkstationLocked', {});
        }, true);
        return true;
    }

    function unlockWorkstation() {
        if (!state.workstationLocked) return false;
        state.workstationLocked = false;
        resumeSession();
        beginSessionFade(config.unlockSwitchMs, () => {
            const b = body();
            if (b) b.classList.remove('workstation-locked');
            applyLockTheme();
            dispatch('desktopWorkstationUnlocked', {});
        }, false);
        return true;
    }

    function isWorkstationLocked() {
        return state.workstationLocked;
    }

    const api = {
        STAGES,
        STAGE_TEXT,
        config,
        begin,
        requestStage,
        finish,
        reset,
        isBooting,
        onInitStep,
        onStepDone,
        onStepMessage,
        refresh: refreshPrimaryText,
        watchStep,
        setConnectionState,
        suspend,
        resume,
        isSuspended,
        isSwitching,
        registerPauseHook,
        lockWorkstation,
        unlockWorkstation,
        isWorkstationLocked,
        setLogonTheme,
        isVistaLogon,
        isTaskbarVisible,
        whenTaskbarVisible,
        dropTaskbarQueued,
        _test: { state, stageIndex, REVEAL_CLASS, BOOT_CLASSES, taskbarQueue, flushTaskbarQueue }
    };

    if (win) win.desktopBoot = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
