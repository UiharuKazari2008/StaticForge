// workspaceUtils.js
// Workspace management utilities for StaticForge frontend

// Workspace state
const workspaceTabs = document.getElementById('workspaceTabs');
let workspaces = {};
let activeWorkspace = 'default';
let currentWorkspaceOperation = null;
let activeWorkspaceColor = '#124'; // Default color
let activeWorkspaceBackgroundColor = null; // Can be null for auto-generation
let activeWorkspaceBackgroundImage = null; // Can be null for no background image
let activeWorkspaceBackgroundOpacity = 0.3; // Default opacity
let selectedBackgroundImage = null;
let isWorkspaceSwitching = false; // Flag to prevent duplicate calls during workspace switching

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
                    <button id="closeCacheMoveToWorkspaceBtn" class="close-dialog">&times;</button>
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
                ${workspace.isActive ? '<span class="badge-active"><i class="fas fa-check"></i></span>' : ''}
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
            
            // Convert array response back to object structure for consistency
            workspaces = {};
            data.workspaces.forEach(workspace => {
                workspaces[workspace.id] = workspace;
            });
            
            activeWorkspace = data.activeWorkspace;
        } else {
            showError('Failed to load workspaces: WebSocket not connected');
            throw new Error('Failed to load workspaces');
        }

        // Update active workspace color
        const activeWorkspaceData = workspaces[activeWorkspace];
        if (activeWorkspaceData) {
            activeWorkspaceColor = activeWorkspaceData.color || '#124';
            updateBokehBackground();
        }

        renderWorkspaceDropdown();
        updateActiveWorkspaceDisplay();
    } catch (error) {
        showError('Failed to load workspaces: ' + error.message);
    }
}

// Initialize background layers with default color
function initializeBokehBackgrounds() {
    const currentBg = document.querySelector('.current-bg');
    const nextBg = document.querySelector('.next-bg');
    const bokeh = document.querySelector('.bokeh');

    if (currentBg) {
        currentBg.style.backgroundColor = 'transparent';
    }
    if (nextBg) {
        nextBg.style.opacity = '0';
        nextBg.style.backgroundColor = 'transparent';
    }
    if (bokeh) {
        bokeh.style.backgroundColor = addTransparency('#124', 0.5);
    }
}

// Load active workspace color for bokeh background
async function loadActiveWorkspaceColor() {
    try {
        if (window.wsClient && window.wsClient.isConnected()) {
            try {
                const data = await window.wsClient.getWorkspace();
                if (data) {
                    activeWorkspaceColor = data.color || '#124';
                    activeWorkspaceBackgroundColor = data.backgroundColor;
                    activeWorkspaceBackgroundImage = data.backgroundImage;
                    activeWorkspaceBackgroundOpacity = data.backgroundOpacity || 0.3;
                }
            } catch (wsError) {
                // Fall back to using the workspace data we already have
                const activeWorkspaceData = workspaces[activeWorkspace];
                if (activeWorkspaceData) {
                    activeWorkspaceColor = activeWorkspaceData.color || '#124';
                    activeWorkspaceBackgroundColor = activeWorkspaceData.backgroundColor;
                    activeWorkspaceBackgroundImage = activeWorkspaceData.backgroundImage;
                    activeWorkspaceBackgroundOpacity = activeWorkspaceData.backgroundOpacity || 0.3;
                } else {
                    // Use default values if no workspace data available
                    activeWorkspaceColor = '#124';
                    activeWorkspaceBackgroundColor = null;
                    activeWorkspaceBackgroundImage = null;
                    activeWorkspaceBackgroundOpacity = 0.3;
                }
            }
        } else {
            activeWorkspaceColor = '#124';
            activeWorkspaceBackgroundColor = null;
            activeWorkspaceBackgroundImage = null;
            activeWorkspaceBackgroundOpacity = 0.3;
            showError('Failed to load workspace settings: WebSocket not connected');
            throw new Error('Failed to load workspace settings');
        }
        
        updateBokehBackground();
        updateHeaderTint();
        updateWorkspaceTheme();
    } catch (error) {
        showError('Failed to load workspace settings: ' + error.message);
        // Use default values on error
        activeWorkspaceColor = '#124';
        activeWorkspaceBackgroundColor = null;
        activeWorkspaceBackgroundImage = null;
        activeWorkspaceBackgroundOpacity = 0.3;
        updateBokehBackground();
    }
}

// Apply workspace color tint to header
function updateHeaderTint() {
    const header = document.querySelector('.header');
    if (!header) return;

    // Convert hex color to RGB for transparency
    const hexColor = activeWorkspaceColor || '#124';
    const r = parseInt(hexColor.slice(1, 3), 16);
    const g = parseInt(hexColor.slice(3, 5), 16);
    const b = parseInt(hexColor.slice(5, 7), 16);

    // Apply a solid subtle tint to the header background
    // Use a very low opacity (0.1) to keep it subtle
    header.style.background = `rgba(${r}, ${g}, ${b}, 0.15)`;
    
    // Also add a subtle border tint
    header.style.borderColor = `rgba(${r}, ${g}, ${b}, 0.3)`;
}

