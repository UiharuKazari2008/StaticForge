// SmartText / autofill search settings — public/scripts/comp/autofillSettings.js

const AUTOFILL_DELAY_PRESETS = [
    { ms: 0, label: 'Instant (0 ms)' },
    { ms: 80, label: 'Fast (80 ms)' },
    { ms: 120, label: 'Normal (120 ms)' },
    { ms: 200, label: 'Relaxed (200 ms)' },
    { ms: 300, label: 'Slow (300 ms)' },
    { ms: 500, label: 'Very Slow (500 ms)' }
];

const AUTOFILL_MAX_RESULTS_PRESETS = [
    { count: 15, label: '15 results' },
    { count: 25, label: '25 results' },
    { count: 35, label: '35 results' },
    { count: 50, label: '50 results' },
    { count: 75, label: '75 results' }
];

const DEFAULT_AUTOFILL_SEARCH_SETTINGS = {
    enabled: true,
    spellcheck: true,
    thesaurus: true,
    naiAnimeTags: true,
    naiFurryTags: true,
    dbAnimeTags: true,
    dbFurryTags: true,
    wikiPreviews: true,
    searchDelayMs: 120,
    maxResults: 35
};

let autofillSearchSettings = { ...DEFAULT_AUTOFILL_SEARCH_SETTINGS };
let autofillSearchSettingsDraft = null;
let autofillSearchSettingsDirty = false;
let autofillSearchSettingsSavePromise = null;
let autofillSettingsMenuWired = false;

function normalizeAutofillSearchSettingsClient(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    const pickPreset = (value, presets, fallback) => {
        const n = Number(value);
        if (!Number.isFinite(n)) return fallback;
        return presets.some(p => p.ms === n || p.count === n) ? n : fallback;
    };
    return {
        enabled: base.enabled !== false,
        spellcheck: base.spellcheck !== false,
        thesaurus: base.thesaurus !== false,
        naiAnimeTags: base.naiAnimeTags !== false,
        naiFurryTags: base.naiFurryTags !== false,
        dbAnimeTags: base.dbAnimeTags !== false,
        dbFurryTags: base.dbFurryTags !== false,
        wikiPreviews: base.wikiPreviews !== false,
        searchDelayMs: pickPreset(base.searchDelayMs, AUTOFILL_DELAY_PRESETS.map(p => ({ ms: p.ms })), DEFAULT_AUTOFILL_SEARCH_SETTINGS.searchDelayMs),
        maxResults: pickPreset(base.maxResults, AUTOFILL_MAX_RESULTS_PRESETS.map(p => ({ count: p.count })), DEFAULT_AUTOFILL_SEARCH_SETTINGS.maxResults)
    };
}

function getAutofillSearchSettings() {
    return autofillSearchSettings;
}

function getAutofillSearchDelayMs() {
    return autofillSearchSettings.searchDelayMs;
}

function isAutofillWikiPreviewsEnabled() {
    return autofillSearchSettings.enabled !== false && autofillSearchSettings.wikiPreviews !== false;
}

function applyAutofillSearchSettingsToClient(settings) {
    autofillSearchSettings = normalizeAutofillSearchSettingsClient(settings);
    if (typeof setAutofillEnabled === 'function') {
        setAutofillEnabled(autofillSearchSettings.enabled);
    }
    syncAutofillToggleButtons(autofillSearchSettings.enabled);
    if (typeof resetAutofillServicesConfigCache === 'function') {
        resetAutofillServicesConfigCache();
    }
}

function syncAutofillToggleButtons(isEnabled) {
    document.querySelectorAll('[data-action="autofill"]').forEach((btn) => {
        btn.setAttribute('data-state', isEnabled ? 'on' : 'off');
        const icon = btn.querySelector('i');
        if (icon) {
            icon.className = isEnabled ? 'fas fa-lightbulb' : 'fas fa-lightbulb-slash';
        }
    });
}

function getAutofillDelayPresetLabel(ms) {
    const hit = AUTOFILL_DELAY_PRESETS.find(p => p.ms === ms);
    return hit ? hit.label.replace(/\s*\([^)]*\)\s*$/, '').trim() : `${ms} ms`;
}

function getAutofillMaxResultsLabel(count) {
    const hit = AUTOFILL_MAX_RESULTS_PRESETS.find(p => p.count === count);
    return hit ? String(count) : String(count);
}

function beginAutofillSettingsDraft() {
    autofillSearchSettingsDraft = { ...autofillSearchSettings };
    autofillSearchSettingsDirty = false;
}

