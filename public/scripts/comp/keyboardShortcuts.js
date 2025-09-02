// keyboardShortcuts.js
// Keyboard shortcuts for the manual modal

let altKeyPressed = false;
let shortcutsOverlay = null;

// Initialize keyboard shortcuts
function initializeManualModalShortcuts() {
    createShortcutsOverlay();
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
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
                    <span class="shortcut-key">F1</span>
                    <span class="shortcut-desc"><span>Prompts</span><i class="nai-penwriting"></i></span>
                </div>
                <div class="shortcut-item">
                    <span class="shortcut-key">F2</span>
                    <span class="shortcut-desc"><span>UC</span><i class="fa fa-ban"></i></span>
                </div>
                <div class="shortcut-item">
                    <span class="shortcut-key">ALT + F1</span>
                    <span class="shortcut-desc"><span>Prompts/UC</span><i class="nai-detatch-up"></i></span>
                </div>
                <div class="shortcut-item">
                    <span class="shortcut-key">F3</span>
                    <span class="shortcut-desc"><span>Emphasis</span><i class="fa fa-scale-unbalanced-flip"></i></span>
                </div>
                <div class="shortcut-item">
                    <span class="shortcut-key">F4</span>
                    <span class="shortcut-desc"><span>Quick Access</span><i class="fa fa-book-skull"></i></span>
                </div>
                <div class="divider"></div>
                <div class="shortcut-item">
                    <span class="shortcut-key">F5</span>
                    <span class="shortcut-desc"><span>Generate</span><i class="fa fa-sparkles"></i></span>
                </div>
                <div class="shortcut-item">
                    <span class="shortcut-key">F6</span>
                    <span class="shortcut-desc"><span>References</span><i class="nai-img2img"></i></span>
                </div>
                <div class="shortcut-item">
                    <span class="shortcut-key">F7</span>
                    <span class="shortcut-desc"></span>
                </div>
                <div class="shortcut-item">
                    <span class="shortcut-key">F8</span>
                    <span class="shortcut-desc"><span>Keep Seed</span><i class="fas fa-dice"></i></span>
                </div>
                <div class="divider"></div>
                <div class="shortcut-item">
                    <span class="shortcut-key">ALT + A</span>
                    <span class="shortcut-desc"><span>Add Character</span><i class="fa fa-user-plus"></i></span>
                </div>
                <div class="shortcut-item">
                    <span class="shortcut-key">CTRL + F</span>
                    <span class="shortcut-desc"><span>Inline Search</span><i class="fa fa-search"></i></span>
                </div>
                <div class="shortcut-item">
                    <span class="shortcut-key">CTRL + I</span>
                    <span class="shortcut-desc"><span>Toggle Autofill</span><i class="fa fa-lightbulb"></i></span>
                </div>
                <div class="shortcut-item">
                    <span class="shortcut-key">Alt + F</span>
                    <span class="shortcut-desc"><span>Favorite Tag</span><i class="fa fa-star"></i></span>
                </div>
                <div class="divider"></div>
                <div class="shortcut-item">
                    <span class="shortcut-key">Alt + ,</span>
                    <span class="shortcut-desc"><span>Previous Image</span><i class="fa fa-arrow-left"></i></span>
                </div>
                <div class="shortcut-item">
                    <span class="shortcut-key">Alt + .</span>
                    <span class="shortcut-desc"><span>Next Image</span><i class="fa fa-arrow-right"></i></span>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(shortcutsOverlay);
}

