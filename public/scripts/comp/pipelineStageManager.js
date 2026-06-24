/**
 * Pipeline stage data loading and stage indicator UI.
 * Phase 2 extract from public/scripts/app.js batches 11–12.
 *
 * Dependencies: pipelineStageControls.js, utilities.js (STAGE_TYPES, MAGNITUDE_PRESETS)
 */

// ============================================================================
// PIPELINE STAGES SYSTEM
// ============================================================================

// STAGE_TYPES, MAGNITUDE_PRESETS: public/scripts/comp/utilities.js

// Render add item dropdown (combines character and stage options)
function renderAddItemDropdown() {
    const menu = addItemDropdownMenu;
    if (!menu) return;

    menu.innerHTML = '';

    // Content section header
    const contentHeader = document.createElement('div');
    contentHeader.className = 'custom-dropdown-group';
    contentHeader.textContent = 'Component';
    menu.appendChild(contentHeader);

    // Character option
    const characterOption = document.createElement('div');
    characterOption.className = 'custom-dropdown-option';
    characterOption.dataset.value = 'character';
    characterOption.innerHTML = '<i class="fas fa-user"></i> Character';
    characterOption.addEventListener('click', () => {
        addCharacterPrompt();
        closeDropdown(addItemDropdownMenu, addItemDropdownBtn);
    });
    menu.appendChild(characterOption);

    // Text Overlay option
    const textOverlayOption = document.createElement('div');
    textOverlayOption.className = 'custom-dropdown-option';
    textOverlayOption.dataset.value = 'text-overlay';
    textOverlayOption.innerHTML = '<i class="fas fa-text"></i> Text Overlay';
    textOverlayOption.addEventListener('click', () => {
        addTextOverlay();
        closeDropdown(addItemDropdownMenu, addItemDropdownBtn);
    });
    menu.appendChild(textOverlayOption);

    // References section header
    const referencesHeader = document.createElement('div');
    referencesHeader.className = 'custom-dropdown-group';
    referencesHeader.textContent = 'Reference';
    menu.appendChild(referencesHeader);

    // Transformation options
    const transformationOptions = [
        { value: 'base-image', name: 'Base Image', icon: 'nai-img2img' },
        { value: 'vibe-transfer', name: 'Vibe Transfer', icon: 'nai-vibe-transfer' },
        { value: 'character-reference', name: 'Character / Style', icon: 'nai-precise-reference-style-and-character' },
        { value: 'upload', name: 'Upload', icon: 'nai-import' }
    ];

    // Add dynamic options based on image availability
    const hasValidImage = window.currentEditImage && window.currentEditMetadata;
    const hasBaseImage = hasValidImage && (
        window.currentEditMetadata.original_filename ||
        (window.currentEditImage.filename || window.currentEditImage.original)
    );
    const isImg2Img = hasValidImage && window.currentEditMetadata.base_image === true;
    const shouldShowReroll = hasValidImage && isImg2Img;

    if (shouldShowReroll) {
        transformationOptions.splice(3, 0, { value: 'reroll', name: 'Previous Image', icon: 'fas fa-history' });
    }

    if (hasBaseImage) {
        transformationOptions.splice(shouldShowReroll ? 4 : 3, 0, { value: 'variation', name: 'Current Image', icon: 'fa-regular fa-image' });
    }

    transformationOptions.forEach(option => {
        const optionElement = document.createElement('div');
        optionElement.className = 'custom-dropdown-option';
        optionElement.dataset.value = option.value;
        optionElement.innerHTML = `<i class="${option.icon}"></i> ${option.name}`;

        optionElement.addEventListener('click', () => {
            selectTransformation(option.value);
            closeDropdown(addItemDropdownMenu, addItemDropdownBtn);
        });

        menu.appendChild(optionElement);
    });

    // Actions section header
    const actionsHeader = document.createElement('div');
    actionsHeader.className = 'custom-dropdown-group';
    actionsHeader.textContent = 'Pipeline Stage';
    menu.appendChild(actionsHeader);

    // Stage options
    const stageTypes = [
        { value: STAGE_TYPES.EXPAND_CANVAS, name: 'Expand Canvas', icon: 'mdi mdi-1-25 mdi-relative-scale' },
        { value: STAGE_TYPES.VARIATION, name: 'Enhance', icon: 'fas fa-diagram-venn', presetUseBaseImage: true },
        { value: STAGE_TYPES.VARIATION, name: 'Variation', icon: 'ri-image-ai-fill', presetUseBaseImage: false },
    ];

    stageTypes.forEach(type => {
        const option = document.createElement('div');
        option.className = 'custom-dropdown-option';
        option.dataset.value = type.value;
        option.innerHTML = `<i class="${type.icon}"></i> ${type.name}`;

        option.addEventListener('click', () => {
            addPipelineStage(type.value, { useBaseImage: !!type.presetUseBaseImage });
            closeDropdown(addItemDropdownMenu, addItemDropdownBtn);
        });

        menu.appendChild(option);
    });
}

/**
 * Calculate stage hex ID based on position and branch state
 * Format: [Chain][Stage] where:
 * - Chain: 0 for main pipeline, A-F for branches
 * - Stage: 0-F incremental within each chain
 * 
 * Rules:
 * - Main pipeline starts at 01, 02, 03, etc.
 * - When a stage is marked as branch, it starts a new chain (A, B, C...) at 0
 * - Branch stages continue: A0, A1, A2, etc.
 * - Returning to main pipeline continues from where it left off
 */
function calculateStageHexId(stageElement) {
    if (!pipelineStagesContainer) return '00';

    const allStages = Array.from(pipelineStagesContainer.querySelectorAll('.pipeline-stage-item'));
    const stageIndex = allStages.indexOf(stageElement);

    if (stageIndex === -1) return '00';

    let mainStageCounter = 0; // Counter for main pipeline (0 chain)
    let currentChain = '0'; // Current chain identifier
    let currentChainCounter = 0; // Counter within current chain
    const branchChains = ['A', 'B', 'C', 'D', 'E', 'F'];
    let nextBranchIndex = 0; // Index for next branch chain letter
    let inBranch = false; // Track if we're currently in a branch

    for (let i = 0; i <= stageIndex; i++) {
        const stage = allStages[i];
        const branchToggle = document.getElementById(`${stage.id}_branchToggle`);
        const isBranch = branchToggle?.dataset.state === 'on';

        if (i === stageIndex) {
            // This is the stage we're calculating for
            if (isBranch) {
                // This stage is marked as branch
                if (!inBranch) {
                    // Entering a new branch
                    currentChain = branchChains[nextBranchIndex] || 'F';
                    nextBranchIndex++;
                    currentChainCounter = 0;
                    inBranch = true;
                } else {
                    // Already in branch, continue
                    currentChainCounter++;
                }
            } else {
                // This stage is not marked as branch
                if (inBranch) {
                    // Exiting branch, return to main pipeline
                    currentChain = '0';
                    mainStageCounter++; // Increment first
                    currentChainCounter = mainStageCounter;
                    inBranch = false;
                } else {
                    // Continue in main pipeline
                    mainStageCounter++; // Increment first
                    currentChainCounter = mainStageCounter;
                }
            }

            // Format the hex ID
            const stageNum = currentChainCounter.toString(16).toUpperCase();
            return currentChain + stageNum;
        } else {
            // Process previous stages to track counters
            if (isBranch) {
                if (!inBranch) {
                    // Entering a new branch
                    currentChain = branchChains[nextBranchIndex] || 'F';
                    nextBranchIndex++;
                    currentChainCounter = 0;
                    inBranch = true;
                } else {
                    // Continue in branch
                    currentChainCounter++;
                }
            } else {
                if (inBranch) {
                    // Exiting branch
                    currentChain = '0';
                    mainStageCounter++; // Increment first
                    currentChainCounter = mainStageCounter;
                    inBranch = false;
                } else {
                    // Continue in main pipeline
                    mainStageCounter++;
                }
            }
        }
    }

    return '00'; // Fallback
}

/**
 * Update all stage hex ID displays
 */
function updateAllStageHexIds() {
    if (!pipelineStagesContainer) return;

    const allStages = pipelineStagesContainer.querySelectorAll('.pipeline-stage-item');
    allStages.forEach(stage => {
        const hexId = calculateStageHexId(stage);
        const hexIdSpan = stage.querySelector('.stage-hex-id');
        if (hexIdSpan) {
            hexIdSpan.textContent = hexId;
            hexIdSpan.title = `Stage ID: ${hexId}`;
        }
        syncManagedStageHammerIcon(stage, stage.dataset.managed === 'true');
    });
}

/**
 * Calculate stage hex IDs from stage data array (for generation requests)
 * @param {Array} stagesData - Array of stage data objects
 * @returns {Array} Array of hex IDs corresponding to each stage
 */
function calculateStageHexIdsFromData(stagesData) {
    if (!stagesData || !Array.isArray(stagesData)) return [];

    let mainStageCounter = 0;
    const branchChains = ['A', 'B', 'C', 'D', 'E', 'F'];
    let nextBranchIndex = 0;
    let inBranch = false;
    let currentChain = '0';
    let currentChainCounter = 0;

    return stagesData.map((stageData, index) => {
        const isBranch = stageData.branch === true;

        if (isBranch) {
            if (!inBranch) {
                // Entering a new branch
                currentChain = branchChains[nextBranchIndex] || 'F';
                nextBranchIndex++;
                currentChainCounter = 0;
                inBranch = true;
            } else {
                // Continue in branch
                currentChainCounter++;
            }
        } else {
            if (inBranch) {
                // Exiting branch
                currentChain = '0';
                mainStageCounter++; // Increment first
                currentChainCounter = mainStageCounter;
                inBranch = false;
            } else {
                // Continue in main pipeline
                mainStageCounter++; // Increment first
                currentChainCounter = mainStageCounter;
            }
        }

        const stageNum = currentChainCounter.toString(16).toUpperCase();
        return currentChain + stageNum;
    });
}

function resolvePipelineStageTypeMeta(type, options = {}) {
    let typeName = 'Variation';
    let typeIcon = 'ri-image-ai-fill';
    if (type === STAGE_TYPES.EXPAND_CANVAS) {
        typeName = 'Expand Canvas';
        typeIcon = 'mdi mdi-1-25 mdi-relative-scale';
    } else if (type === STAGE_TYPES.VARIATION) {
        if (options.useBaseImage) {
            typeName = 'Enhance';
            typeIcon = 'fas fa-diagram-venn';
        } else {
            typeName = 'Variation';
            typeIcon = 'ri-image-ai-fill';
        }
    }
    return { typeName, typeIcon };
}

function getPipelineStageDefaultTypeName(stageId) {
    const stageItem = document.getElementById(stageId);
    if (!stageItem) return 'Stage';
    const useBaseBtn = document.getElementById(`${stageId}_useBaseImageToggle`);
    const useBase = useBaseBtn?.dataset.state === 'on';
    return resolvePipelineStageTypeMeta(stageItem.dataset.stageType, { useBaseImage: useBase }).typeName;
}

function getPipelineStageDisplayName(stageItem) {
    if (!stageItem) return '';
    return String(stageItem.dataset.phaseStepName || '').trim();
}

function buildPipelineStageTypeLabelHtml(typeIcon, typeName, displayName) {
    const visible = (displayName && String(displayName).trim()) || typeName;
    const safeVisible = escapeHtml(visible);
    const safeDefault = escapeHtml(typeName);
    return `<i class="${typeIcon}"></i><div class="character-name-editable inline-name-edit stage-name-editable"><input type="text" class="character-name-input hover-show stage-display-name-input" value="${safeVisible}" placeholder="${safeDefault}" title="Click to rename stage"><span class="character-name-input-placeholder stage-display-name-placeholder">${safeVisible}</span></div><span class="stage-hex-id" title="Stage ID: "></span>`;
}

function wireInlineNameEditable(editableRoot, callbacks) {
    if (!editableRoot || editableRoot.dataset.inlineNameWired === 'true') return;
    editableRoot.classList.add('inline-name-edit');
    editableRoot.dataset.inlineNameWired = 'true';
    const input = editableRoot.querySelector('.character-name-input');
    const placeholder = editableRoot.querySelector('.character-name-input-placeholder');
    if (!input || !placeholder) return;

    const endEdit = () => {
        editableRoot.classList.remove('editing-name');
    };
    const startEdit = () => {
        editableRoot.classList.add('editing-name');
        input.focus();
        input.select();
    };

    placeholder.addEventListener('click', (e) => {
        e.preventDefault();
        startEdit();
    });
    input.addEventListener('focus', () => {
        editableRoot.classList.add('editing-name');
    });
    input.addEventListener('blur', () => {
        endEdit();
        if (callbacks && typeof callbacks.onCommit === 'function') {
            callbacks.onCommit(input.value);
        }
        if (callbacks && typeof callbacks.onDisplaySync === 'function') {
            callbacks.onDisplaySync(input, placeholder);
        }
    });
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            input.blur();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            if (callbacks && typeof callbacks.onCancel === 'function') {
                callbacks.onCancel(input, placeholder);
            }
            endEdit();
            input.blur();
        }
    });
}

function refreshPipelineStageTypeLabel(stageId) {
    const stageItem = document.getElementById(stageId);
    const typeLabel = document.getElementById(`${stageId}_typeLabel`);
    if (!stageItem || !typeLabel) return;
    const useBaseBtn = document.getElementById(`${stageId}_useBaseImageToggle`);
    const useBase = useBaseBtn?.dataset.state === 'on';
    const meta = resolvePipelineStageTypeMeta(stageItem.dataset.stageType, { useBaseImage: useBase });
    const displayName = getPipelineStageDisplayName(stageItem);
    const hammer = typeLabel.querySelector('.stage-managed-hammer');
    const hammerHtml = hammer ? hammer.outerHTML : '';
    typeLabel.innerHTML = buildPipelineStageTypeLabelHtml(meta.typeIcon, meta.typeName, displayName);
    const hexEl = typeLabel.querySelector('.stage-hex-id');
    if (hexEl) {
        hexEl.textContent = calculateStageHexId(stageItem);
        hexEl.title = `Stage ID: ${hexEl.textContent}`;
    }
    if (hammerHtml) {
        const hexSpan = typeLabel.querySelector('.stage-hex-id');
        if (hexSpan) hexSpan.insertAdjacentHTML('afterend', hammerHtml);
    }
    wirePipelineStageDisplayNameInput(stageId);
    syncManagedStageHammerIcon(stageItem, stageItem.dataset.managed === 'true');
}

function wirePipelineStageDisplayNameInput(stageId) {
    const stageItem = document.getElementById(stageId);
    if (!stageItem) return;
    const editableRoot = stageItem.querySelector('.stage-name-editable');
    if (!editableRoot) return;
    const input = editableRoot.querySelector('.stage-display-name-input');
    const placeholder = editableRoot.querySelector('.stage-display-name-placeholder');

    wireInlineNameEditable(editableRoot, {
        onCommit: (raw) => {
            const trimmed = String(raw || '').trim();
            const defaultTypeName = getPipelineStageDefaultTypeName(stageId);
            if (trimmed && trimmed !== defaultTypeName) {
                stageItem.dataset.phaseStepName = trimmed;
            } else {
                delete stageItem.dataset.phaseStepName;
            }
            // bracketGenerationApplet: public/scripts/comp/bracketGenerationApplet.js
            if (window.bracketGenerationApplet && typeof window.bracketGenerationApplet.syncStepNameFromPipelineStage === 'function') {
                window.bracketGenerationApplet.syncStepNameFromPipelineStage(stageId, trimmed);
            }
        },
        onDisplaySync: (inp, place) => {
            const defaultTypeName = getPipelineStageDefaultTypeName(stageId);
            const trimmed = String(stageItem.dataset.phaseStepName || '').trim();
            const visible = trimmed || defaultTypeName;
            inp.value = visible;
            place.textContent = visible;
        },
        onCancel: (inp, place) => {
            const defaultTypeName = getPipelineStageDefaultTypeName(stageId);
            const trimmed = String(stageItem.dataset.phaseStepName || '').trim();
            const visible = trimmed || defaultTypeName;
            inp.value = visible;
            place.textContent = visible;
        }
    });
}

function setPipelineStageDisplayName(stageId, name) {
    const stageItem = document.getElementById(stageId);
    if (!stageItem) return;
    const trimmed = String(name || '').trim();
    if (trimmed) {
        stageItem.dataset.phaseStepName = trimmed;
    } else {
        delete stageItem.dataset.phaseStepName;
    }
    refreshPipelineStageTypeLabel(stageId);
}

// Add pipeline stage
function addPipelineStage(type, options = {}) {
    if (!type || !pipelineStagesContainer) return;

    const stageId = `stage_${pipelineStageCounter++}`;
    const stageItem = document.createElement('div');
    stageItem.className = 'pipeline-stage-item';
    stageItem.id = stageId;
    stageItem.dataset.stageType = type;

    const stageHolder = document.createElement('div');
    stageHolder.className = 'pipeline-stage-holder';

    // Create stage header
    const stageHeader = document.createElement('div');
    stageHeader.className = 'stage-header';

    // Drag handle
    const dragHandle = document.createElement('div');
    dragHandle.className = 'workspace-drag-handle';
    dragHandle.title = 'Drag to reorder';
    dragHandle.innerHTML = '<i class="fas fa-grip-dots-vertical"></i>';

    // Stage type label (icon + editable display name)
    const stageTypeLabel = document.createElement('div');
    stageTypeLabel.className = 'stage-type-label';
    stageTypeLabel.id = `${stageId}_typeLabel`;
    const typeMeta = resolvePipelineStageTypeMeta(type, options);
    if (options.displayName) {
        stageItem.dataset.phaseStepName = String(options.displayName).trim();
    }
    stageTypeLabel.innerHTML = buildPipelineStageTypeLabelHtml(
        typeMeta.typeIcon,
        typeMeta.typeName,
        options.displayName || ''
    );

    // Stage toolbar — buildPipelineStageToolbar: public/scripts/comp/pipelineStageControls.js
    const stageControls = buildPipelineStageToolbar(stageId);

    stageHeader.appendChild(dragHandle);
    stageHeader.appendChild(stageTypeLabel);
    stageHeader.appendChild(stageControls);
    stageHolder.appendChild(stageHeader);

    // Create stage body
    const stageBody = document.createElement('div');
    stageBody.className = 'stage-body';
    stageBody.id = `${stageId}_body`;
    stageHolder.appendChild(stageBody);

    // Append to container
    stageItem.appendChild(stageHolder);
    pipelineStagesContainer.appendChild(stageItem);

    // Render stage-specific content
    if (type === STAGE_TYPES.EXPAND_CANVAS) {
        renderExpandCanvasStage(stageId);
        // Update all stages starting from manual
        updatePipelineStages();
    } else if (type === STAGE_TYPES.VARIATION) {
        renderEnhanceStage(stageId, options);
    }

    // Update saveStage0Btn visibility
    updateSaveStage0BtnVisibility();

    // Update pipeline stages header visibility
    updatePipelineStagesHeaderVisibility();

    // Update button states for all stages
    updateStageButtonStates();

    // Update text overlay stage visibility
    updateTextOverlayStageVisibility();

    // Update all stage hex IDs
    updateAllStageHexIds();

    // wirePipelineStageControls: public/scripts/comp/pipelineStageControls.js
    wirePipelineStageControls(stageId, options);

    wirePipelineStageDisplayNameInput(stageId);
}

function getManagedStageElements() {
    const container = pipelineStagesContainer;
    if (!container) return [];
    return Array.from(container.querySelectorAll('.pipeline-stage-item[data-managed="true"]'));
}

function getLastManagedStageElement() {
    const managed = getManagedStageElements();
    return managed.length ? managed[managed.length - 1] : null;
}

function syncManagedStageHammerIcon(stageItem, managed) {
    if (!stageItem) return;
    const typeLabel = stageItem.querySelector('.stage-type-label');
    if (!typeLabel) return;
    let hammer = typeLabel.querySelector('.stage-managed-hammer');
    if (managed) {
        if (!hammer) {
            hammer = document.createElement('i');
            hammer.className = 'fas fa-hammer stage-managed-hammer';
            hammer.title = 'Managed by Phasewalker';
            const hexIdSpan = typeLabel.querySelector('.stage-hex-id');
            if (hexIdSpan) {
                hexIdSpan.insertAdjacentElement('afterend', hammer);
            } else {
                typeLabel.appendChild(hammer);
            }
        }
    } else if (hammer) {
        hammer.remove();
    }
}

