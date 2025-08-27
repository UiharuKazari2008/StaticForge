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
        this.totalImages = 20;
        this.backgroundOpacityLow = 0.05;
        this.backgroundOpacityHigh = 0.3;
        this.init();
    }

    init() {
        this.setupKeyboardListener();
        this.setupPinPadListener();
        this.startBackground();
        this.updatePinDisplay();
        this.setupInitialBackground();
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
                // Store user type for use in the app
                if (data.userType) {
                    localStorage.setItem('userType', data.userType);
                }
                
                // Show progress bar and start asset caching
                this.showAssetLoadingProgress();
                
                // Register service worker and cache assets before redirecting
                await this.prepareAppAssets();
                
                // Redirect to app
                window.location.href = '/app';
            } else {
                this.showPinError();
                this.clearPin();
            }
        } catch (error) {
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

    // Show asset loading progress
    showAssetLoadingProgress() {
        const progressContainer = document.getElementById('assetLoadingProgress');
        const progressFill = document.getElementById('progressFill');
        const progressStatus = document.getElementById('progressStatus');
        
        if (progressContainer) {
            progressContainer.classList.remove('hidden');
            progressFill.style.width = '0%';
            progressStatus.textContent = 'Initializing...';
        }
    }

    // Update progress bar with detailed asset information
    updateProgress(percentage, status) {
        const progressFill = document.getElementById('progressFill');
        const progressStatus = document.getElementById('progressStatus');
        
        if (progressFill) {
            progressFill.style.width = `${percentage}%`;
        }
    }

    // Prepare app assets (service worker + caching)
    async prepareAppAssets() {
        try {
            // Step 1: Register service worker
            this.updateProgress(10, 'Registering');
            const serviceWorker = await this.registerServiceWorker();
            if (!serviceWorker) {
                this.updateProgress(100, 'Ready');
                return;
            }
            
            // Step 2: Get cache manifest
            this.updateProgress(20, 'Preparing');
            const manifest = await this.getCacheManifest();
            
            if (!manifest || manifest.length === 0) {
                this.updateProgress(100, 'Ready');
                await new Promise(resolve => setTimeout(resolve, 500));
                return;
            }
            
            // Show total asset count
            this.updateProgress(25, `Installing`);
            
            // Step 3: Cache assets (progress will be updated via handleProgressUpdate)
            await this.cacheAssets(manifest);
            
            this.updateProgress(100, 'Ready');
            
            // Wait a moment for user to see completion
            await new Promise(resolve => setTimeout(resolve, 500));
            
        } catch (error) {
            console.error('Error preparing app assets:', error);
            this.updateProgress(100, 'Not Ready');
            // Continue anyway - assets will load on demand
        }
    }

    // Register service worker
    async registerServiceWorker() {
        if ('serviceWorker' in navigator) {
            try {
                const registration = await navigator.serviceWorker.register('/sw.js');
                console.log('Service Worker registered:', registration);
                return registration;
            } catch (error) {
                console.error('Service Worker registration failed:', error);
                return null;
            }
        } else {
            console.warn('Service Worker not supported');
        }
    }

    // Get cache manifest from server
    async getCacheManifest() {
        try {
            console.log('Getting cache manifest from server...');
            const response = await fetch('/app', { method: 'OPTIONS' });
            if (response.ok) {
                const data = await response.json();
                console.log('Cache manifest received:', data.cacheData?.length || 0, 'assets');
                return data.cacheData || [];
            }
            throw new Error('Failed to get cache manifest');
        } catch (error) {
            console.error('Error getting cache manifest:', error);
            throw error;
        }
    }

    // Cache assets via service worker with progress tracking
    async cacheAssets(assets) {
        if (!assets || assets.length === 0) {
            console.warn('No assets to cache');
            return;
        }

        try {
            // Wait for service worker to be ready
            if (!navigator.serviceWorker.controller) {
                return;
            }

            // Send message to service worker to cache assets
            const messageChannel = new MessageChannel();
            
            return new Promise((resolve, reject) => {
                messageChannel.port1.onmessage = (event) => {
                    if (event.data && event.data.type === 'CACHE_COMPLETE') {
                        resolve(event.data.results);
                    } else if (event.data && event.data.type === 'CACHE_ERROR') {
                        reject(new Error(event.data.error));
                    } else if (event.data && event.data.type === 'PROGRESS_UPDATE') {
                        // Handle progress updates from service worker
                        this.handleProgressUpdate(event.data);
                    }
                };

                // Send cache request to service worker
                navigator.serviceWorker.controller.postMessage({
                    type: 'CACHE_ASSETS',
                    assets: assets
                }, [messageChannel.port2]);
                
                // Set timeout
                setTimeout(() => {
                    reject(new Error('Cache operation timeout'));
                }, 30000);
            });
        } catch (error) {
            console.error('Error caching assets:', error);
            throw error;
        }
    }

    // Handle progress updates from service worker
    handleProgressUpdate(progressData) {
        const { current, total, percentage, asset, status, downloading, completed, skipped, failed } = progressData;
        
        // Update the progress bar
        this.updateProgress(percentage, status);
        
        // Update status to include percentage
        const progressStatus = document.getElementById('progressStatus');
        if (progressStatus && total > 0) {
            progressStatus.textContent = `${status} (${percentage}%)`;
        }
    }

    // Animate background (reuse from app, but static color for login)
    startBackground() {
        const background = document.querySelector('.block-container');
        const blocks = [];
        
        for (let i = 0; i < 400; i++) { // 20x20 = 400 blocks, doubling the number (quadrupling count by doubling grid size)
            const block = document.createElement('div');
            block.classList.add('block');
            // Start each block at a random point in the animation cycle for variety
            const randomDelay = Math.random() * 10; // Match reduced duration
            block.style.animationDelay = `-${randomDelay}s`;
            
            // Add random opacity adjustment
            const randomOpacity = this.backgroundOpacityLow + Math.random() * (this.backgroundOpacityHigh - this.backgroundOpacityLow); // Random opacity between 0.3 and 1.0
            block.style.opacity = randomOpacity;
            
            // Calculate block's position in the grid and set CSS custom properties
            const row = Math.floor(i / 20);
            const col = i % 20;
            
            // Calculate the percentage offset for this block within the current image
            // Each block represents 1/20th of the image width and height
            // With 20 blocks, each block takes up 5% of the image (100% / 20 = 5%)
            const blockXOffset = (5 / 20) * (col + 1); // 0%, 5%, 10%, 15%, etc.
            const blockYOffset = (50 / 20) * (row + 1); // 0%, 5%, 10%, 15%, etc.
            
            block.style.setProperty('--block-x-offset', `${blockXOffset}%`);
            block.style.setProperty('--block-y-offset', `${blockYOffset}%`);
            
            // Store block reference and position for wave effect
            blocks.push({ element: block, row, col });
            
            background.appendChild(block);
        }
        
        // Create opacity wave effect after 5 seconds
        setTimeout(() => {
            this.createOpacityWave(blocks);
        }, 2000);
        
        // Start random opacity adjustments
        this.startRandomOpacityAdjustments(blocks);
    }
    
    // Create opacity wave from top-left to bottom-right
    createOpacityWave(blocks) {
        const waveDelay = 60; // 50ms delay between each block activation
        
        blocks.forEach((block, index) => {
            const delay = (block.row + block.col) * waveDelay;
            const element = block.element;
            
            setTimeout(() => {
                // Create wave effect by temporarily increasing opacity
                element.style.transition = 'opacity 0.5s ease-in-out';
                element.style.opacity = '1';
                
                // Return to random opacity after wave passes
                setTimeout(() => {
                    const randomOpacity = this.backgroundOpacityLow + Math.random() * (this.backgroundOpacityHigh - this.backgroundOpacityLow);
                    element.style.opacity = randomOpacity;
                }, 500);
            }, delay);
        });
        setTimeout(() => {
            this.rotateBackgroundImage();
        }, 750);

        // Repeat the wave effect every 15 seconds
        setTimeout(() => {
            this.createOpacityWave(blocks);
        }, 8000);
    }
    
    // Start random opacity adjustments
    startRandomOpacityAdjustments(blocks) {
        setInterval(() => {
            // Randomly select 5-10 blocks to adjust opacity
            const numBlocks = 5 + Math.floor(Math.random() * 6);
            const shuffled = [...blocks].sort(() => 0.5 - Math.random());
            
            for (let i = 0; i < numBlocks; i++) {
                const block = shuffled[i];
                const randomOpacity = this.backgroundOpacityLow + Math.random() * (this.backgroundOpacityHigh - this.backgroundOpacityLow); // Random opacity between 0.2 and 1.0
                block.element.style.transition = 'opacity 0.8s ease-in-out';
                block.element.style.opacity = randomOpacity;
            }
        }, 2000); // Adjust every 2 seconds
    }

    // Rotate to next background image
    rotateBackgroundImage() {
        const nextIndex = (this.currentImageIndex + 1) % this.totalImages;
        this.transitionToImage(nextIndex);
    }

    // Transition to specific image using crossfade
    transitionToImage(imageIndex) {
        const bgLayer = document.getElementById('bg-layer');
        const blurLayer = document.getElementById('blur-layer');
        const backgroundContainer = document.querySelector('.background-container');
        
        if (!bgLayer || !blurLayer || !backgroundContainer) return;
        
        // Calculate X offset as percentage
        // With background-size: 2000% 200%, we have 20 images horizontally
        // Each image takes up: 2000% / 20 = 100% of the container width
        // To convert to 0-100% range: (imageIndex * 100) / 20 = imageIndex * 5%
        const imageStep = 100 / (this.totalImages - 1); // 5%
        const imageX = imageIndex * imageStep; // Each image at 0%, 5%, 10%, etc.
        
        // Step 1: Change blur layer to next image and fade it in
        backgroundContainer.style.setProperty('--blur-x-pos', `${imageX}%`);
        blurLayer.classList.add('transitioning'); // Fade in
        
        // Step 2: After blur layer is visible, change normal layer underneath
        setTimeout(() => {
            backgroundContainer.style.setProperty('--bg-x-pos', `${imageX}%`);
        }, 150); // Wait for fade-in to be mostly complete
        
        // Step 3: Fade out blur layer to complete transition
        setTimeout(() => {
            blurLayer.classList.remove('transitioning');
        }, 650); // Wait for normal layer change (150ms) + fade-out duration (500ms)
        
        // Update current index
        this.currentImageIndex = imageIndex;
    }

    // Setup initial background positioning
    setupInitialBackground() {
        // Set initial background for the first image
        this.transitionToImage(0);
    }

}

// Create the login page instance
document.addEventListener('DOMContentLoaded', () => { 
    new LoginPage(); 
}); 