# Material Design Icons (MDI) Usage Guide

## Overview
This directory contains the Material Design Icons (MDI) font resources for your web client. The icons are already included in your HTML via the CSS link in `app.html`.

## Update or Install on new install
```shell
npm i @mdi/font
cp -r node_modules/@mdi/font/css public/mdi
cp -r node_modules/@mdi/font/fonts/* public/fonts
```

## Files Included
- `materialdesignicons.min.css` - Main CSS file with icon definitions
- `fonts/` - Directory containing font files (woff2, woff, ttf, eot)

## How to Use

### Basic Usage
```html
<i class="mdi mdi-heart"></i>
<i class="mdi mdi-account"></i>
<i class="mdi mdi-settings"></i>
```

### Icon Classes
- **Base class**: `mdi` - Required for all MDI icons
- **Icon class**: `mdi-[icon-name]` - Specifies which icon to display

### Common Icons
- `mdi-heart` - Heart icon
- `mdi-account` - User account icon
- `mdi-settings` - Settings/gear icon
- `mdi-home` - Home icon
- `mdi-search` - Search icon
- `mdi-menu` - Hamburger menu icon
- `mdi-close` - Close/X icon
- `mdi-arrow-left` - Left arrow
- `mdi-arrow-right` - Right arrow
- `mdi-arrow-up` - Up arrow
- `mdi-arrow-down` - Down arrow

### Styling
You can style the icons using CSS:
```css
.mdi {
    font-size: 24px; /* Default size */
    color: #007bff; /* Icon color */
}

.mdi.mdi-heart {
    color: red;
}
```

### Available Icons
The complete list of available icons can be found at: https://pictogrammers.com/library/mdi/

## Integration
The MDI fonts are already integrated into your web client via:
```html
<link rel="stylesheet" href="/mdi/materialdesignicons.min.css">
```

## Browser Support
- Modern browsers support WOFF2 (best performance)
- Fallback to WOFF, TTF, and EOT for older browsers
- The CSS automatically handles font format selection

## Notes
- Icons are scalable and can be resized using CSS `font-size`
- Icons inherit the text color by default
- All icons are vector-based and look crisp at any size
