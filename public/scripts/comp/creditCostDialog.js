// Credit Cost Confirmation Dialog System
// Shows cost confirmation for paid requests

let creditCostDialogActive = false;

// Create and show credit cost confirmation dialog
function showCreditCostDialog(cost, event = null, outputResolution = null) {
    return new Promise((resolve, reject) => {
        // Create fresh dialog elements each time
        const dialog = document.createElement('div');
        dialog.id = 'creditCostDialog';
        dialog.className = 'credit-cost-dialog hidden';

        // Build content programmatically
        const content = document.createElement('div');
        content.className = 'credit-cost-content';

        const header = document.createElement('div');
        header.className = 'credit-cost-header';

        const icon = document.createElement('i');
        icon.className = 'nai-anla';
        header.appendChild(icon);

        const title = document.createElement('span');
        title.textContent = 'Payment Required';
        header.appendChild(title);

        const message = document.createElement('div');
        message.className = 'credit-cost-message';
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

        const buttons = document.createElement('div');
        buttons.className = 'credit-cost-buttons';

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'credit-cost-cancel-btn btn-secondary';
        cancelBtn.type = 'button';
        cancelBtn.textContent = 'Cancel';

        const confirmBtn = document.createElement('button');
        confirmBtn.className = 'credit-cost-confirm-btn btn-primary';
        confirmBtn.type = 'button';
        confirmBtn.textContent = 'Generate ';

        const arrowIcon = document.createElement('i');
        arrowIcon.className = 'fas fa-arrow-right';
        confirmBtn.appendChild(arrowIcon);

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
            resolve(true);
        };

        const handleCancel = (e) => {
            e.preventDefault();
            cleanupCreditCostDialog(dialog);
            resolve(false);
        };

        const handleEscape = (e) => {
            if (e.key === 'Escape' && creditCostDialogActive) {
                cleanupCreditCostDialog(dialog);
                resolve(false);
            }
        };

        confirmBtn.addEventListener('click', handleConfirm);
        cancelBtn.addEventListener('click', handleCancel);
        document.addEventListener('keydown', handleEscape);

        // Position dialog near mouse or button
        positionCreditCostDialog(event, dialog);

        // Show dialog
        dialog.classList.remove('hidden');
        creditCostDialogActive = true;

        // Debug: Log dialog state and ensure it's visible
        console.log('🎯 Credit cost dialog shown:', {
            dialog: dialog,
            isVisible: !dialog.classList.contains('hidden'),
            position: {
                left: dialog.style.left,
                top: dialog.style.top
            },
            event: event ? { clientX: event.clientX, clientY: event.clientY } : 'no event'
        });
    });
}

// Clean up and remove credit cost dialog
function cleanupCreditCostDialog(dialog) {
    if (dialog && dialog.parentNode) {
        dialog.parentNode.removeChild(dialog);
    }
    creditCostDialogActive = false;
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