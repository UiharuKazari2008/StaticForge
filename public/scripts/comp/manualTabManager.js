/**
 * Manual Tab Manager (Wave 2 — app.js refactor)
 *
 * Prompt/UC/creative tab switching in the manual generation modal.
 * Extracted from public/scripts/app.js; originals remain until manifest removal.
 *
 * Dependencies: manualModalManager.js, utilities.js (prepareManualTabLayout), emphasisHighlight.js
 */

function switchManualTab(targetTab, previouslyFocused = undefined) {
    prepareManualTabLayout(targetTab);

    const ownsScrollbarBatch = typeof customScrollbar !== 'undefined' && customScrollbar._layoutBatchDepth === 0;
    if (ownsScrollbarBatch) {
        customScrollbar.beginLayoutBatch();
    }

    // Target ONLY the tab buttons within the manual modal's prompt-tabs section
    const tabButtons = document.querySelectorAll('#manualModal .prompt-tabs .gallery-toggle-group .gallery-toggle-btn');
    // Target ONLY the tab panes within the manual modal's prompt-tabs section
    const tabPanes = document.querySelectorAll('#manualModal .prompt-tabs .tab-content .tab-pane');
    const showBothBtn = document.getElementById('showBothBtn');
    const promptTabs = document.querySelector('#manualModal .prompt-tabs');
    const toggleGroup = document.querySelector('#manualModal .prompt-tabs .gallery-toggle-group');

    // undefined = infer from activeElement (keyboard/programmatic); null = no textarea focus; element = explicit source
    const currentlyFocused = previouslyFocused === undefined ? document.activeElement : previouslyFocused;
    let focusTarget = null;

    // Remove show-both state
    promptTabs.classList.remove('show-both');
    showBothBtn.classList.remove('active');

    // Remove active class from all buttons and panes
    tabButtons.forEach(btn => btn.classList.remove('active'));
    tabPanes.forEach(pane => pane.classList.remove('active'));

    // Add active class to clicked button and corresponding pane
    const targetButton = document.querySelector(`#manualModal .prompt-tabs .gallery-toggle-group .gallery-toggle-btn[data-tab="${targetTab}"]`);
    const targetPane = document.getElementById(`${targetTab}-tab`);

    if (targetButton) targetButton.classList.add('active');
    if (targetPane) targetPane.classList.add('active');

    // Update the data-active attribute for the slider
    if (toggleGroup) {
        toggleGroup.setAttribute('data-active', targetTab);
    }

    // Determine which textarea to focus based on what was previously focused
    if (currentlyFocused && currentlyFocused.matches('.prompt-textarea, .character-prompt-textarea')) {
        // If a textarea was focused, focus the corresponding textarea in the new tab
        if (currentlyFocused.matches('.character-prompt-textarea')) {
            // Character textarea was focused, find the corresponding character textarea in the new tab
            const characterItem = currentlyFocused.closest('.character-prompt-item');
            if (characterItem) {
                const characterId = characterItem.id;
                if (currentlyFocused.id.endsWith('_promptNegative')) {
                    if (targetTab === 'uc') {
                        focusTarget = currentlyFocused;
                    } else if (targetTab === 'prompt') {
                        focusTarget = document.getElementById(`${characterId}_prompt`);
                    }
                } else {
                    focusTarget = document.getElementById(`${characterId}_${targetTab}`);
                }
            }
        } else if (currentlyFocused.matches('.prompt-textarea')) {
            // Main prompt textarea was focused (not character), focus main target tab textarea
            if (targetTab === 'prompt') {
                focusTarget = document.getElementById('manualPrompt');
            } else if (targetTab === 'uc') {
                focusTarget = document.getElementById(
                    currentlyFocused && currentlyFocused.id === 'manualPromptNegative'
                        ? 'manualPromptNegative'
                        : 'manualUc'
                );
            } else if (targetTab === 'creative') {
                focusTarget = document.getElementById('creativeDirectiveInput');
            }

        }
    }

    // Only focus when a textarea was focused in the tab we are leaving
    if (focusTarget) {
        setTimeout(() => {
            if (focusTarget && focusTarget.focus) {
                focusTarget.focus();
                // scheduleEmphasisHighlightUpdate: public/scripts/comp/emphasisHighlight.js
                scheduleEmphasisHighlightUpdate(focusTarget, true);
            }
        }, 10);
    }

    // Sync the selection to all character prompts
    syncCharacterPromptTabs(targetTab);

    // updateManualTokenFreeDisplay: public/scripts/comp/utilities.js
    if (typeof updateManualTokenFreeDisplay === 'function') {
        updateManualTokenFreeDisplay();
    }

    if (ownsScrollbarBatch) {
        customScrollbar.endLayoutBatch();
    }
}

