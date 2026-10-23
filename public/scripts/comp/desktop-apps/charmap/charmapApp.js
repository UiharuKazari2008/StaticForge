/**
 * Character Map (Yozora #632): Vista's charmap.exe, 1:1 from the VM. The window is the .mui's own
 * dialog template "charmap:UCE" (vistaDialogTemplates.js, rendered by vistaDialogTemplate.js) with
 * the parts the program draws itself:
 *
 *   the grid         20 x 10 cells of 19 x 25 px (#646464 lines) from (28, 46), Arial-sized 16 px
 *                    glyphs of the chosen font, a 17 px scroll bar; the selected cell's 2 px frame
 *   the magnifier    while the button is down: the character large in a raised white box over its
 *                    cell, with the "U+0040: Commercial At" tooltip
 *   the status bar   sunken panel at the bottom: "U+0021: Exclamation Mark", and for a character
 *                    of the ANSI code page "Keystroke: Alt+0193" on the right
 *   Advanced view    Character set (Unicode or a code page), Go to Unicode, Group by (All or
 *                    Unicode Subrange in the Group By window), Search for / Reset
 *
 * Names are getuname.dll's (static_images/vista-charmap/names.json, Hangul syllables built from its
 * fragments); single-byte code pages from static_images/vista-charmap/codepages.json, the double-byte
 * ones from the browser's TextDecoder. The font list is Vista's installed families that this
 * browser can draw; a character shows when the font has a glyph for it (two fallbacks measure
 * apart when it does not).
 *
 *   openMelatonCharmap()
 */
