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
        this.init();
    }

    init() {
        this.setupKeyboardListener();
        this.setupPinPadListener();
        this.startBokehBackground();
        this.updatePinDisplay();
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
            const response = await fetch('/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pin: this.rollingBuffer })
            });
            const data = await response.json();
            if (response.ok) {
                window.location.href = '/app';
            } else {
                this.showPinError();
                this.flashRedOrb();
                this.clearPin();
            }
        } catch (error) {
            this.showPinError();
            this.flashRedOrb();
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
    
    // Flash a red orb in the background for error
    flashRedOrb() {
        const bokeh = document.querySelector('.bokeh');
        if (!bokeh) return;
        // Create a red orb
        const orb = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        orb.setAttribute('cx', '50%');
        orb.setAttribute('cy', '50%');
        orb.setAttribute('r', '40%');
        orb.setAttribute('fill', '#dc3545');
        orb.setAttribute('opacity', '0.7');
        orb.style.transition = 'opacity 0.5s';
        bokeh.appendChild(orb);
        setTimeout(() => { orb.setAttribute('opacity', '0'); }, 200);
        setTimeout(() => { bokeh.removeChild(orb); }, 800);
    }
    
    // Animate bokeh background (reuse from app, but static color for login)
    startBokehBackground() {
        const background = document.querySelector('.block-container');
        for (let i = 0; i < 400; i++) { // 20x20 = 400 blocks, doubling the number (quadrupling count by doubling grid size)
            const block = document.createElement('div');
            block.classList.add('block');
            // Start each block at a random point in the animation cycle for variety
            const randomDelay = Math.random() * 10; // Match reduced duration
            block.style.animationDelay = `-${randomDelay}s`;
            background.appendChild(block);
        }
    }
}

document.addEventListener('DOMContentLoaded', () => { new LoginPage(); }); 