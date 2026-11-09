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

// ---- the window: a report list with check boxes (Windows Update's "select the updates to
// install"), the selected change's details under it, the count and the buttons at the foot.
// Rows are keyed by their position in compileToPromptsQueue; rebuilt whenever the queue changes. ----

let compileToPromptsSelectedIndex = -1;
let compileToPromptsApplying = false;

function getCompileToPromptsApplicationContext() {
    return window._lastCompileToPromptsApplicationContext
        || window.dynamicGenerationData?.compiled_prompt?.application_context;
}

function describeCompileToPromptsAction(replacement) {
    const action = String(replacement?.action || 'replace').toLowerCase();
    if (action === 'append') return replacement.select_text ? 'Insert after' : 'Add';
    if (action === 'delete') return 'Delete';
    return 'Replace';
}

function describeCompileToPromptsField(entry) {
    const field = entry.targetField === 'uc' || entry.targetType === 'uc' ? 'Undesired Content' : 'Prompt';
    if (entry.targetType === 'character' && Number.isFinite(Number(entry.targetSource))) {
        return `Character ${Number(entry.targetSource) + 1} ${field}`;
    }
    return field;
}

/** The text the change writes, with its emphasis shown as the prompt would show it. */
function getCompileToPromptsWrittenText(replacement) {
    const action = String(replacement?.action || 'replace').toLowerCase();
    let text = action === 'delete' ? '' : String(replacement?.replace_text || '');
    if (!text) return '';
    // getReplacementBias, hasEmphasisGroupForDisplay: textReplacementManager.js; applyBiasToText: manualDropdownManager.js
    const bias = typeof getReplacementBias === 'function' ? getReplacementBias(replacement) : null;
    if (bias !== null && bias !== undefined && typeof applyBiasToText === 'function'
        && !(typeof hasEmphasisGroupForDisplay === 'function' && hasEmphasisGroupForDisplay(text))) {
        text = applyBiasToText(text, bias);
    }
    return text;
}

function getCompileToPromptsFindText(replacement) {
    const action = String(replacement?.action || 'replace').toLowerCase();
    if (replacement?.select_text) return String(replacement.select_text);
    if (action === 'append') return '(end of the field)';
    if (action === 'delete') return replacement?.count ? `${replacement.count} occurrence(s)` : '(all)';
    return '';
}

/** Warnings for a change: it failed, used a fallback or alternative, or its text is not in the field. */
function getCompileToPromptsWarnings(entry) {
    const r = entry.replacement || {};
    const warnings = [];
    if (r.applied === false || r.error) warnings.push(r.error ? `Rentan could not apply it: ${r.error}` : 'Rentan could not apply it.');
    if (r.used_fallback && r.actual_select_text) warnings.push(`Rentan used the fallback text "${r.actual_select_text}".`);
    if (r.used_alternative && r.alternative_text_used) warnings.push(`Rentan used the alternative text "${r.alternative_text_used}".`);
    // validateReplacementAgainstResolved: promptApplyPipeline.js
    if (typeof validateReplacementAgainstResolved === 'function'
        && !validateReplacementAgainstResolved({ ...r, targetType: entry.targetType, targetSource: entry.targetSource, targetField: entry.targetField }, getCompileToPromptsApplicationContext())) {
        warnings.push('The text to find is not in the field as written; it may only match once expanders and presets are resolved.');
    }
    return warnings;
}

