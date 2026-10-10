/** Staged generation results review window — placeholders fill as saved stages land. */

function parseRequestPrintCount(requestBody) {
    // parseGenerationPrintCount: public/scripts/comp/utilities.js
    return parseGenerationPrintCount(requestBody?.n);
}

function collectExpectedPrintSlots(printCount) {
    const slots = [];
    for (let i = 0; i < printCount; i++) {
        slots.push({
            currentStage: i + 1,
            stageIndex: i,
            stageId: String(i + 1).padStart(2, '0'),
            stageType: 'print',
            label: `Print ${i + 1}`,
            hex: String(i + 1).padStart(2, '0')
        });
    }
    return slots;
}

function collectExpectedSavedStageSlots(requestBody) {
    const pipeline = Array.isArray(requestBody?.pipeline) ? requestBody.pipeline : [];
    // calculateStageHexIdsFromData / getPipelineStageMenuLabel: public/scripts/comp/pipelineStageManager.js
    const hexIds = calculateStageHexIdsFromData(pipeline);
    const slots = [];

    if (requestBody.save_base_output === true) {
        const label = getPipelineStageMenuLabel(0);
        slots.push({
            currentStage: 1,
            stageIndex: 0,
            stageId: '00',
            stageType: 'base',
            label: label.text,
            hex: label.hex
        });
    }

    for (let i = 0; i < pipeline.length; i++) {
        const stage = pipeline[i];
        const isBranchStage = stage.branch === true;
        const nextIsBranch = pipeline[i + 1] && pipeline[i + 1].branch === true;
        const isLastInBranchChain = isBranchStage && !nextIsBranch;
        const shouldSave = stage.saveResults || isLastInBranchChain || (i === pipeline.length - 1) || stage.stopAtStage;
        if (shouldSave) {
            const stageIndex = i + 1;
            const label = getPipelineStageMenuLabel(stageIndex);
            const hex = hexIds[i] || label.hex;
            slots.push({
                currentStage: stageIndex + 1,
                stageIndex,
                stageId: hex,
                stageType: stage.type,
                label: label.text,
                hex
            });
        }
        if (stage.stopAtStage) break;
    }

    return slots;
}

function pngMetaFromPreview(metadata) {
    if (!metadata) return null;
    if (metadata.forge_data || metadata.pipeline || metadata.seed != null) return metadata;
    if (metadata.metadata && (metadata.metadata.forge_data || metadata.metadata.seed != null)) return metadata.metadata;
    return metadata;
}

function buildChainResultSlots(files, metadata) {
    const pngMeta = pngMetaFromPreview(metadata);
    const forge = pngMeta && pngMeta.forge_data;
    const pipeline = Array.isArray(pngMeta && pngMeta.pipeline)
        ? pngMeta.pipeline
        : (forge && Array.isArray(forge.pipeline) ? forge.pipeline : []);
    // calculateStageHexIdsFromData / getPipelineStageMenuLabel / resolvePipelineStageTypeMeta: public/scripts/comp/pipelineStageManager.js
    const hexIds = calculateStageHexIdsFromData(pipeline);
    const liveCount = pipelineStagesContainer
        ? pipelineStagesContainer.querySelectorAll('.pipeline-stage-item').length
        : 0;
    const useLiveLabels = pipeline.length > 0 && liveCount === pipeline.length;
    return files.map((file) => {
        const stageIndex = Number(file.stageIndex) || 0;
        let label;
        let hex;
        let stageType = 'stage';
        if (stageIndex <= 0) {
            const base = getPipelineStageMenuLabel(0);
            label = base.text;
            hex = '00';
            stageType = 'base';
        } else if (useLiveLabels) {
            const live = getPipelineStageMenuLabel(stageIndex);
            label = live.text;
            hex = live.hex;
            const stage = pipeline[stageIndex - 1];
            stageType = (stage && stage.type) || 'stage';
        } else {
            const stage = pipeline[stageIndex - 1] || {};
            const meta = resolvePipelineStageTypeMeta(stage.type, {
                useBaseImage: stage.useBaseImage === true,
                maxEnhance: stage.maxEnhance === true
            });
            const name = stage.displayName ? String(stage.displayName).trim() : meta.typeName;
            label = `Stage ${stageIndex} — ${name}`;
            hex = hexIds[stageIndex - 1] || String(stageIndex).padStart(2, '0');
            stageType = stage.type || 'stage';
        }
        return {
            currentStage: stageIndex + 1,
            stageIndex,
            stageId: hex,
            stageType,
            label,
            hex,
            filename: file.filename
        };
    });
}

