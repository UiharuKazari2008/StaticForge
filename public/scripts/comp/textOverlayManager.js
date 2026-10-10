/**
 * Text Overlay Manager (Wave 2 — app.js refactor)
 *
 * Text overlay CRUD, dropdowns, and per-item toolbar handlers.
 * Extracted from public/scripts/app.js; originals remain until manifest removal.
 *
 * Dependencies: manualModalManager.js (textOverlaysContainer, textOverlayCounter),
 *   app.js (STAGE_TYPES, calculateStageHexId, getPipelineStages), dropdown.js
 */

function addTextOverlay() {
    const textOverlayId = `text_overlay_${textOverlayCounter++}`;

    const textOverlayItem = document.createElement('div');
    textOverlayItem.className = 'text-overlay-item';
    textOverlayItem.id = textOverlayId;
    textOverlayItem.dataset.stages = '00'; // Initialize with base stage
    textOverlayItem.dataset.targetIndex = '0';
    textOverlayItem.dataset.textType = 'speech';

    textOverlayItem.innerHTML = `
        <div class="prompt-textarea-container text-overlay-prompt">
            <div class="prompt-textarea-background"></div>
            <textarea id="${textOverlayId}_text" class="form-control prompt-textarea" placeholder="Enter text to overlay..." autocapitalize="false" autocorrect="false" spellcheck="false" data-ms-editor="false"></textarea>
            <div class="prompt-status-icons">
                <div class="text-overlay-status-left">
                    <i id="${textOverlayId}_status_type_icon" class="fas fa-comment-lines"></i>
                    <span class="text-overlay-label">Text Overlay</span>
                </div>
                <div class="text-overlay-status-right">
                    <i id="${textOverlayId}_status_target_icon" class="fas fa-user" style="display: none;" title="Target"></i>
                    <i id="${textOverlayId}_status_stage_icon" class="fas fa-layer-group" style="display: none;" title="Pipeline Stage"></i>
                </div>
            </div>
            <div class="prompt-textarea-toolbar hidden">
                <div class="toolbar-left">
                </div>
                <div class="toolbar-right">
                    <div class="toolbar-regular-buttons">
                        <div id="${textOverlayId}_target_dropdown" class="custom-dropdown dark dropright" style="display: none;">
                            <button type="button" id="${textOverlayId}_target_btn" class="btn-secondary btn-small toolbar-btn" title="Target">
                                <span id="${textOverlayId}_target_display">Base</span>
                            </button>
                            <div id="${textOverlayId}_target_menu" class="custom-dropdown-menu min-dropdown-width hidden"></div>
                        </div>
                        <div id="${textOverlayId}_stage_dropdown" class="custom-dropdown dark dropright" style="display: none;">
                            <button type="button" id="${textOverlayId}_stage_btn" class="btn-secondary btn-small toolbar-btn" title="Pipeline Stage">
                                <span id="${textOverlayId}_stage_display">Base</span>
                            </button>
                            <div id="${textOverlayId}_stage_menu" class="custom-dropdown-menu min-dropdown-width hidden"></div>
                        </div>
                        <div id="${textOverlayId}_type_dropdown" class="custom-dropdown dark dropright">
                            <button type="button" id="${textOverlayId}_type_btn" class="btn-secondary btn-small toolbar-btn" title="Text Type">
                                <i class="fas fa-comment-lines"></i>
                            </button>
                            <div id="${textOverlayId}_type_menu" class="custom-dropdown-menu text-overlay-type-menu hidden"></div>
                        </div>
                        <div class="divider"></div>
                        <button type="button" class="btn-secondary btn-small toolbar-btn indicator" id="${textOverlayId}_enabled" data-state="on" title="Enable/Disable">
                            <i class="fas fa-power-off"></i>
                        </button>
                        <button type="button" class="btn-danger btn-small toolbar-btn" id="${textOverlayId}_delete" title="Delete">
                            <i class="fas fa-trash-alt"></i>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    textOverlaysContainer.appendChild(textOverlayItem);
    mountTextOverlayCustomDisplay(textOverlayItem);
    textOverlaysContainer.classList.remove('hidden');
    textOverlayItem._overlayModel = {
        text: '',
        target: 0,
        stages: ['00'],
        type: 'speech',
        customText: '',
        disabled: false
    };

    // Setup dropdowns
    setupTextOverlayDropdowns(textOverlayId);

    // Setup click handlers for toolbar displays
    setupTextOverlayToolbarHandlers(textOverlayId);

    // Update all text overlay target dropdowns to reflect current characters
    updateAllTextOverlayTargetDropdowns();
    // Ensure stage dropdown visibility reflects current pipeline
    updateTextOverlayStageVisibility();

    // Update placeholder based on current creative mode state
    updateTextOverlayPlaceholder(textOverlayId);
    // syncNoTextSubToggleForOverlays: public/scripts/comp/manualDropdownManager.js
    syncNoTextSubToggleForOverlays();
}

function setupTextOverlayDropdowns(textOverlayId) {
    // Target dropdown
    const targetDropdown = document.getElementById(`${textOverlayId}_target_dropdown`);
    const targetBtn = document.getElementById(`${textOverlayId}_target_btn`);
    const targetMenu = document.getElementById(`${textOverlayId}_target_menu`);

    if (targetDropdown && targetBtn && targetMenu) {
        setupDropdown(
            targetDropdown,
            targetBtn,
            targetMenu,
            () => renderTextOverlayTargetDropdown(textOverlayId),
            () => {
                const item = document.getElementById(textOverlayId);
                return item ? (item.dataset.targetIndex || '0') : '0';
            },
            { preventFocusTransfer: true }
        );
    }

    // Stage dropdown
    const stageDropdown = document.getElementById(`${textOverlayId}_stage_dropdown`);
    const stageBtn = document.getElementById(`${textOverlayId}_stage_btn`);
    const stageMenu = document.getElementById(`${textOverlayId}_stage_menu`);

    if (stageDropdown && stageBtn && stageMenu) {
        setupDropdown(
            stageDropdown,
            stageBtn,
            stageMenu,
            () => renderTextOverlayStageDropdown(textOverlayId),
            () => {
                const item = document.getElementById(textOverlayId);
                const stages = item.dataset.stages ? item.dataset.stages.split(',').map(s => s.trim()) : ['0'];
                return stages.join(',');
            },
            { preventFocusTransfer: true, multiSelect: true }
        );
    }

    // Text type dropdown
    const typeDropdown = document.getElementById(`${textOverlayId}_type_dropdown`);
    const typeBtn = document.getElementById(`${textOverlayId}_type_btn`);
    const typeMenu = document.getElementById(`${textOverlayId}_type_menu`);

    if (typeDropdown && typeBtn && typeMenu) {
        setupDropdown(
            typeDropdown,
            typeBtn,
            typeMenu,
            () => renderTextOverlayTypeDropdown(textOverlayId),
            () => {
                const item = document.getElementById(textOverlayId);
                return item ? (item.dataset.textType || 'speech') : 'speech';
            },
            { preventFocusTransfer: true }
        );
    }
}

function renderTextOverlayTargetDropdown(textOverlayId) {
    const menu = document.getElementById(`${textOverlayId}_target_menu`);
    const item = document.getElementById(textOverlayId);
    if (!menu || !item) return;

    const selectedValue = item.dataset.targetIndex || '0';
    menu.innerHTML = '';

    // Base option
    const baseOption = document.createElement('div');
    baseOption.className = 'custom-dropdown-option' + (selectedValue === '0' ? ' selected' : '');
    baseOption.dataset.value = '0';
    baseOption.textContent = 'Base';
    baseOption.addEventListener('click', () => {
        selectTextOverlayTarget(textOverlayId, '0', 'Base');
        closeDropdown(menu, document.getElementById(`${textOverlayId}_target_btn`));
    });
    menu.appendChild(baseOption);

    // Character options
    const characterItems = characterPromptsContainer.querySelectorAll('.character-prompt-item');
    characterItems.forEach((charItem, index) => {
        const charName = charItem.dataset.charaName || `Character ${index + 1}`;
        const targetIndex = (index + 1).toString();

        const option = document.createElement('div');
        option.className = 'custom-dropdown-option' + (selectedValue === targetIndex ? ' selected' : '');
        option.dataset.value = targetIndex;
        option.textContent = charName;
        option.addEventListener('click', () => {
            selectTextOverlayTarget(textOverlayId, targetIndex, charName);
            closeDropdown(menu, document.getElementById(`${textOverlayId}_target_btn`));
        });
        menu.appendChild(option);
    });
}

function renderTextOverlayStageDropdown(textOverlayId) {
    const menu = document.getElementById(`${textOverlayId}_stage_menu`);
    const item = document.getElementById(textOverlayId);
    if (!menu || !item) return;

    const selectedStages = item.dataset.stages ? item.dataset.stages.split(',').map(s => s.trim()) : ['00'];
    menu.innerHTML = '';

    // All Stages option
    const allStagesOption = document.createElement('div');
    allStagesOption.className = 'custom-dropdown-option' + (selectedStages.includes('all') ? ' active' : '');
    allStagesOption.dataset.value = 'all';
    allStagesOption.innerHTML = `<span>All Stages</span><i class="fas fa-layer-group" style="margin-left: auto;"></i>`;
    allStagesOption.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleTextOverlayStage(textOverlayId, 'all');
        // Re-render to update active states
        renderTextOverlayStageDropdown(textOverlayId);
    });
    menu.appendChild(allStagesOption);

    // Base option (00)
    const baseOption = document.createElement('div');
    baseOption.className = 'custom-dropdown-option' + (selectedStages.includes('00') ? ' active' : '');
    baseOption.dataset.value = '00';
    baseOption.innerHTML = `<span>00</span><i class="fas fa-egg" style="margin-left: auto;"></i>`;
    baseOption.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleTextOverlayStage(textOverlayId, '00');
        // Re-render to update active states
        renderTextOverlayStageDropdown(textOverlayId);
    });
    menu.appendChild(baseOption);

    // Pipeline stage options - include all stages with hex IDs
    const allStageElements = pipelineStagesContainer?.querySelectorAll('.pipeline-stage-item');
    if (allStageElements) {
        allStageElements.forEach((stageElement, index) => {
            const hexId = calculateStageHexId(stageElement);
            const stageType = stageElement.dataset.stageType;
            const stageIcon = stageType === STAGE_TYPES.EXPAND_CANVAS ? 'mdi mdi-1-25 mdi-relative-scale' : 'fas fa-diagram-venn';

            const option = document.createElement('div');
            option.className = 'custom-dropdown-option' + (selectedStages.includes(hexId) ? ' active' : '');
            option.dataset.value = hexId;
            option.innerHTML = `<span>${hexId}</span><i class="${stageIcon}" style="margin-left: auto;"></i>`;
            option.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleTextOverlayStage(textOverlayId, hexId);
                // Re-render to update active states
                renderTextOverlayStageDropdown(textOverlayId);
            });
            menu.appendChild(option);
        });
    }
}

function textOverlayIconClass(typeKey) {
    // resolveTextDisplayStyle: public/scripts/comp/textDisplayStyles.js
    const resolved = typeof resolveTextDisplayStyle === 'function' ? resolveTextDisplayStyle(typeKey) : null;
    const id = resolved ? resolved.id : typeKey;
    const configuredIcon = window.optionsData?.text_tags?.[id]?.icon;
    if (configuredIcon) return configuredIcon;
    return (resolved && resolved.icon) || 'fas fa-comment-lines';
}

function textOverlayCustomDisplayMarkup(textOverlayId) {
    return `<input type="text" id="${textOverlayId}_custom_display" class="form-control hover-show colored text-overlay-custom-display hidden" data-autofill-enable="tags" placeholder="Display tags, e.g. english text, neon sign" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">`;
}

