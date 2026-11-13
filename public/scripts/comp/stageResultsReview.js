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
    // The Studio's own labels (custom names, the managed Phasewalker names) only when its stages are
    // this image's stages: same count and the same type at every place, not just the same count
    const liveItems = pipelineStagesContainer
        ? Array.from(pipelineStagesContainer.querySelectorAll('.pipeline-stage-item'))
        : [];
    const useLiveLabels = pipeline.length > 0
        && liveItems.length === pipeline.length
        && liveItems.every((item, index) => !pipeline[index].type || item.dataset.stageType === pipeline[index].type);
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


// Vista art for this window's balloons (.cursor/rules/vista-icons-not-fa.mdc)
const STAGE_RESULTS_TOAST_ICONS = {
    phase: '<img src="/static_images/vista-icons/phasewalker-32.png" width="32" height="32" alt="">',
    info: '<img src="/static_images/vista-icons/info-32.png" width="32" height="32" alt="">',
    warning: '<img src="/static_images/vista-icons/warning-32.png" width="32" height="32" alt="">',
    error: '<img src="/static_images/vista-icons/error-32.png" width="32" height="32" alt="">'
};

/** The stage an expander writes to (bracketGenExpanderStageIndex in bracketGenerationApplet.js, which
 *  loads only with Phasewalker): stages [n, ...] or { start: n }. */
function stageResultExpanderStage(row) {
    if (!row || row.stages === undefined || row.stages === null) return null;
    if (Array.isArray(row.stages)) return row.stages.length ? Number(row.stages[0]) : null;
    if (typeof row.stages === 'object' && row.stages.start !== undefined) return Number(row.stages.start);
    return null;
}

/** Thumbnail for a saved file: the Studio preview WebP at the picture's own size (#648), not the PNG. */
function stageResultThumbUrl(filename) {
    // localGalleryImageUrl / studioPreviewDisplayUrl: public/scripts/comp/assetUrlResolver.js
    return studioPreviewDisplayUrl(localGalleryImageUrl(filename));
}

const STAGE_RESULT_STATE_TEXT = {
    waiting: 'Waiting',
    generating: 'Rendering',
    saved: '',
    failed: 'Failed',
    stopped: 'Not saved'
};

class StageResultsReviewManager {
    constructor() {
        this.element = null;
        this.view = null;
        this.titleEl = null;
        this.toolbar = null;
        this.summaryEl = null;
        this.detailEl = null;
        this.sessionActive = false;
        this.printMode = false;
        this.selected = null;
        this._menuConfig = null;
        this._reopenTimer = null;
    }

    init() {
        this.element = document.getElementById('stageResultsReview');
        this.view = document.getElementById('stageResultsView');
        this.titleEl = document.getElementById('stageResultsReviewTitle');
        if (!this.element || !this.view) return;
        this.toolbar = this.element.querySelector('.stage-results-toolbar');
        this.summaryEl = document.getElementById('stageResultsSummary');
        this.detailEl = document.getElementById('stageResultsDetail');

        transientWindowsWithPositions.add('stage-results-review');
        // linkToolWindowToParent / addResizeHandles / openModal / closeModal / bringModalToFront: public/scripts/comp/modalUtils.js
        linkToolWindowToParent(this.element, document.getElementById('manualModal'));
        if (!this.element.querySelector('.resize-handle')) {
            addResizeHandles(this.element);
        }

        document.getElementById('stageResultsReviewCloseBtn')?.addEventListener('click', () => {
            closeModal(this.element);
        });
        this.view.addEventListener('click', (event) => this.onViewClick(event));
        this.view.addEventListener('dblclick', (event) => this.onViewDoubleClick(event));
        this.view.addEventListener('keydown', (event) => this.onViewKeyDown(event));
        // a right-click selects first, as Explorer does (the menu then acts on that item)
        this.view.addEventListener('contextmenu', (event) => {
            const item = event.target.closest('.stage-result-item');
            if (item) this.select(item);
        }, true);
        this.view.addEventListener('focusin', () => this.syncDetails());
        if (this.toolbar) {
            this.toolbar.addEventListener('click', (event) => {
                const btn = event.target.closest('button[data-sr-cmd]');
                if (!btn || btn.disabled) return;
                void this.runCommand(btn.dataset.srCmd);
            });
            // Phasewalker can compile or unload while this window is open: look again before a click
            this.toolbar.addEventListener('pointerenter', () => this.syncToolbar());
        }
        this.renderEmpty();
    }

