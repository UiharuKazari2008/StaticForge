/**
 * Melaton Mobile: DreamStudio (#860). The phone's own Studio program, written for the phone on the
 * shell's stock parts. It never shows, moves or styles a desktop element: everything it reads or
 * changes goes through studioModel.js.
 *
 * Four views, one loop (write, Generate, look, adjust):
 *   home      the print in hand as a strip, Prompt, Undesired, the settings in one row
 *   editor    one prompt field, full screen, with an edit tool bar
 *   settings  the generation settings as a WM form
 *   print     the picture, full screen; the steps stream here while a print runs
 * Settings > System > DreamStudio picks how they are laid out: one page (the strip and the row open
 * Print and Settings) or WM tabs (Prompt | Settings | Print). A wide screen puts home beside the print.
 * Under home, Settings and the print the generation settings stay on a tool bar at the foot of the
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
    const LAYOUT_KEY = 'wmStudioLayout';
    const root = document.documentElement;

    const stored = (key) => { try { return localStorage.getItem(key); } catch (_) { return null; } };
    const store = (key, value) => { try { localStorage.setItem(key, value); } catch (_) { /* private mode */ } };
    // which Studio this load runs: decided once, as the shell's own version switch is
    const NEXT = stored(NEXT_KEY) === '1';
    const layout = () => (stored(LAYOUT_KEY) === 'tabs' ? 'tabs' : 'page');

    const TABS = [['prompt', 'Prompt'], ['settings', 'Settings'], ['print', 'Print']];
    const FIELD_NAMES = { prompt: 'Prompt', uc: 'Undesired', negative: 'Inline Negative' };
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
        const out = Object.keys(FIELD_NAMES);
        (read().characters || []).forEach((_, i) => out.push(`c:${i}:prompt`, `c:${i}:uc`));
        return out;
    }
    const ED_BAR = [['undo', 'Undo'], ['redo', 'Redo'], '|', ['cut', 'Cut'], ['copy', 'Copy'], ['paste', 'Paste'], ['selectall', 'Select All']];

    // the generation tool bar (Yukimi, Nov 15): three groups, each kept whole when the bar wraps
    const GEN_GROUPS = [
        [['model', 'Model', 'combo'], ['effort', 'Drafting (Medium Effort)', 'toggle', 'fas fa-feather'], ['resolution', 'Size', 'combo'], ['n', 'Prints', 'number']],
        [['dataset', 'Datasets', 'panel', 'nai-sakura'], ['subtoggle', 'Adjustments', 'panel', 'fas fa-diamond-half-stroke'], ['uc', 'UC Preset', 'list']],
        [['steps', 'Steps', 'number'], ['guidance', 'Guidance', 'number'], ['variety', 'Variety+', 'toggle', 'fas fa-sparkle'], ['rescale', 'Rescale', 'number'], ['sampler', 'Sampler', 'combo'], ['seed', 'Seed', 'seed', 'fas fa-seedling']]
    ];
    // the numbers: their trackbar's range and step, the default the square button puts back
    const GEN_NUMBERS = {
        n: { min: 1, max: 8, step: 1, def: 1 },
        steps: { min: 1, max: 50, step: 1, def: 25 },
        guidance: { min: 0, max: 10, step: 0.1, def: 5 },
        rescale: { min: 0, max: 1, step: 0.01, def: 0 }
    };
    const SEED_HOLD_MS = 500;

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

    const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const $ = (sel) => (page ? page.querySelector(sel) : null);
    const top = () => layers[layers.length - 1] || null;
    const isCurrent = () => !!(sh && sh.current === APP_ID);
    const running = () => { const r = M && M.run(); return !!(r && r.active); };

    function view() {
        if (top() === 'editor') return 'editor';
        if (top() === 'presets') return 'presets';
        if (top() === 'ref') return 'ref';
        if (layout() === 'tabs') return tab === 'prompt' ? 'home' : tab;
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

    function summaryText(s, o) {
        const model = [].concat(...o.models.map((g) => g.options)).find((m) => m.value === s.model);
        const size = [].concat(...o.resolutions.map((g) => g.options.map((x) => ({ value: x.value, name: sizeName(g, x) })))).find((x) => x.value === s.resolution);
        const parts = [model ? model.name : s.model, size ? size.name : (s.width && s.height ? `${s.width} x ${s.height}` : ''), `${s.steps} steps`];
        if (s.n > 1) parts.push(`${s.n} prints`);
        if (s.seedLock) parts.push('seed kept');
        const cost = M.cost();
        if (cost > 0) parts.push(`${cost} Anlas`);
        return parts.filter(Boolean).join(', ');
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
        ['prompt', 'uc'].forEach((id) => {
            const box = $(`.wds-field[data-field="${id}"]`);
            if (!box) return;
            const text = s[id] || '';
            if (box.value !== text) box.value = text;
            box.scrollTop = 0;
            drawTokens(id, text, $(`.wds-label[data-for="${id}"] > span:last-child`));
        });
        drawChars(s);
        drawRefs(s);
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
        const sum = $('.wds-summary > span');
        if (sum && s.model !== undefined) sum.textContent = summaryText(s, M.options());
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
            Promise.resolve(M.setReferences(list)).then(() => { layers = []; tab = 'prompt'; if (sh.current !== APP_ID) sh.open(APP_ID); snap = null; paint(); });
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

    function comboRow(label, act, pairs, value) {
        const cur = pairs.find((p) => p[0] === value);
        return ui.row(label, ui.comboHtml(act, cur ? cur[1] : String(value == null ? '' : value)));
    }

    function drawSettings() {
        const host = $('.wds-settings > .wm-form');
        if (!host || !ui) return;
        // a value being typed is not redrawn under the finger
        if (host.contains(document.activeElement) && document.activeElement.tagName === 'INPUT' && document.activeElement.type === 'text') return;
        const s = read();
        const o = M.options();
        const models = [].concat(...o.models.map((g) => g.options.map((m) => [m.value, m.name])));
        const sizes = [].concat(...o.resolutions.map((g) => g.options.map((x) => [x.value, sizeName(g, x)])));
        const custom = /^custom/.test(String(s.resolution || ''));
        const dims = o.sizes[s.resolution];
        const num = (id, value, more = '') => ui.edit('', value == null ? '' : value, `data-set="${id}" inputmode="decimal" ${more}`);
        const rows = [];
        rows.push(comboRow('Model:', 'model', models, s.model));
        if (o.has.effort) rows.push(ui.row('', ui.check('effort', 'Drafting (faster, fewer steps)', s.effort === 'medium', 'data-check="effort"')));
        rows.push(comboRow('Size:', 'resolution', sizes, s.resolution));
        if (custom) {
            rows.push(ui.row('Width:', num('width', s.width || '')));
            rows.push(ui.row('Height:', num('height', s.height || '')));
        } else if (dims) {
            rows.push(ui.value('', `${dims[0]} x ${dims[1]}`));
        }
        rows.push(o.has.steps ? ui.row('Steps:', num('steps', s.steps)) : ui.value('Steps:', String(s.steps)));
        rows.push(ui.row('Guidance:', num('guidance', s.guidance)));
        if (o.has.rescale) rows.push(ui.row('Rescale:', num('rescale', s.rescale)));
        if (o.has.sampler) rows.push(comboRow('Sampler:', 'sampler', o.samplers.map((x) => [x.value, x.name]), s.sampler));
        if (o.has.noise) rows.push(comboRow('Noise:', 'noiseScheduler', o.noise.map((x) => [x.value, x.name]), s.noiseScheduler));
        rows.push(ui.row('Seed:', ui.edit('', s.seedLock && s.seed != null ? s.seed : '', 'data-set="seed" inputmode="numeric" placeholder="Random"')));
        rows.push(ui.row('', ui.check('seedLock', 'Keep this seed', !!s.seedLock, 'data-check="seedLock"')));
        rows.push(comboRow('Prints:', 'n', [1, 2, 3, 4, 5, 6, 7, 8].map((n) => [n, String(n)]), Number(s.n) || 1));
        rows.push(ui.row('', ui.check('upscale', 'Upscale each print', !!s.upscale, 'data-check="upscale"')));
        if (s.hasBaseImage) {
            rows.push(ui.sub('Base Image'));
            rows.push(ui.row('Strength:', num('strength', s.strength)));
            rows.push(ui.row('Noise:', num('noise', s.noise)));
        }
        // what is added around the prompt: the desktop's Prompt menu lists
        rows.push(ui.sub('Prompt'));
        const picked = new Set(s.datasets || []);
        if (o.has.datasets && o.datasets.length) {
            rows.push('<div class="wds-sublabel">Datasets:</div>');
            rows.push(ui.listbox(o.datasets.map((d) => ({ key: d.value, label: d.name, checked: picked.has(d.value) }))));
        }
        rows.push(ui.row('', ui.check('append_quality', 'Add quality tags', !!s.append_quality, 'data-check="append_quality"')));
        const ucs = o.ucPresets.map((x) => [x.value, x.name]);
        if (o.has.uc && ucs.length) rows.push(comboRow('UC Preset:', 'append_uc', ucs, Number(s.append_uc) || 0));
        const nsfw = o.nsfw.map((x) => [x.value, x.name]);
        rows.push(comboRow('NSFW:', 'nsfw', nsfw, Number(s.nsfw) || 0));
        rows.push(ui.sub('Syntax Options'));
        [['keep_newlines', 'Keep Newlines'], ['bake_newlines', 'Bake New Lines'], ['auto_char_numerize', 'Auto Char Numerize'], ['prompt_normalize', 'Prompt Normalize'], ['deduplicate_tags', 'Deduplicate']].forEach(([id, label]) => {
            rows.push(ui.check(id, label, !!s[id], `data-check="${id}"${id === 'bake_newlines' && !s.keep_newlines ? ' disabled' : ''}`));
        });
        host.innerHTML = rows.join('');
        ui.bindListbox(host.querySelector('.wm-listbox'), () => {}, (key, on) => {
            const next = new Set(read().datasets || []);
            if (on) next.add(key); else next.delete(key);
            change('datasets', Array.from(next));
        });
        const lists = { model: models, resolution: sizes, sampler: o.samplers.map((x) => [x.value, x.name]), noiseScheduler: o.noise.map((x) => [x.value, x.name]), n: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => [n, String(n)]), append_uc: ucs, nsfw };
        host.querySelectorAll('.wm-combo[data-act]').forEach((btn) => {
            const id = btn.dataset.act;
            const numeric = id === 'n' || id === 'append_uc' || id === 'nsfw';
            ui.bindCombo(btn, lists[id] || [], numeric ? (Number(s[id]) || (id === 'n' ? 1 : 0)) : s[id], (v) => change(id, v));
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

    function drawTabs() {
        const strip = $('.wds-tabs');
        if (!strip) return;
        strip.querySelectorAll('.wm-tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
        if (layout() === 'tabs' && view() !== 'editor' && window.wmSettings && typeof window.wmSettings.fitTabs === 'function' && strip.getClientRects().length) {
            window.wmSettings.fitTabs(strip, tabState);
        }
    }

    function paint() {
        if (!page || !M) return;
        if (!shown) { stale = true; return; }
        stale = false;
        const v = view();
        page.dataset.layout = layout();
        page.dataset.view = v;
        const box = v === 'editor' ? boxOf(edField) : null;
        page.dataset.ed = v === 'editor' ? (box ? 'box' : 'own') : '';
        page.querySelectorAll('.wds-field').forEach((b) => b.classList.toggle('is-editing', b === box));
        if (v === 'home' || v === 'print') { drawHome(); drawPrint(); }
        if (v === 'settings') drawSettings();
        if (v === 'presets') drawPresets();
        if (v === 'ref') drawRef();
        if (v === 'home' || v === 'print' || v === 'settings') drawGenbar();
        else if (ui) ui.closePopPanels();
        drawTabs();
        sh.setTitle(v === 'editor' ? fieldName(edField) : (v === 'ref' ? 'Reference' : v === 'presets' ? 'Open Preset' : (v === 'settings' && layout() !== 'tabs' ? 'Settings' : 'DreamStudio')));
        sh.refreshTitleAction();
        sh.refreshSoftKeys();
    }

    // ---------------------------------------------------------------- changes

    function change(id, value) {
        snap = null;
        return Promise.resolve(M.set(id, value)).catch((err) => console.warn('[wmDreamStudio] set', id, err));
    }

    function onSettingsInput(e) {
        const t = e.target;
        if (!t || !t.dataset) return;
        if (t.closest && t.closest('.wm-listbox')) return;
        if (t.dataset.check) {
            const id = t.dataset.check;
            if (id === 'effort') change('effort', t.checked ? 'medium' : 'high');
            else change(id, !!t.checked);
        } else if (t.dataset.set && e.type === 'change') {
            const id = t.dataset.set;
            const raw = String(t.value || '').trim();
            if (id === 'seed') {
                if (raw === '') change('seedLock', false);
                else change('seed', raw).then(() => change('seedLock', true));
            } else if (raw !== '' && Number.isFinite(Number(raw))) {
                t.blur();
                change(id, Number(raw));
            } else {
                t.blur();
                snap = null;
                drawSettings();
            }
        }
    }

    // ---------------------------------------------------------------- layers

    function openLayer(name) {
        if (layout() === 'tabs' && name !== 'editor' && name !== 'presets' && name !== 'ref') { tab = name; paint(); return; }
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
    const boxOf = (field) => (field === 'prompt' || field === 'uc' ? $(`.wds-field[data-field="${field}"]`) : null);
    function edArea() { return (top() === 'editor' && boxOf(edField)) || $('.wds-ed-text'); }

    function edCount() {
        const ta = edArea();
        const out = $('.wds-ed-head > span');
        if (ta && out) drawTokens(edField, ta.value, out);
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

    function stepWeight(dir) {
        const ta = edArea();
        if (!ta) return;
        ta.focus();
        const text = ta.value;
        const hit = weightAt(text, ta.selectionStart, ta.selectionEnd);
        let from; let to; let inner; let next;
        if (hit) {
            ({ from, to, inner } = hit);
            next = Math.round((hit.weight + dir * 0.1) * 100) / 100;
        } else {
            const range = ta.selectionStart !== ta.selectionEnd ? { from: ta.selectionStart, to: ta.selectionEnd } : tagAt(text, ta.selectionStart);
            if (!range) return;
            ({ from, to } = range);
            inner = text.slice(from, to);
            next = Math.round((1 + dir * 0.1) * 100) / 100;
        }
        next = Math.max(-3, Math.min(5, next));
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
        out.textContent = w.toFixed(2);
        // the jog takes the strength's colour: -3 .. 1 .. 5 as -1 .. 0 .. 1, most of it by 2 / 0
        if (edJog) edJog.tone(w >= 1 ? Math.min(1, (w - 1) / 1) : Math.max(-1, (w - 1) / 1));
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
        if (!tok) { acHide(); return; }
        acTimer = setTimeout(() => {
            const seq = ++acSeq;
            M.suggest(tok.text).then((list) => {
                const now = acToken();
                if (seq !== acSeq || top() !== 'editor' || !now || now.text !== tok.text) return;
                const box = $('.wds-ac');
                if (!list.length) { box.hidden = true; box.textContent = ''; return; }
                box.innerHTML = list.slice(0, 30).map((r) => `<button type="button" class="wm-listbox-row" data-key="${esc(r.text)}"><span>${esc(r.text)}</span></button>`).join('');
                box.hidden = false;
                box.scrollTop = 0;
            });
        }, 250);
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
            if (layout() === 'tabs') { tab = 'print'; paint(); } else if (!beside) openLayer('print'); else paint();
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
        choosePicture('Base Image', (f) => { if (M.setBaseImage(f)) { snap = null; layers = []; tab = 'prompt'; if (sh.current !== APP_ID) sh.open(APP_ID); paint(); } });
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
            if (kind === 'number') return `<button type="button" class="wm-tool is-text" data-gb="${id}" aria-label="${esc(label)}" aria-haspopup="dialog" title="${esc(label)}"></button>`;
            // UC is the desktop's level meter (four boxes), not a picture
            if (id === 'uc') return `<button type="button" class="wm-tool" data-gb="uc" aria-label="${esc(label)}" aria-haspopup="listbox" title="${esc(label)}"><span class="wms-uc-meter" data-level="0"><i></i><i></i><i></i><i></i></span></button>`;
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
    const fmtNum = (id, v) => { const c = GEN_NUMBERS[id]; const dg = (String(c.step).split('.')[1] || '').length; return Number(v == null ? c.def : v).toFixed(dg); };

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
        comboFace(q('model'), model ? model.short : (s.model || 'Model'), model && model.badge, model && model.badgeClass);
        const eff = q('effort');
        eff.hidden = !o.has.effort;
        eff.setAttribute('aria-pressed', String(s.effort === 'medium'));
        const size = flat(o.resolutions).find((x) => x.value === s.resolution);
        if (size) { const f = sizeBadge(size); comboFace(q('resolution'), f.name, f.badge, f.cls); } else comboFace(q('resolution'), s.width && s.height ? `${s.width} x ${s.height}` : 'Size');
        Object.keys(GEN_NUMBERS).forEach((id) => { q(id).textContent = fmtNum(id, s[id]); });
        q('steps').disabled = !o.has.steps;
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
            genList(b, grouped(o.resolutions, sizeName), s.resolution, (v) => change('resolution', v).then(() => { if (/^custom/.test(String(v))) openLayer('settings'); }));
            return;
        }
        if (id === 'uc') { genList(b, o.ucPresets.map((x) => [x.value, x.name]), Number(s.append_uc) || 0, (v) => change('append_uc', v)); return; }
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
            ui.valuePop(b, Object.assign({}, c, { label, value: Number(s[id] == null ? c.def : s[id]), onChange: (v) => { b.textContent = fmtNum(id, v); queueSet(id, v); } }));
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

    function weightPanel(anchor, label, rowsOf, write) {
        let rows = [];
        const pop = ui.popPanel(anchor, {
            label,
            className: 'wds-wtpop',
            build(el) {
                const fill = () => {
                    rows = rowsOf();
                    const top = el.scrollTop;
                    el.innerHTML = rows.map((r, i) => {
                        if (r.head) return `<div class="wm-form-sub wds-wt-head${r.minor ? ' is-minor' : ''}">${esc(r.head)}</div>`;
                        return `<div class="wds-wt-row" data-i="${i}"><label class="wm-check"><input type="checkbox" data-i="${i}"${r.on ? ' checked' : ''}><span>${esc(r.name)}</span></label><button type="button" class="wm-tool is-text wds-wt-value" data-i="${i}" aria-label="${esc(r.name)} weight" aria-haspopup="dialog">${fmtWt(r.bias)}</button></div>`;
                    }).join('') || '<div class="wm-form-sub wds-wt-head">None</div>';
                    el.scrollTop = top;
                };
                fill();
                el.addEventListener('change', (e) => {
                    const t = e.target;
                    const r = t && t.dataset && rows[Number(t.dataset.i)];
                    if (!r) return;
                    // a ratio group's rows are one of several: checking one clears the others (the desktop's own rule)
                    Promise.resolve(write(r, { on: !!t.checked })).then(() => { snap = null; fill(); drawGenbar(); });
                });
                el.addEventListener('click', (e) => {
                    const v = e.target.closest && e.target.closest('.wds-wt-value');
                    if (!v || ui.popPanelJustClosed(v)) return;
                    const r = rows[Number(v.dataset.i)];
                    if (!r) return;
                    let timer = 0;
                    ui.valuePop(v, {
                        label: r.name,
                        min: r.min,
                        max: r.max,
                        step: 0.1,
                        value: r.bias,
                        def: r.def,
                        onChange: (n) => {
                            v.textContent = fmtWt(n);
                            clearTimeout(timer);
                            timer = setTimeout(() => { Promise.resolve(write(r, { bias: n })).then(() => { r.bias = n; snap = null; drawGenbar(); }); }, 120);
                        }
                    });
                });
            }
        });
        return pop;
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
                const s0 = read();
                el.innerHTML = `${ui.edit('', s0.seedText || '', 'data-seed inputmode="numeric" placeholder="Random" aria-label="Seed"')}`
                    + `<button type="button" class="wm-tool" data-seed-act="clear" aria-label="Clear Seed" title="Clear Seed">${toolIcon('fa-regular fa-xmark-large')}</button>`
                    + `<button type="button" class="wm-tool" data-seed-act="random" aria-label="Random Seed" title="Random Seed">${toolIcon('nai-dice')}</button>`
                    + `<button type="button" class="wm-tool" data-seed-act="lock" aria-label="Keep this seed" title="Keep this seed" aria-pressed="false">${toolIcon('fas fa-seedling')}</button>`;
                const field = el.querySelector('[data-seed]');
                const lock = el.querySelector('[data-seed-act="lock"]');
                let typed = field.value;
                const show = () => {
                    snap = null;
                    const s = read();
                    if (document.activeElement !== field) field.value = typed = s.seedText || '';
                    lock.setAttribute('aria-pressed', String(!!s.seedLock));
                    paint();
                };
                // a typed seed: used by the next print; kept if the lock is on
                const commit = () => {
                    const raw = String(field.value || '').replace(/[^0-9]/g, '');
                    if (raw === typed) return Promise.resolve();
                    typed = raw;
                    if (raw === '') return Promise.resolve(M.clearSeed()).then(show);
                    const locked = !!read().seedLock;
                    return Promise.resolve(locked ? M.clearSeed() : null).then(() => change('seed', Number(raw))).then(() => (locked ? change('seedLock', true) : null)).then(show);
                };
                field.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit().then(() => field.blur()); } });
                field.addEventListener('change', () => { commit(); });
                el.addEventListener('wds-seed-close', () => { commit(); });
                el.addEventListener('click', (e) => {
                    const b = e.target.closest && e.target.closest('[data-seed-act]');
                    if (!b) return;
                    const act = b.dataset.seedAct;
                    let done;
                    if (act === 'clear') done = Promise.resolve(M.clearSeed());
                    else if (act === 'random') done = Promise.resolve(read().seedLock ? M.clearSeed() : null).then(() => M.randomSeed()).then(() => change('seedLock', true));
                    else done = commit().then(() => change('seedLock', !read().seedLock));
                    Promise.resolve(done).then(() => { field.blur(); show(); });
                });
                lock.setAttribute('aria-pressed', String(!!s0.seedLock));
            },
            onClose(el) { el.dispatchEvent(new CustomEvent('wds-seed-close')); }
        });
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
            { label: 'Delete', disabled: none, action: deletePrint }
        ];
    }

    function mainMenu() {
        const v = view();
        const rows = [];
        if (v === 'print') rows.push(...printRows(), '-');
        else rows.push({ label: 'Print', submenu: printRows }, '-');
        if (layout() !== 'tabs' && v !== 'settings') rows.push({ label: 'Settings', action: () => openLayer('settings') });
        if (M.options().has.characters) rows.push({ label: 'Add Character', action: addCharacter });
        if (M.options().has.references) rows.push({ label: 'Add Reference...', action: addReference });
        rows.push({ label: 'Base Image...', action: chooseBase });
        if (read().hasBaseImage) rows.push({ label: 'Remove Base Image', action: () => { M.clearBaseImage(); snap = null; paint(); } });
        rows.push('-', { label: 'New Session', action: newSession }, { label: 'Open Picture...', action: openPictureSession }, { label: 'Open Preset...', action: showPresets }, { label: 'Save as Preset...', action: savePresetAs }, ...syncRows());
        return rows;
    }

    function editorMenu() {
        const rows = [
            { label: 'Undo', action: () => edCommand('undo') },
            { label: 'Redo', action: () => edCommand('redo') },
            '-',
            { label: 'Cut', action: () => edCommand('cut') },
            { label: 'Copy', action: () => edCommand('copy') },
            { label: 'Paste', action: () => edCommand('paste') },
            { label: 'Select All', action: () => edCommand('selectall') },
            { label: 'Clear', action: () => edCommand('clear') },
            '-',
            { label: 'Find...', action: findAsk },
            { label: 'Find Next', disabled: !findText, action: findNext },
            '-',
            { label: 'Generate', action: generate }
        ];
        const c = charOf(edField);
        if (c) rows.push('-', { label: 'Rename Character...', action: () => renameCharacter(c.index) }, { label: 'Remove Character', action: () => removeCharacter(c.index) });
        return rows;
    }

    function softKeys() {
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
<div class="wds-pane wds-home">
  <button type="button" class="wds-strip"><img class="wds-strip-thumb" alt="" hidden><div class="wds-strip-text"><b></b><span></span><div class="wds-bar" hidden><span></span></div></div></button>
  <div class="wds-fields">
    <div class="wds-label" data-for="prompt"><span>Prompt</span><span></span></div>
    <textarea class="wds-field" data-field="prompt" placeholder="Tap here to write the prompt" spellcheck="false" autocapitalize="off" autocomplete="off"></textarea>
    <div class="wds-label" data-for="uc"><span>Undesired</span><span></span></div>
    <textarea class="wds-field" data-field="uc" placeholder="Tap here to list what to leave out" spellcheck="false" autocapitalize="off" autocomplete="off"></textarea>
    <div class="wds-chars" hidden></div>
    <div class="wds-refs" hidden></div>
    <button type="button" class="wds-base" hidden><img alt=""><div><b>Base image</b><span></span></div></button>
  </div>
  <button type="button" class="wds-summary"><b>Settings</b><span></span></button>
</div>
<div class="wds-pane wds-settings"><div class="wm-form"></div></div>
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
<div class="wds-toolbar wm-toolbar">${ED_BAR.map((b) => (b === '|' ? '<span class="wm-tool-sep"></span>' : `<button type="button" class="wm-tool" data-ed="${b[0]}" aria-label="${b[1]}">${edIcon(b[0])}</button>`)).join('')}<span class="wm-tool-sep"></span><span class="wds-tb-weight wm-lcd" aria-live="polite" aria-label="Emphasis">1.00</span><span class="wm-tool-sep"></span><button type="button" class="wm-tool" data-ed="find" aria-label="Find">${edIcon('find')}</button></div>
</div>
<div class="wds-genbar wm-toolbar" role="toolbar" aria-label="Generation settings"></div>
<div class="wm-tabs wds-tabs" role="tablist">${TABS.map(([id, label]) => `<button type="button" class="wm-tab" role="tab" data-tab="${id}" aria-selected="false">${label}</button>`).join('')}</div>`;

        $('.wds-strip').addEventListener('click', () => openLayer('print'));
        $('.wds-summary').addEventListener('click', () => openLayer('settings'));
        $('.wds-base').addEventListener('click', () => openLayer('settings'));
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
        $('.wds-tabs').addEventListener('click', (e) => {
            const b = e.target.closest && e.target.closest('.wm-tab');
            if (!b || b.dataset.tab === tab) return;
            tab = b.dataset.tab;
            paint();
        });
        const form = $('.wds-settings');
        form.addEventListener('change', onSettingsInput);
        form.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target && e.target.dataset && e.target.dataset.set) e.target.blur(); });

        // the editor: the bar keeps the focus (and the keyboard) in the text
        const bar = $('.wds-toolbar');
        // the emphasis jog (Yukimi, Nov 15; it replaced - and +): rolled sideways it steps the weight of
        // the group under the caret (or makes one of the selection / the tag there)
        const kit = window.wmSettings && window.wmSettings.ui;
        if (kit && typeof kit.jogWheel === 'function') {
            edJog = kit.jogWheel(bar, { label: 'Emphasis', stepPx: 10, onStep: (d) => stepWeight(d) });
            edJog.el.removeAttribute('tabindex');
            bar.querySelector('.wds-tb-weight').after(edJog.el);
        }
        bar.addEventListener('touchmove', (e) => { if (e.cancelable) e.preventDefault(); }, { passive: false });
        bar.addEventListener('mousedown', (e) => e.preventDefault());
        bar.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('.wm-tool[data-ed]'); if (b) edCommand(b.dataset.ed); });
        let countTimer = 0;
        p.querySelectorAll('.wds-ed-text, .wds-field').forEach((area) => {
            area.addEventListener('input', () => { if (top() !== 'editor') return; clearTimeout(countTimer); countTimer = setTimeout(edCount, 400); acQueue(); });
            ['keyup', 'pointerup', 'select'].forEach((t) => area.addEventListener(t, () => { if (top() === 'editor') edWeight(); }));
            area.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== edArea()) acHide(); }, 0));
        });
        // the list keeps the focus (and the keyboard) in the text; a tap on a row puts the tag in
        const ac = $('.wds-ac');
        ac.addEventListener('mousedown', (e) => e.preventDefault());
        ac.addEventListener('click', (e) => { const r = e.target.closest && e.target.closest('.wm-listbox-row'); if (r) acPick(r.dataset.key); });
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
            if (layout() === 'tabs') layers = layers.filter((l) => l === 'editor' || l === 'presets' || l === 'ref');
            ensureStudio().then(() => { snap = null; paint(); });
            paint();
        },
        hide() { shown = false; if (ui) ui.closePopPanels(); },
        historyDepth: () => layers.length + (ui && ui.popPanelOpen() ? 1 : 0),
        onBack: () => (ui && ui.closePopPanel()) || popLayer(),
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
            init: () => ({ layout: layout(), next: stored(NEXT_KEY) === '1' }),
            render(el, t, d) {
                const u = S.ui;
                el.innerHTML = u.sub('Layout')
                    + u.radio('wdsLayout', 'page', 'One page: the print as a strip at the top', d.layout === 'page')
                    + u.radio('wdsLayout', 'tabs', 'Tabs: Prompt, Settings, Print', d.layout === 'tabs')
                    + u.gap()
                    + u.sub('Program')
                    + u.check('wdsNext', 'Use the new DreamStudio', d.next)
                    + u.note('The new DreamStudio is being built (#860). The switch takes effect the next time Melaton Mobile starts.');
                el.querySelectorAll('input[name="wdsLayout"]').forEach((r) => r.addEventListener('change', () => { if (r.checked) d.layout = r.value; }));
                el.querySelector('input[name="wdsNext"]').addEventListener('change', (e) => { d.next = !!e.target.checked; });
            },
            commit(d) {
                store(LAYOUT_KEY, d.layout === 'tabs' ? 'tabs' : 'page');
                store(NEXT_KEY, d.next ? '1' : '0');
                layers = layers.filter((l) => l === 'editor');
                stale = true;
                return ['wmStudioLayout'];
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
    window.wmDreamStudio = { active: NEXT, show(name) { if (!NEXT || !sh) return; layers = []; tab = name === 'print' ? 'print' : 'prompt'; if (name === 'print' && layout() !== 'tabs') layers = ['print']; sh.open(APP_ID); paint(); } };

    if (window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
