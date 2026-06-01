// workspaceUtils.js
// Workspace management utilities for StaticForge frontend
//
// OPTIMIZATION NOTES:
// - Uses WebSocket response data to update local state instead of blind reloads
// - Only regenerates workspace styles when necessary (first load or specific updates)
// - Selective UI updates based on what's currently visible
// - Efficient single-workspace style updates for color/background changes
// - Prevents unnecessary gallery/cache refreshes when components aren't visible
// - Maintains local state consistency with WebSocket events
// - Uses response.success flags to ensure operations completed before updating UI
//
// WORKSPACE STYLE OPTIMIZATION STRATEGY:
// - generateAllWorkspaceStyles(): Only called on first load or when workspace data actually changes
// - generateWorkspaceStyles(workspaceId): Used for single workspace updates (color, background changes)
// - loadWorkspaces(): Only regenerates styles when workspace data has changed (not on every call)
// - switchWorkspaceTheme(): Applies existing styles without regenerating them
// - WebSocket events: Use single workspace updates when possible, avoid full reloads

// Workspace state
let workspaces = {};
let activeWorkspace = 'default';
let currentWorkspaceOperation = null;
let isWorkspaceSwitching = false; // Flag to prevent duplicate calls during workspace switching
let workspaceStyleElement = null; // Global style element for all workspace styles
let workspaceToastId = null; // ID of the workspace switching toast
let workspaceProgressModal = null; // Progress modal for workspace switching
let workspaceProgressBarElement = null;
let workspaceProgressTextElement = null;
let workspaceProgressContainerElement = null;
let workspaceProgressModeSwitched = false; // Track if we've switched from marquee to animate mode

// Automatic background system
let automaticBackgroundInterval = null;
let currentBackgroundImage = null;

// Normalize wallpaper path to 2-part format (type:id) or custom URL
// Converts legacy URL/path formats to the standardized format
// Supports: file:, cache:, cache-preview:, vibe:, url: (for custom URLs)
function normalizeWallpaperPath(wallpaper) {
    if (!wallpaper || typeof wallpaper !== 'string') {
        return null;
    }
    
    // Check if it's already in the correct format (type:id or url:...)
    const correctFormatPattern = /^(file|cache|cache-preview|vibe|url):.+$/;
    if (correctFormatPattern.test(wallpaper)) {
        return wallpaper;
    }
    
    // Check if it's a full URL (http:// or https://)
    if (wallpaper.startsWith('http://') || wallpaper.startsWith('https://')) {
        return `url:${wallpaper}`;
    }
    
    // Convert from legacy URL/path format
    if (wallpaper.startsWith('/cache/upload/')) {
        return `cache:${wallpaper.replace('/cache/upload/', '')}`;
    } else if (wallpaper.startsWith('/cache/preview/')) {
        return `cache-preview:${wallpaper.replace('/cache/preview/', '')}`;
    } else if (wallpaper.startsWith('/cache/vibe/')) {
        return `vibe:${wallpaper.replace('/cache/vibe/', '')}`;
    } else if (wallpaper.startsWith('/cache/wallpapers/')) {
        const workspaceId = wallpaper.replace('/cache/wallpapers/', '').replace('.png', '');
        return `wallpaper:${workspaceId}`;
    } else if (wallpaper.startsWith('/images/')) {
        return `file:${wallpaper.replace('/images/', '')}`;
    } else if (!wallpaper.includes(':') && !wallpaper.includes('/')) {
        return `file:${wallpaper}`;
    }
    
    // Return as-is if we can't parse it (might be a custom format)
    return wallpaper;
}
let nextBackgroundImage = null;
let backgroundTransitionInProgress = false;

// Fonts available for selection (match loaded @font-face names in css/fonts.css)
const AVAILABLE_PRIMARY_FONTS = [
    { value: '', label: 'Default', fontFamily: "var(--font-primary)" },
    { value: 'Noto Sans', label: 'Noto Sans' },
    { value: 'Noto Sans JP', label: 'Noto Sans JP' },
    { value: 'Tahoma', label: 'Tahoma' },
    { value: 'Oxanium', label: 'Oxanium' },
    { value: 'Atkinson Hyperlegible Next', label: 'Atkinson Hyperlegible' },
    { value: 'Eczar', label: 'Eczar' },
    { value: 'Kanit', label: 'Kanit' },
    { value: 'Mozilla Headline', label: 'Mozilla Headline' },
    { value: 'Mozilla Text', label: 'Mozilla Text' },
    { value: 'Grenze', label: 'Grenze' },
    { value: 'Texturina', label: 'Texturina' },
    { value: 'Bodoni Moda', label: 'Bodoni Moda' },
    { value: 'Red Hat Display', label: 'Red Hat Display' },
    { value: 'Tomorrow', label: 'Tomorrow' },
    { value: 'Tektur', label: 'Tektur' },
    { value: 'Zen Kurenaido', label: 'Zen Kurenaido' },
    { value: 'Kaisei Decol', label: 'Kaisei Decol' },
    { value: 'Zen Antique', label: 'Zen Antique' },
    { value: 'Solway', label: 'Solway' }
];

const AVAILABLE_TEXTAREA_FONTS = [
    { value: '', label: 'Default', fontFamily: "var(--font-mono)" },
    { value: 'Share Tech Mono', label: 'Share Tech Mono' },
    { value: 'Tahoma', label: 'Tahoma' },
    { value: 'Oxanium', label: 'Oxanium' },
    { value: 'Kanit', label: 'Kanit' },
    { value: 'Tomorrow', label: 'Tomorrow' },
    { value: 'Tektur', label: 'Tektur' },
    { value: 'Grenze', label: 'Grenze' },
    { value: 'Texturina', label: 'Texturina' },
    { value: 'Bodoni Moda', label: 'Bodoni Moda' },
    { value: 'Red Hat Display', label: 'Red Hat Display' },
    { value: 'Eczar', label: 'Eczar' },
    { value: 'Mozilla Text', label: 'Mozilla Text' },
    { value: 'Solway', label: 'Solway' }
];

// Generate all workspace styles in a single style element
function generateAllWorkspaceStyles() {
    // Remove existing style element if it exists
    if (workspaceStyleElement) {
        workspaceStyleElement.remove();
    }

    // Create new style element
    workspaceStyleElement = document.createElement('style');
    workspaceStyleElement.id = 'workspace-styles';
    document.head.appendChild(workspaceStyleElement);

    // Generate styles for each workspace
    Object.values(workspaces).forEach(workspace => {
        const workspaceId = workspace.id;
        const workspaceColor = workspace.color || '#102040';
        const workspaceBackgroundColor = workspace.backgroundColor || '#0a1a2a';

        let workspaceWallpaper = null;
        if (workspace.wallpaper) {
            const [type, ...idParts] = workspace.wallpaper.split(':');
            const id = idParts.join(':'); // Rejoin in case the ID contains colons (e.g., URLs)
            switch (type) {
                case 'file':
                    workspaceWallpaper = `/images/${id}`;
                    break;
                case 'cache':
                    workspaceWallpaper = `/cache/upload/${id}`;
                    break;
                case 'cache-preview':
                    workspaceWallpaper = `/cache/preview/${id}`;
                    break;
                case 'vibe':
                    workspaceWallpaper = `/cache/vibe/${id}`;
                    break;
                case 'wallpaper':
                    workspaceWallpaper = `/cache/wallpapers/${id}.png`;
                    break;
                case 'url':
                    workspaceWallpaper = id; // Use the URL directly
                    break;
            }
        }
        const workspaceWallpaperPosition = workspace.wallpaperPosition || 'center';
        // Resolve fonts: inherit from default workspace if not set
        const defaultWorkspace = workspaces['default'];
        const resolvedPrimaryFont =
            (workspace.primaryFont && workspace.primaryFont.trim())
                ? workspace.primaryFont
                : (workspaceId !== 'default' && defaultWorkspace && defaultWorkspace.primaryFont) ? defaultWorkspace.primaryFont : '';
        const resolvedTextareaFont =
            (workspace.textareaFont && workspace.textareaFont.trim())
                ? workspace.textareaFont
                : (workspaceId !== 'default' && defaultWorkspace && defaultWorkspace.textareaFont) ? defaultWorkspace.textareaFont : '';
        
        // Generate CSS variables for this workspace (normal blur)
        const cssVariables = generateWorkspaceCSSVariables(workspaceColor, workspaceBackgroundColor, workspaceWallpaper, workspaceWallpaperPosition, resolvedPrimaryFont, resolvedTextareaFont, false);
        
        // Generate CSS variables for this workspace when blur is disabled
        const cssVariablesDark = generateWorkspaceCSSVariables(workspaceColor, workspaceBackgroundColor, workspaceWallpaper, workspaceWallpaperPosition, resolvedPrimaryFont, resolvedTextareaFont, true);
        
        // Create CSS rule for this workspace (normal blur)
        const workspaceCSS = `
[data-workspace="${workspaceId}"] {
    ${cssVariables}
}

html.disable-blur [data-workspace="${workspaceId}"] {
    ${cssVariablesDark}
}
        `;
        
        // Add to style element
        workspaceStyleElement.textContent += workspaceCSS;
    });
}

// Generate styles for a specific workspace only (more efficient for single updates)
function generateWorkspaceStyles(workspaceId) {
    const workspace = workspaces[workspaceId];
    if (!workspace) return;

    // Ensure style element exists
    if (!workspaceStyleElement) {
        workspaceStyleElement = document.createElement('style');
        workspaceStyleElement.id = 'workspace-styles';
        document.head.appendChild(workspaceStyleElement);
    }

    const workspaceColor = workspace.color || '#102040';
    const workspaceBackgroundColor = workspace.backgroundColor || '#0a1a2a';

    let workspaceWallpaper = null;
    if (workspace.wallpaper) {
        const [type, ...idParts] = workspace.wallpaper.split(':');
        const id = idParts.join(':'); // Rejoin in case the ID contains colons (e.g., URLs)
        switch (type) {
            case 'file':
                workspaceWallpaper = `/images/${id}`;
                break;
            case 'cache':
                workspaceWallpaper = `/cache/upload/${id}`;
                break;
            case 'cache-preview':
                workspaceWallpaper = `/cache/preview/${id}`;
                break;
            case 'vibe':
                workspaceWallpaper = `/cache/vibe/${id}`;
                break;
            case 'wallpaper':
                workspaceWallpaper = `/cache/wallpapers/${id}.png`;
                break;
            case 'url':
                workspaceWallpaper = id; // Use the URL directly
                break;
        }
    }
    const workspaceWallpaperPosition = workspace.wallpaperPosition || 'center';
    
    // Resolve fonts: inherit from default workspace if not set
    const defaultWorkspace = workspaces['default'];
    const resolvedPrimaryFont =
        (workspace.primaryFont && workspace.primaryFont.trim())
            ? workspace.primaryFont
            : (workspaceId !== 'default' && defaultWorkspace && defaultWorkspace.primaryFont) ? defaultWorkspace.primaryFont : '';
    const resolvedTextareaFont =
        (workspace.textareaFont && workspace.textareaFont.trim())
            ? workspace.textareaFont
            : (workspaceId !== 'default' && defaultWorkspace && defaultWorkspace.textareaFont) ? defaultWorkspace.textareaFont : '';
    
    // Generate CSS variables for this workspace
    const cssVariables = generateWorkspaceCSSVariables(workspaceColor, workspaceBackgroundColor, workspaceWallpaper, workspaceWallpaperPosition, resolvedPrimaryFont, resolvedTextareaFont, false);
    const cssVariablesDark = generateWorkspaceCSSVariables(workspaceColor, workspaceBackgroundColor, workspaceWallpaper, workspaceWallpaperPosition, resolvedPrimaryFont, resolvedTextareaFont, true);
    
    // Create CSS rule for this workspace
    const workspaceCSS = `
[data-workspace="${workspaceId}"] {
    ${cssVariables}
}

html.disable-blur [data-workspace="${workspaceId}"] {
    ${cssVariablesDark}
}
        `;
    
    // Remove existing styles for this workspace if they exist
    const existingStyle = workspaceStyleElement.textContent;
    const workspaceRegex = new RegExp(`\\[data-workspace="${workspaceId}"\\][\\s\\S]*?\\}\\s*\\}\\s*`, 'g');
    const updatedStyle = existingStyle.replace(workspaceRegex, '');
    
    // Add new styles
    workspaceStyleElement.textContent = updatedStyle + workspaceCSS;
}

// Helper to blend two colors (foreground over background) given alpha
function blendColors(fg, bg, alpha) {
    return {
        r: Math.round(fg.r * alpha + bg.r * (1 - alpha)),
        g: Math.round(fg.g * alpha + bg.g * (1 - alpha)),
        b: Math.round(fg.b * alpha + bg.b * (1 - alpha))
    };
}

// Helper function to mix two HSL colors based on a ratio (0-1)
function mixHslColors(color1, color2, ratio) {
    return {
        h: Math.round(color1.h * ratio + color2.h * (1 - ratio)),
        s: Math.round(color1.s * ratio + color2.s * (1 - ratio)),
        l: Math.round(color1.l * ratio + color2.l * (1 - ratio))
    };
}

