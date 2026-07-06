/**
 * Character Prompt Manager (Wave 2 — app.js refactor)
 *
 * Position dialog helpers and auto-position toggle (Phase 1 assets + Wave 2 listeners).
 * Full CRUD, drag/drop, subject-tag sync (Phase 2 batch 12).
 *
 * Dependencies: manualModalManager.js (characterPromptsContainer, currentPositionCharacterId, selectedPositionCell)
 */

function getCellLabelFromCoords(x, y) {
    const positions = {
        '0.1,0.1': 'A1', '0.3,0.1': 'B1', '0.5,0.1': 'C1', '0.7,0.1': 'D1', '0.9,0.1': 'E1',
        '0.1,0.3': 'A2', '0.3,0.3': 'B2', '0.5,0.3': 'C2', '0.7,0.3': 'D2', '0.9,0.3': 'E2',
        '0.1,0.5': 'A3', '0.3,0.5': 'B3', '0.5,0.5': 'C3', '0.7,0.5': 'D3', '0.9,0.5': 'E3',
        '0.1,0.7': 'A4', '0.3,0.7': 'B4', '0.5,0.7': 'C4', '0.7,0.7': 'D4', '0.9,0.7': 'E4',
        '0.1,0.9': 'A5', '0.3,0.9': 'B5', '0.5,0.9': 'C5', '0.7,0.9': 'D5', '0.9,0.9': 'E5'
    };
    return positions[`${x},${y}`] || null;
}

function updateAutoPositionToggle() {
    const characterItems = characterPromptsContainer.querySelectorAll('.character-prompt-item');
    const autoPositionBtn = document.getElementById('autoPositionBtn');

    if (characterItems.length === 0) {
        autoPositionBtn.classList.add('hidden');
        return;
    }

    if (characterItems.length === 1) {
        autoPositionBtn.classList.add('hidden');
        // Force enable auto position for single character
        autoPositionBtn.setAttribute('data-state', 'on');
        // Hide position buttons and move buttons for single character
        characterItems.forEach(item => {
            const positionBtn = item.querySelector('.position-btn');
            const moveUpBtn = item.querySelector('.move-up-btn');
            const moveDownBtn = item.querySelector('.move-down-btn');
            if (positionBtn) positionBtn.classList.add('hidden');
            if (moveUpBtn) moveUpBtn.classList.add('hidden');
            if (moveDownBtn) moveDownBtn.classList.add('hidden');
        });
    } else {
        autoPositionBtn.classList.remove('hidden');
        // Show/hide position buttons based on auto position state
        const isAutoPosition = autoPositionBtn.getAttribute('data-state') === 'on';
        characterItems.forEach((item, index) => {
            const positionBtn = item.querySelector('.position-btn');
            const moveUpBtn = item.querySelector('.move-up-btn');
            const moveDownBtn = item.querySelector('.move-down-btn');

            if (positionBtn) {
                positionBtn.classList.toggle('hidden', isAutoPosition);
            }

            // Show move buttons for multiple characters
            if (moveUpBtn) {
                moveUpBtn.classList.remove('hidden');
                if (index === 0) {
                    moveUpBtn.disabled = true;
                    moveUpBtn.style.opacity = '0.4';
                } else {
                    moveUpBtn.disabled = false;
                    moveUpBtn.style.opacity = '1';
                }
            }
            if (moveDownBtn) {
                moveDownBtn.classList.remove('hidden');
                if (index === characterItems.length - 1) {
                    moveDownBtn.disabled = true;
                    moveDownBtn.style.opacity = '0.4';
                } else {
                    moveDownBtn.disabled = false;
                    moveDownBtn.style.opacity = '1';
                }
            }
        });
    }
}

function getOccupiedPositionCellLabels(excludeCharacterId) {
    const labels = new Set();
    if (!characterPromptsContainer) return labels;
    characterPromptsContainer.querySelectorAll('.character-prompt-item').forEach(item => {
        if (item.id === excludeCharacterId) return;
        const label = item.dataset.positionCell;
        if (label) {
            labels.add(label);
            return;
        }
        const sx = item.dataset.positionX;
        const sy = item.dataset.positionY;
        if (sx !== undefined && sy !== undefined && sx !== '' && sy !== '') {
            const fx = parseFloat(sx);
            const fy = parseFloat(sy);
            if (Number.isFinite(fx) && Number.isFinite(fy)) {
                const inferred = getCellLabelFromCoords(fx, fy);
                if (inferred) labels.add(inferred);
            }
        }
    });
    return labels;
}

function isPositionDialogTopModal() {
    const pd = document.getElementById('positionDialog');
    if (!pd || pd.classList.contains('hidden') || pd.classList.contains('closing')) return false;
    return typeof modalStack !== 'undefined' && modalStack.length > 0 && modalStack[modalStack.length - 1] === pd;
}

function showPositionDialog(characterId) {
    currentPositionCharacterId = characterId;

    const positionDialog = document.getElementById('positionDialog');
    const cells = positionDialog ? positionDialog.querySelectorAll('.position-cell') : [];
    cells.forEach(cell => {
        cell.classList.remove('selected', 'position-cell-occupied');
        cell.removeAttribute('aria-disabled');
    });
    selectedPositionCell = null;

    const occupiedLabels = getOccupiedPositionCellLabels(characterId);
    for (const cell of cells) {
        if (occupiedLabels.has(cell.dataset.cell)) {
            cell.classList.add('position-cell-occupied');
            cell.setAttribute('aria-disabled', 'true');
        }
    }

    const characterItem = document.getElementById(characterId);
    if (characterItem && cells.length) {
        const label = characterItem.dataset.positionCell;
        const sx = characterItem.dataset.positionX;
        const sy = characterItem.dataset.positionY;
        let match = null;
        if (label) {
            for (const cell of cells) {
                if (cell.dataset.cell === label) {
                    match = cell;
                    break;
                }
            }
        }
        if (!match && sx !== undefined && sy !== undefined && sx !== '' && sy !== '') {
            const fx = parseFloat(sx);
            const fy = parseFloat(sy);
            if (Number.isFinite(fx) && Number.isFinite(fy)) {
                for (const cell of cells) {
                    const cx = parseFloat(cell.dataset.x);
                    const cy = parseFloat(cell.dataset.y);
                    if (Number.isFinite(cx) && Number.isFinite(cy) &&
                        Math.abs(fx - cx) < 1e-3 && Math.abs(fy - cy) < 1e-3) {
                        match = cell;
                        break;
                    }
                }
            }
        }
        if (match && !match.classList.contains('position-cell-occupied')) {
            match.classList.add('selected');
            selectedPositionCell = match;
        }
    }

    if (positionDialog && typeof linkToolWindowToParent === 'function') {
        const manualModalEl = document.getElementById('manualModal');
        if (manualModalEl) {
            linkToolWindowToParent(positionDialog, manualModalEl);
        }
    }
    if (positionDialog && typeof openModal === 'function') {
        openModal(positionDialog);
        positionDialog.setAttribute('tabindex', '-1');
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                positionDialog.focus({ preventScroll: true });
            });
        });
    } else if (positionDialog) {
        positionDialog.classList.remove('hidden');
    }
}