function mountTextOverlayCustomDisplay(item) {
    if (!item) return null;
    let input = document.getElementById(`${item.id}_custom_display`);
    if (!input) {
        item.insertAdjacentHTML('beforeend', textOverlayCustomDisplayMarkup(item.id));
        input = document.getElementById(`${item.id}_custom_display`);
    }
    wireTextOverlayCustomDisplay(item.id);
    return input;
}

function wireTextOverlayCustomDisplay(textOverlayId) {
    const input = document.getElementById(`${textOverlayId}_custom_display`);
    const item = document.getElementById(textOverlayId);
    if (!input || !item || input.dataset.wired === '1') return;
    input.dataset.wired = '1';
    input.addEventListener('input', (e) => {
        ensureTextOverlayModel(item).customText = input.value.trim();
        // handleCharacterAutocompleteInput: public/scripts/comp/autocompleteUtils.js
        if (typeof handleCharacterAutocompleteInput === 'function') handleCharacterAutocompleteInput(e);
    });
    input.addEventListener('keydown', (e) => {
        // handleCharacterAutocompleteKeydown: public/scripts/comp/autocompleteUtils.js
        if (typeof handleCharacterAutocompleteKeydown === 'function') handleCharacterAutocompleteKeydown(e);
    });
    input.addEventListener('blur', () => {
        ensureTextOverlayModel(item).customText = input.value.trim();
    });
}

