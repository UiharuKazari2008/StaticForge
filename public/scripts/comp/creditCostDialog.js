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
            creditCostDialog.innerHTML = `
                <div class="credit-cost-content">
                    <div class="credit-cost-header">
                        <i class="nai-anla"></i>
                        <span>Credit Cost</span>
                    </div>
                    <div class="credit-cost-message">
                        This will cost <strong>${cost} credits</strong> to generate.
                    </div>
                    <div class="credit-cost-buttons">
                        <button class="credit-cost-cancel-btn" type="button">Cancel</button>
                        <button class="credit-cost-confirm-btn" type="button">Generate</button>
                    </div>
                </div>
            `;
            document.body.appendChild(creditCostDialog);
            
            // Add event listeners
            const confirmBtn = creditCostDialog.querySelector('.credit-cost-confirm-btn');
            const cancelBtn = creditCostDialog.querySelector('.credit-cost-cancel-btn');
            
            confirmBtn.addEventListener('click', () => {
                hideCreditCostDialog();
                resolve(true);
            });
            
            cancelBtn.addEventListener('click', () => {
                hideCreditCostDialog();
                resolve(false);
            });
            
            // Close on escape key
            document.addEventListener('keydown', handleCreditCostKeydown);
        }
        
        // Update cost in dialog
        const costElement = creditCostDialog.querySelector('.credit-cost-message strong');
        if (costElement) {
            costElement.textContent = `${cost} credits`;
        }
        
        // Position dialog near mouse or button
        positionCreditCostDialog(event);
        
        // Show dialog
        creditCostDialog.style.display = 'block';
        creditCostDialogActive = true;
        
        // Focus cancel button
        const cancelBtn = creditCostDialog.querySelector('.credit-cost-cancel-btn');
        if (cancelBtn) {
            cancelBtn.focus();
        }
    });
}

// Hide credit cost dialog
function hideCreditCostDialog() {
    if (creditCostDialog) {
        creditCostDialog.style.display = 'none';
        creditCostDialogActive = false;
    }
}

// Position dialog near mouse or button
function positionCreditCostDialog(event) {
    if (!creditCostDialog) return;
    
    const dialog = creditCostDialog;
    const rect = dialog.getBoundingClientRect();
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;
    
    let x, y;
    
    if (event) {
        // Position near mouse/button
        x = event.clientX - rect.width / 2;
        y = event.clientY - rect.height - 10;
    } else {
        // Center on screen
        x = (windowWidth - rect.width) / 2;
        y = (windowHeight - rect.height) / 2;
    }
    
    // Ensure dialog doesn't go off screen
    if (x < 10) x = 10;
    if (y < 10) y = 10;
    if (x + rect.width > windowWidth - 10) x = windowWidth - rect.width - 10;
    if (y + rect.height > windowHeight - 10) y = windowHeight - rect.height - 10;
    
    dialog.style.left = x + 'px';
    dialog.style.top = y + 'px';
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
    if (requestBody.upscale && requestBody.upscale > 1) {
        return true;
    }
    
    // Check for large resolutions
    if (requestBody.resolution) {
        const largeResolutions = ['LARGE_PORTRAIT', 'LARGE_LANDSCAPE', 'LARGE_SQUARE'];
        if (largeResolutions.includes(requestBody.resolution)) {
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
    // For now, return fixed costs based on operation type
    if (requestBody.upscale && requestBody.upscale > 1) {
        return 7; // Upscaling cost
    }
    
    // For generation, check resolution and steps
    if (requestBody.resolution) {
        const largeResolutions = ['LARGE_PORTRAIT', 'LARGE_LANDSCAPE', 'LARGE_SQUARE'];
        if (largeResolutions.includes(requestBody.resolution)) {
            return 5; // Large resolution cost
        }
        
        // Check custom dimensions
        if (requestBody.resolution.includes('x')) {
            const [width, height] = requestBody.resolution.split('x').map(Number);
            if (width > 1024 || height > 1024) {
                return 5; // Large custom resolution cost
            }
        }
    }
    
    if (requestBody.steps && requestBody.steps > 28) {
        return 3; // High steps cost
    }
    
    return 1; // Default cost
} 