/** Error toast + sub-header display (Phase 2 batch 13). */
// Standardized error handling function
function handleError(context, error, fallbackMessage = 'An error occurred') {
    const errorMessage = error?.message || error || fallbackMessage;
    console.error(`❌ ${context}:`, errorMessage);

    // Show user-friendly error toast if available
    showGlassToast('error', 'Error', errorMessage);

    return errorMessage;
}

// Standardized async operation wrapper
async function safeAsyncOperation(context, operation, fallbackMessage = 'Operation failed') {
    try {
        return await operation();
    } catch (error) {
        handleError(context, error, fallbackMessage);
        throw error; // Re-throw to maintain error propagation
    }
}

// Error Sub-Header Functions
let errorSubHeaderTimeout = null;

// Show error message (simple glass toast)
function showError(message) {
    showGlassToast('error', null, message);
}

function showErrorSubHeader(message, type = 'error', duration = 0) {
    const errorSubHeader = document.getElementById('errorSubHeader');
    const errorIcon = errorSubHeader.querySelector('.error-sub-header-icon');
    const errorText = errorSubHeader.querySelector('.error-sub-header-text');
    const closeBtn = errorSubHeader.querySelector('.error-sub-header-close');

    if (!errorSubHeader || !errorIcon || !errorText) return;

    // Set icon based on type
    switch (type) {
        case 'login':
            errorIcon.className = 'fas fa-user-lock';
            break;
        case 'ban':
            errorIcon.className = 'fas fa-ban';
            break;
        case 'auth':
            errorIcon.className = 'fas fa-shield-alt';
            break;
        case 'warning':
            errorIcon.className = 'fas fa-exclamation-triangle';
            break;
        default:
            errorIcon.className = 'fas fa-exclamation-circle';
    }

    // Set message
    errorText.textContent = message;

    // Show the sub-header
    errorSubHeader.classList.remove('hidden');
    errorSubHeader.classList.add('show');
    document.body.classList.add('error-sub-header-active');

    // Clear existing timeout
    if (errorSubHeaderTimeout) {
        clearTimeout(errorSubHeaderTimeout);
    }

    // Auto-hide after duration (unless it's 0 for permanent)
    if (duration > 0) {
        errorSubHeaderTimeout = setTimeout(() => {
            hideErrorSubHeader();
        }, duration);
    }

    // Setup close button event listener
    closeBtn.onclick = hideErrorSubHeader;
}

function hideErrorSubHeader() {
    const errorSubHeader = document.getElementById('errorSubHeader');
    if (!errorSubHeader) return;

    errorSubHeader.classList.remove('show');
    document.body.classList.remove('error-sub-header-active');

    // Hide after animation completes
    setTimeout(() => {
        errorSubHeader.classList.add('hidden');
    }, 300);

    // Clear timeout
    if (errorSubHeaderTimeout) {
        clearTimeout(errorSubHeaderTimeout);
        errorSubHeaderTimeout = null;
    }
}

// Enhanced error handling for authentication issues
function handleAuthError(error, context = '') {
    console.error(`Authentication error in ${context}:`, error);

    let message = 'Authentication error occurred';
    let type = 'auth';

    if (error.message) {
        if (error.message.includes('login') || error.message.includes('PIN')) {
            message = 'Login failed. Please check your credentials.';
            type = 'login';
        } else if (error.message.includes('ban') || error.message.includes('suspended')) {
            message = 'Account access restricted. Please contact support.';
            type = 'ban';
        } else if (error.message.includes('unauthorized') || error.message.includes('forbidden')) {
            message = 'Access denied. Please log in again.';
            type = 'auth';
        } else {
            message = error.message;
        }
    }

    showErrorSubHeader(message, type, 15000);
}