function syncTextOverlayCustomDisplay(textOverlayId) {
    const item = document.getElementById(textOverlayId);
    if (!item) return;
    const input = mountTextOverlayCustomDisplay(item);
    if (!input) return;
    const resolved = typeof resolveTextDisplayStyle === 'function' ? resolveTextDisplayStyle(item.dataset.textType || 'speech') : null;
    const isCustom = (resolved && resolved.id === 'custom') || item.dataset.textType === 'custom';
    input.classList.toggle('hidden', !isCustom);
    const model = ensureTextOverlayModel(item);
    if (document.activeElement !== input) {
        input.value = model.customText || '';
    }
}

function renderTextOverlayTypeDropdown(textOverlayId) {
    const menu = document.getElementById(`${textOverlayId}_type_menu`);
    const item = document.getElementById(textOverlayId);
    if (!menu || !item) return;

    const selected = typeof resolveTextDisplayStyle === 'function'
        ? resolveTextDisplayStyle(item.dataset.textType || 'speech')
        : null;
    const selectedId = selected ? selected.id : (item.dataset.textType || 'speech');
    menu.innerHTML = '';

    // groupTextDisplayStyles: public/scripts/comp/textDisplayStyles.js
    const configured = window.optionsData?.text_tags || {};
    const groups = typeof groupTextDisplayStyles === 'function'
        ? groupTextDisplayStyles(configured)
        : [{ group: 'Bubbles', styles: [] }];

    groups.forEach((group) => {
        const header = document.createElement('div');
        header.className = 'custom-dropdown-group';
        header.textContent = group.group;
        menu.appendChild(header);
        (group.styles || []).forEach((style) => {
            const option = document.createElement('div');
            option.className = 'custom-dropdown-option' + (selectedId === style.id ? ' selected' : '');
            option.dataset.value = style.id;
            const nameSpan = document.createElement('span');
            nameSpan.textContent = style.name || style.id;
            option.appendChild(nameSpan);
            const iconEl = document.createElement('i');
            iconEl.className = style.icon || 'fas fa-comment-lines';
            iconEl.style.marginLeft = 'auto';
            option.appendChild(iconEl);
            option.addEventListener('click', () => {
                selectTextOverlayType(textOverlayId, style.id, style.name);
                closeDropdown(menu, document.getElementById(`${textOverlayId}_type_btn`));
            });
            menu.appendChild(option);
        });
    });
}

