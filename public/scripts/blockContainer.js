// Block Container Module - Reusable block effect system
class BlockContainer {
    constructor(containerSelector, options = {}) {
        this.container = document.querySelector(containerSelector);
        this.blocks = [];
        this.isActive = false;
        this.animationInterval = null;
        this.waveTimeout = null;
        this.activeTimeouts = new Set(); // Track active timeouts for cleanup
        
        // Default configuration with performance optimizations
        this.config = {
            row: 20,
            col: 20,
            opacityRange: [0.05, 0.3],
            waveDelay: 30,
            randomAdjustInterval: 2000,
            batchSize: 50, // Process blocks in batches for better performance
            useRequestAnimationFrame: true, // Use RAF for smooth animations
            ...options
        };
        
        if (!this.container) {
            console.error(`BlockContainer: Container not found: ${containerSelector}`);
            return;
        }
        
        // Performance monitoring
        this.performanceMetrics = {
            lastFrameTime: 0,
            frameCount: 0,
            averageFrameTime: 0
        };
    }

    // Initialize the block container
    init(initalState = 'normal') {
        if (this.isActive) return;
        
        this.setupContainer();
        this.generateBlocks(initalState);
        this.optimizeForHighBlockCount(); // Apply performance optimizations
        this.isActive = true;
    }

    // Update grid dimensions dynamically
    updateGridDimensions(width, height) {
        // Calculate aspect ratio
        const aspectRatio = width / height;
        
        // Calculate optimal grid dimensions to get closest to 400 blocks without going over
        const targetBlocks = 400;
        
        if (Math.abs(aspectRatio - 1) < 0.1) {
            // Square: calculate dimensions to get closest to 400 blocks
            const dimension = Math.floor(Math.sqrt(targetBlocks));
            this.config.row = dimension;
            this.config.col = dimension;
        } else if (aspectRatio > 1) {
            // Landscape: width > height
            // Calculate optimal dimensions maintaining aspect ratio
            const maxCol = Math.floor(Math.sqrt(targetBlocks / aspectRatio));
            const maxRow = Math.floor(maxCol * aspectRatio);
            
            // Ensure we don't go over target blocks
            if (maxRow * maxCol > targetBlocks) {
                this.config.row = Math.floor(Math.sqrt(targetBlocks * aspectRatio));
                this.config.col = Math.floor(targetBlocks / this.config.row);
            } else {
                this.config.row = maxRow;
                this.config.col = maxCol;
            }
        } else {
            // Portrait: height > width
            // Calculate optimal dimensions maintaining aspect ratio
            const maxRow = Math.floor(Math.sqrt(targetBlocks * aspectRatio));
            const maxCol = Math.floor(maxRow / aspectRatio);
            
            // Ensure we don't go over target blocks
            if (maxRow * maxCol > targetBlocks) {
                this.config.col = Math.floor(Math.sqrt(targetBlocks / aspectRatio));
                this.config.row = Math.floor(targetBlocks / this.config.col);
            } else {
                this.config.row = maxRow;
                this.config.col = maxCol;
            }
        }
        
        // Ensure minimum dimensions
        this.config.row = Math.max(this.config.row, 5);
        this.config.col = Math.max(this.config.col, 5);
        
        // Update container CSS properties
        this.setupContainer();
        
        // Regenerate blocks if already active
        if (this.isActive) {
            this.generateBlocks('ready');
        }
    }

    // Unload the container
    unload() {
        if (!this.isActive) return;
        
        // Clear all blocks
        if (this.container) {
            this.container.innerHTML = '';
        }
        
        // Reset state
        this.isActive = false;
        this.currentState = null;
    }

    // Setup container CSS properties
    setupContainer() {
        this.container.style.setProperty('--grid-row', `${this.config.row}`);
        this.container.style.setProperty('--grid-col', `${this.config.col}`);
    }