// Helper function to convert HSL to rgba string with opacity
function hslToRgbaString(h, s, l, alpha) {
    h /= 360;
    s /= 100;
    l /= 100;
    
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((h * 6) % 2 - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;
    
    if (0 <= h && h < 1/6) {
        r = c; g = x; b = 0;
    } else if (1/6 <= h && h < 1/3) {
        r = x; g = c; b = 0;
    } else if (1/3 <= h && h < 1/2) {
        r = 0; g = c; b = x;
    } else if (1/2 <= h && h < 2/3) {
        r = 0; g = x; b = c;
    } else if (2/3 <= h && h < 5/6) {
        r = x; g = 0; b = c;
    } else if (5/6 <= h && h <= 1) {
        r = c; g = 0; b = x;
    }
    
    r = Math.round((r + m) * 255);
    g = Math.round((g + m) * 255);
    b = Math.round((b + m) * 255);
    
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Generate CSS variables for a specific workspace
function generateWorkspaceCSSVariables(workspaceColor, workspaceBackgroundColor, workspaceWallpaper = null, workspaceWallpaperPosition = 'center', primaryFont = '', textareaFont = '', isBlurDisabled = false, gradientBrightnessRatio = 1.0, gradientTintRatio = 0.35) {
    // Color adjustment variables for consistent theming
    const BADGE_LIGHTNESS_1 = 30; // Much darker first badge color
    const BADGE_SATURATION_1 = 45; // Much darker first badge color
    const BADGE_LIGHTNESS_2 = 35; // Much darker second badge color
    const BADGE_SATURATION_2 = 35; // Much darker second badge color
    const HOVER_SHOW_COLORED_LIGHTNESS = 94; // Light colored text
    const GLASS_TINT_SATURATION = 15; // Glass tint saturation
    const GLASS_TINT_LIGHTNESS_FACTOR = 0.4; // Glass tint lightness factor
    const GLASS_TINT_MIN_LIGHTNESS = 10; // Minimum glass tint lightness
    
    // Toggle button color variables
    const TOGGLE_ON_LIGHTNESS = 50; // Toggle on state lightness
    const TOGGLE_ON_SATURATION = 45; // Toggle on state saturation
    const TOGGLE_ON_HOVER_LIGHTNESS = 35; // Toggle on hover state lightness
    const TOGGLE_ON_HOVER_SATURATION = 80; // Toggle on hover state saturation
    const TOGGLE_SHADOW_LIGHTNESS = 5; // Toggle shadow lightness (darker)
    const TOGGLE_SHADOW_SATURATION = 60; // Toggle shadow saturation (more saturated)
    
    // Round button color variables
    const ROUND_SECONDARY_LIGHTNESS = 3; // Round secondary button lightness
    const ROUND_SECONDARY_SATURATION = 85; // Round secondary button saturation   
    
    const workspaceHsl = hexToHsl(workspaceColor);
    const workspaceBackgroundHsl = hexToHsl(workspaceBackgroundColor);
    
    const originalSaturation = 86; // Original orange saturation
    const originalLightness = Math.min(workspaceHsl.l, 43);   // Original orange lightness
    
    const brightenedHsl = {
        h: workspaceHsl.h,
        s: workspaceHsl.s,
        l: Math.min(100, workspaceHsl.l * 1.3) // 30% brighter
    };
    
    const bgTintedHsl = {
        h: workspaceBackgroundHsl.h,
        s: Math.max(0, workspaceBackgroundHsl.s * 0.05), // Much reduced saturation
        l: Math.min(100, 95 + workspaceBackgroundHsl.l * 0.05) // Very light
    };
    
    const glassTintH = workspaceBackgroundHsl.h;
    const glassTintS = GLASS_TINT_SATURATION;
    const glassTintL = Math.max(GLASS_TINT_MIN_LIGHTNESS, workspaceBackgroundHsl.l * GLASS_TINT_LIGHTNESS_FACTOR);
    
    const headerDarkS = Math.min(100, Math.max(60, workspaceHsl.s + 20));
    const headerDarkL = Math.min(20, Math.max(workspaceHsl.l - 20, 5));
    const headerDarkBorderS = Math.min(100, workspaceHsl.s + 20);

    // Generate all CSS variables
    const variables = [
        `--primary-color: hsl(${workspaceHsl.h} ${workspaceHsl.s}% ${workspaceHsl.l}%);`,
        `--primary-color-light: hsl(${workspaceHsl.h} ${Math.min(100, workspaceHsl.s + 5)}% ${Math.min(100, workspaceHsl.l + 15)}%);`,
        `--primary-color-dark: hsl(${workspaceHsl.h} ${Math.max(0, workspaceHsl.s - 10)}% ${Math.max(0, workspaceHsl.l - 15)}%);`,
        `--primary-gradient: linear-gradient(45deg, hsl(${workspaceHsl.h} ${workspaceHsl.s}% ${workspaceHsl.l}%), hsl(${workspaceHsl.h} ${Math.min(100, workspaceHsl.s + 5)}% ${Math.min(100, workspaceHsl.l + 15)}%));`,
        `--primary-glass-color: hsl(${workspaceHsl.h} 100% 35% / 72%);`,
        `--primary-glass-border: hsl(${workspaceHsl.h} 100% 50% / 58%);`,
        `--border-primary: hsl(${workspaceHsl.h} ${workspaceHsl.s}% ${workspaceHsl.l}%);`,
        `--text-accent: hsl(${workspaceHsl.h} ${workspaceHsl.s}% ${workspaceHsl.l}%);`,
        `--shadow-primary: hsl(${workspaceHsl.h} ${workspaceHsl.s}% ${workspaceHsl.l}% / 30%);`,
        `--text-accent-tinted: hsl(${workspaceHsl.h} 100% 85%);`,
        `--btn-hover-bg-primary: hsl(${workspaceHsl.h} ${originalSaturation}% ${originalLightness}% / 50%);`,
        `--btn-hover-border-primary: hsl(${workspaceHsl.h} ${originalSaturation}% ${originalLightness}% / 80%);`,
        `--btn-hover-text-primary: #ffffff;`,
        `--btn-shadow-primary: hsl(${workspaceHsl.h} ${workspaceHsl.s}% ${workspaceHsl.l}% / 89%);`,
        `--btn-shadow-primary-glow: 0 2px 16px hsl(${workspaceHsl.h} 100% 85% / 90%);`,
        `--btn-hover-bg-secondary: hsl(${bgTintedHsl.h} ${bgTintedHsl.s}% ${bgTintedHsl.l}% / 38%);`,
        `--btn-shadow-secondary-glow: 0 8px 20px hsl(${bgTintedHsl.h} ${bgTintedHsl.s}% ${bgTintedHsl.l}% / 33%);`,
        `--hover-show-active-bg: hsl(${workspaceHsl.h} ${originalSaturation}% ${originalLightness}% / 66%);`,
        `--hover-show-active-border: hsl(${workspaceHsl.h} ${originalSaturation}% ${originalLightness}% / 20%);`,
        `--hover-show-active-shadow: 0 8px 20px hsl(${workspaceHsl.h} ${originalSaturation}% ${originalLightness}% / 55%);`,
        `--dropdown-hover-bg: hsl(${workspaceBackgroundHsl.h} ${workspaceBackgroundHsl.s}% ${workspaceBackgroundHsl.l}% / 50%);`,
        `--dropdown-selected-bg: hsl(${workspaceBackgroundHsl.h} ${workspaceBackgroundHsl.s}% ${workspaceBackgroundHsl.l}% / 90.3%);`,
        `--dropdown-keyboard-selected-bg: hsl(${workspaceHsl.h} ${workspaceHsl.s}% ${workspaceHsl.l}% / 80%);`,
        `--dropdown-keyboard-selected-border: hsl(${workspaceHsl.h} ${workspaceHsl.s}% ${workspaceHsl.l}%);`,
        `--badge-bg: hsl(${workspaceHsl.h} ${originalSaturation}% ${originalLightness}% / 80%);`,
        `--badge-text: #ffffff;`,
        `--badge-shadow: 0 1px 3px hsl(${workspaceHsl.h} ${originalSaturation}% ${originalLightness}% / 30%);`,
        `--custom-dropdown-badge-bg: linear-gradient(45deg, hsl(${workspaceHsl.h} ${BADGE_SATURATION_1}% ${BADGE_LIGHTNESS_1}%), hsl(${workspaceHsl.h} ${BADGE_SATURATION_2}% ${BADGE_LIGHTNESS_2}%));`,
        `--custom-dropdown-badge-text: #ffffff;`,
        `--hover-show-colored-text: hsl(${workspaceHsl.h} 100% ${HOVER_SHOW_COLORED_LIGHTNESS}%);`,
        `--toggle-on-bg: hsl(${workspaceHsl.h} ${TOGGLE_ON_SATURATION}% ${TOGGLE_ON_LIGHTNESS}% / 66%);`,
        `--toggle-on-hover-bg: hsl(${workspaceHsl.h} ${TOGGLE_ON_HOVER_SATURATION}% ${TOGGLE_ON_HOVER_LIGHTNESS}%);`,
        `--toggle-shadow-color-58: hsl(${workspaceHsl.h} ${TOGGLE_SHADOW_SATURATION}% ${TOGGLE_SHADOW_LIGHTNESS}% / 58%);`,
        `--toggle-shadow-color-19: hsl(${workspaceHsl.h} ${Math.max(0, TOGGLE_SHADOW_SATURATION - 20)}% ${Math.min(100, TOGGLE_SHADOW_LIGHTNESS + 15)}% / 19%);`,
        `--round-secondary-bg: hsl(${workspaceHsl.h} ${ROUND_SECONDARY_SATURATION}% ${ROUND_SECONDARY_LIGHTNESS}%);`,
    ];

    // Fonts: if provided, set per-workspace font variables used by styles.css
    if (primaryFont && typeof primaryFont === 'string') {
        variables.push(`--font-primary: '${primaryFont}', 'Noto Sans', 'Noto Sans JP', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;`);
    }
    if (textareaFont && typeof textareaFont === 'string') {
        variables.push(`--font-mono: '${textareaFont}', 'Share Tech Mono', 'Noto Sans', 'Noto Sans JP', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;`);
    }
    

    // Generate glass-layer-* variables with 1-3% workspace color tinting
    // When blur is disabled, use higher opacity for better readability while keeping darker colors for contrast
    if (isBlurDisabled) {
        // For accessibility with white text, use higher opacity and darker, more neutral colors
        // Glass layer HSL values
        const glassLayer1S = Math.max(0, workspaceHsl.s - 75);
        const glassLayer2S = Math.max(0, workspaceHsl.s - 65);
        const glassLayer3S = Math.max(0, workspaceHsl.s - 60);
        const glassLayer4S = Math.max(0, workspaceHsl.s - 55);
        const glassLayer5S = Math.max(0, workspaceHsl.s - 50);
        const glassLayer6S = Math.max(0, workspaceHsl.s - 45);

        // For blur-disabled mode, use higher opacity for better readability while keeping darker colors for contrast
        const glassTintLightH = workspaceBackgroundHsl.h;
        const glassTintLightS = Math.max(0, workspaceBackgroundHsl.s - 40); // Less reduction in saturation
        const glassTintLightL = Math.max(GLASS_TINT_MIN_LIGHTNESS, workspaceBackgroundHsl.l * 0.15); // Lower lightness for better contrast

        variables.push(
            `--text-muted: hsl(${workspaceHsl.h} 25% 60%);`,
            `--glass-layer-dark-menu: hsl(${glassTintLightH} ${glassTintLightS}% ${glassTintLightL}% / 97%);`,
            `--glass-layer-dark-bg: hsl(${glassTintLightH} 25% 10% / 80%);`,
            `--glass-layer-dark-5: hsl(${glassTintLightH} ${glassTintLightS}% ${glassTintLightL}% / 97%);`,
            `--glass-layer-dark-4: hsl(${glassTintLightH} ${glassTintLightS}% ${glassTintLightL}% / 95%);`,
            `--glass-layer-dark-3: hsl(${glassTintLightH} ${glassTintLightS}% ${glassTintLightL}% / 90%);`,
            `--glass-layer-dark-2: hsl(${glassTintLightH} ${glassTintLightS}% ${glassTintLightL}% / 85%);`,
            `--glass-layer-dark-1: hsl(${glassTintLightH} ${glassTintLightS}% ${glassTintLightL}% / 80%);`,
            `--glass-windows-bg: hsl(${glassTintLightH} 25% 20% / 94%);`,
            `--glass-windows-semi-bg: hsl(${glassTintLightH} 25% 25% / 70%);`,
            `--glass-windows-full-bg: hsl(${glassTintLightH} 25% 25% / 97%);`,

            // Gradient pattern variables - calculated in JavaScript with brightness and tint ratios
            ...(() => {
                const baseHsl = { h: glassTintLightH, s: 25, l: 20 }; // glass-windows-bg color
                const whiteHsl = { h: 0, s: 0, l: 100 };
                const blackHsl = { h: 0, s: 0, l: 0 };
                const gray666Hsl = { h: 0, s: 0, l: 40 };
                const grayAaaHsl = { h: 0, s: 0, l: 67 };
                const grayBbbHsl = { h: 0, s: 0, l: 73 };
                
                // Mix base color with target colors based on tint ratio
                const whiteMixed = mixHslColors(baseHsl, whiteHsl, gradientTintRatio);
                const blackMixed = mixHslColors(baseHsl, blackHsl, gradientTintRatio);
                const gray666Mixed = mixHslColors(baseHsl, gray666Hsl, gradientTintRatio);
                const grayAaaMixed = mixHslColors(baseHsl, grayAaaHsl, gradientTintRatio);
                const grayBbbMixed = mixHslColors(baseHsl, grayBbbHsl, gradientTintRatio);
                
                // Apply brightness ratio to opacity values (50% more opaque than original)
                // Original: #fff5 (33%), #0002 (13%), #6661 (6.7%), #aaa1 (6.7%), #bbb2 (13%), #bbb1 (6.7%)
                return [
                    `--gradient-pattern-white: ${hslToRgbaString(whiteMixed.h, whiteMixed.s, whiteMixed.l, 0.495 * gradientBrightnessRatio)};`,
                    `--gradient-pattern-black: ${hslToRgbaString(blackMixed.h, blackMixed.s, blackMixed.l, 0.195 * gradientBrightnessRatio)};`,
                    `--gradient-pattern-gray-666: ${hslToRgbaString(gray666Mixed.h, gray666Mixed.s, gray666Mixed.l, 0.101 * gradientBrightnessRatio)};`,
                    `--gradient-pattern-gray-aaa-light: ${hslToRgbaString(grayAaaMixed.h, grayAaaMixed.s, grayAaaMixed.l, 0.101 * gradientBrightnessRatio)};`,
                    `--gradient-pattern-gray-aaa-medium: ${hslToRgbaString(grayAaaMixed.h, grayAaaMixed.s, grayAaaMixed.l, 0.195 * gradientBrightnessRatio)};`,
                    `--gradient-pattern-gray-bbb-light: ${hslToRgbaString(grayBbbMixed.h, grayBbbMixed.s, grayBbbMixed.l, 0.101 * gradientBrightnessRatio)};`,
                    `--gradient-pattern-gray-bbb-medium: ${hslToRgbaString(grayBbbMixed.h, grayBbbMixed.s, grayBbbMixed.l, 0.195 * gradientBrightnessRatio)};`
                ];
            })(),

            `--glass-layer-1: hsl(${workspaceHsl.h} ${glassLayer1S}% 40% / 15%);`,
            `--glass-layer-2: hsl(${workspaceHsl.h} ${glassLayer2S}% 45% / 32.5%);`,
            `--glass-layer-3: hsl(${workspaceHsl.h} ${glassLayer3S}% 50% / 35%);`,
            `--glass-layer-4: hsl(${workspaceHsl.h} ${glassLayer4S}% 55% / 45%);`,
            `--glass-layer-5: hsl(${workspaceHsl.h} ${glassLayer5S}% 70% / 50%);`,
            `--glass-layer-light-bg: hsl(${workspaceHsl.h} 25% 95% / 80%);`,
            `--glass-overlay-bg: hsl(${workspaceHsl.h} 20% 75% / 95%);`,

            // Fully opaque versions - for blur disabled, we use simpler direct HSL
            `--glass-layer-1-opaque: hsl(${workspaceHsl.h} ${glassLayer1S}% 40%);`,
            `--glass-layer-2-opaque: hsl(${workspaceHsl.h} ${glassLayer2S}% 45%);`,
            `--glass-layer-3-opaque: hsl(${workspaceHsl.h} ${glassLayer3S}% 50%);`,
            `--glass-layer-4-opaque: hsl(${workspaceHsl.h} ${glassLayer4S}% 55%);`,
            `--glass-layer-5-opaque: hsl(${workspaceHsl.h} ${glassLayer5S}% 70%);`,
            `--glass-layer-6-opaque: hsl(${workspaceHsl.h} ${glassLayer6S}% 85%);`,
            `--glass-layer-alt-1: hsl(${workspaceHsl.h} ${Math.max(0, workspaceHsl.s - 95)}% 25% / 80%);`,
            `--glass-layer-alt-2: hsl(${workspaceHsl.h} ${Math.max(0, workspaceHsl.s - 85)}% 20% / 85%);`,
            `--glass-layer-alt-3: hsl(${workspaceHsl.h} 40% 15% / 90%);`,
            `--glass-layer-alt-4: hsl(${workspaceHsl.h} 50% 10% / 95%);`,
            `--glass-layer-alt-5: hsl(${workspaceHsl.h} 60% 5%);`,
            `--shadow-color-1: hsl(${workspaceHsl.h} 100% 5% / 90%);`,
            `--shadow-color-2: hsl(${workspaceHsl.h} 100% 10% / 80%);`,
            `--shadow-color-3: hsl(${workspaceHsl.h} 100% 12.5% / 70%);`,
            `--shadow-color-4: hsl(${workspaceHsl.h} 100% 13% / 60%);`,
            `--shadow-color-5: hsl(${workspaceHsl.h} 100% 15% / 50%);`,
            `--glass-border-saturated: hsl(${workspaceHsl.h} 100% 35% / 45%);`,
            `--glass-border-1: hsl(${workspaceHsl.h} ${Math.max(0, workspaceHsl.s - 80)}% 40% / 25%);`,
            `--glass-border-2: hsl(${workspaceHsl.h} ${Math.max(0, workspaceHsl.s - 75)}% 45% / 35%);`,
            `--glass-border-3: hsl(${workspaceHsl.h} ${Math.max(0, workspaceHsl.s - 70)}% 50% / 45%);`,
            `--glass-border-4: hsl(${workspaceHsl.h} ${Math.max(0, workspaceHsl.s - 65)}% 55% / 55%);`,
            `--glass-border-5: hsl(${workspaceHsl.h} ${Math.max(0, workspaceHsl.s - 60)}% 60% / 65%);`,
            `--glass-inset-bg-1: hsl(${workspaceHsl.h} 75% 35% / 25%);`,
            `--glass-inset-bg-2: hsl(${workspaceHsl.h} 70% 30% / 35%);`,
            `--glass-inset-bg-3: hsl(${workspaceHsl.h} 65% 25% / 45%);`,
            `--glass-inset-bg-4: hsl(${workspaceHsl.h} 60% 20% / 55%);`,
            `--glass-inset-bg-5: hsl(${workspaceHsl.h} 55% 15% / 65%);`,
            `--header-bg: hsl(${workspaceHsl.h} ${headerDarkS}% ${headerDarkL}% / 90%);`,
            `--header-border: hsl(${workspaceHsl.h} ${headerDarkBorderS}% 50% / 50%);`,
            `--active-tab-bg: hsl(${workspaceHsl.h} ${workspaceHsl.s}% ${workspaceHsl.l}% / 90%);`,
            `--active-tab-border: hsl(${workspaceHsl.h} ${workspaceHsl.s}% ${workspaceHsl.l}% / 85%);`,
            `--active-tab-text: #ffffff;`
        );
    } else {
        // Original glass layer generation
        const glassLayer1S = Math.max(0, workspaceHsl.s - 80);
        const glassLayer2S = Math.max(0, workspaceHsl.s - 70);
        const glassLayer3S = Math.max(0, workspaceHsl.s - 60);
        const glassLayer4S = Math.max(0, workspaceHsl.s - 50);
        const glassLayer5S = Math.max(0, workspaceHsl.s - 40);
        const glassLayer6S = Math.max(0, workspaceHsl.s - 30);
        
        const glassLayer1L = Math.min(100, workspaceHsl.l + 45);
        const glassLayer2L = Math.min(100, workspaceHsl.l + 40);
        const glassLayer3L = Math.min(100, workspaceHsl.l + 35);
        const glassLayer4L = Math.min(100, workspaceHsl.l + 30);
        const glassLayer5L = Math.min(100, workspaceHsl.l + 25);
        const glassLayer6L = Math.min(100, workspaceHsl.l + 15);

        variables.push(
            `--glass-layer-dark-menu: hsl(${glassTintH} ${glassTintS}% ${glassTintL}% / 97%);`,
            `--glass-layer-dark-bg: hsl(${glassTintH} 25% 10% / 85%);`,
            `--glass-layer-dark-5: hsl(${glassTintH} ${glassTintS}% ${glassTintL}% / 66%);`,
            `--glass-layer-dark-4: hsl(${glassTintH} ${glassTintS}% ${glassTintL}% / 44%);`,
            `--glass-layer-dark-3: hsl(${glassTintH} ${glassTintS}% ${glassTintL}% / 33%);`,
            `--glass-layer-dark-2: hsl(${glassTintH} ${glassTintS}% ${glassTintL}% / 22%);`,
            `--glass-layer-dark-1: hsl(${glassTintH} ${glassTintS}% ${glassTintL}% / 13%);`,
            `--glass-windows-bg: hsl(${glassTintH} 90% 25% / 75%);`,
            `--glass-windows-semi-bg: hsl(${glassTintH} 25% 25% / 70%);`,
            `--glass-windows-full-bg: hsl(${glassTintH} 25% 25% / 97%);`,
            
            // Gradient pattern variables - calculated in JavaScript with brightness and tint ratios
            ...(() => {
                const baseHsl = { h: glassTintH, s: 25, l: 20 }; // glass-windows-bg color
                const whiteHsl = { h: 0, s: 0, l: 100 };
                const blackHsl = { h: 0, s: 0, l: 0 };
                const gray666Hsl = { h: 0, s: 0, l: 40 };
                const grayAaaHsl = { h: 0, s: 0, l: 67 };
                const grayBbbHsl = { h: 0, s: 0, l: 73 };
                
                // Mix base color with target colors based on tint ratio
                const whiteMixed = mixHslColors(baseHsl, whiteHsl, gradientTintRatio);
                const blackMixed = mixHslColors(baseHsl, blackHsl, gradientTintRatio);
                const gray666Mixed = mixHslColors(baseHsl, gray666Hsl, gradientTintRatio);
                const grayAaaMixed = mixHslColors(baseHsl, grayAaaHsl, gradientTintRatio);
                const grayBbbMixed = mixHslColors(baseHsl, grayBbbHsl, gradientTintRatio);
                
                // Apply brightness ratio to opacity values (50% more opaque than original)
                // Original: #fff5 (33%), #0002 (13%), #6661 (6.7%), #aaa1 (6.7%), #bbb2 (13%), #bbb1 (6.7%)
                return [
                    `--gradient-pattern-white: ${hslToRgbaString(whiteMixed.h, whiteMixed.s, whiteMixed.l, 0.495 * gradientBrightnessRatio)};`,
                    `--gradient-pattern-black: ${hslToRgbaString(blackMixed.h, blackMixed.s, blackMixed.l, 0.195 * gradientBrightnessRatio)};`,
                    `--gradient-pattern-gray-666: ${hslToRgbaString(gray666Mixed.h, gray666Mixed.s, gray666Mixed.l, 0.101 * gradientBrightnessRatio)};`,
                    `--gradient-pattern-gray-aaa-light: ${hslToRgbaString(grayAaaMixed.h, grayAaaMixed.s, grayAaaMixed.l, 0.101 * gradientBrightnessRatio)};`,
                    `--gradient-pattern-gray-aaa-medium: ${hslToRgbaString(grayAaaMixed.h, grayAaaMixed.s, grayAaaMixed.l, 0.195 * gradientBrightnessRatio)};`,
                    `--gradient-pattern-gray-bbb-light: ${hslToRgbaString(grayBbbMixed.h, grayBbbMixed.s, grayBbbMixed.l, 0.101 * gradientBrightnessRatio)};`,
                    `--gradient-pattern-gray-bbb-medium: ${hslToRgbaString(grayBbbMixed.h, grayBbbMixed.s, grayBbbMixed.l, 0.195 * gradientBrightnessRatio)};`
                ];
            })(),
            
            `--glass-layer-1: hsl(${workspaceHsl.h} ${glassLayer1S}% ${glassLayer1L}% / 5%);`,
            `--glass-layer-2: hsl(${workspaceHsl.h} ${glassLayer2S}% ${glassLayer2L}% / 10%);`,
            `--glass-layer-3: hsl(${workspaceHsl.h} ${glassLayer3S}% ${glassLayer3L}% / 20%);`,
            `--glass-layer-4: hsl(${workspaceHsl.h} ${glassLayer4S}% ${glassLayer4L}% / 30%);`,
            `--glass-layer-5: hsl(${workspaceHsl.h} ${glassLayer5S}% ${glassLayer5L}% / 40%);`,
            `--glass-layer-light-bg: hsl(${workspaceHsl.h} 25% 95% / 80%);`,
            `--glass-overlay-bg: hsl(${workspaceHsl.h} 18% 70% / 85%);`,
            `--glass-layer-1-opaque: hsl(${workspaceHsl.h} ${glassLayer1S}% ${glassLayer1L}%);`,
            `--glass-layer-2-opaque: hsl(${workspaceHsl.h} ${glassLayer2S}% ${glassLayer2L}%);`,
            `--glass-layer-3-opaque: hsl(${workspaceHsl.h} ${glassLayer3S}% ${glassLayer3L}%);`,
            `--glass-layer-4-opaque: hsl(${workspaceHsl.h} ${glassLayer4S}% ${glassLayer4L}%);`,
            `--glass-layer-5-opaque: hsl(${workspaceHsl.h} ${glassLayer5S}% ${glassLayer5L}%);`,
            `--glass-border-1: hsl(${workspaceHsl.h} ${Math.max(0, workspaceHsl.s - 75)}% ${Math.min(100, workspaceHsl.l + 50)}% / 8%);`,
            `--glass-border-2: hsl(${workspaceHsl.h} ${Math.max(0, workspaceHsl.s - 65)}% ${Math.min(100, workspaceHsl.l + 45)}% / 10%);`,
            `--glass-border-3: hsl(${workspaceHsl.h} ${Math.max(0, workspaceHsl.s - 55)}% ${Math.min(100, workspaceHsl.l + 40)}% / 15%);`,
            `--glass-border-4: hsl(${workspaceHsl.h} ${Math.max(0, workspaceHsl.s - 45)}% ${Math.min(100, workspaceHsl.l + 35)}% / 20%);`,
            `--glass-border-5: hsl(${workspaceHsl.h} ${Math.max(0, workspaceHsl.s - 35)}% ${Math.min(100, workspaceHsl.l + 30)}% / 25%);`,
            `--glass-inset-bg-1: hsl(${workspaceHsl.h} ${Math.max(75, workspaceHsl.s - 80)}% ${Math.min(60, workspaceHsl.l + 50)}% / 5%);`,
            `--glass-inset-bg-2: hsl(${workspaceHsl.h} ${Math.max(75, workspaceHsl.s - 75)}% ${Math.min(60, workspaceHsl.l + 45)}% / 8%);`,
            `--glass-inset-bg-3: hsl(${workspaceHsl.h} ${Math.max(75, workspaceHsl.s - 70)}% ${Math.min(60, workspaceHsl.l + 40)}% / 12%);`,
            `--glass-inset-bg-4: hsl(${workspaceHsl.h} ${Math.max(75, workspaceHsl.s - 65)}% ${Math.min(60, workspaceHsl.l + 35)}% / 15%);`,
            `--glass-inset-bg-5: hsl(${workspaceHsl.h} ${Math.max(75, workspaceHsl.s - 60)}% ${Math.min(60, workspaceHsl.l + 30)}% / 20%);`,
            `--header-bg: hsl(${workspaceHsl.h} 100% 25% / 40%);`,
            `--header-border: hsl(${workspaceHsl.h} ${workspaceHsl.s}% ${workspaceHsl.l}% / 30%);`,
            `--active-tab-bg: hsl(${workspaceHsl.h} ${workspaceHsl.s}% ${workspaceHsl.l}% / 54%);`,
            `--active-tab-border: hsl(${workspaceHsl.h} ${workspaceHsl.s}% ${workspaceHsl.l}% / 53%);`,
            `--active-tab-text: #ffffff;`
        );
    }
    
    // Add wallpaper variables if wallpaper is set for this workspace
    if (workspaceWallpaper) {
        variables.push(`--desktop-wallpaper: url('${workspaceWallpaper}');`);
        variables.push(`--desktop-wallpaper-position: ${workspaceWallpaperPosition};`);
    }

    return variables.join('\n    ');
}

// Switch workspace theme using dataset attribute with smooth transition
async function switchWorkspaceTheme(workspaceId, skipAnimation = false) {
    closeSubMenu();

    const workspace = workspaces[workspaceId];
    
    if (!workspace) {
        console.warn('Workspace not found:', workspaceId);
        return;
    }

    // Skip animation on initial load
    if (!skipAnimation) {
        document.body.classList.add('workspace-transitioning');
    }
    document.body.setAttribute('data-workspace', workspaceId);
    
    // Notify desktop shortcuts of workspace change and wait for it to complete
    if (desktopShortcuts && desktopShortcuts.handleWorkspaceChange) {
        await desktopShortcuts.handleWorkspaceChange(workspaceId, skipAnimation);
    }
    
    // Also dispatch event for other listeners (fileSearch, notepadManager, etc.)
    document.dispatchEvent(new CustomEvent('workspaceChanged', {
        detail: { workspaceId: workspaceId }
    }));
    
    // Wait for the transition to complete before removing the transitioning class (skip on initial load)
    if (!skipAnimation) {
        // Since transitions happen on child elements (body.workspace-transitioning *),
        // and we know the exact duration is 4s, use a timeout for reliability
        await new Promise(resolve => {
            setTimeout(() => {
                document.body.classList.remove('workspace-transitioning');
                resolve();
            }, 4000);
        });
    }
}

// Set default background for workspace and tell service worker to cache it
async function setDefaultBackgroundForWorkspace(imageUrl) {
    try {
        // Get the first non-placeholder image from the current gallery
        if (!imageUrl) {
            return;
        }
        
        // Use the service worker manager to cache this as internal data
        if (window.serviceWorkerManager) {
            try {
                const success = await window.serviceWorkerManager.cacheInternalData(
                    '/internal/default_bg.jpg', 
                    { imageUrl: imageUrl, timestamp: Date.now() }
                );
                
                if (!success) {
                    console.warn('Failed to cache default background');
                }
            } catch (error) {
                console.warn('Failed to communicate with service worker:', error);
            }
        }
        
    } catch (error) {
        console.warn('Failed to set default background for workspace:', error);
    }
}

// Reference workspace move functions
async function moveCacheToDefaultWorkspace(cacheImage) {
    try {
        // Use WebSocket API if available, otherwise fall back to HTTP
        if (window.wsClient && window.wsClient.isConnected()) {
            try {
                await window.wsClient.moveFilesToWorkspace([cacheImage.hash], 'default');
            } catch (wsError) {
                showError('Failed to move cache file: ' + wsError.message);
                throw new Error('Failed to move cache file');
            }
        } else {
            showError('Failed to move cache file: WebSocket not connected');
            throw new Error('Failed to move cache file');
        }

        showGlassToast('success', null, 'Reference moved to default workspace', false, 5000, '<i class="fas fa-planet-ringed"></i>');
        await loadCacheImages();
        displayCacheImagesContainer();
    } catch (error) {
        showError('Failed to move cache file: ' + error.message);
    }
}

function showCacheMoveToWorkspaceModal(cacheImage) {
    // Create modal if it doesn't exist
    let modal = document.getElementById('cacheMoveToWorkspaceModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'cacheMoveToWorkspaceModal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>Move to Workspace</h3>
                    <button id="closeCacheMoveToWorkspaceBtn" class="btn-secondary btn-small"><i class="fas fa-times"></i></button>
                </div>
                <div class="modal-body">
                    <p>Select workspace to move cache file:</p>
                    <div class="workspace-move-list" id="cacheMoveWorkspaceList">
                        <!-- Workspace list will be populated here -->
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        // Close modal handlers

        document.getElementById('closeCacheMoveToWorkspaceBtn').addEventListener('click', () => {
            closeModal(modal);
        });
    }

    // Populate workspace list
    const workspaceList = document.getElementById('cacheMoveWorkspaceList');
    workspaceList.innerHTML = '';

    Object.values(workspaces).forEach(workspace => {
        const item = document.createElement('div');
        item.className = 'workspace-move-item';
        item.innerHTML = `
            <div class="workspace-move-info">
                <span class="workspace-name">${workspace.name}</span>
                ${workspace.id === activeWorkspace ? '<span class="badge-active"><i class="fas fa-check"></i></span>' : ''}
            </div>
        `;

        item.addEventListener('click', async () => {
            await closeModal(modal);
            await moveCacheToWorkspace(cacheImage, workspace.id);
        });

        workspaceList.appendChild(item);
    });

    openModal(modal);
}

async function moveCacheToWorkspace(cacheImage, workspaceId) {
    try {
        // Use WebSocket API if available, otherwise fall back to HTTP
        if (window.wsClient && window.wsClient.isConnected()) {
            try {
                await window.wsClient.moveFilesToWorkspace([cacheImage.hash], workspaceId);
            } catch (wsError) {
                showError('Failed to move cache file: ' + wsError.message);
                throw new Error('Failed to move cache file');
            }
        } else {
            showError('Failed to move cache file: WebSocket not connected');
            throw new Error('Failed to move cache file');
        }

        const workspace = workspaces[workspaceId];
        showGlassToast('success', null, `Reference file moved to ${workspace ? workspace.name : 'workspace'}`, false, 5000, '<i class="fas fa-planet-ringed"></i>');
        await loadCacheImages();
        displayCacheImagesContainer();
    } catch (error) {
        showError('Failed to move cache file: ' + error.message);
    }
}

// Workspace API functions
async function loadWorkspaces() {
    try {
        let isFirstLoad = false;
        
        // Use WebSocket API if available, otherwise fall back to HTTP
        if (window.wsClient && window.wsClient.isConnected()) {
            const data = await window.wsClient.getWorkspaces();
            
            // Check if workspaces have actually changed
            const newWorkspaces = {};
            data.workspaces.forEach(workspace => {
                // Normalize wallpaper path to 2-part format if present
                if (workspace.wallpaper) {
                    workspace.wallpaper = normalizeWallpaperPath(workspace.wallpaper);
                }
                newWorkspaces[workspace.id] = workspace;
            });
            
            const workspacesChanged = JSON.stringify(workspaces) !== JSON.stringify(newWorkspaces);
            isFirstLoad = Object.keys(workspaces).length === 0;
            
            // Update workspaces
            workspaces = newWorkspaces;
            activeWorkspace = data.activeWorkspace;
            
            // Only generate styles if this is the first load or if workspaces actually changed
            if (isFirstLoad || workspacesChanged) {
                generateAllWorkspaceStyles();
            }
        } else {
            showError('Failed to load workspaces: WebSocket not connected');
            throw new Error('Failed to load workspaces');
        }

        // Set initial workspace theme first, then update background (this will also notify desktop shortcuts)
        await switchWorkspaceTheme(activeWorkspace, isFirstLoad);

        // If desktop mode, switch from Windows Classic to Aero theme
        if (document.body.classList.contains('windows-classic-theme')) {
            // runWithThemeSwitchOverlay: public/scripts/app.js
            await runWithThemeSwitchOverlay(() => {
                loadBlurPreference();
                document.body.classList.remove('windows-classic-theme');
                document.body.classList.remove('no-animation');
            });
        } else {
            loadBlurPreference();
        }
        
        // Remove hard-set CSS variables after workspace theme is loaded (CSS will take over)
        document.documentElement.style.removeProperty('--workspace-color');
        document.documentElement.style.removeProperty('--workspace-background-color');
        document.documentElement.style.removeProperty('--desktop-wallpaper');
        document.documentElement.style.removeProperty('--desktop-wallpaper-position');

        renderWorkspaceDropdown();
        updateActiveWorkspaceDisplay();
        
        // Mark styles as initialized
        window.workspaceStylesInitialized = true;
    } catch (error) {
        showError('Failed to load workspaces: ' + error.message);
    }
}

// Initialize background layers
function initializeBackgrounds() {
    // Create background layers if they don't exist
    if (!document.querySelector('.page-background')) {
        // Create background container
        const backgroundContainer = document.createElement('div');
        backgroundContainer.className = 'background-container';
        backgroundContainer.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            z-index: -1;
            pointer-events: none;
        `;
        
        // Create current background layer
        const currentBg = document.createElement('div');
        currentBg.className = 'page-background current-bg';
        currentBg.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-size: cover;
            background-position: center;
            background-repeat: no-repeat;
            transition: opacity 0.3s ease-in-out;
            opacity: 1;
        `;
        
        // Create next background layer
        const nextBg = document.createElement('div');
        nextBg.className = 'page-background next-bg';
        nextBg.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-size: cover;
            background-position: center;
            background-repeat: no-repeat;
            transition: opacity 0.3s ease-in-out;
            opacity: 0;
        `;
        
        // Add layers to container
        backgroundContainer.appendChild(currentBg);
        backgroundContainer.appendChild(nextBg);
        
        // Insert at the beginning of body
        document.body.insertBefore(backgroundContainer, document.body.firstChild);
    }
    
    // Start automatic background system (async, but don't await to avoid blocking)
    startAutomaticBackgroundSystem().catch(error => {
        console.error('Failed to start automatic background system:', error);
    });
}

// Start automatic background system that cycles through gallery images
async function startAutomaticBackgroundSystem() {
    // Clear any existing interval
    if (automaticBackgroundInterval) {
        clearInterval(automaticBackgroundInterval);
    }
    
    // Check if service worker exists and wait for it if available
    // This helps prevent initial request spam before SW is active
    if (window.serviceWorkerManager && window.serviceWorkerManager.waitForServiceWorkerReady) {
        try {
            // Wait up to 2 seconds for SW to be ready, then continue anyway
            await Promise.race([
                window.serviceWorkerManager.waitForServiceWorkerReady(),
                new Promise(resolve => setTimeout(resolve, 2000))
            ]);
        } catch (error) {
            // Continue anyway - SW will add auth when it's ready
        }
    }
    
    // Set up interval to change background every 10 seconds
    automaticBackgroundInterval = setInterval(async () => {
        await updateAutomaticBackground();
    }, 10000); // 10 seconds
    
    // Initial background update - but only if gallery is ready
    if (isGalleryReady()) {
        updateAutomaticBackground();
    } else {
        console.log('🔄 Gallery not ready yet, will retry background setup when available');
        // Set up a retry mechanism to wait for gallery
        setupBackgroundRetry();
    }
}

// Check if gallery is ready with images
function isGalleryReady() {
    return allImages && Array.isArray(allImages) && allImages.length > 0;
}

// Set up retry mechanism for when gallery isn't ready
function setupBackgroundRetry() {
    // Check every 500ms if gallery is ready
    const retryInterval = setInterval(() => {
        if (isGalleryReady()) {
            clearInterval(retryInterval);
            // Now start the background system
            updateAutomaticBackground();
        }
    }, 500);
    
    // Give up after 30 seconds to prevent infinite retries
    setTimeout(() => {
        clearInterval(retryInterval);
        console.warn('⚠️ Gallery not ready after 30 seconds, background system may not work properly');
    }, 30000);
}

let lastBackgroundUrl = null;
let backgroundLoadFailCount = 0;
const MAX_BACKGROUND_FAIL_COUNT = 3;

// Update automatic background with next gallery image
async function updateAutomaticBackground() {
    if (backgroundTransitionInProgress) return;

    try {
        // Get the first non-placeholder image from the gallery
        const firstImage = getFirstGalleryImage();
        if (!firstImage) {  
            return;
        }
        
        // Get the blur preview image - encode the preview name to handle spaces and special characters
        const blurPreviewUrl = `/previews/${encodeURIComponent(firstImage.preview.replace('.webp', '@blur.webp'))}`;
        
        if (lastBackgroundUrl && lastBackgroundUrl === blurPreviewUrl) return;
        
        // Preload the image to ensure smooth transition
        await preloadImage(blurPreviewUrl);
        
        // Reset fail count on successful load
        backgroundLoadFailCount = 0;
        
        // Perform crossfade transition
        await performBackgroundTransition(blurPreviewUrl);
        setDefaultBackgroundForWorkspace(blurPreviewUrl);
        lastBackgroundUrl = blurPreviewUrl;
        
    } catch (error) {
        backgroundLoadFailCount++;
        
        // Only log the error if we haven't hit the max fail count
        // This prevents console spam (errors are also throttled in SW now)
        if (backgroundLoadFailCount <= MAX_BACKGROUND_FAIL_COUNT) {
            console.warn('Failed to update automatic background:', error);
            
            if (backgroundLoadFailCount === MAX_BACKGROUND_FAIL_COUNT) {
                console.warn('⚠️ Background updates failing repeatedly. Check service worker logs for issues.');
            }
        }
    }
}

// Get the first non-placeholder image from the gallery
function getFirstGalleryImage() {
    if (!allImages || !Array.isArray(allImages) || allImages.length === 0) {
        return null;
    }
    
    // Find first image that has a preview (non-placeholder)
    for (const image of allImages) {
        if (image.preview && image.preview !== 'static_images/placeholder.jpg') {
            return image;
        }
    }
    
    return null;
}

// Preload image to ensure smooth transition
function preloadImage(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(url);
        img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
        img.src = url;
        
        // Timeout after 5 seconds
        setTimeout(() => reject(new Error('Image preload timeout')), 5000);
    });
}

// Perform crossfade transition between background layers
async function performBackgroundTransition(newImageUrl) {
    if (backgroundTransitionInProgress || currentBackgroundImage === newImageUrl) return;
    
    backgroundTransitionInProgress = true;
    
    try {
        const currentBg = document.querySelector('.current-bg');
        const nextBg = document.querySelector('.next-bg');
        
        if (!currentBg || !nextBg) {
            throw new Error('Background elements not found');
        }
        
        // Set the new image on the next background layer
        nextBg.style.backgroundImage = `url("${newImageUrl}")`;
        nextBg.style.backgroundSize = 'cover';
        nextBg.style.backgroundPosition = 'center';
        nextBg.style.backgroundRepeat = 'no-repeat';
        
        // Start crossfade transition
        nextBg.style.opacity = '1';
        
        // Wait for transition to complete (3 seconds as per CSS)
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Swap the layers
        currentBg.style.backgroundImage = nextBg.style.backgroundImage;
        currentBg.style.backgroundSize = nextBg.style.backgroundSize;
        currentBg.style.backgroundPosition = nextBg.style.backgroundPosition;
        currentBg.style.backgroundRepeat = nextBg.style.backgroundRepeat;
        
        // Reset next background
        nextBg.style.opacity = '0';
        nextBg.style.backgroundImage = 'none';
        
        // Update current background tracking
        currentBackgroundImage = newImageUrl;
        
    } catch (error) {
        console.error('Background transition failed:', error);
    } finally {
        backgroundTransitionInProgress = false;
    }
}

// Ensure we have an initial background image when switching workspaces
async function ensureInitialBackgroundImage() {
    try {
        // Get the first non-placeholder image from the current gallery
        const firstImage = getFirstGalleryImage();
        if (!firstImage) {            // Wait for gallery to be ready
            await waitForGallery();
            // Try again
            const retryImage = getFirstGalleryImage();
            if (!retryImage) {
                console.log('❌ Still no gallery images available after waiting');
                return;
            }
            // Use the retry image
            const blurPreviewUrl = `/previews/${encodeURIComponent(retryImage.preview.replace('.webp', '@blur.webp'))}`;
            await setBackgroundImage(blurPreviewUrl);
            await setDefaultBackgroundForWorkspace(blurPreviewUrl);
        } else {
            // Get the blur preview image
            const blurPreviewUrl = `/previews/${encodeURIComponent(firstImage.preview.replace('.webp', '@blur.webp'))}`;
            await setBackgroundImage(blurPreviewUrl);
            await setDefaultBackgroundForWorkspace(blurPreviewUrl);
        }            
    } catch (error) {
        // Silently fail - automatic background system will retry
        // Error throttling is now handled in the service worker
    }
}

// Wait for gallery to be ready
function waitForGallery() {
    return new Promise((resolve) => {
        if (isGalleryReady()) {
            resolve();
            return;
        }
        
        // Check every 100ms if gallery is ready
        const checkInterval = setInterval(() => {
            if (isGalleryReady()) {
                clearInterval(checkInterval);
                resolve();
            }
        }, 100);
        
        // Give up after 10 seconds
        setTimeout(() => {
            clearInterval(checkInterval);
            resolve(); // Resolve anyway to prevent hanging
        }, 10000);
    });
}

// Set background image with proper styling
async function setBackgroundImage(blurPreviewUrl) {
    // Preload the image to ensure smooth display
    await preloadImage(blurPreviewUrl);

    // Set the initial background image on the current background layer
    const currentBg = document.querySelector('.current-bg');
    if (currentBg) {
        currentBg.style.backgroundImage = `url("${blurPreviewUrl}")`;
        currentBg.style.backgroundSize = 'cover';
        currentBg.style.backgroundPosition = 'center';
        currentBg.style.backgroundRepeat = 'no-repeat';
        
        // Update current background tracking
        currentBackgroundImage = blurPreviewUrl;
    }
}

// Generate color variations for bokeh circles with more variety
function generateColorVariations(baseColor) {
    // Convert hex to HSL for better color manipulation
    const hsl = hexToHsl(baseColor);

    // Generate variations with different hue shifts, saturation, and lightness
    const variations = [
        baseColor, // Original color
        hslToHex(hsl.h, hsl.s, Math.min(100, hsl.l + 15)), // Lighter
        hslToHex(hsl.h, hsl.s, Math.max(0, hsl.l - 20)), // Darker
        hslToHex((hsl.h + 15) % 360, Math.min(100, hsl.s + 10), hsl.l), // Slightly different hue
        hslToHex((hsl.h - 10 + 360) % 360, Math.max(0, hsl.s - 15), hsl.l), // Complementary direction
        hslToHex(hsl.h, Math.max(0, hsl.s - 20), Math.min(100, hsl.l + 10)), // Less saturated, lighter
        hslToHex((hsl.h + 25) % 360, Math.min(100, hsl.s + 5), Math.max(0, hsl.l - 15)), // Different hue, darker
        hslToHex(hsl.h, Math.max(0, hsl.s - 10), Math.min(100, hsl.l + 20)), // Less saturated, much lighter
        hslToHex((hsl.h - 20 + 360) % 360, hsl.s, Math.max(0, hsl.l - 25)), // Different hue, much darker
        hslToHex(hsl.h, Math.min(100, hsl.s + 15), Math.max(0, hsl.l - 10)) // More saturated, darker
    ];

    return variations;
}

// Generate background color (darker, more muted version of workspace color)
function generateBackgroundColor(baseColor) {
    const hsl = hexToHsl(baseColor);
    // Create a darker, more muted background color
    return hslToHex(hsl.h, Math.max(0, hsl.s - 30), Math.max(0, hsl.l - 40));
}

// Helper function to convert hex to HSL
function hexToHsl(hex) {
    // Remove # if present
    hex = hex.replace('#', '');

    // Parse hex values
    const r = parseInt(hex.substr(0, 2), 16) / 255;
    const g = parseInt(hex.substr(2, 2), 16) / 255;
    const b = parseInt(hex.substr(4, 2), 16) / 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;

    if (max === min) {
        h = s = 0; // achromatic
    } else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }

    return {
        h: Math.round(h * 360),
        s: Math.round(s * 100),
        l: Math.round(l * 100)
    };
}

// Helper function to convert HSL to hex
function hslToHex(h, s, l) {
    h /= 360;
    s /= 100;
    l /= 100;

    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((h * 6) % 2 - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;

    if (0 <= h && h < 1/6) {
        r = c; g = x; b = 0;
    } else if (1/6 <= h && h < 1/3) {
        r = x; g = c; b = 0;
    } else if (1/3 <= h && h < 1/2) {
        r = 0; g = c; b = x;
    } else if (1/2 <= h && h < 2/3) {
        r = 0; g = x; b = c;
    } else if (2/3 <= h && h < 5/6) {
        r = x; g = 0; b = c;
    } else if (5/6 <= h && h <= 1) {
        r = c; g = 0; b = x;
    }

    const rHex = Math.round((r + m) * 255).toString(16).padStart(2, '0');
    const gHex = Math.round((g + m) * 255).toString(16).padStart(2, '0');
    const bHex = Math.round((b + m) * 255).toString(16).padStart(2, '0');

    return `#${rHex}${gHex}${bHex}`;
}

// Helper function to add transparency to a hex color
function addTransparency(hexColor, alpha) {
    // Remove # if present
    hexColor = hexColor.replace('#', '');

    // Convert alpha to hex (0-255)
    const alphaHex = Math.round(alpha * 255).toString(16).padStart(2, '0');

    // Return hex color with alpha
    return `#${hexColor}${alphaHex}`;
}

// Helper function to convert hex to RGB object
function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : { r: 0, g: 0, b: 0 };
}

// Helper function to brighten a color
function brightenColor(hexColor, factor = 1.2) {
    const rgb = hexToRgb(hexColor);
    const brightenedR = Math.min(255, Math.round(rgb.r * factor));
    const brightenedG = Math.min(255, Math.round(rgb.g * factor));
    const brightenedB = Math.min(255, Math.round(rgb.b * factor));
    
    return `#${brightenedR.toString(16).padStart(2, '0')}${brightenedG.toString(16).padStart(2, '0')}${brightenedB.toString(16).padStart(2, '0')}`;
}

// Helper function to adjust colors for theme compatibility
function adjustColorForTheme(baseColor, statusType) {
    const hsl = hexToHsl(baseColor);
    const isLightTheme = document.body.classList.contains('light-theme') || 
                        window.matchMedia('(prefers-color-scheme: light)').matches;
    
    // Adjust based on status type and theme
    switch (statusType) {
        case 'warning':
            // For warning colors (like yellow), reduce brightness in light themes
            if (isLightTheme || hsl.l > 70) {
                hsl.l = Math.max(20, hsl.l * 0.6); // Reduce lightness by 40%
                hsl.s = Math.min(100, hsl.s * 1.2); // Increase saturation slightly
            }
            break;
        case 'error':
            // For error colors, ensure good contrast
            if (isLightTheme || hsl.l > 80) {
                hsl.l = Math.max(25, hsl.l * 0.7); // Reduce lightness by 30%
            }
            break;
        case 'success':
            // For success colors, adjust for visibility
            if (isLightTheme || hsl.l > 75) {
                hsl.l = Math.max(20, hsl.l * 0.65); // Reduce lightness by 35%
            }
            break;
        case 'info':
            // For info colors, maintain good contrast
            if (isLightTheme || hsl.l > 80) {
                hsl.l = Math.max(25, hsl.l * 0.7); // Reduce lightness by 30%
            }
            break;
    }
    
    return hslToHex(hsl.h, hsl.s, hsl.l);
}

async function createWorkspace(name) {
    let result;
    try {
        // Use WebSocket API if available, otherwise fall back to HTTP
        if (window.wsClient && window.wsClient.isConnected()) {
            result = await window.wsClient.createWorkspace(name);

            // Use the response data to update local state instead of reloading everything
            if (result && result.workspace) {
                // Add the new workspace to local state
                workspaces[result.workspace.id] = result.workspace;

                // Only regenerate styles if this affects the current theme
                if (result.workspace.id === activeWorkspace) {
                    generateAllWorkspaceStyles();
                    switchWorkspaceTheme(activeWorkspace);
                }

                // Update UI components that need the new workspace
                renderWorkspaceDropdown();
                updateActiveWorkspaceDisplay();
            }
        } else {
            showError('Failed to create workspace: WebSocket not connected');
            throw new Error('Failed to create workspace');
        }

        showGlassToast('success', null, `Workspace "${name}" created!`);
        return result; // Return the WebSocket response
    } catch (error) {
        console.error('Error creating workspace:', error);
        showError('Failed to create workspace: ' + error.message);
        throw error;
    }
}

async function renameWorkspace(id, newName) {
    try {
        if (id === 'default') return;
        
        // Use WebSocket API if available, otherwise fall back to HTTP
        if (window.wsClient && window.wsClient.isConnected()) {
            await window.wsClient.renameWorkspace(id, newName);
        } else {
            showError('Failed to rename workspace: WebSocket not connected');
            throw new Error('Failed to rename workspace');
        }
    } catch (error) {
        console.error('Error renaming workspace:', error);
        showError('Failed to rename workspace: ' + error.message);
    }
}

async function deleteWorkspace(id) {
    try {
        // Use WebSocket API if available, otherwise fall back to HTTP
        if (window.wsClient && window.wsClient.isConnected()) {
            const result = await window.wsClient.deleteWorkspace(id);
            
            // Use the response data to update local state efficiently
            if (result && result.success) {
                // Remove the deleted workspace from local state
                delete workspaces[id];
                
                // If the deleted workspace was active, switch to default
                if (id === activeWorkspace) {
                    activeWorkspace = 'default';
                    switchWorkspaceTheme(activeWorkspace);
                }
                
                // Update UI components
                renderWorkspaceDropdown();
                updateActiveWorkspaceDisplay();
                
                // Only refresh gallery if it's currently visible
                if (!document.getElementById('gallery')?.classList.contains('hidden')) {
                    switchGalleryView(currentGalleryView, true);
                }
            }
        } else {
            showError('Failed to delete workspace: WebSocket not connected');
            throw new Error('Failed to delete workspace');
        }

        showGlassToast('success', null, 'Workspace deleted', false, 5000, '<i class="fas fa-trash"></i>');
    } catch (error) {
        console.error('Error deleting workspace:', error);
        showError('Failed to delete workspace: ' + error.message);
    }
}

async function dumpWorkspace(sourceId, targetId) {
    try {
        // Use WebSocket API if available, otherwise fall back to HTTP
        if (window.wsClient && window.wsClient.isConnected()) {
            const result = await window.wsClient.dumpWorkspace(sourceId, targetId);
            
            // Use the response data to update local state efficiently
            if (result && result.success) {
                // Update file counts for affected workspaces
                if (workspaces[sourceId]) {
                    workspaces[sourceId].fileCount = (workspaces[sourceId].fileCount || 0) - (result.movedCount || 0);
                }
                if (workspaces[targetId]) {
                    workspaces[targetId].fileCount = (workspaces[targetId].fileCount || 0) + (result.movedCount || 0);
                }
                    
                // Update UI components
                renderWorkspaceDropdown();
                
                // Only refresh gallery if it's currently visible
                if (!document.getElementById('gallery')?.classList.contains('hidden')) {
                    switchGalleryView(currentGalleryView, true);
                }
            }
        } else {
            showError('Failed to dump workspace: WebSocket not connected');
            throw new Error('Failed to dump workspace');
        }

        showGlassToast('success', null, 'Workspace Dumped');
    } catch (error) {
        console.error('Error dumping workspace:', error);
        showError('Failed to dump workspace: ' + error.message);
    }
}

// Show workspace switching progress modal
function showWorkspaceProgressModal(workspaceName) {
    if (!window.isDesktop) {
        // Fall back to toast for non-desktop mode
        workspaceToastId = showGlassToast('info', 'Teleporting', `Switching to ${workspaceName} planet...`, false, false, '<img class="loading" src="/static_images/azuspin.gif" alt="Loading" style="width: 34px; height: 34px;">');
        return;
    }

    // Create progress modal using confirmation dialog
    const progressHtml = `
        <div style="text-align: left; display: flex; flex-direction: column; gap: 8px;">
            <div role="progressbar" class="marquee animate" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-label="Workspace switching progress">
                <div id="workspaceProgressBar"></div>
            </div>
            <div id="workspaceProgressText" style="display: flex; justify-content: space-between; align-items: center;">
                <span style="color: var(--text-accent);">${workspaceName}</span>
                <span style="color: var(--text-accent-tinted);">Preparing...</span>
            </div>
        </div>
    `;

    workspaceProgressModal = showConfirmationDialog(
        progressHtml,
        [], // No buttons - this is a progress modal
        typeof createGalleryWindowCenterEvent === 'function' ? createGalleryWindowCenterEvent() : null,
        {
            title: `Change Workspace`,
            icon: 'fas fa-planet-ringed',
            showCloseButton: false,
            width: 400,
            manualPosition: true
        }
    );

    // Store references to progress elements after modal is created
    setTimeout(() => {
        workspaceProgressBarElement = document.getElementById('workspaceProgressBar');
        workspaceProgressTextElement = document.getElementById('workspaceProgressText');
        workspaceProgressContainerElement = workspaceProgressBarElement ? workspaceProgressBarElement.parentElement : null;
    }, 100);
}

// Shared label for gallery chunk loading (public/scripts/comp/galleryView.js loadCompleteGallery)
function formatGalleryBlocksProgressLabel(progress) {
    if (progress && (progress.phase === 'hash_probe' || progress.suppressBlocks === true)) {
        return '';
    }
    if (progress && typeof progress.blocksLeft === 'number') {
        const n = progress.blocksLeft;
        return `${n} Block${n === 1 ? '' : 's'} Left`;
    }
    // Prefer a block-based estimate over item counts when blocksLeft is absent.
    if (progress && typeof progress.total === 'number' && progress.total > 0) {
        const chunkSize = Number(progress.chunkSize) > 0 ? Number(progress.chunkSize) : 750;
        const loadedItems = Math.max(0, Number(progress.loaded) || 0);
        const totalBlocks = Math.ceil(progress.total / chunkSize);
        const completedBlocks = Math.min(totalBlocks, Math.ceil(loadedItems / chunkSize));
        const blocksLeft = Math.max(0, totalBlocks - completedBlocks);
        return `${blocksLeft} Block${blocksLeft === 1 ? '' : 's'} Left`;
    }
    return '---';
}

// Marquee until first gallery block loads (public/scripts/websocket.js formatPaginationGroupTickerText)
function shouldGalleryProgressUseDeterminate(progress) {
    if (!progress || progress.phase === 'hash_probe' || progress.suppressBlocks === true) {
        return false;
    }
    const loaded = Number(progress.loaded) || 0;
    if (loaded <= 0) {
        return false;
    }
    if (typeof progress.blocksLeft === 'number') {
        return true;
    }
    return progress.progress >= 1;
}

function formatGalleryProgressStatusText(progress) {
    if (!progress || progress.phase === 'hash_probe' || progress.suppressBlocks === true) {
        return 'Loading...';
    }
    const detail = formatGalleryBlocksProgressLabel(progress);
    const suffix = detail ? ` (${detail})` : '';
    return `Loading Gallery${suffix}`;
}

function formatWorkspaceProgressStatusText(progress) {
    if (!progress || progress.phase === 'hash_probe' || progress.suppressBlocks === true) {
        return 'Preparing...';
    }
    const detail = formatGalleryBlocksProgressLabel(progress);
    const suffix = detail ? ` (${detail})` : '';
    if (progress.phase === 'initial') {
        return `Preparing Workspace${suffix}`;
    }
    return formatGalleryProgressStatusText(progress);
}

function applyGalleryProgressBarState(container, bar, progress, modeSwitchedRef) {
    if (!container || !bar || !progress) {
        return modeSwitchedRef.value;
    }

    const useDeterminate = shouldGalleryProgressUseDeterminate(progress);
    if (useDeterminate && !modeSwitchedRef.value) {
        container.classList.remove('marquee');
        modeSwitchedRef.value = true;
    }

    if (useDeterminate) {
        const percent = Math.round(progress.progress * 100);
        bar.style.width = `${percent}%`;
        if (container.hasAttribute('role') && container.getAttribute('role') === 'progressbar') {
            container.setAttribute('aria-valuenow', percent);
        }
    } else if (container.hasAttribute('role') && container.getAttribute('role') === 'progressbar') {
        container.setAttribute('aria-valuenow', 0);
    }

    return modeSwitchedRef.value;
}

// Update workspace progress modal
function updateWorkspaceProgress(progress) {
    if (!workspaceProgressModal) return;

    const modeRef = { value: workspaceProgressModeSwitched };

    if (workspaceProgressBarElement && workspaceProgressTextElement) {
        workspaceProgressModeSwitched = applyGalleryProgressBarState(
            workspaceProgressContainerElement,
            workspaceProgressBarElement,
            progress,
            modeRef
        );

        const statusSpan = workspaceProgressTextElement.querySelector('span:last-child');
        if (statusSpan) {
            statusSpan.textContent = formatWorkspaceProgressStatusText(progress);
        }
    } else {
        const progressBar = document.getElementById('workspaceProgressBar');
        const progressText = document.getElementById('workspaceProgressText');
        const progressContainer = progressBar ? progressBar.parentElement : null;

        if (progressBar && progressText) {
            workspaceProgressModeSwitched = applyGalleryProgressBarState(
                progressContainer,
                progressBar,
                progress,
                modeRef
            );

            const statusSpan = progressText.querySelector('span:last-child');
            if (statusSpan) {
                statusSpan.textContent = formatWorkspaceProgressStatusText(progress);
            }
        }
    }
}

// Hide workspace progress modal
function hideWorkspaceProgressModal() {
    if (workspaceProgressModal) {
        hideConfirmationDialog();
        workspaceProgressModal = null;
    }

    // Clear stored references and reset mode flag
    workspaceProgressBarElement = null;
    workspaceProgressTextElement = null;
    workspaceProgressContainerElement = null;
    workspaceProgressModeSwitched = false;
}

async function setActiveWorkspace(id) {
    try {
        // Set flag to prevent duplicate calls
        isWorkspaceSwitching = true;
        window.isWorkspaceSwitching = true;

        // Save any pending desktop shortcut changes before switching workspaces
        if (desktopShortcuts && desktopShortcuts.pendingChanges) {
            if (desktopShortcuts.saveDebounceTimer) {
                clearTimeout(desktopShortcuts.saveDebounceTimer);
            }
            await desktopShortcuts.saveToServer();
        }

        // Show progress modal or toast
        const targetWorkspace = workspaces[id];
        const workspaceName = targetWorkspace ? targetWorkspace.name : id;
        showWorkspaceProgressModal(workspaceName);

        // Fade out gallery
        if (gallery) {
            gallery.style.opacity = '0';
        }

        // Wait for fade out
        await new Promise(resolve => setTimeout(resolve, 300));

        // Use WebSocket API if available, otherwise fall back to HTTP
        if (window.wsClient && window.wsClient.isConnected()) {
            await window.wsClient.setActiveWorkspace(id);
        } else {
            showError('Failed to set active workspace: WebSocket not connected');
            throw new Error('Failed to set active workspace');
        }

        activeWorkspace = id;
        window.currentWorkspace = id;

        // Don't call switchWorkspaceTheme here - let the WebSocket event handle it
        // This prevents duplicate theme switching
    } catch (error) {
        console.error('Error setting active workspace:', error);
        showError('Failed to set active workspace: ' + error.message);

        // Ensure gallery is visible even on error
        if (gallery) {
            gallery.style.opacity = 1;
        }
        
        // Hide workspace progress modal/toast on error
        hideWorkspaceProgressModal();
        if (workspaceToastId) {
            removeGlassToast(workspaceToastId);
            workspaceToastId = null;
        }
        
        // Clear the workspace switching flag on error
        isWorkspaceSwitching = false;
        window.isWorkspaceSwitching = false;
    }
}

async function moveFilesToWorkspace(filenames, targetWorkspaceId) {
    try {
        let result;
        
        // Use WebSocket API if available, otherwise fall back to HTTP
        if (window.wsClient && window.wsClient.isConnected()) {
            result = await window.wsClient.moveFilesToWorkspace(filenames, targetWorkspaceId);
            
            // Use the response data to update local state efficiently
            if (result && result.success) {
                // Update file counts for affected workspaces
                if (workspaces[targetWorkspaceId]) {
                    workspaces[targetWorkspaceId].fileCount = (workspaces[targetWorkspaceId].fileCount || 0) + (result.movedCount || 0);
                }
                
                // Update UI components
                renderWorkspaceDropdown();
                
                // Only refresh gallery if it's currently visible
                if (!document.getElementById('gallery')?.classList.contains('hidden')) {
                    switchGalleryView(currentGalleryView, true);
                }
            }
        } else {
            showError('Failed to move files: WebSocket not connected');
            throw new Error('Failed to move files');
        }

        showGlassToast('success', null, `Moved ${result.movedCount} files to workspace`, false, 5000, '<i class="mdi mdi-1-5 mdi-folder-move"></i>');
    } catch (error) {
        console.error('Error moving files to workspace:', error);
        showError('Failed to move files: ' + error.message);
    }
}

// Efficiently update workspace data from WebSocket responses
function updateWorkspaceData(workspaceId, updates) {
    if (!workspaces[workspaceId]) return;
    
    // Update local workspace data
    Object.assign(workspaces[workspaceId], updates);
    
    // Only regenerate styles if this affects the current theme
    if (workspaceId === activeWorkspace) {
        // For color/background changes, use the more efficient single workspace update
        if (updates.color || updates.backgroundColor) {
            generateWorkspaceStyles(workspaceId);
            switchWorkspaceTheme(activeWorkspace);
        }
    }
    
    // Update UI components
    renderWorkspaceDropdown();
    updateActiveWorkspaceDisplay();
}

// Update workspace color
async function updateWorkspaceColor(id, color) {
    try {
        // Use WebSocket API if available, otherwise fall back to HTTP
        if (window.wsClient && window.wsClient.isConnected()) {
            const result = await window.wsClient.updateWorkspaceColor(id, color);
            
            // Use response data to update local state efficiently
            if (result && result.success) {
                updateWorkspaceData(id, { color });
            }
        } else {
            showError('Failed to update workspace color: WebSocket not connected');
            throw new Error('Failed to update workspace color');
        }
    } catch (error) {
        console.error('Error updating workspace color:', error);
        showError('Failed to update workspace color: ' + error.message);
    }
}

// Update workspace background color
async function updateWorkspaceBackgroundColor(id, backgroundColor) {
    try {
        // Use WebSocket API if available, otherwise fall back to HTTP
        if (window.wsClient && window.wsClient.isConnected()) {
            const result = await window.wsClient.updateWorkspaceBackgroundColor(id, backgroundColor);
            
            // Use response data to update local state efficiently
            if (result && result.success) {
                updateWorkspaceData(id, { backgroundColor });
            }
        } else {
            showError('Failed to update workspace background color: WebSocket not connected');
            throw new Error('Failed to update workspace background color');
        }
    } catch (error) {
        console.error('Error updating workspace background color:', error);
        showError('Failed to update workspace background color: ' + error.message);
    }
}

// Workspace UI functions
function renderWorkspaceDropdown(selectedVal) {
    const workspaceMenu = document.getElementById('workspaceDropdownMenu');
    if (!workspaceMenu) return;

    workspaceMenu.innerHTML = '';

    // Sort workspaces by their sort order - workspaces is an object, not an array
    const sortedWorkspaces = Object.values(workspaces).sort((a, b) => (a.sort || 0) - (b.sort || 0));

    sortedWorkspaces.forEach(workspace => {
        const option = document.createElement('div');
        // Use activeWorkspace variable instead of workspace.isActive property
        const isActive = workspace.id === activeWorkspace;
        option.className = 'custom-dropdown-option' + (isActive ? ' selected' : '');
        option.tabIndex = 0;
        option.dataset.value = workspace.id;

        option.innerHTML = `
            <div class="workspace-option-content">
                <div class="workspace-color-indicator" style="background-color: ${workspace.color || '#102040'}"></div>
                <span class="workspace-name">${workspace.name}</span>
                <span class="workspace-counts">${workspace.fileCount} files</span>
            </div>
        `;

        const action = () => {
            if (!isActive) {
                setActiveWorkspace(workspace.id);
            }
            closeWorkspaceDropdown();
        };

        option.addEventListener('click', action);
        option.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') {
                action();
            }
        });

        workspaceMenu.appendChild(option);
    });
}

