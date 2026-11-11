/**
 * Melaton Mobile: Phasewalker, a phone version of the desktop's stage builder
 * (bracketGenerationApplet.js, Start > Phasewalker = openBracketGenerationApplet), Yozora #732
 * (parent #709). Not the desktop window re-hosted: the desktop instance (window.bracketGenerationApplet)
 * keeps the work and does every job (keywords, stages, compile into Studio's pipeline, load from
 * Studio, delete compiled stages, New / Open / Save over the VFS: WM's file dialogs on phones); its
 * window stays closed and these WM 6.1 screens show and edit its state:
 *
 *   stages    the name band (document name, * when a bound file has changes; at its right what the
 *             desktop status bar says about Studio: Compiled, Not compiled, Studio closed), the Keyword
 *             combo (the keywords, then New Keyword...), the stages of that keyword as rows (the stage
 *             name, the Studio stage it compiles to - "Base image" for stage 00 with Use Stage 0 on -,
 *             "Compare" on the comparison source, its text under it) and WM's bottom tabs
 *             Prompt | Undesired (which text the rows show). Soft keys Compile (into Studio: it opens
 *             first when it is closed, then comes up on its Prompt page with the stages compiled) /
 *             Menu (Compile, Load from Studio, Delete Compiled Stages, Go to Studio, Keyword, Stage,
 *             Use Stage 0, File). Tap a row: the stage form; tap and hold: the Stage menu.
 *   stage     a WM form for one stage: Keyword (which keyword's text the form edits; switching keeps
 *             what was typed for the other), Name (shared by all keywords), Prompt, Undesired, the
 *             Comparison source box. ok saves; Cancel leaves it; Menu: Save, Previous / Next Stage
 *             (saving first), Move Up / Down, Delete Stage.
 *
 * Studio and Phasewalker work together as on the desktop: Studio's Generate > Phasewalker, the prompt
 * box's Phasewalker submenu (add a tag to a stage, Open Editor) and every other route to the desktop
 * window (openBracketGenerationApplet: Start, Run, desktop shortcuts, Atelier's bag, Naxt, the agent
 * bridge; .open from a file) open this app, with the state they bring (and compile it when they ask and
 * Studio is open, as on the desktop); opened with no work while Studio holds compiled stages, it loads
 * them (the desktop's open()). Only on phones.
 * Styles: public/css/wm-phasewalker.css (+ wm-suite-kit.css).
 */
