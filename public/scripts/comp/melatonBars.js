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
        publish({
            reqId,
            widthPx: Math.round(window.innerWidth * dpr),
            clock: !!top.querySelector('.wm-clock651'),
            top: pack(t, regions.top),
            bottom: soft ? pack(b, regions.bottom) : null
        });
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
        if (window.wmShell && window.wmShell.setBarsExternal) window.wmShell.setBarsExternal(false);
    });

    window.melatonBars = {
        render: (ctx) => { render(ctx).catch((err) => { unstage(); console.warn('[melatonBars] render', err); }); },
        tap: (role) => { if (window.wmShell && window.wmShell.barsTap) window.wmShell.barsTap(role); },
        unsupported: () => unsupported(document.querySelector('#wmShell .wm-titlebar'))
    };
})();