function setupTextOverlayToolbarHandlers(textOverlayId) {
    const item = document.getElementById(textOverlayId);
    const textarea = document.getElementById(`${textOverlayId}_text`);

    // Enable/disable button handler
    const enableBtn = document.getElementById(`${textOverlayId}_enabled`);
    if (enableBtn) {
        item._enabledBtn = enableBtn;
        enableBtn.addEventListener('click', () => {
            toggleTextOverlayEnabled(textOverlayId);
        });
    }

    // Delete button handler
    const deleteBtn = document.getElementById(`${textOverlayId}_delete`);
    if (deleteBtn) {
        deleteBtn.addEventListener('click', () => {
            deleteTextOverlay(textOverlayId);
        });
    }

    // Auto-resize functionality
    if (textarea) {
        item._textArea = textarea;
        autoResizeTextarea(textarea, 10);
        textarea.addEventListener('input', () => {
            autoResizeTextarea(textarea, 10);
            // Textarea is the editing source while focused — keep model text in sync
            if (document.activeElement === textarea) {
                const model = ensureTextOverlayModel(item);
                model.text = textOverlayDisplayToNewlines(textarea.value).trim();
            }
        });

        // Store original value with actual newlines before any conversion
        if (!textarea.dataset.originalValue) {
            textarea.dataset.originalValue = textOverlayDisplayToNewlines(textarea.value);
        }
        ensureTextOverlayModel(item).text = textOverlayDisplayToNewlines(textarea.dataset.originalValue || textarea.value || '').trim();

        // Convert newlines to display character when losing focus
        textarea.addEventListener('blur', () => {
            const stored = textOverlayDisplayToNewlines(textarea.value);
            textarea.dataset.originalValue = stored;
            ensureTextOverlayModel(item).text = stored.trim();
            const displayValue = textOverlayNewlinesToDisplay(stored);
            if (displayValue !== textarea.value) {
                textarea.value = displayValue;
            }
        });

        // Convert display character back to newlines when gaining focus
        textarea.addEventListener('focus', () => {
            const currentValue = textarea.value;
            const originalValue = textOverlayDisplayToNewlines(currentValue);
            if (originalValue !== currentValue) {
                // Restore cursor position as much as possible
                const cursorPosition = textarea.selectionStart;
                textarea.value = originalValue;
                // Try to maintain approximate cursor position
                const originalLength = currentValue.length;
                const newLength = originalValue.length;
                if (originalLength > 0) {
                    const ratio = cursorPosition / originalLength;
                    const newPosition = Math.floor(ratio * newLength);
                    textarea.setSelectionRange(newPosition, newPosition);
                }
            }
            // Update stored original value
            textarea.dataset.originalValue = originalValue;
            ensureTextOverlayModel(item).text = originalValue.trim();
        });

        // Initialize: convert newlines to display character if not focused
        if (document.activeElement !== textarea) {
            const currentValue = textarea.value;
            const stored = textOverlayDisplayToNewlines(currentValue);
            if (stored.includes('\n')) {
                textarea.value = textOverlayNewlinesToDisplay(stored);
                textarea.dataset.originalValue = stored;
                ensureTextOverlayModel(item).text = stored.trim();
            }
        }
    }
}

function selectTextOverlayTarget(textOverlayId, targetIndex, targetName) {
    const item = document.getElementById(textOverlayId);
    const targetDisplay = document.getElementById(`${textOverlayId}_target_display`);

    if (item && targetDisplay) {
        item.dataset.targetIndex = targetIndex;
        targetDisplay.textContent = targetName;
        ensureTextOverlayModel(item).target = parseInt(targetIndex, 10) || 0;
    }
}

function toggleTextOverlayStage(textOverlayId, stageId) {
    const item = document.getElementById(textOverlayId);

    if (item) {
        // Get current stages as array
        const currentStages = item.dataset.stages ? item.dataset.stages.split(',').map(s => s.trim()) : ['00'];

        let newStages;
        if (stageId === 'all') {
            // All Stages - if selecting all, clear everything else and set to *
            newStages = ['all'];
        } else {
            // Remove "All Stages" if it exists and we're selecting specific stages
            newStages = currentStages.filter(s => s !== 'all');

            // Toggle the selected stage
            if (newStages.includes(stageId)) {
                newStages = newStages.filter(s => s !== stageId);
                // If no stages left, default to base (00)
                if (newStages.length === 0) {
                    newStages = ['00'];
                }
            } else {
                newStages.push(stageId);
            }
        }

        // Store as comma-separated string
        item.dataset.stages = newStages.join(',');
        ensureTextOverlayModel(item).stages = newStages.slice();

        // Update display text
        updateTextOverlayStageDisplay(textOverlayId);
    }
}

function updateTextOverlayStageDisplay(textOverlayId) {
    const item = document.getElementById(textOverlayId);
    const stageDisplay = document.getElementById(`${textOverlayId}_stage_display`);

    if (item && stageDisplay) {
        const stages = item.dataset.stages ? item.dataset.stages.split(',').map(s => s.trim()) : ['00'];

        let displayText;
        if (stages.length === 1 && stages[0] === 'all') {
            displayText = 'All Stages';
        } else if (stages.length === 1 && stages[0] === '00') {
            displayText = '00';
        } else {
            // Group sequential stages into ranges
            displayText = groupSequentialStages(stages);
        }

        stageDisplay.textContent = displayText;
    }
}

/**
 * Groups sequential hex stage IDs into ranges
 * Example: ['00', '01', '02', '05', '06'] -> '00-02, 05-06'
 * Example: ['01', '03', '05'] -> '01, 03, 05'
 */
function groupSequentialStages(stages) {
    if (stages.length === 0) return '';
    if (stages.length === 1) return stages[0];

    // Sort stages by their hex value
    const sorted = stages.slice().sort((a, b) => {
        // Handle special cases
        if (a === 'all') return -1;
        if (b === 'all') return 1;

        // Convert hex to number for comparison
        const aVal = parseInt(a, 16);
        const bVal = parseInt(b, 16);
        return aVal - bVal;
    });

    const ranges = [];
    let rangeStart = sorted[0];
    let rangeEnd = sorted[0];

    for (let i = 1; i < sorted.length; i++) {
        const current = sorted[i];
        const prev = sorted[i - 1];

        // Check if current is sequential to previous
        const currentVal = parseInt(current, 16);
        const prevVal = parseInt(prev, 16);

        if (currentVal === prevVal + 1) {
            // Continue the range
            rangeEnd = current;
        } else {
            // End current range and start new one
            if (rangeStart === rangeEnd) {
                ranges.push(rangeStart);
            } else {
                ranges.push(`${rangeStart}-${rangeEnd}`);
            }
            rangeStart = current;
            rangeEnd = current;
        }
    }

    // Add the last range
    if (rangeStart === rangeEnd) {
        ranges.push(rangeStart);
    } else {
        ranges.push(`${rangeStart}-${rangeEnd}`);
    }

    return ranges.join(', ');
}

