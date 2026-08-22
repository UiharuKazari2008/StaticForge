// Character Positions — V5 freeform center editor linked to Studio.
class CharacterPositionToolManager {
    constructor() {
        this.element = null;
        this.stage = null;
        this.image = null;
        this.emptyState = null;
        this.readout = null;
        this.clearBtn = null;
        this.revertBtn = null;
        this.saveBtn = null;
        this.applyBtn = null;
        this.activeCharacterId = null;
        this.dragState = null;
        this.returnedCenters = null;
        this.returnedImageUrl = '';
        this.stageShell = null;
        this.stageResizeObserver = null;
    }

    init() {
        this.element = document.getElementById('characterPositionTool');
        if (!this.element) return;

        this.stage = document.getElementById('characterPositionStage');
        this.stageShell = this.element.querySelector('.character-position-stage-shell');
        this.image = document.getElementById('characterPositionImage');
        this.emptyState = document.getElementById('characterPositionEmpty');
        this.readout = document.getElementById('characterPositionReadout');
        this.clearBtn = document.getElementById('characterPositionClearBtn');
        this.revertBtn = document.getElementById('characterPositionRevertBtn');
        this.saveBtn = document.getElementById('characterPositionSaveBtn');
        this.applyBtn = document.getElementById('characterPositionApplyBtn');

        transientWindowsWithPositions.add('character-positions-tool');
        linkToolWindowToParent(this.element, document.getElementById('manualModal'));
        if (!this.element.querySelector('.resize-handle')) {
            addResizeHandles(this.element);
        }

        document.getElementById('characterPositionToolCloseBtn').addEventListener('click', () => {
            void closeModal(this.element);
        });
        document.getElementById('characterPositionsToolBtn').addEventListener('click', () => {
            this.open();
        });
        this.clearBtn.addEventListener('click', () => this._clearToAiChoice());
        this.revertBtn.addEventListener('click', () => this._revertToReturned());
        this.saveBtn.addEventListener('click', () => this._saveRequestedCenters(false));
        this.applyBtn.addEventListener('click', () => this._saveRequestedCenters(true));
        this.stage.addEventListener('pointerdown', (event) => this._startPinDrag(event));
        this.stage.addEventListener('pointermove', (event) => this._movePin(event));
        this.stage.addEventListener('pointerup', (event) => this._finishPinDrag(event));
        this.stage.addEventListener('pointercancel', (event) => this._finishPinDrag(event));
        this.image.addEventListener('load', () => this._syncStageAspect());
        this.stageResizeObserver = new ResizeObserver(() => this._fitStageToImage());
        this.stageResizeObserver.observe(this.stageShell || this.element);
        this.syncAvailability();
    }

    isFreeformModel() {
        return getForgeModelFeatures()?.freeformCharacterPosition === true;
    }

    _isMounted() {
        if (!this.element) return false;
        return !this.element.classList.contains('hidden') && !this.element.classList.contains('closing');
    }

    _isMinimised() {
        return this.element
            && (this.element.classList.contains('minimised') || this.element.classList.contains('minimising'));
    }

    syncAvailability() {
        const button = document.getElementById('characterPositionsToolBtn');
        const autoPositionBtn = document.getElementById('autoPositionBtn');
        if (!button) return;
        const characterCount = characterPromptsContainer.querySelectorAll('.character-prompt-item').length;
        const freeform = this.isFreeformModel();
        button.classList.toggle('hidden', characterCount === 0 || !freeform);
        if (autoPositionBtn) {
            autoPositionBtn.classList.toggle('hidden', freeform || characterCount < 2);
        }
        if (!freeform && this.element && this._isMounted()) {
            void closeModal(this.element);
        }
        this._syncIndicator();
    }

