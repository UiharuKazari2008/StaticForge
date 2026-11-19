/**
 * Tab volume. One slider for every sound in this tab (media elements and
 * Web Audio), saved on this computer. The tray icon is the last system icon,
 * right of the network icon (#932). The popup is Vista's volume flyout
 * (SndVolSSO on the VM): vertical slider, speaker button, Mixer footer.
 *
 * localStorage desktop-tab-volume (0-100) and desktop-tab-muted (`1`).
 *
 * Apps with their own audio (Alchemy's remote browser, grimoireRemoteBrowser.js) join the flyout
 * as a column of their own, as Vista's Volume Mixer lists applications beside the device, and add
 * their options to the icon's right-click menu (Yozora #628): window.tabVolume.registerSource({
 * id, label, icon, isActive(), getVolume(), setVolume(v, final), isMuted(), setMuted(m),
 * menuItems(), onMenuAction(action, item) }). tabVolume.onChange(fn) hears the master level (an
 * app scales its own stream by masterGain(), which an iframe's audio would otherwise escape).
 *
 * With a volume tray provider (#932, docs/client-api/tray-providers.md: DreamOS's CaféReady host
 * through PipeWire, the Android app's desktop shell) the slider and the speaker button are the
 * computer's own volume and mute, and changes made elsewhere (the volume keys) come back pushed. The tab's own level then stays at full (the hardware turns it
 * down), and nothing is kept in localStorage. Elsewhere it is the tab's volume, as before.
 */
