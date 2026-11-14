/**
 * Dynamic Quips (Yozora #828): the MMC snap-in that replaced the Dynamic Quips DSAP on the desktop
 * (dsap://quips.dyna.dreamscape.jp/<workspace>[/phrasebook|/settings] opens it there; elsewhere the
 * DSAP page stays, public/scripts/comp/quipsDsapApplet.js).
 *
 *   Dynamic Quips (Local)     every workspace with its quip counts
 *     <workspace>             Status, Phrase Book, Configuration
 *       Status                the counts, what the generator is doing (generation_quips_progress /
 *                             generation_quips_status pushes), the last quips written while it runs;
 *                             Generate, Re-extract Terms, Refresh Client Cache, Clear All Quips...
 *       Phrase Book           the server's phrase book (get_generation_quips_wiki); right-click a
 *                             phrase or a term to copy it
 *       Configuration         automatic updates and the generation numbers, saved at once through
 *                             updateUserGlobalSettings (generationQuips.byWorkspace)
 *
 * The status cache, labels and option lists are generationQuipsTray.js's; the client phrase book is
 * generationQuips.js's (loadDynamicGenerationQuips).
 *
 *   window.openDynamicQuipsConsole(workspaceId?, view?)   view: 'status' | 'phrasebook' | 'settings'
 */
