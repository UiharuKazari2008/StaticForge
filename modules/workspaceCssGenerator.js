/**
 * Server-side workspace theme CSS generation.
 * Ported from public/scripts/comp/workspaceUtils.js — keep in sync for theme parity.
 */

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

/** Escape a string for use inside a double-quoted CSS url() argument. */
function escapeCssUrlString(value) {
    return String(value)
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\A ')
        .replace(/\r/g, '\\D ')
        .replace(/\f/g, '\\C ');
}

function formatCssUrl(url) {
    return `url("${escapeCssUrlString(url)}")`;
}

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
        variables.push(`--desktop-wallpaper: ${formatCssUrl(workspaceWallpaper)};`);
        variables.push(`--desktop-wallpaper-position: ${workspaceWallpaperPosition};`);
    }

    return variables.join('\n    ');
}
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

function resolveWorkspaceWallpaper(wallpaper) {
    if (!wallpaper) return null;
    const [type, ...idParts] = wallpaper.split(':');
    const id = idParts.join(':');
    switch (type) {
        case 'file': return `/images/${id}`;
        case 'cache': return `/cache/upload/${id}`;
        case 'cache-preview': return `/cache/preview/${id}`;
        case 'vibe': return `/cache/vibe/${id}`;
        case 'wallpaper': return `/cache/wallpapers/${id}.png`;
        case 'url': return id;
        default: return null;
    }
}

function buildWorkspaceRule(workspaceId, workspace, defaultWorkspace) {
    const workspaceColor = workspace.color || '#102040';
    const workspaceBackgroundColor = workspace.backgroundColor || '#0a1a2a';
    const workspaceWallpaper = resolveWorkspaceWallpaper(workspace.wallpaper);
    const workspaceWallpaperPosition = workspace.wallpaperPosition || 'center';
    const resolvedPrimaryFont =
        (workspace.primaryFont && workspace.primaryFont.trim())
            ? workspace.primaryFont
            : (workspaceId !== 'default' && defaultWorkspace && defaultWorkspace.primaryFont) ? defaultWorkspace.primaryFont : '';
    const resolvedTextareaFont =
        (workspace.textareaFont && workspace.textareaFont.trim())
            ? workspace.textareaFont
            : (workspaceId !== 'default' && defaultWorkspace && defaultWorkspace.textareaFont) ? defaultWorkspace.textareaFont : '';

    const cssVariables = generateWorkspaceCSSVariables(
        workspaceColor, workspaceBackgroundColor, workspaceWallpaper,
        workspaceWallpaperPosition, resolvedPrimaryFont, resolvedTextareaFont, false
    );
    const cssVariablesDark = generateWorkspaceCSSVariables(
        workspaceColor, workspaceBackgroundColor, workspaceWallpaper,
        workspaceWallpaperPosition, resolvedPrimaryFont, resolvedTextareaFont, true
    );

    return `[data-workspace="${workspaceId}"] {
    ${cssVariables}
}

html.disable-blur [data-workspace="${workspaceId}"] {
    ${cssVariablesDark}
}
`;
}

function generateAllWorkspacesCss(workspacesConfig) {
    if (!workspacesConfig || typeof workspacesConfig !== 'object') {
        return '/* No workspaces configured */\n';
    }
    const defaultWorkspace = workspacesConfig.default || workspacesConfig['default'] || null;
    const parts = ['/* Generated workspace theme variables — do not edit */', ''];
    for (const workspaceId of Object.keys(workspacesConfig)) {
        const workspace = workspacesConfig[workspaceId];
        if (!workspace || typeof workspace !== 'object') continue;
        parts.push(buildWorkspaceRule(workspaceId, workspace, defaultWorkspace));
    }
    return parts.join('\n');
}

module.exports = {
    generateAllWorkspacesCss,
    generateWorkspaceCSSVariables,
    resolveWorkspaceWallpaper,
    formatCssUrl
};