// Update dynamic CSS variables for workspace theming
function updateWorkspaceTheme() {
    const root = document.documentElement;
    const workspaceColor = activeWorkspaceColor || '#124';
    const workspaceBackgroundColor = activeWorkspaceBackgroundColor || '#0a1a2a';
    
    // Color adjustment variables for consistent theming
    const BADGE_LIGHTNESS_1 = 25; // Much darker first badge color
    const BADGE_LIGHTNESS_2 = 35; // Much darker second badge color
    const HOVER_SHOW_COLORED_LIGHTNESS = 95; // Light colored text
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
    
    // Convert workspace color to RGB for transparency
    const r = parseInt(workspaceColor.slice(1, 3), 16);
    const g = parseInt(workspaceColor.slice(3, 5), 16);
    const b = parseInt(workspaceColor.slice(5, 7), 16);
    
    // Convert workspace background color to RGB
    const bgR = parseInt(workspaceBackgroundColor.slice(1, 3), 16);
    const bgG = parseInt(workspaceBackgroundColor.slice(3, 5), 16);
    const bgB = parseInt(workspaceBackgroundColor.slice(5, 7), 16);
    
    // Set workspace color as primary UI color
    root.style.setProperty('--primary-color', workspaceColor);
    root.style.setProperty('--primary-color-light', `${workspaceColor}cc`);
    root.style.setProperty('--primary-color-dark', `${workspaceColor}99`);
    root.style.setProperty('--primary-gradient', `linear-gradient(45deg, ${workspaceColor}, ${workspaceColor}cc)`);
    root.style.setProperty('--primary-glass-color', `${workspaceColor}b8`);
    root.style.setProperty('--primary-glass-border', `rgba(${r}, ${g}, ${b}, 0.58)`);
    root.style.setProperty('--border-primary', workspaceColor);
    root.style.setProperty('--text-accent', workspaceColor);
    root.style.setProperty('--shadow-primary', `rgba(${r}, ${g}, ${b}, 0.3)`);
    
    // Set button hover and shadow colors with workspace theming
    // Brighten the workspace color for hover effects
    const brightenedColor = brightenColor(workspaceColor, 1.3); // 30% brighter
    const brightenedRgb = hexToRgb(brightenedColor);
    
    root.style.setProperty('--btn-hover-bg-primary', `rgba(${brightenedRgb.r}, ${brightenedRgb.g}, ${brightenedRgb.b}, 0.84)`);
    root.style.setProperty('--btn-hover-border-primary', `${brightenedColor}cc`);
    root.style.setProperty('--btn-hover-text-primary', '#ffffff');
    // Use original workspace color (not brightened) for more saturated shadow
    root.style.setProperty('--btn-shadow-primary', `rgba(${r}, ${g}, ${b}, 0.89)`);
    root.style.setProperty('--btn-shadow-primary-glow', `0 2px 16px rgba(${r}, ${g}, ${b}, 0.89)`);
    
    // Set secondary button hover using workspace background color
    const bgRgb = hexToRgb(workspaceBackgroundColor);
    const bgTintedR = Math.round(255 * 0.95 + bgRgb.r * 0.05);
    const bgTintedG = Math.round(255 * 0.95 + bgRgb.g * 0.05);
    const bgTintedB = Math.round(255 * 0.95 + bgRgb.b * 0.05);
    
    root.style.setProperty('--btn-hover-bg-secondary', `rgba(${bgTintedR}, ${bgTintedG}, ${bgTintedB}, 0.8)`);
    root.style.setProperty('--btn-shadow-secondary-glow', `0 8px 20px rgba(${bgTintedR}, ${bgTintedG}, ${bgTintedB}, 0.33)`);
    
    // Set hover-show active colors using workspace color with original saturation and lightness
    // Original orange: rgb(204, 67, 15) - HSL: (15, 86%, 43%)
    // Convert workspace color to HSL, then apply original saturation and lightness
    const workspaceHsl = hexToHsl(workspaceColor);
    const originalSaturation = 86; // Original orange saturation
    const originalLightness = 43;   // Original orange lightness
    
    // Create new color with workspace hue but original saturation and lightness
    const adjustedColor = hslToHex(workspaceHsl.h, originalSaturation, originalLightness);
    const adjustedRgb = hexToRgb(adjustedColor);
    
    root.style.setProperty('--hover-show-active-bg', `rgba(${adjustedRgb.r}, ${adjustedRgb.g}, ${adjustedRgb.b}, 0.66)`);
    root.style.setProperty('--hover-show-active-border', `rgba(${adjustedRgb.r}, ${adjustedRgb.g}, ${adjustedRgb.b}, 0.2)`);
    root.style.setProperty('--hover-show-active-shadow', `0 8px 20px rgba(${adjustedRgb.r}, ${adjustedRgb.g}, ${adjustedRgb.b}, 0.55)`);
    
    // Set dropdown hover and selected colors using workspace background color
    const dropdownBgRgb = hexToRgb(workspaceBackgroundColor);
    root.style.setProperty('--dropdown-hover-bg', `rgba(${dropdownBgRgb.r}, ${dropdownBgRgb.g}, ${dropdownBgRgb.b}, 0.5)`);
    root.style.setProperty('--dropdown-selected-bg', `rgba(${dropdownBgRgb.r}, ${dropdownBgRgb.g}, ${dropdownBgRgb.b}, 0.903)`);
    root.style.setProperty('--dropdown-keyboard-selected-bg', `rgba(${r}, ${g}, ${b}, 0.8)`);
    root.style.setProperty('--dropdown-keyboard-selected-border', workspaceColor);
    
    // Set badge colors using workspace background color
    const badgeBgRgb = hexToRgb(adjustedColor);
    root.style.setProperty('--badge-bg', `rgba(${badgeBgRgb.r}, ${badgeBgRgb.g}, ${badgeBgRgb.b}, 0.8)`);
    root.style.setProperty('--badge-text', '#ffffff');
    root.style.setProperty('--badge-shadow', `0 1px 3px rgba(${badgeBgRgb.r}, ${badgeBgRgb.g}, ${badgeBgRgb.b}, 0.3)`);
    
    // Set custom dropdown badge colors using workspace background color with darker values
    // Convert workspace background to HSL, apply darker lightness values
    const badgeBgHsl = hexToHsl(workspaceColor);
    
    const badgeColor1 = hslToHex(badgeBgHsl.h, badgeBgHsl.s, BADGE_LIGHTNESS_1);
    const badgeColor2 = hslToHex(badgeBgHsl.h, badgeBgHsl.s, BADGE_LIGHTNESS_2);
    
    root.style.setProperty('--custom-dropdown-badge-bg', `linear-gradient(45deg, ${badgeColor1}, ${badgeColor2})`);
    root.style.setProperty('--custom-dropdown-badge-text', '#ffffff');
    
    // Set hover-show colored text using workspace color with consistent lightness
    const coloredTextHsl = hexToHsl(workspaceColor);
    const coloredTextColor = hslToHex(coloredTextHsl.h, coloredTextHsl.s, HOVER_SHOW_COLORED_LIGHTNESS);
    
    root.style.setProperty('--hover-show-colored-text', coloredTextColor);
    
    // Set status colors with workspace theming and brightness adjustments
    const statusErrorColor = adjustColorForTheme(workspaceColor, 'error');
    const statusInfoColor = adjustColorForTheme(workspaceColor, 'info');
    const statusWarningColor = adjustColorForTheme(workspaceColor, 'warning');
    const statusSuccessColor = adjustColorForTheme(workspaceColor, 'success');
    
    // Error status
    const errorRgb = hexToRgb(statusErrorColor);
    root.style.setProperty('--status-error', statusErrorColor);
    root.style.setProperty('--status-error-light', `${statusErrorColor}cc`);
    root.style.setProperty('--status-error-dark', `${statusErrorColor}99`);
    root.style.setProperty('--status-error-bg', `rgba(${errorRgb.r}, ${errorRgb.g}, ${errorRgb.b}, 0.2)`);
    root.style.setProperty('--status-error-border', `rgba(${errorRgb.r}, ${errorRgb.g}, ${errorRgb.b}, 0.33)`);
    root.style.setProperty('--status-error-text', `rgba(${errorRgb.r}, ${errorRgb.g}, ${errorRgb.b}, 0.8)`);
    
    // Info status
    const infoRgb = hexToRgb(statusInfoColor);
    root.style.setProperty('--status-info', statusInfoColor);
    root.style.setProperty('--status-info-light', `${statusInfoColor}cc`);
    root.style.setProperty('--status-info-dark', `${statusInfoColor}99`);
    root.style.setProperty('--status-info-bg', `rgba(${infoRgb.r}, ${infoRgb.g}, ${infoRgb.b}, 0.2)`);
    root.style.setProperty('--status-info-border', `rgba(${infoRgb.r}, ${infoRgb.g}, ${infoRgb.b}, 0.33)`);
    root.style.setProperty('--status-info-text', `rgba(${infoRgb.r}, ${infoRgb.g}, ${infoRgb.b}, 0.8)`);
    
    // Warning status
    const warningRgb = hexToRgb(statusWarningColor);
    root.style.setProperty('--status-warning', statusWarningColor);
    root.style.setProperty('--status-warning-light', `${statusWarningColor}cc`);
    root.style.setProperty('--status-warning-dark', `${statusWarningColor}99`);
    root.style.setProperty('--status-warning-bg', `rgba(${warningRgb.r}, ${warningRgb.g}, ${warningRgb.b}, 0.2)`);
    root.style.setProperty('--status-warning-border', `rgba(${warningRgb.r}, ${warningRgb.g}, ${warningRgb.b}, 0.33)`);
    root.style.setProperty('--status-warning-text', `rgba(${warningRgb.r}, ${warningRgb.g}, ${warningRgb.b}, 0.8)`);
    
    // Success status
    const successRgb = hexToRgb(statusSuccessColor);
    root.style.setProperty('--status-success', statusSuccessColor);
    root.style.setProperty('--status-success-light', `${statusSuccessColor}cc`);
    root.style.setProperty('--status-success-dark', `${statusSuccessColor}99`);
    root.style.setProperty('--status-success-bg', `rgba(${successRgb.r}, ${successRgb.g}, ${successRgb.b}, 0.2)`);
    root.style.setProperty('--status-success-border', `rgba(${successRgb.r}, ${successRgb.g}, ${successRgb.b}, 0.33)`);
    root.style.setProperty('--status-success-text', `rgba(${successRgb.r}, ${successRgb.g}, ${successRgb.b}, 0.8)`);
    
    // Set toggle button colors using workspace color with consistent lightness
    const toggleHsl = hexToHsl(workspaceColor);
    const toggleOnColor = hslToHex(toggleHsl.h, TOGGLE_ON_SATURATION, TOGGLE_ON_LIGHTNESS);
    const toggleOnHoverColor = hslToHex(toggleHsl.h, TOGGLE_ON_HOVER_SATURATION, TOGGLE_ON_HOVER_LIGHTNESS);
    
    root.style.setProperty('--toggle-on-bg', toggleOnColor);
    root.style.setProperty('--toggle-on-hover-bg', toggleOnHoverColor);
    
    // Set toggle button shadow colors maintaining original hue offset and lightness differences
    // Original: rgb(62 24 0) and rgb(83 38 0) - different hues and lightness
    // First shadow: darker, more saturated
    const toggleShadowColor1 = hslToHex(toggleHsl.h, TOGGLE_SHADOW_SATURATION, TOGGLE_SHADOW_LIGHTNESS);
    // Second shadow: lighter, less saturated (original offset maintained)
    const toggleShadowColor2 = hslToHex(toggleHsl.h, Math.max(0, TOGGLE_SHADOW_SATURATION - 20), Math.min(100, TOGGLE_SHADOW_LIGHTNESS + 15));
    
    const shadow1Rgb = hexToRgb(toggleShadowColor1);
    const shadow2Rgb = hexToRgb(toggleShadowColor2);
    
    root.style.setProperty('--toggle-shadow-color-58', `rgba(${shadow1Rgb.r}, ${shadow1Rgb.g}, ${shadow1Rgb.b}, 0.58)`);
    root.style.setProperty('--toggle-shadow-color-19', `rgba(${shadow2Rgb.r}, ${shadow2Rgb.g}, ${shadow2Rgb.b}, 0.19)`);
    
    // Set round button secondary background with dark tint
    const roundSecondaryColor = hslToHex(toggleHsl.h, ROUND_SECONDARY_SATURATION, ROUND_SECONDARY_LIGHTNESS);
    root.style.setProperty('--round-secondary-bg', roundSecondaryColor);

    // Convert workspace background color to HSL and create glass tint
    const glassBgHsl = hexToHsl(workspaceBackgroundColor);
    const glassTintH = glassBgHsl.h;
    const glassTintS = GLASS_TINT_SATURATION; // Use variable for glass tint saturation
    const glassTintL = Math.max(GLASS_TINT_MIN_LIGHTNESS, glassBgHsl.l * GLASS_TINT_LIGHTNESS_FACTOR); // Use variables for glass tint lightness
    
    // Convert back to RGB for CSS
    const glassTintRgb = hslToHex(glassTintH, glassTintS, glassTintL);
    const glassTintR = parseInt(glassTintRgb.slice(1, 3), 16);
    const glassTintG = parseInt(glassTintRgb.slice(3, 5), 16);
    const glassTintB = parseInt(glassTintRgb.slice(5, 7), 16);
    
    // Match the exact transparency levels from the CSS file for all glass layers
    // Dark glass layers
    root.style.setProperty('--glass-layer-dark-5', `rgb(${glassTintR} ${glassTintG} ${glassTintB} / 66%)`);
    root.style.setProperty('--glass-layer-dark-4', `rgb(${glassTintR} ${glassTintG} ${glassTintB} / 44%)`);
    root.style.setProperty('--glass-layer-dark-3', `rgb(${glassTintR} ${glassTintG} ${glassTintB} / 33%)`);
    root.style.setProperty('--glass-layer-dark-2', `rgb(${glassTintR} ${glassTintG} ${glassTintB} / 22%)`);
    root.style.setProperty('--glass-layer-dark-1', `rgb(${glassTintR} ${glassTintG} ${glassTintB} / 13%)`);
    
    // Regular glass layers (light)
    root.style.setProperty('--glass-layer-5', `rgba(255, 255, 255, 0.4)`);
    root.style.setProperty('--glass-layer-4', `rgba(255, 255, 255, 0.3)`);
    root.style.setProperty('--glass-layer-3', `rgba(255, 255, 255, 0.2)`);
    root.style.setProperty('--glass-layer-2', `rgba(255, 255, 255, 0.1)`);
    root.style.setProperty('--glass-layer-1', `rgba(255, 255, 255, 0.05)`);
    
    // Glass inset backgrounds
    root.style.setProperty('--glass-inset-bg-5', `rgba(255, 255, 255, 0.2)`);
    root.style.setProperty('--glass-inset-bg-4', `rgba(255, 255, 255, 0.15)`);
    root.style.setProperty('--glass-inset-bg-3', `rgba(255, 255, 255, 0.12)`);
    root.style.setProperty('--glass-inset-bg-2', `rgba(255, 255, 255, 0.08)`);
    root.style.setProperty('--glass-inset-bg-1', `rgba(255, 255, 255, 0.05)`);
}

