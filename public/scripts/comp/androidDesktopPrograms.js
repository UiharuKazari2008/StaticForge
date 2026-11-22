/**
 * Android Programs on the DeX desktop (StaticForge #1005).
 *
 * The phone's installed programs as Start menu entries in the DeX window: All Programs > Android Programs
 * (a Work folder inside it for a work profile's programs), Start Search, pin to Start, Quick Launch and
 * Add to Desktop. A program starts on the DeX display (DSApp AndroidApps.launch from this window).
 *
 * AndroidApps.list() is a synchronous bridge call (~750 ms on the Fold7 when its cache is cold), so it is
 * never made on the start path (installed-boot-zero-wait): the desktop boots with the list kept from the
 * last session, and the phone's own list is read once the desktop is up and idle, and again when the app
 * says programs changed ('androidapps'). Entries carry the launch id `android:<package>/<activity>`.
 *
 * Each program is named as on the phone's Start menu (Yukimi, Nov 21) and drawn with its Windows Vista icon from the
 * Program Icons store (Nov 22: every program has a Vista version for the desktop; a set made before that has only its
 * Windows Mobile icon, which is drawn until its Vista one is made): its icon from the Program
 * Icons store (#773, localStorage wmAndroidIconStore, kept by Melaton Mobile in the same app; refreshed from
 * /api/wm-program-icons/manifest once the desktop is idle), else Android's own icon; the name the user gave it
 * (wmAndroidNames); programs cleared in Remove Programs > Android (wmAndroidHidden) are left out here too.
 *
 * The same programs in the same places as the phone's Programs (Yukimi, Nov 22 2026, #1031; wmAndroidApps.js sync is the
 * source): Android Settings stays out (the phone shows it only as a Settings link); Phone, Camera and Marketplace (the
 * dialer, the camera and the Play Store) carry those names and sit in All Programs itself, as they sit in Programs; a
 * game (Android's game category, or the user's Move to Games: wmAndroidGames) goes to the Start menu's Games folder; a
 * folder the user made in Android or Work (wmAndroidFolders) is a Start menu folder of its own there. Every choice comes
 * from the phone's keys in this app's shared storage: no server, and a change on the phone redraws the menu ('storage').
 *
 * Only in the DeX window (AndroidDisplay.isDesktop() with the desktop shell and the bridge present).
 * Exports window.melatonAndroidPrograms: items(), tree(), rootItems(), gameItems(), find(launchId), isAndroidId(id), launch(id), and
 * iconFor({ id?, package, icon? }, px) -> { src, srcset } (the taskbar and the Bell draw programs the same way), iconOfId(launchId, px).
 */
