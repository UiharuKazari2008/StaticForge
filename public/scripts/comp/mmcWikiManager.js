/**
 * Wiki Caches (Yozora #831): the MMC snap-in that replaced the Wiki Manager DSAP on the Vista desktop
 * (dsap://wiki.dyna.dreamscape.jp/ opens Computer Management at Storage > Wiki Caches; phones and
 * Windows Classic keep the DSAP page, public/scripts/comp/fandomWikiManagerDsapApplet.js).
 *
 *   Wiki Caches            the summary: wikis, Fandom wikis, pages, page imports (get_fandom_wiki_manager)
 *     Sites                every cached wiki: Name, Kind, Pages, Last Updated, Location; Update (pull the
 *                          stored source pages again, update_wiki_import { siteId }), Open (in Grimoire),
 *                          Properties
 *     Imports              every page import: Wiki, Root Page, Pages, Exclusive Children, Created; Update
 *                          (update_wiki_import { importId }), Open Root Page, Delete (Vista confirmation,
 *                          the import and its exclusive children or the import only:
 *                          delete_fandom_wiki_import), Properties
 *
 * New Import... is an Aero Wizard: the kind of wiki (Fandom, NovelAI documentation as a static cache,
 * another MediaWiki site with /api.php), the page address and whether to follow child links (up to 25
 * pages), the progress (fandom_wiki_import_progress pushes), then the result, with the page opened in
 * Grimoire on Finish. Imports and updates are admin only on the server (WIKI_DESTRUCTIVE).
 *
 *   window.openWikiManagerConsole(node?, opts?)   node: 'root' | 'sites' | 'imports'; opts.wizard: true
 *                                                 starts New Import... (the old Import tab)
 *   window.mmcWikiManager.def()    the snap-in's def, for a console that hosts it (Computer Management's
 *                                  Storage, mmcConsole.compose): its callbacks use only the embed API
 *   window.mmcWikiManager.newImport(c)   the wizard over console c
 */