function updateActiveWorkspaceDisplay() {
    const workspaceSelected = document.querySelectorAll('.workspace-name');
    if (!workspaceSelected.length) return;

    const activeWorkspaceData = workspaces[activeWorkspace];
    if (activeWorkspaceData) {
        workspaceSelected.forEach(workspace => {
            workspace.textContent = activeWorkspaceData.name;
        });
    }

    // Update manual workspace dropdown to match active workspace
    manualSelectedWorkspace = activeWorkspace;
    updateManualWorkspaceDisplay();
}

/**
 * Update manual workspace dropdown display
 */
function updateManualWorkspaceDisplay() {
    const workspaceData = workspaces[manualSelectedWorkspace];
    if (workspaceData && manualWorkspaceSelected && manualWorkspaceColorIndicator) {
        manualWorkspaceSelected.textContent = workspaceData.name;
        manualWorkspaceColorIndicator.style.backgroundColor = workspaceData.color || '#102040';
        if (manualWorkspaceHidden) {
            manualWorkspaceHidden.value = manualSelectedWorkspace;
        }
    } else if (manualWorkspaceSelected) {
        manualWorkspaceSelected.textContent = 'Select workspace...';
        if (manualWorkspaceColorIndicator) {
            manualWorkspaceColorIndicator.style.backgroundColor = 'transparent';
        }
    }
}
function openWorkspaceDropdown() {
    openDropdown(document.getElementById('workspaceDropdownMenu'), document.getElementById('workspaceDropdownBtn'));
}

