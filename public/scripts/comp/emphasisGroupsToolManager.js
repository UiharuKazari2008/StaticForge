// Emphasis Groups Tool — multi-instance tool windows for prompt emphasis editing
// INVARIANTS: .cursor/rules/emphasis-weight-rack-invariants.mdc — read before editing
// listAllEmphasisTargets, applyEmphasisTargetWeights: public/scripts/comp/emphasisParse.js

var emphasisNormalizationByField = {};

function getEmphasisNormalizationFieldStore() {
    if (!emphasisNormalizationByField || typeof emphasisNormalizationByField !== 'object') {
        emphasisNormalizationByField = {};
    }
    return emphasisNormalizationByField;
}

function getEmphasisNormalizationFieldKey(textarea) {
    return (textarea && textarea.id) ? textarea.id : '';
}

/** Stable per-prompt window key for position/size restore (e.g. emphasis-groups-tool-manualPrompt). */
function buildEmphasisGroupsWindowKey(textarea) {
    const fieldKey = getEmphasisNormalizationFieldKey(textarea) || 'unknown';
    return `emphasis-groups-tool-${fieldKey}`;
}

function readEmphasisNormalizationFieldState(fieldKey) {
    if (!fieldKey) return null;
    const store = getEmphasisNormalizationFieldStore();
    const state = store[fieldKey];
    return state && typeof state === 'object' ? state : null;
}

function writeEmphasisNormalizationFieldState(fieldKey, state) {
    if (!fieldKey) return;
    const store = getEmphasisNormalizationFieldStore();
    const hasGroupsById = !!(
        state
        && state.groupsById
        && typeof state.groupsById === 'object'
        && Object.keys(state.groupsById).length
    );
    if (!state || (!state.enabled && !hasGroupsById)) {
        delete store[fieldKey];
    } else {
        store[fieldKey] = state;
    }
    syncEmphasisNormalizationPreviewMetadata();
}

function syncEmphasisNormalizationPreviewMetadata() {
    const store = getEmphasisNormalizationFieldStore();
    const payload = Object.keys(store).length > 0 ? { ...store } : null;

    if (window.currentManualPreviewImage?.metadata) {
        if (!window.currentManualPreviewImage.metadata.forge_data) {
            window.currentManualPreviewImage.metadata.forge_data = {};
        }
        if (payload) {
            window.currentManualPreviewImage.metadata.forge_data.emphasis_normalization = payload;
        } else {
            delete window.currentManualPreviewImage.metadata.forge_data.emphasis_normalization;
        }
        delete window.currentManualPreviewImage.metadata.forge_data.emphasis_weight_management;
        delete window.currentManualPreviewImage.metadata.forge_data.emphasis_weight_management_applied;
    }

    if (window.lastGeneration) {
        if (!window.lastGeneration.forge_data) {
            window.lastGeneration.forge_data = {};
        }
        if (payload) {
            window.lastGeneration.forge_data.emphasis_normalization = payload;
        } else {
            delete window.lastGeneration.forge_data.emphasis_normalization;
        }
        delete window.lastGeneration.forge_data.emphasis_weight_management;
        delete window.lastGeneration.forge_data.emphasis_weight_management_applied;
    }
}

function scrubLegacyEmphasisWeightManagementKeys(forgeData) {
    if (!forgeData || typeof forgeData !== 'object') return;
    delete forgeData.emphasis_weight_management;
    delete forgeData.emphasis_weight_management_applied;
}

function loadEmphasisNormalizationFromForgeData(forgeData) {
    scrubLegacyEmphasisWeightManagementKeys(forgeData);
    const store = getEmphasisNormalizationFieldStore();
    Object.keys(store).forEach((key) => delete store[key]);
    const incoming = forgeData && forgeData.emphasis_normalization;
    if (!incoming || typeof incoming !== 'object') {
        syncEmphasisNormalizationPreviewMetadata();
        refreshEmphasisGroupsToolInstancesFromForgeState();
        return;
    }
    Object.entries(incoming).forEach(([fieldKey, state]) => {
        if (!state || typeof state !== 'object') return;
        const hasGroups = !!(state.groupsById && Object.keys(state.groupsById).length);
        if (state.enabled || hasGroups) {
            store[fieldKey] = { ...state };
        }
    });
    syncEmphasisNormalizationPreviewMetadata();
    refreshEmphasisGroupsToolInstancesFromForgeState();
}

function lookupEmphasisSavedKeyEntry(store, target) {
    if (!store || typeof store !== 'object' || !target) return undefined;
    // Managed ids are stable across edits; prefer them over start-position keys.
    if (target.managed && target.managedId != null) {
        const mid = target.managedId;
        if (store[`managed:${mid}`] !== undefined) return store[`managed:${mid}`];
        if (store[mid] !== undefined) return store[mid];
        if (store[String(mid)] !== undefined) return store[String(mid)];
    }
    const key = buildEmphasisTargetKey(target);
    const legacyKey = buildEmphasisTargetKeyLegacy(target);
    if (store[key] !== undefined) return store[key];
    if (store[legacyKey] !== undefined) return store[legacyKey];
    const startStr = typeof target.start === 'number' ? String(target.start) : '';
    if (!startStr) return undefined;
    const legacySuffix = `|${legacyKey}`;
    for (const storedKey of Object.keys(store)) {
        if (!storedKey.endsWith(legacySuffix)) continue;
        const parts = storedKey.split('|');
        if (parts.length >= 4 && parts[0] === startStr) return store[storedKey];
    }
    return undefined;
}

function refreshEmphasisGroupsToolInstancesFromForgeState() {
    if (!emphasisGroupsToolManager || !emphasisGroupsToolManager.instances) return;
    emphasisGroupsToolManager.instances.forEach((instance) => {
        instance.cardStateByKey.clear();
        instance.reconcileTargetsFromPrompt({ syncFromPrompt: true });
        instance._loadForgeState();
        instance._renderCards();
    });
}

function applyEmphasisNormalizationStateToPrompt(textarea) {
    const fieldKey = getEmphasisNormalizationFieldKey(textarea);
    const saved = readEmphasisNormalizationFieldState(fieldKey);
    if (!saved || !saved.enabled) return false;

    const value = textarea.value || '';
    // listEditorEmphasisTargets / resolveEmphasisBagForTextarea: public/scripts/comp/emphasisGroupIdCodec.js
    const targets = listEditorEmphasisTargets(value, resolveEmphasisBagForTextarea(textarea));
    if (!targets.length) return false;

    const minWeight = clampEmphasisWeightNormalize(saved.minWeight ?? 1);
    const maxWeight = clampEmphasisWeightNormalize(saved.maxWeight ?? 2);
    const opts = { normalizePrecision: true, directRangeMapping: true };

    const shares = targets.map((target, i) => {
        const savedShare = lookupEmphasisSavedKeyEntry(saved.percentagesByKey, target);
        if (typeof savedShare === 'number') {
            return clampEmphasisShare(savedShare);
        }
        if (Array.isArray(saved.percentages) && typeof saved.percentages[i] === 'number') {
            return clampEmphasisShare(saved.percentages[i]);
        }
        return weightToShare(target.weight, minWeight, maxWeight, opts);
    });

    const active = targets.map((_, i) => i).filter((i) => {
        const target = targets[i];
        if (!isEligibleForEmphasisNormalize(target.weight)) return false;
        return true;
    });

    const weighting = active.filter((i) => {
        const card = lookupEmphasisSavedKeyEntry(saved.cards, targets[i]);
        return !(card && card.deltaLocked);
    });

    const weights = sharesToWeights(shares, minWeight, maxWeight, weighting, opts);
    const weightByStart = new Map();
    const managedUpdates = [];
    targets.forEach((target, i) => {
        let weight = target.weight;
        if (weighting.includes(i) && weights[i] !== undefined) {
            weight = weights[i];
            if (target.type === 'brace') {
                weight = snapWeightForBraceMode(weight);
            }
        }
        if (target.managed && target.managedId != null) {
            managedUpdates.push({ id: target.managedId, weight });
        } else {
            weightByStart.set(target.start, weight);
        }
    });

    if (!weightByStart.size && !managedUpdates.length) return false;

    let changed = false;
    // Classic / brace first so managed visible rewrite sees the latest text
    if (weightByStart.size) {
        const newValue = applyEmphasisTargetWeights(value, weightByStart, opts);
        if (newValue !== value) {
            // setTextareaValuePreservingUndo: public/scripts/comp/textareaUtils.js
            setTextareaValuePreservingUndo(textarea, newValue);
            changed = true;
        }
    }
    // writeManagedEmphasisGroupWeightsForTextarea: public/scripts/comp/emphasisGroupIdCodec.js
    if (managedUpdates.length) {
        writeManagedEmphasisGroupWeightsForTextarea(textarea, managedUpdates);
        changed = true;
    }
    if (!changed) return false;

    // dispatchPromptTextareaInputEvent: public/scripts/comp/textareaUtils.js
    dispatchPromptTextareaInputEvent(textarea, { skipAutofill: true });
    if (updateEmphasisHighlighting) {
        updateEmphasisHighlighting(textarea);
    }
    if (promptTextareaToolbar) {
        promptTextareaToolbar.updateTokenCount(textarea);
    }
    return true;
}

function applyPendingEmphasisNormalizationBeforeGeneration() {
    const store = getEmphasisNormalizationFieldStore();
    Object.keys(store).forEach((fieldKey) => {
        const state = store[fieldKey];
        if (!state || !state.enabled) return;
        const instance = emphasisGroupsToolManager?.getInstanceByTextareaId(fieldKey);
        // Opt-in only — Apply menu "Auto Apply on Generate" (default off)
        const autoApply = instance
            ? !!instance.autoApplyOnGenerate
            : !!state.autoApplyOnGenerate;
        if (!autoApply) return;
        if (instance) {
            instance.reconcileTargetsFromPrompt({ preserveShares: true });
            if (instance._hasUnappliedNormalizeChanges()) {
                instance._applyNormalize();
            }
            return;
        }
        const textarea = document.getElementById(fieldKey);
        if (textarea) {
            applyEmphasisNormalizationStateToPrompt(textarea);
        }
    });
}

function flushPendingEmphasisDirectModeBeforeGeneration() {
    if (!emphasisGroupsToolManager || !emphasisGroupsToolManager.instances) return;
    emphasisGroupsToolManager.instances.forEach((instance) => {
        // Always flush — Normalize ON still commits non-eligible (weight < 1) via direct mode.
        instance._flushDirectModeApply();
    });
}

function getPromptFieldLabel(textarea) {
    const id = textarea.id || '';
    if (id === 'manualPrompt') return 'Main Prompt';
    if (id === 'manualUc') return 'UC';
    if (id === 'manualPromptNegative') return 'Inline Negative';
    if (id.endsWith('_prompt')) return 'Character Prompt';
    if (id.endsWith('_uc')) return 'Character UC';
    if (id.endsWith('_promptNegative')) return 'Character Negative';
    if (textarea.closest('.creative-directive-container')) return 'Creative Directive';
    return id || 'Prompt';
}

function truncateEmphasisCardLabel(text, maxLen) {
    const t = String(text || '').trim();
    if (!maxLen) return t;
    if (t.length <= maxLen) return t;
    return `${t.substring(0, maxLen - 1)}…`;
}

const EMPHASIS_BAND_DEFS = {
    positive: [
        { min: 1, max: 3, label: '1–3' },
        { min: 3, max: 5, label: '3–5' }
    ],
    negative: [
        { min: -2, max: 1, label: '−2–1' },
        { min: -4, max: -2, label: '−4–−2' }
    ]
};

const EMPHASIS_BAND_COUNT = 2;

function getEmphasisBandDefs(signMode) {
    return EMPHASIS_BAND_DEFS[signMode] || EMPHASIS_BAND_DEFS.positive;
}

function getEmphasisWeightBandBounds(signMode, bandIndex) {
    const bands = getEmphasisBandDefs(signMode);
    const band = bands[Math.max(0, Math.min(bands.length - 1, bandIndex | 0))];
    return { min: band.min, max: band.max };
}

function isWeightInBand(weight, signMode, bandIndex) {
    const w = clampEmphasisWeight(weight);
    const { min, max } = getEmphasisWeightBandBounds(signMode, bandIndex);
    return w >= min && w <= max;
}

function inferBandForSign(weight, signMode) {
    const w = clampEmphasisWeight(weight);
    const bands = getEmphasisBandDefs(signMode);
    for (let i = 0; i < bands.length; i++) {
        if (isWeightInBand(w, signMode, i)) return i;
    }
    if (signMode === 'negative') {
        return w > -2 ? 0 : 1;
    }
    return w <= 3 ? 0 : 1;
}

/**
 * Infer emphasis sign from weight:
 *   w < 1  → negative emphasis (includes 0 < w < 1 de-emphasis and literal negatives)
 *   w > 1  → positive emphasis
 *   w ≈ 1  → gray area: keep currentSignMode when known, else positive
 */
function inferEmphasisSignMode(weight, currentSignMode) {
    const w = clampEmphasisWeight(weight);
    if (w < 1) return 'negative';
    if (w > 1) return 'positive';
    return currentSignMode === 'negative' ? 'negative' : 'positive';
}

function inferEmphasisWeightBand(weight, currentSignMode) {
    const w = clampEmphasisWeight(weight);
    const signMode = inferEmphasisSignMode(w, currentSignMode);
    return { signMode, band: inferBandForSign(w, signMode) };
}

/** Uniform tick alpha for major/minor weight notches (1.0 ramp is transparent → grayish white). */
const EMPHASIS_SLIDER_TICK_ALPHA = 0.5;

/** Tick color for weight notch — emphasis rgb at fixed transparency for all major/minor marks. */
function getEmphasisSliderTickColor(weight) {
    // 1.0 highlight is fully transparent in the ramp — use neutral gray
    if (Math.abs(weight - 1) < 1e-9) {
        return `rgba(232, 232, 232, ${EMPHASIS_SLIDER_TICK_ALPHA})`;
    }
    // computeEmphasisWeightColor: public/scripts/comp/emphasisParse.js
    const c = computeEmphasisWeightColor(weight);
    return `rgba(${c.r}, ${c.g}, ${c.b}, ${EMPHASIS_SLIDER_TICK_ALPHA})`;
}

/**
 * Weight-axis ticks: half-height every 0.5, three-quarter every whole number.
 * Full-height landmarks: green @ 0, blue @ -1.
 */
function buildEmphasisWeightSliderTicks(min, max) {
    const range = max - min;
    if (!(range > 0) || !Number.isFinite(min) || !Number.isFinite(max)) return [];

    const ticks = [];
    // Align to 0.5 grid at or above min
    let v = Math.ceil((min - 1e-9) * 2) / 2;
    const end = max + 1e-9;
    while (v <= end) {
        if (v >= min - 1e-9 && v <= max + 1e-9) {
            const pct = ((v - min) / range) * 100;
            const isWhole = Math.abs(v - Math.round(v)) < 1e-9;

            if (Math.abs(v - 0) < 1e-9) {
                ticks.push({ pct, height: 'full', color: 'green' });
            } else if (Math.abs(v + 1) < 1e-9) {
                ticks.push({ pct, height: 'full', color: 'blue' });
            } else {
                ticks.push({
                    pct,
                    height: isWhole ? 'three-quarter' : 'half',
                    color: 'emphasis',
                    bg: getEmphasisSliderTickColor(v)
                });
            }
        }
        v = Math.round((v + 0.5) * 2) / 2;
    }
    return ticks;
}

function getEmphasisCardTypeIcon(target) {
    if (target.type === 'group') return '';
    if (target.braceKind === 'bracket') {
        return '<i class="fas fa-brackets-square emphasis-groups-type-icon mode-normal" title="Bracket"></i>';
    }
    return '<i class="fas fa-brackets-curly emphasis-groups-type-icon mode-brace" title="Brace"></i>';
}

function updateCardSignBtn(btn, signMode) {
    if (!btn) return;
    const negative = signMode === 'negative';
    btn.setAttribute('data-state', negative ? 'on' : 'off');
    btn.title = negative ? 'Negative weights' : 'Positive weights';
    const icon = btn.querySelector('i');
    if (icon) {
        icon.className = negative ? 'fas fa-minus' : 'fas fa-plus';
    }
}

function updateCardBandToggle(toggleEl, signMode, weightBand) {
    if (!toggleEl) return;
    const bands = getEmphasisBandDefs(signMode);
    const band = Math.max(0, Math.min(bands.length - 1, weightBand | 0));
    toggleEl.setAttribute('data-active', String(band));
    toggleEl.querySelectorAll('.gallery-toggle-btn').forEach((btn) => {
        const bandIndex = parseInt(btn.dataset.band, 10) || 0;
        btn.classList.toggle('active', bandIndex === band);
        const textEl = btn.querySelector('.tab-text');
        if (textEl && bands[bandIndex]) {
            textEl.textContent = bands[bandIndex].label;
        }
        const bounds = getEmphasisWeightBandBounds(signMode, bandIndex);
        btn.title = `${formatEmphasisWeight(bounds.min)} to ${formatEmphasisWeight(bounds.max)}`;
    });
}

function applyCardSliderBounds(slider, cardState, weight) {
    if (!slider || !cardState) return;
    const bounds = getEmphasisWeightBandBounds(cardState.signMode, cardState.weightBand);
    slider.min = String(bounds.min);
    slider.max = String(bounds.max);
    slider.step = String(EMPHASIS_WEIGHT_FINE_STEP);
    const w = clampEmphasisWeight(weight);
    slider.value = String(Math.max(bounds.min, Math.min(bounds.max, w)));
}

const EMPHASIS_NORMALIZE_RANGE_STEP = 0.25;
const EMPHASIS_DIRECT_MODE_APPLY_DELAY = 3000;

function findParentModalForTextarea(textarea) {
    let el = textarea.parentElement;
    while (el) {
        if (el.classList && el.classList.contains('modal') && !el.classList.contains('emphasis-groups-tool')) {
            return el;
        }
        el = el.parentElement;
    }
    return document.getElementById('manualModal');
}

class EmphasisGroupsToolInstance {
    constructor(id, element, textarea, manager) {
        this.id = id;
        this.element = element;
        this.textarea = textarea;
        this.textareaId = textarea.id || '';
        this.manager = manager;

        this.targets = [];
        this.shares = [];
        this.contextCards = [];
        this.cardStateByKey = new Map();
        this.normalizeEnabled = false;
        this.minWeight = 1;
        this.maxWeight = 2;
        this.deltaMode = false;
        this.distributionMode = false;
        this.autoBandEnabled = false;
        this.attentionRescaleEnabled = false;
        this.autoApplyOnGenerate = false;
        this.preNormalizeWeights = new Map();
        this.preNormalizeWeightsByKey = {};
        this._distributionStash = null;
        this._distributionApplied = false;
        this._lastDistribution = null;
        this._suggestedByLocalIndex = [];
        this._absMaxWeight = 1;
        this._deltaDragFloorByIndex = null;
        this._notchRefreshTimer = null;
        this._siblingRefreshTimer = null;
        this._textareaBlurTimer = null;
        this._rackPointerDown = false;
        this._closePromptOpen = false;

        this.isApplyingFromTool = false;
        this.isDraggingSlider = false;
        this._reconcileTimer = null;
        this._focusReconcileTimer = null;
        this._applyTimer = null;
        this._pendingSliderApply = null;
        this._finishSliderTimer = null;
        this._directModeApplyTimer = null;
        this._lastRenderedTargetCount = -1;
        this._lastRenderedHadEmpty = null;

        this._refs = {};
        this._bindRefs();
        this._wireControls();
        this._wireGridDelegatedEvents();
        this._wireSyncListeners();
        this.reconcileTargetsFromPrompt({ syncFromPrompt: true });
        this._loadForgeState();
        this._renderCards();

        const parentModal = findParentModalForTextarea(textarea);
        if (parentModal && linkToolWindowToParent) {
            linkToolWindowToParent(this.element, parentModal);
        }

        openModal(this.element);
        this._wireKeyboardShortcuts();
    }

    _wireKeyboardShortcuts() {
        if (this._keyboardShortcutIds) return;
        this._keyboardShortcutIds = [];
        const modalId = this.element.id;

        const addShortcut = (suffix, keys, label, icon, onKey, options = {}) => {
            const id = `emphasisGroupsTool.${modalId}.${suffix}`;
            // registerKeyboardListener, notifyKeyboardOverlayContextChanged: public/scripts/comp/modalKeyboardRegistry.js
            registerKeyboardListener({
                id,
                type: 'whenFocused',
                modalId,
                handler: (e) => {
                    if (e.key.toUpperCase() !== keys.toUpperCase()) return;
                    return onKey(e);
                },
                priority: 85,
                label,
                keys,
                overlayIcon: icon,
                overlayGroup: 'Emphasis',
                overlayFnRow: 'primary',
                overlayValid: options.overlayValid || null
            });
            this._keyboardShortcutIds.push(id);
        };

        addShortcut('normalize', 'F1', 'Normalize', 'fas fa-chart-pie', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (this.normalizeEnabled) {
                this._disableNormalize();
            } else {
                this._enableNormalize();
            }
            notifyKeyboardOverlayContextChanged();
            return true;
        });

        addShortcut('delta', 'F2', 'Delta Mode', null, (e) => {
            if (!this.normalizeEnabled || this.distributionMode) return;
            e.preventDefault();
            e.stopPropagation();
            const next = this._refs.deltaModeBtn?.getAttribute('data-state') !== 'on';
            this._setDeltaMode(next);
            notifyKeyboardOverlayContextChanged();
            return true;
        }, { overlayValid: () => this.normalizeEnabled });

