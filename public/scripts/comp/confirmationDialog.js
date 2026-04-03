// Confirmation Dialog System
// Uses the modal design pattern with title bar and standard positioning

let confirmationDialog = null;
let confirmationDialogActive = false;
let confirmationDialogCallback = null;
let confirmationDialogCancelCallback = null;
let currentResolve = null;
let escapeHandler = null;

// Create and show confirmation dialog with multiple options
function showConfirmationDialog(message, options = [], event = null, config = {}) {
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
            confirmationDialog.className = 'modal hidden transient tool-window on-top';
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

        // Update title and icon from config
        const titleEl = confirmationDialog.querySelector('#confirmationDialogTitle');
        const titleIcon = confirmationDialog.querySelector('.modal-window-title-main i');
        if (titleEl) {
            titleEl.textContent = config.title || 'Confirm';
        }
        if (titleIcon) {
            titleIcon.className = config.icon || 'fas fa-question-circle';
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

        // Check if there are any options to display
        const hasOptions = options && options.length > 0;

        // Check if there's a cancel button (typically the last button or one with value=null/false)
        const hasCancelButton = hasOptions && options.some(option => option.value === null || option.value === false);

        // Determine if we should show the close button
        const showCloseButton = config.showCloseButton !== undefined ? config.showCloseButton : !hasCancelButton;

        // Update close button visibility
        const closeBtnElement = confirmationDialog.querySelector('.close-btn');
        if (closeBtnElement) {
            if (showCloseButton) {
                closeBtnElement.style.display = '';
            } else {
                closeBtnElement.style.display = 'none';
            }
        }

        // Clear and recreate controls (only if there are options)
        controlsEl.style.display = hasOptions ? '' : 'none';
        controlsEl.innerHTML = '';
        if (hasOptions) {

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
        }

        // Set up close button handler dynamically based on current options
        if (closeBtnElement) {
            // Remove existing listeners to avoid duplicates
            const newCloseBtnElement = closeBtnElement.cloneNode(true);
            closeBtnElement.parentNode.replaceChild(newCloseBtnElement, closeBtnElement);

            newCloseBtnElement.addEventListener('click', () => {
                hideConfirmationDialog();
                if (currentResolve) {
                    // Find the cancel button value (last button, or button with null/false value)
                    let cancelValue = null;
                    if (options && options.length > 0) {
                        // Look for a button with null or false value
                        const cancelButton = options.find(option => option.value === null || option.value === false);
                        if (cancelButton) {
                            cancelValue = cancelButton.value;
                        } else {
                            // If no explicit cancel button, use the last button's value
                            cancelValue = options[options.length - 1].value;
                        }
                    }
                    currentResolve(cancelValue);
                    currentResolve = null;
                }
            });
        }

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

        // Apply custom width from config
        if (config.width) {
            confirmationDialog.style.width = `${config.width}px`;
        } else {
            confirmationDialog.style.width = '';
        }
        if (config.height) {
            confirmationDialog.style.height = `${config.height}px`;
        } else {
            confirmationDialog.style.height = '';
        }

        // Show dialog - modal system handles positioning
        openModal(confirmationDialog);

        // Make it the active tool window (always on top)
        if (typeof setActiveWindow === 'function') {
            setActiveWindow(confirmationDialog);
        } else {
            confirmationDialog.classList.add('active-window');
        }

        confirmationDialogActive = true;

        // Position dialog near event if provided, or use custom positioning
        if (event) {
            positionConfirmationDialog(event);
        } else if (config.position === 'bottom-right') {
            positionConfirmationDialogBottomRight(config);
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
        confirmationDialog.style.removeProperty('--modal-offset-x');
        confirmationDialog.style.removeProperty('--modal-offset-y');
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

        // Calculate desired center position (centered on cursor/button)
        const desiredCenterX = x;
        const desiredCenterY = y;

        // Get CSS variables that affect positioning
        // --true-inset-top is a calc() expression, so we need to get the computed pixel value
        const tempEl = document.createElement('div');
        tempEl.style.position = 'absolute';
        tempEl.style.top = 'var(--true-inset-top, 0px)';
        tempEl.style.visibility = 'hidden';
        tempEl.style.pointerEvents = 'none';
        document.body.appendChild(tempEl);
        const trueInsetTop = tempEl.offsetTop || 0;
        document.body.removeChild(tempEl);

        const containerWidth = window.innerWidth;
        const containerHeight = window.innerHeight;

        // Calculate required offsets using standard modal positioning formula
        // CSS formula: centerX = window.innerWidth/2 + offsetX
        //              centerY = window.innerHeight/2 + 0.5*trueInsetTop + offsetY - (desktopMode ? 17.5 : 0)
        let offsetX = desiredCenterX - containerWidth / 2;
        let offsetY = desiredCenterY - containerHeight / 2 - (0.5 * trueInsetTop) + (window.isDesktop ? 17.5 : 0);

        // Get safe area inset values for bounds checking
        const safeAreaLeft = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--inset-left')) || 0;
        const safeAreaRight = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--inset-right')) || 0;
        const safeAreaBottom = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--inset-bottom')) || 0;

        // Calculate actual center position using the CSS formula
        const actualCenterX = containerWidth / 2 + offsetX;
        const actualCenterY = containerHeight / 2 + (0.5 * trueInsetTop) + offsetY - (window.isDesktop ? 17.5 : 0);

        // Calculate window edges from center
        const leftEdge = actualCenterX - dialogWidth / 2;
        const rightEdge = actualCenterX + dialogWidth / 2;
        const topEdge = actualCenterY - dialogHeight / 2;
        const bottomEdge = actualCenterY + dialogHeight / 2;

        // Ensure dialog stays within viewport bounds, accounting for safe areas
        const margin = 20;
        let constrainedX = offsetX;
        let constrainedY = offsetY;

        // Check horizontal bounds
        if (leftEdge < margin + safeAreaLeft) {
            const desiredLeftEdge = margin + safeAreaLeft;
            const desiredCenterX = desiredLeftEdge + dialogWidth / 2;
            constrainedX = desiredCenterX - containerWidth / 2;
        } else if (rightEdge > containerWidth - margin - safeAreaRight) {
            const desiredRightEdge = containerWidth - margin - safeAreaRight;
            const desiredCenterX = desiredRightEdge - dialogWidth / 2;
            constrainedX = desiredCenterX - containerWidth / 2;
        }

        // Recalculate centerY with potentially constrained offsetX
        const recalculatedCenterY = containerHeight / 2 + (0.5 * trueInsetTop) + constrainedY - (window.isDesktop ? 17.5 : 0);
        const recalculatedTopEdge = recalculatedCenterY - dialogHeight / 2;
        const recalculatedBottomEdge = recalculatedCenterY + dialogHeight / 2;

        // Check vertical bounds
        if (recalculatedTopEdge < margin + trueInsetTop) {
            const desiredTopEdge = margin + trueInsetTop;
            const desiredCenterY = desiredTopEdge + dialogHeight / 2;
            constrainedY = desiredCenterY - containerHeight / 2 - (0.5 * trueInsetTop) + (window.isDesktop ? 17.5 : 0);
        } else if (recalculatedBottomEdge > containerHeight - margin - safeAreaBottom) {
            const desiredBottomEdge = containerHeight - margin - safeAreaBottom;
            const desiredCenterY = desiredBottomEdge - dialogHeight / 2;
            constrainedY = desiredCenterY - containerHeight / 2 - (0.5 * trueInsetTop) + (window.isDesktop ? 17.5 : 0);
        }

        // Apply position using standard CSS variables (rounded to whole numbers)
        confirmationDialog.style.setProperty('--modal-offset-x', `${Math.round(constrainedX)}px`);
        confirmationDialog.style.setProperty('--modal-offset-y', `${Math.round(constrainedY)}px`);
    });
}

