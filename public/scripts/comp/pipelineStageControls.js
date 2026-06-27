/**
 * Pipeline stage toolbar, drag-and-drop, and per-stage event wiring.
 * Phase 1 extract from public/scripts/app.js — see docs/appjs-refactor-removal-manifest.md
 *
 * Dependencies: app.js pipeline helpers, manualModalManager.js (pipelineStagesContainer, toggles), dropdown.js
 */

const _pipelineStageWireControllers = new Map();
let _pipelineDragDocumentController = null;

function buildPipelineStageToolbar(stageId) {
    // Stage controls
    const stageControls = document.createElement('div');
    stageControls.className = 'stage-controls';

    // Delete button
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn-danger btn-small';
    deleteBtn.title = 'Delete stage';
    deleteBtn.innerHTML = '<i class="fas fa-trash-alt"></i>';
    deleteBtn.addEventListener('click', () => deletePipelineStage(stageId));

    // Advanced toggle and reset buttons (for all stage types)
    const resetAdvancedBtn = document.createElement('button');
    resetAdvancedBtn.type = 'button';
    resetAdvancedBtn.id = `${stageId}_resetAdvanced`;
    resetAdvancedBtn.className = 'btn-secondary btn-small hidden';
    resetAdvancedBtn.title = 'Reset to Inherited Values';
    resetAdvancedBtn.innerHTML = '<i class="nai-dot-reset"></i>';
    stageControls.appendChild(resetAdvancedBtn);

    const advancedToggleBtn = document.createElement('button');
    advancedToggleBtn.type = 'button';
    advancedToggleBtn.id = `${stageId}_advancedToggle`;
    advancedToggleBtn.className = 'btn-secondary btn-small';
    advancedToggleBtn.title = 'Toggle Advanced Controls';
    advancedToggleBtn.innerHTML = '<i class="fas fa-wrench"></i>';
    advancedToggleBtn.addEventListener('click', () => {
        const advancedControls = document.getElementById(`${stageId}_advancedControls`);
        if (advancedControls) {
            const isHidden = advancedControls.classList.contains('hidden');
            advancedControls.classList.toggle('hidden');
            advancedToggleBtn.classList.toggle('active', !isHidden);

            // Update creative directive visibility when advanced toggles
            updateStageCreativeDirectiveVisibility(stageId);
        }
    });

    // Upscale toggle button
    const upscaleBtn = document.createElement('button');
    upscaleBtn.type = 'button';
    upscaleBtn.id = `${stageId}_upscaleToggle`;
    upscaleBtn.className = 'btn-secondary btn-small toggle-btn';
    upscaleBtn.dataset.state = 'off';
    upscaleBtn.title = 'Enable upscaling';
    upscaleBtn.innerHTML = '<i class="nai-upscale"></i>';
    upscaleBtn.addEventListener('click', () => {
        const newState = upscaleBtn.dataset.state === 'on' ? 'off' : 'on';
        upscaleBtn.dataset.state = newState;

        // Get save results button
        const saveResultsBtn = document.getElementById(`${stageId}_saveResultsToggle`);
        if (!saveResultsBtn) return;

        if (newState === 'on') {
            // Upscale turned ON → always turn on save
            saveResultsBtn.dataset.state = 'on';
        } else {
            // Upscale turned OFF → turn off save if this is the last stage
            const allStages = Array.from(pipelineStagesContainer?.querySelectorAll('.pipeline-stage-item') || []);
            const stageItem = document.getElementById(stageId);
            const stageIndex = allStages.indexOf(stageItem);
            const isLastStage = stageIndex === allStages.length - 1;

            if (isLastStage) {
                saveResultsBtn.dataset.state = 'off';
            }
        }
    });

    // Inset toggle lives in expand-canvas stage body (renderExpandCanvasStage), not header controls.

    // Save results toggle button
    const saveResultsBtn = document.createElement('button');
    saveResultsBtn.type = 'button';
    saveResultsBtn.id = `${stageId}_saveResultsToggle`;
    saveResultsBtn.className = 'btn-secondary btn-small toggle-btn save_toggle';
    saveResultsBtn.dataset.state = 'off';
    saveResultsBtn.title = 'Save Results';
    saveResultsBtn.innerHTML = '<i class="fas fa-folder-download"></i>';
    saveResultsBtn.addEventListener('click', () => {
        if (saveResultsBtn.dataset.managedLock === 'true') return;
        const newState = saveResultsBtn.dataset.state === 'on' ? 'off' : 'on';
        saveResultsBtn.dataset.state = newState;

        // Update button states to properly handle upscale visibility based on resolution
        updateStageButtonStates();
    });

    // Branch toggle button
    const branchBtn = document.createElement('button');
    branchBtn.type = 'button';
    branchBtn.id = `${stageId}_branchToggle`;
    branchBtn.className = 'btn-secondary btn-small toggle-btn';
    branchBtn.dataset.state = 'off';
    branchBtn.title = 'Branch stage (independent from main pipeline)';
    branchBtn.innerHTML = '<i class="fas fa-alt"></i>';
    branchBtn.addEventListener('click', () => {
        if (handleManagedStageBranchToggle(stageId)) {
            return;
        }

        const stageItem = document.getElementById(stageId);
        if (stageItem?.dataset.forcedBranch === 'true') {
            return;
        }

        const newState = branchBtn.dataset.state === 'on' ? 'off' : 'on';
        branchBtn.dataset.state = newState;

        // Update visual indicator - add/remove branch class
        if (stageItem) {
            if (newState === 'on') {
                stageItem.classList.add('stage-branch');
            } else {
                stageItem.classList.remove('stage-branch');
            }
        }

        // Update inheritance display for all subsequent stages
        const allStages = Array.from(pipelineStagesContainer?.querySelectorAll('.pipeline-stage-item') || []);
        const currentStageIndex = allStages.findIndex(s => s.id === stageId);

        // Update current stage and all stages after it
        for (let i = currentStageIndex; i < allStages.length; i++) {
            updateStageInheritedDisplay(allStages[i].id);
        }

        // Update all stage hex IDs since branching affects the IDs
        updateAllStageHexIds();
    });

    // Stop toggle button
    const stopBtn = document.createElement('button');
    stopBtn.type = 'button';
    stopBtn.id = `${stageId}_stopToggle`;
    stopBtn.className = 'btn-secondary btn-small toggle-btn';
    stopBtn.dataset.state = 'off';
    stopBtn.title = 'Stop at this stage';
    stopBtn.innerHTML = '<i class="fas fa-scalpel-line-dashed"></i>';
    stopBtn.addEventListener('click', () => {
        const newState = stopBtn.dataset.state === 'on' ? 'off' : 'on';
        stopBtn.dataset.state = newState;

        // If turning on, turn off all other stop toggles
        if (newState === 'on') {
            const allStages = Array.from(pipelineStagesContainer?.querySelectorAll('.pipeline-stage-item') || []);
            allStages.forEach(stage => {
                if (stage.id !== stageId) {
                    const otherStopBtn = document.getElementById(`${stage.id}_stopToggle`);
                    if (otherStopBtn) {
                        otherStopBtn.dataset.state = 'off';
                    }
                }
            });
        }
    });

    // Lock prompt toggle button
    const lockPromptBtn = document.createElement('button');
    lockPromptBtn.type = 'button';
    lockPromptBtn.id = `${stageId}_lockPromptToggle`;
    lockPromptBtn.className = 'btn-secondary btn-small toggle-btn';
    lockPromptBtn.dataset.state = 'off';
    lockPromptBtn.title = 'Lock Prompt (skip Rentan, apply Expanders only)';
    lockPromptBtn.innerHTML = '<i class="fas fa-lock"></i>';
    lockPromptBtn.addEventListener('click', () => {
        const newState = lockPromptBtn.dataset.state === 'on' ? 'off' : 'on';
        lockPromptBtn.dataset.state = newState;
    });

    stageControls.appendChild(upscaleBtn);
    stageControls.appendChild(saveResultsBtn);
    stageControls.appendChild(lockPromptBtn);
    stageControls.appendChild(advancedToggleBtn);
    stageControls.appendChild(branchBtn);
    stageControls.appendChild(stopBtn);
    stageControls.appendChild(deleteBtn);
    return stageControls;
}

