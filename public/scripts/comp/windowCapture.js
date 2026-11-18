/**
 * Window pictures: a desktop window (a .modal, modalUtils.js) drawn into a canvas, for Flip 3D
 * (flip3d.js) and the taskbar's window previews (taskbarSettings.js). A lazy feature
 * ("window_capture", featureLoader.js).
 *
 *   windowCapture.capture(win)      Promise of its picture { base, overlays, w, h, scale }: made
 *                                   again only when the window changed since the last one
 *   windowCapture.cached(win)       the last picture at once (null: none yet), stale or not
 *   windowCapture.fresh(win)        whether the last picture still shows the window as it is
 *   windowCapture.composite(pic)    the canvas to draw: the picture with the live canvases and
 *                                   videos drawn in (the base itself when it has none)
 *   windowCapture.placeholder(...)  Vista's card for a window with no picture yet
 *   windowCapture.prewarm(list, stop)  copies the changed ones in idle moments
 *   windowCapture.hold(wins, on)    keeps on-screen windows' pictures through memory trimming
 *
 * How: the window's DOM copied into an SVG foreignObject with the CSS rules that match it (an
 * index of the page's rules by id / class / tag), its images, fonts and CSS art inlined as data:
 * URLs (a data: URL SVG does not taint the canvas; a blob: one does), drawn into a canvas with a
 * 2-texel transparent rim; canvases and videos are drawn on top from the live elements. A
 * picture is kept while its window does not change (a MutationObserver marks it dirty; moves,
 * z-order and Flip 3D's hiding do not count), and a minimised window keeps the one it had while
 * it was up. A copy yields to the page between its steps (~80-200 ms in all for a changed
 * window, mostly the SVG load); pictures past ~16 Mpx are dropped least recently used first.
 */