// Handle key down events
function handleKeyDown(event) {
    const textReplacementModal = document.getElementById('textReplacementManagerModal');
    const createTextReplacementModal = document.getElementById('createTextReplacementModal');
    
    const isTextReplacementModalOpen = textReplacementModal && !textReplacementModal.classList.contains('hidden');
    const isCreateTextReplacementModalOpen = createTextReplacementModal && !createTextReplacementModal.classList.contains('hidden');
    
    // Only handle shortcuts when relevant modals are open
    if (manualModal.classList.contains('hidden') && !isTextReplacementModalOpen && !isCreateTextReplacementModalOpen) return;
    
    // Handle Alt key press
    if (event.key === 'Alt') {
        event.preventDefault();
        event.stopPropagation();
        showShortcutsOverlay();
        altKeyPressed = true;
        return;
    }
    
    // Handle Alt + key combinations
    if (altKeyPressed && !event.altKey) {
        // Alt was released, hide overlay
        altKeyPressed = false;
        hideShortcutsOverlay();
        return;
    }
    
    switch (`${event.ctrlKey ? 'CTRL+' : ''}${event.altKey ? 'ALT+' : ''}${event.metaKey ? 'META+' : ''}${event.shiftKey ? 'SHIFT+' : ''}${event.key.toUpperCase()}`) {
        case 'F1':
            if (isTextReplacementModalOpen || isCreateTextReplacementModalOpen) return;
            event.preventDefault();
            event.stopPropagation();
            switchManualTab('prompt', document.activeElement);
            break;
        case 'F2':
            if (isTextReplacementModalOpen || isCreateTextReplacementModalOpen) return;
            event.preventDefault();
            event.stopPropagation();
            switchManualTab('uc', document.activeElement);
            break;
        case 'ALT+F1':
            if (isTextReplacementModalOpen || isCreateTextReplacementModalOpen) return;
            event.preventDefault();
            event.stopPropagation();
            toggleManualShowBoth();
            break;
        case 'F3':
            // Trigger emphasis mode in the active prompt toolbar
            const activeTextarea = document.activeElement;
            if (activeTextarea && (activeTextarea.matches('.prompt-textarea, .character-prompt-textarea'))) {
                const toolbar = activeTextarea.closest('.prompt-textarea-container, .character-prompt-textarea-container')?.querySelector('.prompt-textarea-toolbar');
                if (toolbar && window.promptTextareaToolbar) {
                    event.preventDefault();
                    event.stopPropagation();
                    window.promptTextareaToolbar.openEmphasisMode(activeTextarea, toolbar);
                }
            }
            break;
        case 'F4':
            event.preventDefault();
            event.stopPropagation();
            showDatasetTagToolbar();
            break;
        case 'F5':
            event.preventDefault();
            event.stopPropagation();
            if (isTextReplacementModalOpen || isCreateTextReplacementModalOpen) return;
            
            // Check if manual modal is open
            const manualModal = document.getElementById('manualModal');
            const isInModal = manualModal && !manualModal.classList.contains('hidden');
            
            if (isInModal) {
                // In modal: trigger generation
                const manualGenerateBtn = document.getElementById('manualGenerateBtn');
                if (manualGenerateBtn && !manualGenerateBtn.disabled) {
                    manualGenerateBtn.click();
                }
            } else {
                // Not in modal: show refresh confirmation
                if (typeof showExitConfirmation === 'function') {
                    showExitConfirmation(event, 'refresh');
                } else {
                    // Fallback: show browser confirmation
                    if (confirm('Are you sure you want to restart the application?')) {
                        window.location.reload();
                    }
                }
            }
            break;
        case 'F6':
            if (isTextReplacementModalOpen || isCreateTextReplacementModalOpen) return;
            event.preventDefault();
            event.stopPropagation();
            showCacheBrowser();
            break;
        case 'F8':
            if (isTextReplacementModalOpen || isCreateTextReplacementModalOpen) return;
            event.preventDefault();
            event.stopPropagation();
            if (window.lastLoadedSeed) {
                toggleSproutSeed();
                updateSproutSeedButton();
            }
            break;
        case 'ALT+A':
            if (isTextReplacementModalOpen || isCreateTextReplacementModalOpen) return;
            event.preventDefault();
            event.stopPropagation();
            addCharacterPrompt();
            break;
        case 'CTRL+F':
            if (isTextReplacementModalOpen || isCreateTextReplacementModalOpen) return;
            // Trigger inline search in the active prompt toolbar
            const searchTextarea = document.activeElement;
            if (searchTextarea && (searchTextarea.matches('.prompt-textarea, .character-prompt-textarea'))) {
                const searchToolbar = searchTextarea.closest('.prompt-textarea-container, .character-prompt-textarea-container')?.querySelector('.prompt-textarea-toolbar');
                if (searchToolbar && window.promptTextareaToolbar) {
                    event.preventDefault();
                    event.stopPropagation();
                    // Check if already in search mode
                    if (searchToolbar.classList.contains('search-mode')) {
                        return;
                    }
                    window.promptTextareaToolbar.openSearch(searchTextarea);
                }
            }
            break;
        case 'ALT+,':
        case 'ALT+≤':
            if (isTextReplacementModalOpen || isCreateTextReplacementModalOpen) return;
            event.preventDefault();
            event.stopPropagation();
            navigateManualPreview({ currentTarget: { id: 'manualPreviewPrevBtn' } });
            break;
        case 'ALT+.':
        case 'ALT+≥':
            if (isTextReplacementModalOpen || isCreateTextReplacementModalOpen) return;
            event.preventDefault();
            event.stopPropagation();
            navigateManualPreview({ currentTarget: { id: 'manualPreviewNextBtn' } });
            break;
        case 'CTRL+I':
            // Toggle autofill
            if (window.toggleAutofill) {
                event.preventDefault();
                event.stopPropagation();
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
                    }
                });
            }
            break;
            
        // Exit confirmation keyboard shortcuts
        case 'CTRL+R':
            // Refresh - show custom confirmation dialog
            if (typeof window.showExitConfirmation === 'function') {
                event.preventDefault();
                event.stopPropagation();
                window.showExitConfirmation(event, 'refresh');
            }
            break;
            
        case 'CTRL+SHIFT+R':
            // Hard refresh - show custom confirmation dialog
            if (typeof window.showExitConfirmation === 'function') {
                event.preventDefault();
                event.stopPropagation();
                window.showExitConfirmation(event, 'refresh');
            }
            break;
            
        case 'CTRL+W':
            // Close tab - let browser handle, beforeunload will show warning
            // Don't prevent default - let browser show "unsaved changes" dialog
            break;
            
        case 'CTRL+SHIFT+W':
            // Close window - let browser handle, beforeunload will show warning
            // Don't prevent default - let browser show "unsaved changes" dialog
            break;
            
        case 'ALT+F4':
            // Close window (Windows) - let browser handle, beforeunload will show warning
            // Don't prevent default - let browser show "unsaved changes" dialog
            break;
            
        default:
            break;
    }
}

// Handle key up events
function handleKeyUp(event) {
    if (event.key === 'Alt') {
        altKeyPressed = false;
        hideShortcutsOverlay();
    }
}

let shortcutOverlayTimeout = null;
// Show shortcuts overlay
function showShortcutsOverlay() {
    if (shortcutsOverlay && !altKeyPressed) {
        shortcutsOverlay.classList.add('visible');
        shortcutOverlayTimeout = setTimeout(() => {
            shortcutsOverlay.classList.remove('visible');
        }, 30000);
    }
}

// Hide shortcuts overlay
function hideShortcutsOverlay() {
    if (shortcutsOverlay) {
        shortcutsOverlay.classList.remove('visible');
        clearTimeout(shortcutOverlayTimeout);
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

window.wsClient.registerInitStep(50, 'Initializing Keyboard Shortcuts', async () => {
    await initializeManualModalShortcuts();
});