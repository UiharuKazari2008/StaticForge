// Spellbook Generation Modal Manager
class SpellbookModalManager {
    constructor() {
        this.modal = null;
        this.closeBtn = null;
        this.openBtn = null;
        this.customPresetDropdown = null;
        this.customPresetDropdownBtn = null;
        this.customPresetDropdownMenu = null;
        this.customPresetSelected = null;
        this.clearPresetBtn = null;
        this.generateBtn = null;
        this.editorBtn = null;
        this.previewImage = null;
        this.isGenerating = false;
        this.spellbookProgressOverlayCompleting = false;
        this.spellbookProgressInterval = null;

        this.selectedPreset = '';
        this.confettiContainer = null;
        this.generatedWorkspace = null;
        this.generatedFilename = null;
        this.generatedMetadata = null;
        this.dynamicGenerationActive = false;

        this.init();
    }

    init() {
        if (this._initWired) {
            return;
        }
        this._initWired = true;

        this.cacheElements();
        this.setupEventListeners();
        this.setProgressCancelVisible(false);
        this.updatePreviewActionButtons();
        window.updateSpellbookDynamicGenerationProgressOverlay = this.updateSpellbookDynamicGenerationProgressOverlay.bind(this);
    }

    cacheElements() {
        this.modal = document.getElementById('spellbookGenerationModal');
        this.closeBtn = document.getElementById('closeSpellbookModalBtn');
        this.openBtn = document.getElementById('openSpellbookModalBtn');

        // Modal elements
        this.customPresetDropdown = document.getElementById('spellbookCustomPresetDropdown');
        this.customPresetDropdownBtn = document.getElementById('spellbookCustomPresetDropdownBtn');
        this.customPresetDropdownMenu = document.getElementById('spellbookCustomPresetDropdownMenu');
        this.customPresetSelected = document.getElementById('spellbookCustomPresetSelected');
        this.clearPresetBtn = document.getElementById('spellbookClearPresetBtn');
        this.generateBtn = document.getElementById('spellbookGenerateBtn');
        this.editorBtn = document.getElementById('spellbookEditorBtn');

        // Preview elements
        this.previewImage = document.getElementById('spellbookPreviewImage');
        this.confettiContainer = document.getElementById('spellbookConfettiContainer');
        this.blurBackground1 = document.getElementById('spellbookBlurBackground1');
        this.blurBackground2 = document.getElementById('spellbookBlurBackground2');

        // Animation elements
        this.previewStars = document.getElementById('spellbookPreviewStars');
        this.previewBackgroundLines = document.getElementById('spellbookPreviewBackgroundLines');
        this.previewForegroundLines = document.getElementById('spellbookPreviewForegroundLines');
        this.previewAnimationHost = this.previewBackgroundLines?.closest('.spellbook-preview-image-container');

        // Dynamic generation overlay elements
        this.dynamicGenerationOverlay = document.getElementById('spellbookDynamicGenerationOverlay');
        this.dynamicGenerationOverlayBody = document.getElementById('spellbookDynamicGenerationOverlayBody');
        this.overlayWeatherFeelsLike = document.getElementById('spellbookOverlayWeatherFeelsLike');
        this.overlayWeatherCondition = document.getElementById('spellbookOverlayWeatherCondition');
        this.overlayWeatherLocation = document.getElementById('spellbookOverlayWeatherLocation');
        this.overlayWeatherIcon = document.getElementById('spellbookOverlayWeatherIcon');
        this.overlayTimeDisplay = document.getElementById('spellbookOverlayTimeDisplay');

        // Dynamic generation progress overlay elements
        this.dynamicGenerationProgressOverlay = document.getElementById('spellbookDynamicGenerationProgressOverlay');
        this.progressStatusText = document.getElementById('spellbookProgressStatusText');
        this.progressTime = document.getElementById('spellbookProgressTime');
        this.progressDate = document.getElementById('spellbookProgressDate');
        this.progressWeatherFeelsLike = document.getElementById('spellbookProgressWeatherFeelsLike');
        this.progressWeatherCondition = document.getElementById('spellbookProgressWeatherCondition');
        this.progressWeatherLocation = document.getElementById('spellbookProgressWeatherLocation');
        this.progressWeatherIcon = document.getElementById('spellbookProgressWeatherIcon');
        this.progressHoliday = document.getElementById('spellbookProgressHoliday');
        this.progressSeason = document.getElementById('spellbookProgressSeason');
        this.progressReasoningContainer = document.getElementById('spellbookProgressReasoningContainer');
        this.dynamicGenerationProgressCancelBtn = document.getElementById('spellbookDynamicGenerationProgressCancelBtn');

        // Button elements
        this.downloadBtn = document.getElementById('spellbookDownloadBtn');
        this.copyBtn = document.getElementById('spellbookCopyBtn');
        this.upscaleBtn = document.getElementById('spellbookUpscaleBtn');
        this.expandBtn = document.getElementById('spellbookExpandBtn');
        this.goToWorkspaceBtn = document.getElementById('spellbookGoToWorkspaceBtn');
    }

    setupEventListeners() {
        // Modal open/close
        if (this.openBtn) {
            this.openBtn.addEventListener('click', () => this.openModal());
        }

        if (this.closeBtn) {
            this.closeBtn.addEventListener('click', () => this.closeModal());
        }

        // Generate button
        if (this.generateBtn) {
            this.generateBtn.addEventListener('click', () => this.handleGenerate());
        }

        // Editor button
        if (this.editorBtn) {
            this.editorBtn.addEventListener('click', () => this.handleEditor());
        }

        // Clear preset button
        if (this.clearPresetBtn) {
            this.clearPresetBtn.addEventListener('click', () => this.clearPreset());
        }

        // Image click handler for lightbox (added once)
        if (this.previewImage && !this.previewImage.dataset.clickHandlerAdded) {
            this.previewImage.addEventListener('click', () => this.handleImageClick());
            this.previewImage.dataset.clickHandlerAdded = 'true';
        }

        // Download button
        if (this.downloadBtn) {
            this.downloadBtn.addEventListener('click', () => this.handleDownload());
        }

        // Copy button
        if (this.copyBtn) {
            this.copyBtn.addEventListener('click', () => this.handleCopy());
        }

        // Upscale button
        if (this.upscaleBtn) {
            this.upscaleBtn.addEventListener('click', () => this.handleUpscale());
        }

        // Expand button
        if (this.expandBtn) {
            this.expandBtn.addEventListener('click', () => this.handleExpand());
        }

        // Go to workspace button
        if (this.goToWorkspaceBtn) {
            this.goToWorkspaceBtn.addEventListener('click', () => this.handleGoToWorkspace());
        }

        if (this.dynamicGenerationProgressCancelBtn) {
            this.dynamicGenerationProgressCancelBtn.addEventListener('click', () => this.cancelSpellbookGenerationFromUser());
        }

        this.setupContextMenu();
        this.wireEscapeKeyScope();
    }

    wireEscapeKeyScope() {
        if (!this.modal || this._escapeKeyScopeWired) return;
        this._escapeKeyScopeWired = true;
        if (!this._spellbookActionHandler) {
            this._spellbookActionHandler = (e) => {
                if (!this.modal || this.modal.classList.contains('hidden')) return;

                if (e.key === 'Enter' && !modalKeyboardSkipPrimaryEnter(e.target)) {
                    e.preventDefault();
                    e.stopPropagation();
                    if (this.generateBtn && !this.generateBtn.disabled) this.handleGenerate();
                    return true;
                }

                if (e.key === 'F5') {
                    e.preventDefault();
                    e.stopPropagation();
                    this.loadPresets();
                    return true;
                }
            };
        }
        registerKeyboardListener({
            id: 'spellbookModal.actions',
            handler: this._spellbookActionHandler,
            type: 'whenFocused',
            modalId: 'spellbookGenerationModal',
            priority: 75,
            showInOverlay: false
        });
        registerModalOverlayEntries('spellbookGenerationModal', 'Spellbook', [
            { id: 'overlay.spellbook.close', label: 'Close', keys: 'Alt+Q', icon: 'fas fa-times' },
            { id: 'overlay.spellbook.cast', label: 'Cast spell', keys: 'Enter', icon: 'nai-sparkles', overlayValid: () => this.generateBtn && !this.generateBtn.disabled },
            { id: 'overlay.spellbook.refresh', label: 'Refresh presets', keys: 'F5', icon: 'fas fa-rotate' }
        ]);
    }

    updateSpellbookDynamicGenerationProgressOverlay(phase, data) {
        // Only handle updates if the spellbook modal is currently generating
        if (!this.isGenerating) return;

        const overlay = this.dynamicGenerationProgressOverlay;
        if (!overlay) return;

        const isNewSession = overlay.classList.contains('hidden') && phase !== 'completion' && phase !== 'error';

        if (isNewSession) {
            this.spellbookProgressOverlayCompleting = false;
            this.dynamicGenerationActive = true;
            this.resetSpellbookProgressOverlay();
        }

        if (this.spellbookProgressOverlayCompleting && phase !== 'error' && phase !== 'context' && !isNewSession) {
            if (phase === 'completion') {
                this.updateSpellbookProgressStatus('Starting Generation...');
            }
            return;
        }

        // Update content based on phase
        switch (phase) {
            case 'starting':
                this.dynamicGenerationActive = true;
                this.hideSpellbookDynamicGenerationOverlay();
                this.updateSpellbookProgressStatus('Starting Enshutsuka...');
                overlay.classList.remove('hidden');
                this.setProgressCancelVisible(true);
                break;
            case 'context':
                this.dynamicGenerationActive = true;
                this.hideSpellbookDynamicGenerationOverlay();
                this.updateSpellbookProgressContext(data);
                overlay.classList.remove('hidden');
                this.setProgressCancelVisible(true);
                break;
            case 'thinking':
                this.updateSpellbookProgressStatus('Getting Ready...');
                break;
            case 'streaming':
                this.updateSpellbookProgressStatus('Reading Response...');
                this.addSpellbookProgressReasoning((data?.reason ?? data?.reasoning ?? data?.toolReason));
                break;
            case 'tool_execution':
                if (overlay.classList.contains('hidden') && !isNewSession) return;
                if (data?.currentKey && data?.totalKeys) {
                    this.updateSpellbookProgressStatus(`Executing Tools (${data.currentKey}/${data.totalKeys})...`);
                } else {
                    this.updateSpellbookProgressStatus('Executing Tools...');
                }
                if (data?.reason || data?.reasoning || data?.toolReason)
                    this.addSpellbookProgressReasoning((data?.reason ?? data?.reasoning ?? data?.toolReason), data?.toolName, data?.toolState, data?.toolReasoningId, data);
                break;
            case 'optimizing':
                this.updateSpellbookProgressStatus('Optimizing...');
                // Clear existing reasoning items to make room for optimization text
                if (this.progressReasoningContainer) {
                    // Fade out existing items quickly
                    const existingItems = this.progressReasoningContainer.querySelectorAll('.progress-reasoning-item');
                    existingItems.forEach((item, index) => {
                        setTimeout(() => {
                            item.classList.add('fade-out');
                            if (index === existingItems.length - 1) {
                                // After last item starts fading, clear container and positions
                                setTimeout(() => {
                                    this.progressReasoningContainer.innerHTML = '';
                                    if (this.spellbookReasoningPositions) {
                                        this.spellbookReasoningPositions = [];
                                    }
                                }, 400);
                            }
                        }, index * 50); // Quick stagger
                    });
                }
                // Add the optimization reason if provided
                if (data?.reason || data?.reasoning || data?.toolReason) {
                    const existingItems = this.progressReasoningContainer?.querySelectorAll('.progress-reasoning-item');
                    setTimeout(() => {
                        this.addSpellbookProgressReasoning((data?.reason ?? data?.reasoning ?? data?.toolReason));
                    }, existingItems?.length > 0 ? (existingItems.length * 50 + 400) : 0);
                }
                break;
            case 'completion':
                if (overlay.classList.contains('hidden') && !isNewSession) return;
                this.updateSpellbookProgressStatus('Starting Generation...');
                this.spellbookProgressOverlayCompleting = true;
                this.setProgressCancelVisible(false);
                // Show completion for 2 seconds then hide (unless debug flag is set)
                if (!window.DEBUG_KEEP_REASONING_OVERLAY) {
                    this.hideSpellbookDynamicGenerationProgressOverlay();
                } else {
                    console.log('🔧 DEBUG_KEEP_REASONING_OVERLAY enabled - overlay will not hide');
                }
                break;
            case 'error':
                this.updateSpellbookProgressStatus('Error: ' + (data?.error || 'Enshutsuka processing failed'));
                this.spellbookProgressOverlayCompleting = true;
                this.dynamicGenerationActive = false;
                this.setProgressCancelVisible(false);
                // Hide overlay after showing error for 3 seconds
                this.hideSpellbookDynamicGenerationProgressOverlay();
                break;
        }
    }

