// Confirmation Dialog System
// Uses the 2-row popover design similar to emphasis popup

let confirmationDialog = null;
let confirmationDialogActive = false;
let confirmationDialogCallback = null;
let confirmationDialogCancelCallback = null;

// Create and show confirmation dialog with multiple options
function showConfirmationDialog(message, options = [], event = null) {
    return new Promise((resolve, reject) => {
        // Handle legacy format: (message, confirmText, cancelText, event)
        if (typeof options === 'string') {
            const confirmText = options;
            const cancelText = arguments[2] || 'Cancel';
            const eventArg = arguments[3];
            
            options = [
                { text: confirmText, value: true, className: 'btn-primary' },
                { text: cancelText, value: false, className: 'btn-secondary' }
            ];
            event = eventArg;
        }

        // Create dialog if it doesn't exist
        if (!confirmationDialog) {
            confirmationDialog = document.createElement('div');
            confirmationDialog.id = 'confirmationDialog';
            confirmationDialog.className = 'confirmation-dialog';
            confirmationDialog.innerHTML = `
                <div class="confirmation-dialog-content">
                    <div class="confirmation-message" id="confirmationMessage"></div>
                    <div class="confirmation-controls" id="confirmationControls">
                    </div>
                </div>
            `;
            document.body.appendChild(confirmationDialog);

            // Close on escape key
            const handleEscape = (e) => {
                if (e.key === 'Escape') {
                    hideConfirmationDialog();
                    resolve(null);
                }
            };
            document.addEventListener('keydown', handleEscape);
            confirmationDialog.dataset.escapeHandler = 'true';
        }

        // Update dialog content
        const messageEl = confirmationDialog.querySelector('#confirmationMessage');
        const controlsEl = confirmationDialog.querySelector('#confirmationControls');

        // Check if message contains HTML tags
        if (message.includes('<') && message.includes('>')) {
            messageEl.innerHTML = message;
        } else {
            messageEl.textContent = message;
        }
        
        // Clear and recreate controls
        controlsEl.innerHTML = '';
        
        options.forEach((option, index) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `btn ${option.className || 'btn-secondary'}`;
            button.textContent = option.text;
            button.id = `confirmationBtn${index}`;
            
            button.addEventListener('click', (e) => {
                e.preventDefault();
                hideConfirmationDialog();
                resolve(option.value);
            });
            
            controlsEl.appendChild(button);
            
            // Focus the last button (usually cancel) by default
            if (index === options.length - 1) {
                button.focus();
            }
        });

        // Position dialog
        positionConfirmationDialog(event);

        // Show dialog
        openModal(confirmationDialog);
        confirmationDialogActive = true;
    });
}

// Position the dialog near the mouse cursor or button
function positionConfirmationDialog(event) {
    if (!confirmationDialog) return;

    let x, y;
    
    if (event) {
        // Use mouse position or button position
        if (event.clientX && event.clientY) {
            x = event.clientX;
            y = event.clientY;
        } else if (event.target) {
            const rect = event.target.getBoundingClientRect();
            x = rect.left + rect.width / 2;
            y = rect.top + rect.height / 2;
        }
    } else {
        // Center on screen if no event
        x = window.innerWidth / 2;
        y = window.innerHeight / 2;
    }

    // Get dialog dimensions
    const dialogRect = confirmationDialog.getBoundingClientRect();
    const dialogWidth = dialogRect.width || 350; // Default width
    const dialogHeight = dialogRect.height || 120; // Default height

    // Calculate position to center on cursor/button
    let left = x - dialogWidth / 2;
    let top = y - dialogHeight / 2;

    // Ensure dialog doesn't go off screen
    const margin = 20;
    
    // Check horizontal bounds
    if (left < margin) {
        left = margin;
    } else if (left + dialogWidth > window.innerWidth - margin) {
        left = window.innerWidth - dialogWidth - margin;
    }

    // Check vertical bounds
    if (top < margin) {
        top = margin;
    } else if (top + dialogHeight > window.innerHeight - margin) {
        top = window.innerHeight - dialogHeight - margin;
    }

    // Apply position
    confirmationDialog.style.left = `min(${left}px, calc(100vw - 525px))`;
    confirmationDialog.style.top = `min(${top}px, calc(100vh - 200px))`;
}

// Hide confirmation dialog
function hideConfirmationDialog() {
    if (confirmationDialog) {
        closeModal(confirmationDialog);
        confirmationDialogActive = false;
        
        // Remove escape key handler
        if (confirmationDialog.dataset.escapeHandler) {
            document.removeEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    hideConfirmationDialog();
                }
            });
            delete confirmationDialog.dataset.escapeHandler;
        }
    }
}

// Check if confirmation dialog is active
function isConfirmationDialogActive() {
    return confirmationDialogActive;
}

// Export functions
window.showConfirmationDialog = showConfirmationDialog;
window.hideConfirmationDialog = hideConfirmationDialog;
window.isConfirmationDialogActive = isConfirmationDialogActive; 