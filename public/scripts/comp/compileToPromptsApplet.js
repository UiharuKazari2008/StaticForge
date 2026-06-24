/**
 * Compile to Prompts — run Rentan without image generation and preview Tendai replacements.
 * collectManualFormValues, addSharedFieldsToRequestBody: manualModalManager.js
 */

let compileToPromptsInFlight = false;
let compileToPromptsQueue = [];
let compileToPromptsRequestBody = null;

function buildCompileToPromptsRequestBody() {
    // collectManualFormValues: manualModalManager.js
    const values = collectManualFormValues();
    const requestBody = { model: values.model };
    // addSharedFieldsToRequestBody: manualModalManager.js
    addSharedFieldsToRequestBody(requestBody, values);
    if (window.lockedTextReplacements?.length) {
        requestBody.text_replacements_seed = window.lockedTextReplacements;
    }
    return requestBody;
}

function applyCompiledPromptToClient(compiled_prompt, application_context) {
    if (!window.dynamicGenerationData) {
        window.dynamicGenerationData = {};
    }
    window.dynamicGenerationData.compiled_prompt = compiled_prompt;
    window._lastCompileToPromptsApplicationContext = application_context;

    const dynamicCarousel = document.getElementById('dynamicCarousel');
    if (dynamicCarousel) {
        dynamicCarousel.setAttribute('data-has-cache', 'true');
        const useCache = window.dynamicGenerationData.use_cache_responses !== false
            && dynamicCarousel.getAttribute('data-use-cache') !== 'false';
        dynamicCarousel.setAttribute('data-use-cache', useCache ? 'true' : 'false');
        window.dynamicGenerationData.use_cache_responses = useCache;
        // applyDynamicGenerationLockStateFromCompiledPrompt: dynamicGenerationLockState.js
        applyDynamicGenerationLockStateFromCompiledPrompt(compiled_prompt);
    }

    if (compiled_prompt?.context) {
        // updateDynamicCarousel, updateRentanContextOverlay: app.js
        updateDynamicCarousel(compiled_prompt.context, 'compiled');
        updateRentanContextOverlay(compiled_prompt.context);
    }

    if (typeof updateDynamicGenerationToggleBtn === 'function') {
        updateDynamicGenerationToggleBtn();
    }
    if (typeof updateMainLockButtonState === 'function') {
        updateMainLockButtonState();
    }
    if (typeof refreshTextReplacementLockModalIfOpen === 'function') {
        refreshTextReplacementLockModalIfOpen();
    }
}

async function startCompileToPrompts() {
    // isDynamicGenerationEnabled: dynamicGenerationLockState.js
    if (!isDynamicGenerationEnabled()) {
        showGlassToast('warning', null, 'Enable Rentan before compiling to prompts.', false, 3000, '<i class="ri-pencil-ai-2-fill"></i>');
        return;
    }
    if (compileToPromptsInFlight) {
        showGlassToast('info', null, 'Compile already in progress…', false, 2000, '<i class="fas fa-spinner-third fa-spin"></i>');
        return;
    }

    compileToPromptsInFlight = true;
  const requestBody = buildCompileToPromptsRequestBody();
    compileToPromptsRequestBody = requestBody;

    if (typeof updateDynamicGenerationProgressOverlay === 'function') {
        updateDynamicGenerationProgressOverlay('starting');
    }

    try {
        const result = await wsClient.compileDynamicGeneration(requestBody);
        if (!result?.success && result?.compiled_prompt?.success === false) {
            throw new Error(result?.compiled_prompt?.error || result?.error || 'Compile failed');
        }

        const compiled_prompt = result.compiled_prompt;
        const application_context = result.application_context;
        applyCompiledPromptToClient(compiled_prompt, application_context);
        buildCompileToPromptsQueue(compiled_prompt);
        showCompileToPromptsModal();

        showGlassToast('success', null, 'Rentan compiled to prompts', false, 2500, '<i class="fas fa-file-pen"></i>');
    } catch (err) {
        console.error('Compile to Prompts failed:', err);
        showGlassToast('error', null, err.message || 'Compile to Prompts failed', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
        if (typeof updateDynamicGenerationProgressOverlay === 'function') {
            updateDynamicGenerationProgressOverlay('error');
        }
    } finally {
        compileToPromptsInFlight = false;
    }
}

function buildCompileToPromptsQueue(compiled_prompt) {
    compileToPromptsQueue = collectTendaiReplacementQueue(compiled_prompt?.text_replacements).map((entry, index) => ({
        ...entry,
        queueIndex: index,
        included: entry.included !== false
    }));
}

function getCompileToPromptsSelectedReplacements() {
    return compileToPromptsQueue
        .filter(entry => entry.included)
        .map(({ replacement, targetType, targetSource, targetField }) => ({
            ...replacement,
            targetType,
            targetSource,
            targetField
        }));
}

function renderCompileToPromptsList() {
    const list = document.getElementById('compileToPromptsList');
    if (!list) return;

    list.innerHTML = '';

    if (!compileToPromptsQueue.length) {
        list.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-secondary);">No Tendai replacements in compile result.</div>';
        return;
    }

    const applicationContext = window._lastCompileToPromptsApplicationContext
        || window.dynamicGenerationData?.compiled_prompt?.application_context;

    compileToPromptsQueue.forEach((entry) => {
        const replacement = {
            ...entry.replacement,
            targetType: entry.targetType,
            targetSource: entry.targetSource,
            targetField: entry.targetField
        };

        const row = createTendaiReplacementRow(replacement, entry.queueIndex, {
            mode: 'include',
            included: entry.included,
            applicationContext,
            onIncludeToggle: (idx, included) => {
                if (compileToPromptsQueue[idx]) {
                    compileToPromptsQueue[idx].included = included;
                }
            }
        });
        list.appendChild(row);
    });
}