    handleImageClick() {
        if (!this.previewImage || this.previewImage.classList.contains('hidden')) return;
        if (!this.previewImage.src || !window.showLightbox) return;

        const currentWorkspaceId = (typeof activeWorkspace !== 'undefined' ? activeWorkspace : null) || window.activeWorkspace || 'default';
        if (this.generatedFilename && (!this.generatedWorkspace || this.generatedWorkspace === currentWorkspaceId)) {
            window.showLightbox({ filename: this.generatedFilename });
            return;
        }

        window.showLightbox({
            url: this.previewImage.src,
            width: this.previewImage.naturalWidth || 1024,
            height: this.previewImage.naturalHeight || 1024
        });
    }

    setupContextMenu() {
        const previewImage = this.previewImage;
        const previewContainer = previewImage?.closest('.spellbook-preview-image-container')
            || this.modal?.querySelector('.spellbook-preview-image-container');
        if (!previewContainer || !contextMenu || previewContainer.dataset.spellbookContextMenuAttached === 'true') {
            return;
        }
        previewContainer.dataset.spellbookContextMenuAttached = 'true';

        contextMenu.attachToElement(previewContainer, this.buildSpellbookPreviewContextMenuConfig());

        if (!this._spellbookContextMenuHandler) {
            this._spellbookContextMenuHandler = (event) => this.handleSpellbookContextMenuAction(event);
            document.addEventListener('contextMenuAction', this._spellbookContextMenuHandler);
        }
    }

    getPreviewImageMetadata() {
        if (!this.hasPreviewResult()) return null;

        const filename = this.generatedFilename;
        // findImageByFilename: public/scripts/comp/galleryView.js
        const galleryImage = findImageByFilename(filename);
        if (galleryImage) {
            return galleryImage;
        }

        return {
            filename,
            original: filename,
            upscaled: null,
            workspace: this.generatedWorkspace,
            width: this.generatedWidth,
            height: this.generatedHeight,
            metadata: this.generatedMetadata || null
        };
    }

    buildSpellbookPreviewContextMenuConfig() {
        const manager = this;
        const hasImage = () => manager.hasPreviewResult();

        return {
            maxHeight: true,
            sections: [
                {
                    type: 'icons',
                    position: 'outer',
                    icons: [
                        {
                            icon: 'fa-regular fa-star',
                            tooltip: 'Favorite',
                            action: 'spellcaster-toggle-pin',
                            disabled: () => !hasImage(),
                            loadfn: (menuItem) => {
                                const image = manager.getPreviewImageMetadata();
                                if (!image) return;
                                const fn = image.filename || image.original || image.upscaled;
                                const isPinned = checkIfImageIsPinned(fn);
                                menuItem.icon = isPinned ? 'fa-solid fa-star' : 'fa-regular fa-star';
                                menuItem.tooltip = isPinned ? 'Unfavorite' : 'Favorite';
                            }
                        },
                        {
                            icon: 'fas fa-clipboard',
                            tooltip: 'Copy',
                            action: 'spellcaster-copy',
                            disabled: () => !hasImage()
                        },
                        {
                            icon: 'fas fa-download',
                            tooltip: 'Download',
                            action: 'spellcaster-download',
                            disabled: () => !hasImage()
                        }
                    ]
                },
                {
                    type: 'list',
                    items: [
                        {
                            icon: 'fas fa-compass-drafting',
                            text: 'Open in Studio',
                            action: 'spellcaster-creator',
                            disabled: () => !hasImage()
                        },
                        {
                            icon: 'mdi mdi-1-25 mdi-relative-scale',
                            text: 'Expand Canvas',
                            action: 'spellcaster-expand',
                            disabled: () => !hasImage()
                        },
                        {
                            icon: 'fas fa-wand-magic-sparkles',
                            text: 'Enhance',
                            action: 'spellcaster-enhance',
                            disabled: () => !hasImage()
                        },
                        {
                            icon: 'nai-upscale',
                            text: 'Upscale',
                            action: 'spellcaster-upscale',
                            disabled: () => !hasImage()
                        },
                        {
                            icon: 'fas fa-glasses-round',
                            text: 'Properties',
                            action: 'spellcaster-view-data',
                            disabled: true
                        },
                        {
                            icon: 'fas fa-book-spells',
                            text: 'Manage Spells',
                            action: 'spellcaster-open-spellbook'
                        },
                        { separator: true },
                        {
                            icon: 'fas fa-person-to-portal',
                            text: 'New Persona',
                            action: 'spellcaster-start-chat',
                            disabled: () => !hasImage()
                        },
                        {
                            icon: 'fas fa-image',
                            text: 'Set as Wallpaper',
                            action: 'spellcaster-set-wallpaper',
                            disabled: () => !hasImage(),
                            hidden: () => !document.body.classList.contains('desktop-mode')
                        },
                        {
                            icon: 'fas fa-crosshairs',
                            text: 'Jump to Image',
                            action: 'spellcaster-jump-workspace',
                            disabled: () => !hasImage()
                        },
                        {
                            icon: 'nai-img2img',
                            text: 'New Reference',
                            action: 'spellcaster-create-reference',
                            disabled: () => !hasImage()
                        },
                        {
                            icon: 'fas fa-arrow-down-left',
                            text: 'Add to Desktop',
                            action: 'spellcaster-desktop-shortcut',
                            disabled: () => !hasImage(),
                            hidden: () => !document.body.classList.contains('desktop-mode')
                        }
                    ]
                },
                {
                    type: 'list',
                    title: 'Management',
                    items: [
                        {
                            content: () => manager.buildMoveToMenuContent(),
                            optionsfn: getMoveWorkspaceOptions,
                            handlerfn: handleMoveWorkspaceAction,
                            openOnHover: false,
                            disabled: () => !hasImage(),
                            loadfn: (menuItem) => {
                                const options = getMoveWorkspaceOptions(null);
                                menuItem.disabled = !hasImage() || !options.length;
                            }
                        },
                        {
                            icon: 'fas fa-bin-recycle',
                            text: 'Scrap',
                            action: 'spellcaster-scrap',
                            disabled: () => !hasImage()
                        },
                        {
                            icon: 'fas fa-fire',
                            text: 'Incinerate',
                            action: 'spellcaster-incinerate',
                            disabled: () => !hasImage()
                        },
                        { separator: true },
                        {
                            icon: 'fas fa-broom',
                            text: 'Clear Results',
                            action: 'spellcaster-clear-results',
                            className: 'context-menu-item-danger'
                        }
                    ]
                }
            ]
        };
    }

    handleSpellbookContextMenuAction(event) {
        const { action, target } = event.detail;
        if (!action || !action.startsWith('spellcaster-')) return;
        if (!this.modal || !this.modal.contains(target)) return;

        const image = this.getPreviewImageMetadata();

        switch (action) {
            case 'spellcaster-open-spellbook':
                // showPresetManager: public/scripts/comp/presetManager.js
                showPresetManager();
                break;
            case 'spellcaster-clear-results':
                this.clearResults();
                break;
            case 'spellcaster-toggle-pin':
                if (image) togglePinImage(image);
                break;
            case 'spellcaster-reroll':
                if (image) rerollImage(image);
                break;
            case 'spellcaster-copy':
                void this.handleCopy();
                break;
            case 'spellcaster-download':
                this.handleDownload();
                break;
            case 'spellcaster-lightbox':
                this.handleImageClick();
                break;
            case 'spellcaster-creator':
                if (image) {
                    openManualModalWithContent({ type: 'image', image });
                }
                break;
            case 'spellcaster-expand':
                void this.handleExpand();
                break;
            case 'spellcaster-enhance':
                void this.handleEnhance();
                break;
            case 'spellcaster-upscale':
                void this.handleUpscale();
                break;
            case 'spellcaster-start-chat': {
                if (!image || !window.chatSystem) break;
                const filename = image.filename || image.original || image.upscaled;
                const characterName = image.characterName || image.metadata?.character_name || null;
                window.chatSystem.openChatModal(filename, characterName);
                break;
            }
            case 'spellcaster-set-wallpaper': {
                const filename = image?.filename || image?.original || image?.upscaled;
                if (filename) openDesktopSettingsModal(`file:${filename}`);
                break;
            }
            case 'spellcaster-desktop-shortcut':
                if (image) createDesktopShortcutFromImage(image);
                break;
            case 'spellcaster-jump-workspace':
                void this.jumpPreviewToWorkspace();
                break;
            case 'spellcaster-create-reference':
                if (image) createVibeEncodingFromImage(image);
                break;
            case 'spellcaster-scrap':
                if (image) moveToScraps(image);
                break;
            case 'spellcaster-incinerate':
                if (image) deleteImage(image);
                break;
        }
    }

    buildMoveToMenuContent() {
        const workspaceId = this.generatedWorkspace
            || (typeof activeWorkspace !== 'undefined' ? activeWorkspace : null)
            || window.activeWorkspace
            || 'default';
        const workspacesData = (typeof workspaces !== 'undefined' ? workspaces : null) || window.workspaces || {};
        const workspaceColor = workspacesData[workspaceId]?.color || '#6366f1';
        return `
            <div class="workspace-option-content" style="display: flex; align-items: center; gap: 8px;">
                <div class="workspace-color-indicator" style="width: 12px; height: 12px; border-radius: 50%; background-color: ${workspaceColor};"></div>
                <span class="context-menu-item-text">Move to...</span>
            </div>
        `;
    }

