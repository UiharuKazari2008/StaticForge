/**
 * Melaton Mobile: DreamStudio part - Stages (#860 migration). Joins the program through
 * wmDreamStudio.extend; reaches Studio only through studioModel (studioModelStages.js adds what it needs).
 *
 * Pipeline stages: Menu > Add > Pipeline Stage, the stage list (a page of its own), each stage's
 * settings in a dialog (its buttons as tool cells, numbers as LCD + jog rows, lists as drop-downs),
 * Generate Stage, Stage Results and Remove All Stages. Characters: their positions (the 5 x 5 grid,
 * or the free centers on V5 models) and each one's Creative Directive line while Rentan's creative
 * mode is on, from the editor's Menu.
 */
(function () {
    'use strict';
    if (window.uiShell !== 'mobile' || !window.wmDreamStudio || typeof window.wmDreamStudio.extend !== 'function') return;
    window.wmDreamStudio.extend('Stages', (api, reg) => {
        const M = () => api.M;
        const esc = api.esc;
        const icon = (cls) => api.toolIcon(cls);
        // the stage's buttons as the desktop's tool bar has them (pipelineStageControls.js), in its order
        const TOOLS = [
            ['upscale', 'Upscale', 'nai-upscale'],
            ['saveResults', 'Save Results', 'fas fa-folder-download'],
            ['lockPrompt', 'Lock Prompt (skip Rentan, apply Expanders only)', 'fas fa-lock'],
            ['branch', 'Branch stage (independent from main pipeline)', 'fas fa-alt'],
            ['stop', 'Stop at this stage', 'fas fa-scalpel-line-dashed']
        ];
        // the settings row (the desktop's wrench) is open per stage while this page lives
        const advOpen = new Set();

        // ------------------------------------------------------------ the stage list

        function stageRows() {
            return M().stages();
        }

        function drawList(el) {
            const list = stageRows();
            const flags = (s) => TOOLS.filter(([k]) => s.toggles[k] && s.toggles[k].on).map(([, label, cls]) => `<span class="wds-stg-flag" title="${esc(label)}">${icon(cls)}</span>`).join('');
            el.innerHTML = list.length
                ? `<div class="wm-listbox wds-stg-list">${list.map((s) => `<div class="wm-listbox-row wds-stg-row${s.toggles.branch.on ? ' is-branch' : ''}" role="button" tabindex="0" data-stg="${esc(s.id)}"><span class="wds-stg-icon">${icon(s.icon)}</span><span class="wds-stg-name">${esc(s.label)}</span><span class="wds-stg-flags">${flags(s)}</span><span class="wds-stg-hex">${esc(s.hex)}</span></div>`).join('')}</div>`
                : '<p class="wds-none">No pipeline stages. Menu &gt; Add Stage adds one.</p>';
        }

        function addRows() {
            return M().stageTypes().map((t) => ({ label: t.label, action: () => addStage(t.key) }));
        }

        function addStage(key) {
            const id = M().addStage(key);
            api.openView('stages');
            if (id) openStage(id);
        }

        function generateRows() {
            return M().generateStageRows().map((r) => ({ label: r.note ? `${r.label} (${r.note})` : r.label, disabled: r.disabled, action: () => M().generateStage(r.index) }));
        }

        // at once, as the desktop's Remove All Stages (managed stages stay)
        function removeAll() { M().removeAllStages(); api.paint(); }

        function stagesMenu() {
            const any = stageRows().length > 0;
            return [
                { label: 'Add Stage', submenu: addRows },
                { label: 'Generate Stage', disabled: !any, submenu: generateRows },
                '-',
                { label: 'Stage Results', disabled: !M().stageResultsAvailable(), action: openResults },
                { label: 'Remove All Stages', disabled: !M().hasRemovableStages(), action: removeAll }
            ];
        }

        reg.view('stages', {
            title: 'Pipeline Stages',
            mount(el) {
                el.addEventListener('click', (e) => {
                    const r = e.target.closest && e.target.closest('[data-stg]');
                    if (r) openStage(r.dataset.stg);
                });
            },
            draw: drawList,
            menu: stagesMenu
        });

        // ------------------------------------------------------------ one stage's dialog

        let stg = null; // { id, el }

        const fmt = { level: (v) => Number(v).toFixed(1), strength: (v) => Number(v).toFixed(2), noise: (v) => Number(v).toFixed(2), steps: (v) => String(Math.round(v)), guidance: (v) => (Number(v) >= 10 ? '10' : Number(v).toFixed(1)), rescale: (v) => Number(v).toFixed(2) };
        // the desktop's ranges and wheel steps (pipelineStageControls.js); guidance keeps tenths there
        const NUM = {
            level: { label: 'Level', min: 1, max: 5.5, step: 0.5 },
            strength: { label: 'Strength', min: 0, max: 1, step: 0.1, fineStep: 0.01 },
            noise: { label: 'Noise', min: 0, max: 1, step: 0.1, fineStep: 0.01 },
            steps: { label: 'Steps', min: 1, max: 50, step: 1 },
            guidance: { label: 'Guidance', min: 0, max: 10, step: 0.1 },
            rescale: { label: 'Rescale', min: 0, max: 1, step: 0.1, fineStep: 0.01 }
        };

        const tool = (key, label, cls, pressed, extra = '') => `<button type="button" class="wm-tool" data-st="${key}" aria-label="${esc(label)}" title="${esc(label)}"${pressed == null ? '' : ` aria-pressed="${pressed ? 'true' : 'false'}"`}${extra}>${icon(cls)}</button>`;
        const lcdRow = (key, label, set, after = '') => `<div class="wds-wt-row wds-stg-num${set ? '' : ' is-inherited'}" data-num="${key}"><span class="wds-wt-name">${esc(label)}</span><span class="wds-wt-lcd wm-lcd"></span>${after}</div>`;
        const comboRow = (kind, label, text, set, after = '') => `<div class="wds-wt-row${set ? '' : ' is-inherited'}"><span class="wds-wt-name">${esc(label)}</span><button type="button" class="wm-combo wds-stg-combo" data-menu="${kind}"><span>${esc(text)}</span></button>${after}</div>`;

        function stageBody(s) {
            const t = s.toggles;
            const tools = [];
            if (s.show.mode) tools.push(tool('useBaseImage', 'Enhance (use the image before)', 'fas fa-diagram-venn', s.useBase));
            TOOLS.forEach(([k, label, cls]) => tools.push(tool(k, t[k].title || label, cls, t[k].on, t[k].disabled ? ' disabled' : '')));
            tools.push('<span class="wm-tool-sep"></span>', tool('advanced', 'Advanced Controls', 'fas fa-wrench', advOpen.has(s.id)));
            if (s.resetShown) tools.push(tool('reset', 'Reset to Inherited Values', 'nai-dot-reset', null));
            tools.push('<span class="wm-tool-sep"></span>', tool('up', 'Move Up', 'fas fa-arrow-up', null, s.index <= 1 || s.managed ? ' disabled' : ''), tool('down', 'Move Down', 'fas fa-arrow-down', null, s.index >= stageRows().length || s.managed ? ' disabled' : ''));
            const rows = [`<div class="wm-toolbar wds-stg-tools">${tools.join('')}</div>`];
            if (s.show.strength) rows.push(lcdRow('level', 'Level', s.level != null), lcdRow('strength', 'Strength', s.strengthSet || s.level == null), lcdRow('noise', 'Noise', s.noiseSet || s.level == null));
            if (s.show.resolution) rows.push(comboRow('resolution', s.show.strength ? 'Area' : 'Size', s.resolutionText, !s.resolutionInherited, s.show.inset ? tool('inset', 'Inset source when output is larger', 'fas fa-border-none', s.inset) : ''));
            if (s.show.custom) {
                rows.push(lcdRow('width', 'Width', true), lcdRow('height', 'Height', true));
                if (s.show.area) rows.push(`<div class="wds-wt-row"><span class="wds-wt-name">Area</span><button type="button" class="wm-button" data-st="area">${esc(s.areaText)}</button></div>`);
            }
            if (s.show.bias) rows.push(comboRow('bias', 'Position', s.biasText, true, s.bgFocus ? `<span class="wds-stg-flag${s.bgFocusInherited ? ' is-inherited' : ''}" title="Background Focus">${icon('fas fa-tree-city')}</span>` : ''));
            rows.push(`<div class="wds-wt-row wds-stg-seed${s.inheritSeed ? ' is-inherited' : ''}"><span class="wds-wt-name">Seed</span><button type="button" class="wds-wt-lcd wm-lcd" data-st="seed"${s.seedEditable ? '' : ' disabled'} aria-label="Seed"></button>`
                + `${s.show.autoSeed ? tool('autoSeed', 'Random seed', 'fas fa-seedling', s.autoSeed) : ''}${tool('inheritSeed', 'Inherit seed from previous stage', 'fas fa-link-simple', s.inheritSeed)}</div>`);
            if (advOpen.has(s.id)) {
                rows.push(lcdRow('steps', 'Steps', s.stepsSet), lcdRow('guidance', 'Guidance', s.guidanceSet, s.show.variety ? tool('variety', 'Enable Variety+', 'fas fa-sparkle', s.variety) : ''), lcdRow('rescale', 'Rescale', s.rescaleSet));
                rows.push(comboRow('sampler', 'Sampler', s.samplerText, s.samplerSet), comboRow('model', 'Model', s.modelText, s.modelSet));
                if (s.show.directive) rows.push(`<textarea class="wm-edit wds-stg-directive" rows="2" placeholder="Dear Kamisama..." spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="Directive">${esc(s.directive)}</textarea>`);
            }
            rows.push(`<div class="wm-msgbox-buttons"><button type="button" data-st="generate">Generate</button><button type="button" data-st="remove"${s.managed ? ' disabled' : ''}>Remove</button></div>`);
            return rows.join('');
        }

        function jogNum(row, key, s) {
            const lcd = row.querySelector('.wm-lcd');
            if (key === 'width' || key === 'height') {
                api.ui.segText(lcd, String(s[key] || 0).padStart(4, '!'));
                // the desktop's arrow keys: each step is the next legal size of the area
                api.ui.jogWheel(row, { label: NUM[key] ? NUM[key].label : key, stepPx: 24, zeroStop: 0, onStep: (d) => { M().stageSizeStep(stg.id, key, d); const n = M().stage(stg.id); if (n) { api.ui.segText(stg.el.querySelector('[data-num="width"] .wm-lcd'), String(n.width || 0).padStart(4, '!')); api.ui.segText(stg.el.querySelector('[data-num="height"] .wm-lcd'), String(n.height || 0).padStart(4, '!')); } } });
                return;
            }
            const spec = NUM[key];
            // Level shows blank until it is set (the desktop's empty box); its wheel starts at 3.0
            const value = key === 'level' ? (s.level != null ? s.level : (s.levelHint || 3)) : s[key];
            const show = (v) => api.ui.segText(lcd, v == null || !Number.isFinite(Number(v)) ? '' : fmt[key](v));
            show(key === 'level' && s.level == null ? null : value);
            let timer = 0;
            api.ui.jogWheel(row, {
                label: spec.label, value: Number(value) || spec.min, min: spec.min, max: spec.max, step: spec.step, fineStep: spec.fineStep || 0, stepPx: 18, zeroStop: 0,
                onChange: (v) => {
                    show(v);
                    row.classList.remove('is-inherited');
                    clearTimeout(timer);
                    timer = setTimeout(() => {
                        M().stageSet(stg.id, key, v);
                        // Level and Strength / Noise stand for each other (the desktop's rule): their rows follow
                        if (key === 'level' || key === 'strength' || key === 'noise') syncLevelRows();
                        syncReset();
                    }, 120);
                }
            });
        }

        function syncLevelRows() {
            if (!stg) return;
            const s = M().stage(stg.id);
            if (!s) return;
            ['level', 'strength', 'noise'].forEach((k) => {
                const row = stg.el.querySelector(`[data-num="${k}"]`);
                if (!row) return;
                const set = k === 'level' ? s.level != null : (s[`${k}Set`] || s.level == null);
                row.classList.toggle('is-inherited', !set);
                api.ui.segText(row.querySelector('.wm-lcd'), k === 'level' ? (s.level != null ? fmt.level(s.level) : '') : fmt[k](s[k]));
            });
        }

        // the reset cell comes and goes with the stage's own values (the desktop's rule)
        function syncReset() {
            if (!stg) return;
            const s = M().stage(stg.id);
            const has = !!stg.el.querySelector('[data-st="reset"]');
            if (s && s.resetShown !== has) fill();
        }

        function fill() {
            if (!stg || !stg.el.isConnected) { stg = null; return; }
            const s = M().stage(stg.id);
            if (!s) { api.closeDlg(); stg = null; return; }
            const title = stg.el.querySelector('.wm-msgbox-title > span');
            if (title) title.textContent = s.label;
            const body = stg.el.querySelector('.wds-dlg-body');
            body.innerHTML = stageBody(s);
            body.querySelectorAll('[data-num]').forEach((row) => jogNum(row, row.dataset.num, s));
            const seed = body.querySelector('[data-st="seed"]');
            if (seed) api.ui.segText(seed, /^\d+$/.test(String(s.seed)) ? String(s.seed).padStart(10, '!') : '!!!!!!!!!!');
            const ta = body.querySelector('.wds-stg-directive');
            if (ta) ta.addEventListener('input', () => M().stageSet(stg.id, 'directive', ta.value));
        }

        function openStage(id) {
            const s = M().stage(id);
            if (!s) return;
            const el = api.openDlg(s.label, 'wds-stgdlg', '');
            stg = { id, el };
            el.addEventListener('click', onStageClick);
            fill();
        }

        function onStageClick(e) {
            if (!stg) return;
            const b = e.target.closest && e.target.closest('[data-st], [data-menu]');
            if (!b || b.disabled) return;
            const id = stg.id;
            if (b.dataset.menu) { stageDrop(b, b.dataset.menu); return; }
            const act = b.dataset.st;
            if (act === 'advanced') { if (advOpen.has(id)) advOpen.delete(id); else advOpen.add(id); fill(); return; }
            if (act === 'up' || act === 'down') { M().moveStage(id, act === 'up' ? -1 : 1); fill(); return; }
            if (act === 'area') { M().stageAreaToggle(id); fill(); return; }
            if (act === 'generate') { api.closeDlg(); stg = null; M().generateStage(M().stage(id) ? M().stage(id).index : 0); return; }
            if (act === 'remove') { api.closeDlg(); stg = null; M().removeStage(id); api.paint(); return; }
            if (act === 'seed') {
                api.ui.numPad({ title: 'Seed', value: '', max: 10, onOk: (text) => { M().stageSet(id, 'seed', text); fill(); } });
                return;
            }
            M().stageToggle(id, act);
            fill();
        }

        function stageDrop(btn, kind) {
            const rows = M().stageMenu(stg.id, kind);
            const id = stg.id;
            api.sh.dropdown(btn, rows.map((r) => (r === '-' ? '-' : r.check
                ? { label: r.label, checked: !!r.checked, action: () => { M().stageToggle(id, 'bgFocus'); fill(); } }
                : { label: r.label, radio: !!(r.selected || r.current), action: () => { M().stagePick(id, kind, r.index); fill(); } })), 'left', () => { if (pop) pop.style.zIndex = ''; });
            overDialog();
        }

        // the shell's drop-down sits under the message-box layer the dialogs use: lifted over it
        // while it is open from a dialog (kit request: drop-downs opened inside a dialog)
        let pop = null;
        function overDialog() {
            pop = document.querySelector('#wmShell .wm-popup');
            if (pop && !pop.hidden) pop.style.zIndex = '21';
        }

        // ------------------------------------------------------------ Stage Results

        function openResults() {
            api.sh.busy(Promise.resolve(M().loadStageResults()).catch((err) => console.warn('[wmDreamStudio] stage results', err)), { delay: 250 })
                .then(() => { if (M().stageResults().length) api.openView('stageresults'); });
        }

        const RESULT_ROWS = [
            ['View', 'view'],
            ['Use Its Settings', 'modify-preview'],
            ['Use as Base Image', 'load-base-image'],
            ['Favorite', 'toggle-favorite'],
            ['Save to Phone', 'download'],
            ['Copy Lookback', 'copy-lookback'],
            ['Properties', 'view-image-data']
        ];

        function viewResult(r) {
            const src = api.pictureUrl(r.filename) || api.thumbUrl(r.filename);
            api.openDlg(r.label, 'wds-srdlg', `<img class="wds-sr-pic" alt="" src="${esc(src)}">`);
        }

        reg.view('stageresults', {
            title: 'Stage Results',
            mount(el) {
                el.addEventListener('click', (e) => {
                    const row = e.target.closest && e.target.closest('[data-sr]');
                    if (!row) return;
                    const r = M().stageResults()[Number(row.dataset.sr)];
                    if (!r || !r.filename) return;
                    api.sh.dropdown(row, RESULT_ROWS.map(([label, action]) => ({ label, action: () => (action === 'view' ? viewResult(r) : M().stageResultAction(r.index, action)) })), 'left');
                });
            },
            draw(el) {
                const list = M().stageResults();
                el.innerHTML = list.length
                    ? `<div class="wm-listbox wds-sr-list">${list.map((r) => `<div class="wm-listbox-row wds-sr-row${r.filename ? '' : ' is-empty'}" role="button" tabindex="0" data-sr="${r.index}">${r.filename ? `<img alt="" src="${esc(api.thumbUrl(r.filename))}">` : '<span class="wds-sr-blank"></span>'}<span class="wds-sr-text"><b>${esc(r.label)}</b>${r.filename ? '' : `<span>${esc(r.status)}</span>`}</span></div>`).join('')}</div>`
                    : '<p class="wds-none">No results</p>';
            },
            menu: stagesMenu
        });

        // the list fills as the stages land
        const M0 = M();
        if (M0 && typeof M0.on === 'function') {
            const redraw = () => { if (String(api.view()) === 'x:stageresults') api.paint(); };
            M0.on('progress', redraw);
            M0.on('end', redraw);
        }

        // ------------------------------------------------------------ character positions

        const COLS = ['A', 'B', 'C', 'D', 'E'];
        const AT = [0.1, 0.3, 0.5, 0.7, 0.9];

        /** The character the editor is on (the editor's head names it), or -1. */
        function editorCharacter() {
            if (api.view() !== 'editor') return -1;
            const head = api.$('.wds-ed-head > .wm-combo > span');
            const name = head ? head.textContent : '';
            const n = (api.read().characters || []).length;
            for (let i = 0; i < n; i++) if (name === api.fieldName(`c:${i}:prompt`) || name === api.fieldName(`c:${i}:uc`)) return i;
            return -1;
        }

        // V4: one character's cell on the 5 x 5 grid (the desktop's Character Position dialog); the
        // Auto Position switch (two characters or more) leaves them to the model
        function gridDialog(index) {
            const el = api.openDlg('Character Position', 'wds-posdlg', '');
            const body = el.querySelector('.wds-dlg-body');
            const draw = () => {
                const p = M().positions();
                const c = p.characters[index];
                if (!c) { api.closeDlg(); return; }
                const taken = new Set(c.taken);
                body.innerHTML = `<div class="wds-pos-who">${esc(c.name)}</div>`
                    + (p.autoShown ? api.ui.check('wdsPosAuto', 'Auto Position', p.auto, 'data-pos-auto') : '')
                    + `<div class="wds-pos-grid">${AT.map((y, r) => AT.map((x, col) => { const cell = `${COLS[col]}${r + 1}`; return `<button type="button" class="wm-button wds-pos-cell" data-cell="${cell}" data-x="${x}" data-y="${y}" aria-pressed="${c.cell === cell ? 'true' : 'false'}"${p.auto || taken.has(cell) ? ' disabled' : ''}>${cell}</button>`; }).join('')).join('')}</div>`;
            };
            body.addEventListener('change', (e) => { if (e.target && e.target.hasAttribute('data-pos-auto')) { M().setAutoPosition(!!e.target.checked); draw(); } });
            body.addEventListener('click', (e) => {
                const b = e.target.closest && e.target.closest('[data-cell]');
                if (!b || b.disabled) return;
                M().setPosition(index, Number(b.dataset.x), Number(b.dataset.y), b.dataset.cell);
                draw();
            });
            draw();
        }

        // V5: every character's center on one board (the desktop's Character Positions tool): a tap
        // on a pin picks it, a tap on the board moves the picked pin there, a pin can be dragged; the
        // centers are kept as they are placed (the tool's Save)
        function boardDialog(start) {
            const p0 = M().positions();
            if (!p0.characters.length) return;
            const el = api.openDlg('Character Positions', 'wds-posdlg', '');
            const body = el.querySelector('.wds-dlg-body');
            let active = Math.max(0, Math.min(p0.characters.length - 1, start));
            let pins = p0.characters.map((c) => ({ x: c.center.x, y: c.center.y }));
            const fmtC = (c) => `x ${c.x.toFixed(3)} \u00b7 y ${c.y.toFixed(3)}`;
            const draw = () => {
                const p = M().positions();
                body.innerHTML = `<div class="wds-pos-board">${p.imageUrl ? `<img class="wds-pos-img" alt="" src="${esc(p.imageUrl)}">` : ''}`
                    + p.characters.map((c, i) => `<button type="button" class="wds-pos-pin${i === active ? ' is-active' : ''}" data-pin="${i}" aria-label="Move ${esc(c.name)}" style="--wds-x:${(pins[i].x * 100).toFixed(2)}%;--wds-y:${(pins[i].y * 100).toFixed(2)}%">${i + 1}</button>`).join('')
                    + `</div><div class="wds-pos-read"><b>${esc((p.characters[active] || {}).name || '')}</b> <span>${fmtC(pins[active])}</span></div>`
                    + `<div class="wm-msgbox-buttons"><button type="button" data-pos="clear">Clear</button>${p.returned ? '<button type="button" data-pos="revert">Revert</button>' : ''}</div>`;
                const board = body.querySelector('.wds-pos-board');
                // the picture's shape at most 200 units high: the width follows, so x and y keep their scale
                board.style.aspectRatio = `${p.aspect.width} / ${p.aspect.height}`;
                board.style.width = `min(100%, calc(200 * var(--wm-px) * ${(p.aspect.width / Math.max(1, p.aspect.height)).toFixed(4)}))`;
            };
            const place = (i, ev, board) => {
                const r = board.getBoundingClientRect();
                if (!r.width || !r.height) return;
                pins[i] = { x: Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height)) };
                const pin = board.querySelector(`[data-pin="${i}"]`);
                if (pin) { pin.style.setProperty('--wds-x', `${(pins[i].x * 100).toFixed(2)}%`); pin.style.setProperty('--wds-y', `${(pins[i].y * 100).toFixed(2)}%`); }
                const read = body.querySelector('.wds-pos-read > span');
                if (read) read.textContent = fmtC(pins[i]);
            };
            const keep = () => { M().setPositions(pins); };
            let drag = null;
            body.addEventListener('pointerdown', (e) => {
                const board = e.target.closest && e.target.closest('.wds-pos-board');
                if (!board) return;
                e.preventDefault();
                const pin = e.target.closest('[data-pin]');
                if (pin) {
                    active = Number(pin.dataset.pin);
                    board.querySelectorAll('[data-pin]').forEach((n) => n.classList.toggle('is-active', n === pin));
                    const name = body.querySelector('.wds-pos-read > b');
                    if (name) name.textContent = (M().positions().characters[active] || {}).name || '';
                    drag = { id: e.pointerId, board };
                    try { pin.setPointerCapture(e.pointerId); } catch (_) { /* a synthetic pointer */ }
                    return;
                }
                place(active, e, board);
                keep();
            });
            body.addEventListener('pointermove', (e) => { if (drag && drag.id === e.pointerId) place(active, e, drag.board); });
            const end = (e) => { if (!drag || drag.id !== e.pointerId) return; const moved = drag; drag = null; place(active, e, moved.board); keep(); };
            body.addEventListener('pointerup', end);
            body.addEventListener('pointercancel', (e) => { if (drag && drag.id === e.pointerId) { drag = null; keep(); } });
            body.addEventListener('click', (e) => {
                const b = e.target.closest && e.target.closest('[data-pos]');
                if (!b) return;
                if (b.dataset.pos === 'clear') { M().clearPositions(); api.closeDlg(); return; }
                const back = M().revertPositions();
                pins = pins.map((c, i) => (back[i] ? back[i] : c));
                keep();
                draw();
            });
            draw();
        }

        function positionDialog(index) {
            const p = M().positions();
            if (p.freeform) boardDialog(index); else gridDialog(index);
        }

        // ------------------------------------------------------------ a character's Directive line

        function directiveDialog(index) {
            const c = (api.read().characters || [])[index];
            const name = (c && c.name) || `Character ${index + 1}`;
            const el = api.openDlg(`${name}: Directive`, 'wds-cdirdlg', `<textarea class="wm-edit wds-cdir" rows="4" placeholder="How Rentan should handle this character..." spellcheck="false" autocapitalize="sentences" autocomplete="off" aria-label="Directive">${esc(M().characterDirective(index))}</textarea>`);
            const ta = el.querySelector('textarea');
            ta.addEventListener('input', () => M().setCharacterDirective(index, ta.value));
            ta.focus();
        }

        // ------------------------------------------------------------ menus

        reg.menu('add', () => [{ label: 'Pipeline Stage', submenu: addRows }]);

        // Generate > Pipeline Stages; Prompt > the characters' positions (the desktop's Prompt menu)
        reg.menu('generate', () => [{ label: 'Pipeline Stages', submenu: () => [{ label: 'Edit Stages...', action: () => api.openView('stages') }, '-', ...stagesMenu()] }]);
        reg.menu('prompt', () => {
            const p = M().positions();
            // V5: the board for every character, and the last print's centers kept (Apply Character Positions)
            if (!p.freeform || !p.characters.length) return [];
            return [
                { label: 'Character Positions...', action: () => boardDialog(0) },
                { label: 'Apply Character Positions', disabled: !p.returned, action: () => { M().applyReturnedPositions(); api.paint(); } }
            ];
        });

        reg.menu('editor', () => {
            const i = editorCharacter();
            if (i < 0) return [];
            const p = M().positions();
            // V4 places one character only through Auto Position (the desktop hides its button then)
            const rows = [{ label: 'Position...', disabled: !p.freeform && p.characters.length < 2, action: () => positionDialog(i) }];
            if (M().directiveOn()) rows.push({ label: 'Character Directive...', action: () => directiveDialog(i) });
            return rows;
        });
    });
})();
