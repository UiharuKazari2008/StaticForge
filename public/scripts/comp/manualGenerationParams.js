/**
 * Manual generation parameter listeners (steps, guidance, rescale, strength, noise, paid toggles, upscale, variety).
 * Wired via registerInitStep 47.4; originals removed from app.js setupEventListeners (Phase 2 batch 8).
 */

function wireManualGenerationParamsListeners() {
    if (document.body.dataset.manualGenerationParamsWired === 'true') return;
    document.body.dataset.manualGenerationParamsWired = 'true';

    if (paidRequestToggle && paidRequestToggle.dataset.wired !== 'true') {
        paidRequestToggle.dataset.wired = 'true';
        paidRequestToggle.addEventListener('click', (e) => {
            e.preventDefault();
            forcePaidRequest = !forcePaidRequest;
            paidRequestToggle.setAttribute('data-state', forcePaidRequest ? 'on' : 'off');
            if (windowPaidToggle) {
                windowPaidToggle.setAttribute('data-state', forcePaidRequest ? 'on' : 'off');
            }
        });
    }

    if (windowPaidToggle && windowPaidToggle.dataset.wired !== 'true') {
        windowPaidToggle.dataset.wired = 'true';
        windowPaidToggle.addEventListener('click', (e) => {
            e.preventDefault();
            forcePaidRequest = !forcePaidRequest;
            windowPaidToggle.setAttribute('data-state', forcePaidRequest ? 'on' : 'off');
            if (paidRequestToggle) {
                paidRequestToggle.setAttribute('data-state', forcePaidRequest ? 'on' : 'off');
            }
        });
    }

    if (manualUpscale && manualUpscale.dataset.wired !== 'true') {
        manualUpscale.dataset.wired = 'true';
        manualUpscale.addEventListener('click', (e) => {
            e.preventDefault();
            // toggleManualUpscale: public/scripts/app.js
            toggleManualUpscale();
        });
    }

    if (manualSteps && manualSteps.dataset.wired !== 'true') {
        manualSteps.dataset.wired = 'true';
        manualSteps.addEventListener('input', () => {
            updateManualPriceDisplay();
            updateAllStagesInheritedValues();
        });
    }

    if (manualStrengthValue && manualStrengthValue.dataset.wired !== 'true') {
        manualStrengthValue.dataset.wired = 'true';
        manualStrengthValue.addEventListener('input', updateManualPriceDisplay);
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
        });
        if (manualStrengthOverlay) {
            manualStrengthValue.addEventListener('input', () => updatePercentageOverlay(manualStrengthValue, manualStrengthOverlay));
            manualStrengthValue.addEventListener('blur', () => updatePercentageOverlay(manualStrengthValue, manualStrengthOverlay));
            updatePercentageOverlay(manualStrengthValue, manualStrengthOverlay);
        }
    }

    if (manualNoiseValue && manualNoiseValue.dataset.wired !== 'true') {
        manualNoiseValue.dataset.wired = 'true';
        manualNoiseValue.addEventListener('input', updateManualPriceDisplay);
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
        });
        if (manualNoiseOverlay) {
            manualNoiseValue.addEventListener('input', () => updatePercentageOverlay(manualNoiseValue, manualNoiseOverlay));
            manualNoiseValue.addEventListener('blur', () => updatePercentageOverlay(manualNoiseValue, manualNoiseOverlay));
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
        }, { passive: true });
    }

    if (manualGuidance && manualGuidance.dataset.wired !== 'true') {
        manualGuidance.dataset.wired = 'true';
        manualGuidance.addEventListener('wheel', function (e) {
            const delta = e.deltaY > 0 ? -(e.shiftKey ? 0.01 : 0.1) : (e.shiftKey ? 0.01 : 0.1);
            const currentValue = parseFloat(this.value) || 5.0;
            const newValue = Math.max(0.0, Math.min(10.0, currentValue + delta));
            this.value = newValue.toFixed(2);
            updateAllStagesInheritedValues();
        }, { passive: true });
        manualGuidance.addEventListener('input', () => {
            updateAllStagesInheritedValues();
        });
    }

    if (manualRescale && manualRescale.dataset.wired !== 'true') {
        manualRescale.dataset.wired = 'true';
        manualRescale.addEventListener('wheel', function (e) {
            const delta = e.deltaY > 0 ? -(e.shiftKey ? 0.1 : 0.01) : (e.shiftKey ? 0.1 : 0.01);
            const currentValue = parseFloat(this.value) || 0.0;
            const newValue = Math.max(0.0, Math.min(1.0, currentValue + delta));
            this.value = newValue.toFixed(2);
            if (manualRescaleOverlay) {
                updatePercentageOverlay(manualRescale, manualRescaleOverlay);
            }
            updateAllStagesInheritedValues();
        }, { passive: true });
        if (manualRescaleOverlay) {
            manualRescale.addEventListener('input', () => {
                updatePercentageOverlay(manualRescale, manualRescaleOverlay);
                updateAllStagesInheritedValues();
            });
            manualRescale.addEventListener('blur', () => updatePercentageOverlay(manualRescale, manualRescaleOverlay));
            updatePercentageOverlay(manualRescale, manualRescaleOverlay);
        }
    }

    const varietyBtnEl = document.getElementById('varietyBtn');
    if (varietyBtnEl && varietyBtnEl.dataset.wired !== 'true') {
        varietyBtnEl.dataset.wired = 'true';
        varietyBtnEl.addEventListener('click', function (e) {
            e.preventDefault();
            varietyEnabled = !varietyEnabled;
            if (varietyEnabled) {
                this.setAttribute('data-state', 'on');
            } else {
                this.setAttribute('data-state', 'off');
            }
            updateAllStagesInheritedValues();
        });
    }
}

if (typeof wsClient !== 'undefined' && wsClient) {
    wsClient.registerInitStep(47.4, 'Manual generation params listeners', async () => {
        wireManualGenerationParamsListeners();
    });
}