function selectTextOverlayType(textOverlayId, typeKey, typeName) {
    const item = document.getElementById(textOverlayId);
    const typeBtn = document.getElementById(`${textOverlayId}_type_btn`);
    const statusTypeIcon = document.getElementById(`${textOverlayId}_status_type_icon`);

    if (item && typeBtn) {
        item.dataset.textType = typeKey;
        const model = ensureTextOverlayModel(item);
        model.type = typeKey;

        const typeIconClass = textOverlayIconClass(typeKey);

        // Update toolbar button icon
        const icon = typeBtn.querySelector('i');
        if (icon) {
            icon.className = typeIconClass;
        }

        // Update status icon
        if (statusTypeIcon) {
            statusTypeIcon.className = typeIconClass;
        }

        // Update placeholder based on new type and creative mode state
        updateTextOverlayPlaceholder(textOverlayId);
        syncTextOverlayCustomDisplay(textOverlayId);
    }
}

function updateTextOverlayPlaceholder(textOverlayId) {
    const textArea = document.getElementById(`${textOverlayId}_text`);
    const item = document.getElementById(textOverlayId);
    if (!textArea || !item) return;

    const creativeBtn = document.getElementById('creativeBtn');
    const isCreativeEnabled = creativeBtn && creativeBtn.dataset.state === 'on';
    const textType = item.dataset.textType || 'speech';

    if (isCreativeEnabled) {
        // Set placeholder to match the text type for creative mode
        const typeUpper = textType.toUpperCase();
        textArea.placeholder = `[${typeUpper}_TEXT_INSERT]`;
    } else {
        // Reset to default placeholder when creative is off
        textArea.placeholder = 'Hello, how are you?';
    }
}

function updateAllTextOverlayPlaceholders() {
    const textOverlayItems = textOverlaysContainer.querySelectorAll('.text-overlay-item');
    textOverlayItems.forEach(item => {
        updateTextOverlayPlaceholder(item.id);
    });
}

function toggleTextOverlayEnabled(textOverlayId) {
    const enabledBtn = document.getElementById(`${textOverlayId}_enabled`);
    const item = document.getElementById(textOverlayId);

    if (enabledBtn && item) {
        const currentState = enabledBtn.getAttribute('data-state');
        const newState = currentState === 'on' ? 'off' : 'on';
        enabledBtn.setAttribute('data-state', newState);

        if (newState === 'off') {
            item.classList.add('text-overlay-disabled');
        } else {
            item.classList.remove('text-overlay-disabled');
        }
        ensureTextOverlayModel(item).disabled = newState === 'off';
        // syncNoTextSubToggleForOverlays: public/scripts/comp/manualDropdownManager.js
        syncNoTextSubToggleForOverlays();
    }
}

function deleteTextOverlay(textOverlayId) {
    const item = document.getElementById(textOverlayId);
    if (item) {
        // teardownDropdown: public/scripts/comp/dropdown.js
        item.querySelectorAll('.custom-dropdown').forEach((dropdown) => {
            teardownDropdown(dropdown);
        });
        item.remove();

        // Hide container if no more text overlays
        const remainingItems = textOverlaysContainer.querySelectorAll('.text-overlay-item');
        if (remainingItems.length === 0) {
            textOverlaysContainer.classList.add('hidden');
        }
    }
    // syncNoTextSubToggleForOverlays: public/scripts/comp/manualDropdownManager.js
    syncNoTextSubToggleForOverlays();
}

function clearTextOverlays() {
    textOverlaysContainer.querySelectorAll('.custom-dropdown').forEach((dropdown) => {
        // teardownDropdown: public/scripts/comp/dropdown.js
        teardownDropdown(dropdown);
    });
    textOverlaysContainer.innerHTML = '';
    textOverlaysContainer.classList.add('hidden');
    textOverlayCounter = 0;
    // syncNoTextSubToggleForOverlays: public/scripts/comp/manualDropdownManager.js
    syncNoTextSubToggleForOverlays();
}

function updateAllTextOverlayTargetDropdowns() {
    const textOverlayItems = textOverlaysContainer.querySelectorAll('.text-overlay-item');
    const hasCharacters = characterPromptsContainer.querySelectorAll('.character-prompt-item').length > 0;

    textOverlayItems.forEach(item => {
        const textOverlayId = item.id;
        const targetDropdown = document.getElementById(`${textOverlayId}_target_dropdown`);
        const targetDisplay = document.getElementById(`${textOverlayId}_target_display`);
        const targetStatusIcon = document.getElementById(`${textOverlayId}_status_target_icon`);

        if (targetDropdown) {
            if (hasCharacters) {
                targetDropdown.style.display = '';
                if (targetStatusIcon) {
                    targetStatusIcon.style.display = '';
                }
            } else {
                targetDropdown.style.display = 'none';
                if (targetStatusIcon) {
                    targetStatusIcon.style.display = 'none';
                }
                // Reset to base if hidden
                item.dataset.targetIndex = '0';
                if (targetDisplay) {
                    targetDisplay.textContent = 'Base';
                }
            }
        }
    });
}

