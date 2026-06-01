/**
 * NAXT applet — NAX community tag browser (WebSocket data, GET only for images).
 * public/scripts/comp/modalUtils.js (openModal), public/scripts/comp/dropdown.js (setupDropdown)
 */

const NAXT_FILTER_DEBOUNCE_MS = 2000;
const NAXT_TAG_BAG_LS = 'naxtTagBag';

const NAXT_QUICK_FILTERS = [
    { id: 'goat', btnId: 'naxtQuickGoatBtn' },
    { id: 'gems', btnId: 'naxtQuickGemsBtn' },
    { id: 'debated', btnId: 'naxtQuickDebatedBtn' }
];

const NAXT_MARK_FILTER_OPTIONS = [
    { value: 'all', label: 'All' },
    { value: 'favorites', label: 'Favorites' },
    { value: 'try', label: 'Try' },
    { value: 'unmarked', label: 'Unmarked' }
];

function naxtEscapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/"/g, '&quot;');
}

/** Icon from gallery slug (danbooru-*-tags-* naming). */
function naxtGalleryIconClass(slug) {
    const l = String(slug || '').toLowerCase();
    if (l.includes('character')) return 'fas fa-user';
    if (l.includes('copyright')) return 'fas fa-copyright';
    if (l.includes('face')) return 'fas fa-smile-wink';
    if (l.includes('artist')) return 'fas fa-wheelchair';
    if (l.includes('hair')) return 'fas fa-air-freshener';
    return 'fas fa-layer-group';
}

/** Dropdown / button label: gallery title with only whole words Tags and Prompt removed. */
function naxtGalleryMenuLabel(g) {
    const raw = String((g && g.title) || (g && g.slug) || '').trim();
    const t = raw.replace(/\btags\b/gi, '').replace(/\bprompt\b/gi, '').replace(/\s{2,}/g, ' ').trim();
    return t || (g && g.slug) || '';
}

function naxtGalleryBucketLabel(slug, galleries) {
    const g = galleries && galleries.find((x) => x.slug === slug);
    if (g) return naxtGalleryMenuLabel(g);
    return String(slug || '')
        .replace(/\btags\b/gi, '')
        .replace(/\bprompt\b/gi, '')
        .replace(/\s{2,}/g, ' ')
        .trim() || slug || '';
}

/** Split tag portion from ", Text:" narrative suffix (manual prompt convention). */
function naxtSplitPromptTagsAndText(prompt) {
    const p = prompt == null ? '' : String(prompt);
    const idx = p.indexOf(', Text:');
    if (idx === -1) return { tagsPart: p, textSuffix: '' };
    return { tagsPart: p.slice(0, idx), textSuffix: p.slice(idx) };
}

/**
 * If tagsPart ends with artist:… or art by … (optional single emphasis wrapper), return { prefix, bias, plainCore }.
 */
function naxtMatchTrailingArtistSegment(tagsPart) {
    const s = String(tagsPart || '').replace(/\s+$/, '');
    if (!s) return null;
    const innerEm = '(artist:[^\\s,]+|art\\s+by\\s+(?:(?!::).)+)';
    const innerPlain = '(artist:[^\\s,]+|art\\s+by\\s+.+)';

    let m = s.match(new RegExp(`^(.*?)(,\\s*)(-?\\d+\\.?\\d*)::${innerEm}\\s*::$`, 'i'));
    if (m) {
        const bias = parseFloat(m[3]);
        return {
            prefix: m[1].replace(/\s+$/, ''),
            bias: Number.isFinite(bias) ? bias : null,
            plainCore: m[4].trim().replace(/\s+$/, '')
        };
    }
    m = s.match(new RegExp(`^(-?\\d+\\.?\\d*)::${innerEm}\\s*::$`, 'i'));
    if (m) {
        const bias = parseFloat(m[1]);
        return {
            prefix: '',
            bias: Number.isFinite(bias) ? bias : null,
            plainCore: m[2].trim().replace(/\s+$/, '')
        };
    }
    m = s.match(new RegExp(`^(.*?)(,\\s*)(${innerPlain})$`, 'i'));
    if (m) {
        return {
            prefix: m[1].replace(/\s+$/, ''),
            bias: null,
            plainCore: m[3].trim().replace(/\s+$/, '')
        };
    }
    m = s.match(new RegExp(`^(${innerPlain})$`, 'i'));
    if (m) {
        return { prefix: '', bias: null, plainCore: m[1].trim().replace(/\s+$/, '') };
    }
    return null;
}

function naxtMergeTagsPartAndTextSuffix(tagsPart, textSuffix) {
    const t = String(tagsPart || '');
    const sfx = String(textSuffix || '');
    if (!sfx) return t;
    if (!t.trim()) return sfx;
    return t + sfx;
}

function naxtExtractEmphasisBias(segment) {
    const s = String(segment || '').trim();
    const m = s.match(/^(-?\d+(?:\.\d+)?)::([\s\S]+)::\s*$/);
    if (m) {
        const bias = parseFloat(m[1]);
        return Number.isFinite(bias) ? bias : null;
    }
    return null;
}

/** Replace the trailing tag token in tagsPart, preserving emphasis on the replaced segment. */
function naxtReplaceLastTagInTagsPart(tagsPart, newFragment) {
    const s = String(tagsPart || '');
    if (!s.trim()) return newFragment;
    // findAutocompleteTermStart, findAutocompleteTermEnd: public/scripts/comp/autocompleteUtils.js
    const termStart = findAutocompleteTermStart(s);
    const termEnd = findAutocompleteTermEnd(s, s.length);
    const oldSegment = s.substring(termStart, termEnd);
    const bias = naxtExtractEmphasisBias(oldSegment);
    const frag = naxtApplyEmphasisToFragment(newFragment, bias);
    const before = s.substring(0, termStart).replace(/[,\s]*$/, '');
    return before ? `${before}, ${frag}` : frag;
}

/** Uses global emphasis helpers (present after full page script load). */
function naxtApplyEmphasisToFragment(fragment, bias) {
    if (!fragment || bias == null || bias === 1.0) return fragment;
    if (typeof hasEmphasisGroup === 'function' && hasEmphasisGroup(fragment)) return fragment;
    if (typeof applyBiasToText === 'function') return applyBiasToText(fragment, bias);
    return fragment;
}

/** Prompt fragment for a NAX tag (artist galleries use artist:/art by; curated artists use plain tag). */
function naxtFormatTagFragment(tagName, gallerySlug) {
    const sl = String(gallerySlug || '').toLowerCase();
    if (/^artists-v[\d.]+$/i.test(sl) || sl === 'artists-v4.5') {
        return tagName;
    }
    if (sl.includes('artist')) {
        return /\s/.test(tagName) ? `art by ${tagName}` : `artist:${tagName}`;
    }
    return tagName;
}

class NaxtApplet {
    constructor() {
        this.modal = null;
        this.history = [];
        this.historyIndex = -1;
        this.galleries = [];
        this.selectedGallerySlug = '';
        this.sortKey = 'score';
        this.markFilter = 'all';
        this.bag = [];
        this.invert = false;
        this.filterRowVisible = false;
        this.offset = 0;
        this.total = 0;
        this.hasMore = false;
        this.loading = false;
        this.requestGen = 0;
        this.filterReloadTimer = null;
        this.committedSearchQuery = '';
        this.loadRequestsActive = 0;
        this.randomSeed = 0;
        this.backMenuConfig = null;
        this.forwardMenuConfig = null;
        this.contextMenuElements = [];
        this.sentinelObserver = null;
        this.imgVisibilityObserver = null;
        this.customTagGenerating = false;
        this.pendingCustomTag = null;
        this.activeQuickFilter = '';
        this.init();
    }

    init() {
        this.modal = document.getElementById('naxtModal');
        if (!this.modal) return;

        this.backBtn = document.getElementById('naxtBackBtn');
        this.forwardBtn = document.getElementById('naxtForwardBtn');
        this.homeBtn = document.getElementById('naxtHomeBtn');
        this.closeBtn = document.getElementById('closeNaxtModalBtn');
        this.datasetDropdown = document.getElementById('naxtDatasetDropdown');
        this.datasetBtn = document.getElementById('naxtDatasetDropdownBtn');
        this.datasetMenu = document.getElementById('naxtDatasetDropdownMenu');
        this.datasetSelected = document.getElementById('naxtDatasetSelected');
        this.searchInput = document.getElementById('naxtSearchInput');
        this.filterToggleBtn = document.getElementById('naxtFilterToggleBtn');
        this.filterRow = document.getElementById('naxtFilterRow');
        this.sortDropdown = document.getElementById('naxtSortDropdown');
        this.sortBtn = document.getElementById('naxtSortDropdownBtn');
        this.sortMenu = document.getElementById('naxtSortDropdownMenu');
        this.sortSelected = document.getElementById('naxtSortSelected');
        this.invertBtn = document.getElementById('naxtInvertBtn');
        this.resetFiltersBtn = document.getElementById('naxtResetFiltersBtn');
        this.quickGoatBtn = document.getElementById('naxtQuickGoatBtn');
        this.quickGemsBtn = document.getElementById('naxtQuickGemsBtn');
        this.quickDebatedBtn = document.getElementById('naxtQuickDebatedBtn');
        this.grid = document.getElementById('naxtGrid');
        this.sentinel = document.getElementById('naxtLoadSentinel');
        this.emptyState = document.getElementById('naxtEmptyState');
        this.emptySetup = document.getElementById('naxtEmptySetup');
        this.emptyNoResults = document.getElementById('naxtEmptyNoResults');
        this.minUp = document.getElementById('naxtMinUp');
        this.maxUp = document.getElementById('naxtMaxUp');
        this.minDown = document.getElementById('naxtMinDown');
        this.maxDown = document.getElementById('naxtMaxDown');
        this.minScore = document.getElementById('naxtMinScore');
        this.maxScore = document.getElementById('naxtMaxScore');
        this.minRatio = document.getElementById('naxtMinRatio');
        this.maxRatio = document.getElementById('naxtMaxRatio');
        this.statusBar = document.getElementById('naxtStatusBar');
        this.modalTitleLabel = document.getElementById('naxtModalTitleLabel');
        this.openCustomTagBtn = document.getElementById('naxtOpenCustomTagBtn');
        this.customTagModal = document.getElementById('naxtCustomTagModal');
        this.customTagModalTitle = document.getElementById('naxtCustomTagModalTitle');
        this.customTagInput = document.getElementById('naxtCustomTagInput');
        this.customTagPreview = document.getElementById('naxtCustomTagPreview');
        this.customTagGenerateBtn = document.getElementById('naxtCustomTagGenerateBtn');
        this.customTagAcceptBtn = document.getElementById('naxtCustomTagAcceptBtn');
        this.customTagDeleteBtn = document.getElementById('naxtCustomTagDeleteBtn');
        this.closeCustomTagBtn = document.getElementById('closeNaxtCustomTagModalBtn');
        this.bagDropdown = document.getElementById('naxtBagDropdown');
        this.bagBtn = document.getElementById('naxtBagDropdownBtn');
        this.bagMenu = document.getElementById('naxtBagDropdownMenu');
        this.bagCountEl = document.getElementById('naxtBagCount');
        this.markFilterDropdown = document.getElementById('naxtMarkFilterDropdown');
        this.markFilterBtn = document.getElementById('naxtMarkFilterDropdownBtn');
        this.markFilterMenu = document.getElementById('naxtMarkFilterDropdownMenu');
        this.markFilterSelected = document.getElementById('naxtMarkFilterSelected');

        this.loadBagFromStorage();
        this.setupDropdowns();
        this.setupListeners();
        this.updateBagChrome();
        this.updateMarkFilterLabel();
        this.setupHistoryMenus();
    }

