/** Stage indicator + generation progress (Phase 2 batch 13). */
/**
 * Calculate generation progress percentage based on phase and data
 * @param {Object} progressData - Progress data from server
 * @returns {number} Progress percentage (0-100)
 */
function calculateGenerationProgress(progressData) {
    const { phase, currentStep, totalSteps, currentKey, totalKeys, hasDynamicGen, isUpscaling, totalStages, currentStage } = progressData;

    // Handle staged generation
    if (totalStages && currentStage !== undefined) {
        switch (phase) {
            case 'generating':
                // Calculate progress per stage: (currentStage / totalStages) + (stepProgress / totalStages)
                const stageProgress = ((currentStage - 1) / totalStages) * 100; // -1 because currentStage is 1-based
                if (totalSteps && totalSteps > 0) {
                    const stepProgress = (currentStep / totalSteps) * (100 / totalStages);
                    return Math.min(stageProgress + stepProgress, 95);
                }
                return Math.min(stageProgress, 95);

            case 'stage_delay':
                // During delay, show progress for current stage
                return (currentStage / totalStages) * 100;

            case 'upscaling':
                return 96;

            case 'previews':
                return 98;

            case 'complete':
                return 100;

            default:
                return (currentStage / totalStages) * 100;
        }
    }

    // Handle no-dynamic-gen path (skip 0-25% phases)
    if (hasDynamicGen === false) {
        switch (phase) {
            case 'generating':
                // 15-95%: Image generation steps (start from 15% instead of 26%)
                if (totalSteps && totalSteps > 0) {
                    const baseProgress = 15;
                    const rangeSize = isUpscaling ? 60 : 80; // 75% or 95% end point from 15%
                    const stepProgress = (currentStep / totalSteps) * rangeSize;
                    return Math.min(baseProgress + stepProgress, isUpscaling ? 75 : 95);
                }
                return 15;

            case 'upscaling':
                // 76-95%: Upscaling (client-side timer)
                return 76;

            case 'previews':
                // 97%: Preview generation starting
                return 97;

            case 'complete':
                // 100%: Complete
                return 100;

            default:
                return 15; // Default to 15% for non-Rentan
        }
    }

    // Normal path with Rentan
    switch (phase) {
        case 'starting':
            // 0-15%: AI processing starting (client-side timer)
            return 0;

        case 'streaming':
            // 16-25%: AI streaming progress
            if (totalKeys && totalKeys > 0) {
                const baseProgress = 16;
                const keyProgress = (currentKey / totalKeys) * 9; // 9% range for keys
                return Math.min(baseProgress + keyProgress, 25);
            }
            return 16;

        case 'completion':
            // 25%: AI processing complete
            return 25;

        case 'generating':
            // 26-95%: Image generation steps
            if (totalSteps && totalSteps > 0) {
                const baseProgress = 26;
                const rangeSize = isUpscaling ? 49 : 69; // 75% or 95% end point
                const stepProgress = (currentStep / totalSteps) * rangeSize;
                return Math.min(baseProgress + stepProgress, isUpscaling ? 75 : 95);
            }
            return 26;

        case 'upscaling':
            // 76-95%: Upscaling (client-side timer)
            return 76;

        case 'previews':
            // 97%: Preview generation starting
            return 97;

        case 'complete':
            // 100%: Complete
            return 100;

        default:
            return 0;
    }
}

/** Status line for generation progress UI (toast + gallery reroll placeholder). */
function getGenerationStatusMessage(progressData) {
    const d = progressData || {};
    switch (d.phase) {
        case 'starting':
            return 'Analyzing request...';
        case 'tool_execution':
            return d.currentKey && d.totalKeys
                ? `Executing tools (${d.currentKey}/${d.totalKeys})...`
                : 'Executing tools...';
        case 'streaming':
            return 'Processing AI response...';
        case 'completion':
            return 'AI processing complete, starting generation...';
        case 'generating':
            if (d.totalStages != null && d.currentStage != null) {
                return `Stage ${d.currentStage}/${d.totalStages}: ${d.stageType || 'stage'}`;
            }
            if (d.totalSteps && d.currentStep != null) {
                return `Step ${d.currentStep}/${d.totalSteps}`;
            }
            return 'Generating image...';
        case 'stage_delay':
            return d.delayMs ? `Stage delay: ${Math.ceil(d.delayMs / 1000)}s remaining` : 'Stage delay...';
        case 'upscaling':
            return 'Upscaling image...';
        case 'previews':
            return 'Generating previews...';
        case 'complete':
            return 'Preparing download...';
        default:
            return 'Processing...';
    }
}

/**
 * Initialize stage indicators for manual modal generation
 * @param {number} totalStages - Total number of stages in the generation
 */
function initializeStageIndicators(totalStages) {
    const container = document.getElementById('manualStageIndicators');
    if (!container || totalStages <= 1) {
        if (container) {
            container.classList.add('hidden');
        }
        return;
    }

    container.innerHTML = '';
    container.classList.remove('hidden');

    for (let i = 0; i < totalStages; i++) {
        const dot = document.createElement('div');
        dot.className = 'manual-stage-indicator-dot';
        dot.dataset.stage = i + 1;
        container.appendChild(dot);
    }
}

/**
 * Update stage indicators based on generation progress
 * @param {Object} progressData - Progress data from server
 */
function updateStageIndicators(progressData) {
    const container = document.getElementById('manualStageIndicators');
    if (!container || container.classList.contains('hidden')) {
        return;
    }

    const { phase, currentStage, totalStages, currentStep, totalSteps } = progressData;

    if (!totalStages || !currentStage) {
        return;
    }

    const dots = container.querySelectorAll('.manual-stage-indicator-dot');
    if (dots.length !== totalStages) {
        // Re-initialize if mismatch
        initializeStageIndicators(totalStages);
        return;
    }

    dots.forEach((dot, index) => {
        const dotStage = index + 1;

        // Remove all state classes
        dot.classList.remove('completed', 'active', 'delay', 'generating');
        dot.style.removeProperty('--stage-progress');

        if (dotStage < currentStage) {
            // Completed stages
            dot.classList.add('completed');
        } else if (dotStage === currentStage) {
            // Current stage
            if (phase === 'stage_delay') {
                // Pulsing during delay
                dot.classList.add('active', 'delay');
            } else if (phase === 'generating') {
                // Generating phase
                if (totalSteps && currentStep) {
                    // Show progress within stage (streaming with steps)
                    dot.classList.add('active');
                    const stageProgress = currentStep / totalSteps;
                    dot.style.setProperty('--stage-progress', stageProgress);
                } else {
                    // No step info - pulse background (non-streaming like img2img/enhance)
                    dot.classList.add('active', 'generating');
                }
            } else {
                // Active but no specific progress (other phases)
                dot.classList.add('active');
            }
        }
        // Future stages remain in default state
    });
}