function updateTextOverlayStageVisibility() {
    const textOverlayItems = textOverlaysContainer.querySelectorAll('.text-overlay-item');
    const pipelineStages = getPipelineStages();
    // Show stage dropdown if there are any pipeline stages
    const hasStages = pipelineStages && pipelineStages.length > 0;

    textOverlayItems.forEach(item => {
        const textOverlayId = item.id;
        const stageDropdown = document.getElementById(`${textOverlayId}_stage_dropdown`);
        const stageDisplay = document.getElementById(`${textOverlayId}_stage_display`);
        const stageStatusIcon = document.getElementById(`${textOverlayId}_status_stage_icon`);

        if (stageDropdown) {
            if (hasStages) {
                stageDropdown.style.display = '';
                if (stageStatusIcon) {
                    stageStatusIcon.style.display = '';
                }
            } else {
                stageDropdown.style.display = 'none';
                if (stageStatusIcon) {
                    stageStatusIcon.style.display = 'none';
                }
                // Reset to base stage if hidden
                item.dataset.stages = '00';
                if (stageDisplay) {
                    stageDisplay.textContent = '00';
                }
            }
        }
    });
}

// ⏎ is a display stand-in for a newline in an unfocused overlay box. It is not prompt text.
function textOverlayNewlinesToDisplay(text) {
    return String(text || '').replace(/\n/g, ' \u23CE ');
}

function textOverlayDisplayToNewlines(text) {
    const value = String(text || '');
    if (value.indexOf('\u23CE') === -1) return value;
    return value.replace(/[ \t]*\u23CE[ \t]*/g, '\n');
}

function ensureTextOverlayModel(item) {
    if (!item._overlayModel) {
        const textarea = item._textArea || document.getElementById(`${item.id}_text`);
        if (textarea) item._textArea = textarea;
        let text = '';
        if (textarea) {
            if (textarea.dataset.originalValue !== undefined && textarea.dataset.originalValue !== '') {
                text = textOverlayDisplayToNewlines(textarea.dataset.originalValue).trim();
            } else {
                text = textOverlayDisplayToNewlines(textarea.value || '').trim();
            }
        }
        const enabledBtn = item._enabledBtn || document.getElementById(`${item.id}_enabled`);
        if (enabledBtn) item._enabledBtn = enabledBtn;
        item._overlayModel = {
            text,
            target: parseInt(item.dataset.targetIndex || '0', 10) || 0,
            stages: item.dataset.stages ? item.dataset.stages.split(',').map(s => s.trim()) : ['00'],
            type: item.dataset.textType || 'speech',
            customText: item.dataset.customText || '',
            disabled: enabledBtn ? enabledBtn.getAttribute('data-state') !== 'on' : item.classList.contains('text-overlay-disabled')
        };
    }
    return item._overlayModel;
}

/**
 * Read overlay payload from the in-memory model on each card.
 * Textarea is the editing source only while focused — sync from it then;
 * otherwise trust model.text (kept on blur/input).
 */
function getTextOverlayData() {
    const textOverlayItems = textOverlaysContainer.querySelectorAll('.text-overlay-item');
    const textOverlays = [];

    // Cache dynamic-generation toggle once for empty-overlay filter
    const dynamicGenerationToggleBtn = document.getElementById('dynamicGenerationToggleBtn');
    const isDynamicGenerationEnabled = dynamicGenerationToggleBtn?.getAttribute('data-state') === 'open';

    textOverlayItems.forEach(item => {
        const model = ensureTextOverlayModel(item);
        const textarea = item._textArea || document.getElementById(`${item.id}_text`);
        if (textarea) item._textArea = textarea;

        // Sync text from the textarea only when it is the editing source
        if (textarea && document.activeElement === textarea) {
            const liveText = textOverlayDisplayToNewlines(textarea.value);
            model.text = liveText.trim();
            textarea.dataset.originalValue = liveText;
        } else if (textarea && textarea.value) {
            // Programmatic .value edits skip the input/blur sync; unfocused value may be the ⏎ display form
            const valueText = textOverlayDisplayToNewlines(textarea.value).trim();
            if (valueText && valueText !== model.text) model.text = valueText;
        }

        // Keep metadata from dataset (authoritative for target/stages/type) mirrored on model
        model.target = parseInt(item.dataset.targetIndex || '0', 10) || 0;
        const stagesRaw = item.dataset.stages ? item.dataset.stages.split(',').map(s => s.trim()) : ['00'];
        model.stages = stagesRaw.includes('all') ? ['all'] : stagesRaw;
        model.type = item.dataset.textType || 'speech';
        const customInput = document.getElementById(`${item.id}_custom_display`);
        if (customInput) model.customText = customInput.value.trim();
        const enabledBtn = item._enabledBtn || document.getElementById(`${item.id}_enabled`);
        if (enabledBtn) {
            item._enabledBtn = enabledBtn;
            model.disabled = enabledBtn.getAttribute('data-state') !== 'on';
        }

        let text = textOverlayDisplayToNewlines(model.text || '').trim();

        // If text is empty, use the placeholder
        if (!text && textarea) {
            text = textarea.placeholder;
        }

        // Skip empty overlays unless both the overlay AND Rentan are enabled
        if (!text) {
            if (!isDynamicGenerationEnabled) {
                return;
            }
        }

        const row = {
            text: text,
            target: model.target,
            stages: model.stages,
            type: model.type,
            disabled: model.disabled
        };
        const resolvedType = typeof resolveTextDisplayStyle === 'function' ? resolveTextDisplayStyle(model.type) : null;
        if ((resolvedType && resolvedType.id === 'custom') || model.type === 'custom') {
            row.type = 'custom';
            row.customText = model.customText || '';
        }
        textOverlays.push(row);
    });

    return textOverlays;
}