(function (root) {
    'use strict';
    const appScopeSignal = (root && root.melatonSegments && typeof root.melatonSegments.callerSignal === 'function' && root.melatonSegments.callerSignal()) || undefined; // page listeners end with this file's segment (app-scope, #872/#890)

    const doc = typeof document !== 'undefined' ? document : null;

    /** An open desktop window (not hidden or closing, with a caption). */
    function isWindow(m) {
        return !!m && m.classList && m.classList.contains('modal') && !m.classList.contains('hidden') &&
            !m.classList.contains('hidden-alt') && !m.classList.contains('closing') && !!m.querySelector('.modal-window-title');
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
        noteUse();
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
        // the page's own files, and the Android app's (appassets.androidplatform.net: the phone's wallpaper as
        // Today shows it, served by the app to the page; a fetch reads it)
        if (abs.origin !== root.location.origin && abs.hostname !== 'appassets.androidplatform.net' && abs.protocol !== 'blob:') return Promise.resolve('');
        const shrink = !exact;
        const key = abs.href + (shrink ? '' : '#full');
        if (!dataUrls.has(key)) {
            // a fetch that never answers (a page behind another program, a stalled request) gives up after 4 s
            const ctl = typeof AbortController === 'function' ? new AbortController() : null;
            const stop = ctl ? setTimeout(() => ctl.abort(), 4000) : 0;
            remember(key, fetch(key, { credentials: 'same-origin', signal: ctl ? ctl.signal : undefined }).then((res) => (res.ok ? res.blob() : null)).finally(() => clearTimeout(stop)).then(async (blob) => {
                if (!blob) return '';
                if (shrink && blob.size > BIG_IMAGE && /^image\//.test(blob.type) && !/svg/.test(blob.type) && typeof createImageBitmap === 'function') {
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
        // an exact snapshot (snapshot()) takes what the browser itself shows: the smallest
        // candidate at or above the screen's density, else the largest
        const dpr = exact ? exact.scale : 0;
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
                const r = x ? Number(x[1]) : 1;
                const d = dpr ? (r >= dpr - 0.001 ? r - dpr : 1000 - r) : Math.abs(r - want);
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
            // blob: pictures too: an SVG drawn as a picture cannot load them itself
            if (!/^data:/.test(u) && !u.startsWith('#')) found.add(u.replace(/&quot;/g, ''));
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
                    ? new FontFace(`capture-probe-${localFonts.size}`, `local("${name.replace(/"/g, '')}")`).load().then(() => true, () => false)
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
        c.rim = RIM / scale;
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
                // the page's suspended states (behind another program, screen off) are not what the copy shows
                if (at.name === 'data-wm-behind' || at.name === 'data-screen-off') continue;
                attrs += ` ${at.name}="${escAttr(at.value)}"`;
            }
            if (el === parent) attrs += ` style="${escAttr(inherit)}"`;
            if (el === doc.documentElement) attrs += ' xmlns="http://www.w3.org/1999/xhtml"';
            return `<${el.localName}${attrs}>`;
        });
        const close = chain.slice().reverse().map((el) => `</${el.localName}>`).join('');
        return { open, close, chain };
    }

    // pictureScale: the scale the window's picture is drawn at (rasterize): a copied image needs
    // no more pixels than that
    function imageDataUrl(img, w, h, pictureScale) {
        const s = Math.min(2, root.devicePixelRatio || 1, pictureScale || 2);
        // an exact snapshot draws the picture at the box's own device pixels, as the page does
        // (naturalWidth is divided by a srcset's density: a 4x flag read as a quarter of its file)
        const es = exact ? exact.scale : s;
        const cw = Math.max(1, Math.min(2048, Math.round(w * es)));
        const ch = Math.max(1, Math.min(2048, Math.round(h * es)));
        const key = `${img.currentSrc || img.src}|${cw}x${ch}`;
        if (dataUrls.has(key)) return dataUrls.get(key);
        // drawn now (the frame the window shows: a mascot's mouth or blink layer changes src),
        // encoded off the main thread: toDataURL encoded each picture on it, the Director's four
        // ~2000 px mascot layers alone held one frame 1.3 s at a taskbar hover during a turn
        let c = null;
        try {
            c = doc.createElement('canvas');
            c.width = cw;
            c.height = ch;
            c.getContext('2d').drawImage(img, 0, 0, cw, ch);
        } catch (_) { return Promise.resolve(''); }
        const type = cw * ch > 64 * 64 ? 'image/webp' : 'image/png';
        const encoded = new Promise((resolve) => {
            try { c.toBlob(resolve, type, 0.92); } catch (_) { resolve(null); }
        }).then((blob) => (blob ? blobToDataUrl(blob) : ''));
        return remember(key, encoded);
    }

    /** False when nothing of `el` shows: outside the window or scrolled out of a clipping
     *  ancestor (clipRect). Such a picture is not copied: its box keeps the layout. */
    function showsInWindow(el, r, win, winRect) {
        const x = r.left - winRect.left;
        const y = r.top - winRect.top;
        const clip = clipRect(el, win, winRect);
        return x < clip.x + clip.w && x + r.width > clip.x && y < clip.y + clip.h && y + r.height > clip.y;
    }

    /** Copies the live state the clone loses (form values, scroll offsets) and swaps what an SVG
     *  picture cannot hold: images become data: URLs, canvases and videos holes drawn later. */
    function prepareClone(win, clone, winRect, pictureScale) {
        // a minimised window has no layout: every picture is copied at its own size, as before
        const laidOut = !win.classList.contains('minimised') && winRect.width > 0 && winRect.height > 0;
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
                if (laidOut && (!r.width || !r.height || !showsInWindow(a, r, win, winRect))) {
                    // not on screen (hidden, scrolled away): an empty box of the same layout size.
                    // The Director's chat had 85 of its 108 pictures off screen, each one encoded.
                    b.removeAttribute('src');
                    if (r.width && r.height) {
                        b.style.setProperty('width', `${a.offsetWidth}px`, 'important');
                        b.style.setProperty('height', `${a.offsetHeight}px`, 'important');
                    }
                    continue;
                }
                // a minimised window's images have no size: their own, up to 256 px
                const fit = Math.min(1, 256 / Math.max(a.naturalWidth || 1, a.naturalHeight || 1));
                const w = r.width || a.naturalWidth * fit;
                const h = r.height || a.naturalHeight * fit;
                // a picture from another origin (the Android app's program icons, appassets.androidplatform.net)
                // taints a canvas it is drawn on: its file is read instead
                let foreign = false;
                try { foreign = new URL(a.currentSrc || a.src, root.location.href).origin !== root.location.origin; } catch (_) { foreign = false; }
                if (foreign && (a.currentSrc || a.src)) {
                    waits.push(dataUrl(a.currentSrc || a.src).then((d) => { if (d) b.setAttribute('src', d); else b.removeAttribute('src'); }));
                } else if (a.complete && a.naturalWidth && w && h) {
                    waits.push(imageDataUrl(a, w, h, pictureScale).then((d) => { if (d) b.setAttribute('src', d); else b.removeAttribute('src'); }));
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
            const hole = b.ownerDocument.createElement('div');
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
            const t = setTimeout(() => reject(new Error('windowCapture: the picture took too long')), 4000);
            img.onload = () => { clearTimeout(t); resolve(img); };
            img.onerror = () => { clearTimeout(t); reject(new Error('windowCapture: the window picture did not load')); };
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
        const rect = exact ? win.getBoundingClientRect() : windowRect(win);
        // exact: the element's own fractional size (a bar 33.43 px tall is 88 device px, not 87 or 89)
        const W = exact ? Math.max(1, rect.width) : Math.max(1, Math.round(rect.width));
        const H = exact ? Math.max(1, rect.height) : Math.max(1, Math.round(rect.height));
        // window.__windowCaptureDebug = {} collects each step's time and the last SVG (profiling)
        const dbg = root.__windowCaptureDebug;
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
        // copied into an inert document of its own: a copy in the page's document starts its images
        // loading, and an <img> there registers a viewport listener with the page's media query
        // matcher that keeps the never-attached copy alive (three detached #manualModal trees of
        // ~1,300 nodes each in a DeX heap snapshot, 2026-11-04). The inert one dies with the copy.
        const clone = doc.implementation.createHTMLDocument('').importNode(win, true);
        // flip3d-hidden: Flip 3D hides the windows while their cards fly
        clone.classList.remove('minimised', 'minimising', 'entering', 'leaving', 'flip3d-hidden');
        clone.setAttribute('aria-hidden', 'true');
        const fixed = {
            position: 'absolute', inset: 'auto', left: '0px', top: '0px', right: 'auto', bottom: 'auto', margin: '0px',
            width: `${W}px`, height: `${H}px`, 'min-width': '0px', 'min-height': '0px', 'max-width': 'none', 'max-height': 'none',
            transform: 'none', translate: 'none', scale: 'none', rotate: 'none', zoom: '1', animation: 'none', transition: 'none',
            opacity: '1', visibility: 'visible'
        };
        Object.keys(fixed).forEach((p) => clone.style.setProperty(p, fixed[p], 'important'));
        // the scale the picture is drawn at below (exact: the snapshot's own)
        const pictureScale = exact ? exact.scale : Math.min(Math.min(1.5, root.devicePixelRatio || 1), MAX_TEX / W, MAX_TEX / H);
        const { waits, overlays } = prepareClone(win, clone, rect, pictureScale);
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
        if (exact) {
            // device pixels, no rim, no texture cap: what the screen shows of the element
            const c = doc.createElement('canvas');
            c.width = Math.max(1, Math.round(W * exact.scale));
            c.height = Math.max(1, Math.round(H * exact.scale));
            c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
            return { base: c, overlays, w: W, h: H, scale: exact.scale };
        }
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
    const PICTURE_BUDGET = 16 * 1024 * 1024; // pixels kept between uses (~64 MB)

    // windows on screen now (a Flip 3D, a taskbar preview): their pictures are never dropped
    const held = new Set();

    /** A picture let go: its observer and the window's listeners go with it (the listeners held the
     *  entry, and so the canvas, until the window next scrolled or typed). */
    function forget(win, e) {
        if (e.unwatch) e.unwatch();
        e.pic = null;
        pictures.delete(win);
    }

    /** Drops the least recently shown pictures past the budget (they are copied again when
     *  next needed); held ones stay. */
    function trimPictures() {
        let total = 0;
        pictures.forEach((e) => { if (e.pic) total += e.pic.base.width * e.pic.base.height; });
        if (total <= PICTURE_BUDGET) return;
        const onScreen = held;
        const old = Array.from(pictures.entries()).filter(([w, e]) => e.pic && !onScreen.has(w)).sort((a, b) => a[1].used - b[1].used);
        for (const [win, e] of old) {
            if (total <= PICTURE_BUDGET) break;
            total -= e.pic.base.width * e.pic.base.height;
            forget(win, e);
        }
    }

    function watch(win, entry) {
        if (entry.unwatch) entry.unwatch();
        const outside = (c) => c && c !== 'flip3d-hidden';
        const classes = (list) => list.filter(outside).sort().join(' ');
        const stop = () => {
            if (entry.observer) entry.observer.disconnect();
            entry.observer = null;
            win.removeEventListener('scroll', mark, true);
            win.removeEventListener('input', mark, true);
            win.removeEventListener('load', mark, true);
            if (entry.unwatch === stop) entry.unwatch = null;
        };
        const mark = (records) => {
            // the window's own style (moves, z-order) and Flip 3D's hiding class do not change
            // the picture; a new size is caught by fresh()
            if (Array.isArray(records) && records.every((r) => r.target === win && r.type === 'attributes' &&
                (r.attributeName === 'style' || (r.attributeName === 'class' && classes((r.oldValue || '').split(/\s+/)) === classes(Array.from(win.classList)))))) return;
            entry.dirty = true;
            stop();
        };
        entry.unwatch = stop;
        entry.observer = new MutationObserver(mark);
        entry.observer.observe(win, { subtree: true, childList: true, attributes: true, attributeOldValue: true, characterData: true });
        win.addEventListener('scroll', mark, true);
        win.addEventListener('input', mark, true);
        win.addEventListener('load', mark, true);
    }

    // ---- letting go while unused (#890) --------------------------------------------------------
    //
    // A taskbar hover or a Flip 3D kept its pictures (up to ~64 MB of canvases), the rule index and the
    // inlined files (up to ~32 MB of data: URLs) for the life of the page; a DeX window whose display
    // sleeps held them all the while. Hidden, the pictures of windows that are up go (a minimised window
    // keeps the one it had while it was up: it cannot be copied again until it is restored), and their
    // observers stop. IDLE_DROP_MS with no copy at all, the rule index and the inlined files go as well.
    // A hover after that copies again (~80-200 ms a changed window; the rule index ~0.3 s once).
    const IDLE_DROP_MS = 5 * 60 * 1000;
    let idleDropTimer = 0;
    function noteUse() {
        if (idleDropTimer) clearTimeout(idleDropTimer);
        idleDropTimer = setTimeout(dropIdle, IDLE_DROP_MS);
    }
    /** The pictures nobody looks at now: not on screen (held), not being made, not a minimised window's. */
    function dropUpPictures() {
        pictures.forEach((e, win) => {
            if (held.has(win) || e.busy) return;
            if (e.pic && win.isConnected && win.classList.contains('minimised')) return;
            forget(win, e);
        });
    }
    function dropIdle() {
        idleDropTimer = 0;
        dropUpPictures();
        // a copy under way (busy) or a snapshot queued still needs them: looked at again later
        let busy = false;
        pictures.forEach((e) => { if (e.busy) busy = true; });
        if (busy || exact) { noteUse(); return; }
        ruleIndex = null;
        dataUrls.clear();
        dataUrlChars = 0;
    }
    if (doc && doc.addEventListener) {
        doc.addEventListener('visibilitychange', () => { if (doc.visibilityState === 'hidden') dropUpPictures(); }, { signal: appScopeSignal });
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
        forgetClosed();
        noteUse();
        let e = pictures.get(win);
        if (!e) pictures.set(win, (e = { pic: null, dirty: true, observer: null, unwatch: null, w: 0, h: 0, busy: null, used: 0 }));
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
            console.warn('Window capture: could not draw a window', win.id, err && err.message);
            return null;
        });
        return e.busy;
    }

    /** The window's last picture (null: none yet), marked as just used. */
    function cached(win) {
        const e = pictures.get(win);
        if (!e || !e.pic) return null;
        e.used = performance.now();
        return e.pic;
    }

    /** Keeps the windows' pictures through trimming while they are on screen (`on` false lets go). */
    function hold(wins, on = true) {
        (wins || []).forEach((w) => { if (w) held[on ? 'add' : 'delete'](w); });
    }

    function forgetClosed() {
        pictures.forEach((e, win) => {
            if (win.isConnected && isWindow(win)) return;
            forget(win, e);
        });
        // a window closed while held (a preview that never said "let go"): the element is not kept for it
        held.forEach((win) => { if (!win.isConnected) held.delete(win); });
    }

    // an exact snapshot in progress ({ scale }): image-sets, pictures and the size follow the screen
    let exact = null;
    let snapChain = Promise.resolve();

    /**
     * Any element (not only a window) at the screen's own pixels, for a native copy of it (Melaton
     * Bars, #871): Promise of a canvas of round(width * scale) x round(height * scale) without the
     * rim, or null. The element is copied as it is when its turn comes; snapshots run one at a time.
     * opts.before() runs right before the copy (after the ones queued ahead of it).
     */
    function snapshot(el, opts = {}) {
        const run = async () => {
            if (opts.before) opts.before();
            exact = { scale: opts.scale || root.devicePixelRatio || 1 };
            try { return (await rasterize(el)).base; } catch (err) {
                console.warn('Window capture: snapshot failed', err && err.message);
                return null;
            } finally { exact = null; }
        };
        // one snapshot that hangs never holds the ones after it: null after 6 s
        const p = snapChain.then(() => Promise.race([run(), new Promise((r) => setTimeout(() => r(null), 6000))]));
        snapChain = p.catch(() => null);
        return p;
    }

    let prewarmQueue = [];
    let prewarmTimer = 0;

    /** Copies the windows in `list` that changed, one per idle moment, until `stop()` says so
     *  (Flip 3D: the Windows key went down, or the pointer rests on Switch between windows). */
    function prewarm(list, stop = () => false) {
        if (!doc) return;
        prewarmQueue = (list || []).filter((w) => !fresh(w));
        const next = () => {
            prewarmTimer = 0;
            const w = prewarmQueue.shift();
            if (!w || stop()) return;
            capture(w).then(() => {
                if (prewarmQueue.length && !stop()) schedule();
            });
        };
        const schedule = () => {
            if (prewarmTimer) return;
            prewarmTimer = root.requestIdleCallback ? root.requestIdleCallback(next, { timeout: 300 }) : setTimeout(next, 30);
        };
        schedule();
    }

    const api = {
        capture,
        snapshot,
        cached,
        fresh,
        composite,
        placeholder,
        prewarm,
        hold,
        forgetClosed,
        windowRect,
        loadImage,
        rimmedCanvas,
        isWindow,
        RIM,
        _test: { splitSelectors, stateOnly, absolutize, weightClass, testSelector, rightmostKey, flattenImageSets, matchingRules, rasterize, pictures }
    };
    root.windowCapture = api;
    // the rule index (~0.3 s once) while the page is idle, before the first copy needs it
    if (doc && root.requestIdleCallback) root.requestIdleCallback(() => { if (!ruleIndex) rules(); }, { timeout: 3000 });
})(typeof window !== 'undefined' ? window : globalThis);
