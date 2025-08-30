// Example usage of BlockContainer module
// This shows how to integrate the block container into other applications

// Example 1: Basic usage
const basicBlockContainer = new BlockContainer('.block-container', {
    row: 15,
    col: 15,
    opacityRange: [0.1, 0.4]
});

// Initialize and start
basicBlockContainer.init();
basicBlockContainer.start();

// Example 1c: Start with all blocks opaque
const opaqueBlockContainer = new BlockContainer('.opaque-blocks', {
    row: 15,
    col: 15,
    opacityRange: [0.1, 0.4]
});

opaqueBlockContainer.init(true); // Start fully opaque
opaqueBlockContainer.start();

// Example 1b: With wave completion callback
const callbackBlockContainer = new BlockContainer('.callback-blocks', {
    row: 15,
    col: 15,
    opacityRange: [0.1, 0.4]
});

callbackBlockContainer.init();
callbackBlockContainer.start(() => {
    console.log('Wave completed! Time to rotate background...');
    // Your custom logic here
});

// Example 1c: Different wave directions
const diagonalContainer = new BlockContainer('.diagonal-blocks');
diagonalContainer.init();
diagonalContainer.start(2000, 5000, null, 'diagonal'); // Default diagonal

const leftToRightContainer = new BlockContainer('.left-right-blocks');
leftToRightContainer.init();
leftToRightContainer.start(2000, 5000, null, 'left'); // Left to right

const outInContainer = new BlockContainer('.out-in-blocks');
outInContainer.init();
outInContainer.start(2000, 5000, null, 'out'); // Outer edges to center

const randomContainer = new BlockContainer('.random-blocks');
randomContainer.init();
randomContainer.start(2000, 5000, null, 'rand'); // Random chaotic waves

// Example 2: Advanced usage with custom configuration
const advancedBlockContainer = new BlockContainer('.advanced-blocks', {
    row: 25,
    col: 25,
    opacityRange: [0.05, 0.25],
    waveDelay: 50,
    randomAdjustInterval: 3000
});

// Example 3: Control methods with async/await
async function controlBlockContainer() {
    const container = new BlockContainer('.my-blocks');
    
    // Initialize
    container.init();
    
    // Start the effects
    await container.start();
    
    // Make all blocks opaque
    container.goOpaque();
    
    // Stop fade and fade to 0 (async)
    await container.stopFade();
    
    // Stop all effects
    container.stop();
    
    // Get current status
    const status = container.getStatus();
    console.log('Block container status:', status);
    
    // Update configuration
    container.updateConfig({
        row: 30,
        col: 30,
        opacityRange: [0.1, 0.3]
    });
}

// Example 4: Event-driven usage
function createEventDrivenBlocks() {
    const container = new BlockContainer('.event-blocks');
    container.init();
    
    // Start on user interaction
    document.addEventListener('click', () => {
        if (!container.getStatus().isActive) {
            container.start();
        }
    });
    
    // Stop fade on specific event
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            container.stopFade();
        }
    });
    
    // Stop on page unload
    window.addEventListener('beforeunload', () => {
        container.stop();
    });
}

// Example 5: Multiple containers
function createMultipleContainers() {
    const containers = [
        new BlockContainer('.blocks-1', { row: 10, col: 10 }),
        new BlockContainer('.blocks-2', { row: 20, col: 20 }),
        new BlockContainer('.blocks-3', { row: 15, col: 15 })
    ];
    
    // Initialize all
    containers.forEach(container => {
        container.init();
        container.start();
    });
    
    // Control all at once
    function stopAllContainers() {
        containers.forEach(container => container.stop());
    }
    
    function startAllContainers() {
        containers.forEach(container => container.start());
    }
    
    function fadeAllContainers() {
        containers.forEach(container => container.stopFade());
    }
}

// Example 6: Integration with existing app
class MyApp {
    constructor() {
        this.blockContainer = new BlockContainer('.app-blocks', {
            row: 20,
            col: 20,
            opacityRange: [0.05, 0.3]
        });
        
        this.init();
    }
    
    async init() {
        // Initialize block container
        this.blockContainer.init();
        
        // Start when app is ready (async) with wave completion callback
        await this.blockContainer.start(() => {
            // This function is called every time a wave completes
            this.onWaveComplete();
        });
        
        // Set up app-specific controls
        this.setupControls();
    }
    
    onWaveComplete() {
        // Handle wave completion (e.g., rotate background, update UI, etc.)
        console.log('Wave effect completed');
        // Add your custom logic here
    }
    
    setupControls() {
        // Example: Stop blocks when user is inactive
        let inactivityTimer;
        
        const resetInactivityTimer = () => {
            clearTimeout(inactivityTimer);
            inactivityTimer = setTimeout(() => {
                this.blockContainer.stopFade();
            }, 30000); // 30 seconds
        };
        
        // Reset timer on user activity
        ['mousemove', 'keydown', 'click', 'touchstart'].forEach(event => {
            document.addEventListener(event, resetInactivityTimer);
        });
        
        resetInactivityTimer();
    }
    
    // App-specific methods
    showLoadingState() {
        this.blockContainer.goOpaque();
    }
    
    async hideLoadingState() {
        await this.blockContainer.stopFade();
    }
    
    cleanup() {
        this.blockContainer.stop();
    }
}

// Example 7: Different initialization patterns
function createDifferentInitializations() {
    // Start with random opacity (default)
    const randomContainer = new BlockContainer('.random-blocks');
    randomContainer.init(); // or randomContainer.init('normal')
    
    // Start with all blocks opaque
    const opaqueContainer = new BlockContainer('.opaque-blocks');
    opaqueContainer.init('opaque');
    
    // Start with ready state (0 opacity)
    const readyContainer = new BlockContainer('.ready-blocks');
    readyContainer.init('ready');
}

// Example 8: Ready State Pattern
class ReadyStateApp {
    constructor() {
        this.blockContainer = new BlockContainer('.ready-blocks', {
            row: 15,
            col: 15,
            opacityRange: [0.1, 0.4]
        });
        
        this.init();
    }
    
    async init() {
        // Initialize in ready state (all blocks at 0 opacity)
        this.blockContainer.init('ready');
        
        // Set up event handlers
        this.setupEventHandlers();
    }
    
    async setupEventHandlers() {
        // Start wave on user interaction
        document.addEventListener('click', async () => {
            if (this.blockContainer.getStatus().isActive) return;
            
            // Start continuous wave
            await this.blockContainer.startContinuousWave(1000, 3000, 'diagonal');
            
            // Do some task after wave completes
            await this.performTask();
            
            // Return to ready state (fade to zero)
            await this.blockContainer.returnToNormalOpacity(true);
            
            // Call completion function
            this.onReadyStateComplete();
        });
    }
    
    async performTask() {
        // Simulate some task
        console.log('Performing task...');
        await new Promise(resolve => setTimeout(resolve, 2000));
        console.log('Task completed!');
    }
    
    onReadyStateComplete() {
        console.log('Returned to ready state!');
        // Handle ready state completion
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        BlockContainer,
        MyApp,
        controlBlockContainer,
        createEventDrivenBlocks,
        createMultipleContainers
    };
}
