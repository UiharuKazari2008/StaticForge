/**
 * Sync Center's partnerships (#976): one registry for everything this computer syncs, so Control Panel > Sync Center,
 * its tray icon and its balloons show them all. Nightshade Profile (nightshadeProfileSync.js) is one partnership; the
 * DreamOS Offline Files (CaféReady's client-side caching) is another. Contract: docs/client-api/sync-center.md.
 *
 *   window.melatonSyncCenter = {
 *     register(p)      add or replace a partnership (by p.id); returns an unregister function
 *     list()           the partnerships, in the order registered
 *     get(id)          one partnership, or null
 *     changed()        call after anything a partnership shows changed (or let p.on(fn) tell us); redraws the
 *                      tray icon, raises Sync Center's balloons and redraws an open Sync Center, once a frame at most
 *     syncAll()        p.syncNow() on every partnership that has one (Sync All)
 *     open(view)       Control Panel > Sync Center ('' | 'conflicts' | 'results')
 *   }
 *
 *   p = {
 *     id: 'offline-files',                       unique, stable ('nightshade-profile', 'offline-files', ...)
 *     partnership() -> { name, status, busy, percent, marquee, stalled?, category, last, conflicts, errors, icon,
 *                        detail? }               synchronous, from memory (never a request)
 *     conflicts()   -> [{ id, name, path, detail, localAt, serverAt }]
 *     results()     -> [{ at, kind: 'info' | 'warning' | 'error' | 'conflict', item, text }]   newest first
 *     syncNow()     -> Promise                   Sync / Sync All (optional)
 *     resolve(conflictId)                        opens the partnership's own Resolve Conflict (optional)
 *     clearResults()                             Sync results' Delete (optional)
 *     on(fn) -> off                              fn() whenever partnership() / conflicts() / results() change
 *   }
 *
 * The tray icon (#nightshadeSyncTrayIcon in app.html: Sync Center's own, SyncCenter.dll's art) shows what all
 * partnerships report together: the turning arrows while any one syncs, then conflict, error, done. It is shown once
 * any partnership has synced on this computer. Balloons (SyncCenter.dll.mui 6980-6987) come from each partnership's
 * changes after it registered: its first completed sync ("<name> is now set up to sync"; once per partnership per
 * computer), new conflicts, new errors. Desktop pages only; nothing here asks the server anything.
 */