function initializePipelineStageDragAndDrop() {
    const list = pipelineStagesContainer;
    if (!list) {
        return;
    }

    let draggedItem = null;
    let draggedIndex = null;

    // Add event listeners to drag handles
    const dragHandles = list.querySelectorAll('.workspace-drag-handle');

    dragHandles.forEach((handle, index) => {
        handle.addEventListener('mousedown', startDrag);
        handle.addEventListener('touchstart', startDrag, { passive: false });
        handle.addEventListener('touchmove', onDrag, { passive: false });
        handle.addEventListener('touchend', endDrag);
    });

    function startDrag(e) {
        e.preventDefault();
        e.stopPropagation();

        const item = e.target.closest('.pipeline-stage-item');
        if (!item) {
            return;
        }

        if (item.dataset.managed === 'true') {
            return;
        }

        draggedItem = item;
        draggedIndex = Array.from(list.children).indexOf(item);

        // Add dragging class
        draggedItem.classList.add('dragging');

        // Per-drag document listeners — AbortController aligned with modalListenerScope.js
        if (_pipelineDragDocumentController) {
            _pipelineDragDocumentController.abort();
        }
        _pipelineDragDocumentController = new AbortController();
        const dragSignal = _pipelineDragDocumentController.signal;
        document.addEventListener('mousemove', onDrag, { signal: dragSignal });
        document.addEventListener('mouseup', endDrag, { signal: dragSignal });

        // Prevent text selection during drag
        document.body.style.userSelect = 'none';
    }

    function onDrag(e) {
        if (!draggedItem) {
            return;
        }

        e.preventDefault();

        // Handle both mouse and touch events
        let clientY;
        if (e.type === 'mousemove') {
            clientY = e.clientY;
        } else if (e.type === 'touchmove' && e.touches.length > 0) {
            clientY = e.touches[0].clientY;
        } else {
            return; // No valid input
        }

        const rect = list.getBoundingClientRect();
        const mouseY = clientY - rect.top;

        // Find the item under the mouse and determine if we're in top or bottom half
        const items = Array.from(list.children);
        let targetIndex = null;
        let insertAfter = false;

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item === draggedItem) continue;

            const itemRect = item.getBoundingClientRect();
            const itemTop = itemRect.top - rect.top;
            const itemBottom = itemTop + itemRect.height;
            const itemMiddle = itemTop + (itemRect.height / 2);

            if (mouseY >= itemTop && mouseY <= itemBottom) {
                targetIndex = i;
                insertAfter = mouseY > itemMiddle;
                break;
            }
        }

        // If no item found, check if we're below all items
        if (targetIndex === null && items.length > 0) {
            const lastItem = items[items.length - 1];
            const lastItemRect = lastItem.getBoundingClientRect();
            const lastItemBottom = lastItemRect.top - rect.top + lastItemRect.height;

            if (mouseY > lastItemBottom) {
                targetIndex = items.length - 1;
                insertAfter = true;
            }
        }

        // Move the dragged item to new position
        if (targetIndex !== null) {
            const currentIndex = Array.from(list.children).indexOf(draggedItem);
            let finalTargetIndex = targetIndex;

            // Adjust target index if we're moving down and should insert after
            if (insertAfter) {
                finalTargetIndex = targetIndex + 1;
            }

            // Only move if the position actually changes
            if (finalTargetIndex !== currentIndex) {
                // Remove drag-over class from all items
                items.forEach(item => item.classList.remove('drag-over'));

                // Actually move the item in the DOM
                const targetItem = items[targetIndex];
                if (insertAfter && targetItem) {
                    // Insert after the target item
                    if (targetItem.nextSibling) {
                        list.insertBefore(draggedItem, targetItem.nextSibling);
                    } else {
                        list.appendChild(draggedItem);
                    }
                } else if (targetItem) {
                    // Insert before the target item
                    list.insertBefore(draggedItem, targetItem);
                } else {
                    // Append to end if no target
                    list.appendChild(draggedItem);
                }

                // Add drag-over class to new position
                draggedItem.classList.add('drag-over');

                // Update draggedIndex
                draggedIndex = Array.from(list.children).indexOf(draggedItem);
            }
        }
    }

    function endDrag(e) {
        if (!draggedItem) {
            return;
        }

        e.preventDefault();

        if (_pipelineDragDocumentController) {
            _pipelineDragDocumentController.abort();
            _pipelineDragDocumentController = null;
        }

        draggedItem.classList.remove('dragging');
        const items = Array.from(list.children);
        items.forEach(item => item.classList.remove('drag-over'));

        // Restore text selection
        document.body.style.userSelect = '';

        // Update all stages after reordering
        updatePipelineStages();

        // Update all stage hex IDs
        updateAllStageHexIds();

        enforceManagedStageSandwichRules();

        draggedItem = null;
        draggedIndex = null;
    }
}