    getScrollRoot() {
        return this.modal && this.modal.querySelector('.naxt-body .scrollable-content');
    }

    updateDatasetLabelVisual(slug) {
        if (!this.datasetSelected) return;
        const s = slug || this.selectedGallerySlug || '';
        const g = this.galleries.find((x) => x.slug === s);
        const label = s ? (g ? naxtGalleryMenuLabel(g) : naxtGalleryBucketLabel(s, this.galleries)) : 'Dataset';
        const icon = s ? naxtGalleryIconClass(s) : 'fas fa-layer-group';
        this.datasetSelected.innerHTML = `<i class="${naxtEscapeHtml(icon)} naxt-dataset-btn-icon" aria-hidden="true"></i><span class="naxt-dataset-btn-text">${naxtEscapeHtml(label)}</span>`;
        if (this.modalTitleLabel) {
            this.modalTitleLabel.textContent = s ? `Atelier - ${label}` : 'Atelier';
        }
        this.syncCustomTagBtnState();
    }

    isGenerationEnabledForSlug(slug) {
        if (!slug) return false;
        const g = this.galleries.find((x) => x.slug === slug);
        return !!(g && g.generationEnabled);
    }

    syncCustomTagBtnState() {
        if (!this.openCustomTagBtn) return;
        const enabled = this.isGenerationEnabledForSlug(this.selectedGallerySlug);
        this.openCustomTagBtn.classList.toggle('hidden', !enabled);
        this.openCustomTagBtn.disabled = !enabled;
    }

    openCustomTagTool() {
        if (!this.customTagModal || !this.isGenerationEnabledForSlug(this.selectedGallerySlug)) return;
        const g = this.galleries.find((x) => x.slug === this.selectedGallerySlug);
        const label = g ? naxtGalleryMenuLabel(g) : this.selectedGallerySlug;
        if (this.customTagModalTitle) {
            this.customTagModalTitle.textContent = label ? `Add Tag [${label}]` : 'Add Tag';
        }
        this.resetCustomTagPreview();
        if (typeof openModal === 'function') {
            openModal(this.customTagModal);
        }
        setTimeout(() => {
            if (this.customTagInput) this.customTagInput.focus();
        }, 80);
    }

    closeCustomTagTool() {
        if (!this.customTagModal || typeof closeModal !== 'function') return;
        if (typeof hideCharacterAutocomplete === 'function') {
            hideCharacterAutocomplete();
        }
        closeModal(this.customTagModal);
    }

    resetCustomTagPreview() {
        this.pendingCustomTag = null;
        if (this.customTagInput) {
            this.customTagInput.value = '';
            this.customTagInput.disabled = false;
        }
        if (this.customTagGenerateBtn) {
            this.customTagGenerateBtn.disabled = false;
        }
        if (this.customTagPreview) {
            this.customTagPreview.className = 'weather-location-match naxt-custom-tag-preview';
            this.customTagPreview.textContent = 'Enter a tag and click Generate to preview.';
            this.customTagPreview.onclick = null;
            this.customTagPreview.removeAttribute('title');
        }
        this.syncCustomTagFooter();
    }

    syncCustomTagFooter() {
        const hasPreview = !!this.pendingCustomTag;
        const generating = this.customTagGenerating;
        if (this.customTagGenerateBtn) {
            this.customTagGenerateBtn.classList.toggle('hidden', hasPreview);
            this.customTagGenerateBtn.disabled = generating || hasPreview;
        }
        if (this.customTagAcceptBtn) {
            this.customTagAcceptBtn.classList.toggle('hidden', !hasPreview);
            this.customTagAcceptBtn.disabled = !hasPreview;
        }
        if (this.customTagDeleteBtn) {
            this.customTagDeleteBtn.classList.toggle('hidden', !hasPreview);
            this.customTagDeleteBtn.disabled = !hasPreview || generating;
        }
    }

    setCustomTagGenerating(active) {
        this.customTagGenerating = !!active;
        if (this.customTagGenerateBtn) {
            this.customTagGenerateBtn.disabled = !!active;
        }
        if (this.customTagInput) {
            this.customTagInput.disabled = !!active || !!this.pendingCustomTag;
        }
        if ((active || this.pendingCustomTag) && typeof hideCharacterAutocomplete === 'function') {
            hideCharacterAutocomplete();
        }
        if (this.customTagPreview && active) {
            this.customTagPreview.className = 'weather-location-match naxt-custom-tag-preview loading';
            this.customTagPreview.textContent = 'Generating preview…';
        }
        if (active) {
            this.syncCustomTagFooter();
        }
    }

    openNaxItemInViewer(item) {
        if (!item) return;
        const src = this.imageUrl(item);
        if (typeof openImageInViewer === 'function') {
            openImageInViewer(src, item.tag, {
                url: src,
                genericExternalImage: true,
                naxFilename: item.filename,
                naxGallerySlug: item.gallerySlug,
                naxFavorite: !!item.favorite,
                naxTryMark: !!item.tryMark
            });
        }
    }

    showCustomTagPreview(item) {
        if (!item) return;
        this.pendingCustomTag = item;
        if (this.customTagInput) {
            this.customTagInput.value = item.tag;
            this.customTagInput.disabled = true;
        }
        if (typeof hideCharacterAutocomplete === 'function') {
            hideCharacterAutocomplete();
        }
        if (this.customTagGenerateBtn) {
            this.customTagGenerateBtn.disabled = true;
        }
        if (this.customTagPreview) {
            this.customTagPreview.className = 'weather-location-match naxt-custom-tag-preview success naxt-custom-tag-preview-clickable';
            this.customTagPreview.title = 'Open preview';
            this.customTagPreview.innerHTML = '';
            const img = document.createElement('img');
            img.src = this.imageUrl(item);
            img.alt = item.tag;
            const cap = document.createElement('span');
            cap.className = 'naxt-custom-tag-preview-caption';
            cap.textContent = item.tag;
            this.customTagPreview.appendChild(img);
            this.customTagPreview.appendChild(cap);
            this.customTagPreview.onclick = () => this.openNaxItemInViewer(item);
        }
        this.syncCustomTagFooter();
    }

    async submitCustomTag() {
        if (this.customTagGenerating || this.pendingCustomTag || !this.customTagInput) return;
        const raw = String(this.customTagInput.value || '').trim();
        if (!raw) {
            if (typeof showGlassToast === 'function') {
                showGlassToast('warning', null, 'Enter a tag name', false, 3000, '<i class="fas fa-exclamation-triangle"></i>');
            }
            return;
        }
        if (!window.wsClient || !window.wsClient.isConnected()) {
            if (typeof showGlassToast === 'function') {
                showGlassToast('error', null, 'WebSocket not connected', false, 4000, '<i class="fas fa-plug"></i>');
            }
            return;
        }

        this.setCustomTagGenerating(true);
        try {
            const data = await window.wsClient.sendMessage('generate_nax_custom_tag', {
                gallerySlug: this.selectedGallerySlug,
                tag: raw
            }, false);
            const item = data && data.item;
            if (!item) {
                throw new Error('No preview returned');
            }
            this.showCustomTagPreview(item);
        } catch (e) {
            if (this.customTagPreview) {
                this.customTagPreview.className = 'weather-location-match naxt-custom-tag-preview error';
                this.customTagPreview.textContent = e.message || 'Generation failed';
            }
            if (typeof showGlassToast === 'function') {
                showGlassToast('error', null, e.message || 'Generation failed', false, 6000, '<i class="fas fa-exclamation-triangle"></i>');
            }
        } finally {
            this.customTagGenerating = false;
            this.syncCustomTagFooter();
        }
    }

    async acceptCustomTag() {
        if (!this.pendingCustomTag) return;
        const tagName = this.pendingCustomTag.tag;
        this.closeCustomTagTool();
        this.resetCustomTagPreview();
        await this.reloadFromTop(false);
        if (typeof showGlassToast === 'function') {
            showGlassToast('success', null, `Added "${tagName}"`, false, 2500, '<i class="fas fa-check"></i>');
        }
    }

