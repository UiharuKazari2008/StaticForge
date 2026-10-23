/**
 * Paint's type (Yozora #632), Photoshop's: the fonts this browser has, the font and style pickers
 * that show each font and weight in itself, the Character window, and drawing a type layer with
 * its weight, tracking, leading, caps, underline / strikethrough, alignment, vertical text and
 * anti-alias method.
 *
 *   text props { content, face, size (pt), weight (100-900), italic, underline, strike,
 *                caps 'none' | 'all' | 'small', tracking (1/1000 em), leading (pt, 0 = auto),
 *                align 'left' | 'center' | 'right', vertical, aa 'smooth' | 'none', color, x, y }
 *
 *   paintType.fonts()                      Dreamscape's own fonts (every @font-face: css/fonts.css,
 *                                          css/vista-fonts.css), then the computer's (checked once)
 *   paintType.ensure(face)                 load a webfont's faces before it is drawn on a canvas
 *   paintType.fontPicker(w, el, get, set)   a font menu in el: each name in its own font
 *   paintType.stylePicker(w, el, get, set)  the weights and italic, each shown as it looks
 *   paintType.draw(ctx, t)                  the text into a canvas context; returns its box
 *   paintType.bounds(t)                     the box the text takes, in picture pixels
 *   paintType.cssOf(t, zoom)                the text box's CSS while typing
 *   paintType.toggleCharacter(w) / characterOpen(w) / refresh(w)
 */
