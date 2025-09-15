/**
 * Toast Notification Management System
 *
 * This file contains all functionality related to:
 * - Toast notification display and management
 * - Toast progress tracking and updates
 * - Toast button handling and interactions
 *
 * Dependencies:
 * - app.js (for shared utilities and DOM elements)
 */

// ============================================================================
// GLOBAL VARIABLES (MOVED FROM app.js)
// ============================================================================

/**
 * Toast counter for unique ID generation
 * @type {number}
 */
let toastCounter = 0;

/**
 * Map of active toast notifications
 * @type {Map<string, object>}
 */
const activeToasts = new Map();

/**
 * Global button handler registry for toast buttons
 * @type {Map<number, object>}
 */
const buttonHandlers = new Map();

/**
 * Counter for generating unique button IDs
 * @type {number}
 */
let nextButtonId = 1;

/**
 * Map of vibe encoding progress intervals
 * @type {Map<string, number>}
 */
const vibeEncodingProgressIntervals = new Map();

// ============================================================================
// TOAST MANAGEMENT FUNCTIONS (READY FOR MANUAL IMPLEMENTATION)
// ============================================================================

/**
 * Display a glass-style toast notification
 * @param {string} type - Toast type ('success', 'error', 'warning', 'info')
 * @param {string} title - Toast title (optional)
 * @param {string} message - Toast message (optional)
 * @param {boolean} showProgress - Whether to show progress bar
 * @param {number|boolean} timeout - Auto-dismiss timeout in milliseconds, or false to disable
 * @param {string|null} customIcon - Custom icon HTML string
 * @param {Array|null} buttons - Array of button configuration objects
 * @returns {string} Unique toast ID
 *
 * @example
 * // Simple success toast
 * showGlassToast('success', 'Success!', 'Operation completed');
 *
 * @example
 * // Progress toast with buttons
 * showGlassToast('info', 'Uploading...', 'Please wait', true, false, null, [
 *   { text: 'Cancel', onClick: () => cancelUpload() }
 * ]);
 */
function showGlassToast(type, title, message, showProgress = false, timeout = 5000, customIcon = null, buttons = null) {
    const toastId = `toast-${++toastCounter}`;
    const toastContainer = document.getElementById('toastContainer') || createToastContainer();

    const toast = document.createElement('div');
    const isSimple = !title || !message;
    toast.className = `glass-toast glass-toast-${type} ${showProgress ? 'upload-progress' : ''} ${isSimple ? 'simple' : ''}`;
    toast.id = toastId;

    // Use custom icon if provided, otherwise use default icon
    const icon = customIcon || getToastIcon(type, showProgress);

    // Generate buttons HTML if provided
    const buttonsElement = buttons ? generateButtonsHtml(buttons, toastId) : null;

    // If only message is provided (no title), create a simple one-line toast
    if (title && message) {
        // Full toast with title and message
        const closeBtn = showProgress ? '' : '<button class="toast-close" onclick="removeGlassToast(\'' + toastId + '\')"><i class="nai-thin-cross"></i></button>';

        toast.innerHTML = `
            <div class="toast-icon">${icon}</div>
            <div class="toast-content">
                <div class="toast-title">${title}</div>
                <div class="toast-message">${message}</div>
                ${showProgress ? '<div class="toast-progress"><div class="toast-progress-bar"></div></div>' : ''}
            </div>
            ${closeBtn}
        `;
        
        // Add buttons as DOM elements to preserve event handlers
        if (buttonsElement) {
            const content = toast.querySelector('.toast-content');
            if (content) {
                content.appendChild(buttonsElement);
            }
        }
    } else {
        // Simple one-line toast (message only) - now with icon
        const messageText = title || message;
        const closeBtn = showProgress ? '' : '<button class="toast-close" onclick="removeGlassToast(\'' + toastId + '\')"><i class="nai-thin-cross"></i></button>';

        toast.innerHTML = `
            <div class="toast-icon">${icon}</div>
            <div class="toast-content">
                <div class="toast-message">${messageText}</div>
                ${showProgress ? '<div class="toast-progress"><div class="toast-progress-bar"></div></div>' : ''}
            </div>
            ${closeBtn}
        `;
        
        // Add buttons as DOM elements to preserve event handlers
        if (buttonsElement) {
            const content = toast.querySelector('.toast-content');
            if (content) {
                content.appendChild(buttonsElement);
            }
        }
    }

    toastContainer.prepend(toast);

    // Trigger animation
    setTimeout(() => {
        toast.classList.add('show');
    }, 10);

    // Auto-remove after timeout (unless it's a progress toast or timeout is false) 
    if (timeout !== false && !showProgress) {
        setTimeout(() => {
            removeGlassToast(toastId);
        }, timeout);
    }

    activeToasts.set(toastId, { type, title, message, showProgress, customIcon, buttons });
    return toastId;
}

