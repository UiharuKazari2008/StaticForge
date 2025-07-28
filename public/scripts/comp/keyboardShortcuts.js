// keyboardShortcuts.js
// Keyboard shortcuts for the manual modal

let altKeyPressed = false;
let shortcutsOverlay = null;

// Initialize keyboard shortcuts
function initializeManualModalShortcuts() {
    // Create shortcuts overlay
    createShortcutsOverlay();
    
    // Add event listeners
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
                    <span class="shortcut-key">Alt + 1</span>
                    <span class="shortcut-desc">Switch to Prompt Tab</span>
                </div>
                <div class="shortcut-item">
                    <span class="shortcut-key">Alt + 2</span>
                    <span class="shortcut-desc">Switch to UC Tab</span>
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
                switchManualTab('prompt');
                break;
            case '2':
                switchManualTab('uc');
                break;
            case 'c':
            case 'C':
                addCharacterPrompt();
                break;
            case 'v':
            case 'V':
                showCacheBrowser();
                break;
            case ',':
                navigateManualPreview({ currentTarget: { id: 'manualPreviewPrevBtn' } });
                break;
            case '.':
                navigateManualPreview({ currentTarget: { id: 'manualPreviewNextBtn' } });
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