function showCompileToPromptsModal() {
    const modal = document.getElementById('compileToPromptsModal');
    if (!modal) return;

    renderCompileToPromptsList();
    // openModal: modalUtils.js
    openModal(modal);
}

function hideCompileToPromptsModal() {
    const modal = document.getElementById('compileToPromptsModal');
    if (modal) closeModal(modal);
}

async function handleCompileToPromptsApply(closeRentan) {
    const selected = getCompileToPromptsSelectedReplacements();
    if (!selected.length) {
        showGlassToast('warning', null, 'Select at least one replacement to apply.', false, 3000, '<i class="fas fa-exclamation-triangle"></i>');
        return;
    }

    const applicationContext = window._lastCompileToPromptsApplicationContext
        || window.dynamicGenerationData?.compiled_prompt?.application_context;

    const result = await applyTendaiToEditor(selected, applicationContext, {
        requestBody: compileToPromptsRequestBody || buildCompileToPromptsRequestBody()
    });

    if (!result.success) {
        showGlassToast('error', null, result.error || `Failed to apply ${result.failed} replacement(s)`, false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
        return;
    }

    showGlassToast('success', null, `Applied ${result.applied} replacement(s) to prompts`, false, 3000, '<i class="fas fa-check"></i>');

    if (closeRentan) {
        delete window.dynamicGenerationData;
        const dynamicGenerationToggle = document.getElementById('dynamicGenerationToggleBtn');
        const dynamicGenerationSection = document.getElementById('dynamicGenerationGroup');
        const dynamicCarouselElement = document.getElementById('dynamicCarousel');
        if (dynamicGenerationToggle) dynamicGenerationToggle.setAttribute('data-state', 'off');
        if (dynamicGenerationSection) dynamicGenerationSection.classList.add('hidden');
        if (dynamicCarouselElement) dynamicCarouselElement.setAttribute('data-use-cache', 'true');
        clearDynamicGenerationLockState();
        if (typeof updateDynamicGenerationToggleBtn === 'function') updateDynamicGenerationToggleBtn();
        if (window.lockedDynamicReplacements) window.lockedDynamicReplacements = [];
        if (typeof updateMainLockButtonState === 'function') updateMainLockButtonState();
        hideCompileToPromptsModal();
    } else {
        compileToPromptsQueue = compileToPromptsQueue.filter(e => !e.included);
        renderCompileToPromptsList();
        if (!compileToPromptsQueue.length) {
            hideCompileToPromptsModal();
        }
    }

    if (typeof refreshTokenBarCounts === 'function') refreshTokenBarCounts();
}

function wireCompileToPromptsModal() {
    const modal = document.getElementById('compileToPromptsModal');
    if (!modal || modal.dataset.wired === 'true') return;
    modal.dataset.wired = 'true';

    const closeBtn = document.getElementById('closeCompileToPromptsModalBtn');
    const cancelBtn = document.getElementById('compileToPromptsCancelBtn');
    const applyBtn = document.getElementById('compileToPromptsApplyBtn');
    const applyCloseBtn = document.getElementById('compileToPromptsApplyCloseBtn');
    const selectAllBtn = document.getElementById('compileToPromptsSelectAllBtn');
    const selectNoneBtn = document.getElementById('compileToPromptsSelectNoneBtn');

    if (closeBtn) closeBtn.addEventListener('click', hideCompileToPromptsModal);
    if (cancelBtn) cancelBtn.addEventListener('click', hideCompileToPromptsModal);
    if (applyBtn) {
        applyBtn.addEventListener('click', () => handleCompileToPromptsApply(false));
    }
    if (applyCloseBtn) {
        applyCloseBtn.addEventListener('click', () => handleCompileToPromptsApply(true));
    }
    if (selectAllBtn) {
        selectAllBtn.addEventListener('click', () => {
            compileToPromptsQueue.forEach(e => { e.included = true; });
            renderCompileToPromptsList();
        });
    }
    if (selectNoneBtn) {
        selectNoneBtn.addEventListener('click', () => {
            compileToPromptsQueue.forEach(e => { e.included = false; });
            renderCompileToPromptsList();
        });
    }

    const closeCompiledPromptBtn = document.getElementById('closeCompiledPromptBtn');
    if (closeCompiledPromptBtn && closeCompiledPromptBtn.dataset.wired !== 'true') {
        closeCompiledPromptBtn.dataset.wired = 'true';
        closeCompiledPromptBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const compiledModal = document.getElementById('compiledPromptModal');
            if (compiledModal) {
                closeModal(compiledModal);
            }
        });
    }
}

window.wsClient.registerInitStep(46, 'Compile to Prompts', async () => {
    wireCompileToPromptsModal();
});