// Animate workspace transition with bokeh circle movement
async function animateWorkspaceTransition() {
    const bokeh = document.querySelector('.bokeh');
    const currentBg = document.querySelector('.current-bg');
    const nextBg = document.querySelector('.next-bg');

    if (!bokeh || !currentBg || !nextBg) return;


    // Step 1: Move all circles off-screen (0.3s)
    console.log('🎬 Starting workspace transition animation');

    // Preload background image if it exists to prevent flickering
    if (activeWorkspaceBackgroundImage) {
        const img = new Image();
        img.src = `/images/${activeWorkspaceBackgroundImage}`;
        new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            // Timeout after 2 seconds to prevent hanging
            setTimeout(resolve, 2000);
        }).catch(() => {
            console.warn('Failed to preload background image:', activeWorkspaceBackgroundImage);
        });
    }

    // Step 2: Update background with fade transition
    updateBokehBackgroundWithFade();
}

// Update bokeh background with fade transition between layers
async function updateBokehBackgroundWithFade() {
    const currentBg = document.querySelector('.current-bg');
    const nextBg = document.querySelector('.next-bg');
    const bokeh = document.querySelector('.bokeh');

    if (!currentBg || !nextBg || !bokeh) return;

    // Generate color variations based on the workspace color
    const baseColor = activeWorkspaceColor;
    const colorVariations = generateColorVariations(baseColor);

    // Update the bokeh circles with new colors and opacity using requestAnimationFrame
    const circles = bokeh.querySelectorAll('circle');
    let i = 0;
    function updateCircle() {
        if (i >= circles.length) return;
        const circle = circles[i];
        const colorIndex = i % colorVariations.length;
        const color = colorVariations[colorIndex];
        // Make circles more opaque than background
        const circleOpacity = Math.min(1, activeWorkspaceBackgroundOpacity + 0.3);
        circle.style.fill = color;
        circle.style.opacity = circleOpacity;
        i++;
        requestAnimationFrame(updateCircle);
    }
    updateCircle();

    workspaceTabs.classList.remove('inactive');

    // Set up the bokeh background color with transparency
    const backgroundColor = activeWorkspaceBackgroundColor || generateBackgroundColor(baseColor);
    const transparentColor = addTransparency(backgroundColor, 0.25); // 25% transparency
    bokeh.style.backgroundColor = transparentColor;
    // Set up the next background layer for images only
    if (activeWorkspaceBackgroundImage) {
        // Set background image on the div
        nextBg.style.backgroundImage = `url('/images/${activeWorkspaceBackgroundImage}')`;
        nextBg.style.backgroundSize = 'cover';
        nextBg.style.backgroundPosition = 'top center';
        nextBg.style.backgroundRepeat = 'no-repeat';
        nextBg.style.backgroundColor = 'transparent';
    } else {
        // No background image
        nextBg.style.backgroundImage = 'none';
        nextBg.style.backgroundColor = 'transparent';
    }

    // Fade from current to next background
    nextBg.style.opacity = '1';

    // Wait for the fade transition to complete
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Swap the layers - copy all properties to ensure no flickering
    currentBg.style.backgroundImage = nextBg.style.backgroundImage;
    currentBg.style.backgroundSize = nextBg.style.backgroundSize;
    currentBg.style.backgroundPosition = nextBg.style.backgroundPosition;
    currentBg.style.backgroundRepeat = nextBg.style.backgroundRepeat;
    currentBg.style.backgroundColor = nextBg.style.backgroundColor;
    currentBg.style.backgroundBlendMode = nextBg.style.backgroundBlendMode || 'normal';

    // Reset next background - ensure it's completely transparent
    nextBg.style.opacity = '0';
    nextBg.style.backgroundImage = 'none';
    nextBg.style.backgroundColor = 'transparent';
    nextBg.style.backgroundBlendMode = 'normal';
}

