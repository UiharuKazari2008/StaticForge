/**
 * Vista's Alt+Tab on the DeX desktop, drawn by the app over Android's windows (StaticForge #1054), and pictures of
 * Android's windows in it (#1049).
 *
 * keyboardShortcuts.js builds Alt+Tab's pane here as on any desktop (#1039). On the DeX screen this page is the screen's
 * home, under every Android window, so the pane would be hidden behind them. While the app can draw it (window.AndroidAltTab
 * ready(): its accessibility service follows this screen), the page's pane is written down as a drawing list from its own
 * rendering (cursor rule melaton-bars-native-layouts: the page is the point of truth) and the app (DSApp DexAltTab.kt) draws
 * exactly that above every window, with the glass's blur; the page's own pane stays laid out but unseen (.is-native).
 *
 * Sent over window.AndroidAltTabPort (a WebMessageListener, in order; the pane first, its pictures right after it):
 *   - each picture the list names that the app does not hold yet (AndroidAltTab.missing): binary
 *     [u16 key length][key utf-8][png / jpeg / bmp bytes (a canvas: bmpOf)] - never a data: string (no-base64-images). Keys: 'p:<url>' a picture
 *     file (icons, kept by the app across sessions), 'p:bg:<w>x<h>:<hash>' a box's url() background layers put together
 *     (the pane's Vista reflection, picturesOf; kept the same way), 'c:<n>:<v>' one of the pane's canvases (window pictures, this session),
 *     'aw:<window id>' an Android window's picture the app took itself;
 *   - { op: 'show', ats, sid, index, steps, vw, pane, titles, slots, sel } - the pane without a selection, each entry's
 *     caption, each slot's items, the selection's own box (relative to its slot); again whenever the pane changed
 *     (a picture came in);
 *   - { op: 'select', ats, sid, index, steps } on each Tab, { op: 'hide', ats, sid } when it goes.
 * ats is the app's Alt+Tab (handed over with its keys, 'androidhotkey'); steps is how many Tabs this page has handled, so
 * the app, which moves the selection at once on its own, never undoes a step the page has not seen yet.
 *
 * The app takes a picture of each Android window on this screen when Alt+Tab begins (never on a timer) and hands their
 * addresses over: 'androidalttabthumbs' { session, thumbs: { id: { url, w, h } } } - thumb(id) for keyboardShortcuts.js,
 * which shows them in its own pane in place of the program's icon.
 *
 * Only in the DeX desktop window (AndroidDisplay.isDesktop() with the bridge present).
 */