    // Generate blocks dynamically with performance optimizations
    generateBlocks(initalState = 'normal') {
        this.blocks = [];
        this.container.innerHTML = ''; // Clear existing blocks
        
        const totalBlocks = this.config.row * this.config.col;
        const fragment = document.createDocumentFragment();
        
        // Pre-calculate common values
        const opacityRange = this.config.opacityRange[1] - this.config.opacityRange[0];
        const minOpacity = this.config.opacityRange[0];
        
        // Create blocks in batches for better performance
        for (let i = 0; i < totalBlocks; i++) {
            const block = document.createElement('div');
            block.classList.add('block');
            
            // Start each block at a random point in the animation cycle
            const randomDelay = Math.random() * 10;
            block.style.animationDelay = `-${randomDelay}s`;

            if (initalState === 'ready') {
                block.classList.add('ready-state');
                block.style.setProperty('--random-opacity', '0');
            } else if (initalState === 'opaque') {
                block.classList.add('wave-opaque', 'started-opaque');
            } else {
                const randomOpacity = minOpacity + Math.random() * opacityRange;
                block.style.setProperty('--random-opacity', randomOpacity);
            }
            
            // Calculate block's position in the grid
            const row = Math.floor(i / this.config.col);
            const col = i % this.config.col;
            
            // Store block reference and position
            this.blocks.push({ element: block, row, col });
            
            // Add to fragment instead of directly to DOM
            fragment.appendChild(block);
        }
        
        // Single DOM update for all blocks
        this.container.appendChild(fragment);
    }

    // Start the block effects
    async start(initialDelay = 2000, repeatInterval = 5000, waveDirection = null, onWaveComplete = null) {
        if (!this.isActive) return;
        
        // Start random opacity adjustments
        this.startRandomOpacityAdjustments();
        
        // Start continuous wave effect with optional callback and wave direction
        this.startContinuousWave(initialDelay, repeatInterval, waveDirection, onWaveComplete);
    }
    
    // Start continuous wave effect
    async startContinuousWave(initialDelay, repeatInterval, waveDirection, onWaveComplete) {
        if (!this.isActive) return;
        
        // If any blocks started opaque, transition them to normal first
        if (this.blocks.some(block => block.element.classList.contains('started-opaque'))) {
            // Transition from opaque to normal opacity
            await this.returnToNormalOpacity();
        }

        // Wait 2 seconds before starting first wave
        await new Promise(resolve => setTimeout(resolve, initialDelay));

        while (this.isActive) {
            // Create wave and wait for completion
            await this.createOpacityWave(waveDirection);
            
            if (!this.isActive) break;
            
            // Call callback if provided (e.g., for background image rotation)
            if (onWaveComplete && typeof onWaveComplete === 'function') {
                try {
                    await onWaveComplete();
                } catch (error) {
                    console.error('Wave completion callback error:', error);
                }
            }
            
            // Wait before returning to normal
            await new Promise(resolve => setTimeout(resolve, 500));
            
            if (!this.isActive) break;
            
            // Return to normal and wait for completion
            await this.returnToNormalOpacity();
            
            if (!this.isActive) break;
            
            // Wait before next wave
            await new Promise(resolve => setTimeout(resolve, repeatInterval));
        }
    }

    // Stop all block effects with optimized cleanup
    stop() {
        this.isActive = false;
        
        // Clear all intervals
        if (this.animationInterval) {
            clearInterval(this.animationInterval);
            this.animationInterval = null;
        }
        
        if (this.waveTimeout) {
            clearTimeout(this.waveTimeout);
            this.waveTimeout = null;
        }
        
        // Clear all tracked timeouts
        this.clearAllTimeouts();
        
        // Reset performance metrics
        this.performanceMetrics.frameCount = 0;
        this.performanceMetrics.averageFrameTime = 0;
    }

    // Make all blocks opaque
    goOpaque() {
        this.blocks.forEach(block => {
            const element = block.element;
            element.classList.add('wave-opaque');
        });
    }

    // Ensure container is ready for waves
    ensureWaveReady() {
        if (!this.isActive) {
            this.isActive = true;
        }
        
        // Ensure all blocks are in a proper state for waves
        this.blocks.forEach(block => {
            const element = block.element;
            
            // Remove any problematic classes that might prevent waves
            element.classList.remove('fade-to-zero');
            
            // If block is in ready-state, ensure it can become visible
            if (element.classList.contains('ready-state')) {
                // Remove ready-state temporarily to allow wave
                element.classList.remove('ready-state');
            }
            
            // Ensure proper opacity is set
            if (!element.style.getPropertyValue('--random-opacity')) {
                const randomOpacity = this.config.opacityRange[0] + 
                    Math.random() * (this.config.opacityRange[1] - this.config.opacityRange[0]);
                element.style.setProperty('--random-opacity', randomOpacity);
            }
            
            // Resume animation for blocks that will become visible
            if (!element.classList.contains('performance-mode')) {
                element.style.animationPlayState = 'running';
            }
        });
    }

