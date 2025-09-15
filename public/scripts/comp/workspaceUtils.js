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

// Automatic background system
let automaticBackgroundInterval = null;
let currentBackgroundImage = null;
let nextBackgroundImage = null;
let backgroundTransitionInProgress = false;

// Fonts available for selection (match loaded @font-face names in css/fonts.css)
const AVAILABLE_PRIMARY_FONTS = [
    { value: '', label: 'Default', fontFamily: "var(--font-primary)" },
    { value: 'Noto Sans', label: 'Noto Sans' },
    { value: 'Noto Sans JP', label: 'Noto Sans JP' },
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
        const cssVariables = generateWorkspaceCSSVariables(workspaceColor, workspaceBackgroundColor, resolvedPrimaryFont, resolvedTextareaFont, false);
        
        // Generate CSS variables for this workspace when blur is disabled
        const cssVariablesDark = generateWorkspaceCSSVariables(workspaceColor, workspaceBackgroundColor, resolvedPrimaryFont, resolvedTextareaFont, true);
        
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
    const cssVariables = generateWorkspaceCSSVariables(workspaceColor, workspaceBackgroundColor, resolvedPrimaryFont, resolvedTextareaFont, false);
    const cssVariablesDark = generateWorkspaceCSSVariables(workspaceColor, workspaceBackgroundColor, resolvedPrimaryFont, resolvedTextareaFont, true);
    
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

// Generate CSS variables for a specific workspace
function generateWorkspaceCSSVariables(workspaceColor, workspaceBackgroundColor, primaryFont = '', textareaFont = '', isBlurDisabled = false) {
    // Color adjustment variables for consistent theming
    const BADGE_LIGHTNESS_1 = 25; // Much darker first badge color
    const BADGE_LIGHTNESS_2 = 35; // Much darker second badge color
    const HOVER_SHOW_COLORED_LIGHTNESS = 94; // Light colored text
    const GLASS_TINT_SATURATION = 15; // Glass tint saturation
    const GLASS_TINT_LIGHTNESS_FACTOR = 0.4; // Glass tint lightness factor
    const GLASS_TINT_MIN_LIGHTNESS = 10; // Minimum glass tint lightness
    
    // Toggle button color variables
    const TOGGLE_ON_LIGHTNESS = 30; // Toggle on state lightness
    const TOGGLE_ON_SATURATION = 85; // Toggle on state saturation
    const TOGGLE_ON_HOVER_LIGHTNESS = 35; // Toggle on hover state lightness
    const TOGGLE_ON_HOVER_SATURATION = 80; // Toggle on hover state saturation
    const TOGGLE_SHADOW_LIGHTNESS = 5; // Toggle shadow lightness (darker)
    const TOGGLE_SHADOW_SATURATION = 60; // Toggle shadow saturation (more saturated)
    
    // Round button color variables
    const ROUND_SECONDARY_LIGHTNESS = 3; // Round secondary button lightness
    const ROUND_SECONDARY_SATURATION = 85; // Round secondary button saturation   
    
    // Convert workspace color to HSL for direct manipulation
    const workspaceHsl = hexToHsl(workspaceColor);
    const workspaceBackgroundHsl = hexToHsl(workspaceBackgroundColor);

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
    ];

    // Fonts: if provided, set per-workspace font variables used by styles.css
    if (primaryFont && typeof primaryFont === 'string') {
        variables.push(`--font-primary: '${primaryFont}', 'Noto Sans', 'Noto Sans JP', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;`);
    }
    if (textareaFont && typeof textareaFont === 'string') {
        variables.push(`--font-mono: '${textareaFont}', 'Share Tech Mono', 'Noto Sans', 'Noto Sans JP', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;`);
    }

    // Set button hover and shadow colors with workspace theming
    const brightenedHsl = {
        h: workspaceHsl.h,
        s: workspaceHsl.s,
        l: Math.min(100, workspaceHsl.l * 1.3) // 30% brighter
    };
    
    variables.push(
        `--btn-hover-bg-primary: radial-gradient(hsl(${brightenedHsl.h} ${brightenedHsl.s}% ${brightenedHsl.l}% / 38%), hsl(${brightenedHsl.h} ${brightenedHsl.s}% ${brightenedHsl.l}% / 84%));`,
        `--btn-hover-border-primary: hsl(${brightenedHsl.h} ${brightenedHsl.s}% ${brightenedHsl.l}% / 80%);`,
        `--btn-hover-text-primary: #ffffff;`,
        `--btn-shadow-primary: hsl(${workspaceHsl.h} ${workspaceHsl.s}% ${workspaceHsl.l}% / 89%);`,
        `--btn-shadow-primary-glow: 0 2px 16px hsl(${workspaceHsl.h} ${workspaceHsl.s}% ${workspaceHsl.l}% / 89%);`
    );

    // Set secondary button hover using workspace background color
    const bgTintedHsl = {
        h: workspaceBackgroundHsl.h,
        s: Math.max(0, workspaceBackgroundHsl.s * 0.05), // Much reduced saturation
        l: Math.min(100, 95 + workspaceBackgroundHsl.l * 0.05) // Very light
    };
    
    variables.push(
        `--btn-hover-bg-secondary: radial-gradient(hsl(${bgTintedHsl.h} ${bgTintedHsl.s}% ${bgTintedHsl.l}% / 21%), hsl(${bgTintedHsl.h} ${bgTintedHsl.s}% ${bgTintedHsl.l}% / 38%));`,
        `--btn-shadow-secondary-glow: 0 8px 20px hsl(${bgTintedHsl.h} ${bgTintedHsl.s}% ${bgTintedHsl.l}% / 33%);`
    );

    // Set hover-show active colors using workspace color with original saturation and lightness
    const originalSaturation = 86; // Original orange saturation
    const originalLightness = 43;   // Original orange lightness
    
    variables.push(
        `--hover-show-active-bg: hsl(${workspaceHsl.h} ${originalSaturation}% ${originalLightness}% / 66%);`,
        `--hover-show-active-border: hsl(${workspaceHsl.h} ${originalSaturation}% ${originalLightness}% / 20%);`,
        `--hover-show-active-shadow: 0 8px 20px hsl(${workspaceHsl.h} ${originalSaturation}% ${originalLightness}% / 55%);`
    );

    // Set dropdown hover and selected colors using workspace background color
    variables.push(
        `--dropdown-hover-bg: hsl(${workspaceBackgroundHsl.h} ${workspaceBackgroundHsl.s}% ${workspaceBackgroundHsl.l}% / 50%);`,
        `--dropdown-selected-bg: hsl(${workspaceBackgroundHsl.h} ${workspaceBackgroundHsl.s}% ${workspaceBackgroundHsl.l}% / 90.3%);`,
        `--dropdown-keyboard-selected-bg: hsl(${workspaceHsl.h} ${workspaceHsl.s}% ${workspaceHsl.l}% / 80%);`,
        `--dropdown-keyboard-selected-border: hsl(${workspaceHsl.h} ${workspaceHsl.s}% ${workspaceHsl.l}%);`
    );

    // Set badge colors using workspace background color
    variables.push(
        `--badge-bg: hsl(${workspaceHsl.h} ${originalSaturation}% ${originalLightness}% / 80%);`,
        `--badge-text: #ffffff;`,
        `--badge-shadow: 0 1px 3px hsl(${workspaceHsl.h} ${originalSaturation}% ${originalLightness}% / 30%);`
    );

    // Set custom dropdown badge colors using workspace background color with darker values
    variables.push(
        `--custom-dropdown-badge-bg: linear-gradient(45deg, hsl(${workspaceHsl.h} ${workspaceHsl.s}% ${BADGE_LIGHTNESS_1}%), hsl(${workspaceHsl.h} ${workspaceHsl.s}% ${BADGE_LIGHTNESS_2}%));`,
        `--custom-dropdown-badge-text: #ffffff;`
    );

    // Set hover-show colored text using workspace color with consistent lightness
    variables.push(`--hover-show-colored-text: hsl(${workspaceHsl.h} 100% ${HOVER_SHOW_COLORED_LIGHTNESS}%);`);
    
    // Set toggle button colors using workspace color with consistent lightness
    variables.push(
        `--toggle-on-bg: hsl(${workspaceHsl.h} ${TOGGLE_ON_SATURATION}% ${TOGGLE_ON_LIGHTNESS}%);`,
        `--toggle-on-hover-bg: hsl(${workspaceHsl.h} ${TOGGLE_ON_HOVER_SATURATION}% ${TOGGLE_ON_HOVER_LIGHTNESS}%);`
    );
    
    // Set toggle button shadow colors maintaining original hue offset and lightness differences
    variables.push(
        `--toggle-shadow-color-58: hsl(${workspaceHsl.h} ${TOGGLE_SHADOW_SATURATION}% ${TOGGLE_SHADOW_LIGHTNESS}% / 58%);`,
        `--toggle-shadow-color-19: hsl(${workspaceHsl.h} ${Math.max(0, TOGGLE_SHADOW_SATURATION - 20)}% ${Math.min(100, TOGGLE_SHADOW_LIGHTNESS + 15)}% / 19%);`
    );
    
    // Set round button secondary background with dark tint
    variables.push(`--round-secondary-bg: hsl(${workspaceHsl.h} ${ROUND_SECONDARY_SATURATION}% ${ROUND_SECONDARY_LIGHTNESS}%);`);

    // Create glass tint using workspace background HSL
    const glassTintH = workspaceBackgroundHsl.h;
    const glassTintS = GLASS_TINT_SATURATION;
    const glassTintL = Math.max(GLASS_TINT_MIN_LIGHTNESS, workspaceBackgroundHsl.l * GLASS_TINT_LIGHTNESS_FACTOR);
    
    // Match the exact transparency levels from the CSS file for all glass layers
    if (isBlurDisabled) {
        // For blur-disabled mode, use higher opacity for better readability while keeping darker colors for contrast
        const glassTintLightH = workspaceBackgroundHsl.h;
        const glassTintLightS = Math.max(0, workspaceBackgroundHsl.s - 40); // Less reduction in saturation
        const glassTintLightL = Math.max(GLASS_TINT_MIN_LIGHTNESS, workspaceBackgroundHsl.l * 0.15); // Lower lightness for better contrast

        variables.push(
            `--text-muted: hsl(${workspaceHsl.h} 25% 60%);`,
            `--glass-layer-dark-menu: hsl(${glassTintLightH} ${glassTintLightS}% ${glassTintLightL}% / 97%);`,
            `--glass-layer-dark-5: hsl(${glassTintLightH} ${glassTintLightS}% ${glassTintLightL}% / 97%);`,
            `--glass-layer-dark-4: hsl(${glassTintLightH} ${glassTintLightS}% ${glassTintLightL}% / 95%);`,
            `--glass-layer-dark-3: hsl(${glassTintLightH} ${glassTintLightS}% ${glassTintLightL}% / 90%);`,
            `--glass-layer-dark-2: hsl(${glassTintLightH} ${glassTintLightS}% ${glassTintLightL}% / 85%);`,
            `--glass-layer-dark-1: hsl(${glassTintLightH} ${glassTintLightS}% ${glassTintLightL}% / 80%);`,
            `--glass-windows-bg: hsl(${glassTintLightH} 25% 20% / 94%);`
        );
    } else {
        // Original glass tint generation
        variables.push(
            `--glass-layer-dark-menu: hsl(${glassTintH} ${glassTintS}% ${glassTintL}% / 97%);`,
            `--glass-layer-dark-5: hsl(${glassTintH} ${glassTintS}% ${glassTintL}% / 66%);`,
            `--glass-layer-dark-4: hsl(${glassTintH} ${glassTintS}% ${glassTintL}% / 44%);`,
            `--glass-layer-dark-3: hsl(${glassTintH} ${glassTintS}% ${glassTintL}% / 33%);`,
            `--glass-layer-dark-2: hsl(${glassTintH} ${glassTintS}% ${glassTintL}% / 22%);`,
            `--glass-layer-dark-1: hsl(${glassTintH} ${glassTintS}% ${glassTintL}% / 13%);`
        );
    }

    // Helper to blend two colors (foreground over background) given alpha
    function blendColors(fg, bg, alpha) {
        return {
            r: Math.round(fg.r * alpha + bg.r * (1 - alpha)),
            g: Math.round(fg.g * alpha + bg.g * (1 - alpha)),
            b: Math.round(fg.b * alpha + bg.b * (1 - alpha))
        };
    }

    // Generate glass-layer-* variables with 1-3% workspace color tinting
    // When blur is disabled, use higher opacity for better readability while keeping darker colors for contrast
    if (isBlurDisabled) {
        // For accessibility with white text, use higher opacity and darker, more neutral colors
        // Glass layer HSL values
        const glassLayer1H = workspaceHsl.h;
        const glassLayer2H = workspaceHsl.h;
        const glassLayer3H = workspaceHsl.h;
        const glassLayer4H = workspaceHsl.h;
        const glassLayer5H = workspaceHsl.h;
        
        const glassLayer1S = Math.max(0, workspaceHsl.s - 75);
        const glassLayer2S = Math.max(0, workspaceHsl.s - 65);
        const glassLayer3S = Math.max(0, workspaceHsl.s - 60);
        const glassLayer4S = Math.max(0, workspaceHsl.s - 55);
        const glassLayer5S = Math.max(0, workspaceHsl.s - 50);

        variables.push(
            `--glass-layer-1: hsl(${glassLayer1H} ${glassLayer1S}% 40% / 15%);`,
            `--glass-layer-2: hsl(${glassLayer2H} ${glassLayer2S}% 45% / 32.5%);`,
            `--glass-layer-3: hsl(${glassLayer3H} ${glassLayer3S}% 50% / 35%);`,
            `--glass-layer-4: hsl(${glassLayer4H} ${glassLayer4S}% 55% / 45%);`,
            `--glass-layer-5: hsl(${glassLayer5H} ${glassLayer5S}% 70% / 50%);`,
            `--glass-overlay-bg: hsl(${workspaceHsl.h} 20% 75% / 95%);`,

            // Fully opaque versions - for blur disabled, we use simpler direct HSL
            `--glass-layer-1-opaque: hsl(${glassLayer1H} ${glassLayer1S}% 40%);`,
            `--glass-layer-2-opaque: hsl(${glassLayer2H} ${glassLayer2S}% 45%);`,
            `--glass-layer-3-opaque: hsl(${glassLayer3H} ${glassLayer3S}% 50%);`,
            `--glass-layer-4-opaque: hsl(${glassLayer4H} ${glassLayer4S}% 55%);`,
            `--glass-layer-5-opaque: hsl(${glassLayer5H} ${glassLayer5S}% 70%);`
        );
        
        // Generate more opaque glass layer variants
        variables.push(
            `--glass-layer-alt-1: hsl(${workspaceHsl.h} ${Math.max(0, workspaceHsl.s - 95)}% 25% / 80%);`,
            `--glass-layer-alt-2: hsl(${workspaceHsl.h} ${Math.max(0, workspaceHsl.s - 85)}% 20% / 85%);`,
            `--glass-layer-alt-3: hsl(${workspaceHsl.h} 40% 15% / 90%);`,
            `--glass-layer-alt-4: hsl(${workspaceHsl.h} 50% 10% / 95%);`,
            `--glass-layer-alt-5: hsl(${workspaceHsl.h} 60% 5%);`
        );
    } else {
        // Original glass layer generation
        const glassLayer1S = Math.max(0, workspaceHsl.s - 80);
        const glassLayer2S = Math.max(0, workspaceHsl.s - 70);
        const glassLayer3S = Math.max(0, workspaceHsl.s - 60);
        const glassLayer4S = Math.max(0, workspaceHsl.s - 50);
        const glassLayer5S = Math.max(0, workspaceHsl.s - 40);
        
        const glassLayer1L = Math.min(100, workspaceHsl.l + 45);
        const glassLayer2L = Math.min(100, workspaceHsl.l + 40);
        const glassLayer3L = Math.min(100, workspaceHsl.l + 35);
        const glassLayer4L = Math.min(100, workspaceHsl.l + 30);
        const glassLayer5L = Math.min(100, workspaceHsl.l + 25);

        variables.push(
            `--glass-layer-1: hsl(${workspaceHsl.h} ${glassLayer1S}% ${glassLayer1L}% / 5%);`,
            `--glass-layer-2: hsl(${workspaceHsl.h} ${glassLayer2S}% ${glassLayer2L}% / 10%);`,
            `--glass-layer-3: hsl(${workspaceHsl.h} ${glassLayer3S}% ${glassLayer3L}% / 20%);`,
            `--glass-layer-4: hsl(${workspaceHsl.h} ${glassLayer4S}% ${glassLayer4L}% / 30%);`,
            `--glass-layer-5: hsl(${workspaceHsl.h} ${glassLayer5S}% ${glassLayer5L}% / 40%);`,
            `--glass-overlay-bg: hsl(${workspaceHsl.h} 18% 70% / 85%);`,

            // Fully opaque versions - for non-blur, we use simpler direct HSL
            `--glass-layer-1-opaque: hsl(${workspaceHsl.h} ${glassLayer1S}% ${glassLayer1L}%);`,
            `--glass-layer-2-opaque: hsl(${workspaceHsl.h} ${glassLayer2S}% ${glassLayer2L}%);`,
            `--glass-layer-3-opaque: hsl(${workspaceHsl.h} ${glassLayer3S}% ${glassLayer3L}%);`,
            `--glass-layer-4-opaque: hsl(${workspaceHsl.h} ${glassLayer4S}% ${glassLayer4L}%);`,
            `--glass-layer-5-opaque: hsl(${workspaceHsl.h} ${glassLayer5S}% ${glassLayer5L}%);`
        );
    }

    // Generate glass-border-* variables with 1-3% workspace color tinting
    // When blur is disabled, use higher opacity for better readability while keeping darker colors for contrast
    if (isBlurDisabled) {
    
        // Generate 5-level shadow color system tinted to workspace
        variables.push(
            `--shadow-color-1: hsl(${workspaceHsl.h} 100% 5% / 90%);`,
            `--shadow-color-2: hsl(${workspaceHsl.h} 100% 10% / 80%);`,
            `--shadow-color-3: hsl(${workspaceHsl.h} 100% 12.5% / 70%);`,
            `--shadow-color-4: hsl(${workspaceHsl.h} 100% 13% / 60%);`,
            `--shadow-color-5: hsl(${workspaceHsl.h} 100% 15% / 50%);`
        );
        
        variables.push(
            `--glass-border-saturated: hsl(${workspaceHsl.h} 100% 35% / 45%);`,
            `--glass-border-1: hsl(${workspaceHsl.h} ${Math.max(0, workspaceHsl.s - 80)}% 40% / 25%);`,
            `--glass-border-2: hsl(${workspaceHsl.h} ${Math.max(0, workspaceHsl.s - 75)}% 45% / 35%);`,
            `--glass-border-3: hsl(${workspaceHsl.h} ${Math.max(0, workspaceHsl.s - 70)}% 50% / 45%);`,
            `--glass-border-4: hsl(${workspaceHsl.h} ${Math.max(0, workspaceHsl.s - 65)}% 55% / 55%);`,
            `--glass-border-5: hsl(${workspaceHsl.h} ${Math.max(0, workspaceHsl.s - 60)}% 60% / 65%);`
        );
    } else {
        // Original glass border generation
        variables.push(
            `--glass-border-1: hsl(${workspaceHsl.h} ${Math.max(0, workspaceHsl.s - 75)}% ${Math.min(100, workspaceHsl.l + 50)}% / 8%);`,
            `--glass-border-2: hsl(${workspaceHsl.h} ${Math.max(0, workspaceHsl.s - 65)}% ${Math.min(100, workspaceHsl.l + 45)}% / 10%);`,
            `--glass-border-3: hsl(${workspaceHsl.h} ${Math.max(0, workspaceHsl.s - 55)}% ${Math.min(100, workspaceHsl.l + 40)}% / 15%);`,
            `--glass-border-4: hsl(${workspaceHsl.h} ${Math.max(0, workspaceHsl.s - 45)}% ${Math.min(100, workspaceHsl.l + 35)}% / 20%);`,
            `--glass-border-5: hsl(${workspaceHsl.h} ${Math.max(0, workspaceHsl.s - 35)}% ${Math.min(100, workspaceHsl.l + 30)}% / 25%);`
        );
    }
    // Generate glass-inset-bg-* variables with 1-3% workspace color tinting
    // When blur is disabled, use higher opacity for better readability while keeping darker colors for contrast
    if (isBlurDisabled) {
        variables.push(
            `--glass-inset-bg-1: hsl(${workspaceHsl.h} 75% 35% / 25%);`,
            `--glass-inset-bg-2: hsl(${workspaceHsl.h} 70% 30% / 35%);`,
            `--glass-inset-bg-3: hsl(${workspaceHsl.h} 65% 25% / 45%);`,
            `--glass-inset-bg-4: hsl(${workspaceHsl.h} 60% 20% / 55%);`,
            `--glass-inset-bg-5: hsl(${workspaceHsl.h} 55% 15% / 65%);`
        );
    } else {
        // Original glass inset background generation
        variables.push(
            `--glass-inset-bg-1: hsl(${workspaceHsl.h} ${Math.max(0, workspaceHsl.s - 80)}% ${Math.min(100, workspaceHsl.l + 50)}% / 5%);`,
            `--glass-inset-bg-2: hsl(${workspaceHsl.h} ${Math.max(0, workspaceHsl.s - 75)}% ${Math.min(100, workspaceHsl.l + 45)}% / 8%);`,
            `--glass-inset-bg-3: hsl(${workspaceHsl.h} ${Math.max(0, workspaceHsl.s - 70)}% ${Math.min(100, workspaceHsl.l + 40)}% / 12%);`,
            `--glass-inset-bg-4: hsl(${workspaceHsl.h} ${Math.max(0, workspaceHsl.s - 65)}% ${Math.min(100, workspaceHsl.l + 35)}% / 15%);`,
            `--glass-inset-bg-5: hsl(${workspaceHsl.h} ${Math.max(0, workspaceHsl.s - 60)}% ${Math.min(100, workspaceHsl.l + 30)}% / 20%);`
        );
    }

    // Generate header color variables
    // For blur-disabled mode, use more opaque, saturated, and darker header colors for better readability
    const headerDarkS = Math.min(100, Math.max(60, workspaceHsl.s + 20));
    const headerDarkL = Math.min(20, Math.max(workspaceHsl.l - 20, 10));
    const headerDarkBorderS = Math.min(100, workspaceHsl.s + 20);
    
    if (isBlurDisabled) {
        variables.push(
            `--header-bg: hsl(${workspaceHsl.h} ${headerDarkS}% ${headerDarkL}% / 90%);`,
            `--header-border: hsl(${workspaceHsl.h} ${headerDarkBorderS}% 50% / 50%);`
        );
    } else {
        // Original header color generation
        variables.push(
            `--header-bg: hsl(${workspaceHsl.h} 100% 25% / 40%);`,
            `--header-border: hsl(${workspaceHsl.h} ${workspaceHsl.s}% ${workspaceHsl.l}% / 30%);`
        );
    }
    
    if (isBlurDisabled) {
        variables.push(
            `--active-tab-bg: hsl(${workspaceHsl.h} ${workspaceHsl.s}% ${workspaceHsl.l}% / 90%);`,
            `--active-tab-border: hsl(${workspaceHsl.h} ${workspaceHsl.s}% ${workspaceHsl.l}% / 85%);`,
            `--active-tab-text: #ffffff;`
        );
    } else {
        variables.push(
            `--active-tab-bg: hsl(${workspaceHsl.h} ${workspaceHsl.s}% ${workspaceHsl.l}% / 54%);`,
            `--active-tab-border: hsl(${workspaceHsl.h} ${workspaceHsl.s}% ${workspaceHsl.l}% / 53%);`,
            `--active-tab-text: #ffffff;`
        );
    }

    return variables.join('\n    ');
}