        addShortcut('apply', 'F3', 'Apply', 'fas fa-check', async (e) => {
            if (!this.normalizeEnabled) return;
            e.preventDefault();
            e.stopPropagation();
            await this._applyNormalize();
            return true;
        }, { overlayValid: () => this.normalizeEnabled });
    }

    _unwireKeyboardShortcuts() {
        if (!this._keyboardShortcutIds) return;
        this._keyboardShortcutIds.forEach((id) => deregisterKeyboardListener(id));
        this._keyboardShortcutIds = null;
        notifyKeyboardOverlayContextChanged();
    }

    _bindRefs() {
        const q = (suffix) => this.element.querySelector(`#${suffix}_${this.id}`);
        this._refs.title = q('emphasisGroupsToolTitle');
        this._refs.normalizeBtn = q('emphasisGroupsNormalizeBtn');
        this._refs.normalizeRange = q('emphasisGroupsNormalizeRange');
        this._refs.minWeight = q('emphasisGroupsMinWeight');
        this._refs.maxWeight = q('emphasisGroupsMaxWeight');
        this._refs.minWeightDown = q('emphasisGroupsMinWeightDown');
        this._refs.minWeightUp = q('emphasisGroupsMinWeightUp');
        this._refs.maxWeightDown = q('emphasisGroupsMaxWeightDown');
        this._refs.maxWeightUp = q('emphasisGroupsMaxWeightUp');
        this._refs.autoRangeBtn = q('emphasisGroupsAutoRangeBtn');
        this._refs.pullBandBtn = q('emphasisGroupsPullBandBtn');
        this._refs.modeGroup = q('emphasisGroupsModeGroup');
        this._refs.deltaModeBtn = q('emphasisGroupsDeltaModeBtn');
        this._refs.distributionModeBtn = q('emphasisGroupsDistributionModeBtn');
        this._refs.scopeBtn = q('emphasisGroupsScopeBtn');
        this._refs.rebalanceBtn = q('emphasisGroupsRebalanceBtn');
        this._refs.rebalanceLabel = this._refs.rebalanceBtn?.querySelector('.emphasis-groups-rebalance-label') || null;
        this._refs.attentionRescaleBtn = q('emphasisGroupsAttentionRescaleBtn');
        this._refs.applyBtn = q('emphasisGroupsApplyBtn');
        this._refs.grid = q('emphasisGroupsGrid');
        this._refs.empty = q('emphasisGroupsEmpty');

        if (this._refs.title) {
            this._updateTitle();
        }
    }

    _updateTitle() {
        if (!this._refs.title) return;
        const label = getPromptFieldLabel(this.textarea);
        const dirty = this.normalizeEnabled && this._hasUnappliedNormalizeChanges();
        this._refs.title.textContent = `Weight Rack [${label}${dirty ? '*' : ''}]`;
    }

    _hasUnappliedNormalizeChanges() {
        if (!this.normalizeEnabled) return false;
        const weighting = this._getWeightingIndices();
        if (!weighting.length) return false;
        let preview;
        if (this.distributionMode) {
            // Peek apply-time weights from importance without mutating notch/suggestion cache
            const dist = this._getAutoDistribution(weighting, { withImportance: true, skipCacheUpdate: true });
            const relativeByLocal = dist.relativeImportancesByLocalIndex || {};
            const tempShares = [];
            weighting.forEach((i) => {
                tempShares[i] = relativeByLocal[i] !== undefined ? relativeByLocal[i] : 0;
            });
            preview = sharesToWeights(
                tempShares,
                this.minWeight,
                this.maxWeight,
                weighting,
                this._getNormalizeWeightOptions()
            );
        } else {
            preview = sharesToWeights(
                this.shares,
                this.minWeight,
                this.maxWeight,
                weighting,
                this._getNormalizeWeightOptions()
            );
        }
        for (const i of weighting) {
            const target = this.targets[i];
            if (!target) continue;
            const promptW = this._clampNormalizeWeight(this._targetWeightForNormalize(target));
            let previewW = preview[i];
            if (previewW === undefined) continue;
            // Apply snaps braces to NovelAI 1.05^n — compare with the same snap or dirty stays true forever.
            if (target.type === 'brace') {
                previewW = snapWeightForBraceMode(previewW);
            }
            if (Math.abs(promptW - this._clampNormalizeWeight(previewW)) > 0.00005) {
                return true;
            }
        }
        return false;
    }

    _wireControls() {
        const closeBtn = this.element.querySelector('.close-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.close());
        }

        if (this._refs.normalizeBtn) {
            this._refs.normalizeBtn.addEventListener('click', () => {
                if (this.normalizeEnabled) {
                    this._disableNormalize();
                } else {
                    this._enableNormalize();
                }
            });
        }

        const onRangeInput = () => {
            this._applyNormalizeRangeInputsLive();
        };

        const onRangeCommit = () => {
            this._commitNormalizeRangeInputs();
        };

        if (this._refs.minWeight) {
            this._refs.minWeight.addEventListener('input', onRangeInput);
            this._refs.minWeight.addEventListener('change', onRangeCommit);
            this._refs.minWeight.addEventListener('blur', onRangeCommit);
        }
        if (this._refs.maxWeight) {
            this._refs.maxWeight.addEventListener('input', onRangeInput);
            this._refs.maxWeight.addEventListener('change', onRangeCommit);
            this._refs.maxWeight.addEventListener('blur', onRangeCommit);
        }

        const wireRangeStep = (btn, field, delta) => {
            if (!btn) return;
            btn.addEventListener('click', () => {
                this._adjustNormalizeRange(field, delta);
            });
        };
        wireRangeStep(this._refs.minWeightDown, 'min', -EMPHASIS_NORMALIZE_RANGE_STEP);
        wireRangeStep(this._refs.minWeightUp, 'min', EMPHASIS_NORMALIZE_RANGE_STEP);
        wireRangeStep(this._refs.maxWeightDown, 'max', -EMPHASIS_NORMALIZE_RANGE_STEP);
        wireRangeStep(this._refs.maxWeightUp, 'max', EMPHASIS_NORMALIZE_RANGE_STEP);

        this._wireRangeWheelControls();

        if (this._refs.autoRangeBtn) {
            this._refs.autoRangeBtn.addEventListener('click', () => {
                if (this.autoBandEnabled) return;
                this._runAutoBand({ oneShot: true });
            });
            this._attachAutomaticScalingMenu(this._refs.autoRangeBtn, 'autoBand');
        }

        if (this._refs.pullBandBtn) {
            this._refs.pullBandBtn.addEventListener('click', () => {
                this._runPullBandRange();
            });
        }

        if (this._refs.attentionRescaleBtn) {
            this._refs.attentionRescaleBtn.addEventListener('click', () => {
                if (this.attentionRescaleEnabled) return;
                this._runAttentionRescale({ oneShot: true });
            });
            this._attachAutomaticScalingMenu(this._refs.attentionRescaleBtn, 'attentionRescale');
        }

        if (this._refs.applyBtn) {
            this._refs.applyBtn.addEventListener('click', () => {
                this._applyNormalize();
            });
            this._attachApplyContextMenu(this._refs.applyBtn);
        }

        if (this._refs.rebalanceBtn) {
            this._refs.rebalanceBtn.addEventListener('click', () => {
                this._runCombinedOneShot();
            });
        }

        if (this._refs.deltaModeBtn) {
            this._refs.deltaModeBtn.addEventListener('click', () => {
                this._setDeltaMode(this._refs.deltaModeBtn.getAttribute('data-state') !== 'on');
            });
        }

        if (this._refs.distributionModeBtn) {
            this._refs.distributionModeBtn.addEventListener('click', () => {
                const next = this._refs.distributionModeBtn.getAttribute('data-state') !== 'on';
                this._setDistributionMode(next);
            });
        }

        if (this._refs.scopeBtn) {
            this._refs.scopeBtn.classList.add('hidden');
            this._refs.scopeBtn.setAttribute('hidden', 'true');
        }

        this._updateNormalizeToolbar();
    }

    _shouldSkipFocusReconcile(el) {
        if (!el) return false;
        return !!el.closest(
            '.emphasis-groups-card, button, .gallery-toggle-btn, .emphasis-groups-card-slider, .emphasis-groups-card-weight-input, .emphasis-groups-weight-input'
        );
    }

    _shouldDeferCardRender() {
        return this.isDraggingSlider;
    }

    _wireGridDelegatedEvents() {
        if (this._gridDelegatedEventsWired) return;
        this._gridDelegatedEventsWired = true;

        this.element.addEventListener('wheel', (e) => {
            const weightEl = e.target.closest('.emphasis-groups-card-weight.emphasis-groups-card-weight-wheelable');
            if (!weightEl || weightEl.classList.contains('hidden') || this._isReadOnly()) return;

            const card = weightEl.closest('.emphasis-groups-card');
            if (!card) return;

            const index = parseInt(card.dataset.index, 10);
            const target = this.targets[index];
            if (!target) return;

            e.preventDefault();
            e.stopPropagation();

            const step = this._getCardWheelStep(e, target);
            const delta = e.deltaY > 0 ? -step : step;
            const isParticipant = this._isNormalizeParticipant(target);

            if (isParticipant && target?.cardState?.deltaLocked) {
                return;
            }

            if (isParticipant && this.normalizeEnabled) {
                if (this.deltaMode) {
                    const active = this.getActiveIndices();
                    const weights = this._getParticipantWeights(active);
                    const current = weights[index] ?? this._targetWeightForNormalize(target);
                    let next = this._clampNormalizeWeight(current + delta);
                    next = Math.max(this.minWeight, Math.min(this.maxWeight, next));
                    this._applyParticipantWeightChange(index, next, weightEl);
                    return;
                }
                if (this.distributionMode) {
                    const currentImp = Number.isFinite(target.cardState.importance)
                        ? target.cardState.importance
                        : EMPHASIS_IMPORTANCE_UNBIASED;
                    let newImp = clampEmphasisShare(currentImp + delta);
                    if (this.isDraggingSlider) {
                        newImp = Math.max(EMPHASIS_IMPORTANCE_UNBIASED, newImp);
                    }
                    this._applyParticipantShareChange(index, newImp, weightEl);
                    return;
                }
                const currentShare = this.shares[index] ?? target.cardState.share ?? 0;
                const newShare = clampEmphasisShare(currentShare + delta);
                this._applyParticipantShareChange(index, newShare, weightEl);
                return;
            }

            if (this.normalizeEnabled && this._usesNormalizeCardChrome(target)) {
                return;
            }

            if (!this.normalizeEnabled) {
                const card = weightEl.closest('.emphasis-groups-card');
                const slider = card?.querySelector('.emphasis-groups-card-slider');
                const current = target.cardState?.directWeight ?? target.weight;
                let next = Number.isFinite(current) ? current + delta : delta;
                next = this._clampDirectModeWeight(next, target);
                if (target.type === 'brace') {
                    next = snapWeightForBraceMode(next);
                    next = this._clampDirectModeWeight(next, target);
                }
                this._commitDirectModeWeight(index, next, weightEl, { rerender: false, flushImmediate: false });
                const bounds = this._getDirectModeWeightBounds(target);
                if (slider) {
                    slider.min = String(bounds.min);
                    slider.max = String(bounds.max);
                    slider.value = String(next);
                }
                return;
            }

            this._nudgeCardDirectWeight(index, delta, target, { rerender: false });
            this._setCardWeightDisplay(weightEl, target.cardState.directWeight);
        }, { passive: false, capture: true });

        this.element.addEventListener('pointerdown', (e) => {
            if (e.target.closest('.modal-window-controls')) return;
            // handleModalClick: public/scripts/comp/modalUtils.js
            handleModalClick(this.element);
        }, true);
    }

    _flushPendingSliderInput() {
        clearTimeout(this._applyTimer);
        this._applyTimer = null;
        const pending = this._pendingSliderApply;
        if (!pending) return;
        this._pendingSliderApply = null;
        this._applySliderInput(
            pending.index,
            pending.value,
            pending.weightEl,
            pending.isNormalizeParticipant
        );
    }

    _applySliderInput(index, value, weightEl, isNormalizeParticipant) {
        if (this.normalizeEnabled && isNormalizeParticipant && this.targets[index]?.cardState?.deltaLocked) {
            return;
        }
        if (this.normalizeEnabled && isNormalizeParticipant && this.distributionMode) {
            this._applyParticipantShareChange(index, value, weightEl);
            return;
        }
        if (this.normalizeEnabled && isNormalizeParticipant && this.deltaMode) {
            this._applyParticipantWeightChange(index, value, weightEl);
            return;
        }
        if (this.normalizeEnabled && isNormalizeParticipant) {
            this._applyParticipantShareChange(index, value, weightEl);
            return;
        }

        if (!this.normalizeEnabled || !isNormalizeParticipant) {
            if (this.isDraggingSlider) {
                this._previewDirectModeWeight(index, value, weightEl);
            } else {
                this._commitDirectModeWeight(index, value, weightEl);
            }
        }
    }

    _finishSliderDrag(isParticipant) {
        clearTimeout(this._finishSliderTimer);
        this._finishSliderTimer = setTimeout(() => {
            // Clear drag flag before flush so direct-mode commits and peers refresh once
            this.isDraggingSlider = false;
            this._flushPendingSliderInput();
            this._clearDeltaDragFloor();
            if (this.normalizeEnabled && isParticipant) {
                if (this.deltaMode) {
                    // Delta: peers were rebalanced in memory — refresh all thumbs now
                    this._updateParticipantShareUI(this.getActiveIndices());
                }
                // Share / distribution (delta off): peers never moved — flush updated active card only
                this._persistForgeState();
                this._scheduleNotchRefresh({ immediate: true });
                this._syncCompensateHint();
                return;
            }
            if (!this.normalizeEnabled) {
                // Commit to prompt immediately — delayed 3s apply left cardState ahead of
                // the prompt so the next syncFromPrompt snapped values back.
                this._flushDirectModeApply();
                this._scheduleNotchRefresh({ immediate: true });
                return;
            }
            if (!isParticipant) {
                // Non-eligible under Normalize: commit direct weights (do not reconcile-from-prompt
                // first — that snaps the card back before the 3s timer / flush runs).
                this._flushDirectModeApply();
                this.reconcileTargetsFromPrompt();
                this._renderCards();
                this._scheduleNotchRefresh({ immediate: true });
            }
        }, 0);
    }

    _adjustNormalizeRange(field, delta) {
        if (this.normalizeEnabled && this.autoBandEnabled) return;
        if (!this.normalizeEnabled && field === 'min') return;
        const oldMin = this.minWeight;
        const oldMax = this.maxWeight;
        // Match typed range inputs: 4dp under Normalize, 2dp in direct mode.
        const clamp = this.normalizeEnabled
            ? this._clampNormalizeWeight.bind(this)
            : clampEmphasisWeight;
        if (field === 'min') {
            this.minWeight = clamp(this.minWeight + delta);
            if (this.minWeight > this.maxWeight) {
                this.maxWeight = this.minWeight;
            }
        } else {
            this.maxWeight = clamp(this.maxWeight + delta);
            if (this.maxWeight < this.minWeight) {
                this.minWeight = this.maxWeight;
            }
        }
        this._syncNormalizeRangeInputs();
        if (this.normalizeEnabled) {
            this._afterNormalizeRangeChange(oldMin, oldMax, { userRangeEdit: true });
            this._persistForgeState();
            this._renderCards();
            return;
        }
        this._updateAllDirectModeSliders();
    }

    _isIncompleteRangeInputText(text) {
        const t = String(text ?? '').trim();
        if (!t) return true;
        if (t === '-' || t === '.' || t === '-.') return true;
        if (t.endsWith('.')) return true;
        return false;
    }

    _parseCommittedRangeInput(text, fallback) {
        if (this._isIncompleteRangeInputText(text)) return fallback;
        const n = parseFloat(String(text).trim());
        return isNaN(n) ? fallback : n;
    }

    _applyNormalizeRangeInputsLive() {
        if (this.normalizeEnabled && this.autoBandEnabled) return;
        const clamp = this.normalizeEnabled ? this._clampNormalizeWeight.bind(this) : clampEmphasisWeight;
        const oldMin = this.minWeight;
        const oldMax = this.maxWeight;
        const minRaw = this._refs.minWeight?.value;
        const maxRaw = this._refs.maxWeight?.value;
        let changed = false;

        if (this.normalizeEnabled && !this._isIncompleteRangeInputText(minRaw)) {
            const minParsed = parseFloat(String(minRaw).trim());
            if (!isNaN(minParsed)) {
                this.minWeight = clamp(minParsed);
                changed = true;
            }
        }
        if (!this._isIncompleteRangeInputText(maxRaw)) {
            const maxParsed = parseFloat(String(maxRaw).trim());
            if (!isNaN(maxParsed)) {
                this.maxWeight = clamp(maxParsed);
                changed = true;
            }
        }
        if (!changed) return;

        if (this.normalizeEnabled) {
            this.minWeight = Math.max(1, this.minWeight);
            if (this.minWeight > this.maxWeight) {
                const tmp = this.minWeight;
                this.minWeight = this.maxWeight;
                this.maxWeight = tmp;
            }
            this._afterNormalizeRangeChange(oldMin, oldMax, { userRangeEdit: true });
            this._persistForgeState();
        }
        if (!this.normalizeEnabled) {
            this._updateAllDirectModeSliders();
            return;
        }
        this._renderCards();
    }

    _commitNormalizeRangeInputs() {
        if (this.normalizeEnabled && this.autoBandEnabled) {
            this._syncNormalizeRangeInputs(true);
            return;
        }
        const clamp = this.normalizeEnabled ? this._clampNormalizeWeight.bind(this) : clampEmphasisWeight;
        const oldMin = this.minWeight;
        const oldMax = this.maxWeight;
        if (this.normalizeEnabled) {
            this.minWeight = clamp(this._parseCommittedRangeInput(this._refs.minWeight?.value, this.minWeight));
        }
        this.maxWeight = clamp(this._parseCommittedRangeInput(this._refs.maxWeight?.value, this.maxWeight));
        if (this.normalizeEnabled) {
            this.minWeight = Math.max(1, this.minWeight);
        }
        if (this.minWeight > this.maxWeight) {
            const tmp = this.minWeight;
            this.minWeight = this.maxWeight;
            this.maxWeight = tmp;
        }
        this._syncNormalizeRangeInputs();
        if (this.normalizeEnabled) {
            this._afterNormalizeRangeChange(oldMin, oldMax, { userRangeEdit: true });
            this._persistForgeState();
            this._renderCards();
            return;
        }
        this._updateAllDirectModeSliders();
    }

    _syncNormalizeRangeInputs(force) {
        const format = this.normalizeEnabled ? this._formatNormalizeWeight.bind(this) : formatEmphasisWeight;
        const active = document.activeElement;
        if (this._refs.minWeight && (force || active !== this._refs.minWeight)) {
            this._refs.minWeight.value = format(this.minWeight);
        }
        if (this._refs.maxWeight && (force || active !== this._refs.maxWeight)) {
            this._refs.maxWeight.value = format(this.maxWeight);
        }
    }

    _wireRangeWheelControls() {
        const wire = (input) => {
            if (!input) return;
            input.addEventListener('wheel', (e) => {
                if (this.normalizeEnabled && this.autoBandEnabled) return;
                if (e.target !== input) return;
                e.preventDefault();
                e.stopPropagation();
                const step = e.shiftKey ? 0.01 : EMPHASIS_NORMALIZE_RANGE_STEP;
                const delta = e.deltaY > 0 ? -step : step;
                const raw = parseFloat(input.value);
                const base = Number.isFinite(raw) ? raw : (input === this._refs.minWeight ? this.minWeight : this.maxWeight);
                const next = Math.max(1, base + delta);
                input.value = String(parseFloat(next.toFixed(4)));
                this._applyNormalizeRangeInputsLive();
            }, { passive: false });
        };
        wire(this._refs.minWeight);
        wire(this._refs.maxWeight);
    }

    _setDeltaMode(enabled) {
        this.deltaMode = !!enabled;
        if (this.deltaMode) {
            this.distributionMode = false;
        }
        const active = this.getActiveIndices();
        if (active.length) {
            this._preserveSharePrecision(active);
        }
        this._syncModeToggleButtons();
        this._persistForgeState();
        this._renderCards();
    }

    /**
     * Map a share % onto distribution importance.
     * 50 = unbiased (equal share among actives). Below equal → 0…50; above → 50…100.
     */
    _importanceFromShare(share, activeCount) {
        const n = Math.max(1, activeCount || 1);
        const equal = 100 / n;
        if (equal <= 0) return EMPHASIS_IMPORTANCE_UNBIASED;
        const ratio = (Number(share) || 0) / equal;
        if (ratio >= 1) {
            return clampEmphasisShare(
                EMPHASIS_IMPORTANCE_UNBIASED + (ratio - 1) * EMPHASIS_IMPORTANCE_UNBIASED
            );
        }
        return clampEmphasisShare(ratio * EMPHASIS_IMPORTANCE_UNBIASED);
    }

    _setDistributionMode(enabled) {
        const next = !!enabled;
        if (next === this.distributionMode) return;

        if (next) {
            const active = this.getActiveIndices();
            this._distributionStash = {
                shares: this.shares.slice(),
                minWeight: this.minWeight,
                maxWeight: this.maxWeight,
                cardShares: active.map((i) => ({
                    i,
                    share: this.shares[i],
                    importance: this.targets[i]?.cardState?.importance
                }))
            };
            this._distributionApplied = false;
            this.distributionMode = true;
            this.deltaMode = false;
            // Ensure shares exist before converting (band position → importance 50…100)
            const hasShare = active.some((i) => (this.shares[i] ?? this.targets[i]?.cardState?.share ?? 0) > 0);
            if (!hasShare && active.length) {
                this._initSharesFromWeights(active);
            }
            active.forEach((i) => {
                const target = this.targets[i];
                if (!target) return;
                const share = this.shares[i] ?? target.cardState.share ?? 0;
                const importance = this._importanceFromShare(share, active.length);
                target.cardState.importance = importance;
                this.cardStateByKey.set(target.targetKey, target.cardState);
            });
            // Keep current shares/weights until user drags or Apply — do not reshape on enable
        } else {
            if (!this._distributionApplied && this._distributionStash) {
                const stash = this._distributionStash;
                this.minWeight = stash.minWeight;
                this.maxWeight = stash.maxWeight;
                this._syncNormalizeRangeInputs(true);
                stash.cardShares.forEach(({ i, share, importance }) => {
                    const target = this.targets[i];
                    if (!target) return;
                    this.shares[i] = share;
                    target.cardState.share = share;
                    if (Number.isFinite(importance)) {
                        target.cardState.importance = importance;
                    }
                    this.cardStateByKey.set(target.targetKey, target.cardState);
                });
            }
            this._distributionStash = null;
            this.distributionMode = false;
            const active = this.getActiveIndices();
            if (active.length) {
                if (this._distributionApplied) {
                    this._initSharesFromWeights(active);
                }
                this._preserveSharePrecision(active);
            }
            this._distributionApplied = false;
        }

        this._syncModeToggleButtons();
        this._persistForgeState();
        this._updateNormalizeToolbar();
        this._renderCards();
        this._scheduleNotchRefresh();
    }

    _syncModeToggleButtons() {
        if (this._refs.deltaModeBtn) {
            this._refs.deltaModeBtn.setAttribute('data-state', this.deltaMode ? 'on' : 'off');
        }
        if (this._refs.distributionModeBtn) {
            this._refs.distributionModeBtn.setAttribute('data-state', this.distributionMode ? 'on' : 'off');
        }
    }

    _preserveSharePrecision(activeIndices) {
        const active = activeIndices && activeIndices.length ? activeIndices : this.getActiveIndices();
        active.forEach((i) => {
            const target = this.targets[i];
            if (!target) return;
            const share = clampEmphasisShare(this.shares[i] ?? target.cardState.share ?? 0);
            this.shares[i] = share;
            target.cardState.share = share;
            this.cardStateByKey.set(target.targetKey, target.cardState);
        });
    }

    /**
     * Re-encode share sliders from preview weights at the OLD range so mapped weights stay put
     * under the NEW min/max. Used by Auto Band / live autos / delta user-range edits.
     * User share/distribution range edits must NOT call this — they keep thumb %.
     */
    _preserveSharesForRangeChange(oldMin, oldMax) {
        if (!this.normalizeEnabled) return;
        if (oldMin === this.minWeight && oldMax === this.maxWeight) return;
        const active = this.getActiveIndices();
        if (!active.length) return;
        const opts = this._getNormalizeWeightOptions();
        const weighting = this._getWeightingIndices();
        // Decode with OLD range — min/max may already be updated (Auto Band / Pull / range edits)
        const weights = sharesToWeights(
            this.shares,
            oldMin,
            oldMax,
            weighting.length ? weighting : active,
            opts
        );
        active.forEach((i) => {
            const target = this.targets[i];
            if (!target) return;
            let w = weights[i];
            if (target.cardState?.deltaLocked) {
                w = this._targetWeightForNormalize(target);
            } else if (w === undefined) {
                w = this._targetWeightForNormalize(target);
            }
            const share = clampEmphasisShare(weightToShare(w, this.minWeight, this.maxWeight, opts));
            this.shares[i] = share;
            target.cardState.share = share;
            this.cardStateByKey.set(target.targetKey, target.cardState);
        });
        this._preserveSharePrecision(active);
        this._updateParticipantShareUI(active);
    }

    /**
     * After min/max change.
     * @param {number} oldMin
     * @param {number} oldMax
     * @param {{ userRangeEdit?: boolean }} [options]
     *   userRangeEdit — only for manual band edits (nudge / type / wheel):
     *     share & distribution keep thumb positions; delta re-encodes to keep weight thumbs.
     *   default (Auto Band, live autos, …) — re-encode shares to keep mapped weights
     *     (distribution only refreshes UI).
     */
    _afterNormalizeRangeChange(oldMin, oldMax, options = {}) {
        if (!this.normalizeEnabled) return;
        if (oldMin === this.minWeight && oldMax === this.maxWeight) return;
        const active = this.getActiveIndices();
        if (!active.length) return;

        if (options.userRangeEdit) {
            if (this.deltaMode) {
                this._preserveSharesForRangeChange(oldMin, oldMax);
                return;
            }
            this._preserveSharePrecision(active);
            this._updateParticipantShareUI(active);
            return;
        }

        if (this.distributionMode) {
            this._updateParticipantShareUI(active);
            return;
        }
        this._preserveSharesForRangeChange(oldMin, oldMax);
    }

    _initSharesFromWeights(activeIndices, rangeMin, rangeMax) {
        const active = activeIndices && activeIndices.length ? activeIndices : this.getActiveIndices();
        const mapMin = rangeMin !== undefined ? rangeMin : this.minWeight;
        const mapMax = rangeMax !== undefined ? rangeMax : this.maxWeight;
        const opts = this._getNormalizeWeightOptions();
        this.shares = this.targets.map(() => 0);
        active.forEach((i) => {
            const target = this.targets[i];
            if (!target) return;
            const w = target.cardState?.directWeight ?? target.weight;
            if (!isEligibleForEmphasisNormalize(w)) return;
            const share = weightToShare(w, mapMin, mapMax, opts);
            this.shares[i] = share;
            target.cardState.share = share;
            this.cardStateByKey.set(target.targetKey, target.cardState);
        });
        this._preserveSharePrecision(active);
    }

    /**
     * Fill share gaps without wiping already-loaded forge percentages.
     * Needed when percentagesByKey only partially matches (start-key drift / missing managed:id).
     * `indices` must be the cards that did not receive a forge share on load.
     */
    _fillMissingSharesFromWeights(indices, rangeMin, rangeMax) {
        const mapMin = rangeMin !== undefined ? rangeMin : this.minWeight;
        const mapMax = rangeMax !== undefined ? rangeMax : this.maxWeight;
        const opts = this._getNormalizeWeightOptions();
        const filled = [];
        indices.forEach((i) => {
            const target = this.targets[i];
            if (!target) return;
            const w = target.cardState?.directWeight ?? target.weight;
            if (!isEligibleForEmphasisNormalize(w)) return;
            const share = weightToShare(w, mapMin, mapMax, opts);
            this.shares[i] = share;
            target.cardState.share = share;
            this.cardStateByKey.set(target.targetKey, target.cardState);
            filled.push(i);
        });
        if (filled.length) this._preserveSharePrecision(filled);
    }

    _initNormalizeFromDirectMode(activeIndices) {
        const bounds = this._getDirectModeWeightBounds();
        const mapMin = bounds.min;
        const mapMax = bounds.max;
        this.minWeight = Math.max(1, this._clampNormalizeWeight(mapMin));
        this.maxWeight = this._clampNormalizeWeight(mapMax);
        if (this.maxWeight <= this.minWeight) {
            this.maxWeight = this._clampNormalizeWeight(this.minWeight + EMPHASIS_NORMALIZE_RANGE_STEP);
        }
        this._syncNormalizeRangeInputs();
        this._initSharesFromWeights(activeIndices, mapMin, mapMax);
    }

    /**
     * Carry cardState across prompt edits when keys change.
     * Keys are start|type|kind|innerText — typing inside a group or inserting text before
     * it breaks exact/legacy matches and used to mint a fresh state with share 0 → slider `1`.
     */
    _remapKeyedStoresByLegacyTargetKey(prevTargets, freshTargets) {
        if (!prevTargets?.length || !freshTargets?.length) return;

        const usedFresh = new Set();
        const usedPrev = new Set();
        const pairs = [];

        const legacyOf = (t) => buildEmphasisTargetKeyLegacy(t);
        const prevLegacyKey = (t) => {
            const key = t.targetKey || buildEmphasisTargetKey(t);
            const pipeIdx = key.indexOf('|');
            return pipeIdx >= 0 ? key.substring(pipeIdx + 1) : legacyOf(t);
        };

        // 1) Exact content identity (type|kind|innerText)
        prevTargets.forEach((p, pi) => {
            const legacy = prevLegacyKey(p);
            let found = -1;
            for (let fi = 0; fi < freshTargets.length; fi++) {
                if (usedFresh.has(fi)) continue;
                if (legacyOf(freshTargets[fi]) === legacy) {
                    found = fi;
                    break;
                }
            }
            if (found < 0) return;
            pairs.push([pi, found]);
            usedPrev.add(pi);
            usedFresh.add(found);
        });

        // 2) Same remaining count → pair by document order (covers in-place text edits)
        const remPrev = [];
        const remFresh = [];
        prevTargets.forEach((_, pi) => { if (!usedPrev.has(pi)) remPrev.push(pi); });
        freshTargets.forEach((_, fi) => { if (!usedFresh.has(fi)) remFresh.push(fi); });
        if (remPrev.length && remPrev.length === remFresh.length) {
            remPrev.forEach((pi, rank) => {
                pairs.push([pi, remFresh[rank]]);
                usedPrev.add(pi);
                usedFresh.add(remFresh[rank]);
            });
        } else {
            // 3) Same type / brace kind → nearest start (nearby insert/delete)
            remPrev.forEach((pi) => {
                const p = prevTargets[pi];
                let best = -1;
                let bestDist = Infinity;
                remFresh.forEach((fi) => {
                    if (usedFresh.has(fi)) return;
                    const f = freshTargets[fi];
                    if (p.type !== f.type) return;
                    if ((p.braceKind || '') !== (f.braceKind || '')) return;
                    const dist = Math.abs((p.start || 0) - (f.start || 0));
                    if (dist < bestDist) {
                        bestDist = dist;
                        best = fi;
                    }
                });
                if (best < 0) return;
                pairs.push([pi, best]);
                usedPrev.add(pi);
                usedFresh.add(best);
            });
        }

        pairs.forEach(([pi, fi]) => {
            const prev = prevTargets[pi];
            const fresh = freshTargets[fi];
            const oldKey = prev.targetKey || buildEmphasisTargetKey(prev);
            const newKey = buildEmphasisTargetKey(fresh);
            if (oldKey === newKey) return;
            const state = this.cardStateByKey.get(oldKey);
            if (!state) return;
            this.cardStateByKey.set(newKey, state);
            if (oldKey !== newKey) {
                this.cardStateByKey.delete(oldKey);
            }
        });
    }

    _getAutoDistribution(activeIndices, options = {}) {
        const active = activeIndices && activeIndices.length ? activeIndices : this.getActiveIndices();
        // Importance bias only when explicitly applying / syncing shares — never for live
        // display, notches, or suggestions (that was moving peer values with delta off).
        const withImportance = !!(this.distributionMode && options.withImportance);
        const importanceByLocalIndex = [];
        if (withImportance) {
            active.forEach((i) => {
                const bias = this.targets[i]?.cardState?.importance;
                importanceByLocalIndex[i] = Number.isFinite(bias) ? bias : EMPHASIS_IMPORTANCE_UNBIASED;
            });
        }
        const dist = computeEmphasisAutoDistribution(this.targets, active, {
            textarea: this.textarea,
            useCrossPromptPool: true,
            importanceByLocalIndex: withImportance ? importanceByLocalIndex : undefined
        });
        if (!options.skipCacheUpdate) {
            this._lastDistribution = dist;
            this._suggestedByLocalIndex = dist.suggestedOptimalByLocalIndex || [];
            this._absMaxWeight = dist.absMaxWeight || dist.idealMaxWeight || 1;
            this.contextCards = Array.isArray(dist.contextCards) ? dist.contextCards : listLocalUnweightedContextCards(this.textarea);
        }
        return dist;
    }

    _refreshDistributionCache() {
        const weighting = this._getWeightingIndices();
        const active = weighting.length ? weighting : this.getActiveIndices();
        if (!active.length) {
            this.contextCards = listLocalUnweightedContextCards(this.textarea);
            this._scheduleNotchRefresh({ immediate: true });
            return null;
        }
        const dist = this._getAutoDistribution(active);
        this._scheduleNotchRefresh({ immediate: true });
        return dist;
    }

    _scheduleNotchRefresh(options = {}) {
        clearTimeout(this._notchRefreshTimer);
        const run = () => {
            this._notchRefreshTimer = null;
            this._applyNotchesToRenderedCards();
        };
        if (options.immediate) {
            run();
            return;
        }
        // Short defer so layout/slider value settle; keep responsive (not 280ms+)
        this._notchRefreshTimer = setTimeout(run, options.delayMs != null ? options.delayMs : 32);
    }

    /**
     * Resolve a marker (suggested / abs-max) against the slider axis.
     * In-range → vertical notch. Out-of-range → edge arrow (direction of off-axis value).
     * valueAxis: the marker's value in the same units as min/max (weight or share 0–100).
     */
    _resolveRangeMarker(valueAxis, min, max, kind, labelRaw) {
        if (!Number.isFinite(valueAxis) || !(max > min)) return null;
        const label = formatEmphasisWeightNormalize(labelRaw !== undefined ? labelRaw : valueAxis);
        const eps = (max - min) * 0.001;
        if (valueAxis < min - eps) {
            return { kind, mode: 'arrow', side: 'left', value: valueAxis, label };
        }
        if (valueAxis > max + eps) {
            return { kind, mode: 'arrow', side: 'right', value: valueAxis, label };
        }
        return { kind, mode: 'notch', value: valueAxis, label };
    }

    /**
     * Build suggested + abs-max markers. Off-range arrows sit on the track edge;
     * if both markers fall on the same side, suggested wins (abs-max arrow omitted).
     */
    _buildSuggestedAndAbsMaxMarkers(suggestedAxis, absMaxAxis, min, max, options = {}) {
        const suggestedLabel = options.suggestedLabel;
        const absLabel = options.absLabel !== undefined ? options.absLabel : absMaxAxis;
        const skipAbs = options.skipAbs === true;

        const markers = [];
        const sug = Number.isFinite(suggestedAxis)
            ? this._resolveRangeMarker(suggestedAxis, min, max, 'optimal', suggestedLabel)
            : null;
        if (sug) markers.push(sug);

        if (!skipAbs && Number.isFinite(absMaxAxis)) {
            const abs = this._resolveRangeMarker(absMaxAxis, min, max, 'absmax', absLabel);
            if (abs) {
                // Same-side off-range: suggested arrow takes priority
                if (abs.mode === 'arrow' && sug && sug.mode === 'arrow' && sug.side === abs.side) {
                    // skip abs
                } else if (abs.mode === 'notch' && sug && sug.mode === 'notch'
                    && Math.abs(abs.value - sug.value) <= (max - min) * 0.01) {
                    // Coincident with suggested — skip abs
                } else {
                    markers.push(abs);
                }
            }
        }
        return markers;
    }

    _weightToShareAxis(weight, minW, maxW) {
        const range = maxW - minW;
        if (!(range > 0) || !Number.isFinite(weight)) return NaN;
        return ((weight - minW) / range) * 100;
    }

    _applyNotchesToRenderedCards() {
        const grid = this._refs.grid;
        if (!grid) return;
        const absMax = Number.isFinite(this._absMaxWeight)
            ? this._absMaxWeight
            : (typeof EMPHASIS_AUTO_TOP_MAX === 'number' ? EMPHASIS_AUTO_TOP_MAX : 3);
        grid.querySelectorAll('.emphasis-groups-card:not(.emphasis-groups-card-context)').forEach((card) => {
            const index = parseInt(card.dataset.index, 10);
            const target = this.targets[index];
            if (!target) return;
            const host = card.querySelector('.emphasis-groups-card-value-host');
            const slider = card.querySelector('.emphasis-groups-card-slider');
            if (!host || !slider || slider.classList.contains('hidden')) {
                host?.querySelectorAll('.emphasis-groups-slider-notch, .emphasis-groups-slider-notch-arrow').forEach((n) => n.remove());
                return;
            }

            const suggested = this._suggestedByLocalIndex[index];
            if (!Number.isFinite(suggested)) {
                host.querySelectorAll('.emphasis-groups-slider-notch, .emphasis-groups-slider-notch-arrow').forEach((n) => n.remove());
                return;
            }

            const min = parseFloat(slider.min);
            const max = parseFloat(slider.max);
            const range = max - min;
            if (!(range > 0)) return;

            if (this.normalizeEnabled && this.distributionMode && this._isNormalizeParticipant(target)) {
                // Importance axis — always show unbiased (50) tick
                this._renderSliderNotches(host, min, max, [
                    { kind: 'optimal', mode: 'notch', value: EMPHASIS_IMPORTANCE_UNBIASED, label: 'Unbiased' }
                ]);
                return;
            }

            if (this.normalizeEnabled && this._isNormalizeParticipant(target) && !this.deltaMode) {
                // Share slider 0–100: map weights into share axis for marker placement
                const sugShare = this._weightToShareAxis(suggested, this.minWeight, this.maxWeight);
                const absShare = this._weightToShareAxis(absMax, this.minWeight, this.maxWeight);
                const markers = this._buildSuggestedAndAbsMaxMarkers(sugShare, absShare, 0, 100, {
                    suggestedLabel: suggested,
                    absLabel: absMax
                });
                this._renderSliderNotches(host, min, max, markers);
                return;
            }

            // Negative ranges: skip abs-max (safe top weight is not on this axis)
            const skipAbs = max <= 1 && min < 1;
            const markers = this._buildSuggestedAndAbsMaxMarkers(suggested, absMax, min, max, {
                suggestedLabel: suggested,
                absLabel: absMax,
                skipAbs
            });
            this._renderSliderNotches(host, min, max, markers);
        });
        grid.querySelectorAll('.emphasis-groups-card:not(.emphasis-groups-card-context)').forEach((card) => {
            const index = parseInt(card.dataset.index, 10);
            if (Number.isFinite(index)) this._updateSnapSuggestButton(card, index);
        });
        this._syncCompensateHint();
    }

    _renderSliderNotches(host, min, max, markers) {
        // Mount on the thumb-travel layer so left:% matches weight ticks and the thumb
        const track = host.querySelector('.slider-ticks')
            || host.querySelector('.slider-ticks-container')
            || host;
        track.querySelectorAll('.emphasis-groups-slider-notch, .emphasis-groups-slider-notch-arrow').forEach((n) => n.remove());
        // Also clear any leftovers on the outer host from older placement
        if (track !== host) {
            host.querySelectorAll(':scope > .emphasis-groups-slider-notch, :scope > .emphasis-groups-slider-notch-arrow').forEach((n) => n.remove());
        }
        const range = max - min;
        if (!(range > 0) || !markers.length) return;

        markers.forEach((m) => {
            const label = m.label || formatEmphasisWeightNormalize(m.value);
            const title = m.kind === 'optimal' ? `Suggested ${label}` : `Abs max ${label}`;

            if (m.mode === 'arrow') {
                const el = document.createElement('div');
                el.className = [
                    'emphasis-groups-slider-notch-arrow',
                    `emphasis-groups-slider-notch-arrow-${m.kind}`,
                    `emphasis-groups-slider-notch-arrow-${m.side}`
                ].join(' ');
                el.title = title;
                const icon = document.createElement('i');
                icon.className = m.side === 'left' ? 'fas fa-arrow-left' : 'fas fa-arrow-right';
                icon.setAttribute('aria-hidden', 'true');
                el.appendChild(icon);
                track.appendChild(el);
                return;
            }

            const clampedVal = Math.max(min, Math.min(max, m.value));
            const frac = Math.max(0, Math.min(1, (clampedVal - min) / range));
            const el = document.createElement('div');
            el.className = `emphasis-groups-slider-notch emphasis-groups-slider-notch-${m.kind}`;
            el.style.setProperty('--tick-frac', String(frac));
            el.title = title;
            track.appendChild(el);
        });
    }

    _applyAutoDistributionShares(weighting, dist) {
        // Map suggested optimal weights into the current band so sliders sit on the notches
        const opts = this._getNormalizeWeightOptions();
        const relative = Array.isArray(dist.relativeImportances) ? dist.relativeImportances : dist.importances;
        const suggestedByLocal = dist.suggestedOptimalByLocalIndex || [];
        weighting.forEach((i, rank) => {
            const target = this.targets[i];
            if (!target) return;
            const suggested = suggestedByLocal[i];
            let share;
            if (Number.isFinite(suggested)) {
                share = clampEmphasisShare(
                    weightToShare(suggested, this.minWeight, this.maxWeight, opts)
                );
            } else {
                const fromLocal = dist.relativeImportancesByLocalIndex?.[i];
                share = clampEmphasisShare(fromLocal !== undefined ? fromLocal : (relative[rank] ?? 0));
            }
            this.shares[i] = share;
            target.cardState.share = share;
            if (this.distributionMode) {
                target.cardState.importance = this._importanceFromShare(share, weighting.length);
            }
            this.cardStateByKey.set(target.targetKey, target.cardState);
        });
        this._preserveSharePrecision(weighting);
    }

    /**
     * Scale track resolution so the peak unlocked weight sits at ≥ EMPHASIS_AUTO_SHARE_BAND_MIN
     * without changing mapped weights (adjust maxWeight, then re-encode shares).
     */
    _ensureMaxShareBandFloor(activeIndices) {
        if (!this.normalizeEnabled || this.distributionMode) return;
        const active = activeIndices && activeIndices.length ? activeIndices : this.getActiveIndices();
        const weighting = this._getWeightingIndices();
        const indices = weighting.length ? weighting : active;
        if (indices.length < 1) return;

        const opts = this._getNormalizeWeightOptions();
        const floor = typeof EMPHASIS_AUTO_SHARE_BAND_MIN === 'number' ? EMPHASIS_AUTO_SHARE_BAND_MIN : 50;
        const weights = this._getParticipantWeights(active);

        let peakWeight = 0;
        indices.forEach((i) => {
            const w = weights[i];
            if (Number.isFinite(w)) peakWeight = Math.max(peakWeight, w);
        });
        if (!(peakWeight > this.minWeight)) return;

        const peakShare = weightToShare(peakWeight, this.minWeight, this.maxWeight, opts);
        if (peakShare >= floor - 0.0001) return;

        // Place peakWeight at `floor`% of the track: peak = min + (floor/100)*(max-min)
        const nextMax = this._clampNormalizeWeight(
            this.minWeight + ((peakWeight - this.minWeight) * 100) / floor
        );
        if (!(nextMax > this.minWeight) || Math.abs(nextMax - this.maxWeight) < 0.00005) {
            return;
        }

        this.maxWeight = nextMax;
        this._syncNormalizeRangeInputs(true);
        indices.forEach((i) => {
            const target = this.targets[i];
            if (!target || target.cardState?.deltaLocked) return;
            const w = weights[i];
            if (!Number.isFinite(w)) return;
            const share = clampEmphasisShare(weightToShare(w, this.minWeight, this.maxWeight, opts));
            this.shares[i] = share;
            target.cardState.share = share;
            this.cardStateByKey.set(target.targetKey, target.cardState);
        });
        this._preserveSharePrecision(indices);
        this._updateParticipantShareUI(active);
    }

    /** Pull Band Range — peak slider → 100%, maxWeight = held peak weight. Disabled in distribution. */
    _runPullBandRange() {
        if (!this.normalizeEnabled || this.distributionMode) return false;
        const active = this.getActiveIndices();
        const weighting = this._getWeightingIndices();
        const indices = weighting.length ? weighting : active;
        if (!indices.length) return false;

        const opts = this._getNormalizeWeightOptions();
        const weights = this._getParticipantWeights(active);
        let peakWeight = 0;
        indices.forEach((i) => {
            const w = weights[i];
            if (Number.isFinite(w)) peakWeight = Math.max(peakWeight, w);
        });
        if (!(peakWeight > this.minWeight)) return false;

        this.maxWeight = this._clampNormalizeWeight(peakWeight);
        this._syncNormalizeRangeInputs(true);

        indices.forEach((i) => {
            const target = this.targets[i];
            if (!target || target.cardState?.deltaLocked) return;
            const w = weights[i];
            const share = clampEmphasisShare(weightToShare(w, this.minWeight, this.maxWeight, opts));
            this.shares[i] = share;
            target.cardState.share = share;
            this.cardStateByKey.set(target.targetKey, target.cardState);
        });
        this._preserveSharePrecision(indices);
        this._updateParticipantShareUI(active);
        this._persistForgeState();
        this._updateNormalizeToolbar();
        this._renderCards();
        return true;
    }

    _attachAutomaticScalingMenu(button, kind) {
        if (!button || typeof contextMenu === 'undefined' || !contextMenu?.attachToElement) return;
        // contextMenu.attachToElement / detachFromElement: public/scripts/comp/contextMenu.js
        contextMenu.detachFromElement(button);
        const isBand = kind === 'autoBand';
        const items = [
            {
                text: 'Automatic',
                icon: 'fas fa-bolt',
                action: 'toggle',
                showIndicator: true,
                loadfn: (item) => {
                    const on = isBand ? !!this.autoBandEnabled : !!this.attentionRescaleEnabled;
                    item.checked = on;
                }
            }
        ];
        if (!isBand) {
            items.push({
                text: 'Compensate',
                icon: 'fas fa-arrow-right-to-bracket',
                action: 'compensate',
                title: 'Raise groups to their suggested values'
            });
            if (this.distributionMode) {
                items.push({
                    text: 'Rebalance',
                    icon: 'fas fa-blender',
                    action: 'rebalance',
                    title: 'Adjust Bands and Attention'
                });
            }
        }
        contextMenu.attachToElement(button, {
            sections: [
                {
                    type: 'list',
                    items
                }
            ],
            onAction: (action) => {
                if (action === 'toggle') {
                    if (isBand) this._setAutoBandEnabled(!this.autoBandEnabled);
                    else this._setAttentionRescaleEnabled(!this.attentionRescaleEnabled);
                    return;
                }
                if (action === 'compensate') {
                    this._compensateUnderSuggestedValues();
                    return;
                }
                if (action === 'rebalance') {
                    this._promptRebalanceDialog();
                }
            }
        });
    }

    _attachApplyContextMenu(button) {
        if (!button || typeof contextMenu === 'undefined' || !contextMenu?.attachToElement) return;
        // contextMenu.attachToElement / detachFromElement: public/scripts/comp/contextMenu.js
        contextMenu.detachFromElement(button);
        contextMenu.attachToElement(button, {
            sections: [
                {
                    type: 'list',
                    items: [
                        {
                            text: 'Auto Apply on Generate',
                            icon: 'fas fa-play',
                            action: 'toggleAutoApplyOnGenerate',
                            showIndicator: true,
                            title: 'When on, starting generation applies pending Normalize changes to the prompt',
                            loadfn: (item) => {
                                item.checked = !!this.autoApplyOnGenerate;
                            }
                        },
                        {
                            text: 'Load from Prompt',
                            icon: 'fas fa-rotate-left',
                            action: 'loadFromPrompt',
                            title: 'Reset normalize sliders from live prompt weights (discard forge share preview)'
                        },
                        {
                            text: 'Clear Config',
                            icon: 'fas fa-eraser',
                            action: 'clear',
                            title: 'Clear stored normalize data for this prompt'
                        }
                    ]
                }
            ],
            onAction: (action) => {
                if (action === 'toggleAutoApplyOnGenerate') {
                    this._setAutoApplyOnGenerate(!this.autoApplyOnGenerate);
                } else if (action === 'loadFromPrompt' || action === 'revert') {
                    if (!this.normalizeEnabled) return;
                    this._revertNormalizeToPrompt();
                } else if (action === 'clear') {
                    this._clearNormalizeConfig();
                }
            }
        });
    }

    _setAutoApplyOnGenerate(enabled) {
        const next = !!enabled;
        if (this.autoApplyOnGenerate === next) return;
        this.autoApplyOnGenerate = next;
        if (this.normalizeEnabled) {
            this._persistForgeState();
        }
    }

    /** Reset this field to a first-open state: no forge config, normalize off, live prompt weights. */
    _clearNormalizeConfig() {
        const fieldKey = this._getFieldKey();
        writeEmphasisNormalizationFieldState(fieldKey, null);
        this.normalizeEnabled = false;
        this.distributionMode = false;
        this.deltaMode = false;
        this.autoBandEnabled = false;
        this.attentionRescaleEnabled = false;
        this.autoApplyOnGenerate = false;
        this.minWeight = 1;
        this.maxWeight = 2;
        this.shares = [];
        this.preNormalizeWeights = new Map();
        this.preNormalizeWeightsByKey = {};
        this._distributionStash = null;
        this._distributionApplied = false;
        this.cardStateByKey.clear();
        this.reconcileTargetsFromPrompt();
        this._syncNormalizeRangeInputs(true);
        this._syncModeToggleButtons();
        this._syncAutoBandRangeUi();
        this._updateNormalizeToolbar();
        this._renderCards();
        this._scheduleNotchRefresh();
    }

    _setAutoBandEnabled(enabled) {
        if (!this.normalizeEnabled) return;
        const next = !!enabled;
        if (this.autoBandEnabled === next) {
            if (next) this._runAutoBand({ live: true });
            return;
        }
        this.autoBandEnabled = next;
        if (next) {
            this._runAutoBand({ live: true });
        } else {
            this._syncAutoBandRangeUi();
            this._persistForgeState();
            this._updateNormalizeToolbar();
        }
    }

    _setAttentionRescaleEnabled(enabled) {
        if (!this.normalizeEnabled) return;
        const next = !!enabled;
        if (this.attentionRescaleEnabled === next) {
            if (next) this._runAttentionRescale({ live: true });
            return;
        }
        this.attentionRescaleEnabled = next;
        if (next) {
            this._runAttentionRescale({ live: true });
        } else {
            this._persistForgeState();
            this._updateNormalizeToolbar();
        }
    }

    _syncAutoBandRangeUi() {
        const locked = !!(this.normalizeEnabled && this.autoBandEnabled);
        if (this._refs.minWeight) {
            this._refs.minWeight.readOnly = locked;
        }
        if (this._refs.maxWeight) {
            this._refs.maxWeight.readOnly = locked;
        }
        this.element.classList.toggle('emphasis-groups-auto-band-active', locked);
    }

    /** Auto Band only — min→1, max = NAI-safe ideal top from distribution. Does not write prompt. */
    _runAutoBand(options = {}) {
        if (!this.normalizeEnabled && !options.allowDirect) return false;
        const active = this.getActiveIndices();
        if (!active.length) return false;
        const weighting = this._getWeightingIndices();
        const indices = weighting.length ? weighting : active;
        const dist = this._getAutoDistribution(indices);

        const oldMin = this.minWeight;
        const oldMax = this.maxWeight;
        // Capture weights at current range before mutating min/max
        const preservedWeights = this.normalizeEnabled ? this._getParticipantWeights(active) : null;
        this.minWeight = 1;
        // resolveIdealMaxWeightFromDistribution: public/scripts/comp/emphasisWeightMath.js
        let nextMax = Math.max(1, resolveIdealMaxWeightFromDistribution(dist, indices));
        if (preservedWeights) {
            let peak = 0;
            indices.forEach((i) => {
                const w = preservedWeights[i];
                if (Number.isFinite(w)) peak = Math.max(peak, w);
            });
            // Never compress existing weights when snapping to ideal (Pull→AutoBand identity)
            if (peak > nextMax) nextMax = peak;
        }
        this.maxWeight = nextMax;
        this._syncNormalizeRangeInputs(true);
        this._syncAutoBandRangeUi();

        if (this.normalizeEnabled) {
            if (!this.distributionMode && preservedWeights
                && (oldMin !== this.minWeight || oldMax !== this.maxWeight)) {
                // Re-encode from weights captured before the range change (avoids delta 0-sliders)
                this._syncSharesFromWeights(preservedWeights, active);
                active.forEach((i) => {
                    const target = this.targets[i];
                    if (!target?.cardState?.deltaLocked) return;
                    const w = this._targetWeightForNormalize(target);
                    const share = clampEmphasisShare(
                        weightToShare(w, this.minWeight, this.maxWeight, this._getNormalizeWeightOptions())
                    );
                    this.shares[i] = share;
                    target.cardState.share = share;
                    this.cardStateByKey.set(target.targetKey, target.cardState);
                });
                this._preserveSharePrecision(active);
                this._updateParticipantShareUI(active);
            } else {
                this._afterNormalizeRangeChange(oldMin, oldMax);
            }
            if (!this.distributionMode) {
                this._ensureMaxShareBandFloor(active);
            }
            this._persistForgeState();
            this._updateNormalizeToolbar();
            this._renderCards();
        } else {
            this._updateNormalizeToolbar();
            this._renderCards();
        }
        this._scheduleNotchRefresh();
        return true;
    }

    /** Attention Rescale only — rewrite unlocked shares from equalized ranks. Does not write prompt or change band. */
    _runAttentionRescale(options = {}) {
        if (!this.normalizeEnabled) return false;

        const active = this.getActiveIndices();
        if (!active.length) return false;
        const weighting = this._getWeightingIndices();
        if (!weighting.length) return false;

        const dist = this._getAutoDistribution(weighting);
        this._applyAutoDistributionShares(weighting, dist);
        this._updateParticipantShareUI(active);

        this._persistForgeState();
        this._updateNormalizeToolbar();
        this._renderCards();
        this._scheduleNotchRefresh();
        return true;
    }

    /** Normalize OFF — one-shot band + attention rescale into prompt weights. */
    _runCombinedOneShot() {
        if (this.normalizeEnabled) return;
        const indices = this.targets
            .map((t, i) => (isEligibleForEmphasisNormalize(t.weight) ? i : -1))
            .filter((i) => i >= 0);
        if (!indices.length) return;

        const dist = computeEmphasisAutoDistribution(this.targets, indices, {
            textarea: this.textarea,
            useCrossPromptPool: true
        });
        this._lastDistribution = dist;
        this._suggestedByLocalIndex = dist.suggestedOptimalByLocalIndex || [];
        this._absMaxWeight = dist.absMaxWeight || dist.idealMaxWeight || 1;
        // resolveIdealMaxWeightFromDistribution: public/scripts/comp/emphasisWeightMath.js
        const topWeight = Math.max(1, resolveIdealMaxWeightFromDistribution(dist, indices));
        this.minWeight = 1;
        this.maxWeight = topWeight;
        this._syncNormalizeRangeInputs(true);

        // relativeImportances / emphasisWeightFromRelativeImportance: public/scripts/comp/emphasisWeightMath.js
        const relative = Array.isArray(dist.relativeImportances) ? dist.relativeImportances : dist.importances;
        const weightByStart = new Map();
        indices.forEach((i, idx) => {
            const fromLocal = dist.relativeImportancesByLocalIndex?.[i];
            const rel = fromLocal !== undefined ? fromLocal : (relative[idx] ?? 0);
            let weight = emphasisWeightFromRelativeImportance(rel, topWeight);
            const target = this.targets[i];
            if (target && target.type === 'brace') {
                weight = snapWeightForBraceMode(weight);
            }
            if (target) {
                weightByStart.set(target.start, clampEmphasisWeightNormalize(weight));
            }
        });

        this._applyWeights(weightByStart);
        this.reconcileTargetsFromPrompt({ syncFromPrompt: true });
        this.contextCards = listLocalUnweightedContextCards(this.textarea);
        this._updateNormalizeToolbar();
        this._renderCards();
        this._scheduleNotchRefresh();
    }

    /**
     * Enabled Auto Band / Auto Normalize — range and/or shares only.
     * Called on blur of the bound textarea (not every keystroke). Never writes prompt.
     */
    _maybeRunLiveAutos() {
        if (!this.normalizeEnabled) return false;
        if (!this.autoBandEnabled && !this.attentionRescaleEnabled) return false;
        if (this.isApplyingFromTool || this.isDraggingSlider) return false;

        if (this.autoBandEnabled && this.attentionRescaleEnabled) {
            const active = this.getActiveIndices();
            const weighting = this._getWeightingIndices();
            if (!weighting.length) return false;
            const oldMin = this.minWeight;
            const oldMax = this.maxWeight;
            const preservedWeights = this._getParticipantWeights(active);
            const dist = this._getAutoDistribution(weighting);
            this.minWeight = 1;
            let nextMax = Math.max(1, resolveIdealMaxWeightFromDistribution(dist, weighting));
            let peak = 0;
            weighting.forEach((i) => {
                const w = preservedWeights[i];
                if (Number.isFinite(w)) peak = Math.max(peak, w);
            });
            if (peak > nextMax) nextMax = peak;
            this.maxWeight = nextMax;
            this._syncNormalizeRangeInputs(true);
            this._syncAutoBandRangeUi();
            this._afterNormalizeRangeChange(oldMin, oldMax);
            this._applyAutoDistributionShares(weighting, dist);
            this._updateParticipantShareUI(active);
            this._persistForgeState();
            this._updateNormalizeToolbar();
            if (!this._shouldDeferCardRender()) {
                this._renderCards();
            }
            this._scheduleNotchRefresh();
            return true;
        }

        if (this.autoBandEnabled) {
            this._runAutoBand({ live: true });
        }
        if (this.attentionRescaleEnabled) {
            this._runAttentionRescale({ live: true });
        }
        return true;
    }

    _buildRebalanceDialogHtml(idealMax, normalizeMode) {
        const explain = normalizeMode
            ? `<p>Rebalancing ranks unlocked groups so short concept anchors keep attention against longer phrases, then maps those ranks into weights between 1 and the top weight below.</p>
            <p class="text-secondary" style="font-size:0.85rem;margin-top:0.5rem;">Raw token share would double-boost long groups (they already claim more of the conditioning budget). Auto uses soft length compensation with a minimum share floor. Top weight stays in a NovelAI-safe band (~2–3) so concepts stay distinct without overcooking.</p>`
            : `<p>Rebalancing assigns each group a weight between 1 and the top weight below so short concepts are not starved by longer phrases.</p>
            <p class="text-secondary" style="font-size:0.85rem;margin-top:0.5rem;">Ranks are attention-equalized (soft inverse of √token length with a floor), not raw token %. Recommended top weights stay in the NovelAI-safe ~2–3 band.</p>`;
        return `${explain}
            <div class="emphasis-groups-rebalance-weight-row form-row" style="margin-top:0.75rem;align-items:center;gap:0.35rem;">
                <label for="emphasisRebalanceMaxWeight" style="flex:0 0 auto;font-size:0.85rem;">Top weight</label>
                <div class="button-group" style="flex:0 0 auto;">
                    <button type="button" id="emphasisRebalanceMaxDown" class="btn-secondary toolbar-input-segment icon-only emphasis-groups-range-step" title="Decrease top weight">
                        <i class="fas fa-minus"></i>
                    </button>
                    <input type="text" id="emphasisRebalanceMaxWeight" class="form-control colored toolbar-input-segment emphasis-groups-weight-input"
                        inputmode="decimal" autocomplete="off" spellcheck="false" value="${formatEmphasisWeightNormalize(idealMax)}" title="Top weight in range (minimum 1)">
                    <button type="button" id="emphasisRebalanceMaxUp" class="btn-secondary toolbar-input-segment icon-only emphasis-groups-range-step" title="Increase top weight">
                        <i class="fas fa-plus"></i>
                    </button>
                </div>
            </div>`;
    }

    async _promptRebalanceDialog() {
        if (!this.normalizeEnabled) {
            await this._promptNormalModeRebalanceDialog();
            return;
        }

        const active = this.getActiveIndices();
        if (!active.length) return;

        const weighting = this._getWeightingIndices();
        if (!weighting.length) return;

        // Attention-equalized ranks among unlocked groups only (locked cards keep their shares)
        const dist = this._getAutoDistribution(weighting);
        // resolveIdealMaxWeightFromDistribution: public/scripts/comp/emphasisWeightMath.js
        const idealMax = Math.max(1, resolveIdealMaxWeightFromDistribution(dist, weighting));
        const dialogHtml = this._buildRebalanceDialogHtml(idealMax, true);

        // showConfirmationDialog: public/scripts/comp/confirmationDialog.js
        const dialogPromise = showConfirmationDialog(dialogHtml, [
            { text: 'Rebalance', value: 'confirm', className: 'btn-primary', icon: 'fas fa-blender' },
            { text: 'Cancel', value: null, className: 'btn-secondary' }
        ], null, { title: 'Rebalance Weights', icon: 'fas fa-blender' });
        setTimeout(() => this._wireRebalanceDialogControls(idealMax), 0);
        const result = await dialogPromise;

        if (result !== 'confirm') return;

        const topWeight = this._readRebalanceDialogTopWeight(idealMax);
        this.minWeight = 1;
        this.maxWeight = topWeight;
        this._syncNormalizeRangeInputs(true);

        this._applyAutoDistributionShares(weighting, dist);
        this._updateParticipantShareUI(active);
        this._persistForgeState();
        this._renderCards();
    }

    async _promptNormalModeRebalanceDialog() {
        const indices = this.targets
            .map((t, i) => (isEligibleForEmphasisNormalize(t.weight) ? i : -1))
            .filter((i) => i >= 0);
        if (!indices.length) return;

        const dist = computeEmphasisAutoDistribution(this.targets, indices, { textarea: this.textarea });
        // resolveIdealMaxWeightFromDistribution: public/scripts/comp/emphasisWeightMath.js
        const idealMax = Math.max(1, resolveIdealMaxWeightFromDistribution(dist, indices));
        const dialogHtml = this._buildRebalanceDialogHtml(idealMax, false);

        const dialogPromise = showConfirmationDialog(dialogHtml, [
            { text: 'Rebalance', value: 'confirm', className: 'btn-primary', icon: 'fas fa-blender' },
            { text: 'Cancel', value: null, className: 'btn-secondary' }
        ], null, { title: 'Rebalance Weights', icon: 'fas fa-blender' });
        setTimeout(() => this._wireRebalanceDialogControls(idealMax), 0);
        const result = await dialogPromise;

        if (result !== 'confirm') return;

        const topWeight = this._readRebalanceDialogTopWeight(idealMax);
        // relativeImportances / emphasisWeightFromRelativeImportance: public/scripts/comp/emphasisWeightMath.js
        const relative = Array.isArray(dist.relativeImportances) ? dist.relativeImportances : dist.importances;
        const weightByStart = new Map();
        indices.forEach((i, idx) => {
            let weight = emphasisWeightFromRelativeImportance(relative[idx] ?? 0, topWeight);
            const target = this.targets[i];
            if (target && target.type === 'brace') {
                weight = snapWeightForBraceMode(weight);
            }
            if (target) {
                weightByStart.set(target.start, clampEmphasisWeightNormalize(weight));
            }
        });

        this._applyWeights(weightByStart);
        this.reconcileTargetsFromPrompt({ syncFromPrompt: true });
        this._renderCards();
    }

    _readRebalanceDialogTopWeight(fallback) {
        const input = document.getElementById('emphasisRebalanceMaxWeight');
        let topWeight = fallback;
        if (input) {
            const parsed = parseFloat(input.value);
            if (Number.isFinite(parsed)) {
                topWeight = Math.max(1, this._clampNormalizeWeight(parsed));
            }
        }
        return topWeight;
    }

    _wireRebalanceDialogControls(initialMax) {
        const input = document.getElementById('emphasisRebalanceMaxWeight');
        const down = document.getElementById('emphasisRebalanceMaxDown');
        const up = document.getElementById('emphasisRebalanceMaxUp');
        if (!input) return;

        let value = Math.max(1, initialMax);
        const sync = () => {
            input.value = formatEmphasisWeightNormalize(value);
        };
        sync();

        const nudge = (delta) => {
            value = Math.max(1, this._clampNormalizeWeight(value + delta));
            sync();
        };

        if (down) down.addEventListener('click', () => nudge(-EMPHASIS_NORMALIZE_RANGE_STEP));
        if (up) up.addEventListener('click', () => nudge(EMPHASIS_NORMALIZE_RANGE_STEP));
        input.addEventListener('wheel', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const step = e.shiftKey ? 0.01 : EMPHASIS_NORMALIZE_RANGE_STEP;
            nudge(e.deltaY > 0 ? -step : step);
        }, { passive: false });
    }

    _getDirectModeWeightBounds(target) {
        const tw = target ? (target.cardState?.directWeight ?? target.weight) : NaN;
        // Negative emphasis range: [-maxWeight, 1], full-height green tick at 0.
        // Auto: weight < 1 → negative range; weight > 1 → positive; weight === 1 gray
        // (follow signMode). Never normalised.
        let isNegative = false;
        if (target) {
            if (tw !== '---' && Number.isFinite(tw) && tw < 1) {
                isNegative = true;
            } else if (tw !== '---' && Number.isFinite(tw) && tw > 1) {
                isNegative = false;
            } else {
                isNegative = target.cardState?.signMode === 'negative';
            }
        }
        if (isNegative) {
            return { min: -Math.max(this.maxWeight, 4), max: 1 };
        }

        const weights = this.targets
            .map((t) => t.cardState?.directWeight ?? t.weight)
            .filter((w) => w !== '---' && Number.isFinite(w) && w >= 1.0);
        const currentMin = this.normalizeEnabled ? 1 : this.minWeight;
        if (!weights.length) {
            const max = Math.max(this.maxWeight, 2);
            return { min: currentMin, max };
        }
        const lowest = Math.min(...weights);
        const highest = Math.max(...weights);
        let min = Math.min(currentMin, clampEmphasisWeight(lowest));
        let max = Math.max(this.maxWeight, clampEmphasisWeight(highest));
        if (max <= min) {
            max = clampEmphasisWeight(min + EMPHASIS_NORMALIZE_RANGE_STEP);
        }
        return { min, max };
    }

    _clampDirectModeWeight(weight, targetOrBounds) {
        let w = clampEmphasisWeight(weight);
        const b = targetOrBounds && (targetOrBounds.min !== undefined && targetOrBounds.max !== undefined)
            ? targetOrBounds
            : this._getDirectModeWeightBounds(targetOrBounds);
        w = Math.max(b.min, Math.min(b.max, w));
        return w;
    }

    _syncDirectModeMaxFromTargets() {
        const weights = this.targets
            .map((t) => t.cardState?.directWeight ?? t.weight)
            .filter((w) => w !== '---' && Number.isFinite(w));
        if (!weights.length) return;
        const highest = Math.max(...weights);
        if (highest > this.maxWeight) {
            this.maxWeight = clampEmphasisWeight(highest);
            this._syncNormalizeRangeInputs();
        }
    }

    _scheduleDirectModeApply() {
        clearTimeout(this._directModeApplyTimer);
        this._directModeApplyTimer = setTimeout(() => {
            this._directModeApplyTimer = null;
            this._flushDirectModeApply();
        }, EMPHASIS_DIRECT_MODE_APPLY_DELAY);
    }

    _flushDirectModeApply() {
        clearTimeout(this._directModeApplyTimer);
        this._directModeApplyTimer = null;
        if (this._isReadOnly()) return;

        const weightByStart = new Map();
        this.targets.forEach((target) => {
            const w = target.cardState?.directWeight;
            if (w === '---' || !Number.isFinite(w)) return;
            // In normalize mode, only flush non-eligible (negative/direct) targets.
            // Positive eligible targets are managed by the normalize system.
            if (this.normalizeEnabled && this._isEligibleForNormalizeTarget(target)) return;
            weightByStart.set(target.start, w);
        });
        if (!weightByStart.size) return;

        this._applyWeights(weightByStart, { directModeCommit: true });
        if (!this.normalizeEnabled && !this.isDraggingSlider) {
            this._syncDirectModeMaxFromTargets();
            this._updateAllDirectModeSliders();
        }
    }


    _cardWeightEl(index, weightEl) {
        if (weightEl && weightEl.isConnected) return weightEl;
        const card = this._refs.grid?.querySelector(`.emphasis-groups-card[data-index="${index}"]`);
        return card?.querySelector('.emphasis-groups-card-weight') || null;
    }

    _previewDirectModeWeight(index, weight, weightEl) {
        const target = this.targets[index];
        if (!target) return;
        let w = this._clampDirectModeWeight(weight, target);
        if (target.type === 'brace') {
            w = snapWeightForBraceMode(w);
            w = this._clampDirectModeWeight(w, target);
        }
        target.cardState.directWeight = w;
        const inferred = inferEmphasisWeightBand(w, target.cardState.signMode);
        target.cardState.signMode = inferred.signMode;
        target.cardState.weightBand = inferred.band;
        this.cardStateByKey.set(target.targetKey, target.cardState);
        // Live UI only while dragging — do not write the prompt mid-drag (avoids
        // 3s-timeout races that syncFromPrompt and revert the thumb).
        const el = this._cardWeightEl(index, weightEl);
        if (el) this._setCardWeightDisplay(el, w);
        const card = this._refs.grid?.querySelector(`.emphasis-groups-card[data-index="${index}"]`);
        const signBtn = card?.querySelector('.emphasis-groups-card-sign');
        if (signBtn) updateCardSignBtn(signBtn, target.cardState.signMode);
    }

    _commitDirectModeWeight(index, weight, weightEl, options = {}) {
        const target = this.targets[index];
        if (!target) return;
        let w = this._clampDirectModeWeight(weight, target);
        if (target.type === 'brace') {
            w = snapWeightForBraceMode(w);
            w = this._clampDirectModeWeight(w, target);
        }
        target.cardState.directWeight = w;
        const inferred = inferEmphasisWeightBand(w, target.cardState.signMode);
        target.cardState.signMode = inferred.signMode;
        target.cardState.weightBand = inferred.band;
        target.cardState.manualEditOpen = false;
        this.cardStateByKey.set(target.targetKey, target.cardState);
        this._syncDirectModeMaxFromTargets();
        if (options.rerender !== false) {
            this._updateAllDirectModeSliders();
        } else {
            const el = this._cardWeightEl(index, weightEl);
            if (el) this._setCardWeightDisplay(el, w);
            const card = el?.closest('.emphasis-groups-card')
                || this._refs.grid?.querySelector(`.emphasis-groups-card[data-index="${index}"]`);
            const slider = card?.querySelector('.emphasis-groups-card-slider');
            if (slider) {
                const bounds = this._getDirectModeWeightBounds(target);
                slider.min = String(bounds.min);
                slider.max = String(bounds.max);
                slider.value = String(w);
            }
        }
        // Keep ± button in sync when auto-switching sign at 1 boundary
        const card = this._refs.grid?.querySelector(`.emphasis-groups-card[data-index="${index}"]`);
        const signBtn = card?.querySelector('.emphasis-groups-card-sign');
        if (signBtn) updateCardSignBtn(signBtn, target.cardState.signMode);
        if (options.flushImmediate) {
            this._flushDirectModeApply();
        } else {
            this._scheduleDirectModeApply();
        }
    }

    _updateAllDirectModeSliders() {
        if (this.normalizeEnabled) return;
        const grid = this._refs.grid;
        if (!grid) return;

        this.targets.forEach((target, i) => {
            const card = grid.querySelector(`.emphasis-groups-card[data-index="${i}"]`);
            if (!card) return;
            const slider = card.querySelector('.emphasis-groups-card-slider');
            const weightEl = card.querySelector('.emphasis-groups-card-weight');
            const signBtn = card.querySelector('.emphasis-groups-card-sign');
            const w = target.cardState?.directWeight ?? target.weight;
            if (Number.isFinite(w)) {
                const inferred = inferEmphasisWeightBand(w, target.cardState?.signMode);
                target.cardState.signMode = inferred.signMode;
                target.cardState.weightBand = inferred.band;
                this.cardStateByKey.set(target.targetKey, target.cardState);
            }
            const bounds = this._getDirectModeWeightBounds(target);
            if (slider) {
                slider.min = String(bounds.min);
                slider.max = String(bounds.max);
                slider.step = String(EMPHASIS_WEIGHT_FINE_STEP);
                if (Number.isFinite(w)) {
                    slider.value = String(Math.max(bounds.min, Math.min(bounds.max, w)));
                }
            }
            if (weightEl && Number.isFinite(w)) {
                this._setCardWeightDisplay(weightEl, w);
            }
            if (signBtn && target.cardState?.signMode) {
                updateCardSignBtn(signBtn, target.cardState.signMode);
            }
        });
    }

    _isNormalizeParticipant(target) {
        if (!this.normalizeEnabled) return false;
        if (!this._isEligibleForNormalizeTarget(target)) return false;
        return true;
    }

    _usesNormalizeCardChrome(target) {
        return this.normalizeEnabled && this._isEligibleForNormalizeTarget(target);
    }

    _getNormalizeWeightOptions() {
        return { normalizePrecision: true, directRangeMapping: true, targets: this.targets };
    }

    _clampNormalizeWeight(value) {
        return clampEmphasisWeightNormalize(value);
    }

    _formatNormalizeWeight(value) {
        return formatEmphasisWeightNormalize(value);
    }

    _getParticipantWeights(activeIndices) {
        const active = activeIndices && activeIndices.length ? activeIndices : this.getActiveIndices();
        const weighting = active.filter((i) => !this.targets[i]?.cardState?.deltaLocked);
        const fromShares = sharesToWeights(
            this.shares,
            this.minWeight,
            this.maxWeight,
            weighting.length ? weighting : active,
            this._getNormalizeWeightOptions()
        );
        const weights = [];
        active.forEach((i) => {
            if (this.targets[i]?.cardState?.deltaLocked) {
                weights[i] = this._targetWeightForNormalize(this.targets[i]);
            } else if (fromShares[i] !== undefined) {
                weights[i] = fromShares[i];
            } else {
                weights[i] = this._targetWeightForNormalize(this.targets[i]);
            }
        });
        return weights;
    }

    _syncSharesFromWeights(weights, activeIndices) {
        const active = activeIndices && activeIndices.length ? activeIndices : this.getActiveIndices();
        active.forEach((i) => {
            const target = this.targets[i];
            if (!target) return;
            if (target.cardState.deltaLocked) return;
            const share = weightToShare(weights[i], this.minWeight, this.maxWeight, this._getNormalizeWeightOptions());
            const clamped = clampEmphasisShare(share);
            this.shares[i] = clamped;
            target.cardState.share = clamped;
            this.cardStateByKey.set(target.targetKey, target.cardState);
        });
    }

    _getDeltaSectionLengths(activeIndices) {
        const active = activeIndices && activeIndices.length ? activeIndices : this.getActiveIndices();
        const lengths = [];
        active.forEach((i) => {
            const target = this.targets[i];
            // getEmphasisSectionLength: public/scripts/comp/emphasisParse.js
            lengths[i] = getEmphasisSectionLength(target?.innerText);
        });
        return lengths;
    }

    _applyParticipantWeightChange(index, value, weightEl) {
        const active = this.getActiveIndices();
        const adjustable = this._getDeltaAdjustableIndices();
        let clampedWeight = this._clampNormalizeWeight(value);

        if (this.targets[index]?.cardState?.deltaLocked) {
            return;
        }

        // Delta floor: while dragging, do not drop below suggested-at-pointer-down
        if (this.isDraggingSlider && this._deltaDragFloorByIndex && this._deltaDragFloorByIndex.has(index)) {
            const floor = this._deltaDragFloorByIndex.get(index);
            if (Number.isFinite(floor)) {
                clampedWeight = Math.max(floor, clampedWeight);
            }
        }

        const currentWeights = this._getParticipantWeights(active);
        let newWeights;
        // Peer redistribution is delta-mode only — never move others when delta is off
        if (this.deltaMode && adjustable.length > 1 && adjustable.includes(index)) {
            const locked = this._getDeltaLockedIndices();
            const sectionLengths = this._getDeltaSectionLengths(active);
            // rebalanceEmphasisWeightsByDelta: public/scripts/comp/emphasisParse.js
            newWeights = rebalanceEmphasisWeightsByDelta(currentWeights, index, clampedWeight, active, locked, sectionLengths);
        } else {
            newWeights = currentWeights.slice();
            newWeights[index] = clampedWeight;
        }

        this._syncSharesFromWeights(newWeights, active);
        if (this.isDraggingSlider) {
            this._updateParticipantShareUI(active, { onlyIndex: index });
            this._scheduleNotchRefresh({ immediate: true });
            return;
        }
        // Delta off: only this card changed — skip rewriting peer sliders
        if (!this.deltaMode) {
            this._updateParticipantShareUI(active, { onlyIndex: index });
            this._persistForgeState();
            this._scheduleNotchRefresh({ immediate: true });
            return;
        }
        this._updateParticipantShareUI(active);
        this._persistForgeState();
        this._scheduleNotchRefresh({ immediate: true });
    }

    _getDeltaAdjustableIndices() {
        return this.getActiveIndices().filter((i) => !this.targets[i]?.cardState?.deltaLocked);
    }

    _getWeightingIndices() {
        return this.getActiveIndices().filter((i) => !this.targets[i]?.cardState?.deltaLocked);
    }

    _getDeltaLockedIndices() {
        return this.getActiveIndices().filter((i) => !!this.targets[i]?.cardState?.deltaLocked);
    }

    _isNegativeEmphasisWeight(weight, signMode) {
        if (Number.isFinite(weight) && weight < 1) return true;
        if (Number.isFinite(weight) && weight > 1) return false;
        return signMode === 'negative';
    }

    _captureDeltaDragFloor(index) {
        // Distribution: importance floor at unbiased (50) only.
        // Do NOT floor share/weight sliders to suggested — that freezes the display and
        // snaps the thumb back after drag (looks like values never update / revert).
        this._deltaDragFloorByIndex = new Map();
        if (this.distributionMode) {
            this._deltaDragFloorByIndex.set(index, EMPHASIS_IMPORTANCE_UNBIASED);
        }
    }

    _clearDeltaDragFloor() {
        this._deltaDragFloorByIndex = null;
        // Refresh attention suggestions/notches without importance bias (peers stay put)
        this._refreshDistributionCache();
    }

    _setCardWeightDisplay(el, weight, share) {
        if (!el) return;
        const displayWeight = weight === undefined ? '---' : weight;
        const text = (share !== undefined && share !== null)
            ? formatEmphasisNormalizeDisplay(share, displayWeight)
            : formatEmphasisWeightDisplay(displayWeight);
        if (el.tagName === 'INPUT') {
            el.value = text;
        } else {
            el.textContent = text;
        }
        // getEmphasisHighlightStyle: public/scripts/comp/emphasisHighlight.js
        const style = getEmphasisHighlightStyle(displayWeight);
        //el.style.color = style.color;
        el.style.background = style.background;
        el.style.borderColor = style.borderColor;
    }

    _applyParticipantShareChange(index, value, weightEl) {
        const active = this.getActiveIndices();
        let clampedShare = clampEmphasisShare(value);

        if (this.distributionMode) {
            // Importance bias: 50 = unbiased floor only while dragging
            if (this.isDraggingSlider) {
                clampedShare = Math.max(EMPHASIS_IMPORTANCE_UNBIASED, clampedShare);
            }
            const target = this.targets[index];
            if (target) {
                target.cardState.importance = clampedShare;
                this.cardStateByKey.set(target.targetKey, target.cardState);
            }
            if (this.isDraggingSlider) {
                // Only this card — never renorm peers / rewrite peer thumbs while editing
                this._updateParticipantShareUI(active, { onlyIndex: index, skipDistributionSync: true });
                this._scheduleNotchRefresh({ immediate: true });
                return;
            }
            // Importance is assigned per card; peer shares/weights stay until Apply
            this._updateParticipantShareUI(active, { onlyIndex: index });
            this._persistForgeState();
            this._scheduleNotchRefresh({ immediate: true });
            return;
        }

        if (this.targets[index]?.cardState?.deltaLocked) {
            return;
        }

        // Delta OFF: assigned share is independent — never redistribute peers
        if (!this.deltaMode) {
            const target = this.targets[index];
            this.shares[index] = clampedShare;
            if (target) {
                target.cardState.share = clampedShare;
                this.cardStateByKey.set(target.targetKey, target.cardState);
            }
            this._updateParticipantShareUI(active, { onlyIndex: index });
            if (!this.isDraggingSlider) {
                this._persistForgeState();
            }
            this._scheduleNotchRefresh({ immediate: true });
            return;
        }

        // Delta ON: redistribute unlocked peers around locks
        let newShares;
        const locked = this._getDeltaLockedIndices();
        if (locked.length) {
            // rebalanceEmphasisSharesByDelta: public/scripts/comp/emphasisParse.js
            newShares = rebalanceEmphasisSharesByDelta(
                this.shares, index, clampedShare, active, locked
            );
        } else {
            // rebalanceEmphasisShares: public/scripts/comp/emphasisParse.js
            newShares = rebalanceEmphasisShares(this.shares, index, clampedShare, active);
        }

        this.shares = newShares;
        active.forEach((i) => {
            const target = this.targets[i];
            if (!target) return;
            target.cardState.share = newShares[i];
            this.cardStateByKey.set(target.targetKey, target.cardState);
        });

        if (this.isDraggingSlider) {
            this._updateParticipantShareUI(active, { onlyIndex: index });
            this._scheduleNotchRefresh({ immediate: true });
            return;
        }
        this._updateParticipantShareUI(active);
        this._persistForgeState();
        this._scheduleNotchRefresh({ immediate: true });
    }

    _updateParticipantShareUI(activeIndices, options = {}) {
        const active = activeIndices && activeIndices.length ? activeIndices : this.getActiveIndices();
        const onlyIndex = options.onlyIndex;
        const indices = (onlyIndex != null && Number.isFinite(onlyIndex))
            ? [onlyIndex]
            : active;

        let weights = null;
        if (!(this.distributionMode && options.skipDistributionSync && onlyIndex != null)) {
            weights = this._getNormalizeDisplayWeights();
        }

        const grid = this._refs.grid;
        if (!grid) return;

        indices.forEach((i) => {
            this._syncCardNormalizeParticipation(i, {
                weights,
                share: this.shares[i],
                // Never write range values mid-drag — thumb is user-driven; writing .value can
                // fire change/lostcapture, clear isDraggingSlider, and start live peer updates.
                skipSliderWrite: !!this.isDraggingSlider,
                dragLocalOnly: this.isDraggingSlider && onlyIndex === i
            });
        });
    }

    _syncCardNormalizeParticipation(index, options = {}) {
        const grid = this._refs.grid;
        const target = this.targets[index];
        if (!grid || !target) return;

        const card = grid.querySelector(`.emphasis-groups-card[data-index="${index}"]`);
        if (!card) return;

        const isParticipant = this._isNormalizeParticipant(target);
        const usesNormalizeChrome = this._usesNormalizeCardChrome(target);
        const readOnly = this._isReadOnly();

        card.classList.toggle('emphasis-groups-card-normalize-participant', usesNormalizeChrome);

        const weightEl = card.querySelector('.emphasis-groups-card-weight');
        const weightInput = card.querySelector('.emphasis-groups-card-weight-input');
        const slider = card.querySelector('.emphasis-groups-card-slider');

        if (usesNormalizeChrome) {
            const dragLocalOnly = !!options.dragLocalOnly;
            let weights = options.weights;
            if (!weights) {
                if (dragLocalOnly && this.distributionMode) {
                    const weighting = this._getWeightingIndices();
                    const dist = this._getAutoDistribution(weighting, { withImportance: true, skipCacheUpdate: true });
                    const rel = dist.relativeImportancesByLocalIndex?.[index] ?? 0;
                    weights = [];
                    weights[index] = sharesToWeights([rel], this.minWeight, this.maxWeight, [0], this._getNormalizeWeightOptions())[0];
                } else {
                    weights = this._getNormalizeDisplayWeights();
                }
            }
            const share = options.share !== undefined
                ? options.share
                : (this.shares[index] ?? target.cardState.share ?? 0);
            const displayWeight = target.cardState.deltaLocked
                ? this._targetWeightForNormalize(target)
                : (isParticipant && weights && weights[index] !== undefined)
                    ? weights[index]
                    : this._targetWeightForNormalize(target);
            const sliderLocked = readOnly || !isParticipant || !!target.cardState.deltaLocked;
            if (slider) {
                slider.classList.remove('hidden');
                slider.disabled = sliderLocked;
                if (!options.skipSliderWrite) {
                    if (this.deltaMode) {
                        const w = isParticipant && weights && weights[index] !== undefined ? weights[index] : displayWeight;
                        slider.min = String(this.minWeight);
                        slider.max = String(this.maxWeight);
                        slider.step = String(EMPHASIS_NORMALIZE_WEIGHT_STEP);
                        slider.value = String(this._clampNormalizeWeight(w));
                    } else if (this.distributionMode) {
                        const importance = Number.isFinite(target.cardState.importance)
                            ? target.cardState.importance
                            : EMPHASIS_IMPORTANCE_UNBIASED;
                        slider.min = '0';
                        slider.max = '100';
                        slider.step = '0.1';
                        slider.value = String(parseFloat(formatEmphasisShareDisplay(importance)));
                    } else {
                        slider.min = '0';
                        slider.max = '100';
                        slider.step = '0.1';
                        slider.value = String(parseFloat(formatEmphasisShareDisplay(share)));
                    }
                }
            }
            if (weightEl) {
                weightEl.classList.toggle('emphasis-groups-card-weight-wheelable', isParticipant && !readOnly);
                if (displayWeight !== undefined) {
                    const displayShare = this.distributionMode
                        ? (Number.isFinite(target.cardState.importance) ? target.cardState.importance : EMPHASIS_IMPORTANCE_UNBIASED)
                        : share;
                    this._setCardWeightDisplay(weightEl, displayWeight, displayShare);
                }
            }
            if (weightInput) {
                weightInput.classList.add('hidden');
            }
            if (weightEl) {
                weightEl.classList.remove('hidden');
            }
            if (!dragLocalOnly) {
                this._updateSnapSuggestButton(card, index);
            }
        } else {
            this._updateSnapSuggestButton(card, index);
        }
    }

    /**
     * Shared axis for suggestion notches / snap / compensate.
     * @returns {{ min: number, max: number, current: number, suggested: number, curPct: number, sugPct: number }|null}
     */
    _getSuggestionAxisState(index) {
        const target = this.targets[index];
        if (!target || this._isReadOnly()) return null;
        if (this.normalizeEnabled) {
            if (!this._isNormalizeParticipant(target)) return null;
            if (target.cardState?.deltaLocked) return null;
        }

        let min;
        let max;
        let current;
        let suggested;

        if (this.normalizeEnabled && this.distributionMode) {
            min = 0;
            max = 100;
            current = Number.isFinite(target.cardState.importance)
                ? target.cardState.importance
                : EMPHASIS_IMPORTANCE_UNBIASED;
            suggested = EMPHASIS_IMPORTANCE_UNBIASED;
        } else if (this.normalizeEnabled && this.deltaMode) {
            min = this.minWeight;
            max = this.maxWeight;
            const weights = this._getNormalizeDisplayWeights();
            current = weights[index] !== undefined
                ? weights[index]
                : this._targetWeightForNormalize(target);
            suggested = this._suggestedByLocalIndex[index];
        } else if (this.normalizeEnabled) {
            min = 0;
            max = 100;
            current = this.shares[index] ?? target.cardState.share ?? 0;
            const sugW = this._suggestedByLocalIndex[index];
            if (!Number.isFinite(sugW)) return null;
            suggested = weightToShare(
                sugW,
                this.minWeight,
                this.maxWeight,
                this._getNormalizeWeightOptions()
            );
        } else {
            const bounds = this._getDirectModeWeightBounds(target);
            min = bounds.min;
            max = bounds.max;
            current = target.cardState.directWeight;
            suggested = this._suggestedByLocalIndex[index];
            if (!Number.isFinite(current) || current === '---') return null;
        }

        if (!Number.isFinite(suggested) || !Number.isFinite(current)) return null;
        const range = max - min;
        if (!(range > 0)) return null;
        const curPct = ((current - min) / range) * 100;
        const sugPct = ((suggested - min) / range) * 100;
        return { min, max, current, suggested, curPct, sugPct };
    }

    /**
     * Suggestion snap affordance: show when current is ≥5% of track under suggested,
     * or ≥20% of track over suggested.
     */
    _getSuggestionSnapInfo(index) {
        const state = this._getSuggestionAxisState(index);
        if (!state) return null;
        if (state.curPct < state.sugPct - 5) {
            return { kind: 'under', suggested: state.suggested, current: state.current };
        }
        if (state.curPct > state.sugPct + 20) {
            return { kind: 'over', suggested: state.suggested, current: state.current };
        }
        return null;
    }

    _hasUnderSuggestedValues() {
        if (!this.normalizeEnabled) return false;
        const weighting = this._getWeightingIndices();
        return weighting.some((i) => {
            const state = this._getSuggestionAxisState(i);
            return !!(state && state.curPct < state.sugPct - 0.0001);
        });
    }

    _syncCompensateHint() {
        if (!this._refs.attentionRescaleBtn) return;
        const show = this.normalizeEnabled
            && !this.attentionRescaleEnabled
            && this._hasUnderSuggestedValues();
        this._refs.attentionRescaleBtn.classList.toggle('emphasis-groups-compensate-hint', show);
    }

    /** Raise under-suggested unlocked groups to suggested; leave at/over alone. */
    _compensateUnderSuggestedValues() {
        if (!this.normalizeEnabled) return false;
        this._refreshDistributionCache();
        const active = this.getActiveIndices();
        const weighting = this._getWeightingIndices();
        if (!weighting.length) return false;

        let changed = false;
        if (this.distributionMode) {
            weighting.forEach((i) => {
                const state = this._getSuggestionAxisState(i);
                if (!state || state.curPct >= state.sugPct - 0.0001) return;
                const target = this.targets[i];
                if (!target) return;
                target.cardState.importance = state.suggested;
                this.cardStateByKey.set(target.targetKey, target.cardState);
                changed = true;
            });
            if (changed) {
                this._syncDistributionSharesFromImportance(active);
            }
        } else if (this.deltaMode) {
            const weights = this._getParticipantWeights(active);
            weighting.forEach((i) => {
                const state = this._getSuggestionAxisState(i);
                if (!state || state.curPct >= state.sugPct - 0.0001) return;
                weights[i] = state.suggested;
                changed = true;
            });
            if (changed) {
                this._syncSharesFromWeights(weights, active);
            }
        } else {
            weighting.forEach((i) => {
                const state = this._getSuggestionAxisState(i);
                if (!state || state.curPct >= state.sugPct - 0.0001) return;
                const target = this.targets[i];
                if (!target) return;
                const share = clampEmphasisShare(state.suggested);
                this.shares[i] = share;
                target.cardState.share = share;
                this.cardStateByKey.set(target.targetKey, target.cardState);
                changed = true;
            });
            if (changed) {
                this._preserveSharePrecision(weighting);
            }
        }

        if (!changed) return false;
        this._updateParticipantShareUI(active);
        this._persistForgeState();
        this._updateNormalizeToolbar();
        this._renderCards();
        this._scheduleNotchRefresh();
        return true;
    }

    _splitGroupAtCommas(index) {
        const target = this.targets[index];
        if (!target || this._isReadOnly()) return false;
        // applySplitEmphasisGroupAtCommas: public/scripts/comp/emphasisParse.js
        if (!applySplitEmphasisGroupAtCommas(this.textarea, target)) return false;

        if (updateEmphasisHighlighting) {
            updateEmphasisHighlighting(this.textarea);
        }
        if (promptTextareaToolbar) {
            promptTextareaToolbar.updateTokenCount(this.textarea);
        }
        this.reconcileTargetsFromPrompt({ preserveShares: this.normalizeEnabled });
        if (this.normalizeEnabled) {
            this._runAttentionRescale({ oneShot: true });
        } else {
            this._renderCards();
            this._scheduleNotchRefresh();
        }
        this._notifySiblingInstances();
        return true;
    }

    _mergeGroupWithNeighbor(index) {
        if (this._isReadOnly()) return false;
        const value = this.textarea.value || '';
        // findAdjacentEmphasisMergeNeighborIndex / mergeEmphasisAdjacentGroups: public/scripts/comp/emphasisParse.js
        const neighborIdx = findAdjacentEmphasisMergeNeighborIndex(value, this.targets, index);
        if (neighborIdx < 0) return false;

        const a = this.targets[index];
        const b = this.targets[neighborIdx];
        if (!a || !b) return false;
        const left = a.start <= b.start ? a : b;
        const right = a.start <= b.start ? b : a;

        const leftShare = Number.isFinite(left.cardState?.share) ? left.cardState.share : 0;
        const rightShare = Number.isFinite(right.cardState?.share) ? right.cardState.share : 0;
        const leftImp = Number.isFinite(left.cardState?.importance)
            ? left.cardState.importance
            : EMPHASIS_IMPORTANCE_UNBIASED;
        const rightImp = Number.isFinite(right.cardState?.importance)
            ? right.cardState.importance
            : EMPHASIS_IMPORTANCE_UNBIASED;
        const mergedShare = clampEmphasisShare(leftShare + rightShare);
        const mergedImportance = clampEmphasisShare((leftImp + rightImp) / 2);
        const mergedLocked = !!(left.cardState?.deltaLocked || right.cardState?.deltaLocked);
        const mergeAt = left.start;
        // buildMergedEmphasisGroupInner: public/scripts/comp/emphasisParse.js
        const mergedInner = buildMergedEmphasisGroupInner(value, left, right);
        if (mergedInner == null) return false;
        if (!!left.managed !== !!right.managed) return false;

        if (left.managed && right.managed) {
            // mergeManagedEmphasisAdjacentGroups: public/scripts/comp/emphasisGroupIdCodec.js
            const bag = resolveEmphasisBagForTextarea(this.textarea) || {};
            const mode = getEmphasisSyntaxModeForTextarea(this.textarea);
            const merged = mergeManagedEmphasisAdjacentGroups(
                value,
                left,
                right,
                bag.groupsById || {},
                mode
            );
            if (!merged) return false;
            setTextareaValuePreservingUndo(this.textarea, merged.text);
            const store = getEmphasisNormalizationFieldStore();
            getEmphasisNormalizationDualWriteKeys(this.textarea.id).forEach((key) => {
                store[key] = {
                    ...(store[key] || bag),
                    groupsById: { ...merged.groupsById },
                    syntaxMode: mode === 'visible' ? 'visible' : 'hidden'
                };
            });
            syncEmphasisNormalizationPreviewMetadata();
            dispatchPromptTextareaInputEvent(this.textarea, { skipAutofill: true });
            if (updateEmphasisHighlighting) {
                updateEmphasisHighlighting(this.textarea);
            }
            if (promptTextareaToolbar) {
                promptTextareaToolbar.updateTokenCount(this.textarea);
            }
            this.reconcileTargetsFromPrompt({ preserveShares: this.normalizeEnabled });
            const mergedTarget = this.targets.find((t) =>
                t && t.type === 'group'
                && t.start === mergeAt
                && String(t.innerText || '').trim() === mergedInner
            ) || this.targets.find((t) =>
                t && t.type === 'group' && String(t.innerText || '').trim() === mergedInner
            );
            if (mergedTarget?.cardState) {
                mergedTarget.cardState.share = mergedShare;
                mergedTarget.cardState.importance = mergedImportance;
                mergedTarget.cardState.deltaLocked = mergedLocked;
                if (Number.isFinite(mergedTarget.weight)) {
                    mergedTarget.cardState.directWeight = mergedTarget.weight;
                }
                this.cardStateByKey.set(mergedTarget.targetKey, mergedTarget.cardState);
                const mi = this.targets.indexOf(mergedTarget);
                if (mi >= 0) this.shares[mi] = mergedShare;
            }
            if (this.normalizeEnabled) {
                const active = this.getActiveIndices();
                if (this.distributionMode) {
                    this._syncDistributionSharesFromImportance(active);
                } else {
                    this._preserveSharePrecision(active);
                }
                this._updateParticipantShareUI(active);
                this._persistForgeState();
                this._renderCards();
                this._scheduleNotchRefresh();
                this._syncCompensateHint();
            } else {
                this._renderCards();
                this._scheduleNotchRefresh();
            }
            this._notifySiblingInstances();
            return true;
        }

        const newValue = mergeEmphasisAdjacentGroups(value, left, right);
        if (newValue == null || newValue === value) return false;

        // setTextareaValuePreservingUndo: public/scripts/comp/textareaUtils.js
        setTextareaValuePreservingUndo(this.textarea, newValue);
        // dispatchPromptTextareaInputEvent: public/scripts/comp/textareaUtils.js
        dispatchPromptTextareaInputEvent(this.textarea, { skipAutofill: true });
        if (updateEmphasisHighlighting) {
            updateEmphasisHighlighting(this.textarea);
        }
        if (promptTextareaToolbar) {
            promptTextareaToolbar.updateTokenCount(this.textarea);
        }

        this.reconcileTargetsFromPrompt({ preserveShares: this.normalizeEnabled });

        const merged = this.targets.find((t) =>
            t && t.type === 'group'
            && t.start === mergeAt
            && String(t.innerText || '').trim() === mergedInner
        ) || this.targets.find((t) =>
            t && t.type === 'group' && String(t.innerText || '').trim() === mergedInner
        );

        if (merged?.cardState) {
            merged.cardState.share = mergedShare;
            merged.cardState.importance = mergedImportance;
            merged.cardState.deltaLocked = mergedLocked;
            if (Number.isFinite(merged.weight)) {
                merged.cardState.directWeight = merged.weight;
            }
            this.cardStateByKey.set(merged.targetKey, merged.cardState);
            const mi = this.targets.indexOf(merged);
            if (mi >= 0) {
                this.shares[mi] = mergedShare;
            }
        }

        if (this.normalizeEnabled) {
            const active = this.getActiveIndices();
            if (this.distributionMode) {
                this._syncDistributionSharesFromImportance(active);
            } else {
                this._preserveSharePrecision(active);
            }
            this._updateParticipantShareUI(active);
            this._persistForgeState();
            this._renderCards();
            this._scheduleNotchRefresh();
            this._syncCompensateHint();
        } else {
            this._renderCards();
            this._scheduleNotchRefresh();
        }
        this._notifySiblingInstances();
        return true;
    }

    _updateSnapSuggestButton(card, index) {
        if (!card) return;
        const info = this._getSuggestionSnapInfo(index);
        let btn = card.querySelector('.emphasis-groups-card-snap-suggest');
        if (!info) {
            if (btn) btn.remove();
            return;
        }
        const icon = info.kind === 'under' ? 'fa-arrow-right-to-bracket' : 'fa-arrow-left-to-bracket';
        const title = info.kind === 'under'
            ? 'Raise slider to suggested value'
            : 'Lower slider to suggested value';
        if (!btn) {
            btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'btn-secondary btn-toggle icon-only emphasis-groups-card-snap-suggest';
            const row = card.querySelector('.emphasis-groups-card-row');
            const lock = card.querySelector('.emphasis-groups-card-delta-lock');
            const direct = card.querySelector('.emphasis-groups-card-direct');
            if (row && lock) {
                row.insertBefore(btn, lock);
            } else if (row && direct) {
                row.insertBefore(btn, direct);
            } else if (row) {
                row.appendChild(btn);
            }
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const idx = parseInt(card.dataset.index, 10);
                this._snapToSuggestion(idx);
            });
        }
        btn.dataset.snap = info.kind;
        btn.title = title;
        btn.innerHTML = `<i class="fas ${icon}" aria-hidden="true"></i>`;
    }

    _snapToSuggestion(index) {
        const info = this._getSuggestionSnapInfo(index);
        if (!info) return;
        const target = this.targets[index];
        if (!target) return;
        const grid = this._refs.grid;
        const card = grid?.querySelector(`.emphasis-groups-card[data-index="${index}"]`);
        const weightEl = card?.querySelector('.emphasis-groups-card-weight');

        if (this.normalizeEnabled && this.deltaMode) {
            this._applyParticipantWeightChange(index, info.suggested, weightEl);
            // Peers rebalanced — refresh all
            this._updateParticipantShareUI(this.getActiveIndices());
        } else if (this.normalizeEnabled) {
            // Share / distribution: apply already updated only this card
            this._applyParticipantShareChange(index, info.suggested, weightEl);
        } else {
            this._applyDirectWeight(index, info.suggested, target);
            this._renderCards();
            return;
        }
        this._scheduleNotchRefresh();
        this._updateNormalizeToolbar();
    }

    _syncRangeSharesFromWeights(activeIndices) {
        // Match _initSharesFromWeights / Apply — normalizePrecision maps into fine-grained shares
        const opts = this._getNormalizeWeightOptions();
        const active = activeIndices && activeIndices.length ? activeIndices : this.getActiveIndices();
        this.shares = this.targets.map(() => 0);
        active.forEach((i) => {
            const target = this.targets[i];
            if (!target) return;
            const w = this._targetWeightForNormalize(target);
            if (!isEligibleForEmphasisNormalize(w)) return;
            const share = clampEmphasisShare(weightToShare(w, this.minWeight, this.maxWeight, opts));
            this.shares[i] = share;
            target.cardState.share = share;
            this.cardStateByKey.set(target.targetKey, target.cardState);
        });
    }

    _updateNormalizeToolbar() {
        this.element.classList.toggle('emphasis-groups-normalize-active', this.normalizeEnabled);
        this.element.classList.toggle('emphasis-groups-direct-mode', !this.normalizeEnabled);
        this.element.classList.toggle('emphasis-groups-distribution-active', this.normalizeEnabled && this.distributionMode);
        this.element.classList.toggle('emphasis-groups-auto-band-active', this.normalizeEnabled && this.autoBandEnabled);
        if (this._refs.scopeBtn) {
            this._refs.scopeBtn.classList.add('hidden');
            this._refs.scopeBtn.setAttribute('hidden', 'true');
        }
        if (this._refs.modeGroup) {
            this._refs.modeGroup.classList.toggle('hidden', !this.normalizeEnabled);
        }
        if (this._refs.deltaModeBtn) {
            this._refs.deltaModeBtn.classList.toggle('hidden', !this.normalizeEnabled);
        }
        if (this._refs.distributionModeBtn) {
            this._refs.distributionModeBtn.classList.toggle('hidden', !this.normalizeEnabled);
            this._refs.distributionModeBtn.title = 'Distribution mode — importance 50 unbiased; >75 forces over peers, <25 forces under; preview until Apply';
        }
        this._syncModeToggleButtons();

        // Normalize OFF only: blender does combined one-shot. Normalize ON uses Auto Band + Attention Rescale.
        const showRebalance = !this.normalizeEnabled;
        if (this._refs.rebalanceBtn) {
            this._refs.rebalanceBtn.classList.toggle('hidden', !showRebalance);
            this._refs.rebalanceBtn.classList.toggle('btn-primary', !this.normalizeEnabled);
            this._refs.rebalanceBtn.classList.toggle('btn-secondary', !!this.normalizeEnabled);
            this._refs.rebalanceBtn.classList.toggle('icon-only', !!this.normalizeEnabled);
            this._refs.rebalanceBtn.title = 'One-shot Auto Band + Attention Rescale into prompt weights';
        }
        if (this._refs.rebalanceLabel) {
            this._refs.rebalanceLabel.classList.toggle('hidden', !!this.normalizeEnabled);
        }

        if (this._refs.applyBtn) {
            this._refs.applyBtn.classList.toggle('hidden', !this.normalizeEnabled);
            this._refs.applyBtn.title = (this.normalizeEnabled && this.distributionMode)
                ? 'Apply previewed weights to prompt'
                : 'Apply normalized weights to prompt';
        }
        if (this._refs.autoRangeBtn) {
            this._refs.autoRangeBtn.classList.toggle('hidden', !this.normalizeEnabled);
            this._refs.autoRangeBtn.setAttribute('data-state', this.autoBandEnabled ? 'on' : 'off');
            this._refs.autoRangeBtn.title = this.autoBandEnabled
                ? 'Auto Band ON — adjusts range on blur; right-click to disable'
                : 'Auto Band — click for one-shot; right-click for automatic scaling on blur';
        }
        if (this._refs.pullBandBtn) {
            const showPull = this.normalizeEnabled && !this.distributionMode;
            this._refs.pullBandBtn.classList.toggle('hidden', !showPull);
            this._refs.pullBandBtn.disabled = !showPull;
            this._refs.pullBandBtn.title = 'Pull Band Range — peak slider to 100%, set max to that weight';
        }
        if (this._refs.attentionRescaleBtn) {
            this._refs.attentionRescaleBtn.classList.toggle('hidden', !this.normalizeEnabled);
            this._refs.attentionRescaleBtn.setAttribute('data-state', this.attentionRescaleEnabled ? 'on' : 'off');
            this._refs.attentionRescaleBtn.title = this.attentionRescaleEnabled
                ? 'Auto Normalize ON — renormalizes sliders on blur; right-click to disable'
                : 'Auto Normalize — click for one-shot; right-click for automatic scaling on blur';
            this._syncCompensateHint();
        }
        this._syncAutoBandRangeUi();

        const showRangeToolbar = this.normalizeEnabled || this.targets.length > 0;
        if (this._refs.normalizeRange) {
            this._refs.normalizeRange.classList.toggle('hidden', !showRangeToolbar);
        }
        const hideMinRange = this.normalizeEnabled && this.distributionMode;
        const lockNudges = this.normalizeEnabled && this.autoBandEnabled;
        if (this._refs.minWeightDown) this._refs.minWeightDown.classList.toggle('hidden', hideMinRange || lockNudges);
        if (this._refs.minWeight) this._refs.minWeight.classList.toggle('hidden', hideMinRange);
        if (this._refs.minWeightUp) this._refs.minWeightUp.classList.toggle('hidden', hideMinRange || lockNudges);
        if (this._refs.maxWeightDown) this._refs.maxWeightDown.classList.toggle('hidden', lockNudges);
        if (this._refs.maxWeightUp) this._refs.maxWeightUp.classList.toggle('hidden', lockNudges);
        if (this._refs.maxWeight) {
            this._refs.maxWeight.title = this.autoBandEnabled
                ? 'Maximum weight (Auto Band)'
                : (this.normalizeEnabled ? 'Maximum weight' : 'Top weight for group sliders');
            this._refs.maxWeight.placeholder = this.normalizeEnabled ? 'Max' : 'Max';
        }
        if (this._refs.normalizeBtn) {
            this._refs.normalizeBtn.setAttribute('data-state', this.normalizeEnabled ? 'on' : 'off');
        }
    }

    _getFieldKey() {
        return getEmphasisNormalizationFieldKey(this.textarea);
    }

    _targetWeightForNormalize(target) {
        return target.cardState?.directWeight ?? target.weight;
    }

    _isEligibleForNormalizeTarget(target) {
        return isEligibleForEmphasisNormalize(this._targetWeightForNormalize(target));
    }

    _snapshotPreNormalizeWeights() {
        this.preNormalizeWeights = new Map();
        this.preNormalizeWeightsByKey = {};
        this.targets.forEach((target) => {
            const w = this._targetWeightForNormalize(target);
            this.preNormalizeWeights.set(target.targetKey, w);
            this.preNormalizeWeightsByKey[target.targetKey] = w;
        });
    }

    _restorePreNormalizeWeights() {
        if (!this.preNormalizeWeights.size && this.preNormalizeWeightsByKey) {
            Object.entries(this.preNormalizeWeightsByKey).forEach(([key, weight]) => {
                this.preNormalizeWeights.set(key, weight);
            });
        }
        if (!this.preNormalizeWeights.size) return;

        const weightByStart = new Map();
        this.targets.forEach((target) => {
            let weight;
            if (this.preNormalizeWeights.has(target.targetKey)) {
                weight = this.preNormalizeWeights.get(target.targetKey);
            } else {
                const legacyKey = buildEmphasisTargetKeyLegacy(target);
                if (this.preNormalizeWeights.has(legacyKey)) {
                    weight = this.preNormalizeWeights.get(legacyKey);
                } else if (this.preNormalizeWeightsByKey) {
                    weight = lookupEmphasisSavedKeyEntry(this.preNormalizeWeightsByKey, target);
                }
            }
            if (weight !== undefined) {
                weightByStart.set(target.start, weight);
            }
        });
        if (weightByStart.size) {
            this._applyWeights(weightByStart, { forceRestore: true });
        }
        this.reconcileTargetsFromPrompt({ syncFromPrompt: true });
    }

    _enableNormalize() {
        this._flushDirectModeApply();
        this.reconcileTargetsFromPrompt({ syncFromPrompt: true });
        const eligibleCount = this.targets.filter((t) => this._isEligibleForNormalizeTarget(t)).length;
        if (!eligibleCount) {
            // showGlassToast: public/scripts/comp/toastManager.js
            if (typeof showGlassToast === 'function') {
                showGlassToast('info', null, 'No emphasis groups with weight ≥ 1 to normalize', false, 3000, '<i class="fas fa-chart-pie"></i>');
            }
            return;
        }
        this._snapshotPreNormalizeWeights();
        this.normalizeEnabled = true;
        this.autoBandEnabled = false;
        this.attentionRescaleEnabled = false;
        this.autoApplyOnGenerate = false;
        const active = this.getActiveIndices();
        this._initNormalizeFromDirectMode(active);
        this._updateNormalizeToolbar();
        this._persistForgeState();
        this._renderCards();
    }

    _disableNormalize() {
        // Leave the prompt as-is (including any Apply / non-participant direct commits).
        // Restoring the enable-time snapshot undid Apply and wiped in-session direct edits.
        this.normalizeEnabled = false;
        this.autoBandEnabled = false;
        this.attentionRescaleEnabled = false;
        this.autoApplyOnGenerate = false;
        this.preNormalizeWeights = new Map();
        this.preNormalizeWeightsByKey = {};
        this.reconcileTargetsFromPrompt({ syncFromPrompt: true });
        this._persistForgeState();
        this._updateNormalizeToolbar();
        this._renderCards();
    }

    _applyNormalize() {
        if (!this.normalizeEnabled) return;
        const opts = this._getNormalizeWeightOptions();
        const weighting = this._getWeightingIndices();
        if (!weighting.length) return;
        if (this.distributionMode) {
            this._syncDistributionSharesFromImportance(this.getActiveIndices());
        }
        const previewWeights = this.distributionMode
            ? this._getNormalizeDisplayWeights()
            : sharesToWeights(
                this.shares,
                this.minWeight,
                this.maxWeight,
                weighting,
                opts
            );
        weighting.forEach((i) => {
            const target = this.targets[i];
            if (!target) return;
            let w = previewWeights[i];
            if (w === undefined) return;
            if (target.type === 'brace') {
                w = snapWeightForBraceMode(w);
            }
            const share = clampEmphasisShare(weightToShare(w, this.minWeight, this.maxWeight, opts));
            this.shares[i] = share;
            target.cardState.share = share;
            this.cardStateByKey.set(target.targetKey, target.cardState);
        });
        this._applyFromShares();
        // Disable-restore must not undo Apply — refresh snapshot to post-apply prompt weights.
        this._snapshotPreNormalizeWeights();
        if (this.distributionMode) {
            this._distributionApplied = true;
            this._distributionStash = null;
        }
        this._persistForgeState();
        this.reconcileTargetsFromPrompt({ preserveShares: true });
        this._renderCards();
    }

    _rebalanceSharePercentages(options = {}) {
        if (!this.normalizeEnabled) return;
        if (!options.skipDialog && this.distributionMode) return;
        const weighting = this._getWeightingIndices();
        if (!weighting.length) return;

        const sum = weighting.reduce((s, i) => s + (this.shares[i] || 0), 0);
        if (sum <= 0) return;

        weighting.forEach((i) => {
            const newShare = clampEmphasisShare(((this.shares[i] || 0) / sum) * 100);
            this.shares[i] = newShare;
            const target = this.targets[i];
            if (!target) return;
            target.cardState.share = newShare;
            this.cardStateByKey.set(target.targetKey, target.cardState);
        });

        this._updateParticipantShareUI(this.getActiveIndices());
        this._persistForgeState();
        this._renderCards();
    }

    _persistForgeState() {
        const fieldKey = this._getFieldKey();
        if (!fieldKey) return;

        const cardMeta = {};
        this.targets.forEach((target) => {
            cardMeta[target.targetKey] = {
                deltaLocked: !!target.cardState.deltaLocked,
                importance: Number.isFinite(target.cardState.importance)
                    ? target.cardState.importance
                    : EMPHASIS_IMPORTANCE_UNBIASED
            };
        });

        const percentages = this.targets.map((t, i) => clampEmphasisShare(this.shares[i] ?? t.cardState.share ?? 0));
        const percentagesByKey = {};
        this.targets.forEach((target, i) => {
            percentagesByKey[target.targetKey] = percentages[i];
            // Stable managed keys — survive start-position / innerText drift on reopen.
            if (target.managed && target.managedId != null) {
                percentagesByKey[`managed:${target.managedId}`] = percentages[i];
                percentagesByKey[target.managedId] = percentages[i];
                percentagesByKey[String(target.managedId)] = percentages[i];
            }
        });

        if (!this.normalizeEnabled) {
            const existing = readEmphasisNormalizationFieldState(fieldKey);
            const groupsById = existing?.groupsById && typeof existing.groupsById === 'object'
                ? existing.groupsById
                : null;
            if (groupsById && Object.keys(groupsById).length) {
                // Keep managed id weight map when Normalize is off
                writeEmphasisNormalizationFieldState(fieldKey, { groupsById: { ...groupsById } });
            } else {
                writeEmphasisNormalizationFieldState(fieldKey, null);
            }
            return;
        }

        const prevBag = readEmphasisNormalizationFieldState(fieldKey);
        const persistBag = {
            enabled: true,
            minWeight: this.minWeight,
            maxWeight: this.maxWeight,
            delta: !!this.deltaMode,
            distribution: !!this.distributionMode,
            deltaMode: !!this.deltaMode,
            autoBand: !!this.autoBandEnabled,
            attentionRescale: !!this.attentionRescaleEnabled,
            autoApplyOnGenerate: !!this.autoApplyOnGenerate,
            percentages,
            percentagesByKey,
            cards: cardMeta,
            preNormalizeWeights: { ...this.preNormalizeWeightsByKey }
        };
        if (prevBag?.groupsById && typeof prevBag.groupsById === 'object'
            && Object.keys(prevBag.groupsById).length) {
            persistBag.groupsById = { ...prevBag.groupsById };
        }
        writeEmphasisNormalizationFieldState(fieldKey, persistBag);
    }

    _loadForgeState() {
        const fieldKey = this._getFieldKey();
        if (fieldKey && !readEmphasisNormalizationFieldState(fieldKey)) {
            const forgeNorm = window.currentManualPreviewImage?.metadata?.forge_data?.emphasis_normalization
                || window.lastGeneration?.forge_data?.emphasis_normalization;
            const fromForge = forgeNorm && forgeNorm[fieldKey];
            if (fromForge && typeof fromForge === 'object') {
                getEmphasisNormalizationFieldStore()[fieldKey] = { ...fromForge };
            }
        }
        const saved = readEmphasisNormalizationFieldState(fieldKey);
        if (!saved) {
            this.normalizeEnabled = false;
            this.distributionMode = false;
            this.deltaMode = false;
            this.autoBandEnabled = false;
            this.attentionRescaleEnabled = false;
            this.autoApplyOnGenerate = false;
            this._updateNormalizeToolbar();
            return;
        }

        if (!saved.enabled) {
            this.normalizeEnabled = false;
            this.distributionMode = false;
            this.deltaMode = false;
            this.autoBandEnabled = false;
            this.attentionRescaleEnabled = false;
            this.autoApplyOnGenerate = false;
            this._updateNormalizeToolbar();
            return;
        }

        this.normalizeEnabled = true;
        this.minWeight = this._clampNormalizeWeight(saved.minWeight ?? 1);
        this.maxWeight = this._clampNormalizeWeight(saved.maxWeight ?? 2);
        this.deltaMode = !!(saved.delta ?? saved.deltaMode ?? saved.relativeSharedWeighting);
        this.distributionMode = !!(saved.distribution ?? saved.distributionMode);
        this.autoBandEnabled = !!saved.autoBand;
        this.attentionRescaleEnabled = !!saved.attentionRescale;
        this.autoApplyOnGenerate = !!saved.autoApplyOnGenerate;
        if (this.distributionMode) {
            this.deltaMode = false;
        } else if (this.deltaMode) {
            this.distributionMode = false;
        }
        this.preNormalizeWeightsByKey = (saved.preNormalizeWeights && typeof saved.preNormalizeWeights === 'object')
            ? { ...saved.preNormalizeWeights }
            : {};

        if (this._refs.minWeight) this._refs.minWeight.value = formatEmphasisWeight(this.minWeight);
        if (this._refs.maxWeight) this._refs.maxWeight.value = formatEmphasisWeight(this.maxWeight);
        this._syncNormalizeRangeInputs();
        if (this._refs.scopeBtn) {
            this._refs.scopeBtn.classList.add('hidden');
            this._refs.scopeBtn.setAttribute('data-state', 'off');
        }
        if (this._refs.deltaModeBtn) {
            this._refs.deltaModeBtn.setAttribute('data-state', this.deltaMode ? 'on' : 'off');
        }
        if (this._refs.distributionModeBtn) {
            this._refs.distributionModeBtn.setAttribute('data-state', this.distributionMode ? 'on' : 'off');
        }

        this._applySavedCardMeta(saved);

        let loadedSavedShares = false;
        const loadedShareIndices = new Set();
        if (saved.percentagesByKey && typeof saved.percentagesByKey === 'object') {
            this.targets.forEach((target, i) => {
                const pct = lookupEmphasisSavedKeyEntry(saved.percentagesByKey, target);
                if (typeof pct !== 'number') return;
                const share = clampEmphasisShare(pct);
                target.cardState.share = share;
                this.shares[i] = share;
                this.cardStateByKey.set(target.targetKey, target.cardState);
                loadedSavedShares = true;
                loadedShareIndices.add(i);
            });
        } else if (Array.isArray(saved.percentages) && saved.percentages.length) {
            saved.percentages.forEach((pct, i) => {
                const target = this.targets[i];
                if (!target) return;
                const share = clampEmphasisShare(pct);
                target.cardState.share = share;
                this.shares[i] = share;
                this.cardStateByKey.set(target.targetKey, target.cardState);
                loadedSavedShares = true;
                loadedShareIndices.add(i);
            });
        } else if (saved.cards && typeof saved.cards === 'object') {
            this.targets.forEach((target, i) => {
                const cardSaved = lookupEmphasisSavedKeyEntry(saved.cards, target);
                if (!cardSaved || typeof cardSaved.share !== 'number') return;
                const share = clampEmphasisShare(cardSaved.share);
                target.cardState.share = share;
                this.shares[i] = share;
                this.cardStateByKey.set(target.targetKey, target.cardState);
                loadedSavedShares = true;
                loadedShareIndices.add(i);
            });
        }

        const active = this.getActiveIndices();
        if (active.length) {
            // Keep forge share preview when present (closed-tool gen + reopen). Prompt wins only
            // when no shares were saved — or via Apply menu "Load from Prompt".
            // Partial key matches used to leave the rest at share 0 → "0% (1)" — fill those gaps
            // from live prompt / groupsById weights without wiping matched forge shares.
            if (!loadedSavedShares) {
                this._initSharesFromWeights(active);
            } else {
                const missing = active.filter((i) => !loadedShareIndices.has(i));
                if (missing.length) {
                    this._fillMissingSharesFromWeights(missing);
                }
            }
            // Pre-importance forge / all-50 migrate: derive importance from shares
            if (this.distributionMode) {
                const hydrated = this._hydrateDistributionImportanceFromShares(saved, active);
                if (hydrated) {
                    this._syncDistributionSharesFromImportance(active);
                    this._persistForgeState();
                }
            }
        } else {
            this.normalizeEnabled = false;
            writeEmphasisNormalizationFieldState(this._getFieldKey(), null);
        }

        this._updateNormalizeToolbar();
        if (this.normalizeEnabled && (this.autoBandEnabled || this.attentionRescaleEnabled)) {
            this._maybeRunLiveAutos();
        }
    }

    /**
     * Forge saved before importance bias: cards lack importance (or only defaults).
     * Map loaded shares → importance so distribution sliders match prior share layout.
     * @returns {boolean} true if any card importance was written
     */
    _hydrateDistributionImportanceFromShares(saved, activeIndices) {
        const active = activeIndices && activeIndices.length ? activeIndices : this.getActiveIndices();
        if (!active.length) return false;

        const equalShare = 100 / active.length;
        const allUnbiased = active.every((i) => {
            const imp = this.targets[i]?.cardState?.importance;
            return !Number.isFinite(imp) || Math.abs(imp - EMPHASIS_IMPORTANCE_UNBIASED) < 0.0001;
        });
        const sharesNotFlat = active.some((i) => {
            const share = this.shares[i] ?? this.targets[i]?.cardState?.share ?? 0;
            return Math.abs(share - equalShare) > 0.75;
        });

        const forgeHadImportanceKey = active.some((i) => {
            const target = this.targets[i];
            if (!target || !saved?.cards) return false;
            const cardSaved = lookupEmphasisSavedKeyEntry(saved.cards, target);
            return !!(cardSaved && Object.prototype.hasOwnProperty.call(cardSaved, 'importance'));
        });

        // Hydrate when forge never stored importance, or when everything is stuck at 50
        // while shares still encode a non-flat layout (legacy / bad migrate).
        let shouldHydrateAll = !forgeHadImportanceKey || (allUnbiased && sharesNotFlat);

        let wrote = false;
        active.forEach((i) => {
            const target = this.targets[i];
            if (!target) return;
            if (!shouldHydrateAll) {
                const cardSaved = saved?.cards
                    ? lookupEmphasisSavedKeyEntry(saved.cards, target)
                    : null;
                if (cardSaved && Number.isFinite(cardSaved.importance)) return;
                if (Number.isFinite(target.cardState.importance)
                    && Math.abs(target.cardState.importance - EMPHASIS_IMPORTANCE_UNBIASED) > 0.0001) {
                    return;
                }
            }
            const share = this.shares[i] ?? target.cardState.share ?? 0;
            const importance = this._importanceFromShare(share, active.length);
            if (Number.isFinite(target.cardState.importance)
                && Math.abs(target.cardState.importance - importance) < 0.0001) {
                return;
            }
            target.cardState.importance = importance;
            this.cardStateByKey.set(target.targetKey, target.cardState);
            wrote = true;
        });
        return wrote;
    }

    _applySavedCardMeta(saved) {
        if (!saved || !saved.cards || typeof saved.cards !== 'object') return;
        this.targets.forEach((target) => {
            const cardSaved = lookupEmphasisSavedKeyEntry(saved.cards, target);
            if (!cardSaved) return;
            if (cardSaved.deltaLocked !== undefined) {
                target.cardState.deltaLocked = !!cardSaved.deltaLocked;
            } else if (cardSaved.rswLocked !== undefined) {
                target.cardState.deltaLocked = !!cardSaved.rswLocked;
            }
            if (Number.isFinite(cardSaved.importance)) {
                target.cardState.importance = clampEmphasisShare(cardSaved.importance);
            }
            this.cardStateByKey.set(target.targetKey, target.cardState);
        });
    }

    _getNormalizeDisplayWeights() {
        const active = this.getActiveIndices();
        const weighting = this._getWeightingIndices();
        const opts = this._getNormalizeWeightOptions();
        // Distribution interactive display uses assigned shares (stable). Importance→share
        // remapping runs only on Apply / Attention via _syncDistributionSharesFromImportance.
        const fromShares = sharesToWeights(
            this.shares,
            this.minWeight,
            this.maxWeight,
            weighting.length ? weighting : active,
            opts
        );
        const weights = [];
        active.forEach((i) => {
            if (this.targets[i]?.cardState?.deltaLocked) {
                weights[i] = this._targetWeightForNormalize(this.targets[i]);
            } else if (fromShares[i] !== undefined) {
                weights[i] = fromShares[i];
            } else {
                weights[i] = this._targetWeightForNormalize(this.targets[i]);
            }
        });
        return weights;
    }

    _syncDistributionSharesFromImportance(activeIndices) {
        const active = activeIndices && activeIndices.length ? activeIndices : this.getActiveIndices();
        const weighting = this._getWeightingIndices();
        const indices = weighting.length ? weighting : active;
        // Apply-time only: bias pool ranks by importance, then write shares
        const dist = this._getAutoDistribution(indices, { withImportance: true, skipCacheUpdate: true });
        const relativeByLocal = dist.relativeImportancesByLocalIndex || {};
        indices.forEach((i) => {
            const target = this.targets[i];
            if (!target || target.cardState?.deltaLocked) return;
            const rel = relativeByLocal[i];
            if (rel === undefined) return;
            const share = clampEmphasisShare(rel);
            this.shares[i] = share;
            target.cardState.share = share;
            this.cardStateByKey.set(target.targetKey, target.cardState);
        });
        this._preserveSharePrecision(indices);
    }

    _wireSyncListeners() {
        this._onTextareaInput = () => {
            if (this.isApplyingFromTool || this.isDraggingSlider) return;
            clearTimeout(this._reconcileTimer);
            this._reconcileTimer = setTimeout(() => {
                this.reconcileTargetsFromPrompt({ syncFromPrompt: true });
                this._refreshDistributionCache();
                if (!this._shouldDeferCardRender()) {
                    this._renderCards();
                }
                this._notifySiblingInstances();
            }, 150);
        };
        this.textarea.addEventListener('input', this._onTextareaInput);

        // Pointer on rack cancels pending textarea-blur autos (relatedTarget is often null)
        this._onRackPointerDown = () => {
            this._rackPointerDown = true;
            clearTimeout(this._textareaBlurTimer);
        };
        this._onRackPointerUp = () => {
            this._rackPointerDown = false;
        };
        this.element.addEventListener('pointerdown', this._onRackPointerDown, true);
        this.element.addEventListener('pointerup', this._onRackPointerUp, true);
        this.element.addEventListener('pointercancel', this._onRackPointerUp, true);

        this._onTextareaBlur = (e) => {
            if (this.isApplyingFromTool || this.isDraggingSlider) return;
            if (e?.relatedTarget && this.element.contains(e.relatedTarget)) return;
            if (this._rackPointerDown) return;
            clearTimeout(this._reconcileTimer);
            clearTimeout(this._textareaBlurTimer);
            // Defer: focus/pointer may land in the rack after blur with null relatedTarget
            this._textareaBlurTimer = setTimeout(() => {
                this._textareaBlurTimer = null;
                if (this.isApplyingFromTool || this.isDraggingSlider || this._rackPointerDown) return;
                if (this.element.contains(document.activeElement)) return;
                this.reconcileTargetsFromPrompt({ preserveShares: this.normalizeEnabled });
                this._refreshDistributionCache();
                const ranLive = this._maybeRunLiveAutos();
                if (!ranLive && !this._shouldDeferCardRender()) {
                    this._renderCards();
                }
                this._notifySiblingInstances();
            }, 0);
        };
        this.textarea.addEventListener('blur', this._onTextareaBlur);

        this._onFocusIn = (e) => {
            if (this.isDraggingSlider) return;
            if (this._shouldSkipFocusReconcile(e.target)) return;
            clearTimeout(this._focusReconcileTimer);
            this._focusReconcileTimer = setTimeout(() => {
                if (this.isDraggingSlider) return;
                this.reconcileTargetsFromPrompt({ preserveShares: true });
                this._refreshDistributionCache();
                if (!this._shouldDeferCardRender()) {
                    this._renderCards();
                }
            }, 0);
        };
        this._onFocusOut = (e) => {
            if (this.element.contains(e.relatedTarget)) return;
            if (this._shouldSkipFocusReconcile(e.relatedTarget)) return;
            clearTimeout(this._focusReconcileTimer);
            this._focusReconcileTimer = setTimeout(() => {
                this.reconcileTargetsFromPrompt({ preserveShares: true });
                this._refreshDistributionCache();
                if (!this._shouldDeferCardRender()) {
                    this._renderCards();
                }
            }, 0);
        };
        this.element.addEventListener('focusin', this._onFocusIn);
        this.element.addEventListener('focusout', this._onFocusOut);

        this._onWindowMousedown = (e) => {
            if (this.isApplyingFromTool || this.isDraggingSlider || this._rackPointerDown) return;
            if (this._shouldSkipFocusReconcile(e.target)) return;
            clearTimeout(this._focusReconcileTimer);
            this._focusReconcileTimer = setTimeout(() => {
                if (this.isApplyingFromTool || this.isDraggingSlider || this._rackPointerDown) return;
                this.reconcileTargetsFromPrompt({ preserveShares: true });
                this._refreshDistributionCache();
                const ranLive = this._maybeRunLiveAutos();
                if (!ranLive && !this._shouldDeferCardRender()) {
                    this._renderCards();
                }
            }, 0);
        };
        this.element.addEventListener('mousedown', this._onWindowMousedown);

        this._onWindowBrowserFocus = () => {
            if (this.isApplyingFromTool || this.isDraggingSlider || this._rackPointerDown) return;
            clearTimeout(this._focusReconcileTimer);
            this._focusReconcileTimer = setTimeout(() => {
                if (this.isApplyingFromTool || this.isDraggingSlider || this._rackPointerDown) return;
                this.reconcileTargetsFromPrompt({ preserveShares: true });
                this._refreshDistributionCache();
                const ranLive = this._maybeRunLiveAutos();
                if (!ranLive && !this._shouldDeferCardRender()) {
                    this._renderCards();
                }
            }, 0);
        };
        window.addEventListener('focus', this._onWindowBrowserFocus);
        document.addEventListener('visibilitychange', this._onWindowBrowserFocus);
    }

    /** Sibling same-polarity racks: refresh caches/notches only (no autos apply). */
    _notifySiblingInstances() {
        if (!this.manager?.instances) return;
        const polarity = getEmphasisSiblingPolarity(this.textarea);
        this.manager.instances.forEach((instance) => {
            if (instance === this) return;
            if (getEmphasisSiblingPolarity(instance.textarea) !== polarity) return;
            clearTimeout(instance._siblingRefreshTimer);
            instance._siblingRefreshTimer = setTimeout(() => {
                instance._refreshDistributionCache();
                if (!instance._shouldDeferCardRender()) {
                    instance._renderCards();
                }
            }, 120);
        });
    }

    getActiveIndices() {
        const indices = this.targets.map((_, i) => i);
        if (!this.normalizeEnabled) return indices;
        return indices.filter((i) => this._isEligibleForNormalizeTarget(this.targets[i]));
    }

    _getOrCreateCardState(targetKey, parsedWeight, syncFromPrompt = false) {
        if (this.cardStateByKey.has(targetKey)) {
            const state = this.cardStateByKey.get(targetKey);
            if (state.signMode === undefined || state.weightBand === undefined) {
                const inferred = inferEmphasisWeightBand(state.directWeight ?? parsedWeight, state.signMode);
                state.signMode = inferred.signMode;
                state.weightBand = inferred.band;
            }
            if (syncFromPrompt && !this.isDraggingSlider && !this.isApplyingFromTool && state.directWeight !== parsedWeight) {
                state.directWeight = parsedWeight;
                const inferred = inferEmphasisWeightBand(parsedWeight, state.signMode);
                state.signMode = inferred.signMode;
                state.weightBand = inferred.band;
                state.manualEditOpen = false;
            }
            if (state.manualEditOpen === undefined) {
                state.manualEditOpen = false;
            }
            if (state.deltaLocked === undefined) {
                state.deltaLocked = false;
            }
            if (state.importance === undefined) {
                state.importance = EMPHASIS_IMPORTANCE_UNBIASED;
            }
            return state;
        }
        const inferred = inferEmphasisWeightBand(parsedWeight);
        const state = {
            share: 0,
            importance: EMPHASIS_IMPORTANCE_UNBIASED,
            directWeight: parsedWeight,
            signMode: inferred.signMode,
            weightBand: inferred.band,
            manualEditOpen: false,
            deltaLocked: false
        };
        this.cardStateByKey.set(targetKey, state);
        return state;
    }

    reconcileTargetsFromPrompt(options = {}) {
        const value = this.textarea.value || '';
        const prevTargets = this.targets;
        // listEditorEmphasisTargets / resolveEmphasisBagForTextarea: public/scripts/comp/emphasisGroupIdCodec.js
        const bag = resolveEmphasisBagForTextarea(this.textarea);
        const freshTargets = listEditorEmphasisTargets(value, bag);

        if (prevTargets.length && freshTargets.length) {
            this._remapKeyedStoresByLegacyTargetKey(prevTargets, freshTargets);
        }

        this.targets = freshTargets.map((target) => {
            const targetKey = buildEmphasisTargetKey(target);
            const cardState = this._getOrCreateCardState(targetKey, target.weight, options.syncFromPrompt);
            return { ...target, targetKey, cardState };
        });

        this.shares = this.targets.map((t) => t.cardState.share);
        if (this.normalizeEnabled) {
            const active = this.getActiveIndices();
            if (!options.preserveShares && !this.isApplyingFromTool && active.length) {
                this._initSharesFromWeights(active);
            } else if (active.length) {
                this._preserveSharePrecision(active);
            }
            // Persist remapped shares immediately so forge/store keys stay current
            if (options.preserveShares && !this.isApplyingFromTool) {
                this._persistForgeState();
            }
        } else if (this.targets.length) {
            this._syncDirectModeMaxFromTargets();
        }
    }

    _isReadOnly() {
        return Boolean(this.textarea.readOnly || this.textarea.disabled);
    }

    _parseWeightInputValue(raw, fallback) {
        const text = String(raw || '').trim();
        if (text === '---') return '---';
        const parsed = parseFloat(text);
        if (isNaN(parsed)) return fallback;
        return parsed;
    }

    _applyDirectWeight(index, weight, target, options = {}) {
        let w = weight === '---' ? '---' : clampEmphasisWeight(weight);
        if (w !== '---' && target && target.type === 'brace') {
            w = snapWeightForBraceMode(w);
        }
        target.cardState.directWeight = w;
        target.cardState.manualEditOpen = false;
        if (w !== '---') {
            const inferred = inferEmphasisWeightBand(w, target.cardState.signMode);
            target.cardState.signMode = inferred.signMode;
            target.cardState.weightBand = inferred.band;
        }
        this.cardStateByKey.set(target.targetKey, target.cardState);
        if (w !== '---') {
            if (!this.normalizeEnabled) {
                this._commitDirectModeWeight(index, w, null, { rerender: options.rerender !== false });
                return;
            }
            if (this._isNormalizeParticipant(target)) {
                if (this.distributionMode) {
                    const share = weightToShare(w, this.minWeight, this.maxWeight, this._getNormalizeWeightOptions());
                    const importance = this._importanceFromShare(share, this.getActiveIndices().length);
                    this._applyParticipantShareChange(index, importance, null);
                } else if (this.deltaMode) {
                    this._applyParticipantWeightChange(index, w, null);
                } else {
                    const share = weightToShare(w, this.minWeight, this.maxWeight, this._getNormalizeWeightOptions());
                    this._applyParticipantShareChange(index, share, null);
                }
            } else {
                this._applyWeightAtIndex(index, w, { forceCommit: true });
            }
        }
        if (options.rerender !== false) {
            this._renderCards();
        }
    }

    _commitCardWeightInput(index, target, inputEl) {
        if (!inputEl || this._isReadOnly()) return;
        const weight = this._parseWeightInputValue(inputEl.value, target.cardState.directWeight);
        this._applyDirectWeight(index, weight, target);
    }

    _focusCardWeightInput(targetKey) {
        requestAnimationFrame(() => {
            const card = this._refs.grid?.querySelector(`[data-target-key="${CSS.escape(targetKey)}"]`);
            const input = card?.querySelector('.emphasis-groups-card-weight-input');
            if (input) {
                input.focus();
                input.select();
            }
        });
    }

    _getCardsScrollEl() {
        const shell = this._refs.grid?.closest('[data-custom-scrollbar]');
        if (!shell) return null;
        return shell.querySelector('.emphasis-groups-grid-scrollable') || shell.querySelector('.scrollable-content');
    }

    _renderCards() {
        const grid = this._refs.grid;
        const empty = this._refs.empty;
        if (!grid) return;

        this._updateNormalizeToolbar();

        const scrollEl = this._getCardsScrollEl();
        const savedScrollTop = scrollEl ? scrollEl.scrollTop : 0;

        grid.innerHTML = '';
        if (!this._lastDistribution || !this.contextCards) {
            this._refreshDistributionCache();
        }
        const contextCardsEarly = this.contextCards?.length
            ? this.contextCards
            : listLocalUnweightedContextCards(this.textarea);
        const hasTargets = this.targets.length > 0;
        const hasAnyCards = hasTargets || contextCardsEarly.length > 0;
        if (empty) {
            empty.classList.toggle('hidden', hasAnyCards);
        }
        if (!hasAnyCards) {
            this._lastRenderedTargetCount = 0;
            this._lastRenderedHadEmpty = true;
            return;
        }

        const readOnly = this._isReadOnly();
        const normalizeWeights = this.normalizeEnabled ? this._getNormalizeDisplayWeights() : null;
        // Collect then append in prompt order so unweighted text sits between groups
        const orderedCards = [];

        if (hasTargets) {
            this.targets.forEach((target, index) => {
                const typeIcon = getEmphasisCardTypeIcon(target);
                const isParticipant = this._isNormalizeParticipant(target);
                const usesNormalizeChrome = this._usesNormalizeCardChrome(target);
                const normalizeEligible = this._isEligibleForNormalizeTarget(target);

                let sliderMin;
                let sliderMax;
                let sliderStep;
                let sliderVal;
                let displayWeight;
                let showSlider = true;
                let showValueInput = false;
                let showValueSpan = true;

                if (usesNormalizeChrome) {
                    showSlider = true;
                    showValueSpan = true;
                    showValueInput = false;
                    if (this.deltaMode && target.cardState.deltaLocked) {
                        displayWeight = this._targetWeightForNormalize(target);
                        sliderMin = 0;
                        sliderMax = 100;
                        sliderStep = 0.1;
                        sliderVal = target.cardState.share;
                    } else if (this.deltaMode) {
                        displayWeight = isParticipant && normalizeWeights && normalizeWeights[index] !== undefined
                            ? normalizeWeights[index]
                            : this._targetWeightForNormalize(target);
                        sliderMin = this.minWeight;
                        sliderMax = this.maxWeight;
                        sliderStep = EMPHASIS_NORMALIZE_WEIGHT_STEP;
                        sliderVal = Math.max(this.minWeight, Math.min(this.maxWeight, this._clampNormalizeWeight(displayWeight)));
                    } else if (this.distributionMode) {
                        displayWeight = isParticipant && normalizeWeights && normalizeWeights[index] !== undefined
                            ? normalizeWeights[index]
                            : this._targetWeightForNormalize(target);
                        sliderMin = 0;
                        sliderMax = 100;
                        sliderStep = 0.1;
                        sliderVal = clampEmphasisShare(
                            Number.isFinite(target.cardState.importance)
                                ? target.cardState.importance
                                : EMPHASIS_IMPORTANCE_UNBIASED
                        );
                    } else {
                        sliderMin = 0;
                        sliderMax = 100;
                        sliderStep = 0.1;
                        sliderVal = clampEmphasisShare(target.cardState.share);
                        displayWeight = isParticipant && normalizeWeights && normalizeWeights[index] !== undefined
                            ? normalizeWeights[index]
                            : this._targetWeightForNormalize(target);
                    }
                } else {
                    const bounds = this._getDirectModeWeightBounds(target);
                    sliderMin = bounds.min;
                    sliderMax = bounds.max;
                    sliderStep = EMPHASIS_WEIGHT_FINE_STEP;
                    displayWeight = (this.normalizeEnabled && normalizeEligible)
                        ? this._targetWeightForNormalize(target)
                        : target.cardState.directWeight;
                    sliderVal = Number.isFinite(displayWeight)
                        ? Math.max(bounds.min, Math.min(bounds.max, displayWeight))
                        : bounds.min;
                    showSlider = Number.isFinite(displayWeight) && !target.cardState.manualEditOpen;
                    showValueInput = !Number.isFinite(displayWeight) || target.cardState.manualEditOpen;
                    showValueSpan = Number.isFinite(displayWeight) && !target.cardState.manualEditOpen;
                }

                const isDeltaLocked = !!(isParticipant && target.cardState.deltaLocked);
                const sliderDisabled = readOnly || isDeltaLocked || (usesNormalizeChrome && !isParticipant);

                const card = document.createElement('div');
                card.className = 'emphasis-groups-card';
                if (usesNormalizeChrome) {
                    card.classList.add('emphasis-groups-card-normalize-participant');
                }
                if (isDeltaLocked) {
                    card.classList.add('emphasis-groups-card-delta-locked');
                }
                card.dataset.index = String(index);
                card.dataset.targetKey = target.targetKey;

                const bandDefs = getEmphasisBandDefs(target.cardState.signMode);
                const bandActive = String(target.cardState.weightBand);
                const signNegative = target.cardState.signMode === 'negative';
                const weightDisplay = usesNormalizeChrome
                    ? (this.distributionMode
                        ? formatEmphasisNormalizeDisplay(
                            Number.isFinite(target.cardState.importance) ? target.cardState.importance : EMPHASIS_IMPORTANCE_UNBIASED,
                            displayWeight
                        )
                        : formatEmphasisNormalizeDisplay(target.cardState.share, displayWeight))
                    : formatEmphasisWeightDisplay(displayWeight);
                const snapInfo = this._getSuggestionSnapInfo(index);
                const snapMarkup = snapInfo ? `
                    <button type="button" class="btn-secondary btn-toggle icon-only emphasis-groups-card-snap-suggest"
                        data-snap="${snapInfo.kind}" title="${snapInfo.kind === 'under' ? 'Raise slider to suggested value' : 'Lower slider to suggested value'}">
                        <i class="fas fa-arrow-${snapInfo.kind === 'under' ? 'right' : 'left'}-to-bracket" aria-hidden="true"></i>
                    </button>` : '';
                // canSplitEmphasisGroupAtCommas / canMergeEmphasisGroupWithNeighbor: public/scripts/comp/emphasisParse.js
                const canSplitCommas = !readOnly && target.type === 'group' && canSplitEmphasisGroupAtCommas(target);
                const mergeNeighborIdx = (!readOnly && target.type === 'group')
                    ? findAdjacentEmphasisMergeNeighborIndex(this.textarea.value || '', this.targets, index)
                    : -1;
                const mergeNeighbor = mergeNeighborIdx >= 0 ? this.targets[mergeNeighborIdx] : null;
                const canMergeNeighbor = mergeNeighborIdx >= 0
                    && !!mergeNeighbor
                    && !!mergeNeighbor.managed === !!target.managed
                    && canMergeEmphasisGroupWithNeighbor(
                        this.textarea.value || '',
                        this.targets,
                        index
                    );
                const mergeMarkup = canMergeNeighbor ? `
                    <button type="button" class="btn-secondary btn-toggle icon-only emphasis-groups-card-merge-groups"
                        title="Merge with previous group">
                        <i class="fas fa-arrow-up-to-dotted-line" aria-hidden="true"></i>
                    </button>` : '';
                const splitMarkup = canSplitCommas ? `
                    <button type="button" class="btn-secondary btn-toggle icon-only emphasis-groups-card-split-commas"
                        title="Split at commas into separate groups and normalize">
                        <i class="fas fa-knife-kitchen" aria-hidden="true"></i>
                    </button>` : '';
                const lockMarkup = (this.normalizeEnabled && !this.distributionMode && isParticipant) ? `
                    <button type="button" class="btn-secondary btn-toggle icon-only emphasis-groups-card-delta-lock"
                        data-state="${target.cardState.deltaLocked ? 'on' : 'off'}" title="${target.cardState.deltaLocked ? 'Locked — excluded from share / delta rebalancing and Apply' : 'Lock — exclude from share / delta rebalancing and Apply'}">
                        <i class="fas fa-${target.cardState.deltaLocked ? 'lock' : 'lock-open'}"></i>
                    </button>` : '';

                let ticksMarkup = '';
                if (showSlider) {
                    const ticksList = [];
                    const isShareSlider = (sliderMin === 0 && sliderMax === 100);
                    if (isShareSlider) {
                        if (this.distributionMode) {
                            for (let pct = 15; pct < 100; pct += 15) {
                                ticksList.push({ pct, height: 'half', color: 'default' });
                            }
                        } else {
                            ticksList.push({ pct: 50, height: 'half', color: 'default' });
                        }
                    } else {
                        const min = parseFloat(sliderMin);
                        const max = parseFloat(sliderMax);
                        ticksList.push(...buildEmphasisWeightSliderTicks(min, max));
                    }
                    // --tick-frac (0–1) drives CSS: halfThumb + frac * (100% - thumbW) → thumb center
                    ticksMarkup = ticksList.map(t => {
                        const classList = ['slider-tick'];
                        if (t.height === 'half') classList.push('half-height');
                        if (t.height === 'three-quarter') classList.push('three-quarter-height');
                        if (t.color === 'blue') classList.push('blue-tick');
                        if (t.color === 'green') classList.push('green-tick');
                        if (t.color === 'emphasis') classList.push('emphasis-tick');
                        const frac = Math.max(0, Math.min(1, t.pct / 100));
                        const bg = t.bg ? ` background-color: ${t.bg};` : '';
                        return `<div class="${classList.join(' ')}" style="--tick-frac: ${frac};${bg}"></div>`;
                    }).join('');
                }

                card.innerHTML = `
                <div class="emphasis-groups-card-row">
                    ${typeIcon}
                    <div class="emphasis-text"></div>
                    ${mergeMarkup}
                    ${splitMarkup}
                    ${snapMarkup}
                    ${lockMarkup}
                    <div class="emphasis-groups-card-direct">
                        <button type="button" class="btn-secondary btn-toggle icon-only emphasis-groups-card-sign"
                            data-state="${signNegative ? 'on' : 'off'}" title="${signNegative ? 'Negative weights' : 'Positive weights'}">
                            <i class="fas fa-${signNegative ? 'minus' : 'plus'}"></i>
                        </button>
                    </div>
                </div>
                <div class="emphasis-groups-card-slider-row">
                    <div class="slider-container emphasis-groups-card-value-host">
                        <div class="slider-ticks-container">
                            <input type="range" class="glass-slider emphasis-groups-card-slider${showSlider ? '' : ' hidden'}"
                                min="${sliderMin}" max="${sliderMax}" step="${sliderStep}" value="${sliderVal}"
                                ${sliderDisabled ? 'disabled' : ''}>
                            <div class="slider-ticks${showSlider ? '' : ' hidden'}">
                                ${ticksMarkup}
                            </div>
                        </div>
                        <input type="text" class="slider-value-input emphasis-groups-card-weight-input${showValueInput ? '' : ' hidden'}"
                            value="${weightDisplay}" ${readOnly ? 'disabled' : ''} inputmode="decimal" autocomplete="off" spellcheck="false">
                    </div>
                    <span class="slider-value emphasis-groups-card-weight${showValueSpan ? '' : ' hidden'}" title="${readOnly ? '' : 'Scroll to adjust (Shift for finer steps)'}">${weightDisplay}</span>
                </div>
            `;

                const textEl = card.querySelector('.emphasis-text');
                if (textEl) {
                    const label = String(target.innerText || '').trim();
                    textEl.textContent = label;
                    textEl.title = label;
                }

                const lockBtn = card.querySelector('.emphasis-groups-card-delta-lock');
                const snapBtn = card.querySelector('.emphasis-groups-card-snap-suggest');
                const mergeBtn = card.querySelector('.emphasis-groups-card-merge-groups');
                const splitBtn = card.querySelector('.emphasis-groups-card-split-commas');
                const signBtn = card.querySelector('.emphasis-groups-card-sign');
                const slider = card.querySelector('.emphasis-groups-card-slider');
                const weightEl = card.querySelector('.emphasis-groups-card-weight');
                const weightInput = card.querySelector('.emphasis-groups-card-weight-input');
                const normalizeShare = usesNormalizeChrome
                    ? (this.distributionMode
                        ? (Number.isFinite(target.cardState.importance)
                            ? target.cardState.importance
                            : EMPHASIS_IMPORTANCE_UNBIASED)
                        : target.cardState.share)
                    : null;
                this._setCardWeightDisplay(weightEl, displayWeight, normalizeShare);
                this._setCardWeightDisplay(weightInput, displayWeight, normalizeShare);

                if (mergeBtn && !readOnly) {
                    mergeBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this._mergeGroupWithNeighbor(index);
                    });
                }

                if (splitBtn && !readOnly) {
                    splitBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this._splitGroupAtCommas(index);
                    });
                }

                if (snapBtn && !readOnly) {
                    snapBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this._snapToSuggestion(index);
                    });
                }

                if (lockBtn && !readOnly) {
                    lockBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const locked = lockBtn.getAttribute('data-state') !== 'on';
                        target.cardState.deltaLocked = locked;
                        this.cardStateByKey.set(target.targetKey, target.cardState);
                        this._persistForgeState();
                        this._renderCards();
                    });
                }

                const useDirectControls = !usesNormalizeChrome;

                if (signBtn && !readOnly && useDirectControls) {
                    signBtn.dataset.emphasisWired = '1';
                    signBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        // Toggle signMode first (new value)
                        target.cardState.signMode = target.cardState.signMode === 'positive' ? 'negative' : 'positive';
                        const oldWeight = target.cardState.directWeight ?? target.weight;
                        const ow = Number.isFinite(oldWeight) ? oldWeight : 1;
                        if (target.cardState.signMode === 'negative') {
                            // Positive → negative: keep values already < 1; otherwise flip to −|w|
                            target.cardState.directWeight = ow < 1
                                ? clampEmphasisWeight(ow)
                                : clampEmphasisWeight(-Math.abs(ow));
                        } else {
                            // Negative → positive: positive range starts at 1 (w < 1 auto-negates)
                            const abs = Math.abs(ow) || 1;
                            target.cardState.directWeight = clampEmphasisWeight(abs < 1 ? 1 : abs);
                        }
                        target.cardState.weightBand = inferBandForSign(target.cardState.directWeight, target.cardState.signMode);
                        target.cardState.manualEditOpen = false;
                        this.cardStateByKey.set(target.targetKey, target.cardState);
                        this._renderCards();
                        this._scheduleDirectModeApply();
                    });
                }

                if (weightInput && !readOnly && useDirectControls) {
                    weightInput.dataset.emphasisWired = '1';
                    weightInput.addEventListener('blur', () => {
                        this._commitCardWeightInput(index, target, weightInput);
                    });
                    weightInput.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            weightInput.blur();
                        }
                    });
                }

                if (!readOnly && weightEl && (usesNormalizeChrome ? isParticipant : true)) {
                    weightEl.classList.add('emphasis-groups-card-weight-wheelable');
                    if (!usesNormalizeChrome) {
                        weightEl.addEventListener('click', (e) => {
                            e.stopPropagation();
                            target.cardState.manualEditOpen = true;
                            this.cardStateByKey.set(target.targetKey, target.cardState);
                            this._renderCards();
                            this._focusCardWeightInput(target.targetKey);
                        });
                    }
                }

                if (!readOnly && slider && showSlider) {
                    slider.addEventListener('touchstart', (e) => {
                        e.stopPropagation();
                    }, { passive: true });
                    slider.addEventListener('pointerdown', (e) => {
                        this.isDraggingSlider = true;
                        // Suggested floor while dragging (distribution: 50 unbiased; else suggested-at-pointerdown)
                        this._captureDeltaDragFloor(index);
                        try {
                            slider.setPointerCapture(e.pointerId);
                        } catch (_) { /* ignore */ }
                    });
                    slider.addEventListener('pointerup', (e) => {
                        try {
                            slider.releasePointerCapture(e.pointerId);
                        } catch (_) { /* ignore */ }
                        this._finishSliderDrag(this._isNormalizeParticipant(target));
                    });
                    slider.addEventListener('pointercancel', () => {
                        this._finishSliderDrag(this._isNormalizeParticipant(target));
                    });
                    slider.addEventListener('lostpointercapture', () => {
                        this._flushPendingSliderInput();
                    });
                    slider.addEventListener('input', () => {
                        this._onSliderInput(
                            index,
                            parseFloat(slider.value),
                            weightEl,
                            this._isNormalizeParticipant(target)
                        );
                    });
                    slider.addEventListener('change', () => {
                        this._finishSliderDrag(this._isNormalizeParticipant(target));
                    });
                }

                orderedCards.push({ start: target.start || 0, el: card });
            });
        } // hasTargets

        // Disabled context cards for local unweighted 1.0 portions
        const contextCards = contextCardsEarly;
        this.contextCards = contextCards;
        contextCards.forEach((portion) => {
            const card = document.createElement('div');
            card.className = 'emphasis-groups-card emphasis-groups-card-context';
            card.dataset.virtual = '1';
            const label = String(portion.innerText || '').trim();
            card.innerHTML = `
                <div class="emphasis-groups-card-row">
                    <div class="emphasis-text"></div>
                    <div class="emphasis-groups-card-direct"></div>
                </div>
                <div class="emphasis-groups-card-slider-row emphasis-groups-card-slider-row-context">
                    <div class="slider-container emphasis-groups-card-value-host">
                    </div>
                    <span class="slider-value emphasis-groups-card-weight">${formatEmphasisWeightDisplay(1)}</span>
                </div>
            `;
            const textEl = card.querySelector('.emphasis-text');
            if (textEl) {
                textEl.textContent = label;
                textEl.title = label;
            }
            orderedCards.push({ start: portion.start || 0, el: card });
        });

        orderedCards
            .sort((a, b) => a.start - b.start)
            .forEach((item) => {
                grid.appendChild(item.el);
            });

        const hasAnyCardsEnd = this.targets.length > 0 || contextCards.length > 0;
        if (empty) {
            empty.classList.toggle('hidden', hasAnyCardsEnd);
        }

        const shell = grid.closest('[data-custom-scrollbar]');
        const renderedCount = this.targets.length + contextCards.length;
        const shouldReinitScrollbar = this._lastRenderedTargetCount !== renderedCount
            || this._lastRenderedHadEmpty !== !hasAnyCardsEnd;
        if (shell && customScrollbar && customScrollbar.forceReinit && shouldReinitScrollbar) {
            customScrollbar.forceReinit(shell);
        }
        this._lastRenderedTargetCount = renderedCount;
        this._lastRenderedHadEmpty = !hasAnyCardsEnd;

        const restoreCardsScroll = () => {
            const scrollElAfter = this._getCardsScrollEl();
            if (scrollElAfter) {
                scrollElAfter.scrollTop = savedScrollTop;
            }
        };
        restoreCardsScroll();
        if (shouldReinitScrollbar) {
            requestAnimationFrame(restoreCardsScroll);
        }
        this._updateTitle();
        this._scheduleNotchRefresh({ immediate: true });
    }

    _getCardWheelStep(event, target) {
        if (this.normalizeEnabled && this.distributionMode) {
            return event.shiftKey ? 0.1 : 0.5;
        }
        if (this.normalizeEnabled && this.deltaMode) {
            return event.shiftKey ? EMPHASIS_NORMALIZE_WEIGHT_FINE_STEP : EMPHASIS_NORMALIZE_WEIGHT_STEP;
        }
        if (this.normalizeEnabled) {
            return event.shiftKey ? 0.5 : 1;
        }
        if (event.shiftKey) {
            return EMPHASIS_WEIGHT_FINE_STEP;
        }
        // getEmphasisAdjustStep: public/scripts/comp/emphasisWeightMath.js
        const baseStep = getEmphasisAdjustStep(false);
        if (target && target.type === 'brace') {
            return Math.max(baseStep, EMPHASIS_WEIGHT_STEP);
        }
        return baseStep;
    }

    _nudgeCardDirectWeight(index, delta, target, options = {}) {
        if (this._isReadOnly()) return;
        let newVal;
        if (target && target.type === 'brace') {
            // stepBraceEmphasisWeight: public/scripts/comp/emphasisParse.js
            newVal = stepBraceEmphasisWeight(target.cardState.directWeight, delta > 0 ? 1 : -1);
        } else {
            newVal = clampEmphasisWeight(target.cardState.directWeight + delta);
        }
        target.cardState.directWeight = newVal;
        const inferred = inferEmphasisWeightBand(newVal, target.cardState.signMode);
        target.cardState.signMode = inferred.signMode;
        target.cardState.weightBand = inferred.band;
        this.cardStateByKey.set(target.targetKey, target.cardState);
        this._applyWeightAtIndex(index, newVal, { forceCommit: this.normalizeEnabled });
        if (options.rerender === false) {
            const card = this._refs.grid?.querySelector(`.emphasis-groups-card[data-index="${index}"]`);
            const weightEl = card?.querySelector('.emphasis-groups-card-weight');
            if (weightEl) {
                this._setCardWeightDisplay(weightEl, newVal);
            }
            return;
        }
        this._renderCards();
    }

    _nudgeCardSlider(index, delta, slider, weightEl, target) {
        if (!slider || this._isReadOnly()) return;
        const isParticipant = this._isNormalizeParticipant(target);
        if (this.normalizeEnabled && isParticipant && target.cardState?.deltaLocked) {
            return;
        }

        let newVal;
        if (this.normalizeEnabled && isParticipant && this.deltaMode) {
            newVal = this._clampNormalizeWeight(parseFloat(slider.value) + delta);
            newVal = Math.max(this.minWeight, Math.min(this.maxWeight, newVal));
            slider.value = String(newVal);
        } else if (this.normalizeEnabled && isParticipant && this.distributionMode) {
            let newImp = clampEmphasisShare(parseFloat(slider.value) + delta);
            if (this.isDraggingSlider) {
                newImp = Math.max(EMPHASIS_IMPORTANCE_UNBIASED, newImp);
            }
            newVal = newImp;
            slider.value = String(parseFloat(formatEmphasisShareDisplay(newVal)));
        } else if (this.normalizeEnabled && isParticipant) {
            newVal = clampEmphasisShare(parseFloat(slider.value) + delta);
            slider.value = String(parseFloat(formatEmphasisShareDisplay(newVal)));
        } else {
            const bounds = this._getDirectModeWeightBounds(target);
            newVal = clampEmphasisWeight(parseFloat(slider.value) + delta);
            newVal = Math.max(bounds.min, Math.min(bounds.max, newVal));
            if (target && target.type === 'brace') {
                newVal = snapWeightForBraceMode(newVal);
                newVal = Math.max(bounds.min, Math.min(bounds.max, newVal));
            }
            slider.value = String(newVal);
        }
        this._onSliderInput(index, newVal, weightEl, isParticipant);
    }

    _onSliderInput(index, value, weightEl, isNormalizeParticipant) {
        this._pendingSliderApply = {
            index,
            value,
            weightEl,
            isNormalizeParticipant
        };
        // Direct-mode drag: update label immediately (don't wait for 50ms debounce)
        if (this.isDraggingSlider && (!this.normalizeEnabled || !isNormalizeParticipant)) {
            this._previewDirectModeWeight(index, value, weightEl);
        }
        clearTimeout(this._applyTimer);
        this._applyTimer = setTimeout(() => {
            this._flushPendingSliderInput();
        }, 50);
    }

    _applyFromShares() {
        const active = this.getActiveIndices();
        // Map unlocked shares only — locked keep prompt weight via deltaLocked branch below
        const weighting = this._getWeightingIndices();
        if (this.distributionMode) {
            this._syncDistributionSharesFromImportance(active);
        }
        const weights = this.distributionMode
            ? this._getNormalizeDisplayWeights()
            : sharesToWeights(
                this.shares,
                this.minWeight,
                this.maxWeight,
                weighting.length ? weighting : active,
                this._getNormalizeWeightOptions()
            );
        const weightByStart = new Map();
        this.targets.forEach((target, i) => {
            let weight;
            if (target.cardState?.deltaLocked) {
                weight = this._targetWeightForNormalize(target);
            } else if (this._isNormalizeParticipant(target) && weights[i] !== undefined) {
                weight = weights[i];
                if (target.type === 'brace') {
                    weight = snapWeightForBraceMode(weight);
                }
            } else {
                weight = this._targetWeightForNormalize(target);
            }
            weightByStart.set(target.start, weight);
        });
        this._applyWeights(weightByStart, { commitNormalize: true });
    }

    _applyWeightAtIndex(index, weight, options = {}) {
        const target = this.targets[index];
        if (!target) return;
        const weightByStart = new Map([[target.start, weight]]);
        this._applyWeights(weightByStart, options);
    }

    _applyWeights(weightLookup, options = {}) {
        if (!weightLookup?.size || this._isReadOnly()) return;
        if (this.normalizeEnabled && !options.commitNormalize && !options.forceRestore && !options.directModeCommit && !options.forceCommit) return;

        this.isApplyingFromTool = true;
        try {
            if (this.normalizeEnabled) {
                this.reconcileTargetsFromPrompt({ preserveShares: true });
            } else {
                this.reconcileTargetsFromPrompt();
            }

            const value = this.textarea.value || '';
            const weightByStart = new Map();
            const managedUpdates = [];
            this.targets.forEach((target, i) => {
                let w = resolveEmphasisTargetWeightLookup(weightLookup, target, i);
                if (w === undefined && weightLookup.has && weightLookup.has(i)) {
                    w = weightLookup.get(i);
                }
                if (w === undefined) return;
                if (target.managed && target.managedId != null) {
                    managedUpdates.push({ id: target.managedId, weight: w });
                    target.weight = w;
                    target.cardState.directWeight = w;
                    this.cardStateByKey.set(target.targetKey, target.cardState);
                } else {
                    weightByStart.set(target.start, w);
                }
            });

            let textChanged = false;
            // Classic / brace first — managed visible rewrite must run on the latest text
            if (weightByStart.size) {
                const applyOpts = this.normalizeEnabled ? { normalizePrecision: true } : {};
                const newValue = applyEmphasisTargetWeights(value, weightByStart, applyOpts);
                if (newValue !== value) {
                    // setTextareaValuePreservingUndo: public/scripts/comp/textareaUtils.js
                    setTextareaValuePreservingUndo(this.textarea, newValue);
                    textChanged = true;
                }
            }

            // writeManagedEmphasisGroupWeightsForTextarea: public/scripts/comp/emphasisGroupIdCodec.js
            if (managedUpdates.length) {
                writeManagedEmphasisGroupWeightsForTextarea(this.textarea, managedUpdates);
            }

            if (!textChanged && !managedUpdates.length) return;

            if (textChanged || managedUpdates.length) {
                // dispatchPromptTextareaInputEvent: public/scripts/comp/textareaUtils.js
                dispatchPromptTextareaInputEvent(this.textarea, { skipAutofill: true });
            }
            if (updateEmphasisHighlighting) {
                updateEmphasisHighlighting(this.textarea);
            }
            if (promptTextareaToolbar) {
                promptTextareaToolbar.updateTokenCount(this.textarea);
            }
            if (managedUpdates.length) {
                this.reconcileTargetsFromPrompt({ syncFromPrompt: true, preserveShares: this.normalizeEnabled });
                this._persistForgeState();
                this._renderCards();
            }
        } finally {
            this.isApplyingFromTool = false;
        }
    }

    /**
     * Discard unapplied normalize slider/range edits — re-encode from live prompt weights.
     */
    _revertNormalizeToPrompt() {
        if (!this.normalizeEnabled) return;
        const active = this.getActiveIndices();
        if (!active.length) return;
        this._initSharesFromWeights(active);
        if (this.distributionMode) {
            active.forEach((i) => {
                const target = this.targets[i];
                if (!target) return;
                const share = this.shares[i] ?? target.cardState.share ?? 0;
                target.cardState.importance = this._importanceFromShare(share, active.length);
                this.cardStateByKey.set(target.targetKey, target.cardState);
            });
        }
        this._distributionStash = null;
        this._distributionApplied = false;
        this._persistForgeState();
        this._updateNormalizeToolbar();
        this._renderCards();
        this._scheduleNotchRefresh();
    }

    async close() {
        this._flushDirectModeApply();
        if (this._closePromptOpen) return;
        if (this.normalizeEnabled && this._hasUnappliedNormalizeChanges()) {
            this._closePromptOpen = true;
            try {
                // showConfirmationDialog: public/scripts/comp/confirmationDialog.js
                const result = await showConfirmationDialog(
                    '<p>Normalize changes are not applied to the prompt yet.</p>',
                    [
                        { text: 'Apply', value: 'apply', className: 'btn-primary', icon: 'fas fa-check', primary: true },
                        { text: 'Revert', value: 'revert', className: 'btn-secondary', icon: 'fas fa-rotate-left' },
                        { text: 'Cancel', value: null, className: 'btn-secondary' }
                    ],
                    null,
                    { title: 'Unapplied Changes', icon: 'fas fa-weight-scale' }
                );
                if (result == null || result === false) return;
                if (result === 'apply') {
                    this._applyNormalize();
                } else if (result === 'revert') {
                    this._revertNormalizeToPrompt();
                }
            } finally {
                this._closePromptOpen = false;
            }
        }
        this._forceClose();
    }

    _forceClose() {
        closeModal(this.element).then(() => {
            this.manager.removeInstance(this.id);
        });
    }

    destroy() {
        // Flush pending direct weights regardless of Normalize — non-participants still use the timer.
        if (this._directModeApplyTimer) {
            this._flushDirectModeApply();
        }
        this._unwireKeyboardShortcuts();
        clearTimeout(this._reconcileTimer);
        clearTimeout(this._focusReconcileTimer);
        clearTimeout(this._textareaBlurTimer);
        clearTimeout(this._applyTimer);
        clearTimeout(this._directModeApplyTimer);
        clearTimeout(this._notchRefreshTimer);
        clearTimeout(this._siblingRefreshTimer);
        // contextMenu.detachFromElement: public/scripts/comp/contextMenu.js
        if (typeof contextMenu !== 'undefined' && contextMenu?.detachFromElement) {
            if (this._refs.autoRangeBtn) contextMenu.detachFromElement(this._refs.autoRangeBtn);
            if (this._refs.attentionRescaleBtn) contextMenu.detachFromElement(this._refs.attentionRescaleBtn);
            if (this._refs.applyBtn) contextMenu.detachFromElement(this._refs.applyBtn);
        }
        if (this._onTextareaInput) {
            this.textarea.removeEventListener('input', this._onTextareaInput);
        }
        if (this._onTextareaBlur) {
            this.textarea.removeEventListener('blur', this._onTextareaBlur);
        }
        if (this._onRackPointerDown) {
            this.element.removeEventListener('pointerdown', this._onRackPointerDown, true);
        }
        if (this._onRackPointerUp) {
            this.element.removeEventListener('pointerup', this._onRackPointerUp, true);
            this.element.removeEventListener('pointercancel', this._onRackPointerUp, true);
        }
        if (this._onFocusIn) {
            this.element.removeEventListener('focusin', this._onFocusIn);
        }
        if (this._onFocusOut) {
            this.element.removeEventListener('focusout', this._onFocusOut);
        }
        if (this._onWindowBrowserFocus) {
            window.removeEventListener('focus', this._onWindowBrowserFocus);
            document.removeEventListener('visibilitychange', this._onWindowBrowserFocus);
        }
        if (this._onWindowMousedown) {
            this.element.removeEventListener('mousedown', this._onWindowMousedown);
        }
        if (this.element.parentNode) {
            this.element.parentNode.removeChild(this.element);
        }
    }
}