(function () {
    const VOLUME_KEY = 'desktop-tab-volume';
    const MUTE_KEY = 'desktop-tab-muted';
    const appScopeSignal = (window.melatonSegments && typeof window.melatonSegments.callerSignal === 'function' && window.melatonSegments.callerSignal()) || undefined; // page listeners end with this file's segment (app-scope, #872/#890)

    let level = 100;
    let muted = false;
    let flyout = null;
    const sources = [];
    const changeListeners = [];
    // the computer's volume (a tray provider: DreamOS, the Android app's desktop), or null: the tab's own.
    // trayProviders.js loads before this file; a provider registered later takes over through onChange.
    let hwAudio = null;
    function volumeProvider() {
        const t = window.melatonTray;
        const p = t && window.uiShell !== 'mobile' ? t.provider('volume') : null;
        return p && typeof p.get === 'function' && typeof p.set === 'function' ? p : null;
    }
    hwAudio = volumeProvider();
    let hwSending = false;
    let hwWanted = null;

    function masterGain() {
        if (hwAudio) return 1;
        if (muted || level <= 0) return 0;
        return level / 100;
    }

    /** Sends the newest wanted level / mute to the host, one request at a time (a drag sends many). */
    function hwSend(patch) {
        hwWanted = Object.assign(hwWanted || {}, patch);
        if (hwSending) return;
        const next = hwWanted;
        hwWanted = null;
        hwSending = true;
        Promise.resolve(hwAudio.set(next)).catch(() => { /* the host answers with its state event anyway */ }).then(() => {
            hwSending = false;
            if (hwWanted) { hwSend({}); return; }
            paintIcon();
            paintFlyout();
        });
    }

    /** The host's state (at start and on each 'dreamosaudio'): the keys, another program, or our own set. */
    function hwApply(st) {
        if (!st || st.present === false) return;
        const v = Number(st.volume);
        if (Number.isFinite(v)) level = Math.max(0, Math.min(100, Math.round(v)));
        muted = !!st.muted;
        // a drag in progress keeps its own value until it ends
        if (hwSending || hwWanted) return;
        paintIcon();
        paintFlyout();
        notifyChange();
    }

    function readStored() {
        if (hwAudio) {
            let st = null;
            try { st = hwAudio.get(); } catch (_err) { st = null; }
            if (st && st.present !== false && Number.isFinite(Number(st.volume))) {
                level = Math.max(0, Math.min(100, Math.round(Number(st.volume))));
                muted = !!st.muted;
            }
            return;
        }
        try {
            const raw = localStorage.getItem(VOLUME_KEY);
            if (raw != null && raw !== '') {
                const n = Number(raw);
                if (Number.isFinite(n)) level = Math.max(0, Math.min(100, Math.round(n)));
            }
            muted = localStorage.getItem(MUTE_KEY) === '1';
        } catch (_err) {
            level = 100;
            muted = false;
        }
    }

    function writeStored() {
        if (hwAudio) return;
        try {
            localStorage.setItem(VOLUME_KEY, String(level));
            if (muted) localStorage.setItem(MUTE_KEY, '1');
            else localStorage.removeItem(MUTE_KEY);
        } catch (_err) {
            // Private mode: the slider still works for this visit.
        }
    }

    const mediaLevels = typeof WeakMap === 'function' ? new WeakMap() : null;
    const volDesc = typeof HTMLMediaElement === 'function'
        ? Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'volume')
        : null;

    if (volDesc && mediaLevels && volDesc.get && volDesc.set) {
        Object.defineProperty(HTMLMediaElement.prototype, 'volume', {
            configurable: true,
            enumerable: volDesc.enumerable,
            get() {
                return mediaLevels.has(this) ? mediaLevels.get(this) : volDesc.get.call(this);
            },
            set(v) {
                const logical = Math.max(0, Math.min(1, Number(v) || 0));
                mediaLevels.set(this, logical);
                volDesc.set.call(this, logical * masterGain());
            }
        });
    }

    const masters = [];
    const contexts = typeof WeakMap === 'function' ? new WeakMap() : null;
    const origConnect = typeof AudioNode === 'function' ? AudioNode.prototype.connect : null;

    function masterFor(ctx) {
        let node = contexts.get(ctx);
        if (node) return node;
        node = ctx.createGain();
        node.gain.value = masterGain();
        contexts.set(ctx, node);
        masters.push(node);
        origConnect.call(node, ctx.destination);
        return node;
    }

    if (origConnect && contexts) {
        AudioNode.prototype.connect = function (dest) {
            if (dest && dest.context && dest === dest.context.destination) {
                const args = Array.prototype.slice.call(arguments);
                args[0] = masterFor(dest.context);
                return origConnect.apply(this, args);
            }
            return origConnect.apply(this, arguments);
        };
    }

    function applyMaster() {
        const gain = masterGain();
        masters.forEach((node) => {
            node.gain.value = gain;
        });
        if (!volDesc || !mediaLevels) return;
        document.querySelectorAll('audio, video').forEach((el) => {
            const logical = mediaLevels.has(el) ? mediaLevels.get(el) : volDesc.get.call(el);
            mediaLevels.set(el, logical);
            volDesc.set.call(el, logical * gain);
        });
    }

    function iconLevel() {
        if (muted || level <= 0) return 'mute';
        if (level < 34) return 'low';
        if (level < 67) return 'mid';
        return 'high';
    }

    function paintIcon() {
        const icon = document.getElementById('volumeTrayIcon');
        if (!icon) return;
        icon.dataset.level = iconLevel();
        icon.title = muted || level <= 0 ? 'Volume: Muted' : 'Volume: ' + level + '%';
        const glyph = icon.querySelector('i');
        if (glyph) {
            const fa = iconLevel() === 'mute' ? 'fa-volume-xmark'
                : iconLevel() === 'low' ? 'fa-volume-off'
                : iconLevel() === 'mid' ? 'fa-volume-low'
                : 'fa-volume-high';
            glyph.className = 'fas ' + fa;
        }
    }

    function notifyChange() {
        changeListeners.forEach((fn) => { try { fn(masterGain()); } catch (_err) { /* a listener failed */ } });
    }

    /** The app columns: one per registered source that has audio now. */
    function paintSources() {
        if (!flyout) return;
        const host = flyout.querySelector('.volume-flyout-apps');
        if (!host) return;
        const live = sources.filter((src) => { try { return src.isActive(); } catch (_err) { return false; } });
        flyout.classList.toggle('has-apps', live.length > 0);
        host.hidden = !live.length;
        const seen = new Set();
        live.forEach((src) => {
            seen.add(src.id);
            let col = host.querySelector('.volume-flyout-column[data-source="' + src.id + '"]');
            if (!col) {
                col = document.createElement('div');
                col.className = 'volume-flyout-column is-app';
                col.dataset.source = src.id;
                col.innerHTML = ''
                    + '<img class="volume-flyout-app-icon" alt="" width="16" height="16">'
                    + '<div class="volume-flyout-slider is-app win7"><div class="is-vertical">'
                    + '<input type="range" class="volume-flyout-range" min="0" max="100" step="1">'
                    + '</div></div>'
                    + '<button type="button" class="volume-flyout-mute"></button>';
                const range = col.querySelector('input');
                range.addEventListener('input', () => src.setVolume(Number(range.value), false));
                range.addEventListener('change', () => src.setVolume(Number(range.value), true));
                col.querySelector('.volume-flyout-mute').addEventListener('click', (e) => {
                    e.stopPropagation();
                    Promise.resolve(src.setMuted(!src.isMuted())).then(paintSources);
                });
                host.appendChild(col);
            }
            const img = col.querySelector('.volume-flyout-app-icon');
            if (src.icon && img.getAttribute('src') !== src.icon) img.setAttribute('src', src.icon);
            img.title = src.label;
            const appMuted = !!src.isMuted();
            const range = col.querySelector('input');
            range.setAttribute('aria-label', src.label + ' volume');
            if (document.activeElement !== range) range.value = String(appMuted ? 0 : src.getVolume());
            col.classList.toggle('is-muted', appMuted);
            const btn = col.querySelector('.volume-flyout-mute');
            btn.setAttribute('aria-label', 'Mute ' + src.label);
            btn.title = (appMuted ? 'Unmute ' : 'Mute ') + src.label;
        });
        host.querySelectorAll('.volume-flyout-column[data-source]').forEach((col) => {
            if (!seen.has(col.dataset.source)) col.remove();
        });
    }

    function paintFlyout() {
        if (!flyout) return;
        paintSources();
        flyout.classList.toggle('is-muted', muted || level <= 0);
        const range = flyout.querySelector('.volume-flyout-range');
        if (range) range.value = String(muted ? 0 : level);
        const muteBtn = flyout.querySelector('.volume-flyout-mute');
        if (muteBtn) muteBtn.setAttribute('aria-pressed', muted ? 'true' : 'false');
    }

    function setLevel(next, opts) {
        level = Math.max(0, Math.min(100, Math.round(next)));
        if (!opts || !opts.keepMute) muted = level <= 0 ? muted : false;
        // keepMute: the level alone (Melaton Mobile's media slider; Off is its own radio button)
        if (level <= 0 && !(opts && opts.keepMute)) muted = true;
        if (hwAudio) hwSend({ volume: level, muted });
        writeStored();
        applyMaster();
        paintIcon();
        paintFlyout();
        notifyChange();
    }

    function setMuted(next) {
        muted = !!next;
        if (!muted && level <= 0) level = 50;
        if (hwAudio) hwSend({ volume: level, muted });
        writeStored();
        applyMaster();
        paintIcon();
        paintFlyout();
        notifyChange();
    }

    function ensureFlyout() {
        if (flyout) return flyout;
        flyout = document.createElement('div');
        flyout.id = 'volumeFlyout';
        flyout.className = 'volume-flyout hidden';
        flyout.innerHTML = ''
            + '<div class="volume-flyout-columns">'
            + '<div class="volume-flyout-column is-device">'
            + '<div class="volume-flyout-slider win7">'
            + '<div class="is-vertical">'
            + '<input type="range" class="volume-flyout-range" min="0" max="100" step="1" aria-label="Volume">'
            + '</div>'
            + '</div>'
            + '<button type="button" class="volume-flyout-mute" aria-label="Mute"></button>'
            + '</div>'
            + '<div class="volume-flyout-apps" hidden></div>'
            + '</div>'
            + '<div class="volume-flyout-mixer">Mixer</div>';
        document.body.appendChild(flyout);

        const range = flyout.querySelector('.volume-flyout-range');
        range.addEventListener('input', () => {
            setLevel(Number(range.value));
        });
        range.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
                e.preventDefault();
                setLevel(level + 5);
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
                e.preventDefault();
                setLevel(level - 5);
            }
        });

        flyout.querySelector('.is-device .volume-flyout-mute').addEventListener('click', (e) => {
            e.stopPropagation();
            setMuted(!muted);
        });

        document.addEventListener('pointerdown', (e) => {
            if (!flyout || flyout.classList.contains('hidden')) return;
            if (flyout.contains(e.target)) return;
            const icon = document.getElementById('volumeTrayIcon');
            if (icon && icon.contains(e.target)) return;
            hideFlyout();
        }, true);
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') hideFlyout();
        });
        return flyout;
    }

    function positionFlyout() {
        const icon = document.getElementById('volumeTrayIcon');
        if (!flyout || !icon) return;
        const rect = icon.getBoundingClientRect();
        const width = flyout.offsetWidth || 74;
        const margin = 8;
        let left = rect.right - width;
        if (left < margin) left = margin;
        if (left + width > innerWidth - margin) left = innerWidth - width - margin;
        flyout.style.left = left + 'px';
        flyout.style.bottom = Math.max(margin, innerHeight - rect.top + 4) + 'px';
    }

    function showFlyout() {
        ensureFlyout();
        flyout.classList.remove('hidden');
        paintFlyout();
        positionFlyout();
    }

    function hideFlyout() {
        if (flyout) flyout.classList.add('hidden');
    }

    function toggleFlyout() {
        if (flyout && !flyout.classList.contains('hidden')) hideFlyout();
        else showFlyout();
    }

    /** Right-click: Open Volume Mixer and Sounds as on Vista, then each app's own options. */
    function showMenu(e) {
        const icon = document.getElementById('volumeTrayIcon');
        const cm = window.contextMenu;
        if (!icon || !cm || typeof cm.attachToElement !== 'function') return;
        const sections = [{
            type: 'list',
            items: [
                { text: 'Open Volume Mixer', icon: 'fas fa-sliders', action: 'volume-mixer' },
                { text: 'Sounds', icon: 'fas fa-music', action: 'volume-sounds' }
            ]
        }];
        sources.forEach((src) => {
            let items = [];
            try { items = typeof src.menuItems === 'function' ? src.menuItems() : []; } catch (_err) { items = []; }
            if (items && items.length) {
                sections.push({ type: 'list', title: src.label, items: items.map((it) => Object.assign({}, it, { action: it.action ? 'volume-src:' + src.id + ':' + it.action : it.action })) });
            }
        });
        cm.attachToElement(icon, {
            sections,
            onAction: (action, target, item) => {
                if (action === 'volume-mixer') { showFlyout(); return; }
                if (action === 'volume-sounds') {
                    if (window.personalizationDialogs && typeof window.personalizationDialogs.openSound === 'function') window.personalizationDialogs.openSound();
                    return;
                }
                const m = /^volume-src:([^:]+):(.*)$/.exec(String(action || ''));
                const src = m && sources.find((s) => s.id === m[1]);
                if (src && typeof src.onMenuAction === 'function') src.onMenuAction(m[2], item);
            }
        });
        cm.showMenu(e, icon);
    }

    function wireIcon() {
        const icon = document.getElementById('volumeTrayIcon');
        if (!icon || icon.dataset.volumeWired === '1') return;
        icon.dataset.volumeWired = '1';
        icon.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleFlyout();
        });
        icon.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            hideFlyout();
            showMenu(e);
        });
        paintIcon();
    }

    window.tabVolume = {
        masterGain,
        registerSource(src) {
            if (!src || !src.id || sources.some((s) => s.id === src.id)) return;
            sources.push(src);
            paintFlyout();
        },
        refresh() {
            if (flyout && !flyout.classList.contains('hidden')) {
                paintFlyout();
                positionFlyout();
            }
        },
        // returns an unsubscribe function (a window that listens while it is open: Melaton Mobility Center)
        onChange(fn) {
            if (typeof fn !== 'function') return () => {};
            changeListeners.push(fn);
            return () => { const i = changeListeners.indexOf(fn); if (i >= 0) changeListeners.splice(i, 1); };
        },
        // the tab's master level (0-100) and mute, for surfaces without the tray flyout
        // (Melaton Mobile's volume bubble, #709)
        getLevel: () => level,
        setLevel: (v, opts) => setLevel(Number(v), opts),
        isMuted: () => muted,
        setMuted: (m) => setMuted(!!m),
        // a node straight to its context's speakers, past the master level: Melaton Mobile's
        // notification and system sounds follow their own level (the volume bubble's Ringer)
        connectRaw(node) {
            if (!node || !node.context) return;
            if (origConnect) origConnect.call(node, node.context.destination);
            else node.connect(node.context.destination);
        }
    };

    readStored();
    writeStored();
    applyMaster();
    if (window.melatonTray) {
        const off = window.melatonTray.onChange('volume', (st) => {
            const was = hwAudio;
            hwAudio = volumeProvider();
            if (!hwAudio) return;
            if (!was) applyMaster();
            hwApply(st);
        });
        if (appScopeSignal) appScopeSignal.addEventListener('abort', off, { once: true });
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', wireIcon);
    } else {
        wireIcon();
    }
})();
