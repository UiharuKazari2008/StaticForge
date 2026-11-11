/**
 * Melaton Mobile: Phasewalker, a phone version of the desktop's stage builder
 * (bracketGenerationApplet.js, Start > Phasewalker = openBracketGenerationApplet), Yozora #732
 * (parent #709). Not the desktop window re-hosted: the desktop instance (window.bracketGenerationApplet)
 * keeps the work and does every job (keywords, stages, compile into Studio's pipeline, load from
 * Studio, delete compiled stages, New / Open / Save over the VFS: WM's file dialogs on phones); its
 * window stays closed and these WM 6.1 screens show and edit its state:
 *
 *   stages    the document's name band, the Keyword combo (the keywords, then New Keyword...), the
 *             stages of that keyword as rows (the stage name, its text under it) and WM's bottom tabs
 *             Prompt | Undesired (which text the rows show). Soft keys Compile (into Studio: it opens
 *             first when it is closed, then comes to the front with the stages) / Menu (Load from
 *             Studio, Delete Compiled Stages, Keyword, Stage, Use Stage 0, File).
 *   stage     a WM form for one stage of the keyword: Name (shared by all keywords), Prompt, Undesired;
 *             ok or Save keeps it, Cancel leaves it.
 *
 * The desktop's routes to the Phasewalker window (openBracketGenerationApplet: Start, Run, desktop
 * shortcuts, Atelier's bag, the agent bridge; .open from a file) open this app on phones, with the
 * state they bring (and compile it when they ask and Studio is open, as on the desktop). Only on phones.
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
    let editing = null; // { index, keyword }
    let layers = []; // 'stage'

    const view = () => layers[layers.length - 1] || 'list';
    const isCurrent = () => !!sh && sh.current === APP_ID;
    const esc = (s) => K.esc(s);
    const pw = () => window.bracketGenerationApplet || null;

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

    const st = () => (pw() ? pw().state : { keywords: [], keywordSteps: {}, stepNames: [], activeKeyword: '', activeField: 'prompt', useStage0: true });
    const steps = () => { const s = st(); return (s.activeKeyword && s.keywordSteps[s.activeKeyword]) || []; };
    const maxSteps = () => (pw() ? pw().getMaxStepCount() : 0);
    const stageName = (i) => (pw() ? pw().getStepDisplayName(i) : `Step ${i + 1}`);
    const hasCompiled = () => { try { /* global hasManagedBracketArtifacts */ return typeof hasManagedBracketArtifacts === 'function' && hasManagedBracketArtifacts(); } catch (_) { return false; } };

    async function ensureStudio() {
        if (!K.studioOpen() && typeof window.openManualModalWithContent === 'function') {
            try { await sh.busy(() => window.openManualModalWithContent(), { paint: true }); } catch (_) { /* below */ }
        }
        if (!K.studioOpen()) { await sh.messageBox({ title: TITLE, icon: 'error', text: 'Studio could not be opened.' }); return false; }
        return true;
    }

    async function compile() {
        if (!await ensure()) return;
        if (!maxSteps() || !st().keywords.length) { await sh.messageBox({ title: TITLE, icon: 'info', text: 'Add a keyword and at least one stage first.' }); return; }
        if (!await ensureStudio()) return;
        const a = pw();
        a.renderSteps(); // its text boxes read back the state before compile reads them
        let ok = false;
        await sh.busy(async () => { ok = a.compileStages() !== false; }, { paint: true });
        render();
        if (ok) sh.open('studio');
    }

    async function loadFromStudio() {
        if (!await ensure()) return;
        if (!await ensureStudio()) return;
        await run((a) => a.loadFromEditor());
        sh.open(APP_ID);
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
        const dirty = !!(a && a.hasToolData() && (a.boundDocument() ? a.isShortcutDirty() : true));
        box.querySelector('.wsk-head-name').textContent = `${a ? a.documentName() : 'Untitled'}${dirty ? ' *' : ''}`;
        box.querySelector('.wpw-kw .wsk-combo-text').textContent = s.activeKeyword || (s.keywords.length ? '' : '(no keywords)');
        const list = steps();
        const n = Math.max(list.length, maxSteps());
        if (sel >= n) sel = Math.max(0, n - 1);
        const field = s.activeField === 'uc' ? 'uc' : 'prompt';
        box.querySelector('.wpw-rows').innerHTML = Array.from({ length: n }, (_, i) => {
            const step = list[i] || { prompt: '', uc: '' };
            const text = String(step[field] || '').replace(/\s+/g, ' ').trim();
            const on = i === sel;
            const base = i === 0 && s.useStage0 ? 'Stage 0' : '';
            return `<div class="wsk-row${on ? ' is-selected' : ''}" role="option" aria-selected="${on}" data-i="${i}">`
                + `<span class="wsk-ico"><img ${K.artAttrs(ICON)} alt="" draggable="false"></span>`
                + `<span class="wsk-name">${esc(stageName(i))}</span>${base ? `<span class="wsk-right">${base}</span>` : ''}`
                + `<span class="wsk-sub${text ? '' : ' wpw-empty'}">${esc(text || '(empty)')}</span></div>`;
        }).join('');
        const note = box.querySelector('.wsk-note');
        note.hidden = n > 0;
        note.textContent = s.keywords.length ? 'No stages. Use Menu > Stage > Add Stage.' : 'No keywords. Use Menu > Keyword > Add Keyword, or Load from Studio.';
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

    function openStage(i) {
        const s = st();
        if (!s.activeKeyword || i == null || i >= steps().length) return;
        editing = { index: i, keyword: s.activeKeyword };
        const step = steps()[i];
        const f = page.querySelector('.wpw-stage');
        f.querySelector('.wsk-head-name').textContent = `${s.activeKeyword}: ${stageName(i)}`;
        f.querySelector('[name="name"]').value = String(s.stepNames[i] || '');
        f.querySelector('[name="name"]').placeholder = `Step ${i + 1}`;
        f.querySelector('[name="prompt"]').value = step.prompt || '';
        f.querySelector('[name="uc"]').value = step.uc || '';
        layers.push('stage');
        render();
        sh.syncHistory();
    }

    function saveStage() {
        const a = pw();
        if (!a || !editing) return;
        const f = page.querySelector('.wpw-stage');
        const list = a.state.keywordSteps[editing.keyword] || [];
        const step = list[editing.index];
        if (step) {
            step.prompt = f.querySelector('[name="prompt"]').value;
            step.uc = f.querySelector('[name="uc"]').value;
            a.setStepName(editing.index, f.querySelector('[name="name"]').value.trim());
        }
        a.renderSteps();
        editing = null;
        layers.pop();
        render();
        sh.syncHistory();
    }

    // ---------------------------------------------------------------- menus / keys

    function stageMenu(i) {
        const n = maxSteps();
        const ok = i != null && i < n;
        return [
            { label: 'Edit...', disabled: !ok, action: () => openStage(i) },
            { label: 'Add Stage', disabled: !st().keywords.length, action: () => run((a) => a.addStep()).then(() => { sel = maxSteps() - 1; render(); }) },
            { label: 'Move Up', disabled: !ok || i === 0, action: () => run((a) => a.moveStep(i, i - 1)).then(() => { sel = i - 1; render(); }) },
            { label: 'Move Down', disabled: !ok || i >= n - 1, action: () => run((a) => a.moveStep(i, i + 1)).then(() => { sel = i + 1; render(); }) },
            { label: 'Delete Stage', disabled: !ok, action: () => removeStage(i) }
        ];
    }

    async function removeStage(i) {
        const yes = await sh.messageBox({ title: TITLE, icon: 'question', text: `"${stageName(i)}" will be deleted for every keyword. Continue?`, buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false, default: true }] });
        if (yes) await run((a) => a.removeStepAt(i));
    }

    function keywordMenu() {
        const has = !!st().activeKeyword;
        return [
            { label: 'Add Keyword...', action: () => run((a) => a.promptAddKeyword()) },
            { label: 'Rename Keyword...', disabled: !has, action: () => run((a) => a.renameKeyword()) },
            { label: 'Delete Keyword', disabled: !has, action: () => run((a) => a.deleteKeyword()) }
        ];
    }

    function fileMenu() {
        const a = pw();
        return [
            { label: 'New', action: () => run((x) => x.newDocument()) },
            { label: 'Open...', action: () => run((x) => x.openFromVfs()) },
            { label: 'Save', disabled: !a || !a.hasToolData(), action: () => run((x) => { x.renderSteps(); return x.save(); }) },
            { label: 'Save As...', disabled: !a || !a.hasToolData(), action: () => run((x) => { x.renderSteps(); return x.saveAsDesktop(); }) }
        ];
    }

    function menu() {
        return [
            { label: 'Compile into Studio', disabled: !maxSteps(), action: compile },
            { label: 'Load from Studio', action: loadFromStudio },
            { label: 'Delete Compiled Stages', disabled: !hasCompiled(), action: deleteCompiled },
            '-',
            { label: 'Keyword', submenu: keywordMenu },
            { label: 'Stage', submenu: () => stageMenu(sel) },
            { label: 'Use Stage 0', checked: !!st().useStage0, action: () => run((a) => a.toggleUseStage0()) },
            '-',
            { label: 'File', submenu: fileMenu }
        ];
    }

    function softKeys() {
        if (view() === 'stage') return { left: { label: 'Cancel', action: () => sh.back() }, right: { label: 'Save', action: saveStage } };
        return { left: { label: 'Compile', disabled: !maxSteps(), action: compile }, right: { label: 'Menu', menu } };
    }

    // ---------------------------------------------------------------- desktop routes

    let patched = false;
    function patchDesktop() {
        const a = pw();
        if (!a || patched) return;
        patched = true;
        // the window opener (files, the Atelier bag, shortcuts, the agent bridge): the state it brings
        // goes into the instance as the desktop's open() does, then this app comes up
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
            if (!a.state.activeKeyword && a.state.keywords.length) a.state.activeKeyword = a.state.keywords[0];
            a.syncKeywordStepCounts();
            a.renderSteps();
            ready = true;
            sel = 0;
            layers = [];
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
                <div class="wsk-head"><img ${K.artAttrs(ICON)} alt="" draggable="false"><span class="wsk-head-name"></span></div>
                <div class="wsk-band"><span class="wsk-band-label">Keyword:</span>${K.comboHtml('wpw-kw', '')}</div>
                <div class="wsk-scroll"><div class="wpw-rows" role="listbox" aria-label="Stages"></div><p class="wsk-note" hidden></p></div>
                <div class="wsk-btabs" role="tablist"><button type="button" class="wsk-btab" data-field="prompt">Prompt</button><button type="button" class="wsk-btab" data-field="uc">Undesired</button></div>
            </div>
            <form class="wsk-view wpw-stage" hidden autocomplete="off">
                <div class="wsk-head"><img ${K.artAttrs(ICON)} alt="" draggable="false"><span class="wsk-head-name"></span></div>
                <div class="wsk-body">
                    <label class="wsk-field"><span class="wsk-flabel">Name:</span><input class="wsk-input" name="name" type="text" autocapitalize="off" spellcheck="false"></label>
                    <label class="wsk-field is-tall"><span class="wsk-flabel">Prompt:</span><textarea class="wsk-textarea" name="prompt" autocapitalize="off" spellcheck="false"></textarea></label>
                    <label class="wsk-field is-tall"><span class="wsk-flabel">Undesired:</span><textarea class="wsk-textarea" name="uc" autocapitalize="off" spellcheck="false"></textarea></label>
                </div>
            </form>`;
        p.querySelector('.wpw-stage').addEventListener('submit', (e) => { e.preventDefault(); saveStage(); });
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
        // every desktop route to the Phasewalker window opens this app (Start, Run, shortcuts, Atelier ...)
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
                    if (a && !a.state.activeKeyword && a.state.keywords.length) a.state.activeKeyword = a.state.keywords[0];
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