function renderCompileToPromptsList() {
    const list = document.getElementById('compileToPromptsList');
    if (!list) return;
    const empty = document.getElementById('compileToPromptsEmpty');
    if (empty) empty.classList.toggle('hidden', compileToPromptsQueue.length > 0);
    if (compileToPromptsSelectedIndex >= compileToPromptsQueue.length) compileToPromptsSelectedIndex = compileToPromptsQueue.length - 1;
    if (compileToPromptsSelectedIndex < 0 && compileToPromptsQueue.length) compileToPromptsSelectedIndex = 0;

    list.innerHTML = compileToPromptsQueue.map((entry, index) => {
        const r = entry.replacement || {};
        entry.warnings = getCompileToPromptsWarnings(entry);
        const id = `compileToPromptsCheck${index}`;
        const icon = entry.warnings.length
            ? '<img src="/static_images/vista-icons/warning-16.png" alt="" width="16" height="16">'
            : '';
        const cells = [
            describeCompileToPromptsAction(r),
            describeCompileToPromptsField(entry),
            getCompileToPromptsFindText(r),
            getCompileToPromptsWrittenText(r),
            r.replacement_category || ''
        ].map((value) => escapeHtml(value));
        return `<div class="ctp-row${index === compileToPromptsSelectedIndex ? ' is-selected' : ''}" role="row" data-index="${index}" aria-selected="${index === compileToPromptsSelectedIndex}">
            <span class="ctp-cell ctp-col-check" role="gridcell"><input type="checkbox" id="${id}" data-index="${index}"${entry.included ? ' checked' : ''} tabindex="-1"><label for="${id}"></label></span>
            <span class="ctp-cell ctp-col-change" role="gridcell">${icon}<span>${cells[0]}</span></span>
            <span class="ctp-cell ctp-col-field" role="gridcell">${cells[1]}</span>
            <span class="ctp-cell ctp-col-find" role="gridcell" title="${cells[2]}">${cells[2]}</span>
            <span class="ctp-cell ctp-col-text" role="gridcell" title="${cells[3]}">${cells[3]}</span>
            <span class="ctp-cell ctp-col-category" role="gridcell">${cells[4]}</span>
        </div>`;
    }).join('');
    updateCompileToPromptsCount();
    renderCompileToPromptsDetails();
}

function updateCompileToPromptsCount() {
    const total = compileToPromptsQueue.length;
    const chosen = compileToPromptsQueue.filter((e) => e.included).length;
    const count = document.getElementById('compileToPromptsCount');
    if (count) {
        count.textContent = total
            ? `${chosen} of ${total} change${total === 1 ? '' : 's'} selected`
            : '';
    }
    const all = document.getElementById('compileToPromptsAllCheck');
    if (all) {
        all.checked = total > 0 && chosen === total;
        all.indeterminate = chosen > 0 && chosen < total;
        all.disabled = total === 0;
    }
    for (const id of ['compileToPromptsApplyBtn', 'compileToPromptsApplyCloseBtn']) {
        const btn = document.getElementById(id);
        if (btn) btn.disabled = compileToPromptsApplying || chosen === 0;
    }
}

function renderCompileToPromptsDetails() {
    const box = document.getElementById('compileToPromptsDetails');
    if (!box) return;
    const entry = compileToPromptsQueue[compileToPromptsSelectedIndex];
    if (!entry) {
        box.innerHTML = '';
        box.classList.add('is-empty');
        return;
    }
    box.classList.remove('is-empty');
    const r = entry.replacement || {};
    const rows = [];
    const add = (label, valueHtml) => { if (valueHtml) rows.push(`<dt>${label}</dt><dd>${valueHtml}</dd>`); };
    add('Change', escapeHtml(`${describeCompileToPromptsAction(r)} in the ${describeCompileToPromptsField(entry)}`));
    add('Find', escapeHtml(getCompileToPromptsFindText(r)));
    add(String(r.action || '').toLowerCase() === 'delete' ? 'Deletes' : 'Text', escapeHtml(getCompileToPromptsWrittenText(r) || (String(r.action || '').toLowerCase() === 'delete' ? r.select_text || '' : '')));
    const anchor = r.anchor_details?.preview || r.anchor_text || '';
    if (anchor) {
        const source = r.anchor_details?.source ? ` (${String(r.anchor_details.source).replace(/_/g, ' ')})` : '';
        add('Anchor', escapeHtml(`${anchor}${source}`));
    }
    add('Category', escapeHtml(r.replacement_category || ''));
    add('Reason', escapeHtml(r.reason || ''));
    const mitigations = Array.isArray(r.mitigations) ? r.mitigations : [];
    if (mitigations.length) {
        add('Adjusted', mitigations.map((m) => escapeHtml(`${String(m.type || '').replace(/_/g, ' ')}${m.description ? ': ' + m.description : ''}`)).join('<br>'));
    }
    const refs = Array.isArray(r.references) ? r.references : [];
    if (refs.length) {
        add('Sources', refs.map((ref) => {
            if (ref.type === 'web_search') {
                const url = /^https?:\/\//i.test(ref.url || '') ? ref.url : '';
                const label = escapeHtml(ref.query || 'Web search');
                return url ? `Web: <a href="${escapeHtml(url)}" target="_blank" rel="noopener">${label}</a>` : `Web: ${label}`;
            }
            if (ref.type === 'tag_search') return escapeHtml(`Tags: ${Array.isArray(ref.tags) ? ref.tags.join(', ') : (ref.query || '')}`);
            if (ref.type === 'tag_description') return escapeHtml(`${ref.description || ref.query || 'Tag description'}${Array.isArray(ref.tags) && ref.tags.length ? ` (${ref.tags.join(', ')})` : ''}`);
            if (ref.type === 'tokenizer') return escapeHtml(ref.description || 'Token analysis');
            return escapeHtml(ref.description || ref.query || ref.type || '');
        }).filter(Boolean).join('<br>'));
    }
    const warnings = entry.warnings || getCompileToPromptsWarnings(entry);
    if (warnings.length) {
        add('Status', `<span class="ctp-warning"><img src="/static_images/vista-icons/warning-16.png" alt="" width="16" height="16">${warnings.map(escapeHtml).join('<br>')}</span>`);
    }
    box.innerHTML = `<dl class="ctp-pairs">${rows.join('')}</dl>`;
}

