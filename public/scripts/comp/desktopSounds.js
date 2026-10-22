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
        uac: 'Windows User Account Control.wav'
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
        'Windows User Account Control.wav'
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
        buffers: Object.create(null),
        inflight: Object.create(null),
        bound: false
    };

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
        return state.ctx;
    }

    function unlock() {
        const ctx = getContext();
        if (!ctx) return;
        if (ctx.state === 'suspended' && ctx.resume) {
            ctx.resume().catch(() => {});
        }
        state.unlocked = true;
        prefetch();
    }

    /** Decoded audio by file name (several events share one WAV). */
    function loadBuffer(file) {
        if (!file || FILES.indexOf(file) === -1) return Promise.resolve(null);
        const id = file;
        const url = BASE + encodeURIComponent(file);
        if (state.buffers[id]) return Promise.resolve(state.buffers[id]);
        if (state.inflight[id]) return state.inflight[id];
        const ctx = getContext();
        if (!ctx || !win || !win.fetch) return Promise.resolve(null);
        state.inflight[id] = win.fetch(url, { credentials: 'same-origin' })
            .then((res) => {
                if (!res.ok) throw new Error('sound ' + res.status);
                return res.arrayBuffer();
            })
            .then((bytes) => ctx.decodeAudioData(bytes.slice(0)))
            .then((buffer) => {
                state.buffers[id] = buffer;
                delete state.inflight[id];
                return buffer;
            })
            .catch(() => {
                delete state.inflight[id];
                return null;
            });
        return state.inflight[id];
    }

    function prefetch() {
        if (!state.enabled || !isDesktopNow()) return;
        Object.keys(SCHEME).forEach((id) => {
            const file = resolveFile(id);
            if (file) loadBuffer(file);
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
            source.onended = () => finish(true);
            try {
                source.start(0);
            } catch (_err) {
                finish(false);
                return;
            }
            const ms = Math.min(SHUTDOWN_WAIT_MAX_MS, Math.ceil((buffer.duration || 0) * 1000) + 80);
            setTimeout(() => finish(true), Math.max(80, ms));
        });
    }

    function play(eventId, options) {
        const id = normalizeEvent(eventId);
        if (!id || !state.enabled || !isDesktopNow()) return Promise.resolve(false);
        const file = resolveFile(id, options && options.startup);
        if (!file) return Promise.resolve(false);
        unlock();
        return loadBuffer(file).then((buffer) => playBuffer(buffer));
    }

    /** The Sound dialog's Test: one file, even while the scheme or the event is silent. */
    function playFile(file) {
        if (!file || FILES.indexOf(file) === -1) return Promise.resolve(false);
        unlock();
        return loadBuffer(file).then((buffer) => playBuffer(buffer));
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
        const unlockOnce = () => unlock();
        doc.addEventListener('pointerdown', unlockOnce, { capture: true, passive: true });
        doc.addEventListener('keydown', unlockOnce, { capture: true });
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
