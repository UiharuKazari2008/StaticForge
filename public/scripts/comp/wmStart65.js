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
 *   - title bar "Start" with X (closes Start, back to the program under it); left soft key
 *     Lock, no right soft key.
 * Not measured (the emulator's screenshot latency hides them): the fling's deceleration, the
 * length of the return from an overscroll.
 *
 * The order (Yozora #748; device instance of the emulator manager, CE OS 5.2.21234, 16 ms
 * recordings and the registry under HKLM\Security\Shell\StartInfo\Start):
 *   - every item has a Rank, read as a signed number, the largest first: Today 2147483647, the
 *     ROM's programs 900000998 (Phone) down to 900000728 (Help) in steps of 10; a program
 *     without one (Search Widget, SimTkUI) counts as 0 and follows them, by name; a program
 *     added later takes InstallRank, which starts at 0xFFFFFFFF (-1) and counts down: new
 *     programs land at the very end, in the order they were added (Zebra then Aardvark, added
 *     in that order, were listed in that order). Folders (Games, Office Mobile, Settings and
 *     its three folders) list their own items by name.
 *   - tap-and-hold (ring of dots, then the menu while the pen is still down; the glow moves to
 *     the item when the menu shows): "Move to Top" on any item, Today included. It marks the
 *     item Favorite with the time (FavoriteOrder): favourites are listed first, the latest
 *     first, before Today. A favourite's menu is "Move to Top" and "Move Down", the first
 *     favourite's "Move Down" alone: it takes the mark away and the item is back at its rank.
 *     Nothing else reorders in this build, and no setting does.
 *   - in a folder "Move to Top" puts the program (or the folder: Connections) at the top of
 *     Start itself; it stays listed in its folder, where nothing moves. Once it is on Start a
 *     hold on it in the folder does nothing at all (no menu, the glow stays where it was).
 *   - both commands redraw in one frame (about 70 ms after the pen lifts), nothing slides. The
 *     glow keeps its place in the grid (the same index: another program is under it now). The
 *     grid is shown from its top when that cell is whole there, else with the cell's top 204 px
 *     (102 units) under the grid's top edge, even when that is past the grid's end (the last
 *     item: 166 px of empty space under it, at rest until the next pan lets go). Back from a
 *     folder places the folder's cell by the same rule.
 *   - the menu hangs to the left of the pen: its frame's top right corner is 5 px right of and
 *     11 px under the pen (pen 240,360: frame 14..245 x 371..436), never left of x 14.
 *   - the order is in the registry: it was the same after Start was closed and opened again.
 * Dragging an icon to a new place is Windows Mobile 6.5.3's (Yukimi asked for it too): no
 * 6.5.3 device could be run, so that part follows its documentation only and nothing of it is
 * measured (see startDrag).
 */
(function () {
    'use strict';
    const root = document.documentElement;
    if (window.uiShell !== 'mobile' || root.dataset.wmVersion !== '6.5') return;

    const ART65 = '/static_images/wm65/';
    // the first format (Move to Top lists per folder): read when nothing newer is stored, never written
    const ORDER_KEY = 'wmStart65Order';
    // { v: 1, top: [keys moved to the top of Start, the latest first], order: { '<folder>': [keys] } }
    const LAYOUT_KEY = 'wmStart65Layout';
    // start distance of a pan and the hold time (see the header: the first is between 15 and 20 units)
    const PAN_START = 16;
    // after a completed hold the icon lifts once the finger has gone this far (units; not measured)
    const DRAG_START = 6;
    // a lifted icon this near the grid's top or bottom edge scrolls it (units; not measured)
    const DRAG_EDGE = 24;
    const REFLOW_MS = 160;
    // the shell's tap-and-hold time: its ring of dots is whole then (wmShell.js bindHoldRing)
    const HOLD_MS = ((window.wmShell && window.wmShell.holdMs) || 800);
    // fling: speed falls by e every FRICTION_MS; past an end a critically damped spring pulls back
    const FRICTION_MS = 420;
    const SPRING = 0.00035;

    let sh = null; // window.wmShell
    let manifest = null; // wm61 art names (the -lg, 32 px versions)

    const esc = (s) => sh.escapeHtml(s);

    // ---------------------------------------------------------------- art

    /** A 6.5 Start icon from the ROM (Start_Icon_<name>.png, 90x90, with its half-size copy). */
    const art65 = (name) => ({ src: `${ART65}start-${name}.png`, srcset: `${ART65}start-${name}.png 1x, ${ART65}start-${name}@2x.png 2x, ${ART65}start-${name}@4x.png 4x` });

    /** The largest copy of a 6.1 shell icon (app-x-lg@4x is 128 px), drawn into the 90x90 box. */
    function art61(name) {
        // a Program Icons set (#773): its largest frame, -lg@4x (128 px)
        if (sh.art.isSet && sh.art.isSet(name)) return { src: `${name}-lg@4x.png`, srcset: '' };
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
        settings: 'settings', help: 'help', tasks: 'tasks', search: 'search', activesync: 'async',
        // Text: the ROM's Text icon (Text Messaging, #779)
        textmessaging: 'sms'
    };
    // WM 6.5's own order, read from a factory device (ranks under HKLM\Security\Shell\StartInfo and
    // the screen): Today, Phone, Text, E-mail, Contacts, Internet Explorer, Calendar, Settings,
    // Getting Started, Pictures & Videos, Windows Media, Marketplace, Messenger, Microsoft My Phone,
    // Windows Live, Calculator, Games, Notes, Tasks, Office Mobile, File Explorer, ActiveSync,
    // Internet Sharing, Task Manager, Search Phone, Help, then the programs without a rank by name
    // (Search Widget, SimTkUI). Here: the apps that have a place in it, in that order (Messaging
    // is Text and E-mail, the Dreamscape folder stands where Office Mobile does); the Director and
    // Studio, pinned at the top of the 6.1 Start menu, follow Settings. Everything else comes
    // after, by name, as the device's programs without a rank do.
    // Yukimi (Nov 12): the screen must feel like the device's, with Settings where the hand expects
    // it. So the device's programs keep the device's CELLS, and Melaton's own take the cells of the
    // device programs it has no equal of: the Director and Studio stand where Phone and Text do
    // (cells 2 and 3), Messaging is E-mail, so Contacts, Internet Explorer, Calendar and Settings
    // (cell 8: second in the third row of three) fall where the device has them; Weather has Getting
    // Started's cell before Pictures and Media.
    // Yukimi (Nov 12, second pass): the Dreamscape folder, File Explorer and Games stand in the three
    // cells before Calculator; PayPass, Remote Desktop and XLink are unranked and come last, by name.
    // Text (Text Messaging, #779) follows Settings so the device cells above keep their places
    const RANK = ['a:today', 'a:director', 'a:studio', 'a:messaging', 'a:contacts', 'a:browser', 'a:calendar', 'a:settings',
        'a:textmessaging', 'a:weather', 'a:gallery', 'a:windows-media', 'folder:dreamscape', 'a:fileexplorer', 'folder:games',
        'a:calculator', 'a:notes', 'a:tasks', 'a:activesync', 'a:taskmgr', 'a:search', 'a:help'];

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
    const FOLDER_ART65 = new Set(['android', 'work']);
    const FOLDERS = {
        games: { label: 'Games', icon: () => art65('games') },
        // 6.5's own folder with its 3D emblem in front (scripts/build-wm65-folder-icons.py, #805)
        dreamscape: { label: 'Dreamscape', icon: () => art65('folder-dreamscape') }
    };

    // ---- Settings: on WM 6.5 a folder of the Start screen (title "Settings", soft key Back): the
    // applets Bluetooth, Clock & Alarms, Lock, Power, Sounds & Notifications and Today, then the
    // folders Connections, Personal and System, each sorted by name (emulator). The applets come
    // from wmPrograms.js when it exports them (wmSettings.gridItems() -> [{ key, tab, label, icon,
    // app?, open? }]); until then the Settings item opens the Settings program as it is.
    // the phone's own Android Settings sits in Settings itself, not in System (Yukimi, Nov 12, #777)
    // Bluetooth is the folder's first item, as on the device (Yukimi, Nov 13 2026, #805)
    const SETTINGS_TOP = new Set(['bluetooth', 'clock', 'lock', 'power', 'sounds', 'today', 'link-android']);
    // the ROM's Start icon of the same applet (HKLM\Security\Shell\StartInfo\Start\Settings\...
    // Icon); applets WM does not have keep their own art. About, Buttons and System carry the
    // Melaton flower where the ROM art has the Windows flag; Melaton Update is the device's Windows
    // Update icon (autoupdatecpl.cpl icon 101, no Start icon of its own) with the flower (#805)
    const SETTINGS_ART65 = {
        about: 'about', backlight: 'backlight', bluetooth: 'bluetooth', buttons: 'buttons', certificates: 'certificates', clock: 'clock',
        connections: 'connections', contrast: 'contrast', encryption: 'encryption', gps: 'gps', input: 'input', lock: 'lock', managed: 'managed',
        memory: 'memory', owner: 'owner', power: 'power', regional: 'regional', 'remove-programs': 'removeprog', screen: 'screen',
        // continuity: the ROM's USB to PC (pccon); remote (Remote Access): Vista's Remote Desktop Connection
        // icon (mstscax.dll 0 at its native 256 px, from the Vista VM: 6.5's ROM has no Remote Desktop Mobile); 6.1 keeps tsclient
        sounds: 'sounds', today: 'todayset', continuity: 'pccon', remote: 'remote-access', wireless: 'wirelessmgr', domain: 'denroll', 'network-cards': 'wifi',
        'error-reporting': 'watson', 'link-taskmgr': 'taskmgr', update: 'update'
    };
    // Start_Icon_SettingsS: the folder with the OS logo (the Melaton flower in place of the flag)
    const SETTINGS_FOLDERS = [['connections', 'Connections', 'settingsc'], ['personal', 'Personal', 'settingsp'], ['system', 'System', 'settingss']];

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
        // the phone's own Android Settings comes last, after System (Yukimi, Nov 12 2026)
        const last = new Set(['link-android']);
        return grid.filter((g) => SETTINGS_TOP.has(g.key) && !last.has(g.key)).map(applet).sort(byLabel)
            .concat(folders, grid.filter((g) => last.has(g.key)).map(applet));
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
     * (wmMedia.js: "Melaton Media") is replaced by the name of the desktop program it is the phone
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
        const n = APP_ART65[a.id] || a.art65; // art65: an app that names its own 6.5 Start icon (wmAndroidApps.js)
        // Settings is a folder of Start once its applets can be listed
        if (a.id === 'settings' && settingsGrid()) return { key: 'a:settings', label: a.title || 'Settings', img: art65('settings'), folder: 'settings' };
        return { key: `a:${a.id}`, label: a.id === 'today' ? 'Today' : appLabel(a), img: n ? art65(n) : art61(a.icon || 'app-programs'), app: a.id };
    }

    /** The items of the Start screen (folder null) or of one of its folders, in the default order. */
    function baseItems(folder) {
        if (folder && String(folder).startsWith('settings')) return settingsItems(folder);
        const apps = sh.listApps();
        const have = new Set(apps.map((a) => a.id));
        const items = [];
        // the apps pinned on the 6.1 Start menu stay on Start itself; the rest of the suite is in its folder
        // a folder other files added to Programs (wmSettings.addProgramFolder: the phone's Android programs)
        const extra = new Map((window.wmSettings && typeof window.wmSettings.programFolders === 'function' ? window.wmSettings.programFolders() : []).filter((f) => f.extra).map((f) => [f.id, f]));
        const inFolder = (a) => {
            if (a.inStart !== 'top' && a.inStart !== 'bottom') {
                if (DREAMSCAPE_APPS.has(a.id)) return 'dreamscape';
                // a phone program that is a game (the Android ones, #773)
                if (a.programsFolder === 'games') return 'games';
                if (a.programsFolder && extra.has(a.programsFolder)) return a.programsFolder;
            }
            return null;
        };
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
            // only the phone's own games, as in Programs > Games (#786)
            for (const a of apps) if (a.inStart && !NOT_LISTED.has(a.id) && inFolder(a) === 'games') items.push(appItem(a));
        } else {
            // folders made inside this folder (Android / Work, #805): the plain 6.5 folder, even while empty
            if (folder) {
                for (const [id, f] of extra) if (f.parent === folder) items.push({ key: `folder:${id}`, label: f.label, img: art65('folder'), folder: id });
            }
            for (const a of apps) {
                if (!a.inStart || NOT_LISTED.has(a.id) || (inFolder(a) || null) !== (folder || null)) continue;
                items.push(appItem(a));
            }
            if (!folder) {
                if (apps.some((a) => a.inStart && inFolder(a) === 'games')) items.push({ key: 'folder:games', label: FOLDERS.games.label, img: FOLDERS.games.icon(), folder: 'games' });
                items.push({ key: 'folder:dreamscape', label: FOLDERS.dreamscape.label, img: FOLDERS.dreamscape.icon(), folder: 'dreamscape' });
                for (const [id, f] of extra) {
                    if (f.parent) continue; // listed inside its parent folder
                    // 6.5's folders (Android, Work: their 3D emblem; any other: the plain 6.5 folder)
                    const holds = (a) => { const at = inFolder(a); return at === id || (extra.get(at) || {}).parent === id; };
                    if (apps.some((a) => a.inStart && holds(a))) items.push({ key: `folder:${id}`, label: f.label, img: art65(FOLDER_ART65.has(id) ? `folder-${id}` : 'folder'), folder: id });
                }
            }
            desktopLaunchables().forEach(desktopItem);
            desktopLaunchables('toolbox').forEach(desktopItem);
        }
        const coll = new Intl.Collator(undefined, { sensitivity: 'base' });
        const rank = (it) => {
            const r = folder ? -1 : RANK.indexOf(it.key);
            return r >= 0 ? r : 1e6;
        };
        return items.sort((x, y) => rank(x) - rank(y) || coll.compare(x.label, y.label));
    }

    // ---- the user's order. Stored per device, as the device keeps its own in its registry:
    // top: the keys moved to the top of Start (Move to Top), the latest first, whatever folder
    // they are from; order: a folder's keys as they were left by dragging ('' is Start itself).
    // A key nothing answers to is skipped (and kept: the program may come back); a program that is
    // in no stored order goes to the end, where the device puts a new program.
    // keys of the Android programs ("a:android:<package>/<activity>") can be long: up to 240 characters
    const strings = (l) => (Array.isArray(l) ? l.filter((k) => typeof k === 'string' && k.length <= 240).slice(0, 400) : []);
    function layout() {
        const read = (key) => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (_) { return null; } };
        const plain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
        const out = { top: [], order: {} };
        const now = read(LAYOUT_KEY);
        if (plain(now)) {
            out.top = strings(now.top);
            if (plain(now.order)) for (const [f, l] of Object.entries(now.order)) { if (Array.isArray(l)) out.order[f] = strings(l); }
            return out;
        }
        // the first format: Start's list is the same thing; a folder's list was that folder's own
        // top, which the device does not have: kept as the folder's order, so nothing moves
        const old = read(ORDER_KEY);
        if (plain(old)) for (const [f, l] of Object.entries(old)) { if (!Array.isArray(l)) continue; if (f === '') out.top = strings(l); else out.order[f] = strings(l); }
        return out;
    }
    function saveLayout(l) {
        try { localStorage.setItem(LAYOUT_KEY, JSON.stringify({ v: 1, top: l.top, order: l.order })); } catch (_) { /* this session only */ }
        try { document.dispatchEvent(new CustomEvent('wmSettingsChange', { detail: { keys: [LAYOUT_KEY] } })); } catch (_) { /* no listener */ }
    }

    const FOLDER_IDS = ['games', 'dreamscape', 'settings', 'settings:connections', 'settings:personal', 'settings:system'];

    /** A folder's items in the stored order: the default order when it was never dragged. */
    function orderedItems(folder, lay) {
        const base = baseItems(folder);
        const order = lay.order[folder || ''];
        if (!order || !order.length) return base;
        const at = new Map(order.map((k, i) => [k, i]));
        const pos = (it) => (at.has(it.key) ? at.get(it.key) : 1e6);
        // Array.prototype.sort is stable: the items the order does not know keep the default order
        return base.sort((x, y) => pos(x) - pos(y));
    }

    /** The programs moved to the top of Start, the first one first (each with .from: its folder, '' for Start). */
    function topItems(lay) {
        if (!lay.top.length) return [];
        const found = new Map();
        for (const f of [null].concat(FOLDER_IDS)) {
            for (const it of baseItems(f)) { if (lay.top.includes(it.key) && !found.has(it.key)) found.set(it.key, Object.assign({}, it, { from: f || '', top: true })); }
        }
        return lay.top.filter((k) => found.has(k)).map((k) => found.get(k));
    }

    /** The items of the Start screen (folder null) or of one of its folders, as they are shown. */
    function itemsFor(folder) {
        const lay = layout();
        const own = orderedItems(folder, lay);
        if (folder) return own;
        const top = topItems(lay);
        const keys = new Set(top.map((it) => it.key));
        return top.concat(own.filter((it) => !keys.has(it.key)));
    }

    /** Move to Top (up) and Move Down: the key joins the head of Start's top list, or leaves the list. */
    function setTop(key, up) {
        const lay = layout();
        lay.top = (up ? [key] : []).concat(lay.top.filter((k) => k !== key));
        saveLayout(lay);
    }

    // ---------------------------------------------------------------- the screen

    let page = null;
    let view = null; // the 480x536 grid window
    let list = null; // the scrolled layer
    let glow = null; // the selection image
    let items = [];
    let selected = 0;
    const path = []; // open folders: [{ id, label, parentKey, parentSel }]
    let y = 0; // scroll offset, CSS px (list drawn at -y)
    let maxY = 0;
    let raf = 0;
    let velocity = 0; // CSS px / ms while coasting
    let resume = false; // a Settings applet was opened from its folder: Start comes back as it was left
    let shownApp = ''; // the program on screen before the shell's last switch (html[data-wm-app], read late)

    const folderNow = () => (path.length ? path[path.length - 1].id : null);
    // one design unit (--wm-px) in CSS px; when the property is not a plain length, read from the
    // layout: an icon is 45 units wide (to the nearest CSS px: 68 for 67.5)
    const unit = () => {
        const v = parseFloat(getComputedStyle(root).getPropertyValue('--wm-px'));
        if (v > 0) return v;
        const ic = list && list.querySelector('.wm-s65-icon');
        return (ic ? ic.offsetWidth / 45 : 1) || 1;
    };

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

    let cols = 3;
    function columnsFor() {
        const unit = parseFloat(getComputedStyle(root).getPropertyValue('--wm-px')) || 1;
        const w = (view && view.clientWidth) || window.innerWidth || 0;
        // a phone-width screen keeps the device's three columns whatever its unit (Yukimi: the
        // Fold7 cover screen, 480 CSS px at a small --wm-px, got four); wider screens (the Fold
        // opened, a tablet) take as many as fit at the 72-unit pitch
        if (w < 600) return 3;
        return Math.max(3, Math.floor((w / unit - 24) / 72));
    }

    function render() {
        if (!page) return;
        items = itemsFor(folderNow());
        let half = 0; // the grid's height in half rows: the lowest cell's bottom edge
        // the device's three columns are 72 units apart (the last cell 96 wide): a wider screen
        // takes as many as fit at that pitch, every second one half a row down
        cols = columnsFor();
        list.style.setProperty('--s65-pitch', `${100 / (cols + 1 / 3)}%`);
        const cells = items.map((it, i) => {
            const c = i % cols;
            const r = Math.floor(i / cols);
            half = Math.max(half, 2 * r + (c % 2 === 1 ? 1 : 0) + 2);
            const ic = it.img;
            return `<button type="button" class="wm-s65-cell" role="listitem" data-i="${i}" style="--c:${c};--r:${r};--m:${c % 2 === 1 ? 1 : 0}">`
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
        endDrag(false);
        path.push({ id: it.folder, label: it.label, parentKey: it.key, parentSel: selected });
        stopMotion();
        render();
        place(0);
        select(0, false);
        sh.syncHistory();
        sh.refreshSoftKeys();
    }

    /** Where item k of the grid is: its column, row and box in the list, CSS px. */
    function slotPos(k) {
        const u = unit();
        const c = k % cols;
        const r = Math.floor(k / cols);
        const m = c % 2 === 1 ? 1 : 0;
        const pitch = list.clientWidth / (cols + 1 / 3);
        return { c, r, m, left: c * pitch, top: (r * 83 + m * 41.5) * u, w: pitch * 4 / 3, h: 83 * u };
    }

    /**
     * The grid after it was listed again (Move to Top, Move Down, back from a folder), as the
     * device shows it: from the top when the selected cell is whole there, else with that cell's
     * top 102 units under the grid's top edge (recorded: the icon's top at y 260 of the screen
     * every time), not held back at the grid's end: the last item rests with empty space under
     * it until the next pan lets go. The 102 is taken as the middle of the grid's window less
     * 32 units ((268 - 64) / 2), so a taller screen keeps the cell near its middle (not measured:
     * the device has one height).
     */
    function settle() {
        stopMotion();
        select(selected, false);
        if (!items.length) { place(0); return; }
        const p = slotPos(selected);
        const vh = view.clientHeight;
        place(p.top + p.h <= vh ? 0 : Math.max(0, p.top - (vh - 64 * unit()) / 2));
    }

    /** Back from a folder: the folder's item selected, the grid placed for it (settle). */
    function closeFolder() {
        const f = path.pop();
        if (!f) return false;
        endDrag(false);
        render();
        // the folder's own item, wherever it is now (a program moved to the top from inside the
        // folder shifts it: the device's glow was on Games, one place further)
        const at = items.findIndex((n) => n.key === f.parentKey);
        selected = at >= 0 ? at : f.parentSel;
        settle();
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

    /**
     * Tap-and-hold, as recorded on the device: the glow moves to the item and the menu opens,
     * "Move to Top" (not for the first of the moved items) and "Move Down" (moved items only).
     * In a folder the command puts the program at the top of Start and the folder stays as it
     * is; a program that is on Start's top already gets nothing there, not even the glow.
     * Returns false when the device shows no menu.
     */
    function holdMenu(i, x, yPt) {
        const it = items[i];
        if (!it) return false;
        const folder = folderNow();
        const top = topItems(layout()).map((t) => t.key);
        const at = top.indexOf(it.key);
        // a program's own rows (the Android programs: Add to Start, Move to Games, Hide ...; #773); a
        // folder made inside Android / Work: Rename, Delete, New Folder (#805)
        const AF = window.wmAndroidFolders;
        const own = it.app ? sh.appHoldMenu(it.app) : (it.folder && AF && AF.isUser(it.folder) ? AF.folderRows(it.folder) : []);
        if (folder && at >= 0 && !own.length) return false;
        select(i, true);
        const run = (up) => () => {
            setTop(it.key, up);
            if (folder) return;
            // one redraw, nothing slides; the glow keeps its place in the grid (another program
            // is under it now)
            render();
            settle();
        };
        const rows = [];
        if (!(folder && at >= 0)) {
            if (at !== 0) rows.push({ label: 'Move to Top', action: run(true) });
            if (at >= 0) rows.push({ label: 'Move Down', action: run(false) });
        }
        if (own.length) rows.push(...(rows.length ? ['-'] : []), ...own);
        sh.menuAt(x, yPt, rows);
        // Start's menu hangs to the left of the pen: the frame's top right corner 2.5 units right
        // of and 5.5 under it, its left edge never under 7 units (pen 240,360 on the device: frame
        // 14..245 x 371..436; pen 95,100: 14..232). The shell keeps it inside the page when it
        // would not fit under the pen (not seen on the device)
        const pop = document.querySelector('#wmShell .wm-popup');
        const shell = document.getElementById('wmShell');
        if (pop && shell && !pop.hidden) {
            const sr = shell.getBoundingClientRect();
            const vr = view.getBoundingClientRect();
            const u = unit();
            pop.style.left = `${Math.max(7 * u, x - sr.left + 2.5 * u - pop.offsetWidth)}px`;
            const t = yPt + 5.5 * u;
            if (t + pop.offsetHeight <= vr.bottom) pop.style.top = `${t - sr.top}px`;
        }
        return true;
    }

    // ---- dragging an icon to a new place: Windows Mobile 6.5.3's way of ordering Start (this
    // ROM, 6.5, has the two menu commands only). No 6.5.3 device could be run, so NOTHING here is
    // measured: after a completed hold the icon lifts once the finger moves on (the menu, if
    // one opened, closes), follows the finger a little larger, the others make room at the place
    // nearest to it, the grid scrolls when the icon is near its top or bottom edge, and letting
    // go puts it there. Let go outside the grid, a second finger, the back key or leaving Start
    // put everything back. A folder's icons move within the folder. On Start the moved-to-top
    // programs are the head of the list: an icon dropped among them joins them (it gets "Move
    // Down"), one of them dropped below leaves them; a program that is only a guest there (it
    // lives in a folder) stays among them.
    let drag = null;

    function startDrag(i, e) {
        const cell = list.querySelector(`.wm-s65-cell[data-i="${i}"]`);
        const it = items[i];
        if (!cell || !it || items.length < 2) return false;
        stopMotion();
        sh.closeMenus();
        select(i, false);
        const tops = folderNow() ? 0 : items.filter((n) => n.top).length;
        drag = {
            i, cell, x0: e.clientX, y0: e.clientY, scroll0: y, slot: i, tops,
            // a guest from a folder stays among the moved-to-top programs
            lo: 0, hi: it.top && it.from ? tops - 1 : items.length - 1,
            px: e.clientX, py: e.clientY, raf: 0, last: 0
        };
        list.classList.add('is-dragging');
        cell.classList.add('is-lifted');
        glow.classList.add('is-lifted');
        sh.syncHistory();
        dragMove(e.clientX, e.clientY);
        return true;
    }

    /** The order of the cells while the lifted one stands at a slot: item indexes by position. */
    function dragOrder(i, slot) {
        const arr = items.map((_, k) => k).filter((k) => k !== i);
        arr.splice(slot, 0, i);
        return arr;
    }

    function dragMove(px, py) {
        if (!drag) return;
        drag.px = px;
        drag.py = py;
        const dx = px - drag.x0;
        const dy = py - drag.y0 + (y - drag.scroll0);
        drag.cell.style.translate = `${dx}px ${dy}px`;
        glow.style.translate = `${dx}px ${dy}px`;
        // the place whose middle is nearest to the middle of the lifted icon's cell
        const from = slotPos(drag.i);
        const cx = from.left + from.w / 2 + dx;
        const cy = from.top + from.h / 2 + dy;
        let best = drag.slot;
        let bestD = Infinity;
        for (let k = drag.lo; k <= drag.hi; k++) {
            const p = slotPos(k);
            const d = Math.hypot(p.left + p.w / 2 - cx, p.top + p.h / 2 - cy);
            if (d < bestD) { bestD = d; best = k; }
        }
        if (best !== drag.slot) reflow(best);
        // near the top or bottom edge the grid scrolls under the icon, faster the nearer
        const vr = view.getBoundingClientRect();
        const edge = DRAG_EDGE * unit();
        const over = py < vr.top + edge ? (py - (vr.top + edge)) / edge : (py > vr.bottom - edge ? (py - (vr.bottom - edge)) / edge : 0);
        drag.speed = Math.max(-1, Math.min(1, over)) * 0.5 * unit();
        if (drag.speed && !drag.raf) {
            drag.last = performance.now();
            const step = (now) => {
                if (!drag) return;
                drag.raf = 0;
                if (!drag.speed) return;
                // the first frame's time may be before the time the loop was asked for
                const dt = Math.max(0, Math.min(34, now - drag.last));
                drag.last = now;
                const next = Math.max(0, Math.min(maxY, y + drag.speed * dt));
                if (next !== y) { place(next); dragMove(drag.px, drag.py); }
                if (drag && drag.speed && !drag.raf) drag.raf = requestAnimationFrame(step);
            };
            drag.raf = requestAnimationFrame(step);
        }
    }

    /** The other cells make room: each slides from where it is to its new place (transforms only). */
    function reflow(slot) {
        const arr = dragOrder(drag.i, slot);
        drag.slot = slot;
        const moved = [];
        arr.forEach((k, pos) => {
            if (k === drag.i) return;
            const el = list.querySelector(`.wm-s65-cell[data-i="${k}"]`);
            if (!el) return;
            const p = slotPos(pos);
            if (Number(el.style.getPropertyValue('--c')) === p.c && Number(el.style.getPropertyValue('--r')) === p.r) return;
            moved.push([el, p, el.getBoundingClientRect()]);
        });
        for (const [el, p] of moved) {
            el.style.transition = 'none';
            el.style.translate = '0px 0px';
            el.style.setProperty('--c', String(p.c));
            el.style.setProperty('--r', String(p.r));
            el.style.setProperty('--m', String(p.m));
        }
        for (const m of moved) m.push(m[0].getBoundingClientRect());
        for (const [el, , was, now] of moved) el.style.translate = `${was.left - now.left}px ${was.top - now.top}px`;
        void list.offsetWidth;
        for (const [el] of moved) {
            el.style.transition = `translate ${REFLOW_MS}ms ease-out`;
            el.style.translate = '0px 0px';
        }
    }

    /** The drag is over: the new order is stored and listed (commit), or everything is put back. */
    function endDrag(commit) {
        if (!drag) return false;
        const d = drag;
        drag = null;
        if (d.raf) cancelAnimationFrame(d.raf);
        list.classList.remove('is-dragging');
        const keep = y;
        if (commit && d.slot !== d.i) {
            const seq = dragOrder(d.i, d.slot).map((k) => items[k]);
            const lay = layout();
            const folder = folderNow();
            if (folder) {
                lay.order[folder] = seq.map((it) => it.key);
            } else {
                // the head of the list is the moved-to-top programs: the dropped icon joins them
                // when it lands before the last of them, and leaves them when it lands after
                const it = items[d.i];
                const tops = it.top ? (d.slot < d.tops ? d.tops : d.tops - 1) : (d.slot < d.tops ? d.tops + 1 : d.tops);
                const gone = lay.top.filter((k) => !seq.some((n) => n.key === k));
                lay.top = seq.slice(0, tops).map((n) => n.key).concat(gone);
                // Start's own order keeps a place for the programs at the top (Move Down puts one
                // back where it was): the others take the remaining places in their new sequence
                const rest = seq.slice(tops).map((n) => n.key);
                const moving = new Set(rest);
                let j = 0;
                lay.order[''] = orderedItems(null, lay).map((n) => (moving.has(n.key) ? rest[j++] : n.key)).concat(rest.slice(j));
            }
            saveLayout(lay);
            selected = d.slot;
        } else {
            selected = d.i;
        }
        render();
        place(Math.max(0, Math.min(maxY, keep)));
        select(selected, false);
        sh.syncHistory();
        return true;
    }

    /** The finger: pan past the start distance, fling on release, tap, tap-and-hold, drag after a hold. */
    function bindTouch() {
        let id = null;
        let downX = 0;
        let downY = 0;
        let baseY = 0; // pointer y where the pan began
        let y0 = 0;
        let cell = -1;
        let panning = false;
        let held = false;
        let lifted = false; // this press lifted an icon
        let caught = false; // the press stopped a moving grid: not a tap
        let holdTimer = 0;
        let samples = [];
        let lastSeen = 0; // time of the tracked pointer's last event

        const end = () => {
            clearTimeout(holdTimer);
            holdTimer = 0;
            id = null;
        };
        // the press is dropped when its capture goes without a lift, when Start leaves the screen
        // and when the page is hidden: nothing may be left waiting for a finger that is gone
        const drop = () => { if (id === null) return; if (drag) endDrag(false); panning = false; held = false; end(); };
        view.addEventListener('lostpointercapture', (e) => { if (e.pointerId === id) setTimeout(() => { if (id === e.pointerId) drop(); }, 0); });
        document.addEventListener('visibilitychange', () => { if (document.hidden) drop(); });
        new MutationObserver(() => { if ((root.dataset.wmApp || '') !== 'start') drop(); }).observe(root, { attributes: true, attributeFilter: ['data-wm-app'] });

        view.addEventListener('pointerdown', (e) => {
            // a second finger puts a lifted icon back
            if (id !== null && drag && e.pointerId !== id) { endDrag(false); return; }
            // a press whose lift never arrived (Start closed or hidden under the finger, the pointer
            // capture lost: seen on the Fold, where Start then took no taps until a reload): a new
            // primary pointer, or any press half a second after the last sign of the old one, means
            // the old one is gone
            if (id !== null && (e.isPrimary || e.timeStamp - lastSeen > 500)) { if (drag) endDrag(false); end(); }
            if (id !== null || (e.pointerType === 'mouse' && e.button !== 0)) return;
            lastSeen = e.timeStamp;
            id = e.pointerId;
            // a press that stops a coasting grid, or that closes an open menu (the shell closes it on
            // the click), is not a tap on the item under it
            caught = (!!raf && Math.abs(velocity) > 0.05) || !!document.querySelector('#wmShell > .wm-popup:not([hidden]):not(.wm-popup-ghost)');
            stopMotion();
            downX = e.clientX;
            downY = e.clientY;
            panning = false;
            held = false;
            lifted = false;
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
            if (e.pointerId !== id) return;
            lastSeen = e.timeStamp;
            if (held) {
                // the hold is complete: the finger moving on lifts the icon (6.5.3's drag)
                // (once per press: an icon put back by the back key stays put until the finger lifts)
                if (drag) dragMove(e.clientX, e.clientY);
                else if (!lifted && cell >= 0 && Math.hypot(e.clientX - downX, e.clientY - downY) > DRAG_START * unit()) lifted = startDrag(cell, e);
                return;
            }
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
            if (drag) {
                // let go over the grid: the icon stays there; anywhere else (the bars): back
                const vr = view.getBoundingClientRect();
                endDrag(!cancelled && e.clientX >= vr.left && e.clientX <= vr.right && e.clientY >= vr.top && e.clientY <= vr.bottom);
                return;
            }
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
            // the glow and the wait cursor paint together, then the item opens (a slow open shows the tap was taken)
            sh.busy(() => { if (sh.current === 'start' && selected === hit) return openItem(hit); return undefined; }, { paint: true, timeout: 15000 });
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
            if (drag) return;
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
        // a program came, went or moved (wmAndroidApps.js after a hold menu command or an install)
        document.addEventListener('wmAppsChanged', () => { if (page && page.isConnected && !page.hidden && !drag) { render(); place(Math.max(0, Math.min(maxY, y))); } });
        window.addEventListener('resize', () => { if (page && page.isConnected && !page.hidden) { endDrag(false); if (columnsFor() !== cols) render(); else measure(); place(Math.max(0, Math.min(maxY, y))); } });
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
            // Start opens at its top with Today selected; back from a Settings applet it is where it
            // was left, in its folder (Yukimi, Nov 14: not all the way to the root; Nov 12 had it reset)
            show() {
                stopMotion();
                paintWallpaper();
                if (resume) {
                    resume = false;
                    render();
                    settle();
                    sh.refreshSoftKeys();
                    return;
                }
                path.length = 0;
                render();
                place(0);
                select(0, false);
            },
            hide() { endDrag(false); stopMotion(); },
            softKeys() {
                if (path.length) return { left: { label: 'Back', action: () => { if (closeFolder()) sh.syncHistory(); } }, right: null };
                return { left: { label: 'Lock', action: lock }, right: null };
            },
            titleKind: () => 'close',
            // a lifted icon is a step of its own: the back key puts it back
            historyDepth: () => path.length + (drag ? 1 : 0),
            // X closes Start, in a folder too (Yukimi, Nov 12, #777): Back is the soft key's job
            closeGoesBack: false,
            onBack: () => endDrag(false) || closeFolder()
        });
    }

    // a program asks for a folder of Start (wmPrograms.js: on 6.5 the Settings program shown with no
    // page open is the Settings folder, as on the device); Back / X there return to Start's top
    window.wmStart65 = {
        openFolder(id) {
            if (!sh || root.dataset.wmVersion !== '6.5') return false;
            sh.open('start', { fromStart: true });
            const i = items.findIndex((it) => it.folder === id);
            if (i < 0) return false;
            select(i, false);
            openFolder(items[i]);
            return true;
        },
        /**
         * The order as stored on this device ({ top, order }) and a way back to the default one.
         * The device has no command for that (each program is moved down by hand), so there is no
         * screen for it here either.
         */
        order: () => layout(),
        resetOrder() {
            saveLayout({ top: [], order: {} });
            if (page && page.isConnected && sh && sh.current === 'start') { endDrag(false); render(); place(Math.max(0, Math.min(maxY, y))); select(selected, false); }
            return true;
        }
    };

    if (window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