class StageResultsReviewManager {
    constructor() {
        this.element = null;
        this.gallery = null;
        this.titleEl = null;
        this.scrollShell = null;
        this.sessionActive = false;
        this.printMode = false;
    }

    init() {
        this.element = document.getElementById('stageResultsReview');
        this.gallery = document.getElementById('stageResultsGallery');
        this.titleEl = document.getElementById('stageResultsReviewTitle');
        if (!this.element || !this.gallery) return;

        this.scrollShell = this.element.querySelector('.stage-results-scroll-shell');
        transientWindowsWithPositions.add('stage-results-review');
        // linkToolWindowToParent / addResizeHandles / openModal / closeModal / bringModalToFront: public/scripts/comp/modalUtils.js
        linkToolWindowToParent(this.element, document.getElementById('manualModal'));
        if (!this.element.querySelector('.resize-handle')) {
            addResizeHandles(this.element);
        }

        document.getElementById('stageResultsReviewCloseBtn')?.addEventListener('click', () => {
            closeModal(this.element);
        });
        this.gallery.addEventListener('click', (event) => this.onGalleryClick(event));
    }

    isStagedRequest(requestBody) {
        const printCount = parseRequestPrintCount(requestBody);
        if (printCount > 1) return true;
        return Array.isArray(requestBody?.pipeline)
            && requestBody.pipeline.length > 0
            && requestBody.skip_pipeline_stages !== true;
    }

    openForGeneration(requestBody) {
        if (!this.element || !this.gallery || !this.isStagedRequest(requestBody)) {
            this.sessionActive = false;
            this.printMode = false;
            return;
        }

        const printCount = parseRequestPrintCount(requestBody);
        this.printMode = printCount > 1;
        const slots = this.printMode
            ? collectExpectedPrintSlots(printCount)
            : collectExpectedSavedStageSlots(requestBody);
        if (slots.length === 0) {
            this.sessionActive = false;
            this.printMode = false;
            return;
        }

        this.sessionActive = true;
        this.renderSlots(slots);
        this.show();
    }

    show() {
        if (!this.element) return;
        if (this.element.classList.contains('minimised')) {
            // restoreMinimizedModal: public/scripts/comp/modalUtils.js
            restoreMinimizedModal(this.element, null);
        }
        openModal(this.element);
        bringModalToFront(this.element);
        this.reinitScrollbar();
    }

    previewChainFilename() {
        const image = currentManualPreviewImage;
        if (!image) return '';
        if (image.original && !String(image.original).includes('_upscaled')) return image.original;
        if (image.filename && !String(image.filename).includes('_upscaled')) return image.filename;
        return image.original || image.filename || image.upscaled || '';
    }

    hasResults() {
        return !!(this.gallery && this.gallery.querySelector('.gallery-item'));
    }

    async openFromStudio() {
        if (!this.element || !this.gallery) return;
        if (this.sessionActive) {
            this.show();
            return;
        }
        const filename = this.previewChainFilename();
        if (filename && this.gallery.querySelector(`.gallery-item[data-stage-filename="${CSS.escape(filename)}"]`)) {
            this.show();
            return;
        }
        if (!filename) {
            if (this.hasResults()) this.show();
            else showGlassToast('info', 'Stage Results', 'Load an image in Studio first', false);
            return;
        }

        let metadata = currentManualPreviewImage && currentManualPreviewImage.metadata;
        if (!metadata) {
            // getImageMetadata: public/scripts/comp/galleryView.js
            metadata = await getImageMetadata(filename);
        }
        let files = [];
        try {
            const data = await wsClient.requestStageChain(filename);
            files = (data && data.files) || [];
        } catch (error) {
            showGlassToast('error', 'Stage Results', error.message || 'Could not load the generation chain', false);
            return;
        }
        if (!files.length) {
            const pngMeta = pngMetaFromPreview(metadata);
            const seeds = pngMeta && pngMeta.forge_data && pngMeta.forge_data.stage_seeds;
            files = [{ filename, stageIndex: Array.isArray(seeds) ? seeds.length : 0 }];
        }
        const slots = buildChainResultSlots(files, metadata);
        this.printMode = false;
        this.sessionActive = false;
        this.renderSlots(slots);
        slots.forEach((slot, index) => {
            const item = this.gallery.children[index];
            if (item && slot.filename) this.fillSlot(item, slot.filename);
        });
        this.show();
    }