    isStagedRequest(requestBody) {
        const printCount = parseRequestPrintCount(requestBody);
        if (printCount > 1) return true;
        return Array.isArray(requestBody?.pipeline)
            && requestBody.pipeline.length > 0
            && requestBody.skip_pipeline_stages !== true;
    }

    openForGeneration(requestBody) {
        if (!this.element || !this.view || !this.isStagedRequest(requestBody)) {
            this.releaseSession();
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
        // the phone (#806): the progress box covers the generation; the results come up once it is done
        if (window.uiShell === 'mobile') { this.showWhenSaved = true; return; }
        this.show();
    }

    show() {
        if (!this.element) return;
        if (this.element.classList.contains('closing')) {
            // closeModal hides it only after the close animation (600 ms at most). openModal now
            // would see it as still open and return, and the late hide would win. Reopen after.
            this.showAfterClose();
            return;
        }
        if (this.element.classList.contains('minimised')) {
            // restoreMinimizedModal: public/scripts/comp/modalUtils.js
            restoreMinimizedModal(this.element, null);
        }
        openModal(this.element);
        bringModalToFront(this.element);
        this.syncToolbar();
    }

    showAfterClose() {
        if (this._reopenTimer) return;
        const startedAt = Date.now();
        const poll = () => {
            const closing = this.element.classList.contains('closing') && !this.element.classList.contains('hidden');
            if (closing && Date.now() - startedAt < 1500) {
                this._reopenTimer = setTimeout(poll, 50);
                return;
            }
            this._reopenTimer = null;
            this.element.classList.remove('closing');
            this.show();
        };
        this._reopenTimer = setTimeout(poll, 50);
    }

    isOpen() {
        return !!(this.element && !this.element.classList.contains('hidden') && !this.element.classList.contains('minimised'));
    }

    previewChainFilename() {
        const image = currentManualPreviewImage;
        if (!image) return '';
        if (image.original && !String(image.original).includes('_upscaled')) return image.original;
        if (image.filename && !String(image.filename).includes('_upscaled')) return image.filename;
        return image.original || image.filename || image.upscaled || '';
    }

    items() {
        return this.view ? Array.from(this.view.querySelectorAll('.stage-result-item')) : [];
    }

    hasResults() {
        return !!(this.view && this.view.querySelector('.stage-result-item'));
    }

    async openFromStudio() {
        if (!this.element || !this.view) return;
        if (this.sessionActive) {
            this.show();
            return;
        }
        const filename = this.previewChainFilename();
        if (filename && this.view.querySelector(`.stage-result-item[data-stage-filename="${CSS.escape(filename)}"]`)) {
            this.show();
            return;
        }
        if (!filename) {
            if (this.hasResults()) this.show();
            else showGlassToast('info', 'Stage Results', 'Load an image in Studio first', false, 4000, STAGE_RESULTS_TOAST_ICONS.info);
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
            showGlassToast('error', 'Stage Results', error.message || 'Could not load the generation chain', false, 5000, STAGE_RESULTS_TOAST_ICONS.error);
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
        const items = this.items();
        slots.forEach((slot, index) => {
            if (items[index] && slot.filename) this.fillSlot(items[index], slot.filename);
        });
        // the picture the Studio shows is the one selected
        const current = this.view.querySelector(`.stage-result-item[data-stage-filename="${CSS.escape(filename)}"]`);
        if (current) this.select(current);
        this.show();
    }

    /** The run ended (saved, failed or cancelled): slots that never got a file say so. */
    releaseSession() {
        this.sessionActive = false;
        this.items().forEach((item) => {
            const state = item.dataset.state;
            if (state === 'waiting' || state === 'generating') this.setItemState(item, 'stopped');
        });
        this.syncDetails();
    }

    renderEmpty() {
        if (!this.view) return;
        const empty = document.createElement('div');
        empty.className = 'stage-results-empty';
        empty.textContent = 'This folder is empty.';
        this.view.replaceChildren(empty);
        this.selected = null;
        this.syncTitle();
        this.syncDetails();
        this.syncToolbar();
    }

    renderSlots(slots) {
        const fragment = document.createDocumentFragment();
        slots.forEach((slot) => {
            const item = document.createElement('div');
            item.className = 'stage-result-item';
            item.setAttribute('role', 'option');
            item.setAttribute('aria-selected', 'false');
            item.dataset.currentStage = String(slot.currentStage);
            item.dataset.stageIndex = String(slot.stageIndex);
            item.dataset.stageId = slot.stageId || '';
            item.dataset.stageType = slot.stageType || '';
            item.dataset.label = slot.label;
            item.dataset.hex = slot.hex || '';
            item.title = slot.label;

            const thumb = document.createElement('div');
            thumb.className = 'stage-result-thumb';
            const frame = document.createElement('div');
            frame.className = 'stage-result-frame';
            thumb.appendChild(frame);

            const label = document.createElement('span');
            label.className = 'stage-result-label';
            label.textContent = slot.label;
            const status = document.createElement('span');
            status.className = 'stage-result-status';
            const progress = document.createElement('div');
            progress.className = 'stage-result-progress';
            progress.setAttribute('role', 'progressbar');
            progress.setAttribute('aria-valuemin', '0');
            progress.setAttribute('aria-valuemax', '100');
            progress.appendChild(document.createElement('div'));

            item.append(thumb, label, status, progress);
            this.setItemState(item, 'waiting');
            fragment.appendChild(item);
        });
        this.view.replaceChildren(fragment);
        this.view.scrollTop = 0;
        this.selected = null;
        this.syncTitle();
        this.syncDetails();
        this.syncToolbar();
    }

    setItemState(item, state, statusText) {
        if (!item) return;
        item.dataset.state = state;
        item.classList.toggle('is-generating', state === 'generating');
        item.classList.toggle('is-failed', state === 'failed');
        const status = item.querySelector('.stage-result-status');
        if (status) {
            const text = statusText != null ? statusText : STAGE_RESULT_STATE_TEXT[state];
            status.textContent = text || '';
        }
        if (state !== 'generating') {
            // a step preview that never became a saved picture goes with the state
            if (state !== 'saved') {
                const preview = item.querySelector('.stage-result-thumb > img.stage-result-step');
                if (preview) {
                    const frame = document.createElement('div');
                    frame.className = 'stage-result-frame';
                    preview.replaceWith(frame);
                }
            }
        }
    }

    findSlot(currentStage) {
        if (!this.view || currentStage == null) return null;
        return this.view.querySelector(`.stage-result-item[data-current-stage="${CSS.escape(String(currentStage))}"]`);
    }

    activeSlot() {
        return this.view ? this.view.querySelector('.stage-result-item.is-generating') : null;
    }

    markGenerating(data) {
        // a stage that saves nothing renders toward the next slot that does: that slot shows it
        const stage = Number(data.currentStage);
        const item = this.findSlot(data.currentStage)
            || this.items().find((entry) => entry.dataset.state === 'waiting' && Number(entry.dataset.currentStage) > stage);
        if (!item || item.dataset.stageFilename) return;
        this.items().forEach((other) => {
            if (other !== item && other.dataset.state === 'generating') this.setItemState(other, 'waiting');
        });
        if (item.dataset.state !== 'generating') this.setItemState(item, 'generating');
        this.updateSlotProgress(item, data);
    }

    /** Step count, status words and the latest step frame on a rendering slot. */
    updateSlotProgress(item, data) {
        if (!item) return;
        const bar = item.querySelector('.stage-result-progress');
        const fill = bar && bar.firstElementChild;
        if (fill && data.totalSteps) {
            const step = Math.max(0, Math.min(Number(data.totalSteps), Number(data.currentStep) || 0));
            const pct = Math.round((step / Number(data.totalSteps)) * 100);
            fill.style.width = `${pct}%`;
            bar.setAttribute('aria-valuenow', String(pct));
        }
        const status = item.querySelector('.stage-result-status');
        if (status) {
            let text = '';
            // getGenerationStatusMessage: public/scripts/comp/generationProgress.js
            if (typeof getGenerationStatusMessage === 'function') text = getGenerationStatusMessage(data) || '';
            if (!text && data.totalSteps) text = `Step ${Number(data.currentStep) || 0} of ${data.totalSteps}`;
            status.textContent = text || STAGE_RESULT_STATE_TEXT.generating;
        }
        if (!this.isOpen()) return;
        const frameData = data.imageData
            || (Array.isArray(data.stepFrames) && data.stepFrames.length
                ? data.stepFrames[data.stepFrames.length - 1].imageData
                : null);
        if (!frameData) return;
        const mime = data.imageFormat === 'png' ? 'image/png' : 'image/jpeg';
        const src = String(frameData).startsWith('data:') ? frameData : `data:${mime};base64,${frameData}`;
        const thumb = item.querySelector('.stage-result-thumb');
        if (!thumb) return;
        let img = thumb.querySelector('img.stage-result-step');
        if (!img) {
            img = document.createElement('img');
            img.className = 'stage-result-step';
            img.alt = '';
            // step frames come small: scale the frame up to the largest the box holds (245 x 246
            // with the photo frame's 11 px of white), as the saved picture fills it
            img.addEventListener('load', () => {
                const w = img.naturalWidth;
                const h = img.naturalHeight;
                if (!w || !h) return;
                const scale = Math.min(234 / w, 235 / h);
                img.style.width = `${Math.round(w * scale) + 11}px`;
                img.style.height = `${Math.round(h * scale) + 11}px`;
            });
            thumb.replaceChildren(img);
        }
        if (img.src !== src) img.src = src;
    }

    fillSlot(item, filename) {
        if (!item || !filename) return;
        const known = findImageByFilename(filename);
        item.dataset.stageFilename = filename;
        this.setItemState(item, 'saved');

        const thumb = item.querySelector('.stage-result-thumb');
        const img = document.createElement('img');
        img.alt = item.dataset.label || filename;
        img.decoding = 'async';
        img.draggable = false;
        // resolveGalleryPreviewUrl: public/scripts/comp/assetUrlResolver.js
        const src = known && known.storage === 'remote' ? resolveGalleryPreviewUrl(known) : stageResultThumbUrl(filename);
        img.addEventListener('error', () => {
            // no preview WebP (a JPEG / remote file): the file itself
            const full = localGalleryImageUrl(filename);
            if (img.src.endsWith(full)) return;
            img.src = full;
        }, { once: true });
        img.addEventListener('load', () => {
            item.dataset.size = `${img.naturalWidth} × ${img.naturalHeight}`;
            if (item === this.selected) this.syncDetails();
        }, { once: true });
        img.src = src;
        if (thumb) thumb.replaceChildren(img);

        this.attachMenu(item);
        this.syncTitle();
        if (item === this.selected) this.syncToolbar();
        this.syncDetails();
    }

    imageForItem(item) {
        if (!item) return null;
        const filename = item.dataset.stageFilename || item.dataset.filename;
        if (!filename) return null;
        // findImageByFilename: public/scripts/comp/galleryView.js
        const known = findImageByFilename(filename);
        if (known) return known;
        return { filename: filename, original: filename };
    }

    // ---- selection ----

    select(item, options = {}) {
        if (item === this.selected) {
            if (options.scroll && item) item.scrollIntoView({ block: 'nearest' });
            return;
        }
        if (this.selected) {
            this.selected.classList.remove('is-selected');
            this.selected.setAttribute('aria-selected', 'false');
        }
        this.selected = item || null;
        if (item) {
            item.classList.add('is-selected');
            item.setAttribute('aria-selected', 'true');
            if (options.scroll) item.scrollIntoView({ block: 'nearest' });
        }
        this.syncToolbar();
        this.syncDetails();
    }

    onViewClick(event) {
        const item = event.target.closest('.stage-result-item');
        this.select(item);
    }

    onViewDoubleClick(event) {
        const item = event.target.closest('.stage-result-item');
        if (item && item.dataset.stageFilename) void this.runCommand('preview');
    }

    onViewKeyDown(event) {
        const items = this.items();
        if (!items.length) return;
        const index = this.selected ? items.indexOf(this.selected) : -1;
        // items per row from the layout (auto-fill columns)
        const firstTop = items[0].offsetTop;
        let perRow = items.findIndex((item) => item.offsetTop !== firstTop);
        if (perRow <= 0) perRow = items.length;
        let next = null;
        switch (event.key) {
            case 'ArrowRight': next = items[Math.min(items.length - 1, index + 1)]; break;
            case 'ArrowLeft': next = items[Math.max(0, index - 1)]; break;
            case 'ArrowDown': next = items[index < 0 ? 0 : Math.min(items.length - 1, index + perRow)]; break;
            case 'ArrowUp': next = items[index < 0 ? 0 : Math.max(0, index - perRow)]; break;
            case 'Home': next = items[0]; break;
            case 'End': next = items[items.length - 1]; break;
            case 'Enter':
                if (this.selected && this.selected.dataset.stageFilename) void this.runCommand('preview');
                event.preventDefault();
                return;
            default:
                if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c' && this.selected?.dataset.stageFilename) {
                    void this.runCommand('copy');
                    event.preventDefault();
                }
                return;
        }
        event.preventDefault();
        if (next) this.select(next, { scroll: true });
    }

    // ---- toolbar, title, details ----

    phasewalkerActive() {
        const container = document.getElementById('pipelineStagesContainer');
        if (container && container.querySelector('.pipeline-stage-item[data-managed="true"]')) return true;
        return typeof requestBodyReplacements !== 'undefined' && requestBodyReplacements.some((row) => row.managed);
    }

    /** A saved stage Phasewalker compiled a phase for (an expander of its keywords targets it). */
    hasPhaseFor(item) {
        if (!item || this.printMode || typeof requestBodyReplacements === 'undefined') return false;
        const stageIndex = Number(item.dataset.stageIndex);
        if (!Number.isFinite(stageIndex)) return false;
        return requestBodyReplacements.some((row) => row.managed && stageResultExpanderStage(row) === stageIndex);
    }

    syncToolbar() {
        if (!this.toolbar) return;
        const item = this.selected;
        const hasFile = !!(item && item.dataset.stageFilename);
        this.toolbar.querySelectorAll('button[data-sr-cmd]').forEach((btn) => {
            const cmd = btn.dataset.srCmd;
            if (cmd === 'use-phase') {
                const offered = !this.printMode && this.phasewalkerActive();
                btn.classList.toggle('hidden', !offered);
                this.toolbar.querySelector('[data-sr-sep="use-phase"]')?.classList.toggle('hidden', !offered);
                btn.disabled = !offered || !hasFile || !this.hasPhaseFor(item);
                return;
            }
            btn.disabled = !hasFile;
            if (cmd === 'favorite') {
                const image = hasFile ? this.imageForItem(item) : null;
                // checkIfImageIsPinned: public/scripts/comp/galleryView.js
                const pinned = !!(image && checkIfImageIsPinned(image.filename || image.original));
                btn.setAttribute('aria-pressed', pinned ? 'true' : 'false');
                btn.title = pinned ? 'Remove from Favorites' : 'Add to Favorites';
            }
        });
    }

    syncTitle() {
        if (!this.titleEl) return;
        this.titleEl.textContent = this.printMode ? 'Prints' : 'Stage Results';
    }

    syncDetails() {
        if (!this.summaryEl || !this.detailEl) return;
        const item = this.selected;
        if (item) {
            const filename = item.dataset.stageFilename || '';
            this.summaryEl.textContent = item.dataset.label || filename;
            const parts = [];
            if (filename) parts.push(filename);
            if (item.dataset.size) parts.push(`Dimensions: ${item.dataset.size}`);
            if (!filename) {
                const status = item.querySelector('.stage-result-status');
                parts.push((status && status.textContent) || STAGE_RESULT_STATE_TEXT[item.dataset.state] || '');
            }
            this.detailEl.textContent = parts.filter(Boolean).join('\u2003');
            return;
        }
        const items = this.items();
        const saved = items.filter((entry) => entry.dataset.stageFilename).length;
        const noun = this.printMode ? 'print' : 'stage';
        this.summaryEl.textContent = items.length
            ? `${saved} of ${items.length} ${noun}${items.length === 1 ? '' : 's'} saved`
            : 'No results';
        const active = this.activeSlot();
        if (active) this.detailEl.textContent = `Rendering ${active.dataset.label || ''}`.trim();
        else if (this.sessionActive) this.detailEl.textContent = 'Waiting for the next stage';
        else this.detailEl.textContent = items.length ? 'Select a picture to see its details.' : '';
    }

    // ---- commands ----

    async runCommand(cmd) {
        const item = this.selected;
        if (!item || !item.dataset.stageFilename) return;
        if (cmd === 'use-phase') {
            await this.useThisPhase(item);
            return;
        }
        const action = {
            preview: 'open-in-window',
            studio: 'modify-preview',
            favorite: 'toggle-favorite',
            copy: 'copy',
            download: 'download',
            properties: 'view-image-data'
        }[cmd];
        if (action) await this.runImageAction(action, item);
    }

    attachMenu(item) {
        if (!item || typeof contextMenu === 'undefined' || !contextMenu || item.dataset.contextMenu) return;
        contextMenu.attachToElement(item, this.menuConfig());
    }

    menuConfig() {
        if (this._menuConfig) return this._menuConfig;
        // createManualPreviewImageContextMenuConfig: public/scripts/comp/manualModalManager.js
        const config = createManualPreviewImageContextMenuConfig();
        const manager = this;
        config.sections.forEach((section) => {
            if (section.icons) {
                section.icons.forEach((icon) => {
                    if (icon.action !== 'toggle-favorite') return;
                    icon.loadfn = (menuItem, target) => {
                        const image = manager.imageForItem(target && target.closest ? target.closest('.stage-result-item') : null);
                        const filename = image && (image.filename || image.original || image.upscaled);
                        // checkIfImageIsPinned: public/scripts/comp/galleryView.js
                        const isPinned = filename ? checkIfImageIsPinned(filename) : false;
                        menuItem.icon = isPinned ? 'fa-solid fa-star' : 'fa-regular fa-star';
                        menuItem.tooltip = isPinned ? 'Unfavorite' : 'Favorite';
                    };
                });
            }
            if (!section.items) return;
            // the Studio preview's display setting, not a command on this picture
            section.items = section.items.filter((menuItem) => menuItem.optionsfn !== getImageGenerationTransparencySubmenu);
            section.items.forEach((menuItem, index) => {
                if (menuItem.action === 'view-image-data') menuItem.disabled = false;
                if (menuItem.text === 'Original') {
                    // buildUnupscaledOriginalContextMenuItem: public/scripts/comp/galleryView.js
                    section.items[index] = buildUnupscaledOriginalContextMenuItem(() => manager.imageForItem(manager.selected));
                }
            });
        });
        const list = config.sections.find((section) => section.type === 'list' && section.items);
        if (list) {
            list.items.unshift({
                icon: 'fas fa-crown',
                text: 'Use This Phase',
                action: 'use-phase',
                hidden: () => manager.printMode || !manager.phasewalkerActive(),
                disabled: () => !manager.hasPhaseFor(manager.selected)
            });
        }
        config.onAction = (action, target, item) => {
            handleStageResultMenuAction(action, target, item);
        };
        this._menuConfig = config;
        return config;
    }

    async useThisPhase(item) {
        if (this.printMode || !item) return;
        if (!this.phasewalkerActive()) {
            showGlassToast('info', null, 'Phasewalker is not compiled into the Studio', false, 3000, STAGE_RESULTS_TOAST_ICONS.phase);
            this.syncToolbar();
            return;
        }
        const stageIndex = Number(item.dataset.stageIndex);
        if (!Number.isFinite(stageIndex)) return;
        if (!this.hasPhaseFor(item)) {
            showGlassToast('warning', null, `Phasewalker has no phase for ${item.dataset.label || 'this stage'}`, false, 4000, STAGE_RESULTS_TOAST_ICONS.phase);
            return;
        }
        // featureLoader.loadFeature: public/scripts/comp/featureLoader.js
        await featureLoader.loadFeature('bracket_gen');
        // bracketGenerationApplet.confirmSaveBeforeUnload: public/scripts/comp/bracketGenerationApplet.js
        const ok = await bracketGenerationApplet.confirmSaveBeforeUnload();
        if (!ok) return;
        // bracketGenBakeStageIntoPrompts: public/scripts/comp/bracketGenerationApplet.js
        const baked = bracketGenBakeStageIntoPrompts(stageIndex);
        if (!baked) {
            showGlassToast('warning', null, 'No phase to take over', false, 4000, STAGE_RESULTS_TOAST_ICONS.phase);
            return;
        }
        bracketGenerationApplet.updateChrome();
        this.syncToolbar();
        showGlassToast('success', null, `Took over ${item.dataset.label || 'this phase'}`, false, 3000, STAGE_RESULTS_TOAST_ICONS.phase);
    }

    /**
     * An image command on a Stage Results item or a Ledge card (ledgeDesk.js routes its menu here).
     * @param {string} action - a Studio preview menu action
     * @param {Element} target - the item, or an element inside it
     */
    async runImageAction(action, target) {
        const galleryItem = target && target.closest ? target.closest('.stage-result-item, .gallery-item') : null;
        const image = this.imageForItem(galleryItem);
        if (!image) return;
        const filename = image.filename || image.original || image.upscaled;
        // Ledge keeps a Favorite button on its card; Stage Results shows the state in its toolbar
        const pinBtn = galleryItem ? galleryItem.querySelector('.ledge-pin') : null;

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
                // togglePinImage / checkIfImageIsPinned: public/scripts/comp/galleryView.js
                await togglePinImage(image, pinBtn);
                if (pinBtn) {
                    pinBtn.title = checkIfImageIsPinned(filename) ? 'Unfavorite' : 'Favorite';
                }
                if (galleryItem && galleryItem === this.selected) this.syncToolbar();
                break;
            case 'download':
                // downloadImage: public/scripts/comp/galleryView.js
                downloadImage({ filename: filename, original: image.original || filename, upscaled: image.upscaled });
                break;
            case 'copy':
                // copyImageToClipboard: public/scripts/comp/galleryView.js
                copyImageToClipboard(image);
                break;
            case 'open-in-window':
                // openGalleryImageInViewer: public/scripts/comp/imageViewer.js
                openGalleryImageInViewer(image);
                break;
            case 'edit-in-paint':
                // editGalleryImageInPaint: public/scripts/comp/imageViewer.js
                void editGalleryImageInPaint(image);
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
            case 'create-animation':
                // animateImage: public/scripts/comp/galleryActions.js
                void animateImage(image);
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

    // ---- generation progress ----

    applyProgress(data) {
        if (!this.sessionActive || !data || !this.view) return;
        const phase = data.phase;

        // A print of several runs each copy as a whole generation: its own step events carry no
        // stageType 'print' (or a pipeline stage's), so they belong to the print rendering now
        if (this.printMode && data.stageType !== 'print') {
            if (phase === 'generating' || phase === 'reviewing') this.updateSlotProgress(this.activeSlot(), data);
            return;
        }

        if (phase === 'generating' || phase === 'stage_delay' || phase === 'upscaling' || phase === 'previews' || phase === 'reviewing') {
            if (data.currentStage != null) this.markGenerating(data);
            else this.updateSlotProgress(this.activeSlot(), data);
            this.syncDetails();
        }

        if ((phase === 'stage_complete' || phase === 'complete') && data.filename) {
            const item = this.findSlot(data.currentStage)
                || this.activeSlot()
                || this.view.querySelector('.stage-result-item[data-state="waiting"]');
            if (item && !item.dataset.stageFilename) this.fillSlot(item, data.filename);
        }

        if (phase === 'error') {
            const item = this.findSlot(data.currentStage) || this.activeSlot();
            if (item && !item.dataset.stageFilename) this.setItemState(item, 'failed');
            this.syncDetails();
        }
    }

    /**
     * The generation's reply: every saved file, matched to its slot by stage (the server's
     * stageIndex: 0 the base, n the pipeline's nth stage; the copy number for prints), else in order.
     */
    applySavedFilenames(filenames) {
        if (!this.view) return;
        if (this.showWhenSaved) { this.showWhenSaved = false; this.show(); }
        const list = Array.isArray(filenames) ? filenames : (filenames ? [filenames] : []);
        const items = this.items();
        const used = new Set();
        const pending = [];
        list.forEach((entry) => {
            const name = typeof entry === 'string' ? entry : entry?.filename;
            if (!name) return;
            const stageIndex = entry && typeof entry === 'object' ? Number(entry.stageIndex) : NaN;
            const slot = Number.isFinite(stageIndex)
                ? items.find((item) => !used.has(item) && Number(item.dataset.stageIndex) === stageIndex)
                : null;
            if (slot) {
                used.add(slot);
                if (slot.dataset.stageFilename !== name) this.fillSlot(slot, name);
            } else {
                pending.push(name);
            }
        });
        pending.forEach((name) => {
            if (items.some((item) => item.dataset.stageFilename === name)) return;
            const slot = items.find((item) => !used.has(item) && !item.dataset.stageFilename);
            if (!slot) return;
            used.add(slot);
            this.fillSlot(slot, name);
        });
        this.releaseSession();
    }
}

/** A Studio preview menu command that runImageAction carries out on an item's own picture
 *  (Create Animation acts on the Studio preview in the Studio's handler, so it is listed here). */
function stageResultIsImageAction(action) {
    // studioIsPreviewMenuAction: public/scripts/comp/imageGenerationSettings.js
    return action === 'create-animation' || studioIsPreviewMenuAction(action);
}

function handleStageResultMenuAction(action, target, item) {
    if (action === 'use-phase') {
        const resultItem = target && target.closest ? target.closest('.stage-result-item') : null;
        if (resultItem) void stageResultsReviewManager.useThisPhase(resultItem);
        return;
    }
    if (stageResultIsImageAction(action)) {
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
