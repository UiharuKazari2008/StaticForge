// Confirmation Dialog System
// Uses the modal design pattern with title bar and standard positioning

let confirmationDialog = null;
let confirmationDialogActive = false;
let confirmationDialogCallback = null;
let confirmationDialogCancelCallback = null;
let currentResolve = null;
/** Options array for the open dialog (Escape resolves like Cancel). */
let confirmationDialogKeydownOptionsRef = null;
/** When set, dialog is input mode (Escape → null). */
let confirmationDialogKeydownInputRef = null;
let confirmationDialogKeydownScopeWired = false;
/** Invoked once per open with modal listener signal (injected dialog wiring). */
let confirmationDialogInjectReadyFn = null;

/** Padding from viewport edges when clamping event-placed dialogs (modalUtils.js). */
const CONFIRMATION_DIALOG_EDGE_PADDING = 20;

function getConfirmationCancelResolveValue(options) {
    if (!options || !options.length) return null;
    const cancelButton = options.find(option => option.value === null || option.value === false);
    if (cancelButton) return cancelButton.value;
    return options[options.length - 1].value;
}

/** Index of the default (Enter) action; used for data-dialog-primary and focus. */
function getConfirmationPrimaryButtonIndex(options) {
    if (!options || !options.length) return -1;
    let i = options.findIndex(o => o.primary === true);
    if (i !== -1) return i;
    i = options.findIndex(o => /\bprimary\b/.test(o.className || ''));
    if (i !== -1) return i;
    i = options.findIndex(o => o.value !== null && o.value !== false);
    if (i !== -1) return i;
    return 0;
}

function getConfirmationDialogActionButtonCount() {
    if (!confirmationDialogActive || !confirmationDialog) return 0;
    const buttons = confirmationDialog.querySelectorAll('#confirmationControls button:not(:disabled)');
    return buttons ? buttons.length : 0;
}

function confirmationOverlayDigitsValid() {
    return getConfirmationDialogActionButtonCount() >= 2;
}

function confirmationOverlayEnterValid() {
    if (!confirmationDialogActive || !confirmationDialog) return false;
    const primaryBtn = confirmationDialog.querySelector('#confirmationControls [data-dialog-primary="1"]')
        || confirmationDialog.querySelector('#confirmationControls .btn.btn-primary:not(:disabled)')
        || confirmationDialog.querySelector('#confirmationControls .btn.btn-danger:not(:disabled)')
        || confirmationDialog.querySelector('#confirmationControls .btn.primary:not(:disabled)');
    return !!primaryBtn;
}

function handleConfirmationDialogKeydown(e) {
    if (!confirmationDialogActive || !confirmationDialog || confirmationDialog.classList.contains('hidden')) return;

    if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        const res = currentResolve;
        const opts = confirmationDialogKeydownOptionsRef;
        const inputRef = confirmationDialogKeydownInputRef;
        hideConfirmationDialog();
        if (res) {
            res(inputRef != null ? null : getConfirmationCancelResolveValue(opts));
        }
        return;
    }

    if (/^[1-9]$/.test(e.key)) {
        if (confirmationDialogKeydownInputRef && document.activeElement === confirmationDialogKeydownInputRef) return;
        const controlsFooter = confirmationDialog.querySelector('#confirmationControls');
        const buttons = controlsFooter ? controlsFooter.querySelectorAll('button:not(:disabled)') : [];
        if (!buttons.length) return;
        const digit = parseInt(e.key, 10);
        const idxFromRight = digit - 1;
        const btnIndex = buttons.length - 1 - idxFromRight;
        if (btnIndex >= 0 && btnIndex < buttons.length) {
            e.preventDefault();
            e.stopPropagation();
            buttons[btnIndex].click();
        }
        return;
    }

    if (e.key === 'Enter') {
        if (e.target.tagName === 'TEXTAREA') return;
        if (e.target.tagName === 'SELECT') return;
        if (e.target.isContentEditable) return;
        const controlsFooter = confirmationDialog.querySelector('#confirmationControls');
        if (controlsFooter && e.target.closest('#confirmationControls') === controlsFooter && e.target.tagName === 'BUTTON') {
            return;
        }
        const primaryBtn = confirmationDialog.querySelector('#confirmationControls [data-dialog-primary="1"]')
            || confirmationDialog.querySelector('#confirmationControls .btn.btn-primary:not(:disabled)')
            || confirmationDialog.querySelector('#confirmationControls .btn.btn-danger:not(:disabled)')
            || confirmationDialog.querySelector('#confirmationControls .btn.primary:not(:disabled)');
        if (!primaryBtn) return;
        e.preventDefault();
        e.stopPropagation();
        primaryBtn.click();
    }
}

