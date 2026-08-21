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

let suppressAutofillUntil = 0;

/** Briefly suppress autofill after a prompt textarea shortcut (keyboardShortcuts.js). */
function markPromptShortcutHandled(ms = 120) {
    suppressAutofillUntil = Date.now() + ms;
}

function shouldSuppressAutofillFromShortcut() {
    return Date.now() < suppressAutofillUntil;
}

window.shouldSuppressAutofillFromShortcut = shouldSuppressAutofillFromShortcut;

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

function shortcutListItem(key, label, icon, alt, overlayValid) {
    const item = { key, label, icon: icon || '', alt: !!alt };
    if (typeof overlayValid === 'function') item.overlayValid = overlayValid;
    return item;
}

function shortcutListDivider() {
    return { divider: true };
}

const FN_KEY_ORDER = ['Esc', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'];
const FN_KEY_GROUPS = [
    ['Esc'],
    ['F1', 'F2', 'F3', 'F4'],
    ['F5', 'F6', 'F7', 'F8'],
    ['F9', 'F10', 'F11', 'F12']
];

const MANUAL_FN_ROW = [
    { key: 'Esc', label: 'Close', icon: 'fa fa-times' },
    { key: 'F1', label: 'Prompts', icon: 'ri-code-block' },
    { key: 'F2', label: 'UC', icon: 'ri-eraser-fill' },
    { key: 'F3', label: 'Weight Rack', icon: 'fas fa-weight-scale' },
    { key: 'F4', label: 'Quick Access', icon: 'fas fa-book-atlas' },
    { key: 'F5', label: 'Generate', icon: 'nai-sparkles' },
    { key: 'F6', label: 'References', icon: 'nai-img2img' },
    { key: 'F7', label: 'Reset', icon: 'nai-dot-reset' },
    { key: 'F8', label: 'Lock Seed', icon: 'fas fa-seedling' },
    { key: 'F9', label: 'Res. Ratio', icon: 'fas fa-expand-arrows-alt' },
    { key: 'F10', label: 'Comparison', icon: 'fas fa-eye-dropper' },
    { key: 'F11', empty: true },
    { key: 'F12', empty: true }
];

const MANUAL_FN_ALT_ROW = [
    { key: 'F1', label: 'Merged', icon: 'nai-detatch-up' },
    { key: 'F2', label: 'Autofill Window', icon: 'fas fa-wand-magic-sparkles' },
    { key: 'F3', label: 'Reset Emp.', icon: 'fas fa-eraser' },
    { key: 'F5', label: 'Staged Gen.', icon: 'fas fa-arrow-down-square-triangle' },
    { key: 'F7', label: 'Maximum', icon: 'fas fa-bolt' },
    { key: 'F8', label: 'Compare Source', icon: 'fas fa-eye-dropper', overlayValid: () => isCompareSourceAvailableForOverlay() },
    { key: 'F9', label: 'Res. Group', icon: 'fas fa-layer-group' },
    { key: 'F10', label: 'Compare View', icon: 'fas fa-columns-3', overlayValid: () => isCompareSourceAvailableForOverlay() }
];

const MANUAL_CLASSIC_LEFT = [
    shortcutListItem('ALT + A', 'Add Character', 'fa fa-user-plus'),
    shortcutListItem('CTRL + F', 'Inline Search', 'fa fa-search'),
    shortcutListItem('CTRL + I', 'Toggle Autofill', 'fa fa-lightbulb'),
    shortcutListItem('ALT + P', 'Allow Paid', 'fa fa-dollar-sign'),
    shortcutListItem('Alt + F', 'Favorite Tag', 'fa fa-star'),
    shortcutListItem('Alt + D', 'Disable Syntax', 'fa fa-ban'),
    shortcutListItem('Alt + C', 'Clear Preview', 'fas fa-image-slash'),
    shortcutListItem('Alt + Esc', 'Close Editor', 'fa fa-times'),
    shortcutListDivider(),
    shortcutListItem('Alt + ,', 'Previous Image', 'nai-directional-arrow-left'),
    shortcutListItem('Alt + .', 'Next Image', 'nai-directional-arrow-right')
];

const MANUAL_CLASSIC_RIGHT = [
    shortcutListItem('F1', 'Prompts', 'ri-code-block'),
    shortcutListItem('F2', 'UC', 'ri-eraser-fill'),
    shortcutListItem('ALT + F2', 'Autofill Window', 'fas fa-wand-magic-sparkles', true),
    shortcutListItem('ALT + F1', 'Prompts/UC', 'nai-detatch-up', true),
    shortcutListItem('F3', 'Weight Rack', 'fas fa-weight-scale'),
    shortcutListItem('ALT + F3', 'Reset Emphasis', 'fas fa-eraser', true),
    shortcutListItem('ALT + S', 'Split Emphasis', 'fas fa-scissors', true),
    shortcutListItem('ALT + SHIFT + S', 'Split at Commas', 'fas fa-knife-kitchen', true),
    shortcutListItem('F4', 'Quick Access', 'fas fa-book-atlas'),
    shortcutListDivider(),
    shortcutListItem('F5', 'Generate', 'nai-sparkles'),
    shortcutListItem('ALT + F5', 'Staged Generation', 'fas fa-arrow-down-square-triangle', true),
    shortcutListItem('F6', 'References', 'nai-img2img'),
    shortcutListItem('F7', 'Reset to Normal', 'nai-dot-reset'),
    shortcutListItem('ALT + F7', 'Maximum Quality', 'fas fa-bolt', true),
    shortcutListItem('F8', 'Lock Seed', 'fas fa-seedling'),
    shortcutListItem('ALT + F8', 'Toggle/Replace Compare Source', 'fas fa-eye-dropper', true, () => isCompareSourceAvailableForOverlay()),
    shortcutListDivider(),
    shortcutListItem('F9', 'Cycle Ratio', 'fas fa-expand-arrows-alt'),
    shortcutListItem('ALT + F9', 'Cycle Res. Group', 'fas fa-layer-group', true),
    shortcutListItem('F10', 'Comparison', 'fas fa-eye-dropper'),
    shortcutListItem('ALT + F10', 'Cycle Compare View', 'fas fa-columns-3', true, () => isCompareSourceAvailableForOverlay()),
    shortcutListItem('ALT + L/SHFT', 'Peek Source', 'fas fa-eye-dropper', true, () => isCompareSourceAvailableForOverlay()),
    shortcutListItem('ALT + R/SHFT', 'Peek Result', 'fas fa-eye-dropper', true, () => isCompareSourceAvailableForOverlay()),
    shortcutListItem('F11', '', ''),
    shortcutListItem('F12', '', '')
];

const MANUAL_WIDE_LIST = [...MANUAL_CLASSIC_LEFT, ...MANUAL_CLASSIC_RIGHT];

const SHORTCUT_PROFILES = {
    manual: {
        fnRow: MANUAL_FN_ROW,
        fnAltRow: MANUAL_FN_ALT_ROW,
        classicLeft: MANUAL_CLASSIC_LEFT,
        classicRight: MANUAL_CLASSIC_RIGHT,
        wideList: MANUAL_WIDE_LIST
    },
    expansion: {
        fnRow: [
            { key: 'F1', label: 'Prompts', icon: 'ri-code-block' },
            { key: 'F2', label: 'UC', icon: 'ri-eraser-fill' }
        ],
        fnAltRow: [],
        classicLeft: [
            shortcutListItem('F1', 'Prompts', 'ri-code-block'),
            shortcutListItem('F2', 'UC', 'ri-eraser-fill')
        ],
        classicRight: [],
        wideList: [
            shortcutListItem('F1', 'Prompts', 'ri-code-block'),
            shortcutListItem('F2', 'UC', 'ri-eraser-fill')
        ]
    },
    bracket: {
        fnRow: [
            { key: 'F1', label: 'Prompt', icon: 'ri-code-block' },
            { key: 'F2', label: 'UC', icon: 'ri-eraser-fill' },
            { key: 'F8', label: 'Compile Stages', icon: 'fas fa-hammer' }
        ],
        fnAltRow: [],
        classicLeft: [
            shortcutListItem('F1', 'Prompt', 'ri-code-block'),
            shortcutListItem('F2', 'UC', 'ri-eraser-fill'),
            shortcutListItem('F8', 'Compile Stages', 'fas fa-hammer'),
            shortcutListDivider(),
            shortcutListItem('ALT + A', 'New Stage', 'fas fa-plus', true),
            shortcutListItem('ALT + K', 'Add Keyword', 'fas fa-tag', true)
        ],
        classicRight: [],
        wideList: [
            shortcutListItem('F1', 'Prompt', 'ri-code-block'),
            shortcutListItem('F2', 'UC', 'ri-eraser-fill'),
            shortcutListItem('F8', 'Compile Stages', 'fas fa-hammer'),
            shortcutListDivider(),
            shortcutListItem('ALT + A', 'New Stage', 'fas fa-plus', true),
            shortcutListItem('ALT + K', 'Add Keyword', 'fas fa-tag', true)
        ]
    }
};

const OVERLAY_SCOPE_MANUAL = { type: 'whenFocused', modalId: 'manualModal', idPrefix: 'manual' };
const OVERLAY_SCOPE_EXPANSION = { type: 'whenFocused', modalId: 'expansionCompiledPromptDialog', idPrefix: 'expansion' };
const OVERLAY_SCOPE_BRACKET = { type: 'whenFocused', modalId: 'bracketGenerationModal', idPrefix: 'bracket' };

function normalizeOverlayFnKey(keys) {
    const raw = String(keys || '').trim();
    if (!raw) return raw;
    const stripped = raw.replace(/^ALT\+/i, '').trim();
    if (/^ESCAPE$/i.test(stripped)) return 'Esc';
    return stripped;
}

function registerShortcutOverlayListItem(scope, item, options) {
    if (!item || item.divider || !item.key || !item.label) return;
    const suffix = options && options.suffix
        ? options.suffix
        : item.key.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
    const overlayValid = (options && options.overlayValid) || item.overlayValid || null;
    // registerKeyboardListener: public/scripts/comp/modalKeyboardRegistry.js
    registerKeyboardListener({
        id: `overlay.${scope.idPrefix}.${suffix}`,
        type: scope.type,
        modalId: scope.modalId,
        label: item.label,
        keys: item.key,
        overlayIcon: item.icon || null,
        overlayGroup: options && options.group ? options.group : null,
        overlayAlt: item.alt === true,
        overlayFnRow: options && options.fnRow ? options.fnRow : null,
        overlayValid,
        overlayOnly: true,
        priority: -10
    });
}

function registerShortcutOverlayFnRow(scope, fnRowDefs, fnRowKind) {
    mergeFnRowDefs(fnRowDefs).forEach((def) => {
        if (def.empty || (!def.label && !def.icon)) return;
        registerShortcutOverlayListItem(scope, def, {
            fnRow: fnRowKind,
            suffix: `${fnRowKind}-${def.key}`.toLowerCase(),
            overlayValid: def.overlayValid || null
        });
    });
}

function registerKeyboardShortcutOverlays() {
    MANUAL_CLASSIC_LEFT.forEach((item, index) => {
        registerShortcutOverlayListItem(OVERLAY_SCOPE_MANUAL, item, { group: 'classic-left', suffix: `left-${index}` });
    });
    MANUAL_CLASSIC_RIGHT.forEach((item, index) => {
        registerShortcutOverlayListItem(OVERLAY_SCOPE_MANUAL, item, { group: 'classic-right', suffix: `right-${index}` });
    });
    registerShortcutOverlayFnRow(OVERLAY_SCOPE_MANUAL, MANUAL_FN_ROW, 'primary');
    registerShortcutOverlayFnRow(OVERLAY_SCOPE_MANUAL, MANUAL_FN_ALT_ROW, 'alt');

    SHORTCUT_PROFILES.expansion.classicLeft.forEach((item, index) => {
        registerShortcutOverlayListItem(OVERLAY_SCOPE_EXPANSION, item, { suffix: `exp-${index}` });
    });
    registerShortcutOverlayFnRow(OVERLAY_SCOPE_EXPANSION, SHORTCUT_PROFILES.expansion.fnRow, 'primary');

    SHORTCUT_PROFILES.bracket.wideList.forEach((item, index) => {
        registerShortcutOverlayListItem(OVERLAY_SCOPE_BRACKET, item, { suffix: `bracket-${index}` });
    });
    registerShortcutOverlayFnRow(OVERLAY_SCOPE_BRACKET, SHORTCUT_PROFILES.bracket.fnRow, 'primary');

    if (window.isDesktop) {
        registerKeyboardListener({
            id: 'overlay.global.ctrlTab',
            type: 'global',
            label: 'Switch Window',
            keys: 'Ctrl+Tab',
            overlayIcon: 'fas fa-window-restore',
            overlayGroup: 'Desktop',
            overlayOnly: true,
            priority: -10
        });
    }
}

let keyboardShortcutOverlaysRegistered = false;

function ensureKeyboardShortcutOverlaysRegistered() {
    if (keyboardShortcutOverlaysRegistered) return;
    keyboardShortcutOverlaysRegistered = true;
    registerKeyboardShortcutOverlays();
}

let shortcutsClassicLeftGrid = null;
let shortcutsClassicRightGrid = null;
let shortcutsWideListEl = null;
let shortcutsWideFnPrimaryGroupsEl = null;
let shortcutsWideFnAltGroupsEl = null;
let shortcutsWideFnAltRowEl = null;

function isBareFunctionKey(key) {
    return /^F(\d{1,2})$/i.test(String(key || '').trim());
}

function isAltFunctionKeyCombo(key) {
    const normalized = String(key || '').replace(/\s+/g, '');
    return /^ALT\+F\d{1,2}$/i.test(normalized);
}

function resolveRegistryOverlayFnRow(entry) {
    if (entry.overlayFnRow) return entry.overlayFnRow;
    const keys = String(entry.overlayKeys || '').trim();
    if (isBareFunctionKey(keys)) return 'primary';
    if (isAltFunctionKeyCombo(keys)) return 'alt';
    return null;
}

function mergeFnRowDefs(fnRowDefs) {
    const byKey = {};
    (fnRowDefs || []).forEach((def) => {
        if (def && def.key) byKey[def.key] = def;
    });
    return FN_KEY_ORDER.map((key) => byKey[key] || { key, empty: true });
}

function appendShortcutDesc(parent, label, icon) {
    const desc = document.createElement('span');
    desc.className = 'shortcut-desc';
    if (label) {
        const labelSpan = document.createElement('span');
        labelSpan.textContent = label;
        desc.appendChild(labelSpan);
    }
    if (icon) {
        const iconEl = document.createElement('i');
        iconEl.className = icon;
        desc.appendChild(iconEl);
    }
    parent.appendChild(desc);
}

function createShortcutListItem(item) {
    if (item.divider) {
        const divider = document.createElement('div');
        divider.className = 'divider';
        return divider;
    }
    const row = document.createElement('div');
    row.className = 'shortcut-item' + (item.alt ? ' alt' : '');
    const keyEl = document.createElement('span');
    keyEl.className = 'shortcut-key';
    keyEl.textContent = item.key;
    row.appendChild(keyEl);
    appendShortcutDesc(row, item.label, item.icon);
    return row;
}

function renderShortcutListItems(container, items) {
    if (!container) return;
    container.innerHTML = '';
    (items || []).forEach((item) => {
        container.appendChild(createShortcutListItem(item));
    });
}

function createFnKeyElement(def, options) {
    const altRow = options && options.altRow;
    const isEmpty = !!def.empty || (!def.label && !def.icon);
    const wrap = document.createElement('div');
    wrap.className = 'shortcut-fn-key' +
        (isEmpty ? ' is-empty' : '') +
        (altRow ? ' shortcut-fn-key--alt' : '');

    if (!isEmpty && def.label) {
        const actionLabel = document.createElement('span');
        actionLabel.className = 'shortcut-fn-action-label';
        actionLabel.textContent = def.label;
        wrap.appendChild(actionLabel);
    }

    const cap = document.createElement('div');
    cap.className = 'shortcut-fn-key-cap' + (altRow ? ' shortcut-fn-key-cap--alt' : '');

    if (!isEmpty && def.icon) {
        const iconEl = document.createElement('i');
        iconEl.className = def.icon + ' shortcut-fn-icon';
        cap.appendChild(iconEl);
    }

    const keyLabel = document.createElement('span');
    keyLabel.className = 'shortcut-fn-key-label';
    keyLabel.textContent = def.key;
    cap.appendChild(keyLabel);

    wrap.appendChild(cap);
    return wrap;
}

function fnRowHasActiveKeys(fnRowDefs) {
    return mergeFnRowDefs(fnRowDefs).some((def) => !def.empty && (def.label || def.icon));
}

function renderFnKeyRow(container, fnRowDefs, options) {
    if (!container) return;
    container.innerHTML = '';
    const merged = mergeFnRowDefs(fnRowDefs);
    const byKey = {};
    merged.forEach((def) => { byKey[def.key] = def; });

    FN_KEY_GROUPS.forEach((groupKeys) => {
        const groupEl = document.createElement('div');
        groupEl.className = 'shortcuts-fn-group';
        groupKeys.forEach((key) => {
            groupEl.appendChild(createFnKeyElement(byKey[key] || { key, empty: true }, options));
        });
        container.appendChild(groupEl);
    });
}

function getShortcutOverlayContextFlags() {
    const isManualModalOpen = manualModal &&
        !manualModal.classList.contains('hidden') &&
        !manualModal.classList.contains('minimised') &&
        !manualModal.classList.contains('minimising');

    let shouldHandleManualModalActions = false;
    if (isManualModalOpen) {
        if (window.isDesktop) {
            shouldHandleManualModalActions = manualModal.classList.contains('active-window');
        } else {
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

    const shouldHandleBracketGenShortcuts = typeof bracketGenIsAppletActive === 'function' && bracketGenIsAppletActive();

    return {
        shouldHandleManualModalActions,
        shouldHandleExpansionPromptEditorShortcuts,
        shouldHandleBracketGenShortcuts
    };
}

function overlayRegistryEntryToListItem(entry) {
    return shortcutListItem(
        entry.overlayKeys,
        entry.overlayLabel,
        entry.overlayIcon || '',
        entry.overlayAlt === true
    );
}

function renderShortcutsOverlayFromRegistry() {
    // getActiveKeyboardOverlayEntries: public/scripts/comp/modalKeyboardRegistry.js
    const entries = getActiveKeyboardOverlayEntries();
    if (!entries.length) {
        hideShortcutsOverlay();
        return false;
    }

    const classicLeftItems = [];
    const classicRightItems = [];
    const wideListItems = [];
    const fnRowDefs = [];
    const fnAltRowDefs = [];
    let wideLastGroup = null;

    entries.forEach((entry) => {
        const fnRow = resolveRegistryOverlayFnRow(entry);
        if (fnRow === 'primary') {
            fnRowDefs.push({
                key: normalizeOverlayFnKey(entry.overlayKeys),
                label: entry.overlayLabel,
                icon: entry.overlayIcon || ''
            });
            return;
        }
        if (fnRow === 'alt') {
            fnAltRowDefs.push({
                key: normalizeOverlayFnKey(entry.overlayKeys),
                label: entry.overlayLabel,
                icon: entry.overlayIcon || ''
            });
            return;
        }

        const item = overlayRegistryEntryToListItem(entry);
        const group = entry.overlayGroup;
        if (group === 'classic-left') {
            classicLeftItems.push(item);
        } else if (group === 'classic-right') {
            classicRightItems.push(item);
        } else {
            classicLeftItems.push(item);
        }

        if (group && group !== wideLastGroup && wideListItems.length) {
            wideListItems.push(shortcutListDivider());
        }
        wideLastGroup = group;
        wideListItems.push(item);
    });

    const wideList = wideListItems.filter((item) => {
        if (item.divider) return true;
        return !isBareFunctionKey(item.key);
    });

    renderShortcutListItems(shortcutsClassicLeftGrid, classicLeftItems);
    renderShortcutListItems(shortcutsClassicRightGrid, classicRightItems);
    renderShortcutListItems(shortcutsWideListEl, wideList);
    renderFnKeyRow(shortcutsWideFnAltGroupsEl, fnAltRowDefs, { altRow: true });
    renderFnKeyRow(shortcutsWideFnPrimaryGroupsEl, fnRowDefs);

    const wideListPanel = shortcutsWideListEl && shortcutsWideListEl.closest('.shortcuts-wide-list');
    if (wideListPanel) {
        wideListPanel.classList.toggle('is-empty', !wideList.length);
    }
    if (shortcutsWideFnAltRowEl) {
        shortcutsWideFnAltRowEl.classList.toggle('is-empty', !fnRowHasActiveKeys(fnAltRowDefs));
    }
    return true;
}

function refreshShortcutsOverlayIfVisible() {
    if (!shortcutsOverlay || !shortcutsOverlay.classList.contains('visible')) return;
    if (activeAltKeyCodes.size === 0 || suppressAltOverlayUntilRelease) return;
    renderShortcutsOverlayFromRegistry();
}

// Initialize keyboard shortcuts
function initializeManualModalShortcuts() {
    createShortcutsOverlay();
    createWindowSwitcherOverlay();
    ensureKeyboardShortcutOverlaysRegistered();
    // setKeyboardOverlayRefreshCallback: public/scripts/comp/modalKeyboardRegistry.js
    setKeyboardOverlayRefreshCallback(refreshShortcutsOverlayIfVisible);
    // registerKeyboardListener: public/scripts/comp/modalKeyboardRegistry.js
    registerKeyboardListener({
        id: 'keyboardShortcuts.keydown',
        handler: handleKeyDown,
        type: 'global',
        eventType: 'keydown',
        priority: 50,
        critical: false,
        showInOverlay: false
    });
    registerKeyboardListener({
        id: 'keyboardShortcuts.keyup',
        handler: handleKeyUp,
        type: 'global',
        eventType: 'keyup',
        priority: 50,
        critical: false,
        showInOverlay: false
    });
    window.addEventListener('blur', handleShortcutWindowBlur);
    document.addEventListener('visibilitychange', handleShortcutVisibilityChange);
    wireEscapeAndCharacterDetailKeys();
}

function handleEscapeAndCharacterDetailKeys(e) {
    const characterAutocompleteOverlay = document.getElementById('characterAutocompleteOverlay');
    const metadataDialog = document.getElementById('metadataDialog');

    if (e.key === 'Escape') {
        if (metadataDialog && !metadataDialog.classList.contains('hidden')) {
            // hideMetadataDialog: public/scripts/app.js
            hideMetadataDialog();
            return true;
        }
        if (characterAutocompleteOverlay && !characterAutocompleteOverlay.classList.contains('hidden')) {
            const autocompleteList = document.querySelector('.character-autocomplete-list');
            if (autocompleteList && autocompleteList.querySelector('.character-detail-content')) {
                // hideCharacterDetail: public/scripts/comp/autocompleteUtils.js
                hideCharacterDetail();
                return true;
            }
            // hideCharacterAutocomplete: public/scripts/comp/autocompleteUtils.js
            hideCharacterAutocomplete();
            return true;
        }
        const activeElement = document.activeElement;
        if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')) {
            const selection = window.getSelection();
            if (selection && selection.toString().length > 0) {
                const range = selection.getRangeAt(0);
                const endOffset = range.endOffset;
                selection.removeAllRanges();
                if (activeElement.setSelectionRange) {
                    activeElement.setSelectionRange(endOffset, endOffset);
                }
            } else {
                activeElement.blur();
            }
            return true;
        }
        return false;
    }

    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        if (characterAutocompleteOverlay && !characterAutocompleteOverlay.classList.contains('hidden')) {
            const autocompleteList = document.querySelector('.character-autocomplete-list');
            if (autocompleteList && autocompleteList.querySelector('.character-detail-content')) {
                // Capture-phase listener runs before the focused textarea's own keydown (handleCharacterAutocompleteKeydown: public/scripts/comp/autocompleteUtils.js); stop propagation so the detail nav isn't applied twice.
                e.preventDefault();
                e.stopPropagation();
                // handleCharacterDetailArrowKeys: public/scripts/comp/autocompleteUtils.js
                handleCharacterDetailArrowKeys(e.key);
                return true;
            }
        }
        return false;
    }

    if (e.key === 'Enter') {
        if (characterAutocompleteOverlay && !characterAutocompleteOverlay.classList.contains('hidden')) {
            const autocompleteList = document.querySelector('.character-autocomplete-list');
            if (autocompleteList && autocompleteList.querySelector('.character-detail-content')) {
                // Stop propagation so the focused textarea's keydown (handleCharacterAutocompleteKeydown: public/scripts/comp/autocompleteUtils.js) doesn't apply the enhancer a second time.
                e.preventDefault();
                e.stopPropagation();
                // handleCharacterDetailEnter: public/scripts/comp/autocompleteUtils.js
                handleCharacterDetailEnter();
                return true;
            }
        }
    }

    return false;
}

function wireEscapeAndCharacterDetailKeys() {
    if (document.body.dataset.escapeCharacterDetailKeysWired === 'true') return;
    document.body.dataset.escapeCharacterDetailKeysWired = 'true';

    // registerKeyboardListener: public/scripts/comp/modalKeyboardRegistry.js
    registerKeyboardListener({
        id: 'keyboardShortcuts.escapeCharacterDetail',
        handler: handleEscapeAndCharacterDetailKeys,
        type: 'global',
        priority: 60,
        critical: true,
        showInOverlay: false
    });
}

// Create the shortcuts overlay
function createShortcutsOverlay() {
    shortcutsOverlay = document.createElement('div');
    shortcutsOverlay.id = 'shortcutsOverlay';
    shortcutsOverlay.className = 'shortcuts-overlay';

    const classicLayout = document.createElement('div');
    classicLayout.className = 'shortcuts-layout shortcuts-layout--classic';
    classicLayout.innerHTML = `
        <div class="shortcuts-content">
            <div class="shortcuts-title">Keyboard Shortcuts</div>
            <div class="shortcuts-grids">
                <div class="shortcuts-grid left"></div>
                <div class="shortcuts-grid right"></div>
            </div>
        </div>
    `;
    shortcutsClassicLeftGrid = classicLayout.querySelector('.shortcuts-grid.left');
    shortcutsClassicRightGrid = classicLayout.querySelector('.shortcuts-grid.right');

    const wideLayout = document.createElement('div');
    wideLayout.className = 'shortcuts-layout shortcuts-layout--wide';
    wideLayout.innerHTML = `
        <div class="shortcuts-wide-stack">
            <div class="shortcuts-glass shortcuts-wide-list">
                <div class="shortcuts-title">Keyboard Shortcuts</div>
                <div class="shortcuts-wide-list-items"></div>
            </div>
            <div class="shortcuts-glass shortcuts-fn-panel">
                <div class="shortcuts-fn-rows">
                    <div class="shortcuts-fn-row shortcuts-fn-row--alt">
                        <span class="shortcuts-fn-row-alt-label" aria-hidden="true">ALT</span>
                        <div class="shortcuts-fn-groups shortcuts-fn-alt-groups"></div>
                    </div>
                    <div class="shortcuts-fn-row shortcuts-fn-row--primary">
                        <span class="shortcuts-fn-row-alt-label shortcuts-fn-row-alt-label--spacer" aria-hidden="true">ALT</span>
                        <div class="shortcuts-fn-groups shortcuts-fn-primary-groups"></div>
                    </div>
                </div>
            </div>
        </div>
    `;
    shortcutsWideListEl = wideLayout.querySelector('.shortcuts-wide-list-items');
    shortcutsWideFnAltGroupsEl = wideLayout.querySelector('.shortcuts-fn-alt-groups');
    shortcutsWideFnPrimaryGroupsEl = wideLayout.querySelector('.shortcuts-fn-primary-groups');
    shortcutsWideFnAltRowEl = wideLayout.querySelector('.shortcuts-fn-row--alt');

    shortcutsOverlay.appendChild(classicLayout);
    shortcutsOverlay.appendChild(wideLayout);
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
    // Plain typing in prompt fields — autofill uses input/beforeinput; skip global shortcut work.
    const shortcutTarget = event.target;
    if (shortcutTarget && shortcutTarget.matches && shortcutTarget.matches('.text-search-input')) {
        return true;
    }
    if (shortcutTarget && shortcutTarget.matches && shortcutTarget.matches('.prompt-textarea, .character-prompt-textarea')) {
        if (!event.ctrlKey && !event.metaKey && !event.altKey) {
            const k = event.key;
            const isPlainTypingKey = k.length === 1 || k === 'Backspace' || k === 'Delete' || k === 'Enter' ||
                k === 'Tab' || k.startsWith('Arrow');
            if (isPlainTypingKey && !/^F\d{1,2}$/i.test(k)) {
                return true;
            }
        }
    }

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
    
    const shortcutContextFlags = getShortcutOverlayContextFlags();
    const {
        shouldHandleManualModalActions,
        shouldHandleExpansionPromptEditorShortcuts,
        shouldHandleBracketGenShortcuts
    } = shortcutContextFlags;
    
    if (windowSwitcherActive) return;

    // Handle Alt key press — universal overlay from keyboard registry
    if (event.key === 'Alt') {
        if (suppressAltOverlayUntilRelease) return;
        if (event.repeat) return;
        ensureKeyboardShortcutOverlaysRegistered();
        // getActiveKeyboardOverlayEntries: public/scripts/comp/modalKeyboardRegistry.js
        const overlayEntries = getActiveKeyboardOverlayEntries();
        if (!overlayEntries.length) return;
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
            if (shouldHandleBracketGenShortcuts && typeof bracketGenerationApplet !== 'undefined' && bracketGenerationApplet) {
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
            if (shouldHandleBracketGenShortcuts && typeof bracketGenerationApplet !== 'undefined' && bracketGenerationApplet) {
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
        case 'ALT+E':
            {
                const activeTextarea = document.activeElement;
                if (activeTextarea && activeTextarea.matches('.prompt-textarea, .character-prompt-textarea')) {
                    event.preventDefault();
                    event.stopPropagation();
                    // promptTextareaToolbar.handleAltEEmphasisShortcut: public/scripts/comp/promptTextareaToolbar.js
                    if (window.promptTextareaToolbar) {
                        const tb = window.promptTextareaToolbar.getToolbarFromTextarea(activeTextarea);
                        window.promptTextareaToolbar.handleAltEEmphasisShortcut(activeTextarea, tb);
                    }
                }
            }
            break;
        case 'ALT+F1':
            if (!shouldHandleManualModalActions) break;
            event.preventDefault();
            event.stopPropagation();
            toggleManualShowBoth();
            break;
        case 'ALT+F2':
            if (!shouldHandleManualModalActions) break;
            event.preventDefault();
            event.stopPropagation();
            // openAutofillToolWindow: public/scripts/comp/autocompleteUtils.js
            openAutofillToolWindow(document.activeElement);
            break;
        case 'F3':
            {
                const activeTextarea = document.activeElement;
                if (activeTextarea && activeTextarea.matches('.prompt-textarea, .character-prompt-textarea')) {
                    event.preventDefault();
                    event.stopPropagation();
                    // emphasisGroupsToolManager: public/scripts/comp/emphasisGroupsToolManager.js
                    if (emphasisGroupsToolManager) {
                        emphasisGroupsToolManager.openForTextarea(activeTextarea);
                        showShortcutActionToast('Weight Rack');
                    }
                }
            }
            break;
        case 'ALT+F3':
            // Remove all emphasis from selection or entire active prompt textarea
            const activeElement = document.activeElement;
            if (activeElement && activeElement.matches('.prompt-textarea, .character-prompt-textarea')) {
                event.preventDefault();
                event.stopPropagation();
                removeAllEmphasisFromSelection(activeElement);
                // updateEmphasisHighlighting: public/scripts/comp/emphasisHighlight.js
                updateEmphasisHighlighting(activeElement);
                showShortcutActionToast('Reset Emphasis');
            }
            break;
        case 'F4':
            if (!shouldHandleManualModalActions) break;
            event.preventDefault();
            event.stopPropagation();
            // public/scripts/comp/featureLoader.js
            void featureLoader.loadFeature('dataset_tag_toolbar').then(() => {
                showDatasetTagToolbar();
                showShortcutActionToast('Quick access');
            });
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
            if (shouldHandleBracketGenShortcuts && typeof bracketGenerationApplet !== 'undefined' && bracketGenerationApplet) {
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
            if (shouldHandleBracketGenShortcuts && typeof bracketGenerationApplet !== 'undefined' && bracketGenerationApplet) {
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
            if (shouldHandleBracketGenShortcuts && typeof bracketGenerationApplet !== 'undefined' && bracketGenerationApplet) {
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
        case 'ALT+C':
            if (!shouldHandleManualModalActions) break;
            event.preventDefault();
            event.stopPropagation();
            // resetManualPreview: public/scripts/comp/manualPreviewManager.js
            resetManualPreview();
            showShortcutActionToast('Cleared Preview');
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

    if (event.defaultPrevented) {
        const active = document.activeElement;
        if (active && active.matches('.prompt-textarea, .character-prompt-textarea')) {
            markPromptShortcutHandled();
        }
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

            // Double-tap Alt opens Run applet (runApplet: public/scripts/comp/runApplet.js)
            if (!event.ctrlKey && !event.shiftKey && !event.metaKey) {
                const now = Date.now();
                if (runAppletLastAltUpTime && now - runAppletLastAltUpTime < RUN_APPLET_DOUBLE_ALT_MS) {
                    runAppletLastAltUpTime = 0;
                    event.preventDefault();
                    // public/scripts/comp/featureLoader.js
                    void featureLoader.loadFeature('run').then(() => runApplet.toggle());
                    return;
                }
                runAppletLastAltUpTime = now;
            }
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
    // restoreMinimizedModal: public/scripts/comp/modalUtils.js
    if (typeof restoreMinimizedModal === 'function') {
        restoreMinimizedModal(selectedModal, typeof getOrCreateTaskbarItem === 'function' ? getOrCreateTaskbarItem(selectedModal) : null);
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
    if (suppressAltOverlayUntilRelease) return;

    if (shortcutsOverlay.classList.contains('visible')) {
        clearTimeout(shortcutOverlayTimeout);
        shortcutOverlayTimeout = setTimeout(hideShortcutsOverlayIfAltReleased, 30000);
        return;
    }

    ensureKeyboardShortcutOverlaysRegistered();
    if (!renderShortcutsOverlayFromRegistry()) return;

    const isWideViewport = window.innerWidth > window.innerHeight;
    shortcutsOverlay.classList.toggle('shortcuts-overlay--wide', isWideViewport);

    shortcutsOverlay.classList.add('visible');
    clearTimeout(shortcutOverlayTimeout);
    shortcutOverlayTimeout = setTimeout(hideShortcutsOverlayIfAltReleased, 30000);
}

function hideShortcutsOverlayIfAltReleased() {
    if (activeAltKeyCodes.size > 0) return;
    hideShortcutsOverlay();
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
    // deregisterKeyboardListener: public/scripts/comp/modalKeyboardRegistry.js
    deregisterKeyboardListener('keyboardShortcuts.keydown');
    deregisterKeyboardListener('keyboardShortcuts.keyup');
    deregisterKeyboardListener('keyboardShortcuts.escapeCharacterDetail');
    // setKeyboardOverlayRefreshCallback: public/scripts/comp/modalKeyboardRegistry.js
    setKeyboardOverlayRefreshCallback(null);
    window.removeEventListener('blur', handleShortcutWindowBlur);
    document.removeEventListener('visibilitychange', handleShortcutVisibilityChange);
    resetShortcutModifierState();
    
    if (shortcutsOverlay && shortcutsOverlay.parentNode) {
        shortcutsOverlay.parentNode.removeChild(shortcutsOverlay);
    }
    shortcutsOverlay = null;
    shortcutsClassicLeftGrid = null;
    shortcutsClassicRightGrid = null;
    shortcutsWideListEl = null;
    shortcutsWideFnPrimaryGroupsEl = null;
    shortcutsWideFnAltGroupsEl = null;
    shortcutsWideFnAltRowEl = null;
    
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