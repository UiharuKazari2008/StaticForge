/**
 * Similar-image keep/scrap DSAP — review consecutive-seed (and refine) groups.
 * Domain: zanzou.dyna.dreamscape.jp (aliases similar / review)
 * Depends on: dsapRegistry.js, dsapSmfMarkup.js, assetUrlResolver.js,
 *             manualModalManager.js, confirmationDialog.js, contextMenu.js
 * Server: WS get_similar_image_groups, scrap_similar_images (wraps delete_images_bulk)
 */

const SIMILAR_DSAP_URL = 'zanzou.dyna.dreamscape.jp';
const SIMILAR_DSAP_ID = 'similar-images';
const SIMILAR_REVIEWED_KEY = 'similarImageReviewedGroups';

const SIMILAR_TAB_LABELS = {
    groups: 'Groups',
    reviewed: 'Reviewed'
};

const similarDsapScopedCss = `
[data-dsap="similar-images"] .similar-view { padding: 8px 10px 16px; }
[data-dsap="similar-images"] .similar-muted {
    color: #333;
    font-size: var(--dsap-smf-font-size-sm);
}
[data-dsap="similar-images"] .similar-empty {
    padding: 16px;
    text-align: center;
    color: #444;
    font-size: var(--dsap-smf-font-size-sm);
    border: 1px dashed var(--dsap-smf-border-light);
    background: #fafafa;
    margin: 6px 0;
}
[data-dsap="similar-images"] .similar-group {
    border: 1px solid var(--dsap-smf-border);
    background: #ffffff;
    margin: 0 0 10px;
    padding: 6px 8px;
}
[data-dsap="similar-images"] .similar-group-head {
    display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: baseline; margin-bottom: 6px;
}
[data-dsap="similar-images"] .similar-group-head strong { font-size: 13px; }
[data-dsap="similar-images"] .similar-thumbs {
    display: flex; flex-wrap: wrap; gap: 8px;
}
[data-dsap="similar-images"] .similar-card {
    width: 140px;
    max-width: 100%;
    background: #ffffff;
    border: 2px solid var(--dsap-smf-border);
    cursor: pointer;
}
[data-dsap="similar-images"] .similar-card.selected {
    border-color: var(--dsap-smf-tab-accent);
    background: var(--dsap-smf-status-error-bg);
}
[data-dsap="similar-images"] .similar-card img {
    width: 100%;
    height: 140px;
    object-fit: cover;
    display: block;
    background: var(--dsap-smf-toolbar-bg);
}
[data-dsap="similar-images"] .similar-card-cap {
    padding: 3px 5px;
    font-size: var(--dsap-smf-font-size-xs);
    line-height: 1.3;
}
[data-dsap="similar-images"] .similar-actions { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 6px; }
[data-dsap="similar-images"] .similar-help {
    margin: 0 0 8px;
    font-size: var(--dsap-smf-font-size-sm);
}
`

function similarDsapEscape(text) {
    return typeof dsapSmfEscapeHtml === 'function' ? dsapSmfEscapeHtml(text) : String(text == null ? '' : text);
}

