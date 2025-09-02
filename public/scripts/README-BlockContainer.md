# BlockContainer Module

A reusable JavaScript module for creating animated block grid effects with opacity waves and color transitions.

## Features

- **Dynamic Grid Generation**: Creates blocks dynamically based on row/column configuration
- **Opacity Wave Effects**: Animated waves that sweep across the grid
- **Random Opacity Adjustments**: Continuous subtle opacity changes for visual interest
- **Color Animation**: Blocks cycle through a predefined color palette
- **Responsive Design**: Adapts to different screen sizes
- **Performance Optimized**: Uses CSS transforms and will-change for smooth animations

## Installation

1. Include the CSS file:
```html
<link rel="stylesheet" href="/css/blockContainer.css">
```

2. Include the JavaScript file:
```html
<script src="/scripts/blockContainer.js"></script>
```

3. Add a container element to your HTML:
```html
<div class="block-container">
    <!-- Blocks will be generated here -->
</div>
```

## Basic Usage

```javascript
// Create a new block container
const blockContainer = new BlockContainer('.block-container', {
    row: 20,
    col: 20,
    opacityRange: [0.05, 0.3]
});

// Initialize and start (default: random opacity)
blockContainer.init();
blockContainer.start();

// Initialize with all blocks opaque
blockContainer.init(true);

// With wave completion callback
blockContainer.start(() => {
    console.log('Wave completed! Time to rotate background...');
    rotateBackgroundImage();
});

// Different wave directions
blockContainer.start(2000, 5000, null, 'diagonal');  // Default diagonal
blockContainer.start(2000, 5000, null, 'left');      // Left to right
blockContainer.start(2000, 5000, null, 'right');     // Right to left
blockContainer.start(2000, 5000, null, 'up');        // Bottom to top
blockContainer.start(2000, 5000, null, 'down');      // Top to bottom
blockContainer.start(2000, 5000, null, 'outin');     // Outer edges to center
blockContainer.start(2000, 5000, null, 'inout');     // Center to outer edges
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `row` | number | 20 | Number of rows in the grid |
| `col` | number | 20 | Number of columns in the grid |
| `opacityRange` | array | [0.05, 0.3] | Min/max opacity values for blocks |
| `waveDelay` | number | 30 | Delay between wave steps (ms) |
| `randomAdjustInterval` | number | 2000 | Interval for random opacity adjustments (ms) |

## Methods

### Core Methods

- **`init(startOpaque?)`: Initialize the block container and generate blocks (optional: start fully opaque)
- **`start(initialDelay?, repeatInterval?, onWaveComplete?, waveDirection?)`: Start all animation effects (async, optional callback and wave direction)
- **`stop()`**: Stop all animation effects
- **`goOpaque()`**: Make all blocks fully opaque
- **`stopFade()`**: Stop current effects, reverse opacity, then fade to 0 (async)
- **`disableContainer()`**: Hide the entire container

### Async Methods

- **`createOpacityWave(direction?)`: Create the wave and return when all have transitioned (async, optional direction)
- **`returnToNormalOpacity(fadeToZero = false)`: Return to normal effect and return when completed (async, optional fade to zero)
- **`fadeAllToZero()`**: Randomly transition each block to 0 opacity and once complete stop the animations (async)

### Wave Directions

- **`diagonal`** (default): Wave from top-left to bottom-right
- **`left`**: Wave from left to right
- **`right`**: Wave from right to left  
- **`up`**: Wave from bottom to top
- **`down`**: Wave from top to bottom
- **`out`**: Wave from outer edges to center
- **`in`**: Wave from center to outer edges
- **`rand`**: Random grouping for chaotic, unpredictable wave effects

### Callback System

- **`start(onWaveComplete?)`**: Accepts an optional callback function that is called every time a wave completes
- **`onWaveComplete`**: Function called after each wave effect completes (useful for background rotation, UI updates, etc.)

### Initialization Options

- **`init(initialState = 'normal')`**: 
  - `'normal'` (default): Start with random opacity for each block
  - `'opaque'`: Start with all blocks fully opaque (treats as post-wave state)
  - `'ready'`: Start with all blocks at 0 opacity (ready state)
- **`'opaque'` behavior**:
  - Each block gets `started-opaque` class
  - All blocks start with `opacity: 1` and `wave-opaque` class
  - Blocks are treated as if they just completed a wave effect
  - Each block transitions individually to random opacity
  - Block classes are removed after transition
- **`'ready'` behavior**:
  - Each block gets `ready-state` class
  - All blocks start with `opacity: 0`
  - Blocks are in a dormant, ready state
  - Perfect for on-demand wave effects

### Utility Methods

- **`updateConfig(newConfig)`**: Update configuration and restart if active
- **`getStatus()`**: Get current status and configuration

## Advanced Usage Examples

### Event-Driven Control

```javascript
const container = new BlockContainer('.blocks');
container.init();