function wireConfirmationDialogKeydownScope() {
    if (!confirmationDialog || confirmationDialogKeydownScopeWired) return;
    // registerKeyboardListener: public/scripts/comp/modalKeyboardRegistry.js
    registerKeyboardListener({
        id: 'confirmationDialog.keydown',
        handler: handleConfirmationDialogKeydown,
        type: 'whenOpen',
        modalId: 'confirmationDialog',
        priority: 85,
        critical: true,
        showInOverlay: false
    });
    registerKeyboardListener({
        id: 'overlay.confirmation.escape',
        type: 'whenOpen',
        modalId: 'confirmationDialog',
        label: 'Cancel',
        keys: 'Esc',
        overlayIcon: 'fas fa-times',
        overlayGroup: 'Dialog',
        overlayOnly: true,
        priority: -10
    });
    registerKeyboardListener({
        id: 'overlay.confirmation.enter',
        type: 'whenOpen',
        modalId: 'confirmationDialog',
        label: 'Confirm',
        keys: 'Enter',
        overlayIcon: 'fas fa-check',
        overlayGroup: 'Dialog',
        overlayOnly: true,
        priority: -10,
        overlayValid: confirmationOverlayEnterValid
    });
    registerKeyboardListener({
        id: 'overlay.confirmation.digits',
        type: 'whenOpen',
        modalId: 'confirmationDialog',
        label: 'Choose option',
        keys: '1–9',
        overlayIcon: 'fas fa-list-ol',
        overlayGroup: 'Dialog',
        overlayOnly: true,
        priority: -10,
        overlayValid: confirmationOverlayDigitsValid
    });
    attachModalListeners(confirmationDialog, (signal) => {
        if (typeof confirmationDialogInjectReadyFn === 'function') {
            try {
                confirmationDialogInjectReadyFn(signal);
            } catch (err) {
                console.error('[confirmationDialog] onDialogReady failed', err);
            }
            confirmationDialogInjectReadyFn = null;
        }
    });
    confirmationDialogKeydownScopeWired = true;
}

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
            wireConfirmationDialogKeydownScope();

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
            const primaryIndex = Math.max(0, getConfirmationPrimaryButtonIndex(options));

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

                if (index === primaryIndex) {
                    button.setAttribute('data-dialog-primary', '1');
                }

                button.addEventListener('click', (e) => {
                    e.preventDefault();
                    const res = currentResolve;
                    const resolved = typeof config.resolveValue === 'function'
                        ? config.resolveValue(option.value, confirmationDialog)
                        : option.value;
                    hideConfirmationDialog();
                    if (res) {
                        res(resolved);
                    }
                });

                controlsEl.appendChild(button);

                if (index === primaryIndex) {
                    setTimeout(() => button.focus(), 50);
                }
            });
        }

        // Set up close button handler dynamically based on current options
        if (closeBtnElement) {
            // Remove existing listeners to avoid duplicates
            const newCloseBtnElement = closeBtnElement.cloneNode(true);
            closeBtnElement.parentNode.replaceChild(newCloseBtnElement, closeBtnElement);

            newCloseBtnElement.addEventListener('click', () => {
                const res = currentResolve;
                const cancelValue = getConfirmationCancelResolveValue(options);
                hideConfirmationDialog();
                if (res) {
                    res(cancelValue);
                }
            });
        }

        confirmationDialogKeydownOptionsRef = options;
        confirmationDialogKeydownInputRef = null;
        confirmationDialogInjectReadyFn = typeof config.onDialogReady === 'function' ? config.onDialogReady : null;
        wireConfirmationDialogKeydownScope();

        // Event-placed dialogs: position manually after open, never restore/clamp automatically
        const usesManualPlacement = config.manualPosition || !!event || config.position === 'bottom-right';
        if (usesManualPlacement) {
            confirmationDialog.dataset.windowPositionMode = 'manual-only';
        } else {
            confirmationDialog.removeAttribute('data-window-position-mode');
        }

        // clearModalPixelAnchor — modalUtils.js
        clearModalPixelAnchor(confirmationDialog);

        // Apply custom width from config
        if (config.width) {
            const widthVal = String(config.width);
            confirmationDialog.style.width = widthVal.includes('px') ? widthVal : `${widthVal}px`;
        } else {
            confirmationDialog.style.width = '';
        }
        if (config.height) {
            const heightVal = String(config.height);
            confirmationDialog.style.height = heightVal.includes('px') ? heightVal : `${heightVal}px`;
        } else {
            confirmationDialog.style.height = '';
        }

        if (usesManualPlacement) {
            layoutConfirmationDialogPlacement(event, config, { usesManualPlacement: true });
        } else {
            confirmationDialog.removeAttribute('data-confirmation-preplaced');
        }

        openModal(confirmationDialog);

        if (typeof setActiveWindow === 'function') {
            setActiveWindow(confirmationDialog);
        } else {
            confirmationDialog.classList.add('active-window');
        }

        confirmationDialogActive = true;
    });
}