function hidePositionDialog() {
    const positionDialog = document.getElementById('positionDialog');
    if (positionDialog) {
        positionDialog.querySelectorAll('.position-cell').forEach(cell => {
            cell.classList.remove('selected', 'position-cell-occupied');
            cell.removeAttribute('aria-disabled');
        });
    }
    currentPositionCharacterId = null;
    selectedPositionCell = null;
    if (!positionDialog) return;
    if (typeof closeModal === 'function' &&
        !positionDialog.classList.contains('hidden') &&
        !positionDialog.classList.contains('closing')) {
        void closeModal(positionDialog);
        return;
    }
    positionDialog.classList.add('hidden');
}

function confirmPosition() {
    if (currentPositionCharacterId && selectedPositionCell) {
        if (selectedPositionCell.classList.contains('position-cell-occupied')) return;
        const x = parseFloat(selectedPositionCell.dataset.x);
        const y = parseFloat(selectedPositionCell.dataset.y);
        const cellLabel = selectedPositionCell.dataset.cell;

        // Update position button text to show current position
        const characterItem = document.getElementById(currentPositionCharacterId);
        const positionBtn = characterItem.querySelector('.position-btn');
        positionBtn.innerHTML = `<i class="fas fa-crosshairs"></i> ${cellLabel}`;

        // Store position data
        characterItem.dataset.positionX = x;
        characterItem.dataset.positionY = y;
        characterItem.dataset.positionCell = cellLabel;

        hidePositionDialog();
    }
}

function handlePositionDialogKeydown(e) {
    if (!isPositionDialogTopModal()) return;
    if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        hidePositionDialog();
        return true;
    }
    if (e.key === 'Enter') {
        const pd = document.getElementById('positionDialog');
        if (e.target.closest('#positionDialog') && e.target.tagName === 'BUTTON') return;
        if (pd && !pd.contains(e.target)) return;
        e.preventDefault();
        e.stopPropagation();
        confirmPosition();
        return true;
    }
}

let positionDialogKeyboardWired = false;

function wirePositionDialogKeyboard() {
    if (positionDialogKeyboardWired) return;
    positionDialogKeyboardWired = true;
    // registerKeyboardListener: public/scripts/comp/modalKeyboardRegistry.js
    registerKeyboardListener({
        id: 'positionDialog.keydown',
        handler: handlePositionDialogKeydown,
        type: 'whenFocused',
        modalId: 'positionDialog',
        priority: 78,
        critical: true,
        showInOverlay: false
    });
    registerModalOverlayEntries('positionDialog', 'Position', [
        { id: 'overlay.positionDialog.confirm', label: 'Confirm', keys: 'Enter', icon: 'fas fa-check' },
        { id: 'overlay.positionDialog.close', label: 'Cancel', keys: 'Esc', icon: 'fas fa-times' }
    ]);
}

function handleCharacterDataConfirmKeydown(e) {
    const modal = document.getElementById('characterDataConfirmModal');
    if (!modal || modal.classList.contains('hidden')) return;

    if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        const closeBtn = document.getElementById('cancelGenerationBtn');
        if (closeBtn && !closeBtn.disabled) closeBtn.click();
        else closeModal(modal);
        return true;
    }

    if (modalKeyboardHandleActionDigits(e, modal, '.modal-actions')) {
        return true;
    }

    if (e.key === 'Enter') {
        return modalKeyboardTriggerPrimaryEnter(e, modal, '.modal-actions .btn-primary:not(:disabled)');
    }
}

let characterDataConfirmKeyboardWired = false;

function characterDataConfirmOverlayDigitsValid() {
    const modal = document.getElementById('characterDataConfirmModal');
    if (!modal || modal.classList.contains('hidden')) return false;
    const buttons = modal.querySelectorAll('.modal-actions button:not(:disabled)');
    return buttons.length >= 2;
}

function characterDataConfirmOverlayEnterValid() {
    const modal = document.getElementById('characterDataConfirmModal');
    if (!modal || modal.classList.contains('hidden')) return false;
    return !!modal.querySelector('.modal-actions .btn-primary:not(:disabled)');
}

function wireCharacterDataConfirmKeyboard() {
    if (characterDataConfirmKeyboardWired) return;
    characterDataConfirmKeyboardWired = true;
    // registerKeyboardListener: public/scripts/comp/modalKeyboardRegistry.js
    registerKeyboardListener({
        id: 'characterDataConfirmModal.keydown',
        handler: handleCharacterDataConfirmKeydown,
        type: 'whenFocused',
        modalId: 'characterDataConfirmModal',
        priority: 82,
        critical: true,
        showInOverlay: false
    });
    registerModalOverlayEntries('characterDataConfirmModal', 'Dialog', [
        { id: 'overlay.characterDataConfirm.escape', label: 'Cancel', keys: 'Esc', icon: 'fas fa-times' },
        { id: 'overlay.characterDataConfirm.enter', label: 'Remove data', keys: 'Enter', icon: 'fas fa-check', overlayValid: characterDataConfirmOverlayEnterValid },
        { id: 'overlay.characterDataConfirm.digits', label: 'Choose option', keys: '1–9', icon: 'fas fa-list-ol', overlayValid: characterDataConfirmOverlayDigitsValid }
    ]);
}

function attachCharacterPromptPositionDialogListeners(signal) {
    const cancelPositionBtn = document.getElementById('cancelPositionBtn');
    const confirmPositionBtn = document.getElementById('confirmPositionBtn');

    if (cancelPositionBtn) {
        cancelPositionBtn.addEventListener('click', (e) => {
            e.preventDefault();
            hidePositionDialog();
        }, { signal });
    }

    if (confirmPositionBtn) {
        confirmPositionBtn.addEventListener('click', (e) => {
            e.preventDefault();
            confirmPosition();
        }, { signal });
    }

    const positionGrid = document.querySelector('#positionDialog .position-grid');
    if (positionGrid) {
        positionGrid.addEventListener('click', (e) => {
            const cell = e.target.closest('.position-cell');
            if (!cell || !positionGrid.contains(cell)) return;
            if (cell.classList.contains('position-cell-occupied')) return;
            e.preventDefault();
            positionGrid.querySelectorAll('.position-cell').forEach(c => c.classList.remove('selected'));
            cell.classList.add('selected');
            selectedPositionCell = cell;
        }, { signal });
    }

}

function attachCharacterPromptManualModalListeners(signal) {
    const autoPositionBtn = document.getElementById('autoPositionBtn');
    if (autoPositionBtn) {
        autoPositionBtn.addEventListener('click', function (e) {
            e.preventDefault();
            const currentState = this.getAttribute('data-state');
            const newState = currentState === 'on' ? 'off' : 'on';
            this.setAttribute('data-state', newState);
            updateAutoPositionToggle();
        }, { signal });
    }
}