    open(characterId = null) {
        if (!this.isFreeformModel()) {
            if (characterId) showPositionDialog(characterId);
            return;
        }
        const characterItems = this._characterItems();
        if (characterItems.length === 0) {
            showGlassToast('info', 'Character Positions', 'Add a character prompt first.');
            return;
        }

        this.activeCharacterId = characterId;
        this._refreshImage();
        if (!this._isMounted()) {
            this._renderPins(characterItems);
            this._syncActionButtons();
        }
        if (this._isMinimised()) {
            // restoreMinimizedModal: public/scripts/comp/modalUtils.js
            restoreMinimizedModal(this.element, getOrCreateTaskbarItem(this.element));
        } else if (!this._isMounted()) {
            openModal(this.element);
        }
        bringModalToFront(this.element);
        requestAnimationFrame(() => {
            requestAnimationFrame(() => this._fitStageToImage());
        });
    }

    handleGenerationComplete() {
        if (!this.isFreeformModel()) return;
        this._captureReturnedCenters();
        this._syncIndicator();
        if (!this._isMounted()) return;
        const characterItems = this._characterItems();
        this.activeCharacterId = null;
        this._refreshImage();
        this._renderPins(characterItems);
        this._syncActionButtons();
        requestAnimationFrame(() => this._fitStageToImage());
    }

    syncPreviewImage() {
        if (!this.isFreeformModel() || !this._isMounted()) return;
        this._refreshImage();
        requestAnimationFrame(() => this._fitStageToImage());
    }

    refreshOpenTool() {
        this.syncAvailability();
        if (!this._isMounted()) return;
        this._refreshImage();
        this._renderPins(this._characterItems());
        this._syncActionButtons();
        requestAnimationFrame(() => this._fitStageToImage());
    }

    _characterItems() {
        return Array.from(characterPromptsContainer.querySelectorAll('.character-prompt-item'));
    }

    _autoPositionOn() {
        const autoPositionBtn = document.getElementById('autoPositionBtn');
        return !autoPositionBtn || autoPositionBtn.getAttribute('data-state') === 'on';
    }

    _hasReturnedCenters() {
        return Array.isArray(this.returnedCenters)
            && this.returnedCenters.some((center) => center && Number.isFinite(center.x) && Number.isFinite(center.y));
    }

    _hasRequestedCoords() {
        return this._characterItems().some((item) => {
            const x = Number.parseFloat(item.dataset.positionX);
            const y = Number.parseFloat(item.dataset.positionY);
            return Number.isFinite(x) && Number.isFinite(y);
        }) && !this._autoPositionOn();
    }

    _syncIndicator() {
        const button = document.getElementById('characterPositionsToolBtn');
        if (!button || button.classList.contains('hidden')) return;
        if (this._hasRequestedCoords()) {
            button.setAttribute('data-state', 'on');
            return;
        }
        if (this._hasReturnedCenters()) {
            button.setAttribute('data-state', 'returned');
            return;
        }
        button.setAttribute('data-state', 'off');
    }

    _captureReturnedCenters() {
        const metadata = window.currentManualPreviewImage?.metadata;
        const extracted = this._extractMetadataCenters(metadata);
        this.returnedCenters = extracted.length ? extracted : null;
        this.returnedImageUrl = this._galleryUrlFromCurrentPreview() || this._usableImageUrl(
            document.getElementById('manualPreviewImage')?.dataset.manualPreviewUrl
        );
    }

    _usableImageUrl(url) {
        if (!url || url === 'about:blank') return '';
        if (url.startsWith('data:')) return '';
        return url;
    }

    _galleryUrlFromCurrentPreview() {
        const current = window.currentManualPreviewImage;
        const filename = current?.upscaled || current?.filename || current?.original || current?.base;
        // localGalleryImageUrl: public/scripts/comp/assetUrlResolver.js
        return filename ? localGalleryImageUrl(filename) : '';
    }

    _resolveStageImageUrl() {
        const preview = document.getElementById('manualPreviewImage');
        const datasetUrl = this._usableImageUrl(preview?.dataset.manualPreviewUrl);
        const galleryUrl = this._galleryUrlFromCurrentPreview();
        const src = this._usableImageUrl(preview?.currentSrc || preview?.src);
        const previewVisible = preview && !preview.classList.contains('hidden');
        if (previewVisible) {
            if (datasetUrl) return datasetUrl;
            if (galleryUrl) return galleryUrl;
            if (src) return src;
        }
        if (datasetUrl) return datasetUrl;
        if (galleryUrl) return galleryUrl;
        if (src) return src;
        return this._usableImageUrl(this.returnedImageUrl);
    }