function getConfirmationDialogEventPoint(event) {
    if (!event) {
        return null;
    }
    if (event.clientX !== undefined && event.clientY !== undefined) {
        return { x: event.clientX, y: event.clientY };
    }
    if (event.target && event.target.getBoundingClientRect) {
        const rect = event.target.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }
    return null;
}

function measureConfirmationDialogSize() {
    if (!confirmationDialog) {
        return { width: 400, height: 150 };
    }
    void confirmationDialog.offsetHeight;
    const rect = confirmationDialog.getBoundingClientRect();
    return {
        width: rect.width || 400,
        height: rect.height || 150
    };
}

// clampModalViewportRect, setModalOffsetsFromViewportTopLeft — modalUtils.js
function clampConfirmationDialogWithinViewportSync() {
    if (!confirmationDialog) {
        return;
    }

    const rect = confirmationDialog.getBoundingClientRect();
    if (!rect.width || !rect.height) {
        return;
    }

    const clamped = clampModalViewportRect(
        rect.left,
        rect.top,
        rect.width,
        rect.height,
        CONFIRMATION_DIALOG_EDGE_PADDING
    );

    if (Math.abs(clamped.left - rect.left) > 0.5 || Math.abs(clamped.top - rect.top) > 0.5) {
        clearModalPixelAnchor(confirmationDialog);
        setModalOffsetsFromViewportTopLeft(confirmationDialog, clamped.left, clamped.top);
    }
}

function applyConfirmationDialogOffsets(offsetX, offsetY, dialogWidth, dialogHeight, settle) {
    const clamped = clampModalOffsetsForRect(offsetX, offsetY, dialogWidth, dialogHeight, {
        edgeMargin: CONFIRMATION_DIALOG_EDGE_PADDING
    });
    setModalOffsetPx(confirmationDialog, clamped.offsetX, clamped.offsetY, { snap: true, settle: !!settle });
    clampConfirmationDialogWithinViewportSync();
}

// beginModalLayoutMeasure, endModalLayoutMeasure — modalUtils.js
function layoutConfirmationDialogPlacement(event, config, options) {
    if (!confirmationDialog) {
        return false;
    }

    clearModalPixelAnchor(confirmationDialog);

    const isMobile = window.innerWidth < 768;
    if (isMobile) {
        confirmationDialog.style.removeProperty('--modal-offset-x');
        confirmationDialog.style.removeProperty('--modal-offset-y');
        confirmationDialog.removeAttribute('data-confirmation-preplaced');
        return false;
    }

    const useBottomRight = !event && (
        config.position === 'bottom-right' ||
        (options.usesManualPlacement && config.position !== 'center')
    );
    const point = getConfirmationDialogEventPoint(event);
    if (!point && !useBottomRight) {
        confirmationDialog.removeAttribute('data-confirmation-preplaced');
        return false;
    }

    const isHidden = confirmationDialog.classList.contains('hidden')
        || confirmationDialog.classList.contains('hidden-alt');
    const measureState = isHidden ? beginModalLayoutMeasure(confirmationDialog) : null;

    try {
        const { width: dialogWidth, height: dialogHeight } = measureConfirmationDialogSize();
        const containerWidth = window.innerWidth;
        const trueInsetTop = getModalTrueInsetTop();
        let offsetX;
        let offsetY;

        if (point) {
            offsetX = point.x - containerWidth / 2;
            offsetY = point.y - window.innerHeight / 2 - (0.5 * trueInsetTop) + getDesktopModalTopBias();
        } else {
            const safeAreaInsetBottom = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--inset-bottom')) || 0;
            const safeAreaInsetRight = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--inset-right')) || 0;
            const sidePadding = config.leftPadding || 20;
            const bottomPadding = config.bottomPadding || 20;
            const rightEdge = window.innerWidth - safeAreaInsetRight - sidePadding;
            const bottomEdge = window.innerHeight - safeAreaInsetBottom - bottomPadding;
            offsetX = rightEdge - dialogWidth / 2 - containerWidth / 2;
            offsetY = bottomEdge - dialogHeight / 2 - window.innerHeight / 2 - (0.5 * trueInsetTop) + getDesktopModalTopBias();
        }

        const settle = !isHidden
            && !confirmationDialog.classList.contains('opening')
            && !confirmationDialog.classList.contains('closing');
        applyConfirmationDialogOffsets(offsetX, offsetY, dialogWidth, dialogHeight, settle);
        confirmationDialog.dataset.confirmationPreplaced = '1';
        return true;
    } finally {
        if (measureState) {
            endModalLayoutMeasure(confirmationDialog, measureState);
        }
    }
}

