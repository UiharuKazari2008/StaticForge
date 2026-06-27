// Credit Cost Confirmation Dialog System
// Shows cost confirmation for paid requests

let creditCostDialogActive = false;
let creditCostDialogKeyboardRegistered = false;
let creditCostDialogConfirmHandler = null;
let creditCostDialogCancelHandler = null;

function handleCreditCostDialogKeydown(e) {
    if (!creditCostDialogActive) return;
    const dialog = document.getElementById('creditCostDialog');
    if (!dialog || dialog.classList.contains('hidden')) return;

    if (e.key === 'Escape') {
        e.preventDefault();
        if (creditCostDialogCancelHandler) {
            creditCostDialogCancelHandler(e);
        }
        return true;
    }
    if (e.key === 'Enter') {
        if (e.target.closest('.credit-cost-buttons') && e.target.tagName === 'BUTTON') {
            return;
        }
        e.preventDefault();
        if (creditCostDialogConfirmHandler) {
            creditCostDialogConfirmHandler(e);
        }
        return true;
    }
}

function ensureCreditCostDialogKeyboardRegistered() {
    if (creditCostDialogKeyboardRegistered) return;
    creditCostDialogKeyboardRegistered = true;
    // registerKeyboardListener: public/scripts/comp/modalKeyboardRegistry.js
    registerKeyboardListener({
        id: 'creditCostDialog.keydown',
        handler: handleCreditCostDialogKeydown,
        type: 'whenOpen',
        modalId: 'creditCostDialog',
        priority: 85,
        critical: true,
        showInOverlay: false
    });
    registerKeyboardListener({
        id: 'overlay.creditCost.escape',
        type: 'whenOpen',
        modalId: 'creditCostDialog',
        label: 'Cancel',
        keys: 'Esc',
        overlayIcon: 'fas fa-times',
        overlayGroup: 'Dialog',
        overlayOnly: true,
        priority: -10
    });
    registerKeyboardListener({
        id: 'overlay.creditCost.enter',
        type: 'whenOpen',
        modalId: 'creditCostDialog',
        label: 'Confirm',
        keys: 'Enter',
        overlayIcon: 'fas fa-check',
        overlayGroup: 'Dialog',
        overlayOnly: true,
        priority: -10
    });
}