    _extractMetadataCenters(metadata) {
        if (!metadata) return [];
        const fromChars = (list) => {
            if (!Array.isArray(list) || list.length === 0) return [];
            return list.map((character) => {
                const center = character?.center || (Array.isArray(character?.centers) ? character.centers[0] : null);
                const x = Number.parseFloat(center?.x);
                const y = Number.parseFloat(center?.y);
                if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
                return { x, y };
            });
        };
        const candidates = [
            fromChars(metadata.allCharacterPrompts),
            fromChars(metadata.characterPrompts),
            fromChars(metadata.forge_data?.allCharacters),
            fromChars(metadata.v4_prompt?.caption?.char_captions)
        ];
        return candidates.find((list) => list.length > 0 && list.every(Boolean))
            || candidates.find((list) => list.some(Boolean))
            || [];
    }

    _refreshImage() {
        const imageUrl = this._resolveStageImageUrl();
        if (!imageUrl) {
            this.image.removeAttribute('src');
            this.image.classList.add('hidden');
            this.emptyState.classList.remove('hidden');
            this._syncStageAspect();
            return;
        }
        if (this.image.getAttribute('src') !== imageUrl) {
            this.image.src = imageUrl;
        }
        this.image.classList.remove('hidden');
        this.emptyState.classList.add('hidden');
        if (this.image.complete && this.image.naturalWidth) this._syncStageAspect();
    }

    _syncStageAspect() {
        const dimensions = this._stageAspectDimensions();
        this.stage.style.aspectRatio = `${dimensions.width} / ${dimensions.height}`;
        this._fitStageToImage();
    }

    _stageAspectDimensions() {
        if (!this.image.classList.contains('hidden') && this.image.naturalWidth && this.image.naturalHeight) {
            return { width: this.image.naturalWidth, height: this.image.naturalHeight };
        }
        const resolution = document.getElementById('manualResolution')?.value;
        // getDimensionsFromResolution: public/scripts/comp/utilities.js
        return getDimensionsFromResolution(resolution) || { width: 1024, height: 1024 };
    }

    _fitStageToImage() {
        if (!this.stage) return;
        const shell = this.stageShell || this.stage.parentElement;
        const availableWidth = shell?.clientWidth || 0;
        const availableHeight = shell?.clientHeight || 0;
        if (availableWidth <= 0 || availableHeight <= 0) return;
        const dimensions = this._stageAspectDimensions();
        const ratio = dimensions.width / dimensions.height;
        let width = availableWidth;
        let height = width / ratio;
        if (height > availableHeight) {
            height = availableHeight;
            width = height * ratio;
        }
        this.stage.style.width = `${Math.max(1, Math.floor(width))}px`;
        this.stage.style.height = `${Math.max(1, Math.floor(height))}px`;
    }

    _centerForItem(item, index, count) {
        const storedX = Number.parseFloat(item.dataset.positionX);
        const storedY = Number.parseFloat(item.dataset.positionY);
        if (!this._autoPositionOn() && Number.isFinite(storedX) && Number.isFinite(storedY)) {
            return { x: storedX, y: storedY };
        }
        const returned = this.returnedCenters?.[index];
        if (returned && Number.isFinite(returned.x) && Number.isFinite(returned.y)) {
            return { x: returned.x, y: returned.y };
        }
        return { x: (index + 1) / (count + 1), y: 0.5 };
    }

