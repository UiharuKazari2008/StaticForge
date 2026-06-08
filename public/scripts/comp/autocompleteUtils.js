// Overlay and list elements
const characterAutocompleteOverlay = document.getElementById('characterAutocompleteOverlay');
const characterAutocompleteList = document.querySelector('.character-autocomplete-list');

// State variables
let characterAutocompleteTimeout = null;
let currentCharacterAutocompleteTarget = null;
let selectedCharacterAutocompleteIndex = -1;
let autocompleteNavigationMode = false;
let autocompleteExpanded = false;
let characterSearchResults = [];
let userActivelyNavigating = false;
let selectedEnhancerGroupIndex = -1;
let lastSearchText = '';
const AUTOFILL_SEARCH_DEBOUNCE_MS = 120;
const AUTOFILL_SEARCH_CONTINUATION_DEBOUNCE_MS = 40;

// Spell check navigation state
let spellCheckNavigationMode = false;
let selectedSpellCheckWordIndex = -1;
let selectedSpellCheckSuggestionIndex = -1;

// Dictionary / thesaurus navigation state
let wordLookupNavigationMode = false;
let selectedWordLookupWordIndex = -1;
let selectedWordLookupSuggestionIndex = -1;
let activeWordLookupWordIndex = 0;

// Hover/wheel UX state (for popup overlay interaction)
let autocompleteWheelAccumulator = 0;
let isAutocompleteOverlayHovered = false;
const AUTOCOMPLETE_WHEEL_STEP_PX = 80;
const AUTOCOMPLETE_WHEEL_MAX_STEPS_PER_EVENT = 4;
// Coalesce selection scrolling while navigating quickly (prevents scroll jitter)
let pendingSelectionScrollRaf = 0;
let pendingSelectionScrollItem = null;
const AUTOCOMPLETE_SCROLL_MARGIN_PX = 12;
const AUTOFILL_WIKI_PREVIEW_REVEAL_MS = 700;
let autofillWikiPreviewRevealTimer = null;
let autofillWikiPreviewRevealIndex = -1;

function isCharacterAutocompleteOverlayOpen() {
    return characterAutocompleteOverlay && !characterAutocompleteOverlay.classList.contains('hidden');
}

/** Autofill feature keys for data-autofill-enable / data-autofill-disable on inputs */
const AUTOFILL_FEATURE_ALIASES = {
    tags: 'tags',
    tag: 'tags',
    characters: 'characters',
    character: 'characters',
    expanders: 'expanders',
    textreplacements: 'expanders',
    textreplacement: 'expanders',
    spellcheck: 'spellcheck',
    spell: 'spellcheck',
    thesaurus: 'thesaurus',
    wordlookup: 'thesaurus',
    dictionary: 'thesaurus',
    dynamic: 'dynamicPlaceholders',
    dynamicplaceholders: 'dynamicPlaceholders',
    single: 'singleToken',
    singletoken: 'singleToken'
};

const DEFAULT_AUTOFILL_CONFIG = {
    tags: true,
    characters: true,
    expanders: true,
    spellcheck: true,
    thesaurus: true,
    dynamicPlaceholders: true,
    singleToken: false
};

const autofillConfigCache = new WeakMap();

function normalizeAutofillFeatureName(raw) {
    if (!raw || typeof raw !== 'string') return null;
    const key = raw.trim().toLowerCase();
    if (!key) return null;
    return AUTOFILL_FEATURE_ALIASES[key] || null;
}

function parseAutofillFeatureList(raw) {
    if (!raw || typeof raw !== 'string') return [];
    return raw.split(',').map(normalizeAutofillFeatureName).filter(Boolean);
}

function getAutofillConfig(target) {
    if (!target) return { ...DEFAULT_AUTOFILL_CONFIG };

    const enableRaw = target.dataset ? target.dataset.autofillEnable : '';
    const disableRaw = target.dataset ? target.dataset.autofillDisable : '';
    const legacyTagInput = !!(target.classList && target.classList.contains('autofill-tag-input'));
    const cacheKey = (enableRaw || '') + '|' + (disableRaw || '') + '|' + (legacyTagInput ? '1' : '0');
    const cached = autofillConfigCache.get(target);
    if (cached && cached.cacheKey === cacheKey) {
        return cached.config;
    }

    let config = { ...DEFAULT_AUTOFILL_CONFIG };

    if (enableRaw) {
        config = {
            tags: false,
            characters: false,
            expanders: false,
            spellcheck: false,
            thesaurus: false,
            dynamicPlaceholders: false,
            singleToken: false
        };
        parseAutofillFeatureList(enableRaw).forEach(function (feature) {
            config[feature] = true;
        });
    } else if (disableRaw) {
        parseAutofillFeatureList(disableRaw).forEach(function (feature) {
            config[feature] = false;
        });
    } else if (legacyTagInput) {
        config = {
            tags: true,
            characters: false,
            expanders: false,
            spellcheck: false,
            thesaurus: false,
            dynamicPlaceholders: false,
            singleToken: true
        };
    }

    autofillConfigCache.set(target, { cacheKey: cacheKey, config: config });
    return config;
}

function isAutofillFeatureEnabled(target, feature) {
    return !!getAutofillConfig(target)[feature];
}

function isAutofillSingleToken(target) {
    return isAutofillFeatureEnabled(target, 'singleToken');
}

function isAutofillTagsOnlyMode(config) {
    return config.tags && !config.characters && !config.expanders && !config.spellcheck && !config.thesaurus && !config.dynamicPlaceholders;
}

function filterAutofillDisplayResults(results, config) {
    const allowed = new Set();
    if (config.tags) allowed.add('tag');
    if (config.characters) allowed.add('character');
    if (config.expanders) allowed.add('textReplacement');
    if (config.dynamicPlaceholders) allowed.add('dynamicPlaceholder');

    return results.filter(function (result) {
        if (result.type === 'spellcheck' || result.type === 'wordLookup') return false;
        return allowed.has(result.type);
    });
}

function isAutofillTarget(target) {
    if (!target) return false;
    if (target.dataset && (target.dataset.autofillEnable || target.dataset.autofillDisable)) return true;
    if (target.classList && target.classList.contains('autofill-tag-input')) return true;
    return target.classList.contains('prompt-textarea') || target.classList.contains('character-prompt-textarea');
}

function handleAutocompleteOverlayWheel(e) {
    if (!isCharacterAutocompleteOverlayOpen()) return;
    if (!characterAutocompleteList) return;
    if (!isAutocompleteOverlayHovered) return;

    // Per UX request: wheel navigates only the main results list.
    // If spell-check or dictionary navigation is active, switch back to the main list.
    if (spellCheckNavigationMode || wordLookupNavigationMode) {
        spellCheckNavigationMode = false;
        wordLookupNavigationMode = false;
        selectedSpellCheckWordIndex = -1;
        selectedSpellCheckSuggestionIndex = -1;
        selectedWordLookupWordIndex = -1;
        selectedWordLookupSuggestionIndex = -1;
        updateSpellCheckSelection();
        updateWordLookupSelection();
    }

    const deltaY = typeof e.deltaY === 'number' ? e.deltaY : 0;
    const deltaX = typeof e.deltaX === 'number' ? e.deltaX : 0;
    if (Math.abs(deltaY) < 1 || Math.abs(deltaY) < Math.abs(deltaX)) return;

    // Prevent the page/container from scrolling; we will drive list scrolling via selection updates.
    e.preventDefault();
    e.stopPropagation();

    autocompleteWheelAccumulator += deltaY;
    let steps = 0;

    while (Math.abs(autocompleteWheelAccumulator) >= AUTOCOMPLETE_WHEEL_STEP_PX && steps < AUTOCOMPLETE_WHEEL_MAX_STEPS_PER_EVENT) {
        const isDown = autocompleteWheelAccumulator > 0;
        autocompleteWheelAccumulator = isDown
            ? autocompleteWheelAccumulator - AUTOCOMPLETE_WHEEL_STEP_PX
            : autocompleteWheelAccumulator + AUTOCOMPLETE_WHEEL_STEP_PX;

        steps++;

        // Mirror ArrowDown/ArrowUp behavior for main list navigation.
        markAutofillOverlayInteractive();
        autocompleteNavigationMode = true;
        userActivelyNavigating = true;

        const items = getAutocompleteResultItems();
        if (!items || items.length === 0) continue;

        if (isDown) {
            if (selectedCharacterAutocompleteIndex === -1) {
                expandAutocompleteInstantly();

                const updatedItems = getAutocompleteResultItems();
                selectedCharacterAutocompleteIndex = updatedItems.length > 0 ? 0 : -1;
            } else {
                selectedCharacterAutocompleteIndex = Math.min(selectedCharacterAutocompleteIndex + 1, items.length - 1);
            }

            updateCharacterAutocompleteSelection();
            updateEmphasisTooltipVisibility();
        } else {
            if (selectedCharacterAutocompleteIndex === -1) continue;
            selectedCharacterAutocompleteIndex = Math.max(selectedCharacterAutocompleteIndex - 1, -1);
            updateCharacterAutocompleteSelection();
            updateEmphasisTooltipVisibility();
        }

        clearTimeout(window.navigationTimeout);
        window.navigationTimeout = setTimeout(() => {
            userActivelyNavigating = false;
        }, 500);
    }
}

// Wire up UX handlers for the popup overlay.
if (characterAutocompleteOverlay) {
    characterAutocompleteOverlay.addEventListener('mouseenter', () => {
        isAutocompleteOverlayHovered = true;
    });
    characterAutocompleteOverlay.addEventListener('mouseleave', () => {
        isAutocompleteOverlayHovered = false;
        autocompleteWheelAccumulator = 0;
    });
    characterAutocompleteOverlay.addEventListener('wheel', handleAutocompleteOverlayWheel, { passive: false });
}

// Realtime search state
let searchServices = new Map(); // Track service status
let currentSearchRequestId = null;
let isSearching = false;
let allSearchResults = []; // Combined and ordered results
let contextMenuThesaurusLookupActive = false;

// Global variables for real-time search tracking
let currentSearchTimestamp = null;
let serviceResults = new Map(); // Store results per service
let searchStatusHideTimeout = null;
const SEARCH_STATUS_DONE_VISIBLE_MS = 5000;

function clearSearchStatusHideTimer() {
    if (searchStatusHideTimeout) {
        clearTimeout(searchStatusHideTimeout);
        searchStatusHideTimeout = null;
    }
}

function scheduleSearchStatusHide() {
    clearSearchStatusHideTimer();
    searchStatusHideTimeout = setTimeout(() => {
        searchStatusHideTimeout = null;
        const statusDisplay = characterAutocompleteList?.querySelector('.search-status-display');
        if (statusDisplay) {
            statusDisplay.classList.add('hidden');
        }
    }, SEARCH_STATUS_DONE_VISIBLE_MS);
}

// Global handler for ack-less search responses
window.handleSearchResponse = function (message) {
    if (!autofillSessionId) {
        return;
    }

    if (message.type === 'search_characters_response') {
        if (!currentSearchRequestId) {
            return;
        }
        if (!acknowledgeAutofillSessionPacket(message)) {
            return;
        }

        // Initial response - search started; keep existing service statuses from initializeAutofillServices
        currentSearchTimestamp = Date.now();

        if (currentCharacterAutocompleteTarget && (contextMenuThesaurusLookupActive || hasActiveAutofillSessionForTarget(currentCharacterAutocompleteTarget))) {
            updateSearchStatusDisplay();
        }
    } else if (message.type === 'search_results_complete') {
        if (!currentSearchRequestId) {
            return;
        }
        if (!acknowledgeAutofillSessionPacket(message)) {
            return;
        }

        searchCompletionStatus = {
            totalServices: message.totalServices || 0,
            completedServices: message.completedServices || 0,
            isComplete: true
        };

        // Tag API + local streams finished; characters/spellcheck/textReplacements may still be in flight
        if (!contextMenuThesaurusLookupActive) {
            scheduleRebuildAndDisplayResults();
        }
    } else if (message.type === 'search_characters_complete') {
        if (!currentSearchRequestId) {
            return;
        }
        if (!acknowledgeAutofillSessionPacket(message)) {
            return;
        }

        if (message.data && message.data.results) {
            const resultsByService = new Map();
            message.data.results.forEach(result => {
                let serviceName = result.serviceName || result.model || 'unknown';

                if (serviceName === 'unknown' && result.model) {
                    if (result.model.includes('nai-diffusion-')) {
                        serviceName = result.model;
                    } else if (result.model.includes('v4_5')) {
                        serviceName = 'v4_5';
                    } else if (result.type === 'character') {
                        serviceName = 'characters';
                    } else if (result.type === 'textReplacement') {
                        serviceName = 'textReplacements';
                    } else {
                        serviceName = result.model;
                    }
                } else if (isLocalTagResult(result)) {
                    serviceName = result.model || result.serviceName || ANIME_LOCAL_SERVICE;
                }

                if (!resultsByService.has(serviceName)) {
                    resultsByService.set(serviceName, []);
                }
                resultsByService.get(serviceName).push(result);
            });

            for (const [serviceName, results] of resultsByService) {
                if (Array.isArray(results) && results.length > 0) {
                    serviceResults.set(serviceName, results);
                }
            }
        }

        // Mark services completed; preserve empty-result status where already known
        const serviceNames = ['characters', ANIME_LOCAL_SERVICE, FURRY_LOCAL_SERVICE, 'textReplacements', 'spellcheck', 'wordLookup'];
        for (const serviceName of serviceNames) {
            const existingResults = serviceResults.get(serviceName);
            const existingStatus = searchServices.get(serviceName);
            if (existingStatus === 'completed' || existingStatus === 'completed-noerrors') {
                continue;
            }
            if (!existingResults || existingResults.length === 0) {
                searchServices.set(serviceName, 'completed-none');
            } else {
                searchServices.set(serviceName, 'completed');
            }
        }

        const currentModel = getMappedManualModel();
        const modelResults = serviceResults.get(currentModel);
        if (!modelResults || modelResults.length === 0) {
            searchServices.set(currentModel, 'completed-none');
        } else {
            searchServices.set(currentModel, 'completed');
        }

        if (!contextMenuThesaurusLookupActive) {
            scheduleRebuildAndDisplayResults(() => {
                finalizeSearchServiceStatuses();
                updateSearchStatusDisplay();
                markSearchSessionCompleteIfIdle();
            });
        } else {
            finalizeSearchServiceStatuses();
            updateSearchStatusDisplay();
            markSearchSessionCompleteIfIdle();
        }
    } else if (message.type === 'search_results_update') {
        // Real-time result update from a specific service
        if (!currentSearchRequestId) {
            return;
        }

        const serviceName = message.service;
        const results = message.results || [];
        const isComplete = message.isComplete || false;
        const mergeBodyPreviews = message.mergeBodyPreviews === true;

        // Wiki body merges are session-scoped enrichment — do not require the active request id.
        if (mergeBodyPreviews) {
            if (!autofillSessionId) {
                return;
            }
            const packetSessionId = message.autofillSessionId || null;
            if (packetSessionId && packetSessionId !== autofillSessionId) {
                return;
            }
            applyServiceResultsUpdate(serviceName, results, { mergeBodyPreviews: true });
            refreshAutofillWikiPreviewDom();
            requestAutofillWikiPreviewsForSession();
            return;
        }

        if (!acknowledgeAutofillSessionPacket(message)) {
            return;
        }

        applyServiceResultsUpdate(serviceName, results, {
            mergeBodyPreviews: false
        });

        if (serviceName === 'spellcheck') {
            if (results.length > 0) {
                const sc = results[0];
                if (sc.data && sc.data.hasErrors && sc.data.misspelled && sc.data.misspelled.length > 0) {
                    searchServices.set('spellcheck', 'completed');
                } else {
                    searchServices.set('spellcheck', 'completed-noerrors');
                    persistentSpellCheckData = null;
                }
            } else {
                searchServices.set('spellcheck', 'completed-none');
                persistentSpellCheckData = null;
            }
        } else if (serviceName === 'wordLookup') {
            if (results.length > 0) {
                const wl = results[0];
                if (wl.data && wl.data.hasData) {
                    searchServices.set('wordLookup', 'completed');
                    persistentWordLookupData = wl.data;
                } else {
                    searchServices.set('wordLookup', 'completed-none');
                    persistentWordLookupData = null;
                    activeWordLookupWordIndex = 0;
                }
            } else {
                searchServices.set('wordLookup', 'completed-none');
                persistentWordLookupData = null;
                activeWordLookupWordIndex = 0;
            }
        } else if (results.length === 0) {
            searchServices.set(serviceName, 'completed-none');
        } else {
            if (isComplete) {
                searchServices.set(serviceName, 'completed');
            } else {
                searchServices.set(serviceName, 'searching');
            }
        }

        updateSearchStatusDisplay();
        if (currentCharacterAutocompleteTarget && isAutofillSessionForTarget(currentCharacterAutocompleteTarget)) {
            if (serviceName === 'spellcheck' || serviceName === 'wordLookup') {
                refreshAutofillSideSections(currentCharacterAutocompleteTarget);
            } else {
                scheduleRebuildAndDisplayResults();
            }
        }
    } else if (message.type === 'search_status_update') {
        if (!currentSearchRequestId) {
            return;
        }

        if (!isValidAutofillSearchPacket(message)) {
            return;
        }

        // Service status update
        const services = message.services || [];

        services.forEach(service => {
            const serviceName = service.name;
            const status = service.status;

            // Update service status
            if (status === 'searching' || status === 'stalled') {
                searchServices.set(serviceName, status);
            } else if (status === 'completed') {
                searchServices.set(serviceName, 'completed');
            } else if (status === 'completed-none' || status === 'completed-noerrors' || status === 'completed-noresults') {
                searchServices.set(serviceName, status);
            } else if (status === 'error') {
                searchServices.set(serviceName, 'error');
            }
        });

        updateSearchStatusDisplay();
    }
};
let searchCompletionStatus = {
    totalServices: 0,
    completedServices: 0,
    isComplete: false
};

// Search request tracking to prevent multiple simultaneous searches
let currentSearchQuery = '';
let currentSearchTimeout = null;
let currentSearchSessionBounds = null;

// Persistent results storage for stable autocomplete
let persistentSpellCheckData = null; // Current spell check data
let persistentWordLookupData = null; // Current dictionary / thesaurus data
let isAutocompleteVisible = false; // Track if autocomplete is currently visible

// Track last search query to prevent unnecessary clearing
let lastSearchQuery = '';

// Track whether services have been initialized for the current autofill session
let servicesInitialized = false;

// Strict autofill session: overlay may only show while session is active and a server packet has arrived.
let autofillSessionId = null;
let autofillSessionTarget = null;
let autofillSessionPacketRequestId = null;
let autofillLastCaretPos = -1;
let autofillLastCaretTime = 0;
let autofillCaretFastUntil = 0;
let autofillInputRaf = 0;
let autofillInputPendingEvent = null;
let autofillSelectionRaf = 0;
let autofillLastInputTime = 0;
let autofillLastCtrlKeydownTime = 0;
let autofillOverlayAcceptInFlight = false;
/** Per-keystroke cache — getAutocompleteSearchBounds is called many times per input event. */
let autofillSearchBoundsCache = null;
/** Tag DB ids already sent to fetch_autofill_wiki_previews this autofill session. */
let autofillWikiPreviewRequestedTagIds = new Set();
let autofillSearchWatchdogTimer = null;
const AUTOFILL_SEARCH_WATCHDOG_MS = 15000;
const AUTOFILL_CARET_SPEED_CHARS_PER_MS = 0.45;
const AUTOFILL_CARET_FAST_COOLDOWN_MS = 320;
const AUTOFILL_DOUBLE_CTRL_MS = 400;

function resetAutofillServicesConfigCache() {
    servicesInitialized = false;
    currentAutofillServicesConfigKey = null;
}

function getEffectiveAutofillConfig(target) {
    const base = getAutofillConfig(target);
    // getAutofillSearchSettings: public/scripts/comp/autofillSettings.js
    const server = typeof getAutofillSearchSettings === 'function'
        ? getAutofillSearchSettings()
        : null;
    if (!server || server.enabled === false) {
        return {
            ...base,
            tags: false,
            characters: false,
            expanders: false,
            spellcheck: false,
            thesaurus: false,
            dynamicPlaceholders: false
        };
    }
    const tagsEnabled = (server.naiAnimeTags || server.naiFurryTags || server.dbAnimeTags || server.dbFurryTags) && base.tags;
    return {
        ...base,
        tags: tagsEnabled,
        spellcheck: server.spellcheck !== false && base.spellcheck,
        thesaurus: server.thesaurus !== false && base.thesaurus
    };
}

function getAutofillSearchDebounceMs(isContinuation) {
    const custom = typeof getAutofillSearchDelayMs === 'function' ? getAutofillSearchDelayMs() : null;
    if (typeof custom === 'number' && custom >= 0) {
        return isContinuation ? Math.max(0, Math.min(custom, 80)) : custom;
    }
    return isContinuation ? AUTOFILL_SEARCH_CONTINUATION_DEBOUNCE_MS : AUTOFILL_SEARCH_DEBOUNCE_MS;
}

function isCaretMovingTooFastForAutofill() {
    return Date.now() < autofillCaretFastUntil;
}

function trackAutofillCaretMotion(target) {
    if (!target || typeof target.selectionStart !== 'number') return;
    if (Date.now() - autofillLastInputTime < 100) {
        return;
    }
    const pos = target.selectionStart;
    const now = Date.now();
    if (autofillLastCaretTime > 0 && autofillLastCaretPos >= 0) {
        const dt = now - autofillLastCaretTime;
        if (dt > 0 && dt < 220) {
            const speed = Math.abs(pos - autofillLastCaretPos) / dt;
            if (speed >= AUTOFILL_CARET_SPEED_CHARS_PER_MS) {
                autofillCaretFastUntil = now + AUTOFILL_CARET_FAST_COOLDOWN_MS;
            }
        }
    }
    autofillLastCaretPos = pos;
    autofillLastCaretTime = now;
}

function isAutofillSessionForTarget(target) {
    if (!autofillSessionId || !target || autofillSessionTarget !== target) return false;
    if (!currentCharacterAutocompleteTarget || currentCharacterAutocompleteTarget !== target) return false;
    if (document.activeElement !== target) return false;
    return true;
}

function hasActiveAutofillSessionForTarget(target) {
    return isAutofillSessionForTarget(target);
}

function shouldShowAutofillResultsForTarget(target) {
    if (contextMenuThesaurusLookupActive) return false;
    return hasActiveAutofillSessionForTarget(target);
}

function ensureAutofillSession(target, explicit) {
    if (!target || !autofillEnabled) return false;
    if (document.activeElement !== target) return false;

    if (!autofillSessionId || autofillSessionTarget !== target) {
        autofillSessionId = 'af_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        autofillSessionPacketRequestId = null;
        autofillWikiPreviewRequestedTagIds.clear();
    }

    autofillSessionTarget = target;
    currentSearchSessionBounds = getAutocompleteSearchBounds(target);
    return !!currentSearchSessionBounds;
}

function isValidAutofillSearchPacket(message) {
    if (!autofillSessionId || !currentSearchRequestId) return false;
    const requestId = message && message.requestId ? message.requestId : null;
    if (!requestId || requestId !== currentSearchRequestId) return false;
    const packetSessionId = message && message.autofillSessionId ? message.autofillSessionId : null;
    if (packetSessionId && packetSessionId !== autofillSessionId) return false;
    return true;
}

function acknowledgeAutofillSessionPacket(message) {
    if (!isValidAutofillSearchPacket(message)) return false;
    if (!currentCharacterAutocompleteTarget) return false;

    autofillSessionPacketRequestId = currentSearchRequestId;
    clearAutofillSearchWatchdog();
    return true;
}

function hasSearchServicesInFlight() {
    for (const [, status] of searchServices) {
        if (status === 'searching') {
            return true;
        }
    }
    return false;
}

function finalizeSearchServiceStatuses() {
    for (const [serviceName, status] of searchServices) {
        if (status !== 'searching' && status !== 'stalled') {
            continue;
        }
        const results = serviceResults.get(serviceName);
        if (results && results.length > 0) {
            searchServices.set(serviceName, 'completed');
        } else {
            searchServices.set(serviceName, 'completed-none');
        }
    }
}

function applyServiceResultsUpdate(serviceName, results, options = {}) {
    if (!serviceName) return;
    const incoming = Array.isArray(results) ? results : [];
    if (options.mergeBodyPreviews) {
        const existing = serviceResults.get(serviceName) || [];
        const byKey = new Map();
        for (const item of existing) {
            const key = item.id != null ? `id:${item.id}` : `name:${item.name || ''}`;
            byKey.set(key, item);
        }
        for (const item of incoming) {
            const key = item.id != null ? `id:${item.id}` : `name:${item.name || ''}`;
            const prev = byKey.get(key);
            if (prev) {
                if (item.primaryBody) {
                    prev.primaryBody = item.primaryBody;
                }
            } else {
                byKey.set(key, item);
            }
        }
        serviceResults.set(serviceName, [...byKey.values()]);
        return;
    }
    serviceResults.set(serviceName, incoming);
}

function markSearchSessionCompleteIfIdle() {
    if (hasSearchServicesInFlight()) {
        return;
    }
    markSearchSessionComplete();
}

function hasAutofillResultsInCache() {
    for (const [, results] of serviceResults) {
        if (results && results.length > 0) return true;
    }
    return allSearchResults.length > 0;
}

function canShowAutofillOverlay(target) {
    if (!hasActiveAutofillSessionForTarget(target)) return false;
    if (!currentSearchRequestId) return false;
    if (autofillSessionPacketRequestId === currentSearchRequestId) return true;
    if (isSearching || hasSearchServicesInFlight()) return true;
    return hasAutofillResultsInCache();
}

function clearAutofillSessionState() {
    autofillSessionId = null;
    autofillSessionTarget = null;
    autofillSessionPacketRequestId = null;
}

function showAutofillLoadingShell(target) {
    if (!characterAutocompleteOverlay || !hasActiveAutofillSessionForTarget(target)) return;

    const rect = target.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - 5;
    const maxHeight = Math.min(400, spaceBelow, window.innerHeight * 0.6);

    characterAutocompleteOverlay.style.left = rect.left + 'px';
    characterAutocompleteOverlay.style.top = (rect.bottom + 5) + 'px';
    characterAutocompleteOverlay.style.width = rect.width + 'px';
    characterAutocompleteOverlay.style.maxHeight = maxHeight + 'px';
    characterAutocompleteOverlay.classList.remove('hidden');
    isAutocompleteVisible = true;
    requestAutofillWikiPreviewsForSession();
}

function shouldDismissAutofillFromClick(event) {
    if (!event || !event.target) return true;
    const target = event.target;
    if (characterAutocompleteOverlay && characterAutocompleteOverlay.contains(target)) {
        return false;
    }
    if (isAutofillTarget(target)) {
        return false;
    }
    if (target.closest && target.closest('#characterAutocompleteOverlay')) {
        return false;
    }
    return true;
}

function getAutofillWikiPreviewTagId(result) {
    if (!result || !isTagResult(result)) return null;
    const local = result.localResult || null;
    const raw = (local && local.id != null) ? local.id : result.id;
    const id = Number(raw);
    return id > 0 ? id : null;
}

function collectAutofillWikiPreviewTagIds() {
    const ids = [];
    const seen = new Set();
    for (const [, results] of serviceResults) {
        if (!results || !Array.isArray(results)) continue;
        for (const result of results) {
            if (!isTagResult(result) || !result.hasWiki) continue;
            if (getTagPrimaryBodyPreview(result)) continue;
            const id = getAutofillWikiPreviewTagId(result);
            if (id == null || seen.has(id)) continue;
            seen.add(id);
            ids.push(id);
        }
    }
    const maxResults = typeof getAutofillSearchSettings === 'function'
        ? (getAutofillSearchSettings().maxResults || 35)
        : 35;
    return ids.slice(0, maxResults);
}

function requestAutofillWikiPreviewsForSession(extraTagIds, options) {
    if (typeof isAutofillWikiPreviewsEnabled === 'function' && !isAutofillWikiPreviewsEnabled()) {
        return;
    }
    if (!autofillSessionId || !currentSearchRequestId) return;

    const forceIds = options && options.force ? new Set((extraTagIds || []).map(id => Number(id)).filter(id => id > 0)) : null;
    const pendingIds = collectAutofillWikiPreviewTagIds();
    const candidateIds = [...pendingIds];
    if (Array.isArray(extraTagIds)) {
        for (const rawId of extraTagIds) {
            const id = Number(rawId);
            if (id > 0 && !candidateIds.includes(id)) {
                candidateIds.push(id);
            }
        }
    }

    const tagIds = [];
    for (const rawId of candidateIds) {
        const id = Number(rawId);
        if (!(id > 0)) continue;
        if (forceIds && forceIds.has(id)) {
            tagIds.push(id);
            continue;
        }
        if (autofillWikiPreviewRequestedTagIds.has(id)) continue;
        tagIds.push(id);
    }
    if (!tagIds.length) return;

    const maxResults = typeof getAutofillSearchSettings === 'function'
        ? (getAutofillSearchSettings().maxResults || 35)
        : 35;
    const batch = tagIds.slice(0, maxResults);
    for (const id of batch) {
        autofillWikiPreviewRequestedTagIds.add(id);
    }

    if (window.wsClient && window.wsClient.fetchAutofillWikiPreviews) {
        window.wsClient.fetchAutofillWikiPreviews(batch, {
            requestId: currentSearchRequestId,
            autofillSessionId: autofillSessionId,
            model: manualModel?.value || 'v4_5'
        });
    }
}

function clearAutofillWikiPreviewReveal() {
    if (autofillWikiPreviewRevealTimer) {
        clearTimeout(autofillWikiPreviewRevealTimer);
        autofillWikiPreviewRevealTimer = null;
    }
    autofillWikiPreviewRevealIndex = -1;
    if (characterAutocompleteList) {
        characterAutocompleteList.querySelectorAll('.character-autocomplete-item.wiki-preview-revealed').forEach(function (item) {
            item.classList.remove('wiki-preview-revealed');
        });
    }
}

function scheduleAutofillWikiPreviewReveal(item, listIndex) {
    clearAutofillWikiPreviewReveal();
    if (!item || listIndex < 0) {
        return;
    }
    autofillWikiPreviewRevealIndex = listIndex;
    autofillWikiPreviewRevealTimer = setTimeout(function () {
        autofillWikiPreviewRevealTimer = null;
        if (selectedCharacterAutocompleteIndex !== listIndex) {
            return;
        }
        const items = getAutocompleteResultItems();
        const current = items[listIndex];
        if (!current || current !== item) {
            return;
        }
        current.classList.add('wiki-preview-revealed');
        requestAutofillWikiPreviewsForSelectedItem();
        requestAnimationFrame(function () {
            updateTagWikiPreviewScroll(current);
        });
    }, AUTOFILL_WIKI_PREVIEW_REVEAL_MS);
}

function requestAutofillWikiPreviewsForSelectedItem() {
    if (!characterAutocompleteList || selectedCharacterAutocompleteIndex < 0) return;
    const items = getAutocompleteResultItems();
    const selected = items[selectedCharacterAutocompleteIndex];
    if (!selected || selected.dataset.hasWikiPending !== 'true') return;
    const tagId = selected.dataset.tagId ? Number(selected.dataset.tagId) : 0;
    if (!(tagId > 0)) return;
    requestAutofillWikiPreviewsForSession([tagId], { force: true });
}

function resetAutofillWikiPreviewSessionState() {
    autofillWikiPreviewRequestedTagIds.clear();
}

window.resetAutofillServicesConfigCache = resetAutofillServicesConfigCache;
window.shouldDismissAutofillFromClick = shouldDismissAutofillFromClick;

function onAutofillSearchRequestStarted(requestId) {
    autofillSessionPacketRequestId = null;
    autofillWikiPreviewRequestedTagIds.clear();
    if (autofillSearchWatchdogTimer) {
        clearTimeout(autofillSearchWatchdogTimer);
        autofillSearchWatchdogTimer = null;
    }
    if (requestId) {
        autofillSearchWatchdogTimer = setTimeout(function () {
            autofillSearchWatchdogTimer = null;
            if (currentSearchRequestId !== requestId || !isSearching) {
                return;
            }
            if (autofillSessionPacketRequestId === requestId) {
                return;
            }
            isSearching = false;
            finalizeSearchServiceStatuses();
            updateSearchStatusDisplay();
        }, AUTOFILL_SEARCH_WATCHDOG_MS);
    }
}

function clearAutofillSearchWatchdog() {
    if (autofillSearchWatchdogTimer) {
        clearTimeout(autofillSearchWatchdogTimer);
        autofillSearchWatchdogTimer = null;
    }
}

function handleAutofillSelectionChange() {
    if (!autofillSessionId) return;
    const target = document.activeElement;
    if (!target || target.type !== 'textarea') return;
    if (!target.classList.contains('prompt-textarea') && !target.classList.contains('character-prompt-textarea')) {
        return;
    }
    if (autofillSessionTarget !== target) return;

    if (autofillSelectionRaf) return;
    autofillSelectionRaf = requestAnimationFrame(() => {
        autofillSelectionRaf = 0;
        processAutofillSelectionChange();
    });
}

function processAutofillSelectionChange() {
    const target = document.activeElement;
    if (!target || target.type !== 'textarea') return;
    if (!target.classList.contains('prompt-textarea') && !target.classList.contains('character-prompt-textarea')) {
        return;
    }
    // isTextInputComposing: public/scripts/comp/textareaUtils.js
    if (typeof isTextInputComposing === 'function' && isTextInputComposing(target)) {
        return;
    }
    // selectionchange fires on every cursor move — skip when autofill is not active on this field
    if (!autofillSessionId || autofillSessionTarget !== target) {
        return;
    }

    trackAutofillCaretMotion(target);

    if (isCaretMovingTooFastForAutofill()) {
        return;
    }

    // Don't abort overlay while keyboard-navigating spell-check, dictionary, or autocomplete results.
    if (spellCheckNavigationMode || wordLookupNavigationMode || autocompleteNavigationMode || selectedCharacterAutocompleteIndex >= 0) {
        return;
    }

    if (autofillSessionId && autofillSessionTarget === target) {
        if (shouldAbortAutocompleteSearchSession()) {
            hideCharacterAutocomplete();
        }
    }
}

document.addEventListener('selectionchange', handleAutofillSelectionChange);
document.addEventListener('beforeinput', handleCharacterAutocompleteBeforeinput, true);

function getAutocompleteSearchBounds(target) {
    if (!target || typeof target.value !== 'string') return null;
    if (typeof target.selectionStart !== 'number') return null;

    const value = target.value;
    const cursorPosition = target.selectionStart;
    if (autofillSearchBoundsCache
        && autofillSearchBoundsCache.target === target
        && autofillSearchBoundsCache.value === value
        && autofillSearchBoundsCache.selectionStart === cursorPosition) {
        return autofillSearchBoundsCache.bounds;
    }

    if (isAutofillSingleToken(target)) {
        const trimmed = value.trim();
        const bounds = {
            tokenStart: 0,
            tokenEnd: value.length,
            query: trimmed,
            spellCheckText: trimmed,
            isTextPrefix: false,
            isSingleTagInput: true
        };
        autofillSearchBoundsCache = { target, value, selectionStart: cursorPosition, bounds };
        return bounds;
    }

    const safeCursor = Math.max(0, Math.min(cursorPosition, value.length));
    const textBeforeCursor = value.substring(0, safeCursor);

    const textPrefixIndex = textBeforeCursor.lastIndexOf('Text:');
    if (textPrefixIndex >= 0) {
        const tokenStart = textPrefixIndex + 5;
        const spellCheckText = value.substring(tokenStart, value.length).trim();
        const bounds = {
            tokenStart,
            tokenEnd: value.length,
            query: 'Text:' + value.substring(tokenStart, safeCursor).trim(),
            spellCheckText: spellCheckText,
            isTextPrefix: true
        };
        autofillSearchBoundsCache = { target, value, selectionStart: cursorPosition, bounds };
        return bounds;
    }

    let tokenStart = findAutocompleteTermStart(textBeforeCursor);
    const tokenEnd = findAutocompleteTermEnd(value, safeCursor);
    if (textBeforeCursor.includes('::')) {
        const emphOpenEnd = getEmphasisOpenEndBeforeCursor(value, safeCursor);
        if (emphOpenEnd != null) {
            tokenStart = Math.max(tokenStart, emphOpenEnd);
        }
    }
    const termSlice = value.substring(tokenStart, tokenEnd);
    const leadingTrim = termSlice.length - termSlice.trimStart().length;
    const spellCheckTermOffset = tokenStart + leadingTrim;
    let query = termSlice.trim();
    let spellCheckText = query;

    if (query.startsWith('<')) {
        // Keep < for replacement lookups.
    } else {
        const lastLessThanIndex = termSlice.lastIndexOf('<');
        if (lastLessThanIndex >= 0) {
            query = termSlice.substring(lastLessThanIndex).trim();
            spellCheckText = query;
        }
    }

    const bounds = {
        tokenStart,
        tokenEnd,
        spellCheckTermOffset,
        query,
        spellCheckText,
        isTextPrefix: false
    };
    autofillSearchBoundsCache = { target, value, selectionStart: cursorPosition, bounds };
    return bounds;
}

function getWordRangesInSpan(text) {
    const ranges = [];
    const re = /\S+/g;
    let match;
    while ((match = re.exec(text)) !== null) {
        ranges.push({
            start: match.index,
            end: match.index + match[0].length,
            word: match[0]
        });
    }
    return ranges;
}

/** Active autofill query string — the literal text the user typed for this search, not tokenized. */
function getAutofillActiveQueryText(bounds) {
    if (!bounds) return '';
    const liveQuery = bounds.query != null ? String(bounds.query) : '';
    if (currentSearchSessionBounds
        && currentSearchSessionBounds.tokenStart === bounds.tokenStart
        && currentSearchQuery) {
        if (!liveQuery
            || liveQuery === currentSearchQuery
            || liveQuery.startsWith(currentSearchQuery)
            || currentSearchQuery.startsWith(liveQuery)) {
            return currentSearchQuery;
        }
    }
    if (lastSearchQuery && liveQuery && (liveQuery === lastSearchQuery || liveQuery.startsWith(lastSearchQuery))) {
        return lastSearchQuery;
    }
    return liveQuery;
}

/**
 * Character range of the user's actual typed input for the active autofill term.
 * Matches bounds.query / session query against the textarea slice — not abstract tokens.
 */
function resolveTypedInputReplaceRange(value, bounds, cursorPosition, options) {
    if (!bounds || !value) return null;
    const opts = options || {};
    const termStart = bounds.tokenStart;
    const termEnd = bounds.tokenEnd;
    const safeCursor = Math.max(termStart, Math.min(
        typeof cursorPosition === 'number' ? cursorPosition : termEnd,
        termEnd
    ));
    const typedSlice = value.substring(termStart, safeCursor);
    const queryText = opts.queryText != null ? String(opts.queryText) : getAutofillActiveQueryText(bounds);

    let replaceStart = termStart;
    let replaceEnd = safeCursor;

    if (queryText) {
        const trimmedTyped = typedSlice.trimEnd();
        const leadingPad = typedSlice.length - typedSlice.trimStart().length;
        const trailingPad = typedSlice.length - trimmedTyped.length;

        if (trimmedTyped === queryText) {
            replaceStart = termStart + leadingPad;
            replaceEnd = safeCursor - trailingPad;
        } else {
            const idx = typedSlice.toLowerCase().lastIndexOf(queryText.toLowerCase());
            if (idx >= 0) {
                replaceStart = termStart + idx;
                replaceEnd = replaceStart + queryText.length;
            }
        }
    }

    if (replaceStart >= replaceEnd) {
        replaceStart = termStart;
        replaceEnd = safeCursor;
    }

    if (value.includes('::')) {
        const emphMin = getEmphasisOpenEndBeforeCursor(value, safeCursor);
        if (emphMin != null) {
            replaceStart = Math.max(replaceStart, emphMin);
        }
    }

    if (replaceStart >= replaceEnd) {
        return null;
    }

    return {
        start: replaceStart,
        end: replaceEnd,
        typedText: typedSlice,
        queryText: queryText
    };
}

/** Literal spell-check input slice captured from the textarea when results were bound. */
function getSpellCheckInputSlice(spellMeta, value, spellOffset) {
    if (!spellMeta || !value) return null;
    const inputStart = spellMeta.inputStart != null ? spellMeta.inputStart : spellOffset;
    let inputEnd = spellMeta.inputEnd;
    if (inputEnd == null && spellMeta.originalText) {
        inputEnd = inputStart + spellMeta.originalText.length;
    }
    if (inputEnd == null || inputStart < 0 || inputEnd > value.length || inputStart >= inputEnd) {
        return null;
    }
    return {
        start: inputStart,
        end: inputEnd,
        text: value.substring(inputStart, inputEnd)
    };
}

/** Resolve autofill term bounds for spell correction (prefer stored spell-check bounds when still valid). */
function resolveSpellCheckTermBounds(target, spellMeta, liveBounds) {
    const cursorPos = typeof target.selectionStart === 'number' ? target.selectionStart : 0;
    if (spellMeta && spellMeta.termStart != null && spellMeta.termEnd != null) {
        const termStart = spellMeta.termStart;
        const termEnd = Math.max(spellMeta.termEnd, termStart);
        if (cursorPos >= termStart && cursorPos <= termEnd) {
            return {
                termStart: termStart,
                termEnd: termEnd,
                spellOffset: spellMeta.spellCheckTermOffset != null ? spellMeta.spellCheckTermOffset : termStart
            };
        }
    }
    if (liveBounds) {
        return {
            termStart: liveBounds.tokenStart,
            termEnd: liveBounds.tokenEnd,
            spellOffset: liveBounds.spellCheckTermOffset != null ? liveBounds.spellCheckTermOffset : liveBounds.tokenStart
        };
    }
    return {
        termStart: 0,
        termEnd: target && target.value ? target.value.length : 0,
        spellOffset: 0
    };
}

function isSpellCheckMetaAligned(spellMeta, value, spellOffset) {
    const slice = getSpellCheckInputSlice(spellMeta, value, spellOffset);
    if (!slice) return false;
    const original = spellMeta && spellMeta.originalText;
    if (typeof original === 'string') {
        return slice.text === original;
    }
    return typeof spellMeta.inputText === 'string' && slice.text === spellMeta.inputText;
}

function pickReplaceRangeClosestToCursor(ranges, cursorPos) {
    if (!ranges || !ranges.length) {
        return null;
    }
    for (let i = 0; i < ranges.length; i++) {
        const r = ranges[i];
        if (cursorPos >= r.start && cursorPos <= r.end) {
            return r;
        }
    }
    let best = ranges[0];
    let bestDist = Infinity;
    for (let j = 0; j < ranges.length; j++) {
        const r = ranges[j];
        const center = r.start + (r.end - r.start) / 2;
        const dist = Math.abs(cursorPos - center);
        if (dist < bestDist) {
            bestDist = dist;
            best = r;
        }
    }
    return best;
}

function getMisspelledWordOccurrenceIndex(spellMeta, originalWord, rowIndex) {
    if (!spellMeta || !Array.isArray(spellMeta.misspelled) || rowIndex < 0) {
        return -1;
    }
    const origLower = String(originalWord || '').toLowerCase();
    if (spellMeta.misspelled[rowIndex]?.toLowerCase() !== origLower) {
        return -1;
    }
    let occ = 0;
    for (let i = 0; i < rowIndex; i++) {
        if (spellMeta.misspelled[i]?.toLowerCase() === origLower) {
            occ++;
        }
    }
    return occ;
}

/** Resolve replace range for a spell-check correction inside the active autofill term. */
function findSpellCheckWordReplaceRange(value, cursorPos, originalWord, termStart, termEnd, spellOffset, spellMeta, misspelledRowIndex) {
    if (!originalWord || termStart == null || termEnd == null) {
        return null;
    }

    const origLower = originalWord.toLowerCase();
    const occIndex = getMisspelledWordOccurrenceIndex(spellMeta, originalWord, misspelledRowIndex);

    const inputSlice = getSpellCheckInputSlice(spellMeta, value, spellOffset);
    if (!inputSlice) {
        return null;
    }

    if (spellMeta && Array.isArray(spellMeta.wordPositions) && isSpellCheckMetaAligned(spellMeta, value, spellOffset)) {
        const matching = spellMeta.wordPositions.filter(function (wp) {
            return wp && wp.word && wp.word.toLowerCase() === origLower;
        });
        if (occIndex >= 0 && occIndex < matching.length) {
            const wp = matching[occIndex];
            const start = spellOffset + wp.start;
            const end = spellOffset + wp.end;
            if (start >= inputSlice.start && end <= inputSlice.end && start < end) {
                return { start: start, end: end };
            }
        }
        const candidates = matching.map(function (wp) {
            return {
                start: spellOffset + wp.start,
                end: spellOffset + wp.end
            };
        }).filter(function (r) {
            return r.start >= inputSlice.start && r.end <= inputSlice.end && r.start < r.end;
        });
        const picked = pickReplaceRangeClosestToCursor(candidates, cursorPos);
        if (picked) {
            return picked;
        }
    }

    return findMisspelledWordInInputSlice(value, cursorPos, originalWord, inputSlice.start, inputSlice.end);
}

/** Find exact misspelled word within a literal input slice (not tokenized term matching). */
function findMisspelledWordInInputSlice(value, cursorPos, originalWord, sliceStart, sliceEnd) {
    if (!originalWord || sliceStart == null || sliceEnd == null) {
        return null;
    }
    const inputText = value.substring(sliceStart, sliceEnd);
    const localCursor = Math.max(0, Math.min(cursorPos - sliceStart, inputText.length));
    const origLower = originalWord.toLowerCase();
    const ranges = getWordRangesInSpan(inputText);
    const matching = ranges.filter(function (r) {
        return r.word.toLowerCase() === origLower;
    });

    if (matching.length === 0) {
        return null;
    }

    for (let i = 0; i < matching.length; i++) {
        const r = matching[i];
        if (localCursor >= r.start && localCursor <= r.end) {
            return { start: sliceStart + r.start, end: sliceStart + r.end };
        }
    }

    const trimmedEnd = inputText.trimEnd().length;
    if (localCursor >= trimmedEnd) {
        const last = matching[matching.length - 1];
        return { start: sliceStart + last.start, end: sliceStart + last.end };
    }

    return pickReplaceRangeClosestToCursor(matching.map(function (r) {
        return { start: sliceStart + r.start, end: sliceStart + r.end };
    }), cursorPos);
}

function attachSpellCheckTermBounds(spellData, target) {
    if (!spellData || !target) {
        return spellData;
    }
    const bounds = getAutocompleteSearchBounds(target);
    if (!bounds) {
        return spellData;
    }
    const value = target.value || '';
    const spellOffset = bounds.spellCheckTermOffset != null ? bounds.spellCheckTermOffset : bounds.tokenStart;
    const originalText = spellData.originalText != null ? String(spellData.originalText) : (bounds.spellCheckText || '');
    const inputEnd = Math.min(spellOffset + originalText.length, value.length);
    const inputText = value.substring(spellOffset, inputEnd);
    return Object.assign({}, spellData, {
        termStart: bounds.tokenStart,
        termEnd: bounds.tokenEnd,
        spellCheckTermOffset: spellOffset,
        inputStart: spellOffset,
        inputEnd: inputEnd,
        inputText: inputText
    });
}

function scheduleAutofillSearchDebounced(target, searchText, runSearch) {
    if (characterAutocompleteTimeout) {
        clearTimeout(characterAutocompleteTimeout);
        characterAutocompleteTimeout = null;
    }
    const isContinuation = !!(lastSearchText && searchText.startsWith(lastSearchText) && searchText.length > lastSearchText.length);
    const sessionActive = isSearching && autofillSessionId && autofillSessionTarget === target && currentSearchRequestId;
    if (isContinuation && sessionActive) {
        runSearch();
        return;
    }
    const delay = getAutofillSearchDebounceMs(isContinuation);
    characterAutocompleteTimeout = setTimeout(runSearch, delay);
}

function normalizeTagOverlayComparable(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function tokenizeOverlayWords(text) {
    return normalizeTagOverlayComparable(text)
        .split(' ')
        .filter(function (w) { return w.length > 0; });
}

function findBestOverlayWordMatch(queryWords, tagWords) {
    let best = null;
    for (let qi = 0; qi < queryWords.length; qi++) {
        let matched = 0;
        let ti = 0;
        while (qi + matched < queryWords.length && ti < tagWords.length) {
            if (getTokenMatchScore(queryWords[qi + matched], tagWords[ti]) >= 40) {
                matched++;
                ti++;
            } else {
                break;
            }
        }
        if (matched > 0 && (!best || matched > best.matched)) {
            best = { queryStart: qi, matched: matched };
        }
    }
    return best;
}

/** Index after the opening weight:: when the caret is inside or at the start of that group. */
function getEmphasisOpenEndBeforeCursor(value, cursorPosition) {
    if (!value || typeof cursorPosition !== 'number') return null;
    if (!isInsideEmphasisGroup(value, cursorPosition) && !isAtStartOfEmphasisGroup(value, cursorPosition)) {
        return null;
    }
    const textBefore = value.substring(0, cursorPosition);
    const re = new RegExp('(' + EMPHASIS_WEIGHT_PATTERN + ')::', 'g');
    let lastOpenEnd = null;
    let match;
    while ((match = re.exec(textBefore)) !== null) {
        lastOpenEnd = match.index + match[0].length;
    }
    return lastOpenEnd;
}

/** Keep cursor at the same logical position after a text replacement. */
function cursorAfterTextReplace(cursorPos, replaceStart, replaceEnd, insertLength) {
    const replacedLen = replaceEnd - replaceStart;
    const delta = insertLength - replacedLen;
    if (cursorPos > replaceEnd) {
        return cursorPos + delta;
    }
    if (cursorPos > replaceStart) {
        return replaceStart + Math.min(cursorPos - replaceStart, insertLength);
    }
    return cursorPos;
}

function applySpellCorrectionReplace(target, replaceStart, replaceEnd, suggestion, cursorPos) {
    const currentValue = target.value;
    const newValue = currentValue.substring(0, replaceStart) + suggestion + currentValue.substring(replaceEnd);
    hideCharacterAutocomplete();
    setTextareaValuePreservingUndo(target, newValue);
    const newCursorPos = cursorAfterTextReplace(cursorPos, replaceStart, replaceEnd, suggestion.length);
    setTimeout(function () {
        target.setSelectionRange(newCursorPos, newCursorPos);
        target.focus();
    }, 0);
    target.dispatchEvent(new CustomEvent('input', { bubbles: true, detail: { skipAutofill: true } }));
    return true;
}

/** Word-aligned replace range fallback when literal typed input match is unavailable. */
function computeTagOverlayReplaceRange(value, tokenStart, tokenEnd, insertText, cursorPosition) {
    const bounds = {
        tokenStart: tokenStart,
        tokenEnd: tokenEnd,
        query: value.substring(tokenStart, Math.min(
            typeof cursorPosition === 'number' ? cursorPosition : tokenEnd,
            tokenEnd
        )).trim()
    };
    const typedRange = resolveTypedInputReplaceRange(value, bounds, cursorPosition);
    if (typedRange) {
        return {
            start: typedRange.start,
            end: typedRange.end,
            text: insertText
        };
    }

    const termText = value.substring(tokenStart, tokenEnd);
    const safeCursor = typeof cursorPosition === 'number' ? cursorPosition : tokenEnd;
    const localCursor = Math.max(0, Math.min(safeCursor - tokenStart, termText.length));
    const typedTerm = termText.substring(0, localCursor).trimEnd() || termText.trim();
    const queryNorm = normalizeTagOverlayComparable(typedTerm);
    const tagNorm = normalizeTagOverlayComparable(String(insertText).replace(/_/g, ' '));
    if (queryNorm && tagNorm && queryNorm === tagNorm) {
        return {
            start: tokenStart,
            end: tokenEnd,
            text: insertText
        };
    }

    const queryWords = tokenizeOverlayWords(termText);
    const tagWords = tokenizeOverlayWords(String(insertText).replace(/_/g, ' '));
    if (queryWords.length === 0 || tagWords.length === 0) {
        return null;
    }
    const match = findBestOverlayWordMatch(queryWords, tagWords);
    if (!match) {
        return null;
    }
    const coverage = match.matched / tagWords.length;
    const minMatch = tagWords.length >= 2 ? 2 : 1;
    if (match.matched < minMatch || (coverage < 0.5 && match.matched < 2)) {
        return null;
    }
    const wordCharRanges = [];
    let pos = 0;
    const rawWords = termText.trim().split(/\s+/).filter(function (w) { return w.length > 0; });
    for (const w of rawWords) {
        const idx = termText.indexOf(w, pos);
        if (idx < 0) {
            return null;
        }
        wordCharRanges.push({ start: idx, end: idx + w.length });
        pos = idx + w.length;
    }
    const startIdx = match.queryStart;
    const endWordIdx = match.queryStart + match.matched - 1;
    if (!wordCharRanges.length || startIdx >= wordCharRanges.length) {
        return null;
    }
    const endIdx = Math.min(endWordIdx, wordCharRanges.length - 1);
    let start = tokenStart + wordCharRanges[startIdx].start;
    const end = tokenStart + wordCharRanges[endIdx].end;
    if (value.includes('::')) {
        const emphMin = getEmphasisOpenEndBeforeCursor(value, safeCursor);
        if (emphMin != null) {
            start = Math.max(start, emphMin);
        }
    }
    if (start >= end) {
        return null;
    }
    return {
        start: start,
        end: end,
        text: insertText
    };
}

function shouldAbortAutocompleteSearchSession() {
    if (!currentSearchSessionBounds || !currentCharacterAutocompleteTarget) return false;
    const target = currentCharacterAutocompleteTarget;
    if (document.activeElement !== target) return true;
    if (typeof target.selectionStart !== 'number') return true;

    const liveBounds = getAutocompleteSearchBounds(target);
    if (!liveBounds) return true;

    if (isAutofillSingleToken(target)) {
        return false;
    }

    const cursorPosition = target.selectionStart;
    const sessionStart = currentSearchSessionBounds.tokenStart;
    const tokenEnd = Math.max(currentSearchSessionBounds.tokenEnd, liveBounds.tokenEnd);

    // Caret still inside the token span when the search started (token may have grown while typing)
    if (cursorPosition >= sessionStart && cursorPosition <= tokenEnd) {
        return false;
    }

    // Continuation of the same search term — keep session until the new search replaces it
    if (liveBounds.query && currentSearchQuery &&
        liveBounds.tokenStart === sessionStart &&
        (liveBounds.query.startsWith(currentSearchQuery) || currentSearchQuery.startsWith(liveBounds.query))) {
        return false;
    }

    return true;
}

function resetStaleAutofillSessionForNewInput() {
    currentSearchRequestId = null;
    currentSearchQuery = '';
    currentSearchTimestamp = null;
    currentSearchSessionBounds = null;
    isSearching = false;
    autofillSearchBoundsCache = null;
    clearAutofillSessionState();
    if (characterAutocompleteOverlay) {
        characterAutocompleteOverlay.classList.add('hidden');
        characterAutocompleteOverlay.classList.remove('expanded');
    }
    isAutocompleteVisible = false;
    markAutofillOverlayClosedFromInput();
    spellCheckNavigationMode = false;
    wordLookupNavigationMode = false;
    selectedSpellCheckWordIndex = -1;
    selectedSpellCheckSuggestionIndex = -1;
    selectedWordLookupWordIndex = -1;
    selectedWordLookupSuggestionIndex = -1;
    activeWordLookupWordIndex = 0;
    autocompleteExpanded = false;
}

function abortAutocompleteSearchSession() {
    currentSearchRequestId = null;
    currentSearchQuery = '';
    currentSearchTimestamp = null;
    currentSearchSessionBounds = null;
    isSearching = false;
    autofillSearchBoundsCache = null;
    hideCharacterAutocomplete();
}

// Main tag-list selection index for restore after overlay rebuild (position only, not tag identity)
let lastSelectedListIndex = -1;
/** When true, list selection must not carry over — overlay was dismissed or hidden until user navigates again. */
let autofillOverlayClosedForInput = true;

function markAutofillOverlayClosedFromInput() {
    autofillOverlayClosedForInput = true;
    lastSelectedListIndex = -1;
    selectedCharacterAutocompleteIndex = -1;
    autocompleteNavigationMode = false;
}

function markAutofillOverlayInteractive() {
    autofillOverlayClosedForInput = false;
}

function shouldPreserveAutofillListSelection() {
    return !autofillOverlayClosedForInput;
}

// Map client model names to server model names
const searchModelMapping = {
    'v4_5': 'nai-diffusion-4-5-full',
    'v4_5_cur': 'nai-diffusion-4-5-curated',
    'v4': 'nai-diffusion-4-full',
    'v4_cur': 'nai-diffusion-4-curated',
    'v3': 'nai-diffusion-3',
    'v3_furry': 'nai-diffusion-furry-3'
};

const ANIME_LOCAL_SERVICE = 'anime-local';
const FURRY_LOCAL_SERVICE = 'furry-local';

function getMappedManualModel() {
    const raw = manualModel?.value || 'unknown';
    return searchModelMapping[raw] || raw;
}

function isFurryApiModelSlotNeeded() {
    return getMappedManualModel() !== 'nai-diffusion-furry-3';
}

// Function to initialize all autofill services
function initializeAutofillServices() {
    initializeAutofillServicesForConfig(DEFAULT_AUTOFILL_CONFIG);
}

function initializeAutofillServicesForConfig(config) {
    searchServices.clear();
    const server = typeof getAutofillSearchSettings === 'function' ? getAutofillSearchSettings() : null;

    if (config.characters && (!server || server.enabled !== false)) {
        searchServices.set('characters', 'stalled');
    }

    if (config.tags) {
        if (!server || server.dbAnimeTags !== false) {
            searchServices.set(ANIME_LOCAL_SERVICE, 'stalled');
        }
        if (!server || server.dbFurryTags !== false) {
            searchServices.set(FURRY_LOCAL_SERVICE, 'stalled');
        }

        const currentModel = getMappedManualModel();
        if (currentModel.startsWith('nai-diffusion') && (!server || server.naiAnimeTags !== false)) {
            searchServices.set(currentModel, 'stalled');
        }
        if (isFurryApiModelSlotNeeded() && (!server || server.naiFurryTags !== false)) {
            searchServices.set('nai-diffusion-furry-3', 'stalled');
        }
    }

    if (config.expanders && (!server || server.enabled !== false)) {
        searchServices.set('textReplacements', 'stalled');
    }
    if (config.spellcheck) {
        searchServices.set('spellcheck', 'stalled');
    }
    if (config.thesaurus) {
        searchServices.set('wordLookup', 'stalled');
    }

    updateSearchStatusDisplay();
}

function markAutofillServicesSearchingForConfig(config) {
    const server = typeof getAutofillSearchSettings === 'function' ? getAutofillSearchSettings() : null;

    if (config.characters && (!server || server.enabled !== false)) {
        searchServices.set('characters', 'searching');
    }

    if (config.tags) {
        if (!server || server.dbAnimeTags !== false) {
            searchServices.set(ANIME_LOCAL_SERVICE, 'searching');
        }
        if (!server || server.dbFurryTags !== false) {
            searchServices.set(FURRY_LOCAL_SERVICE, 'searching');
        }

        const currentModel = getMappedManualModel();
        if (searchServices.has(currentModel)) {
            searchServices.set(currentModel, 'searching');
        }
        if (isFurryApiModelSlotNeeded() && searchServices.has('nai-diffusion-furry-3')) {
            searchServices.set('nai-diffusion-furry-3', 'searching');
        }
    }

    if (config.expanders && (!server || server.enabled !== false)) {
        searchServices.set('textReplacements', 'searching');
    }
    if (config.spellcheck) {
        searchServices.set('spellcheck', 'searching');
    }
    if (config.thesaurus) {
        searchServices.set('wordLookup', 'searching');
    }
}

function markAutofillServicesErrorForConfig(config) {
    const server = typeof getAutofillSearchSettings === 'function' ? getAutofillSearchSettings() : null;

    if (config.characters && (!server || server.enabled !== false)) {
        searchServices.set('characters', 'error');
    }

    if (config.tags) {
        if (!server || server.dbAnimeTags !== false) {
            searchServices.set(ANIME_LOCAL_SERVICE, 'error');
        }
        if (!server || server.dbFurryTags !== false) {
            searchServices.set(FURRY_LOCAL_SERVICE, 'error');
        }

        const currentModel = getMappedManualModel();
        if (searchServices.has(currentModel)) {
            searchServices.set(currentModel, 'error');
        }
        if (isFurryApiModelSlotNeeded() && searchServices.has('nai-diffusion-furry-3')) {
            searchServices.set('nai-diffusion-furry-3', 'error');
        }
    }

    if (config.expanders && (!server || server.enabled !== false)) {
        searchServices.set('textReplacements', 'error');
    }
    if (config.spellcheck) {
        searchServices.set('spellcheck', 'error');
    }
    if (config.thesaurus) {
        searchServices.set('wordLookup', 'error');
    }
}

function getAutofillServicesConfigKey(config) {
    const server = typeof getAutofillSearchSettings === 'function' ? getAutofillSearchSettings() : null;
    const serverKey = server
        ? [
            server.enabled ? '1' : '0',
            server.spellcheck ? '1' : '0',
            server.thesaurus ? '1' : '0',
            server.naiAnimeTags ? '1' : '0',
            server.naiFurryTags ? '1' : '0',
            server.dbAnimeTags ? '1' : '0',
            server.dbFurryTags ? '1' : '0'
        ].join('')
        : 'default';
    return [
        (config.tags || config.characters) ? '1' : '0',
        config.expanders ? '1' : '0',
        config.spellcheck ? '1' : '0',
        config.thesaurus ? '1' : '0',
        serverKey
    ].join('');
}

let currentAutofillServicesConfigKey = null;

function markRegularAutofillServicesSearching() {
    markAutofillServicesSearchingForConfig(DEFAULT_AUTOFILL_CONFIG);
}

function markRegularAutofillServicesError() {
    markAutofillServicesErrorForConfig(DEFAULT_AUTOFILL_CONFIG);
}

function ensureAutofillServicesForTarget(target) {
    const config = getEffectiveAutofillConfig(target);
    const configKey = getAutofillServicesConfigKey(config);
    if (!servicesInitialized || currentAutofillServicesConfigKey !== configKey) {
        initializeAutofillServicesForConfig(config);
        servicesInitialized = true;
        currentAutofillServicesConfigKey = configKey;
    }
}

const modelKeys = {
    "nai-diffusion-3": { type: "NovelAI", version: "v3 Anime" },
    "nai-diffusion-furry-3": { type: "NovelAI", version: "v3 Furry" },
    "nai-diffusion-4-full": { type: "NovelAI", version: "v4" },
    "nai-diffusion-4-curated-preview": { type: "NovelAI", version: "v4 Curated" },
    "nai-diffusion-4-5-full": { type: "NovelAI", version: "v4.5" },
    "nai-diffusion-4-5-curated": { type: "NovelAI", version: "v4.5 Curated" },
    "furry-local": { type: "Hidden", version: "e621" },
    "anime-local": { type: "Hidden", version: "Danbooru" },
    "dual-match": { type: "Global" }
};

const TAG_CATEGORY_BY_ID = {
    0: 'General',
    1: 'Artist',
    3: 'Copyright',
    4: 'Character',
    5: 'Meta',
    6: 'Species'
};

function isServiceStatusTerminal(status) {
    return status === 'completed' ||
        status === 'completed-none' ||
        status === 'completed-noresults' ||
        status === 'completed-noerrors' ||
        status === 'error';
}

function getTagServiceLabelHtml(displayMeta, isLocal) {
    const badgeText = displayMeta.displayType || '';
    const rightText = displayMeta.displayVersion || '';
    if (isLocal) {
        if (badgeText && rightText) {
            return `<span class="badge">${badgeText}</span> ${rightText}`;
        }
        if (badgeText) {
            return `<span class="badge">${badgeText}</span>`;
        }
        return rightText;
    }
    if (rightText && badgeText) {
        return `<span class="badge">${rightText}</span> ${badgeText}`;
    }
    if (rightText) {
        return `<span class="badge">${rightText}</span>`;
    }
    return badgeText;
}

function getTagMetaIconFlags(result) {
    const local = result.localResult || null;
    const dCount = Math.max(result.d_count || 0, local?.d_count || 0);
    const eCount = Math.max(result.e_count || 0, local?.e_count || 0);
    let hasWiki = !!(result.hasWiki || local?.hasWiki);
    if (!hasWiki) {
        const sources = result.wikiSources || local?.wikiSources;
        hasWiki = Array.isArray(sources) && sources.length > 0;
    }

    return {
        hasWiki,
        danbooru: dCount > 0,
        e621: eCount > 0
    };
}

function buildTagMetaIconsHtml(result) {
    if (!isDualMatchTagResult(result)) {
        const flags = getTagMetaIconFlags(result);
        if (!flags.hasWiki) {
            return '';
        }
        return '<span class="tag-meta-icons"><i class="fas fa-book tag-meta-icon" title="Wiki available"></i></span>';
    }

    const flags = getTagMetaIconFlags(result);
    if (!flags.hasWiki && !flags.danbooru && !flags.e621) {
        return '';
    }

    let html = '<span class="tag-meta-icons">';
    if (flags.hasWiki) {
        html += '<i class="fas fa-book tag-meta-icon" title="Wiki available"></i>';
    }
    if (flags.danbooru) {
        html += '<i class="nai-sakura tag-meta-icon tag-danbooru-icon" title="Danbooru"></i>';
    }
    if (flags.e621) {
        html += '<i class="nai-paw tag-meta-icon tag-e621-icon" title="e621"></i>';
    }
    html += '</span>';
    return html;
}

function getTagCopyrightHtml(result, displayMeta) {
    const metaIcons = buildTagMetaIconsHtml(result);
    const serviceLabel = getTagServiceLabelHtml(displayMeta, isLocalTagResult(result));
    return `${metaIcons}${serviceLabel}`;
}

function getTagPrimaryBodyPreview(result) {
    if (!result) return '';
    const local = result.localResult || null;
    const raw = result.primaryBody || local?.primaryBody || '';
    return typeof raw === 'string' ? raw.trim() : '';
}

function refreshAutofillWikiPreviewDom() {
    if (!characterAutocompleteList) return;
    const showWikiPreviews = typeof isAutofillWikiPreviewsEnabled === 'function' && isAutofillWikiPreviewsEnabled();
    if (!showWikiPreviews) return;

    const resultById = new Map();
    for (const [, results] of serviceResults) {
        if (!results || !Array.isArray(results)) continue;
        for (const result of results) {
            if (!isTagResult(result)) continue;
            const id = getAutofillWikiPreviewTagId(result);
            if (id == null) continue;
            resultById.set(String(id), result);
        }
    }

    characterAutocompleteList.querySelectorAll('.character-autocomplete-item[data-type="tag"][data-has-wiki="true"]').forEach((item) => {
        const tagId = item.dataset.tagId;
        const result = tagId ? resultById.get(tagId) : null;
        if (!result) return;

        const previewText = getTagPrimaryBodyPreview(result);
        const wikiTagId = getAutofillWikiPreviewTagId(result);
        const wikiPending = !previewText && wikiTagId != null;
        let row = item.querySelector('.tag-wiki-preview-row');
        if (!previewText && !wikiPending) {
            if (row) row.remove();
            delete item.dataset.hasWikiPreview;
            return;
        }
        const rowHtml = buildTagWikiPreviewRowHtml(previewText, wikiPending);
        if (row) {
            row.outerHTML = rowHtml;
        } else if (rowHtml) {
            item.insertAdjacentHTML('beforeend', rowHtml);
        }
        if (previewText) {
            item.dataset.hasWikiPreview = 'true';
            delete item.dataset.hasWikiPending;
        } else if (wikiPending) {
            item.dataset.hasWikiPending = 'true';
            delete item.dataset.hasWikiPreview;
        } else {
            delete item.dataset.hasWikiPreview;
            delete item.dataset.hasWikiPending;
        }
        if (item.classList.contains('selected') && item.classList.contains('wiki-preview-revealed')) {
            updateTagWikiPreviewScroll(item);
        }
    });
}

function buildTagWikiPreviewRowHtml(previewText, wikiPending) {
    if (previewText) {
        const safeText = escapeHtml(previewText);
        return `
        <div class="tag-wiki-preview-row">
            <div class="tag-wiki-preview-scroll">
                <span class="tag-wiki-preview-text">${safeText}</span>
            </div>
        </div>
    `;
    }
    if (wikiPending) {
        return `
        <div class="tag-wiki-preview-row tag-wiki-preview-pending">
            <div class="tag-wiki-preview-scroll">
                <span class="tag-wiki-preview-text"><i class="fas fa-book-open" aria-hidden="true"></i> Wiki available</span>
            </div>
        </div>
    `;
    }
    return '';
}

function updateTagWikiPreviewScroll(item) {
    if (!item) return;
    const textEl = item.querySelector('.tag-wiki-preview-text');
    const scrollEl = item.querySelector('.tag-wiki-preview-scroll');
    if (!textEl || !scrollEl) return;

    textEl.classList.remove('is-scrolling');
    textEl.style.removeProperty('--tag-wiki-preview-offset');
    textEl.style.removeProperty('--tag-wiki-preview-duration');

    if (!item.classList.contains('selected') || !item.classList.contains('wiki-preview-revealed')) return;

    const overflow = textEl.scrollWidth - scrollEl.clientWidth;
    if (overflow <= 2) return;

    const duration = Math.max(6, Math.min(28, overflow / 28));
    textEl.style.setProperty('--tag-wiki-preview-offset', `-${overflow}px`);
    textEl.style.setProperty('--tag-wiki-preview-duration', `${duration}s`);
    textEl.classList.add('is-scrolling');
}

function markSearchSessionComplete() {
    isSearching = false;
    currentSearchQuery = '';
    searchCompletionStatus.isComplete = true;
    updateSearchStatusDisplay();
    if (currentCharacterAutocompleteTarget && hasActiveAutofillSessionForTarget(currentCharacterAutocompleteTarget)) {
        updateAutocompleteDisplay(allSearchResults, currentCharacterAutocompleteTarget);
    }
}

function isLocalTagResult(result) {
    if (!result) return false;
    const model = result.model || result.serviceName || result.source || '';
    return model === ANIME_LOCAL_SERVICE || model === FURRY_LOCAL_SERVICE;
}

function isDualMatchTagResult(result) {
    return !!(result && (result.isDualMatch || result.source === 'dual-match' || result.serviceName === 'dual-match'));
}

function isDatabaseTagResult(result) {
    return isLocalTagResult(result);
}

function isApiTagResult(result) {
    if (!result || isLocalTagResult(result) || isDualMatchTagResult(result)) {
        return false;
    }
    const model = result.model || result.serviceName || '';
    if (model.includes('nai-diffusion')) {
        return true;
    }
    return (result.count !== undefined || result.confidence !== undefined) &&
        !!(result.name || result.tag);
}

function isCharacterResult(result) {
    if (!result) return false;
    if (result.type === 'character' || result.type === 'characterTag') return true;
    return !!(result.character && result.type !== 'tag');
}

function isTagResult(result) {
    if (!result || isCharacterResult(result)) return false;
    if (result.type === 'tag') return true;
    if (isLocalTagResult(result)) return true;
    if (isDualMatchTagResult(result)) return true;
    if (isApiTagResult(result)) return true;
    if (result.tag && (result.count !== undefined || result.n_count !== undefined)) return true;
    if (result.name && (result.count !== undefined || result.n_count !== undefined)) return true;
    return false;
}

function getCharacterDedupeKey(result) {
    const name = result.name || result.character?.name || '';
    return name.replace(/\s+/g, ' ').trim().toLowerCase();
}

function mergeCharacterTagResults(characterResult, tagResult) {
    return {
        type: 'characterTag',
        name: characterResult.name,
        character: characterResult.character,
        tag: tagResult,
        tagInsertName: getTagInsertName(tagResult),
        tagCategory: getTagCategorySlug(tagResult),
        count: characterResult.count,
        enhancedSimilarity: characterResult.enhancedSimilarity,
        similarity: characterResult.similarity,
        serviceName: characterResult.serviceName,
        _isTopTier: characterResult._isTopTier
    };
}

function getTagInsertName(result) {
    if (result.title) {
        return result.title;
    }
    return result.tag || result.name || '';
}

function getTagDisplayLabel(result) {
    if (result.title) return result.title;
    const raw = result.name || result.tag || '';
    return raw.replace(/_/g, ' ');
}

function getTagDedupeKey(result) {
    return normalizeTagSearchText(getTagDisplayLabel(result));
}

// Comparison-only — keep in sync with modules/tag-lookup.js normalizeTagName / getQueryMatchTier
function normalizeTagSearchText(value) {
    return (value || '').toLowerCase()
        .replace(/_/g, ' ')
        .replace(/[\s\-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function tokenizeTagSearchText(value) {
    const normalized = normalizeTagSearchText(value);
    if (!normalized) return [];
    return normalized.split(' ').filter(Boolean);
}

function commonPrefixLength(a = '', b = '') {
    const minLen = Math.min(a.length, b.length);
    let i = 0;
    while (i < minLen && a[i] === b[i]) {
        i++;
    }
    return i;
}

function getTokenMatchScore(queryToken = '', titleToken = '') {
    const qt = queryToken.toLowerCase();
    const tt = titleToken.toLowerCase();
    if (!qt || !tt) return 0;
    if (qt === tt) return 100;
    if (qt.length >= 3 && tt.length >= 3 && (qt.startsWith(tt) || tt.startsWith(qt))) {
        return 90;
    }
    const stemLen = commonPrefixLength(qt, tt);
    const minLen = Math.min(qt.length, tt.length);
    const stemThreshold = Math.max(3, Math.min(4, Math.floor(minLen * 0.72)));
    if (stemLen >= 5) {
        return 88;
    }
    if (stemLen >= stemThreshold) {
        return 75;
    }
    if (qt.includes(tt) || tt.includes(qt)) {
        if (Math.min(qt.length, tt.length) >= 3) {
            return 55;
        }
    }
    const distance = levenshteinDistance(qt, tt);
    const maxLen = Math.max(qt.length, tt.length);
    const similarity = 1 - (distance / maxLen);
    if (similarity >= 0.72) {
        return Math.round(similarity * 65);
    }
    return 0;
}

function getQueryTokenCoverageScore(query, title) {
    const queryTokens = tokenizeTagSearchText(query);
    const titleTokens = tokenizeTagSearchText(title);
    if (queryTokens.length === 0) return 0;

    let sum = 0;
    let weightedSum = 0;
    let weightTotal = 0;
    for (let i = 0; i < queryTokens.length; i++) {
        const queryToken = queryTokens[i];
        let best = 0;
        for (const titleToken of titleTokens) {
            best = Math.max(best, getTokenMatchScore(queryToken, titleToken));
        }
        sum += best;
        const weight = queryTokens.length >= 2
            ? (i === 0 ? 1.4 : (i === queryTokens.length - 1 ? 1.0 : 1.1))
            : 1;
        weightedSum += best * weight;
        weightTotal += weight;
    }

    let coverage = Math.max(sum / queryTokens.length, weightedSum / weightTotal);
    if (titleTokens.length === queryTokens.length && queryTokens.length >= 2) {
        coverage += 8;
    } else if (titleTokens.length < queryTokens.length) {
        coverage -= 12;
    }
    return Math.min(100, coverage);
}

function getTagTextMatchInfo(name, query) {
    const queryNorm = normalizeTagSearchText(query);
    const titleNorm = normalizeTagSearchText(name);
    if (!queryNorm) {
        return { tier: 0, matchCoverage: 0, isExactMatch: false, isPrefixMatch: false };
    }
    if (!titleNorm) {
        return { tier: 0, matchCoverage: 0, isExactMatch: false, isPrefixMatch: false };
    }

    if (titleNorm === queryNorm) {
        return { tier: 4, matchCoverage: 100, isExactMatch: true, isPrefixMatch: true };
    }
    if (titleNorm.startsWith(queryNorm)) {
        return { tier: 3, matchCoverage: 90, isExactMatch: false, isPrefixMatch: true };
    }

    const queryTokens = tokenizeTagSearchText(query);
    const titleTokens = tokenizeTagSearchText(name);
    const coverage = getQueryTokenCoverageScore(query, name);
    const allTokensPartial = queryTokens.length > 0 && queryTokens.every(qt =>
        titleTokens.some(tt => getTokenMatchScore(qt, tt) >= 40)
    );

    if (coverage >= 90 || (coverage >= 55 && allTokensPartial)) {
        return { tier: 2, matchCoverage: coverage, isExactMatch: false, isPrefixMatch: true };
    }
    if (coverage >= 35) {
        if (queryTokens.length >= 2 && titleTokens.length === 1) {
            const singleToken = titleTokens[0];
            const matchedQueryWord = queryTokens.some(qt => qt === singleToken);
            if (matchedQueryWord && coverage >= 45) {
                return { tier: 1, matchCoverage: coverage, isExactMatch: false, isPrefixMatch: false };
            }
            return { tier: 0, matchCoverage: coverage, isExactMatch: false, isPrefixMatch: false };
        }
        return { tier: 1, matchCoverage: coverage, isExactMatch: false, isPrefixMatch: false };
    }

    return { tier: 0, matchCoverage: coverage, isExactMatch: false, isPrefixMatch: false };
}

function resolveTagTextMatchInfo(result, query) {
    const resultName = getTagDisplayLabel(result);
    const clientInfo = getTagTextMatchInfo(resultName, query);
    const serverTier = typeof result.matchTier === 'number' ? result.matchTier : 0;
    const serverCoverage = typeof result.matchCoverage === 'number' ? result.matchCoverage : 0;
    const bestTier = Math.max(serverTier, clientInfo.tier, result.textMatchInfo?.tier || 0);
    const bestCoverage = Math.max(serverCoverage, clientInfo.matchCoverage || 0, result.textMatchInfo?.matchCoverage || 0);

    if (bestTier > clientInfo.tier || bestCoverage > (clientInfo.matchCoverage || 0)) {
        return {
            tier: bestTier,
            matchCoverage: bestCoverage,
            isExactMatch: bestTier === 4,
            isPrefixMatch: bestTier >= 3
        };
    }
    return clientInfo;
}

function getRawApiTagConfidence(result) {
    if (result.isDualMatch && result.apiResult) {
        return result.apiResult.confidence || result.apiResult.count || 0;
    }
    if (isApiTagResult(result)) {
        return result.confidence || result.count || 0;
    }
    return 0;
}

function getTagTextRelevanceScore(query, tagName) {
    const stringScore = calculateStringSimilarity(query, tagName);
    const matchInfo = getTagTextMatchInfo(tagName, query);
    let score = stringScore;
    if (matchInfo.tier === 4) score = Math.max(score, 100);
    else if (matchInfo.tier === 3) score = Math.max(score, 85);
    else if (matchInfo.tier === 2) score = Math.max(score, 80);
    else if (matchInfo.tier === 1) score = Math.max(score, 60);
    return score;
}

function pickBestTagTextMatchInfo(info1, info2) {
    const tier1 = info1?.tier || 0;
    const tier2 = info2?.tier || 0;
    if (tier1 >= tier2) return info1 || info2;
    return info2 || info1;
}

function mergeTagEnhancementFields(result1, result2, merged) {
    const primaryBody = getTagPrimaryBodyPreview(merged)
        || getTagPrimaryBodyPreview(result1)
        || getTagPrimaryBodyPreview(result2);
    return {
        ...merged,
        ...(primaryBody ? { primaryBody } : {}),
        textMatchInfo: pickBestTagTextMatchInfo(result1.textMatchInfo, result2.textMatchInfo),
        predictionaryScore: Math.max(result1.predictionaryScore || 0, result2.predictionaryScore || 0),
        enhancedConfidence: Math.max(
            result1.enhancedConfidence || getTagScore(result1) || 0,
            result2.enhancedConfidence || getTagScore(result2) || 0,
            merged.enhancedConfidence || 0
        )
    };
}

function getTagNCount(result) {
    if (result.n_count !== undefined && result.n_count !== null) {
        return result.n_count;
    }
    return result.count || 0;
}

function getTagECount(result) {
    return result.e_count || 0;
}

function getTagScore(result) {
    if (result.enhancedConfidence !== undefined) {
        return result.enhancedConfidence;
    }
    if (isLocalTagResult(result)) {
        return result.score || 0;
    }
    return result.confidence || result.score || 0;
}

function getTagCategoryLabel(result) {
    if (result.categoryName) {
        return result.categoryName;
    }
    if (typeof result.category === 'string') {
        return result.category.charAt(0).toUpperCase() + result.category.slice(1);
    }
    if (typeof result.category === 'number') {
        return TAG_CATEGORY_BY_ID[result.category] || '';
    }
    return '';
}

function getTagCategorySlug(result) {
    return getTagCategoryLabel(result).toLowerCase();
}

function getTagDatasetType(result) {
    if (isLocalTagResult(result)) {
        const model = result.model || result.serviceName || '';
        if (model === FURRY_LOCAL_SERVICE) return 'furry';
        if (model === ANIME_LOCAL_SERVICE) return 'anime';
    }
    if (Array.isArray(result.datasets)) {
        const dCount = result.d_count || 0;
        const eCount = result.e_count || 0;
        if (eCount > dCount) return 'furry';
        if (dCount > 0) return 'anime';
    }
    const model = (result.model || result.serviceName || '').toLowerCase();
    if (model.includes('furry')) return 'furry';
    return 'anime';
}

function getTagSourceBadge(result) {
    const dCount = result.d_count || 0;
    const eCount = result.e_count || 0;

    if (isLocalTagResult(result)) {
        const model = result.model || result.serviceName || '';
        if (model === FURRY_LOCAL_SERVICE) {
            return { slug: 'e621', label: 'e621' };
        }
        if (model === ANIME_LOCAL_SERVICE) {
            return { slug: 'danbooru', label: 'Danbooru' };
        }
    }

    if (eCount > dCount && eCount > 0) {
        return { slug: 'e621', label: 'e621' };
    }
    if (dCount > 0) {
        return { slug: 'danbooru', label: 'Danbooru' };
    }
    return null;
}

function getTagServiceKey(result) {
    if (isDualMatchTagResult(result)) {
        return 'dual-match';
    }
    if (isLocalTagResult(result)) {
        return result.model || result.serviceName;
    }
    if (result.serviceName) {
        return result.serviceName;
    }
    return result.model || 'unknown';
}

function getTagCountTooltip(result) {
    if (result.isDualMatch && result.localResult) {
        return getTagCountTooltip(result.localResult);
    }
    const nCount = getTagNCount(result);
    const eCount = getTagECount(result);
    let text = `NovelAI: ${nCount}`;
    if (eCount > 0 || result.e_count !== undefined) {
        text += `\ne621: ${eCount}`;
    }
    if (isDatabaseTagResult(result) && result.d_count) {
        text += `\ndanbooru: ${result.d_count}`;
    }
    return text;
}

function buildTagCountDots(result) {
    const nCount = getTagNCount(result);
    const eCount = getTagECount(result);
    const nCountOpacity = nCount ? Math.min(1, Math.log10(nCount + 1) / Math.log10(10001)) : 0;
    const eCountOpacity = eCount ? Math.min(1, Math.log10(eCount + 1) / Math.log10(100001)) : 0;
    const nCountLightness = 15 + (nCountOpacity * 75);
    const eCountLightness = 15 + (eCountOpacity * 75);
    const tooltipText = getTagCountTooltip(result);

    return `
        <div class="tag-count-dots" title="${tooltipText}">
            <div class="count-dot n-count-dot" style="background: hsl(260, 100%, ${nCountLightness}%, ${nCountOpacity});"></div>
            ${eCount > 0 || result.e_count !== undefined ? `<div class="count-dot e-count-dot" style="background: hsl(35, 100%, ${eCountLightness}%, ${eCountOpacity});"></div>` : ''}
        </div>
    `;
}

function getTagResultDisplayMeta(result) {
    let displayType = 'Search';
    let displayVersion = '';
    let modelType = getTagDatasetType(result);

    if (result.isDualMatch && result.mergedServices) {
        const matchInfo = getMatchType(result.mergedServices);
        displayType = matchInfo.type;
        displayVersion = matchInfo.version;
        if (matchInfo.dataType) {
            modelType = matchInfo.dataType;
        }
    } else if (isLocalTagResult(result)) {
        const serviceKey = getTagServiceKey(result);
        displayType = modelKeys[serviceKey]?.type || 'Hidden';
        displayVersion = modelKeys[serviceKey]?.version || '';
    } else {
        const serviceKey = getTagServiceKey(result);
        displayType = modelKeys[serviceKey]?.type || 'Search';
        displayVersion = modelKeys[serviceKey]?.version || '';
    }

    return { displayType, displayVersion, modelType };
}

function applyTagResultToAutocompleteItem(item, result) {
    const insertName = getTagInsertName(result);
    const displayLabel = getTagDisplayLabel(result);
    const categorySlug = getTagCategorySlug(result);
    const categoryLabel = getTagCategoryLabel(result);
    const sourceBadge = getTagSourceBadge(result);
    const displayMeta = getTagResultDisplayMeta(result);
    const { displayType, displayVersion, modelType } = displayMeta;

    item.dataset.type = 'tag';
    item.dataset.tagName = insertName;
    const wikiTagId = getAutofillWikiPreviewTagId(result);
    if (wikiTagId != null) {
        item.dataset.tagId = String(wikiTagId);
    }
    item.dataset.modelType = modelType;
    item.dataset.category = categorySlug;

    if (result.isDualMatch) {
        item.classList.add('multi-match');
    }
    if (result.isDualMatch && displayMeta.displayType === 'Global') {
        item.classList.add('global-match');
    } else if (modelType === 'anime') {
        item.classList.add('anime-match');
    } else if (modelType === 'furry') {
        item.classList.add('furry-match');
    }

    const metaFlags = getTagMetaIconFlags(result);
    const sourceBadgeHtml = (!isLocalTagResult(result) && !isDualMatchTagResult(result) && sourceBadge)
        ? `<span class="tag-category-badge ${sourceBadge.slug}-badge">${sourceBadge.label}</span>`
        : '';
    const categoryBadge = (!isLocalTagResult(result) && categoryLabel)
        ? `<span class="tag-category-badge ${categorySlug}-badge">${categoryLabel}</span>`
        : '';
    const countDots = buildTagCountDots(result);
    const copyrightHtml = getTagCopyrightHtml(result, displayMeta);

    const showWikiPreviews = typeof isAutofillWikiPreviewsEnabled === 'function' && isAutofillWikiPreviewsEnabled();
    const wikiPreviewText = (metaFlags.hasWiki && showWikiPreviews) ? getTagPrimaryBodyPreview(result) : '';
    const wikiPending = metaFlags.hasWiki && showWikiPreviews && !wikiPreviewText && wikiTagId != null;
    if (metaFlags.hasWiki) {
        item.dataset.hasWiki = 'true';
    }
    if (wikiPreviewText) {
        item.dataset.hasWikiPreview = 'true';
        delete item.dataset.hasWikiPending;
    } else if (wikiPending) {
        item.dataset.hasWikiPending = 'true';
        delete item.dataset.hasWikiPreview;
    } else {
        delete item.dataset.hasWikiPreview;
        delete item.dataset.hasWikiPending;
    }

    item.innerHTML = `
        <div class="character-info-row">
            <span class="character-name">${displayLabel}${countDots}${sourceBadgeHtml}${categoryBadge}</span>
            <span class="character-copyright">
                ${copyrightHtml}
            </span>
        </div>
        ${buildTagWikiPreviewRowHtml(wikiPreviewText, wikiPending)}
    `;

    const onSelect = (e) => {
        e.preventDefault();
        selectTag(insertName, categorySlug);
    };
    item.addEventListener('click', onSelect);
    item.addEventListener('touchend', (e) => {
        const maxDelta = touchSlopUtils.finalizeTouchSlop(item, e);
        if (!touchSlopUtils.isTouchSlopTap(maxDelta)) return;
        onSelect(e);
    }, { passive: false });
}

function getCharacterDetailOptionsFromItem(selectedItem) {
    if (!selectedItem || !selectedItem.dataset.tagName) return {};
    return {
        tagInsertName: selectedItem.dataset.tagName,
        tagCategory: selectedItem.dataset.category || ''
    };
}

function applyCharacterResultToAutocompleteItem(item, result) {
    const character = result.character;
    const name = character.name || result.name || 'Unknown';
    const copyright = character.copyright || '';
    const hasTagMatch = result.type === 'characterTag' || !!result.tag;

    item.dataset.type = 'character';
    item.dataset.characterData = JSON.stringify(character);
    if (hasTagMatch) {
        item.dataset.tagName = result.tagInsertName || getTagInsertName(result.tag);
        item.dataset.category = result.tagCategory || getTagCategorySlug(result.tag) || '';
    }

    item.innerHTML = `
        <div class="character-info-row">
            <span class="character-name">${name}</span>
            <span class="character-copyright">${copyright}</span>
        </div>
    `;

    const detailOptions = hasTagMatch ? {
        tagInsertName: item.dataset.tagName,
        tagCategory: item.dataset.category || ''
    } : {};

    const onSelect = (e) => {
        e.preventDefault();
        selectCharacterItem(character, detailOptions);
    };
    item.addEventListener('click', onSelect);
    item.addEventListener('touchend', (e) => {
        const maxDelta = touchSlopUtils.finalizeTouchSlop(item, e);
        if (!touchSlopUtils.isTouchSlopTap(maxDelta)) return;
        onSelect(e);
    }, { passive: false });
}

// Predictionary integration for better ranking
let predictionaryInstance = null;

// Initialize predictionary
async function initializePredictionary() {
    try {
        // Import predictionary dynamically
        const { Predictionary } = await import('predictionary');

        predictionaryInstance = new Predictionary({
            // Configure for autocomplete use case
            threshold: 0.3,
            maxResults: 100,
            includeScore: true,
            keys: ['name', 'placeholder', 'description']
        });

        console.log('✅ Predictionary initialized for enhanced ranking');
    } catch (error) {
        console.warn('⚠️ Predictionary not available, falling back to basic ranking:', error.message);
        predictionaryInstance = null;
    }
}

// Initialize predictionary when module loads
initializePredictionary().catch(error => {
    console.warn('Failed to initialize predictionary:', error.message);
});

// Enhanced similarity calculation using predictionary
async function calculateEnhancedSimilarity(query, text, type = 'general') {
    if (!predictionaryInstance || !query || !text) {
        // Fallback to basic similarity
        return calculateStringSimilarity(query, text);
    }

    try {
        // Use predictionary for fuzzy matching
        const results = await predictionaryInstance.search(query, [text]);

        if (results.length > 0) {
            const bestMatch = results[0];

            // Combine predictionary score with type-specific adjustments
            let enhancedScore = bestMatch.score * 100; // Convert to 0-100 scale

            // Type-specific adjustments
            switch (type) {
                case 'character':
                    // Characters get bonus for exact name matches
                    if (text.toLowerCase().includes(query.toLowerCase())) {
                        enhancedScore += 10;
                    }
                    break;
                case 'tag':
                    // Tags get bonus for confidence and popularity
                    enhancedScore += 5;
                    break;
                case 'textReplacement':
                    // Text replacements get bonus for exact placeholder matches
                    if (text.toLowerCase() === query.toLowerCase()) {
                        enhancedScore += 15;
                    }
                    break;
            }

            return Math.min(enhancedScore, 100); // Cap at 100
        }

        return calculateStringSimilarity(query, text);
    } catch (error) {
        console.warn('Predictionary search failed, using fallback:', error.message);
        return calculateStringSimilarity(query, text);
    }
}

// Sync display prep — server/local search already ranks results; skip per-item predictionary awaits.
function prepareTagResultsForDisplay(results, query) {
    if (!results || !Array.isArray(results) || !query) return results || [];

    const tagMap = new Map();

    for (const result of results) {
        const tagName = getTagDisplayLabel(result);
        const dedupeKey = getTagDedupeKey(result);
        if (!tagName) continue;

        const textRelevanceScore = getTagTextRelevanceScore(query, tagName);
        const existingScore = getTagScore(result);
        const enhancedConfidence = (textRelevanceScore * 0.35) + (existingScore * 0.65);

        const enhancedTag = {
            ...result,
            type: result.type || 'tag',
            name: getTagInsertName(result),
            title: result.title || tagName,
            predictionaryScore: textRelevanceScore,
            textMatchInfo: getTagTextMatchInfo(tagName, query),
            enhancedConfidence
        };

        if (tagMap.has(dedupeKey)) {
            tagMap.set(dedupeKey, mergeTagResults(tagMap.get(dedupeKey), enhancedTag));
        } else {
            tagMap.set(dedupeKey, enhancedTag);
        }
    }

    return Array.from(tagMap.values());
}

function prepareCharacterResultsForDisplay(results, query) {
    if (!results || !Array.isArray(results) || !query) return results || [];

    const characterMap = new Map();
    const extras = [];

    for (const result of results) {
        if (result.type !== 'character') {
            extras.push(result);
            continue;
        }

        const stringSimilarity = calculateStringSimilarity(query, result.name);
        const existingSimilarity = result.similarity || 0;
        const enhancedSimilarity = (stringSimilarity * 0.6) + (existingSimilarity * 0.4);
        const enhancedResult = {
            ...result,
            stringSimilarity,
            enhancedSimilarity,
            predictionaryScore: stringSimilarity
        };

        if (characterMap.has(result.name)) {
            const existingResult = characterMap.get(result.name);
            if (enhancedSimilarity > (existingResult.enhancedSimilarity || 0)) {
                characterMap.set(result.name, enhancedResult);
            }
        } else {
            characterMap.set(result.name, enhancedResult);
        }
    }

    return extras.concat(Array.from(characterMap.values()));
}

function prepareTextReplacementResultsForDisplay(textReplacements, query) {
    if (!textReplacements || !textReplacements.length || !query) return textReplacements || [];

    return textReplacements.map((replacement) => {
        const nameScore = calculateStringSimilarity(query, replacement.name);
        const placeholderScore = calculateStringSimilarity(query, replacement.placeholder);
        const bestScore = Math.max(nameScore, placeholderScore);
        return {
            ...replacement,
            matchScore: bestScore,
            predictionaryScore: bestScore
        };
    });
}

// Enhanced character ranking with predictionary
async function enhanceCharacterResultsWithPredictionary(results, query) {
    if (!results || !Array.isArray(results) || !query) return results;

    const enhancedResults = [];
    const characterMap = new Map(); // Track best character by name

    for (const result of results) {
        if (result.type === 'character') {
            const predictionaryScore = await calculateEnhancedSimilarity(query, result.name, 'character');
            const existingSimilarity = result.similarity || 0;

            // Combine predictionary score with existing similarity
            const enhancedSimilarity = (predictionaryScore * 0.6) + (existingSimilarity * 0.4);

            const enhancedResult = {
                ...result,
                stringSimilarity: predictionaryScore,
                enhancedSimilarity: enhancedSimilarity,
                predictionaryScore: predictionaryScore
            };

            // Check for duplicates and keep the best one
            if (characterMap.has(result.name)) {
                const existingResult = characterMap.get(result.name);
                const existingScore = existingResult.enhancedSimilarity || 0;

                if (enhancedSimilarity > existingScore) {
                    characterMap.set(result.name, enhancedResult);
                }
            } else {
                characterMap.set(result.name, enhancedResult);
            }
        } else {
            enhancedResults.push(result);
        }
    }

    // Add all unique characters
    for (const character of characterMap.values()) {
        enhancedResults.push(character);
    }

    return enhancedResults;
}

// Enhanced tag results with predictionary and dual match merging
async function enhanceTagResultsWithPredictionary(results, query) {
    if (!results || !Array.isArray(results) || !query) return results;

    const enhancedResults = [];
    const tagMap = new Map(); // Track best tag by name for deduplication

    for (const result of results) {
        const tagName = getTagDisplayLabel(result);
        const dedupeKey = getTagDedupeKey(result);
        if (!tagName) continue;

        if (!result.type) {
            result.type = 'tag';
        }

        const predictionaryScore = await calculateEnhancedSimilarity(query, tagName, 'tag');
        const textRelevanceScore = getTagTextRelevanceScore(query, tagName);
        const blendedTextScore = Math.max(predictionaryScore, textRelevanceScore);
        const existingScore = getTagScore(result);
        const enhancedConfidence = (blendedTextScore * 0.35) + (existingScore * 0.65);

        const enhancedTag = {
            ...result,
            type: 'tag',
            name: getTagInsertName(result),
            title: result.title || tagName,
            predictionaryScore: blendedTextScore,
            textMatchInfo: getTagTextMatchInfo(tagName, query),
            enhancedConfidence
        };

        if (tagMap.has(dedupeKey)) {
            const existingTag = tagMap.get(dedupeKey);
            const mergedTag = mergeTagResults(existingTag, enhancedTag);
            tagMap.set(dedupeKey, mergedTag);
        } else {
            tagMap.set(dedupeKey, enhancedTag);
        }
    }

    // Add all unique tags
    for (const tag of tagMap.values()) {
        enhancedResults.push(tag);
    }

    return enhancedResults;
}

// Enhanced text replacement ranking
async function enhanceTextReplacementResults(textReplacements, query) {
    if (!textReplacements || textReplacements.length === 0 || !query) return textReplacements;

    const enhancedReplacements = [];

    for (const replacement of textReplacements) {
        const nameScore = await calculateEnhancedSimilarity(query, replacement.name, 'textReplacement');
        const placeholderScore = await calculateEnhancedSimilarity(query, replacement.placeholder, 'textReplacement');

        // Use the better score between name and placeholder
        const bestScore = Math.max(nameScore, placeholderScore);

        enhancedReplacements.push({
            ...replacement,
            matchScore: bestScore,
            predictionaryScore: bestScore
        });
    }

    return enhancedReplacements;
}

// Enhanced tag ranking with deduplication
async function enhanceTagResults(tags, query) {
    if (!tags || tags.length === 0 || !query) return tags;

    const enhancedTags = [];
    const tagMap = new Map(); // Track best tag by name

    for (const tag of tags) {
        const tagName = getTagDisplayLabel(tag);
        const dedupeKey = getTagDedupeKey(tag);
        const predictionaryScore = await calculateEnhancedSimilarity(query, tagName, 'tag');
        const textRelevanceScore = getTagTextRelevanceScore(query, tagName);
        const blendedTextScore = Math.max(predictionaryScore, textRelevanceScore);
        const existingScore = getTagScore(tag);
        const enhancedConfidence = (blendedTextScore * 0.35) + (existingScore * 0.65);

        const enhancedTag = {
            ...tag,
            name: getTagInsertName(tag),
            title: tag.title || tagName,
            predictionaryScore: blendedTextScore,
            textMatchInfo: getTagTextMatchInfo(tagName, query),
            enhancedConfidence
        };

        if (tagMap.has(dedupeKey)) {
            const existingTag = tagMap.get(dedupeKey);
            const mergedTag = mergeTagResults(existingTag, enhancedTag);
            tagMap.set(dedupeKey, mergedTag);
        } else {
            tagMap.set(dedupeKey, enhancedTag);
        }
    }

    // Add all unique tags
    for (const tag of tagMap.values()) {
        enhancedTags.push(tag);
    }

    return enhancedTags;
}

// Helper function to get normalized tag count for sorting
function getNormalizedTagCount(tag) {
    if (isLocalTagResult(tag)) {
        const nCount = getTagNCount(tag);
        if (nCount > 100) {
            return nCount;
        }
        const eCount = getTagECount(tag);
        if (eCount) {
            return (eCount / 50000) * 10000;
        }
        return nCount || tag.n || 0;
    }

    return getTagNCount(tag);
}

let rebuildDisplayRaf = 0;
let rebuildDisplayAfterCallback = null;

/** Coalesce multiple WS result packets into one rebuild per frame. */
function scheduleRebuildAndDisplayResults(afterCallback) {
    if (typeof afterCallback === 'function') {
        rebuildDisplayAfterCallback = afterCallback;
    }
    if (rebuildDisplayRaf) return;
    rebuildDisplayRaf = requestAnimationFrame(() => {
        rebuildDisplayRaf = 0;
        const cb = rebuildDisplayAfterCallback;
        rebuildDisplayAfterCallback = null;
        rebuildAndDisplayResults()
            .catch(error => console.error('Error rebuilding autofill display:', error))
            .finally(() => {
                if (cb) cb();
            });
    });
}

// Rebuild and display all results in proper order
async function rebuildAndDisplayResults() {
    if (!currentCharacterAutocompleteTarget) {
        return;
    }
    if (!hasActiveAutofillSessionForTarget(currentCharacterAutocompleteTarget)) {
        return;
    }
    if (!currentSearchRequestId) {
        return;
    }
    if (autofillSessionPacketRequestId !== currentSearchRequestId && !isSearching && !hasSearchServicesInFlight() && !hasAutofillResultsInCache()) {
        return;
    }

    // Collect all results from all services with top 3 limitation for characters and text replacements
    allSearchResults = [];

    // Merge spell check results from all services (prioritize the most comprehensive one)
    const bestSpellCheckResult = getBestSpellCheckResult();

    // Collect character results separately for limiting
    const allCharacterResults = [];
    for (const [serviceName, results] of serviceResults) {
        if (results && Array.isArray(results)) {
            const characterResults = results.filter(result => isCharacterResult(result));
            if (characterResults.length > 0) {
                allCharacterResults.push(...prepareCharacterResultsForDisplay(characterResults, lastSearchQuery));
            }
        }
    }

    // Collect tag results from all services, then merge in one pass
    const allTagResultsRaw = [];
    for (const [, results] of serviceResults) {
        if (results && Array.isArray(results)) {
            for (const result of results) {
                if (isTagResult(result)) {
                    allTagResultsRaw.push(result);
                }
            }
        }
    }
    const allTagResults = allTagResultsRaw.length > 0
        ? prepareTagResultsForDisplay(allTagResultsRaw, lastSearchQuery)
        : [];

    const autofillConfig = currentCharacterAutocompleteTarget
        ? getAutofillConfig(currentCharacterAutocompleteTarget)
        : DEFAULT_AUTOFILL_CONFIG;
    if (isAutofillTagsOnlyMode(autofillConfig)) {
        allSearchResults = allTagResults.map(result => ({ ...result, _isTopTier: false }));
        allSearchResults.sort((a, b) => {
            const aRanking = getCachedComprehensiveRanking(a, lastSearchQuery, null);
            const bRanking = getCachedComprehensiveRanking(b, lastSearchQuery, null);
            if (aRanking.score !== bRanking.score) {
                return bRanking.score - aRanking.score;
            }
            const aName = (getTagDisplayLabel(a) || '').toLowerCase();
            const bName = (getTagDisplayLabel(b) || '').toLowerCase();
            return aName.localeCompare(bName);
        });
        if (currentCharacterAutocompleteTarget) {
            updateAutocompleteDisplay(allSearchResults, currentCharacterAutocompleteTarget);
        }
        updateSearchStatusDisplay();
        return;
    }

    // Merge text replacement results from all services with predictionary enhancement
    const allTextReplacements = getAllTextReplacementResults();
    const enhancedTextReplacements = prepareTextReplacementResultsForDisplay(allTextReplacements, lastSearchQuery);

    // Get Rentan placeholder results
    const dynamicGenerationPlaceholders = getDynamicGenerationPlaceholderResults(lastSearchQuery);

    // Get the best text replacement match for the current query
    const bestTextReplacement = getBestTextReplacementMatch(enhancedTextReplacements, lastSearchQuery);

    // Separate top results from each category and combine them with specific ordering
    const topResults = [];
    const bottomResults = [];

    // Add spell check result to top if it exists
    if (bestSpellCheckResult) {
        topResults.push({ ...bestSpellCheckResult, _isTopTier: true });
    }

    // Sort character results and limit to top 3
    if (allCharacterResults.length > 0) {
        allCharacterResults.sort((a, b) => {
            const aRanking = getCachedComprehensiveRanking(a, lastSearchQuery, bestTextReplacement);
            const bRanking = getCachedComprehensiveRanking(b, lastSearchQuery, bestTextReplacement);
            return bRanking.score - aRanking.score;
        });

        // Take top 3 characters for top results, rest go to bottom
        const topCharacters = allCharacterResults.slice(0, 3);
        const bottomCharacters = allCharacterResults.slice(3);

        topResults.push(...topCharacters.map(result => ({ ...result, _isTopTier: true })));
        bottomResults.push(...bottomCharacters.map(result => ({ ...result, _isTopTier: false })));
    }

    // Sort text replacement results and limit to top 3
    if (enhancedTextReplacements.length > 0) {
        enhancedTextReplacements.sort((a, b) => {
            const aRanking = getCachedComprehensiveRanking(a, lastSearchQuery, bestTextReplacement);
            const bRanking = getCachedComprehensiveRanking(b, lastSearchQuery, bestTextReplacement);
            return bRanking.score - aRanking.score;
        });

        // Take top 3 text replacements for top results, rest go to bottom
        const topTextReplacements = enhancedTextReplacements.slice(0, 3);
        const bottomTextReplacements = enhancedTextReplacements.slice(3);

        topResults.push(...topTextReplacements.map(result => ({ ...result, _isTopTier: true })));
        bottomResults.push(...bottomTextReplacements.map(result => ({ ...result, _isTopTier: false })));
    }

    // Prefix hints (TIME, WEATHER, etc.) — independent of text replacement matches
    if (dynamicGenerationPlaceholders.length > 0) {
        topResults.push(...dynamicGenerationPlaceholders.map(result => ({ ...result, _isTopTier: true })));
    }

    // Add all tag results (no limit) - these are always in bottom tier
    bottomResults.push(...allTagResults.map(result => ({ ...result, _isTopTier: false })));

    // Apply deduplication to remove duplicate results from different services
    const allResultsBeforeDedup = [...topResults, ...bottomResults];
    const dedupedResults = deduplicateResults(allResultsBeforeDedup);

    // Separate back into top and bottom using the _isTopTier marker (not type)
    const finalTopResults = [];
    const finalBottomResults = [];

    for (const result of dedupedResults) {
        if (result._isTopTier) {
            finalTopResults.push(result);
        } else {
            finalBottomResults.push(result);
        }
    }

    // Combine top results with bottom results
    allSearchResults = [...finalTopResults, ...finalBottomResults];

    // Filter results for text replacement searches (queries starting with '!')
    if (lastSearchQuery && lastSearchQuery.startsWith('!')) {
        allSearchResults = allSearchResults.filter(result => result.type === 'textReplacement');
    }

    // Debug logging for ranking (disabled — was recomputing scores on every rebuild for no output)
    // logRankingDebug(allSearchResults, lastSearchQuery);

    // Apply final sorting within top and bottom sections
    allSearchResults.sort((a, b) => {
        const aType = a.type || '';
        const bType = b.type || '';

        // Determine if items are in top or bottom tier using the marker
        const aIsTopTier = a._isTopTier === true;
        const bIsTopTier = b._isTopTier === true;

        // Top tier items always come before bottom tier items
        if (aIsTopTier && !bIsTopTier) return -1;
        if (!aIsTopTier && bIsTopTier) return 1;

        // Within the same tier, apply ranking
        const aRanking = getCachedComprehensiveRanking(a, lastSearchQuery, bestTextReplacement);
        const bRanking = getCachedComprehensiveRanking(b, lastSearchQuery, bestTextReplacement);

        // Compare ranking scores (higher score = better ranking)
        if (aRanking.score !== bRanking.score) {
            return bRanking.score - aRanking.score;
        }

        // For tags, prefer stronger text match tier before generic tiebreakers
        if (aType === 'tag' && bType === 'tag') {
            const aTier = aRanking.textMatchTier || 0;
            const bTier = bRanking.textMatchTier || 0;
            if (aTier !== bTier) {
                return bTier - aTier;
            }
            const aApiConfidence = getRawApiTagConfidence(a);
            const bApiConfidence = getRawApiTagConfidence(b);
            if (aTier === 0 && bTier === 0 && aApiConfidence !== bApiConfidence) {
                return bApiConfidence - aApiConfidence;
            }
            const aNameLen = (getTagDisplayLabel(a) || '').length;
            const bNameLen = (getTagDisplayLabel(b) || '').length;
            if (aNameLen !== bNameLen) {
                return aNameLen - bNameLen;
            }
        }

        // If scores are equal, use tiebreakers in order of importance
        // 1. Exact match priority
        if (aRanking.isExactMatch !== bRanking.isExactMatch) {
            return aRanking.isExactMatch ? -1 : 1;
        }

        // 2. Prefix match priority
        if (aRanking.isPrefixMatch !== bRanking.isPrefixMatch) {
            return aRanking.isPrefixMatch ? -1 : 1;
        }

        // 3. Type hierarchy within same tier
        if (aIsTopTier && bIsTopTier) {
            // Within top tier: spellcheck > characters > textReplacements
            const topTypeOrder = { spellcheck: 4, character: 3, textReplacement: 2, dynamicPlaceholder: 1 };
            const aTopPriority = topTypeOrder[aType] || 0;
            const bTopPriority = topTypeOrder[bType] || 0;
            if (aTopPriority !== bTopPriority) {
                return bTopPriority - aTopPriority;
            }
        } else if (!aIsTopTier && !bIsTopTier) {
            // Within bottom tier: tags have priority over any other types
            if (aType === 'tag' && bType !== 'tag') return -1;
            if (aType !== 'tag' && bType === 'tag') return 1;
        }

        // 4. Frequency/popularity as final tiebreaker
        const aFreq = a.count || a.frequency || 0;
        const bFreq = b.count || b.frequency || 0;
        if (aFreq !== bFreq) {
            return bFreq - aFreq;
        }

        // 5. Alphabetical as absolute last resort
        const aName = (a.name || a.placeholder || '').toLowerCase();
        const bName = (b.name || b.placeholder || '').toLowerCase();
        return aName.localeCompare(bName);
    });

    // Update the display with the sorted results
    if (currentCharacterAutocompleteTarget) {
        updateAutocompleteDisplay(allSearchResults, currentCharacterAutocompleteTarget);
    }

    updateSearchStatusDisplay();
}

// Batched via rAF — search_status_update can arrive many times per keystroke.
function updateSearchStatusDisplay() {
    if (updateStatusRaf) return;
    updateStatusRaf = requestAnimationFrame(() => {
        updateStatusRaf = 0;
        updateSearchStatusDisplayImmediate();
    });
}

// Update the search status display in the autocomplete
function updateSearchStatusDisplayImmediate() {
    if (!characterAutocompleteList) return;
    if (!currentCharacterAutocompleteTarget) {
        return;
    }

    // Create hash of current status to check if update is needed
    const currentStatusHash = createStatusHash();

    // Only update if status actually changed
    if (lastStatusDisplayHash === currentStatusHash) {
        return;
    }

    lastStatusDisplayHash = currentStatusHash;

    // Check if status display already exists
    let statusDisplay = characterAutocompleteList.querySelector('.search-status-display');

    if (!statusDisplay) {
        // Create new status display if it doesn't exist
        statusDisplay = document.createElement('div');
        statusDisplay.className = 'search-status-display';
        characterAutocompleteList.appendChild(statusDisplay);
    }

    if (searchServices.size === 0) {
        return;
    }

    // Only update if we actually have services to show
    const visibleServices = Array.from(searchServices.entries()).filter(([name, status]) => status !== undefined);
    if (visibleServices.length === 0) {
        return;
    }

    // Check if all services are in a completed state (not stalled or searching)
    const allServicesDone = visibleServices.every(([name, status]) => isServiceStatusTerminal(status));

    // Count results for display
    let tagResultsCount = 0;
    let specialResultsCount = 0;

    if (allServicesDone) {
        // Count tag results (API models and local tag services)
        for (const [serviceName, results] of serviceResults) {
            if (serviceName === 'characters' || serviceName === 'textReplacements' || serviceName === 'spellcheck' || serviceName === 'wordLookup' || serviceName === 'searchResults') {
                continue;
            }
            if (results && Array.isArray(results)) {
                tagResultsCount += results.length;
            }
        }

        const charactersResults = serviceResults.get('characters') || [];
        const textReplacementsResults = serviceResults.get('textReplacements') || [];
        specialResultsCount = charactersResults.length + textReplacementsResults.length;
    }

    // Determine display text
    let displayIcon = 'fas fa-search';
    let displayText = 'Searching...';
    if (allServicesDone) {
        if (tagResultsCount > 0) {
            displayText = `${tagResultsCount} Results`;
            if (specialResultsCount > 0) {
                displayText += ` (+${specialResultsCount} Special)`;
            }
            displayIcon = 'fa-light fa-check';
        } else if (specialResultsCount > 0) {
            displayText = `${specialResultsCount} Special Results`;
            displayIcon = 'fa-light fa-check';
        } else {
            displayText = 'No Results';
            displayIcon = 'fa-light fa-question';
        }
    }

    const searchInFlight = isSearching || hasSearchServicesInFlight();

    // Keep status visible after completion, then auto-hide
    if (allServicesDone) {
        statusDisplay.classList.remove('is-searching');
        statusDisplay.classList.remove('hidden');
        statusDisplay.classList.add('search-done');
        scheduleSearchStatusHide();
    } else {
        clearSearchStatusHideTimer();
        statusDisplay.classList.remove('search-done');
        statusDisplay.classList.remove('hidden');
        statusDisplay.classList.toggle('is-searching', searchInFlight);
    }

    let statusHTML = `<div class="search-status-header"><i class="${displayIcon}"></i><span>${displayText}</span></div><div class="search-service-indicators">`;

    // Define the order you want services to appear in the status bar
    const serviceOrder = [
        'spellcheck',
        'wordLookup',
        'characters',
        ANIME_LOCAL_SERVICE,
        FURRY_LOCAL_SERVICE,
        'nai-diffusion-furry-3',
        'textReplacements',
    ];

    const currentModel = getMappedManualModel();

    // Show service status in the defined order, with current model inserted at 5th position
    let serviceCount = 0;
    for (const serviceName of serviceOrder) {
        const status = searchServices.get(serviceName);
        if (status !== undefined) { // Only show services that exist
            const iconClass = getServiceIconClass(serviceName, status);
            const statusClass = getStatusClass(status);
            const displayName = getServiceDisplayName(serviceName);
            statusHTML += `
                <div class="search-service-status ${statusClass}" title="${displayName}: ${status}">
                    <i class="${iconClass}"></i>
                </div>
            `;
            serviceCount++;

            // Insert current model as 5th item (after 4th item)
            if (serviceCount === 4 && searchServices.has(currentModel)) {
                const currentModelStatus = searchServices.get(currentModel);
                const currentModelIconClass = getServiceIconClass(currentModel, currentModelStatus);
                const currentModelStatusClass = getStatusClass(currentModelStatus);
                const currentModelDisplayName = getServiceDisplayName(currentModel);
                statusHTML += `
                    <div class="search-service-status ${currentModelStatusClass}" title="${currentModelDisplayName}: ${currentModelStatus}">
                        <i class="${currentModelIconClass}"></i>
                    </div>
                `;
            }
        }
    }

    // Show any remaining services that weren't in the order list (fallback)
    for (const [serviceName, status] of searchServices) {
        if (!serviceOrder.includes(serviceName)) {
            const iconClass = getServiceIconClass(serviceName, status);
            const statusClass = getStatusClass(status);
            const displayName = getServiceDisplayName(serviceName);
            statusHTML += `
                <div class="search-service-status ${statusClass}" title="${displayName}: ${status}">
                    <i class="${iconClass}"></i>
                </div>
            `;
        }
    }
    statusHTML += '</div>';

    // Update the existing status display instead of recreating it
    statusDisplay.innerHTML = statusHTML;
}

function isServiceStatusInactiveIcon(status) {
    return status === 'searching' ||
        status === 'stalled' ||
        status === 'completed-none' ||
        status === 'completed-noresults' ||
        status === 'completed-noerrors';
}

// Get CSS class for service icon
function getServiceIconClass(serviceName, status) {
    const inactive = isServiceStatusInactiveIcon(status);
    switch (serviceName) {
        case 'nai-diffusion-4-5-full':
        case 'nai-diffusion-4-5':
        case 'nai-diffusion-4-full':
        case 'nai-diffusion-4-curated-preview':
        case 'nai-diffusion-3':
        case 'v4':
        case 'v4_cur':
        case 'v4_5':
        case 'v4_5_cur':
        case 'v3':
            return 'nai-sakura';
        case 'nai-diffusion-furry-3':
        case 'v3_furry':
            return 'nai-paw';
        case FURRY_LOCAL_SERVICE:
            return 'nai-paw';
        case ANIME_LOCAL_SERVICE:
            return (inactive ? 'fa-light' : 'fas') + ' fa-landmark-magnifying-glass';
        case 'dual-match':
            return (inactive ? 'fa-light' : 'fas') + ' fa-link';
        case 'characters':
        case 'cached_characters':
            return (inactive ? 'fa-light' : 'fas') + ' fa-user';
        case 'tags':
        case 'cached_tags':
            return (inactive ? 'fa-light' : 'fas') + ' fa-tag';
        case 'textReplacements':
            return (inactive ? 'fa-light' : 'fas') + ' fa-book-font';
        case 'spellcheck':
            return (inactive ? 'fa-light' : 'fas') + ' fa-spell-check';
        case 'wordLookup':
            return (inactive ? 'fa-light' : 'fas') + ' fa-book';
        case 'cached':
            return (inactive ? 'fa-light' : 'fas') + ' fa-database';
        default:
            // Handle dynamic model names (like nai-diffusion-4-5, nai-diffusion-furry-3, etc.)
            if (serviceName.startsWith('nai-diffusion')) {
                if (serviceName.includes('furry')) {
                    return 'nai-paw';
                } else {
                    return (inactive ? 'fa-light' : 'fas') + ' fa-database';
                }
            }
            return (inactive ? 'fa-light' : 'fas') + ' fa-question';
    }
}

// Get CSS class for status
function getStatusClass(status) {
    switch (status) {
        case 'searching':
            return 'status-searching';
        case 'stalled':
            return 'status-stalled';
        case 'completed':
            return 'status-completed';
        case 'completed-none':
        case 'completed-noresults':
            return 'status-completed-none';
        case 'completed-noerrors':
            return 'status-completed-noerrors';
        case 'error':
            return 'status-error';
        default:
            return 'status-unknown';
    }
}

// Get display name for service
function getServiceDisplayName(serviceName) {
    switch (serviceName) {
        case 'nai-diffusion-4-5-full':
        case 'nai-diffusion-4-5':
        case 'nai-diffusion-4-full':
        case 'nai-diffusion-4-curated-preview':
        case 'nai-diffusion-3':
            return 'NovelAI';
        case 'nai-diffusion-furry-3':
            return 'Furry';
        case FURRY_LOCAL_SERVICE:
            return 'Furry Local';
        case ANIME_LOCAL_SERVICE:
            return 'Anime Local';
        case 'dual-match':
            return 'Dual Match';
        case 'characters':
        case 'cached_characters':
            return 'Characters';
        case 'tags':
        case 'cached_tags':
            return 'Tags';
        case 'textReplacements':
            return 'Genso Expanders';
        case 'spellcheck':
            return 'Spell Check';
        case 'wordLookup':
            return 'Dictionary';
        case 'cached':
            return 'Cache';
        default:
            // Handle dynamic model names (like nai-diffusion-4-5, nai-diffusion-furry-3, etc.)
            if (serviceName.startsWith('nai-diffusion')) {
                if (serviceName.includes('furry')) {
                    return 'Furry v3';
                } else if (serviceName.includes('4-5')) {
                    return 'NovelAI 4.5';
                } else if (serviceName.includes('4')) {
                    return 'NovelAI 4';
                } else if (serviceName.includes('3')) {
                    return 'NovelAI 3';
                } else {
                    return 'NovelAI';
                }
            }
            return serviceName;
    }
}

// Global autofill state
let autofillEnabled = true;

// Autofill toggle functions
function toggleAutofill() {
    autofillEnabled = !autofillEnabled;
    // patchAutofillSearchEnabled: public/scripts/comp/autofillSettings.js
    if (typeof patchAutofillSearchEnabled === 'function') {
        void patchAutofillSearchEnabled(autofillEnabled);
    }
    return autofillEnabled;
}

function setAutofillEnabled(enabled) {
    autofillEnabled = enabled;
}

function isAutofillEnabled() {
    return autofillEnabled;
}

// Expose functions globally
window.toggleAutofill = toggleAutofill;
window.setAutofillEnabled = setAutofillEnabled;
window.isAutofillEnabled = isAutofillEnabled;
window.showAddToFavoritesDialog = showAddToFavoritesDialog;
window.showTextReplacementDialog = showTextReplacementDialog;

/**
 * Word lookup only (for prompt context menu thesaurus submenu).
 * fetchWordLookupForTerm: public/scripts/comp/promptTextareaContextMenu.js
 */
async function fetchWordLookupForTerm(term, textarea) {
    const q = String(term || '').trim();
    if (!q || !textarea) return null;

    persistentWordLookupData = null;

    const prevTarget = currentCharacterAutocompleteTarget;
    contextMenuThesaurusLookupActive = true;
    currentCharacterAutocompleteTarget = textarea;

    const requestId = 'ctx_wl_' + Date.now();
    currentSearchRequestId = requestId;
    currentSearchQuery = q;
    currentSearchTimestamp = Date.now();
    isSearching = true;

    if (!autofillSessionId || autofillSessionTarget !== textarea) {
        autofillSessionId = 'ctx_af_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        autofillSessionTarget = textarea;
    }
    autofillSessionPacketRequestId = null;
    currentSearchSessionBounds = getAutocompleteSearchBounds(textarea) || {
        tokenStart: 0,
        tokenEnd: textarea.value.length,
        query: q,
        isTextPrefix: false
    };

    if (searchServices.size === 0 || !searchServices.has('wordLookup')) {
        initializeAutofillServices();
        servicesInitialized = true;
    }
    searchServices.set('wordLookup', 'searching');
    updateSearchStatusDisplay();

    const modelEl = document.getElementById('manualModel');
    const model = modelEl && modelEl.value ? modelEl.value : 'nai-diffusion-4-5-full';

    try {
        if (window.wsClient && window.wsClient.isConnected()) {
            await window.wsClient.searchCharacters(q, model, {
                requestId,
                autofillSessionId,
                autofillSettings: typeof getAutofillSearchSettings === 'function' ? getAutofillSearchSettings() : undefined
            });
            const deadline = Date.now() + 8000;
            while (Date.now() < deadline) {
                const st = searchServices.get('wordLookup');
                if (st === 'completed' || st === 'completed-none' || st === 'completed-noerrors' || st === 'error') {
                    break;
                }
                await new Promise((resolve) => setTimeout(resolve, 50));
            }
        } else {
            searchServices.set('wordLookup', 'error');
            updateSearchStatusDisplay();
        }
    } catch (err) {
        console.warn('fetchWordLookupForTerm failed:', err);
        searchServices.set('wordLookup', 'error');
        updateSearchStatusDisplay();
    } finally {
        isSearching = false;
        contextMenuThesaurusLookupActive = false;
        hideCharacterAutocomplete();
        markSearchSessionCompleteIfIdle();
        if (currentCharacterAutocompleteTarget === textarea) {
            currentCharacterAutocompleteTarget = prevTarget;
        }
    }

    return getActiveWordLookupData();
}

// Character autocomplete functions
function handleCharacterAutocompleteInput(e) {
    if (autofillOverlayAcceptInFlight) {
        return;
    }

    // Don't trigger autocomplete if autofill is disabled
    if (!autofillEnabled) {
        return;
    }

    // shouldSuppressAutofillFromShortcut: public/scripts/comp/keyboardShortcuts.js
    if (window.shouldSuppressAutofillFromShortcut && window.shouldSuppressAutofillFromShortcut()) {
        return;
    }

    if (e.detail && e.detail.skipAutofill) {
        return;
    }

    const target = e.target;
    if (!target || document.activeElement !== target) {
        return;
    }

    // isTextInputComposing: public/scripts/comp/textareaUtils.js
    if (typeof isTextInputComposing === 'function' && isTextInputComposing(target, e)) {
        return;
    }

    autofillLastInputTime = Date.now();
    trackAutofillCaretMotion(target);

    autofillInputPendingEvent = e;
    if (autofillInputRaf) return;
    autofillInputRaf = requestAnimationFrame(() => {
        autofillInputRaf = 0;
        const pending = autofillInputPendingEvent;
        autofillInputPendingEvent = null;
        if (pending) {
            processCharacterAutocompleteInput(pending);
        }
    });
}

function processCharacterAutocompleteInput(e) {
    const target = e.target;
    if (!target || document.activeElement !== target) {
        return;
    }
    if (typeof isTextInputComposing === 'function' && isTextInputComposing(target, e)) {
        return;
    }

    if (autofillSessionId && autofillSessionTarget === target) {
        if (shouldAbortAutocompleteSearchSession()) {
            // Caret moved to a new token — tear down the stale session but keep processing this keystroke.
            resetStaleAutofillSessionForNewInput();
        } else {
            currentSearchSessionBounds = getAutocompleteSearchBounds(target);
        }
    }

    // Don't trigger autocomplete if we're in navigation mode and user is actively navigating
    if (autocompleteNavigationMode && selectedCharacterAutocompleteIndex >= 0) {
        // Only clear navigation mode if user is typing (not just moving cursor)
        if (e.inputType && e.inputType !== 'insertText') {
            autocompleteNavigationMode = false;
        }
    }

    // Spell-check keyboard nav uses the same overlay but separate state — treat Enter/newline like autocomplete.
    if (isCharacterAutocompleteOverlayOpen() && isAutofillKeyboardNavActive()) {
        if (e.inputType === 'insertLineBreak' || e.inputType === 'insertParagraph') {
            const pos = target.selectionStart;
            const value = target.value;
            if (pos > 0) {
                const ch = value.charAt(pos - 1);
                if (ch === '\n' || ch === '\r') {
                    // setTextareaValuePreservingUndo: public/scripts/comp/textareaUtils.js
                    setTextareaValuePreservingUndo(target, value.slice(0, pos - 1) + value.slice(pos));
                    target.setSelectionRange(pos - 1, pos - 1);
                }
            }
            applyActiveAutofillEnterSelection(target);
            return;
        }
        if (e.inputType && e.inputType !== 'insertText') {
            // Keep spell-check navigation alive for the same input types autocomplete tolerates.
        }
    }

    const value = target.value;

    if (isAutofillSingleToken(target)) {
        if (target.disabled) {
            hideCharacterAutocomplete();
            return;
        }

        const searchText = value.trim();
        const autofillConfig = getEffectiveAutofillConfig(target);

        if (searchText.includes(',') || (!autofillConfig.expanders && searchText.startsWith('!'))) {
            hideCharacterAutocomplete();
            return;
        }

        if (e.inputType === 'deleteContentBackward' && searchText.length < 2) {
            hideCharacterAutocomplete();
            return;
        }

        scheduleAutofillSearchDebounced(target, searchText, function () {
            if (searchText.length >= 2) {
                lastSearchText = searchText;
                searchCharacters(searchText, target);
            } else {
                hideCharacterAutocomplete();
            }
        });

        return;
    }

    const cursorPosition = target.selectionStart;

    // Get the text before the cursor
    const textBeforeCursor = value.substring(0, cursorPosition);

    // Special handling for "Text:" prefix - check for it first
    const textPrefixIndex = textBeforeCursor.lastIndexOf('Text:');
    if (textPrefixIndex >= 0) {
        // Extract the text after "Text:" for spell checking
        const textAfterPrefix = textBeforeCursor.substring(textPrefixIndex + 5).trim();

        // Handle backspace - if actively navigating, start normal search delay
        if (e.inputType === 'deleteContentBackward') {
            // If user is actively navigating or has an item selected, start normal search
            if (autocompleteNavigationMode || selectedCharacterAutocompleteIndex >= 0) {
                scheduleAutofillSearchDebounced(target, 'Text:' + textAfterPrefix, function () {
                    if (textAfterPrefix.length >= 1) {
                        searchCharacters('Text:' + textAfterPrefix, target);
                    } else {
                        hideCharacterAutocomplete();
                    }
                });

                return;
            } else {
                // Not actively navigating, hide autocomplete
                hideCharacterAutocomplete();
                return;
            }
        }

        scheduleAutofillSearchDebounced(target, 'Text:' + textAfterPrefix, function () {
            if (textAfterPrefix.length >= 1) {
                lastSearchText = 'Text:' + textAfterPrefix;
                searchCharacters('Text:' + textAfterPrefix, target);
            } else {
                hideCharacterAutocomplete();
            }
        });

        return;
    }

    const bounds = getAutocompleteSearchBounds(target);
    if (!bounds || !bounds.query) {
        hideCharacterAutocomplete();
        return;
    }
    const searchText = bounds.query;

    // Handle backspace - if actively navigating, start normal search delay
    if (e.inputType === 'deleteContentBackward') {
        // If user is actively navigating or has an item selected, start normal search
        if (autocompleteNavigationMode || selectedCharacterAutocompleteIndex >= 0) {
            scheduleAutofillSearchDebounced(target, searchText, function () {
                if (searchText.startsWith('<') || searchText.length >= 2) {
                    searchCharacters(searchText, target);
                } else {
                    hideCharacterAutocomplete();
                }
            });

            return;
        } else {
            // Not actively navigating, hide autocomplete
            hideCharacterAutocomplete();
            return;
        }
    }

    scheduleAutofillSearchDebounced(target, searchText, function () {
        if (searchText.startsWith('<') || searchText.length >= 2) {
            lastSearchText = searchText;
            searchCharacters(searchText, target);
        } else {
            hideCharacterAutocomplete();
        }
    });

}

/** Strip prompt syntax so wiki / search sees plain tag-like text (see handleCharacterAutocompleteKeydown Alt+Q/W). */
function sanitizePromptFragmentForWikiSearch(s) {
    if (!s || typeof s !== 'string') return '';
    let t = s.trim();
    if (!t) return '';
    t = t.replace(/\b\d+(?:\.\d+)?::/g, '');
    t = t.replace(/::+/g, ' ');
    t = t.replace(/[{}[\]]/g, '');
    t = t.replace(/[()]/g, '');
    t = t.replace(/[<>]/g, '');
    t = t.replace(/\s+/g, ' ').trim();
    const words = t.split(/\s+/).filter(function (w) { return w.length > 0; });
    if (words.length > 8) {
        t = words.slice(-8).join(' ');
    }
    return t.trim();
}

/** Selection if any; else text from previous "," to caret; then sanitize (comma path per Alt+Q/W when autofill closed). */
function getWikiTermFromPromptTextareaForKeyboard(textarea) {
    if (!textarea || typeof textarea.value !== 'string') return '';
    const value = textarea.value;
    const start = typeof textarea.selectionStart === 'number' ? textarea.selectionStart : 0;
    const end = typeof textarea.selectionEnd === 'number' ? textarea.selectionEnd : 0;
    let raw;
    if (start !== end) {
        const a = Math.min(start, end);
        const b = Math.max(start, end);
        raw = value.substring(a, b);
    } else {
        const textBefore = value.substring(0, start);
        const lastComma = textBefore.lastIndexOf(',');
        raw = lastComma >= 0 ? value.substring(lastComma + 1, start) : value.substring(0, start);
    }
    let t = sanitizePromptFragmentForWikiSearch(raw);
    if (t.toLowerCase().startsWith('text:')) {
        t = sanitizePromptFragmentForWikiSearch(t.slice(5));
    }
    return t;
}

/** Fresh autofill at caret without editing text (double Ctrl, or Alt+Space with force). */
function triggerAutofillFreshSearchAtCaret(target) {
    if (!target || !autofillEnabled) return;
    if (characterAutocompleteTimeout) {
        clearTimeout(characterAutocompleteTimeout);
        characterAutocompleteTimeout = null;
    }
    lastSearchQuery = '';
    lastSearchText = '';
    currentSearchQuery = '';
    serviceResults.clear();
    clearDynamicResults();
    allSearchResults = [];
    persistentSpellCheckData = null;
    persistentWordLookupData = null;
    triggerCharacterAutofillSearchAtCaret(target, true);
}

/** Immediate autofill search at caret (Alt+Space); forceRefresh re-runs same query when overlay already open. */
function triggerCharacterAutofillSearchAtCaret(target, forceRefresh) {
    if (!target || !autofillEnabled) return;
    if (characterAutocompleteTimeout) {
        clearTimeout(characterAutocompleteTimeout);
        characterAutocompleteTimeout = null;
    }
    markAutofillOverlayClosedFromInput();
    spellCheckNavigationMode = false;
    wordLookupNavigationMode = false;
    selectedSpellCheckWordIndex = -1;
    selectedSpellCheckSuggestionIndex = -1;
    selectedWordLookupWordIndex = -1;
    selectedWordLookupSuggestionIndex = -1;
    activeWordLookupWordIndex = 0;
    autocompleteExpanded = false;

    const bounds = getAutocompleteSearchBounds(target);
    const searchText = bounds && typeof bounds.query === 'string' ? bounds.query : '';
    if (!searchText || (!searchText.startsWith('<') && searchText.length < 1)) {
        hideCharacterAutocomplete();
        return;
    }
    if (!searchText.startsWith('<') && searchText.length < 2 && !forceRefresh) {
        hideCharacterAutocomplete();
        return;
    }
    searchCharacters(searchText, target, forceRefresh, { explicit: true });
}

function getWikiSearchTermFromAutocompleteItem(selectedItem) {
    if (!selectedItem || !selectedItem.dataset) return '';
    const type = selectedItem.dataset.type;
    if (type === 'character') {
        try {
            const characterData = JSON.parse(selectedItem.dataset.characterData);
            return String(characterData.name || '').trim();
        } catch (err) {
            return '';
        }
    }
    if (type === 'tag') {
        return String(selectedItem.dataset.tagName || '').trim();
    }
    if (type === 'textReplacement' || type === 'dynamicPlaceholder') {
        return String(selectedItem.dataset.placeholder || '').trim();
    }
    return '';
}

function getTagInsertStringForAutocomplete(tagName, category) {
    if (!tagName) return '';
    if (category && category.toLowerCase() === 'artist') {
        if (tagName.includes(' ')) {
            return 'art by ' + tagName;
        }
        return 'artist:' + tagName;
    }
    return tagName;
}

function getAutocompleteRightArrowInsertText(selectedItem) {
    if (!selectedItem || !selectedItem.dataset) return '';
    const type = selectedItem.dataset.type;
    if (type === 'character') {
        try {
            const characterData = JSON.parse(selectedItem.dataset.characterData);
            return characterData.name || '';
        } catch (err) {
            return '';
        }
    }
    if (type === 'tag') {
        return getTagInsertStringForAutocomplete(selectedItem.dataset.tagName, selectedItem.dataset.category);
    }
    if (type === 'textReplacement') {
        return '!' + selectedItem.dataset.placeholder;
    }
    if (type === 'dynamicPlaceholder') {
        return selectedItem.dataset.placeholder;
    }
    return '';
}

/** Resolved expander body for Genso items (see createAutocompleteItem dataset.replacementValue). */
function getTextReplacementExpandTextFromItem(item) {
    if (!item || !item.dataset || item.dataset.type !== 'textReplacement') return '';
    const raw = item.dataset.replacementValue;
    if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
        return String(raw);
    }
    const ph = String(item.dataset.placeholder || '').trim();
    if (/^NAX_(FAV|TRY)_/i.test(ph)) return '';
    if (!ph) return '';
    const map = window.optionsData && window.optionsData.textReplacements;
    if (map && Object.prototype.hasOwnProperty.call(map, ph) && map[ph] !== undefined && map[ph] !== null) {
        return String(map[ph]);
    }
    return '';
}

/**
 * Longest k where a suffix of typedSeg matches a prefix of insertText (case-insensitive).
 * Used for right-arrow autofill (not for ! text expander queries — those use query/last-word only).
 */
function longestTypedSuffixInsertPrefixOverlap(typedSeg, insertText) {
    if (!typedSeg || !insertText) return 0;
    const a = typedSeg.toLowerCase();
    const b = insertText.toLowerCase();
    const maxLen = Math.min(a.length, b.length);
    for (let k = maxLen; k >= 1; k--) {
        if (a.slice(-k) === b.slice(0, k)) {
            return k;
        }
    }
    return 0;
}

function injectAutocompleteSuggestionAtCursor(target, insertText) {
    if (!target || insertText === undefined || insertText === null || insertText === '') return;

    const value = target.value;
    const cursor = typeof target.selectionStart === 'number' ? target.selectionStart : value.length;
    const charBefore = cursor > 0 ? value[cursor - 1] : '';
    const spaceBefore = /\s/.test(charBefore);

    if (spaceBefore) {
        const before = value.substring(0, cursor).replace(/\s+$/, '');
        const after = value.substring(cursor);
        const insertion = ', ' + insertText;
        const replaceStart = before.length;
        // replaceTextareaRangePreservingUndo: public/scripts/comp/textareaUtils.js
        replaceTextareaRangePreservingUndo(target, replaceStart, cursor, insertion);
        const newCursor = replaceStart + insertion.length;
        target.setSelectionRange(newCursor, newCursor);
    } else {
        const bounds = getAutocompleteSearchBounds(target);
        if (!bounds) return;
        const inputRange = resolveTypedInputReplaceRange(value, bounds, cursor);
        if (inputRange) {
            replaceTextareaRangePreservingUndo(target, inputRange.start, inputRange.end, insertText);
            const newCursor = inputRange.start + insertText.length;
            target.setSelectionRange(newCursor, newCursor);
            autoResizeTextarea(target);
            updateEmphasisHighlighting(target);
            return;
        }

        const sliceToCursor = value.substring(bounds.tokenStart, cursor);
        const trimmedSlice = sliceToCursor.trimEnd();
        const q = bounds.query;
        const isTextExpanderQuery = typeof q === 'string' && q.startsWith('!');
        let replaceStart = cursor;

        if (q && trimmedSlice.length >= q.length) {
            const ts = trimmedSlice;
            if (ts.slice(-q.length) === q) {
                replaceStart = bounds.tokenStart + ts.length - q.length;
            } else if (ts.slice(-q.length).toLowerCase() === q.toLowerCase()) {
                replaceStart = bounds.tokenStart + ts.length - q.length;
            }
        }

        // Partial tail match (tags/characters): skip for ! Genso expanders — keep query + last-word fallback only.
        if (replaceStart === cursor && !isTextExpanderQuery) {
            const k = longestTypedSuffixInsertPrefixOverlap(trimmedSlice, insertText);
            if (k >= 2 || (k === 1 && trimmedSlice.length === 1 && insertText.length >= 1)) {
                replaceStart = bounds.tokenStart + trimmedSlice.length - k;
            }
        }

        if (replaceStart === cursor) {
            replaceStart = cursor;
            while (replaceStart > bounds.tokenStart && /\s/.test(value[replaceStart - 1])) {
                replaceStart--;
            }
            while (replaceStart > bounds.tokenStart && !/\s/.test(value[replaceStart - 1])) {
                replaceStart--;
            }
        }
        // replaceTextareaRangePreservingUndo: public/scripts/comp/textareaUtils.js
        replaceTextareaRangePreservingUndo(target, replaceStart, cursor, insertText);
        const newCursor = replaceStart + insertText.length;
        target.setSelectionRange(newCursor, newCursor);
    }

    autoResizeTextarea(target);
    updateEmphasisHighlighting(target);
}

function isAutocompleteEnterKey(e) {
    return e.key === 'Enter' || e.keyCode === 13 || e.code === 'Enter' || e.code === 'NumpadEnter';
}

function isAutofillKeyboardNavActive() {
    return spellCheckNavigationMode || wordLookupNavigationMode || selectedCharacterAutocompleteIndex >= 0;
}

function getWordLookupSection() {
    return characterAutocompleteList?.querySelector('.word-lookup-section');
}

function removeSpellCheckSection() {
    const section = characterAutocompleteList?.querySelector('.spell-check-section');
    if (section) section.remove();
}

function removeWordLookupSection() {
    const section = getWordLookupSection();
    if (section) section.remove();
}

function insertSideSectionAtTop(section) {
    if (!characterAutocompleteList || !section) return;
    const firstItem = characterAutocompleteList.querySelector('.character-autocomplete-item, .spell-check-section, .word-lookup-section');
    if (firstItem) {
        characterAutocompleteList.insertBefore(section, firstItem);
    } else {
        const statusDisplay = characterAutocompleteList.querySelector('.search-status-display');
        if (statusDisplay) {
            characterAutocompleteList.insertBefore(section, statusDisplay);
        } else {
            characterAutocompleteList.appendChild(section);
        }
    }
}

function refreshAutofillSideSections(target) {
    if (!target || !characterAutocompleteList) return;

    removeSpellCheckSection();
    removeWordLookupSection();

    if (persistentSpellCheckData && persistentSpellCheckData.hasErrors) {
        showSpellCheckSuggestions(persistentSpellCheckData, target);
    }

    const wordLookupData = getActiveWordLookupData();
    if (wordLookupData) {
        showWordLookupSection(wordLookupData, target);
    }
}

function getSpellCheckWordCount(section) {
    if (!section) return 0;
    const rows = section.querySelectorAll('.spell-check-word');
    return rows ? rows.length : 0;
}

function getWordLookupWordCount(section) {
    if (!section) return 0;
    const rows = section.querySelectorAll('.word-lookup-word-row');
    return rows ? rows.length : 0;
}

function spellCheckSectionHasSuggestions(section) {
    if (!section) return false;
    const wordSections = section.querySelectorAll('.spell-check-word');
    for (const wordSection of wordSections) {
        if (wordSection.querySelectorAll('.suggestion-btn').length > 0) {
            return true;
        }
    }
    return false;
}

function clearWordLookupNavigationState() {
    wordLookupNavigationMode = false;
    selectedWordLookupWordIndex = -1;
    selectedWordLookupSuggestionIndex = -1;
    updateWordLookupSelection();
}

function clearSpellCheckNavigationState() {
    spellCheckNavigationMode = false;
    selectedSpellCheckWordIndex = -1;
    selectedSpellCheckSuggestionIndex = -1;
    updateSpellCheckSelection();
}

function clearMainAutocompleteSelection() {
    markAutofillOverlayClosedFromInput();
    updateCharacterAutocompleteSelection();
}

function getAutocompleteResultItems() {
    if (!characterAutocompleteList) return [];
    return Array.from(characterAutocompleteList.querySelectorAll('.character-autocomplete-item:not(.no-results)'));
}

function hasAutocompleteResultItemsForNavigation() {
    return getAutocompleteResultItems().length > 0;
}

function canSpellCheckNavigationEnter() {
    const spellCheckSection = characterAutocompleteList?.querySelector('.spell-check-section');
    return spellCheckSectionHasSuggestions(spellCheckSection);
}

function canWordLookupNavigationEnter() {
    const wordLookupSection = getWordLookupSection();
    return !!(wordLookupSection && getWordLookupWordCount(wordLookupSection) > 0);
}

function shouldAutocompleteConsumeVerticalArrow() {
    if (spellCheckNavigationMode || wordLookupNavigationMode) return true;
    if (autocompleteNavigationMode && selectedCharacterAutocompleteIndex >= 0 && hasAutocompleteResultItemsForNavigation()) {
        return true;
    }
    if (canSpellCheckNavigationEnter()) return true;
    if (canWordLookupNavigationEnter()) return true;
    if (hasAutocompleteResultItemsForNavigation()) return true;
    return false;
}

function dismissAutocompleteForTextareaNavigation() {
    if (characterAutocompleteTimeout) {
        clearTimeout(characterAutocompleteTimeout);
        characterAutocompleteTimeout = null;
    }
    if (currentSearchTimeout) {
        clearTimeout(currentSearchTimeout);
        currentSearchTimeout = null;
    }
    autocompleteNavigationMode = false;
    autocompleteExpanded = false;
    userActivelyNavigating = false;
    clearSpellCheckNavigationState();
    clearWordLookupNavigationState();
    hideCharacterAutocomplete();
}

function enterSpellCheckNavigation(preferLastWord = false) {
    const spellCheckSection = characterAutocompleteList?.querySelector('.spell-check-section');
    if (!spellCheckSectionHasSuggestions(spellCheckSection)) {
        return false;
    }

    clearWordLookupNavigationState();
    clearMainAutocompleteSelection();
    spellCheckNavigationMode = true;
    autocompleteNavigationMode = true;
    userActivelyNavigating = true;

    const wordSections = spellCheckSection.querySelectorAll('.spell-check-word');
    selectedSpellCheckWordIndex = preferLastWord ? wordSections.length - 1 : 0;
    selectedSpellCheckSuggestionIndex = 0;
    updateSpellCheckSelection();
    return true;
}

function enterWordLookupNavigation(preferLastWord = false) {
    const wordLookupSection = getWordLookupSection();
    if (!wordLookupSection || getWordLookupWordCount(wordLookupSection) === 0) {
        return false;
    }

    clearSpellCheckNavigationState();
    clearMainAutocompleteSelection();
    wordLookupNavigationMode = true;
    autocompleteNavigationMode = true;
    userActivelyNavigating = true;

    const wordCount = getWordLookupWordCount(wordLookupSection);
    selectedWordLookupWordIndex = preferLastWord ? wordCount - 1 : 0;
    selectedWordLookupSuggestionIndex = 0;
    updateWordLookupSelection();
    return true;
}

function getSelectedWordLookupSuggestionButton() {
    if (!wordLookupNavigationMode) return null;

    const wordLookupSection = getWordLookupSection();
    if (!wordLookupSection) return null;

    const wordSections = wordLookupSection.querySelectorAll('.word-lookup-word-row');
    if (!wordSections || selectedWordLookupWordIndex < 0 || selectedWordLookupWordIndex >= wordSections.length) {
        return null;
    }

    const currentWordSection = wordSections[selectedWordLookupWordIndex];
    const suggestionBtns = currentWordSection.querySelectorAll('.word-lookup-row-expanded .suggestion-btn');
    if (!suggestionBtns || selectedWordLookupSuggestionIndex < 0 || selectedWordLookupSuggestionIndex >= suggestionBtns.length) {
        return null;
    }

    return suggestionBtns[selectedWordLookupSuggestionIndex];
}

function tryApplySelectedWordLookupSuggestion(target) {
    const selectedBtn = getSelectedWordLookupSuggestionButton();
    if (!selectedBtn || !target) return false;
    return applyWordLookupInsert(target, selectedBtn.dataset.original, selectedBtn.dataset.suggestion);
}

function getSelectedSpellCheckSuggestionButton() {
    if (!spellCheckNavigationMode) return null;

    const spellCheckSection = characterAutocompleteList?.querySelector('.spell-check-section');
    if (!spellCheckSection) return null;

    const wordSections = spellCheckSection.querySelectorAll('.spell-check-word');
    if (!wordSections || selectedSpellCheckWordIndex < 0 || selectedSpellCheckWordIndex >= wordSections.length) {
        return null;
    }

    const currentWordSection = wordSections[selectedSpellCheckWordIndex];
    const suggestionBtns = currentWordSection.querySelectorAll('.spell-check-row-expanded .suggestion-btn');
    if (!suggestionBtns || selectedSpellCheckSuggestionIndex < 0 || selectedSpellCheckSuggestionIndex >= suggestionBtns.length) {
        return null;
    }

    return suggestionBtns[selectedSpellCheckSuggestionIndex];
}

function tryApplySelectedSpellCheckSuggestion(target) {
    const selectedBtn = getSelectedSpellCheckSuggestionButton();
    if (!selectedBtn || !target) return false;
    const rowIndex = spellCheckNavigationMode && selectedSpellCheckWordIndex >= 0
        ? selectedSpellCheckWordIndex
        : getSpellCheckRowIndexFromButton(selectedBtn);
    return applySpellCorrection(target, selectedBtn.dataset.original, selectedBtn.dataset.suggestion, rowIndex);
}

function getFirstSpellCheckSuggestionButton(spellCheckSection) {
    const firstWordSection = spellCheckSection?.querySelector('.spell-check-word');
    if (!firstWordSection) return null;
    return firstWordSection.querySelector('.spell-check-row-compact .suggestion-btn')
        || firstWordSection.querySelector('.spell-check-row-expanded .suggestion-btn');
}

function getFirstWordLookupSuggestionButton(wordLookupSection) {
    const firstRow = wordLookupSection?.querySelector('.word-lookup-word-row');
    if (!firstRow) return null;
    return firstRow.querySelector('.word-lookup-row-compact .suggestion-btn')
        || firstRow.querySelector('.word-lookup-row-expanded .suggestion-btn');
}

function applyAutocompleteItemElement(item) {
    if (!item) return false;

    const type = item.dataset.type;
    if (type === 'character') {
        const characterData = JSON.parse(item.dataset.characterData);
        selectCharacterItem(characterData, getCharacterDetailOptionsFromItem(item));
    } else if (type === 'tag') {
        selectTag(item.dataset.tagName, item.dataset.category);
    } else if (type === 'textReplacement') {
        selectTextReplacement(item.dataset.placeholder);
    } else if (type === 'dynamicPlaceholder') {
        selectDynamicPlaceholder(item.dataset.placeholder);
    } else {
        console.error('Unknown item type:', type);
        return false;
    }
    return true;
}

function tryApplySelectedAutocompleteItem() {
    if (selectedCharacterAutocompleteIndex < 0) return false;

    const items = characterAutocompleteList ? characterAutocompleteList.querySelectorAll('.character-autocomplete-item') : [];
    const selectedItem = items[selectedCharacterAutocompleteIndex];
    return applyAutocompleteItemElement(selectedItem);
}

function applyTabAutofillPreview(target) {
    if (!target || autofillOverlayAcceptInFlight) return false;

    autofillOverlayAcceptInFlight = true;
    try {
        if (spellCheckNavigationMode || wordLookupNavigationMode ||
            (autocompleteNavigationMode && selectedCharacterAutocompleteIndex >= 0)) {
            return applyActiveAutofillEnterSelection(target);
        }

        const spellCheckSection = characterAutocompleteList?.querySelector('.spell-check-section');
        if (spellCheckSection && spellCheckSectionHasSuggestions(spellCheckSection)) {
            const firstBtn = getFirstSpellCheckSuggestionButton(spellCheckSection);
            if (firstBtn) {
                return applySpellCorrection(target, firstBtn.dataset.original, firstBtn.dataset.suggestion, getSpellCheckRowIndexFromButton(firstBtn));
            }
        }

        const wordLookupSection = getWordLookupSection();
        if (wordLookupSection && getWordLookupWordCount(wordLookupSection) > 0) {
            const firstBtn = getFirstWordLookupSuggestionButton(wordLookupSection);
            if (firstBtn) {
                return applyWordLookupInsert(target, firstBtn.dataset.original, firstBtn.dataset.suggestion);
            }
        }

        const items = getAutocompleteResultItems();
        if (items.length > 0) {
            return applyAutocompleteItemElement(items[0]);
        }

        return false;
    } finally {
        autofillOverlayAcceptInFlight = false;
    }
}

function applyActiveAutofillEnterSelection(target) {
    if (!isCharacterAutocompleteOverlayOpen()) return false;

    const actionTarget = target || currentCharacterAutocompleteTarget;
    if (!actionTarget) return false;
    if (currentCharacterAutocompleteTarget && actionTarget !== currentCharacterAutocompleteTarget) return false;

    const characterDetailContent = characterAutocompleteList?.querySelector('.character-detail-content');
    if (characterDetailContent) {
        handleCharacterDetailEnter();
        return true;
    }

    // Spell-check, dictionary, and autocomplete share Enter — use the same active nav flag the arrow keys set.
    if (spellCheckNavigationMode) {
        if (tryApplySelectedSpellCheckSuggestion(actionTarget)) {
            return true;
        }
    }

    if (wordLookupNavigationMode) {
        if (tryApplySelectedWordLookupSuggestion(actionTarget)) {
            return true;
        }
    }

    if (selectedCharacterAutocompleteIndex >= 0) {
        return tryApplySelectedAutocompleteItem();
    }

    return false;
}

// Android virtual keyboard may deliver Enter as beforeinput instead of keydown.
function handleCharacterAutocompleteBeforeinput(e) {
    if (e.inputType !== 'insertLineBreak' && e.inputType !== 'insertParagraph') return;

    const target = e.target;
    if (!target || target.type !== 'textarea') return;
    if (!target.classList.contains('prompt-textarea') && !target.classList.contains('character-prompt-textarea')) return;
    // isTextInputComposing: public/scripts/comp/textareaUtils.js
    if (typeof isTextInputComposing === 'function' && isTextInputComposing(target, e)) return;
    if (!isCharacterAutocompleteOverlayOpen()) return;
    if (currentCharacterAutocompleteTarget && target !== currentCharacterAutocompleteTarget) return;

    e.preventDefault();
    applyActiveAutofillEnterSelection(target);
}

function handleCharacterAutocompleteKeydown(e) {
    // Handle emphasis editing popup (but not when toolbar is in emphasis mode)
    if (window.emphasisEditingActive && !e.target.closest('.prompt-textarea-toolbar.emphasis-mode')) {
        // Handle integer inputs (0-9 keys)
        if (e.key >= '0' && e.key <= '9') {
            e.preventDefault();
            const integerValue = parseInt(e.key);

            // Check if there's selected text and apply emphasis directly (only when NOT in emphasis mode)
            if (e.target && e.target.selectionStart !== e.target.selectionEnd && !window.emphasisEditingActive) {
                // Text is selected and NOT in emphasis mode, apply emphasis directly
                // Use current emphasis mode (normal, brace, or group)
                const currentMode = window.emphasisEditingMode || 'normal';
                const success = applyEmphasisDirectly(e.target, integerValue, currentMode);
                if (success) {
                    // Update the emphasis value for future use
                    window.emphasisEditingValue = parseFloat(integerValue.toString());
                    // Update selection highlight to show the new emphasis value
                    if (window.emphasisEditingTarget && window.emphasisEditingSelection) {
                        window.addEmphasisSelectionHighlight(window.emphasisEditingTarget, window.emphasisEditingSelection);
                    }
                    return;
                }
            }

            // Fall back to normal emphasis editing mode
            // Set as a number, not a string
            window.emphasisEditingValue = parseFloat(integerValue.toString());
            // Update selection highlight to show the new emphasis value
            if (window.emphasisEditingTarget && window.emphasisEditingSelection) {
                window.addEmphasisSelectionHighlight(window.emphasisEditingTarget, window.emphasisEditingSelection);
            }
            return;
        }
        return;
    }

    const characterAutocompleteOverlayOpen = characterAutocompleteOverlay && !characterAutocompleteOverlay.classList.contains('hidden');

    // Plain typing on prompt fields — do not run overlay/shortcut logic on keydown (input/beforeinput handle autofill).
    if (!characterAutocompleteOverlayOpen) {
        const t = e.target;
        const isPromptTextarea = t && t.type === 'textarea' &&
            (t.classList.contains('prompt-textarea') || t.classList.contains('character-prompt-textarea'));
        if (isPromptTextarea && e.ctrlKey && e.key !== 'Control') {
            autofillLastCtrlKeydownTime = 0;
        }
        if (isPromptTextarea && !e.ctrlKey && !e.metaKey && !e.altKey) {
            const k = e.key;
            const isPlainTypingKey = k.length === 1 || k === 'Backspace' || k === 'Delete' || k === 'Space' || k === ' ';
            if (isPlainTypingKey && k !== 'Tab' && !(k === 'Backspace' && e.shiftKey)) {
                return;
            }
        }
        if (isPromptTextarea) {
            const isAutofillAltCombo = e.altKey && !e.ctrlKey && !e.metaKey &&
                (e.code === 'Space' || e.key === ' ' || e.key === 'q' || e.key === 'Q' || e.key === 'w' || e.key === 'W');
            if ((e.ctrlKey || e.metaKey || e.altKey) && !isAutofillAltCombo) {
                return;
            }
            if (/^F\d{1,2}$/i.test(e.key)) {
                return;
            }
        }
        if (isPromptTextarea && e.key === 'Control' && !e.altKey && !e.metaKey && !e.shiftKey && !e.repeat) {
            const now = Date.now();
            if (now - autofillLastCtrlKeydownTime < AUTOFILL_DOUBLE_CTRL_MS) {
                e.preventDefault();
                autofillLastCtrlKeydownTime = 0;
                triggerAutofillFreshSearchAtCaret(e.target);
            } else {
                autofillLastCtrlKeydownTime = now;
            }
        }
    }

    // Handle autocomplete navigation - only when autocomplete is visible
    if (characterAutocompleteOverlayOpen) {
        const promptTargetOpen = e.target && e.target.type === 'textarea' &&
            (e.target.classList.contains('prompt-textarea') || e.target.classList.contains('character-prompt-textarea'));
        if (promptTargetOpen && e.ctrlKey && e.key !== 'Control') {
            autofillLastCtrlKeydownTime = 0;
        }
        if (promptTargetOpen && e.key === 'Control' && !e.altKey && !e.metaKey && !e.shiftKey && !e.repeat) {
            const now = Date.now();
            if (now - autofillLastCtrlKeydownTime < AUTOFILL_DOUBLE_CTRL_MS) {
                e.preventDefault();
                e.stopPropagation();
                autofillLastCtrlKeydownTime = 0;
                triggerAutofillFreshSearchAtCaret(e.target);
                return;
            }
            autofillLastCtrlKeydownTime = now;
        }

        // Check if we're in character detail view (enhancers list)
        const characterDetailContent = characterAutocompleteList?.querySelector('.character-detail-content');
        if (characterDetailContent) {
            // Only stop keys we handle — blanket stopPropagation hid all keydowns from document (F3/F4 global shortcuts: public/scripts/comp/keyboardShortcuts.js)
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                e.stopPropagation();
                handleCharacterDetailArrowKeys(e.key);
                return;
            }
            if (isAutocompleteEnterKey(e)) {
                e.preventDefault();
                e.stopPropagation();
                handleCharacterDetailEnter();
                return;
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                hideCharacterDetail();
                return;
            }
            return;
        }

        if (isAutocompleteEnterKey(e)) {
            e.preventDefault();
            e.stopPropagation();
            applyActiveAutofillEnterSelection(e.target);
            return;
        }

        const spellCheckSection = characterAutocompleteList?.querySelector('.spell-check-section');
        const wordLookupSection = getWordLookupSection();
        const resultItems = getAutocompleteResultItems();

        switch (e.key) {
            case 'ArrowDown':
                if (!shouldAutocompleteConsumeVerticalArrow()) {
                    dismissAutocompleteForTextareaNavigation();
                    break;
                }

                e.preventDefault();

                if (!spellCheckNavigationMode && !wordLookupNavigationMode && selectedCharacterAutocompleteIndex === -1) {
                    if (enterSpellCheckNavigation()) {
                        return;
                    }
                    if (enterWordLookupNavigation()) {
                        return;
                    }
                }

                if (spellCheckNavigationMode) {
                    const wordSections = spellCheckSection?.querySelectorAll('.spell-check-word');
                    if (wordSections && selectedSpellCheckWordIndex < wordSections.length - 1) {
                        selectedSpellCheckWordIndex++;
                        selectedSpellCheckSuggestionIndex = 0;
                        updateSpellCheckSelection();
                        return;
                    }

                    clearSpellCheckNavigationState();
                    if (enterWordLookupNavigation()) {
                        return;
                    }
                }

                if (wordLookupNavigationMode) {
                    const wordCount = getWordLookupWordCount(wordLookupSection);
                    if (wordCount && selectedWordLookupWordIndex < wordCount - 1) {
                        selectedWordLookupWordIndex++;
                        selectedWordLookupSuggestionIndex = 0;
                        updateWordLookupSelection();
                        return;
                    }

                    clearWordLookupNavigationState();
                }

                // Normal autocomplete navigation
                markAutofillOverlayInteractive();
                autocompleteNavigationMode = true;
                userActivelyNavigating = true;

                const itemsDown = getAutocompleteResultItems();
                if (!itemsDown.length) {
                    dismissAutocompleteForTextareaNavigation();
                    break;
                }

                if (selectedCharacterAutocompleteIndex === -1) {
                    expandAutocompleteInstantly();
                    const updatedItems = getAutocompleteResultItems();
                    selectedCharacterAutocompleteIndex = updatedItems.length > 0 ? 0 : -1;
                } else {
                    selectedCharacterAutocompleteIndex = Math.min(selectedCharacterAutocompleteIndex + 1, itemsDown.length - 1);
                }
                updateCharacterAutocompleteSelection();
                updateEmphasisTooltipVisibility();

                // Reset the actively navigating flag after a short delay
                clearTimeout(window.navigationTimeout);
                window.navigationTimeout = setTimeout(() => {
                    userActivelyNavigating = false;
                }, 500);
                break;

            case 'ArrowUp': {
                const inAutocompleteNav = autocompleteNavigationMode || spellCheckNavigationMode || wordLookupNavigationMode;

                if (!inAutocompleteNav) {
                    if (characterAutocompleteOverlayOpen) {
                        dismissAutocompleteForTextareaNavigation();
                    }
                    break;
                }

                if (wordLookupNavigationMode && selectedWordLookupWordIndex <= 0) {
                    if (enterSpellCheckNavigation(true)) break;
                    dismissAutocompleteForTextareaNavigation();
                    break;
                }

                if (spellCheckNavigationMode && selectedSpellCheckWordIndex <= 0) {
                    dismissAutocompleteForTextareaNavigation();
                    break;
                }

                if (!spellCheckNavigationMode && !wordLookupNavigationMode && selectedCharacterAutocompleteIndex <= 0) {
                    if (enterWordLookupNavigation(true)) break;
                    if (enterSpellCheckNavigation(true)) break;
                    dismissAutocompleteForTextareaNavigation();
                    break;
                }

                if (!spellCheckNavigationMode && !wordLookupNavigationMode &&
                    !hasAutocompleteResultItemsForNavigation() &&
                    !canSpellCheckNavigationEnter() && !canWordLookupNavigationEnter()) {
                    dismissAutocompleteForTextareaNavigation();
                    break;
                }

                e.preventDefault();

                if (wordLookupNavigationMode) {
                    selectedWordLookupWordIndex--;
                    selectedWordLookupSuggestionIndex = 0;
                    updateWordLookupSelection();
                    break;
                }

                if (spellCheckNavigationMode) {
                    selectedSpellCheckWordIndex--;
                    selectedSpellCheckSuggestionIndex = 0;
                    updateSpellCheckSelection();
                    break;
                }

                markAutofillOverlayInteractive();
                autocompleteNavigationMode = true;
                selectedCharacterAutocompleteIndex = Math.max(selectedCharacterAutocompleteIndex - 1, -1);
                updateCharacterAutocompleteSelection();
                updateEmphasisTooltipVisibility();
                break;
            }

            case 'PageDown':
                if (!shouldAutocompleteConsumeVerticalArrow()) {
                    dismissAutocompleteForTextareaNavigation();
                    break;
                }

                e.preventDefault();

                if (spellCheckNavigationMode) {
                    clearSpellCheckNavigationState();
                }
                if (wordLookupNavigationMode) {
                    clearWordLookupNavigationState();
                }

                // Normal autocomplete navigation
                markAutofillOverlayInteractive();
                autocompleteNavigationMode = true;
                userActivelyNavigating = true;

                const itemsPageDown = getAutocompleteResultItems();
                if (!itemsPageDown.length) {
                    dismissAutocompleteForTextareaNavigation();
                    break;
                }

                if (selectedCharacterAutocompleteIndex === -1) {
                    expandAutocompleteInstantly();
                    const updatedItems = getAutocompleteResultItems();
                    selectedCharacterAutocompleteIndex = updatedItems.length > 0 ? 0 : -1;
                } else {
                    selectedCharacterAutocompleteIndex = Math.min(selectedCharacterAutocompleteIndex + 10, itemsPageDown.length - 1);
                }
                updateCharacterAutocompleteSelection();
                updateEmphasisTooltipVisibility();
                break;

            case 'PageUp':
                if (!shouldAutocompleteConsumeVerticalArrow()) {
                    dismissAutocompleteForTextareaNavigation();
                    break;
                }

                e.preventDefault();

                // If in spell check mode, exit to main list
                if (spellCheckNavigationMode) {
                    clearSpellCheckNavigationState();
                }
                if (wordLookupNavigationMode) {
                    clearWordLookupNavigationState();
                }

                // Normal autocomplete navigation
                markAutofillOverlayInteractive();
                autocompleteNavigationMode = true;
                userActivelyNavigating = true;

                const itemsPageUp = getAutocompleteResultItems();
                if (!itemsPageUp.length) {
                    dismissAutocompleteForTextareaNavigation();
                    break;
                }

                if (selectedCharacterAutocompleteIndex === -1) {
                    expandAutocompleteInstantly();
                    const updatedItems = getAutocompleteResultItems();
                    selectedCharacterAutocompleteIndex = updatedItems.length > 0 ? 0 : -1;
                } else {
                    selectedCharacterAutocompleteIndex = Math.max(selectedCharacterAutocompleteIndex - 10, 0);
                }
                updateCharacterAutocompleteSelection();
                updateEmphasisTooltipVisibility();
                break;

            case 'Home':
                if (!shouldAutocompleteConsumeVerticalArrow()) {
                    dismissAutocompleteForTextareaNavigation();
                    break;
                }

                e.preventDefault();

                // If in spell check mode, exit to main list
                if (spellCheckNavigationMode) {
                    clearSpellCheckNavigationState();
                }
                if (wordLookupNavigationMode) {
                    clearWordLookupNavigationState();
                }

                // Normal autocomplete navigation
                markAutofillOverlayInteractive();
                autocompleteNavigationMode = true;
                userActivelyNavigating = true;

                const itemsHome = getAutocompleteResultItems();
                if (!itemsHome.length) {
                    dismissAutocompleteForTextareaNavigation();
                    break;
                }

                if (selectedCharacterAutocompleteIndex === -1) {
                    expandAutocompleteInstantly();
                }
                selectedCharacterAutocompleteIndex = 0;
                updateCharacterAutocompleteSelection();
                updateEmphasisTooltipVisibility();
                break;

            case 'End':
                if (!shouldAutocompleteConsumeVerticalArrow()) {
                    dismissAutocompleteForTextareaNavigation();
                    break;
                }

                e.preventDefault();

                // If in spell check mode, exit to main list
                if (spellCheckNavigationMode) {
                    clearSpellCheckNavigationState();
                }
                if (wordLookupNavigationMode) {
                    clearWordLookupNavigationState();
                }

                // Normal autocomplete navigation
                markAutofillOverlayInteractive();
                autocompleteNavigationMode = true;
                userActivelyNavigating = true;

                const itemsEnd = getAutocompleteResultItems();
                if (!itemsEnd.length) {
                    dismissAutocompleteForTextareaNavigation();
                    break;
                }

                if (selectedCharacterAutocompleteIndex === -1) {
                    expandAutocompleteInstantly();
                    const updatedItems = getAutocompleteResultItems();
                    selectedCharacterAutocompleteIndex = updatedItems.length > 0 ? updatedItems.length - 1 : -1;
                } else {
                    selectedCharacterAutocompleteIndex = itemsEnd.length - 1;
                }
                updateCharacterAutocompleteSelection();
                updateEmphasisTooltipVisibility();
                break;

            case 'ArrowLeft':
                if (autocompleteNavigationMode || spellCheckNavigationMode || wordLookupNavigationMode) {
                    e.preventDefault();

                    if (spellCheckNavigationMode) {
                        const wordSections = spellCheckSection?.querySelectorAll('.spell-check-word');
                        if (wordSections && selectedSpellCheckWordIndex >= 0 && selectedSpellCheckWordIndex < wordSections.length) {
                            if (selectedSpellCheckSuggestionIndex > 0) {
                                selectedSpellCheckSuggestionIndex--;
                                updateSpellCheckSelection();
                            }
                        }
                        return;
                    }

                    if (wordLookupNavigationMode) {
                        const wordCount = getWordLookupWordCount(wordLookupSection);
                        if (wordCount && selectedWordLookupWordIndex >= 0 && selectedWordLookupWordIndex < wordCount) {
                            if (selectedWordLookupSuggestionIndex > 0) {
                                selectedWordLookupSuggestionIndex--;
                                updateWordLookupSelection();
                            }
                        }
                        return;
                    }

                    if (selectedCharacterAutocompleteIndex >= 0) {
                        hideCharacterAutocomplete();
                        autocompleteNavigationMode = false;
                    } else {
                        hideCharacterAutocomplete();
                        autocompleteNavigationMode = false;
                    }
                }
                break;

            case 'ArrowRight':
                if (autocompleteNavigationMode || spellCheckNavigationMode || wordLookupNavigationMode) {
                    e.preventDefault();

                    if (spellCheckNavigationMode) {
                        const wordSections = spellCheckSection?.querySelectorAll('.spell-check-word');
                        if (wordSections && selectedSpellCheckWordIndex >= 0 && selectedSpellCheckWordIndex < wordSections.length) {
                            const currentWordSection = wordSections[selectedSpellCheckWordIndex];
                            const suggestionBtns = currentWordSection.querySelectorAll('.spell-check-row-expanded .suggestion-btn');
                            if (selectedSpellCheckSuggestionIndex < suggestionBtns.length - 1) {
                                selectedSpellCheckSuggestionIndex++;
                                updateSpellCheckSelection();
                            }
                        }
                        return;
                    }

                    if (wordLookupNavigationMode) {
                        const activeRow = wordLookupSection?.querySelector(`.word-lookup-word-row[data-word-index="${selectedWordLookupWordIndex}"]`);
                        if (activeRow) {
                            const suggestionBtns = activeRow.querySelectorAll('.word-lookup-row-expanded .suggestion-btn');
                            if (selectedWordLookupSuggestionIndex < suggestionBtns.length - 1) {
                                selectedWordLookupSuggestionIndex++;
                                updateWordLookupSelection();
                            }
                        }
                        return;
                    }

                    // Inject suggestion: comma + suffix if space before cursor, else replace query span.
                    // Genso (!) expanders: insert expanded text (same as insertTextReplacement), not literal !placeholder.
                    if (selectedCharacterAutocompleteIndex >= 0 && resultItems.length > 0) {
                        const selectedItem = resultItems[selectedCharacterAutocompleteIndex];
                        if (selectedItem.dataset.type === 'textReplacement') {
                            const expandText = getTextReplacementExpandTextFromItem(selectedItem);
                            if (expandText && currentCharacterAutocompleteTarget) {
                                insertTextReplacement(expandText);
                                return;
                            }
                        }
                        const insertText = getAutocompleteRightArrowInsertText(selectedItem);
                        if (insertText && currentCharacterAutocompleteTarget) {
                            const originalValue = currentCharacterAutocompleteTarget.value || '';
                            const originalCursorPosition = typeof currentCharacterAutocompleteTarget.selectionStart === 'number'
                                ? currentCharacterAutocompleteTarget.selectionStart
                                : originalValue.length;
                            const hadWhitespaceBeforeCursor = /\s/.test(
                                originalCursorPosition > 0 ? originalValue[originalCursorPosition - 1] : ''
                            );
                            injectAutocompleteSuggestionAtCursor(currentCharacterAutocompleteTarget, insertText);
                            let restoredCursorPosition = Math.min(
                                originalCursorPosition,
                                currentCharacterAutocompleteTarget.value.length
                            );
                            if (hadWhitespaceBeforeCursor) {
                                const expectedInsertStart = originalValue.substring(0, originalCursorPosition).replace(/\s+$/, '').length;
                                const expectedInsertPrefix = ', ' + insertText;
                                if (currentCharacterAutocompleteTarget.value.substring(expectedInsertStart, expectedInsertStart + expectedInsertPrefix.length) === expectedInsertPrefix) {
                                    restoredCursorPosition = expectedInsertStart;
                                }
                            }
                            currentCharacterAutocompleteTarget.setSelectionRange(restoredCursorPosition, restoredCursorPosition);
                            currentCharacterAutocompleteTarget.focus();
                            return;
                        }
                    }
                }
                break;
            case 'Tab':
                if (characterAutocompleteOverlay && !characterAutocompleteOverlay.classList.contains('hidden')) {
                    if (wordLookupNavigationMode || spellCheckNavigationMode || !autocompleteNavigationMode) {
                        e.preventDefault();
                        e.stopPropagation();
                        applyTabAutofillPreview(currentCharacterAutocompleteTarget);
                        return;
                    }
                }
                break;

            case 'q':
            case 'Q':
                if (e.altKey && !e.ctrlKey && !e.metaKey) {
                    e.preventDefault();
                    if (selectedCharacterAutocompleteIndex >= 0 && resultItems.length > 0) {
                        const selectedItem = resultItems[selectedCharacterAutocompleteIndex];
                        const wikiTerm = getWikiSearchTermFromAutocompleteItem(selectedItem);
                        if (wikiTerm && window.tagWikiSearchModal) {
                            hideCharacterAutocomplete();
                            autocompleteNavigationMode = false;
                            autocompleteExpanded = false;
                            window.tagWikiSearchModal.openSearchForTerm(wikiTerm);
                        }
                    }
                }
                break;

            case 'w':
            case 'W':
                if (e.altKey && !e.ctrlKey && !e.metaKey) {
                    e.preventDefault();
                    if (selectedCharacterAutocompleteIndex >= 0 && resultItems.length > 0) {
                        const selectedItem = resultItems[selectedCharacterAutocompleteIndex];
                        const wikiTerm = getWikiSearchTermFromAutocompleteItem(selectedItem);
                        if (wikiTerm && window.tagWikiSearchModal) {
                            window.tagWikiSearchModal.openStandaloneWikiIfDirectMatch(wikiTerm);
                        }
                    }
                }
                break;

            case ' ':
                if (e.altKey && !e.ctrlKey && !e.metaKey && (e.code === 'Space' || e.key === ' ')) {
                    if (!autofillEnabled) break;
                    e.preventDefault();
                    const promptTarget = (currentCharacterAutocompleteTarget && currentCharacterAutocompleteTarget === e.target)
                        ? currentCharacterAutocompleteTarget
                        : (e.target && e.target.type === 'textarea' ? e.target : currentCharacterAutocompleteTarget);
                    if (promptTarget && (promptTarget.classList.contains('prompt-textarea') || promptTarget.classList.contains('character-prompt-textarea'))) {
                        triggerCharacterAutofillSearchAtCaret(promptTarget, true);
                    }
                }
                break;

            case 'f':
            case 'F':
                if (e.altKey) {
                    e.preventDefault();

                    // Add selected item to favorites
                    if (selectedCharacterAutocompleteIndex >= 0 && resultItems.length > 0) {
                        const selectedItem = resultItems[selectedCharacterAutocompleteIndex];
                        if (selectedItem) {
                            addToFavorites(selectedItem);
                        }
                    }
                    return;
                }
                break;

            case 'Escape':
                e.preventDefault();
                if (spellCheckNavigationMode) {
                    clearSpellCheckNavigationState();
                } else if (wordLookupNavigationMode) {
                    clearWordLookupNavigationState();
                } else if (characterAutocompleteOverlay && !characterAutocompleteOverlay.classList.contains('hidden')) {
                    // Autocomplete popup is visible, close it
                    hideCharacterAutocomplete();
                    autocompleteNavigationMode = false;
                } else {
                    // Autocomplete popup is not visible, unfocus the textarea
                    if (e.target && e.target.blur) {
                        e.target.blur();
                    }
                }
                break;
            case 'Backspace':
                if (e.shiftKey && document.activeElement.type === 'textarea' && (document.activeElement.classList.contains('prompt-textarea') || document.activeElement.classList.contains('character-prompt-textarea'))) {
                    e.preventDefault();
                    deleteTagBehindCursor(document.activeElement);
                }
                break;
        }
    } else {
        const t = e.target;
        const isPromptTextarea = t && t.type === 'textarea' &&
            (t.classList.contains('prompt-textarea') || t.classList.contains('character-prompt-textarea'));
        if (isPromptTextarea && e.key === 'Control' && !e.altKey && !e.metaKey && !e.shiftKey && !e.repeat) {
            const now = Date.now();
            if (now - autofillLastCtrlKeydownTime < AUTOFILL_DOUBLE_CTRL_MS) {
                e.preventDefault();
                autofillLastCtrlKeydownTime = 0;
                triggerAutofillFreshSearchAtCaret(t);
            } else {
                autofillLastCtrlKeydownTime = now;
            }
        }
        if (isPromptTextarea && e.altKey && !e.ctrlKey && !e.metaKey) {
            if (e.code === 'Space' || e.key === ' ') {
                if (!autofillEnabled) {
                    // no-op: allow default when autofill is off
                } else {
                    e.preventDefault();
                    triggerCharacterAutofillSearchAtCaret(t, true);
                }
            } else if (e.key === 'q' || e.key === 'Q') {
                const wikiTerm = getWikiTermFromPromptTextareaForKeyboard(t);
                if (wikiTerm && window.tagWikiSearchModal) {
                    e.preventDefault();
                    window.tagWikiSearchModal.openSearchForTerm(wikiTerm);
                }
            } else if (e.key === 'w' || e.key === 'W') {
                const wikiTerm = getWikiTermFromPromptTextareaForKeyboard(t);
                if (wikiTerm && window.tagWikiSearchModal) {
                    e.preventDefault();
                    window.tagWikiSearchModal.openStandaloneWikiIfDirectMatch(wikiTerm);
                }
            }
        }
        if (!manualModal.classList.contains('hidden')) {
            switch (e.key) {
                case 'Tab':
                    if (document.activeElement.type === 'textarea' && (document.activeElement.classList.contains('prompt-textarea') || document.activeElement.classList.contains('character-prompt-textarea'))) {
                        if (e.metaKey || e.ctrlKey || e.altKey)
                            return;
                        e.preventDefault();
                        handlePromptTabCycling(e);
                    }
                    break;
                case 'Backspace':
                    if (e.shiftKey && document.activeElement.type === 'textarea' && (document.activeElement.classList.contains('prompt-textarea') || document.activeElement.classList.contains('character-prompt-textarea'))) {
                        e.preventDefault();
                        deleteTagBehindCursor(document.activeElement);
                    }
                    break;

                case 'f':
                case 'F':
                    if (e.altKey && document.activeElement.type === 'textarea' &&
                        (document.activeElement.classList.contains('prompt-textarea') ||
                            document.activeElement.classList.contains('character-prompt-textarea'))) {

                        const selectedText = getSelectedTextFromTextarea(document.activeElement);
                        if (selectedText && selectedText.trim()) {
                            e.preventDefault();
                            showAddToFavoritesDialog(selectedText.trim());
                        }
                    }
                    break;
            }
        }
    }
}



// Note: performSpellCheck function removed to prevent duplicate requests
// All spellcheck functionality is now handled by triggerSpellCheck only

async function searchCharacters(query, target, forceRefresh, options) {
    const searchOptions = options || {};
    const explicitSession = searchOptions.explicit === true;

    try {
        if (!target || document.activeElement !== target) {
            return;
        }
        if (!ensureAutofillSession(target, explicitSession)) {
            return;
        }

        // Prevent duplicate searches for the same query while the current request is active
        // and at least one server packet has already been accepted for this request id.
        if (!forceRefresh && currentSearchQuery === query && isSearching &&
            currentSearchRequestId && autofillSessionPacketRequestId === currentSearchRequestId) {
            console.log(`🔄 Skipping duplicate search for query: "${query}"`);
            console.log(`🔍 Current search state: query="${currentSearchQuery}", isSearching=${isSearching}`);
            return;
        }

        // Clear any existing search timeout
        if (currentSearchTimeout) {
            clearTimeout(currentSearchTimeout);
            currentSearchTimeout = null;
        }
        clearSearchStatusHideTimer();

        // Update current search query
        currentSearchQuery = query;

        // Generate UUID for this search request
        currentSearchRequestId = 'search_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        const thisSearchRequestId = currentSearchRequestId;
        currentSearchTimestamp = Date.now();
        onAutofillSearchRequestStarted(thisSearchRequestId);

        // Only clear results if this is a completely new search query
        // But don't clear searchServices - we want to preserve service status
        if (forceRefresh || lastSearchQuery !== query) {
            // Check if this is a continuation of the same search (just more characters)
            const isContinuation = !forceRefresh && lastSearchQuery && query.startsWith(lastSearchQuery);

            if (!isContinuation) {
                // This is a completely different search, clear results but preserve services
                serviceResults.clear();
                clearDynamicResults();
                allSearchResults = [];

                // Don't reset services initialization - keep the services visible
                // Only reset if we have no services at all
                if (searchServices.size === 0) {
                    servicesInitialized = false;
                }
            } else {
                clearDynamicResults();
            }

            lastSearchQuery = query;
        }

        isSearching = true;
        searchCompletionStatus = {
            totalServices: 0,
            completedServices: 0,
            isComplete: false
        };

        // Clear persistent state for new search
        persistentSpellCheckData = null;
        persistentWordLookupData = null;
        isAutocompleteVisible = false;


        // Set the current target for autocomplete
        currentCharacterAutocompleteTarget = target;
        currentSearchSessionBounds = getAutocompleteSearchBounds(target);
        const searchBounds = currentSearchSessionBounds;
        const spellCheckText = searchBounds && searchBounds.spellCheckText
            ? searchBounds.spellCheckText
            : query;
        const wsIsContinuation = !forceRefresh && !!(lastSearchQuery && query.startsWith(lastSearchQuery) && query.length > lastSearchQuery.length);

        if (shouldAbortAutocompleteSearchSession()) {
            abortAutocompleteSearchSession();
            return;
        }

        // Initialize services if this is the first time in this autofill session
        ensureAutofillServicesForTarget(target);

        // Check if query starts with ! - only return text replacements in this case
        const isTextReplacementSearch = query.startsWith('!');
        const isTextPrefixSearch = query.startsWith('Text:');
        const autofillConfig = getEffectiveAutofillConfig(target);

        if (!autofillConfig.expanders && isTextReplacementSearch) {
            hideCharacterAutocomplete();
            isSearching = false;
            return;
        }

        if (autofillConfig.singleToken && query.includes(',')) {
            hideCharacterAutocomplete();
            isSearching = false;
            return;
        }

        if (!isTextReplacementSearch && !isTextPrefixSearch) {
            markAutofillServicesSearchingForConfig(autofillConfig);
        }

        showAutofillLoadingShell(target);
        updateSearchStatusDisplay();

        let searchResults = [];
        let spellCheckData = null;

        if (!isTextReplacementSearch && !isTextPrefixSearch) {

            // Use WebSocket for search - this will handle characters, tags, and textReplacements server-side
            if (window.wsClient && window.wsClient.isConnected()) {
                try {
                    // Send ack-less search request (responses handled by global handler)
                    await window.wsClient.searchCharacters(query, manualModel.value, {
                        requestId: currentSearchRequestId,
                        autofillSessionId: autofillSessionId,
                        spellCheckText: spellCheckText,
                        isContinuation: wsIsContinuation,
                        autofillSettings: typeof getAutofillSearchSettings === 'function' ? getAutofillSearchSettings() : undefined
                    });

                    if (currentSearchRequestId !== thisSearchRequestId) {
                        isSearching = false;
                        return;
                    }
                    if (shouldAbortAutocompleteSearchSession()) {
                        abortAutocompleteSearchSession();
                        return;
                    }

                    // Note: Spellcheck is now handled server-side as an independent service
                    // The backend will send status updates for characters, tags, textReplacements, and spellcheck
                    // Results will be processed by the global handleSearchResponse function
                } catch (wsError) {
                    console.error('WebSocket search failed:', wsError);
                    markAutofillServicesErrorForConfig(autofillConfig);
                    updateSearchStatusDisplay();
                    throw new Error('Search service unavailable');
                }
            } else {
                throw new Error('WebSocket not connected');
            }
        }

        // Handle PICK suffix stripping for search but preserve in inserted text
        let searchQuery = query;
        let hasPickSuffix = false;

        if (query.startsWith('!') && (query.includes('~') || query.includes('~+'))) {
            // Extract the name between ! and ~ or ~+
            const match = query.match(/^!([^~+]+)[~+]/);
            if (match) {
                searchQuery = match[1]; // Remove ! and suffix for searching
                hasPickSuffix = true;
            }
        }

        // For text replacement searches, update service status and perform search
        if (isTextReplacementSearch) {
            // Initialize text replacement service for text replacement searches
            searchServices.set('textReplacements', 'stalled');
            searchServices.set('spellcheck', 'stalled');
            updateSearchStatusDisplay();

            // Perform text replacement search via WebSocket
            if (window.wsClient && window.wsClient.isConnected()) {
                try {
                    await window.wsClient.searchCharacters(query, manualModel.value, {
                        requestId: currentSearchRequestId,
                        autofillSessionId: autofillSessionId,
                        spellCheckText: spellCheckText,
                        isContinuation: wsIsContinuation,
                        autofillSettings: typeof getAutofillSearchSettings === 'function' ? getAutofillSearchSettings() : undefined
                    });

                    if (currentSearchRequestId !== thisSearchRequestId) {
                        isSearching = false;
                        return;
                    }
                    if (shouldAbortAutocompleteSearchSession()) {
                        abortAutocompleteSearchSession();
                        return;
                    }
                } catch (wsError) {
                    console.error('WebSocket text replacement search failed:', wsError);
                    searchServices.set('textReplacements', 'error');
                    updateSearchStatusDisplay();
                }
            }
        }

        // Note: Text replacements are now handled server-side via WebSocket
        // The server will send status updates for the textReplacements service
        // For "Text:" searches, extract the text after the prefix for spell checking
        if (isTextPrefixSearch) {
            searchQuery = searchQuery.substring(5).trim(); // Remove "Text:" prefix

            // Initialize spellcheck service as stalled, then mark as searching
            searchServices.set('spellcheck', 'stalled');
            updateSearchStatusDisplay();

            setTimeout(() => {
                searchServices.set('spellcheck', 'searching');
                updateSearchStatusDisplay();
            }, 100);

            // For "Text:" searches, send the full query to trigger spell checking
            if (window.wsClient && window.wsClient.isConnected()) {
                try {
                    // Send ack-less search request - spell check results will come via real-time updates
                    await window.wsClient.searchCharacters(query, manualModel.value, {
                        requestId: currentSearchRequestId,
                        autofillSessionId: autofillSessionId,
                        spellCheckText: spellCheckText,
                        isContinuation: wsIsContinuation,
                        autofillSettings: typeof getAutofillSearchSettings === 'function' ? getAutofillSearchSettings() : undefined
                    });

                    if (currentSearchRequestId !== thisSearchRequestId) {
                        isSearching = false;
                        return;
                    }
                    if (shouldAbortAutocompleteSearchSession()) {
                        abortAutocompleteSearchSession();
                        return;
                    }

                    // For "Text:" searches, we only want spell check results
                    // Clear any other search results
                    searchResults = [];

                    // Spell check results will be displayed via real-time updates
                    // No need to manually process response here
                } catch (wsError) {
                    console.error('WebSocket spell check failed:', wsError);
                    // Mark spellcheck service as error
                    searchServices.set('spellcheck', 'error');
                    updateSearchStatusDisplay();
                    // Continue without spell check
                }
            }
        }

        // Add search results to the collection (only for non-"Text:" searches)
        if (!isTextPrefixSearch && searchResults.length > 0) {
            serviceResults.set('searchResults', searchResults);
        }

        if (currentSearchRequestId !== thisSearchRequestId) {
            isSearching = false;
            return;
        }
        if (shouldAbortAutocompleteSearchSession()) {
            abortAutocompleteSearchSession();
            return;
        }

        // Further results arrive via handleSearchResponse

    } catch (error) {
        console.error('Character and tag search error:', error);
        hideCharacterAutocomplete();

        // Clear search state on error
        isSearching = false;
        currentSearchQuery = ''; // Reset current search query
        searchServices.clear();
        serviceResults.clear();
        allSearchResults = [];
        searchCompletionStatus = {
            totalServices: 0,
            completedServices: 0,
            isComplete: false
        };

        // Reset services initialization flag for next autofill session
        servicesInitialized = false;
    }
}

// Unified function to create autocomplete items
function createAutocompleteItem(result) {
    const item = document.createElement('div');
    item.className = 'character-autocomplete-item';

    if (result.type === 'textReplacement') {
        // Handle text replacement results
        item.dataset.type = 'textReplacement';
        item.dataset.placeholder = result.placeholder;
        item.dataset.replacementValue = result.replacementValue || result.description;

        // Use displayName if available, otherwise use placeholder
        let displayName = result.displayName || result.placeholder;
        if (result.category && displayName.startsWith(result.category + ':')) {
            displayName = displayName.slice(result.category.length + 1);
        }

        // Get the replacement value to display
        const replacementValue = result.replacementValue || result.description;

        // Create match type indicator
        let matchIndicator = '';
        if (result.matchType && result.matchType !== 'all') {
            const matchTypeLabels = {
                'exact_key': 'Exact Key',
                'key_starts_with': 'Key Starts',
                'key_contains': 'Key Contains',
                'exact_content': 'Exact Content',
                'content_starts_with': 'Content Starts',
                'content_contains': 'Content Contains',
                'exact_array_content': 'Exact Array',
                'array_content_starts_with': 'Array Starts',
                'array_content_contains': 'Array Contains'
            };
            const matchLabel = matchTypeLabels[result.matchType] || result.matchType;
            matchIndicator = `<span class="match-type-badge">${matchLabel}</span>`;
        }

        item.innerHTML = `
            <div class="character-info-row">
                <span class="character-name">${displayName}${matchIndicator}</span>
                <span class="character-copyright">Expander</span>
            </div>
            <div class="character-info-row">
                <div class="placeholder-desc">
                    <span class="placeholder-desc-text">${replacementValue}</span>
                </div>
            </div>
        `;

        item.addEventListener('click', (e) => {
            e.preventDefault();
            selectTextReplacement(result.placeholder);
        });
        item.addEventListener('touchend', (e) => {
            const maxDelta = touchSlopUtils.finalizeTouchSlop(item, e);
            if (!touchSlopUtils.isTouchSlopTap(maxDelta)) return;
            e.preventDefault();
            selectTextReplacement(result.placeholder);
        }, { passive: false });
    } else if (result.type === 'dynamicPlaceholder') {
        // Handle dynamic generation placeholder results
        item.dataset.type = 'dynamicPlaceholder';
        item.dataset.placeholder = result.placeholder;

        item.innerHTML = `
            <div class="character-info-row">
                <span class="character-name">${result.displayName}</span>
                <span class="character-copyright">Dynamic</span>
            </div>
            <div class="character-info-row">
                <div class="placeholder-desc">
                    <span class="placeholder-desc-text">${result.description}</span>
                </div>
            </div>
        `;

        item.addEventListener('click', (e) => {
            e.preventDefault();
            selectDynamicPlaceholder(result.placeholder);
        });
        item.addEventListener('touchend', (e) => {
            const maxDelta = touchSlopUtils.finalizeTouchSlop(item, e);
            if (!touchSlopUtils.isTouchSlopTap(maxDelta)) return;
            e.preventDefault();
            selectDynamicPlaceholder(result.placeholder);
        }, { passive: false });
    } else if (isCharacterResult(result) && result.character) {
        applyCharacterResultToAutocompleteItem(item, result);
    } else if (isTagResult(result)) {
        applyTagResultToAutocompleteItem(item, result);
    } else {
        // Handle other unknown types
        item.dataset.type = 'unknown';
        const name = result.name || result.tag || 'Unknown';
        const service = result.serviceName || result.model || 'Unknown Service';

        item.innerHTML = `
            <div class="character-info-row">
                <span class="character-name">${name}</span>
                <span class="character-copyright">${service}</span>
            </div>
        `;

        item.addEventListener('click', (e) => {
            e.preventDefault();
        });
        item.addEventListener('touchend', (e) => {
            const maxDelta = touchSlopUtils.finalizeTouchSlop(item, e);
            if (!touchSlopUtils.isTouchSlopTap(maxDelta)) return;
            e.preventDefault();
        }, { passive: false });
    }

    touchSlopUtils.registerTouchSlopTracking(item);

    return item;
}

function showCharacterAutocompleteSuggestions(results, target, spellCheckData = null) {
    if (!characterAutocompleteList || !characterAutocompleteOverlay) {
        console.error('Character autocomplete elements not found');
        return;
    }

    if (!shouldApplyAutocompleteUI(target)) {
        return;
    }
    if (!canShowAutofillOverlay(target)) {
        return;
    }

    currentCharacterAutocompleteTarget = target;

    // Force expansion on mobile or when no mouse input is available (e.g. touch only)
    const isMobile = (window.deviceUtils && window.deviceUtils.isMobileDevice()) ||
        (window.matchMedia && !window.matchMedia('(pointer: fine)').matches);

    if (isMobile) {
        autocompleteExpanded = true;
        if (characterAutocompleteOverlay) {
            characterAutocompleteOverlay.classList.add('expanded');
        }
    }

    // Store all results for potential expansion
    window.allAutocompleteResults = results;

    const autofillConfig = getAutofillConfig(target);

    // Filter out spell check and dictionary results from main display
    let displayResults = filterAutofillDisplayResults(results, autofillConfig);
    const preserveSelection = shouldPreserveAutofillListSelection();
    if (preserveSelection && selectedCharacterAutocompleteIndex >= 0 && displayResults.length > 0) {
        storeCurrentSelection();
    } else {
        lastSelectedListIndex = -1;
    }
    const spellCheckResult = autofillConfig.spellcheck
        ? results.find(result => result.type === 'spellcheck')
        : null;

    // Show all results if expanded, otherwise show only first 5 items
    const limitedResults = autocompleteExpanded ? displayResults : displayResults.slice(0, 5);

    // Clear only the results section, not the entire list
    // This preserves the search status display
    const existingResults = characterAutocompleteList.querySelectorAll('.character-autocomplete-item, .spell-check-section, .word-lookup-section, .no-results, .more-indicator, .character-detail-content');
    existingResults.forEach(item => item.remove());

    // Note: Search status will be added at the bottom after results

    // Handle spell check using the new system
    let currentSpellCheckData = null;
    if (autofillConfig.spellcheck && spellCheckResult && spellCheckResult.data && spellCheckResult.data.hasErrors) {
        currentSpellCheckData = attachSpellCheckTermBounds(spellCheckResult.data, target);
        window.currentSpellCheckData = currentSpellCheckData;
        persistentSpellCheckData = currentSpellCheckData;
    } else if (autofillConfig.spellcheck && spellCheckData && spellCheckData.hasErrors) {
        // Legacy support
        currentSpellCheckData = attachSpellCheckTermBounds(spellCheckData, target);
        window.currentSpellCheckData = currentSpellCheckData;
        persistentSpellCheckData = currentSpellCheckData;
    } else if (autofillConfig.spellcheck && persistentSpellCheckData && persistentSpellCheckData.hasErrors) {
        // Use persistent spell check data
        currentSpellCheckData = persistentSpellCheckData;
        window.currentSpellCheckData = currentSpellCheckData;
    } else {
        window.currentSpellCheckData = null;
        if (!autofillConfig.spellcheck) {
            persistentSpellCheckData = null;
        }
    }

    // Show spell check suggestions if we have spell check data
    if (currentSpellCheckData) {
        showSpellCheckSuggestions(currentSpellCheckData, target);
    }

    const currentWordLookupData = autofillConfig.thesaurus ? getActiveWordLookupData() : null;
    if (currentWordLookupData) {
        showWordLookupSection(currentWordLookupData, target);
    }

    // If no results and search is fully idle, show a "no results" message
    if (displayResults.length === 0 && !isSearching && !hasSearchServicesInFlight()) {
        const noResultsItem = document.createElement('div');
        noResultsItem.className = 'character-autocomplete-item no-results';
        noResultsItem.innerHTML = `
            <div class="character-info-row">
                <span class="character-name">No results found</span>
                <span class="character-copyright">Try a different search term</span>
            </div>
        `;
        characterAutocompleteList.appendChild(noResultsItem);
    } else if (displayResults.length > 0) {
        limitedResults.forEach((result, index) => {
            const item = createAutocompleteItem(result);
            characterAutocompleteList.appendChild(item);
        });

        // Add "show more" indicator if there are more results and not expanded
        if (displayResults.length > 5 && !autocompleteExpanded) {
            const moreItem = document.createElement('div');
            moreItem.className = 'character-autocomplete-item more-indicator';
            moreItem.innerHTML = `
                <div class="character-info-row">
                    <span class="character-name">Press <i class="fas fa-arrow-down" style="margin: 0 4px; font-size: 0.85em;"></i> to show all ${displayResults.length} results</span>
                </div>
            `;
            characterAutocompleteList.appendChild(moreItem);
        }

        if (preserveSelection) {
            restoreSelection(displayResults);
        } else {
            lastSelectedListIndex = -1;
            selectedCharacterAutocompleteIndex = -1;
            updateCharacterAutocompleteSelection();
        }
    } else {
        lastSelectedListIndex = -1;
        if (!preserveSelection) {
            selectedCharacterAutocompleteIndex = -1;
            updateCharacterAutocompleteSelection();
        }
    }

    // Position overlay relative to viewport
    const rect = target.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - 5;
    const maxHeight = Math.min(400, spaceBelow, window.innerHeight * 0.6);

    characterAutocompleteOverlay.style.left = rect.left + 'px';
    characterAutocompleteOverlay.style.top = (rect.bottom + 5) + 'px';
    characterAutocompleteOverlay.style.width = rect.width + 'px';
    characterAutocompleteOverlay.style.maxHeight = maxHeight + 'px';

    if (canShowAutofillOverlay(target)) {
        characterAutocompleteOverlay.classList.remove('hidden');
        isAutocompleteVisible = true;
    }

    // Auto-select first item only when entering list navigation with no prior selection
    if (displayResults.length > 0 &&
        !spellCheckNavigationMode &&
        !wordLookupNavigationMode &&
        autocompleteNavigationMode &&
        selectedCharacterAutocompleteIndex < 0 &&
        lastSelectedListIndex < 0) {
        selectedCharacterAutocompleteIndex = 0;
        updateCharacterAutocompleteSelection();
    }

    requestAutofillWikiPreviewsForSession();
}

// Batched via rAF — rebuildAndDisplayResults may call this after heavy sorting.
function updateAutocompleteDisplay(results, target) {
    pendingAutocompleteDisplayResults = results;
    pendingAutocompleteDisplayTarget = target;
    if (updateDisplayRaf) return;
    updateDisplayRaf = requestAnimationFrame(() => {
        updateDisplayRaf = 0;
        updateAutocompleteDisplayImmediate(pendingAutocompleteDisplayResults, pendingAutocompleteDisplayTarget);
    });
}

function shouldApplyAutocompleteUI(target) {
    return hasActiveAutofillSessionForTarget(target);
}

function updateAutocompleteDisplayImmediate(results, target) {
    if (!characterAutocompleteList || !characterAutocompleteOverlay) {
        console.error('Character autocomplete elements not found');
        return;
    }

    if (!shouldApplyAutocompleteUI(target)) {
        return;
    }
    if (!canShowAutofillOverlay(target)) {
        return;
    }

    // Force expansion on mobile or when no mouse input is available (e.g. touch only)
    const isMobile = (window.deviceUtils && window.deviceUtils.isMobileDevice()) ||
        (window.matchMedia && !window.matchMedia('(pointer: fine)').matches);

    if (isMobile) {
        autocompleteExpanded = true;
        if (characterAutocompleteOverlay) {
            characterAutocompleteOverlay.classList.add('expanded');
        }
    }

    // Create hash of current results to check if update is needed
    const currentResultsHash = createResultsHash(results) + (target ? target.id || target.className || '' : '');

    // Only update if results actually changed, or list has no result rows yet (status-only shell)
    const hasResultRows = characterAutocompleteList.querySelector('.character-autocomplete-item:not(.more-indicator):not(.no-results)');
    if (lastAutocompleteDisplayHash === currentResultsHash && hasResultRows) {
        return;
    }

    lastAutocompleteDisplayHash = currentResultsHash;

    // Store results for potential expansion
    window.allAutocompleteResults = results;

    const autofillConfig = getAutofillConfig(target);

    // Filter out spell check and dictionary results from main display
    let displayResults = filterAutofillDisplayResults(results, autofillConfig);
    const spellCheckResult = autofillConfig.spellcheck
        ? results.find(result => result.type === 'spellcheck')
        : null;

    // Show all results if expanded, otherwise show only first 5 items
    const limitedResults = autocompleteExpanded ? displayResults : displayResults.slice(0, 5);

    // Always rebuild the display when we have new results
    // This ensures we show the latest results from all services
    rebuildAutocompleteDisplay(displayResults, limitedResults, spellCheckResult, target);

    // Ensure overlay is positioned and visible (only with active session + server packet)
    if (!isAutocompleteVisible && canShowAutofillOverlay(target)) {
        const rect = target.getBoundingClientRect();
        const spaceBelow = window.innerHeight - rect.bottom - 5;
        const maxHeight = Math.min(400, spaceBelow, window.innerHeight * 0.6);

        characterAutocompleteOverlay.style.left = rect.left + 'px';
        characterAutocompleteOverlay.style.top = (rect.bottom + 5) + 'px';
        characterAutocompleteOverlay.style.width = rect.width + 'px';
        characterAutocompleteOverlay.style.maxHeight = maxHeight + 'px';
        characterAutocompleteOverlay.classList.remove('hidden');
        isAutocompleteVisible = true;
    }

    // Auto-select first item only when entering list navigation with no prior selection
    if (displayResults.length > 0 &&
        !spellCheckNavigationMode &&
        !wordLookupNavigationMode &&
        autocompleteNavigationMode &&
        selectedCharacterAutocompleteIndex < 0 &&
        lastSelectedListIndex < 0) {
        selectedCharacterAutocompleteIndex = 0;
        updateCharacterAutocompleteSelection();
    }
}

// Store main-list selection index for restoration after content updates
function storeCurrentSelection() {
    if (spellCheckNavigationMode || wordLookupNavigationMode) {
        return;
    }
    if (selectedCharacterAutocompleteIndex >= 0) {
        lastSelectedListIndex = selectedCharacterAutocompleteIndex;
    }
}

// Restore main-list selection by list position index after content updates
function restoreSelection(displayResults) {
    if (!shouldPreserveAutofillListSelection()) {
        lastSelectedListIndex = -1;
        return;
    }
    if (spellCheckNavigationMode || wordLookupNavigationMode) {
        lastSelectedListIndex = -1;
        return;
    }
    if (lastSelectedListIndex < 0 || !characterAutocompleteList) {
        return;
    }

    const items = getAutocompleteResultItems();
    if (!items.length) {
        lastSelectedListIndex = -1;
        return;
    }

    const targetIndex = Math.min(lastSelectedListIndex, items.length - 1);
    selectedCharacterAutocompleteIndex = targetIndex;
    updateCharacterAutocompleteSelection();
    lastSelectedListIndex = -1;
}

// New function to rebuild the autocomplete display
function rebuildAutocompleteDisplay(displayResults, limitedResults, spellCheckResult, target) {
    const autofillConfig = getAutofillConfig(target);
    // Force expansion on mobile or when no mouse input is available (e.g. touch only)
    const isMobile = (window.deviceUtils && window.deviceUtils.isMobileDevice()) ||
        (window.matchMedia && !window.matchMedia('(pointer: fine)').matches);

    if (isMobile) {
        autocompleteExpanded = true;
        if (characterAutocompleteOverlay) {
            characterAutocompleteOverlay.classList.add('expanded');
        }
    }

    const preserveSelection = shouldPreserveAutofillListSelection();
    if (preserveSelection && selectedCharacterAutocompleteIndex >= 0 && displayResults.length > 0) {
        storeCurrentSelection();
    } else {
        lastSelectedListIndex = -1;
    }

    // Clear only the results section, not the entire list
    // This preserves the search status display
    const existingResults = characterAutocompleteList.querySelectorAll('.character-autocomplete-item, .spell-check-section, .word-lookup-section, .no-results, .more-indicator, .character-detail-content');
    existingResults.forEach(item => item.remove());

    // Note: Search status will be added at the bottom after results

    // Handle spell check from the merged results system
    let currentSpellCheckData = null;
    if (autofillConfig.spellcheck && spellCheckResult && spellCheckResult.data && spellCheckResult.data.hasErrors) {
        currentSpellCheckData = attachSpellCheckTermBounds(spellCheckResult.data, target);
        window.currentSpellCheckData = currentSpellCheckData;
        persistentSpellCheckData = currentSpellCheckData;
    } else if (autofillConfig.spellcheck) {
        // Fallback to persistent spell check data if no new spell check result
        if (persistentSpellCheckData && persistentSpellCheckData.hasErrors) {
            currentSpellCheckData = attachSpellCheckTermBounds(persistentSpellCheckData, target);
            window.currentSpellCheckData = currentSpellCheckData;
        } else {
            window.currentSpellCheckData = null;
            persistentSpellCheckData = null;
        }
    } else {
        window.currentSpellCheckData = null;
        persistentSpellCheckData = null;
    }

    // Show spell check suggestions if we have spell check data
    if (currentSpellCheckData) {
        showSpellCheckSuggestions(currentSpellCheckData, target);
    }

    const currentWordLookupData = autofillConfig.thesaurus ? getActiveWordLookupData() : null;
    if (currentWordLookupData) {
        showWordLookupSection(currentWordLookupData, target);
    }

    // If no results and search is fully idle, show a "no results" message
    if (displayResults.length === 0 && !isSearching && !hasSearchServicesInFlight()) {
        const noResultsItem = document.createElement('div');
        noResultsItem.className = 'character-autocomplete-item no-results';
        noResultsItem.innerHTML = `
            <div class="character-info-row">
                <span class="character-name">No results found</span>
                <span class="character-copyright">Try a different search term</span>
            </div>
        `;
        characterAutocompleteList.appendChild(noResultsItem);
    } else if (displayResults.length > 0) {
        limitedResults.forEach((result, index) => {
            const item = createAutocompleteItem(result);
            characterAutocompleteList.appendChild(item);
        });

        // Add "show more" indicator if there are more results and not expanded
        if (displayResults.length > 5 && !autocompleteExpanded) {
            const moreItem = document.createElement('div');
            moreItem.className = 'character-autocomplete-item more-indicator';
            moreItem.innerHTML = `
                <div class="character-info-row">
                    <span class="character-name">Press <i class="fas fa-arrow-down" style="margin: 0 4px; font-size: 0.85em;"></i> to show all ${displayResults.length} results</span>
                </div>
            `;
            characterAutocompleteList.appendChild(moreItem);
        }

        if (preserveSelection) {
            restoreSelection(displayResults);
        } else {
            lastSelectedListIndex = -1;
            selectedCharacterAutocompleteIndex = -1;
            updateCharacterAutocompleteSelection();
        }
    } else {
        lastSelectedListIndex = -1;
        if (!preserveSelection) {
            selectedCharacterAutocompleteIndex = -1;
            updateCharacterAutocompleteSelection();
        }
    }

    // Add search status at the bottom if we're currently searching
    if (isSearching && searchServices.size > 0) {
        updateSearchStatusDisplay();
    }
}

function applySpellCheckWordDisplay(section, activeIndex) {
    if (!section) {
        section = characterAutocompleteList?.querySelector('.spell-check-section');
    }
    if (!section) return;

    if (typeof activeIndex !== 'number' || activeIndex < 0) {
        activeIndex = 0;
    }

    section.querySelectorAll('.spell-check-word').forEach(row => {
        const rowIndex = parseInt(row.dataset.wordIndex, 10);
        row.classList.toggle('expanded', rowIndex === activeIndex);
    });
}

function getSpellCheckRowIndexFromButton(btn) {
    if (!btn || !btn.closest) return -1;
    const row = btn.closest('.spell-check-word');
    if (!row) return -1;
    const fromBtn = parseInt(btn.dataset.wordIndex, 10);
    if (Number.isFinite(fromBtn) && fromBtn >= 0) {
        return fromBtn;
    }
    const fromRow = parseInt(row.dataset.wordIndex, 10);
    return Number.isFinite(fromRow) ? fromRow : -1;
}

function wireSpellCheckSuggestionButtons(container, target) {
    if (!container) return;
    container.querySelectorAll('.suggestion-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            applySpellCorrection(target, btn.dataset.original, btn.dataset.suggestion, getSpellCheckRowIndexFromButton(btn));
        });
        touchSlopUtils.registerTouchSlopTracking(btn);
        btn.addEventListener('touchend', (e) => {
            const maxDelta = touchSlopUtils.finalizeTouchSlop(btn, e);
            if (!touchSlopUtils.isTouchSlopTap(maxDelta)) return;
            e.preventDefault();
            applySpellCorrection(target, btn.dataset.original, btn.dataset.suggestion, getSpellCheckRowIndexFromButton(btn));
        }, { passive: false });
    });
}

function buildSpellCheckSuggestionButtons(word, suggestions, wordIndex) {
    if (!suggestions || suggestions.length === 0) return '';
    const rowIndexAttr = typeof wordIndex === 'number' && wordIndex >= 0 ? ` data-word-index="${wordIndex}"` : '';
    return suggestions.map(function (suggestion) {
        const phraseClass = /\s/.test(suggestion) ? ' suggestion-phrase' : '';
        return `
        <button class="suggestion-btn${phraseClass}" data-original="${word}" data-suggestion="${suggestion}"${rowIndexAttr} title="${/\s/.test(suggestion) ? 'Tag phrase' : ''}">
            ${suggestion}
        </button>
    `;
    }).join('');
}

function wireSpellCheckAddWordButton(container, word) {
    const addWordBtn = container?.querySelector('.add-word-btn');
    if (!addWordBtn) return;
    addWordBtn.addEventListener('click', (e) => {
        e.preventDefault();
        addWordToDictionary(word);
    });
    touchSlopUtils.registerTouchSlopTracking(addWordBtn);
    addWordBtn.addEventListener('touchend', (e) => {
        const maxDelta = touchSlopUtils.finalizeTouchSlop(addWordBtn, e);
        if (!touchSlopUtils.isTouchSlopTap(maxDelta)) return;
        e.preventDefault();
        addWordToDictionary(word);
    }, { passive: false });
}

function selectSpellCheckRow(wordIndex) {
    const section = characterAutocompleteList?.querySelector('.spell-check-section');
    if (!section) return;
    selectedSpellCheckWordIndex = wordIndex;
    selectedSpellCheckSuggestionIndex = 0;
    spellCheckNavigationMode = true;
    autocompleteNavigationMode = true;
    clearWordLookupNavigationState();
    clearMainAutocompleteSelection();
    applySpellCheckWordDisplay(section, wordIndex);
    updateSpellCheckSelection();
}

function createSpellCheckWordRow(word, suggestions, target, wordIndex) {
    const suggestionButtonsHtml = buildSpellCheckSuggestionButtons(word, suggestions, wordIndex);

    const row = document.createElement('div');
    row.className = 'spell-check-word';
    row.dataset.wordIndex = String(wordIndex);

    const compact = document.createElement('div');
    compact.className = 'spell-check-row-compact';
    compact.innerHTML = `
        <span class="spell-check-term-inline">"${word}"</span>
        ${suggestionButtonsHtml ? `<div class="suggestions-list spell-check-inline-synonyms">${suggestionButtonsHtml}</div>` : ''}
    `;
    compact.addEventListener('click', (e) => {
        if (e.target.closest('.suggestion-btn')) return;
        e.preventDefault();
        selectSpellCheckRow(wordIndex);
    });
    touchSlopUtils.registerTouchSlopTracking(compact);
    compact.addEventListener('touchend', (e) => {
        if (e.target.closest('.suggestion-btn')) return;
        const maxDelta = touchSlopUtils.finalizeTouchSlop(compact, e);
        if (!touchSlopUtils.isTouchSlopTap(maxDelta)) return;
        e.preventDefault();
        selectSpellCheckRow(wordIndex);
    }, { passive: false });
    row.appendChild(compact);
    wireSpellCheckSuggestionButtons(compact, target);

    const expanded = document.createElement('div');
    expanded.className = 'spell-check-row-expanded';
    expanded.innerHTML = `
        <div class="misspelled-word">"${word}"</div>
        ${suggestionButtonsHtml ? `
            <div class="spell-check-suggestions-label">Suggestions</div>
            <div class="suggestions-list">${suggestionButtonsHtml}</div>
        ` : ''}
        <button class="add-word-btn" data-word="${word}">
            <i class="fas fa-plus"></i> Add
        </button>
    `;
    row.appendChild(expanded);
    wireSpellCheckSuggestionButtons(expanded, target);
    wireSpellCheckAddWordButton(expanded, word);

    return row;
}

function showSpellCheckSuggestions(spellCheckData, target) {
    if (!spellCheckData.misspelled || spellCheckData.misspelled.length === 0) {
        return;
    }

    removeSpellCheckSection();

    const spellCheckSection = document.createElement('div');
    spellCheckSection.className = 'spell-check-section';
    spellCheckSection.innerHTML = `
        <div class="spell-check-header">
            <i class="fas fa-spell-check"></i>
            <span>Spell Check</span>
            ${spellCheckData.originalText ? `<div class="original-text">"${spellCheckData.originalText}"</div>` : ''}
        </div>
    `;

    const wordList = document.createElement('div');
    wordList.className = 'spell-check-word-list';

    spellCheckData.misspelled.forEach((word, wordIndex) => {
        const suggestions = spellCheckData.suggestions[word] || [];
        wordList.appendChild(createSpellCheckWordRow(word, suggestions, target, wordIndex));
    });

    spellCheckSection.appendChild(wordList);
    insertSideSectionAtTop(spellCheckSection);

    if (spellCheckNavigationMode) {
        const wordSections = spellCheckSection.querySelectorAll('.spell-check-word');
        if (!wordSections || wordSections.length === 0) {
            selectedSpellCheckWordIndex = -1;
            selectedSpellCheckSuggestionIndex = -1;
            spellCheckNavigationMode = false;
            return;
        }

        if (selectedSpellCheckWordIndex < 0) {
            selectedSpellCheckWordIndex = 0;
        } else if (selectedSpellCheckWordIndex >= wordSections.length) {
            selectedSpellCheckWordIndex = wordSections.length - 1;
        }

        applySpellCheckWordDisplay(spellCheckSection, selectedSpellCheckWordIndex);

        const selectedWordSection = wordSections[selectedSpellCheckWordIndex];
        const suggestionBtns = selectedWordSection.querySelectorAll('.spell-check-row-expanded .suggestion-btn');
        if (!suggestionBtns || suggestionBtns.length === 0) {
            selectedSpellCheckSuggestionIndex = -1;
        } else if (selectedSpellCheckSuggestionIndex < 0) {
            selectedSpellCheckSuggestionIndex = 0;
        } else if (selectedSpellCheckSuggestionIndex >= suggestionBtns.length) {
            selectedSpellCheckSuggestionIndex = suggestionBtns.length - 1;
        }

        updateSpellCheckSelection();
    } else {
        spellCheckSection.querySelectorAll('.spell-check-word').forEach(row => {
            row.classList.remove('expanded');
        });
    }
}

function getBestWordLookupResult() {
    for (const [, results] of serviceResults) {
        if (!results || !Array.isArray(results)) continue;
        const wordLookupResult = results.find(result => result.type === 'wordLookup');
        if (wordLookupResult && wordLookupResult.data && wordLookupResult.data.hasData) {
            return wordLookupResult;
        }
    }
    return null;
}

function getActiveWordLookupData() {
    const wordLookupResult = getBestWordLookupResult();
    if (wordLookupResult && wordLookupResult.data && wordLookupResult.data.hasData) {
        persistentWordLookupData = wordLookupResult.data;
        return wordLookupResult.data;
    }
    if (persistentWordLookupData && persistentWordLookupData.hasData) {
        return persistentWordLookupData;
    }
    persistentWordLookupData = null;
    return null;
}

function applyWordLookupWordDisplay(section, activeIndex) {
    if (!section) {
        section = getWordLookupSection();
    }
    if (!section) return;

    if (typeof activeIndex !== 'number' || activeIndex < 0) {
        activeIndex = 0;
    }
    activeWordLookupWordIndex = activeIndex;

    section.querySelectorAll('.word-lookup-word-row').forEach(row => {
        const rowIndex = parseInt(row.dataset.wordIndex, 10);
        const isActive = rowIndex === activeIndex;
        row.classList.toggle('expanded', isActive);
    });
}

function wireWordLookupSuggestionButtons(container, target) {
    if (!container) return;
    container.querySelectorAll('.suggestion-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            applyWordLookupInsert(target, btn.dataset.original, btn.dataset.suggestion);
        });
        touchSlopUtils.registerTouchSlopTracking(btn);
        btn.addEventListener('touchend', (e) => {
            const maxDelta = touchSlopUtils.finalizeTouchSlop(btn, e);
            if (!touchSlopUtils.isTouchSlopTap(maxDelta)) return;
            e.preventDefault();
            applyWordLookupInsert(target, btn.dataset.original, btn.dataset.suggestion);
        }, { passive: false });
    });
}

function buildWordLookupSynonymButtons(entry) {
    const synonyms = entry.synonyms || [];
    if (synonyms.length === 0) return '';
    return synonyms.map(synonym => `
        <button class="suggestion-btn" data-original="${entry.word}" data-suggestion="${synonym}">
            ${synonym}
        </button>
    `).join('');
}

function buildWordLookupDefinitionsHtml(definitions) {
    if (!definitions || definitions.length === 0) return '';
    return definitions.map(definition => {
        const posLabel = definition.pos ? `<span class="word-lookup-pos">${definition.pos}.</span> ` : '';
        return `<div class="word-lookup-definition">${posLabel}${definition.gloss}</div>`;
    }).join('');
}

function selectWordLookupRow(wordIndex) {
    const section = getWordLookupSection();
    if (!section) return;
    activeWordLookupWordIndex = wordIndex;
    selectedWordLookupWordIndex = wordIndex;
    selectedWordLookupSuggestionIndex = 0;
    wordLookupNavigationMode = true;
    autocompleteNavigationMode = true;
    clearMainAutocompleteSelection();
    applyWordLookupWordDisplay(section, wordIndex);
    updateWordLookupSelection();
}

function createWordLookupWordRow(entry, target, wordIndex) {
    const definitions = entry.definitions || [];
    const synonymButtonsHtml = buildWordLookupSynonymButtons(entry);
    const definitionsHtml = buildWordLookupDefinitionsHtml(definitions);

    const lookupHint = entry.lookupWord && entry.lookupWord.toLowerCase() !== String(entry.word).toLowerCase()
        ? `<div class="word-lookup-lookup-hint">via "${entry.lookupWord}"</div>`
        : '';

    const row = document.createElement('div');
    row.className = 'word-lookup-word-row';
    row.dataset.wordIndex = String(wordIndex);

    const compact = document.createElement('div');
    compact.className = 'word-lookup-row-compact';
    compact.innerHTML = `
        <span class="word-lookup-term-inline">"${entry.word}"</span>
        ${synonymButtonsHtml ? `<div class="suggestions-list word-lookup-inline-synonyms">${synonymButtonsHtml}</div>` : ''}
    `;
    compact.addEventListener('click', (e) => {
        if (e.target.closest('.suggestion-btn')) return;
        e.preventDefault();
        selectWordLookupRow(wordIndex);
    });
    touchSlopUtils.registerTouchSlopTracking(compact);
    compact.addEventListener('touchend', (e) => {
        if (e.target.closest('.suggestion-btn')) return;
        const maxDelta = touchSlopUtils.finalizeTouchSlop(compact, e);
        if (!touchSlopUtils.isTouchSlopTap(maxDelta)) return;
        e.preventDefault();
        selectWordLookupRow(wordIndex);
    }, { passive: false });
    row.appendChild(compact);
    wireWordLookupSuggestionButtons(compact, target);

    const expanded = document.createElement('div');
    expanded.className = 'word-lookup-row-expanded';
    expanded.innerHTML = `
        <div class="word-lookup-term">"${entry.word}"</div>
        ${lookupHint}
        ${definitionsHtml ? `<div class="word-lookup-definitions-panel">${definitionsHtml}</div>` : ''}
        ${synonymButtonsHtml ? `
            <div class="word-lookup-synonyms-label">Synonyms</div>
            <div class="suggestions-list">${synonymButtonsHtml}</div>
        ` : ''}
    `;
    row.appendChild(expanded);
    wireWordLookupSuggestionButtons(expanded, target);

    return row;
}

function showWordLookupSection(wordLookupData, target) {
    if (!wordLookupData || !wordLookupData.hasData || !Array.isArray(wordLookupData.words)) {
        removeWordLookupSection();
        return;
    }

    const wordsWithData = wordLookupData.words.filter(entry =>
        (entry.synonyms && entry.synonyms.length > 0) ||
        (entry.definitions && entry.definitions.length > 0)
    );
    if (wordsWithData.length === 0) {
        removeWordLookupSection();
        return;
    }

    if (activeWordLookupWordIndex >= wordsWithData.length) {
        activeWordLookupWordIndex = 0;
    }

    removeWordLookupSection();

    const hasSynonyms = wordsWithData.some(entry => entry.synonyms && entry.synonyms.length > 0);
    const sectionTitle = hasSynonyms ? 'Thesaurus' : 'Dictionary';

    const wordLookupSection = document.createElement('div');
    wordLookupSection.className = 'word-lookup-section';

    const header = document.createElement('div');
    header.className = 'word-lookup-header';
    header.innerHTML = `<i class="fas fa-book"></i><span>${sectionTitle}</span>`;
    wordLookupSection.appendChild(header);

    const wordList = document.createElement('div');
    wordList.className = 'word-lookup-word-list';

    wordsWithData.forEach((entry, wordIndex) => {
        wordList.appendChild(createWordLookupWordRow(entry, target, wordIndex));
    });

    wordLookupSection.appendChild(wordList);

    const spellCheckSection = characterAutocompleteList?.querySelector('.spell-check-section');
    if (spellCheckSection) {
        spellCheckSection.insertAdjacentElement('afterend', wordLookupSection);
    } else {
        insertSideSectionAtTop(wordLookupSection);
    }

    let displayIndex = activeWordLookupWordIndex;
    if (wordLookupNavigationMode && selectedWordLookupWordIndex >= 0) {
        displayIndex = selectedWordLookupWordIndex;
    } else if (displayIndex >= wordsWithData.length) {
        displayIndex = 0;
    }
    activeWordLookupWordIndex = displayIndex;
    if (wordLookupNavigationMode) {
        selectedWordLookupWordIndex = displayIndex;
        applyWordLookupWordDisplay(wordLookupSection, displayIndex);

        const activeRow = wordLookupSection.querySelector(`.word-lookup-word-row[data-word-index="${displayIndex}"]`);
        const suggestionBtns = activeRow?.querySelectorAll('.word-lookup-row-expanded .suggestion-btn');
        if (!suggestionBtns || suggestionBtns.length === 0) {
            selectedWordLookupSuggestionIndex = -1;
        } else if (selectedWordLookupSuggestionIndex < 0) {
            selectedWordLookupSuggestionIndex = 0;
        } else if (selectedWordLookupSuggestionIndex >= suggestionBtns.length) {
            selectedWordLookupSuggestionIndex = suggestionBtns.length - 1;
        }
        updateWordLookupSelection();
    } else {
        wordLookupSection.querySelectorAll('.word-lookup-word-row').forEach(row => {
            row.classList.remove('expanded');
        });
    }
}

function applyWordLookupInsert(target, originalWord, synonym) {
    return applySpellCorrection(target, originalWord, synonym);
}

function applySpellCorrection(target, originalWord, suggestion, misspelledRowIndex) {
    const currentValue = target.value;
    const cursorPos = target.selectionStart;
    const liveBounds = getAutocompleteSearchBounds(target);
    const spellMeta = persistentSpellCheckData || {};
    const termBounds = resolveSpellCheckTermBounds(target, spellMeta, liveBounds);
    const termStart = termBounds.termStart;
    const termEnd = termBounds.termEnd;
    const spellOffset = termBounds.spellOffset;
    let rowIndex = -1;
    if (typeof misspelledRowIndex === 'number' && misspelledRowIndex >= 0) {
        rowIndex = misspelledRowIndex;
    } else if (spellCheckNavigationMode && selectedSpellCheckWordIndex >= 0) {
        rowIndex = selectedSpellCheckWordIndex;
    }

    const wordRange = findSpellCheckWordReplaceRange(
        currentValue,
        cursorPos,
        originalWord,
        termStart,
        termEnd,
        spellOffset,
        spellMeta,
        rowIndex
    );
    if (wordRange) {
        return applySpellCorrectionReplace(target, wordRange.start, wordRange.end, suggestion, cursorPos);
    }

    if (typeof showGlassToast === 'function') {
        showGlassToast('error', null, `Could not find "${originalWord}" to replace`, false, 3000, '<i class="fas fa-exclamation-triangle"></i>');
    }
    return false;
}

// Helper function to calculate Levenshtein distance between two strings
function levenshteinDistance(str1, str2) {
    const len1 = str1.length;
    const len2 = str2.length;
    const matrix = Array(len1 + 1).fill(null).map(() => Array(len2 + 1).fill(0));

    for (let i = 0; i <= len1; i++) matrix[i][0] = i;
    for (let j = 0; j <= len2; j++) matrix[0][j] = j;

    for (let i = 1; i <= len1; i++) {
        for (let j = 1; j <= len2; j++) {
            const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1,      // deletion
                matrix[i][j - 1] + 1,      // insertion
                matrix[i - 1][j - 1] + cost // substitution
            );
        }
    }

    return matrix[len1][len2];
}

async function addWordToDictionary(word) {
    try {
        let success = false;

        // Use WebSocket for adding words
        if (window.wsClient && window.wsClient.isConnected()) {
            try {
                const result = await window.wsClient.addWordToDictionary(word);
                success = result.success;
            } catch (wsError) {
                console.error('WebSocket add word failed:', wsError);
                throw new Error('Failed to add word to dictionary');
            }
        } else {
            throw new Error('WebSocket not connected');
        }

        if (success) {
            // Show success message
            const successMsg = document.createElement('div');
            successMsg.className = 'spell-check-success';
            successMsg.textContent = `Added "${word}" to dictionary`;
            successMsg.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                background: #4CAF50;
                color: white;
                padding: 10px 15px;
                border-radius: 5px;
                z-index: 10000;
                font-size: 14px;
            `;
            document.body.appendChild(successMsg);

            // Remove after 3 seconds
            setTimeout(() => {
                if (successMsg.parentNode) {
                    successMsg.parentNode.removeChild(successMsg);
                }
            }, 3000);

            // Refresh search to update spell check
            const target = currentCharacterAutocompleteTarget;
            if (target) {
                const event = new Event('input', { bubbles: true });
                target.dispatchEvent(event);
            }
        } else {
            console.error('Failed to add word to dictionary');
        }
    } catch (error) {
        console.error('Error adding word to dictionary:', error);
    }
}

// Helper function to scroll to an option and center it in the view
function scrollToAutocompleteOption(optionElement) {
    if (!optionElement) return;

    // Find the scrollable container - the overlay is the scrollable container
    const menu = optionElement.closest('.character-autocomplete-overlay');
    if (!menu) return;

    // Get the menu dimensions
    const menuRect = menu.getBoundingClientRect();
    const optionRect = optionElement.getBoundingClientRect();

    // Calculate the scroll position to center the option
    const menuHeight = menuRect.height;
    const optionTop = optionElement.offsetTop;
    const optionHeight = optionElement.offsetHeight;

    // Center the option in the menu
    const scrollTop = optionTop - (menuHeight / 2) + (optionHeight / 2);

    // Ensure scroll position is within bounds
    const maxScroll = menu.scrollHeight - menuHeight;
    const finalScrollTop = Math.max(0, Math.min(scrollTop, maxScroll));

    // Only scroll if the menu has a scrollable height
    if (menu.scrollHeight > menuHeight) {
        // Avoid visible "jumping" when selection stays within the visible viewport.
        const isInView = optionRect.top >= menuRect.top + AUTOCOMPLETE_SCROLL_MARGIN_PX &&
            optionRect.bottom <= menuRect.bottom - AUTOCOMPLETE_SCROLL_MARGIN_PX;
        if (isInView) return;

        // Avoid tiny scroll adjustments when already effectively at target.
        if (Math.abs(menu.scrollTop - finalScrollTop) < 1) return;
        menu.scrollTop = finalScrollTop;
    }
}

function updateCharacterAutocompleteSelection() {
    if (!characterAutocompleteList) return;

    const items = getAutocompleteResultItems();

    if (spellCheckNavigationMode || wordLookupNavigationMode) {
        clearAutofillWikiPreviewReveal();
        items.forEach((item) => {
            item.classList.remove('selected');
            updateTagWikiPreviewScroll(item);
        });
        return;
    }
    items.forEach((item, index) => {
        const isSelected = index === selectedCharacterAutocompleteIndex;
        item.classList.toggle('selected', isSelected);
        if (!isSelected) {
            item.classList.remove('wiki-preview-revealed');
            updateTagWikiPreviewScroll(item);
        }
    });

    // Scroll the selected item into view and center it
    if (selectedCharacterAutocompleteIndex >= 0 && items[selectedCharacterAutocompleteIndex]) {
        const selectedItem = items[selectedCharacterAutocompleteIndex];
        // Coalesce scrolling to 1/frame during rapid keyboard navigation.
        pendingSelectionScrollItem = selectedItem;
        if (!pendingSelectionScrollRaf) {
            pendingSelectionScrollRaf = requestAnimationFrame(() => {
                pendingSelectionScrollRaf = 0;
                if (pendingSelectionScrollItem) {
                    scrollToAutocompleteOption(pendingSelectionScrollItem);
                }
                pendingSelectionScrollItem = null;
            });
        }
        scheduleAutofillWikiPreviewReveal(selectedItem, selectedCharacterAutocompleteIndex);
    } else {
        clearAutofillWikiPreviewReveal();
    }
}

function selectCharacterItem(character, detailOptions = {}) {
    try {
        showCharacterDetail(character, detailOptions);
    } catch (error) {
        console.error('Error displaying character data:', error);
        showError('Failed to display character data');
    }
}

function selectTagOnlyFromDetail(tagName, category) {
    if (!tagName || !currentCharacterAutocompleteTarget) return;
    selectTag(tagName, category || '');
}

function selectDynamicPlaceholder(placeholder) {
    if (!currentCharacterAutocompleteTarget) return;

    const target = currentCharacterAutocompleteTarget;
    const currentValue = target.value;
    const cursorPosition = target.selectionStart;

    // Get the text before the cursor
    const textBeforeCursor = currentValue.substring(0, cursorPosition);

    const startOfCurrentTerm = findAutocompleteTermStart(textBeforeCursor);

    // Get the text after the cursor
    const textAfterCursor = currentValue.substring(cursorPosition);
    const endOfCurrentTerm = findAutocompleteTermEnd(currentValue, cursorPosition);

    // Build the new prompt
    let newPrompt = '';

    // Keep the text before the current term (trim any trailing delimiters and spaces)
    const textBefore = currentValue.substring(0, startOfCurrentTerm).replace(/[,\s]*$/, '');
    newPrompt = textBefore;

    // Add the placeholder as uppercase word
    const wrappedPlaceholder = placeholder;
    if (newPrompt) {
        // Check if we should add a comma before the text
        if (shouldAddCommaBefore(currentValue, cursorPosition)) {
            newPrompt += ', ' + wrappedPlaceholder;
        } else {
            newPrompt += wrappedPlaceholder;
        }
    } else {
        newPrompt = wrappedPlaceholder;
    }

    // Get the text after the current term (not just cursor position)
    const textAfterTerm = currentValue.substring(endOfCurrentTerm);

    // Check if we're at the end of an emphasis block or brace block
    const textAfter = textAfterTerm.replace(/^[,\s]*/, '');
    const isAtEndOfEmphasis = textAfter.startsWith('::');
    const isAtEndOfBrace = textAfter.startsWith(']') || textAfter.startsWith('%');

    // Add comma and space after tag unless at end of emphasis or brace block
    if (textAfter && !isAtEndOfEmphasis && !isAtEndOfBrace) {
        // Check if we should add a comma after the inserted text
        if (shouldAddCommaAfter(currentValue, endOfCurrentTerm)) {
            newPrompt += ', ' + textAfter;
        } else {
            newPrompt += textAfter;
        }
    } else if (textAfter) {
        // At end of emphasis or brace block, don't add comma
        newPrompt += textAfter;
    }

    // Update the target field
    // setTextareaValuePreservingUndo: public/scripts/comp/textareaUtils.js
    setTextareaValuePreservingUndo(target, newPrompt);

    // Set cursor position after the inserted placeholder
    const newCursorPosition = newPrompt.length - textAfter.length;
    target.setSelectionRange(newCursorPosition, newCursorPosition);

    // Hide character autocomplete and mark as not expanded to fix keyboard navigation issue
    hideCharacterAutocomplete();
    autocompleteExpanded = false;
}

function selectTextReplacement(placeholder) {
    if (!currentCharacterAutocompleteTarget) return;
    if (!isAutofillFeatureEnabled(currentCharacterAutocompleteTarget, 'expanders')) return;

    const target = currentCharacterAutocompleteTarget;
    const currentValue = target.value;
    const cursorPosition = target.selectionStart;

    // Get the text before the cursor
    const textBeforeCursor = currentValue.substring(0, cursorPosition);

    const startOfCurrentTerm = findAutocompleteTermStart(textBeforeCursor);

    // Get the text after the cursor
    const textAfterCursor = currentValue.substring(cursorPosition);
    const endOfCurrentTerm = findAutocompleteTermEnd(currentValue, cursorPosition);

    // Build the new prompt
    let newPrompt = '';

    // Keep the text before the current term (trim any trailing delimiters and spaces)
    const textBefore = currentValue.substring(0, startOfCurrentTerm).replace(/[,\s]*$/, '');
    newPrompt = textBefore;

    // Add the placeholder wrapped in exclamation mark format
    const wrappedPlaceholder = `!${placeholder}`;
    if (newPrompt) {
        // Check if we should add a comma before the text
        if (shouldAddCommaBefore(currentValue, cursorPosition)) {
            newPrompt += ', ' + wrappedPlaceholder;
        } else {
            newPrompt += wrappedPlaceholder;
        }
    } else {
        newPrompt = wrappedPlaceholder;
    }

    // Get the text after the current term (not just cursor position)
    const textAfterTerm = currentValue.substring(endOfCurrentTerm);

    // Check if we're at the end of an emphasis block or brace block
    const textAfter = textAfterTerm.replace(/^[,\s]*/, '');
    const isAtEndOfEmphasis = textAfter.startsWith('::');
    const isAtEndOfBrace = textAfter.startsWith('}') || textAfter.startsWith(']') || textAfter.startsWith('%');

    // Add comma and space after tag unless at end of emphasis or brace block
    if (textAfter && !isAtEndOfEmphasis && !isAtEndOfBrace) {
        // Check if we should add a comma after the inserted text
        if (shouldAddCommaAfter(currentValue, endOfCurrentTerm)) {
            newPrompt += ', ' + textAfter;
        } else {
            newPrompt += textAfter;
        }
    } else if (textAfter) {
        // At end of emphasis or brace block, don't add comma
        newPrompt += textAfter;
    }

    // Update the target field
    // setTextareaValuePreservingUndo: public/scripts/comp/textareaUtils.js
    setTextareaValuePreservingUndo(target, newPrompt);

    // Set cursor position after the inserted placeholder
    const newCursorPosition = newPrompt.length - textAfter.length;
    target.setSelectionRange(newCursorPosition, newCursorPosition);

    // Hide character autocomplete and mark as not expanded to fix keyboard navigation issue
    hideCharacterAutocomplete();

    // Focus back on the target field
    if (target) {
        target.focus();
        autoResizeTextarea(target);
        updateEmphasisHighlighting(target);
    }
}

function insertTextReplacement(actualText) {
    if (!currentCharacterAutocompleteTarget) return;

    const target = currentCharacterAutocompleteTarget;
    const currentValue = target.value;
    const cursorPosition = target.selectionStart;

    // Get the text before the cursor
    const textBeforeCursor = currentValue.substring(0, cursorPosition);

    const startOfCurrentTerm = findAutocompleteTermStart(textBeforeCursor);

    // Get the text after the cursor
    const textAfterCursor = currentValue.substring(cursorPosition);

    // Build the new prompt
    let newPrompt = '';

    // Keep the text before the current term (trim any trailing delimiters and spaces)
    const textBefore = currentValue.substring(0, startOfCurrentTerm).replace(/[,\s]*$/, '');
    newPrompt = textBefore;

    // Add the actual text (not wrapped in angle brackets)
    if (newPrompt) {
        // Check if we should add a comma before the text
        if (shouldAddCommaBefore(currentValue, cursorPosition)) {
            newPrompt += ', ' + actualText;
        } else {
            newPrompt += actualText;
        }
    } else {
        newPrompt = actualText;
    }

    // Add the text after the cursor (trim any leading delimiters and spaces)
    const textAfter = textAfterCursor.replace(/^[,\s]*/, '');
    if (textAfter) {
        // Check if we should add a comma after the inserted text
        if (shouldAddCommaAfter(currentValue, cursorPosition)) {
            newPrompt += ', ' + textAfter;
        } else {
            newPrompt += textAfter;
        }
    }

    // Update the target field
    // setTextareaValuePreservingUndo: public/scripts/comp/textareaUtils.js
    setTextareaValuePreservingUndo(target, newPrompt);

    // Set cursor position after the inserted text
    const newCursorPosition = newPrompt.length - textAfter.length;
    target.setSelectionRange(newCursorPosition, newCursorPosition);

    // Hide character autocomplete
    hideCharacterAutocomplete();

    // Focus back on the target field
    if (target) {
        target.focus();
        autoResizeTextarea(target);
        updateEmphasisHighlighting(target);
    }
}

function selectTag(tagName, category) {
    if (!currentCharacterAutocompleteTarget) return;

    const target = currentCharacterAutocompleteTarget;

    let tagToInsert = tagName;
    if (category && category.toLowerCase() === 'artist') {
        if (tagName.includes(' ')) {
            tagToInsert = 'art by ' + tagName;
        } else {
            tagToInsert = 'artist:' + tagName;
        }
    }

    if (isAutofillSingleToken(target)) {
        target.value = tagToInsert;
        hideCharacterAutocomplete();
        target.focus();
        return;
    }

    const currentValue = target.value;
    const cursorPosition = target.selectionStart;
    const bounds = getAutocompleteSearchBounds(target);
    const startOfCurrentTerm = bounds ? bounds.tokenStart : findAutocompleteTermStart(currentValue.substring(0, cursorPosition));
    const endOfCurrentTerm = bounds ? bounds.tokenEnd : findAutocompleteTermEnd(currentValue, cursorPosition);

    function commitTagReplacement(replaceStart, replaceEnd, insertText) {
        const textBefore = currentValue.substring(0, replaceStart).replace(/[,\s]*$/, '');
        const textAfterTerm = currentValue.substring(replaceEnd);
        let newPrompt = textBefore;
        if (newPrompt) {
            if (shouldAddCommaBefore(currentValue, cursorPosition)) {
                newPrompt += ', ' + insertText;
            } else {
                newPrompt += insertText;
            }
        } else {
            newPrompt = insertText;
        }
        const textAfter = textAfterTerm.replace(/^[,\s]*/, '');
        const isAtEndOfEmphasis = textAfter.startsWith('::');
        const isAtEndOfBrace = textAfter.startsWith('}') || textAfter.startsWith(']') || textAfter.startsWith('%');
        if (textAfter && !isAtEndOfEmphasis && !isAtEndOfBrace) {
            if (shouldAddCommaAfter(currentValue, cursorPosition)) {
                newPrompt += ', ' + textAfter;
            } else {
                newPrompt += textAfter;
            }
        } else if (textAfter) {
            newPrompt += textAfter;
        }
        setTextareaValuePreservingUndo(target, newPrompt);
        const newCursorPosition = newPrompt.length - textAfter.length;
        target.setSelectionRange(newCursorPosition, newCursorPosition);
        hideCharacterAutocomplete();
        if (target) {
            target.focus();
            autoResizeTextarea(target);
            updateEmphasisHighlighting(target);
        }
    }

    const inputRange = bounds
        ? resolveTypedInputReplaceRange(currentValue, bounds, cursorPosition)
        : null;
    if (inputRange) {
        commitTagReplacement(inputRange.start, inputRange.end, tagToInsert);
        return;
    }

    const overlay = computeTagOverlayReplaceRange(currentValue, startOfCurrentTerm, endOfCurrentTerm, tagToInsert, cursorPosition);

    if (overlay) {
        commitTagReplacement(overlay.start, overlay.end, overlay.text);
        return;
    }

    const textAfterCursor = currentValue.substring(cursorPosition);
    let newPrompt = '';
    const textBefore = currentValue.substring(0, startOfCurrentTerm).replace(/[,\s]*$/, '');
    newPrompt = textBefore;

    if (newPrompt) {
        if (shouldAddCommaBefore(currentValue, cursorPosition)) {
            newPrompt += ', ' + tagToInsert;
        } else {
            newPrompt += tagToInsert;
        }
    } else {
        newPrompt = tagToInsert;
    }

    const textAfter = textAfterCursor.replace(/^[,\s]*/, '');
    const isAtEndOfEmphasis = textAfter.startsWith('::');
    const isAtEndOfBrace = textAfter.startsWith('}') || textAfter.startsWith(']') || textAfter.startsWith('%');

    if (textAfter && !isAtEndOfEmphasis && !isAtEndOfBrace) {
        if (shouldAddCommaAfter(currentValue, cursorPosition)) {
            newPrompt += ', ' + textAfter;
        } else {
            newPrompt += textAfter;
        }
    } else if (textAfter) {
        newPrompt += textAfter;
    }

    setTextareaValuePreservingUndo(target, newPrompt);

    const newCursorPosition = newPrompt.length - textAfter.length;
    target.setSelectionRange(newCursorPosition, newCursorPosition);

    // Hide character autocomplete and mark as not expanded to fix keyboard navigation issue
    hideCharacterAutocomplete();

    // Focus back on the target field
    if (target) {
        target.focus();
        autoResizeTextarea(target);
        updateEmphasisHighlighting(target);
    }
}

function selectTextReplacementFullText(placeholder) {
    if (!currentCharacterAutocompleteTarget) return;

    const target = currentCharacterAutocompleteTarget;
    const currentValue = target.value;
    const cursorPosition = target.selectionStart;

    // Get the text before the cursor
    const textBeforeCursor = currentValue.substring(0, cursorPosition);

    const startOfCurrentTerm = findAutocompleteTermStart(textBeforeCursor);

    // Get the text after the cursor
    const textAfterCursor = currentValue.substring(cursorPosition);

    // Build the new prompt
    let newPrompt = '';

    // Keep the text before the current term (trim any trailing delimiters and spaces)
    const textBefore = currentValue.substring(0, startOfCurrentTerm).replace(/[,\s]*$/, '');
    newPrompt = textBefore;

    // Add the full text replacement description
    const fullText = window.optionsData?.textReplacements[placeholder];
    if (newPrompt) {
        // Check if we should add a comma before the text
        if (shouldAddCommaBefore(currentValue, cursorPosition)) {
            newPrompt += ', ' + fullText;
        } else {
            newPrompt += fullText;
        }
    } else {
        newPrompt = fullText;
    }

    // Add the text after the cursor (trim any leading delimiters and spaces)
    const textAfter = textAfterCursor.replace(/^[,\s]*/, '');
    if (textAfter) {
        // Check if we should add a comma after the inserted text
        if (shouldAddCommaAfter(currentValue, cursorPosition)) {
            newPrompt += ', ' + textAfter;
        } else {
            newPrompt += textAfter;
        }
    }

    // Update the target field
    // setTextareaValuePreservingUndo: public/scripts/comp/textareaUtils.js
    setTextareaValuePreservingUndo(target, newPrompt);

    // Set cursor position after the inserted text
    const newCursorPosition = newPrompt.length - textAfter.length;
    target.setSelectionRange(newCursorPosition, newCursorPosition);

    // Hide character autocomplete and mark as not expanded to fix keyboard navigation issue
    hideCharacterAutocomplete();

    // Focus back on the target field
    if (target) {
        target.focus();
        autoResizeTextarea(target);
        updateEmphasisHighlighting(target);
    }
}

function selectCharacterWithoutEnhancers(character) {
    try {
        if (!currentCharacterAutocompleteTarget) return;

        const target = currentCharacterAutocompleteTarget;
        const currentValue = target.value;
        const cursorPosition = target.selectionStart;

        // Get the text before the cursor
        const textBeforeCursor = currentValue.substring(0, cursorPosition);

        const startOfCurrentTerm = findAutocompleteTermStart(textBeforeCursor);

        // Get the text after the cursor
        const textAfterCursor = currentValue.substring(cursorPosition);

        // Build the new prompt
        let newPrompt = '';

        // Keep the text before the current term (trim any trailing delimiters and spaces)
        const textBefore = currentValue.substring(0, startOfCurrentTerm).replace(/[,\s]*$/, '');
        newPrompt = textBefore;

        // Add just the character prompt without any enhancers
        if (character.prompt) {
            if (newPrompt) {
                // Check if we should add a comma before the text
                if (shouldAddCommaBefore(currentValue, cursorPosition)) {
                    newPrompt += ', ' + character.prompt;
                } else {
                    newPrompt += character.prompt;
                }
            } else {
                newPrompt = character.prompt;
            }
        }

        // Add the text after the cursor (trim any leading delimiters and spaces)
        const textAfter = textAfterCursor.replace(/^[,\s]*/, '');
        if (textAfter) {
            if (newPrompt) {
                // Check if we should add a comma after the inserted text
                if (shouldAddCommaAfter(currentValue, cursorPosition)) {
                    newPrompt += ', ' + textAfter;
                } else {
                    newPrompt += textAfter;
                }
            } else {
                newPrompt = textAfter;
            }
        }

        // Update the target field
        // setTextareaValuePreservingUndo: public/scripts/comp/textareaUtils.js
    setTextareaValuePreservingUndo(target, newPrompt);

        // Set cursor position after the inserted text
        const newCursorPosition = newPrompt.length - textAfter.length;
        target.setSelectionRange(newCursorPosition, newCursorPosition);

        // Hide character autocomplete and mark as not expanded to fix keyboard navigation issue
        hideCharacterAutocomplete();

        // Focus back on the target field
        if (target) {
            target.focus();
            autoResizeTextarea(target);
            updateEmphasisHighlighting(target);
        }
    } catch (error) {
        console.error('Error loading character data:', error);
        showError('Failed to load character data');
    }
}

function showCharacterDetail(character, detailOptions = {}) {
    try {
        // Reset selected enhancer group index
        selectedEnhancerGroupIndex = -1;

        // Instead of using a separate overlay, replace the content inside the existing autocomplete overlay
        const autocompleteList = document.querySelector('.character-autocomplete-list');

        if (!autocompleteList) {
            console.error('Character autocomplete list not found');
            return;
        }

        // Create enhancers HTML
        let enhancersHTML = '';

        // Add "None" option first
        enhancersHTML += `
            <div class="enhancer-group" 
                 data-enhancer-group="null" 
                 data-character='${JSON.stringify(character)}'
                 onclick="selectEnhancerGroupFromDetail(null, ${JSON.stringify(character).replace(/"/g, '&quot;')})">
                <div class="enhancer-group-header">
                    <span class="enhancer-group-name">None</span>
                    <span class="enhancer-group-count">0</span>
                </div>
            </div>
        `;

        // Ensure character.enhancers exists and is an array
        if (character.enhancers && Array.isArray(character.enhancers)) {
            // Add enhancer groups
            character.enhancers.forEach((enhancerGroup, groupIndex) => {
                // Handle mixed structure: convert strings to single-item arrays
                let processedGroup;
                if (typeof enhancerGroup === 'string') {
                    // Convert string to single-item array
                    processedGroup = [enhancerGroup];
                } else if (Array.isArray(enhancerGroup)) {
                    // Already an array, use as-is
                    processedGroup = enhancerGroup;
                } else {
                    console.warn(`Enhancer group ${groupIndex} is neither string nor array:`, enhancerGroup);
                    return; // Skip this group
                }

                enhancersHTML += `
                    <div class="enhancer-group" 
                         data-enhancer-group='${JSON.stringify(processedGroup)}'
                         data-character='${JSON.stringify(character)}'
                         onclick="selectEnhancerGroupFromDetail(${JSON.stringify(processedGroup).replace(/"/g, '&quot;')}, ${JSON.stringify(character).replace(/"/g, '&quot;')})">
                        <div class="enhancer-group-header">
                            <span class="enhancer-group-name">Group ${groupIndex + 1}</span>
                            <span class="enhancer-group-count">${processedGroup.length}</span>
                        </div>
                        <div class="enhancer-items">
                            ${processedGroup.map(item => {
                    // Ensure item is a string
                    if (typeof item !== 'string') {
                        console.warn(`Enhancer item is not a string:`, item);
                        return '';
                    }
                    const isNegative = item.startsWith('--');
                    const displayItem = isNegative ? item.substring(2) : item;
                    return `<span class="enhancer-item ${isNegative ? 'negative' : ''}">${displayItem}</span>`;
                }).join('')}
                        </div>
                    </div>
                `;
            });
        } else {
            enhancersHTML += '<div class="no-enhancers">No enhancers available</div>';
        }

        if (detailOptions.tagInsertName) {
            const tagInsertName = detailOptions.tagInsertName;
            const tagCategory = detailOptions.tagCategory || '';
            enhancersHTML += `
                <div class="enhancer-group tag-only-option" 
                     data-action="tag-only"
                     data-tag-name='${JSON.stringify(tagInsertName)}'
                     data-tag-category='${JSON.stringify(tagCategory)}'
                     onclick="selectTagOnlyFromDetail(${JSON.stringify(tagInsertName).replace(/"/g, '&quot;')}, ${JSON.stringify(tagCategory).replace(/"/g, '&quot;')})">
                    <div class="enhancer-group-header">
                        <span class="enhancer-group-name">Tag only</span>
                    </div>
                    <div class="enhancer-items">
                        <span class="enhancer-item">${tagInsertName}</span>
                    </div>
                </div>
            `;
        }

        // Replace the autocomplete content with character detail
        autocompleteList.innerHTML = `
            <div class="character-detail-content">
                <div class="character-detail-header">
                    <div class="character-name-copyright">
                        <span class="character-name">${character.name || 'Unknown Character'}</span>
                        <span class="character-copyright">${character.copyright || ''}</span>
                    </div>
                    <button class="close-character-detail" onclick="hideCharacterDetail()">&times;</button>
                </div>
                <div class="character-detail-body">
                    <div class="character-prompt">
                        <strong>Prompt:</strong> <span>${character.prompt || 'No prompt available'}</span>
                    </div>
                    <div class="character-enhancers">
                        <strong>Enhancers:</strong>
                        <div class="enhancers-list">
                            ${enhancersHTML}
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Ensure the autocomplete overlay maintains its width
        if (characterAutocompleteOverlay) {
            characterAutocompleteOverlay.style.width = characterAutocompleteOverlay.style.width || '400px';
        }

        // Select the "None" enhancer group by default
        setTimeout(() => {
            const enhancerGroups = document.querySelectorAll('.character-detail-content .enhancer-group');
            const noneGroup = document.querySelector('.character-detail-content .enhancer-group[data-enhancer-group="null"]');
            if (noneGroup) {
                selectedEnhancerGroupIndex = Array.from(enhancerGroups).indexOf(noneGroup);
                noneGroup.classList.add('selected');
            } else if (enhancerGroups.length > 0) {
                selectedEnhancerGroupIndex = 0;
                enhancerGroups[0].classList.add('selected');
            }
            enhancerGroups.forEach((group) => {
                touchSlopUtils.registerTouchSlopTracking(group);
                group.addEventListener('touchend', (e) => {
                    const maxDelta = touchSlopUtils.finalizeTouchSlop(group, e);
                    if (!touchSlopUtils.isTouchSlopTap(maxDelta)) return;
                    e.preventDefault();
                    if (group.getAttribute('data-action') === 'tag-only') {
                        const tagName = JSON.parse(group.getAttribute('data-tag-name'));
                        const tagCategory = JSON.parse(group.getAttribute('data-tag-category') || '""');
                        selectTagOnlyFromDetail(tagName, tagCategory);
                        return;
                    }
                    const enhancerGroupData = group.getAttribute('data-enhancer-group');
                    const characterData = group.getAttribute('data-character');
                    if (enhancerGroupData && characterData) {
                        try {
                            const enhancerGroup = enhancerGroupData === 'null' ? null : JSON.parse(enhancerGroupData);
                            const char = JSON.parse(characterData);
                            selectEnhancerGroupFromDetail(enhancerGroup, char);
                        } catch (err) {
                            console.error('Error parsing enhancer group data:', err);
                        }
                    }
                }, { passive: false });
            });
            const closeBtn = document.querySelector('.character-detail-content .close-character-detail');
            if (closeBtn) {
                touchSlopUtils.registerTouchSlopTracking(closeBtn);
                closeBtn.addEventListener('touchend', (e) => {
                    const maxDelta = touchSlopUtils.finalizeTouchSlop(closeBtn, e);
                    if (!touchSlopUtils.isTouchSlopTap(maxDelta)) return;
                    e.preventDefault();
                    hideCharacterDetail();
                }, { passive: false });
            }
        }, 0);

        // The autocomplete overlay is already visible, so no need to show/hide anything
    } catch (error) {
        console.error('Error showing character detail:', error);
        console.error('Character that caused error:', character);
        showError('Failed to display character details');
    }
}

function selectEnhancerGroup(enhancerGroup, character) {
    if (!currentCharacterAutocompleteTarget) return;

    const target = currentCharacterAutocompleteTarget;

    // Update the target field with character prompt
    if (character.prompt) {
        // setTextareaValuePreservingUndo: public/scripts/comp/textareaUtils.js
        setTextareaValuePreservingUndo(target, character.prompt);
    }

    // Add enhancer items to the prompt if selected
    if (enhancerGroup && Array.isArray(enhancerGroup) && enhancerGroup.length > 0) {
        const currentPrompt = target.value;
        const enhancerText = enhancerGroup.join(', ');
        // setTextareaValuePreservingUndo: public/scripts/comp/textareaUtils.js
        setTextareaValuePreservingUndo(target, currentPrompt + ', ' + enhancerText);
    }

    // Hide character detail overlay and autocomplete
    hideCharacterDetail();
    hideCharacterAutocomplete();

    // Focus back on the target field
    if (target) {
        target.focus();
        updateEmphasisHighlighting(target);
    }
}

function selectEnhancerGroupFromDetail(enhancerGroup, character) {
    if (!currentCharacterAutocompleteTarget) return;

    const target = currentCharacterAutocompleteTarget;
    const currentValue = target.value;
    const cursorPosition = target.selectionStart;

    const textBeforeCursor = currentValue.substring(0, cursorPosition);
    const startOfCurrentTerm = findAutocompleteTermStart(textBeforeCursor);
    const endOfCurrentTerm = findAutocompleteTermEnd(currentValue, cursorPosition);

    let newPrompt = '';

    const textBefore = currentValue.substring(0, startOfCurrentTerm).replace(/[,\s]*$/, '');
    newPrompt = textBefore;

    let inserted = character.prompt || '';
    if (enhancerGroup && Array.isArray(enhancerGroup) && enhancerGroup.length > 0) {
        const enhancerText = enhancerGroup.join(', ');
        inserted = inserted ? inserted + ', ' + enhancerText : enhancerText;
    }

    if (inserted) {
        if (newPrompt && shouldAddCommaBeforeInsertPrefix(newPrompt)) {
            newPrompt += ', ' + inserted;
        } else if (newPrompt) {
            newPrompt += inserted;
        } else {
            newPrompt = inserted;
        }
    }

    const textAfterTerm = currentValue.substring(endOfCurrentTerm);
    const textAfter = textAfterTerm.replace(/^[,\s]*/, '');
    const isAtEndOfEmphasis = textAfter.startsWith('::');
    const isAtEndOfBrace = textAfter.startsWith('}') || textAfter.startsWith(']') || textAfter.startsWith('%');

    if (textAfter && !isAtEndOfEmphasis && !isAtEndOfBrace) {
        if (shouldAddCommaAfter(currentValue, endOfCurrentTerm)) {
            newPrompt += ', ' + textAfter;
        } else {
            newPrompt += textAfter;
        }
    } else if (textAfter) {
        newPrompt += textAfter;
    }

    // Update the target field
    // setTextareaValuePreservingUndo: public/scripts/comp/textareaUtils.js
    setTextareaValuePreservingUndo(target, newPrompt);

    // Set cursor position after the inserted text
    const newCursorPosition = newPrompt.length - textAfter.length;
    target.setSelectionRange(newCursorPosition, newCursorPosition);

    // Hide character autocomplete (which now contains the detail view)
    hideCharacterAutocomplete();

    // Focus back on the target field
    if (target) {
        target.focus();
        autoResizeTextarea(target);
        updateEmphasisHighlighting(target);
    }
}

// utilities.js — same valid emphasis weight rules
const EMPHASIS_WEIGHT_PATTERN = '-?(?:0(?:\\.\\d+)?|[1-9]\\d*(?:\\.\\d+)?|\\.\\d+)';

/**
 * Index where the autofill token before the cursor begins (treats "::" as one delimiter).
 * @param {string} textBeforeCursor
 * @returns {number}
 */
function findAutocompleteTermStart(textBeforeCursor) {
    let start = 0;

    const consider = (index, advance = 1) => {
        if (index >= start) {
            start = index + advance;
        }
    };

    for (const ch of [',', '|', '{', '}', '[', ']', '%']) {
        consider(textBeforeCursor.lastIndexOf(ch));
    }

    const doubleColon = textBeforeCursor.lastIndexOf('::');
    if (doubleColon >= 0) {
        consider(doubleColon, 2);
    }

    for (let i = textBeforeCursor.length - 1; i >= start; i--) {
        if (textBeforeCursor[i] !== ':') continue;
        if (i > 0 && textBeforeCursor[i - 1] === ':') continue;
        if (i + 1 < textBeforeCursor.length && textBeforeCursor[i + 1] === ':') continue;
        consider(i);
        break;
    }

    const lastDot = textBeforeCursor.lastIndexOf('.');
    if (lastDot >= start) {
        const afterDot = textBeforeCursor.substring(lastDot + 1);
        // Skip decimal points that are part of an emphasis weight (e.g. "1.5::")
        const isEmphasisWeightDecimal = /^\d*(?:::|$)/.test(afterDot);
        if (!isEmphasisWeightDecimal) {
            consider(lastDot);
        }
    }

    return start;
}

/**
 * Index where the autofill token after the cursor ends.
 * @param {string} value
 * @param {number} cursorPosition
 * @returns {number}
 */
function findAutocompleteTermEnd(value, cursorPosition) {
    const textAfter = value.substring(cursorPosition);
    for (let i = 0; i < textAfter.length; i++) {
        if (textAfter[i] === ':' && textAfter[i + 1] === ':') {
            return cursorPosition + i;
        }
        if (textAfter[i] === ':' && i > 0 && textAfter[i - 1] === ':') {
            continue;
        }
        if (/[,\s|{}\[\]%.]/.test(textAfter[i])) {
            return cursorPosition + i;
        }
    }
    return value.length;
}

// Helper function to check if cursor is inside a :: emphasis group (between the :: markers)
function isInsideEmphasisGroup(text, cursorPosition) {
    const textBeforeCursor = text.substring(0, cursorPosition);
    const textAfterCursor = text.substring(cursorPosition);

    // Find the last :: before cursor
    const lastDoubleColonBefore = textBeforeCursor.lastIndexOf('::');
    // Find the first :: after cursor
    const firstDoubleColonAfter = textAfterCursor.indexOf('::');

    // If we have :: before and after, we're inside an emphasis group
    // But we need to make sure we're not at the start or end of the group
    if (lastDoubleColonBefore === -1 || firstDoubleColonAfter === -1) {
        return false;
    }

    // Check if we're at the start of the group (right after opening ::)
    if (isAtStartOfEmphasisGroup(text, cursorPosition)) {
        return false;
    }

    // Check if we're at the end of the group (right before closing ::)
    if (isAtEndOfEmphasisGroupBefore(text, cursorPosition)) {
        return false;
    }

    return true;
}

// Helper function to check if cursor is at the start of a :: emphasis group (right after opening ::)
function isAtStartOfEmphasisGroup(text, cursorPosition) {
    const textBeforeCursor = text.substring(0, cursorPosition);
    const atGroupContentStart = new RegExp(`(${EMPHASIS_WEIGHT_PATTERN})::\\s*([^,:|]*)$`);
    return atGroupContentStart.test(textBeforeCursor);
}

// Helper function to check if cursor is at the end of an emphasis group (right before closing ::)
function isAtEndOfEmphasisGroupBefore(text, cursorPosition) {
    const textAfterCursor = text.substring(cursorPosition);

    // Look for the pattern: :: right after cursor
    return textAfterCursor.trim().startsWith('::');
}

// Helper function to check if cursor is at the end of a :: emphasis group (right after closing ::)
function isAtEndOfEmphasisGroup(text, cursorPosition) {
    const textBeforeCursor = text.substring(0, cursorPosition);

    // Look for the pattern: :: at the end of text before cursor
    return textBeforeCursor.trim().endsWith('::');
}

// Helper function to check if we should add a comma before inserting text
function shouldAddCommaBeforeInsertPrefix(prefixText) {
    if (!prefixText) return false;
    const trimmed = prefixText.trim();
    if (!trimmed) return false;
    if (trimmed.endsWith('::')) return false;
    if (trimmed.endsWith(':') && !trimmed.endsWith('::')) return false;
    if (trimmed.endsWith('|')) return false;
    return true;
}

// Helper function to check if we should add a comma before inserting text
function shouldAddCommaBefore(text, cursorPosition) {
    const textBeforeCursor = text.substring(0, cursorPosition);
    const trimmed = textBeforeCursor.trim();

    // Don't add comma if:
    // 1. We're at the start of text
    if (trimmed === '') return false;

    // 2. We're at the start of an emphasis group (right after opening ::)
    if (isAtStartOfEmphasisGroup(text, cursorPosition)) return false;

    // 3. We're at the end of a line with : or |
    if (trimmed.endsWith(':') && !trimmed.endsWith('::')) return false;
    if (trimmed.endsWith('|')) return false;

    // Add comma in all other cases (including inside emphasis groups and at the end of emphasis groups)
    return true;
}

// Helper function to check if we should add a comma after inserting text
function shouldAddCommaAfter(text, cursorPosition) {
    const textAfterCursor = text.substring(cursorPosition);
    const trimmed = textAfterCursor.trim();

    // Don't add comma if:
    // 1. We're at the end of text
    if (trimmed === '') return false;

    // 2. We're at the end of an emphasis group (right before closing ::)
    if (isAtEndOfEmphasisGroupBefore(text, cursorPosition)) {
        return false;
    }

    // Add comma in all other cases (including inside emphasis groups)
    return true;
}

function handleCharacterDetailArrowKeys(key) {
    const enhancerGroups = document.querySelectorAll('.character-detail-content .enhancer-group');
    if (enhancerGroups.length === 0) return;

    // Remove previous selection
    enhancerGroups.forEach(group => group.classList.remove('selected'));

    if (key === 'ArrowUp') {
        if (selectedEnhancerGroupIndex <= 0) {
            // If at first item, go to last item
            selectedEnhancerGroupIndex = enhancerGroups.length - 1;
        } else {
            selectedEnhancerGroupIndex = selectedEnhancerGroupIndex - 1;
        }
    } else if (key === 'ArrowDown') {
        if (selectedEnhancerGroupIndex >= enhancerGroups.length - 1) {
            // If at last item, go to first item
            selectedEnhancerGroupIndex = 0;
        } else {
            selectedEnhancerGroupIndex = selectedEnhancerGroupIndex + 1;
        }
    }

    // Ensure we don't go out of bounds
    selectedEnhancerGroupIndex = Math.max(0, Math.min(selectedEnhancerGroupIndex, enhancerGroups.length - 1));

    // Add selection to current item
    if (selectedEnhancerGroupIndex >= 0 && selectedEnhancerGroupIndex < enhancerGroups.length) {
        enhancerGroups[selectedEnhancerGroupIndex].classList.add('selected');

        // Scroll the selected item into view
        enhancerGroups[selectedEnhancerGroupIndex].scrollIntoView({
            behavior: 'smooth',
            block: 'nearest'
        });
    }
}

function handleCharacterDetailEnter() {
    const enhancerGroups = document.querySelectorAll('.character-detail-content .enhancer-group');
    if (selectedEnhancerGroupIndex >= 0 && selectedEnhancerGroupIndex < enhancerGroups.length) {
        const selectedGroup = enhancerGroups[selectedEnhancerGroupIndex];

        if (selectedGroup.getAttribute('data-action') === 'tag-only') {
            const tagName = JSON.parse(selectedGroup.getAttribute('data-tag-name'));
            const tagCategory = JSON.parse(selectedGroup.getAttribute('data-tag-category') || '""');
            selectTagOnlyFromDetail(tagName, tagCategory);
            return;
        }

        // Get the data from data attributes (much more reliable than parsing onclick)
        const enhancerGroupData = selectedGroup.getAttribute('data-enhancer-group');
        const characterData = selectedGroup.getAttribute('data-character');

        if (enhancerGroupData && characterData) {
            try {
                // Parse the data attributes
                const enhancerGroup = enhancerGroupData === 'null' ? null : JSON.parse(enhancerGroupData);
                const character = JSON.parse(characterData);

                selectEnhancerGroupFromDetail(enhancerGroup, character);
            } catch (error) {
                console.error('Error parsing data attributes:', error);
                console.error('enhancerGroupData:', enhancerGroupData);
                console.error('characterData:', characterData);

                // Fallback: try to trigger the click event instead
                selectedGroup.click();
            }
        } else {
            // Fallback: try to trigger the click event instead
            selectedGroup.click();
        }
    }
}

function handleTextareaBlur() {
    // Abort any ongoing search requests
    if (currentSearchTimeout) {
        clearTimeout(currentSearchTimeout);
        currentSearchTimeout = null;
    }

    if (characterAutocompleteTimeout) {
        clearTimeout(characterAutocompleteTimeout);
        characterAutocompleteTimeout = null;
    }

    // Clear search state
    currentSearchRequestId = null;
    isSearching = false;
    currentSearchQuery = '';

    // Hide autocomplete and clear caches
    hideCharacterAutocomplete();
}

function hideCharacterAutocomplete() {
    if (characterAutocompleteOverlay) {
        characterAutocompleteOverlay.classList.add('hidden');
        characterAutocompleteOverlay.classList.remove('expanded');
    }
    isAutocompleteOverlayHovered = false;
    autocompleteWheelAccumulator = 0;
    currentCharacterAutocompleteTarget = null;
    currentSearchRequestId = null;
    currentSearchSessionBounds = null;
    autofillSearchBoundsCache = null;
    clearAutofillSessionState();
    resetAutofillWikiPreviewSessionState();
    clearAutofillSearchWatchdog();

    if (rebuildDisplayRaf) {
        cancelAnimationFrame(rebuildDisplayRaf);
        rebuildDisplayRaf = 0;
    }
    if (pendingSelectionScrollRaf) {
        cancelAnimationFrame(pendingSelectionScrollRaf);
        pendingSelectionScrollRaf = 0;
        pendingSelectionScrollItem = null;
    }
    clearAutofillWikiPreviewReveal();
    rebuildDisplayAfterCallback = null;
    if (updateDisplayRaf) {
        cancelAnimationFrame(updateDisplayRaf);
        updateDisplayRaf = 0;
    }
    pendingAutocompleteDisplayResults = null;
    pendingAutocompleteDisplayTarget = null;
    if (updateStatusRaf) {
        cancelAnimationFrame(updateStatusRaf);
        updateStatusRaf = 0;
    }
    clearSearchStatusHideTimer();

    // Clear position cache so it gets repositioned when shown again
    lastCharacterAutocompletePosition = null;

    // Clear display caches so they get updated when shown again
    lastAutocompleteDisplayHash = null;
    lastStatusDisplayHash = null;
    markAutofillOverlayClosedFromInput();
    characterSearchResults = [];
    spellCheckNavigationMode = false;
    wordLookupNavigationMode = false;
    selectedSpellCheckWordIndex = -1;
    selectedSpellCheckSuggestionIndex = -1;
    selectedWordLookupWordIndex = -1;
    selectedWordLookupSuggestionIndex = -1;
    activeWordLookupWordIndex = 0;
    autocompleteExpanded = false;
    lastSearchText = ''; // Clear last search text so retyping works

    // Clear all search results when overlay is closed
    serviceResults.clear();
    currentSearchTimestamp = null;

    persistentSpellCheckData = null;
    persistentWordLookupData = null;
    isAutocompleteVisible = false;

    // Clear search state
    lastSearchQuery = '';
    currentSearchQuery = ''; // Reset current search query
    isSearching = false; // Reset searching flag

    // Reset services initialization flag for next autofill session
    servicesInitialized = false;

    updateEmphasisTooltipVisibility();
}

function hideCharacterDetail() {
    // Since we're now replacing the content inside the autocomplete overlay,
    // we need to restore the original autocomplete list content
    const autocompleteList = document.querySelector('.character-autocomplete-list');
    const restoreTarget = currentCharacterAutocompleteTarget;

    if (autocompleteList && window.allAutocompleteResults && window.allAutocompleteResults.length > 0 &&
        restoreTarget && hasActiveAutofillSessionForTarget(restoreTarget)) {
        // Restore the original autocomplete suggestions
        showCharacterAutocompleteSuggestions(window.allAutocompleteResults, restoreTarget);
    } else {
        // If no search results, just hide the overlay
        hideCharacterAutocomplete();
    }
}

// Position tracking for optimization
let lastCharacterAutocompletePosition = null;
let lastPresetAutocompletePosition = null;
let updatePositionsTimeout = null;

// Display update optimization
let lastAutocompleteDisplayHash = null;
let lastStatusDisplayHash = null;
let updateDisplayRaf = 0;
let updateStatusRaf = 0;
let pendingAutocompleteDisplayResults = null;
let pendingAutocompleteDisplayTarget = null;

// Helper function to create hash from results for comparison
function createResultsHash(results) {
    if (!results || !Array.isArray(results)) return '';
    return results.map(r => `${r.type || 'unknown'}-${r.id || r.name || r.text || ''}-${r.count || 0}`).join('|');
}

// Helper function to create hash from service statuses
function createStatusHash() {
    const statusEntries = Array.from(searchServices.entries()).sort();
    return statusEntries.map(([service, status]) => `${service}:${status}`).join('|');
}

// Throttled version of updateAutocompletePositions
function updateAutocompletePositions() {
    // Clear any pending updates
    if (updatePositionsTimeout) {
        clearTimeout(updatePositionsTimeout);
    }

    // Throttle to prevent excessive calls
    updatePositionsTimeout = setTimeout(() => {
        updateAutocompletePositionsImmediate();
        updatePositionsTimeout = null;
    }, 16); // ~60fps throttling
}

function updateAutocompletePositionsImmediate() {
    // Update character autocomplete position
    if (characterAutocompleteOverlay && !characterAutocompleteOverlay.classList.contains('hidden') && currentCharacterAutocompleteTarget) {
        if (!hasActiveAutofillSessionForTarget(currentCharacterAutocompleteTarget)) {
            hideCharacterAutocomplete();
            return;
        }
        const rect = currentCharacterAutocompleteTarget.getBoundingClientRect();
        const spaceBelow = window.innerHeight - rect.bottom - 5;
        const maxHeight = Math.min(400, spaceBelow, window.innerHeight * 0.6);

        // Create position object for comparison
        const newPosition = {
            left: Math.round(rect.left),
            top: Math.round(rect.bottom + 5),
            width: Math.round(rect.width),
            maxHeight: Math.round(maxHeight)
        };

        // Only update if position actually changed
        if (!lastCharacterAutocompletePosition ||
            lastCharacterAutocompletePosition.left !== newPosition.left ||
            lastCharacterAutocompletePosition.top !== newPosition.top ||
            lastCharacterAutocompletePosition.width !== newPosition.width ||
            lastCharacterAutocompletePosition.maxHeight !== newPosition.maxHeight) {

            characterAutocompleteOverlay.style.left = newPosition.left + 'px';
            characterAutocompleteOverlay.style.top = newPosition.top + 'px';
            characterAutocompleteOverlay.style.width = newPosition.width + 'px';
            characterAutocompleteOverlay.style.maxHeight = newPosition.maxHeight + 'px';

            // Store the new position
            lastCharacterAutocompletePosition = newPosition;
        }
    }

    // Update preset autocomplete position
    if (presetAutocompleteOverlay && !presetAutocompleteOverlay.classList.contains('hidden') && currentPresetAutocompleteTarget) {
        const rect = currentPresetAutocompleteTarget.getBoundingClientRect();
        const overlayHeight = Math.min(400, window.innerHeight * 0.5);
        const spaceAbove = rect.top;
        const spaceBelow = window.innerHeight - rect.bottom;

        // Create position object for comparison
        const isAbove = spaceAbove >= overlayHeight;
        const newPosition = {
            left: Math.round(rect.left),
            top: isAbove ? Math.round(rect.top - 5) : Math.round(rect.bottom + 5),
            width: Math.round(rect.width),
            maxHeight: isAbove ? Math.round(overlayHeight) : Math.round(Math.min(spaceBelow - 10, overlayHeight)),
            transform: isAbove ? 'translateY(-100%)' : 'none'
        };

        // Only update if position actually changed
        if (!lastPresetAutocompletePosition ||
            lastPresetAutocompletePosition.left !== newPosition.left ||
            lastPresetAutocompletePosition.top !== newPosition.top ||
            lastPresetAutocompletePosition.width !== newPosition.width ||
            lastPresetAutocompletePosition.maxHeight !== newPosition.maxHeight ||
            lastPresetAutocompletePosition.transform !== newPosition.transform) {

            presetAutocompleteOverlay.style.left = newPosition.left + 'px';
            presetAutocompleteOverlay.style.width = newPosition.width + 'px';
            presetAutocompleteOverlay.style.top = newPosition.top + 'px';
            presetAutocompleteOverlay.style.transform = newPosition.transform;
            presetAutocompleteOverlay.style.maxHeight = newPosition.maxHeight + 'px';

            // Store the new position
            lastPresetAutocompletePosition = newPosition;
        }
    }
}

function selectPresetItem(presetName) {
    if (!currentPresetAutocompleteTarget) return;

    const target = currentPresetAutocompleteTarget;
    target.value = presetName;

    // Hide preset autocomplete
    hidePresetAutocomplete();

    // Focus back on the target field
    if (target) {
        target.focus();
    }
}

function hidePresetAutocomplete() {
    if (presetAutocompleteOverlay) {
        presetAutocompleteOverlay.classList.add('hidden');
    }
    currentPresetAutocompleteTarget = null;
    selectedPresetAutocompleteIndex = -1;

    // Clear position cache so it gets repositioned when shown again
    lastPresetAutocompletePosition = null;
}

// Instant expansion function that directly manipulates DOM
function expandAutocompleteInstantly() {
    if (!window.allAutocompleteResults || !characterAutocompleteList) {
        return;
    }

    if (!currentCharacterAutocompleteTarget || !shouldApplyAutocompleteUI(currentCharacterAutocompleteTarget)) {
        return;
    }

    autocompleteExpanded = true;

    // Add expanded class to characterAutocompleteOverlay for CSS rules
    if (characterAutocompleteOverlay) {
        characterAutocompleteOverlay.classList.add('expanded');
    }

    // Use the original showCharacterAutocompleteSuggestions function to rebuild with all results
    if (currentCharacterAutocompleteTarget) {
        showCharacterAutocompleteSuggestions(window.allAutocompleteResults, currentCharacterAutocompleteTarget);
    }
}

function expandAutocompleteToShowAll() {
    if (!window.allAutocompleteResults || !characterAutocompleteList) return;
    if (!currentCharacterAutocompleteTarget || !shouldApplyAutocompleteUI(currentCharacterAutocompleteTarget)) {
        return;
    }
    
    autocompleteExpanded = true;

    // Add expanded class to characterAutocompleteOverlay for CSS rules
    if (characterAutocompleteOverlay) {
        characterAutocompleteOverlay.classList.add('expanded');
    }

    // Use the immediate version to bypass throttling and ensure expansion happens right away
    updateAutocompleteDisplayImmediate(window.allAutocompleteResults, currentCharacterAutocompleteTarget);
}

function updateSpellCheckSelection() {
    const spellCheckSection = characterAutocompleteList?.querySelector('.spell-check-section');
    if (!spellCheckSection) return;

    const wordCount = getSpellCheckWordCount(spellCheckSection);
    spellCheckSection.classList.toggle('nav-active', spellCheckNavigationMode && wordCount > 1);

    spellCheckSection.querySelectorAll('.spell-check-word').forEach(wordSection => {
        wordSection.classList.remove('selected');
        wordSection.querySelectorAll('.suggestion-btn').forEach(btn => {
            btn.classList.remove('selected');
        });
    });

    if (spellCheckNavigationMode && selectedSpellCheckWordIndex >= 0) {
        applySpellCheckWordDisplay(spellCheckSection, selectedSpellCheckWordIndex);

        const wordSections = spellCheckSection.querySelectorAll('.spell-check-word');
        if (wordSections && selectedSpellCheckWordIndex < wordSections.length) {
            const selectedWordSection = wordSections[selectedSpellCheckWordIndex];
            selectedWordSection.classList.add('selected');
            scrollToAutocompleteOption(selectedWordSection);

            if (selectedSpellCheckSuggestionIndex >= 0) {
                const suggestionBtns = selectedWordSection.querySelectorAll('.spell-check-row-expanded .suggestion-btn');
                if (suggestionBtns && selectedSpellCheckSuggestionIndex < suggestionBtns.length) {
                    suggestionBtns[selectedSpellCheckSuggestionIndex].classList.add('selected');
                }
            }
        }
    } else {
        spellCheckSection.querySelectorAll('.spell-check-word').forEach(row => {
            row.classList.remove('expanded');
        });
    }
}

function updateWordLookupSelection() {
    const wordLookupSection = getWordLookupSection();
    if (!wordLookupSection) return;

    const wordCount = getWordLookupWordCount(wordLookupSection);
    wordLookupSection.classList.toggle('nav-active', wordLookupNavigationMode && wordCount > 1);

    wordLookupSection.querySelectorAll('.suggestion-btn').forEach(btn => {
        btn.classList.remove('selected');
    });
    wordLookupSection.querySelectorAll('.word-lookup-word-row').forEach(row => {
        row.classList.remove('selected');
    });

    if (wordLookupNavigationMode && selectedWordLookupWordIndex >= 0) {
        applyWordLookupWordDisplay(wordLookupSection, selectedWordLookupWordIndex);

        const wordSections = wordLookupSection.querySelectorAll('.word-lookup-word-row');
        if (wordSections && selectedWordLookupWordIndex < wordSections.length) {
            const selectedWordSection = wordSections[selectedWordLookupWordIndex];
            selectedWordSection.classList.add('selected');
            scrollToAutocompleteOption(selectedWordSection);

            if (selectedWordLookupSuggestionIndex >= 0) {
                const suggestionBtns = selectedWordSection.querySelectorAll('.word-lookup-row-expanded .suggestion-btn');
                if (suggestionBtns && selectedWordLookupSuggestionIndex < suggestionBtns.length) {
                    suggestionBtns[selectedWordLookupSuggestionIndex].classList.add('selected');
                }
            }
        }
    } else {
        wordLookupSection.querySelectorAll('.word-lookup-word-row').forEach(row => {
            row.classList.remove('expanded');
        });
    }
}

// Helper function to determine if a model is an anime model
function isAnimeModel(model) {
    return model && (
        model.includes('nai-diffusion-3') ||
        model.includes('nai-diffusion-4') ||
        model.includes('nai-diffusion-4-5')
    );
}

function isFurryModel(model) {
    return model && model.includes('furry');
}

function getMatchType(mergedServices) {
    if (!mergedServices || mergedServices.length === 0) {
        return { type: 'Search', version: '' };
    }

    const apiModels = mergedServices.filter(m =>
        m !== FURRY_LOCAL_SERVICE && m !== ANIME_LOCAL_SERVICE
    );
    const hasFurryLocal = mergedServices.includes(FURRY_LOCAL_SERVICE);
    const hasAnimeLocal = mergedServices.includes(ANIME_LOCAL_SERVICE);

    if (apiModels.length >= 2) {
        return { type: 'Global', version: '' };
    }

    if (apiModels.length === 1 && hasAnimeLocal) {
        const apiModel = apiModels[0];
        if (isAnimeModel(apiModel)) {
            return {
                type: 'NovelAI',
                dataType: 'anime',
                version: modelKeys[apiModel]?.version || 'Search'
            };
        }
    }

    if (apiModels.length === 1 && hasFurryLocal) {
        const apiModel = apiModels[0];
        if (isFurryModel(apiModel)) {
            return {
                type: 'NovelAI',
                dataType: 'furry',
                version: modelKeys[apiModel]?.version || 'Search'
            };
        }
    }

    if (apiModels.length >= 2) {
        return { type: 'Global', version: '' };
    }
    if (apiModels.length === 1) {
        const apiModel = apiModels[0];
        return {
            type: modelKeys[apiModel]?.type || 'Search',
            version: modelKeys[apiModel]?.version || ''
        };
    }

    if (hasFurryLocal && hasAnimeLocal) {
        return { type: 'Global', version: '' };
    }
    if (hasFurryLocal) {
        return { type: 'NovelAI', dataType: 'furry', version: 'Local' };
    }
    if (hasAnimeLocal) {
        return { type: 'NovelAI', dataType: 'anime', version: 'Local' };
    }

    return { type: 'Search', version: '' };
}

function getPreferredLocalResult(result1, result2) {
    if (result1.model === FURRY_LOCAL_SERVICE && result2.model === ANIME_LOCAL_SERVICE) {
        return result1;
    }
    if (result1.model === ANIME_LOCAL_SERVICE && result2.model === FURRY_LOCAL_SERVICE) {
        return result2;
    }
    if (result1.model === result2.model) {
        return getTagScore(result1) >= getTagScore(result2) ? result1 : result2;
    }
    return getTagScore(result1) >= getTagScore(result2) ? result1 : result2;
}

// Get the best spell check result from all services
function getBestSpellCheckResult() {
    let bestSpellCheckResult = null;
    let bestScore = 0;

    for (const [, results] of serviceResults) {
        if (!results || !Array.isArray(results)) continue;
        const spellCheckResult = results.find(result => result.type === 'spellcheck');
        if (!spellCheckResult || !spellCheckResult.data || !spellCheckResult.data.hasErrors) continue;

        const misspelledCount = spellCheckResult.data.misspelled.length;
        const totalSuggestions = Object.values(spellCheckResult.data.suggestions || {})
            .reduce((sum, suggestions) => sum + suggestions.length, 0);
        const score = misspelledCount * 10 + totalSuggestions;

        if (score > bestScore) {
            bestScore = score;
            bestSpellCheckResult = spellCheckResult;
        }
    }

    return bestSpellCheckResult;
}

// Get all text replacement results from all services
function getAllTextReplacementResults() {
    const allTextReplacements = [];

    for (const [, results] of serviceResults) {
        if (!results || !Array.isArray(results)) continue;
        for (const result of results) {
            if (result.type === 'textReplacement') {
                allTextReplacements.push(result);
            }
        }
    }

    // Remove duplicates based on name and placeholder, keeping the best match
    const uniqueTextReplacements = [];
    const seen = new Map(); // Use Map to track best score for each key

    for (const replacement of allTextReplacements) {
        const key = `${replacement.name}:${replacement.placeholder}`;
        const currentScore = replacement.matchScore || calculateStringSimilarity(lastSearchQuery, replacement.name);

        if (!seen.has(key) || currentScore > seen.get(key).score) {
            // Add match score for sorting
            const replacementWithScore = {
                ...replacement,
                matchScore: currentScore
            };

            // Update the seen map with the better score
            seen.set(key, { score: currentScore, replacement: replacementWithScore });
        }
    }

    // Extract the best replacements from the seen map
    for (const { replacement } of seen.values()) {
        uniqueTextReplacements.push(replacement);
    }

    return uniqueTextReplacements;
}

// Get dynamic generation placeholder results based on query
function getDynamicGenerationPlaceholderResults(query) {
    if (!query) return [];

    // Define available dynamic generation placeholders
    const placeholders = [
        { name: 'TIME', description: 'Current time of day (morning, afternoon, evening, night)', example: 'morning sunlight, golden hour' },
        { name: 'WEATHER', description: 'Current weather conditions', example: 'clear sky, sunny weather, light clouds' },
        { name: 'SEASON', description: 'Current season of the year', example: 'autumn leaves, fall colors, crisp air' },
        { name: 'CLOTHING', description: 'Weather-appropriate clothing', example: 'light jacket, summer dress, warm coat' },
        { name: 'ACTION', description: 'Time-appropriate activities', example: 'reading a book, having breakfast, walking in park' },
        { name: 'ENV', description: 'Environmental details', example: 'outdoor setting, indoor lighting, natural surroundings' }
    ];

    const lowerQuery = query.toLowerCase();

    // Filter placeholders that match the query
    return placeholders
        .filter(placeholder => placeholder.name.toLowerCase().includes(lowerQuery))
        .map(placeholder => ({
            type: 'dynamicPlaceholder',
            name: placeholder.name,
            placeholder: placeholder.name,
            description: placeholder.description,
            replacementValue: placeholder.example,
            displayName: placeholder.name
        }));
}

// Clear dynamic results (spell check and text replacements)
function clearDynamicResults() {
    persistentSpellCheckData = null;
    persistentWordLookupData = null;
}

// Calculate comprehensive ranking for search results
function calculateComprehensiveRanking(result, query, bestTextReplacement = null) {
    const resultType = result.type || '';
    const resultName = isTagResult(result)
        ? getTagDisplayLabel(result)
        : (result.name || result.placeholder || '');
    const queryLower = query.toLowerCase();
    const nameLower = resultName.toLowerCase();

    let score = 0;
    let isExactMatch = false;
    let isPrefixMatch = false;
    let textMatchTier = 0;

    if (isTagResult(result)) {
        const matchInfo = resolveTagTextMatchInfo(result, query);
        textMatchTier = matchInfo.tier;
        isExactMatch = matchInfo.isExactMatch;
        isPrefixMatch = matchInfo.isPrefixMatch;

        const textRelevance = result.predictionaryScore ||
            getTagTextRelevanceScore(query, resultName);

        const queryNormLen = normalizeTagSearchText(query).length;
        const nameNormLen = normalizeTagSearchText(resultName).length;

        if (matchInfo.tier === 4) {
            score += 1200;
        } else if (matchInfo.tier === 3) {
            score += 700;
            score -= Math.max(0, nameNormLen - queryNormLen - 1) * 4;
        } else if (matchInfo.tier === 2) {
            score += 550;
            score -= Math.max(0, nameNormLen - queryNormLen - 1) * 3;
        } else if (matchInfo.tier === 1) {
            score += 120;
            score -= Math.max(0, nameNormLen - queryNormLen) * 2;
        }

        if (matchInfo.matchCoverage) {
            score += matchInfo.matchCoverage * 2.5;
        }

        score += textRelevance * 2;

        const apiConfidence = getRawApiTagConfidence(result);
        if (matchInfo.tier === 0 && apiConfidence > 0) {
            score += apiConfidence * 3.5;
        } else {
            score += getTagScore(result) * 1.2;
            if (apiConfidence > 0) {
                score += apiConfidence * 0.5;
            }
        }

        const frequency = getTagNCount(result) || result.frequency || result.n || 0;
        score += Math.min(frequency * 0.05, 8);

        return {
            score: Math.round(score * 100) / 100,
            isExactMatch,
            isPrefixMatch,
            textMatchTier
        };
    }

    // Base score from similarity calculation (non-tag results)
    const similarityScore = result.predictionaryScore ||
        result.enhancedSimilarity ||
        result.matchScore ||
        calculateStringSimilarity(query, resultName);

    // Exact match bonus (highest priority)
    if (nameLower === queryLower) {
        score += 1000;
        isExactMatch = true;
    }

    // Prefix match bonus (second highest priority)
    if (!isExactMatch && nameLower.startsWith(queryLower)) {
        score += 500;
        isPrefixMatch = true;
    }

    // Contains query bonus
    if (!isExactMatch && !isPrefixMatch && nameLower.includes(queryLower)) {
        score += 200;
    }

    // Add similarity score (weighted)
    score += similarityScore * 2;

    // Type-specific adjustments
    switch (resultType) {
        case 'character':
        case 'characterTag':
            score += 50;
            if (result.similarity) {
                score += result.similarity * 0.5;
            }
            break;

        case 'textReplacement':
            if (bestTextReplacement &&
                resultName === bestTextReplacement.name &&
                result.placeholder === bestTextReplacement.placeholder) {
                score += 300;
            }
            if (result.placeholder && result.placeholder.toLowerCase() === queryLower) {
                score += 400;
            }
            break;
    }

    const frequency = getTagNCount(result) || result.frequency || result.n || 0;
    score += Math.min(frequency * 0.1, 10);

    return {
        score: Math.round(score * 100) / 100,
        isExactMatch,
        isPrefixMatch,
        textMatchTier
    };
}

function getCachedComprehensiveRanking(result, query, bestTextReplacement = null) {
    if (!result) {
        return { score: 0, isExactMatch: false, isPrefixMatch: false, textMatchTier: 0 };
    }
    const cacheKey = (query || '') + '|' + (bestTextReplacement?.name || '');
    if (result._rankCacheKey === cacheKey && result._rankCache) {
        return result._rankCache;
    }
    const ranking = calculateComprehensiveRanking(result, query, bestTextReplacement);
    result._rankCacheKey = cacheKey;
    result._rankCache = ranking;
    return ranking;
}

// Calculate string similarity score for better ranking
function calculateStringSimilarity(query, text) {
    if (!query || !text) return 0;

    const queryNorm = normalizeTagSearchText(query);
    const textNorm = normalizeTagSearchText(text);
    if (!queryNorm || !textNorm) return 0;

    if (textNorm === queryNorm) return 100;
    if (textNorm.startsWith(queryNorm)) return 85;
    if (textNorm.includes(queryNorm)) return 60;

    const queryWords = tokenizeTagSearchText(query);
    const textWords = tokenizeTagSearchText(text);
    if (queryWords.length === 0) return 0;

    let matchScore = 0;
    const totalWords = queryWords.length;

    for (const queryWord of queryWords) {
        let bestWordScore = 0;
        for (const textWord of textWords) {
            bestWordScore = Math.max(bestWordScore, getTokenMatchScore(queryWord, textWord));
        }
        matchScore += bestWordScore;
    }

    return totalWords > 0 ? matchScore / totalWords : 0;
}

// Get the best text replacement match for the current query
function getBestTextReplacementMatch(textReplacements, query) {
    if (!textReplacements || textReplacements.length === 0 || !query) return null;

    let bestMatch = null;
    let bestScore = 0;

    for (const replacement of textReplacements) {
        // Use existing match score if available, otherwise calculate it
        const totalScore = replacement.matchScore || calculateStringSimilarity(query, replacement.name);

        if (totalScore > bestScore) {
            bestScore = totalScore;
            bestMatch = { ...replacement, matchScore: totalScore };
        }
    }

    // Only return a best match if it has a high enough score (>= 70)
    // This prevents mediocre matches from appearing at the top
    return bestMatch && bestMatch.matchScore >= 70 ? bestMatch : null;
}

// Enhance character results with string similarity scores
function enhanceCharacterResultsWithStringSimilarity(results, query) {
    if (!results || !Array.isArray(results) || !query) return results;

    return results.map(result => {
        if (result.type === 'character' || result.type === 'characterTag') {
            const stringScore = calculateStringSimilarity(query, result.name);
            return {
                ...result,
                stringSimilarity: stringScore,
                // More balanced weighting: 50% string similarity, 50% existing similarity
                enhancedSimilarity: (stringScore * 0.5) + ((result.similarity || 0) * 0.5)
            };
        }
        return result;
    });
}

// Debug function to log ranking information
function logRankingDebug(results, query) {
    if (!results || results.length === 0) return;
    const typeCounts = {};
    results.forEach(result => {
        typeCounts[result.type] = (typeCounts[result.type] || 0) + 1;
    });

    // Log top 5 results with their scores
    const topResults = results.slice(0, 5);
    topResults.forEach((result, index) => {
        let score = 'N/A';
        if (isTagResult(result)) {
            const enhancedConfidence = getTagScore(result);
            const predictionaryScore = result.predictionaryScore || 'N/A';
            score = `enhanced: ${enhancedConfidence.toFixed(1)}, score: ${result.score || result.confidence || 0}, predictionary: ${predictionaryScore}`;
        } else if (result.type === 'character' || result.type === 'characterTag') {
            const stringScore = result.stringSimilarity || calculateStringSimilarity(query, result.name);
            const enhancedScore = result.enhancedSimilarity || (stringScore * 0.5) + ((result.similarity || 0) * 0.5);
            const predictionaryScore = result.predictionaryScore || 'N/A';
            score = `enhanced: ${enhancedScore.toFixed(1)}, string: ${stringScore.toFixed(1)}, similarity: ${result.similarity || 0}, predictionary: ${predictionaryScore}`;
        } else if (result.type === 'textReplacement') {
            const predictionaryScore = result.predictionaryScore || 'N/A';
            score = `matchScore: ${result.matchScore || 0}, predictionary: ${predictionaryScore}`;
        }
    });
}

// Deduplicate results from different services
function deduplicateResults(results) {
    if (!results || results.length === 0) return results;

    const tagMap = new Map(); // Map of tag name to best result
    const characterMap = new Map(); // Map of character name to best result
    const textReplacementMap = new Map(); // Map of text replacement key to best result
    const finalResults = [];

    for (const result of results) {
        if (isTagResult(result)) {
            const tagName = getTagDedupeKey(result);

            if (tagMap.has(tagName)) {
                // We have a duplicate tag - merge them intelligently
                const existingResult = tagMap.get(tagName);
                const mergedResult = mergeTagResults(existingResult, result);
                tagMap.set(tagName, mergedResult);
            } else {
                // First occurrence of this tag
                tagMap.set(tagName, result);
            }
        } else if (isCharacterResult(result)) {
            const characterName = result.name;

            if (characterMap.has(characterName)) {
                // We have a duplicate character - keep the one with better similarity
                const existingResult = characterMap.get(characterName);
                const existingScore = existingResult.enhancedSimilarity || existingResult.similarity || 0;
                const currentScore = result.enhancedSimilarity || result.similarity || 0;

                if (currentScore > existingScore) {
                    characterMap.set(characterName, result);
                }
            } else {
                // First occurrence of this character
                characterMap.set(characterName, result);
            }
        } else if (result.type === 'textReplacement') {
            const replacementKey = `${result.name}:${result.placeholder}`;

            if (textReplacementMap.has(replacementKey)) {
                // We have a duplicate text replacement - keep the one with better match score
                const existingResult = textReplacementMap.get(replacementKey);
                const existingScore = existingResult.matchScore || 0;
                const currentScore = result.matchScore || 0;

                if (currentScore > existingScore) {
                    textReplacementMap.set(replacementKey, result);
                }
            } else {
                // First occurrence of this text replacement
                textReplacementMap.set(replacementKey, result);
            }
        } else {
            // Non-duplicatable results (spellcheck, etc.) - add directly
            finalResults.push(result);
        }
    }

    // Merge characters that share a name with a tag result
    for (const [characterName, characterResult] of characterMap) {
        const matchKey = getCharacterDedupeKey(characterResult);
        if (tagMap.has(matchKey)) {
            const tagResult = tagMap.get(matchKey);
            tagMap.delete(matchKey);
            characterMap.set(characterName, mergeCharacterTagResults(characterResult, tagResult));
        }
    }

    // Add all deduplicated results to final results
    for (const result of tagMap.values()) {
        finalResults.push(result);
    }
    for (const result of characterMap.values()) {
        finalResults.push(result);
    }
    for (const result of textReplacementMap.values()) {
        finalResults.push(result);
    }

    return finalResults;
}

// Merge two tag results intelligently
function mergeTagResults(result1, result2) {
    if (isDualMatchTagResult(result1) && isLocalTagResult(result2)) {
        const mergedServices = [...new Set([
            ...(result1.mergedServices || []),
            getTagServiceKey(result2)
        ])];
        return mergeTagEnhancementFields(result1, result2, {
            ...result1,
            mergedServices,
            e_count: Math.max(result1.e_count || 0, result2.e_count || 0),
            d_count: Math.max(result1.d_count || 0, result2.d_count || 0),
            n_count: result1.n_count ?? result2.n_count ?? getTagNCount(result1),
            localResult: getPreferredLocalResult(result1.localResult || result1, result2)
        });
    }
    if (isDualMatchTagResult(result2) && isLocalTagResult(result1)) {
        return mergeTagResults(result2, result1);
    }

    const isResult1Api = isApiTagResult(result1);
    const isResult2Api = isApiTagResult(result2);
    const isResult1Local = isLocalTagResult(result1);
    const isResult2Local = isLocalTagResult(result2);

    if ((isResult1Api && isResult2Local) || (isResult1Local && isResult2Api)) {
        const apiResult = isResult1Api ? result1 : result2;
        const localResult = isResult1Local ? result1 : result2;
        const mergedServices = [
            getTagServiceKey(apiResult),
            getTagServiceKey(localResult)
        ];

        return mergeTagEnhancementFields(apiResult, localResult, {
            type: 'tag',
            source: 'dual-match',
            serviceName: 'dual-match',
            id: localResult.id,
            title: localResult.title || getTagDisplayLabel(localResult) || getTagDisplayLabel(apiResult),
            name: getTagInsertName(localResult) || getTagInsertName(apiResult),
            category: localResult.category ?? apiResult.category,
            categoryName: getTagCategoryLabel(localResult) || getTagCategoryLabel(apiResult),
            d_count: localResult.d_count ?? apiResult.d_count,
            e_count: localResult.e_count ?? apiResult.e_count,
            n_count: localResult.n_count ?? getTagNCount(apiResult),
            n: localResult.n ?? apiResult.n,
            datasets: localResult.datasets || [],
            hasWiki: localResult.hasWiki,
            wikiSources: localResult.wikiSources || [],
            primaryBody: localResult.primaryBody || apiResult.primaryBody || '',
            score: Math.max(getTagScore(apiResult), getTagScore(localResult)),
            enhancedConfidence: Math.max(getTagScore(apiResult), getTagScore(localResult)),
            mergedServices,
            isDualMatch: true,
            apiResult,
            localResult
        });
    }

    if (isResult1Local && isResult2Local) {
        const preferred = getPreferredLocalResult(result1, result2);
        return mergeTagEnhancementFields(result1, result2, preferred);
    }

    const preferred = getTagScore(result2) > getTagScore(result1) ? result2 : result1;
    return mergeTagEnhancementFields(result1, result2, preferred);
}

// Handle Tab cycling between main prompt and character prompts
function handlePromptTabCycling(e) {
    const manualPrompt = document.getElementById('manualPrompt');
    const manualUc = document.getElementById('manualUc');
    const manualPromptNegative = document.getElementById('manualPromptNegative');
    const characterPromptsContainer = document.getElementById('characterPromptsContainer');
    const promptTabs = document.querySelector('.prompt-tabs');

    if (!manualPrompt || !characterPromptsContainer) return;

    const isShowingBoth = promptTabs && promptTabs.classList.contains('show-both');
    const characterItems = characterPromptsContainer.querySelectorAll('.character-prompt-item');
    const characterItemsArray = Array.from(characterItems); // Convert NodeList to Array
    const currentlyFocused = document.activeElement;

    // Define the cycling order based on show-both mode
    let cycleOrder = [];

    if (isShowingBoth) {
        // Show both mode: prompt → uc → character prompt → character uc → next character prompt → next character uc...
        cycleOrder = [manualPrompt, manualUc, manualPromptNegative].filter(Boolean);

        // Add each character's prompt and UC textareas
        characterItemsArray.forEach(characterItem => {
            const promptTextarea = characterItem.querySelector(`#${characterItem.id}_prompt`);
            const ucTextarea = characterItem.querySelector(`#${characterItem.id}_uc`);

            if (promptTextarea) cycleOrder.push(promptTextarea);
            if (ucTextarea) cycleOrder.push(ucTextarea);
        });
    } else {
        // Single mode: determine which tab is active and include main prompts
        const mainToggleGroup = document.querySelector('#manualModal .prompt-tabs .gallery-toggle-group');
        const mainActiveTab = mainToggleGroup ? mainToggleGroup.getAttribute('data-active') : 'prompt';

        if (mainActiveTab === 'prompt') {
            // Prompt tab is active - cycle through prompt and character prompt textareas
            cycleOrder = [manualPrompt];
            characterItemsArray.forEach(characterItem => {
                const promptTextarea = characterItem.querySelector(`#${characterItem.id}_prompt`);
                if (promptTextarea) cycleOrder.push(promptTextarea);
            });
        } else if (mainActiveTab === 'uc') {
            // UC tab is active - cycle through UC, inline negative, and character UC textareas
            cycleOrder = [manualUc, manualPromptNegative].filter(Boolean);
            characterItemsArray.forEach(characterItem => {
                const ucTextarea = characterItem.querySelector(`#${characterItem.id}_uc`);
                if (ucTextarea) cycleOrder.push(ucTextarea);
            });
        } else {
            // Fallback - include both main prompts
            cycleOrder = [manualPrompt, manualUc, manualPromptNegative].filter(Boolean);
            characterItemsArray.forEach(characterItem => {
                const promptTextarea = characterItem.querySelector(`#${characterItem.id}_prompt`);
                const ucTextarea = characterItem.querySelector(`#${characterItem.id}_uc`);

                if (promptTextarea) cycleOrder.push(promptTextarea);
                if (ucTextarea) cycleOrder.push(ucTextarea);
            });
        }
    }

    // Find current position in cycle
    let currentIndex = -1;
    if (currentlyFocused === manualPrompt || currentlyFocused === manualUc || currentlyFocused === manualPromptNegative) {
        currentIndex = cycleOrder.indexOf(currentlyFocused);
    } else {
        // In a character textarea
        currentIndex = cycleOrder.indexOf(currentlyFocused);
    }
    if (currentIndex === -1) return;

    // Calculate next/previous index
    let targetIndex;
    if (e.shiftKey) {
        // Shift+Tab: Move backwards
        targetIndex = currentIndex > 0 ? currentIndex - 1 : cycleOrder.length - 1;
    } else {
        // Tab: Move forwards
        targetIndex = currentIndex < cycleOrder.length - 1 ? currentIndex + 1 : 0;
    }

    const targetElement = cycleOrder[targetIndex];

    // Helper function to scroll element into center view
    function scrollToCenter(element) {
        if (!element) return;

        // Use scrollIntoView with smooth behavior and center alignment
        element.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
            inline: 'center'
        });
    }

    // Handle navigation to target element
    if (targetElement === manualPrompt) {
        // Close current character prompt if we're in one
        if (currentlyFocused.closest('.character-prompt-item')) {
            const currentCharacterItem = currentlyFocused.closest('.character-prompt-item');
            if (!currentCharacterItem.classList.contains('collapsed')) {
                currentCharacterItem.classList.add('collapsed');
                // Update the collapse button icon
                updateCharacterPromptCollapseButton(currentCharacterItem.id, true);
            }
        }
        manualPrompt.focus();
        scrollToCenter(manualPrompt);
    } else if (targetElement === manualUc) {
        // Close current character prompt if we're in one
        if (currentlyFocused.closest('.character-prompt-item')) {
            const currentCharacterItem = currentlyFocused.closest('.character-prompt-item');
            if (!currentCharacterItem.classList.contains('collapsed')) {
                currentCharacterItem.classList.add('collapsed');
                // Update the collapse button icon
                updateCharacterPromptCollapseButton(currentCharacterItem.id, true);
            }
        }
        manualUc.focus();
        scrollToCenter(manualUc);
    } else if (manualPromptNegative && targetElement === manualPromptNegative) {
        if (currentlyFocused.closest('.character-prompt-item')) {
            const currentCharacterItem = currentlyFocused.closest('.character-prompt-item');
            if (!currentCharacterItem.classList.contains('collapsed')) {
                currentCharacterItem.classList.add('collapsed');
                updateCharacterPromptCollapseButton(currentCharacterItem.id, true);
            }
        }
        manualPromptNegative.focus();
        scrollToCenter(manualPromptNegative);
    } else if (targetElement.classList.contains('character-prompt-textarea')) {
        // Moving to a character textarea
        const targetCharacterItem = targetElement.closest('.character-prompt-item');

        if (targetCharacterItem) {
            // Only close current character prompt if we're moving from one character to another
            if (currentlyFocused.closest('.character-prompt-item')) {
                const currentCharacterItem = currentlyFocused.closest('.character-prompt-item');
                if (currentCharacterItem !== targetCharacterItem && !currentCharacterItem.classList.contains('collapsed')) {
                    currentCharacterItem.classList.add('collapsed');
                    // Update the collapse button icon
                    updateCharacterPromptCollapseButton(currentCharacterItem.id, true);
                }
            }

            // Switch to the correct tab if needed (only when not in show-both mode)
            if (!isShowingBoth) {
                const isUcTextarea = targetElement.id && targetElement.id.includes('_uc');
                const targetTab = isUcTextarea ? 'uc' : 'prompt';
                const targetTabPane = targetCharacterItem.querySelector(`#${targetCharacterItem.id}_${targetTab}-tab`);
                const currentTabPane = targetCharacterItem.querySelector('.tab-pane.active');

                if (targetTabPane && currentTabPane !== targetTabPane) {
                    currentTabPane.classList.remove('active');
                    targetTabPane.classList.add('active');
                }
            }

            // Expand target character prompt
            const wasCollapsed = targetCharacterItem.classList.contains('collapsed');
            if (wasCollapsed) {
                targetCharacterItem.classList.remove('collapsed');
                // Update the collapse button icon
                updateCharacterPromptCollapseButton(targetCharacterItem.id, false);
            }

            targetElement.focus();

            // Auto-resize the textarea after tab switch
            autoResizeTextarea(targetElement);

            // If the element was collapsed, wait for animation to complete before scrolling
            if (wasCollapsed) {
                setTimeout(() => {
                    scrollToCenter(targetCharacterItem);
                }, 300); // Wait for collapse/expand animation to complete
            } else {
                scrollToCenter(targetCharacterItem);
            }
        }
    }
}

// Function to delete the tag behind the cursor
function deleteTagBehindCursor(target) {
    const currentValue = target.value;
    const cursorPos = target.selectionStart;

    if (cursorPos === 0) return; // Nothing to delete if at the beginning

    const textBeforeCursor = currentValue.substring(0, cursorPos);

    // Use the same logic as emphasis manager to find the current tag
    const tagStart = findAutocompleteTermStart(textBeforeCursor);

    // Find the end of the current tag by looking for the next delimiter or end of text
    const textAfterCursor = currentValue.substring(cursorPos);
    const nextDelimiterIndex = Math.min(
        textAfterCursor.indexOf(',') >= 0 ? textAfterCursor.indexOf(',') : Infinity,
        textAfterCursor.indexOf('|') >= 0 ? textAfterCursor.indexOf('|') : Infinity,
        textAfterCursor.indexOf(':') >= 0 ? textAfterCursor.indexOf(':') : Infinity,
        textAfterCursor.indexOf('.') >= 0 ? textAfterCursor.indexOf('.') : Infinity,
        textAfterCursor.indexOf('{') >= 0 ? textAfterCursor.indexOf('{') : Infinity,
        textAfterCursor.indexOf('}') >= 0 ? textAfterCursor.indexOf('}') : Infinity,
        textAfterCursor.indexOf('[') >= 0 ? textAfterCursor.indexOf('[') : Infinity,
        textAfterCursor.indexOf(']') >= 0 ? textAfterCursor.indexOf(']') : Infinity
    );

    let tagEnd;
    if (nextDelimiterIndex !== Infinity) {
        tagEnd = cursorPos + nextDelimiterIndex;
    } else {
        tagEnd = currentValue.length;
    }

    // Get the tag text (trim whitespace)
    const tagText = currentValue.substring(tagStart, tagEnd).trim();

    // Check if we have a valid tag to delete (at least 2 characters)
    if (tagText.length < 2) return;

    // Handle special cases for emphasis blocks and brace blocks
    const emphasisPattern = /(-?\d+\.\d+)::([^:]+)::/;
    const bracePattern = /\{+([^{}]*)\}+|\[+([^\[\]]*)\]+/;

    if (emphasisPattern.test(tagText)) {
        // Delete the entire emphasis block
        const emphasisMatch = tagText.match(emphasisPattern);
        if (emphasisMatch) {
            // Extract the text content from the emphasis block
            const emphasizedText = emphasisMatch[2];

            // Replace the emphasis block with just the text content
            const beforeTag = currentValue.substring(0, tagStart);
            const afterTag = currentValue.substring(tagEnd);
            const newValue = beforeTag + emphasizedText + afterTag;

            // setTextareaValuePreservingUndo: public/scripts/comp/textareaUtils.js
        setTextareaValuePreservingUndo(target, newValue);

            // Set cursor position after the cleaned text
            const newCursorPos = tagStart + emphasizedText.length;
            setTimeout(() => {
                target.setSelectionRange(newCursorPos, newCursorPos);
                target.focus();
            }, 0);
        }
    } else if (bracePattern.test(tagText)) {
        // Delete the entire brace block
        const braceMatch = tagText.match(bracePattern);
        if (braceMatch) {
            // Extract the text content from the brace block
            const braceContent = braceMatch[1] || braceMatch[2];

            // Replace the brace block with just the text content
            const beforeTag = currentValue.substring(0, tagStart);
            const afterTag = currentValue.substring(tagEnd);
            const newValue = beforeTag + braceContent + afterTag;

            // setTextareaValuePreservingUndo: public/scripts/comp/textareaUtils.js
        setTextareaValuePreservingUndo(target, newValue);

            // Set cursor position after the cleaned text
            const newCursorPos = tagStart + braceContent.length;
            setTimeout(() => {
                target.setSelectionRange(newCursorPos, newCursorPos);
                target.focus();
            }, 0);
        }
    } else {
        // Regular tag deletion
        // Remove the tag and any trailing comma/space
        const beforeTag = currentValue.substring(0, tagStart);
        let afterTag = currentValue.substring(tagEnd);

        // Remove leading comma and space if present
        afterTag = afterTag.replace(/^,\s*/, '');

        // Remove trailing comma and space from beforeTag if present
        const cleanedBeforeTag = beforeTag.replace(/,\s*$/, '');

        const newValue = cleanedBeforeTag + afterTag;

        // setTextareaValuePreservingUndo: public/scripts/comp/textareaUtils.js
        setTextareaValuePreservingUndo(target, newValue);

        // Set cursor position to where the tag was
        const newCursorPos = cleanedBeforeTag.length;

        setTimeout(() => {
            target.setSelectionRange(newCursorPos, newCursorPos);
            target.focus();
        }, 0);
    }

    target.dispatchEvent(new CustomEvent('input', { bubbles: true, detail: { skipAutofill: true } }));
}

// Favorites functionality
function getSelectedTextFromTextarea(textarea) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    return textarea.value.substring(start, end);
}

function addToFavorites(selectedItem) {
    if (!selectedItem) return;

    const type = selectedItem.dataset.type;
    let itemData;

    if (type === 'tag') {
        itemData = {
            type: 'tag',
            name: selectedItem.dataset.tagName,
            count: selectedItem.dataset.count,
            model: selectedItem.dataset.model,
            confidence: selectedItem.dataset.confidence
        };
    } else if (type === 'textReplacement') {
        itemData = {
            type: 'textReplacement',
            name: selectedItem.dataset.placeholder,
            placeholder: selectedItem.dataset.placeholder,
            description: selectedItem.textContent
        };
    } else if (type === 'character') {
        const characterData = JSON.parse(selectedItem.dataset.characterData);
        itemData = {
            type: 'character',
            name: characterData.name,
            description: characterData.description || ''
        };
    } else {
        console.error('Unknown item type for favorites:', type);
        return;
    }

    // Send to server via WebSocket
    if (window.wsClient && window.wsClient.isConnected()) {
        const favoriteType = type === 'character' ? 'tags' : type + 's'; // characters go in tags, textReplacement becomes textReplacements

        window.wsClient.send({
            type: 'favorites_add',
            favoriteType: favoriteType,
            item: itemData,
            requestId: `favorite_add_${Date.now()}`
        });

        // Show success notification
        if (typeof showGlassToast === 'function') {
            showGlassToast('success', null, `Added "${itemData.name}" to favorites`, false, 3000, '<i class="fas fa-star"></i>');
        }
    } else {
        if (typeof showGlassToast === 'function') {
            showGlassToast('error', null, 'Unable to add to favorites: not connected to server', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
        }
    }
}

// Auto-detect if text is a tag and show appropriate dialog
async function showAddToFavoritesDialog(selectedText) {
    const isTag = await detectIfTag(selectedText);

    if (isTag) {
        await showTagConfirmationDialog(selectedText);
    } else {
        await showTextReplacementDialog(selectedText);
    }
}

// Detect if selected text is likely a tag
async function detectIfTag(text) {
    // Clean the text
    const cleanText = text.trim();

    // Check if it contains a comma delimiter and has at least 2 items
    // If so, it's a text replacement (like "find,replacement")
    // Otherwise, it's a tag
    const parts = cleanText.split(',');
    return parts.length < 2;
}

// Show simple confirmation dialog for tags
async function showTagConfirmationDialog(tagText) {
    const confirmed = await showConfirmationDialog(
        `Add "${tagText}" to favorites as a tag?`,
        [
            { text: 'Cancel', value: false, className: 'btn-secondary' },
            { text: 'Add to Favorites', value: true, className: 'btn-primary' }
        ]
    );

    if (confirmed) {
        const itemData = {
            type: 'tag',
            name: tagText,
            originalName: tagText,
            description: tagText
        };

        // Send to server via WebSocket
        if (window.wsClient && window.wsClient.isConnected()) {
            window.wsClient.send({
                type: 'favorites_add',
                favoriteType: 'tags',
                item: itemData,
                requestId: `favorite_add_${Date.now()}`
            });

            // Show success notification
            showGlassToast('success', null, `Added "${tagText}" to favorites`, false, 3000, '<i class="fas fa-star"></i>');
        } else {
            showGlassToast('error', null, 'Unable to add to favorites: not connected to server', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
        }
    }
}

// Position custom dialog similar to confirmationDialog
function positionCustomDialog(dialog, event = null) {
    if (!dialog) return;

    let x, y;

    if (event) {
        // Use mouse position or button position
        if (event.clientX && event.clientY) {
            x = event.clientX;
            y = event.clientY;
        } else if (event.target) {
            const rect = event.target.getBoundingClientRect();
            x = rect.left + rect.width / 2;
            y = rect.top + rect.height / 2;
        }
    } else {
        // Center on screen if no event
        x = window.innerWidth / 2;
        y = window.innerHeight / 2;
    }

    // Get dialog dimensions
    const dialogRect = dialog.getBoundingClientRect();
    const dialogWidth = dialogRect.width || 400; // Default width
    const dialogHeight = dialogRect.height || 200; // Default height

    // Calculate position to center on cursor/button
    let left = x - dialogWidth / 2;
    let top = y - dialogHeight / 2;

    // Ensure dialog doesn't go off screen
    const margin = 20;

    // Check horizontal bounds
    if (left < margin) {
        left = margin;
    } else if (left + dialogWidth > window.innerWidth - margin) {
        left = window.innerWidth - dialogWidth - margin;
    }

    // Check vertical bounds
    if (top < margin) {
        top = margin;
    } else if (top + dialogHeight > window.innerHeight - margin) {
        top = window.innerHeight - dialogHeight - margin;
    }

    // Apply position
    dialog.style.left = `${left}px`;
    dialog.style.top = `${top}px`;
    dialog.style.position = 'fixed';
}

// Extract first tag from text for use as placeholder name
function extractFirstTag(text) {
    const cleanText = text.trim();

    // Split by common delimiters
    const delimiters = [',', '\n', ';', '|', '(', ')', '[', ']', '{', '}'];
    let parts = [cleanText];

    // Split by each delimiter
    for (const delimiter of delimiters) {
        const newParts = [];
        for (const part of parts) {
            newParts.push(...part.split(delimiter));
        }
        parts = newParts;
    }

    // Find the first part that looks like a tag
    for (const part of parts) {
        const trimmed = part.trim();
        if (trimmed.length > 0 && trimmed.length <= 50) {
            // Convert to valid placeholder name
            const placeholder = trimmed
                .replace(/[^\w\s-]/g, '') // Remove special chars except word chars, spaces, hyphens
                .replace(/\s+/g, '_') // Replace spaces with underscores
                .toLowerCase()
                .replace(/^_+|_+$/g, '') // Remove leading/trailing underscores
                .replace(/_+/g, '_'); // Collapse multiple underscores

            if (placeholder.length > 0) {
                return placeholder;
            }
        }
    }

    // Fallback: use first few words
    const words = cleanText.split(/\s+/).slice(0, 3);
    return words.join('_').replace(/[^\w]/g, '').toLowerCase() || 'text_replacement';
}

// Show redesigned dialog for text replacements using popup system
async function showTextReplacementDialog(selectedText) {
    const defaultName = extractFirstTag(selectedText);

    // Create custom dialog using confirmation dialog system
    return new Promise((resolve) => {
        // Remove any existing dialog
        const existingDialog = document.querySelector('.favorites-dialog, .favorites-text-replacement-dialog');
        if (existingDialog) {
            existingDialog.remove();
        }

        const dialog = document.createElement('div');
        dialog.className = 'confirmation-dialog favorites-text-replacement-dialog';
        dialog.innerHTML = `
            <div class="confirmation-dialog-content">
                <div class="confirmation-message">
                    <strong>Add Genso Expander</strong>
                    <div class="selected-text-preview">Selected: "${selectedText}"</div>
                </div>
                <div class="text-replacement-form">
                    <div class="form-row">
                        <label for="replacementName">Name:</label>
                        <input type="text" id="replacementName" class="form-control" value="${defaultName}" placeholder="replacement_name">
                    </div>
                    <div class="form-hint">
                        <i class="fas fa-info-circle"></i> Will be available as !<span id="namePreview">${defaultName}</span>
                    </div>
                </div>
                <div class="confirmation-controls">
                    <button class="btn btn-secondary" id="cancelTextReplacement">Cancel</button>
                    <button class="btn btn-primary" id="saveTextReplacement">Add to Favorites</button>
                </div>
            </div>
        `;

        document.body.appendChild(dialog);

        // Position and show dialog
        positionCustomDialog(dialog);
        dialog.classList.remove('hidden');

        // Get elements
        const nameInput = dialog.querySelector('#replacementName');
        const namePreview = dialog.querySelector('#namePreview');
        const cancelBtn = dialog.querySelector('#cancelTextReplacement');
        const saveBtn = dialog.querySelector('#saveTextReplacement');

        // Focus and select name input
        nameInput.focus();
        nameInput.select();

        // Update preview as user types
        nameInput.addEventListener('input', (e) => {
            let value = e.target.value.replace(/\s+/g, '_');
            e.target.value = value;
            namePreview.textContent = value || 'replacement_name';
        });

        // Handle cancel
        cancelBtn.addEventListener('click', () => {
            dialog.remove();
            resolve(false);
        });

        // Handle save
        const handleSave = async () => {
            const name = nameInput.value.trim();
            if (!name) {
                showGlassToast('error', null, 'Please enter a name for the replacement', false, 3000, '<i class="fas fa-exclamation-triangle"></i>');
                nameInput.focus();
                return;
            }

            const itemData = {
                type: 'textReplacement',
                name: name,
                originalName: selectedText,
                description: selectedText,
                placeholder: name,
                replacementValue: selectedText
            };

            // Send to server via WebSocket
            if (window.wsClient && window.wsClient.isConnected()) {
                window.wsClient.send({
                    type: 'favorites_add',
                    favoriteType: 'textReplacements',
                    item: itemData,
                    requestId: `favorite_add_${Date.now()}`
                });

                showGlassToast('success', null, `Added text replacement "!${name}" to config`, false, 3000, '<i class="fas fa-lambda"></i>');
            } else {
                showGlassToast('error', null, 'Unable to add to favorites: not connected to server', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
            }

            dialog.remove();
            resolve(true);
        };

        saveBtn.addEventListener('click', handleSave);

        // Handle Enter key
        nameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleSave();
            } else if (e.key === 'Escape') {
                dialog.remove();
                resolve(false);
            }
        });
    });
}
