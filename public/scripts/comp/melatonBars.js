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
        let anims = { top: [], bottom: [] };
        let nativeInfo = null;
        try {
            // the animated icons (sprite strips) are left out of the pictures and sent as their frames
            // the icons the app draws itself from Android's own status and the title text are left out too:
            // their boxes go along (slots, title), so they are never out of date while this page sleeps
            t = await window.windowCapture.snapshot(top, { scale: dpr, before: () => { stage(); hideNative(top); hideStrips(top); } });
            showStrips(top);
            nativeInfo = nativeBoxes(top, dpr);
            showNative(top);
            anims.top = await stripFrames(top, dpr);
            if (soft) {
                b = await window.windowCapture.snapshot(soft, { scale: dpr, before: () => hideStrips(soft) });
                showStrips(soft);
                anims.bottom = await stripFrames(soft, dpr);
            }
        } finally {
            showStrips(top);
            if (soft) showStrips(soft);
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
            top: Object.assign(withAnims(pack(t, regions.top), anims.top) || {}, nativeInfo || {}),
            bottom: soft ? withAnims(pack(b, regions.bottom), anims.bottom) : null
        };
        publish(Object.assign({ reqId }, lastGood));
    }

    /*
     * Animated status icons (#871): a sprite strip (.wm-strip: --strip, --n frames, --ms each - the
     * Director's clapper while a turn runs, the update download, the signal search) cannot move in a
     * still picture. Its place is left empty in the bar's picture and its frames go along with it, each
     * the element drawn at that frame; the app plays them over the bar. Kept per strip and size.
     */
    const stripCache = new Map();
    // (the icons the app draws itself are not copied as strips either: the signal search is drawn there)
    const stripEls = (bar) => [...bar.querySelectorAll('.wm-strip')].filter((n) => !n.hidden && n.getClientRects().length && !NATIVE_ROLES.includes(n.dataset.role));
    function hideStrips(bar) { stripEls(bar).forEach((n) => { n.dataset.barsHole = '1'; n.style.visibility = 'hidden'; }); }
    function showStrips(bar) { bar.querySelectorAll('[data-bars-hole]').forEach((n) => { delete n.dataset.barsHole; n.style.visibility = ''; }); }
    async function stripFrames(bar, dpr) {
        const out = [];
        const br = bar.getBoundingClientRect();
        for (const n of stripEls(bar)) {
            const cs = getComputedStyle(n);
            const count = parseInt(cs.getPropertyValue('--n'), 10) || 0;
            const ms = parseInt(cs.getPropertyValue('--ms'), 10) || 140;
            if (count < 2) continue;
            const r = n.getBoundingClientRect();
            const key = `${cs.getPropertyValue('--strip').trim().slice(-120)}|${count}|${Math.round(r.width * dpr)}x${Math.round(r.height * dpr)}`;
            let frames = stripCache.get(key);
            if (!frames) {
                frames = [];
                for (let k = 0; k < count; k++) {
                    let back = null;
                    const c = await window.windowCapture.snapshot(n, { scale: dpr, before: () => { back = pinStrip(n, k); } });
                    if (back) back();
                    const p = pack(c, []);
                    if (!p) { frames = null; break; }
                    frames.push(p.png);
                }
                if (!frames) continue;
                if (stripCache.size > 12) stripCache.clear();
                stripCache.set(key, frames);
            }
            out.push({ x: Math.round((r.left - br.left) * dpr), y: Math.round((r.top - br.top) * dpr), ms, frames });
        }
        return out;
    }
    /**
     * A strip pinned to one frame with plain values (its picture, size and place resolved, no animation),
     * so a copy shows that frame: a copy that lost the strip's custom properties drew the whole sheet
     * (Yukimi, Nov 16: "a messed up sprite sheet" on Start). Returns the put-back.
     */
    function pinStrip(n, k) {
        const cs = getComputedStyle(n);
        const count = parseInt(cs.getPropertyValue('--n'), 10) || 1;
        const was = n.getAttribute('style');
        n.style.setProperty('background-image', cs.backgroundImage, 'important');
        n.style.setProperty('background-size', `${count * 100}% 100%`, 'important');
        n.style.setProperty('background-repeat', 'no-repeat', 'important');
        n.style.setProperty('background-position', `${count > 1 ? (k / (count - 1)) * 100 : 0}% 0%`, 'important');
        n.style.setProperty('animation', 'none', 'important');
        return () => { if (was == null) n.removeAttribute('style'); else n.setAttribute('style', was); };
    }
    function pinStrips(bar) {
        const backs = stripEls(bar).map((n) => pinStrip(n, 0));
        return () => backs.forEach((b) => b());
    }

    /*
     * What the app draws itself on the bar (#871, Yukimi Nov 16: "the status bar is not allowed to be out
     * of sync or inaccurate"): the connectivity, mobile network, roaming, signal and battery icons come
     * from Android's own status, and the title is the program in front, so the app draws them live from
     * its own state (DeviceStatusBridge, the program's label) with the same rules and art. The picture
     * leaves them out; their boxes come along: slots [{ role, x, y, w, h, icon }] (icon: what this page
     * shows, for the log) and the title's box.
     */
    const NATIVE_ROLES = ['data', 'cell', 'roaming', 'signal', 'battery'];
    function nativeEls(bar) { return NATIVE_ROLES.map((r) => bar.querySelector(`.wm-status-icon[data-role="${r}"]`)).filter(Boolean); }
    function hideNative(bar, iconsOnly) {
        nativeEls(bar).forEach((n) => { n.dataset.barsNative = '1'; n.style.visibility = 'hidden'; });
        const t = iconsOnly ? null : bar.querySelector('.wm-title');
        if (t) { t.dataset.barsNative = '1'; t.style.color = 'transparent'; }
    }
    function showNative(bar) {
        bar.querySelectorAll('[data-bars-native]').forEach((n) => { delete n.dataset.barsNative; n.style.visibility = ''; n.style.color = ''; });
    }
    function nativeBoxes(bar, dpr) {
        const br = bar.getBoundingClientRect();
        const rel = (r) => ({ x: Math.round((r.left - br.left) * dpr), y: Math.round((r.top - br.top) * dpr), w: Math.round(r.width * dpr), h: Math.round(r.height * dpr) });
        const slots = nativeEls(bar).filter((n) => !n.hidden && !n.classList.contains('wm-shed') && n.getClientRects().length)
            .map((n) => Object.assign({ role: n.dataset.role, icon: n.dataset.icon || '' }, rel(n.getBoundingClientRect())));
        const t = bar.querySelector('.wm-title');
        let title = null;
        if (t) {
            const r = t.getBoundingClientRect();
            const cs = getComputedStyle(t);
            title = Object.assign(rel(r), { pad: Math.round((parseFloat(cs.paddingLeft) || 0) * dpr), text: t.textContent || '' });
        }
        // the settings that choose the mobile network's badge (wmShell typeIcon) and the extra network icon
        const ls = (k) => lsGet(k) === '1';
        const net = { lte: ls('wmCellLte'), g5: ls('wmCell5g'), g5uw: ls('wmCell5gUw'), nruw: ls('wmCellNrUw'), showCell: ls('wmShowCellIcon') };
        return { slots, title, net, unit: Math.round(((n) => (n ? n.getBoundingClientRect().width : 0))(bar.querySelector('.wm-status-icon:not([hidden])')) * dpr) };
    }

    /*
     * The title's glyphs for the app (melatonBars.renderKit({ reqId })): Tahoma Bold at the title's size,
     * each printable character drawn alone in the title element with its advance, so the app writes any
     * program's name itself. AndroidBars.publishKit({ reqId, widthPx, h, pad, chars: { ch: { png, adv } } }).
     */
    async function renderKit(ctx) {
        ctx = ctx || {};
        const reqId = Number(ctx.reqId) || 0;
        const out = (o) => { try { if (window.AndroidBars && window.AndroidBars.publishKit) window.AndroidBars.publishKit(JSON.stringify(Object.assign({ reqId, v: 1 }, o))); } catch (err) { console.warn('[melatonBars] publishKit', err); } };
        const shell = document.getElementById('wmShell');
        const top = shell && shell.querySelector('.wm-titlebar');
        const t = top && top.querySelector('.wm-title');
        if (!t) { out({ unsupported: 'no-shell' }); return; }
        if (!window.windowCapture && window.featureLoader) { try { await window.featureLoader.loadFeature('window_capture'); } catch (_) { /* below */ } }
        if (!window.windowCapture) { out({ unsupported: 'no-capture' }); return; }
        const dpr = window.devicePixelRatio || 1;
        const keep = { text: t.textContent, style: t.getAttribute('style') };
        const PAD = 6;
        const chars = {};
        const list = [];
        for (let c = 32; c < 127; c++) list.push(String.fromCharCode(c));
        '…ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÑÒÓÔÕÖØÙÚÛÜÝßàáâãäåæçèéêëìíîïñòóôõöøùúûüýÿ–—‘’“”•™®©'.split('').forEach((ch) => list.push(ch));
        try {
            for (const ch of list) {
                t.textContent = ch === ' ' ? '\u00a0' : ch;
                // alone, as wide as the character (plus room for nothing else), its box the title's height
                t.setAttribute('style', `${keep.style || ''};flex:0 0 auto;min-width:0;width:auto;padding:0 ${PAD}px;overflow:visible`);
                const r = t.getBoundingClientRect();
                const c = await window.windowCapture.snapshot(t, { scale: dpr });
                const p = pack(c, []);
                if (p) chars[ch] = { png: p.png, adv: Math.round((r.width - PAD * 2) * dpr * 100) / 100 };
            }
        } finally {
            t.textContent = keep.text;
            if (keep.style == null) t.removeAttribute('style'); else t.setAttribute('style', keep.style);
        }
        out({ widthPx: Math.round(window.innerWidth * dpr), pad: Math.round(PAD * dpr), chars, geo: barGeometry(dpr) });
    }

    /*
     * The title bar's and the soft key bar's geometry for the app's own drawing, measured on this page's
     * bars staged as over a program (corner shown): device px from the bar's top-left. The app lays the
     * icons out from it (right-aligned at iconsRight, `pitch` apart; around the camera when `hole` is set),
     * the title from titleX until the icons.
     */
    function barGeometry(dpr) {
        const sh = window.wmShell;
        const shell = document.getElementById('wmShell');
        const top = shell && shell.querySelector('.wm-titlebar');
        if (!sh || !sh.barsStage || !top) return null;
        const back = sh.barsStage({ title: 'Melaton', corner: 'close', androidTray: false, softLeft: 'Back', softRight: 'Menu', sip: false });
        try {
            const br = top.getBoundingClientRect();
            const box = (el) => { if (!el || !el.getClientRects().length) return null; const r = el.getBoundingClientRect(); return { x: Math.round((r.left - br.left) * dpr), y: Math.round((r.top - br.top) * dpr), w: Math.round(r.width * dpr), h: Math.round(r.height * dpr) }; };
            const icons = [...top.querySelectorAll('.wm-status-icon')].filter((i) => !i.hidden && !i.classList.contains('wm-shed') && i.getClientRects().length);
            const last = icons[icons.length - 1];
            const st = top.querySelector('.wm-status');
            const gap = st ? (parseFloat(getComputedStyle(st).columnGap) || parseFloat(getComputedStyle(st).gap) || 0) : 0;
            const unit = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--wm-icon-unit')) || (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--wm-px')) || 1);
            const px = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--wm-px')) || 1;
            const t = top.querySelector('.wm-title');
            const tcs = t ? getComputedStyle(t) : null;
            const startImg = top.querySelector('.wm-start img');
            const gapEl = top.querySelector('.wm-cutout-gap');
            const soft = shell.querySelector('.wm-softkeys');
            const keyL = soft && soft.querySelector('.wm-softkey[data-side="left"]');
            const keyR = soft && soft.querySelector('.wm-softkey[data-side="right"]');
            const sip = soft && soft.querySelector('.wm-sip');
            const abs = (u) => { try { return new URL(u, location.href).href; } catch (_) { return ''; } };
            return {
                barH: Math.round(br.height * dpr),
                start: Object.assign(box(startImg) || {}, { src: startImg ? abs(startImg.currentSrc || startImg.src) : '' }),
                titleX: t ? Math.round((t.getBoundingClientRect().left - br.left + (parseFloat(tcs.paddingLeft) || 0)) * dpr) : 0,
                titleY: t ? Math.round((t.getBoundingClientRect().top - br.top) * dpr) : 0,
                titleMin: Math.round(60 * px * dpr),
                icon: last ? Math.round(16 * unit * dpr) : Math.round(16 * px * dpr),
                iconY: last ? Math.round((last.getBoundingClientRect().top - br.top) * dpr) : 0,
                gap: Math.round(gap * dpr * 100) / 100,
                iconsRight: last ? Math.round((last.getBoundingClientRect().right - br.left) * dpr) : 0,
                corner: box(top.querySelector('.wm-title-action')),
                hole: gapEl ? box(gapEl) : null,
                soft: soft ? { h: Math.round(soft.getBoundingClientRect().height * dpr), left: box(keyL), right: box(keyR), sip: box(sip) } : null,
                art: {
                    close: abs('/static_images/wm65/title-close@4x.png'), ok: abs('/static_images/wm65/title-ok@4x.png'),
                    sip: abs('/static_images/wm65/sip-keyboard@4x.png'), base: location.origin
                },
                dpr
            };
        } finally { back(); }
    }

    function withAnims(p, list) { if (p && list && list.length) p.anims = list; return p; }

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
            // (no copy of the title bar: the app's live bar shows under the popup)
            const topPic = null;
            // a notification brings its soft keys (Dismiss / Menu, its two buttons) even where the soft key bar is
            // off over other programs (Yukimi, Nov 16: "so we have access to the 2 buttons for the notification")
            const noteEl = shell.querySelector(':scope > .wm-notify');
            const noteUp = !!(noteEl && !noteEl.hidden);
            const softPic = (ctx.softkeys || noteUp) && soft && soft.getClientRects().length ? await window.windowCapture.snapshot(soft, { scale: dpr }) : null;
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
            // the animated icons at their first frame (Start's copy is a still)
            // and the icons the app draws live left out (their boxes go along): Start shows the same state as the bar
            let unpin = null;
            const topPic = await snap(top, () => { unpin = pinStrips(top); hideNative(top, true); });
            if (unpin) unpin();
            const topNative = nativeBoxes(top, dpr);
            showNative(top);
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
                top: packAt(topPic, top.getBoundingClientRect(), dpr, { regions: regionsOf(top, TOP_MAP, dpr), slots: topNative.slots }),
                bottom: softPic ? packAt(softPic, soft.getBoundingClientRect(), dpr, { regions: regionsOf(soft, SOFT_MAP, dpr) }) : null
            });
        } finally {
            list.style.visibility = listVis;
            list.style.transform = '';
            if (glow) glow.hidden = glowHidden;
            if (startRestore) startRestore();
        }
    }

    /**
     * The 6.5 lock screen for the app's own lock screen over the phone's (#875, Settings > Screen >
     * Android > Use the Windows Mobile lock screen): melatonBars.renderLock({ reqId, parts, fromMs,
     * minutes, phoneWall }) answers AndroidBars.publishLock({ reqId, widthPx, ... }) in device px:
     *   parts 'all': bg (the screen without the slide, the time band, and - phoneWall - the picture and
     *     the layer's black, so the app's phone wallpaper shows through),
     *     slide (at rest, no handle), slidePressed, handle, handleDown, travel, pin (the keypad page,
     *     no dots), area + dots[n] (the entry bar with n dots), keys [{ key, x0, y0, x1, y1, held }]
     *   always: clock [{ at (minute start ms), png }] for `minutes` minutes from fromMs, and the band's box,
     *     so the time stays right while the page sleeps.
     */
    let lockRestore = null;

    /*
     * The lock screen's time band as parts for the app (#875): the band without its three texts, each
     * text's box (the clock right-aligned in its 144 units, AM / PM and the date from their left), the
     * glyphs each one uses with their advances (one element drawn per character, padded so the text
     * shadow is kept), and how this locale writes the time and the date (the order of the parts, a
     * 12-hour clock, padding), so the app lays the strings out from the glyphs.
     */
    async function clockGlyphs(prep, snap, dpr) {
        const time = prep.time;
        const spans = { clock: time.querySelector('.wm-lock65-clock'), ampm: time.querySelector('.wm-lock65-ampm'), date: time.querySelector('.wm-lock65-date') };
        if (!spans.clock || !spans.date) return null;
        const keep = Object.fromEntries(Object.entries(spans).map(([k, e]) => [k, e ? { text: e.textContent, style: e.getAttribute('style') || '' } : null]));
        const out = { pad: 0, boxes: {}, chars: {}, time: [], date: [], hour12: false };
        try {
            // how the time and date are written here (the page's own formats: wmLock65 timeParts / fmtShort)
            const fmtT = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
            const fmtD = new Intl.DateTimeFormat(undefined, { year: '2-digit', month: 'numeric', day: 'numeric' });
            const sample = new Date(2001, 1, 3, 4, 5); // Feb 3 2001, 4:05
            fmtT.formatToParts(sample).forEach((p) => {
                if (p.type === 'dayPeriod') { out.hour12 = true; return; }
                if (p.type === 'literal') { if (p.value.trim()) out.time.push({ lit: p.value.trim() }); return; }
                out.time.push({ part: p.type, pad: p.type === 'hour' ? p.value.length > 1 : true });
            });
            fmtD.formatToParts(sample).forEach((p) => {
                if (p.type === 'literal') { out.date.push({ lit: p.value }); return; }
                out.date.push({ part: p.type, pad: p.value.length > 1 && p.type !== 'year' });
            });
            const periods = out.hour12 ? ['AM', 'PM'].map((_, i) => (fmtT.formatToParts(new Date(2001, 1, 3, i ? 13 : 1)).find((p) => p.type === 'dayPeriod') || {}).value || '') : [];
            out.periods = periods;
            // the boxes with the texts as they are now
            prep.setTime(Date.now());
            const bx = (e) => { const r = e.getBoundingClientRect(); return { x0: Math.round(r.left * dpr), y0: Math.round(r.top * dpr), x1: Math.round(r.right * dpr), y1: Math.round(r.bottom * dpr) }; };
            out.boxes.clock = Object.assign(bx(spans.clock), { align: 'right' });
            if (spans.ampm) out.boxes.ampm = Object.assign(bx(spans.ampm), { align: 'left' });
            out.boxes.date = Object.assign(bx(spans.date), { align: 'left' });
            // the band without its texts
            out.bg = packAt(await snap(time, () => { Object.values(spans).forEach((e) => { if (e) e.style.visibility = 'hidden'; }); }), time.getBoundingClientRect(), dpr);
            Object.values(spans).forEach((e) => { if (e) e.style.visibility = ''; });
            // each glyph: the element alone with that character, its width the advance
            const PAD = 6;
            out.pad = Math.round(PAD * dpr);
            const want = {
                clock: [...new Set('0123456789' + out.time.filter((t) => t.lit).map((t) => t.lit).join(''))],
                ampm: periods.filter(Boolean),
                date: [...new Set('0123456789' + out.date.filter((t) => t.lit).map((t) => t.lit).join(''))]
            };
            for (const [k, list] of Object.entries(want)) {
                const e = spans[k];
                if (!e) continue;
                out.chars[k] = {};
                for (const ch of list) {
                    e.textContent = ch;
                    e.setAttribute('style', `${keep[k].style};width:auto;right:auto;padding:0 ${PAD}px;white-space:pre`);
                    const w = e.getBoundingClientRect().width - PAD * 2;
                    const c = await snap(e);
                    out.chars[k][ch] = { png: pngOf(c), adv: Math.round(w * dpr * 100) / 100 };
                }
            }
        } finally {
            Object.entries(spans).forEach(([k, e]) => { if (e && keep[k]) { e.textContent = keep[k].text; e.setAttribute('style', keep[k].style); if (!keep[k].style) e.removeAttribute('style'); } });
        }
        return out;
    }
    const pngOf = (c) => { const p = pack(c, []); return p ? p.png : ''; };
    async function renderLock(ctx) {
        ctx = ctx || {};
        const reqId = Number(ctx.reqId) || 0;
        const out = (o) => { try { if (window.AndroidBars && window.AndroidBars.publishLock) window.AndroidBars.publishLock(JSON.stringify(Object.assign({ reqId }, o))); } catch (err) { console.warn('[melatonBars] publishLock', err); } };
        if (!window.wmLock || !window.wmLock.barsPrep) { out({ unsupported: 'no-lock' }); return; }
        if (!window.windowCapture && window.featureLoader) { try { await window.featureLoader.loadFeature('window_capture'); } catch (_) { /* below */ } }
        if (!window.windowCapture) { out({ unsupported: 'no-capture' }); return; }
        if (document.visibilityState === 'visible') { out({ unsupported: 'visible' }); return; }
        const dpr = window.devicePixelRatio || 1;
        const prep = window.wmLock.barsPrep();
        if (!prep) { out({ unsupported: 'no-lock' }); return; }
        let restored = false;
        lockRestore = () => { if (restored) return; restored = true; lockRestore = null; try { prep.restore(); } catch (err) { console.warn('[melatonBars] lock restore', err); } };
        const snap = (el, before) => window.windowCapture.snapshot(el, { scale: dpr, before });
        const box = (el) => el.getBoundingClientRect();
        const vis = (el, v) => { el.style.visibility = v; };
        const { layer, slider, handle, time, wall, pin, area, keys } = prep;
        const all = ctx.parts === 'all';
        // v: the pieces' make (the app drops copies of an older make: v2 leaves the layer's black out for the phone wallpaper)
        // phoneWall: made for the phone's own wallpaper under it (the app draws that picture first)
        const o = { v: 3, phoneWall: !!ctx.phoneWall, widthPx: Math.round(box(document.getElementById('wmShell')).width * dpr), parts: all ? 'all' : 'clock' };
        try {
            await Promise.race([
                Promise.all([...layer.querySelectorAll('img')].map((i) => (i.complete && i.naturalWidth ? null : i.decode().catch(() => null)))),
                new Promise((r) => setTimeout(r, 1500))
            ]);
            if (all) {
                const lr = box(layer);
                o.layer = { x: Math.round(lr.left * dpr), y: Math.round(lr.top * dpr), w: Math.round(lr.width * dpr), h: Math.round(lr.height * dpr) };
                o.bg = packAt(await snap(layer, () => { vis(slider, 'hidden'); vis(time, 'hidden'); if (ctx.phoneWall) { vis(wall, 'hidden'); layer.style.background = 'transparent'; } }), lr, dpr);
                vis(slider, ''); vis(time, ''); vis(wall, ''); layer.style.background = '';
                o.slide = packAt(await snap(slider, () => { vis(handle, 'hidden'); }), box(slider), dpr);
                o.slidePressed = packAt(await snap(slider, () => { slider.classList.add('is-pressed'); }), box(slider), dpr);
                vis(handle, '');
                o.handleDown = packAt(await snap(handle), box(handle), dpr);
                slider.classList.remove('is-pressed');
                o.handle = packAt(await snap(handle), box(handle), dpr);
                o.travel = Math.round(prep.travel * dpr);
                // the keypad page: its picture without dots, the entry bar for each count, each key held
                layer.classList.add('is-pin');
                pin.hidden = false;
                prep.pinDots(0);
                o.pin = packAt(await snap(layer, () => { if (ctx.phoneWall) { vis(wall, 'hidden'); layer.style.background = 'transparent'; } }), lr, dpr);
                vis(wall, ''); layer.style.background = '';
                const ar = box(area);
                o.area = { x: Math.round(ar.left * dpr), y: Math.round(ar.top * dpr) };
                o.dots = [];
                for (let n = 0; n <= 12; n++) {
                    prep.pinDots(n);
                    const c = await snap(area);
                    o.dots.push(pngOf(c));
                }
                prep.pinDots(0);
                o.keys = [];
                for (const k of keys) {
                    if (!k.getClientRects().length) continue;
                    const r = box(k);
                    k.classList.add('is-held');
                    const c = await snap(k);
                    k.classList.remove('is-held');
                    o.keys.push({ key: k.dataset.key, x0: Math.round(r.left * dpr), y0: Math.round(r.top * dpr), x1: Math.round(r.right * dpr), y1: Math.round(r.bottom * dpr), held: pngOf(c) });
                }
                pin.hidden = true;
                layer.classList.remove('is-pin');
            }
            // the time band: its picture without the texts and the glyphs the texts are made of, so the app
            // writes the time and date itself (always right, at once, with no page awake: Yukimi, Nov 16)
            const tr = box(time);
            o.band = { x: Math.round(tr.left * dpr), y: Math.round(tr.top * dpr) };
            if (all) o.glyphs = await clockGlyphs(prep, snap, dpr);
            if (restored) { out({ unsupported: 'interrupted' }); return; }
            out(o);
        } finally {
            [slider, handle, time, wall].forEach((e) => vis(e, ''));
            layer.style.background = '';
            if (lockRestore) lockRestore();
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
        if (lockRestore) lockRestore();
        if (window.wmShell && window.wmShell.setBarsExternal) window.wmShell.setBarsExternal(false);
    });

    let renderQueued = null;
    window.melatonBars = {
        // bar copies that wait in the queue are one: the newest ask is the one made (a popup asked for
        // meanwhile then waits behind one copy at most, not a pile of them)
        render: (ctx) => {
            if (renderQueued) { renderQueued.ctx = ctx; return; }
            const slot = { ctx };
            renderQueued = slot;
            serial(() => { if (renderQueued === slot) renderQueued = null; return render(slot.ctx); }).catch((err) => { unstage(); console.warn('[melatonBars] render', err); });
        },
        renderPopup: (ctx) => { serial(() => renderPopup(ctx)).catch((err) => { unstage(); console.warn('[melatonBars] renderPopup', err); }); },
        renderLock: (ctx) => { serial(() => renderLock(ctx)).catch((err) => console.warn('[melatonBars] renderLock', err)); },
        renderKit: (ctx) => { serial(() => renderKit(ctx)).catch((err) => console.warn('[melatonBars] renderKit', err)); },
        renderStart: (ctx) => { serial(() => renderStart(ctx)).catch((err) => console.warn('[melatonBars] renderStart', err)); },
        tap: (role) => { if (window.wmShell && window.wmShell.barsTap) window.wmShell.barsTap(role); },
        unsupported: () => unsupported(document.querySelector('#wmShell .wm-titlebar'))
    };
})();
