/**
 * Melaton Mobile: DreamStudio (#860). The phone's own Studio program, written for the phone on the
 * shell's stock parts. It never shows, moves or styles a desktop element: everything it reads or
 * changes goes through studioModel.js.
 *
 * Four views, one loop (write, Generate, look, adjust):
 *   home      the print in hand as a strip over the WM tabs Prompt (with the characters) | Directive
 *             (while Rentan's creative mode is on) | UC | References | Inspector (Yukimi, Nov 16)
 *   editor    one prompt field, full screen, with an edit tool bar
 *   print     the picture, full screen; the steps stream here while a print runs
 * A wide screen puts home beside the print.
 * Under home and the print the generation settings stay on a tool bar at the foot of the
 * page (Yukimi, Nov 15): Model | Drafting | Size | Prints, Datasets | Adjustments | UC, Steps |
 * Guidance | Variety+ | Rescale | Sampler | Seed. Numbers open a trackbar, the lists a drop-down
 * or a panel of check rows with their weights; Seed locks on a tap and opens its box on a hold.
 *
 * Stage 1 of #860 (the loop). While it is being built it runs beside the first phone Studio
 * (wmStudio.js); the same Settings page picks which one "Studio" opens (localStorage wmStudioNext,
 * read once at load).
 *
 * Only on phones. Styles: public/css/wm-dreamstudio.css.
 */