function applyTextOverlayDataToCard(item, overlayData) {
    const textOverlayId = item.id;
    const textarea = item._textArea || document.getElementById(`${textOverlayId}_text`);
    const enabledBtn = item._enabledBtn || document.getElementById(`${textOverlayId}_enabled`);
    if (textarea) item._textArea = textarea;
    if (enabledBtn) item._enabledBtn = enabledBtn;

    const text = overlayData.text || '';
    item.dataset.targetIndex = (overlayData.target || 0).toString();
    const stageValue = overlayData.stage || 0;
    const stagesArray = overlayData.stages || (stageValue === 0 ? [] : [stageValue.toString()]);
    const stagesStored = stagesArray.length === 0 ? '00' : stagesArray.join(',');
    item.dataset.stages = stagesStored;
    const resolvedIncoming = typeof resolveTextDisplayStyle === 'function'
        ? resolveTextDisplayStyle(overlayData.type || 'speech')
        : null;
    const typeKey = resolvedIncoming ? resolvedIncoming.id : (overlayData.type || 'speech');
    item.dataset.textType = typeKey;
    const incomingCustom = overlayData.customText || overlayData.custom || overlayData.display || '';
    item.dataset.customText = incomingCustom;

    if (overlayData.disabled) {
        item.classList.add('text-overlay-disabled');
    } else {
        item.classList.remove('text-overlay-disabled');
    }

    if (enabledBtn) {
        enabledBtn.setAttribute('data-state', overlayData.disabled ? 'off' : 'on');
    }

    if (textarea) {
        textarea.dataset.originalValue = text;
        if (document.activeElement === textarea) {
            textarea.value = text;
        } else {
            textarea.value = text.includes('\n') ? textOverlayNewlinesToDisplay(text) : text;
        }
        autoResizeTextarea(textarea, 10);
    }

    const typeIconClass = textOverlayIconClass(typeKey);
    const typeBtn = document.getElementById(`${textOverlayId}_type_btn`);
    const statusTypeIcon = document.getElementById(`${textOverlayId}_status_type_icon`);
    if (typeBtn) {
        const icon = typeBtn.querySelector('i');
        if (icon) icon.className = typeIconClass;
    }
    if (statusTypeIcon) {
        statusTypeIcon.className = typeIconClass;
    }

    // Target display name
    const targetIndex = overlayData.target || 0;
    let targetName = 'Base';
    if (targetIndex > 0) {
        const characterItems = characterPromptsContainer.querySelectorAll('.character-prompt-item');
        const charItem = characterItems[targetIndex - 1];
        if (charItem) {
            targetName = charItem.dataset.charaName || `Character ${targetIndex}`;
        }
    }
    const targetDisplay = document.getElementById(`${textOverlayId}_target_display`);
    if (targetDisplay) {
        targetDisplay.textContent = targetName;
    }

    item._overlayModel = {
        text: text.trim(),
        target: targetIndex,
        stages: stagesArray.length === 0 ? ['00'] : stagesArray.slice(),
        type: typeKey,
        customText: incomingCustom,
        disabled: !!overlayData.disabled
    };
    syncTextOverlayCustomDisplay(textOverlayId);

    updateTextOverlayStageDisplay(textOverlayId);
    updateTextOverlayPlaceholder(textOverlayId);
}

