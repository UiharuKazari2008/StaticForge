/*
 * Volume Mixer (Yozora #980): Vista's sndvol.exe, measured on the Vista VM with Windows Media Player, a
 * WMPlayer.OCX script and SoundPlayer programs playing (~/.cache/vista-vm/mixer-ref). Opened by the tray volume menu's
 * Open Volume Mixer, the volume flyout's Mixer link and Control Panel > Sound > Adjust system volume
 * (tabVolume.openMixer); feature 'volume_mixer'.
 *
 * The window: caption "Volume Mixer" with sndvol's icon, only a Close box, resizable sideways (the height is fixed);
 * a menu bar with Device (the playback devices, the shown one checked; choosing one moves media there:
 * melatonAudioDevices.setDefault - Android's Media output route, DreamOS's default sink). Group box Device (the output's
 * 32 px icon with "<name> (<hardware>)" as its tip, the name, the master slider with the peak meter in its channel,
 * the mute button) and Applications (one 110 px column per application: icon, name in two lines with an ellipsis,
 * slider, mute; a horizontal scroll bar under them when they do not fit; a column that goes leaves its place empty
 * until the window opens again).
 *
 * Levels as Vista keeps them: an application's level is a fraction of the master. Its thumb sits at master x level,
 * the pale line across the window marks the master, each application slider has ticks at the master and half of it
 * (the device slider at 100 % and 50 %). Lowering the master lowers every application with it; raising an
 * application above the master raises the master to it and lowers the others' fractions so they sound the same.
 * Muting the device greys every thumb and shows each application's mute icon; a muted application greys its thumb.
 * Keys: Tab between the controls, arrows 1, Page Up / Down 20 (a click in the channel pages toward the pointer),
 * Home / End, Space on a mute button, Alt+D the Device menu.
 *
 * Applications (a session: { key, label, tip, icon, volume 0-100 of the master, muted, canVolume, canMute, note }):
 *   Melaton Sounds    desktopSounds' own level (Vista's "Windows Sounds" with the Melaton flag), always first
 *   page media        each window with a sound or video element that has played (Melaton Media Player, Lumen ...): the
 *                     element's own volume / muted (Melaton Media Player's slider follows, as WMP's does on Vista)
 *   tab sources       tabVolume.registerSource apps (Alchemy's remote browser)
 *   Android apps      the device client (DSApp AndroidAudioDevices.watchSessions, AudioSessions.kt): the apps with a
 *                     player open, their real icon and label; Samsung's per-app volume and mute through the app's
 *                     shell where the phone has it, else greyed with the reason (Vista greys what it cannot set)
 *   DreamOS streams   PipeWire's playback streams (DreamOSAudio.streams, CaféReady audio.rs): wpctl per stream
 * The meter: the device's peak (Android: a Visualizer on the output mix; DreamOS: the default sink's monitor; a
 * browser: Melaton Sounds' analyser), drawn while the window is seen. Nothing listens, samples or runs while the
 * Mixer is closed, minimized, hidden or the screen is off.
 *
 *   melatonVolumeMixer.open()  / close()
 */
