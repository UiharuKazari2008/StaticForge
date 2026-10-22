/**
 * Windows Flip 3D (Vista's Win+Tab): the open windows and the desktop stacked in perspective,
 * drawn with WebGL. A lazy feature ("flip3d", featureLoader.js), opened by
 *
 *   flip3d.open('hold')     Win+Tab: keeps going while the Windows key is down, the key's
 *                           release switches (keyboardShortcuts.js windowSwitcherHoldKeyFor)
 *   flip3d.open('sticky')   Ctrl+Win+Tab and Quick Launch's "Switch between windows"
 *                           (taskbarSettings.js): stays until Enter, a click or Esc
 *   flip3d.prewarm()        captures windows ahead, when the Windows key goes down or the
 *                           pointer rests on the Quick Launch button
 *
 * In it: Tab / Right / Down / wheel down step forward, Shift+Tab / Left / Up / wheel up back,
 * Enter / Space or a click on a window switch to it, Esc (or a click on empty space) goes back
 * to the window that was in front. open() returns false when WebGL is not there, and the
 * callers fall back to the window switcher (keyboardShortcuts.js startWindowSwitcher).
 *
 * Measured on the Vista VM (2026-10-22, docs: the stack fitted to a 1920x1200 capture):
 * - the stack: a camera at the screen centre, f = 1305 px (1200 px high screen); every window
 *   keeps its own pixel size, its bottom-left corner on a line from (16, 697, 2121) stepping
 *   (-350, -161, 315) per slot, turned 20.3 deg about Y (right edge away) and 5.9 deg about X
 *   (top towards you). The camera numbers scale with the screen height.
 * - everything behind the stack (wallpaper, gadgets, the taskbar) is dimmed to half, a linear
 *   fade over ~250 ms; the windows fly from where they are to the stack in the same time.
 * - a step: the front window slides out towards you and fades while it fades in at the back,
 *   the others move up a slot, ~250 ms. The desktop is a card of its own, last in the stack.
 *
 * Each window is a texture: its DOM copied into an SVG foreignObject with the CSS rules that
 * match it (an index of the page's rules by id / class / tag), its images, fonts and CSS art
 * inlined as data: URLs (a data: URL SVG does not taint the canvas; a blob: one does), drawn
 * into a canvas; canvases and videos are drawn on top from the live elements. A texture is
 * kept while its window does not change (a MutationObserver marks it dirty), so a second
 * Flip 3D only redraws what changed. Rendering runs only while something moves.
 */
