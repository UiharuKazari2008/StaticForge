/**
 * Wiki Manager DSAP — wiki.dyna.dreamscape.jp
 * Import, list, pull, and update offline wikis (Fandom, NovelAI docs, MediaWiki api.php, static caches).
 * Depends on: dsapRegistry.js, dsapSmfMarkup.js, dropdown.js, confirmationDialog.js
 */

const FANDOM_WIKI_DSAP_URL = 'wiki.dyna.dreamscape.jp';
const FANDOM_WIKI_FOLLOW_OPTIONS = [
    { value: 'none', name: 'This page only' },
    { value: 'follow', name: 'Follow child links (max 25)' }
];
const FANDOM_WIKI_DELETE_OPTIONS = [
    { value: 'children', name: 'Import and exclusive children' },
    { value: 'root', name: 'This import only (keep children)' }
];

function fandomWikiDsapEscapeHtml(text) {
    if (typeof dsapSmfEscapeHtml === 'function') return dsapSmfEscapeHtml(text);
    if (text == null) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

function fandomWikiDsapEscapeAttr(text) {
    if (typeof dsapSmfEscapeAttr === 'function') return dsapSmfEscapeAttr(text);
    return String(text || '').replace(/"/g, '&quot;');
}

function fandomWikiDsapDetectSource(url) {
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

function fandomWikiDsapOpenSite(host, site) {
    if (!site) return;
    if (site.kind === 'fandom') {
        host.navigate(`rdf://wiki.fandom.jp/${site.id}`);
        return;
    }
    if (site.kind === 'novelai' || site.id === 'novelai') {
        host.navigate('docs.novelai.jp');
        return;
    }
    if (host.shell && typeof host.shell.showStaticWikiSiteIndex === 'function') {
        host.shell.showStaticWikiSiteIndex(site.id);
        return;
    }
    host.navigate(`edtx://en.grimoire.jp/docs/${site.id}`);
}

function fandomWikiDsapActiveTab(host) {
    const first = (host.getPathSegments()[0] || 'import').toLowerCase();
    return first === 'library' ? 'library' : 'import';
}

function fandomWikiDsapBuildTabUrl(tabId) {
    if (tabId === 'library') return `dsap://${FANDOM_WIKI_DSAP_URL}/library`;
    return `dsap://${FANDOM_WIKI_DSAP_URL}/import`;
}

function fandomWikiDsapBuildHtml(activeTab) {
    const toolTitle = activeTab === 'library' ? 'Library' : 'Import';
    const importHidden = activeTab === 'import' ? '' : ' hidden';
    const libraryHidden = activeTab === 'library' ? '' : ' hidden';
    return `
<div data-dsap="fandom-wiki-manager" class="dsap-root dsap-smf fandom-wiki-dsap">
${dsapSmfBuildHeader({
    branchTitle: DSAP_SMF_BRANCH_WIKI,
    toolTitle
})}
${dsapSmfBuildTabBar([
    { id: 'import', label: 'Import', icon: 'fas fa-file-import' },
    { id: 'library', label: 'Library', icon: 'fas fa-books' }
], activeTab, { tabBarId: 'fandomWikiTabBar', dataAttr: 'data-fandom-wiki-tab' })}

<div id="fandomWikiImportPanel" class="fandom-wiki-dsap-panel${importHidden}">
    ${dsapSmfBuildSectionHdr('Import a wiki page')}
    <p class="fandom-wiki-dsap-help">Paste a <code>*.fandom.com/wiki/…</code>, NovelAI docs/journal/blog, or other MediaWiki URL (Wikipedia, Miraheze, wiki.gg, independently hosted — must expose <code>/api.php</code>). Images are mirrored locally — nothing is hotlinked. Follow-children defaults to this page only and is capped at 25 pages.</p>
    <div class="dsap-smf-toolbar">
        <label class="fandom-wiki-dsap-label" for="fandomWikiUrlInput">Page URL</label>
        <input type="text" id="fandomWikiUrlInput" placeholder="https://genshin-impact.fandom.com/wiki/Character/List">
    </div>
    <div class="dsap-smf-toolbar">
        <label class="fandom-wiki-dsap-label">Children</label>
        <div class="custom-dropdown">
            <button type="button" id="fandomWikiFollowBtn" class="custom-dropdown-btn hover-show colored">
                <span id="fandomWikiFollowSelected">This page only</span>
            </button>
            <div id="fandomWikiFollowMenu" class="custom-dropdown-menu hidden"></div>
        </div>
        <input type="hidden" id="fandomWikiFollowHidden" value="none">
        <button type="button" class="dsap-smf-btn" id="fandomWikiImportBtn">Import</button>
    </div>
    <div id="fandomWikiImportStatus" class="fandom-wiki-dsap-status">Ready.</div>
</div>

<div id="fandomWikiLibraryPanel" class="fandom-wiki-dsap-panel${libraryHidden}">
    ${dsapSmfBuildSectionHdr('Cached wikis')}
    ${dsapSmfBuildStatsTable([
        { label: 'Wikis', valueHtml: '<span id="fandomWikiStatWikis">0</span>' },
        { label: 'Pages', valueHtml: '<span id="fandomWikiStatPages">0</span>' },
        { label: 'Imports', valueHtml: '<span id="fandomWikiStatImports">0</span>' }
    ], 'fandomWikiStats')}
    <div id="fandomWikiSitesEmpty" class="fandom-wiki-dsap-empty hidden">No cached wikis yet.</div>
    <table class="sec-data-table" id="fandomWikiSitesTable" cellspacing="0" cellpadding="4" width="100%" border="1">
        <thead>
            <tr>
                <th align="left">Wiki</th>
                <th align="left">Kind</th>
                <th align="right">Pages</th>
                <th></th>
            </tr>
        </thead>
        <tbody id="fandomWikiSitesBody"></tbody>
    </table>
    ${dsapSmfBuildSectionHdr('Page imports')}
    <div id="fandomWikiLibraryEmpty" class="fandom-wiki-dsap-empty hidden">No page imports yet.</div>
    <table class="sec-data-table" id="fandomWikiLibraryTable" cellspacing="0" cellpadding="4" width="100%" border="1">
        <thead>
            <tr>
                <th align="left">Wiki</th>
                <th align="left">Root page</th>
                <th align="right">Pages</th>
                <th align="right">Exclusive children</th>
                <th align="left">Created</th>
                <th></th>
            </tr>
        </thead>
        <tbody id="fandomWikiLibraryBody"></tbody>
    </table>
</div>
</div>`;
}

const fandomWikiDsapCss = `
[data-dsap="fandom-wiki-manager"] .fandom-wiki-dsap-help {
    margin: 8px 12px;
    font-size: 12px;
}
[data-dsap="fandom-wiki-manager"] .fandom-wiki-dsap-label {
    min-width: 72px;
    align-self: center;
}
[data-dsap="fandom-wiki-manager"] #fandomWikiUrlInput {
    flex: 1;
    min-width: 0;
}
[data-dsap="fandom-wiki-manager"] .fandom-wiki-dsap-status {
    margin: 8px 12px;
    font-size: 12px;
}
[data-dsap="fandom-wiki-manager"] .fandom-wiki-dsap-empty {
    margin: 12px;
}
[data-dsap="fandom-wiki-manager"] .fandom-wiki-dsap-panel.hidden,
[data-dsap="fandom-wiki-manager"] .hidden {
    display: none;
}
`;

const fandomWikiDsapDriver = {
    _host: null,
    _progressHandler: null,

    init(host) {
        this._host = host;
        const root = host.getRoot();
        this._wireTabs(host, root);
        this._wireFollowDropdown(root);
        const importBtn = root.querySelector('#fandomWikiImportBtn');
        if (importBtn) {
            importBtn.addEventListener('click', () => this._startImport(host, root));
        }
        this._progressHandler = (message) => this._onProgress(root, message && message.data);
        host.on('fandom_wiki_import_progress', this._progressHandler);
        this._loadLibrary(host, root);
        host.registerContextMenuItems('#fandomWikiLibraryBody tr', (el) => {
            const importId = el.getAttribute('data-import-id');
            if (!importId) return [];
            return [
                { text: 'Open root page', icon: 'fas fa-book-open', action: 'fandom-open-root', data: { importId } },
                { text: 'Delete import', icon: 'fas fa-trash', action: 'fandom-delete-import', data: { importId } }
            ];
        });
        host.registerContextMenuAction('fandom-open-root', (el) => {
            const wikiId = el.getAttribute('data-wiki-id');
            const pageId = el.getAttribute('data-page-id');
            if (wikiId && pageId) host.navigate(`rdf://wiki.fandom.jp/${wikiId}/${pageId}`);
        });
        host.registerContextMenuAction('fandom-delete-import', (el) => {
            this._confirmDelete(host, root, Number(el.getAttribute('data-import-id')));
        });
    },

    destroy() {
        this._host = null;
        this._progressHandler = null;
    },

    refresh(host) {
        this._loadLibrary(host, host.getRoot());
    },

    _wireTabs(host, root) {
        // dsapSmfWireTabBar: public/scripts/comp/dsapSmfMarkup.js
        dsapSmfWireTabBar(root, '#fandomWikiTabBar', 'data-fandom-wiki-tab', (tabId) => fandomWikiDsapBuildTabUrl(tabId), host);
    },

    _wireFollowDropdown(root) {
        const container = root.querySelector('.custom-dropdown');
        const btn = root.querySelector('#fandomWikiFollowBtn');
        const menu = root.querySelector('#fandomWikiFollowMenu');
        const hidden = root.querySelector('#fandomWikiFollowHidden');
        const selected = root.querySelector('#fandomWikiFollowSelected');
        if (!container || !btn || !menu || !hidden) return;
        // setupDropdown: public/scripts/comp/dropdown.js
        // renderSimpleDropdown: public/scripts/comp/manualDropdownManager.js
        setupDropdown(
            container,
            btn,
            menu,
            (selectedVal) => renderSimpleDropdown(
                menu,
                FANDOM_WIKI_FOLLOW_OPTIONS,
                'value',
                'name',
                (item) => {
                    hidden.value = item.value;
                    selected.textContent = item.name;
                },
                closeDropdown,
                selectedVal
            ),
            () => hidden.value
        );
    },

    _onProgress(root, data) {
        if (!data) return;
        const status = root.querySelector('#fandomWikiImportStatus');
        if (!status) return;
        const page = data.pageId ? ` ${data.pageId}` : '';
        const counts = (data.current != null && data.total != null)
            ? ` (${data.current}/${data.total})`
            : '';
        status.textContent = `${data.phase || 'working'}${page}${counts}`;
    },

    async _startImport(host, root) {
        const url = (root.querySelector('#fandomWikiUrlInput')?.value || '').trim();
        const follow = (root.querySelector('#fandomWikiFollowHidden')?.value || 'none') === 'follow';
        const status = root.querySelector('#fandomWikiImportStatus');
        const btn = root.querySelector('#fandomWikiImportBtn');
        if (!url) {
            if (host.showToast) host.showToast('error', 'Paste a Fandom, NovelAI, or MediaWiki wiki URL');
            return;
        }
        const kind = fandomWikiDsapDetectSource(url);
        if (kind === 'unknown') {
            if (host.showToast) host.showToast('error', 'URL must be *.fandom.com, NovelAI docs/journal/blog, or a MediaWiki site with /api.php');
            return;
        }
        if (btn) btn.disabled = true;
        if (status) status.textContent = 'Starting import…';
        try {
            const packet = kind === 'novelai' ? 'import_static_wiki' : 'import_fandom_wiki_page';
            const result = await wsClient.sendMessage(packet, {
                url,
                followLinks: follow,
                maxPages: follow ? 25 : 1,
                group: 'Imported',
                recordImport: true
            });
            const count = (result && result.pages && result.pages.length) || 0;
            if (status) status.textContent = `Imported ${count} page${count === 1 ? '' : 's'}.`;
            if (host.showToast) host.showToast('success', `Imported ${count} page${count === 1 ? '' : 's'}`);
            await this._loadLibrary(host, root);
            if (kind === 'fandom' && result && result.wikiId && result.rootPageId) {
                host.navigate(`rdf://wiki.fandom.jp/${result.wikiId}/${result.rootPageId}`);
            } else if (kind === 'novelai' && result && result.rootPageId) {
                host.navigate(`docs.novelai.jp/${result.rootPageId}`);
            } else if (result && result.wikiId && result.rootPageId) {
                host.navigate(`edtx://en.grimoire.jp/docs/${result.wikiId}/${result.rootPageId}`);
            } else if (result && result.wikiId && host.shell && typeof host.shell.showStaticWikiSiteIndex === 'function') {
                host.shell.showStaticWikiSiteIndex(result.wikiId);
            }
        } catch (err) {
            if (status) status.textContent = err.message || 'Import failed';
            if (host.showToast) host.showToast('error', err.message || 'Import failed');
        } finally {
            if (btn) btn.disabled = false;
        }
    },

    async _loadLibrary(host, root) {
        try {
            const data = await wsClient.sendMessage('get_fandom_wiki_manager', {});
            const stats = data.stats || {};
            const setText = (id, value) => {
                const el = root.querySelector(id);
                if (el) el.textContent = String(value || 0);
            };
            setText('#fandomWikiStatWikis', stats.wikis);
            setText('#fandomWikiStatPages', stats.pages);
            setText('#fandomWikiStatImports', stats.imports);
            const sites = data.sites || [];
            const sitesBody = root.querySelector('#fandomWikiSitesBody');
            const sitesEmpty = root.querySelector('#fandomWikiSitesEmpty');
            const sitesTable = root.querySelector('#fandomWikiSitesTable');
            if (sitesEmpty) sitesEmpty.classList.toggle('hidden', sites.length > 0);
            if (sitesTable) sitesTable.classList.toggle('hidden', sites.length === 0);
            if (sitesBody) {
                sitesBody.innerHTML = sites.map((site) => {
                    return `<tr data-site-id="${fandomWikiDsapEscapeAttr(site.id)}" data-site-kind="${fandomWikiDsapEscapeAttr(site.kind || '')}">
                        <td><a href="#" class="fandom-wiki-dsap-site" data-site-id="${fandomWikiDsapEscapeAttr(site.id)}" data-site-kind="${fandomWikiDsapEscapeAttr(site.kind || '')}">${fandomWikiDsapEscapeHtml(site.name)}</a></td>
                        <td>${fandomWikiDsapEscapeHtml(site.kind || 'static')}</td>
                        <td align="right">${site.pageCount || 0}</td>
                        <td align="right">
                            <button type="button" class="dsap-smf-btn fandom-wiki-dsap-update-site" data-site-id="${fandomWikiDsapEscapeAttr(site.id)}">Update</button>
                        </td>
                    </tr>`;
                }).join('');
                sitesBody.querySelectorAll('.fandom-wiki-dsap-site').forEach((a) => {
                    a.addEventListener('click', (e) => {
                        e.preventDefault();
                        fandomWikiDsapOpenSite(host, {
                            id: a.getAttribute('data-site-id'),
                            kind: a.getAttribute('data-site-kind')
                        });
                    });
                });
                sitesBody.querySelectorAll('.fandom-wiki-dsap-update-site').forEach((btn) => {
                    btn.addEventListener('click', () => {
                        this._updateSite(host, root, btn.getAttribute('data-site-id'));
                    });
                });
            }
            const body = root.querySelector('#fandomWikiLibraryBody');
            const empty = root.querySelector('#fandomWikiLibraryEmpty');
            const table = root.querySelector('#fandomWikiLibraryTable');
            const imports = data.imports || [];
            if (empty) empty.classList.toggle('hidden', imports.length > 0);
            if (table) table.classList.toggle('hidden', imports.length === 0);
            if (!body) return;
            body.innerHTML = imports.map((imp) => {
                const created = imp.createdAt ? new Date(imp.createdAt).toLocaleString() : '';
                return `<tr data-import-id="${fandomWikiDsapEscapeAttr(imp.id)}" data-wiki-id="${fandomWikiDsapEscapeAttr(imp.wikiId)}" data-page-id="${fandomWikiDsapEscapeAttr(imp.rootPageId)}">
                    <td>${fandomWikiDsapEscapeHtml(imp.wikiName)}</td>
                    <td><a href="#" class="fandom-wiki-dsap-root" data-wiki-id="${fandomWikiDsapEscapeAttr(imp.wikiId)}" data-page-id="${fandomWikiDsapEscapeAttr(imp.rootPageId)}">${fandomWikiDsapEscapeHtml(imp.title)}</a></td>
                    <td align="right">${imp.pageCount || 0}</td>
                    <td align="right">${imp.exclusiveChildCount || 0}</td>
                    <td>${fandomWikiDsapEscapeHtml(created)}</td>
                    <td align="right">
                        <button type="button" class="dsap-smf-btn fandom-wiki-dsap-update" data-import-id="${fandomWikiDsapEscapeAttr(imp.id)}">Update</button>
                        <button type="button" class="dsap-smf-btn fandom-wiki-dsap-delete" data-import-id="${fandomWikiDsapEscapeAttr(imp.id)}">Delete</button>
                    </td>
                </tr>`;
            }).join('');
            body.querySelectorAll('.fandom-wiki-dsap-root').forEach((a) => {
                a.addEventListener('click', (e) => {
                    e.preventDefault();
                    host.navigate(`rdf://wiki.fandom.jp/${a.getAttribute('data-wiki-id')}/${a.getAttribute('data-page-id')}`);
                });
            });
            body.querySelectorAll('.fandom-wiki-dsap-update').forEach((btn) => {
                btn.addEventListener('click', () => {
                    this._updateImport(host, root, Number(btn.getAttribute('data-import-id')));
                });
            });
            body.querySelectorAll('.fandom-wiki-dsap-delete').forEach((btn) => {
                btn.addEventListener('click', () => {
                    this._confirmDelete(host, root, Number(btn.getAttribute('data-import-id')));
                });
            });
        } catch (err) {
            if (host.showToast) host.showToast('error', err.message || 'Failed to load library');
        }
    },

    async _updateImport(host, root, importId) {
        if (!importId) return;
        const status = root.querySelector('#fandomWikiImportStatus');
        if (status) status.textContent = 'Updating import…';
        try {
            const result = await wsClient.sendMessage('update_wiki_import', { importId });
            const count = (result && result.pages && result.pages.length) || 0;
            if (host.showToast) host.showToast('success', `Updated ${count} page${count === 1 ? '' : 's'}`);
            await this._loadLibrary(host, root);
        } catch (err) {
            if (host.showToast) host.showToast('error', err.message || 'Update failed');
        }
    },

    async _updateSite(host, root, siteId) {
        if (!siteId) return;
        try {
            const result = await wsClient.sendMessage('update_wiki_import', { siteId });
            const count = (result && result.pages && result.pages.length) || 0;
            if (host.showToast) host.showToast('success', `Pulled ${count} page${count === 1 ? '' : 's'}`);
            await this._loadLibrary(host, root);
        } catch (err) {
            if (host.showToast) host.showToast('error', err.message || 'Update failed');
        }
    },

    async _confirmDelete(host, root, importId) {
        if (!importId) return;
        const html = `<p>Delete this Fandom import?</p>
<p>Shared pages and pages that were imported as their own root are kept.</p>
<div class="custom-dropdown dropup">
    <button type="button" id="fandomWikiDeleteBtn" class="custom-dropdown-btn hover-show colored">
        <span id="fandomWikiDeleteSelected">Import and exclusive children</span>
    </button>
    <div id="fandomWikiDeleteMenu" class="custom-dropdown-menu hidden"></div>
</div>
<input type="hidden" id="fandomWikiDeleteHidden" value="children">`;

        setTimeout(() => {
            const dialog = document.getElementById('confirmationDialog');
            if (!dialog) return;
            const container = dialog.querySelector('.custom-dropdown');
            const btn = dialog.querySelector('#fandomWikiDeleteBtn');
            const menu = dialog.querySelector('#fandomWikiDeleteMenu');
            const hidden = dialog.querySelector('#fandomWikiDeleteHidden');
            const selected = dialog.querySelector('#fandomWikiDeleteSelected');
            if (!container || !btn || !menu || !hidden) return;
            // setupDropdown: public/scripts/comp/dropdown.js
            setupDropdown(
                container,
                btn,
                menu,
                (selectedVal) => renderSimpleDropdown(
                    menu,
                    FANDOM_WIKI_DELETE_OPTIONS,
                    'value',
                    'name',
                    (item) => {
                        hidden.value = item.value;
                        selected.textContent = item.name;
                    },
                    closeDropdown,
                    selectedVal
                ),
                () => hidden.value
            );
        }, 0);

        const ok = await showConfirmationDialog(html, [
            { text: 'Delete', value: true, className: 'btn-danger' },
            { text: 'Cancel', value: false, className: 'btn-secondary' }
        ], null, {
            title: 'Delete import',
            resolveValue: (value) => {
                if (!value) return false;
                const hidden = document.getElementById('fandomWikiDeleteHidden');
                return { removeChildren: !hidden || hidden.value === 'children' };
            }
        });
        if (!ok) return;
        try {
            await wsClient.sendMessage('delete_fandom_wiki_import', {
                importId,
                removeChildren: ok.removeChildren !== false
            });
            if (host.showToast) host.showToast('success', 'Import removed');
            await this._loadLibrary(host, root);
        } catch (err) {
            if (host.showToast) host.showToast('error', err.message || 'Delete failed');
        }
    }
};

function registerFandomWikiManagerDsap() {
    if (typeof registerDsap !== 'function') return;
    registerDsap({
        url: FANDOM_WIKI_DSAP_URL,
        theme: 'dsap-smf',
        aliases: [
            `dsap://${FANDOM_WIKI_DSAP_URL}`,
            'en.grimoire.jp/applets/wiki',
            'applet.grimoire.jp/wiki'
        ],
        getContent(match) {
            let segments = [];
            const pathSource = (match && (match.normalized || match.displayPath)) || '';
            if (pathSource) {
                const host = pathSource.split('/')[0];
                const suffix = pathSource.startsWith(host)
                    ? pathSource.slice(host.length).replace(/^\//, '')
                    : '';
                if (suffix) segments = suffix.split('?')[0].split('/');
            }
            const activeTab = segments[0] === 'library' ? 'library' : 'import';
            return {
                html: fandomWikiDsapBuildHtml(activeTab),
                css: fandomWikiDsapCss,
                drivers: fandomWikiDsapDriver,
                baseBackground: '#eeeeee'
            };
        }
    });
}

registerFandomWikiManagerDsap();
