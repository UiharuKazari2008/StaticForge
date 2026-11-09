/**
 * Phasewalker — multi-step variation pipeline + managed expanders (_P/_N).
 * public/scripts/comp/modalUtils.js (openModal, closeModal)
 * public/scripts/app.js (addPipelineStage, pipeline stage helpers)
 * public/scripts/comp/requestBodyReplacementsModal.js (requestBodyReplacements)
 * public/scripts/comp/utilities.js (escapeHtml, escapeHtmlAttribute)
 */

function bracketGenIsEditorOpen() {
    const manualModal = document.getElementById('manualModal');
    return manualModal && !manualModal.classList.contains('hidden');
}

function bracketGenIsAppletActive() {
    const modal = document.getElementById('bracketGenerationModal');
    if (!modal || modal.classList.contains('hidden') ||
        modal.classList.contains('minimised') || modal.classList.contains('minimising')) {
        return false;
    }
    if (window.isDesktop) {
        return modal.classList.contains('active-window');
    }
    return true;
}

/** Step/keyword data for context menus — does not require Phasewalker window focus. */
function bracketGenGetStepMenuData() {
    const applet = bracketGenerationApplet;
    if (!applet) return null;

    let keywords = Array.isArray(applet.state.keywords) ? applet.state.keywords : [];
    let keywordSteps = applet.state.keywordSteps || {};
    let stepNames = Array.isArray(applet.state.stepNames) ? applet.state.stepNames : [];
    let useAppletLabels = keywords.length > 0;

    if (keywords.length === 0 && hasManagedBracketArtifacts()) {
        const rebuilt = rebuildToolStateFromEditor();
        if (rebuilt && rebuilt.keywords && rebuilt.keywords.length > 0) {
            keywords = rebuilt.keywords;
            keywordSteps = rebuilt.keywordSteps || {};
            stepNames = Array.isArray(rebuilt.stepNames) ? rebuilt.stepNames : [];
            useAppletLabels = false;
        }
    }

    if (!keywords.length) return null;

    return {
        keywords,
        keywordSteps,
        stepLabel(index) {
            if (useAppletLabels && typeof applet.getStepDisplayName === 'function') {
                return applet.getStepDisplayName(index);
            }
            const name = stepNames[index];
            return (name && String(name).trim()) || `Step ${index + 1}`;
        }
    };
}

/** Hydrate in-memory Phasewalker state from applet or editor before writing a step. */
function bracketGenEnsureStepStateReady() {
    const applet = bracketGenerationApplet;
    if (!applet) return false;
    if (applet.state.keywords && applet.state.keywords.length > 0) return true;
    if (hasManagedBracketArtifacts()) {
        const rebuilt = rebuildToolStateFromEditor();
        if (rebuilt && rebuilt.keywords && rebuilt.keywords.length > 0) {
            applet.hydrateFromSnapshot(rebuilt);
            return true;
        }
    }
    return false;
}

let bracketGenStepIdSeq = 0;
/** A step id unique in this page (ids find a step's text box; rows padded, rebuilt or added later
 *  must not reuse an id another row of the same keyword still has). */
function bracketGenNewStepId(keyword) {
    bracketGenStepIdSeq += 1;
    return `pw_${Date.now().toString(36)}_${bracketGenStepIdSeq}_${keyword}`;
}

function bracketGenExpanderStageIndex(replacement) {
    if (!replacement || replacement.stages === undefined) return null;
    if (Array.isArray(replacement.stages) && replacement.stages.length > 0) {
        return replacement.stages[0];
    }
    if (typeof replacement.stages === 'object' && replacement.stages.start !== undefined) {
        return replacement.stages.start;
    }
    return null;
}

function bracketGenParseKeywordFromName(name) {
    const m = String(name || '').match(/^(.+)_(P|N)$/);
    if (!m) return null;
    return { keyword: m[1], field: m[2] === 'P' ? 'prompt' : 'uc' };
}

function bracketGenGetPipelineStageTargetIndex(stageItem) {
    const container = document.getElementById('pipelineStagesContainer');
    if (!container || !stageItem) return null;
    const all = Array.from(container.querySelectorAll('.pipeline-stage-item'));
    const idx = all.indexOf(stageItem);
    return idx >= 0 ? idx + 1 : null;
}

function bracketGenSanitizeCompareSourceStepIndex(snapshot, keywordSteps) {
    const keywords = Array.isArray(snapshot?.keywords) ? snapshot.keywords : [];
    const maxSteps = keywords.length
        ? Math.max(...keywords.map((kw) => (keywordSteps?.[kw] || []).length), 0)
        : 0;
    let compareSourceStepIndex = snapshot?.compareSourceStepIndex;
    if (compareSourceStepIndex !== null && compareSourceStepIndex !== undefined) {
        compareSourceStepIndex = Number(compareSourceStepIndex);
        if (!Number.isFinite(compareSourceStepIndex) || compareSourceStepIndex < 0 || maxSteps <= 1
            || compareSourceStepIndex >= maxSteps - 1) {
            compareSourceStepIndex = null;
        }
    } else {
        compareSourceStepIndex = null;
    }
    return compareSourceStepIndex;
}

function bracketGenMigrateSnapshot(snapshot) {
    if (!snapshot) return { keywords: [], keywordSteps: {}, compareSourceStepIndex: null };
    const keywords = Array.isArray(snapshot.keywords) ? [...snapshot.keywords] : [];
    if (snapshot.keywordSteps && typeof snapshot.keywordSteps === 'object') {
        const keywordSteps = JSON.parse(JSON.stringify(snapshot.keywordSteps));
        return {
            keywords,
            keywordSteps,
            stepNames: Array.isArray(snapshot.stepNames) ? [...snapshot.stepNames] : [],
            compareSourceStepIndex: bracketGenSanitizeCompareSourceStepIndex(snapshot, keywordSteps)
        };
    }
    const keywordSteps = {};
    keywords.forEach((kw) => { keywordSteps[kw] = []; });
    if (Array.isArray(snapshot.steps)) {
        snapshot.steps.forEach((step, i) => {
            keywords.forEach((kw) => {
                const cell = step.cells && step.cells[kw] ? step.cells[kw] : { prompt: '', uc: '' };
                keywordSteps[kw].push({
                    id: step.id ? `${step.id}_${kw}` : `bracket_${kw}_step_${i}`,
                    prompt: cell.prompt || '',
                    uc: cell.uc || ''
                });
            });
        });
    }
    return {
        keywords,
        keywordSteps,
        stepNames: Array.isArray(snapshot.stepNames) ? [...snapshot.stepNames] : [],
        compareSourceStepIndex: bracketGenSanitizeCompareSourceStepIndex(snapshot, keywordSteps)
    };
}

/** A step's name as it is saved: blank when it is the default "Step N" (getStepDisplayName shows
 *  that default for a blank name, and older files store either). */
function bracketGenStoredStepName(name, index) {
    const text = String(name || '').trim();
    return text === `Step ${index + 1}` ? '' : text;
}

function bracketGenNormalizeSnapshotForCompare(snapshot) {
    if (!snapshot) return null;
    const keywords = Array.isArray(snapshot.keywords) ? [...snapshot.keywords] : [];
    const keywordSteps = {};
    let maxSteps = 0;
    keywords.forEach((kw) => {
        keywordSteps[kw] = (snapshot.keywordSteps?.[kw] || []).map((s) => ({
            prompt: String(s.prompt || ''),
            uc: String(s.uc || '')
        }));
        maxSteps = Math.max(maxSteps, keywordSteps[kw].length);
    });
    const names = Array.isArray(snapshot.stepNames) ? snapshot.stepNames : [];
    const stepNames = [];
    for (let i = 0; i < maxSteps; i++) stepNames.push(bracketGenStoredStepName(names[i], i));
    return {
        keywords,
        useStage0: snapshot.useStage0 !== false,
        keywordSteps,
        stepNames,
        compareSourceStepIndex: bracketGenSanitizeCompareSourceStepIndex(snapshot, snapshot.keywordSteps)
    };
}

function bracketGenSnapshotsEqual(a, b) {
    return JSON.stringify(bracketGenNormalizeSnapshotForCompare(a))
        === JSON.stringify(bracketGenNormalizeSnapshotForCompare(b));
}

function hasManagedBracketArtifacts() {
    const container = document.getElementById('pipelineStagesContainer');
    if (container && container.querySelector('.pipeline-stage-item[data-managed="true"]')) {
        return true;
    }
    if (typeof requestBodyReplacements !== 'undefined' && requestBodyReplacements.some((r) => r.managed)) {
        return true;
    }
    return false;
}

/** The Studio's managed (Phasewalker) stage items, in pipeline order. */
function bracketGenManagedStageItems() {
    const container = document.getElementById('pipelineStagesContainer');
    if (!container) return [];
    return Array.from(container.querySelectorAll('.pipeline-stage-item[data-managed="true"]'));
}

/** Where an expander's stage target points: 'base' for stage 0, 'm<k>' for the k-th managed
 *  stage, 'x<t>' for anything else. Compile puts its stages after any stage the user already had,
 *  so the k-th managed stage is not always pipeline stage k. */
function bracketGenStageSlot(target, managedItems) {
    const t = Number(target);
    if (t === 0) return 'base';
    const items = managedItems || bracketGenManagedStageItems();
    const k = items.findIndex((el) => bracketGenGetPipelineStageTargetIndex(el) === t);
    return k >= 0 ? `m${k}` : `x${t}`;
}

/** What is compiled into the Studio now: managed expanders and stage names by slot. */
function bracketGenEditorCompiledSignature() {
    const managedItems = bracketGenManagedStageItems();
    const managed = typeof requestBodyReplacements !== 'undefined'
        ? requestBodyReplacements.filter((r) => r.managed)
        : [];
    if (!managedItems.length && !managed.length) return null;
    const rows = managed.map((r) => `${r.name}@${bracketGenStageSlot(bracketGenExpanderStageIndex(r), managedItems)}=${bracketGenExpanderValueText(r)}`);
    rows.sort();
    return JSON.stringify({
        rows,
        base: bracketGenGetManagedStep0PhaseName(),
        stages: managedItems.map((el) => String(el.dataset.phaseStepName || '').trim())
    });
}

function rebuildToolStateFromEditor() {
    const managedStageItems = bracketGenManagedStageItems();
    const managedReplacements =
        typeof requestBodyReplacements !== 'undefined'
            ? requestBodyReplacements.filter((r) => r.managed)
            : [];

    if (managedStageItems.length === 0 && managedReplacements.length === 0) {
        return null;
    }

    const keywordsSet = new Set();
    managedReplacements.forEach((r) => {
        const parsed = bracketGenParseKeywordFromName(r.name);
        if (parsed) keywordsSet.add(parsed.keyword);
    });
    const keywords = Array.from(keywordsSet).sort();

    // Use Stage 0 is on when a managed expander targets the base stage
    const useStage0 = managedReplacements.some((r) => bracketGenExpanderStageIndex(r) === 0);
    const offset = useStage0 ? 1 : 0;

    const keywordSteps = {};
    keywords.forEach((kw) => { keywordSteps[kw] = []; });

    const valueAt = (kw, suffix, target) => {
        const exp = managedReplacements.find(
            (r) => r.name === `${kw}_${suffix}` && bracketGenExpanderStageIndex(r) === target
        );
        return exp ? bracketGenExpanderValueText(exp) : '';
    };
    const ensureStep = (kw, stepIdx, prompt, uc) => {
        while (keywordSteps[kw].length <= stepIdx) {
            keywordSteps[kw].push({ id: bracketGenNewStepId(kw), prompt: '', uc: '' });
        }
        keywordSteps[kw][stepIdx].prompt = prompt;
        keywordSteps[kw][stepIdx].uc = uc;
    };

    if (useStage0) {
        keywords.forEach((kw) => ensureStep(kw, 0, valueAt(kw, 'P', 0), valueAt(kw, 'N', 0)));
    }

    managedStageItems.forEach((stageItem, ordinal) => {
        const target = bracketGenGetPipelineStageTargetIndex(stageItem);
        keywords.forEach((kw) => ensureStep(kw, ordinal + offset, valueAt(kw, 'P', target), valueAt(kw, 'N', target)));
    });

    if (managedStageItems.length === 0 && keywords.length > 0) {
        keywords.forEach((kw) => {
            if (keywordSteps[kw].length === 0) ensureStep(kw, 0, '', '');
        });
    }

    const stepNames = [];
    if (useStage0) stepNames[0] = bracketGenGetManagedStep0PhaseName();
    managedStageItems.forEach((stageItem, ordinal) => {
        while (stepNames.length < ordinal + offset) stepNames.push('');
        stepNames[ordinal + offset] = stageItem.dataset.phaseStepName || '';
    });

    return { keywords, keywordSteps, stepNames, useStage0, compareSourceStepIndex: null };
}