class EmphasisGroupsToolManager {
    constructor() {
        this.instances = new Map();
        this.byTextareaId = new Map();
        this.nextId = 1;
        this.template = null;
    }

    init() {
        this.template = document.getElementById('emphasisGroupsToolTemplate');
        if (!this.template) {
            console.error('Emphasis groups tool template not found');
        }
    }

    updateElementIds(element, instanceId) {
        const elementsWithIds = element.querySelectorAll('[id]');
        elementsWithIds.forEach((el) => {
            el.id = `${el.id}_${instanceId}`;
        });
    }

    calculateTileOffset() {
        const existing = Array.from(this.instances.values());
        const tileX = 32;
        const tileY = 32;
        const index = existing.length;
        return { x: index * tileX, y: index * tileY };
    }

    getInstanceByTextareaId(textareaId) {
        const instanceId = this.byTextareaId.get(textareaId);
        if (!instanceId) return null;
        return this.instances.get(instanceId) || null;
    }

    openForTextarea(textarea) {
        if (!textarea || !this.template) return null;

        const textareaId = textarea.id || `__emphasis_tool_${this.nextId}`;
        const existing = this.getInstanceByTextareaId(textareaId);
        if (existing && existing.element && document.body.contains(existing.element)) {
            // addResizeHandles: public/scripts/comp/modalUtils.js
            if (!existing.element.querySelector('.resize-handle')) {
                addResizeHandles(existing.element);
            }
            const el = existing.element;
            const wasMinimised = el.classList.contains('minimised');
            const wasHidden = el.classList.contains('hidden') || el.classList.contains('hidden-alt');
            const wasClosing = el.classList.contains('closing');

            if (wasHidden || wasClosing) {
                if (wasClosing) {
                    el.classList.remove('closing');
                }
                openModal(el);
            } else if (wasMinimised) {
                // activateTaskbarWindowEntry: public/scripts/comp/modalUtils.js
                if (typeof activateTaskbarWindowEntry === 'function') {
                    activateTaskbarWindowEntry(el.id);
                } else {
                    openModal(el);
                }
            } else if (bringModalToFront) {
                bringModalToFront(el);
            } else {
                openModal(el);
            }
            existing.cardStateByKey.clear();
            existing.reconcileTargetsFromPrompt({ syncFromPrompt: true });
            existing._loadForgeState();
            existing._renderCards();
            return existing;
        }

        const instanceId = `emphasisGroupsTool_${this.nextId++}`;
        const element = this.template.cloneNode(true);
        element.id = instanceId;
        // Keep .hidden until openModal — openModal skips restore when the window is already visible
        this.updateElementIds(element, instanceId);

        const windowKey = buildEmphasisGroupsWindowKey(textarea);
        element.dataset.windowIdentifier = windowKey;
        // transientWindowsWithPositions: public/scripts/comp/modalUtils.js
        if (typeof transientWindowsWithPositions !== 'undefined' && transientWindowsWithPositions?.add) {
            transientWindowsWithPositions.add(windowKey);
        }

        const hasSavedPosition = windowKey
            && typeof globalWindowPositions !== 'undefined'
            && globalWindowPositions[windowKey]?.topLeft;
        if (!hasSavedPosition) {
            const offset = this.calculateTileOffset();
            element.style.setProperty('--modal-offset-x', `${offset.x}px`);
            element.style.setProperty('--modal-offset-y', `${offset.y}px`);
        }

        document.body.appendChild(element);

        const instance = new EmphasisGroupsToolInstance(instanceId, element, textarea, this);

        // addResizeHandles: public/scripts/comp/modalUtils.js (openModal restores size/position when saved)
        if (!element.querySelector('.resize-handle')) {
            addResizeHandles(element);
        }

        this.instances.set(instanceId, instance);
        if (textareaId) {
            this.byTextareaId.set(textareaId, instanceId);
        }
        // debouncedUpdateTaskbarWindows: public/scripts/comp/modalUtils.js
        if (typeof debouncedUpdateTaskbarWindows === 'function') {
            debouncedUpdateTaskbarWindows();
        }
        return instance;
    }

    removeInstance(instanceId) {
        const instance = this.instances.get(instanceId);
        if (!instance) return;
        if (instance.textareaId) {
            const mapped = this.byTextareaId.get(instance.textareaId);
            if (mapped === instanceId) {
                this.byTextareaId.delete(instance.textareaId);
            }
        }
        instance.destroy();
        this.instances.delete(instanceId);
        // debouncedUpdateTaskbarWindows: public/scripts/comp/modalUtils.js
        if (typeof debouncedUpdateTaskbarWindows === 'function') {
            debouncedUpdateTaskbarWindows();
        }
    }
}

const emphasisGroupsToolManager = new EmphasisGroupsToolManager();

if (typeof wsClient !== 'undefined' && wsClient.registerInitStep) {
    wsClient.registerInitStep(36, 'Initializing emphasis groups tool', async () => {
        emphasisGroupsToolManager.init();
    });
} else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => emphasisGroupsToolManager.init());
} else {
    emphasisGroupsToolManager.init();
}