function getAutofillSettingsDraft() {
    if (!autofillSearchSettingsDraft) {
        beginAutofillSettingsDraft();
    }
    return autofillSearchSettingsDraft;
}

function markAutofillSettingsDraftDirty() {
    autofillSearchSettingsDirty = true;
}

function toggleAutofillSettingsDraftBool(key) {
    const draft = getAutofillSettingsDraft();
    draft[key] = !draft[key];
    if (key === 'enabled') {
        syncAutofillToggleButtons(draft.enabled);
    }
    markAutofillSettingsDraftDirty();
}

function setAutofillSettingsDraftValue(key, value) {
    const draft = getAutofillSettingsDraft();
    draft[key] = value;
    markAutofillSettingsDraftDirty();
}

async function loadAutofillSearchSettingsFromServer() {
    if (!window.wsClient || !window.wsClient.isConnected()) {
        applyAutofillSearchSettingsToClient(DEFAULT_AUTOFILL_SEARCH_SETTINGS);
        return autofillSearchSettings;
    }
    try {
        const resp = await window.wsClient.getUserGlobalSettings();
        const settings = resp?.settings?.autofillSearch || resp?.data?.settings?.autofillSearch;
        applyAutofillSearchSettingsToClient(settings || DEFAULT_AUTOFILL_SEARCH_SETTINGS);
        return autofillSearchSettings;
    } catch (err) {
        console.error('loadAutofillSearchSettingsFromServer:', err);
        applyAutofillSearchSettingsToClient(DEFAULT_AUTOFILL_SEARCH_SETTINGS);
        return autofillSearchSettings;
    }
}

async function saveAutofillSearchSettingsToServer(settings) {
    if (!window.wsClient || !window.wsClient.isConnected()) {
        return false;
    }
    const normalized = normalizeAutofillSearchSettingsClient(settings);
    try {
        await window.wsClient.updateUserGlobalSettings({ autofillSearch: normalized });
        applyAutofillSearchSettingsToClient(normalized);
        return true;
    } catch (err) {
        console.error('saveAutofillSearchSettingsToServer:', err);
        showGlassToast('error', 'SmartText', 'Failed to save search settings', false, 4000);
        return false;
    }
}

async function flushAutofillSettingsDraftIfDirty() {
    if (!autofillSearchSettingsDirty || !autofillSearchSettingsDraft) {
        autofillSearchSettingsDraft = null;
        return;
    }
    if (autofillSearchSettingsSavePromise) {
        await autofillSearchSettingsSavePromise;
        return;
    }
    const snapshot = normalizeAutofillSearchSettingsClient(autofillSearchSettingsDraft);
    autofillSearchSettingsSavePromise = saveAutofillSearchSettingsToServer(snapshot).finally(() => {
        autofillSearchSettingsSavePromise = null;
        autofillSearchSettingsDraft = null;
        autofillSearchSettingsDirty = false;
    });
    await autofillSearchSettingsSavePromise;
}

function buildAutofillSettingsToggleItem(key, text, icon) {
    return {
        icon: icon || 'fas fa-toggle-on',
        text: text,
        action: `autofill-setting-${key}`,
        keepMenuOpen: true,
        showIndicator: true,
        loadfn: (item) => {
            item.checked = getAutofillSettingsDraft()[key] === true;
        }
    };
}

function buildAutofillSettingsMenuSections() {
    const draft = getAutofillSettingsDraft();
    return [{
        type: 'list',
        items: [
            buildAutofillSettingsToggleItem('enabled', 'Enable SmartText', 'fas fa-lightbulb'),
            {
                icon: 'fas fa-wand-magic-sparkles',
                text: 'Show Detached Window',
                action: 'autofill-open-tool-window'
            },
            { separator: true },
            buildAutofillSettingsToggleItem('spellcheck', 'Spellcheck', 'fas fa-spell-check'),
            buildAutofillSettingsToggleItem('thesaurus', 'Thesaurus', 'fas fa-book'),
            { separator: true },
            buildAutofillSettingsToggleItem('naiAnimeTags', 'NAI Anime Tags', 'nai-sakura'),
            buildAutofillSettingsToggleItem('naiFurryTags', 'NAI Furry Tags', 'nai-paw'),
            { separator: true },
            buildAutofillSettingsToggleItem('dbAnimeTags', 'DB Anime Tags', 'fas fa-database'),
            buildAutofillSettingsToggleItem('dbFurryTags', 'DB Furry Tags', 'fas fa-database'),
            buildAutofillSettingsToggleItem('wikiPreviews', 'Wiki Previews', 'fas fa-book-open'),
            { separator: true },
            {
                icon: 'fas fa-clock',
                text: 'Delay before Search',
                valueDisplay: getAutofillDelayPresetLabel(draft.searchDelayMs),
                submenu: AUTOFILL_DELAY_PRESETS.map((preset) => ({
                    text: preset.label,
                    action: 'autofill-set-search-delay',
                    value: preset.ms,
                    keepMenuOpen: true,
                    showIndicator: true,
                    loadfn: (item) => {
                        item.checked = getAutofillSettingsDraft().searchDelayMs === preset.ms;
                    }
                }))
            },
            {
                icon: 'fas fa-list-ol',
                text: 'Max Results',
                valueDisplay: getAutofillMaxResultsLabel(draft.maxResults),
                submenu: AUTOFILL_MAX_RESULTS_PRESETS.map((preset) => ({
                    text: preset.label,
                    action: 'autofill-set-max-results',
                    value: preset.count,
                    keepMenuOpen: true,
                    showIndicator: true,
                    loadfn: (item) => {
                        item.checked = getAutofillSettingsDraft().maxResults === preset.count;
                    }
                }))
            }
        ]
    }];
}