(function () {
    'use strict';

    const root = typeof window !== 'undefined' ? window : null;
    const doc = typeof document !== 'undefined' ? document : null;
    if (!root || !doc) return;
    const isDesktop = (() => {
        try { return !!(root.AndroidDisplay && typeof root.AndroidDisplay.isDesktop === 'function' && root.AndroidDisplay.isDesktop()); } catch (_) { return false; }
    })();
    const A0 = root.AndroidAltTab;
    if (!isDesktop || root.uiShell === 'mobile' || !A0 || typeof A0.ready !== 'function') return;
    // read at each call: a desktop paused with its display unplugged gets the new window's bridge when it resumes (#1015)
    const A = () => root.AndroidAltTab || A0;
    const port = () => root.AndroidAltTabPort || null;

    const appScopeSignal = (root.melatonSegments && typeof root.melatonSegments.callerSignal === 'function' && root.melatonSegments.callerSignal()) || undefined;

    let ats = -1;            // the app's Alt+Tab session, from its keys
    let atsAt = 0;
    let failed = false;      // the app could not show its overlay this run: the page's own pane
    const thumbs = new Map(); // Android window id -> { url, w, h }
    let cur = null;          // the pane handed over now: { overlay, sid, ats, index, steps, titles, mo, onThumbs, sent }
    let onThumbsNow = null;  // the pane up now (drawn by the app or not): its slots take the window pictures that come in
    let sidSeq = 0;
    let sendQueued = 0;
    let chain = Promise.resolve();
    const canvasIds = new WeakMap();
    let canvasSeq = 0;

    // the app's keys come in as 'androidhotkey'; androidTaskbar.js hands each one here (hotkey()) right before it replays
    // it as a key event, which opens the pane at once. Not a listener of our own: listeners on window run in the order
    // they were added, capture or not, and androidTaskbar.js's comes first - the pane opened before the session was known
    // and the app never drew it (#1054, seen on the A53 and Yukimi's Fold).
    function hotkey(k) {
        // an Alt+Tab key: the app's session when it draws this one, none when it does not
        if (k && k.key === 'Tab' && k.type === 'keydown') { ats = k.ats != null ? Number(k.ats) : -1; atsAt = performance.now(); }
    }

    root.addEventListener('androidalttabthumbs', (e) => {
        const d = e && e.detail;
        if (!d || !d.thumbs) return;
        Object.keys(d.thumbs).forEach((id) => { const t = d.thumbs[id]; if (t && t.url) thumbs.set(id, { url: String(t.url), w: +t.w || 0, h: +t.h || 0 }); });
        // the pane up now, whether the app draws it or the page does (the pictures come in after it opened, #1049)
        if (typeof onThumbsNow === 'function') { try { onThumbsNow(); } catch (err) { console.warn('[dexAltTab] thumbs', err); } }
    }, { signal: appScopeSignal });

    root.addEventListener('androidalttab', (e) => {
        const d = e && e.detail;
        if (!d || d.state !== 'failed') return;
        failed = true;
        if (cur) cur.overlay.classList.remove('is-native');
    }, { signal: appScopeSignal });

    /** The app draws this Alt+Tab: its keys started a session just now and its overlay can be shown. */
    function available() {
        if (failed || !port() || ats < 0 || performance.now() - atsAt > 2000) return false;
        try { return !!A().ready(); } catch (_) { return false; }
    }

    // ---------------------------------------------------------------- the drawing list (CSS px from the viewport's top-left)

    const px = (v) => parseFloat(v) || 0;
    const r2 = (v) => Math.round(v * 100) / 100;
    function rgba(c, mul) {
        let m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/.exec(c || '');
        // relative colours and color-mix() compute to color(srgb r g b / a), channels 0-1 (the pane's tint, #1065)
        const s = !m && /color\(srgb\s+(-?[\d.e-]+)\s+(-?[\d.e-]+)\s+(-?[\d.e-]+)(?:\s*\/\s*([\d.e-]+))?\)/.exec(c || '');
        if (s) m = [s[0], ...[s[1], s[2], s[3]].map((v) => Math.max(0, Math.min(255, +v * 255))), s[4]];
        if (!m) return null;
        const a = (m[4] == null ? 1 : +m[4]) * (mul == null ? 1 : mul);
        if (a <= 0) return null;
        return '#' + [m[1], m[2], m[3]].map((v) => Math.round(+v).toString(16).padStart(2, '0')).join('') + Math.round(Math.min(1, a) * 255).toString(16).padStart(2, '0');
    }
    // split at commas (or spaces) outside brackets
    function topSplit(v, sep) {
        const out = []; let d = 0; let s = '';
        for (const ch of String(v || '')) { if (ch === '(') d++; if (ch === ')') d--; if (ch === sep && d === 0) { if (s.trim()) out.push(s.trim()); s = ''; } else s += ch; }
        if (s.trim()) out.push(s.trim());
        return out;
    }
    const radii = (cs) => [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius].map((v) => r2(px(v)));
    const B = (b) => ({ x: r2(b.left), y: r2(b.top), w: r2(b.width), h: r2(b.height) });

    // box-shadow / text-shadow: [{ color, x, y, blur, spread, inset }]
    function shadowsOf(v) {
        if (!v || v === 'none') return [];
        return topSplit(v, ',').map((one) => {
            const color = (/(rgba?\([^)]*\))/.exec(one) || [])[1] || 'rgb(0, 0, 0)';
            const nums = one.replace(/rgba?\([^)]*\)/, '').replace('inset', '').trim().split(/\s+/).map(px);
            return { color, x: nums[0] || 0, y: nums[1] || 0, blur: nums[2] || 0, spread: nums[3] || 0, inset: /\binset\b/.test(one) };
        });
    }

    // a linear-gradient's stops along a length (% or px), reversed when it runs up or left
    function gradient(v, box, r, alpha) {
        const m = /^linear-gradient\((.*)\)$/.exec(v.trim());
        if (!m) return null;
        const args = topSplit(m[1], ',');
        let dir = 'v'; let rev = false;
        if (/^(to |-?[\d.]+deg)/.test(args[0])) {
            const a = args.shift();
            const deg = /(-?[\d.]+)deg/.exec(a);
            if (deg) { const d = ((+deg[1] % 360) + 360) % 360; dir = d === 90 || d === 270 ? 'h' : 'v'; rev = d === 0 || d === 270; } else { dir = /right|left/.test(a) ? 'h' : 'v'; rev = /to (top|left)/.test(a); }
        }
        const len = dir === 'h' ? box.width : box.height;
        let stops = args.map((a) => {
            const mm = /^(.*?)(?:\s+(-?[\d.]+)(%|px))?$/.exec(a.trim());
            const pos = mm[2] == null ? null : mm[3] === '%' ? +mm[2] / 100 : (len > 0 ? +mm[2] / len : 0);
            return { c: rgba(mm[1], alpha) || '#00000000', p: pos };
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
        stops = stops.map((s) => [s.c, Math.max(0, Math.min(1, s.p))]);
        if (rev) stops = stops.reverse().map(([c, p]) => [c, 1 - p]);
        return Object.assign({ k: 'grad' }, B(box), { r, dir, stops });
    }

    /** A picture's key, and what to send for it when the app lacks it. */
    function picKey(el, pics) {
        if (el.tagName === 'CANVAS') {
            if (!canvasIds.has(el)) canvasIds.set(el, ++canvasSeq);
            const key = `c:${canvasIds.get(el)}:${el.dataset.drawn || 0}`;
            pics.set(key, el);
            return key;
        }
        const url = el.currentSrc || el.src || '';
        if (!url) return null;
        const t = /\/\/appassets\.androidplatform\.net\/dex-thumb\/[^/]+\/([A-Za-z0-9_-]+)\.jpg/.exec(url);
        if (t) return `aw:${t[1]}`;
        const key = `p:${url}`;
        pics.set(key, el);
        return key;
    }

    // a background length (px, %, calc(% +/- px)) along an axis whose free room (area - tile) is free
    function bgLen(v, free) {
        const t = String(v || '0').trim();
        const c = /^calc\((.*)\)$/.exec(t);
        const one = (u) => (/%$/.test(u) ? (free * parseFloat(u)) / 100 : px(u));
        if (!c) return one(t);
        let sum = 0; let sign = 1;
        c[1].split(/\s+/).forEach((tok) => { if (tok === '+') sign = 1; else if (tok === '-') sign = -1; else { sum += sign * one(tok); sign = 1; } });
        return sum;
    }
    const layerPics = new Map(); // url -> Image (decoded once, kept for the next Alt+Tab)
    function layerPic(url) {
        let im = layerPics.get(url);
        if (!im) { im = new Image(); im.decoding = 'async'; im.src = url; layerPics.set(url, im); }
        return im.decode().then(() => im, () => null);
    }
    /**
     * The box's url() background layers (the pane's Vista reflection, #1065) as ONE picture of the box's size, put
     * together here as the browser lays them out (size and position in px, % or calc(), no-repeat, border-box): the
     * app draws it over the tint, cut to the box's corners. Keyed by what it shows, so the app keeps it for the next
     * Alt+Tab of that size. Gradient layers stay drawn by the app (gradient()).
     */
    function picturesOf(cs, b, r, pics) {
        if (!pics || !cs.backgroundImage || !/url\(/.test(cs.backgroundImage)) return null;
        const imgs = topSplit(cs.backgroundImage, ',');
        const sizes = topSplit(cs.backgroundSize, ',');
        const poss = topSplit(cs.backgroundPosition, ',');
        const w = Math.round(b.width); const h = Math.round(b.height);
        if (!w || !h) return null;
        const layers = [];
        for (let i = imgs.length - 1; i >= 0; i--) {
            const u = /^url\(["']?(.*?)["']?\)$/.exec(imgs[i]);
            if (!u) continue;
            const sz = topSplit(sizes[i % sizes.length] || 'auto', ' ');
            const tw = bgLen(sz[0], w); const th = bgLen(sz[1] || sz[0], h);
            if (!(tw > 0 && th > 0)) continue;
            const ps = topSplit(poss[i % poss.length] || '0% 0%', ' ');
            layers.push({ url: u[1], x: bgLen(ps[0], w - tw), y: bgLen(ps[1] || '50%', h - th), w: tw, h: th });
        }
        if (!layers.length) return null;
        const sig = `${w}x${h}|` + layers.map((l) => `${l.url}@${r2(l.x)},${r2(l.y)},${r2(l.w)},${r2(l.h)}`).join('|');
        let hsh = 5381;
        for (let i = 0; i < sig.length; i++) hsh = ((hsh * 33) ^ sig.charCodeAt(i)) >>> 0;
        const key = `p:bg:${w}x${h}:${hsh.toString(36)}`;
        pics.set(key, {
            render: () => Promise.all(layers.map((l) => layerPic(l.url))).then((ims) => {
                const cv = doc.createElement('canvas');
                cv.width = w; cv.height = h;
                const x = cv.getContext('2d');
                if (!x) return null;
                ims.forEach((im, i) => { if (im) x.drawImage(im, layers[i].x, layers[i].y, layers[i].w, layers[i].h); });
                return cv;
            })
        });
        return Object.assign({ k: 'img' }, B(b), { key, clip: [r2(b.left), r2(b.top), r2(b.width), r2(b.height), r] });
    }

    /** el's own box as the page draws it (shadows, glass, background, border) into out. */
    function boxOf(el, cs, alpha, out, pics) {
        const b = el.getBoundingClientRect();
        const r = radii(cs);
        const sh = shadowsOf(cs.boxShadow);
        // outer shadows under everything, the first on top
        sh.filter((s) => !s.inset).reverse().forEach((s) => {
            const color = rgba(s.color, alpha);
            if (color) out.push(Object.assign({ k: 'shadow' }, B(b), { r, dx: r2(s.x), dy: r2(s.y), blur: r2(s.blur), spread: r2(s.spread), color }));
        });
        // glass: the app blurs what is behind (backdrop-filter: blur() saturate())
        const bf = cs.backdropFilter || cs.webkitBackdropFilter || '';
        if (bf && bf !== 'none') {
            const blur = /blur\(\s*([\d.]+)px/.exec(bf); const sat = /saturate\(\s*([\d.]+)(%?)/.exec(bf);
            out.push(Object.assign({ k: 'backdrop' }, B(b), { r, blur: blur ? +blur[1] : 0, sat: sat ? (sat[2] ? +sat[1] / 100 : +sat[1]) : 1 }));
        }
        const fill = rgba(cs.backgroundColor, alpha);
        if (fill) out.push(Object.assign({ k: 'rect' }, B(b), { r, fill }));
        const layers = picturesOf(cs, b, r, pics);
        if (layers) out.push(layers);
        if (cs.backgroundImage && cs.backgroundImage !== 'none') {
            topSplit(cs.backgroundImage, ',').reverse().forEach((layer) => {
                const g = gradient(layer, b, r, alpha);
                if (g) out.push(g);
            });
        }
        // inset shadows with no blur are lines inside the edge (the pane's white and cyan rims)
        sh.filter((s) => s.inset && !s.blur).reverse().forEach((s) => {
            const color = rgba(s.color, alpha);
            if (!color) return;
            const bw = [s.spread + s.y, s.spread - s.x, s.spread - s.y, s.spread + s.x].map((v) => r2(Math.max(0, v)));
            if (bw.some((v) => v > 0)) out.push(Object.assign({ k: 'border' }, B(b), { r, bw, color: bw.map((v) => (v > 0 ? color : null)) }));
        });
        const bw = [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth].map((v) => r2(px(v)));
        if (bw.some((v) => v > 0)) {
            const bc = [cs.borderTopColor, cs.borderRightColor, cs.borderBottomColor, cs.borderLeftColor].map((c) => rgba(c, alpha));
            if (bc.some(Boolean)) out.push(Object.assign({ k: 'border' }, B(b), { r, bw, color: bc }));
        }
        return b;
    }

    /** el and what it holds, in paint order, into out (pictures it names into pics). */
    function treeOf(el, out, pics, inherited, own) {
        if (!el.getClientRects().length) return;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return;
        const alpha = (inherited == null ? 1 : inherited) * (+cs.opacity || 1);
        const b = own === false ? el.getBoundingClientRect() : boxOf(el, cs, alpha, out, pics);
        if (el.tagName === 'IMG' || el.tagName === 'CANVAS') {
            const key = picKey(el, pics);
            if (key) out.push(Object.assign({ k: 'img' }, B(b), { key, alpha: alpha < 1 ? alpha : undefined, clip: [r2(b.left), r2(b.top), r2(b.width), r2(b.height), radii(cs)] }));
            return;
        }
        [...el.childNodes].forEach((n) => {
            if (n.nodeType === 1) treeOf(n, out, pics, alpha, true);
            else if (n.nodeType === 3 && n.textContent.trim()) textOf(n, el, cs, b, alpha, out);
        });
    }

    function textOf(n, el, cs, b, alpha, out) {
        const range = doc.createRange();
        range.selectNodeContents(n);
        const rr = range.getBoundingClientRect();
        if (!rr.width) return;
        const one = {
            k: 'text', x: r2(rr.left), y: r2(rr.top), h: r2(rr.height), w: r2(rr.width),
            s: n.textContent.replace(/^\s+|\s+$/g, '').replace(/\s+/g, ' '),
            size: r2(px(cs.fontSize)), bold: (+cs.fontWeight || 400) >= 600, color: rgba(cs.color, alpha) || '#000000ff',
            font: (topSplit(cs.fontFamily, ',')[0] || '').replace(/["']/g, ''), ls: r2(px(cs.letterSpacing)),
            u: /underline/.test(cs.textDecorationLine || '')
        };
        const glow = shadowsOf(cs.textShadow).map((s) => [r2(s.x), r2(s.y), r2(s.blur), rgba(s.color, alpha)]).filter((s) => s[3]);
        if (glow.length) one.glow = glow;
        // a caption longer than its box: cut where the box ends, "..." when the page ends it so
        if (cs.overflowX !== 'visible') {
            const inner = b.right - px(cs.borderRightWidth) - px(cs.paddingRight);
            const left = b.left + px(cs.borderLeftWidth) + px(cs.paddingLeft);
            if (rr.right > inner + 0.5 || rr.left < left - 0.5) { one.x = r2(left); one.cw = r2(Math.max(0, inner - left)); if (cs.textOverflow === 'ellipsis') one.ell = true; }
        }
        if (one.s) out.push(one);
    }

    // ---------------------------------------------------------------- sending

    /**
     * A canvas's pixels as a 32-bit BMP (top-down, alpha kept), which the app decodes as it does a PNG. Not toBlob /
     * convertToBlob: in a WebView a Blob is made on the app's main thread, which is busy - 2.7 to 4 s for a 125 x 78 canvas
     * on the A53, so the window pictures came seconds after the pane (#1054). getImageData is under a millisecond here.
     */
    function bmpOf(el) {
        const w = el.width; const h = el.height;
        if (!w || !h) return null;
        let px;
        try {
            const x = el.getContext('2d', { willReadFrequently: false });
            px = x && x.getImageData(0, 0, w, h).data;
        } catch (_) { px = null; }
        if (!px) return null;
        const head = 14 + 108;
        const buf = new ArrayBuffer(head + w * h * 4);
        const v = new DataView(buf);
        v.setUint8(0, 0x42); v.setUint8(1, 0x4d); v.setUint32(2, buf.byteLength, true); v.setUint32(10, head, true);
        // BITMAPV4HEADER: BI_BITFIELDS with an alpha mask, negative height = rows top first
        v.setUint32(14, 108, true); v.setInt32(18, w, true); v.setInt32(22, -h, true); v.setUint16(26, 1, true); v.setUint16(28, 32, true);
        v.setUint32(30, 3, true); v.setUint32(34, w * h * 4, true); v.setInt32(38, 2835, true); v.setInt32(42, 2835, true);
        v.setUint32(54, 0x00ff0000, true); v.setUint32(58, 0x0000ff00, true); v.setUint32(62, 0x000000ff, true); v.setUint32(66, 0xff000000, true);
        v.setUint32(70, 0x73524742, true); // 'sRGB'
        const out = new Uint8Array(buf, head);
        for (let i = 0; i < px.length; i += 4) { out[i] = px[i + 2]; out[i + 1] = px[i + 1]; out[i + 2] = px[i]; out[i + 3] = px[i + 3]; }
        return buf;
    }

    function bytesOf(el) {
        if (typeof el.render === 'function') return el.render().then((cv) => (cv ? bmpOf(cv) : null)).catch(() => null);
        if (el.tagName === 'CANVAS') {
            const bmp = bmpOf(el);
            if (bmp) return Promise.resolve(bmp);
            return new Promise((res) => { try { el.toBlob((b) => res(b ? b.arrayBuffer() : null), 'image/png'); } catch (_) { res(null); } });
        }
        const url = el.currentSrc || el.src;
        return fetch(url).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null);
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

    /** The pane as it is now, written down and handed over (its pictures first). */
    function send() {
        sendQueued = 0;
        const c = cur;
        if (!c || !port()) return;
        const content = c.overlay.querySelector('.window-switcher-content');
        const title = c.overlay.querySelector('.window-switcher-title');
        const slots = [...c.overlay.querySelectorAll('.window-switcher-item')];
        if (!content || !title || !slots.length) return;
        const pics = new Map();
        const pane = [];
        // the pane's own box (no selection anywhere while it is written down)
        const chosen = slots.filter((s) => s.classList.contains('selected'));
        chosen.forEach((s) => s.classList.remove('selected'));
        const savedTitle = title.textContent;
        let titles = []; let items = []; let sel = [];
        try {
            // (its caption and slots are written down on their own)
            boxOf(content, getComputedStyle(content), 1, pane, pics);
            items = slots.map((s) => { const out = []; treeOf(s, out, pics, 1, true); const r = s.getBoundingClientRect(); return { x: r2(r.left), y: r2(r.top), w: r2(r.width), h: r2(r.height), items: out }; });
            titles = c.titles.map((t) => { title.textContent = t; const out = []; treeOf(title, out, pics, 1, true); return out; });
            // the selection's own box, relative to its slot
            slots[0].classList.add('selected');
            const s0 = slots[0].getBoundingClientRect();
            boxOf(slots[0], getComputedStyle(slots[0]), 1, sel);
            slots[0].classList.remove('selected');
            sel = sel.map((o) => Object.assign({}, o, { x: r2(o.x - s0.left), y: r2(o.y - s0.top) }));
        } finally {
            title.textContent = savedTitle;
            slots.forEach((s) => s.classList.remove('selected'));
            chosen.forEach((s) => s.classList.add('selected'));
            if (c.mo) c.mo.takeRecords();
        }
        const msg = { op: 'show', ats: c.ats, sid: c.sid, index: c.index, steps: c.steps, vw: root.innerWidth, pane, titles, slots: items, sel: { items: sel } };
        // the pane at once; the pictures it names that the app lacks follow, each as soon as it is read (the app draws a
        // picture when it comes in). Waiting for them first held the pane back for 1-5 s on the A53 (#1054).
        port().postMessage(JSON.stringify(msg));
        const fileKeys = [...pics.keys()].filter((k) => k.startsWith('p:') && !c.sent.has(k));
        let lacking = [];
        try { lacking = JSON.parse(A().missing(JSON.stringify(fileKeys)) || '[]'); } catch (_) { lacking = fileKeys; }
        const want = [...lacking.filter((k) => pics.has(k)), ...[...pics.keys()].filter((k) => k.startsWith('c:') && !c.sent.has(k))];
        if (!want.length) return;
        // asked for once per pane (a later write-down while one is on its way does not read it again)
        want.forEach((k) => c.sent.add(k));
        chain = chain.then(() => Promise.all(want.map((k) => bytesOf(pics.get(k)).then((buf) => {
            if (cur !== c) return;
            if (buf) postPicture(k, buf); else c.sent.delete(k);
        }))))
            .catch((err) => console.warn('[dexAltTab] send', err));
    }

    function sendSoon() { if (!sendQueued && cur) sendQueued = setTimeout(send, 0); }

    // ---------------------------------------------------------------- keyboardShortcuts.js

    root.melatonDexAltTab = {
        /** One of the app's DeX keys ('androidhotkey' detail), before the page replays it (androidTaskbar.js). */
        hotkey,
        /** An Android window's picture { url, w, h } taken when this Alt+Tab began (or its last), else null. */
        thumb: (id) => thumbs.get(String(id)) || null,
        /**
         * Alt+Tab's pane is up (overlay: #windowSwitcherOverlay, built for this session; titles: each entry's caption in
         * the slots' order; index: the chosen one; onThumbs: called when pictures of Android windows came in). True when
         * the app draws it: the page's own pane stays unseen.
         */
        open: (overlay, opts) => {
            close();
            onThumbsNow = opts && typeof opts.onThumbs === 'function' ? opts.onThumbs : null;
            if (!overlay || !overlay.querySelector('.window-switcher-item')) return false; // the classic icon row is not drawn by the app
            // opened without the app's keys (the key reached this page itself): the app starts a session for it (#1054)
            if (!available() && !failed && port()) {
                try { const s = typeof A().begin === 'function' ? Number(A().begin()) : -1; if (s >= 0) { ats = s; atsAt = performance.now(); } } catch (_) { /* the page's pane */ }
            }
            if (!available()) return false;
            const live = new Set((root.melatonAndroidTaskbar && typeof root.melatonAndroidTaskbar.windows === 'function' ? root.melatonAndroidTaskbar.windows() : []).map((w) => String(w.id)));
            [...thumbs.keys()].forEach((id) => { if (!live.has(id)) thumbs.delete(id); });
            cur = { overlay, sid: ++sidSeq, ats, index: +opts.index || 0, steps: 0, titles: (opts.titles || []).map(String), onThumbs: opts.onThumbs, sent: new Set(), mo: null };
            overlay.classList.add('is-native');
            // the pane changes (a window's picture came in, the row rebuilt): written down again
            cur.mo = new MutationObserver(sendSoon);
            cur.mo.observe(overlay, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-drawn', 'src', 'style'] });
            sendSoon();
            return true;
        },
        /** Tab / Shift+Tab moved the choice (each call is one key handled). */
        select: (index) => {
            const c = cur;
            if (!c) return;
            c.index = +index || 0;
            c.steps++;
            const p = port();
            if (p) p.postMessage(JSON.stringify({ op: 'select', ats: c.ats, sid: c.sid, index: c.index, steps: c.steps }));
        },
        close
    };

    function close() {
        onThumbsNow = null;
        const c = cur;
        if (!c) return;
        cur = null;
        if (sendQueued) { clearTimeout(sendQueued); sendQueued = 0; }
        if (c.mo) c.mo.disconnect();
        c.overlay.classList.remove('is-native');
        const p = port();
        if (p) p.postMessage(JSON.stringify({ op: 'hide', ats: c.ats, sid: c.sid }));
    }
})();
