// keyboardShortcuts.js
// Keyboard shortcuts for the manual modal

let altKeyPressed = false;
let shortcutsOverlay = null;
let suppressAltOverlayUntilRelease = false;
const activeAltKeyCodes = new Set();

// Window switcher state
let windowSwitcherActive = false;
let windowSwitcherOverlay = null;
let windowSwitcherWindows = [];
let windowSwitcherSelectedIndex = 0;
let ctrlKeyPressed = false;

let runAppletLastAltUpTime = 0;
const RUN_APPLET_DOUBLE_ALT_MS = 400;

let shortcutActionToastHost = null;
let shortcutActionToastHideTimer = null;
let shortcutActionToastFadeTimer = null;

function resolutionShortcutLabel(value) {
    if (!value || value === 'custom') return null;
    const r = typeof RESOLUTION_CACHE !== 'undefined' && RESOLUTION_CACHE.get(value);
    return r ? r.display : value;
}

function showShortcutActionToast(message, options = {}) {
    if (!message) return;
    const centerOn = options.centerOn || null;
    const icon = options.icon || null;
    const durationMs = Number.isFinite(options.durationMs) ? Math.max(300, Math.floor(options.durationMs)) : 1500;
    if (!shortcutActionToastHost) {
        shortcutActionToastHost = document.createElement('div');
        shortcutActionToastHost.className = 'shortcut-action-toast-host';
        shortcutActionToastHost.setAttribute('aria-live', 'polite');
        const inner = document.createElement('div');
        inner.className = 'shortcut-action-toast';
        shortcutActionToastHost.appendChild(inner);
        document.body.appendChild(shortcutActionToastHost);
    }
    const toastEl = shortcutActionToastHost.querySelector('.shortcut-action-toast');
    toastEl.classList.remove('flash-border');
    toastEl.innerHTML = '';

    const iconWrap = document.createElement('div');
    iconWrap.className = 'shortcut-action-toast-icon';
    if (icon) {
        if (typeof icon === 'string' && icon.trim().startsWith('<')) {
            iconWrap.innerHTML = icon;
        } else if (typeof icon === 'string' && icon.trim().length > 0) {
            const img = document.createElement('img');
            img.src = icon;
            img.alt = '';
            img.loading = 'lazy';
            iconWrap.appendChild(img);
        }
    }

    const textWrap = document.createElement('div');
    textWrap.className = 'shortcut-action-toast-text';
    const lines = String(message).split('\n').filter((line) => line.length > 0);
    (lines.length ? lines : ['']).forEach((line) => {
        const lineEl = document.createElement('div');
        lineEl.className = 'shortcut-action-toast-line';
        const span = document.createElement('span');
        span.textContent = line;
        lineEl.appendChild(span);
        textWrap.appendChild(lineEl);
    });

    toastEl.appendChild(iconWrap);
    toastEl.appendChild(textWrap);
    const hasIcon = iconWrap.children.length > 0;
    toastEl.classList.toggle('no-icon', !hasIcon);

    // Default centered in viewport unless a target element is provided.
    shortcutActionToastHost.style.inset = '';
    shortcutActionToastHost.style.left = '';
    shortcutActionToastHost.style.top = '';
    shortcutActionToastHost.style.width = '';
    shortcutActionToastHost.style.height = '';
    shortcutActionToastHost.style.transform = '';

    if (centerOn && centerOn.getBoundingClientRect) {
        const rect = centerOn.getBoundingClientRect();
        shortcutActionToastHost.style.inset = 'auto';
        shortcutActionToastHost.style.left = `${Math.round(rect.left)}px`;
        shortcutActionToastHost.style.top = `${Math.round(rect.top)}px`;
        shortcutActionToastHost.style.width = `${Math.max(0, Math.round(rect.width))}px`;
        shortcutActionToastHost.style.height = `${Math.max(0, Math.round(rect.height))}px`;
        shortcutActionToastHost.style.transform = 'none';
    }

    shortcutActionToastHost.classList.remove('fade-out');
    shortcutActionToastHost.classList.add('visible');
    requestAnimationFrame(() => {
        toastEl.classList.add('flash-border');
    });
    clearTimeout(shortcutActionToastHideTimer);
    clearTimeout(shortcutActionToastFadeTimer);
    shortcutActionToastFadeTimer = setTimeout(() => {
        shortcutActionToastHost.classList.add('fade-out');
    }, Math.max(200, durationMs - 250));
    shortcutActionToastHideTimer = setTimeout(() => {
        shortcutActionToastHost.classList.remove('fade-out');
        shortcutActionToastHost.classList.remove('visible');
    }, durationMs);
}

window.showShortcutActionToast = showShortcutActionToast;

/** Portrait → Square → Landscape within the current size tier (normal / large / xlarge / small / wallpaper). */
const RESOLUTION_ASPECT_CYCLE = ['portrait', 'square', 'landscape'];

/** Normal → Large → Maximum (same aspect); only for standard `normal_` / `large_` / `xlarge_` presets. */
const RESOLUTION_SIZE_TIER_CYCLE = [
    { prefix: 'normal', group: 'Normal' },
    { prefix: 'large', group: 'Large' },
    { prefix: 'xlarge', group: 'Maximum' }
];

