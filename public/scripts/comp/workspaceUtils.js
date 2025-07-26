// workspaceUtils.js
// Workspace management utilities for StaticForge frontend

// Workspace state
let workspaces = [];
let activeWorkspace = 'default';
let currentWorkspaceOperation = null;
let activeWorkspaceColor = '#124'; // Default color
let activeWorkspaceBackgroundColor = null; // Can be null for auto-generation
let activeWorkspaceBackgroundImage = null; // Can be null for no background image
let activeWorkspaceBackgroundOpacity = 0.3; // Default opacity
let selectedBackgroundImage = null;

// Reference workspace move functions
async function moveCacheToDefaultWorkspace(cacheImage) {
    try {
        const response = await fetchWithAuth('/workspaces/default/references', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hashes: [cacheImage.hash] })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to move cache file');
        }

        showGlassToast('success', null, 'Reference moved to default workspace');
        await loadCacheImages();
        displayCacheImages();
        displayCacheImagesContainer();
    } catch (error) {
        console.error('Error moving cache file to default:', error);
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

    workspaces.forEach(workspace => {
        const item = document.createElement('div');
        item.className = 'workspace-move-item';
        item.innerHTML = `
            <div class="workspace-move-info">
                <span class="workspace-name">${workspace.name}</span>
                ${workspace.isActive ? '<span class="badge-active">Active</span>' : ''}
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
        const response = await fetchWithAuth(`/workspaces/${workspaceId}/references`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hashes: [cacheImage.hash] })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to move cache file');
        }

        const workspace = workspaces.find(w => w.id === workspaceId);
        showGlassToast('success', null, `Reference file moved to ${workspace ? workspace.name : 'workspace'}`);
        await loadCacheImages();
        displayCacheImages();
        displayCacheImagesContainer();
    } catch (error) {
        console.error('Error moving cache file to workspace:', error);
        showError('Failed to move cache file: ' + error.message);
    }
}

// Workspace API functions
async function loadWorkspaces() {
    try {
        const response = await fetchWithAuth('/workspaces', {
            method: 'OPTIONS'
        });
        if (!response.ok) throw new Error('Failed to load workspaces');

        const data = await response.json();
        workspaces = data.workspaces;
        activeWorkspace = data.activeWorkspace;

        // Update active workspace color
        const activeWorkspaceData = workspaces.find(w => w.id === activeWorkspace);
        if (activeWorkspaceData) {
            activeWorkspaceColor = activeWorkspaceData.color || '#124';
            updateBokehBackground();
        }

        renderWorkspaceDropdown();
        updateActiveWorkspaceDisplay();

        console.log('✅ Loaded workspaces:', workspaces.length);
    } catch (error) {
        console.error('Error loading workspaces:', error);
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
        const response = await fetchWithAuth('/workspaces/active/color');
        if (!response.ok) throw new Error('Failed to load workspace color');

        const data = await response.json();
        activeWorkspaceColor = data.color;
        activeWorkspaceBackgroundColor = data.backgroundColor;
        activeWorkspaceBackgroundImage = data.backgroundImage;
        activeWorkspaceBackgroundOpacity = data.backgroundOpacity || 0.3;
        updateBokehBackground();

        console.log('🎨 Loaded workspace settings:', {
            color: activeWorkspaceColor,
            backgroundColor: activeWorkspaceBackgroundColor,
            backgroundImage: activeWorkspaceBackgroundImage,
            backgroundOpacity: activeWorkspaceBackgroundOpacity
        });
    } catch (error) {
        console.error('Error loading workspace color:', error);
        // Use default values on error
        activeWorkspaceColor = '#124';
        activeWorkspaceBackgroundColor = null;
        activeWorkspaceBackgroundImage = null;
        activeWorkspaceBackgroundOpacity = 0.3;
        updateBokehBackground();
    }
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

    console.log('🎨 Updated bokeh background with fade:', {
        color: baseColor,
        backgroundColor: transparentColor,
        backgroundImage: activeWorkspaceBackgroundImage,
        opacity: activeWorkspaceBackgroundOpacity
    });
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

async function createWorkspace(name) {
    try {
        const response = await fetchWithAuth('/workspaces', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to create workspace');
        }

        await loadWorkspaces();
        await loadGallery(); // Refresh gallery to show new workspace filtering
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
        const response = await fetchWithAuth(`/workspaces/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: newName })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to rename workspace');
        }
    } catch (error) {
        console.error('Error renaming workspace:', error);
        showError('Failed to rename workspace: ' + error.message);
    }
}

