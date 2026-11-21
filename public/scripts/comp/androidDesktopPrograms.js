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
 * Only in the DeX window (AndroidDisplay.isDesktop() with the desktop shell and the bridge present).
 * Exports window.melatonAndroidPrograms: items(), tree(), find(launchId), isAndroidId(id), launch(id).
 */
(function () {
    'use strict';

    const root = typeof window !== 'undefined' ? window : null;
    const doc = typeof document !== 'undefined' ? document : null;
    if (!root || !doc) return;
    const bridge = root.AndroidApps;
    const isDesktop = (() => {
        try { return !!(root.AndroidDisplay && typeof root.AndroidDisplay.isDesktop === 'function' && root.AndroidDisplay.isDesktop()); } catch (_) { return false; }
    })();
    if (!isDesktop || root.uiShell === 'mobile' || !bridge || typeof bridge.list !== 'function' || typeof bridge.launch !== 'function') return;

    const appScopeSignal = (root.melatonSegments && typeof root.melatonSegments.callerSignal === 'function' && root.melatonSegments.callerSignal()) || undefined;

    const PREFIX = 'android:';
    const LIST_KEY = 'melatonDexAndroidPrograms';
    // the app's icon handler draws 48..1024 px: 64 covers the 32 px pinned / most-used rows at 2x
    const ICON_PX = 64;

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

    function iconUrl(icon) {
        if (!icon) return '';
        return `${icon}${icon.includes('?') ? '&' : '?'}s=${ICON_PX}`;
    }

    function launch(id) {
        let ok = false;
        try { ok = !!bridge.launch(id); } catch (_) { ok = false; }
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

    function descriptor(a) {
        return {
            launchId: PREFIX + a.id,
            text: a.label,
            fullName: a.label,
            imageIcon: iconUrl(a.icon),
            icon: 'fas fa-window-maximize',
            desktopOnly: true,
            androidApp: true,
            androidProfile: a.profile || '',
            action: () => launch(a.id)
        };
    }

    function build() {
        if (items) return;
        items = apps.map(descriptor);
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
        try { list = clean(JSON.parse(bridge.list())); } catch (_) { return; }
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

    if (desktopUp()) queueRead();
    else doc.addEventListener('desktopBootDone', queueRead, { once: true, signal: appScopeSignal });
    root.addEventListener('androidapps', queueRead, { signal: appScopeSignal });

    root.melatonAndroidPrograms = { items: allItems, tree, find, isAndroidId, launch };
})();
