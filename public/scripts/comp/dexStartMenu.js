/**
 * Vista's Start menu on the DeX desktop, drawn by the app over Android's windows (StaticForge #1055).
 *
 * On the DeX screen this page is the screen's home, under every Android window, so the Start menu (#startMenu,
 * modalUtils.js) is hidden wherever a program's window covers it. When it opens with an Android window over its area and the
 * app can draw it (window.AndroidStartMenu ready(): its accessibility service follows this screen), the page writes its
 * menu down as a drawing list from its own rendering (cursor rule melaton-bars-native-layouts: the page is the point of
 * truth, nothing is copied into the app by hand) and DSApp's DexStartMenu draws exactly that above every window, with the
 * glass's blur. The page's own menu stays laid out and working but unseen (.is-dex-native); the app hands every pointer
 * event over its copy to this WebView as real input (so :hover, clicks, the right button, the wheel and the scrollbar
 * behave as in the page) and, while a program has the keyboard, the keys too ('androidhotkey' with start: true; typed
 * characters go into the focused field here). Whatever the page then shows is written down again.
 *
 * What the app does at once, without waiting for the page (declared in the list):
 *   - hover layers ({ k: 'hover' }): a row's highlight (its ::before with an opacity transition), shown while the pointer
 *     is over its box, fading in / out in the page's own times; 'hot' rows (keyboard choice) show while the pointer is
 *     elsewhere;
 *   - scrollers ({ k: 'scroller' }): their content in content coordinates, moved by { op: 'scroll' } alone;
 *   - the vertical scrollbar ({ k: 'vsb' }): Vista's parts (the page's ::-webkit-scrollbar art) in their states;
 *   - the caret ({ k: 'caret' }) blinking;
 *   - fades ({ fade: [from, ms, id] } on an item, frame.fade for the whole menu): CSS transitions and animations running
 *     when the list was written (written at their end state, the app runs them).
 *
 * Sent over window.AndroidStartMenuPort (a WebMessageListener, in order):
 *   - pictures the lists name that the app lacks: binary [u16 key length][key utf-8][png / jpeg bytes] (no-base64-images);
 *     keys 'p:<url>' picture files (kept by the app), 'g:<glyph>' Font Awesome glyphs drawn here, 'sb:<part>' the
 *     scrollbar's art, 'c:<n>:<v>' canvases;
 *   - { op: 'frame', sid, vw, bounds, parts: { name: items | absent when unchanged }, order: [names], fade } - again
 *     whenever anything drawn changed;
 *   - { op: 'scroll', sid, id, top }, { op: 'hide', sid, ms } (the menu's own fade-out time).
 * App -> page: 'androidstartmenu' { sid, state: 'outside' | 'failed' } - a press outside the copy (on a program's
 * window), or the copy could not be shown (the page shows its own menu again).
 *
 * Only in the DeX desktop window (AndroidDisplay.isDesktop() with the bridge present). Nothing runs while Start is closed
 * but one attribute observer on #startMenu's class.
 */