(function (root) {
    'use strict';

    const doc = typeof document !== 'undefined' ? document : null;
    const ART = '/static_images/vista-charmap';
    const ICON = '/static_images/app_icons/24/vista-charmap.webp';
    const KEY = 'HKCU\\Software\\Xyridian\\CharMap';

    const COLS = 20;
    const ROWS = 10;
    const CELL_W = 19;
    const CELL_H = 25;
    const GRID_X = 28;
    const GRID_Y = 46;

    // HKLM\...\Fonts on the VM, as families (styles folded, "&" collections split)
    const FONTS = ['Aharoni', 'Andalus', 'Angsana New', 'AngsanaUPC', 'Arabic Typesetting', 'Arial', 'Arial Black',
        'Batang', 'BatangChe', 'Browallia New', 'BrowalliaUPC', 'Calibri', 'Cambria', 'Cambria Math', 'Candara',
        'Comic Sans MS', 'Consolas', 'Constantia', 'Corbel', 'Cordia New', 'CordiaUPC', 'Courier New', 'DaunPenh',
        'David', 'DFKai-SB', 'DilleniaUPC', 'DokChampa', 'Dotum', 'DotumChe', 'Estrangelo Edessa', 'EucrosiaUPC',
        'Euphemia', 'FangSong', 'Franklin Gothic Medium', 'FrankRuehl', 'FreesiaUPC', 'Gabriola', 'Gautami',
        'Georgia', 'Gisha', 'Gulim', 'GulimChe', 'Gungsuh', 'GungsuhChe', 'Impact', 'IrisUPC', 'Iskoola Pota',
        'JasmineUPC', 'KaiTi', 'Kalinga', 'Kartika', 'KodchiangUPC', 'Kokila', 'Latha', 'Leelawadee', 'Levenim MT',
        'LilyUPC', 'Lucida Console', 'Lucida Sans Unicode', 'Malgun Gothic', 'Mangal', 'Marlett', 'Meiryo',
        'Microsoft Himalaya', 'Microsoft JhengHei', 'Microsoft Sans Serif', 'Microsoft Uighur', 'Microsoft YaHei',
        'Microsoft Yi Baiti', 'MingLiU', 'MingLiU_HKSCS', 'Miriam', 'Miriam Fixed', 'Mongolian Baiti', 'MoolBoran',
        'MS Gothic', 'MS Mincho', 'MS PGothic', 'MS PMincho', 'MS UI Gothic', 'MV Boli', 'Narkisim', 'NSimSun',
        'Nyala', 'Palatino Linotype', 'Plantagenet Cherokee', 'PMingLiU', 'Raavi', 'Rod', 'Segoe Print',
        'Segoe Script', 'Segoe UI', 'Shruti', 'SimHei', 'Simplified Arabic', 'Simplified Arabic Fixed', 'SimSun',
        'Sylfaen', 'Symbol', 'Tahoma', 'Times New Roman', 'Traditional Arabic', 'Trebuchet MS', 'Tunga',
        'Verdana', 'Vrinda', 'Webdings', 'Wingdings'];

    // charmap.exe.mui strings 437-1258: Character set
    const CHARSETS = [['unicode', 'Unicode'], ['437', 'DOS: United States'], ['720', 'DOS: Arabic'], ['737', 'DOS: Greek'],
        ['775', 'DOS: Baltic'], ['850', 'DOS: Western Europe'], ['852', 'DOS: Central Europe'], ['855', 'DOS: Cyrillic'],
        ['857', 'DOS: Turkish'], ['862', 'DOS: Hebrew'], ['866', 'DOS: Cyrillic II'], ['874', 'Melaton: Thai'],
        ['932', 'Melaton: Japanese'], ['936', 'Melaton: Simplified Chinese'], ['949', 'Melaton: Korean'],
        ['950', 'Melaton: Traditional Chinese'], ['1250', 'Melaton: Central Europe'], ['1251', 'Melaton: Cyrillic'],
        ['1252', 'Melaton: Western'], ['1253', 'Melaton: Greek'], ['1254', 'Melaton: Turkish'], ['1255', 'Melaton: Hebrew'],
        ['1256', 'Melaton: Arabic'], ['1257', 'Melaton: Baltic'], ['1258', 'Melaton: Viet Nam']];
    const DBCS = { 932: 'shift_jis', 936: 'gbk', 949: 'euc-kr', 950: 'big5' };

    // strings 10101-10145: each subrange's blocks start a new row, as Vista lays them out
    const SUBRANGES = [
        ['Latin', [[0x41, 0x5A], [0x61, 0x7A], [0xAA, 0xAA, 0xBA, 0xBA, 0xC0, 0xD6, 0xD8, 0xDF], [0xE0, 0xF6, 0xF8, 0xFF], [0x100, 0x17F], [0x180, 0x24F], [0x1E00, 0x1EFF], [0xFB00, 0xFB06]]],
        ['General Punctuation', [[0x2000, 0x206F]]],
        ['Currency', [[0x24, 0x24, 0xA2, 0xA5], [0x20A0, 0x20CF]]],
        ['Super/Subscript', [[0xB2, 0xB3, 0xB9, 0xB9], [0x2070, 0x209F]]],
        ['Letterlike Symbols', [[0x2100, 0x214F]]],
        ['Number Forms', [[0xBC, 0xBE], [0x2150, 0x218F]]],
        ['Arrows', [[0x2190, 0x21FF]]],
        ['Mathematical Operators', [[0xB1, 0xB1, 0xD7, 0xD7, 0xF7, 0xF7], [0x2200, 0x22FF]]],
        ['Miscellaneous Technical', [[0x2300, 0x23FF]]],
        ['Control Pictures & OCR', [[0x2400, 0x243F], [0x2440, 0x245F]]],
        ['Enclosed Alphanumerics', [[0x2460, 0x24FF]]],
        ['Box Drawings', [[0x2500, 0x257F]]],
        ['Block Elements & Geometric Shapes', [[0x2580, 0x259F], [0x25A0, 0x25FF]]],
        ['Symbols & Dingbats', [[0x2600, 0x26FF], [0x2700, 0x27BF]]],
        ['Spacing Modifier Letters', [[0x2B0, 0x2FF]]],
        ['Combining Diacritical Marks', [[0x300, 0x36F], [0x20D0, 0x20FF]]],
        ['Greek', [[0x370, 0x3FF], [0x1F00, 0x1FFF]]],
        ['Cyrillic', [[0x400, 0x4FF], [0x500, 0x52F]]],
        ['Armenian', [[0x530, 0x58F], [0xFB13, 0xFB17]]],
        ['Hebrew', [[0x590, 0x5FF], [0xFB1D, 0xFB4F]]],
        ['Arabic', [[0x600, 0x6FF], [0xFB50, 0xFDFF], [0xFE70, 0xFEFF]]],
        ['Devanagari', [[0x900, 0x97F]]],
        ['Bengali', [[0x980, 0x9FF]]],
        ['Gurmukhi', [[0xA00, 0xA7F]]],
        ['Gujarati', [[0xA80, 0xAFF]]],
        ['Oriya', [[0xB00, 0xB7F]]],
        ['Tamil', [[0xB80, 0xBFF]]],
        ['Telugu', [[0xC00, 0xC7F]]],
        ['Kannada', [[0xC80, 0xCFF]]],
        ['Malayalam', [[0xD00, 0xD7F]]],
        ['Thai', [[0xE00, 0xE7F]]],
        ['Lao', [[0xE80, 0xEFF]]],
        ['Tibetan', [[0xF00, 0xFFF]]],
        ['Georgian', [[0x10A0, 0x10FF]]],
        ['Korean Hangul', [[0x1100, 0x11FF], [0x3130, 0x318F], [0xAC00, 0xD7A3]]],
        ['Japanese Hiragana/Katakana', [[0x3040, 0x309F], [0x30A0, 0x30FF], [0x31F0, 0x31FF]]],
        ['Chinese Bopomofo', [[0x3100, 0x312F], [0x31A0, 0x31BF]]],
        ['CJK Ideographs', [[0x4E00, 0x9FFF], [0x3400, 0x4DBF]]],
        ['CJK Symbols & Punctuation', [[0x3000, 0x303F]]],
        ['Ideographic Symbols', [[0x3200, 0x32FF], [0x3300, 0x33FF]]],
        ['CJK Compatibility Form', [[0xFE30, 0xFE4F]]],
        ['Small Form Variants', [[0xFE50, 0xFE6F]]],
        ['Fullwidth Forms', [[0xFF01, 0xFF60], [0xFFE0, 0xFFE6]]],
        ['Halfwidth Forms', [[0xFF61, 0xFFDC], [0xFFE8, 0xFFEE]]],
        ['Private Use Characters', [[0xE000, 0xF8FF]]]
    ];

    // getuname.dll ranges: one name for the whole block
    const NAME_RANGES = [[0x3400, 0x4DBF], [0x4E00, 0x9FFF], [0xE000, 0xF8FF], [0xD800, 0xDB7F], [0xDB80, 0xDBFF], [0xDC00, 0xDFFF]];

    function esc(v) {
        return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function callGlobal(name, ...args) {
        const fn = root[name];
        return typeof fn === 'function' ? fn(...args) : undefined;
    }

    function hex4(cp) {
        return cp.toString(16).toUpperCase().padStart(4, '0');
    }

    // names.json keys: the code point in hex, no leading zeros
    function nameKey(cp) {
        return cp.toString(16).toUpperCase();
    }

    // ---- data ----

    let names = null;
    let namesLoading = null;
    let codepages = null;

    function loadNames() {
        if (names) return Promise.resolve(names);
        if (!namesLoading) {
            // a failed load is not kept: the next window asks again
            namesLoading = fetch(`${ART}/names.json`).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
                .then((j) => { names = j; return j; })
                .catch(() => { namesLoading = null; return {}; });
        }
        return namesLoading;
    }

    async function loadCodepages() {
        if (codepages) return codepages;
        try { codepages = await (await fetch(`${ART}/codepages.json`)).json(); } catch (_) { codepages = {}; }
        return codepages;
    }

    /** getuname.dll's name: its string, a block's shared name, or a Hangul syllable built from parts. */
    function charName(cp) {
        if (!names) return '';
        if (cp >= 0xAC00 && cp <= 0xD7A3) {
            const s = cp - 0xAC00;
            const l = Math.floor(s / 588);
            const v = Math.floor((s % 588) / 28);
            const t = s % 28;
            const part = (base, i) => names[nameKey(base + i)] || '';
            return `${names.AC00 || 'Hangul Syllable '}${part(0xAC01, l)}${part(0xAD00, v)}${t ? part(0xAE00, t) : ''}`.replace(/\s+/g, ' ').trim();
        }
        const own = names[nameKey(cp)];
        if (own) return own.trim();
        for (const [a, b] of NAME_RANGES) {
            if (cp >= a && cp <= b) return String(names[nameKey(a)] || '').trim();
        }
        return '';
    }

    /** What a cell draws: the character, except the soft hyphen, which Vista's GDI shows as a hyphen. */
    function glyph(cp) {
        return cp === 0xAD ? '-' : String.fromCharCode(cp);
    }

    // ---- glyph coverage ----

    // A probe font maps every BMP character to one blank glyph 1.237 em wide (fonts/charmap/
    // charmap-probe.woff2, built with fontTools). Drawn as "<font>", probe, a character the font
    // lacks falls back to the probe, never to a system font, and measures exactly that width.
    const PROBE = 'Melaton Charmap Probe';
    const PROBE_PX = 40;
    const PROBE_W = PROBE_PX * 1.237;
    let probeReady = null;
    const coverage = new Map(); // font -> Set of code points with a glyph

    function loadProbe() {
        if (!probeReady) {
            probeReady = (async () => {
                try {
                    const face = new FontFace(PROBE, 'url(/fonts/charmap/charmap-probe.woff2)');
                    await face.load();
                    doc.fonts.add(face);
                    return true;
                } catch (_) { return false; }
            })();
        }
        return probeReady;
    }

    const probes = { font: null, ctx: null };
    function probeCtx(font) {
        if (probes.font !== font) {
            probes.ctx = doc.createElement('canvas').getContext('2d');
            probes.ctx.font = `${PROBE_PX}px "${font}", "${PROBE}"`;
            probes.font = font;
        }
        return probes.ctx;
    }

    function fontAvailable(font) {
        const probe = 'mmlliWW@0';
        return Math.abs(probeCtx(font).measureText(probe).width - PROBE_W * probe.length) > 0.5;
    }

    function hasGlyph(font, ch) {
        return Math.abs(probeCtx(font).measureText(ch).width - PROBE_W) > 0.01;
    }

    function skip(cp) {
        return cp < 0x21 || (cp >= 0x7F && cp <= 0x9F) || (cp >= 0xD800 && cp <= 0xDFFF) || cp === 0xFFFE || cp === 0xFFFF;
    }

    /** Every BMP character the font draws, scanned in slices so the window stays live. */
    async function scanFont(font, onSlice) {
        if (coverage.has(font)) return coverage.get(font);
        const set = new Set();
        for (let start = 0x21; start <= 0xFFFD; start += 2048) {
            const end = Math.min(0xFFFD, start + 2047);
            for (let cp = start; cp <= end; cp += 1) {
                if (!skip(cp) && hasGlyph(font, String.fromCharCode(cp))) set.add(cp);
            }
            if (onSlice) onSlice(set);
            await new Promise((r) => setTimeout(r, 0));
        }
        coverage.set(font, set);
        return set;
    }

    // ---- the window ----

    let app = null;

    class CharMap {
        constructor() {
            this.font = 'Arial';
            this.charset = 'unicode';
            this.group = 'all';
            this.subrange = 0;
            this.search = '';
            this.searching = false;
            this.advanced = false;
            this.cells = [];   // code points (null: an empty cell that ends a group's row)
            this.sel = 0;      // index into cells
            this.top = 0;      // first visible row
            this.scanToken = 0;
            this.build();
        }

        get rows() {
            return Math.max(ROWS, Math.ceil(this.cells.length / COLS));
        }

        build() {
            const T = root.vistaDialogTemplate;
            const tpl = (root.vistaDialogTemplates || {})['charmap:UCE'];
            const m = doc.createElement('div');
            m.id = 'melatonCharmapModal';
            m.className = 'modal hidden tbp-window vdt-window cm-window';
            m.dataset.windowIdentifier = 'melatonCharmap';
            m.dataset.windowClient = 'light';
            m.dataset.windowFixedSize = 'true';
            m.dataset.windowRestoreSize = 'false';
            m.dataset.vistaDialog = 'form';
            m.dataset.taskbarIcon = ICON;
            m.setAttribute('role', 'dialog');
            m.setAttribute('aria-label', 'Character Map');
            const sz = T.size(tpl);
            const fontOptions = FONTS.filter(fontAvailable);
            if (!fontOptions.includes(this.font)) this.font = fontOptions[0] || 'Arial';
            this.fonts = fontOptions;
            m.innerHTML = `
                <div class="modal-window-title"><div class="modal-window-title-main"><img class="icon-image" src="${ICON}" alt=""><span>Character Map</span></div></div>
                <div class="modal-focus-overlay"></div>
                <div class="modal-window-controls">
                    <button type="button" class="btn-secondary minimize-btn btn-small" title="Minimize"><i class="fa-regular fa-window-minimize"></i></button>
                    <button type="button" class="btn-secondary btn-small cm-max" title="Maximize" disabled><i class="fa-regular fa-window-maximize"></i></button>
                    <button type="button" class="btn-danger close-btn btn-small cm-close" title="Close"><i class="fa-regular fa-xmark-large"></i></button>
                </div>
                <div class="modal-content win7 tbp-client vdt-client cm-client" style="width:${sz.width}px; font:${T.units(tpl).font}">
                    <div class="vdt-plain-page">${T.renderControls(tpl, 'cm', { module: 'charmap', overrides: {
                        104: { html: '<input type="text" class="tbp-edit cm-copy-text" spellcheck="false">' },
                        105: { html: `<button type="button" class="cm-font" aria-haspopup="listbox"><span class="cm-font-icon"></span><span class="cm-font-name"></span><span class="cm-font-arrow"></span></button>` }
                    } })}</div>
                    <div class="cm-grid" tabindex="0" role="grid" aria-label="Characters">
                        <div class="cm-cells"></div>
                        <div class="cm-selbox" aria-hidden="true"></div>
                    </div>
                    <div class="cm-scroll" aria-hidden="true"><div class="cm-scroll-space"></div></div>
                    <div class="cm-status"><span class="cm-status-name"></span><span class="cm-status-key"></span></div>
                </div>`;
            doc.body.appendChild(m);
            this.modal = m;
            this.client = m.querySelector('.cm-client');
            this.gridEl = m.querySelector('.cm-grid');
            this.cellsEl = m.querySelector('.cm-cells');
            this.selbox = m.querySelector('.cm-selbox');
            this.scrollEl = m.querySelector('.cm-scroll');
            this.space = m.querySelector('.cm-scroll-space');
            this.copyEl = m.querySelector('.cm-copy-text');
            this.el = (id) => m.querySelector(`[data-vdt-id="${id}"]`);
            this.input = (id) => { const e = this.el(id); return e && (e.matches('input, select, button, textarea') ? e : e.querySelector('input, select, button, textarea')); };
            this.wire();
            this.setAdvanced(false);
            this.fillCombos();
            this.showFont();
            void loadNames().then(() => this.status());
            void this.reload();
        }

        fillCombos() {
            const set = this.input(130);
            if (set) set.innerHTML = CHARSETS.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join('');
            const grp = this.input(202);
            if (grp) grp.innerHTML = '<option value="all">All</option><option value="subrange">Unicode Subrange</option>';
        }

        showFont() {
            const name = this.modal.querySelector('.cm-font-name');
            if (name) name.textContent = this.font;
            this.cellsEl.style.setProperty('--cm-font', `"${this.font}"`);
        }

        setAdvanced(on) {
            this.advanced = on;
            const box = this.input(119);
            if (box) box.checked = on;
            [129, 130, 700, 701, 201, 202, 131, 132, 133].forEach((id) => {
                const e = this.el(id);
                if (e) e.hidden = !on;
            });
            // Vista: the dialog ends under Advanced view (219 DLU) or under Search (275 DLU); the
            // status bar takes the last 22 px
            this.client.style.height = `${on ? 478 : 376}px`;
            this.modal.classList.toggle('is-advanced', on);
        }

        // ---- the character list ----

        async reload() {
            const token = ++this.scanToken;
            const font = this.font;
            const keepCp = this.cells[this.sel];
            let list = [];
            if (this.searching) {
                await loadNames();
                const words = this.search.toLowerCase().split(/\s+/).filter(Boolean);
                const set = await scanFont(font);
                if (token !== this.scanToken) return;
                list = [...set].filter((cp) => { const n = charName(cp).toLowerCase(); return words.every((w) => n.includes(w)); });
            } else if (this.group === 'subrange') {
                const set = await scanFont(font);
                if (token !== this.scanToken) return;
                const blocks = (SUBRANGES[this.subrange] || SUBRANGES[0])[1];
                blocks.forEach((pairs) => {
                    const row = [];
                    for (let i = 0; i < pairs.length; i += 2) {
                        for (let cp = pairs[i]; cp <= pairs[i + 1]; cp += 1) if (set.has(cp)) row.push(cp);
                    }
                    if (!row.length) return;
                    list.push(...row);
                    while (list.length % COLS) list.push(null);
                });
            } else if (this.charset !== 'unicode') {
                list = await this.codepageList(Number(this.charset), font);
                if (token !== this.scanToken) return;
            } else {
                // the first slice shows at once; the rest of the font fills in behind it
                const set = await scanFont(font, (partial) => {
                    if (token !== this.scanToken || this.cells.length > 2000) return;
                    this.setCells([...partial].sort((a, b) => a - b), keepCp);
                });
                if (token !== this.scanToken) return;
                list = [...set].sort((a, b) => a - b);
            }
            this.setCells(list, keepCp);
        }

        async codepageList(cp, font) {
            const out = [];
            if (DBCS[cp]) {
                let dec;
                try { dec = new TextDecoder(DBCS[cp], { fatal: true }); } catch (_) { return out; }
                for (let b = 0x21; b < 0x80; b += 1) out.push({ cp: b, code: b });
                for (let lead = 0x81; lead <= 0xFE; lead += 1) {
                    for (let trail = 0x40; trail <= 0xFE; trail += 1) {
                        try {
                            const s = dec.decode(new Uint8Array([lead, trail]));
                            if (s.length === 1 && s.charCodeAt(0) !== 0xFFFD) out.push({ cp: s.charCodeAt(0), code: (lead << 8) | trail });
                        } catch (_) { /* not a character */ }
                    }
                }
            } else {
                const t = (await loadCodepages())[cp] || [];
                t.forEach((u, b) => { if (u != null && b >= 0x21 && !(u >= 0x7F && u <= 0x9F) && u !== 0x7F) out.push({ cp: u, code: b }); });
            }
            this.codes = new Map(out.map((o) => [o.cp, o.code]));
            return out.map((o) => o.cp).filter((u) => hasGlyph(font, String.fromCharCode(u)));
        }

        setCells(list, keepCp) {
            if (this.charset === 'unicode' || this.group === 'subrange' || this.searching) this.codes = null;
            this.cells = list;
            const at = keepCp != null ? list.indexOf(keepCp) : -1;
            this.sel = at >= 0 ? at : Math.max(0, list.findIndex((c) => c != null));
            this.top = Math.min(this.top, Math.max(0, this.rows - ROWS));
            this.ensureVisible();
            this.render();
        }

        // ---- drawing ----

        render() {
            const start = this.top * COLS;
            let html = '';
            for (let i = 0; i < ROWS * COLS; i += 1) {
                const cp = this.cells[start + i];
                html += `<span class="cm-cell" data-i="${start + i}">${cp != null ? esc(glyph(cp)) : ''}</span>`;
            }
            this.cellsEl.innerHTML = html;
            this.placeSel();
            this.placeThumb();
            this.status();
        }

        placeSel() {
            const row = Math.floor(this.sel / COLS) - this.top;
            const col = this.sel % COLS;
            const on = row >= 0 && row < ROWS && this.cells[this.sel] != null;
            this.selbox.hidden = !on;
            if (on) {
                this.selbox.style.left = `${col * CELL_W - 1}px`;
                this.selbox.style.top = `${row * CELL_H - 1}px`;
            }
        }

        /** A real scroll bar (Vista's, vista-scrollbars.css) over a spacer, one row per 25 px. */
        placeThumb() {
            this.space.style.height = `${this.rows * CELL_H}px`;
            this.syncing = true;
            this.scrollEl.scrollTop = this.top * CELL_H;
            requestAnimationFrame(() => { this.syncing = false; });
        }

        status() {
            const cp = this.cells[this.sel];
            const nameEl = this.modal.querySelector('.cm-status-name');
            const keyEl = this.modal.querySelector('.cm-status-key');
            if (cp == null) {
                nameEl.textContent = '';
                keyEl.textContent = '';
                return;
            }
            const code = this.codes && this.codes.get(cp);
            const codeText = code != null ? ` (0x${code.toString(16).toUpperCase().padStart(code > 0xFF ? 4 : 2, '0')})` : '';
            nameEl.textContent = `U+${hex4(cp)}${codeText}: ${charName(cp)}`;
            const ansi = ansiCode(cp);
            keyEl.textContent = ansi != null && ansi >= 0x80 ? `Keystroke: Alt+${String(ansi).padStart(4, '0')}` : '';
        }

        ensureVisible() {
            const row = Math.floor(this.sel / COLS);
            if (row < this.top) this.top = row;
            else if (row >= this.top + ROWS) this.top = row - ROWS + 1;
        }

        select(i) {
            if (i < 0 || i >= this.cells.length || this.cells[i] == null) return;
            this.sel = i;
            const before = this.top;
            this.ensureVisible();
            if (before !== this.top) this.render();
            else { this.placeSel(); this.status(); }
        }

        scrollTo(top) {
            const t = Math.max(0, Math.min(this.rows - ROWS, top));
            if (t === this.top) return;
            this.top = t;
            this.render();
        }

        // ---- the magnifier ----

        /** at: the pointer's client position; Vista's tip sits 2 px right of it and 20 px under it. */
        magnify(i, at) {
            this.unmagnify();
            const cp = this.cells[i];
            if (cp == null) return;
            const row = Math.floor(i / COLS) - this.top;
            const col = i % COLS;
            const box = doc.createElement('div');
            box.className = 'cm-magnify';
            box.style.fontFamily = `"${this.font}"`;
            box.textContent = glyph(cp);
            box.style.left = `${GRID_X + col * CELL_W + CELL_W / 2}px`;
            box.style.top = `${GRID_Y + row * CELL_H + CELL_H / 2}px`;
            this.client.appendChild(box);
            const tip = doc.createElement('div');
            tip.className = 'cm-tip';
            tip.textContent = `U+${hex4(cp)}: ${charName(cp)}`;
            this.client.appendChild(tip);
            const cr = this.client.getBoundingClientRect();
            const px = at ? at.x - cr.left : GRID_X + col * CELL_W + CELL_W / 2;
            const py = at ? at.y - cr.top : GRID_Y + row * CELL_H + CELL_H / 2;
            tip.style.left = `${Math.round(px + 2)}px`;
            tip.style.top = `${Math.round(py + 20)}px`;
            this.mag = { box, tip, i };
        }

        unmagnify() {
            if (!this.mag) return;
            this.mag.box.remove();
            this.mag.tip.remove();
            this.mag = null;
        }

        cellAt(ev) {
            const r = this.gridEl.getBoundingClientRect();
            const col = Math.floor((ev.clientX - r.left) / CELL_W);
            const row = Math.floor((ev.clientY - r.top) / CELL_H);
            if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return -1;
            return (this.top + row) * COLS + col;
        }

        // ---- "Characters to copy" ----

        addChar(cp) {
            if (cp == null) return;
            const el = this.copyEl;
            const ch = String.fromCharCode(cp);
            const s = el.selectionStart != null ? el.selectionStart : el.value.length;
            const e = el.selectionEnd != null ? el.selectionEnd : el.value.length;
            el.value = el.value.slice(0, s) + ch + el.value.slice(e);
            el.setSelectionRange(s + 1, s + 1);
            el.style.fontFamily = `"${this.font}"`;
            this.syncCopy();
        }

        syncCopy() {
            const copy = this.input(102);
            if (copy) copy.disabled = !this.copyEl.value;
        }

        async copy() {
            const el = this.copyEl;
            const text = el.selectionStart !== el.selectionEnd ? el.value.slice(el.selectionStart, el.selectionEnd) : el.value;
            if (!text) return;
            try { await navigator.clipboard.writeText(text); } catch (_) {
                el.select();
                try { doc.execCommand('copy'); } catch (__) { /* no clipboard */ }
            }
            el.focus();
            el.select();
        }

        // ---- font ----

        async pickFont(font) {
            if (!font || font === this.font) return;
            if (this.copyEl.value && !readReg('DontShowFontChangeMessage', false)) {
                const ok = await fontChangePrompt(this.modal);
                if (!ok) return;
            }
            this.font = font;
            this.showFont();
            void this.reload();
        }

        openFontList() {
            const btn = this.modal.querySelector('.cm-font');
            if (this.fontList) { this.closeFontList(); return; }
            const list = doc.createElement('div');
            list.className = 'cm-font-list';
            list.setAttribute('role', 'listbox');
            list.innerHTML = this.fonts.map((f) => `<div class="cm-font-item${f === this.font ? ' is-current' : ''}" role="option" data-font="${esc(f)}"><span class="cm-font-icon"></span>${esc(f)}</div>`).join('');
            const br = btn.getBoundingClientRect();
            const cr = this.client.getBoundingClientRect();
            list.style.left = `${br.left - cr.left}px`;
            list.style.top = `${br.bottom - cr.top}px`;
            list.style.width = `${br.width}px`;
            this.client.appendChild(list);
            this.fontList = list;
            const cur = list.querySelector('.is-current');
            if (cur) cur.scrollIntoView({ block: 'nearest' });
            list.addEventListener('mousedown', (ev) => ev.preventDefault());
            list.addEventListener('click', (ev) => {
                const it = ev.target.closest('.cm-font-item');
                if (!it) return;
                this.closeFontList();
                void this.pickFont(it.dataset.font);
            });
            list.addEventListener('mousemove', (ev) => {
                const it = ev.target.closest('.cm-font-item');
                if (!it) return;
                list.querySelectorAll('.is-hot').forEach((x) => x.classList.remove('is-hot'));
                it.classList.add('is-hot');
            });
        }

        closeFontList() {
            if (this.fontList) this.fontList.remove();
            this.fontList = null;
        }

        // ---- Group By window ----

        openGroupBy() {
            if (this.groupWin) return;
            const w = doc.createElement('div');
            w.id = 'melatonCharmapGroupBy';
            w.className = 'modal hidden tbp-window vdt-window cm-groupby';
            w.dataset.windowIdentifier = 'melatonCharmapGroupBy';
            w.dataset.windowClient = 'light';
            w.dataset.windowFixedSize = 'true';
            w.dataset.vistaDialog = 'form';
            w.dataset.iconOwnerId = this.modal.id;
            w.innerHTML = `
                <div class="modal-window-title"><div class="modal-window-title-main"><img class="icon-image" src="${ICON}" alt=""><span>Group By</span></div></div>
                <div class="modal-focus-overlay"></div>
                <div class="modal-window-controls"><button type="button" class="btn-danger close-btn btn-small cm-gb-close" title="Close"><i class="fa-regular fa-xmark-large"></i></button></div>
                <div class="modal-content win7 tbp-client cm-gb-client">
                    <div class="cm-gb-label">Unicode Subrange</div>
                    <div class="cm-gb-list" role="listbox" tabindex="0">${SUBRANGES.map(([n], i) => `<div class="cm-gb-item${i === this.subrange ? ' is-selected' : ''}" role="option" data-i="${i}">${esc(n)}</div>`).join('')}</div>
                </div>`;
            doc.body.appendChild(w);
            this.groupWin = w;
            callGlobal('openModal', w);
            w.classList.remove('hidden');
            const r = this.modal.getBoundingClientRect();
            callGlobal('setModalOffsetsFromViewportTopLeft', w, Math.round(r.right), Math.round(r.top));
            w.querySelector('.cm-gb-close').addEventListener('click', () => this.closeGroupBy(true));
            w.querySelector('.cm-gb-list').addEventListener('click', (ev) => {
                const it = ev.target.closest('.cm-gb-item');
                if (!it) return;
                w.querySelectorAll('.cm-gb-item').forEach((x) => x.classList.toggle('is-selected', x === it));
                this.subrange = Number(it.dataset.i);
                this.top = 0;
                this.sel = 0;
                this.cells = [];
                void this.reload();
            });
        }

        closeGroupBy(toAll) {
            if (!this.groupWin) return;
            const w = this.groupWin;
            this.groupWin = null;
            try { callGlobal('closeModal', w); } catch (_) { /* gone */ }
            setTimeout(() => w.remove(), 300);
            if (toAll) {
                const grp = this.input(202);
                if (grp) grp.value = 'all';
                this.setGroup('all');
            }
        }

        setGroup(g) {
            this.group = g;
            const subrange = g === 'subrange';
            // grouped: Character set and Go to Unicode grey out (VM)
            [129, 130, 700, 701].forEach((id) => {
                const e = this.el(id);
                if (!e) return;
                e.classList.toggle('is-disabled', subrange);
                const inp = e.matches('input, select') ? e : e.querySelector('input, select');
                if (inp) inp.disabled = subrange;
            });
            if (subrange) this.openGroupBy();
            else this.closeGroupBy(false);
            this.top = 0;
            this.cells = [];
            void this.reload();
        }

        // ---- events ----

        wire() {
            const m = this.modal;
            m.querySelector('.cm-close').addEventListener('click', () => this.close());
            m.querySelector('.cm-font').addEventListener('click', () => this.openFontList());
            doc.addEventListener('mousedown', (ev) => {
                if (this.fontList && !ev.target.closest('.cm-font-list, .cm-font')) this.closeFontList();
            }, true);
            this.gridEl.addEventListener('mousedown', (ev) => {
                if (ev.button !== 0) return;
                const i = this.cellAt(ev);
                if (i < 0 || this.cells[i] == null) return;
                ev.preventDefault();
                this.gridEl.focus();
                this.select(i);
                this.magnify(i, { x: ev.clientX, y: ev.clientY });
                const move = (e2) => {
                    const j = this.cellAt(e2);
                    if (j >= 0 && this.cells[j] != null && (!this.mag || this.mag.i !== j)) { this.select(j); this.magnify(j, { x: e2.clientX, y: e2.clientY }); }
                };
                const up = () => {
                    doc.removeEventListener('mousemove', move);
                    doc.removeEventListener('mouseup', up);
                    this.unmagnify();
                };
                doc.addEventListener('mousemove', move);
                doc.addEventListener('mouseup', up);
            });
            this.gridEl.addEventListener('dblclick', (ev) => {
                const i = this.cellAt(ev);
                if (i >= 0) this.addChar(this.cells[i]);
            });
            this.gridEl.addEventListener('wheel', (ev) => {
                ev.preventDefault();
                this.scrollTo(this.top + (ev.deltaY > 0 ? 3 : -3));
            }, { passive: false });
            this.gridEl.addEventListener('keydown', (ev) => {
                const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -COLS, ArrowDown: COLS, PageUp: -COLS * ROWS, PageDown: COLS * ROWS };
                if (moves[ev.key] !== undefined) {
                    ev.preventDefault();
                    let j = Math.max(0, Math.min(this.cells.length - 1, this.sel + moves[ev.key]));
                    while (j > 0 && this.cells[j] == null) j -= 1;
                    this.select(j);
                } else if (ev.key === 'Home' || ev.key === 'End') {
                    ev.preventDefault();
                    this.select(ev.key === 'Home' ? 0 : this.cells.length - 1);
                } else if (ev.key === ' ' || ev.key === 'Enter') {
                    ev.preventDefault();
                    this.addChar(this.cells[this.sel]);
                }
            });
            this.scrollEl.addEventListener('scroll', () => {
                if (this.syncing) return;
                const t = Math.round(this.scrollEl.scrollTop / CELL_H);
                if (t !== this.top) { this.top = t; this.render(); }
            });
            m.addEventListener('click', (ev) => {
                const b = ev.target.closest('[data-vdt-id]');
                if (!b) return;
                const id = Number(b.dataset.vdtId);
                if (id === 103) this.addChar(this.cells[this.sel]);
                else if (id === 102) void this.copy();
                else if (id === 100) callGlobal('openHelpAndSupport', 'charmap');
                else if (id === 133) this.toggleSearch();
            });
            const adv = this.input(119);
            if (adv) adv.addEventListener('change', () => this.setAdvanced(adv.checked));
            this.copyEl.addEventListener('input', () => this.syncCopy());
            const set = this.input(130);
            if (set) set.addEventListener('change', () => { this.charset = set.value; this.top = 0; this.cells = []; void this.reload(); });
            const grp = this.input(202);
            if (grp) grp.addEventListener('change', () => this.setGroup(grp.value));
            const go = this.input(701);
            if (go) {
                go.maxLength = 4;
                go.addEventListener('input', () => {
                    const v = parseInt(go.value, 16);
                    if (!Number.isFinite(v)) return;
                    const i = this.cells.indexOf(v);
                    if (i >= 0) this.select(i);
                });
            }
            const q = this.input(132);
            if (q) {
                q.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); this.toggleSearch(true); } });
                q.addEventListener('input', () => { const b = this.input(133); if (b && !this.searching) b.disabled = !q.value.trim(); });
            }
            this.syncCopy();
            const sb = this.input(133);
            if (sb) sb.disabled = true;
        }

        /** Search: the grid shows the characters whose names hold every word; the button reads Reset. */
        toggleSearch(force) {
            const q = this.input(132);
            const btn = this.input(133);
            if (this.searching && !force) {
                this.searching = false;
                this.search = '';
                if (q) q.value = '';
                if (btn) { btn.innerHTML = window.vistaDialogTemplate.label('Sea&rch'); btn.disabled = true; }
            } else {
                const text = q ? q.value.trim() : '';
                if (!text) return;
                this.searching = true;
                this.search = text;
                if (btn) btn.innerHTML = window.vistaDialogTemplate.label('&Reset');
            }
            this.top = 0;
            this.cells = [];
            void this.reload();
        }

        show() {
            callGlobal('openModal', this.modal);
            this.modal.classList.remove('hidden');
            requestAnimationFrame(() => {
                const r = this.modal.getBoundingClientRect();
                callGlobal('setModalOffsetsFromViewportTopLeft', this.modal, Math.max(0, Math.round((root.innerWidth - r.width) / 2)), Math.max(0, Math.round((root.innerHeight - 35 - r.height) / 2)));
                // Vista opens with the Font box focused (its name highlighted)
                const fontBtn = this.modal.querySelector('.cm-font');
                if (fontBtn) fontBtn.focus();
            });
        }

        close() {
            this.scanToken += 1;
            this.closeGroupBy(false);
            this.closeFontList();
            try { callGlobal('closeModal', this.modal); } catch (_) { /* gone */ }
            const m = this.modal;
            setTimeout(() => m.remove(), 400);
            app = null;
        }
    }

    // the ANSI code page (1252) a character has a keystroke in
    let ansi = null;
    function ansiCode(cp) {
        if (!ansi) {
            ansi = new Map();
            try {
                const dec = new TextDecoder('windows-1252');
                for (let b = 0x80; b <= 0xFF; b += 1) ansi.set(dec.decode(new Uint8Array([b])).charCodeAt(0), b);
            } catch (_) { /* none */ }
        }
        return ansi.has(cp) ? ansi.get(cp) : null;
    }

    function readReg(name, def) {
        const r = root.melatonRegistry;
        return r ? r.get(KEY, name, def) : def;
    }

    /** charmap.exe.mui dialog 102: changing the font with characters already picked. */
    function fontChangePrompt(owner) {
        return new Promise((resolve) => {
            const T = root.vistaDialogTemplate;
            if (!T || !(root.vistaDialogTemplates || {})['charmap:102']) { resolve(true); return; }
            T.openDialog({
                id: 'melatonCharmapFontMessage',
                key: 'charmap:102',
                owner,
                icon: ICON,
                ok: (ctx) => {
                    if (ctx.get(1001) && root.melatonRegistry) void root.melatonRegistry.set(KEY, { DontShowFontChangeMessage: true });
                    resolve(true);
                },
                cancel: () => resolve(false)
            });
        });
    }

    async function openMelatonCharmap() {
        if (root.featureLoader) await root.featureLoader.loadFeature('charmap');
        await loadProbe();
        if (app && app.modal.isConnected) {
            app.show();
            return app;
        }
        app = new CharMap();
        app.show();
        return app;
    }

    root.openMelatonCharmap = openMelatonCharmap;
    root.melatonCharmap = { open: openMelatonCharmap, _test: { charName, SUBRANGES, loadNames, hasGlyph } };
})(typeof window !== 'undefined' ? window : globalThis);
