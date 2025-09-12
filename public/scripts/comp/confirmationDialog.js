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

    // Check if mobile (under 768px wide) or no event was passed
    const isMobile = window.innerWidth < 768;
    const shouldCenter = !event || isMobile;

    let x, y;

    if (!shouldCenter && event) {
        // Use mouse position or button position
        if (event.clientX && event.clientY) {
            x = event.clientX;
            y = event.clientY;
        } else if (event.target && event.target.getBoundingClientRect) {
            const rect = event.target.getBoundingClientRect();
            x = rect.left + rect.width / 2;
            y = rect.top + rect.height / 2;
        }
    }

    // Temporarily make dialog visible to get accurate dimensions
    const wasHidden = confirmationDialog.classList.contains('hidden');
    if (wasHidden) {
        confirmationDialog.style.visibility = 'hidden'; // Keep it invisible but allow dimension calculation
        confirmationDialog.classList.remove('hidden');
    }

    // Get accurate dialog dimensions
    const dialogRect = confirmationDialog.getBoundingClientRect();
    const dialogWidth = dialogRect.width || 350; // Default width
    const dialogHeight = dialogRect.height || 120; // Default height

    // Restore hidden state if it was hidden
    if (wasHidden) {
        confirmationDialog.classList.add('hidden');
        confirmationDialog.style.visibility = '';
    }

    let left, top;

    if (shouldCenter) {
        // Center on screen for mobile or when no event
        left = (window.innerWidth - dialogWidth) / 2;
        top = (window.innerHeight - dialogHeight) / 2;
    } else {
        // Calculate position to center on cursor/button
        left = x - dialogWidth / 2;
        top = y - dialogHeight / 2;
    }

    // Ensure dialog never goes outside viewport bounds
    const margin = 20;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Check horizontal bounds with proper validation
    if (left < margin) {
        left = margin;
    } else if (left + dialogWidth > viewportWidth - margin) {
        left = viewportWidth - dialogWidth - margin;
    }

    // Ensure left position is never negative or exceeds viewport
    if (left < 0) {
        left = margin;
    }
    if (left + dialogWidth > viewportWidth) {
        left = viewportWidth - dialogWidth - margin;
        if (left < 0) left = margin; // Fallback if dialog is too wide
    }

    // Check vertical bounds with proper validation
    if (top < margin) {
        top = margin;
    } else if (top + dialogHeight > viewportHeight - margin) {
        top = viewportHeight - dialogHeight - margin;
    }

    // Ensure top position is never negative or exceeds viewport
    if (top < 0) {
        top = margin;
    }
    if (top + dialogHeight > viewportHeight) {
        top = viewportHeight - dialogHeight - margin;
        if (top < 0) top = margin; // Fallback if dialog is too tall
    }

    // Final validation - ensure dialog stays within viewport
    left = Math.max(margin, Math.min(left, viewportWidth - dialogWidth - margin));
    top = Math.max(margin, Math.min(top, viewportHeight - dialogHeight - margin));

    // Apply position
    confirmationDialog.style.left = `${left}px`;
    confirmationDialog.style.top = `${top}px`;
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