(function () {
    'use strict';

    const root = typeof window !== 'undefined' ? window : null;
    const doc = typeof document !== 'undefined' ? document : null;
    if (!root || !doc) return;
    const isDesktop = (() => {
        try { return !!(root.AndroidDisplay && typeof root.AndroidDisplay.isDesktop === 'function' && root.AndroidDisplay.isDesktop()); } catch (_) { return false; }
    })();
    const A0 = root.AndroidStartMenu;
    if (!isDesktop || root.uiShell === 'mobile' || !A0 || typeof A0.ready !== 'function') return;
    // read at each call: a desktop paused with its display unplugged gets the new window's bridge when it resumes (#1015)
    const A = () => root.AndroidStartMenu || A0;
    const port = () => root.AndroidStartMenuPort || null;
    const appScopeSignal = (root.melatonSegments && typeof root.melatonSegments.callerSignal === 'function' && root.melatonSegments.callerSignal()) || undefined;
    // this copy's life (a newer copy of the script, a live update, puts the old one away first)
    if (root.melatonDexStartMenu && typeof root.melatonDexStartMenu.dispose === 'function') root.melatonDexStartMenu.dispose();
    const life = new AbortController();
    if (appScopeSignal) appScopeSignal.addEventListener('abort', () => life.abort(), { once: true });
    const lifeSignal = life.signal;
    let followMo = null;

    const NATIVE = 'is-dex-native';
    // the page's own copy stays laid out and takes the app's pointer input, unseen (!important over the fade animations,
    // which the app runs on its copy); only in the DeX desktop's window, so the rule lives here
    const sheet = doc.createElement('style');
    sheet.textContent = `#startMenu.start-menu.${NATIVE}, .context-menu.${NATIVE}, .popover.${NATIVE} { opacity: 0 !important; }`;
    (doc.head || doc.documentElement).appendChild(sheet);
    // what else belongs to the menu while it is up: its click / context menus (power arrow, Recent Items, right-click)
    const POPUPS = '.context-menu:not(.hidden), .context-menu-submenu, .popover.start-menu-overflow-balloon';

    let cur = null;     // { sid, menu, ac, parts: Map(name -> json), sent: Set(canvas keys), pops: Set(el), lastPage: ms }
    // (a page loaded again starts past the last one's sessions: the app tells menus apart by it)
    let sidSeq = Date.now() % 1e9;
    let failedRun = false;
    let queued = 0;
    let chain = Promise.resolve();

    // ---------------------------------------------------------------- colours, lengths

    const px = (v) => parseFloat(v) || 0;
    const r2 = (v) => Math.round(v * 100) / 100;
    const hex2 = (v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
    function rgba(c, mul) {
        const s = String(c || '');
        let r; let g; let b; let a;
        let m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)/.exec(s);
        if (m) { r = +m[1]; g = +m[2]; b = +m[3]; a = m[4] == null ? 1 : (/%$/.test(m[4]) ? px(m[4]) / 100 : +m[4]); }
        else {
            // color-mix() and the like compute to color(srgb r g b / a), 0-1 channels
            m = /color\(srgb\s+([-\d.e]+)\s+([-\d.e]+)\s+([-\d.e]+)(?:\s*\/\s*([\d.]+%?))?\s*\)/.exec(s);
            if (!m) return null;
            r = +m[1] * 255; g = +m[2] * 255; b = +m[3] * 255; a = m[4] == null ? 1 : (/%$/.test(m[4]) ? px(m[4]) / 100 : +m[4]);
        }
        a *= (mul == null ? 1 : mul);
        if (a <= 0.001) return null;
        return '#' + hex2(r) + hex2(g) + hex2(b) + hex2(Math.min(1, a) * 255);
    }
    // split at a separator outside brackets
    function topSplit(v, sep) {
        const out = []; let d = 0; let s = '';
        for (const ch of String(v || '')) {
            if (ch === '(') d++;
            if (ch === ')') d--;
            if ((sep === ' ' ? /\s/.test(ch) : ch === sep) && d === 0) { if (s.trim()) out.push(s.trim()); s = ''; } else s += ch;
        }
        if (s.trim()) out.push(s.trim());
        return out;
    }
    const radii = (cs) => [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius].map((v) => r2(px(v)));
    const B = (b) => ({ x: r2(b.left), y: r2(b.top), w: r2(b.width), h: r2(b.height) });
    const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });

    /** A length (px, %, calc() of them with + and -) against avail. */
    function len(v, avail) {
        v = String(v || '').trim();
        if (!v || v === 'auto') return null;
        const c = /^calc\((.*)\)$/.exec(v);
        if (c) {
            let sum = 0; let sign = 1;
            for (const t of c[1].replace(/\(|\)/g, ' ').split(/\s+/).filter(Boolean)) {
                if (t === '+') sign = 1; else if (t === '-') sign = -1; else { sum += sign * (len(t, avail) || 0); sign = 1; }
            }
            return sum;
        }
        if (/%$/.test(v)) return (avail * px(v)) / 100;
        return px(v);
    }

    function shadowsOf(v) {
        if (!v || v === 'none') return [];
        return topSplit(v, ',').map((one) => {
            const color = (/((?:rgba?|color)\([^)]*\))/.exec(one) || [])[1] || 'rgb(0, 0, 0)';
            const nums = one.replace(/(?:rgba?|color)\([^)]*\)/, '').replace('inset', '').trim().split(/\s+/).map(px);
            return { color, x: nums[0] || 0, y: nums[1] || 0, blur: nums[2] || 0, spread: nums[3] || 0, inset: /\binset\b/.test(one) };
        });
    }

    // ---------------------------------------------------------------- backgrounds

    const images = new Map(); // url -> { w, h, ok, el } (natural size)
    function imageInfo(url) {
        let i = images.get(url);
        if (i) return i;
        i = { w: 0, h: 0, ok: false, el: new Image() };
        images.set(url, i);
        i.el.decoding = 'async';
        i.el.onload = () => { i.ok = true; i.w = i.el.naturalWidth; i.h = i.el.naturalHeight; if (cur) frameSoon(null); };
        i.el.onerror = () => { i.ok = false; };
        i.el.src = url;
        return i;
    }

    /** url(...) / image-set(...) -> { url, res } as the browser picks it (the smallest resolution at or over the screen's). */
    function pickImage(layer) {
        const one = /^url\(["']?([^"')]+)["']?\)$/.exec(layer);
        if (one) return { url: one[1], res: 1 };
        const set = /^(?:-webkit-)?image-set\((.*)\)$/.exec(layer);
        if (!set) return null;
        const cands = topSplit(set[1], ',').map((c) => {
            const m = /url\(["']?([^"')]+)["']?\)\s*([\d.]+)(x|dppx|dpi)\b/.exec(c) || /url\(["']?([^"')]+)["']?\)/.exec(c);
            return m ? { url: m[1], res: m[2] ? (m[3] === 'dpi' ? +m[2] / 96 : +m[2]) : 1 } : null;
        }).filter(Boolean).sort((a, b) => a.res - b.res);
        if (!cands.length) return null;
        const dpr = root.devicePixelRatio || 1;
        return cands.find((c) => c.res >= dpr - 0.01) || cands[cands.length - 1];
    }

    /** A linear-gradient's colour stops and line, drawn in tile (CSS: the gradient line through the tile's centre). */
    function gradientOf(layer, tile, alpha) {
        const m = /^(repeating-)?linear-gradient\((.*)\)$/.exec(layer.trim());
        if (!m) return null;
        const args = topSplit(m[2], ',');
        let deg = 180;
        if (/^(to |-?[\d.]+(deg|turn|rad))/.test(args[0])) {
            const a = args.shift();
            const d = /(-?[\d.]+)(deg|turn|rad)/.exec(a);
            if (d) deg = d[2] === 'deg' ? +d[1] : d[2] === 'turn' ? +d[1] * 360 : (+d[1] * 180) / Math.PI;
            else {
                const to = a.replace('to', '').trim();
                const map = { top: 0, right: 90, bottom: 180, left: 270, 'top right': 45, 'right top': 45, 'bottom right': 135, 'right bottom': 135, 'bottom left': 225, 'left bottom': 225, 'top left': 315, 'left top': 315 };
                deg = map[to] != null ? map[to] : 180;
            }
        }
        const rad = (deg * Math.PI) / 180;
        const glen = Math.abs(tile.width * Math.sin(rad)) + Math.abs(tile.height * Math.cos(rad));
        const cx = tile.left + tile.width / 2; const cy = tile.top + tile.height / 2;
        const dx = (Math.sin(rad) * glen) / 2; const dy = (-Math.cos(rad) * glen) / 2;
        let stops = [];
        args.forEach((a) => {
            const color = (/^((?:rgba?|color|hsla?)\([^)]*\)|#[0-9a-f]+|[a-z]+)/i.exec(a.trim()) || [])[1];
            if (!color) return;
            const pos = a.trim().slice(color.length).trim().split(/\s+/).filter(Boolean).map((p) => (/%$/.test(p) ? px(p) / 100 : glen > 0 ? px(p) / glen : 0));
            const c = rgba(color, alpha) || (color === 'transparent' ? '#00000000' : rgba(color, alpha)) || '#00000000';
            if (!pos.length) stops.push({ c, p: null });
            pos.forEach((p) => stops.push({ c, p }));
        });
        if (stops.length < 2) return null;
        if (stops[0].p == null) stops[0].p = 0;
        if (stops[stops.length - 1].p == null) stops[stops.length - 1].p = 1;
        for (let i = 1; i < stops.length - 1; i++) {
            if (stops[i].p != null) continue;
            let j = i; while (stops[j].p == null) j++;
            const a = stops[i - 1].p; const b = stops[j].p;
            for (let k = i; k < j; k++) stops[k].p = a + ((b - a) * (k - i + 1)) / (j - i + 1);
        }
        // CSS: a stop before an earlier one sits on it
        for (let i = 1; i < stops.length; i++) if (stops[i].p < stops[i - 1].p) stops[i].p = stops[i - 1].p;
        stops = stops.map((s) => [s.c, r2(Math.max(-4, Math.min(5, s.p)) * 10000) / 10000]);
        return { k: 'grad', x: r2(tile.left), y: r2(tile.top), w: r2(tile.width), h: r2(tile.height), line: [r2(cx - dx), r2(cy - dy), r2(cx + dx), r2(cy + dy)], stops, rep: !!m[1] };
    }

    /** background-position's two offsets (x, y) for a tile of size tw x th in an area aw x ah. */
    function bgPos(v, aw, ah, tw, th) {
        const t = topSplit(v || '0% 0%', ' ');
        let x = 0; let y = 0; let gotX = false; let gotY = false;
        const free = (axis) => (axis === 'x' ? aw - tw : ah - th);
        for (let i = 0; i < t.length; i++) {
            const k = t[i];
            const next = t[i + 1];
            const isLen = (s) => s != null && !/^(left|right|top|bottom|center)$/.test(s);
            if (k === 'left' || k === 'right') {
                const off = isLen(next) ? len(next, free('x')) : 0;
                if (isLen(next)) i++;
                x = k === 'left' ? off : free('x') - off; gotX = true;
            } else if (k === 'top' || k === 'bottom') {
                const off = isLen(next) ? len(next, free('y')) : 0;
                if (isLen(next)) i++;
                y = k === 'top' ? off : free('y') - off; gotY = true;
            } else if (k === 'center') {
                if (!gotX) { x = free('x') / 2; gotX = true; } else { y = free('y') / 2; gotY = true; }
            } else if (!gotX) { x = len(k, free('x')); gotX = true; } else { y = len(k, free('y')); gotY = true; }
        }
        return [x, y];
    }

    /** el's background layers (pictures and gradients) into out, on top of its colour. */
    function backgroundsOf(cs, b, r, alpha, out, pics) {
        const bi = cs.backgroundImage;
        if (!bi || bi === 'none') return;
        const layers = topSplit(bi, ',');
        const sizes = topSplit(cs.backgroundSize, ',');
        const poss = topSplit(cs.backgroundPosition, ',');
        const reps = topSplit(cs.backgroundRepeat, ',');
        const origins = topSplit(cs.backgroundOrigin, ',');
        const bl = px(cs.borderLeftWidth); const bt = px(cs.borderTopWidth); const br = px(cs.borderRightWidth); const bb = px(cs.borderBottomWidth);
        const clip = [r2(b.left), r2(b.top), r2(b.width), r2(b.height), r];
        for (let i = layers.length - 1; i >= 0; i--) {
            const layer = layers[i];
            const origin = origins[i % origins.length] || 'padding-box';
            const area = origin === 'border-box' ? b : rect(b.left + bl, b.top + bt, b.width - bl - br, b.height - bt - bb);
            const isGrad = /gradient\(/.test(layer);
            let iw = area.width; let ih = area.height; let key = null;
            if (!isGrad) {
                const pick = pickImage(layer);
                if (!pick) continue;
                const info = imageInfo(pick.url);
                if (!info.ok) continue;
                iw = info.w / pick.res; ih = info.h / pick.res;
                key = fileKey(pick.url);
                pics.set(key, { url: pick.url });
            }
            // background-size
            const sz = topSplit(sizes[i % sizes.length] || 'auto', ' ');
            let tw = iw; let th = ih;
            if (sz[0] === 'cover' || sz[0] === 'contain') {
                const s = sz[0] === 'cover' ? Math.max(area.width / iw, area.height / ih) : Math.min(area.width / iw, area.height / ih);
                tw = iw * s; th = ih * s;
            } else {
                const w0 = len(sz[0], area.width); const h0 = len(sz[1] || 'auto', area.height);
                if (w0 != null && h0 != null) { tw = w0; th = h0; } else if (w0 != null) { tw = w0; th = isGrad ? area.height : (ih * w0) / iw; } else if (h0 != null) { th = h0; tw = isGrad ? area.width : (iw * h0) / ih; }
            }
            if (!(tw > 0 && th > 0)) continue;
            const [ox, oy] = bgPos(poss[i % poss.length], area.width, area.height, tw, th);
            const tile = rect(area.left + ox, area.top + oy, tw, th);
            const rep = reps[i % reps.length] || 'repeat';
            const rx = /^(repeat|repeat-x|round|space)/.test(rep) && !/^repeat-y/.test(rep) && !/^no-repeat$/.test(rep) && !/^no-repeat /.test(rep);
            const ry = /repeat-y|^repeat$|^repeat repeat|round|space|no-repeat repeat/.test(rep) && !/repeat-x/.test(rep);
            if (isGrad) {
                const g = gradientOf(layer, tile, alpha);
                if (!g) continue;
                g.clip = clip;
                if (rx || ry) g.tile = (rx ? 'x' : '') + (ry ? 'y' : '');
                out.push(g);
            } else {
                const one = Object.assign({ k: 'img' }, B(tile), { key, clip });
                if (alpha < 1) one.alpha = r2(alpha);
                if (rx || ry) one.tile = (rx ? 'x' : '') + (ry ? 'y' : '');
                out.push(one);
            }
        }
    }

    // ---------------------------------------------------------------- boxes

    /** A box (b) as cs paints it: outer shadows, glass, colour, backgrounds, inset rims, borders. */
    function paintBox(b, cs, alpha, out, pics, isRoot) {
        const r = radii(cs);
        const sh = shadowsOf(cs.boxShadow);
        sh.filter((s) => !s.inset).reverse().forEach((s) => {
            const color = rgba(s.color, alpha);
            if (color) out.push(Object.assign({ k: 'shadow' }, B(b), { r, dx: r2(s.x), dy: r2(s.y), blur: r2(s.blur), spread: r2(s.spread), color }));
        });
        const bf = cs.backdropFilter || cs.webkitBackdropFilter || '';
        if (bf && bf !== 'none' && isRoot) {
            const blur = /blur\(\s*([\d.]+)px/.exec(bf); const sat = /saturate\(\s*([\d.]+)(%?)/.exec(bf);
            out.push(Object.assign({ k: 'backdrop' }, B(b), { r, blur: blur ? +blur[1] : 0, sat: sat ? (sat[2] ? +sat[1] / 100 : +sat[1]) : 1 }));
        }
        const fill = rgba(cs.backgroundColor, alpha);
        if (fill) out.push(Object.assign({ k: 'rect' }, B(b), { r, fill }));
        backgroundsOf(cs, b, r, alpha, out, pics);
        // inset shadows: rims (no blur) and soft inner glows
        sh.filter((s) => s.inset).reverse().forEach((s) => {
            const color = rgba(s.color, alpha);
            if (!color) return;
            if (!s.blur) {
                const bw = [s.spread + s.y, s.spread - s.x, s.spread - s.y, s.spread + s.x].map((v) => r2(Math.max(0, v)));
                if (bw.some((v) => v > 0)) out.push(Object.assign({ k: 'border' }, B(b), { r, bw, color: bw.map((v) => (v > 0 ? color : null)) }));
            } else out.push(Object.assign({ k: 'ishadow' }, B(b), { r, dx: r2(s.x), dy: r2(s.y), blur: r2(s.blur), spread: r2(s.spread), color }));
        });
        if (!borderImageOf(b, cs, alpha, out, pics)) bordersOf(b, cs, r, alpha, out);
    }

    /** border-image (Vista's edit boxes and buttons are 9-slices): { k: 'nine', key, sl (image px), bw (CSS px), fill }. */
    function borderImageOf(b, cs, alpha, out, pics) {
        const src = cs.borderImageSource;
        if (!src || src === 'none') return false;
        const pick = pickImage(src.trim());
        if (!pick) return false;
        const info = imageInfo(pick.url);
        if (!info.ok) return true; // (drawn when its picture is in: the load writes the part down again)
        const key = fileKey(pick.url);
        pics.set(key, { url: pick.url });
        const sliceTok = String(cs.borderImageSlice || '100%').split(/\s+/);
        const fill = sliceTok.includes('fill');
        const sl0 = sliceTok.filter((t) => t !== 'fill');
        const four = (a) => [a[0], a[1] != null ? a[1] : a[0], a[2] != null ? a[2] : a[0], a[3] != null ? a[3] : (a[1] != null ? a[1] : a[0])];
        const nat = [info.h, info.w, info.h, info.w];
        const sl = four(sl0).map((t, i) => r2(/%$/.test(t) ? (nat[i] * px(t)) / 100 : px(t) * pick.res));
        const bwCss = [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth].map(px);
        const bw = four(String(cs.borderImageWidth || '1').split(/\s+/)).map((t, i) => r2(t === 'auto' ? sl[i] / pick.res : /px$/.test(t) ? px(t) : /%$/.test(t) ? ((i % 2 ? b.width : b.height) * px(t)) / 100 : px(t) * bwCss[i]));
        const os = four(String(cs.borderImageOutset || '0').split(/\s+/)).map((t, i) => (/px$/.test(t) ? px(t) : px(t) * bwCss[i]));
        const one = { k: 'nine', x: r2(b.left - os[3]), y: r2(b.top - os[0]), w: r2(b.width + os[1] + os[3]), h: r2(b.height + os[0] + os[2]), key, sl, bw, fill: fill || undefined };
        if (alpha < 1) one.alpha = r2(alpha);
        out.push(one);
        return true;
    }

    /** Borders: one stroke when even, else each side as CSS draws it (a trapezoid: arrows made of borders come out right). */
    function bordersOf(b, cs, r, alpha, out) {
        const sides = ['Top', 'Right', 'Bottom', 'Left'];
        const bw = sides.map((s) => (cs[`border${s}Style`] === 'none' || cs[`border${s}Style`] === 'hidden' ? 0 : r2(px(cs[`border${s}Width`]))));
        if (!bw.some((v) => v > 0)) return;
        const bc = sides.map((s, i) => (bw[i] > 0 ? rgba(cs[`border${s}Color`], alpha) : null));
        if (!bc.some(Boolean)) return;
        const even = bc.every((c, i) => c === bc[0] && bw[i] === bw[0]);
        if (even || r.some((v) => v > 0)) { out.push(Object.assign({ k: 'border' }, B(b), { r, bw, color: bc })); return; }
        const [t, rr, bo, l] = bw;
        const L = b.left; const T = b.top; const R = b.right; const Bo = b.bottom;
        const quads = [
            [[L, T], [R, T], [R - rr, T + t], [L + l, T + t]],
            [[R, T], [R, Bo], [R - rr, Bo - bo], [R - rr, T + t]],
            [[R, Bo], [L, Bo], [L + l, Bo - bo], [R - rr, Bo - bo]],
            [[L, Bo], [L, T], [L + l, T + t], [L + l, Bo - bo]]
        ];
        quads.forEach((q, i) => { if (bc[i] && bw[i] > 0) out.push({ k: 'poly', pts: q.map((p) => [r2(p[0]), r2(p[1])]), fill: bc[i] }); });
    }

    function outlineOf(b, cs, alpha, out) {
        const w = px(cs.outlineWidth);
        if (!w || cs.outlineStyle === 'none') return;
        const c = rgba(cs.outlineColor, alpha);
        if (!c) return;
        const o = px(cs.outlineOffset);
        out.push({ k: 'outline', x: r2(b.left - o - w), y: r2(b.top - o - w), w: r2(b.width + 2 * (o + w)), h: r2(b.height + 2 * (o + w)), lw: r2(w), color: c, dash: /dotted|dashed/.test(cs.outlineStyle) ? cs.outlineStyle : undefined });
    }

    // ---------------------------------------------------------------- pseudo-elements

    /** ::before / ::after's box (absolute ones by their offsets in el's padding box, in-flow ones at el's content edge). */
    function pseudoBox(el, cs, pcs, which) {
        const b = el.getBoundingClientRect();
        const bl = px(cs.borderLeftWidth); const bt = px(cs.borderTopWidth);
        const w = px(pcs.width) + px(pcs.paddingLeft) + px(pcs.paddingRight) + px(pcs.borderLeftWidth) + px(pcs.borderRightWidth);
        const h = px(pcs.height) + px(pcs.paddingTop) + px(pcs.paddingBottom) + px(pcs.borderTopWidth) + px(pcs.borderBottomWidth);
        if (pcs.position === 'absolute') {
            const pw = b.width - bl - px(cs.borderRightWidth); const ph = b.height - bt - px(cs.borderBottomWidth);
            let x = len(pcs.left, pw); let y = len(pcs.top, ph);
            if (x == null) x = pw - (len(pcs.right, pw) || 0) - w;
            if (y == null) y = ph - (len(pcs.bottom, ph) || 0) - h;
            return rect(b.left + bl + x + px(pcs.marginLeft), b.top + bt + y + px(pcs.marginTop), w, h);
        }
        if (pcs.position === 'static' || pcs.position === 'relative') {
            const cx = b.left + bl + px(cs.paddingLeft) + px(pcs.marginLeft);
            if (which === '::before') return rect(cx, b.top + bt + px(cs.paddingTop) + px(pcs.marginTop), w, h);
        }
        return null;
    }

    const hoverSel = { list: null };
    /** Selectors whose ::before is a hover layer (a rule "X:hover::before" in the page's sheets) and its fade-in time. */
    function hoverLayers() {
        if (hoverSel.list) return hoverSel.list;
        const list = [];
        const walk = (rules) => {
            for (const rule of rules) {
                if (rule.cssRules && !rule.selectorText) { try { walk(rule.cssRules); } catch (_) { /* cross-origin */ } continue; }
                const sel = rule.selectorText;
                if (!sel || !/:hover::?(before|after)/.test(sel)) continue;
                topSplit(sel, ',').forEach((one) => {
                    const m = /^([^\s:]+):hover::?(before|after)$/.exec(one.trim());
                    if (m) list.push({ sel: m[1], which: '::' + m[2], fin: Math.round(px(rule.style.transitionDuration) * (/ms$/.test(rule.style.transitionDuration) ? 1 : 1000)) || 0 });
                });
            }
        };
        for (const sheet of doc.styleSheets) { try { walk(sheet.cssRules); } catch (_) { /* cross-origin sheet */ } }
        hoverSel.list = list;
        return list;
    }

    const ms = (v) => { const s = topSplit(v, ',')[0] || '0s'; return Math.round(/ms$/.test(s) ? px(s) : px(s) * 1000); };

    // ---------------------------------------------------------------- the tree

    let ids = new WeakMap(); let idSeq = 0;
    const idOf = (el) => { if (!ids.has(el)) ids.set(el, ++idSeq); return ids.get(el); };

    /** el and what it holds, in paint order, into out. ctx: { pics, fades (Map el -> [from, ms]), scroll (content offset) } */
    function treeOf(el, out, ctx, inherited, isRoot) {
        if (!el.getClientRects().length) return;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') return;
        const own = isRoot ? 1 : +cs.opacity;
        // a running fade is drawn at the stronger of its two ends; the app moves it between them
        const f = isRoot ? null : ctx.fades.get(el);
        const drawn = f && f[0] != null ? Math.max(own, f[0]) : own;
        if (!isRoot && drawn === 0) return;
        const alpha = (inherited == null ? 1 : inherited) * (isRoot ? 1 : drawn);
        const start = out.length;
        const b = el.getBoundingClientRect();
        paintBox(b, cs, alpha, out, ctx.pics, isRoot);
        // ::before (a hover layer, or drawn)
        pseudo(el, cs, '::before', alpha, out, ctx);
        if (el.tagName === 'IMG' || el.tagName === 'CANVAS') {
            const key = picKey(el, ctx.pics);
            if (key) {
                const bl = px(cs.borderLeftWidth) + px(cs.paddingLeft); const bt = px(cs.borderTopWidth) + px(cs.paddingTop);
                const cw = b.width - bl - px(cs.borderRightWidth) - px(cs.paddingRight); const ch = b.height - bt - px(cs.borderBottomWidth) - px(cs.paddingBottom);
                let box = rect(b.left + bl, b.top + bt, cw, ch);
                // object-fit: contain / cover / none
                const nw = el.naturalWidth || el.width; const nh = el.naturalHeight || el.height;
                if (nw && nh && cs.objectFit && cs.objectFit !== 'fill') {
                    const s = cs.objectFit === 'cover' ? Math.max(cw / nw, ch / nh) : cs.objectFit === 'none' ? 1 : Math.min(cw / nw, ch / nh, cs.objectFit === 'scale-down' ? 1 : Infinity);
                    box = rect(b.left + bl + (cw - nw * s) / 2, b.top + bt + (ch - nh * s) / 2, nw * s, nh * s);
                }
                const one = Object.assign({ k: 'img' }, B(box), { key, clip: [r2(b.left), r2(b.top), r2(b.width), r2(b.height), radii(cs)] });
                if (alpha < 1) one.alpha = r2(alpha);
                out.push(one);
            }
        } else if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
            inputOf(el, cs, b, alpha, out);
        } else if (el.tagName === 'I' && /awesome/i.test(cs.fontFamily)) {
            glyphOf(el, cs, b, alpha, out, ctx);
        } else {
            // a scroller: its content apart, moved by the app (its clip, then the content at scroll 0)
            const scrollY = /auto|scroll/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1;
            const clips = !isRoot && (cs.overflowX !== 'visible' || cs.overflowY !== 'visible');
            let target = out;
            let sc = null;
            if (clips) {
                const bl = px(cs.borderLeftWidth); const bt = px(cs.borderTopWidth);
                const cb = rect(b.left + bl, b.top + bt, el.clientWidth, el.clientHeight);
                if (scrollY) {
                    sc = { k: 'scroller', id: 's' + idOf(el), x: r2(cb.left), y: r2(cb.top), w: r2(cb.width), h: r2(cb.height), top: el.scrollTop, items: [] };
                    target = sc.items;
                    ctx.scrollers.set(el, sc);
                } else out.push(Object.assign({ k: 'clip' }, B(cb), { r: radii(cs).map((v) => Math.max(0, v - bl)) }));
            }
            const saved = ctx.dy;
            if (sc) ctx.dy = saved + el.scrollTop;
            [...el.childNodes].forEach((n) => {
                if (n.nodeType === 1) treeOf(n, target, ctx, alpha, false);
                else if (n.nodeType === 3 && n.textContent.trim()) textOf(n, el, cs, b, alpha, target);
            });
            ctx.dy = saved;
            if (sc) {
                sc.items = sc.items.map((o) => shiftY(o, el.scrollTop));
                out.push(sc);
                const vsb = scrollbarOf(el, cs, b, sc);
                if (vsb) out.push(vsb);
            } else if (clips) out.push({ k: 'unclip' });
        }
        pseudo(el, cs, '::after', alpha, out, ctx);
        outlineOf(b, cs, alpha, out);
        // a running transition / animation on this element: written at its end, the app runs it
        // (as multipliers of what is drawn: from, to, ms, the animation's id)
        if (f && f[0] != null && drawn > 0 && out.length > start) {
            const fade = [r2(f[0] / drawn), r2(own / drawn), f[1], f[2]];
            for (let i = start; i < out.length; i++) if (!out[i].fade) out[i].fade = fade;
        }
    }

    /** Content coordinates inside a scroller (viewport y + its scroll). */
    function shiftY(o, dy) {
        if (!dy) return o;
        const c = Object.assign({}, o);
        if (c.y != null) c.y = r2(c.y + dy);
        if (c.clip) c.clip = [c.clip[0], r2(c.clip[1] + dy), c.clip[2], c.clip[3], c.clip[4]];
        if (c.line) c.line = [c.line[0], r2(c.line[1] + dy), c.line[2], r2(c.line[3] + dy)];
        if (c.pts) c.pts = c.pts.map((p) => [p[0], r2(p[1] + dy)]);
        if (c.items) c.items = c.items.map((i) => shiftY(i, dy));
        return c;
    }

    function pseudo(el, cs, which, alpha, out, ctx) {
        const pcs = getComputedStyle(el, which);
        if (!pcs || pcs.content === 'none' || pcs.content === 'normal' || pcs.display === 'none') return;
        const pb = pseudoBox(el, cs, pcs, which);
        if (!pb) return;
        const hv = hoverLayers().find((h) => h.which === which && el.matches(h.sel));
        if (hv) {
            // drawn by the app while the pointer is over el (or el is the keyboard's choice): at its full look
            const items = [];
            paintBox(pb, pcs, alpha, items, ctx.pics, false);
            const eb = el.getBoundingClientRect();
            const grp = el.closest('[data-dex-start-group], .start-menu-items, .start-menu-places');
            out.push(Object.assign({ k: 'hover' }, B(eb), { id: 'h' + idOf(el), items, fin: hv.fin || 90, fout: ms(pcs.transitionDuration) || 0, hot: el.classList.contains('is-hot') || undefined, grp: grp ? 'g' + idOf(grp) : undefined }));
            return;
        }
        const a = alpha * +pcs.opacity;
        if (a <= 0) return;
        paintBox(pb, pcs, a, out, ctx.pics, false);
    }

    /** A Font Awesome icon: its glyph drawn here (the app has no copy of the font) as a picture. */
    const glyphs = new Map(); // key -> canvas
    function glyphOf(el, cs, b, alpha, out, ctx) {
        const pcs = getComputedStyle(el, '::before');
        const ch = (pcs.content || '').replace(/^["']|["']$/g, '');
        if (!ch || pcs.content === 'none') return;
        const size = px(cs.fontSize); const color = rgba(cs.color, 1) || '#000000ff';
        const fam = (topSplit(pcs.fontFamily || cs.fontFamily, ',')[0] || '').replace(/["']/g, '');
        const weight = pcs.fontWeight || cs.fontWeight;
        const dpr = Math.max(1, root.devicePixelRatio || 1) * 2;
        const key = `g:${fam}|${weight}|${size}|${color}|${ch.codePointAt(0).toString(16)}`;
        let cv = glyphs.get(key);
        const font = `${weight} ${size}px "${fam}"`;
        if (!cv) {
            cv = doc.createElement('canvas');
            const m = cv.getContext('2d');
            m.font = font;
            const mt = m.measureText(ch);
            const w = Math.ceil(mt.width) + 2; const h = Math.ceil(size * 1.4);
            cv.width = Math.ceil(w * dpr); cv.height = Math.ceil(h * dpr);
            const g = cv.getContext('2d');
            g.scale(dpr, dpr); g.font = font; g.fillStyle = cs.color; g.textBaseline = 'middle'; g.textAlign = 'center';
            g.fillText(ch, w / 2, h / 2);
            cv.dataset.w = w; cv.dataset.h = h;
            glyphs.set(key, cv);
        }
        const w = +cv.dataset.w; const h = +cv.dataset.h;
        ctx.pics.set(key, { canvas: cv });
        const one = { k: 'img', x: r2(b.left + (b.width - w) / 2), y: r2(b.top + (b.height - h) / 2), w, h, key };
        if (alpha < 1) one.alpha = r2(alpha);
        out.push(one);
    }

    const measure = doc.createElement('canvas').getContext('2d');
    /** A text field: its words (or placeholder), the selection and the caret where the page has them. */
    function inputOf(el, cs, b, alpha, out) {
        const left = b.left + px(cs.borderLeftWidth) + px(cs.paddingLeft);
        const top = b.top + px(cs.borderTopWidth) + px(cs.paddingTop);
        const h = b.height - px(cs.borderTopWidth) - px(cs.paddingTop) - px(cs.borderBottomWidth) - px(cs.paddingBottom);
        const right = b.right - px(cs.borderRightWidth) - px(cs.paddingRight);
        const value = el.value || '';
        const fam = (topSplit(cs.fontFamily, ',')[0] || '').replace(/["']/g, '');
        measure.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
        const x0 = left - el.scrollLeft;
        const run = (s, color, italic, x) => ({ k: 'text', x: r2(x), y: r2(top), h: r2(h), w: r2(measure.measureText(s).width), s, size: r2(px(cs.fontSize)), bold: (+cs.fontWeight || 400) >= 600, italic: italic || undefined, color, font: fam, clipX: [r2(left), r2(right)] });
        if (!value) {
            const ph = el.getAttribute('placeholder');
            if (ph) {
                let pcs = null;
                try { pcs = getComputedStyle(el, '::placeholder'); } catch (_) { pcs = null; }
                const color = rgba(pcs && pcs.color, alpha) || '#6d6d6dff';
                const italic = pcs ? pcs.fontStyle === 'italic' : true;
                measure.font = `${italic ? 'italic' : 'normal'} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
                out.push(run(ph, color, italic, x0));
            }
        } else {
            const s0 = el.selectionStart || 0; const s1 = el.selectionEnd || 0;
            const color = rgba(cs.color, alpha) || '#000000ff';
            if (doc.activeElement === el && s1 > s0) {
                const a = measure.measureText(value.slice(0, s0)).width; const w = measure.measureText(value.slice(s0, s1)).width;
                out.push(run(value.slice(0, s0), color, false, x0));
                out.push({ k: 'rect', x: r2(x0 + a), y: r2(top), w: r2(w), h: r2(h), fill: '#3399ffff', r: [0, 0, 0, 0] });
                out.push(run(value.slice(s0, s1), '#ffffffff', false, x0 + a));
                out.push(run(value.slice(s1), color, false, x0 + a + w));
            } else out.push(run(value, color, false, x0));
        }
        if (doc.activeElement === el && (el.selectionStart === el.selectionEnd)) {
            const cx = x0 + measure.measureText(value.slice(0, el.selectionStart || 0)).width;
            const size = px(cs.fontSize);
            out.push({ k: 'caret', x: r2(Math.min(right, Math.max(left, cx))), y: r2(top + (h - size * 1.2) / 2), w: 1, h: r2(size * 1.2), color: rgba(cs.caretColor === 'auto' ? cs.color : cs.caretColor, 1) || '#000000ff' });
        }
    }

    function textOf(n, el, cs, b, alpha, out) {
        const range = doc.createRange();
        range.selectNodeContents(n);
        const rects = [...range.getClientRects()].filter((r) => r.width > 0);
        if (!rects.length) return;
        const words = n.textContent.replace(/\s+/g, ' ');
        // one run per line box (a wrapped caption); the words of each by where they fall
        const lines = rects.length === 1 ? [{ r: rects[0], s: words.trim() }] : splitLines(n, rects);
        lines.forEach(({ r: rr, s }) => {
            if (!s) return;
            const one = {
                k: 'text', x: r2(rr.left), y: r2(rr.top), h: r2(rr.height), w: r2(rr.width), s,
                size: r2(px(cs.fontSize)), bold: (+cs.fontWeight || 400) >= 600, italic: cs.fontStyle === 'italic' || undefined,
                color: rgba(cs.color, alpha) || '#000000ff', font: (topSplit(cs.fontFamily, ',')[0] || '').replace(/["']/g, ''),
                ls: r2(px(cs.letterSpacing)) || undefined, u: /underline/.test(cs.textDecorationLine || '') || undefined
            };
            const glow = shadowsOf(cs.textShadow).map((s2) => [r2(s2.x), r2(s2.y), r2(s2.blur), rgba(s2.color, alpha)]).filter((s2) => s2[3]);
            if (glow.length) one.glow = glow;
            if (cs.overflowX !== 'visible') {
                const inner = b.right - px(cs.borderRightWidth) - px(cs.paddingRight);
                const left = b.left + px(cs.borderLeftWidth) + px(cs.paddingLeft);
                if (rr.right > inner + 0.5 || rr.left < left - 0.5) { one.x = r2(left); one.cw = r2(Math.max(0, inner - left)); if (cs.textOverflow === 'ellipsis') one.ell = true; }
            }
            out.push(one);
        });
    }

    function splitLines(n, rects) {
        const text = n.textContent;
        const range = doc.createRange();
        const out = rects.map((r) => ({ r, s: '' }));
        for (let i = 0; i < text.length; i++) {
            range.setStart(n, i); range.setEnd(n, i + 1);
            const cr = range.getBoundingClientRect();
            const line = out.findIndex((l) => cr.top >= l.r.top - 1 && cr.bottom <= l.r.bottom + 1);
            if (line >= 0) out[line].s += text[i];
        }
        return out.map((l) => ({ r: l.r, s: l.s.replace(/\s+/g, ' ').trim() }));
    }

    const canvasIds = new WeakMap(); let canvasSeq = 0;
    function picKey(el, pics) {
        if (el.tagName === 'CANVAS') {
            if (!canvasIds.has(el)) canvasIds.set(el, ++canvasSeq);
            const key = `c:${canvasIds.get(el)}:${el.dataset.drawn || 0}`;
            pics.set(key, { canvas: el });
            return key;
        }
        const url = el.currentSrc || el.src || '';
        if (!url) return null;
        if (!el.complete || !el.naturalWidth) { el.addEventListener('load', () => frameSoon(el), { once: true }); return null; }
        const key = fileKey(url);
        pics.set(key, { url });
        return key;
    }

    /** A picture file's key: its address, or for data: / blob: pictures (long, and not kept across sessions) a hash of it. */
    function fileKey(url) {
        if (!/^(data|blob):/.test(url)) return 'p:' + url;
        let h = 0x811c9dc5;
        for (let i = 0; i < url.length; i++) { h ^= url.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
        return `c:u${h.toString(16)}:${url.length}`;
    }

    // ---------------------------------------------------------------- Vista's scrollbar (the page's ::-webkit-scrollbar art)

    let sbArt = null; // { part: [url, ...] }
    function scrollbarArt() {
        if (sbArt) return sbArt;
        sbArt = {};
        const want = {
            track: '-track:vertical', up: '-button:vertical:start', upH: '-button:vertical:start:hover', upA: '-button:vertical:start:active', upD: '-button:vertical:start:disabled',
            dn: '-button:vertical:end', dnH: '-button:vertical:end:hover', dnA: '-button:vertical:end:active', dnD: '-button:vertical:end:disabled',
            th: '-thumb:vertical', thH: '-thumb:vertical:hover', thA: '-thumb:vertical:active'
        };
        const urls = (v) => (String(v || '').match(/url\(["']?[^"')]+["']?\)/g) || []).map((u) => u.replace(/^url\(["']?|["']?\)$/g, ''));
        for (const sheet of doc.styleSheets) {
            let rules;
            try { rules = sheet.cssRules; } catch (_) { continue; }
            for (const rule of rules) {
                const sel = rule.selectorText || '';
                if (sel.indexOf('::-webkit-scrollbar') < 0 || !/^body\.desktop-mode:not\(\.windows-classic-theme\) :not\(html\)/.test(sel)) continue;
                Object.keys(want).forEach((k) => {
                    if (sbArt[k] || !sel.endsWith('::-webkit-scrollbar' + want[k])) return;
                    const bg = urls(rule.style.backgroundImage || rule.style.background);
                    const bi = urls(rule.style.borderImageSource);
                    if (bg.length || bi.length) sbArt[k] = { bg, bi, pos: rule.style.backgroundPosition || '' };
                });
            }
        }
        return sbArt;
    }

    function scrollbarOf(el, cs, b, sc) {
        const wide = el.offsetWidth - el.clientWidth - px(cs.borderLeftWidth) - px(cs.borderRightWidth);
        if (wide < 4 || !doc.body.classList.contains('desktop-mode')) return null;
        const art = scrollbarArt();
        const keys = {};
        Object.keys(art).forEach((k) => {
            keys[k] = { bg: art[k].bg.map((u, i) => { const key = `sb:${k}:b${i}`; sc.art = sc.art || []; sc.art.push([key, u]); return key; }),
                bi: art[k].bi.map((u, i) => { const key = `sb:${k}:i${i}`; sc.art = sc.art || []; sc.art.push([key, u]); return key; }), pos: art[k].pos };
        });
        return { k: 'vsb', id: sc.id, x: r2(sc.x + sc.w), y: r2(sc.y), w: r2(wide), h: r2(sc.h), view: el.clientHeight, total: el.scrollHeight, top: el.scrollTop, art: keys };
    }

    // ---------------------------------------------------------------- the frame

    /** Running transitions / animations in node: jumped to their end while it is written down (put back after). */
    function settle(node, fades) {
        const anims = [];
        let list = [];
        try { list = node.getAnimations({ subtree: true }); } catch (_) { list = []; }
        list.forEach((an) => {
            const eff = an.effect; if (!eff) return;
            const t = eff.getComputedTiming();
            if (an.playState !== 'running' || !t.endTime || t.endTime === Infinity) return;
            const target = eff.target; if (!target) return;
            const pseudoEl = eff.pseudoElement;
            const left = Math.max(0, t.endTime - (an.currentTime || 0));
            const from = pseudoEl ? null : +getComputedStyle(target).opacity;
            anims.push({ an, ct: an.currentTime });
            an.currentTime = t.endTime - 0.01;
            if (!pseudoEl && left > 16) {
                if (!aids.has(an)) aids.set(an, ++aidSeq);
                fades.set(target, [from, Math.round(left), aids.get(an)]);
            }
        });
        return () => anims.forEach((a) => { try { a.an.currentTime = a.ct; } catch (_) { /* gone */ } });
    }
    const aids = new WeakMap(); let aidSeq = 0;

    function partOf(el, ctx, isRoot) {
        const out = [];
        treeOf(el, out, ctx, 1, isRoot);
        return out;
    }

    function extent(list, acc) {
        list.forEach((o) => {
            if (o.k === 'scroller') { acc.push([o.x, o.y, o.x + o.w, o.y + o.h]); return; }
            if (o.items && o.k === 'hover') { extent(o.items, acc); }
            if (o.clip && o.k !== 'text') { acc.push([o.clip[0], o.clip[1], o.clip[0] + o.clip[2], o.clip[1] + o.clip[3]]); return; }
            if (o.x == null || o.w == null) return;
            const m = o.k === 'shadow' ? o.blur + Math.max(0, o.spread) + 2 : 0;
            acc.push([o.x - m + Math.min(0, o.dx || 0), o.y - m + Math.min(0, o.dy || 0), o.x + o.w + m + Math.max(0, o.dx || 0), o.y + o.h + m + Math.max(0, o.dy || 0)]);
        });
        return acc;
    }

    function frame() {
        queued = 0;
        const c = cur;
        if (!c || !port()) return;
        const menu = c.menu;
        // the menu's own fade (opening / closing) is the window's; the rest are the items'
        const fades = new Map();
        let menuFade = null;
        let undo = () => {};
        try {
            (menu.getAnimations ? menu.getAnimations() : []).forEach((an) => {
                const t = an.effect && an.effect.getComputedTiming();
                if (t && an.playState === 'running' && t.endTime !== Infinity) {
                    if (!aids.has(an)) aids.set(an, ++aidSeq);
                    menuFade = { id: aids.get(an), ms: Math.round(Math.max(0, t.endTime - (an.currentTime || 0))), out: menu.classList.contains('start-menu-closing') };
                }
            });
            // only the parts something happened in are written down again (the rest as they were)
            const all = c.dirty.has('*') || !c.lists.size;
            const dirty = (name) => all || c.dirty.has(name) || !c.lists.has(name);
            c.dirty.clear();
            const undos = [];
            const pops = [...doc.querySelectorAll(POPUPS)].filter((p) => p.getClientRects().length);
            pops.forEach((p) => { if (!c.pops.has(p)) { c.pops.add(p); p.classList.add(NATIVE); } });
            const kids = [...menu.children];
            kids.forEach((ch, i) => { if (dirty('m' + i)) undos.push(settle(ch, fades)); });
            pops.forEach((p) => { if (dirty('pop' + idOf(p))) undos.push(settle(p, fades)); });
            undo = () => undos.forEach((u) => u());
            const ctx = { pics: new Map(), fades, scrollers: new Map(), dy: 0 };
            const parts = new Map();
            // the menu's frame, each of its parts apart (only the changed ones go), then its menus
            if (dirty('menu')) {
                const shell = [];
                paintBox(menu.getBoundingClientRect(), getComputedStyle(menu), 1, shell, ctx.pics, true);
                parts.set('menu', shell);
            } else parts.set('menu', c.lists.get('menu'));
            kids.forEach((ch, i) => parts.set('m' + i, dirty('m' + i) ? partOf(ch, ctx, false) : c.lists.get('m' + i)));
            pops.forEach((p) => { const n = 'pop' + idOf(p); parts.set(n, dirty(n) ? partOf(p, ctx, true) : c.lists.get(n)); /* (as a root: its own opacity is the unseen copy's 0) */ });
            c.lists = parts;
            ctx.scrollers.forEach((sc, el) => c.scrollers.set(el, sc));
            // what changed
            const msg = { op: 'frame', sid: c.sid, vw: root.innerWidth, parts: {}, order: [...parts.keys()] };
            if (menuFade && menuFade.id !== c.fadeSent) { msg.fade = menuFade; c.fadeSent = menuFade.id; }
            const acc = [];
            parts.forEach((list, name) => {
                extent(list, acc);
                const json = JSON.stringify(list);
                if (c.parts.get(name) !== json) { msg.parts[name] = list; c.parts.set(name, json); }
            });
            [...c.parts.keys()].forEach((k) => { if (!parts.has(k)) c.parts.delete(k); });
            const bx = acc.reduce((a, r) => [Math.min(a[0], r[0]), Math.min(a[1], r[1]), Math.max(a[2], r[2]), Math.max(a[3], r[3])], [Infinity, Infinity, -Infinity, -Infinity]);
            msg.bounds = [Math.floor(Math.max(0, bx[0])), Math.floor(Math.max(0, bx[1])), Math.ceil(Math.min(root.innerWidth, bx[2])), Math.ceil(Math.min(root.innerHeight, bx[3]))];
            if (!Object.keys(msg.parts).length && msg.bounds.join() === c.bounds && !msg.fade) return;
            c.bounds = msg.bounds.join();
            // the scrollbar's art (once a session)
            ctx.scrollers.forEach((sc) => { (sc.art || []).forEach(([k, u]) => { if (!c.sent.has(k)) ctx.pics.set(k, { url: u }); }); delete sc.art; });
            post(c, msg, ctx.pics);
        } catch (err) {
            console.warn('[dexStartMenu] frame', err);
        } finally {
            undo();
        }
    }

    function bytesOf(p) {
        if (p.canvas) return new Promise((res) => { try { p.canvas.toBlob((b) => res(b ? b.arrayBuffer() : null), 'image/png'); } catch (_) { res(null); } });
        return fetch(p.url).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null);
    }

    function postPicture(key, buf) {
        const p = port();
        if (!p || !buf) return;
        const kb = new TextEncoder().encode(key);
        const out = new Uint8Array(2 + kb.length + buf.byteLength);
        out[0] = (kb.length >> 8) & 255; out[1] = kb.length & 255;
        out.set(kb, 2);
        out.set(new Uint8Array(buf), 2 + kb.length);
        p.postMessage(out.buffer);
    }

    function post(c, msg, pics) {
        // the list at once (the app draws a picture when it comes); then the pictures it lacks: files it keeps are asked
        // for, glyphs, art and canvases go once a session
        const p0 = port();
        if (!p0) return;
        p0.postMessage(JSON.stringify(msg));
        const fileKeys = [...pics.keys()].filter((k) => k.startsWith('p:') && !c.sent.has(k));
        let lacking = [];
        if (fileKeys.length) { try { lacking = JSON.parse(A().missing(JSON.stringify(fileKeys)) || '[]'); } catch (_) { lacking = fileKeys; } }
        fileKeys.forEach((k) => { if (!lacking.includes(k)) c.sent.add(k); });
        const want = [...lacking.filter((k) => pics.has(k)), ...[...pics.keys()].filter((k) => !k.startsWith('p:') && !c.sent.has(k))];
        if (!want.length) return;
        want.forEach((k) => c.sent.add(k));
        chain = chain.then(() => Promise.all(want.map((k) => bytesOf(pics.get(k)).then((buf) => {
            if (cur !== c || !port()) return;
            if (buf) postPicture(k, buf); else c.sent.delete(k);
        })))).catch((err) => console.warn('[dexStartMenu] send', err));
    }

    /** Something drawn changed at node (null: anywhere): its part is written down again soon. */
    function frameSoon(node) {
        const c = cur;
        if (!c) return;
        c.dirty.add(partFor(c, node && node.nodeType ? node : null));
        if (!queued) queued = setTimeout(frame, 0);
    }

    function partFor(c, node) {
        const el = node && (node.nodeType === 1 ? node : node.parentElement);
        if (!el || el === c.menu || el === doc.body) return '*';
        if (c.menu.contains(el)) {
            let ch = el;
            while (ch.parentElement && ch.parentElement !== c.menu) ch = ch.parentElement;
            return 'm' + [...c.menu.children].indexOf(ch);
        }
        const pop = el.closest('.context-menu, .context-menu-submenu, .popover.start-menu-overflow-balloon');
        return pop ? 'pop' + idOf(pop) : '*';
    }
    const changed = (records) => records.forEach((r) => frameSoon(r.target));

    // ---------------------------------------------------------------- open / close (followed from #startMenu's class)

    function menuEl() { return doc.getElementById('startMenu'); }

    /** The app can draw it and a program's window covers the menu's area now. */
    function wanted(menu) {
        if (failedRun || !port()) return false;
        try {
            if (!A().ready()) return false;
            const r = menu.getBoundingClientRect();
            return !!A().covered(JSON.stringify([r.left, r.top - 40, r.width, r.height + 40, root.innerWidth]));
        } catch (_) { return false; }
    }

    function open(menu) {
        if (cur || !wanted(menu)) return;
        const c = { sid: ++sidSeq, menu, ac: new AbortController(), parts: new Map(), lists: new Map(), dirty: new Set(['*']), sent: new Set(), pops: new Set(), bounds: '', fadeSent: 0, scrollers: new Map(), lastDown: 0 };
        cur = c;
        menu.classList.add(NATIVE);
        const sig = c.ac.signal;
        // anything drawn changing: written down again
        const mo = new MutationObserver(changed);
        mo.observe(menu, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'src', 'hidden', 'data-view'] });
        const bodyMo = new MutationObserver(changed);
        bodyMo.observe(doc.body, { childList: true });
        c.mos = [mo, bodyMo];
        // popups' own changes (their items' classes, a submenu opening)
        const popMo = new MutationObserver(changed);
        c.mos.push(popMo);
        c.watchPops = () => doc.querySelectorAll('.context-menu, .popover.start-menu-overflow-balloon').forEach((p) => { if (!p.dataset.dexStartWatched) { p.dataset.dexStartWatched = '1'; popMo.observe(p, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style'] }); } });
        c.watchPops();
        const again = (e) => { c.watchPops(); frameSoon(e && e.target); };
        ['pointerover', 'pointerout', 'pointerdown', 'pointerup', 'focusin', 'focusout', 'input', 'transitionend', 'animationend'].forEach((t) => doc.addEventListener(t, again, { capture: true, signal: sig }));
        doc.addEventListener('selectionchange', () => frameSoon(doc.activeElement), { signal: sig });
        doc.addEventListener('pointerdown', () => { c.lastDown = performance.now(); }, { capture: true, signal: sig });
        // a scroller moved: its offset only
        doc.addEventListener('scroll', (e) => {
            const sc = c.scrollers.get(e.target);
            const p = port();
            if (!sc || !p) return;
            p.postMessage(JSON.stringify({ op: 'scroll', sid: c.sid, id: sc.id, top: e.target.scrollTop }));
        }, { capture: true, signal: sig });
        frame();
    }

    function close(immediate) {
        const c = cur;
        if (!c) return;
        cur = null;
        if (queued) { clearTimeout(queued); queued = 0; }
        c.ac.abort();
        (c.mos || []).forEach((m) => m.disconnect());
        doc.querySelectorAll('[data-dex-start-watched]').forEach((p) => delete p.dataset.dexStartWatched);
        c.pops.forEach((p) => p.classList.remove(NATIVE));
        c.menu.classList.remove(NATIVE);
        const p = port();
        if (p) p.postMessage(JSON.stringify({ op: 'hide', sid: c.sid, ms: immediate ? 0 : c.closeMs || 0 }));
    }

    // the menu's class says what it does: hidden removed = opening, start-menu-closing = fading out, hidden = gone
    function follow() {
        const menu = menuEl();
        if (!menu) return false;
        followMo = new MutationObserver(() => {
            const hidden = menu.classList.contains('hidden');
            const closing = menu.classList.contains('start-menu-closing');
            if (hidden) { close(true); return; }
            if (closing) {
                if (!cur) return;
                let msOut = 0;
                (menu.getAnimations ? menu.getAnimations() : []).forEach((an) => { const t = an.effect && an.effect.getComputedTiming(); if (t && t.endTime !== Infinity) msOut = Math.max(msOut, Math.round(t.endTime - (an.currentTime || 0))); });
                cur.closeMs = msOut;
                close(false);
                return;
            }
            if (!cur) open(menu);
        });
        followMo.observe(menu, { attributes: true, attributeFilter: ['class'] });
        return true;
    }
    if (!follow()) doc.addEventListener('DOMContentLoaded', follow, { once: true, signal: lifeSignal });

    // ---------------------------------------------------------------- the app's messages and keys

    root.addEventListener('androidstartmenu', (e) => {
        const d = e && e.detail;
        if (!d) return;
        if (d.state === 'failed') { failedRun = true; close(true); return; }
        const c = cur;
        if (!c || +d.sid !== c.sid) return;
        if (d.state === 'outside') {
            // a press on a program's window; a press on this page itself is the page's own outside click
            setTimeout(() => {
                if (cur !== c || performance.now() - c.lastDown < 400) return;
                const menu = c.menu;
                if (typeof root.closeStartMenu === 'function') root.closeStartMenu();
                else menu.dispatchEvent(new CustomEvent('dexstartoutside', { bubbles: true }));
            }, 120);
        }
    }, { signal: lifeSignal });

    // keys the app took from a program while the copy is up (start: true): keydown on the focused element, and what a field
    // does with them when no handler took them (typing, Backspace, Delete, the arrows, Home, End)
    root.addEventListener('androidhotkey', (e) => {
        const k = e && e.detail;
        if (!k || !k.start || !cur) return;
        e.stopImmediatePropagation();
        // typing with nothing focused goes into the menu's search field (Vista's Start: typing is Start Search)
        const fa = doc.activeElement;
        if (k.ch && k.type === 'keydown' && !(fa && /^(INPUT|TEXTAREA)$/.test(fa.tagName) && cur.menu.contains(fa))) {
            const field = cur.menu.querySelector('input[type="text"], input:not([type]), input[type="search"]');
            if (field) field.focus({ preventScroll: true });
        }
        const target = doc.activeElement && doc.activeElement !== doc.body ? doc.activeElement : cur.menu;
        let ev;
        try {
            ev = new KeyboardEvent(k.type, { key: String(k.key || 'Unidentified'), code: String(k.code || ''), repeat: !!k.repeat, metaKey: !!k.metaKey, altKey: !!k.altKey, ctrlKey: !!k.ctrlKey, shiftKey: !!k.shiftKey, bubbles: true, cancelable: true, composed: true });
        } catch (_) { return; }
        const go = target.dispatchEvent(ev);
        if (!go || k.type !== 'keydown') return;
        const f = doc.activeElement;
        if (!f || (f.tagName !== 'INPUT' && f.tagName !== 'TEXTAREA') || f.readOnly || f.disabled) return;
        const v = f.value; let s0 = f.selectionStart || 0; let s1 = f.selectionEnd || 0;
        const edit = (text, a, b) => { f.setRangeText(text, a, b, 'end'); f.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: text ? 'insertText' : 'deleteContentBackward', data: text || null })); };
        if (k.ch && !k.ctrlKey && !k.altKey && !k.metaKey) edit(k.ch, s0, s1);
        else if (k.key === 'Backspace') { if (s0 === s1 && s0 > 0) s0--; if (s1 > s0) edit('', s0, s1); }
        else if (k.key === 'Delete') { if (s0 === s1 && s1 < v.length) s1++; if (s1 > s0) edit('', s0, s1); }
        else if (k.key === 'ArrowLeft' || k.key === 'ArrowRight' || k.key === 'Home' || k.key === 'End') {
            const pos = k.key === 'Home' ? 0 : k.key === 'End' ? v.length : k.key === 'ArrowLeft' ? (s0 === s1 ? Math.max(0, s0 - 1) : s0) : (s0 === s1 ? Math.min(v.length, s1 + 1) : s1);
            if (k.shiftKey) f.setSelectionRange(Math.min(pos, s0), Math.max(pos, s1)); else f.setSelectionRange(pos, pos);
        } else if (k.ctrlKey && (k.key === 'a' || k.key === 'A')) f.select();
        frameSoon(f);
    }, { capture: true, signal: lifeSignal });

    lifeSignal.addEventListener('abort', () => { close(true); if (followMo) followMo.disconnect(); sheet.remove(); }, { once: true });

    root.melatonDexStartMenu = {
        dispose: () => life.abort(),
        /** True while the app draws the Start menu. */
        active: () => !!cur,
        /** The frame now, as it would be sent (for checks). */
        debugFrame: () => { if (!cur) return null; cur.parts.clear(); cur.bounds = ''; cur.dirty.add('*'); frame(); return true; }
    };
})();