// New function to sync main window tab selection to all character prompts
function getCharacterPromptTabNodes(characterItem) {
    let nodes = characterItem._promptTabNodes;
    if (nodes && nodes.item === characterItem) return nodes;
    const id = characterItem.id;
    nodes = {
        item: characterItem,
        tabsRoot: characterItem.querySelector('.character-prompt-tabs'),
        toggleGroup: characterItem.querySelector('.gallery-toggle-group'),
        btnPrompt: characterItem.querySelector('.gallery-toggle-btn[data-tab="prompt"]'),
        btnUc: characterItem.querySelector('.gallery-toggle-btn[data-tab="uc"]'),
        btnCreative: characterItem.querySelector('.gallery-toggle-btn[data-tab="creative"]'),
        panePrompt: document.getElementById(`${id}_prompt-tab`),
        paneUc: document.getElementById(`${id}_uc-tab`),
        fieldPrompt: document.getElementById(`${id}_prompt`),
        fieldUc: document.getElementById(`${id}_uc`),
        fieldPromptNegative: document.getElementById(`${id}_promptNegative`)
    };
    characterItem._promptTabNodes = nodes;
    return nodes;
}

function refreshCharacterPromptFieldVisuals(field) {
    if (!field) return;
    updateEmphasisHighlighting(field);
    autoResizeTextarea(field, 70, 0, false, true);
}

function syncCharacterPromptTabs(mainTab) {
    const characterItems = document.querySelectorAll('.character-prompt-item');

    characterItems.forEach(characterItem => {
        const nodes = getCharacterPromptTabNodes(characterItem);

        if (nodes.btnPrompt) nodes.btnPrompt.classList.toggle('active', mainTab === 'prompt');
        if (nodes.btnUc) nodes.btnUc.classList.toggle('active', mainTab === 'uc');
        if (nodes.btnCreative) nodes.btnCreative.classList.toggle('active', mainTab === 'creative');
        if (nodes.panePrompt) nodes.panePrompt.classList.toggle('active', mainTab === 'prompt');
        if (nodes.paneUc) nodes.paneUc.classList.toggle('active', mainTab === 'uc');

        if (nodes.tabsRoot) {
            nodes.tabsRoot.classList.remove('show-both');
        }

        if (nodes.toggleGroup) {
            nodes.toggleGroup.setAttribute('data-active', mainTab);
        }

        if (mainTab === 'prompt') {
            refreshCharacterPromptFieldVisuals(nodes.fieldPrompt);
        } else if (mainTab === 'uc') {
            refreshCharacterPromptFieldVisuals(nodes.fieldUc);
            refreshCharacterPromptFieldVisuals(nodes.fieldPromptNegative);
        }

        syncPromptTextareaContainersInScope(characterItem);
    });
}
// New function to sync character prompts to show both tabs
function syncCharacterPromptTabsShowBoth() {
    const characterItems = document.querySelectorAll('.character-prompt-item');

    characterItems.forEach(characterItem => {
        const nodes = getCharacterPromptTabNodes(characterItem);

        if (nodes.btnPrompt) nodes.btnPrompt.classList.add('active');
        if (nodes.btnUc) nodes.btnUc.classList.add('active');
        if (nodes.btnCreative) nodes.btnCreative.classList.add('active');
        if (nodes.panePrompt) nodes.panePrompt.classList.add('active');
        if (nodes.paneUc) nodes.paneUc.classList.add('active');

        if (nodes.tabsRoot) {
            nodes.tabsRoot.classList.add('show-both');
        }

        if (nodes.toggleGroup) {
            const currentActive = nodes.toggleGroup.getAttribute('data-active') || 'prompt';
            nodes.toggleGroup.setAttribute('data-active', currentActive);
        }

        refreshCharacterPromptFieldVisuals(nodes.fieldPrompt);
        refreshCharacterPromptFieldVisuals(nodes.fieldUc);
        syncPromptTextareaContainersInScope(characterItem);
    });
}

