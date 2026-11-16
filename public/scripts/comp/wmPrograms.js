/**
 * Melaton Mobile: Programs and Settings (Windows Mobile 6.1 Professional), Yozora #709.
 * public/css/wm-programs.css draws them; wmShell.js hosts them (registerApp).
 *
 * Programs: WM's icon grid of the phone's programs (the shell's apps) and the Dreamscape desktop
 * apps that have no phone version yet (modalUtils.js startMenuLaunchables; they keep their own
 * name and icon; a desktop app that has a stock WM counterpart on the phone is listed as that).
 * Games is a folder, as on the device.
 *
 * Settings: Personal / System / Connections grids and WM settings pages (section header, controls,
 * tabs at the bottom, ok in the title bar). Pages are real where Dreamscape has the data.
 * More pages come from wmSettings<Group>.js through window.wmSettings.registerPage / extendPage,
 * drawn with window.wmSettings.ui (the page registry, below PAGES).
 *
 * Settings stored in localStorage (the shell reads them; wmSettingsChange { detail: { keys } } on
 * document after each ok):
 *   wmScale            '1' | '1.25' | '1.5' | '1.75' | '2'  (--wm-px; absent = the CSS default)
 *   wmTitleBar         'flat' | 'glossy'                      (absent = flat; html[data-wm-titlebar])
 *   wmTodayUseDesktop  '1' | '0'   (absent: '0' when wmTodayBackground is set, else '1')
 *   wmTodayBackground  same-site preview path ('/previews/...'), written by Pictures and here
 *   wmTodayWallSource  'workspace' | 'selected' | 'android' (this device only; #799: Android's wallpaper behind Today)
 *   wmTodayItems       JSON [{ id, on }] in display order; ids = Today's data-row values
 *                      (6.5 keeps its own list in wmTodayItems65)
 *   wmStartMenu        JSON [appId] shown in the Start menu (absent = the apps' own inStart)
 *   wmStartSource      'wm' | 'flag' | 'desktop' | 'custom'  (absent = wm: "Start" + Melaton emblem;
 *                      flag = "Start" + WM 6.1's own Windows flag, opt-in at Yukimi's request)
 *   wmStartText        string (the resolved text, also for 'desktop')
 *   wmStartIcon        same-site image path (the resolved icon, also for 'desktop')
 * window.wmSettings.startButton() resolves the Start text and icon live (desktop values change).
 */