function applyManagedPipelineStageUi(stageId, managed) {
    const stageItem = document.getElementById(stageId);
    if (!stageItem) return;
    if (managed) {
        stageItem.dataset.managed = 'true';
        stageItem.classList.add('managed-stage');
    } else {
        delete stageItem.dataset.managed;
        stageItem.classList.remove('managed-stage');
    }
    const deleteBtn = stageItem.querySelector('.stage-controls .btn-danger');
    if (deleteBtn) {
        deleteBtn.disabled = managed;
        deleteBtn.classList.toggle('hidden', managed);
    }
    const dragHandle = stageItem.querySelector('.workspace-drag-handle');
    if (dragHandle) {
        dragHandle.classList.toggle('managed-drag-disabled', managed);
    }
    const saveResultsBtn = document.getElementById(`${stageId}_saveResultsToggle`);
    if (saveResultsBtn) {
        if (managed) {
            saveResultsBtn.dataset.state = 'on';
            saveResultsBtn.dataset.managedLock = 'true';
            saveResultsBtn.disabled = true;
        } else {
            delete saveResultsBtn.dataset.managedLock;
            saveResultsBtn.disabled = false;
        }
    }
    if (typeof syncManagedBracketEditorSaveFlags === 'function') {
        syncManagedBracketEditorSaveFlags();
    }
    syncManagedStageHammerIcon(stageItem, managed);
}

function enforceManagedStageSandwichRules() {
    const all = Array.from(pipelineStagesContainer?.querySelectorAll('.pipeline-stage-item') || []);
    all.forEach((stage, i) => {
        if (stage.dataset.managed === 'true') return;
        const prev = all[i - 1];
        const next = all[i + 1];
        const sandwiched = prev?.dataset.managed === 'true' && next?.dataset.managed === 'true';
        const branchBtn = document.getElementById(`${stage.id}_branchToggle`);
        if (sandwiched) {
            stage.dataset.forcedBranch = 'true';
            if (branchBtn) branchBtn.dataset.state = 'on';
            stage.classList.add('stage-branch');
        } else if (stage.dataset.forcedBranch === 'true') {
            delete stage.dataset.forcedBranch;
        }
    });
    updateAllStageHexIds();
}

function handleManagedStageBranchToggle(stageId) {
    const stageItem = document.getElementById(stageId);
    if (!stageItem || stageItem.dataset.forcedBranch !== 'true') return false;

    const lastManaged = getLastManagedStageElement();
    if (!lastManaged || lastManaged === stageItem) return false;

    if (lastManaged.nextSibling && lastManaged.nextSibling !== stageItem) {
        pipelineStagesContainer.insertBefore(stageItem, lastManaged.nextSibling);
    } else if (lastManaged.nextSibling === stageItem) {
        return true;
    } else {
        pipelineStagesContainer.appendChild(stageItem);
    }

    delete stageItem.dataset.forcedBranch;
    updatePipelineStages();
    enforceManagedStageSandwichRules();
    updateAllStageHexIds();
    return true;
}

// Delete pipeline stage
function deletePipelineStage(stageId) {
    const stageItem = document.getElementById(stageId);
    if (stageItem && stageItem.dataset.managed === 'true') {
        showGlassToast('warning', null, 'Managed stages can only be removed from Phasewalker', false, 4000, '<i class="fas fa-lock"></i>');
        return;
    }
    if (stageItem) {
        const stageType = stageItem.dataset.stageType;
        // unwirePipelineStageControls: public/scripts/comp/pipelineStageControls.js
        unwirePipelineStageControls(stageId);
        stageItem.remove();
        // Update all stages if deleting an expand canvas stage
        if (stageType === STAGE_TYPES.EXPAND_CANVAS) {
            updatePipelineStages();
        }
        // Update saveStage0Btn visibility
        updateSaveStage0BtnVisibility();
        // Update pipeline stages header visibility
        updatePipelineStagesHeaderVisibility();
        // Update button states for remaining stages
        updateStageButtonStates();
        // Update text overlay stage visibility
        updateTextOverlayStageVisibility();
        // Update all stage hex IDs
        updateAllStageHexIds();
        // Reinitialize drag and drop functionality
        initializePipelineStageDragAndDrop();
    }
}

// Move pipeline stage up
function movePipelineStageUp(stageId) {
    const stageItem = document.getElementById(stageId);
    if (!stageItem) return;
    if (stageItem.dataset.managed === 'true') return;

    const previousStage = stageItem.previousElementSibling;
    if (previousStage) {
        pipelineStagesContainer.insertBefore(stageItem, previousStage);
        // Update all stages after reordering
        updatePipelineStages();
        // Update all stage hex IDs
        updateAllStageHexIds();
    }
    enforceManagedStageSandwichRules();
}

// Move pipeline stage down
function movePipelineStageDown(stageId) {
    const stageItem = document.getElementById(stageId);
    if (!stageItem) return;
    if (stageItem.dataset.managed === 'true') return;

    const nextStage = stageItem.nextElementSibling;
    if (nextStage) {
        pipelineStagesContainer.insertBefore(nextStage, stageItem);
        // Update all stages after reordering
        updatePipelineStages();
        // Update all stage hex IDs
        updateAllStageHexIds();
    }
    enforceManagedStageSandwichRules();
}

// initializePipelineStageDragAndDrop → public/scripts/comp/pipelineStageControls.js (Phase 1 removal manifest)


/**
 * Master function to update pipeline stages
 * @param {string|null} startFromStageId - null or 'manual' to start from manual resolution, or specific stage ID
 * @description Unified function that handles all pipeline stage updates including:
 *              - Dropdown rendering
 *              - Resolution cascade
 *              - Display updates  
 *              - Bias orientation
 *              - Inherited values
 *              - Button states (up/down/upscale)
 */
function updatePipelineStages(startFromStageId = null) {
    const allStages = Array.from(pipelineStagesContainer?.querySelectorAll('.pipeline-stage-item') || []);
    if (allStages.length === 0) return;

    const fromManual = !startFromStageId || startFromStageId === 'manual';

    // Step 1: Re-render all expand canvas stage dropdowns to update available options
    allStages.forEach(stage => {
        if (stage.dataset.stageType === STAGE_TYPES.EXPAND_CANVAS) {
            const stageId = stage.id;
            const resolutionInput = document.getElementById(`${stageId}_resolution`);
            if (resolutionInput && resolutionInput.value) {
                renderStageResolutionDropdown(stageId, resolutionInput.value);
            }
        }
    });

    // Step 2: Cascade resolution changes
    if (fromManual) {
        // Starting from manual: cascade to ALL stages
        const manualRes = manualSelectedResolution || 'normal_square';
        updateDownstreamStageResolutions(null, manualRes, true);
    } else {
        // Starting from a specific stage: cascade to downstream stages only
        const startStage = allStages.find(s => s.id === startFromStageId);
        if (startStage && startStage.dataset.stageType === STAGE_TYPES.EXPAND_CANVAS) {
            const resolutionInput = document.getElementById(`${startFromStageId}_resolution`);
            if (resolutionInput && resolutionInput.value) {
                updateDownstreamStageResolutions(startFromStageId, resolutionInput.value, false);
                // Also refresh this stage's display
                refreshStageResolutionDisplay(startFromStageId);
            }
        }
    }

    // Step 3: Update bias orientation for all expand canvas stages
    allStages.forEach(stage => {
        if (stage.dataset.stageType === STAGE_TYPES.EXPAND_CANVAS) {
            const stageId = stage.id;
            const resolutionInput = document.getElementById(`${stageId}_resolution`);
            if (resolutionInput && resolutionInput.value) {
                updateStageBiasOrientation(stageId, resolutionInput.value);
            }
        }
    });

    // Step 4: Update inherited value displays for all stages
    allStages.forEach(stage => {
        updateStageInheritedDisplay(stage.id);
    });

    // Step 5: Update button states (up/down/upscale) for all stages
    updateStageButtonStates();
}

/**
 * Get actual pixel dimensions for a stage's output
 * @param {string} stageId - The stage ID
 * @returns {Object|null} {width, height} or null if can't determine
 */
function getStageDimensions(stageId) {
    const stage = document.getElementById(stageId);
    if (!stage) return null;

    const stageType = stage.dataset.stageType;

    // Get dimensions helper - used by all stage types
    const getInputDimensions = () => {
        const allStages = Array.from(pipelineStagesContainer?.querySelectorAll('.pipeline-stage-item') || []);
        const currentIndex = allStages.findIndex(s => s.id === stageId);

        if (currentIndex > 0) {
            const currentBranchToggle = document.getElementById(`${stageId}_branchToggle`);
            const isCurrentBranch = currentBranchToggle?.dataset.state === 'on';

            for (let i = currentIndex - 1; i >= 0; i--) {
                const prevStage = allStages[i];
                const prevBranchToggle = document.getElementById(`${prevStage.id}_branchToggle`);
                const isPrevBranch = prevBranchToggle?.dataset.state === 'on';

                if (!isCurrentBranch && isPrevBranch) continue;

                const prevDimensions = getStageDimensions(prevStage.id);
                if (prevDimensions) return prevDimensions;
            }
        }

        if (manualSelectedResolution === 'custom') {
            const manualWidth = document.getElementById('manualWidth');
            const manualHeight = document.getElementById('manualHeight');
            if (manualWidth && manualHeight) {
                return {
                    width: parseInt(manualWidth.value) || 1024,
                    height: parseInt(manualHeight.value) || 1024
                };
            }
        } else if (manualSelectedResolution) {
            return getDimensionsFromResolution(manualSelectedResolution);
        }
        return null;
    };

    const resolutionInput = document.getElementById(`${stageId}_resolution`);
    if (!resolutionInput || !resolutionInput.value) {
        return getInputDimensions();
    }

    // Check if area-based resolution (normal/large/xlarge without underscore)
    if (!resolutionInput.value.includes('_') && resolutionInput.value !== 'custom') {
        // Area-based: calculate from input dimensions
        const inputDimensions = getInputDimensions();
        if (inputDimensions) {
            const w = inputDimensions.width;
            const h = inputDimensions.height;
            const aspectRatio = Math.abs(w / h - 1.0) < 0.1 ? 'square' : (h > w ? 'portrait' : 'landscape');
            const newResolution = `${resolutionInput.value}_${aspectRatio}`;
            return getDimensionsFromResolution(newResolution) || inputDimensions;
        }
        return inputDimensions;
    }

    // Full preset or custom: same for all types
    if (resolutionInput.value === 'custom') {
        const widthInput = document.getElementById(`${stageId}_width`);
        const heightInput = document.getElementById(`${stageId}_height`);
        if (widthInput && heightInput) {
            return {
                width: parseInt(widthInput.value) || 1024,
                height: parseInt(heightInput.value) || 1024
            };
        }
    }

    return getDimensionsFromResolution(resolutionInput.value);
}

// Update up/down button disabled states based on position
function updateStageButtonStates() {
    const allStages = Array.from(pipelineStagesContainer?.querySelectorAll('.pipeline-stage-item') || []);
    const stageCount = allStages.length;

    allStages.forEach((stage, index) => {
        const stageId = stage.id;
        const upscaleToggle = document.getElementById(`${stageId}_upscaleToggle`);
        const stopToggle = document.getElementById(`${stageId}_stopToggle`);

        const isLastStage = index === stageCount - 1;

        // Handle stop toggle - disable/hide for last stage
        if (stopToggle) {
            if (isLastStage) {
                stopToggle.disabled = true;
                // If it was on, turn it off
                if (stopToggle.dataset.state === 'on') {
                    stopToggle.dataset.state = 'off';
                }
            } else {
                stopToggle.disabled = false;
            }
        }

        // Handle upscale toggle visibility and disabled state
        const saveResultsToggle = document.getElementById(`${stageId}_saveResultsToggle`);
        if (isLastStage) {
            // Final stage: show upscale only if available for resolution (save is enforced by server)
            if (upscaleToggle) {
                // Check if upscaling is available for this stage's resolution
                const stageDimensions = getStageDimensions(stageId);
                if (stageDimensions) {
                    const upscaleInfo = calculateUpscaleInfo(stageDimensions.width, stageDimensions.height);
                    if (upscaleInfo.available) {
                        upscaleToggle.disabled = false;
                        upscaleToggle.title = 'Enable upscaling';
                    } else {
                        upscaleToggle.disabled = true;
                        upscaleToggle.title = 'Upscaling not available';
                        if (upscaleToggle.dataset.state === 'on') {
                            upscaleToggle.dataset.state = 'off';
                        }
                    }
                } else {
                    // Can't determine dimensions, default to shown and enabled
                    upscaleToggle.disabled = true;
                    upscaleToggle.title = 'Upscaling not available';
                }
            }
        } else {
            // Non-final stages: show upscale only if save is enabled AND upscaling is available
            if (upscaleToggle && saveResultsToggle) {
                if (saveResultsToggle.dataset.state === 'on') {
                    // Check if upscaling is available for this stage's resolution
                    const stageDimensions = getStageDimensions(stageId);
                    if (stageDimensions) {
                        const upscaleInfo = calculateUpscaleInfo(stageDimensions.width, stageDimensions.height);
                        if (upscaleInfo.available) {
                            upscaleToggle.disabled = false;
                            upscaleToggle.title = 'Enable upscaling';
                        } else {
                            upscaleToggle.disabled = true;
                            upscaleToggle.title = 'Upscaling not available';
                            // Turn off the toggle if it was on
                            if (upscaleToggle.dataset.state === 'on') {
                                upscaleToggle.dataset.state = 'off';
                            }
                        }
                    } else {
                        // Can't determine dimensions, default to shown and enabled
                        upscaleToggle.disabled = true;
                        upscaleToggle.title = 'Upscaling not available';
                    }
                } else {
                    upscaleToggle.disabled = true;
                    upscaleToggle.title = 'Upscaling not available';
                }
            }
        }
    });
}

// Update all pipeline stages' inherited values when manual controls change
let updateStagesInheritedTimeout = null;
function updateAllStagesInheritedValues() {
    // Debounce to avoid excessive updates
    if (updateStagesInheritedTimeout) {
        clearTimeout(updateStagesInheritedTimeout);
    }

    updateStagesInheritedTimeout = setTimeout(() => {
        const allStages = Array.from(pipelineStagesContainer?.querySelectorAll('.pipeline-stage-item') || []);

        // Update all stages (both expand canvas and enhance have advanced controls)
        allStages.forEach(stage => {
            updateStageInheritedDisplay(stage.id);
        });

        updateStagesInheritedTimeout = null;
    }, 100);
}

// Update downstream stages' inherited values when a stage's values change
let updateDownstreamInheritedTimeout = null;
function updateDownstreamStagesInheritedValues(stageId) {
    // Debounce to avoid excessive updates
    if (updateDownstreamInheritedTimeout) {
        clearTimeout(updateDownstreamInheritedTimeout);
    }

    updateDownstreamInheritedTimeout = setTimeout(() => {
        const allStages = Array.from(pipelineStagesContainer?.querySelectorAll('.pipeline-stage-item') || []);
        const currentIndex = allStages.findIndex(s => s.id === stageId);

        if (currentIndex === -1) return;

        // Update all downstream stages (both expand canvas and enhance have advanced controls)
        for (let i = currentIndex + 1; i < allStages.length; i++) {
            const stage = allStages[i];
            updateStageInheritedDisplay(stage.id);
        }

        updateDownstreamInheritedTimeout = null;
    }, 100);
}

// Consolidated function to update stage seed input display
function updateStageSeedDisplay(stageId, inheritedValues = null) {
    const seedInput = document.getElementById(`${stageId}_seed`);
    const inheritSeedToggle = document.getElementById(`${stageId}_inheritSeedToggle`);
    const autoSeedToggle = document.getElementById(`${stageId}_autoSeedToggle`);

    if (!seedInput) return;

    const isInheritMode = inheritSeedToggle?.dataset.state === 'on';
    const isAutoMode = autoSeedToggle?.dataset.state === 'on';
    const loadedSeed = seedInput.dataset.loadedSeed;

    // Priority: loadedSeed from generation > inherited value from previous stage
    let seedToDisplay = loadedSeed;

    // Only calculate inherited value if no loadedSeed AND in inherit mode
    if (!seedToDisplay && isInheritMode) {
        if (!inheritedValues) {
            inheritedValues = getStageInheritedValues(stageId);
        }
        seedToDisplay = inheritedValues.seed;
    }

    if (isInheritMode) {
        // INHERIT MODE: Show seed in placeholder, keep input disabled and empty
        seedInput.disabled = true;
        seedInput.value = '';
        if (seedToDisplay !== null && seedToDisplay !== undefined) {
            seedInput.placeholder = seedToDisplay.toString();
        } else {
            seedInput.placeholder = 'Inherited';
        }
    } else if (isAutoMode) {
        // AUTO MODE: Show loaded seed in placeholder, keep input enabled and empty
        seedInput.disabled = false;
        seedInput.value = '';
        if (loadedSeed) {
            seedInput.placeholder = loadedSeed;
        } else {
            seedInput.placeholder = 'Random';
        }
    } else {
        // LOCKED MODE: Show loaded seed in value, keep input disabled
        seedInput.disabled = true;
        if (loadedSeed) {
            seedInput.value = loadedSeed;
            seedInput.placeholder = loadedSeed;
        } else {
            // No loaded seed: check if there's an inherited seed to show
            if (!inheritedValues) {
                inheritedValues = getStageInheritedValues(stageId);
            }
            if (inheritedValues.seed !== null && inheritedValues.seed !== undefined) {
                seedInput.value = inheritedValues.seed.toString();
                seedInput.placeholder = inheritedValues.seed.toString();
            } else {
                seedInput.value = '';
                seedInput.placeholder = 'Random';
            }
        }
    }
}

// Update inherited display for a specific stage
function updateStageInheritedDisplay(stageId) {
    const inheritedValues = getStageInheritedValues(stageId);

    // Update placeholders
    const stepsInput = document.getElementById(`${stageId}_steps`);
    const guidanceInput = document.getElementById(`${stageId}_guidance`);
    const rescaleInput = document.getElementById(`${stageId}_rescale`);
    const rescaleOverlay = document.getElementById(`${stageId}_rescaleOverlay`);

    if (stepsInput && stepsInput.value === '') {
        stepsInput.placeholder = inheritedValues.steps.toString();
    }
    if (guidanceInput && guidanceInput.value === '') {
        guidanceInput.placeholder = inheritedValues.guidance >= 10 ? 10 : inheritedValues.guidance.toFixed(1);
    }
    if (rescaleInput && rescaleInput.value === '' && rescaleOverlay) {
        rescaleOverlay.textContent = `${(inheritedValues.rescale * 100).toFixed(0)}%`;
        const rescaleContainer = rescaleInput.parentElement;
        if (rescaleContainer) rescaleContainer.classList.add('inherited');
    }

    // Update variety button if not custom
    const varietyBtn = document.getElementById(`${stageId}_varietyBtn`);

    // Only update variety if using inherited values
    if (varietyBtn) {
        varietyBtn.dataset.state = inheritedValues.variety ? 'on' : 'off';
    }

    // Update background focus inherited state
    const bgFocusToggle = document.getElementById(`${stageId}_bgFocusToggle`);
    if (bgFocusToggle) {
        const currentState = bgFocusToggle.dataset.state;
        if (currentState === '') {
            // Currently inheriting - show inherited state
            updateStageBackgroundFocusVisuals(stageId, inheritedValues.backgroundFocus, true);
        } else if (currentState === 'on') {
            // Explicitly enabled
            updateStageBackgroundFocusVisuals(stageId, true, false);
        } else {
            // Explicitly disabled (off)
            updateStageBackgroundFocusVisuals(stageId, false, false);
        }
    }

    // Update seed input display - consolidated function
    updateStageSeedDisplay(stageId, inheritedValues);

    // Update dropdown inherited state
    updateStageDropdownInheritedState(stageId);

    // Update reset button visibility
    updateStageResetButtonVisibility(stageId);
}

