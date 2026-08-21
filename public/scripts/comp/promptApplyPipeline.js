/**
 * Applies Tendai replacements on server-resolved prompt baselines and writes back to raw editor fields.
 * applyDynamicReplacementClientSide: public/scripts/comp/textReplacementManager.js
 */

const APPEND_MARKER = '__ENSHUTSUKA_APPEND_POINT__';

function getApplicationContext() {
    return window.dynamicGenerationData?.compiled_prompt?.application_context
        || window._lastCompileToPromptsApplicationContext
        || null;
}

function normalizeReplacementAction(replacement) {
    return (replacement?.action || 'replace').toLowerCase();
}

function prepareReplaceText(replacement) {
    let replaceText = replacement.replace_text || '';
    const action = normalizeReplacementAction(replacement);
    if (replaceText) {
        replaceText = replaceText.replace(/<br\s*\/?>/gi, '\n');
    }
    if (replaceText && (action === 'replace' || action === 'append')) {
        let biasToApply = null;
        if (replacement.segment_emphasis !== null && replacement.segment_emphasis !== undefined) {
            biasToApply = replacement.segment_emphasis;
        } else if (replacement.select_text) {
            // extractBiasFromTextForDisplay: textReplacementManager.js
            biasToApply = extractBiasFromTextForDisplay(replacement.select_text);
        }
        if (biasToApply !== null && !hasEmphasisGroupForDisplay(replaceText)) {
            replaceText = applyBiasToText(replaceText, biasToApply);
        }
    }
    return replaceText;
}

function applyReplacementOnResolvedText(result, replacement) {
    const action = normalizeReplacementAction(replacement);
    const selectText = (replacement?.select_text || '').trim();
    let replaceText = prepareReplaceText(replacement);
    const fallbackSelectText = replacement.fallback_select_text ? replacement.fallback_select_text.trim() : null;
    const alternativeText = replacement.alternative_text || null;
    const isCritical = replacement.is_critical !== false;
    const count = replacement.count;
    const anchorText = (replacement.anchor_text || '').trim();

    let appliedSuccessfully = false;
    let method = 'direct';

    const getCleanPattern = (str) => {
        if (!str) return '';
        let clean = String(str);
        if (typeof stripManagedEmphasisDelimitersForCounting === 'function') {
            clean = stripManagedEmphasisDelimitersForCounting(clean);
        }
        return clean.replace(/-?\d+(?:\.\d+)?::/g, '').replace(/::/g, '').trim();
    };

    if (action === 'delete') {
        let textToDelete = selectText;
        if (selectText && result.includes(selectText)) {
            if (count !== undefined && count !== null) {
                for (let i = 0; i < count; i++) {
                    const index = result.indexOf(textToDelete);
                    if (index === -1) break;
                    result = result.substring(0, index) + result.substring(index + textToDelete.length);
                }
            } else {
                result = result.split(textToDelete).join('');
            }
            appliedSuccessfully = true;
        } else if (selectText) {
            const cleanSelect = getCleanPattern(selectText);
            if (cleanSelect && result.includes(cleanSelect)) {
                result = result.split(cleanSelect).join('');
                appliedSuccessfully = true;
                method = 'emphasis-matched';
            }
        }
        if (!appliedSuccessfully && fallbackSelectText && result.includes(fallbackSelectText)) {
            textToDelete = fallbackSelectText;
            if (count !== undefined && count !== null) {
                for (let i = 0; i < count; i++) {
                    const index = result.indexOf(textToDelete);
                    if (index === -1) break;
                    result = result.substring(0, index) + result.substring(index + textToDelete.length);
                }
            } else {
                result = result.split(textToDelete).join('');
            }
            appliedSuccessfully = true;
            method = 'fallback';
        }
        if (!appliedSuccessfully) {
            return { success: false, error: `Could not find text to delete: "${selectText}"`, result };
        }
    } else if (action === 'replace') {
        if (selectText && result.includes(selectText)) {
            result = result.replace(selectText, replaceText);
            appliedSuccessfully = true;
        } else if (selectText) {
            const cleanSelect = getCleanPattern(selectText);
            if (cleanSelect && result.includes(cleanSelect)) {
                result = result.replace(cleanSelect, replaceText);
                appliedSuccessfully = true;
                method = 'emphasis-matched';
            }
        }
        if (!appliedSuccessfully && fallbackSelectText && result.includes(fallbackSelectText)) {
            result = result.replace(fallbackSelectText, replaceText);
            appliedSuccessfully = true;
            method = 'fallback';
        } else if (!appliedSuccessfully && !isCritical && alternativeText) {
            const needsComma = result.trim() && !result.trim().endsWith(',') && !textEndsWithEmphasisGroupClose(result);
            result = result.trimEnd() + (needsComma ? ', ' : ' ') + alternativeText;
            appliedSuccessfully = true;
            method = 'alternative';
        }
        if (!appliedSuccessfully) {
            return { success: false, error: `Could not find text to replace: "${selectText}"`, result };
        }
    } else if (action === 'append') {
        let textToAppend = replaceText;
        let insertPosition = result.length;

        if (anchorText) {
            const anchorIndex = result.indexOf(anchorText);
            if (anchorIndex !== -1) {
                insertPosition = anchorIndex + anchorText.length;
                appliedSuccessfully = true;
                method = 'anchor';
            } else {
                const cleanAnchor = getCleanPattern(anchorText);
                if (cleanAnchor && result.includes(cleanAnchor)) {
                    insertPosition = result.indexOf(cleanAnchor) + cleanAnchor.length;
                    appliedSuccessfully = true;
                    method = 'anchor';
                }
            }
        }

        if (!appliedSuccessfully && selectText) {
            const index = result.indexOf(selectText);
            if (index !== -1) {
                insertPosition = index + selectText.length;
                appliedSuccessfully = true;
            } else {
                const cleanSelect = getCleanPattern(selectText);
                if (cleanSelect && result.includes(cleanSelect)) {
                    insertPosition = result.indexOf(cleanSelect) + cleanSelect.length;
                    appliedSuccessfully = true;
                    method = 'emphasis-matched';
                } else if (fallbackSelectText && result.includes(fallbackSelectText)) {
                    insertPosition = result.indexOf(fallbackSelectText) + fallbackSelectText.length;
                    appliedSuccessfully = true;
                    method = 'fallback';
                } else if (!isCritical && alternativeText) {
                    textToAppend = alternativeText;
                    method = 'alternative';
                }
            }
        }

        if (!appliedSuccessfully && !selectText) {
            appliedSuccessfully = true;
        }

        const needsComma = insertPosition > 0 && result[insertPosition - 1] !== ',' && result[insertPosition - 1] !== ' ';
        const separator = needsComma ? ', ' : '';
        result = result.substring(0, insertPosition) + separator + textToAppend + result.substring(insertPosition);
        appliedSuccessfully = true;
    }

    return { success: appliedSuccessfully, result, method };
}