    _renderPins(characterItems) {
        this.stage.querySelectorAll('.character-position-pin').forEach((pin) => pin.remove());
        const count = characterItems.length;
        characterItems.forEach((item, index) => {
            const { x, y } = this._centerForItem(item, index, count);
            const nameInput = item.querySelector('.character-name-input');
            const name = nameInput?.value.trim() || `Character ${index + 1}`;
            const pin = document.createElement('button');
            pin.type = 'button';
            pin.className = 'character-position-pin';
            pin.dataset.characterId = item.id;
            pin.dataset.x = String(x);
            pin.dataset.y = String(y);
            pin.style.left = `${x * 100}%`;
            pin.style.top = `${y * 100}%`;
            pin.style.setProperty('--character-pin-color', `hsl(${(index * 67 + 205) % 360} 78% 58%)`);
            pin.classList.toggle('selected', item.id === this.activeCharacterId);
            pin.setAttribute('aria-label', `Move ${name}`);
            pin.title = `${name} · ${this._formatCenter(x, y)}`;
            pin.innerHTML = `<span>${index + 1}</span><span class="character-position-pin-label">${escapeHtml(name)}</span>`;
            this.stage.appendChild(pin);
        });
        this._updateReadout();
        this._syncActionButtons();
    }

    _startPinDrag(event) {
        const pin = event.target.closest('.character-position-pin');
        if (!pin || !this.stage.contains(pin)) {
            this._dropActivePin(event);
            return;
        }
        event.preventDefault();
        this.activeCharacterId = pin.dataset.characterId;
        this.stage.querySelectorAll('.character-position-pin').forEach((candidate) => {
            candidate.classList.toggle('selected', candidate === pin);
        });
        pin.setPointerCapture(event.pointerId);
        this.dragState = { pin, pointerId: event.pointerId };
        this._movePin(event);
    }

    _movePin(event) {
        if (!this.dragState || this.dragState.pointerId !== event.pointerId) return;
        const rect = this.stage.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
        const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
        const pin = this.dragState.pin;
        pin.dataset.x = x.toFixed(4);
        pin.dataset.y = y.toFixed(4);
        pin.style.left = `${x * 100}%`;
        pin.style.top = `${y * 100}%`;
        pin.title = `${pin.querySelector('.character-position-pin-label')?.textContent || 'Character'} · ${this._formatCenter(x, y)}`;
        this._updateReadout(pin);
        this._syncActionButtons();
    }

    _finishPinDrag(event) {
        if (!this.dragState || this.dragState.pointerId !== event.pointerId) return;
        const pin = this.dragState.pin;
        this.dragState = null;
        if (pin.hasPointerCapture(event.pointerId)) pin.releasePointerCapture(event.pointerId);
        this._warnIfPinsOverlap(pin);
        this._syncActionButtons();
    }

    _dropActivePin(event) {
        if (event.button !== 0) return;
        const pin = this.stage.querySelector(`.character-position-pin[data-character-id="${CSS.escape(this.activeCharacterId || '')}"]`)
            || this.stage.querySelector('.character-position-pin');
        if (!pin) return;

        const rect = this.stage.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        event.preventDefault();
        const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
        const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
        this.activeCharacterId = pin.dataset.characterId;
        this.stage.querySelectorAll('.character-position-pin').forEach((candidate) => {
            candidate.classList.toggle('selected', candidate === pin);
        });
        pin.dataset.x = x.toFixed(4);
        pin.dataset.y = y.toFixed(4);
        pin.style.left = `${x * 100}%`;
        pin.style.top = `${y * 100}%`;
        pin.title = `${pin.querySelector('.character-position-pin-label')?.textContent || 'Character'} · ${this._formatCenter(x, y)}`;
        this._updateReadout(pin);
        this._warnIfPinsOverlap(pin);
        this._syncActionButtons();
    }