    // Optimized block group update
    updateBlockGroup(blocksInGroup) {
        const opacityRange = this.config.opacityRange[1] - this.config.opacityRange[0];
        const minOpacity = this.config.opacityRange[0];
        
        blocksInGroup.forEach((block) => {
            const element = block.element;
            
            // Remove ready-state class to allow wave-opaque to work
            element.classList.remove('ready-state');
            
            // Add wave-opaque class
            element.classList.add('wave-opaque');
            
            // Set random opacity if not already set
            const currentOpacity = element.style.getPropertyValue('--random-opacity') || 
                (minOpacity + Math.random() * opacityRange);
            element.style.setProperty('--random-opacity', currentOpacity);
            
            // Resume animation for visible blocks
            if (!element.classList.contains('performance-mode')) {
                element.style.animationPlayState = 'running';
            }
        });
    }

    // Cleanup wave effects
    cleanupWaveEffects(direction) {
        if (direction === 'in' || direction === 'out') {
            this.blocks.forEach((block) => {
                block.element.style.removeProperty('--transition-duration');
            });
        }
    }

    // Optimized timeout management
    addTimeout(timeoutId) {
        this.activeTimeouts.add(timeoutId);
    }

    clearAllTimeouts() {
        this.activeTimeouts.forEach(timeoutId => clearTimeout(timeoutId));
        this.activeTimeouts.clear();
    }

    // Animation state management for performance
    pauseAnimations() {
        this.blocks.forEach(block => {
            const element = block.element;
            if (!element.classList.contains('performance-mode')) {
                element.style.animationPlayState = 'paused';
            }
        });
    }

    resumeAnimations() {
        this.blocks.forEach(block => {
            const element = block.element;
            if (!element.classList.contains('performance-mode')) {
                element.style.animationPlayState = 'running';
            }
        });
    }

    // Smart animation management based on visibility
    updateAnimationStates() {
        this.blocks.forEach(block => {
            const element = block.element;
            
            // If block is in ready state or fade-to-zero, pause animation
            if (element.classList.contains('ready-state') || 
                element.classList.contains('fade-to-zero')) {
                if (!element.classList.contains('performance-mode')) {
                    element.style.animationPlayState = 'paused';
                }
            } else {
                // Resume animation for visible blocks
                if (!element.classList.contains('performance-mode')) {
                    element.style.animationPlayState = 'running';
                }
            }
        });
    }

    // Stop fade and randomly change opacity, then fade to 0
    async stopFade() {
        if (!this.isActive) return;
        
        // Stop the wave effect
        this.stop();
        
        // Randomly change all blocks to reversed random opacity
        this.blocks.forEach(block => {
            const element = block.element;
            const currentOpacity = parseFloat(element.style.getPropertyValue('--random-opacity')) || 0.15;
            
            // Reverse the opacity (make dark blocks light, light blocks dark)
            const reversedOpacity = this.config.opacityRange[1] - (currentOpacity - this.config.opacityRange[0]);
            element.style.setProperty('--random-opacity', reversedOpacity);
            
            // Remove wave classes
            element.classList.remove('wave-opaque', 'wave-normal');
        });
        
        // After 1 second, start fading all blocks to 0
        await new Promise(resolve => setTimeout(resolve, 1000));
        await this.fadeAllToZero();
    }

    // Randomly transition each block to 0 opacity and once complete stop the animations
    async fadeAllToZero() {
        if (!this.isActive) return;
        
        return new Promise((resolve) => {
            const fadeDuration = 2000; // 2 seconds total
            const fadeInterval = 50; // Update every 50ms
            const steps = fadeDuration / fadeInterval;
            let currentStep = 0;
            
            const fadeTimer = setInterval(() => {
                currentStep++;
                const progress = currentStep / steps;
                
                this.blocks.forEach(block => {
                    const element = block.element;
                    const currentOpacity = parseFloat(element.style.getPropertyValue('--random-opacity')) || 0.15;
                    const newOpacity = currentOpacity * (1 - progress);
                    element.style.setProperty('--random-opacity', newOpacity);
                });
                
                if (currentStep >= steps) {
                    clearInterval(fadeTimer);
                    this.disableContainer();
                    resolve();
                }
            }, fadeInterval);
        });
    }