// Position the dialog near the mouse cursor or button (dialog may already be open)
function positionConfirmationDialog(event) {
    layoutConfirmationDialogPlacement(event, {}, { usesManualPlacement: true });
}

// Position the dialog at bottom right with padding
function positionConfirmationDialogBottomRight(config = {}) {
    layoutConfirmationDialogPlacement(null, config || {}, { usesManualPlacement: true });
}

// Hide confirmation dialog
async function hideConfirmationDialog() {
    if (confirmationDialog) {
        // revertModalToOffsetAnchor — modalUtils.js (sync offsets before .closing drops pixel-settled CSS)
        revertModalToOffsetAnchor(confirmationDialog);
        await closeModal(confirmationDialog);
        confirmationDialogActive = false;

        // Reset custom width and ephemeral position (never restore progress dialog placement)
        confirmationDialog.style.width = '';
        confirmationDialog.style.height = '';
        clearModalPixelAnchor(confirmationDialog);
        confirmationDialog.style.removeProperty('--modal-offset-x');
        confirmationDialog.style.removeProperty('--modal-offset-y');
        confirmationDialog.removeAttribute('data-window-position-mode');
        confirmationDialog.removeAttribute('data-confirmation-preplaced');

        confirmationDialogKeydownOptionsRef = null;
        confirmationDialogKeydownInputRef = null;
        confirmationDialogInjectReadyFn = null;
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
            wireConfirmationDialogKeydownScope();
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
            const primaryIndex = Math.max(0, getConfirmationPrimaryButtonIndex(options));

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

                if (index === primaryIndex) {
                    button.setAttribute('data-dialog-primary', '1');
                }

                button.addEventListener('click', (e) => {
                    e.preventDefault();
                    const inputValue = input.value.trim();
                    const res = currentResolve;
                    hideConfirmationDialog();
                    if (res) {
                        res(option.value ? inputValue : null);
                    }
                });

                controlsEl.appendChild(button);
            });
        }

        // Set up close button handler dynamically based on current options
        if (inputCloseBtnElement) {
            // Remove existing listeners to avoid duplicates
            const newInputCloseBtnElement = inputCloseBtnElement.cloneNode(true);
            inputCloseBtnElement.parentNode.replaceChild(newInputCloseBtnElement, inputCloseBtnElement);

            newInputCloseBtnElement.addEventListener('click', () => {
                const res = currentResolve;
                const cancelValue = getConfirmationCancelResolveValue(options);
                hideConfirmationDialog();
                if (res) {
                    res(cancelValue);
                }
            });
        }

        // Focus input field
        setTimeout(() => {
            input.focus();
            input.select();
        }, 150);

        confirmationDialogKeydownOptionsRef = options;
        confirmationDialogKeydownInputRef = input;
        confirmationDialogInjectReadyFn = typeof config.onDialogReady === 'function' ? config.onDialogReady : null;
        wireConfirmationDialogKeydownScope();

        const usesManualPlacement = config.manualPosition || !!event || config.position === 'bottom-right';
        if (usesManualPlacement) {
            confirmationDialog.dataset.windowPositionMode = 'manual-only';
        } else {
            confirmationDialog.removeAttribute('data-window-position-mode');
        }

        // clearModalPixelAnchor — modalUtils.js
        clearModalPixelAnchor(confirmationDialog);

        // Apply custom width from config
        if (config.width) {
            const widthVal = String(config.width);
            confirmationDialog.style.width = widthVal.includes('px') ? widthVal : `${widthVal}px`;
        } else {
            confirmationDialog.style.width = '';
        }
        if (config.height) {
            const heightVal = String(config.height);
            confirmationDialog.style.height = heightVal.includes('px') ? heightVal : `${heightVal}px`;
        } else {
            confirmationDialog.style.height = '';
        }

        if (usesManualPlacement) {
            layoutConfirmationDialogPlacement(event, config, { usesManualPlacement: true });
        } else {
            confirmationDialog.removeAttribute('data-confirmation-preplaced');
        }

        openModal(confirmationDialog);

        if (typeof setActiveWindow === 'function') {
            setActiveWindow(confirmationDialog);
        } else {
            confirmationDialog.classList.add('active-window');
        }

        confirmationDialogActive = true;
    });
}