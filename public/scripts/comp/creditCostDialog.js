// Credit Cost Confirmation Dialog System
// Shows cost confirmation for paid requests

let creditCostDialog = null;
let creditCostDialogActive = false;
let creditCostDialogCallback = null;
let creditCostDialogCancelCallback = null;

// Create and show credit cost confirmation dialog
function showCreditCostDialog(cost, event = null) {
    return new Promise((resolve, reject) => {
        // Create dialog if it doesn't exist
        if (!creditCostDialog) {
            creditCostDialog = document.createElement('div');
            creditCostDialog.id = 'creditCostDialog';
            creditCostDialog.className = 'credit-cost-dialog';
            creditCostDialog.classList.add('hidden');
            creditCostDialog.innerHTML = `
                <div class="credit-cost-content">
                    <div class="credit-cost-header">
                        <i class="nai-anla"></i>
                        <span>Payment Required</span>
                    </div>
                    <div class="credit-cost-message">This will cost <div class="credit-cost-cost"><i class="nai-anla"></i><strong>${cost}</strong></div> to generate</div>
                    <div class="credit-cost-buttons">
                        <button class="credit-cost-cancel-btn btn-secondary" type="button">Cancel</button>
                        <button class="credit-cost-confirm-btn btn-primary" type="button">Generate <i class="fas fa-arrow-right"></i></button>
                    </div>
                </div>
            `;
            document.body.appendChild(creditCostDialog);
            
            // Add event listeners
            const confirmBtn = creditCostDialog.querySelector('.credit-cost-confirm-btn');
            const cancelBtn = creditCostDialog.querySelector('.credit-cost-cancel-btn');
            
            confirmBtn.addEventListener('click', (e) => {
                e.preventDefault();
                hideCreditCostDialog();
                resolve(true);
            });
            
            cancelBtn.addEventListener('click', (e) => {
                e.preventDefault();
                hideCreditCostDialog();
                resolve(false);
            });
            
            // Close on escape key
            document.addEventListener('keydown', handleCreditCostKeydown);
        } else {
            // Update cost in existing dialog
            const costElement = creditCostDialog.querySelector('.credit-cost-message strong');
            if (costElement) {
                costElement.textContent = `${cost} credits`;
            }
        }
        
        // Position dialog near mouse or button
        positionCreditCostDialog(event);
        
        // Show dialog
        creditCostDialog.classList.remove('hidden');
        creditCostDialogActive = true;
        
        // Debug: Log dialog state and ensure it's visible
        console.log('🎯 Credit cost dialog shown:', {
            dialog: creditCostDialog,
            isVisible: !creditCostDialog.classList.contains('hidden'),
            position: {
                left: creditCostDialog.style.left,
                top: creditCostDialog.style.top
            },
            event: event ? { clientX: event.clientX, clientY: event.clientY } : 'no event'
        });
    });
}

// Hide credit cost dialog
function hideCreditCostDialog() {
    if (creditCostDialog) {
        creditCostDialog.classList.add('hidden');
        creditCostDialogActive = false;
    }
}

// Position dialog near mouse or button
function positionCreditCostDialog(event) {
    if (!creditCostDialog) return;
    
    const dialog = creditCostDialog;
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

// Handle keyboard events
function handleCreditCostKeydown(e) {
    if (!creditCostDialogActive) return;
    
    if (e.key === 'Escape') {
        hideCreditCostDialog();
        if (creditCostDialogCancelCallback) {
            creditCostDialogCancelCallback();
        }
    }
}

// Check if a request requires paid credits
function requiresPaidCredits(requestBody) {    
    // Check for upscaling
    if (requestBody.upscale && requestBody.upscale > 1) return true;
    
    // Check for large resolutions
    if (requestBody.resolution) {
        if (requestBody.resolution.toLowerCase().startsWith('large_') || requestBody.resolution.toLowerCase().startsWith('wallpaper_')) {
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

// Calculate credit cost for a request
function calculateCreditCost(requestBody) {
    // Handle resolution vs width/height
    let width = requestBody.width || 1024;
    let height = requestBody.height || 1024;
    
    if (requestBody.resolution && !requestBody.width && !requestBody.height) {
        // Convert resolution to width/height
        const dimensions = getDimensionsFromResolution(requestBody.resolution);
        if (dimensions) {
            width = dimensions.width;
            height = dimensions.height;
        }
    }
    
    // Use the same price calculation as the rest of the application
    const price = calculatePriceUnified({
        height: height,
        width: width,
        steps: requestBody.steps || 25,
        model: requestBody.model || 'V4_5',
        sampler: { meta: requestBody.sampler || 'k_euler_ancestral' },
        subscription: window.optionsData?.user?.subscription || { perks: { unlimitedImageGenerationLimits: [] } },
        nSamples: 1,
        image: requestBody.image ? true : false,
        strength: requestBody.strength || 1
    });

    return price.opus > 0 ? price.list : false; // Return the list price (credits cost)
}