    // Disable the entire container
    disableContainer() {
        this.container.classList.add('hidden');
        this.isActive = false;
    }

    // Create opacity wave effect and return when all have transitioned
    async createOpacityWave(direction = 'diagonal') {
        if (!this.isActive) {
            console.warn('BlockContainer is not active, cannot create wave');
            return;
        }
        
        return new Promise((resolve) => {
            // Calculate wave delay based on grid size
            const waveDelay = Math.max(30, Math.min(120, this.config.col * 2));
            
            let completedBlocks = 0;
            const totalBlocks = this.blocks.length;
            
            // Group blocks based on wave direction
            const waveGroups = new Map();
            
            this.blocks.forEach((block) => {
                let groupIndex;
                
                switch (direction) {
                    case 'rand':
                        // Random grouping for chaotic wave effect
                        groupIndex = Math.floor(Math.random() * 8); // 8 random groups
                        break;
                    case 'diagonal':
                        // Diagonal from top-left to bottom-right
                        groupIndex = block.row + block.col;
                        break;
                    case 'left':
                        // Left to right
                        groupIndex = block.col;
                        break;
                    case 'right':
                        // Right to left
                        groupIndex = (this.config.col - 1) - block.col;
                        break;
                    case 'up':
                        // Bottom to top
                        groupIndex = (this.config.row - 1) - block.row;
                        break;
                    case 'down':
                        // Top to bottom
                        groupIndex = block.row;
                        break;
                    case 'out':
                        // Outer edges to center
                        const centerRow = Math.floor(this.config.row / 2);
                        const centerCol = Math.floor(this.config.col / 2);
                        const distanceFromCenter = Math.max(
                            Math.abs(block.row - centerRow),
                            Math.abs(block.col - centerCol)
                        );
                        groupIndex = distanceFromCenter;
                        
                        // Set dynamic transition duration for 'out' direction
                        // Inner blocks (closer to center) have slower transitions
                        const maxDistance = Math.max(centerRow, centerCol);
                        const distanceRatio = distanceFromCenter / maxDistance;
                        const transitionDuration = 0.1 + (distanceRatio * 0.9); // 0.1s to 1.0s
                        block.element.style.setProperty('--transition-duration', `${transitionDuration}s`);
                        break;
                    case 'in':
                        // Center to outer edges
                        const centerRow2 = Math.floor(this.config.row / 2);
                        const centerCol2 = Math.floor(this.config.col / 2);
                        const maxDistance2 = Math.max(centerRow2, centerCol2);
                        const distanceFromCenter2 = Math.max(
                            Math.abs(block.row - centerRow2),
                            Math.abs(block.col - centerCol2)
                        );
                        groupIndex = maxDistance2 - distanceFromCenter2;
                        
                        // Set dynamic transition duration for 'in' direction
                        // Inner blocks (closer to center) have slower transitions
                        const distanceRatio2 = distanceFromCenter2 / maxDistance2;
                        const transitionDuration2 = 0.1 + (distanceRatio2 * 0.9); // 0.1s to 1.0s
                        block.element.style.setProperty('--transition-duration', `${transitionDuration2}s`);
                        break;
                    default:
                        // Default to diagonal
                        groupIndex = block.row + block.col;
                }
                
                if (!waveGroups.has(groupIndex)) {
                    waveGroups.set(groupIndex, []);
                }
                waveGroups.get(groupIndex).push(block);
            });
            
            // Process wave groups in order
            const sortedGroups = Array.from(waveGroups.keys()).sort((a, b) => a - b);
            
            // Process groups in batches for better performance
            const processGroupBatch = (startIndex) => {
                const endIndex = Math.min(startIndex + this.config.batchSize, sortedGroups.length);
                
                for (let i = startIndex; i < endIndex; i++) {
                    const groupIndex = sortedGroups[i];
                    const blocksInGroup = waveGroups.get(groupIndex);
                    
                    // Calculate dynamic delay based on group index and total groups
                    const totalGroups = sortedGroups.length;
                    const progressRatio = groupIndex / totalGroups;
                    
                    // Use exponential curve to slow down later groups
                    const slowDownFactor = Math.pow(progressRatio, 5.5);
                    const baseDelay = groupIndex * waveDelay;
                    const dynamicDelay = baseDelay + (slowDownFactor * waveDelay * 2);
                    
                    const timeoutId = setTimeout(() => {
                        if (!this.isActive) {
                            completedBlocks += blocksInGroup.length;
                            if (completedBlocks === totalBlocks) resolve();
                            return;
                        }
                        
                        // Use requestAnimationFrame for smooth updates
                        if (this.config.useRequestAnimationFrame) {
                            requestAnimationFrame(() => {
                                this.updateBlockGroup(blocksInGroup);
                                completedBlocks += blocksInGroup.length;
                                if (completedBlocks === totalBlocks) {
                                    this.cleanupWaveEffects(direction);
                                    resolve();
                                }
                            });
                        } else {
                            this.updateBlockGroup(blocksInGroup);
                            completedBlocks += blocksInGroup.length;
                            if (completedBlocks === totalBlocks) {
                                this.cleanupWaveEffects(direction);
                                resolve();
                            }
                        }
                    }, dynamicDelay);
                    
                    // Track timeout for cleanup
                    this.addTimeout(timeoutId);
                }
                
                // Process next batch if available
                if (endIndex < sortedGroups.length) {
                    requestAnimationFrame(() => processGroupBatch(endIndex));
                }
            };
            
            // Start processing batches
            processGroupBatch(0);
        });
    }

