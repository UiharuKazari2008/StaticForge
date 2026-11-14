/**
 * Control Panel's Indexing Options (Yukimi 2026-11-14, #828): Vista's srchadmin.dll dialogs, drawn
 * from its own templates (vistaDialogTemplates.js "srchadmin:105" / "srchadmin:102") with what the
 * Data Management DSAP's "Search & Prompt Indexing" section used to show (it moved here):
 *
 *   Indexing Options (srchadmin:105)   the 48 px drive icon, "N items indexed" (prompt text done),
 *       Vista's status line and the server's total images; the list holds both indexes (Search tags =
 *       the search_sync job, Prompt text = the prompt_fts job) with their state and counts, Pending
 *       FTS / Flag drift / Blob extract pending under Prompt text, and a determinate bar with the
 *       phase message, the count and the current file under each index that is running; Modify,
 *       Advanced (shield), Pause / Resume (shield; both indexes), the help link and Close.
 *   Indexed Locations (srchadmin:102, Modify)   the workspaces as the indexed locations. The server
 *       indexes every workspace and has no setting to leave one out, so the boxes are checked and
 *       greyed (Vista's look for a location the administrator has locked), and the summary lists them.
 *   Advanced Options (a sheet like srchadmin:103's)   Troubleshooting: Rebuild, Index Now, Reconcile;
 *       Prompt text indexing: Start / Resume, Cancel Indexing; Search cache: Prepare, Clear.
 *   How does indexing affect searches?   a short Help and Support page (a plain dialog).
 *
 * Status: the tray indicator's _indexJobs (search_sync, prompt_fts), the cached
 * wsClient._lastSearchIndexingStatus / _lastPromptFtsIndexingStatus, and the search_indexing_status
 * push (public/scripts/ws/handlers/60-searchInbound.js resolvePromptFtsPayloadFromMessage); with
 * nothing cached yet, get_prompt_index_status once. Actions are the tray icon's own
 * (systemTrayManager.js attachSearchIndexingTrayContextMenu), fired as contextMenuAction events so
 * mainMenuManager.js runs them, confirmations included; Pause / Resume sends the two jobs' own
 * pause / resume messages directly (no confirmation there either).
 *
 *   cplSearch.open({ owner })   the Indexing Options window (one; a second open raises it)
 *   melatonControlPanel.open('search') and the Control Panel item open it too.
 */