(function (root) {
    'use strict';

    const doc = document;
    // Vista's fonts first, then those other systems and Office bring
    const CANDIDATES = [
        'Arial', 'Arial Black', 'Arial Narrow', 'Book Antiqua', 'Bookman Old Style', 'Calibri', 'Cambria', 'Candara', 'Century Gothic',
        'Comic Sans MS', 'Consolas', 'Constantia', 'Corbel', 'Courier New', 'Franklin Gothic Medium', 'Garamond', 'Georgia', 'Gill Sans MT',
        'Impact', 'Lucida Console', 'Lucida Sans Unicode', 'Microsoft Sans Serif', 'Palatino Linotype', 'Segoe Print', 'Segoe Script',
        'Segoe UI', 'Segoe UI Light', 'Segoe UI Semibold', 'Sylfaen', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana',
        'Webdings', 'Wingdings', 'MS Gothic', 'MS Mincho', 'Meiryo', 'Yu Gothic', 'SimSun', 'Malgun Gothic',
        'DejaVu Sans', 'DejaVu Serif', 'DejaVu Sans Mono', 'Liberation Sans', 'Liberation Serif', 'Liberation Mono', 'Noto Sans',
        'Noto Serif', 'Noto Sans Mono', 'Noto Sans CJK JP', 'Ubuntu', 'Cantarell', 'Helvetica', 'Helvetica Neue', 'Menlo', 'Monaco',
        'Futura', 'Optima', 'Didot', 'Baskerville', 'Avenir', 'Roboto', 'Open Sans', 'Lato', 'Source Sans Pro', 'Fira Sans'
    ];
    const WEIGHTS = [[100, 'Thin'], [200, 'Extra Light'], [300, 'Light'], [400, 'Regular'], [500, 'Medium'], [600, 'Semibold'], [700, 'Bold'], [800, 'Extra Bold'], [900, 'Black']];
    let fontList = null;
    let measureCtx = null;

    function esc(v) {
        return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function mctx() {
        if (!measureCtx) measureCtx = doc.createElement('canvas').getContext('2d');
        return measureCtx;
    }

    /** A font is there when its widths differ from every generic fallback. */
    function available(face) {
        const x = mctx();
        const probe = 'mmmmmmmmmmlli1WQ@#';
        return ['monospace', 'serif', 'sans-serif'].some((g) => {
            x.font = `40px ${g}`;
            const base = x.measureText(probe).width;
            x.font = `40px "${face}", ${g}`;
            return Math.abs(x.measureText(probe).width - base) > 0.5;
        });
    }

    // icon fonts and Character Map's probe are not for writing
    const NOT_TEXT = /awesome|icons?\b|glyph|probe|symbol|emoji|webdings|wingdings/i;
    let baked = null;

    /** Dreamscape's @font-face families (loaded or not) and the faces each declares. */
    function bakedFaces() {
        if (baked) return baked;
        baked = new Map();
        if (doc.fonts && doc.fonts.forEach) {
            doc.fonts.forEach((f) => {
                const family = String(f.family).replace(/^["']|["']$/g, '');
                if (!family || NOT_TEXT.test(family)) return;
                if (!baked.has(family)) baked.set(family, []);
                baked.get(family).push({ weight: String(f.weight || '400'), style: String(f.style || 'normal') });
            });
        }
        return baked;
    }

    function fonts() {
        if (!fontList) {
            const own = Array.from(bakedFaces().keys()).sort((a, b) => a.localeCompare(b));
            const system = CANDIDATES.filter((f) => !bakedFaces().has(f) && !NOT_TEXT.test(f) && available(f)).sort((a, b) => a.localeCompare(b));
            fontList = own.concat(system);
            fontList.own = new Set(own);
            if (!fontList.length) fontList = ['Arial', 'Times New Roman', 'Courier New'];
        }
        return fontList;
    }

    function isOwn(face) { return bakedFaces().has(face); }

    /** Load a webfont's faces (a canvas does not wait for them); resolves when they are there. */
    function ensure(face) {
        const faces = bakedFaces().get(face);
        if (!faces || !doc.fonts || !doc.fonts.load) return Promise.resolve();
        return Promise.all(faces.map((f) => {
            const w = f.weight.split(' ')[0];
            return doc.fonts.load(`${f.style === 'italic' ? 'italic ' : ''}${w} 16px "${face}"`).catch(() => null);
        }));
    }

    /** The weights a font draws differently (the others would only be the browser's fake bold). */
    function weightsOf(face) {
        // a webfont says which weights it has (a variable one: a range)
        const declared = bakedFaces().get(face);
        if (declared) {
            const have = new Set();
            declared.forEach((f) => {
                const [lo, hi] = f.weight.split(' ').map(Number);
                WEIGHTS.forEach(([v]) => { if (v === lo || (hi && v >= lo && v <= hi)) have.add(v); });
            });
            if (!have.size) have.add(400);
            return WEIGHTS.filter(([v]) => have.has(v));
        }
        const x = mctx();
        const probe = 'Hamburgefonstiv';
        const w = {};
        WEIGHTS.forEach(([v]) => { x.font = `${v} 40px "${face}"`; w[v] = x.measureText(probe).width; });
        const list = WEIGHTS.filter(([v]) => v === 400 || v === 700 || (Math.abs(w[v] - w[400]) > 0.3 && Math.abs(w[v] - w[700]) > 0.3));
        // one entry per distinct look
        const seen = new Set();
        return list.filter(([v]) => { const k = Math.round(w[v] * 10); if (seen.has(k) && v !== 400 && v !== 700) return false; seen.add(k); return true; });
    }

    function styleName(weight, italic) {
        const n = (WEIGHTS.find(([v]) => v === weight) || [0, String(weight)])[1];
        if (italic) return n === 'Regular' ? 'Italic' : `${n} Italic`;
        return n;
    }

    // ---- the pickers ---------------------------------------------------------------------------

    let openPopup = null;

    function closePopup() {
        if (openPopup) { openPopup.remove(); openPopup = null; doc.removeEventListener('pointerdown', outside, true); }
    }

    function outside(ev) {
        if (openPopup && !openPopup.contains(ev.target) && !ev.target.closest('.mp-fp-button')) closePopup();
    }

    /** A drop-down list under a button: rows [{ value, html, style }], the chosen one marked. */
    function popup(button, rows, current, choose) {
        closePopup();
        const r = button.getBoundingClientRect();
        const p = doc.createElement('div');
        p.className = 'mp-fp-popup';
        p.setAttribute('role', 'listbox');
        p.innerHTML = rows.map((row, i) => (row.header
            ? `<div class="mp-fp-head" role="presentation">${esc(row.header)}</div>`
            : `<div class="mp-fp-row${String(row.value) === String(current) ? ' is-on' : ''}" role="option" data-i="${i}" style="${row.style || ''}">${row.html}</div>`)).join('');
        doc.body.appendChild(p);
        const below = innerHeight - r.bottom;
        p.style.left = `${Math.round(r.left)}px`;
        p.style.minWidth = `${Math.round(r.width)}px`;
        if (below < 260 && r.top > below) { p.style.bottom = `${Math.round(innerHeight - r.top)}px`; p.style.maxHeight = `${Math.round(r.top - 8)}px`; } else { p.style.top = `${Math.round(r.bottom)}px`; p.style.maxHeight = `${Math.round(Math.min(420, below - 8))}px`; }
        const on = p.querySelector('.is-on');
        if (on) on.scrollIntoView({ block: 'nearest' });
        const first = rows.findIndex((row) => !row.header);
        let hot = on ? Number(on.dataset.i) : first;
        const stepTo = (from, dir) => { let k = from + dir; while (k >= 0 && k < rows.length && rows[k].header) k += dir; return k >= 0 && k < rows.length ? k : from; };
        const mark = () => p.querySelectorAll('.mp-fp-row').forEach((e) => e.classList.toggle('is-hot', Number(e.dataset.i) === hot));
        p.addEventListener('pointermove', (ev) => { const e = ev.target.closest('.mp-fp-row'); if (e) { hot = Number(e.dataset.i); mark(); } });
        p.addEventListener('click', (ev) => {
            const e = ev.target.closest('.mp-fp-row');
            if (!e) return;
            closePopup();
            choose(rows[Number(e.dataset.i)].value);
        });
        p.tabIndex = -1;
        p.addEventListener('keydown', (ev) => {
            if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
                ev.preventDefault();
                hot = stepTo(hot, ev.key === 'ArrowDown' ? 1 : -1);
                mark();
                const e = p.querySelector(`[data-i="${hot}"]`);
                if (e) e.scrollIntoView({ block: 'nearest' });
            } else if (ev.key === 'Enter') { ev.preventDefault(); closePopup(); choose(rows[hot].value); } else if (ev.key === 'Escape') { ev.preventDefault(); closePopup(); button.focus(); } else if (ev.key.length === 1) {
                // a letter jumps to the first font starting with it
                const k = rows.findIndex((row) => !row.header && String(row.value).toLowerCase().startsWith(ev.key.toLowerCase()));
                if (k >= 0) { hot = k; mark(); p.querySelector(`[data-i="${k}"]`).scrollIntoView({ block: 'nearest' }); }
            }
        });
        openPopup = p;
        setTimeout(() => { doc.addEventListener('pointerdown', outside, true); p.focus(); }, 0);
    }

    /** A font button whose label is the font itself; its list shows every font in itself. */
    function fontPicker(w, el, get, set) {
        const face = get();
        el.innerHTML = `<button type="button" class="mp-fp-button" title="Font family"><span class="mp-fp-face" style="font-family:'${esc(face)}'">${esc(face)}</span><span class="mp-fp-arrow"></span></button>`;
        const b = el.querySelector('button');
        b.addEventListener('mousedown', (ev) => { if (w.text) ev.preventDefault(); });
        b.addEventListener('click', () => {
            if (openPopup) { closePopup(); return; }
            const list = fonts();
            const row = (f) => ({
                value: f,
                html: `<span class="mp-fp-name" style="font-family:'${esc(f)}'">${esc(f)}</span><span class="mp-fp-sample" style="font-family:'${esc(f)}'">Sample</span>`
            });
            const own = list.filter((f) => isOwn(f));
            const system = list.filter((f) => !isOwn(f));
            const rows = [];
            if (own.length) rows.push({ header: 'Melaton fonts' }, ...own.map(row));
            if (system.length) rows.push({ header: 'On this computer' }, ...system.map(row));
            popup(b, rows, get(), (v) => { set(v); void ensure(v).then(() => { w.restyleText(); w.renderBar(); }); });
        });
    }

    /** The font's weights and italic, each written in that weight. */
    function stylePicker(w, el, get, set) {
        const { face, weight, italic } = get();
        el.innerHTML = `<button type="button" class="mp-fp-button is-style" title="Font style"><span class="mp-fp-face" style="font-family:'${esc(face)}';font-weight:${weight};font-style:${italic ? 'italic' : 'normal'}">${esc(styleName(weight, italic))}</span><span class="mp-fp-arrow"></span></button>`;
        const b = el.querySelector('button');
        b.addEventListener('mousedown', (ev) => { if (w.text) ev.preventDefault(); });
        b.addEventListener('click', () => {
            if (openPopup) { closePopup(); return; }
            const cur = get();
            const rows = [];
            weightsOf(cur.face).forEach(([v]) => [false, true].forEach((it) => rows.push({
                value: `${v}${it ? 'i' : ''}`,
                html: `<span class="mp-fp-name" style="font-family:'${esc(cur.face)}';font-weight:${v};font-style:${it ? 'italic' : 'normal'}">${esc(styleName(v, it))}</span>`
            })));
            popup(b, rows, `${cur.weight}${cur.italic ? 'i' : ''}`, (v) => set({ weight: parseInt(v, 10), italic: /i$/.test(v) }));
        });
    }

    // ---- drawing ---------------------------------------------------------------------------------

    function fontOf(t, px) {
        return `${t.italic ? 'italic ' : ''}${t.caps === 'small' ? 'small-caps ' : ''}${t.weight || (t.bold ? 700 : 400)} ${px}px "${t.face}"`;
    }

    function lineHeight(t) {
        const px = (t.size * 96) / 72;
        return t.leading ? (t.leading * 96) / 72 : Math.ceil(px * 1.2);
    }

    function linesOf(t) {
        const s = t.caps === 'all' ? String(t.content).toUpperCase() : String(t.content);
        return s.split('\n');
    }

    /** The box the text takes (picture pixels), and what draw() needs to place each line. */
    function layout(t) {
        const x = mctx();
        const px = (t.size * 96) / 72;
        x.font = fontOf(t, px);
        if ('letterSpacing' in x) x.letterSpacing = `${((t.tracking || 0) / 1000) * px}px`;
        const lines = linesOf(t);
        const lh = lineHeight(t);
        const track = ((t.tracking || 0) / 1000) * px;
        if (t.vertical) {
            // columns right to left, the letters upright one under another (Photoshop's vertical type)
            const step = px + track;
            const longest = Math.max(1, ...lines.map((l) => Array.from(l).length));
            return { w: lh * lines.length + 4, h: Math.ceil(step * longest) + 4, lines, lh, px, step };
        }
        const widths = lines.map((l) => x.measureText(l).width);
        return { w: Math.ceil(Math.max(1, ...widths)) + 4, h: lh * lines.length + 4, lines, widths, lh, px };
    }

    function bounds(t) {
        const L = layout(t);
        return { x: t.x, y: t.y, w: L.w, h: L.h };
    }

    /** The text into ctx (a layer's, or a mask's), at t.x / t.y. */
    function draw(ctx, t) {
        const L = layout(t);
        const box = { x: t.x, y: t.y, w: L.w, h: L.h };
        // drawn on its own so 'None' anti-aliasing can harden the edges
        const c = doc.createElement('canvas');
        c.width = Math.max(1, Math.ceil(L.w + L.px));
        c.height = Math.max(1, Math.ceil(L.h + L.px));
        const x = c.getContext('2d', { willReadFrequently: true });
        x.font = fontOf(t, L.px);
        if ('letterSpacing' in x) x.letterSpacing = `${((t.tracking || 0) / 1000) * L.px}px`;
        x.fillStyle = t.color || '#000';
        x.textBaseline = 'top';
        const deco = (x0, y0, w) => {
            const th = Math.max(1, L.px / 14);
            if (t.underline) x.fillRect(x0, y0 + L.px * 0.92, w, th);
            if (t.strike) x.fillRect(x0, y0 + L.px * 0.52, w, th);
        };
        if (t.vertical) {
            L.lines.forEach((line, k) => {
                const cx = L.w - 2 - (k + 1) * L.lh + (L.lh - L.px) / 2;
                Array.from(line).forEach((ch, j) => {
                    const cw = x.measureText(ch).width;
                    x.fillText(ch, cx + (L.px - cw) / 2, 2 + j * L.step);
                });
                // the decorations run down the column's right side (Photoshop draws them there)
                const n = Array.from(line).length;
                const th = Math.max(1, L.px / 14);
                if (t.underline) x.fillRect(cx + L.px + 1, 2, th, n * L.step);
                if (t.strike) x.fillRect(cx + L.px / 2, 2, th, n * L.step);
            });
        } else {
            L.lines.forEach((line, k) => {
                const w = L.widths[k];
                const left = t.align === 'center' ? 2 + (L.w - 4 - w) / 2 : t.align === 'right' ? L.w - 2 - w : 2;
                const y = 2 + k * L.lh + (L.lh - L.px * 1.2) / 2;
                x.fillText(line, left, y);
                deco(left, y, w);
            });
        }
        if (t.aa === 'none') {
            const img = x.getImageData(0, 0, c.width, c.height);
            for (let i = 3; i < img.data.length; i += 4) img.data[i] = img.data[i] >= 128 ? 255 : 0;
            x.putImageData(img, 0, 0);
        }
        ctx.drawImage(c, t.x, t.y);
        return box;
    }

    /** The text box's CSS while typing, matching draw() at the zoom. */
    function cssOf(t, zoom) {
        const px = (t.size * 96) / 72;
        return {
            font: fontOf(t, px * zoom),
            letterSpacing: `${((t.tracking || 0) / 1000) * px * zoom}px`,
            lineHeight: `${lineHeight(t) * zoom}px`,
            textDecoration: [t.underline ? 'underline' : '', t.strike ? 'line-through' : ''].filter(Boolean).join(' ') || 'none',
            textTransform: t.caps === 'all' ? 'uppercase' : 'none',
            textAlign: t.align || 'left',
            writingMode: t.vertical ? 'vertical-rl' : 'horizontal-tb',
            textOrientation: t.vertical ? 'upright' : 'mixed',
            color: t.color
        };
    }

    // ---- the Character window (docked) ------------------------------------------------------------

    function dock(w) { return w.modal.querySelector('.mp-dock'); }
    function characterOpen(w) { return !!dock(w).querySelector('.mp-character'); }

    function toggleCharacter(w) {
        const d = dock(w);
        const cur = d.querySelector('.mp-character');
        if (cur) { cur.remove(); w.modal.classList.toggle('mp-has-dock', !!d.children.length); return; }
        d.insertAdjacentHTML('afterbegin', '<div class="mp-panel mp-character"><div class="mp-panel-cap">Character</div><div class="mp-char-body"></div></div>');
        w.modal.classList.add('mp-has-dock');
        refresh(w);
    }

    function refresh(w) {
        const p = dock(w) && dock(w).querySelector('.mp-character .mp-char-body');
        if (!p) return;
        const t = w.textFont();
        const color = w.text ? w.text.color : w.fg;
        const tog = (key, label, title, on) => `<button type="button" class="mp-char-tog${on ? ' is-on' : ''}" data-tog="${key}" title="${title}">${label}</button>`;
        p.innerHTML = `
            <div class="mp-char-row"><span class="mp-char-font"></span></div>
            <div class="mp-char-row"><span class="mp-char-style"></span></div>
            <div class="mp-char-grid">
                <label title="Size">Size<input type="number" class="tbp-edit" data-f="TextSize" min="1" max="1296" value="${t.size}"><i>pt</i></label>
                <label title="Leading: the distance between lines (0 = Auto)">Leading<input type="number" class="tbp-edit" data-f="TextLeading" min="0" max="2000" value="${t.leading || 0}"><i>${t.leading ? 'pt' : 'auto'}</i></label>
                <label title="Tracking: the space between letters, 1/1000 em">Tracking<input type="number" class="tbp-edit" data-f="TextTracking" min="-1000" max="10000" value="${t.tracking || 0}"></label>
                <label title="Color">Color<button type="button" class="mp-char-color"><span style="background:${root.paintColor ? root.paintColor.swatchBg(color) : color}"></span></button></label>
            </div>
            <div class="mp-char-row mp-char-toggles">
                ${tog('TextCaps:all', 'TT', 'All Caps', t.caps === 'all')}
                ${tog('TextCaps:small', '<span style="font-variant:small-caps">Tt</span>', 'Small Caps', t.caps === 'small')}
                ${tog('TextUnderline', '<u>T</u>', 'Underline', t.underline)}
                ${tog('TextStrike', '<s>T</s>', 'Strikethrough', t.strike)}
                <span class="mp-char-gap"></span>
                ${tog('TextAlign:left', '<span class="mp-al is-left"></span>', 'Left align text', t.align === 'left')}
                ${tog('TextAlign:center', '<span class="mp-al is-center"></span>', 'Center text', t.align === 'center')}
                ${tog('TextAlign:right', '<span class="mp-al is-right"></span>', 'Right align text', t.align === 'right')}
            </div>
            <div class="mp-char-row"><label>Anti-alias <select data-f="TextAA"><option value="smooth"${t.aa !== 'none' ? ' selected' : ''}>Smooth</option><option value="none"${t.aa === 'none' ? ' selected' : ''}>None</option></select></label></div>`;
        fontPicker(w, p.querySelector('.mp-char-font'), () => w.textFont().face, (v) => w.setTextFont({ TextFace: v }));
        stylePicker(w, p.querySelector('.mp-char-style'), () => w.textFont(), (s) => w.setTextFont({ TextWeight: s.weight, TextItalic: s.italic, TextBold: s.weight >= 600 }));
        p.querySelectorAll('input[data-f]').forEach((i) => i.addEventListener('change', () => w.setTextFont({ [i.dataset.f]: Number(i.value) || 0 })));
        p.querySelector('select[data-f]').addEventListener('change', (ev) => w.setTextFont({ TextAA: ev.target.value }));
        p.addEventListener('mousedown', (ev) => { if (ev.target.closest('button') && w.text) ev.preventDefault(); });
        p.querySelectorAll('[data-tog]').forEach((b) => b.addEventListener('click', () => {
            const [key, val] = b.dataset.tog.split(':');
            const cur = w.textFont();
            if (key === 'TextCaps') w.setTextFont({ TextCaps: cur.caps === val ? 'none' : val });
            else if (key === 'TextAlign') w.setTextFont({ TextAlign: val });
            else w.setTextFont({ [key]: !cur[key === 'TextUnderline' ? 'underline' : 'strike'] });
        }));
        p.querySelector('.mp-char-color').addEventListener('click', () => {
            if (!root.paintColor) return;
            root.paintColor.picker(w, 'fg', { color: w.text ? w.text.color : w.fg, title: 'Text Color', onPick: (c) => { if (w.text) { w.text.color = c; w.restyleText(); } else { w.fg = c; w.renderColors(); } refresh(w); w.renderBar(); } });
        });
    }

    root.paintType = { fonts, ensure, isOwn, weightsOf, styleName, fontPicker, stylePicker, draw, bounds, cssOf, fontOf, toggleCharacter, characterOpen, refresh, closePopup };
})(typeof window !== 'undefined' ? window : globalThis);