(function (root) {
    'use strict';

    const ID = 'wikiCaches';
    const TITLE = 'Wiki Caches';
    const APPS = '/static_images/app_icons';
    const VI = '/static_images/vista-icons';
    const ICON16 = `${APPS}/16/vista-wiki-caches.png`;
    const ICON32 = `${APPS}/32/vista-wiki-caches.png`;
    const ICON48 = `${APPS}/48/vista-wiki-caches.png`;
    const SITE16 = `${VI}/internet-globe-16.png`;
    const SITE32 = `${VI}/internet-globe-32.png`;
    const PAGE16 = `${VI}/explorer/text-16.png`;
    const PAGE32 = `${VI}/explorer/text-32.png`;
    const PROGRESS_EVENT = 'fandom_wiki_import_progress';
    const FOLLOW_MAX = 25;

    // dialog styles (Win32)
    const SS = 0x50020000;
    const SS_NOPREFIX = 0x50020080;
    const ETCHED = 0x50000010;
    const ICON = 0x50000003;
    const EDIT = 0x50010080;
    const CHECK = 0x50010003;
    const RADIO_FIRST = 0x50030009;
    const RADIO = 0x50010009;
    const EDGE = 0x200;
    const F = ['MS Shell Dlg', 8];

    const KINDS = { fandom: 'Fandom', mediawiki: 'MediaWiki', novelai: 'NovelAI documentation', static: 'Static cache' };
    const SOURCES = [
        { id: 'fandom', radio: 101, desc: 102, text: '&Fandom wiki', about: 'A page on a *.fandom.com wiki.', example: 'https://genshin-impact.fandom.com/wiki/Character/List' },
        { id: 'novelai', radio: 103, desc: 104, text: '&NovelAI documentation', about: 'docs.novelai.net, journal.novelai.net or a NovelAI blog post, kept as a static cache.', example: 'https://docs.novelai.net/image/tags.html' },
        { id: 'mediawiki', radio: 105, desc: 106, text: 'Another &MediaWiki site', about: 'Wikipedia, Miraheze, wiki.gg or any wiki that answers at /api.php.', example: 'https://en.wikipedia.org/wiki/Main_Page' }
    ];

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    const ws = () => root.wsClient || null;
    const num = (n) => Math.round(Number(n) || 0).toLocaleString('en-US');
    const plural = (n, one, many) => `${num(n)} ${Number(n) === 1 ? one : many}`;
    const when = (t) => (root.mmcConsole ? root.mmcConsole.when(t) : String(t || ''));
    const time = (t) => { const d = t ? new Date(typeof t === 'string' && /^\d+$/.test(t) ? Number(t) : t) : null; return d && !Number.isNaN(d.getTime()) ? d.getTime() : 0; };
    // one of this snap-in's nodes is showing (inside another console, the host may show its own)
    const active = (c) => !!c && (typeof c.isActive !== 'function' || c.isActive());

    const state = {
        data: null,          // get_fandom_wiki_manager: { stats, sites, imports }
        error: '',
        loading: null,       // the read in flight
        busy: null,          // an update running: { label, phase }
        importing: false,    // the wizard's import running
        consoles: new Set()  // the consoles (own or embed) showing this snap-in
    };

    async function send(type, data) {
        const client = ws();
        if (!client || typeof client.sendMessage !== 'function') throw new Error('Melaton is not connected to the server.');
        return client.sendMessage(type, data || {}, false);
    }

    function isAdmin() {
        try { return localStorage.getItem('userType') === 'admin'; } catch (_) { return false; }
    }

    const sites = () => (state.data && Array.isArray(state.data.sites) ? state.data.sites : []);
    const imports = () => (state.data && Array.isArray(state.data.imports) ? state.data.imports : []);
    const siteById = (id) => sites().find((s) => String(s.id) === String(id)) || null;
    const importById = (id) => imports().find((i) => String(i.id) === String(id)) || null;
    const kindName = (k) => KINDS[k] || KINDS.static;
    const siteLocation = (s) => s.fandomHost || s.origin || s.apiBase || '';

    /** Every console showing this snap-in again (only where one of its nodes is selected). */
    function refreshAll() {
        state.consoles.forEach((c) => {
            if (!c.modal || !c.modal.isConnected) { state.consoles.delete(c); return; }
            if (active(c)) c.refresh();
        });
    }

    function noteAll(text) {
        state.consoles.forEach((c) => { if (c.modal && c.modal.isConnected && active(c)) c.note(text); });
    }

    async function load() {
        if (state.loading) return state.loading;
        state.loading = (async () => {
            try {
                const data = await send('get_fandom_wiki_manager', {});
                state.data = data || { stats: {}, sites: [], imports: [] };
                state.error = '';
            } catch (err) {
                state.error = (err && err.message) || 'The server did not answer.';
            }
            state.loading = null;
            refreshAll();
        })();
        return state.loading;
    }

    /** "fetching Character/List (3/25)" from a progress push. */
    function phaseText(d) {
        if (!d) return '';
        const page = d.pageId ? ` ${d.pageId}` : '';
        const counts = d.current != null && d.total != null ? ` (${d.current}/${d.total})` : '';
        const phase = String(d.phase || 'working');
        return `${phase.charAt(0).toUpperCase()}${phase.slice(1)}${page}${counts}`;
    }

    /** Listens for the server's progress pushes while fn runs. */
    async function withProgress(onProgress, fn) {
        const client = ws();
        const h = (message) => { try { onProgress((message && message.data) || null); } catch (_) { /* gone */ } };
        if (client && typeof client.on === 'function') client.on(PROGRESS_EVENT, h);
        try { return await fn(); } finally { if (client && typeof client.off === 'function') client.off(PROGRESS_EVENT, h); }
    }

    // ---- Grimoire -----------------------------------------------------------------------------------

    function openUrl(url) {
        if (typeof root.openGrimoireUrl === 'function') { void root.openGrimoireUrl(url); return; }
        if (typeof root.openDsapInGrimoire === 'function') void root.openDsapInGrimoire(url);
    }

    function openSite(s) {
        if (!s) return;
        if (s.kind === 'fandom') openUrl(`rdf://wiki.fandom.jp/${s.id}`);
        else if (s.kind === 'novelai' || s.id === 'novelai') openUrl('rdf://docs.novelai.jp/');
        else openUrl(`edtx://en.grimoire.jp/docs/${s.id}`);
    }

    function openImport(imp) {
        if (imp && imp.wikiId && imp.rootPageId) openUrl(`rdf://wiki.fandom.jp/${imp.wikiId}/${imp.rootPageId}`);
    }

    /** The page an import just made (the Wiki Manager's own choice of address per kind). */
    function openResult(kind, r) {
        if (!r) return;
        if (kind === 'fandom' && r.wikiId && r.rootPageId) openUrl(`rdf://wiki.fandom.jp/${r.wikiId}/${r.rootPageId}`);
        else if (kind === 'novelai' && r.rootPageId) openUrl(`rdf://docs.novelai.jp/${r.rootPageId}`);
        else if (r.wikiId && r.rootPageId) openUrl(`edtx://en.grimoire.jp/docs/${r.wikiId}/${r.rootPageId}`);
        else if (r.wikiId) openUrl(`edtx://en.grimoire.jp/docs/${r.wikiId}`);
    }

    // ---- the tree and pages ---------------------------------------------------------------------------

    function nodes() {
        return [{
            id: 'root',
            name: TITLE,
            icon: ICON16,
            children: [
                { id: 'sites', name: 'Sites', icon: SITE16 },
                { id: 'imports', name: 'Imports', icon: PAGE16 }
            ]
        }];
    }

    function waitOrError(c) {
        if (state.error) return c.page(TITLE, '', [{ id: 'wk-error', title: 'Wiki Caches', body: `<p>${c.state(false, 'The wiki caches could not be read.')}</p><p>${esc(state.error)}</p>` }]);
        return c.page(TITLE, '', [{ id: 'wk-wait', title: 'Wiki Caches', body: '<p>Reading data, please wait...</p>' }]);
    }

    function rootPage(c) {
        if (!state.data) return waitOrError(c);
        const st = state.data.stats || {};
        return c.page(TITLE, '', [
            {
                id: 'wk-overview', title: 'Overview', body: `${c.overview(ICON32, ['Wiki Caches keeps offline copies of wikis for Grimoire: Fandom wikis, NovelAI documentation and other MediaWiki sites. Their images are mirrored on the server; nothing is hotlinked.'])}
                    <div class="mmc-buttons"><button type="button" class="btn-standard" data-act="new-import"${isAdmin() ? '' : ' disabled'}>New Import...</button></div>`
            },
            {
                id: 'wk-stats', title: 'Summary', body: c.props([
                    ['Wikis', `<span class="mmc-link" data-act="nav:sites">${esc(num(st.wikis))}</span>`],
                    ['Fandom wikis', esc(num(st.fandomWikis))],
                    ['Pages', esc(num(st.pages))],
                    ['Page imports', `<span class="mmc-link" data-act="nav:imports">${esc(num(st.imports))}</span>`]
                ])
            }
        ]);
    }

    const SITE_COLS = [
        { t: 'Name', w: 190, key: 'name', text: (d) => d.name || d.id },
        { t: 'Kind', w: 140, key: 'kind', text: (d) => kindName(d.kind) },
        { t: 'Pages', w: 60, num: true, key: 'pages', value: (d) => Number(d.pageCount) || 0, text: (d) => num(d.pageCount) },
        { t: 'Last Updated', w: 130, key: 'updated', value: (d) => time(d.updatedAt), text: (d) => when(d.updatedAt) },
        { t: 'Location', w: 200, key: 'location', text: (d) => siteLocation(d) }
    ];

    const IMPORT_COLS = [
        { t: 'Wiki', w: 150, key: 'wiki', text: (d) => d.wikiName || d.wikiId },
        { t: 'Root Page', w: 190, key: 'title', text: (d) => d.title || d.rootPageId },
        { t: 'Pages', w: 60, num: true, key: 'pages', value: (d) => Number(d.pageCount) || 0, text: (d) => num(d.pageCount) },
        { t: 'Exclusive Children', w: 110, num: true, key: 'children', value: (d) => Number(d.exclusiveChildCount) || 0, text: (d) => num(d.exclusiveChildCount) },
        { t: 'Created', w: 130, key: 'created', value: (d) => time(d.createdAt), text: (d) => when(d.createdAt) }
    ];

    function sitesPage(c) {
        if (!state.data) return waitOrError(c);
        const rows = sites().map((s) => ({ key: s.id, data: s, icon: SITE16 }));
        return { html: c.listView(SITE_COLS, rows, { sortId: 'wk-sites', sort: { key: 'name', dir: 1 }, empty: 'No cached wikis yet.' }), list: true };
    }

    function importsPage(c) {
        if (!state.data) return waitOrError(c);
        const rows = imports().map((i) => ({ key: String(i.id), data: i, icon: PAGE16 }));
        return { html: c.listView(IMPORT_COLS, rows, { sortId: 'wk-imports', sort: { key: 'created', dir: -1 }, empty: 'No page imports yet.' }), list: true };
    }

    function page(node, c) {
        if (node.id === 'sites') return sitesPage(c);
        if (node.id === 'imports') return importsPage(c);
        return rootPage(c);
    }

    // ---- commands -------------------------------------------------------------------------------------

    function commands() {
        return [{ text: 'New Import...', action: 'new-import', disabled: !isAdmin() || state.importing }];
    }

    function selCommands(node, key) {
        const busy = !!state.busy || !isAdmin();
        if (node.id === 'sites') {
            const s = siteById(key);
            if (!s) return null;
            return {
                title: s.name || s.id,
                items: [
                    { text: 'Update', action: 'update', icon: 3, disabled: busy },
                    { text: 'Open', action: 'open' },
                    { separator: true },
                    { text: 'Properties', action: 'props', icon: 8 }
                ]
            };
        }
        if (node.id === 'imports') {
            const i = importById(key);
            if (!i) return null;
            return {
                title: i.title || i.rootPageId,
                items: [
                    { text: 'Update', action: 'update', icon: 3, disabled: busy },
                    { text: 'Open Root Page', action: 'open' },
                    { text: 'Delete', action: 'delete', icon: 11, disabled: busy },
                    { separator: true },
                    { text: 'Properties', action: 'props', icon: 8 }
                ]
            };
        }
        return null;
    }

    function toolbar(node, c) {
        if (node.id === 'root') return [];
        const out = [{ id: 'refresh', i: 3, title: 'Refresh' }];
        const sel = node.id === 'sites' ? siteById(c.sel) : importById(c.sel);
        if (sel) out.push({ id: 'props', i: 8, title: 'Properties' });
        if (sel && node.id === 'imports') out.push({ id: 'delete', i: 11, title: 'Delete', disabled: !!state.busy || !isAdmin() });
        return out;
    }

    async function action(a, c) {
        const node = c.node;
        const site = node === 'sites' ? siteById(c.sel) : null;
        const imp = node === 'imports' ? importById(c.sel) : null;
        switch (a) {
            case 'refresh': c.note(''); await load(); return true;
            case 'new-import': newImport(c); return true;
            case 'open':
                if (site) openSite(site);
                else if (imp) openImport(imp);
                return true;
            case 'update':
                if (site) await update(c, { siteId: site.id }, site.name || site.id);
                else if (imp) await update(c, { importId: Number(imp.id) }, imp.title || imp.rootPageId);
                return true;
            case 'delete': if (imp) await confirmDelete(c, imp); return true;
            case 'props':
                if (site) siteProperties(c, site);
                else if (imp) importProperties(c, imp);
                return true;
            case 'help': if (typeof root.openHelpAndSupport === 'function') root.openHelpAndSupport('wiki-caches'); return true;
            default: return false;
        }
    }

    function rowOpen(key, node) {
        if (node.id === 'sites') openSite(siteById(key));
        else if (node.id === 'imports') openImport(importById(key));
    }

    /** Update: pull the import's pages, or every stored source page of a site, again. */
    async function update(c, args, label) {
        if (state.busy) return;
        state.busy = { label, phase: '' };
        c.note(`Updating ${label}...`);
        c.renderActions();
        let result = null;
        let error = null;
        try {
            result = await withProgress((d) => {
                if (!state.busy) return;
                state.busy.phase = phaseText(d);
                noteAll(`Updating ${label}: ${state.busy.phase}`);
            }, () => send('update_wiki_import', args));
        } catch (err) { error = err; }
        state.busy = null;
        if (error) {
            c.note('');
            refreshAll();
            await c.box(`<p>${esc(label)} could not be updated.</p><p>${esc((error && error.message) || 'The server did not answer.')}</p>`, null, { icon: 'error', title: TITLE });
            return;
        }
        const count = (result && result.pages && result.pages.length) || 0;
        await load();
        noteAll(`${label}: ${args.siteId ? 'pulled' : 'updated'} ${plural(count, 'page', 'pages')}.`);
    }

    /** Delete: Vista's confirmation, with what goes and what stays, and the import-only choice. */
    async function confirmDelete(c, imp) {
        const p = imp.preview || {};
        const goes = (p.deletePages || []).length;
        const shared = Number(imp.sharedCount) || (p.omitShared || []).length;
        const manual = Number(imp.manualOmitCount) || (p.omitManual || []).length;
        const kept = [];
        if (shared) kept.push(plural(shared, 'page shared with another import', 'pages shared with other imports'));
        if (manual) kept.push(plural(manual, 'page imported as its own root', 'pages imported as their own roots'));
        const html = `<p>Are you sure you want to delete the import of ${esc(imp.title || imp.rootPageId)}?</p>
            <p>${goes ? `${esc(plural(goes, 'page is', 'pages are'))} deleted with it.` : 'No pages are deleted with it.'}${kept.length ? ` ${esc(kept.join(' and '))} ${shared + manual === 1 ? 'is' : 'are'} kept.` : ''}</p>
            <div class="mmc-dialog-checks wkm-delete-choice">
                <label><input type="radio" name="wkmDeleteScope" value="children" checked> Delete the import and its exclusive children</label>
                <label><input type="radio" name="wkmDeleteScope" value="root"> Delete this import only (keep its children)</label>
            </div>`;
        const ok = await c.box(html, [
            { text: 'Yes', value: true, className: 'btn-standard primary' },
            { text: 'No', value: false, className: 'btn-standard' }
        ], {
            icon: 'warning',
            title: 'Delete Import',
            width: 420,
            resolveValue: (value) => {
                if (!value) return false;
                const pick = document.querySelector('#confirmationDialog input[name="wkmDeleteScope"]:checked');
                return { removeChildren: !pick || pick.value === 'children' };
            }
        });
        if (!ok) return;
        try {
            await send('delete_fandom_wiki_import', { importId: Number(imp.id), removeChildren: ok.removeChildren !== false });
        } catch (err) {
            await c.box(`<p>The import could not be deleted.</p><p>${esc((err && err.message) || 'The server did not answer.')}</p>`, null, { icon: 'error', title: 'Delete Import' });
            return;
        }
        c.sel = null;
        await load();
        noteAll(`The import of ${imp.title || imp.rootPageId} was deleted.`);
    }

    // ---- Properties -----------------------------------------------------------------------------------

    function templates() {
        const T = {
            // a site's General page (shell32 1080's layout: the icon and name, then rows under etched lines)
            'wkm:site': { t: 'General', w: 227, h: 218, f: F, s: 0, c: [
                [10, 'S', 7, 7, 21, 20, ICON, '', 0],
                [11, 'S', 56, 13, 164, 9, SS_NOPREFIX, '', 0],
                [12, 'S', 7, 32, 213, 1, ETCHED, '', 0],
                [13, 'S', 7, 38, 46, 9, SS, 'Kind:', 0], [14, 'S', 56, 38, 164, 9, SS_NOPREFIX, '', 0],
                [15, 'S', 7, 51, 46, 9, SS, 'Location:', 0], [16, 'S', 56, 51, 164, 9, SS_NOPREFIX, '', 0],
                [17, 'S', 7, 64, 46, 9, SS, 'Language:', 0], [18, 'S', 56, 64, 164, 9, SS_NOPREFIX, '', 0],
                [19, 'S', 7, 79, 213, 1, ETCHED, '', 0],
                [20, 'S', 7, 85, 46, 9, SS, 'Pages:', 0], [21, 'S', 56, 85, 164, 9, SS_NOPREFIX, '', 0],
                [22, 'S', 7, 98, 46, 9, SS, 'Updated:', 0], [23, 'S', 56, 98, 164, 9, SS_NOPREFIX, '', 0],
                [24, 'S', 7, 113, 213, 1, ETCHED, '', 0],
                [25, 'S', 7, 119, 46, 9, SS, 'Sources:', 0], [26, 'S', 56, 119, 164, 40, SS_NOPREFIX, '', 0]
            ] },
            // an import's General page
            'wkm:import': { t: 'General', w: 227, h: 218, f: F, s: 0, c: [
                [10, 'S', 7, 7, 21, 20, ICON, '', 0],
                [11, 'S', 56, 13, 164, 9, SS_NOPREFIX, '', 0],
                [12, 'S', 7, 32, 213, 1, ETCHED, '', 0],
                [13, 'S', 7, 38, 46, 9, SS, 'Wiki:', 0], [14, 'S', 56, 38, 164, 9, SS_NOPREFIX, '', 0],
                [15, 'S', 7, 51, 46, 9, SS, 'Root page:', 0], [16, 'S', 56, 51, 164, 9, SS_NOPREFIX, '', 0],
                [17, 'S', 7, 64, 46, 9, SS, 'Source:', 0], [18, 'S', 56, 64, 164, 18, SS_NOPREFIX, '', 0],
                [19, 'S', 7, 87, 213, 1, ETCHED, '', 0],
                [20, 'S', 7, 93, 46, 9, SS, 'Pages:', 0], [21, 'S', 56, 93, 164, 9, SS_NOPREFIX, '', 0],
                [22, 'S', 7, 106, 46, 9, SS, 'Children:', 0], [23, 'S', 56, 106, 164, 9, SS_NOPREFIX, '', 0],
                [24, 'S', 7, 119, 46, 9, SS, 'Kept:', 0], [25, 'S', 56, 119, 164, 18, SS_NOPREFIX, '', 0],
                [26, 'S', 7, 142, 213, 1, ETCHED, '', 0],
                [27, 'S', 7, 148, 46, 9, SS, 'Child links:', 0], [28, 'S', 56, 148, 164, 9, SS_NOPREFIX, '', 0],
                [29, 'S', 7, 161, 46, 9, SS, 'Group:', 0], [30, 'S', 56, 161, 164, 9, SS_NOPREFIX, '', 0],
                [31, 'S', 7, 174, 46, 9, SS, 'Created:', 0], [32, 'S', 56, 174, 164, 9, SS_NOPREFIX, '', 0]
            ] },
            // New Import: the kind of wiki
            'wkm:source': { t: '', w: 300, h: 150, f: F, s: 0, c: [
                [100, 'S', 0, 0, 290, 18, SS, 'Wiki Caches copies the page, its images and, if you want, the pages it links to, so Grimoire can show them offline.', 0],
                [101, 'B', 0, 28, 280, 10, RADIO_FIRST, SOURCES[0].text, 0],
                [102, 'S', 12, 40, 278, 9, SS_NOPREFIX, SOURCES[0].about, 0],
                [103, 'B', 0, 56, 280, 10, RADIO, SOURCES[1].text, 0],
                [104, 'S', 12, 68, 278, 9, SS_NOPREFIX, SOURCES[1].about, 0],
                [105, 'B', 0, 84, 280, 10, RADIO, SOURCES[2].text, 0],
                [106, 'S', 12, 96, 278, 9, SS_NOPREFIX, SOURCES[2].about, 0]
            ] },
            // the page and the child links
            'wkm:page': { t: '', w: 300, h: 150, f: F, s: 0, c: [
                [200, 'S', 0, 0, 290, 8, SS, 'Page &address:', 0],
                [201, 'E', 0, 11, 290, 14, EDIT, '', EDGE],
                [202, 'S', 0, 29, 290, 9, SS_NOPREFIX, '', 0],
                [203, 'S', 0, 48, 290, 8, SS, 'Pages to copy:', 0],
                [204, 'B', 0, 60, 280, 10, RADIO_FIRST, '&This page only', 0],
                [205, 'B', 0, 74, 280, 10, RADIO, `F&ollow child links (up to ${FOLLOW_MAX} pages)`, 0],
                [206, 'S', 0, 94, 290, 18, SS, 'Images are copied to the server with the pages; nothing is linked from the wiki itself.', 0],
                [207, 'S', 0, 120, 290, 26, SS, '', 0]
            ] },
            // the import running
            'wkm:progress': { t: '', w: 300, h: 150, f: F, s: 0, c: [
                [300, 'S', 0, 0, 290, 9, SS_NOPREFIX, '', 0],
                [301, 'S', 0, 14, 290, 10, SS, '', 0],
                [302, 'S', 0, 30, 290, 9, SS_NOPREFIX, '', 0]
            ] },
            'wkm:done': { t: '', w: 300, h: 150, f: F, s: 0, c: [
                [400, 'S', 0, 0, 290, 20, SS, '', 0],
                [401, 'B', 0, 26, 280, 10, CHECK, '&Open the page in Grimoire when I click Finish', 0]
            ] },
            'wkm:error': { t: '', w: 300, h: 150, f: F, s: 0, c: [
                [500, 'S', 0, 0, 290, 80, SS, '', 0]
            ] }
        };
        root.vistaDialogTemplates = Object.assign(root.vistaDialogTemplates || {}, T);
    }

    function dlgApi() {
        const api = root.vistaDialogTemplate;
        if (!api || typeof api.openSheet !== 'function' || typeof api.openWizard !== 'function') throw new Error('The dialog could not be shown.');
        templates();
        return api;
    }

    function siteProperties(c, s) {
        const P = 'wkm:site';
        dlgApi().openSheet({
            id: `wikiSiteProperties_${String(s.id).replace(/[^a-z0-9_-]/gi, '_')}`,
            title: `${s.name || s.id} Properties`,
            icon: SITE16,
            owner: c.modal,
            noApply: true,
            pages: [{ key: P, overrides: { 10: { image: SITE32 } } }],
            init: (ctx) => {
                ctx.text(11, s.name || s.id, P);
                ctx.text(14, kindName(s.kind), P);
                ctx.text(16, siteLocation(s) || '(none)', P);
                ctx.text(18, s.lang || '(not set)', P);
                ctx.text(21, num(s.pageCount), P);
                ctx.text(23, when(s.updatedAt) || 'Unknown', P);
                const src = (s.sourceUrls || []).filter(Boolean);
                ctx.html(26, src.length ? src.map((u) => `<div class="wkm-url" title="${esc(u)}">${esc(u)}</div>`).join('') : '<span class="vdt-st-text">(none stored)</span>', P);
            }
        });
    }

    function importProperties(c, imp) {
        const P = 'wkm:import';
        const shared = Number(imp.sharedCount) || 0;
        const manual = Number(imp.manualOmitCount) || 0;
        const kept = [];
        if (shared) kept.push(plural(shared, 'page shared with another import', 'pages shared with other imports'));
        if (manual) kept.push(plural(manual, 'page imported on its own', 'pages imported on their own'));
        dlgApi().openSheet({
            id: `wikiImportProperties_${String(imp.id).replace(/[^a-z0-9_-]/gi, '_')}`,
            title: `${imp.title || imp.rootPageId} Properties`,
            icon: PAGE16,
            owner: c.modal,
            noApply: true,
            pages: [{ key: P, overrides: { 10: { image: PAGE32 } } }],
            init: (ctx) => {
                ctx.text(11, imp.title || imp.rootPageId, P);
                ctx.text(14, imp.wikiName || imp.wikiId, P);
                ctx.text(16, imp.rootPageId || '', P);
                ctx.html(18, imp.sourceUrl ? `<div class="wkm-url is-wrap" title="${esc(imp.sourceUrl)}">${esc(imp.sourceUrl)}</div>` : '', P);
                ctx.text(21, num(imp.pageCount), P);
                ctx.text(23, `${num(imp.exclusiveChildCount)} only in this import`, P);
                ctx.text(25, kept.length ? kept.join('; ') : 'None', P);
                ctx.text(28, imp.followLinks ? `Followed (up to ${FOLLOW_MAX} pages)` : 'This page only', P);
                ctx.text(30, imp.group || 'Imported', P);
                ctx.text(32, when(imp.createdAt), P);
            }
        });
    }

    // ---- New Import -----------------------------------------------------------------------------------

    /** Which importer a URL belongs to (the Wiki Manager's own test). */
    function detectSource(url) {
        const text = String(url || '').trim().toLowerCase();
        if (!text) return 'unknown';
        if (text.includes('.fandom.com')) return 'fandom';
        if (text.includes('docs.novelai.net') || text.includes('journal.novelai.net')
            || text.includes('blog.novelai.net') || text.includes('novelai.medium.com')) {
            return 'novelai';
        }
        if (/^https?:\/\//.test(text) || /^[\w.-]+\.[a-z]{2,}(?:[:/]|$)/.test(text)) return 'mediawiki';
        return 'unknown';
    }

    function pageError(ctx, id, key, text) {
        ctx.html(id, text ? `<span class="wkm-wiz-error"><img src="${VI}/error-16.png" alt="">${esc(text)}</span>` : '', key);
    }

    function newImport(c) {
        if (state.importing) return;
        const api = dlgApi();
        let kind = 'fandom';
        let url = '';
        let follow = false;
        let result = null;
        let error = '';
        let wiz = null;
        const nextBtn = (ctx) => ctx.content.querySelector('.vdt-wizard-next');
        const setBar = (ctx, d) => {
            const bar = ctx.content.querySelector('.wkm-progress');
            if (!bar) return;
            const known = d && d.total != null && Number(d.total) > 0 && d.current != null;
            bar.classList.toggle('is-marquee', !known);
            const fill = bar.firstElementChild;
            if (fill) fill.style.width = known ? `${Math.max(2, Math.min(100, (Number(d.current) / Number(d.total)) * 100))}%` : '';
        };
        const run = async (ctx) => {
            state.importing = true;
            refreshAll();
            result = null;
            error = '';
            const packet = kind === 'novelai' ? 'import_static_wiki' : 'import_fandom_wiki_page';
            try {
                result = await withProgress((d) => {
                    if (wiz && !wiz.state.done) {
                        ctx.text(302, phaseText(d), 'wkm:progress');
                        setBar(ctx, d);
                    } else noteAll(`Importing ${url}: ${phaseText(d)}`);
                }, () => send(packet, { url, followLinks: follow, maxPages: follow ? FOLLOW_MAX : 1, group: 'Imported', recordImport: true }));
            } catch (err) {
                error = (err && err.message) || 'The server did not answer.';
            }
            state.importing = false;
            void load();
            const count = (result && result.pages && result.pages.length) || 0;
            if (!wiz || wiz.state.done) {
                // the wizard was closed: the import ran on; say how it ended
                noteAll(error ? `The import of ${url} failed: ${error}` : `Imported ${plural(count, 'page', 'pages')} from ${url}.`);
                return;
            }
            ctx.go(error ? 'wkm:error' : 'wkm:done');
        };
        wiz = api.openWizard({
            id: 'wikiCachesImportWizard',
            title: 'New Import',
            icon: ICON32,
            owner: c.modal,
            init: (ctx) => {
                SOURCES.forEach((s) => ctx.on(s.radio, 'change', () => { if (ctx.get(s.radio, 'wkm:source')) kind = s.id; }, 'wkm:source'));
                ctx.set(SOURCES[0].radio, true, 'wkm:source');
                ctx.set(204, true, 'wkm:page');
                ctx.set(401, true, 'wkm:done');
                ctx.html(301, '<div class="wkm-progress is-marquee" role="progressbar"><div></div></div>', 'wkm:progress');
                const edit = ctx.el(201, 'wkm:page');
                if (edit) edit.addEventListener('input', () => pageError(ctx, 207, 'wkm:page', ''));
            },
            pages: [
                { key: 'wkm:source', instruction: 'What kind of wiki do you want to copy?' },
                {
                    key: 'wkm:page', instruction: 'Type the address of a page', nextText: 'Import',
                    show: (ctx) => {
                        const s = SOURCES.find((x) => x.id === kind) || SOURCES[0];
                        ctx.text(202, `For example: ${s.example}`, 'wkm:page');
                    },
                    next: (ctx) => {
                        url = String(ctx.get(201, 'wkm:page') || '').trim();
                        follow = !!ctx.get(205, 'wkm:page');
                        if (!url) { pageError(ctx, 207, 'wkm:page', 'Type the address of a wiki page.'); return false; }
                        const found = detectSource(url);
                        if (found === 'unknown') { pageError(ctx, 207, 'wkm:page', 'This is not a wiki address. Type a whole address, such as the example above.'); return false; }
                        if (found !== kind) {
                            const s = SOURCES.find((x) => x.id === found);
                            pageError(ctx, 207, 'wkm:page', `This is the address of a page on ${found === 'mediawiki' ? 'another MediaWiki site' : `a ${kindName(found)} site`}. Go back and choose ${s ? s.text.replace(/&/g, '') : kindName(found)}, or type another address.`);
                            return false;
                        }
                        return 'wkm:progress';
                    }
                },
                {
                    key: 'wkm:progress', instruction: 'Importing the page...', noNext: true, noBack: true, transient: true,
                    show: (ctx) => {
                        ctx.text(300, url, 'wkm:progress');
                        ctx.text(302, 'Starting...', 'wkm:progress');
                        setBar(ctx, null);
                        void run(ctx);
                    }
                },
                {
                    key: 'wkm:done', instruction: 'The page was imported', finish: true, noBack: true,
                    show: (ctx) => {
                        const count = (result && result.pages && result.pages.length) || 0;
                        const site = result && result.wikiId ? siteById(result.wikiId) : null;
                        const where = site ? site.name : (result && result.wikiId) || '';
                        ctx.html(400, `<div class="wkm-wiz-text"><p>${esc(plural(count, 'page was', 'pages were'))} copied${where ? ` to ${esc(where)}` : ''}.</p></div>`, 'wkm:done');
                        ctx.show(401, !!(result && (result.wikiId || result.rootPageId)), 'wkm:done');
                    }
                },
                {
                    key: 'wkm:error', instruction: 'The page could not be imported', noNext: true,
                    show: (ctx) => ctx.html(500, `<div class="wkm-wiz-text"><p>${esc(error)}</p><p>Click Back to change the address, or Cancel.</p></div>`, 'wkm:error')
                }
            ],
            finish: (ctx) => {
                if (ctx.get(401, 'wkm:done')) openResult(kind, result);
                const count = (result && result.pages && result.pages.length) || 0;
                c.note(`Imported ${plural(count, 'page', 'pages')}.`);
                return true;
            }
        });
        if (!wiz) state.importing = false;
    }

    // ---- the def --------------------------------------------------------------------------------------

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
            toolbar,
            action,
            rowOpen,
            // the toolbar's Properties / Delete follow the selected row
            onSelectRow: (key, node, c) => { if (typeof c.renderToolbar === 'function') c.renderToolbar(); },
            status: (node) => {
                if (state.busy) return `Updating ${state.busy.label}${state.busy.phase ? `: ${state.busy.phase}` : '...'}`;
                if (state.importing) return 'Importing a page...';
                if (state.error) return 'The server did not answer.';
                if (!state.data) return 'Reading data, please wait...';
                const st = state.data.stats || {};
                if (node.id === 'sites') return plural(sites().length, 'wiki', 'wikis');
                if (node.id === 'imports') return plural(imports().length, 'import', 'imports');
                return `${plural(st.wikis, 'wiki', 'wikis')}, ${plural(st.pages, 'page', 'pages')}`;
            },
            about: { version: '1.0.0', lines: ['Wiki Caches keeps offline copies of wikis for Grimoire.'] },
            onOpen: (c) => {
                state.consoles.add(c);
                void load();
            },
            onClose: (c) => { state.consoles.delete(c); }
        };
    }

    async function openWikiManagerConsole(node, opts = {}) {
        if (root.featureLoader) await root.featureLoader.loadFeature('mmc_snapins');
        if (!root.mmcConsole) return null;
        const target = ['root', 'sites', 'imports'].includes(node) ? node : null;
        const c = root.mmcConsole.open(def(), target ? { node: target } : {});
        if (c && opts.wizard) newImport(c);
        return c;
    }

    root.openWikiManagerConsole = openWikiManagerConsole;
    root.mmcWikiManager = { open: openWikiManagerConsole, def, newImport, detectSource, _state: state };
})(typeof window !== 'undefined' ? window : globalThis);