/**
 * Update an existing toast notification
 * @param {string} toastId - Unique toast ID to update
 * @param {string} type - New toast type ('success', 'error', 'warning', 'info')
 * @param {string} title - New toast title
 * @param {string} message - New toast message
 * @param {string|null} customIcon - New custom icon HTML
 *
 * @example
 * const toastId = showGlassToast('info', 'Loading...', 'Please wait');
 * updateGlassToast(toastId, 'success', 'Complete!', 'Operation finished');
 */
function updateGlassToast(toastId, type, title, message, customIcon = null) {
    const toast = document.getElementById(toastId);
    if (!toast) return;

    const icon = customIcon || getToastIcon(type);
    const isSimple = !title || !message;
    const messageText = title || message;

    // Preserve existing classes and only update necessary ones
    const existingClasses = toast.className.split(' ').filter(cls => 
        cls !== 'glass-toast' && 
        !cls.startsWith('glass-toast-') && 
        cls !== 'simple' && 
        cls !== 'upload-progress'
    );
    
    // Build new class list
    const newClasses = ['glass-toast', `glass-toast-${type}`];
    if (isSimple) newClasses.push('simple');
    if (existingClasses.includes('upload-progress')) newClasses.push('upload-progress');
    if (existingClasses.includes('show')) newClasses.push('show');
    
    toast.className = newClasses.join(' ');
    
    // Update icon
    const iconElement = toast.querySelector('.toast-icon');
    if (iconElement) {
        iconElement.innerHTML = icon;
    }

    if (isSimple) {
        // Simple toast - only update message
        const messageElement = toast.querySelector('.toast-message');
        if (messageElement) {
            messageElement.textContent = messageText;
        }
    } else {
        // Full toast - update both title and message
        const titleElement = toast.querySelector('.toast-title');
        const messageElement = toast.querySelector('.toast-message');
        
        if (titleElement) {
            titleElement.textContent = title;
        }
        if (messageElement) {
            messageElement.textContent = message;
        }
    }

    // Update stored data
    const stored = activeToasts.get(toastId);
    if (stored) {
        stored.type = type;
        stored.title = title;
        stored.message = message;
        stored.customIcon = customIcon;
        activeToasts.set(toastId, stored);
    }

}

/**
 * Remove a toast notification with animation
 * @param {string} toastId - Unique toast ID to remove
 *
 * @example
 * const toastId = showGlassToast('info', 'Message', 'Content');
 * // Later...
 * removeGlassToast(toastId);
 */
function removeGlassToast(toastId) {
    const toast = document.getElementById(toastId);
    if (!toast) return;

    // Clean up button handlers for this toast
    for (const [buttonId, handler] of buttonHandlers.entries()) {
        if (handler.toastId === toastId) {
            buttonHandlers.delete(buttonId);
        }
    }

    toast.classList.add('removing');
    activeToasts.delete(toastId);

    setTimeout(() => {
        if (toast.parentNode) {
            toast.parentNode.removeChild(toast);
        }
    }, 300);
}

/**
 * Get appropriate FontAwesome icon for toast type
 * @param {string} type - Toast type ('success', 'error', 'warning', 'info')
 * @param {boolean} showProgress - Whether progress is being shown
 * @returns {string} HTML string for the icon
 *
 * @example
 * const icon = getToastIcon('success', false); // '<i class="fas fa-check-circle"></i>'
 */
