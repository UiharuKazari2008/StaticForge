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
    // the screen a kit is being made for ({ density, widthPx } from DSApp's renderKit ctx), while renderKit runs
    let kitTarget = null;
    const stageFor = (o) => (kitTarget ? Object.assign({}, o, { density: kitTarget.density, widthPx: kitTarget.widthPx }) : o);
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
        // the bar's own screen (DSApp passes the bar's width and density, #907): the WebView answering may have been made
        // at another density (the Fold's physical 2.625 against its 2.25 setting), so the bar is laid out and measured
        // for the app's numbers, not this window's
        kitTarget = Number(ctx.density) > 0 && Number(ctx.widthPx) > 0 ? { density: Number(ctx.density), widthPx: Math.round(Number(ctx.widthPx)) } : null;
        const dpr = kitTarget ? kitTarget.density : (window.devicePixelRatio || 1);
        const keep = { text: t.textContent, style: t.getAttribute('style') };
        const PAD = 6;
        const chars = {};
        const list = [];
        for (let c = 32; c < 127; c++) list.push(String.fromCharCode(c));
        '…ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÑÒÓÔÕÖØÙÚÛÜÝßàáâãäåæçèéêëìíîïñòóôõöøùúûüýÿ–—‘’“”•™®©°·×÷±µ§¢£€¥¿¡½¼¾²³¹←→↑↓'.split('').forEach((ch) => list.push(ch));
        // no glyph pictures any more: the app draws the title, soft keys and popups with the page's own Tahoma
        // (melaton-bars-native-layouts rule 5). Writing each character into the title to photograph it showed
        // as text cycling on the visible bar at every start (Yukimi, Nov 16)
        const charsRegular = {};
        void list; void keep; void t;
        // kv: the kit's make (2: the degree sign and more symbols; the app asks again for an older one)
        // font: the face the page draws the bars in, 'tahoma' or 'segoe' (Settings > Screen > Text Size: the app loads
        // segoeui / segoeuib.ttf instead of tahoma / tahomabd.ttf)
        try {
            // the WM notification box for the app's own popup over other programs (#907, DSApp: a notice arriving with
            // the page asleep): its empty frame per body line count, its soft key band, and the boxes it writes into
            let nk = null;
            try { nk = notifyKit(dpr); } catch (err) { console.warn('[melatonBars] notify kit', err); }
            out({ kv: 4, font: document.documentElement.dataset.wmFont === 'segoe' ? 'segoe' : 'tahoma', sig: kitSignature(), widthPx: kitTarget ? kitTarget.widthPx : Math.round(window.innerWidth * dpr), pad: Math.round(PAD * dpr), chars, charsRegular, geo: Object.assign(barGeometry(dpr) || {}, nk ? { notify: nk.geo } : {}), bubble: bubbleStyle(dpr), lists: Object.assign(barLists(dpr) || {}, nk ? { notifyFrame: nk.frames, notifySoft: nk.soft } : {}) });
        } finally { kitTarget = null; }
    }

    /*
     * The title bar's and the soft key bar's geometry for the app's own drawing, measured on this page's
     * bars staged as over a program (corner shown): device px from the bar's top-left. The app lays the
     * icons out from it (right-aligned at iconsRight, `pitch` apart; around the camera when `hole` is set),
     * the title from titleX until the icons.
     */
    /**
     * What the bars' look depends on (the WM version, the theme's art and colours, the scale, the width): the
     * app asks for a new kit when it changes (cursor rule melaton-bars-native-layouts: definitions synced).
     */
    function kitSignature() {
        const root = document.documentElement;
        const cs = getComputedStyle(root);
        // (the first part: the lists' make - a new one makes every app ask for its kit again)
        // the icon unit, the bar's height and the camera extension too (Yukimi, Nov 17: "the icons are never
        // updated in the native bar" - a change to the icons' size or the bar's height kept the app on its old kit)
        const bar = document.querySelector('#wmShell > .wm-titlebar');
        const barH = bar ? Math.round(bar.getBoundingClientRect().height * (window.devicePixelRatio || 1)) : 0;
        return ['m19', root.dataset.wmVersion || '', root.dataset.wmRev || '', root.dataset.wmBars || '', root.dataset.wmFont || '', cs.getPropertyValue('--wm-px').trim(),
            cs.getPropertyValue('--wm-icon-unit').trim(), cs.getPropertyValue('--wm-camera-extend').trim(), root.hasAttribute('data-wm-bar-extend') ? 'x' : '', barH,
            cs.getPropertyValue('--wm-highlight').trim(), cs.getPropertyValue('--wm65-art-msgboxtitle').trim().slice(-80), Math.round(window.innerWidth)].join('|');
    }

    /**
     * The bars' own drawing lists (layoutOf) for the app (barBg: the background alone; start: the Start button alone;
     * barStartOpen: the empty bar with Start pressed; bar: background and Start, for older apps): the title bar empty (its background, Start; no title
     * text, icons or corner), the corner as X and as ok, the soft key bar empty (no labels). WM 6.1 or 6.5, any
     * theme: as this page draws it.
     */
    function barLists(dpr) {
        const sh = window.wmShell;
        const shell = document.getElementById('wmShell');
        const top = shell && shell.querySelector('.wm-titlebar');
        if (!sh || !sh.barsStage || !top) return null;
        const out = {};
        const hideIn = (root, sel) => { const hidden = []; root.querySelectorAll(sel).forEach((n) => { hidden.push([n, n.style.visibility]); n.style.visibility = 'hidden'; }); return () => hidden.forEach(([n, v]) => { n.style.visibility = v; }); };
        for (const kind of ['close', 'ok']) {
            const back = sh.barsStage(stageFor({ title: ' ', corner: kind, androidTray: false, softLeft: 'Back', softRight: 'Menu', sip: false }));
            try {
                const corner = top.querySelector('.wm-title-action');
                out[kind] = corner && !corner.hidden ? layoutOf([corner], dpr) : [];
                if (kind === 'close') {
                    const un = hideIn(top, '.wm-status, .wm-title, .wm-title-action, .wm-status-left, .wm-cutout-gap');
                    try { out.bar = layoutOf([top], dpr); } finally { un(); }
                    // Start as its own element (Yukimi, Nov 18: "the logo is burned into the background layer and is
                    // not an icon"): barBg is the bar without it, start the button alone; barStartOpen the empty bar
                    // with the Start menu open (6.1's pressed glow is the bar's own ::before, not the button's, so it is
                    // the whole bar). `bar` (background and Start together) stays for older apps
                    const startEl = top.querySelector('.wm-start');
                    const rest = '.wm-status, .wm-title, .wm-title-action, .wm-status-left, .wm-cutout-gap';
                    const unBg = hideIn(top, `.wm-start, ${rest}`);
                    try { out.barBg = layoutOf([top], dpr); } finally { unBg(); }
                    if (startEl) {
                        const wasOpen = top.classList.contains('is-start-open');
                        try {
                            top.classList.remove('is-start-open');
                            out.start = layoutOf([startEl], dpr);
                            top.classList.add('is-start-open');
                            const unOpen = hideIn(top, rest);
                            try { out.barStartOpen = layoutOf([top], dpr); } finally { unOpen(); }
                        } finally { top.classList.toggle('is-start-open', wasOpen); }
                    }
                    const soft = shell.querySelector('.wm-softkeys');
                    if (soft) { const un2 = hideIn(soft, '.wm-softkey, .wm-sip'); try { out.soft = layoutOf([soft], dpr); } finally { un2(); } }
                }
            } finally { back(); }
        }
        return out;
    }

    /**
     * The WM notification box as the page lays it out over an Android program, for the app's own popup when the page
     * sleeps (#907, rule cafeready-background): frames[n] = the empty box (title band, body, frame; text hidden) for a
     * body of n lines (1-4: the app picks the frame for the lines it wraps), soft = the soft key bar as it is while a
     * notice is up (black, labels hidden), geo = device px boxes: box, title { bold }, body { lineH, maxLines }, icon
     * (null: WM's notice shows no glyph of its own), softLeft / softRight, colours, and the default labels (Hide /
     * Dismiss; a program's notice may bring its own). Laid out with the bars staged as over a program.
     */
    function notifyKit(dpr) {
        const sh = window.wmShell;
        const shell = document.getElementById('wmShell');
        const el = shell && shell.querySelector(':scope > .wm-notify');
        if (!sh || !sh.barsStage || !el) return null;
        const R = (r) => ({ x: Math.round(r.left * dpr), y: Math.round(r.top * dpr), w: Math.round(r.width * dpr), h: Math.round(r.height * dpr) });
        const rootEl = document.documentElement;
        const keep = { hidden: el.hidden, html: el.innerHTML, note: rootEl.hasAttribute('data-wm-note'), paint: el.dataset.wmPaint };
        const back = sh.barsStage(stageFor({ title: 'Melaton', corner: 'close', androidTray: false, softLeft: 'Hide', softRight: 'Dismiss', sip: false }));
        const out = { frames: {}, soft: null, geo: null };
        try {
            rootEl.setAttribute('data-wm-note', '');
            delete el.dataset.wmPaint;
            el.hidden = false;
            const soft = shell.querySelector('.wm-softkeys');
            for (let n = 1; n <= 4; n++) {
                el.innerHTML = `<div class="wm-notify-title"><span class="wm-notify-name">Melaton</span></div>`
                    + `<div class="wm-notify-body"><div class="toast-content"><div class="toast-message">${Array(n).fill('Melaton Mobile').join('<br>')}</div></div></div>`;
                const name = el.querySelector('.wm-notify-name');
                const msg = el.querySelector('.toast-message');
                settle([el]);
                if (n === 1) {
                    const band = el.querySelector('.wm-notify-title');
                    const ncs = getComputedStyle(name);
                    const mcs = getComputedStyle(msg);
                    const left = soft && soft.querySelector('.wm-softkey[data-side="left"]');
                    const right = soft && soft.querySelector('.wm-softkey[data-side="right"]');
                    const lineH = parseFloat(mcs.lineHeight) || Math.round(parseFloat(mcs.fontSize) * 1.2);
                    out.geo = {
                        box: R(el.getBoundingClientRect()),
                        title: Object.assign(R(name.getBoundingClientRect()), { band: R(band.getBoundingClientRect()), bold: (parseInt(ncs.fontWeight, 10) || 400) >= 600, size: Math.round(parseFloat(ncs.fontSize) * dpr), color: ncs.color }),
                        body: Object.assign(R(msg.getBoundingClientRect()), { lineH: Math.round(lineH * dpr), maxLines: 4, size: Math.round(parseFloat(mcs.fontSize) * dpr), color: mcs.color }),
                        icon: null,
                        softLeft: left && left.getClientRects().length ? Object.assign(R(left.getBoundingClientRect()), { color: getComputedStyle(left).color }) : null,
                        softRight: right && right.getClientRects().length ? Object.assign(R(right.getBoundingClientRect()), { color: getComputedStyle(right).color }) : null,
                        labels: { left: 'Hide', right: 'Dismiss' }
                    };
                }
                // the frame without its words (the app writes them into the boxes above)
                name.style.visibility = 'hidden';
                msg.style.visibility = 'hidden';
                out.frames[n] = { items: layoutOf([el], dpr), box: R(el.getBoundingClientRect()) };
            }
            if (soft) {
                const labels = [...soft.querySelectorAll('.wm-softkey')];
                const was = labels.map((b) => b.style.visibility);
                labels.forEach((b) => { b.style.visibility = 'hidden'; });
                try { out.soft = layoutOf([soft], dpr); } finally { labels.forEach((b, i) => { b.style.visibility = was[i]; }); }
            }
        } finally {
            el.innerHTML = keep.html;
            el.hidden = keep.hidden;
            if (keep.paint) el.dataset.wmPaint = keep.paint;
            if (!keep.note) rootEl.removeAttribute('data-wm-note');
            back();
        }
        return out;
    }

    /** The 6.5 bubble's colours and title band art for the app's own drawing (wm65.css .wm-bubble*). */
    function bubbleStyle(dpr) {
        const cs = getComputedStyle(document.documentElement);
        const v = (k, d) => (cs.getPropertyValue(k) || '').trim() || d;
        const px = parseFloat(v('--wm-px', '1')) || 1;
        const art = /url\(\s*["']?([^"')]+)/.exec(v('--wm65-art-msgboxtitle', '')) || null;
        const abs = (u) => { try { return new URL(u, location.href).href; } catch (_) { return ''; } };
        // a colour as #rrggbb (computed values of the custom properties may be any CSS colour)
        const probe = document.createElement('i');
        document.body.appendChild(probe);
        const hex = (c) => { probe.style.color = ''; probe.style.color = c; const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(getComputedStyle(probe).color); return m ? '#' + [1, 2, 3].map((i) => (+m[i]).toString(16).padStart(2, '0')).join('') : '#000000'; };
        const out = {
            u: Math.round(px * dpr * 1000) / 1000,
            text: hex(v('--wm65-text', '#000')), face: hex(v('--wm65-face', '#fff')), caption: hex(v('--wm65-caption-text', '#fff')),
            highlight: hex(v('--wm-highlight', '#316ac5')),
            titleArt: abs(art ? art[1] : '/static_images/wm65/theme-classicblue-msgboxtitle@2x.png')
        };
        probe.remove();
        return out;
    }

    function barGeometry(dpr) {
        const sh = window.wmShell;
        const shell = document.getElementById('wmShell');
        const top = shell && shell.querySelector('.wm-titlebar');
        if (!sh || !sh.barsStage || !top) return null;
        const back = sh.barsStage(stageFor({ title: 'Melaton', corner: 'close', androidTray: false, softLeft: 'Back', softRight: 'Menu', sip: false }));
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
                // never past the bar's own right end (less its padding): a page laid out wrong for a moment (the inner
                // screen's title width kept after a fold, Nov 18) gave the cover's kit icons right of its 1080 px edge,
                // and the app kept that copy - its bar over other programs showed a clipped "..." and nothing else
                iconsRight: last ? Math.round(Math.min(last.getBoundingClientRect().right - br.left, br.width - (parseFloat(getComputedStyle(top).paddingRight) || 0)) * dpr) : 0,
                corner: box(top.querySelector('.wm-title-action')),
                hole: gapEl ? box(gapEl) : null,
                soft: soft ? { h: Math.round(soft.getBoundingClientRect().height * dpr), left: box(keyL), right: box(keyR), sip: box(sip) } : null,
                art: {
                    close: abs('/static_images/wm65/title-close@4x.png'), ok: abs('/static_images/wm65/title-ok@4x.png'),
                    sip: abs('/static_images/wm65/sip-keyboard@4x.png'), base: location.origin,
                    // the status icons' art set (WM 6.1's square data icons, 6.5's rounded ones): the app's atlas
                    set: document.documentElement.dataset.wmVersion === '6.5' ? 'wm65' : 'wm61'
                },
                dpr
            };
        } finally { back(); }
    }

    /*
     * Native layouts (cursor rule melaton-bars-native-layouts; Yukimi, Nov 16: "any popup must carry the
     * layout file the app can read"): a popup as the page really drew it, written down as a drawing list in
     * device px from the screen's top-left, in paint order -
     *   { k: 'shadow', x, y, w, h, r, blur, dy, color }      the box's shadow
     *   { k: 'rect', x, y, w, h, r: [tl, tr, br, bl], fill }   a background colour
     *   { k: 'img', x, y, w, h, url, clip: [x, y, w, h, r] }   a picture (background or <img>), its box clipped
     *   { k: 'border', x, y, w, h, r, bw: [t, r, b, l], color: [t, r, b, l] }
     *   { k: 'text', x, y, s, size, bold, color, u, ls, live }  one line of text, its box's top-left (y = top
     *                                                            of the font's ascent), letter spacing, a live clock
     *   { k: 'hit', x, y, w, h, act }                          a button / link / control: 'hide' or 'click:<n>'
     * - with the colours as #rrggbbaa. The app draws exactly this; a press it cannot do itself goes back as
     * the page's own click (n = the element's place among the popup's clickable ones).
     */
    function rgba(c, mul) {
        // color(srgb r g b [/ a]) (0-1 channels: Chrome writes a resolved color-mix() this way)
        const cs = /color\(srgb\s+([\d.e-]+)\s+([\d.e-]+)\s+([\d.e-]+)(?:\s*\/\s*([\d.]+))?\)/.exec(c || '');
        if (cs) c = `rgba(${[cs[1], cs[2], cs[3]].map((v) => Math.round(Math.max(0, Math.min(1, +v)) * 255)).join(', ')}, ${cs[4] == null ? 1 : cs[4]})`;
        const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/.exec(c || '');
        if (!m) return null;
        const a = (m[4] == null ? 1 : +m[4]) * (mul == null ? 1 : mul);
        if (a <= 0) return null;
        return '#' + [m[1], m[2], m[3]].map((v) => Math.round(+v).toString(16).padStart(2, '0')).join('') + Math.round(a * 255).toString(16).padStart(2, '0');
    }
    // color-mix(in srgb, A p%, B [q%]) as plain rgba (Chrome keeps it unresolved inside a gradient)
    function mixColor(c) {
        const m = /^color-mix\(in srgb,\s*(rgba?\([^)]*\))\s*([\d.]+)?%?\s*,\s*(rgba?\([^)]*\))\s*([\d.]+)?%?\s*\)$/.exec(String(c || '').trim());
        if (!m) return c;
        const num = (x) => (/rgba?\(([^)]*)\)/.exec(x)[1].split(',').map(Number));
        const a = num(m[1]); const b = num(m[3]);
        const pa = m[2] != null ? +m[2] / 100 : m[4] != null ? 1 - +m[4] / 100 : 0.5;
        const ch = [0, 1, 2].map((i) => Math.round(a[i] * pa + b[i] * (1 - pa)));
        const al = (a[3] == null ? 1 : a[3]) * pa + (b[3] == null ? 1 : b[3]) * (1 - pa);
        return `rgba(${ch.join(', ')}, ${al})`;
    }
    // a gradient's / polygon's arguments split at the commas outside brackets
    function topSplit(v, sep) {
        const out = []; let d = 0; let cur = '';
        for (const ch of String(v || '')) { if (ch === '(') d++; if (ch === ')') d--; if (ch === sep && d === 0) { out.push(cur.trim()); cur = ''; } else cur += ch; }
        if (cur.trim()) out.push(cur.trim());
        return out;
    }
    // a length of a polygon point: px, %, calc(a% +/- bpx) against [of]
    function lenOf(v, of) {
        v = String(v || '').trim();
        if (/^calc\(/.test(v)) {
            let sum = 0;
            v.slice(5, -1).replace(/\s*-\s*/g, ' + -').split(' + ').forEach((t) => { t = t.trim(); if (t.endsWith('%')) sum += (parseFloat(t) / 100) * of; else sum += parseFloat(t) || 0; });
            return sum;
        }
        if (v.endsWith('%')) return (parseFloat(v) / 100) * of;
        return parseFloat(v) || 0;
    }
    /*
     * An inline <svg> (the Car bubble's 1-bit Lock / Unlock / Climate keys and its traffic light, #902) as a PNG
     * at the device px it is drawn at, for the app ({ k: 'img', url: 'data:image/png...' }: Android cannot draw
     * SVG). Made once per drawing, colour and size, kept; the first capture of a new one has none yet and asks
     * for the layouts again when it is ready.
     */
    const svgPngs = new Map();
    let svgAgain = null;
    function svgPicture(el, w, h, color) {
        if (!(w > 0 && h > 0)) return null;
        const key = `${w}x${h}|${color}|${el.outerHTML}`;
        if (svgPngs.has(key)) return svgPngs.get(key);
        svgPngs.set(key, null);
        if (svgPngs.size > 64) svgPngs.delete(svgPngs.keys().next().value);
        const c = el.cloneNode(true);
        c.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        c.setAttribute('width', String(w));
        c.setAttribute('height', String(h));
        c.removeAttribute('class');
        c.style.color = color;
        const img = new Image();
        img.onload = () => {
            try {
                const cv = document.createElement('canvas');
                cv.width = w; cv.height = h;
                const g = cv.getContext('2d');
                g.imageSmoothingEnabled = false;
                g.drawImage(img, 0, 0, w, h);
                svgPngs.set(key, cv.toDataURL('image/png'));
            } catch (_) { svgPngs.delete(key); return; }
            // the layouts again with it (once for a batch of new drawings)
            if (!svgAgain && layoutsRoles) svgAgain = setTimeout(() => { svgAgain = null; if (layoutsRoles) pushLayouts(layoutsRoles); }, 50);
        };
        img.onerror = () => { svgPngs.delete(key); };
        img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(c))}`;
        return null;
    }
    /*
     * The file the page draws, so the app fetches and keeps one copy of each picture at the page's pixels
     * (#890: the first url() of an image-set was the @2x file while the page drew @4x, and an <img> read
     * before it loaded gave its 1x src: two downloads and decoded copies, the native popup softer).
     * image-set(): the smallest density at or above the screen's, else the largest (Chrome's choice).
     */
    function setPick(bg) {
        const set = /image-set\((.*)\)/.exec(bg);
        if (!set) return null;
        const cands = [...set[1].matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)[^,]*?([\d.]+)(x|dppx)\b/g)].map((m) => ({ u: m[1], d: +m[2] })).filter((c) => c.d > 0);
        if (!cands.length) return null;
        cands.sort((a, b) => a.d - b.d);
        const dpr = window.devicePixelRatio || 1;
        return (cands.find((c) => c.d >= dpr) || cands[cands.length - 1]).u;
    }
    /** An <img>'s srcset by density as Blink picks it before it has loaded (a smaller one when the geometric mean allows). */
    function srcsetPick(el) {
        const cands = String(el.getAttribute('srcset') || '').split(',').map((part) => {
            const m = /^\s*(\S+)(?:\s+([\d.]+)x)?\s*$/.exec(part);
            return m ? { u: m[1], d: m[2] ? +m[2] : 1 } : null;
        }).filter(Boolean);
        if (!cands.length) return '';
        cands.sort((a, b) => a.d - b.d);
        const dpr = window.devicePixelRatio || 1;
        let i = cands.findIndex((c) => c.d >= dpr);
        if (i < 0) i = cands.length - 1;
        else if (i > 0 && Math.sqrt(cands[i - 1].d * cands[i].d) > dpr) i -= 1;
        try { return new URL(cands[i].u, location.href).href; } catch (_) { return ''; }
    }

    function layoutOf(roots, dpr) {
        const out = [];
        const R = (v) => Math.round(v * dpr * 100) / 100;
        const px = (v) => parseFloat(v) || 0;
        const clickable = [];
        roots.forEach((r) => r.querySelectorAll(CLICKABLE).forEach((el) => { if (!clickable.includes(el)) clickable.push(el); }));
        const isHide = (el) => (el.tagName === 'BUTTON' || el.classList.contains('wm-softkey')) && /^hide$/i.test((el.textContent || '').trim());
        const radii = (cs) => [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius].map((v) => R(px(v)));
        // clip-path: polygon(...) as device-px points (the volume box's tail, its sliders' arrow thumbs)
        const polyOf = (clipPath, box) => {
            const m = /^polygon\((.*)\)$/.exec(String(clipPath || '').trim());
            if (!m) return null;
            const pts = topSplit(m[1].replace(/^(nonzero|evenodd)\s*,/, ''), ',').map((pt) => {
                const xy = topSplit(pt, ' ');
                return [R(box.left + lenOf(xy[0], box.width)), R(box.top + lenOf(xy[1], box.height))];
            });
            return pts.length >= 3 ? pts : null;
        };
        // a box inset to a background layer's clip (border-box / padding-box / content-box)
        const clipBox = (cs, box, which) => {
            const bw = [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth].map(px);
            const pd = which === 'content-box' ? [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map(px) : [0, 0, 0, 0];
            if (which !== 'content-box' && which !== 'padding-box') return box;
            const t = bw[0] + pd[0]; const r = bw[1] + pd[1]; const btm = bw[2] + pd[2]; const l = bw[3] + pd[3];
            return { left: box.left + l, top: box.top + t, width: Math.max(0, box.width - l - r), height: Math.max(0, box.height - t - btm) };
        };
        const bgImage = (cs, box, clip, alpha) => {
            // several layers (the title bar's ok / X face: two gradients, content-box over padding-box): the
            // bottom one first, each in its own clip box
            const layers = topSplit(cs.backgroundImage || '', ',');
            if (layers.length > 1) {
                const clips = topSplit(cs.backgroundClip || '', ',');
                const sizes = topSplit(cs.backgroundSize || '', ',');
                const poss = topSplit(cs.backgroundPosition || '', ',');
                for (let i = layers.length - 1; i >= 0; i--) {
                    if (layers[i] === 'none') continue;
                    const one = { backgroundImage: layers[i], backgroundSize: sizes[i] || sizes[0] || 'auto', backgroundPosition: poss[i] || poss[0] || '0% 0%',
                        borderTopLeftRadius: cs.borderTopLeftRadius, borderTopRightRadius: cs.borderTopRightRadius, borderBottomRightRadius: cs.borderBottomRightRadius, borderBottomLeftRadius: cs.borderBottomLeftRadius };
                    bgImage(one, clipBox(cs, box, clips[i] || clips[0] || 'border-box'), clip, alpha);
                }
                return;
            }
            // a plain linear-gradient (the volume box's title band): its stops, top to bottom or left to right
            const lg = /^linear-gradient\((.*)\)$/.exec(cs.backgroundImage || '');
            if (lg) {
                const args = topSplit(lg[1], ',');
                let dir = 'v';
                if (/^(to |[\d.]+deg)/.test(args[0])) { const a = args.shift(); dir = /to (right|left)|90deg|270deg/.test(a) ? 'h' : 'v'; if (/to (top|left)|0deg|270deg/.test(a)) args.reverse(); }
                const stops = args.map((a, i) => {
                    const mm = /^(.*?)(?:\s+([\d.]+)%)?$/.exec(a);
                    return [rgba(mixColor(mm[1]), alpha), mm[2] != null ? +mm[2] / 100 : i / Math.max(1, args.length - 1)];
                }).filter((st) => st[0]);
                if (stops.length >= 2) { out.push({ k: 'grad', x: R(box.left), y: R(box.top), w: R(box.width), h: R(box.height), r: radii(cs), dir, stops }); return; }
            }
            // WM's block bar: repeating-linear-gradient(to right, c 0, c Apx, transparent Apx, transparent Bpx)
            // (its stops read one by one: Chrome writes transparent as rgba(0, 0, 0, 0), commas and all)
            const rg = /^repeating-linear-gradient\(\s*(?:to right|90deg)\s*,(.*)\)$/.exec(cs.backgroundImage || '');
            if (rg) {
                const stops = [...rg[1].matchAll(/(rgba?\([^)]*\)|transparent)\s+(-?[\d.]+)px/g)].map((m) => ({ c: m[1], at: +m[2] }));
                if (stops.length >= 4) {
                    out.push({ k: 'stripes', x: R(box.left), y: R(box.top), w: R(box.width), h: R(box.height), color: rgba(stops[0].c, alpha), on: R(stops[1].at), period: R(stops[stops.length - 1].at) });
                    return;
                }
            }
            const first = setPick(cs.backgroundImage || '') || /url\(\s*["']?([^"')]+)/.exec(cs.backgroundImage || '');
            if (!first) return;
            const url = new URL(typeof first === 'string' ? first : first[1], location.href).href;
            // the size and place as CSS resolved them (px or %; 'auto' keeps the picture's own ratio: the box)
            // split at the spaces outside brackets: "calc(100% + 18px) 104.545%" is two values, not four
            const parts = (v) => { const out2 = []; let d = 0; let cur = ''; for (const ch of String(v || '')) { if (ch === '(') d++; if (ch === ')') d--; if (ch === ' ' && d === 0) { if (cur) out2.push(cur); cur = ''; } else cur += ch; } if (cur) out2.push(cur); return out2; };
            const sz = parts(cs.backgroundSize);
            // a length: px, %, auto / cover / contain (the box), or calc() of % and px terms (the 6.5 title band:
            // calc(100% + 18px)) - NaN in the list made the app's popups one pixel wide
            const toLen = (v, of) => {
                if (!v || v === 'auto' || v === 'cover' || v === 'contain') return of;
                if (/^calc\(/.test(v)) {
                    let sum = 0;
                    const body = v.slice(5, -1).replace(/\s*-\s*/g, ' + -').replace(/\s+/g, ' ');
                    body.split(' + ').forEach((t) => { t = t.trim(); if (t.endsWith('%')) sum += (parseFloat(t) / 100) * of; else if (t.endsWith('px')) sum += parseFloat(t); });
                    return Number.isFinite(sum) && sum > 0 ? sum : of;
                }
                const n = v.endsWith('%') ? (parseFloat(v) / 100) * of : px(v);
                return Number.isFinite(n) ? n : of;
            };
            const w = toLen(sz[0] || 'auto', box.width);
            const h = toLen(sz[1] || sz[0] || 'auto', box.height);
            const pos = parts(cs.backgroundPosition || '0% 0%');
            const place = (v, room) => { const n = v.endsWith('%') ? (parseFloat(v) / 100) * room : px(v); return Number.isFinite(n) ? n : 0; };
            const x = box.left + place(pos[0] || '0%', box.width - w);
            const y = box.top + place(pos[1] || '0%', box.height - h);
            out.push({ k: 'img', x: R(x), y: R(y), w: R(w), h: R(h), url, clip, alpha: alpha < 1 ? alpha : undefined });
        };
        const walk = (el, inherited) => {
            if (!el.getClientRects().length) return;
            // a live field (data-live): what the app fills in itself while the popup is up (ActiveSync's
            // numbers and bar from its own transfer counts: this page is frozen behind a program)
            const lv = el.dataset ? el.dataset.live : null;
            const n0 = out.length;
            const cs = getComputedStyle(el);
            if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) return;
            // opacity multiplies down the tree (the unlit signal bars at .45)
            const alpha = (inherited == null ? 1 : inherited) * (+cs.opacity || 1);
            const b = el.getBoundingClientRect();
            const r = radii(cs);
            const clip = [R(b.left), R(b.top), R(b.width), R(b.height), r];
            // a drawing (inline SVG): sent as a picture of itself
            if (typeof SVGSVGElement !== 'undefined' && el instanceof SVGSVGElement) {
                const url = svgPicture(el, Math.round(b.width * dpr), Math.round(b.height * dpr), cs.color);
                if (url) out.push({ k: 'img', x: R(b.left), y: R(b.top), w: R(b.width), h: R(b.height), url, clip, alpha: alpha < 1 ? alpha : undefined });
                return;
            }
            const sh = /^(rgba?\([^)]*\))\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px/.exec(cs.boxShadow || '');
            if (sh && !/inset/.test(cs.boxShadow)) out.push({ k: 'shadow', x: R(b.left), y: R(b.top), w: R(b.width), h: R(b.height), r, blur: R(px(sh[4])), dy: R(px(sh[3])), color: rgba(sh[1], alpha) });
            const fill = rgba(cs.backgroundColor, alpha);
            if (fill) out.push({ k: 'rect', x: R(b.left), y: R(b.top), w: R(b.width), h: R(b.height), r, fill });
            if (cs.backgroundImage && cs.backgroundImage !== 'none') bgImage(cs, b, clip, alpha);
            // an inset shadow with no blur is a frame drawn inside the box (the signal bars' outlines)
            const ins = /(rgba?\([^)]*\))\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px\s+([\d.]+)px\s+inset|inset\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px\s+([\d.]+)px\s+(rgba?\([^)]*\))/.exec(cs.boxShadow || '');
            if (ins) {
                const color = ins[1] || ins[10];
                const spread = +(ins[5] || ins[9]);
                const blur = +(ins[4] || ins[8]);
                if (!blur && spread > 0) { const sw = R(spread); out.push({ k: 'border', x: R(b.left), y: R(b.top), w: R(b.width), h: R(b.height), r, bw: [sw, sw, sw, sw], color: [0, 1, 2, 3].map(() => rgba(color, alpha)) }); }
            }
            if (el.tagName === 'IMG' && (el.currentSrc || el.src)) out.push({ k: 'img', x: R(b.left), y: R(b.top), w: R(b.width), h: R(b.height), url: el.currentSrc || srcsetPick(el) || el.src, clip });
            const bw = [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth].map((v) => R(px(v)));
            if (bw.some((v) => v > 0)) {
                const bc = [cs.borderTopColor, cs.borderRightColor, cs.borderBottomColor, cs.borderLeftColor].map((c) => rgba(c, alpha));
                if (bc.some(Boolean)) out.push({ k: 'border', x: R(b.left), y: R(b.top), w: R(b.width), h: R(b.height), r, bw, color: bc });
            }
            const ownPoly = polyOf(cs.clipPath, b);
            if (ownPoly) for (let i = n0; i < out.length; i++) out[i].poly = ownPoly;
            // pseudo-elements with a picture or colour (radio dots, the warning glyph, the keyboard key)
            ['::before', '::after'].forEach((pe) => {
                const ps = getComputedStyle(el, pe);
                // (a pressed state's art waits at opacity 0: Start's and the corner's highlight)
                if (!ps || ps.content === 'none' || ps.display === 'none' || ps.visibility === 'hidden' || +ps.opacity === 0) return;
                if (ps.position !== 'absolute') return;
                const w = px(ps.width); const h = px(ps.height);
                if (!w || !h) return;
                const box = { left: b.left + px(ps.left), top: b.top + px(ps.top), width: w, height: h };
                const pa = alpha * (+ps.opacity || 1);
                const pf = rgba(ps.backgroundColor, pa);
                const p0 = out.length;
                // a glyph cut by a mask (the title bar's ok / X: white through the glyph's alpha): the picture and
                // its colour, the app tints it
                const mi = ps.webkitMaskImage || ps.maskImage || '';
                const mu = [...String(mi).matchAll(/url\(\s*["']?([^"')]+)/g)].map((m) => m[1]);
                if (mu.length && pf) {
                    const sz = topSplit(ps.webkitMaskSize || ps.maskSize || '', ' ');
                    const po = topSplit(ps.webkitMaskPosition || ps.maskPosition || '', ' ');
                    const mw = sz[0] && sz[0] !== 'auto' ? lenOf(sz[0], w) : w; const mh = sz[1] && sz[1] !== 'auto' ? lenOf(sz[1], h) : mw === w ? h : mw;
                    out.push({ k: 'mask', x: R(box.left + lenOf(po[0] || '0px', w - mw)), y: R(box.top + lenOf(po[1] || '0px', h - mh)), w: R(mw), h: R(mh),
                        url: new URL(mu[mu.length - 1], location.href).href, color: pf, clip: [R(box.left), R(box.top), R(w), R(h), [0, 0, 0, 0]] });
                    return;
                }
                if (pf) out.push({ k: 'rect', x: R(box.left), y: R(box.top), w: R(w), h: R(h), r: radii(ps), fill: pf });
                if (ps.backgroundImage && ps.backgroundImage !== 'none') bgImage(ps, box, clip, pa);
                const pp = polyOf(ps.clipPath, box);
                if (pp) for (let i = p0; i < out.length; i++) out[i].poly = pp;
            });
            // its own text, line by line (a line: the characters on one row), in its font
            [...el.childNodes].forEach((n) => {
                if (n.nodeType !== 3 || !n.textContent.trim()) return;
                const range = document.createRange();
                const text = n.textContent;
                let line = null;
                // w: the line's width as the browser laid it out (the app fits its run to it: its hinted advances differ by a few %)
                const flush = () => { if (line && line.s.trim()) { line.w = R((line.r - line.l) / dpr); delete line.r; delete line.l; out.push(line); } line = null; };
                // one line (most labels): the whole run measured at once, not character by character
                range.selectNodeContents(n);
                const whole = range.getClientRects();
                if (whole.length === 1 && whole[0].width) {
                    const rr = whole[0];
                    const one = { k: 'text', x: R(rr.left), y: R(rr.top), h: R(rr.height), s: text.replace(/\s+/g, ' ').trim() === text.trim() ? text : text, size: R(px(cs.fontSize)), bold: (+cs.fontWeight || 400) >= 600, color: rgba(cs.color, alpha) || '#000000ff',
                        u: /underline/.test(cs.textDecorationLine || cs.textDecoration || ''), ls: R(px(cs.letterSpacing)), w: R(rr.width) };
                    // leading / trailing white space collapses in the page: the drawn text starts at the first letter
                    one.s = text.replace(/^\s+|\s+$/g, '').replace(/\s+/g, ' ');
                    if (el.classList.contains('wm-vpn-time')) { const ws = window.wsClient; one.live = (ws && ws.connectionStats && ws.connectionStats.connectedAt) || null; }
                    if (one.s) out.push(one);
                    return;
                }
                for (let i = 0; i < text.length; i++) {
                    range.setStart(n, i); range.setEnd(n, i + 1);
                    const rr = range.getClientRects()[0];
                    if (!rr || !rr.width) { if (line) line.s += text[i]; continue; }
                    if (!line || Math.abs(R(rr.top) - line.y) > 1) {
                        flush();
                        line = { k: 'text', x: R(rr.left), y: R(rr.top), h: R(rr.height), s: '', size: R(px(cs.fontSize)), bold: (+cs.fontWeight || 400) >= 600, color: rgba(cs.color, alpha) || '#000000ff',
                            u: /underline/.test(cs.textDecorationLine || cs.textDecoration || ''), ls: R(px(cs.letterSpacing)) };
                        if (el.classList.contains('wm-vpn-time')) { const ws = window.wsClient; line.live = (ws && ws.connectionStats && ws.connectionStats.connectedAt) || null; }
                    }
                    line.s += text[i];
                    if (line.l === undefined) line.l = rr.left * dpr;
                    line.r = rr.right * dpr;
                }
                flush();
            });
            // the bubble's tail: the app moves it under its own icon (the page's anchor may be off while it sleeps)
            if (el.classList && el.classList.contains('wm-bubble-tail')) for (let i = n0; i < out.length; i++) { out[i].lv = 'tail'; out[i].tip = R(b.left + b.width / 2); }
            if (lv) {
                let full;
                // a bar with a set travel (data-full, in WM units: the Power box's 18 blocks of 9)
                if (el.dataset.full) full = R((+el.dataset.full) * (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--wm-px')) || 1));
                else if (lv.endsWith('-bar') && el.parentElement) {
                    // the bar's whole width: the frame's inside less the fill's own inset (wm-progress-bar)
                    const pe = el.parentElement; const pcs = getComputedStyle(pe); const pb = pe.getBoundingClientRect();
                    const wmpx = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--wm-px')) || 1;
                    full = R(pb.width - px(pcs.borderLeftWidth) - px(pcs.borderRightWidth) - px(pcs.paddingLeft) - px(pcs.paddingRight) - 2 * wmpx);
                }
                for (let i = n0; i < out.length; i++) { out[i].lv = lv; if (full != null) out[i].full = full; }
            }
            [...el.children].forEach((c) => walk(c, alpha));
            // a control the app works itself (the volume sliders): its travel, top = the highest step
            if (el.dataset && el.dataset.control === 'slider') {
                const steps = +el.getAttribute('aria-valuemax') || 10;
                const ticks = [...el.querySelectorAll('.wm-vol-tick')].map((t) => { const r = t.getBoundingClientRect(); return r.top + r.height / 2; });
                if (ticks.length > 1) out.push({ k: 'hit', x: R(b.left), y: R(b.top), w: R(b.width), h: R(b.height), act: `slider:${el.dataset.kind}:${steps}:${R(Math.min(...ticks))}:${R(Math.max(...ticks))}` });
            }
            // the volume box's On / Vibrate / Off: the app draws the dot at Android's ringer mode and sets it itself
            if (el.tagName === 'INPUT' && el.type === 'radio' && el.name === 'wmvolmode') {
                const wmpx = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--wm-px')) || 1;
                out.push({ k: 'dot', x: R(b.left), y: R(b.top), w: R(b.width), h: R(b.height), r: R(4.5 * wmpx), color: '#000000ff', lv: `vol-mode:${el.value}` });
                out.push({ k: 'hit', x: R(b.left), y: R(b.top), w: R(b.width), h: R(b.height), act: `mode:${el.value}` });
                [...el.children].forEach((c) => walk(c, alpha));
                return;
            }
            const ci = clickable.indexOf(el);
            if (ci >= 0) out.push({ k: 'hit', x: R(b.left), y: R(b.top), w: R(b.width), h: R(b.height), act: isHide(el) ? 'hide' : `click:${ci}` });
        };
        roots.forEach((r) => walk(r));
        return out;
    }

    /**
     * Every popup of the bar written down (layoutOf) for the app, while this page is behind a program:
     * each role's popup opened here as a tap would, its drawing list taken, closed again. Pushed as
     * AndroidBars.layouts({ role: { role, items } }) when something changed.
     */
    // the soft key bar's labels while a popup is open (a notification's Hide / Dismiss, a box's own keys): the app
    // shows them on its soft key bar while it draws that popup ([left, right], '' for none)
    function softLabels() {
        const sh = document.querySelector('#wmShell .wm-softkeys');
        if (!sh) return null;
        const lab = (side) => { const b = sh.querySelector(`.wm-softkey[data-side="${side}"]`); return b && !b.hidden && !b.disabled ? (b.textContent || b.getAttribute('aria-label') || '').trim() : ''; };
        const l = lab('left'); const r = lab('right');
        return l || r ? [l, r] : null;
    }
    let layoutsSent = '';
    // the last full set: a push of one popup (an ActiveSync transfer's numbers) replaces only that one
    let layoutsAll = {};
    // the notification box is up (a waiting notification stays through barsPopupClose)
    function noteUp() {
        const n = document.querySelector('#wmShell > .wm-notify');
        return !!(n && !n.hidden && n.getClientRects().length);
    }
    // the popups' own fades and slides finished at once (a capture mid-fade wrote down nothing at opacity 0)
    function settle(layers) {
        layers.forEach((l) => { try { l.getAnimations({ subtree: true }).forEach((a) => { try { a.finish(); } catch (_) { /* infinite: left */ } }); } catch (_) { /* old engine */ } });
    }
    // set while this page opens its popups to write them down (the notification box it opens is not a new one)
    let capturing = false;
    let notesMO = null;
    // the roles of the last full push (a drawing made since asks for them again: svgPicture)
    let layoutsRoles = null;
    function pushLayouts(roles, partial) {
        if (!partial) layoutsRoles = roles;
        const sh = window.wmShell;
        const ab = window.AndroidBars;
        if (!sh || !sh.barsPopupOpen || !ab || typeof ab.layouts !== 'function' || document.visibilityState === 'visible') return;
        capturing = true;
        try { pushLayoutsNow(sh, roles, partial); } finally { if (notesMO) notesMO.takeRecords(); capturing = false; }
    }
    /**
     * The bar's screen in device px ({ w, h }), from the app (AndroidBars.screenSize), or null. A page behind a
     * program keeps the size it last had on screen: a Fold folded since is still laid out for the inner screen
     * (1968 px) while the bars draw on the cover (1080), and every popup ran off the right edge with its text
     * on one line, sitting too high (Yukimi, Nov 17, #891).
     */
    function barScreen() {
        try {
            const ab = window.AndroidBars;
            if (!ab || typeof ab.screenSize !== 'function') return null;
            const s = JSON.parse(ab.screenSize() || 'null');
            return s && s.w > 0 && s.h > 0 ? s : null;
        } catch (_) { return null; }
    }

    /** Lays the shell out at the bar's screen size while fn runs (the popups wrap and anchor as they would there). */
    function atBarScreen(dpr, fn) {
        const s = barScreen();
        const shell = document.getElementById('wmShell');
        const w = s ? s.w / dpr : window.innerWidth;
        const h = s ? s.h / dpr : window.innerHeight;
        if (!shell || !s || (Math.abs(w - window.innerWidth) < 1 && Math.abs(h - window.innerHeight) < 1)) return fn(window.innerWidth, window.innerHeight);
        const prev = shell.getAttribute('style');
        shell.style.right = 'auto';
        shell.style.bottom = 'auto';
        shell.style.width = `${w}px`;
        shell.style.height = `${h}px`;
        try { return fn(w, h); } finally { if (prev == null) shell.removeAttribute('style'); else shell.setAttribute('style', prev); }
    }

    function pushLayoutsNow(sh, roles, partial) {
        const dpr = window.devicePixelRatio || 1;
        atBarScreen(dpr, (vw, vh) => pushLayoutsAt(sh, roles, partial, dpr, vw, vh));
    }

    function pushLayoutsAt(sh, roles, partial, dpr, vw, vh) {
        const all = {};
        for (const role of roles) {
            try {
                // the notification icon with nothing waiting opens nothing: no layout (and no box popped in the page)
                if (role === 'notify') {
                    const ni = document.querySelector('#wmShell .wm-status-icon[data-role="notify"]');
                    if (!ni || ni.hidden) continue;
                }
                sh.barsPopupClose();
                // a notification already up is not opened again (that toggles it away mid-capture)
                if (!(role === 'notify' && noteUp())) sh.barsPopupOpen(role);
                // (a waiting notification is the notification icon's own popup, not part of another's)
                const layers = sh.barsPopupLayers().filter((l) => !l.classList.contains('wm-notify-scrim') && (role === 'notify' || !l.classList.contains('wm-notify')));
                // written down as it ends up, not mid-way through its fade (WM 6.1's notification fades in)
                settle(layers);
                // pw: the width it was laid out at (the app moves it on a turned screen)
                // pw / ph: the size it was laid out at (the app fits it to another one, and asks again)
                if (layers.length) { all[role] = { role, items: layoutOf(layers, dpr), pw: Math.round(vw * dpr), ph: Math.round(vh * dpr) }; const sk = softLabels(); if (sk) all[role].soft = sk; }
            } catch (err) { console.warn('[melatonBars] layout', role, err); }
        }
        try { sh.barsPopupClose(); } catch (_) { /* none open */ }
        if (partial) { layoutsAll = Object.assign({}, layoutsAll, all); sendLayouts(Object.assign({}, layoutsAll)); return; }
        layoutsAll = all;
        sendLayouts(all);
    }

    // pictures the page made itself (blob: the theme's title band) go to the app as data: (it cannot open a
    // blob of this page); kept per address
    const dataUrls = new Map();
    async function sendLayouts(all) {
        const ab = window.AndroidBars;
        const blobs = new Set();
        Object.values(all).forEach((l) => l.items.forEach((it) => { if (it.k === 'img' && /^blob:/.test(it.url)) blobs.add(it.url); }));
        for (const u of blobs) {
            if (dataUrls.has(u)) continue;
            try {
                const b = await (await fetch(u)).blob();
                dataUrls.set(u, await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => res(''); r.readAsDataURL(b); }));
            } catch (_) { dataUrls.set(u, ''); }
        }
        Object.values(all).forEach((l) => l.items.forEach((it) => { if (it.k === 'img' && dataUrls.get(it.url)) it.url = dataUrls.get(it.url); }));
        // a new title band (a theme or size change) is a new blob: the oldest copies of ones no layout
        // uses now go past eight (#890: a data URL per band ever made stayed)
        for (const k of [...dataUrls.keys()]) {
            if (dataUrls.size <= 8) break;
            if (!blobs.has(k)) dataUrls.delete(k);
        }
        const json = JSON.stringify(all);
        if (json === layoutsSent) return;
        layoutsSent = json;
        try { ab.layouts(json); } catch (_) { /* older app */ }
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
            // a Hide button only closes the popup: the app closes it at once and tells this page after (kind 'hide')
            const isHide = (el) => (el.tagName === 'BUTTON' || el.classList.contains('wm-softkey')) && /^hide$/i.test((el.textContent || '').trim());
            const regions = list.map((el, idx) => { const r = el.getBoundingClientRect(); return Object.assign({ idx, x0: Math.round(r.left * dpr), y0: Math.round(r.top * dpr), x1: Math.round(r.right * dpr), y1: Math.round(r.bottom * dpr) }, isHide(el) ? { kind: 'hide' } : {}); });
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
        notesMO = new MutationObserver(() => {
            if (capturing || !window.wmShell || !window.AndroidBars || document.visibilityState === 'visible') return;
            try {
                // its layout first (the app draws it from that), then the ask to show it
                if (!note.hidden) { pushLayouts(['notify'], true); if (window.AndroidBars.popupWanted) window.AndroidBars.popupWanted(); }
                else if (note.hidden && window.AndroidBars.popupGone) window.AndroidBars.popupGone();
            } catch (_) { /* older app */ }
        });
        notesMO.observe(note, { attributes: true, attributeFilter: ['hidden'] });
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
    let popupQueued = null;
    window.melatonBars = {
        // the app's screen changed size (a Fold folded or opened) with layouts kept for the other one: again, at the new size
        relayout: () => { try { const roles = Object.keys(layoutsAll || {}); if (roles.length) pushLayouts(roles, false); } catch (err) { console.warn('[melatonBars] relayout', err); } },
        // bar copies that wait in the queue are one: the newest ask is the one made (a popup asked for
        // meanwhile then waits behind one copy at most, not a pile of them)
        render: (ctx) => {
            if (renderQueued) { renderQueued.ctx = ctx; return; }
            const slot = { ctx };
            renderQueued = slot;
            serial(() => { if (renderQueued === slot) renderQueued = null; return render(slot.ctx); }).catch((err) => { unstage(); console.warn('[melatonBars] render', err); });
        },
        // popup asks waiting in the queue are one (the newest); a press is never merged away
        renderPopup: (ctx) => {
            const press = ctx && ctx.click != null;
            if (!press && popupQueued) { popupQueued.ctx = ctx; return; }
            const slot = { ctx };
            if (!press) popupQueued = slot;
            serial(() => { if (popupQueued === slot) popupQueued = null; return renderPopup(slot.ctx); }).catch((err) => { unstage(); console.warn('[melatonBars] renderPopup', err); });
        },
        renderLock: (ctx) => { serial(() => renderLock(ctx)).catch((err) => console.warn('[melatonBars] renderLock', err)); },
        /**
         * A press on a popup the app drew (its hit 'click:n'): done here as the page's own click, then the app
         * hears AndroidBars.layoutResult({ role, result: 'app' | 'popup' | 'closed' }) - a program came up (the
         * page goes in front), the popup changed (its new layout comes with it), or it went.
         */
        layoutClick: (ctx) => {
            const sh = window.wmShell;
            const ab = window.AndroidBars;
            if (!sh || !ab || typeof ab.layoutResult !== 'function') return;
            const role = ctx && ctx.role;
            const before = sh.currentApp();
            let result = 'closed';
            capturing = true;
            try {
                sh.barsPopupClose();
                if (!(role === 'notify' && noteUp())) sh.barsPopupOpen(role);
                const layers = sh.barsPopupLayers().filter((l) => !l.classList.contains('wm-notify-scrim'));
                const list = [];
                layers.forEach((r) => r.querySelectorAll(CLICKABLE).forEach((el) => { if (!list.includes(el)) list.push(el); }));
                // a soft key the app showed for this popup: that key of the page's bar
                const el = ctx.soft ? document.querySelector(`#wmShell .wm-softkeys .wm-softkey[data-side="${ctx.soft}"]`) : list[Number(ctx.n)];
                if (el) el.click();
                if (sh.currentApp() !== before) result = 'app';
                else {
                    const now = sh.barsPopupLayers().filter((l) => !l.classList.contains('wm-notify-scrim'));
                    settle(now);
                    if (now.length) {
                        const items = layoutOf(now, window.devicePixelRatio || 1);
                        result = 'popup';
                        const layout = { role, items, pw: Math.round(window.innerWidth * (window.devicePixelRatio || 1)) };
                        const sk = softLabels();
                        if (sk) layout.soft = sk;
                        sh.barsPopupClose();
                        if (notesMO) notesMO.takeRecords();
                        capturing = false;
                        ab.layoutResult(JSON.stringify({ role, result, layout }));
                        return;
                    }
                }
            } catch (err) { console.warn('[melatonBars] layoutClick', err); }
            if (result !== 'app') { try { sh.barsPopupClose(); } catch (_) { /* gone */ } }
            if (notesMO) notesMO.takeRecords();
            capturing = false;
            ab.layoutResult(JSON.stringify({ role, result }));
        },
        /** wmShell barsStatusPush: the popups' layouts written down again (the roles on the bar now). */
        pushLayouts: (roles, partial) => pushLayouts(roles || [], !!partial),
        kitSignature: () => kitSignature(),
        // a popup's drawing list as the app gets it (checks: wmShell.barsPopupOpen(role), then this on its layers)
        layoutOf: (roots, dpr) => layoutOf(roots, dpr || window.devicePixelRatio || 1),
        renderKit: (ctx) => { serial(() => renderKit(ctx)).catch((err) => console.warn('[melatonBars] renderKit', err)); },
        renderStart: (ctx) => { serial(() => renderStart(ctx)).catch((err) => console.warn('[melatonBars] renderStart', err)); },
        tap: (role) => { if (window.wmShell && window.wmShell.barsTap) window.wmShell.barsTap(role); },
        unsupported: () => unsupported(document.querySelector('#wmShell .wm-titlebar'))
    };
})();
