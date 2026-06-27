/**
 * Random prompt toggle, refresh, and transfer.
 * savedRandomPromptState / lastPromptState: manualModalManager.js
 * Wired via registerInitStep 477.
 */

/**
 * Determines the request type for random prompt generation based on the selected model.
 * @returns {number} - The request type (0, 1, or 2).
 */
function getRequestTypeForRandomPrompt() {
    const modelValue = document.getElementById('manualModel').value || '';
    const modelLower = modelValue.toLowerCase();

    if (modelLower.includes('v4')) {
        return 2;
    } else if (modelLower.includes('furry')) {
        return 1;
    } else if (modelLower.includes('anime')) {
        return 0;
    }
    return 0; // Default to Anime
}

/**
 * Executes the random prompt generation and populates the form.
 */
async function executeRandomPrompt() {
    const requestType = getRequestTypeForRandomPrompt();
    const nsfw = (selectedNsfwValue.toString() === '1' || selectedNsfwValue.toString() === '2' || selectedNsfwValue.toString() === '3');

    const promptData = await randomPrompt(requestType, nsfw);

    if (promptData && Array.isArray(promptData)) {
        const manualPrompt = document.getElementById('manualPrompt');
        const manualUc = document.getElementById('manualUc');

        if (manualPrompt) {
            manualPrompt.value = promptData[0] || '';
            autoResizeTextarea(manualPrompt);
            updateEmphasisHighlighting(manualPrompt);
        }

        if (manualUc) {
            manualUc.value = '';
            autoResizeTextarea(manualUc);
            updateEmphasisHighlighting(manualUc);
        }
        const manualPromptNegativeRp = document.getElementById('manualPromptNegative');
        if (manualPromptNegativeRp) {
            manualPromptNegativeRp.value = '';
            autoResizeTextarea(manualPromptNegativeRp);
            updateEmphasisHighlighting(manualPromptNegativeRp);
        }

        const characterPrompts = promptData.slice(1).map(p => ({ prompt: p, uc: '', enabled: true }));

        savedRandomPromptState = {
            basePrompt: promptData[0],
            baseUc: '',
            input_prompt_negative: '',
            characters: characterPrompts
        };

        loadCharacterPrompts(characterPrompts, false);
    }
}

/**
 * Transfers the current random prompt to the main prompt and exits random mode.
 */
function transferRandomPrompt() {
    const toggleBtn = document.getElementById('randomPromptToggleBtn');
    const refreshBtn = document.getElementById('randomPromptRefreshBtn');
    const transferBtn = document.getElementById('randomPromptTransferBtn');
    const divider = document.getElementById('randomPromptDivider');

    // Check if random mode is active
    if (toggleBtn.dataset.state !== 'on') {
        return; // Not in random mode, do nothing
    }

    // Copy current random prompt state to main prompt
    if (savedRandomPromptState) {
        const manualPrompt = document.getElementById('manualPrompt');
        const manualUc = document.getElementById('manualUc');
        if (manualPrompt) {
            manualPrompt.value = savedRandomPromptState.basePrompt;
            autoResizeTextarea(manualPrompt);
            updateEmphasisHighlighting(manualPrompt);
        }
        if (manualUc) {
            manualUc.value = savedRandomPromptState.baseUc;
            autoResizeTextarea(manualUc);
            updateEmphasisHighlighting(manualUc);
        }
        const manualPromptNegativeXfer = document.getElementById('manualPromptNegative');
        if (manualPromptNegativeXfer) {
            manualPromptNegativeXfer.value = savedRandomPromptState.input_prompt_negative || '';
            autoResizeTextarea(manualPromptNegativeXfer);
            updateEmphasisHighlighting(manualPromptNegativeXfer);
        }
        loadCharacterPrompts(savedRandomPromptState.characters, false);
    }

    // Exit random mode
    toggleBtn.dataset.state = 'off';
    toggleBtn.classList.remove('active');
    refreshBtn.classList.add('hidden');
    transferBtn.classList.add('hidden');
    divider.classList.add('hidden');
    // Clear saved states
    savedRandomPromptState = null;
    lastPromptState = null;

    // Show success message
    showGlassToast('success', null, 'Transferred to editor', false, 5000, '<i class="fas fa-edit"></i>');
}

/**
 * Toggles the random prompt generation feature on and off.
 */