function closeWorkspaceDropdown() {
    closeDropdown(document.getElementById('workspaceDropdownMenu'), document.getElementById('workspaceDropdownBtn'));
}

function renderWorkspaceManagementList() {
    const list = document.getElementById('workspaceManageList');
    if (!list) return;

    list.innerHTML = '';

    // Sort workspaces by their sort order - workspaces is an object, not an array
    const sortedWorkspaces = Object.values(workspaces).sort((a, b) => (a.sort || 0) - (b.sort || 0));

    sortedWorkspaces.forEach(workspace => {
        const item = document.createElement('div');
        item.className = 'workspace-manage-item';
        item.dataset.workspaceId = workspace.id;

        item.innerHTML = `
            <div class="workspace-drag-handle" title="Drag to reorder">
                <i class="fas fa-grip-vertical"></i>
            </div>
            <div class="workspace-manage-info">
                <div class="workspace-header">
                    <div class="workspace-color-indicator" style="background-color: ${workspace.color || '#102040'}"></div>
                    <h5>${workspace.name} ${workspace.id === activeWorkspace ? '<span class="badge-active"><i class="fas fa-check"></i></span>' : ''}</h5>
                </div>
                <div class="workspace-manage-counts"><div class="workspace-manage-counts-files"><span>${workspace.fileCount}</span><i class="fas fa-image"></i></div><div class="workspace-manage-counts-references"><span>${workspace.cacheFileCount}</span><i class="fas fa-swatchbook"></i></div></div>
            </div>
            <div class="workspace-manage-actions button-group">
                <button type="button" class="btn-secondary" onclick="editWorkspaceSettings('${workspace.id}')" title="Workspace Settings">
                    <i class="fas fa-cog"></i>
                </button>
                ${!workspace.isDefault ? `
                    <button type="button" class="btn-secondary" onclick="showDumpWorkspaceModal('${workspace.id}', '${workspace.name}')" title="Dump">
                        <i class="mdi mdi-1-5 mdi-folder-move"></i>
                    </button>
                    <button type="button" class="btn-secondary text-danger" onclick="confirmDeleteWorkspace('${workspace.id}', '${workspace.name}')" title="Delete">
                        <i class="fas fa-trash"></i>
                    </button>
                ` : ''}
            </div>
        `;

        list.appendChild(item);
    });

    // Initialize drag and drop functionality
    initializeWorkspaceDragAndDrop();
}