function selectCompileToPromptsRow(index, { scroll = true } = {}) {
    if (!compileToPromptsQueue.length) return;
    const next = Math.max(0, Math.min(compileToPromptsQueue.length - 1, index));
    const list = document.getElementById('compileToPromptsList');
    if (!list) return;
    const prev = list.querySelector('.ctp-row.is-selected');
    if (prev) {
        prev.classList.remove('is-selected');
        prev.setAttribute('aria-selected', 'false');
    }
    compileToPromptsSelectedIndex = next;
    const row = list.querySelector(`.ctp-row[data-index="${next}"]`);
    if (row) {
        row.classList.add('is-selected');
        row.setAttribute('aria-selected', 'true');
        if (scroll) {
            // inside the list only, below the sticky header (scrollIntoView would move the desktop)
            const scroller = list.closest('.ctp-scroll');
            const head = scroller && scroller.querySelector('.ctp-head');
            if (scroller) {
                const top = row.offsetTop - (head ? head.offsetHeight : 0);
                if (top < scroller.scrollTop) scroller.scrollTop = top;
                else if (row.offsetTop + row.offsetHeight > scroller.scrollTop + scroller.clientHeight) {
                    scroller.scrollTop = row.offsetTop + row.offsetHeight - scroller.clientHeight;
                }
            }
        }
    }
    renderCompileToPromptsDetails();
}

function setCompileToPromptsIncluded(index, included) {
    const entry = compileToPromptsQueue[index];
    if (!entry) return;
    entry.included = included;
    const box = document.getElementById(`compileToPromptsCheck${index}`);
    if (box) box.checked = included;
    updateCompileToPromptsCount();
}

function showCompileToPromptsModal() {
    const modal = document.getElementById('compileToPromptsModal');
    if (!modal) return;

    compileToPromptsSelectedIndex = compileToPromptsQueue.length ? 0 : -1;
    renderCompileToPromptsList();
    // openModal: modalUtils.js
    openModal(modal);
}

function hideCompileToPromptsModal() {
    const modal = document.getElementById('compileToPromptsModal');
    if (modal) closeModal(modal);
}

