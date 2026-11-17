/**
 * Vista desktop sound scheme. Plays WAVs from /sounds/vista/
 * (public/sounds/vista, the allowlisted WAVs are committed). On by default; Personalize → Sounds
 * stores localStorage `desktop-sounds` (`off` to mute). Desktop only.
 *
 * Events: error, warning, dialog, logon, lock, unlock, shutdown, navigate,
 * planet-enter, planet-activate, planet-switch, print-complete, print-error,
 * balloon (off for tray popovers and glass toasts; playBalloon stays for an
 * explicit caller), dialog only when a confirmation/input pass config.sound,
 * (dead-key Ding is off), notify
 * (new Dovecote mail, unless Control Panel Mail turns that sound off), recycle (image delete / scrap),
 * critical-stop (exception window / hard WS drop), uac (Client Update).
 * No min/max, no ambient.
 *
 * Each workspace can give an event its own sound or (None), or pick No Sounds, in Personalize >
 * Sounds (desktopPersonalization.js soundFile; the Sound dialog, personalizationDialogs.js).
 * The startup sound (the logon sound when the desktop comes up) has its own check box there.
 *
 * Test: scripts/test-desktop-sounds.js. Yozora #436, #437.
 */
(function () {
    'use strict';
    const appScopeSignal = (typeof window !== 'undefined' && window.melatonSegments && typeof window.melatonSegments.callerSignal === 'function' && window.melatonSegments.callerSignal()) || undefined; // page listeners end with this file's segment (app-scope, #872/#890)

    const STORAGE_KEY = 'desktop-sounds';
    const BASE = '/sounds/vista/';
    const SHUTDOWN_WAIT_MAX_MS = 4000;

    const SCHEME = {
        error: 'Windows Error.wav',
        warning: 'Windows Exclamation.wav',
        dialog: 'Windows Ding.wav',
        logon: 'Windows Logon Sound.wav',
        lock: 'Windows Logoff Sound.wav',
        unlock: 'Windows Logon Sound.wav',
        shutdown: 'Windows Shutdown.wav',
        navigate: 'Windows Navigation Start.wav',
        'planet-enter': 'Windows Logoff Sound.wav',
        'planet-activate': 'Windows Navigation Start.wav',
        'planet-switch': 'Windows Logon Sound.wav',
        'print-complete': 'Windows Print complete.wav',
        'print-error': 'Windows Hardware Fail.wav',
        balloon: 'Windows Balloon.wav',
        default: 'Windows Ding.wav',
        notify: 'Windows Notify.wav',
        recycle: 'Windows Recycle.wav',
        'critical-stop': 'Windows Critical Stop.wav',
        uac: 'Windows User Account Control.wav',
        // Melaton Messenger: a new instant message (its program group in the Sound dialog, #779)
        'im-message': 'Messenger New Instant Message.wav'
    };

    // the WAVs the server hands out (modules/desktopSoundsStatic.js ALLOWED_FILES): the Sounds list
    const FILES = [
        'Windows Balloon.wav',
        'Windows Critical Stop.wav',
        'Windows Default.wav',
        'Windows Ding.wav',
        'Windows Error.wav',
        'Windows Exclamation.wav',
        'Windows Hardware Fail.wav',
        'Windows Logoff Sound.wav',
        'Windows Logon Sound.wav',
        'Windows Navigation Start.wav',
        'Windows Notify.wav',
        'Windows Print complete.wav',
        'Windows Recycle.wav',
        'Windows Shutdown.wav',
        'Windows User Account Control.wav',
        'Messenger New Instant Message.wav'
    ];

    const PRINT_REQUEST_TYPES = [
        'generate_image',
        'generate_preset',
        'reroll_image',
        'expand_image',
        'reroll_expanded_image',
        'upscale_image',
        'enhance_image',
        'max_enhance_image',
        'animate_image'
    ];

    const BOOT_ICON_EVENT = {
        error: 'error',
        warning: 'warning',
        info: 'dialog'
    };

    const BALLOON_OWNED_TITLES = {
        'Generation Complete': true,
        'Generation Failed': true,
        'Generation Receipt': true,
        'Upscaling Receipt': true
    };

    const doc = typeof document !== 'undefined' ? document : null;
    const win = typeof window !== 'undefined' ? window : null;

    const state = {
        enabled: true,
        ctx: null,
        unlocked: false,
        gestureUnlocked: false,
        playing: 0,
        idleTimer: null,
        buffers: Object.create(null),
        inflight: Object.create(null),
        // WAV bytes fetched ahead (prefetch before there is a context): decoded once one is made
        fetched: Object.create(null),
        bound: false
    };

    // A running AudioContext keeps the audio device open and its render thread going while it plays
    // nothing (on a phone the audio output stays awake, #890). It is made on the first sound (or the
    // first input once sounds are on, which lets later sounds start without one), and suspended
    // IDLE_SUSPEND_MS after the last sound ends and when the page is hidden; the next sound resumes it.
    // The boot's prefetch only fetches the WAVs; they are decoded in the context once it exists (in
    // that context, so each is resampled once, to the output's rate, as before).
    const IDLE_SUSPEND_MS = 5000;

    function suspendIfIdle() {
        const ctx = state.ctx;
        if (!ctx || state.playing > 0 || ctx.state !== 'running' || typeof ctx.suspend !== 'function') return;
        ctx.suspend().catch(() => {});
    }

    function scheduleIdleSuspend() {
        if (state.idleTimer) clearTimeout(state.idleTimer);
        state.idleTimer = setTimeout(() => {
            state.idleTimer = null;
            suspendIfIdle();
        }, IDLE_SUSPEND_MS);
    }

    function normalizeEvent(eventId) {
        return Object.prototype.hasOwnProperty.call(SCHEME, eventId) ? eventId : null;
    }

    function eventFile(eventId) {
        const id = normalizeEvent(eventId);
        return id ? SCHEME[id] : null;
    }

    function soundUrl(eventId) {
        const file = eventFile(eventId);
        return file ? BASE + encodeURIComponent(file) : null;
    }

    /** The file an event plays in this workspace: its own pick, '' for none, else the scheme's. */
    function resolveFile(eventId, startup) {
        const id = normalizeEvent(eventId);
        if (!id) return null;
        const pers = win && win.desktopPersonalization;
        if (pers && typeof pers.soundFile === 'function') {
            if (startup && pers.soundFile('logon-startup') === '') return '';
            const own = pers.soundFile(id);
            if (own === '') return '';
            if (typeof own === 'string' && FILES.indexOf(own) !== -1) return own;
        }
        return SCHEME[id];
    }

    function readEnabled(storage) {
        try {
            const store = storage || (win && win.localStorage);
            if (!store) return true;
            return store.getItem(STORAGE_KEY) !== 'off';
        } catch (_err) {
            return true;
        }
    }

    function writeEnabled(on, storage) {
        try {
            const store = storage || (win && win.localStorage);
            if (!store) return;
            store.setItem(STORAGE_KEY, on ? 'on' : 'off');
        } catch (_err) { /* quota / private mode */ }
    }

    function isDesktopNow() {
        if (win && win.isDesktop) return true;
        return !!(doc && doc.body && doc.body.classList.contains('desktop-mode'));
    }

    function isEnabled() {
        return state.enabled === true;
    }

    function setEnabled(on) {
        state.enabled = on !== false;
        writeEnabled(state.enabled);
        if (state.enabled) {
            unlock();
            play('dialog');
        } else if (win && win.planetSwitcher) {
            // planetSwitcher.stopBgm: public/scripts/comp/planetSwitcher.js
            win.planetSwitcher.stopBgm(true);
        }
        return state.enabled;
    }

    function getContext() {
        if (state.ctx) return state.ctx;
        const Ctor = win && (win.AudioContext || win.webkitAudioContext);
        if (!Ctor) return null;
        state.ctx = new Ctor();
        // made for a sound (or the first input): let go of the device if nothing plays
        scheduleIdleSuspend();
        return state.ctx;
    }

    function unlock() {
        const ctx = getContext();
        if (!ctx) return;
        if (ctx.state === 'suspended' && ctx.resume) {
            ctx.resume().catch(() => {});
        }
        state.unlocked = true;
        if (state.playing === 0) scheduleIdleSuspend();
        prefetch();
    }

    /**
     * The first click or key with sounds on (desktop) starts the context inside a user gesture, so the
     * sounds after it may start without one (an app WebView that asks for a gesture once). Later input
     * only resumes a context a sound is waiting on (one started before any gesture); sounds off, or
     * Melaton Mobile, input does nothing here.
     */
    function onGesture() {
        if (!state.enabled || !isDesktopNow()) return;
        if (!state.gestureUnlocked) {
            state.gestureUnlocked = true;
            unlock();
            return;
        }
        const ctx = state.ctx;
        if (ctx && state.playing > 0 && ctx.state === 'suspended' && ctx.resume) ctx.resume().catch(() => {});
    }

    /** A WAV's bytes (one fetch per file until it is decoded or the fetch fails). */
    function fetchBytes(file) {
        const id = file;
        if (state.fetched[id]) return state.fetched[id];
        if (!win || !win.fetch) return Promise.resolve(null);
        state.fetched[id] = win.fetch(BASE + encodeURIComponent(file), { credentials: 'same-origin' })
            .then((res) => {
                if (!res.ok) throw new Error('sound ' + res.status);
                return res.arrayBuffer();
            })
            .catch(() => {
                delete state.fetched[id];
                return null;
            });
        return state.fetched[id];
    }

    /**
     * Decoded audio by file name (several events share one WAV). ahead (the prefetch): with no context
     * yet, only the bytes are fetched and null comes back; no AudioContext is made for it.
     */
    function loadBuffer(file, ahead) {
        if (!file || FILES.indexOf(file) === -1) return Promise.resolve(null);
        const id = file;
        if (state.buffers[id]) return Promise.resolve(state.buffers[id]);
        if (state.inflight[id]) return state.inflight[id];
        if (ahead && !state.ctx) {
            fetchBytes(file);
            return Promise.resolve(null);
        }
        const ctx = getContext();
        if (!ctx || !win || !win.fetch) return Promise.resolve(null);
        state.inflight[id] = fetchBytes(file)
            .then((bytes) => {
                if (!bytes) throw new Error('sound not loaded');
                return ctx.decodeAudioData(bytes.slice(0));
            })
            .then((buffer) => {
                state.buffers[id] = buffer;
                delete state.inflight[id];
                delete state.fetched[id];
                return buffer;
            })
            .catch(() => {
                delete state.inflight[id];
                delete state.fetched[id];
                return null;
            });
        return state.inflight[id];
    }

    function prefetch() {
        if (!state.enabled || !isDesktopNow()) return;
        Object.keys(SCHEME).forEach((id) => {
            const file = resolveFile(id);
            if (file) loadBuffer(file, true);
        });
    }

    /** Every sound passes one analyser on its way out: the Sound dialog's Playback level meter. */
    function outputNode(ctx) {
        if (!state.analyser && ctx.createAnalyser) {
            state.analyser = ctx.createAnalyser();
            state.analyser.fftSize = 512;
            state.analyser.connect(ctx.destination);
        }
        return state.analyser || ctx.destination;
    }

    /** The output's level now, 0-1 (peak of the last few ms; 0 before anything has played). */
    function outputLevel() {
        const a = state.analyser;
        if (!a) return 0;
        if (!state.levelBuf) state.levelBuf = new Uint8Array(a.fftSize);
        a.getByteTimeDomainData(state.levelBuf);
        let peak = 0;
        for (let i = 0; i < state.levelBuf.length; i++) peak = Math.max(peak, Math.abs(state.levelBuf[i] - 128));
        return Math.min(1, peak / 128);
    }

    function playBuffer(buffer) {
        const ctx = getContext();
        if (!ctx || !buffer) return Promise.resolve(false);
        const source = ctx.createBufferSource();
        const gain = ctx.createGain ? ctx.createGain() : null;
        source.buffer = buffer;
        const out = outputNode(ctx);
        if (gain) {
            gain.gain.value = 1;
            source.connect(gain);
            gain.connect(out);
        } else {
            source.connect(out);
        }
        return new Promise((resolve) => {
            let done = false;
            const finish = (ok) => {
                if (done) return;
                done = true;
                resolve(ok);
            };
            // counted until the source itself ends (finish may come first, on its timer): the context is
            // suspended only once nothing is left playing
            let counted = true;
            state.playing += 1;
            if (state.idleTimer) { clearTimeout(state.idleTimer); state.idleTimer = null; }
            const ended = () => {
                if (!counted) return;
                counted = false;
                state.playing = Math.max(0, state.playing - 1);
                if (state.playing === 0) scheduleIdleSuspend();
            };
            source.onended = () => { ended(); finish(true); };
            // suspended while the WAV loaded (the idle suspend): it plays as the context resumes
            if (ctx.state === 'suspended' && ctx.resume) ctx.resume().catch(() => {});
            try {
                source.start(0);
            } catch (_err) {
                ended();
                finish(false);
                return;
            }
            const ms = Math.min(SHUTDOWN_WAIT_MAX_MS, Math.ceil((buffer.duration || 0) * 1000) + 80);
            setTimeout(() => finish(true), Math.max(80, ms));
        });
    }

    // Events a multi-item operation plays once at its end instead of per batch (coalesce)
    const COALESCED_EVENTS = ['recycle'];
    let coalesceDepth = 0;
    const coalescedPending = new Set();

    function play(eventId, options) {
        const id = normalizeEvent(eventId);
        if (coalesceDepth > 0 && COALESCED_EVENTS.indexOf(id) !== -1) {
            coalescedPending.add(id);
            return Promise.resolve(false);
        }
        if (!id || !state.enabled || !isDesktopNow()) return Promise.resolve(false);
        const file = resolveFile(id, options && options.startup);
        if (!file) return Promise.resolve(false);
        // this sound's WAV is decoded first; unlock's prefetch queues the others behind it
        const loaded = loadBuffer(file);
        unlock();
        return loaded.then((buffer) => playBuffer(buffer));
    }

    /**
     * await fn() with Recycle held: a multi-delete / scrap move in batches plays it once when the
     * whole operation ends, not once per batch or item. Nested calls play at the outermost end.
     */
    async function coalesce(fn) {
        coalesceDepth++;
        try {
            return await fn();
        } finally {
            coalesceDepth--;
            if (coalesceDepth === 0 && coalescedPending.size) {
                const ids = [...coalescedPending];
                coalescedPending.clear();
                ids.forEach((id) => play(id));
            }
        }
    }

    /** The Sound dialog's Test: one file, even while the scheme or the event is silent. */
    function playFile(file) {
        if (!file || FILES.indexOf(file) === -1) return Promise.resolve(false);
        const loaded = loadBuffer(file);
        unlock();
        return loaded.then((buffer) => playBuffer(buffer));
    }

    function bootIconEvent(icon) {
        return BOOT_ICON_EVENT[icon] || 'error';
    }

    function isPrintRequestType(type) {
        return PRINT_REQUEST_TYPES.indexOf(type) !== -1;
    }

    function isCancelError(error) {
        if (!error) return false;
        if (error.code === 'CLIENT_CANCELLED') return true;
        const msg = String(error.message || error || '');
        return /cancell?ed/i.test(msg);
    }

    function playPrint(requestType, error) {
        if (!isPrintRequestType(requestType)) return Promise.resolve(false);
        if (error && isCancelError(error)) return Promise.resolve(false);
        return play(error ? 'print-error' : 'print-complete');
    }

    function shouldSkipBalloon(title, options) {
        if (options && options.silent === true) return true;
        return !!(title && BALLOON_OWNED_TITLES[title]);
    }

    function playBalloon(title, options) {
        if (shouldSkipBalloon(title, options)) return Promise.resolve(false);
        return play('balloon');
    }

    function onDocumentEvent(ev) {
        if (!ev || !ev.detail) return;
        const startup = ev.detail.stage === 'done';
        const id = startup ? 'logon' : ev.detail.event;
        if (id) play(id, { startup });
    }

    function bind() {
        if (state.bound || !doc || !win) return;
        state.bound = true;
        state.enabled = readEnabled();
        doc.addEventListener('pointerdown', onGesture, { capture: true, passive: true });
        doc.addEventListener('keydown', onGesture, { capture: true });
        // hidden: nothing is heard from this window until it shows again, so the device is let go now
        doc.addEventListener('visibilitychange', () => {
            if (doc.visibilityState !== 'hidden') return;
            if (state.idleTimer) { clearTimeout(state.idleTimer); state.idleTimer = null; }
            suspendIfIdle();
        }, { signal: appScopeSignal });
        doc.addEventListener('desktopBootStage', (ev) => {
            if (ev && ev.detail && ev.detail.stage === 'done') play('logon', { startup: true });
        });
        doc.addEventListener('desktopWorkstationLocked', () => play('lock'));
        doc.addEventListener('desktopWorkstationUnlocked', () => play('unlock'));
        doc.addEventListener('desktopSessionResumed', () => play('logon'));
        doc.addEventListener('desktopSound', onDocumentEvent);
        if (state.enabled) {
            setTimeout(prefetch, 0);
        }
    }

    const api = {
        STORAGE_KEY,
        SCHEME,
        FILES,
        PRINT_REQUEST_TYPES,
        SHUTDOWN_WAIT_MAX_MS,
        normalizeEvent,
        eventFile,
        soundUrl,
        readEnabled,
        writeEnabled,
        bootIconEvent,
        isPrintRequestType,
        isCancelError,
        playPrint,
        shouldSkipBalloon,
        playBalloon,
        isEnabled,
        setEnabled,
        play,
        coalesce,
        playFile,
        resolveFile,
        outputLevel,
        unlock,
        prefetch,
        bind,
        _test: { state }
    };

    if (win) {
        win.desktopSounds = api;
        if (doc) {
            if (doc.readyState === 'loading') {
                doc.addEventListener('DOMContentLoaded', bind);
            } else {
                bind();
            }
        }
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})();