function setupExpandCanvasStageEvents(stageId) {
    const inheritSeedToggle = document.getElementById(`${stageId}_inheritSeedToggle`);
    const autoSeedToggle = document.getElementById(`${stageId}_autoSeedToggle`);
    const seedInput = document.getElementById(`${stageId}_seed`);

    // Inherit seed toggle
    if (inheritSeedToggle && seedInput && autoSeedToggle) {
        inheritSeedToggle.addEventListener('click', () => {
            const currentState = inheritSeedToggle.dataset.state;
            const newState = currentState === 'on' ? 'off' : 'on';
            inheritSeedToggle.dataset.state = newState;

            if (newState === 'on') {
                // Inherit mode: hide auto seed toggle
                autoSeedToggle.classList.add('hidden');
            } else {
                // Manual mode: show auto seed toggle if we have a loaded seed
                if (seedInput.dataset.loadedSeed) {
                    autoSeedToggle.classList.remove('hidden');
                }
            }

            // Use consolidated function to update seed display
            updateStageSeedDisplay(stageId);
        });
    }

    // Auto seed toggle (match manual modal pattern)
    if (autoSeedToggle && seedInput) {
        autoSeedToggle.addEventListener('click', () => {
            const currentState = autoSeedToggle.dataset.state;
            const newState = currentState === 'on' ? 'off' : 'on';
            autoSeedToggle.dataset.state = newState;

            // Use consolidated function to update seed display
            updateStageSeedDisplay(stageId);
        });
    }

    // Setup resolution dropdown
    const resolutionDropdown = document.getElementById(`${stageId}_resolutionDropdown`);
    const resolutionBtn = document.getElementById(`${stageId}_resolutionDropdownBtn`);
    const resolutionMenu = document.getElementById(`${stageId}_resolutionDropdownMenu`);
    const resolutionInput = document.getElementById(`${stageId}_resolution`);
    if (resolutionDropdown && resolutionBtn && resolutionMenu && resolutionInput) {
        setupDropdown(
            resolutionDropdown,
            resolutionBtn,
            resolutionMenu,
            (selectedValue) => renderStageResolutionDropdown(stageId, selectedValue),
            () => resolutionInput.value || '',
            { preventFocusTransfer: true }
        );

        // Add scroll wheel support for resolution cycling (skip custom)
        resolutionBtn.addEventListener('wheel', (e) => {
            e.preventDefault();

            const useBaseWheel = document.getElementById(`${stageId}_useBaseImageToggle`);
            const isVariationWheel = useBaseWheel && useBaseWheel.dataset.state === 'off';
            const { width: baseWidth, height: baseHeight } = getExpandCanvasStageBasePixelDimensions(stageId);
            const baseResolutionValue = getStageBaseResolution(stageId);
            const currentResolution = RESOLUTIONS.find(r => r.value === baseResolutionValue);

            // Build filtered list of resolutions (match dropdown: variation shows all; else hide small + exact same size)
            const availableResolutions = [];
            RESOLUTION_GROUPS.forEach(group => {
                group.options.forEach(opt => {
                    if (opt.value === 'custom') return;
                    if (!isVariationWheel && opt.value.startsWith('small_')) return;
                    if (!isVariationWheel && samePixelAspectRatio(baseWidth, baseHeight, opt.width, opt.height)) return;
                    availableResolutions.push({ value: opt.value, name: opt.name, group: group.group });
                });
            });

            if (availableResolutions.length === 0) return;

            // Find current index - use inherited value if input is empty
            let currentValue = resolutionInput.value;
            if (!currentValue) {
                const inheritedValues = getStageInheritedValues(stageId);
                if (inheritedValues.resolution) {
                    // Construct full preset with orientation for expand canvas
                    if (currentResolution) {
                        let orientation = 'square';
                        if (currentResolution.height > currentResolution.width * 1.05) orientation = 'portrait';
                        else if (currentResolution.width > currentResolution.height * 1.05) orientation = 'landscape';
                        currentValue = `${inheritedValues.resolution}_${orientation}`;
                    } else {
                        currentValue = inheritedValues.resolution + '_square'; // Default fallback
                    }
                }
            }
            const currentIndex = availableResolutions.findIndex(r => r.value === currentValue);

            // Calculate new index
            const delta = e.deltaY > 0 ? 1 : -1;
            let newIndex = currentIndex + delta;

            // Wrap around
            if (newIndex < 0) newIndex = availableResolutions.length - 1;
            if (newIndex >= availableResolutions.length) newIndex = 0;

            // Select new resolution
            const newResolution = availableResolutions[newIndex];

            // Update the input value
            resolutionInput.value = newResolution.value;

            // Update button display
            const resolutionSelected = document.getElementById(`${stageId}_resolutionSelected`);
            if (resolutionSelected) {
                const groupObj = RESOLUTION_GROUPS.find(g => g.group === newResolution.group);
                const badge = groupObj && groupObj.badge ? `<span class="custom-dropdown-badge${groupObj.free ? ' free-badge' : ''}">${groupObj.badge}</span>` : '';
                resolutionSelected.innerHTML = `<span class="custom-dropdown-text">${newResolution.name}</span>${badge}`;
            }

            // Update bias orientation and cascade downstream
            updateStageBiasOrientation(stageId, newResolution.value);
            updateDownstreamStageResolutions(stageId);
            updateExpandCanvasStageInsetToggle(stageId);
        });
    }

    // Setup custom resolution controls (shared function)
    setupStageCustomResolutionControls(stageId, resolutionDropdown, resolutionInput);

    // Setup bias dropdown
    const biasDropdown = document.getElementById(`${stageId}_biasDropdown`);
    const biasBtn = document.getElementById(`${stageId}_biasDropdownBtn`);
    const biasMenu = document.getElementById(`${stageId}_biasDropdownMenu`);
    const biasInput = document.getElementById(`${stageId}_bias`);
    if (biasDropdown && biasBtn && biasMenu && biasInput) {
        setupDropdown(
            biasDropdown,
            biasBtn,
            biasMenu,
            (selectedValue) => renderStageBiasDropdown(stageId, selectedValue),
            () => biasInput.value !== '' ? biasInput.value : '2',
            { preventFocusTransfer: true }
        );

        // Add scroll wheel support for bias/position cycling
        biasBtn.addEventListener('wheel', (e) => {
            e.preventDefault();

            // Bias has 5 positions: 0, 1, 2, 3, 4
            const currentValue = biasInput.value !== '' ? parseInt(biasInput.value) : 2;
            const delta = e.deltaY > 0 ? 1 : -1;
            let newValue = currentValue + delta;

            // Wrap around
            if (newValue < 0) newValue = 4;
            if (newValue > 4) newValue = 0;

            // Get current resolution to determine orientation
            const resolutionInput = document.getElementById(`${stageId}_resolution`);
            const resolution = resolutionInput ? RESOLUTIONS.find(r => r.value === resolutionInput.value) : null;
            const isPortrait = resolution ? resolution.height > resolution.width : false;

            // Get bias name for the new value
            const biasName = getBiasName(newValue.toString(), isPortrait);

            // Select new bias with all required parameters
            selectStageBias(stageId, newValue.toString(), biasName, isPortrait);
        });
    }

    // Setup advanced controls (shared function)
    setupStageAdvancedControls(stageId);

    const insetToggle = document.getElementById(`${stageId}_insetToggle`);
    if (insetToggle) {
        insetToggle.addEventListener('click', () => {
            insetToggle.dataset.state = insetToggle.dataset.state === 'on' ? 'off' : 'on';
        });
    }

    updateExpandCanvasStageInsetToggle(stageId);
}

