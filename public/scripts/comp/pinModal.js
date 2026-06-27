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
        if (this._keyboardScopeWired || !this.modal) return;
        this._keyboardScopeWired = true;
        this._keyboardHandler = (e) => {
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
        };
        // registerKeyboardListener: public/scripts/comp/modalKeyboardRegistry.js
        registerKeyboardListener({
            id: 'pinModal.keydown',
            handler: this._keyboardHandler,
            type: 'whenOpen',
            modalId: 'pinModal',
            priority: 90,
            critical: true,
            showInOverlay: false
        });
        registerKeyboardListener({
            id: 'overlay.pinModal.digits',
            type: 'whenOpen',
            modalId: 'pinModal',
            label: 'Enter digit',
            keys: '0–9',
            overlayIcon: 'fas fa-keyboard',
            overlayGroup: 'PIN',
            overlayOnly: true,
            priority: -10
        });
        registerKeyboardListener({
            id: 'overlay.pinModal.enter',
            type: 'whenOpen',
            modalId: 'pinModal',
            label: 'Submit PIN',
            keys: 'Enter',
            overlayIcon: 'fas fa-sign-in-alt',
            overlayGroup: 'PIN',
            overlayOnly: true,
            priority: -10,
            overlayValid: () => this.currentPin.length === 6
        });
        registerKeyboardListener({
            id: 'overlay.pinModal.backspace',
            type: 'whenOpen',
            modalId: 'pinModal',
            label: 'Delete digit',
            keys: 'Backspace',
            overlayIcon: 'fas fa-backspace',
            overlayGroup: 'PIN',
            overlayOnly: true,
            priority: -10,
            overlayValid: () => this.currentPin.length > 0
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
        // notifyKeyboardOverlayContextChanged: public/scripts/comp/modalKeyboardRegistry.js
        notifyKeyboardOverlayContextChanged();
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
                await this.resolve();
                // syncAuthLocalStorageFromServer: public/scripts/comp/connectionManager.js
                syncAuthLocalStorageFromServer(data);
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

    async resolve() {
        await closeModal(this.modal);
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