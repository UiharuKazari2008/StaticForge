/**
 * Desktop boot stages — the XP-style staged reveal, the top-left startup window's
 * text, per-step watchdogs, and the server-restart session lock.
 *
 * Reveal order after the logon dialog closes (websocket.js _completePreStartupHandoff):
 *   session  → solid colour only (body.windows-startup teal), splash opens
 *   settings → "Loading your personal settings…" (init steps < 12)
 *   wallpaper→ "Applying your personal settings…" (after step 12 Loading Workspaces)
 *   icons    → "Preparing your desktop…"
 *   taskbar  → taskbar appears (after step 16 Starting Taskbar)
 *   windows  → "Restoring your windows…" (step 31 Loading Gallery)
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
 * Test: scripts/test-desktop-boot.js. Yozora #401, #410, #412.
 */
(function () {
    'use strict';

    const STAGES = ['logon', 'session', 'settings', 'wallpaper', 'icons', 'taskbar', 'windows', 'done'];
    const REVEAL_CLASS = {
        wallpaper: 'boot-reveal-wallpaper',
        icons: 'boot-reveal-icons',
        taskbar: 'boot-reveal-taskbar',
        windows: 'boot-reveal-windows'
    };
    const STAGE_TEXT = {
        session: 'Loading your personal settings…',
        settings: 'Loading your personal settings…',
        wallpaper: 'Applying your personal settings…',
        icons: 'Preparing your desktop…',
        taskbar: 'Preparing your desktop…',
        windows: 'Restoring your windows…',
        done: 'Welcome'
    };
    const BOOT_CLASSES = ['boot-staged', ...Object.values(REVEAL_CLASS)];
    const CLASSIC_THEME_CLASS = 'windows-classic-theme';

    const config = {
        dwellMs: { session: 600, settings: 0, wallpaper: 700, icons: 450, taskbar: 450, windows: 500, done: 350 },
        stepWatchdogMs: 25000,
        connectionWaitText: 'Waiting for the server…',
        connectionFailedText: 'The server is not responding…',
        suspendText: 'Restoring your session…',
        lockSwitchMs: 500,   // black cut before the lock screen shows
        unlockSwitchMs: 1500 // black while the desktop comes back under it
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
        suspendAddedClassic: false,
        switchTimer: null,
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

    function setDetailText(text) {
        const el = byId('windowsStartupDetail');
        if (el) el.textContent = text || '';
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
            if (step.priority >= 31) requestStage('windows');
            else if (step.priority >= 16) requestStage('taskbar');
            else if (step.priority > 12) requestStage('icons');
            else requestStage('settings');
        }
        setDetailText(step.message || '');
    }

    function onStepDone(step) {
        if (!step || !state.active) return;
        if (step.priority === 12) {
            requestStage('icons'); // wallpaper is queued first by the stage order
        } else if (step.priority === 16) {
            requestStage('taskbar');
        }
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
            state.connectionText = phase === 'failed'
                ? (message || config.connectionFailedText)
                : (message || config.connectionWaitText);
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

    // ---------- session switch: one black cut over everything ----------

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

    /** Black at once, lifted (no fade) after ms; a newer cut replaces the pending lift. */
    function cutToBlack(ms) {
        const el = switchOverlay();
        clearTimeout(state.switchTimer);
        state.switchTimer = null;
        if (!el) return;
        el.classList.add('active');
        state.switchTimer = setTimeout(() => {
            state.switchTimer = null;
            el.classList.remove('active');
            dispatch('desktopSessionSwitchDone', { locked: state.suspended });
        }, Math.max(0, ms));
    }

    function isSwitching() {
        return !!state.switchTimer;
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
        state.pausedBy.splice(0).forEach((undo) => {
            try { undo(); } catch (err) {
                if (typeof console !== 'undefined' && console.warn) console.warn('Session resume hook failed:', err);
            }
        });
    }

    // ---------- session lock (server restart after boot) ----------

    function suspend(reason) {
        if (!doc || !isDesktop() || state.active) return false;
        if (state.suspended) return true;
        state.suspended = true;
        state.suspendReason = reason || 'server-restart';
        // Session switch: black first, the lock screen is built under it
        cutToBlack(config.lockSwitchMs);
        const b = body();
        if (b) {
            // The lock layer is the first logon again: Windows Classic. Everything else sits
            // under the cover, so the theme only shows on that layer; resume() takes it off
            // unless it was already on.
            state.suspendAddedClassic = !b.classList.contains(CLASSIC_THEME_CLASS);
            if (state.suspendAddedClassic) b.classList.add(CLASSIC_THEME_CLASS);
            b.classList.add('session-suspended');
        }
        // Close transient surfaces so nothing pops back over the lock screen
        try {
            const startMenu = byId('startMenu');
            if (startMenu && !startMenu.classList.contains('hidden') && typeof win.closeStartMenu === 'function') {
                win.closeStartMenu();
            }
        } catch (_) { /* best effort */ }
        pauseSession();
        dispatch('desktopSessionSuspended', { reason: state.suspendReason });
        return true;
    }

    function resume() {
        if (!state.suspended) return false;
        state.suspended = false;
        const reason = state.suspendReason;
        state.suspendReason = null;
        // Session switch back: black for unlockSwitchMs; the cover, Classic → Aero and the
        // resumed loops all settle under it, then the desktop cuts in
        cutToBlack(config.unlockSwitchMs);
        const b = body();
        if (b) {
            b.classList.remove('session-suspended');
            if (state.suspendAddedClassic) b.classList.remove(CLASSIC_THEME_CLASS);
        }
        state.suspendAddedClassic = false;
        resumeSession();
        dispatch('desktopSessionResumed', { reason });
        return true;
    }

    function isSuspended() {
        return state.suspended;
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
        _test: { state, stageIndex, REVEAL_CLASS, BOOT_CLASSES }
    };

    if (win) win.desktopBoot = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
