# Desktop Shortcut Positioning System

## Overview
The desktop uses a hybrid positioning system that combines auto-arranged grid layout with freeform placement in quadrants. This ensures shortcuts maintain their relative positions across different screen sizes while providing flexibility for custom layouts.

## Position Structure

Each shortcut has a `position` object with one of two formats:

### Grid Mode (Index 0)
```javascript
{
    index: 0,
    pos: 0  // Position in auto-arranged grid (0, 1, 2, 3...)
}
```
- Auto-arranged in a grid from top-left
- Default for new shortcuts
- Like Windows/macOS auto-arrange
- Position is just the order in the stack

### Freeform Mode (Indexes 1-4)
```javascript
{
    index: 1-4,  // Quadrant number
    x: 0.5,      // Percentage (0.0-1.0) from left edge of quadrant
    y: 0.3       // Percentage (0.0-1.0) from top edge of quadrant
}
```

## Quadrants

The desktop is divided into 4 quadrants:

```
┌─────────────┬─────────────┐
│     1       │      2      │
│  Top-Left   │  Top-Right  │
├─────────────┼─────────────┤
│     3       │      4      │
│ Bottom-Left │Bottom-Right │
└─────────────┴─────────────┘
```

- **Index 1**: Top-Left Quadrant
- **Index 2**: Top-Right Quadrant  
- **Index 3**: Bottom-Left Quadrant
- **Index 4**: Bottom-Right Quadrant
- **Index 0**: Auto-Grid (overlays top-left area)

## Grid Layout (Index 0)

- Located in top-left corner
- Auto-wrapping grid
- Icons arranged by `pos` value (0, 1, 2, 3...)
- Grid size: 100px spacing
- Padding: 20px from edges
- Visual indicator: Blue border highlight

**Grid Calculation:**
```javascript
const cols = Math.floor((containerWidth - padding * 2) / gridSize);
const row = Math.floor(pos / cols);
const col = pos % cols;
const x = padding + (col * gridSize);
const y = padding + (row * gridSize);
```

## Responsive Positioning

### Why Percentages?
Browser window size constantly changes. Using percentages ensures:
- Icons stay in the same relative position
- Layouts adapt to screen size
- Quadrant positions remain consistent

### Pixel Conversion

**Quadrant to Pixels:**
```javascript
// Determine quadrant boundaries
baseX, baseY = quadrant top-left corner
maxX, maxY = quadrant bottom-right corner

// Convert percentage to pixels
pixelX = baseX + (maxX - baseX) * xPercent
pixelY = baseY + (maxY - baseY) * yPercent
```

**Pixels to Quadrant:**
```javascript
// Determine which quadrant
if (x < halfWidth && y < halfHeight) → Quadrant 1
if (x >= halfWidth && y < halfHeight) → Quadrant 2
if (x < halfWidth && y >= halfHeight) → Quadrant 3
if (x >= halfWidth && y >= halfHeight) → Quadrant 4

// Convert to percentage within quadrant
xPercent = (pixelX - baseX) / (maxX - baseX)
yPercent = (pixelY - baseY) / (maxY - baseY)
```

## Collision Detection

### Problem
Icons may overlap due to:
- Different screen sizes
- Multiple icons in same quadrant
- Auto-arranged grid filling up

### Solution: Temporary Display Offsets

```javascript
collisionOffsets.set(shortcutId, { x: offsetX, y: offsetY })
```

**Key Principles:**
1. **Never modify actual position** - Preserves intended layout
2. **Apply offset only for display** - Temporary visual adjustment
3. **Recalculate on render** - Adapts to screen size
4. **Push-away algorithm** - Detects overlap and nudges icons apart

**Collision Algorithm:**
```javascript
for (each other shortcut) {
    calculate distance between icons
    if (distance < iconSize) {
        // Collision detected
        calculate push angle
        calculate push distance = iconSize - distance
        offset.x += cos(angle) * pushDistance
        offset.y += sin(angle) * pushDistance
    }
}
```

**Display Position:**
```javascript
displayX = basePixelX + collisionOffset.x
displayY = basePixelY + collisionOffset.y
```