async function handleCompileToPromptsApply(closeRentan) {
    if (compileToPromptsApplying) return;
    const selected = getCompileToPromptsSelectedReplacements();
    if (!selected.length) {
        showGlassToast('warning', null, 'Select at least one change to apply.', false, 3000, '<i class="fas fa-exclamation-triangle"></i>');
        return;
    }

    compileToPromptsApplying = true;
    updateCompileToPromptsCount();
    let result;
    try {
        result = await applyTendaiToEditor(selected, getCompileToPromptsApplicationContext(), {
            requestBody: compileToPromptsRequestBody || buildCompileToPromptsRequestBody()
        });
    } catch (error) {
        result = { success: false, error: error?.message || String(error) };
    } finally {
        compileToPromptsApplying = false;
        updateCompileToPromptsCount();
    }

    if (!result.success) {
        showGlassToast('error', null, result.error || `Failed to apply ${result.failed} change(s)`, false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
        return;
    }

    showGlassToast('success', null, `Applied ${result.applied} change(s) to the prompts`, false, 3000, '<i class="fas fa-check"></i>');

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
        // the applied changes leave the list; what was left unticked stays for another pass
        compileToPromptsQueue = compileToPromptsQueue.filter(e => !e.included);
        compileToPromptsSelectedIndex = 0;
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

    document.getElementById('closeCompileToPromptsModalBtn')?.addEventListener('click', hideCompileToPromptsModal);
    document.getElementById('compileToPromptsCancelBtn')?.addEventListener('click', hideCompileToPromptsModal);
    document.getElementById('compileToPromptsApplyBtn')?.addEventListener('click', () => handleCompileToPromptsApply(false));
    document.getElementById('compileToPromptsApplyCloseBtn')?.addEventListener('click', () => handleCompileToPromptsApply(true));
    document.getElementById('compileToPromptsAllCheck')?.addEventListener('change', (e) => {
        const on = e.target.checked;
        compileToPromptsQueue.forEach((entry, index) => setCompileToPromptsIncluded(index, on));
    });

    const list = document.getElementById('compileToPromptsList');
    if (list) {
        list.addEventListener('change', (e) => {
            const box = e.target.closest('input[type="checkbox"][data-index]');
            if (box) setCompileToPromptsIncluded(Number(box.dataset.index), box.checked);
        });
        list.addEventListener('mousedown', (e) => {
            const row = e.target.closest('.ctp-row');
            if (row) selectCompileToPromptsRow(Number(row.dataset.index), { scroll: false });
        });
    }
    const grid = modal.querySelector('.ctp-list');
    if (grid) {
        grid.addEventListener('keydown', (e) => {
            if (!compileToPromptsQueue.length || e.target !== grid) return;
            const current = compileToPromptsSelectedIndex;
            let next = null;
            if (e.key === 'ArrowDown') next = current + 1;
            else if (e.key === 'ArrowUp') next = current - 1;
            else if (e.key === 'Home') next = 0;
            else if (e.key === 'End') next = compileToPromptsQueue.length - 1;
            else if (e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                const entry = compileToPromptsQueue[current];
                if (entry) setCompileToPromptsIncluded(current, !entry.included);
                return;
            }
            if (next === null) return;
            e.preventDefault();
            e.stopPropagation();
            selectCompileToPromptsRow(next);
        });
    }
}

let compileToPromptsKeyboardWired = false;

function handleCompileToPromptsKeydown(e) {
    const modal = document.getElementById('compileToPromptsModal');
    if (!modal || modal.classList.contains('hidden')) return;

    if (e.key === 'Enter' && !modalKeyboardSkipPrimaryEnter(e.target)) {
        e.preventDefault();
        e.stopPropagation();
        handleCompileToPromptsApply(e.shiftKey);
        return true;
    }
}

function wireCompileToPromptsKeyboard() {
    if (compileToPromptsKeyboardWired) return;
    compileToPromptsKeyboardWired = true;
    // registerKeyboardListener: public/scripts/comp/modalKeyboardRegistry.js
    registerKeyboardListener({
        id: 'compileToPromptsModal.keydown',
        handler: handleCompileToPromptsKeydown,
        type: 'whenFocused',
        modalId: 'compileToPromptsModal',
        priority: 75,
        critical: true,
        showInOverlay: false
    });
    registerModalOverlayEntries('compileToPromptsModal', 'Compile Prompts', [
        { id: 'overlay.compileToPromptsModal.apply', label: 'Apply', keys: 'Enter', icon: 'fas fa-check' },
        { id: 'overlay.compileToPromptsModal.applyClose', label: 'Apply and close', keys: 'Shift+Enter', icon: 'fas fa-check-double' },
        { id: 'overlay.compileToPromptsModal.close', label: 'Close', keys: 'Alt+Q', icon: 'fas fa-times' }
    ]);
}

window.wsClient.registerInitStep(462, 'Compile to Prompts', async () => {
    wireCompileToPromptsModal();
    wireCompileToPromptsKeyboard();
});