// Switch workspace theme using dataset attribute with smooth transition
function switchWorkspaceTheme(workspaceId) {
    closeSubMenu();

    const workspace = workspaces[workspaceId];
    
    if (!workspace) {
        console.warn('Workspace not found:', workspaceId);
        return;
    }

    document.body.classList.add('workspace-transitioning');
    document.body.setAttribute('data-workspace', workspaceId);
    
    setTimeout(() => {
        document.body.classList.remove('workspace-transitioning');
    }, 300);
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

        showGlassToast('success', null, 'Reference moved to default workspace', false, 5000, '<i class="fas fa-folder"></i>');
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
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeModal(modal);
            }
        });

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
            closeModal(modal);
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
        showGlassToast('success', null, `Reference file moved to ${workspace ? workspace.name : 'workspace'}`, false, 5000, '<i class="fas fa-folder-open"></i>');
        await loadCacheImages();
        displayCacheImagesContainer();
    } catch (error) {
        showError('Failed to move cache file: ' + error.message);
    }
}

// Workspace API functions
async function loadWorkspaces() {
    try {
        // Use WebSocket API if available, otherwise fall back to HTTP
        if (window.wsClient && window.wsClient.isConnected()) {
            const data = await window.wsClient.getWorkspaces();
            
            // Check if workspaces have actually changed
            const newWorkspaces = {};
            data.workspaces.forEach(workspace => {
                newWorkspaces[workspace.id] = workspace;
            });
            
            const workspacesChanged = JSON.stringify(workspaces) !== JSON.stringify(newWorkspaces);
            const isFirstLoad = Object.keys(workspaces).length === 0;
            
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

        // Set initial workspace theme first, then update background
        switchWorkspaceTheme(activeWorkspace);
        updateBackground();

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
    
    // Start automatic background system
    startAutomaticBackgroundSystem();
}

// Start automatic background system that cycles through gallery images
function startAutomaticBackgroundSystem() {
    // Clear any existing interval
    if (automaticBackgroundInterval) {
        clearInterval(automaticBackgroundInterval);
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
        const blurPreviewUrl = `/previews/${encodeURIComponent(firstImage.preview.replace('.jpg', '_blur.jpg'))}`;
        
        if (lastBackgroundUrl && lastBackgroundUrl === blurPreviewUrl) return;
        // Preload the image to ensure smooth transition
        await preloadImage(blurPreviewUrl);
        
        // Perform crossfade transition
        await performBackgroundTransition(blurPreviewUrl);
        setDefaultBackgroundForWorkspace(blurPreviewUrl);
        lastBackgroundUrl = blurPreviewUrl;
        
    } catch (error) {
        console.warn('Failed to update automatic background:', error);
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
        nextBg.style.backgroundImage = `url(${newImageUrl})`;
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
            const blurPreviewUrl = `/previews/${encodeURIComponent(retryImage.preview.replace('.jpg', '_blur.jpg'))}`;
            await setBackgroundImage(blurPreviewUrl);
            setDefaultBackgroundForWorkspace(blurPreviewUrl);
        } else {
            // Get the blur preview image
            const blurPreviewUrl = `/previews/${encodeURIComponent(firstImage.preview.replace('.jpg', '_blur.jpg'))}`;
            await setBackgroundImage(blurPreviewUrl);
            setDefaultBackgroundForWorkspace(blurPreviewUrl);
        }            
    } catch (error) {
        console.warn('Failed to set initial background image:', error);
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
        currentBg.style.backgroundImage = `url(${blurPreviewUrl})`;
        currentBg.style.backgroundSize = 'cover';
        currentBg.style.backgroundPosition = 'center';
        currentBg.style.backgroundRepeat = 'no-repeat';
        
        // Update current background tracking
        currentBackgroundImage = blurPreviewUrl;
    }
}

// Update background with workspace color (for initial load and non-animated updates)
async function updateBackground() {
    const currentBg = document.querySelector('.current-bg');
    if (!currentBg) return;

    // The automatic background system handles image updates
    // This function now only handles color transitions
    currentBg.style.backgroundColor = 'transparent';
    
    // If this is the initial load and we don't have a background image yet,
    // set an initial one
    if (!currentBackgroundImage) {
        await ensureInitialBackgroundImage();
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
    try {
        // Use WebSocket API if available, otherwise fall back to HTTP
        if (window.wsClient && window.wsClient.isConnected()) {
            const result = await window.wsClient.createWorkspace(name);
            
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
    } catch (error) {
        console.error('Error creating workspace:', error);
        showError('Failed to create workspace: ' + error.message);
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

async function setActiveWorkspace(id) {
    try {
        // Set flag to prevent duplicate calls
        isWorkspaceSwitching = true;
        window.isWorkspaceSwitching = true;

        // Create workspace-specific loading overlay in the center of the gallery
        const gallery = document.getElementById('gallery');
        if (gallery) {
            // Create workspace loading overlay
            const workspaceLoadingOverlay = document.createElement('div');
            workspaceLoadingOverlay.id = 'workspaceLoadingOverlay';
            workspaceLoadingOverlay.className = 'workspace-loading-overlay';
            workspaceLoadingOverlay.innerHTML = `
                <div class="workspace-loading-content">
                    <img class="loading" src="/static_images/azuspin.gif" alt="Loading">
                    <p class="loading">Switching Workspace...</p>
                </div>
            `;
            
            // Insert the overlay into the gallery container
            const galleryContainer = gallery.parentElement;
            if (galleryContainer) {
                galleryContainer.appendChild(workspaceLoadingOverlay);
            }
        }

        // Fade out gallery
        if (gallery) {
            gallery.style.transition = 'opacity 0.3s ease-out';
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

        // Don't call switchWorkspaceTheme here - let the WebSocket event handle it
        // This prevents duplicate theme switching
    } catch (error) {
        console.error('Error setting active workspace:', error);
        showError('Failed to set active workspace: ' + error.message);

        // Ensure gallery is visible even on error
        if (gallery) {
            gallery.style.opacity = 1;
        }
        
        // Remove workspace loading overlay on error
        const workspaceLoadingOverlay = document.getElementById('workspaceLoadingOverlay');
        if (workspaceLoadingOverlay) {
            workspaceLoadingOverlay.remove();
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
            <div class="workspace-drag-handle" title="Drag to reorder" style="background: rgba(255, 255, 255, 0.1); border: 1px solid rgba(255, 255, 255, 0.2);">
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

function hideWorkspaceManagementModal() {
    const modal = document.getElementById('workspaceManageModal');
    if (modal) closeModal(modal);
    
    // Deregister event listeners when modal is hidden
    deregisterWorkspaceManagerEventListeners();
    
    switchWorkspaceTheme(activeWorkspace);
}

function showAddWorkspaceModal() {
    currentWorkspaceOperation = { type: 'add' };
    document.getElementById('workspaceEditTitle').textContent = 'Add Workspace';
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
    document.getElementById('workspaceEditTitle').textContent = 'Workspace Settings';

    // Show all form elements
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

function hideWorkspaceEditModal() {
    const modal = document.getElementById('workspaceEditModal');
    if (modal) closeModal(modal);

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

function hideWorkspaceDumpModal() {
    const modal = document.getElementById('workspaceDumpModal');
    if (modal) closeModal(modal);
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
                await createWorkspace(name);
                const newWorkspace = Object.values(workspaces).find(w => w.name === name);
                if (newWorkspace) {
                    await window.wsClient.updateWorkspaceSettings(newWorkspace.id, {
                        name,
                        color,
                        backgroundColor: backgroundColor || null,
                        primaryFont,
                        textareaFont
                    });
                    await loadWorkspaces();
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
                    textareaFont
                });
                await loadWorkspaces();

                // Update background if this is the active workspace
                if (currentWorkspaceOperation.id === activeWorkspace) {
                    switchWorkspaceTheme(activeWorkspace);
                }
            }
        }

        hideWorkspaceEditModal();
        hideWorkspaceManagementModal();
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
        hideWorkspaceManagementModal();
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
    window.wsClient.registerInitStep(14, 'Setting up workspace settings', async () => {
        initializeWorkspaceSettingsForm();
    });
    window.wsClient.registerInitStep(15, 'Setting up workspace events', async () => {
        initializeWebSocketWorkspaceEvents();
    });
    window.wsClient.registerInitStep(91, 'Initializing background layers', async () => {
        initializeBackgrounds();
    });
} else {
    throw new Error('WebSocket client not initialized');
}

// Initialize WebSocket workspace event listeners
function initializeWebSocketWorkspaceEvents() {
    // Listen for workspace updates from WebSocket
    document.addEventListener('workspaceUpdated', (event) => {
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
                
                // For reordering, we don't need to reload all workspaces
                // Just update the UI components that show the new order
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
                
                // Only refresh gallery if it's currently visible
                if (!document.getElementById('gallery')?.classList.contains('hidden')) {
                    switchGalleryView(currentGalleryView, true);
                }
                break;
                
            case 'scrap_added':
            case 'scrap_removed':
            case 'pinned_added':
            case 'pinned_removed':
            case 'bulk_pinned_added':
            case 'bulk_pinned_removed':
            case 'group_created':
            case 'group_renamed':
            case 'group_deleted':
            case 'images_added_to_group':
            case 'images_removed_from_group':
                // Only refresh gallery if it's currently visible
                if (!document.getElementById('gallery')?.classList.contains('hidden')) {
                    switchGalleryView(currentGalleryView, true);
                }
                break;
                
            case 'color_updated':
                // Update local workspace data
                if (data.workspaceId && workspaces[data.workspaceId]) {
                    workspaces[data.workspaceId].color = data.color;
                }
                
                // Update theme when workspace color changes
                const updatedWorkspace = workspaces[data.workspaceId];
                if (updatedWorkspace && data.workspaceId === activeWorkspace) {
                    // Only regenerate styles if this affects the current active workspace
                    generateWorkspaceStyles(data.workspaceId);
                    switchWorkspaceTheme(activeWorkspace);
                }
                
                // Update UI components
                renderWorkspaceDropdown();
                
                // Only refresh gallery if it's currently visible
                if (!document.getElementById('gallery')?.classList.contains('hidden')) {
                    switchGalleryView(currentGalleryView, true);
                }
                break;
                
            case 'background_color_updated':
            case 'background_image_updated':
            case 'background_opacity_updated':
                // Update local workspace data
                if (data.workspaceId && workspaces[data.workspaceId]) {
                    if (data.backgroundColor !== undefined) {
                        workspaces[data.workspaceId].backgroundColor = data.backgroundColor;
                    }
                }
                
                // Only regenerate styles if this affects the current theme
                if (data.workspaceId === activeWorkspace) {
                    generateWorkspaceStyles(data.workspaceId);
                    switchWorkspaceTheme(activeWorkspace);
                }
                
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
        
        // Update workspace settings immediately
        const workspace = workspaces[activeWorkspace];
        if (workspace) {
            switchWorkspaceTheme(activeWorkspace);
        }
        
        // Refresh UI components (no need to reload workspaces)
        renderWorkspaceDropdown();
        updateActiveWorkspaceDisplay();
        
        // Set up the completion callback and load gallery
        window.workspaceLoadingCompleteCallback = completeWorkspaceSwitch;
        await switchGalleryView(window.currentGalleryView || 'images', true);        
        // Gallery will be faded in by completeWorkspaceSwitch callback after data is loaded
        
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
        gallery.style.transition = 'opacity 0.3s ease-in';
        gallery.style.opacity = '1';
    }
    
    // Remove workspace loading overlay
    const workspaceLoadingOverlay = document.getElementById('workspaceLoadingOverlay');
    if (workspaceLoadingOverlay) {
        workspaceLoadingOverlay.remove();
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
        loadingIndicator.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
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

window.refreshWorkspaceManager = refreshWorkspaceManager;