    releaseSession() {
        this.sessionActive = false;
        this.clearGenerating();
    }

    renderSlots(slots) {
        this.gallery.replaceChildren();
        slots.forEach((slot) => {
            const item = document.createElement('div');
            item.className = 'gallery-item gallery-placeholder';
            item.dataset.currentStage = String(slot.currentStage);
            item.dataset.stageIndex = String(slot.stageIndex);
            item.dataset.stageId = slot.stageId || '';
            item.dataset.stageType = slot.stageType || '';
            item.dataset.label = slot.label;
            item.dataset.hex = slot.hex || '';

            const overlay = document.createElement('div');
            overlay.className = 'gallery-item-overlay';
            const title = document.createElement('div');
            title.className = 'gallery-item-title';
            title.textContent = slot.label;
            const info = document.createElement('div');
            info.className = 'gallery-item-info';
            info.textContent = 'Waiting';
            overlay.append(title, info);
            item.appendChild(overlay);
            this.gallery.appendChild(item);
        });
        this.syncTitle();
    }

    findSlot(currentStage) {
        if (!this.gallery || currentStage == null) return null;
        return this.gallery.querySelector(`.gallery-item[data-current-stage="${currentStage}"]`);
    }

    clearGenerating() {
        if (!this.gallery) return;
        this.gallery.querySelectorAll('.gallery-item.gallery-generating').forEach((item) => {
            item.classList.remove('gallery-generating');
            item.querySelector('.gallery-generating-overlay')?.remove();
        });
    }

    markGenerating(data) {
        if (!this.sessionActive || !this.gallery) return;
        const currentStage = data.currentStage;
        this.gallery.querySelectorAll('.gallery-item.gallery-generating').forEach((item) => {
            if (Number(item.dataset.currentStage) !== Number(currentStage)) {
                item.classList.remove('gallery-generating');
                item.querySelector('.gallery-generating-overlay')?.remove();
            }
        });

        const item = this.findSlot(currentStage);
        if (!item || item.dataset.stageFilename) return;

        if (!item.classList.contains('gallery-generating')) {
            item.classList.add('gallery-generating');
            // buildGalleryRerollGeneratingInnerHtml: public/scripts/comp/galleryView.js
            item.insertAdjacentHTML('beforeend', buildGalleryRerollGeneratingInnerHtml());
        }

        const status = item.querySelector('.gallery-generating-status');
        if (status) {
            // getGenerationStatusMessage: public/scripts/comp/generationProgress.js
            status.textContent = getGenerationStatusMessage(data);
        }
        const bar = item.querySelector('.gallery-generating-progress-bar');
        if (bar && data.totalSteps) {
            const step = Number(data.currentStep) || 0;
            bar.style.width = `${Math.max(0, Math.min(100, (step / data.totalSteps) * 100))}%`;
        }
        const info = item.querySelector('.gallery-item-info');
        if (info) info.textContent = 'Generating';
    }

    fillSlot(item, filename) {
        if (!item || !filename) return;

        item.dataset.stageFilename = filename;
        item.classList.remove('gallery-placeholder', 'gallery-generating');
        item.classList.add('fade-in');
        item.querySelector('.gallery-generating-overlay')?.remove();

        // localGalleryImageUrl: public/scripts/comp/assetUrlResolver.js
        const src = localGalleryImageUrl(filename);
        let img = item.querySelector('img:not(.gallery-generating-step-preview)');
        if (!img) {
            img = document.createElement('img');
            img.alt = item.dataset.label || filename;
            item.insertBefore(img, item.firstChild);
        }
        img.src = src;

        const info = item.querySelector('.gallery-item-info');
        if (info) info.textContent = 'Saved';
        this.ensureResultChrome(item);
        this.syncTitle();
    }

    imageForItem(item) {
        if (!item) return null;
        const filename = item.dataset.stageFilename;
        if (!filename) return null;
        // findImageByFilename: public/scripts/comp/galleryView.js
        const known = findImageByFilename(filename);
        if (known) return known;
        return { filename: filename, original: filename };
    }

