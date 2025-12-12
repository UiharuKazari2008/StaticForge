// Confirmation Dialog System
// Uses the modal design pattern with title bar and standard positioning

let confirmationDialog = null;
let confirmationDialogActive = false;
let confirmationDialogCallback = null;
let confirmationDialogCancelCallback = null;
let currentResolve = null;
let escapeHandler = null;

// Create and show confirmation dialog with multiple options
function showConfirmationDialog(message, options = [], event = null) {
    return new Promise((resolve, reject) => {
        // Handle legacy format: (message, confirmText, cancelText, event)
        if (typeof options === 'string') {
            const confirmText = options;
            const cancelText = arguments[2] || 'Cancel';
            const eventArg = arguments[3];
            
            options = [
                { text: confirmText, value: true, className: 'btn-standard primary' },
                { text: cancelText, value: false, className: 'btn-standard' }
            ];
            event = eventArg;
        }

        // Store resolve for escape key handling
        currentResolve = resolve;

        // Create dialog if it doesn't exist
        if (!confirmationDialog) {
            confirmationDialog = document.createElement('div');
            confirmationDialog.id = 'confirmationDialog';
            confirmationDialog.className = 'modal hidden transient';
            confirmationDialog.innerHTML = `
                <div class="modal-window-title">
                    <div class="modal-window-title-main">
                        <i class="fas fa-question-circle"></i>
                        <span id="confirmationDialogTitle">Confirm</span>
                    </div>
                </div>
                <div class="modal-window-controls">
                    <button type="button" class="btn-danger close-btn btn-small" title="Close">
                        <i class="fa-regular fa-xmark-large"></i>
                    </button>
                </div>
                <div class="modal-content modal-padding dark">
                    <div class="confirmation-message" id="confirmationMessage"></div>
                    <div class="confirmation-controls" id="confirmationControls">
                    </div>
                </div>
            `;
            document.body.appendChild(confirmationDialog);

            // Close button handler
            const closeBtn = confirmationDialog.querySelector('.close-btn');
            closeBtn.addEventListener('click', () => {
                hideConfirmationDialog();
                if (currentResolve) {
                    currentResolve(null);
                    currentResolve = null;
                }
            });
        }

        // Update title
        const titleEl = confirmationDialog.querySelector('#confirmationDialogTitle');
        const titleIcon = confirmationDialog.querySelector('.modal-window-title-main i');
        if (titleEl) {
            titleEl.textContent = 'Confirm';
        }
        if (titleIcon) {
            titleIcon.className = 'fas fa-question-circle';
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
                if (currentResolve) {
                    currentResolve(option.value);
                    currentResolve = null;
                }
            });
            
            controlsEl.appendChild(button);
            
            // Focus the last button (usually cancel) by default
            if (index === options.length - 1) {
                button.focus();
            }
        });

        // Set up escape key handler
        if (escapeHandler) {
            document.removeEventListener('keydown', escapeHandler);
        }
        escapeHandler = (e) => {
            if (e.key === 'Escape' && confirmationDialogActive && !confirmationDialog.classList.contains('hidden')) {
                hideConfirmationDialog();
                if (currentResolve) {
                    currentResolve(null);
                    currentResolve = null;
                }
            }
        };
        document.addEventListener('keydown', escapeHandler);

        // Show dialog - modal system handles positioning
        openModal(confirmationDialog);
        confirmationDialogActive = true;

        // Position dialog near event if provided
        if (event) {
            positionConfirmationDialog(event);
        }
    });
}


