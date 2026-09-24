/**
 * Manual generation parameter listeners (steps, guidance, rescale, strength, noise, paid toggles, upscale, variety).
 * Wired via registerInitStep 474; originals removed from app.js setupEventListeners (Phase 2 batch 8).
 */

function attachManualGenerationParamsListeners(signal) {
    if (paidRequestToggle) {
        paidRequestToggle.addEventListener('click', (e) => {
            e.preventDefault();
            forcePaidRequest = !forcePaidRequest;
            paidRequestToggle.setAttribute('data-state', forcePaidRequest ? 'on' : 'off');
            if (windowPaidToggle) {
                windowPaidToggle.setAttribute('data-state', forcePaidRequest ? 'on' : 'off');
            }
        }, { signal });
    }

    if (windowPaidToggle) {
        windowPaidToggle.addEventListener('click', (e) => {
            e.preventDefault();
            forcePaidRequest = !forcePaidRequest;
            windowPaidToggle.setAttribute('data-state', forcePaidRequest ? 'on' : 'off');
            if (paidRequestToggle) {
                paidRequestToggle.setAttribute('data-state', forcePaidRequest ? 'on' : 'off');
            }
        }, { signal });
    }

    if (manualUpscale) {
        manualUpscale.addEventListener('click', (e) => {
            e.preventDefault();
            // toggleManualUpscale: public/scripts/app.js
            toggleManualUpscale();
        }, { signal });
    }

    if (manualSteps) {
        manualSteps.addEventListener('input', () => {
            updateManualPriceDisplay();
            updateAllStagesInheritedValues();
        }, { signal });
    }

    if (manualStrengthValue) {
        manualStrengthValue.addEventListener('input', updateManualPriceDisplay, { signal });
        // createWheelTickGate / guardWheelTick: public/scripts/utils/wheelTickGate.js
        const allowStrengthTick = createWheelTickGate(400);
        manualStrengthValue.addEventListener('wheel', function (e) {
            if (!guardWheelTick(e, allowStrengthTick)) return;
            const delta = e.deltaY > 0 ? -(e.shiftKey ? 0.1 : 0.01) : (e.shiftKey ? 0.1 : 0.01);
            const currentValue = parseFloat(this.value) || 0.00;
            const newValue = Math.max(0, Math.min(1, currentValue + delta));
            this.value = newValue.toFixed(2);
            updateManualPriceDisplay();
            if (manualStrengthOverlay) {
                updatePercentageOverlay(manualStrengthValue, manualStrengthOverlay);
            }
        }, { signal });
        if (manualStrengthOverlay) {
            manualStrengthValue.addEventListener('input', () => updatePercentageOverlay(manualStrengthValue, manualStrengthOverlay), { signal });
            manualStrengthValue.addEventListener('blur', () => updatePercentageOverlay(manualStrengthValue, manualStrengthOverlay), { signal });
            updatePercentageOverlay(manualStrengthValue, manualStrengthOverlay);
        }
    }

    if (manualNoiseValue) {
        manualNoiseValue.addEventListener('input', updateManualPriceDisplay, { signal });
        // createWheelTickGate / guardWheelTick: public/scripts/utils/wheelTickGate.js
        const allowNoiseTick = createWheelTickGate(400);
        manualNoiseValue.addEventListener('wheel', function (e) {
            if (!guardWheelTick(e, allowNoiseTick)) return;
            const delta = e.deltaY > 0 ? -(e.shiftKey ? 0.1 : 0.01) : (e.shiftKey ? 0.1 : 0.01);
            const currentValue = parseFloat(this.value) || 0.00;
            const newValue = Math.max(0, Math.min(1, currentValue + delta));
            this.value = newValue.toFixed(2);
            updateManualPriceDisplay();
            if (manualNoiseOverlay) {
                updatePercentageOverlay(manualNoiseValue, manualNoiseOverlay);
            }
        }, { signal });
        if (manualNoiseOverlay) {
            manualNoiseValue.addEventListener('input', () => updatePercentageOverlay(manualNoiseValue, manualNoiseOverlay), { signal });
            manualNoiseValue.addEventListener('blur', () => updatePercentageOverlay(manualNoiseValue, manualNoiseOverlay), { signal });
            updatePercentageOverlay(manualNoiseValue, manualNoiseOverlay);
        }
    }

    let manualStepsWheelTimeout = false;
    if (manualSteps) {
        // createWheelTickGate / guardWheelTick: public/scripts/utils/wheelTickGate.js
        const allowStepsTick = createWheelTickGate(400);
        manualSteps.addEventListener('wheel', function (e) {
            if (!guardWheelTick(e, allowStepsTick)) return;
            const currentValue = parseInt(this.value) || 25;
            const delta = e.deltaY > 0 ? -1 : 1;

            if (currentValue < 28) {
                if (!manualStepsWheelTimeout) {
                    const nextValue = currentValue + delta;
                    if (nextValue >= 28) {
                        this.value = 28;
                        manualStepsWheelTimeout = true;
                        setTimeout(() => {
                            manualStepsWheelTimeout = false;
                        }, 1000);
                    } else {
                        this.value = Math.max(1, nextValue);
                    }
                }
            } else if (currentValue === 28) {
                if (!manualStepsWheelTimeout && delta > 0) {
                    this.value = 29;
                    manualStepsWheelTimeout = true;
                    setTimeout(() => {
                        manualStepsWheelTimeout = false;
                    }, 1000);
                } else if (delta < 0) {
                    this.value = 27;
                }
            } else {
                const newValue = Math.max(1, Math.min(50, currentValue + delta));
                this.value = newValue;
            }
            updateManualPriceDisplay();
            updateAllStagesInheritedValues();
        }, { passive: false, signal });
    }

    if (manualGuidance) {
        manualGuidance.addEventListener('blur', function () {
            const value = parseFloat(this.value);
            if (value === 0 && typeof showGlassToast === 'function') {
                showGlassToast('info', 'Guidance', '0 CFG remaps to 5.5 on the server. For near-zero CFG, enter 0.001.', false, 5000);
            }
        }, { signal });
        // createWheelTickGate / guardWheelTick: public/scripts/utils/wheelTickGate.js
        const allowGuidanceTick = createWheelTickGate(400);
        manualGuidance.addEventListener('wheel', function (e) {
            if (!guardWheelTick(e, allowGuidanceTick)) return;
            const delta = e.deltaY > 0 ? -(e.shiftKey ? 0.01 : 0.1) : (e.shiftKey ? 0.01 : 0.1);
            const currentValue = parseFloat(this.value) || 5.0;
            const newValue = Math.max(0.0, Math.min(10.0, currentValue + delta));
            this.value = newValue.toFixed(2);
            updateAllStagesInheritedValues();
        }, { passive: false, signal });
        manualGuidance.addEventListener('input', () => {
            updateAllStagesInheritedValues();
        }, { signal });
    }

    if (manualRescale) {
        // createWheelTickGate / guardWheelTick: public/scripts/utils/wheelTickGate.js
        const allowRescaleTick = createWheelTickGate(400);
        manualRescale.addEventListener('wheel', function (e) {
            if (!guardWheelTick(e, allowRescaleTick)) return;
            const delta = e.deltaY > 0 ? -(e.shiftKey ? 0.1 : 0.01) : (e.shiftKey ? 0.1 : 0.01);
            const currentValue = parseFloat(this.value) || 0.0;
            const newValue = Math.max(0.0, Math.min(1.0, currentValue + delta));
            this.value = newValue.toFixed(2);
            if (manualRescaleOverlay) {
                updatePercentageOverlay(manualRescale, manualRescaleOverlay);
            }
            updateAllStagesInheritedValues();
        }, { passive: false, signal });
        if (manualRescaleOverlay) {
            manualRescale.addEventListener('input', () => {
                updatePercentageOverlay(manualRescale, manualRescaleOverlay);
                updateAllStagesInheritedValues();
            }, { signal });
            manualRescale.addEventListener('blur', () => updatePercentageOverlay(manualRescale, manualRescaleOverlay), { signal });
            updatePercentageOverlay(manualRescale, manualRescaleOverlay);
        }
    }

    const varietyBtnEl = document.getElementById('varietyBtn');
    if (varietyBtnEl) {
        varietyBtnEl.addEventListener('click', function (e) {
            e.preventDefault();
            // getForgeModelFeatures / isV5Model: public/scripts/comp/utilities.js
            const caps = getForgeModelFeatures();
            if (isV5Model() || (caps && caps.varietyPlus === false)) {
                varietyEnabled = false;
                this.setAttribute('data-state', 'off');
                return;
            }
            varietyEnabled = !varietyEnabled;
            if (varietyEnabled) {
                this.setAttribute('data-state', 'on');
            } else {
                this.setAttribute('data-state', 'off');
            }
            updateAllStagesInheritedValues();
        }, { signal });
    }
}

function initManualGenerationParamsListenerScope() {
    const manualModalEl = document.getElementById('manualModal');
    if (!manualModalEl) return;
    // attachModalListeners: public/scripts/comp/modalListenerScope.js
    attachModalListeners(manualModalEl, attachManualGenerationParamsListeners);
}

if (typeof wsClient !== 'undefined' && wsClient) {
    wsClient.registerInitStep(474, 'Manual generation params listener scope', async () => {
        initManualGenerationParamsListenerScope();
    });
}
