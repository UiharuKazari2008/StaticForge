// Login page functionality
class LoginPage {
    constructor() {
        this.errorMessage = document.getElementById('errorMessage');
        this.currentPin = '';
        this.isLoading = false;
        this.rollingBuffer = '';
        this.pinDots = document.querySelectorAll('.pin-dot');
        this.pinDisplay = document.querySelector('.pin-display');
        this.pinButtons = document.querySelectorAll('.pin-button');
        this.loginContainer = document.querySelector('.login-container');
        this.currentImageIndex = 0;
        this.config = {
            // Background image
            image: {
                num: 20, // Number of images
                width: 1024, // Width of each image
                height: 1024 // Height of each image
            }
        };
        
        // Initialize block container
        this.blockContainer = new BlockContainer('.block-container', {
            row: 20,
            col: 20,
            opacityRange: [0.05, 0.3]
        });
        
        this.init();
    }

    init() {
        this.setupKeyboardListener();
        this.setupPinPadListener();
        this.startBackground();
        this.updatePinDisplay();
        this.transitionToImage(0);
    }

    setupKeyboardListener() {
        document.addEventListener('keydown', (e) => {
            if (this.isLoading) return;
            if (e.key >= '0' && e.key <= '9') {
                this.addDigit(e.key);
            } else if (e.key === 'Enter') {
                if (this.rollingBuffer.length === 6) {
                    this.handleLogin();
                }
            } else if (e.key === 'Backspace') {
                this.removeDigit();
            }
        });
    }

    setupPinPadListener() {
        this.pinButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                if (this.isLoading) return;
                
                const number = button.getAttribute('data-number');
                const action = button.getAttribute('data-action');
                
                if (number) {
                    this.addDigit(number);
                } else if (action === 'clear') {
                    this.clearPin();
                } else if (action === 'backspace') {
                    this.removeDigit();
                }
            });
        });
        this.pinDisplay.addEventListener('click', () => {
            this.loginContainer.classList.add('transition');
            this.loginContainer.classList.toggle('minimize');
        });
    }

    addDigit(digit) {
        if (this.rollingBuffer.length < 6) {
            this.rollingBuffer += digit;
            this.updatePinDisplay();
            
            // Auto-submit when 6 digits are entered
            if (this.rollingBuffer.length === 6) {
                setTimeout(() => this.handleLogin(), 300);
            }
        }
    }

    removeDigit() {
        if (this.rollingBuffer.length > 0) {
            this.rollingBuffer = this.rollingBuffer.slice(0, -1);
            this.updatePinDisplay();
        }
    }

    clearPin() {
        this.rollingBuffer = '';
        this.updatePinDisplay();
    }

    updatePinDisplay() {
        this.pinDots.forEach((dot, index) => {
            if (index < this.rollingBuffer.length) {
                dot.classList.add('filled');
            } else {
                dot.classList.remove('filled');
            }
        });
    }

    async handleLogin() {
        if (this.isLoading) return;
        this.isLoading = true;
        this.clearPinError();
        
        try {
            const response = await fetch('/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    action: 'login',
                    data: { pin: this.rollingBuffer }
                })
            });
            
            const data = await response.json();
            
            if (response.ok) {
                // Store user type and any other user data for use in the app
                if (data.userType) {
                    localStorage.setItem('userType', data.userType);
                }
                
                // Store any additional user data that might be returned
                if (data.userData) {
                    localStorage.setItem('userData', JSON.stringify(data.userData));
                }
                
                // Store login timestamp
                localStorage.setItem('loginTimestamp', Date.now().toString());
                
                // Clear any existing error states
                this.clearPinError();
                
                // Show brief success feedback
                this.showLoginSuccess();
                
                // Wait a moment for user to see success, then redirect
                setTimeout(() => {
                    // Redirect to app immediately - let the app handle its own caching
                    window.location.href = '/app';
                }, 800);
                
            } else {
                this.showPinError();
                this.clearPin();
            }
        } catch (error) {
            console.error('Login error:', error);
            this.showPinError();
            this.clearPin();
        } finally {
            this.isLoading = false;
        }
    }

    showPinError() {
        this.pinDots.forEach(dot => {
            dot.classList.add('error');
        });
        // Remove error state after animation
        setTimeout(() => {
            this.clearPinError();
        }, 1000);
    }

    clearPinError() {
        this.pinDots.forEach(dot => {
            dot.classList.remove('error');
        });
    }

    // Show login success feedback
    showLoginSuccess() {
        this.pinDots.forEach(dot => {
            dot.classList.add('success');
        });
        
        // Update status if progress container exists
        const progressStatus = document.getElementById('progressStatus');
        if (progressStatus) {
            progressStatus.textContent = 'Login successful! Redirecting...';
        }
        
        // Remove success state after animation
        setTimeout(() => {
            this.pinDots.forEach(dot => {
                dot.classList.remove('success');
            });
        }, 1000);
    }

    // Animate background using BlockContainer module
    async startBackground() {
        const backgroundContainer = document.querySelector('.background-container');

        backgroundContainer.style.setProperty('--image-sheet', `100% ${100 * this.config.image.num}%`);
        backgroundContainer.style.setProperty('--image-width', `${this.config.image.width}px`);
        backgroundContainer.style.setProperty('--image-height', `${this.config.image.height}px`);
        backgroundContainer.style.setProperty('--image-num', `${this.config.image.num}`);
        
        // Initialize and start the block container with background rotation callback
        this.blockContainer.init(true);
        await new Promise(resolve => setTimeout(resolve, 1500));
        this.blockContainer.start(5000, 10000, 'diagonal', () => this.rotateBackgroundImage());
    }
    
    // Rotate to next background image
    rotateBackgroundImage() {
        const nextIndex = (this.currentImageIndex + 1) % this.config.image.num;
        this.transitionToImage(nextIndex);
    }

    // Transition to specific image using crossfade
    transitionToImage(imageIndex) {
        const bgLayer = document.getElementById('bg-layer');
        const backgroundContainer = document.querySelector('.background-container');

        if (!bgLayer || !backgroundContainer) return;
        
        // Calculate X offset as percentage
        // With background-size: 2000% 200%, we have 20 images horizontally
        // Each image takes up: 2000% / 20 = 100% of the container width
        // To convert to 0-100% range: (imageIndex * 100) / 20 = imageIndex * 5%
        const imageStep = 100 / (this.config.image.num - 1); // 5%
        const imageY = imageIndex * imageStep; // Each image at 0%, 5%, 10%, etc.

        setTimeout(() => {
            backgroundContainer.style.setProperty('--bg-y-pos', `${imageY}%`);
        }, 150); // Wait for fade-in to be mostly complete
        
        // Update current index
        this.currentImageIndex = imageIndex;
    }
}

// Create the login page instance
document.addEventListener('DOMContentLoaded', () => { 
    new LoginPage(); 
}); 