    // Return to normal effect and return when completed
    async returnToNormalOpacity(fadeToZero = false) {
        if (!this.isActive) return;
        
        return new Promise((resolve) => {
            const baseResetDuration = 3500;
            const totalBlocks = this.blocks.length;
            let completedBlocks = 0;
            
            this.blocks.forEach((block, index) => {
                const element = block.element;
                
                // Calculate dynamic delay window based on block index
                // Earlier blocks (lower index) return faster, later blocks return slower
                const progressRatio = index / totalBlocks; // 0 to 1
                // Use logarithmic progression for more natural feel
                const logProgress = Math.log(1 + progressRatio * 10) / Math.log(10); // 0 to 1, logarithmic
                // Make last few blocks return much slower with exponential curve
                const slowTailEffect = Math.pow(progressRatio, 2.5); // Creates steeper curve for later blocks
                const dynamicMinDelay = baseResetDuration * 0.15 * logProgress; // 0 to 525ms, logarithmic
                const dynamicMaxDelay = baseResetDuration * (0.3 + 0.7 * slowTailEffect); // 1050ms to 3500ms, exponential tail
                const randomDelay = Math.random() * (dynamicMaxDelay - dynamicMinDelay) + dynamicMinDelay;
                
                setTimeout(() => {
                    if (this.isActive) {
                        element.classList.remove('wave-opaque');
                        
                        // ALWAYS return to random opacity regardless of starting state
                        const randomOpacity = this.config.opacityRange[0] + 
                            Math.random() * (this.config.opacityRange[1] - this.config.opacityRange[0]);
                        element.style.setProperty('--random-opacity', randomOpacity);
                        
                        // Remove any starting state classes
                        element.classList.remove('started-opaque', 'ready-state');
                        
                        // Resume animation for visible blocks
                        if (!element.classList.contains('performance-mode')) {
                            element.style.animationPlayState = 'running';
                        }
                        
                        if (fadeToZero) {
                            // Wait 1 second before starting fade to zero
                            setTimeout(() => {
                                if (this.isActive) {
                                    element.classList.add('fade-to-zero');
                                    // Pause animation during fade
                                    if (!element.classList.contains('performance-mode')) {
                                        element.style.animationPlayState = 'paused';
                                    }
                                    // After fade completes, add ready-state class and ensure interactivity
                                    setTimeout(() => {
                                        if (this.isActive) {
                                            element.classList.add('ready-state');
                                            // Ensure the block is interactive by setting proper opacity
                                            element.style.setProperty('--random-opacity', '0');
                                            // Remove any transition durations that might interfere
                                            element.style.removeProperty('--transition-duration');
                                        }
                                    }, 800); // CSS transition duration
                                }
                            }, 1000);
                        }
                    }
                    
                    completedBlocks++;
                    if (completedBlocks === totalBlocks) {
                        resolve();
                    }
                }, randomDelay);
            });
        });
    }