    async deleteCustomTag(gallerySlug, tag, opts = {}) {
        const slug = gallerySlug || this.selectedGallerySlug;
        const tagName = tag || (this.pendingCustomTag && this.pendingCustomTag.tag);
        if (!slug || !tagName) return;

        if (!window.wsClient || !window.wsClient.isConnected()) {
            if (typeof showGlassToast === 'function') {
                showGlassToast('error', null, 'WebSocket not connected', false, 4000, '<i class="fas fa-plug"></i>');
            }
            return;
        }

        const fromTool = !!opts.fromTool;
        if (this.customTagDeleteBtn) this.customTagDeleteBtn.disabled = true;

        try {
            await window.wsClient.sendMessage('delete_nax_custom_tag', {
                gallerySlug: slug,
                tag: tagName
            }, false);
            if (fromTool) {
                this.resetCustomTagPreview();
            }
            await this.reloadFromTop(false);
            if (typeof showGlassToast === 'function') {
                showGlassToast('success', null, `Deleted "${tagName}"`, false, 2500, '<i class="fas fa-check"></i>');
            }
        } catch (e) {
            if (typeof showGlassToast === 'function') {
                showGlassToast('error', null, e.message || 'Delete failed', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
            }
            if (fromTool && this.pendingCustomTag) {
                this.syncCustomTagFooter();
            }
        } finally {
            if (fromTool && this.customTagDeleteBtn && this.pendingCustomTag) {
                this.customTagDeleteBtn.disabled = false;
            }
        }
    }

    scheduleFilterReload() {
        if (this.filterReloadTimer) clearTimeout(this.filterReloadTimer);
        this.filterReloadTimer = setTimeout(() => {
            this.filterReloadTimer = null;
            void this.reloadFromTop(false);
            this.syncFilterToggleIndicator();
        }, NAXT_FILTER_DEBOUNCE_MS);
    }

    filtersAreActive() {
        if (this.activeQuickFilter) return true;
        if (this.invert) return true;
        if (this.markFilter && this.markFilter !== 'all') return true;
        if (this.sortKey === 'ratio' || this.sortKey === 'random') return true;
        const els = [this.minUp, this.maxUp, this.minDown, this.maxDown, this.minScore, this.maxScore, this.minRatio, this.maxRatio];
        for (const el of els) {
            if (el && String(el.value).trim() !== '') return true;
        }
        return false;
    }

    syncFilterToggleIndicator() {
        if (!this.filterToggleBtn) return;
        this.filterToggleBtn.setAttribute('data-filters-active', this.filtersAreActive() ? 'true' : 'false');
    }

    setGridLoading(active) {
        if (!this.grid) return;
        this.grid.classList.toggle('naxt-loading', !!active);
    }

    setupDropdowns() {
        if (this.sortDropdown && this.sortBtn && this.sortMenu && typeof setupDropdown === 'function') {
            setupDropdown(
                this.sortDropdown,
                this.sortBtn,
                this.sortMenu,
                () => this.renderNaxtSortMenu(),
                () => this.sortKey
            );
        }

        if (this.datasetDropdown && this.datasetBtn && this.datasetMenu && typeof setupDropdown === 'function') {
            setupDropdown(
                this.datasetDropdown,
                this.datasetBtn,
                this.datasetMenu,
                () => this.renderDatasetMenu(),
                () => this.selectedGallerySlug
            );
        }

        if (this.markFilterDropdown && this.markFilterBtn && this.markFilterMenu && typeof setupDropdown === 'function') {
            setupDropdown(
                this.markFilterDropdown,
                this.markFilterBtn,
                this.markFilterMenu,
                () => this.renderNaxtMarkFilterMenu(),
                () => this.markFilter,
                { preventFocusTransfer: true }
            );
        }

        if (this.bagDropdown && this.bagBtn && this.bagMenu && typeof setupDropdown === 'function') {
            setupDropdown(
                this.bagDropdown,
                this.bagBtn,
                this.bagMenu,
                () => this.renderNaxtBagMenu(),
                () => null,
                { preventFocusTransfer: true }
            );
        }
    }

    updateMarkFilterLabel() {
        if (!this.markFilterSelected) return;
        const opt = NAXT_MARK_FILTER_OPTIONS.find((o) => o.value === this.markFilter);
        this.markFilterSelected.textContent = opt ? opt.label : 'All';
    }

    renderNaxtMarkFilterMenu() {
        if (!this.markFilterMenu) return;
        const menu = this.markFilterMenu;
        menu.innerHTML = '';
        const selectMark = (value) => {
            this.markFilter = value;
            this.updateMarkFilterLabel();
            if (typeof closeDropdown === 'function') closeDropdown(this.markFilterMenu, this.markFilterBtn);
            void this.reloadFromTop(true);
            this.syncFilterToggleIndicator();
        };
        NAXT_MARK_FILTER_OPTIONS.forEach((item) => {
            const option = document.createElement('div');
            option.className = 'custom-dropdown-option' + (this.markFilter === item.value ? ' selected' : '');
            option.tabIndex = 0;
            option.dataset.value = item.value;
            option.innerHTML = `<span>${item.label}</span>`;
            this.bindNaxtSortMenuOption(option, () => selectMark(item.value));
            menu.appendChild(option);
        });
    }

    loadBagFromStorage() {
        this.bag = [];
        try {
            const raw = localStorage.getItem(NAXT_TAG_BAG_LS);
            if (!raw) return;
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                this.bag = parsed.filter(
                    (e) => e && e.tag && e.gallerySlug && e.filename
                );
            }
        } catch {
            this.bag = [];
        }
    }

    saveBagToStorage() {
        try {
            localStorage.setItem(NAXT_TAG_BAG_LS, JSON.stringify(this.bag));
        } catch {
            /* */
        }
    }

    updateBagChrome() {
        const n = this.bag.length;
        if (this.bagCountEl) {
            this.bagCountEl.textContent = String(n);
            this.bagCountEl.classList.toggle('hidden', n === 0);
        }
        if (this.bagBtn) {
            this.bagBtn.setAttribute('data-state', n > 0 ? 'on' : 'off');
        }
    }

    bagEntryKey(entry) {
        return `${entry.gallerySlug}\0${entry.tag}`;
    }

    isInBag(tag, gallerySlug) {
        const key = `${gallerySlug}\0${tag}`;
        return this.bag.some((e) => this.bagEntryKey(e) === key);
    }

    async addToBag(tag, gallerySlug, filename) {
        if (!tag || !gallerySlug || !filename) return;
        const key = `${gallerySlug}\0${tag}`;
        if (this.bag.some((e) => this.bagEntryKey(e) === key)) {
            if (typeof showGlassToast === 'function') {
                showGlassToast('info', null, `"${tag}" is already in the bag`, false, 2500, '<i class="fas fa-shopping-bag"></i>');
            }
            return;
        }
        this.bag.push({ tag, gallerySlug, filename });
        this.saveBagToStorage();
        this.updateBagChrome();
        if (typeof showGlassToast === 'function') {
            showGlassToast('success', null, `Added "${tag}" to bag`, false, 2500, '<i class="fas fa-shopping-bag"></i>');
        }
    }

    removeFromBagAt(index) {
        if (index < 0 || index >= this.bag.length) return;
        this.bag.splice(index, 1);
        this.saveBagToStorage();
        this.updateBagChrome();
    }

    clearBag() {
        this.bag = [];
        this.saveBagToStorage();
        this.updateBagChrome();
        if (typeof closeDropdown === 'function' && this.bagMenu && this.bagBtn) {
            closeDropdown(this.bagMenu, this.bagBtn);
        }
    }

    renderNaxtBagMenu() {
        if (!this.bagMenu) return;
        const menu = this.bagMenu;
        menu.innerHTML = '';

        if (!this.bag.length) {
            const empty = document.createElement('div');
            empty.className = 'custom-dropdown-option disabled';
            empty.textContent = 'Bag is empty';
            menu.appendChild(empty);
        } else {
            this.bag.forEach((entry, index) => {
                const option = document.createElement('div');
                option.className = 'custom-dropdown-option naxt-bag-item';
                option.tabIndex = 0;
                const icon = naxtGalleryIconClass(entry.gallerySlug);
                option.innerHTML = `<i class="${icon}"></i> <span>${naxtEscapeHtml(entry.tag)}</span>`;
                this.syncNaxtTagTargetDataset(option, entry, index);
                this.attachNaxtTagContextMenu(option, {
                    inBag: true,
                    isCustom: option.dataset.isCustom === '1'
                });
                this.bindNaxtSortMenuOption(option, () => {
                    this.removeFromBagAt(index);
                    if (typeof closeDropdown === 'function') closeDropdown(this.bagMenu, this.bagBtn);
                });
                menu.appendChild(option);
            });
        }

        const actions = document.createElement('div');
        actions.className = 'naxt-bag-menu-actions';

        const addAction = (label, iconClass, handler, disabled) => {
            const option = document.createElement('div');
            option.className = 'custom-dropdown-option' + (disabled ? ' disabled' : '');
            option.tabIndex = disabled ? -1 : 0;
            option.innerHTML = `<i class="${iconClass}"></i> <span>${label}</span>`;
            if (!disabled) {
                this.bindNaxtSortMenuOption(option, () => {
                    if (typeof closeDropdown === 'function') closeDropdown(this.bagMenu, this.bagBtn);
                    handler();
                });
            }
            actions.appendChild(option);
        };

        const hasBag = this.bag.length > 0;
        addAction('Compile', 'fas fa-hammer', () => this.compileBag(), !hasBag);
        addAction('Open Phasewalker', 'fas fa-layer-group', () => this.openPhasewalkerFromBag(), !hasBag);
        addAction('Remove all', 'fas fa-trash', () => this.clearBag(), !hasBag);

        menu.appendChild(actions);
    }

    buildBracketSnapshotFromBag() {
        const keywordSteps = {
            bag: this.bag.map((entry, i) => ({
                id: `bag_step_${i}`,
                prompt: naxtFormatTagFragment(entry.tag, entry.gallerySlug),
                uc: ''
            }))
        };
        return {
            keywords: ['bag'],
            keywordSteps,
            stepNames: this.bag.map((entry) => entry.tag),
            useStage0: true,
            compareSourceStepIndex: null
        };
    }