function initCharacterPromptListenerScope() {
    const positionDialogEl = document.getElementById('positionDialog');
    const manualModalEl = document.getElementById('manualModal');
    // attachModalListeners: public/scripts/comp/modalListenerScope.js
    if (positionDialogEl) {
        attachModalListeners(positionDialogEl, attachCharacterPromptPositionDialogListeners);
    }
    if (manualModalEl) {
        attachModalListeners(manualModalEl, attachCharacterPromptManualModalListeners);
    }
}

function wireCharacterPromptManager() {
    initCharacterPromptListenerScope();
    wirePositionDialogKeyboard();
    wireCharacterDataConfirmKeyboard();
}

if (typeof wsClient !== 'undefined' && wsClient.registerInitStep) {
    wsClient.registerInitStep(472, 'Character prompt listener scope', async () => {
        wireCharacterPromptManager();
    });
} else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => wireCharacterPromptManager());
} else {
    wireCharacterPromptManager();
}

function buildCharacterUcTabContainerHtml(characterId, ucValue, promptNegativeValue) {
    const uc = escapeHtml(ucValue || '');
    const pn = escapeHtml(promptNegativeValue || '');
    return `
                        <div class="character-prompt-textarea-container">
                            <div class="character-prompt-textarea-background"></div>
                            <div class="prompt-textarea-emphasis-wrap">
                                <textarea id="${characterId}_uc" class="form-control character-prompt-textarea prompt-textarea" placeholder="Enter undesired content..." autocapitalize="false" autocorrect="false" spellcheck="false" data-ms-editor="false">${uc}</textarea>
                            </div>
                            <div class="prompt-textarea-emphasis-wrap">
                                <textarea id="${characterId}_promptNegative" class="form-control character-prompt-textarea prompt-textarea" placeholder="Inline negative (merged into prompt as -1::...::)..." autocapitalize="false" autocorrect="false" spellcheck="false" data-ms-editor="false">${pn}</textarea>
                            </div>
                            <div class="prompt-textarea-toolbar hidden">
                                <div class="toolbar-left">
                                    <div class="token-info-container">
                                        <div class="token-info-top">
                                            <span class="token-count">0 tokens</span>
                                        </div>
                                        <div class="token-progress-bar">
                                            <div class="token-progress-fill">
                                                <div class="token-progress-inner"></div><div class="token-progress-inner-ne"></div>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="toolbar-search-elements">
                                        <div class="text-search-label">Search</div>
                                        <div class="text-search-input-container">
                                            <input type="text" class="text-search-input" placeholder="Find Tag" />
                                        </div>
                                        <div class="text-search-match-count">0</div>
                                    </div>
                                </div>
                                <div class="toolbar-right">
                                    <div class="toolbar-regular-buttons">
                                        <button type="button" class="btn-secondary btn-small toolbar-btn toolbar-wide-btn" data-action="quick-access" title="Quick Access">
                                            <i class="fas fa-book-atlas"></i>
                                        </button>
                                        <button type="button" class="btn-secondary btn-small toolbar-btn toolbar-wide-btn" data-action="search" title="Search">
                                            <i class="fas fa-search"></i>
                                        </button>
                                        <button type="button" class="btn-secondary btn-small toolbar-btn toggle-btn" data-action="autofill" data-state="on" title="Toggle Autofill">
                                            <i class="fas fa-lightbulb"></i>
                                        </button>
                                        <div id="characterUCActionsDropdown_${characterId}" class="custom-dropdown dark dropright">
                                            <button type="button" id="characterUCActionsDropdownBtn_${characterId}" class="btn-secondary btn-small toolbar-btn">
                                                <i class="fas fa-toolbox"></i>
                                            </button>
                                            <div id="characterUCActionsDropdownMenu_${characterId}" class="custom-dropdown-menu hidden">
                                            </div>
                                        </div>
                                    </div>
                                    <div class="toolbar-search-buttons">
                                        <button class="btn-secondary btn-small toolbar-btn text-search-prev" data-action="search-prev" title="Previous"><i class="fas fa-chevron-up"></i></button>
                                        <button class="btn-secondary btn-small toolbar-btn text-search-next" data-action="search-next" title="Next"><i class="fas fa-chevron-down"></i></button>
                                        <button class="btn-secondary btn-small toolbar-btn text-search-close" data-action="search-close" title="Close"><i class="fas fa-times"></i></button>
                                    </div>
                                </div>
                            </div>
                        </div>`;
}

function wireCharacterPromptTextarea(textarea, blurExtra) {
    if (!textarea) return;
    addSafeEventListener(textarea, 'input', handleCharacterAutocompleteInput, 'autocomplete');
    addSafeEventListener(textarea, 'keydown', handleCharacterAutocompleteKeydown, 'keydown');
    addSafeEventListener(textarea, 'focus', () => startEmphasisHighlighting(textarea), 'focus');
    addSafeEventListener(textarea, 'blur', () => {
        if (window.autoFormatOnBlur !== false) applyFormattedText(textarea, true);
        updateEmphasisHighlighting(textarea);
        autoResizeTextarea(textarea);
        stopEmphasisHighlighting();
        if (blurExtra) blurExtra();
    }, 'blur');
    const debouncedResize = debounce(() => autoResizeTextarea(textarea), 50);
    addTextareaInputSideEffect(textarea, debouncedResize, 'resize');
    initializeEmphasisOverlay(textarea);
    // attachPromptTextareaContextMenu: public/scripts/comp/promptTextareaContextMenu.js
    if (attachPromptTextareaContextMenu) {
        attachPromptTextareaContextMenu(textarea);
    }
}