    // Start random opacity adjustments
    startRandomOpacityAdjustments() {
        this.animationInterval = setInterval(() => {
            if (!this.isActive) return;
            
            // Randomly select 5-10 blocks to adjust opacity
            const numBlocks = 5 + Math.floor(Math.random() * 6);
            const shuffled = [...this.blocks].sort(() => 0.5 - Math.random());
            
            for (let i = 0; i < numBlocks; i++) {
                const block = shuffled[i];
                const element = block.element;
                
                // Only adjust opacity if not currently in wave effect
                if (!element.classList.contains('wave-opaque') && !element.classList.contains('wave-normal')) {
                    const randomOpacity = this.config.opacityRange[0] + 
                        Math.random() * (this.config.opacityRange[1] - this.config.opacityRange[0]);
                    element.style.setProperty('--random-opacity', randomOpacity);
                    
                    // If block started opaque, remove the class after first adjustment
                    if (element.classList.contains('started-opaque')) {
                        element.classList.remove('started-opaque');
                    }
                }
            }
        }, this.config.randomAdjustInterval);
    }

    // Update configuration
    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
        
        if (this.isActive) {
            this.stop();
            this.init();
            this.start();
        }
    }

    // Get current status
    getStatus() {
        return {
            isActive: this.isActive,
            blockCount: this.blocks.length,
            config: { ...this.config },
            performance: { ...this.performanceMetrics }
        };
    }

    // Performance monitoring and optimization
    updatePerformanceMetrics() {
        const now = performance.now();
        if (this.performanceMetrics.lastFrameTime > 0) {
            const frameTime = now - this.performanceMetrics.lastFrameTime;
            this.performanceMetrics.frameCount++;
            this.performanceMetrics.averageFrameTime = 
                (this.performanceMetrics.averageFrameTime * (this.performanceMetrics.frameCount - 1) + frameTime) / 
                this.performanceMetrics.averageFrameTime;
            
            // Auto-adjust batch size based on performance
            if (this.performanceMetrics.averageFrameTime > 16.67) { // 60fps threshold
                this.config.batchSize = Math.max(10, this.config.batchSize - 5);
                
                // If performance is consistently poor, consider enabling performance mode
                if (this.performanceMetrics.frameCount > 100 && this.performanceMetrics.averageFrameTime > 33.33) {
                    this.enablePerformanceMode();
                }
            } else if (this.performanceMetrics.averageFrameTime < 8.33) { // 120fps threshold
                this.config.batchSize = Math.min(100, this.config.batchSize + 5);
            }
        }
        this.performanceMetrics.lastFrameTime = now;
    }

    // Enable performance mode for maximum performance
    enablePerformanceMode() {
        this.blocks.forEach(block => {
            const element = block.element;
            element.classList.add('performance-mode');
            element.style.animationPlayState = 'paused';
        });
        
        console.log('BlockContainer: Performance mode enabled for better performance');
    }

    // Disable performance mode to restore animations
    disablePerformanceMode() {
        this.blocks.forEach(block => {
            const element = block.element;
            element.classList.remove('performance-mode');
            element.style.animationPlayState = 'running';
        });
        
        console.log('BlockContainer: Performance mode disabled, animations restored');
    }

    // Optimize for high block counts
    optimizeForHighBlockCount() {
        const totalBlocks = this.config.row * this.config.col;
        
        if (totalBlocks > 1000) {
            // For very high block counts, use more aggressive optimizations
            this.config.batchSize = Math.min(25, this.config.batchSize);
            this.config.useRequestAnimationFrame = true;
            
            // Completely disable color animations for maximum performance
            this.blocks.forEach(block => {
                const element = block.element;
                element.classList.add('performance-mode');
                element.style.willChange = 'opacity';
                element.style.contain = 'layout style paint';
            });
        } else if (totalBlocks > 500) {
            // For high block counts, use moderate optimizations
            this.config.batchSize = Math.min(50, this.config.batchSize);
            this.config.useRequestAnimationFrame = true;
            
            // Pause animations when blocks are not visible
            this.blocks.forEach(block => {
                const element = block.element;
                if (element.classList.contains('ready-state')) {
                    element.style.animationPlayState = 'paused';
                }
            });
        }
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = BlockContainer;
}
