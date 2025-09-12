# Context Menu Controller

A customizable context menu system that supports desktop right-click and touch long-press interactions.

## Features

- **Desktop Support**: Right-click to open context menu
- **Touch Support**: Long-press (500ms) to open context menu on touch devices
- **Multiple Section Types**: List items, icon buttons, and custom HTML content
- **Keyboard Navigation**: Full keyboard support with arrow keys and Enter
- **Dynamic Positioning**: Automatically positions menu to stay within viewport
- **Glass Morphism Design**: Matches the existing UI design system
- **Accessibility**: ARIA attributes and keyboard navigation support

## Usage

### Basic Setup

The context menu is automatically initialized when the page loads. You can attach it to any element by adding a `data-context-menu` attribute with a JSON configuration.

### Configuration Structure

```javascript
const menuConfig = {
    sections: [
        {
            type: 'list',           // Section type: 'list', 'icons', or 'custom'
            title: 'Actions',       // Optional section title
            items: [                // For 'list' type
                {
                    icon: 'fas fa-copy',     // FontAwesome icon class
                    text: 'Copy',            // Display text
                    action: 'copy',          // Action identifier
                    disabled: false          // Optional disabled state
                },
                { separator: true },         // Add separator line
                {
                    icon: 'fas fa-trash',
                    text: 'Delete',
                    action: 'delete'
                }
            ]
        },
        {
            type: 'icons',          // Icon button section
            title: 'Quick Actions',
            icons: [
                {
                    icon: 'fas fa-star',     // Icon class
                    tooltip: 'Favorite',     // Tooltip text
                    action: 'favorite'       // Action identifier
                },
                {
                    icon: 'fas fa-share',
                    tooltip: 'Share',
                    action: 'share'
                }
            ]
        },
        {
            type: 'custom',         // Custom HTML content
            title: 'Custom Section',
            content: '<div>Any HTML content here</div>'
        }
    ]
};
```

### Attaching to Elements

#### Method 1: Using data attribute
```html
<div data-context-menu='{"sections":[...]}'>Right-click me!</div>
```

#### Method 2: Using JavaScript API
```javascript
const element = document.getElementById('myElement');
contextMenu.attachToElement(element, menuConfig);
```

### Handling Actions

Listen for context menu actions using the custom event:

```javascript
document.addEventListener('contextMenuAction', function(event) {
    const { action, target, item } = event.detail;
    
    switch(action) {
        case 'copy':
            // Handle copy action
            break;
        case 'delete':
            // Handle delete action
            break;
        case 'favorite':
            // Handle favorite action
            break;
    }
});
```

### API Methods

#### `contextMenu.attachToElement(element, config)`
Attaches a context menu to an element.

#### `contextMenu.detachFromElement(element)`
Removes context menu from an element.

#### `contextMenu.destroy()`
Destroys the context menu instance and cleans up.

## Section Types

### List Section (`type: 'list'`)
Creates a vertical list of menu items with icons and text.

**Properties:**
- `title` (optional): Section header text
- `items`: Array of menu items
  - `icon`: FontAwesome icon class
  - `text`: Display text
  - `action`: Action identifier
  - `disabled`: Boolean to disable item
  - `separator`: Boolean to add separator line

### Icons Section (`type: 'icons'`)
Creates a horizontal row of icon buttons.

**Properties:**
- `title` (optional): Section header text
- `icons`: Array of icon buttons
  - `icon`: FontAwesome icon class
  - `tooltip`: Tooltip text
  - `action`: Action identifier
  - `disabled`: Boolean to disable button
  - `separator`: Boolean to add separator line

### Custom Section (`type: 'custom'`)
Allows any HTML content to be inserted.

**Properties:**
- `title` (optional): Section header text
- `content`: HTML string, HTMLElement, or function that returns content

## Touch Support

The context menu automatically detects touch devices and provides long-press functionality:

- **Long-press duration**: 500ms (configurable)
- **Movement threshold**: 10px (cancels if moved too far)
- **Visual feedback**: Element scales down during long-press
- **Touch-friendly sizing**: Larger touch targets on mobile

## Keyboard Navigation

- **Arrow Keys**: Navigate between menu items
- **Enter/Space**: Activate selected item
- **Escape**: Close menu
- **Tab**: Focus management

## Styling

The context menu uses CSS custom properties and follows the existing design system:

- Glass morphism background with backdrop blur
- Consistent with dropdown and modal styling
- Dark mode support
- Mobile-responsive design
- Smooth animations and transitions

## Browser Support

- Modern browsers with ES6+ support
- Touch events for mobile devices
- CSS backdrop-filter support (with fallback)
- Keyboard navigation support

## Example Implementation

```html
<!DOCTYPE html>
<html>
<head>
    <link rel="stylesheet" href="styles.css">
</head>
<body>
    <div id="testElement" style="padding: 20px; background: #f0f0f0;">
        Right-click or long-press me!
    </div>

    <script src="scripts/comp/contextMenu.js"></script>
    <script>
        const element = document.getElementById('testElement');
        const config = {
            sections: [
                {
                    type: 'list',
                    title: 'File Actions',
                    items: [
                        { icon: 'fas fa-copy', text: 'Copy', action: 'copy' },
                        { icon: 'fas fa-cut', text: 'Cut', action: 'cut' },
                        { separator: true },
                        { icon: 'fas fa-trash', text: 'Delete', action: 'delete' }
                    ]
                },
                {
                    type: 'icons',
                    title: 'Quick Actions',
                    icons: [
                        { icon: 'fas fa-star', tooltip: 'Favorite', action: 'favorite' },
                        { icon: 'fas fa-share', tooltip: 'Share', action: 'share' }
                    ]
                }
            ]
        };

        contextMenu.attachToElement(element, config);

        document.addEventListener('contextMenuAction', function(event) {
            const { action } = event.detail;
            alert(`Action: ${action}`);
        });
    </script>
</body>
</html>
```