function addCharacterPrompt() {
    const characterId = `character_${characterPromptCounter++}`;

    // Get the current main window tab selection
    const mainToggleGroup = document.querySelector('#manualModal .prompt-tabs .gallery-toggle-group');
    const mainActiveTab = mainToggleGroup ? mainToggleGroup.getAttribute('data-active') : 'prompt';

    const characterItem = document.createElement('div');
    characterItem.className = 'character-prompt-item';
    characterItem.id = characterId;

    // Determine which tab should be active based on main window selection
    const promptTabActive = mainActiveTab === 'prompt' ? 'active' : '';
    const ucTabActive = mainActiveTab === 'uc' ? 'active' : '';

    characterItem.innerHTML = `
            <div class="character-prompt-tabs">
                <div class="tab-header">
                    <div class="workspace-drag-handle" title="Drag to reorder">
                        <i class="fas fa-grip-dots-vertical"></i>
                    </div>
                    <div class="left-controls">
                    <div class="character-name-editable">
                        <input type="text" class="character-name-input hover-show" value="Character ${characterPromptCounter}" placeholder="Enter character name...">
                        <span class="character-name-input-placeholder">Character ${characterPromptCounter}</span>
                    </div>
                </div>
                <div class="character-prompt-preview">
                    <input type="text" id="${escapeHtmlAttribute(characterId)}_preview" readonly placeholder="Click to expand and edit prompt..."></input>
                </div>
                    <div class="character-prompt-controls">
                        <button type="button" class="btn-secondary character-prompt-collapse-toggle btn-small" onclick="toggleCharacterPromptCollapse('${escapeHtmlAttribute(characterId)}')" title="Collapse/Expand">
                            <i class="nai-fold"></i>
                        </button>
                        <button type="button" class="btn-secondary position-btn hidden btn-small" onclick="showPositionDialog('${escapeHtmlAttribute(characterId)}')">
                            <i class="fas fa-crosshairs"></i>
                        </button>
                        <button type="button" class="btn-danger btn-small" onclick="deleteCharacterPrompt('${escapeHtmlAttribute(characterId)}')">
                            <i class="fas fa-trash-alt"></i>
                        </button>
                        <button type="button" class="btn-secondary indicator btn-small" id="${characterId}_enabled" data-state="on" onclick="toggleCharacterPromptEnabled('${characterId}')" title="Enable/Disable Character">
                            <i class="fas fa-power-off"></i>
                        </button>
                    </div>
                </div>
                <div class="tab-content">
                    <div class="tab-pane ${promptTabActive}" id="${characterId}_prompt-tab" data-label="Prompt">
                        <div class="character-prompt-textarea-container">
                            <div class="character-prompt-textarea-background"></div>
                            <textarea id="${characterId}_prompt" class="form-control character-prompt-textarea prompt-textarea" placeholder="Enter character prompt..." autocapitalize="false" autocorrect="false" spellcheck="false" data-ms-editor="false"></textarea>
                            <div class="prompt-textarea-toolbar hidden">
                                <div class="toolbar-left">
                                    <div class="token-info-container">
                                        <div class="token-info-top">
                                            <span class="token-count">0 tokens</span>
                                        </div>
                                        <div class="token-progress-bar">
                                            <div class="token-progress-fill">
                                                <div class="token-progress-inner"></div><div class="token-progress-inner-ne"></div>
                                            </div>
                                        </div>
                                    </div>
                                    <!-- Search Mode Elements (Hidden by default) -->
                                    <div class="toolbar-search-elements">
                                        <div class="text-search-label">Search</div>
                                        <div class="text-search-input-container">
                                            <input type="text" class="text-search-input" placeholder="Find Tag" />
                                        </div>
                                        <div class="text-search-match-count">0</div>
                                    </div>
                                </div>
                                <div class="toolbar-right">
                                    <!-- Regular Toolbar Buttons -->
                                    <div class="toolbar-regular-buttons">
                                        <button type="button" class="btn-secondary btn-small toolbar-btn toolbar-wide-btn" data-action="quick-access" title="Quick Access">
                                            <i class="fas fa-book-atlas"></i>
                                        </button>
                                        <button type="button" class="btn-secondary btn-small toolbar-btn toolbar-wide-btn" data-action="search" title="Search">
                                            <i class="fas fa-search"></i>
                                        </button>
                                        <button type="button" class="btn-secondary btn-small toolbar-btn toggle-btn" data-action="autofill" data-state="on" title="Toggle Autofill">
                                            <i class="fas fa-lightbulb"></i>
                                        </button>
                                        <div id="characterActionsDropdown_${characterId}" class="custom-dropdown dark dropright">
                                            <button type="button" id="characterActionsDropdownBtn_${characterId}" class="btn-secondary btn-small toolbar-btn">
                                                <i class="fas fa-toolbox"></i>
                                            </button>
                                            <div id="characterActionsDropdownMenu_${characterId}" class="custom-dropdown-menu hidden">
                                            </div>
                                        </div>
                                    </div>
                                    <!-- Search Mode Buttons (Hidden by default) -->
                                    <div class="toolbar-search-buttons">
                                        <button class="btn-secondary btn-small toolbar-btn text-search-prev" data-action="search-prev" title="Previous"><i class="fas fa-chevron-up"></i></button>
                                        <button class="btn-secondary btn-small toolbar-btn text-search-next" data-action="search-next" title="Next"><i class="fas fa-chevron-down"></i></button>
                                        <button class="btn-secondary btn-small toolbar-btn text-search-close" data-action="search-close" title="Close"><i class="fas fa-times"></i></button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="tab-pane ${ucTabActive}" id="${characterId}_uc-tab" data-label="UC">
                        ${buildCharacterUcTabContainerHtml(characterId, '', '')}
                    </div>
                </div>
            </div>
        `;

    // Store character name in dataset
    characterItem.dataset.charaName = `Character ${characterPromptCounter}`;

    characterPromptsContainer.classList.remove('hidden');
    characterPromptsContainer.appendChild(characterItem);

    // Add autocomplete event listeners for prompt and UC fields
    const promptField = document.getElementById(`${characterId}_prompt`);
    const ucField = document.getElementById(`${characterId}_uc`);
    const promptNegativeField = document.getElementById(`${characterId}_promptNegative`);

    if (promptField) {
        wireCharacterPromptTextarea(promptField, scheduleMaybeSyncMainPromptSubjectTagsFromCharacterPrompts);
        promptField.addEventListener('input', () => {
            updateCharacterPromptPreview(characterId);
        });
    }

    if (ucField) {
        wireCharacterPromptTextarea(ucField);
    }

    if (promptNegativeField) {
        wireCharacterPromptTextarea(promptNegativeField);
    }

    // Add preview textarea click handler
    const previewTextarea = document.getElementById(`${characterId}_preview`);
    if (previewTextarea) {
        previewTextarea.addEventListener('click', () => {
            toggleCharacterPromptCollapse(characterId);
        });
    }

    // Add character name input event listeners
    const nameInput = characterItem.querySelector('.character-name-input');
    if (nameInput) {
        nameInput.addEventListener('blur', function () {
            const newName = this.value.trim();
            if (newName) {
                characterItem.dataset.charaName = newName;
                characterItem.querySelector('.character-name-input-placeholder').textContent = newName;
            } else {
                this.value = `Character ${characterPromptCounter}`;
                characterItem.dataset.charaName = `Character ${characterPromptCounter}`;
                characterItem.querySelector('.character-name-input-placeholder').textContent = `Character ${characterPromptCounter}`;
            }
        });

        nameInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                this.blur();
            }
        });
    }

    // Set initial collapsed state for new characters
    const existingCharacters = characterPromptsContainer.querySelectorAll('.character-prompt-item');
    const keepAllCharacterPromptsOpen = document.body.classList.contains('desktop-mode');
    if (keepAllCharacterPromptsOpen || existingCharacters.length === 0) {
        characterItem.classList.remove('collapsed');
        updateCharacterPromptCollapseButton(characterId, false);
    } else {
        characterItem.classList.add('collapsed');
        updateCharacterPromptCollapseButton(characterId, true);
    }

    // Update auto position toggle visibility
    updateAutoPositionToggle();

    // Initialize dropdowns for the newly created character
    promptTextareaToolbar.initializeCharacterDropdowns(characterId);

    // Update text overlay target dropdowns
    updateAllTextOverlayTargetDropdowns();

    // Initialize drag and drop functionality
    initializeCharacterPromptDragAndDrop();

    promptTextareaToolbar.updateAllTokenCounts();
}

