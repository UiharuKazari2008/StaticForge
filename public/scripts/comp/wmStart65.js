/**
 * Melaton Mobile 6.5 Start screen (Yozora #739): Windows Mobile 6.5 Professional's Start screen,
 * the staggered icon grid that replaced the 6.1 Start menu. public/css/wm65-start.css draws it;
 * wmShell.js hosts it as app id 'start' (its Start button opens it, and goes back when it shows).
 *
 * Measured on the WM 6.5 Professional VGA emulator and read from the ROM's layout file
 * (StartMenu_GridScene_480x640.cpr); VGA pixels, a design unit (--wm-px) is two of them:
 *   - GridView 480x536 under the 52 px title bar, 3 columns, HexagonGrid: items fill the rows
 *     left to right (Today, Phone, Text / E-mail, Contacts, Internet Explorer ...); a cell is
 *     192x166, the columns start at x 0 / 144 / 288 (cells overlap by 48), the rows are 166
 *     apart and the middle column sits 83 lower. Icons matched pixel for pixel at (51,56),
 *     (195,139), (339,56), (51,222): the 90x90 image is at 51,4 in its cell, unscaled.
 *   - the label box is 156x68 at 18,98: Tahoma 7 pt, white, centred, wrapped (22 px line pitch).
 *   - the selection glow (StartMenu_Selection.png 192x158) sits at 0,-30 of the selected cell,
 *     under the icons, clipped by the grid's top edge. Start opens with Today selected at the top.
 *   - the grid is drawn on the Today wallpaper under StartMenu_Background_Screen (black, 50 %).
 *   - a finger pans the grid 1:1 once it has moved past a start distance (a drag in 20 px steps
 *     lost 40 px, in 30 px steps 60 px, 1 px steps over 60 px in 3 s never panned: over 30, at
 *     most 40 px); it rests anywhere (no snap to rows); past either end it follows the finger
 *     undamped (300 px drag at the top: 239 px of empty space) and returns on release. The last
 *     row's cell ends at the grid's bottom edge.
 *   - tap: the glow moves to the item and it opens; the grid scrolls so the selected cell is
 *     whole (Settings in row 2 moved the grid up 45 px). A folder (Settings, Games, Office
 *     Mobile) opens in place: its name in the title bar, left soft key Back.
 *   - tap-and-hold: the glow moves to the item and a menu with one row, Move to Top, opens.
 *   - title bar "Start" with X (closes Start, back to the program under it); left soft key
 *     Lock, no right soft key.
 * Not measured (the emulator's screenshot latency hides them): the hold time, the fling's
 * deceleration, the length of the return from an overscroll, where Move to Top puts the item
 * (taken as: first after Today, whose rank in the ROM is the largest integer).
 */
