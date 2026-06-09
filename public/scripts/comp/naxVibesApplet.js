/**
 * NAX.moe community vibes browser — Atelier layout + Lumen preview + direct import.
 * public/scripts/comp/modalUtils.js, public/scripts/comp/referenceManager.js, public/scripts/comp/dropdown.js, public/scripts/comp/confirmationDialog.js
 */

/** Title bar vs short label (menus, buttons, toasts) */
const NAX_VIBES_APPLET_TITLE = 'Browse Vibes (via nax.moe)';
const NAX_VIBES_APPLET_LABEL = 'Browse Vibes';

const NAX_VIBES_PRESETS = [
    { id: 'top', btnId: 'naxVibesPresetTopBtn', label: 'Top Votes' },
    { id: 'hot', btnId: 'naxVibesPresetHotBtn', label: 'Hot' },
    { id: 'gems', btnId: 'naxVibesPresetGemsBtn', label: 'Hidden Gems' },
    { id: 'debated', btnId: 'naxVibesPresetDebatedBtn', label: 'Debated' }
];

/** NAX gallery filter keys mapped to manual modal model values */
const NAX_VIBES_MODEL_FILTERS = [
    { key: 'filter45Curated', forgeKey: 'v4_5_cur' },
    { key: 'filter45Full', forgeKey: 'v4_5' },
    { key: 'filter4Curated', forgeKey: 'v4_cur' },
    { key: 'filter4Full', forgeKey: 'v4' }
];

function naxVibeGetModelOption(forgeKey) {
    if (!forgeKey || typeof modelGroups === 'undefined') return null;
    for (const g of modelGroups) {
        const opt = g.options.find((o) => o.value === forgeKey);
        if (opt) return opt;
    }
    return null;
}

function naxVibeModelOptionHtml(opt) {
    if (!opt) return '';
    const badge = opt.badge_full
        ? `<span class="custom-dropdown-badge ${opt.badge_class}">${opt.badge_full}</span>`
        : (opt.badge ? `<span class="custom-dropdown-badge ${opt.badge_class}">${opt.badge}</span>` : '');
    return `<span>${naxVibesEscapeHtml(opt.name)}</span>${badge}`;
}

function naxVibesEscapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/"/g, '&quot;');
}