function getToastIcon(type, showProgress) {
    if (showProgress && type === 'info') {
        return '<i class="fas fa-spin fa-spinner-third"></i>';
    }
    switch (type) {
        case 'success': return '<i class="fas fa-check-circle"></i>';
        case 'error': return '<i class="fas fa-times-circle"></i>';
        case 'warning': return '<i class="fas fa-exclamation-triangle"></i>';
        case 'info': return '<i class="fas fa-info-circle"></i>';
        default: return '<i class="fas fa-sparkles"></i>';
    }
}

/**
 * Create and append toast container to document body
 * @returns {HTMLElement} The toast container element
 *
 * @example
 * const container = createToastContainer();
 * // Container is now appended to document.body
 */
function createToastContainer() {
    const container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container';
    document.body.appendChild(container);
    return container;
}

/**
 * Update progress bar for a toast notification
 * @param {string} toastId - Unique toast ID
 * @param {number} progress - Progress value (0-100)
 *
 * @example
 * const toastId = showGlassToast('info', 'Uploading...', '', true);
 * updateGlassToastProgress(toastId, 50); // 50% complete
 */
function updateGlassToastProgress(toastId, progress) {
    const toast = document.getElementById(toastId);
    if (!toast) return;

    const progressBar = toast.querySelector('.toast-progress-bar');
    if (progressBar) {
        progressBar.style.width = `${Math.min(progress, 100)}%`;
    }
}

/**
 * Generate HTML element for toast buttons
 * @param {Array} buttons - Array of button configuration objects
 * @param {string} toastId - Unique toast ID
 * @returns {HTMLElement|null} Buttons container element or null
 *
 * @example
 * const buttons = [
 *   { text: 'OK', onClick: () => console.log('OK clicked') },
 *   { text: 'Cancel', onClick: () => console.log('Cancel clicked'), closeOnClick: false }
 * ];
 * const buttonsElement = generateButtonsHtml(buttons, 'toast-123');
 */
function generateButtonsHtml(buttons, toastId) {
    if (!buttons || !Array.isArray(buttons)) return '';

    const buttonsContainer = document.createElement('div');
    buttonsContainer.className = 'toast-buttons';

    buttons.forEach((button, index) => {
        const btn = document.createElement('button');
        btn.className = `toast-button btn-${button.type || 'secondary'}`;
        btn.textContent = button.text;
        btn.type = 'button'; // Prevent form submission

        if (button.onClick) {
            // Generate unique button ID
            const buttonId = nextButtonId++;

            // Store the button handler
            buttonHandlers.set(buttonId, {
                onClick: button.onClick,
                toastId: toastId,
                closeOnClick: button.closeOnClick
            });

            // Set onclick attribute to call global handler
            btn.setAttribute('onclick', `handleToastButtonClick(${buttonId})`);

            // Add data attributes for debugging
            btn.setAttribute('data-button-id', buttonId);
            btn.setAttribute('data-button-index', index);
            btn.setAttribute('data-toast-id', toastId);
        }

        buttonsContainer.appendChild(btn);
    });

    return buttonsContainer;
}

/**
 * Update buttons for an existing toast notification
 * @param {string} toastId - Unique toast ID
 * @param {Array|null} buttons - New button configuration array
 *
 * @example
 * const toastId = showGlassToast('info', 'Confirm', 'Are you sure?');
 * updateGlassToastButtons(toastId, [
 *   { text: 'Yes', onClick: () => proceed() },
 *   { text: 'No', onClick: () => cancel() }
 * ]);
 */
function updateGlassToastButtons(toastId, buttons) {
    const toast = document.getElementById(toastId);
    if (!toast) return;

    // Remove existing buttons
    const existingButtons = toast.querySelector('.toast-buttons');
    if (existingButtons) {
        existingButtons.remove();
    }

    // Add new buttons
    if (buttons && Array.isArray(buttons)) {
        const buttonsElement = generateButtonsHtml(buttons, toastId);
        const content = toast.querySelector('.toast-content');
        if (content && buttonsElement) {
            content.appendChild(buttonsElement);
        }
    }

    // Update stored data
    const stored = activeToasts.get(toastId);
    if (stored) {
        stored.buttons = buttons;
        activeToasts.set(toastId, stored);
    }
}

