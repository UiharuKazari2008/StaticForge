// Login page functionality
class LoginPage {
    constructor() {
        this.errorMessage = document.getElementById('errorMessage');
        this.currentPin = '';
        this.isLoading = false;
        this.rollingBuffer = '';
        this.init();
    }

    init() {
        this.setupKeyboardListener();
        this.startBokehBackground();
    }

    setupKeyboardListener() {
        document.addEventListener('keydown', (e) => {
            if (this.isLoading) return;
            if (e.key >= '0' && e.key <= '9') {
                this.rollingBuffer += e.key;
                if (this.rollingBuffer.length > 6) {
                    this.rollingBuffer = this.rollingBuffer.slice(-6);
                }
            } else if (e.key === 'Enter') {
                if (this.rollingBuffer.length === 6) {
                    this.handleLogin();
                }
            } else if (e.key === 'Backspace') {
                this.rollingBuffer = this.rollingBuffer.slice(0, -1);
            }
        });
        // On mobile, show a hidden input to trigger number keyboard
        this.createMobileInput();
    }

    createMobileInput() {
        const input = document.createElement('input');
        input.type = 'tel';
        input.inputMode = 'numeric';
        input.pattern = '[0-9]*';
        input.style.position = 'absolute';
        input.style.opacity = 0;
        input.style.height = 0;
        input.style.width = 0;
        input.autocomplete = 'off';
        input.tabIndex = -1;
        document.body.appendChild(input);
        // Focus on touch devices
        input.addEventListener('focus', () => {
            window.scrollTo(0, 0);
        });
        if (/Mobi|Android/i.test(navigator.userAgent)) {
            setTimeout(() => input.focus(), 500);
        }
    }

    async handleLogin() {
        if (this.isLoading) return;
        this.isLoading = true;
        this.hideError();
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
                this.showError(data.error || 'Invalid PIN code');
                this.flashRedOrb();
                this.rollingBuffer = '';
            }
        } catch (error) {
            this.showError('Network error. Please try again.');
            this.flashRedOrb();
            this.rollingBuffer = '';
        } finally {
            this.isLoading = false;
        }
    }

    showError(message) {
        this.errorMessage.textContent = message;
        this.errorMessage.classList.remove('hidden');
    }
    hideError() {
        this.errorMessage.classList.add('hidden');
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
        // Optionally, could randomize colors or animate further
    }
}
document.addEventListener('DOMContentLoaded', () => { new LoginPage(); }); 