// Position the dialog near the mouse cursor or button
function positionConfirmationDialog(event) {
    if (!confirmationDialog || !event) return;

    // Check if mobile (under 768px wide) - center on mobile
    const isMobile = window.innerWidth < 768;
    if (isMobile) {
        // Reset to default centering for mobile
        confirmationDialog.style.left = '';
        confirmationDialog.style.top = '';
        confirmationDialog.style.transform = '';
        return;
    }

    // Get click position
    let x, y;
    if (event.clientX !== undefined && event.clientY !== undefined) {
        x = event.clientX;
        y = event.clientY;
    } else if (event.target && event.target.getBoundingClientRect) {
        const rect = event.target.getBoundingClientRect();
        x = rect.left + rect.width / 2;
        y = rect.top + rect.height / 2;
    } else {
        return; // Can't determine position
    }

    // Wait for modal to be visible to get accurate dimensions
    requestAnimationFrame(() => {
        const dialogRect = confirmationDialog.getBoundingClientRect();
        const dialogWidth = dialogRect.width || 400;
        const dialogHeight = dialogRect.height || 150;

        // Calculate position to center on cursor/button
        let left = x - dialogWidth / 2;
        let top = y - dialogHeight / 2;

        // Get safe area inset values
        const trueInsetTop = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--true-inset-top')) || 0;
        const safeAreaLeft = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--inset-left')) || 0;
        const safeAreaRight = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--inset-right')) || 0;
        const safeAreaBottom = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--inset-bottom')) || 0;

        // Ensure dialog never goes outside viewport bounds, accounting for safe areas
        const margin = 20;
        const viewportWidth = window.innerWidth - safeAreaLeft - safeAreaRight;
        const viewportHeight = window.innerHeight - trueInsetTop - safeAreaBottom;

        // Check horizontal bounds
        if (left < margin + safeAreaLeft) {
            left = margin + safeAreaLeft;
        } else if (left + dialogWidth > viewportWidth - margin - safeAreaRight) {
            left = viewportWidth - dialogWidth - margin - safeAreaRight;
        }

        // Check vertical bounds
        if (top < margin + trueInsetTop) {
            top = margin + trueInsetTop;
        } else if (top + dialogHeight > viewportHeight - margin - safeAreaBottom) {
            top = viewportHeight - dialogHeight - margin - safeAreaBottom;
        }

        // Final validation - ensure dialog stays within viewport
        left = Math.max(margin + safeAreaLeft, Math.min(left, window.innerWidth - dialogWidth - margin - safeAreaRight));
        top = Math.max(margin + trueInsetTop, Math.min(top, window.innerHeight - dialogHeight - margin - safeAreaBottom));

        // Apply position - override CSS centering
        confirmationDialog.style.left = `${left}px`;
        confirmationDialog.style.top = `${top}px`;
        confirmationDialog.style.transform = 'translateZ(0) scale(1)';
    });
}

// Hide confirmation dialog
async function hideConfirmationDialog() {
    if (confirmationDialog) {
        await closeModal(confirmationDialog);
        confirmationDialogActive = false;
        
        // Remove escape key handler
        if (escapeHandler) {
            document.removeEventListener('keydown', escapeHandler);
            escapeHandler = null;
        }
        currentResolve = null;
    }
}

// Check if confirmation dialog is active
function isConfirmationDialogActive() {
    return confirmationDialogActive;
}