function deleteCharacterPrompt(characterId) {
    const characterItem = document.getElementById(characterId);
    if (characterItem) {
        // Clean up event listeners before removing the element
        const promptField = document.getElementById(`${characterId}_prompt`);
        const ucField = document.getElementById(`${characterId}_uc`);
        const promptNegativeField = document.getElementById(`${characterId}_promptNegative`);

        if (promptField) {
            cleanupSafeEventListeners(promptField);
        }
        if (ucField) {
            cleanupSafeEventListeners(ucField);
        }
        if (promptNegativeField) {
            cleanupSafeEventListeners(promptNegativeField);
        }

        characterItem.remove();
        updateAutoPositionToggle();

        // Update text overlay target dropdowns
        updateAllTextOverlayTargetDropdowns();

        // Reinitialize drag and drop functionality
        initializeCharacterPromptDragAndDrop();
        scheduleMaybeSyncMainPromptSubjectTagsFromCharacterPrompts();
        promptTextareaToolbar.updateAllTokenCounts();
    }
    if (characterPromptsContainer.querySelectorAll('.character-prompt-item').length === 0) {
        characterPromptsContainer.classList.add('hidden');
    }
}

function moveCharacterPrompt(characterId, direction) {
    const characterItems = Array.from(characterPromptsContainer.querySelectorAll('.character-prompt-item'));
    const currentIndex = characterItems.findIndex(item => item.id === characterId);

    if (currentIndex === -1) return;

    let newIndex;
    if (direction === 'up' && currentIndex > 0) {
        newIndex = currentIndex - 1;
    } else if (direction === 'down' && currentIndex < characterItems.length - 1) {
        newIndex = currentIndex + 1;
    } else {
        return; // Can't move in that direction
    }

    // Swap the elements
    const currentItem = characterItems[currentIndex];
    const targetItem = characterItems[newIndex];

    if (newIndex > currentIndex) {
        // Moving down
        characterPromptsContainer.insertBefore(targetItem, currentItem);
    } else {
        // Moving up
        characterPromptsContainer.insertBefore(currentItem, targetItem);
    }

    // Update button states after reordering
    updateAutoPositionToggle();
}

// Initialize drag and drop functionality for character prompt reordering
// Initialize drag and drop functionality for character prompt reordering
function initializeCharacterPromptDragAndDrop() {
    const list = document.getElementById('characterPromptsContainer');
    if (!list) {
        return;
    }

    let draggedItem = null;
    let draggedIndex = null;

    // Add event listeners to drag handles
    // Only attach to handles that haven't been initialized yet
    const dragHandles = list.querySelectorAll('.workspace-drag-handle:not([data-drag-initialized="true"])');

    dragHandles.forEach((handle) => {
        handle.addEventListener('mousedown', startDrag);
        handle.addEventListener('touchstart', startDrag, { passive: false });
        handle.addEventListener('touchmove', onDrag, { passive: false });
        handle.addEventListener('touchend', endDrag);

        // Mark as initialized
        handle.dataset.dragInitialized = 'true';
    });

    function startDrag(e) {
        // Prevent default on touchstart to avoid scrolling immediately
        if (e.type === 'touchstart') {
            e.preventDefault();
        } else {
            e.preventDefault(); // Mouse prevent default
        }

        if (e.type === 'mousedown' && e.button !== 0) return;

        e.stopPropagation();

        const handle = e.target.closest('.workspace-drag-handle');
        const item = handle ? handle.closest('.character-prompt-item') : e.target.closest('.character-prompt-item');

        if (!item) {
            return;
        }

        draggedItem = item;
        draggedIndex = Array.from(list.children).indexOf(item);

        // Add dragging class
        draggedItem.classList.add('dragging');

        // Add event listeners for drag movement - only mouse events on document
        if (e.type === 'mousedown') {
            document.addEventListener('mousemove', onDrag);
            document.addEventListener('mouseup', endDrag);
        }

        document.body.style.userSelect = 'none';

        // Haptic feedback
        if (window.navigator && window.navigator.vibrate && e.type === 'touchstart') {
            window.navigator.vibrate(50);
        }
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

                // Haptic feedback
                if (window.navigator && window.navigator.vibrate && e.type === 'touchmove') {
                    window.navigator.vibrate(10);
                }
            }
        }
    }

    function endDrag(e) {
        if (!draggedItem) {
            return;
        }

        if (e.type === 'touchend' || e.type === 'touchcancel') {
            e.preventDefault();
        }

        // Remove document event listeners
        document.removeEventListener('mousemove', onDrag);
        document.removeEventListener('mouseup', endDrag);

        // Remove dragging classes
        draggedItem.classList.remove('dragging');
        const items = Array.from(list.children);
        items.forEach(item => item.classList.remove('drag-over'));

        // Restore text selection
        document.body.style.userSelect = '';

        // Update auto position toggle after reordering
        updateAutoPositionToggle();

        // Reset draggedItem
        draggedItem = null;
        draggedIndex = null;
    }
}

function toggleCharacterPromptEnabled(characterId) {
    const characterItem = document.getElementById(characterId);
    const toggleBtn = document.getElementById(`${characterId}_enabled`);

    if (characterItem && toggleBtn) {
        const currentState = toggleBtn.getAttribute('data-state');
        const newState = currentState === 'on' ? 'off' : 'on';

        toggleBtn.setAttribute('data-state', newState);

        if (newState === 'on') {
            characterItem.classList.remove('character-prompt-disabled');
        } else {
            characterItem.classList.add('character-prompt-disabled');
        }
        scheduleMaybeSyncMainPromptSubjectTagsFromCharacterPrompts();
    }
}

function getCharacterPrompts() {
    const characterItems = characterPromptsContainer.querySelectorAll('.character-prompt-item');
    const characterPrompts = [];
    const autoPositionBtn = document.getElementById('autoPositionBtn');
    const isAutoPosition = autoPositionBtn.getAttribute('data-state') === 'on';

    characterItems.forEach((item, index) => {
        const characterId = item.id;
        const enabled = document.getElementById(`${characterId}_enabled`).getAttribute('data-state') === 'on';
        const prompt = normalizePromptNewlines(document.getElementById(`${characterId}_prompt`).value).trim();
        const uc = normalizePromptNewlines(document.getElementById(`${characterId}_uc`).value).trim();
        const promptNegativeEl = document.getElementById(`${characterId}_promptNegative`);
        const input_prompt_negative = promptNegativeEl
            ? normalizePromptNewlines(promptNegativeEl.value).trim()
            : '';
        const charaName = item.dataset.charaName || `Character ${index + 1}`;

        let center = null;

        if (!isAutoPosition) {
            // Manual position: use stored position or default
            const storedX = item.dataset.positionX;
            const storedY = item.dataset.positionY;
            if (storedX && storedY) {
                center = { x: parseFloat(storedX), y: parseFloat(storedY) };
            }
        }

        characterPrompts.push({
            prompt: prompt,
            uc: uc,
            input_prompt_negative: input_prompt_negative,
            center: center,
            enabled: enabled,
            chara_name: charaName
        });
    });

    return characterPrompts;
}

