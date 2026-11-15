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
    const ED_BAR = [['undo', 'Undo'], ['redo', 'Redo'], '|', ['cut', 'Cut'], ['copy', 'Copy'], ['paste', 'Paste'], ['selectall', 'Select All']];

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

    function pictureUrl(f) {
        if (!f) return '';
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
            box.textContent = text || (id === 'prompt' ? 'Tap here to write the prompt' : 'Tap here to list what to leave out');
            box.classList.toggle('is-empty', !text);
            drawTokens(id, text, $(`.wds-label[data-for="${id}"] > span:last-child`));
        });
        const sum = $('.wds-summary > span');
        if (sum && s.model !== undefined) sum.textContent = summaryText(s, M.options());
        drawStrip();
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
        host.innerHTML = rows.join('');
        const lists = { model: models, resolution: sizes, sampler: o.samplers.map((x) => [x.value, x.name]), noiseScheduler: o.noise.map((x) => [x.value, x.name]), n: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => [n, String(n)]) };
        host.querySelectorAll('.wm-combo[data-act]').forEach((btn) => {
            const id = btn.dataset.act;
            ui.bindCombo(btn, lists[id] || [], id === 'n' ? (Number(s.n) || 1) : s[id], (v) => change(id, v));
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
                cells.push(`<button type="button" data-file="${esc(f || '')}"${f ? '' : ' disabled'}>${f ? `<img alt="" src="${esc(pictureUrl(f))}">` : (live ? `<img alt="" src="${esc(r.frame)}">` : esc(String(i + 1)))}</button>`);
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
        if (src) { if (img.getAttribute('src') !== src) img.src = src; img.hidden = false; } else { img.hidden = true; img.removeAttribute('src'); }
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
        if (v === 'home' || v === 'print') { drawHome(); drawPrint(); }
        if (v === 'settings') drawSettings();
        drawTabs();
        sh.setTitle(v === 'editor' ? FIELD_NAMES[edField] : (v === 'settings' && layout() !== 'tabs' ? 'Settings' : 'DreamStudio'));
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
        if (layout() === 'tabs' && name !== 'editor') { tab = name; paint(); return; }
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

    function edArea() { return $('.wds-ed-text'); }

    function edCount() {
        const ta = edArea();
        const out = $('.wds-ed-head > span');
        if (ta && out) drawTokens(edField, ta.value, out);
    }

    function edLoad() {
        const ta = edArea();
        if (!ta) return;
        ta.value = read()[edField] || '';
        const label = $('.wds-ed-head > .wm-combo > span');
        if (label) label.textContent = FIELD_NAMES[edField];
        edCount();
    }

    function edCommit() {
        const ta = edArea();
        if (!ta) return Promise.resolve();
        if ((read()[edField] || '') === ta.value) return Promise.resolve();
        return change(edField, ta.value);
    }

    function openEditor(field) {
        edField = FIELD_NAMES[field] ? field : 'prompt';
        if (top() !== 'editor') layers.push('editor');
        paint();
        edLoad();
        const ta = edArea();
        if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
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
            edLoad();
            sh.setTitle(FIELD_NAMES[edField]);
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
        document.execCommand(id);
        edCount();
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
            { label: 'Upscale', disabled: none, action: () => printAction('upscale') },
            { label: 'Expand Canvas...', disabled: none, action: () => printAction('expand-canvas') },
            { label: 'Save to Phone', disabled: none, action: () => printAction('download') },
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
        rows.push({ label: 'New Session', action: newSession });
        return rows;
    }

    function editorMenu() {
        return [
            { label: 'Undo', action: () => edCommand('undo') },
            { label: 'Redo', action: () => edCommand('redo') },
            '-',
            { label: 'Cut', action: () => edCommand('cut') },
            { label: 'Copy', action: () => edCommand('copy') },
            { label: 'Paste', action: () => edCommand('paste') },
            { label: 'Select All', action: () => edCommand('selectall') },
            { label: 'Clear', action: () => edCommand('clear') },
            '-',
            { label: 'Generate', action: generate }
        ];
    }

    function softKeys() {
        if (top() === 'editor') return { left: { label: 'Done', action: closeEditor }, right: { label: 'Menu', menu: editorMenu } };
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
    <div class="wds-field" role="button" tabindex="0" data-field="prompt"></div>
    <div class="wds-label" data-for="uc"><span>Undesired</span><span></span></div>
    <div class="wds-field" role="button" tabindex="0" data-field="uc"></div>
  </div>
  <button type="button" class="wds-summary"><b>Settings</b><span></span></button>
</div>
<div class="wds-pane wds-settings"><div class="wm-form"></div></div>
<div class="wds-pane wds-print">
  <div class="wds-stage"><img alt="" hidden><div class="wds-grid" hidden></div><div class="wds-empty">No print yet. Generate makes one.</div></div>
  <div class="wds-status" hidden><span></span><div class="wds-bar"><span></span></div></div>
</div>
<div class="wds-pane wds-editor">
  <div class="wds-ed-head"><button type="button" class="wm-combo"><span></span></button><span></span></div>
  <textarea class="wds-ed-text" spellcheck="false" autocapitalize="off" autocomplete="off"></textarea>
  <div class="wds-ac wm-listbox" hidden></div>
  <div class="wds-toolbar">${ED_BAR.map((b) => (b === '|' ? '<span class="wds-tb-sep"></span>' : `<button type="button" class="wds-tb-btn" data-ed="${b[0]}" aria-label="${b[1]}">${edIcon(b[0])}</button>`)).join('')}</div>
</div>
</div>
<div class="wm-tabs wds-tabs" role="tablist">${TABS.map(([id, label]) => `<button type="button" class="wm-tab" role="tab" data-tab="${id}" aria-selected="false">${label}</button>`).join('')}</div>`;

        $('.wds-strip').addEventListener('click', () => openLayer('print'));
        $('.wds-summary').addEventListener('click', () => openLayer('settings'));
        p.querySelectorAll('.wds-field').forEach((b) => b.addEventListener('click', () => openEditor(b.dataset.field)));
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
        bar.addEventListener('touchmove', (e) => { if (e.cancelable) e.preventDefault(); }, { passive: false });
        bar.addEventListener('mousedown', (e) => e.preventDefault());
        bar.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('.wds-tb-btn'); if (b) edCommand(b.dataset.ed); });
        let countTimer = 0;
        edArea().addEventListener('input', () => { clearTimeout(countTimer); countTimer = setTimeout(edCount, 400); acQueue(); });
        edArea().addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== edArea()) acHide(); }, 0));
        // the list keeps the focus (and the keyboard) in the text; a tap on a row puts the tag in
        const ac = $('.wds-ac');
        ac.addEventListener('mousedown', (e) => e.preventDefault());
        ac.addEventListener('click', (e) => { const r = e.target.closest && e.target.closest('.wm-listbox-row'); if (r) acPick(r.dataset.key); });
        $('.wds-ed-head > .wm-combo').addEventListener('click', (e) => {
            e.stopPropagation();
            sh.dropdown(e.currentTarget, Object.keys(FIELD_NAMES).map((id) => ({ label: FIELD_NAMES[id], radio: id === edField, action: () => edSwitch(id) })), 'left');
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
            if (layout() === 'tabs') layers = layers.filter((l) => l === 'editor');
            ensureStudio().then(() => { snap = null; paint(); });
            paint();
        },
        hide() { shown = false; },
        historyDepth: () => layers.length,
        onBack: () => popLayer(),
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
