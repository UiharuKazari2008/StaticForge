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
        this.sendTelemetryPing();
        this.setupServiceWorkerListener();
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
                } else if (action === 'cache-clear') {
                    this.clearCachesAndReload();
                } else if (action === 'update-static') {
                    this.updateStaticData();
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

    async clearCachesAndReload() {
        try {
            this.showProgressBar();
            this.updateProgressStatus(0, 'Repairing...', '');
            // Clear all caches
            try {
            if ('caches' in window) {
                const cacheNames = await caches.keys();
                if (cacheNames.length > 0) {
                    await Promise.all(cacheNames.map(cacheName => caches.delete(cacheName)))
                } else { console.warn('No caches'); }
            }
            } catch (error) { console.error('Clear Caches:', error); }
            this.updateProgressStatus(10, 'Repairing...', '');
            // Clear localStorage
            try { localStorage.clear(); } catch (error) { console.error('localStorage clear:', error); }
            this.updateProgressStatus(30, 'Repairing...', '');
            // Clear sessionStorage
            try { sessionStorage.clear(); } catch (error) { console.error('sessionStorage clear:', error); }
            this.updateProgressStatus(45, 'Repairing...', '');

            // Deregister service worker
            try {
            if ('serviceWorker' in navigator) {
                const registrations = await navigator.serviceWorker.getRegistrations();
                if (registrations.length > 0) {
                    await Promise.all(registrations.map(registration => registration.unregister()));
                } else { console.warn('No service workers'); }
            }
            } catch (error) { console.error('serviceWorker deregister:', error); }
            this.updateProgressStatus(60, 'Repairing...', '');
            // Clear IndexedDB if it exists
            try {
            if ('indexedDB' in window) {
                let databases = [];
                try { if (indexedDB.databases) { databases = await indexedDB.databases(); }
                } catch (e) { console.warn('indexedDB.databases() not supported'); }
                
                if (databases.length > 0) {
                    for (const dbName of databases) {
                        try {
                            await new Promise((resolve) => {
                                try {
                                    const openReq = indexedDB.open(dbName);
                                    openReq.onsuccess = (event) => {
                                        const db = event.target.result;
                                        if (db) {
                                            db.onversionchange = () => {
                                                db.close();
                                                console.log(`Closed connection to database: ${dbName}`);
                                            };
                                            db.close();
                                        }
                                    };
                                    openReq.onerror = () => { console.warn('Error closing database connection:', e); };
                                } catch (e) { console.warn('Error closing database connection:', e); }
                                
                                // Now attempt to delete the database
                                const deleteReq = indexedDB.deleteDatabase(dbName);
                                const timeout = setTimeout(() => {
                                    console.warn(`Database deletion timeout for: ${dbName} - forcing continue`);
                                    resolve();
                                }, 2000);
                                deleteReq.onsuccess = () => {
                                    clearTimeout(timeout);
                                    console.log(`Successfully deleted database: ${dbName}`);
                                    resolve();
                                };
                                deleteReq.onerror = (event) => {
                                    clearTimeout(timeout);
                                    console.warn(`Failed to delete database: ${dbName}`, event.target.error);
                                    resolve(); // Continue even if one fails
                                };
                                deleteReq.onblocked = () => {
                                    clearTimeout(timeout);
                                    console.warn(`Database deletion blocked: ${dbName} - connections still open, continuing anyway`);
                                    resolve(); // Continue even if blocked
                                };
                            });
                        } catch (error) { console.warn(`Error deleting database ${dbName}:`, error); }
                    }
                } else { console.warn('No IndexedDB databases'); }
            }
            } catch (error) { console.warn('Could not clear IndexedDB:', error); }
        } catch (error) { console.error('Error clearing caches:', error); }
        this.updateProgressStatus(75, 'Repairing...', '');
        // Re-register service worker and start download
        try {
            if ('serviceWorker' in navigator) {
                // Re-register the service worker
                const registration = await navigator.serviceWorker.register('/sw.js');
                this.updateProgressStatus(85, 'Repairing...', '');
                
                // Wait a moment for the service worker to be ready
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                // Start the download process
                this.updateProgressStatus(90, 'Starting download...', '');
                await this.updateStaticData();
            } else {
                console.error('Service worker not supported');
                this.updateProgressStatus(90, 'Service worker not supported', 'error');
                this.hideProgressBarProgress();
                setTimeout(() => {
                    this.hideProgressBar();
                }, 3000);
            }
        } catch (error) {
            console.error('Error re-registering service worker:', error);
            this.updateProgressStatus(0, 'Re-registration failed', 'error');
            this.hideProgressBarProgress();
            setTimeout(() => {
                this.hideProgressBar();
            }, 3000);
        }
    }

    async updateStaticData() {
        try {
            if (navigator.serviceWorker) {
                console.log('🔄 Updating static data...');
                
                // Show progress bar and initial status (only if not already shown)
                if (!document.getElementById('assetLoadingProgress')?.classList.contains('show')) {
                    this.showProgressBar();
                }
                this.updateProgressStatus(0, 'Checking for updates...');
                
                // Check if service worker manager is available
                if (window.serviceWorkerManager) {
                    // Use the service worker manager to check for static file updates
                    await window.serviceWorkerManager.checkStaticFileUpdates();
                    // Don't show success here - let the service worker messages handle the progress
                } else {
                    console.error('❌ Service worker manager not available');
                    this.showUpdateError();
                }
            } else {
                console.error('❌ Service worker not supported');
                this.showUpdateError();
            }
        } catch (error) {
            console.error('❌ Error updating static data:', error);
            this.showUpdateError();
        }
    }

    showUpdateSuccess() {
        // Show success feedback in the progress status
        this.updateProgressStatus(100, 'Update Complete', 'success');
        this.hideProgressBar();
        setTimeout(() => {
            this.hideProgressBar();
        }, 3000);
    }

    showUpdateError() {
        // Show error feedback in the progress status
        this.updateProgressStatus(0, 'Update Failed', 'error');
        this.hideProgressBar();
        setTimeout(() => {
            this.hideProgressBar();
        }, 3000);
    }

    setupServiceWorkerListener() {
        // Listen for messages from service worker
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.addEventListener('message', (event) => {
                this.handleServiceWorkerMessage(event);
            });
        }
    }

    handleServiceWorkerMessage(event) {
        const { type, files, url, completed, total, currentFile } = event.data;
        
        console.log('Login page received service worker message:', type, event.data);
        
        switch (type) {
            case 'CACHE_STATIC_FILES':
                this.showProgressBar();
                this.updateProgressStatus(0, 'Updating (' + files.length + ' files left)');
                break;

            case 'STATIC_CACHE_PROGRESS':
                if (!document.getElementById('assetLoadingProgress')?.classList.contains('show')) {
                    this.showProgressBar();
                }
                const progress = Math.round((completed / total) * 100);
                this.updateProgressStatus(progress, `Updating (${total - completed} left)`);
                break;
                
            case 'STATIC_CACHE_COMPLETE':
                if (document.getElementById('assetLoadingProgress')?.classList.contains('show')) {
                    this.updateProgressStatus(100, 'Application Updated', 'success');
                    setTimeout(() => {
                        this.hideProgressBar();
                    }, 3000);
                }
                break;
            case 'NO_UPDATES_AVAILABLE':
                console.log('No updates available - hiding progress bar');
                if (document.getElementById('assetLoadingProgress')?.classList.contains('show')) {
                    this.updateProgressStatus(0, 'No Updates Available', '');
                    setTimeout(() => {
                        this.hideProgressBar();
                    }, 2000);
                }
                break;
        }
    }

    showProgressBar() {
        const assetLoadingProgress = document.getElementById('assetLoadingProgress');
        if (assetLoadingProgress) {
            assetLoadingProgress.classList.add('show');
        }
    }

    showProgressBarProgress () {
        const assetLoadingProgress = document.getElementById('assetLoadingProgress');
        if (assetLoadingProgress) {
            assetLoadingProgress.classList.add('show-progress');
        }
    }

    hideProgressBarProgress () {
        const assetLoadingProgress = document.getElementById('assetLoadingProgress');
        if (assetLoadingProgress) {
            assetLoadingProgress.classList.remove('show-progress');
        }
    }

    hideProgressBar() {
        const assetLoadingProgress = document.getElementById('assetLoadingProgress');
        if (assetLoadingProgress) {
            assetLoadingProgress.classList.remove('show', 'show-progress');
        }
    }

    updateProgressStatus(progress, message, statusClass = '') {
        const assetLoadingProgress = document.getElementById('assetLoadingProgress');
        const progressStatus = document.getElementById('progressStatus');
        const progressFill = document.getElementById('progressFill');
        if (assetLoadingProgress && progress > 0 && progress < 100) {
            this.showProgressBarProgress();
        } else {
            this.hideProgressBarProgress();
        }
        
        if (progressStatus) {
            progressStatus.textContent = message;
            // Remove existing status classes
            progressStatus.classList.remove('success', 'error');
            // Add new status class if provided
            if (statusClass) {
                progressStatus.classList.add(statusClass);
            }
        }
        
        if (progressFill) {
            progressFill.style.width = `${progress}%`;
        }
    }

    clearProgressStatus() {
        const progressStatus = document.getElementById('progressStatus');
        const progressFill = document.getElementById('progressFill');
        
        if (progressStatus) {
            progressStatus.textContent = '';
            progressStatus.classList.remove('success', 'error');
        }
        
        if (progressFill) {
            progressFill.style.width = '0%';
        }
        
        this.hideProgressBar();
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

    // Collect device and browser telemetry data
    collectTelemetryData() {
        const telemetry = {
            timestamp: Date.now(),
            userAgent: navigator.userAgent,
            language: navigator.language,
            platform: navigator.platform,
            cookieEnabled: navigator.cookieEnabled,
            onLine: navigator.onLine,
            screen: {
                width: screen.width || window.innerWidth,
                height: screen.height || window.innerHeight,
                colorDepth: screen.colorDepth,
                pixelDepth: screen.pixelDepth
            },
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            connection: null,
            serviceWorker: {
                supported: 'serviceWorker' in navigator,
                registered: false,
                scope: null
            },
            storage: {
                localStorage: this.checkStorageSupport('localStorage'),
                sessionStorage: this.checkStorageSupport('sessionStorage'),
                indexedDB: 'indexedDB' in window
            },
            features: {
                webGL: this.checkWebGLSupport(),
                webp: this.checkWebPSupport(),
                touch: 'ontouchstart' in window,
                geolocation: 'geolocation' in navigator
            }
        };

        // Check connection information if available
        if ('connection' in navigator) {
            const conn = navigator.connection;
            telemetry.connection = {
                effectiveType: conn.effectiveType,
                downlink: conn.downlink,
                rtt: conn.rtt,
                saveData: conn.saveData
            };
        }

        // Check service worker registration
        if (telemetry.serviceWorker.supported) {
            navigator.serviceWorker.getRegistrations().then(registrations => {
                if (registrations.length > 0) {
                    telemetry.serviceWorker.registered = true;
                    telemetry.serviceWorker.scope = registrations[0].scope;
                }
            }).catch(() => {
                // Service worker check failed
            });
        }

        return telemetry;
    }

    // Check storage support
    checkStorageSupport(type) {
        try {
            const storage = window[type];
            const testKey = '__storage_test__';
            storage.setItem(testKey, 'test');
            storage.removeItem(testKey);
            return true;
        } catch (e) {
            return false;
        }
    }

    // Check WebGL support
    checkWebGLSupport() {
        try {
            const canvas = document.createElement('canvas');
            return !!(canvas.getContext('webgl') || canvas.getContext('experimental-webgl'));
        } catch (e) {
            return false;
        }
    }

    // Check WebP support
    checkWebPSupport() {
        try {
            const canvas = document.createElement('canvas');
            canvas.width = 1;
            canvas.height = 1;
            return canvas.toDataURL('image/webp').indexOf('data:image/webp') === 0;
        } catch (e) {
            return false;
        }
    }

    // Send telemetry ping to server
    async sendTelemetryPing() {
        try {
            const telemetryData = this.collectTelemetryData();
            
            const response = await fetch('/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    action: 'ping',
                    data: telemetryData
                })
            });
            
            if (response.ok) {
                const data = await response.json();
                if (data.authenticated && data.redirect) {
                    console.log('🔐 User already authenticated, redirecting...');
                    window.location.href = data.redirect;
                    return;
                }
            }
        } catch (error) {
            console.error('❌ Error sending telemetry ping:', error);
        }
    }
}

// Create the login page instance
document.addEventListener('DOMContentLoaded', () => { 
    new LoginPage(); 
}); 