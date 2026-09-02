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

        document.getElementById('stageResultsReviewCloseBtn').addEventListener('click', () => {
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
        if (this.element.classList.contains('minimised')) {
            // restoreMinimizedModal: public/scripts/comp/modalUtils.js
            restoreMinimizedModal(this.element, null);
        }
        openModal(this.element);
        bringModalToFront(this.element);
        this.reinitScrollbar();
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
        this.syncTitle();
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
        const item = event.target.closest('.gallery-item');
        const filename = item?.dataset.stageFilename;
        if (!filename) return;
        // openImageInViewer: public/scripts/comp/imageViewer.js
        // localGalleryImageUrl: public/scripts/comp/assetUrlResolver.js
        openImageInViewer(localGalleryImageUrl(filename), item.dataset.label || filename, { filename });
    }
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