async function toggleRandomPrompt() {
    const toggleBtn = document.getElementById('randomPromptToggleBtn');
    const refreshBtn = document.getElementById('randomPromptRefreshBtn');
    const transferBtn = document.getElementById('randomPromptTransferBtn');
    const divider = document.getElementById('randomPromptDivider');
    const isEnabled = toggleBtn.dataset.state === 'on';

    if (isEnabled) {
        // Turning OFF - save current random prompt state
        const _mnpSave = document.getElementById('manualPromptNegative');
        savedRandomPromptState = {
            basePrompt: document.getElementById('manualPrompt').value,
            baseUc: document.getElementById('manualUc').value,
            input_prompt_negative: _mnpSave ? _mnpSave.value : '',
            characters: getCharacterPrompts()
        };

        toggleBtn.dataset.state = 'off';
        toggleBtn.classList.remove('active');
        refreshBtn.classList.add('hidden');
        transferBtn.classList.add('hidden');
        divider.classList.add('hidden');

        if (lastPromptState) {
            const manualPrompt = document.getElementById('manualPrompt');
            const manualUc = document.getElementById('manualUc');
            const manualPromptNegativeRestore = document.getElementById('manualPromptNegative');
            if (manualPrompt) {
                manualPrompt.value = lastPromptState.basePrompt;
                autoResizeTextarea(manualPrompt);
                updateEmphasisHighlighting(manualPrompt);
            }
            if (manualUc) {
                manualUc.value = lastPromptState.baseUc;
                autoResizeTextarea(manualUc);
                updateEmphasisHighlighting(manualUc);
            }
            if (manualPromptNegativeRestore) {
                manualPromptNegativeRestore.value = lastPromptState.input_prompt_negative || '';
                autoResizeTextarea(manualPromptNegativeRestore);
                updateEmphasisHighlighting(manualPromptNegativeRestore);
            }
            loadCharacterPrompts(lastPromptState.characters, false);
        }
        lastPromptState = null;

    } else {
        // Turning ON
        // Save current state before doing anything
        const _mnpLast = document.getElementById('manualPromptNegative');
        lastPromptState = {
            basePrompt: document.getElementById('manualPrompt').value,
            baseUc: document.getElementById('manualUc').value,
            input_prompt_negative: _mnpLast ? _mnpLast.value : '',
            characters: getCharacterPrompts()
        };

        toggleBtn.dataset.state = 'on';
        toggleBtn.classList.add('active');
        refreshBtn.classList.remove('hidden');
        transferBtn.classList.remove('hidden');
        divider.classList.remove('hidden');

        // Check if we have a saved random prompt state
        if (savedRandomPromptState) {
            // Restore the last random prompt values
            const manualPrompt = document.getElementById('manualPrompt');
            const manualUc = document.getElementById('manualUc');
            if (manualPrompt) {
                manualPrompt.value = savedRandomPromptState.basePrompt;
                autoResizeTextarea(manualPrompt);
                updateEmphasisHighlighting(manualPrompt);
            }
            if (manualUc) {
                manualUc.value = savedRandomPromptState.baseUc;
                autoResizeTextarea(manualUc);
                updateEmphasisHighlighting(manualUc);
            }
            const manualPromptNegativeSaved = document.getElementById('manualPromptNegative');
            if (manualPromptNegativeSaved) {
                manualPromptNegativeSaved.value = savedRandomPromptState.input_prompt_negative || '';
                autoResizeTextarea(manualPromptNegativeSaved);
                updateEmphasisHighlighting(manualPromptNegativeSaved);
            }
            loadCharacterPrompts(savedRandomPromptState.characters, false);
        } else {
            // No saved state, generate new random prompt
            await executeRandomPrompt();
        }
    }
}

function attachRandomPromptListeners(signal) {
    const toggleBtn = document.getElementById('randomPromptToggleBtn');
    const refreshBtn = document.getElementById('randomPromptRefreshBtn');
    const transferBtn = document.getElementById('randomPromptTransferBtn');

    if (toggleBtn) {
        toggleBtn.addEventListener('click', (e) => {
            e.preventDefault();
            toggleRandomPrompt();
        }, { signal });
    }

    if (refreshBtn) {
        refreshBtn.addEventListener('click', (e) => {
            e.preventDefault();
            executeRandomPrompt();
        }, { signal });
    }

    if (transferBtn) {
        transferBtn.addEventListener('click', (e) => {
            e.preventDefault();
            transferRandomPrompt();
        }, { signal });
    }
}

function initRandomPromptListenerScope() {
    const manualModalEl = document.getElementById('manualModal');
    if (!manualModalEl) return;
    // attachModalListeners: public/scripts/comp/modalListenerScope.js
    attachModalListeners(manualModalEl, attachRandomPromptListeners);
}

if (typeof wsClient !== 'undefined' && wsClient) {
    wsClient.registerInitStep(477, 'Random prompt listener scope', async () => {
        initRandomPromptListenerScope();
    });
}