// Workspace modal functions
function showWorkspaceManagementModal() {
    renderWorkspaceManagementList();
    const modal = document.getElementById('workspaceManageModal');
    openModal(modal);
    
    // Register event listeners when modal is shown
    registerWorkspaceManagerEventListeners();
}

async function hideWorkspaceManagementModal() {
    const modal = document.getElementById('workspaceManageModal');
    if (modal) await closeModal(modal);
    
    // Deregister event listeners when modal is hidden
    deregisterWorkspaceManagerEventListeners();
    
    switchWorkspaceTheme(activeWorkspace);
}

function showAddWorkspaceModal() {
    currentWorkspaceOperation = { type: 'add' };
    document.getElementById('workspaceNameInput').classList.remove('hidden');
    document.getElementById('workspaceColorInput').classList.remove('hidden');
    document.getElementById('workspaceBackgroundColorInput').classList.remove('hidden');
    document.getElementById('workspaceNameInput').value = '';
    document.getElementById('workspaceColorInput').value = '#102040';
    document.getElementById('workspaceBackgroundColorInput').value = '#0a1a2a';
    const modal = document.getElementById('workspaceEditModal');
    openModal(modal);
}

async function editWorkspaceSettings(id) {
    currentWorkspaceOperation = { type: 'settings', id };
    document.getElementById('workspaceNameInput').classList.remove('hidden');
    document.getElementById('workspaceColorInput').classList.remove('hidden');
    document.getElementById('workspaceBackgroundColorInput').classList.remove('hidden');

    // Get workspace data
    const workspace = workspaces[id];
    if (workspace) {
        // Set current values
        document.getElementById('workspaceNameInput').value = workspace.name;
        document.getElementById('workspaceColorInput').value = workspace.color || '#102040';
        document.getElementById('workspaceBackgroundColorInput').value = workspace.backgroundColor || '#0a1a2a';
        // Set font dropdown labels
        const primaryFontSelected = document.getElementById('workspacePrimaryFontSelected');
        const textareaFontSelected = document.getElementById('workspaceTextareaFontSelected');
        if (primaryFontSelected) primaryFontSelected.textContent = workspace.primaryFont || 'Default';
        if (textareaFontSelected) textareaFontSelected.textContent = workspace.textareaFont || 'Default';

        // Ensure color pickers reflect the loaded values visually
        try {
            const colorInputEl = document.getElementById('workspaceColorInput');
            const bgColorInputEl = document.getElementById('workspaceBackgroundColorInput');
            if (colorInputEl) {
                colorInputEl.style.background = colorInputEl.value;
                colorInputEl.style.borderColor = brightenColor(colorInputEl.value, 1.25);
                colorInputEl.style.color = '#fff';
            }
            if (bgColorInputEl) {
                bgColorInputEl.style.background = bgColorInputEl.value;
                bgColorInputEl.style.borderColor = brightenColor(bgColorInputEl.value, 1.25);
                bgColorInputEl.style.color = '#fff';
            }
        } catch (e) { /* no-op */ }
    }

    const modal = document.getElementById('workspaceEditModal');
    if (modal) openModal(modal);
}