async function deleteWorkspace(id) {
    try {
        const response = await fetchWithAuth(`/workspaces/${id}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to delete workspace');
        }

        await loadWorkspaces();
        await loadGallery(); // Refresh gallery to show updated filtering
        await loadCacheImages(); // Refresh cache browser to show updated filtering
        showGlassToast('success', null, 'Workspace deleted');
    } catch (error) {
        console.error('Error deleting workspace:', error);
        showError('Failed to delete workspace: ' + error.message);
    }
}

async function dumpWorkspace(sourceId, targetId) {
    try {
        const response = await fetchWithAuth(`/workspaces/${sourceId}/dump`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targetId })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to dump workspace');
        }

        await loadWorkspaces();
        await loadGallery(); // Refresh gallery
        await loadCacheImages(); // Refresh cache browser
        showGlassToast('success', null, 'Workspace Dumped');
    } catch (error) {
        console.error('Error dumping workspace:', error);
        showError('Failed to dump workspace: ' + error.message);
    }
}

async function setActiveWorkspace(id) {
    try {
        const response = await fetchWithAuth(`/workspaces/${id}/activate`, {
            method: 'PUT'
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to set active workspace');
        }

        // Fade out gallery
        if (gallery) {
            gallery.style.transition = 'opacity 0.3s ease-out';
            gallery.style.opacity = '0';
        }

        // Wait for fade out
        await new Promise(resolve => setTimeout(resolve, 300));

        activeWorkspace = id;

        // Update workspace settings immediately
        const workspace = workspaces.find(w => w.id === id);
        if (workspace) {
            activeWorkspaceColor = workspace.color || '#124';
            activeWorkspaceBackgroundColor = workspace.backgroundColor;
            activeWorkspaceBackgroundImage = workspace.backgroundImage;
            activeWorkspaceBackgroundOpacity = workspace.backgroundOpacity || 0.3;

            // Trigger workspace transition animation
            await animateWorkspaceTransition();
        }

        loadWorkspaces();
        updateActiveWorkspaceDisplay();
        await loadGallery(); // Refresh gallery with new workspace filter
        await loadCacheImages(); // Refresh cache browser with new workspace filter
        await loadVibeReferences(); // Refresh vibe references
        
        // Fade in gallery
        if (gallery) {
            gallery.style.transition = 'opacity 0.3s ease-in';
            gallery.style.opacity = '1';
        }
    } catch (error) {
        console.error('Error setting active workspace:', error);
        showError('Failed to set active workspace: ' + error.message);

        // Ensure gallery is visible even on error
        if (gallery) {
            gallery.style.opacity = 1;
        }
    }
}

async function moveFilesToWorkspace(filenames, targetWorkspaceId) {
    try {
        const response = await fetchWithAuth(`/workspaces/${targetWorkspaceId}/files`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filenames })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to move files');
        }

        const result = await response.json();
        await loadGallery(); // Refresh gallery
        showGlassToast('success', null, `Moved ${result.movedCount} files to workspace`);
    } catch (error) {
        console.error('Error moving files to workspace:', error);
        showError('Failed to move files: ' + error.message);
    }
}

// Update workspace color
async function updateWorkspaceColor(id, color) {
    try {
        const response = await fetchWithAuth(`/workspaces/${id}/color`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ color })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to update workspace color');
        }
    } catch (error) {
        console.error('Error updating workspace color:', error);
        showError('Failed to update workspace color: ' + error.message);
    }
}

// Update workspace background color
async function updateWorkspaceBackgroundColor(id, backgroundColor) {
    try {
        const response = await fetchWithAuth(`/workspaces/${id}/background-color`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ backgroundColor })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to update workspace background color');
        }
    } catch (error) {
        console.error('Error updating workspace background color:', error);
        showError('Failed to update workspace background color: ' + error.message);
    }
}

// Update workspace background image
async function updateWorkspaceBackgroundImage(id, backgroundImage) {
    try {
        const response = await fetchWithAuth(`/workspaces/${id}/background-image`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ backgroundImage })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to update workspace background image');
        }
    } catch (error) {
        console.error('Error updating workspace background image:', error);
        showError('Failed to update workspace background image: ' + error.message);
    }
}

// Update workspace background opacity
async function updateWorkspaceBackgroundOpacity(id, backgroundOpacity) {
    try {
        const response = await fetchWithAuth(`/workspaces/${id}/background-opacity`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ backgroundOpacity })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to update workspace background opacity');
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

    workspaces.forEach(workspace => {
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

    const activeWorkspaceData = workspaces.find(w => w.id === activeWorkspace);
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
    const workspaceTabs = document.getElementById('workspaceTabs');
    if (!workspaceTabs) return;

    workspaceTabs.innerHTML = '';

    workspaces.forEach(workspace => {
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
                setActiveWorkspace(workspace.id);
            }
        };

        tab.addEventListener('click', action);
        workspaceTabs.appendChild(tab);
    });
}

function renderWorkspaceManagementList() {
    const list = document.getElementById('workspaceManageList');
    if (!list) return;

    list.innerHTML = '';

    workspaces.forEach(workspace => {
        const item = document.createElement('div');
        item.className = 'workspace-manage-item';

        item.innerHTML = `
            <div class="workspace-manage-info">
                <div class="workspace-header">
                    <div class="workspace-color-indicator" style="background-color: ${workspace.color || '#124'}"></div>
                    <h5>${workspace.name} ${workspace.isActive ? '<span class="badge-active">Active</span>' : ''}</h5>
                </div>
                <span class="workspace-manage-counts">${workspace.fileCount} files, ${workspace.cacheFileCount} references</span>
            </div>
            <div class="workspace-manage-actions">
                <button type="button" class="btn-secondary" onclick="editWorkspaceSettings('${workspace.id}')" title="Workspace Settings">
                    <i class="fas fa-cog"></i>
                </button>
                ${!workspace.isDefault ? `
                    <button type="button" class="btn-secondary" onclick="showDumpWorkspaceModal('${workspace.id}', '${workspace.name}')" title="Dump">
                        <i class="fas fa-arrow-right"></i>
                    </button>
                    <button type="button" class="btn-secondary text-danger" onclick="confirmDeleteWorkspace('${workspace.id}', '${workspace.name}')" title="Delete">
                        <i class="fas fa-trash"></i>
                    </button>
                ` : ''}
            </div>
        `;

        list.appendChild(item);
    });
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
    const workspace = workspaces.find(w => w.id === id);
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

    workspaces.forEach(workspace => {
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

function confirmDeleteWorkspace(id, name) {
    if (confirm(`Are you sure you want to delete the workspace "${name}"?\n\nAll items will be moved to the default workspace.`)) {
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
                const newWorkspace = workspaces.find(w => w.name === name);
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
        // Get workspace files from backend
        const workspaceResponse = await fetchWithAuth(`/workspaces/${workspaceId}/files`);
        if (!workspaceResponse.ok) throw new Error('Failed to load workspace files');

        const workspaceData = await workspaceResponse.json();
        const workspaceFiles = new Set(workspaceData.files || []);

        // Get all images from the filesystem (not filtered by active workspace)
        const allImagesResponse = await fetchWithAuth('/images/all');
        if (!allImagesResponse.ok) throw new Error('Failed to load all images');

        const allImagesItems = await allImagesResponse.json();

        // Filter images to only include workspace files
        const filteredImages = allImagesItems.filter(img => {
            const file = img.upscaled || img.original;
            return workspaceFiles.has(file);
        });

        return filteredImages;
    } catch (error) {
        console.error('Error getting workspace images:', error);
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

document.addEventListener('DOMContentLoaded', async function() {
    try {
    // Initialize background layers
    initializeBokehBackgrounds();

    // Initialize workspace system
    initializeWorkspaceSystem();

    // Initialize workspace settings form event listeners
    initializeWorkspaceSettingsForm();

    } catch (error) {
        console.error('Error initializing workspace system:', error);
    }
});