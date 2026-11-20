/**
 * Nightshade Profile in Sync Center (#976, Yukimi Nov 20 2026: "on the desktop show a synchronizing window for
 * Nightshade indicating it's updating the user profile from the domain controller").
 *
 * The desktop's roaming profile (#910: cachedLogon.js cachedProfile, modules/profileRevision.js) is a Sync Center
 * partnership, "Nightshade Profile", between this computer and the domain controller (DREAMSCAPE) over the Nightshade
 * Network. websocket.js reports every profile sync as the window event 'melaton:profilesync' (detail { phase, at,
 * source?, ... }: checking / reading { type, index, total } / applying { pieces } / applied { type } / done { applied } /
 * outofsync { cached, server, held, reason, pieces } / unknown; source: none (the check at the reconnect after a logon
 * from the cached profile), 'manual' (Sync now), 'resolve', 'push' (another computer changed the profile)). This file
 * only listens; it never holds the start up (installed-boot-zero-wait): the desktop is already up on the cached
 * profile when any of this happens.
 *
 *   The progress window   Vista's Offline Files sync dialog as captured on the VM (cscui.dll, "Always Available
 *                         Offline": a 500 x 222 task dialog, the blue sync arrows (cscui icon 8), the main instruction,
 *                         "If you click Close, this operation will continue. ... monitor progress in Sync Center.",
 *                         the item being synced, the progress bar, Cancel (off: a profile sync cannot be stopped
 *                         half way) and Close, and the footer that names errors / conflicts with a link to Sync
 *                         Center). It opens when the profile is really being updated from the domain controller
 *                         (the first piece read after a logon from the cached profile, or a check that takes over a
 *                         second; Sync now at once), shows the real steps and closes itself when the sync completes
 *                         as cscui's does. Close only closes the window; the sync goes on. A change pushed by
 *                         another computer (source 'push') animates the tray icon only, as Vista's background syncs.
 *   The tray icon         Sync Center's (SyncCenter.dll: the green arrows turning (icons 23-30) while it syncs, the
 *                         completed (31), error (32) and conflict (41) states); shown once the partnership exists on
 *                         this computer; click: Sync Center; right-click: Open Sync Center, Sync All, View sync
 *                         conflicts, View sync results.
 *   Balloons              SyncCenter.dll.mui 6980-6987: "Nightshade Profile is now set up to sync" (the first sync on
 *                         this computer), "Sync conflicts have occurred", "Sync errors have occurred".
 *   Conflicts             the profile out of sync (websocket.js outofsync: the session's own changes, too many
 *                         changes to apply live, or a piece that cannot be applied live) replaces the old User Profile
 *                         Service box (ownsConflict). Sync Center lists the conflict; Resolve opens Vista's Resolve
 *                         Conflict (shell32's conflict dialog: "Both versions have been updated since the last sync.",
 *                         "Click the version you want to keep"): keep DREAMSCAPE's version (wsClient.
 *                         resolveProfileConflict('server')), or log off (a session from the cached profile never sends
 *                         its own version to the domain controller: Yukimi's rule).
 *   Sync results          the last 25 syncs' results, errors and conflicts, kept on this computer (localStorage
 *                         melatonProfileSync), with the last sync time Sync Center shows.
 *
 *   window.nightshadeProfileSync = { ownsConflict, partnership(), conflict(), results(), syncNow(), resolve(),
 *                                    show(), openSyncCenter(view), on(fn) }
 * Desktop pages only (Melaton Mobile has no desktop profile).
 */