// Start on user interaction
document.addEventListener('click', () => {
    if (!container.getStatus().isActive) {
        container.start();
    }
});

// Stop fade on escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        container.stopFade();
    }
});
```

### Multiple Containers

```javascript
const containers = [
    new BlockContainer('.blocks-1', { row: 10, col: 10 }),
    new BlockContainer('.blocks-2', { row: 20, col: 20 })
];

containers.forEach(container => {
    container.init();
    container.start();
});

// Control all at once
function stopAll() {
    containers.forEach(container => container.stop());
}
```

### Integration with Existing App

```javascript
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
        
        // Start when app is ready (async)
        await this.blockContainer.start();
        
        // Set up app-specific controls
        this.setupControls();
    }
    
    setupControls() {
        // Example: Stop blocks when user is inactive
        let inactivityTimer;
        
        const resetInactivityTimer = () => {
            clearTimeout(inactivityTimer);
            inactivityTimer = setTimeout(async () => {
                await this.blockContainer.stopFade();
            }, 30000); // 30 seconds
        };
        
        // Reset timer on user activity
        ['mousemove', 'keydown', 'click', 'touchstart'].forEach(event => {
            document.addEventListener(event, resetInactivityTimer);
        });
        
        resetInactivityTimer();
    }
    
    // App-specific methods
    showLoading() {
        this.blockContainer.goOpaque();
    }
    
    async hideLoading() {
        await this.blockContainer.stopFade();
    }
    
    cleanup() {
        this.blockContainer.stop();
    }
}

### Ready State Pattern

```javascript
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
        this.blockContainer.init(false, true); // readyState = true
        
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
```
```

### Async Usage Patterns

```javascript
// Wait for wave to complete before doing something else
async function waitForWave() {
    const container = new BlockContainer('.blocks');
    container.init();
    
    // Wait for wave to complete
    await container.createOpacityWave();
    console.log('Wave completed!');
    
    // Now do something else
    await container.returnToNormalOpacity();
    console.log('Returned to normal!');
}

// Sequential operations
async function sequentialOperations() {
    const container = new BlockContainer('.blocks');
    container.init();
    
    try {
        // Start the container
        await container.start();
        
        // Wait for user interaction
        await waitForUserClick();
        
        // Stop and fade out
        await container.stopFade();
        
        console.log('All operations completed');
    } catch (error) {
        console.error('Operation failed:', error);
    }
}

// Parallel operations with multiple containers
async function parallelOperations() {
    const containers = [
        new BlockContainer('.blocks-1'),
        new BlockContainer('.blocks-2'),
        new BlockContainer('.blocks-3')
    ];
    
    // Initialize all
    containers.forEach(container => container.init());
    
    // Start all simultaneously
    const startPromises = containers.map(container => container.start());
    await Promise.all(startPromises);
    
    // Stop all simultaneously
    const stopPromises = containers.map(container => container.stopFade());
    await Promise.all(stopPromises);
}
```

## CSS Classes

The module automatically applies these CSS classes:

- **`.block-container`**: Main grid container
- **`.block`**: Individual block elements
- **`.block.started-opaque`**: Individual block state when starting fully opaque
- **`.wave-opaque`**: Applied during wave effects
- **`.wave-normal`**: Applied during normal state

## Performance Considerations

- Uses CSS Grid for efficient layout
- Implements `will-change` for smooth animations
- Limits random opacity adjustments to 5-10 blocks at a time
- Configurable intervals to balance performance and visual appeal

## Browser Support

- Modern browsers with CSS Grid support
- CSS Custom Properties (CSS Variables)
- CSS Animations and Transitions

## Troubleshooting

### Blocks not appearing
- Ensure the container selector is correct
- Check that the CSS file is loaded
- Verify the container element exists in the DOM

### Performance issues
- Reduce grid size (row/col values)
- Increase `randomAdjustInterval`
- Reduce `waveDelay` for faster waves

### Animation not starting
- Call `init()` before `start()`
- Check browser console for errors
- Verify the module is loaded

## License

This module is part of the Dreamscape application and follows the same licensing terms.