/**
 * Complete a toast notification with final state
 * @param {string} toastId - Unique toast ID
 * @param {object} options - Completion options
 * @param {string} options.type - Final toast type
 * @param {string} options.title - Final toast title
 * @param {string} options.message - Final toast message
 * @param {string} options.customIcon - Final custom icon
 * @param {Array} options.buttons - Final buttons array
 * @param {boolean} options.showProgress - Whether to show progress
 * @param {number|boolean} options.timeout - Final timeout setting
 *
 * @example
 * const toastId = showGlassToast('info', 'Processing...', '', true);
 * updateGlassToastComplete(toastId, {
 *   type: 'success',
 *   title: 'Complete!',
 *   message: 'Operation finished successfully',
 *   showProgress: false
 * });
 */
function updateGlassToastComplete(toastId, options = {}) {
    const toast = document.getElementById(toastId);
    if (!toast) return;

    const {
        type,
        title,
        message,
        customIcon,
        buttons,
        showProgress = null,
        timeout = null
    } = options;

    // Update basic content if provided
    if (type || title || message || customIcon) {
        updateGlassToast(toastId, type, title, message, customIcon);
    }

    // Update buttons if provided
    if (buttons !== undefined) {
        updateGlassToastButtons(toastId, buttons);
    }

    // Update progress state if provided
    if (showProgress !== null) {
        const progressElement = toast.querySelector('.toast-progress');
        if (showProgress && !progressElement) {
            // Add progress bar
            const content = toast.querySelector('.toast-content');
            if (content) {
                content.insertAdjacentHTML('beforeend', '<div class="toast-progress"><div class="toast-progress-bar"></div></div>');
            }
            toast.classList.add('upload-progress');
        } else if (!showProgress && progressElement) {
            // Remove progress bar
            progressElement.remove();
            toast.classList.remove('upload-progress');
            
            // When removing progress, add close button and set default timeout
            const existingCloseBtn = toast.querySelector('.toast-close');
            if (!existingCloseBtn) {
                const closeBtn = '<button class="toast-close" onclick="removeGlassToast(\'' + toastId + '\')"><i class="nai-thin-cross"></i></button>';
                toast.insertAdjacentHTML('beforeend', closeBtn);
            }
            
            // Set default timeout for completed progress toasts
            const stored = activeToasts.get(toastId);
            if (stored) {
                if (stored.timeoutId) {
                    clearTimeout(stored.timeoutId);
                }
                stored.timeoutId = setTimeout(() => {
                    removeGlassToast(toastId);
                }, 5000); // 5 second default timeout
                activeToasts.set(toastId, stored);
            }
        }
    }

    // Update timeout if provided
    if (timeout !== null) {
        const stored = activeToasts.get(toastId);
        if (stored) {
            stored.timeout = timeout;
            activeToasts.set(toastId, stored);
            
            // Clear existing timeout and set new one
            if (stored.timeoutId) {
                clearTimeout(stored.timeoutId);
            }
            
            if (timeout !== false) {
                stored.timeoutId = setTimeout(() => {
                    removeGlassToast(toastId);
                }, timeout);
                activeToasts.set(toastId, stored);
            }
        }
    }

    // Ensure toast is visible
    if (!toast.classList.contains('show')) {
        toast.classList.add('show');
    }
}

/**
 * Start automatic progress animation for vibe encoding
 * @param {string} toastId - Unique toast ID
 * @returns {number} Interval ID for the progress animation
 *
 * @example
 * const toastId = showGlassToast('info', 'Encoding Vibe...', '', true);
 * startVibeEncodingProgress(toastId);
 */
