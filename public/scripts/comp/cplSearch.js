/**
 * Control Panel's Melaton Search (Yukimi 2026-10-13): the search indexing status and controls,
 * laid out as Vista's Indexing Options (srchadmin.dll on the VM): the 48px icon, "N items
 * indexed", the status line ("Indexing complete." / "Indexing in progress. Search results might
 * not be complete during this time." / "Indexing is paused."), the bar while it runs, the indexes
 * as a list (Search tags = the search sync, Prompt text = the prompt FTS index), and the buttons:
 * Start indexing, Pause / Resume, Advanced ▾ (prepare / clear the search cache, erase and rebuild
 * the index, the prompt index's start / pause / resume / cancel / reconcile).
 *
 * Status: the tray indicator's _indexJobs (search_sync, prompt_fts) and the
 * search_indexing_status push (public/scripts/ws/handlers/60-searchInbound.js). Actions are the
 * tray icon's own (systemTrayManager.js attachSearchIndexingTrayContextMenu), fired as
 * contextMenuAction events so mainMenuManager.js runs them, confirmations included.
 */
(function (root) {
    'use strict';

    const ART = '/static_images/vista-cpl';
    let main = null;
    let registered = false;
    let listening = false;

    function esc(text) {
        return String(text == null ? '' : text)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function ws() {
        return root.wsClient || null;
    }

    const ACTIVE = ['starting', 'indexing', 'cache_init'];

    /** Both jobs' state as the page shows it. */
    function readState() {
        // the tray indicator keeps both jobs (60-searchInbound.js handleSearchIndexingStatusMessage)
        const indicator = typeof document !== 'undefined' ? document.getElementById('searchIndexingIndicator') : null;
        const jobs = (indicator && indicator._indexJobs) || {};
        const client = ws() || {};
        const sync = jobs.search_sync || {};
        const fts = jobs.prompt_fts || client._lastPromptFtsIndexingStatus || {};
        const stats = fts.stats || {};
        const syncActive = ACTIVE.includes(sync.status);
        const ftsActive = ACTIVE.includes(fts.status) || fts.running === true;
        const paused = sync.status === 'paused' || fts.status === 'paused' || fts.paused === true;
        let line = 'Indexing complete.';
        if (syncActive || ftsActive) line = 'Indexing in progress. Search results might not be complete during this time.';
        else if (paused) line = 'Indexing is paused.';
        else if (sync.status === 'error' || fts.status === 'error') line = 'Indexing stopped because of an error.';
        else if ((stats.ftsPending || 0) > 0) line = `${stats.ftsPending} items are waiting to be indexed.`;
        const pct = Number.isFinite(Number(sync.percentage)) ? Number(sync.percentage) : null;
        return {
            sync, fts, stats, syncActive, ftsActive, paused, line,
            progress: syncActive && pct !== null ? pct : null,
            indexed: stats.ftsDone || 0,
            total: stats.totalImages || 0
        };
    }

    function syncStatus(s) {
        if (s.syncActive) return s.progress !== null ? `Indexing (${Math.round(s.progress)}%)` : 'Indexing';
        if (s.sync.status === 'paused') return 'Paused';
        if (s.sync.status === 'error') return 'Error';
        if (s.sync.status === 'cache_ready') return 'Up to date, cache ready';
        return s.sync.status ? 'Up to date' : 'Not checked yet';
    }

    function ftsStatus(s) {
        if (s.ftsActive) return 'Indexing';
        if (s.fts.paused || s.fts.status === 'paused') return 'Paused';
        if (s.fts.status === 'error') return 'Error';
        if ((s.stats.ftsPending || 0) > 0) return `${s.stats.ftsPending} waiting`;
        return s.fts.status ? 'Up to date' : 'Not checked yet';
    }

    function html() {
        const s = readState();
        const bar = s.syncActive || s.ftsActive
            ? (s.progress !== null
                ? `<div class="cpl-search-progress animate" role="progressbar" aria-valuenow="${Math.round(s.progress)}"><div style="width:${Math.round(s.progress)}%"></div></div>`
                : '<div class="cpl-search-progress marquee" role="progressbar" aria-label="Indexing"></div>')
            : '';
        return `
            <h1 class="cpl-page-title">Melaton Search</h1>
            <div class="cpl-search-head">
                <img src="${ART}/indexing-48.png" alt="">
                <div>
                    <p class="cpl-search-count">${esc(s.indexed.toLocaleString())} items indexed${s.total ? ` of ${esc(s.total.toLocaleString())}` : ''}</p>
                    <p class="cpl-search-line">${esc(s.line)}</p>
                    ${bar}
                    ${s.sync.message && (s.syncActive || s.sync.status === 'error') ? `<p class="cpl-search-detail">${esc(s.sync.message)}</p>` : ''}
                </div>
            </div>
            <p class="cpl-search-caption">Index these:</p>
            <div class="cpl-search-list">
                <table>
                    <thead><tr><th>Index</th><th>Status</th><th>Items</th></tr></thead>
                    <tbody>
                        <tr><td><img src="${ART}/indexing-32.png" alt="">Search tags</td><td>${esc(syncStatus(s))}</td><td>${s.sync.total ? esc(Number(s.sync.total).toLocaleString()) : ''}</td></tr>
                        <tr><td><img src="${ART}/indexing-32.png" alt="">Prompt text</td><td>${esc(ftsStatus(s))}</td><td>${s.total ? esc(`${s.indexed.toLocaleString()} of ${s.total.toLocaleString()}`) : ''}</td></tr>
                    </tbody>
                </table>
            </div>
            <div class="cpl-search-buttons">
                <button type="button" class="cpl-wu-button" data-cpl-search="search-index-trigger">Start indexing</button>
                <button type="button" class="cpl-wu-button" data-cpl-search="advanced">Advanced <span class="cpl-search-drop" aria-hidden="true"></span></button>
                <button type="button" class="cpl-wu-button" data-cpl-search="search-index-toggle-pause">${s.sync.status === 'paused' ? 'Resume' : 'Pause'}</button>
            </div>`;
    }

    function paint() {
        if (!main || !main.isConnected) return;
        const host = main.querySelector('.cpl-search-page');
        if (host) host.innerHTML = html();
    }

    /** The tray's own actions (mainMenuManager.js contextMenuAction switch). */
    function run(action) {
        const indicator = document.getElementById('searchIndexingIndicator');
        document.dispatchEvent(new CustomEvent('contextMenuAction', { detail: { action, target: indicator, item: { action } } }));
    }

    function advancedMenu(btn, ev) {
        const cm = root.contextMenu;
        if (!cm) return;
        const s = readState();
        const config = {
            sections: [{
                type: 'list',
                items: [
                    { text: 'Prepare Search Cache', action: 'search-index-prepare-cache' },
                    { text: 'Clear Search Cache', action: 'search-index-clear-cache' },
                    { separator: true },
                    { text: 'Rebuild the Search Index…', action: 'search-index-rebuild-all' },
                    { separator: true },
                    { text: 'Start Prompt Indexing', action: 'prompt-index-start', disabled: s.ftsActive || ((s.stats.ftsPending || 0) === 0 && !s.fts.paused) },
                    { text: 'Pause Prompt Indexing', action: 'prompt-index-pause', disabled: !s.ftsActive },
                    { text: 'Resume Prompt Indexing', action: 'prompt-index-resume', disabled: !s.fts.paused },
                    { text: 'Cancel Prompt Indexing', action: 'prompt-index-cancel', disabled: !(s.ftsActive || s.fts.paused) },
                    { text: 'Reconcile Prompt Index', action: 'prompt-index-reconcile' }
                ]
            }],
            onAction: (action) => run(action)
        };
        cm.attachClickMenuToElement(btn, config);
        if (typeof cm.showMenu === 'function') cm.showMenu(ev, btn);
    }

    function listen() {
        if (listening) return;
        const client = ws();
        if (!client || typeof client.on !== 'function') return;
        listening = true;
        client.on('search_indexing_status', () => paint());
    }

    function mount(el) {
        main = el;
        listen();
        paint();
        const modal = el.closest('.modal');
        if (modal && !modal.dataset.cplSearchWired) {
            modal.dataset.cplSearchWired = '1';
            modal.addEventListener('click', (ev) => {
                const b = ev.target.closest('[data-cpl-search]');
                if (!b || !modal.contains(b)) return;
                if (b.dataset.cplSearch === 'advanced') advancedMenu(b, ev);
                else run(b.dataset.cplSearch);
            });
        }
    }

    function unmount() {
        main = null;
    }

    function register() {
        if (registered) return true;
        const cpl = root.melatonControlPanel;
        if (!cpl || typeof cpl.registerPage !== 'function') return false;
        registered = true;
        cpl.registerItem({
            id: 'melaton-search',
            name: 'Melaton Search',
            image: `${ART}/indexing-32.png`,
            description: 'See how far search indexing has come, and pause, start or rebuild it.',
            open: () => cpl.open('search')
        });
        cpl.registerPage('search', {
            title: () => 'Melaton Search',
            tasks: () => `
                <div class="cpl-task-group">
                    <h3 class="cpl-task-heading">Tasks</h3>
                    <ul class="cpl-task-list">
                        <li><button type="button" class="cpl-link" data-cpl-search="search-index-trigger">Start indexing</button></li>
                        <li><button type="button" class="cpl-link" data-cpl-search="search-index-toggle-pause">Pause or resume indexing</button></li>
                        <li><button type="button" class="cpl-link" data-cpl-search="search-index-rebuild-all">Rebuild the index</button></li>
                    </ul>
                </div>`,
            body: () => '<div class="cpl-search-page"></div>',
            mount,
            unmount
        });
        return true;
    }

    root.cplSearch = { register, open: () => register() && root.melatonControlPanel.open('search'), _test: { readState, html } };
    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register);
        else register();
    }
    if (typeof module !== 'undefined' && module.exports) module.exports = root.cplSearch;
})(typeof window !== 'undefined' ? window : globalThis);