(function () {
    'use strict';

    if (window.uiShell !== 'mobile') return;
    const root = document.documentElement;

    const K = {
        scale: 'wmScale',
        titleBar: 'wmTitleBar',
        todayUseDesktop: 'wmTodayUseDesktop',
        todayBackground: 'wmTodayBackground',
        todayWallSource: 'wmTodayWallSource',
        // 6.5 has a list of its own (the clock sits in the middle of its home screen)
        todayItems: root.dataset.wmVersion === '6.5' ? 'wmTodayItems65' : 'wmTodayItems',
        // 6.5 Today > Items > "Today timeout": { on, hours }; stored only, nothing reads it yet
        todayTimeout: 'wmTodayTimeout',
        // 6.5 Today > Effects > Parallax Effect: the picture, zoomed in slightly, follows the list (wmTitanium.js)
        todayParallax: 'wmTodayParallax',
        // ... and how far it moves: 1 (slight) - 10 (a lot), 4 = the first build's 8 % zoom
        todayParallaxLevel: 'wmTodayParallaxLevel',
        // ... and the other effects, { name: false } for each one switched off (all on by default)
        todayFx: 'wmTodayFx',
        startMenu: 'wmStartMenu',
        startSource: 'wmStartSource',
        startText: 'wmStartText',
        startIcon: 'wmStartIcon',
        camera: 'wmCamera',
        cameraPortraitOnly: 'wmCameraPortraitOnly',
        // Settings > Screen > Bezel: the title bar grows down to the camera's lower edge (#777)
        cameraExtend: 'wmCameraExtendBar',
        // ... and the soft-key bar's background reaches under Android's gesture bar (#795)
        softkeyExtend: 'wmSoftkeyExtend',
        // ... and status icons never cross the camera in the title bar: they fold into the notification group
        statusNoCross: 'wmStatusNoCross',
        // Settings > Today > Appearance > Rotation: Today turns with the phone (a foldable: per screen)
        homeRotate: 'wmHomeRotate',
        homeRotateCover: 'wmHomeRotateCover',
        homeRotateMain: 'wmHomeRotateMain',
        showBluetoothIcon: 'wmShowBluetoothIcon',
        showCellIcon: 'wmShowCellIcon',
        bezelLogoOpacity: 'wmBezelLogoOpacity',
        bezelLogoSize: 'wmBezelLogoSize',
        bezelLogoPos: 'wmBezelLogoPos',
        bezelModelShow: 'wmBezelModelShow',
        bezelModel: 'wmBezelModel',
        bezelModelPos: 'wmBezelModelPos',
        bezelModelSize: 'wmBezelModelSize',
        bezelLed: 'wmBezelLed',
        bezelLedNotify: 'wmBezelLedNotify',
        bezelLedBattery: 'wmBezelLedBattery',
        bezelLedCharge: 'wmBezelLedCharge',
        version: 'wmVersion',
        bars651: 'wmBars651'
    };
    // The UI version this page runs (app.html sets html[data-wm-version] before the first paint)
    // and the one stored for the next start: Melaton Update > Version changes the stored one.
    // 6.5.1 (#850): 6.5 with the Windows Mobile 6.5.3 changes Yukimi chose. It RUNS as version 6.5
    // (data-wm-version="6.5", wmShell.version '6.5') with data-wm-rev="6.5.1" on top, so
    // runningVersion() stays '6.5' for every 6.5 branch; runningRelease() tells the two apart.
    const VERSIONS = [['6.1', 'Melaton Mobile 6.1'], ['6.5', 'Melaton Mobile 6.5'], ['6.5.1', 'Melaton Mobile 6.5.1']];
    const runningVersion = () => (root.dataset.wmVersion === '6.5' ? '6.5' : '6.1');
    const runningRelease = () => (root.dataset.wmRev === '6.5.1' ? '6.5.1' : runningVersion());
    const SCALES = [1, 1.25, 1.5, 1.75, 2];
    // Settings > Screen > Bezel: logo height and model text size, in % of the band (wmShell syncBezel)
    const BEZEL_LOGO_SIZES = [40, 50, 60, 70, 80, 90, 100];
    const BEZEL_MODEL_SIZES = [20, 25, 30, 35, 40, 45, 50];
    // The Start mark stands for the title bar flag: 6.1's is the glossy colour flag (shellres icon
    // 4609), so the emblem carries its four colours there (wm61/start-melaton, drawn in the flag's
    // cell: wmShell.js EMBLEM61); 6.5's flag is white, so the one-colour emblem stays
    const MELATON_EMBLEM = runningVersion() === '6.5'
        ? '/static_images/melaton/melaton-white-256.png'
        : '/static_images/wm61/start-melaton@4x.png';
    // WM 6.1's colour Start flag (shellres.192 icon 4609); a user-chosen exception to the copyright
    // rule's emblem mapping, never the default
    const WM_FLAG = '/static_images/wm61/start-flag.png';
    const WM_FLAG_SRCSET = '/static_images/wm61/start-flag.png 1x, /static_images/wm61/start-flag@2x.png 2x, /static_images/wm61/start-flag@4x.png 4x';

    const lsGet = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
    const lsSet = (k, v) => {
        try {
            if (v == null) localStorage.removeItem(k);
            else localStorage.setItem(k, String(v));
        } catch (_) { /* storage off */ }
    };
    const lsJson = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (_) { return null; } };
    const changed = (keys) => document.dispatchEvent(new CustomEvent('wmSettingsChange', { detail: { keys } }));
    const sameSite = (p) => typeof p === 'string' && /^\/[^/]/.test(p);

    // ---------------------------------------------------------------- applied at load

    /**
     * The text size is kept per screen (Yukimi, Nov 11 2026): a phone-width screen (the Fold's
     * cover screen, any phone) keeps wmScale, a wider one (the Fold opened, a tablet) has its own
     * wmScaleMain. Folding or unfolding switches between them live (watchScaleScreen).
     */
    const SCALE_WIDE_MIN = 600;
    const wideScreen = () => (window.innerWidth || 0) >= SCALE_WIDE_MIN;
    const scaleKey = () => (wideScreen() ? `${K.scale}Main` : K.scale);

    function storedScale() {
        const v = Number(lsGet(scaleKey()));
        return SCALES.includes(v) ? v : null;
    }

    function applyScale() {
        const s = storedScale();
        if (s) root.style.setProperty('--wm-px', `${s}px`);
        else root.style.removeProperty('--wm-px');
    }

    function currentScale() {
        const v = parseFloat(getComputedStyle(root).getPropertyValue('--wm-px')) || 1;
        return SCALES.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a), SCALES[0]);
    }

    function titleBarStyle() {
        return lsGet(K.titleBar) === 'glossy' ? 'glossy' : 'flat';
    }

    function applyTitleBar() {
        root.dataset.wmTitlebar = titleBarStyle();
    }

    // Settings > Screen > Camera (#735): keep the title bar clear of the camera, or a black bezel above the screen
    function cameraStyle() {
        return lsGet(K.camera) === 'bezel' ? 'bezel' : 'clear';
    }

    function applyCamera() {
        root.dataset.wmCamera = cameraStyle();
    }

    // ---- home screen rotation (Yukimi, Nov 13): while the home screen (Today) shows, the Android app
    // locks the screen upright unless rotation is on for this screen; a foldable keeps one choice for
    // its cover screen and one for its main screen (AndroidDisplay.getScreenInfo: foldable, screen).
    // Elsewhere the app turns as Android decides. Defaults: off on a phone and a cover screen, on on
    // the main screen.
    function screenInfo() {
        try {
            const D = window.AndroidDisplay;
            if (D && typeof D.getScreenInfo === 'function') return JSON.parse(D.getScreenInfo());
        } catch (_) { /* older app */ }
        return null;
    }

    function homeRotateAllowed(info = screenInfo()) {
        const on = (k, def) => { const v = lsGet(k); return v === '1' ? true : v === '0' ? false : def; };
        if (info && info.foldable) return info.screen === 'main' ? on(K.homeRotateMain, true) : on(K.homeRotateCover, false);
        return on(K.homeRotate, false);
    }

    // Yukimi, Nov 14 (#827): the setting covers the home screen's company too, the Start menu (6.1),
    // the Start screen (6.5) and Settings; and the phone stays upright until Melaton Mobile has fully
    // started (the app locks it from its first frame; the boot's end, data-wm-boot="done", lets it go)
    const HOME_ROTATION_APPS = new Set(['today', 'start', 'settings']);
    let shellReadySeen = !!(window.wmShell && document.querySelector('.wm-titlebar'));
    document.addEventListener('wmShellReady', () => { shellReadySeen = true; }, { once: true });
    let rotationLocked = null;
    function applyHomeRotation() {
        const D = window.AndroidDisplay;
        if (!D || typeof D.setRotationLock !== 'function') return;
        // no boot state yet (this file loads before the shell starts): still starting, until the shell is ready
        const booting = root.dataset.wmBoot ? root.dataset.wmBoot !== 'done' : !shellReadySeen;
        const startOpen = !!document.querySelector('.wm-titlebar.is-start-open');
        const home = HOME_ROTATION_APPS.has(root.dataset.wmApp) || startOpen;
        const lock = booting || (home && !homeRotateAllowed());
        if (lock === rotationLocked) return;
        rotationLocked = lock;
        try { D.setRotationLock(lock); } catch (_) { /* older app */ }
    }
    // the app on screen (wmShell sets data-wm-app), the boot's end, the Start menu opening, and
    // folding / unfolding (the page resizes)
    new MutationObserver(applyHomeRotation).observe(root, { attributes: true, attributeFilter: ['data-wm-app', 'data-wm-boot'] });
    const watchStartMenu = () => {
        const bar = document.querySelector('.wm-titlebar');
        if (!bar) return false;
        new MutationObserver(applyHomeRotation).observe(bar, { attributes: true, attributeFilter: ['class'] });
        return true;
    };
    if (!watchStartMenu()) document.addEventListener('wmShellReady', () => { watchStartMenu(); applyHomeRotation(); }, { once: true });
    window.addEventListener('resize', () => { rotationLocked = null; applyHomeRotation(); });
    applyHomeRotation();

    // Settings > Screen > Bezel: Extend softkey background under gesture bar (wm-shell.css data-wm-softkey-extend)
    function applySoftkeyExtend() {
        if (lsGet(K.softkeyExtend) === '1') root.dataset.wmSoftkeyExtend = '1';
        else delete root.dataset.wmSoftkeyExtend;
    }

    /**
     * Settings > Screen > Bezel's preview (Yukimi, Nov 12, #777): the top of this phone drawn at its
     * real size and scaled into the page: the camera where Android reports it (a nominal punch hole
     * in a browser), then per mode Android's own status bar, the Windows title bar (grown to the
     * camera's lower edge with Extend), or the pseudo bezel with its logo; a copy of the real title
     * bar (theme, version, icons) and a strip of the page under it.
     */
    function drawBezelPreview(host, mode, d) {
        if (!host) return;
        const st = root.style;
        const v = (n) => parseFloat(st.getPropertyValue(n)) || 0;
        const W = window.innerWidth;
        const px = parseFloat(getComputedStyle(root).getPropertyValue('--wm-px')) || 1;
        let hole = { left: v('--camera-hole-left'), top: v('--camera-hole-top'), width: v('--camera-hole-width'), height: v('--camera-hole-height') };
        if (!(hole.width > 0 && hole.height > 0)) hole = { left: W / 2 - 6 * px, top: 4 * px, width: 12 * px, height: 12 * px };
        const barH = 26 * px;
        const holeBottom = hole.top + hole.height;
        let top = 0;
        let html = '';
        if (mode === 'android') {
            const h = Math.max(Math.ceil(holeBottom + 3 * px), Math.round(24 * px));
            html += `<div class="sbp-android" style="height:${h}px"><span>12:00</span><span>&#9650; &#9646;&#9646;&#9646; 100%</span></div>`;
            top = h;
        } else if (mode === 'bezel') {
            const band = Math.ceil(holeBottom + 6);
            html += `<div class="sbp-bezel" style="height:${band}px"></div>`;
            top = band;
        }
        const extend = mode === 'windows' && d.extend ? Math.max(0, Math.ceil(holeBottom + 2 * px - barH)) : 0;
        const H = top + barH + extend + 34 * px;
        html += `<div class="sbp-bar" style="top:${top}px;height:${barH + extend}px;padding-top:${extend}px"></div>`;
        html += `<div class="sbp-page" style="top:${top + barH + extend}px"><span></span><span></span></div>`;
        html += `<span class="sbp-hole" style="left:${hole.left}px;top:${hole.top}px;width:${hole.width}px;height:${hole.height}px"></span>`;
        const s = (host.clientWidth || W) / W;
        host.style.height = `${Math.round(H * s)}px`;
        host.innerHTML = `<div class="sbp-screen" style="width:${W}px;height:${H}px;transform:scale(${s})">${html}</div>`;
        // a copy of the title bar on screen now: its theme, version and icons
        const real = document.querySelector('#wmShell > .wm-titlebar, #wmShell .wm-titlebar');
        const slot = host.querySelector('.sbp-bar');
        if (real && slot) {
            const c = real.cloneNode(true);
            c.querySelectorAll('.wm-cutout-gap').forEach((g) => g.remove());
            c.querySelectorAll('.wm-status-left > *').forEach((i) => c.querySelector('.wm-status') && c.querySelector('.wm-status').prepend(i));
            c.querySelectorAll('.wm-status-left').forEach((g) => g.remove());
            c.querySelectorAll('[style]').forEach((x) => x.removeAttribute('style'));
            c.querySelectorAll('[id]').forEach((x) => x.removeAttribute('id'));
            c.style.height = `${barH}px`;
            slot.appendChild(c);
        }
    }

    // Settings > Screen > Full Screen (#735): the Android app hides its status bar and/or gesture bar
    function systemBars() {
        const app = window.AndroidDisplay;
        if (!app || typeof app.getSystemBars !== 'function') return null;
        try {
            const v = JSON.parse(app.getSystemBars());
            return { hideStatus: v.hideStatus !== false, hideNavigation: v.hideNavigation === true };
        } catch (_) { return null; }
    }

    applyScale();
    // the screen the page is on changed class (folded / unfolded): that screen's own text size
    // wmScreensSeen: the classes this device has shown the page on ('cover' / 'main'), so the
    // Screen page names the two screens only on a device that has both (a foldable)
    const noteScreen = () => {
        const seen = new Set(String(lsGet('wmScreensSeen') || '').split(',').filter(Boolean));
        const now = wideScreen() ? 'main' : 'cover';
        if (!seen.has(now)) { seen.add(now); lsSet('wmScreensSeen', [...seen].join(',')); }
        return seen.size > 1;
    };
    (function watchScaleScreen() {
        let last = scaleKey();
        noteScreen();
        window.addEventListener('resize', () => {
            const k = scaleKey();
            if (k === last) return;
            last = k;
            noteScreen();
            applyScale();
            changed([k]);
        });
    })();
    applyTitleBar();
    applyCamera();
    applySoftkeyExtend();

    function todayUsesDesktop() {
        const v = lsGet(K.todayUseDesktop);
        if (v === '1' || v === '0') return v === '1';
        return !lsGet(K.todayBackground);
    }

    // Start button: WM's own ("Start", Melaton emblem), "Start" with the Windows flag, the desktop's
    // (its server-side Taskbar and Start Menu Properties start button), or custom text and icon
    function desktopStartButton() {
        let text = '';
        let icon = '';
        try {
            /* global readDesktopSettingsStartMenuButtonPreference, resolveStartMenuButtonDisplayText, startMenuButtonLogoUrl */
            if (typeof readDesktopSettingsStartMenuButtonPreference === 'function') {
                const p = readDesktopSettingsStartMenuButtonPreference();
                text = resolveStartMenuButtonDisplayText(p.preset, p.customText);
                // the Windows logos (royal / vista) stay on the desktop: the phone shows Melaton's
                icon = p.logo === 'dreamscape' ? startMenuButtonLogoUrl('dreamscape') : MELATON_EMBLEM;
            }
        } catch (_) { /* desktop settings not loaded */ }
        return { text: text || 'Start', icon: icon || MELATON_EMBLEM };
    }

    function startButton() {
        const src = lsGet(K.startSource);
        if (src === 'desktop') return { source: 'desktop', ...desktopStartButton() };
        if (src === 'custom') {
            const icon = lsGet(K.startIcon);
            return { source: 'custom', text: (lsGet(K.startText) || '').trim() || 'Start', icon: sameSite(icon) ? icon : MELATON_EMBLEM };
        }
        if (src === 'flag') return { source: 'flag', text: 'Start', icon: WM_FLAG };
        return { source: 'wm', text: 'Start', icon: MELATON_EMBLEM };
    }

    const storedVersion = () => { const v = lsGet(K.version); return v === '6.5' || v === '6.5.1' ? v : '6.1'; };

    window.wmSettings = { keys: K, startButton, todayUsesDesktop, titleBarStyle, cameraStyle, applyScale, scales: SCALES, versions: VERSIONS, version: runningVersion, release: runningRelease, storedVersion, bottomBars: () => root.dataset.wmBars === 'bottom', storedBottomBars: () => lsGet(K.bars651) === 'bottom' };

    // ---------------------------------------------------------------- helpers

    let sh = null; // window.wmShell
    let manifest = null; // wm61 art names, for the 32 px (-lg) versions of the shell's icons
    const esc = (s) => sh.escapeHtml(s);

    function loadManifest() {
        if (manifest) return Promise.resolve(manifest);
        return fetch('/static_images/wm61/manifest.json', { credentials: 'same-origin' })
            .then((r) => (r.ok ? r.json() : null))
            .then((m) => { manifest = (m && m.items) || {}; return manifest; })
            .catch(() => { manifest = {}; return manifest; });
    }

    /** 32 px art for a shell icon name: its -lg pair when the ROM has one. */
    function wmLargeIcon(name) {
        // a Program Icons set (#773) has its own -lg frames
        if (sh.art.isSet && sh.art.isSet(name)) return { src: sh.art.url(`${name}-lg`), srcset: sh.art.srcset(`${name}-lg`) };
        if (String(name).startsWith('/')) return { src: name, srcset: '' };
        const n = manifest && manifest[`${name}-lg`] ? `${name}-lg` : name;
        return { src: sh.art.url(n), srcset: sh.art.srcset(n) };
    }

    /** A Dreamscape app icon at 32 px (compiled sizes, modules/appIconRuntimeAssets.js). */
    function appIcon(imageIcon) {
        try {
            /* global resolveAppIconPath */
            if (typeof resolveAppIconPath === 'function') {
                const p = (n) => resolveAppIconPath(imageIcon, n);
                return { src: p(32), srcset: `${p(32)} 1x, ${p(64)} 2x, ${p(96)} 3x` };
            }
        } catch (_) { /* fall through */ }
        const src = `/static_images/app_icons/${imageIcon}`;
        return { src, srcset: '' };
    }

    function iconCell(item, extra = '') {
        const ic = item.img;
        return `<button type="button" class="wm-icongrid-cell" data-key="${esc(item.key)}" ${extra}>
            <span class="wm-icongrid-icon" style="--wm-icon-mask:url('${esc(ic.src)}')"><img src="${esc(ic.src)}"${ic.srcset ? ` srcset="${esc(ic.srcset)}"` : ''} alt="" draggable="false" loading="lazy"></span>
            <span class="wm-icongrid-label"><span>${esc(item.label)}</span></span>
        </button>`;
    }

    /** WM's tap on a grid item: the item is selected (highlight), then opens. */
    function bindGrid(box, onOpen) {
        box.addEventListener('click', (e) => {
            const cell = e.target.closest('.wm-icongrid-cell');
            if (!cell) return;
            box.querySelectorAll('.wm-icongrid-cell.is-selected').forEach((c) => c.classList.remove('is-selected'));
            cell.classList.add('is-selected');
            // the highlight and the wait cursor paint together, then the item opens: a slow open
            // (a Settings page that reads the phone's programs, a first mount) shows at once that
            // the tap was taken (Yukimi, Nov 12)
            sh.busy(() => onOpen(cell.dataset.key), { paint: true, timeout: 15000 });
        });
    }

    function tabsHtml(tabs, current) {
        return `<div class="wm-tabs" role="tablist">${tabs.map(([id, label]) => `<button type="button" class="wm-tab" role="tab" data-tab="${esc(id)}" aria-selected="${id === current}">${esc(label)}</button>`).join('')}</div>`;
    }

    /**
     * More tabs than fit: both devices put left / right buttons at the right end of the strip and
     * scroll by exactly one tab per press, on pen down, with no animation; neither scrolls by a
     * finger drag, neither has a disabled look at the ends, neither keeps the selected tab in view.
     * `state.first` is the first tab shown.
     *   6.1 (Windows Media > Options, six tabs): a spin button 31 x 16.5 units; only whole tabs
     *       are drawn, the ones that do not fit before the button are absent, not cut.
     *   6.5 (a nine-tab test form on the emulator): two buttons 13 x 12.5 units; the strip's left
     *       edge is always a tab boundary and the last visible tab is cut by the buttons; a press
     *       held repeats after 575 ms every 170 ms; a tap on the cut tab selects it and scrolls
     *       one tab so it is whole.
     */
    // ---- 6.5.1 (#850) pivot: Windows Mobile 6.5.3 has no tab row at the bottom of a tabbed page.
    // A dark band under the title bar (ToolbarWindow32 "Pivot", 480 x 64 device px) names the
    // current page in bold between two arrows, with the page before and the page after in plain
    // text at either side. Measured on the 6.5.3 emulator (Settings: About, Power, Memory,
    // Backlight, Buttons, Sounds & Notifications ...):
    //   - the pages go round: the first page has the last one at its left; with two pages the
    //     same name stands at both sides;
    //   - a tap on an arrow or on a side name changes the page on pen up (no pressed look, no
    //     repeat while held); a tap on the current name does nothing;
    //   - a quick sideways stroke on the band OR on the page changes it (right to left = next).
    //     It is a flick, judged at pen up: 60 px in 100 ms and 80 px in 300 ms change the page,
    //     60 px in 300 ms, 200 px in 900 ms and a fast stroke that rests before pen up do not
    //     (about 0.25 device px / ms = 0.125 units / ms at release); a diagonal stroke does not;
    //   - the change is drawn at once, band and page together: nothing slides (no frame between
    //     the two states at 17 ms a grab).
    // The program's own .wm-tab buttons stay in the strip (not drawn) and are clicked for it, so
    // every program's tab code works as it is. A strip that never reaches fitTabs is picked up
    // by the animationstart of wm65.css's `wm651-pivot-seen` when it is first drawn.
    const pivotOn = () => document.documentElement.dataset.wmRev === '6.5.1';
    const pivotTabsOf = (strip) => [...strip.querySelectorAll('.wm-tab')].filter((t) => !t.disabled && t.getAttribute('aria-disabled') !== 'true');
    const pivotIsCurrent = (t) => t.getAttribute('aria-selected') === 'true' || t.classList.contains('is-selected');

    /** The tab `dir` steps from the current one, going round; null with one tab or none. */
    function pivotNeighbour(strip, dir) {
        const tabs = pivotTabsOf(strip);
        if (tabs.length < 2) return null;
        const i = Math.max(0, tabs.findIndex(pivotIsCurrent));
        return tabs[(i + dir + tabs.length) % tabs.length];
    }

    function pivotGo(strip, dir) {
        const t = pivotNeighbour(strip, dir);
        if (t) t.click();
    }

    function pivotDraw(strip) {
        const band = strip.querySelector(':scope > .wm-pivot');
        if (!band) return;
        const all = [...strip.querySelectorAll('.wm-tab')];
        const cur = all.find(pivotIsCurrent) || all[0];
        const prev = pivotNeighbour(strip, -1);
        const next = pivotNeighbour(strip, 1);
        const label = (t) => (t ? t.textContent.trim() : '');
        const set = (sel, text) => { const el = band.querySelector(sel); if (el.textContent !== text) el.textContent = text; };
        set('.wm-pivot-cur', label(cur));
        set('.wm-pivot-side[data-dir="-1"] > span', label(prev));
        set('.wm-pivot-side[data-dir="1"] > span', label(next));
        const single = !prev;
        if (band.classList.contains('is-single') !== single) band.classList.toggle('is-single', single);
    }

    /** A flick on the band or the page (touch only): judged at the end of the stroke. */
    function pivotFlick(host) {
        if (host.wmPivotFlick) return;
        host.wmPivotFlick = true;
        let track = null;
        // capture: scroll areas and some controls stop their touch events on the way up
        const flickOpts = { passive: true, capture: true };
        const stripNow = () => host.querySelector(':scope > .wm-tabs.wm-pivot-on');
        host.addEventListener('touchstart', (e) => {
            track = null;
            if (e.touches.length !== 1 || !stripNow()) return;
            // not from a control with a sideways drag of its own, nor from text being edited
            for (let n = e.target; n && n !== host; n = n.parentElement) {
                if (n.matches('input, textarea, select, canvas, [contenteditable="true"], [role="slider"], .wm-trackbar, [data-no-pivot-flick]')) return;
                if (n.scrollWidth > n.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(n).overflowX)) return;
            }
            const p = e.touches[0];
            track = [{ x: p.clientX, y: p.clientY, t: e.timeStamp }];
        }, flickOpts);
        host.addEventListener('touchmove', (e) => {
            if (!track) return;
            if (e.touches.length !== 1) { track = null; return; }
            const p = e.touches[0];
            track.push({ x: p.clientX, y: p.clientY, t: e.timeStamp });
            if (track.length > 24) track.splice(1, track.length - 24);
        }, flickOpts);
        host.addEventListener('touchcancel', () => { track = null; }, flickOpts);
        host.addEventListener('touchend', (e) => {
            const tr = track;
            track = null;
            const strip = stripNow();
            if (!tr || tr.length < 2 || !strip) return;
            const unit = parseFloat(getComputedStyle(host).getPropertyValue('--wm-px')) || 1;
            const first = tr[0];
            const last = tr[tr.length - 1];
            const dx = last.x - first.x;
            const dy = last.y - first.y;
            // sideways (the device ignored a stroke of 150 across and 120 down), and far enough
            if (Math.abs(dx) < 20 * unit || Math.abs(dx) < 2 * Math.abs(dy)) return;
            // the speed over the last 100 ms before the finger left (a rest before lifting = none)
            const from = tr.find((s) => e.timeStamp - s.t <= 100) || last;
            const span = e.timeStamp - from.t;
            const v = span > 0 ? (last.x - from.x) / span : 0;
            if (Math.abs(v) < 0.125 * unit || Math.sign(v) !== Math.sign(dx)) return;
            pivotGo(strip, dx < 0 ? 1 : -1);
        }, flickOpts);
    }

    function pivotTabs(strip) {
        if (!strip || !strip.isConnected) return;
        let band = strip.querySelector(':scope > .wm-pivot');
        if (!band) {
            strip.querySelectorAll('.wm-tab').forEach((t) => { t.hidden = false; t.style.width = ''; });
            band = document.createElement('div');
            band.className = 'wm-pivot';
            band.innerHTML = '<button type="button" class="wm-pivot-side" data-dir="-1" tabindex="-1"><span></span></button>'
                + '<div class="wm-pivot-mid"><button type="button" class="wm-pivot-arrow" data-dir="-1" aria-label="Previous page"></button>'
                + '<span class="wm-pivot-cur"></span>'
                + '<button type="button" class="wm-pivot-arrow" data-dir="1" aria-label="Next page"></button></div>'
                + '<button type="button" class="wm-pivot-side" data-dir="1" tabindex="-1"><span></span></button>';
            band.addEventListener('click', (e) => {
                e.stopPropagation(); // the program's strip listener hears only the tab's own click
                const b = e.target.closest('[data-dir]');
                if (b) pivotGo(strip, Number(b.dataset.dir));
            });
            band.addEventListener('keydown', (e) => {
                const dir = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
                if (!dir) return;
                e.preventDefault();
                e.stopPropagation();
                pivotGo(strip, dir);
            });
            strip.insertBefore(band, strip.firstChild);
        }
        if (!strip.wmPivotWatch) {
            // a program that only flips aria-selected, or refills the strip, redraws the band
            strip.wmPivotWatch = new MutationObserver(() => {
                if (!strip.querySelector(':scope > .wm-pivot')) pivotTabs(strip);
                else pivotDraw(strip);
            });
            strip.wmPivotWatch.observe(strip, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-selected', 'class', 'disabled', 'aria-disabled'] });
        }
        strip.classList.add('wm-pivot-on');
        const host = strip.parentElement;
        if (host) {
            // the band stands for the page heading (the applet's name is in the title bar)
            const hdr = host.querySelector(':scope > .wm-form-hdr');
            if (hdr) hdr.classList.add('wm-pivot-hdr-off');
            pivotFlick(host);
        }
        pivotDraw(strip);
    }

    if (pivotOn()) {
        document.addEventListener('animationstart', (e) => {
            if (e.animationName === 'wm651-pivot-seen' && e.target.classList && e.target.classList.contains('wm-tabs')) pivotTabs(e.target);
        });
    }

    function fitTabs(strip, state) {
        if (!strip) return;
        // 6.5.1 (#850) pivot: no tab row, the band under the title bar
        if (pivotOn()) { pivotTabs(strip); return; }
        const v65 = runningVersion() === '6.5';
        const tabs = [...strip.querySelectorAll('.wm-tab')];
        let spin = strip.querySelector('.wm-tabs-spin');
        tabs.forEach((t) => { t.hidden = false; });
        if (spin) spin.hidden = true;
        // 6.5: a tab's width follows its label and is seldom a whole number of device pixels; its
        // blended edge column showed as a light hairline against the black strip and beside the
        // edge curves. Each tab is widened to the next whole device pixel
        if (v65) {
            const dpr = window.devicePixelRatio || 1;
            tabs.forEach((t) => { t.style.width = ''; });
            tabs.map((t) => t.getBoundingClientRect().width).forEach((w, i) => { tabs[i].style.width = `${Math.ceil(w * dpr - 0.01) / dpr}px`; });
        }
        const widths = tabs.map((t) => t.getBoundingClientRect().width);
        const total = widths.reduce((n, w) => n + w, 0);
        const width = strip.clientWidth;
        if (!tabs.length || total <= width + 0.5) { state.first = 0; return; }
        if (!spin) {
            spin = document.createElement('div');
            spin.className = 'wm-tabs-spin';
            spin.innerHTML = '<button type="button" data-dir="-1" aria-label="Previous tabs" tabindex="-1"></button><button type="button" data-dir="1" aria-label="More tabs" tabindex="-1"></button>';
            strip.appendChild(spin);
            spin.querySelectorAll('button').forEach((b) => {
                let wait = 0;
                let rep = 0;
                const step = () => { state.first = (state.first || 0) + Number(b.dataset.dir); fitTabs(strip, state); };
                const stop = () => { clearTimeout(wait); clearInterval(rep); wait = 0; rep = 0; };
                b.addEventListener('pointerdown', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    step();
                    stop();
                    if (v65) wait = setTimeout(() => { rep = setInterval(step, 170); }, 575);
                });
                ['pointerup', 'pointercancel', 'pointerleave'].forEach((n) => b.addEventListener(n, stop));
            });
            // a press must not reach the tab under the button
            spin.addEventListener('click', (e) => e.stopPropagation());
        }
        spin.hidden = false;
        const room = width - spin.getBoundingClientRect().width;
        // the last position still shows the last tab whole
        let maxFirst = tabs.length - 1;
        for (let f = 0, rest = total; f < tabs.length; rest -= widths[f], f++) { if (rest <= room + 0.5) { maxFirst = f; break; } }
        state.first = Math.max(0, Math.min(maxFirst, state.first || 0));
        let used = 0;
        tabs.forEach((t, i) => {
            if (i < state.first) { t.hidden = true; return; }
            const start = used;
            used += widths[i];
            if (!v65) { t.hidden = used > room + 0.5; return; }
            // 6.5 draws the tab the buttons cut; one that starts under them is not there at all
            t.hidden = start >= room;
            if (!t.hidden && used > room + 0.5 && !t.dataset.cutBound) {
                t.dataset.cutBound = '1';
                t.addEventListener('pointerdown', () => { if (t.getBoundingClientRect().right > strip.getBoundingClientRect().left + room + 0.5) state.first = (state.first || 0) + 1; });
            }
        });
    }

    /** A Settings layer changed: the shell's corner follows the app's titleKind(). */
    function refreshTitleKind() {
        if (sh && typeof sh.refreshTitleAction === 'function') sh.refreshTitleAction();
    }

    const fmtMB = (bytes) => {
        if (!Number.isFinite(bytes) || bytes < 0) return '\u2014';
        // WM prints MB with two decimals; a browser quota runs to hundreds of GB
        return bytes >= 10 * 1073741824 ? `${(bytes / 1073741824).toFixed(2)} GB` : `${(bytes / 1048576).toFixed(2)} MB`;
    };

    // ---- About > Version (#829): the phone's real processor, cores, RAM and storage cards (the Android
    // app's window.AndroidHardware report), else what the browser knows
    function aboutHardware() {
        const id = window.melatonDeviceIdentity;
        try { if (id && typeof id.hardware === 'function') return id.hardware(); } catch (_) { /* browser */ }
        return null;
    }

    /** Storage cards: the phone's storage that is not its internal memory (SD, USB, adopted). */
    function storageCards(hw) {
        const vols = hw && Array.isArray(hw.storage) ? hw.storage : [];
        return vols.filter((v) => v && v.kind !== 'internal' && !v.primary && (v.removable || v.kind === 'sd' || v.kind === 'usb' || v.kind === 'adopted') && (!v.state || /^mounted/.test(v.state)));
    }

    function aboutFacts(hw) {
        const soc = (hw && hw.soc) || {};
        const cpu = (hw && hw.cpu) || {};
        const mem = (hw && hw.memory) || {};
        const uad = navigator.userAgentData;
        const cores = cpu.cores || navigator.hardwareConcurrency || 0;
        const processor = soc.name || soc.model || (cores ? `${(uad && uad.platform) || navigator.platform || 'ARM'} processor` : 'Unknown');
        // "8 (1 + 3 + 4)": the clusters, fastest first, as the phone's makers count them
        const clusters = Array.isArray(cpu.clusters) ? cpu.clusters.filter((c) => c && c.cores > 0).sort((a, b) => (b.maxMHz || 0) - (a.maxMHz || 0)) : [];
        const top = cpu.maxMHz || (clusters[0] && clusters[0].maxMHz) || 0;
        let coreText = cores ? String(cores) : '';
        if (coreText && clusters.length > 1) coreText += ` (${clusters.map((c) => c.cores).join(' + ')})`;
        if (coreText && top) coreText += `, ${(top / 1000).toFixed(2)} GHz`;
        // WM's two decimals; a phone's gigabytes read as GB
        const memory = mem.totalBytes ? (mem.totalBytes >= 1073741824 ? `${(mem.totalBytes / 1073741824).toFixed(2)} GB` : fmtMB(mem.totalBytes)) : (navigator.deviceMemory ? `${navigator.deviceMemory} GB` : 'Unknown');
        return { processor, cores: hw ? coreText : (cores ? String(cores) : ''), memory, slot: storageCards(hw).length ? 'In use' : 'Not in use' };
    }

    function previewPath(item) {
        try {
            if (!item || !item.preview) return '';
            /* global getGalleryPreviewUrl */
            const p = typeof getGalleryPreviewUrl === 'function' ? getGalleryPreviewUrl(item.preview) : item.preview;
            return `/previews/${encodeURIComponent(p)}`;
        } catch (_) { return ''; }
    }

    /** Today's picture for a gallery item: the whole picture (wmShell.js), not the square preview. */
    function todayPictureFor(item) {
        try {
            return sh && sh.wallpaper && typeof sh.wallpaper.pictureFor === 'function' ? sh.wallpaper.pictureFor(item) : '';
        } catch (_) { return ''; }
    }

    function galleryItems(n) {
        let list = [];
        try {
            /* global allImages */
            if (Array.isArray(window.originalAllImages) && window.originalAllImages.length) list = window.originalAllImages;
            else if (typeof allImages !== 'undefined' && Array.isArray(allImages)) list = allImages;
        } catch (_) { /* gallery not loaded */ }
        return list.filter((it) => it && it.preview).slice(0, n);
    }

    // ---------------------------------------------------------------- Programs

    // desktop apps whose phone version is a stock WM program (Yukimi's mapping): listed as that
    // program when the shell has it, else as themselves
    const MAPPED = {
        workspace: ['gallery'],
        encyclopedia: ['ie', 'iexplore', 'browser', 'internet-explorer'],
        alchemy: ['ie', 'iexplore', 'browser', 'internet-explorer'],
        explorer: ['fileexplorer', 'file-explorer'],
        dovecote: ['messaging'],
        'planet-switcher': ['teleport'],
        notebook: ['notes'],
        notepad: ['notes'],
        contacts: ['contacts'],
        director: ['director'],
        studio: ['studio'],
        chat: ['chat'],
        presets: ['spellbook'],
        // AmusementVISION operator apps (wmPayPass.js, wmXLink.js)
        paypass: ['paypass-mobile'],
        xlink: ['xlink-mobile'],
        // Dreamscape suite phone apps (wmSpellcaster.js, wmPhasewalker.js, wmAtelier.js, wmExpanders.js, wmCharacters.js, wmEmotion.js)
        spellbook: ['spellcaster'],
        'bracket-generation': ['phasewalker'],
        naxt: ['atelier'],
        expanders: ['expanders'],
        'character-db': ['characters'],
        emotion: ['emotion'],
        reference: ['reference'],
        calculator: ['calculator'],
        calendar: ['calendar'],
        // Image Search (the desktop program and its old DSAP): the phone's Search Pictures (#831)
        ispy: ['search-pictures'],
        'image-search': ['search-pictures'],
        taskmgr: ['taskmgr'],
        'media-player': ['windows-media'],
        'remote-desktop': ['remote-desktop-mobile'],
        'remote-desktop-connection': ['remote-desktop-mobile']
    };
    // Toolbox programs that are desktop-only ideas (#732 plan): not offered on the phone
    const TOOLBOX_SKIP = new Set(['vista-sidebar', 'snipping', 'sideshow-simulator-landscape', 'sideshow-simulator-portrait', 'welcome-center', 'perfmon', 'memories']);
    // Yukimi, Nov 10: no lazy ports. A desktop program is offered on the phone only as a phone app of
    // its own (MAPPED) or a page the phone already shows well; the rest (Paint, Phasewalker, Atelier,
    // Runes ...) are not listed. Dreamscape apps (dsap:) open in Internet Explorer's mobile view.
    const PHONE_DIRECT = new Set(['data-management', 'ispy', 'control-panel', 'explore-gallery', 'novels', 'image-search']);
    // desktop programs whose phone version is a Settings page
    const SETTINGS_PAGE = { alarm: 'clock' };
    // Yukimi, Nov 10: no Toolbox folder; what belongs in Settings is there (WM 6.1 keeps Task
    // Manager under Settings > System). These apps and desktop programs leave Programs.
    const IN_SETTINGS_APPS = new Set(['taskmgr', 'accounts']);
    const IN_SETTINGS_DESKTOP = new Set(['alarm', 'control-panel', 'data-management', 'taskmgr']);
    // Programs folders (Yukimi, Nov 10): Games first, then the Dreamscape suite (a WM folder drawn
    // like Games'); everything else, the AmusementVISION operator apps too, sits in Programs itself
    const PROGRAM_FOLDERS = {
        dreamscape: { label: 'Dreamscape', icon: () => wmLargeIcon('app-folder-dreamscape') }
    };
    const FOLDER_ORDER = ['games', 'dreamscape'];
    // more folders from other files (wmSettings.addProgramFolder): shown once a program is filed in them
    const EXTRA_FOLDERS = new Set();
    // folders inside another folder (#805: the ones made in Android / Work): id -> parent id
    const FOLDER_PARENT = new Map();
    const FOLDER_GROUPS = new Map(); // setProgramFolders group -> its ids
    const DREAMSCAPE_APPS = new Set(['studio', 'director', 'spellcaster', 'phasewalker', 'atelier', 'reference', 'characters', 'expanders', 'spellbook', 'emotion', 'teleport', 'chat', 'search-pictures']);
    const DREAMSCAPE_DESKTOP = new Set(['explore-gallery', 'novels', 'ispy', 'image-search']);
    // WM 6.1 art for desktop entries the phone lists as they are (the dsap apps)
    const DESKTOP_WM_ART = { 'explore-gallery': 'app-agora', novels: 'app-novels', ispy: 'app-image-search', 'image-search': 'app-image-search', 'data-management': 'app-data-management', 'control-panel': 'app-control-panel', import: 'app-import' };
    // programsFolder 'games': a phone program that is a game (the Android ones, #773) sits in Games
    const appFolder = (a) => (a.programsFolder === 'games' ? 'games' : PROGRAM_FOLDERS[a.programsFolder] ? a.programsFolder : (DREAMSCAPE_APPS.has(a.id) ? 'dreamscape' : null));
    const desktopFolder = (l) => (DREAMSCAPE_DESKTOP.has(l.launchId) ? 'dreamscape' : null);

    // Settings grid items that open an app (not a Settings page)
    const SETTINGS_LINKS = [
        { id: 'link-taskmgr', tab: 'system', label: 'Task Manager', icon: 'app-task-manager', app: 'taskmgr' },
        // (#831: Server Manager's dashboard is retired, no phone version; Data Management's place is
        // System > Workspaces and Application Requests, wmSettingsSystem.js)
        { id: 'link-accounts', tab: 'personal', label: 'Accounts', icon: 'app-accounts', app: 'accounts' },
        // Wallet (#874): cards, barcodes and car keys for Today; a Personal setting, not a program
        { id: 'link-wallet', tab: 'personal', label: 'Wallet', icon: 'app-wallet', app: 'wallet' }
    ];
    const SHELL_ONLY = new Set(['today', 'programs', 'settings', 'help']);

    function desktopLaunchables(list) {
        try {
            /* global startMenuLaunchables, startMenuGameLaunchables */
            if (list === 'games') return typeof startMenuGameLaunchables !== 'undefined' ? startMenuGameLaunchables : [];
            if (list === 'toolbox') {
                /* global buildToolsSubmenuItems, isStartMenuEntryEnabled */
                if (typeof buildToolsSubmenuItems !== 'function') return [];
                return buildToolsSubmenuItems().filter((t) => t && !t.separator && !t.hasSubmenu && typeof t.action === 'function'
                    && !TOOLBOX_SKIP.has(t.launchId) && (typeof isStartMenuEntryEnabled !== 'function' || isStartMenuEntryEnabled(t)));
            }
            return typeof startMenuLaunchables !== 'undefined' ? startMenuLaunchables : [];
        } catch (_) { return []; }
    }

    function programItems(folder) {
        const shellApps = sh.listApps();
        const have = new Set(shellApps.map((a) => a.id));
        const items = [];
        const desktopItem = (l) => {
            if (!l || !l.launchId || !l.text || !l.imageIcon) return;
            const mapped = MAPPED[l.launchId];
            if (mapped && mapped.some((id) => have.has(id))) return;
            if (IN_SETTINGS_DESKTOP.has(l.launchId)) return;
            if (!PHONE_DIRECT.has(l.launchId) && !(l.dsap || /^dsap/i.test(String(l.url || '')))) return;
            if ((desktopFolder(l) || null) !== (folder || null)) return;
            const art = DESKTOP_WM_ART[l.launchId];
            items.push({ key: `d:${l.launchId}`, label: l.text, img: art ? wmLargeIcon(art) : appIcon(l.imageIcon), desktop: l.text, launch: l });
        };
        // phone apps filed in a Programs folder (registerApp programsFolder: 'toolbox')
        const folderApps = (f) => shellApps.filter((a) => a.inStart && appFolder(a) === f && !SHELL_ONLY.has(a.id) && !IN_SETTINGS_APPS.has(a.id))
            .forEach((a) => items.push({ key: `a:${a.id}`, label: a.startLabel || a.title || a.id, img: wmLargeIcon(a.icon || 'app-programs') }));
        if (folder === 'games') {
            // only the phone's own games (#786: Solitaire, Minesweeper, Block Drop, Brick Breaker,
            // InkBall and the Android ones); the desktop's other games are not listed on the phone
            folderApps('games');
        } else if (PROGRAM_FOLDERS[folder]) {
            // folders made inside this one (#805), shown even while empty
            for (const [cid, parent] of FOLDER_PARENT) {
                if (parent === folder && PROGRAM_FOLDERS[cid]) items.push({ key: `folder:${cid}`, label: PROGRAM_FOLDERS[cid].label, img: PROGRAM_FOLDERS[cid].icon(), folder: cid });
            }
            folderApps(folder);
            desktopLaunchables().forEach(desktopItem);
            desktopLaunchables('toolbox').forEach(desktopItem);
        } else {
            const phoneGames = shellApps.some((a) => a.inStart && appFolder(a) === 'games');
            if (phoneGames) items.push({ key: 'folder:games', label: 'Games', img: wmLargeIcon('app-games'), folder: 'games' });
            for (const [id, f] of Object.entries(PROGRAM_FOLDERS)) {
                if (FOLDER_PARENT.has(id)) continue; // listed inside its parent
                if (EXTRA_FOLDERS.has(id) && !shellApps.some((a) => a.inStart && (appFolder(a) === id || FOLDER_PARENT.get(appFolder(a)) === id))) continue;
                items.push({ key: `folder:${id}`, label: f.label, img: f.icon(), folder: id });
            }
            // no Toolbox folder: its programs sit here with the rest
            for (const a of shellApps) {
                if (!a.inStart || SHELL_ONLY.has(a.id) || IN_SETTINGS_APPS.has(a.id) || appFolder(a)) continue;
                items.push({ key: `a:${a.id}`, label: a.startLabel || a.title || a.id, img: wmLargeIcon(a.icon || 'app-programs') });
            }
            desktopLaunchables().forEach(desktopItem);
            desktopLaunchables('toolbox').forEach(desktopItem);
        }
        const coll = new Intl.Collator(undefined, { sensitivity: 'base' });
        const rank = (it) => (it.folder ? FOLDER_ORDER.indexOf(it.folder) : FOLDER_ORDER.length);
        return items.sort((x, y) => rank(x) - rank(y) || coll.compare(x.label, y.label));
    }

    function registerPrograms() {
        let page = null;
        let folder = null; // 'games' while the Games folder is open
        let byKey = new Map();
        let onAppsChanged = null;

        function render() {
            if (!page) return;
            const items = programItems(folder);
            byKey = new Map(items.map((i) => [i.key, i]));
            const box = page.querySelector('.wm-icongrid');
            box.innerHTML = items.map((i) => iconCell(i)).join('');
            page.querySelector('.wm-pg-scroll').scrollTop = 0;
            if (sh.current === 'programs') sh.setTitle(folder === 'games' ? 'Games' : PROGRAM_FOLDERS[folder] ? PROGRAM_FOLDERS[folder].label : 'Programs');
        }

        function openItem(key) {
            const item = byKey.get(key);
            if (!item) return;
            if (item.folder) {
                folder = item.folder;
                render();
                sh.syncHistory();
                return;
            }
            if (key.startsWith('a:')) {
                sh.open(key.slice(2));
                return;
            }
            page.querySelectorAll('.wm-icongrid-cell.is-selected').forEach((c) => c.classList.remove('is-selected'));
            if (item.settings && window.wmSettings && typeof window.wmSettings.open === 'function') {
                window.wmSettings.open(item.settings, null, { direct: true });
                return;
            }
            // a Dreamscape app page: its own route (Internet Explorer's mobile view), under the wait cursor
            if (item.launch) { sh.busy(() => item.launch.action(), { paint: true, timeout: 15000 }); return; }
            sh.notify({ title: item.desktop, icon: 'info', text: `${item.desktop} is not available on Melaton Mobile yet.` });
        }

        sh.registerApp({
            id: 'programs',
            title: 'Programs',
            icon: 'app-programs',
            inStart: 'system',
            sip: true,
            mount(p) {
                page = p;
                page.classList.add('wm-pg');
                page.innerHTML = '<div class="wm-pg-scroll"><div class="wm-icongrid" role="list"></div></div>';
                const grid = page.querySelector('.wm-icongrid');
                bindGrid(grid, openItem);
                // tap-and-hold on a program that has a menu of its own (the Android programs: Add to
                // Start, Move to Games, Hide, Program Info, End Task, Remove; #773)
                grid.addEventListener('contextmenu', (e) => {
                    const cell = e.target.closest('.wm-icongrid-cell');
                    e.preventDefault();
                    if (!cell) return;
                    const key = cell.dataset.key;
                    const AF = window.wmAndroidFolders;
                    // a folder made inside Android / Work: Rename, Delete, New Folder (#805)
                    const rows = key.startsWith('a:') ? sh.appHoldMenu(key.slice(2))
                        : (key.startsWith('folder:') && AF && AF.isUser(key.slice(7)) ? AF.folderRows(key.slice(7)) : []);
                    if (!rows.length) return;
                    grid.querySelectorAll('.wm-icongrid-cell.is-selected').forEach((c) => c.classList.remove('is-selected'));
                    cell.classList.add('is-selected');
                    sh.menuAt(e.clientX, e.clientY, rows);
                });
            },
            show() {
                if (!onAppsChanged) {
                    // a program came, went or moved folder (wmAndroidApps.js): redraw where we are
                    onAppsChanged = () => { if (page && !page.hidden && sh.current === 'programs') { const keep = page.querySelector('.wm-pg-scroll').scrollTop; render(); page.querySelector('.wm-pg-scroll').scrollTop = keep; } };
                    document.addEventListener('wmAppsChanged', onAppsChanged);
                }
                // the Start menu opens Programs at its top level
                folder = null;
                render();
                if (!manifest) loadManifest().then(render);
            },
            hide() { folder = null; },
            softKeys() { return { left: null, right: null }; },
            // a folder inside a folder (#805) is one step deeper
            historyDepth: () => (folder ? (FOLDER_PARENT.has(folder) ? 2 : 1) : 0),
            // X in a folder goes back to Programs; X on Programs itself closes (Yukimi, Nov 10)
            closeGoesBack: true,
            onBack() {
                if (!folder) return false;
                // out of a folder made inside Android / Work: back to that folder (#805)
                folder = FOLDER_PARENT.get(folder) || null;
                if (folder && !PROGRAM_FOLDERS[folder]) folder = null;
                render();
                return true;
            }
        });
    }

    // ---------------------------------------------------------------- Settings pages

    const TODAY_ROWS = [
        ['date', 'Date'],
        ['connection', 'Connection'],
        ['owner', 'Owner Info'],
        ['messages', 'Messaging'],
        ['tasks', 'Tasks'],
        ['search', 'Search'],
        ['workspace', 'Workspace'],
        ['prints', 'Recent Pictures']
    ];

    // Today > Items > Options...: per-row choices (wmShell.todayOptionDefs), stored as wmTodayOptions
    const TODAY_OPTIONS_KEY = 'wmTodayOptions';
    const optionDefs = (id) => (sh && typeof sh.todayOptionDefs === 'function' ? sh.todayOptionDefs(id) : []);
    function todayOptionsStored() {
        const v = lsJson(TODAY_OPTIONS_KEY);
        return v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : {};
    }

    function todayItems() {
        const saved = lsJson(K.todayItems);
        const out = [];
        const seen = new Set();
        // 6.5 lists its home screen first, as Windows Mobile 6.5 lists "Windows Default": checked,
        // Today is that screen and the items below are its panels; unchecked, Today shows them as rows
        const first = runningVersion() === '6.5' ? [['titanium', 'Melaton Default']] : [];
        // the shell's rows and the rows apps add (wmShell.registerTodayItem: Accounts ...)
        const rows = first.concat(TODAY_ROWS, sh && typeof sh.listTodayItems === 'function' ? sh.listTodayItems().map((w) => [w.id, w.label, w.defaultOn]) : []);
        if (Array.isArray(saved)) {
            for (const r of saved) {
                const def = r && rows.find(([id]) => id === r.id);
                if (!def || seen.has(def[0])) continue;
                seen.add(def[0]);
                out.push({ id: def[0], label: def[1], on: r.on !== false });
            }
        }
        // 6.5 with nothing chosen yet: its own order, the clock in the middle (wmShell.todayOrder65)
        if (first.length && !Array.isArray(saved) && sh && typeof sh.todayOrder65 === 'function') {
            const order = sh.todayOrder65(rows.map(([id]) => id));
            rows.sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
        }
        for (const [id, label, defaultOn] of rows) if (!seen.has(id)) out.push({ id, label, on: defaultOn !== false });
        // the home screen entry leads the list
        if (first.length && !(Array.isArray(saved) && saved.some((r) => r && r.id === 'titanium'))) {
            const at = out.findIndex((it) => it.id === 'titanium');
            if (at > 0) out.unshift(out.splice(at, 1)[0]);
        }
        return out;
    }

    // 6.5 Today > Items: "Today timeout" (the device returns to the home screen after that long):
    // a check box and a combo of 1 to 12 hr, on and 4 hr out of the box
    function todayTimeout() {
        const v = lsJson(K.todayTimeout);
        const hours = v && Number.isInteger(v.hours) && v.hours >= 1 && v.hours <= 12 ? v.hours : 4;
        return { on: !v || v.on !== false, hours };
    }

    function startMenuIds() {
        const saved = lsJson(K.startMenu);
        if (Array.isArray(saved)) return new Set(saved.map(String));
        return new Set(sh.listApps().filter((a) => a.inStart === 'top' || a.inStart === 'bottom').map((a) => a.id));
    }

    const START_ICONS = () => {
        const list = [
            { label: 'Melaton', src: MELATON_EMBLEM },
            { label: 'Windows', src: WM_FLAG },
            { label: 'Dreamscape', src: '/static_images/app_icons/48/dreamscape-logo.webp' }
        ];
        for (const l of desktopLaunchables()) {
            if (l && l.imageIcon && l.text) {
                const ic = appIcon(l.imageIcon);
                list.push({ label: l.text, src: ic.src.replace('/32/', '/64/') });
            }
        }
        return list;
    };

    const START_TEXT_PRESETS = () => {
        const out = [['Start', 'Start']];
        try {
            /* global START_MENU_BUTTON_PRESET_ORDER, START_MENU_BUTTON_PRESET_META */
            if (typeof START_MENU_BUTTON_PRESET_ORDER !== 'undefined') {
                for (const id of START_MENU_BUTTON_PRESET_ORDER) {
                    const m = START_MENU_BUTTON_PRESET_META[id];
                    if (m && m.text && !out.some(([, t]) => t === m.text)) out.push([m.text, `${m.text} (${m.label})`]);
                }
            }
        } catch (_) { /* desktop presets not loaded */ }
        return out;
    };

    // ---- Settings > Screen > Android (Melaton Bars, #871) ----

    /** The Android app's Melaton Bars state: { config, service, elevated, locked } or null. */
    function barsState() {
        try { return window.AndroidBars ? JSON.parse(window.AndroidBars.getState()) : null; } catch (_) { return null; }
    }

    const BARS_CORNERS = [['close', 'X goes Home'], ['ok', 'ok goes Back']];
    const BARS_SOFT_RIGHT = [['menu', 'Menu'], ['home', 'Home'], ['recents', 'Recent'], ['start', 'Start'], ['notifications', 'Notification'], ['none', '(none)']];
    // the Menu soft key's rows (Settings > Menus > Soft Key Menu)
    const SOFT_MENU_ITEMS = [['taskmanager', 'Task Manager'], ['notifications', 'All Notifications'], ['quicksettings', 'Quick Settings'], ['maximize', 'Maximize'], ['minimize', 'Minimize'], ['close', 'Close']];

    function renderBarsTab(el, d) {
        const st = d.barsState || {};
        const c0 = st.config || {};
        if (!d.barsCfg) {
            d.barsCfg = {
                enabled: !!c0.enabled, corner: c0.corner === 'ok' ? 'ok' : 'close', androidTray: !!c0.androidTray,
                softkeys: !!c0.softkeys, softRight: BARS_SOFT_RIGHT.some(([k]) => k === c0.softRight) ? c0.softRight : 'home',
                room: c0.room !== false,
                hideLandCover: !!c0.hideLandCover,
                keyguardClear: !!c0.keyguardClear,
                cutAnimations: !!c0.cutAnimations
            };
        }
        const cfg = d.barsCfg;
        let why = '';
        try { why = window.melatonBars ? window.melatonBars.unsupported() : ''; } catch (_) { why = ''; }
        if (!why) {
            const camera = document.documentElement.dataset.wmCamera;
            if (camera === 'bezel' || lsGet(K.cameraExtend) !== '1') why = 'extend-off';
        }
        const label = (list, v) => (list.find(([k]) => k === v) || list[0])[1];
        const note = why ? 'Needs Bezel > Top of screen: Windows Status Bar, with Extend Status Bar to edge of Camera.'
            : st.elevated === false ? 'Needs Shizuku or Localhost ADB (Android Bridge) to keep Android\'s status bar away.' : '';
        el.innerHTML = `${check('wmBarsOn', 'Use the title bar in Android programs', cfg.enabled)}
            ${note ? `<p>${esc(note)}</p>` : ''}
            <div class="wm-form-row is-wide"><span class="wm-form-label">Corner button:</span>${ui.comboHtml('barscorner', label(BARS_CORNERS, cfg.corner))}</div>
            ${check('wmBarsTray', 'Button for Android\'s notification tray', cfg.androidTray)}
            <div class="wm-form-gap"></div>
            ${check('wmBarsSoft', 'Use the soft key bar in Android programs', cfg.softkeys)}
            <div class="wm-form-row is-wide"><span class="wm-form-label">Right soft key:</span>${ui.comboHtml('barsright', label(BARS_SOFT_RIGHT, cfg.softRight))}</div>
            ${check('wmBarsRoom', 'Make room for the soft key bar (gesture navigation: swipe up on the bar for Home, in from a side for Back)', cfg.room)}
            ${check('wmBarsLandCover', 'Hide Softkey bar in landscape (Cover Screen only), swipe up to show', cfg.hideLandCover)}
            ${check('wmBarsKeyguardClear', 'Transparent Statusbar at keyguard', cfg.keyguardClear)}
            ${check('wmBarsCutAnim', 'Cut window animations everywhere (programs open, close and switch without zooming)', cfg.cutAnimations)}`;
        const q = (sel) => el.querySelector(sel);
        const sync = () => {
            q('input[name="wmBarsOn"]').disabled = !!why && !cfg.enabled;
            el.querySelectorAll('input[name="wmBarsTray"], input[name="wmBarsSoft"], [data-act="barscorner"]').forEach((i) => { i.disabled = !cfg.enabled; });
            const r = q('[data-act="barsright"]');
            if (r) r.disabled = !cfg.enabled || !cfg.softkeys;
            q('input[name="wmBarsRoom"]').disabled = !cfg.enabled || !cfg.softkeys;
            q('input[name="wmBarsLandCover"]').disabled = !cfg.enabled || !cfg.softkeys;
            q('input[name="wmBarsKeyguardClear"]').disabled = !cfg.enabled;
            q('input[name="wmBarsCutAnim"]').disabled = st.elevated === false;
        };
        const bind = (name, fn) => { const i = q(`input[name="${name}"]`); if (i) i.addEventListener('change', () => { fn(i.checked); sync(); }); };
        bind('wmBarsOn', (v) => { cfg.enabled = v; });
        bind('wmBarsTray', (v) => { cfg.androidTray = v; });
        bind('wmBarsSoft', (v) => { cfg.softkeys = v; });
        bind('wmBarsRoom', (v) => { cfg.room = v; });
        bind('wmBarsLandCover', (v) => { cfg.hideLandCover = v; });
        bind('wmBarsKeyguardClear', (v) => { cfg.keyguardClear = v; });
        bind('wmBarsCutAnim', (v) => { cfg.cutAnimations = v; });
        ui.bindCombo(q('[data-act="barscorner"]'), BARS_CORNERS, cfg.corner, (v) => { cfg.corner = v; });
        ui.bindCombo(q('[data-act="barsright"]'), BARS_SOFT_RIGHT, cfg.softRight, (v) => { cfg.softRight = v; });
        sync();
    }

    function check(name, label, checked, attrs = '') {
        return `<label class="wm-check"><input type="checkbox" name="${esc(name)}"${checked ? ' checked' : ''} ${attrs}><span>${esc(label)}</span></label>`;
    }

    function radio(name, value, label, checked) {
        return `<label class="wm-check"><input type="radio" name="${esc(name)}" value="${esc(value)}"${checked ? ' checked' : ''}><span>${esc(label)}</span></label>`;
    }

    // ---- Settings > Today > Wallpaper: this workspace's phone placement (wmShell.js wallpaper;
    // saved on the workspace record as mobileWallpaper, so every phone gets it; the desktop
    // never reads it). 'desktop' = the same as the desktop (no record of its own).

    const WALL_SIZES = [
        ['desktop', 'Same as desktop'],
        ['fill', 'Fill screen'],
        ['fit', 'Fit to screen'],
        ['stretch', 'Stretch'],
        ['tile', 'Tile'],
        ['center', 'Center']
    ];
    // the focus sliders: [axis, label, low end, high end]
    const WALL_AXES = [['x', 'Horizontal focus', 'Left', 'Right'], ['y', 'Vertical focus', 'Top', 'Bottom']];
    const wallNatural = new Map(); // url -> { w, h }

    function initWall() {
        const own = sh && sh.wallpaper ? sh.wallpaper.mobile() : null;
        const wall = own ? { size: own.size, position: own.position } : { size: 'desktop', position: '50% 50%' };
        return { ...wall, initial: `${wall.size}|${wall.position}` };
    }

    /** The draft's placement as wmShell takes it (null = same as the desktop). */
    function wallValue(w) {
        return w.size === 'desktop' ? null : { size: w.size, position: w.position };
    }

    async function commitWall(w) {
        if (!w || `${w.size}|${w.position}` === w.initial || !sh.wallpaper) return true;
        try {
            await sh.wallpaper.set(wallValue(w));
            w.initial = `${w.size}|${w.position}`;
            return true;
        } catch (err) {
            await sh.messageBox({ title: 'Today', icon: 'error', text: (err && err.message) || 'The wallpaper setting could not be saved.' });
            return false;
        }
    }

    /** The picture Today would show with this draft: the chosen picture, else the desktop's. */
    function wallPictureFor(d) {
        if (d.source === 'selected' && sameSite(d.picture)) return d.picture;
        if (d.source === 'android' && sh.androidWallUrl) { const a = sh.androidWallUrl(); if (a) return a; }
        return sh.wallpaper ? sh.wallpaper.desktop() : null;
    }

    /** Draw the draft placement into the phone-shaped preview (scaled from the Today screen). */
    function paintWallPreview(screen, d) {
        const url = wallPictureFor(d);
        const w = d.wall;
        const placement = w.size === 'desktop' ? { size: 'fill', position: sh.wallpaper.desktopPosition() } : w;
        const todayW = Math.max(1, window.innerWidth);
        const scale = screen.clientWidth / todayW;
        const css = sh.wallpaper.css(placement, url && wallNatural.get(url), scale);
        const fx = wallEffectOf(d);
        const paint = (src) => {
            const bg = src && sh.wallpaper.effectBackground ? sh.wallpaper.effectBackground(src, css, fx)
                : { image: src ? `url("${src.replace(/["\\\n]/g, encodeURIComponent)}")` : '', size: css.size, position: css.position, repeat: css.repeat };
            screen.style.backgroundImage = bg.image;
            screen.style.backgroundSize = bg.size;
            screen.style.backgroundPosition = bg.position;
            screen.style.backgroundRepeat = bg.repeat;
        };
        paint(url);
        if (url && fx.effect === 'blur' && sh.wallpaper.blurred) {
            const want = `${url}|${fx.level}`;
            screen.dataset.fx = want;
            sh.wallpaper.blurred(url, fx.level).then((b) => { if (b && screen.isConnected && screen.dataset.fx === want) paint(b); });
        }
        screen.classList.toggle('is-empty', !url);
        if (url && !wallNatural.has(url) && (placement.size === 'tile' || placement.size === 'center')) {
            const img = new Image();
            img.onload = () => {
                wallNatural.set(url, { w: img.naturalWidth, h: img.naturalHeight });
                if (screen.isConnected) paintWallPreview(screen, d);
            };
            img.src = url;
        }
    }

    // the picture's effect (the draft's Today options, 'wallpaper' row: effect, level)
    const WALL_EFFECTS = [['none', 'None'], ['lighten', 'Lighten'], ['darken', 'Darken'], ['blur', 'Blur']];

    function wallEffectOf(d) {
        const o = (d.opts && d.opts.wallpaper) || {};
        const def = (k, v) => (o[k] != null ? o[k] : (sh.todayOption ? sh.todayOption('wallpaper', k) : v));
        const effect = def('effect', 'none') || 'none';
        const level = Math.max(0, Math.min(100, Number(def('level', '50')) || 0));
        return { effect: level > 0 ? effect : 'none', chosen: effect, level };
    }

    /** Focus { x, y } of the draft (0-100 %). */
    function wallFocusOf(w) {
        if (sh.wallpaper && typeof sh.wallpaper.focus === 'function') return sh.wallpaper.focus(w.position);
        const m = /^(\d+(?:\.\d+)?)% (\d+(?:\.\d+)?)%$/.exec(w.position || '');
        return m ? { x: Number(m[1]), y: Number(m[2]) } : { x: 50, y: 50 };
    }

    function renderWall(el, d, api) {
        const w = d.wall;
        const fxNow = wallEffectOf(d);
        const same = w.size === 'desktop';
        // Same as desktop has no focus of its own and Stretch shows the whole picture; Fill, Fit,
        // Tile and Center all move the picture (CSS background-position)
        const focusOff = same || w.size === 'stretch';
        const focus = wallFocusOf(w);
        const label = (WALL_SIZES.find(([k]) => k === w.size) || WALL_SIZES[0])[1];
        // the preview frame takes the screen's shape (portrait or landscape)
        const portrait = window.innerHeight >= window.innerWidth;
        const pos = (v) => `calc(4 * var(--wm-px) + (100% - 8 * var(--wm-px)) * ${v / 100})`;
        const slider = ([axis, name, lo, hi]) => `<div class="wm-wall-axis${focusOff ? ' is-disabled' : ''}" data-axis="${axis}">
                <div class="wm-slider-scale"><span>${esc(lo)}</span><span class="wm-wall-value" data-f="${axis}-value"></span><span>${esc(hi)}</span></div>
                <div class="wm-slider wm-wall-slider" role="slider" aria-orientation="horizontal"${focusOff ? ' aria-disabled="true"' : ' tabindex="0"'} aria-label="${esc(name)}" aria-valuemin="0" aria-valuemax="100">
                    <div class="wm-slider-track"></div>
                    ${[0, 25, 50, 75, 100].map((v) => `<div class="wm-slider-tick" style="left:${pos(v)}"></div>`).join('')}
                    <div class="wm-slider-thumb"></div>
                </div>
            </div>`;
        el.innerHTML = `<p>Select how the wallpaper is placed on the Today screen of this workspace's phones:</p>
            <div class="wm-form-row"><label>Picture:</label><button type="button" class="wm-combo" data-act="size"><span>${esc(label)}</span></button></div>
            <div class="wm-wall-side">
                <div class="wm-wall-focus-box">
                    <div class="wm-form-sub">Focus:</div>
                    ${WALL_AXES.map(slider).join('')}
                </div>
                <div class="wm-wall-phone${portrait ? '' : ' is-landscape'}" aria-hidden="true"><div class="wm-wall-screen" data-f="screen"></div></div>
            </div>
            <p class="wm-form-note">${same ? "The phone fills the screen at the desktop's position." : 'The desktop keeps its own setting.'} Applies to a custom Today picture too.</p>
            <div class="wm-form-row"><label>Effect:</label><button type="button" class="wm-combo" data-act="effect"><span>${esc((WALL_EFFECTS.find(([k]) => k === fxNow.chosen) || WALL_EFFECTS[0])[1])}</span></button></div>
            <div class="wm-wall-axis wm-wall-level${fxNow.chosen === 'none' ? ' is-disabled' : ''}" data-axis="level">
                <div class="wm-slider-scale"><span>Level</span><span class="wm-wall-value" data-f="level-value"></span><span></span></div>
                <div class="wm-slider wm-wall-slider" role="slider" aria-orientation="horizontal"${fxNow.chosen === 'none' ? ' aria-disabled="true"' : ' tabindex="0"'} aria-label="Level" aria-valuemin="0" aria-valuemax="100">
                    <div class="wm-slider-track"></div>
                    ${[0, 25, 50, 75, 100].map((v) => `<div class="wm-slider-tick" style="left:${pos(v)}"></div>`).join('')}
                    <div class="wm-slider-thumb"></div>
                </div>
            </div>`;
        const setFx = (k, v) => { d.opts = Object.assign({}, d.opts); d.opts.wallpaper = Object.assign({ effect: fxNow.chosen, level: String(fxNow.level) }, d.opts.wallpaper, { [k]: v }); };
        const fxCombo = el.querySelector('[data-act="effect"]');
        fxCombo.addEventListener('click', (e) => {
            e.stopPropagation();
            sh.dropdown(fxCombo, WALL_EFFECTS.map(([k, l]) => ({ label: l, radio: k === fxNow.chosen, action: () => { setFx('effect', k); api.rerender(); } })), 'left');
        });
        const combo = el.querySelector('[data-act="size"]');
        combo.addEventListener('click', (e) => {
            e.stopPropagation();
            sh.dropdown(combo, WALL_SIZES.map(([k, l]) => ({ label: l, radio: k === w.size, action: () => { w.size = k; api.rerender(); } })), 'left');
        });
        const screen = el.querySelector('[data-f="screen"]');
        let painted = 0;
        const repaint = () => {
            if (painted) return;
            painted = requestAnimationFrame(() => { painted = 0; if (screen.isConnected) paintWallPreview(screen, d); });
        };
        el.querySelectorAll('.wm-wall-axis:not(.wm-wall-level)').forEach((box) => {
            const axis = box.dataset.axis;
            const track = box.querySelector('.wm-wall-slider');
            const thumb = box.querySelector('.wm-slider-thumb');
            const value = box.querySelector('.wm-wall-value');
            const show = () => {
                const v = focus[axis];
                thumb.style.left = pos(v);
                value.textContent = `${Math.round(v)}%`;
                track.setAttribute('aria-valuenow', String(Math.round(v)));
                track.setAttribute('aria-valuetext', `${Math.round(v)}%`);
            };
            const set = (v) => {
                v = Math.round(Math.max(0, Math.min(100, v)));
                if (v === focus[axis]) return;
                focus[axis] = v;
                w.position = `${focus.x}% ${focus.y}%`;
                show();
                repaint();
            };
            show();
            if (focusOff) return;
            const line = box.querySelector('.wm-slider-track'); // spans 0 % to 100 % (pos())
            const fromX = (x) => {
                const r = line.getBoundingClientRect();
                return ((x - r.left) / Math.max(1, r.width)) * 100;
            };
            track.addEventListener('pointerdown', (e) => {
                if (e.button > 0) return;
                // the drag is the slider's: no page scroll, tab swipe or menu gesture under it
                e.stopPropagation();
                e.preventDefault();
                track.focus({ preventScroll: true });
                track.setPointerCapture(e.pointerId);
                // a press on the thumb drags from where it is; elsewhere the thumb jumps there
                const tr = thumb.getBoundingClientRect();
                const grab = e.clientX >= tr.left - 2 && e.clientX <= tr.right + 2 ? e.clientX - (tr.left + tr.width / 2) : 0;
                set(fromX(e.clientX - grab));
                box.classList.add('is-dragging');
                const move = (ev) => { ev.stopPropagation(); set(fromX(ev.clientX - grab)); };
                const up = () => {
                    box.classList.remove('is-dragging');
                    track.removeEventListener('pointermove', move);
                    track.removeEventListener('pointerup', up);
                    track.removeEventListener('pointercancel', up);
                };
                track.addEventListener('pointermove', move);
                track.addEventListener('pointerup', up);
                track.addEventListener('pointercancel', up);
            });
            ['touchstart', 'touchmove'].forEach((t) => track.addEventListener(t, (e) => e.stopPropagation(), { passive: true }));
            track.addEventListener('keydown', (e) => {
                // both trackbars are horizontal: Left / Right step them, while Up / Down are left
                // to move between controls as on WM 6.1 (the D-pad walks the page's controls)
                const step = { ArrowLeft: -1, ArrowRight: 1, PageUp: -10, PageDown: 10 }[e.key];
                if (step !== undefined) set(focus[axis] + step);
                else if (e.key === 'Home') set(0);
                else if (e.key === 'End') set(100);
                else return;
                e.preventDefault();
                e.stopPropagation();
            });
        });
        // the effect's Level: 5 % steps (Today's stored choices)
        {
            const box = el.querySelector('.wm-wall-level');
            const track = box.querySelector('.wm-wall-slider');
            const thumb = box.querySelector('.wm-slider-thumb');
            const value = box.querySelector('.wm-wall-value');
            let level = fxNow.level;
            const show = () => {
                thumb.style.left = pos(level);
                value.textContent = `${level}%`;
                track.setAttribute('aria-valuenow', String(level));
            };
            const set = (v) => {
                v = Math.round(Math.max(0, Math.min(100, v)) / 5) * 5;
                if (v === level) return;
                level = v;
                setFx('level', String(v));
                show();
                repaint();
            };
            show();
            if (fxNow.chosen !== 'none') {
                const line = box.querySelector('.wm-slider-track');
                const fromX = (x) => { const r = line.getBoundingClientRect(); return ((x - r.left) / Math.max(1, r.width)) * 100; };
                track.addEventListener('pointerdown', (e) => {
                    if (e.button > 0) return;
                    e.stopPropagation();
                    e.preventDefault();
                    track.focus({ preventScroll: true });
                    track.setPointerCapture(e.pointerId);
                    set(fromX(e.clientX));
                    const move = (ev) => { ev.stopPropagation(); set(fromX(ev.clientX)); };
                    const up = () => { track.removeEventListener('pointermove', move); track.removeEventListener('pointerup', up); track.removeEventListener('pointercancel', up); };
                    track.addEventListener('pointermove', move);
                    track.addEventListener('pointerup', up);
                    track.addEventListener('pointercancel', up);
                });
                ['touchstart', 'touchmove'].forEach((t) => track.addEventListener(t, (e) => e.stopPropagation(), { passive: true }));
                track.addEventListener('keydown', (e) => {
                    const step = { ArrowLeft: -5, ArrowRight: 5, PageUp: -25, PageDown: 25 }[e.key];
                    if (step === undefined) return;
                    set(level + step);
                    e.preventDefault();
                    e.stopPropagation();
                });
            }
        }
        repaint();
    }

    /**
     * Page: { label, icon, tab (grid), tabs [[id, label]], available(), init() -> draft,
     * render(el, tabId, draft, api), commit(draft) -> keys | Promise }.
     */
    const PAGES = [
        {
            // 6.5.1 (#850): Windows Mobile 6.5.3 names this applet Home (window title and Start item)
            id: 'today', tab: 'personal', label: runningRelease() === '6.5.1' ? 'Home' : 'Today', icon: 'set-today',
            // 6.5's home screen has an Effects tab (Yukimi, Nov 15)
            tabs: runningVersion() === '6.5' ? [['appearance', 'Appearance'], ['wallpaper', 'Wallpaper'], ['items', 'Items'], ['effects', 'Effects'], ['superbar', 'Super Bar']] : [['appearance', 'Appearance'], ['wallpaper', 'Wallpaper'], ['items', 'Items']],
            init: () => ({
                useDesktop: todayUsesDesktop(), source: sh && sh.todayWallSource ? sh.todayWallSource() : (todayUsesDesktop() ? 'workspace' : 'selected'), picture: lsGet(K.todayBackground) || '', titleBar: titleBarStyle(), items: todayItems(), sel: 0, browsing: false, wall: initWall(), opts: todayOptionsStored(), optsFor: null, timeout: todayTimeout(),
                // rotation of Today (Yukimi, Nov 13: it applies to the Today screen only, so it lives here)
                parallax: lsGet(K.todayParallax) === '1',
                parallaxLevel: Math.max(1, Math.min(10, Math.round(Number(lsGet(K.todayParallaxLevel)) || 4))),
                fx: (() => { try { const v = JSON.parse(lsGet(K.todayFx) || 'null'); return v && typeof v === 'object' ? v : {}; } catch (_) { return {}; } })(),
                // Super Bar: the phone's notifications, and apps / channels hidden from it (wmTitanium.js keeps the known ones)
                sbn: (() => { try { const v = JSON.parse(lsGet('wmSuperBarNotes') || 'null'); return v && typeof v === 'object' ? v : {}; } catch (_) { return {}; } })(),
                screen: screenInfo(), rotate: homeRotateAllowed(screenInfo()), rotateCover: lsGet(K.homeRotateCover) === '1', rotateMain: lsGet(K.homeRotateMain) !== '0'
            }),
            render(el, tab, d, api) {
                // which picture Today shows is chosen on the Wallpaper tab, with its placement and
                // effect (Yukimi, Nov 11): the device has the choice on Appearance, Melaton has a
                // Wallpaper tab of its own and keeps the two together
                if (tab === 'wallpaper') {
                if (d.browsing) {
                        const pics = galleryItems(60);
                        el.innerHTML = `<p>Select a picture for the Today screen.</p>
                            ${pics.length ? `<div class="wm-picker">${pics.map((it) => { const p = previewPath(it); const full = todayPictureFor(it) || p; return `<button type="button" class="wm-picker-cell${full === d.picture || p === d.picture ? ' is-selected' : ''}" data-path="${esc(full)}" aria-label="${esc(it.filename || '')}"><img src="${esc(p)}" alt="" loading="lazy" draggable="false"></button>`; }).join('')}</div>` : '<p class="wm-form-note">No pictures.</p>'}
                            <div class="wm-buttons is-right"><button type="button" class="wm-button" data-act="done">Done</button></div>`;
                        el.querySelectorAll('.wm-picker-cell').forEach((c) => c.addEventListener('click', () => { d.picture = c.dataset.path; d.useDesktop = false; d.source = 'selected'; d.browsing = false; api.rerender(); }));
                        el.querySelector('[data-act="done"]').addEventListener('click', () => { d.browsing = false; api.rerender(); });
                        return;
                    }
                    // Use: the workspace's wallpaper, the phone's own Android wallpaper (Android draws it,
                    // each screen of a foldable its own: #799), or a picture chosen here
                    const sources = [['workspace', "Workspace's Wallpaper"]];
                    if (sh && sh.androidWallAvailable && sh.androidWallAvailable()) sources.push(['android', 'Android Wallpaper']);
                    sources.push(['selected', 'Selected Wallpaper']);
                    if (!sources.some(([v]) => v === d.source)) d.source = 'workspace';
                    renderWall(el, d, api);
                    if (d.source === 'android') {
                        // the phone's wallpaper for this screen (a foldable's cover and main screens each their own)
                        el.insertAdjacentHTML('beforeend', `<p class="wm-form-note">${sh.androidWallUrl && sh.androidWallUrl() ? "Today shows this screen's Android wallpaper; change it in Android's Settings &gt; Wallpaper." : "This screen's Android wallpaper is a live wallpaper or can't be read: Today shows the workspace's wallpaper."}</p>`);
                    }
                    const pick = document.createElement('div');
                    pick.className = 'wm-wall-pick';
                    pick.innerHTML = `<div class="wm-form-row"><label>Use:</label>${ui.comboHtml('source', (sources.find(([v]) => v === d.source) || sources[0])[1])}</div>
                        <div class="wm-buttons is-right"><button type="button" class="wm-button" data-act="browse"${d.source !== 'selected' ? ' disabled' : ''}>Browse</button></div>`;
                    el.insertBefore(pick, el.firstChild);
                    ui.bindCombo(pick.querySelector('.wm-combo[data-act="source"]'), sources, d.source, (v) => {
                        d.source = v;
                        d.useDesktop = v !== 'selected';
                        // a selected picture needs one: Browse opens at once when none is set yet
                        if (v === 'selected' && !sameSite(d.picture)) d.browsing = true;
                        api.rerender();
                    });
                    pick.querySelector('[data-act="browse"]').addEventListener('click', () => { d.browsing = true; api.rerender(); });
                    return;
                }
                if (tab === 'superbar') {
                    // the phone's notifications in the Super Bar, then each app seen there and its channels
                    const c = d.sbn;
                    c.apps = c.apps || {}; c.channels = c.channels || {};
                    // a channel's id read as words: 'notification_channel_weekly_report' -> 'Weekly report'
                    const chLabel = (id) => {
                        const t = String(id).replace(/^(notification[_-]?)?channel[_-]?/i, '').replace(/[_-]?(notification[_-]?)?channel$/i, '').replace(/[_.-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim().toLowerCase();
                        return t ? t.charAt(0).toUpperCase() + t.slice(1) : String(id);
                    };
                    // the channels' real names, as the app shows them in Android's settings (DSApp reads them
                    // from dumpsys notification; asked once per visit, the page draws again when they come)
                    const N = window.AndroidPhoneNotifications;
                    let names = {};
                    try { names = N && typeof N.channelNames === 'function' ? JSON.parse(N.channelNames() || '{}') : {}; } catch (_) { names = {}; }
                    if (N && typeof N.requestChannelNames === 'function' && !d.sbnAsked) {
                        d.sbnAsked = true;
                        const again = () => { window.removeEventListener('androidnotificationchannels', again); api.rerender(); };
                        window.addEventListener('androidnotificationchannels', again);
                        try { N.requestChannelNames(); } catch (_) { /* older app */ }
                    }
                    const chName = (pkg, id) => (names[pkg] && names[pkg][id]) || chLabel(id);
                    const known = Object.entries(c.known || {}).sort((a, b) => String(a[1].app || a[0]).localeCompare(String(b[1].app || b[0]), undefined, { sensitivity: 'base' }));
                    const rows = known.map(([pkg, k]) => `<div class="wm-listbox-row">${check('sb-app', k.app || pkg, c.apps[pkg] !== false, `value="${esc(pkg)}"${c.phone === false ? ' disabled' : ''}`)}</div>`
                        + (k.channels || []).map((ch) => `<div class="wm-listbox-row is-indent">${check('sb-ch', chName(pkg, ch), c.channels[`${pkg}|${ch}`] !== false, `value="${esc(`${pkg}|${ch}`)}"${c.phone === false || c.apps[pkg] === false ? ' disabled' : ''}`)}</div>`).join('')).join('');
                    el.innerHTML = `${check('sbPhone', "Show the phone's notifications", c.phone !== false)}
                        <div class="wm-form-gap"></div><p>Show notifications from:</p>
                        ${rows ? `<div class="wm-listbox wm-opt-list" style="flex:0 1 auto;min-height:0">${rows}</div>` : '<p class="wm-form-note">Apps and their channels are listed here once their notifications have shown in the Super Bar.</p>'}`;
                    el.querySelector('input[name="sbPhone"]').addEventListener('change', (e) => { if (e.target.checked) delete c.phone; else c.phone = false; api.rerender(); });
                    el.querySelectorAll('input[name="sb-app"]').forEach((i) => i.addEventListener('change', () => { if (i.checked) delete c.apps[i.value]; else c.apps[i.value] = false; api.rerender(); }));
                    el.querySelectorAll('input[name="sb-ch"]').forEach((i) => i.addEventListener('change', () => { if (i.checked) delete c.channels[i.value]; else c.channels[i.value] = false; }));
                    return;
                }
                if (tab === 'effects') {
                    // the home screen's effects (wmTitanium.js): Parallax with its Distance, then the rest as a
                    // check list that scrolls inside the page (the page itself never scrolls)
                    const rows = [
                        ['tilt', 'Tilt the picture with the phone'],
                        ['breathe', 'Settle the picture as Today comes back'],
                        ['stagger', 'Cascade the list as Today comes back'],
                        ['overshoot', 'Spring the list into place'],
                        ['catch', 'Light the glass as the list lands'],
                        ['exit', 'Drop the list away when a program opens'],
                        ['gloss', 'Light the items under the glass'],
                        ['digits', "Roll the clock's digits"],
                        ['blur', 'Frosted glass'],
                        ['haptics', 'Vibrate as items pass the glass'],
                        ['superbar', 'Tap the clock for the Super Bar'],
                        ['startopen', 'Start: icons come in from the corner'],
                        ['startfrost', 'Start: frosted picture'],
                        ['startlaunch', 'Start: programs grow out of their icon'],
                        ['startticks', 'Start: vibrate as rows pass']
                    ];
                    el.innerHTML = `${check('wmTodayParallax', 'Parallax Effect', d.parallax)}
                        <div class="wm-form-sub">Distance</div><div data-f="parallax-level"></div>
                        <div class="wm-form-gap"></div>
                        <div class="wm-listbox wm-opt-list" style="flex:0 1 auto;min-height:0;max-height:calc(150 * var(--wm-px))">${rows.map(([k, l]) => `<div class="wm-listbox-row">${check(`fx-${k}`, l, d.fx[k] !== false, `value="${k}"`)}</div>`).join('')}</div>
                        <p class="wm-form-note">Moving effects are off while the phone asks for reduced motion.</p>`;
                    el.querySelector('input[name="wmTodayParallax"]').addEventListener('change', (e) => { d.parallax = e.target.checked; api.rerender(); });
                    ui.trackbar(el.querySelector('[data-f="parallax-level"]'), {
                        steps: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], value: d.parallaxLevel, lo: 'Slight', hi: 'A lot', label: 'Parallax distance',
                        disabled: !d.parallax, onChange: (v) => { d.parallaxLevel = v; }
                    });
                    rows.forEach(([k]) => {
                        const c = el.querySelector(`input[name="fx-${k}"]`);
                        if (c) c.addEventListener('change', () => { if (c.checked) delete d.fx[k]; else d.fx[k] = false; });
                    });
                    return;
                }
                if (tab === 'items' && d.optsFor) {
                    // an item's Options (WM 6.1: Today > Items > Options...)
                    const id = d.optsFor;
                    const defs = optionDefs(id);
                    const cur = d.opts[id] || {};
                    const item = d.items.find((r) => r.id === id);
                    // type 'checks': one check box per choice, kept as the comma list of the unchecked ones
                    const offList = (o) => String(cur[o.key] != null ? cur[o.key] : (o.value || '')).split(',').filter(Boolean);
                    // 'orderedChecks' (Favorites, #777): the checked keys in order, kept as their comma list
                    const orderOf = (o) => String(cur[o.key] != null ? cur[o.key] : (o.value || '')).split(',').filter(Boolean);
                    if (!d.optSel) d.optSel = {};
                    const ordered = (o) => {
                        const on = orderOf(o);
                        const choices = o.choices;
                        const byKey = new Map(choices.map((c) => [c[0], c]));
                        const rows = on.filter((k) => byKey.has(k)).map((k) => byKey.get(k)).concat(choices.filter((c) => !on.includes(c[0])));
                        const sel = d.optSel[o.key];
                        const at = on.indexOf(sel);
                        return `<div class="wm-listbox wm-opt-list" data-opt="${esc(o.key)}">${rows.map(([v, l, img]) => `<div class="wm-listbox-row${v === sel ? ' is-selected' : ''}" data-key="${esc(v)}">${check(`opt-${o.key}`, '', on.includes(v), `value="${esc(v)}"`)}${img ? `<img src="${esc(img)}" alt="" draggable="false">` : ''}<span>${esc(l)}</span></div>`).join('')}</div>
                            <div class="wm-buttons"><button type="button" class="wm-button" data-act="opt-up" data-opt="${esc(o.key)}"${at > 0 ? '' : ' disabled'}>Move Up</button><button type="button" class="wm-button" data-act="opt-down" data-opt="${esc(o.key)}"${at >= 0 && at < on.length - 1 ? '' : ' disabled'}>Move Down</button></div>`;
                    };
                    // a long check list is a list box that scrolls inside the page (the page itself never scrolls)
                    // 'combo' (#830, Search's Android program / shortcut): one WM drop-down for a long list
                    const comboLabel = (o) => { const v = cur[o.key] != null ? cur[o.key] : o.value; const c = o.choices.find(([x]) => x === v); return c ? c[1] : (o.choices[0] ? o.choices[0][1] : ''); };
                    const field = (o) => (o.type === 'orderedChecks' ? ordered(o)
                        : o.type === 'combo' ? ui.comboHtml(`opt-${o.key}`, comboLabel(o))
                        : o.type === 'checks'
                            ? `<div class="wm-listbox wm-opt-list">${o.choices.map(([v, l]) => `<div class="wm-listbox-row">${check(`opt-${o.key}`, l, !offList(o).includes(v), `value="${esc(v)}"`)}</div>`).join('')}</div>`
                            : o.choices.map(([v, l]) => radio(`opt-${o.key}`, v, l, (cur[o.key] != null ? cur[o.key] : o.value) === v)).join(''));
                    el.innerHTML = `<p><b>${esc(item ? item.label : id)}</b></p>${defs.map((o) => `<div class="wm-form-gap"></div><p>${esc(o.label)}:</p>${field(o)}`).join('')}
                        <div class="wm-buttons is-right"><button type="button" class="wm-button" data-act="done">Done</button></div>`;
                    // the ordered list: a checked box joins the end of the favourites, a cleared one leaves;
                    // a tap on the row selects it for Move Up / Move Down
                    defs.filter((o) => o.type === 'orderedChecks').forEach((o) => {
                        const box = el.querySelector(`.wm-opt-list[data-opt="${o.key}"]`);
                        const setOrder = (list) => { d.opts[id] = Object.assign({}, d.opts[id], { [o.key]: list.join(',') }); };
                        box.querySelectorAll('.wm-listbox-row').forEach((row) => row.addEventListener('click', (e) => {
                            if (e.target.closest('input')) return;
                            d.optSel[o.key] = row.dataset.key;
                            api.rerender();
                        }));
                        box.querySelectorAll('input').forEach((c) => c.addEventListener('change', () => {
                            const list = orderOf(o).filter((k) => k !== c.value);
                            if (c.checked) list.push(c.value);
                            setOrder(list);
                            d.optSel[o.key] = c.value;
                            api.rerender();
                        }));
                        const move = (by) => {
                            const list = orderOf(o);
                            const i = list.indexOf(d.optSel[o.key]);
                            const j = i + by;
                            if (i < 0 || j < 0 || j >= list.length) return;
                            list.splice(j, 0, list.splice(i, 1)[0]);
                            setOrder(list);
                            api.rerender();
                        };
                        el.querySelector(`[data-act="opt-up"][data-opt="${o.key}"]`).addEventListener('click', () => move(-1));
                        el.querySelector(`[data-act="opt-down"][data-opt="${o.key}"]`).addEventListener('click', () => move(1));
                    });
                    defs.filter((o) => o.type === 'combo').forEach((o) => {
                        ui.bindCombo(el.querySelector(`.wm-combo[data-act="opt-${o.key}"]`), o.choices, cur[o.key] != null ? cur[o.key] : o.value, (v) => { d.opts[id] = Object.assign({}, d.opts[id], { [o.key]: v }); });
                    });
                    defs.filter((o) => o.type !== 'orderedChecks' && o.type !== 'combo').forEach((o) => el.querySelectorAll(`input[name="opt-${o.key}"]`).forEach((r) => r.addEventListener('change', () => {
                        if (o.type === 'checks') {
                            const off = [...el.querySelectorAll(`input[name="opt-${o.key}"]`)].filter((x) => !x.checked).map((x) => x.value);
                            d.opts[id] = Object.assign({}, d.opts[id], { [o.key]: off.join(',') });
                            return;
                        }
                        if (!r.checked) return;
                        d.opts[id] = Object.assign({}, d.opts[id], { [o.key]: r.value });
                    })));
                    el.querySelector('[data-act="done"]').addEventListener('click', () => { d.optsFor = null; api.rerender(); });
                    return;
                }
                if (tab === 'items') {
                    const selId = d.items[d.sel] && d.items[d.sel].id;
                    const hasOpts = !!(selId && optionDefs(selId).length);
                    // 6.5 (device): Move Up, Move Down, Options... down the side and "Today timeout" under the list
                    const v65 = runningVersion() === '6.5';
                    const optionsBtn = `<button type="button" class="wm-button" data-act="options"${hasOpts ? '' : ' disabled'}>Options...</button>`;
                    const moveBtns = `<button type="button" class="wm-button" data-act="up"${d.sel > 0 ? '' : ' disabled'}>Move Up</button><button type="button" class="wm-button" data-act="down"${d.sel < d.items.length - 1 ? '' : ' disabled'}>Move Down</button>`;
                    el.innerHTML = `<p>Checked items appear on the Today screen.</p>
                        <div class="wm-listbox-side">
                            <div class="wm-listbox" style="max-height:calc(170 * var(--wm-px))">${d.items.map((r, i) => `<div class="wm-listbox-row${i === d.sel ? ' is-selected' : ''}" data-i="${i}">${check(`it-${r.id}`, r.label, r.on)}</div>`).join('')}</div>
                            <div class="wm-buttons">${v65 ? `${moveBtns}${optionsBtn}` : `${optionsBtn}${moveBtns}`}</div>
                        </div>${v65 ? `<div class="wm-today-timeout">${check('timeout', 'Today timeout:', d.timeout.on)}${ui.comboHtml('timeout', `${d.timeout.hours} hr`, !d.timeout.on)}</div>` : ''}`;
                    if (v65) {
                        el.querySelector('input[name="timeout"]').addEventListener('change', (e) => { d.timeout.on = e.target.checked; api.rerender(); });
                        ui.bindCombo(el.querySelector('.wm-combo[data-act="timeout"]'), Array.from({ length: 12 }, (_, n) => [n + 1, `${n + 1} hr`]), d.timeout.hours, (v) => { d.timeout.hours = v; });
                    }
                    el.querySelectorAll('.wm-listbox-row').forEach((row) => {
                        const i = Number(row.dataset.i);
                        row.addEventListener('click', () => { if (d.sel !== i) { d.sel = i; api.rerender(); } });
                        row.querySelector('input').addEventListener('change', (e) => { d.items[i].on = e.target.checked; });
                    });
                    el.querySelectorAll('.wm-button[data-act]').forEach((b) => b.addEventListener('click', () => {
                        if (b.dataset.act === 'options') { d.optsFor = selId; api.rerender(); return; }
                        const j = d.sel + (b.dataset.act === 'up' ? -1 : 1);
                        if (j < 0 || j >= d.items.length) return;
                        [d.items[d.sel], d.items[j]] = [d.items[j], d.items[d.sel]];
                        d.sel = j;
                        api.rerender();
                    }));
                    return;
                }
                el.innerHTML = `<p>Select a title bar style for your device:</p>
                    <div class="wm-listbox-side">
                        <div class="wm-listbox">${[['flat', 'Flat title bar'], ['glossy', 'Glossy title bar']].map(([v, l]) => `<button type="button" class="wm-listbox-row${d.titleBar === v ? ' is-selected' : ''}" data-tb="${v}">${esc(l)}</button>`).join('')}</div>
                        <div class="wm-preview-box" data-f="preview"></div>
                    </div>`;
                const prev = el.querySelector('[data-f="preview"]');
                if (d.source === 'selected' && sameSite(d.picture)) prev.style.backgroundImage = `url("${d.picture.replace(/["\\\n]/g, encodeURIComponent)}")`;
                else prev.textContent = d.source === 'android' ? 'Android' : d.useDesktop ? 'Desktop' : '';
                el.querySelectorAll('[data-tb]').forEach((b) => b.addEventListener('click', () => { d.titleBar = b.dataset.tb; api.rerender(); }));
                // Rotation: whether Today turns with the phone; a foldable has a choice for each of its screens
                const canLock = !!(window.AndroidDisplay && typeof window.AndroidDisplay.setRotationLock === 'function');
                const fold = !!(d.screen && d.screen.foldable);
                el.insertAdjacentHTML('beforeend', `<div class="wm-form-gap"></div><div class="wm-form-sub">Rotation</div>
                    ${fold
                        ? `${check('wmHomeRotateCover', 'Rotate Today, Start and Settings on the cover screen', d.rotateCover)}${check('wmHomeRotateMain', 'Rotate Today, Start and Settings on the main screen', d.rotateMain)}`
                        : check('wmHomeRotate', 'Rotate Today, Start and Settings with the phone', d.rotate)}
                    <p class="wm-form-note">${canLock
                        ? `When off, Today, Start and Settings stay upright however the phone is held. Programs still turn as the phone's auto-rotate setting decides.${fold ? ` This phone is on ${d.screen.screen === 'main' ? 'the main screen' : 'the cover screen'} now.` : ''}`
                        : 'Rotation of Today needs the Dreamscape app.'}</p>`);
                const bindR = (name, fn) => { const i = el.querySelector(`input[name="${name}"]`); if (i) { i.disabled = !canLock; i.addEventListener('change', () => fn(i.checked)); } };
                bindR('wmHomeRotate', (v) => { d.rotate = v; });
                bindR('wmHomeRotateCover', (v) => { d.rotateCover = v; });
                bindR('wmHomeRotateMain', (v) => { d.rotateMain = v; });
            },
            async commit(d) {
                // the Appearance and Items choices are local: they are kept even when the
                // workspace wallpaper save fails (the page then stays open to retry)
                const useDesktop = d.source !== 'selected' || !sameSite(d.picture);
                lsSet(K.todayUseDesktop, useDesktop ? '1' : '0');
                lsSet(K.todayWallSource, d.source === 'android' ? 'android' : useDesktop ? 'workspace' : 'selected');
                if (sameSite(d.picture)) lsSet(K.todayBackground, d.picture);
                lsSet(K.todayItems, JSON.stringify(d.items.map((r) => ({ id: r.id, on: r.on }))));
                lsSet(TODAY_OPTIONS_KEY, JSON.stringify(d.opts || {}));
                lsSet(K.titleBar, d.titleBar);
                lsSet(K.todayParallax, d.parallax ? '1' : null);
                lsSet(K.todayParallaxLevel, d.parallaxLevel === 4 ? null : d.parallaxLevel);
                lsSet(K.todayFx, Object.keys(d.fx || {}).length ? JSON.stringify(d.fx) : null);
                if (d.sbn && Object.keys(d.sbn).length) lsSet('wmSuperBarNotes', JSON.stringify(d.sbn));
                applyTitleBar();
                const keys = [K.todayUseDesktop, K.todayBackground, K.todayWallSource, K.todayItems, K.titleBar, TODAY_OPTIONS_KEY, K.todayParallax, K.todayParallaxLevel, K.todayFx, 'wmSuperBarNotes'];
                // Rotation (a foldable's per-screen choices, or the one for a phone)
                const rot = d.screen && d.screen.foldable
                    ? [[K.homeRotateCover, d.rotateCover ? '1' : null], [K.homeRotateMain, d.rotateMain ? null : '0']]
                    : [[K.homeRotate, d.rotate ? '1' : null]];
                let rotChanged = false;
                for (const [k, v] of rot) if ((lsGet(k) || null) !== v) { lsSet(k, v); keys.push(k); rotChanged = true; }
                if (rotChanged) { rotationLocked = null; applyHomeRotation(); }
                if (runningVersion() === '6.5' && d.timeout) {
                    lsSet(K.todayTimeout, JSON.stringify({ on: d.timeout.on, hours: d.timeout.hours }));
                    keys.push(K.todayTimeout);
                }
                if (!(await commitWall(d.wall))) {
                    changed(keys);
                    return false;
                }
                return keys;
            }
        },
        {
            id: 'owner', tab: 'personal', label: 'Owner Information', icon: 'set-owner',
            tabs: [['identification', 'Identification']],
            available: () => !!(window.meletonAccounts && typeof window.meletonAccounts.name === 'function'),
            init() {
                const acc = window.meletonAccounts;
                const account = typeof acc.current === 'function' ? acc.current() : 'guest';
                return { account, name: acc.name(account), canEdit: account === 'administrator' && typeof acc.setName === 'function' };
            },
            render(el, tab, d) {
                el.innerHTML = `<div class="wm-form-row"><label for="wmOwnerName">Name:</label><input id="wmOwnerName" class="wm-edit" type="text" maxlength="20" autocomplete="off" value="${esc(d.name)}"${d.canEdit ? '' : ' readonly'}></div>
                    <div class="wm-form-row"><span class="wm-form-label">Account:</span><span class="wm-form-value">${esc(d.account === 'administrator' ? 'Administrator' : 'Guest')}</span></div>
                    ${d.canEdit ? '' : '<p class="wm-form-note" style="margin-top:calc(8 * var(--wm-px))">Only an administrator can change the name.</p>'}`;
                el.querySelector('#wmOwnerName').addEventListener('input', (e) => { d.name = e.target.value; });
            },
            async commit(d) {
                const acc = window.meletonAccounts;
                const name = String(d.name || '').trim();
                if (!d.canEdit || !name || name === acc.name(d.account)) return [];
                try {
                    await acc.setName(d.account, name);
                } catch (err) {
                    await sh.messageBox({ title: 'Owner Information', icon: 'error', text: (err && err.message) || 'The name could not be changed.' });
                    return false;
                }
                return [];
            }
        },
        {
            id: 'sounds', tab: 'personal', label: 'Sounds & Notifications', icon: 'set-sounds',
            tabs: [['sounds', 'Sounds']],
            available: () => !!(window.desktopPersonalization && typeof window.desktopPersonalization.get === 'function'),
            init: () => ({ on: window.desktopPersonalization.get().soundScheme !== 'none' }),
            render(el, tab, d) {
                el.innerHTML = `<p>Enable sounds for:</p>${check('events', 'Events (warnings, system events)', d.on)}
                    <p class="wm-form-note" style="margin-top:calc(8 * var(--wm-px))">The sound scheme of this workspace, as set on the desktop.</p>`;
                el.querySelector('input').addEventListener('change', (e) => { d.on = e.target.checked; });
            },
            commit(d) {
                const dp = window.desktopPersonalization;
                if ((dp.get().soundScheme !== 'none') !== d.on) dp.update({ soundScheme: d.on ? 'default' : 'none' });
                return [];
            }
        },
        {
            id: 'menus', tab: 'personal', label: 'Menus', icon: 'set-menus',
            // 6.5's Start is the grid (its ROM has no Menus applet): only the Start button applies there
            // Melaton Bars (#871): the right soft key's Menu over Android programs
            get tabs() {
                const t = runningVersion() === '6.5' ? [['button', 'Start Button']] : [['start', 'Start Menu'], ['button', 'Start Button']];
                return window.AndroidBars ? t.concat([['softmenu', 'Soft Key Menu']]) : t;
            },
            init() {
                const sb = startButton();
                const st = barsState();
                const saved = st && st.config && Array.isArray(st.config.softMenu) ? st.config.softMenu : null;
                const softMenu = (saved || SOFT_MENU_ITEMS.map(([id]) => ({ id, on: true }))).filter((r) => SOFT_MENU_ITEMS.some(([id]) => id === r.id));
                SOFT_MENU_ITEMS.forEach(([id]) => { if (!softMenu.some((r) => r.id === id)) softMenu.push({ id, on: false }); });
                return { ids: startMenuIds(), source: sb.source, text: sb.source === 'custom' ? sb.text : (lsGet(K.startText) || 'Start'), icon: sb.source === 'custom' ? sb.icon : MELATON_EMBLEM,
                    softMenu, softMenu0: JSON.stringify(softMenu), softSel: 0 };
            },
            render(el, tab, d, api) {
                if (tab === 'softmenu') {
                    const label = (id) => (SOFT_MENU_ITEMS.find(([k]) => k === id) || [id, id])[1];
                    el.innerHTML = `<p>Checked items appear on the Menu soft key over Android programs (Settings > Screen > Android: Right soft key, Menu).</p>
                        <div class="wm-listbox-side">
                            <div class="wm-listbox" style="max-height:calc(170 * var(--wm-px))">${d.softMenu.map((r, i) => `<div class="wm-listbox-row${i === d.softSel ? ' is-selected' : ''}" data-i="${i}">${check(`smn-${r.id}`, label(r.id), r.on)}</div>`).join('')}</div>
                            <div class="wm-buttons"><button type="button" class="wm-button" data-act="up"${d.softSel > 0 ? '' : ' disabled'}>Move Up</button><button type="button" class="wm-button" data-act="down"${d.softSel < d.softMenu.length - 1 ? '' : ' disabled'}>Move Down</button></div>
                        </div>`;
                    el.querySelectorAll('.wm-listbox-row').forEach((row) => {
                        const i = Number(row.dataset.i);
                        row.addEventListener('click', () => { if (d.softSel !== i) { d.softSel = i; api.rerender(); } });
                        row.querySelector('input').addEventListener('change', (e) => { d.softMenu[i].on = e.target.checked; });
                    });
                    el.querySelectorAll('.wm-button[data-act]').forEach((b) => b.addEventListener('click', () => {
                        const j = d.softSel + (b.dataset.act === 'up' ? -1 : 1);
                        if (j < 0 || j >= d.softMenu.length) return;
                        [d.softMenu[d.softSel], d.softMenu[j]] = [d.softMenu[j], d.softMenu[d.softSel]];
                        d.softSel = j;
                        api.rerender();
                    }));
                    return;
                }
                if (tab === 'button') {
                    const desk = desktopStartButton();
                    const custom = d.source === 'custom';
                    el.innerHTML = `<p>The Start button's text replaces "Start" on the Today screen.</p>
                        ${radio('src', 'wm', 'Start (Melaton emblem)', d.source === 'wm')}
                        ${radio('src', 'flag', 'Start (Windows flag)', d.source === 'flag')}
                        ${radio('src', 'desktop', `Same as the desktop (${desk.text})`, d.source === 'desktop')}
                        ${radio('src', 'custom', 'Custom', custom)}
                        <div class="wm-form-gap"></div>
                        <div class="wm-form-row"><label for="wmStartTextEdit">Text:</label><div class="wm-combo-edit"><input id="wmStartTextEdit" class="wm-edit" type="text" maxlength="24" autocomplete="off" value="${esc(d.text)}"${custom ? '' : ' disabled'}><button type="button" class="wm-combo" data-act="text" aria-label="Presets"${custom ? '' : ' disabled'}></button></div></div>
                        <div class="wm-form-sub"${custom ? '' : ' hidden'}>Icon:</div>
                        <div class="wm-picker is-icons"${custom ? '' : ' hidden'}>${START_ICONS().map((ic) => `<button type="button" class="wm-picker-cell${ic.src === d.icon ? ' is-selected' : ''}" data-src="${esc(ic.src)}" title="${esc(ic.label)}" aria-label="${esc(ic.label)}" style="background:#4a4d4a"><img src="${esc(ic.src)}"${ic.src === WM_FLAG ? ` srcset="${WM_FLAG_SRCSET}"` : ''} alt="" loading="lazy" draggable="false"></button>`).join('')}</div>`;
                    el.querySelectorAll('input[name="src"]').forEach((r) => r.addEventListener('change', () => { d.source = r.value; api.rerender(); }));
                    const edit = el.querySelector('.wm-edit');
                    edit.addEventListener('input', () => { d.text = edit.value; });
                    const combo = el.querySelector('[data-act="text"]');
                    combo.addEventListener('click', (e) => {
                        e.stopPropagation();
                        sh.dropdown(edit.parentElement, START_TEXT_PRESETS().map(([t, l]) => ({ label: l, radio: t === d.text, action: () => { d.text = t; api.rerender(); } })), 'left');
                    });
                    el.querySelectorAll('.wm-picker-cell').forEach((c) => c.addEventListener('click', () => {
                        d.icon = c.dataset.src;
                        el.querySelectorAll('.wm-picker-cell').forEach((x) => x.classList.toggle('is-selected', x === c));
                    }));
                    return;
                }
                // the phone's own Android programs have their own list (Settings > System > Android Programs)
                const apps = sh.listApps().filter((a) => a.inStart && a.inStart !== 'system' && !SHELL_ONLY.has(a.id) && !String(a.id).startsWith('android:'));
                el.innerHTML = `<p>Checked items appear in the Start menu. Others appear in Programs.</p>
                    <div class="wm-listbox" style="max-height:calc(190 * var(--wm-px))">${apps.map((a) => `<div class="wm-listbox-row">${check(`sm-${a.id}`, a.startLabel || a.title || a.id, d.ids.has(a.id), `data-id="${esc(a.id)}"`)}</div>`).join('')}</div>`;
                el.querySelectorAll('input[data-id]').forEach((c) => c.addEventListener('change', () => {
                    if (c.checked) d.ids.add(c.dataset.id); else d.ids.delete(c.dataset.id);
                }));
            },
            commit(d) {
                if (window.AndroidBars && d.softMenu && JSON.stringify(d.softMenu) !== d.softMenu0) {
                    try { window.AndroidBars.setConfig(JSON.stringify({ softMenu: d.softMenu })); } catch (_) { /* older app */ }
                }
                lsSet(K.startMenu, JSON.stringify([...d.ids]));
                lsSet(K.startSource, d.source);
                if (d.source === 'custom') {
                    lsSet(K.startText, String(d.text || '').trim().slice(0, 24) || 'Start');
                    lsSet(K.startIcon, sameSite(d.icon) ? d.icon : MELATON_EMBLEM);
                } else {
                    const sb = d.source === 'desktop' ? desktopStartButton() : { text: 'Start', icon: d.source === 'flag' ? WM_FLAG : MELATON_EMBLEM };
                    lsSet(K.startText, sb.text);
                    lsSet(K.startIcon, sb.icon);
                }
                return [K.startMenu, K.startSource, K.startText, K.startIcon];
            }
        },
        {
            id: 'about', tab: 'system', label: 'About', icon: 'set-about',
            tabs: [['version', 'Version'], ['device', 'Device ID'], ['copyrights', 'Copyrights']],
            init() {
                const d = { info: typeof window.getMeletonVersionInfo === 'function' ? window.getMeletonVersionInfo() : null };
                if (typeof window.loadMeletonVersionInfo === 'function') {
                    window.loadMeletonVersionInfo().then((info) => { d.info = info; if (d.rerender) d.rerender(); }).catch(() => {});
                }
                // Device ID (#829): the name and description the phone presents to Device Center and its own DeX desktop
                const id = window.melatonDeviceIdentity && typeof window.melatonDeviceIdentity.get === 'function' ? window.melatonDeviceIdentity.get() : null;
                d.id = id ? { name: id.name, description: id.description } : { name: 'Melaton_Mobile', description: '' };
                d.id0 = Object.assign({}, d.id);
                d.hw = aboutHardware();
                return d;
            },
            render(el, tab, d, api) {
                d.rerender = api.rerender;
                const info = d.info || { version: '2026 R7', build: 'Unknown', copyrightYear: '2026', copyrightHolder: 'Xyridian Corporation' };
                const build = info.build && info.build !== 'Unknown' ? ` (Build ${info.build})` : '';
                if (tab === 'device') {
                    // the device's own words and boxes (WM 6.1 Settings > About > Device ID)
                    const editable = !!window.melatonDeviceIdentity;
                    el.innerHTML = `<p>Your device uses this information to identify itself to other computers. Enter a name that starts with a letter and contains the characters _, A-Z, or 0-9.</p>
                        <div class="wm-form-row is-wide"><label for="wmDevName">Device name:</label><input id="wmDevName" class="wm-edit" type="text" maxlength="64" autocomplete="off" spellcheck="false" value="${esc(d.id.name)}"${editable ? '' : ' readonly'}></div>
                        <div class="wm-form-row is-wide"><label for="wmDevDesc">Description:</label><input id="wmDevDesc" class="wm-edit" type="text" maxlength="128" autocomplete="off" value="${esc(d.id.description)}"${editable ? '' : ' readonly'}></div>`;
                    el.querySelector('#wmDevName').addEventListener('input', (e) => { d.id.name = e.target.value; });
                    el.querySelector('#wmDevDesc').addEventListener('input', (e) => { d.id.description = e.target.value; });
                    return;
                }
                if (tab === 'copyrights') {
                    el.innerHTML = `<p>Melaton Mobile ${esc(info.version)}<br>© ${esc(info.copyrightYear)} ${esc(info.copyrightHolder)}. All rights reserved.</p>
                        <p>Dreamscape, Melaton and the Melaton logo are trademarks of ${esc(info.copyrightHolder)}.</p>
                        <p>Portions of this software use icons and artwork from Windows Mobile 6.1 Professional.</p>`;
                    return;
                }
                // the edition after the version, as Windows Mobile's own About reads ("Windows Mobile 6.1 Professional", #827)
                let edition = '';
                try { edition = window.activeSync && typeof window.activeSync.myEdition === 'function' ? window.activeSync.myEdition() : ''; } catch (_) { edition = ''; }
                const f = aboutFacts(d.hw);
                el.innerHTML = `<p>Melaton Mobile® ${esc(info.version)}${edition ? ` ${esc(edition)}` : ''}</p>
                    <p>Melaton OS ${esc(info.version)}${esc(build)}<br>© ${esc(info.copyrightYear)} ${esc(info.copyrightHolder)}.<br>All rights reserved.</p>
                    <p>This computer program is protected by U.S. and international copyright laws.</p>
                    <div class="wm-facts">
                        <span>Processor:</span><span title="${esc(f.processor)}">${esc(f.processor)}</span>
                        ${f.cores ? `<span>Cores:</span><span title="${esc(f.cores)}">${esc(f.cores)}</span>` : ''}
                        <span>Memory:</span><span>${esc(f.memory)}</span>
                        <span>Expansion slot:</span><span>${esc(f.slot)}</span>
                    </div>
                    <div class="wm-cafe-badge" role="img" aria-label="Powered by CafeReady"><span class="wm-cafe-by">Powered by</span><img src="/static_images/melaton/cafe-ready-dark.png" alt="" draggable="false"><span class="wm-cafe-tm">™</span></div>`;
            },
            async commit(d) {
                const idApi = window.melatonDeviceIdentity;
                if (!idApi || (d.id.name === d.id0.name && d.id.description === d.id0.description)) return [];
                const name = String(d.id.name || '').trim();
                // the device's rule: a letter first, then letters, digits and _ (WM rejects anything else);
                // a name left as it came (the phone's own, which may have spaces) is not checked
                if (name !== d.id0.name && !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name)) {
                    await sh.messageBox({ title: 'About', icon: 'error', text: 'Enter a device name that starts with a letter and contains only the characters _, A-Z, or 0-9.' });
                    return false;
                }
                const now = idApi.set({ name, description: d.id.description });
                d.id = { name: now.name, description: now.description };
                d.id0 = Object.assign({}, d.id);
                return [];
            }
        },
        {
            id: 'clock', tab: 'system', label: 'Clock & Alarms', icon: 'set-clock',
            tabs: [['time', 'Time']],
            init: () => ({}),
            render(el) {
                const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Unknown';
                const draw = () => {
                    if (!el.isConnected) { clearInterval(timer); return; }
                    // Settings behind another app or the screen off: the next tick on screen draws it
                    const sh = window.wmShell;
                    if (el.innerHTML && sh && sh.onScreen && !sh.onScreen(el)) return;
                    const now = new Date();
                    el.innerHTML = `<div class="wm-form-sub">Home</div>
                        <div class="wm-form-row"><span class="wm-form-label">Time Zone:</span><span class="wm-form-value">${esc(zone)}</span></div>
                        <div class="wm-form-row"><span class="wm-form-label">Date:</span><span class="wm-form-value">${esc(now.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }))}</span></div>
                        <div class="wm-form-row"><span class="wm-form-label">Time:</span><span class="wm-form-value">${esc(now.toLocaleTimeString())}</span></div>
                        <p class="wm-form-note" style="margin-top:calc(8 * var(--wm-px))">The clock follows this phone's own time and time zone.</p>`;
                };
                const timer = setInterval(draw, 1000);
                draw();
            }
        },
        {
            id: 'memory', tab: 'system', label: 'Memory', icon: 'set-memory',
            // WM 6.1's Memory: Main | Storage Card (#829: the phone's SD / USB storage)
            tabs: [['main', 'Main'], ['card', 'Storage Card']],
            init() {
                const d = { est: null, hw: aboutHardware(), card: 0 };
                if (navigator.storage && typeof navigator.storage.estimate === 'function') {
                    navigator.storage.estimate().then((e) => { d.est = e; if (d.rerender) d.rerender(); }).catch(() => {});
                }
                return d;
            },
            render(el, tab, d, api) {
                d.rerender = api.rerender;
                const col = (title, total, used) => `<div class="wm-mem-col"><b>${esc(title)}</b>
                    <span>Total:</span><span>${esc(fmtMB(total))}</span>
                    <span>In use:</span><span>${esc(fmtMB(used))}</span>
                    <span class="is-free">Free:</span><span class="is-free">${esc(fmtMB(total - used))}</span></div>`;
                if (tab === 'card') {
                    const cards = storageCards(d.hw);
                    if (!cards.length) { el.innerHTML = '<p>No storage card is inserted.</p>'; return; }
                    const c = cards[Math.min(d.card, cards.length - 1)];
                    const label = (v) => v.label || (v.kind === 'usb' ? 'USB Storage' : 'Storage Card');
                    el.innerHTML = `${cards.length > 1 ? `<div class="wm-form-row"><span class="wm-form-label">Storage card:</span>${ui.comboHtml('card', label(c))}</div>` : `<p>${esc(label(c))}</p>`}
                        <div class="wm-mem">${col('Storage card', c.totalBytes, c.totalBytes - c.freeBytes)}</div>`;
                    const btn = el.querySelector('.wm-combo[data-act="card"]');
                    if (btn) ui.bindCombo(btn, cards.map((v, i) => [i, label(v)]), d.card, (v) => { d.card = Number(v); api.rerender(); });
                    return;
                }
                const e = d.est;
                const pm = performance.memory;
                const mem = d.hw && d.hw.memory;
                let lsBytes = 0;
                try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); lsBytes += (k.length + (localStorage.getItem(k) || '').length) * 2; } } catch (_) { /* storage off */ }
                // Program: the phone's RAM when the app reports it, else this page's script heap
                const program = mem && mem.totalBytes ? col('Program', mem.totalBytes, mem.totalBytes - (mem.availBytes || 0)) : pm ? col('Program', pm.jsHeapSizeLimit, pm.usedJSHeapSize) : '';
                el.innerHTML = `<div class="wm-mem">${col('Storage', e ? e.quota : NaN, e ? e.usage : NaN)}${program}</div>
                    <div class="wm-form-gap"></div>
                    <p>Settings: ${esc(fmtMB(lsBytes))}</p>`;
            }
        },
        {
            id: 'screen', tab: 'system', label: 'Screen', icon: 'set-screen',
            // Melaton Bars (#871): with an Android app that can draw them over other programs
            tabs: [['textsize', 'Text Size'], ['bezel', 'Bezel']].concat(window.AndroidBars ? [['bars', 'Android']] : []),
            init: () => ({
                barsState: barsState(),
                scale: currentScale(), camera: cameraStyle(), portraitOnly: lsGet(K.cameraPortraitOnly) === '1', bars: systemBars(),
                extend: lsGet(K.cameraExtend) === '1',
                softExtend: lsGet(K.softkeyExtend) === '1',
                noCross: lsGet(K.statusNoCross) === '1',
                logoOpacity: Math.min(100, Math.max(10, Number(lsGet(K.bezelLogoOpacity)) || 55)),
                logoSize: BEZEL_LOGO_SIZES.includes(Number(lsGet(K.bezelLogoSize))) ? Number(lsGet(K.bezelLogoSize)) : 70,
                logoPos: lsGet(K.bezelLogoPos) || 'auto',
                modelShow: lsGet(K.bezelModelShow) === '1',
                model: lsGet(K.bezelModel) || '',
                modelSize: BEZEL_MODEL_SIZES.includes(Number(lsGet(K.bezelModelSize))) ? Number(lsGet(K.bezelModelSize)) : 30,
                modelPos: lsGet(K.bezelModelPos) || 'auto',
                led: lsGet(K.bezelLed) === '1',
                ledNotify: lsGet(K.bezelLedNotify) !== '0',
                ledBattery: lsGet(K.bezelLedBattery) !== '0',
                ledCharge: lsGet(K.bezelLedCharge) !== '0'
            }),
            render(el, tab, d) {
                // Android (#871): these bars over Android's programs, Android's status bar locked away
                if (tab === 'bars') { renderBarsTab(el, d); return; }
                // Bezel: the top of the phone's screen. Hiding the phone's status bar (Android app) is
                // what lets the screen handle its camera: a black bezel band with the maker's printed logo,
                // model text and a notification LED, or a title bar kept clear of the camera.
                if (tab === 'bezel') {
                    const statusShown = !!(d.bars && !d.bars.hideStatus);
                    const POS = [['auto', 'Automatic'], ['left', 'Left'], ['center', 'Centre'], ['right', 'Right']];
                    const posLabel = (v) => (POS.find(([k]) => k === v) || POS[0])[1];
                    // the top of the screen as one choice (Yukimi, Nov 12, #777): Android's own status bar,
                    // the Windows title bar running to the edge round the camera, or the pseudo bezel
                    const MODES = (d.bars ? [['android', 'Android\'s Status Bar']] : []).concat([['windows', 'Windows Status Bar'], ['bezel', 'Pseudo Bezel']]);
                    const modeNow = () => (d.bars && !d.bars.hideStatus ? 'android' : d.camera === 'bezel' ? 'bezel' : 'windows');
                    el.innerHTML = `<div class="wm-setb-preview" aria-hidden="true"></div>
                        <div class="wm-form-row is-wide"><span class="wm-form-label">Top of screen:</span>${ui.comboHtml('topmode', (MODES.find(([k]) => k === modeNow()) || MODES[0])[1])}</div>
                        ${d.bars ? check('wmHideNavigation', 'Hide the gesture bar', d.bars.hideNavigation) : ''}
                        ${check('wmSoftkeyExtend', 'Extend softkey background under gesture bar', d.softExtend)}
                        ${check('wmCameraExtend', 'Extend Status Bar to edge of Camera', d.extend)}
                        ${check('wmStatusNoCross', 'Do not allow status icons to cross over camera hole (collapse into notification group)', d.noCross)}
                        ${check('wmCameraPortraitOnly', 'Only in portrait (a turned phone uses the whole screen)', d.portraitOnly)}
                        <div class="wm-form-gap"></div>
                        <div class="wm-form-sub">Logo</div>
                        <p>Opacity:</p>
                        <div data-f="opacity"></div>
                        <p>Size:</p>
                        <div data-f="logosize"></div>
                        <div class="wm-form-row"><span class="wm-form-label">Position:</span><button type="button" class="wm-combo" data-act="logopos"><span>${posLabel(d.logoPos)}</span></button></div>
                        <div class="wm-form-gap"></div>
                        <div class="wm-form-sub">Model text</div>
                        ${check('wmModelShow', 'Show text in a corner of the bezel', d.modelShow)}
                        <div class="wm-form-row"><span class="wm-form-label">Text:</span><input class="wm-edit" type="text" maxlength="32" autocomplete="off" data-f="model" value="${esc(d.model)}"></div>
                        <div class="wm-form-row"><span class="wm-form-label">Corner:</span><button type="button" class="wm-combo" data-act="modelpos"><span>${posLabel(d.modelPos)}</span></button></div>
                        <p>Size:</p>
                        <div data-f="modelsize"></div>
                        <div class="wm-form-gap"></div>
                        <div class="wm-form-sub">Notification LED</div>
                        ${check('wmLed', 'Show a notification LED on the bezel', d.led)}
                        <div class="wm-setb-led">
                            ${check('wmLedNotify', 'Flash for new notifications', d.ledNotify)}
                            ${check('wmLedBattery', 'Blink red when the battery is low', d.ledBattery)}
                            ${check('wmLedCharge', 'Light while charging (green when full)', d.ledCharge)}
                        </div>`;
                    const q = (sel) => el.querySelector(sel);
                    const ops = ui.trackbar(q('[data-f="opacity"]'), {
                        steps: [10, 20, 30, 40, 50, 55, 60, 70, 80, 90, 100], value: d.logoOpacity, lo: 'Faint', hi: 'Solid', label: 'Logo opacity',
                        onChange: (v) => { d.logoOpacity = v; }
                    });
                    const lsz = ui.trackbar(q('[data-f="logosize"]'), {
                        steps: BEZEL_LOGO_SIZES, value: d.logoSize, lo: 'Small', hi: 'Large', label: 'Logo size',
                        onChange: (v) => { d.logoSize = v; }
                    });
                    const msz = ui.trackbar(q('[data-f="modelsize"]'), {
                        steps: BEZEL_MODEL_SIZES, value: d.modelSize, lo: 'Small', hi: 'Large', label: 'Text size',
                        onChange: (v) => { d.modelSize = v; }
                    });
                    const bind = (name, fn) => { const i = q(`input[name="${name}"]`); if (i) i.addEventListener('change', () => { fn(i.checked); sync(); }); };
                    // everything after the status bar works only with it hidden; the bezel's parts with the bezel
                    const sync = () => {
                        const off = !!(d.bars && !d.bars.hideStatus);
                        el.querySelectorAll('input[name="wmCameraPortraitOnly"]').forEach((i) => { i.disabled = off; });
                        el.querySelectorAll('input[name="wmCameraExtend"], input[name="wmStatusNoCross"]').forEach((i) => { i.disabled = off || d.camera === 'bezel'; });
                        // only while the gesture bar shows (hidden, there is nothing under it to cover)
                        el.querySelectorAll('input[name="wmSoftkeyExtend"]').forEach((i) => { i.disabled = !!(d.bars && d.bars.hideNavigation); });
                        drawBezelPreview(q('.wm-setb-preview'), modeNow(), d);
                        const noBezel = off || d.camera !== 'bezel';
                        el.querySelectorAll('[data-act="logopos"], input[name="wmModelShow"], input[name="wmLed"]').forEach((i) => { i.disabled = noBezel; });
                        el.querySelectorAll('[data-act="modelpos"], [data-f="model"]').forEach((i) => { i.disabled = noBezel || !d.modelShow; });
                        [ops, lsz].forEach((t) => { if (t && typeof t.setDisabled === 'function') t.setDisabled(noBezel); });
                        if (msz && typeof msz.setDisabled === 'function') msz.setDisabled(noBezel || !d.modelShow);
                        el.querySelectorAll('.wm-setb-led input').forEach((i) => { i.disabled = noBezel || !d.led; });
                    };
                    if (d.bars) bind('wmHideNavigation', (v) => { d.bars.hideNavigation = v; });
                    bind('wmCameraExtend', (v) => { d.extend = v; });
                    bind('wmSoftkeyExtend', (v) => { d.softExtend = v; });
                    bind('wmStatusNoCross', (v) => { d.noCross = v; });
                    ui.bindCombo(q('[data-act="topmode"]'), MODES, modeNow(), (v) => {
                        if (d.bars) d.bars.hideStatus = v !== 'android';
                        d.camera = v === 'bezel' ? 'bezel' : 'clear';
                        sync();
                    });
                    bind('wmModelShow', (v) => { d.modelShow = v; });
                    bind('wmCameraPortraitOnly', (v) => { d.portraitOnly = v; });
                    bind('wmLed', (v) => { d.led = v; });
                    bind('wmLedNotify', (v) => { d.ledNotify = v; });
                    bind('wmLedBattery', (v) => { d.ledBattery = v; });
                    bind('wmLedCharge', (v) => { d.ledCharge = v; });
                    q('[data-f="model"]').addEventListener('input', (e) => { d.model = e.target.value; });
                    ui.bindCombo(q('[data-act="logopos"]'), POS, d.logoPos, (v) => { d.logoPos = v; });
                    ui.bindCombo(q('[data-act="modelpos"]'), POS.filter(([k]) => k !== 'center'), d.modelPos, (v) => { d.modelPos = v; });
                    sync();
                    if (statusShown) { /* the controls stay visible, disabled, so the dependency is clear */ }
                    return;
                }
                // (the title bar's status icon options moved to Connections > Cellular and Bluetooth, #771)
                const n = SCALES.length;
                const pos = (i) => `calc(4 * var(--wm-px) + (100% - 8 * var(--wm-px)) * ${i / (n - 1)})`;
                el.innerHTML = `<p>Adjust the text size to see more content or increase the readability in many programs.</p>
                    ${noteScreen() ? `<p>${wideScreen() ? 'This size is for the main screen. The cover screen keeps its own.' : 'This size is for the cover screen. The main screen keeps its own.'}</p>` : ''}
                    <div class="wm-slider-scale"><span>Smallest</span><span>Largest</span></div>
                    <div class="wm-slider" role="slider" tabindex="0" aria-label="Text size" aria-valuemin="0" aria-valuemax="${n - 1}">
                        <div class="wm-slider-track"></div>
                        ${SCALES.map((_, i) => `<div class="wm-slider-tick" style="left:${pos(i)}"></div>`).join('')}
                        <div class="wm-slider-thumb"></div>
                    </div>
                    <div class="wm-form-sub">Example:</div>
                    <p data-f="example">I'll get back to you.</p>`;
                const slider = el.querySelector('.wm-slider');
                const thumb = el.querySelector('.wm-slider-thumb');
                const example = el.querySelector('[data-f="example"]');
                const set = (i) => {
                    i = Math.max(0, Math.min(n - 1, i));
                    d.scale = SCALES[i];
                    thumb.style.left = pos(i);
                    slider.setAttribute('aria-valuenow', String(i));
                    // the device's text: 10.5 units (8 pt) in 6.1 and 6.5
                    example.style.fontSize = `${10.5 * d.scale}px`;
                    example.style.lineHeight = `${13 * d.scale}px`;
                };
                const fromX = (x) => {
                    const r = slider.getBoundingClientRect();
                    return Math.round(((x - r.left) / Math.max(1, r.width)) * (n - 1));
                };
                slider.addEventListener('pointerdown', (e) => {
                    slider.setPointerCapture(e.pointerId);
                    set(fromX(e.clientX));
                    const move = (ev) => set(fromX(ev.clientX));
                    const up = () => { slider.removeEventListener('pointermove', move); slider.removeEventListener('pointerup', up); slider.removeEventListener('pointercancel', up); };
                    slider.addEventListener('pointermove', move);
                    slider.addEventListener('pointerup', up);
                    slider.addEventListener('pointercancel', up);
                });
                slider.addEventListener('keydown', (e) => {
                    const i = SCALES.indexOf(d.scale);
                    if (e.key === 'ArrowLeft') { set(i - 1); e.preventDefault(); } else if (e.key === 'ArrowRight') { set(i + 1); e.preventDefault(); }
                });
                set(SCALES.indexOf(d.scale));
            },
            commit(d) {
                const keys = [];
                if (d.barsState && d.barsCfg && JSON.stringify(d.barsCfg) !== JSON.stringify(d.barsState.config || {})) {
                    try { window.AndroidBars.setConfig(JSON.stringify(d.barsCfg)); } catch (_) { /* older app */ }
                }
                const bars = systemBars();
                if (d.bars && bars && (d.bars.hideStatus !== bars.hideStatus || d.bars.hideNavigation !== bars.hideNavigation)) {
                    try { window.AndroidDisplay.setSystemBars(!!d.bars.hideStatus, !!d.bars.hideNavigation); } catch (_) { /* older app */ }
                }
                // Bezel: logo, model text, LED (wmShell syncBezel / paintBezelLed read them)
                const bezelSets = [
                    [K.bezelLogoOpacity, d.logoOpacity === 55 ? null : String(d.logoOpacity)],
                    [K.bezelLogoSize, d.logoSize === 70 ? null : String(d.logoSize)],
                    [K.bezelLogoPos, d.logoPos === 'auto' ? null : d.logoPos],
                    [K.bezelModelShow, d.modelShow ? '1' : null],
                    [K.bezelModelSize, d.modelSize === 30 ? null : String(d.modelSize)],
                    [K.bezelModel, String(d.model || '').trim().slice(0, 32) || null],
                    [K.bezelModelPos, d.modelPos === 'auto' ? null : d.modelPos],
                    [K.bezelLed, d.led ? '1' : null],
                    [K.bezelLedNotify, d.ledNotify ? null : '0'],
                    [K.bezelLedBattery, d.ledBattery ? null : '0'],
                    [K.bezelLedCharge, d.ledCharge ? null : '0']
                ];
                for (const [k, v] of bezelSets) {
                    if ((lsGet(k) || null) !== v) { lsSet(k, v); keys.push(k); }
                }
                if (d.noCross !== (lsGet(K.statusNoCross) === '1')) {
                    lsSet(K.statusNoCross, d.noCross ? '1' : null);
                    keys.push(K.statusNoCross);
                }
                if (d.softExtend !== (lsGet(K.softkeyExtend) === '1')) {
                    lsSet(K.softkeyExtend, d.softExtend ? '1' : null);
                    applySoftkeyExtend();
                    keys.push(K.softkeyExtend);
                }
                if (d.extend !== (lsGet(K.cameraExtend) === '1')) {
                    lsSet(K.cameraExtend, d.extend ? '1' : null);
                    keys.push(K.cameraExtend);
                }
                if (d.portraitOnly !== (lsGet(K.cameraPortraitOnly) === '1')) {
                    lsSet(K.cameraPortraitOnly, d.portraitOnly ? '1' : null);
                    keys.push(K.cameraPortraitOnly);
                }
                if (d.camera !== cameraStyle()) {
                    lsSet(K.camera, d.camera === 'bezel' ? 'bezel' : null);
                    applyCamera();
                    keys.push(K.camera);
                }
                if (d.scale === currentScale() && storedScale() !== null) return keys;
                const sk = scaleKey();
                lsSet(sk, String(d.scale));
                applyScale();
                return keys.concat(sk);
            }
        },
        {
            id: 'connections', tab: 'connections', label: 'Connections', icon: 'set-connections',
            tabs: [['tasks', 'Tasks']],
            init: () => ({}),
            render(el, tab, d, api) {
                const ws = window.wsClient;
                const connected = !!(ws && typeof ws.isConnected === 'function' && ws.isConnected());
                let state = 'Not connected';
                if (connected && ws.initializationCompleted) state = 'Connected';
                else if (connected) state = 'Connecting...';
                else if (ws && ws.connectionPhase && ws.connectionPhase !== 'failed' && ws.connectionPhase !== 'idle') state = (ws.connectionUi && ws.connectionUi.message) || 'Connecting...';
                let host = location.host;
                try { if (ws && ws.ws && ws.ws.url) host = new URL(ws.ws.url).host; } catch (_) { /* page host */ }
                const since = ws && ws.connectionStats && ws.connectionStats.connectedAt;
                el.innerHTML = `<div class="wm-form-sub">Dreamscape server</div>
                    <div class="wm-form-row is-wide"><span class="wm-form-label">Status:</span><span class="wm-form-value">${esc(state)}</span></div>
                    <div class="wm-form-row is-wide"><span class="wm-form-label">Server:</span><span class="wm-form-value">${esc(host)}</span></div>
                    ${since && connected ? `<div class="wm-form-row is-wide"><span class="wm-form-label">Connected since:</span><span class="wm-form-value">${esc(new Date(since).toLocaleTimeString())}</span></div>` : ''}
                    <div class="wm-buttons is-right"><button type="button" class="wm-button" data-act="reconnect">Reconnect</button></div>`;
                el.querySelector('[data-act="reconnect"]').addEventListener('click', () => {
                    if (ws && typeof ws.manualReconnect === 'function') ws.manualReconnect();
                    setTimeout(() => { if (el.isConnected) api.rerender(); }, 1500);
                });
                clearTimeout(d.timer);
                d.timer = setTimeout(() => { if (el.isConnected) api.rerender(); }, 3000);
            }
        },
        {
            id: 'remote', tab: 'personal', label: 'Remote Access', icon: 'app-remote-desktop-mobile-lg',
            tabs: [['general', 'General']],
            available: () => typeof window.setAgentPriorityClient === 'function' && typeof window.isAgentPriorityClient === 'function',
            init: () => ({ on: !!window.isAgentPriorityClient() }),
            render(el, tab, d) {
                el.innerHTML = `<p>Agents that test the client use the development client first.</p>
                    ${check('prio', 'Use this phone for development testing', d.on)}
                    <p class="wm-form-note" style="margin-top:calc(8 * var(--wm-px))">Applies to this window until it is closed.</p>`;
                el.querySelector('input').addEventListener('change', (e) => { d.on = e.target.checked; });
            },
            commit(d) {
                if (!!window.isAgentPriorityClient() !== d.on) window.setAgentPriorityClient(d.on);
                return [];
            }
        }
    ];

    const SET_TABS = [['personal', 'Personal'], ['system', 'System'], ['connections', 'Connections']];

    // ---------------------------------------------------------------- page registry
    // Other files add Settings pages without editing this one (wmSettings<Group>.js, loaded after
    // this file in app.html):
    //   wmSettings.registerPage(page)   same shape as PAGES; tab 'personal' | 'system' | 'connections';
    //                                   an id already registered is replaced (late wins), so a group
    //                                   file can take over one of the pages above
    //   wmSettings.extendPage(pageId, ext)
    //                                   more tabs on a page that exists (a page without tabs names its
    //                                   own first one with ownTab: [id, label]): ext = { id, tabs [[id, label]],
    //                                   after? (the tab they follow; default the end), available()?,
    //                                   init() -> its own draft, render(el, tabId, draft, api),
    //                                   commit(draft) -> keys | false | Promise }; tab ids must not
    //                                   clash with the page's own (prefix them with the ext id)
    //   wmSettings.open(pageId, tabId?) opens Settings on that page
    //   wmSettings.ui                   the form helpers every page uses (below)
    // The grid sorts by label, as WM does; a page registered while the grid shows redraws it.

    const PAGE_GRIDS = new Set(SET_TABS.map(([id]) => id));
    const EXTS = new Map(); // page id -> [ext]
    let settingsHost = null; // registerSettings(): { refresh(), openPage(id, tab) }

    const safeAvailable = (x) => {
        if (!x || typeof x.available !== 'function') return true;
        try { return !!x.available(); } catch (err) { console.warn('Settings: available() failed', x.id, err); return false; }
    };

    function registerPage(page) {
        if (!page || typeof page.id !== 'string' || !page.id || !PAGE_GRIDS.has(page.tab) || !page.label || typeof page.render !== 'function') {
            console.warn('wmSettings.registerPage: not a page', page && page.id);
            return false;
        }
        const def = { tabs: [], init: () => ({}), ...page };
        const at = PAGES.findIndex((p) => p.id === def.id);
        if (at >= 0) PAGES[at] = def;
        else PAGES.push(def);
        if (settingsHost) settingsHost.refresh();
        return true;
    }

    function extendPage(pageId, ext) {
        if (!pageId || !ext || !ext.id || !Array.isArray(ext.tabs) || !ext.tabs.length || typeof ext.render !== 'function') {
            console.warn('wmSettings.extendPage: not an extension', pageId, ext && ext.id);
            return false;
        }
        const list = EXTS.get(pageId) || [];
        const at = list.findIndex((x) => x.id === ext.id);
        if (at >= 0) list[at] = ext;
        else list.push(ext);
        EXTS.set(pageId, list);
        if (settingsHost) settingsHost.refresh();
        return true;
    }

    function extsFor(def) {
        return (EXTS.get(def.id) || []).filter(safeAvailable);
    }

    /** The page's tabs with its extensions' tabs placed in. */
    function tabsWith(def, exts) {
        const tabs = (def.tabs || []).slice();
        // a page with no tabs of its own keeps its page as the first tab once an extension adds one
        // (ownTab: [id, label]; Remove Programs > Programs | Android, #773)
        if (!tabs.length && exts.length && Array.isArray(def.ownTab)) tabs.push(def.ownTab);
        for (const x of exts) {
            const own = x.tabs.filter((t) => !tabs.some(([id]) => id === t[0]));
            const i = x.after ? tabs.findIndex(([id]) => id === x.after) : -1;
            if (i >= 0) tabs.splice(i + 1, 0, ...own);
            else tabs.push(...own);
        }
        return tabs;
    }

    // ---- wmSettings.ui: WM 6.1 form idioms (wm-programs.css), so every page looks the same.
    // The *Html helpers return markup; the bind* helpers wire it after el.innerHTML is set.
    // Controls that draw themselves into a host element and return a small handle: trackbar,
    // dateField / monthCalendar, timeCombo, timeField, colorField, mediaBar. They stand where a page would
    // otherwise reach for the browser's range, date, time or colour input or its media controls
    // (no-native-browser-ui.mdc).

    const escUi = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    let uiSeq = 0;
    let calPop = null; // the open month calendar: { el, away, anchor }
    let calSkip = null; // the control whose tap just closed its calendar
    const pops = []; // the open pop-up panels, bottom first: [{ el, away, anchor, onClose }]
    let popSkip = null; // the control whose tap just closed its panel
    let padOpen = null; // the number pad's layer while it is up
    const CAL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    // the sixteen system colours, in the order of the system palette: [['#rrggbb', name]]; silver and
    // gray are the two greys, the others the red / green / blue bits at half (0 - 6) or full (9 - 15)
    const WM_COLORS = ['Black', 'Maroon', 'Green', 'Olive', 'Navy', 'Purple', 'Teal', 'Silver', 'Gray', 'Red', 'Lime', 'Yellow', 'Blue', 'Fuchsia', 'Aqua', 'White'].map((name, i) => {
        const grey = i === 7 ? 192 : i === 8 ? 128 : -1;
        const level = i < 8 ? 128 : 255;
        const bits = i < 8 ? i : i - 8;
        return [`#${[1, 2, 4].map((b) => (grey >= 0 ? grey : (bits & b ? level : 0)).toString(16).padStart(2, '0')).join('')}`, name];
    });

    const ui = {
        esc: escUi,
        /** A unique id for a label's for= (pages render more than once). */
        uid: (p = 'wmSet') => `${p}${++uiSeq}`,
        /** Check box: name, label, checked, extra attributes (e.g. 'data-k="x" disabled'). */
        check: (name, label, checked, attrs = '') => `<label class="wm-check"><input type="checkbox" name="${escUi(name)}"${checked ? ' checked' : ''} ${attrs}><span>${escUi(label)}</span></label>`,
        /** Radio button of the group `name`. */
        radio: (name, value, label, checked, attrs = '') => `<label class="wm-check"><input type="radio" name="${escUi(name)}" value="${escUi(value)}"${checked ? ' checked' : ''} ${attrs}><span>${escUi(label)}</span></label>`,
        /** Label + control on one line (WM's "Name: [____]"); opts.wide = the long-label layout, opts.for = the control's id. */
        row: (label, controlHtml, opts = {}) => `<div class="wm-form-row${opts.wide ? ' is-wide' : ''}">${opts.for ? `<label for="${escUi(opts.for)}">${escUi(label)}</label>` : `<span class="wm-form-label">${escUi(label)}</span>`}${controlHtml}</div>`,
        /** Read-only "Label: value" row. */
        value: (label, text, opts = {}) => `<div class="wm-form-row${opts.wide ? ' is-wide' : ''}"><span class="wm-form-label">${escUi(label)}</span><span class="wm-form-value">${escUi(text)}</span></div>`,
        /** Single-line edit box (attrs: maxlength, readonly, disabled, data-*). */
        edit: (id, value, attrs = '') => `<input${id ? ` id="${escUi(id)}"` : ''} class="wm-edit" type="text" autocomplete="off" value="${escUi(value)}" ${attrs}>`,
        /** Combo box button showing `label`; open it with bindCombo. */
        comboHtml: (act, label, disabled = false) => `<button type="button" class="wm-combo" data-act="${escUi(act)}"${disabled ? ' disabled' : ''}><span>${escUi(label)}</span></button>`,
        /**
         * Open the WM drop-down list under a combo: options [[value, label]], the current value,
         * onPick(value). The button's text follows the pick.
         */
        bindCombo(btn, options, current, onPick, align = 'left') {
            if (!btn) return;
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (btn.disabled || !sh) return;
                const box = btn.closest('.wm-combo-edit') || btn;
                // 6.5.1 (#850) controls: the shell's drop-down list, only looked for on that release
                const list651 = document.documentElement.dataset.wmRev === '6.5.1' ? () => document.querySelector('#wmShell .wm-popup[data-side="dropdown"]') : null;
                sh.dropdown(box, options.map(([v, l]) => ({
                    label: l,
                    radio: v === current,
                    action: () => {
                        current = v;
                        const span = btn.querySelector('span');
                        if (span) span.textContent = l;
                        onPick(v);
                    }
                })), align, list651 ? () => { const p = list651(); if (p) p.style.removeProperty('--wm651-list-w'); } : null);
                // 6.5.1 (#850) controls: the list is 17 px (8.5 units) wider than its box (device:
                // a 420 px box opens a 437 px list, 392 opens 409, 140 opens 157); wm65.css centres
                // it and takes the width from this property, which goes when the list closes (a
                // list opened by other code gets the stylesheet's width)
                if (list651 && box.getAttribute('aria-expanded') === 'true') {
                    const pop = list651();
                    const unit = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--wm-px')) || 1;
                    if (pop) pop.style.setProperty('--wm651-list-w', `${box.getBoundingClientRect().width + 8.5 * unit}px`);
                }
            });
        },
        /** Section heading inside a page (WM's bold sub-header). */
        sub: (text) => `<div class="wm-form-sub">${escUi(text)}</div>`,
        /** Grey explanatory note. */
        note: (text) => `<p class="wm-form-note">${escUi(text)}</p>`,
        /** Paragraph of body text. */
        text: (text) => `<p>${escUi(text)}</p>`,
        gap: () => '<div class="wm-form-gap"></div>',
        /** Push buttons: [[act, label, disabled?]]; right = WM's right-aligned row. */
        buttons: (list, right = true) => `<div class="wm-buttons${right ? ' is-right' : ''}">${list.map(([act, label, off]) => `<button type="button" class="wm-button" data-act="${escUi(act)}"${off ? ' disabled' : ''}>${escUi(label)}</button>`).join('')}</div>`,
        /** "Label: value" pairs in two columns (About's facts): [[label, value]]. */
        facts: (pairs) => `<div class="wm-facts">${pairs.map(([l, v]) => `<span>${escUi(l)}</span><span>${escUi(v)}</span>`).join('')}</div>`,
        /**
         * List box: rows [{ key, label, selected?, checked? (a check box row), img?, indent? }],
         * opts.maxHeight in WM px (scrolls past it).
         */
        listbox: (rows, opts = {}) => `<div class="wm-listbox"${opts.maxHeight ? ` style="max-height:calc(${Number(opts.maxHeight)} * var(--wm-px))"` : ''}>${rows.map((r) => {
            const cls = `wm-listbox-row${r.selected ? ' is-selected' : ''}${r.indent ? ' is-indent' : ''}`;
            const img = r.img ? `<img src="${escUi(r.img)}" alt="" draggable="false">` : '';
            if (r.checked !== undefined) return `<div class="${cls}" data-key="${escUi(r.key)}">${ui.check(`lb-${r.key}`, r.label, r.checked, `data-key="${escUi(r.key)}"`)}</div>`;
            return `<button type="button" class="${cls}" data-key="${escUi(r.key)}">${img}<span>${escUi(r.label)}</span></button>`;
        }).join('')}</div>`,
        /** Row taps select (onSelect(key)); check box rows also report onCheck(key, checked). */
        bindListbox(box, onSelect, onCheck) {
            if (!box) return;
            box.querySelectorAll('.wm-listbox-row').forEach((row) => {
                const key = row.dataset.key;
                row.addEventListener('click', (e) => {
                    if (e.target.closest('input')) return;
                    box.querySelectorAll('.wm-listbox-row.is-selected').forEach((r) => r.classList.remove('is-selected'));
                    row.classList.add('is-selected');
                    if (onSelect) onSelect(key);
                });
                const input = row.querySelector('input[type="checkbox"]');
                if (input && onCheck) input.addEventListener('change', () => onCheck(key, input.checked));
            });
        },
        /**
         * Horizontal trackbar (Screen's Text Size look) rendered into `host`: steps = the values,
         * value = the current one, lo / hi = the scale's end labels, label = its accessible name,
         * onChange(value), ticks = a tick mark every that many steps (1; a long scale such as
         * 0 - 100 takes 10, 0 draws none). Returns { set(value) }.
         */
        trackbar(host, { steps, value, lo = '', hi = '', label = '', onChange, disabled = false, ticks = 1 }) {
            const n = steps.length;
            const pos = (i) => `calc(4 * var(--wm-px) + (100% - 8 * var(--wm-px)) * ${n > 1 ? i / (n - 1) : 0})`;
            host.insertAdjacentHTML('beforeend', `<div class="wm-slider-scale"><span>${escUi(lo)}</span><span>${escUi(hi)}</span></div>
                <div class="wm-slider${disabled ? ' is-disabled' : ''}" role="slider"${disabled ? ' aria-disabled="true"' : ' tabindex="0"'} aria-label="${escUi(label)}" aria-valuemin="0" aria-valuemax="${n - 1}">
                    <div class="wm-slider-track"></div>
                    ${steps.map((_, i) => (ticks > 0 && (i % ticks === 0 || i === n - 1) ? `<div class="wm-slider-tick" style="left:${pos(i)}"></div>` : '')).join('')}
                    <div class="wm-slider-thumb"></div>
                </div>`);
            const sliders = host.querySelectorAll('.wm-slider');
            const slider = sliders[sliders.length - 1];
            const thumb = slider.querySelector('.wm-slider-thumb');
            let idx = Math.max(0, steps.indexOf(value));
            const show = () => {
                thumb.style.left = pos(idx);
                slider.setAttribute('aria-valuenow', String(idx));
                slider.setAttribute('aria-valuetext', String(steps[idx]));
            };
            const setIdx = (i, fire) => {
                i = Math.max(0, Math.min(n - 1, i));
                if (i === idx && !fire) return;
                const was = idx;
                idx = i;
                show();
                if (fire && was !== idx && onChange) onChange(steps[idx]);
            };
            show();
            if (!disabled) {
                const fromX = (x) => {
                    const r = slider.querySelector('.wm-slider-track').getBoundingClientRect();
                    return Math.round(((x - r.left) / Math.max(1, r.width)) * (n - 1));
                };
                slider.addEventListener('pointerdown', (e) => {
                    if (e.button > 0) return;
                    e.stopPropagation();
                    e.preventDefault();
                    slider.focus({ preventScroll: true });
                    slider.setPointerCapture(e.pointerId);
                    setIdx(fromX(e.clientX), true);
                    const move = (ev) => { ev.stopPropagation(); setIdx(fromX(ev.clientX), true); };
                    const up = () => { slider.removeEventListener('pointermove', move); slider.removeEventListener('pointerup', up); slider.removeEventListener('pointercancel', up); };
                    slider.addEventListener('pointermove', move);
                    slider.addEventListener('pointerup', up);
                    slider.addEventListener('pointercancel', up);
                });
                ['touchstart', 'touchmove'].forEach((t) => slider.addEventListener(t, (e) => e.stopPropagation(), { passive: true }));
                slider.addEventListener('keydown', (e) => {
                    const step = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
                    if (step !== undefined) setIdx(idx + step, true);
                    else if (e.key === 'Home') setIdx(0, true);
                    else if (e.key === 'End') setIdx(n - 1, true);
                    else return;
                    e.preventDefault();
                    e.stopPropagation();
                });
            }
            return { set: (v) => setIdx(Math.max(0, steps.indexOf(v)), false) };
        },
        /**
         * The WM month calendar (the date control's drop-down, SysMonthCal32; 6.1 and 6.5 emulators,
         * Calendar and Tasks): the month band in the highlight with its two arrow buttons, the week's
         * letters over a rule, six weeks of days, "Today: M/D/YY" and, with none, "None". It hangs
         * under `anchor`, pulled left to stay on the screen; with no room below it opens at the top
         * of the screen (device: x 67 px, y 0). opts: value (Date or null), none, onPick(Date | null).
         * One at a time; a tap outside closes it. monthCalendarOpen() / closeMonthCalendar() are for
         * an app's back key and historyDepth.
         */
        monthCalendar(anchor, { value = null, none = false, onPick } = {}) {
            ui.closeMonthCalendar();
            const host = document.getElementById('wmShell') || document.body;
            const el = document.createElement('div');
            el.className = 'wm-cal';
            el.setAttribute('role', 'dialog');
            el.setAttribute('aria-label', 'Calendar');
            const day0 = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
            const today = day0(new Date());
            const picked = value ? day0(value) : null;
            let month = new Date((picked || today).getFullYear(), (picked || today).getMonth(), 1);
            const draw = () => {
                // a month that starts on a Sunday shows the week before it first (the device's month calendar)
                const first = new Date(month.getFullYear(), month.getMonth(), 1 - (month.getDay() || 7));
                let cells = '';
                for (let i = 0; i < 42; i++) {
                    const d = new Date(first.getFullYear(), first.getMonth(), first.getDate() + i);
                    const cls = ['wm-cal-day'];
                    if (d.getMonth() !== month.getMonth()) cls.push('is-other');
                    if (+d === +today) cls.push('is-today');
                    if (picked && +d === +picked) cls.push('is-picked');
                    cells += `<button type="button" class="${cls.join(' ')}" data-day="${d.getTime()}">${d.getDate()}</button>`;
                }
                el.innerHTML = `<div class="wm-cal-head"><button type="button" class="wm-cal-nav" data-nav="-1" aria-label="Previous month"></button><span>${CAL_MONTHS[month.getMonth()]} ${month.getFullYear()}</span><button type="button" class="wm-cal-nav" data-nav="1" aria-label="Next month"></button></div>`
                    + `<div class="wm-cal-week">${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((c) => `<span>${c}</span>`).join('')}</div>`
                    + `<div class="wm-cal-grid">${cells}</div>`
                    + `<button type="button" class="wm-cal-line" data-day="${today.getTime()}">Today: ${today.getMonth() + 1}/${today.getDate()}/${String(today.getFullYear() % 100).padStart(2, '0')}</button>`
                    + (none ? '<button type="button" class="wm-cal-line is-none" data-day="">None</button>' : '');
            };
            draw();
            el.addEventListener('click', (e) => {
                const nav = e.target.closest('[data-nav]');
                if (nav) { month = new Date(month.getFullYear(), month.getMonth() + Number(nav.dataset.nav), 1); draw(); return; }
                const day = e.target.closest('[data-day]');
                if (!day) return;
                const d = day.dataset.day ? new Date(Number(day.dataset.day)) : null;
                ui.closeMonthCalendar();
                if (onPick) onPick(d);
            });
            const away = (e) => {
                if (el.contains(e.target)) return;
                e.preventDefault();
                e.stopPropagation();
                // a tap on the control that opened it closes it, and that tap's click does not open it again
                if (anchor && anchor.contains && anchor.contains(e.target)) { calSkip = anchor; setTimeout(() => { calSkip = null; }, 400); }
                ui.closeMonthCalendar();
            };
            host.appendChild(el);
            // under the control while it fits on the screen, else from the top of the screen
            const hr = host.getBoundingClientRect();
            const unit = el.offsetWidth / 170;
            const r = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : null;
            if (r && r.bottom - hr.top + el.offsetHeight <= hr.height + 0.5) {
                el.style.left = `${Math.max(0, Math.min(r.left - hr.left, hr.width - 2.5 * unit - el.offsetWidth))}px`;
                el.style.top = `${r.bottom - hr.top}px`;
            } else {
                el.classList.add('is-top');
                el.style.left = `${Math.max(0, Math.min(33.5 * unit, hr.width - el.offsetWidth))}px`;
                el.style.top = '0px';
            }
            calPop = { el, away, anchor };
            setTimeout(() => { if (calPop && calPop.el === el) document.addEventListener('pointerdown', away, true); }, 0);
            if (sh && typeof sh.syncHistory === 'function') sh.syncHistory();
        },
        monthCalendarOpen: () => !!calPop,
        /** True right after a tap on `anchor` closed its own calendar: that tap's click must not open it again. */
        monthCalendarJustClosed: (anchor) => { if (calSkip !== anchor) return false; calSkip = null; return true; },
        /** Closes the open month calendar; true when there was one. */
        closeMonthCalendar() {
            if (!calPop) return false;
            document.removeEventListener('pointerdown', calPop.away, true);
            calPop.el.remove();
            calPop = null;
            if (sh && typeof sh.syncHistory === 'function') sh.syncHistory();
            return true;
        },
        /**
         * A framed pop-up box hung from a control: a tool bar button's own panel (a number's
         * trackbar, a list of check rows with their weights). It hangs under the control while it
         * fits between the title bar and the soft keys, else over it (a bar at the foot of the page
         * opens its panels upwards), pulled in to stay on the screen; a tall one scrolls. Panels
         * stack (a weight's trackbar over the list it came from); a tap outside the top one closes
         * only that one, and that tap does nothing else. opts: label (accessible name), className,
         * build(el) fills it, onClose(). Returns { el, close, place } (place() fits it again after
         * its content changed size).
         */
        popPanel(anchor, { label = '', className = '', build, onClose } = {}) {
            const host = document.getElementById('wmShell') || document.body;
            const el = document.createElement('div');
            el.className = `wm-pop${className ? ` ${className}` : ''}`;
            el.setAttribute('role', 'dialog');
            if (label) el.setAttribute('aria-label', label);
            host.appendChild(el);
            if (typeof build === 'function') build(el);
            const place = () => {
                if (!el.isConnected) return;
                const hr = host.getBoundingClientRect();
                const content = host.querySelector('.wm-content');
                const cr = content ? content.getBoundingClientRect() : hr;
                const unit = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--wm-px')) || 1;
                const pad = 2 * unit;
                el.style.maxWidth = `${Math.max(0, cr.width - 2 * pad)}px`;
                el.style.maxHeight = `${Math.max(0, cr.height - 2 * pad)}px`;
                const w = el.offsetWidth;
                const h = el.offsetHeight;
                const r = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : cr;
                let top = r.bottom;
                if (top + h > cr.bottom - pad) top = r.top - h >= cr.top + pad ? r.top - h : Math.max(cr.top + pad, cr.bottom - pad - h);
                const left = Math.max(cr.left + pad, Math.min(r.left, cr.right - pad - w));
                el.style.left = `${left - hr.left}px`;
                el.style.top = `${top - hr.top}px`;
            };
            place();
            const close = () => {
                const at = pops.findIndex((p) => p.el === el);
                if (at < 0) return;
                // the panels opened from this one go with it
                pops.splice(at).reverse().forEach((p) => {
                    document.removeEventListener('pointerdown', p.away, true);
                    // told first, while its content is still there to read (a typed value)
                    if (typeof p.onClose === 'function') { try { p.onClose(p.el); } catch (_) { /* the caller's own */ } }
                    p.el.remove();
                    if (p.anchor && typeof p.anchor.setAttribute === 'function') p.anchor.setAttribute('aria-expanded', 'false');
                });
                if (sh && typeof sh.syncHistory === 'function') sh.syncHistory();
            };
            const away = (e) => {
                if (pops[pops.length - 1] !== entry || el.contains(e.target)) return;
                e.preventDefault();
                e.stopPropagation();
                // a tap on the control that opened it closes it, and that tap's click does not open it again
                if (anchor && anchor.contains && anchor.contains(e.target)) { popSkip = anchor; setTimeout(() => { if (popSkip === anchor) popSkip = null; }, 400); }
                close();
            };
            const entry = { el, away, anchor, onClose, close };
            pops.push(entry);
            if (anchor && typeof anchor.setAttribute === 'function') anchor.setAttribute('aria-expanded', 'true');
            setTimeout(() => { if (pops.includes(entry)) document.addEventListener('pointerdown', away, true); }, 0);
            if (sh && typeof sh.syncHistory === 'function') sh.syncHistory();
            return { el, close, place };
        },
        popPanelOpen: () => pops.length > 0,
        /** True right after a tap on `anchor` closed its own panel: that tap's click must not open it again. */
        popPanelJustClosed: (anchor) => { if (popSkip !== anchor) return false; popSkip = null; return true; },
        /** Closes the top pop-up panel (an app's back key); true when there was one. */
        closePopPanel() {
            const p = pops[pops.length - 1];
            if (!p) return false;
            p.close();
            return true;
        },
        /** Closes every pop-up panel (the program leaves the screen). */
        closePopPanels() { let n = 0; while (pops.length && n < 20) { ui.closePopPanel(); n += 1; } },
        /**
         * Jog wheel rendered into `host`: a ridged thumbwheel seen edge-on in a sunken frame (the
         * ridges crowd and darken towards both ends, as on a cylinder); a sideways drag rolls it,
         * one step of the value per `stepPx` WM units rolled, each step a detent (the shell's touch
         * tick), with no ends to the wheel itself (the value stops at min / max); a flick rolls on
         * and slows (inertia). Left / Right step it, Home / End go to the ends. opts: value,
         * min, max, step, fineStep (a roll slower than fineSpeed WM units a second, 160, steps by this
         * instead: fine adjust is the usual, a quick roll takes whole steps), zeroStop (detents a value
         * rests at 0 before it crosses to the other sign, 4; 0 = none), current() (onStep wheels: the
         * value now, for the stop at zero), label (accessible name), stepPx (16: a deliberate roll per step), onChange(value) on every step,
         * onStep(dir, fine) instead of a value (a wheel that steps something else: emphasis), disabled.
         * Returns { set(value), el }.
         */
        jogWheel(host, { value = 0, min = -Infinity, max = Infinity, step = 1, fineStep = 0, fineSpeed = 160, label = '', stepPx = 16, onChange, onStep, current = null, zeroStop = 4, disabled = false } = {}) {
            const RIDGES = 18;
            host.insertAdjacentHTML('beforeend', `<div class="wm-jog${disabled ? ' is-disabled' : ''}" role="slider"${disabled ? ' aria-disabled="true"' : ' tabindex="0"'} aria-label="${escUi(label)}"><div class="wm-jog-wheel">${'<span class="wm-jog-ridge"></span>'.repeat(RIDGES)}</div></div>`);
            const all = host.querySelectorAll('.wm-jog');
            const el = all[all.length - 1];
            const ridges = [...el.querySelectorAll('.wm-jog-ridge')];
            const places = (v) => (String(v).split('.')[1] || '').length;
            const dg = Math.max(places(step), fineStep ? places(fineStep) : 0);
            let cur = Number(value) || 0;
            let phase = 0; // the wheel's turn, in ridge spacings
            const draw = () => {
                ridges.forEach((r, i) => {
                    // each ridge's angle on the half of the wheel that faces the eye (-90 .. 90 deg)
                    const t = (((i + phase) % RIDGES) + RIDGES) % RIDGES / RIDGES;
                    const a = (t - 0.5) * Math.PI;
                    r.style.left = `${(50 + 50 * Math.sin(a)).toFixed(2)}%`;
                    r.style.opacity = (0.35 + 0.65 * Math.cos(a)).toFixed(2);
                });
                if (onStep) return;
                el.setAttribute('aria-valuenow', String(cur));
                el.setAttribute('aria-valuetext', cur.toFixed(dg));
                if (Number.isFinite(min)) el.setAttribute('aria-valuemin', String(min));
                if (Number.isFinite(max)) el.setAttribute('aria-valuemax', String(max));
            };
            // a detent: the shell's short touch tick on every step (Settings decide whether it buzzes)
            const detent = () => { if (sh && typeof sh.vibrate === 'function') sh.vibrate('tick'); };
            // the stop at zero: a value that reaches 0 from either side rests there for zeroStop more
            // detents' worth of roll before it goes on to the other side (a heavier buzz marks it)
            let zeroDebt = 0;
            let zeroDir = 0;
            const atZero = (from, dir) => {
                if (!zeroStop) return;
                zeroDebt = zeroStop;
                zeroDir = dir;
                if (sh && typeof sh.vibrate === 'function') sh.vibrate('land');
            };
            /** True while the roll is still pushing through the stop at zero (the step is taken up). */
            const heldAtZero = (value, dir) => {
                if (!zeroStop || value !== 0 || !zeroDebt) return false;
                if (dir !== zeroDir) { zeroDebt = 0; return false; }
                zeroDebt -= 1;
                return true;
            };
            // fine: a slow roll steps by fineStep (the hundredths of a guidance), only a quick one by step
            const move = (n, fine = false) => {
                if (!n) return;
                const dir = Math.sign(n);
                if (onStep) {
                    for (let k = 0; k < Math.abs(n); k++) {
                        const was = typeof current === 'function' ? Number(current()) : NaN;
                        if (heldAtZero(was, dir)) continue;
                        onStep(dir, fine);
                        detent();
                        const now = typeof current === 'function' ? Number(current()) : NaN;
                        if (now === 0 && was !== 0) atZero(was, dir);
                    }
                    return;
                }
                const by = fine && fineStep ? fineStep : step;
                for (let k = 0; k < Math.abs(n); k++) {
                    if (heldAtZero(cur, dir)) continue;
                    let next = Math.max(min, Math.min(max, Number((cur + dir * by).toFixed(dg))));
                    // a step across zero stops on it
                    if (zeroStop && ((cur > 0 && next < 0) || (cur < 0 && next > 0))) next = 0;
                    if (next === cur) break;
                    const was = cur;
                    cur = next;
                    detent();
                    if (cur === 0 && was !== 0) atZero(was, dir);
                }
                draw();
                if (onChange) onChange(cur);
            };
            // inertia after a flick: the speed (px a ms) falls by a share each frame until it is slow
            const GLIDE_MIN = 120; // WM units a second
            let glideRaf = 0;
            const cancelGlide = () => { if (glideRaf) cancelAnimationFrame(glideRaf); glideRaf = 0; el.classList.remove('is-rolling'); };
            const glide = (v0, per, width, rest0) => {
                let v = v0;
                let rest = rest0;
                let last = performance.now();
                const unit = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--wm-px')) || 1;
                el.classList.add('is-rolling');
                const frame = (now) => {
                    const dt = Math.min(50, Math.max(1, now - last));
                    last = now;
                    const dx = v * dt;
                    phase += (2 * dx * RIDGES) / (width * Math.PI);
                    rest += dx;
                    const n = Math.trunc(rest / per);
                    rest -= n * per;
                    draw();
                    move(n);
                    v *= Math.pow(0.994, dt);
                    if (!el.isConnected || Math.abs(v) / unit * 1000 < 25) { glideRaf = 0; el.classList.remove('is-rolling'); return; }
                    glideRaf = requestAnimationFrame(frame);
                };
                glideRaf = requestAnimationFrame(frame);
            };
            draw();
            if (!disabled) {
                el.addEventListener('pointerdown', (e) => {
                    if (e.button > 0) return;
                    e.stopPropagation();
                    e.preventDefault();
                    el.setPointerCapture(e.pointerId);
                    el.classList.add('is-rolling');
                    const unit = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--wm-px')) || 1;
                    const per = stepPx * unit;
                    const width = Math.max(1, el.querySelector('.wm-jog-wheel').getBoundingClientRect().width);
                    let lastX = e.clientX;
                    let lastT = e.timeStamp || performance.now();
                    let speed = 0; // WM units a second, smoothed
                    let vel = 0; // px a ms, signed, smoothed (the flick's speed at release)
                    let rest = 0;
                    cancelGlide();
                    const mv = (ev) => {
                        ev.stopPropagation();
                        const dx = ev.clientX - lastX;
                        lastX = ev.clientX;
                        const t = ev.timeStamp || performance.now();
                        const dt = Math.max(1, t - lastT);
                        lastT = t;
                        speed = speed * 0.6 + (Math.abs(dx) / unit / dt) * 1000 * 0.4;
                        vel = vel * 0.5 + (dx / dt) * 0.5;
                        lastMoveT = t;
                        // the ridges follow the finger at the wheel's middle: x = w/2 sin(a), so
                        // da = 2 dx / w there, and one ridge spacing is pi / RIDGES of turn
                        phase += (2 * dx * RIDGES) / (width * Math.PI);
                        rest += dx;
                        const n = Math.trunc(rest / per);
                        rest -= n * per;
                        draw();
                        move(n, !!fineStep || onStep ? speed < fineSpeed : false);
                    };
                    let lastMoveT = lastT;
                    const up = (ev) => {
                        el.classList.remove('is-rolling');
                        el.removeEventListener('pointermove', mv);
                        el.removeEventListener('pointerup', up);
                        el.removeEventListener('pointercancel', up);
                        // a flick: the wheel rolls on and slows (a finger that rested before lifting does not)
                        const idle = (ev && ev.timeStamp ? ev.timeStamp : performance.now()) - lastMoveT;
                        if (ev && ev.type === 'pointerup' && idle < 80 && Math.abs(vel) / unit * 1000 > GLIDE_MIN) glide(vel, per, width, rest);
                    };
                    el.addEventListener('pointermove', mv);
                    el.addEventListener('pointerup', up);
                    el.addEventListener('pointercancel', up);
                });
                ['touchstart', 'touchmove'].forEach((t) => el.addEventListener(t, (e) => { e.stopPropagation(); if (t === 'touchmove' && e.cancelable) e.preventDefault(); }, { passive: false }));
                el.addEventListener('keydown', (e) => {
                    const d = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
                    if (d !== undefined) { phase += d; move(d); } else if (e.key === 'Home' && Number.isFinite(min) && !onStep) move(Math.round((min - cur) / step));
                    else if (e.key === 'End' && Number.isFinite(max) && !onStep) move(Math.round((max - cur) / step));
                    else return;
                    draw();
                    e.preventDefault();
                    e.stopPropagation();
                });
            }
            return { set: (v) => { cur = Number(v) || 0; draw(); }, el };
        },
        /**
         * A number on a tool bar opens this under (or over) it: its name and value over a jog wheel
         * (Yukimi, Nov 15: a thumbwheel rolled sideways, not a trackbar) and the small square button
         * that puts the default back. opts: label, min, max, step, value, def (no default: no
         * button), digits (decimals shown; from step), stepPx (units rolled per step),
         * onChange(value) on every step. Returns the panel (popPanel).
         */
        valuePop(anchor, { label = '', min = 0, max = 1, step = 1, fineStep = 0, value = 0, def = null, digits = null, stepPx = 16, onChange } = {}) {
            const dg = digits != null ? digits : Math.max((String(step).split('.')[1] || '').length, fineStep ? (String(fineStep).split('.')[1] || '').length : 0);
            const fmt = (v) => Number(v).toFixed(dg);
            const clamp = (v) => Math.max(min, Math.min(max, Number(Number(v).toFixed(dg))));
            let cur = clamp(Number(value) || 0);
            // the LCD it opened from blinks its figures while it is open (twice a second, by a class),
            // and holds them lit while the value is being changed
            const lcd = anchor && anchor.classList && anchor.classList.contains('wm-lcd') ? anchor : null;
            let changedAt = 0;
            const blink = lcd ? setInterval(() => {
                if (Date.now() - changedAt < 900) lcd.classList.remove('is-blink');
                else lcd.classList.toggle('is-blink');
            }, 500) : 0;
            const signed = min < 0;
            return ui.popPanel(anchor, {
                label,
                className: 'wm-valuepop',
                onClose: () => { clearInterval(blink); if (lcd) lcd.classList.remove('is-blink'); },
                build(el) {
                    el.innerHTML = `<div class="wm-valuepop-head"><span>${escUi(label)}</span><span class="wm-lcd wm-valuepop-lcd"></span></div><div class="wm-valuepop-row"></div>`;
                    const outEl = el.querySelector('.wm-valuepop-lcd');
                    const out = { set textContent(t) { ui.segText(outEl, t, { signed }); } };
                    out.textContent = fmt(cur);
                    const row = el.querySelector('.wm-valuepop-row');
                    const jog = ui.jogWheel(row, { value: cur, min, max, step, fineStep, label, stepPx, onChange: (v) => { changedAt = Date.now(); if (lcd) lcd.classList.remove('is-blink'); cur = v; out.textContent = fmt(v); if (onChange) onChange(v); } });
                    if (def != null) {
                        row.insertAdjacentHTML('beforeend', '<button type="button" class="wm-valuepop-default" aria-label="Default" title="Default"></button>');
                        row.querySelector('.wm-valuepop-default').addEventListener('click', () => {
                            const v = clamp(def);
                            if (v === cur) return;
                            cur = v;
                            changedAt = Date.now();
                            jog.set(v);
                            out.textContent = fmt(v);
                            if (onChange) onChange(v);
                        });
                    }
                    setTimeout(() => jog.el.focus({ preventScroll: true }), 0);
                }
            });
        },
        /**
         * Seven-segment figures (.wm-seg / .wm-lcd, DSEG7): sets the text and the unlit segments
         * behind it (every figure an 8, its point kept), as an LCD shows them. opts.signed: a sign
         * figure in front (lit '-' when negative, its unlit minus otherwise).
         */
        segText(el, text, { signed = false } = {}) {
            if (!el) return;
            let t = String(text == null ? '' : text);
            // a value that can go negative keeps a sign figure: '-' lit, else blank ('!' in DSEG7)
            if (signed) t = (t.startsWith('-') ? '-' : '!') + t.replace(/^-/, '');
            if (el.textContent !== t) el.textContent = t;
            let ghost = t.replace(/[0-9!]/g, '8').replace(/[^8.:\s]/g, '8');
            // its unlit segment is the minus alone
            if (signed) ghost = `-${ghost.slice(1)}`;
            el.dataset.ghost = ghost;
        },
        /**
         * Number pad (a value typed rather than rolled): a WM dialog with the value in an LCD over
         * 1 - 9, then (point or colon) / 0 / back, with Clear, ok and Cancel. opts: title, value,
         * point (a '.' key), colon (a ':' key, for a ratio), minus (a '-' key), max (figures),
         * onOk(text). One at a time; closePad() is for an app's back key.
         */
        numPad({ title = '', value = '', point = false, colon = false, minus = false, max = 10, onOk } = {}) {
            ui.closePad();
            const host = document.getElementById('wmShell') || document.body;
            const layer = document.createElement('div');
            layer.className = 'wm-msgbox-layer wm-numpad-layer';
            const extra = colon ? ':' : point ? '.' : '';
            const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', minus ? '-' : extra, '0', 'back'];
            layer.innerHTML = `<div class="wm-msgbox wm-numpad" role="dialog" aria-modal="true" aria-label="${escUi(title)}"><div class="wm-msgbox-title"><span>${escUi(title)}</span></div>`
                + '<div class="wm-numpad-lcd wm-lcd"></div>'
                + `<div class="wm-numpad-keys">${keys.map((k) => (k ? `<button type="button" class="wm-button" data-k="${escUi(k)}"${k === 'back' ? ' aria-label="Backspace"' : ''}>${k === 'back' ? '&lt;' : escUi(k)}</button>` : '<span></span>')).join('')}</div>`
                + '<div class="wm-msgbox-buttons"><button type="button" data-act="clear">Clear</button><button type="button" data-act="ok" class="is-default">ok</button><button type="button" data-act="cancel">Cancel</button></div></div>';
            host.appendChild(layer);
            let text = String(value == null ? '' : value);
            const lcd = layer.querySelector('.wm-numpad-lcd');
            const show = () => { lcd.textContent = text || '0'; lcd.dataset.ghost = '8'.repeat(Math.max(max, text.length)); };
            show();
            const done = (ok) => { ui.closePad(); if (ok && onOk) onOk(text); };
            layer.addEventListener('click', (e) => {
                const k = e.target.closest && e.target.closest('[data-k]');
                if (k) {
                    const key = k.dataset.k;
                    if (key === 'back') text = text.slice(0, -1);
                    else if (key === '-') text = text.startsWith('-') ? text.slice(1) : `-${text}`;
                    else if ((key === '.' || key === ':') && text.includes(key)) return;
                    else if (text.replace(/[-.:]/g, '').length < max || key === '.' || key === ':') text += key;
                    if (sh && typeof sh.vibrate === 'function') sh.vibrate('tick');
                    show();
                    return;
                }
                const b = e.target.closest && e.target.closest('[data-act]');
                if (!b) return;
                if (b.dataset.act === 'clear') { text = ''; show(); } else done(b.dataset.act === 'ok');
            });
            padOpen = layer;
            if (sh && typeof sh.syncHistory === 'function') sh.syncHistory();
            return layer;
        },
        padOpen: () => !!padOpen,
        closePad() {
            if (!padOpen) return false;
            padOpen.remove();
            padOpen = null;
            if (sh && typeof sh.syncHistory === 'function') sh.syncHistory();
            return true;
        },
        /**
         * A tool bar too wide for the screen wraps by its groups (.wm-toolbar-group): a divider that
         * would start a row is left out, as a bar never begins with one. opts.oneRow: groups marked
         * data-drop="n" are taken out, n = 1 first, until the bar is one row; returns those groups
         * (a caller offers them in a menu). Call after its content or width changed.
         */
        fitToolbar(bar, { oneRow = false } = {}) {
            if (!bar) return [];
            // oneRow: groups marked data-drop leave the bar, the lowest number first, until it is one row
            const dropped = [];
            if (oneRow) {
                // a whole group, or tools inside one, can carry data-drop
                const drops = [...bar.querySelectorAll(':scope > .wm-toolbar-group[data-drop], :scope > .wm-toolbar-group > [data-drop]')].sort((a, b) => Number(a.dataset.drop) - Number(b.dataset.drop));
                drops.forEach((g) => { g.hidden = false; });
                const rows = () => new Set([...bar.querySelectorAll(':scope > .wm-toolbar-group')].filter((g) => !g.hidden && g.getClientRects().length).map((g) => g.offsetTop)).size;
                for (const g of drops) {
                    if (rows() <= 1) break;
                    g.hidden = true;
                    dropped.push(g);
                }
            }
            const seps = bar.querySelectorAll(':scope > .wm-toolbar-group > .wm-tool-sep:first-child');
            seps.forEach((s) => s.classList.remove('is-wrap'));
            let lastTop = null;
            bar.querySelectorAll(':scope > .wm-toolbar-group').forEach((g) => {
                if (!g.getClientRects().length) return;
                const t = g.offsetTop;
                const sep = g.querySelector(':scope > .wm-tool-sep:first-child');
                if (sep && (lastTop === null || t > lastTop + 1)) sep.classList.add('is-wrap');
                lastTop = t;
            });
            return dropped;
        },
        /**
         * Date control rendered into `host` (SysDateTimePick32 with its drop arrow: the combo's box
         * showing M/D/YYYY, the month calendar under it). opts: value (Date | null), none (offers
         * "None"), label (accessible name), onChange(Date | null), disabled. Returns { get, set, el }.
         */
        dateField(host, { value = null, none = false, label = 'Date', onChange, disabled = false } = {}) {
            const text = (d) => (d ? `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}` : 'None');
            host.insertAdjacentHTML('beforeend', `<button type="button" class="wm-combo wm-datefield" aria-haspopup="dialog" aria-label="${escUi(label)}"${disabled ? ' disabled' : ''}><span></span></button>`);
            const all = host.querySelectorAll('.wm-datefield');
            const btn = all[all.length - 1];
            let cur = value ? new Date(value) : null;
            const show = () => { btn.querySelector('span').textContent = text(cur); };
            show();
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (btn.disabled) return;
                if (calSkip === btn) { calSkip = null; return; }
                ui.monthCalendar(btn, { value: cur, none, onPick: (d) => { cur = d; show(); if (onChange) onChange(d ? new Date(d) : null); } });
            });
            return { get: () => (cur ? new Date(cur) : null), set: (v) => { cur = v ? new Date(v) : null; show(); }, el: btn };
        },
        /** "h:mm AM" for minutes since midnight, and back (also "9", "930", "9:30p", "21:30"); NaN when it is no time. */
        timeText: (min) => `${(Math.floor(min / 60) % 12) || 12}:${String(min % 60).padStart(2, '0')} ${min < 720 ? 'AM' : 'PM'}`,
        parseTime(text) {
            const m = /^\s*(\d{1,2})(?:[:.]?(\d{2}))?\s*([ap])?\.?m?\.?\s*$/i.exec(String(text || ''));
            if (!m) return NaN;
            let h = Number(m[1]);
            const mi = Number(m[2] || 0);
            if (mi > 59 || h > 23 || (m[3] && (h < 1 || h > 12))) return NaN;
            if (m[3]) h = (h % 12) + (m[3].toLowerCase() === 'p' ? 12 : 0);
            return h * 60 + mi;
        },
        /**
         * Calendar's time box rendered into `host` (6.1 / 6.5 emulators, New Appointment > Starts): an
         * editable combo; the time can be typed, the arrow opens the list of times a `step` (30
         * minutes) apart, seven rows tall, opened on the current time. opts: value (minutes since
         * midnight), step, label, onChange(minutes), inRow (the box as it stands in a Calendar or
         * Tasks form row: over the value's text, in the row's type). Returns { get, set, input }.
         */
        timeCombo(host, { value = 0, step = 30, label = 'Time', onChange, inRow = false } = {}) {
            host.insertAdjacentHTML('beforeend', `<span class="wm-combo-edit wm-timecombo${inRow ? ' is-inrow' : ''}"><input class="wm-edit" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="${escUi(label)}"><button type="button" class="wm-combo" tabindex="-1" aria-label="Times"></button></span>`);
            const all = host.querySelectorAll('.wm-timecombo');
            const box = all[all.length - 1];
            const input = box.querySelector('input');
            const btn = box.querySelector('button');
            let cur = Math.max(0, Math.min(1439, Math.round(Number(value) || 0)));
            input.value = ui.timeText(cur);
            const commit = (v) => {
                if (Number.isNaN(v)) { input.value = ui.timeText(cur); return; }
                const was = cur;
                cur = v;
                input.value = ui.timeText(cur);
                if (was !== cur && onChange) onChange(cur);
            };
            input.addEventListener('change', () => commit(ui.parseTime(input.value)));
            input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); commit(ui.parseTime(input.value)); input.select(); } });
            // the arrow leaves the caret in the box, as the device's does
            btn.addEventListener('pointerdown', (e) => e.preventDefault());
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (!sh) return;
                const typed = ui.parseTime(input.value);
                const now = Number.isNaN(typed) ? cur : typed;
                const items = [];
                for (let t = 0; t < 1440; t += step) items.push({ label: ui.timeText(t), radio: t === now, action: () => commit(t) });
                const pop0 = document.querySelector('#wmShell > .wm-popup');
                // closed again, the caret is back in the box
                sh.dropdown(box, items, 'left', () => { if (pop0) { delete pop0.dataset.wmList; pop0.style.fontSize = ''; } if (input.isConnected) input.focus({ preventScroll: true }); });
                const pop = pop0;
                if (!pop || pop.hidden || box.getAttribute('aria-expanded') !== 'true') return;
                // the box's own list (wm-programs.css): as wide as the box, seven rows, under it
                // (the shell moves it above when there is no room), in the box's type
                pop.dataset.wmList = 'time';
                pop.style.fontSize = getComputedStyle(input).fontSize;
                const row = pop.querySelector(':scope > .wm-popup-item');
                const br = box.getBoundingClientRect();
                const sr = pop.parentElement.getBoundingClientRect();
                pop.style.minWidth = pop.style.maxWidth = `${br.width}px`;
                if (row) pop.style.maxHeight = `${row.getBoundingClientRect().height * 7 + (pop.offsetHeight - pop.clientHeight)}px`;
                pop.style.overflowY = 'auto';
                pop.style.right = pop.style.bottom = 'auto';
                pop.style.left = `${br.left - sr.left}px`;
                pop.style.top = `${br.bottom - sr.top}px`;
                // it opens with the current time (or the step before it) as its first row
                const at = pop.querySelectorAll(':scope > .wm-popup-item')[Math.floor(now / step)];
                queueMicrotask(() => { if (at && !pop.hidden) pop.scrollTop = at.offsetTop; });
            });
            return { get: () => cur, set: (v) => { cur = Math.max(0, Math.min(1439, Math.round(Number(v) || 0))); input.value = ui.timeText(cur); }, input };
        },
        /**
         * Time control with the spin buttons rendered into `host` (SysDateTimePick32 + msctls_updown32:
         * Settings > Clock & Alarms on the 6.1 / 6.5 emulators, Alarm Settings on 6.5.3): hour, minute
         * (and second) and AM / PM fields; a tap gives a field the highlight (AM / PM also flips, as
         * on the device), the up and down buttons and the arrow keys step it, digits type into it
         * and Left / Right change field. A minute or second wraps without carrying. opts: value
         * (minutes since midnight; seconds since midnight with seconds: true), seconds, label,
         * onChange(value), disabled. Returns { get, set }.
         */
        timeField(host, { value = 0, seconds = false, label = 'Time', onChange, disabled = false } = {}) {
            const parts = seconds ? ['h', 'm', 's', 'ap'] : ['h', 'm', 'ap'];
            const NAMES = { h: 'Hours', m: 'Minutes', s: 'Seconds', ap: 'AM or PM' };
            host.insertAdjacentHTML('beforeend', `<div class="wm-timefield${disabled ? ' is-disabled' : ''}" role="group" aria-label="${escUi(label)}"${disabled ? ' aria-disabled="true"' : ' tabindex="0"'}>
                    <span class="wm-timefield-text">${parts.map((p, i) => `${i && p !== 'ap' ? '<span class="wm-timefield-sep">:</span>' : ''}<span class="wm-timefield-part" data-part="${p}" role="spinbutton" aria-label="${NAMES[p]}"></span>`).join('')}</span>
                    <span class="wm-spin"><button type="button" data-dir="1" aria-label="Up" tabindex="-1"${disabled ? ' disabled' : ''}></button><button type="button" data-dir="-1" aria-label="Down" tabindex="-1"${disabled ? ' disabled' : ''}></button></span>
                </div>`);
            const all = host.querySelectorAll('.wm-timefield');
            const root = all[all.length - 1];
            const max = seconds ? 86400 : 1440;
            const unit = seconds ? 3600 : 60;
            let cur = ((Math.round(Number(value) || 0) % max) + max) % max;
            let active = 'h';
            let typed = '';
            const get = (p) => (p === 'h' ? Math.floor(cur / unit) : p === 'm' ? Math.floor(cur / (unit / 60)) % 60 : p === 's' ? cur % 60 : (cur < max / 2 ? 0 : 1));
            const put = (p, v) => {
                const h = get('h');
                const m = get('m');
                const s = seconds ? get('s') : 0;
                const next = p === 'h' ? [v, m, s] : p === 'm' ? [h, v, s] : p === 's' ? [h, m, v] : [(h % 12) + (v ? 12 : 0), m, s];
                const was = cur;
                cur = seconds ? next[0] * 3600 + next[1] * 60 + next[2] : next[0] * 60 + next[1];
                show();
                if (was !== cur && onChange) onChange(cur);
            };
            const show = () => {
                root.querySelectorAll('.wm-timefield-part').forEach((n) => {
                    const p = n.dataset.part;
                    const v = get(p);
                    n.textContent = p === 'h' ? String((v % 12) || 12) : p === 'ap' ? (v ? 'PM' : 'AM') : String(v).padStart(2, '0');
                    n.classList.toggle('is-active', p === active);
                    n.setAttribute('aria-valuetext', n.textContent);
                });
            };
            const step = (dir) => {
                typed = '';
                if (active === 'ap') put('ap', get('ap') ? 0 : 1);
                else if (active === 'h') put('h', (get('h') + dir + 24) % 24);
                else put(active, (get(active) + dir + 60) % 60);
            };
            const select = (p) => { active = p; typed = ''; show(); };
            show();
            if (disabled) return { get: () => cur, set: (v) => { cur = ((Math.round(Number(v) || 0) % max) + max) % max; show(); } };
            root.addEventListener('pointerdown', (e) => {
                const part = e.target.closest('.wm-timefield-part');
                // the buttons leave the focus (and the highlight) on the fields
                if (e.target.closest('.wm-spin')) e.preventDefault();
                if (!part) return;
                select(part.dataset.part);
                if (part.dataset.part === 'ap') put('ap', get('ap') ? 0 : 1);
            });
            // a held button repeats (the up-down control: after a pause, then steadily)
            let rep = 0;
            const stop = () => { clearTimeout(rep); rep = 0; };
            root.querySelectorAll('.wm-spin button').forEach((b) => {
                b.addEventListener('pointerdown', (e) => {
                    if (e.button > 0) return;
                    e.stopPropagation();
                    root.focus({ preventScroll: true });
                    const dir = Number(b.dataset.dir);
                    step(dir);
                    stop();
                    const again = () => { step(dir); rep = setTimeout(again, 90); };
                    rep = setTimeout(again, 600);
                });
                ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => b.addEventListener(t, stop));
                b.addEventListener('click', (e) => e.stopPropagation());
                // a touch tap gives a button the focus whatever pointerdown said: hand it back to the fields
                b.addEventListener('focus', () => root.focus({ preventScroll: true }));
            });
            root.addEventListener('blur', stop);
            root.addEventListener('keydown', (e) => {
                const i = parts.indexOf(active);
                if (e.key === 'ArrowUp') step(1);
                else if (e.key === 'ArrowDown') step(-1);
                else if (e.key === 'ArrowLeft') select(parts[Math.max(0, i - 1)]);
                else if (e.key === 'ArrowRight') select(parts[Math.min(parts.length - 1, i + 1)]);
                else if (active === 'ap' && /^[ap]$/i.test(e.key)) put('ap', e.key.toLowerCase() === 'p' ? 1 : 0);
                else if (active !== 'ap' && /^\d$/.test(e.key)) {
                    // digits build the number; one that would pass the field's limit starts it again
                    const hi = active === 'h' ? 12 : 59;
                    let n = Number(typed + e.key);
                    if (n > hi || typed.length >= 2) { typed = ''; n = Number(e.key); }
                    typed += e.key;
                    if (active === 'h') { if (n >= 1) put('h', (n % 12) + (get('ap') ? 12 : 0)); } else put(active, n);
                } else return;
                e.preventDefault();
                e.stopPropagation();
            });
            return { get: () => cur, set: (v) => { cur = ((Math.round(Number(v) || 0) % max) + max) % max; typed = ''; show(); } };
        },
        /**
         * Colour choice rendered into `host`: the kit's picker grid holding the sixteen system
         * colours (and the current one first when it is none of them), with an edit box for any
         * other value as #RRGGBB (it then keeps a cell of its own). WM has no colour dialog of its own in Settings; this is the picker
         * grid (Today's pictures, the Start icons) with colour cells. opts: value ('#rrggbb'), colors
         * ([[value, name]]), label, onChange(value). Returns { get, set }.
         */
        colorField(host, { value = '', colors = WM_COLORS, label = 'Color', onChange } = {}) {
            const norm = (v) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(v || '').trim()); return m ? `#${m[1].toLowerCase()}` : null; };
            let cur = norm(value) || colors[0][0];
            let own = null;
            host.insertAdjacentHTML('beforeend', `<div class="wm-colorfield"><div class="wm-picker wm-color-grid" role="listbox" aria-label="${escUi(label)}"></div><div class="wm-color-custom"><span class="wm-color-well" aria-hidden="true"></span><input class="wm-edit" type="text" maxlength="7" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="${escUi(label)} value"></div></div>`);
            const all = host.querySelectorAll('.wm-colorfield');
            const root = all[all.length - 1];
            const grid = root.querySelector('.wm-color-grid');
            const well = root.querySelector('.wm-color-well');
            const input = root.querySelector('input');
            const draw = () => {
                // a colour that is none of the listed ones (the value it came with, one typed) keeps a cell of its own
                if (!colors.some(([v]) => v === cur)) own = cur;
                const list = own ? [[own, 'Custom']].concat(colors) : colors;
                grid.innerHTML = list.map(([v, name]) => `<button type="button" class="wm-picker-cell${v === cur ? ' is-selected' : ''}" role="option" aria-selected="${v === cur}" data-color="${escUi(v)}" aria-label="${escUi(name)}"><span class="wm-color-cell"></span></button>`).join('');
                grid.querySelectorAll('.wm-picker-cell').forEach((c) => c.firstChild.style.setProperty('--wm-swatch', c.dataset.color));
                well.style.setProperty('--wm-swatch', cur);
                if (document.activeElement !== input) input.value = cur.toUpperCase();
            };
            const pick = (v) => { if (!v || v === cur) { draw(); return; } cur = v; draw(); if (onChange) onChange(cur); };
            draw();
            grid.addEventListener('click', (e) => { const c = e.target.closest('[data-color]'); if (c) pick(c.dataset.color); });
            input.addEventListener('input', () => { const v = norm(input.value); if (v) pick(v); });
            input.addEventListener('change', () => { input.value = cur.toUpperCase(); });
            return { get: () => cur, set: (v) => { cur = norm(v) || cur; draw(); } };
        },
        /**
         * Transport for a <video> or <audio> element, rendered into `host` (the element itself carries
         * no `controls`: the browser's own transport is never shown): a Play / Pause push button, the
         * WM trackbar as the position and "0:12 / 1:30". A tap on a video also plays / pauses it.
         * Returns { el }.
         */
        mediaBar(host, media) {
            const clock = (t) => { t = Math.max(0, Math.floor(Number(t) || 0)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
            host.insertAdjacentHTML('beforeend', '<div class="wm-mediabar"><button type="button" class="wm-button wm-mediabar-play">Play</button><div class="wm-mediabar-seek"></div><span class="wm-mediabar-time"></span></div>');
            const bars = host.querySelectorAll('.wm-mediabar');
            const bar = bars[bars.length - 1];
            const play = bar.querySelector('.wm-mediabar-play');
            const time = bar.querySelector('.wm-mediabar-time');
            const STEPS = 200;
            let held = 0; // a drag owns the thumb until the element has sought
            const dur = () => (Number.isFinite(media.duration) && media.duration > 0 ? media.duration : 0);
            const track = ui.trackbar(bar.querySelector('.wm-mediabar-seek'), {
                steps: Array.from({ length: STEPS + 1 }, (_, i) => i),
                value: 0,
                label: 'Position',
                ticks: 0,
                onChange: (v) => { if (dur()) { held = Date.now(); media.currentTime = (v / STEPS) * dur(); show(); } }
            });
            const show = () => {
                play.textContent = media.paused || media.ended ? 'Play' : 'Pause';
                time.textContent = dur() ? `${clock(media.currentTime)} / ${clock(dur())}` : clock(media.currentTime);
                if (dur() && Date.now() - held > 400) track.set(Math.round((media.currentTime / dur()) * STEPS));
            };
            const toggle = () => { if (media.paused || media.ended) { const p = media.play(); if (p && p.catch) p.catch(() => {}); } else media.pause(); };
            play.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
            if (media.tagName === 'VIDEO') media.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
            ['play', 'pause', 'ended', 'timeupdate', 'durationchange', 'loadedmetadata', 'seeked'].forEach((t) => media.addEventListener(t, show));
            // a viewer under the bar (the picture viewer's swipes and tap-to-close) never sees its taps
            ['pointerdown', 'touchstart', 'click'].forEach((t) => bar.addEventListener(t, (e) => e.stopPropagation(), { passive: true }));
            show();
            return { el: bar };
        },
        /** The shell's message box (Promise of the pressed button's value). */
        messageBox: (opts) => (sh ? sh.messageBox(opts) : Promise.resolve(false)),
        /** Tell the shell which settings keys changed (wmSettingsChange). */
        changed: (keys) => changed(keys),
        /** Shell art for an icon name: { src, srcset }. */
        art: (name) => (sh ? { src: sh.art.url(name), srcset: sh.art.srcset(name) } : { src: '', srcset: '' })
    };

    Object.assign(window.wmSettings, {
        // the device's tab strip fitting (whole-pixel 6.5 tab widths, the spin button when they do
        // not fit), for apps that draw their own .wm-tabs (Studio, #825)
        fitTabs: (strip, state) => fitTabs(strip, state || {}),
        registerPage,
        extendPage,
        // opts.direct: opened from a program (the Director's Director Settings...): ok and back on the
        // page return to that program, as WM's control panel applets started by a program do
        open: (id, tab, opts) => {
            if (!sh || !settingsHost) return false;
            // boot steps put off until Today was up (#817): the shell opens a program only after
            // them, so Settings has no page to draw on yet (Today's Set key in the first seconds,
            // #859). The rest of them first, then this open again
            const ws = window.wsClient;
            if (ws && ws.deferredInitPending && typeof ws.whenDeferredInitDone === 'function') {
                void sh.busy(ws.whenDeferredInitDone()).then(() => { if (!ws.deferredInitPending) window.wmSettings.open(id, tab, opts); });
                return true;
            }
            // (6.5: the Settings program shown with no page hands over to Start's Settings folder;
            // not while a page is on its way in)
            settingsHost.opening = true;
            try { sh.open('settings'); } finally { settingsHost.opening = false; }
            return settingsHost.openPage(id, tab, opts);
        },
        // 6.5 (#739, wmStart65.js): Settings is a folder of the Start screen there. The applets and
        // links the Settings grid shows, and the Programs list, as data.
        gridItems: () => {
            const have = new Set(sh ? sh.listApps().map((a) => a.id) : []);
            return PAGES.filter((p) => !p.hidden && safeAvailable(p)).map((p) => ({ key: p.id, tab: p.tab, label: p.label, icon: p.icon }))
                .concat(SETTINGS_LINKS.filter((l) => !l.app || have.has(l.app)).map((l) => ({ key: l.id, tab: l.tab, label: l.label, icon: l.icon, app: l.app || null, open: l.open || null })));
        },
        programItems: (folder) => programItems(folder),
        /** A folder of Programs for programs registered with programsFolder: id ({ label, icon: art name }). */
        addProgramFolder: (id, f) => {
            if (!id || !f || !f.label || PROGRAM_FOLDERS[id]) return;
            PROGRAM_FOLDERS[id] = { label: f.label, icon: () => wmLargeIcon(f.icon || 'app-programs') };
            EXTRA_FOLDERS.add(id);
            FOLDER_ORDER.push(id);
        },
        /**
         * A group of folders kept by another file, replaced as a whole (the folders made inside Android
         * and Work, wmAndroidApps.js #805): [{ id, label, icon, parent }]; a folder with a parent is
         * listed inside that folder, not in Programs itself.
         */
        setProgramFolders: (group, list) => {
            for (const id of (FOLDER_GROUPS.get(group) || [])) {
                delete PROGRAM_FOLDERS[id];
                EXTRA_FOLDERS.delete(id);
                FOLDER_PARENT.delete(id);
                const i = FOLDER_ORDER.indexOf(id);
                if (i >= 0) FOLDER_ORDER.splice(i, 1);
            }
            const ids = [];
            for (const f of (Array.isArray(list) ? list : [])) {
                if (!f || !f.id || !f.label || PROGRAM_FOLDERS[f.id]) continue;
                PROGRAM_FOLDERS[f.id] = { label: f.label, icon: () => wmLargeIcon(f.icon || 'app-folder') };
                EXTRA_FOLDERS.add(f.id);
                if (f.parent) FOLDER_PARENT.set(f.id, f.parent);
                FOLDER_ORDER.push(f.id);
                ids.push(f.id);
            }
            FOLDER_GROUPS.set(group, ids);
        },
        programFolders: () => Object.entries(PROGRAM_FOLDERS).map(([id, f]) => ({ id, label: f.label, extra: EXTRA_FOLDERS.has(id), parent: FOLDER_PARENT.get(id) || null })),
        /** A Settings grid item that opens a program: { id, tab, label, icon, app } (or open()). */
        addLink: (link) => {
            if (!link || !link.id || !PAGE_GRIDS.has(link.tab) || SETTINGS_LINKS.some((l) => l.id === link.id)) return;
            SETTINGS_LINKS.push(link);
            if (settingsHost) settingsHost.refresh();
        },
        ui
    });

    function registerSettings() {
        let page = null;
        let gridTab = 'personal';
        let open = null; // { def, exts, tabs, tab, draft, extDrafts }
        let backPending = null; // the page whose back-key commit is still running

        function pagesFor(tab) {
            return PAGES.filter((p) => p.tab === tab && !p.hidden && safeAvailable(p));
        }

        function renderGrid() {
            if (!page) return;
            const have = new Set(sh.listApps().map((a) => a.id));
            const links = SETTINGS_LINKS.filter((l) => l.tab === gridTab && (!l.app || have.has(l.app)));
            const items = pagesFor(gridTab).map((p) => ({ key: p.id, label: p.label, img: { src: sh.art.url(p.icon), srcset: sh.art.srcset(p.icon) } }))
                .concat(links.map((l) => ({ key: l.id, label: l.label, img: { src: sh.art.url(l.icon), srcset: sh.art.srcset(l.icon) } })))
                .sort((a, b) => a.label.localeCompare(b.label));
            delete page.dataset.setPage; // an applet opened again starts at its top
            page.innerHTML = `<div class="wm-set-scroll"><div class="wm-icongrid" role="list">${items.map((i) => iconCell(i)).join('')}</div></div>${tabsHtml(SET_TABS, gridTab)}`;
            bindGrid(page.querySelector('.wm-icongrid'), openPage);
            page.querySelectorAll('.wm-tab').forEach((t) => t.addEventListener('click', () => { gridTab = t.dataset.tab; renderGrid(); }));
            if (sh.current === 'settings') { sh.setTitle('Settings'); refreshTitleKind(); }
        }

        function renderPage() {
            const { def, tab, draft, tabs } = open;
            // the title bar reads "Settings" on every applet, as on the device (the applet's name is
            // the page heading under it); the applet name there was cut short by the status icons
            // 6.5.1 (#850) pivot: on 6.5.3 the band under the title bar names the page (a tab's name,
            // or the applet's own on a page without tabs) and the title bar names the applet. With
            // the 6.5 title bar (bars choice off) it stays "Settings" as on 6.5 (Yukimi, #850)
            if (sh.current === 'settings') sh.setTitle(def.title || (pivotOn() && root.dataset.wmBars === 'bottom' ? def.label : 'Settings')); // a program's own page (Messaging's Options, #757) carries its name
            // a redraw (a tap on a list row, a check box) keeps where the page and its lists were
            // scrolled: the same tab redrawn, not a new one (Today > Items read from the top again)
            const keep = page.dataset.setPage === `${def.id}:${tab}`
                ? [...page.querySelectorAll('.wm-set-scroll, .wm-listbox')].map((x) => x.scrollTop) : null;
            page.dataset.setPage = `${def.id}:${tab}`;
            page.innerHTML = `<div class="wm-form-hdr">${esc(def.label)}</div><div class="wm-set-scroll"><div class="wm-form"></div></div>${tabs.length ? tabsHtml(tabs, tab) : ''}`;
            const el = page.querySelector('.wm-form');
            const api = { rerender: () => { if (open && open.draft === draft) renderPage(); }, tab };
            // a tab of an extension (extendPage) draws with that extension's own draft
            const ext = open.exts.find((x) => x.tabs.some(([id]) => id === tab));
            try {
                if (ext) ext.render(el, tab, open.extDrafts.get(ext.id), api);
                else def.render(el, tab, draft, api);
            } catch (err) {
                console.warn('Settings: could not draw', def.id, tab, err);
            }
            // list boxes take the page's free height (#775), before their scroll is put back
            fitLists();
            if (keep) {
                const now = [...page.querySelectorAll('.wm-set-scroll, .wm-listbox')];
                if (now.length === keep.length) now.forEach((x, i) => { x.scrollTop = keep[i]; });
            }
            requestAnimationFrame(fitLists);
            page.querySelectorAll('.wm-tab').forEach((t) => t.addEventListener('click', () => { open.tab = t.dataset.tab; renderPage(); }));
            // more tabs than fit: the spin button (its position is the open page's, kept across redraws)
            if (!open.tabScroll) open.tabScroll = { first: 0 };
            fitTabs(page.querySelector('.wm-tabs'), open.tabScroll);
            refreshTitleKind();
            if (sh && typeof sh.refreshSoftKeys === 'function') sh.refreshSoftKeys();
        }

        /**
         * A page's list boxes fill the page (Yukimi, Nov 12, #775): the space left under the form
         * goes to its list boxes, shared evenly, so a list ends at the tabs with no empty white
         * under it. Their own max-height is the starting size; a page whose content is taller
         * than the screen keeps it (the page scrolls). A list box with data-no-fill keeps its size.
         */
        function fitLists() {
            if (!page || !open || page.hidden) return;
            const sc = page.querySelector('.wm-set-scroll');
            const form = sc && sc.querySelector(':scope > .wm-form');
            if (!form) return;
            const lists = [...form.querySelectorAll('.wm-listbox')].filter((l) => !l.dataset.noFill && l.offsetParent !== null && !l.closest('.wm-popup'));
            if (!lists.length) return;
            // back to the size the page drew (a resize fits again from there)
            for (const l of lists) {
                if (l.dataset.fitMax === undefined) l.dataset.fitMax = l.style.maxHeight || '';
                l.style.height = '';
                l.style.maxHeight = l.dataset.fitMax;
            }
            const cs = getComputedStyle(form);
            const used = form.getBoundingClientRect().height + (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0);
            const free = Math.floor(sc.clientHeight - used);
            if (Math.abs(free) < 2) return;
            const px = parseFloat(getComputedStyle(root).getPropertyValue('--wm-px')) || 1;
            const heights = lists.map((l) => Math.floor(l.getBoundingClientRect().height));
            let next;
            if (free > 0) {
                // room left: the lists grow to the tabs, shared evenly
                const share = Math.floor(free / lists.length);
                next = heights.map((h) => h + share);
            } else {
                // the page is taller than the screen: the lists give the height back (down to a few
                // rows each) so the page itself does not scroll (Yukimi, Nov 12, #777)
                const min = Math.round(54 * px);
                const spare = heights.map((h) => Math.max(0, h - min));
                const total = spare.reduce((a, b) => a + b, 0);
                if (!total) return;
                const take = Math.min(total, -free);
                next = heights.map((h, i) => Math.floor(h - take * spare[i] / total));
            }
            lists.forEach((l, i) => {
                l.style.height = `${next[i]}px`;
                l.style.maxHeight = `${next[i]}px`;
            });
        }
        window.addEventListener('resize', () => { if (open) requestAnimationFrame(fitLists); });

        function openPage(id, tab, opts) {
            // Settings is not on screen (the shell put its open off, or another program stands in for it)
            if (!page) return false;
            const link = SETTINGS_LINKS.find((l) => l.id === id);
            if (link) {
                page.querySelectorAll('.wm-icongrid-cell.is-selected').forEach((c) => c.classList.remove('is-selected'));
                if (link.app) sh.open(link.app); else if (link.open) link.open();
                return true;
            }
            const def = PAGES.find((p) => p.id === id);
            if (!def || !safeAvailable(def)) return false;
            const exts = extsFor(def);
            const tabs = tabsWith(def, exts);
            const extDrafts = new Map();
            for (const x of exts) {
                try { extDrafts.set(x.id, typeof x.init === 'function' ? x.init() : {}); } catch (err) { console.warn('Settings: init failed', x.id, err); extDrafts.set(x.id, {}); }
            }
            const first = tabs[0] ? tabs[0][0] : '';
            const at = tab ? tabs.findIndex(([t]) => t === tab) : -1;
            // opened at a tab behind the spin buttons (Director > Persona from an old address): the
            // strip starts at that tab, so it shows (fitTabs keeps the last tabs whole)
            open = { def, exts, tabs, tab: at >= 0 ? tab : first, draft: def.init(), extDrafts, direct: !!(opts && opts.direct), openedAt: Date.now(), tabScroll: { first: Math.max(0, at) } };
            renderPage();
            sh.syncHistory();
            return true;
        }

        function closePage() {
            open = null;
            renderGrid();
            if (sh && typeof sh.refreshSoftKeys === 'function') sh.refreshSoftKeys();
        }

        /**
         * 6.5 has no Settings program of its own: Settings is a folder of the Start screen (device:
         * Bluetooth, Clock & Alarms, Lock, Power, Sounds & Notifications, Today, then the folders
         * Connections, Personal and System). Settings shown with no page open hands over to that
         * folder (wmStart65.js openFolder); without it the tabbed 6.1 grid stays.
         */
        function toStartFolder() {
            const s65 = runningVersion() === '6.5' && window.wmStart65;
            if (!s65 || typeof s65.openFolder !== 'function') return false;
            queueMicrotask(() => {
                if (open || sh.current !== 'settings') return;
                try { s65.openFolder('settings'); } catch (err) { console.warn('Settings: Start folder', err); }
            });
            return true;
        }

        /** The page's commit, then each extension's: their keys, or false (keep the page open). */
        async function commitAll(cur) {
            const keys = [];
            const steps = [() => (typeof cur.def.commit === 'function' ? cur.def.commit(cur.draft) : [])]
                .concat(cur.exts.map((x) => () => (typeof x.commit === 'function' ? x.commit(cur.extDrafts.get(x.id)) : [])));
            for (const step of steps) {
                let k = [];
                try {
                    k = await step();
                } catch (err) {
                    console.warn('Settings: could not save', cur.def.id, err);
                }
                if (k === false) {
                    if (keys.length) changed(keys);
                    return false;
                }
                if (Array.isArray(k)) keys.push(...k);
            }
            return keys;
        }

        /**
         * ok and the back key: save the page once, then back to the grid. A second ok or back while
         * the save runs does nothing; a commit that says false (a message box, a sub-view going
         * back) keeps the page open. The back key's history entry is already gone, so it is pushed
         * again when the page stays and not pushed when it closes.
         */
        function commitAndClose(viaBack) {
            if (!open) return false;
            const cur = open;
            if (backPending === cur) return true;
            backPending = cur;
            // WM's wait cursor while the page saves (most pages write to the server)
            (typeof sh.busy === 'function' ? sh.busy(() => commitAll(cur)) : commitAll(cur))
                .catch(() => [])
                .then((keys) => {
                    if (backPending === cur) backPending = null;
                    if (open !== cur) return;
                    if (keys === false) { if (viaBack) sh.syncHistory(); return; }
                    if (Array.isArray(keys) && keys.length) changed(keys);
                    closePage();
                    sh.syncHistory(viaBack ? { noPush: true } : undefined);
                    // a page a program opened goes back to that program, not to the Settings grid
                    if (cur.direct && sh.current === 'settings') sh.back();
                    else if (sh.current === 'settings') toStartFolder();
                })
                .catch((err) => console.warn('Settings: could not close', cur.def.id, err));
            return true;
        }

        settingsHost = {
            refresh() { if (page && !open && sh.current === 'settings') renderGrid(); },
            openPage: (id, tab, opts) => openPage(id, tab, opts)
        };

        sh.registerApp({
            id: 'settings',
            title: 'Settings',
            icon: 'app-settings',
            inStart: 'system',
            sip: true,
            mount(p) {
                page = p;
                page.classList.add('wm-set');
            },
            // Settings opened again (Start, Programs) always starts at its grid (Yukimi, Nov 10): a page
            // left open behind other programs is left without saving, like leaving it without ok. A page
            // just opened by wmSettings.open (a program's settings) stays.
            show() {
                if (open && Date.now() - (open.openedAt || 0) < 1000) { renderPage(); return; }
                if (open) open = null;
                renderGrid();
                if (!(settingsHost && settingsHost.opening)) toStartFolder();
            },
            hide() {},
            // a page may bring its own soft keys (Wireless Manager's Menu): def.softKeys(draft)
            softKeys() {
                if (open && typeof open.def.softKeys === 'function') {
                    try { return open.def.softKeys(open.draft) || { left: null, right: null }; } catch (err) { console.warn('Settings: softKeys failed', open.def.id, err); }
                }
                return { left: null, right: null };
            },
            // WM: X on the Settings grid, ok on a settings page (saves it, back to the grid)
            // a page may ask for X instead of ok (Wireless Manager, an app on WM): X goes back to the grid
            titleKind: () => (open ? (typeof open.def.titleKind === 'function' ? open.def.titleKind() : 'ok') : 'close'),
            closeGoesBack: true,
            onTitleOk: () => commitAndClose(false),
            historyDepth: () => (open ? 1 : 0),
            // the back key leaves a page as ok does on the device
            onBack: () => commitAndClose(true)
        });
    }

    function register() {
        sh = window.wmShell;
        if (!sh || typeof sh.registerApp !== 'function') return;
        loadManifest();
        registerPrograms();
        registerSettings();
    }

    if (window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