function syncManagedBracketEditorSaveFlags() {
    const hasManaged = hasManagedBracketArtifacts();
    const saveStage0Btn = document.getElementById('saveStage0Btn');
    if (saveStage0Btn) {
        if (hasManaged) {
            saveStage0Btn.dataset.state = 'on';
            saveStage0Btn.dataset.managedLock = 'true';
            saveStage0Btn.disabled = true;
            if (typeof updateManualUpscaleVisibility === 'function') {
                updateManualUpscaleVisibility();
            }
        } else {
            delete saveStage0Btn.dataset.managedLock;
            saveStage0Btn.disabled = false;
        }
    }
    getManagedStageElements().forEach((el) => {
        const saveResultsBtn = document.getElementById(`${el.id}_saveResultsToggle`);
        if (saveResultsBtn) {
            saveResultsBtn.dataset.state = 'on';
            saveResultsBtn.dataset.managedLock = 'true';
            saveResultsBtn.disabled = true;
        }
    });
    bracketGenNotifyTrayChrome();
}

function deleteAllManagedBracketArtifacts() {
    const container = document.getElementById('pipelineStagesContainer');
    if (container) {
        Array.from(container.querySelectorAll('.pipeline-stage-item[data-managed="true"]')).forEach((el) => {
            if (typeof deletePipelineStage === 'function') {
                el.dataset.managed = 'false';
                deletePipelineStage(el.id);
            } else {
                el.remove();
            }
        });
    }

    if (typeof requestBodyReplacements !== 'undefined') {
        for (let i = requestBodyReplacements.length - 1; i >= 0; i--) {
            if (requestBodyReplacements[i].managed) {
                requestBodyReplacements.splice(i, 1);
            }
        }
        if (typeof renderRequestBodyReplacementsList === 'function') {
            renderRequestBodyReplacementsList();
        }
    }

    if (typeof updatePipelineStagesHeaderVisibility === 'function') {
        updatePipelineStagesHeaderVisibility();
    }
    if (typeof updateSaveStage0BtnVisibility === 'function') {
        updateSaveStage0BtnVisibility();
    }
    if (typeof updateStageButtonStates === 'function') {
        updateStageButtonStates();
    }
    if (typeof updateAllStageHexIds === 'function') {
        updateAllStageHexIds();
    }
    if (typeof syncManagedBracketEditorSaveFlags === 'function') {
        syncManagedBracketEditorSaveFlags();
    }
}

function bracketGenAppendPlaceholderIfMissing(textarea, token) {
    if (!textarea || !token) return false;
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('!' + escaped + '(?:\\b|$)');
    if (re.test(textarea.value)) return false;
    const trimmed = textarea.value.trim();
    // setTextareaValuePreservingUndo: public/scripts/comp/textareaUtils.js
    setTextareaValuePreservingUndo(textarea, trimmed ? `${trimmed}, !${token}` : `!${token}`);
    bracketGenRefreshPromptTextarea(textarea);
    return true;
}

// emphasisEditing.js, emphasisHighlight.js (applyFormattedText, updateEmphasisHighlighting)
// public/scripts/comp/utilities.js (autoResizeTextarea)
// public/scripts/comp/promptTextareaToolbar.js (updateTokenCount)
function bracketGenRefreshPromptTextarea(textarea) {
    if (!textarea) return;
    if (typeof applyFormattedText === 'function') {
        applyFormattedText(textarea, true);
    }
    if (typeof updateEmphasisHighlighting === 'function') {
        updateEmphasisHighlighting(textarea);
    }
    if (typeof autoResizeTextarea === 'function') {
        autoResizeTextarea(textarea);
    }
    if (promptTextareaToolbar && typeof promptTextareaToolbar.updateTokenCount === 'function') {
        promptTextareaToolbar.updateTokenCount(textarea);
    }
}

function bracketGenRefreshAllStepTextareas(container) {
    if (!container) return;
    container.querySelectorAll('textarea[data-step-id]').forEach((ta) => {
        bracketGenRefreshPromptTextarea(ta);
    });
}

function bracketGenCollectPositiveFields(values) {
    const fields = [];
    const manualPrompt = document.getElementById('manualPrompt');
    const manualPromptNegative = document.getElementById('manualPromptNegative');
    if (manualPrompt) fields.push(manualPrompt.value);
    if (manualPromptNegative) fields.push(manualPromptNegative.value);
    const characterPrompts = values && values.characterPrompts
        ? values.characterPrompts
        : (typeof getCharacterPrompts === 'function' ? getCharacterPrompts() : []);
    characterPrompts.forEach((c) => {
        if (c.prompt) fields.push(c.prompt);
    });
    return fields.join('\n');
}

function bracketGenCollectNegativeFields(values) {
    const fields = [];
    const manualUc = document.getElementById('manualUc');
    const manualPromptNegative = document.getElementById('manualPromptNegative');
    if (manualUc) fields.push(manualUc.value);
    if (manualPromptNegative) fields.push(manualPromptNegative.value);
    const characterPrompts = values && values.characterPrompts
        ? values.characterPrompts
        : (typeof getCharacterPrompts === 'function' ? getCharacterPrompts() : []);
    characterPrompts.forEach((c) => {
        if (c.uc) fields.push(c.uc);
    });
    return fields.join('\n');
}

function bracketGenFieldContainsToken(text, token) {
    if (!text || !token) return false;
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('!' + escaped + '(?:\\b|$)').test(text);
}

function bracketGenHasReplacementContent(value) {
    if (value == null) return false;
    if (Array.isArray(value)) {
        return value.some((v) => String(v || '').trim() !== '');
    }
    return String(value || '').trim() !== '';
}

function bracketGenImplicitPhaseNameFromPrompts(promptTexts) {
    const texts = [];
    (promptTexts || []).forEach((raw) => {
        const text = String(raw || '').trim();
        if (text) texts.push(text);
    });
    if (!texts.length) return '';
    const first = texts[0];
    if (texts.some((text) => text !== first)) return '';
    if (first.indexOf(',') !== -1) return '';
    return first;
}

function phasewalkerWorkspaceDesktopPath() {
    const workspaceId = (typeof activeWorkspace !== 'undefined' && activeWorkspace) ? activeWorkspace : '';
    return workspaceId ? `/Workspaces/${workspaceId}/Desktop` : '/';
}

function bracketGenKeywordHasFieldContent(keyword, field, keywordSteps) {
    const steps = keywordSteps?.[keyword] || [];
    return steps.some((s) => String(s[field] || '').trim() !== '');
}

function bracketGenPushManagedExpander(name, value, stageTarget, phaseStepName) {
    if (!bracketGenHasReplacementContent(value)) return;
    if (typeof requestBodyReplacements === 'undefined') return;
    const entry = {
        name,
        value: value || '',
        stages: [stageTarget],
        managed: true
    };
    if (phaseStepName) {
        entry.phaseStepName = phaseStepName;
    }
    requestBodyReplacements.push(entry);
}

function bracketGenGetManagedStep0PhaseName() {
    if (typeof requestBodyReplacements === 'undefined') return '';
    const stage0Expander = requestBodyReplacements.find(
        (r) => r.managed && bracketGenExpanderStageIndex(r) === 0 && r.phaseStepName
    );
    return stage0Expander ? String(stage0Expander.phaseStepName).trim() : '';
}

function bracketGenUpdateManagedStep0PhaseName(name) {
    if (typeof requestBodyReplacements === 'undefined') return;
    const trimmed = String(name || '').trim();
    const defaultName = 'Step 1';
    requestBodyReplacements.forEach((r) => {
        if (!r.managed || bracketGenExpanderStageIndex(r) !== 0) return;
        if (trimmed && trimmed !== defaultName) {
            r.phaseStepName = trimmed;
        } else {
            delete r.phaseStepName;
        }
    });
}

function bracketGenSubstituteToken(text, token, value) {
    if (!text || !token) return text || '';
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('!' + escaped + '(?:\\b|$)', 'g');
    const replacement = String(value || '').trim();
    let next = text.replace(re, replacement);
    if (next === text) return text;
    next = next.replace(/[ \t]*,(?:[ \t]*,)+[ \t]*/g, ', ');
    next = next.replace(/^[ \t]*,[ \t]*/, '');
    next = next.replace(/[ \t]*,[ \t]*$/, '');
    return next.trim();
}

function bracketGenPromptTextareas() {
    const fields = [];
    ['manualPrompt', 'manualUc', 'manualPromptNegative'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) fields.push(el);
    });
    document.querySelectorAll('.character-prompt-textarea').forEach((el) => fields.push(el));
    return fields;
}

function bracketGenExpanderValueText(entry) {
    if (!entry) return '';
    if (Array.isArray(entry.value)) return String(entry.value[0] || '');
    return String(entry.value || '');
}

function bracketGenBakeStageIntoPrompts(stageIndex) {
    if (typeof requestBodyReplacements === 'undefined') return false;
    const managed = requestBodyReplacements.filter((r) => r.managed);
    if (!managed.length) return false;
    const names = [];
    managed.forEach((entry) => {
        if (entry.name && names.indexOf(entry.name) === -1) names.push(entry.name);
    });
    const fields = bracketGenPromptTextareas();
    names.forEach((name) => {
        const entry = managed.find((row) => row.name === name && bracketGenExpanderStageIndex(row) === stageIndex);
        const value = bracketGenExpanderValueText(entry);
        fields.forEach((el) => {
            const next = bracketGenSubstituteToken(el.value, name, value);
            if (next === el.value) return;
            // setTextareaValuePreservingUndo: public/scripts/comp/textareaUtils.js
            setTextareaValuePreservingUndo(el, next);
            bracketGenRefreshPromptTextarea(el);
        });
    });
    deleteAllManagedBracketArtifacts();
    return true;
}

