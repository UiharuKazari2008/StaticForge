// Login page functionality
class LoginPage {
    constructor() {
        this.pinInput = document.getElementById('pinInput');
        this.pinDigits = document.querySelectorAll('.pin-digit');
        this.loginBtn = document.getElementById('loginBtn');
        this.loginForm = document.getElementById('loginForm');
        this.errorMessage = document.getElementById('errorMessage');
        this.lastImageOverlay = document.getElementById('lastImageOverlay');
        
        this.currentPin = '';
        this.isLoading = false;
        
        this.init();
    }
    
    init() {
        this.setupEventListeners();
        this.loadLastGeneratedImage();
        this.startBackgroundEffect();
        this.focusPinInput();
    }
    
    setupEventListeners() {
        // PIN input handling
        this.pinInput.addEventListener('input', (e) => {
            this.handlePinInput(e.target.value);
        });
        
        this.pinInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && this.currentPin.length === 6) {
                this.handleLogin();
            }
        });
        
        // Form submission
        this.loginForm.addEventListener('submit', (e) => {
            e.preventDefault();
            if (this.currentPin.length === 6 && !this.isLoading) {
                this.handleLogin();
            }
        });
        
        // Click on PIN display to focus input
        document.querySelector('.pin-display').addEventListener('click', () => {
            this.pinInput.focus();
        });
        
        // Prevent form submission on Enter if PIN is incomplete
        this.loginForm.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && this.currentPin.length !== 6) {
                e.preventDefault();
            }
        });
    }
    
    handlePinInput(value) {
        // Only allow digits
        const digitsOnly = value.replace(/\D/g, '');
        
        // Limit to 6 digits
        this.currentPin = digitsOnly.slice(0, 6);
        this.pinInput.value = this.currentPin;
        
        // Update PIN display
        this.updatePinDisplay();
        
        // Update login button state
        this.loginBtn.disabled = this.currentPin.length !== 6 || this.isLoading;
    }
    
    updatePinDisplay() {
        this.pinDigits.forEach((digit, index) => {
            if (index < this.currentPin.length) {
                digit.classList.add('filled');
            } else {
                digit.classList.remove('filled');
            }
        });
    }
    
    async handleLogin() {
        if (this.isLoading) return;
        
        this.setLoading(true);
        this.hideError();
        
        try {
            const response = await fetch('/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ pin: this.currentPin })
            });
            
            const data = await response.json();
            
            if (response.ok) {
                // Success - redirect to app
                window.location.href = '/app';
            } else {
                // Show error
                this.showError(data.error || 'Invalid PIN code');
                this.clearPin();
            }
        } catch (error) {
            console.error('Login error:', error);
            this.showError('Network error. Please try again.');
            this.clearPin();
        } finally {
            this.setLoading(false);
        }
    }
    
    setLoading(loading) {
        this.isLoading = loading;
        this.loginBtn.disabled = loading || this.currentPin.length !== 6;
        
        if (loading) {
            this.loginBtn.classList.add('loading');
        } else {
            this.loginBtn.classList.remove('loading');
        }
    }
    
    showError(message) {
        this.errorMessage.textContent = message;
        this.errorMessage.classList.remove('hidden');
    }
    
    hideError() {
        this.errorMessage.classList.add('hidden');
    }
    
    clearPin() {
        this.currentPin = '';
        this.pinInput.value = '';
        this.updatePinDisplay();
        this.pinInput.focus();
    }
    
    focusPinInput() {
        // Small delay to ensure the page is fully loaded
        setTimeout(() => {
            this.pinInput.focus();
        }, 100);
    }
    
    async loadLastGeneratedImage() {
        try {
            const response = await fetch('/images?limit=1');
            if (response.ok) {
                const images = await response.json();
                if (images.length > 0) {
                    const lastImage = images[0];
                    // Use the preview image for background
                    const imageUrl = `/previews/${lastImage.preview}`;
                    this.setBackgroundImage(imageUrl);
                }
            }
        } catch (error) {
            console.log('Could not load last generated image:', error);
        }
    }
    
    setBackgroundImage(imageUrl) {
        this.lastImageOverlay.style.backgroundImage = `url(${imageUrl})`;
        
        // Start the background effect cycle
        this.startBackgroundEffect();
    }
    
    startBackgroundEffect() {
        // Cycle between static and image background
        let isImageVisible = false;
        
        setInterval(() => {
            if (isImageVisible) {
                this.lastImageOverlay.classList.remove('active');
            } else {
                this.lastImageOverlay.classList.add('active');
            }
            isImageVisible = !isImageVisible;
        }, 8000); // Change every 8 seconds
    }
}

// Initialize login page when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new LoginPage();
}); 