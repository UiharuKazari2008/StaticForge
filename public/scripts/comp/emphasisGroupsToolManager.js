// Emphasis Groups Tool — multi-instance tool windows for prompt emphasis editing
// listAllEmphasisTargets, applyEmphasisTargetWeights: public/scripts/comp/emphasisManager.js

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

        this.isApplyingFromTool = false;
        this.isDraggingSlider = false;
        this._reconcileTimer = null;
        this._focusReconcileTimer = null;
        this._applyTimer = null;

        this._refs = {};
        this._bindRefs();
        this._wireControls();
        this._wireSyncListeners();
        this.reconcileTargetsFromPrompt();
        this._renderCards();

        openModal(this.element);

        const parentModal = findParentModalForTextarea(textarea);
        if (parentModal && linkToolWindowToParent) {
            linkToolWindowToParent(this.element, parentModal);
        }
    }

    _bindRefs() {
        const q = (suffix) => this.element.querySelector(`#${suffix}_${this.id}`);
        this._refs.title = q('emphasisGroupsToolTitle');
        this._refs.normalizeBtn = q('emphasisGroupsNormalizeBtn');
        this._refs.normalizeRange = q('emphasisGroupsNormalizeRange');
        this._refs.minWeight = q('emphasisGroupsMinWeight');
        this._refs.maxWeight = q('emphasisGroupsMaxWeight');
        this._refs.scopeBtn = q('emphasisGroupsScopeBtn');
        this._refs.grid = q('emphasisGroupsGrid');
        this._refs.empty = q('emphasisGroupsEmpty');

        if (this._refs.title) {
            this._refs.title.textContent = `Emphasis — ${getPromptFieldLabel(this.textarea)}`;
        }
    }

    _wireControls() {
        const closeBtn = this.element.querySelector('.close-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.close());
        }

        if (this._refs.normalizeBtn) {
            this._refs.normalizeBtn.addEventListener('click', () => {
                this.normalizeEnabled = !this.normalizeEnabled;
                this._refs.normalizeBtn.setAttribute('data-state', this.normalizeEnabled ? 'on' : 'off');
                if (this._refs.normalizeRange) {
                    this._refs.normalizeRange.classList.toggle('hidden', !this.normalizeEnabled);
                }
                this._updateNormalizeToolbar();
                this._renderCards();
            });
        }

        const onRangeChange = () => {
            this.minWeight = clampEmphasisWeight(parseFloat(this._refs.minWeight?.value) || 1);
            this.maxWeight = clampEmphasisWeight(parseFloat(this._refs.maxWeight?.value) || 2);
            if (this.minWeight > this.maxWeight) {
                const tmp = this.minWeight;
                this.minWeight = this.maxWeight;
                this.maxWeight = tmp;
            }
            if (this._refs.minWeight) this._refs.minWeight.value = formatEmphasisWeight(this.minWeight);
            if (this._refs.maxWeight) this._refs.maxWeight.value = formatEmphasisWeight(this.maxWeight);
            if (this.normalizeEnabled) {
                this._applyFromShares();
            }
            this._renderCards();
        };

        if (this._refs.minWeight) {
            this._refs.minWeight.addEventListener('change', onRangeChange);
        }
        if (this._refs.maxWeight) {
            this._refs.maxWeight.addEventListener('change', onRangeChange);
        }

        if (this._refs.scopeBtn) {
            this._refs.scopeBtn.addEventListener('click', () => {
                const selectedOnly = this._refs.scopeBtn.getAttribute('data-state') !== 'on';
                this.scopeMode = selectedOnly ? 'selected' : 'all';
                this._refs.scopeBtn.setAttribute('data-state', selectedOnly ? 'on' : 'off');
                this._renderCards();
            });
        }

        this._updateNormalizeToolbar();
    }

    _updateNormalizeToolbar() {
        this.element.classList.toggle('emphasis-groups-normalize-active', this.normalizeEnabled);
        if (this._refs.scopeBtn) {
            this._refs.scopeBtn.classList.toggle('hidden', !this.normalizeEnabled);
        }
    }

    _wireSyncListeners() {
        this._onTextareaInput = () => {
            if (this.isApplyingFromTool || this.isDraggingSlider) return;
            clearTimeout(this._reconcileTimer);
            this._reconcileTimer = setTimeout(() => {
                this.reconcileTargetsFromPrompt();
                this._renderCards();
            }, 150);
        };
        this.textarea.addEventListener('input', this._onTextareaInput);

        this._onFocusIn = () => {
            clearTimeout(this._focusReconcileTimer);
            this.reconcileTargetsFromPrompt();
            this._renderCards();
        };
        this._onFocusOut = (e) => {
            if (this.element.contains(e.relatedTarget)) return;
            clearTimeout(this._focusReconcileTimer);
            this._focusReconcileTimer = setTimeout(() => {
                this.reconcileTargetsFromPrompt();
                this._renderCards();
            }, 0);
        };
        this.element.addEventListener('focusin', this._onFocusIn);
        this.element.addEventListener('focusout', this._onFocusOut);
    }

    getActiveIndices() {
        if (this.scopeMode === 'all') {
            return this.targets.map((_, i) => i);
        }
        return this.targets
            .map((t, i) => (t.cardState && t.cardState.selected ? i : -1))
            .filter((i) => i >= 0);
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
            return state;
        }
        const inferred = inferEmphasisWeightBand(parsedWeight);
        const state = {
            share: weightToShare(parsedWeight, this.minWeight, this.maxWeight),
            directWeight: parsedWeight,
            selected: true,
            signMode: inferred.signMode,
            weightBand: inferred.band,
            manualEditOpen: false
        };
        this.cardStateByKey.set(targetKey, state);
        return state;
    }

    reconcileTargetsFromPrompt() {
        const value = this.textarea.value || '';
        const freshTargets = listAllEmphasisTargets(value);

        this.targets = freshTargets.map((target) => {
            const targetKey = buildEmphasisTargetKey(target);
            const cardState = this._getOrCreateCardState(targetKey, target.weight);
            return { ...target, targetKey, cardState };
        });

        this.shares = this.targets.map((t) => t.cardState.share);
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

    _renderCards() {
        const grid = this._refs.grid;
        const empty = this._refs.empty;
        if (!grid) return;

        this._updateNormalizeToolbar();

        grid.innerHTML = '';
        const hasTargets = this.targets.length > 0;
        if (empty) {
            empty.classList.toggle('hidden', hasTargets);
        }
        if (!hasTargets) return;

        const readOnly = this._isReadOnly();

        this.targets.forEach((target, index) => {
            const typeIcon = getEmphasisCardTypeIcon(target);

            let sliderMin;
            let sliderMax;
            let sliderStep;
            let sliderVal;
            let displayWeight;
            let showSlider = true;
            let showValueInput = false;
            let showValueSpan = true;

            if (this.normalizeEnabled) {
                sliderMin = 0;
                sliderMax = 100;
                sliderStep = 1;
                sliderVal = Math.round(target.cardState.share);
                const active = this.getActiveIndices();
                const weights = sharesToWeights(this.shares, this.minWeight, this.maxWeight, active);
                displayWeight = weights[index] !== undefined ? weights[index] : target.weight;
            } else {
                const bounds = getEmphasisWeightBandBounds(target.cardState.signMode, target.cardState.weightBand);
                sliderMin = bounds.min;
                sliderMax = bounds.max;
                sliderStep = EMPHASIS_WEIGHT_FINE_STEP;
                displayWeight = target.cardState.directWeight;
                sliderVal = Math.max(bounds.min, Math.min(bounds.max, displayWeight));
                const inBand = isWeightInBand(displayWeight, target.cardState.signMode, target.cardState.weightBand);
                showSlider = inBand && !target.cardState.manualEditOpen;
                showValueInput = !inBand || target.cardState.manualEditOpen;
                showValueSpan = inBand && !target.cardState.manualEditOpen;
            }

            const card = document.createElement('div');
            card.className = 'emphasis-groups-card';
            if (!readOnly && (this.normalizeEnabled || showSlider)) {
                card.classList.add('emphasis-groups-card-wheelable');
            }
            card.dataset.index = String(index);
            card.dataset.targetKey = target.targetKey;
            card.dataset.selected = (this.normalizeEnabled && target.cardState.selected) ? 'on' : 'off';
            card.title = readOnly ? '' : 'Scroll to adjust emphasis (Shift for finer steps)';

            const bandDefs = getEmphasisBandDefs(target.cardState.signMode);
            const bandActive = String(target.cardState.weightBand);
            const signNegative = target.cardState.signMode === 'negative';
            const weightDisplay = formatEmphasisWeightDisplay(displayWeight);
            const selectMarkup = this.normalizeEnabled ? `
                    <button type="button" class="btn-secondary btn-toggle icon-only indicator emphasis-groups-card-select"
                        data-state="${target.cardState.selected ? 'on' : 'off'}" title="${target.cardState.selected ? 'Included in normalization' : 'Excluded from normalization'}">
                        <i class="${target.cardState.selected ? 'fas fa-check' : 'far fa-square'}"></i>
                    </button>` : '';

            card.innerHTML = `
                <div class="emphasis-groups-card-row">
                    ${typeIcon}
                    <div class="emphasis-text"></div>
                    ${selectMarkup}
                    <div class="emphasis-groups-card-direct">
                        <button type="button" class="btn-secondary btn-toggle icon-only emphasis-groups-card-sign"
                            data-state="${signNegative ? 'on' : 'off'}" title="${signNegative ? 'Negative weights' : 'Positive weights'}">
                            <i class="fas fa-${signNegative ? 'minus' : 'plus'}"></i>
                        </button>
                        <div class="gallery-toggle-group emphasis-groups-card-band two-tabs" data-active="${bandActive}">
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
                            ${readOnly ? 'disabled' : ''}>
                        <input type="text" class="slider-value-input emphasis-groups-card-weight-input${showValueInput ? '' : ' hidden'}"
                            value="${weightDisplay}" ${readOnly ? 'disabled' : ''} inputmode="decimal" autocomplete="off" spellcheck="false">
                    </div>
                    <span class="slider-value emphasis-groups-card-weight${showValueSpan ? '' : ' hidden'}" title="Click to edit">${weightDisplay}</span>
                </div>
            `;

            const textEl = card.querySelector('.emphasis-text');
            if (textEl) {
                const label = String(target.innerText || '').trim();
                textEl.textContent = label;
                textEl.title = label;
            }

            const selectBtn = card.querySelector('.emphasis-groups-card-select');
            const signBtn = card.querySelector('.emphasis-groups-card-sign');
            const bandToggle = card.querySelector('.emphasis-groups-card-band');
            const slider = card.querySelector('.emphasis-groups-card-slider');
            const weightEl = card.querySelector('.emphasis-groups-card-weight');
            const weightInput = card.querySelector('.emphasis-groups-card-weight-input');

            if (selectBtn && !readOnly) {
                selectBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const selected = selectBtn.getAttribute('data-state') !== 'on';
                    target.cardState.selected = selected;
                    updateCardSelectBtn(selectBtn, selected);
                    card.dataset.selected = selected ? 'on' : 'off';
                    this.cardStateByKey.set(target.targetKey, target.cardState);
                });
            }

            if (signBtn && !readOnly && !this.normalizeEnabled) {
                signBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    target.cardState.signMode = target.cardState.signMode === 'positive' ? 'negative' : 'positive';
                    target.cardState.weightBand = inferBandForSign(target.cardState.directWeight, target.cardState.signMode);
                    target.cardState.manualEditOpen = false;
                    this.cardStateByKey.set(target.targetKey, target.cardState);
                    this._renderCards();
                });
            }

            if (bandToggle && !readOnly && !this.normalizeEnabled) {
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

            if (weightEl && !readOnly && !this.normalizeEnabled) {
                weightEl.addEventListener('click', (e) => {
                    e.stopPropagation();
                    target.cardState.manualEditOpen = true;
                    this.cardStateByKey.set(target.targetKey, target.cardState);
                    this._renderCards();
                    this._focusCardWeightInput(target.targetKey);
                });
            }

            if (weightInput && !readOnly && !this.normalizeEnabled) {
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

            if (slider && !readOnly) {
                slider.addEventListener('pointerdown', () => {
                    this.isDraggingSlider = true;
                });
                slider.addEventListener('pointerup', () => {
                    this.isDraggingSlider = false;
                    this.reconcileTargetsFromPrompt();
                    this._renderCards();
                });
                slider.addEventListener('input', () => {
                    this._onSliderInput(index, parseFloat(slider.value), weightEl);
                });
                slider.addEventListener('change', () => {
                    this.isDraggingSlider = false;
                    this.reconcileTargetsFromPrompt();
                    this._renderCards();
                });
            }

            if (!readOnly) {
                card.addEventListener('wheel', (e) => {
                    if (e.target.closest('.emphasis-groups-card-weight-input')) return;
                    if (e.target.closest('.emphasis-groups-card-select, .emphasis-groups-card-sign, .emphasis-groups-card-band')) return;
                    e.preventDefault();
                    e.stopPropagation();
                    const step = this._getCardWheelStep(e, target);
                    const delta = e.deltaY > 0 ? -step : step;
                    if (this.normalizeEnabled || (slider && !slider.classList.contains('hidden'))) {
                        this._nudgeCardSlider(index, delta, slider, weightEl, target);
                    } else {
                        this._nudgeCardDirectWeight(index, delta, target);
                    }
                }, { passive: false });
            }

            grid.appendChild(card);
        });

        const shell = grid.closest('[data-custom-scrollbar]');
        if (shell && customScrollbar && customScrollbar.forceReinit) {
            customScrollbar.forceReinit(shell);
        }
    }

    _getCardWheelStep(event, target) {
        if (this.normalizeEnabled) {
            return event.shiftKey ? 5 : 1;
        }
        if (event.shiftKey) {
            return EMPHASIS_WEIGHT_FINE_STEP;
        }
        // getEmphasisAdjustStep: public/scripts/comp/emphasisManager.js
        const baseStep = getEmphasisAdjustStep(false);
        if (target && target.type === 'brace') {
            return Math.max(baseStep, EMPHASIS_WEIGHT_STEP);
        }
        return baseStep;
    }

    _nudgeCardDirectWeight(index, delta, target) {
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
        this._renderCards();
    }

    _nudgeCardSlider(index, delta, slider, weightEl, target) {
        if (!slider || this._isReadOnly()) return;

        let newVal;
        if (this.normalizeEnabled) {
            newVal = Math.max(0, Math.min(100, parseFloat(slider.value) + delta));
            slider.value = String(Math.round(newVal));
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
        this._onSliderInput(index, newVal, weightEl);
    }

    _onSliderInput(index, value, weightEl) {
        clearTimeout(this._applyTimer);
        this._applyTimer = setTimeout(() => {
            if (this.normalizeEnabled) {
                const active = this.getActiveIndices();
                if (!active.includes(index)) return;
                this.shares = rebalanceEmphasisShares(this.shares, index, value, active);
                this.targets.forEach((t, i) => {
                    t.cardState.share = this.shares[i];
                    this.cardStateByKey.set(t.targetKey, t.cardState);
                });
                this._applyFromShares();
                const activeAfter = this.getActiveIndices();
                const weights = sharesToWeights(this.shares, this.minWeight, this.maxWeight, activeAfter);
                if (weightEl && weights[index] !== undefined) {
                    weightEl.textContent = formatEmphasisWeightDisplay(weights[index]);
                }
            } else {
                const cardState = this.targets[index].cardState;
                const bounds = getEmphasisWeightBandBounds(cardState.signMode, cardState.weightBand);
                let weight = clampEmphasisWeight(value);
                weight = Math.max(bounds.min, Math.min(bounds.max, weight));
                cardState.directWeight = weight;
                this.cardStateByKey.set(this.targets[index].targetKey, cardState);
                if (weightEl) {
                    weightEl.textContent = formatEmphasisWeightDisplay(weight);
                }
                this._applyWeightAtIndex(index, weight);
            }
        }, 50);
    }

    _applyFromShares() {
        const active = this.getActiveIndices();
        if (!active.length) return;
        const weights = sharesToWeights(this.shares, this.minWeight, this.maxWeight, active);
        const weightByIndex = new Map();
        active.forEach((i) => {
            if (weights[i] !== undefined) {
                weightByIndex.set(i, weights[i]);
            }
        });
        this._applyWeights(weightByIndex);
    }

    _applyWeightAtIndex(index, weight) {
        const weightByIndex = new Map([[index, weight]]);
        this._applyWeights(weightByIndex);
    }

    _applyWeights(weightByIndex) {
        if (!weightByIndex.size || this._isReadOnly()) return;

        const value = this.textarea.value || '';
        const newValue = applyEmphasisTargetWeights(value, weightByIndex);
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
        closeModal(this.element).then(() => {
            this.manager.removeInstance(this.id);
        });
    }

    destroy() {
        clearTimeout(this._reconcileTimer);
        clearTimeout(this._focusReconcileTimer);
        clearTimeout(this._applyTimer);
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
            if (bringModalToFront) {
                bringModalToFront(existing.element);
            } else {
                openModal(existing.element);
            }
            existing.reconcileTargetsFromPrompt();
            existing._renderCards();
            return existing;
        }

        const instanceId = `emphasisGroupsTool_${this.nextId++}`;
        const element = this.template.cloneNode(true);
        element.id = instanceId;
        element.classList.remove('hidden');
        this.updateElementIds(element, instanceId);

        const offset = this.calculateTileOffset();
        element.style.setProperty('--modal-offset-x', `${offset.x}px`);
        element.style.setProperty('--modal-offset-y', `${offset.y}px`);

        document.body.appendChild(element);

        const instance = new EmphasisGroupsToolInstance(instanceId, element, textarea, this);

        // applyModalDefaultWindowSize, addResizeHandles: public/scripts/comp/modalUtils.js
        applyModalDefaultWindowSize(element);
        if (!element.querySelector('.resize-handle')) {
            addResizeHandles(element);
        }

        this.instances.set(instanceId, instance);
        if (textareaId) {
            this.byTextareaId.set(textareaId, instanceId);
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