(function (root) {
    'use strict';

    const doc = root.document;
    if (!doc) return;
    const appScopeSignal = (root.melatonSegments && typeof root.melatonSegments.callerSignal === 'function' && root.melatonSegments.callerSignal()) || undefined; // page listeners end with this file's segment (app-scope, #872/#890)

    const ART = '/static_images/vista-sync';
    const KEY = 'melatonProfileSync';
    const NAME = 'Nightshade Profile';
    const RESULTS_MAX = 25;
    const SHOW_AFTER_MS = 1000;   // a check that takes longer than this shows the window
    const MIN_SHOWN_MS = 1500;    // a window that opened stays at least this long before it closes itself
    const STALL_MS = 60000;       // no step for this long: the animations stop (the sync goes on when the network does)
    // the pieces of the profile (cachedLogon.js cachedProfile TYPES), as Sync Center names the items it syncs
    const PIECES = {
        get_user_global_settings: 'Personal settings',
        desktop_get_settings: 'Desktop settings',
        workspace_list: 'Workspaces',
        start_menu_get_layout: 'Start menu',
        desktop_get_shortcuts: 'Desktop icons',
        sidebar_get: 'Sidebar'
    };
    // SyncCenter.dll.mui / cscui.dll.mui / shell32.dll.mui (Windows -> Melaton, Offline Files -> Nightshade Profile)
    const S = {
        close: 'If you click Close, this operation will continue.  You can continue working while this completes, and monitor progress in ',
        failed: 'Unable to sync at this time.  Please try again.',
        setUp: [`${NAME} is now set up to sync`, 'Check this icon anytime for sync status, or click to open Sync Center.'],
        conflicts: ['Sync conflicts have occurred', 'When you see this icon, click it to open Sync Center and check the conflicts.'],
        errors: ['Sync errors have occurred', 'When you see this icon, click it to open Sync Center and check the errors.']
    };

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const dc = () => String((typeof root.melatonDomainName === 'function' && root.melatonDomainName()) || 'DREAMSCAPE').toUpperCase();
    const net = () => (typeof root.melatonConnectionName === 'function' && root.melatonConnectionName()) || 'Nightshade Network';
    const desktop = () => !!root.isDesktop && root.uiShell !== 'mobile';
    const pieceName = (t) => PIECES[t] || String(t || '');
    const names = (list) => (list || []).map(pieceName).filter((v, i, a) => v && a.indexOf(v) === i);
    /** "<ms>-<seq>" (modules/profileRevision.js): when the domain controller's profile last changed. */
    const revisionTime = (r) => { const n = Number(String(r || '').split('-')[0]); return Number.isFinite(n) && n > 1e12 ? n : 0; };
    const when = (ms) => {
        const d = new Date(ms);
        return `${d.toLocaleDateString('en-US')} ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
    };

    // ---- this computer's record (Sync Center: the partnership's last sync and the sync results) ---------------

    let store = null;
    function load() {
        if (store) return store;
        try { store = JSON.parse(root.localStorage.getItem(KEY) || 'null'); } catch (_) { store = null; }
        if (!store || typeof store !== 'object') store = {};
        if (!Array.isArray(store.results)) store.results = [];
        return store;
    }
    function save() {
        try { root.localStorage.setItem(KEY, JSON.stringify(load())); } catch (_) { /* private mode */ }
    }
    function addResult(kind, item, text) {
        const s = load();
        s.results.unshift({ at: Date.now(), kind, item, text });
        if (s.results.length > RESULTS_MAX) s.results.length = RESULTS_MAX;
        save();
    }

    const listeners = new Set();
    function changed() {
        listeners.forEach((fn) => { try { fn(); } catch (_) { /* a page gone */ } });
        // an open Sync Center page draws the new state (cplPages2.js)
        const cp = root.melatonControlPanel;
        if (cp && typeof cp.currentPage === 'function' && cp.currentPage() === 'sync-center' && typeof cp.isOpen === 'function' && cp.isOpen()) {
            try { cp.navigate('sync-center', { replace: true }); } catch (_) { /* closed */ }
        }
    }

    // ---- the run in progress ----------------------------------------------------------------------------------

    let run = null;        // { source, at, phase, line, total, read, pieces, applied, steps, done }
    let conflict = null;   // the session's out-of-sync state (in memory: the next logon takes the server's profile)
    let showTimer = 0;
    let stallTimer = 0;

    function begin(source) {
        if (run && run.source === source && run.phase !== 'done') return run;
        run = { source, at: Date.now(), phase: 'checking', line: '', total: 0, read: 0, pieces: [], applied: 0, marquee: true };
        return run;
    }

    function percent(r) {
        const steps = (r.total || 0) + (r.pieces ? r.pieces.length : 0);
        if (!steps) return 0;
        return Math.max(2, Math.min(100, Math.round(((r.read || 0) + (r.applied || 0)) / steps * 100)));
    }

    function onSync(ev) {
        const d = (ev && ev.detail) || {};
        if (!desktop() || !d.phase) return;
        const source = d.source || 'logon';
        switch (d.phase) {
        case 'checking': {
            const r = begin(source);
            r.phase = 'checking';
            r.marquee = true;
            r.line = `Connecting to ${dc()} over the ${net()}...`;
            if (source === 'manual' || source === 'resolve') showSoon(0);
            else if (source === 'logon') showSoon(SHOW_AFTER_MS);
            break;
        }
        case 'reading': {
            const r = begin(source);
            r.phase = 'reading';
            r.marquee = false;
            r.total = Number(d.total) || r.total || 1;
            r.read = Number(d.index) || 0;
            r.line = pieceName(d.type);
            // the profile is being updated from the domain controller: the window shows it
            if (source !== 'push') showSoon(0);
            break;
        }
        case 'applying': {
            const r = begin(source);
            r.phase = 'applying';
            r.marquee = false;
            r.read = r.total;
            r.pieces = Array.isArray(d.pieces) ? d.pieces.slice() : [];
            r.line = names(r.pieces).join(', ');
            if (source !== 'push') showSoon(0);
            break;
        }
        case 'applied': {
            const r = begin(source);
            r.applied = (r.applied || 0) + 1;
            r.line = pieceName(d.type);
            break;
        }
        case 'done': finish('ok', d, source); break;
        case 'outofsync': finish('conflict', d, source); break;
        case 'unknown': finish('error', d, source); break;
        default: return;
        }
        // a sync that stops reporting (its request waits for a reconnect) stops the turning arrows and the marquee
        // after STALL_MS: one timeout per step, no polling (phone-power-client)
        clearTimeout(stallTimer);
        stallTimer = run && run.phase !== 'done' ? setTimeout(() => { if (run && run.phase !== 'done') { run.stalled = true; paintTray(); paintWindow(); } }, STALL_MS) : 0;
        if (run) run.stalled = false;
        paintTray();
        paintWindow();
        // an open Sync Center draws the step (one redraw a frame at most)
        if (!redraw) redraw = root.requestAnimationFrame(() => { redraw = 0; changed(); });
    }
    let redraw = 0;

    function finish(result, d, source) {
        const r = begin(source);
        r.phase = 'done';
        r.result = result;
        r.marquee = false;
        clearTimeout(showTimer);
        showTimer = 0;
        const s = load();
        const firstSync = !s.setUp && result !== 'error';
        if (result !== 'error') s.setUp = true;
        s.last = { at: Date.now(), result, source };
        const applied = names(d.applied);
        if (result === 'ok') {
            r.read = r.total;
            r.applied = (r.pieces || []).length;
            conflict = null;
            s.conflicts = 0;
            addResult('info', NAME, applied.length ? `Updated from ${dc()}: ${applied.join(', ')}.` : `Your profile on this computer is up to date with ${dc()}.`);
        } else if (result === 'conflict') {
            conflict = {
                at: Date.now(), server: d.server || null, cached: d.cached || null, reason: d.reason || null,
                pieces: Array.isArray(d.pieces) ? d.pieces.slice() : [], held: Number(d.held) || 0
            };
            s.conflicts = 1;
            addResult('conflict', NAME, conflictText(conflict));
        } else {
            addResult(source === 'push' ? 'warning' : 'error', NAME, `${S.failed} ${dc()} did not answer over the ${net()}; your profile syncs again when it reconnects.`);
        }
        save();
        // Vista's tray balloons (SyncCenter.dll.mui 6980-6987); a push's failed cache refresh says nothing
        if (firstSync && result === 'ok') balloon('info', S.setUp, null);
        else if (result === 'conflict') balloon('warning', S.conflicts, 'conflicts');
        else if (result === 'error' && source !== 'push') balloon('error', S.errors, 'results');
        changed();
        // cscui's dialog closes by itself when its operation completes without errors
        if (result === 'ok' && win) closeLater();
    }

    function conflictText(c) {
        const why = c.reason === 'held'
            ? 'This session was started from the profile cached on this computer and changed it'
            : c.reason === 'toomany'
                ? 'Too many settings changed to update this session'
                : 'Part of your profile cannot be updated while you are logged on';
        const what = names(c.pieces);
        return `${why}. ${what.length ? `Changed on ${dc()}: ${what.join(', ')}. ` : ''}Changes you make in this session will not be saved.`;
    }

    // ---- the progress window (cscui's sync progress task dialog) ---------------------------------------------

    let win = null;        // the kit's ctx
    let shownAt = 0;
    let closedByUser = null; // the run the person closed the window for
    let closeTimer = 0;

    function showSoon(ms) {
        if (win || closedByUser === run) return;
        if (!ms) { clearTimeout(showTimer); showTimer = 0; void open(); return; }
        if (showTimer) return;
        showTimer = setTimeout(() => { showTimer = 0; if (run && run.phase !== 'done') void open(); }, ms);
    }

    function closeLater() {
        clearTimeout(closeTimer);
        closeTimer = setTimeout(() => { closeTimer = 0; if (run && run.phase === 'done' && run.result === 'ok') closeWindow(); }, Math.max(0, shownAt + MIN_SHOWN_MS - Date.now()));
    }

    function closeWindow() {
        clearTimeout(closeTimer);
        closeTimer = 0;
        const c = win;
        win = null;
        if (c) { try { c.close(); } catch (_) { /* gone */ } }
    }

    function kit() {
        const fl = root.featureLoader;
        const ready = fl && typeof fl.loadFeature === 'function' ? fl.loadFeature('vista_dialog_templates') : Promise.resolve();
        return Promise.resolve(ready).catch(() => null).then(() => root.vistaDialogTemplate || null);
    }

    let opening = false;
    async function open(force) {
        if (win || opening || !desktop()) return;
        if (!run && !force) return;
        opening = true;
        let V = null;
        try { V = await kit(); } finally { opening = false; }
        if (!V || typeof V.openDialog !== 'function' || win) return;
        // the window in use keeps the keyboard (the sync goes on behind the person's work)
        const had = doc.activeElement && doc.activeElement !== doc.body ? doc.activeElement : null;
        win = V.openDialog({
            id: 'nightshadeProfileSyncDialog',
            tpl: { t: NAME, w: 286, h: 118, f: ['Segoe UI', 9], s: 0x80C800C8, c: [] },
            icon: `${ART}/sync-progress-16.png`,
            captionIcon: true,
            modeless: true,
            init: (c) => {
                const wrap = doc.createElement('div');
                wrap.className = 'nps';
                wrap.innerHTML = `
                    <div class="nps-main">
                        <span class="nps-icon" aria-hidden="true"></span>
                        <div class="nps-body">
                            <div class="nps-instruction"></div>
                            <div class="nps-text"></div>
                            <div class="nps-line"></div>
                            <div class="nps-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100"><div></div></div>
                        </div>
                    </div>
                    <div class="nps-buttons">
                        <button type="button" class="tbp-ctl tbp-button" data-nps="cancel" disabled>Cancel</button>
                        <button type="button" class="tbp-ctl tbp-button" data-nps="close" data-dialog-primary="1">Close</button>
                    </div>
                    <div class="nps-footer"></div>`;
                c.content.appendChild(wrap);
                wrap.addEventListener('click', (ev) => {
                    const link = ev.target.closest('[data-nps-link]');
                    if (link) { ev.preventDefault(); openSyncCenter(link.dataset.npsLink || ''); return; }
                    const b = ev.target.closest('[data-nps]');
                    if (b && !b.disabled && b.dataset.nps === 'close') { closedByUser = run; closeWindow(); }
                });
                c.modal.addEventListener('keydown', (ev) => {
                    if (ev.key === 'Escape' || (ev.key === 'Enter' && !(ev.target.closest && ev.target.closest('button')))) {
                        ev.preventDefault();
                        closedByUser = run;
                        closeWindow();
                    }
                });
            },
            // the caption's close box
            cancel: () => { closedByUser = run; win = null; clearTimeout(closeTimer); }
        });
        if (!win || !win.modal) { win = null; return; }
        shownAt = Date.now();
        paintWindow();
        root.requestAnimationFrame(() => {
            if (had && had.isConnected && typeof had.focus === 'function') { try { had.focus({ preventScroll: true }); } catch (_) { /* gone */ } }
        });
        if (run && run.phase === 'done' && run.result === 'ok') closeLater();
    }

    function paintWindow() {
        if (!win || !win.modal || !win.modal.isConnected) { win = null; return; }
        const m = win.modal;
        const r = run || { phase: 'done', result: 'ok', line: '' };
        const done = r.phase === 'done';
        const set = (sel, html) => { const el = m.querySelector(sel); if (el && el.innerHTML !== html) el.innerHTML = html; };
        // cscui.dll.mui 4451 / 4458 ("Preparing files so they are always available offline..." / "Completed ...")
        set('.nps-instruction', esc(done ? `Completed syncing your profile with ${dc()}.` : `Syncing your profile with ${dc()} over the ${net()}...`));
        const link = '<button type="button" class="nps-link" data-nps-link="">Sync Center.</button>';
        let line = r.line || '';
        if (done) {
            line = r.result === 'conflict' ? 'One or more conflicts occurred.  See below for details.'
                : r.result === 'error' ? 'One or more errors occurred.  See below for details.'
                    : 'Your profile is up to date.';
        }
        // Vista's two spaces after a full stop (a second, unbreakable one: HTML folds them)
        set('.nps-text', `${esc(S.close).replace(/\.  /g, '.\u00a0 ')}${link}`);
        set('.nps-line', esc(line).replace(/\.  /g, '.\u00a0 '));
        const bar = m.querySelector('.nps-bar');
        if (bar) {
            bar.classList.toggle('nps-marquee', !!r.marquee && !done && !r.stalled);
            const pct = done ? 100 : percent(r);
            bar.style.setProperty('--nps-done', `${pct}%`);
            if (r.marquee && !done) bar.removeAttribute('aria-valuenow'); else bar.setAttribute('aria-valuenow', String(pct));
        }
        // the footer (cscui.dll.mui 4454 / 4455: "%1 error.  View errors in Sync Center."); the conflict's in Sync
        // Center's words ("%1!u! conflicts")
        const foot = m.querySelector('.nps-footer');
        if (foot) {
            let html = '';
            if (done && r.result === 'conflict') html = `<span class="nps-foot-icon is-warning"></span><span>1 conflict.\u00a0 View conflicts in <button type="button" class="nps-link" data-nps-link="conflicts">Sync Center</button>.</span>`;
            else if (done && r.result === 'error') html = `<span class="nps-foot-icon is-error"></span><span>1 error.\u00a0 View errors in <button type="button" class="nps-link" data-nps-link="results">Sync Center</button>.</span>`;
            if (foot.innerHTML !== html) foot.innerHTML = html;
            m.classList.toggle('nps-has-footer', !!html);
        }
    }

    // ---- the tray icon ------------------------------------------------------------------------------------------

    let icon = null;
    function trayIcon() {
        if (icon && icon.isConnected) return icon;
        icon = doc.getElementById('nightshadeSyncTrayIcon');
        if (!icon) return null;
        icon.addEventListener('click', () => openSyncCenter(conflict ? 'conflicts' : (load().last && load().last.result === 'error' ? 'results' : '')), { signal: appScopeSignal });
        if (root.contextMenu && typeof root.contextMenu.attachToElement === 'function') {
            root.contextMenu.attachToElement(icon, {
                sections: [{
                    type: 'list',
                    initfn: (s) => {
                        s.items = [
                            { text: 'Open Sync Center', action: 'open', default: true },
                            { separator: true },
                            { text: 'Sync All', action: 'sync', disabled: !!(run && run.phase !== 'done') },
                            { text: 'View sync conflicts', action: 'conflicts' },
                            { text: 'View sync results', action: 'results' }
                        ];
                    }
                }],
                onAction: (a) => {
                    if (a === 'sync') void syncNow();
                    else openSyncCenter(a === 'open' ? '' : a);
                }
            });
        }
        return icon;
    }

    function paintTray() {
        const el = trayIcon();
        if (!el) return;
        const s = load();
        const busy = !!(run && run.phase !== 'done');
        const state = busy ? (run.stalled ? 'waiting' : 'syncing') : conflict ? 'conflict' : (s.last && s.last.result === 'error') ? 'error' : s.last ? 'done' : 'idle';
        if (el.dataset.state !== state) el.dataset.state = state;
        // SyncCenter.dll.mui 6982 "Sync in progress: %ws"
        const tip = state === 'syncing' ? `Sync in progress: ${NAME}` : state === 'conflict' ? S.conflicts[0] : state === 'error' ? S.errors[0] : 'Sync Center';
        if (el.title !== tip) el.title = tip;
        // shown once the partnership exists on this computer (Vista keeps Sync Center's icon from then on)
        if ((s.setUp || busy || state === 'error') && el.classList.contains('hidden')) {
            // revealTrayIconElement: public/scripts/comp/trayIndicators.js
            if (typeof root.revealTrayIconElement === 'function') root.revealTrayIconElement(el); else el.classList.remove('hidden');
        }
    }

    function balloon(type, words, view) {
        const el = trayIcon();
        if (!el || !root.PopoverManager || typeof root.PopoverManager.showPopover !== 'function') return;
        paintTray();
        root.PopoverManager.showPopover(el, type, esc(words[0]), esc(words[1]), false, 10000,
            `<img src="${ART}/sync-center-32.png" alt="" width="32" height="32">`, null,
            { popupId: 'sync-center', position: 'top', arrowPosition: 'bottom-right', onClick: () => openSyncCenter(view || '') });
    }

    // ---- Sync Center ----------------------------------------------------------------------------------------------

    function openSyncCenter(view) {
        const fl = root.featureLoader;
        const ready = fl && typeof fl.loadFeature === 'function' ? fl.loadFeature('control_panel') : Promise.resolve();
        void Promise.resolve(ready).then(() => {
            const cp = root.melatonControlPanel;
            if (cp && typeof cp.doAction === 'function') cp.doAction(view ? `page:sync-center:${view}` : 'page:sync-center');
        });
    }

    /** Sync now (Sync Center's Sync / Sync All): websocket.js syncProfileNow; the window shows it. */
    async function syncNow() {
        const ws = root.wsClient;
        if (!ws || typeof ws.syncProfileNow !== 'function') return null;
        if (run && run.phase !== 'done') { closedByUser = null; void open(true); return null; }
        closedByUser = null;
        if (conflict) { void resolve(); return null; }
        return ws.syncProfileNow();
    }

    /** The partnership as Sync Center lists it. */
    function partnership() {
        const s = load();
        const busy = !!(run && run.phase !== 'done');
        let status = 'Ready for first sync';
        if (busy) status = 'Sync in progress';
        else if (conflict) status = 'Sync completed with 1 conflict';
        else if (s.last && s.last.result === 'error') status = 'Sync failed with 1 error';
        else if (s.last) status = `Last sync on ${when(s.last.at)}`;
        return {
            name: NAME, status, busy, percent: busy ? percent(run) : 0, marquee: busy && !!run.marquee,
            category: 'Profile', domain: dc(), network: net(), last: s.last || null, conflicts: conflict ? 1 : 0,
            errors: s.last && s.last.result === 'error' ? 1 : 0
        };
    }

    // ---- Resolve Conflict (shell32's conflict dialog, as Vista's Sync Center shows it) -------------------------

    let resolving = null;
    async function resolve() {
        if (!conflict || resolving) return;
        const V = await kit();
        if (!V || typeof V.openDialog !== 'function' || !conflict) return;
        const c0 = conflict;
        let cachedAt = 0;
        try { const meta = root.cachedProfile ? await root.cachedProfile.meta() : null; cachedAt = meta && meta.at ? Date.parse(meta.at) || 0 : 0; } catch (_) { cachedAt = 0; }
        const serverAt = revisionTime(c0.server) || c0.at;
        const what = names(c0.pieces);
        const card = (loc, lines) => `<span class="nrc-card"><img src="/static_images/vista-icons/nightshade-48.png" alt="" draggable="false"><span class="nrc-card-text"><b>${esc(NAME)}</b><span class="nrc-loc">${esc(loc)}</span>${lines.map((l) => `<span>${esc(l)}</span>`).join('')}</span></span>`;
        resolving = V.openDialog({
            id: 'nightshadeResolveConflictDialog',
            tpl: { t: 'Resolve Conflict', w: 256, h: 235, f: ['Segoe UI', 9], s: 0x80C800C8, c: [] },
            icon: `${ART}/sync-center-16.png`,
            bareCaption: true,
            init: (c) => {
                const wrap = doc.createElement('div');
                wrap.className = 'nrc';
                wrap.innerHTML = `
                    <div class="nrc-instruction">Both versions have been updated since the last sync.</div>
                    <div class="nrc-sub">Click the version you want to keep</div>
                    <button type="button" class="nrc-option" data-nrc="server">
                        <span class="nrc-head">Keep this version</span>
                        <span class="nrc-desc">Keep this version and copy it to the other location:</span>
                        ${card(`Profile (${dc()})`, [what.length ? `Changed: ${what.join(', ')}` : 'Changed on another computer', `Date modified: ${when(serverAt)}${serverAt >= cachedAt ? ' (newer)' : ''}`])}
                    </button>
                    <button type="button" class="nrc-option" data-nrc="logoff">
                        <span class="nrc-head">Log off</span>
                        <span class="nrc-desc">Changes made on this computer are not saved. Your profile is updated from ${esc(dc())} when you log on again:</span>
                        ${card('Profile (this computer)', [c0.held ? `Changes made in this session: ${c0.held}` : 'Started from the profile cached on this computer', `Date modified: ${cachedAt ? when(cachedAt) : 'Unknown'}${cachedAt > serverAt ? ' (newer)' : ''}`])}
                    </button>
                    <div class="nrc-footer"><button type="button" class="tbp-ctl tbp-button" data-nrc="cancel" data-dialog-primary="1">Cancel</button></div>`;
                c.content.appendChild(wrap);
                wrap.addEventListener('click', (ev) => {
                    const b = ev.target.closest('[data-nrc]');
                    if (!b) return;
                    const what2 = b.dataset.nrc;
                    const ctx = resolving;
                    resolving = null;
                    if (ctx) { try { ctx.close(); } catch (_) { /* gone */ } }
                    if (what2 === 'server') void keepServer();
                    else if (what2 === 'logoff') logOff();
                });
                c.modal.addEventListener('keydown', (ev) => {
                    if (ev.key !== 'Escape') return;
                    ev.preventDefault();
                    const ctx = resolving;
                    resolving = null;
                    if (ctx) { try { ctx.close(); } catch (_) { /* gone */ } }
                });
            },
            cancel: () => { resolving = null; }
        });
    }

    async function keepServer() {
        const ws = root.wsClient;
        if (!ws || typeof ws.resolveProfileConflict !== 'function') return;
        closedByUser = null;
        const r = await ws.resolveProfileConflict('server').catch(() => null);
        if (r && r.needsLogoff && typeof root.showConfirmationDialog === 'function') {
            // the rest of the domain controller's version needs a new logon (a piece without a live loader)
            const ok = await root.showConfirmationDialog(`Part of your profile can only be updated from ${dc()} when you log on.\n\nLog off now?`,
                [{ text: 'Log Off', value: true, className: 'btn-standard primary' }, { text: 'Cancel', value: false, className: 'btn-standard' }],
                null, { title: 'User Profile Service', icon: 'fas fa-triangle-exclamation' });
            if (ok) logOff();
        }
    }

    function logOff() {
        // runWinlogonPower: public/scripts/comp/winlogonPower.js (the programs-still-running screen included)
        if (typeof root.runWinlogonPower === 'function') void root.runWinlogonPower('logoff');
    }

    // ---- wiring -----------------------------------------------------------------------------------------------------

    root.addEventListener('melaton:profilesync', onSync, { signal: appScopeSignal });
    // another window of this desktop (a DeX window, a second tab) recorded a sync: the record is read again
    root.addEventListener('storage', (ev) => {
        if (ev.key !== KEY) return;
        store = null;
        if (desktop()) { paintTray(); changed(); }
    }, { signal: appScopeSignal });

    root.nightshadeProfileSync = {
        // websocket.js _checkProfileSync: the User Profile Service box stays away, this file shows the conflict
        get ownsConflict() { return desktop(); },
        partnership,
        conflict: () => (conflict ? { ...conflict, text: conflictText(conflict) } : null),
        results: () => load().results.slice(),
        syncNow,
        resolve,
        show: () => { closedByUser = null; return open(true); },
        openSyncCenter,
        on: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
        pieceName
    };

    // the icon's state from the last session on this computer, once the desktop is up (no request: local only)
    let wired = false;
    const wire = () => {
        const ws = root.wsClient;
        if (wired || !ws || typeof ws.on !== 'function') return;
        wired = true;
        ws.on('connected', () => { if (desktop()) paintTray(); });
        if (desktop()) paintTray();
    };
    if (doc.readyState === 'complete') wire(); else root.addEventListener('load', wire, { once: true, signal: appScopeSignal });
})(typeof window !== 'undefined' ? window : globalThis);