// Character gender → main prompt subject tags (1girl / 2girls / solo); sync from /public/scripts/app.js
const _CHAR_GENDER_GYNO_RE = /\b(gynomorph|futanari|dickgirls?|dickgirl|futa|hermaphrodit|intersex)\b/i;
const _CHAR_GENDER_MALE_RE = /\b(1boy|2boys|[0-9]+boys?|male|males|man|men|boy|boys|shota|shotas|otoko\s+no\s+ko)\b/i;
const _CHAR_GENDER_FEMALE_RE = /\b(1girl|2girls|[0-9]+girls?|female|females|woman|women|girl|girls|loli|lolis)\b/i;

function detectCharacterGenderBucketFromCharPromptSlice(slice100) {
    if (!slice100) return null;
    if (_CHAR_GENDER_GYNO_RE.test(slice100)) return 'gynomorph';
    const hasMale = _CHAR_GENDER_MALE_RE.test(slice100);
    const hasFemale = _CHAR_GENDER_FEMALE_RE.test(slice100);
    if (hasMale && hasFemale) return null;
    if (hasMale) return 'boy';
    if (hasFemale) return 'girl';
    return null;
}

function buildDesiredMainPromptSubjectTagSegment(counts) {
    const parts = [];
    if (counts.boy) parts.push(counts.boy === 1 ? '1boy' : `${counts.boy}boys`);
    if (counts.girl) parts.push(counts.girl === 1 ? '1girl' : `${counts.girl}girls`);
    if (counts.gynomorph) parts.push(counts.gynomorph === 1 ? 'gynomorph' : `${counts.gynomorph}gynomorphs`);
    return parts.join(', ');
}

function collectMainPromptSubjectTagMatchRanges(str, removeSolo) {
    const staticParts = [
        'multiple girls', 'multiple boys', 'multiple gynomorphs', 'no humans',
        '1other', '2others'
    ];
    if (removeSolo) staticParts.push('solo');
    const escaped = staticParts.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const re = new RegExp(
        `\\b(?:${escaped.join('|')}|\\d+girls?|\\d+boys?|\\d+gynomorphs?|gynomorph)\\b`,
        'gi'
    );
    const ranges = [];
    let m;
    while ((m = re.exec(str)) !== null) {
        ranges.push({ start: m.index, end: m.index + m[0].length });
    }
    return ranges;
}

function mergeCommaAdjacentRanges(str, ranges) {
    if (!ranges.length) return [];
    ranges.sort((a, b) => a.start - b.start);
    const merged = [];
    let cur = { ...ranges[0] };
    for (let i = 1; i < ranges.length; i++) {
        const r = ranges[i];
        const gap = str.slice(cur.end, r.start);
        if (/^[\s,]*$/.test(gap)) {
            cur.end = r.end;
        } else {
            merged.push(cur);
            cur = { ...r };
        }
    }
    merged.push(cur);
    return merged;
}

function applyMainPromptSubjectTagSegment(mainText, desiredSegment, removeSolo) {
    const ranges = collectMainPromptSubjectTagMatchRanges(mainText, removeSolo);
    if (!ranges.length) {
        if (!desiredSegment) return mainText;
        const t = mainText.trim();
        return desiredSegment + (t ? ', ' + t : '');
    }
    const spans = mergeCommaAdjacentRanges(mainText, ranges);
    const firstStart = Math.min(...spans.map((s) => s.start));
    let out = mainText;
    const sorted = [...spans].sort((a, b) => b.start - a.start);
    for (const sp of sorted) {
        out = out.slice(0, sp.start) + out.slice(sp.end);
    }
    let pos = firstStart;
    for (const sp of spans) {
        if (sp.end <= firstStart) pos -= sp.end - sp.start;
    }
    const left = out.slice(0, pos).replace(/[\s,]+$/, '');
    const right = out.slice(pos).replace(/^[\s,]+/, '');
    if (!desiredSegment) {
        if (!left) return right;
        if (!right) return left;
        return `${left}, ${right}`;
    }
    if (!left) return right ? `${desiredSegment}, ${right}` : desiredSegment;
    if (!right) return `${left}, ${desiredSegment}`;
    return `${left}, ${desiredSegment}, ${right}`;
}

function isAnyManualScenePromptTextareaFocused() {
    const manualModal = document.getElementById('manualModal');
    if (!manualModal || manualModal.classList.contains('hidden')) return false;
    const ae = document.activeElement;
    if (!ae || ae.nodeName !== 'TEXTAREA') return false;
    if (!manualModal.contains(ae)) return false;
    if (ae.id === 'manualPrompt') return true;
    return !!(ae.id && ae.id.endsWith('_prompt') && ae.classList.contains('character-prompt-textarea'));
}

let _syncMainPromptSubjectTagsRaf = null;
function scheduleMaybeSyncMainPromptSubjectTagsFromCharacterPrompts() {
    if (_syncMainPromptSubjectTagsRaf != null) cancelAnimationFrame(_syncMainPromptSubjectTagsRaf);
    _syncMainPromptSubjectTagsRaf = requestAnimationFrame(() => {
        _syncMainPromptSubjectTagsRaf = null;
        requestAnimationFrame(() => {
            maybeSyncMainPromptSubjectTagsFromCharacterPrompts();
        });
    });
}

function maybeSyncMainPromptSubjectTagsFromCharacterPrompts() {
    const manualModal = document.getElementById('manualModal');
    if (!manualModal || manualModal.classList.contains('hidden')) return;
    if (window.autoCharNumerize === false) return;
    if (isAnyManualScenePromptTextareaFocused()) return;
    if (!characterPromptsContainer || !manualPrompt) return;

    const characterItems = characterPromptsContainer.querySelectorAll('.character-prompt-item');
    const buckets = [];
    for (const item of characterItems) {
        const characterId = item.id;
        const enabledEl = document.getElementById(`${characterId}_enabled`);
        if (!enabledEl || enabledEl.getAttribute('data-state') !== 'on') continue;
        const pf = document.getElementById(`${characterId}_prompt`);
        if (!pf) continue;
        const raw = normalizePromptNewlines(pf.value || '').trim();
        if (!raw) return;
        const bucket = detectCharacterGenderBucketFromCharPromptSlice(raw.slice(0, 100));
        if (!bucket) return;
        buckets.push(bucket);
    }
    if (!buckets.length) return;

    const counts = { girl: 0, boy: 0, gynomorph: 0 };
    for (const b of buckets) counts[b]++;
    const desired = buildDesiredMainPromptSubjectTagSegment(counts);
    if (!desired) return;

    const removeSolo = buckets.length >= 2;

    const before = manualPrompt.value;
    const after = applyMainPromptSubjectTagSegment(before, desired, removeSolo);
    if (after === before) return;

    // setTextareaValuePreservingUndo: public/scripts/comp/textareaUtils.js
    setTextareaValuePreservingUndo(manualPrompt, after);
    applyFormattedText(manualPrompt, true);
    updateEmphasisHighlighting(manualPrompt);
    autoResizeTextarea(manualPrompt);
    // promptTextareaToolbar — /public/scripts/comp/promptTextareaToolbar.js
    if (promptTextareaToolbar) {
        promptTextareaToolbar.updateTokenCount(manualPrompt);
    }
}