function naxVibesFormatCacheAge(cachedAt) {
    if (!cachedAt) return '';
    const mins = Math.round((Date.now() - cachedAt) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `${h}h ${m}m ago` : `${h}h ago`;
}

/** Map nax.moe encoding model slug to StaticForge model key */
function naxVibeNaxModelToForgeKey(naxModel) {
    const m = String(naxModel || '').toLowerCase().replace(/[-_\s]/g, '');
    if (m === 'v45full' || m === 'v45f') return 'v4_5';
    if (m === 'v45curated' || m === 'v45c') return 'v4_5_cur';
    if (m === 'v4full' || m === 'v4f') return 'v4';
    if (m === 'v4curated' || m === 'v4c') return 'v4_cur';
    return null;
}

function naxVibeEncodingDisplayModel(enc) {
    const forgeKey = enc.forgeKey || naxVibeNaxModelToForgeKey(enc.model);
    const opt = naxVibeGetModelOption(forgeKey);
    if (opt) return opt.display;
    if (forgeKey && typeof modelBadges !== 'undefined' && modelBadges[forgeKey]) {
        return modelBadges[forgeKey].display;
    }
    return enc.modelShort || enc.model || '';
}

function naxVibesResolvePreviewUrl(url) {
    if (!url) return '';
    const s = String(url).trim();
    if (!s) return '';
    if (s.startsWith('http://') || s.startsWith('https://')) return s;
    if (s.startsWith('//')) return `https:${s}`;
    if (s.startsWith('/')) return `https://nax.moe${s}`;
    return s;
}

function naxVibesResolveImportWorkspace() {
    if (typeof cacheManagerCurrentWorkspace !== 'undefined' && cacheManagerCurrentWorkspace) {
        return cacheManagerCurrentWorkspace;
    }
    if (typeof activeWorkspace !== 'undefined' && activeWorkspace) {
        return activeWorkspace;
    }
    return 'default';
}

function naxVibeBuildEncodingBadgeHtml(enc) {
    const forgeKey = enc.forgeKey || naxVibeNaxModelToForgeKey(enc.model);
    let badgeClass = 'cache-badge encoding';
    const b = forgeKey && typeof modelBadges !== 'undefined' ? modelBadges[forgeKey] : null;
    if (b && b.badge) badgeClass += ' encoding-' + b.badge.toLowerCase();
    const modelName = b ? b.display : (enc.modelShort || enc.model || '');
    const ieRaw = parseFloat(enc.infoExtracted);
    const iePct = Number.isFinite(ieRaw) && ieRaw <= 1 ? (ieRaw * 100).toFixed(0) : String(enc.infoExtracted || '');
    return `<div class="${badgeClass}" title="${naxVibesEscapeHtml(modelName)} IE ${iePct}%">
        <div class="badge-model"><i class="nai-vibe-transfer"></i> <span>${naxVibesEscapeHtml(modelName)}</span></div>
        <span class="badge-ie">${iePct}%</span>
    </div>`;
}

class NaxVibesApplet {
    constructor() {
        this.modal = null;
        this.grid = null;
        this.statusBar = null;
        this.searchInput = null;
        this.emptyState = null;
        this.loading = false;
        this.requestGen = 0;
        this.vibes = [];
        this.preset = 'top';
        this.page = 1;
        this.search = '';
        this.filters = {
            filter45Curated: true,
            filter45Full: true,
            filter4Curated: false,
            filter4Full: false
        };
        this.lastMeta = null;
        this.encodingPickerModal = null;
        this.encodingPickerGrid = null;
        this.encodingPickerVibe = null;
        this.importProgressModal = null;
        this.importProgressStatusEl = null;
        this.importInProgress = false;
        this.init();
    }

    showImportProgress(vibeName) {
        if (typeof showConfirmationDialog !== 'function') return;
        const label = vibeName ? naxVibesEscapeHtml(vibeName) : 'Vibe';
        const progressHtml = `
            <div style="text-align:left;display:flex;flex-direction:column;gap:8px;">
                <div role="progressbar" class="marquee animate" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-label="Importing vibe">
                    <div id="naxVibesImportProgressBar"></div>
                </div>
                <div id="naxVibesImportProgressStatus" style="display:flex;justify-content:space-between;align-items:center;">
                    <span style="color:var(--text-accent);">${label}</span>
                    <span style="color:var(--text-accent-tinted);">Downloading…</span>
                </div>
            </div>`;
        this.importProgressModal = showConfirmationDialog(
            progressHtml,
            [],
            null,
            {
                title: 'Import Vibe',
                icon: 'nai-import',
                showCloseButton: false,
                width: 400,
                manualPosition: true
            }
        );
        setTimeout(() => {
            this.importProgressStatusEl = document.getElementById('naxVibesImportProgressStatus');
        }, 50);
    }

    updateImportProgress(statusText) {
        if (!this.importProgressStatusEl) return;
        const tint = this.importProgressStatusEl.querySelector('span:last-child');
        if (tint) tint.textContent = statusText;
    }

    hideImportProgress() {
        this.importProgressModal = null;
        this.importProgressStatusEl = null;
        if (typeof hideConfirmationDialog === 'function') {
            hideConfirmationDialog();
        }
    }

    async refreshAfterVibeImport() {
        if (typeof refreshReferenceManagerAfterVibeOperation === 'function') {
            await refreshReferenceManagerAfterVibeOperation();
        }
        const managerOpen = typeof cacheManagerModal !== 'undefined'
            && cacheManagerModal
            && cacheManagerModal.classList.contains('modal-open');
        if (managerOpen && typeof loadCacheManagerImages === 'function') {
            await loadCacheManagerImages();
        } else if (typeof loadCacheImages === 'function') {
            await loadCacheImages();
        }
        if (typeof refreshReferenceBrowserIfOpen === 'function') {
            await refreshReferenceBrowserIfOpen();
        }
    }

    buildNaxBrowserMeta(vibe, encoding) {
        const lines = ['Imported from NAX.moe community gallery.'];
        if (vibe && vibe.id) lines.push(`NAX vibe ID: ${vibe.id}`);
        if (vibe && vibe.nsfw) lines.push('Content: NSFW');
        if (vibe && (vibe.upvotes != null || vibe.downvotes != null)) {
            lines.push(`Votes: ↑${vibe.upvotes || 0} ↓${vibe.downvotes || 0}`);
        }
        if (encoding) {
            const modelLabel = naxVibeEncodingDisplayModel(encoding);
            const ie = encoding.infoExtracted != null ? encoding.infoExtracted : '';
            lines.push(`Imported encoding: ${modelLabel} · IE ${ie}`);
        }
        return {
            displayName: (vibe && vibe.name) ? String(vibe.name).trim() : `Vibe ${vibe && vibe.id ? vibe.id : ''}`,
            description: lines.join('\n'),
            forceLocked: true
        };
    }

    async runDirectImport(vibe, downloadUrl, previewUrl, encoding) {
        if (this.importInProgress) return;
        if (typeof wsClient === 'undefined' || !wsClient || !wsClient.isConnected()) {
            if (typeof showGlassToast === 'function') {
                showGlassToast('error', null, 'WebSocket not connected', false, 4000, '<i class="fas fa-plug"></i>');
            }
            return;
        }

        this.importInProgress = true;
        this.showImportProgress(vibe.name);
        this.updateImportProgress('Downloading…');

        try {
            const workspaceId = naxVibesResolveImportWorkspace();
            this.updateImportProgress('Importing…');
            const naxBrowserMeta = this.buildNaxBrowserMeta(vibe, encoding || null);
            const response = await wsClient.importVibeFromUrl(downloadUrl, previewUrl || '', workspaceId, '', naxBrowserMeta);
            if (!response || !response.success) {
                throw new Error((response && response.message) || 'Import failed');
            }
            const count = (response.importedVibes && response.importedVibes.length) || 1;
            this.hideImportProgress();
            if (typeof showGlassToast === 'function') {
                showGlassToast(
                    'success',
                    'Vibe Imported',
                    `Imported ${count} vibe(s) to workspace`,
                    false,
                    4000,
                    '<i class="nai-check"></i>'
                );
            }
            await this.refreshAfterVibeImport();
        } catch (e) {
            console.error('NAX vibe import', e);
            this.hideImportProgress();
            if (typeof showGlassToast === 'function') {
                showGlassToast('error', null, e.message || 'Import failed', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
            }
        } finally {
            this.importInProgress = false;
        }
    }

    init() {
        this.modal = document.getElementById('naxVibesModal');
        if (!this.modal) return;

        this.grid = document.getElementById('naxVibesGrid');
        this.statusBar = document.getElementById('naxVibesStatusBar');
        this.searchInput = document.getElementById('naxVibesSearchInput');
        this.emptyState = document.getElementById('naxVibesEmptyState');
        this.closeBtn = document.getElementById('closeNaxVibesModalBtn');
        this.refreshBtn = document.getElementById('naxVibesRefreshBtn');
        this.prevPageBtn = document.getElementById('naxVibesPrevPageBtn');
        this.nextPageBtn = document.getElementById('naxVibesNextPageBtn');
        this.homeBtn = document.getElementById('naxVibesHomeBtn');
        this.modelDropdown = document.getElementById('naxVibesModelDropdown');
        this.modelBtn = document.getElementById('naxVibesModelDropdownBtn');
        this.modelMenu = document.getElementById('naxVibesModelDropdownMenu');
        this.encodingPickerModal = document.getElementById('naxVibesEncodingPickerModal');
        this.encodingPickerGrid = document.getElementById('naxVibesEncodingPickerGrid');
        this.encodingPickerTitle = document.getElementById('naxVibesEncodingPickerTitle');
        this.closeEncodingPickerBtn = document.getElementById('closeNaxVibesEncodingPickerBtn');
        this.titleLabel = document.getElementById('naxVibesModalTitleLabel');
        this.applyTitleLabel();

        if (this.closeBtn) {
            this.closeBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.close();
            });
        }
        if (this.refreshBtn) {
            this.refreshBtn.addEventListener('click', () => void this.reload(true));
        }
        if (this.homeBtn) {
            this.homeBtn.addEventListener('click', () => this.goHome());
        }
        if (this.prevPageBtn) {
            this.prevPageBtn.addEventListener('click', () => {
                if (!this.isBrowseMode() || this.page <= 1) return;
                this.page -= 1;
                void this.reload(false);
            });
        }
        if (this.nextPageBtn) {
            this.nextPageBtn.addEventListener('click', () => {
                if (!this.isBrowseMode() || !this.lastMeta?.hasMore) return;
                this.page += 1;
                void this.reload(false);
            });
        }

        NAX_VIBES_PRESETS.forEach((p) => {
            const btn = document.getElementById(p.btnId);
            if (!btn) return;
            btn.addEventListener('click', () => this.setPreset(p.id));
        });

        if (this.searchInput) {
            this.searchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.search = this.searchInput.value.trim();
                    this.enterBrowseMode(1);
                    void this.reload(false);
                }
            });
        }

        this.setupModelClickMenu();

        if (this.closeEncodingPickerBtn) {
            this.closeEncodingPickerBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.closeEncodingPicker();
            });
        }
    }

    applyTitleLabel() {
        if (this.titleLabel) {
            this.titleLabel.textContent = NAX_VIBES_APPLET_TITLE;
        }
    }

    setupModelClickMenu() {
        // contextMenu.attachClickMenuToElement: public/scripts/comp/contextMenu.js
        if (!this.modelBtn || !contextMenu) return;

        this.modelClickMenuConfig = {
            position: 'anchor',
            anchorAlign: 'end',
            maxHeight: 420,
            beforeShow: () => this.refreshModelClickMenuItems(),
            sections: [{ type: 'list', items: [] }],
            onAction: (action, target, item) => {
                if (action !== 'toggle-model-filter' || !item.filterKey) return;
                this.filters[item.filterKey] = !this.filters[item.filterKey];
                this.updateModelFilterButton();
                void this.reload(false);
                if (contextMenu.isOpen && contextMenu.currentTarget === this.modelBtn) {
                    this.refreshModelClickMenuItems();
                    contextMenu.renderMenu(this.modelClickMenuConfig, this.modelBtn);
                    contextMenu.executeLoadFunctions(this.modelClickMenuConfig, this.modelBtn);
                }
            }
        };
        contextMenu.attachClickMenuToElement(this.modelBtn, this.modelClickMenuConfig);
        this.updateModelFilterButton();
    }

    updateModelFilterButton() {
        if (!this.modelBtn) return;
        const defaults = {
            filter45Curated: true,
            filter45Full: true,
            filter4Curated: false,
            filter4Full: false
        };
        const customized = NAX_VIBES_MODEL_FILTERS.some(
            (f) => !!this.filters[f.key] !== !!defaults[f.key]
        );
        this.modelBtn.setAttribute('data-state', customized ? 'open' : 'off');
    }

    refreshModelClickMenuItems() {
        if (!this.modelClickMenuConfig) return;
        const items = [];
        const currentGroup = typeof modelGroups !== 'undefined'
            ? modelGroups.find((g) => g.group === 'Current Model')
            : null;

        const appendFilter = (filterDef, opt) => {
            const label = opt && opt.name ? opt.name : filterDef.key;
            items.push({
                text: label,
                action: 'toggle-model-filter',
                filterKey: filterDef.key,
                keepMenuOpen: true,
                loadfn: (item) => {
                    item.checked = !!this.filters[item.filterKey];
                }
            });
        };

        if (currentGroup) {
            currentGroup.options.forEach((opt) => {
                const filterDef = NAX_VIBES_MODEL_FILTERS.find((f) => f.forgeKey === opt.value);
                if (filterDef) appendFilter(filterDef, opt);
            });
        } else {
            NAX_VIBES_MODEL_FILTERS.forEach((filterDef) => {
                appendFilter(filterDef, naxVibeGetModelOption(filterDef.forgeKey));
            });
        }
        this.modelClickMenuConfig.sections[0].items = items;
    }

    ensureModelFiltersEnabled() {
        const any = NAX_VIBES_MODEL_FILTERS.some((f) => this.filters[f.key]);
        if (!any) {
            this.filters.filter45Curated = true;
            this.filters.filter45Full = true;
            this.updateModelFilterButton();
        }
    }

    isBrowseMode() {
        return this.preset === 'browse';
    }

    enterBrowseMode(page) {
        this.preset = 'browse';
        this.page = page || 1;
        this.syncPresetButtons();
    }

    goHome() {
        this.preset = 'top';
        this.page = 1;
        this.search = '';
        if (this.searchInput) this.searchInput.value = '';
        this.syncPresetButtons();
        void this.reload(false);
    }

    setPreset(id) {
        this.preset = id;
        this.page = 1;
        this.search = '';
        if (this.searchInput) this.searchInput.value = '';
        this.syncPresetButtons();
        void this.reload(false);
    }

    syncPresetButtons() {
        const browse = this.isBrowseMode();
        NAX_VIBES_PRESETS.forEach((p) => {
            const btn = document.getElementById(p.btnId);
            if (!btn) return;
            btn.setAttribute('data-state', !browse && this.preset === p.id ? 'on' : 'off');
        });
        if (this.prevPageBtn) {
            this.prevPageBtn.disabled = !browse || this.page <= 1;
        }
        if (this.nextPageBtn) {
            this.nextPageBtn.disabled = !browse || !this.lastMeta?.hasMore;
        }
    }

    buildRequestPayload(forceRefresh) {
        const payload = {
            ...this.filters,
            forceRefresh: !!forceRefresh
        };
        if (this.isBrowseMode()) {
            payload.page = this.page;
            if (this.search) payload.search = this.search;
        } else {
            payload.preset = this.preset;
        }
        return payload;
    }

    async reload(forceRefresh) {
        if (typeof wsClient === 'undefined' || !wsClient || !wsClient.isConnected()) {
            if (typeof showGlassToast === 'function') {
                showGlassToast('error', null, 'WebSocket not connected', false, 4000, '<i class="fas fa-plug"></i>');
            }
            return;
        }

        this.ensureModelFiltersEnabled();
        const gen = ++this.requestGen;
        this.loading = true;
        if (this.grid) this.grid.classList.add('naxt-loading');
        this.updateStatusBar('Loading…');

        try {
            const data = await wsClient.sendMessage('get_nax_vibes_gallery', this.buildRequestPayload(forceRefresh), false);
            if (gen !== this.requestGen) return;

            this.vibes = (data && data.vibes) || [];
            this.vibes.forEach((v) => {
                (v.encodings || []).forEach((enc) => {
                    enc.forgeKey = naxVibeNaxModelToForgeKey(enc.model);
                });
            });
            this.lastMeta = data;
            this.renderGrid();
            this.syncPresetButtons();
            this.updateStatusBar();
        } catch (e) {
            if (gen !== this.requestGen) return;
            console.error('get_nax_vibes_gallery', e);
            this.vibes = [];
            this.renderGrid();
            if (typeof showGlassToast === 'function') {
                showGlassToast('error', null, e.message || 'Failed to load vibes', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
            }
            this.updateStatusBar('Load failed');
        } finally {
            if (gen === this.requestGen) {
                this.loading = false;
                if (this.grid) this.grid.classList.remove('naxt-loading');
            }
        }
    }

    updateStatusBar(overrideText) {
        if (!this.statusBar) return;
        if (overrideText) {
            this.statusBar.textContent = overrideText;
            return;
        }
        const n = this.vibes.length;
        const cacheBit = this.lastMeta && this.lastMeta.fromCache
            ? ` · cached ${naxVibesFormatCacheAge(this.lastMeta.cachedAt)}`
            : '';
        let pageBit = '';
        if (this.isBrowseMode()) {
            pageBit = ` · page ${this.page}`;
            if (this.search) pageBit += ` · “${this.search}”`;
        } else {
            const preset = NAX_VIBES_PRESETS.find((p) => p.id === this.preset);
            pageBit = preset ? ` · ${preset.label}` : '';
        }
        this.statusBar.textContent = `${n} vibes${pageBit}${cacheBit}`;
    }

    getActiveEncoding(vibe, card) {
        const encId = card && card.dataset.activeEncodingId
            ? parseInt(card.dataset.activeEncodingId, 10)
            : vibe.activeEncodingId;
        return vibe.encodings.find((e) => e.id === encId)
            || vibe.encodings.find((e) => e.primary)
            || vibe.encodings[0];
    }

    enrichVibeEncodings(vibe) {
        (vibe.encodings || []).forEach((enc) => {
            if (!enc.forgeKey) enc.forgeKey = naxVibeNaxModelToForgeKey(enc.model);
        });
        return vibe;
    }

    renderGrid() {
        if (!this.grid) return;
        this.grid.innerHTML = '';

        if (!this.vibes.length) {
            if (this.emptyState) this.emptyState.classList.remove('hidden');
            return;
        }
        if (this.emptyState) this.emptyState.classList.add('hidden');

        const frag = document.createDocumentFragment();
        this.vibes.forEach((vibe) => {
            frag.appendChild(this.createCard(vibe));
        });
        this.grid.appendChild(frag);
    }

    createCard(vibe) {
        const card = document.createElement('div');
        card.className = 'naxt-card';
        card.dataset.vibeId = String(vibe.id);
        if (vibe.nsfw) card.dataset.nsfw = '1';

        const activeEnc = this.getActiveEncoding(vibe, null);
        if (activeEnc) card.dataset.activeEncodingId = String(activeEnc.id);

        card._vibeData = this.enrichVibeEncodings(vibe);

        const wrap = document.createElement('div');
        wrap.className = 'naxt-card-img-wrap';

        const img = document.createElement('img');
        img.className = 'naxt-card-img';
        img.alt = vibe.name;
        img.decoding = 'async';
        img.loading = 'lazy';
        img.src = naxVibesResolvePreviewUrl((activeEnc && activeEnc.thumbnailUrl) || vibe.thumbnailUrl || '');

        wrap.appendChild(img);

        const votes = document.createElement('div');
        votes.className = 'naxt-card-votes';
        votes.innerHTML = `<span><i class="fas fa-arrow-up"></i>${vibe.upvotes}</span><span><i class="fas fa-arrow-down"></i>${vibe.downvotes}</span>`;
        wrap.appendChild(votes);

        const badgesContainer = document.createElement('div');
        badgesContainer.className = 'cache-badges';
        (vibe.encodings || []).forEach((enc) => {
            const badgeWrap = document.createElement('div');
            badgeWrap.innerHTML = naxVibeBuildEncodingBadgeHtml(enc);
            badgesContainer.appendChild(badgeWrap.firstElementChild || badgeWrap);
        });

        const cap = document.createElement('div');
        cap.className = 'naxt-card-caption';
        cap.title = vibe.name;
        const nameSpan = document.createElement('span');
        nameSpan.textContent = vibe.name;
        cap.appendChild(nameSpan);
        if (activeEnc) {
            const sub = document.createElement('div');
            sub.className = 'naxt-card-caption-sub';
            sub.textContent = `${naxVibeEncodingDisplayModel(activeEnc)} ${activeEnc.infoExtracted}`;
            cap.appendChild(sub);
        }

        card.appendChild(wrap);
        card.appendChild(badgesContainer);
        card.appendChild(cap);

        const openLumen = (e) => {
            if (e.target.closest('.cache-badges')) return;
            e.preventDefault();
            e.stopPropagation();
            this.openVibeInLumen(card._vibeData, card);
        };
        card.addEventListener('click', openLumen);

        this.attachVibeContextMenu(card);

        return card;
    }

    openVibeInLumen(vibe, card) {
        const enc = this.getActiveEncoding(vibe, card);
        const src = naxVibesResolvePreviewUrl((enc && enc.thumbnailUrl) || vibe.thumbnailUrl);
        if (!src || typeof openImageInViewer !== 'function') return;
        openImageInViewer(src, vibe.name, {
            url: src,
            genericExternalImage: true,
            naxVibeId: vibe.id,
            naxEncodingId: enc && enc.id
        });
    }

    setCardPreviewEncoding(card, enc) {
        if (!card || !enc) return;
        card.dataset.activeEncodingId = String(enc.id);
        const img = card.querySelector('.naxt-card-img');
        if (img && enc.thumbnailUrl) img.src = naxVibesResolvePreviewUrl(enc.thumbnailUrl);
        const sub = card.querySelector('.naxt-card-caption-sub');
        if (sub) sub.textContent = `${naxVibeEncodingDisplayModel(enc)} ${enc.infoExtracted}`;
    }

    buildImportByModelSubmenuItems(vibe) {
        const byModel = {};
        (vibe.encodings || []).forEach((enc) => {
            const key = enc.forgeKey || naxVibeNaxModelToForgeKey(enc.model) || 'other';
            if (!byModel[key]) byModel[key] = [];
            byModel[key].push(enc);
        });

        const modelItems = [];
        Object.keys(byModel).forEach((forgeKey) => {
            const encs = byModel[forgeKey];
            const enc = encs.find((e) => e.primary) || encs[0];
            if (!enc) return;
            const opt = naxVibeGetModelOption(forgeKey);
            modelItems.push({
                text: opt ? opt.name : naxVibeEncodingDisplayModel(enc),
                icon: 'nai-vibe-transfer',
                action: 'nax-vibes-import-encoding',
                encodingId: enc.id,
                previewUrl: enc.thumbnailUrl || vibe.thumbnailUrl || ''
            });
        });

        if (!modelItems.length) return [];
        return [
            { separator: true, text: 'Import by Model' },
            ...modelItems
        ];
    }

    buildPreviewSubmenu(vibe) {
        return (vibe.encodings || []).map((enc) => ({
            text: `${naxVibeEncodingDisplayModel(enc)} · ${enc.infoExtracted}`,
            icon: 'fas fa-eye',
            action: 'nax-vibes-preview-encoding',
            encodingId: enc.id
        }));
    }

    buildVibeContextMenuConfig(vibe, card) {
        const self = this;
        const importSubmenu = [
            { text: 'Import All Encodings', icon: 'nai-import', action: 'nax-vibes-import-full' },
            { text: 'Select Encoding…', icon: 'fas fa-grid-2', action: 'nax-vibes-import-select' },
            ...this.buildImportByModelSubmenuItems(vibe)
        ];

        return {
            onAction: (action, target, item) => {
                const vibeCard = target.closest('.naxt-card');
                const data = vibeCard && vibeCard._vibeData;
                if (!data) return;

                if (action === 'nax-vibes-import-full') {
                    self.importVibe(data, false, null, data.thumbnailUrl);
                } else if (action === 'nax-vibes-import-select') {
                    self.openEncodingPicker(data);
                } else if (action === 'nax-vibes-import-encoding' && item && item.encodingId) {
                    self.importVibe(data, true, item.encodingId, item.previewUrl);
                } else if (action === 'nax-vibes-preview-encoding' && item && item.encodingId) {
                    const enc = data.encodings.find((x) => x.id === item.encodingId);
                    if (enc && vibeCard) self.setCardPreviewEncoding(vibeCard, enc);
                }
            },
            sections: [
                {
                    type: 'list',
                    items: [
                        {
                            text: 'Import…',
                            icon: 'nai-import',
                            openOnHover: true,
                            submenu: importSubmenu
                        },
                        {
                            text: 'Preview',
                            icon: 'fas fa-eye',
                            openOnHover: true,
                            submenu: this.buildPreviewSubmenu(vibe)
                        }
                    ]
                }
            ]
        };
    }

    attachVibeContextMenu(card) {
        if (!card || !card._vibeData || !contextMenu) return;
        const config = this.buildVibeContextMenuConfig(card._vibeData, card);
        if (typeof contextMenu.detachFromElement === 'function') {
            contextMenu.detachFromElement(card);
        }
        contextMenu.attachToElement(card, config);
    }

    openEncodingPicker(vibe) {
        if (!this.encodingPickerModal || !this.encodingPickerGrid) return;
        this.encodingPickerVibe = vibe;
        if (this.encodingPickerTitle) {
            this.encodingPickerTitle.textContent = `Import — ${vibe.name}`;
        }
        this.encodingPickerGrid.innerHTML = '';
        (vibe.encodings || []).forEach((enc) => {
            const opt = naxVibeGetModelOption(enc.forgeKey || naxVibeNaxModelToForgeKey(enc.model));
            const cell = document.createElement('div');
            cell.className = 'nax-vibes-encoding-cell';
            cell.title = `${naxVibeEncodingDisplayModel(enc)} · ${enc.infoExtracted}`;
            const wrap = document.createElement('div');
            wrap.className = 'nax-vibes-encoding-thumb';
            const img = document.createElement('img');
            img.src = naxVibesResolvePreviewUrl(enc.thumbnailUrl || '');
            img.alt = '';
            img.loading = 'lazy';
            wrap.appendChild(img);
            const cap = document.createElement('div');
            cap.className = 'naxt-card-caption';
            const badgeHtml = opt && opt.badge_full
                ? `<span class="custom-dropdown-badge ${opt.badge_class}">${opt.badge_full}</span>`
                : (opt && opt.badge ? `<span class="custom-dropdown-badge ${opt.badge_class}">${opt.badge}</span>` : '');
            cap.innerHTML = `<span>${naxVibesEscapeHtml(naxVibeEncodingDisplayModel(enc))}</span>${badgeHtml}
                <div class="naxt-card-caption-sub">${naxVibesEscapeHtml(enc.infoExtracted)}</div>`;
            cell.appendChild(wrap);
            cell.appendChild(cap);
            cell.addEventListener('click', () => {
                this.closeEncodingPicker();
                this.importVibe(vibe, true, enc.id, enc.thumbnailUrl || vibe.thumbnailUrl);
            });
            this.encodingPickerGrid.appendChild(cell);
        });
        if (typeof openModal === 'function') {
            openModal(this.encodingPickerModal);
        }
    }

    closeEncodingPicker() {
        if (!this.encodingPickerModal || typeof closeModal !== 'function') return;
        closeModal(this.encodingPickerModal);
        this.encodingPickerVibe = null;
    }

    importVibe(vibe, single, encodingId, previewUrlOverride) {
        let downloadUrl = vibe.downloadFullUrl;
        let previewUrl = previewUrlOverride || '';
        if (single) {
            const encId = encodingId || vibe.activeEncodingId;
            if (!encId) {
                if (typeof showGlassToast === 'function') {
                    showGlassToast('warning', null, 'No encoding selected', false, 3000, '<i class="fas fa-exclamation-triangle"></i>');
                }
                return;
            }
            const enc = (vibe.encodings || []).find((e) => e.id === encId);
            if (!previewUrl && enc && enc.thumbnailUrl) previewUrl = enc.thumbnailUrl;
            downloadUrl = `https://nax.moe/partials/api/vibe-download.php?id=${vibe.id}&single=true&encoding_id=${encId}`;
        }
        if (!previewUrl) previewUrl = vibe.thumbnailUrl || '';
        previewUrl = naxVibesResolvePreviewUrl(previewUrl);
        const encoding = single && encodingId
            ? (vibe.encodings || []).find((e) => e.id === encodingId)
            : null;
        void this.runDirectImport(vibe, downloadUrl, previewUrl, encoding);
    }

    async open() {
        if (!this.modal) return;
        this.applyTitleLabel();
        this.syncPresetButtons();
        if (typeof openModal === 'function') {
            openModal(this.modal);
        }
        setTimeout(() => {
            if (typeof customScrollbar !== 'undefined' && customScrollbar) {
                const body = this.modal.querySelector('.naxt-body.form-section-scroll');
                if (body) customScrollbar.forceReinit(body);
            }
        }, 80);
        await this.reload(false);
    }

    close() {
        if (!this.modal || typeof closeModal !== 'function') return;
        closeModal(this.modal);
    }
}

const naxVibesApplet = new NaxVibesApplet();