// Position the dialog at bottom right with padding
function positionConfirmationDialogBottomRight(config = {}) {
    if (!confirmationDialog) return;

    // Force dialog to be visible so we can measure it
    confirmationDialog.style.display = 'block';
    confirmationDialog.style.visibility = 'hidden';

    const dialogRect = confirmationDialog.getBoundingClientRect();
    const dialogWidth = dialogRect.width;
    const dialogHeight = dialogRect.height;

    // Get safe area insets (for devices with notches, etc.)
    const safeAreaInsetBottom = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--inset-bottom')) || 0;
    const safeAreaInsetRight = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--inset-right')) || 0;

    // Calculate padding from config or defaults
    const leftPadding = config.leftPadding || 20;
    const bottomPadding = config.bottomPadding || 20;

    // Position at bottom right with padding, accounting for safe areas
    const rightEdge = window.innerWidth - safeAreaInsetRight - leftPadding;
    const bottomEdge = window.innerHeight - safeAreaInsetBottom - bottomPadding;

    // Calculate offset from center (CSS uses center-based positioning)
    const offsetX = rightEdge - dialogWidth / 2 - window.innerWidth / 2;
    const offsetY = bottomEdge - dialogHeight / 2 - window.innerHeight / 2;

    // Apply positioning
    confirmationDialog.style.setProperty('--modal-offset-x', `${Math.round(offsetX)}px`);
    confirmationDialog.style.setProperty('--modal-offset-y', `${Math.round(offsetY)}px`);

    // Restore visibility
    confirmationDialog.style.display = '';
    confirmationDialog.style.visibility = '';
}