(function () {
    'use strict';
    const root = document.documentElement;
    if (window.uiShell !== 'mobile' || root.dataset.wmVersion !== '6.5') return;

    const ART65 = '/static_images/wm65/';
    const ORDER_KEY = 'wmStart65Order';
    // start distance of a pan and the hold time (see the header: the first is between 15 and 20 units)
    const PAN_START = 16;
    const HOLD_MS = 800;
    // fling: speed falls by e every FRICTION_MS; past an end a critically damped spring pulls back
    const FRICTION_MS = 420;
    const SPRING = 0.00035;

    let sh = null; // window.wmShell
    let manifest = null; // wm61 art names (the -lg, 32 px versions)

    const esc = (s) => sh.escapeHtml(s);

    // ---------------------------------------------------------------- art

    /** A 6.5 Start icon from the ROM (Start_Icon_<name>.png, 90x90, with its half-size copy). */
    const art65 = (name) => ({ src: `${ART65}start-${name}.png`, srcset: `${ART65}start-${name}.png 1x, ${ART65}start-${name}@2x.png 2x` });

    /** The largest copy of a 6.1 shell icon (app-x-lg@4x is 128 px), drawn into the 90x90 box. */
    function art61(name) {
        if (String(name).startsWith('/')) return { src: name, srcset: '' };
        const n = manifest && manifest[`${name}-lg`] ? `${name}-lg` : name;
        const list = String(sh.art.srcset(n)).split(',').map((s) => s.trim().split(/\s+/)[0]).filter(Boolean);
        return { src: list[list.length - 1] || sh.art.url(n), srcset: '' };
    }

    /** A desktop program's icon (compiled sizes, modules/appIconRuntimeAssets.js). */
    function artDesktop(imageIcon) {
        try {
            /* global resolveAppIconPath */
            if (typeof resolveAppIconPath === 'function') return { src: resolveAppIconPath(imageIcon, 96), srcset: `${resolveAppIconPath(imageIcon, 96)} 1x, ${resolveAppIconPath(imageIcon, 192)} 2x` };
        } catch (_) { /* fall through */ }
        return { src: `/static_images/app_icons/${imageIcon}`, srcset: '' };
    }

    function loadManifest() {
        if (manifest) return Promise.resolve(manifest);
        return fetch('/static_images/wm61/manifest.json', { credentials: 'same-origin' })
            .then((r) => (r.ok ? r.json() : null))
            .then((m) => { manifest = (m && m.items) || {}; return manifest; })
            .catch(() => { manifest = {}; return manifest; });
    }

    // Melaton Mobile apps that are a stock WM 6.5 program: the ROM's Start icon. Every other app
    // (Studio, the Director, Teleport ...) keeps its own art.
    const APP_ART65 = {
        today: 'today', gallery: 'photos', fileexplorer: 'fileexp', messaging: 'msg', browser: 'ie', notes: 'notes',
        contacts: 'contacts', calendar: 'calendar', calculator: 'calc', taskmgr: 'taskmgr', 'windows-media': 'wmp',
        settings: 'settings', help: 'help'
    };
    // WM 6.5's own order (HKLM\Security\Shell\StartInfo ranks: Today, Phone, Text, E-mail, Contacts,
    // Internet Explorer, Calendar, Settings, Getting Started, Pictures & Videos, Windows Media ...
    // Calculator, Games, Notes, Tasks, Office Mobile, File Explorer ... Task Manager, Search, Help)
    // for the apps that have a place in it; the Director and Studio, pinned at the top of the 6.1
    // Start menu, follow Settings. Everything else comes after, by name, as unranked programs do.
    const RANK = ['a:today', 'a:messaging', 'a:contacts', 'a:browser', 'a:calendar', 'a:settings', 'a:director', 'a:studio',
        'a:gallery', 'a:windows-media', 'a:calculator', 'folder:games', 'a:notes', 'folder:dreamscape', 'a:fileexplorer', 'a:taskmgr', 'a:help'];

    // ---------------------------------------------------------------- items
    // The same programs the 6.1 Start menu and Programs screen list. wmPrograms.js keeps its tables
    // private, so the rules are repeated here (MAPPED: desktop programs that are a phone app;
    // PHONE_DIRECT: desktop pages listed as they are; the Dreamscape folder; accounts in Settings).

    const MAPPED = {
        workspace: ['gallery'], encyclopedia: ['browser'], alchemy: ['browser'], explorer: ['fileexplorer'], dovecote: ['messaging'],
        'planet-switcher': ['teleport'], notebook: ['notes'], notepad: ['notes'], contacts: ['contacts'], director: ['director'],
        studio: ['studio'], chat: ['chat'], presets: ['spellbook'], paypass: ['paypass-mobile'], xlink: ['xlink-mobile'],
        spellbook: ['spellcaster'], 'bracket-generation': ['phasewalker'], naxt: ['atelier'], expanders: ['expanders'],
        'character-db': ['characters'], emotion: ['emotion'], reference: ['reference'], calculator: ['calculator'], calendar: ['calendar'],
        taskmgr: ['taskmgr'], 'media-player': ['windows-media'], 'remote-desktop': ['remote-desktop-mobile'], 'remote-desktop-connection': ['remote-desktop-mobile']
    };
    const TOOLBOX_SKIP = new Set(['vista-sidebar', 'snipping', 'sideshow-simulator-landscape', 'sideshow-simulator-portrait', 'welcome-center', 'perfmon', 'memories']);
    const PHONE_DIRECT = new Set(['data-management', 'ispy', 'control-panel', 'explore-gallery', 'novels', 'image-search']);
    const IN_SETTINGS_DESKTOP = new Set(['alarm', 'control-panel', 'data-management', 'taskmgr']);
    const DREAMSCAPE_APPS = new Set(['studio', 'director', 'spellcaster', 'phasewalker', 'atelier', 'reference', 'characters', 'expanders', 'spellbook', 'emotion', 'teleport', 'chat']);
    const DREAMSCAPE_DESKTOP = new Set(['explore-gallery', 'novels', 'ispy', 'image-search']);
    const DESKTOP_WM_ART = { 'explore-gallery': 'app-agora', novels: 'app-novels', ispy: 'app-image-search', 'image-search': 'app-image-search', 'data-management': 'app-data-management', 'control-panel': 'app-control-panel', import: 'app-import' };
    // shell screens that are not Start items here: 6.5 has no Programs screen (its items are on Start)
    const NOT_LISTED = new Set(['start', 'programs', 'accounts']);
    const FOLDERS = {
        games: { label: 'Games', icon: () => art65('games') },
        dreamscape: { label: 'Dreamscape', icon: () => art61('app-folder-dreamscape') }
    };

    // ---- Settings: on WM 6.5 a folder of the Start screen (title "Settings", soft key Back): the
    // applets Bluetooth, Clock & Alarms, Lock, Power, Sounds & Notifications and Today, then the
    // folders Connections, Personal and System, each sorted by name (emulator). The applets come
    // from wmPrograms.js when it exports them (wmSettings.gridItems() -> [{ key, tab, label, icon,
    // app?, open? }]); until then the Settings item opens the Settings program as it is.
    const SETTINGS_TOP = new Set(['clock', 'lock', 'power', 'sounds', 'today']);
    // the ROM's Start icon of the same applet; applets WM does not have keep their own art, and so
    // do Buttons and About (Start_Icon_Buttons / _About show the Windows flag)
    const SETTINGS_ART65 = {
        backlight: 'backlight', clock: 'clock', connections: 'connections', input: 'input', lock: 'lock',
        memory: 'memory', owner: 'owner', power: 'power', regional: 'regional', 'remove-programs': 'removeprog', screen: 'screen',
        sounds: 'sounds', today: 'todayset', remote: 'pccon', wireless: 'wirelessmgr', domain: 'denroll', 'network-cards': 'wifi',
        'error-reporting': 'watson', 'link-taskmgr': 'taskmgr'
    };
    // Start_Icon_SettingsS carries the Windows flag: the System folder shows the plain Settings gear
    const SETTINGS_FOLDERS = [['connections', 'Connections', 'settingsc'], ['personal', 'Personal', 'settingsp'], ['system', 'System', 'settings']];

    function settingsGrid() {
        try {
            const ws = window.wmSettings;
            const l = ws && typeof ws.gridItems === 'function' ? ws.gridItems() : null;
            return Array.isArray(l) ? l : null;
        } catch (_) { return null; }
    }

    function settingsItems(folder) {
        const grid = settingsGrid() || [];
        const coll = new Intl.Collator(undefined, { sensitivity: 'base' });
        const byLabel = (x, y) => coll.compare(x.label, y.label);
        const applet = (g) => ({ key: `s:${g.key}`, label: g.label, img: SETTINGS_ART65[g.key] ? art65(SETTINGS_ART65[g.key]) : art61(g.icon || 'app-settings'), setting: g });
        if (folder !== 'settings') {
            const tab = folder.slice('settings:'.length);
            return grid.filter((g) => g.tab === tab && !SETTINGS_TOP.has(g.key)).map(applet).sort(byLabel);
        }
        const folders = SETTINGS_FOLDERS.filter(([tab]) => grid.some((g) => g.tab === tab && !SETTINGS_TOP.has(g.key)))
            .map(([tab, label, art]) => ({ key: `folder:settings:${tab}`, label, img: art65(art), folder: `settings:${tab}` }));
        return grid.filter((g) => SETTINGS_TOP.has(g.key)).map(applet).sort(byLabel).concat(folders);
    }

    function desktopLaunchables(list) {
        try {
            /* global startMenuLaunchables, startMenuGameLaunchables, buildToolsSubmenuItems, isStartMenuEntryEnabled */
            if (list === 'games') return typeof startMenuGameLaunchables !== 'undefined' ? startMenuGameLaunchables : [];
            if (list === 'toolbox') {
                if (typeof buildToolsSubmenuItems !== 'function') return [];
                return buildToolsSubmenuItems().filter((t) => t && !t.separator && !t.hasSubmenu && typeof t.action === 'function'
                    && !TOOLBOX_SKIP.has(t.launchId) && (typeof isStartMenuEntryEnabled !== 'function' || isStartMenuEntryEnabled(t)));
            }
            return typeof startMenuLaunchables !== 'undefined' ? startMenuLaunchables : [];
        } catch (_) { return []; }
    }

    /**
     * An app's name on Start: its own. A stock WM title that carries the Windows / Microsoft name
     * (wmMedia.js: "Windows Media") is replaced by the name of the desktop program it is the phone
     * version of (MAPPED: Media Player).
     */
    function appLabel(a) {
        const label = a.startLabel || a.title || a.id;
        if (!/windows|microsoft/i.test(label)) return label;
        const from = Object.keys(MAPPED).filter((k) => MAPPED[k].includes(a.id));
        const d = desktopLaunchables().concat(desktopLaunchables('toolbox')).find((l) => l && from.includes(l.launchId) && l.text);
        return d ? d.text : label.replace(/\s*(windows|microsoft)\s*/ig, ' ').trim() + (a.id === 'windows-media' ? ' Player' : '');
    }

    function appItem(a) {
        const n = APP_ART65[a.id];
        // Settings is a folder of Start once its applets can be listed
        if (a.id === 'settings' && settingsGrid()) return { key: 'a:settings', label: a.title || 'Settings', img: art65('settings'), folder: 'settings' };
        return { key: `a:${a.id}`, label: a.id === 'today' ? 'Today' : appLabel(a), img: n ? art65(n) : art61(a.icon || 'app-programs'), app: a.id };
    }

    /** The items of the Start screen (folder null) or of one of its folders, in their order. */
    function itemsFor(folder) {
        if (folder && String(folder).startsWith('settings')) return settingsItems(folder);
        const apps = sh.listApps();
        const have = new Set(apps.map((a) => a.id));
        const items = [];
        // the apps pinned on the 6.1 Start menu stay on Start itself; the rest of the suite is in its folder
        const inFolder = (a) => (DREAMSCAPE_APPS.has(a.id) && a.inStart !== 'top' && a.inStart !== 'bottom' ? 'dreamscape' : null);
        const desktopItem = (l) => {
            if (!l || !l.launchId || !l.text || !l.imageIcon) return;
            const mapped = MAPPED[l.launchId];
            if (mapped && mapped.some((id) => have.has(id))) return;
            if (IN_SETTINGS_DESKTOP.has(l.launchId)) return;
            if (!PHONE_DIRECT.has(l.launchId) && !(l.dsap || /^dsap/i.test(String(l.url || '')))) return;
            if ((DREAMSCAPE_DESKTOP.has(l.launchId) ? 'dreamscape' : null) !== (folder || null)) return;
            if (items.some((i) => i.key === `d:${l.launchId}`)) return;
            const art = DESKTOP_WM_ART[l.launchId];
            items.push({ key: `d:${l.launchId}`, label: l.text, img: art ? art61(art) : artDesktop(l.imageIcon), desktop: l.text, launch: l });
        };
        if (folder === 'games') {
            for (const g of desktopLaunchables('games')) {
                if (!g || !g.text || !g.imageIcon) continue;
                // listed, not yet playable on the phone (as in Programs > Games)
                items.push({ key: `d:${g.launchId}`, label: g.text, img: artDesktop(g.imageIcon), desktop: g.text });
            }
        } else {
            for (const a of apps) {
                if (!a.inStart || NOT_LISTED.has(a.id) || (inFolder(a) || null) !== (folder || null)) continue;
                items.push(appItem(a));
            }
            if (!folder) {
                if (desktopLaunchables('games').length) items.push({ key: 'folder:games', label: FOLDERS.games.label, img: FOLDERS.games.icon(), folder: 'games' });
                items.push({ key: 'folder:dreamscape', label: FOLDERS.dreamscape.label, img: FOLDERS.dreamscape.icon(), folder: 'dreamscape' });
            }
            desktopLaunchables().forEach(desktopItem);
            desktopLaunchables('toolbox').forEach(desktopItem);
        }
        const coll = new Intl.Collator(undefined, { sensitivity: 'base' });
        const moved = movedKeys(folder);
        const rank = (it) => {
            if (it.key === 'a:today') return -1e6;
            const m = moved.indexOf(it.key);
            if (m >= 0) return -1e5 + m;
            const r = folder ? -1 : RANK.indexOf(it.key);
            return r >= 0 ? r : 1e6;
        };
        return items.sort((x, y) => rank(x) - rank(y) || coll.compare(x.label, y.label));
    }

    // Move to Top: the keys moved, the latest first, per folder ('' = Start itself)
    function movedAll() {
        try {
            const v = JSON.parse(localStorage.getItem(ORDER_KEY) || 'null');
            return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
        } catch (_) { return {}; }
    }
    const movedKeys = (folder) => { const l = movedAll()[folder || '']; return Array.isArray(l) ? l : []; };
    function moveToTop(folder, key) {
        const all = movedAll();
        all[folder || ''] = [key].concat(movedKeys(folder).filter((k) => k !== key));
        try { localStorage.setItem(ORDER_KEY, JSON.stringify(all)); } catch (_) { /* this session only */ }
    }

    // ---------------------------------------------------------------- the screen

    let page = null;
    let view = null; // the 480x536 grid window
    let list = null; // the scrolled layer
    let glow = null; // the selection image
    let items = [];
    let selected = 0;
    const path = []; // open folders: [{ id, label, parentY, parentSel }]
    let y = 0; // scroll offset, CSS px (list drawn at -y)
    let maxY = 0;
    let raf = 0;
    let velocity = 0; // CSS px / ms while coasting
    let resume = false; // a Settings applet was opened from its folder: Start comes back as it was left
    let shownApp = ''; // the program on screen before the shell's last switch (html[data-wm-app], read late)

    const folderNow = () => (path.length ? path[path.length - 1].id : null);
    // one design unit (--wm-px) in CSS px, read from the layout: an icon is 45 units wide
    const unit = () => { const ic = list && list.querySelector('.wm-s65-icon'); return (ic ? ic.offsetWidth / 45 : 1) || 1; };

    function place(yNew) {
        y = yNew;
        // one composited layer moves: no layout, no paint of the cells
        list.style.transform = `translate3d(0,${-y}px,0)`;
    }

    function measure() {
        // fractional: a grid that ends on a middle-column cell is half a unit longer
        maxY = Math.max(0, list.getBoundingClientRect().height - view.clientHeight);
    }

    function stopMotion() {
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        velocity = 0;
    }

    /** Coast after a fling, and return from beyond an end. */
    function coast(v0) {
        stopMotion();
        velocity = v0;
        let last = performance.now();
        const step = (now) => {
            const dt = Math.min(34, now - last);
            last = now;
            const edge = Math.max(0, Math.min(maxY, y));
            if (y === edge) {
                velocity *= Math.exp(-dt / FRICTION_MS);
                place(y + velocity * dt);
                if (Math.abs(velocity) < 0.02) { stopMotion(); place(Math.round(y)); return; }
            } else {
                // critically damped: back to the end without swinging past it
                velocity += (-(y - edge) * SPRING - velocity * 2 * Math.sqrt(SPRING)) * dt;
                let next = y + velocity * dt;
                if ((y - edge) * (next - edge) < 0 || (Math.abs(next - edge) < 0.5 && Math.abs(velocity) < 0.05)) next = edge;
                place(next);
                if (next === edge) { stopMotion(); return; }
            }
            raf = requestAnimationFrame(step);
        };
        raf = requestAnimationFrame(step);
    }

    function select(i, reveal) {
        selected = Math.max(0, Math.min(items.length - 1, i));
        const cell = list.querySelector(`.wm-s65-cell[data-i="${selected}"]`);
        list.querySelectorAll('.wm-s65-cell.is-selected').forEach((c) => c.classList.remove('is-selected'));
        glow.hidden = !cell;
        if (!cell) return;
        cell.classList.add('is-selected');
        glow.style.setProperty('--c', cell.style.getPropertyValue('--c'));
        glow.style.setProperty('--r', cell.style.getPropertyValue('--r'));
        glow.style.setProperty('--m', cell.style.getPropertyValue('--m'));
        if (!reveal) return;
        // the selected cell is shown whole (emulator: Settings, cut by the bottom edge, moved the grid up)
        stopMotion();
        const top = cell.offsetTop;
        const bottom = top + cell.offsetHeight;
        if (top < y) place(top);
        else if (bottom > y + view.clientHeight) place(Math.min(maxY, bottom - view.clientHeight));
    }

    function render() {
        if (!page) return;
        items = itemsFor(folderNow());
        let half = 0; // the grid's height in half rows: the lowest cell's bottom edge
        const cells = items.map((it, i) => {
            const c = i % 3;
            const r = Math.floor(i / 3);
            half = Math.max(half, 2 * r + (c === 1 ? 1 : 0) + 2);
            const ic = it.img;
            return `<button type="button" class="wm-s65-cell" role="listitem" data-i="${i}" style="--c:${c};--r:${r};--m:${c === 1 ? 1 : 0}">`
                + `<img class="wm-s65-icon" src="${esc(ic.src)}"${ic.srcset ? ` srcset="${esc(ic.srcset)}"` : ''} alt="" draggable="false" decoding="async">`
                + `<span class="wm-s65-label">${esc(it.label)}</span></button>`;
        });
        list.style.setProperty('--half', String(half));
        list.innerHTML = '<div class="wm-s65-glow" aria-hidden="true" hidden></div>' + cells.join('');
        glow = list.firstElementChild;
        measure();
        if (sh.current === 'start') sh.setTitle(path.length ? path[path.length - 1].label : 'Start');
    }

    /** Start's picture: Today's, where Today shows it, under the ROM's 50 % black sheet. */
    function paintWallpaper() {
        const pic = page.querySelector('.wm-s65-wall');
        let src = null;
        try { src = sh.pageOf('today'); } catch (_) { src = null; }
        const on = !!(src && src.classList.contains('has-picture') && src.style.backgroundImage);
        pic.hidden = !on;
        if (!on) return;
        Object.assign(pic.style, {
            backgroundImage: src.style.backgroundImage, backgroundSize: src.style.backgroundSize || 'cover',
            backgroundPosition: src.style.backgroundPosition || 'center', backgroundRepeat: src.style.backgroundRepeat || 'no-repeat',
            backgroundColor: src.style.backgroundColor || '#000'
        });
    }

    function openFolder(it) {
        path.push({ id: it.folder, label: it.label, parentY: y, parentSel: selected });
        stopMotion();
        render();
        place(0);
        select(0, false);
        sh.syncHistory();
        sh.refreshSoftKeys();
    }

    /** Back from a folder: the grid as it was left, the folder's item selected. */
    function closeFolder() {
        const f = path.pop();
        if (!f) return false;
        stopMotion();
        render();
        place(Math.max(0, Math.min(maxY, f.parentY)));
        select(f.parentSel, false);
        // the left soft key is Lock again (the back key's path does not redraw the keys itself)
        sh.refreshSoftKeys();
        return true;
    }

    function openItem(i) {
        const it = items[i];
        if (!it) return;
        if (it.folder) { openFolder(it); return; }
        if (it.setting) { openSetting(it.setting); return; }
        if (it.app) { sh.open(it.app, { fromStart: true }); return; }
        // a Dreamscape app page: its own route (Internet Explorer's mobile view), under the wait cursor
        if (it.launch) { sh.busy(() => it.launch.action(), { paint: true, timeout: 15000 }); return; }
        sh.notify({ title: it.desktop, icon: 'info', text: `${it.desktop} is not available on Melaton Mobile yet.` });
    }

    /** An applet of the Settings folder: its page (ok and back return here), or the program it links. */
    function openSetting(g) {
        if (g.app) { sh.open(g.app); return; }
        if (typeof g.open === 'function') { g.open(); return; }
        resume = true;
        if (!window.wmSettings.open(g.key, null, { direct: true })) resume = false;
    }

    function holdMenu(i, x, yPt) {
        const it = items[i];
        if (!it) return;
        select(i, true);
        if (it.key === 'a:today') return; // already the first item, always
        sh.menuAt(x, yPt, [{
            label: 'Move to Top',
            action: () => {
                moveToTop(folderNow(), it.key);
                stopMotion();
                render();
                place(0);
                select(items.findIndex((n) => n.key === it.key), true);
            }
        }]);
    }

    /** The finger: pan past the start distance, fling on release, tap, tap-and-hold. */
    function bindTouch() {
        let id = null;
        let downX = 0;
        let downY = 0;
        let baseY = 0; // pointer y where the pan began
        let y0 = 0;
        let cell = -1;
        let panning = false;
        let held = false;
        let caught = false; // the press stopped a moving grid: not a tap
        let holdTimer = 0;
        let samples = [];

        const end = () => {
            clearTimeout(holdTimer);
            holdTimer = 0;
            id = null;
        };

        view.addEventListener('pointerdown', (e) => {
            if (id !== null || (e.pointerType === 'mouse' && e.button !== 0)) return;
            id = e.pointerId;
            // a press that stops a coasting grid, or that closes an open menu (the shell closes it on
            // the click), is not a tap on the item under it
            caught = (!!raf && Math.abs(velocity) > 0.05) || !!document.querySelector('#wmShell .wm-popup:not([hidden])');
            stopMotion();
            downX = e.clientX;
            downY = e.clientY;
            panning = false;
            held = false;
            samples = [];
            const c = e.target.closest('.wm-s65-cell');
            cell = c ? Number(c.dataset.i) : -1;
            try { view.setPointerCapture(id); } catch (_) { /* a synthetic pointer */ }
            clearTimeout(holdTimer);
            holdTimer = setTimeout(() => {
                holdTimer = 0;
                if (id === null || panning || caught || cell < 0) return;
                held = true;
                holdMenu(cell, downX, downY);
            }, HOLD_MS);
        });

        view.addEventListener('pointermove', (e) => {
            if (e.pointerId !== id || held) return;
            if (!panning) {
                if (Math.abs(e.clientY - downY) <= PAN_START * unit()) return;
                // the pan starts where the finger is now: the grid does not jump by the start distance
                panning = true;
                clearTimeout(holdTimer);
                baseY = e.clientY;
                y0 = y;
            }
            place(y0 - (e.clientY - baseY));
            samples.push([e.timeStamp, e.clientY]);
            if (samples.length > 8) samples.shift();
        });

        const release = (e, cancelled) => {
            if (e.pointerId !== id) return;
            const wasPanning = panning;
            const wasHeld = held;
            const wasCaught = caught;
            const hit = cell;
            end();
            if (wasPanning) {
                // the speed of the pan's last 120 ms; a finger that rested before it lifted does not fling
                let v = 0;
                const lastAt = samples.length ? samples[samples.length - 1][0] : 0;
                const recent = e.timeStamp - lastAt > 150 ? [] : samples.filter((s) => lastAt - s[0] <= 120);
                if (!cancelled && recent.length >= 2) {
                    const a = recent[0];
                    const b = recent[recent.length - 1];
                    if (b[0] > a[0]) v = -(b[1] - a[1]) / (b[0] - a[0]);
                }
                if (Math.abs(v) < 0.1) v = 0;
                if (v || y < 0 || y > maxY) coast(Math.max(-6, Math.min(6, v)));
                return;
            }
            if (y < 0 || y > maxY) coast(0);
            if (wasHeld) {
                // the finger lifting after the hold is not a tap outside the menu: its click would close it
                const eat = (ce) => { ce.stopPropagation(); ce.preventDefault(); };
                window.addEventListener('click', eat, { capture: true, once: true });
                setTimeout(() => window.removeEventListener('click', eat, { capture: true }), 400);
            }
            if (cancelled || wasHeld || wasCaught || hit < 0) return;
            if (Math.abs(e.clientX - downX) > PAN_START * unit()) return;
            // WM's tap: the item is selected (the glow), then opens
            select(hit, true);
            setTimeout(() => { if (sh.current === 'start' && selected === hit) openItem(hit); }, 90);
        };
        view.addEventListener('pointerup', (e) => release(e, false));
        view.addEventListener('pointercancel', (e) => release(e, true));
        // the browser's own long-press menu and the shell's page gestures stay out of the grid
        view.addEventListener('contextmenu', (e) => e.preventDefault());
        ['touchstart', 'touchmove'].forEach((t) => view.addEventListener(t, (e) => e.stopPropagation(), { passive: true }));
        // a keyboard's Enter / Space on a focused item (pointer taps are handled above)
        view.addEventListener('click', (e) => {
            const c = e.target.closest('.wm-s65-cell');
            if (!c || e.detail !== 0) return;
            select(Number(c.dataset.i), true);
            openItem(Number(c.dataset.i));
        });
        view.addEventListener('wheel', (e) => {
            stopMotion();
            place(Math.max(0, Math.min(maxY, y + e.deltaY)));
        }, { passive: true });
    }

    /**
     * Lock (left soft key). Melaton Mobile has no lock screen of its own yet: the desktop's
     * (workstationLock.js) refuses outside desktop mode. The key calls the phone's lock when a
     * later slice provides one (window.wmLock.lock).
     */
    function lock() {
        try {
            if (window.wmLock && typeof window.wmLock.lock === 'function') window.wmLock.lock();
        } catch (err) { console.warn('[wmStart65] lock', err); }
    }

    function register() {
        sh = window.wmShell;
        if (!sh || typeof sh.registerApp !== 'function') return;
        loadManifest().then(() => { if (page && page.isConnected && sh.current === 'start') { const keep = y; const sel = selected; render(); place(Math.min(maxY, keep)); select(sel, false); } });
        // the shell sets html[data-wm-app] before it calls show(); the observer runs after it, so
        // show() still reads the program that was on screen
        shownApp = root.dataset.wmApp || '';
        new MutationObserver(() => { shownApp = root.dataset.wmApp || ''; }).observe(root, { attributes: true, attributeFilter: ['data-wm-app'] });
        // the X ends Start (its page is made again on the next open): listeners outside the page are set once
        window.addEventListener('resize', () => { if (page && page.isConnected && !page.hidden) { measure(); place(Math.max(0, Math.min(maxY, y))); } });
        sh.registerApp({
            id: 'start',
            title: 'Start',
            icon: 'app-programs',
            inStart: false,
            mount(p) {
                page = p;
                page.classList.add('wm-s65');
                page.innerHTML = '<div class="wm-s65-wall" hidden></div><div class="wm-s65-sheet"></div>'
                    + '<div class="wm-s65-view"><div class="wm-s65-list" role="list"></div></div>';
                view = page.querySelector('.wm-s65-view');
                list = page.querySelector('.wm-s65-list');
                bindTouch();
            },
            // Start always opens at its top with Today selected (emulator, after any program)
            show() {
                stopMotion();
                paintWallpaper();
                // back from the applet (the program shown until now is Settings): the folder as it was left
                if (resume && shownApp === 'settings' && list.childElementCount) {
                    resume = false;
                    if (path.length) sh.setTitle(path[path.length - 1].label);
                    return;
                }
                resume = false;
                path.length = 0;
                render();
                place(0);
                select(0, false);
            },
            hide() { stopMotion(); },
            softKeys() {
                if (path.length) return { left: { label: 'Back', action: () => { if (closeFolder()) sh.syncHistory(); } }, right: null };
                return { left: { label: 'Lock', action: lock }, right: null };
            },
            titleKind: () => 'close',
            historyDepth: () => path.length,
            // X in a folder goes back to Start, as in Programs (Yukimi, Nov 10); X on Start closes it
            closeGoesBack: true,
            onBack: () => closeFolder()
        });
    }

    if (window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