/** @returns {string|null} Display label for the new resolution, or null if unchanged */
function cycleManualResolutionAspectPreset() {
    const resVal = manualResolutionHidden && manualResolutionHidden.value;
    if (!resVal || resVal === 'custom') return null;
    const tierMatch = resVal.match(/^(normal|large|xlarge|small|wallpaper)_(.+)$/);
    if (!tierMatch) return null;
    const prefix = tierMatch[1];
    const currentAspect = tierMatch[2];
    const startIdx = RESOLUTION_ASPECT_CYCLE.indexOf(currentAspect);
    if (startIdx === -1) {
        const groupEntry = typeof RESOLUTION_GROUPS !== 'undefined' && RESOLUTION_GROUPS.find(g =>
            g.group !== 'Custom' && g.options.some(o => o.value === resVal));
        if (!groupEntry || groupEntry.options.length < 2) return null;
        const idx = groupEntry.options.findIndex(o => o.value === resVal);
        if (idx === -1) return null;
        const next = groupEntry.options[(idx + 1) % groupEntry.options.length];
        selectManualResolution(next.value, groupEntry.group);
        return resolutionShortcutLabel(next.value);
    }
    for (let step = 1; step <= 3; step++) {
        const nextAspect = RESOLUTION_ASPECT_CYCLE[(startIdx + step) % 3];
        const candidate = `${prefix}_${nextAspect}`;
        if (typeof RESOLUTION_CACHE !== 'undefined' && RESOLUTION_CACHE.has(candidate)) {
            const groupObj = typeof RESOLUTION_GROUPS !== 'undefined' && RESOLUTION_GROUPS.find(g =>
                g.options.some(o => o.value === candidate));
            if (groupObj) {
                selectManualResolution(candidate, groupObj.group);
                return resolutionShortcutLabel(candidate);
            }
            return null;
        }
    }
    return null;
}

/** @returns {string|null} Display label for the new resolution, or null if unchanged */
function cycleManualResolutionSizeTier() {
    const resVal = manualResolutionHidden && manualResolutionHidden.value;
    if (!resVal) return null;

    const isCustom = resVal === 'custom' || resVal.startsWith('custom');
    if (isCustom) {
        let w = parseInt(manualWidth && manualWidth.value, 10) || 0;
        let h = parseInt(manualHeight && manualHeight.value, 10) || 0;
        if ((w <= 0 || h <= 0) && typeof getDimensionsFromResolution === 'function') {
            const d = getDimensionsFromResolution(resVal);
            if (d) {
                w = d.width;
                h = d.height;
            }
        }
        if (w <= 0 || h <= 0) return null;

        let aspect;
        if (w === h) aspect = 'square';
        else if (w > h) aspect = 'landscape';
        else aspect = 'portrait';

        const presets = RESOLUTION_SIZE_TIER_CYCLE.map(t => {
            const value = `${t.prefix}_${aspect}`;
            const resMeta = typeof RESOLUTION_CACHE !== 'undefined' ? RESOLUTION_CACHE.get(value) : null;
            return resMeta ? { ...t, value, resMeta } : null;
        }).filter(Boolean);
        if (presets.length === 0) return null;

        const area = w * h;
        let bestIdx = 0;
        let bestDist = Infinity;
        presets.forEach((p, i) => {
            const presetArea = p.resMeta.width * p.resMeta.height;
            const dist = Math.abs(presetArea - area);
            if (dist < bestDist) {
                bestDist = dist;
                bestIdx = i;
            }
        });
        const nextIdx = (bestIdx + 1) % presets.length;
        const next = presets[nextIdx];
        selectManualResolution(next.value, next.group);
        return resolutionShortcutLabel(next.value);
    }

    const m = resVal.match(/^(normal|large|xlarge)_(portrait|square|landscape)$/);
    if (!m) return null;
    const prefix = m[1];
    const aspect = m[2];
    const tierIdx = RESOLUTION_SIZE_TIER_CYCLE.findIndex(t => t.prefix === prefix);
    if (tierIdx === -1) return null;
    const nextTier = RESOLUTION_SIZE_TIER_CYCLE[(tierIdx + 1) % RESOLUTION_SIZE_TIER_CYCLE.length];
    const candidate = `${nextTier.prefix}_${aspect}`;
    if (typeof RESOLUTION_CACHE !== 'undefined' && RESOLUTION_CACHE.has(candidate)) {
        selectManualResolution(candidate, nextTier.group);
        return resolutionShortcutLabel(candidate);
    }
    return null;
}

// Initialize keyboard shortcuts
function initializeManualModalShortcuts() {
    createShortcutsOverlay();
    createWindowSwitcherOverlay();
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleShortcutWindowBlur);
    document.addEventListener('visibilitychange', handleShortcutVisibilityChange);
}

