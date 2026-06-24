/**
 * Manual Tab Manager (Wave 2 — app.js refactor)
 *
 * Prompt/UC/creative tab switching in the manual generation modal.
 * Extracted from public/scripts/app.js; originals remain until manifest removal.
 *
 * Dependencies: manualModalManager.js, utilities.js (prepareManualTabLayout), emphasisManager.js
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
                // scheduleEmphasisHighlightUpdate: public/scripts/comp/emphasisManager.js
                scheduleEmphasisHighlightUpdate(focusTarget);
            }
        }, 10);
    }

    // Sync the selection to all character prompts
    syncCharacterPromptTabs(targetTab);

    if (ownsScrollbarBatch) {
        customScrollbar.endLayoutBatch();
    }
}

// New function to sync main window tab selection to all character prompts
function syncCharacterPromptTabs(mainTab) {
    const characterItems = document.querySelectorAll('.character-prompt-item');

    characterItems.forEach(characterItem => {
        const characterTabButtons = characterItem.querySelectorAll('.gallery-toggle-btn');
        const characterTabPanes = characterItem.querySelectorAll('.tab-pane');
        const toggleGroup = characterItem.querySelector('.gallery-toggle-group');
        const characterPromptTabs = characterItem.querySelector('.character-prompt-tabs');

        // Remove active class from all character tab buttons and panes
        characterTabButtons.forEach(btn => btn.classList.remove('active'));
        characterTabPanes.forEach(pane => pane.classList.remove('active'));

        // Add active class to the corresponding character tab button and pane
        const targetButton = characterItem.querySelector(`.gallery-toggle-btn[data-tab="${mainTab}"]`);
        const characterId = characterItem.id;
        const targetPane = document.getElementById(`${characterId}_${mainTab}-tab`);

        if (targetButton) targetButton.classList.add('active');
        if (targetPane) targetPane.classList.add('active');

        // Remove show-both class when switching to single tab mode
        if (characterPromptTabs) {
            characterPromptTabs.classList.remove('show-both');
        }

        // Update the data-active attribute for the character's slider
        if (toggleGroup) {
            toggleGroup.setAttribute('data-active', mainTab);
        }

        const promptTextarea = characterItem.querySelector(`#${characterId}_prompt`);
        const ucTextarea = characterItem.querySelector(`#${characterId}_uc`);
        const promptNegativeTextarea = characterItem.querySelector(`#${characterId}_promptNegative`);

        if (promptTextarea) {
            updateEmphasisHighlighting(promptTextarea);
            autoResizeTextarea(promptTextarea, 70, 0, false, true);
        }
        if (ucTextarea) {
            updateEmphasisHighlighting(ucTextarea);
            autoResizeTextarea(ucTextarea, 70, 0, false, true);
        }
        if (promptNegativeTextarea) {
            updateEmphasisHighlighting(promptNegativeTextarea);
            autoResizeTextarea(promptNegativeTextarea, 70, 0, false, true);
        }
        syncPromptTextareaContainersInScope(characterItem);
    });
}
// New function to sync character prompts to show both tabs
function syncCharacterPromptTabsShowBoth() {
    const characterItems = document.querySelectorAll('.character-prompt-item');

    characterItems.forEach(characterItem => {
        const characterTabButtons = characterItem.querySelectorAll('.gallery-toggle-btn');
        const characterTabPanes = characterItem.querySelectorAll('.tab-pane');
        const toggleGroup = characterItem.querySelector('.gallery-toggle-group');
        const characterPromptTabs = characterItem.querySelector('.character-prompt-tabs');
        const characterId = characterItem.id;

        // Show both character tab buttons and panes
        characterTabButtons.forEach(btn => btn.classList.add('active'));
        characterTabPanes.forEach(pane => pane.classList.add('active'));

        // Add show-both class to character-prompt-tabs for visual separation
        if (characterPromptTabs) {
            characterPromptTabs.classList.add('show-both');
        }

        // Update the data-active attribute for the character's slider (keep current state)
        if (toggleGroup) {
            const currentActive = toggleGroup.getAttribute('data-active') || 'prompt';
            toggleGroup.setAttribute('data-active', currentActive);
        }

        // Update emphasis highlighting for both prompt and UC textareas
        const promptTextarea = characterItem.querySelector(`#${characterId}_prompt`);
        const ucTextarea = characterItem.querySelector(`#${characterId}_uc`);

        if (promptTextarea) {
            updateEmphasisHighlighting(promptTextarea);
            autoResizeTextarea(promptTextarea, 70, 0, false, true);
        }
        if (ucTextarea) {
            updateEmphasisHighlighting(ucTextarea);
            autoResizeTextarea(ucTextarea, 70, 0, false, true);
        }
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
}

function wireManualTabListeners() {
    if (document.documentElement.dataset.manualTabListenersWired === '1') return;
    document.documentElement.dataset.manualTabListenersWired = '1';
        // Tab switching functionality for prompt/UC tabs (Manual Generation Model)
        const manualTabButtons = document.querySelectorAll('#manualModal .prompt-tabs .gallery-toggle-group .gallery-toggle-btn');
        const showBothBtn = document.getElementById('showBothBtn');
    
        // Add focus event listeners to all textareas to track the last focused one
        document.addEventListener('focusin', (e) => {
            if (e.target.matches('.prompt-textarea, .character-prompt-textarea')) {
                window.lastFocusedPromptTextarea = e.target;
            }
        });
    
        manualTabButtons.forEach(button => {
            let tabSwitchFocusSource = null;
            button.addEventListener('mousedown', () => {
                const active = document.activeElement;
                tabSwitchFocusSource = (active && active.matches('.prompt-textarea, .character-prompt-textarea'))
                    ? active
                    : null;
            });
            button.addEventListener('click', (e) => {
                e.preventDefault();
                const targetTab = button.getAttribute('data-tab');
                switchManualTab(targetTab, tabSwitchFocusSource);
            });
        });
    
        // Show both panes functionality
        if (showBothBtn) {
            showBothBtn.addEventListener('click', (e) => {
                e.preventDefault();
                toggleManualShowBoth();
            });
        }
    
        // Creative tab toolbar buttons - sync with main buttons
        const creativeTabShowBothBtn = document.getElementById('creativeTabShowBothBtn');
    
        if (creativeTabShowBothBtn) {
            creativeTabShowBothBtn.addEventListener('click', (e) => {
                e.preventDefault();
                // Trigger the main button's click
                showBothBtn.click();
            });
        }
}

if (typeof wsClient !== 'undefined' && wsClient.registerInitStep) {
    wsClient.registerInitStep(47.2, 'Manual tab listeners', async () => {
        wireManualTabListeners();
    });
} else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => wireManualTabListeners());
} else {
    wireManualTabListeners();
}
