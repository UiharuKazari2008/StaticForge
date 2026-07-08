/**
 * Phasewalker — multi-step variation pipeline + managed expanders (_P/_N).
 * public/scripts/comp/modalUtils.js (openModal, closeModal)
 * public/scripts/app.js (addPipelineStage, pipeline stage helpers)
 * public/scripts/comp/requestBodyReplacementsModal.js (requestBodyReplacements)
 */

function bracketGenEscapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/"/g, '&quot;');
}

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

function bracketGenNormalizeSnapshotForCompare(snapshot) {
    if (!snapshot) return null;
    const keywords = Array.isArray(snapshot.keywords) ? [...snapshot.keywords] : [];
    const keywordSteps = {};
    keywords.forEach((kw) => {
        keywordSteps[kw] = (snapshot.keywordSteps?.[kw] || []).map((s) => ({
            prompt: String(s.prompt || ''),
            uc: String(s.uc || '')
        }));
    });
    return {
        keywords,
        useStage0: snapshot.useStage0 !== false,
        keywordSteps,
        stepNames: (snapshot.stepNames || []).map((n) => String(n || '')),
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

function rebuildToolStateFromEditor() {
    const container = document.getElementById('pipelineStagesContainer');
    const allStageItems = container
        ? Array.from(container.querySelectorAll('.pipeline-stage-item'))
        : [];
    const managedStageItems = allStageItems.filter((s) => s.dataset.managed === 'true');
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

    let useStage0 = true;
    const useStage0ForMapping = managedReplacements.some((r) => bracketGenExpanderStageIndex(r) === 0);

    const keywordSteps = {};
    keywords.forEach((kw) => { keywordSteps[kw] = []; });

    const ensureStep = (kw, stepIdx, prompt, uc) => {
        while (keywordSteps[kw].length <= stepIdx) {
            const i = keywordSteps[kw].length;
            keywordSteps[kw].push({ id: `bracket_${kw}_step_${i}`, prompt: '', uc: '' });
        }
        keywordSteps[kw][stepIdx].prompt = prompt;
        keywordSteps[kw][stepIdx].uc = uc;
    };

    if (useStage0ForMapping) {
        keywords.forEach((kw) => {
            const pExp = managedReplacements.find(
                (r) => r.name === `${kw}_P` && bracketGenExpanderStageIndex(r) === 0
            );
            const nExp = managedReplacements.find(
                (r) => r.name === `${kw}_N` && bracketGenExpanderStageIndex(r) === 0
            );
            if (pExp || nExp) {
                const prompt = pExp
                    ? (Array.isArray(pExp.value) ? (pExp.value[0] || '') : (pExp.value || ''))
                    : '';
                const uc = nExp
                    ? (Array.isArray(nExp.value) ? (nExp.value[0] || '') : (nExp.value || ''))
                    : '';
                ensureStep(kw, 0, prompt, uc);
            }
        });
    }

    managedStageItems.forEach((stageItem) => {
        const stageTarget = bracketGenGetPipelineStageTargetIndex(stageItem);
        const stepIdx = useStage0ForMapping ? stageTarget : stageTarget - 1;
        if (stepIdx < 0) return;
        keywords.forEach((kw) => {
            const pExp = managedReplacements.find(
                (r) => r.name === `${kw}_P` && bracketGenExpanderStageIndex(r) === stageTarget
            );
            const nExp = managedReplacements.find(
                (r) => r.name === `${kw}_N` && bracketGenExpanderStageIndex(r) === stageTarget
            );
            const prompt = pExp
                ? (Array.isArray(pExp.value) ? (pExp.value[0] || '') : (pExp.value || ''))
                : '';
            const uc = nExp
                ? (Array.isArray(nExp.value) ? (nExp.value[0] || '') : (nExp.value || ''))
                : '';
            ensureStep(kw, stepIdx, prompt, uc);
        });
    });

    if (managedStageItems.length === 0 && keywords.length > 0) {
        keywords.forEach((kw) => {
            if (keywordSteps[kw].length === 0) {
                keywordSteps[kw].push({ id: `bracket_${kw}_step_0`, prompt: '', uc: '' });
            }
        });
    }

    const stepNames = [];
    if (useStage0ForMapping) {
        const step0Name = bracketGenGetManagedStep0PhaseName();
        if (step0Name) {
            stepNames[0] = step0Name;
        }
    }
    managedStageItems.forEach((stageItem) => {
        const stageTarget = bracketGenGetPipelineStageTargetIndex(stageItem);
        const nameIdx = useStage0ForMapping ? stageTarget : stageTarget - 1;
        if (nameIdx < 0) return;
        const name = stageItem.dataset.phaseStepName || '';
        while (stepNames.length <= nameIdx) stepNames.push('');
        if (name) stepNames[nameIdx] = name;
    });

    return { keywords, keywordSteps, stepNames, useStage0 };
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

class BracketGenerationApplet {
    constructor() {
        this.modal = null;
        this.stepsContainer = null;
        this.stepCounter = 0;
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
        this._pendingAutoCompile = false;
        this._desktopShortcut = null;
        this._savedSnapshot = null;
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
                const i = this.state.keywordSteps[kw].length;
                this.state.keywordSteps[kw].push({
                    id: `bracket_${kw}_step_${i}`,
                    prompt: '',
                    uc: ''
                });
            }
        });
    }

    getBracketStepHexId(index) {
        return '0' + (index + 1).toString(16).toUpperCase();
    }

    ensureStepNamesLength() {
        const max = this.getMaxStepCount();
        if (!Array.isArray(this.state.stepNames)) this.state.stepNames = [];
        while (this.state.stepNames.length < max) {
            const n = this.state.stepNames.length;
            this.state.stepNames.push(`Step ${n + 1}`);
        }
        if (this.state.stepNames.length > max) {
            this.state.stepNames.length = max;
        }
    }

    getStepDisplayName(index) {
        this.ensureStepNamesLength();
        const name = this.state.stepNames[index];
        if (name && String(name).trim()) return String(name).trim();
        return `Step ${index + 1}`;
    }

    setStepName(index, name) {
        this.ensureStepNamesLength();
        if (index < 0 || index >= this.getMaxStepCount()) return;
        const trimmed = String(name || '').trim();
        this.state.stepNames[index] = trimmed || `Step ${index + 1}`;
        if (index === 0 && this.state.useStage0) {
            bracketGenUpdateManagedStep0PhaseName(trimmed);
        }
    }

    saveStepNamesFromInputs() {
        if (!this.stepsContainer) return;
        this.stepsContainer.querySelectorAll('.bracket-gen-step-item').forEach((item) => {
            const idx = parseInt(item.dataset.stepIndex, 10);
            if (!Number.isFinite(idx)) return;
            const input = item.querySelector('.bracket-gen-step-name-input');
            if (input) this.setStepName(idx, input.value);
        });
    }

    syncStepNameFromPipelineStage(stageId, name) {
        if (!bracketGenIsAppletActive()) return;
        const stageItem = document.getElementById(stageId);
        if (!stageItem || stageItem.dataset.managed !== 'true') return;
        const stageTarget = bracketGenGetPipelineStageTargetIndex(stageItem);
        if (stageTarget == null) return;
        const nameIdx = this.state.useStage0 ? stageTarget : stageTarget - 1;
        if (nameIdx < 0) return;
        this.ensureStepNamesLength();
        while (this.state.stepNames.length <= nameIdx) {
            this.state.stepNames.push(`Step ${this.state.stepNames.length + 1}`);
        }
        const trimmed = String(name || '').trim();
        this.state.stepNames[nameIdx] = trimmed || `Step ${nameIdx + 1}`;
        const stepItem = this.stepsContainer?.querySelector(`.bracket-gen-step-item[data-step-index="${nameIdx}"]`);
        if (stepItem) {
            const editableRoot = stepItem.querySelector('.character-name-editable.inline-name-edit');
            const input = stepItem.querySelector('.bracket-gen-step-name-input');
            const placeholder = stepItem.querySelector('.bracket-gen-step-name-placeholder');
            const visible = this.getStepDisplayName(nameIdx);
            if (input) input.value = visible;
            if (placeholder) placeholder.textContent = visible;
            if (editableRoot) editableRoot.classList.remove('editing-name');
        }
    }

    wireBracketGenStepNameInput(item, index) {
        const editableRoot = item.querySelector('.character-name-editable.inline-name-edit');
        if (!editableRoot) return;
        // wireInlineNameEditable: public/scripts/app.js
        wireInlineNameEditable(editableRoot, {
            onCommit: (raw) => {
                this.setStepName(index, raw);
                this.syncPipelineStageNameForStepIndex(index, String(raw || '').trim());
            },
            onDisplaySync: (inp, place) => {
                const visible = this.getStepDisplayName(index);
                inp.value = visible;
                place.textContent = visible;
            },
            onCancel: (inp, place) => {
                const visible = this.getStepDisplayName(index);
                inp.value = visible;
                place.textContent = visible;
            }
        });
    }

    syncPipelineStageNameForStepIndex(stepIndex, name) {
        const stageTarget = this.getExpanderStageTarget(stepIndex);
        const container = document.getElementById('pipelineStagesContainer');
        if (!container) return;
        const all = Array.from(container.querySelectorAll('.pipeline-stage-item'));
        const stageItem = all.find((el) => bracketGenGetPipelineStageTargetIndex(el) === stageTarget);
        if (!stageItem || stageItem.dataset.managed !== 'true') return;
        const trimmed = String(name || '').trim();
        // setPipelineStageDisplayName: public/scripts/app.js
        if (typeof setPipelineStageDisplayName === 'function') {
            setPipelineStageDisplayName(stageItem.id, trimmed);
        }
    }

    init() {
        this.modal = document.getElementById('bracketGenerationModal');
        if (!this.modal) return;
        if (this.modal.dataset.bracketGenInitWired === 'true') return;
        this.modal.dataset.bracketGenInitWired = 'true';

        this.stepsContainer = document.getElementById('bracketStepsContainer');

        const closeBtn = document.getElementById('closeBracketGenerationBtn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.requestClose());
        }

        const compileBtn = document.getElementById('bracketGenCompileBtn');
        if (compileBtn) {
            compileBtn.addEventListener('click', () => this.compileStages());
        }

        const addStepBtn = document.getElementById('bracketGenAddStepBtn');
        if (addStepBtn) {
            addStepBtn.addEventListener('click', () => this.addStep());
        }

        this.setupFieldToggle();
        this.setupKeywordDropdown();
        this.setupGearDropdown();
        this.setupStepTabNavigation();
        this.initializeStepDragDrop();
        this.updateKeywordDropdownLabel();
        this.wireKeyboardOverlayEntries();
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

    setupStepTabNavigation() {
        if (!this.modal || this.modal.dataset.bracketTabNavWired === 'true') return;
        this.modal.dataset.bracketTabNavWired = 'true';
        this.modal.addEventListener('keydown', (e) => this.handleStepTabKeydown(e), true);
    }

    bracketGenIsAutocompleteTabReserved() {
        const overlay = document.getElementById('characterAutocompleteOverlay');
        return overlay && !overlay.classList.contains('hidden');
    }

    handleStepTabKeydown(e) {
        if (!bracketGenIsAppletActive()) return;
        if (e.key !== 'Tab' || e.metaKey || e.ctrlKey || e.altKey) return;

        const target = e.target;
        const reverse = e.shiftKey;

        if (target.matches('textarea[data-step-id]')) {
            if (this.bracketGenIsAutocompleteTabReserved()) return;
            e.preventDefault();
            e.stopPropagation();
            this.saveStepTextareasToState();
            this.focusAdjacentStepTextarea(target, reverse);
            return;
        }

        if (target.matches('.bracket-gen-step-name-input')) {
            e.preventDefault();
            e.stopPropagation();
            target.blur();
            this.focusAdjacentStepNameInput(target, reverse);
        }
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
        next.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    }

    focusAdjacentStepNameInput(currentInput, reverse) {
        if (!this.stepsContainer) return;
        const items = Array.from(this.stepsContainer.querySelectorAll('.bracket-gen-step-item'));
        const currentItem = currentInput.closest('.bracket-gen-step-item');
        const idx = items.indexOf(currentItem);
        if (idx === -1 || items.length === 0) return;
        const nextIdx = reverse
            ? (idx > 0 ? idx - 1 : items.length - 1)
            : (idx < items.length - 1 ? idx + 1 : 0);
        const nextItem = items[nextIdx];
        const nextInput = nextItem?.querySelector('.bracket-gen-step-name-input');
        const editableRoot = nextItem?.querySelector('.character-name-editable.inline-name-edit');
        if (!nextInput || !editableRoot) return;
        editableRoot.classList.add('editing-name');
        nextInput.focus();
        nextInput.select();
        nextInput.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    }

    setupFieldToggle() {
        const group = document.getElementById('bracketGenTabButtons');
        if (!group) return;
        group.querySelectorAll('.gallery-toggle-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                const tab = btn.dataset.tab;
                if (!tab) return;
                this.setActiveField(tab === 'uc' ? 'uc' : 'prompt');
            });
        });
    }

    setActiveField(field) {
        if (field !== 'prompt' && field !== 'uc') return;
        this.saveStepTextareasToState();
        this.state.activeField = field;
        const group = document.getElementById('bracketGenTabButtons');
        if (group) {
            group.setAttribute('data-active', field);
            group.querySelectorAll('.gallery-toggle-btn').forEach((b) => {
                b.classList.toggle('active', b.dataset.tab === field);
            });
        }
        this.updateStepFieldDisplay();
    }

    updateStepFieldDisplay() {
        if (!this.stepsContainer) return;
        const kw = this.state.activeKeyword;
        const field = this.state.activeField;
        const fieldLabel = field === 'uc' ? 'UC' : 'Prompt';
        this.stepsContainer.querySelectorAll('textarea[data-step-id]').forEach((ta) => {
            const stepId = ta.dataset.stepId;
            const steps = this.getActiveKeywordSteps();
            const step = steps.find((s) => s.id === stepId);
            if (step) {
                ta.value = step[field] || '';
                ta.placeholder = kw
                    ? `Enter ${fieldLabel.toLowerCase()} for ${kw}…`
                    : 'Select a keyword…';
            }
            bracketGenRefreshPromptTextarea(ta);
        });
    }

    setupKeywordDropdown() {
        const dropdown = document.getElementById('bracketGenKeywordDropdown');
        const btn = document.getElementById('bracketGenKeywordDropdownBtn');
        const menu = document.getElementById('bracketGenKeywordDropdownMenu');
        // setupDropdown: public/scripts/comp/dropdown.js
        if (!dropdown || !btn || !menu) return;
        if (dropdown.getAttribute('data-dropdown-initialized') === 'true') return;

        setupDropdown(
            dropdown,
            btn,
            menu,
            (selected) => this.renderKeywordMenu(menu, selected),
            () => this.state.activeKeyword,
            { preventFocusTransfer: true }
        );
    }

    renderKeywordMenu(menu, selected) {
        menu.innerHTML = '';

        const addOpt = document.createElement('div');
        addOpt.className = 'custom-dropdown-option';
        addOpt.innerHTML = '<i class="fas fa-plus"></i> Add Keyword';
        addOpt.addEventListener('click', () => {
            closeDropdown(menu, document.getElementById('bracketGenKeywordDropdownBtn'));
            void this.promptAddKeyword();
        });
        menu.appendChild(addOpt);

        const separator = document.createElement('div');
        separator.className = 'custom-dropdown-separator';
        menu.appendChild(separator);

        if (this.state.keywords.length === 0) {
            const emptyOpt = document.createElement('div');
            emptyOpt.className = 'custom-dropdown-option disabled';
            emptyOpt.innerHTML = '<i class="fas fa-tag"></i> No keywords';
            menu.appendChild(emptyOpt);
        } else {
            this.state.keywords.forEach((kw) => {
                const opt = document.createElement('div');
                opt.className = 'custom-dropdown-option' + (kw === selected ? ' selected' : '');
                opt.dataset.value = kw;
                opt.innerHTML = `<i class="fas fa-tag"></i> ${bracketGenEscapeHtml(kw)}`;
                opt.addEventListener('click', () => {
                    this.saveStepTextareasToState();
                    this.state.activeKeyword = kw;
                    this.updateKeywordDropdownLabel(kw);
                    this.renderSteps();
                    closeDropdown(menu, document.getElementById('bracketGenKeywordDropdownBtn'));
                });
                menu.appendChild(opt);
            });
        }

        this.updateKeywordDropdownLabel(selected);
    }

    updateKeywordDropdownLabel(selected) {
        const selectedEl = document.getElementById('bracketGenKeywordSelected');
        const dropdownBtn = document.getElementById('bracketGenKeywordDropdownBtn');
        const kw = selected || this.state.activeKeyword;
        if (selectedEl) {
            selectedEl.textContent = kw || 'No keywords';
        }
        if (dropdownBtn) {
            dropdownBtn.classList.toggle('bracket-gen-keyword-placeholder', !kw);
        }
    }

    setupGearDropdown() {
        const dropdown = document.getElementById('bracketGenGearDropdown');
        const btn = document.getElementById('bracketGenGearDropdownBtn');
        const menu = document.getElementById('bracketGenGearDropdownMenu');
        // setupDropdown: public/scripts/comp/dropdown.js
        if (!dropdown || !btn || !menu) return;
        if (dropdown.getAttribute('data-dropdown-initialized') === 'true') return;

        setupDropdown(
            dropdown,
            btn,
            menu,
            () => {
                menu.innerHTML = '';
                const hasKeyword = !!this.state.activeKeyword;
                const keywordItems = [
                    {
                        icon: 'fas fa-pen',
                        text: 'Rename Keyword',
                        action: () => this.renameKeyword(),
                        disabled: !hasKeyword
                    },
                    {
                        icon: 'fas fa-trash-alt',
                        text: 'Delete Keyword',
                        action: () => this.deleteKeyword(),
                        disabled: !hasKeyword || this.state.keywords.length <= 1
                    }
                ];
                keywordItems.forEach((item) => {
                    const opt = document.createElement('div');
                    opt.className = 'custom-dropdown-option' + (item.disabled ? ' disabled' : '');
                    opt.innerHTML = `<i class="${item.icon}"></i> ${item.text}`;
                    if (!item.disabled) {
                        opt.addEventListener('click', () => {
                            closeDropdown(menu, btn);
                            item.action();
                        });
                    }
                    menu.appendChild(opt);
                });

                const separator = document.createElement('div');
                separator.className = 'custom-dropdown-separator';
                menu.appendChild(separator);

                const useStage0Opt = document.createElement('div');
                useStage0Opt.className = 'custom-dropdown-option';
                useStage0Opt.innerHTML = this.state.useStage0
                    ? '<i class="fas fa-check"></i> Use Stage 0'
                    : '<i class="fas fa-square"></i> Use Stage 0';
                useStage0Opt.addEventListener('click', () => {
                    this.state.useStage0 = !this.state.useStage0;
                    closeDropdown(menu, btn);
                    this.normalizeCompareSourceStepIndex();
                    this.renderSteps();
                    this.updateChrome();
                });
                menu.appendChild(useStage0Opt);

                const mainSeparator = document.createElement('div');
                mainSeparator.className = 'custom-dropdown-separator';
                menu.appendChild(mainSeparator);

                const mainItems = [
                    {
                        icon: this._desktopShortcut ? 'fas fa-save' : 'fas fa-arrow-down-left',
                        text: this._desktopShortcut ? 'Save changes' : 'Add to Desktop',
                        action: () => (this._desktopShortcut ? this.saveShortcutChanges() : this.addToDesktop())
                    },
                    { icon: 'fas fa-file-import', text: 'Load from Editor', action: () => this.loadFromEditor() },
                    { icon: 'fas fa-trash-alt', text: 'Delete Stages', action: () => this.deleteStages() }
                ];
                mainItems.forEach((item) => {
                    const opt = document.createElement('div');
                    opt.className = 'custom-dropdown-option';
                    opt.innerHTML = `<i class="${item.icon}"></i> ${item.text}`;
                    opt.addEventListener('click', () => {
                        closeDropdown(menu, btn);
                        item.action();
                    });
                    menu.appendChild(opt);
                });
            },
            () => null,
            { preventFocusTransfer: true }
        );
    }

    validateKeywordName(name, currentName) {
        const trimmed = String(name || '').trim();
        if (!trimmed) return { ok: false, error: 'Keyword name is required' };
        if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) {
            return { ok: false, error: 'Invalid keyword name' };
        }
        if (trimmed.endsWith('_P') || trimmed.endsWith('_N')) {
            return { ok: false, error: 'Keyword cannot end with _P or _N' };
        }
        if (trimmed !== currentName && this.state.keywords.includes(trimmed)) {
            return { ok: false, error: 'Keyword already exists' };
        }
        return { ok: true, name: trimmed };
    }

    async promptAddKeyword() {
        const name = await showInputDialog(
            'Keyword name may contain letters, numbers, and underscores only.',
            '',
            'KEYWORD',
            [
                { text: 'Add', value: 'ok', icon: 'fas fa-plus', className: 'btn-primary' },
                { text: 'Cancel', value: null, className: 'btn-secondary' }
            ],
            null,
            { title: 'Add Keyword', icon: 'fas fa-tag' }
        );
        if (!name) return false;
        const validated = this.validateKeywordName(name, '');
        if (!validated.ok) {
            showGlassToast('error', null, validated.error, false, 4000, '<i class="fas fa-exclamation-triangle"></i>');
            return false;
        }
        const trimmed = validated.name;
        this.saveStepTextareasToState();
        this.state.keywords.push(trimmed);
        this.state.keywordSteps[trimmed] = [];
        this.state.activeKeyword = trimmed;
        this.updateKeywordDropdownLabel(trimmed);
        if (this.getMaxStepCount() === 0) {
            this.addStep();
        } else {
            this.syncKeywordStepCounts();
            this.renderSteps();
        }
        this.updateChrome();
        return true;
    }

    async renameKeyword() {
        const kw = this.state.activeKeyword;
        if (!kw) {
            showGlassToast('warning', null, 'No keyword selected', false, 3000);
            return;
        }
        const name = await showInputDialog(
            'Keyword name may contain letters, numbers, and underscores only.',
            kw,
            'KEYWORD',
            [
                { text: 'Rename', value: 'ok', icon: 'fas fa-pen', className: 'btn-primary' },
                { text: 'Cancel', value: null, className: 'btn-secondary' }
            ],
            null,
            { title: 'Rename Keyword', icon: 'fas fa-pen' }
        );
        if (!name) return;
        const validated = this.validateKeywordName(name, kw);
        if (!validated.ok) {
            showGlassToast('error', null, validated.error, false, 4000, '<i class="fas fa-exclamation-triangle"></i>');
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
        this.updateKeywordDropdownLabel(trimmed);
        this.renderSteps();
        this.updateChrome();
    }

    async deleteKeyword() {
        const kw = this.state.activeKeyword;
        if (!kw || this.state.keywords.length === 0) {
            showGlassToast('warning', null, 'No keyword selected', false, 3000);
            return;
        }
        if (this.state.keywords.length <= 1) {
            showGlassToast('warning', null, 'At least one keyword is required', false, 4000);
            return;
        }

        const confirmed = await showConfirmationDialog(
            `Delete keyword "${kw}" and all of its steps?`,
            [
                { text: 'Delete', value: true, icon: 'fas fa-trash-alt', className: 'btn-danger' },
                { text: 'Cancel', value: false, className: 'btn-secondary' }
            ],
            null,
            { title: 'Delete Keyword', icon: 'fas fa-tag' }
        );
        if (!confirmed) return;

        this.saveStepTextareasToState();
        this.state.keywords = this.state.keywords.filter((k) => k !== kw);
        delete this.state.keywordSteps[kw];
        this.state.activeKeyword = this.state.keywords[0] || '';
        this.updateKeywordDropdownLabel(this.state.activeKeyword);
        this.renderSteps();
        this.updateChrome();
    }

    loadFromEditor() {
        if (!bracketGenIsEditorOpen()) {
            showGlassToast('warning', null, 'Open the editor first', false, 4000, '<i class="fas fa-edit"></i>');
            return;
        }
        if (!hasManagedBracketArtifacts()) {
            showGlassToast('info', null, 'No managed phases in editor', false, 4000);
            return;
        }
        const rebuilt = rebuildToolStateFromEditor();
        if (!rebuilt) {
            showGlassToast('warning', null, 'Could not load from editor', false, 4000);
            return;
        }
        this.hydrateFromSnapshot(rebuilt);
        this.renderSteps();
        this.updateChrome();
        showGlassToast('success', null, 'Loaded from editor', false, 3000, '<i class="fas fa-file-import"></i>');
    }

    hasToolData() {
        return this.state.keywords.length > 0 && this.getMaxStepCount() > 0;
    }

    isShortcutDirty() {
        if (!this._desktopShortcut || !this._savedSnapshot) return false;
        return !bracketGenSnapshotsEqual(this.getSnapshot(), this._savedSnapshot);
    }

    needsCompile() {
        if (!this.hasToolData()) return false;
        if (!bracketGenIsEditorOpen()) return true;
        if (!hasManagedBracketArtifacts()) return true;
        const editorSnap = rebuildToolStateFromEditor();
        if (!editorSnap) return true;
        return !bracketGenSnapshotsEqual(this.getSnapshot(), editorSnap);
    }

    shouldSkipCloseConfirm() {
        if (!this.hasToolData()) return true;
        return !this.isShortcutDirty() && !this.needsCompile();
    }

    updateTitleBar() {
        const el = document.getElementById('bracketGenTitleLabel');
        if (!el) return;
        if (this._desktopShortcut) {
            const name = this._desktopShortcut.name || 'Shortcut';
            const dirty = this.isShortcutDirty();
            el.textContent = `Phasewalker [${name}${dirty ? '*' : ''}]`;
        } else {
            el.textContent = 'Phasewalker';
        }
    }

    updateCompileButton() {
        const btn = document.getElementById('bracketGenCompileBtn');
        if (!btn) return;
        const needs = this.needsCompile();
        btn.classList.toggle('btn-primary', needs);
        btn.classList.toggle('btn-secondary', !needs);
    }

    updateChrome() {
        this.updateTitleBar();
        this.updateCompileButton();
        this.updateTrayChrome();
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
        return `Phasewalker - ${kwPart} · ${stepCount} step${stepCount === 1 ? '' : 's'}`;
    }

    handleTrayMenuAction(action) {
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
        if (action === 'pw-tray-desktop') {
            void this.addToDesktop();
            return;
        }
        if (action === 'pw-tray-save-shortcut') {
            void this.saveShortcutChanges();
            return;
        }
        if (action === 'pw-tray-toggle-stage0') {
            this.state.useStage0 = !this.state.useStage0;
            this.normalizeCompareSourceStepIndex();
            this.renderSteps();
            this.updateChrome();
        }
    }

    buildTrayMenuItems() {
        const menuData = bracketGenGetStepMenuData();
        const items = [];
        if (!menuData) {
            items.push({ text: 'No Phasewalker data', disabled: true });
            return items;
        }

        const stepCount = Math.max(
            0,
            ...menuData.keywords.map((kw) => (menuData.keywordSteps[kw] || []).length)
        );
        items.push({
            separator: true,
            text: `${menuData.keywords.length} keyword${menuData.keywords.length === 1 ? '' : 's'} · ${stepCount} step${stepCount === 1 ? '' : 's'}`
        });

        menuData.keywords.forEach((kw) => {
            items.push({ separator: true, text: kw });
            const steps = menuData.keywordSteps[kw] || [];
            if (!steps.length) {
                items.push({ text: 'No steps', disabled: true });
                return;
            }
            steps.forEach((step, index) => {
                items.push({
                    text: menuData.stepLabel(index),
                    icon: 'fas fa-stairs',
                    disabled: true
                });
            });
        });

        items.push({ separator: true });
        items.push({
            text: 'Compile',
            icon: 'fas fa-hammer',
            action: 'pw-tray-compile',
            disabled: !bracketGenIsEditorOpen() || !this.hasToolData()
        });
        items.push({
            text: 'Load from Editor',
            icon: 'fas fa-file-import',
            action: 'pw-tray-load',
            disabled: !bracketGenIsEditorOpen() || !hasManagedBracketArtifacts()
        });
        items.push({
            text: 'Delete Stages',
            icon: 'fas fa-trash-alt',
            action: 'pw-tray-delete',
            disabled: !hasManagedBracketArtifacts()
        });
        items.push({
            text: this._desktopShortcut ? 'Save changes' : 'Add to Desktop',
            icon: this._desktopShortcut ? 'fas fa-save' : 'fas fa-arrow-down-left',
            action: this._desktopShortcut ? 'pw-tray-save-shortcut' : 'pw-tray-desktop',
            disabled: !this.hasToolData()
        });
        items.push({
            text: this.state.useStage0 ? 'Use Stage 0' : 'Use Stage 0 (off)',
            icon: this.state.useStage0 ? 'fas fa-check' : 'fas fa-square',
            action: 'pw-tray-toggle-stage0'
        });
        return items;
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
        const appletOpen = bracketGenIsAppletActive();
        const bootPending = typeof window.isDesktopTrayBootPending === 'function'
            && window.isDesktopTrayBootPending();

        if (hasData) {
            if (!bootPending) {
                this.trayEl.classList.remove('hidden');
            }
            this.trayEl.classList.toggle('phasewalker-tray-applet-open', appletOpen);
        } else {
            this.trayEl.classList.add('hidden');
            this.trayEl.classList.remove('phasewalker-tray-applet-open');
        }

        if (this.trayGlyph) {
            this.trayGlyph.className = 'fas fa-layer-group';
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
        if (!this._desktopShortcut || !desktopShortcuts) {
            showGlassToast('error', null, 'Desktop shortcuts unavailable', false, 4000);
            return;
        }
        const snapshot = this.getSnapshot();
        const shortcut = desktopShortcuts.shortcuts.find((s) => s.id === this._desktopShortcut.id);
        if (!shortcut) {
            showGlassToast('error', null, 'Desktop shortcut not found', false, 4000);
            return;
        }
        shortcut.data = { ...shortcut.data, label: shortcut.name, state: snapshot };
        if (!shortcut._isNew) {
            shortcut._isModified = true;
        }
        desktopShortcuts.debouncedSave();
        this._savedSnapshot = JSON.parse(JSON.stringify(snapshot));
        this.updateChrome();
        showGlassToast('success', null, 'Shortcut saved', false, 3000, '<i class="fas fa-check"></i>');
    }

    getExpanderStageTarget(stepIndex) {
        return this.state.useStage0 ? stepIndex : stepIndex + 1;
    }

    getPipelineStageIndexForStep(stepIndex) {
        return this.getExpanderStageTarget(stepIndex);
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
            // clearBracketGenPhaseCompareSource: public/scripts/app.js
            if (typeof clearBracketGenPhaseCompareSource === 'function') {
                clearBracketGenPhaseCompareSource();
            }
        } else {
            this.state.compareSourceStepIndex = stepIndex;
            // tryCaptureBracketGenPhaseCompareSourceFromPreview: public/scripts/app.js
            if (typeof tryCaptureBracketGenPhaseCompareSourceFromPreview === 'function') {
                tryCaptureBracketGenPhaseCompareSourceFromPreview();
            }
        }
        this.renderSteps();
        this.updateChrome();
    }

    getSnapshot() {
        this.saveStepTextareasToState();
        this.saveStepNamesFromInputs();
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
        this.state.stepNames = Array.isArray(migrated.stepNames) ? [...migrated.stepNames] : [];
        this.state.useStage0 = snapshot.useStage0 !== false;
        this.state.compareSourceStepIndex = migrated.compareSourceStepIndex ?? null;
        this.state.activeKeyword = this.state.keywords[0] || '';
        let maxSteps = 0;
        this.state.keywords.forEach((kw) => {
            const len = (this.state.keywordSteps[kw] || []).length;
            if (len > maxSteps) maxSteps = len;
        });
        this.stepCounter = maxSteps;
        this.syncKeywordStepCounts();
        this.ensureStepNamesLength();
        this.normalizeCompareSourceStepIndex();
    }

    async addToDesktop() {
        if (!desktopShortcuts) {
            showGlassToast('error', null, 'Desktop shortcuts unavailable', false, 4000);
            return;
        }
        if (!document.body.classList.contains('desktop-mode')) {
            showGlassToast('info', null, 'Desktop mode required', false, 4000);
            return;
        }
        const snapshot = this.getSnapshot();
        const defaultLabel = this.state.keywords.length
            ? `Phasewalker: ${this.state.keywords.join(', ')}`
            : 'Phasewalker';

        const shortcutName = await showInputDialog(
            'Enter a name for this desktop shortcut.',
            defaultLabel,
            'Shortcut name',
            [
                { text: 'Add', value: 'ok', icon: 'fas fa-arrow-down-left', className: 'btn-primary' },
                { text: 'Cancel', value: null, className: 'btn-secondary' }
            ],
            null,
            { title: 'Add to Desktop', icon: 'fas fa-arrow-down-left' }
        );
        if (!shortcutName) return;

        try {
            await desktopShortcuts.addShortcut({
                name: shortcutName,
                type: 'bracket-generation',
                data: { label: shortcutName, state: snapshot }
            });
            showGlassToast('success', null, 'Added to desktop', false, 3000, '<i class="fas fa-check"></i>');
        } catch (err) {
            console.error(err);
            showGlassToast('error', null, 'Failed to add shortcut', false, 5000);
        }
    }

    async addStep() {
        if (this.state.keywords.length === 0) {
            showGlassToast('warning', null, 'Add a keyword first', false, 4000, '<i class="fas fa-info-circle"></i>');
            if (!(await this.promptAddKeyword())) return;
        }
        this.saveStepTextareasToState();
        this.saveStepNamesFromInputs();
        this.syncKeywordStepCounts();
        const nextIndex = this.getMaxStepCount();
        if (!Array.isArray(this.state.stepNames)) this.state.stepNames = [];
        this.state.stepNames.push(`Step ${nextIndex + 1}`);
        const baseId = `bracket_step_${this.stepCounter++}`;
        this.state.keywords.forEach((kw) => {
            if (!this.state.keywordSteps[kw]) this.state.keywordSteps[kw] = [];
            this.state.keywordSteps[kw].push({ id: `${baseId}_${kw}`, prompt: '', uc: '' });
        });
        this.normalizeCompareSourceStepIndex();
        this.renderSteps();
        this.updateChrome();
    }

    removeStep(stepId) {
        const kw = this.state.activeKeyword;
        if (!kw) return;
        const steps = this.getActiveKeywordSteps();
        if (this.getMaxStepCount() <= 1) {
            showGlassToast('warning', null, 'At least one step is required', false, 3000);
            return;
        }
        const removedIndex = steps.findIndex((s) => s.id === stepId);
        if (removedIndex < 0) return;
        this.saveStepTextareasToState();
        this.saveStepNamesFromInputs();
        this.state.keywords.forEach((k) => {
            const arr = this.state.keywordSteps[k] || [];
            if (removedIndex < arr.length) {
                this.state.keywordSteps[k] = arr.filter((_, i) => i !== removedIndex);
            }
        });
        if (this.state.stepNames && removedIndex < this.state.stepNames.length) {
            this.state.stepNames.splice(removedIndex, 1);
        }
        if (this.state.compareSourceStepIndex !== null) {
            if (removedIndex === this.state.compareSourceStepIndex) {
                this.state.compareSourceStepIndex = null;
            } else if (removedIndex < this.state.compareSourceStepIndex) {
                this.state.compareSourceStepIndex -= 1;
            }
        }
        this.normalizeCompareSourceStepIndex();
        this.renderSteps();
        this.updateChrome();
    }

    saveStepTextareasToState() {
        if (!this.stepsContainer) return;
        const kw = this.state.activeKeyword;
        const field = this.state.activeField;
        if (!kw) return;
        const steps = this.getActiveKeywordSteps();
        steps.forEach((step) => {
            const ta = this.stepsContainer.querySelector(`textarea[data-step-id="${step.id}"]`);
            if (ta) {
                step[field] = ta.value;
            }
        });
    }

    /**
     * Append text to a Phasewalker step field (prompt or uc) for a keyword.
     * promptTextareaContextMenu.js
     */
    appendTextToStep(keyword, stepIndex, field, text) {
        const add = String(text || '').trim();
        if (!add) return false;
        const kw = String(keyword || '').trim();
        if (!kw || !this.state.keywordSteps[kw]) return false;
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
                ta.dispatchEvent(new Event('input', { bubbles: true }));
                if (typeof autoResizeTextarea === 'function') {
                    autoResizeTextarea(ta);
                }
            }
        }
        return true;
    }

    syncStepTextareasFromState() {
        if (!this.stepsContainer) return;
        const kw = this.state.activeKeyword;
        const field = this.state.activeField;
        if (!kw) return;
        this.getActiveKeywordSteps().forEach((step) => {
            const ta = this.stepsContainer.querySelector(`textarea[data-step-id="${step.id}"]`);
            if (ta) {
                ta.value = step[field] || '';
                if (typeof autoResizeTextarea === 'function') {
                    autoResizeTextarea(ta);
                }
            }
        });
    }

    renderSteps() {
        if (!this.stepsContainer) return;
        this.stepsContainer.innerHTML = '';

        if (this.state.keywords.length === 0 || !this.state.activeKeyword) {
            this.stepsContainer.innerHTML =
                '<p class="text-muted bracket-gen-empty-hint"><i class="fas fa-tag"></i> No keywords yet. Use the keyword menu in the title bar or press Alt+K to add one.</p>';
            this.updateKeywordDropdownLabel();
            this.updateChrome();
            return;
        }

        const steps = this.getActiveKeywordSteps();
        if (steps.length === 0) {
            this.stepsContainer.innerHTML =
                '<p class="text-muted bracket-gen-empty-hint">No steps for this keyword. Press Alt+A to add a stage.</p>';
            this.updateKeywordDropdownLabel();
            this.updateChrome();
            return;
        }

        const kw = this.state.activeKeyword;
        const field = this.state.activeField;
        const fieldLabel = field === 'uc' ? 'UC' : 'Prompt';
        this.ensureStepNamesLength();

        steps.forEach((step, index) => {
            const item = document.createElement('div');
            item.className = 'character-prompt-item bracket-gen-step-item';
            item.id = step.id;
            item.dataset.stepId = step.id;
            item.dataset.stepIndex = String(index);

            const value = step[field] || '';
            const stepLabel = bracketGenEscapeHtml(this.getStepDisplayName(index));
            const stepHex = this.getBracketStepHexId(index);

            item.innerHTML = `
                <div class="character-prompt-tabs">
                    <div class="tab-header">
                        <div class="workspace-drag-handle" title="Drag to reorder">
                            <i class="fas fa-grip-dots-vertical"></i>
                        </div>
                        <div class="left-controls">
                            <div class="character-name-editable inline-name-edit">
                                <input type="text" class="character-name-input hover-show bracket-gen-step-name-input" value="${stepLabel}" placeholder="Step ${index + 1}" title="Click to rename stage">
                                <span class="character-name-input-placeholder bracket-gen-step-name-placeholder">${stepLabel}</span>
                            </div>
                            <span class="stage-hex-id" title="Step ${stepHex}">${stepHex}</span>
                        </div>
                        <div class="character-prompt-controls">
                            <button type="button" class="btn-secondary btn-small toggle-btn bracket-gen-compare-source-btn${this.isCompareSourceStepDisabled(index) ? ' disabled' : ''}" data-step-index="${index}" data-state="${!this.isCompareSourceStepDisabled(index) && this.state.compareSourceStepIndex === index ? 'on' : 'off'}" title="${this.isCompareSourceStepDisabled(index) ? 'Last stage cannot be a comparison source' : 'Use this stage as comparison source when generating later stages'}"${this.isCompareSourceStepDisabled(index) ? ' disabled' : ''}>
                                <i class="fas fa-eye-dropper"></i>
                            </button>
                            <button type="button" class="btn-danger btn-small bracket-gen-delete-step" data-step-id="${bracketGenEscapeHtml(step.id)}" title="Remove step">
                                <i class="fas fa-trash-alt"></i>
                            </button>
                        </div>
                    </div>
                    <div class="tab-content">
                        <div class="tab-pane active"></div>
                    </div>
                </div>
            `;

            const pane = item.querySelector('.tab-pane');
            const container = createEditableTextareaContainer({
                value,
                rows: 3,
                placeholder: kw ? `Enter ${fieldLabel.toLowerCase()} for ${kw}…` : 'Select a keyword…',
                dataAttributes: { 'step-id': step.id }
            });
            pane.appendChild(container);

            const ta = container.querySelector('textarea');
            if (ta && typeof setupEditableTextarea === 'function') {
                setupEditableTextarea(ta);
            } else if (ta && typeof wireManualStylePromptTextarea === 'function') {
                wireManualStylePromptTextarea(ta);
            }
            bracketGenRefreshPromptTextarea(ta);

            if (ta) {
                ta.addEventListener('input', () => {
                    this.saveStepTextareasToState();
                    this.updateChrome();
                });
            }

            item.querySelector('.bracket-gen-delete-step')?.addEventListener('click', () => {
                this.removeStep(step.id);
            });

            item.querySelector('.bracket-gen-compare-source-btn')?.addEventListener('click', (e) => {
                const btn = e.currentTarget;
                if (btn.disabled || btn.classList.contains('disabled')) return;
                const stepIndex = parseInt(btn.dataset.stepIndex, 10);
                if (!Number.isFinite(stepIndex)) return;
                this.toggleCompareSourceStep(stepIndex);
            });

            this.wireBracketGenStepNameInput(item, index);

            this.stepsContainer.appendChild(item);
        });

        this.initializeStepDragDrop();
        this.updateKeywordDropdownLabel();
        bracketGenRefreshAllStepTextareas(this.stepsContainer);
        this.updateChrome();
    }

    initializeStepDragDrop() {
        const list = this.stepsContainer;
        if (!list) return;

        let draggedItem = null;

        list.querySelectorAll('.workspace-drag-handle').forEach((handle) => {
            if (handle.dataset.bracketDragInit === 'true') return;
            handle.dataset.bracketDragInit = 'true';

            handle.addEventListener('mousedown', (e) => {
                e.preventDefault();
                draggedItem = handle.closest('.bracket-gen-step-item');
                if (!draggedItem) return;
                draggedItem.classList.add('dragging');
                document.body.style.userSelect = 'none';

                const dragScope = new AbortController();
                const dragSignal = dragScope.signal;

                const onMove = (ev) => {
                    ev.preventDefault();
                    if (!draggedItem) return;
                    const clientY = ev.clientY;
                    const items = Array.from(list.querySelectorAll('.bracket-gen-step-item')).filter((el) => el !== draggedItem);
                    for (const item of items) {
                        const rect = item.getBoundingClientRect();
                        if (clientY < rect.top + rect.height / 2) {
                            list.insertBefore(draggedItem, item);
                            return;
                        }
                    }
                    list.appendChild(draggedItem);
                };

                const onUp = () => {
                    dragScope.abort();
                    if (draggedItem) draggedItem.classList.remove('dragging');
                    document.body.style.userSelect = '';
                    this.saveStepTextareasToState();
                    const kw = this.state.activeKeyword;
                    if (!kw) {
                        draggedItem = null;
                        return;
                    }
                    const order = Array.from(list.querySelectorAll('.bracket-gen-step-item')).map((el) => el.dataset.stepId);
                    const steps = this.getActiveKeywordSteps();
                    const prevIds = steps.map((s) => s.id);
                    const orderIndices = order.map((id) => prevIds.indexOf(id)).filter((i) => i >= 0);
                    const oldNames = [...(this.state.stepNames || [])];
                    this.state.stepNames = orderIndices.map((i, pos) => oldNames[i] || `Step ${pos + 1}`);
                    this.state.keywords.forEach((k) => {
                        const arr = this.state.keywordSteps[k] || [];
                        if (arr.length === prevIds.length) {
                            this.state.keywordSteps[k] = orderIndices.map((i) => arr[i]);
                        }
                    });
                    if (this.state.compareSourceStepIndex !== null && this.state.compareSourceStepIndex < prevIds.length) {
                        const movedId = prevIds[this.state.compareSourceStepIndex];
                        const newIdx = order.indexOf(movedId);
                        this.state.compareSourceStepIndex = newIdx >= 0 ? newIdx : null;
                    }
                    this.normalizeCompareSourceStepIndex();
                    draggedItem = null;
                    this.renderSteps();
                };

                document.addEventListener('mousemove', onMove, { signal: dragSignal });
                document.addEventListener('mouseup', onUp, { signal: dragSignal });
            });
        });
    }

    compileStages() {
        if (!bracketGenIsEditorOpen()) {
            showGlassToast('warning', null, 'Open the editor first', false, 4000, '<i class="fas fa-edit"></i>');
            return false;
        }
        this.saveStepTextareasToState();
        const maxSteps = this.getMaxStepCount();
        if (maxSteps === 0 || this.state.keywords.length === 0) {
            showGlassToast('warning', null, 'Add at least one keyword and one step', false, 4000);
            return false;
        }
        if (typeof addPipelineStage !== 'function') {
            showGlassToast('error', null, 'Pipeline not available', false, 4000);
            return false;
        }

        deleteAllManagedBracketArtifacts();

        for (let i = 0; i < maxSteps; i++) {
            const stageTarget = this.getExpanderStageTarget(i);
            const stepsAtIndex = (kw) => {
                const steps = this.state.keywordSteps[kw] || [];
                return i < steps.length ? steps[i] : null;
            };
            const hasStepData = this.state.keywords.some((kw) => stepsAtIndex(kw));

            if (this.state.useStage0 && i === 0) {
                if (hasStepData) {
                    const stepDisplayName = this.getStepDisplayName(0);
                    const phaseStepName = stepDisplayName.startsWith('Step ') ? '' : stepDisplayName;
                    let step0NamePending = phaseStepName;
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
                }
                continue;
            }

            const stepDisplayName = this.getStepDisplayName(i);
            const defaultTypeLabel = stepDisplayName.startsWith('Step ') ? '' : stepDisplayName;
            addPipelineStage('variation', { useBaseImage: false, displayName: defaultTypeLabel || undefined });

            const container = document.getElementById('pipelineStagesContainer');
            const stageItem = container ? container.lastElementChild : null;
            const stageId = stageItem ? stageItem.id : null;
            if (stageId && defaultTypeLabel && typeof setPipelineStageDisplayName === 'function') {
                setPipelineStageDisplayName(stageId, defaultTypeLabel);
            }
            if (stageItem && typeof applyManagedPipelineStageUi === 'function') {
                applyManagedPipelineStageUi(stageId, true);
            } else if (stageItem) {
                stageItem.dataset.managed = 'true';
                stageItem.classList.add('managed-stage');
            }
            if (stageItem) {
                if (this.state.compareSourceStepIndex === i) {
                    stageItem.dataset.bracketCompareSource = 'true';
                } else {
                    delete stageItem.dataset.bracketCompareSource;
                }
            }

            this.state.keywords.forEach((kw) => {
                const step = stepsAtIndex(kw);
                if (!step) return;
                bracketGenPushManagedExpander(`${kw}_P`, step.prompt, stageTarget);
                bracketGenPushManagedExpander(`${kw}_N`, step.uc, stageTarget);
            });
        }

        const manualPrompt = document.getElementById('manualPrompt');
        const manualUc = document.getElementById('manualUc');
        const positiveText = bracketGenCollectPositiveFields(null);
        const negativeText = bracketGenCollectNegativeFields(null);
        this.state.keywords.forEach((kw) => {
            if (!bracketGenFieldContainsToken(positiveText, `${kw}_P`)) {
                bracketGenAppendPlaceholderIfMissing(manualPrompt, `${kw}_P`);
            }
            if (bracketGenKeywordHasFieldContent(kw, 'uc', this.state.keywordSteps)
                && !bracketGenFieldContainsToken(negativeText, `${kw}_N`)) {
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
        if (typeof syncManagedBracketEditorSaveFlags === 'function') {
            syncManagedBracketEditorSaveFlags();
        }
        if (typeof updatePipelineStagesHeaderVisibility === 'function') {
            updatePipelineStagesHeaderVisibility();
        }

        showGlassToast('success', null, `Compiled ${maxSteps} phase(s)`, false, 3000, '<i class="fas fa-hammer"></i>');
        this.updateChrome();
        return true;
    }

    deleteStages() {
        deleteAllManagedBracketArtifacts();
        if (typeof syncManagedBracketEditorSaveFlags === 'function') {
            syncManagedBracketEditorSaveFlags();
        }
        this.updateChrome();
        showGlassToast('success', null, 'Removed managed stages from editor', false, 3000, '<i class="fas fa-trash-alt"></i>');
    }

    async open(options = {}) {
        if (!this.modal) this.init();
        if (!this.modal) return;

        if (options.desktopShortcut) {
            this._desktopShortcut = {
                id: options.desktopShortcut.id,
                name: options.desktopShortcut.name
            };
            const migrated = bracketGenMigrateSnapshot(options.state);
            this._savedSnapshot = {
                keywords: migrated.keywords,
                keywordSteps: JSON.parse(JSON.stringify(migrated.keywordSteps)),
                stepNames: Array.isArray(migrated.stepNames) ? [...migrated.stepNames] : [],
                useStage0: options.state?.useStage0 !== false,
                compareSourceStepIndex: migrated.compareSourceStepIndex ?? null
            };
        } else {
            this._desktopShortcut = null;
            this._savedSnapshot = null;
        }

        if (options.state) {
            this.hydrateFromSnapshot(options.state);
            this._pendingAutoCompile = options.autoCompile === true;
        } else if (bracketGenIsEditorOpen() && hasManagedBracketArtifacts()) {
            const rebuilt = rebuildToolStateFromEditor();
            if (rebuilt) {
                this.hydrateFromSnapshot(rebuilt);
            }
        } else {
            this.state.useStage0 = true;
        }

        if (this.state.keywords.length === 0) {
            // Empty — user adds keyword via dropdown first
        } else if (this.getActiveKeywordSteps().length === 0) {
            this.addStep();
        }

        if (!this.state.activeKeyword && this.state.keywords.length) {
            this.state.activeKeyword = this.state.keywords[0];
        }

        this.renderSteps();
        openModal(this.modal);
        requestAnimationFrame(() => {
            bracketGenRefreshAllStepTextareas(this.stepsContainer);
        });

        this.updateChrome();

        if (this._pendingAutoCompile) {
            this._pendingAutoCompile = false;
            if (bracketGenIsEditorOpen()) {
                this.compileStages();
            }
        }
    }

    close() {
        if (!this.modal) return;
        this._skipCloseConfirm = true;
        closeModal(this.modal);
        this._skipCloseConfirm = false;
        this.updateTrayChrome();
    }

    async requestClose() {
        if (this._skipCloseConfirm) {
            this.close();
            return;
        }
        if (this.shouldSkipCloseConfirm()) {
            this.close();
            return;
        }
        const choice = await showConfirmationDialog(
            'Close Phasewalker?',
            [
                { text: 'Compile', value: 'compile', icon: 'fas fa-hammer', className: 'btn-primary' },
                { text: 'Exit', value: 'exit', icon: 'fas fa-right-from-bracket', className: 'btn-secondary' },
                { text: 'Cancel', value: 'cancel', className: 'btn-secondary' }
            ],
            null,
            { title: 'Phasewalker', icon: 'fas fa-layer-group' }
        );
        if (choice === 'compile') {
            if (this.compileStages()) {
                this.close();
            }
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
