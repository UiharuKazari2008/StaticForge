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

function readEmphasisNormalizationFieldState(fieldKey) {
    if (!fieldKey) return null;
    const store = getEmphasisNormalizationFieldStore();
    const state = store[fieldKey];
    return state && typeof state === 'object' ? state : null;
}

function writeEmphasisNormalizationFieldState(fieldKey, state) {
    if (!fieldKey) return;
    const store = getEmphasisNormalizationFieldStore();
    if (!state || !state.enabled) {
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
    }
}

function loadEmphasisNormalizationFromForgeData(forgeData) {
    const store = getEmphasisNormalizationFieldStore();
    Object.keys(store).forEach((key) => delete store[key]);
    const incoming = forgeData && forgeData.emphasis_normalization;
    if (!incoming || typeof incoming !== 'object') {
        syncEmphasisNormalizationPreviewMetadata();
        refreshEmphasisGroupsToolInstancesFromForgeState();
        return;
    }
    Object.entries(incoming).forEach(([fieldKey, state]) => {
        if (state && typeof state === 'object' && state.enabled) {
            store[fieldKey] = { ...state };
        }
    });
    syncEmphasisNormalizationPreviewMetadata();
    refreshEmphasisGroupsToolInstancesFromForgeState();
}

function lookupEmphasisSavedKeyEntry(store, target) {
    if (!store || typeof store !== 'object' || !target) return undefined;
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
        instance.reconcileTargetsFromPrompt();
        instance._loadForgeState();
        instance._renderCards();
    });
}

function applyEmphasisNormalizationStateToPrompt(textarea) {
    const fieldKey = getEmphasisNormalizationFieldKey(textarea);
    const saved = readEmphasisNormalizationFieldState(fieldKey);
    if (!saved || !saved.enabled) return false;

    const value = textarea.value || '';
    const targets = listAllEmphasisTargets(value);
    if (!targets.length) return false;

    const minWeight = clampEmphasisWeightNormalize(saved.minWeight ?? 1);
    const maxWeight = clampEmphasisWeightNormalize(saved.maxWeight ?? 2);
    const scopeMode = saved.scopeMode === 'selected' ? 'selected' : 'all';
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
        if (scopeMode === 'selected') {
            const card = lookupEmphasisSavedKeyEntry(saved.cards, target);
            if (card && card.selected === false) return false;
        }
        return true;
    });

    const weighting = active.filter((i) => {
        const card = lookupEmphasisSavedKeyEntry(saved.cards, targets[i]);
        return !(card && card.deltaLocked);
    });

    const weights = sharesToWeights(shares, minWeight, maxWeight, weighting, opts);
    const weightByStart = new Map();
    targets.forEach((target, i) => {
        let weight = target.weight;
        if (weighting.includes(i) && weights[i] !== undefined) {
            weight = weights[i];
            if (target.type === 'brace') {
                weight = snapWeightForBraceMode(weight);
            }
        }
        weightByStart.set(target.start, weight);
    });

    if (!weightByStart.size) return false;
    const newValue = applyEmphasisTargetWeights(value, weightByStart, opts);
    if (newValue === value) return false;

    // setTextareaValuePreservingUndo: public/scripts/comp/textareaUtils.js
    setTextareaValuePreservingUndo(textarea, newValue);
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
        if (!instance.normalizeEnabled) {
            instance._flushDirectModeApply();
        }
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
        { min: -2, max: 0, label: '−2–0' },
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

function inferEmphasisWeightBand(weight) {
    const w = clampEmphasisWeight(weight);
    if (w < 0) {
        return { signMode: 'negative', band: inferBandForSign(w, 'negative') };
    }
    return { signMode: 'positive', band: inferBandForSign(w, 'positive') };
}

function getEmphasisCardTypeIcon(target) {
    if (target.type === 'group') return '';
    if (target.braceKind === 'bracket') {
        return '<i class="fas fa-brackets-square emphasis-groups-type-icon mode-normal" title="Bracket"></i>';
    }
    return '<i class="fas fa-brackets-curly emphasis-groups-type-icon mode-brace" title="Brace"></i>';
}

function updateCardSelectBtn(btn, selected) {
    if (!btn) return;
    btn.setAttribute('data-state', selected ? 'on' : 'off');
    btn.title = selected ? 'Included in normalization' : 'Excluded from normalization';
    const icon = btn.querySelector('i');
    if (icon) {
        icon.className = selected ? 'fas fa-check' : 'far fa-square';
    }
}