(function () {
    'use strict';

    const root = typeof window !== 'undefined' ? window : null;
    const doc = typeof document !== 'undefined' ? document : null;
    if (!root || !doc) return;
    const bridge0 = root.AndroidApps;
    // read at each call: a desktop paused with its display unplugged gets the new window's bridge when it resumes (#1015)
    const live = () => root.AndroidApps || bridge0;
    const isDesktop = (() => {
        try { return !!(root.AndroidDisplay && typeof root.AndroidDisplay.isDesktop === 'function' && root.AndroidDisplay.isDesktop()); } catch (_) { return false; }
    })();
    if (!isDesktop || root.uiShell === 'mobile' || !bridge0 || typeof bridge0.list !== 'function' || typeof bridge0.launch !== 'function') return;

    const appScopeSignal = (root.melatonSegments && typeof root.melatonSegments.callerSignal === 'function' && root.melatonSegments.callerSignal()) || undefined;

    const PREFIX = 'android:';
    const LIST_KEY = 'melatonDexAndroidPrograms';
    // Melaton Mobile's keys (wmAndroidApps.js): the Program Icons store, the user's names, Remove Programs' unchecked
    const STORE_KEY = 'wmAndroidIconStore';
    const NAMES_KEY = 'wmAndroidNames';
    const HIDDEN_KEY = 'wmAndroidHidden';
    const GAMES_KEY = 'wmAndroidGames';     // { program id: true | false } the user's Move to / Remove from Games
    const FOLDERS_KEY = 'wmAndroidFolders'; // { v, folders: [{ id, parent: 'android' | 'work', name }], of: { id: folder } }
    // the phone's role programs (wmAndroidApps.js ROLES): the device's names, in Programs itself
    const ROLE_NAMES = { phone: 'Phone', camera: 'Camera', store: 'Marketplace' };
    const CAMERA_PACKAGES = ['com.sec.android.app.camera', 'com.google.android.GoogleCamera', 'com.android.camera2', 'com.android.camera'];
    const WM_SET = /^\/static_images\/wm-android\/[a-z0-9_-]+$/;

    let apps = keptList();
    let items = null;
    let byId = null;
    let readQueued = false;

    function keptList() {
        try {
            const v = JSON.parse(localStorage.getItem(LIST_KEY) || 'null');
            return Array.isArray(v) ? v : [];
        } catch (_) { return []; }
    }

    function clean(list) {
        return (Array.isArray(list) ? list : [])
            .filter((a) => a && typeof a.id === 'string' && a.id && typeof a.label === 'string' && a.label.trim())
            .map((a) => ({
                id: a.id,
                label: a.label.trim(),
                package: typeof a.package === 'string' ? a.package : '',
                icon: typeof a.icon === 'string' ? a.icon : '',
                profile: a.profile === 'work' ? 'work' : '',
                role: typeof a.role === 'string' ? a.role : '',
                game: a.game === true
            }));
    }

    /** The phone's camera program when Android names none (wmAndroidApps.js withCameraRole): Samsung's or Google's, else one called Camera. */
    function cameraId(list) {
        if (list.some((a) => a.role === 'camera')) return null;
        const pick = list.find((a) => CAMERA_PACKAGES.includes(a.package) && a.profile !== 'work')
            || list.find((a) => /^camera$/i.test(a.label) && a.profile !== 'work');
        return pick && !pick.role ? pick.id : null;
    }

    const readJson = (key, fallback) => {
        try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v == null ? fallback : v; } catch (_) { return fallback; }
    };
    let store = null;
    function storeIcons() {
        if (!store) { const v = readJson(STORE_KEY, null); store = v && v.icons && typeof v.icons === 'object' ? v.icons : {}; }
        return store;
    }
    /** The program's Windows Mobile icon set (/static_images/wm-android/<name>, no extension), as the phone picks it. */
    function storeSet(a) {
        const icons = storeIcons();
        let e = (a.id && icons[a.id]) || (a.package && icons[a.package]) || null;
        if (!e && a.package) { const k = Object.keys(icons).find((x) => icons[x] && icons[x].package === a.package); e = k ? icons[k] : null; }
        if (!e || typeof e.icon !== 'string' || !WM_SET.test(e.icon)) return null;
        // the desktop draws the set's Windows Vista icon (<set>-vista-<px>.png); a set from before Nov 22 2026 has none
        storeSet.vista = e.vista === true;
        return e.icon;
    }
    // Vista sizes of a store set (modules/wmProgramIcons.js VISTA_SIZES): the smallest that covers px
    const VISTA_PX = [16, 24, 32, 48, 64, 96, 128, 256];
    const vistaPx = (px) => VISTA_PX.find((s) => s >= px) || 256;
    /**
     * A program's picture at px CSS pixels: the store's set (the small design up to 20 px, the -lg one above, 1x / 2x / 4x),
     * else Android's icon at the size the screen needs (the app's icon handler draws 48..1024 px).
     */
    function iconFor(a, px) {
        const set = a ? storeSet(a) : null;
        if (set && storeSet.vista) {
            const one = vistaPx(px);
            const two = vistaPx(px * 2);
            return { src: `${set}-vista-${one}.png`, srcset: `${set}-vista-${one}.png 1x, ${set}-vista-${two}.png 2x` };
        }
        if (set) {
            const base = `${set}${px > 20 ? '-lg' : ''}`;
            return { src: `${base}.png`, srcset: `${base}.png 1x, ${base}@2x.png 2x, ${base}@4x.png 4x` };
        }
        const icon = a && a.icon ? String(a.icon) : '';
        if (!icon) return { src: '', srcset: '' };
        const dpr = root.devicePixelRatio || 1;
        const s = Math.max(48, Math.min(1024, Math.ceil(px * Math.max(2, dpr))));
        return { src: `${icon}${icon.includes('?') ? '&' : '?'}s=${s}`, srcset: '' };
    }

    function launch(id) {
        let ok = false;
        try { ok = !!live().launch(id); } catch (_) { ok = false; }
        if (!ok) {
            const a = apps.find((x) => x.id === id);
            const name = a ? a.label : id;
            // Vista's message when a shortcut's program is gone
            if (typeof root.showConfirmationDialog === 'function') {
                root.showConfirmationDialog(`Windows cannot find '${name}'. Make sure you typed the name correctly, and then try again.`,
                    [{ text: 'OK', value: true }], null, { title: name, icon: 'error' }).catch(() => {});
            }
        }
        return ok;
    }

    function descriptor(a, names, role) {
        const name = ROLE_NAMES[role] || (names && typeof names[a.id] === 'string' && names[a.id].trim()) || a.label;
        const set = storeSet(a);
        const vista = !!set && storeSet.vista;
        return {
            launchId: PREFIX + a.id,
            text: name,
            fullName: name,
            // a store set is drawn by modalUtils.js renderAppIconImg at the row's size (small / -lg, with its srcset)
            // (its Vista icon when the set has one: <set>-vista-32.png names the set, renderAppIconImg picks the size)
            imageIcon: vista ? `${set}-vista-32.png` : set ? `${set}.png` : iconFor(a, 32).src,
            // the Start menu's picture over the user tile
            image: vista ? `${set}-vista-256.png` : set ? `${set}-lg@4x.png` : iconFor(a, 64).src,
            icon: 'fas fa-window-maximize',
            desktopOnly: true,
            androidApp: true,
            androidProfile: a.profile || '',
            androidRole: role || '',
            action: () => launch(a.id)
        };
    }

    // where each shown program sits, as the phone's Programs files it: 'root' (a role program), 'games', or its folder
    // ('android' / 'work' or a folder of the user's in them)
    let places = null;
    let userFolders = [];

    function build() {
        if (items) return;
        const names = readJson(NAMES_KEY, {}) || {};
        const hidden = new Set((readJson(HIDDEN_KEY, []) || []).map(String));
        const games = readJson(GAMES_KEY, {}) || {};
        const sub = readJson(FOLDERS_KEY, null);
        userFolders = sub && Array.isArray(sub.folders) ? sub.folders.filter((f) => f && f.id && (f.parent === 'android' || f.parent === 'work') && typeof f.name === 'string') : [];
        const filedIn = sub && sub.of && typeof sub.of === 'object' ? sub.of : {};
        const cam = cameraId(apps);
        items = [];
        places = new Map();
        for (const a of apps) {
            // Android Settings is a Settings link on the phone, never one of its programs
            if (hidden.has(a.id) || a.role === 'settings') continue;
            const role = a.id === cam ? 'camera' : (ROLE_NAMES[a.role] ? a.role : '');
            const it = descriptor(a, names, role);
            const parent = a.profile === 'work' ? 'work' : 'android';
            const folder = userFolders.find((f) => f.id === filedIn[a.id] && f.parent === parent);
            const game = Object.prototype.hasOwnProperty.call(games, a.id) ? games[a.id] === true : a.game;
            places.set(it.launchId, role ? 'root' : folder ? folder.id : (parent === 'work' ? 'work' : (game ? 'games' : 'android')));
            items.push(it);
        }
        byId = new Map(items.map((it) => [it.launchId, it]));
    }

    const byLabel = (a, b) => a.text.localeCompare(b.text, undefined, { sensitivity: 'base' });

    /** Every program, for Start Search, pins, Quick Launch and desktop shortcuts. */
    function allItems() {
        build();
        return items.slice();
    }

    const placed = (where) => items.filter((it) => places.get(it.launchId) === where).sort(byLabel);

    /** A folder's programs by name, then the user's folders in it (by name, empty ones left out), as the phone lists them. */
    function folderList(parent) {
        const list = placed(parent);
        userFolders.filter((f) => f.parent === parent).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })).forEach((f) => {
            const children = placed(f.id);
            if (children.length) list.push({ folder: true, folderId: `android-folder-${f.id}`, text: f.name, children });
        });
        return list;
    }

    /** All Programs > Android Programs: the phone's Android folder (its programs, its folders), then a Work folder. */
    function tree() {
        build();
        const main = folderList('android');
        const work = folderList('work');
        if (work.length) main.push({ folder: true, folderId: 'android-programs-work', text: 'Work', children: work });
        return main;
    }

    /** Phone, Camera, Marketplace: in All Programs itself, as in the phone's Programs. */
    function rootItems() {
        build();
        return placed('root');
    }

    /** The phone's Android games, for the Start menu's Games folder and Games Explorer (#1044). */
    function gameItems() {
        build();
        return placed('games');
    }

    function find(launchId) {
        if (!isAndroidId(launchId)) return null;
        build();
        return byId.get(launchId) || null;
    }

    function isAndroidId(id) {
        return typeof id === 'string' && id.startsWith(PREFIX);
    }

    /** The Start menu, Start Search and Quick Launch see the new list. */
    function changed() {
        items = null;
        byId = null;
        // invalidateRunStaticCache: public/scripts/comp/runCommandIndex.js (Start Search's program index)
        if (typeof root.invalidateRunStaticCache === 'function') { try { root.invalidateRunStaticCache(); } catch (_) { /* index rebuilt on next search */ } }
        // renderStartMenuList: public/scripts/comp/modalUtils.js (only while the menu shows; it is drawn on open)
        const menu = doc.getElementById('startMenu');
        if (menu && !menu.classList.contains('hidden') && typeof root.renderStartMenuList === 'function') {
            try { root.renderStartMenuList(); } catch (_) { /* drawn on next open */ }
        }
        try { doc.dispatchEvent(new CustomEvent('melaton:android-programs')); } catch (_) { /* no listeners */ }
    }

    function read() {
        readQueued = false;
        let list;
        try { list = clean(JSON.parse(live().list())); } catch (_) { return; }
        const before = JSON.stringify(apps);
        const after = JSON.stringify(list);
        if (before === after) return;
        apps = list;
        try { localStorage.setItem(LIST_KEY, after); } catch (_) { /* no room: the next boot reads the bridge */ }
        changed();
    }

    /** One read of the phone's list when the page is idle (never twice in a row, never on the start path). */
    function queueRead() {
        if (readQueued) return;
        readQueued = true;
        if (typeof root.requestIdleCallback === 'function') root.requestIdleCallback(read, { timeout: 4000 });
        else setTimeout(read, 500);
    }

    function desktopUp() {
        try { return typeof root.getClientDesktopState === 'function' && root.getClientDesktopState() === 'desktop'; } catch (_) { return false; }
    }

    /** The store's manifest once per visit, when the desktop is idle (Melaton Mobile keeps the same copy). */
    function loadStore() {
        if (typeof root.fetch !== 'function') return;
        root.fetch('/api/wm-program-icons/manifest', { credentials: 'same-origin', cache: 'no-store' })
            .then((r) => (r.ok ? r.json() : null))
            .then((m) => {
                if (!m || !m.icons || typeof m.icons !== 'object') return;
                const next = JSON.stringify(m.icons);
                if (next === JSON.stringify(storeIcons())) return;
                store = m.icons;
                try { localStorage.setItem(STORE_KEY, JSON.stringify({ version: m.version || 0, icons: m.icons })); } catch (_) { /* the phone page keeps its own */ }
                changed();
            })
            .catch(() => { /* the kept copy stays */ });
    }

    function onDesktop() {
        queueRead();
        const idle = root.requestIdleCallback || ((fn) => setTimeout(fn, 1500));
        idle(loadStore);
    }
    if (desktopUp()) onDesktop();
    else doc.addEventListener('desktopBootDone', onDesktop, { once: true, signal: appScopeSignal });
    root.addEventListener('androidapps', queueRead, { signal: appScopeSignal });
    // Melaton Mobile (the phone's window, same storage) changed an icon, a name or the programs shown
    root.addEventListener('storage', (e) => {
        if (!e || (e.key !== STORE_KEY && e.key !== NAMES_KEY && e.key !== HIDDEN_KEY && e.key !== GAMES_KEY && e.key !== FOLDERS_KEY)) return;
        if (e.key === STORE_KEY) store = null;
        changed();
    }, { signal: appScopeSignal });

    /** A listed program's picture by its launch id (Games Explorer draws the Android games, #1044). */
    function iconOfId(launchId, px) {
        const a = isAndroidId(launchId) ? apps.find((x) => PREFIX + x.id === launchId) : null;
        return a ? iconFor(a, px) : { src: '', srcset: '' };
    }

    root.melatonAndroidPrograms = { items: allItems, tree, rootItems, gameItems, find, isAndroidId, launch, iconFor, iconOfId };
})();