async function validateBracketPlaceholdersBeforeGeneration(values) {
    if (typeof requestBodyReplacements === 'undefined') {
        return true;
    }
    const managed = requestBodyReplacements.filter((r) => r.managed);
    if (managed.length === 0) return true;

    const keywordsSet = new Set();
    managed.forEach((r) => {
        const parsed = bracketGenParseKeywordFromName(r.name);
        if (parsed) keywordsSet.add(parsed.keyword);
    });
    const keywords = Array.from(keywordsSet).sort();
    if (keywords.length === 0) return true;

    const positiveText = bracketGenCollectPositiveFields(values);
    const negativeText = bracketGenCollectNegativeFields(values);

    const missingP = [];
    const missingN = [];
    managed.forEach((r) => {
        const parsed = bracketGenParseKeywordFromName(r.name);
        if (!parsed) return;
        if (parsed.field === 'prompt') {
            if (!bracketGenFieldContainsToken(positiveText, r.name)) missingP.push(r.name);
        } else if (!bracketGenFieldContainsToken(negativeText, r.name)) {
            missingN.push(r.name);
        }
    });

    const missing = [...missingP, ...missingN];
    if (missing.length === 0) return true;

    const label = missing.map((t) => `!${t}`).join(', ');
    const choice = await showConfirmationDialog(
        `Required bracket placeholder(s) not found in the request: ${label}`,
        [
            { text: 'Append', value: 'append', icon: 'fas fa-plus', className: 'btn-primary' },
            { text: 'Copy Prefix', value: 'copy', icon: 'fas fa-copy', className: 'btn-secondary' },
            { text: 'Cancel', value: 'cancel', className: 'btn-secondary' }
        ],
        null,
        { title: 'Missing Bracket Placeholders', icon: 'fas fa-brackets-curly' }
    );

    if (choice === 'append') {
        const manualPrompt = document.getElementById('manualPrompt');
        const manualUc = document.getElementById('manualUc');
        missingP.forEach((t) => bracketGenAppendPlaceholderIfMissing(manualPrompt, t));
        missingN.forEach((t) => bracketGenAppendPlaceholderIfMissing(manualUc, t));
        if (values && manualPrompt) {
            values.prompt = typeof normalizePromptNewlines === 'function'
                ? normalizePromptNewlines(manualPrompt.value).trim()
                : manualPrompt.value.trim();
        }
        if (values && manualUc) {
            values.uc = typeof normalizePromptNewlines === 'function'
                ? normalizePromptNewlines(manualUc.value).trim()
                : manualUc.value.trim();
        }
        return true;
    }
    if (choice === 'copy') {
        const text = missing.map((t) => `!${t}`).join(', ');
        try {
            // copyTextToClipboard: public/scripts/utils/dreamscapeClipboard.js
            await copyTextToClipboard(text);
            showGlassToast('info', null, 'Copied placeholders to clipboard', false, 3000, '<i class="fas fa-copy"></i>');
        } catch (err) {
            console.error('Failed to copy placeholders:', err);
        }
        return false;
    }
    return false;
}

/** Renaming a keyword renames its placeholders in the Studio's prompts (where they stand) and its
 *  compiled expanders, so the prompt, the expanders and Phasewalker keep agreeing. */
function bracketGenRenamePlaceholders(oldKeyword, newKeyword) {
    const pairs = ['P', 'N'].map((suffix) => [`${oldKeyword}_${suffix}`, `${newKeyword}_${suffix}`]);
    bracketGenPromptTextareas().forEach((el) => {
        let next = el.value;
        pairs.forEach(([from, to]) => {
            const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            next = next.replace(new RegExp('!' + escaped + '(?![A-Za-z0-9_])', 'g'), '!' + to);
        });
        if (next === el.value) return;
        // setTextareaValuePreservingUndo: public/scripts/comp/textareaUtils.js
        setTextareaValuePreservingUndo(el, next);
        bracketGenRefreshPromptTextarea(el);
    });
    if (typeof requestBodyReplacements === 'undefined') return;
    let renamed = false;
    requestBodyReplacements.forEach((r) => {
        if (!r.managed) return;
        const pair = pairs.find(([from]) => r.name === from);
        if (pair) {
            r.name = pair[1];
            renamed = true;
        }
    });
    if (renamed && typeof renderRequestBodyReplacementsList === 'function') {
        renderRequestBodyReplacementsList();
    }
}

/** Takes placeholders (!name) out of the Studio's prompts, with the comma they leave behind. */
function bracketGenStripPlaceholders(names) {
    const fields = bracketGenPromptTextareas();
    names.forEach((name) => {
        fields.forEach((el) => {
            const next = bracketGenSubstituteToken(el.value, name, '');
            if (next === el.value) return;
            // setTextareaValuePreservingUndo: public/scripts/comp/textareaUtils.js
            setTextareaValuePreservingUndo(el, next);
            bracketGenRefreshPromptTextarea(el);
        });
    });
}

class BracketGenerationApplet {
    constructor() {
        this.modal = null;
        this.stepsContainer = null;
        this.state = {
            keywords: [],
            keywordSteps: {},
            stepNames: [],
            activeKeyword: '',
            activeField: 'prompt',
            useStage0: true,
            compareSourceStepIndex: null
        };
        this._skipCloseConfirm = false;
        this._desktopShortcut = null;
        this._vfsFile = null;
        this._savedSnapshot = null;
        this._chromeTimer = 0;
        this.trayEl = null;
        this.trayGlyph = null;
        this.trayMenuConfig = null;
        this._trayInitialized = false;
    }

    getActiveKeywordSteps() {
        const kw = this.state.activeKeyword;
        if (!kw) return [];
        if (!this.state.keywordSteps[kw]) {
            this.state.keywordSteps[kw] = [];
        }
        return this.state.keywordSteps[kw];
    }

    getMaxStepCount() {
        if (this.state.keywords.length === 0) return 0;
        return Math.max(
            ...this.state.keywords.map((kw) => (this.state.keywordSteps[kw] || []).length),
            0
        );
    }

    syncKeywordStepCounts() {
        const max = this.getMaxStepCount();
        this.state.keywords.forEach((kw) => {
            if (!this.state.keywordSteps[kw]) this.state.keywordSteps[kw] = [];
            while (this.state.keywordSteps[kw].length < max) {
                this.state.keywordSteps[kw].push({ id: bracketGenNewStepId(kw), prompt: '', uc: '' });
            }
        });
    }

    /** The Studio stage a step compiles to, as the Studio's stage list numbers it ("00" is the
     *  base image with Use Stage 0 on). */
    getStepStageHexId(index) {
        return '0' + this.getExpanderStageTarget(index).toString(16).toUpperCase();
    }

    ensureStepNamesLength() {
        const max = this.getMaxStepCount();
        if (!Array.isArray(this.state.stepNames)) this.state.stepNames = [];
        while (this.state.stepNames.length < max) this.state.stepNames.push('');
        if (this.state.stepNames.length > max) this.state.stepNames.length = max;
    }

    getStepDisplayName(index) {
        this.ensureStepNamesLength();
        const name = this.state.stepNames[index];
        if (name && String(name).trim()) return String(name).trim();
        return `Step ${index + 1}`;
    }

    /** Names are stored blank when they are the default "Step N". */
    setStepName(index, name) {
        this.ensureStepNamesLength();
        if (index < 0 || index >= this.getMaxStepCount()) return;
        this.state.stepNames[index] = bracketGenStoredStepName(name, index);
        if (index === 0 && this.state.useStage0) {
            bracketGenUpdateManagedStep0PhaseName(this.state.stepNames[0]);
        }
    }

    stepNameInput(index) {
        return this.stepsContainer?.querySelector(`.bracket-gen-step-item[data-step-index="${index}"] .bracket-gen-step-name-input`) || null;
    }

    applyStepNameToRow(index) {
        const input = this.stepNameInput(index);
        if (input && document.activeElement !== input) input.value = this.state.stepNames[index] || '';
    }

    /** The name compile gives a stage: the step's own name, or the prompt itself when every
     *  keyword's prompt is the same single tag (it then becomes the step's name too). */
    implicitPhaseName(index) {
        const prompts = this.state.keywords.map((kw) => {
            const steps = this.state.keywordSteps[kw] || [];
            return index < steps.length ? steps[index].prompt : '';
        });
        return bracketGenImplicitPhaseNameFromPrompts(prompts);
    }

    phaseNameFor(index) {
        this.ensureStepNamesLength();
        return String(this.state.stepNames[index] || '').trim() || this.implicitPhaseName(index);
    }

    resolvePhaseNameForCompile(index) {
        const name = this.phaseNameFor(index);
        if (name && !String(this.state.stepNames[index] || '').trim()) {
            this.setStepName(index, name);
            this.applyStepNameToRow(index);
        }
        return name;
    }

    /** Reads the name boxes into the state. Rows are matched by step id, so rows left from an
     *  earlier session (state replaced, not rendered yet) are ignored. */
    saveStepNamesFromInputs() {
        if (!this.stepsContainer) return;
        const steps = this.getActiveKeywordSteps();
        this.stepsContainer.querySelectorAll('.bracket-gen-step-item').forEach((item) => {
            const idx = steps.findIndex((s) => s.id === item.dataset.stepId);
            if (idx < 0) return;
            const input = item.querySelector('.bracket-gen-step-name-input');
            if (input) this.setStepName(idx, input.value);
        });
    }

    /** The managed Studio stage that a step compiled to (null for the base stage or when not compiled). */
    managedStageItemForStep(stepIndex) {
        const ordinal = stepIndex - (this.state.useStage0 ? 1 : 0);
        if (ordinal < 0) return null;
        return bracketGenManagedStageItems()[ordinal] || null;
    }

    /** A managed stage renamed in the Studio renames its step here. */
    syncStepNameFromPipelineStage(stageId, name) {
        const stageItem = document.getElementById(stageId);
        if (!stageItem || stageItem.dataset.managed !== 'true') return;
        const ordinal = bracketGenManagedStageItems().indexOf(stageItem);
        if (ordinal < 0) return;
        const nameIdx = ordinal + (this.state.useStage0 ? 1 : 0);
        if (nameIdx >= this.getMaxStepCount()) return;
        this.setStepName(nameIdx, name);
        this.applyStepNameToRow(nameIdx);
        this.scheduleChrome();
    }

    syncPipelineStageNameForStepIndex(stepIndex) {
        const stageItem = this.managedStageItemForStep(stepIndex);
        if (!stageItem) return;
        // setPipelineStageDisplayName: public/scripts/comp/pipelineStageManager.js
        if (typeof setPipelineStageDisplayName === 'function') {
            setPipelineStageDisplayName(stageItem.id, String(this.state.stepNames[stepIndex] || '').trim());
        }
    }