(function (root) {
    'use strict';

    const doc = root.document;
    const appScopeSignal = (root.melatonSegments && typeof root.melatonSegments.callerSignal === 'function' && root.melatonSegments.callerSignal()) || undefined; // page listeners end with this file's segment (app-scope, #872/#890)
    const ART = '/static_images/vista-sndvol';
    const TITLE = 'Volume Mixer';
    const ICON16 = `${ART}/sndvol-16.png`;
    const ICON32 = `${ART}/sndvol-32.png`;
    const APP_ICON = '/static_images/vista-icons/application-32.png';
    const SOUNDS_ICON = '/static_images/melaton/melaton-32.png';
    const DEVICE_ICONS = { speakers: 'speakers', headphones: 'headphones', headset: 'headset', handset: 'handset', line: 'line', digital: 'digital', hdmi: 'hdmi' };
    // metrics (px), from dialog 200 / 202 at Segoe UI 9 and the VM's pixels
    const COL = 110;          // an application column's pitch
    const TRAVEL = 118;       // the thumb centre's travel for 0-100
    const LINE_STEP = 1;
    const PAGE_STEP = 20;
    const MAX_OPEN_COLS = 6;  // the widest the window opens (more scroll)

    const call = (name, ...args) => (typeof root[name] === 'function' ? root[name](...args) : undefined);
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    const parse = (s) => { try { return typeof s === 'string' ? JSON.parse(s) : (s && typeof s === 'object' ? s : null); } catch (_) { return null; } };
    const clamp = (v) => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));

    let win = null;          // the window (modal)
    let offs = [];           // unsubscribers while open
    let seenOffs = [];       // unsubscribers while seen
    let seen = false;
    let stale = false;
    let cols = new Map();    // session key -> column element
    let sessions = [];       // the last list painted
    let android = null;      // the Android sessions state ({ shell, control, items, error })
    let paintQueued = 0;
    let sizeUntil = 0;       // while the window still takes its opening size (the device client's list comes pushed)

    // ---- the master (the device column) --------------------------------------------------------------------------

    const tv = () => root.tabVolume || null;
    const audio = () => root.melatonAudioDevices || null;
    function masterLevel() { const t = tv(); return t ? clamp(t.getLevel()) : 100; }
    function masterMuted() { const t = tv(); return t ? !!t.isMuted() : false; }
    function setMaster(v) { const t = tv(); if (t) t.setLevel(clamp(v), { keepMute: true }); }
    function setMasterMuted(m) { const t = tv(); if (t) t.setMuted(!!m); }

    function outputs() {
        const a = audio();
        let list = [];
        try { list = a ? a.list('playback') : []; } catch (_) { list = []; }
        return list.filter((d) => d.state === 'working');
    }

    function device() {
        const list = outputs();
        return list.find((d) => d.isDefault) || list[0] || null;
    }

    function deviceText(d) {
        if (!d) return 'Speakers';
        return d.description && d.description !== d.name ? `${d.name} (${d.description})` : d.name;
    }

    // ---- the applications ------------------------------------------------------------------------------------------

    function soundsSession() {
        const ds = root.desktopSounds;
        const can = !!(ds && typeof ds.mixerSet === 'function');
        return {
            key: 'melaton-sounds', label: 'Melaton Sounds', tip: 'Melaton Sounds', icon: SOUNDS_ICON,
            volume: can ? clamp(ds.mixerLevel()) : 100, muted: can ? !!ds.mixerMuted() : false,
            canVolume: can, canMute: can,
            set: (p) => { if (can) ds.mixerSet({ level: p.volume, muted: p.muted }); }
        };
    }

    /** The window a page element plays in: its caption and icon, or Dreamscape for one outside any window. */
    function ownerOf(el) {
        const m = el.closest && el.closest('.modal');
        if (!m) return { key: 'page', label: 'Dreamscape', icon: '/static_images/logo_icon.png' };
        const cap = m.querySelector('.modal-window-title span');
        const img = m.querySelector('.modal-window-title .icon-image');
        const label = String((cap && cap.textContent) || m.getAttribute('aria-label') || 'Program').trim();
        return { key: `win:${m.id || m.dataset.windowIdentifier || label}`, label, icon: (m.dataset.taskbarIcon || (img && img.getAttribute('src')) || APP_ICON) };
    }

    /** Sound and video elements with a session: loaded and played at least once (Vista lists a paused player too). */
    function pageSessions() {
        const by = new Map();
        doc.querySelectorAll('audio, video').forEach((el) => {
            if (!el.isConnected || !el.currentSrc || (el.paused && !(el.currentTime > 0))) return;
            if (el.closest('.sndvol-window')) return;
            const o = ownerOf(el);
            let s = by.get(o.key);
            if (!s) {
                s = { key: o.key, label: o.label, tip: o.label, icon: o.icon, els: [], canVolume: true, canMute: true };
                by.set(o.key, s);
            }
            s.els.push(el);
        });
        return [...by.values()].map((s) => {
            // the loudest element stands for the window (a player has one; a page with several moves them together)
            const lead = s.els.reduce((a, b) => (b.volume > a.volume ? b : a), s.els[0]);
            s.volume = clamp(lead.volume * 100);
            s.muted = s.els.every((e) => e.muted);
            s.set = (p) => s.els.forEach((e) => {
                if (p.volume !== undefined) e.volume = clamp(p.volume) / 100;
                if (p.muted !== undefined) e.muted = !!p.muted;
            });
            return s;
        });
    }

    function tabSessions() {
        const t = tv();
        const list = t && typeof t.sources === 'function' ? t.sources() : [];
        return list.filter((src) => { try { return src.isActive(); } catch (_) { return false; } }).map((src) => ({
            key: `src:${src.id}`, label: src.label, tip: src.label, icon: src.icon || APP_ICON,
            volume: clamp(src.getVolume()), muted: !!src.isMuted(), canVolume: true, canMute: true,
            set: (p) => {
                if (p.volume !== undefined) src.setVolume(clamp(p.volume), !p.dragging);
                if (p.muted !== undefined) src.setMuted(!!p.muted);
            }
        }));
    }

    const androidBridge = () => { const B = root.AndroidAudioDevices; return B && typeof B.watchSessions === 'function' ? B : null; };

    function androidSessions() {
        const B = androidBridge();
        if (!B || !android) return [];
        const items = Array.isArray(android.items) ? android.items : [];
        const why = android.control === 'none'
            ? (android.shell === false ? (android.error || 'The phone\'s own shell (Localhost ADB or Shizuku) is off.') : 'This phone does not let one app set another app\'s volume.')
            : '';
        return items.map((it) => {
            const can = it.canSetVolume === true;
            return {
                key: `uid:${it.uid}`, label: it.label || it.package, tip: it.label || it.package, icon: it.icon || APP_ICON,
                volume: can && Number.isFinite(Number(it.volume)) ? clamp(it.volume) : 100, muted: !!it.muted,
                canVolume: can, canMute: can, note: can ? '' : why,
                set: (p) => {
                    if (p.volume !== undefined) { it.volume = clamp(p.volume); try { B.setAppVolume(Number(it.uid), clamp(p.volume)); } catch (_) { /* old app */ } }
                    if (p.muted !== undefined) { it.muted = !!p.muted; try { B.setAppMute(Number(it.uid), !!p.muted); } catch (_) { /* old app */ } }
                }
            };
        });
    }

    const dreamosBridge = () => { const A = root.DreamOSAudio; return A && typeof A.streams === 'function' ? A : null; };

    function dreamosSessions() {
        const A = dreamosBridge();
        if (!A) return [];
        let st = {};
        try { st = A.get() || {}; } catch (_) { st = {}; }
        const list = Array.isArray(st.streams) ? st.streams : [];
        // the shell's own browser plays Melaton's sounds: those are the columns above
        return list.filter((s) => !s.self).map((s) => ({
            key: `pw:${s.app || s.binary || s.id}:${s.pid || ''}`, label: s.app || s.binary || s.media || 'Application', tip: s.media ? `${s.app || s.binary}: ${s.media}` : (s.app || s.binary || ''),
            icon: APP_ICON, volume: Number.isFinite(Number(s.volume)) ? clamp(s.volume) : 100, muted: !!s.muted,
            canVolume: true, canMute: true,
            set: (p) => {
                const patch = {};
                if (p.volume !== undefined) { s.volume = clamp(p.volume); patch.volume = s.volume; }
                if (p.muted !== undefined) { s.muted = !!p.muted; patch.muted = s.muted; }
                // every stream of the program (CaféReady groups them as Vista groups a process's sessions)
                (Array.isArray(s.ids) && s.ids.length ? s.ids : [s.id]).forEach((id) => {
                    Promise.resolve(A.set(Object.assign({ id: Number(id) }, patch))).catch(() => {});
                });
            }
        }));
    }

    function readSessions() {
        return [soundsSession(), ...pageSessions(), ...tabSessions(), ...androidSessions(), ...dreamosSessions()];
    }

    // ---- painting ---------------------------------------------------------------------------------------------------

    /** The thumb centre's offset from the channel's top for an absolute level. */
    const posOf = (abs) => Math.round((100 - clamp(abs)) * TRAVEL / 100);

    function sliderHtml(kind) {
        return `<div class="sndvol-slider sndvol-slider-${kind}" role="slider" tabindex="0" aria-orientation="vertical" aria-valuemin="0" aria-valuemax="100">
            <i class="sndvol-tick sndvol-tick-hi"></i><i class="sndvol-tick sndvol-tick-lo"></i><i class="sndvol-tick sndvol-tick-zero"></i>
            <i class="sndvol-channel">${kind === 'device' ? '<i class="sndvol-meter-hold"></i><i class="sndvol-meter"></i>' : ''}</i>
            <i class="sndvol-wedge"></i>
            <i class="sndvol-thumb"></i>
        </div>`;
    }

    function muteHtml() {
        return '<button type="button" class="btn-standard sndvol-mute" aria-pressed="false"><img src="' + ART + '/volume-button.png" width="20" height="18" alt="" draggable="false"></button>';
    }

    function build() {
        // desktopAppCreateWindow: public/scripts/comp/desktop-apps/desktopAppWindow.js (the shared builder)
        const w = root.desktopAppCreateWindow({
            id: 'volumeMixerModal', identifier: 'volumeMixer', title: TITLE, icon16: ICON16, taskbarIcon: ICON32,
            className: 'resizeable-window sndvol-window'
        });
        const m = w.modal;
        w.content.classList.add('sndvol-client');
        w.content.innerHTML = `
            <div class="naxt-menubar sndvol-bar" role="menubar" data-win32-menus>
                <button type="button" class="naxt-menu-title" data-sndvol-menu="device" role="menuitem" aria-haspopup="true">Device</button>
            </div>
            <div class="sndvol-body">
                <fieldset class="sndvol-device"><legend>Device</legend></fieldset>
                <fieldset class="sndvol-apps"><legend>Applications</legend></fieldset>
                <i class="sndvol-line sndvol-line-device"></i>
                <div class="sndvol-col sndvol-col-device">
                    <img class="sndvol-icon" width="32" height="32" alt="" draggable="false">
                    <div class="sndvol-name"></div>
                    ${sliderHtml('device')}
                    ${muteHtml()}
                </div>
                <div class="sndvol-scroll"><i class="sndvol-line"></i><div class="sndvol-cols"></div></div>
            </div>`;
        w.close.addEventListener('click', close);
        const devCol = m.querySelector('.sndvol-col-device');
        wireSlider(devCol.querySelector('.sndvol-slider'), null);
        devCol.querySelector('.sndvol-mute').addEventListener('click', () => setMasterMuted(!masterMuted()));
        const menuBtn = m.querySelector('[data-sndvol-menu="device"]');
        if (root.contextMenu && typeof root.contextMenu.attachClickMenuToElement === 'function') {
            root.contextMenu.attachClickMenuToElement(menuBtn, {
                onAction: (a) => chooseDevice(a),
                sections: [{ type: 'list', initfn: (s) => { s.items = deviceItems(); } }]
            });
        }
        m.addEventListener('keydown', (ev) => {
            if (ev.altKey && !ev.ctrlKey && (ev.key === 'd' || ev.key === 'D')) { ev.preventDefault(); menuBtn.click(); return; }
            // Esc is the dialog's Cancel: it closes the Mixer (an open menu takes it first)
            if (ev.key === 'Escape' && !ev.defaultPrevented && !(root.contextMenu && root.contextMenu.isOpen)) { ev.preventDefault(); close(); }
        });
        return m;
    }

    /** The Device menu: every playback device that can play media, the shown one checked (sndvol menu 1000). */
    function deviceItems() {
        const cur = device();
        const list = outputs().filter((d) => d.isDefault || d.canSetDefault);
        if (!list.length) return [{ text: '(None)', action: 'none', disabled: true }];
        return list.map((d) => ({ text: deviceText(d), action: `dev:${d.id}`, showIndicator: true, indicatorMark: 'check', checked: !!(cur && cur.id === d.id) }));
    }

    function chooseDevice(action) {
        const m = /^dev:(.+)$/.exec(String(action || ''));
        const a = audio();
        if (!m || !a) return;
        const cur = device();
        if (cur && cur.id === m[1]) return;
        Promise.resolve(a.setDefault(m[1])).then((r) => {
            if (r && r.error) call('showConfirmationDialog', r.error, [{ text: 'OK', value: true, className: 'btn-standard primary' }], null, { title: TITLE, icon: 'fas fa-exclamation-triangle', showCloseButton: true });
            schedulePaint();
        });
    }

    function columnFor(s) {
        let col = cols.get(s.key);
        if (col) return col;
        col = doc.createElement('div');
        col.className = 'sndvol-col sndvol-col-app';
        col.dataset.key = s.key;
        col.innerHTML = `<img class="sndvol-icon" width="32" height="32" alt="" draggable="false"><div class="sndvol-name"></div>${sliderHtml('app')}${muteHtml()}`;
        win.querySelector('.sndvol-cols').appendChild(col);
        cols.set(s.key, col);
        wireSlider(col.querySelector('.sndvol-slider'), s.key);
        col.querySelector('.sndvol-mute').addEventListener('click', () => {
            const cur = sessions.find((x) => x.key === s.key);
            if (cur && cur.canMute) { cur.set({ muted: !cur.muted }); cur.muted = !cur.muted; schedulePaint(); }
        });
        return col;
    }

    // writes only what changed (phone-power-client 4)
    function setText(el, t) { if (el.textContent !== t) el.textContent = t; }
    function setAttr(el, k, v) { if (v === null) { if (el.hasAttribute(k)) el.removeAttribute(k); } else if (el.getAttribute(k) !== v) el.setAttribute(k, v); }
    function setVar(el, k, v) { if (el.style.getPropertyValue(k) !== v) el.style.setProperty(k, v); }
    function toggle(el, c, on) { if (el.classList.contains(c) !== on) el.classList.toggle(c, on); }

    function paintSlider(el, abs, opts) {
        setVar(el, '--sndvol-pos', `${posOf(abs)}px`);
        setVar(el, '--sndvol-tick-hi', `${posOf(opts.tickHi)}px`);
        setVar(el, '--sndvol-tick-lo', `${posOf(opts.tickLo)}px`);
        setAttr(el, 'aria-valuenow', String(clamp(abs)));
        setAttr(el, 'aria-label', opts.label);
        setAttr(el, 'aria-disabled', opts.disabled ? 'true' : null);
        toggle(el, 'is-disabled', !!opts.disabled);
        toggle(el, 'is-greyed', !!opts.greyed);
        if (opts.disabled) setAttr(el, 'tabindex', '-1'); else setAttr(el, 'tabindex', '0');
    }

    function paintMute(btn, muted, pressed, label, disabled) {
        setAttr(btn, 'aria-pressed', pressed ? 'true' : 'false');
        setAttr(btn, 'aria-label', label);
        btn.disabled = !!disabled;
        const img = btn.querySelector('img');
        // sndvol.exe's icons 1 / 2, drawn from their 32 px frame (the glyph is 16 x 14 in it)
        const src = `${ART}/${muted ? 'mute' : 'volume'}-button.png`;
        if (img.getAttribute('src') !== src) img.setAttribute('src', src);
    }

    function paint() {
        paintQueued = 0;
        if (!win) return;
        if (doc.hidden) { stale = true; return; }
        stale = false;
        const master = masterLevel();
        const mMuted = masterMuted();
        // the device
        const d = device();
        const devCol = win.querySelector('.sndvol-col-device');
        const icon = `${ART}/${DEVICE_ICONS[d && d.kind] || 'speakers'}-32.png`;
        const devIcon = devCol.querySelector('.sndvol-icon');
        if (devIcon.getAttribute('src') !== icon) devIcon.setAttribute('src', icon);
        setAttr(devIcon, 'title', deviceText(d));
        setText(devCol.querySelector('.sndvol-name'), d ? d.name : 'Speakers');
        const devName = d ? d.name : 'Speakers';
        paintSlider(devCol.querySelector('.sndvol-slider'), master, { tickHi: 100, tickLo: 50, label: `Volume for ${devName}`, greyed: mMuted });
        paintMute(devCol.querySelector('.sndvol-mute'), mMuted, mMuted, `Mute for ${devName}`, false);
        toggle(win, 'is-muted', mMuted);
        // the master line, in both groups
        setVar(win, '--sndvol-master', `${posOf(master)}px`);
        // the applications
        const list = readSessions();
        sessions = list;
        const live = new Set();
        list.forEach((s) => {
            live.add(s.key);
            const col = columnFor(s);
            const img = col.querySelector('.sndvol-icon');
            if (img.getAttribute('src') !== s.icon) img.setAttribute('src', s.icon);
            setAttr(col, 'title', s.note || null);
            setAttr(img, 'title', s.tip || s.label);
            setText(col.querySelector('.sndvol-name'), s.label);
            const abs = master * s.volume / 100;
            paintSlider(col.querySelector('.sndvol-slider'), abs, {
                tickHi: master, tickLo: master / 2, label: `Volume for ${s.label}`,
                disabled: !s.canVolume, greyed: mMuted || s.muted
            });
            paintMute(col.querySelector('.sndvol-mute'), mMuted || s.muted, s.muted, `Mute for ${s.label}`, !s.canMute);
        });
        // Vista keeps a gone application's place empty while the window stays open (one that comes back gets a new column)
        [...cols.keys()].forEach((key) => {
            if (live.has(key)) return;
            const col = cols.get(key);
            cols.delete(key);
            col.classList.add('is-gone');
            col.innerHTML = '';
            col.removeAttribute('title');
            delete col.dataset.key;
        });
        const n = win.querySelector('.sndvol-cols').children.length;
        setVar(win, '--sndvol-cols', String(Math.max(1, n)));
        if (sizeUntil && Date.now() < sizeUntil) sizeToApps(); else sizeUntil = 0;
    }

    /** Vista sizes the window to its applications when it opens (three: 489 x 367); later only by hand. */
    function sizeToApps() {
        const n = Math.max(1, Math.min(MAX_OPEN_COLS, sessions.length));
        const width = 16 + 124 + 8 + n * COL + 11;
        if (win.dataset.windowDefaultWidth === String(width)) return;
        win.dataset.windowDefaultWidth = String(width);
        win.style.width = `${width}px`;
        // it grows to the left: the window keeps its place by the tray
        if (win.dataset.sndvolPlaced === '1') root.requestAnimationFrame(place);
    }

    /** Vista opens the Mixer at the bottom right of the work area, by the tray. */
    function place() {
        if (!win) return;
        win.dataset.sndvolPlaced = '1';
        // the size it is given (a rect would read the opening animation's scale)
        const w = parseInt(win.dataset.windowDefaultWidth, 10) || win.offsetWidth;
        const h = parseInt(win.dataset.windowDefaultHeight, 10) || win.offsetHeight;
        const taskbar = doc.getElementById('taskbar');
        const workH = root.innerHeight - (taskbar ? taskbar.getBoundingClientRect().height : 0);
        call('setModalOffsetsFromViewportTopLeft', win, Math.max(0, Math.round(root.innerWidth - w)), Math.max(0, Math.round(workH - h)));
    }

    function schedulePaint() {
        if (paintQueued || !win) return;
        // coalesced: at most once a frame for a burst of changes (phone-power-client 5)
        paintQueued = root.requestAnimationFrame ? root.requestAnimationFrame(paint) : setTimeout(paint, 16);
    }

    // ---- input ----------------------------------------------------------------------------------------------------

    /** Sets a slider's absolute level: the device's is the master; an application's is a fraction of it (Vista's rule). */
    function apply(key, abs, dragging) {
        const v = clamp(abs);
        if (key === null) { setMaster(v); schedulePaint(); return; }
        const s = sessions.find((x) => x.key === key);
        if (!s || !s.canVolume) return;
        const m = masterLevel();
        if (v <= m && m > 0) {
            s.set({ volume: Math.round(v * 100 / m), dragging });
            s.volume = Math.round(v * 100 / m);
        } else {
            // above the master: the master comes up to it; the others keep what they sound like
            sessions.forEach((o) => {
                if (o === s || !o.canVolume) return;
                const rel = m > 0 ? Math.round(o.volume * m / v) : 0;
                if (rel !== o.volume) { o.set({ volume: rel, dragging }); o.volume = rel; }
            });
            s.set({ volume: 100, dragging });
            s.volume = 100;
            setMaster(v);
        }
        schedulePaint();
    }

    function absOf(el) { return clamp(el.getAttribute('aria-valuenow')); }

    function wireSlider(el, key) {
        let drag = null;
        let repeat = 0;
        const stopRepeat = () => { if (repeat) { clearTimeout(repeat); repeat = 0; } };
        const levelAt = (clientY, grab) => {
            const r = el.querySelector('.sndvol-channel').getBoundingClientRect();
            return 100 - ((clientY - grab - r.top) / TRAVEL) * 100;
        };
        el.addEventListener('pointerdown', (ev) => {
            if (ev.button !== 0 || el.classList.contains('is-disabled')) return;
            ev.preventDefault();
            el.focus({ preventScroll: true });
            const thumb = el.querySelector('.sndvol-thumb').getBoundingClientRect();
            if (ev.clientY >= thumb.top - 1 && ev.clientY <= thumb.bottom + 1 && ev.clientX >= thumb.left - 2 && ev.clientX <= thumb.right + 2) {
                // the grab point stays under the pointer
                drag = { grab: ev.clientY - (thumb.top + thumb.height / 2) };
                el.classList.add('is-pressed');
                el.setPointerCapture(ev.pointerId);
                return;
            }
            // the channel: a page toward the pointer, repeating while held (a Win32 track bar's)
            const target = levelAt(ev.clientY, 0);
            const step = () => {
                const cur = absOf(el);
                if (Math.abs(target - cur) < 1) { stopRepeat(); return; }
                apply(key, target > cur ? Math.min(target, cur + PAGE_STEP) : Math.max(target, cur - PAGE_STEP), false);
                repeat = setTimeout(step, repeat ? 100 : 500);
            };
            step();
            el.setPointerCapture(ev.pointerId);
        });
        el.addEventListener('pointermove', (ev) => { if (drag) apply(key, levelAt(ev.clientY, drag.grab), true); });
        const end = () => {
            stopRepeat();
            if (!drag) return;
            drag = null;
            el.classList.remove('is-pressed');
            apply(key, absOf(el), false);
        };
        el.addEventListener('pointerup', end);
        el.addEventListener('pointercancel', end);
        el.addEventListener('lostpointercapture', end);
        el.addEventListener('keydown', (ev) => {
            if (el.classList.contains('is-disabled')) return;
            const cur = absOf(el);
            const keys = { ArrowUp: cur + LINE_STEP, ArrowRight: cur + LINE_STEP, ArrowDown: cur - LINE_STEP, ArrowLeft: cur - LINE_STEP, PageUp: cur + PAGE_STEP, PageDown: cur - PAGE_STEP, Home: 100, End: 0 };
            if (!(ev.key in keys) || ev.altKey || ev.ctrlKey) return;
            ev.preventDefault();
            apply(key, keys[ev.key], false);
        });
    }

    // ---- the meter ------------------------------------------------------------------------------------------------

    const meter = { target: 0, level: 0, hold: 0, holdAt: 0, last: 0, raf: 0, pushedAt: 0 };

    /** A pushed peak (0-1000, linear): Android's Visualizer, DreamOS's sink monitor. */
    function meterPush(v) {
        meter.target = Math.max(0, Math.min(1, Number(v) / 1000 || 0));
        meter.pushedAt = performance.now();
        meterRun();
    }

    function meterRun() {
        if (!meter.raf && seen && win) meter.raf = root.requestAnimationFrame(meterFrame);
    }

    function meterFrame(now) {
        meter.raf = 0;
        if (!win || !seen) return;
        const dt = meter.last ? Math.min(0.1, (now - meter.last) / 1000) : 0.016;
        meter.last = now;
        // a browser: Melaton Sounds' own analyser while a sound plays
        const ds = root.desktopSounds;
        const local = !androidBridge() && !dreamosBridge() && ds && typeof ds.isPlaying === 'function' && ds.isPlaying();
        if (local) meter.target = Math.max(0, Math.min(1, Number(ds.outputLevel()) || 0));
        else if (!androidBridge() && !dreamosBridge()) meter.target = 0;
        // a push that stopped coming is silence
        if ((androidBridge() || dreamosBridge()) && now - meter.pushedAt > 400) meter.target = 0;
        // Vista's meter: up at once, down smoothly; the grey peak holds a moment, then falls
        meter.level = meter.target >= meter.level ? meter.target : Math.max(meter.target, meter.level - 1.6 * dt);
        if (meter.level >= meter.hold) { meter.hold = meter.level; meter.holdAt = now; } else if (now - meter.holdAt > 800) meter.hold = Math.max(meter.level, meter.hold - 0.5 * dt);
        const el = win.querySelector('.sndvol-col-device .sndvol-channel');
        if (el) {
            setVar(el, '--sndvol-level', meter.level.toFixed(3));
            setVar(el, '--sndvol-hold', meter.hold.toFixed(3));
        }
        if (meter.level > 0.001 || meter.hold > 0.001 || local) meter.raf = root.requestAnimationFrame(meterFrame);
        else meter.last = 0;
    }

    // ---- open, seen, closed ---------------------------------------------------------------------------------------

    function isSeen() {
        if (!win || doc.hidden) return false;
        if (doc.documentElement.hasAttribute('data-screen-off')) return false;
        return !win.classList.contains('minimised') && !win.classList.contains('hidden');
    }

    /** Sources that cost something (the Android sessions and meter, DreamOS streams) run only while the window is seen. */
    function updateSeen() {
        const now = isSeen();
        if (now === seen) return;
        seen = now;
        if (seen) startSeen(); else stopSeen();
    }

    function startSeen() {
        const ac = new AbortController();
        const opt = { signal: ac.signal };
        seenOffs.push(() => ac.abort());
        const B = androidBridge();
        if (B) {
            root.addEventListener('androidaudiosessions', (ev) => { android = parse(ev && ev.detail) || android; schedulePaint(); }, opt);
            root.addEventListener('androidaudiometers', (ev) => { const d = parse(ev && ev.detail); if (d && d.device !== undefined) meterPush(d.device); }, opt);
            android = parse((() => { try { return B.sessions(); } catch (_) { return null; } })()) || android;
            // icons drawn at the size they show (32 CSS px at this window's density)
            try { B.watchSessions(true, Math.round(32 * (root.devicePixelRatio || 1))); } catch (_) { /* old app */ }
            seenOffs.push(() => { try { B.watchSessions(false, 0); } catch (_) { /* old app */ } });
        }
        const A = dreamosBridge();
        if (A) {
            root.addEventListener('dreamosaudiometer', (ev) => { const d = parse(ev && ev.detail); if (d && d.device !== undefined) meterPush(d.device); }, opt);
            Promise.resolve(A.streams(true)).catch(() => {});
            seenOffs.push(() => { Promise.resolve(A.streams(false)).catch(() => {}); });
        }
        if (stale) paint(); else schedulePaint();
        meterRun();
    }

    function stopSeen() {
        seenOffs.forEach((off) => { try { off(); } catch (_) { /* gone */ } });
        seenOffs = [];
        if (meter.raf) { root.cancelAnimationFrame(meter.raf); meter.raf = 0; }
        meter.last = 0;
    }

    /** What the window listens to while it is open (nothing once it closes). */
    function subscribe() {
        const ac = new AbortController();
        const opt = { signal: ac.signal };
        offs.push(() => ac.abort());
        if (appScopeSignal) appScopeSignal.addEventListener('abort', () => ac.abort(), { once: true, signal: ac.signal });
        const t = tv();
        if (t && typeof t.onChange === 'function') { const off = t.onChange(schedulePaint); if (typeof off === 'function') offs.push(off); }
        if (t && typeof t.onSourcesChange === 'function') offs.push(t.onSourcesChange(schedulePaint));
        const a = audio();
        if (a && typeof a.onChange === 'function') offs.push(a.onChange(schedulePaint));
        const ds = root.desktopSounds;
        if (ds && typeof ds.onMixerChange === 'function') offs.push(ds.onMixerChange(schedulePaint));
        // a sound or video element starts, stops or changes its level (media events do not bubble: captured)
        ['play', 'pause', 'ended', 'emptied', 'volumechange', 'loadeddata'].forEach((type) => doc.addEventListener(type, (ev) => {
            if (ev.target && /^(AUDIO|VIDEO)$/.test(ev.target.tagName)) schedulePaint();
        }, { capture: true, signal: ac.signal }));
        root.addEventListener('dreamosaudio', schedulePaint, opt);
        doc.addEventListener('visibilitychange', updateSeen, opt);
        root.addEventListener('melatonscreen', updateSeen, opt);
        // minimized / restored: the window's own class
        const mo = new MutationObserver(updateSeen);
        mo.observe(win, { attributes: true, attributeFilter: ['class'] });
        offs.push(() => mo.disconnect());
        root.addEventListener('pagehide', () => stopSeen(), opt);
    }

    function unsubscribe() {
        stopSeen();
        seen = false;
        offs.forEach((off) => { try { off(); } catch (_) { /* gone */ } });
        offs = [];
    }

    function open() {
        if (!doc || typeof root.desktopAppCreateWindow !== 'function') return null;
        if (win && win.isConnected) {
            if (win.classList.contains('minimised')) call('restoreMinimizedModal', win, call('getOrCreateTaskbarItem', win) || null);
            call('bringModalToFront', win);
            paint();
            return win;
        }
        win = build();
        cols = new Map();
        android = null;
        sizeUntil = Date.now() + 2000;
        paint();
        const width = parseInt(win.dataset.windowDefaultWidth, 10) || (16 + 124 + 8 + COL + 11);
        win.dataset.windowDefaultHeight = '367';
        // opened by the tray each time: always beside it, never where it was last
        win.dataset.windowRestoreSize = 'false';
        win.dataset.windowMinWidth = String(16 + 124 + 8 + COL + 11);
        win.dataset.windowMinHeight = '367';
        win.dataset.windowMaxHeight = '367';
        win.style.width = `${width}px`;
        win.style.height = '367px';
        subscribe();
        call('openModal', win);
        win.classList.remove('hidden');
        root.requestAnimationFrame(() => {
            if (!win) return;
            place();
            const first = win.querySelector('.sndvol-col-device .sndvol-slider');
            if (first) first.focus({ preventScroll: true });
            updateSeen();
        });
        if (root.programFaults && root.programFaults.registerProgram) {
            root.programFaults.registerProgram(win.id, { name: TITLE, terminate: close, relaunch: open });
        }
        return win;
    }

    function close() {
        if (!win) return;
        const m = win;
        win = null;
        unsubscribe();
        cols = new Map();
        sessions = [];
        if (root.programFaults && root.programFaults.unregisterProgram) root.programFaults.unregisterProgram(m.id);
        Promise.resolve(call('closeModal', m)).finally(() => setTimeout(() => m.remove(), 300));
    }

    if (appScopeSignal) appScopeSignal.addEventListener('abort', () => { unsubscribe(); if (win) { win.remove(); win = null; } }, { once: true });

    root.melatonVolumeMixer = { open, close, _test: { posOf, readSessions, apply: (k, v) => apply(k, v, false) } };
})(typeof window !== 'undefined' ? window : globalThis);