async function hideWorkspaceEditModal() {
    const modal = document.getElementById('workspaceEditModal');
    if (modal) await closeModal(modal);

    // Reset form
    document.getElementById('workspaceNameInput').classList.remove('hidden');
    document.getElementById('workspaceColorInput').classList.remove('hidden');
    document.getElementById('workspaceBackgroundColorInput').classList.remove('hidden');
    document.getElementById('workspaceNameInput').value = '';
    document.getElementById('workspaceColorInput').value = '#102040';
    document.getElementById('workspaceBackgroundColorInput').value = '#0a1a2a';

    currentWorkspaceOperation = null;
}

function showDumpWorkspaceModal(sourceId, sourceName) {
    document.getElementById('dumpSourceWorkspaceName').textContent = sourceName;

    const select = document.getElementById('dumpTargetSelect');
    select.innerHTML = '';

    Object.values(workspaces).forEach(workspace => {
        if (workspace.id !== sourceId) {
            const option = document.createElement('option');
            option.value = workspace.id;
            option.textContent = workspace.name;
            select.appendChild(option);
        }
    });

    currentWorkspaceOperation = { type: 'dump', sourceId };
    const modal = document.getElementById('workspaceDumpModal');
    if (modal) openModal(modal);
}

async function hideWorkspaceDumpModal() {
    const modal = document.getElementById('workspaceDumpModal');
    if (modal) await closeModal(modal);
    currentWorkspaceOperation = null;
}

async function confirmDeleteWorkspace(id, name) {
    const confirmed = await showConfirmationDialog(
        `Are you sure you want to delete the workspace "${name}"?\n\nAll items will be moved to the default workspace.`,
        [
            { text: 'Delete', value: true, className: 'btn-danger' },
            { text: 'Cancel', value: false, className: 'btn-secondary' }
        ]
    );
    if (confirmed) {
        deleteWorkspace(id);
    }
}