    menuConfig() {
        if (this._menuConfig) return this._menuConfig;
        // createManualPreviewImageContextMenuConfig: public/scripts/comp/manualModalManager.js
        const config = createManualPreviewImageContextMenuConfig();
        const manager = this;
        config.beforeShow = (_event, target) => {
            manager._menuItem = target && target.closest ? target.closest('.gallery-item') : null;
        };
        config.sections.forEach((section) => {
            if (section.icons) {
                section.icons.forEach((icon) => {
                    if (icon.action !== 'toggle-favorite') return;
                    icon.loadfn = (menuItem, target) => {
                        const galleryItem = target && target.closest ? target.closest('.gallery-item') : null;
                        const image = manager.imageForItem(galleryItem);
                        const filename = image && (image.filename || image.original || image.upscaled);
                        // checkIfImageIsPinned: public/scripts/comp/galleryView.js
                        const isPinned = filename ? checkIfImageIsPinned(filename) : false;
                        menuItem.icon = isPinned ? 'fa-solid fa-star' : 'fa-regular fa-star';
                        menuItem.tooltip = isPinned ? 'Unfavorite' : 'Favorite';
                    };
                });
            }
            if (!section.items) return;
            section.items.forEach((menuItem, index) => {
                if (menuItem.action === 'view-image-data') menuItem.disabled = false;
                if (menuItem.text === 'Original') {
                    // buildUnupscaledOriginalContextMenuItem: public/scripts/comp/galleryView.js
                    section.items[index] = buildUnupscaledOriginalContextMenuItem(() => manager.imageForItem(manager._menuItem));
                }
            });
        });
        const list = config.sections.find((section) => section.type === 'list' && section.items);
        if (list) {
            list.items.unshift({
                icon: 'fas fa-crown',
                text: 'Use this phase',
                action: 'use-phase',
                hidden: () => manager.printMode || !manager.phasewalkerActive()
            });
        }
        config.onAction = (action, target, item) => {
            handleStageResultMenuAction(action, target, item);
        };
        this._menuConfig = config;
        return config;
    }

