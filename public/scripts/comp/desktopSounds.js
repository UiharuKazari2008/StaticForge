/**
 * Vista desktop sound scheme. Plays host-local WAVs from /sounds/vista/
 * (media/Windows Vista Sounds, not in git). On by default; Personalize → Sounds
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

    function loadBuffer(eventId) {
        const id = normalizeEvent(eventId);
        const url = soundUrl(id);
        if (!id || !url) return Promise.resolve(null);
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
            loadBuffer(id);
        });
    }

    function playBuffer(buffer) {
        const ctx = getContext();
        if (!ctx || !buffer) return Promise.resolve(false);
        const source = ctx.createBufferSource();
        const gain = ctx.createGain ? ctx.createGain() : null;
        source.buffer = buffer;
        if (gain) {
            gain.gain.value = 1;
            source.connect(gain);
            gain.connect(ctx.destination);
        } else {
            source.connect(ctx.destination);
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

    function play(eventId) {
        const id = normalizeEvent(eventId);
        if (!id || !state.enabled || !isDesktopNow()) return Promise.resolve(false);
        unlock();
        return loadBuffer(id).then((buffer) => playBuffer(buffer));
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
        const id = ev.detail.stage === 'done' ? 'logon' : ev.detail.event;
        if (id) play(id);
    }

    function bind() {
        if (state.bound || !doc || !win) return;
        state.bound = true;
        state.enabled = readEnabled();
        const unlockOnce = () => unlock();
        doc.addEventListener('pointerdown', unlockOnce, { capture: true, passive: true });
        doc.addEventListener('keydown', unlockOnce, { capture: true });
        doc.addEventListener('desktopBootStage', (ev) => {
            if (ev && ev.detail && ev.detail.stage === 'done') play('logon');
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