// Update bokeh background with workspace color (for initial load and non-animated updates)
function updateBokehBackground() {
    const currentBg = document.querySelector('.current-bg');
    const bokeh = document.querySelector('.bokeh');
    if (!currentBg || !bokeh) return;

    // Generate color variations based on the workspace color
    const baseColor = activeWorkspaceColor;
    const colorVariations = generateColorVariations(baseColor);

    // Update the bokeh circles with new colors and opacity using requestAnimationFrame
    const circles = bokeh.querySelectorAll('circle');
    let i = 0;
    function updateCircle() {
        if (i >= circles.length) return;
        const circle = circles[i];
        const colorIndex = i % colorVariations.length;
        const color = colorVariations[colorIndex];
        // Make circles more opaque than background
        const circleOpacity = Math.min(1, activeWorkspaceBackgroundOpacity + 0.3);
        circle.style.fill = color;
        circle.style.opacity = circleOpacity;
        i++;
        requestAnimationFrame(updateCircle);
    }
    updateCircle();

    // Update the bokeh background color with transparency
    const backgroundColor = activeWorkspaceBackgroundColor || generateBackgroundColor(baseColor);
    const transparentColor = addTransparency(backgroundColor, 0.25); // 25% transparency
    bokeh.style.backgroundColor = transparentColor;

    // Update the current background layer for images only
    if (activeWorkspaceBackgroundImage) {
        // Set background image on the div
        currentBg.style.backgroundImage = `url('/images/${activeWorkspaceBackgroundImage}')`;
        currentBg.style.backgroundSize = 'cover';
        currentBg.style.backgroundPosition = 'top center';
        currentBg.style.backgroundRepeat = 'no-repeat';
        currentBg.style.backgroundColor = 'transparent';
    } else {
        // No background image
        currentBg.style.backgroundImage = 'none';
        currentBg.style.backgroundColor = 'transparent';
    }

    console.log('🎨 Updated bokeh background:', {
        color: baseColor,
        backgroundColor: transparentColor,
        backgroundImage: activeWorkspaceBackgroundImage,
        opacity: activeWorkspaceBackgroundOpacity
    });
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
            await window.wsClient.createWorkspace(name);
        } else {
            showError('Failed to create workspace: WebSocket not connected');
            throw new Error('Failed to create workspace');
        }

        await loadWorkspaces();
        switchGalleryView(currentGalleryView, true);
        await loadCacheImages(); // Refresh cache browser to show new workspace filtering
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
            await window.wsClient.deleteWorkspace(id);
        } else {
            showError('Failed to delete workspace: WebSocket not connected');
            throw new Error('Failed to delete workspace');
        }

        await loadWorkspaces();
        switchGalleryView(currentGalleryView, true);
        await loadCacheImages(); // Refresh cache browser to show updated filtering
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
            await window.wsClient.dumpWorkspace(sourceId, targetId);
        } else {
            showError('Failed to dump workspace: WebSocket not connected');
            throw new Error('Failed to dump workspace');
        }

        await loadWorkspaces();
        switchGalleryView(currentGalleryView, true);
        await loadCacheImages(); // Refresh cache browser
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
                    <img class="loading" src="/azuspin.gif" alt="Loading">
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

        // Update workspace settings immediately
        const workspace = workspaces[activeWorkspace];
        if (workspace) {
            activeWorkspaceColor = workspace.color || '#124';
            activeWorkspaceBackgroundColor = workspace.backgroundColor;
            activeWorkspaceBackgroundImage = workspace.backgroundImage;
            activeWorkspaceBackgroundOpacity = workspace.backgroundOpacity || 0.3;
            
            // Update header tint with new workspace color
            updateHeaderTint();
            updateWorkspaceTheme();
        }
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
        workspaceTabs.classList.add('inactive');
    }
}

async function moveFilesToWorkspace(filenames, targetWorkspaceId) {
    try {
        let result;
        
        // Use WebSocket API if available, otherwise fall back to HTTP
        if (window.wsClient && window.wsClient.isConnected()) {
            result = await window.wsClient.moveFilesToWorkspace(filenames, targetWorkspaceId);
        } else {
            showError('Failed to move files: WebSocket not connected');
            throw new Error('Failed to move files');
        }

        switchGalleryView(currentGalleryView, true);
        showGlassToast('success', null, `Moved ${result.movedCount} files to workspace`, false, 5000, '<i class="fas fa-copy"></i>');
    } catch (error) {
        console.error('Error moving files to workspace:', error);
        showError('Failed to move files: ' + error.message);
    }
}

