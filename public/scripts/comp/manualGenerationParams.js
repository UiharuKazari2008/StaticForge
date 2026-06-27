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
        manualStrengthValue.addEventListener('wheel', function (e) {
            e.preventDefault();
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
        manualNoiseValue.addEventListener('wheel', function (e) {
            e.preventDefault();
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
        manualSteps.addEventListener('wheel', function (e) {
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
        }, { passive: true, signal });
    }

    if (manualGuidance) {
        manualGuidance.addEventListener('wheel', function (e) {
            const delta = e.deltaY > 0 ? -(e.shiftKey ? 0.01 : 0.1) : (e.shiftKey ? 0.01 : 0.1);
            const currentValue = parseFloat(this.value) || 5.0;
            const newValue = Math.max(0.0, Math.min(10.0, currentValue + delta));
            this.value = newValue.toFixed(2);
            updateAllStagesInheritedValues();
        }, { passive: true, signal });
        manualGuidance.addEventListener('input', () => {
            updateAllStagesInheritedValues();
        }, { signal });
    }

    if (manualRescale) {
        manualRescale.addEventListener('wheel', function (e) {
            const delta = e.deltaY > 0 ? -(e.shiftKey ? 0.1 : 0.01) : (e.shiftKey ? 0.1 : 0.01);
            const currentValue = parseFloat(this.value) || 0.0;
            const newValue = Math.max(0.0, Math.min(1.0, currentValue + delta));
            this.value = newValue.toFixed(2);
            if (manualRescaleOverlay) {
                updatePercentageOverlay(manualRescale, manualRescaleOverlay);
            }
            updateAllStagesInheritedValues();
        }, { passive: true, signal });
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