    init() {
        this.modal = document.getElementById('bracketGenerationModal');
        if (!this.modal) return;
        if (this.modal.dataset.bracketGenInitWired === 'true') return;
        this.modal.dataset.bracketGenInitWired = 'true';

        this.stepsContainer = document.getElementById('bracketStepsContainer');

        document.getElementById('closeBracketGenerationBtn')?.addEventListener('click', () => this.requestClose());

        this.modal.querySelector('.phasewalker-toolbar')?.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-pw-cmd]');
            if (!btn || btn.disabled) return;
            this.runCommand(btn.dataset.pwCmd);
        });

        const select = document.getElementById('bracketGenKeywordSelect');
        select?.addEventListener('change', () => {
            const value = select.value;
            if (value === '__add__') {
                select.value = this.state.activeKeyword;
                void this.promptAddKeyword();
                return;
            }
            this.selectKeyword(value);
        });

        this.modal.querySelectorAll('[data-pw-menu]').forEach((btn) => this.attachMenu(btn));
        this.setupFieldTabs();
        this.setupStepEvents();
        this.setupStepTabNavigation();
        this.wireKeyboardOverlayEntries();
        this.updateKeywordSelect();
    }

    runCommand(cmd) {
        switch (cmd) {
            case 'new': void this.newDocument(); break;
            case 'open': void this.openFromVfs(); break;
            case 'save': void this.save(); break;
            case 'save-as': void this.saveAsDesktop(); break;
            case 'load-studio': this.loadFromEditor(); break;
            case 'close': void this.requestClose(); break;
            case 'add-keyword': void this.promptAddKeyword(); break;
            case 'rename-keyword': void this.renameKeyword(); break;
            case 'delete-keyword': void this.deleteKeyword(); break;
            case 'add-stage': void this.addStep(); break;
            case 'toggle-stage0': this.toggleUseStage0(); break;
            case 'compile': this.compileStages(); break;
            case 'delete-stages': void this.deleteStages(); break;
            case 'field-prompt': this.setActiveField('prompt'); break;
            case 'field-uc': this.setActiveField('uc'); break;
            default:
                if (cmd && cmd.startsWith('keyword:')) this.selectKeyword(cmd.slice(8));
        }
    }

    wireKeyboardOverlayEntries() {
        if (this._keyboardOverlayWired) return;
        this._keyboardOverlayWired = true;
        registerKeyboardListener({
            id: 'overlay.bracketGenerationModal.close',
            type: 'whenFocused',
            modalId: 'bracketGenerationModal',
            label: 'Close',
            keys: 'Alt+Q',
            overlayIcon: 'fas fa-times',
            overlayGroup: 'Phasewalker',
            overlayOnly: true,
            priority: -10
        });
        registerKeyboardListener({
            id: 'overlay.bracketGenerationModal.stepTab',
            type: 'whenFocused',
            modalId: 'bracketGenerationModal',
            label: 'Next step field',
            keys: 'Tab',
            overlayIcon: 'fas fa-arrow-right',
            overlayGroup: 'Phasewalker',
            overlayOnly: true,
            priority: -10
        });
    }

    /** The Win32 menus (contextMenu click menus on the menu bar titles), rebuilt on every open. */
    attachMenu(btn) {
        // contextMenu.attachClickMenuToElement: public/scripts/comp/contextMenu.js
        if (!btn || typeof contextMenu === 'undefined' || !contextMenu) return;
        const which = btn.dataset.pwMenu;
        const config = {
            sections: [{ type: 'list', items: [] }],
            beforeShow: () => { config.sections[0].items = this.buildMenuItems(which); },
            onAction: (action) => this.runCommand(action)
        };
        contextMenu.attachClickMenuToElement(btn, config);
    }

    buildMenuItems(which) {
        const hasKeyword = !!this.state.activeKeyword;
        const editorOpen = bracketGenIsEditorOpen();
        const compiled = hasManagedBracketArtifacts();
        if (which === 'file') {
            return [
                { text: 'New', action: 'new' },
                { text: 'Open...', action: 'open' },
                { text: 'Save', action: 'save', disabled: !this.hasToolData() },
                { text: 'Save As...', action: 'save-as', disabled: !this.hasToolData() },
                { separator: true },
                { text: 'Load from Studio', action: 'load-studio', disabled: !editorOpen || !compiled },
                { separator: true },
                { text: 'Close', action: 'close', subtext: 'Alt+Q' }
            ];
        }
        if (which === 'keyword') {
            const items = [
                { text: 'Add Keyword...', action: 'add-keyword', subtext: 'Alt+K' },
                { text: 'Rename Keyword...', action: 'rename-keyword', disabled: !hasKeyword },
                { text: 'Delete Keyword', action: 'delete-keyword', disabled: !hasKeyword }
            ];
            if (this.state.keywords.length) {
                items.push({ separator: true });
                this.state.keywords.forEach((kw) => items.push({
                    text: kw,
                    action: `keyword:${kw}`,
                    showIndicator: true,
                    indicatorMark: 'radio',
                    checked: kw === this.state.activeKeyword
                }));
            }
            return items;
        }
        if (which === 'stage') {
            return [
                { text: 'Add Stage', action: 'add-stage', subtext: 'Alt+A' },
                { separator: true },
                { text: 'Use Stage 0', action: 'toggle-stage0', showIndicator: true, checked: this.state.useStage0 },
                { separator: true },
                { text: 'Compile', action: 'compile', subtext: 'F8', disabled: !editorOpen || !this.hasToolData() },
                { text: 'Delete Compiled Stages', action: 'delete-stages', disabled: !compiled }
            ];
        }
        return [
            { text: 'Prompt', action: 'field-prompt', subtext: 'F1', showIndicator: true, indicatorMark: 'radio', checked: this.state.activeField === 'prompt' },
            { text: 'Undesired Content', action: 'field-uc', subtext: 'F2', showIndicator: true, indicatorMark: 'radio', checked: this.state.activeField === 'uc' }
        ];
    }

    setupStepTabNavigation() {
        if (!this.modal || this.modal.dataset.bracketTabNavWired === 'true') return;
        this.modal.dataset.bracketTabNavWired = 'true';
        this.modal.addEventListener('keydown', (e) => this.handleStepTabKeydown(e), true);
    }

    bracketGenIsAutocompleteTabReserved() {
        const overlay = document.getElementById('characterAutocompleteOverlay');
        return overlay && !overlay.classList.contains('hidden');
    }

    /** Tab in a stage's prompt box moves to the next stage's box (the prompt box keeps Tab for
     *  autocomplete while its list is open). */
    handleStepTabKeydown(e) {
        if (!bracketGenIsAppletActive()) return;
        if (e.key !== 'Tab' || e.metaKey || e.ctrlKey || e.altKey) return;
        const target = e.target;
        if (!target.matches('textarea[data-step-id]')) return;
        if (this.bracketGenIsAutocompleteTabReserved()) return;
        e.preventDefault();
        e.stopPropagation();
        this.focusAdjacentStepTextarea(target, e.shiftKey);
    }

    focusAdjacentStepTextarea(currentTa, reverse) {
        if (!this.stepsContainer) return;
        const textareas = Array.from(this.stepsContainer.querySelectorAll('textarea[data-step-id]'));
        const idx = textareas.indexOf(currentTa);
        if (idx === -1 || textareas.length === 0) return;
        const nextIdx = reverse
            ? (idx > 0 ? idx - 1 : textareas.length - 1)
            : (idx < textareas.length - 1 ? idx + 1 : 0);
        const next = textareas[nextIdx];
        if (!next) return;
        next.focus();
        next.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }

    /** Prompt / Undesired Content: Vista tabs over the stage list. */
    setupFieldTabs() {
        const tabs = document.getElementById('bracketGenTabButtons');
        if (!tabs) return;
        tabs.addEventListener('click', (e) => {
            const tab = e.target.closest('[role="tab"]');
            if (tab) this.setActiveField(tab.dataset.tab === 'uc' ? 'uc' : 'prompt');
        });
        tabs.addEventListener('keydown', (e) => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
            e.preventDefault();
            this.setActiveField(this.state.activeField === 'uc' ? 'prompt' : 'uc');
            tabs.querySelector('[aria-selected="true"]')?.focus();
        });
    }

    setActiveField(field) {
        if (field !== 'prompt' && field !== 'uc') return;
        this.saveStepTextareasToState();
        this.state.activeField = field;
        const tabs = document.getElementById('bracketGenTabButtons');
        if (tabs) {
            tabs.dataset.active = field;
            tabs.querySelectorAll('[role="tab"]').forEach((b) => {
                const on = b.dataset.tab === field;
                b.setAttribute('aria-selected', on ? 'true' : 'false');
                b.tabIndex = on ? 0 : -1;
            });
        }
        this.updateStepFieldDisplay();
    }

    fieldPlaceholder() {
        const kw = this.state.activeKeyword;
        if (!kw) return '';
        return this.state.activeField === 'uc'
            ? `Undesired content for ${kw} in this stage`
            : `Prompt for ${kw} in this stage`;
    }

    updateStepFieldDisplay() {
        if (!this.stepsContainer) return;
        const field = this.state.activeField;
        const steps = this.getActiveKeywordSteps();
        const placeholder = this.fieldPlaceholder();
        this.stepsContainer.querySelectorAll('textarea[data-step-id]').forEach((ta) => {
            const step = steps.find((s) => s.id === ta.dataset.stepId);
            if (step) {
                ta.value = step[field] || '';
                ta.placeholder = placeholder;
            }
            bracketGenRefreshPromptTextarea(ta);
        });
    }

    selectKeyword(kw) {
        if (!kw || !this.state.keywords.includes(kw) || kw === this.state.activeKeyword) {
            this.updateKeywordSelect();
            return;
        }
        this.saveStepTextareasToState();
        this.state.activeKeyword = kw;
        this.renderSteps();
    }

    /** The toolbar's keyword combo box: the keywords, then "Add Keyword...". */
    updateKeywordSelect() {
        const select = document.getElementById('bracketGenKeywordSelect');
        if (!select) return;
        const kws = this.state.keywords;
        const sig = JSON.stringify([kws, this.state.activeKeyword]);
        if (select.dataset.sig === sig) return;
        select.dataset.sig = sig;
        select.textContent = '';
        if (!kws.length) {
            select.add(new Option('(none)', '', true, true));
            select.options[0].disabled = true;
        }
        kws.forEach((kw) => select.add(new Option(kw, kw, false, kw === this.state.activeKeyword)));
        select.add(new Option('Add Keyword...', '__add__'));
        select.value = this.state.activeKeyword || '';
    }

    boundDocument() {
        return this._vfsFile || this._desktopShortcut || null;
    }

    suggestFileName() {
        const bound = this.boundDocument();
        if (bound && bound.name) return bound.name;
        if (this.state.keywords.length) return this.state.keywords.join(', ');
        return 'Phasewalker';
    }

    documentName() {
        const bound = this.boundDocument();
        return (bound && bound.name) || 'Untitled';
    }

    /** Unsaved work: a bound file with changes, or data that was never saved. */
    hasUnsavedChanges() {
        if (!this.hasToolData()) return false;
        if (this.boundDocument()) return this.isShortcutDirty();
        return true;
    }

    /** Before New / Open replace the work: "Do you want to save changes to ...?" (Save, Don't
     *  Save, Cancel). Resolves true when the work may be replaced. */
    async confirmDiscardChanges() {
        this.saveStepTextareasToState();
        if (!this.hasUnsavedChanges()) return true;
        const choice = await showConfirmationDialog(
            `Do you want to save changes to ${escapeHtml(this.documentName())}?`,
            [
                { text: 'Save', value: 'save', className: 'btn-standard primary' },
                { text: "Don't Save", value: 'discard', className: 'btn-standard' },
                { text: 'Cancel', value: null, className: 'btn-standard' }
            ],
            null,
            { title: 'Phasewalker' }
        );
        if (choice === 'discard') return true;
        if (choice !== 'save') return false;
        if (this.boundDocument()) {
            await this.saveBound();
            return !this.isShortcutDirty();
        }
        return this.saveAsAndWait();
    }

    resetState() {
        this._desktopShortcut = null;
        this._vfsFile = null;
        this._savedSnapshot = null;
        this.state.keywords = [];
        this.state.keywordSteps = {};
        this.state.stepNames = [];
        this.state.activeKeyword = '';
        this.state.useStage0 = true;
        this.state.compareSourceStepIndex = null;
    }

    async newDocument() {
        if (!(await this.confirmDiscardChanges())) return;
        this.resetState();
        this.renderSteps();
    }

    bindDesktopShortcut(id, name, snapshot) {
        this._desktopShortcut = { id: id, name: name };
        this._vfsFile = null;
        this._savedSnapshot = JSON.parse(JSON.stringify(snapshot));
        this.updateChrome();
    }

    bindVfsFile(file, snapshot) {
        this._vfsFile = {
            id: file.id,
            name: file.name,
            path: file.path || ''
        };
        this._desktopShortcut = null;
        this._savedSnapshot = JSON.parse(JSON.stringify(snapshot));
        this.updateChrome();
    }

    /** File > Save: the bound file, or Save As when there is none yet. */
    async save() {
        if (this.boundDocument()) {
            await this.saveBound();
            return;
        }
        await this.saveAsDesktop();
    }

    async saveBound() {
        if (this._vfsFile) {
            await this.saveVfsFile();
            return;
        }
        if (this._desktopShortcut) {
            await this.saveShortcutChanges();
        }
    }

    async saveVfsFile() {
        if (!this._vfsFile || !vfsClient) {
            showGlassToast('error', null, 'File is not open', false, 4000);
            return;
        }
        const snapshot = this.getSnapshot();
        const name = this._vfsFile.name || 'Phasewalker';
        try {
            await vfsClient.updateShortcutEntry(this._vfsFile.id, {
                name: name,
                data: { label: name, state: snapshot }
            });
            this._savedSnapshot = JSON.parse(JSON.stringify(snapshot));
            this.updateChrome();
            showGlassToast('success', null, 'Saved', false, 3000);
        } catch (err) {
            console.error(err);
            showGlassToast('error', null, err.message || 'Failed to save', false, 5000);
        }
    }

    async saveAsDesktop() {
        if (!this.hasToolData()) {
            showGlassToast('warning', null, 'Nothing to save', false, 3000);
            return;
        }
        // studioOpenFolderDialog: public/scripts/comp/studioSession.js
        if (typeof studioOpenFolderDialog !== 'function') {
            showGlassToast('error', null, 'File browser unavailable', false, 4000);
            return;
        }
        const applet = this;
        await studioOpenFolderDialog('save', {
            startPath: phasewalkerWorkspaceDesktopPath(),
            host: {
                acceptType: 'bracket-generation',
                title: 'Save Phasewalker',
                suggestName() {
                    return applet.suggestFileName();
                },
                onSave(info) {
                    return applet.saveToVfsBrowser(info);
                }
            }
        });
    }

    async openFromVfs() {
        // studioOpenFolderDialog: public/scripts/comp/studioSession.js
        if (typeof studioOpenFolderDialog !== 'function') {
            showGlassToast('error', null, 'File browser unavailable', false, 4000);
            return;
        }
        if (!(await this.confirmDiscardChanges())) return;
        const applet = this;
        await studioOpenFolderDialog('open-vfs', {
            startPath: phasewalkerWorkspaceDesktopPath(),
            host: {
                acceptType: 'bracket-generation',
                title: 'Open Phasewalker',
                rejectMessage: 'Choose a Phasewalker file',
                onOpen(item, folderPath) {
                    return applet.loadFromVfsItem(item, folderPath);
                }
            }
        });
    }

    /** "Use this phase" in Stage Results bakes one phase into the prompt and removes the compiled
     *  stages: offer to keep the session first (a bound file saves in place). */
    async confirmSaveBeforeUnload() {
        this.saveStepTextareasToState();
        if (!this.hasToolData()) return true;
        if (this.boundDocument()) {
            if (this.isShortcutDirty()) await this.saveBound();
            return !this.isShortcutDirty();
        }
        const choice = await showConfirmationDialog(
            'Do you want to save the Phasewalker stages before this phase replaces them?',
            [
                { text: 'Save', value: 'save', className: 'btn-standard primary' },
                { text: "Don't Save", value: 'unload', className: 'btn-standard' },
                { text: 'Cancel', value: null, className: 'btn-standard' }
            ],
            null,
            { title: 'Phasewalker' }
        );
        if (choice === 'unload') return true;
        if (choice !== 'save') return false;
        return this.saveAsAndWait();
    }

    saveAsAndWait() {
        const modal = document.getElementById('studioSaveFolderModal');
        if (!modal) return Promise.resolve(false);
        this._unloadSaveOk = false;
        return new Promise((resolve) => {
            let done = false;
            const finish = (ok) => {
                if (done) return;
                done = true;
                observer.disconnect();
                resolve(!!ok);
            };
            const observer = new MutationObserver(() => {
                if (modal.classList.contains('hidden')) finish(this._unloadSaveOk);
            });
            observer.observe(modal, { attributes: true, attributeFilter: ['class'] });
            this.saveAsDesktop().then(() => {
                if (modal.classList.contains('hidden')) finish(this._unloadSaveOk);
            }).catch(() => finish(false));
        });
    }

    async saveToVfsBrowser(info) {
        this._unloadSaveOk = false;
        const snapshot = this.getSnapshot();
        const name = info.name;
        const data = { label: name, state: snapshot };
        const overwrite = info.overwrite || {};
        try {
            if (overwrite.overwriteId) {
                await this.writeDesktopShortcut(overwrite.overwriteId, name, data, info.workspaceId);
                this.bindDesktopShortcut(overwrite.overwriteId, name, snapshot);
            } else if (overwrite.overwriteEntryId) {
                await vfsClient.updateShortcutEntry(overwrite.overwriteEntryId, { name: name, data: data });
                this.bindVfsFile({ id: overwrite.overwriteEntryId, name: name, path: info.path }, snapshot);
            } else {
                const result = await vfsClient.createShortcut(info.path, {
                    name: name,
                    type: 'bracket-generation',
                    data: data
                }, info.workspaceId);
                if (result && result.dest === 'desktop' && result.shortcut) {
                    this.bindDesktopShortcut(result.shortcut.id, result.shortcut.name || name, snapshot);
                } else if (result && result.entry) {
                    this.bindVfsFile({
                        id: result.entry.id,
                        name: result.entry.display_name || name,
                        path: result.path || info.path
                    }, snapshot);
                }
            }
            showGlassToast('success', null, 'Saved', false, 3000);
            this._unloadSaveOk = true;
            return true;
        } catch (err) {
            console.error(err);
            showGlassToast('error', null, err.message || 'Failed to save', false, 5000);
            return false;
        }
    }

    async writeDesktopShortcut(shortcutId, name, data, workspaceId) {
        const shortcut = desktopShortcuts && desktopShortcuts.shortcuts
            ? desktopShortcuts.shortcuts.find((row) => row.id === shortcutId)
            : null;
        if (shortcut) {
            shortcut.name = name;
            shortcut.data = { ...(shortcut.data || {}), ...data };
            desktopShortcuts.updateShortcutInDOM(shortcutId, { name: name });
            if (!shortcut._isNew) {
                shortcut._isModified = true;
                shortcut._dataModified = true;
            }
            desktopShortcuts.debouncedSave();
            return;
        }
        const wsId = workspaceId || (typeof activeWorkspace !== 'undefined' ? activeWorkspace : '');
        await wsClient.updateDesktopShortcut(wsId, shortcutId, { name: name, data: data });
    }

    loadFromVfsItem(item, folderPath) {
        const state = item && item.shortcutData && item.shortcutData.state;
        if (!state) {
            showGlassToast('error', null, 'Phasewalker file has no saved state', false, 4000);
            return;
        }
        if (!this.modal) this.init();
        const opts = { state: state, autoCompile: bracketGenIsEditorOpen(), skipDiscardCheck: true };
        if (item.isVfsShortcutEntry) {
            opts.vfsFile = { id: item.id, name: item.name, path: folderPath || '' };
        } else {
            opts.desktopShortcut = { id: item.id, name: item.name };
        }
        void this.open(opts);
    }

    validateKeywordName(name, currentName) {
        const trimmed = String(name || '').trim();
        if (!trimmed) return { ok: false, error: 'Type a keyword name.' };
        if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) {
            return { ok: false, error: 'A keyword name can contain only letters, numbers and underscores.' };
        }
        if (trimmed.endsWith('_P') || trimmed.endsWith('_N')) {
            return { ok: false, error: 'A keyword name cannot end with _P or _N.' };
        }
        if (trimmed !== currentName && this.state.keywords.includes(trimmed)) {
            return { ok: false, error: `There is already a keyword named ${trimmed}.` };
        }
        return { ok: true, name: trimmed };
    }

    async promptAddKeyword() {
        const name = await showInputDialog(
            'Keyword name (letters, numbers and underscores):',
            '',
            '',
            [
                { text: 'OK', value: 'ok', className: 'btn-standard primary' },
                { text: 'Cancel', value: null, className: 'btn-standard' }
            ],
            null,
            { title: 'Add Keyword' }
        );
        if (!name) return false;
        const validated = this.validateKeywordName(name, '');
        if (!validated.ok) {
            showGlassToast('error', null, validated.error, false, 4000);
            return false;
        }
        const trimmed = validated.name;
        this.saveStepTextareasToState();
        this.state.keywords.push(trimmed);
        this.state.keywordSteps[trimmed] = [];
        this.state.activeKeyword = trimmed;
        if (this.getMaxStepCount() === 0) {
            await this.addStep();
        } else {
            this.syncKeywordStepCounts();
            this.renderSteps();
        }
        return true;
    }

    async renameKeyword() {
        const kw = this.state.activeKeyword;
        if (!kw) return;
        const name = await showInputDialog(
            'Keyword name (letters, numbers and underscores):',
            kw,
            '',
            [
                { text: 'OK', value: 'ok', className: 'btn-standard primary' },
                { text: 'Cancel', value: null, className: 'btn-standard' }
            ],
            null,
            { title: 'Rename Keyword' }
        );
        if (!name) return;
        const validated = this.validateKeywordName(name, kw);
        if (!validated.ok) {
            showGlassToast('error', null, validated.error, false, 4000);
            return;
        }
        const trimmed = validated.name;
        if (trimmed === kw) return;

        this.saveStepTextareasToState();
        const idx = this.state.keywords.indexOf(kw);
        if (idx >= 0) this.state.keywords[idx] = trimmed;
        this.state.keywordSteps[trimmed] = this.state.keywordSteps[kw];
        delete this.state.keywordSteps[kw];
        this.state.activeKeyword = trimmed;
        // the Studio's !kw_P / !kw_N placeholders follow the new name, where they stand
        bracketGenRenamePlaceholders(kw, trimmed);
        this.renderSteps();
    }

    async deleteKeyword() {
        const kw = this.state.activeKeyword;
        if (!kw) return;
        const confirmed = await showConfirmationDialog(
            `Are you sure you want to delete the keyword ${escapeHtml(kw)} and its text in every stage?`,
            [
                { text: 'Yes', value: true, className: 'btn-standard primary' },
                { text: 'No', value: false, className: 'btn-standard' }
            ],
            null,
            { title: 'Delete Keyword' }
        );
        if (!confirmed) return;

        this.saveStepTextareasToState();
        this.state.keywords = this.state.keywords.filter((k) => k !== kw);
        delete this.state.keywordSteps[kw];
        this.state.activeKeyword = this.state.keywords[0] || '';
        if (!this.state.keywords.length) {
            this.state.stepNames = [];
            this.state.compareSourceStepIndex = null;
        }
        this.renderSteps();
    }

    loadFromEditor() {
        if (!bracketGenIsEditorOpen()) {
            showGlassToast('warning', null, 'Open the Studio first', false, 4000);
            return;
        }
        const rebuilt = hasManagedBracketArtifacts() ? rebuildToolStateFromEditor() : null;
        if (!rebuilt) {
            showGlassToast('info', null, 'The Studio has no Phasewalker stages', false, 4000);
            return;
        }
        this.hydrateFromSnapshot(rebuilt);
        this.renderSteps();
        showGlassToast('success', null, 'Loaded from the Studio', false, 3000);
    }

    hasToolData() {
        return this.state.keywords.length > 0 && this.getMaxStepCount() > 0;
    }

    isShortcutDirty() {
        if (!this.boundDocument() || !this._savedSnapshot) return false;
        return !bracketGenSnapshotsEqual(this.getSnapshot(), this._savedSnapshot);
    }

    /** What compiling this session would write into the Studio, in the same form as
     *  bracketGenEditorCompiledSignature reads it back. */
    compiledSignature() {
        const rows = [];
        const stages = [];
        let base = '';
        const start = this.state.useStage0 ? 1 : 0;
        const max = this.getMaxStepCount();
        for (let i = 0; i < max; i++) {
            const slot = i < start ? 'base' : `m${i - start}`;
            const name = this.phaseNameFor(i);
            if (slot === 'base') base = '';
            else stages.push(name);
            let baseNamePending = slot === 'base' ? name : '';
            this.state.keywords.forEach((kw) => {
                const step = (this.state.keywordSteps[kw] || [])[i];
                if (!step) return;
                [['P', step.prompt], ['N', step.uc]].forEach(([suffix, value]) => {
                    if (!bracketGenHasReplacementContent(value)) return;
                    rows.push(`${kw}_${suffix}@${slot}=${value}`);
                    if (baseNamePending) {
                        base = baseNamePending;
                        baseNamePending = '';
                    }
                });
            });
        }
        rows.sort();
        return JSON.stringify({ rows, base, stages });
    }

    needsCompile() {
        if (!this.hasToolData()) return false;
        if (!bracketGenIsEditorOpen()) return true;
        const editor = bracketGenEditorCompiledSignature();
        if (!editor) return true;
        this.saveStepTextareasToState();
        return editor !== this.compiledSignature();
    }

    shouldSkipCloseConfirm() {
        if (!this.hasToolData()) return true;
        return !this.isShortcutDirty() && !this.needsCompile();
    }

    updateTitleBar() {
        const el = document.getElementById('bracketGenTitleLabel');
        if (!el) return;
        const bound = this.boundDocument();
        el.textContent = bound
            ? `${bound.name || 'Untitled'}${this.isShortcutDirty() ? '*' : ''} - Phasewalker`
            : 'Phasewalker';
    }

    /** Toolbar states and the status bar: the keyword's stage count, the keyword count and
     *  whether the Studio has this session compiled. */
    updateToolbarAndStatus() {
        if (!this.modal) return;
        const hasData = this.hasToolData();
        const editorOpen = bracketGenIsEditorOpen();
        const needs = this.needsCompile();
        const setDisabled = (cmd, off) => {
            const btn = this.modal.querySelector(`.phasewalker-toolbar [data-pw-cmd="${cmd}"]`);
            if (btn) btn.disabled = !!off;
        };
        setDisabled('save', !hasData);
        setDisabled('compile', !editorOpen || !hasData);
        const compileBtn = document.getElementById('bracketGenCompileBtn');
        if (compileBtn) compileBtn.classList.toggle('is-pending', editorOpen && needs);

        const text = document.getElementById('bracketGenStatusText');
        const count = document.getElementById('bracketGenStatusCount');
        const compiled = document.getElementById('bracketGenStatusCompiled');
        const steps = this.getMaxStepCount();
        const kws = this.state.keywords.length;
        if (text) {
            text.textContent = this.state.activeKeyword
                ? `${this.state.activeKeyword}: ${steps} stage${steps === 1 ? '' : 's'}`
                : 'No keywords';
        }
        if (count) count.textContent = `${kws} keyword${kws === 1 ? '' : 's'}`;
        if (compiled) {
            let label = '';
            if (hasData) {
                if (!editorOpen) label = 'Studio closed';
                else label = needs ? 'Not compiled' : 'Compiled';
            }
            compiled.textContent = label;
        }
    }

    updateChrome() {
        if (this._chromeTimer) {
            clearTimeout(this._chromeTimer);
            this._chromeTimer = 0;
        }
        this.updateTitleBar();
        this.updateKeywordSelect();
        this.updateToolbarAndStatus();
        this.updateTrayChrome();
    }

    /** Typing updates the chrome (title star, Compile, status, tray) once it pauses: every check
     *  reads the Studio's stages and expanders. */
    scheduleChrome() {
        if (this._chromeTimer) clearTimeout(this._chromeTimer);
        this._chromeTimer = setTimeout(() => {
            this._chromeTimer = 0;
            this.updateChrome();
        }, 250);
    }

    formatTrayTitle() {
        const menuData = bracketGenGetStepMenuData();
        if (!menuData) return 'Phasewalker';
        const stepCount = Math.max(
            0,
            ...menuData.keywords.map((kw) => (menuData.keywordSteps[kw] || []).length)
        );
        const kwPart = menuData.keywords.length === 1
            ? menuData.keywords[0]
            : `${menuData.keywords.length} keywords`;
        return `Phasewalker - ${kwPart}, ${stepCount} stage${stepCount === 1 ? '' : 's'}`;
    }

    handleTrayMenuAction(action) {
        if (action === 'pw-tray-open') {
            void this.open();
            return;
        }
        if (action === 'pw-tray-compile') {
            this.compileStages();
            return;
        }
        if (action === 'pw-tray-load') {
            this.loadFromEditor();
            return;
        }
        if (action === 'pw-tray-delete') {
            void this.deleteStages();
            return;
        }
        if (action === 'pw-tray-save') {
            void this.save();
            return;
        }
        if (action === 'pw-tray-toggle-stage0') {
            this.toggleUseStage0();
        }
    }

    /** The tray icon's menu: Open first, then the commands. */
    buildTrayMenuItems() {
        const menuData = bracketGenGetStepMenuData();
        if (!menuData) return [{ text: 'No Phasewalker data', disabled: true }];
        const editorOpen = bracketGenIsEditorOpen();
        const compiled = hasManagedBracketArtifacts();
        return [
            { text: 'Open Phasewalker', action: 'pw-tray-open' },
            { separator: true },
            { text: 'Compile', action: 'pw-tray-compile', disabled: !editorOpen || !this.hasToolData() },
            { text: 'Load from Studio', action: 'pw-tray-load', disabled: !editorOpen || !compiled },
            { text: 'Delete Compiled Stages', action: 'pw-tray-delete', disabled: !compiled },
            { separator: true },
            { text: 'Save', action: 'pw-tray-save', disabled: !this.hasToolData() },
            { text: 'Use Stage 0', action: 'pw-tray-toggle-stage0', showIndicator: true, checked: this.state.useStage0 }
        ];
    }

    refreshTrayMenuItems() {
        if (!this.trayMenuConfig || !this.trayMenuConfig.sections[0]) return;
        this.trayMenuConfig.sections[0].items = this.buildTrayMenuItems();
    }

    reRenderTrayMenuIfOpen() {
        // contextMenu.renderMenu: public/scripts/comp/contextMenu.js
        if (!contextMenu || !contextMenu.isOpen || contextMenu.currentTarget !== this.trayEl) return;
        this.refreshTrayMenuItems();
        contextMenu.renderMenu(this.trayMenuConfig, this.trayEl);
        contextMenu.executeLoadFunctions(this.trayMenuConfig, this.trayEl);
        contextMenu.updateIndicatorDots(this.trayMenuConfig);
    }

    buildTrayMenuConfig() {
        const applet = this;
        return {
            maxHeight: 420,
            beforeShow: () => applet.refreshTrayMenuItems(),
            sections: [{ type: 'list', items: [] }],
            onAction: (action) => applet.handleTrayMenuAction(action)
        };
    }

    updateTrayChrome() {
        if (!this.trayEl) return;

        const hasData = bracketGenGetStepMenuData() !== null;
        const bootPending = typeof window.isDesktopTrayBootPending === 'function'
            && window.isDesktopTrayBootPending();

        if (hasData) {
            if (!bootPending) {
                this.trayEl.classList.remove('hidden');
            }
        } else {
            this.trayEl.classList.add('hidden');
        }
        this.trayEl.title = this.formatTrayTitle();
        this.reRenderTrayMenuIfOpen();
    }

    setupTray() {
        // contextMenu.attachToElement: public/scripts/comp/contextMenu.js
        if (!this.trayEl || !contextMenu) return;

        this.trayMenuConfig = this.buildTrayMenuConfig();
        contextMenu.attachToElement(this.trayEl, this.trayMenuConfig);

        this.trayEl.addEventListener('dblclick', (e) => {
            e.preventDefault();
            e.stopPropagation();
            void this.open();
        });

        this.updateTrayChrome();
    }

    async saveShortcutChanges() {
        if (!this._desktopShortcut) {
            showGlassToast('error', null, 'Nothing to save', false, 4000);
            return;
        }
        const snapshot = this.getSnapshot();
        const name = this._desktopShortcut.name || 'Phasewalker';
        try {
            await this.writeDesktopShortcut(this._desktopShortcut.id, name, {
                label: name,
                state: snapshot
            });
            this._savedSnapshot = JSON.parse(JSON.stringify(snapshot));
            this.updateChrome();
            showGlassToast('success', null, 'Saved', false, 3000);
        } catch (err) {
            console.error(err);
            showGlassToast('error', null, err.message || 'Failed to save', false, 5000);
        }
    }

    getExpanderStageTarget(stepIndex) {
        return this.state.useStage0 ? stepIndex : stepIndex + 1;
    }

    /** The pipeline stage index a step compiled to (compareViewManager.js): the base stage, or
     *  the managed stage at the step's place among the managed stages. */
    getPipelineStageIndexForStep(stepIndex) {
        if (this.state.useStage0 && stepIndex === 0) return 0;
        const stageItem = this.managedStageItemForStep(stepIndex);
        const index = stageItem ? bracketGenGetPipelineStageTargetIndex(stageItem) : null;
        return index != null ? index : this.getExpanderStageTarget(stepIndex);
    }

    isCompareSourceStepDisabled(stepIndex) {
        return stepIndex >= this.getMaxStepCount() - 1;
    }

    normalizeCompareSourceStepIndex() {
        const max = this.getMaxStepCount();
        if (max <= 1) {
            this.state.compareSourceStepIndex = null;
            return;
        }
        const idx = this.state.compareSourceStepIndex;
        if (idx === null || idx === undefined) return;
        if (idx < 0 || idx >= max - 1) {
            this.state.compareSourceStepIndex = null;
        }
    }

    toggleCompareSourceStep(stepIndex) {
        if (this.isCompareSourceStepDisabled(stepIndex)) return;
        if (this.state.compareSourceStepIndex === stepIndex) {
            this.state.compareSourceStepIndex = null;
            // clearBracketGenPhaseCompareSource: public/scripts/comp/compareViewManager.js
            if (typeof clearBracketGenPhaseCompareSource === 'function') {
                clearBracketGenPhaseCompareSource();
            }
        } else {
            this.state.compareSourceStepIndex = stepIndex;
            // tryCaptureBracketGenPhaseCompareSourceFromPreview: public/scripts/comp/compareViewManager.js
            if (typeof tryCaptureBracketGenPhaseCompareSourceFromPreview === 'function') {
                tryCaptureBracketGenPhaseCompareSourceFromPreview();
            }
        }
        // only one stage is the source: the other check boxes clear without a re-render
        this.stepsContainer?.querySelectorAll('.bracket-gen-compare-source').forEach((box) => {
            box.checked = Number(box.dataset.stepIndex) === this.state.compareSourceStepIndex;
        });
        this.updateChrome();
    }

    toggleUseStage0() {
        this.saveStepTextareasToState();
        this.state.useStage0 = !this.state.useStage0;
        this.normalizeCompareSourceStepIndex();
        this.renderSteps();
    }

    getSnapshot() {
        this.saveStepTextareasToState();
        this.saveStepNamesFromInputs();
        return this.stateSnapshot();
    }

    /** The session as saved, from the state only (getSnapshot reads the text boxes first). */
    stateSnapshot() {
        this.normalizeCompareSourceStepIndex();
        this.ensureStepNamesLength();
        return {
            keywords: [...this.state.keywords],
            keywordSteps: JSON.parse(JSON.stringify(this.state.keywordSteps)),
            stepNames: [...this.state.stepNames],
            useStage0: this.state.useStage0,
            compareSourceStepIndex: this.state.compareSourceStepIndex
        };
    }

    hydrateFromSnapshot(snapshot) {
        if (!snapshot) return;
        const migrated = bracketGenMigrateSnapshot(snapshot);
        this.state.keywords = migrated.keywords;
        this.state.keywordSteps = migrated.keywordSteps;
        // every row gets a fresh id: saved files and MCP sessions repeat ids across loads
        this.state.keywords.forEach((kw) => {
            (this.state.keywordSteps[kw] || []).forEach((step) => { step.id = bracketGenNewStepId(kw); });
        });
        this.state.stepNames = (Array.isArray(migrated.stepNames) ? migrated.stepNames : [])
            .map((name, i) => bracketGenStoredStepName(name, i));
        this.state.useStage0 = snapshot.useStage0 !== false;
        this.state.compareSourceStepIndex = migrated.compareSourceStepIndex ?? null;
        if (!this.state.keywords.includes(this.state.activeKeyword)) {
            this.state.activeKeyword = this.state.keywords[0] || '';
        }
        this.syncKeywordStepCounts();
        this.ensureStepNamesLength();
        this.normalizeCompareSourceStepIndex();
    }

    async addStep() {
        if (this.state.keywords.length === 0) {
            await this.promptAddKeyword();
            return;
        }
        this.saveStepTextareasToState();
        this.saveStepNamesFromInputs();
        this.syncKeywordStepCounts();
        this.state.keywords.forEach((kw) => {
            this.state.keywordSteps[kw].push({ id: bracketGenNewStepId(kw), prompt: '', uc: '' });
        });
        this.ensureStepNamesLength();
        this.normalizeCompareSourceStepIndex();
        this.renderSteps();
        const last = bracketGenIsAppletActive() && this.stepsContainer?.querySelector('.bracket-gen-step-item:last-child');
        if (last) {
            last.scrollIntoView({ block: 'nearest' });
            last.querySelector('textarea[data-step-id]')?.focus();
        }
    }

    removeStepAt(removedIndex) {
        if (removedIndex < 0 || removedIndex >= this.getMaxStepCount()) return;
        this.saveStepTextareasToState();
        this.saveStepNamesFromInputs();
        this.state.keywords.forEach((k) => {
            const arr = this.state.keywordSteps[k] || [];
            if (removedIndex < arr.length) arr.splice(removedIndex, 1);
        });
        if (this.state.stepNames && removedIndex < this.state.stepNames.length) {
            this.state.stepNames.splice(removedIndex, 1);
        }
        const src = this.state.compareSourceStepIndex;
        if (src !== null) {
            if (removedIndex === src) this.state.compareSourceStepIndex = null;
            else if (removedIndex < src) this.state.compareSourceStepIndex = src - 1;
        }
        this.normalizeCompareSourceStepIndex();
        this.renderSteps();
    }

    /** Moves a stage (every keyword's text, its name and the comparison source go with it). */
    moveStep(from, to) {
        const max = this.getMaxStepCount();
        if (from === to || from < 0 || to < 0 || from >= max || to >= max) return;
        this.saveStepTextareasToState();
        this.saveStepNamesFromInputs();
        this.syncKeywordStepCounts();
        const move = (arr) => {
            const [row] = arr.splice(from, 1);
            arr.splice(to, 0, row);
        };
        this.state.keywords.forEach((k) => move(this.state.keywordSteps[k]));
        this.ensureStepNamesLength();
        move(this.state.stepNames);
        const src = this.state.compareSourceStepIndex;
        if (src !== null) {
            if (src === from) this.state.compareSourceStepIndex = to;
            else if (from < src && to >= src) this.state.compareSourceStepIndex = src - 1;
            else if (from > src && to <= src) this.state.compareSourceStepIndex = src + 1;
        }
        this.normalizeCompareSourceStepIndex();
        this.renderSteps();
        this.stepsContainer?.querySelector(`.bracket-gen-step-item[data-step-index="${to}"]`)?.scrollIntoView({ block: 'nearest' });
    }

    saveStepTextareasToState() {
        if (!this.stepsContainer) return;
        const kw = this.state.activeKeyword;
        const field = this.state.activeField;
        if (!kw) return;
        const byId = new Map();
        this.stepsContainer.querySelectorAll('textarea[data-step-id]').forEach((ta) => byId.set(ta.dataset.stepId, ta));
        this.getActiveKeywordSteps().forEach((step) => {
            const ta = byId.get(step.id);
            if (ta) step[field] = ta.value;
        });
    }

    /**
     * Append text to a Phasewalker step field (prompt or uc) for a keyword.
     * promptTextareaContextMenu.js, runCommandIndex.js
     */
    appendTextToStep(keyword, stepIndex, field, text) {
        const add = String(text || '').trim();
        if (!add) return false;
        const kw = String(keyword || '').trim();
        if (!kw || !this.state.keywordSteps[kw]) return false;
        this.saveStepTextareasToState();
        this.syncKeywordStepCounts();
        const steps = this.state.keywordSteps[kw];
        const idx = Number(stepIndex);
        if (!Number.isFinite(idx) || idx < 0 || idx >= steps.length) return false;
        const f = field === 'uc' ? 'uc' : 'prompt';
        const step = steps[idx];
        const current = String(step[f] || '').trim();
        const sep = current && !current.endsWith(',') ? ', ' : (current ? ' ' : '');
        step[f] = current ? current + sep + add : add;

        if (this.state.activeKeyword === kw && this.state.activeField === f && this.stepsContainer) {
            const ta = this.stepsContainer.querySelector(`textarea[data-step-id="${step.id}"]`);
            if (ta) {
                setTextareaValuePreservingUndo(ta, step[f]);
                bracketGenRefreshPromptTextarea(ta);
            }
        }
        this.updateChrome();
        return true;
    }

    /** One listener set for every stage box (rows are rebuilt on render). */
    setupStepEvents() {
        const list = this.stepsContainer;
        if (!list || list.dataset.pwEventsWired === 'true') return;
        list.dataset.pwEventsWired = 'true';
        const rowIndex = (el) => {
            const item = el.closest('.bracket-gen-step-item');
            const idx = item ? parseInt(item.dataset.stepIndex, 10) : NaN;
            return Number.isFinite(idx) ? idx : -1;
        };
        list.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-step-cmd]');
            if (!btn || btn.disabled) return;
            const idx = rowIndex(btn);
            if (idx < 0) return;
            const cmd = btn.dataset.stepCmd;
            if (cmd === 'up') this.moveStep(idx, idx - 1);
            else if (cmd === 'down') this.moveStep(idx, idx + 1);
            else if (cmd === 'remove') this.removeStepAt(idx);
        });
        list.addEventListener('change', (e) => {
            const target = e.target;
            if (target.matches('.bracket-gen-compare-source')) {
                this.toggleCompareSourceStep(rowIndex(target));
            } else if (target.matches('.bracket-gen-step-name-input')) {
                const idx = rowIndex(target);
                this.setStepName(idx, target.value);
                target.value = this.state.stepNames[idx] || '';
                this.syncPipelineStageNameForStepIndex(idx);
                this.updateChrome();
            }
        });
        list.addEventListener('input', (e) => {
            const target = e.target;
            if (target.matches('textarea[data-step-id]')) {
                const step = this.getActiveKeywordSteps().find((s) => s.id === target.dataset.stepId);
                if (step) step[this.state.activeField] = target.value;
                this.scheduleChrome();
            } else if (target.matches('.bracket-gen-step-name-input')) {
                this.setStepName(rowIndex(target), target.value);
                this.scheduleChrome();
            }
        });
        list.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.target.matches('.bracket-gen-step-name-input')) {
                e.preventDefault();
                e.target.closest('.bracket-gen-step-item')?.querySelector('textarea[data-step-id]')?.focus();
            }
        });
        this.initializeStepDragDrop();
    }

    renderEmptyState(message) {
        this.stepsContainer.innerHTML = `<p class="phasewalker-empty">${message}</p>`;
    }

    renderSteps() {
        if (!this.stepsContainer) return;
        this.stepsContainer.textContent = '';

        if (this.state.keywords.length === 0 || !this.state.activeKeyword) {
            this.renderEmptyState('There are no keywords. To add one, click Add Keyword on the Keyword menu.');
            this.updateChrome();
            return;
        }

        const steps = this.getActiveKeywordSteps();
        if (steps.length === 0) {
            this.renderEmptyState('There are no stages. To add one, click Add Stage on the Stage menu.');
            this.updateChrome();
            return;
        }

        const field = this.state.activeField;
        const placeholder = this.fieldPlaceholder();
        const count = steps.length;
        this.ensureStepNamesLength();
        const frag = document.createDocumentFragment();

        steps.forEach((step, index) => {
            const item = document.createElement('fieldset');
            item.className = 'bracket-gen-step-item';
            item.dataset.stepId = step.id;
            item.dataset.stepIndex = String(index);
            const hex = this.getStepStageHexId(index);
            const base = this.state.useStage0 && index === 0;
            const sourceOff = this.isCompareSourceStepDisabled(index);
            const sourceOn = !sourceOff && this.state.compareSourceStepIndex === index;
            const nameId = `${step.id}_name`;
            const sourceId = `${step.id}_source`;
            // escapeHtml, escapeHtmlAttribute: public/scripts/comp/utilities.js
            item.innerHTML = `
                <legend class="bracket-gen-step-legend" title="Drag to move this stage">Stage ${hex}${base ? ' (base image)' : ''}</legend>
                <div class="bracket-gen-step-head">
                    <label class="bracket-gen-step-name-label" for="${escapeHtmlAttribute(nameId)}">Name:</label>
                    <input type="text" id="${escapeHtmlAttribute(nameId)}" class="bracket-gen-step-name-input" value="${escapeHtmlAttribute(this.state.stepNames[index] || '')}" placeholder="Step ${index + 1}" maxlength="48" spellcheck="false" autocomplete="off">
                    <span class="bracket-gen-compare-source-wrap" title="${sourceOff ? 'The last stage cannot be a comparison source' : 'Compare later stages with this stage\'s image'}">
                        <input type="checkbox" id="${escapeHtmlAttribute(sourceId)}" class="bracket-gen-compare-source" data-step-index="${index}"${sourceOn ? ' checked' : ''}${sourceOff ? ' disabled' : ''}>
                        <label for="${escapeHtmlAttribute(sourceId)}">Comparison source</label>
                    </span>
                    <span class="bracket-gen-step-tools" role="toolbar">
                        <button type="button" data-step-cmd="up" title="Move Up"${index === 0 ? ' disabled' : ''}><span class="phasewalker-tb-icon" data-icon="move-up"></span></button>
                        <button type="button" data-step-cmd="down" title="Move Down"${index === count - 1 ? ' disabled' : ''}><span class="phasewalker-tb-icon" data-icon="move-down"></span></button>
                        <button type="button" data-step-cmd="remove" title="Remove Stage"${count <= 1 ? ' disabled' : ''}><span class="phasewalker-tb-icon" data-icon="delete"></span></button>
                    </span>
                </div>
            `;

            // createEditableTextareaContainer: public/scripts/comp/textareaUtils.js
            const container = createEditableTextareaContainer({
                value: step[field] || '',
                rows: 3,
                placeholder,
                dataAttributes: { 'step-id': step.id }
            });
            item.appendChild(container);
            const ta = container.querySelector('textarea');
            if (ta && typeof setupEditableTextarea === 'function') {
                setupEditableTextarea(ta);
            } else if (ta && typeof wireManualStylePromptTextarea === 'function') {
                wireManualStylePromptTextarea(ta);
            }
            frag.appendChild(item);
        });

        this.stepsContainer.appendChild(frag);
        bracketGenRefreshAllStepTextareas(this.stepsContainer);
        this.updateChrome();
    }

    /** Dragging a stage by its group box caption reorders the stages (moveStep). */
    initializeStepDragDrop() {
        const list = this.stepsContainer;
        if (!list) return;
        list.addEventListener('mousedown', (e) => {
            const legend = e.button === 0 ? e.target.closest('.bracket-gen-step-legend') : null;
            if (!legend) return;
            const dragged = legend.closest('.bracket-gen-step-item');
            const from = parseInt(dragged?.dataset.stepIndex, 10);
            if (!Number.isFinite(from)) return;
            e.preventDefault();
            const items = Array.from(list.querySelectorAll('.bracket-gen-step-item'));
            const mids = items.map((el) => {
                const r = el.getBoundingClientRect();
                return r.top + r.height / 2;
            });
            let to = from;
            dragged.classList.add('dragging');
            const scope = new AbortController();
            document.addEventListener('mousemove', (ev) => {
                ev.preventDefault();
                let next = mids.findIndex((mid) => ev.clientY < mid);
                if (next === -1) next = items.length - 1;
                else if (next > from) next -= 1;
                if (next === to) return;
                to = next;
                items.forEach((el, i) => el.classList.toggle('drop-before', i !== from && i === (to < from ? to : -1)));
                items.forEach((el, i) => el.classList.toggle('drop-after', i !== from && i === (to > from ? to : -1)));
            }, { signal: scope.signal });
            document.addEventListener('mouseup', () => {
                scope.abort();
                items.forEach((el) => el.classList.remove('dragging', 'drop-before', 'drop-after'));
                if (to !== from) this.moveStep(from, to);
            }, { signal: scope.signal });
        });
    }

    compileStages() {
        if (!bracketGenIsEditorOpen()) {
            showGlassToast('warning', null, 'Open the Studio first', false, 4000);
            return false;
        }
        this.saveStepTextareasToState();
        this.saveStepNamesFromInputs();
        const maxSteps = this.getMaxStepCount();
        if (maxSteps === 0 || this.state.keywords.length === 0) {
            showGlassToast('warning', null, 'Add at least one keyword and one stage', false, 4000);
            return false;
        }
        if (typeof addPipelineStage !== 'function') {
            showGlassToast('error', null, 'Pipeline not available', false, 4000);
            return false;
        }

        const previousNames = (typeof requestBodyReplacements !== 'undefined' ? requestBodyReplacements : [])
            .filter((r) => r.managed && r.name)
            .map((r) => r.name);
        deleteAllManagedBracketArtifacts();
        const container = document.getElementById('pipelineStagesContainer');

        for (let i = 0; i < maxSteps; i++) {
            const stepsAtIndex = (kw) => {
                const steps = this.state.keywordSteps[kw] || [];
                return i < steps.length ? steps[i] : null;
            };

            if (this.state.useStage0 && i === 0) {
                let step0NamePending = this.resolvePhaseNameForCompile(0);
                this.state.keywords.forEach((kw) => {
                    const step = stepsAtIndex(kw);
                    if (!step) return;
                    if (bracketGenHasReplacementContent(step.prompt)) {
                        bracketGenPushManagedExpander(`${kw}_P`, step.prompt, 0, step0NamePending);
                        step0NamePending = '';
                    }
                    if (bracketGenHasReplacementContent(step.uc)) {
                        bracketGenPushManagedExpander(`${kw}_N`, step.uc, 0, step0NamePending);
                        step0NamePending = '';
                    }
                });
                continue;
            }

            const phaseName = this.resolvePhaseNameForCompile(i);
            addPipelineStage('variation', { useBaseImage: false, displayName: phaseName || undefined });
            const stageItem = container ? container.lastElementChild : null;
            const stageId = stageItem ? stageItem.id : null;
            if (stageId && phaseName && typeof setPipelineStageDisplayName === 'function') {
                setPipelineStageDisplayName(stageId, phaseName);
            }
            if (stageItem && typeof applyManagedPipelineStageUi === 'function') {
                applyManagedPipelineStageUi(stageId, true);
            } else if (stageItem) {
                stageItem.dataset.managed = 'true';
                stageItem.classList.add('managed-stage');
            }
            // the expanders point at the stage's real place: stages the user already had come first
            const stageTarget = (stageItem && bracketGenGetPipelineStageTargetIndex(stageItem)) || this.getExpanderStageTarget(i);
            this.state.keywords.forEach((kw) => {
                const step = stepsAtIndex(kw);
                if (!step) return;
                bracketGenPushManagedExpander(`${kw}_P`, step.prompt, stageTarget);
                bracketGenPushManagedExpander(`${kw}_N`, step.uc, stageTarget);
            });
        }

        // placeholders of expanders this compile no longer writes (a deleted keyword, UC that was
        // cleared) would reach NovelAI as literal text: take them out of the prompts
        const nowNames = new Set(requestBodyReplacements.filter((r) => r.managed).map((r) => r.name));
        const stale = [...new Set(previousNames)].filter((name) => !nowNames.has(name));
        if (stale.length) bracketGenStripPlaceholders(stale);

        const manualPrompt = document.getElementById('manualPrompt');
        const manualUc = document.getElementById('manualUc');
        const positiveText = bracketGenCollectPositiveFields(null);
        const negativeText = bracketGenCollectNegativeFields(null);
        this.state.keywords.forEach((kw) => {
            if (nowNames.has(`${kw}_P`) && !bracketGenFieldContainsToken(positiveText, `${kw}_P`)) {
                bracketGenAppendPlaceholderIfMissing(manualPrompt, `${kw}_P`);
            }
            if (nowNames.has(`${kw}_N`) && !bracketGenFieldContainsToken(negativeText, `${kw}_N`)) {
                bracketGenAppendPlaceholderIfMissing(manualUc, `${kw}_N`);
            }
        });
        bracketGenRefreshPromptTextarea(manualPrompt);
        bracketGenRefreshPromptTextarea(manualUc);

        if (typeof renderRequestBodyReplacementsList === 'function') {
            renderRequestBodyReplacementsList();
        }
        if (typeof enforceManagedStageSandwichRules === 'function') {
            enforceManagedStageSandwichRules();
        }
        syncManagedBracketEditorSaveFlags();
        if (typeof updatePipelineStagesHeaderVisibility === 'function') {
            updatePipelineStagesHeaderVisibility();
        }

        showGlassToast('success', null, `Compiled ${maxSteps} stage${maxSteps === 1 ? '' : 's'}`, false, 3000);
        this.updateChrome();
        return true;
    }

    async deleteStages() {
        if (!hasManagedBracketArtifacts()) return;
        const confirmed = await showConfirmationDialog(
            'Are you sure you want to remove the compiled Phasewalker stages and expanders from the Studio? Their placeholders stay in the prompt.',
            [
                { text: 'Yes', value: true, className: 'btn-standard primary' },
                { text: 'No', value: false, className: 'btn-standard' }
            ],
            null,
            { title: 'Delete Compiled Stages' }
        );
        if (!confirmed) return;
        deleteAllManagedBracketArtifacts();
        this.updateChrome();
        showGlassToast('success', null, 'Removed the compiled stages from the Studio', false, 3000);
    }

    async open(options = {}) {
        if (!this.modal) this.init();
        if (!this.modal) return;

        if (options.state) {
            // a file or the Atelier bag replacing work in an open window asks first
            const visible = !this.modal.classList.contains('hidden');
            if (visible && !options.skipDiscardCheck && !(await this.confirmDiscardChanges())) return;
            if (options.vfsFile) {
                this._vfsFile = { id: options.vfsFile.id, name: options.vfsFile.name, path: options.vfsFile.path || '' };
                this._desktopShortcut = null;
            } else if (options.desktopShortcut) {
                this._desktopShortcut = { id: options.desktopShortcut.id, name: options.desktopShortcut.name };
                this._vfsFile = null;
            } else {
                this._desktopShortcut = null;
                this._vfsFile = null;
            }
            this.hydrateFromSnapshot(options.state);
            this._savedSnapshot = this.boundDocument() ? this.stateSnapshot() : null;
        } else if (!this.hasToolData() && bracketGenIsEditorOpen() && hasManagedBracketArtifacts()) {
            const rebuilt = rebuildToolStateFromEditor();
            if (rebuilt) this.hydrateFromSnapshot(rebuilt);
        }

        if (this.state.keywords.length && this.getActiveKeywordSteps().length === 0) {
            this.syncKeywordStepCounts();
            if (this.getMaxStepCount() === 0) {
                this.state.keywords.forEach((kw) => this.state.keywordSteps[kw].push({ id: bracketGenNewStepId(kw), prompt: '', uc: '' }));
            }
        }
        if (!this.state.activeKeyword && this.state.keywords.length) {
            this.state.activeKeyword = this.state.keywords[0];
        }

        this.renderSteps();
        openModal(this.modal);
        requestAnimationFrame(() => bracketGenRefreshAllStepTextareas(this.stepsContainer));

        if (options.state && options.autoCompile === true && bracketGenIsEditorOpen()) {
            this.compileStages();
        }
        this.updateChrome();
    }

    close() {
        if (!this.modal) return;
        this._skipCloseConfirm = true;
        closeModal(this.modal);
        this._skipCloseConfirm = false;
        this.updateTrayChrome();
    }

    async requestClose() {
        if (this._skipCloseConfirm || this.shouldSkipCloseConfirm()) {
            this.close();
            return;
        }
        const dirty = this.isShortcutDirty();
        const needs = this.needsCompile() && bracketGenIsEditorOpen();
        let message = 'The Studio does not have these stages compiled. Do you want to compile them before closing?';
        let buttons = [
            { text: 'Compile', value: 'compile', className: 'btn-standard primary' },
            { text: "Don't Compile", value: 'exit', className: 'btn-standard' },
            { text: 'Cancel', value: 'cancel', className: 'btn-standard' }
        ];
        if (dirty) {
            message = `Do you want to save changes to ${escapeHtml(this.documentName())}?`;
            buttons = [
                { text: 'Save', value: 'save', className: 'btn-standard primary' },
                { text: "Don't Save", value: 'exit', className: 'btn-standard' },
                { text: 'Cancel', value: 'cancel', className: 'btn-standard' }
            ];
        } else if (!needs) {
            this.close();
            return;
        }
        const choice = await showConfirmationDialog(message, buttons, null, { title: 'Phasewalker' });
        if (choice === 'compile') {
            if (this.compileStages()) this.close();
        } else if (choice === 'save') {
            await this.saveBound();
            if (!this.isShortcutDirty()) this.close();
        } else if (choice === 'exit') {
            this.close();
        }
    }
}

