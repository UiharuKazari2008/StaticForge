// PWA Installation Handler
class PWAInstaller {
    constructor() {
        this.deferredPrompt = null;
        this.installButton = null;
        this.installBanner = null;
        this.init();
    }

    init() {
        // Listen for the beforeinstallprompt event
        window.addEventListener('beforeinstallprompt', (e) => {
            console.log('PWA install prompt available');
            e.preventDefault();
            this.deferredPrompt = e;
            this.showInstallBanner();
        });

        // Listen for successful installation
        window.addEventListener('appinstalled', () => {
            console.log('PWA was installed');
            this.hideInstallBanner();
            this.deferredPrompt = null;
        });

        // Check if app is already installed
        if (window.matchMedia('(display-mode: standalone)').matches) {
            console.log('App is running in standalone mode');
        }
    }

    showInstallBanner() {
        // Create install banner if it doesn't exist
        if (!this.installBanner) {
            this.createInstallBanner();
        }
        
        if (this.installBanner) {
            this.installBanner.classList.remove('hidden');
        }
    }

    hideInstallBanner() {
        if (this.installBanner) {
            this.installBanner.classList.add('hidden');
        }
    }

    createInstallBanner() {
        // Check if banner already exists
        if (document.getElementById('pwaInstallBanner')) {
            this.installBanner = document.getElementById('pwaInstallBanner');
            this.installButton = document.getElementById('pwaInstallBtn');
            return;
        }

        // Create banner HTML
        const bannerHTML = `
            <div id="pwaInstallBanner" class="pwa-install-banner">
                <div class="pwa-install-content">
                    <div class="pwa-install-left">
                        <i class="fas fa-download pwa-install-icon"></i>
                        <span class="pwa-install-text">Install Dreamscape for a better experience</span>
                    </div>
                    <div class="pwa-install-right">
                        <button type="button" id="pwaInstallBtn" class="btn-primary">
                            <i class="fas fa-plus"></i>
                            Install
                        </button>
                        <button type="button" id="pwaDismissBtn" class="btn-secondary">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;

        // Insert banner at the top of the body
        document.body.insertAdjacentHTML('afterbegin', bannerHTML);

        // Get references
        this.installBanner = document.getElementById('pwaInstallBanner');
        this.installButton = document.getElementById('pwaInstallBtn');
        const dismissButton = document.getElementById('pwaDismissBtn');

        // Add event listeners
        this.installButton.addEventListener('click', () => this.installPWA());
        dismissButton.addEventListener('click', () => this.hideInstallBanner());

        // Add CSS styles
        this.addInstallBannerStyles();
    }

    addInstallBannerStyles() {
        if (document.getElementById('pwa-install-styles')) return;

        const styles = `
            <style id="pwa-install-styles">
                .pwa-install-banner {
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
                    color: white;
                    z-index: 10000;
                    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
                    transform: translateY(-100%);
                    transition: transform 0.3s ease-in-out;
                }

                .pwa-install-banner:not(.hidden) {
                    transform: translateY(0);
                }

                .pwa-install-content {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 12px 20px;
                    max-width: 1200px;
                    margin: 0 auto;
                }

                .pwa-install-left {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }

                .pwa-install-icon {
                    font-size: 1.2em;
                }

                .pwa-install-text {
                    font-weight: 500;
                }

                .pwa-install-right {
                    display: flex;
                    gap: 8px;
                }

                .pwa-install-banner .btn-primary {
                    background: rgba(255, 255, 255, 0.2);
                    border: 1px solid rgba(255, 255, 255, 0.3);
                    color: white;
                    padding: 8px 16px;
                    border-radius: 6px;
                    cursor: pointer;
                    transition: all 0.2s ease;
                }

                .pwa-install-banner .btn-primary:hover {
                    background: rgba(255, 255, 255, 0.3);
                    border-color: rgba(255, 255, 255, 0.4);
                }

                .pwa-install-banner .btn-secondary {
                    background: transparent;
                    border: 1px solid rgba(255, 255, 255, 0.3);
                    color: white;
                    padding: 8px 12px;
                    border-radius: 6px;
                    cursor: pointer;
                    transition: all 0.2s ease;
                }

                .pwa-install-banner .btn-secondary:hover {
                    background: rgba(255, 255, 255, 0.1);
                }

                @media (max-width: 768px) {
                    .pwa-install-content {
                        flex-direction: column;
                        gap: 12px;
                        text-align: center;
                    }
                    
                    .pwa-install-right {
                        justify-content: center;
                    }
                }
            </style>
        `;

        document.head.insertAdjacentHTML('beforeend', styles);
    }

    async installPWA() {
        if (!this.deferredPrompt) {
            console.log('No install prompt available');
            return;
        }

        try {
            // Show the install prompt
            this.deferredPrompt.prompt();

            // Wait for the user to respond to the prompt
            const { outcome } = await this.deferredPrompt.userChoice;

            if (outcome === 'accepted') {
                console.log('User accepted the install prompt');
                this.hideInstallBanner();
            } else {
                console.log('User dismissed the install prompt');
            }

            // Clear the deferredPrompt
            this.deferredPrompt = null;
        } catch (error) {
            console.error('Error during PWA installation:', error);
        }
    }

    // Check if PWA is installable
    isInstallable() {
        return this.deferredPrompt !== null;
    }

    // Check if PWA is already installed
    isInstalled() {
        return window.matchMedia('(display-mode: standalone)').matches ||
               window.navigator.standalone === true;
    }
}

// Initialize PWA installer when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.pwaInstaller = new PWAInstaller();
});

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PWAInstaller;
}
