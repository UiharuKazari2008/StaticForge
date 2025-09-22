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
        this.blockContainer = null;
        this.isGenerating = false;

        this.selectedPreset = '';
        this.confettiContainer = null;
        this.generatedWorkspace = null;
        this.generatedFilename = null;

        this.init();
    }

    init() {
        this.cacheElements();
        this.setupEventListeners();
        this.initializeBlockContainer();
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

        // Button elements
        this.downloadBtn = document.getElementById('spellbookDownloadBtn');
        this.copyBtn = document.getElementById('spellbookCopyBtn');
        this.upscaleBtn = document.getElementById('spellbookUpscaleBtn');
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

        // Go to workspace button
        if (this.goToWorkspaceBtn) {
            this.goToWorkspaceBtn.addEventListener('click', () => this.handleGoToWorkspace());
        }

        // Escape key to close modal
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.modal && !this.modal.classList.contains('hidden')) {
                this.closeModal();
            }
        });
    }

    handleImageClick() {
        if (!this.previewImage || this.previewImage.classList.contains('hidden')) return;

        if (this.previewImage.src && this.previewImage.src !== '' && window.showLightbox) {
            // Use URL-based approach to avoid workspace dependency issues
            window.showLightbox({
                url: this.previewImage.src,
                width: this.previewImage.naturalWidth || 1024,
                height: this.previewImage.naturalHeight || 1024
            });
        }
    }

    initializeBlockContainer() {
        if (!document.getElementById('spellbookBlockContainer')) return;

        this.blockContainer = new BlockContainer('#spellbookBlockContainer', {
            row: 15,
            col: 15,
            opacityRange: [0.03, 0.2],
            waveDelay: 40,
            randomAdjustInterval: 2500,
            batchSize: 40,
            useRequestAnimationFrame: true
        });

        this.blockContainer.init('ready');
    }

    openModal() {
        if (!this.modal) return;

        openModal(this.modal);

        // Ensure editor button is disabled if no preset is selected
        if (this.editorBtn) {
            this.editorBtn.disabled = !this.selectedPreset;
        }

        // Ensure upscale button is disabled if no image is generated
        if (this.upscaleBtn) {
            this.upscaleBtn.disabled = !this.generatedFilename;
        }


        // Setup dropdown if not already done
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

    closeModal() {
        if (!this.modal) return;

        closeModal(this.modal);

        // Stop any ongoing animations
        if (this.blockContainer) {
            this.blockContainer.stop();
        }
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
                        icon.className = 'nai-image-tool-line-art';
                        icon.title = `Character Reference`;
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
                    let resolutionDisplay = (preset.resolution.toLowerCase() || 'normal_portrait?').split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1));

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
            this.customPresetSelected.innerHTML = `<i class="fa-light fa-sparkle"></i> ${presetName}`;
        }

        if (this.clearPresetBtn) {
            this.clearPresetBtn.classList.remove('hidden');
        }

        if (this.generateBtn) {
            this.generateBtn.disabled = false;
        }

        if (this.editorBtn) {
            this.editorBtn.disabled = false;
        }

        // Update the hidden input for compatibility - use the correct preset format
        const hiddenInput = document.getElementById('presetSelect');
        if (hiddenInput) {
            hiddenInput.value = `preset:${presetName}`;
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
        this.generateBtn.disabled = true;
        this.generateBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

        let toastId;
        let progressInterval;

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
                        return;
                    }
                    // Set allow_paid flag for this request
                    allowPaid = true;
                }
            }

            // Ensure block container is initialized and ready
            if (!this.blockContainer) {
                this.initializeBlockContainer();
            }

            // Start block animation
            if (this.blockContainer) {
                // Start the wave animation using the same method as manual modal
                try {
                    this.blockContainer.ensureWaveReady();
                    await this.blockContainer.createOpacityWave('rand');
                } catch (error) {
                    console.warn('Failed to start block container wave:', error);
                }
                // Hide preview image and show block animation
                if (this.previewImage) {
                    this.previewImage.classList.add('hidden');
                }
            }

            // Show progress toast
            toastId = showGlassToast('info', 'Generating Image', 'Generating image...', true, false, '<i class="nai-sparkles"></i>');

            // Start progress animation (1% per second)
            let progress = 0;
            progressInterval = setInterval(() => {
                progress += 1;
                updateGlassToastProgress(toastId, progress);
            }, 1000);

            // Generate image using WebSocket
            const result = await window.wsClient.generatePreset(this.selectedPreset, allowPaid);

            // Extract data from the response
            const filename = result.filename;
            const workspace = result.workspace;

            // Stop progress animation
            if (progressInterval) {
                clearInterval(progressInterval);
                progressInterval = null;
            }

            // Update toast to show success
            updateGlassToastComplete(toastId, {
                type: 'success',
                title: 'Image Generated',
                message: 'Image generated successfully!',
                customIcon: '<i class="nai-check"></i>',
                showProgress: false
            });

            // Create confetti effect
            console.log('About to create spellbook confetti');
            this.createSpellbookConfetti();

            // Display the generated image in the modal
            if (filename && this.previewImage) {
                // Construct image URL
                const imageUrl = `/images/${filename}`;
                this.previewImage.src = imageUrl;
                this.previewImage.classList.remove('hidden');

                // Store generated image info
                this.generatedFilename = filename;
                this.generatedWorkspace = workspace;

                // Enable upscale button now that we have an image
                if (this.upscaleBtn) {
                    this.upscaleBtn.disabled = false;
                }

                // Update blur background
                this.updateSpellbookBlurredBackground(imageUrl);
            }
            // Reset generating state
            this.isGenerating = false;
            this.generateBtn.disabled = false;
            this.generateBtn.innerHTML = '<i class="nai-sparkles"></i>';
            // Stop the animation (same as manual modal)
            if (this.blockContainer) {
                try {
                    await this.blockContainer.returnToNormalOpacity(true);
                    // Add 1.5 second delay before unloading the block container
                    await new Promise(resolve => setTimeout(resolve, 1500));
                    // Unload the container to free up resources
                    await this.blockContainer.unload();
                    this.blockContainer = null;
                } catch (error) {
                    console.warn('Failed to stop block container wave:', error);
                }
            }
            
            await loadGallery(true);

        } catch (error) {
            console.error('Generation error:', error);

            // Stop progress animation
            if (progressInterval) {
                clearInterval(progressInterval);
                progressInterval = null;
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
            this.generateBtn.disabled = false;
            this.generateBtn.innerHTML = '<i class="nai-sparkles"></i>';

            // Stop the animation on error (same cleanup as success)
            if (this.blockContainer) {
                try {
                    await this.blockContainer.returnToNormalOpacity(true);
                    // Add 1.5 second delay before unloading the block container
                    await new Promise(resolve => setTimeout(resolve, 1500));
                    // Unload the container to free up resources
                    await this.blockContainer.unload();
                    this.blockContainer = null;
                } catch (error) {
                    console.warn('Failed to stop block container wave on error:', error);
                }
            }
        }
    }

    handleEditor() {
        // Check if a preset is selected
        if (!this.selectedPreset) {
            console.warn('No preset selected for editor');
            return;
        }

        // Open the generation editor modal
        const genEditorBtn = document.getElementById('openGenEditorBtn');
        if (genEditorBtn) {
            genEditorBtn.click();
        }
        this.closeModal();
    }

    async updateSpellbookBlurredBackground(imageUrl) {
        try {
            // Extract filename from imageUrl
            const filename = imageUrl.split('/').pop();
            const baseName = filename
                .replace(/\.(png|jpg|jpeg)$/i, '')
                .replace(/_upscaled$/, '');

            // Get the blurred preview URL
            const blurPreviewUrl = `/previews/${encodeURIComponent(baseName)}@blur.webp`;

            // Check if the blurred preview exists
            try {
                const response = await fetch(blurPreviewUrl, { method: 'HEAD' });
                if (!response.ok) {
                    // Blurred preview doesn't exist, hide backgrounds
                    if (this.blurBackground1) this.blurBackground1.style.opacity = '0';
                    if (this.blurBackground2) this.blurBackground2.style.opacity = '0';
                    return;
                }
            } catch (error) {
                // Blurred preview doesn't exist, hide backgrounds
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
                inactiveBg.style.backgroundImage = `url(${blurPreviewUrl})`;
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
        link.href = `/images/${this.generatedFilename}`;
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

            // Copy to clipboard
            await navigator.clipboard.write([
                new ClipboardItem({ 'image/png': blob })
            ]);

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
            this.upscaleBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        }

        let toastId;
        let progressInterval;

        try {
            // Check if WebSocket is connected
            if (!window.wsClient || !window.wsClient.isConnected()) {
                throw new Error('WebSocket not connected. Please check your connection.');
            }

            // Check for credit costs and show confirmation dialog for upscaling
            const upscaleCost = 7; // Upscaling always costs 7 credits
            const confirmed = await showCreditCostDialog(upscaleCost);
            if (!confirmed) {
                // Reset button state
                this.upscaleBtn.disabled = false;
                this.upscaleBtn.innerHTML = '<i class="nai-upscale"></i>';
                return;
            }

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
                workspace: this.generatedWorkspace || null
            };

            // Upscale image via WebSocket
            const result = await window.wsClient.upscaleImage(upscaleParams);

            if (result) {
                const { image: upscaledImage, filename: upscaledFilename } = result;

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

                // Convert base64 to blob
                const byteCharacters = atob(upscaledImage);
                const byteNumbers = new Array(byteCharacters.length);
                for (let i = 0; i < byteCharacters.length; i++) {
                    byteNumbers[i] = byteCharacters.charCodeAt(i);
                }
                const byteArray = new Uint8Array(byteNumbers);
                const blob = new Blob([byteArray], { type: 'image/png' });

                // Create object URL for the upscaled image
                const upscaledImageUrl = URL.createObjectURL(blob);

                // Update the preview image to show the upscaled version
                if (this.previewImage) {
                    this.previewImage.src = upscaledImageUrl;
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

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.spellbookModalManager = new SpellbookModalManager();
});