function setupStageCustomResolutionControls(stageId, resolutionDropdown, resolutionInput) {
    // Setup area toggle for custom resolution
    const areaToggle = document.getElementById(`${stageId}_resolutionAreaToggle`);
    if (areaToggle) {
        areaToggle.addEventListener('click', (e) => {
            e.preventDefault();
            toggleStageResolutionAreaLimit(stageId);
        });
    }

    // Setup custom resolution controls
    const customResolutionBtn = document.getElementById(`${stageId}_customResolutionBtn`);
    const customResolution = document.getElementById(`${stageId}_customResolution`);
    const widthInput = document.getElementById(`${stageId}_width`);
    const heightInput = document.getElementById(`${stageId}_height`);

    if (!customResolutionBtn || !customResolution || !widthInput || !heightInput) return;

    // Custom resolution button toggle
    customResolutionBtn.addEventListener('click', () => {
        const currentState = customResolutionBtn.dataset.state;

        if (currentState === 'on') {
            // Switch back to dropdown
            customResolution.classList.add('hidden');
            resolutionDropdown.classList.remove('hidden');
            customResolutionBtn.setAttribute('data-state', 'off');
            if (areaToggle) areaToggle.classList.add('hidden');

            // Try to find a matching preset resolution based on current custom dimensions
            const currentWidth = parseInt(widthInput.value) || 1024;
            const currentHeight = parseInt(heightInput.value) || 1024;

            // Look for an exact match in RESOLUTIONS
            const matchingResolution = RESOLUTIONS.find(r => r.width === currentWidth && r.height === currentHeight);

            if (matchingResolution) {
                // Found a matching preset, select it
                const matchingGroup = RESOLUTION_GROUPS.find(g =>
                    g.options.some(opt => opt.value === matchingResolution.value)
                );
                selectStageResolution(stageId, matchingResolution.value, matchingGroup?.group || 'Normal');
            } else {
                // No match found, default to normal square
                selectStageResolution(stageId, 'normal_square', 'Normal');
            }
        }
    });

    // Dimension input change handlers
    let blurTimeout;
    const validateDimensionsWithTimeout = () => {
        if (resolutionInput.value !== 'custom') return;

        // Clear any existing timeout
        if (blurTimeout) clearTimeout(blurTimeout);

        // Set a 100ms timeout
        blurTimeout = setTimeout(() => {
            // Check that neither input is currently the active element
            if (document.activeElement === widthInput || document.activeElement === heightInput) {
                return; // One of the inputs is still active, don't validate yet
            }

            // Get current values
            const originalWidth = parseInt(widthInput.value) || 1024;
            const originalHeight = parseInt(heightInput.value) || 1024;
            let width = originalWidth;
            let height = originalHeight;
            let currentArea = width * height;

            // Get max area for validation
            const areaToggleEl = document.getElementById(`${stageId}_resolutionAreaToggle`);
            const maxArea = areaToggleEl && areaToggleEl.dataset.maxArea ? parseInt(areaToggleEl.dataset.maxArea) : 1048576;

            // First, ensure both dimensions are multiples of 64
            const widthRemainder = width % 64;
            const heightRemainder = height % 64;
            let widthChanged = false;
            let heightChanged = false;

            if (widthRemainder !== 0) {
                width = widthRemainder >= 32 ? width + (64 - widthRemainder) : width - widthRemainder;
                width = Math.max(64, width);
                widthChanged = true;
            }
            if (heightRemainder !== 0) {
                height = heightRemainder >= 32 ? height + (64 - heightRemainder) : height - heightRemainder;
                height = Math.max(64, height);
                heightChanged = true;
            }

            // Recalculate area after stepping
            currentArea = width * height;

            // If area exceeds max, gcd + 64-grid shrink (same as correctDimensions / server pipeline)
            if (currentArea > maxArea) {
                const capped = capDimensionsToMaxArea(width, height, maxArea, 64, 64, 64);
                width = capped.width;
                height = capped.height;
                widthChanged = true;
                heightChanged = true;
            }

            // Update inputs only if values changed
            if (widthChanged || heightChanged) {
                if (width !== originalWidth) {
                    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(widthInput, width);
                }
                if (height !== originalHeight) {
                    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(heightInput, height);
                }

                // Update bias orientation and cascade
                updateStageBiasOrientation(stageId, 'custom');
                updatePipelineStages(stageId);
                updateExpandCanvasStageInsetToggle(stageId);
            }
        }, 100);
    };

    const handleDimensionInput = () => {
        if (resolutionInput.value === 'custom') {
            updateStageBiasOrientation(stageId, 'custom');
        }
        updateExpandCanvasStageInsetToggle(stageId);
    };

    // Input events for immediate feedback
    widthInput.addEventListener('input', handleDimensionInput);
    heightInput.addEventListener('input', handleDimensionInput);

    // Blur events for validating dimensions with timeout
    widthInput.addEventListener('blur', () => {
        validateDimensionsWithTimeout();
    });
    heightInput.addEventListener('blur', () => {
        validateDimensionsWithTimeout();
    });

    // Mouse wheel and keyboard support for width - maintains area while adjusting ratio
    let isWheelUpdating = false;

    const updateWidthDimension = (delta) => {
        if (resolutionInput.value !== 'custom' || isWheelUpdating) return;

        isWheelUpdating = true;

        const currentWidth = parseInt(widthInput.value) || 1024;
        const currentHeight = parseInt(heightInput.value) || 1024;
        const currentArea = currentWidth * currentHeight;

        // Adjust width by 64 pixels (step size) based on scroll direction
        const newWidth = currentWidth + delta;

        // Calculate new height to maintain area
        const newHeight = Math.round(currentArea / newWidth);

        // Get max area for validation
        const areaToggleEl = document.getElementById(`${stageId}_resolutionAreaToggle`);
        const maxArea = areaToggleEl && areaToggleEl.dataset.maxArea ? parseInt(areaToggleEl.dataset.maxArea) : 1048576;

        // Use correctDimensions with step 64 and current max area to ensure valid dimensions with clamping
        const result = correctDimensions(newWidth, newHeight, { step: 64, maxArea: maxArea });

        // Update inputs without triggering input events (set directly)
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(widthInput, result.width);
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(heightInput, result.height);

        // Update bias orientation
        updateStageBiasOrientation(stageId, 'custom');

        // Update downstream stages
        updatePipelineStages(stageId);
        updateExpandCanvasStageInsetToggle(stageId);

        isWheelUpdating = false;
    };

    widthInput.addEventListener('wheel', function (e) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -64 : 64;
        updateWidthDimension(delta);
    });

    widthInput.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const delta = e.key === 'ArrowUp' ? 64 : -64;
            updateWidthDimension(delta);
        }
    });

    // Mouse wheel and keyboard support for height - maintains area while adjusting ratio
    const updateHeightDimension = (delta) => {
        if (resolutionInput.value !== 'custom' || isWheelUpdating) return;

        isWheelUpdating = true;

        const currentWidth = parseInt(widthInput.value) || 1024;
        const currentHeight = parseInt(heightInput.value) || 1024;
        const currentArea = currentWidth * currentHeight;

        // Adjust height by 64 pixels (step size) based on scroll direction
        const newHeight = currentHeight + delta;

        // Calculate new width to maintain area
        const newWidth = Math.round(currentArea / newHeight);

        // Get max area for validation
        const areaToggleEl = document.getElementById(`${stageId}_resolutionAreaToggle`);
        const maxArea = areaToggleEl && areaToggleEl.dataset.maxArea ? parseInt(areaToggleEl.dataset.maxArea) : 1048576;

        // Use correctDimensions with step 64 and current max area to ensure valid dimensions with clamping
        const result = correctDimensions(newWidth, newHeight, { step: 64, maxArea: maxArea });

        // Update inputs without triggering input events (set directly)
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(widthInput, result.width);
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(heightInput, result.height);

        // Update bias orientation
        updateStageBiasOrientation(stageId, 'custom');

        // Update downstream stages
        updatePipelineStages(stageId);
        updateExpandCanvasStageInsetToggle(stageId);

        isWheelUpdating = false;
    };

    heightInput.addEventListener('wheel', function (e) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -64 : 64;
        updateHeightDimension(delta);
    });

    heightInput.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const delta = e.key === 'ArrowUp' ? 64 : -64;
            updateHeightDimension(delta);
        }
    });
}