// Update workspace color
async function updateWorkspaceColor(id, color) {
    try {
        // Use WebSocket API if available, otherwise fall back to HTTP
        if (window.wsClient && window.wsClient.isConnected()) {
            await window.wsClient.updateWorkspaceColor(id, color);
        } else {
            showError('Failed to update workspace color: WebSocket not connected');
            throw new Error('Failed to update workspace color');
        }
        
        // Update theme if this is the active workspace
        if (id === activeWorkspace) {
            activeWorkspaceColor = color;
            updateHeaderTint();
            updateWorkspaceTheme();
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
            await window.wsClient.updateWorkspaceBackgroundColor(id, backgroundColor);
        } else {
            showError('Failed to update workspace background color: WebSocket not connected');
            throw new Error('Failed to update workspace background color');
        }
        
        // Update theme if this is the active workspace
        if (id === activeWorkspace) {
            activeWorkspaceBackgroundColor = backgroundColor;
            updateWorkspaceTheme();
        }
    } catch (error) {
        console.error('Error updating workspace background color:', error);
        showError('Failed to update workspace background color: ' + error.message);
    }
}

// Update workspace background image
async function updateWorkspaceBackgroundImage(id, backgroundImage) {
    try {
        // Use WebSocket API if available, otherwise fall back to HTTP
        if (window.wsClient && window.wsClient.isConnected()) {
            await window.wsClient.updateWorkspaceBackgroundImage(id, backgroundImage);
        } else {
            showError('Failed to update workspace background image: WebSocket not connected');
            throw new Error('Failed to update workspace background image');
        }
    } catch (error) {
        console.error('Error updating workspace background image:', error);
        showError('Failed to update workspace background image: ' + error.message);
    }
}

