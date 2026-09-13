/**
 * Prism — creative compare applet (Yozora #189).
 * Adjacent Source | Current | Ladder Side-by-side + Studio compare toolset.
 * public/scripts/comp/compareViewManager.js (COMPARE_* menus, slide clip-path model)
 * public/scripts/comp/imageLoupe.js (attachImageLoupe)
 * public/scripts/comp/modalUtils.js (openModal, closeModal)
 * public/scripts/comp/assetUrlResolver.js (localGalleryImageUrl, resolveGalleryPreviewUrl, resolveGalleryFullImageUrl)
 * public/scripts/comp/galleryView.js (findImageByFilename, getSelectedFilenames)
 * public/scripts/comp/contextMenu.js (attachToElement, attachClickMenuToElement)
 * public/scripts/comp/manualModalManager.js (openManualModalWithContent)
 */

const PRISM_LETTERS = 'ABCDEFGH';
const PRISM_MAX_ITEMS = 8;

class PrismApplet {
    constructor() {
        this.modal = null;
        this.items = [];
        this.sourceIndex = 0;
        this.resultIndex = 1;
        this.mode = 'side';
        this.syncPanZoom = true;
        this.overlayEnabled = false;
        this.slideEnabled = false;
        this.loupeRevealEnabled = false;
        this.splitPosition = 50;
        this.runtime = {
            overlayOpacity: 50,
            blendMode: 'normal',
            sourceColor: 'none',
            generationColor: 'none',
            priority: 'source'
        };
        this.viewQuickStored = { overlay: false, slide: false, reveal: false };
        this.viewQuickSuspended = false;
        this.tempShowSource = false;
        this.tempHideSource = false;
        this.drag = {
            active: false,
            pointerId: null,
            startX: 0,
            startY: 0,
            startAt: 0,
            moved: false
        };
        this.pan = { x: 0, y: 0, scale: 1 };
        this.loupeHandle = null;
        this.pickerOpen = false;
        this._initWired = false;
        this._altHeld = false;
        this._shiftLeft = false;
        this._shiftRight = false;
    }