    async jumpPreviewToWorkspace() {
        const filename = this.generatedFilename;
        if (!filename) return;

        const currentWorkspaceId = (typeof activeWorkspace !== 'undefined' ? activeWorkspace : null) || window.activeWorkspace || 'default';
        const imageWorkspaceId = this.generatedWorkspace || currentWorkspaceId;

        const findImageIndex = () => {
            if (!Array.isArray(allImages) || !allImages.length) return -1;
            return allImages.findIndex(img =>
                img && (img.filename === filename || img.original === filename || img.upscaled === filename)
            );
        };

        let imageIndex = findImageIndex();

        if (imageIndex === -1 && imageWorkspaceId !== currentWorkspaceId) {
            const workspacesData = (typeof workspaces !== 'undefined' ? workspaces : null) || window.workspaces || {};
            const workspaceName = workspacesData[imageWorkspaceId]?.name || imageWorkspaceId;
            const confirmed = await showConfirmationDialog(
                `This image is in the "${workspaceName}" workspace. Switch to that workspace and jump to the image?`,
                [
                    { text: 'Switch & Jump', value: true, className: 'btn-primary' },
                    { text: 'Cancel', value: false, className: 'btn-secondary' }
                ]
            );
            if (!confirmed) return;
            await setActiveWorkspace(imageWorkspaceId);
            await loadGallery(true);
            imageIndex = findImageIndex();
        }

        if (imageIndex === -1) {
            await loadGallery(true);
            imageIndex = findImageIndex();
        }

        if (imageIndex === -1) {
            showGlassToast('warning', 'Not Found', 'Image not found in workspace', false, 3000, '<i class="fas fa-exclamation-triangle"></i>');
            return;
        }

        let targetIndex = imageIndex;
        if (Array.isArray(window.filteredImageIndices)) {
            const filteredIndex = window.filteredImageIndices.indexOf(imageIndex);
            if (filteredIndex !== -1) {
                targetIndex = filteredIndex;
            } else {
                showGlassToast('warning', 'Not Visible', 'Image is filtered out of current view', false, 3000, '<i class="fas fa-exclamation-triangle"></i>');
                return;
            }
        }

        const galleryWindow = document.getElementById('galleryWindow');
        if (galleryWindow) {
            if (isGalleryWindowHidden()) {
                openModal(galleryWindow);
                if (typeof window.isGalleryHidden !== 'undefined') {
                    window.isGalleryHidden = false;
                }
            } else {
                bringModalToFront(galleryWindow);
            }
        }

        await displayGalleryFromStartIndex(targetIndex, true);
    }

    releaseSpellbookPreviewImageSrc() {
        if (!this.previewImage) return;
        this.previewImage.onload = null;
        this.previewImage.onerror = null;
        const src = this.previewImage.currentSrc || this.previewImage.src || '';
        if (src.startsWith('blob:') || src.startsWith('data:')) {
            if (src.startsWith('blob:')) {
                URL.revokeObjectURL(src);
            }
        }
        this.previewImage.removeAttribute('src');
        this.previewImage.classList.add('hidden');
    }

    clearResults() {
        this.releaseSpellbookPreviewImageSrc();

        this.generatedFilename = null;
        this.generatedWorkspace = null;
        this.generatedWidth = null;
        this.generatedHeight = null;
        this.generatedMetadata = null;
        this.generatedImage = null;

        if (this.blurBackground1) {
            this.blurBackground1.style.opacity = '0';
            this.blurBackground1.style.backgroundImage = 'none';
        }
        if (this.blurBackground2) {
            this.blurBackground2.style.opacity = '0';
            this.blurBackground2.style.backgroundImage = 'none';
        }

        if (this.upscaleBtn) {
            this.upscaleBtn.disabled = true;
            this.upscaleBtn.classList.add('hidden');
        }
        if (this.downloadBtn) this.downloadBtn.disabled = true;
        if (this.copyBtn) this.copyBtn.disabled = true;
        if (this.expandBtn) this.expandBtn.disabled = true;
        if (this.goToWorkspaceBtn) this.goToWorkspaceBtn.disabled = true;

        this.resetSpellbookGenerationAnimation();
        this.hideSpellbookDynamicGenerationOverlay();
        this.hideSpellbookDynamicGenerationProgressOverlayImmediate();
        this.updatePreviewActionButtons();
    }

    hasPreviewResult() {
        return !!(this.generatedFilename && this.previewImage && !this.previewImage.classList.contains('hidden') && this.previewImage.src);
    }

    updatePreviewActionButtons() {
        const hasResult = this.hasPreviewResult();
        const buttons = [this.downloadBtn, this.copyBtn, this.expandBtn, this.goToWorkspaceBtn];
        buttons.forEach((btn) => {
            if (btn) btn.disabled = !hasResult;
        });
        if (this.upscaleBtn) {
            if (hasResult) {
                this.upscaleBtn.classList.remove('hidden');
                this.upscaleBtn.disabled = false;
            } else {
                this.upscaleBtn.disabled = true;
                this.upscaleBtn.classList.add('hidden');
            }
        }
    }

    setProgressCancelVisible(visible) {
        const btn = this.dynamicGenerationProgressCancelBtn;
        if (!btn) return;
        btn.classList.toggle('hidden', !visible);
        btn.disabled = !visible;
    }

    openModal() {
        if (!this.modal) return;

        openModal(this.modal);

        this.hideSpellbookDynamicGenerationOverlay();
        this.hideSpellbookDynamicGenerationProgressOverlayImmediate();
        this.setProgressCancelVisible(false);
        this.updatePreviewActionButtons();

        // Ensure editor button is disabled if no preset is selected
        if (this.editorBtn) {
            this.editorBtn.disabled = !this.selectedPreset;
        }
        if (this.customPresetDropdown && !this.customPresetDropdown.dataset.initialized) {
            setupDropdown(
                this.customPresetDropdown,
                this.customPresetDropdownBtn,
                this.customPresetDropdownMenu,
                (sel) => this.renderCustomPresetDropdown(sel),
                () => this.selectedPreset,
                { preventFocusTransfer: true }
            );
            this.customPresetDropdown.dataset.initialized = 'true';

            // Load initial presets
            this.loadPresets();
        }

        // Block container will be initialized before each generation

        // Focus first element
        setTimeout(() => {
            if (this.customPresetDropdownBtn) {
                this.customPresetDropdownBtn.focus();
            }
        }, 100);
    }

    async closeModal() {
        if (!this.modal) return;

        await closeModal(this.modal);

        this.hideSpellbookDynamicGenerationOverlay();
        this.hideSpellbookDynamicGenerationProgressOverlayImmediate();
        this.dynamicGenerationActive = false;
    }