function createTextOverlayFromData(overlayData) {
    const textOverlayId = `text_overlay_${textOverlayCounter++}`;

    const textOverlayItem = document.createElement('div');
    textOverlayItem.className = 'text-overlay-item';
    if (overlayData.disabled) {
        textOverlayItem.classList.add('text-overlay-disabled');
    }
    textOverlayItem.id = textOverlayId;
    textOverlayItem.dataset.targetIndex = (overlayData.target || 0).toString();
    // Initialize stages - for backward compatibility, convert single stage to stages array
    const stageValue = overlayData.stage || 0;
    const stagesArray = overlayData.stages || (stageValue === 0 ? [] : [stageValue.toString()]);
    textOverlayItem.dataset.stages = stagesArray.length === 0 ? '00' : stagesArray.join(',');
    const createdStyle = typeof resolveTextDisplayStyle === 'function'
        ? resolveTextDisplayStyle(overlayData.type || 'speech')
        : null;
    const createdType = createdStyle ? createdStyle.id : (overlayData.type || 'speech');
    textOverlayItem.dataset.textType = createdType;
    textOverlayItem.dataset.customText = overlayData.customText || overlayData.custom || overlayData.display || '';

    const targetIndex = overlayData.target || 0;

    // Get target name
    let targetName = 'Base';
    if (targetIndex > 0) {
        const characterItems = characterPromptsContainer.querySelectorAll('.character-prompt-item');
        const charItem = characterItems[targetIndex - 1];
        if (charItem) {
            targetName = charItem.dataset.charaName || `Character ${targetIndex}`;
        }
    }

    const typeIcon = textOverlayIconClass(createdType);

    // Determine stage display text
    const stages = stagesArray.length === 0 ? ['00'] : stagesArray;
    let stageDisplayText = '00';
    if (stages.length === 1 && stages[0] === 'all') {
        stageDisplayText = 'All Stages';
    } else if (stages.length === 1) {
        stageDisplayText = stages[0];
    } else {
        stageDisplayText = groupSequentialStages(stages);
    }

    textOverlayItem.innerHTML = `
            <div class="prompt-textarea-container text-overlay-prompt">
                <div class="prompt-textarea-background"></div>
                <textarea id="${textOverlayId}_text" class="form-control prompt-textarea" placeholder="Enter text to overlay..." autocapitalize="false" autocorrect="false" spellcheck="false" rows="1" data-ms-editor="false">${escapeHtml(overlayData.text || '')}</textarea>
                <div class="prompt-status-icons">
                    <div class="text-overlay-status-left">
                        <i id="${textOverlayId}_status_type_icon" class="${typeIcon}"></i>
                        <span class="text-overlay-label">Text Overlay</span>
                    </div>
                    <div class="text-overlay-status-right">
                        <i id="${textOverlayId}_status_target_icon" class="fas fa-user" style="display: none;" title="Target"></i>
                        <i id="${textOverlayId}_status_stage_icon" class="fas fa-layer-group" style="display: none;" title="Pipeline Stage"></i>
                    </div>
                </div>
                <div class="prompt-textarea-toolbar hidden">
                    <div class="toolbar-left">
                    </div>
                    <div class="toolbar-right">
                        <div class="toolbar-regular-buttons">
                            <div id="${textOverlayId}_target_dropdown" class="custom-dropdown dark dropright" style="display: none;">
                                <button type="button" id="${textOverlayId}_target_btn" class="btn-secondary btn-small toolbar-btn" title="Target">
                                    <span id="${textOverlayId}_target_display">${targetName}</span>
                                </button>
                                <div id="${textOverlayId}_target_menu" class="custom-dropdown-menu min-dropdown-width hidden"></div>
                            </div>
                            <div id="${textOverlayId}_stage_dropdown" class="custom-dropdown dark dropright" style="display: none;">
                                <button type="button" id="${textOverlayId}_stage_btn" class="btn-secondary btn-small toolbar-btn" title="Pipeline Stage">
                                    <span id="${textOverlayId}_stage_display">${stageDisplayText}</span>
                                </button>
                                <div id="${textOverlayId}_stage_menu" class="custom-dropdown-menu min-dropdown-width hidden"></div>
                            </div>
                            <div id="${textOverlayId}_type_dropdown" class="custom-dropdown dark dropright">
                                <button type="button" id="${textOverlayId}_type_btn" class="btn-secondary btn-small toolbar-btn" title="Text Type">
                                    <i class="${typeIcon}"></i>
                                </button>
                                <div id="${textOverlayId}_type_menu" class="custom-dropdown-menu text-overlay-type-menu hidden"></div>
                            </div>
                            <div class="divider"></div>
                            <button type="button" class="btn-secondary btn-small toolbar-btn indicator" id="${textOverlayId}_enabled" data-state="${overlayData.disabled ? 'off' : 'on'}" title="Enable/Disable">
                                <i class="fas fa-power-off"></i>
                            </button>
                            <button type="button" class="btn-danger btn-small toolbar-btn" id="${textOverlayId}_delete" title="Delete">
                                <i class="fas fa-trash-alt"></i>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;

    textOverlaysContainer.appendChild(textOverlayItem);
    textOverlayItem._overlayModel = {
        text: (overlayData.text || '').trim(),
        target: targetIndex,
        stages: stagesArray.length === 0 ? ['00'] : stagesArray.slice(),
        type: createdType,
        customText: textOverlayItem.dataset.customText || '',
        disabled: !!overlayData.disabled
    };
    mountTextOverlayCustomDisplay(textOverlayItem);
    syncTextOverlayCustomDisplay(textOverlayId);
    setupTextOverlayDropdowns(textOverlayId);
    setupTextOverlayToolbarHandlers(textOverlayId);
    updateTextOverlayStageDisplay(textOverlayId);
    return textOverlayItem;
}

function loadTextOverlays(textOverlays) {
    if (!textOverlays || !Array.isArray(textOverlays) || textOverlays.length === 0) {
        clearTextOverlays();
        return;
    }

    const existingById = new Map();
    textOverlaysContainer.querySelectorAll('.text-overlay-item').forEach(item => {
        existingById.set(item.id, item);
    });
    const existingList = Array.from(existingById.values());
    const usedIds = new Set();

    textOverlays.forEach((overlayData, index) => {
        // Diff by id when payload carries one; otherwise reuse existing cards by index
        let item = null;
        if (overlayData.id && existingById.has(overlayData.id)) {
            item = existingById.get(overlayData.id);
        } else if (index < existingList.length) {
            item = existingList[index];
        }

        if (item) {
            usedIds.add(item.id);
            applyTextOverlayDataToCard(item, overlayData);
        } else {
            item = createTextOverlayFromData(overlayData);
            usedIds.add(item.id);
        }
    });

    // Remove cards not present in the new list
    existingById.forEach((item, id) => {
        if (!usedIds.has(id)) {
            deleteTextOverlay(id);
        }
    });

    textOverlaysContainer.classList.remove('hidden');

    // Update visibility of target and stage dropdowns
    updateAllTextOverlayTargetDropdowns();
    updateTextOverlayStageVisibility();
    updateAllTextOverlayPlaceholders();
    // syncNoTextSubToggleForOverlays: public/scripts/comp/manualDropdownManager.js
    syncNoTextSubToggleForOverlays();
}

function extractTextFromPrompt(prompt) {
    if (!prompt) return null;

    // textOverlayExtractPattern: public/scripts/comp/textDisplayStyles.js
    const textPattern = typeof textOverlayExtractPattern === 'function'
        ? textOverlayExtractPattern()
        : /,\s*(?:speech bubble|thought bubble|caption|subtitle)?,?\s*Text:\s*(.+?)$/i;
    const match = prompt.match(textPattern);

    if (match && match[1]) {
        return match[1].trim();
    }

    return null;
}

// addItemDropdown text-overlay option remains in app.js renderAddItemDropdown (calls addTextOverlay).

