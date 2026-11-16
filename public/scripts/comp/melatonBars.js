/**
 * Melaton Bars (#871): the phone's WM title bar and soft key bar drawn by the Android app over
 * every other Android program, in place of Android's status bar (no root). The app's accessibility
 * service shows the pictures and locks Android's own bar (no pull-down); this page draws them, so
 * leaving Melaton Mobile changes nothing on the bar but the program's title.
 *
 *   melatonBars.render(ctx)  the app asks for the bars as they show over a program:
 *       ctx { reqId, external, app: { pkg, label }, ime, corner: 'close' | 'ok' | '', androidTray,
 *             softkeys, softLeft, softRight (action ids: back, home, recents, start, notifications,
 *             none) }
 *     and gets AndroidBars.publish({ reqId, widthPx, clock, top, bottom }) with each bar as
 *     { png (base64), w, h, regions: [{ role, x0, x1 }] } in device pixels, or { reqId, unsupported }.
 *   melatonBars.tap(role)    a tap on a picture's region that the page answers (Start, an icon)
 *
 * Needs Settings > Screen > Bezel: Top of screen = Windows Status Bar with Extend Status Bar to
 * edge of Camera (Yukimi, Nov 15 2026): the title bar then starts at the screen's top edge and
 * fills the status bar's strip, so the copy is the same pixels in and out of Melaton Mobile.
 */