## Drag and Drop

### Drop Zones
Visual indicators shown during drag:
- **Grid Zone** - Top-left area, shows grid icon
- **Quadrant 1-4** - Four corners, show arrow icons
- **Active Highlight** - Highlighted when hovering

### Snap Threshold
- **snapThreshold**: 50 pixels
- When within threshold of grid area → snaps to grid
- Otherwise → places in quadrant with percentage position

### Drag Flow
1. **Drag Start** - Show drop zone overlay
2. **Drag Move** - Highlight current zone, update position
3. **Drag End** - Hide overlay, calculate final position data
4. **Save** - Debounced save to server (30 seconds)

### Grid Snapping
```javascript
if (x < gridWidth + snapThreshold && y < gridHeight + snapThreshold) {
    // Snap to grid
    position = { index: 0, pos: calculatedGridPos }
} else {
    // Place in quadrant
    position = { index: quadrant, x: xPercent, y: yPercent }
}
```

## Adding New Shortcuts

**Default Behavior:**
```javascript
const newPosition = {
    index: 0,
    pos: nextAvailableGridPosition
};
```

New shortcuts always go to the grid by default, appended to the end.

## Data Flow

### On Load
1. Get shortcuts from server
2. For each shortcut:
   - Calculate pixel position from position data
   - Check for collisions
   - Calculate display offset if needed
   - Render with offset applied

### On Resize
1. Window size changes
2. Shortcuts re-render (triggered by CSS or resize event)
3. Percentages recalculated to new pixel values
4. Collisions recalculated
5. Offsets recalculated

### On Drag
1. User drags shortcut
2. Drop zones shown
3. Current zone highlighted
4. Drop location determined
5. Convert to position data (index + pos/percentages)
6. Update local shortcut
7. Re-render all (recalculate collisions)
8. Debounce save to server

## Examples

### Grid Icon (Auto-arranged)
```json
{
    "id": "abc-123",
    "name": "My Image",
    "type": "image",
    "position": {
        "index": 0,
        "pos": 5
    }
}
```
- 6th icon in grid (0-indexed)
- Auto-positioned at grid slot 5

### Freeform Icon (Bottom-Right, 30% from left, 70% from top)
```json
{
    "id": "def-456",
    "name": "Important Image",
    "type": "image",
    "position": {
        "index": 4,
        "x": 0.3,
        "y": 0.7
    }
}
```
- Bottom-right quadrant
- 30% across quadrant width
- 70% down quadrant height

## Implementation Details

### Constants
```javascript
gridSize: 100,        // pixels between grid items
gridPadding: 20,      // padding from edges
snapThreshold: 50,    // pixels to trigger grid snap
iconSize: 80          // for collision detection
```

### Key Methods

**`calculatePixelPosition(shortcut)`** - Convert position data → pixels
**`calculateGridPosition(pos)`** - Grid index → pixels
**`calculateQuadrantPosition(index, x, y)`** - Quadrant data → pixels
**`pixelToPositionData(x, y)`** - Pixels → position data
**`calculateCollisionOffset(shortcut, pixelPos)`** - Detect collisions → offset
**`highlightDropZone(x, y)`** - Show active drop zone

### Collision Offset Storage
```javascript
collisionOffsets = new Map()
// shortcutId -> { x: offsetX, y: offsetY }
```
- Cleared on render
- Recalculated for each shortcut
- Applied only for display
- Never saved to server

## Benefits

✅ **Responsive** - Adapts to any screen size
✅ **Predictable** - Icons stay in their relative positions
✅ **Flexible** - Grid for organization, freeform for custom layout
✅ **No Overlaps** - Automatic collision detection
✅ **Non-Destructive** - Original positions preserved
✅ **Visual Feedback** - Drop zones show where icon will go
✅ **Familiar** - Works like traditional desktop icons

## Future Enhancements

- [ ] Sort grid icons (by name, date, type)
- [ ] Multi-select and group drag
- [ ] Custom grid sizes per quadrant
- [ ] Icon size options
- [ ] Alignment helpers (snap to grid in quadrants)
- [ ] Export/import layouts
- [ ] Per-monitor layouts