    _warnIfPinsOverlap(movedPin) {
        const x = Number.parseFloat(movedPin.dataset.x);
        const y = Number.parseFloat(movedPin.dataset.y);
        const overlap = Array.from(this.stage.querySelectorAll('.character-position-pin')).find((pin) => {
            if (pin === movedPin) return false;
            const dx = Number.parseFloat(pin.dataset.x) - x;
            const dy = Number.parseFloat(pin.dataset.y) - y;
            return Math.hypot(dx, dy) < 0.1;
        });
        if (!overlap) return;

        const movedName = movedPin.querySelector('.character-position-pin-label')?.textContent || 'Character';
        const overlapName = overlap.querySelector('.character-position-pin-label')?.textContent || 'another character';
        showGlassToast(
            'warning',
            'Character Centers Overlap',
            `${movedName} is within 0.1 of ${overlapName}; separate the pins for clearer placement.`,
            false,
            4500,
            '<i class="fas fa-triangle-exclamation"></i>'
        );
    }

    _pinCenters() {
        return Array.from(this.stage.querySelectorAll('.character-position-pin')).map((pin) => ({
            characterId: pin.dataset.characterId,
            x: Number.parseFloat(pin.dataset.x),
            y: Number.parseFloat(pin.dataset.y)
        }));
    }

    _centersMatchReturned(centers = this._pinCenters()) {
        if (!this._hasReturnedCenters()) return false;
        if (centers.length !== this.returnedCenters.length) return false;
        return centers.every((center, index) => {
            const returned = this.returnedCenters[index];
            if (!returned || !Number.isFinite(center.x) || !Number.isFinite(center.y)) return false;
            return Math.abs(center.x - returned.x) < 1e-3 && Math.abs(center.y - returned.y) < 1e-3;
        });
    }

    _syncActionButtons() {
        if (!this.revertBtn) return;
        const hasReturned = this._hasReturnedCenters();
        this.revertBtn.classList.toggle('hidden', !hasReturned);
        this.revertBtn.disabled = !hasReturned || this._centersMatchReturned();
    }

    _setAutoPosition(on) {
        const autoPositionBtn = document.getElementById('autoPositionBtn');
        if (autoPositionBtn) autoPositionBtn.setAttribute('data-state', on ? 'on' : 'off');
        this.syncAvailability();
    }

    _persistRenderedCenters() {
        this.stage.querySelectorAll('.character-position-pin').forEach((pin) => {
            const x = Number.parseFloat(pin.dataset.x);
            const y = Number.parseFloat(pin.dataset.y);
            setCharacterPromptPosition(pin.dataset.characterId, x, y);
        });
        this._setAutoPosition(false);
        this._syncIndicator();
    }

    _saveRequestedCenters(closeAfter) {
        this._persistRenderedCenters();
        this._syncActionButtons();
        if (closeAfter) void closeModal(this.element);
    }

    _clearToAiChoice() {
        void closeModal(this.element);
        clearCharacterPromptPositions();
        this._syncIndicator();
    }

    _revertToReturned() {
        if (!this._hasReturnedCenters()) return;
        const pins = Array.from(this.stage.querySelectorAll('.character-position-pin'));
        pins.forEach((pin, index) => {
            const returned = this.returnedCenters[index];
            if (!returned) return;
            pin.dataset.x = returned.x.toFixed(4);
            pin.dataset.y = returned.y.toFixed(4);
            pin.style.left = `${returned.x * 100}%`;
            pin.style.top = `${returned.y * 100}%`;
            pin.title = `${pin.querySelector('.character-position-pin-label')?.textContent || 'Character'} · ${this._formatCenter(returned.x, returned.y)}`;
        });
        this._updateReadout();
        this._syncActionButtons();
    }

    _updateReadout(pin = null) {
        const selected = pin || this.stage.querySelector('.character-position-pin.selected');
        this.readout.textContent = selected
            ? this._formatCenter(Number.parseFloat(selected.dataset.x), Number.parseFloat(selected.dataset.y))
            : 'Click the canvas or drag a center';
    }

    _formatCenter(x, y) {
        return `x ${x.toFixed(3)} · y ${y.toFixed(3)}`;
    }
}

const characterPositionToolManager = new CharacterPositionToolManager();

// wsClient: public/scripts/websocket.js
wsClient.registerInitStep(472.5, 'Character positions tool', async () => {
    characterPositionToolManager.init();
});