const bracketGenerationApplet = new BracketGenerationApplet();
window.bracketGenerationApplet = bracketGenerationApplet;
window.bracketGenIsAppletActive = bracketGenIsAppletActive;
window.bracketGenGetStepMenuData = bracketGenGetStepMenuData;
window.bracketGenEnsureStepStateReady = bracketGenEnsureStepStateReady;
window.rebuildToolStateFromEditor = rebuildToolStateFromEditor;
window.deleteAllManagedBracketArtifacts = deleteAllManagedBracketArtifacts;
window.hasManagedBracketArtifacts = hasManagedBracketArtifacts;
window.syncManagedBracketEditorSaveFlags = syncManagedBracketEditorSaveFlags;
window.validateBracketPlaceholdersBeforeGeneration = validateBracketPlaceholdersBeforeGeneration;

function bracketGenNotifyTrayChrome() {
    if (bracketGenerationApplet && typeof bracketGenerationApplet.updateTrayChrome === 'function') {
        bracketGenerationApplet.updateTrayChrome();
    }
}
window.bracketGenNotifyTrayChrome = bracketGenNotifyTrayChrome;

function initializePhasewalkerTray() {
    if (!bracketGenerationApplet.trayEl) {
        bracketGenerationApplet.trayEl = document.getElementById('phasewalkerTrayIcon');
        bracketGenerationApplet.trayGlyph = document.getElementById('phasewalkerTrayIconGlyph');
    }
    if (!bracketGenerationApplet.trayEl || bracketGenerationApplet._trayInitialized) return;
    if (!window.isDesktop) {
        bracketGenerationApplet.trayEl.classList.add('hidden');
        return;
    }
    bracketGenerationApplet.setupTray();
    bracketGenerationApplet._trayInitialized = true;
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => bracketGenerationApplet.init());
} else {
    bracketGenerationApplet.init();
}