(function () {
    'use strict';

    if (window.uiShell !== 'mobile' || !document.documentElement.classList.contains('ui-mobile')) return;

    const APP_ID = 'phasewalker';
    const TITLE = 'Phasewalker';
    const ICON = 'app-phasewalker';
    const NEW_KW = '\u0000new';

    let sh = null;
    let K = null;
    let page = null;
    let ready = false;
    let sel = 0; // selected stage index
    // the stage form: { index, keyword, drafts: { [keyword]: { prompt, uc } }, name, source }
    let editing = null;
    let layers = []; // 'stage'

    const view = () => layers[layers.length - 1] || 'list';
    const isCurrent = () => !!sh && sh.current === APP_ID;
    const esc = (s) => K.esc(s);
    const pw = () => window.bracketGenerationApplet || null;
    const yesNo = (text) => sh.messageBox({ title: TITLE, icon: 'question', text, buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false, default: true }] });

    // ---------------------------------------------------------------- the desktop instance

    async function ensure() {
        if (ready && pw()) return true;
        if (!await K.feature('bracket_gen')) return false;
        patchDesktop();
        const a = pw();
        if (!a) return false;
        if (!a.modal) a.init();
        ready = !!a.modal;
        return ready;
    }

    /** Run one of the desktop's commands (its dialogs are WM boxes here), then show its state. */
    async function run(fn) {
        if (!await ensure()) {
            await sh.messageBox({ title: TITLE, icon: 'error', text: 'Phasewalker could not be loaded.' });
            return undefined;
        }
        let r;
        try { r = await fn(pw()); } catch (err) {
            await sh.messageBox({ title: TITLE, icon: 'error', text: K.errText(err) || 'That did not work.' });
        }
        render();
        return r;
    }

    const st = () => (pw() ? pw().state : { keywords: [], keywordSteps: {}, stepNames: [], activeKeyword: '', activeField: 'prompt', useStage0: true, compareSourceStepIndex: null });
    const steps = () => { const s = st(); return (s.activeKeyword && s.keywordSteps[s.activeKeyword]) || []; };
    const maxSteps = () => (pw() ? pw().getMaxStepCount() : 0);
    const stageName = (i) => (pw() ? pw().getStepDisplayName(i) : `Step ${i + 1}`);
    const isBase = (i) => i === 0 && !!st().useStage0;
    const stageLabel = (i) => (isBase(i) ? 'Base image' : `Stage ${pw() ? pw().getStepStageHexId(i) : String(i + 1).padStart(2, '0')}`);
    const hasCompiled = () => { try { /* global hasManagedBracketArtifacts */ return typeof hasManagedBracketArtifacts === 'function' && hasManagedBracketArtifacts(); } catch (_) { return false; } };

    /** What the desktop window's status bar says about Studio (updateToolbarAndStatus). */
    function compileStatus() {
        const a = pw();
        if (!a || !a.hasToolData()) return '';
        if (!K.studioOpen()) return 'Studio closed';
        let needs = true;
        try { needs = a.needsCompile(); } catch (_) { /* below */ }
        return needs ? 'Not compiled' : 'Compiled';
    }

    async function ensureStudio() {
        if (!K.studioOpen() && typeof window.openManualModalWithContent === 'function') {
            try { await sh.busy(() => window.openManualModalWithContent(), { paint: true }); } catch (_) { /* below */ }
        }
        if (!K.studioOpen()) { await sh.messageBox({ title: TITLE, icon: 'error', text: 'Studio could not be opened.' }); return false; }
        return true;
    }

    /** Studio comes up on its Prompt page (where compile put the keywords' placeholders). */
    function showStudio(tab = 'prompt') {
        sh.open('studio');
        const kit = window.wmStudioKit;
        if (kit && typeof kit.showTab === 'function') { try { kit.showTab(tab); } catch (_) { /* Studio's own page */ } }
    }

    async function compile() {
        if (!await ensure()) return;
        if (!maxSteps() || !st().keywords.length) { await sh.messageBox({ title: TITLE, icon: 'info', text: 'Add a keyword and at least one stage first.' }); return; }
        if (!await ensureStudio()) return;
        const a = pw();
        a.renderSteps(); // its text boxes read back the state before compile reads them
        let ok = false;
        await sh.busy(async () => {
            ok = a.compileStages() !== false;
            // its "Compiled N stages" toast is read while the wait cursor still shows: a routine done
            // answering this tap (Studio shows the result), not a notification after a slow first open
            await new Promise((r) => setTimeout(r, 300));
        }, { paint: true });
        render();
        if (ok) showStudio('prompt');
    }

    async function loadFromStudio() {
        const a = pw();
        if (a && a.hasToolData() && a.boundDocument() && a.isShortcutDirty()
            && !(await yesNo(`The stages from Studio will replace the changes to ${a.documentName()}. Continue?`))) return;
        await run((x) => x.loadFromEditor());
        sel = 0;
        render();
    }

    async function deleteCompiled() {
        await run((a) => a.deleteStages());
    }

    // ---------------------------------------------------------------- rendering

    function render() {
        if (!page) return;
        const v = view();
        page.querySelector('.wpw-list').hidden = v !== 'list';
        page.querySelector('.wpw-stage').hidden = v !== 'stage';
        if (v === 'list') renderList();
        if (isCurrent()) {
            sh.setTitle(TITLE);
            sh.refreshSoftKeys();
            sh.refreshTitleAction();
        }
    }

    function renderList() {
        const a = pw();
        const s = st();
        const box = page.querySelector('.wpw-list');
        const dirty = !!(a && a.boundDocument() && a.isShortcutDirty());
        box.querySelector('.wsk-head-name').textContent = `${a ? a.documentName() : 'Untitled'}${dirty ? ' *' : ''}`;
        const status = compileStatus();
        const stEl = box.querySelector('.wpw-status');
        stEl.textContent = status;
        stEl.dataset.state = status === 'Compiled' ? 'ok' : (status ? 'pending' : '');
        box.querySelector('.wpw-kw .wsk-combo-text').textContent = s.activeKeyword || (s.keywords.length ? '' : '(no keywords)');
        const list = steps();
        const n = s.activeKeyword ? Math.max(list.length, maxSteps()) : 0;
        if (sel >= n) sel = Math.max(0, n - 1);
        const field = s.activeField === 'uc' ? 'uc' : 'prompt';
        box.querySelector('.wpw-rows').innerHTML = Array.from({ length: n }, (_, i) => {
            const step = list[i] || { prompt: '', uc: '' };
            const text = String(step[field] || '').replace(/\s+/g, ' ').trim();
            const on = i === sel;
            const source = s.compareSourceStepIndex === i;
            return `<div class="wsk-row${on ? ' is-selected' : ''}" role="option" aria-selected="${on}" data-i="${i}">`
                + `<span class="wsk-ico"><img ${K.artAttrs(ICON)} alt="" draggable="false"></span>`
                + `<span class="wsk-name">${esc(stageName(i))}</span>`
                + `<span class="wsk-right">${source ? '<span class="wpw-compare">Compare</span> ' : ''}${esc(stageLabel(i))}</span>`
                + `<span class="wsk-sub${text ? '' : ' wpw-empty'}">${esc(text || (field === 'uc' ? '(no undesired content)' : '(no prompt)'))}</span></div>`;
        }).join('');
        const note = box.querySelector('.wsk-note');
        note.hidden = n > 0;
        note.textContent = s.keywords.length
            ? 'There are no stages. To add one, tap Menu, then Stage, then Add Stage.'
            : 'There are no keywords. To add one, tap Menu, then Keyword, then Add Keyword. Load from Studio brings back stages Studio has compiled.';
        box.querySelectorAll('.wsk-btab').forEach((t) => t.classList.toggle('is-selected', t.dataset.field === field));
    }

    function selectRow(i) {
        sel = i;
        page.querySelectorAll('.wpw-rows .wsk-row').forEach((r) => {
            const on = Number(r.dataset.i) === i;
            r.classList.toggle('is-selected', on);
            r.setAttribute('aria-selected', String(on));
        });
        if (isCurrent()) sh.refreshSoftKeys();
    }

    // ---------------------------------------------------------------- stage form

    const form = () => page.querySelector('.wpw-stage');

    /** The form's text boxes into the draft of the keyword they show. */
    function keepDraft() {
        if (!editing) return;
        const f = form();
        editing.drafts[editing.keyword] = { prompt: f.querySelector('[name="prompt"]').value, uc: f.querySelector('[name="uc"]').value };
        editing.name = f.querySelector('[name="name"]').value;
        editing.source = f.querySelector('[name="source"]').checked;
    }

    function paintForm() {
        const f = form();
        const i = editing.index;
        const kw = editing.keyword;
        const draft = editing.drafts[kw] || (() => {
            const step = (st().keywordSteps[kw] || [])[i] || { prompt: '', uc: '' };
            return { prompt: step.prompt || '', uc: step.uc || '' };
        })();
        f.querySelector('.wsk-head-name').textContent = (editing.name || '').trim() || `Step ${i + 1}`;
        f.querySelector('.wpw-form-stage').textContent = stageLabel(i);
        f.querySelector('.wpw-fkw .wsk-combo-text').textContent = kw;
        f.querySelector('.wpw-fkw').disabled = st().keywords.length < 2;
        const name = f.querySelector('[name="name"]');
        name.value = editing.name;
        name.placeholder = `Step ${i + 1}`;
        f.querySelector('[name="prompt"]').value = draft.prompt;
        f.querySelector('[name="prompt"]').placeholder = `Prompt for ${kw} in this stage`;
        f.querySelector('[name="uc"]').value = draft.uc;
        f.querySelector('[name="uc"]').placeholder = `Undesired content for ${kw} in this stage`;
        const src = f.querySelector('[name="source"]');
        const off = pw() ? pw().isCompareSourceStepDisabled(i) : true;
        src.checked = !off && !!editing.source;
        src.disabled = off;
        f.querySelector('.wpw-source').classList.toggle('is-disabled', off);
    }

    function openStage(i) {
        const s = st();
        if (!s.activeKeyword || i == null || i < 0 || i >= steps().length) return;
        const fresh = view() !== 'stage';
        sel = i;
        editing = { index: i, keyword: s.activeKeyword, drafts: {}, name: String(s.stepNames[i] || ''), source: s.compareSourceStepIndex === i };
        paintForm();
        form().querySelector('.wsk-body').scrollTop = 0;
        if (fresh) {
            layers.push('stage');
            render();
            sh.syncHistory();
        } else render();
    }

    /** The form into the desktop's state (the same calls its window makes). */
    function commitStage() {
        const a = pw();
        if (!a || !editing) return false;
        keepDraft();
        const i = editing.index;
        if (i >= a.getMaxStepCount()) return false;
        Object.entries(editing.drafts).forEach(([kw, d]) => {
            const step = (a.state.keywordSteps[kw] || [])[i];
            if (step) { step.prompt = d.prompt; step.uc = d.uc; }
        });
        a.setStepName(i, editing.name.trim());
        if (!a.isCompareSourceStepDisabled(i) && editing.source !== (a.state.compareSourceStepIndex === i)) {
            a.renderSteps(); // toggleCompareSourceStep reads the window's boxes back first
            a.toggleCompareSourceStep(i);
        }
        a.syncPipelineStageNameForStepIndex(i);
        a.renderSteps();
        return true;
    }

    function saveStage() {
        commitStage();
        closeStage();
    }

    function closeStage() {
        editing = null;
        if (view() === 'stage') layers.pop();
        render();
        sh.syncHistory();
    }

    function stepStage(delta) {
        if (!editing) return;
        const to = editing.index + delta;
        if (to < 0 || to >= maxSteps()) return;
        const kw = editing.keyword;
        commitStage();
        openStage(to);
        if (editing && st().keywords.includes(kw)) { editing.keyword = kw; paintForm(); }
    }

    async function moveInForm(delta) {
        if (!editing) return;
        const from = editing.index;
        const to = from + delta;
        if (to < 0 || to >= maxSteps()) return;
        const kw = editing.keyword;
        commitStage();
        await run((a) => a.moveStep(from, to));
        openStage(to);
        if (editing && st().keywords.includes(kw)) { editing.keyword = kw; paintForm(); }
    }

    async function deleteInForm() {
        if (!editing) return;
        const i = editing.index;
        if (!(await yesNo(`"${stageName(i)}" will be deleted for every keyword. Continue?`))) return;
        editing = null;
        if (view() === 'stage') layers.pop();
        await run((a) => a.removeStepAt(i));
        sh.syncHistory();
    }

    function formMenu() {
        const i = editing ? editing.index : 0;
        const n = maxSteps();
        return [
            { label: 'Save', action: saveStage },
            '-',
            { label: 'Previous Stage', disabled: i <= 0, action: () => stepStage(-1) },
            { label: 'Next Stage', disabled: i >= n - 1, action: () => stepStage(1) },
            '-',
            { label: 'Move Up', disabled: i <= 0, action: () => moveInForm(-1) },
            { label: 'Move Down', disabled: i >= n - 1, action: () => moveInForm(1) },
            { label: 'Delete Stage', disabled: n <= 1, action: deleteInForm }
        ];
    }

    // ---------------------------------------------------------------- menus / keys

    function stageMenu(i) {
        const n = maxSteps();
        const ok = i != null && i < n && !!st().activeKeyword;
        const a = pw();
        const srcOff = !ok || !a || a.isCompareSourceStepDisabled(i);
        return [
            { label: 'Edit...', disabled: !ok, action: () => openStage(i) },
            { label: 'Add Stage', disabled: !st().keywords.length, action: () => run((x) => x.addStep()).then(() => { sel = maxSteps() - 1; render(); }) },
            '-',
            { label: 'Move Up', disabled: !ok || i === 0, action: () => run((x) => x.moveStep(i, i - 1)).then(() => { sel = i - 1; render(); }) },
            { label: 'Move Down', disabled: !ok || i >= n - 1, action: () => run((x) => x.moveStep(i, i + 1)).then(() => { sel = i + 1; render(); }) },
            { label: 'Comparison Source', checked: !srcOff && st().compareSourceStepIndex === i, disabled: srcOff, action: () => run((x) => { x.renderSteps(); x.toggleCompareSourceStep(i); }) },
            '-',
            { label: 'Delete Stage', disabled: !ok || n <= 1, action: () => removeStage(i) }
        ];
    }

    async function removeStage(i) {
        if (await yesNo(`"${stageName(i)}" will be deleted for every keyword. Continue?`)) await run((a) => a.removeStepAt(i));
    }

    function keywordMenu() {
        const s = st();
        const has = !!s.activeKeyword;
        const items = [
            { label: 'Add Keyword...', action: () => run((a) => a.promptAddKeyword()) },
            { label: 'Rename Keyword...', disabled: !has, action: () => run((a) => a.renameKeyword()) },
            { label: 'Delete Keyword', disabled: !has, action: () => run((a) => a.deleteKeyword()) }
        ];
        if (s.keywords.length) {
            items.push('-');
            s.keywords.forEach((kw) => items.push({ label: kw, checked: kw === s.activeKeyword, action: () => run((a) => a.selectKeyword(kw)) }));
        }
        return items;
    }

    function fileMenu() {
        const a = pw();
        return [
            { label: 'New', action: () => run((x) => x.newDocument()).then(() => { sel = 0; render(); }) },
            { label: 'Open...', action: () => run((x) => x.openFromVfs()).then(() => { sel = 0; render(); }) },
            { label: 'Save', disabled: !a || !a.hasToolData(), action: () => run((x) => { x.renderSteps(); return x.save(); }) },
            { label: 'Save As...', disabled: !a || !a.hasToolData(), action: () => run((x) => { x.renderSteps(); return x.saveAsDesktop(); }) }
        ];
    }

    function menu() {
        const a = pw();
        const studio = K.studioOpen();
        return [
            { label: 'Compile into Studio', disabled: !a || !a.hasToolData(), action: compile },
            // the desktop's File > Load from Studio: Studio open with Phasewalker stages in it
            { label: 'Load from Studio', disabled: !studio || !hasCompiled(), action: loadFromStudio },
            { label: 'Delete Compiled Stages', disabled: !hasCompiled(), action: deleteCompiled },
            { label: 'Go to Studio', disabled: !studio, action: () => showStudio('prompt') },
            '-',
            { label: 'Keyword', submenu: keywordMenu },
            { label: 'Stage', submenu: () => stageMenu(sel) },
            { label: 'Use Stage 0', checked: !!st().useStage0, disabled: !a, action: () => run((x) => x.toggleUseStage0()) },
            '-',
            { label: 'File', submenu: fileMenu }
        ];
    }

    function softKeys() {
        if (view() === 'stage') return { left: { label: 'Cancel', action: () => sh.back() }, right: { label: 'Menu', menu: formMenu } };
        const a = pw();
        return { left: { label: 'Compile', disabled: !a || !a.hasToolData(), action: compile }, right: { label: 'Menu', menu } };
    }

    // ---------------------------------------------------------------- desktop routes

    let patched = false;
    function patchDesktop() {
        const a = pw();
        if (!a || patched) return;
        patched = true;
        // the window opener (files, the Atelier bag, shortcuts, Naxt, the agent bridge, Studio's
        // Generate > Phasewalker): the desktop's open() with this app in place of its window
        a.open = async (options = {}) => {
            if (!a.modal) a.init();
            if (options.state) {
                if (isCurrent() && !options.skipDiscardCheck && !(await a.confirmDiscardChanges())) return;
                a._vfsFile = options.vfsFile ? { id: options.vfsFile.id, name: options.vfsFile.name, path: options.vfsFile.path || '' } : null;
                a._desktopShortcut = !options.vfsFile && options.desktopShortcut ? { id: options.desktopShortcut.id, name: options.desktopShortcut.name } : null;
                a.hydrateFromSnapshot(options.state);
                a._savedSnapshot = a.boundDocument() ? a.stateSnapshot() : null;
            } else if (!a.hasToolData() && K.studioOpen() && hasCompiled()) {
                /* global rebuildToolStateFromEditor */
                const rebuilt = typeof rebuildToolStateFromEditor === 'function' ? rebuildToolStateFromEditor() : null;
                if (rebuilt) a.hydrateFromSnapshot(rebuilt);
            }
            // as the desktop's open(): keywords with no stages get a first, empty one
            if (a.state.keywords.length && a.getMaxStepCount() === 0) await a.addStep();
            if (!a.state.activeKeyword && a.state.keywords.length) a.state.activeKeyword = a.state.keywords[0];
            a.syncKeywordStepCounts();
            a.renderSteps();
            ready = true;
            if (options.state) { sel = 0; layers = []; editing = null; }
            sh.open(APP_ID);
            render();
            if (options.state && options.autoCompile === true && K.studioOpen()) await compile();
        };
        a.close = () => { if (isCurrent()) sh.back(); };
    }

    // ---------------------------------------------------------------- page

    function mount(p) {
        page = p;
        p.classList.add('wsk', 'wm-phasewalker');
        p.innerHTML = `
            <div class="wsk-view is-list wpw-list">
                <div class="wsk-head"><img ${K.artAttrs(ICON)} alt="" draggable="false"><span class="wsk-head-name"></span><span class="wpw-status"></span></div>
                <div class="wsk-band"><span class="wsk-band-label">Keyword:</span>${K.comboHtml('wpw-kw', '')}</div>
                <div class="wsk-scroll"><div class="wpw-rows" role="listbox" aria-label="Stages"></div><p class="wsk-note" hidden></p></div>
                <div class="wsk-btabs" role="tablist"><button type="button" class="wsk-btab" data-field="prompt">Prompt</button><button type="button" class="wsk-btab" data-field="uc">Undesired</button></div>
            </div>
            <form class="wsk-view wpw-stage" hidden autocomplete="off">
                <div class="wsk-head"><img ${K.artAttrs(ICON)} alt="" draggable="false"><span class="wsk-head-name"></span><span class="wpw-status wpw-form-stage"></span></div>
                <div class="wsk-body">
                    <div class="wsk-field"><span class="wsk-flabel">Keyword:</span>${K.comboHtml('wpw-fkw', '')}</div>
                    <label class="wsk-field"><span class="wsk-flabel">Name:</span><input class="wsk-input" name="name" type="text" maxlength="48" autocapitalize="off" spellcheck="false"></label>
                    <label class="wsk-field is-tall"><span class="wsk-flabel">Prompt:</span><textarea class="wsk-textarea" name="prompt" autocapitalize="off" spellcheck="false"></textarea></label>
                    <label class="wsk-field is-tall"><span class="wsk-flabel">Undesired:</span><textarea class="wsk-textarea" name="uc" autocapitalize="off" spellcheck="false"></textarea></label>
                    <label class="wsk-check wpw-source"><input type="checkbox" name="source"><span>Comparison source</span></label>
                    <p class="wpw-hint">Later stages are compared with this stage's image.</p>
                </div>
            </form>`;
        const f = p.querySelector('.wpw-stage');
        f.addEventListener('submit', (e) => { e.preventDefault(); saveStage(); });
        f.querySelector('[name="name"]').addEventListener('input', (e) => {
            f.querySelector('.wsk-head-name').textContent = e.target.value.trim() || `Step ${(editing ? editing.index : 0) + 1}`;
        });
        f.querySelector('.wpw-fkw').addEventListener('click', (e) => {
            if (!editing) return;
            const choices = st().keywords.map((k) => ({ value: k, label: k }));
            K.combo(e.currentTarget, choices, () => editing && editing.keyword, (v) => {
                if (!editing || v === editing.keyword) return;
                keepDraft();
                editing.keyword = v;
                paintForm();
            });
        });
        p.querySelector('.wpw-kw').addEventListener('click', (e) => {
            const s = st();
            const choices = s.keywords.map((k) => ({ value: k, label: k })).concat([{ value: NEW_KW, label: 'New Keyword...' }]);
            K.combo(e.currentTarget, choices, () => s.activeKeyword, (v) => {
                if (v === NEW_KW) run((a) => a.promptAddKeyword());
                else run((a) => a.selectKeyword(v));
            });
        });
        p.querySelector('.wsk-btabs').addEventListener('click', (e) => {
            const t = e.target.closest('.wsk-btab');
            if (t) run((a) => a.setActiveField(t.dataset.field));
        });
        const scroll = p.querySelector('.wpw-list .wsk-scroll');
        K.onHold(scroll, '.wsk-row', (row, x, y) => { selectRow(Number(row.dataset.i)); sh.menuAt(x, y, stageMenu(Number(row.dataset.i))); });
        scroll.addEventListener('click', (e) => {
            const row = e.target.closest('.wsk-row');
            if (!row) return;
            selectRow(Number(row.dataset.i));
            openStage(Number(row.dataset.i));
        });
        render();
    }

    function register() {
        sh = window.wmShell;
        K = window.wmSuiteKit;
        if (!sh || typeof sh.registerApp !== 'function' || !K) return;
        // every desktop route to the Phasewalker window opens this app (Start, Run, shortcuts, Atelier,
        // Studio's Generate > Phasewalker and its prompt box's Phasewalker > Open Editor ...)
        window.openBracketGenerationApplet = async function (options) {
            if (!await ensure()) { sh.open(APP_ID); return undefined; }
            return pw().open(options || {});
        };
        K.afterFeature('bracket_gen', patchDesktop);
        sh.registerApp({
            id: APP_ID,
            title: TITLE,
            icon: ICON,
            inStart: 'programs',
            sip: true,
            mount,
            show() {
                render();
                if (!ready) sh.busy(ensure, { paint: true }).then(() => {
                    const a = pw();
                    if (!a) return;
                    // opened from Start with no work while Studio holds compiled stages: the desktop's open() loads them
                    if (!a.hasToolData() && K.studioOpen() && hasCompiled()) {
                        const rebuilt = typeof rebuildToolStateFromEditor === 'function' ? rebuildToolStateFromEditor() : null;
                        if (rebuilt) { a.hydrateFromSnapshot(rebuilt); a.renderSteps(); }
                    }
                    if (!a.state.activeKeyword && a.state.keywords.length) a.state.activeKeyword = a.state.keywords[0];
                    render();
                }).catch(() => {});
            },
            titleKind: () => (view() === 'list' ? 'close' : 'ok'),
            historyDepth: () => layers.length,
            onTitleOk() {
                if (view() === 'stage') { saveStage(); return true; }
                return false;
            },
            onBack() {
                if (!layers.length) return false;
                layers.pop();
                editing = null;
                render();
                return true;
            },
            softKeys
        });
    }

    if (window.wmShell && window.wmSuiteKit) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