(function () {
    'use strict';

    const root = document.documentElement;
    const SOFT_LABELS = { back: 'Back', home: 'Home', recents: 'Recent', start: 'Start', notifications: 'Notification', keyboard: 'Keyboard', menu: 'Menu', none: '' };
    // the right soft key's Menu (Settings > Menus > Soft Key Menu): its rows, in the user's order
    const MENU_ITEMS = { taskmanager: 'Task Manager', notifications: 'All Notifications', quicksettings: 'Quick Settings', maximize: 'Maximize', minimize: 'Minimize', close: 'Close' };
    function softMenuRows() {
        let cfg = null;
        try { cfg = JSON.parse(window.AndroidBars.getState()).config; } catch (_) { cfg = null; }
        const list = cfg && Array.isArray(cfg.softMenu) ? cfg.softMenu : Object.keys(MENU_ITEMS).map((id) => ({ id, on: true }));
        return list.filter((r) => r && r.on && MENU_ITEMS[r.id]).map((r) => ({
            label: MENU_ITEMS[r.id],
            // Task Manager is Melaton's own program (the page comes up); the others are the app's to do
            action: r.id === 'taskmanager' ? () => window.wmShell.open('taskmgr') : () => { try { window.AndroidBars.menuAction(r.id); } catch (_) { /* older app */ } }
        }));
    }
    let lastReq = 0;
    let restoreNow = null;
    let lastGood = null;
    // Start opened for a copy (renderStart): put back at once when the page comes on screen
    let startRestore = null;
    let lastStartBg = '';
    // one copy at a time: a bar copy stages the bars (the program's title) and Start's copy must not
    // take its title bar while they are staged
    let chain = Promise.resolve();
    // the app keeps the page's timers on while any copy is queued or being made (a reply that came back
    // paused them under a slower copy, which then never finished)
    let pending = 0;
    const report = () => { try { if (window.AndroidBars && window.AndroidBars.workState) window.AndroidBars.workState(pending > 0); } catch (_) { /* older app */ } };
    function serial(fn) {
        pending++;
        report();
        const p = chain.then(fn, fn).finally(() => { pending--; report(); });
        // a copy that never finishes (the page was paused mid-way) holds the next ones 6 s at most
        chain = Promise.race([p.catch(() => null), new Promise((r) => setTimeout(r, 6000))]);
        return p;
    }

    function lsGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }

    /** Why the bars cannot be copied 1:1 here, or '' when they can. */
    function unsupported(bar) {
        if (!bar) return 'no-shell';
        if (root.dataset.wmCamera === 'bezel') return 'bezel-mode';
        if (lsGet('wmCameraExtendBar') !== '1') return 'extend-off';
        let bars = null;
        try { bars = JSON.parse(window.AndroidDisplay.getSystemBars()); } catch (_) { bars = null; }
        if (bars && bars.hideStatus === false) return 'android-status-bar';
        if (bar.getBoundingClientRect().top > 0.5) return 'not-at-top';
        return '';
    }

    function regionsOf(el, map, dpr) {
        const out = [];
        map.forEach(([sel, role]) => {
            el.querySelectorAll(sel).forEach((n) => {
                if (n.hidden || !n.getClientRects().length) return;
                const r = n.getBoundingClientRect();
                if (!r.width) return;
                out.push({ role: typeof role === 'function' ? role(n) : role, x0: Math.round(r.left * dpr), x1: Math.round(r.right * dpr) });
            });
        });
        return out;
    }

    const TOP_MAP = [
        ['.wm-start', 'start'],
        ['.wm-title', 'title'],
        ['.wm-status-icon', (n) => n.dataset.role || 'title'],
        ['.wm-title-action', 'corner']
    ];
    const SOFT_MAP = [
        ['.wm-start', 'start'],
        ['.wm-softkey[data-side="left"]', 'soft-left'],
        ['.wm-sip', 'sip'],
        ['.wm-softkey[data-side="right"]', 'soft-right'],
        ['.wm-title-action', 'corner']
    ];

    function pack(canvas, regions) {
        if (!canvas) return null;
        let png = '';
        try { png = canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, ''); } catch (_) { png = ''; }
        return png ? { png, w: canvas.width, h: canvas.height, regions } : null;
    }

    function publish(o) {
        try { if (window.AndroidBars) window.AndroidBars.publish(JSON.stringify(o)); } catch (err) { console.warn('[melatonBars] publish', err); }
    }

    async function render(ctx) {
        ctx = ctx || {};
        const reqId = Number(ctx.reqId) || ++lastReq;
        lastReq = Math.max(lastReq, reqId);
        const external = ctx.external !== false;
        if (window.wmShell && window.wmShell.setBarsExternal) window.wmShell.setBarsExternal(external);
        // the page is in front (or about to be): its own bars are the ones on screen, nothing to copy
        // (the last copy is sent again: the app keeps it ready for the next time the page goes behind)
        if (!external || document.visibilityState === 'visible') { publish(lastGood ? Object.assign({}, lastGood, { reqId }) : { reqId, unsupported: 'in-front' }); return; }
        const shell = document.getElementById('wmShell');
        const top = shell && shell.querySelector('.wm-titlebar');
        const why = unsupported(top);
        if (why) { publish({ reqId, unsupported: why }); return; }
        if (!window.windowCapture && window.featureLoader) {
            try { await window.featureLoader.loadFeature('window_capture'); } catch (_) { /* below */ }
        }
        if (!window.windowCapture || !window.wmShell || !window.wmShell.barsStage) { publish({ reqId, unsupported: 'no-capture' }); return; }
        const soft = ctx.softkeys ? shell.querySelector('.wm-softkeys') : null;
        const dpr = window.devicePixelRatio || 1;
        let regions = { top: [], bottom: [] };
        const stage = () => {
            if (restoreNow) return;
            restoreNow = window.wmShell.barsStage({
                title: (ctx.app && ctx.app.label) || '',
                corner: ctx.corner === 'ok' ? 'ok' : ctx.corner === '' ? '' : 'close',
                androidTray: !!ctx.androidTray,
                softLeft: ctx.softkeys ? (SOFT_LABELS[ctx.softLeft] ?? 'Back') : undefined,
                softRight: ctx.softkeys ? (SOFT_LABELS[ctx.softRight] ?? '') : undefined,
                sip: ctx.softkeys ? !!ctx.ime : undefined,
            transparent: !!ctx.transparent,
            softHeight: ctx.softHeightPx > 0 ? ctx.softHeightPx / (window.devicePixelRatio || 1) : 0
            });
            regions = { top: regionsOf(top, TOP_MAP, dpr), bottom: soft ? regionsOf(soft, SOFT_MAP, dpr) : [] };
        };
        let t = null;
        let b = null;
        try {
            t = await window.windowCapture.snapshot(top, { scale: dpr, before: stage });
            if (soft) b = await window.windowCapture.snapshot(soft, { scale: dpr });
        } finally {
            unstage();
        }
        // a newer ask came in meanwhile: its copy follows
        if (reqId < lastReq) return;
        const wait = await waitPic(dpr);
        lastGood = {
            wait,
            // the picture's own width: innerWidth x dpr rounds 411 x 2.625 to 1079 on a 1080 px screen
            widthPx: t ? t.width : Math.round(window.innerWidth * dpr),
            clock: !!top.querySelector('.wm-clock651'),
            top: pack(t, regions.top),
            bottom: soft ? pack(b, regions.bottom) : null
        };
        publish(Object.assign({ reqId }, lastGood));
    }

    /** The WM wait cursor for the app's loading cover: its 16 frames side by side at the screen's pixels and its box. */
    let waitCache = null;
    async function waitPic(dpr) {
        const sh = window.wmShell;
        const spec = sh && sh.barsWaitSpec ? sh.barsWaitSpec() : null;
        if (!spec || !spec.width) return null;
        const key = `${spec.width}x${spec.height}@${dpr}`;
        if (waitCache && waitCache.key === key) return Object.assign({}, waitCache.out, { x: Math.round(spec.left * dpr), y: Math.round(spec.top * dpr) });
        const w = Math.round(spec.width * dpr);
        const h = Math.round(spec.height * dpr);
        const file = spec.files[dpr > 2 ? 4 : dpr > 1 ? 2 : 1];
        try {
            const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = file; });
            const c = document.createElement('canvas');
            c.width = w * spec.n;
            c.height = h;
            const g = c.getContext('2d');
            g.imageSmoothingEnabled = true;
            g.imageSmoothingQuality = 'high';
            g.drawImage(img, 0, 0, c.width, c.height);
            const out = { png: c.toDataURL('image/png').replace(/^data:image\/png;base64,/, ''), w, h, n: spec.n, ms: spec.ms };
            waitCache = { key, out };
            return Object.assign({}, out, { x: Math.round(spec.left * dpr), y: Math.round(spec.top * dpr) });
        } catch (_) { return null; }
    }

    // ---- popups (#871): an icon's bubble, the notification tray, a notification, a menu, over the program

    const CLICKABLE = 'button, a[href], [role="button"], [role="option"], [role="menuitem"], [role="link"], input, select, label.wm-check, [data-act]';
    /** The things a finger can press in the popups and on the bars, in a fixed order (the same after a reopen). */
    function clickables(layers, shell) {
        const out = [];
        layers.forEach((l) => l.querySelectorAll(CLICKABLE).forEach((el) => { if (!out.includes(el)) out.push(el); }));
        shell.querySelectorAll('.wm-softkeys .wm-softkey, .wm-softkeys .wm-sip, .wm-softkeys .wm-start, .wm-softkeys .wm-title-action, .wm-titlebar .wm-title-action').forEach((el) => { if (!out.includes(el)) out.push(el); });
        // the title bar's icons (a second tap on the bubble's own icon closes it, another icon's opens
        // that one) and the scrim (a tap outside the popups hides them), as here
        shell.querySelectorAll('.wm-titlebar .wm-status-icon').forEach((el) => { if (!out.includes(el)) out.push(el); });
        layers.filter((l) => l.classList.contains('wm-notify-scrim')).forEach((el) => { if (!out.includes(el)) out.push(el); });
        return out.filter((el) => !el.hidden && !el.disabled && el.getClientRects().length);
    }

    /**
     * melatonBars.renderPopup({ reqId, role, current, click, app, corner, androidTray, softkeys, softLeft,
     * softRight, ime }): the popup that a tap on the bar's `role` opens (or, with current, the one up
     * now: an incoming notification), copied with its boxes; with click, the press `click` in it first.
     * AndroidBars.publishPopup({ reqId, layers: [{ png, x, y }], top, bottom, regions: [{ idx, x0, y0,
     * x1, y1 }] } | { reqId, open: true } (the press opened a program: the app brings the page up) |
     * { reqId, closed: true }).
     */
    async function renderPopup(ctx) {
        ctx = ctx || {};
        const reqId = Number(ctx.reqId) || 0;
        const out = (o) => { try { if (window.AndroidBars && window.AndroidBars.publishPopup) window.AndroidBars.publishPopup(JSON.stringify(Object.assign({ reqId }, o))); } catch (err) { console.warn('[melatonBars] publishPopup', err); } };
        const sh = window.wmShell;
        const shell = document.getElementById('wmShell');
        if (!sh || !sh.barsPopupOpen || !shell || document.visibilityState === 'visible') { out({ closed: true }); return; }
        if (!window.windowCapture && window.featureLoader) { try { await window.featureLoader.loadFeature('window_capture'); } catch (_) { /* below */ } }
        if (!window.windowCapture) { out({ closed: true }); return; }
        const dpr = window.devicePixelRatio || 1;
        const appBefore = sh.currentApp();
        const stageOpts = {
            title: (ctx.app && ctx.app.label) || '',
            corner: ctx.corner === 'ok' ? 'ok' : ctx.corner === '' ? '' : 'close',
            androidTray: !!ctx.androidTray,
            softLeft: ctx.softkeys ? (SOFT_LABELS[ctx.softLeft] ?? 'Back') : undefined,
            softRight: ctx.softkeys ? (SOFT_LABELS[ctx.softRight] ?? '') : undefined,
            sip: ctx.softkeys ? !!ctx.ime : undefined,
            transparent: !!ctx.transparent,
            softHeight: ctx.softHeightPx > 0 ? ctx.softHeightPx / (window.devicePixelRatio || 1) : 0
        };
        restoreNow = sh.barsStage(stageOpts);
        let opened = false;
        // the popup redraws the bars as the page shows them (its title, the tray icon gone): staged again
        // on top, with the corner as the popup left it (WM takes it away for a bubble with its own button)
        const restage = () => {
            const corner = shell.querySelector(sh.bottomBars ? '.wm-softkeys > .wm-title-action' : '.wm-titlebar > .wm-title-action');
            const hidden = corner ? corner.hidden : false;
            unstage();
            // a notification owns the soft keys while it is up (WM: Dismiss / Menu): those stay as the page has them
            const note = shell.querySelector(':scope > .wm-notify');
            const noteUp = !!(note && !note.hidden);
            restoreNow = sh.barsStage(noteUp ? Object.assign({}, stageOpts, { softLeft: undefined, softRight: undefined }) : stageOpts);
            if (corner && hidden) corner.hidden = true;
        };
        try {
            // from a clean page: a bubble left open by an earlier copy would make this tap close it instead
            if (!ctx.current) { try { sh.barsPopupClose(); } catch (_) { /* none */ } }
            if (!ctx.current && ctx.role === 'softmenu') {
                const right = shell.querySelector('.wm-softkeys .wm-softkey[data-side="right"]');
                sh.menu('right', softMenuRows(), right);
            } else if (!ctx.current) sh.barsPopupOpen(ctx.role || 'notify');
            opened = !ctx.current;
            restage();
            if (ctx.click != null) {
                opened = true;
                const list = clickables(sh.barsPopupLayers(), shell);
                const el = list[Number(ctx.click)];
                if (el) el.click();
                // what the press did: a program came up (the page goes in front), or the popups went
                // (a timer, not a frame: a page behind another program draws no frames)
                await new Promise((r) => setTimeout(r, 30));
                if (sh.currentApp() !== appBefore) { unstage(); opened = false; out({ open: true }); return; }
                restage();
            }
            const layers = sh.barsPopupLayers();
            if (!layers.length) { out({ closed: true }); return; }
            // 6.5 paints a menu in two ticks (its frame and first row, then the rest): the copy is of the whole menu
            layers.forEach((l) => { if (l.dataset.wmPaint) delete l.dataset.wmPaint; });
            const list = clickables(layers, shell);
            const regions = list.map((el, idx) => { const r = el.getBoundingClientRect(); return { idx, x0: Math.round(r.left * dpr), y0: Math.round(r.top * dpr), x1: Math.round(r.right * dpr), y1: Math.round(r.bottom * dpr) }; });
            const pics = [];
            for (const l of layers) {
                const c = await window.windowCapture.snapshot(l, { scale: dpr });
                if (c) pics.push(packAt(c, l.getBoundingClientRect(), dpr));
            }
            const top = shell.querySelector('.wm-titlebar');
            const soft = shell.querySelector('.wm-softkeys');
            const topPic = await window.windowCapture.snapshot(top, { scale: dpr });
            const softPic = ctx.softkeys && soft ? await window.windowCapture.snapshot(soft, { scale: dpr }) : null;
            // which popup is up now (a press on another icon switched to its bubble): the app's next press reopens that one
            const bub = shell.querySelector(':scope > .wm-bubble');
            const tray = shell.querySelector(':scope > .wm-notify-tray');
            const vol = shell.querySelector(':scope > .wm-volume');
            const openRole = bub && !bub.hidden && bub.dataset.role ? bub.dataset.role : tray && !tray.hidden ? 'notify' : vol && !vol.hidden ? 'volume' : (ctx.role || '');
            out({
                role: openRole,
                // a popup with a running clock in it (the VPN's connected time): the app copies it again every second while it is up
                live: layers.some((l) => !!l.querySelector('.wm-vpn-time')),
                layers: pics.filter(Boolean),
                top: topPic ? packAt(topPic, top.getBoundingClientRect(), dpr) : null,
                bottom: softPic ? packAt(softPic, soft.getBoundingClientRect(), dpr) : null,
                regions
            });
        } finally {
            // the bubbles and the tray this copy opened are closed again (a waiting notification stays)
            if (opened) { try { sh.barsPopupClose(); } catch (_) { /* gone */ } }
            unstage();
        }
    }

    // a notification that comes up while the page is behind a program: the app shows its copy
    function watchNotes() {
        const shell = document.getElementById('wmShell');
        const note = shell && shell.querySelector(':scope > .wm-notify');
        if (!note || note._barsWatch) return;
        note._barsWatch = true;
        new MutationObserver(() => {
            if (!window.wmShell || !window.AndroidBars || document.visibilityState === 'visible') return;
            try {
                if (!note.hidden && window.AndroidBars.popupWanted) window.AndroidBars.popupWanted();
                else if (note.hidden && window.AndroidBars.popupGone) window.AndroidBars.popupGone();
            } catch (_) { /* older app */ }
        }).observe(note, { attributes: true, attributeFilter: ['hidden'] });
    }
    watchNotes();
    document.addEventListener('wmShellReady', watchNotes);

    function packAt(canvas, rect, dpr, extra) {
        const o = pack(canvas, []);
        if (!o) return null;
        delete o.regions;
        o.x = Math.round(rect.left * dpr);
        o.y = Math.round(rect.top * dpr);
        return Object.assign(o, extra || {});
    }

    /**
     * The 6.5 Start screen for the app's native copy (melatonBars.renderStart({ reqId, folders })):
     * its layers as the page stacks them (the shell's picture, Start's page without the grid, the
     * whole grid, the selection glow, the two bars in Start's state), where each sits on the screen,
     * and each cell's box in the grid. AndroidBars.publishStart({ reqId, folders, title, wall, page,
     * view, list, glow, cells, top, bottom }) in device pixels.
     */
    async function renderStart(ctx) {
        ctx = ctx || {};
        const reqId = Number(ctx.reqId) || 0;
        const folders = Array.isArray(ctx.folders) ? ctx.folders : [];
        const out = (o) => { try { if (window.AndroidBars && window.AndroidBars.publishStart) window.AndroidBars.publishStart(JSON.stringify(Object.assign({ reqId, folders }, o))); } catch (err) { console.warn('[melatonBars] publishStart', err); } };
        const S = window.wmStart65;
        const shell = document.getElementById('wmShell');
        if (!S || !S.barsPrep || !shell) { out({ unsupported: 'no-start' }); return; }
        if (!window.windowCapture && window.featureLoader) { try { await window.featureLoader.loadFeature('window_capture'); } catch (_) { /* below */ } }
        if (!window.windowCapture) { out({ unsupported: 'no-capture' }); return; }
        const dpr = window.devicePixelRatio || 1;
        // a page still starting puts program opens off until its boot steps are done (Start among them):
        // the copy waits for that (8 s at most) instead of finding no Start screen
        const wsc = window.wsClient;
        if (wsc && wsc.deferredInitPending && typeof wsc.whenDeferredInitDone === 'function') {
            await Promise.race([wsc.whenDeferredInitDone(), new Promise((r) => setTimeout(r, 8000))]);
        }
        // only behind another program: on screen, opening Start would show (and a tap on an item
        // coming in now would open its program from Start, with Start's see-through bar)
        if (document.visibilityState === 'visible') { out({ unsupported: 'visible' }); return; }
        const prep = S.barsPrep(folders);
        if (!prep) { out({ unsupported: 'no-start' }); return; }
        let restored = false;
        startRestore = () => { if (restored) return; restored = true; startRestore = null; try { prep.restore(); } catch (err) { console.warn('[melatonBars] start restore', err); } };
        const top = shell.querySelector('.wm-titlebar');
        const soft = shell.querySelector('.wm-softkeys');
        const wall = shell.querySelector(':scope > .wm-wall65');
        const { list, glow, view, page } = prep;
        const listVis = list.style.visibility;
        // the icons load when Start is first drawn: a copy made before that had cells with no picture
        // (1.5 s at most: a page behind another program may never decode a picture it does not draw)
        await Promise.race([
            Promise.all([...list.querySelectorAll('img')].map((i) => (i.complete && i.naturalWidth ? null : i.decode().catch(() => null)))),
            new Promise((r) => setTimeout(r, 1500))
        ]);
        const glowHidden = glow ? glow.hidden : true;
        try {
            const lr = list.getBoundingClientRect();
            const vr = view.getBoundingClientRect();
            const rel = (r) => ({ x0: Math.round((r.left - lr.left) * dpr), y0: Math.round((r.top - lr.top) * dpr), x1: Math.round((r.right - lr.left) * dpr), y1: Math.round((r.bottom - lr.top) * dpr) });
            const cells = prep.cells.map((c) => {
                const el = list.querySelector(`.wm-s65-cell[data-i="${c.i}"]`);
                if (!el) return null;
                const ic = el.querySelector('.wm-s65-icon');
                const ir = ic ? rel(ic.getBoundingClientRect()) : null;
                // the cell's row and column (the opening effect's delay) and its icon's box (the launch effect)
                return Object.assign({}, c, rel(el.getBoundingClientRect()), ir ? { ix0: ir.x0, iy0: ir.y0, ix1: ir.x1, iy1: ir.y1 } : {},
                    { r: parseInt(el.style.getPropertyValue('--r'), 10) || 0, c: parseInt(el.style.getPropertyValue('--c'), 10) || 0 });
            }).filter(Boolean);

            // the glow's box against its cell's (it follows the selected cell)
            let glowAt = null;
            const cell0 = list.querySelector('.wm-s65-cell[data-i="0"]');
            if (glow && !glow.hidden && cell0) {
                const g = glow.getBoundingClientRect();
                const c = cell0.getBoundingClientRect();
                glowAt = { dx: Math.round((g.left - c.left) * dpr), dy: Math.round((g.top - c.top) * dpr) };
            }
            const snap = (el, before) => window.windowCapture.snapshot(el, { scale: dpr, before });
            // the picture layers are the same for every folder: sent once while they stay the same (the
            // phone's wallpaper is several MB at the screen's size)
            const bgSig = [wall && !wall.hidden ? getComputedStyle(wall).backgroundImage.length + getComputedStyle(wall).backgroundImage.slice(-60) : '',
                getComputedStyle(page).backgroundImage.slice(-60), page.querySelector('.wm-s65-wall') ? getComputedStyle(page.querySelector('.wm-s65-wall')).backgroundImage.slice(-60) : '',
                Math.round(page.getBoundingClientRect().width), Math.round(page.getBoundingClientRect().height)].join('|');
            // (only when the app still holds them: a restarted app asks without haveBg)
            const reuseBg = !!(ctx.haveBg && bgSig === lastStartBg);
            const wallPic = !reuseBg && wall && !wall.hidden && wall.getClientRects().length ? await snap(wall) : null;
            const pagePic = reuseBg ? null : await snap(page, () => { list.style.visibility = 'hidden'; });
            if (!reuseBg) lastStartBg = bgSig;
            const glowPic = glow && glowAt ? await snap(glow, () => { list.style.visibility = listVis; }) : null;
            const listPic = await snap(list, () => { list.style.visibility = listVis; if (glow) glow.hidden = true; list.style.transform = 'none'; });
            const topPic = await snap(top);
            const softPic = soft ? await snap(soft) : null;
            // the page came on screen meanwhile: Start was put back, the copy is not whole
            if (restored) { out({ unsupported: 'interrupted' }); return; }
            out({
                // Settings > Today > Effects (the ones on) and the design unit in device px (their distances)
                fx: document.documentElement.dataset.wmTiFx || '',
                unit: (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--wm-px')) || 1) * dpr,
                reuseBg,
                title: prep.title,
                widthPx: Math.round(shell.getBoundingClientRect().width * dpr),
                wall: wallPic ? packAt(wallPic, wall.getBoundingClientRect(), dpr) : null,
                page: pagePic ? packAt(pagePic, page.getBoundingClientRect(), dpr) : null,
                view: { x: Math.round(vr.left * dpr), y: Math.round(vr.top * dpr), w: Math.round(vr.width * dpr), h: Math.round(vr.height * dpr) },
                list: packAt(listPic, lr, dpr),
                glow: glowPic ? packAt(glowPic, glow.getBoundingClientRect(), dpr, glowAt) : null,
                cells,
                top: packAt(topPic, top.getBoundingClientRect(), dpr, { regions: regionsOf(top, TOP_MAP, dpr) }),
                bottom: softPic ? packAt(softPic, soft.getBoundingClientRect(), dpr, { regions: regionsOf(soft, SOFT_MAP, dpr) }) : null
            });
        } finally {
            list.style.visibility = listVis;
            list.style.transform = '';
            if (glow) glow.hidden = glowHidden;
            if (startRestore) startRestore();
        }
    }

    function unstage() {
        const r = restoreNow;
        restoreNow = null;
        if (r) { try { r(); } catch (err) { console.warn('[melatonBars] restore', err); } }
    }

    // back in front: the page's own bars again, at once
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        unstage();
        if (startRestore) startRestore();
        if (window.wmShell && window.wmShell.setBarsExternal) window.wmShell.setBarsExternal(false);
    });

    window.melatonBars = {
        render: (ctx) => { serial(() => render(ctx)).catch((err) => { unstage(); console.warn('[melatonBars] render', err); }); },
        renderPopup: (ctx) => { serial(() => renderPopup(ctx)).catch((err) => { unstage(); console.warn('[melatonBars] renderPopup', err); }); },
        renderStart: (ctx) => { serial(() => renderStart(ctx)).catch((err) => console.warn('[melatonBars] renderStart', err)); },
        tap: (role) => { if (window.wmShell && window.wmShell.barsTap) window.wmShell.barsTap(role); },
        unsupported: () => unsupported(document.querySelector('#wmShell .wm-titlebar'))
    };
})();