// Initialize workspace system
function initializeWorkspaceSystem() {
    // Setup workspace dropdown using standard custom dropdown system
    const workspaceDropdown = document.getElementById('workspaceDropdown');
    const workspaceDropdownBtn = document.getElementById('workspaceDropdownBtn');
    const workspaceDropdownMenu = document.getElementById('workspaceDropdownMenu');

    setupDropdown(workspaceDropdown, workspaceDropdownBtn, workspaceDropdownMenu, renderWorkspaceDropdown, () => activeWorkspace);

    // Workspace action button events
    const workspaceManageBtn = document.getElementById('workspaceManageBtn');
    const workspaceAddBtn = document.getElementById('workspaceAddBtn');

    if (workspaceManageBtn) {
        workspaceManageBtn.addEventListener('click', (e) => {
            e.preventDefault();
            showWorkspaceManagementModal();
            closeSubMenu();
        });
    }

    if (workspaceAddBtn) {
        workspaceAddBtn.addEventListener('click', (e) => {
            e.preventDefault();
            showAddWorkspaceModal();
        });
    }
    
    // Modal close events
    document.getElementById('closeWorkspaceManageBtn')?.addEventListener('click', (e) => {
        e.preventDefault();
        hideWorkspaceManagementModal();
    });
    document.getElementById('closeWorkspaceEditBtn')?.addEventListener('click', (e) => {
        e.preventDefault();
        hideWorkspaceEditModal();
    });
    document.getElementById('closeWorkspaceDumpBtn')?.addEventListener('click', (e) => {
        e.preventDefault();
        hideWorkspaceDumpModal();
    });
    document.getElementById('workspaceCancelBtn')?.addEventListener('click', (e) => {
        e.preventDefault();
        hideWorkspaceEditModal();
    });
    document.getElementById('workspaceDumpCancelBtn')?.addEventListener('click', (e) => {
        e.preventDefault();
        hideWorkspaceDumpModal();
    });



    // Bulk change preset modal events
    document.getElementById('closeBulkChangePresetBtn')?.addEventListener('click', (e) => {
        e.preventDefault();
        closeModal(document.getElementById('bulkChangePresetModal'));
    });
    document.getElementById('bulkChangePresetCancelBtn')?.addEventListener('click', (e) => {
        e.preventDefault();
        closeModal(document.getElementById('bulkChangePresetModal'));
    });
    document.getElementById('bulkChangePresetConfirmBtn')?.addEventListener('click', (e) => {
        e.preventDefault();
        handleBulkChangePresetConfirm(e);
    });

    // Save workspace
    document.getElementById('workspaceSaveBtn')?.addEventListener('click', async (e) => {
        e.preventDefault();
        if (currentWorkspaceOperation) {
            if (currentWorkspaceOperation.type === 'add') {
                const name = document.getElementById('workspaceNameInput').value.trim();
                const color = document.getElementById('workspaceColorInput').value.trim();
                const backgroundColor = document.getElementById('workspaceBackgroundColorInput').value.trim();
                const primaryFont = (workspaces[activeWorkspace]?.primaryFont) || null;
                const textareaFont = (workspaces[activeWorkspace]?.textareaFont) || null;

                if (!name) {
                    showError('Please enter a workspace name');
                    return;
                }
                // Create workspace then push all settings at once
                const createResponse = await createWorkspace(name);
                if (createResponse && createResponse.success && createResponse.id) {
                    await window.wsClient.updateWorkspaceSettings(createResponse.id, {
                        name,
                        color,
                        backgroundColor: backgroundColor || null,
                        primaryFont,
                        textareaFont,
                        wallpaper: null,
                        wallpaperPosition: null
                    });
                    await loadWorkspaces();
                } else {
                    showError('Failed to create workspace. Please try again.');
                }
            } else if (currentWorkspaceOperation.type === 'rename') {
                const name = document.getElementById('workspaceNameInput').value.trim();
                if (!name) {
                    showError('Please enter a workspace name');
                    return;
                }
                await renameWorkspace(currentWorkspaceOperation.id, name);
            } else if (currentWorkspaceOperation.type === 'settings') {
                const name = document.getElementById('workspaceNameInput').value.trim();
                const color = document.getElementById('workspaceColorInput').value.trim();
                const backgroundColor = document.getElementById('workspaceBackgroundColorInput').value.trim();
                const primaryFont = (workspaces[currentWorkspaceOperation.id]?.primaryFont) || null;
                const textareaFont = (workspaces[currentWorkspaceOperation.id]?.textareaFont) || null;
                const wallpaper = (workspaces[currentWorkspaceOperation.id]?.wallpaper) || null;
                const wallpaperPosition = (workspaces[currentWorkspaceOperation.id]?.wallpaperPosition) || null;

                if (!name) {
                    showError('Please enter a workspace name');
                    return;
                }

                // Push all changed settings at once
                await window.wsClient.updateWorkspaceSettings(currentWorkspaceOperation.id, {
                    name,
                    color,
                    backgroundColor: backgroundColor || null,
                    primaryFont,
                    textareaFont,
                    wallpaper,
                    wallpaperPosition
                });
                await loadWorkspaces();

                // Update background if this is the active workspace
                if (currentWorkspaceOperation.id === activeWorkspace) {
                    switchWorkspaceTheme(activeWorkspace);
                }
            }
        }

        hideWorkspaceEditModal();
    });

    // Dump workspace
    document.getElementById('workspaceDumpConfirmBtn')?.addEventListener('click', async (e) => {
        e.preventDefault();
        const targetId = document.getElementById('dumpTargetSelect').value;
        if (!targetId) {
            showError('Please select a target workspace');
            return;
        }

        if (currentWorkspaceOperation && currentWorkspaceOperation.type === 'dump') {
            await dumpWorkspace(currentWorkspaceOperation.sourceId, targetId);
        }

        hideWorkspaceDumpModal();
    });
    
    // Generate all workspace styles and set initial theme
    if (Object.keys(workspaces).length > 0) {
        generateAllWorkspaceStyles();
        switchWorkspaceTheme(activeWorkspace);
    } else {
        document.body.setAttribute('data-workspace', 'default');
    }
    
    // Set up a flag to track if styles have been initialized
    window.workspaceStylesInitialized = true;
}

// Initialize workspace settings form event listeners
function initializeWorkspaceSettingsForm() {
    // Live styling for color pickers themselves (apply chosen color to their background and border)
    const colorInput = document.getElementById('workspaceColorInput');
    const bgColorInput = document.getElementById('workspaceBackgroundColorInput');

    const styleColorPicker = (inputEl, hex) => {
        if (!inputEl || !hex) return;
        inputEl.style.background = hex; // 100% opacity
        inputEl.style.borderColor = brightenColor(hex, 1.25); // brighter border
        inputEl.style.color = '#fff';
        inputEl.style.borderStyle = 'solid';
        inputEl.style.borderWidth = '1px';
    };

    if (colorInput) {
        styleColorPicker(colorInput, colorInput.value);
        colorInput.addEventListener('input', (e) => styleColorPicker(colorInput, e.target.value));
    }

    if (bgColorInput) {
        styleColorPicker(bgColorInput, bgColorInput.value);
        bgColorInput.addEventListener('input', (e) => styleColorPicker(bgColorInput, e.target.value));
    }

    // Primary font dropdown setup (selection stored locally; sent on Save)
    const primaryFontContainer = document.getElementById('workspacePrimaryFontDropdown');
    const primaryFontBtn = document.getElementById('workspacePrimaryFontDropdownBtn');
    const primaryFontMenu = document.getElementById('workspacePrimaryFontDropdownMenu');
    const primaryFontSelected = document.getElementById('workspacePrimaryFontSelected');
    if (primaryFontContainer && primaryFontBtn && primaryFontMenu && primaryFontSelected) {
        const renderPrimaryFontMenu = async (selectedVal = '') => {
            const groups = [
                {
                    group: 'Available Fonts',
                    options: AVAILABLE_PRIMARY_FONTS.map(f => ({
                        value: f.value,
                        label: f.label,
                        preview: f.preview,
                        fontFamily: f.value ? `'${f.value}', sans-serif` : f.fontFamily || "var(--font-primary)",
                    }))
                }
            ];
            renderGroupedDropdown(primaryFontMenu, groups, (value) => {
                const id = currentWorkspaceOperation?.id || activeWorkspace;
                if (workspaces[id]) workspaces[id].primaryFont = value || null;
                const def = AVAILABLE_PRIMARY_FONTS.find(f => f.value === value) || AVAILABLE_PRIMARY_FONTS[0];
                primaryFontSelected.textContent = def.label || 'Default';
                primaryFontSelected.style.fontFamily = def.value ? `'${def.value}', sans-serif` : (def.fontFamily || 'var(--font-primary)');
                closeDropdown(primaryFontMenu, primaryFontBtn);
            }, () => closeDropdown(primaryFontMenu, primaryFontBtn), selectedVal, (opt) => {
                return `<span style=\"font-family:${opt.fontFamily};\">${opt.label || 'Default'}</span>`;
            });
        };

        setupDropdown(primaryFontContainer, primaryFontBtn, primaryFontMenu, async () => {
            const id = currentWorkspaceOperation?.id || activeWorkspace;
            const selected = (workspaces[id]?.primaryFont) || '';
            await renderPrimaryFontMenu(selected);
        }, () => {
            const id = currentWorkspaceOperation?.id || activeWorkspace;
            return (workspaces[id]?.primaryFont) || '';
        }, { enableKeyboardNav: true });

        // Initialize selected label + preview
        const initialId = currentWorkspaceOperation?.id || activeWorkspace;
        const initialVal = (workspaces[initialId]?.primaryFont) || '';
        const initDef = AVAILABLE_PRIMARY_FONTS.find(f => f.value === initialVal) || AVAILABLE_PRIMARY_FONTS[0];
        primaryFontSelected.textContent = initDef.label || 'Default';
        primaryFontSelected.style.fontFamily = initDef.value ? `'${initDef.value}', sans-serif` : (initDef.fontFamily || 'var(--font-primary)');
    }

    // Textarea font dropdown setup (selection stored locally; sent on Save)
    const textareaFontContainer = document.getElementById('workspaceTextareaFontDropdown');
    const textareaFontBtn = document.getElementById('workspaceTextareaFontDropdownBtn');
    const textareaFontMenu = document.getElementById('workspaceTextareaFontDropdownMenu');
    const textareaFontSelected = document.getElementById('workspaceTextareaFontSelected');
    if (textareaFontContainer && textareaFontBtn && textareaFontMenu && textareaFontSelected) {
        const renderTextareaFontMenu = async (selectedVal = '') => {
            const groups = [
                {
                    group: 'Available Fonts',
                    options: AVAILABLE_TEXTAREA_FONTS.map(f => ({
                        value: f.value,
                        label: f.label,
                        preview: f.preview,
                        fontFamily: f.value ? `'${f.value}', monospace` : f.fontFamily || "var(--font-mono)",
                    }))
                }
            ];
            renderGroupedDropdown(textareaFontMenu, groups, (value) => {
                const id = currentWorkspaceOperation?.id || activeWorkspace;
                if (workspaces[id]) workspaces[id].textareaFont = value || null;
                const def = AVAILABLE_TEXTAREA_FONTS.find(f => f.value === value) || AVAILABLE_TEXTAREA_FONTS[0];
                textareaFontSelected.textContent = def.label || 'Default';
                textareaFontSelected.style.fontFamily = def.value ? `'${def.value}', monospace` : (def.fontFamily || 'var(--font-mono)');
                closeDropdown(textareaFontMenu, textareaFontBtn);
            }, () => closeDropdown(textareaFontMenu, textareaFontBtn), selectedVal, (opt) => {
                return `<span style=\"font-family:${opt.fontFamily};\">${opt.label || 'Default'}</span>`;
            });
        };

        setupDropdown(textareaFontContainer, textareaFontBtn, textareaFontMenu, async () => {
            const id = currentWorkspaceOperation?.id || activeWorkspace;
            const selected = (workspaces[id]?.textareaFont) || '';
            await renderTextareaFontMenu(selected);
        }, () => {
            const id = currentWorkspaceOperation?.id || activeWorkspace;
            return (workspaces[id]?.textareaFont) || '';
        }, { enableKeyboardNav: true });

        // Initialize selected label + preview
        const initialId2 = currentWorkspaceOperation?.id || activeWorkspace;
        const initialVal2 = (workspaces[initialId2]?.textareaFont) || '';
        const initDef2 = AVAILABLE_TEXTAREA_FONTS.find(f => f.value === initialVal2) || AVAILABLE_TEXTAREA_FONTS[0];
        textareaFontSelected.textContent = initDef2.label || 'Default';
        textareaFontSelected.style.fontFamily = initDef2.value ? `'${initDef2.value}', monospace` : (initDef2.fontFamily || 'var(--font-mono)');
    }
}

// Register initialization steps with WebSocket client
if (window.wsClient) {
    document.addEventListener('galleryUpdated', () => {
        console.log('🔄 Gallery updated, ensuring background system is active');
        if (isGalleryReady() && !currentBackgroundImage) {
            // If we don't have a background image yet, set one now
            ensureInitialBackgroundImage();
        }
    });
    
    window.wsClient.registerInitStep(11, 'Initializing workspace system', async () => {
        initializeWorkspaceSystem();
    });
    window.wsClient.registerInitStep(12, 'Loading Workspaces', async () => {
        await loadWorkspaces();
    }, true);
    // Other tasks after wallpaper
    window.wsClient.registerInitStep(14, 'Setting up workspace events', async () => {
        initializeWebSocketWorkspaceEvents();
    });
    
    window.wsClient.registerInitStep(15, 'Setting up workspace settings', async () => {
        initializeWorkspaceSettingsForm();
    });
    
    // Enable taskbar after other workspace tasks are done
    window.wsClient.registerInitStep(16, 'Starting Taskbar', async () => {
        if (window.isDesktop) {
            const taskbar = document.getElementById('desktopTaskbar');
            taskbar.classList.remove('hidden');
        }
    }, true);
    window.wsClient.registerInitStep(87, 'Initializing background layers', async () => {
        initializeBackgrounds();
    });
} else {
    throw new Error('WebSocket client not initialized');
}

