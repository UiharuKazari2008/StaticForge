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

            // Clear any existing content
            button.innerHTML = '';

            // Add icon if provided
            if (option.icon) {
                const iconElement = document.createElement('i');
                iconElement.className = option.icon;
                button.appendChild(iconElement);
                button.appendChild(document.createTextNode(' ')); // Add space between icon and text
            }

            // Add text content
            button.appendChild(document.createTextNode(option.text));
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
        // Use CSS centering for mobile - remove manual positioning
        confirmationDialog.style.left = '';
        confirmationDialog.style.top = '';
        confirmationDialog.style.transform = '';
        return;
    } else {
        // Calculate position to center on cursor/button
        left = x - dialogWidth / 2;
        top = y - dialogHeight / 2;

    // Get safe area inset values
    const trueInsetTop = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--true-inset-top')) || 0;
    const safeAreaLeft = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--inset-left')) || 0;
    const safeAreaRight = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--inset-right')) || 0;
    const safeAreaBottom = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--inset-bottom')) || 0;

    // Ensure dialog never goes outside viewport bounds, accounting for safe areas
    const margin = 20;
    const viewportWidth = window.innerWidth - safeAreaLeft - safeAreaRight;
    const viewportHeight = window.innerHeight - trueInsetTop - safeAreaBottom;

    // Check horizontal bounds with proper validation
    if (left < margin + safeAreaLeft) {
        left = margin + safeAreaLeft;
    } else if (left + dialogWidth > viewportWidth - margin - safeAreaRight) {
        left = viewportWidth - dialogWidth - margin - safeAreaRight;
    }

    // Ensure left position is never negative or exceeds viewport
    if (left < safeAreaLeft) {
        left = margin + safeAreaLeft;
    }
    if (left + dialogWidth > window.innerWidth - safeAreaRight) {
        left = window.innerWidth - dialogWidth - margin - safeAreaRight;
        if (left < safeAreaLeft) left = margin + safeAreaLeft; // Fallback if dialog is too wide
    }

    // Check vertical bounds with proper validation
    if (top < margin + trueInsetTop) {
        top = margin + trueInsetTop;
    } else if (top + dialogHeight > viewportHeight - margin - safeAreaBottom) {
        top = viewportHeight - dialogHeight - margin - safeAreaBottom;
    }

    // Ensure top position is never negative or exceeds viewport
    if (top < trueInsetTop) {
        top = margin + trueInsetTop;
    }
    if (top + dialogHeight > window.innerHeight - safeAreaBottom) {
        top = window.innerHeight - dialogHeight - margin - safeAreaBottom;
        if (top < trueInsetTop) top = margin + trueInsetTop; // Fallback if dialog is too tall
    }

    // Final validation - ensure dialog stays within viewport
    left = Math.max(margin + safeAreaLeft, Math.min(left, window.innerWidth - dialogWidth - margin - safeAreaRight));
    top = Math.max(margin + trueInsetTop, Math.min(top, window.innerHeight - dialogHeight - margin - safeAreaBottom));

    // Apply position - override CSS centering for desktop positioning
    confirmationDialog.style.left = `${left}px`;
    confirmationDialog.style.top = `${top}px`;
    confirmationDialog.style.transform = 'translateZ(0) scale(1)';
    }
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