function cardSelectedDatasetValue(scopeMode, selected) {
    return (scopeMode === 'selected' && selected) ? 'on' : 'off';
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
        this.cardStateByKey = new Map();
        this.normalizeEnabled = false;
        this.minWeight = 1;
        this.maxWeight = 2;
        this.scopeMode = 'all';
        this.deltaMode = false;
        this.distributionMode = false;
        this.autoBandEnabled = false;
        this.attentionRescaleEnabled = false;
        this.preNormalizeWeights = new Map();
        this.preNormalizeWeightsByKey = {};

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
        this.reconcileTargetsFromPrompt();
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
        const preview = sharesToWeights(
            this.shares,
            this.minWeight,
            this.maxWeight,
            weighting,
            this._getNormalizeWeightOptions()
        );
        for (const i of weighting) {
            const target = this.targets[i];
            if (!target) continue;
            const promptW = this._clampNormalizeWeight(this._targetWeightForNormalize(target));
            const previewW = preview[i];
            if (previewW === undefined) continue;
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
            this._refs.scopeBtn.addEventListener('click', () => {
                const selectedOnly = this._refs.scopeBtn.getAttribute('data-state') !== 'on';
                this.scopeMode = selectedOnly ? 'selected' : 'all';
                this._refs.scopeBtn.setAttribute('data-state', selectedOnly ? 'on' : 'off');
                if (this.normalizeEnabled) {
                    this._persistForgeState();
                }
                this._renderCards();
            });
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
                next = this._clampDirectModeWeight(next);
                if (target.type === 'brace') {
                    next = snapWeightForBraceMode(next);
                    next = this._clampDirectModeWeight(next);
                }
                target.cardState.directWeight = next;
                const inferred = inferEmphasisWeightBand(next);
                target.cardState.signMode = inferred.signMode;
                target.cardState.weightBand = inferred.band;
                this.cardStateByKey.set(target.targetKey, target.cardState);
                const bounds = this._getDirectModeWeightBounds();
                if (slider) {
                    slider.min = String(bounds.min);
                    slider.max = String(bounds.max);
                    slider.value = String(next);
                }
                this._setCardWeightDisplay(weightEl, next);
                this._scheduleDirectModeApply();
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

        if (!this.normalizeEnabled) {
            if (this.isDraggingSlider) {
                this._previewDirectModeWeight(index, value, weightEl);
            } else {
                this._commitDirectModeWeight(index, value, weightEl);
            }
            return;
        }

        const cardState = this.targets[index].cardState;
        const bounds = getEmphasisWeightBandBounds(cardState.signMode, cardState.weightBand);
        let weight = clampEmphasisWeight(value);
        weight = Math.max(bounds.min, Math.min(bounds.max, weight));
        if (this.targets[index].type === 'brace') {
            weight = snapWeightForBraceMode(weight);
            weight = Math.max(bounds.min, Math.min(bounds.max, weight));
        }
        cardState.directWeight = weight;
        this.cardStateByKey.set(this.targets[index].targetKey, cardState);
        if (weightEl) {
            this._setCardWeightDisplay(weightEl, weight);
        }
        this._applyWeightAtIndex(index, weight);
    }

    _finishSliderDrag(isParticipant) {
        clearTimeout(this._finishSliderTimer);
        this._finishSliderTimer = setTimeout(() => {
            this.isDraggingSlider = false;
            this._flushPendingSliderInput();
            if (this.normalizeEnabled && isParticipant) {
                return;
            }
            if (!this.normalizeEnabled) {
                return;
            }
            if (!isParticipant) {
                this.reconcileTargetsFromPrompt();
                this._renderCards();
            }
        }, 0);
    }

    _adjustNormalizeRange(field, delta) {
        if (this.normalizeEnabled && this.autoBandEnabled) return;
        if (!this.normalizeEnabled && field === 'min') return;
        const oldMin = this.minWeight;
        const oldMax = this.maxWeight;
        if (field === 'min') {
            this.minWeight = clampEmphasisWeight(this.minWeight + delta);
            if (this.minWeight > this.maxWeight) {
                this.maxWeight = this.minWeight;
            }
        } else {
            this.maxWeight = clampEmphasisWeight(this.maxWeight + delta);
            if (this.maxWeight < this.minWeight) {
                this.minWeight = this.maxWeight;
            }
        }
        this._syncNormalizeRangeInputs();
        if (this.normalizeEnabled) {
            this._afterNormalizeRangeChange(oldMin, oldMax);
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
            this._afterNormalizeRangeChange(oldMin, oldMax);
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
            this._afterNormalizeRangeChange(oldMin, oldMax);
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

    _setDistributionMode(enabled) {
        this.distributionMode = !!enabled;
        if (this.distributionMode) {
            this.deltaMode = false;
        }
        const active = this.getActiveIndices();
        if (active.length) {
            this._preserveSharePrecision(active);
        }
        this._syncModeToggleButtons();
        this._persistForgeState();
        this._renderCards();
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
     * When min/max range changes, re-encode share sliders from preview weights at the OLD range
     * so the same weights apply at the NEW range (avoids dropping importance when min lowers to 1).
     * Only call from explicit range-change paths — not mode toggles or segment responses.
     */
    _preserveSharesForRangeChange(oldMin, oldMax) {
        if (!this.normalizeEnabled) return;
        if (oldMin === this.minWeight && oldMax === this.maxWeight) return;
        const active = this.getActiveIndices();
        if (!active.length) return;
        const opts = this._getNormalizeWeightOptions();
        const weighting = this._getWeightingIndices();
        const weights = this.deltaMode
            ? this._getParticipantWeights(active)
            : sharesToWeights(
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

    _afterNormalizeRangeChange(oldMin, oldMax) {
        if (!this.normalizeEnabled) return;
        if (oldMin === this.minWeight && oldMax === this.maxWeight) return;
        const active = this.getActiveIndices();
        if (!active.length) return;
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

    _getAutoDistribution(activeIndices) {
        const active = activeIndices && activeIndices.length ? activeIndices : this.getActiveIndices();
        return computeEmphasisAutoDistribution(this.targets, active, { textarea: this.textarea });
    }

    _applyAutoDistributionShares(weighting, dist) {
        // relativeImportances: public/scripts/comp/emphasisWeightMath.js — attention-equalized ranks
        const relative = Array.isArray(dist.relativeImportances) ? dist.relativeImportances : dist.importances;
        weighting.forEach((i, rank) => {
            const target = this.targets[i];
            if (!target) return;
            const share = clampEmphasisShare(relative[rank] ?? 0);
            this.shares[i] = share;
            target.cardState.share = share;
            this.cardStateByKey.set(target.targetKey, target.cardState);
        });
        this._preserveSharePrecision(weighting);
    }

    _attachAutomaticScalingMenu(button, kind) {
        if (!button || typeof contextMenu === 'undefined' || !contextMenu?.attachToElement) return;
        // contextMenu.attachToElement / detachFromElement: public/scripts/comp/contextMenu.js
        contextMenu.detachFromElement(button);
        const isBand = kind === 'autoBand';
        contextMenu.attachToElement(button, {
            sections: [
                {
                    type: 'list',
                    items: [
                        {
                            text: 'Enable Automatic Scaling',
                            icon: 'fas fa-bolt',
                            action: 'enable',
                            showIndicator: true,
                            loadfn: (item) => {
                                item.checked = isBand ? !!this.autoBandEnabled : !!this.attentionRescaleEnabled;
                            }
                        },
                        {
                            text: 'Disable Automatic Scaling',
                            icon: 'fas fa-ban',
                            action: 'disable',
                            showIndicator: true,
                            loadfn: (item) => {
                                item.checked = isBand ? !this.autoBandEnabled : !this.attentionRescaleEnabled;
                            }
                        }
                    ]
                }
            ],
            onAction: (action) => {
                if (action === 'enable') {
                    if (isBand) this._setAutoBandEnabled(true);
                    else this._setAttentionRescaleEnabled(true);
                } else if (action === 'disable') {
                    if (isBand) this._setAutoBandEnabled(false);
                    else this._setAttentionRescaleEnabled(false);
                }
            }
        });
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

    /** Auto Band only — min→1, max = NAI-safe ideal top from distribution. */
    _runAutoBand(options = {}) {
        if (!this.normalizeEnabled && !options.allowDirect) return false;
        const active = this.getActiveIndices();
        if (!active.length) return false;
        const weighting = this._getWeightingIndices();
        const indices = weighting.length ? weighting : active;
        const dist = this._getAutoDistribution(indices);

        const oldMin = this.minWeight;
        const oldMax = this.maxWeight;
        this.minWeight = 1;
        // resolveIdealMaxWeightFromDistribution: public/scripts/comp/emphasisWeightMath.js
        this.maxWeight = Math.max(1, resolveIdealMaxWeightFromDistribution(dist, indices));
        this._syncNormalizeRangeInputs(true);
        this._syncAutoBandRangeUi();

        if (this.normalizeEnabled) {
            this._afterNormalizeRangeChange(oldMin, oldMax);
            if (this.distributionMode || this.deltaMode) {
                this._applyFromShares();
            }
            this._persistForgeState();
            this._updateNormalizeToolbar();
            this._renderCards();
        } else {
            this._updateNormalizeToolbar();
            this._renderCards();
        }
        return true;
    }

    /** Attention Rescale only — rewrite unlocked shares from equalized ranks. */
    _runAttentionRescale(options = {}) {
        if (!this.normalizeEnabled) return false;

        const active = this.getActiveIndices();
        if (!active.length) return false;
        const weighting = this._getWeightingIndices();
        if (!weighting.length) return false;

        const dist = this._getAutoDistribution(weighting);
        this._applyAutoDistributionShares(weighting, dist);
        this._updateParticipantShareUI(active);

        if (this.distributionMode || this.deltaMode || options.apply) {
            this._applyFromShares();
        }

        this._persistForgeState();
        this._updateNormalizeToolbar();
        this._renderCards();
        return true;
    }

    /** Normalize OFF — one-shot band + attention rescale into prompt weights. */
    _runCombinedOneShot() {
        if (this.normalizeEnabled) return;
        const indices = this.targets
            .map((t, i) => (isEligibleForEmphasisNormalize(t.weight) ? i : -1))
            .filter((i) => i >= 0);
        if (!indices.length) return;

        const dist = computeEmphasisAutoDistribution(this.targets, indices, { textarea: this.textarea });
        // resolveIdealMaxWeightFromDistribution: public/scripts/comp/emphasisWeightMath.js
        const topWeight = Math.max(1, resolveIdealMaxWeightFromDistribution(dist, indices));
        this.minWeight = 1;
        this.maxWeight = topWeight;
        this._syncNormalizeRangeInputs(true);

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
        this.reconcileTargetsFromPrompt();
        this._updateNormalizeToolbar();
        this._renderCards();
    }

    _maybeRunLiveAutos() {
        if (!this.normalizeEnabled) return false;
        if (!this.autoBandEnabled && !this.attentionRescaleEnabled) return false;
        if (this.isApplyingFromTool || this.isDraggingSlider) return false;

        const oldMin = this.minWeight;
        const oldMax = this.maxWeight;

        if (this.autoBandEnabled && this.attentionRescaleEnabled) {
            const active = this.getActiveIndices();
            const weighting = this._getWeightingIndices();
            if (!weighting.length) return false;
            const dist = this._getAutoDistribution(weighting);
            this.minWeight = 1;
            this.maxWeight = Math.max(1, resolveIdealMaxWeightFromDistribution(dist, weighting));
            this._syncNormalizeRangeInputs(true);
            this._syncAutoBandRangeUi();
            this._applyAutoDistributionShares(weighting, dist);
            this._updateParticipantShareUI(active);
            if (this.distributionMode || this.deltaMode) {
                this._applyFromShares();
            }
            this._persistForgeState();
            this._updateNormalizeToolbar();
            if (!this._shouldDeferCardRender()) {
                this._renderCards();
            }
            return true;
        }

        if (this.autoBandEnabled) {
            this._runAutoBand({ live: true, oldMin, oldMax });
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
        if (this.distributionMode) return;

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

        // relativeImportances: public/scripts/comp/emphasisWeightMath.js — % among weighted groups (sum ~100)
        const relative = Array.isArray(dist.relativeImportances) ? dist.relativeImportances : dist.importances;
        weighting.forEach((i, rank) => {
            const target = this.targets[i];
            if (!target) return;
            const share = clampEmphasisShare(relative[rank] ?? 0);
            this.shares[i] = share;
            target.cardState.share = share;
            this.cardStateByKey.set(target.targetKey, target.cardState);
        });
        this._preserveSharePrecision(weighting);
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
        this.reconcileTargetsFromPrompt();
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

    _getDirectModeWeightBounds() {
        const weights = this.targets
            .map((t) => t.cardState?.directWeight ?? t.weight)
            .filter((w) => w !== '---' && Number.isFinite(w));
        if (!weights.length) {
            const max = Math.max(this.maxWeight, 2);
            return { min: 1, max };
        }
        const lowest = Math.min(...weights);
        const highest = Math.max(...weights);
        let min = clampEmphasisWeight(lowest);
        let max = Math.max(this.maxWeight, clampEmphasisWeight(highest));
        if (max <= min) {
            max = clampEmphasisWeight(min + EMPHASIS_NORMALIZE_RANGE_STEP);
        }
        return { min, max };
    }

    _clampDirectModeWeight(weight, bounds) {
        let w = clampEmphasisWeight(weight);
        const b = bounds || this._getDirectModeWeightBounds();
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
        if (this.normalizeEnabled || this._isReadOnly()) return;

        const weightByStart = new Map();
        this.targets.forEach((target, index) => {
            const w = target.cardState?.directWeight;
            if (w === '---' || !Number.isFinite(w)) return;
            weightByStart.set(target.start, w);
        });
        if (!weightByStart.size) return;

        this._applyWeights(weightByStart, { directModeCommit: true });
        this._syncDirectModeMaxFromTargets();
        this._updateAllDirectModeSliders();
    }

    _previewDirectModeWeight(index, weight, weightEl) {
        const target = this.targets[index];
        if (!target) return;
        let w = this._clampDirectModeWeight(weight);
        if (target.type === 'brace') {
            w = snapWeightForBraceMode(w);
            w = this._clampDirectModeWeight(w);
        }
        if (weightEl) {
            this._setCardWeightDisplay(weightEl, w);
        }
    }

    _commitDirectModeWeight(index, weight, weightEl, options = {}) {
        const target = this.targets[index];
        if (!target) return;
        let w = this._clampDirectModeWeight(weight);
        if (target.type === 'brace') {
            w = snapWeightForBraceMode(w);
            w = this._clampDirectModeWeight(w);
        }
        target.cardState.directWeight = w;
        const inferred = inferEmphasisWeightBand(w);
        target.cardState.signMode = inferred.signMode;
        target.cardState.weightBand = inferred.band;
        target.cardState.manualEditOpen = false;
        this.cardStateByKey.set(target.targetKey, target.cardState);
        this._syncDirectModeMaxFromTargets();
        if (options.rerender !== false) {
            this._updateAllDirectModeSliders();
        } else if (weightEl) {
            this._setCardWeightDisplay(weightEl, w);
            const card = weightEl.closest('.emphasis-groups-card');
            const slider = card?.querySelector('.emphasis-groups-card-slider');
            if (slider) {
                const bounds = this._getDirectModeWeightBounds();
                slider.min = String(bounds.min);
                slider.max = String(bounds.max);
                slider.value = String(w);
            }
        }
        this._scheduleDirectModeApply();
    }

    _updateAllDirectModeSliders() {
        if (this.normalizeEnabled) return;
        const bounds = this._getDirectModeWeightBounds();
        const grid = this._refs.grid;
        if (!grid) return;

        this.targets.forEach((target, i) => {
            const card = grid.querySelector(`.emphasis-groups-card[data-index="${i}"]`);
            if (!card) return;
            const slider = card.querySelector('.emphasis-groups-card-slider');
            const weightEl = card.querySelector('.emphasis-groups-card-weight');
            const w = target.cardState?.directWeight ?? target.weight;
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
        });
    }

    _isNormalizeParticipant(target) {
        if (!this.normalizeEnabled) return false;
        if (!this._isEligibleForNormalizeTarget(target)) return false;
        if (this.scopeMode === 'selected' && !target.cardState.selected) return false;
        return true;
    }

    _usesNormalizeCardChrome(target) {
        return this.normalizeEnabled && this._isEligibleForNormalizeTarget(target);
    }

    _getNormalizeWeightOptions() {
        return { normalizePrecision: true, directRangeMapping: true };
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
        const clampedWeight = this._clampNormalizeWeight(value);

        if (this.targets[index]?.cardState?.deltaLocked) {
            return;
        }

        const currentWeights = this._getParticipantWeights(active);
        let newWeights;
        if (adjustable.length > 1 && adjustable.includes(index)) {
            const locked = this._getDeltaLockedIndices();
            const sectionLengths = this._getDeltaSectionLengths(active);
            // rebalanceEmphasisWeightsByDelta: public/scripts/comp/emphasisParse.js
            newWeights = rebalanceEmphasisWeightsByDelta(currentWeights, index, clampedWeight, active, locked, sectionLengths);
        } else {
            newWeights = currentWeights.slice();
            newWeights[index] = clampedWeight;
        }

        this._syncSharesFromWeights(newWeights, active);
        this._updateParticipantShareUI(active);
        this._persistForgeState();
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
        const clampedShare = clampEmphasisShare(value);
        let newShares;
        if (this.distributionMode) {
            newShares = this.shares.slice();
            newShares[index] = clampedShare;
        } else {
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
        }

        this.shares = newShares;
        active.forEach((i) => {
            const target = this.targets[i];
            if (!target) return;
            target.cardState.share = newShares[i];
            this.cardStateByKey.set(target.targetKey, target.cardState);
        });

        this._updateParticipantShareUI(active);
        this._persistForgeState();
    }

    _updateParticipantShareUI(activeIndices) {
        const active = activeIndices && activeIndices.length ? activeIndices : this.getActiveIndices();
        const weights = this._getNormalizeDisplayWeights();
        const grid = this._refs.grid;
        if (!grid) return;

        active.forEach((i) => {
            this._syncCardNormalizeParticipation(i, { weights, share: this.shares[i], skipSliderWrite: this.isDraggingSlider });
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
        card.dataset.selected = cardSelectedDatasetValue(this.scopeMode, !!target.cardState.selected);

        const selectBtn = card.querySelector('.emphasis-groups-card-select');
        if (selectBtn) {
            updateCardSelectBtn(selectBtn, !!target.cardState.selected);
        }

        const weightEl = card.querySelector('.emphasis-groups-card-weight');
        const weightInput = card.querySelector('.emphasis-groups-card-weight-input');
        const slider = card.querySelector('.emphasis-groups-card-slider');

        if (usesNormalizeChrome) {
            const weights = options.weights || this._getNormalizeDisplayWeights();
            const share = options.share !== undefined
                ? options.share
                : (this.shares[index] ?? target.cardState.share ?? 0);
            const displayWeight = target.cardState.deltaLocked
                ? this._targetWeightForNormalize(target)
                : (isParticipant && weights[index] !== undefined)
                    ? weights[index]
                    : this._targetWeightForNormalize(target);
            const sliderLocked = readOnly || !isParticipant || !!target.cardState.deltaLocked;
            if (slider) {
                slider.classList.remove('hidden');
                slider.disabled = sliderLocked;
                if (!target.cardState.deltaLocked && !options.skipSliderWrite) {
                    if (this.deltaMode) {
                        const w = isParticipant && weights[index] !== undefined ? weights[index] : displayWeight;
                        slider.min = String(this.minWeight);
                        slider.max = String(this.maxWeight);
                        slider.step = String(EMPHASIS_NORMALIZE_WEIGHT_STEP);
                        slider.value = String(this._clampNormalizeWeight(w));
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
                    this._setCardWeightDisplay(weightEl, displayWeight, share);
                }
            }
            if (weightInput) {
                weightInput.classList.add('hidden');
            }
            if (weightEl) {
                weightEl.classList.remove('hidden');
            }
        }
    }

    _applyCardSelectionToggle(index, target, card, selectBtn) {
        const selected = selectBtn.getAttribute('data-state') !== 'on';
        target.cardState.selected = selected;
        updateCardSelectBtn(selectBtn, selected);
        card.dataset.selected = cardSelectedDatasetValue(this.scopeMode, selected);
        this.cardStateByKey.set(target.targetKey, target.cardState);

        if (!this.normalizeEnabled) {
            this._persistForgeState();
            return;
        }

        if (selected) {
            if (target.cardState.share === undefined || target.cardState.share === null) {
                const w = this._targetWeightForNormalize(target);
                const share = clampEmphasisShare(
                    weightToShare(w, this.minWeight, this.maxWeight, this._getNormalizeWeightOptions())
                );
                target.cardState.share = share;
                this.shares[index] = share;
            } else {
                this.shares[index] = target.cardState.share;
            }
        }

        this._persistForgeState();
        this._syncCardNormalizeParticipation(index);
        this._updateParticipantShareUI(this.getActiveIndices());
        this._updateTitle();
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
        this.element.classList.toggle('emphasis-groups-scope-selected', this.normalizeEnabled && this.scopeMode === 'selected');
        this.element.classList.toggle('emphasis-groups-auto-band-active', this.normalizeEnabled && this.autoBandEnabled);
        if (this._refs.scopeBtn) {
            this._refs.scopeBtn.classList.toggle('hidden', !this.normalizeEnabled);
        }
        if (this._refs.modeGroup) {
            this._refs.modeGroup.classList.toggle('hidden', !this.normalizeEnabled);
        }
        if (this._refs.deltaModeBtn) {
            this._refs.deltaModeBtn.classList.toggle('hidden', !this.normalizeEnabled);
        }
        if (this._refs.distributionModeBtn) {
            this._refs.distributionModeBtn.classList.toggle('hidden', !this.normalizeEnabled);
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
                ? 'Auto Band ON — live top weight from prompt; right-click to disable'
                : 'Auto Band — click for one-shot; right-click for automatic scaling';
        }
        if (this._refs.attentionRescaleBtn) {
            this._refs.attentionRescaleBtn.classList.toggle('hidden', !this.normalizeEnabled);
            this._refs.attentionRescaleBtn.setAttribute('data-state', this.attentionRescaleEnabled ? 'on' : 'off');
            this._refs.attentionRescaleBtn.title = this.attentionRescaleEnabled
                ? 'Attention Rescale ON — live equalize on prompt edits; right-click to disable'
                : 'Attention Rescale — click for one-shot; right-click for automatic scaling';
        }
        this._syncAutoBandRangeUi();

        const showRangeToolbar = this.normalizeEnabled || this.targets.length > 0;
        if (this._refs.normalizeRange) {
            this._refs.normalizeRange.classList.toggle('hidden', !showRangeToolbar);
        }
        const hideMinRange = !this.normalizeEnabled;
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

    _syncNormalizeSelections() {
        this.targets.forEach((target) => {
            if (!this._isEligibleForNormalizeTarget(target)) {
                target.cardState.selected = false;
            } else if (target.cardState.selected === undefined) {
                target.cardState.selected = true;
            }
            this.cardStateByKey.set(target.targetKey, target.cardState);
        });
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
        this.reconcileTargetsFromPrompt();
    }

    _enableNormalize() {
        this._flushDirectModeApply();
        this.reconcileTargetsFromPrompt();
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
        const active = this.getActiveIndices();
        this._initNormalizeFromDirectMode(active);
        this._syncNormalizeSelections();
        this._updateNormalizeToolbar();
        this._persistForgeState();
        this._renderCards();
    }

    _disableNormalize() {
        this.normalizeEnabled = false;
        this.autoBandEnabled = false;
        this.attentionRescaleEnabled = false;
        this._restorePreNormalizeWeights();
        this.preNormalizeWeights = new Map();
        this.preNormalizeWeightsByKey = {};
        this._persistForgeState();
        this._updateNormalizeToolbar();
        this._renderCards();
    }

    _applyNormalize() {
        if (!this.normalizeEnabled) return;
        const opts = this._getNormalizeWeightOptions();
        const weighting = this._getWeightingIndices();
        if (!weighting.length) return;
        const previewWeights = sharesToWeights(
            this.shares,
            this.minWeight,
            this.maxWeight,
            weighting,
            opts
        );
        weighting.forEach((i) => {
            const target = this.targets[i];
            if (!target) return;
            const w = previewWeights[i];
            if (w === undefined) return;
            const share = clampEmphasisShare(weightToShare(w, this.minWeight, this.maxWeight, opts));
            this.shares[i] = share;
            target.cardState.share = share;
            this.cardStateByKey.set(target.targetKey, target.cardState);
        });
        this._applyFromShares();
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
                selected: !!target.cardState.selected,
                deltaLocked: !!target.cardState.deltaLocked
            };
        });

        const percentages = this.targets.map((t, i) => clampEmphasisShare(this.shares[i] ?? t.cardState.share ?? 0));
        const percentagesByKey = {};
        this.targets.forEach((target, i) => {
            percentagesByKey[target.targetKey] = percentages[i];
        });

        if (!this.normalizeEnabled) {
            writeEmphasisNormalizationFieldState(fieldKey, null);
            return;
        }

        writeEmphasisNormalizationFieldState(fieldKey, {
            enabled: true,
            minWeight: this.minWeight,
            maxWeight: this.maxWeight,
            scopeMode: this.scopeMode,
            delta: !!this.deltaMode,
            distribution: !!this.distributionMode,
            deltaMode: !!this.deltaMode,
            autoBand: !!this.autoBandEnabled,
            attentionRescale: !!this.attentionRescaleEnabled,
            percentages,
            percentagesByKey,
            cards: cardMeta,
            preNormalizeWeights: { ...this.preNormalizeWeightsByKey }
        });
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
            this._updateNormalizeToolbar();
            return;
        }

        if (!saved.enabled) {
            this.normalizeEnabled = false;
            this.distributionMode = false;
            this.deltaMode = false;
            this.autoBandEnabled = false;
            this.attentionRescaleEnabled = false;
            this._updateNormalizeToolbar();
            return;
        }

        this.normalizeEnabled = true;
        this.minWeight = this._clampNormalizeWeight(saved.minWeight ?? 1);
        this.maxWeight = this._clampNormalizeWeight(saved.maxWeight ?? 2);
        this.scopeMode = saved.scopeMode === 'selected' ? 'selected' : 'all';
        this.deltaMode = !!(saved.delta ?? saved.deltaMode ?? saved.relativeSharedWeighting);
        this.distributionMode = !!saved.distribution;
        this.autoBandEnabled = !!saved.autoBand;
        this.attentionRescaleEnabled = !!saved.attentionRescale;
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
            this._refs.scopeBtn.setAttribute('data-state', this.scopeMode === 'selected' ? 'on' : 'off');
        }
        if (this._refs.deltaModeBtn) {
            this._refs.deltaModeBtn.setAttribute('data-state', this.deltaMode ? 'on' : 'off');
        }
        if (this._refs.distributionModeBtn) {
            this._refs.distributionModeBtn.setAttribute('data-state', this.distributionMode ? 'on' : 'off');
        }

        this._syncNormalizeSelections();

        this._applySavedCardMeta(saved);

        if (saved.percentagesByKey && typeof saved.percentagesByKey === 'object') {
            this.targets.forEach((target, i) => {
                const pct = lookupEmphasisSavedKeyEntry(saved.percentagesByKey, target);
                if (typeof pct !== 'number') return;
                const share = clampEmphasisShare(pct);
                target.cardState.share = share;
                this.shares[i] = share;
                this.cardStateByKey.set(target.targetKey, target.cardState);
            });
        } else if (Array.isArray(saved.percentages) && saved.percentages.length) {
            saved.percentages.forEach((pct, i) => {
                const target = this.targets[i];
                if (!target) return;
                const share = clampEmphasisShare(pct);
                target.cardState.share = share;
                this.shares[i] = share;
                this.cardStateByKey.set(target.targetKey, target.cardState);
            });
        } else if (saved.cards && typeof saved.cards === 'object') {
            this.targets.forEach((target, i) => {
                const cardSaved = lookupEmphasisSavedKeyEntry(saved.cards, target);
                if (!cardSaved || typeof cardSaved.share !== 'number') return;
                const share = clampEmphasisShare(cardSaved.share);
                target.cardState.share = share;
                this.shares[i] = share;
                this.cardStateByKey.set(target.targetKey, target.cardState);
            });
        }

        const active = this.getActiveIndices();
        if (active.length) {
            const hasShare = active.some((i) => (this.targets[i].cardState.share || 0) > 0);
            if (hasShare) {
                this.shares = this.targets.map((t) => t.cardState.share || 0);
            } else {
                this._syncRangeSharesFromWeights(active);
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

    _applySavedCardMeta(saved) {
        if (!saved || !saved.cards || typeof saved.cards !== 'object') return;
        this.targets.forEach((target) => {
            const cardSaved = lookupEmphasisSavedKeyEntry(saved.cards, target);
            if (!cardSaved) return;
            if (cardSaved.selected !== undefined) {
                target.cardState.selected = !!cardSaved.selected;
            }
            if (cardSaved.deltaLocked !== undefined) {
                target.cardState.deltaLocked = !!cardSaved.deltaLocked;
            } else if (cardSaved.rswLocked !== undefined) {
                target.cardState.deltaLocked = !!cardSaved.rswLocked;
            }
            if (!this._isEligibleForNormalizeTarget(target)) {
                target.cardState.selected = false;
            }
            this.cardStateByKey.set(target.targetKey, target.cardState);
        });
    }

    _getNormalizeDisplayWeights() {
        const active = this.getActiveIndices();
        const weighting = this._getWeightingIndices();
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

    _wireSyncListeners() {
        this._onTextareaInput = () => {
            if (this.isApplyingFromTool || this.isDraggingSlider) return;
            clearTimeout(this._reconcileTimer);
            this._reconcileTimer = setTimeout(() => {
                this.reconcileTargetsFromPrompt({ preserveShares: this.normalizeEnabled });
                const ranLive = this._maybeRunLiveAutos();
                if (!ranLive && !this._shouldDeferCardRender()) {
                    this._renderCards();
                }
            }, 150);
        };
        this.textarea.addEventListener('input', this._onTextareaInput);

        this._onFocusIn = (e) => {
            if (this.isDraggingSlider) return;
            if (this._shouldSkipFocusReconcile(e.target)) return;
            clearTimeout(this._focusReconcileTimer);
            this._focusReconcileTimer = setTimeout(() => {
                if (this.isDraggingSlider) return;
                this.reconcileTargetsFromPrompt({ preserveShares: this.normalizeEnabled });
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
                this.reconcileTargetsFromPrompt({ preserveShares: this.normalizeEnabled });
                if (!this._shouldDeferCardRender()) {
                    this._renderCards();
                }
            }, 0);
        };
        this.element.addEventListener('focusin', this._onFocusIn);
        this.element.addEventListener('focusout', this._onFocusOut);
    }

    getActiveIndices() {
        let indices;
        if (this.scopeMode === 'all') {
            indices = this.targets.map((_, i) => i);
        } else {
            indices = this.targets
                .map((t, i) => (t.cardState && t.cardState.selected ? i : -1))
                .filter((i) => i >= 0);
        }
        if (!this.normalizeEnabled) return indices;
        return indices.filter((i) => this._isEligibleForNormalizeTarget(this.targets[i]));
    }

    _getOrCreateCardState(targetKey, parsedWeight) {
        if (this.cardStateByKey.has(targetKey)) {
            const state = this.cardStateByKey.get(targetKey);
            if (state.signMode === undefined || state.weightBand === undefined) {
                const inferred = inferEmphasisWeightBand(state.directWeight ?? parsedWeight);
                state.signMode = inferred.signMode;
                state.weightBand = inferred.band;
            }
            if (!this.isDraggingSlider && !this.isApplyingFromTool && state.directWeight !== parsedWeight) {
                state.directWeight = parsedWeight;
                const inferred = inferEmphasisWeightBand(parsedWeight);
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
            if (this.normalizeEnabled && !this._isEligibleForNormalizeTarget({ cardState: state, weight: parsedWeight })) {
                state.selected = false;
            }
            return state;
        }
        const inferred = inferEmphasisWeightBand(parsedWeight);
        const state = {
            share: 0,
            directWeight: parsedWeight,
            selected: isEligibleForEmphasisNormalize(parsedWeight),
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
        const freshTargets = listAllEmphasisTargets(value);

        if (prevTargets.length && freshTargets.length) {
            this._remapKeyedStoresByLegacyTargetKey(prevTargets, freshTargets);
        }

        this.targets = freshTargets.map((target) => {
            const targetKey = buildEmphasisTargetKey(target);
            const cardState = this._getOrCreateCardState(targetKey, target.weight);
            return { ...target, targetKey, cardState };
        });

        this.shares = this.targets.map((t) => t.cardState.share);
        if (this.normalizeEnabled) {
            this._syncNormalizeSelections();
            const active = this.getActiveIndices();
            if (!options.preserveShares && options.syncNormalizeShares && !this.isApplyingFromTool && active.length) {
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
            const inferred = inferEmphasisWeightBand(w);
            target.cardState.signMode = inferred.signMode;
            target.cardState.weightBand = inferBandForSign(w, inferred.signMode);
        }
        this.cardStateByKey.set(target.targetKey, target.cardState);
        if (w !== '---') {
            if (!this.normalizeEnabled) {
                this._commitDirectModeWeight(index, w, null, { rerender: options.rerender !== false });
                return;
            }
            this._applyWeightAtIndex(index, w);
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
        const hasTargets = this.targets.length > 0;
        if (empty) {
            empty.classList.toggle('hidden', hasTargets);
        }
        if (!hasTargets) {
            this._lastRenderedTargetCount = 0;
            this._lastRenderedHadEmpty = true;
            return;
        }

        const readOnly = this._isReadOnly();
        const normalizeWeights = this.normalizeEnabled ? this._getNormalizeDisplayWeights() : null;

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
                const bounds = this._getDirectModeWeightBounds();
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
            card.dataset.selected = cardSelectedDatasetValue(this.scopeMode, !!target.cardState.selected);

            const bandDefs = getEmphasisBandDefs(target.cardState.signMode);
            const bandActive = String(target.cardState.weightBand);
            const signNegative = target.cardState.signMode === 'negative';
            const weightDisplay = usesNormalizeChrome
                ? formatEmphasisNormalizeDisplay(target.cardState.share, displayWeight)
                : formatEmphasisWeightDisplay(displayWeight);
            const selectMarkup = (this.normalizeEnabled && normalizeEligible && this.scopeMode === 'selected') ? `
                    <button type="button" class="btn-secondary btn-toggle icon-only emphasis-groups-card-select"
                        data-state="${target.cardState.selected ? 'on' : 'off'}" title="${target.cardState.selected ? 'Included in normalization' : 'Excluded from normalization'}">
                        <i class="${target.cardState.selected ? 'fas fa-check' : 'far fa-square'}"></i>
                    </button>` : '';
            const lockMarkup = (this.normalizeEnabled && !this.distributionMode && isParticipant) ? `
                    <button type="button" class="btn-secondary btn-toggle icon-only emphasis-groups-card-delta-lock"
                        data-state="${target.cardState.deltaLocked ? 'on' : 'off'}" title="${target.cardState.deltaLocked ? 'Locked — excluded from share / delta rebalancing and Apply' : 'Lock — exclude from share / delta rebalancing and Apply'}">
                        <i class="fas fa-${target.cardState.deltaLocked ? 'lock' : 'lock-open'}"></i>
                    </button>` : '';

            card.innerHTML = `
                <div class="emphasis-groups-card-row">
                    ${typeIcon}
                    <div class="emphasis-text"></div>
                    ${selectMarkup}
                    ${lockMarkup}
                    <div class="emphasis-groups-card-direct">
                        <button type="button" class="btn-secondary btn-toggle icon-only emphasis-groups-card-sign"
                            data-state="${signNegative ? 'on' : 'off'}" title="${signNegative ? 'Negative weights' : 'Positive weights'}">
                            <i class="fas fa-${signNegative ? 'minus' : 'plus'}"></i>
                        </button>
                        <div class="gallery-toggle-group emphasis-groups-card-band two-tabs${this.normalizeEnabled ? '' : ' hidden'}" data-active="${bandActive}">
                            <button type="button" class="gallery-toggle-btn${target.cardState.weightBand === 0 ? ' active' : ''}" data-band="0">
                                <span class="tab-text">${bandDefs[0].label}</span>
                            </button>
                            <button type="button" class="gallery-toggle-btn${target.cardState.weightBand === 1 ? ' active' : ''}" data-band="1">
                                <span class="tab-text">${bandDefs[1].label}</span>
                            </button>
                            <div class="gallery-toggle-slider"></div>
                        </div>
                    </div>
                </div>
                <div class="emphasis-groups-card-slider-row">
                    <div class="slider-container emphasis-groups-card-value-host">
                        <input type="range" class="glass-slider emphasis-groups-card-slider${showSlider ? '' : ' hidden'}"
                            min="${sliderMin}" max="${sliderMax}" step="${sliderStep}" value="${sliderVal}"
                            ${sliderDisabled ? 'disabled' : ''}>
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

            const selectBtn = card.querySelector('.emphasis-groups-card-select');
            const lockBtn = card.querySelector('.emphasis-groups-card-delta-lock');
            const signBtn = card.querySelector('.emphasis-groups-card-sign');
            const bandToggle = card.querySelector('.emphasis-groups-card-band');
            const slider = card.querySelector('.emphasis-groups-card-slider');
            const weightEl = card.querySelector('.emphasis-groups-card-weight');
            const weightInput = card.querySelector('.emphasis-groups-card-weight-input');
            const normalizeShare = usesNormalizeChrome ? target.cardState.share : null;
            this._setCardWeightDisplay(weightEl, displayWeight, normalizeShare);
            this._setCardWeightDisplay(weightInput, displayWeight, normalizeShare);

            if (selectBtn && !readOnly) {
                selectBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this._applyCardSelectionToggle(index, target, card, selectBtn);
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
                    target.cardState.signMode = target.cardState.signMode === 'positive' ? 'negative' : 'positive';
                    target.cardState.weightBand = inferBandForSign(target.cardState.directWeight, target.cardState.signMode);
                    target.cardState.manualEditOpen = false;
                    this.cardStateByKey.set(target.targetKey, target.cardState);
                    this._renderCards();
                });
            }

            if (bandToggle && !readOnly && useDirectControls) {
                bandToggle.dataset.emphasisWired = '1';
                bandToggle.querySelectorAll('.gallery-toggle-btn').forEach((btn) => {
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        target.cardState.weightBand = Math.max(0, Math.min(EMPHASIS_BAND_COUNT - 1, parseInt(btn.dataset.band, 10) || 0));
                        target.cardState.manualEditOpen = false;
                        this.cardStateByKey.set(target.targetKey, target.cardState);
                        this._renderCards();
                    });
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

            grid.appendChild(card);
        });

        const shell = grid.closest('[data-custom-scrollbar]');
        const shouldReinitScrollbar = this._lastRenderedTargetCount !== this.targets.length
            || this._lastRenderedHadEmpty !== !hasTargets;
        if (shell && customScrollbar && customScrollbar.forceReinit && shouldReinitScrollbar) {
            customScrollbar.forceReinit(shell);
        }
        this._lastRenderedTargetCount = this.targets.length;
        this._lastRenderedHadEmpty = !hasTargets;

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
        let newVal = clampEmphasisWeight(target.cardState.directWeight + delta);
        if (target && target.type === 'brace') {
            newVal = snapWeightForBraceMode(newVal);
        }
        target.cardState.directWeight = newVal;
        const inferred = inferEmphasisWeightBand(newVal);
        target.cardState.signMode = inferred.signMode;
        target.cardState.weightBand = inferBandForSign(newVal, inferred.signMode);
        this.cardStateByKey.set(target.targetKey, target.cardState);
        this._applyWeightAtIndex(index, newVal);
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
        } else if (this.normalizeEnabled && isParticipant) {
            newVal = clampEmphasisShare(parseFloat(slider.value) + delta);
            slider.value = String(parseFloat(formatEmphasisShareDisplay(newVal)));
        } else {
            const bounds = getEmphasisWeightBandBounds(target.cardState.signMode, target.cardState.weightBand);
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
        clearTimeout(this._applyTimer);
        this._applyTimer = setTimeout(() => {
            this._flushPendingSliderInput();
        }, 50);
    }

    _applyFromShares() {
        const active = this.getActiveIndices();
        // Map unlocked shares only — locked keep prompt weight via deltaLocked branch below
        const weighting = this._getWeightingIndices();
        const weights = sharesToWeights(
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

    _applyWeightAtIndex(index, weight) {
        const target = this.targets[index];
        if (!target) return;
        const weightByStart = new Map([[target.start, weight]]);
        this._applyWeights(weightByStart);
    }

    _applyWeights(weightLookup, options = {}) {
        if (!weightLookup?.size || this._isReadOnly()) return;
        if (this.normalizeEnabled && !options.commitNormalize && !options.forceRestore && !options.directModeCommit) return;

        if (this.normalizeEnabled) {
            this.reconcileTargetsFromPrompt({ preserveShares: true });
        } else {
            this.reconcileTargetsFromPrompt();
        }

        const value = this.textarea.value || '';
        const weightByStart = new Map();
        this.targets.forEach((target, i) => {
            let w = resolveEmphasisTargetWeightLookup(weightLookup, target, i);
            if (w === undefined && weightLookup.has && weightLookup.has(i)) {
                w = weightLookup.get(i);
            }
            if (w !== undefined) {
                weightByStart.set(target.start, w);
            }
        });

        const applyOpts = this.normalizeEnabled ? { normalizePrecision: true } : {};
        const newValue = applyEmphasisTargetWeights(value, weightByStart, applyOpts);
        if (newValue === value) return;

        this.isApplyingFromTool = true;
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
        this.isApplyingFromTool = false;
    }

    close() {
        this._flushDirectModeApply();
        closeModal(this.element).then(() => {
            this.manager.removeInstance(this.id);
        });
    }

    destroy() {
        this._unwireKeyboardShortcuts();
        clearTimeout(this._reconcileTimer);
        clearTimeout(this._focusReconcileTimer);
        clearTimeout(this._applyTimer);
        clearTimeout(this._directModeApplyTimer);
        // contextMenu.detachFromElement: public/scripts/comp/contextMenu.js
        if (typeof contextMenu !== 'undefined' && contextMenu?.detachFromElement) {
            if (this._refs.autoRangeBtn) contextMenu.detachFromElement(this._refs.autoRangeBtn);
            if (this._refs.attentionRescaleBtn) contextMenu.detachFromElement(this._refs.attentionRescaleBtn);
        }
        if (this._onTextareaInput) {
            this.textarea.removeEventListener('input', this._onTextareaInput);
        }
        if (this._onFocusIn) {
            this.element.removeEventListener('focusin', this._onFocusIn);
        }
        if (this._onFocusOut) {
            this.element.removeEventListener('focusout', this._onFocusOut);
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
            existing.reconcileTargetsFromPrompt();
            existing._loadForgeState();
            existing._renderCards();
            return existing;
        }

        const instanceId = `emphasisGroupsTool_${this.nextId++}`;
        const element = this.template.cloneNode(true);
        element.id = instanceId;
        // Keep .hidden until openModal — openModal skips restore when the window is already visible
        this.updateElementIds(element, instanceId);

        const windowKey = element.dataset.windowIdentifier;
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
