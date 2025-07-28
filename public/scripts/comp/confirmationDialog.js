// Confirmation Dialog System
// Uses the 2-row popover design similar to emphasis popup

let confirmationDialog = null;
let confirmationDialogActive = false;
let confirmationDialogCallback = null;
let confirmationDialogCancelCallback = null;

// Create and show confirmation dialog
function showConfirmationDialog(message, confirmText = 'Confirm', cancelText = 'Cancel', event = null) {
    return new Promise((resolve, reject) => {
        // Create dialog if it doesn't exist
        if (!confirmationDialog) {
            confirmationDialog = document.createElement('div');
            confirmationDialog.id = 'confirmationDialog';
            confirmationDialog.className = 'confirmation-dialog';
            confirmationDialog.innerHTML = `
                <div class="confirmation-dialog-content">
                    <div class="confirmation-message" id="confirmationMessage"></div>
                    <div class="confirmation-controls">
                        <button class="btn-secondary confirmation-cancel" id="confirmationCancelBtn"></button>
                        <button class="btn-primary confirmation-confirm" id="confirmationConfirmBtn"></button>
                    </div>
                </div>
            `;
            document.body.appendChild(confirmationDialog);

            // Add event listeners
            const confirmBtn = confirmationDialog.querySelector('#confirmationConfirmBtn');
            const cancelBtn = confirmationDialog.querySelector('#confirmationCancelBtn');

            confirmBtn.addEventListener('click', () => {
                hideConfirmationDialog();
                resolve(true);
            });

            cancelBtn.addEventListener('click', () => {
                hideConfirmationDialog();
                resolve(false);
            });

            // Close on escape key
            const handleEscape = (e) => {
                if (e.key === 'Escape') {
                    hideConfirmationDialog();
                    resolve(false);
                }
            };
            document.addEventListener('keydown', handleEscape);
            confirmationDialog.dataset.escapeHandler = 'true';
        }

        // Update dialog content
        const messageEl = confirmationDialog.querySelector('#confirmationMessage');
        const confirmBtn = confirmationDialog.querySelector('#confirmationConfirmBtn');
        const cancelBtn = confirmationDialog.querySelector('#confirmationCancelBtn');

        messageEl.textContent = message;
        confirmBtn.textContent = confirmText;
        cancelBtn.textContent = cancelText;

        // Position dialog
        positionConfirmationDialog(event);

        // Show dialog
        confirmationDialog.style.display = 'block';
        confirmationDialogActive = true;

        // Focus cancel button (as requested)
        cancelBtn.focus();
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
    confirmationDialog.style.left = left + 'px';
    confirmationDialog.style.top = top + 'px';
}

// Hide confirmation dialog
function hideConfirmationDialog() {
    if (confirmationDialog) {
        confirmationDialog.style.display = 'none';
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