// Get inherited values for a stage from manual modal or previous stage
function getStageInheritedValues(stageId) {
    const allStages = Array.from(pipelineStagesContainer?.querySelectorAll('.pipeline-stage-item') || []);
    const currentIndex = allStages.findIndex(s => s.id === stageId);

    if (currentIndex === -1) {
        // Fallback to manual modal values
        return getManualModalValues();
    }

    // First stage inherits from manual modal
    if (currentIndex === 0) {
        const manualValues = getManualModalValues();

        // Check if this stage has its own loaded seed (from generation) - override manual modal seed
        const currentSeedInput = document.getElementById(`${stageId}_seed`);
        if (currentSeedInput?.dataset.loadedSeed) {
            manualValues.seed = parseInt(currentSeedInput.dataset.loadedSeed);
        }

        // Ensure isFirstStage is set (getManualModalValues already sets it, but make it explicit)
        manualValues.isFirstStage = true;

        return manualValues;
    }

    // Check if current stage is a branch
    const currentStage = allStages[currentIndex];
    const currentBranchToggle = document.getElementById(`${stageId}_branchToggle`);
    const isCurrentBranch = currentBranchToggle?.dataset.state === 'on';

    // Find previous stage with advanced controls (expand canvas or enhance)
    // If current stage is NOT a branch, skip over any branch stages to find the last non-branch stage
    for (let i = currentIndex - 1; i >= 0; i--) {
        const prevStage = allStages[i];
        const prevStageType = prevStage.dataset.stageType;

        // Check if previous stage is a branch
        const prevBranchToggle = document.getElementById(`${prevStage.id}_branchToggle`);
        const isPrevBranch = prevBranchToggle?.dataset.state === 'on';

        // If current stage is NOT a branch, skip branch stages when looking for inheritance
        if (!isCurrentBranch && isPrevBranch) {
            continue; // Skip this branch stage
        }

        // Both expand canvas and enhance can provide advanced values
        if (prevStageType === STAGE_TYPES.EXPAND_CANVAS || prevStageType === STAGE_TYPES.ENHANCE || prevStageType === STAGE_TYPES.VARIATION) {
            const prevStageId = prevStage.id;

            // Get effective values from previous stage (custom or its inherited)
            const prevInherited = getStageInheritedValues(prevStageId);

            // Helper to get value or inherited (handles 0 properly)
            const getValueOrInherited = (element, parser, inheritedValue) => {
                if (!element || element.value === '') return inheritedValue;
                return parser ? parser(element.value) : element.value;
            };

            // Extract resolution size from full resolution string (e.g., "normal_square" -> "normal")
            const extractResolutionSize = (resolutionString, widthInput, heightInput) => {
                if (!resolutionString) return 'normal';

                // Handle custom resolution by calculating area
                if (resolutionString === 'custom' && widthInput && heightInput) {
                    const width = parseInt(widthInput.value) || 1024;
                    const height = parseInt(heightInput.value) || 1024;
                    const area = width * height;

                    // Map area to resolution size based on actual preset maximums
                    if (area <= 1048576) return 'normal';      // ≤ 1MP (normal_square: 1024×1024)
                    if (area <= 2166784) return 'large';       // ≤ 2.16MP (large_square: 1472×1472)
                    return 'xlarge';                           // > 2.16MP
                }

                const parts = resolutionString.toLowerCase().split('_');
                return parts[0] || 'normal'; // Return prefix (normal, large, xlarge, wallpaper, etc.)
            };

            // Get resolution from previous stage
            let inheritedResolution = prevInherited.resolution;

            // Read unified resolution value
            const resolutionInput = document.getElementById(`${prevStageId}_resolution`);
            const prevStageType = prevStage.dataset.stageType;
            const isPrevEnhanceStage = (prevStageType === STAGE_TYPES.ENHANCE || prevStageType === STAGE_TYPES.VARIATION);

            // Check if previous stage is in enhance mode (using area-based resolution)
            if (isPrevEnhanceStage) {
                const prevUseBaseToggle = document.getElementById(`${prevStageId}_useBaseImageToggle`);
                const isPrevEnhanceMode = prevUseBaseToggle && prevUseBaseToggle.dataset.state === 'on';

                if (isPrevEnhanceMode) {
                    let areaName;
                    if (resolutionInput && resolutionInput.value !== '' && resolutionInput.value !== 'custom') {
                        areaName = resolutionInput.value; // e.g., "normal"
                    } else {
                        if (prevInherited.resolution) {
                            if (prevInherited.resolution.includes('_')) {
                                areaName = prevInherited.resolution.split('_')[0];
                            } else if (['normal', 'large', 'xlarge'].includes(prevInherited.resolution)) {
                                areaName = prevInherited.resolution;
                            } else {
                                areaName = 'normal'; // Fallback
                            }
                        } else {
                            areaName = 'normal'; // Default fallback
                        }
                    }

                    // Get the actual dimensions that the previous stage produced
                    const prevDimensions = getStageDimensions(prevStageId);
                    if (prevDimensions) {
                        // Determine aspect ratio from those dimensions
                        const w = prevDimensions.width;
                        const h = prevDimensions.height;
                        let aspectRatio = 'square';
                        if (Math.abs(w / h - 1.0) < 0.1) {
                            aspectRatio = 'square';
                        } else if (h > w) {
                            aspectRatio = 'portrait';
                        } else {
                            aspectRatio = 'landscape';
                        }
                        // Return full resolution string with orientation
                        inheritedResolution = `${areaName}_${aspectRatio}`;
                    } else {
                        // Fallback to just area name if we can't get dimensions
                        inheritedResolution = areaName;
                    }
                } else {
                    // Previous stage is in variation mode
                    if (resolutionInput && resolutionInput.value !== '') {
                        // Has custom value - use directly
                        inheritedResolution = resolutionInput.value;
                    } else if (prevInherited.resolution) {
                        // Using inherited value - use it directly (full preset or custom)
                        inheritedResolution = prevInherited.resolution;
                    }
                    // If no value at all, inheritedResolution stays as prevInherited.resolution
                }
            } else {
                // Previous stage is expand canvas or other type
                if (resolutionInput && resolutionInput.value !== '') {
                    // Has custom value - use directly
                    inheritedResolution = resolutionInput.value;
                } else if (prevInherited.resolution) {
                    // Using inherited value - extract size prefix for area-based inheritance
                    // This is used when current stage is enhance and needs area from expand canvas
                    const widthInput = document.getElementById(`${prevStageId}_width`);
                    const heightInput = document.getElementById(`${prevStageId}_height`);
                    inheritedResolution = extractResolutionSize(prevInherited.resolution, widthInput, heightInput);
                }
                // If no value at all, inheritedResolution stays as prevInherited.resolution
            }

            // Get seed value from previous stage
            const prevSeedInput = document.getElementById(`${prevStageId}_seed`);
            const prevInheritSeedToggle = document.getElementById(`${prevStageId}_inheritSeedToggle`);
            let inheritedSeed = null;

            // Priority order: explicit value > loaded seed > inherited seed
            if (prevSeedInput) {
                if (prevSeedInput.value) {
                    // Has explicit value (locked seed) - highest priority
                    inheritedSeed = parseInt(prevSeedInput.value);
                } else if (prevSeedInput.dataset.loadedSeed) {
                    // Has loaded seed from generation - use this even if stage is inheriting
                    inheritedSeed = parseInt(prevSeedInput.dataset.loadedSeed);
                } else if (prevInheritSeedToggle?.dataset.state === 'on') {
                    // No explicit or loaded seed, but is inheriting - use its inherited value
                    inheritedSeed = prevInherited.seed;
                } else if (prevSeedInput.placeholder && prevSeedInput.placeholder !== 'Random' && prevSeedInput.placeholder !== 'Inherited' && !isNaN(parseInt(prevSeedInput.placeholder))) {
                    // Has seed in placeholder
                    inheritedSeed = parseInt(prevSeedInput.placeholder);
                }
            }

            // Get background focus from previous stage
            const prevBgFocusToggle = document.getElementById(`${prevStageId}_bgFocusToggle`);
            const inheritedBackgroundFocus = prevBgFocusToggle?.dataset.state === 'on' || prevInherited.backgroundFocus || false;

            return {
                model: getValueOrInherited(document.getElementById(`${prevStageId}_model`), null, prevInherited.model),
                steps: getValueOrInherited(document.getElementById(`${prevStageId}_steps`), parseInt, prevInherited.steps),
                guidance: getValueOrInherited(document.getElementById(`${prevStageId}_guidance`), parseFloat, prevInherited.guidance),
                rescale: getValueOrInherited(document.getElementById(`${prevStageId}_rescale`), parseFloat, prevInherited.rescale),
                sampler: getValueOrInherited(document.getElementById(`${prevStageId}_sampler`), null, prevInherited.sampler),
                noiseScheduler: getValueOrInherited(document.getElementById(`${prevStageId}_noiseScheduler`), null, prevInherited.noiseScheduler),
                variety: document.getElementById(`${prevStageId}_varietyBtn`)?.dataset.state === 'on',
                resolution: inheritedResolution,
                seed: inheritedSeed,
                backgroundFocus: inheritedBackgroundFocus,
                isFirstStage: currentIndex === 0 // Include stage position info
            };
        }
    }

    // Fallback to manual modal values
    return getManualModalValues();
}

// Get values from manual modal
function getManualModalValues() {
    // Extract resolution size from full resolution string (e.g., "normal_square" -> "normal")
    const extractResolutionSize = (resolutionString) => {
        if (!resolutionString) return 'normal';

        // Handle custom resolution by calculating area
        if (resolutionString === 'custom' && manualWidth && manualHeight) {
            const width = parseInt(manualWidth.value) || 1024;
            const height = parseInt(manualHeight.value) || 1024;
            const area = width * height;

            // Map area to resolution size based on actual preset maximums
            if (area <= 1048576) return 'normal';      // ≤ 1MP (normal_square: 1024×1024)
            if (area <= 2166784) return 'large';       // ≤ 2.16MP (large_square: 1472×1472)
            return 'xlarge';                           // > 2.16MP
        }

        const parts = resolutionString.toLowerCase().split('_');
        return parts[0] || 'normal'; // Return prefix (normal, large, xlarge, wallpaper, etc.)
    };

    // Get seed value from manual modal
    let manualSeedValue = null;
    if (manualSeed) {
        if (manualSeed.value) {
            manualSeedValue = parseInt(manualSeed.value);
        } else if (manualSeed.dataset.loadedSeed) {
            manualSeedValue = parseInt(manualSeed.dataset.loadedSeed);
        } else if (manualSeed.placeholder && manualSeed.placeholder !== 'Randomize' && !isNaN(parseInt(manualSeed.placeholder))) {
            manualSeedValue = parseInt(manualSeed.placeholder);
        }
    }

    return {
        model: manualSelectedModel || 'v4_5',
        steps: parseInt(manualSteps?.value) || 25,
        guidance: parseFloat(manualGuidance?.value) || 5.0,
        rescale: parseFloat(manualRescale?.value) || 0.0,
        sampler: manualSelectedSampler || 'k_euler_ancestral',
        noiseScheduler: manualSelectedNoiseScheduler || 'karras',
        variety: varietyEnabled || false,
        resolution: extractResolutionSize(manualSelectedResolution), // Extract size from resolution
        seed: manualSeedValue,
        backgroundFocus: false, // Manual modal doesn't have background focus
        isFirstStage: true // When inheriting from manual, treat as first stage
    };
}

// Clear all pipeline stages
function clearPipelineStages() {
    if (pipelineStagesContainer) {
        pipelineStagesContainer.innerHTML = '';
    }
    pipelineStageCounter = 0;

    // Hide and reset saveStage0Btn
    if (saveStage0Btn) {
        saveStage0Btn.classList.add('hidden');
        saveStage0Btn.dataset.state = 'off';
    }
    // bracketGenNotifyTrayChrome: public/scripts/comp/bracketGenerationApplet.js
    if (typeof bracketGenNotifyTrayChrome === 'function') {
        bracketGenNotifyTrayChrome();
    }
}

// Update saveStage0Btn visibility based on whether there are stages
function updateSaveStage0BtnVisibility() {
    if (!saveStage0Btn) return;

    const hasStages = pipelineStagesContainer?.querySelectorAll('.pipeline-stage-item').length > 0;
    const stageGenerationEnabled = enableStageGenerationBtn?.dataset.state !== 'off';

    // Treat as no stages if stage generation is disabled
    if (hasStages && stageGenerationEnabled) {
        saveStage0Btn.classList.remove('hidden');
        // Update manual upscale visibility based on saveStage0Btn state
        updateManualUpscaleVisibility();
    } else {
        saveStage0Btn.classList.add('hidden');
        // No stages - always show manual upscale
        const manualUpscale = document.getElementById('manualUpscale');
        if (manualUpscale) {
            manualUpscale.classList.remove('hidden');
        }
    }
}

// Update pipeline stages header visibility
function updatePipelineStagesHeaderVisibility() {
    if (!pipelineStagesHeader) return;

    const hasStages = pipelineStagesContainer?.querySelectorAll('.pipeline-stage-item').length > 0;

    if (hasStages) {
        pipelineStagesHeader.classList.remove('hidden');
        enableStageGenerationBtn.classList.remove('hidden');
        windowEnableStageGenerationBtn.classList.remove('hidden');
    } else {
        pipelineStagesHeader.classList.add('hidden');
        enableStageGenerationBtn.classList.add('hidden');
        windowEnableStageGenerationBtn.classList.add('hidden');
        enableStageGenerationBtn.dataset.state = 'on';
        windowEnableStageGenerationBtn.dataset.state = 'on';
    }
}

// Update manual upscale button visibility based on pipeline state
function updateManualUpscaleVisibility() {
    const manualUpscale = document.getElementById('manualUpscale');
    if (!manualUpscale || !saveStage0Btn) return;

    const hasStages = pipelineStagesContainer?.querySelectorAll('.pipeline-stage-item').length > 0;
    const stageGenerationEnabled = enableStageGenerationBtn?.dataset.state !== 'off';

    // Get current dimensions for upscale availability check
    let width = 1024;
    let height = 1024;
    const selectedRes = manualSelectedResolution;

    if (selectedRes === 'custom') {
        const manualWidth = document.getElementById('manualWidth');
        const manualHeight = document.getElementById('manualHeight');
        width = manualWidth ? parseInt(manualWidth.value) || 1024 : 1024;
        height = manualHeight ? parseInt(manualHeight.value) || 1024 : 1024;
    } else if (selectedRes) {
        const dimensions = getDimensionsFromResolution(selectedRes);
        if (dimensions) {
            width = dimensions.width;
            height = dimensions.height;
        }
    }

    // Check upscale availability
    const upscaleInfo = calculateUpscaleInfo(width, height);

    // Treat as no stages if stage generation is disabled
    if (hasStages && stageGenerationEnabled) {
        // Has stages - show upscale only if saveStage0Btn is on AND upscaling is available
        if (saveStage0Btn.dataset.state === 'on' && upscaleInfo.available) {
            manualUpscale.classList.remove('hidden');
        } else {
            manualUpscale.classList.add('hidden');
        }
    } else {
        // No stages - show upscale only if upscaling is available for current resolution
        if (upscaleInfo.available) {
            manualUpscale.classList.remove('hidden');
        } else {
            manualUpscale.classList.add('hidden');
        }
    }
}

// Whether a pipeline stage requires output from a prior stage (expand / img2img variation)
function stageRequiresChaining(stageData) {
    if (!stageData) return true;
    if (stageData.type === STAGE_TYPES.EXPAND_CANVAS) return true;
    return stageData.useBaseImage !== false;
}

function getSavedPipelinePreviewFilename() {
    const preview = window.currentManualPreviewImage;
    if (preview) {
        return preview.original || preview.filename || preview.base || null;
    }
    if (compareSourceImageData?.chainSourceFile) {
        return compareSourceImageData.chainSourceFile;
    }
    return null;
}

function getSavedPreviewStageIndex() {
    const resolved = resolvePipelineStageIndexFromMetadata(window.currentManualPreviewImage?.metadata);
    if (resolved !== null) return resolved;
    const seeds = window.lastGenerationStageSeeds;
    if (seeds?.length) {
        return seeds.length;
    }
    return null;
}

function canUseSavedStageData(targetStageIndex) {
    if (targetStageIndex <= 0) return false;
    const stages = getPipelineStages();
    const targetData = stages[targetStageIndex - 1];
    if (!targetData || !stageRequiresChaining(targetData)) return false;

    const priorIndex = targetStageIndex - 1;
    const previewStage = getSavedPreviewStageIndex();
    const seedsLen = window.lastGenerationStageSeeds?.length || 0;
    const filename = getSavedPipelinePreviewFilename();

    if (!filename) return false;
    if (previewStage !== null && previewStage >= priorIndex) return true;
    if (seedsLen >= priorIndex) return true;
    return false;
}

function estimateTargetedStageCount(targetStageIndex) {
    if (targetStageIndex === 0) return 1;
    const stages = getPipelineStages();
    const targetData = stages[targetStageIndex - 1];
    if (!targetData) return targetStageIndex + 1;
    if (!stageRequiresChaining(targetData)) return 1;
    if (canUseSavedStageData(targetStageIndex)) {
        const previewStage = getSavedPreviewStageIndex();
        const priorIdx = targetStageIndex - 1;
        if (previewStage !== null && previewStage < priorIdx) {
            return priorIdx - previewStage + 1;
        }
        return 1;
    }
    return targetStageIndex + 1;
}

function getPipelineStageMenuLabel(stageIndex) {
    if (stageIndex === 0) {
        return { text: 'Stage 0 — Base', hex: '00', icon: 'nai-sparkles' };
    }
    const stageItems = pipelineStagesContainer?.querySelectorAll('.pipeline-stage-item');
    const stageItem = stageItems?.[stageIndex - 1];
    if (!stageItem) {
        return { text: `Stage ${stageIndex}`, hex: '??', icon: 'fas fa-layer-group' };
    }
    const hexEl = stageItem.querySelector('.stage-hex-id');
    const hex = hexEl?.textContent?.trim() || calculateStageHexId(stageItem);
    const customName = getPipelineStageDisplayName(stageItem);
    let typeName = customName || 'Stage';
    if (!customName) {
        const typeLabel = document.getElementById(`${stageItem.id}_typeLabel`);
        if (typeLabel) {
            const clone = typeLabel.cloneNode(true);
            clone.querySelector('.stage-hex-id')?.remove();
            clone.querySelector('.stage-managed-hammer')?.remove();
            clone.querySelector('.stage-name-editable')?.remove();
            typeName = clone.textContent.replace(/\s+/g, ' ').trim() || 'Stage';
        }
    }
    let icon = 'ri-image-ai-fill';
    const stageType = stageItem.dataset.stageType;
    if (stageType === STAGE_TYPES.EXPAND_CANVAS) {
        icon = 'mdi mdi-1-25 mdi-relative-scale';
    } else if (stageType === STAGE_TYPES.VARIATION) {
        const useBaseBtn = document.getElementById(`${stageItem.id}_useBaseImageToggle`);
        icon = useBaseBtn?.dataset.state === 'on' ? 'fas fa-diagram-venn' : 'ri-image-ai-fill';
    }
    return { text: `Stage ${stageIndex} — ${typeName}`, hex, icon };
}

// Get pipeline stages data
function getPipelineStages() {
    const stages = [];
    const stageItems = pipelineStagesContainer?.querySelectorAll('.pipeline-stage-item');

    if (!stageItems) return stages;

    stageItems.forEach(stageItem => {
        const stageId = stageItem.id;
        const stageType = stageItem.dataset.stageType;

        if (stageType === STAGE_TYPES.EXPAND_CANVAS) {
            stages.push(getExpandCanvasStageData(stageId));
        } else if (stageType === STAGE_TYPES.ENHANCE) {
            // Legacy: map to variation useBaseImage=true
            const data = getEnhanceStageData(stageId);
            if (data) {
                data.type = STAGE_TYPES.VARIATION;
                data.useBaseImage = true;
            }
            stages.push(data);
        } else if (stageType === STAGE_TYPES.VARIATION) {
            stages.push(getEnhanceStageData(stageId));
        }
    });

    return stages;
}

// Load pipeline stages from data
function loadPipelineStages(stagesArray, stageSeeds = null) {
    clearPipelineStages();

    if (!stagesArray || !Array.isArray(stagesArray)) return;

    stagesArray.forEach((stageData, index) => {
        if (stageData.type === STAGE_TYPES.EXPAND_CANVAS) {
            addPipelineStage(STAGE_TYPES.EXPAND_CANVAS);
            const stageId = `stage_${pipelineStageCounter - 1}`; // Calculate after adding stage

            // Pass the seed from stage_seeds array
            const stageSeed = stageSeeds && stageSeeds[index] ? stageSeeds[index] : null;
            loadExpandCanvasStageData(stageId, stageData, stageSeed);
        } else if (stageData.type === STAGE_TYPES.ENHANCE || stageData.type === STAGE_TYPES.VARIATION) {
            // Migrate legacy enhance to variation with useBaseImage=true
            const useBaseImage = stageData.type === STAGE_TYPES.ENHANCE ? true : (stageData.useBaseImage !== false);
            addPipelineStage(STAGE_TYPES.VARIATION, { useBaseImage });
            const stageId = `stage_${pipelineStageCounter - 1}`; // Calculate after adding stage

            // Pass the seed from stage_seeds array
            const stageSeed = stageSeeds && stageSeeds[index] ? stageSeeds[index] : null;
            loadEnhanceStageData(stageId, { ...stageData, type: STAGE_TYPES.VARIATION, useBaseImage }, stageSeed);
        }
    });

    // Ensure only one stage has stopAtStage enabled (keep the last one that was marked)
    const allStages = Array.from(pipelineStagesContainer?.querySelectorAll('.pipeline-stage-item') || []);
    let lastStopStageId = null;
    allStages.forEach(stage => {
        const stopToggle = document.getElementById(`${stage.id}_stopToggle`);
        if (stopToggle && stopToggle.dataset.state === 'on') {
            lastStopStageId = stage.id;
        }
    });

    // Turn off all stop toggles except the last one found
    if (lastStopStageId) {
        allStages.forEach(stage => {
            const stopToggle = document.getElementById(`${stage.id}_stopToggle`);
            if (stopToggle && stage.id !== lastStopStageId) {
                stopToggle.dataset.state = 'off';
            }
        });
    }

    // Update button states after loading all stages
    updateStageButtonStates();
    enforceManagedStageSandwichRules();
}