// Create and show credit cost confirmation dialog
function showCreditCostDialog(cost, event = null, outputResolution = null, isUpscaling = false, imageWidth = null, imageHeight = null, isFreeUpscaling = false) {
    return new Promise((resolve, reject) => {
        ensureCreditCostDialogKeyboardRegistered();

        // Create fresh dialog elements each time
        const dialog = document.createElement('div');
        dialog.id = 'creditCostDialog';
        dialog.className = 'modal hidden transient tool-window on-top credit-cost-dialog';

        // Build content programmatically
        const content = document.createElement('div');
        content.className = 'credit-cost-content';

        const header = document.createElement('div');
        header.className = 'credit-cost-header';

        const icon = document.createElement('i');
        icon.className = isUpscaling ? 'nai-upscale' : 'nai-anla';
        header.appendChild(icon);

        const title = document.createElement('span');
        title.textContent = isUpscaling ? 'Upscale Image' : 'Payment Required';
        header.appendChild(title);

        const message = document.createElement('div');
        message.className = 'credit-cost-message';

        // ESRGAN options for upscaling
        let selectedUpscaler = 'novelai';
        let selectedScale = 4;

        if (isUpscaling) {
            // Calculate upscale info to determine NovelAI availability
            let upscaleInfo = null;
            let novelaiAvailable = false;
            if (imageWidth && imageHeight) {
                upscaleInfo = calculateUpscaleInfo(imageWidth, imageHeight);
                novelaiAvailable = upscaleInfo.available;
            }

            // If NovelAI is not available, default to ESRGAN
            if (!novelaiAvailable) {
                selectedUpscaler = 'esrgan';
                selectedScale = 4;
            }

            // For upscaling, show method selection dropdown
            message.textContent = 'Choose upscaling method:';

            // Create upscale method dropdown
            const methodContainer = document.createElement('div');
            methodContainer.className = 'upscale-method-container';

            const methodDropdown = document.createElement('div');
            methodDropdown.id = 'upscaleMethodDropdown';
            methodDropdown.className = 'custom-dropdown dropup dark';

            const methodDropdownBtn = document.createElement('button');
            methodDropdownBtn.type = 'button';
            methodDropdownBtn.id = 'upscaleMethodDropdownBtn';
            methodDropdownBtn.className = 'custom-dropdown-btn hover-show colored';
            methodDropdownBtn.style.width = '100%';
            methodDropdownBtn.style.maxWidth = '300px';
            methodDropdownBtn.textContent = novelaiAvailable ? 'NovelAI (4x)' : 'ESRGAN (4x)';
            
            methodDropdown.appendChild(methodDropdownBtn);

            const methodMenu = document.createElement('div');
            methodMenu.id = 'upscaleMethodDropdownMenu';
            methodMenu.className = 'custom-dropdown-menu hidden';
            methodMenu.style.maxHeight = '300px';
            methodMenu.style.overflowY = 'auto';

            // Add NovelAI option only if available
            if (novelaiAvailable) {
                const novelaiOption = document.createElement('div');
                novelaiOption.className = 'custom-dropdown-option selected';
                novelaiOption.dataset.method = 'novelai';
                novelaiOption.dataset.scale = '4';
                const costText = isFreeUpscaling ? 'Free' : `${cost} credits`;
                novelaiOption.textContent = `NovelAI - ${costText} → ${outputResolution ? outputResolution.width + '×' + outputResolution.height : '4x'}`;
                novelaiOption.addEventListener('click', () => {
                    selectUpscaleMethod('novelai', 4);
                    closeUpscaleMethodDropdown();
                });
                methodMenu.appendChild(novelaiOption);
            }

            // Add ESRGAN options
            const scaleOptions = [2, 3, 4, 8];
            scaleOptions.forEach(scale => {
                const esrganOption = document.createElement('div');
                // Select first ESRGAN 4x option if NovelAI is not available
                const isSelected = !novelaiAvailable && scale === 4;
                esrganOption.className = 'custom-dropdown-option' + (isSelected ? ' selected' : '');
                esrganOption.dataset.method = 'esrgan';
                esrganOption.dataset.scale = scale.toString();
                const outputRes = imageWidth && imageHeight ? `${imageWidth * scale}×${imageHeight * scale}` : `${scale}x`;
                esrganOption.textContent = `ESRGAN ${scale}x - ${outputRes}`;
                esrganOption.addEventListener('click', () => {
                    selectUpscaleMethod('esrgan', scale);
                    closeUpscaleMethodDropdown();
                });
                methodMenu.appendChild(esrganOption);
            });

            methodDropdown.appendChild(methodMenu);
            methodContainer.appendChild(methodDropdown);
            message.appendChild(methodContainer);

            // Setup dropdown functionality
            setupDropdown(methodDropdown, methodDropdownBtn, methodMenu, () => {
                // Render function - already populated above
            }, () => ({
                method: selectedUpscaler,
                scale: selectedScale
            }), { preventFocusTransfer: true });

            // Method selection function
            function selectUpscaleMethod(method, scale) {
                selectedUpscaler = method;
                selectedScale = scale;

                const displayText = method === 'novelai' ?
                    `NovelAI (4x)` :
                    `ESRGAN (${scale}x)`;
                methodDropdownBtn.textContent = displayText;

                // Update button text
                if (method === 'esrgan') {
                    confirmBtn.textContent = 'Upscale ';
                } else {
                    const buttonText = isFreeUpscaling ? 'Upscale ' : `Upscale (${cost} credits) `;
                    confirmBtn.textContent = buttonText;
                }
                const arrowIcon = document.createElement('i');
                arrowIcon.className = 'fas fa-arrow-right';
                confirmBtn.appendChild(arrowIcon);

                // Update selected state in dropdown
                methodMenu.querySelectorAll('.custom-dropdown-option').forEach(opt => {
                    opt.classList.remove('selected');
                    if (opt.dataset.method === method && opt.dataset.scale === scale.toString()) {
                        opt.classList.add('selected');
                    }
                });
            }

            function closeUpscaleMethodDropdown() {
                closeDropdown(methodMenu, methodDropdownBtn);
            }
        } else {
            // Normal cost dialog for non-upscaling requests
            message.textContent = 'This will cost ';

            const costContainer = document.createElement('div');
            costContainer.className = 'credit-cost-cost';

            const costIcon = document.createElement('i');
            costIcon.className = 'nai-anla';
            costContainer.appendChild(costIcon);

            const costText = document.createElement('strong');
            costText.textContent = cost;
            costContainer.appendChild(costText);

            message.appendChild(costContainer);

            // Add output resolution if provided
            if (outputResolution && outputResolution.width && outputResolution.height) {
                message.appendChild(document.createTextNode(' to generate (→ '));
                const resolutionSpan = document.createElement('strong');
                resolutionSpan.textContent = `${outputResolution.width}×${outputResolution.height}`;
                message.appendChild(resolutionSpan);
                message.appendChild(document.createTextNode(')'));
            } else {
                message.appendChild(document.createTextNode(' to generate'));
            }
        }

        const buttons = document.createElement('div');
        buttons.className = 'credit-cost-buttons';

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'credit-cost-cancel-btn btn-secondary';
        cancelBtn.type = 'button';
        cancelBtn.textContent = 'Cancel';

        const confirmBtn = document.createElement('button');
        confirmBtn.className = 'credit-cost-confirm-btn btn-primary';
        confirmBtn.type = 'button';
        confirmBtn.setAttribute('data-dialog-primary', '1');

        if (isUpscaling) {
            // Button text depends on selected upscaler
            // Calculate upscale info to determine NovelAI availability
            let novelaiAvailableForButton = false;
            if (imageWidth && imageHeight) {
                const upscaleInfoForButton = calculateUpscaleInfo(imageWidth, imageHeight);
                novelaiAvailableForButton = upscaleInfoForButton.available;
            }

            if (novelaiAvailableForButton) {
                const buttonText = isFreeUpscaling ? 'Upscale ' : `Upscale (${cost} credits) `;
                confirmBtn.textContent = buttonText;
            } else {
                confirmBtn.textContent = 'Upscale ';
            }
            const arrowIcon = document.createElement('i');
            arrowIcon.className = 'fas fa-arrow-right';
            confirmBtn.appendChild(arrowIcon);
        } else {
            confirmBtn.textContent = 'Generate ';
            const arrowIcon = document.createElement('i');
            arrowIcon.className = 'fas fa-arrow-right';
            confirmBtn.appendChild(arrowIcon);
        }

        buttons.appendChild(cancelBtn);
        buttons.appendChild(confirmBtn);

        content.appendChild(header);
        content.appendChild(message);
        content.appendChild(buttons);
        dialog.appendChild(content);

        document.body.appendChild(dialog);

        // Add event listeners with current promise resolve/reject
        const handleConfirm = (e) => {
            e.preventDefault();
            cleanupCreditCostDialog(dialog);
            if (isUpscaling) {
                resolve({
                    confirmed: true,
                    upscaler: selectedUpscaler,
                    scale: selectedScale
                });
            } else {
                resolve(true);
            }
        };

        const handleCancel = (e) => {
            e.preventDefault();
            cleanupCreditCostDialog(dialog);
            resolve(false);
        };

        creditCostDialogConfirmHandler = handleConfirm;
        creditCostDialogCancelHandler = handleCancel;

        confirmBtn.addEventListener('click', handleConfirm);
        cancelBtn.addEventListener('click', handleCancel);

        // Position dialog near mouse or button
        positionCreditCostDialog(event, dialog);

        dialog.dataset.windowPositionMode = 'manual-only';
        // openModal, assignModalZIndex — public/scripts/comp/modalUtils.js
        openModal(dialog);
        assignModalZIndex(dialog);
        creditCostDialogActive = true;
    });
}

