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
 * Each program looks and is named as on the phone's Start menu (Yukimi, Nov 21): its Windows Mobile icon from the Program
 * Icons store (#773, localStorage wmAndroidIconStore, kept by Melaton Mobile in the same app; refreshed from
 * /api/wm-program-icons/manifest once the desktop is idle), else Android's own icon; the name the user gave it
 * (wmAndroidNames); programs cleared in Remove Programs > Android (wmAndroidHidden) are left out here too.
 *
 * Only in the DeX window (AndroidDisplay.isDesktop() with the desktop shell and the bridge present).
 * Exports window.melatonAndroidPrograms: items(), tree(), find(launchId), isAndroidId(id), launch(id), and
 * iconFor({ id?, package, icon? }, px) -> { src, srcset } (the taskbar and the Bell draw programs the same way).
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
                profile: a.profile === 'work' ? 'work' : ''
            }));
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
        return e && typeof e.icon === 'string' && WM_SET.test(e.icon) ? e.icon : null;
    }
    /**
     * A program's picture at px CSS pixels: the store's set (the small design up to 20 px, the -lg one above, 1x / 2x / 4x),
     * else Android's icon at the size the screen needs (the app's icon handler draws 48..1024 px).
     */
    function iconFor(a, px) {
        const set = a ? storeSet(a) : null;
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

    function descriptor(a, names) {
        const name = (names && typeof names[a.id] === 'string' && names[a.id].trim()) || a.label;
        const set = storeSet(a);
        return {
            launchId: PREFIX + a.id,
            text: name,
            fullName: name,
            // a store set is drawn by modalUtils.js renderAppIconImg at the row's size (small / -lg, with its srcset)
            imageIcon: set ? `${set}.png` : iconFor(a, 32).src,
            // the Start menu's picture over the user tile
            image: set ? `${set}-lg@4x.png` : iconFor(a, 64).src,
            icon: 'fas fa-window-maximize',
            desktopOnly: true,
            androidApp: true,
            androidProfile: a.profile || '',
            action: () => launch(a.id)
        };
    }

    function build() {
        if (items) return;
        const names = readJson(NAMES_KEY, {}) || {};
        const hidden = new Set((readJson(HIDDEN_KEY, []) || []).map(String));
        items = apps.filter((a) => !hidden.has(a.id)).map((a) => descriptor(a, names));
        byId = new Map(items.map((it) => [it.launchId, it]));
    }

    const byLabel = (a, b) => a.text.localeCompare(b.text, undefined, { sensitivity: 'base' });

    /** Every program, for Start Search, pins, Quick Launch and desktop shortcuts. */
    function allItems() {
        build();
        return items.slice();
    }

    /** All Programs > Android Programs: the programs by name, then a Work folder (a work profile's). */
    function tree() {
        build();
        const main = items.filter((it) => it.androidProfile !== 'work').sort(byLabel);
        const work = items.filter((it) => it.androidProfile === 'work').sort(byLabel);
        if (work.length) main.push({ folder: true, folderId: 'android-programs-work', text: 'Work', children: work });
        return main;
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
        if (!e || (e.key !== STORE_KEY && e.key !== NAMES_KEY && e.key !== HIDDEN_KEY)) return;
        if (e.key === STORE_KEY) store = null;
        changed();
    }, { signal: appScopeSignal });

    root.melatonAndroidPrograms = { items: allItems, tree, find, isAndroidId, launch, iconFor };
})();