    makeActionButton(iconClass, title, onClick) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn-primary round-button';
        btn.title = title;
        btn.innerHTML = `<i class="${iconClass}"></i>`;
        btn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            onClick(event);
        });
        return btn;
    }

    ensureResultChrome(item) {
        if (!item || item.querySelector('.gallery-actions')) {
            if (item && contextMenu && !item.dataset.contextMenu) {
                contextMenu.attachToElement(item, this.menuConfig());
            }
            return;
        }
        const overlay = item.querySelector('.gallery-item-overlay');
        if (!overlay) return;

        const actions = document.createElement('div');
        actions.className = 'gallery-actions';

        const modifyBtn = this.makeActionButton('fas fa-arrow-left', 'Modify', () => {
            const image = this.imageForItem(item);
            if (!image) return;
            // openManualModalWithContent: public/scripts/comp/manualModalManager.js
            openManualModalWithContent({ type: 'image', image: image });
        });

        const crownBtn = this.makeActionButton('fas fa-crown', 'Use this phase', () => {
            void this.useThisPhase(item);
        });
        crownBtn.classList.add('stage-result-use-phase');
        if (this.printMode || !this.phasewalkerActive()) crownBtn.classList.add('hidden');

        const pinBtn = this.makeActionButton('fa-regular fa-star', 'Favorite', () => {
            const image = this.imageForItem(item);
            if (!image) return;
            // togglePinImage / checkIfImageIsPinned: public/scripts/comp/galleryView.js
            togglePinImage(image, pinBtn).then(() => {
                const pinned = checkIfImageIsPinned(image.filename || image.original);
                pinBtn.title = pinned ? 'Unfavorite' : 'Favorite';
            });
        });
        pinBtn.classList.add('stage-result-pin');
        const image = this.imageForItem(item);
        if (image) {
            // applyPinButtonState: public/scripts/comp/galleryView.js
            const pinned = checkIfImageIsPinned(image.filename || image.original);
            applyPinButtonState(pinBtn, pinned);
            pinBtn.title = pinned ? 'Unfavorite' : 'Favorite';
        }

        const downloadBtn = this.makeActionButton('fas fa-download', 'Download', () => {
            const image = this.imageForItem(item);
            if (!image) return;
            // downloadImage: public/scripts/comp/galleryView.js
            downloadImage({ filename: image.filename, original: image.original || image.filename, upscaled: image.upscaled });
        });

        actions.append(modifyBtn, crownBtn, pinBtn, downloadBtn);
        overlay.appendChild(actions);

        if (contextMenu) contextMenu.attachToElement(item, this.menuConfig());
    }

    phasewalkerActive() {
        const container = document.getElementById('pipelineStagesContainer');
        if (container && container.querySelector('.pipeline-stage-item[data-managed="true"]')) return true;
        return requestBodyReplacements.some((row) => row.managed);
    }

    async useThisPhase(item) {
        if (this.printMode) return;
        if (!this.phasewalkerActive()) {
            showGlassToast('info', null, 'Phasewalker is not compiled', false, 3000, '<i class="fas fa-crown"></i>');
            return;
        }
        // featureLoader.loadFeature: public/scripts/comp/featureLoader.js
        await featureLoader.loadFeature('bracket_gen');
        const stageIndex = Number(item && item.dataset.stageIndex);
        if (!Number.isFinite(stageIndex)) return;
        const ok = await bracketGenerationApplet.confirmSaveBeforeUnload();
        if (!ok) return;
        // bracketGenBakeStageIntoPrompts: public/scripts/comp/bracketGenerationApplet.js
        const baked = bracketGenBakeStageIntoPrompts(stageIndex);
        if (!baked) {
            showGlassToast('warning', null, 'No phase to take over', false, 4000, '<i class="fas fa-crown"></i>');
            return;
        }
        bracketGenerationApplet.updateChrome();
        showGlassToast('success', null, 'Took over this phase', false, 3000, '<i class="fas fa-crown"></i>');
    }

    async runImageAction(action, target) {
        const galleryItem = target && target.closest ? target.closest('.gallery-item') : null;
        const image = this.imageForItem(galleryItem);
        if (!image) return;
        const filename = image.filename || image.original || image.upscaled;
        const pinBtn = galleryItem ? galleryItem.querySelector('.stage-result-pin') : null;

        switch (action) {
            case 'modify-preview':
                // openManualModalWithContent: public/scripts/comp/manualModalManager.js
                await openManualModalWithContent({ type: 'image', image: image });
                break;
            case 'load-base-image':
                // applyImageAsVariationBase: public/scripts/comp/manualModalManager.js
                applyImageAsVariationBase(image);
                break;
            case 'toggle-favorite':
                await togglePinImage(image, pinBtn);
                if (pinBtn) {
                    pinBtn.title = checkIfImageIsPinned(filename) ? 'Unfavorite' : 'Favorite';
                }
                break;
            case 'download':
                downloadImage({ filename: filename, original: image.original || filename, upscaled: image.upscaled });
                break;
            case 'copy':
                // copyImageToClipboard: public/scripts/comp/galleryView.js
                copyImageToClipboard(image);
                break;
            case 'open-in-window':
                // openGalleryImageInViewer: public/scripts/comp/galleryView.js
                openGalleryImageInViewer(image);
                break;
            case 'view-image-data':
                // featureLoader: public/scripts/comp/featureLoader.js
                void featureLoader.loadFeature('image_prompt_inspector').then(() => {
                    openImagePromptInspector(image);
                });
                break;
            case 'scrap-preview':
                if (currentGalleryView === 'scraps') {
                    // removeFromScraps: public/scripts/comp/galleryView.js
                    removeFromScraps(image);
                } else {
                    moveImageToScraps(image);
                }
                break;
            case 'delete-preview':
                // deleteImage: public/scripts/comp/galleryView.js
                deleteImage(image);
                break;
            case 'copy-lookback':
                // copyLookbackImage: public/scripts/comp/copyLookback.js
                copyLookbackImage(filename);
                break;
            case 'ask-wren':
                // askWrenAboutImage: public/scripts/comp/director.js
                askWrenAboutImage(filename);
                break;
            case 'start-chat':
                // featureLoader: public/scripts/comp/featureLoader.js
                // chatSystem: public/scripts/comp/chatSystem.js
                void featureLoader.loadFeature('chat').then(() => {
                    if (chatSystem) chatSystem.openChatModal(filename, image.characterName || null);
                });
                break;
            case 'set-wallpaper':
                // openDesktopSettingsModal: public/scripts/comp/desktopShortcuts.js
                openDesktopSettingsModal(`file:${filename}`);
                break;
            case 'create-desktop-shortcut':
                createDesktopShortcutFromImage(image);
                break;
            case 'upscale':
                // upscaleImage: public/scripts/comp/galleryActions.js
                upscaleImage(image);
                break;
            case 'expand-canvas':
                expandCanvasFromGallery(image);
                break;
            case 'enhance':
                // openEnhanceFromImage: public/scripts/comp/imageExpansion.js
                openEnhanceFromImage(image, { isStudio: true });
                break;
            case 'copy-original':
            case 'download-original':
            case 'expand-canvas-original':
            case 'delete-original':
                // handleUnupscaledOriginalContextAction: public/scripts/comp/galleryView.js
                handleUnupscaledOriginalContextAction(action, image);
                break;
            default:
                break;
        }
    }

    applyProgress(data) {
        if (!this.sessionActive || !data) return;
        if (this.printMode && data.stageType !== 'print') return;

        if (data.phase === 'generating' || data.phase === 'stage_delay' || data.phase === 'upscaling' || data.phase === 'previews') {
            this.markGenerating(data);
        }

        if ((data.phase === 'stage_complete' || data.phase === 'complete') && data.filename) {
            const item = this.findSlot(data.currentStage)
                || this.gallery.querySelector('.gallery-item.gallery-generating')
                || this.gallery.querySelector('.gallery-item.gallery-placeholder');
            if (item) this.fillSlot(item, data.filename);
        }

        if (data.phase === 'error') {
            const item = this.findSlot(data.currentStage);
            if (item && !item.dataset.stageFilename) {
                const info = item.querySelector('.gallery-item-info');
                if (info) info.textContent = 'Failed';
                item.classList.remove('gallery-generating');
                item.querySelector('.gallery-generating-overlay')?.remove();
            }
        }
    }

    applySavedFilenames(filenames) {
        if (!this.gallery) return;
        const names = [];
        const list = Array.isArray(filenames) ? filenames : (filenames ? [filenames] : []);
        list.forEach((entry) => {
            const name = typeof entry === 'string' ? entry : entry?.filename;
            if (name) names.push(name);
        });
        if (names.length === 0) return;

        const items = Array.from(this.gallery.querySelectorAll('.gallery-item'));
        names.forEach((name, index) => {
            if (items[index]) this.fillSlot(items[index], name);
        });
        this.sessionActive = false;
        this.clearGenerating();
    }

    syncTitle() {
        if (!this.titleEl || !this.gallery) return;
        const total = this.gallery.querySelectorAll('.gallery-item').length;
        const filled = this.gallery.querySelectorAll('.gallery-item[data-stage-filename]').length;
        const heading = this.printMode ? 'Prints' : 'Stage Results';
        this.titleEl.textContent = total === 0
            ? heading
            : `${heading} · ${filled}/${total}`;
    }

    reinitScrollbar() {
        if (!this.scrollShell) return;
        // customScrollbar.forceReinit: public/scripts/comp/customScrollbar.js
        setTimeout(() => {
            customScrollbar.forceReinit(this.scrollShell);
        }, 0);
    }

    onGalleryClick(event) {
        if (event.target.closest('.gallery-actions')) return;
        const item = event.target.closest('.gallery-item');
        const filename = item?.dataset.stageFilename;
        if (!filename) return;
        // openImageInViewer: public/scripts/comp/imageViewer.js
        // localGalleryImageUrl: public/scripts/comp/assetUrlResolver.js
        openImageInViewer(localGalleryImageUrl(filename), item.dataset.label || filename, { filename });
    }
}

