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
    const sourceListeners = [];
    function notifySources() {
        sourceListeners.slice().forEach((fn) => { try { fn(); } catch (_err) { /* a listener failed */ } });
    }
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

    // ---- #1005: the wheel, the output button, the Windows Ding, the popup for the volume keys ----

    /** The mouse wheel over the icon or the flyout: 2 per notch, as Windows steps it; a touchpad's small deltas add up. */
    const WHEEL_STEP = 2;
    let wheelAcc = 0;
    function onWheel(e) {
        const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 100 : e.deltaY;
        if (!dy) return;
        e.preventDefault();
        let notches = 0;
        if (Math.abs(dy) >= 50) notches = dy < 0 ? 1 : -1;
        else {
            wheelAcc += dy;
            if (Math.abs(wheelAcc) < 100) return;
            notches = wheelAcc < 0 ? 1 : -1;
            wheelAcc = 0;
        }
        const from = muted ? 0 : level;
        const next = Math.max(0, Math.min(100, from + notches * WHEEL_STEP));
        if (next === from && !(muted && notches > 0)) return;
        setLevel(next);
    }

    /**
     * Vista's SndVolSSO plays the Default Beep (Windows Ding) when the slider is let go after a click or a drag,
     * at the new level, so the user hears it. In the Android app the sound plays natively on the media output
     * (AndroidVolume.play; no Web Audio there, phone-power-client rule 8); elsewhere through desktopSounds.
     */
    function ding() {
        const S = window.desktopSounds;
        if (!S || (typeof S.isEnabled === 'function' && !S.isEnabled())) return;
        const AV = window.AndroidVolume;
        if (hwAudio && AV && typeof AV.play === 'function' && typeof S.resolveFile === 'function') {
            const file = S.resolveFile('dialog');
            const gain = typeof S.mixerMuted === 'function' && S.mixerMuted() ? 0 : (typeof S.mixerLevel === 'function' ? S.mixerLevel() : 100) / 100;
            if (!file || gain <= 0) return;
            try { AV.play(location.origin + '/sounds/vista/' + encodeURIComponent(file), 'media', gain); } catch (_err) { /* older app: no sound */ }
            return;
        }
        if (typeof S.play === 'function') S.play('dialog');
    }

    // the device art Vista's Mixer uses (volumeMixer.js), by the output's kind
    const DEVICE_ART = '/static_images/vista-sndvol';
    const DEVICE_KINDS = ['speakers', 'headphones', 'headset', 'handset', 'line', 'digital', 'hdmi'];

    /** The outputs media can play on (audioDevices.js), the one it plays on first. */
    function outputs() {
        const A = window.melatonAudioDevices;
        if (!A || typeof A.list !== 'function') return [];
        let list = [];
        try { list = A.list('playback').filter((d) => d.state === 'working' && (d.isDefault || d.canSetDefault)); } catch (_err) { list = []; }
        return list;
    }

    function outputLabel(d) {
        return d.description && d.description !== d.name ? `${d.name} (${d.description})` : d.name;
    }

    /** The button over the slider: the output's picture; a click lists the outputs to move the sound to. */
    function paintOutput() {
        if (!flyout) return;
        const btn = flyout.querySelector('.volume-flyout-output');
        if (!btn) return;
        const list = outputs();
        const current = list.find((d) => d.isDefault) || list[0] || null;
        const show = !!current;
        if (btn.hidden === show) btn.hidden = !show;
        if (!current) return;
        const kind = DEVICE_KINDS.indexOf(current.kind) >= 0 ? current.kind : 'speakers';
        const src = `${DEVICE_ART}/${kind}-32.png`;
        const img = btn.querySelector('img');
        if (img && img.getAttribute('src') !== src) img.setAttribute('src', src);
        const tip = list.length > 1 ? `${outputLabel(current)}: click to choose where sound plays` : outputLabel(current);
        if (btn.title !== tip) btn.title = tip;
        btn.setAttribute('aria-label', tip);
    }

    function wireOutputButton(btn) {
        const cm = window.contextMenu;
        if (!cm || typeof cm.attachPickerMenu !== 'function') return;
        cm.attachPickerMenu(btn, {
            items: () => {
                const A = window.melatonAudioDevices;
                try { if (A && typeof A.refresh === 'function') A.refresh(); } catch (_err) { /* the platform answers later */ }
                const list = outputs();
                return [{ separator: true, text: 'Play sound on' }].concat(list.map((d) => ({ value: d.id, text: outputLabel(d) })));
            },
            value: () => { const d = outputs().find((o) => o.isDefault); return d ? d.id : null; },
            onSelect: (id) => switchOutput(id)
        });
    }

    // the flyout shown for the volume keys or the wheel over the icon closes on its own, ~3 s after the last change
    // (the pointer resting on it keeps it, as a balloon held by hover); one opened by a click stays until a click elsewhere
    const TRANSIENT_MS = 3000;
    let transientTimer = 0;
    function clearTransient() {
        if (transientTimer) { clearTimeout(transientTimer); transientTimer = 0; }
    }
    function showTransient() {
        const wasOpen = flyout && !flyout.classList.contains('hidden');
        if (wasOpen && !flyout.dataset.transient) return; // the user opened it: leave it open
        if (!wasOpen) showFlyout();
        flyout.dataset.transient = '1';
        clearTransient();
        if (!flyout.matches(':hover')) transientTimer = setTimeout(() => { transientTimer = 0; hideFlyout(); }, TRANSIENT_MS);
    }

    function ensureFlyout() {
        if (flyout) return flyout;
        flyout = document.createElement('div');
        flyout.id = 'volumeFlyout';
        flyout.className = 'volume-flyout hidden';
        flyout.innerHTML = ''
            + '<div class="volume-flyout-columns">'
            + '<div class="volume-flyout-column is-device">'
            + '<button type="button" class="volume-flyout-output" hidden><img alt="" width="32" height="32" draggable="false"></button>'
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
        // the footer link opens the Mixer, as SndVolSSO's does (#980)
        flyout.querySelector('.volume-flyout-mixer').addEventListener('click', (e) => { e.stopPropagation(); openMixer(); });

        const range = flyout.querySelector('.volume-flyout-range');
        range.addEventListener('input', () => {
            setLevel(Number(range.value));
        });
        // let go after a click or a drag: the Windows Ding at the new level (Vista's SndVolSSO)
        range.addEventListener('change', ding);
        flyout.addEventListener('wheel', onWheel, { passive: false });
        // the pointer on a self-closing flyout holds it; leaving starts the wait again
        flyout.addEventListener('pointerenter', clearTransient);
        flyout.addEventListener('pointerleave', () => { if (flyout.dataset.transient && !flyout.classList.contains('hidden')) showTransient(); });
        // using it makes it the user's: it stays until a click elsewhere
        flyout.addEventListener('pointerdown', () => { clearTransient(); delete flyout.dataset.transient; });
        wireOutputButton(flyout.querySelector('.volume-flyout-output'));
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
        }, { capture: true, signal: appScopeSignal });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') hideFlyout();
        }, { signal: appScopeSignal });
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
        clearTransient();
        delete flyout.dataset.transient;
        flyout.classList.remove('hidden');
        paintFlyout();
        // the outputs read when the flyout opens; a plug-in while it shows comes through onChange, which asks the
        // platform to push only while someone listens, so the flyout listens only while it is open
        const A = window.melatonAudioDevices;
        try { if (A && typeof A.refresh === 'function') A.refresh(); } catch (_err) { /* the platform answers later */ }
        if (A && typeof A.onChange === 'function' && !outputsOff) outputsOff = A.onChange(paintOutput) || null;
        paintOutput();
        positionFlyout();
    }
    let outputsOff = null;
    function stopOutputs() {
        if (!outputsOff) return;
        const off = outputsOff;
        outputsOff = null;
        try { off(); } catch (_err) { /* already gone */ }
    }
    if (appScopeSignal) appScopeSignal.addEventListener('abort', stopOutputs, { once: true });

    function hideFlyout() {
        clearTransient();
        stopOutputs();
        if (flyout) {
            flyout.classList.add('hidden');
            delete flyout.dataset.transient;
        }
    }

    function toggleFlyout() {
        if (flyout && !flyout.classList.contains('hidden')) hideFlyout();
        else showFlyout();
    }

    /** The computer's outputs (audioDevices.js) as radio items, "Speakers (Samsung Galaxy Z Fold7)" as Windows names them. */
    function outputItems() {
        const A = window.melatonAudioDevices;
        if (!A || typeof A.list !== 'function') return [];
        try { if (typeof A.refresh === 'function') A.refresh(); } catch (_err) { /* the platform answers later */ }
        let list = [];
        // the outputs media can play on (not the earpiece, which only calls use)
        try { list = A.list('playback').filter((d) => d.state === 'working' && (d.isDefault || d.canSetDefault)); } catch (_err) { list = []; }
        if (list.length < 2) return [];
        const label = (d) => {
            const full = d.description && d.description !== d.name ? `${d.name} (${d.description})` : d.name;
            // the menu is at most 300 px (about 30 characters of text): the maker's name goes first ("Speakers (Galaxy Z
            // Fold7)"), then a long one goes by its hardware ("NexDock (HDMI)")
            if (full.length <= 30 || !d.description) return full;
            const short = `${d.name} (${d.description.replace(/^(Samsung|Google|Apple|Sony|Motorola)\s+/i, '')})`;
            if (short.length <= 30) return short;
            return d.kind === 'hdmi' ? `${d.description} (HDMI)` : d.description;
        };
        return list.map((d) => ({
            text: label(d),
            action: 'volume-out:' + d.id,
            showIndicator: true,
            indicatorMark: 'radio',
            checked: !!d.isDefault,
            disabled: false
        }));
    }

    /** One click from the tray menu: media moves there (Android: the Media output route; DreamOS: the default sink). */
    function switchOutput(id) {
        const A = window.melatonAudioDevices;
        if (!A || typeof A.setDefault !== 'function') return;
        Promise.resolve(A.setDefault(id, 'default')).then((r) => {
            if (!r || !r.error) return;
            if (typeof window.showConfirmationDialog === 'function') {
                window.showConfirmationDialog(r.error, [{ text: 'OK', value: true, className: 'btn-standard primary' }], null, { title: 'Sound', icon: 'fas fa-exclamation-triangle', showCloseButton: true });
            }
        });
    }

    /** Right-click: Open Volume Mixer and Sounds as on Vista, then each app's own options. */
    function showMenu(e) {
        const icon = document.getElementById('volumeTrayIcon');
        const cm = window.contextMenu;
        if (!icon || !cm || typeof cm.attachToElement !== 'function') return;
        const sections = [{
            type: 'list',
            items: [
                // Vista's SndVolSSO menu: no icons (#963: Playback / Recording devices open Sound on their tab)
                { text: 'Open Volume Mixer', action: 'volume-mixer' },
                { text: 'Playback devices', action: 'volume-sound:playback' },
                // the outputs, one click to switch (#963): radio items, the one media plays on marked
                ...outputItems(),
                { text: 'Recording devices', action: 'volume-sound:recording' },
                { text: 'Sounds', action: 'volume-sound:sounds' }
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
                if (action === 'volume-mixer') { openMixer(); return; }
                const out = /^volume-out:(.+)$/.exec(String(action || ''));
                if (out) { switchOutput(out[1]); return; }
                const snd = /^volume-sound:(\w+)$/.exec(String(action || ''));
                if (snd) {
                    // the Sound dialog lives in Control Panel's scripts: loaded first when the tray asks before it
                    const fl = window.featureLoader;
                    Promise.resolve(window.personalizationDialogs || !fl ? null : fl.loadFeature('control_panel')).catch(() => null).then(() => {
                        const pd = window.personalizationDialogs;
                        if (pd && typeof pd.openSound === 'function') pd.openSound(snd[1]);
                    });
                    return;
                }
                const m = /^volume-src:([^:]+):(.*)$/.exec(String(action || ''));
                const src = m && sources.find((s) => s.id === m[1]);
                if (src && typeof src.onMenuAction === 'function') src.onMenuAction(m[2], item);
            }
        });
        cm.showMenu(e, icon);
    }

    /** Vista's Volume Mixer (sndvol, #980): its own feature, loaded the first time it is asked for. */
    function openMixer() {
        hideFlyout();
        const fl = window.featureLoader;
        Promise.resolve(window.melatonVolumeMixer || !fl ? null : fl.loadFeature('volume_mixer')).catch(() => null).then(() => {
            const m = window.melatonVolumeMixer;
            if (m && typeof m.open === 'function') m.open();
        });
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
        // the wheel over the icon turns the volume and shows the flyout while it does (#1005)
        icon.addEventListener('wheel', (e) => { onWheel(e); if (e.defaultPrevented) showTransient(); }, { passive: false });
        paintIcon();
    }

    /**
     * The volume keys while this desktop is the focused display (#1005; the Android app's desktop shell, DeX): the app
     * hands them to the page (AndroidVolume.takeKeys: only while this window has focus), steps the media volume and
     * pushes 'androidvolumekey'; the Vista flyout shows for them and closes on its own.
     */
    function wireVolumeKeys() {
        const AV = window.AndroidVolume;
        let androidDesktop = false;
        try { androidDesktop = !!(window.AndroidDisplay && typeof window.AndroidDisplay.isDesktop === 'function' && window.AndroidDisplay.isDesktop()); } catch (_err) { androidDesktop = false; }
        if (!androidDesktop || window.uiShell === 'mobile' || !AV || typeof AV.takeKeys !== 'function') return;
        try { AV.takeKeys(true); } catch (_err) { return; }
        window.addEventListener('androidvolumekey', (e) => {
            const d = (e && e.detail) || {};
            if (d.kind && d.kind !== 'media') return;
            if (Number.isFinite(Number(d.mediaPct))) hwApply({ volume: Number(d.mediaPct), muted: !!d.mediaMuted });
            showTransient();
        }, { signal: appScopeSignal });
    }

    window.tabVolume = {
        masterGain,
        registerSource(src) {
            if (!src || !src.id || sources.some((s) => s.id === src.id)) return;
            sources.push(src);
            paintFlyout();
            notifySources();
        },
        refresh() {
            if (flyout && !flyout.classList.contains('hidden')) {
                paintFlyout();
                positionFlyout();
            }
            notifySources();
        },
        // the Volume Mixer's application columns (#980): the registered sources, and a call when one changed
        // (registerSource / refresh); returns its unsubscribe
        sources: () => sources.slice(),
        onSourcesChange(fn) {
            if (typeof fn !== 'function') return () => {};
            sourceListeners.push(fn);
            return () => { const i = sourceListeners.indexOf(fn); if (i >= 0) sourceListeners.splice(i, 1); };
        },
        openMixer,
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
        document.addEventListener('DOMContentLoaded', wireIcon, { signal: appScopeSignal });
    } else {
        wireIcon();
    }
    wireVolumeKeys();
})();