(function (root) {
    'use strict';

    const ID = 'dynamicQuips';
    const TITLE = 'Dynamic Quips';
    const ITEMS = '/static_images/vista-cpl/items';
    const VI = '/static_images/vista-icons';
    const ICON16 = `${ITEMS}/text-to-speech-16.png`;
    const ICON32 = `${ITEMS}/text-to-speech-32.png`;
    const ICON_WS = `${VI}/workspace-switcher-16.png`;
    const ICON_STATUS = `${ITEMS}/performance-information-and-tools-16.png`;
    const ICON_BOOK = `${VI}/explorer/text-16.png`;
    const ICON_CFG = `${ITEMS}/administrative-tools-16.png`;

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    const fn = (name) => (typeof root[name] === 'function' ? root[name] : null);
    const ws = () => root.wsClient || null;
    const connected = () => { const c = ws(); return !!(c && typeof c.isConnected === 'function' && c.isConnected()); };

    // generationQuipsTray.js keeps its option lists as script-level consts (not on window)
    /* global QUIPS_TERM_LIMIT_OPTIONS, QUIPS_GROK_BATCH_OPTIONS, QUIPS_PHRASES_PER_TERM_OPTIONS, workspaces */
    const optionLists = () => ({
        termLimit: typeof QUIPS_TERM_LIMIT_OPTIONS !== 'undefined' ? QUIPS_TERM_LIMIT_OPTIONS : [25, 50, 75, 100, 150],
        grokBatchSize: typeof QUIPS_GROK_BATCH_OPTIONS !== 'undefined' ? QUIPS_GROK_BATCH_OPTIONS : [1, 2, 3, 5],
        phrasesPerTerm: typeof QUIPS_PHRASES_PER_TERM_OPTIONS !== 'undefined' ? QUIPS_PHRASES_PER_TERM_OPTIONS : [1, 3, 5, 10, 15, 20]
    });
    const workspaceMap = () => { try { return typeof workspaces !== 'undefined' && workspaces ? workspaces : {}; } catch (_) { return {}; } };

    const state = {
        status: null,       // get_generation_quips_status, normalised
        error: '',
        books: new Map(),   // workspace id -> { html, error, loading }
        saving: false,
        pick: null          // the phrase or term picked in the Phrase Book: { kind, text }
    };

    const DEFAULT_AUTO = { enabled: false, schedule: 'disabled', scheduleLabel: 'Disabled', termLimit: 50, grokBatchSize: 3, phrasesPerTerm: 15, lastRunLabel: 'Never', scanPending: false };

    // ---- data --------------------------------------------------------------------------------------

    function normalise(status) {
        const n = fn('normalizeQuipsTrayStatus');
        return n ? n(status) : status;
    }

    async function loadStatus(c) {
        if (!connected()) {
            state.error = 'Melaton is not connected to the server.';
            if (c) c.refresh();
            return;
        }
        try {
            state.status = normalise(await ws().getGenerationQuipsStatus());
            state.error = '';
        } catch (err) {
            state.error = (err && err.message) || 'The server did not answer.';
        }
        if (!c) return;
        c.refresh();
        const want = c.data.pendingNode;
        if (want) {
            c.data.pendingNode = null;
            if (c.find(want) && c.node !== want) c.select(want, false);
        }
    }

    /** The status as generationQuipsTray.js's formatters expect it, for one workspace. */
    function forWorkspace(id) {
        const s = state.status;
        if (!s) return null;
        const w = (s.workspaces || []).find((x) => x.id === id) || null;
        return Object.assign({}, s, { activeWorkspaceId: id, activeWorkspace: w, autoUpdate: (s.autoUpdateByWorkspace && s.autoUpdateByWorkspace[id]) || null });
    }

    function workspaceList() {
        const s = state.status;
        const list = s && Array.isArray(s.workspaces) && s.workspaces.length
            ? s.workspaces.map((w) => ({ id: w.id, name: w.name || w.id }))
            : Object.entries(workspaceMap()).map(([id, w]) => ({ id, name: (w && w.name) || id }));
        return list.filter((w) => w.id && !String(w.id).startsWith('_')).sort((a, b) => String(a.name).localeCompare(String(b.name)));
    }

    function wsName(id) {
        const w = workspaceList().find((x) => x.id === id);
        if (w) return w.name;
        const m = workspaceMap()[id];
        return (m && m.name) || id || 'workspace';
    }

    const wsInfo = (id) => ((state.status && state.status.workspaces) || []).find((x) => x.id === id) || null;
    const autoOf = (id) => Object.assign({}, DEFAULT_AUTO, (state.status && state.status.autoUpdateByWorkspace && state.status.autoUpdateByWorkspace[id]) || {});
    const gen = () => (state.status && state.status.generation) || {};
    const running = () => gen().status === 'running';

    function corpusFiles(id) {
        const w = workspaceMap()[id];
        if (!w) return null;
        if (Array.isArray(w.files) || Array.isArray(w.scraps)) return (w.files || []).length + (w.scraps || []).length;
        if (w.fileCount != null) return (w.fileCount || 0) + (w.scrapCount || 0);
        return null;
    }

    function autoLabel(a) {
        const schedule = a.schedule || 'disabled';
        const on = a.enabled === true || (schedule !== 'disabled' && a.enabled !== false);
        if (on && schedule !== 'disabled') return (a.scheduleLabel || schedule) + (a.scanPending ? ' (scan soon)' : '');
        if (a.lastRunLabel && a.lastRunLabel !== 'Never') return `Off (last run ${a.lastRunLabel})`;
        return 'Off';
    }

    function perTerm(w) {
        const min = w && w.minPhrasesPerTerm;
        const max = w && w.maxPhrasesPerTerm;
        if (min == null && max == null) return 'Not available';
        if (min != null && max != null && min !== max) return `${min} to ${max}`;
        return String(min != null ? min : max);
    }

    function lastGenerated(w) {
        if (w && w.lastGeneratedAt) return root.mmcConsole.when(w.lastGeneratedAt * 1000) || 'Unknown';
        return (w && (w.termCount || 0) > 0) ? 'Unknown' : 'Never';
    }

    // ---- the console tree ----------------------------------------------------------------------------

    const parse = (nodeId) => { const i = nodeId.indexOf(':'); return i < 0 ? { kind: nodeId, ws: null } : { kind: nodeId.slice(0, i), ws: nodeId.slice(i + 1) }; };

    function nodes() {
        return [{
            id: 'root',
            name: `${TITLE} (Local)`,
            icon: ICON16,
            children: workspaceList().map((w) => ({
                id: `ws:${w.id}`,
                name: w.name,
                icon: ICON_WS,
                children: [
                    { id: `st:${w.id}`, name: 'Status', icon: ICON_STATUS },
                    { id: `pb:${w.id}`, name: 'Phrase Book', icon: ICON_BOOK },
                    { id: `cfg:${w.id}`, name: 'Configuration', icon: ICON_CFG }
                ]
            }))
        }];
    }

    // ---- pages -------------------------------------------------------------------------------------------

    function loading(c, title) {
        if (state.error) return c.page(title, '', [{ id: 'dq-load', title: TITLE, body: `<p>${c.state(false, `The quip status could not be read. ${state.error}`)}</p>` }]);
        return c.page(title, 'Reading data, please wait...', [{ id: 'dq-load', title: TITLE, body: '<p>Reading data, please wait...</p>' }]);
    }

    function rootPage(c) {
        if (!state.status) return loading(c, TITLE);
        const s = state.status;
        const cols = [
            { t: 'Workspace', w: 170, key: 'name', text: (d) => d.name },
            { t: 'Quip Terms', w: 80, num: true, key: 'terms', text: (d) => String(d.terms), value: (d) => d.terms },
            { t: 'Phrases', w: 70, num: true, key: 'phrases', text: (d) => String(d.phrases), value: (d) => d.phrases },
            { t: 'Last Generated', w: 130, key: 'last', text: (d) => d.last, value: (d) => d.lastAt },
            { t: 'Automatic Updates', w: 130, key: 'auto', text: (d) => d.auto }
        ];
        const rows = workspaceList().map((w) => {
            const i = wsInfo(w.id) || {};
            return { key: w.id, open: `st:${w.id}`, icon: ICON_WS, data: { name: w.name, terms: i.termCount || 0, phrases: i.phraseCount || 0, last: lastGenerated(i), lastAt: i.lastGeneratedAt || 0, auto: autoLabel(autoOf(w.id)) } };
        });
        const g = gen();
        return c.page(TITLE, running() ? 'Generating' : `${rows.length} workspace${rows.length === 1 ? '' : 's'}`, [
            { id: 'dq-overview', title: 'Overview', body: c.overview(ICON32, [
                'Dynamic Quips writes the short lines Melaton shows while a picture is generated. It ranks the terms used in each workspace\'s prompts and has Director write phrases for them.',
                'Select a workspace to see its status, read its phrase book or change how often it is updated.'
            ]) },
            { id: 'dq-summary', title: 'Summary', body: c.props([
                ['Workspaces with quips', esc(String(s.totalWorkspacesWithQuips != null ? s.totalWorkspacesWithQuips : rows.filter((r) => r.data.terms > 0).length))],
                ['Quip terms (all workspaces)', esc(String(s.totalQuipTerms != null ? s.totalQuipTerms : rows.reduce((n, r) => n + r.data.terms, 0)))],
                ['Extracted terms', esc(String(s.extractedTermRows != null ? s.extractedTermRows : 0))],
                ['Generator', running() ? esc(g.message || 'Generating quips') : g.status === 'error' ? c.state(false, g.error || g.message || 'The last run failed.') : 'Idle']
            ]) },
            { id: 'dq-workspaces', title: 'Workspaces', body: c.listView(cols, rows, { sortId: 'dq-ws', empty: 'There are no workspaces.', fit: true }) }
        ]);
    }

    function workspacePage(c, id) {
        const cols = [{ t: 'Name', w: 150, text: (d) => d.name }, { t: 'Description', w: 420, text: (d) => d.desc }];
        const rows = [
            { key: `st:${id}`, open: `st:${id}`, icon: ICON_STATUS, data: { name: 'Status', desc: 'Quip counts, the generator\'s progress and the latest quips' } },
            { key: `pb:${id}`, open: `pb:${id}`, icon: ICON_BOOK, data: { name: 'Phrase Book', desc: 'Every term and the phrases written for it' } },
            { key: `cfg:${id}`, open: `cfg:${id}`, icon: ICON_CFG, data: { name: 'Configuration', desc: 'Automatic updates and generation settings' } }
        ];
        return { html: c.listView(cols, rows), list: true };
    }

    function statusPage(c, id) {
        if (!state.status) return loading(c, 'Status');
        const i = wsInfo(id) || {};
        const files = corpusFiles(id);
        const view = forWorkspace(id);
        const g = gen();
        const isRunning = running();
        const title = fn('formatQuipsTrayTitle') ? root.formatQuipsTrayTitle(view) : TITLE;
        let detail = '';
        if (isRunning) detail = (fn('formatQuipsGenerationDetail') && root.formatQuipsGenerationDetail(g)) || g.message || '';
        else if (g.status === 'error') detail = g.error || g.message || 'Generation failed';
        if (detail && title.includes(detail)) detail = '';
        const pct = isRunning ? (fn('computeQuipsTrayProgress') ? root.computeQuipsTrayProgress(view, { generation: g }) : (g.progress || 0)) : 0;
        const stateHtml = g.status === 'error' ? c.state(false, title) : `<span class="mmc-state">${esc(title)}</span>`;
        const progress = isRunning ? `<div class="mmc-progress"><div role="progressbar" class="animate" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><div style="width:${pct}%"></div></div><span>${pct}%</span></div>` : '';
        const sections = [
            { id: 'dq-stats', title: 'Summary', body: c.props([
                ['Quip terms', esc(String(i.termCount || 0))],
                ['Phrases', esc(String(i.phraseCount || 0))],
                ['Extracted terms', esc(String(i.extractedTermCount || 0))],
                ['Phrases per term', esc(perTerm(i))],
                ['Corpus files', files != null ? esc(String(files)) : 'Not available'],
                ['Automatic updates', esc(autoLabel(autoOf(id)))],
                ['Last generated', esc(lastGenerated(i))]
            ]) },
            { id: 'dq-system', title: 'System Status', body: `<p class="dq-status${isRunning ? ' is-running' : ''}">${stateHtml}${detail ? `<br><span class="mmc-hint">${esc(detail)}</span>` : ''}</p>${progress}
                <div class="mmc-buttons">
                    <button type="button" class="btn-standard" data-act="generate"${isRunning ? ' disabled' : ''}>Generate</button>
                    <button type="button" class="btn-standard" data-act="extract"${isRunning ? ' disabled' : ''}>Re-extract Terms</button>
                    <button type="button" class="btn-standard" data-act="refresh-cache">Refresh Client Cache</button>
                    <button type="button" class="btn-standard" data-act="clear"${isRunning ? ' disabled' : ''}>Clear All Quips...</button>
                </div>` }
        ];
        const previews = previewsOf(view);
        if (isRunning && previews.length) {
            const cols = [{ t: 'Term', w: 150, text: (d) => d.term }, { t: 'Phrase', w: 380, text: (d) => d.phrase }];
            sections.push({ id: 'dq-recent', title: 'Latest Quips', body: c.listView(cols, previews.map((p, n) => ({ key: `pv:${n}`, data: p })), { fit: true }) });
        }
        return c.page('Status', wsName(id), sections);
    }

    function previewsOf(view) {
        const g = gen();
        const summary = fn('buildQuipsTrayStatusSummary') ? root.buildQuipsTrayStatusSummary(view, { generation: g }) : { previews: g.recentPreviews || [] };
        return (summary.previews || []).slice(-4).reverse().map((p) => ({ term: (p && p.term) || '', phrase: (p && p.phrase) || '' }));
    }

    async function loadBook(c, id, force) {
        const have = state.books.get(id);
        if (have && (have.loading || (!force && (have.html || have.error)))) return;
        state.books.set(id, { loading: true });
        if (c) c.refresh();
        let book;
        if (!connected()) book = { error: 'Melaton is not connected to the server.' };
        else {
            try {
                const result = await ws().getGenerationQuipsWiki({ workspaceId: id });
                book = result && result.html ? { html: clean(result.html) } : { error: 'There are no quips to show for this workspace.' };
            } catch (err) { book = { error: (err && err.message) || 'The phrase book could not be read.' }; }
        }
        state.books.set(id, book);
        if (c && c.node === `pb:${id}`) c.refresh();
    }

    /** The server's phrase book without its own navigation and controls (the console has those). */
    function clean(html) {
        const tpl = document.createElement('template');
        tpl.innerHTML = html;
        tpl.content.querySelectorAll('.quip-wiki-nav, .quip-wiki-controls, script, style').forEach((n) => n.remove());
        return tpl.innerHTML;
    }

    function bookPage(c, id) {
        const b = state.books.get(id);
        if (!b) Promise.resolve().then(() => loadBook(c, id));
        let body;
        if (!b || b.loading) body = '<p class="dq-book-msg">Reading the phrase book, please wait...</p>';
        else if (b.error) body = `<p class="dq-book-msg">${esc(b.error)}</p>`;
        else body = b.html;
        const i = wsInfo(id) || {};
        const side = i.termCount ? `${i.termCount} terms, ${i.phraseCount || 0} phrases` : '';
        return {
            html: `<div class="mmc-page-title"><b>Phrase Book</b><span>${esc(wsName(id))}${side ? ` - ${esc(side)}` : ''}</span></div><div class="mmc-page-body dq-book" data-mmc-scroll>${body}</div>`,
            mount: (pane) => markPick(pane)
        };
    }

    function markPick(pane) {
        pane.querySelectorAll('.dq-picked').forEach((n) => n.classList.remove('dq-picked'));
        if (state.pick && state.pick.el && pane.contains(state.pick.el)) state.pick.el.classList.add('dq-picked');
    }

    function select(name, list, cur, label) {
        const vals = list.slice();
        if (cur != null && !vals.some((v) => String(v) === String(cur))) vals.push(Number(cur));
        vals.sort((a, b) => a - b);
        return `<select id="dq-${name}" data-field="${name}" aria-label="${esc(label)}">${vals.map((v) => `<option value="${esc(v)}"${String(v) === String(cur) ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select>`;
    }

    function configPage(c, id) {
        if (!state.status) return loading(c, 'Configuration');
        const a = autoOf(id);
        const schedule = a.schedule || 'disabled';
        const groups = fn('buildQuipsAutoScheduleDropdownGroups') ? root.buildQuipsAutoScheduleDropdownGroups() : [{ group: 'Other', options: [{ value: 'disabled', label: 'Disable automatic updates' }] }];
        const known = groups.some((g) => (g.options || []).some((o) => o.value === schedule));
        const sched = `<select id="dq-schedule" data-field="schedule" aria-label="Automatic updates">${groups.map((g) => `<optgroup label="${esc(g.group)}">${(g.options || []).map((o) => `<option value="${esc(o.value)}"${o.value === schedule ? ' selected' : ''}>${esc(o.label || o.value)}</option>`).join('')}</optgroup>`).join('')}${known ? '' : `<option value="${esc(schedule)}" selected>${esc(a.scheduleLabel || schedule)}</option>`}</select>`;
        const last = a.lastRunLabel && a.lastRunLabel !== 'Never' ? a.lastRunLabel : 'Never';
        const o = optionLists();
        const body = `<p>These settings are used by automatic updates and by Generate for this workspace. A change is saved as soon as it is made.</p>
            <div class="mmc-form dq-form">
                <label for="dq-schedule">Automatic updates:</label><div>${sched}<div class="mmc-hint">Last automatic run: ${esc(last)}</div></div>
                <label for="dq-termLimit">Terms to rank:</label><div>${select('termLimit', o.termLimit, a.termLimit, 'Terms to rank')}<div class="mmc-hint">Prompt terms extracted and ranked in each scan</div></div>
                <label for="dq-grokBatchSize">Terms per Director batch:</label><div>${select('grokBatchSize', o.grokBatchSize, a.grokBatchSize, 'Terms per Director batch')}<div class="mmc-hint">Ranked terms sent in each Director turn</div></div>
                <label for="dq-phrasesPerTerm">Quips per term:</label><div>${select('phrasesPerTerm', o.phrasesPerTerm, a.phrasesPerTerm, 'Quips per term')}<div class="mmc-hint">Phrases Director writes for each ranked term</div></div>
            </div>`;
        return {
            html: c.page('Configuration', wsName(id), [{ id: 'dq-config', title: 'Generation Settings', body }]),
            mount: (pane) => {
                pane.querySelectorAll('select[data-field]').forEach((el) => el.addEventListener('change', () => void saveConfig(c, id, pane)));
            }
        };
    }

    async function saveConfig(c, id, pane) {
        const get = (f) => { const el = pane.querySelector(`[data-field="${f}"]`); return el ? el.value : null; };
        const schedule = get('schedule') || 'disabled';
        const patch = { schedule, enabled: schedule !== 'disabled', termLimit: Number(get('termLimit')), grokBatchSize: Number(get('grokBatchSize')), phrasesPerTerm: Number(get('phrasesPerTerm')) };
        if (!connected() || typeof ws().updateUserGlobalSettings !== 'function') {
            await c.box('<p>Melaton is not connected to the server. The setting was not saved.</p>', null, { icon: 'error' });
            return;
        }
        state.saving = true;
        c.note('Saving...');
        try {
            await ws().updateUserGlobalSettings({ generationQuips: { byWorkspace: { [id]: patch } } });
            // the server's view (schedule label, last run) comes back with the status
            if (state.status) {
                const by = Object.assign({}, state.status.autoUpdateByWorkspace || {});
                by[id] = Object.assign({}, DEFAULT_AUTO, by[id] || {}, patch);
                state.status = Object.assign({}, state.status, { autoUpdateByWorkspace: by });
            }
            c.note('The settings were saved.');
        } catch (err) {
            c.note('');
            await c.box(`<p>The settings could not be saved.</p><p>${esc((err && err.message) || 'The server did not answer.')}</p>`, null, { icon: 'error' });
        } finally {
            state.saving = false;
        }
        await loadStatus(c);
    }

    // ---- commands ----------------------------------------------------------------------------------------

    function commands(node) {
        const p = parse(node.id);
        if (!p.ws) return [];
        const r = running();
        const out = [
            { text: 'Generate', action: 'generate', disabled: r || !state.status },
            { text: 'Re-extract Terms', action: 'extract', disabled: r || !state.status },
            { text: 'Refresh Client Cache', action: 'refresh-cache' },
            { text: 'Clear All Quips...', action: 'clear', disabled: r || !state.status }
        ];
        if (p.kind !== 'pb') out.push({ separator: true }, { text: 'Open Phrase Book', action: `nav:pb:${p.ws}` });
        return out;
    }

    function selCommands(node, key) {
        if (key && key.startsWith('pv:')) return { title: 'Quip', items: [{ text: 'Copy Phrase', action: 'copy' }] };
        if ((key === 'pick:phrase' || key === 'pick:term') && state.pick) {
            return key === 'pick:phrase' ? { title: 'Phrase', items: [{ text: 'Copy Phrase', action: 'copy' }] } : { title: 'Term', items: [{ text: 'Copy Term', action: 'copy' }] };
        }
        if (node.id === 'root' && key) return { title: wsName(key), items: [{ text: 'Status', action: `nav:st:${key}` }, { text: 'Phrase Book', action: `nav:pb:${key}` }, { text: 'Configuration', action: `nav:cfg:${key}` }] };
        return null;
    }

    async function copy(c, text) {
        if (!text) return;
        try {
            if (typeof root.copyTextToClipboard === 'function') await root.copyTextToClipboard(text);
            else await navigator.clipboard.writeText(text);
            c.note('Copied to the Clipboard.');
        } catch (_) { c.note('The text could not be copied.'); }
    }

    async function generate(c, id) {
        if (running() || (fn('isQuipsPipelineRunning') && root.isQuipsPipelineRunning())) { c.note('Quips are already being generated.'); return; }
        const a = autoOf(id);
        const result = await ws().runGenerationQuips({ scope: 'workspace', workspaceId: id, termLimit: a.termLimit, grokBatchSize: a.grokBatchSize, phrasesPerTerm: a.phrasesPerTerm });
        if (result && result.started === false) { await c.box(`<p>${esc(result.message || 'Quips are already being generated.')}</p>`, null, { icon: 'info' }); return; }
        if (fn('markQuipsGenerationRunStarted')) root.markQuipsGenerationRunStarted();
        c.note(`Generating quips for ${wsName(id)}...`);
    }

    async function extract(c, id) {
        if (running()) { c.note('Quips are already being generated.'); return; }
        const result = await ws().runGenerationQuips({ scope: 'workspace', workspaceId: id, extractOnly: true });
        if (result && result.started === false) { await c.box(`<p>${esc(result.message || 'Terms are already being extracted.')}</p>`, null, { icon: 'info' }); return; }
        c.note(`Scanning the prompts in ${wsName(id)}...`);
    }

    async function clearAll(c, id) {
        if (running()) { await c.box('<p>Wait for the current generation to finish, then try again.</p>', null, { icon: 'info' }); return; }
        const ok = await c.box(`<p>Are you sure you want to clear all quips and extracted terms for ${esc(wsName(id))}?</p><p>This cannot be undone.</p>`,
            [{ text: 'Yes', value: true, className: 'btn-standard primary' }, { text: 'No', value: false, className: 'btn-standard' }], { icon: 'warning', title: 'Clear All Quips' });
        if (ok !== true) return;
        await ws().clearGenerationQuips({ workspaceId: id });
        state.books.delete(id);
        if (fn('refreshGenerationQuipsTrayStatus')) void root.refreshGenerationQuipsTrayStatus();
        c.note(`The quips for ${wsName(id)} were cleared.`);
    }

    async function refreshCache(c) {
        if (!fn('loadDynamicGenerationQuips')) return;
        c.note('Refreshing the client phrase book...');
        const result = await root.loadDynamicGenerationQuips(true);
        if (!result || !result.ok) {
            c.note('');
            await c.box(`<p>The client phrase book could not be refreshed.</p><p>${esc((result && result.error) || 'The server did not answer.')}</p>`, null, { icon: 'error' });
            return;
        }
        c.note(result.unchanged ? 'The client phrase book is already up to date.' : 'The client phrase book was updated.');
    }

    async function action(a, c) {
        const p = parse(c.node || 'root');
        const id = p.ws;
        const needWs = ['generate', 'extract', 'clear'];
        if (needWs.includes(a) && (!id || !connected())) {
            if (!connected()) await c.box('<p>Melaton is not connected to the server.</p>', null, { icon: 'error' });
            return true;
        }
        switch (a) {
            case 'refresh':
                if (p.kind === 'pb' && id) { state.pick = null; void loadBook(c, id, true); }
                await loadStatus(c);
                return true;
            case 'generate': await generate(c, id); await loadStatus(c); return true;
            case 'extract': await extract(c, id); await loadStatus(c); return true;
            case 'clear': await clearAll(c, id); await loadStatus(c); return true;
            case 'refresh-cache': await refreshCache(c); await loadStatus(c); return true;
            case 'copy': {
                if (c.sel && c.sel.startsWith('pv:')) {
                    const pv = previewsOf(forWorkspace(id))[Number(c.sel.slice(3))];
                    await copy(c, pv && pv.phrase);
                } else if (state.pick) await copy(c, state.pick.text);
                return true;
            }
            case 'help': if (fn('openHelpAndSupport')) root.openHelpAndSupport('dynamic-quips'); return true;
            default: return false;
        }
    }

    // ---- live updates ---------------------------------------------------------------------------------

    function bind(c) {
        const client = ws();
        if (!client || typeof client.on !== 'function') return;
        const apply = (data) => {
            const f = fn('applyQuipsBroadcastStatus');
            const s = f ? f(data) : data;
            if (s) state.status = Object.assign({}, state.status || {}, normalise(s));
        };
        // a progress push redraws the pages that show it; a settings page keeps an open drop-down
        const redraw = (all) => {
            const k = parse(c.node || 'root').kind;
            if (k === 'cfg') {
                const focused = document.activeElement;
                if (!all || state.saving || (focused && c.modal.contains(focused) && focused.tagName === 'SELECT')) return;
            }
            if (k === 'pb' && !all) return;
            c.refresh();
        };
        c.data.onProgress = (msg) => {
            const data = (msg && msg.data) || msg;
            if (!data) return;
            if (data.status) apply(data.status);
            else if (data.generation) state.status = Object.assign({}, state.status || {}, { generation: data.generation });
            redraw(false);
        };
        c.data.onStatus = (msg) => {
            const data = (msg && msg.data) || msg;
            if (!data) return;
            apply(data);
            redraw(true);
        };
        client.on('generation_quips_progress', c.data.onProgress);
        client.on('generation_quips_status', c.data.onStatus);
    }

    function unbind(c) {
        const client = ws();
        if (!client || typeof client.off !== 'function') return;
        if (c.data.onProgress) client.off('generation_quips_progress', c.data.onProgress);
        if (c.data.onStatus) client.off('generation_quips_status', c.data.onStatus);
    }

    // ---- open -------------------------------------------------------------------------------------------

    function page(node, c) {
        const p = parse(node.id);
        switch (p.kind) {
            case 'ws': return workspacePage(c, p.ws);
            case 'st': return statusPage(c, p.ws);
            case 'pb': return bookPage(c, p.ws);
            case 'cfg': return configPage(c, p.ws);
            default: return rootPage(c);
        }
    }

    function def() {
        return {
            id: ID,
            title: TITLE,
            icon16: ICON16,
            icon32: ICON32,
            taskbarIcon: ICON32,
            expanded: ['root'],
            nodes,
            page,
            commands,
            selCommands,
            toolbar: (node) => (node.id === 'root' ? [] : [{ id: 'refresh', i: 3, title: 'Refresh' }]),
            action,
            rowOpen: (key, node, c) => { if (node.id === 'root') c.select(`st:${key}`, true); },
            status: (node) => {
                if (state.error) return 'The server did not answer.';
                if (!state.status) return 'Reading data, please wait...';
                if (running()) return gen().message || 'Generating quips...';
                const p = parse(node.id);
                if (node.id === 'root') return `${workspaceList().length} workspaces`;
                const i = wsInfo(p.ws) || {};
                return `${i.termCount || 0} terms, ${i.phraseCount || 0} phrases`;
            },
            about: { version: '1.0.0', lines: ['Dynamic Quips writes the lines Melaton shows while pictures are generated.'] },
            onOpen: (c) => {
                const pane = c.el('.mmc-result');
                // a phrase or a term in the Phrase Book picks like a list row (Copy Phrase / Copy Term)
                const pick = (ev) => {
                    if (parse(c.node || '').kind !== 'pb') return;
                    const li = ev.target.closest('.quip-wiki-phrases li');
                    const term = !li && ev.target.closest('.quip-wiki-term-title');
                    if (li || term) {
                        const el = li || term;
                        const text = li ? (li.textContent || '').trim()
                            : Array.from(term.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
                        state.pick = { kind: li ? 'phrase' : 'term', text, el };
                        c.selectRow(li ? 'pick:phrase' : 'pick:term');
                    } else {
                        state.pick = null;
                        if (c.sel && c.sel.startsWith('pick:')) c.selectRow(null);
                    }
                    markPick(pane);
                };
                pane.addEventListener('click', pick);
                pane.addEventListener('mousedown', (ev) => { if (ev.button === 2) pick(ev); });
                bind(c);
                void loadStatus(c);
            },
            onClose: (c) => { unbind(c); state.pick = null; state.books.clear(); }
        };
    }

    async function openDynamicQuipsConsole(workspaceId, view) {
        if (root.featureLoader) await root.featureLoader.loadFeature('mmc_snapins');
        if (!root.mmcConsole) return null;
        const id = workspaceId || (fn('getActiveWorkspaceIdForQuips') ? root.getActiveWorkspaceIdForQuips() : null);
        const kind = view === 'phrasebook' ? 'pb' : (view === 'settings' || view === 'configuration') ? 'cfg' : 'st';
        const node = id ? `${kind}:${id}` : null;
        // the workspace nodes come from the status, so a first open selects the node once it is read
        const have = root.mmcConsole.get(ID);
        const c = root.mmcConsole.open(def(), node && have ? { node } : {});
        if (c && node && !have) {
            if (c.find(node)) c.select(node, false);
            else c.data.pendingNode = node;
        }
        return c;
    }

    root.openDynamicQuipsConsole = openDynamicQuipsConsole;
    root.mmcQuips = { open: openDynamicQuipsConsole, _state: state };
})(typeof window !== 'undefined' ? window : globalThis);