function handleStageResultMenuAction(action, target, item) {
    if (action === 'use-phase') {
        const galleryItem = target && target.closest ? target.closest('.gallery-item') : null;
        if (galleryItem) void stageResultsReviewManager.useThisPhase(galleryItem);
        return;
    }
    // studioIsPreviewMenuAction: public/scripts/comp/imageGenerationSettings.js
    if (studioIsPreviewMenuAction(action)) {
        void stageResultsReviewManager.runImageAction(action, target);
        return;
    }
    // handleImageGenerationSettingsMenuAction: public/scripts/comp/imageGenerationSettings.js
    handleImageGenerationSettingsMenuAction(action, target, item);
}

const stageResultsReviewManager = new StageResultsReviewManager();

function openStageResultsReview(requestBody) {
    stageResultsReviewManager.openForGeneration(requestBody);
}

function releaseStageResultsReviewSession() {
    stageResultsReviewManager.releaseSession();
}

function applyStageResultsReviewProgress(data) {
    stageResultsReviewManager.applyProgress(data);
}

function applyStageResultsReviewFilenames(filenames) {
    stageResultsReviewManager.applySavedFilenames(filenames);
}

wsClient.registerInitStep(40, 'Initializing stage results review', async () => {
    stageResultsReviewManager.init();
});