function clearCharacterPrompts() {
    characterPromptsContainer.classList.add('hidden');
    // Clean up event listeners for all character prompt textareas before clearing
    const characterItems = characterPromptsContainer.querySelectorAll('.character-prompt-item');
    characterItems.forEach(item => {
        const characterId = item.id;
        const promptField = document.getElementById(`${characterId}_prompt`);
        const ucField = document.getElementById(`${characterId}_uc`);

        if (promptField) {
            cleanupSafeEventListeners(promptField);
        }
        if (ucField) {
            cleanupSafeEventListeners(ucField);
        }
    });
    characterPromptsContainer.innerHTML = '';
    characterPromptCounter = 0;
}

function loadCharacterPrompts(characterPrompts, useCoords) {
    clearCharacterPrompts();

    if (!characterPrompts || !Array.isArray(characterPrompts)) {
        return;
    }

    // Get the current main window tab selection
    const mainToggleGroup = document.querySelector('#manualModal .prompt-tabs .gallery-toggle-group');
    const mainActiveTab = mainToggleGroup ? mainToggleGroup.getAttribute('data-active') : 'prompt';

    // Update counter to match the number of characters
    characterPromptCounter = characterPrompts.length;

    if (characterPrompts.length > 0) {
        characterPromptsContainer.classList.remove('hidden');
    }

    characterPrompts.forEach((character, index) => {
        const characterId = `character_${index}`;
        characterPromptCounter = index + 1;

        const characterItem = document.createElement('div');
        characterItem.className = 'character-prompt-item';
        characterItem.id = characterId;

        if (!character.enabled) {
            characterItem.classList.add('character-prompt-disabled');
        }

        // Determine position button text and visibility
        let positionBtnText = '<i class="fas fa-crosshairs"></i>';
        let positionBtnHidden = true; // Default to hidden

        if (character.center && character.center.x !== null && character.center.y !== null && useCoords) {
            // Character has valid coordinates and auto mode is disabled
            const x = character.center.x;
            const y = character.center.y;
            const cellLabel = getCellLabelFromCoords(x, y);
            if (cellLabel) {
                positionBtnText = `<i class="fas fa-crosshairs"></i> ${cellLabel}`;
                positionBtnHidden = false; // Show the button when we have valid coordinates
            }
        }

        // Determine which tab should be active based on main window selection
        const promptTabActive = mainActiveTab === 'prompt' ? 'active' : '';
        const ucTabActive = mainActiveTab === 'uc' ? 'active' : '';

        characterItem.innerHTML = `
            <div class="character-prompt-tabs">
                <div class="tab-header">
                    <div class="workspace-drag-handle" title="Drag to reorder">
                        <i class="fas fa-grip-dots-vertical"></i>
                    </div>
                    <div class="left-controls">
                    <div class="character-name-editable">
                        <input type="text" class="character-name-input hover-show" value="${character.chara_name || `Character ${index + 1}`}" placeholder="Enter character name...">
                        <span class="character-name-input-placeholder">${character.chara_name || `Character ${index + 1}`}</span>
                    </div>
                    </div>
                <div class="character-prompt-preview">
                    <input type="text" id="${characterId}_preview" readonly placeholder="Click to expand and edit prompt..." value="${character.prompt || ''}"></input>
                </div>
                    <div class="character-prompt-controls">
                        <button type="button" class="btn-secondary character-prompt-collapse-toggle btn-small" onclick="toggleCharacterPromptCollapse('${escapeHtmlAttribute(characterId)}')" title="Collapse/Expand">
                            <i class="nai-fold"></i>
                        </button>
                        <button type="button" class="btn-secondary position-btn${positionBtnHidden ? ' hidden' : ''} btn-small" onclick="showPositionDialog('${escapeHtmlAttribute(characterId)}')">
                            ${positionBtnText}
                        </button>
                        <button type="button" class="btn-danger btn-small" onclick="deleteCharacterPrompt('${escapeHtmlAttribute(characterId)}')">
                            <i class="fas fa-trash-alt"></i>
                        </button>
                        <button type="button" class="btn-secondary indicator btn-small" id="${characterId}_enabled" data-state="${character.enabled ? 'on' : 'off'}" onclick="toggleCharacterPromptEnabled('${characterId}')" title="Enable/Disable Character">
                            <i class="fas fa-power-off"></i>
                        </button>
                    </div>
                </div>
                <div class="tab-content">
                    <div class="tab-pane ${promptTabActive}" id="${characterId}_prompt-tab" data-label="Prompt">
                        <div class="character-prompt-textarea-container">
                            <div class="character-prompt-textarea-background"></div>
                            <textarea id="${characterId}_prompt" class="form-control character-prompt-textarea prompt-textarea" placeholder="Enter character prompt..." autocapitalize="false" autocorrect="false" spellcheck="false" data-ms-editor="false">${character.prompt || ''}</textarea>
                            <div class="prompt-textarea-toolbar hidden">
                                <div class="toolbar-left">
                                    <div class="token-info-container">
                                        <div class="token-info-top">
                                            <span class="token-count">0 tokens</span>
                                        </div>
                                        <div class="token-progress-bar">
                                            <div class="token-progress-fill">
                                                <div class="token-progress-inner"></div><div class="token-progress-inner-ne"></div>
                                            </div>
                                        </div>
                                    </div>
                                    <!-- Search Mode Elements (Hidden by default) -->
                                    <div class="toolbar-search-elements">
                                        <div class="text-search-label">Search</div>
                                        <div class="text-search-input-container">
                                            <input type="text" class="text-search-input" placeholder="Find Tag" />
                                        </div>
                                        <div class="text-search-match-count">0</div>
                                    </div>
                                </div>
                                <div class="toolbar-right">
                                    <!-- Regular Toolbar Buttons -->
                                    <div class="toolbar-regular-buttons">
                                        <button type="button" class="btn-secondary btn-small toolbar-btn toolbar-wide-btn" data-action="quick-access" title="Quick Access">
                                            <i class="fas fa-book-atlas"></i>
                                        </button>
                                        <button type="button" class="btn-secondary btn-small toolbar-btn toolbar-wide-btn" data-action="search" title="Search">
                                            <i class="fas fa-search"></i>
                                        </button>
                                        <button type="button" class="btn-secondary btn-small toolbar-btn toggle-btn" data-action="autofill" data-state="on" title="Toggle Autofill">
                                            <i class="fas fa-lightbulb"></i>
                                        </button>
                                        <div id="characterActionsDropdown_${characterId}" class="custom-dropdown dark dropright">
                                            <button type="button" id="characterActionsDropdownBtn_${characterId}" class="btn-secondary btn-small toolbar-btn">
                                                <i class="fas fa-toolbox"></i>
                                            </button>
                                            <div id="characterActionsDropdownMenu_${characterId}" class="custom-dropdown-menu hidden">
                                            </div>
                                        </div>
                                    </div>
                                    <!-- Search Mode Buttons (Hidden by default) -->
                                    <div class="toolbar-search-buttons">
                                        <button class="btn-secondary btn-small toolbar-btn text-search-prev" data-action="search-prev" title="Previous"><i class="fas fa-chevron-up"></i></button>
                                        <button class="btn-secondary btn-small toolbar-btn text-search-next" data-action="search-next" title="Next"><i class="fas fa-chevron-down"></i></button>
                                        <button class="btn-secondary btn-small toolbar-btn text-search-close" data-action="search-close" title="Close"><i class="fas fa-times"></i></button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="tab-pane ${ucTabActive}" id="${characterId}_uc-tab" data-label="UC">
                        ${buildCharacterUcTabContainerHtml(characterId, character.uc || '', character.input_prompt_negative || '')}
                    </div>
                </div>
            </div>
        `;

        // Store character name in dataset
        if (character.chara_name) {
            characterItem.dataset.charaName = character.chara_name;
        }

        // Store position data if available
        if (character.center) {
            characterItem.dataset.positionX = character.center.x;
            characterItem.dataset.positionY = character.center.y;
            characterItem.dataset.positionCell = getCellLabelFromCoords(character.center.x, character.center.y);
        }

        characterPromptsContainer.appendChild(characterItem);

        // Set default collapsed state before sizing so layout matches visible structure
        const keepAllCharacterPromptsOpen = document.body.classList.contains('desktop-mode');
        if (keepAllCharacterPromptsOpen || index === 0) {
            characterItem.classList.remove('collapsed');
            updateCharacterPromptCollapseButton(characterId, false);
        } else {
            characterItem.classList.add('collapsed');
            updateCharacterPromptCollapseButton(characterId, true);
        }

        // Add autocomplete event listeners for prompt and UC fields
        const promptField = document.getElementById(`${characterId}_prompt`);
        const ucField = document.getElementById(`${characterId}_uc`);
        const promptNegativeField = document.getElementById(`${characterId}_promptNegative`);

        const shouldSizeCharacterFields = !characterItem.classList.contains('collapsed');
        if (promptField) {
            wireCharacterPromptTextarea(promptField, scheduleMaybeSyncMainPromptSubjectTagsFromCharacterPrompts);
            if (shouldSizeCharacterFields) {
                autoResizeTextarea(promptField);
            }
            updateEmphasisHighlighting(promptField);
        }

        if (ucField) {
            wireCharacterPromptTextarea(ucField);
            if (shouldSizeCharacterFields) {
                autoResizeTextarea(ucField);
            }
            updateEmphasisHighlighting(ucField);
        }

        if (promptNegativeField) {
            wireCharacterPromptTextarea(promptNegativeField);
            if (shouldSizeCharacterFields) {
                autoResizeTextarea(promptNegativeField);
            }
            updateEmphasisHighlighting(promptNegativeField);
        }

        // Add preview textarea click handler
        const previewTextarea = document.getElementById(`${characterId}_preview`);
        if (previewTextarea) {
            previewTextarea.addEventListener('click', () => {
                toggleCharacterPromptCollapse(characterId);
            });
        }

        // Add character name input event listeners
        const nameInput = characterItem.querySelector('.character-name-input');
        if (nameInput) {
            nameInput.addEventListener('blur', function () {
                const newName = this.value.trim();
                if (newName) {
                    characterItem.dataset.charaName = newName;
                    characterItem.querySelector('.character-name-input-placeholder').textContent = newName;
                } else {
                    this.value = `Character ${characterPromptCounter}`;
                    characterItem.dataset.charaName = `Character ${characterPromptCounter}`;
                    characterItem.querySelector('.character-name-input-placeholder').textContent = `Character ${characterPromptCounter}`;
                }
            });

            nameInput.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') {
                    this.blur();
                }
            });
        }

        // Update preview content when prompt changes
        if (promptField) {
            promptField.addEventListener('input', () => {
                updateCharacterPromptPreview(characterId);
            });
            // Update preview initially after content is set
            updateCharacterPromptPreview(characterId);
        }

    });

    // prepareManualTabLayout: public/scripts/comp/utilities.js
    prepareManualTabLayout(mainActiveTab);

    // Match addCharacterPrompt: toolbar action menus, overlay target lists, and reorder handles
    promptTextareaToolbar.initializeCharacterDropdowns();
    updateAllTextOverlayTargetDropdowns();
    initializeCharacterPromptDragAndDrop();

    // Update auto position toggle after loading
    updateAutoPositionToggle();

    promptTextareaToolbar.updateAllTokenCounts();
}