function similarDsapAttr(text) {
    return typeof dsapSmfEscapeAttr === 'function'
        ? dsapSmfEscapeAttr(text)
        : String(text || '').replace(/"/g, '&quot;');
}

function similarDsapActiveWorkspace() {
    if (typeof activeWorkspace !== 'undefined' && activeWorkspace) return activeWorkspace;
    if (typeof window !== 'undefined' && window.activeWorkspace) return window.activeWorkspace;
    return 'default';
}

function similarDsapResolveTab(host) {
    const segments = host.getPathSegments();
    const first = (segments[0] || '').toLowerCase();
    if (SIMILAR_TAB_LABELS[first]) return first;
    const q = (host.getQueryParam('tab') || '').toLowerCase();
    if (SIMILAR_TAB_LABELS[q]) return q;
    return 'groups';
}

function similarDsapTabUrl(tabId) {
    return `dsap://${SIMILAR_DSAP_URL}/${tabId}`;
}

function similarDsapLoadReviewed() {
    try {
        const raw = localStorage.getItem(SIMILAR_REVIEWED_KEY);
        const list = raw ? JSON.parse(raw) : [];
        return new Set(Array.isArray(list) ? list.filter((id) => typeof id === 'string') : []);
    } catch (_err) {
        return new Set();
    }
}

function similarDsapSaveReviewed(reviewed) {
    try {
        localStorage.setItem(SIMILAR_REVIEWED_KEY, JSON.stringify(Array.from(reviewed)));
    } catch (_err) {
        // ignore quota / private mode
    }
}

function similarDsapGroupKey(group) {
    if (!group) return '';
    return `${group.kind || 'consecutive_seed'}:${group.groupId}`;
}

function similarDsapPreviewSrc(item) {
    if (!item) return '';
    if (item.previewUrl) return item.previewUrl;
    const filename = item.filename;
    if (!filename) return '';
    const base = String(filename).replace(/\.(png|jpg|jpeg)$/i, '').replace(/_upscaled$/i, '');
    if (typeof localGalleryPreviewUrl === 'function') {
        return localGalleryPreviewUrl(`${base}.webp`);
    }
    return `/previews/${encodeURIComponent(`${base}.webp`)}`;
}

function similarDsapImageSrc(item) {
    if (!item || !item.filename) return '';
    if (typeof localGalleryImageUrl === 'function') return localGalleryImageUrl(item.filename);
    if (item.imageUrl) return item.imageUrl;
    return `/images/${encodeURIComponent(item.filename)}`;
}

function similarDsapFindGalleryImage(filename) {
    if (!filename) return null;
    if (typeof allImages !== 'undefined' && Array.isArray(allImages)) {
        const found = allImages.find((img) => (
            img && (img.filename === filename || img.original === filename || img.upscaled === filename)
        ));
        if (found) return found;
    }
    return { filename };
}

function similarDsapOpenInStudio(filename) {
    if (!filename || typeof openManualModalWithContent !== 'function') return false;
    openManualModalWithContent({ type: 'image', image: similarDsapFindGalleryImage(filename) }, null);
    return true;
}

function similarDsapShellHtml(tabId, workspaceLabel) {
    const tabs = [
        { id: 'groups', label: 'Groups', icon: 'fas fa-layer-group' },
        { id: 'reviewed', label: 'Reviewed', icon: 'fas fa-check' }
    ];
    return `${dsapSmfBuildRootOpen(SIMILAR_DSAP_ID)}
${dsapSmfBuildHeader({
    branchTitle: typeof DSAP_SMF_BRANCH_SIMILAR === 'string' ? DSAP_SMF_BRANCH_SIMILAR : 'Zanzou',
    toolTitle: SIMILAR_TAB_LABELS[tabId] || 'Groups'
})}
${dsapSmfBuildTabBar(tabs, tabId, { tabBarId: 'similarDsapTabBar', dataAttr: 'data-similar-tab' })}
${dsapSmfBuildContextBar(`<button type="button" class="dsap-smf-btn dsap-smf-btn-small" id="similarWorkspaceBtn">
  <span id="similarWorkspaceLabel">${similarDsapEscape(workspaceLabel || 'Active workspace')}</span>
  <i class="fas fa-caret-down"></i>
</button>
<label class="similar-muted"><input type="checkbox" id="similarIncludeRefine" checked> Include refine groups</label>`)}
${dsapSmfBuildToolbar(`<button type="button" class="dsap-smf-btn dsap-smf-btn-small" data-similar-action="refresh"><i class="fas fa-rotate-right"></i> Refresh</button>
<span class="similar-muted" data-similar-stamp></span>`)}
<div class="similar-view" data-similar-view></div>
${dsapSmfBuildRootClose()}`;
}

function similarDsapCardHtml(group, item, selected) {
    const preview = similarDsapPreviewSrc(item);
    const full = similarDsapImageSrc(item);
    const seed = item.seed != null ? item.seed : '—';
    const selectedCls = selected ? ' selected' : '';
    return `<div class="similar-card${selectedCls}" data-similar-file="${similarDsapAttr(item.filename)}" data-similar-group="${similarDsapAttr(similarDsapGroupKey(group))}">
  <img src="${similarDsapAttr(preview)}" alt="${similarDsapAttr(item.filename)}" data-similar-full="${similarDsapAttr(full)}">
  <div class="similar-card-cap">
    <div>${similarDsapEscape(item.filename)}</div>
    <div class="similar-muted">seed ${similarDsapEscape(seed)}</div>
  </div>
</div>`;
}

function similarDsapGroupHtml(group, selectedFiles) {
    const key = similarDsapGroupKey(group);
    const kindLabel = group.kind === 'refine' ? 'refine' : 'consecutive seed';
    const items = Array.isArray(group.items) ? group.items : [];
    const selected = selectedFiles || new Set();
    const thumbs = items.map((item) => similarDsapCardHtml(group, item, selected.has(item.filename))).join('');
    const extra = group.truncated ? ` <span class="similar-muted">(showing ${items.length} of ${group.count})</span>` : '';
    return `<div class="similar-group" data-similar-group-block="${similarDsapAttr(key)}">
  <div class="similar-group-head">
    <strong>${similarDsapEscape(kindLabel)} · ${similarDsapEscape(group.count)} images</strong>
    <span class="similar-muted">seed ${similarDsapEscape(group.seed != null ? group.seed : '—')} · ${similarDsapEscape(group.groupId)}</span>
    ${extra}
  </div>
  <div class="similar-thumbs">${thumbs || '<p class="similar-empty">No previews.</p>'}</div>
  <div class="similar-actions">
    <button type="button" class="dsap-smf-btn dsap-smf-btn-small" data-similar-keep="${similarDsapAttr(key)}">Keep group</button>
    <button type="button" class="dsap-smf-btn dsap-smf-btn-small dsap-smf-btn-danger" data-similar-scrap="${similarDsapAttr(key)}">Scrap selected</button>
    <button type="button" class="dsap-smf-btn dsap-smf-btn-small dsap-smf-btn-danger" data-similar-scrap-rest="${similarDsapAttr(key)}">Scrap all but one</button>
    <button type="button" class="dsap-smf-btn dsap-smf-btn-small" data-similar-studio-group="${similarDsapAttr(key)}">Open first in Studio</button>
  </div>
</div>`;
}

const similarDsapDriver = {
    _state: null,

    init(host) {
        this.destroy(host);
        const root = host.getRoot();
        const tabId = similarDsapResolveTab(host);
        const workspaceId = host.getQueryParam('workspace') || similarDsapActiveWorkspace();
        this._state = {
            host,
            tabId,
            workspaceId,
            workspaceName: workspaceId,
            workspaces: [],
            includeRefine: true,
            data: null,
            selected: {},
            reviewed: similarDsapLoadReviewed(),
            _onClick: null,
            _onError: null,
            _workspaceBtn: null,
            _workspaceMenuConfig: null
        };
        root.innerHTML = similarDsapShellHtml(tabId, workspaceId);
        const dsapRoot = root.querySelector(`[data-dsap="${SIMILAR_DSAP_ID}"]`) || root;
        dsapSmfWireTabBar(dsapRoot, '#similarDsapTabBar', 'data-similar-tab', similarDsapTabUrl, host);
        this._state._onClick = (e) => this._onClick(e);
        this._state._onError = (e) => this._onThumbError(e);
        dsapRoot.addEventListener('click', this._state._onClick);
        dsapRoot.addEventListener('error', this._state._onError, true);
        this._wireWorkspaceMenu(dsapRoot);
        this._wireContextMenus(host);
        this._loadWorkspaces();
        this._load();
    },

    refresh(host) {
        this.init(host);
    },

    destroy(host) {
        const state = this._state;
        if (state) {
            const root = host && host.getRoot ? host.getRoot() : null;
            const dsapRoot = root && root.querySelector
                ? root.querySelector(`[data-dsap="${SIMILAR_DSAP_ID}"]`)
                : null;
            if (dsapRoot && state._onClick) {
                dsapRoot.removeEventListener('click', state._onClick);
            }
            if (dsapRoot && state._onError) {
                dsapRoot.removeEventListener('error', state._onError, true);
            }
            if (state._workspaceBtn && typeof contextMenu !== 'undefined'
                && typeof contextMenu.detachClickMenuFromElement === 'function') {
                contextMenu.detachClickMenuFromElement(state._workspaceBtn);
            }
        }
        this._state = null;
    },

    _wireWorkspaceMenu(dsapRoot) {
        const btn = dsapRoot.querySelector('#similarWorkspaceBtn');
        if (!btn || typeof contextMenu === 'undefined' || typeof contextMenu.attachClickMenuToElement !== 'function') {
            return;
        }
        const driver = this;
        this._state._workspaceMenuConfig = {
            position: 'anchor',
            anchorAlign: 'start',
            maxHeight: 360,
            beforeShow: () => driver._refreshWorkspaceMenuItems(),
            sections: [{ type: 'list', items: [] }],
            onAction: (action, _target, item) => {
                if (action !== 'select-workspace' || item.workspaceValue == null) return;
                driver._state.workspaceId = item.workspaceValue;
                driver._updateWorkspaceLabel();
                driver._load();
            }
        };
        contextMenu.attachClickMenuToElement(btn, this._state._workspaceMenuConfig);
        this._state._workspaceBtn = btn;
    },

    _refreshWorkspaceMenuItems() {
        const config = this._state && this._state._workspaceMenuConfig;
        if (!config) return;
        const current = this._state.workspaceId;
        const items = (this._state.workspaces || []).map((ws) => ({
            text: ws.name || ws.id,
            action: 'select-workspace',
            workspaceValue: ws.id,
            icon: ws.id === current ? 'fas fa-check' : 'fas fa-folder'
        }));
        config.sections = [{ type: 'list', items: items.length ? items : [{ text: 'No workspaces', disabled: true }] }];
    },

    _updateWorkspaceLabel() {
        const state = this._state;
        if (!state) return;
        const root = state.host.getRoot();
        const label = root.querySelector('#similarWorkspaceLabel');
        const found = (state.workspaces || []).find((ws) => ws.id === state.workspaceId);
        state.workspaceName = found ? (found.name || found.id) : state.workspaceId;
        if (label) label.textContent = state.workspaceName;
    },

    _wireContextMenus(host) {
        if (!host || typeof host.registerContextMenuItems !== 'function') return;
        host.registerContextMenuItems('[data-similar-file]', (el) => {
            const filename = el.getAttribute('data-similar-file');
            if (!filename) return [];
            return [
                { text: 'Open in Studio', icon: 'fas fa-compass-drafting', action: 'similar-open-studio', data: { filename } },
                { text: 'Toggle scrap', icon: 'fas fa-check-square', action: 'similar-toggle', data: { filename } },
                { text: 'Copy filename', icon: 'fas fa-copy', action: 'similar-copy-name', data: { filename } }
            ];
        });
        host.registerContextMenuAction('similar-open-studio', (el, item) => {
            const filename = (item && item.data && item.data.filename) || el.getAttribute('data-similar-file');
            this._openStudio(filename);
        });
        host.registerContextMenuAction('similar-toggle', (el) => {
            const filename = el.getAttribute('data-similar-file');
            const key = el.getAttribute('data-similar-group');
            this._toggleSelected(key, filename);
        });
        host.registerContextMenuAction('similar-copy-name', (el, item) => {
            const filename = (item && item.data && item.data.filename) || el.getAttribute('data-similar-file');
            if (!filename || typeof copyTextToClipboard !== 'function') return;
            copyTextToClipboard(filename).then(() => {
                if (typeof showGlassToast === 'function') {
                    showGlassToast('success', null, 'Copied filename', false, 2500, '<i class="fas fa-check"></i>');
                }
            }).catch(() => {});
        });
    },

    _onThumbError(e) {
        const img = e.target;
        if (!img || img.tagName !== 'IMG' || img.dataset.similarFb === '1') return;
        const full = img.getAttribute('data-similar-full');
        if (!full) return;
        img.dataset.similarFb = '1';
        img.src = full;
    },

    _onClick(e) {
        const include = e.target.closest('#similarIncludeRefine');
        if (include) {
            this._state.includeRefine = !!include.checked;
            this._load();
            return;
        }
        const refresh = e.target.closest('[data-similar-action="refresh"]');
        if (refresh) {
            e.preventDefault();
            this._load();
            return;
        }
        const keepBtn = e.target.closest('[data-similar-keep]');
        if (keepBtn) {
            e.preventDefault();
            this._keepGroup(keepBtn.getAttribute('data-similar-keep'));
            return;
        }
        const scrapBtn = e.target.closest('[data-similar-scrap]');
        if (scrapBtn) {
            e.preventDefault();
            this._scrapSelected(scrapBtn.getAttribute('data-similar-scrap'), e);
            return;
        }
        const scrapRest = e.target.closest('[data-similar-scrap-rest]');
        if (scrapRest) {
            e.preventDefault();
            this._scrapAllButOne(scrapRest.getAttribute('data-similar-scrap-rest'), e);
            return;
        }
        const studioGroup = e.target.closest('[data-similar-studio-group]');
        if (studioGroup) {
            e.preventDefault();
            this._openFirstStudio(studioGroup.getAttribute('data-similar-studio-group'));
            return;
        }
        const unreview = e.target.closest('[data-similar-unreview]');
        if (unreview) {
            e.preventDefault();
            this._unreviewGroup(unreview.getAttribute('data-similar-unreview'));
            return;
        }
        const card = e.target.closest('[data-similar-file]');
        if (card) {
            e.preventDefault();
            this._toggleSelected(card.getAttribute('data-similar-group'), card.getAttribute('data-similar-file'));
        }
    },

    _openStudio(filename) {
        if (!filename) return;
        const ok = similarDsapOpenInStudio(filename);
        if (!ok && this._state && this._state.host && this._state.host.showToast) {
            this._state.host.showToast('Could not open Studio', 'error');
        }
    },

    _openFirstStudio(groupKey) {
        const group = this._findGroup(groupKey);
        const first = group && group.items && group.items[0];
        if (first) this._openStudio(first.filename);
    },

    _findGroup(groupKey) {
        const groups = this._state && this._state.data && Array.isArray(this._state.data.groups)
            ? this._state.data.groups
            : [];
        return groups.find((group) => similarDsapGroupKey(group) === groupKey) || null;
    },

    _defaultSelected(group) {
        const selected = new Set();
        const items = Array.isArray(group.items) ? group.items : [];
        items.forEach((item, index) => {
            if (index > 0 && item.filename) selected.add(item.filename);
        });
        return selected;
    },

    _selectedFor(groupKey) {
        const group = this._findGroup(groupKey);
        if (!group) return new Set();
        if (!this._state.selected[groupKey]) {
            this._state.selected[groupKey] = this._defaultSelected(group);
        }
        return this._state.selected[groupKey];
    },

    _toggleSelected(groupKey, filename) {
        if (!groupKey || !filename) return;
        const selected = this._selectedFor(groupKey);
        if (selected.has(filename)) selected.delete(filename);
        else selected.add(filename);
        this._renderView();
    },

    _keepGroup(groupKey) {
        if (!groupKey || !this._state) return;
        this._state.reviewed.add(groupKey);
        similarDsapSaveReviewed(this._state.reviewed);
        if (typeof showGlassToast === 'function') {
            showGlassToast('success', null, 'Group kept — left on disk', false, 2500, '<i class="fas fa-check"></i>');
        }
        this._renderView();
    },

    _unreviewGroup(groupKey) {
        if (!groupKey || !this._state) return;
        this._state.reviewed.delete(groupKey);
        similarDsapSaveReviewed(this._state.reviewed);
        this._renderView();
    },

    async _scrapSelected(groupKey, event) {
        const selected = Array.from(this._selectedFor(groupKey));
        if (!selected.length) {
            if (this._state.host && this._state.host.showToast) {
                this._state.host.showToast('Select at least one image to scrap', 'error');
            }
            return;
        }
        await this._scrapFilenames(groupKey, selected, event, `Scrap ${selected.length} image${selected.length === 1 ? '' : 's'}? This permanently deletes original + upscaled.`);
    },

    async _scrapAllButOne(groupKey, event) {
        const group = this._findGroup(groupKey);
        if (!group || !group.items || group.items.length < 2) return;
        const selected = this._selectedFor(groupKey);
        let keep = group.items.find((item) => item.filename && !selected.has(item.filename));
        if (!keep) keep = group.items[0];
        const scrap = group.items
            .map((item) => item.filename)
            .filter((name) => name && name !== keep.filename);
        await this._scrapFilenames(
            groupKey,
            scrap,
            event,
            `Keep ${keep.filename} and scrap the other ${scrap.length}? This permanently deletes original + upscaled.`
        );
    },

    async _scrapFilenames(groupKey, filenames, event, confirmText) {
        const group = this._findGroup(groupKey);
        if (!group || !filenames.length) return;
        if (typeof showConfirmationDialog === 'function') {
            const confirmed = await showConfirmationDialog(
                confirmText,
                [
                    { text: 'Scrap', value: true, className: 'btn-danger' },
                    { text: 'Cancel', value: false, className: 'btn-secondary' }
                ],
                event,
                { title: 'Scrap similar images' }
            );
            if (!confirmed) return;
        }
        try {
            if (!window.wsClient || typeof window.wsClient.sendMessage !== 'function') {
                throw new Error('WebSocket client is not available');
            }
            const result = await window.wsClient.sendMessage('scrap_similar_images', {
                workspaceId: this._state.workspaceId,
                groupId: group.groupId,
                groupKind: group.kind,
                filenames
            }, false);
            const successful = result && (result.successful != null ? result.successful : result.success ? filenames.length : 0);
            if (!successful) {
                throw new Error((result && result.message) || 'Scrap failed');
            }
            if (typeof showGlassToast === 'function') {
                showGlassToast('success', null, `Scrapped ${successful} image${successful === 1 ? '' : 's'}`, false, 4000, '<i class="fas fa-trash"></i>');
            }
            await this._load();
        } catch (err) {
            if (this._state.host && this._state.host.showToast) {
                this._state.host.showToast(err && err.message ? err.message : 'Scrap failed', 'error');
            }
        }
    },

    async _loadWorkspaces() {
        const state = this._state;
        if (!state) return;
        try {
            if (!window.wsClient || typeof window.wsClient.sendMessage !== 'function') return;
            const result = await window.wsClient.sendMessage('workspace_list', {}, false);
            const list = result && Array.isArray(result.workspaces) ? result.workspaces : [];
            state.workspaces = list;
            if (!state.workspaceId && result && result.activeWorkspace) {
                state.workspaceId = result.activeWorkspace;
            }
            this._updateWorkspaceLabel();
        } catch (_err) {
            state.workspaces = [];
        }
    },

    async _load() {
        const state = this._state;
        if (!state) return;
        const root = state.host.getRoot();
        const view = root.querySelector('[data-similar-view]');
        if (view) view.innerHTML = dsapSmfBuildStatusBox('Loading similar groups…');
        try {
            if (!window.wsClient || typeof window.wsClient.sendMessage !== 'function') {
                throw new Error('WebSocket client is not available');
            }
            if (typeof window.wsClient.isConnected === 'function' && !window.wsClient.isConnected()) {
                throw new Error('WebSocket not connected');
            }
            const result = await window.wsClient.sendMessage('get_similar_image_groups', {
                workspaceId: state.workspaceId,
                includeRefine: state.includeRefine
            }, false);
            if (!result) throw new Error('Empty similar-group response');
            state.data = result;
            state.selected = {};
        } catch (err) {
            state.data = { success: false, error: err && err.message ? err.message : 'load failed' };
        }
        this._renderView();
    },

    _visibleGroups() {
        const state = this._state;
        const groups = state && state.data && Array.isArray(state.data.groups) ? state.data.groups : [];
        if (state.tabId === 'reviewed') {
            return groups.filter((group) => state.reviewed.has(similarDsapGroupKey(group)));
        }
        return groups.filter((group) => !state.reviewed.has(similarDsapGroupKey(group)));
    },

    _renderView() {
        const state = this._state;
        if (!state) return;
        const root = state.host.getRoot();
        const view = root.querySelector('[data-similar-view]');
        const stamp = root.querySelector('[data-similar-stamp]');
        if (!view) return;
        const data = state.data;
        if (!data) {
            view.innerHTML = dsapSmfBuildStatusBox('Loading similar groups…');
            return;
        }
        if (data.success === false) {
            view.innerHTML = dsapSmfBuildStatusBox(similarDsapEscape(data.error || 'Failed to load groups'));
            return;
        }
        const groups = this._visibleGroups();
        const index = data.indexImages || {};
        const stats = dsapSmfBuildStatsTable([
            { label: 'Groups here', valueHtml: similarDsapEscape(String(groups.length)) },
            { label: 'Seed-tagged', valueHtml: similarDsapEscape(String(index.consecutiveSeed == null ? '—' : index.consecutiveSeed)) },
            { label: 'Refine-tagged', valueHtml: similarDsapEscape(String(index.refine == null ? '—' : index.refine)) }
        ]);
        if (stamp) {
            stamp.textContent = data.workspaceId ? `Workspace ${state.workspaceName || data.workspaceId}` : '';
        }
        let body;
        if (!groups.length) {
            const emptyIndex = !index.consecutiveSeed && !index.refine;
            if (state.tabId === 'reviewed') {
                body = '<p class="similar-empty">No kept groups in this load. Keep a group on the Groups tab to park it here (images stay on disk).</p>';
            } else if (emptyIndex) {
                body = '<p class="similar-empty">No consecutive-seed or refine groups are indexed on this host yet. The applet and packets still work — nothing to review until seed-chain backfill tags pairs. No perceptual-hash job was started.</p>';
            } else {
                body = `<p class="similar-empty">Index has ${similarDsapEscape(String(index.consecutiveSeed))} seed-tagged images, but this workspace has no groups of 2+ (or they are all parked under Reviewed).</p>`;
            }
        } else {
            body = groups.map((group) => {
                const key = similarDsapGroupKey(group);
                if (state.tabId === 'reviewed') {
                    return `${similarDsapGroupHtml(group, this._selectedFor(key))}
<div class="similar-actions" style="margin-top:-4px;margin-bottom:10px">
  <button type="button" class="dsap-smf-btn dsap-smf-btn-small" data-similar-unreview="${similarDsapAttr(key)}">Show in Groups again</button>
</div>`;
                }
                return similarDsapGroupHtml(group, this._selectedFor(key));
            }).join('');
        }
        const help = state.tabId === 'reviewed'
            ? '<p class="similar-help">Reviewed means you kept the group in this browser. Images were not deleted. Scrap still works from this tab.</p>'
            : '<p class="similar-help">Newest image in each group starts unchecked (the keep). Checked thumbs are the scrap set. Keep parks the group without deleting. Scrap uses the existing bulk delete.</p>';
        view.innerHTML = `${dsapSmfBuildSectionHdr(state.tabId === 'reviewed' ? 'Kept groups' : 'Similar groups')}
${stats}
${help}
${body}`;
    }
};

function registerSimilarImageDsapApplet() {
    if (typeof registerDsap !== 'function') return;
    registerDsap({
        url: SIMILAR_DSAP_URL,
        getContent() {
            return {
                html: '<div class="similar-dsap-root"></div>',
                css: similarDsapScopedCss,
                drivers: similarDsapDriver,
                theme: 'dsap-smf'
            };
        }
    });
}

function openSimilarImageDsap() {
    const target = `dsap://${SIMILAR_DSAP_URL}/groups`;
    if (typeof openDsapInGrimoire === 'function') {
        openDsapInGrimoire(target);
        return;
    }
    if (typeof openDsapInStandaloneWindow === 'function') {
        openDsapInStandaloneWindow(target);
    }
}

registerSimilarImageDsapApplet();
if (typeof window !== 'undefined') {
    window.openSimilarImageDsap = openSimilarImageDsap;
}