function setupEnhanceStageEvents(stageId, initialUseBaseImage = true) {
    const magnitudeInput = document.getElementById(`${stageId}_magnitude`);
    const strengthInput = document.getElementById(`${stageId}_strength`);
    const noiseInput = document.getElementById(`${stageId}_noise`);
    const strengthOverlay = document.getElementById(`${stageId}_strengthOverlay`);
    const noiseOverlay = document.getElementById(`${stageId}_noiseOverlay`);
    const inheritSeedToggle = document.getElementById(`${stageId}_inheritSeedToggle`);
    const autoSeedToggle = document.getElementById(`${stageId}_autoSeedToggle`);
    const seedInput = document.getElementById(`${stageId}_seed`);
    const useBaseImageToggle = document.getElementById(`${stageId}_useBaseImageToggle`);
    const groupMagnitude = document.querySelector(`#${stageId}_body .group-magnitude`);
    const groupStrength = document.querySelector(`#${stageId}_body .group-strength`);
    const groupNoise = document.querySelector(`#${stageId}_body .group-noise`);

    // Inherit seed toggle
    if (inheritSeedToggle && seedInput && autoSeedToggle) {
        inheritSeedToggle.addEventListener('click', () => {
            const currentState = inheritSeedToggle.dataset.state;
            const newState = currentState === 'on' ? 'off' : 'on';
            inheritSeedToggle.dataset.state = newState;

            if (newState === 'on') {
                // Inherit mode: hide auto seed toggle
                autoSeedToggle.classList.add('hidden');
            } else {
                // Manual mode: show auto seed toggle if we have a loaded seed
                if (seedInput.dataset.loadedSeed) {
                    autoSeedToggle.classList.remove('hidden');
                }
            }

            // Use consolidated function to update seed display
            updateStageSeedDisplay(stageId);
        });
    }

    // Auto-resize creative directive textarea and set initial visibility
    const stageDirective = document.getElementById(`${stageId}_creativeDirective`);
    if (stageDirective) {
        autoResizeTextarea(stageDirective, 23);

        // Add input event listener for continuous auto-resizing
        stageDirective.addEventListener('input', () => {
            autoResizeTextarea(stageDirective, 23);
        });
    }

    // Set initial visibility based on creative mode
    updateStageCreativeDirectiveVisibility(stageId);

    // Magnitude change handler
    if (magnitudeInput) {
        magnitudeInput.addEventListener('input', () => {
            const magnitude = parseFloat(magnitudeInput.value);
            if (magnitude && MAGNITUDE_PRESETS[magnitude]) {
                const preset = MAGNITUDE_PRESETS[magnitude];

                // Clear strength and noise values (using magnitude preset - like rescale)
                strengthInput.value = '';
                noiseInput.value = '';

                // Update overlays to show preset values
                strengthOverlay.textContent = `${(preset.strength * 100).toFixed(0)}%`;
                noiseOverlay.textContent = `${(preset.noise * 100).toFixed(0)}%`;

                // Add inherited class to show it's using magnitude preset
                const strengthContainer = strengthInput.parentElement;
                const noiseContainer = noiseInput.parentElement;
                if (strengthContainer) strengthContainer.classList.add('inherited');
                if (noiseContainer) noiseContainer.classList.add('inherited');

                // Clear magnitude placeholder (it's now active)
                magnitudeInput.placeholder = '';
            }
        });

        magnitudeInput.addEventListener('wheel', (e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -(e.shiftKey ? 0.5 : 0.1) : (e.shiftKey ? 0.5 : 0.1);
            const currentVal = magnitudeInput.value !== '' ? parseFloat(magnitudeInput.value) : 3.0;
            const newValue = Math.max(1.0, Math.min(5.5, currentVal + delta));
            magnitudeInput.value = newValue.toFixed(1);
            magnitudeInput.dispatchEvent(new Event('input'));
        });
    }

    // Strength input handlers (same pattern as rescale)
    if (strengthInput && strengthOverlay) {
        strengthInput.addEventListener('input', () => {
            // Check if there's an actual value (including 0)
            if (strengthInput.value !== '') {
                const value = parseFloat(strengthInput.value);
                strengthOverlay.textContent = `${(value * 100).toFixed(0)}%`;

                // Remove inherited class from both strength and noise
                const strengthContainer = strengthInput.parentElement;
                const noiseContainer = noiseInput.parentElement;
                if (strengthContainer) strengthContainer.classList.remove('inherited');
                if (noiseContainer) noiseContainer.classList.remove('inherited');

                // Set magnitude to placeholder if it has a value
                if (magnitudeInput && magnitudeInput.value !== '') {
                    magnitudeInput.placeholder = magnitudeInput.value;
                    magnitudeInput.value = '';
                }
            } else {
                // Show default values when empty (if both are empty)
                if (noiseInput.value === '') {
                    strengthOverlay.textContent = '50%';
                    noiseOverlay.textContent = '0%';
                }
            }
        });

        strengthInput.addEventListener('wheel', (e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -(e.shiftKey ? 0.1 : 0.01) : (e.shiftKey ? 0.1 : 0.01);
            // Use custom value if set (including 0), otherwise parse from overlay or use default
            let currentVal;
            if (strengthInput.value !== '') {
                currentVal = parseFloat(strengthInput.value);
            } else {
                // Parse from overlay percentage (e.g., "50%" -> 0.5) or use default
                const overlayText = strengthOverlay.textContent.replace('%', '');
                currentVal = parseFloat(overlayText) / 100 || 0.5;
            }
            const newValue = Math.max(0, Math.min(1, currentVal + delta));
            strengthInput.value = newValue.toFixed(2);
            strengthOverlay.textContent = `${(newValue * 100).toFixed(0)}%`;

            // Remove inherited class from both strength and noise
            const strengthContainer = strengthInput.parentElement;
            const noiseContainer = noiseInput.parentElement;
            if (strengthContainer) strengthContainer.classList.remove('inherited');
            if (noiseContainer) noiseContainer.classList.remove('inherited');

            // Set magnitude to placeholder if it has a value
            if (magnitudeInput && magnitudeInput.value !== '') {
                magnitudeInput.placeholder = magnitudeInput.value;
                magnitudeInput.value = '';
            }
        });
    }

    // Noise input handlers (same pattern as rescale)
    if (noiseInput && noiseOverlay) {
        noiseInput.addEventListener('input', () => {
            // Check if there's an actual value (including 0)
            if (noiseInput.value !== '') {
                const value = parseFloat(noiseInput.value);
                noiseOverlay.textContent = `${(value * 100).toFixed(0)}%`;

                // Remove inherited class from both strength and noise
                const strengthContainer = strengthInput.parentElement;
                const noiseContainer = noiseInput.parentElement;
                if (strengthContainer) strengthContainer.classList.remove('inherited');
                if (noiseContainer) noiseContainer.classList.remove('inherited');

                // Set magnitude to placeholder if it has a value
                if (magnitudeInput && magnitudeInput.value !== '') {
                    magnitudeInput.placeholder = magnitudeInput.value;
                    magnitudeInput.value = '';
                }
            } else {
                // Show default values when empty (if both are empty)
                if (strengthInput.value === '') {
                    strengthOverlay.textContent = '50%';
                    noiseOverlay.textContent = '0%';
                }
            }
        });

        noiseInput.addEventListener('wheel', (e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -(e.shiftKey ? 0.1 : 0.01) : (e.shiftKey ? 0.1 : 0.01);
            // Use custom value if set (including 0), otherwise parse from overlay or use default
            let currentVal;
            if (noiseInput.value !== '') {
                currentVal = parseFloat(noiseInput.value);
            } else {
                // Parse from overlay percentage (e.g., "0%" -> 0.0) or use default
                const overlayText = noiseOverlay.textContent.replace('%', '');
                currentVal = parseFloat(overlayText) / 100 || 0.0;
            }
            const newValue = Math.max(0, Math.min(1, currentVal + delta));
            noiseInput.value = newValue.toFixed(2);
            noiseOverlay.textContent = `${(newValue * 100).toFixed(0)}%`;

            // Remove inherited class from both strength and noise
            const strengthContainer = strengthInput.parentElement;
            const noiseContainer = noiseInput.parentElement;
            if (strengthContainer) strengthContainer.classList.remove('inherited');
            if (noiseContainer) noiseContainer.classList.remove('inherited');

            // Set magnitude to placeholder if it has a value
            if (magnitudeInput && magnitudeInput.value !== '') {
                magnitudeInput.placeholder = magnitudeInput.value;
                magnitudeInput.value = '';
            }
        });
    }

    // Auto seed toggle (match manual modal pattern)
    if (autoSeedToggle && seedInput) {
        autoSeedToggle.addEventListener('click', () => {
            const currentState = autoSeedToggle.dataset.state;
            const newState = currentState === 'on' ? 'off' : 'on';
            autoSeedToggle.dataset.state = newState;

            // Use consolidated function to update seed display
            updateStageSeedDisplay(stageId);
        });
    }

    // Initialize with default magnitude (3.0)
    if (magnitudeInput && magnitudeInput.value === '') {
        magnitudeInput.value = '3.0';
        magnitudeInput.dispatchEvent(new Event('input'));
    }

    // Setup expand-style resolution dropdown
    const resolutionDropdown = document.getElementById(`${stageId}_resolutionDropdown`);
    const resolutionBtn = document.getElementById(`${stageId}_resolutionDropdownBtn`);
    const resolutionMenu = document.getElementById(`${stageId}_resolutionDropdownMenu`);
    const resolutionInput = document.getElementById(`${stageId}_resolution`);
    if (resolutionDropdown && resolutionBtn && resolutionMenu && resolutionInput) {
        setupDropdown(
            resolutionDropdown,
            resolutionBtn,
            resolutionMenu,
            (selectedValue) => renderStageResolutionDropdown(stageId, selectedValue),
            () => resolutionInput.value || '',
            { preventFocusTransfer: true }
        );

        // Add scroll wheel support for resolution cycling (skip custom)
        resolutionBtn.addEventListener('wheel', (e) => {
            e.preventDefault();

            const useBaseToggle = document.getElementById(`${stageId}_useBaseImageToggle`);
            const isEnhanceMode = useBaseToggle?.dataset.state === 'on';

            if (isEnhanceMode) {
                // Enhance mode: cycle through area options
                const areas = ['normal', 'large', 'xlarge'];
                let currentValue = resolutionInput.value;
                if (!currentValue) {
                    const inheritedValues = getStageInheritedValues(stageId);
                    currentValue = inheritedValues.resolution || 'normal';
                }
                const currentIndex = areas.findIndex(a => a === currentValue);
                if (currentIndex === -1) return;

                const delta = e.deltaY > 0 ? 1 : -1;
                let newIndex = currentIndex + delta;
                if (newIndex < 0) newIndex = areas.length - 1;
                if (newIndex >= areas.length) newIndex = 0;

                selectStageEnhanceResolution(stageId, areas[newIndex]);
                return;
            }

            // Variation mode: use same logic as expand canvas
            const baseResolutionValue = getStageBaseResolution(stageId);
            const currentResolution = RESOLUTIONS.find(r => r.value === baseResolutionValue);

            let isPortrait = false, isLandscape = false, isSquare = false;
            if (currentResolution) {
                isPortrait = currentResolution.height > currentResolution.width;
                isLandscape = currentResolution.width > currentResolution.height;
                isSquare = currentResolution.width === currentResolution.height;
            }

            // Build filtered list of resolutions
            const availableResolutions = [];
            RESOLUTION_GROUPS.forEach(group => {
                group.options.forEach(opt => {
                    if (opt.value === 'custom') return; // Skip custom
                    if (opt.value.startsWith('small_')) return; // Skip small

                    const optIsPortrait = opt.value.includes('_portrait');
                    const optIsLandscape = opt.value.includes('_landscape');
                    const optIsSquare = opt.value.includes('_square');

                    if (isPortrait && optIsPortrait) return;
                    if (isLandscape && optIsLandscape) return;
                    if (isSquare && optIsSquare) return;

                    availableResolutions.push({ value: opt.value, name: opt.name, group: group.group });
                });
            });

            if (availableResolutions.length === 0) return;

            // Find current index - use inherited value if input is empty
            let currentValue = resolutionInput.value;
            if (!currentValue) {
                const inheritedValues = getStageInheritedValues(stageId);
                if (inheritedValues.resolution) {
                    // Construct full preset with orientation for variation
                    if (currentResolution) {
                        let orientation = 'square';
                        if (currentResolution.height > currentResolution.width * 1.05) orientation = 'portrait';
                        else if (currentResolution.width > currentResolution.height * 1.05) orientation = 'landscape';
                        currentValue = `${inheritedValues.resolution}_${orientation}`;
                    } else {
                        currentValue = inheritedValues.resolution + '_square'; // Default fallback
                    }
                }
            }
            const currentIndex = availableResolutions.findIndex(r => r.value === currentValue);

            // Calculate new index
            const delta = e.deltaY > 0 ? 1 : -1;
            let newIndex = currentIndex + delta;

            // Wrap around
            if (newIndex < 0) newIndex = availableResolutions.length - 1;
            if (newIndex >= availableResolutions.length) newIndex = 0;

            // Select new resolution
            const newResolution = availableResolutions[newIndex];

            // Update the input value
            resolutionInput.value = newResolution.value;

            // Update button display
            const resolutionSelected = document.getElementById(`${stageId}_resolutionSelected`);
            if (resolutionSelected) {
                const groupObj = RESOLUTION_GROUPS.find(g => g.group === newResolution.group);
                const badge = groupObj && groupObj.badge ? `<span class="custom-dropdown-badge${groupObj.free ? ' free-badge' : ''}">${groupObj.badge}</span>` : '';
                resolutionSelected.innerHTML = `<span class="custom-dropdown-text">${newResolution.name}</span>${badge}`;
            }

            // Update bias orientation and cascade downstream
            updateStageBiasOrientation(stageId, newResolution.value);
            updateDownstreamStageResolutions(stageId);
        });
    }

    // Setup custom resolution controls (shared function)
    setupStageCustomResolutionControls(stageId, resolutionDropdown, resolutionInput);

    // Toggle behavior between enhance (img2img) and normal (text2img-like)
    const applyToggleVisibility = (on) => {
        if (groupMagnitude) groupMagnitude.classList.toggle('hidden', !on);
        if (groupStrength) groupStrength.classList.toggle('hidden', !on);
        if (groupNoise) groupNoise.classList.toggle('hidden', !on);
    };
    applyToggleVisibility(initialUseBaseImage);

    const mapAreaFromResolution = () => {
        const resInput = document.getElementById(`${stageId}_resolution`);
        const widthInput = document.getElementById(`${stageId}_width`);
        const heightInput = document.getElementById(`${stageId}_height`);
        if (!resInput) return 'normal';
        const val = (resInput.value || '').toLowerCase();
        if (val === 'custom' && widthInput && heightInput && widthInput.value && heightInput.value) {
            const w = parseInt(widthInput.value) || 1024;
            const h = parseInt(heightInput.value) || 1024;
            const area = w * h;
            if (area <= 1048576) return 'normal';
            if (area <= 2166784) return 'large';
            return 'xlarge';
        }
        const parts = val.split('_');
        return parts[0] || 'normal';
    };

    const computeInheritedOrientation = () => {
        const allStages = Array.from(pipelineStagesContainer?.querySelectorAll('.pipeline-stage-item') || []);
        const currentIndex = allStages.findIndex(s => s.id === stageId);
        let baseW = 1024, baseH = 1024;
        if (currentIndex > 0) {
            const prevId = allStages[currentIndex - 1].id;
            const dims = getStageDimensions(prevId);
            if (dims && dims.width && dims.height) { baseW = dims.width; baseH = dims.height; }
        } else {
            const resVal = typeof manualSelectedResolution !== 'undefined' ? manualSelectedResolution : 'normal_square';
            const dims = getDimensionsFromResolution(resVal) || { width: 1024, height: 1024 };
            baseW = dims.width; baseH = dims.height;
        }
        if (baseH > baseW * 1.05) return 'portrait';
        if (baseW > baseH * 1.05) return 'landscape';
        return 'square';
    };

    const switchToEnhance = () => {
        const resolutionInput = document.getElementById(`${stageId}_resolution`);
        const hasCustom = resolutionInput && resolutionInput.value !== '';
        let area;
        if (hasCustom) {
            area = mapAreaFromResolution();
        } else {
            // Get inherited value and extract area name
            const inheritedValues = getStageInheritedValues(stageId);
            if (inheritedValues.resolution) {
                if (inheritedValues.resolution.includes('_')) {
                    area = inheritedValues.resolution.split('_')[0];
                } else if (['normal', 'large', 'xlarge'].includes(inheritedValues.resolution)) {
                    area = inheritedValues.resolution;
                } else {
                    area = 'normal';
                }
            } else {
                area = 'normal';
            }
        }
        selectStageEnhanceResolution(stageId, area, !hasCustom);
        // Re-render dropdown menu for enhance mode (area options)
        const currentValue = resolutionInput?.value || area;
        renderStageResolutionDropdown(stageId, currentValue);
        applyToggleVisibility(true);
        updateDownstreamStagesInheritedValues(stageId);
    };

    const switchToStageResolution = () => {
        const resolutionInput = document.getElementById(`${stageId}_resolution`);
        const hasCustom = resolutionInput && resolutionInput.value !== '';

        let target;
        if (hasCustom) {
            // Has custom value - process it (might be area name from enhance mode, convert to full preset)
            const currentValue = resolutionInput.value;
            if (['normal', 'large', 'xlarge'].includes(currentValue) && !currentValue.includes('_') && currentValue !== 'custom') {
                // Area name from enhance mode - convert to full preset with orientation
                const orientation = computeInheritedOrientation();
                target = `${currentValue}_${orientation}`;
            } else {
                // Already a full preset or custom - use as is
                target = currentValue;
            }
            // Process the value (not inherited, this is a custom selection)
            selectStageResolution(stageId, target, null, false);
        } else {
            // No custom value - use inherited
            const inheritedValues = getStageInheritedValues(stageId);
            if (inheritedValues.resolution && !inheritedValues.resolution.includes('_') && inheritedValues.resolution !== 'custom') {
                const orientation = computeInheritedOrientation();
                target = `${inheritedValues.resolution}_${orientation}`;
            } else {
                target = inheritedValues.resolution || 'normal_square';
            }
            selectStageResolution(stageId, target, null, true);
        }

        // Re-render dropdown menu for variation mode (full resolution options)
        const currentValue = resolutionInput?.value || target;
        renderStageResolutionDropdown(stageId, currentValue);
        applyToggleVisibility(false);
        updateDownstreamStagesInheritedValues(stageId);
    };

    if (useBaseImageToggle) {
        useBaseImageToggle.addEventListener('click', () => {
            const newState = useBaseImageToggle.dataset.state === 'on' ? 'off' : 'on';
            useBaseImageToggle.dataset.state = newState;

            refreshPipelineStageTypeLabel(stageId);

            if (newState === 'on') switchToEnhance(); else switchToStageResolution();
        });
    }

    // Setup advanced controls (same as expand canvas)
    setupStageAdvancedControls(stageId);
}