// Clean up and remove credit cost dialog
function cleanupCreditCostDialog(dialog) {
    creditCostDialogActive = false;
    creditCostDialogConfirmHandler = null;
    creditCostDialogCancelHandler = null;
    if (dialog) {
        // closeModal — public/scripts/comp/modalUtils.js
        closeModal(dialog).then(() => {
            if (dialog.parentNode) {
                dialog.parentNode.removeChild(dialog);
            }
        });
    }
}

// Hide credit cost dialog (legacy function for compatibility)
function hideCreditCostDialog() {
    const dialog = document.getElementById('creditCostDialog');
    if (dialog) {
        cleanupCreditCostDialog(dialog);
    }
}

// Position dialog near mouse or button
function positionCreditCostDialog(event, dialog) {
    if (!dialog) return;
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;
    
    // Get dialog dimensions (use a reasonable default if not yet rendered)
    const dialogWidth = 350; // Match CSS width
    const dialogHeight = 150; // Approximate height
    
    let x, y;
    
    if (event && event.clientX !== undefined && event.clientY !== undefined) {
        // Position near mouse/button
        x = event.clientX - dialogWidth / 2;
        y = event.clientY - dialogHeight - 10;
        
        // If dialog would go above the mouse, position it below instead
        if (y < 10) {
            y = event.clientY + 10;
        }
    } else if (event && event.submitter) {
        // Position near the submitter button for form submissions
        const submitter = event.submitter;
        const rect = submitter.getBoundingClientRect();
        x = rect.left + rect.width / 2 - dialogWidth / 2;
        y = rect.top - dialogHeight - 10;
        
        // If dialog would go above the button, position it below instead
        if (y < 10) {
            y = rect.bottom + 10;
        }
    } else {
        // Center on screen
        x = (windowWidth - dialogWidth) / 2;
        y = (windowHeight - dialogHeight) / 2;
    }
    
    // Ensure dialog doesn't go off screen
    if (x < 10) x = 10;
    if (y < 10) y = 10;
    if (x + dialogWidth > windowWidth - 10) x = windowWidth - dialogWidth - 10;
    if (y + dialogHeight > windowHeight - 10) y = windowHeight - dialogHeight - 10;
    
    // Ensure we have valid coordinates
    if (isNaN(x) || isNaN(y)) {
        x = (windowWidth - dialogWidth) / 2;
        y = (windowHeight - dialogHeight) / 2;
    }
    
    dialog.style.left = x + 'px';
    dialog.style.top = y + 'px';
    
    // Debug: Log positioning calculations
    console.log('🎯 Dialog positioned:', {
        calculatedX: x,
        calculatedY: y,
        appliedLeft: dialog.style.left,
        appliedTop: dialog.style.top,
        windowDimensions: { width: windowWidth, height: windowHeight },
        dialogDimensions: { width: dialogWidth, height: dialogHeight },
        event: event ? { clientX: event.clientX, clientY: event.clientY } : 'no event'
    });   
}


// Check if a request requires paid credits
function requiresPaidCredits(requestBody) {    
    // Check for upscaling
    if (requestBody.upscale && requestBody.upscale > 1) return true;
    
    // Check for large resolutions
    if (requestBody.resolution) {
        if (requestBody.resolution.toLowerCase().startsWith('large_') || requestBody.resolution.toLowerCase().startsWith('xlarge_') || requestBody.resolution.toLowerCase().startsWith('wallpaper_')) {
            return true;
        }
        
        // Check custom dimensions
        if (requestBody.resolution.includes('x')) {
            const [width, height] = requestBody.resolution.split('x').map(Number);
            if (width > 1024 || height > 1024) {
                return true;
            }
        }
    }
    
    // Check for high steps
    if (requestBody.steps && requestBody.steps > 28) {
        return true;
    }
    
    return false;
}
