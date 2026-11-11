/**
 * Melaton Mobile: the Director as a mobile visual novel (Yozora #709).
 *
 * Yukimi: "do not remove the mascot and such view, act like it's still a VN game but is mobile".
 * The Director is a Dreamscape app (own name and icon, no WM stock counterpart), so this is not a
 * WM clone: the desktop Director's own visual novel (director.js + directorMascot.js: her room, the
 * layered sprites, the thought cloud with live thinking, the typed lines with the working marker,
 * the reply / report card box, suggestions) runs full screen between the WM title bar and the soft
 * keys, with WM chrome around it.
 *
 * How: the desktop window #directorWindow is moved into this app's page and opened the normal way
 * (directorInstance.openDirectorWindow), so every send path, stream handler, session, persona and
 * the agent protocol stay director.js's; wm-director.css drops the window frame and command bar and
 * fits the scene to a portrait screen. Nothing here talks to the agent on its own.
 *
 *   scene        her room and sprites, face at the upper middle (the desktop puts her face 24 %
 *                in from her side; a portrait screen centres her: the mascot's layout() is wrapped
 *                on this instance only)
 *   text box     the VN box at the bottom: her lines type in while she works (working marker),
 *                the turn's reply and report card when done; a tap on the scene advances (finishes
 *                the line being typed, then pages the reply)
 *   thought cloud  tap: she thinks aloud in the text box (the desktop's click)
 *   compose      Reply opens the composer (the desktop's textarea, attachments chips) over the
 *                text box and focuses it for the SIP; soft keys Send / Cancel
 *   soft keys    Reply | Menu. Menu: Sessions, New Session, Persona >, Report Card / Reply, Log,
 *                Prints, History, Browser (while her browser pane shows), Stop, Quick Tasks >,
 *                Session > (Restart / Retry / Undo / Auto-Repair, Fork, Move to workspace, Nuke,
 *                Delete Session...), Computer > (Cleanup, Reinstall, Prompt guide >), Attach File...,
 *                Options > (model line, Visual Novel / Messages, Show Mascot, Show >, Send on Enter,
 *                Engine / Model / Thinking / Context / Fast, Director Settings...). The rows come from
 *                director.js's own menus (toolsMenuConfig, modelPrefItems, the session and message
 *                menus) through wmRows, so every pick runs the desktop handler.
 *   composing    Send | Menu (Attach File..., Attach Print >, Remove Attachments, Quick Tasks >, Cancel);
 *                attachments are WM thumbnails with a remove box
 *   Sessions     a WM list of the persona's chats (preview, name, date, workspace) with Archives;
 *                tap opens one, tap-and-hold its menu (Fork, Move, Auto-Repair, Nuke, Delete);
 *                back key and Cancel return to her
 *   pages        the desktop's windows as pages with ok: Prints (the prints pane: tap views,
 *                hold for Open / Show on Message / Attach / Recycle), History (Open Full History),
 *                the tool inspector (directorToolInspector.js hosted, tabs at the bottom), text
 *                (showDirectorText), Browser; Director Settings opens Settings > Director, whose ok
 *                comes back here
 *   desktop menus  tap-and-hold on a log row (Retry / Revert / Fork) and the restart box's choice
 *                button open WM menus (contextMenu.js is patched for this app); inside the message
 *                box the drop-down is drawn in the box (the shell sits under it)
 *   dock         (#732) under her text box: the next-reply choices one per row (moved out of the box)
 *                and her prints as a strip (the desktop's prints sidebar; tap views, hold for its menu);
 *                the HUD's chips open Prints. Wide screens: the prints gallery is the column beside
 *                her instead of the log (Menu > Log swaps the log in; Options > Log Beside Her keeps it)
 *   Yozora       (#744) the coding agent shows files where the others show prints: the files she edited
 *                this turn as tags under her choices, Menu > Changes (one file's removed and added lines),
 *                "files" in the HUD; no Report Card or Prints for her
 *   phone options  Settings > Director > Phone (localStorage wmDirectorPhone, wmDirectorPhonePrefs):
 *                allow the Director to open Studio (off by default: the server is told through
 *                client_desktop_state phone + director_send_message client and refuses her Studio tools
 *                while Studio is closed), open new prints in the picture view, notify when a turn ends
 *                in the background, prints strip, log beside her on wide screens
 *   notices      a turn that ends while the app is not on screen raises a WM notification (View)
 *   hand-offs    Ask Wren (Pictures & Videos, File Explorer, Studio), Attach to Director Message
 *                (File Explorer), Studio's Open session in Director and Expand Canvas's Director
 *                brief open this app over the view they came from (Back returns there) and run the
 *                desktop function on the window hosted here (handOff)
 *
 * Only on phones: does nothing unless window.uiShell is 'mobile'. Styles: public/css/wm-director.css.
 */
