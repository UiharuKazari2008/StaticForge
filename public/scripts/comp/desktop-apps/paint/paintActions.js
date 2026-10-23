/**
 * Paint's Actions (Yozora #632), Photoshop's: menu commands recorded, played back, and run over a
 * folder of pictures (File > Automate > Batch).
 *
 *   an action   { id, name, steps: [{ a, label, vals? }] }: each step a menu action; a filter
 *               keeps the values given in its dialog, so it plays without asking
 *   kept in     the registry (Applets\Paint Actions); three to start with
 *   Window > Actions (Alt+F9): the list (a step's triangle shows its steps), Stop, Record, Play,
 *               New, Delete; double-click renames
 *
 *   paintActions.record(w, a) (paintApp's action calls it) / noteFilter(w, lf) (paintPro's filters)
 *   paintActions.play(w, id) / batch(w) / togglePanel(w) / action(w, a)
 */
(function (root) {
    'use strict';

    const KEY = 'HKCU\\Software\\Xyridian\\Melaton\\CurrentVersion\\Applets\\Paint';
    const reg = (n, d) => (root.melatonRegistry ? root.melatonRegistry.get(KEY, n, d) : d);
    const setReg = (v) => { if (root.melatonRegistry) void root.melatonRegistry.set(KEY, v); };
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    const DEFAULTS = [
        { id: 1, name: 'Sepia Toning', steps: [{ a: 'adj-sepia', label: 'Sepia' }] },
        { id: 2, name: 'Black and White, Auto Tone', steps: [{ a: 'adj-bw', label: 'Black and White' }, { a: 'pro-auto-tone', label: 'Auto Tone' }] },
        { id: 3, name: 'Clean Up and Sharpen', steps: [{ a: 'pro-despeckle', label: 'Despeckle' }, { a: 'pro-sharpen-more', label: 'Sharpen More' }] }
    ];

    // what is not a change to the picture: the view, the windows, files, the history itself
    const SKIP = /^(zoom-|view-|guides-|help|about|undo|redo|escape|enter|open|new$|save|print|camera|layers$|history$|paths$|brushes$|character$|layer-comps$|actions|batch|rulers|grid|snap|pro-info|pro-navigator|thumbnail|brush-define|history-snapshot|comp-|path-new|path-save|path-delete|automate)/;

    function list() {
        try {
            const v = JSON.parse(reg('Actions', '') || 'null');
            if (Array.isArray(v)) return v;
        } catch (_) { /* the defaults */ }
        return JSON.parse(JSON.stringify(DEFAULTS));
    }

    let cache = null;
    const actions = () => { if (!cache) cache = list(); return cache; };
    const save = () => setReg({ Actions: JSON.stringify(actions()) });

    /** The menu's name for an action (for the step's row). */
    function labelOf(w, a) {
        const find = (items) => {
            for (const it of items || []) {
                if (it.action === a) return it.text;
                const sub = it.submenu && find(it.submenu);
                if (sub) return sub;
            }
            return null;
        };
        for (const m of ['file', 'edit', 'view', 'image', 'layers', 'select', 'adjustments', 'filter', 'colors']) {
            try { const t = find(w.menu(m)); if (t) return t.replace(/\.\.\.$/, ''); } catch (_) { /* that menu cannot be built now */ }
        }
        return a;
    }

    /** paintApp's action(): a command while recording becomes a step. */
    function record(w, a) {
        if (!w.recording || w.playing || SKIP.test(a)) return;
        const act = actions().find((x) => x.id === w.recording);
        if (!act) return;
        // Last Filter is kept as the filter it repeats, with its values
        const lf = w.lastFilter;
        if (a === 'pro-last-filter' && lf && lf.id) act.steps.push({ a: lf.id, label: lf.label, vals: lf.vals || [] });
        else act.steps.push({ a, label: labelOf(w, a) });
        save();
        refreshPanel(w);
    }

    /** paintPro's filter dialogs: the values chosen join the step that opened it. */
    function noteFilter(w, lf) {
        if (!w.recording || w.playing || !lf) return;
        const act = actions().find((x) => x.id === w.recording);
        const last = act && act.steps[act.steps.length - 1];
        if (!last || (lf.id && last.a !== lf.id)) return;
        last.vals = lf.vals || [];
        last.label = lf.label || last.label;
        save();
        refreshPanel(w);
    }

    /** Play: each step in turn; a filter with values runs straight away (no dialog). */
    async function play(w, id, quiet) {
        const act = actions().find((x) => x.id === id);
        if (!act || !act.steps.length) { if (!quiet) w.status('That action has no steps.'); return false; }
        w.playing = true;
        try {
            for (const s of act.steps) {
                if (s.vals && root.paintSmart) {
                    const m = root.paintSmart.makerOf(w, s.a);
                    if (m) {
                        const keep = w.lastFilter;
                        w.lastFilter = { id: s.a, label: m.label, make: m.make, vals: s.vals, pad: m.pad };
                        w.filterAction = s.a;
                        await w.action('pro-last-filter');
                        w.lastFilter = keep;
                        continue;
                    }
                }
                const before = document.querySelectorAll('.vdt-window').length;
                await w.action(s.a);
                // a step whose dialog opened waits for it (Photoshop's modal control)
                while (w.proSession || document.querySelectorAll('.vdt-window').length > before) await new Promise((r) => setTimeout(r, 150));
            }
        } finally {
            w.playing = false;
        }
        if (!quiet) w.status(`${act.name} played.`);
        return true;
    }

    // ---- the Actions window ----------------------------------------------------------------------

    function dock(w) { return w.modal.querySelector('.mp-dock'); }
    function panelOpen(w) { return !!dock(w).querySelector('.mp-actions'); }

    function togglePanel(w) {
        const d = dock(w);
        const cur = d.querySelector('.mp-actions');
        if (cur) { cur.remove(); w.modal.classList.toggle('mp-has-dock', !!d.children.length); return; }
        d.insertAdjacentHTML('beforeend', `<div class="mp-panel mp-actions"><div class="mp-panel-cap">Actions</div><div class="mp-actions-list" role="tree"></div>
            <div class="mp-paths-bar">
                <button type="button" class="mp-paths-btn" data-x="stop" title="Stop playing/recording"><span class="mp-act-art is-stop"></span></button>
                <button type="button" class="mp-paths-btn" data-x="record" title="Begin recording"><span class="mp-act-art is-record"></span></button>
                <button type="button" class="mp-paths-btn" data-x="play" title="Play selection"><span class="mp-act-art is-play"></span></button>
                <button type="button" class="mp-paths-btn" data-x="new" title="Create new action"><span class="mp-paths-art" style="--i:4"></span></button>
                <button type="button" class="mp-paths-btn" data-x="delete" title="Delete"><span class="mp-paths-art" style="--i:5"></span></button>
            </div></div>`);
        w.modal.classList.add('mp-has-dock');
        const panel = d.querySelector('.mp-actions');
        panel.addEventListener('click', (ev) => {
            const b = ev.target.closest('[data-x]');
            if (b) { action(w, `actions-${b.dataset.x}`); return; }
            const tw = ev.target.closest('.mp-act-twisty');
            const row = ev.target.closest('[data-id]');
            if (!row) return;
            const id = Number(row.dataset.id);
            if (tw) { w.actionsOpen = { ...(w.actionsOpen || {}), [id]: !(w.actionsOpen || {})[id] }; }
            w.actionPick = id;
            w.actionStep = row.dataset.step !== undefined ? Number(row.dataset.step) : null;
            refreshPanel(w);
        });
        panel.addEventListener('dblclick', (ev) => {
            const row = ev.target.closest('[data-id]');
            if (row && row.dataset.step === undefined && !ev.target.closest('.mp-act-twisty')) void rename(w, Number(row.dataset.id));
        });
        refreshPanel(w);
    }

    function refreshPanel(w) {
        const host = dock(w) && dock(w).querySelector('.mp-actions .mp-actions-list');
        if (!host) return;
        const open = w.actionsOpen || {};
        host.innerHTML = actions().map((a) => {
            const rec = w.recording === a.id;
            let html = `<div class="mp-act-row${w.actionPick === a.id && w.actionStep === null ? ' is-active' : ''}${rec ? ' is-recording' : ''}" data-id="${a.id}">
                <button type="button" class="mp-act-twisty${open[a.id] ? ' is-open' : ''}" title="${open[a.id] ? 'Hide' : 'Show'} the steps"></button><span>${esc(a.name)}</span>${rec ? '<i class="mp-act-rec" title="Recording"></i>' : ''}</div>`;
            if (open[a.id]) {
                html += a.steps.map((s, i) => `<div class="mp-act-row is-step${w.actionPick === a.id && w.actionStep === i ? ' is-active' : ''}" data-id="${a.id}" data-step="${i}" title="${s.vals ? esc(`Values: ${s.vals.join(', ')}`) : 'Opens its dialog when it has one'}">${esc(s.label || s.a)}</div>`).join('')
                    || `<div class="mp-act-row is-step is-empty" data-id="${a.id}">(no steps yet)</div>`;
            }
            return html;
        }).join('');
        dock(w).querySelector('.mp-actions [data-x="record"]').classList.toggle('is-on', !!w.recording);
    }

    function nameDialog(w, title, def) {
        const V = root.vistaDialogTemplate;
        if (!V) return Promise.resolve(def);
        const tpl = { t: title, w: 220, h: 46, f: ['MS Shell Dlg', 8], c: [
            [-1, 'S', 7, 9, 24, 8, 0x50020000, '&Name:', 0],
            [103, 'E', 34, 7, 122, 12, 0x50810080, def, 0],
            [1, 'B', 163, 7, 50, 14, 0x50010001, title === 'New Action' ? 'Record' : 'OK', 0],
            [2, 'B', 163, 25, 50, 14, 0x50010000, 'Cancel', 0]
        ] };
        return new Promise((resolve) => {
            let done = false;
            const end = (v) => { if (!done) { done = true; resolve(v); } };
            V.openDialog({ id: 'mpActionName', tpl, owner: w.modal, ok: (ctx) => end(String(ctx.get(103) || '').trim()), cancel: () => end(''), close: () => end('') });
        });
    }

    /** New Action: named, then recording at once (Photoshop's Record button in the dialog). */
    async function newAction(w) {
        const name = await nameDialog(w, 'New Action', `Action ${actions().length + 1}`);
        if (!name) return;
        const id = Date.now();
        actions().push({ id, name, steps: [] });
        save();
        w.actionPick = id;
        w.actionsOpen = { ...(w.actionsOpen || {}), [id]: true };
        w.recording = id;
        w.status(`Recording ${name}: what you do from the menus becomes its steps. Stop ends it.`);
        if (!panelOpen(w)) togglePanel(w); else refreshPanel(w);
    }

    async function rename(w, id) {
        const a = actions().find((x) => x.id === id);
        if (!a) return;
        const name = await nameDialog(w, 'Action Options', a.name);
        if (!name) return;
        a.name = name;
        save();
        refreshPanel(w);
    }

    function remove(w) {
        const a = actions().find((x) => x.id === w.actionPick);
        if (!a) return;
        if (w.actionStep !== null && w.actionStep !== undefined) a.steps.splice(w.actionStep, 1);
        else { cache = actions().filter((x) => x !== a); if (w.recording === a.id) w.recording = null; w.actionPick = null; }
        w.actionStep = null;
        save();
        refreshPanel(w);
    }

    // ---- File > Automate > Batch -----------------------------------------------------------------

    function vfs() { return root.vfsClient || (typeof vfsClient !== 'undefined' ? vfsClient : null); } // eslint-disable-line no-undef

    /** A folder chosen with the file dialog (its Save mode: the name box is not used). */
    function chooseFolder(w, title, start) {
        return new Promise((resolve) => {
            if (typeof root.studioOpenFolderDialog !== 'function') { resolve(null); return; }
            void root.studioOpenFolderDialog('save', {
                owner: w.modal,
                startPath: start || '/',
                host: {
                    title,
                    typeLabel: 'Folder',
                    acceptType: 'user-file',
                    suggestName: () => '(this folder)',
                    onSave(info) { resolve(info.path || '/'); return true; },
                    onCancel() { resolve(null); }
                }
            });
        });
    }

    const PICTURE = /\.(png|jpe?g|bmp|webp|gif|gsd|psd)$/i;

    async function batch(w) {
        const V = root.vistaDialogTemplate;
        if (!V || !actions().length) return;
        const tpl = { t: 'Batch', w: 300, h: 150, f: ['MS Shell Dlg', 8], c: [
            [-1, 'B', 7, 4, 230, 30, 0x50000007, 'Play', 0],
            [-1, 'S', 14, 18, 30, 8, 0x50020000, 'Act&ion:', 0], [101, 'C', 46, 16, 184, 100, 0x50210003, '', 0],
            [-1, 'B', 7, 38, 230, 34, 0x50000007, 'Source: Folder', 0],
            [102, 'B', 14, 52, 50, 14, 0x50010000, '&Choose...', 0], [103, 'S', 68, 55, 164, 8, 0x50020080, '(none)', 0],
            [-1, 'B', 7, 76, 230, 66, 0x50000007, 'Destination', 0],
            [104, 'B', 14, 88, 80, 10, 0x50030009, '&None (leave them changed in place: Save and Close)', 0],
            [105, 'B', 14, 101, 80, 10, 0x50010009, '&Folder', 0],
            [106, 'B', 14, 114, 50, 14, 0x50010000, 'C&hoose...', 0], [107, 'S', 68, 117, 164, 8, 0x50020080, '(none)', 0],
            [108, 'S', 14, 131, 216, 8, 0x50020000, 'Files keep their names; GSD and PSD stay what they are.', 0],
            [1, 'B', 243, 7, 50, 14, 0x50010001, 'OK', 0],
            [2, 'B', 243, 25, 50, 14, 0x50010000, 'Cancel', 0]
        ] };
        const st = { src: null, dst: null };
        const ws = (typeof activeWorkspace !== 'undefined' && activeWorkspace) ? `/Workspaces/${activeWorkspace}` : '/'; // eslint-disable-line no-undef
        V.openDialog({
            id: 'mpBatch', tpl, owner: w.modal,
            init: (ctx) => {
                const sel = ctx.el(101);
                if (sel) sel.innerHTML = actions().map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join('');
                if (w.actionPick && sel) sel.value = String(w.actionPick);
                ctx.set(104, true);
                const pick = async (id, label, key) => {
                    const p = await chooseFolder(w, label, st.src || ws);
                    if (!p) return;
                    st[key] = p;
                    const s = ctx.el(id);
                    if (s) s.textContent = p;
                    if (key === 'dst') ctx.set(105, true);
                };
                const b1 = ctx.el(102); if (b1) b1.addEventListener('click', () => pick(103, 'Choose the Source Folder', 'src'));
                const b2 = ctx.el(106); if (b2) b2.addEventListener('click', () => pick(107, 'Choose the Destination Folder', 'dst'));
            },
            ok: (ctx) => {
                if (!st.src) { w.status('Choose the source folder.'); return false; }
                const id = Number(ctx.get(101)) || (actions()[0] && actions()[0].id);
                const toFolder = !!ctx.get(105) && !!st.dst;
                setTimeout(() => void runBatch(w, id, st.src, toFolder ? st.dst : null), 0);
                return true;
            }
        });
    }

    /** Each picture of the folder: opened in a window of its own, the action played, saved. */
    async function runBatch(w, id, src, dst) {
        const act = actions().find((x) => x.id === id);
        if (!act) return;
        const res = await vfs().listDirectory(src, { offset: 0, limit: 1000, sortField: 'name', sortDirection: 'asc' });
        const files = ((res && res.items) || []).filter((it) => it.targetKind === 'user-file' && PICTURE.test(it.name || ''));
        if (!files.length) { w.status('No pictures in that folder.'); return; }
        const worker = await root.openMelatonPaint();
        // the worker works out of sight
        worker.modal.style.visibility = 'hidden';
        const quiet = { line() {}, percent() {}, marquee() {}, check() {}, part() { return () => {}; } };
        let done = 0;
        const failed = [];
        try {
            await w.withProgress(`Batch: ${act.name}`, async (p) => {
                for (const f of files) {
                    p.check();
                    p.line(`${f.name} (${done + 1} of ${files.length})`);
                    p.percent((done / files.length) * 100);
                    try {
                        const r = await vfs().downloadFile(f.id);
                        const file = { id: f.id, name: f.name, path: src };
                        if (/\.(gsd|psd)$/i.test(f.name)) {
                            const buf = await worker.fetchBytes(r.downloadUrl, null, null);
                            if (/\.psd$/i.test(f.name)) await root.paintPsd.apply(worker, await root.paintPsd.decode(buf), { name: f.name, file });
                            else await root.paintGsd.apply(worker, await root.paintGsd.decode(buf), { name: f.name, file });
                        } else {
                            await worker.openUrl(r.downloadUrl, f.name, file, quiet);
                        }
                        await play(worker, id, true);
                        const type = worker.typeFor(f.name);
                        const blob = await worker.encode(type);
                        if (dst) await worker.upload(quiet, blob, dst, (data) => vfs().uploadFile(dst, data, f.name, worker.mimeFor(type)));
                        else await worker.upload(quiet, blob, src, (data) => vfs().replaceFile(f.id, data, worker.mimeFor(type)));
                    } catch (err) {
                        failed.push(`${f.name}: ${(err && err.message) || err}`);
                    }
                    done += 1;
                }
                p.percent(100);
            }, { cancellable: true });
        } finally {
            worker.modal.remove();
            if (root.melatonPaint && root.melatonPaint.instances) root.melatonPaint.instances.delete(worker);
        }
        if (failed.length) await w.message(`Batch finished with ${failed.length} problem${failed.length > 1 ? 's' : ''}:\n\n${failed.join('\n')}`);
        else w.status(`Batch: ${act.name} played on ${done} picture${done === 1 ? '' : 's'}.`);
    }

    function action(w, a) {
        switch (a) {
            case 'actions': togglePanel(w); return true;
            case 'actions-new': void newAction(w); return true;
            case 'actions-record':
                if (!w.actionPick) { void newAction(w); return true; }
                w.recording = w.actionPick;
                w.status('Recording: what you do from the menus becomes steps. Stop ends it.');
                refreshPanel(w);
                return true;
            case 'actions-stop': w.recording = null; w.status(); refreshPanel(w); return true;
            case 'actions-play': if (w.actionPick) void play(w, w.actionPick); return true;
            case 'actions-delete': remove(w); return true;
            case 'automate-batch': void batch(w); return true;
            default: return false;
        }
    }

    root.paintActions = { record, noteFilter, play, batch, runBatch, togglePanel, panelOpen, refreshPanel, action, actions, DEFAULTS };
})(typeof window !== 'undefined' ? window : globalThis);