function startVibeEncodingProgress(toastId) {
    let progress = 0;
    const interval = setInterval(() => {
        progress += 5; // Add 5% every 500ms
        updateGlassToastProgress(toastId, progress);

        if (progress >= 100) {
            clearInterval(interval);
            vibeEncodingProgressIntervals.delete(toastId);
        }
    }, 250); // Every 500ms

    vibeEncodingProgressIntervals.set(toastId, interval);
    return interval;
}

/**
 * Complete vibe encoding progress with success state
 * @param {string} toastId - Unique toast ID
 * @param {string} successMessage - Success message to display
 *
 * @example
 * completeVibeEncodingProgress(toastId, 'Vibe encoded successfully!');
 */
function completeVibeEncodingProgress(toastId, successMessage = 'Vibe encoding completed!') {
    const interval = vibeEncodingProgressIntervals.get(toastId);
    if (interval) {
        clearInterval(interval);
        vibeEncodingProgressIntervals.delete(toastId);
    }

    // Set progress to 100%
    updateGlassToastProgress(toastId, 100);

    // Update the toast to show completion
    setTimeout(() => {
        updateGlassToastComplete(toastId, {
            type: 'success',
            title: 'Vibe Created',
            message: successMessage,
            customIcon: '<i class="nai-check"></i>',
            showProgress: false
        });
    }, 200); // Small delay to show 100% completion
}

/**
 * Fail vibe encoding progress with error state
 * @param {string} toastId - Unique toast ID
 * @param {string} errorMessage - Error message to display
 *
 * @example
 * failVibeEncodingProgress(toastId, 'Network error occurred');
 */
function failVibeEncodingProgress(toastId, errorMessage = 'Vibe encoding failed') {
    const interval = vibeEncodingProgressIntervals.get(toastId);
    if (interval) {
        clearInterval(interval);
        vibeEncodingProgressIntervals.delete(toastId);
    }

    // Update the toast to show error
        updateGlassToastComplete(toastId, {
        type: 'error',
        title: 'Encoding Failed',
        message: errorMessage,
        customIcon: '<i class="nai-cross"></i>',
        showProgress: false
    });
}

/**
 * Handle toast button click events
 * @param {number} buttonId - The unique button ID
 */
function handleToastButtonClick(buttonId) {
    const handler = buttonHandlers.get(buttonId);
    if (handler) {
        try {
            handler.onClick(handler.toastId);
            if (handler.closeOnClick !== false) {
                removeGlassToast(handler.toastId);
            }
            // Clean up the handler after use
            buttonHandlers.delete(buttonId);
        } catch (error) {
            console.error('Error in button click handler:', error);
        }
    } else {
        console.error('Button handler not found for ID:', buttonId);
    }
}

/**
 * Complete test progress toast (placeholder - not found in app.js)
 * @param {string} toastId - Toast ID
 */
function completeTestProgress(toastId) {
    // This function was referenced in the original plan but not found in app.js
    // Implement as needed for test progress completion
    console.log('completeTestProgress: Function not found in app.js - implement as needed');
    updateGlassToastComplete(toastId, {
        type: 'success',
        title: 'Test Completed',
        message: 'Test progress has been completed successfully.',
        showProgress: false
    });
}

/**
 * Complete all test progress toasts (placeholder - not found in app.js)
 * @param {string} toastId - Toast ID
 */
function completeAllTestProgress() {
    // This function was referenced in the original plan but not found in app.js
    // Implement as needed for completing all test progress
    console.log('completeAllTestProgress: Function not found in app.js - implement as needed');

    // Close all active toasts with 'test' in the ID or message
    activeToasts.forEach((toastData, toastId) => {
        if (toastId.includes('test') || toastData.message?.toLowerCase().includes('test')) {
            removeGlassToast(toastId);
        }
    });
}

/**
 * Debug utility to inspect button handlers (placeholder - not found in app.js)
 */
function inspectButtonHandlers() {
    // This function was referenced in the original plan but not found in app.js
    // Implement as needed for debugging button handlers
    console.log('inspectButtonHandlers: Function not found in app.js - implement as needed');
    console.log('Current button handlers:', buttonHandlers.size);
    buttonHandlers.forEach((handler, buttonId) => {
        console.log(`Button ${buttonId}:`, handler);
    });
}