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
    const SOFT_LABELS = { back: 'Back', home: 'Home', recents: 'Recent', start: 'Start', notifications: 'Notification', keyboard: 'Keyboard', none: '' };
    let lastReq = 0;
    let restoreNow = null;
    let lastGood = null;
    // Start opened for a copy (renderStart): put back at once when the page comes on screen
    let startRestore = null;
    // one copy at a time: a bar copy stages the bars (the program's title) and Start's copy must not
    // take its title bar while they are staged
    let chain = Promise.resolve();
    function serial(fn) {
        const p = chain.then(fn, fn);
        chain = p.catch(() => null);
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
                sip: ctx.softkeys ? !!ctx.ime : undefined
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
        lastGood = {
            // the picture's own width: innerWidth x dpr rounds 411 x 2.625 to 1079 on a 1080 px screen
            widthPx: t ? t.width : Math.round(window.innerWidth * dpr),
            clock: !!top.querySelector('.wm-clock651'),
            top: pack(t, regions.top),
            bottom: soft ? pack(b, regions.bottom) : null
        };
        publish(Object.assign({ reqId }, lastGood));
    }

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
        const glowHidden = glow ? glow.hidden : true;
        try {
            const lr = list.getBoundingClientRect();
            const vr = view.getBoundingClientRect();
            const rel = (r) => ({ x0: Math.round((r.left - lr.left) * dpr), y0: Math.round((r.top - lr.top) * dpr), x1: Math.round((r.right - lr.left) * dpr), y1: Math.round((r.bottom - lr.top) * dpr) });
            const cells = prep.cells.map((c) => {
                const el = list.querySelector(`.wm-s65-cell[data-i="${c.i}"]`);
                return el ? Object.assign({}, c, rel(el.getBoundingClientRect())) : null;
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
            const wallPic = wall && !wall.hidden && wall.getClientRects().length ? await snap(wall) : null;
            const pagePic = await snap(page, () => { list.style.visibility = 'hidden'; });
            const glowPic = glow && glowAt ? await snap(glow, () => { list.style.visibility = listVis; }) : null;
            const listPic = await snap(list, () => { list.style.visibility = listVis; if (glow) glow.hidden = true; list.style.transform = 'none'; });
            const topPic = await snap(top);
            const softPic = soft ? await snap(soft) : null;
            // the page came on screen meanwhile: Start was put back, the copy is not whole
            if (restored) { out({ unsupported: 'interrupted' }); return; }
            out({
                title: prep.title,
                widthPx: Math.round(shell.getBoundingClientRect().width * dpr),
                wall: wallPic ? packAt(wallPic, wall.getBoundingClientRect(), dpr) : null,
                page: packAt(pagePic, page.getBoundingClientRect(), dpr),
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
        renderStart: (ctx) => { serial(() => renderStart(ctx)).catch((err) => console.warn('[melatonBars] renderStart', err)); },
        tap: (role) => { if (window.wmShell && window.wmShell.barsTap) window.wmShell.barsTap(role); },
        unsupported: () => unsupported(document.querySelector('#wmShell .wm-titlebar'))
    };
})();