    init() {
        if (this._initWired) return;
        this.modal = document.getElementById('prismModal');
        if (!this.modal) return;
        this._initWired = true;

        const closeBtn = document.getElementById('closePrismBtn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.close());
        }

        this.modal.querySelectorAll('[data-prism-action]').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                this.onToolbarAction(btn.getAttribute('data-prism-action'), e);
            });
        });

        this.modal.querySelectorAll('[data-prism-mode]').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                this.setMode(btn.getAttribute('data-prism-mode'));
            });
        });

        const resultImage = document.getElementById('prismResultImage');
        if (resultImage) {
            resultImage.addEventListener('pointerdown', (e) => this.startSlideDrag(e));
            resultImage.addEventListener('pointermove', (e) => this.updateSlideDrag(e));
            resultImage.addEventListener('pointerup', (e) => this.endSlideDrag(e));
            resultImage.addEventListener('pointercancel', (e) => this.endSlideDrag(e));
        }

        const panes = this.modal.querySelector('.prism-panes');
        if (panes) {
            panes.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
            panes.addEventListener('pointerdown', (e) => this.startPan(e));
        }

        const pickerSearch = document.getElementById('prismPickerSearch');
        if (pickerSearch) {
            pickerSearch.addEventListener('input', () => this.renderPicker());
        }

        this.wireCompareMenus();
        this.wireKeyboard();
        this.ensureDistinctPair();
        this.render();
    }

    wireKeyboard() {
        // registerKeyboardListener: public/scripts/comp/modalKeyboardRegistry.js
        registerKeyboardListener({
            id: 'prism.compare.keydown',
            handler: (e) => this.onKey(e, true),
            type: 'whenOpen',
            modalId: 'prismModal',
            eventType: 'keydown',
            priority: 65,
            critical: false,
            showInOverlay: false
        });
        registerKeyboardListener({
            id: 'prism.compare.keyup',
            handler: (e) => this.onKey(e, false),
            type: 'whenOpen',
            modalId: 'prismModal',
            eventType: 'keyup',
            priority: 65,
            critical: false,
            showInOverlay: false
        });
    }

    wireCompareMenus() {
        // contextMenu.attachToElement / attachClickMenuToElement: public/scripts/comp/contextMenu.js
        if (!contextMenu) return;
        const sourceBtn = document.getElementById('prismUseAsSourceBtn');
        if (sourceBtn) {
            contextMenu.attachToElement(sourceBtn, this.buildSourceMenu());
        }
        const attachToolbarMenu = (id, config) => {
            const el = document.getElementById(id);
            if (!el) return;
            contextMenu.attachClickMenuToElement(el, config);
            contextMenu.attachToElement(el, config);
        };
        attachToolbarMenu('prismOpacityBtn', {
            position: 'anchor',
            sections: [{ type: 'list', items: this.opacityMenuItems() }],
            onAction: (action, _t, item) => this.onCompareMenu(action, item)
        });
        attachToolbarMenu('prismBlendBtn', {
            position: 'anchor',
            sections: [{ type: 'list', items: this.blendMenuItems() }],
            onAction: (action, _t, item) => this.onCompareMenu(action, item)
        });
        const colorSections = this.colorMenuSections();
        attachToolbarMenu('prismSourceColorBtn', {
            position: 'anchor',
            sections: [{ type: 'grid', title: 'Source', items: colorSections[0].items }],
            onAction: (action, _t, item) => this.onCompareMenu(action, item)
        });
        attachToolbarMenu('prismResultColorBtn', {
            position: 'anchor',
            sections: [{ type: 'grid', title: 'Result', items: colorSections[1].items }],
            onAction: (action, _t, item) => this.onCompareMenu(action, item)
        });
    }

    opacityMenuItems() {
        return [15, 25, 50, 75, 85].map((value) => ({
            text: `${value}%`,
            action: 'setCompareOpacity',
            value,
            keepMenuOpen: true,
            loadfn: (item) => { item.checked = this.runtime.overlayOpacity === value; }
        }));
    }

    blendMenuItems() {
        // COMPARE_BLEND_MENU: public/scripts/comp/compareViewManager.js
        return COMPARE_BLEND_MENU.map((entry) => {
            if (entry.separator) return { separator: true };
            return {
                text: entry.label,
                action: 'setCompareBlend',
                value: entry.id,
                keepMenuOpen: true,
                loadfn: (item) => { item.checked = this.runtime.blendMode === entry.id; }
            };
        });
    }

    colorMenuSections() {
        // COMPARE_COLOR_MENU: public/scripts/comp/compareViewManager.js
        const mapCells = (action, key) => COMPARE_COLOR_MENU.map((spec) => ({
            action,
            value: spec.id,
            icon: spec.icon,
            swatchColor: spec.swatchColor,
            tooltip: spec.tooltip,
            keepMenuOpen: true,
            showIndicator: true,
            loadfn: (item) => { item.checked = this.runtime[key] === spec.id; }
        }));
        return [
            { type: 'grid', title: 'Source', items: mapCells('setCompareSourceColor', 'sourceColor') },
            { type: 'grid', title: 'Result', items: mapCells('setCompareGenerationColor', 'generationColor') }
        ];
    }

    priorityMenuItems() {
        return [
            { text: 'Result', value: 'source' },
            { text: 'Source', value: 'generation' }
        ].map((opt) => ({
            text: opt.text,
            action: 'setComparePriority',
            value: opt.value,
            keepMenuOpen: true,
            loadfn: (item) => { item.checked = this.runtime.priority === opt.value; }
        }));
    }

    buildSourceMenu() {
        return {
            maxHeight: true,
            sections: [
                {
                    type: 'list',
                    hidden: () => !this.sourceItem(),
                    items: [
                        {
                            icon: 'fas fa-magnifying-glass',
                            text: 'Loupe reveal',
                            action: 'compareToggleLoupeReveal',
                            keepMenuOpen: true,
                            showIndicator: true,
                            disabled: () => this.slideEnabled,
                            loadfn: (item) => { item.checked = this.loupeRevealEnabled; }
                        },
                        {
                            icon: 'fas fa-columns',
                            text: 'Slide',
                            action: 'compareToggleSlide',
                            keepMenuOpen: true,
                            showIndicator: true,
                            disabled: () => this.loupeRevealEnabled,
                            loadfn: (item) => { item.checked = this.slideEnabled; }
                        },
                        {
                            icon: 'fas fa-layer-group',
                            text: 'Overlay',
                            action: 'compareToggleOverlay',
                            keepMenuOpen: false,
                            showIndicator: true,
                            loadfn: (item) => { item.checked = this.overlayEnabled; }
                        }
                    ]
                },
                {
                    type: 'list',
                    hidden: () => !this.sourceItem(),
                    items: [
                        { icon: 'fas fa-arrow-down-wide-short', text: 'Priority', submenu: this.priorityMenuItems(), disabled: () => !this.overlayEnabled },
                        { icon: 'fas fa-eye', text: 'Visibility', submenu: this.opacityMenuItems(), disabled: () => !this.overlayEnabled },
                        { icon: 'fas fa-fill-drip', text: 'Blending', submenu: this.blendMenuItems(), disabled: () => !this.overlayEnabled },
                        { icon: 'fas fa-palette', text: 'Color', submenu: this.colorMenuSections(), disabled: () => !this.overlayEnabled }
                    ]
                },
                {
                    type: 'list',
                    title: 'Actions',
                    hidden: () => !this.sourceItem(),
                    items: [
                        { icon: 'fas fa-rotate-left', text: 'Reset Controls', action: 'compareResetControls' },
                        { icon: 'fas fa-arrows-rotate', text: 'Replace Source', action: 'compareReplaceSource', className: 'text-warning' },
                        { icon: 'fas fa-times', text: 'Stop Comparison', action: 'compareClearSource', className: 'text-danger' }
                    ]
                }
            ],
            onAction: (action, _t, item) => this.onCompareMenu(action, item),
            closeTreeOnOuterClick: true
        };
    }

    open(options) {
        this.init();
        if (!this.modal) return;
        // openModal: public/scripts/comp/modalUtils.js
        openModal(this.modal);
        const filenames = this.collectOpenFilenames(options);
        if (filenames.length) {
            this.setFilenames(filenames, options);
        } else if (!this.items.length) {
            const selected = this.selectedGalleryNames();
            if (selected.length) this.setFilenames(selected, options);
        }
        if (options && options.mode) this.setMode(options.mode);
        this.ensureDistinctPair();
        this.render();
        return { ok: true, target: 'prism', filenames: this.itemFilenames() };
    }

    close() {
        if (!this.modal) return;
        this.destroyLoupe();
        // closeModal: public/scripts/comp/modalUtils.js
        closeModal(this.modal);
    }

    collectOpenFilenames(options) {
        const names = [];
        const push = (value) => {
            const name = typeof value === 'string' ? value : (value && value.filename);
            if (name && names.indexOf(name) === -1) names.push(name);
        };
        if (!options) return names;
        if (Array.isArray(options.filenames)) options.filenames.forEach(push);
        push(options.filename);
        push(options.filenameA);
        push(options.filenameB);
        push(options.a);
        push(options.b);
        return names;
    }

    selectedGalleryNames() {
        // getSelectedFilenames: public/scripts/comp/galleryView.js
        return getSelectedFilenames().filter(Boolean);
    }

    setFilenames(filenames, options) {
        this.items = [];
        (filenames || []).forEach((name) => this.addFilename(name, { silent: true }));
        this.sourceIndex = 0;
        this.resultIndex = this.items.length > 1 ? 1 : 0;
        const sourceName = options && (options.sourceFilename || options.filenameA || options.a);
        const resultName = options && (options.resultFilename || options.filenameB || options.b);
        if (sourceName) {
            const i = this.indexOfFilename(sourceName);
            if (i >= 0) this.sourceIndex = i;
        }
        if (resultName) {
            const i = this.indexOfFilename(resultName);
            if (i >= 0) this.resultIndex = i;
        }
        this.ensureDistinctPair();
        this.render();
    }

    prismPaneUrl(image, filename) {
        const file = (image && (image.upscaled || image.original || image.filename)) || filename;
        if (!file) return '';
        // resolveGalleryFullImageUrl / localGalleryImageUrl: public/scripts/comp/assetUrlResolver.js
        const resolved = resolveGalleryFullImageUrl(image);
        if (resolved && resolved.indexOf('/previews/') < 0 && resolved.indexOf('/cache/preview/') < 0) {
            return resolved;
        }
        return localGalleryImageUrl(file);
    }

    paneSrc(item) {
        if (!item) return '';
        return this.prismPaneUrl(item.image, item.filename) || item.url || '';
    }

    ensureDistinctPair(keep) {
        const n = this.items.length;
        if (n < 2) {
            this.sourceIndex = 0;
            this.resultIndex = 0;
            return;
        }
        if (this.sourceIndex < 0 || this.sourceIndex >= n) this.sourceIndex = 0;
        if (this.resultIndex < 0 || this.resultIndex >= n) {
            this.resultIndex = this.sourceIndex === 0 ? 1 : 0;
        }
        if (this.sourceIndex === this.resultIndex) {
            const next = this.sourceIndex === 0 ? 1 : 0;
            if (keep === 'result') this.sourceIndex = next;
            else this.resultIndex = next;
        }
    }

    addFilename(filename, opts) {
        if (!filename || this.items.length >= PRISM_MAX_ITEMS) return false;
        if (this.indexOfFilename(filename) >= 0) return false;
        // findImageByFilename: public/scripts/comp/galleryView.js
        const image = findImageByFilename(filename) || { filename: filename, original: filename };
        const file = image.upscaled || image.original || image.filename || filename;
        this.items.push({
            filename: file,
            image,
            url: this.prismPaneUrl(image, file),
            previewUrl: resolveGalleryPreviewUrl(image) || localGalleryImageUrl(file),
            width: image.width || 0,
            height: image.height || 0,
            seed: image.metadata && image.metadata.seed,
            model: image.metadata && (image.metadata.model || image.metadata.request_type)
        });
        this.ensureDistinctPair();
        if (!opts || !opts.silent) this.render();
        return true;
    }

    removeFilename(filename, opts) {
        const i = this.indexOfFilename(filename);
        if (i < 0) return false;
        const sourceName = this.sourceItem() && this.sourceItem().filename;
        const resultName = this.resultItem() && this.resultItem().filename;
        this.items.splice(i, 1);
        this.sourceIndex = Math.max(0, this.indexOfFilename(sourceName));
        const resultAt = this.indexOfFilename(resultName);
        this.resultIndex = resultAt >= 0 ? resultAt : 0;
        this.ensureDistinctPair();
        if (!opts || !opts.silent) this.render();
        return true;
    }

    galleryImagePool() {
        // window.originalAllImages / allImages: public/scripts/comp/galleryView.js
        const original = window.originalAllImages;
        if (original && original.length) return original;
        return allImages;
    }

    itemMatchesFilename(item, filename) {
        if (!item || !filename) return false;
        if (item.filename === filename) return true;
        const image = item.image;
        if (!image) return false;
        return image.filename === filename || image.original === filename || image.upscaled === filename;
    }

    indexOfFilename(filename) {
        return this.items.findIndex((item) => this.itemMatchesFilename(item, filename));
    }

    itemFilenames() {
        return this.items.map((item) => item.filename);
    }

    sourceItem() {
        return this.items[this.sourceIndex] || null;
    }

    resultItem() {
        if (this.items[this.resultIndex]) return this.items[this.resultIndex];
        if (this.items.length > 1) {
            const alt = this.sourceIndex === 0 ? 1 : 0;
            return this.items[alt] || null;
        }
        return this.items[0] || null;
    }

    letterAt(index) {
        return PRISM_LETTERS.charAt(index) || String(index + 1);
    }

    onToolbarAction(action, event) {
        if (action === 'add') {
            this.togglePicker();
            return;
        }
        if (action === 'clear') {
            this.clearSet();
            return;
        }
        if (action === 'studio') {
            this.openInStudio();
            return;
        }
        if (action === 'sync') {
            this.syncPanZoom = !this.syncPanZoom;
            this.renderToolbar();
            this.applyPanZoom();
            return;
        }
        if (action === 'use-source') {
            this.useAsSourceClick();
            return;
        }
        if (action === 'overlay') {
            this.onCompareMenu('compareToggleOverlay');
            return;
        }
        if (action === 'slide') {
            this.onCompareMenu('compareToggleSlide');
            return;
        }
        if (action === 'loupe-reveal') {
            this.onCompareMenu('compareToggleLoupeReveal');
            return;
        }
        if (action === 'opacity' || action === 'blend' || action === 'source-color' || action === 'result-color') {
            // attachClickMenuToElement opens these on mousedown
            return;
        }
        if (action === 'picker-close') {
            this.pickerOpen = false;
            this.render();
            return;
        }
        if (action === 'add-selected') {
            this.selectedGalleryNames().forEach((name) => this.addFilename(name, { silent: true }));
            this.ensureDistinctPair();
            this.pickerOpen = false;
            this.render();
        }
        void event;
    }

    useAsSourceClick() {
        const result = this.resultItem();
        if (!result) {
            showGlassToast('error', 'Source Not Set', 'No image in the result pane', false, undefined, '<i class="fas fa-image-slash"></i>');
            return;
        }
        const current = this.sourceItem();
        if (current && current.filename === result.filename) {
            this.onCompareMenu('compareClearSource');
            showGlassToast('info', null, 'Comparison cleared', false, 1800, '<i class="fas fa-eye-dropper"></i>');
            return;
        }
        this.sourceIndex = this.resultIndex;
        this.ensureDistinctPair();
        this.overlayEnabled = false;
        this.slideEnabled = false;
        this.loupeRevealEnabled = false;
        this.viewQuickSuspended = false;
        showGlassToast('success', null, 'Comparison source set', false, 1800, '<i class="fas fa-eye-dropper"></i>');
        this.render();
    }

    onCompareMenu(action, item) {
        if (action === 'compareToggleLoupeReveal') {
            if (this.slideEnabled) return;
            this.loupeRevealEnabled = !this.loupeRevealEnabled;
            if (this.loupeRevealEnabled) this.slideEnabled = false;
            this.viewQuickSuspended = false;
            this.render();
            return;
        }
        if (action === 'compareToggleSlide') {
            if (this.loupeRevealEnabled) return;
            this.slideEnabled = !this.slideEnabled;
            if (this.slideEnabled) this.loupeRevealEnabled = false;
            this.viewQuickSuspended = false;
            this.render();
            return;
        }
        if (action === 'compareToggleOverlay') {
            this.overlayEnabled = !this.overlayEnabled;
            this.viewQuickSuspended = false;
            this.render();
            return;
        }
        if (action === 'compareResetControls') {
            this.runtime = {
                overlayOpacity: 50,
                blendMode: 'normal',
                sourceColor: 'none',
                generationColor: 'none',
                priority: 'source'
            };
            this.overlayEnabled = false;
            this.slideEnabled = false;
            this.loupeRevealEnabled = false;
            this.splitPosition = 50;
            this.viewQuickSuspended = false;
            this.render();
            return;
        }
        if (action === 'compareReplaceSource') {
            this.useAsSourceClick();
            return;
        }
        if (action === 'compareClearSource') {
            this.overlayEnabled = false;
            this.slideEnabled = false;
            this.loupeRevealEnabled = false;
            this.viewQuickSuspended = false;
            this.render();
            return;
        }
        if (action === 'setCompareOpacity') {
            this.runtime.overlayOpacity = Number(item && item.value) || 50;
            this.renderCompareHost();
            this.renderToolbar();
            return;
        }
        if (action === 'setCompareBlend') {
            this.runtime.blendMode = (item && item.value) || 'normal';
            this.renderCompareHost();
            this.renderToolbar();
            return;
        }
        if (action === 'setCompareSourceColor') {
            this.runtime.sourceColor = (item && item.value) || 'none';
            this.renderCompareHost();
            return;
        }
        if (action === 'setCompareGenerationColor') {
            this.runtime.generationColor = (item && item.value) || 'none';
            this.renderCompareHost();
            return;
        }
        if (action === 'setComparePriority') {
            this.runtime.priority = item && item.value === 'generation' ? 'generation' : 'source';
            this.renderCompareHost();
        }
    }

    clearSet() {
        this.items = [];
        this.sourceIndex = 0;
        this.resultIndex = 0;
        this.overlayEnabled = false;
        this.slideEnabled = false;
        this.loupeRevealEnabled = false;
        this.pan = { x: 0, y: 0, scale: 1 };
        this.render();
    }

    setMode(mode) {
        if (mode !== 'side' && mode !== 'loupe' && mode !== 'grid') return;
        this.mode = mode;
        if (mode === 'loupe') this.loupeRevealEnabled = true;
        this.render();
    }

    togglePicker() {
        this.pickerOpen = !this.pickerOpen;
        this.render();
        if (this.pickerOpen) {
            const input = document.getElementById('prismPickerSearch');
            if (input) input.focus();
        }
    }

    focusCell(index, asSource) {
        if (index < 0 || index >= this.items.length) return;
        if (asSource) {
            this.sourceIndex = index;
            this.ensureDistinctPair('source');
        } else {
            this.resultIndex = index;
            this.ensureDistinctPair('result');
        }
        if (this.mode === 'grid') this.mode = 'side';
        this.render();
    }

    openInStudio() {
        const result = this.resultItem();
        if (!result) {
            showGlassToast('error', null, 'Add images to Prism first', false, 1800, '<i class="fas fa-image-slash"></i>');
            return;
        }
        // openManualModalWithContent: public/scripts/comp/manualModalManager.js
        openManualModalWithContent({ type: 'image', image: result.image, metadata: result.image.metadata || null }, null);
        const source = this.sourceItem();
        if (source && source.filename !== result.filename) {
            // buildCompareDataFromImageObject / setCompareSourceData: public/scripts/comp/compareViewManager.js
            setCompareSourceData(buildCompareDataFromImageObject(source.image));
        }
    }

    snapshot() {
        const source = this.sourceItem();
        const result = this.resultItem();
        return {
            filenames: this.itemFilenames(),
            source: source ? source.filename : null,
            result: result ? result.filename : null,
            mode: this.mode,
            overlay: this.overlayEnabled,
            slide: this.slideEnabled,
            loupeReveal: this.loupeRevealEnabled
        };
    }

    onKey(e, down) {
        if (e.key === 'Alt') this._altHeld = down;
        if (e.key === 'Shift') {
            if (e.location === 1) this._shiftLeft = down;
            else if (e.location === 2) this._shiftRight = down;
            else this._shiftLeft = down;
        }
        const show = this._altHeld && this._shiftLeft;
        const hide = this._altHeld && this._shiftRight && !this._shiftLeft;
        if (show !== this.tempShowSource || hide !== this.tempHideSource) {
            this.tempShowSource = show;
            this.tempHideSource = hide;
            this.renderCompareHost();
        }
        return false;
    }

    startSlideDrag(e) {
        if (!this.slideEnabled || !this.sourceItem() || !this.resultItem()) return;
        this.drag.active = true;
        this.drag.pointerId = e.pointerId;
        this.drag.moved = false;
        this.drag.startX = e.clientX;
        this.drag.startY = e.clientY;
        this.drag.startAt = Date.now();
        this.renderCompareHost();
    }

    updateSlideDrag(e) {
        if (!this.drag.active || e.pointerId !== this.drag.pointerId || !this.slideEnabled) return;
        const dx = Math.abs(e.clientX - this.drag.startX);
        const dy = Math.abs(e.clientY - this.drag.startY);
        const held = Date.now() - this.drag.startAt >= 120;
        if ((dx >= 4 || dy >= 4) && held) {
            this.drag.moved = true;
            this.updateSplitFromPointer(e.clientX);
            e.preventDefault();
        }
    }

    endSlideDrag(e) {
        if (e.pointerId !== this.drag.pointerId) return;
        this.drag.active = false;
        this.drag.pointerId = null;
        this.drag.moved = false;
        this.renderCompareHost();
    }

    updateSplitFromPointer(clientX) {
        const preview = document.getElementById('prismResultImage');
        if (!preview) return;
        const rect = preview.getBoundingClientRect();
        if (rect.width <= 0) return;
        const relativeX = Math.max(0, Math.min(rect.width, clientX - rect.left));
        this.splitPosition = Math.round((relativeX / rect.width) * 100);
        this.renderCompareHost();
    }

    startPan(e) {
        if (this.slideEnabled && e.target && e.target.id === 'prismResultImage') return;
        if (this.pan.scale <= 1) return;
        if (e.target && e.target.closest && e.target.closest('.prism-cell')) return;
        const startX = e.clientX;
        const startY = e.clientY;
        const origin = { x: this.pan.x, y: this.pan.y };
        const onMove = (ev) => {
            this.pan.x = origin.x + (ev.clientX - startX);
            this.pan.y = origin.y + (ev.clientY - startY);
            this.applyPanZoom();
        };
        const onUp = () => {
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
        };
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
    }

    onWheel(e) {
        if (!e.ctrlKey && !this.syncPanZoom && this.pan.scale === 1 && !e.altKey) return;
        e.preventDefault();
        const next = Math.max(1, Math.min(4, this.pan.scale + (e.deltaY > 0 ? -0.1 : 0.1)));
        this.pan.scale = Math.round(next * 10) / 10;
        if (this.pan.scale === 1) {
            this.pan.x = 0;
            this.pan.y = 0;
        }
        this.applyPanZoom();
    }

    applyPanZoom() {
        const transform = `translate(${this.pan.x}px, ${this.pan.y}px) scale(${this.pan.scale})`;
        const sourceImg = document.getElementById('prismSourcePaneImage');
        const resultHost = document.getElementById('prismPreviewHit');
        const ladderImgs = this.modal.querySelectorAll('.prism-ladder-pane img');
        if (this.syncPanZoom) {
            if (sourceImg) sourceImg.style.transform = transform;
            if (resultHost) resultHost.style.transform = transform;
            ladderImgs.forEach((img) => { img.style.transform = transform; });
        } else {
            if (sourceImg) sourceImg.style.transform = '';
            if (resultHost) resultHost.style.transform = '';
            ladderImgs.forEach((img) => { img.style.transform = ''; });
        }
    }

    render() {
        if (!this.modal) return;
        this.modal.dataset.prismMode = this.mode;
        this.modal.dataset.prismPicker = this.pickerOpen ? '1' : '0';
        this.renderToolbar();
        this.renderPanes();
        this.renderCompareHost();
        this.renderFilmstrip();
        this.renderGrid();
        this.renderPicker();
        this.syncLoupe();
        this.applyPanZoom();
    }

    renderToolbar() {
        this.modal.querySelectorAll('[data-prism-mode]').forEach((btn) => {
            btn.classList.toggle('is-active', btn.getAttribute('data-prism-mode') === this.mode);
        });
        this.toggleIndicator('prismSyncBtn', this.syncPanZoom);
        this.toggleIndicator('prismOverlayBtn', this.overlayEnabled);
        this.toggleIndicator('prismSlideBtn', this.slideEnabled);
        this.toggleIndicator('prismLoupeRevealBtn', this.loupeRevealEnabled);
        const sourceBtn = document.getElementById('prismUseAsSourceBtn');
        const source = this.sourceItem();
        const result = this.resultItem();
        if (sourceBtn) {
            if (!source) {
                sourceBtn.setAttribute('data-state', 'off');
                sourceBtn.title = 'Enable Comparison';
            } else if (result && source.filename === result.filename) {
                sourceBtn.setAttribute('data-state', 'armed');
                sourceBtn.title = 'Disable Comparison';
            } else {
                sourceBtn.setAttribute('data-state', 'on');
                sourceBtn.title = 'Toggle Comparison View';
            }
        }
        const overlayOff = !this.overlayEnabled;
        ['prismOpacityBtn', 'prismBlendBtn', 'prismSourceColorBtn', 'prismResultColorBtn'].forEach((id) => {
            const el = document.getElementById(id);
            if (el) el.disabled = overlayOff;
        });
        this.setBtnLabel('prismOverlayBtn', this.overlayEnabled ? 'Overlay on' : 'Overlay off');
        this.setBtnLabel('prismOpacityBtn', `Opacity ${this.runtime.overlayOpacity}%`);
        this.setBtnLabel('prismBlendBtn', `Blend ${this.runtime.blendMode}`);
        const slideBtn = document.getElementById('prismSlideBtn');
        if (slideBtn) slideBtn.disabled = this.loupeRevealEnabled;
        const loupeBtn = document.getElementById('prismLoupeRevealBtn');
        if (loupeBtn) loupeBtn.disabled = this.slideEnabled;
        const meta = document.getElementById('prismMeta');
        if (meta) {
            const bits = [];
            if (result && result.seed != null) bits.push(`seed ${result.seed}`);
            if (source && result) bits.push(`${this.letterAt(this.sourceIndex)}|${this.letterAt(this.resultIndex)}`);
            bits.push(`${this.items.length} image${this.items.length === 1 ? '' : 's'}`);
            meta.textContent = bits.join(' · ');
        }
    }

    setBtnLabel(id, text) {
        const el = document.getElementById(id);
        if (!el) return;
        const label = el.querySelector('span');
        if (label) label.textContent = text;
    }

    toggleIndicator(id, on) {
        const el = document.getElementById(id);
        if (!el) return;
        el.classList.toggle('is-active', !!on);
        el.setAttribute('data-state', on ? 'on' : 'off');
    }

    renderPanes() {
        const empty = document.getElementById('prismEmpty');
        const panes = this.modal.querySelector('.prism-panes');
        const hasPair = this.items.length > 0;
        if (empty) empty.classList.toggle('hidden', hasPair || this.pickerOpen);
        if (panes) panes.classList.toggle('hidden', !hasPair || this.mode === 'grid');
        const source = this.sourceItem();
        const result = this.resultItem();
        const sourceImg = document.getElementById('prismSourcePaneImage');
        const sourceCap = document.getElementById('prismSourceCaption');
        const sourceLetter = document.getElementById('prismSourceLetter');
        const resultCap = document.getElementById('prismResultCaption');
        const resultLetter = document.getElementById('prismResultLetter');
        if (sourceImg) {
            if (source) {
                sourceImg.src = this.paneSrc(source);
                sourceImg.classList.remove('hidden');
            } else {
                sourceImg.removeAttribute('src');
                sourceImg.classList.add('hidden');
            }
        }
        if (sourceCap) sourceCap.textContent = 'Source';
        if (sourceLetter) sourceLetter.textContent = source ? this.letterAt(this.sourceIndex) : '';
        if (resultCap) resultCap.textContent = 'Current';
        if (resultLetter) resultLetter.textContent = result ? this.letterAt(this.resultIndex) : '';
        this.setPaneFoot('prismSourceFoot', source);
        this.setPaneFoot('prismResultFoot', result);
        this.renderLadderPanes();
    }

    ladderIndexes() {
        const out = [];
        this.items.forEach((_item, index) => {
            if (index !== this.sourceIndex && index !== this.resultIndex) out.push(index);
        });
        return out;
    }

    setPaneFoot(id, item) {
        const el = document.getElementById(id);
        if (!el) return;
        if (!item) {
            el.textContent = '';
            return;
        }
        const bits = [item.filename];
        if (item.seed != null) bits.push(`seed ${item.seed}`);
        el.textContent = bits.join(' · ');
    }

    renderLadderPanes() {
        const host = document.getElementById('prismLadderHost');
        if (!host) return;
        host.innerHTML = '';
        const extras = this.mode === 'side' ? this.ladderIndexes() : [];
        host.classList.toggle('hidden', extras.length === 0);
        extras.forEach((index) => {
            const item = this.items[index];
            const pane = document.createElement('div');
            pane.className = 'prism-pane prism-ladder-pane';
            pane.innerHTML = `<div class="prism-pane-caption"><span>Ladder ${this.letterAt(index)}</span><span>${this.letterAt(index)}</span></div><div class="prism-pane-frame"><img alt="" src="${this.paneSrc(item)}"></div><div class="prism-pane-foot"></div>`;
            pane.querySelector('.prism-pane-foot').textContent = item.filename;
            pane.addEventListener('click', (e) => this.focusCell(index, e.shiftKey));
            host.appendChild(pane);
        });
    }

    renderCompareHost() {
        const content = document.getElementById('prismPreviewContent');
        const resultImage = document.getElementById('prismResultImage');
        const sourceImage = document.getElementById('prismSourceOverlay');
        const source = this.sourceItem();
        const result = this.resultItem();
        if (!content || !resultImage || !sourceImage) return;

        if (result) {
            resultImage.src = this.paneSrc(result);
            resultImage.classList.remove('hidden');
        } else {
            resultImage.removeAttribute('src');
            resultImage.classList.add('hidden');
        }
        if (source && result && source.filename !== result.filename) {
            sourceImage.src = this.paneSrc(source);
            sourceImage.classList.remove('hidden');
        } else {
            sourceImage.removeAttribute('src');
            sourceImage.classList.add('hidden');
        }

        const hasSource = Boolean(source && result && source.filename !== result.filename && sourceImage.src);
        const effOverlay = hasSource && this.overlayEnabled && !this.viewQuickSuspended;
        const effSlide = hasSource && this.slideEnabled && !this.viewQuickSuspended;
        const inspect = hasSource && (this.tempShowSource || this.tempHideSource);
        const showBoth = hasSource && effSlide && this.drag.active && this.drag.moved;
        content.style.setProperty('--compare-split', `${this.splitPosition}%`);
        content.classList.toggle('compare-has-source', hasSource);
        content.classList.toggle('compare-overlay-on', hasSource && effOverlay);
        content.classList.toggle('compare-slide-on', hasSource && effSlide);
        content.classList.toggle('compare-loupe-reveal-on', hasSource && this.loupeRevealEnabled);
        content.classList.toggle('compare-temp-show-source', hasSource && this.tempShowSource);
        content.classList.toggle('compare-temp-hide-source', hasSource && this.tempHideSource);
        content.classList.toggle('compare-show-both-labels', showBoth);
        content.classList.toggle('compare-show-source-label', hasSource && this.tempShowSource && !showBoth);
        content.classList.toggle('compare-show-result-label', hasSource && this.tempHideSource && !showBoth);
        content.classList.toggle('compare-drag-split-active', showBoth);

        // COMPARE_COLOR_FILTERS / COMPARE_BLEND_MODES: public/scripts/comp/compareViewManager.js
        const blendMode = COMPARE_BLEND_MODES.indexOf(this.runtime.blendMode) >= 0 ? this.runtime.blendMode : 'normal';
        sourceImage.style.mixBlendMode = 'normal';
        sourceImage.style.filter = inspect ? '' : (COMPARE_COLOR_FILTERS[this.runtime.sourceColor] || '');
        sourceImage.style.opacity = '';
        sourceImage.style.zIndex = '';
        sourceImage.style.clipPath = 'none';
        resultImage.style.mixBlendMode = 'normal';
        resultImage.style.filter = inspect ? '' : (COMPARE_COLOR_FILTERS[this.runtime.generationColor] || '');
        resultImage.style.opacity = '';
        resultImage.style.zIndex = '';
        resultImage.style.clipPath = 'none';

        if (inspect && hasSource) {
            if (this.tempShowSource) {
                sourceImage.style.zIndex = '4';
                resultImage.style.zIndex = '2';
                sourceImage.style.opacity = '1';
                resultImage.style.opacity = '0';
            } else {
                sourceImage.style.zIndex = '2';
                resultImage.style.zIndex = '4';
                sourceImage.style.opacity = '0';
                resultImage.style.opacity = '1';
                sourceImage.style.clipPath = 'inset(0 100% 0 0)';
            }
            return;
        }
        if (!hasSource) return;
        const overlayOpacity = `${(this.runtime.overlayOpacity || 50) / 100}`;
        const splitClip = 'inset(0 calc(100% - var(--compare-split, 50%)) 0 0)';
        const priGen = this.runtime.priority === 'generation';
        if (effOverlay && effSlide) {
            if (priGen) {
                sourceImage.style.zIndex = '1';
                resultImage.style.zIndex = '4';
                sourceImage.style.opacity = '1';
                resultImage.style.opacity = overlayOpacity;
                resultImage.style.mixBlendMode = blendMode;
                resultImage.style.clipPath = splitClip;
            } else {
                sourceImage.style.zIndex = '4';
                resultImage.style.zIndex = '2';
                sourceImage.style.opacity = overlayOpacity;
                resultImage.style.opacity = '1';
                sourceImage.style.mixBlendMode = blendMode;
                sourceImage.style.clipPath = splitClip;
            }
        } else if (effOverlay) {
            if (priGen) {
                sourceImage.style.zIndex = '1';
                resultImage.style.zIndex = '4';
                sourceImage.style.opacity = '1';
                resultImage.style.opacity = overlayOpacity;
                resultImage.style.mixBlendMode = blendMode;
            } else {
                sourceImage.style.zIndex = '4';
                resultImage.style.zIndex = '2';
                sourceImage.style.opacity = overlayOpacity;
                resultImage.style.opacity = '1';
                sourceImage.style.mixBlendMode = blendMode;
            }
        } else if (effSlide) {
            sourceImage.style.zIndex = '4';
            resultImage.style.zIndex = '2';
            sourceImage.style.opacity = '1';
            resultImage.style.opacity = '1';
            sourceImage.style.clipPath = splitClip;
        }
    }

    renderFilmstrip() {
        const strip = document.getElementById('prismFilmstrip');
        if (!strip) return;
        strip.innerHTML = '';
        if (!this.items.length || this.mode === 'grid') return;
        this.items.forEach((item, index) => strip.appendChild(this.buildCell(item, index)));
    }

    renderGrid() {
        const grid = document.getElementById('prismGrid');
        if (!grid) return;
        grid.innerHTML = '';
        if (this.mode !== 'grid') return;
        this.items.forEach((item, index) => grid.appendChild(this.buildCell(item, index)));
    }

    buildCell(item, index) {
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'prism-cell';
        if (index === this.sourceIndex) cell.classList.add('is-source');
        if (index === this.resultIndex) cell.classList.add('is-result');
        const role = index === this.sourceIndex ? 'source' : (index === this.resultIndex ? 'current' : 'ladder');
        cell.innerHTML = `<div class="prism-cell-head"><span>${this.letterAt(index)}</span><span>${role}</span></div><div class="prism-cell-body"><img alt="" src="${item.previewUrl || item.url}"></div>`;
        cell.addEventListener('click', (e) => this.focusCell(index, e.shiftKey));
        return cell;
    }

    renderPicker() {
        const picker = document.getElementById('prismPicker');
        if (!picker) return;
        picker.classList.toggle('hidden', !this.pickerOpen);
        if (!this.pickerOpen) return;
        const grid = document.getElementById('prismPickerGrid');
        const qEl = document.getElementById('prismPickerSearch');
        if (!grid) return;
        const q = qEl ? String(qEl.value || '').toLowerCase() : '';
        const pool = this.galleryImagePool() || [];
        const inSet = new Set(this.itemFilenames());
        grid.innerHTML = '';
        let shown = 0;
        pool.some((image) => {
            if (shown >= 80) return true;
            const name = image.upscaled || image.original || image.filename;
            if (!name) return false;
            if (q && String(name).toLowerCase().indexOf(q) === -1) return false;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'prism-picker-item' + (inSet.has(name) ? ' is-in-set' : '');
            btn.title = name;
            const img = document.createElement('img');
            img.alt = '';
            img.src = resolveGalleryPreviewUrl(image) || localGalleryImageUrl(name);
            btn.appendChild(img);
            btn.addEventListener('click', () => {
                if (inSet.has(name)) this.removeFilename(name);
                else this.addFilename(name);
            });
            grid.appendChild(btn);
            shown += 1;
            return false;
        });
        if (!shown) {
            const empty = document.createElement('p');
            empty.className = 'prism-empty';
            empty.textContent = pool.length ? 'No filenames match.' : 'No gallery images loaded.';
            grid.appendChild(empty);
        }
    }

    syncLoupe() {
        const want = (this.mode === 'loupe' || this.loupeRevealEnabled) && this.resultItem();
        if (!want) {
            this.destroyLoupe();
            return;
        }
        if (this.loupeHandle) {
            this.loupeHandle.refresh();
            return;
        }
        const hostEl = this.modal.querySelector('.prism-loupe-host');
        const hoverScopeEl = document.getElementById('prismPreviewContent');
        const imageHitAreaEl = document.getElementById('prismPreviewHit');
        if (!hostEl || !hoverScopeEl || !imageHitAreaEl) return;
        // attachImageLoupe: public/scripts/comp/imageLoupe.js
        this.loupeHandle = attachImageLoupe({
            hostEl,
            hoverScopeEl,
            imageHitAreaEl,
            getImageEl: () => {
                const img = document.getElementById('prismResultImage');
                if (!img || img.classList.contains('hidden') || !img.src) return null;
                return img;
            },
            getSampleImageEl: () => {
                if (!this.loupeRevealEnabled && this.mode !== 'loupe') return null;
                const src = document.getElementById('prismSourceOverlay');
                if (!src || src.classList.contains('hidden') || !src.src) return null;
                return src;
            },
            isCompareRevealMode: () => this.loupeRevealEnabled || this.mode === 'loupe',
            isCompareRevealReady: () => Boolean(this.sourceItem() && this.resultItem() && this.sourceItem().filename !== this.resultItem().filename),
            onRequestRevealMode: () => {
                this.loupeRevealEnabled = true;
                this.slideEnabled = false;
                this.render();
            },
            onLoupeInactive: () => {},
            storageKey: 'imageLoupe.prism',
            enabled: () => {
                const img = document.getElementById('prismResultImage');
                return !!(img && !img.classList.contains('hidden') && img.src && img.naturalWidth > 0);
            }
        });
    }

    destroyLoupe() {
        if (!this.loupeHandle) return;
        this.loupeHandle.destroy();
        this.loupeHandle = null;
    }
}

const prismApplet = new PrismApplet();