// Show input dialog with text input field
function showInputDialog(message, defaultValue = '', placeholder = '', options = null, event = null) {
    return new Promise((resolve) => {
        // Default options if not provided
        if (!options) {
            options = [
                { text: 'OK', value: 'ok', className: 'btn-standard primary' },
                { text: 'Cancel', value: null, className: 'btn-standard' }
            ];
        }

        // Store resolve for escape key handling
        currentResolve = resolve;

        // Create dialog if it doesn't exist
        if (!confirmationDialog) {
            confirmationDialog = document.createElement('div');
            confirmationDialog.id = 'confirmationDialog';
            confirmationDialog.className = 'modal hidden transient';
            confirmationDialog.innerHTML = `
                <div class="modal-window-title">
                    <div class="modal-window-title-main">
                        <i class="fas fa-keyboard"></i>
                        <span id="confirmationDialogTitle">Input</span>
                    </div>
                </div>
                <div class="modal-window-controls">
                    <button type="button" class="btn-danger close-btn btn-small" title="Close">
                        <i class="fa-regular fa-xmark-large"></i>
                    </button>
                </div>
                <div class="modal-content modal-padding dark">
                    <div class="confirmation-message" id="confirmationMessage"></div>
                    <div class="confirmation-controls" id="confirmationControls">
                    </div>
                </div>
            `;
            document.body.appendChild(confirmationDialog);

            // Close button handler
            const closeBtn = confirmationDialog.querySelector('.close-btn');
            closeBtn.addEventListener('click', () => {
                hideConfirmationDialog();
                if (currentResolve) {
                    currentResolve(null);
                    currentResolve = null;
                }
            });
        }

        // Update title for input dialog
        const titleEl = confirmationDialog.querySelector('#confirmationDialogTitle');
        const titleIcon = confirmationDialog.querySelector('.modal-window-title-main i');
        if (titleEl) {
            titleEl.textContent = 'Input';
        }
        if (titleIcon) {
            titleIcon.className = 'fas fa-keyboard';
        }

        // Update dialog content
        const messageEl = confirmationDialog.querySelector('#confirmationMessage');
        const controlsEl = confirmationDialog.querySelector('#confirmationControls');

        // Clear any existing input wrapper
        const existingInputWrapper = messageEl.querySelector('.confirmation-input-wrapper');
        if (existingInputWrapper) {
            existingInputWrapper.remove();
        }

        if (message !== false) {
            // Set message
            if (message.includes('<') && message.includes('>')) {
                messageEl.innerHTML = message;
            } else {
                messageEl.textContent = message;
            }
        }
        
        // Add input field
        const inputWrapper = document.createElement('div');
        inputWrapper.className = 'confirmation-input-wrapper';
        
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'form-input form-control';
        input.style.width = '100%';
        input.value = defaultValue;
        input.placeholder = placeholder;
        input.id = 'confirmationInput';
        
        inputWrapper.appendChild(input);
        messageEl.appendChild(inputWrapper);
        
        // Clear and recreate controls
        controlsEl.innerHTML = '';
        
        options.forEach((option, index) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `btn ${option.className || 'btn-secondary'}`;
            button.innerHTML = '';

            if (option.icon) {
                const iconElement = document.createElement('i');
                iconElement.className = option.icon;
                button.appendChild(iconElement);
                button.appendChild(document.createTextNode(' '));
            }

            button.appendChild(document.createTextNode(option.text));
            button.id = `confirmationBtn${index}`;
            
            button.addEventListener('click', (e) => {
                e.preventDefault();
                const inputValue = input.value.trim();
                hideConfirmationDialog();
                
                // Return input value if OK was clicked, null otherwise
                if (currentResolve) {
                    currentResolve(option.value ? inputValue : null);
                    currentResolve = null;
                }
            });
            
            controlsEl.appendChild(button);
            
            // Focus the first button (OK) by default for input dialogs
            if (index === 0) {
                setTimeout(() => button.focus(), 100);
            }
        });
        
        // Focus input field
        setTimeout(() => {
            input.focus();
            input.select();
        }, 150);
        
        // Submit on Enter key
        const handleEnter = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const inputValue = input.value.trim();
                hideConfirmationDialog();
                if (currentResolve) {
                    currentResolve(inputValue);
                    currentResolve = null;
                }
                document.removeEventListener('keydown', handleEnter);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                hideConfirmationDialog();
                if (currentResolve) {
                    currentResolve(null);
                    currentResolve = null;
                }
                document.removeEventListener('keydown', handleEnter);
            }
        };
        document.addEventListener('keydown', handleEnter);

        // Show dialog - modal system handles positioning
        openModal(confirmationDialog);
        confirmationDialogActive = true;

        // Position dialog near event if provided
        if (event) {
            positionConfirmationDialog(event);
        }
    });
}