// Initialize WebSocket workspace event listeners
function initializeWebSocketWorkspaceEvents() {
    // Listen for workspace updates from WebSocket
    document.addEventListener('workspaceUpdated', async (event) => {
        const data = event.detail;
        
        // Handle different types of workspace updates
        switch (data.action) {
            case 'created':
                // Add new workspace to local state
                if (data.workspace) {
                    workspaces[data.workspace.id] = data.workspace;
                }
                
                // Only regenerate styles if this is the first workspace or if it affects current theme
                const isFirstWorkspace = Object.keys(workspaces).length === 1;
                if (isFirstWorkspace || data.workspace.id === activeWorkspace) {
                    generateAllWorkspaceStyles();
                    switchWorkspaceTheme(activeWorkspace);
                }
                
                // Update UI components that need the new workspace
                renderWorkspaceDropdown();
                updateActiveWorkspaceDisplay();
                
                // If workspace management modal is open, refresh it
                const workspaceManageModal = document.getElementById('workspaceManageModal');
                if (workspaceManageModal && !workspaceManageModal.classList.contains('hidden')) {
                    renderWorkspaceManagementList();
                }
                break;
                
            case 'renamed':
                // Update local workspace data
                if (data.workspace && workspaces[data.workspace.id]) {
                    workspaces[data.workspace.id].name = data.workspace.name;
                }
                
                // Update UI components
                renderWorkspaceDropdown();
                updateActiveWorkspaceDisplay();
                
                // If workspace management modal is open, refresh it
                const workspaceManageModalRenamed = document.getElementById('workspaceManageModal');
                if (workspaceManageModalRenamed && !workspaceManageModalRenamed.classList.contains('hidden')) {
                    renderWorkspaceManagementList();
                }
                break;
                
            case 'deleted':
                // Remove deleted workspace from local state
                if (data.workspaceId && workspaces[data.workspaceId]) {
                    delete workspaces[data.workspaceId];
                }
                
                // Update UI components
                renderWorkspaceDropdown();
                updateActiveWorkspaceDisplay();
                
                // If workspace management modal is open, refresh it
                const workspaceManageModalDeleted = document.getElementById('workspaceManageModal');
                if (workspaceManageModalDeleted && !workspaceManageModalDeleted.classList.contains('hidden')) {
                    renderWorkspaceManagementList();
                }
                break;
                
            case 'dumped':
                // Update file counts for affected workspaces
                if (data.sourceWorkspaceId && workspaces[data.sourceWorkspaceId]) {
                    workspaces[data.sourceWorkspaceId].fileCount = Math.max(0, (workspaces[data.sourceWorkspaceId].fileCount || 0) - (data.movedCount || 0));
                }
                if (data.targetWorkspaceId && workspaces[data.targetWorkspaceId]) {
                    workspaces[data.targetWorkspaceId].fileCount = (workspaces[data.targetWorkspaceId].fileCount || 0) + (data.movedCount || 0);
                }
                
                // Update UI components
                renderWorkspaceDropdown();
                
                // If workspace management modal is open, refresh it
                const workspaceManageModalDumped = document.getElementById('workspaceManageModal');
                if (workspaceManageModalDumped && !workspaceManageModalDumped.classList.contains('hidden')) {
                    renderWorkspaceManagementList();
                }
                break;
                
            case 'reordered':
                // Update local workspace sort order based on the new workspaceIds
                if (data.workspaceIds && Array.isArray(data.workspaceIds)) {
                    data.workspaceIds.forEach((workspaceId, index) => {
                        if (workspaces[workspaceId]) {
                            workspaces[workspaceId].sort = index;
                        }
                    });
                }

                // Remove loading state from all workspace items
                const workspaceManageList = document.getElementById('workspaceManageList');
                if (workspaceManageList) {
                    const items = workspaceManageList.querySelectorAll('.workspace-manage-item');
                    items.forEach(item => {
                        item.style.opacity = '';
                        item.style.pointerEvents = '';
                        const loadingIndicator = item.querySelector('.workspace-reorder-loading');
                        if (loadingIndicator) {
                            loadingIndicator.remove();
                        }
                    });
                }

                // Update UI components that show the new order
                renderWorkspaceDropdown();
                updateActiveWorkspaceDisplay();

                // If workspace management modal is open, refresh it
                const workspaceManageModalAfterReorder = document.getElementById('workspaceManageModal');
                if (workspaceManageModalAfterReorder && !workspaceManageModalAfterReorder.classList.contains('hidden')) {
                    renderWorkspaceManagementList();
                }
                break;
                
            case 'files_moved':
                // Update file counts for affected workspaces
                if (data.sourceWorkspaceId && workspaces[data.sourceWorkspaceId]) {
                    workspaces[data.sourceWorkspaceId].fileCount = Math.max(0, (workspaces[data.sourceWorkspaceId].fileCount || 0) - (data.movedCount || 0));
                }
                if (data.targetWorkspaceId && workspaces[data.targetWorkspaceId]) {
                    workspaces[data.targetWorkspaceId].fileCount = (workspaces[data.targetWorkspaceId].fileCount || 0) + (data.movedCount || 0);
                }
                
                // Update UI components
                renderWorkspaceDropdown();
                
                break;
                
            case 'scrap_added':
            case 'scrap_removed':
                // Optimize: Use local updates instead of full refresh
                if (!document.getElementById('gallery')?.classList.contains('hidden') && data.filename) {
                    const gallery = document.getElementById('gallery');
                    const image = findImageByFilename(data.filename);
                    if (image) {
                        if ((currentGalleryView === 'images' && data.action === 'scrap_added') || (currentGalleryView === 'scraps' && data.action === 'scrap_removed')) {
                            // Remove from images view when moved to scraps
                            removeImageFromGallery(image);
                        } else if (currentGalleryView === 'scraps' && data.action === 'scrap_added') {
                            // Image added to scraps - if not in current view, we'd need to add it
                            // But since we're in scraps view, it should already be there or we refresh
                            // For now, only refresh if image not found (it might be a new scrap)
                            scrollPositionPreservationEnabled = true;
                            preserveScrollPosition();
                            await switchGalleryView(currentGalleryView, true);
                            restoreScrollPosition();
                        }
                    } else if (currentGalleryView === 'scraps' && data.action === 'scrap_added') {
                        // Image not found locally, might be a new scrap - refresh to get it
                        scrollPositionPreservationEnabled = true;
                        preserveScrollPosition();
                        await switchGalleryView(currentGalleryView, true);
                        restoreScrollPosition();
                    }
                }
                break;
                
            case 'pinned_added':
            case 'pinned_removed':
                // Optimize: Update pin status locally and update gallery without full refresh
                if (!document.getElementById('gallery')?.classList.contains('hidden') && data.filename) {
                    const gallery = document.getElementById('gallery');
                    const image = findImageByFilename(data.filename);
                    if (image) {
                        // Update local pin status
                        image.isPinned = (data.action === 'pinned_added');
                        
                        // Update pin buttons in gallery
                        if (typeof updateGalleryPinButtons === 'function') {
                            updateGalleryPinButtons(data.filename, image.isPinned);
                        }
                        
                        // If viewing 'pinned' view, add/remove item locally
                        if (currentGalleryView === 'pinned') {
                            if (data.action === 'pinned_removed') {
                                // Remove from pinned view when unpinned
                                removeImageFromGallery(image);
                            } else if (data.action === 'pinned_added') {
                                // Image was pinned - check if it's already in the gallery
                                const existingItem = gallery.querySelector(`[data-filename="${data.filename}"]`);
                                if (!existingItem) {
                                    // Not in gallery - the image was just pinned and needs to be added
                                    // Since pinned view has its own sorted allImages, we need to refresh
                                    // to get the updated list with the new pinned image in the correct position
                                    scrollPositionPreservationEnabled = true;
                                    preserveScrollPosition();
                                    await switchGalleryView(currentGalleryView, true);
                                    restoreScrollPosition();
                                }
                                // If existingItem exists, it's already in the gallery, buttons already updated above
                            }
                        }
                        // If not viewing pinned view, buttons are already updated above, no gallery change needed
                    } else if (currentGalleryView === 'pinned' && data.action === 'pinned_added') {
                        // Image not found locally but was pinned - refresh to get it
                        scrollPositionPreservationEnabled = true;
                        preserveScrollPosition();
                        await switchGalleryView(currentGalleryView, true);
                        restoreScrollPosition();
                    }
                }
                break;
                
            case 'bulk_pinned_added':
            case 'bulk_pinned_removed':
                // For bulk operations, refresh is more efficient than individual updates
                if (!document.getElementById('gallery')?.classList.contains('hidden')) {
                    scrollPositionPreservationEnabled = true;
                    preserveScrollPosition();
                    await switchGalleryView(currentGalleryView, true);
                    restoreScrollPosition();
                }
                break;
                
            case 'group_created':
            case 'group_renamed':
            case 'group_deleted':
            case 'images_added_to_group':
            case 'images_removed_from_group':
                // Group operations don't affect gallery display directly, but refresh to be safe
                if (!document.getElementById('gallery')?.classList.contains('hidden')) {
                    scrollPositionPreservationEnabled = true;
                    preserveScrollPosition();
                    await switchGalleryView(currentGalleryView, true);
                    restoreScrollPosition();
                }
                break;
                
            case 'settings_updated':
                // Only process if this is for an existing workspace
                if (!data.workspaceId || !workspaces[data.workspaceId]) {
                    break;
                }
                
                const workspace = workspaces[data.workspaceId];
                let styleUpdateNeeded = false;
                
                // Apply settings updates from the settings object (bulk update)
                if (data.settings) {
                    if (data.settings.name !== undefined) {
                        workspace.name = data.settings.name;
                    }
                    if (data.settings.color !== undefined) {
                        workspace.color = data.settings.color;
                        styleUpdateNeeded = true;
                    }
                    if (data.settings.backgroundColor !== undefined) {
                        workspace.backgroundColor = data.settings.backgroundColor;
                        styleUpdateNeeded = true;
                    }
                    if (data.settings.primaryFont !== undefined) {
                        workspace.primaryFont = data.settings.primaryFont;
                        styleUpdateNeeded = true;
                    }
                    if (data.settings.textareaFont !== undefined) {
                        workspace.textareaFont = data.settings.textareaFont;
                        styleUpdateNeeded = true;
                    }
                    if (data.settings.wallpaper !== undefined) {
                        workspace.wallpaper = data.settings.wallpaper;
                        styleUpdateNeeded = true;
                    }
                    if (data.settings.wallpaperPosition !== undefined) {
                        workspace.wallpaperPosition = data.settings.wallpaperPosition;
                        styleUpdateNeeded = true;
                    }
                }
                
                // Only regenerate styles if this is the active workspace AND a style-affecting property changed
                if (styleUpdateNeeded) {
                    generateWorkspaceStyles(data.workspaceId);
                    if (data.workspaceId === activeWorkspace){
                        switchWorkspaceTheme(activeWorkspace);
                    }
                }
                
                // Update UI components
                renderWorkspaceDropdown();
                updateActiveWorkspaceDisplay();
                
                // Only refresh gallery if it's currently visible
                if (!document.getElementById('gallery')?.classList.contains('hidden')) {
                    switchGalleryView(currentGalleryView, true);
                }
                break;
        }
    });

    // Listen for workspace activation from WebSocket
    document.addEventListener('workspaceActivated', async (event) => {
        const data = event.detail;
        
        // Update active workspace and refresh UI
        activeWorkspace = data.workspaceId;
        
        // Update workspace settings immediately (this will also notify desktop shortcuts)
        const workspace = workspaces[activeWorkspace];
        if (workspace) {
            switchWorkspaceTheme(activeWorkspace);
        }
        
        // Refresh UI components (no need to reload workspaces)
        renderWorkspaceDropdown();
        updateActiveWorkspaceDisplay();
        
        // Set up the completion callback and load gallery
        window.workspaceLoadingCompleteCallback = completeWorkspaceSwitch;
        await switchGalleryView(currentGalleryView || 'images', true, updateWorkspaceProgress);        
        
        // Clear the workspace switching flag
        isWorkspaceSwitching = false;
        window.isWorkspaceSwitching = false;
    });
}

// Function to complete workspace switching after gallery data is received
function completeWorkspaceSwitch() {
    window.workspaceLoadingCompleteCallback = null;
    
    // Fade in gallery
    const gallery = document.getElementById('gallery');
    if (gallery) {
        gallery.style.opacity = '';
    }
    
    // Hide workspace progress modal/toast
    hideWorkspaceProgressModal();
    if (workspaceToastId) {
        removeGlassToast(workspaceToastId);
        workspaceToastId = null;
    }
    
    // Clear the workspace switching flag
    isWorkspaceSwitching = false;
    window.isWorkspaceSwitching = false;
}

// Initialize drag and drop functionality for workspace reordering
function initializeWorkspaceDragAndDrop() {
    const list = document.getElementById('workspaceManageList');
    if (!list) {
        return;
    }

    let draggedItem = null;
    let draggedIndex = null;

    // Add event listeners to drag handles
    const dragHandles = list.querySelectorAll('.workspace-drag-handle');
    
    dragHandles.forEach((handle, index) => {
        handle.addEventListener('mousedown', startDrag);
        handle.addEventListener('touchstart', startDrag, { passive: false });
        handle.addEventListener('touchmove', onDrag, { passive: false });
        handle.addEventListener('touchend', endDrag);
    });

    function startDrag(e) {
        e.preventDefault();
        e.stopPropagation();

        const item = e.target.closest('.workspace-manage-item');
        if (!item) {
            return;
        }

        draggedItem = item;
        draggedIndex = Array.from(list.children).indexOf(item);

        // Add dragging class
        draggedItem.classList.add('dragging');

        // Add event listeners for drag movement - only mouse events on document
        document.addEventListener('mousemove', onDrag);
        document.addEventListener('mouseup', endDrag);

        // Prevent text selection during drag
        document.body.style.userSelect = 'none';

    }

    function onDrag(e) {
        if (!draggedItem) {
            return;
        }

        e.preventDefault();

        // Handle both mouse and touch events
        let clientY;
        if (e.type === 'mousemove') {
            clientY = e.clientY;
        } else if (e.type === 'touchmove' && e.touches.length > 0) {
            clientY = e.touches[0].clientY;
        } else {
            return; // No valid input
        }

        const rect = list.getBoundingClientRect();
        const mouseY = clientY - rect.top;

        // Find the item under the mouse
        const items = Array.from(list.children);
        let targetIndex = draggedIndex;

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const itemRect = item.getBoundingClientRect();
            const itemTop = itemRect.top - rect.top;
            const itemBottom = itemTop + itemRect.height;

            if (mouseY >= itemTop && mouseY <= itemBottom) {
                targetIndex = i;
                break;
            }
        }

        // Move the dragged item to new position
        if (targetIndex !== draggedIndex) {
            
            // Remove drag-over class from all items
            items.forEach(item => item.classList.remove('drag-over'));
            
            // Actually move the item in the DOM
            if (targetIndex < items.length) {
                list.insertBefore(draggedItem, items[targetIndex]);
            } else {
                list.appendChild(draggedItem);
            }
            
            // Add drag-over class to new position
            const newItems = Array.from(list.children);
            const newIndex = newItems.indexOf(draggedItem);
            if (newIndex < newItems.length) {
                newItems[newIndex].classList.add('drag-over');
            }
            
            draggedIndex = targetIndex;
        }
    }

    function endDrag(e) {
        if (!draggedItem) {
            return;
        }

        e.preventDefault();

        // Remove document event listeners
        document.removeEventListener('mousemove', onDrag);
        document.removeEventListener('mouseup', endDrag);

        // Remove dragging classes
        draggedItem.classList.remove('dragging');
        const items = Array.from(list.children);
        items.forEach(item => item.classList.remove('drag-over'));

        // Restore text selection
        document.body.style.userSelect = '';

        // Get new order based on current DOM position
        const newOrder = Array.from(list.children).map(item => item.dataset.workspaceId);
        
        // Show loading state on the dragged item
        draggedItem.style.opacity = '0.6';
        draggedItem.style.pointerEvents = 'none';
        
        // Add a small loading indicator
        const loadingIndicator = document.createElement('div');
        loadingIndicator.className = 'workspace-reorder-loading';
        loadingIndicator.innerHTML = '<i class="fas fa-spinner-third fa-spin"></i>';
        loadingIndicator.style.cssText = `
            position: absolute;
            top: 50%;
            right: 10px;
            transform: translateY(-50%);
            color: var(--primary-color);
            font-size: 14px;
        `;
        draggedItem.appendChild(loadingIndicator);
        
        // Update the backend and wait for response
        reorderWorkspaces(newOrder).then(() => {
            // The UI will be updated when we receive the 'reordered' WebSocket event
        }).catch((error) => {
            // Remove loading state on error
            draggedItem.style.opacity = '';
            draggedItem.style.pointerEvents = '';
            const loadingIndicator = draggedItem.querySelector('.workspace-reorder-loading');
            if (loadingIndicator) {
                loadingIndicator.remove();
            }
            // Show error message
            showError('Failed to reorder workspaces: ' + error.message);
        });

        // Clear dragged item
        draggedItem = null;
        draggedIndex = null;
    }
}

// Event listener management for workspace manager
let workspaceManagerEventListenersRegistered = false;

function registerWorkspaceManagerEventListeners() {
    if (workspaceManagerEventListenersRegistered) return;
    
    // Initialize drag and drop functionality
    initializeWorkspaceDragAndDrop();
    
    workspaceManagerEventListenersRegistered = true;
}

function deregisterWorkspaceManagerEventListeners() {
    if (!workspaceManagerEventListenersRegistered) return;
    
    // Note: The drag and drop event listeners are added to individual elements
    // and are automatically cleaned up when the modal is closed
    // We just need to mark that we're not registered anymore
    
    workspaceManagerEventListenersRegistered = false;
}

// Reorder workspaces via WebSocket
async function reorderWorkspaces(workspaceIds) {
    try {
        if (window.wsClient && window.wsClient.isConnected()) {
            await window.wsClient.reorderWorkspaces(workspaceIds);
        } else {
            showError('Failed to reorder workspaces: WebSocket not connected');
            throw new Error('Failed to reorder workspaces');
        }
    } catch (error) {
        showError('Failed to reorder workspaces: ' + error.message);
    }
}

function refreshWorkspaceManager() {
    // Only refresh the UI components, don't reload all workspaces
    renderWorkspaceDropdown();
    updateActiveWorkspaceDisplay();
    
    const workspaceManageModal = document.getElementById('workspaceManageModal');
    if (workspaceManageModal && !workspaceManageModal.classList.contains('hidden')) {
        renderWorkspaceManagementList();
    }
}