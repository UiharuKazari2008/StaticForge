/**
 * NAXT applet — NAX community tag browser (WebSocket data, GET only for images).
 * public/scripts/comp/modalUtils.js (openModal), public/scripts/comp/dropdown.js (setupDropdown), public/scripts/comp/contextMenu.js (attachClickMenuToElement)
 */

const NAXT_FILTER_DEBOUNCE_MS = 2000;
const NAXT_TAG_BAG_LS = 'naxtTagBag';
const NAXT_ELEVATE_PINS_LS = 'naxtElevatePins';

const NAXT_ELEVATE_PIN_OPTIONS = [
    { value: 0, label: 'None', icon: 'fa-regular fa-thumbtack' },
    { value: 1, label: 'Favorites', icon: 'fas fa-star' },
    { value: 2, label: 'Try', icon: 'fas fa-vial' },
    { value: 3, label: 'Both', icon: 'fas fa-thumbtack' }
];

function naxtNormalizeElevatePins(value) {
    if (value === true || value === 'true') return 1;
    const n = Number(value);
    if (n === 1 || n === 2 || n === 3) return n;
    return 0;
}

const NAXT_QUICK_FILTERS = [
    { id: 'goat', btnId: 'naxtQuickGoatBtn' },
    { id: 'gems', btnId: 'naxtQuickGemsBtn' },
    { id: 'debated', btnId: 'naxtQuickDebatedBtn' }
];