// Update existing stages with seeds from stage_seeds array
function updateStagesWithSeeds(stageSeeds) {
    if (!stageSeeds || !Array.isArray(stageSeeds) || stageSeeds.length === 0) {
        console.log('⚠️ No stage seeds provided');
        return;
    }

    const stageItems = pipelineStagesContainer?.querySelectorAll('.pipeline-stage-item');
    if (!stageItems || stageItems.length === 0) {
        console.log('⚠️ No pipeline stages found in UI');
        return;
    }

    // First pass: Load all seeds into dataset and update non-inherited stages
    stageItems.forEach((stageItem, index) => {
        const stageId = stageItem.id;
        // stageSeeds array contains ONLY pipeline stage seeds (NO base generation)
        // stageSeeds[0] = first pipeline stage, stageSeeds[1] = second pipeline stage, etc.
        const stageSeed = stageSeeds[index];

        if (stageSeed && stageSeed.seed !== undefined) {
            const autoSeedToggle = document.getElementById(`${stageId}_autoSeedToggle`);
            const seedInput = document.getElementById(`${stageId}_seed`);

            if (autoSeedToggle && seedInput) {
                // Store loaded seed in dataset (always, regardless of inherit mode)
                seedInput.dataset.loadedSeed = stageSeed.seed.toString();

                // Check if we're in inherit mode
                const inheritSeedToggle = document.getElementById(`${stageId}_inheritSeedToggle`);
                const isInheritMode = inheritSeedToggle && inheritSeedToggle.dataset.state === 'on';

                if (!isInheritMode) {
                    // Only update seed controls if not in inherit mode
                    autoSeedToggle.classList.remove('hidden');

                    // Check current auto seed toggle state to maintain consistency with manual seed behavior
                    const currentAutoSeedState = autoSeedToggle.dataset.state;

                    if (currentAutoSeedState === 'off') {
                        // Locked mode: set value, keep disabled, update placeholder
                        seedInput.value = stageSeed.seed.toString();
                        seedInput.disabled = true;
                        seedInput.placeholder = stageSeed.seed.toString();
                    } else {
                        // Auto mode: clear value, make editable, show seed in placeholder
                        seedInput.value = '';
                        seedInput.disabled = false;
                        seedInput.placeholder = stageSeed.seed.toString();
                    }
                }
            } else {
                console.log(`🌱 ❌ Could not find seed controls for ${stageId}`);
            }
        } else {
            // No seed data for this stage (e.g., generation stopped before this stage)
            // Clear the dataset.loadedSeed since this stage didn't run
            const seedInput = document.getElementById(`${stageId}_seed`);
            if (seedInput) {
                delete seedInput.dataset.loadedSeed;
            }
            console.log(`🌱 ⚠️ No seed data for ${stageId} at index ${index}`);
        }
    });

    stageItems.forEach((stageItem) => {
        const stageId = stageItem.id;
        updateStageInheritedDisplay(stageId);
    });
}

// Render expand canvas stage
function renderExpandCanvasStage(stageId) {
    const stageBody = document.getElementById(`${stageId}_body`);
    if (!stageBody) return;

    stageBody.innerHTML = `
        <div class="stage-controls-section stage-expand">
            <div class="form-row justify-spaced">
                <div class="group-controls-container">
                    <div class="form-group group-resolution">
                        <label for="${stageId}_resolution">
                            <span>Resolution</span>
                            <span id="${stageId}_resolutionAreaToggle" class="label-right-toggle hidden" title="Toggle between Normal (1MP) and Large (3MP) area limit">Normal</span>
                        </label>
                        <div class="resolution-group">
                            <div id="${stageId}_resolutionDropdown" class="custom-dropdown dropup">
                                <button type="button" id="${stageId}_resolutionDropdownBtn" class="custom-dropdown-btn hover-show colored">
                                    <span id="${stageId}_resolutionSelected">---</span>
                                </button>
                                <div id="${stageId}_resolutionDropdownMenu" class="custom-dropdown-menu hidden"></div>
                            </div>
                            <input type="hidden" id="${stageId}_resolution" value="">
                            <button type="button" id="${stageId}_insetToggle" class="btn-secondary btn-small toggle-btn hidden" data-state="on" title="Inset source when output is larger">
                                <i class="fas fa-border-none"></i>
                            </button>
                            <div id="${stageId}_customResolution" class="custom-resolution-inputs hidden">
                                <button type="button" id="${stageId}_customResolutionBtn" class="btn-secondary toggle-btn" data-state="off" title="Custom Resolution">
                                    <i class="fas fa-ruler-combined"></i>
                                </button>
                                <input type="number" id="${stageId}_width" class="colored form-control hover-show width-value" placeholder="Width" min="64" step="64">
                                <span class="x-seperator">
                                    <i class="fa-xmark-large fas"></i>
                                </span>
                                <input type="number" id="${stageId}_height" class="colored form-control hover-show height-value" placeholder="Height" min="64" step="64">
                            </div>
                        </div>
                    </div>
                    <div class="form-group group-bias">
                        <label for="${stageId}_bias">Position</label>
                        <div id="${stageId}_biasDropdown" class="custom-dropdown dropup">
                            <button type="button" id="${stageId}_biasDropdownBtn" class="custom-dropdown-btn hover-show colored">
                                <div class="mask-bias-button-content">
                                    <div class="mask-bias-grid" id="${stageId}_biasGrid" data-bias="2" data-orientation="landscape">
                                        ${Array(22).fill('<div class="grid-cell"></div>').join('')}
                                    </div>
                                    <i id="${stageId}_bgFocusIcon" class="fas fa-tree-city hidden"></i>
                                    <span id="${stageId}_biasSelected">Center</span>
                                </div>
                            </button>
                            <div id="${stageId}_biasDropdownMenu" class="custom-dropdown-menu hidden"></div>
                        </div>
                        <input type="hidden" id="${stageId}_bgFocusToggle" data-state="">
                    </div>
                </div>
                <div class="form-group group-seed">
                    <input type="hidden" id="${stageId}_bias" value="2">
                    <label for="${stageId}_seed">Seed</label>
                    <div style="display: flex; gap: 8px; align-items: center;">
                        <input type="number" id="${stageId}_seed" class="form-control hover-show colored right" placeholder="Inherited" style="flex: 1; width: 120px;" disabled>
                        <button type="button" id="${stageId}_autoSeedToggle" class="btn-secondary toggle-btn toggle_seed hidden" data-state="on">
                            <i class="fas fa-seedling"></i>
                        </button>
                        <button type="button" id="${stageId}_inheritSeedToggle" class="btn-secondary toggle-btn toggle_inherit_seed" data-state="on" title="Inherit seed from previous stage">
                            <i class="fas fa-link-simple"></i>
                        </button>
                    </div>
                </div>
            </div>
            <div id="${stageId}_advancedControls" class="stage-advanced-controls hidden">
                <div class="form-row">
                    <div class="form-group group-steps">
                        <label for="${stageId}_steps">Steps</label>
                        <input type="number" id="${stageId}_steps" class="form-control hover-show colored" min="1" max="50" placeholder="25">
                    </div>
                    <div class="form-group group-guidance">
                        <label for="${stageId}_guidance">Guidance</label>
                        <div class="guidance-group" style="display: flex; align-items: center; gap: 6px;">
                            <input type="number" id="${stageId}_guidance" class="form-control hover-show colored" min="0.0" max="10.0" step="0.1" placeholder="5.0">
                            <button type="button" id="${stageId}_varietyBtn" class="btn-secondary toggle-btn toggle_variety" title="Enable Variety+" data-state="off">
                                <i class="fas fa-sparkle"></i>
                            </button>
                        </div>
                    </div>
                    <div class="form-group group-rescale">
                        <label for="${stageId}_rescale">Rescale</label>
                        <div class="percentage-input-container hover-show colored">
                            <span id="${stageId}_rescaleOverlay" class="percentage-input-overlay">0%</span>
                            <input type="number" id="${stageId}_rescale" class="form-control" min="0.00" max="1.00" step="0.01">
                        </div>
                    </div>
                    <div class="form-group group-sampler">
                        <label for="${stageId}_sampler">Sampler</label>
                        <div id="${stageId}_samplerDropdown" class="custom-dropdown dropup dropright">
                            <button type="button" id="${stageId}_samplerDropdownBtn" class="custom-dropdown-btn hover-show colored">
                                <span id="${stageId}_samplerSelected">Select sampler...</span>
                            </button>
                            <div id="${stageId}_samplerDropdownMenu" class="custom-dropdown-menu hidden"></div>
                        </div>
                        <input type="hidden" id="${stageId}_sampler" value="">
                        <input type="hidden" id="${stageId}_noiseScheduler" value="">
                    </div>
                    <div class="form-group group-model">
                        <label for="${stageId}_model">Model</label>
                        <div id="${stageId}_modelDropdown" class="custom-dropdown dropup">
                            <button type="button" id="${stageId}_modelDropdownBtn" class="custom-dropdown-btn hover-show colored right">
                                <span id="${stageId}_modelSelected">Select model...</span>
                            </button>
                            <div id="${stageId}_modelDropdownMenu" class="custom-dropdown-menu hidden"></div>
                        </div>
                        <input type="hidden" id="${stageId}_model" value="">
                    </div>
                </div>
                <div class="form-group group-creative-directive hidden">
                    <div class="form-group">
                        <textarea id="${stageId}_creativeDirective" class="form-control hover-show colored" placeholder="Dear Kamisama..." rows="1" autocapitalize="false"></textarea>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Event listeners wired via wirePipelineStageControls (pipelineStageControls.js)
}

// setupExpandCanvasStageEvents → public/scripts/comp/pipelineStageControls.js (Phase 1 removal manifest)


// setupStageCustomResolutionControls → public/scripts/comp/pipelineStageControls.js (Phase 1 removal manifest)


// Check if stage has any custom advanced values and update reset button visibility
function updateStageResetButtonVisibility(stageId) {
    const resetBtn = document.getElementById(`${stageId}_resetAdvanced`);
    if (!resetBtn) return;

    const inheritedValues = getStageInheritedValues(stageId);
    const varietyBtn = document.getElementById(`${stageId}_varietyBtn`);

    // Check for custom resolution (both expand-canvas and variation/enhance stages have resolution inputs)
    const stageItem = document.getElementById(stageId);
    const stageType = stageItem?.dataset.stageType;
    const isStageWithResolution = stageType === STAGE_TYPES.EXPAND_CANVAS || stageType === STAGE_TYPES.VARIATION;
    const resolutionInput = document.getElementById(`${stageId}_resolution`);
    const hasResolutionCustom = isStageWithResolution && resolutionInput && resolutionInput.value !== '';

    // Check for background focus override
    const bgFocusToggle = document.getElementById(`${stageId}_bgFocusToggle`);
    const bgFocusState = bgFocusToggle?.dataset.state || '';
    // Only consider it custom if there's an explicit state that differs from inherited
    // Convert string state to boolean for comparison
    const bgFocusExplicitValue = bgFocusState === 'on';

    // Only show reset if:
    // - Has explicit state AND differs from inherited
    // - AND (not first stage OR inherited value is true - meaning a previous stage had it enabled)
    const hasBgFocusCustom = bgFocusState !== '' &&
        (bgFocusExplicitValue !== inheritedValues.backgroundFocus) &&
        (!inheritedValues.isFirstStage || inheritedValues.backgroundFocus === true);

    const hasCustomValues =
        document.getElementById(`${stageId}_model`)?.value !== '' ||
        document.getElementById(`${stageId}_sampler`)?.value !== '' ||
        document.getElementById(`${stageId}_steps`)?.value !== '' ||
        document.getElementById(`${stageId}_guidance`)?.value !== '' ||
        document.getElementById(`${stageId}_rescale`)?.value !== '' ||
        hasResolutionCustom ||
        hasBgFocusCustom ||
        (varietyBtn && ((varietyBtn.dataset.state === 'on') !== inheritedValues.variety));

    if (hasCustomValues) {
        resetBtn.classList.remove('hidden');
    } else {
        resetBtn.classList.add('hidden');
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
}

// Update stage creative directive visibility based on creative mode and advanced state
function updateStageCreativeDirectiveVisibility(stageId) {
    const creativeDirectiveGroup = document.querySelector(`#${stageId}_advancedControls .group-creative-directive`);
    if (!creativeDirectiveGroup) return;

    const creativeBtn = document.getElementById('creativeBtn');
    const isCreativeOn = creativeBtn && creativeBtn.dataset.state === 'on';

    if (isCreativeOn) {
        creativeDirectiveGroup.classList.remove('hidden');
    } else {
        creativeDirectiveGroup.classList.add('hidden');
    }
}

// Update inherited state for dropdowns
function updateStageDropdownInheritedState(stageId) {
    const inheritedValues = getStageInheritedValues(stageId);

    const modelInput = document.getElementById(`${stageId}_model`);
    const modelBtn = document.getElementById(`${stageId}_modelDropdownBtn`);
    const samplerInput = document.getElementById(`${stageId}_sampler`);
    const samplerBtn = document.getElementById(`${stageId}_samplerDropdownBtn`);

    // Update model dropdown
    if (modelInput && modelBtn) {
        if (modelInput.value === '') {
            // Using inherited value - add inherited class and show inherited value
            modelBtn.classList.add('inherited');
            selectStageModel(stageId, inheritedValues.model, null, true);
        } else {
            // Has custom value - remove inherited class
            modelBtn.classList.remove('inherited');
        }
    }

    // Update sampler dropdown
    if (samplerInput && samplerBtn) {
        const noiseSchedulerInput = document.getElementById(`${stageId}_noiseScheduler`);

        if (samplerInput.value === '') {
            // Using inherited value - add inherited class and show inherited value
            samplerBtn.classList.add('inherited');

            // Temporarily set values to display inherited, then clear
            const tempSampler = inheritedValues.sampler;
            const tempNoise = inheritedValues.noiseScheduler;
            samplerInput.value = tempSampler;
            if (noiseSchedulerInput) noiseSchedulerInput.value = tempNoise;

            updateStageSamplerDisplay(stageId);

            // Clear the actual values to maintain inherited state
            samplerInput.value = '';
            if (noiseSchedulerInput) noiseSchedulerInput.value = '';
        } else {
            // Has custom value - remove inherited class
            samplerBtn.classList.remove('inherited');
        }
    }

    // Update resolution dropdown (works generically for all stage types)
    const resolutionInput = document.getElementById(`${stageId}_resolution`);
    const resolutionBtn = document.getElementById(`${stageId}_resolutionDropdownBtn`);

    if (resolutionInput && resolutionBtn && inheritedValues.resolution) {
        const currentValue = resolutionInput.value || '';

        // Use inherited if input is empty (never set for inherited items)
        if (currentValue === '') {
            // Using inherited value - determine if it's area-based or full preset
            resolutionBtn.classList.add('inherited');

            // Check if resolution is area name (no underscore) or full preset
            const isAreaName = !inheritedValues.resolution.includes('_') &&
                inheritedValues.resolution !== 'custom' &&
                ['normal', 'large', 'xlarge'].includes(inheritedValues.resolution);

            if (isAreaName) {
                // Area-based: show area name
                selectStageEnhanceResolution(stageId, inheritedValues.resolution, true);
            } else {
                // Full preset: use directly (inheritedValues.resolution already has orientation)
                selectStageResolution(stageId, inheritedValues.resolution, null, true);
            }
        } else {
            // Has custom value - remove inherited class
            resolutionBtn.classList.remove('inherited');
        }
    }

    updateStageResetButtonVisibility(stageId);
}