    compileBag() {
        if (!this.bag.length) {
            if (typeof showGlassToast === 'function') {
                showGlassToast('warning', null, 'Bag is empty', false, 3000, '<i class="fas fa-shopping-bag"></i>');
            }
            return;
        }
        const manualModal = document.getElementById('manualModal');
        if (manualModal && manualModal.classList.contains('hidden')) {
            if (typeof showGlassToast === 'function') {
                showGlassToast('info', null, 'Open the editor first', false, 3000, '<i class="fas fa-info-circle"></i>');
            }
            return;
        }
        const snapshot = this.buildBracketSnapshotFromBag();
        // bracketGenerationApplet: public/scripts/comp/bracketGenerationApplet.js
        if (window.bracketGenerationApplet && typeof window.bracketGenerationApplet.open === 'function') {
            window.bracketGenerationApplet.open({ state: snapshot, autoCompile: true });
        } else {
            const modal = document.getElementById('bracketGenerationModal');
            if (modal && typeof openModal === 'function') openModal(modal);
        }
    }

    openPhasewalkerFromBag() {
        if (!this.bag.length) {
            if (typeof showGlassToast === 'function') {
                showGlassToast('warning', null, 'Bag is empty', false, 3000, '<i class="fas fa-shopping-bag"></i>');
            }
            return;
        }
        const snapshot = this.buildBracketSnapshotFromBag();
        // bracketGenerationApplet: public/scripts/comp/bracketGenerationApplet.js
        if (window.bracketGenerationApplet && typeof window.bracketGenerationApplet.open === 'function') {
            window.bracketGenerationApplet.open({ state: snapshot, autoCompile: false });
        } else {
            const modal = document.getElementById('bracketGenerationModal');
            if (modal && typeof openModal === 'function') openModal(modal);
        }
    }

