// keyboardShortcuts.js
// Keyboard shortcuts for the manual modal

let altKeyPressed = false;
let shortcutsOverlay = null;

// Initialize keyboard shortcuts
function initializeManualModalShortcuts() {
    console.log('Initializing manual modal keyboard shortcuts');
    // Create shortcuts overlay
    createShortcutsOverlay();
    
    // Add event listeners
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    console.log('Keyboard shortcuts initialized');
}

// Create the shortcuts overlay
function createShortcutsOverlay() {
    shortcutsOverlay = document.createElement('div');
    shortcutsOverlay.id = 'shortcutsOverlay';
    shortcutsOverlay.className = 'shortcuts-overlay';
    shortcutsOverlay.innerHTML = `
        <div class="shortcuts-content">
            <div class="shortcuts-title">Keyboard Shortcuts</div>
            <div class="shortcuts-grid">
                <div class="shortcut-item">
                    <span class="shortcut-key">Alt + 1</span>
                    <span class="shortcut-desc">Switch to Prompt Tab</span>
                </div>
                <div class="shortcut-item">
                    <span class="shortcut-key">Alt + 2</span>
                    <span class="shortcut-desc">Switch to UC Tab</span>
                </div>
                <div class="shortcut-item">
                    <span class="shortcut-key">Alt + A</span>
                    <span class="shortcut-desc">Dataset Tag Search</span>
                </div>
                <div class="shortcut-item">
                    <span class="shortcut-key">Alt + E</span>
                    <span class="shortcut-desc">Emphasis Editor</span>
                </div>
                <div class="shortcut-item">
                    <span class="shortcut-key">Alt + W</span>
                    <span class="shortcut-desc">Inline Search</span>
                </div>
                <div class="shortcut-item">
                    <span class="shortcut-key">Alt + C</span>
                    <span class="shortcut-desc">Add Character</span>
                </div>
                <div class="shortcut-item">
                    <span class="shortcut-key">Alt + V</span>
                    <span class="shortcut-desc">Reference Browser</span>
                </div>
                <div class="shortcut-item">
                    <span class="shortcut-key">Alt + ,</span>
                    <span class="shortcut-desc">Previous Image</span>
                </div>
                <div class="shortcut-item">
                    <span class="shortcut-key">Alt + .</span>
                    <span class="shortcut-desc">Next Image</span>
                </div>
                <div class="shortcut-item">
                    <span class="shortcut-key">Alt + X</span>
                    <span class="shortcut-desc">Start Generation</span>
                </div>
                <div class="shortcut-item">
                    <span class="shortcut-key">Alt + O</span>
                    <span class="shortcut-desc">Toggle Autofill</span>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(shortcutsOverlay);
}

// Handle key down events
function handleKeyDown(event) {
    const manualModal = document.getElementById('manualModal');
    const isManualModalOpen = manualModal && manualModal.style.display === 'flex';
    
    // Only handle shortcuts when manual modal is open
    if (!isManualModalOpen) return;
    
    // Debug logging for key events
    if (event.altKey) {
        console.log('ALT key combination detected:', event.key);
    }
    
    // Handle Alt key press
    if (event.key === 'Alt') {
        altKeyPressed = true;
        showShortcutsOverlay();
        return;
    }
    
    // Handle Alt + key combinations
    if (altKeyPressed && !event.altKey) {
        // Alt was released, hide overlay
        altKeyPressed = false;
        hideShortcutsOverlay();
        return;
    }
    
    if (event.altKey) {
        event.preventDefault();
        
        switch (event.key) {
            case '1':
                switchManualTab('prompt', document.activeElement);
                break;
            case '2':
                switchManualTab('uc', document.activeElement);
                break;
            case 'a':
            case 'A':
                showDatasetTagToolbar();
                break;
            case 'c':
            case 'C':
                addCharacterPrompt();
                break;
            case 'v':
            case 'V':
                showCacheBrowser();
                break;
            case 'e':
            case 'E':
                // Trigger emphasis mode in the active prompt toolbar
                const activeTextarea = document.activeElement;
                if (activeTextarea && (activeTextarea.matches('.prompt-textarea, .character-prompt-textarea'))) {
                    const toolbar = activeTextarea.closest('.prompt-textarea-container, .character-prompt-textarea-container')?.querySelector('.prompt-textarea-toolbar');
                    if (toolbar && window.promptTextareaToolbar) {
                        window.promptTextareaToolbar.openEmphasisMode(activeTextarea, toolbar);
                    }
                }
                break;
            case 'w':
            case 'W':
                // Trigger inline search in the active prompt toolbar
                const searchTextarea = document.activeElement;
                if (searchTextarea && (searchTextarea.matches('.prompt-textarea, .character-prompt-textarea'))) {
                    const searchToolbar = searchTextarea.closest('.prompt-textarea-container, .character-prompt-textarea-container')?.querySelector('.prompt-textarea-toolbar');
                    if (searchToolbar) {
                        const searchBtn = searchToolbar.querySelector('[data-action="search"]');
                        if (searchBtn) {
                            searchBtn.click();
                        }
                    }
                }
                break;
            case ',':
                navigateManualPreview({ currentTarget: { id: 'manualPreviewPrevBtn' } });
                break;
            case '.':
                navigateManualPreview({ currentTarget: { id: 'manualPreviewNextBtn' } });
                break;
            case 'x':
            case 'X':
                // Start generation
                const manualGenerateBtn = document.getElementById('manualGenerateBtn');
                if (manualGenerateBtn && !manualGenerateBtn.disabled) {
                    manualGenerateBtn.click();
                }
                break;
            case 'o':
            case 'O':
                // Toggle autofill
                if (window.toggleAutofill) {
                    const newState = window.toggleAutofill();
                    
                    // Update all autofill toggle buttons
                    const allToolbars = document.querySelectorAll('.prompt-textarea-toolbar');
                    allToolbars.forEach((toolbarElement, index) => {
                        const autofillBtn = toolbarElement.querySelector('[data-action="autofill"]');
                        if (autofillBtn) {
                            const isEnabled = window.isAutofillEnabled ? window.isAutofillEnabled() : true;
                            autofillBtn.setAttribute('data-state', isEnabled ? 'on' : 'off');
                            const icon = autofillBtn.querySelector('i');
                            if (icon) {
                                icon.className = isEnabled ? 'fas fa-lightbulb' : 'fas fa-lightbulb-slash';
                            }
                        } else {
                            console.log(`No autofill button found in toolbar ${index}`);
                        }
                    });
                } else {
                    console.log('toggleAutofill function not found on window object');
                }
                break;
        }
    }
}

// Handle key up events
function handleKeyUp(event) {
    if (event.key === 'Alt') {
        altKeyPressed = false;
        hideShortcutsOverlay();
    }
}

// Show shortcuts overlay
function showShortcutsOverlay() {
    if (shortcutsOverlay) {
        shortcutsOverlay.classList.add('visible');
    }
}

// Hide shortcuts overlay
function hideShortcutsOverlay() {
    if (shortcutsOverlay) {
        shortcutsOverlay.classList.remove('visible');
    }
}

// Clean up event listeners
function cleanupManualModalShortcuts() {
    document.removeEventListener('keydown', handleKeyDown);
    document.removeEventListener('keyup', handleKeyUp);
    
    if (shortcutsOverlay && shortcutsOverlay.parentNode) {
        shortcutsOverlay.parentNode.removeChild(shortcutsOverlay);
    }
} 