function setupStageAdvancedControls(stageId) {
    const inheritedValues = getStageInheritedValues(stageId);

    const stepsInput = document.getElementById(`${stageId}_steps`);
    const guidanceInput = document.getElementById(`${stageId}_guidance`);
    const rescaleInput = document.getElementById(`${stageId}_rescale`);
    const rescaleOverlay = document.getElementById(`${stageId}_rescaleOverlay`);
    const varietyBtn = document.getElementById(`${stageId}_varietyBtn`);

    // Set placeholders for advanced controls
    if (stepsInput) stepsInput.placeholder = inheritedValues.steps.toString();
    if (guidanceInput) guidanceInput.placeholder = inheritedValues.guidance >= 10 ? 10 : inheritedValues.guidance.toFixed(1);

    // Variety toggle
    if (varietyBtn) {
        varietyBtn.addEventListener('click', () => {
            varietyBtn.dataset.state = varietyBtn.dataset.state === 'on' ? 'off' : 'on';
            updateStageResetButtonVisibility(stageId);
            updateDownstreamStagesInheritedValues(stageId);
        });
        // Set initial state from inherited
        varietyBtn.dataset.state = inheritedValues.variety ? 'on' : 'off';
    }

    // Rescale percentage overlay
    if (rescaleInput && rescaleOverlay) {
        const rescaleContainer = rescaleInput.parentElement;

        // Set initial overlay from inherited value
        rescaleOverlay.textContent = `${(inheritedValues.rescale * 100).toFixed(0)}%`;

        // Update inherited state (check for empty string, not falsy value)
        if (rescaleInput.value === '') {
            if (rescaleContainer) rescaleContainer.classList.add('inherited');
        }

        // Add blur validation for rescale
        rescaleInput.addEventListener('blur', () => {
            let value = parseFloat(rescaleInput.value);
            if (isNaN(value) || value < 0) value = 0;
            if (value > 1) value = 1;
            if (rescaleInput.value !== '') {
                rescaleInput.value = value.toFixed(2);
                rescaleOverlay.textContent = `${(value * 100).toFixed(0)}%`;
            }
        });

        rescaleInput.addEventListener('input', () => {
            // Check if there's an actual value (including 0)
            if (rescaleInput.value !== '') {
                const value = parseFloat(rescaleInput.value);
                rescaleOverlay.textContent = `${(value * 100).toFixed(0)}%`;
                if (rescaleContainer) rescaleContainer.classList.remove('inherited');
            } else {
                // Show inherited value when empty
                const currentInherited = getStageInheritedValues(stageId);
                rescaleOverlay.textContent = `${(currentInherited.rescale * 100).toFixed(0)}%`;
                if (rescaleContainer) rescaleContainer.classList.add('inherited');
            }
            updateStageResetButtonVisibility(stageId);
            updateDownstreamStagesInheritedValues(stageId);
        });
        rescaleInput.addEventListener('wheel', (e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -(e.shiftKey ? 0.1 : 0.01) : (e.shiftKey ? 0.1 : 0.01);
            // Use custom value if set (including 0), otherwise use inherited
            const currentVal = rescaleInput.value !== '' ? parseFloat(rescaleInput.value) : inheritedValues.rescale;
            const newValue = Math.max(0, Math.min(1, currentVal + delta));
            rescaleInput.value = newValue.toFixed(2);
            rescaleOverlay.textContent = `${(newValue * 100).toFixed(0)}%`;
            if (rescaleContainer) rescaleContainer.classList.remove('inherited');
            updateStageResetButtonVisibility(stageId);
            updateDownstreamStagesInheritedValues(stageId);
        });
    }

    // Setup model dropdown
    const modelDropdown = document.getElementById(`${stageId}_modelDropdown`);
    const modelBtn = document.getElementById(`${stageId}_modelDropdownBtn`);
    const modelMenu = document.getElementById(`${stageId}_modelDropdownMenu`);
    if (modelDropdown && modelBtn && modelMenu) {
        setupDropdown(
            modelDropdown,
            modelBtn,
            modelMenu,
            (selectedValue) => renderStageModelDropdown(stageId, selectedValue),
            () => document.getElementById(`${stageId}_model`)?.value || '',
            { preventFocusTransfer: true }
        );
    }

    // Setup sampler dropdown
    const samplerDropdown = document.getElementById(`${stageId}_samplerDropdown`);
    const samplerBtn = document.getElementById(`${stageId}_samplerDropdownBtn`);
    const samplerMenu = document.getElementById(`${stageId}_samplerDropdownMenu`);
    if (samplerDropdown && samplerBtn && samplerMenu) {
        setupDropdown(
            samplerDropdown,
            samplerBtn,
            samplerMenu,
            (selectedValue) => renderStageSamplerDropdown(stageId, selectedValue),
            () => document.getElementById(`${stageId}_sampler`)?.value || '',
            { preventFocusTransfer: true }
        );

        // Initialize with inherited state
        updateStageDropdownInheritedState(stageId);

        // Initial reset button visibility check
        updateStageResetButtonVisibility(stageId);
    }

    // Special handling for steps input with 28-step block
    let stepsWheelTimeout = false;
    if (stepsInput) {
        // Add blur validation for steps
        stepsInput.addEventListener('blur', () => {
            let value = parseInt(stepsInput.value);
            if (isNaN(value) || value < 1) value = 1;
            if (value > 50) value = 50;
            if (stepsInput.value !== '') {
                stepsInput.value = value;
            }
        });

        stepsInput.addEventListener('input', () => {
            updateStageResetButtonVisibility(stageId);
            updateDownstreamStagesInheritedValues(stageId);
        });
        stepsInput.addEventListener('wheel', (e) => {
            e.preventDefault();
            // Use inherited value if no custom value set
            const currentValue = stepsInput.value ? parseInt(stepsInput.value) : parseInt(stepsInput.placeholder || 25);
            const delta = e.deltaY > 0 ? -1 : 1;

            if (currentValue < 28) {
                if (!stepsWheelTimeout) {
                    const nextValue = currentValue + delta;
                    if (nextValue >= 28) {
                        stepsInput.value = 28;
                        stepsWheelTimeout = true;
                        setTimeout(() => {
                            stepsWheelTimeout = false;
                        }, 1000);
                    } else {
                        stepsInput.value = Math.max(1, nextValue);
                    }
                }
            } else if (currentValue === 28) {
                if (!stepsWheelTimeout && delta > 0) {
                    stepsInput.value = 29;
                    stepsWheelTimeout = true;
                    setTimeout(() => {
                        stepsWheelTimeout = false;
                    }, 1000);
                } else if (delta < 0) {
                    stepsInput.value = 27;
                }
            } else {
                const newValue = Math.max(1, Math.min(50, currentValue + delta));
                stepsInput.value = newValue;
            }
            updateStageResetButtonVisibility(stageId);
            updateDownstreamStagesInheritedValues(stageId);
        });
    }

    // Guidance input
    if (guidanceInput) {
        // Add blur validation for guidance
        guidanceInput.addEventListener('blur', () => {
            let value = parseFloat(guidanceInput.value);
            if (isNaN(value) || value < 0) value = 0;
            if (value > 10) value = 10;
            if (guidanceInput.value !== '') {
                guidanceInput.value = value >= 10 ? value.toString() : value.toFixed(1);
            }
        });

        guidanceInput.addEventListener('input', () => {
            updateStageResetButtonVisibility(stageId);
            updateDownstreamStagesInheritedValues(stageId);
        });
        guidanceInput.addEventListener('wheel', (e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -(e.shiftKey ? 0.01 : 0.1) : (e.shiftKey ? 0.01 : 0.1);
            // Use inherited value if no custom value set (handle 0 properly)
            const currentVal = guidanceInput.value !== '' ? parseFloat(guidanceInput.value) : parseFloat(guidanceInput.placeholder || 5.0);
            const newValue = Math.max(0.0, Math.min(10.0, currentVal + delta));
            guidanceInput.value = newValue >= 10 ? 10 : newValue.toFixed(1);
            updateStageResetButtonVisibility(stageId);
            updateDownstreamStagesInheritedValues(stageId);
        });
    }

    // Reset button handler
    const resetBtn = document.getElementById(`${stageId}_resetAdvanced`);
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            // Get current inherited values
            const currentInherited = getStageInheritedValues(stageId);

            // Clear all custom values
            const modelInput = document.getElementById(`${stageId}_model`);
            const samplerInput = document.getElementById(`${stageId}_sampler`);
            const noiseSchedulerInput = document.getElementById(`${stageId}_noiseScheduler`);
            const stepsInput = document.getElementById(`${stageId}_steps`);
            const guidanceInput = document.getElementById(`${stageId}_guidance`);
            const rescaleInput = document.getElementById(`${stageId}_rescale`);
            const varietyBtn = document.getElementById(`${stageId}_varietyBtn`);

            if (modelInput) modelInput.value = '';
            if (samplerInput) samplerInput.value = '';
            if (noiseSchedulerInput) noiseSchedulerInput.value = '';
            if (stepsInput) stepsInput.value = '';
            if (guidanceInput) guidanceInput.value = '';
            if (rescaleInput) {
                rescaleInput.value = '';
                const rescaleOverlay = document.getElementById(`${stageId}_rescaleOverlay`);
                const rescaleContainer = rescaleInput.parentElement;
                if (rescaleOverlay) {
                    rescaleOverlay.textContent = `${(currentInherited.rescale * 100).toFixed(0)}%`;
                }
                if (rescaleContainer) {
                    rescaleContainer.classList.add('inherited');
                }
            }
            if (varietyBtn) {
                varietyBtn.dataset.state = currentInherited.variety ? 'on' : 'off';
            }

            // Reset resolution if it has a custom value
            const resolutionInput = document.getElementById(`${stageId}_resolution`);
            if (resolutionInput && resolutionInput.value !== '') {
                resolutionInput.value = '';
            }

            // Reset background focus to inherited state
            const bgFocusToggle = document.getElementById(`${stageId}_bgFocusToggle`);
            if (bgFocusToggle) {
                bgFocusToggle.dataset.state = ''; // Clear to inherit
                updateStageBackgroundFocusVisuals(stageId, currentInherited.backgroundFocus, true);
            }

            // Update inherited state for dropdowns
            updateStageDropdownInheritedState(stageId);

            // Update reset button visibility
            updateStageResetButtonVisibility(stageId);

            // Update downstream stages
            updateDownstreamStagesInheritedValues(stageId);
        });
    }
}