    findVisibleCard(gallerySlug, tag) {
        if (!this.grid) return null;
        const esc = (s) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(String(s)) : String(s).replace(/"/g, '\\"'));
        return this.grid.querySelector(
            `.naxt-card[data-gallery-slug="${esc(gallerySlug)}"][data-tag="${esc(tag)}"]`
        );
    }

    applyTryToCard(card, tryMark) {
        if (!card) return;
        card.dataset.try = tryMark ? '1' : '0';
    }

    async setFavoriteForTag(gallerySlug, tag, favorite) {
        try {
            await window.wsClient.sendMessage('set_nax_favorite', { gallerySlug, tag, favorite }, false);
            const card = this.findVisibleCard(gallerySlug, tag);
            this.applyFavoriteToCard(card, favorite);
            // invalidatePromptCtxNaxFavoritesCache: public/scripts/comp/promptTextareaContextMenu.js
            if (invalidatePromptCtxNaxFavoritesCache) invalidatePromptCtxNaxFavoritesCache();
            // invalidatePromptCtxNaxExpanderPresetsCache: public/scripts/comp/promptTextareaContextMenu.js
            if (invalidatePromptCtxNaxExpanderPresetsCache) invalidatePromptCtxNaxExpanderPresetsCache();
        } catch (e) {
            if (typeof showGlassToast === 'function') {
                showGlassToast('error', null, e.message || 'Favorite failed', false, 4000, '<i class="fas fa-exclamation-triangle"></i>');
            }
        }
    }

    async setTryMarkForTag(gallerySlug, tag, tryMark) {
        try {
            await window.wsClient.sendMessage('set_nax_try', { gallerySlug, tag, tryMark }, false);
            const card = this.findVisibleCard(gallerySlug, tag);
            this.applyTryToCard(card, tryMark);
            // invalidatePromptCtxNaxExpanderPresetsCache: public/scripts/comp/promptTextareaContextMenu.js
            if (invalidatePromptCtxNaxExpanderPresetsCache) invalidatePromptCtxNaxExpanderPresetsCache();
        } catch (e) {
            if (typeof showGlassToast === 'function') {
                showGlassToast('error', null, e.message || 'Try mark failed', false, 4000, '<i class="fas fa-exclamation-triangle"></i>');
            }
        }
    }

    async clearTryMark(gallerySlug, tag) {
        const card = this.findVisibleCard(gallerySlug, tag);
        if (card && card.dataset.try === '1') {
            await this.setTryMarkForTag(gallerySlug, tag, false);
            return;
        }
        try {
            await window.wsClient.sendMessage('set_nax_try', { gallerySlug, tag, tryMark: false }, false);
            this.applyTryToCard(card, false);
        } catch {
            /* */
        }
    }

    renderNaxtSortMenu() {
        if (!this.sortMenu) return;
        const menu = this.sortMenu;
        menu.innerHTML = '';
        const sortOptions = [
            { value: 'score', label: 'Score' },
            { value: 'name', label: 'Name' },
            { value: 'date', label: 'Date (export order)' },
            { value: 'ratio', label: 'Ratio' },
            { value: 'random', label: 'Random' }
        ];
        const selectSort = (value) => {
            if (value === 'random') {
                this.randomSeed = (Math.random() * 2147483647) | 0;
                this.invert = false;
                if (this.invertBtn) this.invertBtn.setAttribute('data-state', 'off');
            } else if (this.sortKey === 'random') {
                this.randomSeed = 0;
            }
            this.sortKey = value;
            this.activeQuickFilter = '';
            this.syncQuickFilterButtons();
            const opt = sortOptions.find((o) => o.value === value);
            if (this.sortSelected) this.sortSelected.textContent = opt ? opt.label : 'Score';
            if (typeof closeDropdown === 'function') closeDropdown(this.sortMenu, this.sortBtn);
            void this.reloadFromTop(true);
            this.syncFilterToggleIndicator();
        };
        sortOptions.forEach((item) => {
            const option = document.createElement('div');
            option.className = 'custom-dropdown-option' + (this.sortKey === item.value ? ' selected' : '');
            option.tabIndex = 0;
            option.dataset.value = item.value;
            option.innerHTML = `<span>${item.label}</span>`;
            this.bindNaxtSortMenuOption(option, () => selectSort(item.value));
            menu.appendChild(option);
        });
    }

    syncQuickFilterButtons() {
        const map = {
            goat: this.quickGoatBtn,
            gems: this.quickGemsBtn,
            debated: this.quickDebatedBtn
        };
        Object.entries(map).forEach(([id, btn]) => {
            if (!btn) return;
            btn.setAttribute('data-state', this.activeQuickFilter === id ? 'on' : 'off');
        });
    }

    resetAllFilters(reload = true) {
        if (this.filterReloadTimer) {
            clearTimeout(this.filterReloadTimer);
            this.filterReloadTimer = null;
        }
        this.activeQuickFilter = '';
        this.syncQuickFilterButtons();
        this.markFilter = 'all';
        this.updateMarkFilterLabel();
        this.sortKey = 'score';
        this.randomSeed = 0;
        this.invert = false;
        if (this.invertBtn) this.invertBtn.setAttribute('data-state', 'off');
        if (this.sortSelected) this.sortSelected.textContent = 'Score';
        this.clearNaxtNumericFilters();
        this.syncFilterToggleIndicator();
        if (reload) {
            void this.reloadFromTop(false);
        }
    }

    bindNaxtSortMenuOption(option, action) {
        option.addEventListener('mousedown', (e) => {
            e.preventDefault();
        });
        option.addEventListener('click', (e) => {
            e.preventDefault();
            action();
        });
        touchSlopUtils.registerTouchSlopTracking(option);
        option.addEventListener(
            'touchend',
            (e) => {
                const maxDelta = touchSlopUtils.finalizeTouchSlop(option, e);
                if (!touchSlopUtils.isTouchSlopTap(maxDelta)) return;
                e.preventDefault();
                action();
            },
            { passive: false }
        );
        option.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                action();
            }
        });
    }

    clearNaxtNumericFilters() {
        [this.minUp, this.maxUp, this.minDown, this.maxDown, this.minScore, this.maxScore, this.minRatio, this.maxRatio].forEach((el) => {
            if (el) el.value = '';
        });
    }

    resetFiltersOnCategoryChange() {
        if (this.filterReloadTimer) {
            clearTimeout(this.filterReloadTimer);
            this.filterReloadTimer = null;
        }
        this.filterRowVisible = false;
        if (this.filterToggleBtn) this.filterToggleBtn.setAttribute('data-state', 'off');
        if (this.filterRow) this.filterRow.classList.add('hidden');
        this.sortKey = 'score';
        this.randomSeed = 0;
        this.invert = false;
        if (this.invertBtn) this.invertBtn.setAttribute('data-state', 'off');
        if (this.searchInput) this.searchInput.value = '';
        this.committedSearchQuery = '';
        this.clearNaxtNumericFilters();
        if (this.sortSelected) this.sortSelected.textContent = 'Score';
        this.activeQuickFilter = '';
        this.syncQuickFilterButtons();
        this.syncFilterToggleIndicator();
    }

    applyNaxtQuickPreset(id) {
        if (this.activeQuickFilter === id) {
            this.resetAllFilters(true);
            return;
        }
        this.filterRowVisible = false;
        if (this.filterRow) this.filterRow.classList.add('hidden');
        if (this.filterToggleBtn) this.filterToggleBtn.setAttribute('data-state', 'off');
        this.clearNaxtNumericFilters();
        this.invert = false;
        if (this.invertBtn) this.invertBtn.setAttribute('data-state', 'off');
        if (id === 'goat') {
            if (this.minUp) this.minUp.value = '15';
            if (this.minRatio) this.minRatio.value = '0.75';
            this.sortKey = 'score';
            if (this.sortSelected) this.sortSelected.textContent = 'Score';
        } else if (id === 'gems') {
            if (this.minUp) this.minUp.value = '1';
            if (this.maxUp) this.maxUp.value = '4';
            if (this.maxDown) this.maxDown.value = '0';
            this.randomSeed = (Math.random() * 2147483647) | 0;
            this.sortKey = 'random';
            if (this.sortSelected) this.sortSelected.textContent = 'Random';
        } else if (id === 'debated') {
            if (this.minUp) this.minUp.value = '5';
            if (this.minDown) this.minDown.value = '5';
            if (this.minRatio) this.minRatio.value = '0.5';
            if (this.maxRatio) this.maxRatio.value = '0.6';
            this.sortKey = 'ratio';
            if (this.sortSelected) this.sortSelected.textContent = 'Ratio';
        }
        this.activeQuickFilter = id;
        this.syncQuickFilterButtons();
        this.syncFilterToggleIndicator();
        void this.reloadFromTop(true);
    }

    renderDatasetMenu() {
        if (!this.datasetMenu) return;
        this.datasetMenu.innerHTML = '';
        const v45 = this.galleries.filter((g) => String(g.version || '').includes('4.5'));
        const v4 = this.galleries.filter((g) => !String(g.version || '').includes('4.5'));
        const groups = [];
        if (v45.length) {
            groups.push({
                group: 'v4.5',
                options: v45.map((g) => ({
                    value: g.slug,
                    label: naxtGalleryMenuLabel(g)
                }))
            });
        }
        if (v4.length) {
            groups.push({
                group: 'v4',
                options: v4.map((g) => ({
                    value: g.slug,
                    label: naxtGalleryMenuLabel(g)
                }))
            });
        }
        if (!groups.length) {
            const empty = document.createElement('div');
            empty.className = 'custom-dropdown-option disabled';
            empty.textContent = 'No datasets';
            this.datasetMenu.appendChild(empty);
            return;
        }
        if (typeof renderGroupedDropdown === 'function') {
            renderGroupedDropdown(
                this.datasetMenu,
                groups,
                (value) => {
                    const slugChanged = value !== this.selectedGallerySlug;
                    this.selectedGallerySlug = value;
                    if (slugChanged) {
                        this.resetFiltersOnCategoryChange();
                    }
                    this.updateDatasetLabelVisual(value);
                    if (typeof closeDropdown === 'function') {
                        closeDropdown(this.datasetMenu, this.datasetBtn);
                    }
                    this.reloadFromTop(true);
                },
                () => {
                    if (typeof closeDropdown === 'function') {
                        closeDropdown(this.datasetMenu, this.datasetBtn);
                    }
                },
                this.selectedGallerySlug,
                (opt) => `<span>${naxtEscapeHtml(opt.label)}</span>`
            );
        }
    }

    setupListeners() {
        if (this.backBtn) this.backBtn.addEventListener('click', () => this.goBack());
        if (this.forwardBtn) this.forwardBtn.addEventListener('click', () => this.goForward());
        if (this.homeBtn) this.homeBtn.addEventListener('click', () => void this.goHome());
        if (this.closeBtn) {
            this.closeBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.close();
            });
        }

        if (this.filterToggleBtn) {
            this.filterToggleBtn.addEventListener('click', () => {
                if (!this.filterRowVisible && this.sortKey === 'ratio') {
                    this.sortKey = 'score';
                    if (this.sortSelected) this.sortSelected.textContent = 'Score';
                    void this.reloadFromTop(false);
                    this.syncFilterToggleIndicator();
                    return;
                }
                this.filterRowVisible = !this.filterRowVisible;
                this.filterToggleBtn.setAttribute('data-state', this.filterRowVisible ? 'on' : 'off');
                if (this.filterRow) {
                    this.filterRow.classList.toggle('hidden', !this.filterRowVisible);
                }
                this.syncFilterToggleIndicator();
            });
        }

        if (this.invertBtn) {
            this.invertBtn.addEventListener('click', () => {
                if (this.sortKey === 'random') return;
                this.invert = !this.invert;
                this.invertBtn.setAttribute('data-state', this.invert ? 'on' : 'off');
                void this.reloadFromTop(true);
                this.syncFilterToggleIndicator();
            });
        }

        if (this.resetFiltersBtn) {
            this.resetFiltersBtn.addEventListener('click', () => this.resetAllFilters(true));
        }

        const quickBtnMap = [
            [this.quickGoatBtn, 'goat'],
            [this.quickGemsBtn, 'gems'],
            [this.quickDebatedBtn, 'debated']
        ];
        quickBtnMap.forEach(([btn, id]) => {
            if (!btn) return;
            btn.addEventListener('click', () => this.applyNaxtQuickPreset(id));
        });

        if (this.searchInput) {
            this.searchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.committedSearchQuery = this.searchInput ? this.searchInput.value.trim() : '';
                    void this.reloadFromTop(true);
                    this.syncFilterToggleIndicator();
                }
            });
        }

        [this.minUp, this.maxUp, this.minDown, this.maxDown, this.minScore, this.maxScore, this.minRatio, this.maxRatio].forEach((el) => {
            if (!el) return;
            el.addEventListener('input', () => {
                this.activeQuickFilter = '';
                this.syncQuickFilterButtons();
                this.scheduleFilterReload();
            });
            this.bindNumberWheel(el, null);
        });

        if (this.openCustomTagBtn) {
            this.openCustomTagBtn.addEventListener('click', () => this.openCustomTagTool());
        }
        if (this.closeCustomTagBtn) {
            this.closeCustomTagBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.closeCustomTagTool();
            });
        }
        if (this.customTagGenerateBtn) {
            this.customTagGenerateBtn.addEventListener('click', () => void this.submitCustomTag());
        }
        if (this.customTagAcceptBtn) {
            this.customTagAcceptBtn.addEventListener('click', () => void this.acceptCustomTag());
        }
        if (this.customTagDeleteBtn) {
            this.customTagDeleteBtn.addEventListener('click', () => void this.deleteCustomTag(null, null, { fromTool: true }));
        }
        if (this.customTagInput) {
            // handleCharacterAutocompleteInput / handleCharacterAutocompleteKeydown: public/scripts/comp/autocompleteUtils.js
            this.customTagInput.addEventListener('input', (e) => {
                if (typeof handleCharacterAutocompleteInput === 'function') {
                    handleCharacterAutocompleteInput(e);
                }
            });
            this.customTagInput.addEventListener('keydown', (e) => {
                if (typeof handleCharacterAutocompleteKeydown === 'function') {
                    handleCharacterAutocompleteKeydown(e);
                    if (e.defaultPrevented) {
                        return;
                    }
                }
                if (e.key === 'Enter') {
                    e.preventDefault();
                    void this.submitCustomTag();
                }
            });
        }
    }

    bindNumberWheel(el, onWheelCommit) {
        let wheelBurst = false;
        const commit = onWheelCommit || (() => this.scheduleFilterReload());
        el.addEventListener(
            'wheel',
            (e) => {
                if (!el.matches(':hover') && document.activeElement !== el) return;
                e.preventDefault();
                e.stopPropagation();
                const min = el.min !== '' ? parseFloat(el.min) : null;
                const max = el.max !== '' ? parseFloat(el.max) : null;
                const stepAttr = el.getAttribute('step');
                let step = 1;
                if (stepAttr != null && stepAttr !== '') {
                    const sp = parseFloat(stepAttr);
                    if (!Number.isNaN(sp) && sp > 0) step = sp;
                }
                let v = this.getWheelBaseNumeric(el);
                if (step !== 1) {
                    v = Math.round(v / step) * step;
                }
                const dir = e.deltaY < 0 ? 1 : -1;
                v += dir * step;
                if (min !== null && !Number.isNaN(min)) v = Math.max(min, v);
                if (max !== null && !Number.isNaN(max)) v = Math.min(max, v);
                if (step !== 1) {
                    v = Math.round(v / step) * step;
                    if (min !== null && !Number.isNaN(min)) v = Math.max(min, v);
                    if (max !== null && !Number.isNaN(max)) v = Math.min(max, v);
                }
                el.value = String(v);
                if (!wheelBurst) {
                    wheelBurst = true;
                    setTimeout(() => {
                        wheelBurst = false;
                        commit();
                    }, 0);
                }
            },
            { passive: false }
        );
    }

    getWheelBaseNumeric(el) {
        const t = String(el.value).trim();
        if (t === '') {
            if (el === this.maxUp || el === this.maxDown) return 0;
            return 0;
        }
        const n = parseFloat(t);
        return Number.isNaN(n) ? 0 : n;
    }

    setupHistoryMenus() {
        if (!this.backBtn || !contextMenu) return;
        this.backMenuConfig = {
            sections: [{ type: 'list', items: [] }],
            onAction: (action) => {
                if (action.startsWith('naxt-back-to-')) {
                    const index = parseInt(action.replace('naxt-back-to-', ''), 10);
                    this.goToHistoryIndex(index);
                }
            }
        };
        contextMenu.attachToElement(this.backBtn, this.backMenuConfig);
        this.contextMenuElements.push(this.backBtn);

        if (!this.forwardBtn) return;
        this.forwardMenuConfig = {
            sections: [{ type: 'list', items: [] }],
            onAction: (action) => {
                if (action.startsWith('naxt-forward-to-')) {
                    const index = parseInt(action.replace('naxt-forward-to-', ''), 10);
                    this.goToHistoryIndex(index);
                }
            }
        };
        contextMenu.attachToElement(this.forwardBtn, this.forwardMenuConfig);
        this.contextMenuElements.push(this.forwardBtn);
    }

    getBrowseState() {
        return {
            gallerySlug: this.selectedGallerySlug,
            query: this.committedSearchQuery,
            sortKey: this.sortKey,
            markFilter: this.markFilter,
            invert: this.invert,
            filterRowVisible: this.filterRowVisible,
            minUp: this.minUp ? this.minUp.value : '',
            maxUp: this.maxUp ? this.maxUp.value : '',
            minDown: this.minDown ? this.minDown.value : '',
            maxDown: this.maxDown ? this.maxDown.value : '',
            minScore: this.minScore ? this.minScore.value : '',
            maxScore: this.maxScore ? this.maxScore.value : '',
            minRatio: this.minRatio ? this.minRatio.value : '',
            maxRatio: this.maxRatio ? this.maxRatio.value : '',
            randomSeed: this.randomSeed,
            activeQuickFilter: this.activeQuickFilter
        };
    }

    applyBrowseState(s) {
        if (!s) return;
        this.selectedGallerySlug = s.gallerySlug || this.selectedGallerySlug;
        const q = s.query != null ? s.query : '';
        this.committedSearchQuery = String(q).trim();
        if (this.searchInput) this.searchInput.value = s.query || '';
        this.sortKey = s.sortKey || 'score';
        this.markFilter = NAXT_MARK_FILTER_OPTIONS.some((o) => o.value === s.markFilter) ? s.markFilter : 'all';
        if (this.sortKey === 'random') {
            const rs = s.randomSeed;
            if (rs != null && rs !== '' && Number.isFinite(Number(rs))) {
                this.randomSeed = Math.floor(Number(rs));
            } else {
                this.randomSeed = (Math.random() * 2147483647) | 0;
            }
        } else {
            this.randomSeed = 0;
        }
        this.invert = !!s.invert;
        this.updateMarkFilterLabel();
        this.filterRowVisible = !!s.filterRowVisible;
        if (this.filterToggleBtn) this.filterToggleBtn.setAttribute('data-state', this.filterRowVisible ? 'on' : 'off');
        if (this.filterRow) this.filterRow.classList.toggle('hidden', !this.filterRowVisible);
        if (this.invertBtn) this.invertBtn.setAttribute('data-state', this.invert ? 'on' : 'off');
        if (this.minUp) this.minUp.value = s.minUp != null ? s.minUp : '';
        if (this.maxUp) this.maxUp.value = s.maxUp != null ? s.maxUp : '';
        if (this.minDown) this.minDown.value = s.minDown != null ? s.minDown : '';
        if (this.maxDown) this.maxDown.value = s.maxDown != null ? s.maxDown : '';
        if (this.minScore) this.minScore.value = s.minScore != null ? s.minScore : '';
        if (this.maxScore) this.maxScore.value = s.maxScore != null ? s.maxScore : '';
        if (this.minRatio) this.minRatio.value = s.minRatio != null ? s.minRatio : '';
        if (this.maxRatio) this.maxRatio.value = s.maxRatio != null ? s.maxRatio : '';
        this.activeQuickFilter = s.activeQuickFilter || '';
        this.syncQuickFilterButtons();
        const sortLabels = { score: 'Score', name: 'Name', date: 'Date (export order)', ratio: 'Ratio', random: 'Random' };
        if (this.sortSelected) this.sortSelected.textContent = sortLabels[this.sortKey] || 'Score';
        this.updateDatasetLabelVisual(this.selectedGallerySlug);
        this.syncFilterToggleIndicator();
    }

    addToHistory(entry) {
        if (this.historyIndex < this.history.length - 1) {
            this.history = this.history.slice(0, this.historyIndex + 1);
        }
        this.history.push(entry);
        this.historyIndex = this.history.length - 1;
        this.updateHistoryMenus();
    }

    goToHistoryIndex(index) {
        if (index >= 0 && index < this.history.length && index !== this.historyIndex) {
            this.historyIndex = index;
            void this.restoreHistoryEntry(this.history[this.historyIndex]);
        }
    }

    goBack() {
        if (this.historyIndex > 0) {
            this.historyIndex--;
            void this.restoreHistoryEntry(this.history[this.historyIndex]);
        }
    }

    goForward() {
        if (this.historyIndex < this.history.length - 1) {
            this.historyIndex++;
            void this.restoreHistoryEntry(this.history[this.historyIndex]);
        }
    }

    async restoreHistoryEntry(entry) {
        if (!entry) return;
        if (entry.type === 'browse' && entry.state) {
            this.applyBrowseState(entry.state);
            await this.reloadFromTop(false);
        }
        this.updateHistoryMenus();
    }

    applyHomeDefaults() {
        this.filterRowVisible = false;
        if (this.filterToggleBtn) this.filterToggleBtn.setAttribute('data-state', 'off');
        if (this.filterRow) this.filterRow.classList.add('hidden');
        this.sortKey = 'score';
        this.invert = false;
        this.randomSeed = 0;
        if (this.invertBtn) this.invertBtn.setAttribute('data-state', 'off');
        if (this.searchInput) this.searchInput.value = '';
        this.committedSearchQuery = '';
        [this.minUp, this.maxUp, this.minDown, this.maxDown, this.minScore, this.maxScore, this.minRatio, this.maxRatio].forEach((el) => {
            if (el) el.value = '';
        });
        if (this.sortSelected) this.sortSelected.textContent = 'Score';
        this.activeQuickFilter = '';
        this.syncQuickFilterButtons();
        if (this.galleries.length && !this.selectedGallerySlug) {
            this.selectedGallerySlug = this.galleries[0].slug;
        }
        this.updateDatasetLabelVisual(this.selectedGallerySlug);
        this.syncFilterToggleIndicator();
    }

    async goHome() {
        this.applyHomeDefaults();
        this.history = [{ type: 'browse', state: this.getBrowseState() }];
        this.historyIndex = 0;
        await this.reloadFromTop(false);
        this.updateHistoryMenus();
    }

    updateHistoryMenus() {
        if (!contextMenu) return;
        if (this.backMenuConfig && this.backBtn) {
            const backItems = [];
            for (let i = 0; i < this.historyIndex; i++) {
                const entry = this.history[i];
                backItems.push({
                    text: this.getHistoryLabel(entry, i),
                    icon: this.getHistoryIcon(entry),
                    action: `naxt-back-to-${i}`
                });
            }
            if (!backItems.length) {
                backItems.push({ text: 'No history', icon: 'fas fa-info-circle', action: 'naxt-no', disabled: true });
            }
            this.backMenuConfig.sections[0].items = backItems;
            contextMenu.detachFromElement(this.backBtn);
            contextMenu.attachToElement(this.backBtn, this.backMenuConfig);
        }
        if (this.forwardMenuConfig && this.forwardBtn) {
            const forwardItems = [];
            for (let i = this.historyIndex + 1; i < this.history.length; i++) {
                const entry = this.history[i];
                forwardItems.push({
                    text: this.getHistoryLabel(entry, i),
                    icon: this.getHistoryIcon(entry),
                    action: `naxt-forward-to-${i}`
                });
            }
            if (!forwardItems.length) {
                forwardItems.push({ text: 'No history', icon: 'fas fa-info-circle', action: 'naxt-no', disabled: true });
            }
            this.forwardMenuConfig.sections[0].items = forwardItems;
            contextMenu.detachFromElement(this.forwardBtn);
            contextMenu.attachToElement(this.forwardBtn, this.forwardMenuConfig);
        }
    }

    getHistoryLabel(entry, index) {
        if (!entry) return `Entry ${index + 1}`;
        if (entry.type === 'browse' && entry.state) {
            const slug = entry.state.gallerySlug || '';
            const name = slug ? naxtGalleryBucketLabel(slug, this.galleries) : '';
            const q = (entry.state.query || '').trim();
            return q ? `${name}: ${q}` : name || `Browse ${index + 1}`;
        }
        return `Entry ${index + 1}`;
    }

    getHistoryIcon(entry) {
        if (!entry || entry.type !== 'browse' || !entry.state) return 'fas fa-grid';
        return naxtGalleryIconClass(entry.state.gallerySlug || '');
    }

    async ensureGalleries() {
        if (this.galleries.length) return;
        if (!window.wsClient || !window.wsClient.isConnected()) {
            if (typeof showGlassToast === 'function') {
                showGlassToast('error', null, 'WebSocket not connected', false, 4000, '<i class="fas fa-plug"></i>');
            }
            return;
        }
        try {
            const data = await window.wsClient.sendMessage('get_nax_galleries', {}, false);
            this.galleries = (data && data.galleries) || [];
            if (!this.selectedGallerySlug && this.galleries.length) {
                this.selectedGallerySlug = this.galleries[0].slug;
            }
            this.updateDatasetLabelVisual(this.selectedGallerySlug);
            this.syncFilterToggleIndicator();
        } catch (e) {
            console.error('get_nax_galleries', e);
            this.galleries = [];
            this.updateEmptyState();
        }
    }

    async open() {
        if (!this.modal) return;
        await this.ensureGalleries();
        const wasNew = this.history.length === 0;
        if (wasNew) {
            this.applyHomeDefaults();
            if (!this.selectedGallerySlug && this.galleries.length) {
                this.selectedGallerySlug = this.galleries[0].slug;
            }
            this.updateDatasetLabelVisual(this.selectedGallerySlug);
        }
        if (typeof openModal === 'function') {
            openModal(this.modal);
        }
        setTimeout(() => {
            if (window.customScrollbar) {
                const body = this.modal.querySelector('.naxt-body.form-section-scroll');
                if (body) window.customScrollbar.forceReinit(body);
            }
            this.setupSentinelObserver();
            this.setupImgObserver();
        }, 80);
        await this.reloadFromTop(false);
        if (wasNew) {
            this.history = [{ type: 'browse', state: this.getBrowseState() }];
            this.historyIndex = 0;
        }
        this.updateHistoryMenus();
        this.syncFilterToggleIndicator();
        this.updateStatusBar();
    }

    close() {
        if (!this.modal || typeof closeModal !== 'function') return;
        closeModal(this.modal).then(() => {
            this.history = [];
            this.historyIndex = -1;
            if (this.grid) this.grid.innerHTML = '';
        });
    }

    setupSentinelObserver() {
        const root = this.getScrollRoot();
        if (!this.sentinel || !root) return;
        if (this.sentinelObserver) this.sentinelObserver.disconnect();
        this.sentinelObserver = new IntersectionObserver(
            (entries) => {
                for (const en of entries) {
                    if (en.isIntersecting) this.loadMore();
                }
            },
            { root, rootMargin: '240px', threshold: 0 }
        );
        this.sentinelObserver.observe(this.sentinel);
    }

    setupImgObserver() {
        const root = this.getScrollRoot();
        if (!root || !this.grid) return;
        if (this.imgVisibilityObserver) this.imgVisibilityObserver.disconnect();
        this.imgVisibilityObserver = new IntersectionObserver(
            (entries) => {
                for (const en of entries) {
                    const img = en.target;
                    if (!(img instanceof HTMLImageElement)) continue;
                    if (en.isIntersecting) {
                        const ds = img.getAttribute('data-src');
                        if (ds && !img.getAttribute('src')) {
                            img.src = ds;
                        }
                    } else if (img.getAttribute('src')) {
                        img.removeAttribute('src');
                    }
                }
            },
            { root, rootMargin: '80px', threshold: 0 }
        );
        this.grid.querySelectorAll('.naxt-card-img').forEach((img) => this.imgVisibilityObserver.observe(img));
    }

    observeNewImages() {
        if (!this.imgVisibilityObserver || !this.grid) return;
        this.grid.querySelectorAll('.naxt-card-img:not([data-naxt-obs])').forEach((img) => {
            img.setAttribute('data-naxt-obs', '1');
            this.imgVisibilityObserver.observe(img);
        });
    }

    async reloadFromTop(pushHistory) {
        this.offset = 0;
        this.hasMore = true;
        if (this.grid) this.grid.innerHTML = '';
        await this.loadPage(false, pushHistory);
    }

    loadMore() {
        if (!this.hasMore || this.loading) return;
        this.loadPage(true, false);
    }

    numOrNull(el) {
        if (!el) return null;
        const t = String(el.value).trim();
        if (t === '') return null;
        const n = Number(t);
        return Number.isNaN(n) ? null : n;
    }

    async loadPage(append, pushHistory) {
        if (!this.selectedGallerySlug || !window.wsClient || !window.wsClient.isConnected()) {
            this.updateEmptyState();
            this.updateStatusBar();
            return;
        }
        this.loading = true;
        this.loadRequestsActive++;
        this.setGridLoading(true);
        const gen = ++this.requestGen;
        const payload = {
            gallerySlug: this.selectedGallerySlug,
            query: this.committedSearchQuery,
            sort: this.sortKey,
            markFilter: this.markFilter,
            invert: this.invert,
            minUp: this.numOrNull(this.minUp),
            maxUp: this.numOrNull(this.maxUp),
            minDown: this.numOrNull(this.minDown),
            maxDown: this.numOrNull(this.maxDown),
            minScore: this.numOrNull(this.minScore),
            maxScore: this.numOrNull(this.maxScore),
            minRatio: this.numOrNull(this.minRatio),
            maxRatio: this.numOrNull(this.maxRatio),
            offset: append ? this.offset : 0,
            limit: 50
        };
        if (this.sortKey === 'random') {
            payload.randomSeed = this.randomSeed;
        }
        try {
            const data = await window.wsClient.sendMessage('get_nax_tags', payload, !append);
            if (gen !== this.requestGen) return;
            const items = (data && data.items) || [];
            this.total = (data && data.total) || 0;
            this.hasMore = !!(data && data.hasMore);
            if (!append) {
                this.offset = 0;
                if (this.grid) this.grid.innerHTML = '';
            }
            if (this.grid) {
                for (const it of items) {
                    this.grid.appendChild(this.createCard(it));
                }
            }
            this.offset += items.length;
            this.updateEmptyState();
            if (pushHistory) {
                this.addToHistory({ type: 'browse', state: this.getBrowseState() });
            }
            this.observeNewImages();
            this.updateStatusBar();
        } catch (e) {
            console.error('get_nax_tags', e);
            if (typeof showGlassToast === 'function') {
                showGlassToast('error', null, e.message || 'Failed to load tags', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
            }
            if (!append) {
                this.updateEmptyState();
            }
        } finally {
            this.loading = false;
            this.loadRequestsActive = Math.max(0, this.loadRequestsActive - 1);
            if (this.loadRequestsActive === 0) {
                this.setGridLoading(false);
            }
            this.updateHistoryMenus();
            this.syncFilterToggleIndicator();
        }
    }

    updateStatusBar() {
        if (!this.statusBar) return;
        const shown = this.offset;
        const tot = this.total;
        if (!shown && !tot) {
            this.statusBar.textContent = '0 tags';
            return;
        }
        this.statusBar.textContent = `Showing ${shown} of ${tot} tags`;
    }

    updateEmptyState() {
        if (!this.emptyState) return;
        const hasItems = this.offset > 0;
        if (hasItems) {
            this.emptyState.classList.add('hidden');
            return;
        }
        this.emptyState.classList.remove('hidden');
        const noDb = !this.galleries.length;
        if (this.emptySetup) {
            this.emptySetup.classList.toggle('hidden', !noDb);
        }
        if (this.emptyNoResults) {
            this.emptyNoResults.classList.toggle('hidden', noDb);
        }
    }

    imageUrl(item) {
        const slug = encodeURIComponent(item.gallerySlug);
        const file = encodeURIComponent(item.filename);
        return `/naxCache/${slug}/${file}`;
    }

    syncNaxtTagTargetDataset(el, entry, bagIndex) {
        if (!el || !entry) return;
        el.dataset.tag = entry.tag;
        el.dataset.gallerySlug = entry.gallerySlug;
        el.dataset.filename = entry.filename;
        if (bagIndex != null) {
            el.dataset.bagIndex = String(bagIndex);
        } else {
            delete el.dataset.bagIndex;
        }
        const card = this.findVisibleCard(entry.gallerySlug, entry.tag);
        el.dataset.favorite = card && card.dataset.favorite === '1' ? '1' : '0';
        el.dataset.try = card && card.dataset.try === '1' ? '1' : '0';
        if (card && card.dataset.isCustom === '1') {
            el.dataset.isCustom = '1';
        } else {
            delete el.dataset.isCustom;
        }
    }

    buildNaxtTagPreviewSection() {
        return {
            type: 'custom',
            initfn: (section, target) => {
                section.hidden = !(target && target.dataset && target.dataset.gallerySlug && target.dataset.filename);
            },
            content: (target) => {
                if (!target || !target.dataset || !target.dataset.gallerySlug || !target.dataset.filename) {
                    return '';
                }
                const container = document.createElement('div');
                container.className = 'dyn-gen-preview-container';
                container.style.cssText = 'padding: 4px 8px 0 8px; display: flex; justify-content: center; align-items: center; min-height: 175px; flex-shrink: 0;';

                const img = document.createElement('img');
                img.src = this.imageUrl({
                    gallerySlug: target.dataset.gallerySlug,
                    filename: target.dataset.filename
                });
                img.alt = target.dataset.tag || 'Tag preview';
                img.style.cssText = 'max-width: 100%; max-height: 175px; border-radius: 4px; object-fit: contain; cursor: pointer;';
                img.loading = 'lazy';

                img.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (contextMenu) contextMenu.hideMenu();
                    this.openNaxItemInViewer({
                        tag: target.dataset.tag,
                        gallerySlug: target.dataset.gallerySlug,
                        filename: target.dataset.filename,
                        favorite: target.dataset.favorite === '1',
                        tryMark: target.dataset.try === '1'
                    });
                });

                img.onerror = function () {
                    container.style.minHeight = 'auto';
                    container.innerHTML = '<div style="padding: 8px; text-align: center; color: var(--text-muted);">Preview not available</div>';
                };

                container.appendChild(img);
                return container;
            }
        };
    }

    buildNaxtTagContextMenuConfig(options = {}) {
        const inBag = !!options.inBag;
        const manualModal = document.getElementById('manualModal');
        const bagIcon = inBag
            ? {
                icon: 'fas fa-shopping-bag',
                tooltip: 'Remove from bag',
                action: 'naxt-remove-bag'
            }
            : {
                icon: 'fas fa-shopping-bag',
                tooltip: 'Add to bag',
                action: 'naxt-add-bag'
            };

        const listItems = [
            {
                text: 'PhaseWalker',
                icon: 'fas fa-layer-group',
                openOnHover: true,
                optionsfn: (target) => {
                    const tagText = target && target.dataset && target.dataset.tag;
                    // buildPhasewalkerContextSubmenuItems: public/scripts/comp/runCommandIndex.js
                    if (typeof buildPhasewalkerContextSubmenuItems === 'function' && tagText) {
                        return buildPhasewalkerContextSubmenuItems(tagText);
                    }
                    return [{ text: 'Unavailable', disabled: true }];
                },
                handlerfn: (subItem) => {
                    // handlePhasewalkerContextSubmenuAction: public/scripts/comp/runCommandIndex.js
                    if (handlePhasewalkerContextSubmenuAction) {
                        handlePhasewalkerContextSubmenuAction(subItem);
                    }
                }
            },
            {
                text: 'Add to Prompt',
                icon: 'fas fa-plus',
                action: 'naxt-add-prompt',
                disabled: () => manualModal && manualModal.classList.contains('hidden')
            },
            {
                text: 'Replace in Prompt',
                icon: 'fas fa-arrows-rotate',
                action: 'naxt-replace-prompt',
                disabled: () => manualModal && manualModal.classList.contains('hidden')
            },
            {
                text: 'Add to Desktop',
                icon: 'fas fa-arrow-down-left',
                action: 'naxt-add-desktop',
                hidden: () => !document.body.classList.contains('desktop-mode')
            }
        ];

        if (inBag) {
            listItems.push({
                text: 'Remove from bag',
                icon: 'fas fa-trash',
                action: 'naxt-remove-bag'
            });
        }

        if (options.isCustom) {
            listItems.push({
                text: 'Delete custom tag',
                icon: 'fas fa-trash',
                action: 'naxt-delete-custom'
            });
        }

        return {
            sections: [
                this.buildNaxtTagPreviewSection(),
                {
                    type: 'icons',
                    position: 'outer',
                    icons: [
                        {
                            icon: 'fa-regular fa-star',
                            tooltip: 'Favorite',
                            action: 'naxt-fav',
                            loadfn: (iconDef, target) => {
                                const fav = target && target.dataset && target.dataset.favorite === '1';
                                iconDef.icon = fav ? 'fas fa-star' : 'fa-regular fa-star';
                                iconDef.tooltip = fav ? 'Unfavorite' : 'Favorite';
                            }
                        },
                        {
                            icon: 'fas fa-flask',
                            tooltip: 'Try',
                            action: 'naxt-try',
                            loadfn: (iconDef, target) => {
                                const on = target && target.dataset && target.dataset.try === '1';
                                iconDef.icon = on ? 'fas fa-flask' : 'far fa-flask';
                                iconDef.tooltip = on ? 'Remove try mark' : 'Mark to try';
                            }
                        },
                        bagIcon,
                        {
                            icon: 'nai-clipboard',
                            tooltip: 'Copy tag',
                            action: 'naxt-copy'
                        }
                    ]
                },
                {
                    type: 'list',
                    items: listItems
                }
            ],
            onAction: (action, target) => this.handleNaxtTagContextMenuAction(action, target)
        };
    }

    handleNaxtTagContextMenuAction(action, target) {
        if (!target || !target.dataset) return;
        const { tag, gallerySlug, filename, bagIndex } = target.dataset;
        if (action === 'naxt-add-prompt') {
            this.addToPrompt(tag, gallerySlug, 'add');
        } else if (action === 'naxt-replace-prompt') {
            this.addToPrompt(tag, gallerySlug, 'replace');
        } else if (action === 'naxt-add-bag') {
            void this.addToBag(tag, gallerySlug, filename);
        } else if (action === 'naxt-remove-bag') {
            const index = parseInt(bagIndex, 10);
            if (!Number.isNaN(index)) {
                this.removeFromBagAt(index);
                if (typeof closeDropdown === 'function' && this.bagMenu && this.bagBtn) {
                    closeDropdown(this.bagMenu, this.bagBtn);
                }
            }
        } else if (action === 'naxt-add-desktop') {
            this.addNaxTagToDesktop(target);
        } else if (action === 'naxt-copy') {
            this.copyTag(tag);
        } else if (action === 'naxt-fav') {
            void this.toggleFavorite(target);
        } else if (action === 'naxt-try') {
            void this.toggleTry(target);
        } else if (action === 'naxt-delete-custom') {
            void this.deleteCustomTag(gallerySlug, tag);
        }
    }

    attachNaxtTagContextMenu(el, options) {
        if (!el || !contextMenu) return;
        if (typeof contextMenu.detachFromElement === 'function') {
            contextMenu.detachFromElement(el);
        }
        contextMenu.attachToElement(el, this.buildNaxtTagContextMenuConfig(options));
    }

    createCard(item) {
        const card = document.createElement('div');
        card.className = 'naxt-card';
        card.dataset.tag = item.tag;
        card.dataset.gallerySlug = item.gallerySlug;
        card.dataset.filename = item.filename;
        card.dataset.favorite = item.favorite ? '1' : '0';
        card.dataset.try = item.tryMark ? '1' : '0';
        card.dataset.id = String(item.id);
        if (item.isCustom) {
            card.dataset.isCustom = '1';
        }

        const wrap = document.createElement('div');
        wrap.className = 'naxt-card-img-wrap';
        const img = document.createElement('img');
        img.className = 'naxt-card-img';
        img.alt = item.tag;
        img.decoding = 'async';
        img.loading = 'lazy';
        img.setAttribute('data-src', this.imageUrl(item));

        wrap.appendChild(img);

        if (!item.isCustom) {
            const votes = document.createElement('div');
            votes.className = 'naxt-card-votes';
            votes.innerHTML = `<span><i class="fas fa-arrow-up"></i>${item.upvotes}</span><span><i class="fas fa-arrow-down"></i>${item.downvotes}</span>`;
            wrap.appendChild(votes);
        }

        const cap = document.createElement('div');
        cap.className = 'naxt-card-caption';
        cap.textContent = item.tag;

        card.appendChild(wrap);
        card.appendChild(cap);

        const openCard = () => {
            this.openInWindow(card);
        };
        card.addEventListener('click', openCard);
        if (typeof touchSlopUtils !== 'undefined') {
            touchSlopUtils.registerTouchSlopTracking(card);
            card.addEventListener('touchend', (e) => {
                const maxDelta = touchSlopUtils.finalizeTouchSlop(card, e);
                if (!touchSlopUtils.isTouchSlopTap(maxDelta)) {
                    return;
                }
                e.preventDefault();
                openCard();
            }, { passive: false });
        }

        this.attachNaxtTagContextMenu(card, { inBag: false, isCustom: !!item.isCustom });

        return card;
    }

    addToPrompt(tagName, gallerySlug, mode) {
        const manualModal = document.getElementById('manualModal');
        const manualPrompt = document.getElementById('manualPrompt');
        if (!manualPrompt) return;
        if (manualModal && manualModal.classList.contains('hidden')) {
            if (typeof showGlassToast === 'function') {
                showGlassToast('info', null, 'Open the editor first', false, 3000, '<i class="fas fa-info-circle"></i>');
            }
            return;
        }
        const replaceMode = mode === 'replace';
        const sl = String(gallerySlug || '').toLowerCase();
        const fragment = naxtFormatTagFragment(tagName, gallerySlug);
        const currentValue = manualPrompt.value || '';
        let nextValue = currentValue;
        let replacedArtist = false;

        if (sl.includes('artist') && replaceMode) {
            const { tagsPart, textSuffix } = naxtSplitPromptTagsAndText(currentValue);
            const tail = naxtMatchTrailingArtistSegment(tagsPart);
            if (tail) {
                const newFrag = naxtApplyEmphasisToFragment(fragment, tail.bias);
                nextValue = naxtMergeTagsPartAndTextSuffix(
                    tail.prefix ? `${tail.prefix}, ${newFrag}` : newFrag,
                    textSuffix
                );
                replacedArtist = true;
            } else {
                const newTagsPart = naxtReplaceLastTagInTagsPart(tagsPart, fragment);
                nextValue = naxtMergeTagsPartAndTextSuffix(newTagsPart, textSuffix);
            }
        } else if (replaceMode) {
            const { tagsPart, textSuffix } = naxtSplitPromptTagsAndText(currentValue);
            const newTagsPart = naxtReplaceLastTagInTagsPart(tagsPart, fragment);
            nextValue = naxtMergeTagsPartAndTextSuffix(newTagsPart, textSuffix);
        } else {
            const sep = currentValue.trim() && !currentValue.trim().endsWith(',') ? ', ' : '';
            nextValue = currentValue + sep + fragment;
        }

        // setTextareaValuePreservingUndo: public/scripts/comp/textareaUtils.js
        setTextareaValuePreservingUndo(manualPrompt, nextValue);

        if (typeof hideCharacterAutocomplete === 'function') hideCharacterAutocomplete();
        const prevAutofill =
            typeof isAutofillEnabled === 'function' ? isAutofillEnabled() : true;
        if (typeof setAutofillEnabled === 'function') setAutofillEnabled(false);
        try {
            manualPrompt.dispatchEvent(new Event('input', { bubbles: true }));
        } finally {
            if (typeof setAutofillEnabled === 'function') setAutofillEnabled(prevAutofill);
        }
        if (typeof updateEmphasisHighlighting === 'function') updateEmphasisHighlighting(manualPrompt);
        if (typeof applyFormattedText === 'function') applyFormattedText(manualPrompt, true);
        if (typeof autoResizeTextarea === 'function') autoResizeTextarea(manualPrompt);

        void this.clearTryMark(gallerySlug, tagName);

        if (typeof showGlassToast === 'function') {
            let msg = `Added "${tagName}" to prompt`;
            if (replaceMode) {
                msg = replacedArtist ? `Replaced artist with "${tagName}"` : `Replaced tag with "${tagName}"`;
            }
            showGlassToast('success', null, msg, false, 2500, '<i class="fas fa-check"></i>');
        }
    }

    copyTag(tag) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(tag).then(() => {
                if (typeof showGlassToast === 'function') {
                    showGlassToast('success', null, `Copied "${tag}" to clipboard`, false, 2000, '<i class="fas fa-check"></i>');
                }
            });
        }
    }

    async addNaxTagToDesktop(card) {
        if (!card || !card.dataset) return;
        const tag = card.dataset.tag;
        const gallerySlug = card.dataset.gallerySlug;
        const filename = card.dataset.filename;
        if (!tag || !gallerySlug || !filename) return;

        try {
            if (typeof desktopShortcuts !== 'undefined' && desktopShortcuts.addShortcut) {
                await desktopShortcuts.addShortcut({
                    name: tag,
                    type: 'nax-tag',
                    data: { tag, gallerySlug, filename }
                });
                if (typeof showGlassToast === 'function') {
                    showGlassToast('success', null, 'Tag added to desktop', false, 3000, '<i class="fas fa-arrow-down-left"></i>');
                }
            } else if (typeof showGlassToast === 'function') {
                showGlassToast('error', 'Error', 'Desktop shortcuts not available', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
            }
        } catch (error) {
            console.error('Failed to add NAX tag to desktop:', error);
            if (typeof showGlassToast === 'function') {
                showGlassToast('error', 'Error', 'Failed to add tag shortcut', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
            }
        }
    }

    applyFavoriteToCard(card, favorite) {
        if (!card) return;
        card.dataset.favorite = favorite ? '1' : '0';
    }

    async toggleFavorite(target) {
        const slug = target.dataset.gallerySlug;
        const tag = target.dataset.tag;
        const next = target.dataset.favorite !== '1';
        await this.setFavoriteForTag(slug, tag, next);
        target.dataset.favorite = next ? '1' : '0';
    }

    async toggleTry(target) {
        const slug = target.dataset.gallerySlug;
        const tag = target.dataset.tag;
        const next = target.dataset.try !== '1';
        await this.setTryMarkForTag(slug, tag, next);
        target.dataset.try = next ? '1' : '0';
    }

    openInWindow(card) {
        this.openNaxItemInViewer({
            gallerySlug: card.dataset.gallerySlug,
            filename: card.dataset.filename,
            tag: card.dataset.tag,
            favorite: card.dataset.favorite === '1',
            tryMark: card.dataset.try === '1'
        });
    }
}

const naxtApplet = new NaxtApplet();
if (typeof window !== 'undefined') {
    window.naxtApplet = naxtApplet;
}