(function () {
    'use strict';

    if (window.uiShell !== 'mobile' || !document.documentElement.classList.contains('ui-mobile')) return;

    const APP_ID = 'director';
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    let ws = null; // window.wmShell
    // WM's wait cursor (wmShell.busy) while a session or persona the user picked loads. paint: the
    // cursor is on screen in the tap's own frame (a chat opening is a server round trip, then a
    // synchronous rebuild of its rows), Yozora #723
    const busyOf = (fn) => (ws && typeof ws.busy === 'function' ? ws.busy(fn, { paint: true }) : fn());
    let page = null;
    let shown = false;
    // pages over her scene (Sessions, Prints, History, a tool's inspector ...): the top one shows
    const stack = [];
    const top = () => stack[stack.length - 1] || null;
    let composing = false;
    let patchedMascot = null;
    let waitTimer = null;

    const dir = () => window.directorInstance || null;
    const isCurrent = () => !!(ws && ws.current === APP_ID);

    // ---------------------------------------------------------------- phone settings (#732)

    /**
     * Settings > Director > Phone (wmSettingsDreamscape.js), kept on this device:
     *   allowStudio   the Director may open Studio (off: she prints on the server unless Studio is
     *                 already open; the server refuses her Studio tools, mcpAgentFacade refuseStudioOnPhone)
     *   openPrints    a new print of the open chat opens in the picture view
     *   notifyTurns   a turn that ends while the app is in the background raises a notification
     *   printStrip    her prints as a strip under the text box (the desktop's prints sidebar)
     *   wideLog       wide screens show the log beside her (off: the prints gallery column)
     *   wideSolo      wide screens show only her: no column, the page behaves as a big phone (Menu > Log
     *                 lays the log over her, Reply opens the composer at the bottom)
     */
    const PREF_KEY = 'wmDirectorPhone';
    const PREF_DEFAULTS = Object.freeze({ allowStudio: false, openPrints: false, notifyTurns: true, printStrip: true, wideLog: false, wideSolo: false });
    let prefCache = null;
    function prefs() {
        if (prefCache) return prefCache;
        let saved = {};
        try { saved = JSON.parse(localStorage.getItem(PREF_KEY) || '{}') || {}; } catch (_) { saved = {}; }
        const out = { ...PREF_DEFAULTS };
        Object.keys(PREF_DEFAULTS).forEach((k) => { if (typeof saved[k] === 'boolean') out[k] = saved[k]; });
        prefCache = out;
        return out;
    }
    function setPrefs(patch) {
        const next = { ...prefs(), ...(patch || {}) };
        prefCache = next;
        try { localStorage.setItem(PREF_KEY, JSON.stringify(next)); } catch (_) { /* storage blocked: this load only */ }
        window.dispatchEvent(new CustomEvent('wmDirectorPrefsChange', { detail: { ...next } }));
        return next;
    }
    window.addEventListener('storage', (e) => { if (e.key === PREF_KEY) prefCache = null; });
    window.wmDirectorPhonePrefs = { key: PREF_KEY, defaults: PREF_DEFAULTS, get: () => ({ ...prefs() }), set: setPrefs };
    /** What the server is told (client_desktop_state phone, director_send_message client): read every second, cheap. */
    window.wmDirectorPhoneState = () => {
        const mm = document.getElementById('manualModal');
        return { shell: 'mobile', allowStudio: prefs().allowStudio === true, studioOpen: !!(mm && !mm.classList.contains('hidden')) };
    };
    const PERSONAS = { wren: 'Yumiya', kabuki: 'Chiyo', xi: 'Yozora' };

    function personaName(p) {
        try {
            // director.js top-level function
            // eslint-disable-next-line no-undef
            if (typeof directorPersonaName === 'function') return directorPersonaName(p);
        } catch (_) { /* fall back */ }
        return PERSONAS[p] || 'Director';
    }

    /** Menu > Log: the log over her scene (the desktop's peek). */
    function peeking() {
        const d = dir();
        const m = d && d.mascot;
        // only a log that is on screen counts (a view switch can leave peek set with no log showing)
        return !!(m && m.peek && m.vnBubbles() && m.host && m.host.classList.contains('dm-log-peek'));
    }

    function running(d) {
        d = d || dir();
        return !!(d && d._running && d.currentSession && d._runningSessionId === d.currentSession.id);
    }

    // ---------------------------------------------------------------- screen size

    /**
     * The page's layout for its screen (Yozora #732), from wm-director.css's container queries:
     * 'phone' (her scene fills the page) or 'wide' (her scene on the left, the log and the composer
     * in a column on the right).
     */
    let layout = 'phone';
    function readLayout() {
        const host = page && page.querySelector('.wmd-host');
        const v = host ? getComputedStyle(host).getPropertyValue('--wmd-layout').trim() : '';
        return v === 'wide' ? 'wide' : 'phone';
    }

    let recheckLayout = () => {};
    function watchLayout() {
        if (!page || typeof ResizeObserver !== 'function') return;
        const check = () => {
            const now = readLayout();
            if (page.dataset.wmdLayout !== now) page.dataset.wmdLayout = now;
            if (now === layout) return;
            layout = now;
            // the log is beside her now: a peek left on would hide her text box for nothing
            const d = dir();
            const m = d && d.mascot;
            if (layout === 'wide' && m && m.peek && typeof m.togglePeek === 'function') m.togglePeek(false);
            if (layout !== 'wide' && logCol) setLogCol(false);
            paintPrints();
            if (d && d.mascot) d.mascot.settleLayout(400);
            if (isCurrent()) { ws.refreshSoftKeys(); ws.syncHistory(); }
        };
        layout = readLayout();
        page.dataset.wmdLayout = layout;
        recheckLayout = check;
        new ResizeObserver(check).observe(page);
        // Settings > Screen changes the scale (--wm-px, so the em breakpoints) without a resize
        if (typeof MutationObserver === 'function') new MutationObserver(check).observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    }

    // ---------------------------------------------------------------- hosting the desktop Director

    /** Wrap the mascot's isHosted / layout on this instance: hidden with the app, centred on a portrait screen. */
    function patchMascot(d) {
        const m = d && d.mascot;
        if (!m || patchedMascot === m) return;
        patchedMascot = m;
        // she holds no layers while the app is in the background (applyView releases them). A phone never
        // shows the desktop window, so outside the app's page (after a reload reopened it under BODY) she is hidden too.
        m.isHosted = () => !!(shown && page && page.contains(m.host));
        // (not named layout: that is this file's phone / wide state, read by the wrappers below)
        const stageHer = m.layout.bind(m);
        m.layout = function () {
            stageHer();
            if (!this.root || !this.manifest || !this.host || !this._shown || this.view !== 'mascot') return;
            if (!page || !page.contains(this.host)) return;
            // her stage: the whole chat on a phone, the scene column on a wide screen (wm-director.css)
            const stage = (this.root && this.root.classList && this.root.classList.contains('director-mascot-stage')) ? this.root : this.host;
            const box = stage.getBoundingClientRect();
            if (!box.width || !box.height) return;
            const [W, H] = this.manifest.size;
            const cam = this.camera();
            const face = Array.isArray(this.manifest.face) ? this.manifest.face : [cam[0] + cam[2] / 2, cam[1] + cam[3] * 0.2, cam[2] * 0.15];
            if (box.width > box.height) {
                // landscape: the desktop's own staging (sized from the height, her face toward her side).
                // The desktop measures the whole chat; beside the log her scene is narrower, so the
                // same staging is redone in the scene's box (unchanged numbers when they are the same box)
                const hb = this.host.getBoundingClientRect();
                if (Math.abs(hb.width - box.width) < 2) return;
                const kv = (box.height * 0.11) / Math.max(1, face[2]);
                const ax = this.manifest.anchor === 'left' ? box.width * 0.24 : box.width * 0.76;
                const ay = box.height * 0.24;
                this.setStyle(this.el.canvas, 'width', `${Math.round(W * kv)}px`);
                this.setStyle(this.el.canvas, 'height', `${Math.round(H * kv)}px`);
                this.setStyle(this.el.canvas, 'transform', `translate(${Math.round(ax - face[0] * kv)}px, ${Math.round(ay - face[1] * kv)}px)`);
                this._k = kv;
                return;
            }
            // portrait: her face at the upper middle, sized from the width (the desktop sizes it from
            // the height, which on a phone put most of her off the side)
            const faceSize = Math.min(box.height * 0.1, box.width * 0.2);
            const k = faceSize / Math.max(1, face[2]);
            // her belly in view (Yukimi 2026-11-11): she stands a little higher, and off centre away
            // from her belly (the stage's belly point in the manifest), so it comes in from the screen
            // edge and more of it clears her text box. Her size is untouched.
            const def = typeof this.stageDef === 'function' ? this.stageDef() : null;
            const belly = def && Array.isArray(def.belly) ? def.belly : null;
            const lean = belly ? Math.max(-box.width * 0.22, Math.min(box.width * 0.22, (belly[0] - face[0]) * k * 0.75)) : 0;
            const px = box.width * 0.5 - lean;
            const py = box.height * 0.15;
            this.setStyle(this.el.canvas, 'width', `${Math.round(W * k)}px`);
            this.setStyle(this.el.canvas, 'height', `${Math.round(H * k)}px`);
            this.setStyle(this.el.canvas, 'transform', `translate(${Math.round(px - face[0] * k)}px, ${Math.round(py - face[1] * k)}px)`);
            this._k = k;
        };
        // the HUD's second counter is Yozora's files: directorMascot.js writes the prints count on every paint
        const hud = m.updateHud.bind(m);
        m.updateHud = function (info) {
            hud(info);
            paintFilesHud(dir());
        };
        // the pager counts pages of (height - 24 px): a short box read "1/2" with nothing more to show
        const pager = m.paintPager.bind(m);
        m.paintPager = function () {
            pager();
            const body = this.el && this.el.dialogBody;
            if (body && this.el.pager && page && page.contains(body) && body.scrollHeight <= body.clientHeight + 2) {
                this.el.pager.classList.add('hidden');
                this.el.pager.textContent = '';
            }
        };
        // her text box sits over the dock (choices, prints strip) and takes a phone's share of the scene
        const place = m.placeResult.bind(m);
        m.placeResult = function () {
            place();
            const box = this.el && this.el.result;
            if (page) page.classList.toggle('wmd-card', !!(box && !box.classList.contains('hidden') && this._tab === 'card'));
            if (!box || box.classList.contains('hidden') || !page || !page.contains(box) || !this.layer) return;
            const l = this.layer.getBoundingClientRect();
            if (!l.height) return;
            const dock = page.querySelector('.wmd-dock');
            const dh = dock && getComputedStyle(dock).display !== 'none' ? dock.getBoundingClientRect().height : 0;
            // wide: the composer is in the column, not under her box (the desktop lifted the box over it)
            const was = layout === 'wide' ? 0 : (parseInt(box.style.bottom, 10) || 0);
            const bottom = Math.round(Math.max(was, dh ? dh + 18 : 0, 12));
            box.style.bottom = `${bottom}px`;
            if (this._tab !== 'card') {
                // a phone's share of the scene, and never over the title banner row (short landscape)
                const share = layout === 'wide' ? 0.42 : 0.34;
                const topRoom = (parseInt(this.layer.style.getPropertyValue('--dm-top'), 10) || 12) + 64;
                const room = l.height - bottom - topRoom;
                box.style.maxHeight = `${Math.round(Math.max(72, Math.min(l.height * share, 360, room)))}px`;
            }
            this.paintPager();
        };
        // a new print drops into her from its thumbnail in the strip / gallery column (the desktop's
        // prints sidebar is not on a phone)
        const onPrint = m.onPrint.bind(m);
        m.onPrint = function (url, options) {
            let opts = options || {};
            // Yozora's page (director.js noteDocumentEdits) leaves from her newest file tag when it is on screen
            if (opts.document && !opts.from && page && page.contains(this.host)) {
                const tag = page.querySelector('.wmd-files .wmd-file:last-child');
                return onPrint(url, tag ? { ...opts, from: tag } : opts);
            }
            if (!opts.from && page && page.contains(this.host)) {
                paintPrints();
                const name = (() => { try { return decodeURIComponent(String(url).split('?')[0].split('/').pop()); } catch (_) { return ''; } })();
                const pool = page.classList.contains('wmd-gallery-on') && layout === 'wide' ? page.querySelector('.wmd-gallery') : page.querySelector('.wmd-strip');
                const th = name && pool ? [...pool.querySelectorAll('.wmd-thumb[data-file]')].find((b) => b.dataset.file === name) : null;
                if (th && th.firstChild) opts = { ...opts, from: th.firstChild };
            }
            return onPrint(url, opts);
        };
        m.applyView();
        syncBlink(m);
    }

    /** Her blink timer (started once at mount by the desktop) runs only while the app is on screen. */
    function syncBlink(m) {
        if (!m || typeof m.scheduleBlink !== 'function') return;
        if (shown && !m._blinkTimer) m.scheduleBlink();
        else if (!shown && m._blinkTimer) { clearTimeout(m._blinkTimer); m._blinkTimer = null; }
    }

    /**
     * Patch the Director as soon as it exists, not on the first open of the app: a reload can reopen its window
     * (hidden) while the phone is on Today, and she must not hold her layers then. Also keep the desktop's
     * reload-reopen flag from being saved unless this app is on screen (the phone always starts on Today).
     */
    let patchedDirector = null;
    function patchDirector() {
        const d = dir();
        if (!d) return false;
        patchHandOffs(d);
        patchWindows(d);
        patchContextMenu();
        if (patchedDirector !== d && typeof d.saveReopenState === 'function') {
            patchedDirector = d;
            const save = d.saveReopenState.bind(d);
            d.saveReopenState = function () {
                if (shown && isCurrent()) { save(); return; }
                try { sessionStorage.removeItem('staticforge_director_reopen'); } catch (_) { /* storage blocked */ }
            };
        }
        if (!d.mascot) return false;
        patchMascot(d);
        return true;
    }

    function waitForDirector() {
        if (patchDirector()) return;
        const timer = setInterval(() => { if (patchDirector()) clearInterval(timer); }, 1000);
    }

    function hostWindow(d) {
        const win = d && d.directorWindow;
        const host = page && page.querySelector('.wmd-host');
        if (!win || !host) return false;
        if (win.parentNode !== host) host.appendChild(win);
        return true;
    }

    /**
     * Host the desktop window and open it. run: a hand-off from another view (handOff) that opens it
     * its own way, as on the desktop (Ask Wren looks up the image's chat while the window opens).
     */
    let startBusy = null;
    let everShown = false;
    function endStartBusy() {
        if (startBusy) { startBusy(); startBusy = null; }
    }

    async function attach(run) {
        const d = dir();
        if (d && d.directorWindow) endStartBusy();
        const status = page.querySelector('.wmd-status');
        if (run && d && d.directorWindow) {
            status.hidden = true;
            hostWindow(d);
            patchMascot(d);
            watchChat(d);
            // no paint deferral: a hand-off can focus the composer (the SIP needs the tap's gesture)
            await (ws && typeof ws.busy === 'function' ? ws.busy(() => run(d)) : run(d));
            // the window opens in the app's page: a hand-off that left it closed opens it the normal way
            if (shown && !d.directorWindowIsOpen()) await d.openDirectorWindow();
            hostWindow(d);
        } else if (!d || !d.directorWindow) {
            status.hidden = false;
            status.querySelector('.wmd-status-text').textContent = 'The Director is starting...';
            // the wait cursor while she loads (released when she attaches or the app is left)
            if (!startBusy && ws && typeof ws.busy === 'function') startBusy = ws.busy(true, { timeout: 60000 });
            if (!waitTimer) waitTimer = setTimeout(() => { waitTimer = null; if (shown) void attach(run); else endStartBusy(); }, 1000);
            return;
        } else {
            status.hidden = true;
            hostWindow(d);
            patchMascot(d);
            watchChat(d);
            if (!d.directorWindowIsOpen()) {
                // the first open loads her sessions and builds the window: the wait cursor meanwhile
                await busyOf(() => d.openDirectorWindow());
                if (!shown) return;
                hostWindow(d);
            } else {
                if (d.mascot) d.mascot.applyView();
                d.paintPersonaToggle();
            }
        }
        if (!shown) return;
        syncBlink(d.mascot);
        // a chat that loaded while the app was in the background (a reload reopens it hidden) was read
        // with her VN off (isHosted false): its reply box is set now that she is on screen
        const m = d.mascot;
        if (m && !m._result && !m.working && m.vnBubbles() && d.currentSession && Array.isArray(d.currentSession.messages) && d.currentSession.messages.length) {
            m.onMessages(d.currentSession.messages);
        }
        ensureGallery(d);
        ensureDock(d);
        setLogCol(logCol && layout === 'wide');
        paintPrints();
        syncComposer();
        refreshTitle();
        paintQueue();
        // settle her once the page has painted and once after the bars settle (settleLayout re-measured
        // every frame for 600 ms: ~40 % of the main thread after each open at 4x throttle, #723)
        if (d.mascot) {
            const m2 = d.mascot;
            const again = () => { if (shown && m2._shown) m2.layout(); };
            requestAnimationFrame(again);
            setTimeout(again, 300);
        }
        if (ws && isCurrent()) ws.refreshSoftKeys();
    }

    /** A chat opening or a new draft (the desktop toggles director-composer-center): composer and soft keys follow. */
    let watched = null;
    function watchChat(d) {
        const chat = d && d.directorSessionChat;
        if (!chat || watched === chat || typeof MutationObserver !== 'function') return;
        watched = chat;
        let was = chat.classList.contains('director-composer-center');
        new MutationObserver(() => {
            const now = chat.classList.contains('director-composer-center');
            if (now === was) return;
            was = now;
            // left the draft some other way than send() (a quick-start button, a chat the server made): the
            // composer opened on the draft would now count as a back step with no history entry
            if (!now && composing && !(d.directorChatInput && document.activeElement === d.directorChatInput)) composing = false;
            if (!shown) return;
            syncComposer();
            if (isCurrent()) { ws.refreshSoftKeys(); ws.syncHistory(); }
        }).observe(chat, { attributes: true, attributeFilter: ['class'] });
        // the attachment chips (a device file read in after the picker, the Open dialog, a chip's X):
        // Send follows whether there is anything to send
        const chips = document.getElementById('directorAttachChips');
        if (chips) new MutationObserver(() => { if (shown && isCurrent()) ws.refreshSoftKeys(); }).observe(chips, { childList: true });
    }

    // ---------------------------------------------------------------- hand-offs from other views

    let pendingRun = null;
    // the picture view the Director opened over (Pictures & Videos' Menu > Ask Wren): Back re-opens it
    let viewerReturn = null;

    /** The picture the open PhotoSwipe shows, or null (the shell's viewer: lightbox.js). */
    function openViewerPicture() {
        if (!document.querySelector('.pswp.pswp--open')) return null;
        try {
            const p = (typeof lightbox !== 'undefined' && lightbox && lightbox.pswp) || window.pswp;
            const d = p && p.currSlide && p.currSlide.data;
            const item = (d && d.data) || null;
            return (item && (item.filename || item.original)) || null;
        } catch (_) { return null; }
    }

    /**
     * The Director app left (hide): when that was Back to the view it opened over, the picture view
     * comes back too, as the desktop's Glancewell/Lumen stay open behind their Ask Wren.
     */
    function restoreViewer() {
        const ret = viewerReturn;
        viewerReturn = null;
        if (!ret) return;
        setTimeout(() => {
            if (!ws || ws.current !== ret.app || openViewerPicture()) return;
            if (typeof showLightbox !== 'function') return;
            try { showLightbox({ filename: ret.filename }); } catch (_) { /* viewer not ready */ }
        }, 0);
    }

    /**
     * Another view hands something to the Director (Ask Wren in Pictures & Videos, File Explorer or
     * Studio; Attach to Director Message; Studio's Open session in Director; Expand Canvas with the
     * Director on): the app opens over that view (Back returns to it) and the desktop function runs on
     * the window hosted here, so its chips, lookups and send path are director.js's own.
     */
    function handOff(run) {
        const d = dir();
        const booted = document.documentElement.dataset.wmBoot === 'done';
        if (!ws || !booted || (shown && isCurrent() && d && d.directorWindowIsOpen())) return Promise.resolve(run(d));
        return new Promise((resolve) => {
            let done = false;
            const finish = (v) => { if (!done) { done = true; resolve(v); } };
            pendingRun = async (dd) => {
                const had = dd && dd.pendingAttachments ? dd.pendingAttachments.length : 0;
                try {
                    const v = await run(dd);
                    // a chip went on the message being written: the composer shows it (the desktop
                    // focuses its always-visible textarea; here the composer is closed until opened)
                    if (dd && dd.pendingAttachments && dd.pendingAttachments.length > had && shown && isCurrent() && !composing) openComposer();
                    finish(v);
                } catch (err) { console.warn('[wmDirector] hand-off', err); finish(undefined); }
            };
            // the shell closes the picture view under a newly opened app; Back brings it back
            const pic = openViewerPicture();
            viewerReturn = pic && ws.current && ws.current !== APP_ID ? { app: ws.current, filename: pic } : null;
            ws.open(APP_ID);
            // left before the Director came up: the hand-off is dropped (nothing waits on it forever)
            setTimeout(() => finish(undefined), 20000);
        });
    }

    /** director.js's hand-off entry points, on this instance: through the app. */
    function patchHandOffs(d) {
        ['askWrenAboutImage', 'openSessionInWindow', 'startExpandCanvasChat'].forEach((name) => {
            const orig = d[name];
            if (typeof orig !== 'function' || orig._wmDirector) return;
            const wrapped = function (...args) {
                return handOff((dd) => orig.apply(dd || d, args));
            };
            wrapped._wmDirector = true;
            d[name] = wrapped;
        });
    }

    const sameAttachment = (a, b) => !!(a && b && a.source === b.source
        && (a.filename || a.hash || a.fileId) === (b.filename || b.hash || b.fileId));

    /**
     * Attach to Director Message: rows the desktop Director takes from Explorer (explorerItemAttachment
     * shapes) go on the message being written, as the desktop's drop does (dropPasteFallback.js).
     */
    function attachItems(list) {
        const items = (list || []).filter(Boolean);
        if (!items.length) return Promise.resolve();
        return handOff(async (d) => {
            if (!d) return;
            if (!d.directorWindowIsOpen()) await d.openDirectorWindow();
            items.forEach((it) => { if (!d.pendingAttachments.some((p) => sameAttachment(p, it))) d.pendingAttachments.push(it); });
            d.renderAttachChips();
            if (shown && isCurrent()) openComposer();
        });
    }

    // newSessionWith(persona): the menu's New Session for that persona (her selected first), as the
    // 6.5 home screen's Director pages start one (wmTodayWidgets.js); the app must be in front
    window.wmDirectorApp = { attach: attachItems, handOff, newSessionWith: async (p) => { if (p) await switchPersona(p); await newSession(); } };

    // ---------------------------------------------------------------- composer

    function isDraft(d) {
        d = d || dir();
        // the desktop centres its composer on a new chat (placeComposer): that is the draft state
        const chat = d && d.directorSessionChat;
        if (chat) return chat.classList.contains('director-composer-center');
        return !!(d && d.currentSession && d.currentSession.draft);
    }

    /** The composer shows while composing, and always on a new chat (the desktop's centred home). */
    function syncComposer() {
        if (!page) return;
        const d = dir();
        const open = composing || isDraft(d);
        page.classList.toggle('wmd-composing', open);
        if (d && d.mascot) d.mascot.settleLayout(400);
    }

    function openComposer() {
        const d = dir();
        if (!d) return;
        composing = true;
        syncComposer();
        const input = d.directorChatInput;
        if (input) {
            input.focus({ preventScroll: true });
            try { const n = input.value.length; input.setSelectionRange(n, n); } catch (_) { /* not a text field */ }
        }
        ws.refreshSoftKeys();
        ws.syncHistory();
    }

    function closeComposer() {
        const d = dir();
        composing = false;
        if (d && d.directorChatInput) d.directorChatInput.blur();
        syncComposer();
        if (ws && isCurrent()) { ws.refreshSoftKeys(); ws.syncHistory(); }
    }

    async function send() {
        const d = dir();
        if (!d) return;
        const text = d.directorChatInput ? d.directorChatInput.value.trim() : '';
        if (!text && !(d.pendingAttachments && d.pendingAttachments.length)) { openComposer(); return; }
        await d.sendMessage();
        // the desktop clears the box once the message is on its way (a busy chat asks Steer / Queue first)
        if (d.directorChatInput && !d.directorChatInput.value.trim()) closeComposer();
        else ws.refreshSoftKeys();
        ws.syncHistory();
    }

    // ---------------------------------------------------------------- tap to advance

    /** A tap on the scene: finish the line being typed, then page the reply (the desktop's click). */
    function advance() {
        const d = dir();
        const m = d && d.mascot;
        if (!m || !m.el) return;
        const r = m._reader;
        if (m.working && r && r.current) {
            if (r.shown < r.current.text.length) {
                r.shown = r.current.text.length;
                r.holdUntil = Date.now() + 800;
            } else if (r.queue.length) {
                r.holdUntil = 0;
            }
            m.paintBubbles();
            m.startReader();
            return;
        }
        if (m._result && !m.el.result.classList.contains('hidden')) m.pageReply();
    }

    // ---------------------------------------------------------------- pages over her scene

    /**
     * A page over her scene: Sessions (a list, X in the corner like the chat), and the desktop's other
     * windows in phone form with ok in the corner: Prints (the desktop's prints pane), History (Open
     * Full History), a tool call's inspector (directorToolInspector.js), text (showDirectorText).
     * spec: { kind, title, corner: 'ok' | 'close', render(el), keys() -> soft keys, onClose() }.
     */
    function pushPage(spec) {
        // the log stays open under a page opened from it (a tool's inspector): ok comes back to it
        if (composing) closeComposer();
        const el = document.createElement('div');
        el.className = `wmd-page wmd-page-${spec.kind}`;
        page.appendChild(el);
        spec.el = el;
        stack.push(spec);
        spec.render(el);
        paintStack();
        return spec;
    }

    function popPage() {
        const p = stack.pop();
        if (!p) return false;
        try { if (typeof p.onClose === 'function') p.onClose.call(p); } catch (err) { console.warn('[wmDirector] page close', err); }
        p.el.remove();
        paintStack();
        const d = dir();
        if (!stack.length && d && d.mascot) d.mascot.settleLayout(400);
        return true;
    }

    /** Close every page of a kind (and the ones over it). */
    function closePages(kind) {
        const at = stack.findIndex((p) => p.kind === kind);
        if (at < 0) return;
        while (stack.length > at) popPage();
    }

    function paintStack() {
        stack.forEach((p, i) => { p.el.hidden = i !== stack.length - 1; });
        page.classList.toggle('wmd-has-page', stack.length > 0);
        refreshTitle();
        if (ws && isCurrent()) { ws.refreshSoftKeys(); ws.syncHistory(); }
    }

    function refreshTitle() {
        if (!ws || !isCurrent()) return;
        const t = top();
        ws.setTitle(t ? (typeof t.title === 'function' ? t.title() : t.title) : 'Director');
    }

    /** WM's tap-and-hold: a held row opens its menu at the finger (WM draws the red dots ring; here the hold). */
    function onHold(root, selector, open) {
        let timer = null;
        let at = null;
        let fired = 0;
        const cancel = () => { clearTimeout(timer); timer = null; };
        root.addEventListener('touchstart', (e) => {
            const row = e.target.closest && e.target.closest(selector);
            if (!row || e.touches.length !== 1) return;
            at = { x: e.touches[0].clientX, y: e.touches[0].clientY };
            cancel();
            timer = setTimeout(() => { timer = null; fired = Date.now(); open(row, at.x, at.y); }, 550);
        }, { passive: true });
        root.addEventListener('touchmove', (e) => {
            if (!timer || !at) return;
            const t = e.touches[0];
            if (Math.abs(t.clientX - at.x) > 8 || Math.abs(t.clientY - at.y) > 8) cancel();
        }, { passive: true });
        // the touch that held does not also click (WM: lifting the stylus leaves the menu up)
        root.addEventListener('touchend', (e) => { cancel(); if (Date.now() - fired < 2000 && e.cancelable) e.preventDefault(); }, { passive: false });
        root.addEventListener('touchcancel', cancel, { passive: true });
        // a mouse's right click, and Chrome's own long-press event
        root.addEventListener('contextmenu', (e) => {
            const row = e.target.closest && e.target.closest(selector);
            if (!row) return;
            e.preventDefault();
            e.stopPropagation();
            if (Date.now() - fired < 800) return;
            fired = Date.now();
            open(row, e.clientX, e.clientY);
        });
        // the click that ends a hold does not also open the row, nor close its menu (window capture:
        // ahead of the shell's tap-outside)
        window.addEventListener('click', (e) => {
            if (Date.now() - fired < 800 && root.contains(e.target) && e.target.closest && e.target.closest(selector)) { e.preventDefault(); e.stopImmediatePropagation(); }
        }, true);
    }

    // ---------------------------------------------------------------- desktop menus as WM rows

    const resolveV = (v, t) => { try { return typeof v === 'function' ? v(t) : v; } catch (_) { return undefined; } };
    const plainText = (html) => { const n = document.createElement('div'); n.innerHTML = String(html || ''); return n.textContent.replace(/\s+/g, ' ').trim(); };

    /**
     * contextMenu.js rows (director.js's own menus: the tools menu, the session and message menus, the
     * restart dialog's choice) as WM menu rows, so each runs the desktop's handler. pick: a value list
     * (Engine, Model, Thinking ...): the current one gets WM's dot.
     */
    function wmRows(items, target, run, handlerfn, pick) {
        const out = [];
        for (const item of items || []) {
            if (!item) continue;
            if (item.separator) {
                if (out.length && out[out.length - 1] !== '-') out.push('-');
                const heading = resolveV(item.text, target);
                if (heading) out.push({ label: String(heading), disabled: true });
                continue;
            }
            if (resolveV(item.hidden, target) === true) continue;
            try { if (typeof item.loadfn === 'function') item.loadfn(item, target); } catch (_) { /* as is */ }
            let label = resolveV(item.text, target) || resolveV(item.label, target) || (item.content ? plainText(resolveV(item.content, target)) : '');
            if (!label) continue;
            label = String(label).replace(/\s+/g, ' ').trim();
            const subtext = resolveV(item.subtext, target);
            if (subtext) label += ` (${subtext})`;
            const row = { label, disabled: !!resolveV(item.disabled, target) };
            if (Array.isArray(item.submenu) || typeof item.optionsfn === 'function') {
                const valueList = item.valueDisplay != null;
                row.submenu = () => {
                    let list = item.submenu;
                    if (!Array.isArray(list)) { try { list = item.optionsfn(target) || []; } catch (_) { list = []; } }
                    return wmRows(list, target, run, item.handlerfn || handlerfn, valueList);
                };
            } else if (handlerfn || item.action || typeof item.onClick === 'function') {
                if (item.showIndicator || item.checked != null || typeof item.loadfn === 'function') {
                    if (pick || item.indicatorMark === 'radio') row.radio = !!item.checked;
                    else row.checked = !!item.checked;
                }
                row.action = () => {
                    try {
                        if (handlerfn) handlerfn(item, target, null);
                        else if (item.action) run(item.action, target, item);
                        else item.onClick();
                    } catch (err) { console.warn('[wmDirector] menu action', err); }
                    after();
                };
            } else {
                continue;
            }
            out.push(row);
        }
        while (out.length && out[out.length - 1] === '-') out.pop();
        while (out.length && out[0] === '-') out.shift();
        return out;
    }

    /** A contextMenu config's list rows (its onAction runs them). */
    function rowsOfConfig(config, target) {
        if (!config) return [];
        const run = (action, t, item) => { if (typeof config.onAction === 'function') config.onAction(action, t, item); };
        try { if (typeof config.beforeShow === 'function') config.beforeShow(null, target, true); } catch (_) { /* as is */ }
        const out = [];
        (config.sections || []).forEach((section) => {
            if (!section || !Array.isArray(section.items) || resolveV(section.hidden, target) === true) return;
            const rows = wmRows(section.items, target, run);
            if (!rows.length) return;
            if (out.length) out.push('-');
            out.push(...rows);
        });
        return out;
    }

    /**
     * Desktop menus raised in the Director on a phone (tap-and-hold on a log row or a print, the restart
     * dialog's engine / model button): contextMenu.js would draw them as hidden desktop menus; here they
     * are WM menus that run the same handlers. Other apps' menus go on to the desktop code (or wmStudio).
     */
    function patchContextMenu() {
        /* global contextMenu */
        if (typeof contextMenu === 'undefined' || !contextMenu || typeof contextMenu._openMenu !== 'function') return false;
        if (contextMenu._wmDirectorPatched) return true;
        contextMenu._wmDirectorPatched = true;
        const open = contextMenu._openMenu.bind(contextMenu);
        contextMenu._openMenu = function (event, target, trigger, isTouch, isProxyEvent) {
            const mine = isCurrent() && target && ((page && page.contains(target)) || (target.closest && target.closest('#confirmationDialog')));
            if (!mine) return open(event, target, trigger, isTouch, isProxyEvent);
            const config = trigger === 'click'
                ? (this.clickMenuConfigs && this.clickMenuConfigs[target.dataset.clickMenu])
                : (this.configs && this.configs[target.dataset.contextMenu]);
            let items = [];
            try { items = rowsOfConfig(config, target); } catch (err) { console.warn('[wmDirector] context menu', err); }
            if (!items.length) return undefined;
            const pt = event && ((event.touches && event.touches[0]) || (event.changedTouches && event.changedTouches[0]) || event);
            let x = pt && Number.isFinite(pt.clientX) ? pt.clientX : 0;
            let y = pt && Number.isFinite(pt.clientY) ? pt.clientY : 0;
            if (!x && !y) { const r = target.getBoundingClientRect(); x = r.left; y = r.bottom; }
            const box = target.closest && target.closest('#confirmationDialog');
            if (trigger === 'click') {
                // a combo-like button (the restart dialog's choice): its list hangs under it, and the
                // click that follows the mousedown it opened on does not close it again
                swallow = { target, until: Date.now() + 700 };
                if (box) dialogMenu(box, target, items);
                else ws.dropdown(target, items, 'left');
            } else if (box) {
                dialogMenu(box, target, items);
            } else {
                ws.menuAt(x, y, items);
            }
            return undefined;
        };
        window.addEventListener('click', (e) => {
            if (!swallow || Date.now() > swallow.until || !swallow.target.contains(e.target)) return;
            swallow = null;
            e.preventDefault();
            e.stopImmediatePropagation();
        }, true);
        return true;
    }
    let swallow = null;

    /**
     * A WM drop-down inside the desktop message box (#confirmationDialog sits over the shell, so the
     * shell's own popup would draw under it): the shell's popup classes and behaviour (rows, dots and
     * ticks, submenus opening left over their parent, a tap outside or Back closes it).
     */
    let dlgPop = null;
    function closeDialogMenu() {
        if (!dlgPop) return;
        dlgPop.root.querySelectorAll('.wmd-dlg-pop').forEach((n) => n.remove());
        document.removeEventListener('pointerdown', dlgPop.outside, true);
        document.removeEventListener('keydown', dlgPop.key, true);
        dlgPop = null;
    }

    function fillDialogMenu(root, pop, items, level) {
        items.forEach((item) => {
            if (item === '-') { pop.insertAdjacentHTML('beforeend', '<div class="wm-popup-sep" role="separator"></div>'); return; }
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'wm-popup-item';
            if (item.radio != null) { b.setAttribute('role', 'menuitemradio'); b.setAttribute('aria-checked', item.radio ? 'true' : 'false'); b.classList.add('is-radio'); }
            else if (item.checked != null) { b.setAttribute('role', 'menuitemcheckbox'); b.setAttribute('aria-checked', item.checked ? 'true' : 'false'); }
            b.textContent = item.label;
            b.disabled = !!item.disabled;
            if (item.submenu) {
                b.classList.add('has-submenu');
                b.addEventListener('click', (e) => {
                    e.stopPropagation();
                    root.querySelectorAll('.wmd-dlg-pop').forEach((n) => { if (Number(n.dataset.level) > level) n.remove(); });
                    pop.querySelectorAll('.is-open').forEach((n) => n.classList.remove('is-open'));
                    if (b.classList.contains('is-open')) return;
                    b.classList.add('is-open');
                    const list = typeof item.submenu === 'function' ? item.submenu() : item.submenu;
                    openDialogPop(root, b, list.length ? list : [{ label: '(empty)', disabled: true }], level + 1, pop);
                });
            } else {
                b.addEventListener('click', (e) => {
                    e.stopPropagation();
                    closeDialogMenu();
                    if (typeof item.action === 'function') item.action();
                });
            }
            pop.appendChild(b);
        });
    }

    function openDialogPop(root, anchor, items, level, parentPop) {
        const pop = document.createElement('div');
        pop.className = 'wm-popup wmd-dlg-pop';
        pop.dataset.level = String(level);
        pop.setAttribute('role', 'menu');
        fillDialogMenu(root, pop, items, level);
        root.appendChild(pop);
        const box = root.getBoundingClientRect();
        const a = anchor.getBoundingClientRect();
        const w = pop.offsetWidth;
        const h = pop.offsetHeight;
        let left;
        let topY;
        if (!parentPop) {
            // under the control, at least its width
            pop.style.minWidth = `${Math.round(a.width)}px`;
            left = a.left;
            topY = a.bottom + h > window.innerHeight - 2 ? Math.max(2, a.top - h) : a.bottom;
        } else {
            // a submenu: to the left over its parent, its bottom on the row that opened it (wmShell)
            const pr = parentPop.getBoundingClientRect();
            left = pr.left + pr.width * 0.35 - w;
            if (left < 2) left = Math.min(pr.right - pr.width * 0.35, window.innerWidth - w - 2);
            topY = Math.max(2, Math.min(a.bottom - h, window.innerHeight - h - 2));
        }
        left = Math.max(2, Math.min(left, window.innerWidth - Math.max(w, pop.offsetWidth) - 2));
        pop.style.left = `${Math.round(left - box.left)}px`;
        pop.style.top = `${Math.round(topY - box.top)}px`;
        const on = pop.scrollHeight > pop.clientHeight && pop.querySelector(':scope > [aria-checked="true"]');
        if (on) pop.scrollTop = Math.max(0, on.offsetTop - (pop.clientHeight - on.offsetHeight) / 2);
        return pop;
    }

    function dialogMenu(root, anchor, items) {
        const again = dlgPop && dlgPop.anchor === anchor;
        closeDialogMenu();
        root.querySelectorAll('.wmd-dlg-pop').forEach((n) => n.remove()); // left by a box closed under it
        if (again) return; // a second tap on the control closes its list
        const outside = (e) => { if (!e.target.closest || (!e.target.closest('.wmd-dlg-pop') && !anchor.contains(e.target))) closeDialogMenu(); };
        const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); closeDialogMenu(); } };
        dlgPop = { root, anchor, outside, key };
        document.addEventListener('pointerdown', outside, true);
        document.addEventListener('keydown', key, true);
        openDialogPop(root, anchor, items, 0, null);
    }

    // ---------------------------------------------------------------- sessions list

    function sessionDate(d, s) {
        try {
            const when = d.formatSessionDate(s.archived ? (s.archived_at || s.updated_at || s.created_at) : (s.updated_at || s.created_at));
            return s.archived ? `Archived ${when}` : when;
        } catch (_) { return ''; }
    }

    function sessionRow(d, s, curId) {
        let thumb;
        if (d.persona !== 'xi') {
            let src = '';
            try { src = d.getSessionPreviewImage(s) || ''; } catch (_) { src = ''; }
            // no preview (a chat without prints, a deleted print): the Director's icon, as the desktop row's fallback
            thumb = src
                ? `<img class="wmd-session-thumb" src="${esc(src)}" data-file="${esc(s.filename || '')}" alt="" loading="lazy" decoding="async">`
                : '<img class="wmd-session-thumb is-icon" src="/static_images/app_icons/director.png" alt="">';
        } else {
            thumb = '<img class="wmd-session-thumb is-icon" src="/static_images/app_icons/director.png" alt="">';
        }
        const busy = d._running && d._runningSessionId === s.id;
        // the workspace the chat belongs to (the desktop row's colour dot): its colour and name
        let ws0 = null;
        try { ws0 = d.sessionWorkspaceMeta(s); } catch (_) { ws0 = null; }
        const wsTag = ws0 ? `<span class="wmd-session-ws"><i style="background:${esc(ws0.color)}"></i>${esc(ws0.name)}</span>` : '';
        return `<button type="button" class="wmd-session${String(s.id) === String(curId) ? ' is-current' : ''}" data-id="${esc(s.id)}">${thumb}<span class="wmd-session-text"><span class="wmd-session-name">${esc(s.name || 'Untitled')}</span><span class="wmd-session-date"><span>${busy ? 'Working... ' : ''}${esc(sessionDate(d, s))}</span>${wsTag}</span></span></button>`;
    }

    function renderSessions() {
        const d = dir();
        const t = stack.find((p) => p.kind === 'sessions');
        const list = t && t.el.querySelector('.wmd-sessions-list');
        if (!d || !list) return;
        const all = d.directorSessions || [];
        const curId = d.currentSession && d.currentSession.id;
        const active = all.filter((s) => !s.archived);
        const archived = all.filter((s) => s.archived);
        // the desktop list: the chats, then "Archives" and the archived ones
        list.innerHTML = active.map((s) => sessionRow(d, s, curId)).join('')
            + (archived.length ? `<div class="wmd-group">Archives</div>${archived.map((s) => sessionRow(d, s, curId)).join('')}` : '')
            || '<p class="wmd-empty">No sessions</p>';
        // the desktop row's fallback (the full picture while its preview is not written), then her icon
        list.querySelectorAll('img.wmd-session-thumb[data-file]').forEach((img) => {
            img.onerror = () => {
                /* global localGalleryImageUrl */
                const full = img.dataset.file && typeof localGalleryImageUrl === 'function' ? localGalleryImageUrl(img.dataset.file) : '';
                if (full && img.dataset.fullTried !== '1') { img.dataset.fullTried = '1'; img.src = full; return; }
                img.onerror = null;
                img.classList.add('is-icon');
                img.src = '/static_images/app_icons/director.png';
            };
        });
    }

    function sessionById(id) {
        const d = dir();
        return d && (d.directorSessions || []).find((x) => String(x.id) === String(id));
    }

    /** The desktop session row's menu (Fork, Move to workspace, Auto-Repair, Nuke, Delete) for a chat. */
    function sessionMenuRows(id) {
        const d = dir();
        if (!d || !d.directorSessionContextConfig || id == null) return [];
        // director.js finds the chat from the row the menu was raised on (sessionFromMenuTarget)
        const target = document.createElement('div');
        target.className = 'director-session-item';
        target.dataset.sessionId = String(id);
        return rowsOfConfig(d.directorSessionContextConfig, target);
    }

    async function showSessions() {
        const d = dir();
        if (!d) return;
        if (!stack.some((p) => p.kind === 'sessions')) {
            pushPage({
                kind: 'sessions',
                corner: 'close',
                title: () => `${personaName(dir() && dir().persona)}: Sessions`,
                render(el) {
                    el.innerHTML = '<div class="wmd-sessions-list" role="list"></div>';
                    const list = el.firstChild;
                    list.addEventListener('click', (e) => {
                        const row = e.target.closest('.wmd-session');
                        if (row) void openSession(row.dataset.id);
                    });
                    onHold(list, '.wmd-session', (row, x, y) => {
                        const id = row.dataset.id;
                        ws.menuAt(x, y, [{ label: 'Open', action: () => { void openSession(id); } }, '-', ...sessionMenuRows(id)]);
                    });
                },
                keys: () => ({ left: { label: 'Cancel', action: () => closePages('sessions') }, right: { label: 'Menu', menu: sessionsMenu } })
            });
        }
        renderSessions();
        try { await busyOf(() => d.loadDirectorSessions()); } catch (_) { /* keep what is listed */ }
        renderSessions();
    }

    /**
     * showSessionChat resolves once it has asked for the chat's messages; they arrive later
     * (director_get_messages_response) and render ~16 ms after that: the wait cursor lasts until then
     * (it was gone ~0.5 s before the rows were built at 4x throttle, #723).
     */
    function messagesArrived(id, ms = 10000) {
        const wc = window.wsClient;
        if (!wc || typeof wc.on !== 'function' || typeof wc.off !== 'function' || (typeof wc.isConnected === 'function' && !wc.isConnected())) return Promise.resolve();
        return new Promise((resolve) => {
            let timer = null;
            let over = false;
            // off() after the dispatch loop: removing a handler while it runs would skip the next one
            const done = () => { if (over) return; over = true; clearTimeout(timer); setTimeout(() => { wc.off('director_get_messages_response', on); resolve(); }, 40); };
            const on = (data) => { const b = data && data.data; if (!b || String(b.sessionId) === String(id)) done(); };
            timer = setTimeout(done, ms);
            wc.on('director_get_messages_response', on);
        });
    }

    async function openSession(id) {
        const d = dir();
        const s = sessionById(id);
        if (!s) return;
        while (stack.length) popPage();
        try {
            await busyOf(() => {
                const arrived = messagesArrived(s.id);
                return Promise.resolve(d.showSessionChat(s)).then(() => arrived);
            });
        } catch (err) { console.warn('[wmDirector] open session', err); }
        syncComposer();
        ws.refreshSoftKeys();
    }

    async function newSession() {
        const d = dir();
        if (!d) return;
        while (stack.length) popPage();
        try { await busyOf(() => d.openNewSession()); } catch (err) { console.warn('[wmDirector] new session', err); }
        openComposer();
    }

    async function switchPersona(p) {
        const d = dir();
        if (!d || d.persona === p) return;
        if (composing) closeComposer();
        // pages of the other persona's chat (prints, history) do not carry over; Sessions does
        while (stack.length && top().kind !== 'sessions') popPage();
        try { await busyOf(() => d.setPersona(p)); } catch (err) { console.warn('[wmDirector] persona', err); }
        syncComposer();
        if (top() && top().kind === 'sessions') { renderSessions(); try { await d.loadDirectorSessions(); } catch (_) { /* best effort */ } renderSessions(); }
        refreshTitle();
        ws.refreshSoftKeys();
    }

    function personaItems() {
        const d = dir();
        if (!d) return [];
        const items = [{ label: personaName('wren'), radio: d.persona === 'wren', action: () => switchPersona('wren') }];
        if (d.kabukiAvailable() || d.persona === 'kabuki') items.push({ label: personaName('kabuki'), radio: d.persona === 'kabuki', action: () => switchPersona('kabuki') });
        if (d._xiEnabled === true) items.push({ label: personaName('xi'), radio: d.persona === 'xi', action: () => switchPersona('xi') });
        return items;
    }

    // ---------------------------------------------------------------- Prints (the desktop's prints pane)

    function thumbSrc(d, filename) {
        try { return d.getSessionPreviewImage({ filename, image_type: 'generated' }) || ''; } catch (_) { return ''; }
    }

    function printMenuRows(filename, messageId) {
        const d = dir();
        // the desktop print's menu (director.js wirePrintMenu): Open, Show on message, Attach, Recycle
        return [
            { label: 'Open', action: () => d.openSessionImage(filename) },
            { label: 'Show on Message', disabled: !messageId, action: () => showOnMessage(messageId) },
            { label: 'Attach to Message', action: () => attachPrint(filename) },
            '-',
            { label: 'Recycle Session...', disabled: !!d._running, action: () => { void d.recycleSession(filename); } }
        ];
    }

    function attachPrint(filename) {
        const d = dir();
        while (stack.length) popPage();
        d.attachPrintToComposer(filename);
        openComposer();
    }

    /** Show on message: the log opens on the row that made the print. */
    function showOnMessage(messageId) {
        const d = dir();
        while (stack.length) popPage();
        const m = d.mascot;
        if (m && m.vnBubbles() && !m.peek) m.togglePeek(true);
        const node = d.directorChatMessages && d.directorChatMessages.querySelector(`[data-message-key="${CSS.escape(String(messageId))}"]`);
        if (node) { d.revealDirectorRow(node); d.markPrintMessage(messageId, true); setTimeout(() => d.markPrintMessage(messageId, false), 2400); }
        after();
    }

    /** Thumbnails fall back to the full picture while the preview webp is not written, then hide. */
    function thumbFallback(root) {
        root.querySelectorAll('img[data-file]').forEach((img) => {
            if (img._wmdFallback) return;
            img._wmdFallback = true;
            img.addEventListener('error', () => {
                /* global localGalleryImageUrl */
                const full = typeof localGalleryImageUrl === 'function' ? localGalleryImageUrl(img.dataset.file) : '';
                // no picture at all (a deleted print): the tile goes, not an empty frame
                if (img.dataset.fullTried === '1' || !full) { const tile = img.closest('.wmd-thumb'); if (tile) tile.hidden = true; return; }
                img.dataset.fullTried = '1';
                img.src = full;
            });
        });
    }

    function sessionPrintList(d) {
        if (!d || d.persona === 'xi' || !d.currentSession || isDraft(d)) return [];
        try { return d.sessionPrints().slice().reverse(); } catch (_) { return []; }
    }

    /**
     * The desktop's prints sidebar on a phone: a strip under her text box (portrait), or the column
     * beside her scene on a wide screen (instead of the log, which stays under Menu > Log). Newest
     * first; tap views, hold for the print's menu.
     */
    let printsKey = '';
    function paintPrints() {
        if (!page) return;
        const d = dir();
        const p = prefs();
        const m = d && d.mascot;
        const vn = !!(m && typeof m.vnBubbles === 'function' && m.vnBubbles() && m.host && page.contains(m.host));
        const items = sessionPrintList(d);
        const pending = !!(d && d._imagePending === true && d.currentSession && !isDraft(d));
        // only her on wide screens: the wide rules stand down (wm-director.css), so the layout is read again
        if (page.classList.contains('wmd-solo') !== !!p.wideSolo) {
            page.classList.toggle('wmd-solo', !!p.wideSolo);
            recheckLayout();
        }
        page.classList.toggle('wmd-vn', vn);
        page.classList.toggle('wmd-strip-on', vn && p.printStrip && (items.length > 0 || pending));
        page.classList.toggle('wmd-gallery-on', vn && !p.wideLog && !!(d && d.persona !== 'xi'));
        paintFiles();
        const sid = d && d.currentSession ? String(d.currentSession.id) : '';
        const key = `${sid}|${pending ? 1 : 0}|${items.map((x) => x.filename).join('|')}`;
        if (key === printsKey) return;
        printsKey = key;
        const tiles = (pending ? '<span class="wmd-thumb is-pending" aria-label="Waiting for the print"></span>' : '')
            + items.map((x) => `<button type="button" class="wmd-thumb" data-file="${esc(x.filename)}" data-msg="${esc(x.messageId || '')}"><img data-file="${esc(x.filename)}" src="${esc(thumbSrc(d, x.filename))}" alt="" loading="lazy" decoding="async"></button>`).join('');
        const strip = page.querySelector('.wmd-strip');
        if (strip) { strip.innerHTML = tiles; strip.scrollLeft = 0; thumbFallback(strip); }
        const gal = d && d.directorSessionChat ? d.directorSessionChat.querySelector('.wmd-gallery') : null;
        if (gal) {
            gal.querySelector('.wmd-gallery-hdr').textContent = items.length ? `Prints (${items.length})` : 'Prints';
            const grid = gal.querySelector('.wmd-gallery-grid');
            grid.innerHTML = tiles || '<p class="wmd-empty">No prints in this session yet.</p>';
            grid.scrollTop = 0;
            thumbFallback(grid);
        }
        if (m && m._result) m.settleLayout(300);
    }

    /** Tap views a thumbnail, hold opens its menu (the desktop print's menu). */
    function wireThumbs(root) {
        root.addEventListener('click', (e) => {
            const b = e.target.closest && e.target.closest('.wmd-thumb[data-file]');
            if (!b) return;
            e.stopPropagation();
            const d = dir();
            if (d) d.openSessionImage(b.dataset.file);
        });
        onHold(root, '.wmd-thumb[data-file]', (b, x, y) => ws.menuAt(x, y, printMenuRows(b.dataset.file, b.dataset.msg)));
    }

    /** The gallery column lives in her chat's grid (wide screens), beside the log it stands in for. */
    function ensureGallery(d) {
        const chat = d && d.directorSessionChat;
        if (!chat || chat.querySelector(':scope > .wmd-gallery')) return;
        const gal = document.createElement('div');
        gal.className = 'wmd-gallery';
        gal.innerHTML = '<div class="wmd-gallery-hdr">Prints</div><div class="wmd-gallery-grid"></div>';
        wireThumbs(gal);
        chat.appendChild(gal);
        printsKey = '';
    }

    /** The dock (choices, prints strip) rides in her chat too: it takes the persona's accent (--dm-*). */
    function ensureDock(d) {
        const chat = d && d.directorSessionChat;
        const dock = page && page.querySelector('.wmd-dock');
        if (chat && dock && dock.parentNode !== chat) chat.appendChild(dock);
        // the next-reply choices leave the text box for the dock (thumb reach, no scroll inside the box);
        // director.js wires each button itself, directorMascot.js fills and clears the node wherever it is
        const m = d.mascot;
        const choices = dock && dock.querySelector('.wmd-choices');
        if (choices && m && m.el && m.el.dialogSuggest && m.el.dialogSuggest.parentNode !== choices) {
            choices.appendChild(m.el.dialogSuggest);
            if (m._result) m.placeResult();
        }
    }

    /** Wide screens: Menu > Log puts the log in the column instead of the prints gallery. */
    let logCol = false;
    function setLogCol(on) {
        logCol = !!on;
        if (page) page.classList.toggle('wmd-log-col', logCol);
        const d = dir();
        if (logCol && d && d.directorChatMessages) {
            const scroller = d.directorChatMessages.closest('.director-chat-messages-container');
            if (scroller) setTimeout(() => { scroller.scrollTop = scroller.scrollHeight; }, 0);
        }
        after();
    }
    const galleryMode = () => layout === 'wide' && !!page && page.classList.contains('wmd-gallery-on');

    function renderPrints(el) {
        const d = dir();
        el.dataset.session = d.currentSession ? String(d.currentSession.id) : '';
        const prints = d.sessionPrints().slice().reverse();
        const pending = d._imagePending === true;
        el.innerHTML = `<div class="wmd-prints-grid">${pending ? '<div class="wmd-print is-pending" aria-label="Waiting for the print"></div>' : ''}${prints.map((p) => `<button type="button" class="wmd-print" data-file="${esc(p.filename)}" data-msg="${esc(p.messageId || '')}"><img src="${esc(thumbSrc(d, p.filename))}" alt="" loading="lazy" decoding="async"></button>`).join('')}</div>`
            + (prints.length || pending ? '' : '<p class="wmd-empty">No prints in this session</p>');
        // the preview webp is written after the print: the full file until then (the desktop's fallback)
        el.querySelectorAll('.wmd-print img').forEach((img) => {
            img.addEventListener('error', () => {
                const name = img.parentNode.dataset.file;
                /* global localGalleryImageUrl */
                const full = typeof localGalleryImageUrl === 'function' ? localGalleryImageUrl(name) : '';
                if (img.dataset.fullTried === '1' || !full) { img.style.visibility = 'hidden'; return; }
                img.dataset.fullTried = '1';
                img.src = full;
            }, { once: false });
        });
    }

    function showPrints() {
        const d = dir();
        if (!d || !d.currentSession || d.persona === 'xi') return;
        closePages('prints');
        pushPage({
            kind: 'prints',
            corner: 'ok',
            title: 'Prints',
            render(el) {
                renderPrints(el);
                el.addEventListener('click', (e) => {
                    const b = e.target.closest('.wmd-print[data-file]');
                    if (b) dir().openSessionImage(b.dataset.file);
                });
                onHold(el, '.wmd-print[data-file]', (b, x, y) => ws.menuAt(x, y, printMenuRows(b.dataset.file, b.dataset.msg)));
            },
            keys: () => ({ left: null, right: { label: 'Menu', menu: () => [{ label: 'Refresh', action: () => { const p = stack.find((x) => x.kind === 'prints'); if (p) renderPrints(p.el); } }] } })
        });
    }

    // ---------------------------------------------------------------- Changes (Yozora, #744)

    /**
     * Yozora (xi) is the coding agent: where the prompt engineers show prints, she shows the files she
     * edited. The rows are her last turn's Edit / Write tool calls (message.trace, diffKind 'diff'); what
     * each one changed comes from its stored payload (director_tool_payload: the tool's arguments), read
     * once and kept. Nothing here asks the agent anything.
     *   dock    .wmd-files under her choices: one tag per file with its added / removed line counts
     *   page    Changes (Menu > Changes, or a tag): one file's edits as removed and added lines
     *   HUD     the second counter reads "files"
     */
    const changeCache = new Map();
    let filesKey = null;
    let filesSeq = 0;
    let filesCount = null;

    function editRows(d) {
        const s = d && d.currentSession;
        const ms = s && Array.isArray(s.messages) ? s.messages : [];
        let from = 0;
        for (let i = ms.length - 1; i >= 0; i--) {
            if (ms[i] && ms[i].role === 'user' && ms[i].message_type !== 'Attachment') { from = i; break; }
        }
        const rows = [];
        const seen = new Set();
        for (let i = from; i < ms.length; i++) {
            const t = ms[i] && Array.isArray(ms[i].trace) ? ms[i].trace : [];
            t.forEach((r) => {
                const id = r && r.type === 'tool' && r.diffKind === 'diff' ? (r.payloadId || r.diffId) : '';
                if (!id || seen.has(id)) return;
                seen.add(id);
                rows.push(r);
            });
        }
        return rows.slice(-80);
    }

    const textLines = (v) => (typeof v === 'string' && v !== '' ? v.replace(/\n$/, '').split('\n') : []);

    /** A unified diff's body as [kind, text] lines: '' context, 'a' added, 'd' removed, 'h' a hunk break. */
    function diffLines(text) {
        const out = [];
        String(text || '').split('\n').forEach((l) => {
            if (/^(\+\+\+ |--- |diff --git |index |\\ No newline)/.test(l)) return;
            if (l.startsWith('@@')) { if (out.length) out.push(['h', '']); return; }
            if (l[0] === '+') out.push(['a', l.slice(1)]);
            else if (l[0] === '-') out.push(['d', l.slice(1)]);
            else out.push(['', l.slice(1)]);
        });
        while (out.length && out[out.length - 1][0] === '' && out[out.length - 1][1] === '') out.pop();
        return out;
    }

    /** A JSON string value that may have been stored cut off: what can still be read of it. */
    function looseString(text, key) {
        const m = new RegExp(`"${key}"\\s*:\\s*"`).exec(text);
        if (!m) return null;
        let body = text.slice(m.index + m[0].length);
        const end = /(?:^|[^\\])(?:\\\\)*"/.exec(body);
        body = end ? body.slice(0, end.index + end[0].length - 1) : body.replace(/…$/, '').replace(/\\(u[0-9a-fA-F]{0,3})?$/, '');
        try { return JSON.parse(`"${body}"`); } catch (_) { return null; }
    }

    /**
     * One edit as { file, add, del, lines, cut }. Claude's tools carry the old and new text in their
     * arguments (old_string / new_string, content); Cursor's carry a unified diff in the result
     * (diffString, linesAdded, linesRemoved). Either may have been stored cut off at 4,000 characters.
     */
    function parseChange(row, argsText, resultText) {
        const none = (file, cut) => ({ file: file || (row && row.detail && /^[/~.\w]/.test(row.detail) && !/\s/.test(row.detail) ? row.detail : ''), add: 0, del: 0, lines: [], cut });
        const name = row && row.name;
        const args = String(argsText || '');
        const result = String(resultText || '');
        let a = null;
        try { a = JSON.parse(args); } catch (_) { /* stored cut off */ }
        const pick = (...keys) => { for (const k of keys) { if (a && typeof a[k] === 'string') return a[k]; } return null; };
        let file = pick('file_path', 'path', 'target_file', 'filePath', 'relative_workspace_path')
            || looseString(args, 'file_path') || looseString(args, 'path') || looseString(args, 'target_file') || '';
        // Cursor: the diff it reports
        let r = null;
        try { r = JSON.parse(result); } catch (_) { /* stored cut off, or plain text */ }
        const diff = (r && typeof r.diffString === 'string' ? r.diffString : null) || (result.includes('"diffString"') ? looseString(result, 'diffString') : null);
        if (diff) {
            const lines = diffLines(diff);
            const num = (k) => (r && Number.isFinite(r[k]) ? r[k] : Number((new RegExp(`"${k}"\\s*:\\s*(\\d+)`).exec(result) || [])[1]));
            const add = num('linesAdded');
            const del = num('linesRemoved');
            const shownAdd = lines.filter((l) => l[0] === 'a').length;
            const shownDel = lines.filter((l) => l[0] === 'd').length;
            return {
                file: file || (r && r.path) || none('', false).file,
                add: Number.isFinite(add) ? add : shownAdd,
                del: Number.isFinite(del) ? del : shownDel,
                lines,
                // a result stored cut off: say so only when changed lines are missing from it
                cut: !r && (!Number.isFinite(add) || !Number.isFinite(del) || shownAdd < add || shownDel < del)
            };
        }
        if (!a) return none(file, true);
        let del = textLines(pick('old_string', 'old_str', 'oldString', 'old_text'));
        let add = name === 'Delete' ? [] : textLines(pick('new_string', 'new_str', 'newString', 'new_text', 'content', 'contents', 'file_text', 'streamContent'));
        const patch = pick('patch', 'input');
        if (patch && !del.length && !add.length) {
            const m = /^\*\*\* (?:Update|Add|Delete) File: (.+)$/m.exec(patch);
            if (m && !file) file = m[1].trim();
            const lines = diffLines(patch.split('\n').filter((l) => !l.startsWith('***')).join('\n'));
            return { file, add: lines.filter((l) => l[0] === 'a').length, del: lines.filter((l) => l[0] === 'd').length, lines, cut: false };
        }
        // the lines both sides share at the ends are context, not change
        let head = 0;
        while (head < del.length && head < add.length && del[head] === add[head]) head++;
        let tail = 0;
        while (tail < del.length - head && tail < add.length - head && del[del.length - 1 - tail] === add[add.length - 1 - tail]) tail++;
        const ctx = del.slice(Math.max(0, head - 2), head);
        const after = tail ? del.slice(del.length - tail, del.length - tail + 2) : [];
        del = del.slice(head, del.length - tail);
        add = add.slice(head, add.length - tail);
        const tag = (k) => (t) => [k, t];
        return { file: file || none('', false).file, add: add.length, del: del.length, lines: [...ctx.map(tag('')), ...del.map(tag('d')), ...add.map(tag('a')), ...after.map(tag(''))], cut: false };
    }

    /** The files of her last turn's edits: [{ file, name, add, del, hunks }], in the order she touched them. */
    async function loadChanges(d) {
        const sid = d && d.currentSession && d.currentSession.id;
        if (!sid) return [];
        const rows = editRows(d);
        const one = async (r) => {
            const id = `${sid}|${r.payloadId || r.diffId}`;
            if (changeCache.has(id)) return changeCache.get(id);
            let c;
            try {
                const p = await d.directorRequest('director_tool_payload', { sessionId: sid, payloadId: r.payloadId || r.diffId, diffId: r.diffId || '' });
                c = parseChange(r, p && p.args, p && p.result);
                changeCache.set(id, c);
            } catch (_) {
                c = { file: '', add: 0, del: 0, lines: [], cut: true };
            }
            return c;
        };
        const out = [];
        for (let i = 0; i < rows.length; i += 8) out.push(...await Promise.all(rows.slice(i, i + 8).map(one)));
        const files = new Map();
        out.forEach((c) => {
            const k = c.file || '(unknown file)';
            if (!files.has(k)) files.set(k, { file: k, name: k.split('/').pop(), add: 0, del: 0, hunks: [] });
            const f = files.get(k);
            f.add += c.add;
            f.del += c.del;
            f.hunks.push(c);
        });
        return [...files.values()];
    }

    const fileTag = (f, on) => `<button type="button" class="wmd-file${on ? ' is-on' : ''}" data-file="${esc(f.file)}">${esc(f.name)}`
        + `${f.add ? ` <i class="wmd-add">+${f.add}</i>` : ''}${f.del ? ` <i class="wmd-del">−${f.del}</i>` : ''}</button>`;

    /** The HUD's second counter: her files this turn (directorMascot.js writes the prints count there). */
    function paintFilesHud(d) {
        const b = page && page.querySelector('.dm-hud [data-hud="prints"]');
        const label = b && b.parentNode ? b.parentNode.querySelector('span') : null;
        if (!b || !label) return;
        const xi = !!(d && d.persona === 'xi');
        const want = xi ? 'files' : 'prints';
        if (label.textContent !== want) label.textContent = want;
        if (xi && filesCount != null && b.textContent !== String(filesCount)) b.textContent = String(filesCount);
    }

    function paintFiles() {
        if (!page) return;
        const d = dir();
        const dock = page.querySelector('.wmd-dock');
        if (!d || !dock) return;
        const on = d.persona === 'xi' && !!d.currentSession && !isDraft(d);
        const rows = on ? editRows(d) : [];
        const key = on ? `${d.currentSession.id}|${rows.map((r) => r.payloadId || r.diffId).join(',')}` : '';
        if (key !== filesKey) {
            filesKey = key;
            const seq = ++filesSeq;
            let bar = dock.querySelector('.wmd-files');
            if (!bar) {
                bar = document.createElement('div');
                bar.className = 'wmd-files';
                dock.appendChild(bar);
                bar.addEventListener('click', (e) => {
                    const b = e.target.closest('.wmd-file[data-file]');
                    if (b) void showChanges(b.dataset.file);
                });
            }
            const settle = () => { if (d.mascot && d.mascot._result) d.mascot.settleLayout(300); };
            if (!on) closePages('changes');
            if (!rows.length) {
                filesCount = on ? 0 : null;
                if (bar.innerHTML) { bar.innerHTML = ''; settle(); }
            } else {
                void loadChanges(d).then((files) => {
                    if (seq !== filesSeq) return;
                    filesCount = files.length;
                    bar.innerHTML = files.map((f) => fileTag(f, false)).join('');
                    paintFilesHud(d);
                    settle();
                });
            }
        }
        paintFilesHud(d);
    }

    const CHANGE_LINES = 600;
    const MARK = { a: '+', d: '−' };
    function hunkHtml(h) {
        const rows = h.lines.slice(0, CHANGE_LINES).map(([k, t]) => (k === 'h' ? '<div class="wmd-ch-gap"></div>'
            : `<div class="wmd-l ${k}"><u>${MARK[k] || ' '}</u>${esc(t) || ' '}</div>`)).join('');
        return rows
            + (h.lines.length > CHANGE_LINES ? `<div class="wmd-l n">(${h.lines.length - CHANGE_LINES} more lines)</div>` : '')
            + (h.cut ? `<div class="wmd-l n">${h.lines.length ? '(the rest of this change was not kept)' : '(this change is too large to show)'}</div>` : '');
    }

    const changeText = (f) => `${f.file}\n\n` + f.hunks.map((h) => h.lines.map(([k, t]) => (k === 'h' ? '' : `${k === 'a' ? '+' : k === 'd' ? '-' : ' '}${t}`)).join('\n')).join('\n\n');

    async function showChanges(file) {
        const d = dir();
        if (!d || !d.currentSession || d.persona !== 'xi') return;
        let files = [];
        try { files = await busyOf(() => loadChanges(d)); } catch (err) { console.warn('[wmDirector] changes', err); }
        if (!files.length) return;
        let cur = files.find((f) => f.file === file) || files[0];
        const draw = (el) => {
            el.innerHTML = `<div class="wmd-ch-hdr"><b>${esc(cur.name)}</b><span>${cur.add ? `<i class="wmd-add">+${cur.add}</i>` : ''}${cur.del ? ` <i class="wmd-del">−${cur.del}</i>` : ''}</span></div>`
                + `<div class="wmd-ch-path">${esc(cur.file)}</div>`
                + `<div class="wmd-ch-body"><div class="wmd-ch-lines">${cur.hunks.map(hunkHtml).join('<div class="wmd-ch-gap"></div>')}</div></div>`
                + (files.length > 1 ? `<div class="wmd-ch-files">${files.map((f) => fileTag(f, f === cur)).join('')}</div>` : '');
        };
        closePages('changes');
        pushPage({
            kind: 'changes',
            corner: 'ok',
            title: 'Changes',
            render(el) {
                draw(el);
                el.addEventListener('click', (e) => {
                    const b = e.target.closest('.wmd-file[data-file]');
                    const f = b && files.find((x) => x.file === b.dataset.file);
                    if (f && f !== cur) { cur = f; draw(el); }
                });
            },
            keys: () => ({ left: { label: 'Copy', action: () => copyText(changeText(cur), 'Change') }, right: null })
        });
    }

    // ---------------------------------------------------------------- History (Open Full History)

    function showHistory() {
        const d = dir();
        if (!d || !d.currentSession) return;
        const entries = d.historyEntries();
        let selected = Math.max(0, entries.length - 1);
        for (let i = entries.length - 1; i >= 0; i--) { if (entries[i].kind === 'Thinking') { selected = i; break; } }
        closePages('history');
        pushPage({
            kind: 'history',
            corner: 'ok',
            title: () => (dir() && dir().currentSession && dir().currentSession.name) || 'History',
            render(el) {
                el.innerHTML = `<div class="wm-form-hdr">History</div><div class="wmd-history-list" role="list">${entries.map((e, i) => {
                    const line = e.text.replace(/\s+/g, ' ').trim();
                    return `<button type="button" class="wmd-history-row${i === selected ? ' is-current' : ''}" data-i="${i}"><b>${esc(e.kind)}</b><span>${esc(line.length > 120 ? `${line.slice(0, 117)}...` : line)}</span></button>`;
                }).join('') || '<p class="wmd-empty">This chat has no messages yet.</p>'}</div>`;
                const list = el.querySelector('.wmd-history-list');
                list.addEventListener('click', (e) => {
                    const row = e.target.closest('.wmd-history-row');
                    if (!row) return;
                    list.querySelectorAll('.is-current').forEach((n) => n.classList.remove('is-current'));
                    row.classList.add('is-current');
                    const entry = entries[Number(row.dataset.i)];
                    if (entry) showText(entry.kind, entry.text, '');
                });
                const cur = list.querySelector('.is-current');
                if (cur) setTimeout(() => cur.scrollIntoView({ block: 'center' }), 0);
            },
            keys: () => ({
                left: { label: 'View', disabled: !entries.length, action: () => { const p = top(); const row = p && p.el.querySelector('.wmd-history-row.is-current'); if (row) row.click(); } },
                right: null
            })
        });
    }

    // ---------------------------------------------------------------- Browser (the desktop's browser pane)

    function browserShown(d) {
        const pane = d && d.directorBrowserPane;
        return !!(pane && !pane.classList.contains('hidden') && d.directorBrowserPreview && d.directorBrowserPreview.getAttribute('src'));
    }

    function showBrowser() {
        const d = dir();
        if (!browserShown(d)) return;
        closePages('browser');
        pushPage({
            kind: 'browser',
            corner: 'ok',
            title: 'Browser',
            render(el) {
                el.innerHTML = '<div class="wmd-browser"><img alt=""></div>';
                const img = el.querySelector('img');
                img.src = d.directorBrowserPreview.getAttribute('src');
                // the next shot of the page while it is open (director.js swaps the pane's src)
                const mo = new MutationObserver(() => { const src = d.directorBrowserPreview.getAttribute('src'); if (src) img.src = src; });
                mo.observe(d.directorBrowserPreview, { attributes: true, attributeFilter: ['src'] });
                el._mo = mo;
            },
            keys: () => ({ left: null, right: null }),
            onClose() { if (this.el && this.el._mo) this.el._mo.disconnect(); }
        });
    }

    // ---------------------------------------------------------------- text (showDirectorText) and the inspector

    function copyText(text, what) {
        const done = () => { if (ws && ws.bubble) ws.bubble({ title: 'Director', sections: [{ text: `${what} copied.` }] }); };
        try { navigator.clipboard.writeText(text).then(done, () => {}); } catch (_) { /* no clipboard */ }
    }

    /** The desktop's read-only text window (cleanup output, a change, a history entry) as a WM page. */
    function showText(title, text, status) {
        pushPage({
            kind: 'text',
            corner: 'ok',
            title: 'Director',
            render(el) {
                el.innerHTML = `<div class="wm-form-hdr"></div><pre class="wmd-text"></pre>${status ? '<div class="wmd-text-status"></div>' : ''}`;
                el.querySelector('.wm-form-hdr').textContent = title || '';
                el.querySelector('.wmd-text').textContent = text || '(empty)';
                if (status) el.querySelector('.wmd-text-status').textContent = status;
            },
            keys: () => ({ left: { label: 'Copy', action: () => copyText(text || '', 'Text') }, right: null })
        });
    }

    /**
     * The tool inspector (directorToolInspector.js, a Vista window on the desktop): its own window is
     * moved into a page here and drawn as a WM page (header, Input / Output / Raw as WM's tabs at the
     * bottom, Copy on the left soft key, ok closes), so its renderer stays one.
     */
    function hostInspector() {
        const modal = document.getElementById('directorToolInspector');
        if (!modal) return;
        const title = modal.querySelector('.modal-window-title-main span');
        const existing = stack.find((p) => p.kind === 'inspector');
        if (existing) {
            while (top() !== existing) popPage();
            existing.el.appendChild(modal);
            refreshTitle();
            return;
        }
        pushPage({
            kind: 'inspector',
            corner: 'ok',
            title: () => ((title && title.textContent) || 'Tool').replace(/ - Inspector$/, ''),
            render(el) { el.appendChild(modal); },
            keys: () => ({
                left: { label: 'Copy', action: () => { const b = modal.querySelector('[data-action="copy"]'); if (b) b.click(); } },
                right: null
            }),
            onClose() {
                document.body.appendChild(modal);
                // closeModal: public/scripts/comp/modalUtils.js
                if (typeof closeModal === 'function') closeModal(modal);
                else modal.classList.add('hidden');
            }
        });
    }

    let patchedInspector = null;
    function patchInspector() {
        const insp = window.DirectorToolInspector;
        if (!insp || patchedInspector === insp || typeof insp.open !== 'function') return;
        patchedInspector = insp;
        const open = insp.open;
        insp.open = function (payload) {
            const r = open.call(this, payload);
            if (shown && isCurrent()) hostInspector();
            else void handOff(() => hostInspector());
            return r;
        };
    }

    /** director.js's desktop windows, on this instance: as pages of this app (one renderer each where it has one). */
    function patchWindows(d) {
        if (d._wmDirectorWindows) return;
        d._wmDirectorWindows = true;
        // raised from elsewhere (the Director docked in another view): the app comes up over it first
        const inApp = (fn) => { if (shown && isCurrent()) fn(); else void handOff(() => fn()); };
        d.openFullHistory = function () { inApp(showHistory); };
        d.showDirectorText = function (title, text, status) { inApp(() => showText(title, text, status)); };
        // Director Settings: Settings > Dreamscape > Director (wmSettingsDreamscape.js: the same messages)
        d.openDirectorSettings = async function () {
            if (window.wmSettings && typeof window.wmSettings.open === 'function') window.wmSettings.open('director', 'new', { direct: true });
        };
        d.togglePrintsPane = function () { inApp(showPrints); };
        // the log hidden behind her scene is not laid out (wm-director.css content-visibility): a
        // scroll to the bottom there would lay all its rows out (~270 ms a call at 4x, #723). Menu > Log
        // scrolls to the bottom when it opens (directorMascot.js togglePeek)
        if (typeof d.scrollToBottom === 'function') {
            const scrollToBottom = d.scrollToBottom;
            d.scrollToBottom = function () {
                const chat = this.directorSessionChat;
                if (chat && page && page.contains(chat) && chat.classList.contains('director-mascot-view') && chat.classList.contains('dm-log-hidden') && !chat.classList.contains('dm-log-peek')) return;
                return scrollToBottom.apply(this, arguments);
            };
        }
        // the queued messages (the desktop's chip in its always-visible composer) also show over her scene
        const queueChip = d.renderQueueChip;
        if (typeof queueChip === 'function') {
            d.renderQueueChip = function (...args) {
                const r = queueChip.apply(this, args);
                paintQueue();
                return r;
            };
        }
        // the inspector is loaded on first use: wrap it once it is there
        const payload = d.openToolPayload;
        d.openToolPayload = async function (row) {
            if (!window.DirectorToolInspector && typeof featureLoader !== 'undefined') {
                /* global featureLoader */
                try { await busyOf(() => featureLoader.loadFeature('director_tool_inspector')); } catch (_) { /* director.js falls back */ }
            }
            patchInspector();
            return busyOf(() => payload.call(this, row));
        };
    }

    // ---------------------------------------------------------------- queued messages

    function queuedRows(d) {
        const id = d && d.currentSession && d.currentSession.id;
        try { return id && typeof d.queuedForSession === 'function' ? d.queuedForSession(id) : []; } catch (_) { return []; }
    }

    /** Clear: the desktop chip's own remove button (director.js renderQueueChip), one code path. */
    function clearQueue() {
        const btn = document.querySelector('#directorAttachChips [data-queue-chip] button');
        if (btn) btn.click();
        paintQueue();
        after();
    }

    /**
     * Messages written while she works wait for the turn to end (director.js's queue). The desktop shows
     * them as a chip in its composer, which is always on screen; on the phone the composer is closed
     * most of the time, so a WM label over her scene says so (tap: its menu).
     */
    function paintQueue() {
        if (!page) return;
        const d = dir();
        const rows = queuedRows(d);
        let el = page.querySelector('.wmd-queue');
        if (!rows.length) { if (el) el.hidden = true; return; }
        if (!el) {
            el = document.createElement('button');
            el.type = 'button';
            el.className = 'wmd-queue';
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                const r = el.getBoundingClientRect();
                ws.menuAt(r.left, r.bottom, [{ label: 'Clear Queued Messages', action: clearQueue }]);
            });
            page.appendChild(el);
        }
        const first = String((rows[0] && rows[0].content) || '').replace(/\s+/g, ' ').trim();
        el.textContent = rows.length === 1 ? `Queued: ${first || '1 message'}` : `Queued: ${rows.length} messages`;
        el.title = 'Sends when this turn finishes';
        el.hidden = false;
    }

    // ---------------------------------------------------------------- menus

    /** The desktop tools menu's rows by their text (director.js toolsMenuConfig: one source). */
    function toolRows(texts) {
        const d = dir();
        const cfg = d.toolsMenuConfig();
        const all = (cfg.sections && cfg.sections[0] && cfg.sections[0].items) || [];
        const run = (action) => cfg.onAction(action);
        const list = texts.map((t) => all.find((i) => i && i.text === t)).filter(Boolean);
        return wmRows(list, null, run);
    }

    function infoLine(d) {
        const parts = [];
        try { parts.push(d.persona === 'xi' ? d.engineName(d.displayEngine()) : d.selectedModelName()); } catch (_) { /* none */ }
        const ctx = document.getElementById('directorContextPercent');
        const ctxText = ctx && ctx.closest('.hidden') == null ? ctx.textContent.trim() : '';
        if (ctxText && ctxText !== '—') parts.push(`Context ${ctxText}`);
        const usage = document.getElementById('directorUsageAuto');
        const usageText = usage && usage.closest('.hidden') == null ? usage.textContent.trim() : '';
        if (usageText && usageText !== '—') parts.push(usageText);
        return parts.filter(Boolean).join(' · ');
    }

    function optionsItems() {
        const d = dir();
        const m = d && d.mascot;
        if (!d) return [{ label: 'No options', disabled: true }];
        const cfg = d.toolsMenuConfig();
        const run = (action) => cfg.onAction(action);
        const items = [];
        const info = infoLine(d);
        if (info) items.push({ label: info, disabled: true }, '-');
        if (m) {
            items.push(
                { label: 'Visual Novel', radio: m.view === 'mascot', action: () => { unpeek(m); m.setView('mascot'); if (d.currentSession) m.onMessages(d.currentSession.messages || []); after(); } },
                { label: 'Messages', radio: m.view !== 'mascot', action: () => { unpeek(m); m.setView('messages'); after(); } },
                '-',
                { label: 'Show Mascot', checked: !!m.enabled, action: () => { unpeek(m); m.setEnabled(!m.enabled); after(); } }
            );
        }
        const p = prefs();
        items.push('-',
            { label: 'Prints Strip', checked: !!p.printStrip, disabled: layout === 'wide' && !p.wideLog, action: () => { setPrefs({ printStrip: !p.printStrip }); paintPrints(); after(); } },
            { label: 'Log Beside Her (wide screens)', checked: !!p.wideLog, disabled: !!p.wideSolo, action: () => { setPrefs({ wideLog: !p.wideLog }); setLogCol(false); paintPrints(); after(); } },
            { label: 'Only Her (wide screens)', checked: !!p.wideSolo, action: () => { setPrefs({ wideSolo: !p.wideSolo }); setLogCol(false); paintPrints(); after(); } });
        items.push(...toolRows(['Show', 'Send on Enter']));
        // the model the next turn runs on (the desktop header's picker): Engine, Model, Thinking, Context, Fast
        const model = wmRows([d.engineMenuItem(), ...d.modelPrefItems()], null, run);
        if (model.length) items.push('-', ...model);
        items.push('-', { label: 'Phone Settings...', action: () => openPhoneSettings() }, { label: 'Director Settings...', action: () => { void d.openDirectorSettings(); } });
        return items;
    }

    function openPhoneSettings() {
        if (window.wmSettings && typeof window.wmSettings.open === 'function') window.wmSettings.open('director', 'phone', { direct: true });
    }

    /** A view switch closes the log first, so no hidden peek is left behind (it would eat a Back press). */
    function unpeek(m) {
        if (m.peek) m.togglePeek(false);
    }

    function after() {
        const d = dir();
        if (page) page.classList.toggle('wmd-peek', peeking());
        if (d && d.mascot) d.mascot.settleLayout(500);
        // a closed log (or any layer) takes its history entry with it
        if (ws && isCurrent()) { ws.refreshSoftKeys(); ws.syncHistory(); }
    }

    function sessionItems() {
        const d = dir();
        const id = d && d.currentSession && d.currentSession.id;
        const rows = toolRows(['Restart Session', 'Retry Last Message', 'Undo Last Message', 'Auto-Repair Session']);
        // the session row's own menu (Fork, Move to workspace, Nuke), without the repeats
        const own = sessionMenuRows(id).filter((r) => r === '-' || !/^(Auto-Repair Session|Delete Session)/.test(r.label));
        const out = rows.concat(own.length ? ['-', ...own] : []);
        out.push('-', { label: 'Delete Session...', disabled: !id || isDraft(d), action: () => { void d.deleteSession().then(after); } });
        return out;
    }

    function mainMenu() {
        const d = dir();
        if (!d) return [{ label: 'The Director is starting...', disabled: true }];
        const m = d.mascot;
        const vn = !!(m && m.vnBubbles());
        const result = !!(vn && m._result && !m.el.result.classList.contains('hidden'));
        const card = !!(result && m._result.card);
        const draft = isDraft(d);
        const items = [
            { label: 'Sessions', action: () => { void showSessions(); } },
            { label: 'New Session', action: () => { void newSession(); } },
            { label: 'Persona', submenu: personaItems },
            '-'
        ];
        if (vn) {
            if (d.persona !== 'xi') items.push({ label: m._tab === 'card' ? 'Show Reply' : 'Report Card', disabled: !result || (!card && m._tab !== 'card'), action: () => { m.quickAction(m._tab === 'card' ? 'reply' : 'card'); after(); } });
            // wide screens: the log is beside her, or (prints gallery column) takes the column's place
            if (layout !== 'wide') items.push({ label: 'Log', checked: !!m.peek, action: () => { m.togglePeek(); after(); } });
            else if (galleryMode()) items.push({ label: 'Log', checked: logCol, action: () => setLogCol(!logCol) });
        }
        if (d.persona !== 'xi') items.push({ label: 'Prints', disabled: draft || !d.sessionPrints().length, action: showPrints });
        else items.push({ label: 'Changes', disabled: draft || !editRows(d).length, action: () => { void showChanges(); } });
        items.push({ label: 'History', disabled: draft || !d.currentSession, action: showHistory });
        // the desktop's browser pane (what her Dreamspace browser shows while she works)
        if (browserShown(d)) items.push({ label: 'Browser', action: showBrowser });
        items.push('-');
        items.push({ label: 'Stop', disabled: !running(d), action: () => { d.abortTurn(); after(); } });
        if (queuedRows(d).length) items.push({ label: 'Clear Queued Messages', action: clearQueue });
        const quick = toolRows(['Quick Tasks']);
        if (quick.length) items.push(...quick);
        items.push({ label: 'Session', disabled: draft, submenu: sessionItems });
        const computer = wmRows(d.computerMenuItems(), null, (a) => d.handleToolsAction(a));
        items.push({ label: 'Computer', submenu: () => computer });
        items.push('-');
        items.push({ label: 'Attach File...', action: () => { if (d.directorAttachFileInput) d.directorAttachFileInput.click(); openComposer(); } });
        items.push({ label: 'Attach from Device...', disabled: !d.directorAttachFileInput, action: () => { attachFromDevice(d); openComposer(); } });
        items.push({ label: 'Options', submenu: optionsItems });
        return items;
    }

    /**
     * Attach from Device: the device's own file picker straight from the menu tap (it needs the tap's
     * activation). Attach File... is the WM Open dialog over Dreamscape's files (wmFileDialogs.js wraps
     * the input's click for that), so this calls the native click past the wrapper. The desktop's
     * change listener (director.js addComputerFiles) adds the chips; the soft keys follow them (watchChat).
     */
    function attachFromDevice(d) {
        const input = d && d.directorAttachFileInput;
        if (!input) return;
        HTMLInputElement.prototype.click.call(input);
    }

    /** Menu while writing (WM Messaging's compose Menu): attach, take the attachments off, Cancel. */
    function composeMenu() {
        const d = dir();
        const n = d && d.pendingAttachments ? d.pendingAttachments.length : 0;
        const items = [
            { label: 'Attach File...', action: () => { if (d.directorAttachFileInput) d.directorAttachFileInput.click(); } },
            { label: 'Attach from Device...', disabled: !(d && d.directorAttachFileInput), action: () => attachFromDevice(d) }
        ];
        if (d && d.persona !== 'xi' && d.currentSession && !isDraft(d)) {
            const prints = d.sessionPrints().slice().reverse().slice(0, 12);
            if (prints.length) items.push({ label: 'Attach Print', submenu: () => prints.map((p, i) => ({ label: i === 0 ? 'Latest print' : `Print ${prints.length - i}`, action: () => { d.attachPrintToComposer(p.filename); ws.refreshSoftKeys(); } })) });
        }
        items.push({ label: n > 1 ? `Remove Attachments (${n})` : 'Remove Attachment', disabled: !n, action: () => { d.pendingAttachments.splice(0); d.renderAttachChips(); ws.refreshSoftKeys(); } });
        const quick = toolRows(['Quick Tasks']);
        if (quick.length) items.push('-', ...quick);
        items.push('-', { label: 'Cancel', action: closeComposer });
        return items;
    }

    function sessionsMenu() {
        return [
            { label: 'New Session', action: () => { void newSession(); } },
            { label: 'Refresh', action: () => { void showSessions(); } },
            { label: 'Persona', submenu: personaItems }
        ];
    }

    // ---------------------------------------------------------------- app

    function mount(p) {
        page = p;
        page.classList.add('wm-director');
        page.innerHTML = `
            <div class="wmd-host"></div>
            <div class="wmd-dock"><div class="wmd-choices"></div><div class="wmd-strip" role="list" aria-label="Prints"></div></div>
            <div class="wmd-status" hidden><img src="/static_images/app_icons/director.png" alt=""><span class="wmd-status-text"></span></div>`;
        watchLayout();
        wireThumbs(page.querySelector('.wmd-strip'));
        // the dock's height moves her text box (choices come and go with the reply)
        if (typeof ResizeObserver === 'function') {
            new ResizeObserver(() => { const d = dir(); if (shown && d && d.mascot && d.mascot._result) d.mascot.placeResult(); }).observe(page.querySelector('.wmd-dock'));
        }
        // the HUD's chips (turns, prints, context): a tap opens Prints, as the desktop quick bar's Prints
        page.querySelector('.wmd-host').addEventListener('click', (e) => {
            const chip = e.target.closest && e.target.closest('.dm-vn-layer .dm-hud');
            if (!chip || composing) return;
            e.stopPropagation();
            showPrints();
        }, true);
        // tap to advance: a tap on her scene (not on a control, a link, the text box's own parts or the composer)
        page.querySelector('.wmd-host').addEventListener('click', (e) => {
            if (composing) return;
            const t = e.target;
            if (!t.closest || t.closest('a, button, input, textarea, select, label, .dm-dialog-suggest, .dm-dialog-head, #directorComposer, .director-chat-messages-container, .dm-think, .wmd-dock, .wmd-gallery')) return;
            if (!t.closest('.director-mascot-stage, .dm-vn-layer, #directorSessionChat')) return;
            advance();
        });
        // the composer's text decides the left soft key (Send while there is something to send)
        page.addEventListener('input', (e) => {
            if (e.target && e.target.id === 'directorChatInput' && isCurrent()) ws.refreshSoftKeys();
        });
        // the SIP button opens the composer (its edit box is not on screen until then)
        document.addEventListener('click', (e) => {
            if (!isCurrent() || composing || stack.length || !e.target.closest || !e.target.closest('#wmShell .wm-sip')) return;
            openComposer();
        }, true);
        page.addEventListener('focusin', (e) => {
            if (e.target && e.target.id === 'directorChatInput' && !composing) {
                composing = true;
                syncComposer();
                if (isCurrent()) { ws.refreshSoftKeys(); ws.syncHistory(); }
            }
        });
    }

    function softKeys() {
        const d = dir();
        const t = top();
        if (t) return t.keys ? t.keys() : { left: null, right: null };
        if (composing || isDraft(d)) {
            const has = !!(d && ((d.directorChatInput && d.directorChatInput.value.trim()) || (d.pendingAttachments && d.pendingAttachments.length)));
            return {
                left: { label: 'Send', disabled: !has, action: () => { void send(); } },
                right: isDraft(d) && !composing ? { label: 'Menu', menu: mainMenu } : { label: 'Menu', menu: composeMenu }
            };
        }
        return { left: { label: 'Reply', disabled: !d, action: openComposer }, right: { label: 'Menu', menu: mainMenu } };
    }

    // ---------------------------------------------------------------- turn notifications

    /**
     * A turn that ends while the Director is not on screen: a WM notification (the shell draws the
     * toast as its bubble, with its sound; the Android app posts it as a phone notification), View
     * opens the app. The title bar's Director glyph already shows while a turn runs.
     */
    let runningTurns = new Map(); // session id -> { name, xi }
    function noteTurns() {
        const d = dir();
        const st = d && d._status;
        if (!st) return;
        const now = new Map();
        if (st.running && st.sessionId) now.set(String(st.sessionId), { name: st.sessionName || '', xi: false, last: st.last });
        if (st.xi && st.xi.running && st.xi.sessionId) now.set(String(st.xi.sessionId), { name: st.xi.sessionName || '', xi: true });
        const ended = [...runningTurns.entries()].filter(([id]) => !now.has(id));
        runningTurns = now;
        if (!ended.length || (shown && isCurrent()) || !prefs().notifyTurns || typeof showGlassToast !== 'function') return;
        ended.forEach(([id, turn]) => {
            const s = (d.directorSessions || []).find((x) => String(x.id) === id);
            const persona = turn.xi ? 'xi' : (s && s.memoryStore === 'obliterated' ? 'kabuki' : 'wren');
            const name = turn.name || (s && s.name) || '';
            const last = st.last && String(st.last.sessionId) === id ? st.last : null;
            const failed = !!(last && (last.state === 'error' || last.error));
            const who = personaName(persona);
            const text = failed
                ? `${who} stopped with an error${name ? ` in "${name}"` : ''}.`
                : `${who} replied${name ? ` in "${name}"` : ''}.`;
            /* global showGlassToast */
            showGlassToast(failed ? 'error' : 'info', 'Director', text, false, 8000, null, [{
                text: 'View',
                onClick: () => {
                    ws.open(APP_ID);
                    const dd = dir();
                    const ss = dd && (dd.directorSessions || []).find((x) => String(x.id) === id);
                    if (dd && ss && !(dd.currentSession && String(dd.currentSession.id) === id)) void busyOf(() => { const arrived = messagesArrived(ss.id); return Promise.resolve(dd.showSessionChat(ss)).then(() => arrived); });
                }
            }]);
        });
    }

    /**
     * Settings > Director > Phone > Open new prints: a print of the chat on screen opens in the picture
     * view once she has taken it in (after the fly-in), unless a page, the composer or the viewer is up.
     */
    function openNewPrint(msg) {
        if (!prefs().openPrints || !shown || !isCurrent() || stack.length || composing) return;
        const body = (msg && msg.data && typeof msg.data === 'object') ? msg.data : (msg || {});
        const d = dir();
        const chatId = body.chatId || body.sessionId;
        if (!d || !body.filename || !d.currentSession || String(chatId) !== String(d.currentSession.id)) return;
        if (openViewerPicture()) return;
        try { d.openSessionImage(body.filename); } catch (err) { console.warn('[wmDirector] open print', err); }
    }

    function register() {
        ws = window.wmShell;
        if (!ws || typeof ws.registerApp !== 'function') return;
        ws.registerApp({
            id: APP_ID,
            title: 'Director',
            // a Dreamscape app with its own icon (not ROM art): /static_images/wm61/app-director*.png
            icon: 'app-director',
            inStart: 'top',
            sip: true,
            mount,
            show(p) {
                page = p;
                shown = true;
                const run = pendingRun;
                pendingRun = null;
                // her first show after a load lays out the whole window and her layers (~0.7 s at 4x
                // throttle, #723): the bars and the wait cursor paint first. Hand-offs run at once (they
                // can focus the composer, which needs the tap's gesture)
                if (!everShown && !run && ws && typeof ws.busy === 'function' && document.documentElement.dataset.wmBoot === 'done') {
                    everShown = true;
                    p.classList.add('wmd-prepaint');
                    void ws.busy(() => {
                        p.classList.remove('wmd-prepaint');
                        return shown ? attach(null) : null;
                    }, { paint: true });
                    return;
                }
                everShown = true;
                p.classList.remove('wmd-prepaint');
                void attach(run);
            },
            hide() {
                shown = false;
                endStartBusy();
                restoreViewer();
                // the composer stays open (Smart Minimize): reopening comes back to it with ok
                const d = dir();
                if (d && d.directorChatInput) d.directorChatInput.blur();
                // she lets go of her sprite layers while the app is in the background
                if (d && d.mascot && patchedMascot === d.mascot) { d.mascot.applyView(); syncBlink(d.mascot); }
            },
            softKeys,
            // the title over a page (the shell puts it back after the picture view)
            titleNow: () => { const t = top(); return t ? (typeof t.title === 'function' ? t.title() : t.title) : null; },
            // WM: X on the conversation and its lists (Smart Minimize), ok on the reply composer
            // (closes it, the text stays), as Messaging's new message, and on the pages that stand
            // for the desktop's windows (Prints, History, the inspector, text)
            // a turn under way: X asks (Minimize keeps the app; the turn goes on either way)
            closeQuestion: () => {
                const st = window.directorInstance && window.directorInstance._status;
                return st && st.running ? 'The Director is still working on a turn. Close the Director?' : null;
            },
            titleKind: () => {
                const t = top();
                if (t) return t.corner || 'ok';
                return composing && !isDraft() ? 'ok' : 'close';
            },
            onTitleOk() {
                const t = top();
                if (t && t.corner === 'ok') { popPage(); return true; }
                if (t || !(composing && !isDraft())) return false;
                closeComposer();
                return true;
            },
            historyDepth() {
                return stack.length + (composing && !isDraft() ? 1 : 0) + (peeking() ? 1 : 0) + (logCol && galleryMode() ? 1 : 0);
            },
            onBack() {
                if (stack.length) { popPage(); return true; }
                if (peeking()) { dir().mascot.togglePeek(false); after(); return true; }
                if (logCol && galleryMode()) { setLogCol(false); return true; }
                if (composing && !isDraft()) { closeComposer(); return true; }
                return false;
            }
        });
        waitForDirector();
        patchContextMenu();
        window.addEventListener('wmDirectorPrefsChange', () => { if (page) { paintPrints(); if (isCurrent()) ws.refreshSoftKeys(); } });
        // the soft keys follow the Director (a turn starts or ends, a chat opens)
        const refresh = () => {
            if (!isCurrent()) return;
            syncComposer();
            ws.refreshSoftKeys();
            if (stack.some((p) => p.kind === 'sessions')) renderSessions();
            const pr = stack.find((p) => p.kind === 'prints');
            if (pr) {
                // another chat opened under the page (a notification's View, Sessions, a hand-off): its prints
                const d = dir();
                if (!d || !d.currentSession || d.persona === 'xi') closePages('prints');
                else renderPrints(pr.el);
            }
            paintPrints();
            paintQueue();
        };
        if (window.wsClient && typeof window.wsClient.on === 'function') {
            ['director_computer_status', 'director_message_response', 'director_messages_updated', 'director_get_messages_response', 'director_get_sessions_response', 'director_create_session_response', 'director_delete_session_response', 'director_fork_session_response', 'director_move_session_response', 'director_session_image', 'director_session_renamed'].forEach((t) => {
                try { window.wsClient.on(t, () => setTimeout(refresh, 50)); } catch (_) { /* no such event */ }
            });
            try { window.wsClient.on('director_computer_status', () => setTimeout(noteTurns, 60)); } catch (_) { /* no such event */ }
            try { window.wsClient.on('director_session_image', (msg) => setTimeout(() => openNewPrint(msg), 1400)); } catch (_) { /* no such event */ }
        }
    }

    if (window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