function getStreamKey(entry) {
    return `${entry.targetType}:${entry.targetSource ?? 'base'}:${entry.targetField ?? 'none'}`;
}

function orderReplacementQueue(queue) {
    const streams = new Map();
    queue.forEach((entry) => {
        const key = getStreamKey(entry);
        if (!streams.has(key)) streams.set(key, []);
        streams.get(key).push(entry);
    });
    const ordered = [];
    streams.forEach((entries) => {
        const phaseReplaceDelete = entries.filter(({ replacement }) => normalizeReplacementAction(replacement) !== 'append');
        const phaseAppend = entries.filter(({ replacement }) => normalizeReplacementAction(replacement) === 'append');
        ordered.push(...phaseReplaceDelete, ...phaseAppend);
    });
    return ordered;
}

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
    return aStart < bEnd && bStart < aEnd;
}

function escapeRegex(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replacePatternInRaw(raw, pattern, newValue) {
    if (!raw || !pattern) return raw;
    const regex = new RegExp(escapeRegex(pattern), 'g');
    if (!regex.test(raw)) return raw;
    return raw.replace(new RegExp(escapeRegex(pattern), 'g'), newValue);
}

function mapStreamToRaw(streamCtx, resolvedBefore, resolvedAfter, presetHints) {
    if (!streamCtx) return streamCtx?.raw || '';
    let raw = streamCtx.raw || '';

    if (resolvedBefore === resolvedAfter) return raw;

    for (const seg of (streamCtx.expander_segments || [])) {
        const beforeSlice = resolvedBefore.substring(seg.resolvedStart, seg.resolvedEnd);
        const endAfter = seg.resolvedEnd + (resolvedAfter.length - resolvedBefore.length);
        const afterSlice = resolvedAfter.substring(seg.resolvedStart, Math.min(endAfter, resolvedAfter.length));
        if (beforeSlice !== afterSlice && afterSlice) {
            raw = replacePatternInRaw(raw, seg.pattern, afterSlice);
        }
    }

    for (const seg of (streamCtx.preset_segments || [])) {
        const beforeSlice = resolvedBefore.substring(seg.resolvedStart, Math.min(seg.resolvedEnd, resolvedBefore.length));
        const endAfter = seg.resolvedEnd + (resolvedAfter.length - resolvedBefore.length);
        const afterSlice = resolvedAfter.substring(seg.resolvedStart, Math.min(endAfter, resolvedAfter.length));
        if (beforeSlice !== afterSlice) {
            const action = seg.type || seg.meta?.action;
            if (action === 'quality_preset') {
                presetHints.append_quality = false;
                presetHints.quality_baked_text = afterSlice;
            } else if (action === 'uc_preset') {
                presetHints.append_uc_disabled = true;
                presetHints.uc_baked_prefix = afterSlice;
            }
        }
    }

    if (raw === streamCtx.raw) {
        const minLen = Math.min(resolvedBefore.length, resolvedAfter.length);
        let diffStart = 0;
        while (diffStart < minLen && resolvedBefore[diffStart] === resolvedAfter[diffStart]) {
            diffStart++;
        }
        let diffEndBefore = resolvedBefore.length;
        let diffEndAfter = resolvedAfter.length;
        while (diffEndBefore > diffStart && diffEndAfter > diffStart &&
            resolvedBefore[diffEndBefore - 1] === resolvedAfter[diffEndAfter - 1]) {
            diffEndBefore--;
            diffEndAfter--;
        }
        const oldMid = resolvedBefore.substring(diffStart, diffEndBefore);
        const newMid = resolvedAfter.substring(diffStart, diffEndAfter);
        if (oldMid && raw.includes(oldMid)) {
            raw = raw.replace(oldMid, newMid);
        } else if (!oldMid && newMid) {
            raw = raw ? `${raw}, ${newMid}` : newMid;
        }
    }

    return raw;
}

function applyPresetToggleHints(presetHints) {
    if (!presetHints || typeof presetHints !== 'object') return;

    if (presetHints.append_quality === false) {
        // appendQuality: manualDropdownManager.js
        appendQuality = false;
    }
    if (presetHints.append_uc_disabled) {
        // selectedUcPreset / append_uc handled via baking into UC field
    }

    if (typeof renderDatasetDropdown === 'function') {
        renderDatasetDropdown();
    }
    if (typeof updatePromptStatusIcons === 'function') {
        updatePromptStatusIcons();
    }
}

function writeTextareaValue(textareaId, value) {
    const textarea = document.getElementById(textareaId);
    if (!textarea) return false;
    // setTextareaValuePreservingUndo: public/scripts/comp/textareaUtils.js
    setTextareaValuePreservingUndo(textarea, value);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    if (typeof autoResizeTextarea === 'function') autoResizeTextarea(textarea);
    if (typeof updateEmphasisHighlighting === 'function') updateEmphasisHighlighting(textarea);
    if (typeof applyFormattedText === 'function') applyFormattedText(textarea, true);
    return true;
}

function writeCharacterField(charIndex, field, value) {
    const characterPromptsContainer = document.getElementById('characterPromptsContainer');
    if (!characterPromptsContainer) return false;
    const characterItems = characterPromptsContainer.querySelectorAll('.character-prompt-item');
    if (charIndex < 0 || charIndex >= characterItems.length) return false;
    const characterId = characterItems[charIndex].id;
    const textarea = document.getElementById(`${characterId}_${field}`);
    if (!textarea) return false;
    setTextareaValuePreservingUndo(textarea, value);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    if (typeof autoResizeTextarea === 'function') autoResizeTextarea(textarea);
    if (typeof updateEmphasisHighlighting === 'function') updateEmphasisHighlighting(textarea);
    return true;
}

function getResolvedBaselineForStream(applicationContext, entry) {
    const streams = applicationContext?.streams;
    if (!streams) return null;

    if (entry.targetType === 'prompt') return streams.prompt?.resolved || '';
    if (entry.targetType === 'uc') return streams.uc?.resolved || '';
    if (entry.targetType === 'character') {
        const char = streams.character_prompts?.[entry.targetSource];
        if (!char) return null;
        return entry.targetField === 'uc' ? (char.uc?.resolved || '') : (char.prompt?.resolved || '');
    }
    return null;
}

function validateReplacementAgainstResolved(replacement, applicationContext) {
    const action = normalizeReplacementAction(replacement);
    if (action === 'append' && !replacement.select_text) return true;

    const targetText = getResolvedBaselineForStream(applicationContext, replacement);
    if (targetText === null) return false;

    const selectText = (replacement?.select_text || '').trim();
    if (!selectText && action !== 'append') return false;
    if (selectText && targetText.indexOf(selectText) !== -1) return true;

    const stripEmphasis = (str) => {
        if (!str) return '';
        let clean = String(str);
        if (typeof stripManagedEmphasisDelimitersForCounting === 'function') {
            clean = stripManagedEmphasisDelimitersForCounting(clean);
        }
        return clean.replace(/-?\d+(?:\.\d+)?::/g, '').replace(/::/g, '').trim();
    };

    const cleanSelect = stripEmphasis(selectText);
    const cleanTarget = stripEmphasis(targetText);

    if (cleanSelect && cleanTarget && cleanTarget.indexOf(cleanSelect) !== -1) return true;
    if (replacement.fallback_select_text && (targetText.indexOf(replacement.fallback_select_text.trim()) !== -1 || (cleanTarget && cleanTarget.indexOf(stripEmphasis(replacement.fallback_select_text.trim())) !== -1))) return true;
    if ((replacement.anchor_text || '').trim() && (targetText.indexOf(replacement.anchor_text.trim()) !== -1 || (cleanTarget && cleanTarget.indexOf(stripEmphasis(replacement.anchor_text.trim())) !== -1))) return true;
    if (!replacement.is_critical && replacement.alternative_text) return true;
    return false;
}

async function applyTendaiToEditorViaServer(selectedReplacements, requestBody) {
    const result = await wsClient.applyTendaiPreview({
        ...requestBody,
        selected_replacements: selectedReplacements
    });
    if (!result?.success) {
        throw new Error(result?.error || 'Server apply failed');
    }
    return result;
}

function applyServerResultToEditor(serverResult) {
    if (serverResult.prompt !== undefined) {
        writeTextareaValue('manualPrompt', serverResult.prompt);
    }
    if (serverResult.uc !== undefined) {
        writeTextareaValue('manualUc', serverResult.uc);
    }
    if (Array.isArray(serverResult.allCharacterPrompts)) {
        serverResult.allCharacterPrompts.forEach((char, index) => {
            if (char.prompt !== undefined) writeCharacterField(index, 'prompt', char.prompt);
            if (char.uc !== undefined) writeCharacterField(index, 'uc', char.uc);
        });
    }
    applyPresetToggleHints(serverResult.preset_toggle_hints);
}

async function applyTendaiToEditor(selectedReplacements, applicationContext, options = {}) {
    if (!selectedReplacements?.length) {
        return { success: false, error: 'No replacements selected', applied: 0, failed: 0 };
    }

    const ctx = applicationContext || getApplicationContext();
    if (!ctx?.streams) {
        if (options.requestBody) {
            try {
                const serverResult = await applyTendaiToEditorViaServer(selectedReplacements, options.requestBody);
                applyServerResultToEditor(serverResult);
                return { success: true, applied: selectedReplacements.length, failed: 0, usedServer: true };
            } catch (err) {
                return { success: false, error: err.message, applied: 0, failed: selectedReplacements.length };
            }
        }
        return { success: false, error: 'No application context available', applied: 0, failed: selectedReplacements.length };
    }

    const queue = orderReplacementQueue(selectedReplacements.map((replacement) => ({
        replacement,
        targetType: replacement.targetType,
        targetSource: replacement.targetSource,
        targetField: replacement.targetField
    })));

    const resolvedState = {
        prompt: ctx.streams.prompt?.resolved || '',
        uc: ctx.streams.uc?.resolved || '',
        character_prompts: (ctx.streams.character_prompts || []).map(c => ({
            prompt: c.prompt?.resolved || '',
            uc: c.uc?.resolved || ''
        }))
    };

    const resolvedBefore = JSON.parse(JSON.stringify(resolvedState));
    let failed = 0;
    let applied = 0;
    const failures = [];

    for (const entry of queue) {
        const { replacement, targetType, targetSource, targetField } = entry;
        let currentText = '';
        if (targetType === 'prompt') currentText = resolvedState.prompt;
        else if (targetType === 'uc') currentText = resolvedState.uc;
        else if (targetType === 'character') {
            if (!resolvedState.character_prompts[targetSource]) {
                resolvedState.character_prompts[targetSource] = { prompt: '', uc: '' };
            }
            currentText = targetField === 'uc'
                ? resolvedState.character_prompts[targetSource].uc
                : resolvedState.character_prompts[targetSource].prompt;
        }

        const applyResult = applyReplacementOnResolvedText(currentText, replacement);
        if (!applyResult.success) {
            failed++;
            failures.push(applyResult.error);
            continue;
        }

        if (targetType === 'prompt') resolvedState.prompt = applyResult.result;
        else if (targetType === 'uc') resolvedState.uc = applyResult.result;
        else if (targetType === 'character') {
            if (targetField === 'uc') {
                resolvedState.character_prompts[targetSource].uc = applyResult.result;
            } else {
                resolvedState.character_prompts[targetSource].prompt = applyResult.result;
            }
        }
        applied++;
    }

    if (failed > 0 && options.requestBody) {
        try {
            const serverResult = await applyTendaiToEditorViaServer(selectedReplacements, options.requestBody);
            applyServerResultToEditor(serverResult);
            return { success: true, applied: selectedReplacements.length, failed: 0, usedServer: true };
        } catch (err) {
            return { success: false, error: failures.join('; ') || err.message, applied, failed };
        }
    }

    const presetHints = {};
    const promptRaw = mapStreamToRaw(ctx.streams.prompt, resolvedBefore.prompt, resolvedState.prompt, presetHints);
    const ucRaw = mapStreamToRaw(ctx.streams.uc, resolvedBefore.uc, resolvedState.uc, presetHints);

    writeTextareaValue('manualPrompt', promptRaw);
    writeTextareaValue('manualUc', ucRaw);

    const charCount = Math.max(
        resolvedState.character_prompts.length,
        (ctx.streams.character_prompts || []).length
    );
    for (let i = 0; i < charCount; i++) {
        const streamCtx = ctx.streams.character_prompts?.[i];
        const before = resolvedBefore.character_prompts[i] || { prompt: '', uc: '' };
        const after = resolvedState.character_prompts[i] || { prompt: '', uc: '' };
        if (streamCtx?.prompt) {
            writeCharacterField(i, 'prompt', mapStreamToRaw(streamCtx.prompt, before.prompt, after.prompt, presetHints));
        }
        if (streamCtx?.uc) {
            writeCharacterField(i, 'uc', mapStreamToRaw(streamCtx.uc, before.uc, after.uc, presetHints));
        }
    }

    applyPresetToggleHints(presetHints);

    if (typeof refreshTokenBarCounts === 'function') refreshTokenBarCounts();

    return {
        success: failed === 0,
        applied,
        failed,
        error: failures.length ? failures.join('; ') : null
    };
}

function collectTendaiReplacementQueue(textReplacements) {
    const queue = [];
    if (!textReplacements) return queue;

    if (Array.isArray(textReplacements.prompt)) {
        textReplacements.prompt.forEach((replacement) => {
            queue.push({ replacement, targetType: 'prompt', targetSource: 'base', included: true });
        });
    }
    if (Array.isArray(textReplacements.uc)) {
        textReplacements.uc.forEach((replacement) => {
            queue.push({ replacement, targetType: 'uc', targetSource: 'base', included: true });
        });
    }
    if (Array.isArray(textReplacements.character_prompts)) {
        textReplacements.character_prompts.forEach((char, charIndex) => {
            if (Array.isArray(char?.prompt)) {
                char.prompt.forEach((replacement) => {
                    queue.push({
                        replacement,
                        targetType: 'character',
                        targetSource: charIndex,
                        targetField: 'prompt',
                        included: true
                    });
                });
            }
            if (Array.isArray(char?.uc)) {
                char.uc.forEach((replacement) => {
                    queue.push({
                        replacement,
                        targetType: 'character',
                        targetSource: charIndex,
                        targetField: 'uc',
                        included: true
                    });
                });
            }
        });
    }
    return queue;
}