(function () {
    'use strict';

    if (window.uiShell !== 'mobile' || !document.documentElement.classList.contains('ui-mobile')) return;

    /* global startStudioNewSession, localGalleryPreviewUrl, localStudioPreviewUrl, localGalleryImageUrl, hideManualModal */

    const APP_ID = 'studio';
    const NEXT_KEY = 'wmStudioNext';
    const root = document.documentElement;

    const stored = (key) => { try { return localStorage.getItem(key); } catch (_) { return null; } };
    const store = (key, value) => { try { localStorage.setItem(key, value); } catch (_) { /* private mode */ } };
    // which Studio this load runs: decided once, as the shell's own version switch is
    const NEXT = stored(NEXT_KEY) === '1';
    // one layout since the home tabs (Nov 16): the old Prompt | Print tab layout is gone
    const layout = () => 'page';

    const TABS = [['prompt', 'Prompt'], ['directive', 'Directive'], ['uc', 'UC'], ['refs', 'References'], ['inspector', 'Inspector']];
    const FIELD_NAMES = { prompt: 'Prompt', uc: 'Undesired', negative: 'Inline Negative', directive: 'Directive' };
    // a prompt field: one of FIELD_NAMES, or a character's, 'c:<place>:prompt' | 'c:<place>:uc'
    const charOf = (id) => { const m = /^c:(\d+):(prompt|uc)$/.exec(String(id)); return m ? { index: Number(m[1]), part: m[2] } : null; };
    function fieldName(id) {
        const c = charOf(id);
        if (!c) return FIELD_NAMES[id] || 'Prompt';
        const who = ((read().characters || [])[c.index] || {}).name || `Character ${c.index + 1}`;
        return c.part === 'uc' ? `${who}: Undesired` : who;
    }
    function fieldValue(id) {
        const c = charOf(id);
        if (!c) return read()[id] || '';
        return ((read().characters || [])[c.index] || {})[c.part] || '';
    }
    function fieldSet(id, value) {
        const c = charOf(id);
        return change(c ? `character:${c.index}:${c.part}` : id, value);
    }
    function fieldList() {
        const out = Object.keys(FIELD_NAMES).filter((id) => id !== 'directive' || (M && M.directiveOn()));
        (read().characters || []).forEach((_, i) => out.push(`c:${i}:prompt`, `c:${i}:uc`));
        return out;
    }
    // the editor's tool bar, one row on a phone (groups wrap whole on a narrower screen): edit, then
    // Quick Access and Find, then the emphasis controls kept at the right (Yukimi, Nov 15): 'weight'
    // is the LCD (the jog wheel goes after it), then the group's menu (Trim Start, Trim End, Remove
    // Emphasis)
    // the toolbox holds the prompt tools (Lowercase, Weight Rack, Reset Emphasis), and Quick Access /
    // Find (the end of its group) when the row has no room for them; the token meter goes first when
    // room is short (drop 1), then Quick Access / Find (drop 2)
    const ED_GROUPS = [
        [['undo', 'Undo'], ['redo', 'Redo']],
        [['cut', 'Cut'], ['copy', 'Copy'], ['paste', 'Paste'], ['selectall', 'Select All']],
        [['toolbox', 'Prompt Tools'], ['quickaccess', 'Quick Access', 2], ['find', 'Find', 2]],
        { drop: 1, tools: ['tokens'] },
        ['weight', ['emmenu', 'Emphasis Group']]
    ];
    const ED_ICONS = { emmenu: 'group' };

    // the generation tool bar (Yukimi, Nov 15): three groups, each kept whole when the bar wraps
    const GEN_GROUPS = [
        [['model', 'Model', 'combo'], ['effort', 'Drafting (Medium Effort)', 'toggle', 'fas fa-feather'], ['resolution', 'Size', 'combo'], ['n', 'Prints', 'number']],
        [['dataset', 'Datasets', 'panel', 'nai-sakura'], ['subtoggle', 'Adjustments', 'panel', 'fas fa-diamond-half-stroke'], ['uc', 'UC Preset and NSFW', 'list']],
        [['steps', 'Steps', 'number'], ['guidance', 'Guidance', 'number'], ['variety', 'Variety+', 'toggle', 'fas fa-sparkle'], ['rescale', 'Rescale', 'number'], ['sampler', 'Sampler', 'combo'], ['seed', 'Seed', 'seed', 'fas fa-seedling']]
    ];
    // the numbers: their trackbar's range and step, the default the square button puts back
    const GEN_NUMBERS = {
        n: { min: 1, max: 8, step: 1, def: 1 },
        steps: { min: 1, max: 50, step: 1, def: 25 },
        // a slow roll of the jog steps a guidance by its hundredths (Yukimi, Nov 15)
        guidance: { min: 0, max: 10, step: 0.1, fineStep: 0.01, def: 5 },
        rescale: { min: 0, max: 1, step: 0.01, def: 0 }
    };
    const SEED_HOLD_MS = 500;
    // the numbers shown in seven-segment figures (Yukimi, Nov 15)
    const GEN_SEG = new Set(['n', 'steps', 'guidance', 'rescale']);

    let sh = null;
    let ui = null;
    let M = null;
    let page = null;
    let shown = false;
    let stale = true;
    let tab = 'prompt';
    let layers = [];
    let snap = null;
    let edField = 'prompt';
    let edJog = null;
    let viewing = '';
    let opening = false;
    let tabState = {};
    let directiveTab = null;

    const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const $ = (sel) => (page ? page.querySelector(sel) : null);
    const top = () => layers[layers.length - 1] || null;
    const isCurrent = () => !!(sh && sh.current === APP_ID);
    const running = () => { const r = M && M.run(); return !!(r && r.active); };

    function view() {
        if (String(top() || '').startsWith('x:')) return top();
        if (top() === 'editor') return 'editor';
        if (top() === 'presets') return 'presets';
        if (top() === 'ref') return 'ref';
        return top() || 'home';
    }

    function read() {
        if (!snap && M) snap = M.snapshot();
        return snap || {};
    }

    // ---------------------------------------------------------------- pictures

    const stem = (f) => String(f || '').replace(/\\/g, '/').split('/').pop().replace(/\.(png|jpe?g|webp)$/i, '');

    function thumbUrl(f) {
        if (!f) return '';
        return typeof localGalleryPreviewUrl === 'function' ? localGalleryPreviewUrl(`${stem(f)}.webp`) : `/previews/${encodeURIComponent(stem(f))}.webp`;
    }

    // a print asked for the instant it is saved can beat the server's display copy of it (seen on
    // the A53: the first request failed, the same address answered a moment later): its address is
    // asked again a few times, then the saved picture itself stands in
    const pictureTries = new Map();
    const pictureFull = new Set();

    function pictureFailed(img) {
        const f = img.dataset.file;
        const src = img.getAttribute('src') || '';
        if (!f || src.startsWith('data:') || pictureFull.has(f)) return;
        // an in-memory address Studio has since let go of: the picture's own address takes over
        if (src.startsWith('blob:')) { if (img.isConnected) img.src = pictureUrl(f); return; }
        const n = (pictureTries.get(f) || 0) + 1;
        pictureTries.set(f, n);
        if (n > 3) { pictureFull.add(f); if (img.isConnected) img.src = pictureUrl(f); return; }
        setTimeout(() => { if (img.isConnected && img.dataset.file === f) img.src = `${pictureUrl(f)}${pictureUrl(f).includes('?') ? '&' : '?'}again=${n}`; }, 600);
    }

    function pictureUrl(f) {
        if (!f) return '';
        // the print a generation just delivered is in memory: no request, it shows at once (on the A53
        // picture requests stood still for some seconds after a print)
        const held = M && typeof M.heldPicture === 'function' ? M.heldPicture(f) : '';
        if (held) return held;
        if (pictureFull.has(f)) return typeof localGalleryImageUrl === 'function' ? localGalleryImageUrl(f) : `/images/${encodeURIComponent(f)}`;
        const studio = typeof localStudioPreviewUrl === 'function' ? localStudioPreviewUrl(f) : '';
        if (studio) return studio;
        return typeof localGalleryImageUrl === 'function' ? localGalleryImageUrl(f) : `/images/${encodeURIComponent(f)}`;
    }

    /** The print on show: the one picked, else the newest of this visit, else the one Studio holds. */
    function shownPrint() {
        const list = M.prints();
        if (viewing && (list.includes(viewing) || viewing === M.selected())) return viewing;
        return list[list.length - 1] || M.selected() || '';
    }

    // ---------------------------------------------------------------- drawing

    function setBar(bar, pct) {
        if (!bar) return;
        if (pct == null) { bar.hidden = true; return; }
        bar.hidden = false;
        // whole 7-unit blocks with 2-unit gaps, as many as the bar holds at this percent (the shell's bar)
        const unit = 9 * (parseFloat(getComputedStyle(page).getPropertyValue('--wm-px')) || 1);
        const fit = Math.max(1, Math.floor((Math.max(0, bar.clientWidth - 2) + 2 * (unit / 9)) / unit));
        bar.style.setProperty('--wds-blocks', String(Math.round(Math.max(0, Math.min(100, pct)) / 100 * fit)));
    }

    function runText(r) {
        if (!r || !r.active) return '';
        const which = r.prints > 1 ? `Print ${Math.min(r.print, r.prints)} of ${r.prints}: ` : '';
        if (r.steps > 0 && r.step > 0) return `${which}step ${Math.min(r.step, r.steps)} of ${r.steps}`;
        if (r.phase === 'queued') return `${which}waiting in the queue`;
        if (r.phase === 'upscaling') return `${which}upscaling`;
        return `${which}starting`;
    }

    function runPct(r) {
        if (!r || !r.active) return null;
        const one = r.steps > 0 ? Math.min(1, r.step / r.steps) : 0;
        if (r.prints > 1) return ((r.files.length + (r.files.length < r.prints ? one : 0)) / r.prints) * 100;
        return one * 100;
    }

    function sizeName(group, option) {
        const name = String(option.name || option.value);
        if (group.group === 'Custom' || name.toLowerCase().includes(String(group.group).toLowerCase())) return name;
        return `${group.group} ${name}`;
    }

    function drawStrip() {
        const strip = $('.wds-strip');
        if (!strip) return;
        const r = M.run();
        const active = !!(r && r.active);
        const f = shownPrint();
        const img = strip.querySelector('img');
        const src = active && r.frame ? r.frame : thumbUrl(f);
        if (src) { if (img.getAttribute('src') !== src) img.src = src; img.hidden = false; } else { img.hidden = true; img.removeAttribute('src'); }
        const list = M.prints();
        const at = list.indexOf(f);
        strip.querySelector('b').textContent = active ? 'Generating' : (f ? (at >= 0 ? `Print ${at + 1} of ${list.length}` : 'Print') : 'No print yet');
        strip.querySelector('span').textContent = active ? runText(r) : (f ? 'Tap to view' : 'Generate makes one');
        setBar(strip.querySelector('.wds-bar'), active ? runPct(r) : null);
    }

    let tokenSeq = 0;
    function drawTokens(field, text, target) {
        if (!target) return;
        const seq = ++tokenSeq;
        target.dataset.seq = String(seq);
        if (!text) { target.textContent = ''; return; }
        M.tokens(text).then((n) => {
            if (target.dataset.seq !== String(seq)) return;
            target.textContent = n == null ? '' : `${n} tokens`;
        });
    }

    function drawHome() {
        const s = read();
        ['prompt', 'uc', 'directive'].forEach((id) => {
            const box = $(`.wds-field[data-field="${id}"]`);
            if (!box) return;
            const text = s[id] || '';
            if (box.value !== text) box.value = text;
            box.scrollTop = 0;
            drawTokens(id, text, $(`.wds-label[data-for="${id}"] > span:last-child`));
        });
        drawChars(s);
        // a part of its own may draw a tab's pane (wmDreamStudio.extend: reg.pane)
        const xpane = (id) => { const spec = ext.panes[id]; const el = page.querySelector(`.wds-tabpane[data-tab="${id}"]`); if (!spec || !el) return false; try { spec.draw(el, api); } catch (err) { console.warn('[wmDreamStudio] pane', id, err); } return true; };
        if (!xpane('refs')) {
            drawRefs(s);
            const none = $('.wds-refs-none');
            if (none) none.hidden = !!((s.references || []).length || s.hasBaseImage);
        }
        if (!xpane('inspector')) drawInspector(s);
        const base = $('.wds-base');
        if (base) {
            base.hidden = !s.hasBaseImage;
            if (s.hasBaseImage) {
                const img = base.querySelector('img');
                const src = thumbUrl(s.baseImage);
                if (src) { if (img.getAttribute('src') !== src) img.src = src; img.hidden = false; } else { img.hidden = true; img.removeAttribute('src'); }
                base.querySelector('span').textContent = `Strength ${Number(s.strength).toFixed(2)}, noise ${Number(s.noise).toFixed(2)}`;
            }
        }
        drawStrip();
    }

    // ---- references: a list on the home page; one opens as a small form (type, strength, fidelity)

    const REF_TYPES = [[1, 'Character and Style'], [2, 'Character'], [3, 'Style']];
    let refAt = 0;

    function drawRefs(s) {
        const box = $('.wds-refs');
        if (!box) return;
        const list = s.references || [];
        box.hidden = !list.length;
        if (!list.length) { box.textContent = ''; return; }
        const name = (t) => (REF_TYPES.find((x) => x[0] === t) || REF_TYPES[0])[1];
        box.innerHTML = `<div class="wds-label"><span>References</span><span></span></div><div class="wm-listbox">${list.map((r, i) => `<button type="button" class="wm-listbox-row wds-refrow" data-ref="${i}">${r.file ? `<img alt="" src="${esc(thumbUrl(r.file))}">` : ''}<span>${esc(name(r.type))}, strength ${Number(r.strength).toFixed(2)}</span></button>`).join('')}</div>`;
    }

    function refList() { return (read().references || []).map((r) => Object.assign({}, r)); }

    function refChange(patch) {
        const list = refList();
        if (!list[refAt]) return Promise.resolve();
        Object.assign(list[refAt], patch);
        snap = null;
        return M.setReferences(list);
    }

    function drawRef() {
        const host = $('.wds-ref > .wm-form');
        const r = (read().references || [])[refAt];
        if (!host || !ui) return;
        if (!r) { host.textContent = ''; return; }
        if (host.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
        const type = REF_TYPES.find((x) => x[0] === r.type) || REF_TYPES[0];
        host.innerHTML = (r.file ? `<img class="wds-ref-pic" alt="" src="${esc(pictureUrl(r.file))}">` : '')
            + ui.row('Use its:', ui.comboHtml('type', type[1]))
            + ui.row('Strength:', ui.edit('', Number(r.strength).toFixed(2), 'data-ref-set="strength" inputmode="decimal"'))
            + ui.row('Fidelity:', ui.edit('', Number(r.fidelity).toFixed(2), 'data-ref-set="fidelity" inputmode="decimal"'));
        ui.bindCombo(host.querySelector('.wm-combo'), REF_TYPES, type[0], (v) => refChange({ type: v }));
    }

    function addReference() {
        if ((read().references || []).length >= 6) { sh.messageBox({ title: 'DreamStudio', text: 'A session holds six references at most.', icon: 'info', modal: true }); return; }
        choosePicture('Add Reference', (f) => {
            const list = refList();
            list.push({ file: f, type: 1, strength: 1, fidelity: 1 });
            snap = null;
            Promise.resolve(M.setReferences(list)).then(() => { layers = []; tab = 'refs'; if (sh.current !== APP_ID) sh.open(APP_ID); snap = null; paint(); });
        });
    }

    function removeReference() {
        const list = refList();
        list.splice(refAt, 1);
        snap = null;
        Promise.resolve(M.setReferences(list)).then(() => { if (top() === 'ref') layers.pop(); snap = null; paint(); sh.syncHistory(); });
    }

    // ---- presets: Open Preset is a list page; Save as Preset asks for the name

    // the list is shown a page at a time, in rows a finger can hit: as many as the page holds
    let presetPage = 0;
    let presetPages = 1;

    function drawPresets() {
        const pane = $('.wds-presets');
        const box = $('.wds-presets > .wm-listbox');
        const none = $('.wds-presets > .wds-none');
        const foot = $('.wds-presets > .wds-pager');
        if (!box) return;
        const names = M.presets();
        const cur = M.sessionName();
        none.hidden = names.length > 0;
        box.hidden = !names.length;
        foot.hidden = !names.length;
        if (!names.length) { box.textContent = ''; presetPages = 1; return; }
        const unit = parseFloat(getComputedStyle(page).getPropertyValue('--wm-px')) || 1;
        const rowH = 26 * unit;
        const room = pane.clientHeight - foot.offsetHeight;
        const per = Math.max(1, Math.floor(room / rowH));
        presetPages = Math.max(1, Math.ceil(names.length / per));
        presetPage = Math.max(0, Math.min(presetPages - 1, presetPage));
        box.innerHTML = names.slice(presetPage * per, presetPage * per + per).map((n) => `<button type="button" class="wm-listbox-row${n === cur ? ' is-selected' : ''}" data-key="${esc(n)}"><span>${esc(n)}</span></button>`).join('');
        foot.textContent = `Page ${presetPage + 1} of ${presetPages}`;
    }

    function presetStep(dir) {
        const next = Math.max(0, Math.min(presetPages - 1, presetPage + dir));
        if (next === presetPage) return;
        presetPage = next;
        drawPresets();
        sh.refreshSoftKeys();
    }

    /** Opens the list on the page that holds the session's own preset. */
    function showPresets() {
        presetPage = 0;
        openLayer('presets');
        const names = M.presets();
        const at = names.indexOf(M.sessionName());
        const rows = $('.wds-presets > .wm-listbox').children.length;
        if (at >= 0 && rows > 0) { presetPage = Math.floor(at / rows); drawPresets(); sh.refreshSoftKeys(); }
    }

    function openPreset(name) {
        layers = [];
        tab = 'prompt';
        viewing = '';
        sh.busy(M.openPreset(name).catch((err) => console.warn('[wmDreamStudio] preset', err)), { delay: 250 }).then(() => { snap = null; paint(); sh.syncHistory(); });
    }

    function savePresetAs() {
        sh.messageBox({ title: 'Save as Preset', text: 'Name:', input: { value: M.sessionName() }, modal: true, buttons: [{ text: 'Save', value: true, default: true }, { text: 'Cancel', value: false }], cancelValue: false })
            .then((name) => {
                if (!name) return null;
                if (!M.presets().includes(name)) return name;
                return sh.messageBox({ title: 'Save as Preset', text: `A preset named "${name}" already exists. Replace it?`, icon: 'question', modal: true, buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false, default: true }], cancelValue: false }).then((yes) => (yes ? name : null));
            })
            .then((name) => { if (name) sh.busy(M.savePreset(name).catch((err) => console.warn('[wmDreamStudio] save', err)), { delay: 250 }); });
    }

    /** Characters: one row each (in use or not, name, first words); a tap on the text edits it. */
    function drawChars(s) {
        const box = $('.wds-chars');
        if (!box) return;
        const list = s.characters || [];
        box.hidden = !list.length;
        if (!list.length) { box.textContent = ''; return; }
        box.innerHTML = `<div class="wds-label"><span>Characters</span><span></span></div><div class="wm-listbox">${list.map((c, i) => `<div class="wm-listbox-row wds-char${c.enabled ? '' : ' is-off'}" data-char="${i}"><label class="wm-check"><input type="checkbox" data-char="${i}"${c.enabled ? ' checked' : ''} aria-label="Use ${esc(c.name || `Character ${i + 1}`)}"><span></span></label><button type="button" class="wds-char-open" data-char="${i}"><b>${esc(c.name || `Character ${i + 1}`)}</b> ${esc(c.prompt || '')}</button></div>`).join('')}</div>`;
    }

    function addCharacter() {
        const i = M.addCharacter();
        snap = null;
        if (i >= 0) openEditor(`c:${i}:prompt`); else paint();
    }

    function renameCharacter(i) {
        const cur = ((read().characters || [])[i] || {}).name || `Character ${i + 1}`;
        sh.messageBox({ title: 'Rename Character', text: 'Name:', input: { value: cur }, modal: true, buttons: [{ text: 'ok', value: true, default: true }, { text: 'Cancel', value: false }], cancelValue: false })
            .then((name) => { if (name) { M.setCharacter(i, { name }); snap = null; paint(); if (top() === 'editor') edLoad(); } });
    }

    function removeCharacter(i) {
        const cur = ((read().characters || [])[i] || {}).name || `Character ${i + 1}`;
        sh.messageBox({ title: 'DreamStudio', text: `Remove ${cur} from this session?`, icon: 'question', modal: true, buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false, default: true }], cancelValue: false })
            .then((yes) => {
                if (!yes) return;
                // the editor may be on this character: leave it without writing the text back
                if (top() === 'editor' && charOf(edField)) { acHide(); layers.pop(); sh.syncHistory(); }
                M.removeCharacter(i);
                snap = null;
                paint();
            });
    }

    function drawPrint() {
        const stage = $('.wds-stage');
        if (!stage) return;
        const r = M.run();
        const active = !!(r && r.active);
        const img = stage.querySelector(':scope > img');
        const grid = stage.querySelector('.wds-grid');
        const empty = stage.querySelector('.wds-empty');
        const status = $('.wds-status');
        // several prints in one run: the grid fills as they land, and stays until one is opened
        const many = r && r.prints > 1 && (active || (!viewing && r.files.length > 1));
        grid.hidden = !many;
        if (many) {
            const cells = [];
            for (let i = 0; i < r.prints; i += 1) {
                const f = r.files[i];
                const live = !f && active && i === r.files.length && r.frame;
                cells.push(`<button type="button" data-file="${esc(f || '')}"${f ? '' : ' disabled'}>${f ? `<img alt="" data-file="${esc(f)}" src="${esc(pictureUrl(f))}">` : (live ? `<img alt="" src="${esc(r.frame)}">` : esc(String(i + 1)))}</button>`);
            }
            // as many columns as keep the cells near the screen's own shape
            const tall = stage.clientHeight >= stage.clientWidth;
            const cols = tall ? (r.prints <= 2 ? 1 : 2) : (r.prints <= 2 ? 2 : r.prints <= 6 ? 3 : 4);
            grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
            grid.innerHTML = cells.join('');
        } else {
            grid.textContent = '';
        }
        const f = shownPrint();
        const src = many ? '' : (active ? (r.frame || pictureUrl(f)) : pictureUrl(f));
        const live = active && !!r.frame;
        const key = live ? '' : (src ? f : '');
        if (src) {
            if (live ? img.getAttribute('src') !== src : (img.dataset.file !== key || !img.getAttribute('src') || img.getAttribute('src').startsWith('data:'))) img.src = src;
            img.dataset.file = key;
            img.hidden = false;
        } else { img.hidden = true; img.removeAttribute('src'); img.dataset.file = ''; }
        img.style.opacity = active && !r.frame && !many ? '0.35' : '';
        empty.hidden = !!src || many;
        status.hidden = !active;
        if (active) {
            status.querySelector('span').textContent = `Generating: ${runText(r)}`;
            setBar(status.querySelector('.wds-bar'), runPct(r));
        }
    }

    /** The home tabs: Directive only while Rentan's creative mode is on (as on the desktop). */
    function drawTabs() {
        const strip = $('.wds-home-strip');
        if (!strip || !M) return;
        const on = M.directiveOn();
        if (tab === 'directive' && !on) tab = 'prompt';
        // a tab that is not offered leaves the strip (fitTabs uses hidden for tabs that do not fit,
        // and a hidden last tab loses the 6.5 strip's closing curve)
        if (!directiveTab) directiveTab = strip.querySelector('[data-tab="directive"]');
        if (directiveTab) {
            if (on && !directiveTab.isConnected) strip.querySelector('[data-tab="prompt"]').after(directiveTab);
            else if (!on && directiveTab.isConnected) directiveTab.remove();
        }
        strip.querySelectorAll('.wm-tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
        page.querySelectorAll('.wds-tabpane').forEach((p) => p.classList.toggle('is-current', p.dataset.tab === tab));
        if (view() === 'home' && window.wmSettings && typeof window.wmSettings.fitTabs === 'function' && strip.getClientRects().length) {
            window.wmSettings.fitTabs(strip, tabState);
        }
    }

    // ---- the Inspector tab: the seed and its lock, the Genso seeds (the expanders' picks of the
    // last print) each with its lock, Lock All / Unlock All

    function drawInspector(s) {
        const box = $('.wds-insp');
        if (!box || !ui) return;
        const seeds = M.gensoSeeds();
        const kept = !!s.seedLock;
        box.innerHTML = '<div class="wm-form-sub">Seed</div>'
            + `<div class="wds-wt-row is-on"><span class="wds-wt-name">${esc(kept ? 'Kept' : 'Random')}</span><span class="wds-wt-lcd wm-lcd wds-insp-seed"></span><button type="button" class="wm-tool" data-insp="seed" aria-pressed="${kept}" aria-label="Keep this seed" title="Keep this seed">${toolIcon(kept ? 'fas fa-lock' : 'fas fa-seedling')}</button></div>`
            + `<div class="wm-form-sub wds-insp-head"><span>Genso</span>${seeds.length ? '<button type="button" class="wm-button" data-insp="lockall">Lock All</button><button type="button" class="wm-button" data-insp="unlockall">Unlock All</button>' : ''}</div>`
            + (seeds.length
                ? seeds.map((g, i) => `<div class="wds-wt-row wds-insp-row"><label class="wm-check"><input type="checkbox" data-genso="${i}"${g.locked ? ' checked' : ''}${g.canLock ? '' : ' disabled'}><span><b>${esc(g.key)}</b> ${esc(g.value)}</span></label></div>`).join('')
                : '<p class="wds-none">No Genso yet: expanders used in a print show their picks here.</p>');
        const seed = String(s.seedText || (kept ? s.seed : '') || '');
        ui.segText(box.querySelector('.wds-insp-seed'), seed ? seed.padStart(10, '!') : '!!!!!!!!!!');
        box._seeds = seeds;
    }

    function paint() {
        if (!page || !M) return;
        if (!shown) { stale = true; return; }
        stale = false;
        const v = view();
        page.dataset.view = v.startsWith('x:') ? 'x' : v;
        page.dataset.xview = v.startsWith('x:') ? v.slice(2) : '';
        page.querySelectorAll('.wds-xview').forEach((el) => el.classList.toggle('is-current', v === `x:${el.dataset.xview}`));
        const box = v === 'editor' ? boxOf(edField) : null;
        page.dataset.ed = v === 'editor' ? (box ? 'box' : 'own') : '';
        page.querySelectorAll('.wds-field').forEach((b) => b.classList.toggle('is-editing', b === box));
        if (v === 'home' || v === 'print') { drawHome(); drawPrint(); }
        if (v === 'presets') drawPresets();
        if (v === 'ref') drawRef();
        hlDraw();
        if (v.startsWith('x:')) {
            const spec = ext.views[v.slice(2)];
            const el = page.querySelector(`.wds-xview[data-xview="${v.slice(2)}"]`);
            if (spec && el && spec.draw) { try { spec.draw(el, api); } catch (err) { console.warn('[wmDreamStudio] view', v, err); } }
        }
        if (v === 'home' || v === 'print') drawGenbar();
        else if (ui) ui.closePopPanels();
        drawTabs();
        const xspec = v.startsWith('x:') ? ext.views[v.slice(2)] : null;
        sh.setTitle(xspec ? (typeof xspec.title === 'function' ? xspec.title() : xspec.title || 'DreamStudio') : v === 'editor' ? fieldName(edField) : (v === 'ref' ? 'Reference' : v === 'presets' ? 'Open Preset' : 'DreamStudio'));
        sh.refreshTitleAction();
        sh.refreshSoftKeys();
        extHook('paint', v);
    }

    // ---------------------------------------------------------------- changes

    function change(id, value) {
        snap = null;
        return Promise.resolve(M.set(id, value)).catch((err) => console.warn('[wmDreamStudio] set', id, err));
    }

    // ---------------------------------------------------------------- layers

    function openLayer(name) {
        if (top() === name) return;
        layers.push(name);
        paint();
        sh.syncHistory();
    }

    function popLayer() {
        if (!layers.length) return false;
        if (top() === 'editor') { closeEditor(); return true; }
        layers.pop();
        paint();
        sh.syncHistory();
        return true;
    }

    // ---------------------------------------------------------------- editor

    /**
     * The field being edited. Prompt and Undesired are edited in their own boxes on the home page:
     * the box that was touched grows to fill the page and keeps the focus it got from that touch,
     * which is what Android raises its keyboard for (a field focused from script as the first one
     * after a cold start gets none; seen on the A53). The other fields (a character's, the inline
     * negative) have no box there and use the editor's own field.
     */
    const boxOf = (field) => (field === 'prompt' || field === 'uc' || field === 'directive' ? $(`.wds-field[data-field="${field}"]`) : null);
    function edArea() { return (top() === 'editor' && boxOf(edField)) || $('.wds-ed-text'); }

    function edCount() {
        const ta = edArea();
        const out = $('.wds-ed-head > span');
        if (ta && out) drawTokens(edField, ta.value, out);
        // the bar's count and meter (the desktop's token bar): the field's own words and what Studio
        // adds to them (quality and dataset tags), of the model's limit; a warning near the limit, an
        // error over it. With it on the bar the count leaves the head
        const box = $('.wds-tb-tokens');
        const shownOnBar = !!(ta && box && box.offsetParent);
        if (out) out.hidden = shownOnBar;
        if (!shownOnBar) return;
        const seq = String(++tokenSeq);
        box.dataset.seq = seq;
        const added = edField === 'prompt' || edField === 'uc' ? M.addedTokens(edField) : 0;
        Promise.resolve(ta.value ? M.tokens(ta.value) : 0).then((own) => {
            if (box.dataset.seq !== seq) return;
            const limit = M.tokenLimit() || 512;
            const n = own == null ? null : own + added;
            box.children[1].textContent = n == null ? '' : `${n}/${limit}`;
            const level = n == null ? '' : n > limit ? 'over' : n >= limit * 0.85 ? 'near' : '';
            box.dataset.level = level;
            const icon = box.querySelector('i');
            if (icon) icon.className = level === 'over' ? 'fas fa-circle-exclamation wm-icon-error' : 'fas fa-triangle-exclamation wm-icon-warn';
            setBar(box.querySelector('.wds-bar'), n == null ? 0 : Math.min(100, (n / limit) * 100));
        });
    }

    function edLoad() {
        const ta = edArea();
        if (!ta) return;
        ta.value = fieldValue(edField);
        const label = $('.wds-ed-head > .wm-combo > span');
        if (label) label.textContent = fieldName(edField);
        edCount();
        edWeight();
    }

    function edCommit() {
        const ta = edArea();
        if (!ta) return Promise.resolve();
        if (fieldValue(edField) === ta.value) return Promise.resolve();
        return fieldSet(edField, ta.value);
    }

    function openEditor(field) {
        edField = FIELD_NAMES[field] || charOf(field) ? field : 'prompt';
        if (top() !== 'editor') layers.push('editor');
        paint();
        const ta = edArea();
        // a box that was touched already has the focus and the caret where the finger went
        const touched = !!ta && document.activeElement === ta && ta === boxOf(edField);
        if (!touched) edLoad(); else { const label = $('.wds-ed-head > .wm-combo > span'); if (label) label.textContent = fieldName(edField); edCount(); edWeight(); }
        if (ta && !touched) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
        sh.syncHistory();
    }

    function closeEditor() {
        acHide();
        const ta = edArea();
        if (ta) ta.blur();
        edCommit().then(() => {
            if (top() === 'editor') layers.pop();
            paint();
            sh.syncHistory();
        });
    }

    function edSwitch(field) {
        if (field === edField) return;
        edCommit().then(() => {
            edField = field;
            snap = null;
            paint();
            edLoad();
            sh.setTitle(fieldName(edField));
            const ta = edArea();
            if (ta) ta.focus();
        });
    }

    function edCommand(id) {
        const ta = edArea();
        if (!ta) return;
        ta.focus();
        if (id === 'selectall') { ta.select(); return; }
        if (id === 'paste') {
            // execCommand('paste') is blocked in pages; the async clipboard asks once
            if (navigator.clipboard && navigator.clipboard.readText) {
                navigator.clipboard.readText().then((text) => { ta.focus(); document.execCommand('insertText', false, text); edCount(); }).catch(() => {});
            }
            return;
        }
        if (id === 'clear') { ta.select(); document.execCommand('delete'); edCount(); return; }
        if (id === 'weightdown' || id === 'weightup') { stepWeight(id === 'weightup' ? 1 : -1); return; }
        if (id === 'find') { findAsk(); return; }
        if (id === 'trimstart' || id === 'trimend' || id === 'emremove') { groupEdit(id); return; }
        if (id === 'quickaccess') { openQa(); return; }
        document.execCommand(id);
        edCount();
    }

    // ---- emphasis: a weighted group is written `1.2::text::`; - and + step the group the caret is
    // in, or make one of the selection (no selection: of the tag under the caret)

    const WEIGHT_RE = /(-?\d+(?:\.\d+)?)::([\s\S]*?)::/g;

    function weightAt(text, start, end) {
        WEIGHT_RE.lastIndex = 0;
        let m;
        while ((m = WEIGHT_RE.exec(text))) {
            const from = m.index;
            const to = from + m[0].length;
            if (start >= from && end <= to) return { from, to, weight: Number(m[1]), inner: m[2], innerFrom: from + m[1].length + 2 };
        }
        return null;
    }

    /** The tag under the caret: between the commas / line ends around it, without its outer spaces. */
    function tagAt(text, pos) {
        let from = Math.max(text.lastIndexOf(',', pos - 1), text.lastIndexOf('\n', pos - 1)) + 1;
        let to = text.length;
        [',', '\n'].forEach((ch) => { const i = text.indexOf(ch, pos); if (i >= 0 && i < to) to = i; });
        while (from < to && /\s/.test(text[from])) from += 1;
        while (to > from && /\s/.test(text[to - 1])) to -= 1;
        return to > from ? { from, to } : null;
    }

    const fmtWeight = (w) => String(Number(w.toFixed(2)));

    function stepWeight(dir, fine = false) {
        const by = fine ? 0.01 : 0.1;
        const ta = edArea();
        if (!ta) return;
        ta.focus();
        const text = ta.value;
        const hit = weightAt(text, ta.selectionStart, ta.selectionEnd);
        let from; let to; let inner; let next;
        if (hit) {
            ({ from, to, inner } = hit);
            next = Math.round((hit.weight + dir * by) * 100) / 100;
        } else {
            const range = ta.selectionStart !== ta.selectionEnd ? { from: ta.selectionStart, to: ta.selectionEnd } : tagAt(text, ta.selectionStart);
            if (!range) return;
            ({ from, to } = range);
            inner = text.slice(from, to);
            next = Math.round((1 + dir * by) * 100) / 100;
        }
        next = Math.max(-3, Math.min(5, next));
        // a step across zero stops on it (the jog's stop at zero)
        if (hit && ((hit.weight > 0 && next < 0) || (hit.weight < 0 && next > 0))) next = 0;
        // back at 1 the group is plain text again
        const plain = Math.abs(next - 1) < 0.001;
        const out = plain ? inner : `${fmtWeight(next)}::${inner}::`;
        ta.setSelectionRange(from, to);
        document.execCommand('insertText', false, out);
        const at = plain ? from : from + fmtWeight(next).length + 2;
        ta.setSelectionRange(at, at + inner.length);
        edWeight();
        edCount();
    }

    function edWeight() {
        const ta = edArea();
        const out = $('.wds-tb-weight');
        if (!ta || !out) return;
        const hit = weightAt(ta.value, ta.selectionStart, ta.selectionEnd);
        const w = hit ? hit.weight : 1;
        if (ui && typeof ui.segText === 'function') ui.segText(out, w.toFixed(2), { signed: true }); else out.textContent = w.toFixed(2);
        hlDraw();
        // the readout takes the strength's colour (Yukimi, Nov 15): up towards orange and red, down
        // towards blue, all of it by 2 / 0
        const level = Math.max(-1, Math.min(1, w - 1));
        out.dataset.tone = level > 0.001 ? 'up' : level < -0.001 ? 'down' : '';
        out.style.setProperty('--wm-lcd-strength', Math.abs(level).toFixed(3));
    }

    // ---- emphasis highlighting: a copy of the field's text behind it (same box, font and wrap, its
    // letters clear) where each weighted group is a mark in its strength's colour (wm-programs.css
    // .wm-emph); the field's own background is clear while it is edited

    function hlDraw() {
        const hl = $('.wds-hl');
        if (!hl) return;
        const ta = top() === 'editor' ? edArea() : null;
        if (!ta || !ta.getClientRects().length) { if (!hl.hidden) { hl.hidden = true; hl.textContent = ''; hl.dataset.src = ''; } return; }
        const body = $('.wds-body');
        const br = body.getBoundingClientRect();
        const r = ta.getBoundingClientRect();
        const cs = getComputedStyle(ta);
        ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'wordSpacing', 'textIndent', 'tabSize',
            'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth'].forEach((k) => { if (hl.style[k] !== cs[k]) hl.style[k] = cs[k]; });
        hl.style.left = `${r.left - br.left}px`;
        hl.style.top = `${r.top - br.top}px`;
        // the field's scroll bar takes from its width: the copy wraps where the text does
        hl.style.width = `${ta.clientWidth + parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth)}px`;
        hl.style.height = `${r.height}px`;
        const text = ta.value;
        let html = '';
        let at = 0;
        WEIGHT_RE.lastIndex = 0;
        let m;
        while ((m = WEIGHT_RE.exec(text))) {
            const level = Math.max(-1, Math.min(1, Number(m[1]) - 1));
            const tone = level > 0.001 ? 'up' : level < -0.001 ? 'down' : '';
            html += esc(text.slice(at, m.index)) + `<mark class="wm-emph" data-tone="${tone}" data-strength="${Math.abs(level).toFixed(3)}">${esc(m[0])}</mark>`;
            at = m.index + m[0].length;
        }
        // a last empty line keeps its height
        html += `${esc(text.slice(at))} `;
        if (hl.dataset.src !== html) {
            hl.dataset.src = html;
            hl.innerHTML = html;
            hl.querySelectorAll('mark[data-strength]').forEach((k) => k.style.setProperty('--wm-emph-strength', k.dataset.strength));
        }
        hl.hidden = false;
        hl.scrollTop = ta.scrollTop;
    }

    /** The weight of the group the caret is in (1 outside one): the emphasis jog's stop at zero reads it. */
    function caretWeight() {
        const ta = edArea();
        const hit = ta ? weightAt(ta.value, ta.selectionStart, ta.selectionEnd) : null;
        return hit ? hit.weight : 1;
    }

    /**
     * The toolbox (the desktop's Prompt Tools): Quick Access and Find when the bar has no room for
     * them, Lowercase, Syntax Handling, Reset Emphasis, and the parts' rows (Weight Rack, Rentan).
     */
    function toolboxMenu(btn) {
        const ta = edArea();
        const hasGroups = !!ta && new RegExp(WEIGHT_RE.source).test(ta.value);
        const rows = [];
        // Quick Access and Find are offered here only when the bar has no room for them (each one
        // looked at as it is now, never twice on screen)
        const onBar = (id) => { const b = $(`.wds-toolbar [data-ed="${id}"]`); return !!(b && !b.hidden && b.getClientRects().length); };
        if (!onBar('quickaccess')) rows.push({ label: 'Quick Access...', action: openQa });
        if (!onBar('find')) rows.push({ label: 'Find...', action: findAsk });
        if (rows.length) rows.push('-');
        rows.push(
            { label: 'Lowercase', disabled: !ta || !ta.value, action: lowercaseText },
            { label: 'Syntax Handling...', action: syntaxDialog },
            '-',
            { label: 'Reset Emphasis...', disabled: !hasGroups, action: resetEmphasis }
        );
        const more = extRows('toolbox');
        if (more.length) rows.push('-', ...more);
        sh.dropdown(btn, rows, 'left');
    }

    /** The whole text in lower case, a 'Text:' left as written (the desktop's Lowercase); Undo takes it back. */
    function lowercaseText() {
        const ta = edArea();
        if (!ta || !ta.value) return;
        const out = ta.value.split(/\btext:/i).map((part, i) => (i === 0 ? part.toLowerCase() : `Text:${part.toLowerCase()}`)).join('');
        if (out === ta.value) return;
        const a = ta.selectionStart;
        const b = ta.selectionEnd;
        ta.focus();
        ta.select();
        document.execCommand('insertText', false, out);
        ta.setSelectionRange(Math.min(a, out.length), Math.min(b, out.length));
        edWeight();
        edCount();
    }

    /** Every weighted group back to plain text, after a question (the desktop's Reset Emphasis). */
    function resetEmphasis() {
        sh.messageBox({ title: 'Reset Emphasis', text: 'Remove every emphasis weight from this prompt?', icon: 'question', modal: true, buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false, default: true }], cancelValue: false })
            .then((yes) => {
                const ta = edArea();
                if (!yes || !ta) return;
                const out = ta.value.replace(new RegExp(WEIGHT_RE.source, 'g'), '$2');
                if (out === ta.value) return;
                ta.focus();
                ta.select();
                document.execCommand('insertText', false, out);
                ta.setSelectionRange(out.length, out.length);
                edWeight();
                edCount();
            });
    }

    /** The emphasis group's menu, from its bar button: the tools for the group the caret is in. */
    function emphasisMenu(btn) {
        const ta = edArea();
        const hit = ta ? weightAt(ta.value, ta.selectionStart, ta.selectionEnd) : null;
        sh.dropdown(btn, [
            { label: 'Trim Start', disabled: !hit, action: () => groupEdit('trimstart') },
            { label: 'Trim End', disabled: !hit, action: () => groupEdit('trimend') },
            '-',
            { label: 'Remove Emphasis', disabled: !hit, action: () => groupEdit('emremove') }
        ], btn.getBoundingClientRect().left > window.innerWidth / 2 ? 'right' : 'left');
    }

    /**
     * The group under the caret: Trim Start / Trim End move its first / last tag out of it (a group
     * of one tag is left plain), Remove Emphasis leaves its text plain. Undo takes it back.
     */
    function groupEdit(id) {
        const ta = edArea();
        if (!ta) return;
        ta.focus();
        const hit = weightAt(ta.value, ta.selectionStart, ta.selectionEnd);
        if (!hit) return;
        const w = fmtWeight(hit.weight);
        const parts = hit.inner.split(',');
        let out;
        let caret;
        if (id === 'emremove' || parts.length < 2) {
            out = hit.inner;
            caret = hit.from;
        } else if (id === 'trimstart') {
            const first = parts[0].trim();
            const rest = parts.slice(1).join(',').replace(/^\s+/, '');
            out = `${first}, ${w}::${rest}::`;
            caret = hit.from + first.length + 2 + w.length + 2;
        } else {
            const last = parts[parts.length - 1].trim();
            const rest = parts.slice(0, -1).join(',').replace(/\s+$/, '');
            out = `${w}::${rest}::, ${last}`;
            caret = hit.from + w.length + 2;
        }
        ta.setSelectionRange(hit.from, hit.to);
        document.execCommand('insertText', false, out);
        ta.setSelectionRange(caret, caret);
        edWeight();
        edCount();
    }

    // ---- Quick Access (the desktop's tag library) as a dense WM dialog over the editor (Yukimi, Nov 15:
    // density first): the breadcrumbs (a tap goes back to a level; scrolled to the current one), Back
    // beside the find box, then the rows (groups to open, tags to put in), ten in view, scrolling. Back and the phone's Back key
    // step out to the list before, X closes it. A tag goes in at the caret the
    // editor had, with the commas around it, and the dialog closes

    let qaDlg = null;
    let qaStack = [];
    let qaRows = [];
    let qaQuery = '';
    let qaSeq = 0;
    let qaBusy = false;
    let qaCaret = null;
    let qaTimer = 0;

    const qaTitle = () => (qaQuery ? 'Find Tag' : (qaStack.length ? qaStack[qaStack.length - 1].label : 'Quick Access'));
    const qaQ = (sel) => (qaDlg ? qaDlg.querySelector(sel) : null);

    function openQa() {
        if (qaDlg) return;
        const ta = edArea();
        if (ta) qaCaret = { start: ta.selectionStart, end: ta.selectionEnd };
        acHide();
        if (ta) ta.blur();
        qaStack = [];
        qaQuery = '';
        const host = document.getElementById('wmShell') || document.body;
        qaDlg = document.createElement('div');
        qaDlg.className = 'wm-msgbox-layer wds-qadlg';
        qaDlg.innerHTML = `<div class="wm-msgbox" role="dialog" aria-modal="true" aria-label="Quick Access">
<div class="wm-msgbox-title"><span></span><button type="button" class="wm-title-action" data-kind="close" aria-label="Close"></button></div>
<div class="wds-qa-crumbs"></div>
<div class="wds-qa-search"><button type="button" class="wm-button" data-qa="back">Back</button><input class="wm-edit" type="text" autocomplete="off" spellcheck="false" autocapitalize="off" placeholder="Find a tag" aria-label="Find a tag"></div>
<div class="wm-listbox"></div><p class="wds-none" hidden></p>
</div>`;
        host.appendChild(qaDlg);
        qaDlg.querySelector('.wm-title-action').addEventListener('click', () => closeQa(true));
        qaDlg.querySelector('.wm-msgbox').addEventListener('click', (e) => {
            const b = e.target.closest && e.target.closest('[data-qa]');
            if (!b || b.disabled) return;
            if (b.dataset.qa === 'back') { qaBack(); return; }
            // a breadcrumb goes back to that level
            if (b.dataset.qa === 'crumb') { const n = Number(b.dataset.n) || 0; if (qaQuery) { qaQuery = ''; const f = qaQ('.wds-qa-search .wm-edit'); if (f) f.value = ''; } qaStack = qaStack.slice(0, n); qaLoad(); }
        });
        qaDlg.querySelector('.wm-listbox').addEventListener('click', (e) => { const r = e.target.closest && e.target.closest('.wds-qa-row'); if (r) qaPick(Number(r.dataset.i)); });
        const box = qaQ('.wds-qa-search .wm-edit');
        box.addEventListener('input', () => {
            clearTimeout(qaTimer);
            qaTimer = setTimeout(() => { const q = box.value.trim(); const next = q.length >= 2 ? q : ''; if (next === qaQuery) return; qaQuery = next; qaLoad(); }, 350);
        });
        box.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); box.blur(); } });
        sh.refreshTitleAction();
        sh.syncHistory();
        qaLoad();
    }

    /** Closes the dialog; back to the editor with its caret where it was (refocus: a tag went in or X). */
    function closeQa(refocus) {
        if (!qaDlg) return;
        qaSeq += 1;
        clearTimeout(qaTimer);
        qaDlg.remove();
        qaDlg = null;
        sh.refreshTitleAction();
        sh.syncHistory();
        if (!refocus) return;
        const ta = edArea();
        if (!ta) return;
        ta.focus();
        const len = ta.value.length;
        const c = qaCaret || { start: len, end: len };
        ta.setSelectionRange(Math.min(c.start, len), Math.min(c.end, len));
    }

    /** Back: out of a search, else up a level, else the dialog closes. */
    function qaBack() {
        if (qaQuery) { qaQuery = ''; const box = qaQ('.wds-qa-search .wm-edit'); if (box) box.value = ''; qaLoad(); return true; }
        if (qaStack.length) { qaStack.pop(); qaLoad(); return true; }
        closeQa(true);
        return true;
    }

    function qaLoad() {
        const seq = ++qaSeq;
        qaBusy = true;
        drawQa();
        const at = qaStack[qaStack.length - 1];
        let job;
        if (qaQuery) job = M.searchTags(qaQuery).then((list) => list.map((x) => ({ type: 'tag', label: x.tag, tag: x.tag, note: x.path.join(' > ') })));
        else if (!at || at.kind === 'groups') {
            job = M.tagGroups(at ? at.path : []).then((r) => r.groups.map((g) => Object.assign({ type: 'group' }, g)).concat(r.tags.map((t) => ({ type: 'tag', label: t.label, tag: t.name, count: t.count }))));
        } else {
            job = M.tagsAt(at.kind === 'main' ? at.path.concat('main') : at.path).then((list) => list.map((t) => ({ type: 'tag', label: t, tag: t })));
        }
        Promise.resolve(job).catch((err) => { console.warn('[wmDreamStudio] quick access', err); return []; }).then((rows) => {
            if (seq !== qaSeq || !qaDlg) return;
            qaBusy = false;
            qaRows = rows;
            drawQa();
        });
    }

    function drawQa() {
        if (!qaDlg) return;
        qaQ('.wm-msgbox-title > span').textContent = 'Quick Access';
        // the breadcrumbs: each level opened (a tap goes back to it), scrolled to show the current one
        const crumbs = qaQ('.wds-qa-crumbs');
        const trail = [{ label: 'All', n: 0 }].concat(qaStack.map((x, i) => ({ label: x.label, n: i + 1 })));
        crumbs.innerHTML = trail.map((c, i) => `${i ? '<span aria-hidden="true">&gt;</span>' : ''}<button type="button" data-qa="crumb" data-n="${c.n}"${!qaQuery && i === trail.length - 1 ? ' aria-current="true"' : ''}>${esc(c.label)}</button>`).join('') + (qaQuery ? `<span aria-hidden="true">&gt;</span><b>Find: ${esc(qaQuery)}</b>` : '');
        crumbs.scrollLeft = crumbs.scrollWidth;
        const box = qaQ('.wm-listbox');
        const none = qaQ('.wds-none');
        const empty = !qaBusy && !qaRows.length;
        none.hidden = !(qaBusy || empty);
        none.textContent = qaBusy ? 'Loading...' : (qaQuery ? `No tags match "${qaQuery}".` : 'Nothing here.');
        box.hidden = qaBusy || empty;
        if (qaBusy || empty) box.textContent = '';
        else {
            const icon = { group: 'fas fa-folder', tag: 'fas fa-tag' };
            box.innerHTML = qaRows.map((r, i) => {
                const right = r.note ? `<small>${esc(r.note)}</small>` : (r.count != null ? `<small>${esc(String(r.count))}</small>` : '');
                return `<button type="button" class="wm-listbox-row wds-qa-row is-${r.type}" data-i="${i}">${toolIcon(icon[r.type])}<span>${esc(r.label)}</span>${right}</button>`;
            }).join('');
            box.scrollTop = 0;
        }
        // Back steps out to the list before (or out of a search); there is none at the top
        qaQ('[data-qa="back"]').disabled = !qaQuery && !qaStack.length;
    }

    function qaPick(i) {
        const r = qaRows[i];
        if (!r) return;
        if (r.type === 'group') { qaStack.push({ label: r.label, path: r.path, kind: r.kind }); qaLoad(); return; }
        closeQa(true);
        const ta = edArea();
        if (!ta) return;
        putTag(ta, r.tag);
        edCount();
        edWeight();
    }

    /** A tag in at the caret, with a comma before and after where the text around it needs one. */
    function putTag(ta, tag) {
        const text = ta.value;
        const start = ta.selectionStart;
        const before = text.slice(0, start);
        const after = text.slice(ta.selectionEnd);
        const atGroupStart = /-?\d+(?:\.\d+)?::\s*$/.test(before);
        const atGroupEnd = /^\s*::/.test(after);
        let pre = '';
        if (before.trim() && !atGroupStart) pre = before.trim().endsWith(',') ? (before.endsWith(' ') ? '' : ' ') : ', ';
        const post = after.trim() && !atGroupEnd && !/^\s*,/.test(after) ? (/^\s/.test(after) ? ',' : ', ') : '';
        document.execCommand('insertText', false, pre + tag + post);
    }

    // ---- find: asks for the text once, then steps through its places (round to the start again)

    let findText = '';
    function findNext() {
        const ta = edArea();
        if (!ta || !findText) return;
        const hay = ta.value.toLowerCase();
        const needle = findText.toLowerCase();
        let at = hay.indexOf(needle, ta.selectionEnd);
        if (at < 0) at = hay.indexOf(needle);
        if (at < 0) { sh.messageBox({ title: 'Find', text: `Cannot find "${findText}".`, icon: 'info', modal: true }); return; }
        ta.focus();
        ta.setSelectionRange(at, at + findText.length);
        edWeight();
    }

    function findAsk() {
        const ta = edArea();
        const sel = ta && ta.selectionStart !== ta.selectionEnd ? ta.value.slice(ta.selectionStart, ta.selectionEnd) : findText;
        sh.messageBox({ title: 'Find', text: 'Find what:', input: { value: sel.length <= 60 ? sel : '' }, modal: true, buttons: [{ text: 'Find Next', value: true, default: true }, { text: 'Cancel', value: false }], cancelValue: false })
            .then((text) => { if (text) { findText = text; findNext(); } });
    }

    // ---- autofill: tags for the word being typed, as a WM list docked on the tool bar

    let acTimer = 0;
    let acSeq = 0;

    /** The tag under the caret: from the comma (or line start) before it up to the caret. */
    function acToken() {
        const ta = edArea();
        if (!ta || ta.selectionStart !== ta.selectionEnd) return null;
        const end = ta.selectionStart;
        const before = ta.value.slice(0, end);
        const cut = Math.max(before.lastIndexOf(','), before.lastIndexOf('\n'), before.lastIndexOf('|'), before.lastIndexOf('{'), before.lastIndexOf('['), before.lastIndexOf('::'));
        let start = cut < 0 ? 0 : cut + (before.startsWith('::', cut) ? 2 : 1);
        while (start < end && /\s/.test(before[start])) start += 1;
        const text = before.slice(start);
        return text.trim().length >= 2 ? { start, end, text: text.trim() } : null;
    }

    function acHide() {
        acSeq += 1;
        clearTimeout(acTimer);
        const box = $('.wds-ac');
        if (box && !box.hidden) { box.hidden = true; box.textContent = ''; }
    }

    function acQueue() {
        clearTimeout(acTimer);
        const tok = acToken();
        // SmartText's own settings (the desktop's, in the editor's Menu): off, its delay, its result count
        const prefs = M.autofillSettings();
        if (!tok || prefs.enabled === false) { acHide(); return; }
        acTimer = setTimeout(() => {
            const seq = ++acSeq;
            M.suggest(tok.text).then((list) => {
                const now = acToken();
                if (seq !== acSeq || top() !== 'editor' || !now || now.text !== tok.text) return;
                const box = $('.wds-ac');
                const spell = list.spell || [];
                const lookup = list.lookup || [];
                if (!list.length && !spell.length && !lookup.length) { box.hidden = true; box.textContent = ''; return; }
                // spell check and thesaurus at the top while they have something (the desktop's side
                // sections): the word, then its suggestions / synonyms to tap
                const chips = (word, words, attr) => words.map((w) => `<button type="button" class="wm-tool is-text" data-${attr}="${esc(w)}" data-word="${esc(word)}">${esc(w)}</button>`).join('');
                const side = spell.map((r) => `<div class="wds-ac-side is-spell">${toolIcon('fas fa-spell-check')}<b>${esc(r.word)}</b>${chips(r.word, r.suggestions, 'fix')}</div>`).join('')
                    + lookup.map((r) => `<div class="wds-ac-side is-lookup">${toolIcon('fas fa-book')}<b>${esc(r.word)}</b>${chips(r.word, r.synonyms, 'syn')}</div>`).join('');
                box.innerHTML = side + list.slice(0, Number(prefs.maxResults) || 35).map((r) => `<button type="button" class="wm-listbox-row wds-ac-row" data-key="${esc(r.text)}">${toolIcon(acIcon(r))}<span>${esc(r.label || r.text)}</span>${acNote(r) ? `<small>${esc(acNote(r))}</small>` : ''}</button>`).join('');
                box.classList.toggle('has-side', !!side);
                box.hidden = false;
                box.scrollTop = 0;
            });
        }, Math.max(0, Number(prefs.searchDelayMs) || 0));
    }

    // a row's indicators (the desktop's): its kind and tag category as an icon, beside it the post
    // count, a character's series, or "Expander"
    const AC_CATEGORY_ICONS = { 0: 'fas fa-tag', 1: 'fas fa-palette', 3: 'fas fa-copyright', 4: 'fas fa-user', 5: 'fas fa-circle-info', 6: 'fas fa-paw' };
    function acIcon(r) {
        if (r.kind === 'expander') return 'fas fa-book-font';
        if (r.kind === 'character') return 'fas fa-user';
        return AC_CATEGORY_ICONS[r.category] || 'fas fa-tag';
    }
    function acNote(r) {
        if (r.kind !== 'tag') return r.note || '';
        const n = Number(r.count) || 0;
        if (!n) return '';
        return n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k` : String(n);
    }

    /**
     * A spell-check suggestion or a synonym in place of its word inside the tag being typed. A
     * spelling fix keeps the list and asks again; a synonym closes it (the desktop's two).
     */
    function acReplaceWord(word, to, keepOpen) {
        const ta = edArea();
        const tok = acToken();
        if (!ta || !word || !to) return;
        const from = tok ? tok.start : 0;
        const end = tok ? tok.end : ta.value.length;
        const hay = ta.value.slice(from, end).toLowerCase();
        const re = new RegExp(`(^|[^a-z0-9])(${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').toLowerCase()})(?=$|[^a-z0-9])`, 'g');
        let m;
        let at = -1;
        while ((m = re.exec(hay))) at = m.index + m[1].length;
        if (at < 0) return;
        ta.focus();
        ta.setSelectionRange(from + at, from + at + word.length);
        document.execCommand('insertText', false, to);
        if (keepOpen) acQueue(); else acHide();
        edCount();
        hlDraw();
    }

    function acPick(tag) {
        const ta = edArea();
        const tok = acToken();
        if (!ta || !tok || !tag) { acHide(); return; }
        ta.focus();
        ta.setSelectionRange(tok.start, tok.end);
        const after = ta.value.slice(tok.end);
        document.execCommand('insertText', false, /^\s*,/.test(after) ? tag : `${tag}, `);
        acHide();
        edCount();
    }

    function edIcon(name) {
        return `<img alt="" src="/static_images/wm61/ed-${name}.png" srcset="/static_images/wm61/ed-${name}@2x.png 2x, /static_images/wm61/ed-${name}@4x.png 4x">`;
    }

    // ---------------------------------------------------------------- generate / prints

    function generate() {
        if (!M.ready() || running()) return;
        const go = () => {
            viewing = '';
            // a wide screen already has the print beside the page: nothing to open
            const beside = view() === 'home' && $('.wds-print').getClientRects().length > 0;
            if (!beside) openLayer('print'); else paint();
            const stage = $('.wds-stage');
            const rect = stage ? stage.getBoundingClientRect() : null;
            const dpr = Math.min(2, window.devicePixelRatio || 1);
            M.stepPreviewSize = rect && rect.width > 0 && rect.height > 0 ? { width: rect.width * dpr, height: rect.height * dpr } : { width: 512, height: 512 };
            M.generate();
        };
        if (top() === 'editor') {
            const ta = edArea();
            if (ta) ta.blur();
            edCommit().then(() => { layers.pop(); go(); });
        } else go();
    }

    function stop() {
        if (M.stop()) sh.refreshSoftKeys();
    }

    function step(dir) {
        const list = M.prints();
        if (list.length < 2) return;
        const at = Math.max(0, list.indexOf(shownPrint()));
        const next = Math.max(0, Math.min(list.length - 1, at + dir));
        if (next === at) return;
        viewing = list[next];
        drawPrint();
        drawStrip();
        sh.refreshSoftKeys();
    }

    /** A picture action of the desktop's own (favourite, save, upscale ...) on the print on show. */
    function printAction(name, gone) {
        const f = shownPrint();
        if (!f) return;
        sh.busy(Promise.resolve(M.select(f)).then((ok) => (ok ? M.action(name) : null)).then(() => {
            if (gone && typeof M.forget === 'function') { M.forget(f); viewing = ''; }
            snap = null;
            paint();
        }).catch((err) => console.warn('[wmDreamStudio] action', name, err)), { delay: 250 });
    }

    /** WM's Open dialog on the gallery (wmFileDialogs.js): the picked picture's file name to `then`. */
    function choosePicture(title, then) {
        const fd = window.wmFileDialogs;
        if (!fd || typeof fd.open !== 'function') return;
        const pictureOf = (item) => {
            if (!item || item.kind === 'folder') return '';
            if (item.targetKind === 'image') return item.previewImageFilename || item.targetId || '';
            if (item.shortcutType === 'image' && item.shortcutData && item.shortcutData.filename) return item.shortcutData.filename;
            return '';
        };
        fd.open({
            title,
            appTitle: 'DreamStudio',
            typeLabel: 'Pictures',
            pictures: true,
            accept: (item) => !!pictureOf(item),
            onPick(item) { const f = pictureOf(item); if (f) then(f); return true; }
        });
    }

    function chooseBase() {
        choosePicture('Base Image', (f) => { if (M.setBaseImage(f)) { snap = null; layers = []; tab = 'refs'; if (sh.current !== APP_ID) sh.open(APP_ID); paint(); } });
    }

    function openPictureSession() {
        choosePicture('Open Picture', (f) => { sh.busy(M.openPicture(f).catch((err) => console.warn('[wmDreamStudio] picture', err)), { delay: 250 }); });
    }

    function syncRows() {
        const list = M.peers();
        if (!list.length) return [];
        const rows = (fn) => list.map((d) => ({ label: d.name, disabled: d.online === false, action: () => fn(d.id) }));
        return [{ label: 'Send To', submenu: () => rows((id) => M.sendTo(id)) }, { label: 'Get Session From', submenu: () => rows((id) => M.getFrom(id)) }];
    }

    /** The print becomes the picture the next prints start from; back on the page its row shows it. */
    function useAsBase() {
        const f = shownPrint();
        if (!f || !M.setBaseImage(f)) return;
        snap = null;
        layers = [];
        tab = 'prompt';
        paint();
        sh.syncHistory();
    }

    /** Delete cannot be taken back (Scrap can): the phone asks first, as WM does before it deletes a file. */
    function deletePrint() {
        sh.messageBox({
            title: 'DreamStudio',
            text: 'This print will be permanently deleted. Continue?',
            icon: 'question',
            modal: true,
            buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false, default: true }],
            cancelValue: false
        }).then((yes) => { if (yes) printAction('delete-preview', true); });
    }

    function viewFull() {
        const f = shownPrint();
        if (f && typeof sh.viewPicture === 'function') sh.viewPicture({ data: { filename: f } });
    }

    // ---------------------------------------------------------------- generation tool bar

    let genBuilt = false;

    // the desktop Studio's own glyphs for now (Yukimi, Nov 15: "use the same icons as the desktop")
    function toolIcon(cls) { return `<i class="${cls}" aria-hidden="true"></i>`; }

    function buildGenbar() {
        const bar = $('.wds-genbar');
        if (!bar || genBuilt || !sh) return;
        genBuilt = true;
        // a group with combos or numbers takes a share of the row's spare room; one of icons only does not
        bar.innerHTML = GEN_GROUPS.map((group, gi) => `<div class="wm-toolbar-group${group.some((t) => t[2] === 'combo' || t[2] === 'number') ? ' wds-gb-grow' : ''}">${gi ? '<span class="wm-tool-sep" aria-hidden="true"></span>' : ''}${group.map(([id, label, kind, icon]) => {
            if (kind === 'combo') return `<button type="button" class="wm-tool wm-tool-combo" data-gb="${id}" aria-label="${esc(label)}" aria-haspopup="listbox" title="${esc(label)}"></button>`;
            if (kind === 'number') return `<button type="button" class="wm-tool is-text${GEN_SEG.has(id) ? ' wm-lcd' : ''}" data-gb="${id}" aria-label="${esc(label)}" aria-haspopup="dialog" title="${esc(label)}"></button>`;
            // UC is the desktop's level meter (four boxes), not a picture
            // UC: the desktop's four level boxes, NSFW: the desktop's icon for its state
            if (id === 'uc') return `<button type="button" class="wm-tool wds-gb-uc" data-gb="uc" aria-label="${esc(label)}" aria-haspopup="listbox" title="${esc(label)}"><span class="wms-uc-meter" data-level="0"><i></i><i></i><i></i><i></i></span>${toolIcon('fas fa-shield')}</button>`;
            const count = id === 'dataset' ? '<span class="wms-pt-count" hidden></span>' : '';
            const pressed = kind === 'toggle' || kind === 'seed' ? ' aria-pressed="false"' : ` aria-haspopup="${kind === 'panel' ? 'dialog' : 'listbox'}"`;
            return `<button type="button" class="wm-tool" data-gb="${id}" aria-label="${esc(label)}" title="${esc(label)}"${pressed}>${toolIcon(icon)}${count}</button>`;
        }).join('')}</div>`).join('');
        bar.addEventListener('click', onGenClick);
        // Seed: a tap locks it, a hold opens its box (the hold's own click does nothing)
        const seed = bar.querySelector('[data-gb="seed"]');
        let holdTimer = 0;
        let held = false;
        const cancel = () => { clearTimeout(holdTimer); holdTimer = 0; };
        seed.addEventListener('pointerdown', (e) => {
            if (e.button > 0) return;
            held = false;
            cancel();
            holdTimer = setTimeout(() => { holdTimer = 0; held = true; seedBox(); }, SEED_HOLD_MS);
        });
        ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => seed.addEventListener(t, cancel));
        seed.addEventListener('contextmenu', (e) => e.preventDefault());
        seed.addEventListener('click', (e) => {
            e.stopPropagation();
            if (held) { held = false; return; }
            // a tap that closed the seed's panel does only that
            if (ui && ui.popPanelJustClosed(seed)) return;
            const s = read();
            change('seedLock', !s.seedLock).then(() => {
                // nothing to keep yet (no print made, no seed typed): the box asks for one
                snap = null;
                if (!s.seedLock && !read().seedLock) seedBox();
                else paint();
            });
        });
        if (typeof ResizeObserver === 'function') new ResizeObserver(() => { if (shown && ui) ui.fitToolbar(bar); }).observe(bar);
    }

    const flat = (groups) => [].concat(...groups.map((g) => g.options.map((x) => Object.assign({ group: g.group, groupBadge: g.badge, free: g.free }, x))));
    /** A number's cell: seven-segment figures with their unlit segments, or plain digits. */
    function genNum(btn, id, v) {
        if (!btn) return;
        // Prints is a two-figure LCD: a blank figure ('!' in DSEG7) before one digit
        const text = id === 'n' ? fmtNum(id, v).padStart(2, '!') : fmtNum(id, v);
        if (GEN_SEG.has(id) && ui && typeof ui.segText === 'function') ui.segText(btn, text);
        else btn.textContent = text;
    }
    const fmtNum = (id, v) => { const c = GEN_NUMBERS[id]; const dg = (String(c.fineStep || c.step).split('.')[1] || '').length; return Number(v == null ? c.def : v).toFixed(dg); };

    /** A combo's text and the desktop's badge after it (v4.5 Full, Portrait WP, Euler A). */
    function comboFace(btn, text, badge, cls) {
        btn.textContent = text;
        if (badge) {
            const b = document.createElement('span');
            b.className = `wms-badge${cls ? ` ${cls}` : ''}`;
            b.textContent = badge;
            btn.appendChild(b);
        }
    }

    /** Model's combo is as wide as its widest choice (Yukimi, Nov 15: the room goes to the others). */
    let modelFit = '';
    function fitModelCombo(btn, models) {
        const key = models.map((m) => `${m.short}|${m.badge}`).join(',');
        if (!btn || key === modelFit || !btn.getClientRects().length) return;
        btn.style.width = '';
        btn.classList.add('is-measuring');
        let w = 0;
        models.forEach((m) => { comboFace(btn, m.short, m.badge, m.badgeClass); w = Math.max(w, btn.scrollWidth); });
        btn.classList.remove('is-measuring');
        if (w > 0) { btn.style.width = `${Math.ceil(w)}px`; modelFit = key; }
    }

    function sizeBadge(x) {
        if (String(x.value).startsWith('normal_wallpaper_')) return { name: String(x.value).endsWith('_portrait') ? 'Portrait' : 'Landscape', badge: 'WP', cls: 'free-badge' };
        return { name: x.name, badge: x.groupBadge || '', cls: x.free ? 'free-badge' : '' };
    }

    function drawGenbar() {
        const bar = $('.wds-genbar');
        if (!bar || !M || !M.ready()) return;
        buildGenbar();
        const s = read();
        const o = M.options();
        const q = (id) => bar.querySelector(`[data-gb="${id}"]`);
        const model = flat(o.models).find((m) => m.value === s.model);
        fitModelCombo(q('model'), flat(o.models));
        comboFace(q('model'), model ? model.short : (s.model || 'Model'), model && model.badge, model && model.badgeClass);
        const eff = q('effort');
        eff.hidden = !o.has.effort;
        eff.setAttribute('aria-pressed', String(s.effort === 'medium'));
        const size = flat(o.resolutions).find((x) => x.value === s.resolution);
        if (size) { const f = sizeBadge(size); comboFace(q('resolution'), f.name, f.badge, f.cls); } else comboFace(q('resolution'), s.width && s.height ? `${s.width} x ${s.height}` : 'Size');
        Object.keys(GEN_NUMBERS).forEach((id) => { genNum(q(id), id, s[id]); });
        q('steps').disabled = !o.has.steps;
        // the paid dot: a value that makes the next print cost Anlas (over 28 steps, more than one print)
        const paid = M.cost() > 0;
        q('steps').classList.toggle('is-paid', paid && Number(s.steps) > 28);
        q('n').classList.toggle('is-paid', paid && Number(s.n) > 1);
        q('rescale').disabled = !o.has.rescale;
        const ds = q('dataset');
        const list = M.datasets();
        const onCount = list.datasets.filter((d) => d.on).length;
        ds.disabled = !o.has.datasets || !(list.datasets.length || list.quality);
        ds.setAttribute('aria-pressed', String(!ds.disabled && onCount > 0));
        const count = ds.querySelector('.wms-pt-count');
        count.hidden = onCount < 2;
        count.textContent = String(onCount);
        const sub = q('subtoggle');
        const adj = M.adjustments();
        sub.disabled = !adj.length;
        sub.setAttribute('aria-pressed', String(adj.some((a) => a.rows.some((r) => r.on))));
        const uc = q('uc');
        uc.disabled = !o.has.uc || !o.ucPresets.length;
        const level = Number(s.append_uc) || 0;
        uc.querySelector('.wms-uc-meter').dataset.level = String(level === 5 ? 1 : Math.min(4, level));
        const nsfw = Number(s.nsfw) || 0;
        const face = uc.querySelector('i.fas');
        if (face) face.className = nsfw > 0 ? 'fas fa-face-grin-hearts' : nsfw < 0 ? 'fas fa-shield-xmark' : 'fas fa-shield';
        const variety = q('variety');
        variety.hidden = !o.has.variety;
        variety.setAttribute('aria-pressed', String(!!s.variety));
        const sampler = o.samplers.find((x) => x.value === s.sampler);
        const noise = o.has.noise ? o.noise.find((x) => x.value === s.noiseScheduler) : null;
        comboFace(q('sampler'), sampler ? sampler.short : (s.sampler || 'Sampler'), sampler && sampler.badge);
        q('sampler').setAttribute('aria-label', `Sampler: ${sampler ? sampler.name : ''}${noise ? `, ${noise.name}` : ''}`);
        q('sampler').disabled = !o.has.sampler;
        const seed = q('seed');
        seed.setAttribute('aria-pressed', String(!!s.seedLock));
        seed.title = s.seedLock && s.seed != null && s.seed !== '' ? `Seed ${s.seed} (kept)` : 'Seed';
        // a kept seed shows the lock, a free one the desktop's sprout
        const glyph = seed.querySelector('i');
        if (glyph) glyph.className = s.seedLock ? 'fas fa-lock' : 'fas fa-seedling';
        if (ui) ui.fitToolbar(bar);
    }

    /** A drop-down list from a tool (Model, Size, UC, Sampler): [[value, label] | '-' | { head }]. */
    function genList(btn, rows, current, onPick) {
        sh.dropdown(btn, rows.map((r) => (r === '-' ? '-' : { label: r[1], radio: r[0] === current, action: () => onPick(r[0]) })), btn.getBoundingClientRect().left > window.innerWidth / 2 ? 'right' : 'left');
    }

    function grouped(groups, name) {
        const rows = [];
        groups.forEach((g, i) => { if (i && g.options.length) rows.push('-'); g.options.forEach((x) => rows.push([x.value, name(g, x)])); });
        return rows;
    }

    function onGenClick(e) {
        const b = e.target.closest && e.target.closest('[data-gb]');
        if (!b || b.disabled || !M || !M.ready()) return;
        if (ui && ui.popPanelJustClosed(b)) return;
        const id = b.dataset.gb;
        const s = read();
        const o = M.options();
        if (id === 'seed') return;
        if (id === 'model') { genList(b, grouped(o.models, (g, x) => x.name), s.model, (v) => change('model', v)); return; }
        if (id === 'resolution') {
            genList(b, grouped(o.resolutions, sizeName), s.resolution, (v) => change('resolution', v).then(() => { if (/^custom/.test(String(v))) sizeDialog(); }));
            return;
        }
        if (id === 'uc') { ucPanel(b); return; }
        if (id === 'sampler') {
            const rows = o.samplers.map((x) => [`s:${x.value}`, x.name]);
            if (o.has.noise && o.noise.length) rows.push('-', ...o.noise.map((x) => [`n:${x.value}`, x.name]));
            // two choices in one list: the sampler's dot and the noise schedule's dot
            sh.dropdown(b, rows.map((r) => (r === '-' ? '-' : { label: r[1], radio: r[0] === `s:${s.sampler}` || r[0] === `n:${s.noiseScheduler}`, action: () => (r[0].startsWith('s:') ? change('sampler', r[0].slice(2)) : change('noiseScheduler', r[0].slice(2))) })), 'right');
            return;
        }
        if (id === 'effort') { change('effort', s.effort === 'medium' ? 'high' : 'medium'); return; }
        if (id === 'variety') { change('variety', !s.variety); return; }
        if (GEN_NUMBERS[id]) {
            const c = GEN_NUMBERS[id];
            const label = b.getAttribute('aria-label');
            ui.valuePop(b, Object.assign({}, c, { label, value: Number(s[id] == null ? c.def : s[id]), onChange: (v) => { genNum(b, id, v); queueSet(id, v); } }));
            return;
        }
        if (id === 'dataset') { weightPanel(b, 'Datasets', datasetRows, (row, patch) => M.setDataset(row.key, patch)); return; }
        if (id === 'subtoggle') { weightPanel(b, 'Adjustments', adjustmentRows, (row, patch) => M.setAdjustment(row.dataset, row.key, patch)); }
    }

    // a value dragged along a trackbar is written once the finger rests (each write redraws the form)
    const setTimers = new Map();
    function queueSet(id, v) {
        clearTimeout(setTimers.get(id));
        setTimers.set(id, setTimeout(() => { setTimers.delete(id); change(id, v); }, 120));
    }

    // ---- small WM dialogs (the message box's frame): one at a time; the title bar's ok closes it, as
    // does the phone's Back key

    let dlg = null;

    let dlgOnClose = null;

    function closeDlg() {
        if (!dlg) return false;
        // told first, while its fields are still there to read (a dialog that commits on close)
        if (dlgOnClose) { const fn = dlgOnClose; dlgOnClose = null; try { fn(dlg); } catch (err) { console.warn('[wmDreamStudio] dialog close', err); } }
        dlg.remove();
        dlg = null;
        sh.refreshTitleAction();
        sh.syncHistory();
        paint();
        return true;
    }

    /** opts.onClose(el): the dialog is closing (title-bar ok, Back, another dialog opening). */
    function openDlg(title, cls, bodyHtml, opts = {}) {
        closeDlg();
        dlgOnClose = typeof opts.onClose === 'function' ? opts.onClose : null;
        const host = document.getElementById('wmShell') || document.body;
        dlg = document.createElement('div');
        dlg.className = `wm-msgbox-layer wds-dlg ${cls}`;
        dlg.innerHTML = `<div class="wm-msgbox" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="wm-msgbox-title"><span>${esc(title)}</span><button type="button" class="wm-title-action" data-kind="ok" aria-label="OK"></button></div><div class="wds-dlg-body">${bodyHtml}</div></div>`;
        host.appendChild(dlg);
        dlg.querySelector('.wm-title-action').addEventListener('click', closeDlg);
        sh.refreshTitleAction();
        sh.syncHistory();
        return dlg;
    }

    /** A dialog row's LCD and jog (dialogs' own rows: no write-back delay games, the value goes at once). */
    function dlgJog(row, { label, value, min, max, step, fineStep = 0, onChange }) {
        const lcd = row.querySelector('.wm-lcd');
        const dg = (String(fineStep || step).split('.')[1] || '').length;
        ui.segText(lcd, Number(value).toFixed(dg));
        let timer = 0;
        ui.jogWheel(row, { label, value, min, max, step, fineStep, stepPx: 18, zeroStop: 0, onChange: (v) => { ui.segText(lcd, Number(v).toFixed(dg)); clearTimeout(timer); timer = setTimeout(() => onChange(v), 120); } });
    }

    /**
     * Base Image (Yukimi, Nov 16): from the base image row and Menu > Base Image: its picture, Strength
     * and Noise as LCD + jog rows, Change... and Remove.
     */
    function baseDialog() {
        const s = read();
        if (!s.hasBaseImage) { chooseBase(); return; }
        const src = thumbUrl(s.baseImage);
        const el = openDlg('Base Image', 'wds-basedlg', `${src ? `<img class="wds-base-pic" alt="" src="${esc(src)}">` : ''}`
            + '<div class="wds-wt-row is-on" data-b="strength"><span class="wds-wt-name">Strength</span><span class="wds-wt-lcd wm-lcd"></span></div>'
            + '<div class="wds-wt-row is-on" data-b="noise"><span class="wds-wt-name">Noise</span><span class="wds-wt-lcd wm-lcd"></span></div>'
            + '<div class="wm-msgbox-buttons"><button type="button" data-b-act="change">Change...</button><button type="button" data-b-act="remove">Remove</button></div>');
        dlgJog(el.querySelector('[data-b="strength"]'), { label: 'Strength', value: Number(s.strength) || 0, min: 0, max: 1, step: 0.05, fineStep: 0.01, onChange: (v) => change('strength', v) });
        dlgJog(el.querySelector('[data-b="noise"]'), { label: 'Noise', value: Number(s.noise) || 0, min: 0, max: 1, step: 0.05, fineStep: 0.01, onChange: (v) => change('noise', v) });
        el.addEventListener('click', (e) => {
            const b = e.target.closest && e.target.closest('[data-b-act]');
            if (!b) return;
            if (b.dataset.bAct === 'remove') { M.clearBaseImage(); snap = null; closeDlg(); } else { closeDlg(); chooseBase(); }
        });
    }

    /** Syntax Handling (Yukimi, Nov 16): Studio's syntax options as check boxes; each goes at once. */
    const SYNTAX = [['keep_newlines', 'Keep Newlines'], ['bake_newlines', 'Bake New Lines'], ['auto_char_numerize', 'Auto Char Numerize'], ['prompt_normalize', 'Prompt Normalize'], ['deduplicate_tags', 'Deduplicate']];
    function syntaxDialog() {
        const el = openDlg('Syntax Handling', 'wds-syndlg', '');
        const body = el.querySelector('.wds-dlg-body');
        const fill = () => {
            snap = null;
            const s = read();
            body.innerHTML = SYNTAX.map(([id, label]) => ui.check(`wdsSyn-${id}`, label, !!s[id], `data-syn="${id}"${id === 'bake_newlines' && !s.keep_newlines ? ' disabled' : ''}`)).join('');
        };
        fill();
        body.addEventListener('change', (e) => { const t = e.target; if (t && t.dataset && t.dataset.syn) change(t.dataset.syn, !!t.checked).then(fill); });
    }

    // ---- Custom Resolution / Custom Ratio (Yukimi, Nov 15): a WM dialog with jog wheels, each value an
    // LCD that opens the number pad; the area limit (Normal, Large, Max) as a button

    let szDlg = null;

    function closeSize() { if (!szDlg) return false; szDlg.remove(); szDlg = null; sh.refreshTitleAction(); sh.syncHistory(); paint(); return true; }

    function sizeDialog() {
        closeSize();
        const c0 = M.customSize();
        if (!c0 || !c0.mode) return;
        const ratio = c0.mode === 'ratio';
        const host = document.getElementById('wmShell') || document.body;
        szDlg = document.createElement('div');
        szDlg.className = 'wm-msgbox-layer wds-szdlg';
        const row = (key, label) => `<div class="wds-wt-row is-on" data-sz="${key}"><span class="wds-wt-name">${label}</span><button type="button" class="wds-wt-lcd wm-lcd" data-pad="${key}" aria-label="${label}: type a value"></button></div>`;
        szDlg.innerHTML = `<div class="wm-msgbox" role="dialog" aria-modal="true" aria-label="${ratio ? 'Custom Ratio' : 'Custom Resolution'}"><div class="wm-msgbox-title"><span>${ratio ? 'Custom Ratio' : 'Custom Resolution'}</span><button type="button" class="wm-title-action" data-kind="ok" aria-label="OK"></button></div>`
            + `<div class="wds-sz-body">${ratio ? row('ratio', 'Ratio') : ''}${row('width', 'Width')}${row('height', 'Height')}<div class="wds-wt-row"><span class="wds-wt-name">Area</span><button type="button" class="wm-button" data-area></button></div></div></div>`;
        host.appendChild(szDlg);
        const q = (sel) => szDlg.querySelector(sel);
        const show = () => {
            const c = M.customSize() || c0;
            if (ratio) ui.segText(q('[data-pad="ratio"]'), c.ratio || '1:1');
            ui.segText(q('[data-pad="width"]'), String(c.width || 0).padStart(4, '!'));
            ui.segText(q('[data-pad="height"]'), String(c.height || 0).padStart(4, '!'));
            q('[data-area]').textContent = c.area;
            jogs.width.set(c.width);
            jogs.height.set(c.height);
        };
        const jogs = {};
        let timer = 0;
        const put = (w, h) => { clearTimeout(timer); timer = setTimeout(() => { Promise.resolve(M.setCustomSize(w, h)).then(() => { show(); paint(); }); }, 150); };
        ['width', 'height'].forEach((k) => {
            jogs[k] = ui.jogWheel(q(`[data-sz="${k}"]`), {
                label: k === 'width' ? 'Width' : 'Height',
                value: c0[k] || 1024,
                min: 64,
                max: 2048,
                step: 64,
                zeroStop: 0,
                stepPx: 18,
                onChange: (v) => { ui.segText(q(`[data-pad="${k}"]`), String(v).padStart(4, '!')); put(k === 'width' ? v : null, k === 'height' ? v : null); }
            });
        });
        // in ratio mode the width and height follow the ratio: the ratio's jog steps the legal sizes
        if (ratio) {
            ui.jogWheel(q('[data-sz="ratio"]'), { label: 'Ratio', stepPx: 24, zeroStop: 0, onStep: (d) => { M.stepRatio(d); show(); paint(); } });
            q('[data-sz="width"]').classList.add('is-follow');
            q('[data-sz="height"]').classList.add('is-follow');
        }
        szDlg.addEventListener('click', (e) => {
            const t = e.target.closest && e.target.closest('[data-pad], [data-area], .wm-title-action');
            if (!t) return;
            if (t.classList.contains('wm-title-action')) { closeSize(); return; }
            if (t.hasAttribute('data-area')) { M.cycleArea(); show(); paint(); return; }
            const key = t.dataset.pad;
            const c = M.customSize() || c0;
            ui.numPad({
                title: key === 'ratio' ? 'Ratio' : key === 'width' ? 'Width' : 'Height',
                value: key === 'ratio' ? c.ratio : String(c[key] || ''),
                colon: key === 'ratio',
                max: key === 'ratio' ? 6 : 4,
                onOk: (text) => {
                    if (key === 'ratio') M.setRatio(text);
                    else if (Number(text) > 0) { const v = Math.max(64, Math.round(Number(text) / 64) * 64); Promise.resolve(M.setCustomSize(key === 'width' ? v : null, key === 'height' ? v : null)).then(show); }
                    show();
                    paint();
                }
            });
        });
        show();
        sh.refreshTitleAction();
        sh.syncHistory();
    }

    // ---- weight panels: a check row per dataset (or adjustment) with its weight; a tap on the
    // weight opens its trackbar over the panel

    function datasetRows() {
        const d = M.datasets();
        const rows = [];
        if (d.datasets.length) rows.push({ head: 'Datasets' }, ...d.datasets.map((x) => Object.assign({ key: x.value }, x)));
        const presets = [d.quality, d.transparency].filter(Boolean);
        if (presets.length) rows.push({ head: 'Presets' }, ...presets.map((x) => Object.assign({ key: x.value }, x)));
        return rows;
    }

    function adjustmentRows() {
        const rows = [];
        M.adjustments().forEach((a) => {
            rows.push({ head: a.name });
            a.rows.forEach((r) => rows.push(r.head ? { head: r.head, minor: true } : Object.assign({ key: r.id, dataset: a.dataset }, r)));
        });
        return rows;
    }

    const fmtWt = (v) => (Number(v) === 1 ? '1.0' : Number(v).toFixed(1));

    /** A weight's LCD, jog wheel and square default button in a row (rows that are switched off show none). */
    function weightJog(row, r, write) {
        const lcd = row.querySelector('.wds-wt-lcd');
        const signed = Number(r.min) < 0;
        const fmt = r.fineStep ? (v) => Number(v).toFixed(2) : fmtWt;
        ui.segText(lcd, fmt(r.bias), { signed });
        let timer = 0;
        const put = (n) => {
            ui.segText(lcd, fmt(n), { signed });
            clearTimeout(timer);
            timer = setTimeout(() => { Promise.resolve(write(r, { bias: n })).then(() => { r.bias = n; snap = null; drawGenbar(); }); }, 120);
        };
        const jog = ui.jogWheel(row, {
            label: `${r.name} weight`,
            value: r.bias,
            min: r.min,
            max: r.max,
            step: r.coarse || 0.1,
            fineStep: r.fineStep || 0,
            stepPx: 18,
            onChange: put
        });
        if (r.def != null) {
            row.insertAdjacentHTML('beforeend', `<button type="button" class="wm-valuepop-default" aria-label="${esc(r.name)}: Default" title="Default"></button>`);
            row.lastElementChild.addEventListener('click', () => { jog.set(r.def); put(r.def); });
        }
    }

    /**
     * Datasets / Adjustments: a check row each with its icon (the desktop's), and when it is on, its
     * weight as an LCD with a jog wheel at the right; the group names as sub-headers.
     */
    function weightPanel(anchor, label, rowsOf, write) {
        let rows = [];
        let pop = null;
        pop = ui.popPanel(anchor, {
            label,
            className: 'wds-wtpop',
            build(el) {
                const fill = () => {
                    rows = rowsOf();
                    const top = el.scrollTop;
                    el.innerHTML = rows.map((r, i) => {
                        if (r.head) return `<div class="wm-form-sub wds-wt-head${r.minor ? ' is-minor' : ''}">${esc(r.head)}</div>`;
                        return `<div class="wds-wt-row${r.on ? ' is-on' : ''}" data-i="${i}"><label class="wm-check"><input type="checkbox" data-i="${i}"${r.on ? ' checked' : ''}><span>${toolIcon(r.icon || 'fas fa-toggle-on')}${esc(r.name)}</span></label>${r.on ? '<span class="wds-wt-lcd wm-lcd"></span>' : ''}</div>`;
                    }).join('') || '<div class="wm-form-sub wds-wt-head">None</div>';
                    el.querySelectorAll('.wds-wt-row.is-on').forEach((row) => weightJog(row, rows[Number(row.dataset.i)], write));
                    el.scrollTop = top;
                    if (pop) pop.place();
                };
                fill();
                el.addEventListener('change', (e) => {
                    const t = e.target;
                    const r = t && t.dataset && t.type === 'checkbox' && rows[Number(t.dataset.i)];
                    if (!r) return;
                    // a ratio group's rows are one of several: checking one clears the others (the desktop's own rule)
                    Promise.resolve(write(r, { on: !!t.checked })).then(() => { snap = null; fill(); drawGenbar(); });
                });
            }
        });
        return pop;
    }

    // ---- UC Preset and NSFW: one panel (Yukimi, Nov 15), each under its header; NSFW's bias as an LCD
    // with a jog at the foot of its section while NSFW is not Neutral

    function ucPanel(anchor) {
        let pop = null;
        pop = ui.popPanel(anchor, {
            label: 'UC Preset and NSFW',
            className: 'wds-wtpop wds-ucpop',
            build(el) {
                const fill = () => {
                    snap = null;
                    const s = read();
                    const o = M.options();
                    const uc = Number(s.append_uc) || 0;
                    const nsfw = Number(s.nsfw) || 0;
                    el.innerHTML = ui.sub('UC Preset') + o.ucPresets.map((x) => ui.radio('wdsUc', x.value, x.name, x.value === uc, 'data-uc')).join('')
                        + ui.sub('NSFW') + o.nsfw.map((x) => ui.radio('wdsNsfw', x.value, x.name, x.value === nsfw, 'data-nsfw')).join('')
                        + (nsfw !== 0 ? '<div class="wds-wt-row is-on wds-nsfw-bias"><span class="wds-wt-name">Bias</span><span class="wds-wt-lcd wm-lcd"></span></div>' : '');
                    const row = el.querySelector('.wds-nsfw-bias');
                    if (row) weightJog(row, { name: 'NSFW', bias: Number(s.nsfw_bias) || 1, min: 0.1, max: 3, def: 1 }, (r, p) => change('nsfw_bias', p.bias));
                    // the Bias row comes and goes with NSFW: the panel is fitted on the screen again
                    if (pop) pop.place();
                };
                fill();
                el.addEventListener('change', (e) => {
                    const t = e.target;
                    if (!t || t.type !== 'radio') return;
                    const v = Number(t.value);
                    Promise.resolve(t.hasAttribute('data-uc') ? change('append_uc', v) : change('nsfw', v)).then(() => { fill(); drawGenbar(); });
                });
            }
        });
    }

    // ---- the seed's panel (a hold on Seed), one row (Yukimi, Nov 15): the seed, then Clear, Random
    // and the lock as the desktop's glyphs; a seed typed in counts once Enter or the panel closes

    function seedBox() {
        const anchor = $('.wds-genbar [data-gb="seed"]');
        if (!anchor || !ui) return;
        ui.popPanel(anchor, {
            label: 'Seed',
            className: 'wds-seedpop',
            build(el) {
                el.innerHTML = `<span class="wm-lcd-edit" data-ghost="8888888888"><input type="text" data-seed inputmode="numeric" maxlength="10" autocomplete="off" placeholder="Random" aria-label="Seed"></span>`
                    + `<button type="button" class="wm-tool" data-seed-act="copy" aria-label="Use the Print's Seed" title="Use the Print's Seed" hidden>${toolIcon('fas fa-arrow-turn-down-right')}</button>`
                    + `<button type="button" class="wm-tool" data-seed-act="clear" aria-label="Clear Seed" title="Clear Seed">${toolIcon('fa-regular fa-xmark-large')}</button>`
                    + `<button type="button" class="wm-tool" data-seed-act="random" aria-label="Random Seed" title="Random Seed">${toolIcon('nai-dice')}</button>`
                    + `<button type="button" class="wm-tool" data-seed-act="lock" aria-label="Keep this seed" title="Keep this seed" aria-pressed="false">${toolIcon('fas fa-seedling')}</button>`;
                const field = el.querySelector('[data-seed]');
                const lock = el.querySelector('[data-seed-act="lock"]');
                const copy = el.querySelector('[data-seed-act="copy"]');
                const random = el.querySelector('[data-seed-act="random"]');
                let typed = '';
                // the panel follows the seed: its figures, the lock's glyph, what can be used while it
                // is kept (the box and Random wait until it is unlocked, as on the desktop), and the
                // print's own seed offered when it is not the one in the box
                const show = () => {
                    snap = null;
                    const s = read();
                    if (document.activeElement !== field) field.value = typed = s.seedText || '';
                    const kept = !!s.seedLock;
                    lock.setAttribute('aria-pressed', String(kept));
                    const g = lock.querySelector('i');
                    if (g) g.className = kept ? 'fas fa-lock' : 'fas fa-seedling';
                    field.disabled = kept;
                    field.parentElement.classList.toggle('is-disabled', kept);
                    random.disabled = kept;
                    const ps = M.previewSeed();
                    copy.hidden = !ps || ps === String(s.seedText || '');
                };
                const changed = () => { show(); paint(); };
                // a typed seed: used by the next print
                const commit = () => {
                    const raw = String(field.value || '').replace(/[^0-9]/g, '');
                    if (raw === typed) return Promise.resolve();
                    typed = raw;
                    if (raw === '') return Promise.resolve(M.clearSeed()).then(changed);
                    return change('seed', Number(raw)).then(changed);
                };
                field.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit().then(() => field.blur()); } });
                field.addEventListener('change', () => { commit(); });
                el.addEventListener('wds-seed-close', () => { commit(); });
                el.addEventListener('click', (e) => {
                    const b = e.target.closest && e.target.closest('[data-seed-act]');
                    if (!b || b.disabled) return;
                    const act = b.dataset.seedAct;
                    let done;
                    if (act === 'clear') done = Promise.resolve(M.clearSeed());
                    else if (act === 'copy') done = Promise.resolve(M.usePreviewSeed());
                    else if (act === 'random') done = Promise.resolve(M.randomSeed()).then(() => change('seedLock', true));
                    else done = commit().then(() => change('seedLock', !read().seedLock));
                    Promise.resolve(done).then(() => { field.blur(); changed(); });
                });
                show();
            },
            onClose(el) { el.dispatchEvent(new CustomEvent('wds-seed-close')); }
        });
    }

    // ---------------------------------------------------------------- extensions
    //
    // Parts of DreamStudio that live in files of their own (#860 migration, Nov 16): each calls
    //   wmDreamStudio.extend(name, (api, reg) => { ... })
    // and gets the program's helpers (api) and the places it can fill (reg):
    //   reg.pane(tabId, { draw(el, api) })      draws a home tab's pane in place of the built-in one
    //                                          ('refs', 'inspector', or 'prompt' extras: see below)
    //   reg.view(name, { title, mount(el), draw(el), softKeys(), menu() })
    //                                          a full page of its own; api.openView(name) shows it,
    //                                          ok / Back steps out of it
    //   reg.menu(section, () => rows)          menu rows added to a section. Menu's top-level menus (the
    //                                          desktop's menu bar, each shown when it has rows): 'file',
    //                                          'edit', 'view', 'prompt', 'add', 'generate', 'rentan',
    //                                          'tools'; 'main' = rows straight in Menu for the page on
    //                                          show only (a tab's own commands); 'print' (the print's
    //                                          rows), 'toolbox' (the editor's toolbox), 'editor' (the
    //                                          editor's Menu). Rows never repeat what is on screen.
    //   reg.hook(event, fn)                    'paint' (after every paint: fn(view)), 'show', 'hide'
    // Everything a part reads or changes in Studio goes through api.M (studioModel), as here.

    const MENUS = ['file', 'edit', 'view', 'prompt', 'add', 'generate', 'rentan', 'tools'];
    const ext = { panes: {}, views: {}, menus: { main: [], print: [], toolbox: [], editor: [], file: [], edit: [], view: [], prompt: [], add: [], generate: [], rentan: [], tools: [] }, hooks: { paint: [], show: [], hide: [] }, pending: [] };
    const extRows = (section) => {
        const out = [];
        ext.menus[section].forEach((fn) => { try { const rows = fn(); if (Array.isArray(rows) && rows.length) out.push(...rows); } catch (err) { console.warn('[wmDreamStudio] menu', section, err); } });
        return out;
    };
    const extHook = (event, arg) => ext.hooks[event].forEach((fn) => { try { fn(arg); } catch (err) { console.warn('[wmDreamStudio] hook', event, err); } });

    const api = {
        get M() { return M; },
        get ui() { return ui; },
        get sh() { return sh; },
        get page() { return page; },
        get tab() { return tab; },
        esc,
        toolIcon,
        $,
        read,
        /** Forget the cached snapshot (after a change made behind the model's back). */
        refresh() { snap = null; },
        change,
        paint,
        view: () => view(),
        openDlg,
        closeDlg,
        seedBox: () => seedBox(),
        /** The field the editor has open ('prompt', 'uc', 'c:0:prompt' ...), or '' outside the editor. */
        edField: () => (top() === 'editor' ? edField : ''),
        /** The editor's text again from Studio (after a part changed the field behind it). */
        edReload: () => { if (top() === 'editor') edLoad(); },
        /** The print on show (the one picked, else the newest of this visit, else Studio's). */
        shownPrint: () => (M ? shownPrint() : ''),
        dlgJog,
        weightJog,
        thumbUrl,
        pictureUrl,
        choosePicture,
        openEditor,
        edArea,
        fieldValue,
        fieldSet,
        fieldName,
        WEIGHT_RE,
        weightAt,
        fmtWeight,
        setTab(id) { tab = id; layers = []; paint(); sh.syncHistory(); },
        openView(name) { if (!ext.views[name]) return; if (top() !== `x:${name}`) layers.push(`x:${name}`); paint(); sh.syncHistory(); },
        closeView() { if (String(top()).startsWith('x:')) popLayer(); }
    };

    function extend(name, setup) {
        if (!page || !sh) { ext.pending.push([name, setup]); return; }
        const reg = {
            pane(id, spec) { ext.panes[id] = spec; },
            view(vname, spec) {
                ext.views[vname] = spec;
                const body = $('.wds-body');
                if (body && !body.querySelector(`.wds-xview[data-xview="${vname}"]`)) {
                    const el = document.createElement('div');
                    el.className = 'wds-pane wds-xview';
                    el.dataset.xview = vname;
                    body.appendChild(el);
                    try { if (spec.mount) spec.mount(el, api); } catch (err) { console.warn('[wmDreamStudio] view', vname, err); }
                }
            },
            menu(section, fn) { if (ext.menus[section]) ext.menus[section].push(fn); },
            hook(event, fn) { if (ext.hooks[event]) ext.hooks[event].push(fn); }
        };
        try { setup(api, reg); } catch (err) { console.warn('[wmDreamStudio] extension', name, err); }
    }

    // ---------------------------------------------------------------- menus / keys

    function newSession() {
        if (typeof startStudioNewSession !== 'function') return;
        Promise.resolve(startStudioNewSession()).catch(() => {}).then(() => { snap = null; paint(); });
    }

    function printRows() {
        const f = shownPrint();
        const list = M.prints();
        const at = list.indexOf(f);
        const none = !f;
        return [
            { label: 'View Full Screen', disabled: none, action: viewFull },
            { label: 'Previous', disabled: at <= 0, action: () => step(-1) },
            { label: 'Next', disabled: at < 0 || at >= list.length - 1, action: () => step(1) },
            '-',
            { label: 'Favorite', disabled: none, action: () => printAction('toggle-favorite') },
            { label: 'Use Its Settings', disabled: none, action: () => printAction('modify-preview') },
            { label: 'Use as Base Image', disabled: none, action: useAsBase },
            { label: 'Upscale', disabled: none, action: () => printAction('upscale') },
            { label: 'Expand Canvas...', disabled: none, action: () => printAction('expand-canvas') },
            { label: 'Save to Phone', disabled: none, action: () => printAction('download') },
            // Studio's Edit > Copy Lookback, straight from the tap (no async select first: the clipboard wants the tap)
            { label: 'Copy Lookback', disabled: none || typeof window.copyLookbackImage !== 'function', action: () => window.copyLookbackImage(shownPrint()) },
            { label: 'Properties', disabled: none, action: () => printAction('view-image-data') },
            '-',
            { label: 'Scrap', disabled: none, action: () => printAction('scrap-preview', true) },
            { label: 'Delete', disabled: none, action: deletePrint },
            ...(() => { const r = extRows('print'); return r.length ? ['-', ...r] : []; })()
        ];
    }

    /**
     * Menu: the print (its rows, or a submenu off the print page), then the desktop's menu bar as
     * submenus, each only when it has rows: File, Edit, View, Prompt, Add, Generate, Rentan, Tools
     * (the program's own rows first, then the parts'), then the page's own commands (a tab's).
     */
    function mainMenu() {
        const v = view();
        const s = read();
        const rows = [];
        if (v === 'print') rows.push(...printRows(), '-');
        else rows.push({ label: 'Print', submenu: printRows }, '-');
        const own = {
            file: () => [{ label: 'New Session', action: newSession }, '-', { label: 'Open Picture...', action: openPictureSession }, { label: 'Open Preset...', action: showPresets }, { label: 'Save as Preset...', action: savePresetAs }, ...(() => { const r = syncRows(); return r.length ? ['-', ...r] : []; })()],
            prompt: () => [{ label: 'Syntax Handling...', action: syntaxDialog }],
            add: () => (M.options().has.characters ? [{ label: 'Character', action: addCharacter }] : []),
            generate: () => [{ label: 'Upscale Each Print', checked: !!s.upscale, action: () => change('upscale', !s.upscale).then(paint) }]
        };
        const TITLES = { file: 'File', edit: 'Edit', view: 'View', prompt: 'Prompt', add: 'Add', generate: 'Generate', rentan: 'Rentan', tools: 'Tools' };
        MENUS.forEach((key) => {
            const build = () => {
                const mine = own[key] ? own[key]() : [];
                const theirs = extRows(key);
                return mine.length && theirs.length ? [...mine, '-', ...theirs] : [...mine, ...theirs];
            };
            if (build().length) rows.push({ label: TITLES[key], submenu: build });
        });
        const more = extRows('main');
        if (more.length) rows.push('-', ...more);
        return rows;
    }

    /**
     * The editor's Menu: what the edit bar does not already show (Yukimi, Nov 16: no copies of the
     * bar's buttons): SmartText's settings, clearing the field, Find Next once something was found,
     * Generate (the left key is Done here), the character's own rows.
     */
    function editorMenu() {
        const a = M.autofillSettings();
        const tick = (key, label) => ({ label, checked: a[key] !== false, disabled: key !== 'enabled' && a.enabled === false, action: () => M.setAutofillSetting(key, a[key] === false) });
        const rows = [
            {
                label: 'SmartText',
                submenu: () => [
                    tick('enabled', 'Enable SmartText'),
                    '-',
                    tick('spellcheck', 'Spellcheck'),
                    tick('spellcheckSoundAlike', 'Sound-alike Suggestions'),
                    tick('thesaurus', 'Thesaurus'),
                    '-',
                    tick('naiAnimeTags', 'NAI Anime Tags'),
                    tick('naiFurryTags', 'NAI Furry Tags'),
                    tick('dbAnimeTags', 'DB Anime Tags'),
                    tick('dbFurryTags', 'DB Furry Tags'),
                    '-',
                    { label: 'Delay before Search', submenu: () => a.delays.map((d) => ({ label: d.label, radio: d.ms === a.searchDelayMs, action: () => M.setAutofillSetting('searchDelayMs', d.ms) })) },
                    { label: 'Max Results', submenu: () => a.maxima.map((n) => ({ label: `${n} results`, radio: n === a.maxResults, action: () => M.setAutofillSetting('maxResults', n) })) }
                ]
            },
            '-',
            { label: 'Clear Field', action: () => edCommand('clear') }
        ];
        if (findText) rows.push({ label: `Find Next "${findText.length > 16 ? `${findText.slice(0, 16)}...` : findText}"`, action: findNext });
        rows.push('-', { label: 'Generate', action: generate });
        const c = charOf(edField);
        if (c) rows.push('-', { label: 'Rename Character...', action: () => renameCharacter(c.index) }, { label: 'Remove Character', action: () => removeCharacter(c.index) });
        const more = extRows('editor');
        if (more.length) rows.push('-', ...more);
        return rows;
    }

    function softKeys() {
        const xspec = String(top() || '').startsWith('x:') ? ext.views[String(top()).slice(2)] : null;
        if (xspec) {
            if (typeof xspec.softKeys === 'function') return xspec.softKeys();
            return { left: { label: 'Done', action: popLayer }, right: { label: 'Menu', menu: () => (typeof xspec.menu === 'function' ? xspec.menu() : mainMenu()) } };
        }
        if (top() === 'editor') return { left: { label: 'Done', action: closeEditor }, right: { label: 'Menu', menu: editorMenu } };
        if (top() === 'ref') return { left: { label: 'Done', action: popLayer }, right: { label: 'Remove', action: removeReference } };
        // a list to pick from, a page at a time: a tap opens, the keys turn the pages, ok backs out
        if (top() === 'presets') return { left: { label: 'Previous', disabled: presetPage <= 0, action: () => presetStep(-1) }, right: { label: 'Next', disabled: presetPage >= presetPages - 1, action: () => presetStep(1) } };
        if (running()) return { left: { label: 'Generate', disabled: true }, right: { label: 'Stop', action: stop } };
        return { left: { label: 'Generate', disabled: !M || !M.ready(), action: generate }, right: { label: 'Menu', menu: mainMenu } };
    }

    // ---------------------------------------------------------------- page

    function mount(p) {
        page = p;
        p.classList.add('wm-dreamstudio');
        p.innerHTML = `
<div class="wds-body">
<div class="wds-hl" aria-hidden="true" hidden></div>
<div class="wds-pane wds-home">
  <button type="button" class="wds-strip"><img class="wds-strip-thumb" alt="" hidden><div class="wds-strip-text"><b></b><span></span><div class="wds-bar" hidden><span></span></div></div></button>
  <div class="wds-panes">
    <div class="wds-tabpane wds-fields" data-tab="prompt">
      <div class="wds-label" data-for="prompt"><span>Prompt</span><span></span></div>
      <textarea class="wds-field" data-field="prompt" placeholder="Tap here to write the prompt" spellcheck="false" autocapitalize="off" autocomplete="off"></textarea>
      <div class="wds-chars" hidden></div>
    </div>
    <div class="wds-tabpane wds-fields" data-tab="directive">
      <div class="wds-label" data-for="directive"><span>Directive</span><span></span></div>
      <textarea class="wds-field" data-field="directive" placeholder="Tap here to write what Rentan should make of the scene" spellcheck="false" autocapitalize="sentences" autocomplete="off"></textarea>
    </div>
    <div class="wds-tabpane wds-fields" data-tab="uc">
      <div class="wds-label" data-for="uc"><span>Undesired</span><span></span></div>
      <textarea class="wds-field" data-field="uc" placeholder="Tap here to list what to leave out" spellcheck="false" autocapitalize="off" autocomplete="off"></textarea>
    </div>
    <div class="wds-tabpane wds-fields" data-tab="refs">
      <button type="button" class="wds-base" hidden><img alt=""><div><b>Base image</b><span></span></div></button>
      <div class="wds-refs" hidden></div>
      <p class="wds-none wds-refs-none">No references. Menu &gt; Base Image or Add Reference adds one.</p>
    </div>
    <div class="wds-tabpane wds-fields" data-tab="inspector"><div class="wds-insp"></div></div>
  </div>
  <div class="wm-tabs wds-home-strip" role="tablist">${TABS.map(([id, label]) => `<button type="button" class="wm-tab" role="tab" data-tab="${id}" aria-selected="false">${label}</button>`).join('')}</div>
</div>
<div class="wds-pane wds-print">
  <div class="wds-stage"><img alt="" hidden><div class="wds-grid" hidden></div><div class="wds-empty">No print yet. Generate makes one.</div></div>
  <div class="wds-status" hidden><span></span><div class="wds-bar"><span></span></div></div>
</div>
<div class="wds-pane wds-ref"><div class="wm-form"></div></div>
<div class="wds-pane wds-presets"><div class="wm-listbox"></div><div class="wds-pager" hidden></div><p class="wds-none" hidden>No presets have been saved yet.</p></div>
<div class="wds-ed-head"><button type="button" class="wm-combo"><span></span></button><span></span></div>
<div class="wds-pane wds-editor">
  <textarea class="wds-ed-text" spellcheck="false" autocapitalize="off" autocomplete="off"></textarea>
</div>
<div class="wds-ac wm-listbox" hidden></div>
<div class="wds-toolbar wm-toolbar">${ED_GROUPS.map((g0, gi) => { const g = Array.isArray(g0) ? g0 : g0.tools; return `<div class="wm-toolbar-group${g.includes('weight') ? ' wds-ed-emph' : ''}${g.includes('tokens') ? ' wds-ed-tokens' : ''}"${g0.drop ? ` data-drop="${g0.drop}"` : ''}>${gi ? '<span class="wm-tool-sep"></span>' : ''}${g.map((b) => (b === 'weight' ? '<span class="wds-tb-weight wm-lcd" aria-live="polite" aria-label="Emphasis">1.00</span>' : b === 'tokens' ? `<span class="wds-tb-tokens" aria-label="Tokens">${toolIcon('fas fa-triangle-exclamation wm-icon-warn')}<span></span><div class="wds-bar"><span></span></div></span>` : `<button type="button" class="wm-tool" data-ed="${b[0]}" aria-label="${b[1]}" title="${b[1]}"${b[2] ? ` data-drop="${b[2]}"` : ''}${b[0] === 'emmenu' || b[0] === 'toolbox' ? ' aria-haspopup="menu"' : ''}>${edIcon(ED_ICONS[b[0]] || b[0])}</button>`)).join('')}</div>`; }).join('')}</div>
</div>
<div class="wds-genbar wm-toolbar" role="toolbar" aria-label="Generation settings"></div>`;

        $('.wds-strip').addEventListener('click', () => openLayer('print'));
        $('.wds-base').addEventListener('click', () => baseDialog());
        // the boxes are real text fields: the one that is touched becomes the editor (see edArea)
        p.querySelectorAll('.wds-field').forEach((b) => {
            // after the touch is over: a box that changes size under the finger gets no keyboard
            b.addEventListener('click', () => { setTimeout(() => { if (top() !== 'editor' && document.activeElement === b) openEditor(b.dataset.field); }, 60); });
        });
        const presetPane = $('.wds-presets');
        let presetX = null;
        let presetFlicked = false;
        presetPane.addEventListener('pointerdown', (e) => { presetX = e.clientX; presetFlicked = false; });
        presetPane.addEventListener('pointerup', (e) => {
            if (presetX == null) return;
            const dx = e.clientX - presetX;
            presetX = null;
            if (Math.abs(dx) > 50) { presetFlicked = true; presetStep(dx < 0 ? 1 : -1); }
        });
        presetPane.addEventListener('click', (e) => {
            if (presetFlicked) { presetFlicked = false; return; }
            const r = e.target.closest && e.target.closest('.wm-listbox-row');
            if (r) openPreset(r.dataset.key);
        });
        const insp = $('.wds-insp');
        insp.addEventListener('click', (e) => {
            const b = e.target.closest && e.target.closest('[data-insp]');
            if (!b) return;
            const act = b.dataset.insp;
            if (act === 'seed') { const was = !!read().seedLock; change('seedLock', !was).then(() => { snap = null; if (!was && !read().seedLock) seedBox(); paint(); }); return; }
            M.setGensoLock(act === 'lockall');
            snap = null;
            paint();
        });
        insp.addEventListener('change', (e) => {
            const t = e.target;
            const g = t && t.dataset && t.dataset.genso != null && (insp._seeds || [])[Number(t.dataset.genso)];
            if (!g) return;
            M.setGensoLock(g.key, !!t.checked);
            snap = null;
            paint();
        });
        $('.wds-refs').addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('.wds-refrow'); if (b) { refAt = Number(b.dataset.ref) || 0; openLayer('ref'); } });
        const refForm = $('.wds-ref');
        refForm.addEventListener('change', (e) => {
            const t = e.target;
            if (!t || !t.dataset || !t.dataset.refSet) return;
            const n = Number(String(t.value || '').trim());
            t.blur();
            if (Number.isFinite(n)) refChange({ [t.dataset.refSet]: Math.max(0, Math.min(1, n)) }).then(() => { snap = null; drawRef(); });
            else drawRef();
        });
        refForm.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target && e.target.dataset && e.target.dataset.refSet) e.target.blur(); });
        const chars = $('.wds-chars');
        chars.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('.wds-char-open'); if (b) openEditor(`c:${b.dataset.char}:prompt`); });
        chars.addEventListener('change', (e) => { const t = e.target; if (t && t.dataset && t.dataset.char != null && t.type === 'checkbox') { M.setCharacter(Number(t.dataset.char), { enabled: !!t.checked }); snap = null; } });
        $('.wds-home-strip').addEventListener('click', (e) => {
            const b = e.target.closest && e.target.closest('.wm-tab');
            if (!b || b.dataset.tab === tab) return;
            tab = b.dataset.tab;
            paint();
        });

        // the editor: the bar keeps the focus (and the keyboard) in the text
        const bar = $('.wds-toolbar');
        // the emphasis jog (Yukimi, Nov 15; it replaced - and +): rolled sideways it steps the weight of
        // the group under the caret (or makes one of the selection / the tag there)
        const kit = window.wmSettings && window.wmSettings.ui;
        if (kit && typeof kit.jogWheel === 'function') {
            edJog = kit.jogWheel(bar, { label: 'Emphasis', stepPx: 18, onStep: (d, fine) => stepWeight(d, fine), current: () => caretWeight() });
            edJog.el.removeAttribute('tabindex');
            bar.querySelector('.wds-tb-weight').after(edJog.el);
        }
        if (typeof ResizeObserver === 'function') new ResizeObserver(() => { if (kit && top() === 'editor') kit.fitToolbar(bar, { oneRow: true }); }).observe(bar);
        bar.addEventListener('touchmove', (e) => { if (e.cancelable) e.preventDefault(); }, { passive: false });
        bar.addEventListener('mousedown', (e) => e.preventDefault());
        bar.addEventListener('click', (e) => {
            const b = e.target.closest && e.target.closest('.wm-tool[data-ed]');
            if (!b) return;
            if (b.dataset.ed === 'emmenu') { emphasisMenu(b); return; }
            if (b.dataset.ed === 'toolbox') { toolboxMenu(b); return; }
            edCommand(b.dataset.ed);
        });
        let countTimer = 0;
        p.querySelectorAll('.wds-ed-text, .wds-field').forEach((area) => {
            area.addEventListener('input', () => { if (top() !== 'editor') return; hlDraw(); clearTimeout(countTimer); countTimer = setTimeout(edCount, 400); acQueue(); });
            area.addEventListener('scroll', () => { const hl = $('.wds-hl'); if (hl && !hl.hidden && area === edArea()) hl.scrollTop = area.scrollTop; }, { passive: true });
            ['keyup', 'pointerup', 'select'].forEach((t) => area.addEventListener(t, () => { if (top() === 'editor') edWeight(); }));
            area.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== edArea()) acHide(); }, 0));
        });
        // the caret moved (a tap, the keyboard's arrows, Android's selection handles): the emphasis
        // controls follow the group it is in
        document.addEventListener('selectionchange', () => { if (shown && top() === 'editor' && document.activeElement === edArea()) edWeight(); });
        if (typeof ResizeObserver === 'function') {
            const ro = new ResizeObserver(() => { if (shown && top() === 'editor') hlDraw(); });
            ro.observe($('.wds-body'));
            p.querySelectorAll('.wds-field, .wds-ed-text').forEach((f) => ro.observe(f));
        }
        // the list keeps the focus (and the keyboard) in the text; a tap on a row puts the tag in
        const ac = $('.wds-ac');
        ac.addEventListener('mousedown', (e) => e.preventDefault());
        ac.addEventListener('click', (e) => {
            const fix = e.target.closest && e.target.closest('[data-fix]');
            if (fix) { acReplaceWord(fix.dataset.word, fix.dataset.fix, true); return; }
            const syn = e.target.closest && e.target.closest('[data-syn]');
            if (syn) { acReplaceWord(syn.dataset.word, syn.dataset.syn, false); return; }
            const r = e.target.closest && e.target.closest('.wm-listbox-row');
            if (r) acPick(r.dataset.key);
        });
        $('.wds-ed-head > .wm-combo').addEventListener('click', (e) => {
            e.stopPropagation();
            sh.dropdown(e.currentTarget, fieldList().map((id) => ({ label: fieldName(id), radio: id === edField, action: () => edSwitch(id) })), 'left');
        });

        // the print: a tap opens it full screen, a flick steps through this visit's prints
        const stage = $('.wds-stage');
        let downX = null;
        stage.addEventListener('pointerdown', (e) => { downX = e.clientX; });
        stage.addEventListener('pointerup', (e) => {
            if (downX == null || running()) { downX = null; return; }
            const dx = e.clientX - downX;
            downX = null;
            const cell = e.target.closest && e.target.closest('.wds-grid > button');
            if (cell) { if (cell.dataset.file) { viewing = cell.dataset.file; paint(); } return; }
            if (Math.abs(dx) > 40) step(dx < 0 ? 1 : -1);
            else if (e.target.tagName === 'IMG') viewFull();
        });
        stage.addEventListener('pointercancel', () => { downX = null; });
        // 'error' does not bubble: caught on the way down
        stage.addEventListener('error', (e) => { if (e.target && e.target.tagName === 'IMG') pictureFailed(e.target); }, true);
    }

    // ---------------------------------------------------------------- the desktop Studio behind it

    const studioOpen = () => { const m = document.getElementById('manualModal'); return !!(m && !m.classList.contains('hidden')); };

    /** Studio's session has to be open for the form to answer; nothing of it is ever shown here. */
    function ensureStudio() {
        if (studioOpen() || opening || typeof window.openManualModalWithContent !== 'function') return Promise.resolve();
        return Promise.resolve(window.openManualModalWithContent()).catch((err) => console.warn('[wmDreamStudio] open', err));
    }

    function wrapEntryPoints() {
        const orig = window.openManualModalWithContent;
        if (typeof orig !== 'function' || orig._wmDreamStudio) return;
        const wrapped = async function (content) {
            opening = true;
            const editing = content && typeof content === 'object' && ['image', 'preset', 'metadata'].includes(content.type);
            try {
                // something to edit (a print, a preset, a sent session) brings the program up on its prompt
                if (root.dataset.wmBoot === 'done' && (editing || !isCurrent())) {
                    if (editing) { layers = []; tab = 'prompt'; viewing = ''; }
                    sh.open(APP_ID);
                }
                return await sh.busy(Promise.resolve(orig.apply(this, arguments)), { delay: 250, timeout: 60000 });
            } finally {
                opening = false;
                snap = null;
                paint();
            }
        };
        wrapped._wmDreamStudio = true;
        window.openManualModalWithContent = wrapped;
    }

    // ---------------------------------------------------------------- app

    const APP = {
        id: APP_ID,
        title: 'DreamStudio',
        startLabel: 'Studio',
        icon: 'app-studio',
        inStart: 'top',
        sip: true,
        mount,
        show(p) {
            page = p;
            shown = true;
            M = window.studioModel || null;
            ui = window.wmSettings && window.wmSettings.ui;
            if (!M) return;
            M.ownsPrints = true;
            wrapEntryPoints();
            snap = null;
            // parts that asked to join before the page was there join now
            if (ext.pending.length) { const list = ext.pending.splice(0); list.forEach(([n, f]) => extend(n, f)); }
            extHook('show');
            ensureStudio().then(() => { snap = null; paint(); });
            paint();
        },
        hide() { extHook('hide'); shown = false; if (ui) { ui.closePopPanels(); ui.closePad(); } closeQa(false); closeSize(); closeDlg(); },
        historyDepth: () => layers.length + (ui && ui.popPanelOpen() ? 1 : 0) + (qaDlg ? 1 : 0) + (szDlg ? 1 : 0) + (dlg ? 1 : 0) + (ui && ui.padOpen() ? 1 : 0),
        onBack: () => ((ui && ui.closePad()) || (qaDlg ? qaBack() : closeSize() || closeDlg() || (ui && ui.closePopPanel()) || popLayer())),
        titleKind: () => (layers.length ? 'ok' : 'close'),
        onTitleOk: () => popLayer(),
        closeQuestion: () => (running() ? 'A print is being made. It goes on if you minimize.' : null),
        onTitleClose() {
            layers = [];
            tab = 'prompt';
            if (typeof hideManualModal === 'function' && studioOpen()) { try { hideManualModal(); } catch (_) { /* already shut */ } }
        },
        softKeys
    };

    function wireModel() {
        M = window.studioModel || null;
        if (!M) return;
        M.on('change', () => { snap = null; if (shown) paint(); else stale = true; });
        M.on('start', () => { if (shown) paint(); });
        M.on('progress', () => { if (!shown) return; const v = view(); if (v === 'print' || v === 'home') { drawPrint(); drawStrip(); } });
        M.on('end', (r) => {
            if (shown && isCurrent()) { paint(); return; }
            stale = true;
            if (r && r.files.length && !r.stopped) sh.notify({ title: 'DreamStudio', text: r.files.length > 1 ? `${r.files.length} prints are ready.` : 'Your print is ready.' });
        });
    }

    // ---------------------------------------------------------------- Settings > System > DreamStudio

    function registerSettings() {
        const S = window.wmSettings;
        if (!S || typeof S.registerPage !== 'function') return;
        S.registerPage({
            id: 'dreamstudio',
            tab: 'system',
            label: 'DreamStudio',
            icon: 'app-studio',
            tabs: [],
            init: () => ({ next: stored(NEXT_KEY) === '1' }),
            render(el, t, d) {
                const u = S.ui;
                el.innerHTML = u.sub('Program')
                    + u.check('wdsNext', 'Use the new DreamStudio', d.next)
                    + u.note('The new DreamStudio is being built (#860). The switch takes effect the next time Melaton Mobile starts.');
                el.querySelector('input[name="wdsNext"]').addEventListener('change', (e) => { d.next = !!e.target.checked; });
            },
            commit(d) {
                store(NEXT_KEY, d.next ? '1' : '0');
                stale = true;
                return [];
            }
        });
    }

    function register() {
        sh = window.wmShell;
        ui = window.wmSettings && window.wmSettings.ui;
        if (!sh || typeof sh.registerApp !== 'function') return;
        registerSettings();
        if (!NEXT) return;
        wireModel();
        sh.registerApp(APP);
        // a print, preset or session sent here from any other program opens this one (again in show()
        // if Studio's scripts were not there yet)
        wrapEntryPoints();
    }

    // wmStudio.js stands aside for this program when the switch is on, and other programs' "show the
    // prompt" (Phasewalker's Compile) lands here
    window.wmDreamStudio = { active: NEXT, extend, show(name) { if (!NEXT || !sh) return; layers = name === 'print' ? ['print'] : []; tab = 'prompt'; sh.open(APP_ID); paint(); } };

    if (window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