function handleAutofillSettingsMenuAction(action, item) {
    if (action === 'autofill-open-tool-window') {
        // openAutofillToolWindow: public/scripts/comp/autocompleteUtils.js
        openAutofillToolWindow(null, { focusSearch: true });
        return true;
    }
    if (action === 'autofill-set-search-delay') {
        setAutofillSettingsDraftValue('searchDelayMs', Number(item.value));
        return true;
    }
    if (action === 'autofill-set-max-results') {
        setAutofillSettingsDraftValue('maxResults', Number(item.value));
        return true;
    }
    if (action.startsWith('autofill-setting-')) {
        const key = action.slice('autofill-setting-'.length);
        if (key in DEFAULT_AUTOFILL_SEARCH_SETTINGS && typeof DEFAULT_AUTOFILL_SEARCH_SETTINGS[key] === 'boolean') {
            toggleAutofillSettingsDraftBool(key);
            return true;
        }
    }
    return false;
}

function initAutofillSettingsContextMenu() {
    if (autofillSettingsMenuWired || !contextMenu) return;
    autofillSettingsMenuWired = true;
    document.querySelectorAll('[data-action="autofill"]').forEach((btn) => wireAutofillSettingsButton(btn));
}

function getAutofillSettingsMenuConfig() {
    return {
        maxHeight: true,
        sections: [],
        beforeShow: function () {
            beginAutofillSettingsDraft();
            this.sections = buildAutofillSettingsMenuSections();
        },
        onAction: function (action, target, item) {
            if (handleAutofillSettingsMenuAction(action, item)) {
                this.sections = buildAutofillSettingsMenuSections();
                if (contextMenu.isOpen && contextMenu.currentTarget === target) {
                    contextMenu.renderMenu(this, target);
                    contextMenu.updateIndicatorDots(this);
                }
            }
        },
        onHide: function () {
            void flushAutofillSettingsDraftIfDirty();
        }
    };
}

function wireAutofillSettingsButton(btn) {
    if (!btn || btn.dataset.contextMenu || !contextMenu) return;
    contextMenu.attachToElement(btn, getAutofillSettingsMenuConfig());
    btn.title = 'SmartText — click to toggle, right-click for search settings';
}

function initAutofillSearchSettings() {
    initAutofillSettingsContextMenu();
    return loadAutofillSearchSettingsFromServer();
}

async function patchAutofillSearchEnabled(enabled) {
    const next = normalizeAutofillSearchSettingsClient({
        ...autofillSearchSettings,
        enabled: !!enabled
    });
    applyAutofillSearchSettingsToClient(next);
    if (window.wsClient && window.wsClient.isConnected()) {
        try {
            await window.wsClient.updateUserGlobalSettings({ autofillSearch: { enabled: next.enabled } });
        } catch (err) {
            console.error('patchAutofillSearchEnabled:', err);
        }
    }
}

window.wireAutofillSettingsButton = wireAutofillSettingsButton;
window.getAutofillSearchSettings = getAutofillSearchSettings;
window.patchAutofillSearchEnabled = patchAutofillSearchEnabled;
window.getAutofillSearchDelayMs = getAutofillSearchDelayMs;
window.isAutofillWikiPreviewsEnabled = isAutofillWikiPreviewsEnabled;
window.loadAutofillSearchSettingsFromServer = loadAutofillSearchSettingsFromServer;

window.wsClient.registerInitStep(38, 'Loading SmartText settings', async () => {
    await initAutofillSearchSettings();
});