function toggleManualShowBoth() {
    const showBothBtn = document.getElementById('showBothBtn');
    const creativeTabShowBothBtn = document.getElementById('creativeTabShowBothBtn');
    const promptTabs = document.querySelector('#manualModal .prompt-tabs');

    const isShowingBoth = promptTabs.classList.contains('show-both');

    if (isShowingBoth) {
        // Return to single tab mode
        promptTabs.classList.remove('show-both');
        showBothBtn.dataset.state = 'off';
        showBothBtn.classList.remove('active');

        // Sync creative tab button
        if (creativeTabShowBothBtn) {
            creativeTabShowBothBtn.dataset.state = 'off';
            creativeTabShowBothBtn.classList.remove('active');
        }

        // Set Base Prompt as default when returning from show both mode
        syncCharacterPromptTabs('prompt');
    } else {
        // Show both panes
        promptTabs.classList.add('show-both');
        showBothBtn.dataset.state = 'on';
        showBothBtn.classList.add('active');

        // Sync creative tab button
        if (creativeTabShowBothBtn) {
            creativeTabShowBothBtn.dataset.state = 'on';
            creativeTabShowBothBtn.classList.add('active');
        }

        // Sync character prompts to show both tabs
        syncCharacterPromptTabsShowBoth();
    }

    // Update prompt status icons after toggling show both
    updatePromptStatusIcons();
    createDebouncedContextResolution();

    // updateManualTokenFreeDisplay: public/scripts/comp/utilities.js
    if (typeof updateManualTokenFreeDisplay === 'function') {
        updateManualTokenFreeDisplay();
    }
}

function attachManualTabListeners(signal) {
    const manualTabButtons = document.querySelectorAll('#manualModal .prompt-tabs .gallery-toggle-group .gallery-toggle-btn');
    const showBothBtn = document.getElementById('showBothBtn');

    document.addEventListener('focusin', (e) => {
        if (e.target.matches('.prompt-textarea, .character-prompt-textarea')) {
            window.lastFocusedPromptTextarea = e.target;
        }
    }, { signal });

    manualTabButtons.forEach(button => {
        let tabSwitchFocusSource = null;
        button.addEventListener('mousedown', () => {
            const active = document.activeElement;
            tabSwitchFocusSource = (active && active.matches('.prompt-textarea, .character-prompt-textarea'))
                ? active
                : null;
        }, { signal });
        button.addEventListener('click', (e) => {
            e.preventDefault();
            const targetTab = button.getAttribute('data-tab');
            switchManualTab(targetTab, tabSwitchFocusSource);
        }, { signal });
    });

    if (showBothBtn) {
        showBothBtn.addEventListener('click', (e) => {
            e.preventDefault();
            toggleManualShowBoth();
        }, { signal });
    }

    const creativeTabShowBothBtn = document.getElementById('creativeTabShowBothBtn');
    if (creativeTabShowBothBtn) {
        creativeTabShowBothBtn.addEventListener('click', (e) => {
            e.preventDefault();
            showBothBtn.click();
        }, { signal });
    }
}

function initManualTabListenerScope() {
    const manualModalEl = document.getElementById('manualModal');
    if (!manualModalEl) return;
    // attachModalListeners: public/scripts/comp/modalListenerScope.js
    attachModalListeners(manualModalEl, attachManualTabListeners);
}

if (typeof wsClient !== 'undefined' && wsClient.registerInitStep) {
    wsClient.registerInitStep(473, 'Manual tab listener scope', async () => {
        initManualTabListenerScope();
    });
} else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initManualTabListenerScope());
} else {
    initManualTabListenerScope();
}