// Hide confirmation dialog
async function hideConfirmationDialog() {
    if (confirmationDialog) {
        await closeModal(confirmationDialog);
        confirmationDialogActive = false;

        // Reset custom width
        confirmationDialog.style.width = '';
        confirmationDialog.style.height = '';

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
function showInputDialog(message, defaultValue = '', placeholder = '', options = null, event = null, config = {}) {
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
            confirmationDialog.className = 'modal hidden transient tool-window on-top';
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
        }

        // Update title and icon from config for input dialog
        const titleEl = confirmationDialog.querySelector('#confirmationDialogTitle');
        const titleIcon = confirmationDialog.querySelector('.modal-window-title-main i');
        if (titleEl) {
            titleEl.textContent = config.title || 'Input';
        }
        if (titleIcon) {
            titleIcon.className = config.icon || 'fas fa-keyboard';
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
        
        // Check if there are any options to display
        const hasOptions = options && options.length > 0;

        // Check if there's a cancel button (typically the last button or one with value=null/false)
        const hasCancelButton = hasOptions && options.some(option => option.value === null || option.value === false);

        // Determine if we should show the close button
        const showCloseButton = config.showCloseButton !== undefined ? config.showCloseButton : !hasCancelButton;

        // Update close button visibility
        const inputCloseBtnElement = confirmationDialog.querySelector('.close-btn');
        if (inputCloseBtnElement) {
            if (showCloseButton) {
                inputCloseBtnElement.style.display = '';
            } else {
                inputCloseBtnElement.style.display = 'none';
            }
        }

        // Clear and recreate controls (only if there are options)
        controlsEl.style.display = hasOptions ? '' : 'none';
        controlsEl.innerHTML = '';
        if (hasOptions) {

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
        }

        // Set up close button handler dynamically based on current options
        if (inputCloseBtnElement) {
            // Remove existing listeners to avoid duplicates
            const newInputCloseBtnElement = inputCloseBtnElement.cloneNode(true);
            inputCloseBtnElement.parentNode.replaceChild(newInputCloseBtnElement, inputCloseBtnElement);

            newInputCloseBtnElement.addEventListener('click', () => {
                hideConfirmationDialog();
                if (currentResolve) {
                    // Find the cancel button value (last button, or button with null/false value)
                    let cancelValue = null;
                    if (options && options.length > 0) {
                        // Look for a button with null or false value
                        const cancelButton = options.find(option => option.value === null || option.value === false);
                        if (cancelButton) {
                            cancelValue = cancelButton.value;
                        } else {
                            // If no explicit cancel button, use the last button's value
                            cancelValue = options[options.length - 1].value;
                        }
                    }
                    currentResolve(cancelValue);
                    currentResolve = null;
                }
            });
        }
        
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

        // Apply custom width from config
        if (config.width) {
            confirmationDialog.style.width = `${config.width}px`;
        } else {
            confirmationDialog.style.width = '';
        }
        if (config.height) {
            confirmationDialog.style.height = `${config.height}px`;
        } else {
            confirmationDialog.style.height = '';
        }

        // Show dialog - modal system handles positioning
        openModal(confirmationDialog);

        // Make it the active tool window (always on top)
        if (typeof setActiveWindow === 'function') {
            setActiveWindow(confirmationDialog);
        } else {
            confirmationDialog.classList.add('active-window');
        }

        confirmationDialogActive = true;

        // Position dialog near event if provided, or use custom positioning
        if (event) {
            positionConfirmationDialog(event);
        } else if (config.position === 'bottom-right') {
            positionConfirmationDialogBottomRight(config);
        }
    });
}