(function (root) {
    'use strict';

    const doc = root.document;
    if (!doc) return;
    const appScopeSignal = (root.melatonSegments && typeof root.melatonSegments.callerSignal === 'function' && root.melatonSegments.callerSignal()) || undefined; // page listeners end with this file's segment (app-scope, #872/#890)

    const ART = '/static_images/vista-sync';
    const KEY = 'melatonSyncCenter';
    // SyncCenter.dll.mui 6980-6987
    const WORDS = {
        setUp: (name) => [`${name} is now set up to sync`, 'Check this icon anytime for sync status, or click to open Sync Center.'],
        conflicts: ['Sync conflicts have occurred', 'When you see this icon, click it to open Sync Center and check the conflicts.'],
        errors: ['Sync errors have occurred', 'When you see this icon, click it to open Sync Center and check the errors.']
    };
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const desktop = () => !!root.isDesktop && root.uiShell !== 'mobile';

    const parts = new Map();   // id -> { p, off, seen: { conflicts, errors, synced } }

    function readSetUp() {
        try { const v = JSON.parse(root.localStorage.getItem(KEY) || 'null'); return new Set(v && Array.isArray(v.setUp) ? v.setUp : []); } catch (_) { return new Set(); }
    }
    function writeSetUp(set) {
        try { root.localStorage.setItem(KEY, JSON.stringify({ setUp: Array.from(set) })); } catch (_) { /* private mode */ }
    }

    function snap(p) {
        try { return p.partnership() || null; } catch (_) { return null; }
    }
    const synced = (s) => !!(s && s.last && s.last.result !== 'error');

    function register(p) {
        if (!p || !p.id || typeof p.partnership !== 'function') return () => {};
        const old = parts.get(p.id);
        if (old && old.off) { try { old.off(); } catch (_) { /* gone */ } }
        const s = snap(p);
        // what it shows now is the state of things, not news: balloons only for what changes after this
        const entry = { p, off: null, seen: { conflicts: s ? s.conflicts || 0 : 0, errors: s ? s.errors || 0 : 0 } };
        if (synced(s)) { const set = readSetUp(); if (!set.has(p.id)) { set.add(p.id); writeSetUp(set); } }
        if (typeof p.on === 'function') { try { entry.off = p.on(changed); } catch (_) { entry.off = null; } }
        parts.set(p.id, entry);
        changed();
        return () => {
            if (parts.get(p.id) !== entry) return;
            if (entry.off) { try { entry.off(); } catch (_) { /* gone */ } }
            parts.delete(p.id);
            changed();
        };
    }

    const list = () => Array.from(parts.values()).map((e) => e.p);
    const get = (id) => (parts.has(id) ? parts.get(id).p : null);

    // ---- changes: the tray, the balloons, an open Sync Center ------------------------------------------------------

    let frame = 0;
    function changed() {
        if (frame) return;
        frame = root.requestAnimationFrame(() => { frame = 0; apply(); });
    }

    function apply() {
        if (!desktop()) return;
        const setUp = readSetUp();
        let setUpChanged = false;
        for (const [id, e] of parts) {
            const s = snap(e.p);
            if (!s) continue;
            const name = s.name || id;
            if (synced(s) && !setUp.has(id)) {
                setUp.add(id);
                setUpChanged = true;
                balloon('info', WORDS.setUp(name), '');
            }
            const c = s.conflicts || 0;
            const r = s.errors || 0;
            if (c > e.seen.conflicts) balloon('warning', WORDS.conflicts, 'conflicts');
            else if (r > e.seen.errors) balloon('error', WORDS.errors, 'results');
            e.seen.conflicts = c;
            e.seen.errors = r;
        }
        if (setUpChanged) writeSetUp(setUp);
        paintTray(setUp);
        // an open Sync Center draws the new state (cplPages2.js)
        const cp = root.melatonControlPanel;
        if (cp && typeof cp.currentPage === 'function' && cp.currentPage() === 'sync-center' && typeof cp.isOpen === 'function' && cp.isOpen()) {
            try { cp.navigate('sync-center', { replace: true }); } catch (_) { /* closed */ }
        }
    }

    // ---- the tray icon ----------------------------------------------------------------------------------------------

    let icon = null;
    function trayIcon() {
        if (icon && icon.isConnected) return icon;
        icon = doc.getElementById('nightshadeSyncTrayIcon');
        if (!icon) return null;
        icon.addEventListener('click', () => {
            const all = list().map(snap).filter(Boolean);
            open(all.some((s) => s.conflicts) ? 'conflicts' : all.some((s) => s.errors) ? 'results' : '');
        }, { signal: appScopeSignal });
        if (root.contextMenu && typeof root.contextMenu.attachToElement === 'function') {
            root.contextMenu.attachToElement(icon, {
                sections: [{
                    type: 'list',
                    initfn: (sec) => {
                        sec.items = [
                            { text: 'Open Sync Center', action: 'open', default: true },
                            { separator: true },
                            { text: 'Sync All', action: 'sync', disabled: !list().some((p) => typeof p.syncNow === 'function') },
                            { text: 'View sync conflicts', action: 'conflicts' },
                            { text: 'View sync results', action: 'results' }
                        ];
                    }
                }],
                onAction: (a) => {
                    if (a === 'sync') syncAll();
                    else open(a === 'open' ? '' : a);
                }
            });
        }
        return icon;
    }

    function paintTray(setUp) {
        const el = trayIcon();
        if (!el) return;
        const all = list().map((p) => snap(p)).filter(Boolean);
        const busy = all.filter((s) => s.busy);
        const running = busy.filter((s) => !s.stalled);
        const state = running.length ? 'syncing' : busy.length ? 'waiting'
            : all.some((s) => s.conflicts) ? 'conflict' : all.some((s) => s.errors) ? 'error'
                : all.some((s) => s.last) ? 'done' : 'idle';
        if (el.dataset.state !== state) el.dataset.state = state;
        // SyncCenter.dll.mui 6982 "Sync in progress: %ws"
        const tip = busy.length ? `Sync in progress: ${busy.map((s) => s.name).join(', ')}`
            : state === 'conflict' ? WORDS.conflicts[0] : state === 'error' ? WORDS.errors[0] : 'Sync Center';
        if (el.title !== tip) el.title = tip;
        // shown once a partnership exists on this computer (Vista keeps Sync Center's icon from then on)
        if ((setUp.size || busy.length || state === 'error') && el.classList.contains('hidden')) {
            // revealTrayIconElement: public/scripts/comp/trayIndicators.js
            if (typeof root.revealTrayIconElement === 'function') root.revealTrayIconElement(el); else el.classList.remove('hidden');
        }
    }

    function balloon(type, words, view) {
        const el = trayIcon();
        if (!el || !root.PopoverManager || typeof root.PopoverManager.showPopover !== 'function') return;
        root.PopoverManager.showPopover(el, type, esc(words[0]), esc(words[1]), false, 10000,
            `<img src="${ART}/sync-center-32.png" alt="" width="32" height="32">`, null,
            { popupId: 'sync-center', position: 'top', arrowPosition: 'bottom-right', onClick: () => open(view || '') });
    }

    // ---- actions -------------------------------------------------------------------------------------------------------

    function syncAll() {
        list().forEach((p) => {
            if (typeof p.syncNow !== 'function') return;
            try { void Promise.resolve(p.syncNow()).catch(() => {}); } catch (_) { /* its own error shows in its results */ }
        });
    }

    function open(view) {
        const fl = root.featureLoader;
        const ready = fl && typeof fl.loadFeature === 'function' ? fl.loadFeature('control_panel') : Promise.resolve();
        void Promise.resolve(ready).then(() => {
            const cp = root.melatonControlPanel;
            if (cp && typeof cp.doAction === 'function') cp.doAction(view ? `page:sync-center:${view}` : 'page:sync-center');
        });
    }

    root.melatonSyncCenter = { register, list, get, changed, syncAll, open };

    // another window of this desktop recorded a set-up partnership; the desktop's own start paints the icon
    root.addEventListener('storage', (ev) => { if (ev.key === KEY) changed(); }, { signal: appScopeSignal });
    let wired = false;
    const wire = () => {
        const ws = root.wsClient;
        if (wired || !ws || typeof ws.on !== 'function') return;
        wired = true;
        ws.on('connected', changed);
        changed();
    };
    if (doc.readyState === 'complete') wire(); else root.addEventListener('load', wire, { once: true, signal: appScopeSignal });
})(typeof window !== 'undefined' ? window : globalThis);