function wirePipelineStageControls(stageId, options = {}) {
    unwirePipelineStageControls(stageId);
    const controller = new AbortController();
    _pipelineStageWireControllers.set(stageId, controller);

    const stageItem = document.getElementById(stageId);
    if (!stageItem) return;

    const stageType = stageItem.dataset.stageType;
    if (stageType === STAGE_TYPES.EXPAND_CANVAS) {
        setupExpandCanvasStageEvents(stageId);
    } else if (stageType === STAGE_TYPES.VARIATION) {
        const useBaseImage = options.useBaseImage === true;
        setupEnhanceStageEvents(stageId, useBaseImage);
    }

    initializePipelineStageDragAndDrop();
}

function unwirePipelineStageControls(stageId) {
    const controller = _pipelineStageWireControllers.get(stageId);
    if (controller) {
        controller.abort();
        _pipelineStageWireControllers.delete(stageId);
    }
}

function attachPipelineGlobalToggleListeners(signal) {
    // saveStage0Btn, enableStageGenerationBtn: public/scripts/comp/manualModalManager.js
    if (saveStage0Btn) {
        saveStage0Btn.addEventListener('click', () => {
            if (saveStage0Btn.dataset.managedLock === 'true') return;
            const newState = saveStage0Btn.dataset.state === 'on' ? 'off' : 'on';
            saveStage0Btn.dataset.state = newState;
            updateManualUpscaleVisibility();
        }, { signal });
    }

    if (enableStageGenerationBtn) {
        enableStageGenerationBtn.addEventListener('click', () => {
            const newState = enableStageGenerationBtn.dataset.state === 'on' ? 'off' : 'on';
            enableStageGenerationBtn.dataset.state = newState;
            const windowBtn = document.getElementById('windowEnableStageGenerationBtn');
            if (windowBtn) windowBtn.dataset.state = newState;
            updateSaveStage0BtnVisibility();
        }, { signal });
    }

    const windowEnableStageGenerationBtn = document.getElementById('windowEnableStageGenerationBtn');
    if (windowEnableStageGenerationBtn) {
        windowEnableStageGenerationBtn.addEventListener('click', () => {
            const newState = windowEnableStageGenerationBtn.dataset.state === 'on' ? 'off' : 'on';
            windowEnableStageGenerationBtn.dataset.state = newState;
            if (enableStageGenerationBtn) enableStageGenerationBtn.dataset.state = newState;
            updateSaveStage0BtnVisibility();
        }, { signal });
    }
}

function onManualModalPipelineScopeOpened(signal) {
    attachPipelineGlobalToggleListeners(signal);
    signal.addEventListener('abort', () => {
        if (_pipelineDragDocumentController) {
            _pipelineDragDocumentController.abort();
            _pipelineDragDocumentController = null;
        }
    });
}

function initPipelineGlobalToggleListenerScope() {
    const manualModalEl = document.getElementById('manualModal');
    if (!manualModalEl) return;
    // attachModalListeners: public/scripts/comp/modalListenerScope.js
    attachModalListeners(manualModalEl, onManualModalPipelineScopeOpened);
}

if (typeof wsClient !== 'undefined' && wsClient) {
    wsClient.registerInitStep(475, 'Pipeline global toggle listener scope', async () => {
        initPipelineGlobalToggleListenerScope();
    });
}