    async renderCustomPresetDropdown(selectedValue) {
        if (!this.customPresetDropdownMenu) return;

        this.customPresetDropdownMenu.innerHTML = '';

        // Use global presets loaded from /options
        if (Array.isArray(window.optionsData.presets) && window.optionsData.presets.length > 0) {
            for (const preset of window.optionsData.presets.slice().reverse()) {
                try {
                    // Skip invalid presets
                    if (!preset || !preset.name) {
                        console.warn('Skipping invalid preset:', preset);
                        continue;
                    }

                    const option = document.createElement('div');
                    option.className = 'custom-dropdown-option' + (selectedValue === preset.name ? ' selected' : '');
                    option.tabIndex = 0;
                    option.dataset.value = preset.name;
                    option.dataset.type = 'preset';

                    // Create compact preset option with same icons as createPresetItem
                    const presetName = document.createElement('div');
                    presetName.className = 'preset-name';
                    presetName.textContent = preset.name;

                    const presetIcons = document.createElement('div');
                    presetIcons.className = 'preset-icons';

                    // Paid requests
                    if (preset.allow_paid === true) {
                        const icon = document.createElement('i');
                        icon.className = 'nai-anla';
                        icon.title = 'Paid Requests Enabled';
                        presetIcons.appendChild(icon);
                    }

                    // Character prompts
                    if (preset.character_prompts) {
                        const icon = document.createElement('i');
                        icon.className = 'fas fa-users';
                        icon.title = `${preset.character_prompts} Character Prompt${preset.character_prompts > 1 ? 's' : ''}`;
                        presetIcons.appendChild(icon);

                        // Uses Character Coordinates
                        if (preset.use_coords) {
                            const icon = document.createElement('i');
                            icon.className = 'fas fa-location-crosshairs';
                            icon.title = 'Using Character Coordinates';
                            presetIcons.appendChild(icon);
                        }
                    }

                    // Upscale
                    if (preset.upscale === true) {
                        const icon = document.createElement('i');
                        icon.className = 'fas fa-high-definition';
                        icon.title = 'Upscale enabled';
                        presetIcons.appendChild(icon);
                    }

                    // Image to image
                    if (preset.image || preset.image_source) {
                        const icon = document.createElement('i');
                        icon.className = 'fas fa-image';
                        icon.title = 'Image to Image';
                        presetIcons.appendChild(icon);

                        // Image Bias
                        if (preset.image_bias) {
                            const icon = document.createElement('i');
                            icon.className = 'fas fa-crop';
                            icon.title = 'Image Bias';
                            presetIcons.appendChild(icon);
                        }
                    }

                    // Vibe transfer
                    if (preset.chara_reference_source) {
                        const icon = document.createElement('i');
                        icon.className = 'nai-precise-reference';
                        icon.title = `Precise Reference`;
                        presetIcons.appendChild(icon);
                    } else 
                    // Inpaint
                    if ((preset.image || preset.image_source) && preset.mask_compressed) {
                        const icon = document.createElement('i');
                        icon.className = 'nai-inpaint';
                        icon.title = 'Selective Masking (Inpaint)';
                        presetIcons.appendChild(icon);
                    } else
                    // Vibe transfer
                    if (preset.vibe_transfer) {
                        const icon = document.createElement('i');
                        icon.className = 'nai-vibe-transfer';
                        icon.title = `${preset.vibe_transfer} Vibe Transfer${preset.vibe_transfer > 1 ? 's' : ''}`;
                        presetIcons.appendChild(icon);
                    }
                    

                    // Variety
                    if (preset.variety === true) {
                        const icon = document.createElement('i');
                        icon.className = 'fas fa-sparkle';
                        icon.title = 'Variety+ Enabled';
                        presetIcons.appendChild(icon);
                    }

                    // Dataset info (priority: furry > backgrounds > anime)
                    const datasetIcon = document.createElement('i');
                    if (preset.dataset_config && preset.dataset_config.include && Array.isArray(preset.dataset_config.include) && preset.dataset_config.include.length > 0) {

                        if (preset.dataset_config.include.includes('furry')) {
                            datasetIcon.className = 'nai-paw';
                        } else if (preset.dataset_config.include.includes('backgrounds')) {
                            datasetIcon.className = 'fas fa-tree';
                        } else {
                            datasetIcon.className = 'nai-sakura';
                        }
                    } else {
                        datasetIcon.className = 'nai-sakura';
                    }
                    datasetIcon.title = 'Dataset enabled';
                    presetIcons.appendChild(datasetIcon);

                    // Quality preset info
                    if (preset.append_quality === true) {
                        const icon = document.createElement('i');
                        icon.className = 'fas fa-crown';
                        icon.title = 'Quality Preset Enabled';
                        presetIcons.appendChild(icon);
                    }

                    // UC boxes
                    const boxes = document.createElement('div');
                    boxes.className = 'uc-boxes';
                    if (preset.append_uc !== undefined && preset.append_uc !== null) {
                        boxes.dataset.ucLevel = preset.append_uc.toString();
                    } else {
                        boxes.dataset.ucLevel = '0';
                    }
                    for (let i = 1; i <= 4; i++) {
                        const box = document.createElement('div');
                        box.className = 'uc-box';
                        box.dataset.level = i.toString();
                        boxes.appendChild(box);
                    }
                    presetIcons.appendChild(boxes);

                    // Create two-row layout
                    const presetContent = document.createElement('div');
                    presetContent.className = 'preset-option-content-two-rows';

                    // First row: name only
                    const firstRow = document.createElement('div');
                    firstRow.className = 'preset-option-row-1';
                    firstRow.appendChild(presetName);

                    // Second row: model/resolution on left, icons on right
                    const secondRow = document.createElement('div');
                    secondRow.className = 'preset-option-row-2';

                    // Left side: model and resolution info
                    const leftSide = document.createElement('div');
                    leftSide.className = 'preset-option-left';

                    // Model info
                    const modelSpan = document.createElement('span');
                    let group = null;
                    for (const g of modelGroups) {
                        const found = g.options.find(o => o.value === preset.model.toLowerCase());
                        if (found) {
                        group = g.group;
                        break;
                        }
                    }
                    const groupObj = modelGroups.find(g => g.group === group);
                    const optObj = groupObj ? groupObj.options.find(o => o.value === preset.model.toLowerCase()) : null;
                    if (optObj) {
                        if (optObj.badge_full) {
                            modelSpan.innerHTML = [
                                `<span>${optObj.display}</span>`,
                                `<span>${optObj.badge_full}</span>`,
                            ].filter(Boolean).join(' ');
                        } else if (optObj.badge) {
                            modelSpan.innerHTML = [
                                `<span>${optObj.display}</span>`,
                                `<span>${optObj.badge}</span>`,
                            ].filter(Boolean).join(' ');
                        } else {
                            modelSpan.textContent = preset.model || 'V4.5?';
                        }
                        modelSpan.className = `preset-model ${optObj.badge_class}`;
                    } else {
                        modelSpan.textContent = preset.model || 'V4.5?';
                        modelSpan.className = 'preset-model';
                    }
                    leftSide.appendChild(modelSpan);

                    // Resolution info
                    const resSpan = document.createElement('span');
                    resSpan.className = 'preset-resolution';

                    // Get proper resolution display name and check if it's large/wallpaper
                    let resolutionDisplay = ((preset.resolution || 'normal_portrait?').toLowerCase()).split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1));

                    if (resolutionDisplay[0] !== 'Normal') {
                        const resolutionText = document.createElement('span');
                        const resolutionTextInner = document.createElement('span');
                        if (resolutionDisplay[0] === 'Large' || resolutionDisplay[0] === 'Wallpaper') {
                            const dollarIcon = document.createElement('i');
                            dollarIcon.className = 'fas fa-dollar-sign';
                            dollarIcon.style.fontSize = '0.8em';
                            resolutionText.appendChild(dollarIcon);
                        }
                        resolutionTextInner.textContent = resolutionDisplay[0];
                        resolutionText.appendChild(resolutionTextInner);
                        resSpan.appendChild(resolutionText);
                        const resolutionText2 = document.createElement('span');
                        resolutionText2.textContent = resolutionDisplay[1];
                        resSpan.appendChild(resolutionText2);
                    } else {
                        resSpan.textContent = resolutionDisplay[1];
                    }

                    leftSide.appendChild(resSpan);

                    secondRow.appendChild(leftSide);
                    secondRow.appendChild(presetIcons);

                    presetContent.appendChild(firstRow);
                    presetContent.appendChild(secondRow);

                    option.appendChild(presetContent);

                    option.addEventListener('click', (e) => {
                        e.preventDefault();
                        this.selectPreset(preset.name);
                        closeDropdown(this.customPresetDropdownMenu, this.customPresetDropdownBtn);
                    });
                    option.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            this.selectPreset(preset.name);
                            closeDropdown(this.customPresetDropdownMenu, this.customPresetDropdownBtn);
                        }
                    });

                    this.customPresetDropdownMenu.appendChild(option);
                } catch (error) {
                    console.error('Error processing preset:', preset?.name || 'unknown', error);
                    continue;
                }
            }
        } else {
            const noPresets = document.createElement('div');
            noPresets.className = 'custom-dropdown-option';
            noPresets.textContent = 'No presets available';
            noPresets.style.opacity = '0.6';
            this.customPresetDropdownMenu.appendChild(noPresets);
        }
    }

    selectPreset(presetName) {
        this.selectedPreset = presetName;

        if (this.customPresetSelected) {
            if (presetName.startsWith('chapter:')) {
                const chapterName = presetName.replace('chapter:', '');
                const chapter = window.chapterData?.find(c => c.name === chapterName);
                const displayName = chapter ? chapter.displayName : chapterName;
                this.customPresetSelected.innerHTML = `<i class="fas fa-layer-group"></i> ${displayName}`;
            } else {
                this.customPresetSelected.innerHTML = `<i class="fa-light fa-sparkle"></i> ${presetName}`;
            }
        }

        if (this.clearPresetBtn) {
            this.clearPresetBtn.classList.remove('hidden');
        }

        if (this.generateBtn) {
            this.generateBtn.disabled = false;
        }
        // notifyKeyboardOverlayContextChanged: public/scripts/comp/modalKeyboardRegistry.js
        notifyKeyboardOverlayContextChanged();

        if (this.editorBtn) {
            this.editorBtn.disabled = false;
        }

        // Update the hidden input for compatibility - use the correct preset format
        const hiddenInput = document.getElementById('presetSelect');
        if (hiddenInput) {
            if (presetName.startsWith('chapter:')) {
                // For chapters, we need to get the chapter's UUID
                const chapterName = presetName.replace('chapter:', '');
                const chapter = window.chapterData?.find(c => c.name === chapterName);
                if (chapter) {
                    hiddenInput.value = `preset:${chapter.uuid}`;
                }
            } else {
                hiddenInput.value = `preset:${presetName}`;
            }
        }

        console.log('Selected preset:', presetName);
    }

    clearPreset() {
        this.selectedPreset = '';

        if (this.customPresetSelected) {
            this.customPresetSelected.innerHTML = '<i class="fa-light fa-book-spells"></i> Select Spell...';
        }

        if (this.clearPresetBtn) {
            this.clearPresetBtn.classList.add('hidden');
        }

        if (this.generateBtn) {
            this.generateBtn.disabled = true;
        }
        // notifyKeyboardOverlayContextChanged: public/scripts/comp/modalKeyboardRegistry.js
        notifyKeyboardOverlayContextChanged();

        if (this.editorBtn) {
            this.editorBtn.disabled = true;
        }

        if (this.upscaleBtn) {
            this.upscaleBtn.disabled = true;
        }

        // Clear the hidden input
        const hiddenInput = document.getElementById('presetSelect');
        if (hiddenInput) {
            hiddenInput.value = '';
        }

        console.log('Cleared preset selection');
    }

    async handleGenerate() {
        if (this.isGenerating || !this.selectedPreset) return;

        this.isGenerating = true;
        updateImageGenerationIndicator();
        this.generateBtn.disabled = true;
        this.generateBtn.innerHTML = '<i class="fas fa-spinner-third fa-spin"></i>';

        let toastId;

        try {
            // Check if WebSocket is connected and has generatePreset method
            if (!window.wsClient || !window.wsClient.isConnected()) {
                throw new Error('WebSocket not connected. Please check your connection.');
            }
            if (!window.wsClient.generatePreset) {
                throw new Error('Generation service not available. Please refresh the page.');
            }

            // Check for credit costs and show confirmation dialog
            const selectedPreset = window.optionsData.presets.find(p => p.name === this.selectedPreset);
            let allowPaid = false;
            if (selectedPreset && !selectedPreset.allow_paid) {
                // Build request body for cost calculation
                const requestBody = { ...selectedPreset };
                if (requestBody.resolution && !requestBody.width && !requestBody.height) {
                    const dimensions = getDimensionsFromResolution ? getDimensionsFromResolution(requestBody.resolution) : null;
                    if (dimensions) {
                        requestBody.width = dimensions.width;
                        requestBody.height = dimensions.height;
                    }
                }

                // Calculate credit cost
                const cost = calculateCreditCost ? calculateCreditCost(requestBody) : 0;

                // Show credit cost dialog if needed
                if (cost > 0) {
                    const confirmed = await showCreditCostDialog(cost);
                    if (!confirmed) {
                        // Reset button state
                        this.generateBtn.disabled = false;
                        this.generateBtn.innerHTML = '<i class="nai-sparkles"></i>';
                        this.isGenerating = false;
                        updateImageGenerationIndicator();
                        return;
                    }
                    // Set allow_paid flag for this request
                    allowPaid = true;
                }
            }

            // Start generation animations (Rentan overlay only when websocket sends dynamic-gen packets)
            this.spellbookProgressOverlayCompleting = false;
            this.dynamicGenerationActive = false;
            this.hideSpellbookDynamicGenerationOverlay();
            this.hideSpellbookDynamicGenerationProgressOverlayImmediate();
            this.setProgressCancelVisible(false);
            this.startSpellbookGenerationAnimation();

            // Show progress toast
            toastId = showGlassToast('info', 'Generating Image', 'Generating image...', true, false, '<i class="nai-sparkles"></i>');

            // Start progress animation (1% per second)
            let progress = 0;
            if (this.spellbookProgressInterval) {
                clearInterval(this.spellbookProgressInterval);
                this.spellbookProgressInterval = null;
            }
            this.spellbookProgressInterval = setInterval(() => {
                progress += 1;
                updateGlassToastProgress(toastId, progress);
            }, 1000);

            // Generate image using WebSocket with streaming enabled
            const result = await window.wsClient.generatePreset(this.selectedPreset, null, allowPaid, true);

            // Extract data from the response
            const filename = result.filename;
            const workspace = result.workspace;

            // Stop progress animation
            if (this.spellbookProgressInterval) {
                clearInterval(this.spellbookProgressInterval);
                this.spellbookProgressInterval = null;
            }

            // Update toast to show success
            updateGlassToastComplete(toastId, {
                type: 'success',
                title: 'Image Generated',
                message: 'Image generated successfully!',
                customIcon: '<i class="nai-check"></i>',
                showProgress: false
            });

            // Finalize buffered streaming steps and show final image (prefetch when ready)
            let finalizeResult = { prefetchedBlobUrl: null, skippedDownloadUi: false };
            if (window.wsClient && window.wsClient.finalizeGenerationPreview) {
                let contentLength = result.contentLength || result.metadata?.file_size || null;
                if ((!contentLength || contentLength <= 0) && window.wsClient.pendingGenerationDownloadBytes > 0) {
                    const pendingName = window.wsClient.pendingGenerationDownloadFilename;
                    if (!pendingName || pendingName === filename) {
                        contentLength = window.wsClient.pendingGenerationDownloadBytes;
                    }
                }
                finalizeResult = await window.wsClient.finalizeGenerationPreview('spellbook', {
                    filename,
                    contentLength
                });
            } else if (window.wsClient && window.wsClient.waitForStreamingStepsComplete) {
                await window.wsClient.waitForStreamingStepsComplete('spellbook');
            }

            if (window.wsClient) {
                window.wsClient.pendingGenerationDownloadBytes = null;
                window.wsClient.pendingGenerationDownloadFilename = null;
            }

            // Create confetti effect
            console.log('About to create spellbook confetti');
            this.createSpellbookConfetti();

            // Display the generated image in the modal
            if (filename && this.previewImage) {
                const imageUrl = localGalleryImageUrl(filename);
                const needsDownloadOverlay = !finalizeResult.skippedDownloadUi && !finalizeResult.prefetchedBlobUrl;

                if (needsDownloadOverlay) {
                    // showManualPreviewNavigationLoading: public/scripts/comp/manualModalManager.js
                    const knownLen = result.contentLength || null;
                    try {
                        const fetchResult = await fetchTrackedImageBlob(
                            imageUrl,
                            knownLen,
                            (progress) => {
                                if (progress.total > 0) {
                                    const pct = Math.min(100, Math.round(progress.ratio * 100));
                                    showManualPreviewNavigationLoading(true, `Downloading ${pct}%`, pct);
                                } else if (progress.loaded > 0) {
                                    showManualPreviewNavigationLoading(true, 'Downloading…', 'indeterminate');
                                } else {
                                    showManualPreviewNavigationLoading(true, 'Downloading…', 0);
                                }
                            },
                            { headers: { 'X-Preview-Finalize': '1' } }
                        );
                        if (fetchResult.objectUrl) {
                            finalizeResult.prefetchedBlobUrl = fetchResult.objectUrl;
                        }
                    } catch (fetchErr) {
                        console.warn('Spellbook final image fetch failed, falling back to direct load:', fetchErr);
                    }
                }

                const resolvedSrc = finalizeResult.prefetchedBlobUrl || imageUrl;
                await new Promise((resolve, reject) => {
                    let timeoutId;
                    const cleanup = () => {
                        if (timeoutId) clearTimeout(timeoutId);
                        this.previewImage.onload = null;
                        this.previewImage.onerror = null;
                    };
                    const finish = () => {
                        cleanup();
                        resolve();
                    };
                    this.previewImage.onerror = () => {
                        cleanup();
                        reject(new Error('Failed to load generated preview image'));
                    };
                    timeoutId = setTimeout(() => {
                        cleanup();
                        resolve();
                        console.warn('Spellbook preview image load timed out after 10 seconds');
                    }, 10000);
                    this.releaseSpellbookPreviewImageSrc();
                    this.previewImage.src = resolvedSrc;
                    if (this.previewImage.decode) {
                        this.previewImage.decode().then(finish).catch(() => {
                            this.previewImage.onload = finish;
                        });
                    } else {
                        this.previewImage.onload = finish;
                    }
                });
                this.previewImage.classList.remove('hidden');

                // Store generated image info
                this.generatedFilename = filename;
                this.generatedWorkspace = workspace;
                
                // Store dimensions for upscale calculation
                this.generatedWidth = result.width || result.metadata?.width;
                this.generatedHeight = result.height || result.metadata?.height;
                this.generatedMetadata = result.metadata || null;
                this.generatedImage = {
                    filename,
                    original: filename,
                    width: this.generatedWidth,
                    height: this.generatedHeight,
                    metadata: this.generatedMetadata
                };

                this.updatePreviewActionButtons();
                this.updateSpellbookBlurredBackground(imageUrl);
            }

            // Stop animations and overlay AFTER image is displayed
            this.stopSpellbookGenerationAnimation();
            const hadDynamicGenContext = this.dynamicGenerationActive;
            this.dynamicGenerationActive = false;
            this.setProgressCancelVisible(false);
            this.hideSpellbookDynamicGenerationProgressOverlayImmediate();
            if (hadDynamicGenContext) {
                this.showSpellbookDynamicGenerationOverlay();
            } else {
                this.hideSpellbookDynamicGenerationOverlay();
            }
            // Reset generating state
            this.isGenerating = false;
            updateImageGenerationIndicator();
            this.generateBtn.disabled = false;
            this.generateBtn.innerHTML = '<i class="nai-sparkles"></i>';
            
            await loadGallery(true);

        } catch (error) {
            if (error && error.code === 'CLIENT_CANCELLED') {
                if (this.spellbookProgressInterval) {
                    clearInterval(this.spellbookProgressInterval);
                    this.spellbookProgressInterval = null;
                }
                this.stopSpellbookGenerationAnimation();
                this.hideSpellbookDynamicGenerationProgressOverlayImmediate();
                this.hideSpellbookDynamicGenerationOverlay();
                this.setProgressCancelVisible(false);
                this.dynamicGenerationActive = false;
                this.isGenerating = false;
                updateImageGenerationIndicator();
                this.generateBtn.disabled = false;
                this.generateBtn.innerHTML = '<i class="nai-sparkles"></i>';
                return;
            }
            console.error('Generation error:', error);

            if (window.wsClient) {
                window.wsClient.clearStreamingStepQueues(null, true);
            }

            // Stop progress animation
            if (this.spellbookProgressInterval) {
                clearInterval(this.spellbookProgressInterval);
                this.spellbookProgressInterval = null;
            }

            // Update toast to show error
            if (toastId) {
                updateGlassToastComplete(toastId, {
                    type: 'error',
                    title: 'Generation Failed',
                    message: error.message || 'Failed to generate image',
                    customIcon: '<i class="nai-cross"></i>',
                    showProgress: false
                });
            } else {
                // Fallback error display
                showGlassToast('error', 'Generation Failed', error.message || 'Failed to generate image', false, 5000, '<i class="nai-cross"></i>');
            }
            // Reset generating state
            this.isGenerating = false;
            updateImageGenerationIndicator();
            this.generateBtn.disabled = false;
            this.generateBtn.innerHTML = '<i class="nai-sparkles"></i>';

            // Stop animations and overlay on error
            this.stopSpellbookGenerationAnimation();
            this.hideSpellbookDynamicGenerationProgressOverlayImmediate();
            this.hideSpellbookDynamicGenerationOverlay();
            this.setProgressCancelVisible(false);
            this.dynamicGenerationActive = false;
        }
    }

    handleEditor() {
        // Check if a preset is selected
        if (!this.selectedPreset) {
            console.warn('No preset selected for editor');
            return;
        }

        // Open the generation editor modal
        openManualModalWithContent();
        this.closeModal();
    }

    async updateSpellbookBlurredBackground(imageUrl) {
        try {
            // Extract filename from imageUrl
            const filename = imageUrl.split('/').pop();
            const baseName = filename
                .replace(/\.(png|jpg|jpeg)$/i, '')
                .replace(/_upscaled$/, '');

            // Soft backdrop from BlurHash only (CSS filter supplies blur; no @lq)
            let blurPreviewUrl = null;
            const galleryMatch = (typeof allImages !== 'undefined' && Array.isArray(allImages))
                ? allImages.find((img) => img.base === baseName || img.filename === filename
                    || img.original === filename || img.upscaled === filename)
                : null;
            const hash = galleryMatch?.blurhash
                || galleryMatch?.metadata?.forge_data?.blurhash
                || null;
            if (hash) {
                blurPreviewUrl = blurhashToDataUrl(hash, 32, 32);
            }
            if (!blurPreviewUrl) {
                if (this.blurBackground1) this.blurBackground1.style.opacity = '0';
                if (this.blurBackground2) this.blurBackground2.style.opacity = '0';
                return;
            }

            // Preload the image before applying it to prevent flashing
            const preloadImage = new Image();
            preloadImage.crossOrigin = 'anonymous';

            await new Promise((resolve, reject) => {
                preloadImage.onload = resolve;
                preloadImage.onerror = reject;
                preloadImage.src = blurPreviewUrl;
            });

            // Determine which background is currently active
            const bg1Opacity = parseFloat(this.blurBackground1?.style.opacity) || 0;
            const bg2Opacity = parseFloat(this.blurBackground2?.style.opacity) || 0;
            const activeBg = bg1Opacity > 0 ? this.blurBackground1 : this.blurBackground2;
            const inactiveBg = bg1Opacity > 0 ? this.blurBackground2 : this.blurBackground1;

            // Set the new image on the inactive background
            if (inactiveBg) {
                inactiveBg.style.backgroundImage = `url("${blurPreviewUrl}")`;
                inactiveBg.style.opacity = '0';
            }

            // Force a reflow to ensure the background image is applied before transition
            if (inactiveBg) {
                inactiveBg.offsetHeight;
            }

            // Start the CSS transition
            if (activeBg) activeBg.style.opacity = '0';
            if (inactiveBg) inactiveBg.style.opacity = '0.45';

            // Return a promise that resolves when the CSS transition completes
            return new Promise((resolve) => {
                setTimeout(() => {
                    // Clean up the old background image
                    if (activeBg && parseFloat(activeBg.style.opacity) === 0) {
                        activeBg.style.backgroundImage = 'none';
                    }
                    resolve();
                }, 550); // 500ms transition + 50ms buffer
            });

        } catch (error) {
            console.error('Failed to update spellbook blur background:', error);
            // Hide backgrounds on error
            if (this.blurBackground1) this.blurBackground1.style.opacity = '0';
            if (this.blurBackground2) this.blurBackground2.style.opacity = '0';
        }
    }

    createSpellbookConfetti() {
        if (!this.confettiContainer) {
            console.warn('Confetti container not found');
            return;
        }

        console.log('Creating spellbook confetti...');

        // Multi-colored confetti palette with vibrant colors
        const colors = [
            '#ff4500', '#ff6347', '#ff8c00', '#ffa500', '#ff6b35', '#ff7f50', // Orange/Red variants
            '#ff1493', '#ff69b4', '#ffb6c1', '#ffc0cb', '#db7093', '#c71585', // Pink variants
            '#00ff00', '#32cd32', '#90ee90', '#98fb98', '#00fa9a', '#00ff7f', // Green variants
            '#4169e1', '#1e90ff', '#00bfff', '#87ceeb', '#87cefa', '#b0e0e6', // Blue variants
            '#9370db', '#8a2be2', '#9932cc', '#ba55d3', '#da70d6', '#ee82ee', // Purple variants
            '#ffff00', '#ffd700', '#ffeb3b', '#f0e68c', '#bdb76b', '#f4a460', // Yellow/Gold variants
            '#ff4500', '#ff6347', '#ff8c00', '#ffa500', '#ff6b35', '#ff7f50'  // Additional orange/red
        ];
        const shapes = ['rect', 'circle', 'triangle'];

        // Create confetti pieces
        const totalPieces = 80;

        for (let i = 0; i < totalPieces; i++) {
            setTimeout(() => {
                const confetti = document.createElement('div');
                confetti.className = 'confetti';

                // Position relative to the modal, not the container
                const modalRect = this.modal.getBoundingClientRect();
                const containerRect = this.confettiContainer.getBoundingClientRect();

                // Calculate position relative to modal
                const relativeX = containerRect.left - modalRect.left;
                const relativeY = containerRect.top - modalRect.top;

                // Random position within the image container area
                const randomX = Math.random() * containerRect.width;
                const randomY = Math.random() * containerRect.height;

                confetti.style.left = (relativeX + randomX) + 'px';
                confetti.style.top = (relativeY + randomY) + 'px';
                confetti.style.position = 'absolute';

                // Random color from expanded palette
                const color = colors[Math.floor(Math.random() * colors.length)];
                confetti.style.backgroundColor = color;

                // Random size between 4px and 12px
                const size = Math.random() * 8 + 4;
                confetti.style.width = size + 'px';
                confetti.style.height = size + 'px';

                // Random shape
                const shape = shapes[Math.floor(Math.random() * shapes.length)];
                if (shape === 'circle') {
                    confetti.style.borderRadius = '50%';
                } else if (shape === 'triangle') {
                    confetti.style.width = '0';
                    confetti.style.height = '0';
                    confetti.style.backgroundColor = 'transparent';
                    confetti.style.borderLeft = (size/2) + 'px solid transparent';
                    confetti.style.borderRight = (size/2) + 'px solid transparent';
                    confetti.style.borderBottom = size + 'px solid ' + color;
                }

                // Random rotation
                confetti.style.transform = `rotate(${Math.random() * 360}deg)`;

                // Animation duration and delay
                const duration = 2.5 + Math.random() * 1.5; // 2.5 to 4 seconds
                const delay = Math.random() * 0.5; // 0 to 0.5 second delay
                confetti.style.animationDuration = duration + 's';
                confetti.style.animationDelay = delay + 's';

                // Use document.body instead of container for proper positioning
                document.body.appendChild(confetti);

                // Remove confetti after animation
                setTimeout(() => {
                    if (confetti.parentNode) {
                        confetti.parentNode.removeChild(confetti);
                    }
                }, (duration + delay) * 1000 + 500);
            }, i * 5); // Stagger the creation of confetti pieces
        }

        console.log('Spellbook confetti created');
    }

    async loadPresets() {
        // Trigger initial render of dropdown
        if (this.customPresetDropdownMenu && this.customPresetDropdownMenu.children.length === 0) {
            await this.renderCustomPresetDropdown(this.selectedPreset);
        }
    }

    handleDownload() {
        if (!this.generatedFilename) return;

        // Create download link
        const link = document.createElement('a');
        link.href = localGalleryImageUrl(this.generatedFilename);
        link.download = this.generatedFilename;
        link.style.display = 'none';

        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    async handleCopy() {
        if (!this.previewImage || this.previewImage.classList.contains('hidden')) return;

        try {
            // Get image as blob
            const response = await fetch(this.previewImage.src);
            const blob = await response.blob();

            // copyBlobToClipboard: public/scripts/utils/dreamscapeClipboard.js
            await copyBlobToClipboard(blob, { name: 'spellbook-image.png' });

            // Show success message
            if (window.showGlassToast) {
                window.showGlassToast('success', 'Image Copied', 'Image copied to clipboard!', false, 3000, '<i class="fas fa-check"></i>');
            }
        } catch (error) {
            console.error('Failed to copy image:', error);
            if (window.showGlassToast) {
                window.showGlassToast('error', 'Copy Failed', 'Failed to copy image to clipboard', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
            }
        }
    }

    async handleUpscale() {
        if (!this.generatedFilename) return;

        // Disable upscale button during upscaling
        if (this.upscaleBtn) {
            this.upscaleBtn.disabled = true;
            this.upscaleBtn.innerHTML = '<i class="fas fa-spinner-third fa-spin"></i>';
        }

        let toastId;
        let progressInterval;

        try {
            // Check if WebSocket is connected
            if (!window.wsClient || !window.wsClient.isConnected()) {
                throw new Error('WebSocket not connected. Please check your connection.');
            }

            // Calculate upscale cost and output resolution based on image dimensions
            const width = this.generatedWidth || 1024;
            const height = this.generatedHeight || 1024;
            const upscaleInfo = calculateUpscaleInfo(width, height);
            
            // Show upscale options dialog (always show for upscaling)
            const isFreeUpscaling = upscaleInfo.cost === 0;
            const confirmed = await showCreditCostDialog(upscaleInfo.cost, null, upscaleInfo.outputResolution, true, width, height, isFreeUpscaling);
            if (!confirmed) {
                // Reset button state
                this.upscaleBtn.disabled = false;
                this.upscaleBtn.innerHTML = '<i class="nai-upscale"></i>';
                return;
            }

            // Extract upscaler and scale from confirmation result
            const upscaler = confirmed.upscaler || 'novelai';
            const scale = confirmed.scale || 4;

            // Show progress toast
            toastId = showGlassToast('info', 'Upscaling Image', 'Upscaling image...', true, false, '<i class="nai-upscale"></i>');

            // Start progress animation (1% per second)
            let progress = 0;
            progressInterval = setInterval(() => {
                progress += 1;
                updateGlassToastProgress(toastId, progress);
            }, 1000);

            // Prepare upscaling parameters
            const upscaleParams = {
                filename: this.generatedFilename,
                workspace: this.generatedWorkspace || null,
                upscaler: upscaler,
                scale: scale
            };

            // Upscale image via WebSocket
            const result = await window.wsClient.upscaleImage(upscaleParams);

            if (result) {
                const { filename: upscaledFilename } = result;

                // Stop progress animation
                if (progressInterval) {
                    clearInterval(progressInterval);
                    progressInterval = null;
                }

                // Update toast to show success
                updateGlassToastComplete(toastId, {
                    type: 'success',
                    title: 'Upscale Complete',
                    message: 'Image upscaled successfully!',
                    customIcon: '<i class="nai-check"></i>',
                    showProgress: false
                });

                // Update the preview image to show the upscaled version (file on disk)
                if (this.previewImage) {
                    this.releaseSpellbookPreviewImageSrc();
                    this.previewImage.src = localGalleryImageUrl(upscaledFilename);
                    this.previewImage.classList.remove('hidden');
                }

                // Update the filename to the upscaled version
                this.generatedFilename = upscaledFilename;

                // Skip blur background update since it would be identical
                // The blur background would be the same as the original image

                // Refresh gallery to show the upscaled image
                if (typeof loadGallery === 'function') {
                    await loadGallery(true);
                }

                // Store the upscaled image info for lightbox
                this.generatedImage = { filename: upscaledFilename };

                console.log('Upscaled image:', upscaledFilename);
            } else {
                throw new Error('Invalid response from upscaling service');
            }

        } catch (error) {
            console.error('Upscaling error:', error);

            // Stop progress animation
            if (progressInterval) {
                clearInterval(progressInterval);
                progressInterval = null;
            }

            // Update toast to show error
            if (toastId) {
                updateGlassToastComplete(toastId, {
                    type: 'error',
                    title: 'Upscale Failed',
                    message: error.message || 'Failed to upscale image',
                    customIcon: '<i class="nai-cross"></i>',
                    showProgress: false
                });
            } else {
                showGlassToast('error', 'Upscale Failed', error.message || 'Failed to upscale image', false, 5000, '<i class="nai-cross"></i>');
            }
        } finally {
            // Re-enable upscale button
            if (this.upscaleBtn) {
                this.upscaleBtn.disabled = false;
                this.upscaleBtn.innerHTML = '<i class="nai-upscale"></i>';
            }
        }
    }

    async handleExpand() {
        if (!this.generatedFilename) return;

        try {
            // Check if WebSocket is connected
            if (!wsClient || !wsClient.isConnected()) {
                throw new Error('WebSocket not connected. Please check your connection.');
            }

            // Fetch metadata to get image dimensions
            let metadata = null;
            if (typeof getImageMetadata === 'function') {
                metadata = await getImageMetadata(this.generatedFilename);
            }

            const imageDimensions = metadata ? {
                width: metadata.actual_width || metadata.width,
                height: metadata.actual_height || metadata.height,
                resPreset: metadata.actual_resolution || metadata.resPreset || metadata.resolution
            } : null;

            // Open the expansion modal
            if (typeof openImageExpansionModal === 'function') {
                openImageExpansionModal(this.generatedFilename, imageDimensions);
            } else {
                console.error('openImageExpansionModal function not found');
                showGlassToast('error', 'Error', 'Image expansion feature not available', false, 5000, '<i class="nai-cross"></i>');
            }

        } catch (error) {
            console.error('Expand error:', error);
            showGlassToast('error', 'Error', error.message || 'Failed to open expansion modal', false, 5000, '<i class="nai-cross"></i>');
        }
    }

    handleEnhance() {
        if (!this.generatedFilename) return;
        openEnhanceFromImage(this.generatedImage || {
            filename: this.generatedFilename,
            original: this.generatedFilename,
            width: this.generatedWidth,
            height: this.generatedHeight,
            metadata: this.generatedMetadata || null
        });
    }

    // Animation and overlay methods (similar to manual modal)
    startSpellbookGenerationAnimation() {
        if (!this.previewStars || !this.previewBackgroundLines || !this.previewForegroundLines) {
            console.warn('Spellbook generation animation elements not found');
            return;
        }

        if (this.previewAnimationHost) {
            this.previewAnimationHost.classList.remove('preview-foreground-lines-active');
            this.previewAnimationHost.classList.add('preview-animation-active');
        }

        this.previewStars.classList.remove('hidden');
        this.previewBackgroundLines.classList.remove('hidden');
        this.previewForegroundLines.classList.remove('hidden');

        // Fade in stars (0.25s)
        setTimeout(() => {
            if (this.previewStars) {
                this.previewStars.style.opacity = '1';
            }
        }, 10);
        
        // Rising lines: background only until diffusion reports generating (foreground via CSS + setGenerationPreviewForegroundLinesActive)
        this.previewBackgroundLines.querySelectorAll('.preview-line').forEach((line) => {
            line.style.animationPlayState = 'running';
            line.style.transition = 'opacity 0.3s ease-out, visibility 0.3s ease-out';
            line.style.opacity = '1';
            line.style.visibility = 'visible';
        });
        this.previewForegroundLines.querySelectorAll('.preview-line').forEach((line) => {
            line.style.removeProperty('animation-play-state');
        });
        
    }

    stopSpellbookGenerationAnimation() {
        if (!this.previewStars || !this.previewBackgroundLines || !this.previewForegroundLines) {
            return;
        }

        this.previewBackgroundLines.classList.add('fadeOut');
        this.previewForegroundLines.classList.add('fadeOut');
        
        // Fade out stars after lines start fading (1.5s)
        setTimeout(() => {
            if (this.previewStars) {
                this.previewStars.style.opacity = '0';
            }
        }, 1500);
        
        // Hide everything after fade out completes (2.5s total)
        setTimeout(() => {
            if (this.previewStars) {
                this.previewStars.classList.add('hidden');
            }
            if (this.previewBackgroundLines) {
                this.previewBackgroundLines.classList.add('hidden');
                this.previewBackgroundLines.classList.remove('fadeOut');
            }
            if (this.previewForegroundLines) {
                this.previewForegroundLines.classList.add('hidden');
                this.previewForegroundLines.classList.remove('fadeOut');
            }
            if (this.previewAnimationHost) {
                this.previewAnimationHost.classList.remove('preview-animation-active', 'preview-foreground-lines-active');
            }

            // Reset line states
            const lines = this.modal.querySelectorAll('.preview-line');
            lines.forEach(line => {
                line.style.opacity = '1';
                line.style.visibility = 'visible';
            });
        }, 2500);
    }

    resetSpellbookGenerationAnimation() {
        if (this.previewStars) {
            this.previewStars.classList.add('hidden');
            this.previewStars.style.opacity = '0';
        }
        if (this.previewBackgroundLines) {
            this.previewBackgroundLines.classList.add('hidden');
            this.previewBackgroundLines.classList.remove('fadeOut');
        }
        if (this.previewForegroundLines) {
            this.previewForegroundLines.classList.add('hidden');
            this.previewForegroundLines.classList.remove('fadeOut');
        }
        if (this.previewAnimationHost) {
            this.previewAnimationHost.classList.remove('preview-animation-active', 'preview-foreground-lines-active');
        }

        // Reset line states
        const lines = this.modal.querySelectorAll('.preview-line');
        lines.forEach(line => {
            line.style.opacity = '1';
            line.style.visibility = 'visible';
            line.style.animationPlayState = 'paused';
        });
    }

    showSpellbookDynamicGenerationOverlay() {
        if (this.dynamicGenerationOverlay) {
            this.dynamicGenerationOverlay.classList.remove('hidden');
        }
    }

    hideSpellbookDynamicGenerationOverlay() {
        if (this.dynamicGenerationOverlay) {
            this.dynamicGenerationOverlay.classList.add('hidden');
        }
    }

    hideSpellbookDynamicGenerationProgressOverlayImmediate() {
        if (!this.dynamicGenerationProgressOverlay) return;
        const timeSection = document.querySelector('#spellbookDynamicGenerationProgressOverlay .progress-time-section');
        const weatherSection = document.querySelector('#spellbookDynamicGenerationProgressOverlay .progress-weather-section');
        if (timeSection) timeSection.classList.remove('fade-out');
        if (weatherSection) weatherSection.classList.remove('fade-out');
        this.dynamicGenerationProgressOverlay.classList.add('hidden');
        if (this.progressReasoningContainer) {
            this.progressReasoningContainer.innerHTML = '';
        }
        if (this.spellbookReasoningPositions) {
            this.spellbookReasoningPositions = [];
        }
        this.spellbookProgressOverlayCompleting = false;
        this.setProgressCancelVisible(false);
    }

    cancelSpellbookGenerationFromUser() {
        if (!this.dynamicGenerationProgressOverlay || this.dynamicGenerationProgressOverlay.classList.contains('hidden')) {
            return;
        }
        if (window.wsClient && typeof window.wsClient.cancelClientImageGeneration === 'function') {
            window.wsClient.cancelClientImageGeneration();
        }
        this.hideSpellbookDynamicGenerationProgressOverlayImmediate();
        this.setProgressCancelVisible(false);
        this.dynamicGenerationActive = false;
    }

    hideSpellbookDynamicGenerationProgressOverlay() {
        if (!this.dynamicGenerationProgressOverlay) return;

        this.setProgressCancelVisible(false);

        // Fade out time and weather sections first
        const timeSection = document.querySelector('#spellbookDynamicGenerationProgressOverlay .progress-time-section');
        const weatherSection = document.querySelector('#spellbookDynamicGenerationProgressOverlay .progress-weather-section');
        
        if (timeSection) timeSection.classList.add('fade-out');
        if (weatherSection) weatherSection.classList.add('fade-out');

        // Get all reasoning items
        const reasoningItems = document.querySelectorAll('#spellbookDynamicGenerationProgressOverlay .progress-reasoning-item');
        
        // After time/weather fade out (300ms), start fading out reasoning items one by one
        setTimeout(() => {
            if (reasoningItems.length === 0) {
                // No reasoning items, just hide the overlay
                this.dynamicGenerationProgressOverlay.classList.add('hidden');
                return;
            }

            // Fade out each reasoning item with staggered delays
            reasoningItems.forEach((item, index) => {
                setTimeout(() => {
                    item.classList.add('fade-out');
                    
                    // After the last item starts fading out, wait for it to complete then hide overlay
                    if (index === reasoningItems.length - 1) {
                        setTimeout(() => {
                            this.dynamicGenerationProgressOverlay.classList.add('hidden');
                            // Clean up reasoning items
                            if (this.progressReasoningContainer) {
                                this.progressReasoningContainer.innerHTML = '';
                            }
                        }, 400); // Match transition duration
                    }
                }, index * 150); // Stagger by 150ms
            });
        }, 300); // Wait for time/weather to fade out
    }

    updateSpellbookProgressStatus(status) {
        if (this.progressStatusText) {
            this.progressStatusText.textContent = status;
        }
    }

    addSpellbookProgressReasoning(reason, toolName = null, toolState = 'completed', toolReasoningId = null, data = null) {
        if (!reason) return;

        if (this.progressReasoningContainer) {
            // If this is a tool with an ID and we already have an item, update it
            if (toolName && toolReasoningId) {
                const existingDiv = document.getElementById(toolReasoningId);
                if (existingDiv) {
                    const toolStyle = getToolIconAndBackground(toolName, toolState);
                    
                    // Update background and border
                    existingDiv.style.background = toolStyle.backgroundColor;
                    existingDiv.style.borderLeft = `3px solid ${toolStyle.borderColor}`;
                    
                    // Update icon in row 1
                    const iconSpan = existingDiv.querySelector('.tool-icon');
                    if (iconSpan) {
                        iconSpan.innerHTML = toolStyle.icon;
                    }
                    
                    // Update status in row 2
                    const statusRow = existingDiv.querySelector('.tool-status-row');
                    if (statusRow && toolState === 'completed') {
                        statusRow.textContent = reason.trim();
                    } else if (statusRow && toolState === 'executing' && !data?.appendReason) {
                        // Update action text while executing (but not for append operations)
                        statusRow.textContent = getToolActionText(toolName);
                    } else if (statusRow && data?.appendReason) {
                        // For batch operations, append to row 3 instead of row 2
                        const reasoningRow = existingDiv.querySelector('.tool-reasoning-row');
                        if (reasoningRow) {
                            const currentText = reasoningRow.textContent;
                            reasoningRow.textContent = currentText ? `${currentText}\n${reason.trim()}` : reason.trim();
                        }
                    }
                    
                    return; // Don't create a new item
                }
            }
            
            // Create new div for this reasoning
            const reasonDiv = document.createElement('div');
            reasonDiv.className = 'progress-reasoning-item';
            
            // Set ID if this is a tool
            if (toolName && toolReasoningId) {
                reasonDiv.id = toolReasoningId;
            }
            
            // Apply tool-specific styling if this is a tool execution
            if (toolName && typeof getToolIconAndBackground === 'function') {
                const toolStyle = getToolIconAndBackground(toolName, toolState);
                reasonDiv.classList.add('tool-reasoning-item');
                reasonDiv.style.background = toolStyle.backgroundColor;
                reasonDiv.style.borderLeft = `3px solid ${toolStyle.borderColor}`;
                
                // Create 3-row layout for tools
                // Row 1: Icon + Tool Name
                const headerRow = document.createElement('div');
                headerRow.className = 'tool-header-row';
                
                const iconSpan = document.createElement('span');
                iconSpan.className = 'tool-icon';
                iconSpan.innerHTML = toolStyle.icon;
                
                const toolNameSpan = document.createElement('span');
                toolNameSpan.className = 'tool-name';
                toolNameSpan.textContent = getToolDisplayName(toolName);
                
                headerRow.appendChild(iconSpan);
                headerRow.appendChild(toolNameSpan);
                reasonDiv.appendChild(headerRow);
                
                // Row 2: Status/result (skip for completeTooling since it has no executing state)
                if (toolName !== 'completeTooling') {
                    const statusRow = document.createElement('div');
                    statusRow.className = 'tool-status-row';
                    if (toolState === 'completed') {
                        statusRow.textContent = reason.trim();
                    } else {
                        // Show appropriate action text based on tool type
                        statusRow.textContent = getToolActionText(toolName);
                    }
                    reasonDiv.appendChild(statusRow);
                }
                
                // Row 3: Original reasoning
                const reasoningRow = document.createElement('div');
                reasoningRow.className = 'tool-reasoning-row';
                reasoningRow.textContent = reason.trim();
                reasonDiv.appendChild(reasoningRow);
            } else {
                // Non-tool reasoning (standard format)
                const reasonSpan = document.createElement('span');
                reasonSpan.textContent = reason.trim();
                reasonDiv.appendChild(reasonSpan);
            }
            this.progressReasoningContainer.appendChild(reasonDiv);
            
            // Generate random position as percentages, avoiding center and existing text
            // Define zones: prefer edges and corners, avoid center (30-70% range)
            let randomXPercent, randomYPercent;
            let attempts = 0;
            const maxAttempts = 20;
            
            do {
                // Generate position favoring edges
                const favorEdge = Math.random() < 0.7; // 70% chance to favor edges
                
                if (favorEdge) {
                    // Choose a quadrant (top-left, top-right, bottom-left, bottom-right)
                    const quadrant = Math.floor(Math.random() * 4);
                    
                    switch(quadrant) {
                        case 0: // Top-left
                            randomXPercent = Math.random() * 25 + 5; // 5-30%
                            randomYPercent = Math.random() * 25 + 15; // 15-40%
                            break;
                        case 1: // Top-right
                            randomXPercent = Math.random() * 25 + 70; // 70-95%
                            randomYPercent = Math.random() * 25 + 15; // 15-40%
                            break;
                        case 2: // Bottom-left
                            randomXPercent = Math.random() * 25 + 5; // 5-30%
                            randomYPercent = Math.random() * 30 + 60; // 60-90%
                            break;
                        case 3: // Bottom-right
                            randomXPercent = Math.random() * 25 + 70; // 70-95%
                            randomYPercent = Math.random() * 30 + 60; // 60-90%
                            break;
                    }
                } else {
                    // Random position avoiding center
                    randomXPercent = Math.random() * 90 + 5; // 5-95%
                    randomYPercent = Math.random() * 75 + 15; // 15-90%
                    
                    // If in center zone, push to edges
                    if (randomXPercent > 30 && randomXPercent < 70) {
                        randomXPercent = randomXPercent < 50 ? Math.random() * 25 + 5 : Math.random() * 25 + 70;
                    }
                    if (randomYPercent > 35 && randomYPercent < 65) {
                        randomYPercent = randomYPercent < 50 ? Math.random() * 20 + 15 : Math.random() * 30 + 60;
                    }
                }
                
                attempts++;
            } while (this.checkSpellbookReasoningOverlap(randomXPercent, randomYPercent) && attempts < maxAttempts);
            
            // Store position for overlap checking
            if (!this.spellbookReasoningPositions) {
                this.spellbookReasoningPositions = [];
            }
            this.spellbookReasoningPositions.push({ x: randomXPercent, y: randomYPercent });
            
            // Switch between left/right and top/bottom based on 50% threshold
            if (randomXPercent > 50) {
                // Position from right edge
                reasonDiv.style.right = `${100 - randomXPercent}%`;
            } else {
                // Position from left edge
                reasonDiv.style.left = `${randomXPercent}%`;
            }
            
            if (randomYPercent > 50) {
                // Position from bottom edge
                reasonDiv.style.bottom = `${100 - randomYPercent}%`;
            } else {
                // Position from top edge
                reasonDiv.style.top = `${randomYPercent}%`;
            }
            
            // Trigger fade-in with slight delay
            setTimeout(() => {
                reasonDiv.classList.add('visible');
            }, 50);
        }
    }

    checkSpellbookReasoningOverlap(x, y, minDistance = 15) {
        if (!this.spellbookReasoningPositions) return false;
        
        for (const pos of this.spellbookReasoningPositions) {
            const distance = Math.sqrt(Math.pow(x - pos.x, 2) + Math.pow(y - pos.y, 2));
            if (distance < minDistance) {
                return true;
            }
        }
        return false;
    }

    updateSpellbookProgressContext(data) {
        if (!data) return;

        // Complete reset for new dynamic generation session
        this.resetSpellbookProgressOverlay();

        // Update time in both overlays
        const timeString = data.time ? new Date(`2000-01-01T${data.time}`).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }) : '--:--';

        if (this.overlayTimeDisplay) {
            this.overlayTimeDisplay.textContent = timeString;
        }
        if (this.progressTime) {
            this.progressTime.textContent = timeString;
        }

        // Update date in progress overlay
        if (this.progressDate && data.date) {
            let formattedDate;
            if (typeof data.date === 'object' && data.date.year !== undefined) {
                const date = new Date(data.date.year, data.date.month, data.date.day);
                formattedDate = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            } else {
                const date = new Date(data.date);
                formattedDate = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            }
            this.progressDate.textContent = formattedDate;
        }

        // Update season and holiday in progress overlay - handle both object and string formats (for backward compatibility with compiled prompts)
        if (this.progressSeason && data.season) {
            // Extract season name from object or use string directly
            const seasonName = typeof data.season === 'object' && data.season.name ? data.season.name : data.season;
            this.progressSeason.textContent = seasonName;
        }
        if (this.progressHoliday) {
            if (data.holiday?.primaryHoliday?.name) {
                this.progressHoliday.textContent = data.holiday.primaryHoliday.name;
                this.progressHoliday.style.display = 'inline';
            } else {
                this.progressHoliday.style.display = 'none';
            }
        }

        // Update weather using existing overlay weather functions
        if (data.weather) {
            const conditionText = data.weather.condition || 'Unknown';
            const locationText = this.getLocationText(data.location);

            // Update simple overlay
            if (this.overlayWeatherCondition) {
                this.overlayWeatherCondition.textContent = conditionText;
            }
            if (this.overlayWeatherLocation) {
                if (locationText) {
                    this.overlayWeatherLocation.classList.remove('hidden');
                    this.overlayWeatherLocation.textContent = locationText;
                } else {
                    this.overlayWeatherLocation.classList.add('hidden');
                }
            }
            if (this.overlayWeatherFeelsLike && data.weather.feelsLike !== undefined) {
                const tempData = this.formatTemperature(data.weather.feelsLike);
                const tempNumber = this.overlayWeatherFeelsLike.querySelector('.temp-number');
                const tempUnit = this.overlayWeatherFeelsLike.querySelector('.temp-unit');
                if (tempNumber) tempNumber.textContent = tempData.number;
                if (tempUnit) tempUnit.textContent = tempData.unit;
            }
            // Determine if it's night based on timePeriod
            const isNight = data.timePeriod?.isDaytime === false;
            
            if (this.overlayWeatherIcon && data.weather.condition) {
                const weatherIconHtml = this.getWeatherIcon(data.weather.condition, isNight);
                this.overlayWeatherIcon.innerHTML = weatherIconHtml;
            }

            // Update progress overlay
            if (this.progressWeatherCondition) {
                this.progressWeatherCondition.textContent = conditionText;
            }
            if (this.progressWeatherLocation) {
                if (locationText) {
                    this.progressWeatherLocation.classList.remove('hidden');
                    this.progressWeatherLocation.textContent = locationText;
                } else {
                    this.progressWeatherLocation.classList.add('hidden');
                }
            }
            if (this.progressWeatherFeelsLike && data.weather.feelsLike !== undefined) {
                const tempData = this.formatTemperature(data.weather.feelsLike);
                const tempNumber = this.progressWeatherFeelsLike.querySelector('.temp-number');
                const tempUnit = this.progressWeatherFeelsLike.querySelector('.temp-unit');
                if (tempNumber) tempNumber.textContent = tempData.number;
                if (tempUnit) tempUnit.textContent = tempData.unit;
            }
            if (this.progressWeatherIcon && data.weather.condition) {
                const weatherIconHtml = this.getWeatherIcon(data.weather.condition, isNight);
                this.progressWeatherIcon.innerHTML = weatherIconHtml;
            }
        }

        // Progress overlay already shows weather/time — keep the simple overlay hidden
        this.hideSpellbookDynamicGenerationOverlay();
    }

    getLocationText(location) {
        if (!location) return null;
        if (location.city && location.country) {
            return `${location.city}, ${location.country}`;
        } else if (location.city) {
            return location.city;
        } else if (location.country) {
            return location.country;
        }
        return null;
    }

    resetSpellbookProgressOverlay() {
        this.spellbookProgressOverlayCompleting = false;

        // Reset simple overlay time
        if (this.overlayTimeDisplay) {
            this.overlayTimeDisplay.textContent = '--:--';
        }

        // Reset simple overlay weather
        if (this.overlayWeatherFeelsLike) {
            const tempNumber = this.overlayWeatherFeelsLike.querySelector('.temp-number');
            if (tempNumber) tempNumber.textContent = '--';
        }
        if (this.overlayWeatherCondition) {
            this.overlayWeatherCondition.textContent = 'Unknown';
        }
        if (this.overlayWeatherLocation) {
            this.overlayWeatherLocation.classList.add('hidden');
            this.overlayWeatherLocation.textContent = 'Unknown';
        }
        if (this.overlayWeatherIcon) {
            this.overlayWeatherIcon.innerHTML = '<span class="weather-fallback-icon">🌤️</span>';
        }

        // Reset progress overlay
        if (this.progressTime) {
            this.progressTime.textContent = '--:--';
        }
        if (this.progressDate) {
            this.progressDate.textContent = '--/--';
        }
        if (this.progressSeason) {
            this.progressSeason.textContent = 'Season';
        }
        if (this.progressHoliday) {
            this.progressHoliday.style.display = 'none';
            this.progressHoliday.textContent = '';
        }
        if (this.progressStatusText) {
            this.progressStatusText.textContent = 'Processing...';
        }

        // Reset progress overlay weather
        if (this.progressWeatherFeelsLike) {
            const tempNumber = this.progressWeatherFeelsLike.querySelector('.temp-number');
            if (tempNumber) tempNumber.textContent = '--';
        }
        if (this.progressWeatherCondition) {
            this.progressWeatherCondition.textContent = 'Unknown';
        }
        if (this.progressWeatherLocation) {
            this.progressWeatherLocation.classList.add('hidden');
            this.progressWeatherLocation.textContent = 'Unknown';
        }
        if (this.progressWeatherIcon) {
            this.progressWeatherIcon.innerHTML = '<span class="weather-fallback-icon">🌤️</span>';
        }

        // Clear reasoning container
        if (this.progressReasoningContainer) {
            this.progressReasoningContainer.innerHTML = '';
        }
        
        // Clear stored positions for new session
        if (this.spellbookReasoningPositions) {
            this.spellbookReasoningPositions = [];
        }

        // Remove fade-out classes
        const timeSection = document.querySelector('#spellbookDynamicGenerationProgressOverlay .progress-time-section');
        const weatherSection = document.querySelector('#spellbookDynamicGenerationProgressOverlay .progress-weather-section');
        if (timeSection) timeSection.classList.remove('fade-out');
        if (weatherSection) weatherSection.classList.remove('fade-out');

        this.hideSpellbookDynamicGenerationOverlay();

        if (this.progressStatusText) {
            this.progressStatusText.textContent = 'Processing...';
        }
    }

    getWeatherIcon(condition, isNight = false) {
        if (!condition) return isNight ? '<i class="wi wi-night-clear"></i>' : '<i class="wi wi-day-sunny"></i>';

        const timePrefix = isNight ? 'night-alt' : 'day';
        
        // Icons that don't change between day/night (no sun/moon influence)
        const timeNeutralIcons = {
            'overcast': 'cloudy',
            'fog': 'fog',
            'depositing rime fog': 'fog',
            'moderate snow fall': 'snow',
            'heavy snow fall': 'snow',
            'snow grains': 'snow',
            'heavy snow showers': 'snow'
        };

        // Check if this condition uses a time-neutral icon
        if (timeNeutralIcons[condition]) {
            return `<i class="wi wi-${timeNeutralIcons[condition]}"></i>`;
        }

        // Time-dependent icons (different for day/night)
        const iconMap = {
            'clear sky': isNight ? 'night-clear' : 'day-sunny',
            'mainly clear': isNight ? 'night-alt-partly-cloudy' : 'day-sunny-overcast',
            'partly cloudy': `${timePrefix}-cloudy`,
            'light drizzle': `${timePrefix}-showers`,
            'moderate drizzle': `${timePrefix}-showers`,
            'dense drizzle': `${timePrefix}-showers`,
            'light freezing drizzle': `${timePrefix}-snow`,
            'dense freezing drizzle': `${timePrefix}-snow`,
            'slight rain': `${timePrefix}-rain`,
            'moderate rain': `${timePrefix}-rain`,
            'heavy rain': `${timePrefix}-rain`,
            'light freezing rain': `${timePrefix}-snow`,
            'heavy freezing rain': `${timePrefix}-snow`,
            'slight snow fall': `${timePrefix}-snow`,
            'slight rain showers': `${timePrefix}-showers`,
            'moderate rain showers': `${timePrefix}-rain`,
            'violent rain showers': `${timePrefix}-storm-showers`,
            'slight snow showers': `${timePrefix}-snow`,
            'thunderstorm': `${timePrefix}-thunderstorm`,
            'thunderstorm with slight hail': `${timePrefix}-thunderstorm`,
            'thunderstorm with heavy hail': `${timePrefix}-thunderstorm`
        };

        const iconClass = iconMap[condition] || (isNight ? 'night-clear' : 'day-sunny');
        return `<i class="wi wi-${iconClass}"></i>`;
    }

    // Utility functions
    formatTemperature(temp) {
        const useFahrenheit = localStorage.getItem('useFahrenheit') === 'true';
        if (useFahrenheit) {
            return {
                number: Math.round((temp * 9/5) + 32),
                unit: '°F'
            };
        }
        return {
            number: Math.round(temp),
            unit: '°C'
        };
    }

    handleGoToWorkspace() {
        if (!this.generatedWorkspace) return;

        // Switch to the workspace where the image was generated
        if (typeof setActiveWorkspace === 'function') {
            setActiveWorkspace(this.generatedWorkspace);
        } else {
            console.warn('setActiveWorkspace function not available');
        }

        // Close the modal
        this.closeModal();
    }
}

function getSpellbookStepPreviewDimensions() {
    const container = document.querySelector('.spellbook-preview-image-container');
    if (!container) return null;
    const rect = container.getBoundingClientRect();
    const width = Math.round(rect.width || container.clientWidth || 0);
    const height = Math.round(rect.height || container.clientHeight || 0);
    if (width <= 0 || height <= 0) return null;
    return { width, height };
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.spellbookModalManager = new SpellbookModalManager();
});