// Render enhance/variation stage. Supports Enhance toggle (useBaseImage)
function renderEnhanceStage(stageId, options = {}) {
    const stageBody = document.getElementById(`${stageId}_body`);
    if (!stageBody) return;
    const initialUseBaseImage = options.useBaseImage === true;

    stageBody.innerHTML = `
        <div class="stage-controls-section enhance-stage">
            <div class="form-row justify-spaced">
                <div class="group-controls-container">
                    <div class="form-group group-use-base-image">
                        <label for="${stageId}_useBaseImageToggle">Mode</label>
                        <div>
                            <button type="button" id="${stageId}_useBaseImageToggle" class="btn-secondary toggle-btn" data-state="${initialUseBaseImage ? 'on' : 'off'}">
                                <i class="fas fa-diagram-venn"></i>
                            </button>
                        </div>
                    </div>
                    <div class="form-group group-magnitude${initialUseBaseImage ? '' : ' hidden'}">
                        <label for="${stageId}_magnitude">Level</label>
                        <input type="number" id="${stageId}_magnitude" class="form-control hover-show colored" min="1.0" max="5.5" step="0.5">
                    </div>
                    <div class="form-group group-strength${initialUseBaseImage ? '' : ' hidden'}">
                        <label for="${stageId}_strength">Strength</label>
                        <div class="percentage-input-container hover-show colored">
                            <span id="${stageId}_strengthOverlay" class="percentage-input-overlay">50%</span>
                            <input type="number" id="${stageId}_strength" class="form-control" min="0.00" max="1.00" step="0.01">
                        </div>
                    </div>
                    <div class="form-group group-noise${initialUseBaseImage ? '' : ' hidden'}">
                        <label for="${stageId}_noise">Noise</label>
                        <div class="percentage-input-container hover-show colored">
                            <span id="${stageId}_noiseOverlay" class="percentage-input-overlay">0%</span>
                            <input type="number" id="${stageId}_noise" class="form-control" min="0.00" max="1.00" step="0.01">
                        </div>
                    </div>
                    
                    <div class="form-group group-resolution">
                        <label for="${stageId}_resolution">
                            <span>Resolution</span>
                            <span id="${stageId}_resolutionAreaToggle" class="label-right-toggle hidden" title="Toggle between Normal (1MP) and Large (3MP) area limit">Normal</span>
                        </label>
                        <div class="resolution-group">
                            <div id="${stageId}_resolutionDropdown" class="custom-dropdown dropup">
                                <button type="button" id="${stageId}_resolutionDropdownBtn" class="custom-dropdown-btn hover-show colored">
                                    <span id="${stageId}_resolutionSelected">---</span>
                            </button>
                                <div id="${stageId}_resolutionDropdownMenu" class="custom-dropdown-menu hidden"></div>
                        </div>
                            <input type="hidden" id="${stageId}_resolution" value="">
                            <div id="${stageId}_customResolution" class="custom-resolution-inputs hidden">
                                <button type="button" id="${stageId}_customResolutionBtn" class="btn-secondary toggle-btn" data-state="off" title="Custom Resolution">
                                    <i class="fas fa-ruler-combined"></i>
                                </button>
                                <input type="number" id="${stageId}_width" class="colored form-control hover-show width-value" placeholder="Width" min="64" step="64">
                                <span class="x-seperator">
                                    <i class="fa-xmark-large fas"></i>
                                </span>
                                <input type="number" id="${stageId}_height" class="colored form-control hover-show height-value" placeholder="Height" min="64" step="64">
                            </div>
                        </div>
                    </div>
                </div>
                <div class="form-group group-seed">
                    <label for="${stageId}_seed">Seed</label>
                    <div style="display: flex; gap: 8px; align-items: center;">
                        <input type="number" id="${stageId}_seed" class="form-control hover-show colored right" placeholder="Inherited" style="flex: 1; width: 120px;" disabled>
                        <button type="button" id="${stageId}_autoSeedToggle" class="btn-secondary toggle-btn toggle_seed hidden" data-state="on">
                            <i class="fas fa-seedling"></i>
                        </button>
                        <button type="button" id="${stageId}_inheritSeedToggle" class="btn-secondary toggle-btn toggle_inherit_seed" data-state="on" title="Inherit seed from previous stage">
                            <i class="fas fa-link-simple"></i>
                        </button>
                    </div>
                </div>
            </div>
            <div id="${stageId}_advancedControls" class="stage-advanced-controls hidden">
                <div class="form-row">
                    <div class="form-group group-steps">
                        <label for="${stageId}_steps">Steps</label>
                        <input type="number" id="${stageId}_steps" class="form-control hover-show colored" min="1" max="50" placeholder="25">
                    </div>
                    <div class="form-group group-guidance">
                        <label for="${stageId}_guidance">Guidance</label>
                        <div class="guidance-group" style="display: flex; align-items: center; gap: 6px;">
                            <input type="number" id="${stageId}_guidance" class="form-control hover-show colored" min="0.0" max="10.0" step="0.1" placeholder="5.0">
                            <button type="button" id="${stageId}_varietyBtn" class="btn-secondary toggle-btn toggle_variety" title="Enable Variety+" data-state="off">
                                <i class="fas fa-sparkle"></i>
                            </button>
                        </div>
                    </div>
                    <div class="form-group group-rescale">
                        <label for="${stageId}_rescale">Rescale</label>
                        <div class="percentage-input-container hover-show colored">
                            <span id="${stageId}_rescaleOverlay" class="percentage-input-overlay">0%</span>
                            <input type="number" id="${stageId}_rescale" class="form-control" min="0.00" max="1.00" step="0.01">
                        </div>
                    </div>
                    <div class="form-group group-sampler">
                        <label for="${stageId}_sampler">Sampler</label>
                        <div id="${stageId}_samplerDropdown" class="custom-dropdown dropup dropright">
                            <button type="button" id="${stageId}_samplerDropdownBtn" class="custom-dropdown-btn hover-show colored">
                                <span id="${stageId}_samplerSelected">Select sampler...</span>
                            </button>
                            <div id="${stageId}_samplerDropdownMenu" class="custom-dropdown-menu hidden"></div>
                        </div>
                        <input type="hidden" id="${stageId}_sampler" value="">
                        <input type="hidden" id="${stageId}_noiseScheduler" value="">
                    </div>
                    <div class="form-group group-model">
                        <label for="${stageId}_model">Model</label>
                        <div id="${stageId}_modelDropdown" class="custom-dropdown dropup">
                            <button type="button" id="${stageId}_modelDropdownBtn" class="custom-dropdown-btn hover-show colored right">
                                <span id="${stageId}_modelSelected">Select model...</span>
                            </button>
                            <div id="${stageId}_modelDropdownMenu" class="custom-dropdown-menu hidden"></div>
                        </div>
                        <input type="hidden" id="${stageId}_model" value="">
                    </div>
                </div>
                <div class="form-group group-creative-directive hidden">
                    <div class="form-group">
                        <textarea id="${stageId}_creativeDirective" class="form-control hover-show colored" placeholder="Dear Kamisama..." rows="1" autocapitalize="false" autocorrect="false"></textarea>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Event listeners wired via wirePipelineStageControls (pipelineStageControls.js)
}

// setupEnhanceStageEvents → public/scripts/comp/pipelineStageControls.js (Phase 1 removal manifest)


// setupStageAdvancedControls → public/scripts/comp/pipelineStageControls.js (Phase 1 removal manifest)

// Get the base resolution for a stage (first stage uses manual, others use previous stage)
function getStageBaseResolution(stageId) {
    const allStages = Array.from(pipelineStagesContainer?.querySelectorAll('.pipeline-stage-item') || []);
    const currentIndex = allStages.findIndex(s => s.id === stageId);

    if (currentIndex === -1) return manualSelectedResolution || 'normal_square';

    // First expand canvas stage uses manual resolution
    if (currentIndex === 0) {
        return manualSelectedResolution || 'normal_square';
    }

    // Check if current stage is a branch
    const currentStage = allStages[currentIndex];
    const currentBranchToggle = document.getElementById(`${stageId}_branchToggle`);
    const isCurrentBranch = currentBranchToggle?.dataset.state === 'on';

    // Find previous expand canvas stage
    for (let i = currentIndex - 1; i >= 0; i--) {
        const prevStage = allStages[i];

        // Check if previous stage is a branch
        const prevBranchToggle = document.getElementById(`${prevStage.id}_branchToggle`);
        const isPrevBranch = prevBranchToggle?.dataset.state === 'on';

        // If current stage is NOT a branch, skip branch stages
        if (!isCurrentBranch && isPrevBranch) {
            continue;
        }

        if (prevStage.dataset.stageType === STAGE_TYPES.EXPAND_CANVAS) {
            const prevResolutionInput = document.getElementById(`${prevStage.id}_resolution`);
            if (prevResolutionInput && prevResolutionInput.value) {
                return prevResolutionInput.value;
            }
        }
    }

    // Fallback to manual resolution
    return manualSelectedResolution || 'normal_square';
}

// Check if this is the last expand canvas stage
function isLastExpandCanvasStage(stageId) {
    const allStages = Array.from(pipelineStagesContainer?.querySelectorAll('.pipeline-stage-item') || []);
    const currentIndex = allStages.findIndex(s => s.id === stageId);

    if (currentIndex === -1) return true;

    // Check if current stage is a branch
    const currentBranchToggle = document.getElementById(`${stageId}_branchToggle`);
    const isCurrentBranch = currentBranchToggle?.dataset.state === 'on';

    // Check if there are any expand canvas stages after this one (in the same chain)
    for (let i = currentIndex + 1; i < allStages.length; i++) {
        const stage = allStages[i];

        // Check if this stage is a branch
        const stageBranchToggle = document.getElementById(`${stage.id}_branchToggle`);
        const isStageBranch = stageBranchToggle?.dataset.state === 'on';

        // If current is branch, only look for more branches
        if (isCurrentBranch && !isStageBranch) {
            break; // Exited branch chain, stop looking
        }

        // If current is not branch, skip branches
        if (!isCurrentBranch && isStageBranch) {
            continue;
        }

        if (stage.dataset.stageType === STAGE_TYPES.EXPAND_CANVAS) {
            return false; // Found another expand canvas stage after this one in the same chain
        }
    }

    return true; // This is the last expand canvas stage in its chain
}

/** Pixel size of the image entering this expand-canvas stage (preset or custom); used to hide targets with the same aspect ratio. */
function getExpandCanvasStageBasePixelDimensions(stageId) {
    const baseResolutionValue = getStageBaseResolution(stageId);
    const currentResolution = RESOLUTIONS.find(r => r.value === baseResolutionValue);

    if (baseResolutionValue === 'custom') {
        const allStages = Array.from(pipelineStagesContainer?.querySelectorAll('.pipeline-stage-item') || []);
        const currentIndex = allStages.findIndex(s => s.id === stageId);
        const isFirstStage = currentIndex === 0 || !allStages.slice(0, currentIndex).some(s => s.dataset.stageType === STAGE_TYPES.EXPAND_CANVAS);

        if (isFirstStage) {
            const manualWidth = document.getElementById('manualWidth');
            const manualHeight = document.getElementById('manualHeight');
            if (manualWidth && manualHeight) {
                return {
                    width: parseInt(manualWidth.value, 10) || 1024,
                    height: parseInt(manualHeight.value, 10) || 1024
                };
            }
            return { width: 0, height: 0 };
        }

        const currentStageBranchToggle = document.getElementById(`${stageId}_branchToggle`);
        const isCurrentStageBranch = currentStageBranchToggle?.dataset.state === 'on';

        for (let i = currentIndex - 1; i >= 0; i--) {
            const prevStage = allStages[i];
            const prevBranchToggle = document.getElementById(`${prevStage.id}_branchToggle`);
            const isPrevBranch = prevBranchToggle?.dataset.state === 'on';
            if (!isCurrentStageBranch && isPrevBranch) continue;

            if (prevStage.dataset.stageType === STAGE_TYPES.EXPAND_CANVAS) {
                const prevResolutionInput = document.getElementById(`${prevStage.id}_resolution`);
                if (prevResolutionInput && prevResolutionInput.value === 'custom') {
                    const widthInput = document.getElementById(`${prevStage.id}_width`);
                    const heightInput = document.getElementById(`${prevStage.id}_height`);
                    if (widthInput && heightInput) {
                        return {
                            width: parseInt(widthInput.value, 10) || 1024,
                            height: parseInt(heightInput.value, 10) || 1024
                        };
                    }
                }
            }
        }
        return { width: 0, height: 0 };
    }

    if (currentResolution) {
        return { width: currentResolution.width, height: currentResolution.height };
    }

    return { width: 0, height: 0 };
}

/** Show expand-canvas inset control only when target output is strictly larger than incoming image on both axes. */
function updateExpandCanvasStageInsetToggle(stageId) {
    const stageItem = document.getElementById(stageId);
    if (!stageItem || stageItem.dataset.stageType !== STAGE_TYPES.EXPAND_CANVAS) return;

    const insetBtn = document.getElementById(`${stageId}_insetToggle`);
    if (!insetBtn) return;

    const base = getExpandCanvasStageBasePixelDimensions(stageId);
    const bw = base.width || 0;
    const bh = base.height || 0;

    const resInput = document.getElementById(`${stageId}_resolution`);
    const resVal = resInput?.value;
    let tw = 0;
    let th = 0;
    if (resVal === 'custom') {
        const wEl = document.getElementById(`${stageId}_width`);
        const hEl = document.getElementById(`${stageId}_height`);
        tw = parseInt(wEl?.value, 10) || 0;
        th = parseInt(hEl?.value, 10) || 0;
    } else if (resVal) {
        const d = getDimensionsFromResolution(resVal);
        if (d) {
            tw = d.width;
            th = d.height;
        }
    }

    const applicable = bw > 0 && bh > 0 && tw > 0 && th > 0 && tw > bw && th > bh;
    const wasHidden = insetBtn.classList.contains('hidden');
    if (applicable) {
        insetBtn.classList.remove('hidden');
        if (wasHidden) {
            insetBtn.dataset.state = 'on';
        }
    } else {
        insetBtn.classList.add('hidden');
        insetBtn.dataset.state = 'off';
    }
}

// Stage dropdown render functions
function renderStageResolutionDropdown(stageId, selectedValue) {
    const menu = document.getElementById(`${stageId}_resolutionDropdownMenu`);
    if (!menu) return;

    // If this stage is Variation with Enhance ON, render area options using grouped dropdown (preserves keyboard nav/inherited UX)
    const useBaseToggle = document.getElementById(`${stageId}_useBaseImageToggle`);
    if (useBaseToggle && useBaseToggle.dataset.state === 'on') {
        const groups = [
            {
                group: 'Area',
                options: [
                    { value: 'normal', name: 'Normal' },
                    { value: 'large', name: 'Large' },
                    { value: 'xlarge', name: 'Maximum' }
                ]
            }
        ];
        renderGroupedDropdown(
            menu,
            groups,
            (value) => selectStageEnhanceResolution(stageId, value),
            () => closeDropdown(menu, document.getElementById(`${stageId}_resolutionDropdownBtn`)),
            selectedValue,
            (opt) => `<span>${opt.name}</span>`
        );
        return;
    }

    // Check if this is a variation stage (not enhance mode) - should show all resolutions
    const isVariationMode = useBaseToggle && useBaseToggle.dataset.state === 'off';

    const { width: baseWidth, height: baseHeight } = getExpandCanvasStageBasePixelDimensions(stageId);

    // Filter RESOLUTION_GROUPS: hide presets with the same aspect ratio as the base (exact rational match)
    const filteredGroups = RESOLUTION_GROUPS.map(group => {
        const filteredOptions = group.options.filter(opt => {
            // Keep custom resolution option
            if (opt.value === 'custom') return true;

            // Variation mode: no filtering, show all resolutions
            if (isVariationMode) return true;

            // Always exclude small resolutions
            if (opt.value.startsWith('small_')) {
                return false;
            }

            if (samePixelAspectRatio(baseWidth, baseHeight, opt.width, opt.height)) {
                return false;
            }

            return true;
        });

        return {
            ...group,
            options: filteredOptions
        };
    }).filter(group => group.options.length > 0); // Remove empty groups

    renderGroupedDropdown(
        menu,
        filteredGroups,
        (value, group) => selectStageResolution(stageId, value, group),
        () => closeDropdown(menu, document.getElementById(`${stageId}_resolutionDropdownBtn`)),
        selectedValue,
        (opt, group) => `<span>${opt.name}${opt.dims ? ' <span style="opacity:0.7;font-size:0.95em;">(' + opt.dims + ')</span>' : ''}</span>`
    );
}

function selectStageResolution(stageId, value, group, isInheritedDisplay = false) {
    const resolutionInput = document.getElementById(`${stageId}_resolution`);
    const resolutionSelected = document.getElementById(`${stageId}_resolutionSelected`);
    const resolutionDropdown = document.getElementById(`${stageId}_resolutionDropdown`);
    const resolutionBtn = document.getElementById(`${stageId}_resolutionDropdownBtn`);
    const customResolution = document.getElementById(`${stageId}_customResolution`);
    const customResolutionBtn = document.getElementById(`${stageId}_customResolutionBtn`);
    const widthInput = document.getElementById(`${stageId}_width`);
    const heightInput = document.getElementById(`${stageId}_height`);
    const areaToggle = document.getElementById(`${stageId}_resolutionAreaToggle`);

    if (!resolutionInput || !resolutionSelected) return;

    // Check if this is a variation stage in enhance mode (enhance mode shows area names)
    const stageItem = document.getElementById(stageId);
    const isVariationStage = stageItem?.dataset.stageType === STAGE_TYPES.VARIATION;
    const useBaseToggle = document.getElementById(`${stageId}_useBaseImageToggle`);
    const isEnhanceMode = isVariationStage && useBaseToggle && useBaseToggle.dataset.state === 'on';

    // For inherited display, do NOT set value, just mark as inherited
    if (isInheritedDisplay) {
        if (resolutionBtn) resolutionBtn.classList.add('inherited');

        // Enhance mode should show area name (only variation stages in enhance mode)
        if (isEnhanceMode && value.includes('_') && value !== 'custom') {
            const areaName = value.split('_')[0];
            const displayMap = { normal: 'Normal', large: 'Large', xlarge: 'Maximum' };
            resolutionSelected.innerHTML = `<span class="custom-dropdown-text">${displayMap[areaName] || 'Normal'}</span>`;
            return;
        }

        // Find group and option for display
        if (!group) {
            for (const g of RESOLUTION_GROUPS) {
                const found = g.options.find(o => o.value === value.toLowerCase());
                if (found) {
                    group = g.group;
                    break;
                }
            }
        }

        const groupObj = RESOLUTION_GROUPS.find(g => g.group === group);
        const optObj = groupObj ? groupObj.options.find(o => o.value === value.toLowerCase()) : null;
        if (optObj) {
            const badge = groupObj.badge ? `<span class="custom-dropdown-badge${groupObj.free ? ' free-badge' : ''}">${groupObj.badge}</span>` : '';
            resolutionSelected.innerHTML = `<span class="custom-dropdown-text">${optObj.name}</span>${badge}`;
        } else {
            resolutionSelected.textContent = '---';
        }
        return;
    }

    // Handle custom resolution mode
    if (value === 'custom') {
        resolutionDropdown.classList.add('hidden');
        customResolution.classList.remove('hidden');
        customResolutionBtn.setAttribute('data-state', 'on');
        if (areaToggle) areaToggle.classList.remove('hidden');

        // Initialize stage max area if not set (using dataset)
        if (!areaToggle.dataset.maxArea) {
            areaToggle.dataset.maxArea = '1048576'; // Default to Normal (1MP)
        }

        // Update toggle display
        if (areaToggle) {
            const maxArea = parseInt(areaToggle.dataset.maxArea);
            if (maxArea === 3047424) {
                areaToggle.textContent = 'Max';
            } else if (maxArea === 2166784) {
                areaToggle.textContent = 'Large';
            } else {
                areaToggle.textContent = 'Normal';
            }
        }

        // Only convert from previous resolution if width/height are not already set
        // This preserves loaded values when loading from saved pipeline stages
        const hasExistingValues = widthInput.value && heightInput.value;

        if (!hasExistingValues) {
            // Get current stage dimensions (handles inherited values too)
            const currentDimensions = getStageDimensions(stageId);
            if (currentDimensions) {
                widthInput.value = currentDimensions.width;
                heightInput.value = currentDimensions.height;
            } else {
                // Fallback: try to get from current resolution value
                const currentResolution = resolutionInput.value;
                if (currentResolution && currentResolution !== 'custom') {
                    const dimensions = getDimensionsFromResolution(currentResolution);
                    if (dimensions) {
                        widthInput.value = dimensions.width;
                        heightInput.value = dimensions.height;
                    }
                }

                // Final fallback to 1024x1024
                if (!widthInput.value || !heightInput.value) {
                    widthInput.value = '1024';
                    heightInput.value = '1024';
                }
            }
        }

        resolutionInput.value = 'custom';
        if (resolutionBtn) resolutionBtn.classList.remove('inherited');

        // Update functions
        updateStageResetButtonVisibility(stageId);
        updateStageDropdownInheritedState(stageId);
        updateStageBiasOrientation(stageId, value);

        // Update this stage and all downstream stages
        updatePipelineStages(stageId);
        updateExpandCanvasStageInsetToggle(stageId);
        return;
    }

    // Find group if not provided
    if (!group) {
        for (const g of RESOLUTION_GROUPS) {
            const found = g.options.find(o => o.value === value.toLowerCase());
            if (found) {
                group = g.group;
                break;
            }
        }
    }

    // Update button display
    // Enhance mode should show area name (only variation stages in enhance mode)
    if (isEnhanceMode && value.includes('_') && value !== 'custom') {
        const areaName = value.split('_')[0];
        const displayMap = { normal: 'Normal', large: 'Large', xlarge: 'Maximum' };
        resolutionInput.value = value.toLowerCase();
        resolutionSelected.innerHTML = `<span class="custom-dropdown-text">${displayMap[areaName] || 'Normal'}</span>`;
    } else {
        const groupObj = RESOLUTION_GROUPS.find(g => g.group === group);
        const optObj = groupObj ? groupObj.options.find(o => o.value === value.toLowerCase()) : null;

        // ALWAYS set the value - critical for updateStageResetButtonVisibility to detect custom value
        resolutionInput.value = value.toLowerCase();

        if (optObj) {
            const badge = groupObj.badge ? `<span class="custom-dropdown-badge${groupObj.free ? ' free-badge' : ''}">${groupObj.badge}</span>` : '';
            resolutionSelected.innerHTML = `<span class="custom-dropdown-text">${optObj.name}</span>${badge}`;
        } else {
            resolutionSelected.textContent = '---';
        }
    }

    // Remove inherited class since we're setting a custom value
    if (resolutionBtn) resolutionBtn.classList.remove('inherited');

    updateStageDropdownInheritedState(stageId);
    updateStageBiasOrientation(stageId, value);

    // Update this stage and all downstream stages
    updatePipelineStages(stageId);
    updateExpandCanvasStageInsetToggle(stageId);
}

// Toggle resolution area limit for a stage between normal (1MP) and large (3MP)
function toggleStageResolutionAreaLimit(stageId) {
    const areaToggle = document.getElementById(`${stageId}_resolutionAreaToggle`);
    const resolutionInput = document.getElementById(`${stageId}_resolution`);
    const widthInput = document.getElementById(`${stageId}_width`);
    const heightInput = document.getElementById(`${stageId}_height`);

    if (!areaToggle || !resolutionInput || resolutionInput.value !== 'custom') return;

    // Initialize stage max area if not set (using dataset)
    if (!areaToggle.dataset.maxArea) {
        areaToggle.dataset.maxArea = '1048576'; // Default to Normal (1MP)
    }

    const currentMaxArea = parseInt(areaToggle.dataset.maxArea);

    // Only recalculate if custom resolution is selected and has valid dimensions
    if (widthInput && heightInput && widthInput.value && heightInput.value) {
        const currentWidth = parseInt(widthInput.value) || 1024;
        const currentHeight = parseInt(heightInput.value) || 1024;

        let newMaxArea;
        let newAreaName;

        // Toggle between Normal (1MP) → Large (2MP) → Max (3MP)
        if (currentMaxArea === 1048576) {
            newMaxArea = 2166784; // Large (2MP)
            newAreaName = 'Large';
        } else if (currentMaxArea === 2166784) {
            newMaxArea = 3047424; // Max (3MP)
            newAreaName = 'Max';
        } else {
            newMaxArea = 1048576; // Normal (1MP)
            newAreaName = 'Normal';
        }

        const snapped = dimensionsMaxUnderArea(currentWidth, currentHeight, newMaxArea, 64, UTILS_CONFIG.MIN_DIMENSION, UTILS_CONFIG.MIN_DIMENSION);
        const result = correctDimensions(snapped.width, snapped.height, {
            step: 64,
            maxArea: newMaxArea
        });

        // Update the max area in dataset AFTER calculation but BEFORE updating inputs
        areaToggle.dataset.maxArea = newMaxArea.toString();
        areaToggle.textContent = newAreaName;

        // Update inputs without triggering input events
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(widthInput, result.width);
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(heightInput, result.height);

        // Update bias orientation based on new dimensions
        updateStageBiasOrientation(stageId, 'custom');

        // Update downstream stages to reflect new custom dimensions
        updatePipelineStages(stageId);
        updateExpandCanvasStageInsetToggle(stageId);

        // Show feedback about the change
        showGlassToast('info', null, `Resolution scaled to ${result.width}x${result.height} (${newAreaName} area limit)`);
    } else {
        // No custom resolution selected, just toggle the limit
        if (currentMaxArea === 1048576) {
            areaToggle.dataset.maxArea = '2166784'; // Large (2MP)
            areaToggle.textContent = 'Large';
        } else if (currentMaxArea === 2166784) {
            areaToggle.dataset.maxArea = '3047424'; // Max (3MP)
            areaToggle.textContent = 'Max';
        } else {
            areaToggle.dataset.maxArea = '1048576'; // Normal (1MP)
            areaToggle.textContent = 'Normal';
        }
    }
}

// Update downstream stage resolutions based on cascade rules
function updateDownstreamStageResolutions(changedStageId, newResolution, fromManual = false) {
    const allStages = Array.from(pipelineStagesContainer?.querySelectorAll('.pipeline-stage-item') || []);
    let changedIndex = allStages.findIndex(s => s.id === changedStageId);

    // Special case: if cascading from manual resolution, treat all stages as downstream
    if (fromManual) {
        changedIndex = -1; // Start before the first stage
    } else if (changedIndex === -1) {
        return; // Stage not found and not from manual
    }

    // Get aspect ratio and orientation for a resolution (handles both custom and preset)
    const getResolutionInfo = (stageId, resValue) => {
        if (resValue === 'custom') {
            // Check if this is from manual (use manual inputs) or from a stage
            const widthInput = fromManual ?
                document.getElementById('manualWidth') :
                document.getElementById(`${stageId}_width`);
            const heightInput = fromManual ?
                document.getElementById('manualHeight') :
                document.getElementById(`${stageId}_height`);

            if (widthInput && heightInput && widthInput.value && heightInput.value) {
                const width = parseInt(widthInput.value);
                const height = parseInt(heightInput.value);
                const aspectRatio = width / height;
                let orientation = 'square';
                if (height > width * 1.05) orientation = 'portrait'; // 5% threshold
                else if (width > height * 1.05) orientation = 'landscape';
                return { width, height, aspectRatio, orientation, isCustom: true };
            }
            return null;
        } else {
            const res = RESOLUTIONS.find(r => r.value === resValue);
            if (!res) return null;
            const aspectRatio = res.width / res.height;
            let orientation = 'square';
            if (res.height > res.width) orientation = 'portrait';
            else if (res.width > res.height) orientation = 'landscape';
            return { width: res.width, height: res.height, aspectRatio, orientation, isCustom: false };
        }
    };

    // Determine next orientation based on current (flip logic)
    const getNextOrientation = (currentOrientation) => {
        if (currentOrientation === 'portrait') return 'square';
        if (currentOrientation === 'square') return 'landscape';
        if (currentOrientation === 'landscape') return 'square';
        return null;
    };

    // Find a resolution with the target orientation (prefer same group, then normal, then any)
    const findResolutionByOrientation = (targetOrientation, preferredGroup = 'Normal') => {
        const suffix = targetOrientation === 'portrait' ? '_portrait' :
            targetOrientation === 'landscape' ? '_landscape' : '_square';

        // Try preferred group first
        let found = RESOLUTIONS.find(r => r.value.startsWith(preferredGroup.toLowerCase() + suffix));
        if (found) return found.value;

        // Try normal group
        found = RESOLUTIONS.find(r => r.value.startsWith('normal' + suffix));
        if (found) return found.value;

        // Try any group
        found = RESOLUTIONS.find(r => r.value.endsWith(suffix) && !r.value.startsWith('small_'));
        if (found) return found.value;

        return null;
    };

    // Get info for the changed stage's resolution
    let previousInfo = getResolutionInfo(changedStageId, newResolution);
    if (!previousInfo) return;

    let previousOrientation = previousInfo.orientation;
    let previousAspectRatio = previousInfo.aspectRatio;

    // Check if the changed stage is a branch (or if we're cascading from manual)
    const changedBranchToggle = changedStageId ? document.getElementById(`${changedStageId}_branchToggle`) : null;
    const isChangedBranch = changedBranchToggle?.dataset.state === 'on';

    // Process each downstream expand canvas stage
    for (let i = changedIndex + 1; i < allStages.length; i++) {
        const stage = allStages[i];

        // Only update expand canvas stages
        if (stage.dataset.stageType !== STAGE_TYPES.EXPAND_CANVAS) continue;

        const stageId = stage.id;

        // Check if this downstream stage is a branch
        const stageBranchToggle = document.getElementById(`${stageId}_branchToggle`);
        const isStageBranch = stageBranchToggle?.dataset.state === 'on';

        // Skip branch cascade rules:
        // - If changed stage is a branch, only affect other branch stages
        // - If changed stage is NOT a branch (or manual), skip branch stages
        if (fromManual) {
            // From manual: skip branch stages
            if (isStageBranch) continue;
        } else if (isChangedBranch && !isStageBranch) {
            // Branch stage changed: don't affect non-branch stages
            break; // Stop cascading once we hit a non-branch
        } else if (!isChangedBranch && isStageBranch) {
            // Non-branch stage changed: skip branch stages
            continue;
        }
        const resolutionInput = document.getElementById(`${stageId}_resolution`);
        const resolutionSelected = document.getElementById(`${stageId}_resolutionSelected`);

        if (!resolutionInput || !resolutionSelected || !previousOrientation) {
            // Conflict: clear this and all downstream resolutions
            clearStageResolution(stageId);
            previousOrientation = null;
            continue;
        }

        // Calculate next orientation
        const nextOrientation = getNextOrientation(previousOrientation);
        if (!nextOrientation) {
            clearStageResolution(stageId);
            previousOrientation = null;
            continue;
        }

        // Check if current downstream stage is custom
        const isDownstreamCustom = resolutionInput.value === 'custom';

        if (isDownstreamCustom) {
            // Swap width and height for custom resolution (rotate aspect ratio)
            const widthInput = document.getElementById(`${stageId}_width`);
            const heightInput = document.getElementById(`${stageId}_height`);

            if (widthInput && heightInput && widthInput.value && heightInput.value) {
                const currentWidth = parseInt(widthInput.value);
                const currentHeight = parseInt(heightInput.value);
                const currentAspectRatio = currentWidth / currentHeight;

                // Check if aspect ratio difference is at least 5%
                const aspectRatioDiff = Math.abs(currentAspectRatio - previousAspectRatio) / previousAspectRatio;

                if (aspectRatioDiff < 0.05) {
                    // Not enough separation, swap width and height
                    const temp = currentWidth;
                    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(widthInput, currentHeight);
                    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(heightInput, temp);

                    // Update previous info for next iteration
                    previousAspectRatio = currentHeight / temp; // Swapped
                    previousOrientation = nextOrientation;

                    // Update bias orientation
                    updateStageBiasOrientation(stageId, 'custom');
                } else {
                    // Keep current dimensions, update previous info
                    previousAspectRatio = currentAspectRatio;
                    previousOrientation = nextOrientation;
                }
            }
        } else {
            // Check current resolution orientation
            const currentRes = RESOLUTIONS.find(r => r.value === resolutionInput.value);

            if (currentRes) {
                // Determine current resolution's orientation
                let currentOrientation = 'square';
                if (currentRes.height > currentRes.width) {
                    currentOrientation = 'portrait';
                } else if (currentRes.width > currentRes.height) {
                    currentOrientation = 'landscape';
                }

                // Check if current resolution already matches the required orientation
                if (currentOrientation === nextOrientation) {
                    // Current resolution is valid - keep it!
                    previousAspectRatio = currentRes.width / currentRes.height;
                    previousOrientation = nextOrientation;
                    continue; // Don't change this stage's resolution
                }
            }

            // Current resolution doesn't match - find a suitable one
            const preferredGroup = currentRes ? currentRes.value.split('_')[0] : 'normal';
            const newValue = findResolutionByOrientation(nextOrientation, preferredGroup);

            if (!newValue) {
                // No suitable resolution found - clear this and downstream
                clearStageResolution(stageId);
                previousOrientation = null;
                continue;
            }

            // Update this stage's resolution
            resolutionInput.value = newValue;
            const newRes = RESOLUTIONS.find(r => r.value === newValue);
            if (newRes) {
                // Find group for display
                let displayGroup = null;
                for (const g of RESOLUTION_GROUPS) {
                    if (g.options.find(o => o.value === newValue)) {
                        displayGroup = g;
                        break;
                    }
                }

                const opt = displayGroup?.options.find(o => o.value === newValue);
                if (opt && displayGroup) {
                    resolutionSelected.innerHTML = `${opt.name}${displayGroup.badge ? '<span class="custom-dropdown-badge' + (displayGroup.free ? ' free-badge' : '') + '">' + displayGroup.badge + '</span>' : ''}`;
                }

                // Update bias orientation
                updateStageBiasOrientation(stageId, newValue);

                // Update previous info for next iteration
                previousAspectRatio = newRes.width / newRes.height;
            }

            previousOrientation = nextOrientation;
        }
    }
}

/**
 * Refresh the displayed resolution text for a stage without triggering cascades
 * @param {string} stageId - The stage ID
 */
function refreshStageResolutionDisplay(stageId) {
    const resolutionInput = document.getElementById(`${stageId}_resolution`);
    const resolutionSelected = document.getElementById(`${stageId}_resolutionSelected`);
    const currentValue = resolutionInput?.value;

    if (!currentValue || !resolutionSelected) {
        return;
    }

    // Check if this is a variation stage in enhance mode (enhance mode shows area name)
    const stageItem = document.getElementById(stageId);
    const isVariationStage = stageItem?.dataset.stageType === STAGE_TYPES.VARIATION;
    const useBaseToggle = document.getElementById(`${stageId}_useBaseImageToggle`);
    const isEnhanceMode = isVariationStage && useBaseToggle && useBaseToggle.dataset.state === 'on';

    if (currentValue === 'custom') {
        resolutionSelected.innerHTML = '<span class="custom-dropdown-text">Custom</span>';
    } else if (isEnhanceMode && currentValue.includes('_') && currentValue !== 'custom') {
        // Enhance mode shows area name
        const areaName = currentValue.split('_')[0];
        const displayMap = { normal: 'Normal', large: 'Large', xlarge: 'Maximum' };
        resolutionSelected.innerHTML = `<span class="custom-dropdown-text">${displayMap[areaName] || 'Normal'}</span>`;
    } else {
        // Find the resolution group and option
        let displayGroup = null;
        for (const g of RESOLUTION_GROUPS) {
            if (g.options.find(o => o.value === currentValue)) {
                displayGroup = g;
                break;
            }
        }

        const opt = displayGroup?.options.find(o => o.value === currentValue);
        if (opt && displayGroup) {
            const badge = displayGroup.badge ? `<span class="custom-dropdown-badge${displayGroup.free ? ' free-badge' : ''}">${displayGroup.badge}</span>` : '';
            resolutionSelected.innerHTML = `<span class="custom-dropdown-text">${opt.name}</span>${badge}`;
        }
    }
}

// Clear a stage's resolution
function clearStageResolution(stageId) {
    const resolutionInput = document.getElementById(`${stageId}_resolution`);
    const resolutionSelected = document.getElementById(`${stageId}_resolutionSelected`);

    if (resolutionInput) resolutionInput.value = '';
    if (resolutionSelected) resolutionSelected.textContent = '---';
}

// Helper function to get orientation for a stage
function getStageOrientation(stageId) {
    const resolutionInput = document.getElementById(`${stageId}_resolution`);
    if (!resolutionInput) return false;

    if (resolutionInput.value === 'custom') {
        // Get custom dimensions from this stage's inputs
        const widthInput = document.getElementById(`${stageId}_width`);
        const heightInput = document.getElementById(`${stageId}_height`);
        if (widthInput && heightInput) {
            const width = parseInt(widthInput.value) || 1024;
            const height = parseInt(heightInput.value) || 1024;
            return height > width;
        }
    } else {
        // Use preset resolution
        const resolution = RESOLUTIONS.find(r => r.value === resolutionInput.value.toLowerCase());
        return resolution ? resolution.height > resolution.width : false;
    }
    return false;
}

function renderStageBiasDropdown(stageId, selectedValue) {
    const menu = document.getElementById(`${stageId}_biasDropdownMenu`);
    if (!menu) return;

    menu.innerHTML = '';

    // Get current background focus state
    const bgFocusToggle = document.getElementById(`${stageId}_bgFocusToggle`);
    const currentState = bgFocusToggle?.dataset.state || '';

    // Check if inherited
    const inheritedValues = getStageInheritedValues(stageId);
    const isInheriting = currentState === '';
    const isExplicitlyEnabled = currentState === 'on';
    const actualState = isInheriting ? inheritedValues.backgroundFocus : isExplicitlyEnabled;

    // Determine label based on state
    let label = 'Background Focus';
    if (isInheriting && inheritedValues.backgroundFocus) {
        label += '*'; // Inherited ON
    }

    // Add background focus toggle at the top
    const bgFocusOption = document.createElement('div');
    bgFocusOption.className = 'custom-dropdown-option' + (actualState ? ' active' : '');
    bgFocusOption.innerHTML = `
        <i class="fas fa-tree-city" style="margin-right: 8px;"></i>
        <span>${label}</span>
    `;
    bgFocusOption.style.display = 'flex';
    bgFocusOption.style.alignItems = 'center';

    bgFocusOption.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleStageBackgroundFocus(stageId);
        // Re-render to update the active state
        renderStageBiasDropdown(stageId, selectedValue);
    });

    menu.appendChild(bgFocusOption);

    // Add separator
    const separator = document.createElement('div');
    separator.className = 'custom-dropdown-separator';
    menu.appendChild(separator);

    // Determine orientation based on resolution
    const isPortrait = getStageOrientation(stageId);

    // Create 5 bias options based on resolution orientation (like image bias dropdown)
    const biasOptions = [
        { value: '0', name: isPortrait ? 'Top' : 'Left' },
        { value: '1', name: '⅖' + (isPortrait ? ' Top' : ' Left') },
        { value: '2', name: 'Center' },
        { value: '3', name: '⅘' + (isPortrait ? ' Bottom' : ' Right') },
        { value: '4', name: isPortrait ? 'Bottom' : 'Right' }
    ];

    biasOptions.forEach(opt => {
        const option = document.createElement('div');
        option.className = 'custom-dropdown-option' + (selectedValue === opt.value ? ' selected' : '');
        option.dataset.value = opt.value;
        option.textContent = opt.name;

        option.addEventListener('click', () => {
            selectStageBias(stageId, opt.value, opt.name, isPortrait);
            closeDropdown(menu, document.getElementById(`${stageId}_biasDropdownBtn`));
        });

        menu.appendChild(option);
    });
}

// Toggle background focus for a stage
function toggleStageBackgroundFocus(stageId) {
    const bgFocusToggle = document.getElementById(`${stageId}_bgFocusToggle`);
    if (!bgFocusToggle) return;

    const currentState = bgFocusToggle.dataset.state;
    const inheritedValues = getStageInheritedValues(stageId);

    let newState;
    if (currentState === '') {
        // Currently inheriting → check inherited value and toggle opposite
        if (inheritedValues.backgroundFocus) {
            // Inherited ON → set explicit OFF
            newState = 'off';
        } else {
            // Inherited OFF → set explicit ON
            newState = 'on';
        }
    } else {
        // Has explicit state → toggle it
        newState = currentState === 'on' ? 'off' : 'on';

        // If toggling back to match inherited value, clear explicit state
        if ((newState === 'on' && inheritedValues.backgroundFocus) ||
            (newState === 'off' && !inheritedValues.backgroundFocus)) {
            newState = ''; // Clear to inherit
        }
    }

    bgFocusToggle.dataset.state = newState;

    // Determine actual state for visuals
    const actualState = newState === '' ? inheritedValues.backgroundFocus : (newState === 'on');
    const isInherited = newState === '';

    // Update visual indicators
    updateStageBackgroundFocusVisuals(stageId, actualState, isInherited);

    // Update reset button visibility
    updateStageResetButtonVisibility(stageId);

    // Update downstream stages to reflect the change
    updateDownstreamStagesInheritedValues(stageId);
}

// Update visual indicators for background focus
function updateStageBackgroundFocusVisuals(stageId, isOn, isInherited = false) {
    const bgFocusIcon = document.getElementById(`${stageId}_bgFocusIcon`);
    const biasGrid = document.getElementById(`${stageId}_biasGrid`);

    if (bgFocusIcon) {
        // Toggle icon visibility
        if (isOn) {
            bgFocusIcon.classList.remove('hidden');
            // Add inherited class if it's inherited
            if (isInherited) {
                bgFocusIcon.classList.add('inherited');
            } else {
                bgFocusIcon.classList.remove('inherited');
            }
        } else {
            bgFocusIcon.classList.add('hidden');
            bgFocusIcon.classList.remove('inherited');
        }
    }

    if (biasGrid) {
        // Set theme to green when on
        if (isOn) {
            biasGrid.classList.add('theme-green');
        } else {
            biasGrid.classList.remove('theme-green');
        }
    }
}

function selectStageBias(stageId, value, name, isPortrait) {
    const biasInput = document.getElementById(`${stageId}_bias`);
    const biasSelected = document.getElementById(`${stageId}_biasSelected`);
    const biasGrid = document.getElementById(`${stageId}_biasGrid`);

    if (biasInput) biasInput.value = value;
    if (biasSelected) biasSelected.textContent = name;
    if (biasGrid) {
        biasGrid.dataset.bias = value;
    }

    // Update orientation using the centralized function
    const resolutionInput = document.getElementById(`${stageId}_resolution`);
    if (resolutionInput) {
        updateStageBiasOrientation(stageId, resolutionInput.value);
    }
}

function updateStageBiasOrientation(stageId, resolutionValue) {
    const biasSelected = document.getElementById(`${stageId}_biasSelected`);
    const biasInput = document.getElementById(`${stageId}_bias`);
    const biasGrid = document.getElementById(`${stageId}_biasGrid`);

    if (!biasSelected || !biasInput || !biasGrid) return;

    // Determine orientation using the helper function
    const isPortrait = getStageOrientation(stageId);

    // Set orientation: portrait or landscape (square images treated as landscape)
    biasGrid.dataset.orientation = isPortrait ? 'portrait' : 'landscape';

    // Update the label based on current bias value and new orientation
    const currentBias = biasInput.value !== '' ? biasInput.value : '2';
    const biasName = getBiasName(currentBias, isPortrait);
    biasSelected.textContent = biasName;
}

function renderStageModelDropdown(stageId, selectedValue) {
    const menu = document.getElementById(`${stageId}_modelDropdownMenu`);
    if (!menu) return;

    renderGroupedDropdown(
        menu,
        modelGroups,
        (value, group) => selectStageModel(stageId, value, group),
        () => closeDropdown(menu, document.getElementById(`${stageId}_modelDropdownBtn`)),
        selectedValue,
        (opt, group) => `<span>${opt.name}</span>`,
        { preventFocusTransfer: true }
    );
}

function selectStageModel(stageId, value, group, isInheritedDisplay = false) {
    const modelInput = document.getElementById(`${stageId}_model`);
    const modelSelected = document.getElementById(`${stageId}_modelSelected`);
    const modelBtn = document.getElementById(`${stageId}_modelDropdownBtn`);

    if (!modelInput || !modelSelected) return;

    // If group is not provided, find it automatically
    if (!group) {
        for (const g of modelGroups) {
            const found = g.options.find(o => o.value === value.toLowerCase());
            if (found) {
                group = g.group;
                break;
            }
        }
    }

    // Update button display (exact same as manual modal)
    const groupObj = modelGroups.find(g => g.group === group);
    const optObj = groupObj ? groupObj.options.find(o => o.value === value.toLowerCase()) : null;
    if (optObj) {
        // Only set actual value if not inherited display
        if (!isInheritedDisplay) {
            modelInput.value = value.toLowerCase();
            // Remove inherited class when custom value set
            if (modelBtn) modelBtn.classList.remove('inherited');
            // Update inherited state (which also updates reset button visibility)
            updateStageDropdownInheritedState(stageId);
            // Update downstream stages
            updateDownstreamStagesInheritedValues(stageId);
        }

        modelSelected.innerHTML = [
            `<span class="custom-dropdown-text">${optObj.display}</span>`,
            (optObj.badge_full || optObj.badge) ? `<span class="custom-dropdown-badge ${optObj.badge_class}">${optObj.badge_full || optObj.badge}</span>` : ''
        ].filter(Boolean).join(' ');
    } else {
        modelSelected.textContent = 'Select model...';
    }
}

function renderStageSamplerDropdown(stageId, selectedValue) {
    const menu = document.getElementById(`${stageId}_samplerDropdownMenu`);
    const noiseSchedulerInput = document.getElementById(`${stageId}_noiseScheduler`);
    if (!menu) return;

    const selectedNoiseScheduler = noiseSchedulerInput?.value || 'karras';

    menu.innerHTML = '';

    // Add sampler section header
    const samplerHeader = document.createElement('div');
    samplerHeader.className = 'custom-dropdown-group';
    samplerHeader.textContent = 'Sampler';
    menu.appendChild(samplerHeader);

    // Add sampler options
    SAMPLER_MAP.forEach(sampler => {
        const option = document.createElement('div');
        option.className = 'custom-dropdown-option' + (selectedValue === sampler.meta ? ' selected' : '');
        option.tabIndex = 0;
        option.dataset.value = sampler.meta;
        option.innerHTML = `<span>${sampler.display}</span>`;

        option.addEventListener('click', () => {
            selectStageSampler(stageId, sampler.meta);
            closeDropdown(menu, document.getElementById(`${stageId}_samplerDropdownBtn`));
        });

        menu.appendChild(option);
    });

    // Add noise scheduler section header
    const noiseHeader = document.createElement('div');
    noiseHeader.className = 'custom-dropdown-group';
    noiseHeader.textContent = 'Noise Scheduler';
    menu.appendChild(noiseHeader);

    // Add noise scheduler options
    NOISE_MAP.forEach(noise => {
        const option = document.createElement('div');
        option.className = 'custom-dropdown-option' + (selectedNoiseScheduler === noise.meta ? ' selected' : '');
        option.tabIndex = 0;
        option.dataset.value = noise.meta;
        option.dataset.group = 'noise';
        option.innerHTML = `<span>${noise.display}</span>`;

        option.addEventListener('click', () => {
            selectStageNoiseScheduler(stageId, noise.meta);
            closeDropdown(menu, document.getElementById(`${stageId}_samplerDropdownBtn`));
        });

        menu.appendChild(option);
    });
}

function selectStageSampler(stageId, value) {
    const samplerInput = document.getElementById(`${stageId}_sampler`);
    const samplerSelected = document.getElementById(`${stageId}_samplerSelected`);
    const samplerBtn = document.getElementById(`${stageId}_samplerDropdownBtn`);

    if (!samplerInput || !samplerSelected) return;

    samplerInput.value = value;

    // Remove inherited class when custom value set
    if (samplerBtn) samplerBtn.classList.remove('inherited');

    // Auto-set noise scheduler based on sampler selection (same rules as manual modal)
    if (value === 'k_dpmpp_2m') {
        selectStageNoiseScheduler(stageId, 'exponential');
    } else {
        selectStageNoiseScheduler(stageId, 'karras');
    }

    updateStageSamplerDisplay(stageId);

    updateStageDropdownInheritedState(stageId);
    updateDownstreamStagesInheritedValues(stageId);
}

function selectStageNoiseScheduler(stageId, value) {
    const noiseSchedulerInput = document.getElementById(`${stageId}_noiseScheduler`);
    if (!noiseSchedulerInput) return;

    noiseSchedulerInput.value = value;
    updateStageSamplerDisplay(stageId);
    updateStageResetButtonVisibility(stageId);
    updateDownstreamStagesInheritedValues(stageId);
}

function updateStageSamplerDisplay(stageId) {
    const samplerInput = document.getElementById(`${stageId}_sampler`);
    const noiseSchedulerInput = document.getElementById(`${stageId}_noiseScheduler`);
    const samplerSelected = document.getElementById(`${stageId}_samplerSelected`);

    if (!samplerInput || !samplerSelected) return;

    const samplerValue = samplerInput.value || 'k_euler_ancestral';
    const noiseValue = noiseSchedulerInput?.value || 'karras';

    const s = SAMPLER_MAP.find(s => s.meta.toLowerCase() === samplerValue.toLowerCase());
    const n = NOISE_MAP.find(n => n.meta.toLowerCase() === noiseValue.toLowerCase());

    if (s) {
        // Map full noise scheduler names to short versions (exact same as manual modal)
        const noiseShortMap = {
            'karras': 'Karras',
            'exponential': 'Expo',
            'polyexponential': 'PolyEx'
        };
        const noiseShort = noiseShortMap[n?.meta] || n?.display || '';

        // Determine if noise scheduler badge should be shown (exact same as manual modal)
        // Show badge if: (sampler is dpmpp_2m AND noise is NOT exponential) OR (sampler is NOT dpmpp_2m AND noise is NOT karras)
        const showNoiseBadge = (samplerValue === 'k_dpmpp_2m' && noiseValue !== 'exponential') ||
            (samplerValue !== 'k_dpmpp_2m' && noiseValue !== 'karras');

        // Build display exactly like manual modal
        samplerSelected.innerHTML = [
            `<span class="custom-dropdown-text small-viewport">${s.display_short || s.display}</span>`,
            `<span class="custom-dropdown-text full-viewport">${s.display_short_full || s.display}</span>`,
            s.badge ? `<span class="custom-dropdown-badge small-viewport ${s.badge_class || ''}">${s.badge}</span>` : '',
            s.full_badge ? `<span class="custom-dropdown-badge full-viewport ${s.badge_class || ''}">${s.full_badge}</span>` : '',
            showNoiseBadge && noiseShort ? `<span class="custom-dropdown-badge full-viewport noise-scheduler-badge">${noiseShort}</span><span class="custom-dropdown-badge small-viewport noise-scheduler-badge">${noiseShort.slice(0, 1)}</span>` : ''
        ].filter(Boolean).join(' ');
    } else {
        samplerSelected.innerHTML = 'Select sampler...';
    }
}

// Select enhance resolution
function selectStageEnhanceResolution(stageId, value, isInheritedDisplay = false) {
    const resolutionInput = document.getElementById(`${stageId}_resolution`);
    const resolutionSelected = document.getElementById(`${stageId}_resolutionSelected`);
    const resolutionBtn = document.getElementById(`${stageId}_resolutionDropdownBtn`);
    if (!resolutionInput || !resolutionSelected) return;

    if (!isInheritedDisplay) {
        // Set value only for custom selections
        resolutionInput.value = value;
        if (resolutionBtn) resolutionBtn.classList.remove('inherited');
        updateStageResetButtonVisibility(stageId);
        updateStageDropdownInheritedState(stageId);
        updateDownstreamStagesInheritedValues(stageId);
        updateStageButtonStates();
    } else {
        if (resolutionBtn) resolutionBtn.classList.add('inherited');
    }

    const displayMap = { normal: 'Normal', large: 'Large', xlarge: 'Maximum' };
    resolutionSelected.innerHTML = `<span class="custom-dropdown-text">${displayMap[value] || 'Normal'}</span>`;
}

// Get expand canvas stage data
function getExpandCanvasStageData(stageId) {
    const biasValue = document.getElementById(`${stageId}_bias`)?.value;
    const saveResultsToggle = document.getElementById(`${stageId}_saveResultsToggle`);
    const upscaleToggle = document.getElementById(`${stageId}_upscaleToggle`);
    const stopToggle = document.getElementById(`${stageId}_stopToggle`);
    const lockPromptToggle = document.getElementById(`${stageId}_lockPromptToggle`);
    const insetToggle = document.getElementById(`${stageId}_insetToggle`);
    const resolutionValue = document.getElementById(`${stageId}_resolution`)?.value || null;

    // Get background focus - handle three states: '' (inherit), 'on' (explicit), 'off' (explicit)
    const bgFocusToggle = document.getElementById(`${stageId}_bgFocusToggle`);
    const currentState = bgFocusToggle?.dataset.state || '';

    let backgroundFocus;
    if (currentState === '') {
        // Inheriting - get inherited value
        const inheritedValues = getStageInheritedValues(stageId);
        backgroundFocus = inheritedValues.backgroundFocus || false;
    } else {
        // Explicit state set
        backgroundFocus = currentState === 'on';
    }

    const branchToggle = document.getElementById(`${stageId}_branchToggle`);
    const stageItem = document.getElementById(stageId);

    const data = {
        type: STAGE_TYPES.EXPAND_CANVAS,
        resolution: resolutionValue,
        bias: biasValue !== '' && biasValue !== undefined ? parseInt(biasValue) : 2,
        saveResults: saveResultsToggle?.dataset.state === 'on',
        upscale: upscaleToggle?.dataset.state === 'on',
        stopAtStage: stopToggle?.dataset.state === 'on',
        lockPrompt: lockPromptToggle?.dataset.state === 'on',
        inset: insetToggle?.dataset.state !== 'off',
        backgroundFocus: backgroundFocus,
        branch: branchToggle?.dataset.state === 'on'
    };

    if (stageItem?.dataset.managed === 'true') {
        data.managed = true;
    }

    const phaseStepName = getPipelineStageDisplayName(stageItem);
    if (phaseStepName) {
        data.displayName = phaseStepName;
    }

    // Save custom resolution dimensions if resolution is custom
    if (resolutionValue === 'custom') {
        const widthInput = document.getElementById(`${stageId}_width`);
        const heightInput = document.getElementById(`${stageId}_height`);
        if (widthInput && heightInput) {
            data.width = parseInt(widthInput.value) || 1024;
            data.height = parseInt(heightInput.value) || 1024;
        }
    }

    // Check seed inheritance toggle (always collect, not just when advanced is visible)
    const inheritSeedToggle = document.getElementById(`${stageId}_inheritSeedToggle`);
    const seedInput = document.getElementById(`${stageId}_seed`);
    if (inheritSeedToggle?.dataset.state === 'on' || (seedInput && seedInput.value !== '')) {
        if (!data.advanced) data.advanced = {};
        if (inheritSeedToggle?.dataset.state === 'on') {
            data.advanced.inheritSeed = true;
        }
        if (seedInput && seedInput.value !== '') {
            data.advanced.seed = parseInt(seedInput.value);
        }
    }

    // Check if advanced controls are visible and have values
    const advancedControls = document.getElementById(`${stageId}_advancedControls`);
    const directiveVal = document.getElementById(`${stageId}_creativeDirective`)?.value || '';
    const model = document.getElementById(`${stageId}_model`)?.value;
    const steps = document.getElementById(`${stageId}_steps`)?.value;
    const guidance = document.getElementById(`${stageId}_guidance`)?.value;
    const rescale = document.getElementById(`${stageId}_rescale`)?.value;
    const sampler = document.getElementById(`${stageId}_sampler`)?.value;
    const noiseScheduler = document.getElementById(`${stageId}_noiseScheduler`)?.value;
    const varietyBtn = document.getElementById(`${stageId}_varietyBtn`);

    if (!data.advanced) data.advanced = {};

    if (directiveVal !== '') data.advanced.directive = directiveVal;
    if (model !== '') data.advanced.model = model;
    if (steps !== '') data.advanced.steps = parseInt(steps);
    if (guidance !== '') data.advanced.guidance = parseFloat(guidance);
    if (rescale !== '') data.advanced.rescale = parseFloat(rescale);
    if (sampler !== '') data.advanced.sampler = sampler;
    if (noiseScheduler !== '') data.advanced.noiseScheduler = noiseScheduler;
    if (varietyBtn?.dataset.state === 'on') data.advanced.variety = true;

    return data;
}

// Get enhance stage data
function getEnhanceStageData(stageId) {
    const strengthInput = document.getElementById(`${stageId}_strength`);
    const noiseInput = document.getElementById(`${stageId}_noise`);
    const strengthOverlay = document.getElementById(`${stageId}_strengthOverlay`);
    const noiseOverlay = document.getElementById(`${stageId}_noiseOverlay`);
    const magnitudeInput = document.getElementById(`${stageId}_magnitude`);
    const inheritSeedToggle = document.getElementById(`${stageId}_inheritSeedToggle`);
    const autoSeedToggle = document.getElementById(`${stageId}_autoSeedToggle`);
    const seedInput = document.getElementById(`${stageId}_seed`);
    const saveResultsToggle = document.getElementById(`${stageId}_saveResultsToggle`);
    const upscaleToggle = document.getElementById(`${stageId}_upscaleToggle`);
    const stopToggle = document.getElementById(`${stageId}_stopToggle`);
    const lockPromptToggle = document.getElementById(`${stageId}_lockPromptToggle`);
    const useBaseToggle = document.getElementById(`${stageId}_useBaseImageToggle`);
    const resInput = document.getElementById(`${stageId}_resolution`);

    const branchToggle = document.getElementById(`${stageId}_branchToggle`);
    const stageItem = document.getElementById(stageId);

    const useBaseImage = useBaseToggle?.dataset.state === 'on';

    const data = {
        type: STAGE_TYPES.VARIATION,
        useBaseImage,
        saveResults: saveResultsToggle?.dataset.state === 'on',
        upscale: upscaleToggle?.dataset.state === 'on',
        stopAtStage: stopToggle?.dataset.state === 'on',
        lockPrompt: lockPromptToggle?.dataset.state === 'on',
        branch: branchToggle?.dataset.state === 'on'
    };

    if (stageItem?.dataset.managed === 'true') {
        data.managed = true;
    }

    const phaseStepName = getPipelineStageDisplayName(stageItem);
    if (phaseStepName) {
        data.displayName = phaseStepName;
    }

    if (useBaseImage) {
        // Get values - check if using magnitude preset or custom values
        if (magnitudeInput?.value !== '') {
            const magnitude = parseFloat(magnitudeInput.value);
            const preset = MAGNITUDE_PRESETS[magnitude];
            if (preset) {
                data.strength = preset.strength;
                data.noise = preset.noise;
            } else {
                data.strength = 0.5;
                data.noise = 0.0;
            }
        } else {
            data.strength = strengthInput?.value !== '' ? parseFloat(strengthInput.value) : 0.5;
            data.noise = noiseInput?.value !== '' ? parseFloat(noiseInput.value) : 0.0;
        }

        const areaValue = resInput?.value || '';
        if (areaValue !== '') {
            data.resolution = areaValue;
        }
    } else {
        // Normal resolution path like expand-canvas (no strength/noise included)
        const resolutionValue = resInput?.value || null;
        if (resolutionValue) data.resolution = resolutionValue;
        if (resolutionValue === 'custom') {
            const widthInput = document.getElementById(`${stageId}_width`);
            const heightInput = document.getElementById(`${stageId}_height`);
            if (widthInput && heightInput) {
                data.width = parseInt(widthInput.value) || 1024;
                data.height = parseInt(heightInput.value) || 1024;
            }
        }
    }

    // Check seed inheritance toggle (always collect, not just when advanced is visible)
    if (inheritSeedToggle?.dataset.state === 'on' || (seedInput && seedInput.value !== '')) {
        if (!data.advanced) data.advanced = {};
        if (inheritSeedToggle?.dataset.state === 'on') {
            data.advanced.inheritSeed = true;
        } else if (seedInput && seedInput.value !== '') {
            data.advanced.seed = parseInt(seedInput.value);
        }
    }

    // Check if advanced controls are visible and have values (same as expand canvas)
    const advancedControls = document.getElementById(`${stageId}_advancedControls`);
    const directiveVal = document.getElementById(`${stageId}_creativeDirective`)?.value || '';
    const model = document.getElementById(`${stageId}_model`)?.value;
    const steps = document.getElementById(`${stageId}_steps`)?.value;
    const guidance = document.getElementById(`${stageId}_guidance`)?.value;
    const rescale = document.getElementById(`${stageId}_rescale`)?.value;
    const sampler = document.getElementById(`${stageId}_sampler`)?.value;
    const noiseScheduler = document.getElementById(`${stageId}_noiseScheduler`)?.value;
    const varietyBtn = document.getElementById(`${stageId}_varietyBtn`);

    if (!data.advanced) data.advanced = {};

    if (directiveVal !== '') data.advanced.directive = directiveVal;
    if (model !== '') data.advanced.model = model;
    if (steps !== '') data.advanced.steps = parseInt(steps);
    if (guidance !== '') data.advanced.guidance = parseFloat(guidance);
    if (rescale !== '') data.advanced.rescale = parseFloat(rescale);
    if (sampler !== '') data.advanced.sampler = sampler;
    if (noiseScheduler !== '') data.advanced.noiseScheduler = noiseScheduler;
    if (varietyBtn?.dataset.state === 'on') data.advanced.variety = true;

    return data;
}


// Helper function to get bias name (for 5-position system, orientation-agnostic)
function getBiasName(value, isPortrait = false) {
    // Map to the 5-position system names based on orientation
    const portraitNames = ['Top', '⅖ Top', 'Center', '⅘ Bottom', 'Bottom'];
    const landscapeNames = ['Left', '⅖ Left', 'Center', '⅘ Right', 'Right'];

    const names = isPortrait ? portraitNames : landscapeNames;
    const numValue = parseInt(value);

    // Handle both 0-4 range and legacy 0-8 range by mapping to 0-4
    if (numValue >= 0 && numValue <= 4) {
        return names[numValue] || 'Center';
    }
    // If legacy value, just return Center
    return 'Center';
}

// Load expand canvas stage data
function loadExpandCanvasStageData(stageId, stageData, stageSeed = null) {
    if (!stageData) return;

    if (stageData.displayName) {
        setPipelineStageDisplayName(stageId, stageData.displayName);
    }

    // Load basic data
    if (stageData.resolution) {
        // Handle custom resolution
        if (stageData.resolution === 'custom') {
            // First, load custom dimensions before calling selectStageResolution
            const widthInput = document.getElementById(`${stageId}_width`);
            const heightInput = document.getElementById(`${stageId}_height`);

            if (widthInput && stageData.width) {
                widthInput.value = stageData.width;
            }
            if (heightInput && stageData.height) {
                heightInput.value = stageData.height;
            }

            // Now call the selection function which will handle the UI updates
            selectStageResolution(stageId, 'custom', null);

            // Update bias grid orientation
            if (widthInput && heightInput) {
                const width = parseInt(widthInput.value) || 1024;
                const height = parseInt(heightInput.value) || 1024;
                const biasGrid = document.getElementById(`${stageId}_biasGrid`);
                if (biasGrid) {
                    if (width > height) {
                        biasGrid.dataset.orientation = 'landscape';
                    } else if (height > width) {
                        biasGrid.dataset.orientation = 'portrait';
                    } else {
                        biasGrid.dataset.orientation = 'square';
                    }
                }
            }
        } else {
            // Find the group for this resolution
            let group = null;
            for (const g of RESOLUTION_GROUPS) {
                const found = g.options.find(o => o.value === stageData.resolution);
                if (found) {
                    group = g.group;
                    break;
                }
            }

            // Call the proper selection function
            selectStageResolution(stageId, stageData.resolution, group);
        }
    }

    if (stageData.bias !== undefined) {
        // Determine orientation from loaded resolution for correct bias name
        const loadedResolution = stageData.resolution ? RESOLUTIONS.find(r => r.value === stageData.resolution) : null;
        const isPortrait = loadedResolution ? loadedResolution.height > loadedResolution.width : false;
        selectStageBias(stageId, stageData.bias, getBiasName(stageData.bias, isPortrait), isPortrait);
    }

    if (stageData.inset !== undefined) {
        const insetToggle = document.getElementById(`${stageId}_insetToggle`);
        if (insetToggle) {
            insetToggle.dataset.state = stageData.inset ? 'on' : 'off';
        }
    } else {
        const insetToggle = document.getElementById(`${stageId}_insetToggle`);
        if (insetToggle) {
            insetToggle.dataset.state = 'on';
        }
    }

    // Load background focus toggle state
    if (stageData.backgroundFocus !== undefined) {
        const bgFocusToggle = document.getElementById(`${stageId}_bgFocusToggle`);
        if (bgFocusToggle) {
            // Check if the saved value matches the inherited value
            const inheritedValues = getStageInheritedValues(stageId);
            if (stageData.backgroundFocus === inheritedValues.backgroundFocus) {
                // Matches inherited - use inherit mode
                bgFocusToggle.dataset.state = '';
                updateStageBackgroundFocusVisuals(stageId, stageData.backgroundFocus, true);
            } else {
                // Differs from inherited - use explicit state
                bgFocusToggle.dataset.state = stageData.backgroundFocus ? 'on' : 'off';
                updateStageBackgroundFocusVisuals(stageId, stageData.backgroundFocus, false);
            }
        }
    }

    // Load advanced controls if present
    if (stageData.advanced) {
        const advancedToggle = document.getElementById(`${stageId}_advancedToggle`);
        const advancedControls = document.getElementById(`${stageId}_advancedControls`);

        if (advancedToggle && advancedControls) {

            const adv = stageData.advanced;
            // Load directive
            if (adv.directive !== undefined) {
                const dir = document.getElementById(`${stageId}_creativeDirective`);
                if (dir) {
                    dir.value = adv.directive;
                    autoResizeTextarea(dir);
                }
            }

            if (adv.model) {
                selectStageModel(stageId, adv.model);
            }
            if (adv.steps) document.getElementById(`${stageId}_steps`).value = adv.steps;
            if (adv.guidance) document.getElementById(`${stageId}_guidance`).value = adv.guidance;
            if (adv.rescale) {
                const rescaleInput = document.getElementById(`${stageId}_rescale`);
                const rescaleOverlay = document.getElementById(`${stageId}_rescaleOverlay`);
                if (rescaleInput) rescaleInput.value = adv.rescale;
                if (rescaleOverlay) rescaleOverlay.textContent = `${(adv.rescale * 100).toFixed(0)}%`;
            }
            if (adv.sampler) {
                // Don't use selectStageSampler here to avoid auto-setting noise scheduler
                // We want to preserve the saved noise scheduler value
                const samplerInput = document.getElementById(`${stageId}_sampler`);
                const noiseSchedulerInput = document.getElementById(`${stageId}_noiseScheduler`);
                if (samplerInput) samplerInput.value = adv.sampler;
                if (noiseSchedulerInput && adv.noiseScheduler) noiseSchedulerInput.value = adv.noiseScheduler;

                // Update display
                updateStageSamplerDisplay(stageId);
            }

            const varietyBtn = document.getElementById(`${stageId}_varietyBtn`);
            if (varietyBtn && adv.variety) {
                varietyBtn.dataset.state = 'on';
            }

            const inheritSeedToggle = document.getElementById(`${stageId}_inheritSeedToggle`);
            const autoSeedToggle = document.getElementById(`${stageId}_autoSeedToggle`);
            const seedInput = document.getElementById(`${stageId}_seed`);

            // Handle inherit seed toggle
            if (inheritSeedToggle) {
                const isInheriting = adv.inheritSeed === true;
                inheritSeedToggle.dataset.state = isInheriting ? 'on' : 'off';
                if (isInheriting) {
                    seedInput.disabled = true;
                    seedInput.placeholder = 'Inherited';
                    if (autoSeedToggle) autoSeedToggle.classList.add('hidden');
                } else {
                    // Not inheriting: enable seed input
                    seedInput.disabled = false;
                    seedInput.placeholder = 'Random';
                }
            }

            if (autoSeedToggle && seedInput) {
                // Store loaded seed in dataset (check stageData.seed first, then adv.seed)
                if (stageData.seed) {
                    seedInput.dataset.loadedSeed = stageData.seed.toString();
                } else if (adv.seed) {
                    seedInput.dataset.loadedSeed = adv.seed.toString();
                }
                if (!adv.inheritSeed) {
                    autoSeedToggle.classList.remove('hidden');
                }

                if (adv.autoSeed !== undefined) {
                    autoSeedToggle.dataset.state = adv.autoSeed ? 'on' : 'off';

                    if (!adv.autoSeed) {
                        // Locked state: set value and make read-only (don't set placeholder since value is shown)
                        seedInput.value = adv.seed;
                        seedInput.disabled = true;
                    } else {
                        // Auto state: clear value, make editable, and show loaded seed as placeholder
                        seedInput.value = '';
                        seedInput.disabled = false;
                        if (adv.seed) {
                            seedInput.placeholder = adv.seed.toString();
                        }
                    }
                } else {
                    // No autoSeed state saved, default to auto mode
                    autoSeedToggle.dataset.state = 'on';
                    seedInput.value = '';
                    seedInput.disabled = false;
                    if (adv.seed) {
                        seedInput.placeholder = adv.seed.toString();
                    }
                }
            }
        }
    }

    // Load save results toggle
    if (stageData.saveResults !== undefined) {
        const saveResultsToggle = document.getElementById(`${stageId}_saveResultsToggle`);
        if (saveResultsToggle) {
            saveResultsToggle.dataset.state = stageData.saveResults ? 'on' : 'off';
        }
    }

    // Load upscale toggle
    const upscaleToggle = document.getElementById(`${stageId}_upscaleToggle`);
    if (upscaleToggle) {
        if (stageData.upscale !== undefined) {
            upscaleToggle.dataset.state = stageData.upscale ? 'on' : 'off';
        }
        // Show upscale toggle only if save is enabled
        if (stageData.saveResults) {
            upscaleToggle.disabled = false;
            upscaleToggle.title = 'Enable Upscaling';
            upscaleToggle.classList.remove('hidden');
        } else {
            upscaleToggle.disabled = true;
            upscaleToggle.title = 'Upscaling not available';
        }
    }

    // Load stop toggle
    if (stageData.stopAtStage !== undefined) {
        const stopToggle = document.getElementById(`${stageId}_stopToggle`);
        if (stopToggle) {
            stopToggle.dataset.state = stageData.stopAtStage ? 'on' : 'off';
        }
    }

    // Load lock prompt toggle
    if (stageData.lockPrompt !== undefined) {
        const lockPromptToggle = document.getElementById(`${stageId}_lockPromptToggle`);
        if (lockPromptToggle) {
            lockPromptToggle.dataset.state = stageData.lockPrompt ? 'on' : 'off';
        }
    }

    // Load branch toggle
    if (stageData.branch !== undefined) {
        const branchToggle = document.getElementById(`${stageId}_branchToggle`);
        if (branchToggle) {
            branchToggle.dataset.state = stageData.branch ? 'on' : 'off';

            // Update visual indicator
            const stageItem = document.getElementById(stageId);
            if (stageItem) {
                if (stageData.branch) {
                    stageItem.classList.add('stage-branch');
                } else {
                    stageItem.classList.remove('stage-branch');
                }
            }
        }
    }

    // Populate seed from stage_seeds if provided (updates dataset.loadedSeed for display)
    if (stageSeed && stageSeed.seed !== undefined) {
        const autoSeedToggle = document.getElementById(`${stageId}_autoSeedToggle`);
        const seedInput = document.getElementById(`${stageId}_seed`);

        if (autoSeedToggle && seedInput) {
            // Store loaded seed in dataset (for auto mode display)
            seedInput.dataset.loadedSeed = stageSeed.seed.toString();

            // Check if we're in inherit mode
            const inheritSeedToggle = document.getElementById(`${stageId}_inheritSeedToggle`);
            const isInheritMode = inheritSeedToggle && inheritSeedToggle.dataset.state === 'on';

            if (!isInheritMode) {
                // Only update UI if not in inherit mode
                autoSeedToggle.classList.remove('hidden');

                // Check if there's already a value set (from advanced config)
                if (!seedInput.value) {
                    // No explicit value - update placeholder based on current auto seed state
                    const currentAutoSeedState = autoSeedToggle.dataset.state;
                    if (currentAutoSeedState === 'on') {
                        // Auto mode: show seed in placeholder
                        seedInput.placeholder = stageSeed.seed.toString();
                    }
                }
                // If seedInput.value exists, it means a locked seed was loaded from advanced config - don't override
            }
        }
    }

    updateExpandCanvasStageInsetToggle(stageId);

    if (stageData.managed) {
        applyManagedPipelineStageUi(stageId, true);
    }
}

// Load enhance stage data
function loadEnhanceStageData(stageId, stageData, stageSeed = null) {
    if (!stageData) return;

    if (stageData.displayName) {
        setPipelineStageDisplayName(stageId, stageData.displayName);
    }

    // Setup toggle state (default true for legacy enhance, respect useBaseImage for variation)
    const useBaseToggle = document.getElementById(`${stageId}_useBaseImageToggle`);
    const useBase = stageData.useBaseImage === undefined ? (stageData.type === STAGE_TYPES.ENHANCE) : !!stageData.useBaseImage;
    if (useBaseToggle) {
        useBaseToggle.dataset.state = useBase ? 'on' : 'off';
        // Apply visibility
        const groupMagnitude = document.querySelector(`#${stageId}_body .group-magnitude`);
        const groupStrength = document.querySelector(`#${stageId}_body .group-strength`);
        const groupNoise = document.querySelector(`#${stageId}_body .group-noise`);
        if (groupMagnitude) groupMagnitude.classList.toggle('hidden', !useBase);
        if (groupStrength) groupStrength.classList.toggle('hidden', !useBase);
        if (groupNoise) groupNoise.classList.toggle('hidden', !useBase);
    }

    const strengthInput = document.getElementById(`${stageId}_strength`);
    const noiseInput = document.getElementById(`${stageId}_noise`);
    const strengthOverlay = document.getElementById(`${stageId}_strengthOverlay`);
    const noiseOverlay = document.getElementById(`${stageId}_noiseOverlay`);
    const magnitudeInput = document.getElementById(`${stageId}_magnitude`);

    // Provide default values if missing
    const strength = stageData.strength !== undefined ? stageData.strength : 0.5;
    const noise = stageData.noise !== undefined ? stageData.noise : 0.0;

    // Check if values match a magnitude preset
    let matchedMagnitude = null;
    for (const [mag, preset] of Object.entries(MAGNITUDE_PRESETS)) {
        if (Math.abs(strength - preset.strength) < 0.01 &&
            Math.abs(noise - preset.noise) < 0.01) {
            matchedMagnitude = parseFloat(mag);
            break;
        }
    }

    if (matchedMagnitude) {
        // Set magnitude and clear strength/noise (inherited state - like rescale)
        if (magnitudeInput) {
            magnitudeInput.value = matchedMagnitude.toFixed(1);
            magnitudeInput.placeholder = '';
        }
        // Clear values, overlay shows the preset (no dataset needed)
        if (strengthInput) strengthInput.value = '';
        if (noiseInput) noiseInput.value = '';
        if (strengthOverlay) strengthOverlay.textContent = `${(strength * 100).toFixed(0)}%`;
        if (noiseOverlay) noiseOverlay.textContent = `${(noise * 100).toFixed(0)}%`;

        // Add inherited class (dimmed appearance)
        const strengthContainer = strengthInput?.parentElement;
        const noiseContainer = noiseInput?.parentElement;
        if (strengthContainer) strengthContainer.classList.add('inherited');
        if (noiseContainer) noiseContainer.classList.add('inherited');
    } else {
        // Set values directly, magnitude becomes placeholder
        if (magnitudeInput) {
            magnitudeInput.value = '';
            magnitudeInput.placeholder = '3.0'; // Default placeholder when custom
        }
        if (strengthInput) strengthInput.value = strength.toFixed(2);
        if (noiseInput) noiseInput.value = noise.toFixed(2);
        if (strengthOverlay) strengthOverlay.textContent = `${(strength * 100).toFixed(0)}%`;
        if (noiseOverlay) noiseOverlay.textContent = `${(noise * 100).toFixed(0)}%`;

        // Remove inherited class (custom values)
        const strengthContainer = strengthInput?.parentElement;
        const noiseContainer = noiseInput?.parentElement;
        if (strengthContainer) strengthContainer.classList.remove('inherited');
        if (noiseContainer) noiseContainer.classList.remove('inherited');
    }

    // Load resolution based on mode
    if (useBase) {
        if (stageData.resolution && stageData.resolution !== 'custom' && !stageData.resolution.includes('_')) {
            // Area value directly into unified resolution input
            const resolutionInput = document.getElementById(`${stageId}_resolution`);
            if (resolutionInput) resolutionInput.value = stageData.resolution;
            selectStageEnhanceResolution(stageId, stageData.resolution);
        }
    } else if (stageData.resolution) {
        if (stageData.resolution === 'custom') {
            const widthInput = document.getElementById(`${stageId}_width`);
            const heightInput = document.getElementById(`${stageId}_height`);
            if (widthInput && stageData.width) widthInput.value = stageData.width;
            if (heightInput && stageData.height) heightInput.value = stageData.height;
            selectStageResolution(stageId, 'custom', null);
        } else {
            let group = null;
            for (const g of RESOLUTION_GROUPS) {
                const found = g.options.find(o => o.value === stageData.resolution);
                if (found) { group = g.group; break; }
            }
            selectStageResolution(stageId, stageData.resolution, group);
        }
    }

    // Load advanced controls if present (same as expand canvas)
    if (stageData.advanced) {
        const adv = stageData.advanced;
        const advancedControls = document.getElementById(`${stageId}_advancedControls`);
        const advancedToggleBtn = document.getElementById(`${stageId}_advancedToggle`);

        // Set model
        if (adv.model) {
            const modelInput = document.getElementById(`${stageId}_model`);
            if (modelInput) {
                modelInput.value = adv.model;
                selectStageModel(stageId, adv.model);
            }
        }

        // Set steps
        const stepsInput = document.getElementById(`${stageId}_steps`);
        if (stepsInput && adv.steps !== null && adv.steps !== undefined) {
            stepsInput.value = adv.steps;
        }

        // Set guidance
        const guidanceInput = document.getElementById(`${stageId}_guidance`);
        if (guidanceInput && adv.guidance !== null && adv.guidance !== undefined) {
            guidanceInput.value = adv.guidance >= 10 ? 10 : adv.guidance.toFixed(1);
        }

        // Set rescale
        const rescaleInput = document.getElementById(`${stageId}_rescale`);
        const rescaleOverlay2 = document.getElementById(`${stageId}_rescaleOverlay`);
        if (rescaleInput && adv.rescale !== null && adv.rescale !== undefined) {
            rescaleInput.value = adv.rescale.toFixed(2);
            if (rescaleOverlay2) {
                rescaleOverlay2.textContent = `${(adv.rescale * 100).toFixed(0)}%`;
            }
            const rescaleContainer = rescaleInput.parentElement;
            if (rescaleContainer) rescaleContainer.classList.remove('inherited');
        }

        // Set sampler
        if (adv.sampler) {
            const samplerInput = document.getElementById(`${stageId}_sampler`);
            if (samplerInput) {
                samplerInput.value = adv.sampler;
                selectStageSampler(stageId, adv.sampler, adv.noiseScheduler || 'native');
            }
        }

        // Set variety
        const varietyBtn = document.getElementById(`${stageId}_varietyBtn`);
        if (varietyBtn && adv.variety !== undefined) {
            varietyBtn.dataset.state = adv.variety ? 'on' : 'off';
        }

        // Set seed toggle and value
        const inheritSeedToggle = document.getElementById(`${stageId}_inheritSeedToggle`);
        const autoSeedToggle = document.getElementById(`${stageId}_autoSeedToggle`);
        const seedInputAdv = document.getElementById(`${stageId}_seed`);

        // Handle inherit seed toggle
        if (inheritSeedToggle) {
            const isInheriting = adv.inheritSeed === true;
            inheritSeedToggle.dataset.state = isInheriting ? 'on' : 'off';
            if (isInheriting) {
                seedInputAdv.disabled = true;
                seedInputAdv.placeholder = 'Inherited';
                if (autoSeedToggle) autoSeedToggle.classList.add('hidden');
            } else {
                // Not inheriting: enable seed input
                seedInputAdv.disabled = false;
                seedInputAdv.placeholder = 'Random';
            }
        }

        if (autoSeedToggle && seedInputAdv) {
            // Store loaded seed in dataset (check stageData.seed first, then adv.seed)
            if (stageData.seed) {
                seedInputAdv.dataset.loadedSeed = stageData.seed.toString();
            } else if (adv.seed) {
                seedInputAdv.dataset.loadedSeed = adv.seed.toString();

                // Show the toggle button since we have a seed (only if not inheriting)
                if (!adv.inheritSeed) {
                    autoSeedToggle.classList.remove('hidden');
                }

                if (adv.autoSeed !== undefined) {
                    autoSeedToggle.dataset.state = adv.autoSeed ? 'on' : 'off';

                    if (!adv.autoSeed) {
                        // Locked state: set value and make read-only (don't set placeholder since value is shown)
                        seedInputAdv.value = seedInputAdv.dataset.loadedSeed;
                        seedInputAdv.disabled = true;
                    } else {
                        // Auto state: clear value, make editable, and show loaded seed as placeholder
                        seedInputAdv.value = '';
                        seedInputAdv.disabled = false;
                        seedInputAdv.placeholder = seedInputAdv.dataset.loadedSeed;
                    }
                } else {
                    // No autoSeed state saved, default to auto mode
                    autoSeedToggle.dataset.state = 'on';
                    seedInputAdv.value = '';
                    seedInputAdv.disabled = false;
                    seedInputAdv.placeholder = seedInputAdv.dataset.loadedSeed;
                }
            } else {
                // No seed loaded - keep button hidden
                autoSeedToggle.classList.add('hidden');
                autoSeedToggle.dataset.state = 'on';
            }
        }
    }

    // Load save results toggle
    if (stageData.saveResults !== undefined) {
        const saveResultsToggle = document.getElementById(`${stageId}_saveResultsToggle`);
        if (saveResultsToggle) {
            saveResultsToggle.dataset.state = stageData.saveResults ? 'on' : 'off';
        }
    }

    // Load upscale toggle
    const upscaleToggle = document.getElementById(`${stageId}_upscaleToggle`);
    if (upscaleToggle) {
        if (stageData.upscale !== undefined) {
            upscaleToggle.dataset.state = stageData.upscale ? 'on' : 'off';
        }
        // Show upscale toggle only if save is enabled
        if (stageData.saveResults) {
            upscaleToggle.disabled = false;
            upscaleToggle.title = 'Enable Upscaling';
        } else {
            upscaleToggle.disabled = true;
            upscaleToggle.title = 'Upscaling not available';
        }
    }

    // Load stop toggle
    if (stageData.stopAtStage !== undefined) {
        const stopToggle = document.getElementById(`${stageId}_stopToggle`);
        if (stopToggle) {
            stopToggle.dataset.state = stageData.stopAtStage ? 'on' : 'off';
        }
    }

    // Load branch toggle
    if (stageData.branch !== undefined) {
        const branchToggle = document.getElementById(`${stageId}_branchToggle`);
        if (branchToggle) {
            branchToggle.dataset.state = stageData.branch ? 'on' : 'off';

            // Update visual indicator
            const stageItem = document.getElementById(stageId);
            if (stageItem) {
                if (stageData.branch) {
                    stageItem.classList.add('stage-branch');
                } else {
                    stageItem.classList.remove('stage-branch');
                }
            }
        }
    }

    // Populate seed from stage_seeds if provided (updates dataset.loadedSeed for display)
    if (stageSeed && stageSeed.seed !== undefined) {
        const autoSeedToggle = document.getElementById(`${stageId}_autoSeedToggle`);
        const seedInput = document.getElementById(`${stageId}_seed`);

        if (autoSeedToggle && seedInput) {
            // Store loaded seed in dataset (for auto mode display)
            seedInput.dataset.loadedSeed = stageSeed.seed.toString();

            // Check if we're in inherit mode
            const inheritSeedToggle = document.getElementById(`${stageId}_inheritSeedToggle`);
            const isInheritMode = inheritSeedToggle && inheritSeedToggle.dataset.state === 'on';

            if (!isInheritMode) {
                // Only update UI if not in inherit mode
                autoSeedToggle.classList.remove('hidden');

                // Check if there's already a value set (from advanced config)
                if (!seedInput.value) {
                    // No explicit value - update placeholder based on current auto seed state
                    const currentAutoSeedState = autoSeedToggle.dataset.state;
                    if (currentAutoSeedState === 'on') {
                        // Auto mode: show seed in placeholder
                        seedInput.placeholder = stageSeed.seed.toString();
                    }
                }
                // If seedInput.value exists, it means a locked seed was loaded from advanced config - don't override
            }
        }
    }

    // Initialize inherited states
    updateStageDropdownInheritedState(stageId);
    updateStageResetButtonVisibility(stageId);

    if (stageData.managed) {
        applyManagedPipelineStageUi(stageId, true);
    }
}

/**
 * Hide stage indicators
 */
function hideStageIndicators() {
    const container = document.getElementById('manualStageIndicators');
    if (container) {
        container.classList.add('hidden');
        container.innerHTML = '';
    }
}

