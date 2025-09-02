// PIN Modal functionality
class PinModal {
    constructor() {
        this.currentPin = '';
        this.isLoading = false;
        this.pinDots = document.querySelectorAll('#pinModal .pin-dot');
        this.pinButtons = document.querySelectorAll('#pinModal .pin-button');
        this.errorElement = document.getElementById('pinModalError');
        this.modal = document.getElementById('pinModal');
        this.resolveFn = null;
        this.rejectFn = null;
        this.init();
    }

    init() {
        this.setupKeyboardListener();
        this.setupPinPadListener();
    }

    setupKeyboardListener() {
        document.addEventListener('keydown', (e) => {
            if (this.modal.classList.contains('hidden')) return;
            if (this.isLoading) return;
            
            if (e.key >= '0' && e.key <= '9') {
                this.addDigit(e.key);
            } else if (e.key === 'Enter') {
                if (this.currentPin.length === 6) {
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
    }

    addDigit(digit) {
        if (this.currentPin.length < 6) {
            this.currentPin += digit;
            this.updatePinDisplay();
            
            // Auto-submit when 6 digits are entered
            if (this.currentPin.length === 6) {
                setTimeout(() => this.handleLogin(), 300);
            }
        }
    }

    removeDigit() {
        if (this.currentPin.length > 0) {
            this.currentPin = this.currentPin.slice(0, -1);
            this.updatePinDisplay();
        }
    }

    clearPin() {
        this.currentPin = '';
        this.updatePinDisplay();
    }

    updatePinDisplay() {
        this.pinDots.forEach((dot, index) => {
            if (index < this.currentPin.length) {
                dot.classList.add('filled');
            } else {
                dot.classList.remove('filled');
            }
        });
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
                    data: { pin: this.currentPin }
                })
            });
            
            const data = await response.json();
            if (response.ok) {
                this.resolve();
            } else {
                this.showPinError();
                this.clearPin();
                if (this.errorElement) {
                    this.errorElement.textContent = data.error || 'Invalid PIN code.';
                    this.errorElement.classList.remove('hidden');
                }
            }
        } catch (error) {
            this.showPinError();
            this.clearPin();
            if (this.errorElement) {
                this.errorElement.textContent = 'Network error. Try again.';
                this.errorElement.classList.remove('hidden');
            }
        } finally {
            this.isLoading = false;
        }
    }

    show() {
        this.currentPin = '';
        this.isLoading = false;
        this.updatePinDisplay();
        this.clearPinError();
        if (this.errorElement) {
            this.errorElement.classList.add('hidden');
        }
        openModal(this.modal);
        
        return new Promise((resolve, reject) => {
            this.resolveFn = resolve;
            this.rejectFn = reject;
        });
    }

    resolve() {
        closeModal(this.modal);
        if (this.resolveFn) {
            this.resolveFn();
        }
    }
}

// Initialize PIN modal
let pinModalInstance = null;

function showPinModal() {
    if (!pinModalInstance) {
        pinModalInstance = new PinModal();
    }
    return pinModalInstance.show();
}

// Make it available globally
window.showPinModal = showPinModal; 