(function (root) {
    'use strict';

    const doc = typeof document !== 'undefined' ? document : null;
    const ART = '/static_images/vista-cpl';
    const ICON16 = `${ART}/items/indexing-options-16.png`;
    const ICON48 = `${ART}/indexing-48.png`;
    const SHIELD = `${ART}/shield-uac-16.png`;
    const FOLDER16 = '/static_images/vista-icons/explorer/folder-16.png';
    const MAIN_ID = 'cplIndexingOptions';
    const ACTIVE = ['starting', 'indexing', 'cache_init'];

    let registered = false;
    let listening = false;
    let mainCtx = null;
    let advCtx = null;
    let fetched = null; // get_prompt_index_status's reply while nothing is cached

    function esc(text) {
        return String(text == null ? '' : text)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function num(v) {
        return (Number(v) || 0).toLocaleString();
    }

    function ws() {
        return root.wsClient || null;
    }

    function connected() {
        const c = ws();
        return !!(c && typeof c.isConnected === 'function' && c.isConnected());
    }

    function callGlobal(name, ...args) {
        const fn = root[name];
        return typeof fn === 'function' ? fn(...args) : undefined;
    }

    /** The prompt FTS payload: the combined push, the cached one, the tray's copy, our own fetch. */
    function promptFts(indicator) {
        const client = ws() || {};
        const combined = client._lastSearchIndexingStatus;
        const resolve = typeof root.resolvePromptFtsPayloadFromMessage === 'function'
            ? root.resolvePromptFtsPayloadFromMessage
            : (m) => (m && m.job === 'prompt_fts' ? m : (m && m.promptFts ? { job: 'prompt_fts', ...m.promptFts } : null));
        return (indicator && indicator._indexJobs && indicator._indexJobs.prompt_fts)
            || client._lastPromptFtsIndexingStatus
            || (combined ? resolve(combined) : null)
            || fetched
            || {};
    }

    /** Both jobs' state as the dialog shows it (wmSettingsDreamscape.js reads it too). */
    function readState() {
        const indicator = doc ? doc.getElementById('searchIndexingIndicator') : null;
        const jobs = (indicator && indicator._indexJobs) || {};
        const sync = jobs.search_sync || {};
        const fts = promptFts(indicator);
        const stats = fts.stats || {};
        const syncActive = ACTIVE.includes(sync.status);
        const ftsActive = ACTIVE.includes(fts.status) || fts.running === true;
        const syncPaused = sync.status === 'paused' || (sync.paused === true && sync.status !== 'resumed');
        const ftsPaused = fts.paused === true || fts.status === 'paused';
        const paused = syncPaused || ftsPaused;
        const known = !!(sync.status || fts.status);
        let line = 'Indexing complete.';
        if (!known) line = 'Waiting to receive indexing status...';
        else if (syncActive || ftsActive) {
            line = (sync.status === 'starting' || fts.status === 'starting') && !(sync.status === 'indexing' || fts.running === true)
                ? 'Indexing is starting up.'
                : 'Indexing in progress. Search results might not be complete during this time.';
        } else if (paused) line = 'Indexing is paused.';
        else if (sync.status === 'error' || fts.status === 'error') line = 'Indexing stopped because of an error.';
        else if ((stats.ftsPending || 0) > 0) line = `${num(stats.ftsPending)} items are waiting to be indexed.`;
        const pct = Number.isFinite(Number(sync.percentage)) ? Number(sync.percentage) : null;
        return {
            sync, fts, stats, syncActive, ftsActive, syncPaused, ftsPaused, paused, known, line,
            progress: syncActive && pct !== null ? pct : null,
            indexed: stats.ftsDone || 0,
            total: stats.totalImages || 0
        };
    }

    function syncStatus(s) {
        if (s.sync.status === 'cache_init') return 'Preparing the cache';
        if (s.sync.status === 'starting') return 'Starting';
        if (s.syncActive) return s.progress !== null ? `Indexing (${Math.round(s.progress)}%)` : 'Indexing';
        if (s.syncPaused) return 'Paused';
        if (s.sync.status === 'error') return 'Error';
        if (s.sync.status === 'cache_ready') return 'Up to date, cache ready';
        return s.sync.status ? 'Up to date' : 'Not checked yet';
    }

    /** The DSAP's labels: Indexing / Paused / Error / Backlog / Up to date. */
    function ftsStatus(s) {
        if (s.ftsActive) return 'Indexing';
        if (s.ftsPaused) return 'Paused';
        if (s.fts.status === 'error') return 'Error';
        if ((s.stats.ftsPending || 0) > 0 || (s.stats.ftsDrift || 0) > 0) return 'Backlog';
        return s.fts.status ? 'Up to date' : 'Not checked yet';
    }

    // ---- Indexing Options ----------------------------------------------------------------------

    /** A running index's progress: the phase message, a determinate bar, the count, the file. */
    function progressBlock(job, pausedBar) {
        const current = Number(job.current) || 0;
        const total = Number(job.total) || 0;
        const pct = job.percentage != null
            ? Math.max(0, Math.min(100, Number(job.percentage) || 0))
            : (total > 0 ? Math.round((current / total) * 100) : 0);
        const bar = total > 0 || job.percentage != null
            ? `<div class="cpl-idx-bar${pausedBar ? ' paused' : ''}" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><div style="width:${pct}%"></div></div>
               <div class="cpl-idx-count">${num(current)} of ${num(total)} (${pct}%)</div>`
            : '';
        return `<div class="cpl-idx-phase">${esc(job.message || '')}</div>${bar}${job.filename ? `<div class="cpl-idx-file" title="${esc(job.filename)}">${esc(job.filename)}</div>` : ''}`;
    }

    function listRows(s) {
        const syncItems = s.syncActive && s.sync.total ? num(s.sync.total) : (s.total ? num(s.total) : '');
        const syncDetail = s.syncActive ? progressBlock(s.sync, false) : '';
        const ftsShowBar = s.ftsActive || s.ftsPaused || (s.fts.status === 'indexing' && (Number(s.fts.total) || 0) > 0);
        const facts = [
            `Pending FTS: ${num(s.stats.ftsPending)}`,
            `Flag drift: ${num(s.stats.ftsDrift)}`
        ];
        if ((s.stats.blobPending || 0) > 0) facts.push(`Blob extract pending: ${num(s.stats.blobPending)}`);
        const ftsDetail = `<div class="cpl-idx-facts">${facts.map((f) => `<span>${esc(f)}</span>`).join('')}</div>${ftsShowBar ? progressBlock(s.fts, s.ftsPaused) : ''}`;
        const row = (key, name, status, items, detail) => `
            <div class="vdt-lv-row cpl-idx-row" data-idx="${key}">
                <span class="cpl-idx-c1"><img src="${ICON16}" alt="">${esc(name)}</span><span class="cpl-idx-c2">${esc(status)}</span><span class="cpl-idx-c3">${esc(items)}</span>
            </div>${detail ? `<div class="cpl-idx-detail" data-idx-detail="${key}">${detail}</div>` : ''}`;
        return row('search_sync', 'Search tags', syncStatus(s), syncItems, syncDetail)
            + row('prompt_fts', 'Prompt text', ftsStatus(s), s.total ? `${num(s.indexed)} of ${num(s.total)}` : '', ftsDetail);
    }

    function shieldLabel(text) {
        const m = /^(.*?)&(.)(.*)$/.exec(text);
        const body = m ? `${esc(m[1])}<u>${esc(m[2])}</u>${esc(m[3])}` : esc(text);
        return `<img class="cpl-idx-shield" src="${SHIELD}" alt="" draggable="false">${body}`;
    }

    function paintMain() {
        const ctx = mainCtx;
        if (!ctx || !ctx.modal || !ctx.modal.isConnected) { mainCtx = null; return; }
        const s = readState();
        ctx.text(403, `${num(s.indexed)} items indexed`);
        const status = ctx.holder(402);
        if (status) {
            status.innerHTML = `<span class="vdt-st-text">${esc(s.line)}${s.total ? `<br><br>Total images: ${esc(num(s.total))}` : ''}</span>`;
        }
        const body = ctx.content.querySelector('[data-vdt-id="405"] .vdt-lv-body');
        if (body) {
            const sel = body.querySelector('.vdt-lv-row.is-selected');
            const keep = sel ? sel.dataset.idx : null;
            body.innerHTML = listRows(s);
            if (keep) {
                const again = body.querySelector(`.vdt-lv-row[data-idx="${keep}"]`);
                if (again) again.classList.add('is-selected');
            }
        }
        const pause = ctx.el(411);
        if (pause) {
            pause.innerHTML = shieldLabel(s.paused ? '&Resume' : '&Pause');
            pause.disabled = !connected() || !(s.syncActive || s.ftsActive || s.paused);
        }
        paintAdvanced();
    }

    /** Pause covers both indexes; Resume resumes whichever is paused. */
    async function togglePause() {
        if (!connected()) return;
        const s = readState();
        const c = ws();
        try {
            if (s.paused) {
                if (s.syncPaused) await c.sendMessage('search_index_toggle_pause', {});
                if (s.ftsPaused) await c.sendMessage('prompt_index_resume', {});
            } else {
                if (!s.syncPaused) await c.sendMessage('search_index_toggle_pause', {});
                if (s.ftsActive) await c.sendMessage('prompt_index_pause', {});
            }
        } catch (err) {
            console.error('Indexing Options: pause / resume failed', err);
            callGlobal('showGlassToast', 'error', null, `Could not ${s.paused ? 'resume' : 'pause'} indexing: ${err && err.message ? err.message : err}`, false, 5000);
        }
    }

    /** The tray's own actions (mainMenuManager.js contextMenuAction switch, confirmations included). */
    function run(action) {
        const indicator = doc.getElementById('searchIndexingIndicator');
        doc.dispatchEvent(new CustomEvent('contextMenuAction', { detail: { action, target: indicator, item: { action } } }));
    }

    function listen() {
        if (listening) return;
        const client = ws();
        if (!client || typeof client.on !== 'function') return;
        listening = true;
        client.on('search_indexing_status', () => paintMain());
    }

    /** Nothing cached yet (a client that connected before the tray existed): ask once. */
    async function fetchStatus() {
        if (!connected()) return;
        const s = readState();
        if (s.fts.status) return;
        try {
            const r = await ws().sendMessage('get_prompt_index_status', {});
            const p = r && (r.job === 'prompt_fts' ? r : (r.data && (r.data.job === 'prompt_fts' || r.data.stats) ? r.data : (r.stats ? r : null)));
            if (p && !p.error) { fetched = p; paintMain(); }
        } catch (err) {
            console.warn('Indexing Options: prompt index status unavailable', err && err.message ? err.message : err);
        }
    }

    function raise(modal) {
        if (modal.classList.contains('minimised')) callGlobal('restoreMinimizedModal', modal);
        callGlobal('openModal', modal);
        callGlobal('bringModalToFront', modal);
    }

    function open(opts = {}) {
        if (!doc) return null;
        const V = root.vistaDialogTemplate;
        if (!V || typeof V.openDialog !== 'function') {
            // the template renderer comes with the vista_dialog_templates feature
            const fl = root.featureLoader;
            if (fl && typeof fl.loadFeature === 'function') {
                void fl.loadFeature('vista_dialog_templates').then(() => { if (root.vistaDialogTemplate) open(opts); });
            }
            return null;
        }
        if (mainCtx && mainCtx.modal && mainCtx.modal.isConnected) {
            raise(mainCtx.modal);
            return mainCtx;
        }
        listen();
        const ctx = V.openDialog({
            id: MAIN_ID,
            key: 'srchadmin:105',
            owner: opts.owner || null,
            icon: ICON16,
            captionIcon: true,
            overrides: {
                410: { html: `<img class="cpl-idx-drive" src="${ICON48}" alt="" draggable="false">` },
                404: { text: 'Index these:' }
            },
            init(c) {
                c.content.classList.add('cpl-idx');
                mainCtx = c;
                const lv = c.holder(405);
                if (lv) {
                    lv.classList.add('is-report', 'cpl-idx-list');
                    lv.querySelector('.vdt-lv-header').innerHTML = '<span class="vdt-lv-col cpl-idx-c1">Index</span><span class="vdt-lv-col cpl-idx-c2">Status</span><span class="vdt-lv-col cpl-idx-c3">Items</span>';
                }
                c.show(411, true);
                c.show(408, true);
                const adv = c.el(407);
                if (adv) adv.innerHTML = shieldLabel('A&dvanced');
                c.on(408, 'click', (ev) => { if (ev.target.closest('.vdt-link')) openHelp(c.modal); });
                paintMain();
            },
            buttons: {
                406: (c) => openLocations(c.modal),
                407: (c) => openAdvanced(c.modal),
                411: () => { void togglePause(); }
            },
            close() {
                mainCtx = null;
                if (advCtx && advCtx.modal && advCtx.modal.isConnected) advCtx.close();
            }
        });
        void fetchStatus();
        return ctx;
    }

    // ---- Indexed Locations (Modify) ------------------------------------------------------------

    function workspaceList() {
        // workspaceUtils.js keeps the server's workspaces in a script-level `workspaces`
        // eslint-disable-next-line no-undef
        const data = (typeof workspaces !== 'undefined' && workspaces) || root.workspaces || {};
        return Object.entries(data)
            .filter(([, w]) => w && typeof w === 'object')
            .map(([id, w]) => ({ id, name: w.name || id }))
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    }

    const LOCKED_TIP = 'Every workspace on this server is indexed. The server has no setting to leave a workspace out of the index.';

    function openLocations(owner) {
        const V = root.vistaDialogTemplate;
        if (!V) return;
        const list = workspaceList();
        V.openDialog({
            id: 'cplIndexedLocations',
            key: 'srchadmin:102',
            owner,
            icon: ICON16,
            captionIcon: true,
            init(c) {
                c.content.classList.add('cpl-idx');
                const tree = c.holder(302);
                if (tree) {
                    tree.classList.add('cpl-idx-tree');
                    tree.innerHTML = list.length
                        ? list.map((w, i) => `<div class="tbp-tree-row is-node" title="${esc(LOCKED_TIP)}"><input type="checkbox" id="cpl-idx-ws-${i}" checked disabled><label for="cpl-idx-ws-${i}"><img src="${FOLDER16}" alt="">${esc(w.name)}</label></div>`).join('')
                        : '<div class="tbp-tree-row is-node cpl-idx-none">No workspaces were found.</div>';
                }
                const lv = c.holder(304);
                if (lv) {
                    lv.classList.add('is-report', 'cpl-idx-summary');
                    lv.querySelector('.vdt-lv-header').innerHTML = '<span class="vdt-lv-col cpl-idx-s1">Included Locations</span><span class="vdt-lv-col">Exclude</span>';
                    lv.querySelector('.vdt-lv-body').innerHTML = list.map((w) => `<div class="vdt-lv-row" title="${esc(LOCKED_TIP)}"><span class="cpl-idx-s1"><img src="${FOLDER16}" alt="">${esc(w.name)}</span><span></span></div>`).join('');
                }
                c.show(306, true);
                const all = c.el(306);
                if (all) { all.innerHTML = shieldLabel('&Show all locations'); all.disabled = true; }
            }
        });
    }

    // ---- Advanced Options ----------------------------------------------------------------------

    // The layout of Vista's Index Settings tab (srchadmin:103: 290 x 240 DLU, rows of a 150-DLU label
    // and a 100 x 14 button at x 170, 20 DLU apart), filled with Melaton's own index tools.
    const ST = 0x50000000;
    const BTN = 0x50010000;
    const GROUP = 0x50000007;
    const ADV_TPL = {
        t: 'Index Settings', w: 290, h: 240, f: ['MS Shell Dlg', 8], s: 0,
        c: [
            [901, 'B', 7, 7, 272, 72, GROUP, 'Troubleshooting', 0],
            [-1, 'S', 16, 18, 150, 16, ST, 'Re-index the search tags of every picture.', 0],
            [911, 'B', 170, 18, 100, 14, BTN, '&Rebuild', 0],
            [-1, 'S', 16, 38, 150, 16, ST, 'Look for new and changed pictures now.', 0],
            [912, 'B', 170, 38, 100, 14, BTN, '&Index Now', 0],
            [-1, 'S', 16, 58, 150, 16, ST, 'Correct prompt records that are marked wrongly.', 0],
            [913, 'B', 170, 58, 100, 14, BTN, 'Re&concile', 0],
            [902, 'B', 7, 86, 272, 52, GROUP, 'Prompt text indexing', 0],
            [-1, 'S', 16, 97, 150, 16, ST, 'Index the prompts that are waiting.', 0],
            [921, 'B', 170, 97, 100, 14, BTN, '&Start', 0],
            [-1, 'S', 16, 117, 150, 16, ST, 'Stop prompt indexing. Prompts already indexed are kept.', 0],
            [922, 'B', 170, 117, 100, 14, BTN, 'C&ancel Indexing', 0],
            [903, 'B', 7, 145, 272, 52, GROUP, 'Search cache', 0],
            [-1, 'S', 16, 156, 150, 16, ST, 'Load the gallery view\'s search data now.', 0],
            [931, 'B', 170, 156, 100, 14, BTN, '&Prepare', 0],
            [-1, 'S', 16, 176, 150, 16, ST, 'Clear the search data kept for this session.', 0],
            [932, 'B', 170, 176, 100, 14, BTN, 'C&lear', 0],
            [941, 'SysLink', 7, 226, 272, 9, BTN, '<A>Advanced indexing &help</A>', 0]
        ]
    };

    const ADV_ACTIONS = {
        911: 'search-index-rebuild-all',
        912: 'search-index-trigger',
        913: 'prompt-index-reconcile',
        922: 'prompt-index-cancel',
        931: 'search-index-prepare-cache',
        932: 'search-index-clear-cache'
    };

    function paintAdvanced() {
        const ctx = advCtx;
        if (!ctx || !ctx.modal || !ctx.modal.isConnected) { advCtx = null; return; }
        const s = readState();
        const on = connected();
        const pending = (s.stats.ftsPending || 0) + (s.stats.ftsDrift || 0);
        const start = ctx.el(921, 'idx');
        if (start) {
            start.innerHTML = s.ftsPaused ? 'Res<u>u</u>me' : '<u>S</u>tart';
            start.disabled = !on || s.ftsActive || (pending === 0 && !s.ftsPaused);
        }
        const cancel = ctx.el(922, 'idx');
        if (cancel) cancel.disabled = !on || !(s.ftsActive || s.ftsPaused);
        // the search tag sync refuses to rebuild or start while it is paused (70-searchHandler.js)
        const rebuild = ctx.el(911, 'idx');
        if (rebuild) rebuild.disabled = !on || s.syncPaused || s.syncActive;
        const now = ctx.el(912, 'idx');
        if (now) now.disabled = !on || s.syncPaused || s.syncActive;
        [913, 931, 932].forEach((id) => { const b = ctx.el(id, 'idx'); if (b) b.disabled = !on; });
    }

    function openAdvanced(owner) {
        const V = root.vistaDialogTemplate;
        if (!V || typeof V.openSheet !== 'function') return;
        if (advCtx && advCtx.modal && advCtx.modal.isConnected) { raise(advCtx.modal); return; }
        advCtx = V.openSheet({
            id: 'cplIndexingAdvanced',
            title: 'Advanced Options',
            owner,
            bareCaption: true,
            icon: ICON16,
            noApply: true,
            pages: [{ key: 'idx', title: 'Index Settings', tpl: ADV_TPL }],
            init(c) {
                c.content.classList.add('cpl-idx');
                c.page('idx').addEventListener('click', (ev) => {
                    const b = ev.target.closest('button[data-vdt-id]');
                    if (b && !b.disabled) {
                        const id = Number(b.dataset.vdtId);
                        if (id === 921) run(readState().ftsPaused ? 'prompt-index-resume' : 'prompt-index-start');
                        else if (ADV_ACTIONS[id]) run(ADV_ACTIONS[id]);
                        return;
                    }
                    if (ev.target.closest('[data-vdt-id="941"] .vdt-link')) openHelp(c.modal);
                });
            },
            close() { advCtx = null; }
        });
        paintAdvanced();
    }

    // ---- How does indexing affect searches? ----------------------------------------------------

    const HELP_TPL = {
        t: 'Melaton Help and Support', w: 280, h: 216, f: ['MS Shell Dlg', 8], s: 0,
        c: [
            [-1, 'S', 7, 7, 266, 10, ST, 'How does indexing affect searches?', 0],
            [-1, 'S', 7, 22, 266, 24, ST, 'Melaton keeps two indexes of the pictures on this server, so a search does not have to open every picture:', 0],
            [-1, 'S', 15, 48, 258, 24, ST, 'Search tags: the tags of each picture. Tag searches in the gallery use this index.', 0],
            [-1, 'S', 15, 74, 258, 24, ST, 'Prompt text: the words of each picture\'s prompt. Searches by prompt text use this index.', 0],
            [-1, 'S', 7, 100, 266, 32, ST, 'New pictures are indexed on their own shortly after they are saved. While an index is being built, searches still work, but pictures that are not indexed yet are missing from the results.', 0],
            [-1, 'S', 7, 136, 266, 32, ST, 'If results often look out of date, click Advanced in Indexing Options, and then click Rebuild. Rebuilding can take a long time.', 0],
            [-1, 'S', 7, 172, 266, 16, ST, 'Pausing indexing stops both indexes until you click Resume.', 0],
            [2, 'B', 198, 195, 75, 14, 0x50010001, 'Close', 0]
        ]
    };

    function openHelp(owner) {
        const V = root.vistaDialogTemplate;
        if (!V) return;
        V.openDialog({
            id: 'cplIndexingHelp',
            tpl: HELP_TPL,
            owner,
            icon: '/static_images/vista-cpl/items/indexing-options-16.png',
            captionIcon: true,
            init(c) {
                c.content.classList.add('cpl-idx', 'cpl-idx-help');
            }
        });
    }

    // ---- Control Panel -------------------------------------------------------------------------

    function register() {
        if (registered) return true;
        const cpl = root.melatonControlPanel;
        if (!cpl || typeof cpl.registerPage !== 'function') return false;
        registered = true;
        cpl.registerItem({
            id: 'melaton-search',
            name: 'Indexing Options',
            image: `${ART}/indexing-32.png`,
            description: 'Change how Melaton indexes to enable faster searches.',
            open: () => {
                const w = typeof cpl.callerWindow === 'function' ? cpl.callerWindow() : null;
                open({ owner: w && w.modal ? w.modal : null });
            }
        });
        // Indexing Options is a dialog in Vista: open('search') and 'page:search' links open it
        // (melatonControlPanel.js calls a page's dialog() instead of showing a page)
        cpl.registerPage('search', {
            title: () => 'Indexing Options',
            body: () => '',
            dialog: (opts) => open({ owner: (opts && (opts.owner || (opts.window && opts.window.modal))) || null })
        });
        return true;
    }

    root.cplSearch = { register, open, _test: { readState, listRows, togglePause } };
    if (doc) {
        if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', register);
        else register();
    }
    if (typeof module !== 'undefined' && module.exports) module.exports = root.cplSearch;
})(typeof window !== 'undefined' ? window : globalThis);