// Update workspace background opacity
async function updateWorkspaceBackgroundOpacity(id, backgroundOpacity) {
    try {
        // Use WebSocket API if available, otherwise fall back to HTTP
        if (window.wsClient && window.wsClient.isConnected()) {
            await window.wsClient.updateWorkspaceBackgroundOpacity(id, backgroundOpacity);
        } else {
            showError('Failed to update workspace background opacity: WebSocket not connected');
            throw new Error('Failed to update workspace background opacity');
        }
    } catch (error) {
        console.error('Error updating workspace background opacity:', error);
        showError('Failed to update workspace background opacity: ' + error.message);
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
        option.className = 'custom-dropdown-option' + (workspace.isActive ? ' selected' : '');
        option.tabIndex = 0;
        option.dataset.value = workspace.id;

        option.innerHTML = `
            <div class="workspace-option-content">
                <div class="workspace-color-indicator" style="background-color: ${workspace.color || '#124'}"></div>
                <span class="workspace-name">${workspace.name}</span>
                <span class="workspace-counts">${workspace.fileCount} files</span>
            </div>
        `;

        const action = () => {
            if (!workspace.isActive) {
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

    // Update desktop workspace tabs
    renderWorkspaceTabs();
}

function updateActiveWorkspaceDisplay() {
    const workspaceSelected = document.getElementById('workspaceSelected');
    if (!workspaceSelected) return;

    const activeWorkspaceData = workspaces[activeWorkspace];
    if (activeWorkspaceData) {
        workspaceSelected.textContent = activeWorkspaceData.name;
    }

    // Update desktop workspace tabs
    renderWorkspaceTabs();
}

function openWorkspaceDropdown() {
    openDropdown(document.getElementById('workspaceDropdownMenu'), document.getElementById('workspaceDropdownBtn'));
}

function closeWorkspaceDropdown() {
    closeDropdown(document.getElementById('workspaceDropdownMenu'), document.getElementById('workspaceDropdownBtn'));
}

// Desktop workspace tabs functionality
function renderWorkspaceTabs() {
    if (!workspaceTabs) return;

    workspaceTabs.innerHTML = '';

    // Sort workspaces by their sort order - workspaces is an object, not an array
    const sortedWorkspaces = Object.values(workspaces).sort((a, b) => (a.sort || 0) - (b.sort || 0));

    sortedWorkspaces.forEach(workspace => {
        const tab = document.createElement('div');
        tab.className = 'workspace-tab' + (workspace.isActive ? ' active' : '');
        tab.dataset.workspaceId = workspace.id;

        // Use workspace color as background for active tab
        if (workspace.isActive) {
            const workspaceColor = workspace.color || '#124';
            tab.style.background = `${workspaceColor}89`;
            tab.style.color = '#ffffff';
            tab.style.borderColor = `${workspaceColor}88`;
        }

        tab.innerHTML = `
            <span class="workspace-name">${workspace.name}</span>
        `;

        const action = () => {
            if (!workspace.isActive) {
                workspaceTabs.classList.add('inactive');
                setActiveWorkspace(workspace.id);
            }
        };

        tab.addEventListener('click', action);
        workspaceTabs.appendChild(tab);
    });

    // Add new workspace management button as a tab
    const workspaceNewTab = document.createElement('div');
    workspaceNewTab.className = 'workspace-tab workspace-options-tab';
    workspaceNewTab.title = 'New Workspace';
    workspaceNewTab.innerHTML = '<i class="fas fa-plus"></i>';
    workspaceNewTab.addEventListener('click', () => {
        showAddWorkspaceModal();
    });
    workspaceTabs.appendChild(workspaceNewTab);

    // Add workspace management button as a tab
    const workspaceManageTab = document.createElement('div');
    workspaceManageTab.className = 'workspace-tab workspace-options-tab';
    workspaceManageTab.title = 'Manage Workspaces';
    workspaceManageTab.innerHTML = '<i class="fas fa-cog"></i>';
    workspaceManageTab.addEventListener('click', () => {
        showWorkspaceManagementModal();
    });
    workspaceTabs.appendChild(workspaceManageTab);

    // Add reference manager button as a tab
    const cacheManagerTab = document.createElement('div');
    cacheManagerTab.className = 'workspace-tab workspace-options-tab';
    cacheManagerTab.title = 'Reference Manager';
    cacheManagerTab.innerHTML = '<i class="fas fa-swatchbook"></i>';
    cacheManagerTab.addEventListener('click', () => {
        if (typeof showCacheManagerModal === 'function') {
            showCacheManagerModal();
        }
    });
    workspaceTabs.appendChild(cacheManagerTab);
}

function renderWorkspaceManagementList() {
    const list = document.getElementById('workspaceManageList');
    if (!list) return;

    console.log('🔄 Rendering workspace management list...');
    console.log('📊 Current workspaces:', Object.values(workspaces).map(w => ({ id: w.id, name: w.name, sort: w.sort })));

    list.innerHTML = '';

    // Sort workspaces by their sort order - workspaces is an object, not an array
    const sortedWorkspaces = Object.values(workspaces).sort((a, b) => (a.sort || 0) - (b.sort || 0));
    console.log('📊 Sorted workspaces:', sortedWorkspaces.map(w => ({ id: w.id, name: w.name, sort: w.sort })));

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
                    <div class="workspace-color-indicator" style="background-color: ${workspace.color || '#124'}"></div>
                    <h5>${workspace.name} ${workspace.isActive ? '<span class="badge-active"><i class="fas fa-check"></i></span>' : ''}</h5>
                </div>
                <span class="workspace-manage-counts">${workspace.fileCount} files, ${workspace.cacheFileCount} references</span>
            </div>
            <div class="workspace-manage-actions">
                <button type="button" class="btn-secondary" onclick="editWorkspaceSettings('${workspace.id}')" title="Workspace Settings">
                    <i class="fas fa-cog"></i>
                </button>
                ${!workspace.isDefault ? `
                    <button type="button" class="btn-secondary" onclick="showDumpWorkspaceModal('${workspace.id}', '${workspace.name}')" title="Dump">
                        <i class="fas fa-copy"></i>
                    </button>
                    <button type="button" class="btn-secondary text-danger" onclick="confirmDeleteWorkspace('${workspace.id}', '${workspace.name}')" title="Delete">
                        <i class="fas fa-trash"></i>
                    </button>
                ` : ''}
            </div>
        `;

        list.appendChild(item);
    });

    console.log('✅ Workspace management list rendered with', sortedWorkspaces.length, 'items');

    // Initialize drag and drop functionality
    initializeWorkspaceDragAndDrop();
}

// Workspace modal functions
function showWorkspaceManagementModal() {
    renderWorkspaceManagementList();
    const modal = document.getElementById('workspaceManageModal');
    openModal(modal);
}

function hideWorkspaceManagementModal() {
    const modal = document.getElementById('workspaceManageModal');
    if (modal) closeModal(modal);
    updateWorkspaceTheme();
    // Don't refresh immediately - wait for server response for reorder operations
}

function showAddWorkspaceModal() {
    currentWorkspaceOperation = { type: 'add' };
    document.getElementById('workspaceEditTitle').textContent = 'Add Workspace';
    document.getElementById('workspaceNameInput').style.display = 'block';
    document.getElementById('workspaceColorInput').style.display = 'block';
    document.getElementById('workspaceBackgroundColorInput').style.display = 'block';
    document.getElementById('workspaceBackgroundImageInput').style.display = 'block';
    document.getElementById('workspaceBackgroundOpacityInput').style.display = 'block';
    document.getElementById('workspaceNameInput').value = '';
    document.getElementById('workspaceColorInput').value = '#124';
    document.getElementById('workspaceBackgroundColorInput').value = '#0a1a2a';
    document.getElementById('workspaceBackgroundImageInput').value = '';
    document.getElementById('workspaceBackgroundImageInput').placeholder = 'No background image selected';
    document.getElementById('workspaceBackgroundOpacityInput').value = '0.3';
    document.getElementById('workspaceBackgroundOpacityInput').textContent = '30';
    const modal = document.getElementById('workspaceEditModal');
    openModal(modal);
}

async function editWorkspaceSettings(id) {
    currentWorkspaceOperation = { type: 'settings', id };
    document.getElementById('workspaceEditTitle').textContent = 'Workspace Settings';

    // Show all form elements
    document.getElementById('workspaceNameInput').style.display = 'block';
    document.getElementById('workspaceColorInput').style.display = 'block';
    document.getElementById('workspaceBackgroundColorInput').style.display = 'block';
    document.getElementById('workspaceBackgroundImageInput').style.display = 'block';
    document.getElementById('workspaceBackgroundOpacityInput').style.display = 'block';

    // Get workspace data
    const workspace = workspaces[id];
    if (workspace) {
        // Set current values
        document.getElementById('workspaceNameInput').value = workspace.name;
        document.getElementById('workspaceColorInput').value = workspace.color || '#124';
        document.getElementById('workspaceBackgroundColorInput').value = workspace.backgroundColor || '#0a1a2a';
        document.getElementById('workspaceBackgroundOpacityInput').value = workspace.backgroundOpacity || 0.3;

        // Update opacity display
        const opacityValue = document.getElementById('workspaceBackgroundOpacityInput');
        if (opacityValue) {
            opacityValue.textContent = Math.round((workspace.backgroundOpacity || 0.3) * 100);
        }

        // Background images will be loaded when the modal is opened

        // Set background image if exists
        const backgroundImageInput = document.getElementById('workspaceBackgroundImageInput');
        if (backgroundImageInput) {
            backgroundImageInput.value = workspace.backgroundImage || '';
            backgroundImageInput.placeholder = workspace.backgroundImage ? workspace.backgroundImage : 'No background image selected';
        }
    }

    const modal = document.getElementById('workspaceEditModal');
    if (modal) openModal(modal);
}

function hideWorkspaceEditModal() {
    const modal = document.getElementById('workspaceEditModal');
    if (modal) closeModal(modal);

    // Reset form
    document.getElementById('workspaceNameInput').style.display = 'block';
    document.getElementById('workspaceColorInput').style.display = 'block';
    document.getElementById('workspaceBackgroundColorInput').style.display = 'block';
    document.getElementById('workspaceBackgroundImageInput').style.display = 'block';
    document.getElementById('workspaceBackgroundOpacityInput').style.display = 'block';
    document.getElementById('workspaceNameInput').value = '';
    document.getElementById('workspaceColorInput').value = '#124';
    document.getElementById('workspaceBackgroundColorInput').value = '#0a1a2a';
    document.getElementById('workspaceBackgroundImageInput').value = '';
    document.getElementById('workspaceBackgroundImageInput').placeholder = 'No background image selected';
    document.getElementById('workspaceBackgroundOpacityInput').value = '0.3';
    document.getElementById('workspaceBackgroundOpacityInput').textContent = '30%';

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
        workspaceManageBtn.addEventListener('click', () => {
            showWorkspaceManagementModal();
        });
    }

    if (workspaceAddBtn) {
        workspaceAddBtn.addEventListener('click', () => {
            showAddWorkspaceModal();
        });
    }

    // Modal close events
    document.getElementById('closeWorkspaceManageBtn')?.addEventListener('click', hideWorkspaceManagementModal);
    document.getElementById('closeWorkspaceEditBtn')?.addEventListener('click', hideWorkspaceEditModal);
    document.getElementById('closeWorkspaceDumpBtn')?.addEventListener('click', hideWorkspaceDumpModal);
    document.getElementById('workspaceCancelBtn')?.addEventListener('click', hideWorkspaceEditModal);
    document.getElementById('workspaceDumpCancelBtn')?.addEventListener('click', hideWorkspaceDumpModal);

    // Background image modal close events
    document.getElementById('closeBackgroundImageModalBtn')?.addEventListener('click', hideBackgroundImageModal);
    document.getElementById('backgroundImageCancelBtn')?.addEventListener('click', hideBackgroundImageModal);

    // Bulk change preset modal events
    document.getElementById('closeBulkChangePresetBtn')?.addEventListener('click', () => {
        document.getElementById('bulkChangePresetModal').style.display = 'none';
    });
    document.getElementById('bulkChangePresetCancelBtn')?.addEventListener('click', () => {
        document.getElementById('bulkChangePresetModal').style.display = 'none';
    });
    document.getElementById('bulkChangePresetConfirmBtn')?.addEventListener('click', handleBulkChangePresetConfirm);

    // Save workspace
    document.getElementById('workspaceSaveBtn')?.addEventListener('click', async () => {
        if (currentWorkspaceOperation) {
            if (currentWorkspaceOperation.type === 'add') {
                const name = document.getElementById('workspaceNameInput').value.trim();
                const color = document.getElementById('workspaceColorInput').value.trim();
                const backgroundColor = document.getElementById('workspaceBackgroundColorInput').value.trim();
                const backgroundImage = document.getElementById('workspaceBackgroundImageInput').value.trim();
                const backgroundOpacity = parseFloat(document.getElementById('workspaceBackgroundOpacityInput').value);

                if (!name) {
                    showError('Please enter a workspace name');
                    return;
                }
                // Create workspace with just the name
                await createWorkspace(name);
                // Get the newly created workspace ID and update its settings
                await loadWorkspaces();
                const newWorkspace = Object.values(workspaces).find(w => w.name === name);
                if (newWorkspace) {
                    await Promise.all([
                        updateWorkspaceColor(newWorkspace.id, color),
                        updateWorkspaceBackgroundColor(newWorkspace.id, backgroundColor || null),
                        updateWorkspaceBackgroundImage(newWorkspace.id, backgroundImage || null),
                        updateWorkspaceBackgroundOpacity(newWorkspace.id, backgroundOpacity)
                    ]);
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
                const backgroundImage = document.getElementById('workspaceBackgroundImageInput').value.trim();
                const backgroundOpacity = parseFloat(document.getElementById('workspaceBackgroundOpacityInput').value);

                if (!name) {
                    showError('Please enter a workspace name');
                    return;
                }

                // Update all settings
                await Promise.all([
                    renameWorkspace(currentWorkspaceOperation.id, name),
                    updateWorkspaceColor(currentWorkspaceOperation.id, color),
                    updateWorkspaceBackgroundColor(currentWorkspaceOperation.id, backgroundColor || null),
                    updateWorkspaceBackgroundImage(currentWorkspaceOperation.id, backgroundImage || null),
                    updateWorkspaceBackgroundOpacity(currentWorkspaceOperation.id, backgroundOpacity)
                ]);
                await loadWorkspaces();

                // Update bokeh background if this is the active workspace
                if (currentWorkspaceOperation.id === activeWorkspace) {
                    activeWorkspaceBackgroundOpacity = backgroundOpacity;
                    activeWorkspaceBackgroundImage = backgroundImage;
                    activeWorkspaceBackgroundColor = backgroundColor;
                    activeWorkspaceColor = color;
                    animateWorkspaceTransition();
                    updateHeaderTint();
                }
            }
        }

        hideWorkspaceEditModal();
        hideWorkspaceManagementModal();
    });

    // Dump workspace
    document.getElementById('workspaceDumpConfirmBtn')?.addEventListener('click', async () => {
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

    // Add wheel event for workspace background opacity input
    const opacityInput = document.getElementById('workspaceBackgroundOpacityInput');
    if (opacityInput) {
        opacityInput.addEventListener('wheel', function(e) {
            e.preventDefault();
            const step = parseFloat(opacityInput.step) || 0.01;
            let value = parseFloat(opacityInput.value) || 0.3;
            if (e.deltaY < 0) {
                value += step;
            } else {
                value -= step;
            }
            value = Math.max(0, Math.min(1, Math.round(value * 100) / 100));
            opacityInput.value = value;
            opacityInput.dispatchEvent(new Event('input', { bubbles: true }));
        }, { passive: false });
    }
    
    // Apply initial header tint with current workspace color
    updateHeaderTint();
    updateWorkspaceTheme();
}

// Initialize workspace settings form event listeners
function initializeWorkspaceSettingsForm() {
    // Background image selection button
    const selectBackgroundImageBtn = document.getElementById('selectBackgroundImageBtn');
    if (selectBackgroundImageBtn) {
        selectBackgroundImageBtn.addEventListener('click', () => {
            showBackgroundImageModal();
        });
    }
}

async function showBackgroundImageModal() {
    const modal = document.getElementById('backgroundImageModal');
    const grid = document.getElementById('backgroundImageGrid');
    const loading = document.getElementById('backgroundImageLoading');
    const searchInput = document.getElementById('backgroundImageSearchInput');

    if (!modal || !grid || !loading) return;

    // Show modal
    openModal(modal);

    // Show loading
    loading.style.display = 'flex';
    grid.innerHTML = '';

    try {
        // Get current workspace images
        const workspaceImages = await getWorkspaceImages();

        // Hide loading
        loading.style.display = 'none';

        // Populate grid
        populateBackgroundImageGrid(workspaceImages);

        // Set up search functionality
        setupBackgroundImageSearch(searchInput, workspaceImages);

        // Set up selection handlers
        setupBackgroundImageSelection();

    } catch (error) {
        console.error('Error loading background images:', error);
        loading.style.display = 'none';
        grid.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">Error loading images</p>';
    }
}

async function getWorkspaceImages() {
    try {
        // Get current workspace ID
        const workspaceId = currentWorkspaceOperation?.id || activeWorkspace;
        
        let workspaceFiles = [];
        
        // Use WebSocket API if available, otherwise fall back to HTTP
        if (window.wsClient && window.wsClient.isConnected()) {
            try {
                const data = await window.wsClient.getWorkspaceFiles(workspaceId);
                if (data) {
                    workspaceFiles = data.files || [];
                }
            } catch (wsError) {
                console.warn('WebSocket workspace files failed, falling back to HTTP:', wsError);
                showError('Failed to load workspace images: ' + wsError.message);
                throw new Error('Failed to load workspace images');
            }
        } else {
            showError('Failed to load workspace images: WebSocket not connected');
            throw new Error('Failed to load workspace images');
        }

        const workspaceFilesSet = new Set(workspaceFiles);

        // Get all images from the filesystem (not filtered by active workspace)
        const allImagesResponse = await fetchWithAuth('/images/all');
        if (!allImagesResponse.ok) throw new Error('Failed to load all images');

        const allImagesItems = await allImagesResponse.json();

        // Filter images to only include workspace files
        const filteredImages = allImagesItems.filter(img => {
            const file = img.upscaled || img.original;
            return workspaceFilesSet.has(file);
        });

        return filteredImages;
    } catch (error) {
        console.error('Error getting workspace images:', error);
        showError('Failed to load workspace images: ' + error.message);
        return [];
    }
}

function populateBackgroundImageGrid(images) {
    const grid = document.getElementById('backgroundImageGrid');
    if (!grid) return;

    grid.innerHTML = '';

    images.forEach(img => {
        const file = img.upscaled || img.original;
        const preview = img.preview;

        const option = document.createElement('button');
        option.type = 'button';
        option.className = 'background-image-option';
        option.dataset.filename = file;

        option.innerHTML = `
            <div class="background-image-thumbnail" style="background-image: url('/previews/${preview}')"></div>
        `;

        grid.appendChild(option);
    });
}

function setupBackgroundImageSearch(searchInput, allImages) {
    if (!searchInput) return;

    searchInput.addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase();
        const grid = document.getElementById('backgroundImageGrid');
        const options = grid.querySelectorAll('.background-image-option');

        options.forEach(option => {
            const filename = option.dataset.filename.toLowerCase();
            if (filename.includes(searchTerm)) {
                option.style.display = 'flex';
            } else {
                option.style.display = 'none';
            }
        });
    });
}

function setupBackgroundImageSelection() {
    const grid = document.getElementById('backgroundImageGrid');
    const noImageBtn = document.getElementById('noBackgroundImageBtn');

    // Clear previous selections
    const allOptions = document.querySelectorAll('.background-image-option');
    allOptions.forEach(option => option.classList.remove('selected'));
    if (noImageBtn) noImageBtn.classList.remove('selected');

    // Set current selection
    const currentInput = document.getElementById('workspaceBackgroundImageInput');
    const currentValue = currentInput ? currentInput.value : '';

    if (!currentValue) {
        if (noImageBtn) noImageBtn.classList.add('selected');
    } else {
        const selectedOption = grid.querySelector(`[data-filename="${currentValue}"]`);
        if (selectedOption) selectedOption.classList.add('selected');
    }

    // Add click handlers
    if (noImageBtn) {
        noImageBtn.addEventListener('click', () => {
            selectBackgroundImage(null);
        });
    }

    const options = grid.querySelectorAll('.background-image-option');
    options.forEach(option => {
        option.addEventListener('click', () => {
            const filename = option.dataset.filename;
            selectBackgroundImage(filename);
        });
    });
}

function selectBackgroundImage(filename) {
    selectedBackgroundImage = filename;

    // Update visual selection
    const allOptions = document.querySelectorAll('.background-image-option');
    const noImageBtn = document.getElementById('noBackgroundImageBtn');

    allOptions.forEach(option => option.classList.remove('selected'));
    if (noImageBtn) noImageBtn.classList.remove('selected');

    if (!filename) {
        if (noImageBtn) noImageBtn.classList.add('selected');
    } else {
        const selectedOption = document.querySelector(`[data-filename="${filename}"]`);
        if (selectedOption) selectedOption.classList.add('selected');
    }

    // Update input field
    const input = document.getElementById('workspaceBackgroundImageInput');
    if (input) {
        input.value = filename || '';
        input.placeholder = filename ? filename : 'No background image selected';
    }

    // Close modal
    hideBackgroundImageModal();
}

function hideBackgroundImageModal() {
    const modal = document.getElementById('backgroundImageModal');
    closeModal(modal);

    // Clear search
    const searchInput = document.getElementById('backgroundImageSearchInput');
    if (searchInput) searchInput.value = '';

    selectedBackgroundImage = null;
}

// Register initialization steps with WebSocket client
if (window.wsClient) {
    // Priority 1: Initialize background layers
    window.wsClient.registerInitStep(1, 'Initializing background layers', async () => {
        initializeBokehBackgrounds();
    });

    // Priority 2: Initialize workspace system
    window.wsClient.registerInitStep(2, 'Initializing workspace system', async () => {
        initializeWorkspaceSystem();
    });

    // Priority 3: Initialize workspace settings form event listeners
    window.wsClient.registerInitStep(3, 'Setting up workspace settings', async () => {
        initializeWorkspaceSettingsForm();
    });

    // Priority 4: Initialize WebSocket workspace event listeners
    window.wsClient.registerInitStep(4, 'Setting up workspace events', async () => {
        initializeWebSocketWorkspaceEvents();
    });
} else {
    // Fallback initialization if WebSocket client isn't available yet
    document.addEventListener('DOMContentLoaded', async function() {
        try {
            // Initialize background layers
            initializeBokehBackgrounds();

            // Initialize workspace system
            initializeWorkspaceSystem();

            // Initialize workspace settings form event listeners
            initializeWorkspaceSettingsForm();

            // Initialize WebSocket workspace event listeners
            initializeWebSocketWorkspaceEvents();

        } catch (error) {
            console.error('Error initializing workspace system:', error);
        }
    });
}

// Initialize WebSocket workspace event listeners
function initializeWebSocketWorkspaceEvents() {
    // Listen for workspace updates from WebSocket
    document.addEventListener('workspaceUpdated', (event) => {
        const data = event.detail;
        
        // Handle different types of workspace updates
        switch (data.action) {
            case 'created':
            case 'renamed':
            case 'deleted':
            case 'dumped':
                // Refresh workspace data and UI
                loadWorkspaces();
                updateHeaderTint();
                updateWorkspaceTheme();
                
                // If workspace management modal is open, refresh it
                const workspaceManageModal = document.getElementById('workspaceManageModal');
                if (workspaceManageModal && workspaceManageModal.style.display !== 'none') {
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
                
                // Refresh workspace data and UI
                loadWorkspaces();
                updateHeaderTint();
                updateWorkspaceTheme();
                
                // If workspace management modal is open, refresh it
                const workspaceManageModalAfterReorder = document.getElementById('workspaceManageModal');
                if (workspaceManageModalAfterReorder && workspaceManageModalAfterReorder.style.display !== 'none') {
                    renderWorkspaceManagementList();
                }
                break;
            case 'files_moved':
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
            case 'color_updated':
                // Update theme when workspace color changes
                const updatedWorkspace = workspaces[data.workspaceId];
                if (updatedWorkspace && updatedWorkspace.isActive) {
                    activeWorkspaceColor = updatedWorkspace.color || '#124';
                    updateHeaderTint();
                    updateWorkspaceTheme();
                }
                switchGalleryView(currentGalleryView, true);
                loadCacheImages();
                break;
            case 'background_color_updated':
            case 'background_image_updated':
            case 'background_opacity_updated':
                // Refresh workspace data and UI
                loadWorkspaces();
                switchGalleryView(currentGalleryView, true);
                loadCacheImages();
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
            activeWorkspaceColor = workspace.color || '#124';
            activeWorkspaceBackgroundColor = workspace.backgroundColor;
            activeWorkspaceBackgroundImage = workspace.backgroundImage;
            activeWorkspaceBackgroundOpacity = workspace.backgroundOpacity || 0.3;
            
            // Update header tint with new workspace color
            updateHeaderTint();
            updateWorkspaceTheme();
        }
        
        // Refresh all UI components
        await loadWorkspaces();
        updateActiveWorkspaceDisplay();
        
        // Set up the completion callback and load gallery
        window.workspaceLoadingCompleteCallback = completeWorkspaceSwitch;
        switchGalleryView(currentGalleryView, true);
        loadCacheImages();
        
        // Fade in gallery
        if (gallery) {
            gallery.style.transition = 'opacity 0.3s ease-in';
            gallery.style.opacity = '1';
        }
        
        // Remove workspace loading overlay after gallery is loaded
        const workspaceLoadingOverlay = document.getElementById('workspaceLoadingOverlay');
        if (workspaceLoadingOverlay) {
            workspaceLoadingOverlay.remove();
        }
        
        // Clear the workspace switching flag
        isWorkspaceSwitching = false;
        window.isWorkspaceSwitching = false;

        // Remove 'inactive' class from all workspace tabs
        workspaceTabs.classList.remove('inactive');
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

    // Remove 'inactive' class from all workspace tabs
    const workspaceTabs = document.querySelector('.workspace-tabs');
    if (workspaceTabs) {
        workspaceTabs.classList.remove('inactive');
    }
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

        // Add event listeners for drag movement
        document.addEventListener('mousemove', onDrag);
        document.addEventListener('touchmove', onDrag, { passive: false });
        document.addEventListener('mouseup', endDrag);
        document.addEventListener('touchend', endDrag);

        // Prevent text selection during drag
        document.body.style.userSelect = 'none';

    }

    function onDrag(e) {
        if (!draggedItem) {
            return;
        }

        e.preventDefault();

        const clientY = e.type === 'mousemove' ? e.clientY : e.touches[0].clientY;
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

        // Remove event listeners
        document.removeEventListener('mousemove', onDrag);
        document.removeEventListener('touchmove', onDrag);
        document.removeEventListener('mouseup', endDrag);
        document.removeEventListener('touchend', endDrag);

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
    loadWorkspaces().then(() => {
        const workspaceManageModal = document.getElementById('workspaceManageModal');
        if (workspaceManageModal && workspaceManageModal.style.display !== 'none') {
            renderWorkspaceManagementList();
        }
    });
}

window.refreshWorkspaceManager = refreshWorkspaceManager;