const NAXT_MARK_FILTER_OPTIONS = [
    { value: 'all', label: 'Show All', icon: 'fa-regular fa-bookmark' },
    { value: 'favorites', label: 'Favorites', icon: 'fas fa-star' },
    { value: 'try', label: 'Try', icon: 'fas fa-vial' },
    { value: 'unmarked', label: 'Unmarked', icon: 'fas fa-empty-set' },
    { value: 'custom', label: 'Custom', icon: 'fas fa-user-plus' },
    { value: 'hidden', label: 'Hidden', icon: 'fas fa-trash' }
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
        this.browseSessionActive = false;
        this.galleries = [];
        this.selectedGallerySlug = '';
        this.sortKey = 'score';
        this.markFilter = 'all';
        this.elevatePins = 0;
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
        this.sentinelObserver = null;
        this.imgVisibilityObserver = null;
        this.customTagGenerating = false;
        this.pendingCustomTag = null;
        this.pendingCustomTagAlreadyExists = false;
        this.activeQuickFilter = '';
        this.init();
    }

    init() {
        this.modal = document.getElementById('naxtModal');
        if (!this.modal) return;

        this.homeBtn = document.getElementById('naxtHomeBtn');
        this.closeBtn = document.getElementById('closeNaxtModalBtn');
        this.datasetBtn = document.getElementById('naxtDatasetDropdownBtn');
        this.datasetSelected = document.getElementById('naxtDatasetSelected');
        this.searchInput = document.getElementById('naxtSearchInput');
        this.refreshBtn = document.getElementById('naxtRefreshBtn');
        this.filterToggleBtn = document.getElementById('naxtFilterToggleBtn');
        this.filterToolbar = document.getElementById('naxtFilterToolbar');
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
        this.customTagPreviewContainer = document.getElementById('naxtCustomTagPreviewContainer');
        this.customTagPreviewPlaceholder = document.getElementById('naxtCustomTagPreviewPlaceholder');
        this.customTagPreviewLoading = document.getElementById('naxtCustomTagPreviewLoading');
        this.customTagPreviewError = document.getElementById('naxtCustomTagPreviewError');
        this.customTagPreviewImg = document.getElementById('naxtCustomTagPreviewImg');
        this.customTagPreviewCaption = document.getElementById('naxtCustomTagPreviewCaption');
        this.customTagOverlayButtons = document.getElementById('naxtCustomTagOverlayButtons');
        this.customTagFavoriteBtn = document.getElementById('naxtCustomTagFavoriteBtn');
        this.customTagTryBtn = document.getElementById('naxtCustomTagTryBtn');
        this.customTagGenerateBtn = document.getElementById('naxtCustomTagGenerateBtn');
        this.customTagDeleteBtn = document.getElementById('naxtCustomTagDeleteBtn');
        this.closeCustomTagBtn = document.getElementById('closeNaxtCustomTagModalBtn');
        this.bagBtn = document.getElementById('naxtBagDropdownBtn');
        this.bagCountEl = document.getElementById('naxtBagCount');
        this.bagTrayEl = document.getElementById('naxtBagTrayIcon');
        this.bagTrayGlyph = document.getElementById('naxtBagTrayIconGlyph');
        this.markFilterBtn = document.getElementById('naxtMarkFilterDropdownBtn');
        this.markFilterIcon = document.getElementById('naxtMarkFilterIcon');
        this.elevatePinsBtn = document.getElementById('naxtElevatePinsDropdownBtn');
        this.elevatePinsIcon = document.getElementById('naxtElevatePinsIcon');

        this.loadBagFromStorage();
        this.loadElevatePinsFromLocal();
        this.setupClickMenus();
        this.setupListeners();
        this.updateBagChrome();
        this.updateMarkFilterButton();
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
        this.datasetSelected.innerHTML = `<i class="${naxtEscapeHtml(icon)} naxt-dataset-btn-icon" aria-hidden="true"></i>`;
        if (this.datasetBtn) {
            this.datasetBtn.title = label;
        }
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
        this.pendingCustomTagAlreadyExists = false;
        if (this.customTagInput) {
            this.customTagInput.value = '';
            this.customTagInput.disabled = false;
        }
        this.setCustomTagPreviewState('empty');
        this.syncCustomTagControls();
    }

    setCustomTagPreviewState(state, message = '') {
        const show = (el, visible) => {
            if (el) el.classList.toggle('hidden', !visible);
        };

        show(this.customTagPreviewPlaceholder, state === 'empty');
        show(this.customTagPreviewLoading, state === 'loading');
        show(this.customTagPreviewError, state === 'error');
        show(this.customTagPreviewImg, state === 'preview');
        show(this.customTagPreviewCaption, state === 'preview');

        if (this.customTagPreviewContainer) {
            this.customTagPreviewContainer.classList.toggle('has-preview', state === 'preview');
            this.customTagPreviewContainer.onclick = null;
        }
        if (this.customTagPreviewError && state === 'error') {
            this.customTagPreviewError.textContent = message || 'Generation failed';
        }
        if (this.customTagOverlayButtons) {
            this.customTagOverlayButtons.classList.toggle('hidden', state !== 'preview');
        }
    }

    syncCustomTagControls() {
        const generating = this.customTagGenerating;
        if (this.customTagGenerateBtn) {
            this.customTagGenerateBtn.disabled = generating;
        }
        if (this.customTagInput) {
            this.customTagInput.disabled = generating;
        }
        if (this.customTagDeleteBtn) {
            const canDelete = !!(this.pendingCustomTag && this.pendingCustomTag.isCustom);
            this.customTagDeleteBtn.disabled = generating || !this.pendingCustomTag || !canDelete;
            this.customTagDeleteBtn.title = canDelete ? 'Delete tag' : 'Only custom tags can be deleted';
        }
        this.syncCustomTagOverlayButtons();
    }

    syncCustomTagOverlayButtons() {
        const item = this.pendingCustomTag;
        const favorite = !!(item && item.favorite);
        const tryMark = !!(item && item.tryMark);

        if (this.customTagFavoriteBtn) {
            this.customTagFavoriteBtn.dataset.state = favorite ? 'on' : 'off';
            const icon = this.customTagFavoriteBtn.querySelector('i');
            if (icon) {
                icon.className = favorite ? 'fas fa-star' : 'fa-regular fa-star';
            }
            this.customTagFavoriteBtn.title = favorite ? 'Unfavorite' : 'Favorite';
        }
        if (this.customTagTryBtn) {
            this.customTagTryBtn.dataset.state = tryMark ? 'on' : 'off';
            const icon = this.customTagTryBtn.querySelector('i');
            if (icon) {
                icon.className = tryMark ? 'fas fa-vial-circle-check' : 'fas fa-vial';
            }
            this.customTagTryBtn.title = tryMark ? 'Remove try mark' : 'Mark to try';
        }
    }

    setCustomTagGenerating(active) {
        this.customTagGenerating = !!active;
        if (active) {
            this.setCustomTagPreviewState('loading');
            if (typeof hideCharacterAutocomplete === 'function') {
                hideCharacterAutocomplete();
            }
        }
        this.syncCustomTagControls();
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

    showCustomTagPreview(item, opts = {}) {
        if (!item) return;
        const alreadyExists = !!opts.alreadyExists;
        this.pendingCustomTag = item;
        this.pendingCustomTagAlreadyExists = alreadyExists;

        if (this.customTagInput && item.tag) {
            this.customTagInput.value = item.tag;
        }
        if (typeof hideCharacterAutocomplete === 'function') {
            hideCharacterAutocomplete();
        }

        if (this.customTagPreviewImg) {
            this.customTagPreviewImg.src = this.imageUrl(item);
            this.customTagPreviewImg.alt = item.tag || 'Tag preview';
        }
        if (this.customTagPreviewCaption) {
            this.customTagPreviewCaption.textContent = alreadyExists
                ? `${item.tag} — already in gallery`
                : item.tag;
            this.customTagPreviewCaption.classList.toggle('is-notice', alreadyExists);
        }

        this.setCustomTagPreviewState('preview');
        if (this.customTagPreviewContainer) {
            this.customTagPreviewContainer.onclick = () => this.openNaxItemInViewer(item);
        }
        this.syncCustomTagControls();
    }

    validateCustomTagInput(raw) {
        const value = String(raw || '').trim();
        if (!value) {
            return { ok: false, message: 'Enter a tag name' };
        }
        if (value.includes(',')) {
            return { ok: false, message: 'Enter a single tag only (no commas)' };
        }
        if (value.length > 120) {
            return { ok: false, message: 'Tag name is too long' };
        }
        if (value.includes('..') || /[\x00-\x1f\/\\]/.test(value)) {
            return { ok: false, message: 'Invalid tag name' };
        }
        return { ok: true, value };
    }

    customTagInputLooksLikeTextExpander(raw) {
        return String(raw || '').trim().startsWith('!');
    }

    async confirmCustomTagTextExpanderUse(tagName) {
        // showConfirmationDialog: public/scripts/comp/confirmationDialog.js
        const result = await showConfirmationDialog(
            `The tag "${tagName}" starts with "!". In prompts that can be treated as a text expander. Use this tag name anyway?`,
            [
                { text: 'Use anyway', value: 'confirm', className: 'btn-primary', primary: true },
                { text: 'Cancel', value: null, className: 'btn-secondary' }
            ]
        );
        return result === 'confirm';
    }

    async submitCustomTag() {
        if (this.customTagGenerating || !this.customTagInput) return;
        const validation = this.validateCustomTagInput(this.customTagInput.value);
        if (!validation.ok) {
            if (typeof showGlassToast === 'function') {
                showGlassToast('error', null, validation.message, false, 4000, '<i class="fas fa-exclamation-triangle"></i>');
            }
            this.setCustomTagPreviewState('error', validation.message);
            return;
        }
        const raw = validation.value;
        if (this.customTagInputLooksLikeTextExpander(raw)) {
            const confirmed = await this.confirmCustomTagTextExpanderUse(raw);
            if (!confirmed) {
                return;
            }
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
            this.showCustomTagPreview(item, { alreadyExists: !!data.alreadyExists });
            if (data.alreadyExists) {
                if (typeof showGlassToast === 'function') {
                    showGlassToast('info', null, 'Tag already exists in this gallery', false, 3500, '<i class="fas fa-info-circle"></i>');
                }
            } else {
                await this.reloadFromTop();
            }
        } catch (e) {
            this.setCustomTagPreviewState('error', e.message || 'Generation failed');
            if (typeof showGlassToast === 'function') {
                showGlassToast('error', null, e.message || 'Generation failed', false, 6000, '<i class="fas fa-exclamation-triangle"></i>');
            }
        } finally {
            this.customTagGenerating = false;
            this.syncCustomTagControls();
        }
    }

    async toggleCustomTagFavorite() {
        if (!this.pendingCustomTag) return;
        const { gallerySlug, tag } = this.pendingCustomTag;
        const next = !this.pendingCustomTag.favorite;
        await this.setFavoriteForTag(gallerySlug, tag, next);
        this.pendingCustomTag.favorite = next;
        this.syncCustomTagOverlayButtons();
    }

    async toggleCustomTagTry() {
        if (!this.pendingCustomTag) return;
        const { gallerySlug, tag } = this.pendingCustomTag;
        const next = !this.pendingCustomTag.tryMark;
        await this.setTryMarkForTag(gallerySlug, tag, next);
        this.pendingCustomTag.tryMark = next;
        this.syncCustomTagOverlayButtons();
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
        if (fromTool && this.customTagDeleteBtn) this.customTagDeleteBtn.disabled = true;

        try {
            await window.wsClient.sendMessage('delete_nax_custom_tag', {
                gallerySlug: slug,
                tag: tagName
            }, false);
            if (fromTool) {
                const keepTag = this.customTagInput ? this.customTagInput.value : tagName;
                this.pendingCustomTag = null;
                this.pendingCustomTagAlreadyExists = false;
                this.setCustomTagPreviewState('empty');
                if (this.customTagInput) {
                    this.customTagInput.value = keepTag;
                    this.customTagInput.disabled = false;
                }
                this.syncCustomTagControls();
            }
            await this.reloadFromTop();
            if (typeof showGlassToast === 'function') {
                showGlassToast('success', null, `Deleted "${tagName}"`, false, 2500, '<i class="fas fa-check"></i>');
            }
        } catch (e) {
            if (typeof showGlassToast === 'function') {
                showGlassToast('error', null, e.message || 'Delete failed', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
            }
            if (fromTool) {
                this.syncCustomTagControls();
            }
        }
    }

    scheduleFilterReload() {
        if (this.filterReloadTimer) clearTimeout(this.filterReloadTimer);
        this.filterReloadTimer = setTimeout(() => {
            this.filterReloadTimer = null;
            void this.reloadFromTop();
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

    syncFilterToolbarVisibility() {
        if (this.filterToolbar) {
            this.filterToolbar.classList.toggle('hidden', !this.filterRowVisible);
        }
    }

    syncFilterToggleIndicator() {
        if (!this.filterToggleBtn) return;
        const active = this.filtersAreActive();
        const open = this.filterRowVisible;
        this.filterToggleBtn.setAttribute('data-state', (open || active) ? 'on' : 'off');
        if (open) {
            this.filterToggleBtn.title = 'Hide filters';
        } else if (active) {
            this.filterToggleBtn.title = 'Show filters (active)';
        } else {
            this.filterToggleBtn.title = 'Show filters';
        }
    }

    setGridLoading(active) {
        if (!this.grid) return;
        this.grid.classList.toggle('naxt-loading', !!active);
    }

    setupClickMenus() {
        // contextMenu.attachClickMenuToElement: public/scripts/comp/contextMenu.js
        if (!contextMenu) return;

        this.datasetClickMenuConfig = this.buildDatasetClickMenuConfig();
        this.markFilterClickMenuConfig = this.buildMarkFilterClickMenuConfig();
        this.elevatePinsClickMenuConfig = this.buildElevatePinsClickMenuConfig();
        this.bagClickMenuConfig = this.buildBagClickMenuConfig();
        this.sortClickMenuConfig = this.buildSortClickMenuConfig();

        if (this.datasetBtn) {
            contextMenu.attachClickMenuToElement(this.datasetBtn, this.datasetClickMenuConfig);
        }
        if (this.markFilterBtn) {
            contextMenu.attachClickMenuToElement(this.markFilterBtn, this.markFilterClickMenuConfig);
        }
        if (this.elevatePinsBtn) {
            contextMenu.attachClickMenuToElement(this.elevatePinsBtn, this.elevatePinsClickMenuConfig);
        }
        if (this.bagBtn) {
            contextMenu.attachClickMenuToElement(this.bagBtn, this.bagClickMenuConfig);
        }
        if (this.sortBtn) {
            contextMenu.attachClickMenuToElement(this.sortBtn, this.sortClickMenuConfig);
        }
    }

    getNaxtSortOptions() {
        return [
            { value: 'score', label: 'Score' },
            { value: 'name', label: 'Name' },
            { value: 'date', label: 'Date (export order)' },
            { value: 'ratio', label: 'Ratio' },
            { value: 'random', label: 'Random' }
        ];
    }

    applySortSelection(value) {
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
        const opt = this.getNaxtSortOptions().find((o) => o.value === value);
        if (this.sortSelected) this.sortSelected.textContent = opt ? opt.label : 'Score';
        void this.reloadFromTop();
        this.syncFilterToggleIndicator();
    }

    buildSortClickMenuConfig() {
        const applet = this;
        return {
            position: 'anchor',
            anchorAlign: 'end',
            maxHeight: 320,
            beforeShow: () => applet.refreshSortClickMenuItems(),
            sections: [{ type: 'list', items: [] }],
            onAction: (action, target, item) => {
                if (action !== 'select-sort' || item.sortValue == null) return;
                applet.applySortSelection(item.sortValue);
            }
        };
    }

    refreshSortClickMenuItems() {
        if (!this.sortClickMenuConfig) return;
        this.sortClickMenuConfig.sections[0].items = this.getNaxtSortOptions().map((opt) => ({
            text: opt.label,
            action: 'select-sort',
            sortValue: opt.value,
            loadfn: (item) => {
                item.highlighted = item.sortValue === this.sortKey;
            }
        }));
    }

    buildDatasetClickMenuConfig() {
        const applet = this;
        return {
            position: 'anchor',
            anchorAlign: 'start',
            maxHeight: 360,
            beforeShow: () => applet.refreshDatasetClickMenuItems(),
            sections: [{ type: 'list', items: [] }],
            onAction: (action, target, item) => {
                if (action !== 'select-dataset' || item.datasetSlug == null) return;
                const slugChanged = item.datasetSlug !== applet.selectedGallerySlug;
                applet.selectedGallerySlug = item.datasetSlug;
                if (slugChanged) applet.resetFiltersOnCategoryChange();
                applet.updateDatasetLabelVisual(item.datasetSlug);
                void applet.reloadFromTop();
            }
        };
    }

    refreshDatasetClickMenuItems() {
        if (!this.datasetClickMenuConfig) return;
        const items = [];
        const v45 = this.galleries.filter((g) => String(g.version || '').includes('4.5'));
        const v4 = this.galleries.filter((g) => !String(g.version || '').includes('4.5'));
        if (v45.length) {
            items.push({ separator: true, text: 'v4.5' });
            v45.forEach((g) => {
                items.push({
                    text: naxtGalleryMenuLabel(g),
                    action: 'select-dataset',
                    datasetSlug: g.slug,
                    loadfn: (item) => {
                        item.highlighted = item.datasetSlug === this.selectedGallerySlug;
                    }
                });
            });
        }
        if (v4.length) {
            items.push({ separator: true, text: 'v4' });
            v4.forEach((g) => {
                items.push({
                    text: naxtGalleryMenuLabel(g),
                    action: 'select-dataset',
                    datasetSlug: g.slug,
                    loadfn: (item) => {
                        item.highlighted = item.datasetSlug === this.selectedGallerySlug;
                    }
                });
            });
        }
        if (!items.length) {
            items.push({ text: 'No datasets', disabled: true });
        }
        this.datasetClickMenuConfig.sections[0].items = items;
    }

    buildMarkFilterClickMenuConfig() {
        const applet = this;
        return {
            position: 'anchor',
            anchorAlign: 'end',
            maxHeight: 360,
            beforeShow: () => applet.refreshMarkFilterClickMenuItems(),
            sections: [{ type: 'list', items: [] }],
            onAction: (action, target, item) => {
                if (action !== 'select-mark-filter' || item.markValue == null) return;
                applet.markFilter = item.markValue;
                applet.updateMarkFilterButton();
                void applet.reloadFromTop();
                applet.syncFilterToggleIndicator();
            }
        };
    }

    refreshMarkFilterClickMenuItems() {
        if (!this.markFilterClickMenuConfig) return;
        this.markFilterClickMenuConfig.sections[0].items = NAXT_MARK_FILTER_OPTIONS.map((opt) => ({
            text: opt.label,
            icon: opt.icon,
            action: 'select-mark-filter',
            markValue: opt.value,
            loadfn: (item) => {
                item.highlighted = item.markValue === this.markFilter;
            }
        }));
    }

    buildElevatePinsClickMenuConfig() {
        const applet = this;
        return {
            position: 'anchor',
            anchorAlign: 'end',
            maxHeight: 360,
            beforeShow: () => applet.refreshElevatePinsClickMenuItems(),
            sections: [{ type: 'list', items: [] }],
            onAction: (action, target, item) => {
                if (action !== 'select-elevate-pins' || item.pinMode == null) return;
                applet.elevatePins = naxtNormalizeElevatePins(item.pinMode);
                applet.updateElevatePinsButton();
                void applet.persistElevatePinsSetting();
                void applet.reloadFromTop();
            }
        };
    }

    refreshElevatePinsClickMenuItems() {
        if (!this.elevatePinsClickMenuConfig) return;
        const mode = naxtNormalizeElevatePins(this.elevatePins);
        this.elevatePinsClickMenuConfig.sections[0].items = NAXT_ELEVATE_PIN_OPTIONS.map((opt) => ({
            text: opt.label,
            icon: opt.icon,
            action: 'select-elevate-pins',
            pinMode: opt.value,
            loadfn: (item) => {
                item.highlighted = naxtNormalizeElevatePins(item.pinMode) === mode;
            }
        }));
    }

    handleBagMenuAction(action, target, item) {
        if (action === 'bag-remove' && item.bagIndex != null) {
            this.removeFromBagAt(item.bagIndex);
            return;
        }
        if (action === 'bag-compile') {
            this.compileBag();
            return;
        }
        if (action === 'bag-phasewalker') {
            this.openPhasewalkerFromBag();
            return;
        }
        if (action === 'bag-clear') {
            this.clearBag();
        }
    }

    buildBagMenuItems() {
        const applet = this;
        const items = [];
        if (!this.bag.length) {
            items.push({ text: 'Bag is empty', disabled: true });
        } else {
            this.bag.forEach((entry, index) => {
                items.push({
                    text: entry.tag,
                    icon: naxtGalleryIconClass(entry.gallerySlug),
                    action: 'bag-remove',
                    bagIndex: index,
                    itemContextBindfn: (item, el) => {
                        const bagEntry = applet.bag[item.bagIndex];
                        if (bagEntry) {
                            applet.syncNaxtTagTargetDataset(el, bagEntry, item.bagIndex);
                            item._contextIsCustom = el.dataset.isCustom === '1';
                        }
                    },
                    itemContextMenu: (item) => applet.buildNaxtTagContextMenuConfig({
                        inBag: true,
                        isCustom: !!item._contextIsCustom
                    })
                });
            });
        }
        const hasBag = this.bag.length > 0;
        items.push({ separator: true });
        items.push({
            text: 'Compile',
            icon: 'fas fa-hammer',
            action: 'bag-compile',
            disabled: !hasBag
        });
        items.push({
            text: 'Open Phasewalker',
            icon: 'fas fa-layer-group',
            action: 'bag-phasewalker',
            disabled: !hasBag
        });
        items.push({
            text: 'Remove all',
            icon: 'fas fa-trash',
            action: 'bag-clear',
            disabled: !hasBag
        });
        return items;
    }

    refreshBagMenuItems() {
        const items = this.buildBagMenuItems();
        if (this.bagClickMenuConfig && this.bagClickMenuConfig.sections[0]) {
            this.bagClickMenuConfig.sections[0].items = items;
        }
        if (this.bagTrayMenuConfig && this.bagTrayMenuConfig.sections[0]) {
            this.bagTrayMenuConfig.sections[0].items = items;
        }
    }

    reRenderBagMenusIfOpen() {
        // contextMenu.renderMenu: public/scripts/comp/contextMenu.js
        if (!contextMenu || !contextMenu.isOpen) return;
        this.refreshBagMenuItems();
        const target = contextMenu.currentTarget;
        let config = null;
        if (target === this.bagBtn) config = this.bagClickMenuConfig;
        else if (target === this.bagTrayEl) config = this.bagTrayMenuConfig;
        if (!config) return;
        contextMenu.renderMenu(config, target);
        contextMenu.executeLoadFunctions(config, target);
        contextMenu.updateIndicatorDots(config);
    }

    buildBagClickMenuConfig() {
        const applet = this;
        return {
            position: 'anchor',
            anchorAlign: 'end',
            maxHeight: 420,
            beforeShow: () => applet.refreshBagMenuItems(),
            sections: [{ type: 'list', items: [] }],
            onAction: (action, target, item) => applet.handleBagMenuAction(action, target, item)
        };
    }

    buildBagTrayMenuConfig() {
        const applet = this;
        return {
            maxHeight: 420,
            beforeShow: () => applet.refreshBagMenuItems(),
            sections: [{ type: 'list', items: [] }],
            onAction: (action, target, item) => applet.handleBagMenuAction(action, target, item)
        };
    }

    refreshBagClickMenuItems() {
        this.refreshBagMenuItems();
    }

    isAppletOpen() {
        return !!(this.modal && !this.modal.classList.contains('hidden'));
    }

    formatBagTrayTitle() {
        const n = this.bag.length;
        return `Atelier Bag - ${n} item${n === 1 ? '' : 's'}`;
    }

    updateBagTrayChrome() {
        if (!this.bagTrayEl) return;

        const n = this.bag.length;
        const appletOpen = this.isAppletOpen();
        const bootPending = typeof window.isDesktopTrayBootPending === 'function' && window.isDesktopTrayBootPending();

        if (n > 0) {
            if (!bootPending) {
                this.bagTrayEl.classList.remove('hidden', 'naxt-bag-tray-atelier-open');
            }
            if (this.bagTrayGlyph) {
                this.bagTrayGlyph.className = 'fas fa-shopping-bag';
            }
        } else if (appletOpen) {
            if (!bootPending) {
                this.bagTrayEl.classList.remove('hidden');
                this.bagTrayEl.classList.add('naxt-bag-tray-atelier-open');
            }
            if (this.bagTrayGlyph) {
                this.bagTrayGlyph.className = 'fas fa-flask';
            }
        } else {
            this.bagTrayEl.classList.add('hidden');
            this.bagTrayEl.classList.remove('naxt-bag-tray-atelier-open');
            if (this.bagTrayGlyph) {
                this.bagTrayGlyph.className = 'fas fa-shopping-bag';
            }
        }

        this.bagTrayEl.title = this.formatBagTrayTitle();
    }

    setupBagTray() {
        // contextMenu.attachToElement: public/scripts/comp/contextMenu.js
        if (!this.bagTrayEl || !contextMenu) return;

        this.bagTrayMenuConfig = this.buildBagTrayMenuConfig();
        contextMenu.attachToElement(this.bagTrayEl, this.bagTrayMenuConfig);

        this.bagTrayEl.addEventListener('dblclick', (e) => {
            e.preventDefault();
            e.stopPropagation();
            void this.open();
        });

        this.updateBagTrayChrome();
    }

    updateMarkFilterButton() {
        const opt = NAXT_MARK_FILTER_OPTIONS.find((o) => o.value === this.markFilter) || NAXT_MARK_FILTER_OPTIONS[0];
        if (this.markFilterIcon) {
            this.markFilterIcon.className = (opt.icon || 'fas fa-bookmark') + ' naxt-mark-filter-icon';
        }
        if (this.markFilterBtn) {
            this.markFilterBtn.setAttribute('data-state', this.markFilter !== 'all' ? 'open' : 'off');
            this.markFilterBtn.title = `Filter by mark: ${opt.label}`;
        }
    }

    loadElevatePinsFromLocal() {
        try {
            const raw = localStorage.getItem(NAXT_ELEVATE_PINS_LS);
            if (raw !== null && raw !== '') {
                this.elevatePins = naxtNormalizeElevatePins(raw);
            } else {
                const legacy = localStorage.getItem('naxtElevateFavorites');
                if (legacy === 'true') this.elevatePins = 1;
                else if (legacy === 'false') this.elevatePins = 0;
            }
        } catch {
            this.elevatePins = 0;
        }
        this.updateElevatePinsButton();
    }

    updateElevatePinsButton() {
        const mode = naxtNormalizeElevatePins(this.elevatePins);
        this.elevatePins = mode;
        const opt = NAXT_ELEVATE_PIN_OPTIONS.find((o) => o.value === mode) || NAXT_ELEVATE_PIN_OPTIONS[0];
        if (this.elevatePinsIcon) {
            this.elevatePinsIcon.className = (opt.icon || 'fas fa-thumbtack') + ' naxt-elevate-pins-icon';
        }
        if (this.elevatePinsBtn) {
            this.elevatePinsBtn.setAttribute('data-state', mode !== 0 ? 'open' : 'off');
            this.elevatePinsBtn.title = `Pin to top: ${opt.label}`;
        }
    }

    async persistElevatePinsSetting() {
        // persistUserGlobalSettingsPatch: public/scripts/comp/modalUtils.js
        if (typeof persistUserGlobalSettingsPatch === 'function') {
            try {
                await persistUserGlobalSettingsPatch({
                    naxt: { elevatePins: naxtNormalizeElevatePins(this.elevatePins) }
                });
            } catch (e) {
                console.error('update_user_global_settings', e);
            }
            return;
        }
        try {
            localStorage.setItem(NAXT_ELEVATE_PINS_LS, String(naxtNormalizeElevatePins(this.elevatePins)));
        } catch {
            /* */
        }
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
        this.updateBagTrayChrome();
        this.reRenderBagMenusIfOpen();
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
        if (contextMenu && contextMenu.isOpen &&
            (contextMenu.currentTarget === this.bagBtn || contextMenu.currentTarget === this.bagTrayEl)) {
            contextMenu.hideMenu();
        }
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

    applyHiddenToCard(card, hidden) {
        if (!card) return;
        card.dataset.hidden = hidden ? '1' : '0';
    }

    async setHiddenForTag(gallerySlug, tag, hidden) {
        try {
            await window.wsClient.sendMessage('set_nax_hidden', { gallerySlug, tag, hidden }, false);
            const card = this.findVisibleCard(gallerySlug, tag);
            if (card) {
                if (hidden && this.markFilter !== 'hidden') {
                    card.remove();
                    this.updateStatusBar();
                } else {
                    this.applyHiddenToCard(card, hidden);
                }
            } else if (this.markFilter === 'hidden' && !hidden) {
                await this.reloadFromTop();
            }
        } catch (e) {
            if (typeof showGlassToast === 'function') {
                showGlassToast('error', null, e.message || 'Failed to update hidden mark', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
            }
        }
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
        this.updateMarkFilterButton();
        this.sortKey = 'score';
        this.randomSeed = 0;
        this.invert = false;
        if (this.invertBtn) this.invertBtn.setAttribute('data-state', 'off');
        if (this.sortSelected) this.sortSelected.textContent = 'Score';
        this.clearNaxtNumericFilters();
        this.syncFilterToggleIndicator();
        if (reload) {
            void this.reloadFromTop();
        }
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
        this.syncFilterToolbarVisibility();
        this.syncFilterToggleIndicator();
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
        this.syncFilterToolbarVisibility();
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
        void this.reloadFromTop();
    }

    setupListeners() {
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
                    void this.reloadFromTop();
                    this.syncFilterToggleIndicator();
                    return;
                }
                this.filterRowVisible = !this.filterRowVisible;
                this.syncFilterToolbarVisibility();
                this.syncFilterToggleIndicator();
            });
        }

        if (this.refreshBtn) {
            this.refreshBtn.addEventListener('click', () => {
                this.committedSearchQuery = this.searchInput ? this.searchInput.value.trim() : '';
                void this.reloadFromTop();
                this.syncFilterToggleIndicator();
            });
        }

        if (this.invertBtn) {
            this.invertBtn.addEventListener('click', () => {
                if (this.sortKey === 'random') return;
                this.invert = !this.invert;
                this.invertBtn.setAttribute('data-state', this.invert ? 'on' : 'off');
                void this.reloadFromTop();
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
                    void this.reloadFromTop();
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
        if (this.customTagDeleteBtn) {
            this.customTagDeleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                void this.deleteCustomTag(null, null, { fromTool: true });
            });
        }
        if (this.customTagFavoriteBtn) {
            this.customTagFavoriteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                void this.toggleCustomTagFavorite();
            });
        }
        if (this.customTagTryBtn) {
            this.customTagTryBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                void this.toggleCustomTagTry();
            });
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

    applyHomeDefaults() {
        this.filterRowVisible = false;
        this.syncFilterToolbarVisibility();
        this.syncFilterToggleIndicator();
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
        await this.reloadFromTop();
    }

    async ensureGalleries() {
        if (!window.userGlobalSettingsHydrated && window.wsClient && window.wsClient.isConnected()) {
            if (typeof loadUserGlobalSettingsFromServer === 'function') {
                await loadUserGlobalSettingsFromServer();
            }
        }
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
        if (!this.browseSessionActive) {
            this.applyHomeDefaults();
            if (!this.selectedGallerySlug && this.galleries.length) {
                this.selectedGallerySlug = this.galleries[0].slug;
            }
            this.updateDatasetLabelVisual(this.selectedGallerySlug);
            this.browseSessionActive = true;
        }
        if (typeof openModal === 'function') {
            openModal(this.modal);
        }
        this.updateBagTrayChrome();
        setTimeout(() => {
            if (window.customScrollbar) {
                const body = this.modal.querySelector('.naxt-body.form-section-scroll');
                if (body) window.customScrollbar.forceReinit(body);
            }
            this.setupSentinelObserver();
            this.setupImgObserver();
        }, 80);
        await this.reloadFromTop();
        this.syncFilterToggleIndicator();
        this.updateStatusBar();
    }

    close() {
        if (!this.modal || typeof closeModal !== 'function') return;
        closeModal(this.modal).then(() => {
            this.browseSessionActive = false;
            if (this.grid) this.grid.innerHTML = '';
            this.updateBagTrayChrome();
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

    async reloadFromTop() {
        this.offset = 0;
        this.hasMore = true;
        if (this.grid) this.grid.innerHTML = '';
        await this.loadPage(false);
    }

    loadMore() {
        if (!this.hasMore || this.loading) return;
        this.loadPage(true);
    }

    numOrNull(el) {
        if (!el) return null;
        const t = String(el.value).trim();
        if (t === '') return null;
        const n = Number(t);
        return Number.isNaN(n) ? null : n;
    }

    async loadPage(append) {
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
        payload.elevatePins = naxtNormalizeElevatePins(this.elevatePins);
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
        el.dataset.hidden = card && card.dataset.hidden === '1' ? '1' : '0';
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
                                iconDef.icon = on ? 'fas fa-vial-circle-check' : 'fas fa-vial';
                                iconDef.tooltip = on ? 'Remove try mark' : 'Mark to try';
                            }
                        },
                        {
                            icon: 'fas fa-eye-slash',
                            tooltip: 'Hide tag',
                            action: 'naxt-hide',
                            loadfn: (iconDef, target) => {
                                const on = target && target.dataset && target.dataset.hidden === '1';
                                iconDef.icon = on ? 'fas fa-eye' : 'fas fa-eye-slash';
                                iconDef.tooltip = on ? 'Unhide tag' : 'Hide tag';
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
            }
        } else if (action === 'naxt-add-desktop') {
            this.addNaxTagToDesktop(target);
        } else if (action === 'naxt-copy') {
            this.copyTag(tag);
        } else if (action === 'naxt-fav') {
            void this.toggleFavorite(target);
        } else if (action === 'naxt-try') {
            void this.toggleTry(target);
        } else if (action === 'naxt-hide') {
            void this.toggleHidden(target);
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
        card.dataset.hidden = item.hidden ? '1' : '0';
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
        // copyTextToClipboard: public/scripts/utils/dreamscapeClipboard.js
        copyTextToClipboard(tag).then(() => {
            if (showGlassToast) {
                showGlassToast('success', null, `Copied "${tag}" to clipboard`, false, 2000, '<i class="fas fa-check"></i>');
            }
        }).catch((err) => {
            console.error('Failed to copy tag:', err);
        });
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

    async toggleHidden(target) {
        const slug = target.dataset.gallerySlug;
        const tag = target.dataset.tag;
        const next = target.dataset.hidden !== '1';
        await this.setHiddenForTag(slug, tag, next);
        target.dataset.hidden = next ? '1' : '0';
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

function initializeNaxtBagTray() {
    if (!naxtApplet.bagTrayEl) {
        naxtApplet.bagTrayEl = document.getElementById('naxtBagTrayIcon');
        naxtApplet.bagTrayGlyph = document.getElementById('naxtBagTrayIconGlyph');
    }
    if (!naxtApplet.bagTrayEl || naxtApplet._bagTrayInitialized) return;
    if (!window.isDesktop) {
        naxtApplet.bagTrayEl.classList.add('hidden');
        return;
    }
    naxtApplet.setupBagTray();
    naxtApplet._bagTrayInitialized = true;
}