// Create the shortcuts overlay
function createShortcutsOverlay() {
    shortcutsOverlay = document.createElement('div');
    shortcutsOverlay.id = 'shortcutsOverlay';
    shortcutsOverlay.className = 'shortcuts-overlay';
    shortcutsOverlay.innerHTML = `
        <div class="shortcuts-content">
            <div class="shortcuts-title">Keyboard Shortcuts</div>
            <div class="shortcuts-grids">
                <div class="shortcuts-grid left">
                    <div class="shortcut-item">
                        <span class="shortcut-key">ALT + A</span>
                        <span class="shortcut-desc"><span>Add Character</span><i class="fa fa-user-plus"></i></span>
                    </div>
                    <div class="shortcut-item">
                        <span class="shortcut-key">CTRL + F</span>
                        <span class="shortcut-desc"><span>Inline Search</span><i class="fa fa-search"></i></span>
                    </div>
                    <div class="shortcut-item">
                        <span class="shortcut-key">CTRL + I</span>
                        <span class="shortcut-desc"><span>Toggle Autofill</span><i class="fa fa-lightbulb"></i></span>
                    </div>
                    <div class="shortcut-item">
                        <span class="shortcut-key">ALT + P</span>
                        <span class="shortcut-desc"><span>Allow Paid</span><i class="fa fa-dollar-sign"></i></span>
                    </div>
                    <div class="shortcut-item">
                        <span class="shortcut-key">Alt + F</span>
                        <span class="shortcut-desc"><span>Favorite Tag</span><i class="fa fa-star"></i></span>
                    </div>
                    <div class="shortcut-item">
                        <span class="shortcut-key">Alt + D</span>
                        <span class="shortcut-desc"><span>Disable Syntax</span><i class="fa fa-ban"></i></span>
                    </div>
                    <div class="shortcut-item">
                        <span class="shortcut-key">Alt + Esc</span>
                        <span class="shortcut-desc"><span>Close Editor</span><i class="fa fa-times"></i></span>
                    </div>
                    <div class="divider"></div>
                    <div class="shortcut-item">
                        <span class="shortcut-key">Alt + ,</span>
                        <span class="shortcut-desc"><span>Previous Image</span><i class="fa fa-arrow-left"></i></span>
                    </div>
                    <div class="shortcut-item">
                        <span class="shortcut-key">Alt + .</span>
                        <span class="shortcut-desc"><span>Next Image</span><i class="fa fa-arrow-right"></i></span>
                    </div>
                </div>
                <div class="shortcuts-grid right">
                    <div class="shortcut-item">
                        <span class="shortcut-key">F1</span>
                        <span class="shortcut-desc"><span>Prompts</span><i class="fas fa-compass-drafting"></i></span>
                    </div>
                    <div class="shortcut-item">
                        <span class="shortcut-key">F2</span>
                        <span class="shortcut-desc"><span>UC</span><i class="fa fa-ban"></i></span>
                    </div>
                    <div class="shortcut-item alt">
                        <span class="shortcut-key">ALT + F1</span>
                        <span class="shortcut-desc"><span>Prompts/UC</span><i class="nai-detatch-up"></i></span>
                    </div>
                    <div class="shortcut-item">
                        <span class="shortcut-key">F3</span>
                        <span class="shortcut-desc"><span>Emphasis</span><i class="fa fa-scale-unbalanced-flip"></i></span>
                    </div>
                    <div class="shortcut-item alt">
                        <span class="shortcut-key">ALT + F3</span>
                        <span class="shortcut-desc"><span>Reset Emphasis</span><i class="fa fa-eraser"></i></span>
                    </div>
                    <div class="shortcut-item alt">
                        <span class="shortcut-key">ALT + S</span>
                        <span class="shortcut-desc"><span>Split Emphasis</span><i class="fa fa-scissors"></i></span>
                    </div>
                    <div class="shortcut-item">
                        <span class="shortcut-key">F4</span>
                        <span class="shortcut-desc"><span>Quick Access</span><i class="fa fa-book-font"></i></span>
                    </div>
                    <div class="divider"></div>
                    <div class="shortcut-item">
                        <span class="shortcut-key">F5</span>
                        <span class="shortcut-desc"><span>Generate</span><i class="fa fa-sparkles"></i></span>
                    </div>
                    <div class="shortcut-item alt">
                        <span class="shortcut-key">ALT + F5</span>
                        <span class="shortcut-desc"><span>Staged Generation</span><i class="fas fa-arrow-down-square-triangle"></i></span>
                    </div>
                    <div class="shortcut-item">
                        <span class="shortcut-key">F6</span>
                        <span class="shortcut-desc"><span>References</span><i class="nai-img2img"></i></span>
                    </div>
                    <div class="shortcut-item">
                        <span class="shortcut-key">F7</span>
                        <span class="shortcut-desc"><span>Reset to Normal</span><i class="nai-dot-reset"></i></span>
                    </div>
                    <div class="shortcut-item alt">
                        <span class="shortcut-key">ALT + F7</span>
                        <span class="shortcut-desc"><span>Maximum Quality</span><i class="fa fa-bolt"></i></span>
                    </div>
                    <div class="shortcut-item">
                        <span class="shortcut-key">F8</span>
                        <span class="shortcut-desc"><span>Lock Seed</span><i class="fas fa-dice"></i></span>
                    </div>
                    <div class="shortcut-item alt">
                        <span class="shortcut-key">ALT + F8</span>
                        <span class="shortcut-desc"><span>Toggle/Replace Compare Source</span><i class="fas fa-eye-dropper"></i></span>
                    </div>
                    <div class="divider"></div>
                    <div class="shortcut-item">
                        <span class="shortcut-key">F9</span>
                        <span class="shortcut-desc"><span>Cycle Ratio</span><i class="fa fa-arrows-alt"></i></span>
                    </div>
                    <div class="shortcut-item alt">
                        <span class="shortcut-key">ALT + F9</span>
                        <span class="shortcut-desc"><span>Cycle Res. Group</span><i class="fa fa-layer-group"></i></span>
                    </div>
                    <div class="shortcut-item">
                        <span class="shortcut-key">F10</span>
                        <span class="shortcut-desc"><span>Comparison</span><i class="fas fa-columns-3"></i></span>
                    </div>
                    <div class="shortcut-item alt">
                        <span class="shortcut-key">ALT + F10</span>
                        <span class="shortcut-desc"><span>Cycle Compare View</span><i class="fas fa-columns-3"></i></span>
                    </div>
                    <div class="shortcut-item alt">
                        <span class="shortcut-key">ALT + L/SHFT</span>
                        <span class="shortcut-desc"><span>Peek Source</span><i class="fas fa-eye-dropper"></i></span>
                    </div>
                    <div class="shortcut-item alt">
                        <span class="shortcut-key">ALT + R/SHFT</span>
                        <span class="shortcut-desc"><span>Peek Result</span><i class="fas fa-eye-dropper"></i></span>
                    </div>
                    <div class="shortcut-item">
                        <span class="shortcut-key">F11</span>
                        <span class="shortcut-desc"></span>
                    </div>
                    <div class="shortcut-item">
                        <span class="shortcut-key">F12</span>
                        <span class="shortcut-desc"></span>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(shortcutsOverlay);
}

// Create the window switcher overlay
function createWindowSwitcherOverlay() {
    windowSwitcherOverlay = document.createElement('div');
    windowSwitcherOverlay.id = 'windowSwitcherOverlay';
    windowSwitcherOverlay.className = 'window-switcher-overlay';
    windowSwitcherOverlay.innerHTML = `
        <div class="window-switcher-content">
            <div class="window-switcher-title"></div>
            <div class="window-switcher-icons"></div>
        </div>
    `;
    document.body.appendChild(windowSwitcherOverlay);
}

// Handle key down events
function handleKeyDown(event) {
    // Handle CTRL+TAB for window switcher (only in desktop mode)
    if (window.isDesktop && event.ctrlKey && event.key === 'Tab' && !event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        
        if (!windowSwitcherActive) {
            startWindowSwitcher();
            // Force navigation to next window to ensure it's selected
            if (windowSwitcherWindows.length > 1) {
                navigateWindowSwitcher(1);
            }
        } else {
            // Navigate to next window
            navigateWindowSwitcher(1);
        }
        ctrlKeyPressed = true;
        return;
    }
    
    // Handle CTRL+SHIFT+TAB for reverse navigation (only in desktop mode)
    if (window.isDesktop && event.ctrlKey && event.key === 'Tab' && event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        
        if (!windowSwitcherActive) {
            startWindowSwitcher();
        } else {
            // Navigate to previous window
            navigateWindowSwitcher(-1);
        }
        ctrlKeyPressed = true;
        return;
    }
    
    // Check if manualModal is open
    const isManualModalOpen = !manualModal.classList.contains('hidden') && !manualModal.classList.contains('minimised') &&
    !manualModal.classList.contains('minimising');
    
    // If manualModal is open, check if it should handle keyboard actions
    let shouldHandleManualModalActions = false;
    if (isManualModalOpen) {
        if (window.isDesktop) {
            // In desktop mode, only handle if manualModal is the active main window
            shouldHandleManualModalActions = manualModal.classList.contains('active-window');
        } else {
            // Not in desktop mode, handle if modal is open
            shouldHandleManualModalActions = true;
        }
    }

    const expansionCompiledPromptDialog = document.getElementById('expansionCompiledPromptDialog');
    const isExpansionPromptEditorOpen = expansionCompiledPromptDialog &&
        !expansionCompiledPromptDialog.classList.contains('hidden') &&
        !expansionCompiledPromptDialog.classList.contains('minimised') &&
        !expansionCompiledPromptDialog.classList.contains('minimising');
    let shouldHandleExpansionPromptEditorShortcuts = false;
    if (isExpansionPromptEditorOpen) {
        if (window.isDesktop) {
            shouldHandleExpansionPromptEditorShortcuts = expansionCompiledPromptDialog.classList.contains('active-window');
        } else {
            shouldHandleExpansionPromptEditorShortcuts = true;
        }
    }

    // bracketGenIsAppletActive: public/scripts/comp/bracketGenerationApplet.js
    const shouldHandleBracketGenShortcuts = typeof bracketGenIsAppletActive === 'function' && bracketGenIsAppletActive();
    
    if (windowSwitcherActive) return;

    // Handle Alt key press
    if (event.key === 'Alt' && shouldHandleManualModalActions) {
        event.preventDefault();
        event.stopPropagation();
        activeAltKeyCodes.add(event.code || 'AltLeft');
        showShortcutsOverlay();
        altKeyPressed = true;
        return;
    }

    // Hide overlay after the second key in an Alt combo is pressed,
    // and keep it hidden until all Alt keys are released.
    if (altKeyPressed && event.key !== 'Alt') {
        suppressAltOverlayUntilRelease = true;
        hideShortcutsOverlay();
    }
    
    if (altKeyPressed && !event.altKey) {
        altKeyPressed = false;
        hideShortcutsOverlay();
    }
    
    switch (`${event.ctrlKey ? 'CTRL+' : ''}${event.altKey ? 'ALT+' : ''}${event.metaKey ? 'META+' : ''}${event.shiftKey ? 'SHIFT+' : ''}${event.key.toUpperCase()}`) {
        case 'F1':
            if (shouldHandleBracketGenShortcuts && bracketGenerationApplet) {
                event.preventDefault();
                event.stopPropagation();
                bracketGenerationApplet.setActiveField('prompt');
                break;
            }
            if (shouldHandleExpansionPromptEditorShortcuts) {
                event.preventDefault();
                event.stopPropagation();
                // switchExpansionCompiledPromptTab: public/scripts/comp/imageExpansion.js
                switchExpansionCompiledPromptTab('prompt', true);
                break;
            }
            if (!shouldHandleManualModalActions) break;
            event.preventDefault();
            event.stopPropagation();
            switchManualTab('prompt', document.activeElement);
            break;
        case 'F2':
            if (shouldHandleBracketGenShortcuts && bracketGenerationApplet) {
                event.preventDefault();
                event.stopPropagation();
                bracketGenerationApplet.setActiveField('uc');
                break;
            }
            if (shouldHandleExpansionPromptEditorShortcuts) {
                event.preventDefault();
                event.stopPropagation();
                // switchExpansionCompiledPromptTab: public/scripts/comp/imageExpansion.js
                switchExpansionCompiledPromptTab('uc', true);
                break;
            }
            if (!shouldHandleManualModalActions) break;
            event.preventDefault();
            event.stopPropagation();
            switchManualTab('uc', document.activeElement);
            break;
        case 'ALT+F1':
            if (!shouldHandleManualModalActions) break;
            event.preventDefault();
            event.stopPropagation();
            toggleManualShowBoth();
            break;
        case 'F3':
            // Trigger emphasis mode in the active prompt toolbar
            const activeTextarea = document.activeElement;
            if (activeTextarea && (activeTextarea.matches('.prompt-textarea, .character-prompt-textarea'))) {
                const toolbar = activeTextarea.closest('.prompt-textarea-container, .character-prompt-textarea-container')?.querySelector('.prompt-textarea-toolbar');
                if (toolbar && window.promptTextareaToolbar) {
                    event.preventDefault();
                    event.stopPropagation();
                    window.promptTextareaToolbar.openEmphasisMode(activeTextarea, toolbar);
                }
            }
            break;
        case 'ALT+F3':
            // Remove all emphasis from selected text
            const activeElement = document.activeElement;
            if (activeElement && (activeElement.tagName === 'TEXTAREA' || activeElement.tagName === 'INPUT')) {
                event.preventDefault();
                event.stopPropagation();
                removeAllEmphasisFromSelection(activeElement);
                showShortcutActionToast('Reset Emphasis');
            }
            break;
        case 'F4':
            if (!shouldHandleManualModalActions) break;
            event.preventDefault();
            event.stopPropagation();
            showDatasetTagToolbar();
            showShortcutActionToast('Quick access');
            break;
        case 'F5':
            if (!shouldHandleManualModalActions) break;
            event.preventDefault();
            event.stopPropagation();
            // Check if manual modal is open
            const manualGenerateBtn = document.getElementById('manualGenerateBtn');
            if (manualGenerateBtn && !manualGenerateBtn.disabled) {
                manualGenerateBtn.click();
                showShortcutActionToast('Started Generation');
            }
            break;
        case 'ALT+F5':
            if (!shouldHandleManualModalActions) break;
            event.preventDefault();
            event.stopPropagation();
            const stageGenBtn = document.getElementById('enableStageGenerationBtn');
            if (!stageGenBtn || stageGenBtn.classList.contains('hidden')) break;
            const newState = stageGenBtn.dataset.state === 'on' ? 'off' : 'on';
            stageGenBtn.dataset.state = newState;
            const windowStageGenBtn = document.getElementById('windowEnableStageGenerationBtn');
            if (windowStageGenBtn) windowStageGenBtn.dataset.state = newState;
            if (typeof updateSaveStage0BtnVisibility === 'function') updateSaveStage0BtnVisibility();
            showShortcutActionToast(newState === 'on' ? 'Stage generation: On' : 'Stage generation: Off');
            break;
        case 'F6':
            if (!shouldHandleManualModalActions) break;
            event.preventDefault();
            event.stopPropagation();
            showCacheBrowser();
            showShortcutActionToast('References');
            break;
        case 'F7':
            if (!shouldHandleManualModalActions) break;
            event.preventDefault();
            event.stopPropagation();
            // Reset steps if over 28
            const stepsVal = parseInt(manualSteps.value);
            if (stepsVal > 28) {
                manualSteps.value = 28;
                manualSteps.dispatchEvent(new Event('input', { bubbles: true }));
            }
            
            // Reset resolution to normal if large or wallpaper
            const resVal = manualResolutionHidden ? manualResolutionHidden.value : '';
            if (resVal && (resVal.startsWith('large_') || resVal.startsWith('xlarge_') || resVal.startsWith('wallpaper_'))) {
                const parts = resVal.split('_');
                if (parts.length >= 2) {
                    const aspect = parts[1];
                    const newRes = 'normal_' + aspect;
                    // Check if normal version exists
                    if (typeof RESOLUTIONS !== 'undefined' && RESOLUTIONS.find(r => r.value === newRes)) {
                        if (typeof selectManualResolution === 'function') {
                            selectManualResolution(newRes, 'Normal');
                        }
                    }
                }
            }
            forcePaidRequest = false;
            paidRequestToggle.setAttribute('data-state', 'off');
            manualUpscale.setAttribute('data-state', 'off');
            showShortcutActionToast('Reset to Free Limits');
            break;
        case 'ALT+F7':
            if (!shouldHandleManualModalActions) break;
            event.preventDefault();
            event.stopPropagation();
            // Set Max Steps
            manualSteps.value = 50;
            manualSteps.dispatchEvent(new Event('input', { bubbles: true }));
            
            // Set Max Resolution
            const inputResVal = manualResolutionHidden ? manualResolutionHidden.value : '';
            if (inputResVal && !(inputResVal.startsWith('large_') || inputResVal.startsWith('xlarge_') || inputResVal.startsWith('wallpaper_'))) {
                const parts = inputResVal.split('_');
                if (parts.length >= 2) {
                    const aspect = parts[1];
                    const newRes = 'large_' + aspect;
                    // Check if normal version exists
                    if (typeof RESOLUTIONS !== 'undefined' && RESOLUTIONS.find(r => r.value === newRes)) {
                        if (typeof selectManualResolution === 'function') {
                            selectManualResolution(newRes, 'Large');
                        }
                    }
                }
            }
            forcePaidRequest = true;
            paidRequestToggle.setAttribute('data-state', 'on');
            if (windowPaidToggle) windowPaidToggle.setAttribute('data-state', 'on');
            manualUpscale.setAttribute('data-state', 'off');
            showShortcutActionToast('Switched to Maximum Quality');
            break;
        case 'ALT+F8':
            if (!shouldHandleManualModalActions) break;
            event.preventDefault();
            event.stopPropagation();
            // compareSourceAltF8Hotkey: public/scripts/app.js
            const r = compareSourceAltF8Hotkey();
            if (r === 'set') {
                showShortcutActionToast('Compare: source set');
            } else if (r === 'replaced') {
                showShortcutActionToast('Compare: source replaced');
            } else if (r === 'cleared') {
                showShortcutActionToast('Compare: cleared');
            } else {
                showShortcutActionToast('Compare: no change');
            }
            break;
        case 'F8':
            if (shouldHandleBracketGenShortcuts && bracketGenerationApplet) {
                event.preventDefault();
                event.stopPropagation();
                bracketGenerationApplet.compileStages();
                showShortcutActionToast('Compiled Stages');
                break;
            }
            if (!shouldHandleManualModalActions) break;
            event.preventDefault();
            event.stopPropagation();
            if (window.lastLoadedSeed) {
                void (async () => {
                    await toggleSproutSeed();
                    updateSproutSeedButton();
                    const sproutBtn = document.getElementById('sproutSeedBtn');
                    showShortcutActionToast(sproutBtn && sproutBtn.getAttribute('data-state') === 'on'
                        ? 'Seed Locked'
                        : 'Randomize Seed');
                })();
            }
            break;
        case 'F9':
            if (!shouldHandleManualModalActions) break;
            event.preventDefault();
            event.stopPropagation();
            {
                const label = cycleManualResolutionAspectPreset();
                if (label) showShortcutActionToast(label);
            }
            break;
        case 'ALT+F10':
            if (!shouldHandleManualModalActions) break;
            event.preventDefault();
            event.stopPropagation();
            // compareAltF10CycleHotkey: public/scripts/app.js
            compareAltF10CycleHotkey(true);
            break;
        case 'F10':
            if (!shouldHandleManualModalActions) break;
            event.preventDefault();
            event.stopPropagation();
            // compareSourcePrimaryClick: public/scripts/app.js
            compareSourcePrimaryClick(true);
            break;
        case 'ALT+F9':
            if (!shouldHandleManualModalActions) break;
            event.preventDefault();
            event.stopPropagation();
            const label = cycleManualResolutionSizeTier();
            if (label) showShortcutActionToast(label);
            break;
        case 'ALT+A':
            if (shouldHandleBracketGenShortcuts && bracketGenerationApplet) {
                event.preventDefault();
                event.stopPropagation();
                void bracketGenerationApplet.addStep();
                showShortcutActionToast('New Stage');
                break;
            }
            if (!shouldHandleManualModalActions) break;
            event.preventDefault();
            event.stopPropagation();
            addCharacterPrompt();
            showShortcutActionToast('New Character');
            break;
        case 'ALT+K':
            if (shouldHandleBracketGenShortcuts && bracketGenerationApplet) {
                event.preventDefault();
                event.stopPropagation();
                void bracketGenerationApplet.promptAddKeyword();
                break;
            }
            break;
        case 'CTRL+F':
            // Trigger inline search in the active prompt toolbar
            const searchTextarea = document.activeElement;
            if (searchTextarea && (searchTextarea.matches('.prompt-textarea, .character-prompt-textarea'))) {
                const searchToolbar = searchTextarea.closest('.prompt-textarea-container, .character-prompt-textarea-container')?.querySelector('.prompt-textarea-toolbar');
                if (searchToolbar && window.promptTextareaToolbar) {
                    event.preventDefault();
                    event.stopPropagation();
                    // Check if already in search mode
                    if (searchToolbar.classList.contains('search-mode')) {
                        return;
                    }
                    window.promptTextareaToolbar.openSearch(searchTextarea);
                }
            }
            break;
        case 'ALT+,':
        case 'ALT+≤':
            if (!shouldHandleManualModalActions) break;
            event.preventDefault();
            event.stopPropagation();
            navigateManualPreview({ currentTarget: { id: 'manualPreviewPrevBtn' } });
            break;
        case 'ALT+.':
        case 'ALT+≥':
            if (!shouldHandleManualModalActions) break;
            event.preventDefault();
            event.stopPropagation();
            navigateManualPreview({ currentTarget: { id: 'manualPreviewNextBtn' } });
            break;
        case 'CTRL+I':
            // Toggle autofill
            if (window.toggleAutofill) {
                event.preventDefault();
                event.stopPropagation();
                const newState = window.toggleAutofill();
                // Update all autofill toggle buttons
                const allToolbars = document.querySelectorAll('.prompt-textarea-toolbar');
                allToolbars.forEach((toolbarElement, index) => {
                    const autofillBtn = toolbarElement.querySelector('[data-action="autofill"]');
                    if (autofillBtn) {
                        const isEnabled = window.isAutofillEnabled ? window.isAutofillEnabled() : true;
                        autofillBtn.setAttribute('data-state', isEnabled ? 'on' : 'off');
                        const icon = autofillBtn.querySelector('i');
                        if (icon) {
                            icon.className = isEnabled ? 'fas fa-lightbulb' : 'fas fa-lightbulb-slash';
                        }
                    }
                });
                showShortcutActionToast(newState ? 'Autofill On' : 'Autofill Off');
            }
            break;
        case 'ALT+F':
            // Add selected text as favorite (tag or text replacement)
            if (document.activeElement && (document.activeElement.type === 'textarea' ||
                document.activeElement.classList.contains('prompt-textarea') ||
                document.activeElement.classList.contains('character-prompt-textarea'))) {
                const selectedText = getSelectedTextFromTextarea(document.activeElement);
                if (selectedText && selectedText.trim()) {
                    event.preventDefault();
                    event.stopPropagation();
                    if (window.showAddToFavoritesDialog) {
                        window.showAddToFavoritesDialog(selectedText.trim());
                        showShortcutActionToast('Add to Favorites');
                    }
                }
            }
            break;
        case 'ALT+P':
            if (!shouldHandleManualModalActions) break;
            event.preventDefault();
            event.stopPropagation();
            paidRequestToggle.setAttribute('data-state', !forcePaidRequest ? 'on' : 'off');
            forcePaidRequest = !forcePaidRequest;
            if (windowPaidToggle) windowPaidToggle.setAttribute('data-state', forcePaidRequest ? 'on' : 'off');
            showShortcutActionToast(forcePaidRequest ? 'Paid request: On' : 'Paid request: Off');
            break;
        case 'ALT+D':
            // Toggle disable syntax (!/ /) for selected text or remove if cursor is inside
            if (document.activeElement && (document.activeElement.type === 'textarea' ||
                document.activeElement.classList.contains('prompt-textarea') ||
                document.activeElement.classList.contains('character-prompt-textarea'))) {
                event.preventDefault();
                event.stopPropagation();
                if (window.toggleDisableSyntax) {
                    window.toggleDisableSyntax(document.activeElement);
                    showShortcutActionToast('Disable Selection');
                }
            }
            break;
        case 'ALT+ESCAPE':
            if (!shouldHandleManualModalActions) break;
            event.preventDefault();
            event.stopPropagation();
            hideShortcutsOverlay();
            hideManualModal(event);
            break;
            
        // Exit confirmation keyboard shortcuts
        case 'CTRL+R':
            // Refresh - show custom confirmation dialog
            if (typeof window.showExitConfirmation === 'function') {
                event.preventDefault();
                event.stopPropagation();
                window.showExitConfirmation(event, 'refresh');
            }
            break;
            
        case 'CTRL+SHIFT+R':
            // Hard refresh - show custom confirmation dialog
            if (typeof window.showExitConfirmation === 'function') {
                event.preventDefault();
                event.stopPropagation();
                window.showExitConfirmation(event, 'refresh');
            }
            break;
            
        case 'CTRL+W':
            // Close tab - let browser handle, beforeunload will show warning
            // Don't prevent default - let browser show "unsaved changes" dialog
            break;
            
        case 'CTRL+SHIFT+W':
            // Close window - let browser handle, beforeunload will show warning
            // Don't prevent default - let browser show "unsaved changes" dialog
            break;
            
        case 'ALT+F4':
            // Close window (Windows) - let browser handle, beforeunload will show warning
            // Don't prevent default - let browser show "unsaved changes" dialog
            break;
            
        default:
            break;
    }
}

// Handle key up events
function handleKeyUp(event) {
    if (event.key === 'Alt') {
        activeAltKeyCodes.delete(event.code || 'AltLeft');
        if (activeAltKeyCodes.size === 0) {
            suppressAltOverlayUntilRelease = false;
            altKeyPressed = false;
            hideShortcutsOverlay();
        }

        // Double-tap Alt opens Run applet (runApplet: public/scripts/comp/runApplet.js)
        if (!event.ctrlKey && !event.shiftKey && !event.metaKey && window.runApplet) {
            const now = Date.now();
            if (runAppletLastAltUpTime && now - runAppletLastAltUpTime < RUN_APPLET_DOUBLE_ALT_MS) {
                runAppletLastAltUpTime = 0;
                event.preventDefault();
                window.runApplet.toggle();
                return;
            }
            runAppletLastAltUpTime = now;
        }
    }

    // Handle CTRL release for window switcher
    if (event.key === 'Control' && windowSwitcherActive) {
        activateSelectedWindow();
        stopWindowSwitcher();
        ctrlKeyPressed = false;
    }
}

// Start window switcher
function startWindowSwitcher() {
    // Get window usage stack (most recent first) if available
    let orderedWindows = [];
    if (typeof getWindowUsageStack === 'function') {
        const usageStack = getWindowUsageStack(); // Returns most recent first
        // Filter to only include open windows
        orderedWindows = usageStack.filter(modal => 
            modal && 
            !modal.classList.contains('hidden') && 
            !modal.classList.contains('closing') &&
            modal.querySelector('.modal-window-title')
        );
    }
    
    // Get all open windows (modals that are not hidden and not closing)
    const allOpenModals = Array.from(document.querySelectorAll('.modal:not(.hidden)'))
        .filter(modal => !modal.classList.contains('closing') && modal.querySelector('.modal-window-title'));
    
    if (allOpenModals.length === 0) {
        return; // No windows to switch
    }
    
    // If we have a usage stack, use it; otherwise fall back to all open modals
    if (orderedWindows.length > 0) {
        // Add any windows not in the usage stack to the end
        const orderedIds = new Set(orderedWindows.map(m => m.id));
        const remainingWindows = allOpenModals.filter(m => !orderedIds.has(m.id));
        windowSwitcherWindows = [...orderedWindows, ...remainingWindows];
    } else {
        windowSwitcherWindows = allOpenModals;
    }
    
    windowSwitcherActive = true;
    
    // Find current active window index, start with current window
    const currentActiveWindow = document.querySelector('.modal.active-window:not(.minimised)');
    if (currentActiveWindow) {
        const index = windowSwitcherWindows.indexOf(currentActiveWindow);
        if (index >= 0) {
            // Start with the current window (will navigate to next after)
            windowSwitcherSelectedIndex = index;
        } else {
            windowSwitcherSelectedIndex = 0;
        }
    } else {
        // No active window, start at the first one (most recent)
        windowSwitcherSelectedIndex = 0;
    }
    
    updateWindowSwitcherDisplay();
    showWindowSwitcher();
}

// Navigate window switcher
function navigateWindowSwitcher(direction) {
    if (windowSwitcherWindows.length === 0) return;
    
    windowSwitcherSelectedIndex += direction;
    
    // Wrap around
    if (windowSwitcherSelectedIndex < 0) {
        windowSwitcherSelectedIndex = windowSwitcherWindows.length - 1;
    } else if (windowSwitcherSelectedIndex >= windowSwitcherWindows.length) {
        windowSwitcherSelectedIndex = 0;
    }
    
    updateWindowSwitcherDisplay();
}

// Update window switcher display
function updateWindowSwitcherDisplay() {
    if (!windowSwitcherOverlay || windowSwitcherWindows.length === 0) return;
    
    const titleEl = windowSwitcherOverlay.querySelector('.window-switcher-title');
    const iconsEl = windowSwitcherOverlay.querySelector('.window-switcher-icons');
    
    if (!titleEl || !iconsEl) return;
    
    const selectedModal = windowSwitcherWindows[windowSwitcherSelectedIndex];
    if (!selectedModal) return;
    
    // Get window title and icon using existing functions
    const title = typeof getModalTitle === 'function' ? getModalTitle(selectedModal) : (selectedModal.id || 'Window');
    const icon = typeof getModalIcon === 'function' ? getModalIcon(selectedModal) : 'fas fa-window';
    
    // Update title
    titleEl.textContent = title;
    
    // Update icons
    iconsEl.innerHTML = '';
    windowSwitcherWindows.forEach((modal, index) => {
        const iconEl = document.createElement('div');
        iconEl.className = 'window-switcher-icon';
        if (index === windowSwitcherSelectedIndex) {
            iconEl.classList.add('selected');
        }
        // Use getModalIcons to get both icon and imageIcon for dual icon rendering
        if (typeof getModalIcons === 'function' && typeof getIconHTML === 'function') {
            const icons = getModalIcons(modal);
            iconEl.innerHTML = getIconHTML(icons.icon || 'fas fa-window', icons.imageIcon || null);
        } else if (typeof getModalIcon === 'function' && typeof getIconHTML === 'function') {
            // Fallback to single icon mode
            const modalIcon = getModalIcon(modal);
            iconEl.innerHTML = getIconHTML(modalIcon);
        } else {
            // Final fallback
            iconEl.innerHTML = `<i class="fas fa-window"></i>`;
        }
        iconsEl.appendChild(iconEl);
    });
}

// Show window switcher
function showWindowSwitcher() {
    if (windowSwitcherOverlay) {
        windowSwitcherOverlay.classList.add('visible');
    }
}

// Hide window switcher
function hideWindowSwitcher() {
    if (windowSwitcherOverlay) {
        windowSwitcherOverlay.classList.remove('visible');
    }
}

// Stop window switcher
function stopWindowSwitcher() {
    windowSwitcherActive = false;
    windowSwitcherWindows = [];
    windowSwitcherSelectedIndex = 0;
    hideWindowSwitcher();
}

// Activate selected window
function activateSelectedWindow() {
    if (windowSwitcherWindows.length === 0 || windowSwitcherSelectedIndex < 0 || windowSwitcherSelectedIndex >= windowSwitcherWindows.length) {
        return;
    }
    
    const selectedModal = windowSwitcherWindows[windowSwitcherSelectedIndex];
    if (!selectedModal) return;
    
    // Unminimize if minimized
    if (selectedModal.classList.contains('minimised')) {
        // Get or create taskbar item for animation
        const taskbarItem = typeof getOrCreateTaskbarItem === 'function' ? getOrCreateTaskbarItem(selectedModal) : null;
        if (taskbarItem && typeof setMinimizeTargetVariables === 'function') {
            setMinimizeTargetVariables(selectedModal, taskbarItem);
        }
        
        selectedModal.classList.remove('minimised');
        updateBackdropVisibility(); // public/scripts/comp/modalUtils.js
        selectedModal.classList.add('unminimising');
        
        const unminimisingHandler = (e) => {
            if (e.target === selectedModal && e.animationName === 'modalUnminimize' && selectedModal.classList.contains('unminimising')) {
                selectedModal.removeEventListener('animationend', unminimisingHandler);
                selectedModal.classList.remove('unminimising');
            }
        };
        selectedModal.addEventListener('animationend', unminimisingHandler);
    }
    
    // Show if hidden
    if (selectedModal.classList.contains('hidden')) {
        selectedModal.classList.remove('hidden');
    }
    
    // Bring to front
    openModal(selectedModal);
}

let shortcutOverlayTimeout = null;
function resetShortcutModifierState() {
    altKeyPressed = false;
    ctrlKeyPressed = false;
    suppressAltOverlayUntilRelease = false;
    activeAltKeyCodes.clear();
    hideShortcutsOverlay();
    if (windowSwitcherActive) {
        stopWindowSwitcher();
    }
}

function handleShortcutWindowBlur() {
    resetShortcutModifierState();
}

function handleShortcutVisibilityChange() {
    if (document.visibilityState === 'hidden') {
        resetShortcutModifierState();
    }
}

// Show shortcuts overlay
function showShortcutsOverlay() {
    if (!shortcutsOverlay) return;
    shortcutsOverlay.classList.add('visible');
    clearTimeout(shortcutOverlayTimeout);
    shortcutOverlayTimeout = setTimeout(() => {
        shortcutsOverlay.classList.remove('visible');
    }, 30000);
}

// Hide shortcuts overlay
function hideShortcutsOverlay() {
    if (shortcutsOverlay) {
        shortcutsOverlay.classList.remove('visible');
        clearTimeout(shortcutOverlayTimeout);
    }
}

// Clean up event listeners
function cleanupManualModalShortcuts() {
    document.removeEventListener('keydown', handleKeyDown);
    document.removeEventListener('keyup', handleKeyUp);
    window.removeEventListener('blur', handleShortcutWindowBlur);
    document.removeEventListener('visibilitychange', handleShortcutVisibilityChange);
    resetShortcutModifierState();
    
    if (shortcutsOverlay && shortcutsOverlay.parentNode) {
        shortcutsOverlay.parentNode.removeChild(shortcutsOverlay);
    }
    
    if (windowSwitcherOverlay && windowSwitcherOverlay.parentNode) {
        windowSwitcherOverlay.parentNode.removeChild(windowSwitcherOverlay);
    }

    clearTimeout(shortcutActionToastHideTimer);
    clearTimeout(shortcutActionToastFadeTimer);
    if (shortcutActionToastHost && shortcutActionToastHost.parentNode) {
        shortcutActionToastHost.parentNode.removeChild(shortcutActionToastHost);
    }
    shortcutActionToastHost = null;
    clearTimeout(shortcutOverlayTimeout);
}

window.wsClient.registerInitStep(50, 'Initializing Keyboard Shortcuts', async () => {
    await initializeManualModalShortcuts();
});