/**
 * Update character prompt item names from compiled_prompt.character_names
 * @param {Array<string>} characterNames - Array of character names to apply
 */
function updateCharacterPromptItemNames(characterNames) {
    if (!characterNames || !Array.isArray(characterNames)) {
        return;
    }

    const characterItems = document.querySelectorAll('.character-prompt-item');
    characterNames.forEach((name, index) => {
        if (name && characterItems[index]) {
            const characterItem = characterItems[index];
            const nameInput = characterItem.querySelector('.character-name-input');
            const placeholderElement = characterItem.querySelector('.character-name-input-placeholder');

            if (nameInput) {
                nameInput.value = name;
                characterItem.dataset.charaName = name;
            }

            if (placeholderElement) {
                placeholderElement.textContent = name;
            }

            console.log(`✨ Updated character prompt item ${index + 1} name: "${name}"`);
        }
    });
}

function toggleCharacterPromptCollapse(characterId) {
    const characterItem = document.getElementById(characterId);
    if (!characterItem) return;

    const isCollapsed = characterItem.classList.contains('collapsed');
    const newCollapsedState = !isCollapsed;

    if (newCollapsedState) {
        characterItem.classList.add('collapsed');
    } else {
        characterItem.classList.remove('collapsed');
        // Resize text areas when expanding to ensure proper height
        const promptField = document.getElementById(`${characterId}_prompt`);
        const ucField = document.getElementById(`${characterId}_uc`);
        const promptNegativeField = document.getElementById(`${characterId}_promptNegative`);
        if (promptField) autoResizeTextarea(promptField);
        if (ucField) autoResizeTextarea(ucField);
        if (promptNegativeField) autoResizeTextarea(promptNegativeField);
        syncPromptTextareaContainersInScope(characterItem);
    }

    updateCharacterPromptCollapseButton(characterId, newCollapsedState);
}

function updateCharacterPromptCollapseButton(characterId, isCollapsed) {
    const characterItem = document.getElementById(characterId);
    if (!characterItem) return;

    const collapseToggle = characterItem.querySelector('.character-prompt-collapse-toggle');
    if (!collapseToggle) return;

    const icon = collapseToggle.querySelector('i');

    if (isCollapsed) {
        icon.className = 'nai-unfold';
    } else {
        icon.className = 'nai-fold';
    }
}

function updateCharacterPromptPreview(characterId) {
    const characterItem = document.getElementById(characterId);
    if (!characterItem) return;

    const promptField = document.getElementById(`${characterId}_prompt`);
    const previewField = document.getElementById(`${characterId}_preview`);

    if (promptField && previewField) {
        const promptText = promptField.value.trim();
        previewField.value = promptText || 'No prompt entered';
    }
}


// --- Character prompt CRUD (Phase 2 batch 12) ---