(function (root) {
    'use strict';

    const doc = typeof document !== 'undefined' ? document : null;

    // ---- the stack (VM fit, 1920x1200) ---------------------------------------------------------

    const VM_H = 1200;
    const STACK = Object.freeze({
        f: 1305.19,
        c0: [15.70, 696.85, 2121.31],
        d: [-349.69, -161.35, 314.97],
        theta: 0.3547,
        phi: 0.1025
    });
    const ANIM_MS = 250;
    const DIM = 0.5;
    const MAX_SLOTS = 16;

    /** The camera for a viewport: focal length and principal point, in CSS px. */
    function camera(vw, vh) {
        const k = vh / VM_H;
        return { f: STACK.f * k, cx: vw / 2, cy: vh / 2, k };
    }

    /** Slot s's pose (s may be fractional; -1 is out in front, the line goes on behind). */
    function slotPose(cam, s) {
        const k = cam.k;
        return {
            x: (STACK.c0[0] + s * STACK.d[0]) * k,
            y: (STACK.c0[1] + s * STACK.d[1]) * k,
            z: (STACK.c0[2] + s * STACK.d[2]) * k,
            theta: STACK.theta,
            phi: STACK.phi
        };
    }

    /** A window where it is on screen: its bottom-left corner at depth f, flat. */
    function flatPose(cam, rect) {
        return { x: rect.left - cam.cx, y: rect.top + rect.height - cam.cy, z: cam.f, theta: 0, phi: 0 };
    }

    function lerpPose(a, b, t) {
        return {
            x: a.x + (b.x - a.x) * t,
            y: a.y + (b.y - a.y) * t,
            z: a.z + (b.z - a.z) * t,
            theta: a.theta + (b.theta - a.theta) * t,
            phi: a.phi + (b.phi - a.phi) * t
        };
    }

    /** A card's four corners in camera space (TL, TR, BL, BR), w x h px, anchored bottom-left;
     *  `pad` px more all round (the texture's transparent rim). */
    function corners(pose, w, h, pad = 0) {
        const ct = Math.cos(pose.theta), st = Math.sin(pose.theta);
        const cp = Math.cos(pose.phi), sp = Math.sin(pose.phi);
        const out = [];
        [[-pad, -h - pad], [w + pad, -h - pad], [-pad, pad], [w + pad, pad]].forEach(([lx, ly]) => {
            const x = lx * ct, z0 = lx * st;
            const y = ly * cp - z0 * sp;
            const z = ly * sp + z0 * cp;
            out.push([pose.x + x, pose.y + y, pose.z + z]);
        });
        return out;
    }

    function project(cam, p) {
        return [cam.cx + cam.f * p[0] / p[2], cam.cy + cam.f * p[1] / p[2]];
    }

    /** Where card i draws at rotation r (cards: n): one or two [slot, alpha] (a card wrapping
     *  from the front to the back shows leaving in front and arriving behind at once). */
    function cardSlots(i, r, n) {
        if (n <= 1) return [[0, 1]];
        let s = (i - r) % n;
        if (s < 0) s += n;
        if (s === 0) s = 0; // not -0
        if (s <= n - 1) return [[s, 1]];
        const front = s - n; // in (-1, 0)
        return [[front, 1 + front], [s, n - s]].filter((x) => x[1] > 0.001);
    }

    const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

    // ---- the window list -----------------------------------------------------------------------

    function isWindow(m) {
        return !!m && m.classList && m.classList.contains('modal') && !m.classList.contains('hidden') &&
            !m.classList.contains('hidden-alt') && !m.classList.contains('closing') && !!m.querySelector('.modal-window-title');
    }

    /** The windows front to back: the active one, then by last use (keyboardShortcuts.js order). */
    function windowOrder() {
        if (!doc) return [];
        const all = Array.from(doc.querySelectorAll('.modal:not(.hidden)')).filter(isWindow);
        let used = [];
        // getWindowUsageStack: public/scripts/comp/modalUtils.js (most recent first)
        if (typeof root.getWindowUsageStack === 'function') used = (root.getWindowUsageStack() || []).filter((m) => all.includes(m));
        const seen = new Set(used);
        const order = used.concat(all.filter((m) => !seen.has(m)));
        const active = doc.querySelector('.modal.active-window:not(.minimised)');
        const ai = order.indexOf(active);
        if (ai > 0) order.unshift(order.splice(ai, 1)[0]);
        return order;
    }

    // ---- CSS rule index ------------------------------------------------------------------------

    const DYNAMIC_PSEUDO = /::?(?:before|after|placeholder|selection|marker|first-line|first-letter|backdrop|file-selector-button|-webkit-[\w-]+|-moz-[\w-]+)\b(?:\([^)]*\))?|:(?:hover|active|focus|focus-visible|focus-within|visited|target)\b/g;

    /** The selector to test against the live window: pseudo-elements and states taken off. */
    function testSelector(sel) {
        let q = sel.replace(DYNAMIC_PSEUDO, '').trim();
        if (!q || /[>+~]$/.test(q)) q += '*';
        return q;
    }

    /** A selector list's selectors (commas inside :is() / :not() / [attr="a,b"] kept). */
    function splitSelectors(text) {
        const out = [];
        let depth = 0;
        let quote = '';
        let start = 0;
        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            if (quote) {
                if (ch === '\\') i++;
                else if (ch === quote) quote = '';
            } else if (ch === '"' || ch === "'") quote = ch;
            else if (ch === '\\') i++;
            else if (ch === '(' || ch === '[') depth++;
            else if (ch === ')' || ch === ']') depth--;
            else if (ch === ',' && depth === 0) {
                out.push(text.slice(start, i).trim());
                start = i + 1;
            }
        }
        out.push(text.slice(start).trim());
        return out.filter(Boolean);
    }

    const STATE_ONLY = /:(?:hover|active|focus|focus-visible|focus-within)\b/;

    /** A selector that needs a pointer or focus state (outside :not()) never matches a picture. */
    function stateOnly(sel) {
        let out = '';
        let depth = 0;
        for (let i = 0; i < sel.length; i++) {
            if (depth === 0 && sel.startsWith(':not(', i)) {
                depth = 1;
                i += 4;
                continue;
            }
            const ch = sel[i];
            if (depth) {
                if (ch === '(') depth++;
                else if (ch === ')') depth--;
                continue;
            }
            out += ch;
        }
        return STATE_ONLY.test(out);
    }

    /** One simple selector every match of `sel` must carry in its last compound: '#id', '.class',
     *  a tag name, or '*' when there is none to go by. */
    function rightmostKey(sel) {
        let depth = 0;
        let start = 0;
        for (let i = sel.length - 1; i >= 0; i--) {
            const ch = sel[i];
            if (ch === ')' || ch === ']') depth++;
            else if (ch === '(' || ch === '[') depth--;
            else if (depth === 0 && (ch === ' ' || ch === '>' || ch === '+' || ch === '~') && sel[i - 1] !== '\\') { start = i + 1; break; }
        }
        const comp = sel.slice(start).trim();
        if (!comp || comp.includes('\\')) return '*';
        let cls = null;
        let tag = null;
        depth = 0;
        for (let i = 0; i < comp.length; i++) {
            const ch = comp[i];
            if (ch === '(' || ch === '[') { depth++; continue; }
            if (ch === ')' || ch === ']') { depth--; continue; }
            if (depth) continue;
            if (ch === '#' || ch === '.') {
                const m = /^[\w-]+/.exec(comp.slice(i + 1));
                if (!m) continue;
                if (ch === '#') return `#${m[0]}`;
                if (!cls) cls = `.${m[0]}`;
            } else if (i === 0 && /[a-zA-Z]/.test(ch)) {
                const m = /^[a-zA-Z][\w-]*/.exec(comp);
                if (m) tag = m[0].toLowerCase();
            }
        }
        return cls || tag || '*';
    }

    let ruleIndex = null;

    /** A rule's url()s made absolute: they are relative to their style sheet, not the page. */
    function absolutize(text, base) {
        if (!base || text.indexOf('url(') < 0) return text;
        return text.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (all, q, u) => {
            if (/^(data|blob|https?):|^#|^\//.test(u)) return all;
            try { const a = new URL(u, base); return `url("${a.pathname}${a.search}")`; } catch (_) { return all; }
        });
    }

    function sheetSignature() {
        let n = 0;
        const sheets = doc.styleSheets;
        for (let i = 0; i < sheets.length; i++) {
            try { n += sheets[i].cssRules.length; } catch (_) { /* cross-origin */ }
        }
        return `${sheets.length}:${n}:${root.innerWidth}x${root.innerHeight}`;
    }

    function buildRuleIndex() {
        const entries = [];
        const byKey = new Map();
        const faces = [];
        const extra = [];
        const add = (key, idx) => {
            let list = byKey.get(key);
            if (!list) byKey.set(key, (list = []));
            if (list[list.length - 1] !== idx) list.push(idx);
        };
        const walk = (list, wrap) => {
            for (let i = 0; i < list.length; i++) {
                const r = list[i];
                const base = r.parentStyleSheet && r.parentStyleSheet.href;
                if (r.type === 1) {
                    const sels = splitSelectors(r.selectorText).filter((x) => !stateOnly(x));
                    if (!sels.length) continue;
                    const idx = entries.length;
                    // the text is made on first match (most of the ~30k rules never are)
                    entries.push({ rule: r, wrap, base, text: null, tests: sels.map(testSelector) });
                    sels.forEach((s) => add(rightmostKey(s.replace(DYNAMIC_PSEUDO, '')), idx));
                } else if (r.type === 4) {
                    if (root.matchMedia(r.conditionText || r.media.mediaText).matches) walk(r.cssRules, wrap);
                } else if (r.type === 12) {
                    if (CSS.supports(r.conditionText)) walk(r.cssRules, wrap);
                } else if (r.type === 5) {
                    faces.push(r);
                } else if (r.type === 3) {
                    try { if (r.styleSheet) walk(r.styleSheet.cssRules, wrap); } catch (_) { /* cross-origin */ }
                } else if (typeof CSSContainerRule !== 'undefined' && r instanceof CSSContainerRule) {
                    const cond = r.conditionText;
                    walk(r.cssRules, (t) => wrap(`@container ${cond}{${t}}`));
                } else if (typeof CSSLayerBlockRule !== 'undefined' && r instanceof CSSLayerBlockRule) {
                    const name = r.name;
                    walk(r.cssRules, (t) => wrap(`@layer ${name}{${t}}`));
                } else if (typeof CSSPropertyRule !== 'undefined' && r instanceof CSSPropertyRule) {
                    extra.push(r.cssText);
                }
            }
        };
        const sheets = doc.styleSheets;
        for (let i = 0; i < sheets.length; i++) {
            let rules;
            try { rules = sheets[i].cssRules; } catch (_) { continue; }
            walk(rules, (t) => t);
        }
        return { sig: sheetSignature(), entries, byKey, faces, extra };
    }

    function rules() {
        if (!ruleIndex || ruleIndex.sig !== sheetSignature()) ruleIndex = buildRuleIndex();
        return ruleIndex;
    }

    /** The rule texts that match the window or anything in it, in cascade order (tested in
     *  slices of ~12 ms, so the page keeps answering). */
    async function matchingRules(win) {
        const idx = rules();
        const keys = new Set(['*']);
        const els = [win].concat(Array.from(win.getElementsByTagName('*')));
        els.forEach((el) => {
            keys.add(el.localName);
            if (el.id) keys.add(`#${el.id}`);
            const cl = el.classList;
            for (let i = 0; i < cl.length; i++) keys.add(`.${cl[i]}`);
        });
        const marks = new Uint8Array(idx.entries.length);
        const picked = [];
        keys.forEach((k) => {
            const list = idx.byKey.get(k);
            if (!list) return;
            for (let i = 0; i < list.length; i++) {
                if (!marks[list[i]]) {
                    marks[list[i]] = 1;
                    picked.push(list[i]);
                }
            }
        });
        picked.sort((a, b) => a - b);
        const out = [];
        let sliceStart = performance.now();
        for (let n = 0; n < picked.length; n++) {
            if ((n & 31) === 0 && performance.now() - sliceStart > 12) {
                await yieldTask();
                sliceStart = performance.now();
            }
            const e = idx.entries[picked[n]];
            for (let j = 0; j < e.tests.length; j++) {
                const q = e.tests[j];
                let hit;
                try { hit = win.matches(q) || !!win.querySelector(q); } catch (_) { hit = true; }
                if (hit) {
                    if (e.text === null) {
                        const t = e.wrap(absolutize(e.rule.cssText, e.base));
                        // the picture's root element is the <svg>: :root means our <html> copy
                        e.text = t.indexOf(':root') >= 0 ? t.replace(/:root\b/g, 'html') : t;
                    }
                    out.push(e.text);
                    break;
                }
            }
        }
        return out;
    }

    // ---- inlining resources --------------------------------------------------------------------

    const dataUrls = new Map();
    let dataUrlChars = 0;
    const DATA_URL_BUDGET = 32 * 1024 * 1024;
    const BIG_IMAGE = 256 * 1024;

    /** Keeps a data: URL (the cache starts over past ~32 MB of them). */
    function remember(key, promise) {
        if (dataUrlChars > DATA_URL_BUDGET) {
            dataUrls.clear();
            dataUrlChars = 0;
        }
        dataUrls.set(key, promise);
        promise.then((d) => { dataUrlChars += d ? d.length : 0; });
        return promise;
    }
    const BIG_IMAGE_SIDE = 1024;

    function blobToDataUrl(blob) {
        return new Promise((resolve) => {
            const fr = new FileReader();
            fr.onload = () => resolve(String(fr.result));
            fr.onerror = () => resolve('');
            fr.readAsDataURL(blob);
        });
    }

    /** A same-origin resource as a data: URL (big pictures shrunk to 1024 px first). */
    function dataUrl(url) {
        let abs;
        try { abs = new URL(url, root.location.href); } catch (_) { return Promise.resolve(''); }
        if (abs.origin !== root.location.origin) return Promise.resolve('');
        const key = abs.href;
        if (!dataUrls.has(key)) {
            remember(key, fetch(key, { credentials: 'same-origin' }).then((res) => (res.ok ? res.blob() : null)).then(async (blob) => {
                if (!blob) return '';
                if (blob.size > BIG_IMAGE && /^image\//.test(blob.type) && !/svg/.test(blob.type) && typeof createImageBitmap === 'function') {
                    try {
                        const bmp = await createImageBitmap(blob);
                        const s = Math.min(1, BIG_IMAGE_SIDE / Math.max(bmp.width, bmp.height));
                        const c = doc.createElement('canvas');
                        c.width = Math.max(1, Math.round(bmp.width * s));
                        c.height = Math.max(1, Math.round(bmp.height * s));
                        c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
                        bmp.close();
                        return c.toDataURL('image/webp', 0.9);
                    } catch (_) { /* fall through to the file itself */ }
                }
                return blobToDataUrl(blob);
            }).catch(() => ''));
        }
        return dataUrls.get(key);
    }

    const URL_RE = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;

    /** image-set() / -webkit-image-set() as the one url() closest to this screen's density. */
    function flattenImageSets(css) {
        const want = Math.min(2, root.devicePixelRatio || 1);
        let out = '';
        let i = 0;
        for (;;) {
            const m = /(?:-webkit-)?image-set\(/g;
            m.lastIndex = i;
            const hit = m.exec(css);
            if (!hit) break;
            let depth = 1;
            let j = hit.index + hit[0].length;
            for (; j < css.length && depth; j++) {
                if (css[j] === '(') depth++;
                else if (css[j] === ')') depth--;
            }
            const body = css.slice(hit.index + hit[0].length, j - 1);
            let best = null;
            body.split(/,(?![^(]*\))/).forEach((part) => {
                const u = /url\(\s*(['"]?)([^'")]+)\1\s*\)|(['"])([^'"]+)\3/.exec(part);
                if (!u) return;
                const x = /([\d.]+)x\s*$/.exec(part.trim());
                const d = Math.abs((x ? Number(x[1]) : 1) - want);
                if (!best || d < best.d) best = { d, url: u[2] || u[4] };
            });
            out += css.slice(i, hit.index) + (best ? `url("${best.url}")` : 'none');
            i = j;
        }
        return out + css.slice(i);
    }

    async function inlineUrls(text) {
        const found = new Set();
        text.replace(URL_RE, (all, q, u) => {
            if (!/^(data|blob):/.test(u) && !u.startsWith('#')) found.add(u.replace(/&quot;/g, ''));
            return all;
        });
        const map = new Map();
        await Promise.all(Array.from(found).map(async (u) => { map.set(u, await dataUrl(u)); }));
        return text.replace(URL_RE, (all, q, u) => {
            const d = map.get(u.replace(/&quot;/g, ''));
            // unquoted: it may sit inside a style="..." attribute (a base64 data: URL needs no quotes)
            return d ? `url(${d})` : (d === '' ? 'none' : all);
        });
    }

    const localFonts = new Map();

    /** Whether this computer has the font itself (a FontFace on local() loads only then). */
    function hasLocalFont(name) {
        if (!localFonts.has(name)) {
            let p;
            try {
                p = typeof FontFace === 'function'
                    ? new FontFace(`flip3d-probe-${localFonts.size}`, `local("${name.replace(/"/g, '')}")`).load().then(() => true, () => false)
                    : Promise.resolve(false);
            } catch (_) { p = Promise.resolve(false); }
            localFonts.set(name, p);
        }
        return localFonts.get(name);
    }

    /** A face that names a font this computer has (local("Segoe UI") on Windows) uses that, so
     *  the picture need not carry and unpack the font file (~50 ms a window); otherwise the
     *  file goes in as a data: URL. */
    async function faceSource(face) {
        const src = face.style.getPropertyValue('src');
        const css = absolutize(face.cssText, face.parentStyleSheet && face.parentStyleSheet.href);
        const names = [];
        src.replace(/local\(\s*(['"]?)([^'")]+)\1\s*\)/g, (all, q, n) => { names.push(n); return all; });
        for (const n of names) {
            if (await hasLocalFont(n)) return css.replace(/src:[^;]+;/, `src: local("${n}");`);
        }
        // only the first file (the woff2): the fallbacks would be inlined too
        const srcDecl = /src:([^;]+);/.exec(css);
        const first = srcDecl && /url\(\s*(['"]?)[^'")]+\1\s*\)(\s*format\([^)]*\))?/.exec(srcDecl[1]);
        return first ? css.replace(/src:[^;]+;/, `src: ${first[0]};`) : css;
    }

    /** Light (<= 350), regular, semibold (500-650) or bold: near enough to pick the face. */
    function weightClass(w) {
        const n = w === 'bold' ? 700 : w === 'normal' ? 400 : Number(w) || 400;
        return n <= 350 ? 'l' : n < 500 ? 'n' : n < 650 ? 's' : 'b';
    }

    /** The @font-face rules for the families and weights the window's text uses. */
    function usedFontFaces(win, faces) {
        const known = new Set(faces.map((f) => f.style.getPropertyValue('font-family').replace(/^["']|["']$/g, '').toLowerCase()));
        const buckets = new Set();
        const note = (el, pseudo) => {
            const cs = pseudo && pseudo.fontFamily ? pseudo : root.getComputedStyle(el);
            const fam = cs.fontFamily.split(',').map((f) => f.trim().replace(/^["']|["']$/g, '').toLowerCase()).find((f) => known.has(f));
            if (!fam) return;
            buckets.add(`${fam}|${weightClass(cs.fontWeight)}|${cs.fontStyle === 'normal' ? 'n' : 'i'}`);
        };
        const seen = new Set();
        const tw = doc.createTreeWalker(win, 4);
        while (tw.nextNode()) {
            const el = tw.currentNode.parentElement;
            if (!el || seen.has(el) || !tw.currentNode.nodeValue.trim()) continue;
            seen.add(el);
            note(el);
        }
        win.querySelectorAll('input, textarea, select, button').forEach(note);
        // icon fonts draw in ::before (Font Awesome and the like)
        win.querySelectorAll('i, [class*="fa-"], [class*="icon"]').forEach((el) => {
            const cs = root.getComputedStyle(el, '::before');
            if (cs.content && cs.content !== 'none' && cs.content !== 'normal') note(el, cs);
        });
        return faces.filter((f) => {
            const fam = f.style.getPropertyValue('font-family').replace(/^["']|["']$/g, '').toLowerCase();
            const w = f.style.getPropertyValue('font-weight') || '400';
            const st = f.style.getPropertyValue('font-style') || 'normal';
            return w.split(' ').some((x) => buckets.has(`${fam}|${weightClass(x)}|${st === 'normal' ? 'n' : 'i'}`));
        });
    }

    // ---- window -> picture ---------------------------------------------------------------------

    const INHERITED = ['color', 'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant', 'font-stretch',
        'font-feature-settings', 'font-kerning', 'line-height', 'letter-spacing', 'word-spacing', 'text-align',
        'text-indent', 'text-transform', 'text-shadow', 'text-rendering', 'white-space', 'word-break', 'overflow-wrap',
        'direction', 'cursor', 'list-style', 'color-scheme', '-webkit-font-smoothing', 'tab-size', 'hyphens'];
    const MAX_TEX = 4096;
    // a transparent rim (texels) round every picture: with linear filtering it smooths the
    // cards' edges, so the canvas needs no multisampling
    const RIM = 2;

    /** A canvas for a w x h px picture at `scale`, with the rim; draw at (RIM, RIM). */
    function rimmedCanvas(w, h, scale) {
        const c = doc.createElement('canvas');
        c.width = Math.max(1, Math.round(w * scale)) + 2 * RIM;
        c.height = Math.max(1, Math.round(h * scale)) + 2 * RIM;
        c.flipRim = RIM / scale;
        return c;
    }

    const escAttr = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

    /** The ancestors as bare wrappers (tag, id, classes, data-*) so `body.desktop-mode .x` still
     *  matches; the parent carries the inherited values and every custom property. */
    function wrappers(win) {
        const chain = [];
        for (let a = win.parentElement; a; a = a.parentElement) chain.unshift(a);
        const parent = win.parentElement;
        const cs = parent ? root.getComputedStyle(parent) : null;
        let inherit = '';
        if (cs) {
            INHERITED.forEach((p) => { inherit += `${p}:${cs.getPropertyValue(p)};`; });
            for (let i = 0; i < cs.length; i++) {
                const p = cs[i];
                if (p.startsWith('--')) inherit += `${p}:${cs.getPropertyValue(p)};`;
            }
        }
        const open = chain.map((el) => {
            let attrs = '';
            for (let i = 0; i < el.attributes.length; i++) {
                const at = el.attributes[i];
                // not a name XML takes (`@click`, `:class`), or one that does nothing here
                if (at.name === 'style' || at.name === 'xmlns' || at.name.startsWith('on') || !/^[A-Za-z_][\w.-]*$/.test(at.name)) continue;
                attrs += ` ${at.name}="${escAttr(at.value)}"`;
            }
            if (el === parent) attrs += ` style="${escAttr(inherit)}"`;
            if (el === doc.documentElement) attrs += ' xmlns="http://www.w3.org/1999/xhtml"';
            return `<${el.localName}${attrs}>`;
        });
        const close = chain.slice().reverse().map((el) => `</${el.localName}>`).join('');
        return { open, close, chain };
    }

    function imageDataUrl(img, w, h) {
        const s = Math.min(2, root.devicePixelRatio || 1);
        const cw = Math.max(1, Math.min(2048, Math.round(w * s)));
        const ch = Math.max(1, Math.min(2048, Math.round(h * s)));
        const key = `${img.currentSrc || img.src}|${cw}x${ch}`;
        if (dataUrls.has(key)) return dataUrls.get(key);
        let out = '';
        try {
            const c = doc.createElement('canvas');
            c.width = cw;
            c.height = ch;
            c.getContext('2d').drawImage(img, 0, 0, cw, ch);
            out = c.toDataURL(cw * ch > 64 * 64 ? 'image/webp' : 'image/png', 0.92);
        } catch (_) { out = ''; }
        return remember(key, Promise.resolve(out));
    }

    /** Copies the live state the clone loses (form values, scroll offsets) and swaps what an SVG
     *  picture cannot hold: images become data: URLs, canvases and videos holes drawn later. */
    function prepareClone(win, clone, winRect) {
        const live = [win].concat(Array.from(win.getElementsByTagName('*')));
        const copy = [clone].concat(Array.from(clone.getElementsByTagName('*')));
        const waits = [];
        const overlays = [];
        const holes = [];
        for (let i = 0; i < live.length && i < copy.length; i++) {
            const a = live[i];
            const b = copy[i];
            const tag = a.localName;
            if (tag === 'input') {
                if (a.type === 'checkbox' || a.type === 'radio') {
                    if (a.checked) b.setAttribute('checked', ''); else b.removeAttribute('checked');
                } else if (a.type !== 'file' && a.type !== 'password') b.setAttribute('value', a.value);
                b.removeAttribute('name');
            } else if (tag === 'textarea') {
                b.textContent = a.value;
                b.removeAttribute('name');
            } else if (tag === 'select') {
                Array.from(b.options).forEach((o, k) => { if (a.options[k] && a.options[k].selected) o.setAttribute('selected', ''); else o.removeAttribute('selected'); });
            } else if (tag === 'img') {
                b.removeAttribute('srcset');
                b.removeAttribute('loading');
                b.setAttribute('alt', '');
                const r = a.getBoundingClientRect();
                // a minimised window's images have no size: their own, up to 256 px
                const fit = Math.min(1, 256 / Math.max(a.naturalWidth || 1, a.naturalHeight || 1));
                const w = r.width || a.naturalWidth * fit;
                const h = r.height || a.naturalHeight * fit;
                if (a.complete && a.naturalWidth && w && h) {
                    waits.push(imageDataUrl(a, w, h).then((d) => { if (d) b.setAttribute('src', d); else b.removeAttribute('src'); }));
                } else b.removeAttribute('src');
            } else if (tag === 'canvas' || tag === 'video' || tag === 'iframe') {
                const r = a.getBoundingClientRect();
                if (r.width && r.height) overlays.push({ el: a, tag, rect: { x: r.left - winRect.left, y: r.top - winRect.top, w: r.width, h: r.height }, clip: clipRect(a, win, winRect) });
                holes.push({ b, tag, w: r.width, h: r.height });
            }
            if (a.scrollTop || a.scrollLeft) {
                // the clone cannot scroll: its children move up by the offset instead
                const dx = -a.scrollLeft;
                const dy = -a.scrollTop;
                Array.from(b.children).forEach((ch) => {
                    ch.style.setProperty('translate', `${dx}px ${dy}px`, 'important');
                });
            }
        }
        // a hole the size of the canvas / video keeps the layout; an iframe's is white
        holes.forEach(({ b, tag, w, h }) => {
            const hole = doc.createElement('div');
            if (b.getAttribute('class')) hole.setAttribute('class', b.getAttribute('class'));
            hole.setAttribute('style', `${b.getAttribute('style') || ''};display:inline-block;width:${w}px;height:${h}px;${tag === 'iframe' ? 'background:#fff;' : ''}`);
            b.replaceWith(hole);
        });
        clone.querySelectorAll('script, link, audio, noscript, template').forEach((el) => el.remove());
        return { waits, overlays };
    }

    /** The visible part of `el` inside its scrolling / clipping ancestors, window coordinates. */
    function clipRect(el, win, winRect) {
        let x0 = 0, y0 = 0, x1 = winRect.width, y1 = winRect.height;
        for (let a = el.parentElement; a && a !== win.parentElement; a = a.parentElement) {
            const cs = root.getComputedStyle(a);
            if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
            const r = a.getBoundingClientRect();
            x0 = Math.max(x0, r.left - winRect.left);
            y0 = Math.max(y0, r.top - winRect.top);
            x1 = Math.min(x1, r.right - winRect.left);
            y1 = Math.min(y1, r.bottom - winRect.top);
        }
        return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
    }

    /** Gives the page a turn (input, a frame) between the steps of a copy. */
    function yieldTask() {
        if (root.scheduler && typeof root.scheduler.yield === 'function') return root.scheduler.yield();
        return new Promise((resolve) => setTimeout(resolve, 0));
    }

    function loadImage(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.decoding = 'async';
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('flip3d: the window picture did not load'));
            img.src = src;
        });
    }

    /** The window's size as laid out (a minimised window keeps its last size in its style). */
    function windowRect(win) {
        const r = win.getBoundingClientRect();
        if (!win.classList.contains('minimised') && r.width && r.height) return r;
        const w = parseFloat(win.style.width) || win.offsetWidth || 640;
        const h = parseFloat(win.style.height) || win.offsetHeight || 480;
        const left = parseFloat(win.style.left) || 0;
        const top = parseFloat(win.style.top) || 0;
        return { left, top, width: w, height: h, right: left + w, bottom: top + h };
    }

    /** The window as a picture: { base (a canvas, with the rim), overlays, w, h, scale }. */
    async function rasterize(win) {
        const rect = windowRect(win);
        const W = Math.max(1, Math.round(rect.width));
        const H = Math.max(1, Math.round(rect.height));
        // window.__flip3dDebug = {} collects each step's time and the last SVG (profiling)
        const dbg = root.__flip3dDebug;
        // debug: each step's own time (the waits between them left out)
        let ts = performance.now();
        const lap = dbg ? (k) => { const now = performance.now(); dbg[k] = Math.round(now - ts); ts = now; } : () => {};
        const resume = () => { ts = performance.now(); };
        const idx = rules();
        lap('index');
        const css = await matchingRules(win);
        lap('match');
        await yieldTask();
        resume();
        const faces = await Promise.all(usedFontFaces(win, idx.faces).map(faceSource));
        lap('fonts');
        const clone = win.cloneNode(true);
        clone.classList.remove('minimised', 'minimising', 'entering', 'leaving', 'flip3d-hidden');
        clone.setAttribute('aria-hidden', 'true');
        const fixed = {
            position: 'absolute', inset: 'auto', left: '0px', top: '0px', right: 'auto', bottom: 'auto', margin: '0px',
            width: `${W}px`, height: `${H}px`, 'min-width': '0px', 'min-height': '0px', 'max-width': 'none', 'max-height': 'none',
            transform: 'none', translate: 'none', scale: 'none', rotate: 'none', zoom: '1', animation: 'none', transition: 'none',
            opacity: '1', visibility: 'visible'
        };
        Object.keys(fixed).forEach((p) => clone.style.setProperty(p, fixed[p], 'important'));
        const { waits, overlays } = prepareClone(win, clone, rect);
        lap('clone');
        await Promise.all(waits);
        await yieldTask();
        resume();
        const wrap = wrappers(win);
        let body = new XMLSerializer().serializeToString(clone);
        let styleText = idx.extra.concat(faces, css).join('\n');
        styleText = flattenImageSets(styleText);
        body = flattenImageSets(body);
        const inlined = Promise.all([inlineUrls(styleText), inlineUrls(body)]);
        lap('serialize');
        [styleText, body] = await inlined;
        await yieldTask();
        resume();
        const sizing = `html,body{margin:0!important;padding:0!important;border:0!important;width:${W}px!important;height:${H}px!important;min-width:0!important;min-height:0!important;overflow:hidden!important;background:transparent!important}*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}`;
        const head = `<head><style>${(styleText + '\n' + sizing).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</style></head>`;
        // the rules go in a <head> in front of the copied <body>
        const open = wrap.open.map((t, i) => (wrap.chain[i].localName === 'body' ? head + t : t)).join('');
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><foreignObject x="0" y="0" width="${W}" height="${H}">${open}${body}${wrap.close}</foreignObject></svg>`;
        if (dbg) dbg.svg = svg;
        // only what a data: URL cannot carry raw (a whole-string encodeURIComponent costs ~20 ms)
        const src = `data:image/svg+xml;charset=utf-8,${svg.replace(/[%#\r\n]/g, encodeURIComponent)}`;
        lap('encode');
        const img = await loadImage(src);
        lap('load');
        await yieldTask();
        resume();
        const scale = Math.min(Math.min(1.5, root.devicePixelRatio || 1), MAX_TEX / W, MAX_TEX / H);
        const base = rimmedCanvas(W, H, scale);
        base.getContext('2d').drawImage(img, RIM, RIM, base.width - 2 * RIM, base.height - 2 * RIM);
        lap('draw');
        return { base, overlays, w: W, h: H, scale };
    }

    /** The picture with the live canvases and videos drawn in (a fresh canvas when it has any). */
    function composite(pic) {
        if (!pic.overlays.length) return pic.base;
        const c = rimmedCanvas(pic.w, pic.h, pic.scale);
        const g = c.getContext('2d');
        g.drawImage(pic.base, 0, 0);
        g.translate(RIM, RIM);
        g.scale(pic.scale, pic.scale);
        pic.overlays.forEach((o) => {
            if (!o.el.isConnected || o.tag === 'iframe') return;
            g.save();
            g.beginPath();
            g.rect(o.clip.x, o.clip.y, o.clip.w, o.clip.h);
            g.clip();
            try { g.drawImage(o.el, o.rect.x, o.rect.y, o.rect.w, o.rect.h); } catch (_) { /* tainted or not ready */ }
            g.restore();
        });
        return c;
    }

    /** Vista's card for a window it has no picture of yet: the frame colour, a white client
     *  area and the program's icon in the middle. */
    function placeholder(win, w, h) {
        const s = Math.min(1, 512 / Math.max(w, h));
        const c = rimmedCanvas(w, h, s);
        const g = c.getContext('2d');
        g.translate(RIM, RIM);
        const cw = c.width - 2 * RIM;
        const chh = c.height - 2 * RIM;
        const grad = g.createLinearGradient(0, 0, 0, chh);
        grad.addColorStop(0, 'rgba(180, 205, 230, 0.92)');
        grad.addColorStop(1, 'rgba(140, 170, 200, 0.92)');
        g.fillStyle = grad;
        g.fillRect(0, 0, cw, chh);
        const b = Math.max(2, Math.round(8 * s));
        const top = Math.max(b, Math.round(30 * s));
        const white = g.createLinearGradient(0, top, 0, chh);
        white.addColorStop(0, '#ffffff');
        white.addColorStop(1, '#e8edf3');
        g.fillStyle = white;
        g.fillRect(b, top, cw - 2 * b, chh - top - b);
        const icon = win && win.querySelector('.modal-window-title img');
        if (icon && icon.complete && icon.naturalWidth) {
            const px = Math.round(48 * s);
            try { g.drawImage(icon, (cw - px) / 2, (chh + top - px) / 2, px, px); } catch (_) { /* tainted */ }
        }
        return c;
    }

    // ---- the cache of window pictures ----------------------------------------------------------

    const pictures = new Map(); // modal -> { pic, dirty, observer, w, h, busy, used }
    const PICTURE_BUDGET = 16 * 1024 * 1024; // pixels kept between Flip 3Ds (~64 MB)

    /** Drops the least recently shown pictures past the budget (they are copied again when
     *  next needed); the ones on screen now stay. */
    function trimPictures() {
        let total = 0;
        pictures.forEach((e) => { if (e.pic) total += e.pic.base.width * e.pic.base.height; });
        if (total <= PICTURE_BUDGET) return;
        const onScreen = new Set(state ? state.cards.map((c) => c.win) : []);
        const old = Array.from(pictures.entries()).filter(([w, e]) => e.pic && !onScreen.has(w)).sort((a, b) => a[1].used - b[1].used);
        for (const [win, e] of old) {
            if (total <= PICTURE_BUDGET) break;
            total -= e.pic.base.width * e.pic.base.height;
            if (e.observer) e.observer.disconnect();
            pictures.delete(win);
        }
    }

    function watch(win, entry) {
        if (entry.observer) entry.observer.disconnect();
        const outside = (c) => c && c !== 'flip3d-hidden';
        const classes = (list) => list.filter(outside).sort().join(' ');
        const mark = (records) => {
            // the window's own style (moves, z-order) and Flip 3D's hiding class do not change
            // the picture; a new size is caught by fresh()
            if (Array.isArray(records) && records.every((r) => r.target === win && r.type === 'attributes' &&
                (r.attributeName === 'style' || (r.attributeName === 'class' && classes((r.oldValue || '').split(/\s+/)) === classes(Array.from(win.classList)))))) return;
            entry.dirty = true;
            if (entry.observer) entry.observer.disconnect();
            entry.observer = null;
            win.removeEventListener('scroll', mark, true);
            win.removeEventListener('input', mark, true);
            win.removeEventListener('load', mark, true);
        };
        entry.observer = new MutationObserver(mark);
        entry.observer.observe(win, { subtree: true, childList: true, attributes: true, attributeOldValue: true, characterData: true });
        win.addEventListener('scroll', mark, true);
        win.addEventListener('input', mark, true);
        win.addEventListener('load', mark, true);
    }

    function fresh(win) {
        const e = pictures.get(win);
        if (!e || !e.pic) return false;
        // minimised, it keeps the picture it had while it was up
        if (win.classList.contains('minimised')) return true;
        if (e.dirty) return false;
        const r = windowRect(win);
        return Math.round(r.width) === e.w && Math.round(r.height) === e.h;
    }

    /** The window's picture, made again only when it changed since the last one. */
    function capture(win) {
        let e = pictures.get(win);
        if (!e) pictures.set(win, (e = { pic: null, dirty: true, observer: null, w: 0, h: 0, busy: null, used: 0 }));
        if (fresh(win)) return Promise.resolve(e.pic);
        if (e.busy) return e.busy;
        // mark it clean before copying: a change while it is being copied makes it dirty again
        e.dirty = false;
        watch(win, e);
        e.busy = rasterize(win).then((pic) => {
            e.pic = pic;
            e.w = pic.w;
            e.h = pic.h;
            e.used = performance.now();
            e.busy = null;
            trimPictures();
            return pic;
        }).catch((err) => {
            e.busy = null;
            e.dirty = true;
            console.warn('Flip 3D: could not draw a window', win.id, err && err.message);
            return null;
        });
        return e.busy;
    }

    function forgetClosed() {
        pictures.forEach((e, win) => {
            if (win.isConnected && isWindow(win)) return;
            if (e.observer) e.observer.disconnect();
            pictures.delete(win);
        });
    }

    let prewarmQueue = [];
    let prewarmTimer = 0;

    /** Copies the windows that changed, one per idle moment (the Windows key went down, or the
     *  pointer rests on Quick Launch's Switch between windows). */
    function prewarm() {
        if (!doc || state) return;
        prewarmQueue = windowOrder().filter((w) => !fresh(w));
        const next = () => {
            prewarmTimer = 0;
            const w = prewarmQueue.shift();
            if (!w || state) return;
            capture(w).then(() => {
                if (prewarmQueue.length && !state) schedule();
            });
        };
        const schedule = () => {
            if (prewarmTimer) return;
            prewarmTimer = root.requestIdleCallback ? root.requestIdleCallback(next, { timeout: 300 }) : setTimeout(next, 30);
        };
        schedule();
    }

    // ---- WebGL ---------------------------------------------------------------------------------

    let gl = null;
    let glCanvas = null;
    let glProgram = null;
    let glBuffer = null;
    let glLoc = null;
    let glBroken = false;
    let anisotropy = null;

    const VS = `
attribute vec4 aPos;
attribute vec2 aUv;
varying vec2 vUv;
void main() { vUv = aUv; gl_Position = aPos; }`;
    const FS = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform float uAlpha;
void main() { gl_FragColor = texture2D(uTex, vUv) * uAlpha; }`;

    function compile(type, src) {
        const sh = gl.createShader(type);
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
        return sh;
    }

    function ensureGl() {
        if (gl) return !gl.isContextLost();
        if (glBroken || !doc) return false;
        glCanvas = doc.createElement('canvas');
        glCanvas.className = 'flip3d-canvas';
        const opts = { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'high-performance' };
        try {
            gl = glCanvas.getContext('webgl2', opts) || glCanvas.getContext('webgl', opts);
        } catch (_) { gl = null; }
        if (!gl) {
            glBroken = true;
            return false;
        }
        try {
            glProgram = gl.createProgram();
            gl.attachShader(glProgram, compile(gl.VERTEX_SHADER, VS));
            gl.attachShader(glProgram, compile(gl.FRAGMENT_SHADER, FS));
            gl.linkProgram(glProgram);
            if (!gl.getProgramParameter(glProgram, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(glProgram));
        } catch (err) {
            console.warn('Flip 3D: WebGL program', err && err.message);
            gl = null;
            glBroken = true;
            return false;
        }
        glLoc = {
            pos: gl.getAttribLocation(glProgram, 'aPos'),
            uv: gl.getAttribLocation(glProgram, 'aUv'),
            tex: gl.getUniformLocation(glProgram, 'uTex'),
            alpha: gl.getUniformLocation(glProgram, 'uAlpha')
        };
        glBuffer = gl.createBuffer();
        anisotropy = gl.getExtension('EXT_texture_filter_anisotropic');
        glCanvas.addEventListener('webglcontextlost', (ev) => {
            ev.preventDefault();
            textures.clear();
            if (state) close(null, true);
        });
        glCanvas.addEventListener('webglcontextrestored', () => {
            gl = null;
            glCanvas.remove();
            glCanvas = null;
        });
        return true;
    }

    const textures = new Map(); // source canvas -> WebGLTexture

    function uploadTexture(source) {
        let tex = textures.get(source);
        if (tex) return tex;
        tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        const pot = (n) => (n & (n - 1)) === 0;
        const mips = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext || (pot(source.width) && pot(source.height));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        if (mips) {
            gl.generateMipmap(gl.TEXTURE_2D);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        } else gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        if (anisotropy) gl.texParameterf(gl.TEXTURE_2D, anisotropy.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(4, gl.getParameter(anisotropy.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
        textures.set(source, tex);
        return tex;
    }

    function dropTexture(source) {
        const tex = source && textures.get(source);
        if (!tex) return;
        if (gl) gl.deleteTexture(tex);
        textures.delete(source);
    }

    const verts = new Float32Array(4 * 6);

    function drawCard(cam, vw, vh, tex, pose, w, h, alpha, rim) {
        const c = corners(pose, w, h, rim || 0);
        const uv = [[0, 0], [1, 0], [0, 1], [1, 1]];
        for (let i = 0; i < 4; i++) {
            const [x, y, z] = c[i];
            if (z <= 1) return;
            // clip-space with w = z, so the texture is perspective-correct
            verts[i * 6] = ((cam.cx / vw) * 2 - 1) * z + (2 * cam.f / vw) * x;
            verts[i * 6 + 1] = -(((cam.cy / vh) * 2 - 1) * z + (2 * cam.f / vh) * y);
            verts[i * 6 + 2] = 0;
            verts[i * 6 + 3] = z;
            verts[i * 6 + 4] = uv[i][0];
            verts[i * 6 + 5] = uv[i][1];
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, glBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(glLoc.pos);
        gl.vertexAttribPointer(glLoc.pos, 4, gl.FLOAT, false, 24, 0);
        gl.enableVertexAttribArray(glLoc.uv);
        gl.vertexAttribPointer(glLoc.uv, 2, gl.FLOAT, false, 24, 16);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.uniform1i(glLoc.tex, 0);
        gl.uniform1f(glLoc.alpha, alpha);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    // ---- the desktop card ----------------------------------------------------------------------

    let desktopTex = { key: '', canvas: null };

    /** The wallpaper as Vista's desktop card (the screen's shape, a quarter of its pixels). */
    function desktopSource(vw, vh) {
        const cs = root.getComputedStyle(doc.documentElement);
        const m = /url\(\s*(['"]?)([^'")]+)\1\s*\)/.exec(cs.getPropertyValue('--desktop-wallpaper') || '');
        const bg = root.getComputedStyle(doc.body).backgroundColor || '#3a6ea5';
        const key = `${m ? m[2] : ''}|${vw}x${vh}|${bg}`;
        if (desktopTex.key === key && desktopTex.canvas) return Promise.resolve(desktopTex.canvas);
        const c = rimmedCanvas(vw, vh, 0.5);
        const g = c.getContext('2d');
        g.translate(RIM, RIM);
        const cw = c.width - 2 * RIM;
        const chh = c.height - 2 * RIM;
        g.fillStyle = bg && bg !== 'rgba(0, 0, 0, 0)' ? bg : '#3a6ea5';
        g.fillRect(0, 0, cw, chh);
        const done = () => {
            dropTexture(desktopTex.canvas);
            desktopTex = { key, canvas: c };
            return c;
        };
        if (!m) return Promise.resolve(done());
        return loadImage(m[2]).then((img) => {
            const s = Math.max(cw / img.naturalWidth, chh / img.naturalHeight);
            const w = img.naturalWidth * s, h = img.naturalHeight * s;
            g.save();
            g.beginPath();
            g.rect(0, 0, cw, chh);
            g.clip();
            g.drawImage(img, (cw - w) / 2, (chh - h) / 2, w, h);
            g.restore();
            return done();
        }).catch(done);
    }

    // ---- the session ---------------------------------------------------------------------------

    let state = null;

    function isOpen() {
        return !!state;
    }

    function viewport() {
        return { vw: root.innerWidth, vh: root.innerHeight };
    }

    function frame() {
        if (!state || !gl) return;
        const s = state;
        // nothing to show before the overlay is up (start())
        if (!s.started) {
            s.raf = 0;
            return;
        }
        const now = performance.now();
        const { vw, vh } = s;
        // rotation: eased from where it was to the target
        if (s.rot.to !== s.rot.from) {
            const t = Math.min(1, (now - s.rot.t0) / ANIM_MS);
            s.r = s.rot.from + (s.rot.to - s.rot.from) * ease(t);
            if (t >= 1) {
                s.r = s.rot.to;
                s.rot.from = s.rot.to;
            }
        }
        // open / close: u 0 = flat where the windows are, 1 = the stack
        // s.freeze (tests, screenshots): hold the open / close at that point
        const ut = s.freeze != null ? s.freeze : Math.max(0, Math.min(1, (now - s.phase.t0) / ANIM_MS));
        const u = s.phase.dir > 0 ? ease(ut) : 1 - ease(ut);
        s.u = u;
        if (s.dimEl) s.dimEl.style.opacity = String((s.phase.dir > 0 ? ut : 1 - ut));
        const cam = s.cam;
        gl.viewport(0, 0, glCanvas.width, glCanvas.height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(glProgram);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        const n = s.cards.length;
        const draws = [];
        s.cards.forEach((card, i) => {
            cardSlots(i, s.r, n).forEach(([slot, a]) => {
                if (slot > MAX_SLOTS) return;
                draws.push({ card, slot, a });
            });
        });
        // back to front
        draws.sort((p, q) => q.slot - p.slot);
        draws.forEach(({ card, slot, a }) => {
            const stack = slotPose(cam, slot);
            let pose;
            let alpha;
            if (card.flat) {
                pose = lerpPose(card.flat, stack, u);
                alpha = 1 + (a - 1) * u;
            } else {
                pose = stack;
                alpha = a * u;
            }
            if (alpha <= 0.001) return;
            const src = card.source;
            if (!src) return;
            drawCard(cam, vw, vh, uploadTexture(src), pose, card.w, card.h, alpha, src.flipRim);
        });
        // the first frame uploads the textures (slow on a weak GPU, and the cost lands when it
        // is shown): the flight's clock starts at the frame after, so the open is never half
        // over before it is seen
        if (s.primeFrames > 0 && s.phase.dir > 0) {
            s.primeFrames -= 1;
            if (!s.primeFrames) s.phase.t0 = performance.now();
            s.raf = root.requestAnimationFrame(frame);
            return;
        }
        const moving = s.freeze == null && (s.rot.to !== s.rot.from || ut < 1);
        if (!moving && s.phase.dir < 0) {
            finish();
            return;
        }
        s.raf = moving ? root.requestAnimationFrame(frame) : 0;
    }

    function redraw() {
        if (state && !state.raf) state.raf = root.requestAnimationFrame(frame);
    }

    function setSource(card, source) {
        if (card.source && card.source !== source && card.ownsSource) dropTexture(card.source);
        card.source = source;
        card.ownsSource = true;
        redraw();
    }

    /**
     * Opens Flip 3D. mode 'hold' (Win+Tab: the Windows key's release switches) or 'sticky'.
     * Returns false when WebGL is not there (the caller falls back to the window switcher).
     */
    function open(mode, opts = {}) {
        if (state) return true;
        if (!doc || !ensureGl()) return false;
        forgetClosed();
        const wins = windowOrder();
        const { vw, vh } = viewport();
        const cam = camera(vw, vh);
        // the backing store: the screen's density, at most ~2.25 x a 1920x1200 screen's pixels
        const dpr = Math.min(root.devicePixelRatio || 1, Math.sqrt((1920 * 1200 * 2.25) / (vw * vh)));
        glCanvas.width = Math.round(vw * dpr);
        glCanvas.height = Math.round(vh * dpr);
        const cards = wins.map((win) => {
            const rect = windowRect(win);
            const minimised = win.classList.contains('minimised');
            const e = pictures.get(win);
            if (e) e.used = performance.now();
            const card = {
                win,
                w: Math.max(1, Math.round(rect.width)),
                h: Math.max(1, Math.round(rect.height)),
                flat: minimised ? null : flatPose(cam, rect),
                source: null,
                ownsSource: false
            };
            card.source = e && e.pic ? composite(e.pic) : placeholder(win, card.w, card.h);
            card.ownsSource = !(e && e.pic && card.source === e.pic.base);
            return card;
        });
        const desk = { win: null, w: vw, h: vh, flat: null, source: null, ownsSource: false, desktop: true };
        cards.push(desk);
        state = {
            mode: mode === 'hold' ? 'hold' : 'sticky',
            holdKey: opts.holdKey || 'Meta',
            cards,
            cam,
            vw,
            vh,
            r: 0,
            rot: { from: 0, to: 0, t0: 0 },
            u: 0,
            phase: { dir: 1, t0: performance.now() },
            raf: 0,
            dimEl: null,
            hidden: [],
            started: false
        };
        const s = state;
        // windows never copied yet: up to ~150 ms before the stack shows (Vista takes about
        // that long too); one that changed since its last copy flies as it was and is copied
        // again once the stack stands still
        const missing = cards.filter((c) => c.win && !(pictures.get(c.win) || {}).pic);
        const t0 = performance.now();
        const first = async () => {
            for (const card of missing) {
                if (state !== s || performance.now() - t0 > 150) return;
                const pic = await capture(card.win);
                if (state === s && pic) setSource(card, composite(pic));
            }
        };
        const desktopReady = desktopSource(vw, vh).then((c) => {
            if (state !== s) return;
            desk.source = c;
            redraw();
        });
        const wallpaperWait = Promise.race([desktopReady, new Promise((r) => setTimeout(r, 300))]);
        Promise.all([missing.length ? first() : null, wallpaperWait]).then(() => {
            start(s);
            refresh(s);
        });
        listen(true);
        return true;
    }

    /** The overlay goes up and the windows fly. */
    function start(s) {
        if (state !== s || s.started) return;
        s.started = true;
        const host = doc.body;
        s.dimEl = doc.createElement('div');
        s.dimEl.className = 'flip3d-dim';
        s.dimEl.style.background = `rgba(0, 0, 0, ${DIM})`;
        s.dimEl.style.opacity = '0';
        host.appendChild(s.dimEl);
        host.appendChild(glCanvas);
        glCanvas.classList.add('is-open');
        s.cards.forEach((c) => {
            if (!c.win) return;
            if (c.win.style.visibility !== 'hidden') {
                c.win.classList.add('flip3d-hidden');
                s.hidden.push(c.win);
            }
        });
        // u = 0 until the first frame is drawn (frame() starts the clock then)
        s.phase = { dir: 1, t0: Infinity };
        s.primeFrames = 2;
        redraw();
    }

    function animating(s) {
        return s.rot.to !== s.rot.from || performance.now() - s.phase.t0 < ANIM_MS;
    }

    /** Resolves when nothing moves and the page has a moment (never copies mid-flight). */
    function still(s) {
        return new Promise((resolve) => {
            const check = () => {
                if (state !== s || s.phase.dir < 0) return resolve(false);
                if (!s.started || animating(s)) return setTimeout(check, 50);
                if (root.requestIdleCallback) root.requestIdleCallback(() => resolve(state === s && !animating(s)), { timeout: 200 });
                else setTimeout(() => resolve(state === s && !animating(s)), 16);
            };
            check();
        });
    }

    /** Copies the windows that changed (front first), between moves. */
    async function refresh(s) {
        for (const card of s.cards) {
            if (!card.win || fresh(card.win)) continue;
            for (;;) {
                if (!(await still(s))) {
                    if (state !== s || s.phase.dir < 0) return;
                    continue;
                }
                break;
            }
            const pic = await capture(card.win);
            if (state === s && pic) setSource(card, composite(pic));
        }
    }

    function step(dir) {
        const s = state;
        if (!s || s.phase.dir < 0 || s.cards.length < 2) return;
        s.rot.from = s.r;
        s.rot.to += dir;
        s.rot.t0 = performance.now();
        redraw();
    }

    function frontIndex() {
        const s = state;
        const n = s.cards.length;
        return ((Math.round(s.rot.to) % n) + n) % n;
    }

    /** Puts the stack away: `pick` is the card switched to (null: back to the window in front). */
    function close(pick, instant) {
        const s = state;
        if (!s || s.phase.dir < 0) return;
        s.pick = pick === undefined ? null : pick;
        listen(false);
        if (instant || !s.started) {
            s.phase = { dir: -1, t0: -Infinity };
            finish();
            return;
        }
        // the closing flight starts from where the opening one is
        const done = s.u;
        s.phase = { dir: -1, t0: performance.now() - (1 - done) * ANIM_MS };
        redraw();
    }

    function finish() {
        const s = state;
        if (!s) return;
        state = null;
        if (s.raf) root.cancelAnimationFrame(s.raf);
        s.hidden.forEach((w) => w.classList.remove('flip3d-hidden'));
        if (s.dimEl) s.dimEl.remove();
        if (glCanvas) {
            glCanvas.classList.remove('is-open');
            glCanvas.remove();
        }
        s.cards.forEach((c) => { if (c.ownsSource) dropTexture(c.source); });
        // pictures kept for next time stay in GPU memory only while open
        textures.forEach((tex, src) => { if (src !== desktopTex.canvas) { gl.deleteTexture(tex); textures.delete(src); } });
        const card = s.pick != null ? s.cards[s.pick] : null;
        if (card) activate(card);
    }

    function activate(card) {
        if (card.desktop) {
            // Vista: picking the desktop shows it (every window minimised)
            const anyUp = anyWindowUp();
            if (anyUp && root.taskbarSettings) root.taskbarSettings.toggleShowDesktop();
            return;
        }
        const m = card.win;
        if (!m || !m.isConnected) return;
        // restoreMinimizedModal / getOrCreateTaskbarItem / openModal: public/scripts/comp/modalUtils.js
        if (m.classList.contains('minimised') && typeof root.restoreMinimizedModal === 'function') {
            root.restoreMinimizedModal(m, typeof root.getOrCreateTaskbarItem === 'function' ? root.getOrCreateTaskbarItem(m) : null);
        }
        if (typeof root.openModal === 'function') root.openModal(m);
    }

    function anyWindowUp() {
        return windowOrder().some((m) => !m.classList.contains('minimised'));
    }

    /** The card under a screen point, front first (null: none). */
    function cardAt(x, y) {
        const s = state;
        if (!s) return null;
        const n = s.cards.length;
        const hits = [];
        s.cards.forEach((card, i) => {
            cardSlots(i, s.r, n).forEach(([slot, a]) => {
                if (a < 0.5 || slot < 0) return;
                const c = corners(slotPose(s.cam, slot), card.w, card.h).map((p) => project(s.cam, p));
                // TL, TR, BR, BL
                if (insideQuad([c[0], c[1], c[3], c[2]], x, y)) hits.push({ i, slot });
            });
        });
        hits.sort((p, q) => p.slot - q.slot);
        return hits.length ? hits[0].i : null;
    }

    function insideQuad(q, x, y) {
        let sign = 0;
        for (let i = 0; i < 4; i++) {
            const [ax, ay] = q[i];
            const [bx, by] = q[(i + 1) % 4];
            const cr = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
            if (cr === 0) continue;
            const sg = cr > 0 ? 1 : -1;
            if (!sign) sign = sg;
            else if (sg !== sign) return false;
        }
        return true;
    }

    // ---- input ---------------------------------------------------------------------------------

    function onKeyDown(ev) {
        const s = state;
        if (!s) return;
        const k = ev.key;
        // every key stays with Flip 3D: nothing types into the windows behind it
        ev.preventDefault();
        ev.stopImmediatePropagation();
        if (k === 'Tab') step(ev.shiftKey ? -1 : 1);
        else if (k === 'ArrowRight' || k === 'ArrowDown') step(1);
        else if (k === 'ArrowLeft' || k === 'ArrowUp') step(-1);
        else if ((k === 'Enter' || k === ' ') && !ev.repeat) close(frontIndex());
        else if (k === 'Escape') close(0);
    }

    function onKeyUp(ev) {
        const s = state;
        if (!s) return;
        if (s.mode === 'hold' && ev.key === s.holdKey) close(frontIndex());
        ev.preventDefault();
        ev.stopImmediatePropagation();
    }

    let wheelAcc = 0;

    function onWheel(ev) {
        if (!state) return;
        ev.preventDefault();
        ev.stopImmediatePropagation();
        wheelAcc += ev.deltaY;
        const notch = ev.deltaMode === 1 ? 3 : 100;
        while (Math.abs(wheelAcc) >= notch) {
            step(wheelAcc > 0 ? 1 : -1);
            wheelAcc -= Math.sign(wheelAcc) * notch;
        }
    }

    function onPointerDown(ev) {
        if (!state) return;
        ev.preventDefault();
        ev.stopImmediatePropagation();
        if (ev.button !== 0) return;
        const i = cardAt(ev.clientX, ev.clientY);
        close(i == null ? 0 : i);
    }

    function swallow(ev) {
        if (!state) return;
        ev.preventDefault();
        ev.stopImmediatePropagation();
    }

    function onBlur() {
        if (state) close(0, true);
    }

    function listen(on) {
        const fn = on ? 'addEventListener' : 'removeEventListener';
        root[fn]('keydown', onKeyDown, true);
        root[fn]('keyup', onKeyUp, true);
        root[fn]('wheel', onWheel, { capture: true, passive: false });
        root[fn]('pointerdown', onPointerDown, true);
        root[fn]('click', swallow, true);
        root[fn]('contextmenu', swallow, true);
        root[fn]('blur', onBlur);
        wheelAcc = 0;
    }

    const api = {
        open,
        isOpen,
        step,
        prewarm,
        select: () => { if (state) close(frontIndex()); },
        cancel: () => { if (state) close(0); },
        supported: () => ensureGl(),
        _test: { redraw, STACK, splitSelectors, stateOnly, absolutize, weightClass, camera, slotPose, flatPose, corners, project, cardSlots, ease, testSelector, rightmostKey, flattenImageSets, insideQuad, windowOrder, matchingRules, rasterize, capture, pictures, state: () => state }
    };
    root.flip3d = api;
    // the rule index (~0.3 s once) while the page is idle, before the first Flip 3D needs it
    if (doc && root.requestIdleCallback) root.requestIdleCallback(() => { if (!ruleIndex && !state) rules(); }, { timeout: 3000 });
})(typeof window !== 'undefined' ? window : globalThis);
