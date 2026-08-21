// Inline emphasis editing — toolbar mode

// Global variables for emphasis editing (toolbar mode only)

// Global variables for emphasis editing
let emphasisEditingActive = false;
let emphasisEditingValue = 1.0;
let emphasisEditingTarget = null;
let emphasisEditingSelection = null;
let emphasisEditingMode = 'normal'; // 'normal', 'brace', 'group'
/** Managed group id when editing invisible delimiters (weights in forge bag). */
let emphasisEditingManagedId = null;
/** When normalize is on: editor shows/edits track percent instead of absolute weight. */
let emphasisEditingValueUnit = 'weight'; // 'weight' | 'percent'
/** Saved group/normal context when drilling into brace mode; restored on toggle back (no text apply). */
let emphasisModeParentContext = null;

function clearEmphasisModeParentContext() {
    emphasisModeParentContext = null;
}

function saveEmphasisModeParentContext() {
    if (!emphasisEditingSelection) return;
    emphasisModeParentContext = {
        mode: emphasisEditingMode,
        selection: {
            start: emphasisEditingSelection.start,
            end: emphasisEditingSelection.end
        },
        value: emphasisEditingValue
    };
}

function restoreEmphasisModeParentContext() {
    if (!emphasisModeParentContext) return false;
    emphasisEditingMode = emphasisModeParentContext.mode;
    emphasisEditingSelection = {
        start: emphasisModeParentContext.selection.start,
        end: emphasisModeParentContext.selection.end
    };
    emphasisEditingValue = emphasisModeParentContext.value;
    emphasisModeParentContext = null;
    return true;
}

function findEmphasisGroupContainingSelection(value, selStart, selEnd) {
    for (const block of listEmphasisBlocks(value)) {
        if (selStart >= block.start && selEnd <= block.end) {
            return {
                start: block.start,
                end: block.end,
                weight: block.weight
            };
        }
    }
    return null;
}

function switchBraceToGroupOrNormal(value) {
    if (restoreEmphasisModeParentContext()) {
        return;
    }

    const containingGroup = findEmphasisGroupContainingSelection(
        value,
        emphasisEditingSelection.start,
        emphasisEditingSelection.end
    );
    if (containingGroup) {
        emphasisEditingMode = 'group';
        emphasisEditingSelection = {
            start: containingGroup.start,
            end: containingGroup.end
        };
        emphasisEditingValue = containingGroup.weight;
        return;
    }

    emphasisEditingMode = 'normal';
    const braceText = value.substring(emphasisEditingSelection.start, emphasisEditingSelection.end);
    if (/^\{+.*\}+$|^\[+.*\]+$/.test(braceText)) {
        emphasisEditingValue = weightFromBraceBlockText(braceText);
    }
}

// Bridge module-scoped state to window (promptTextareaToolbar.js, autocompleteUtils.js)
(function bindEmphasisEditingWindowState() {
    const state = {
        emphasisEditingActive: () => emphasisEditingActive,
        emphasisEditingValue: () => emphasisEditingValue,
        emphasisEditingTarget: () => emphasisEditingTarget,
        emphasisEditingSelection: () => emphasisEditingSelection,
        emphasisEditingMode: () => emphasisEditingMode
    };
    const setters = {
        emphasisEditingActive: (v) => { emphasisEditingActive = v; },
        emphasisEditingValue: (v) => { emphasisEditingValue = v; },
        emphasisEditingTarget: (v) => { emphasisEditingTarget = v; },
        emphasisEditingSelection: (v) => { emphasisEditingSelection = v; },
        emphasisEditingMode: (v) => { emphasisEditingMode = v; },
        emphasisEditingValueUnit: (v) => { emphasisEditingValueUnit = v; }
    };
    Object.keys(state).forEach((name) => {
        Object.defineProperty(window, name, {
            get: state[name],
            set: setters[name],
            configurable: true
        });
    });
    Object.defineProperty(window, 'emphasisEditingValueUnit', {
        get: () => emphasisEditingValueUnit,
        set: (v) => { emphasisEditingValueUnit = v; },
        configurable: true
    });
})();
function applyEmphasisDirectly(target, weight, mode = 'normal') {
    if (!target) {
        return false;
    }
    
    const value = target.value;
    const selectionStart = target.selectionStart;
    const selectionEnd = target.selectionEnd;
    
    if (selectionStart === selectionEnd) {
        return false;
    }
    
    const selectedText = value.substring(selectionStart, selectionEnd).trim();
    if (!selectedText) {
        return false;
    }
    
    const pureNumberPattern = /^-?\d+(\.\d+)?$/;
    if (pureNumberPattern.test(selectedText)) {
        return false;
    }
    
    const numberWithColonsPattern = /^-?\d+(\.\d+)?::$/;
    if (numberWithColonsPattern.test(selectedText)) {
        return false;
    }
    
    let numericWeight;
    if (typeof weight === 'string') {
        numericWeight = parseFloat(weight);
        if (isNaN(numericWeight)) {
            numericWeight = 1.0;
        }
    } else {
        numericWeight = weight;
    }
    numericWeight = clampEmphasisWeight(numericWeight);
    if (mode === 'brace') {
        numericWeight = snapWeightForBraceMode(numericWeight);
    }

    // Managed path for group/normal (not brace) — current hidden|visible mode
    // wrapOrUpdateManagedEmphasisSelection: public/scripts/comp/emphasisGroupIdCodec.js
    if (mode !== 'brace') {
        const managedResult = wrapOrUpdateManagedEmphasisSelection(target, numericWeight);
        if (managedResult && managedResult.success) {
            hideCharacterAutocomplete();
            if (window.autoResizeTextarea) {
                window.autoResizeTextarea(target);
            }
            target.setSelectionRange(managedResult.start, managedResult.end);
            return managedResult;
        }
    }

    const formattedWeight = formatEmphasisWeight(numericWeight);

    const traditionalEmphasisPattern = new RegExp(`^(${EMPHASIS_WEIGHT_PART})::(.+)::$`);
    const autoTerminatingEmphasisPattern = new RegExp(`^(${EMPHASIS_WEIGHT_PART})::(.+)$`);

    let replaceStart = selectionStart;
    let replaceEnd = selectionEnd;
    let innerText = selectedText;
    let emphasizedText;

    const overlappingGroup = findEmphasisBlockOverlappingSelection(value, selectionStart, selectionEnd);
    const overlappingBrace = findBraceBlockOverlappingSelection(value, selectionStart, selectionEnd);

    if (mode === 'brace') {
        if (overlappingBrace) {
            replaceStart = overlappingBrace.start;
            replaceEnd = overlappingBrace.end;
            innerText = overlappingBrace.innerText;
        } else if (overlappingGroup) {
            replaceStart = overlappingGroup.start;
            replaceEnd = overlappingGroup.end;
            innerText = overlappingGroup.innerText;
        } else {
            const isTraditionalEmphasized = traditionalEmphasisPattern.test(selectedText);
            const isAutoTerminatingEmphasized = autoTerminatingEmphasisPattern.test(selectedText);
            if (isTraditionalEmphasized) {
                innerText = selectedText.match(traditionalEmphasisPattern)[2];
            } else if (isAutoTerminatingEmphasized) {
                innerText = selectedText.match(autoTerminatingEmphasisPattern)[2];
            }
        }
        emphasizedText = buildBraceEmphasisText(innerText, numericWeight);
    } else if (overlappingGroup) {
        replaceStart = overlappingGroup.start;
        replaceEnd = overlappingGroup.end;
        innerText = overlappingGroup.innerText;
        emphasizedText = overlappingGroup.needsTerminator
            // formatClassicClosedEmphasisGroup: public/scripts/comp/emphasisGroupIdCodec.js
            ? formatClassicClosedEmphasisGroup(formattedWeight, innerText)
            : `${formattedWeight}::${innerText}`;
    } else if (overlappingBrace) {
        replaceStart = overlappingBrace.start;
        replaceEnd = overlappingBrace.end;
        emphasizedText = buildBraceEmphasisText(overlappingBrace.innerText, snapWeightForBraceMode(numericWeight));
    } else {
        const isTraditionalEmphasized = traditionalEmphasisPattern.test(selectedText);
        const isAutoTerminatingEmphasized = autoTerminatingEmphasisPattern.test(selectedText);
        const isAlreadyEmphasized = isTraditionalEmphasized || isAutoTerminatingEmphasized;

        if (isAlreadyEmphasized) {
            if (isTraditionalEmphasized) {
                innerText = selectedText.match(traditionalEmphasisPattern)[2];
            } else {
                innerText = selectedText.match(autoTerminatingEmphasisPattern)[2];
            }
            const needsTerminator = shouldAddTerminator(value, selectionEnd, {
                allowAutoTerminationByNextGroup: false
            });
            emphasizedText = needsTerminator
                // formatClassicClosedEmphasisGroup: public/scripts/comp/emphasisGroupIdCodec.js
                ? formatClassicClosedEmphasisGroup(formattedWeight, innerText)
                : `${formattedWeight}::${innerText}`;
        } else {
            const needsTerminator = shouldAddTerminator(value, selectionEnd, {
                allowAutoTerminationByNextGroup: false
            });
            emphasizedText = needsTerminator
                // formatClassicClosedEmphasisGroup: public/scripts/comp/emphasisGroupIdCodec.js
                ? formatClassicClosedEmphasisGroup(formattedWeight, selectedText)
                : `${formattedWeight}::${selectedText}`;
        }
    }

    const beforeText = value.substring(0, replaceStart);
    const afterText = value.substring(replaceEnd);
    const newValue = beforeText + emphasizedText + afterText;
    
    // setTextareaValuePreservingUndo: public/scripts/comp/textareaUtils.js
    setTextareaValuePreservingUndo(target, newValue);
    
    const newCursorPosition = replaceStart + emphasizedText.length;
    target.setSelectionRange(newCursorPosition, newCursorPosition);
    
    dispatchPromptTextareaInputEvent(target, { skipAutofill: true });
    hideCharacterAutocomplete();

    if (window.autoResizeTextarea) {
        window.autoResizeTextarea(target);
    }
    if (window.updateEmphasisHighlighting) {
        window.updateEmphasisHighlighting(target);
    }
    
    return {
        success: true,
        emphasizedText: emphasizedText,
        start: replaceStart,
        end: replaceStart + emphasizedText.length
    };
}

function startEmphasisEditing(target) {
    if (!target) return false;

    clearEmphasisModeParentContext();
    emphasisEditingTarget = target;
    emphasisEditingManagedId = null;
    emphasisEditingValueUnit = 'weight';
    const value = target.value;
    const selectionStart = target.selectionStart;
    const selectionEnd = target.selectionEnd;
    // Prefer live caret; fall back to last in-field caret (blur/format can move selection to end).
    const lastCaret = Number.isFinite(target._emphasisLastCaret) ? target._emphasisLastCaret : selectionStart;
    const cursorCandidates = [selectionStart];
    if (selectionEnd !== selectionStart) {
        cursorCandidates.push(Math.max(0, selectionEnd - 1), selectionEnd);
        cursorCandidates.push(Math.floor((selectionStart + selectionEnd) / 2));
    }
    if (lastCaret !== selectionStart) cursorCandidates.push(lastCaret);

    let insideEmphasis = false;
    let emphasisMode = 'normal'; // 'normal', 'brace', 'group'
    let cursorPosition = selectionStart;

    // findManagedEmphasisBlockAtCursor / resolveEmphasisBagForTextarea: public/scripts/comp/emphasisGroupIdCodec.js
    const bag = resolveEmphasisBagForTextarea(target);
    let managedBlock = null;
    for (let i = 0; i < cursorCandidates.length; i++) {
        managedBlock = findManagedEmphasisBlockAtCursor(value, cursorCandidates[i], bag);
        if (managedBlock) {
            cursorPosition = cursorCandidates[i];
            break;
        }
    }
    if (managedBlock) {
        insideEmphasis = true;
        emphasisEditingManagedId = managedBlock.id;
        emphasisEditingValue = managedBlock.weight;
        emphasisEditingSelection = {
            start: managedBlock.start,
            end: managedBlock.end
        };
        emphasisMode = 'group';
        // getEmphasisNormalizeBandForTextarea: public/scripts/comp/emphasisGroupIdCodec.js
        const band = getEmphasisNormalizeBandForTextarea(target);
        if (band.enabled) {
            const share = resolveEmphasisShareForManagedBlock(target, managedBlock, band);
            if (Number.isFinite(share)) {
                emphasisEditingValueUnit = 'percent';
                emphasisEditingValue = clampEmphasisShare(share);
            }
        }
    }

    const emphasisBlock = insideEmphasis
        ? null
        : (findEmphasisBlockAtCursor(value, cursorPosition)
            || (cursorPosition !== selectionStart ? findEmphasisBlockAtCursor(value, selectionStart) : null)
            || (lastCaret !== cursorPosition && lastCaret !== selectionStart
                ? findEmphasisBlockAtCursor(value, lastCaret)
                : null));
    if (emphasisBlock) {
        insideEmphasis = true;
        emphasisEditingValue = emphasisBlock.weight;

        const hasSelection = selectionStart !== selectionEnd;

        if (hasSelection) {
            emphasisEditingSelection = {
                start: selectionStart,
                end: selectionEnd
            };
            emphasisMode = 'normal';
        } else {
            emphasisEditingSelection = {
                start: emphasisBlock.start,
                end: emphasisBlock.end
            };
        }

        const { contentStart, contentEnd } = getEmphasisGroupContentBounds(emphasisBlock.match);
        if (trySelectBraceInEmphasisGroup(value, contentStart, contentEnd, cursorPosition)) {
            emphasisMode = 'brace';
        } else if (emphasisMode !== 'brace') {
            emphasisMode = 'group';
            const band = getEmphasisNormalizeBandForTextarea(target);
            if (band.enabled) {
                const bag = band.bag || {};
                let share = null;
                if (Array.isArray(bag.percentages)) {
                    const groups = listAllEmphasisTargets(value).filter((t) => t.type === 'group');
                    const idx = groups.findIndex((g) =>
                        g.start === emphasisBlock.start && g.end === emphasisBlock.end
                    );
                    if (idx >= 0 && Number.isFinite(bag.percentages[idx])) {
                        share = bag.percentages[idx];
                    }
                }
                if (!Number.isFinite(share) && Number.isFinite(emphasisBlock.weight)) {
                    share = weightToShare(
                        emphasisBlock.weight,
                        band.minWeight,
                        band.maxWeight,
                        { normalizePrecision: true }
                    );
                }
                if (Number.isFinite(share)) {
                    emphasisEditingValueUnit = 'percent';
                    emphasisEditingValue = clampEmphasisShare(share);
                }
            }
        }
    }

    if (!insideEmphasis) {
        const hasSelection = selectionStart !== selectionEnd;

        if (hasSelection) {
            // Use the selected text for emphasis - start with "---" value
            emphasisEditingSelection = {
                start: selectionStart,
                end: selectionEnd
            };
            emphasisEditingValue = "---";
            emphasisMode = 'normal';
        } else {
            const autoBounds = findAutoDetectTagBounds(value, cursorPosition);
            const blockText = value.substring(autoBounds.start, autoBounds.end);

            if (blockText.length < 2) return false;

            if (autoBounds.mode === 'brace') {
                emphasisEditingValue = autoBounds.weight;
                emphasisEditingSelection = {
                    start: autoBounds.start,
                    end: autoBounds.end
                };
                emphasisMode = 'brace';
            } else if (autoBounds.mode === 'group') {
                emphasisEditingValue = autoBounds.weight;
                emphasisEditingSelection = {
                    start: autoBounds.start,
                    end: autoBounds.end
                };
                emphasisMode = 'group';
            } else {
                const currentTagEmphasisPattern = new RegExp(`(${EMPHASIS_WEIGHT_PART})::${blockText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}::`);
                const currentTagMatch = value.match(currentTagEmphasisPattern);

                if (currentTagMatch) {
                    emphasisEditingValue = parseFloat(currentTagMatch[1]);
                    emphasisEditingSelection = {
                        start: currentTagMatch.index,
                        end: currentTagMatch.index + currentTagMatch[0].length
                    };
                    emphasisMode = 'group';
                } else {
                    emphasisEditingValue = "---";
                    emphasisEditingSelection = {
                        start: autoBounds.start,
                        end: autoBounds.end
                    };
                    emphasisMode = 'normal';
                }
            }
        }
    }

    emphasisEditingTarget = target;
    emphasisEditingActive = true;
    emphasisEditingMode = emphasisMode; // Store the mode for later use

    // Hide autocomplete
    hideCharacterAutocomplete();

    // Add a border highlight around the selected text
    addEmphasisSelectionHighlight(emphasisEditingTarget, emphasisEditingSelection);
    
    // Add blur event listener to cancel editing when textarea loses focus
    const blurHandler = (e) => {
        if (!emphasisEditingActive) return;

        const related = e.relatedTarget;
        const container = emphasisEditingTarget?.closest('.prompt-textarea-container, .character-prompt-textarea-container');
        if (related && container && container.contains(related)) {
            return;
        }
        if (related && related.closest && related.closest('.prompt-textarea-toolbar')) {
            return;
        }

        cancelEmphasisEditing();
        // Remove the listener after it's used (with null check)
        if (emphasisEditingTarget && emphasisEditingTarget.removeEventListener) {
            emphasisEditingTarget.removeEventListener('blur', blurHandler);
        }
    };
    emphasisEditingTarget.addEventListener('blur', blurHandler);
    return true;
}

// Add border highlight around selected text for emphasis editing
function addEmphasisSelectionHighlight(textarea, selection) {
    if (!textarea || !selection) return;
    
    const overlay = ensurePromptEmphasisHighlightOverlay(textarea);
    if (!overlay) return;
    
    // Create a simple text-based highlight by wrapping the selected text
    const text = textarea.value;
    const beforeSelection = text.substring(0, selection.start);
    const selectedText = text.substring(selection.start, selection.end);
    const afterSelection = text.substring(selection.end);
    
    // Create highlighted text with golden background for selected portion
    const highlightedText = beforeSelection + 
        `<span style="background: rgba(255, 215, 0, 0.3); border: 2px solid rgba(255, 215, 0, 0.8); border-radius: 3px; padding: 1px;">${selectedText}</span>` + 
        afterSelection;
    
    overlay.innerHTML = highlightedText;
    
    // Sync scroll position
    overlay.scrollTop = textarea.scrollTop;
    overlay.scrollLeft = textarea.scrollLeft;
    
    // Store reference for cleanup
    textarea.emphasisSelectionHighlight = overlay;
}

// Remove emphasis selection highlight
function removeEmphasisSelectionHighlight(textarea) {
    if (!textarea) return;

    const overlay = textarea.emphasisSelectionHighlight || findPromptEmphasisHighlightOverlay(textarea);
    delete textarea.emphasisSelectionHighlight;

    if (overlay) {
        overlay.remove();
    }
}

function adjustEmphasisEditing(delta) {
    // Handle special "---" value (remove emphasis)
    if (emphasisEditingValue === "---") {
        if (delta > 0) {
            emphasisEditingValue = emphasisEditingValueUnit === 'percent' ? 1 : 1.0;
        } else {
            emphasisEditingValue = emphasisEditingValueUnit === 'percent' ? 0 : 0.9;
        }
    } else if (emphasisEditingValueUnit === 'percent') {
        let currentValue = typeof emphasisEditingValue === 'string'
            ? parseFloat(emphasisEditingValue)
            : emphasisEditingValue;
        const step = Math.abs(delta) >= 0.1 ? (delta > 0 ? 1 : -1) : (delta > 0 ? 0.1 : -0.1);
        // Larger toolbar ± should move ~1%; shift fine → 0.1% via getEmphasisAdjustStep mapping below
        const pctStep = Math.abs(delta) <= 0.011 ? 0.1 : (Math.abs(delta) <= 0.11 ? 1 : 5);
        emphasisEditingValue = clampEmphasisShare(currentValue + (delta > 0 ? pctStep : -pctStep));
        } else {
            // Convert to number if it's a string (for integer inputs)
            let currentValue = typeof emphasisEditingValue === 'string' ? parseFloat(emphasisEditingValue) : emphasisEditingValue;

            if (emphasisEditingMode === 'brace') {
                // NovelAI brace levels: step ±1 nesting (1.05^n), not additive 0.1
                // stepBraceEmphasisWeight / weightFromBraceLevel: public/scripts/comp/emphasisParse.js
                const dir = delta > 0 ? 1 : -1;
                if (Math.abs(currentValue - 1) < 0.0001 && dir < 0) {
                    emphasisEditingValue = '---';
                } else if (Math.abs(currentValue - 1) < 0.0001 && dir > 0) {
                    emphasisEditingValue = weightFromBraceLevel(1, 'brace');
                } else {
                    const next = stepBraceEmphasisWeight(currentValue, dir);
                    if ((currentValue > 1 && next < 1) || (currentValue < 1 && next > 1)) {
                        emphasisEditingValue = 1;
                    } else {
                        emphasisEditingValue = next;
                    }
                }
            } else if (currentValue <= 0.9 && currentValue + delta > 0.9) {
                emphasisEditingValue = '---';
            } else if (currentValue >= 1.0 && currentValue + delta < 1.0) {
                emphasisEditingValue = '---';
            } else {
                emphasisEditingValue = clampEmphasisWeight(currentValue + delta);
            }
        }
    
    // Update selection highlight to show the new emphasis value
    if (emphasisEditingTarget && emphasisEditingSelection) {
        addEmphasisSelectionHighlight(emphasisEditingTarget, emphasisEditingSelection);
    }
}

function updateEmphasisEditingFromSlider(value) {
    // Handle special "---" value
    if (value === "---") {
        emphasisEditingValue = "---";
    } else {
        // Convert to number if it's a string (for integer inputs)
        emphasisEditingValue = clampEmphasisWeight(parseFloat(value.toString()));
        if (emphasisEditingMode === 'brace') {
            emphasisEditingValue = snapWeightForBraceMode(emphasisEditingValue);
        }
    }
    
    // Update selection highlight to show the new emphasis value
    if (emphasisEditingTarget && emphasisEditingSelection) {
        addEmphasisSelectionHighlight(emphasisEditingTarget, emphasisEditingSelection);
    }
}

function adjustEmphasisEditingFromWheel(event) {
    event.preventDefault();
    const step = getEmphasisAdjustStep(event.shiftKey);
    const delta = event.deltaY > 0 ? -step : step;
    adjustEmphasisEditing(delta);
}

function applyEmphasisEditing() {
    if (!emphasisEditingTarget || !emphasisEditingSelection) return;

    clearEmphasisModeParentContext();
    const target = emphasisEditingTarget;
    const value = target.value;
    const managedId = emphasisEditingManagedId;
    
    // Check if we're in toolbar mode (needed for both "---" and normal cases)
    const container = target.closest('.prompt-textarea-container, .character-prompt-textarea-container');
    const toolbar = container ? container.querySelector('.prompt-textarea-toolbar') : null;
    const isToolbarMode = toolbar && toolbar.classList.contains('emphasis-mode');

    const finishToolbarClose = () => {
        emphasisEditingActive = false;
        emphasisEditingTarget = null;
        emphasisEditingSelection = null;
        emphasisEditingMode = 'normal';
        emphasisEditingManagedId = null;
        emphasisEditingValueUnit = 'weight';
        removeEmphasisSelectionHighlight(target);
        autoResizeTextarea(target);
        updateEmphasisHighlighting(target);
        if (isToolbarMode && toolbar) {
            if (window.promptTextareaToolbar && window.promptTextareaToolbar.closeEmphasisMode) {
                window.promptTextareaToolbar.closeEmphasisMode(toolbar);
            }
        }
    };

    // Managed invisible group: weights live in forge bag; text keeps delimiters.
    // writeManagedEmphasisGroupWeightsForTextarea / findManagedEmphasisBlockAtCursor:
    //   public/scripts/comp/emphasisGroupIdCodec.js
    if (managedId != null) {
        const live = findManagedEmphasisBlockAtCursor(
            value,
            emphasisEditingSelection.start,
            resolveEmphasisBagForTextarea(target)
        );
        if (emphasisEditingValue === '---') {
            const replaceStart = live ? live.start : emphasisEditingSelection.start;
            const replaceEnd = live ? live.end : emphasisEditingSelection.end;
            const body = live ? live.innerText : value.substring(replaceStart, replaceEnd);
            setTextareaValuePreservingUndo(target, value.substring(0, replaceStart) + body + value.substring(replaceEnd));
            target.setSelectionRange(replaceStart + body.length, replaceStart + body.length);
            writeManagedEmphasisGroupWeightsForTextarea(target, [{ id: managedId, remove: true }]);
            dispatchPromptTextareaInputEvent(target, { skipAutofill: true });
            hideCharacterAutocomplete();
            finishToolbarClose();
            return;
        }

        const weightNum = typeof emphasisEditingValue === 'string'
            ? parseFloat(emphasisEditingValue)
            : emphasisEditingValue;
        let finalWeight = clampEmphasisWeight(weightNum);
        if (emphasisEditingValueUnit === 'percent') {
            const band = getEmphasisNormalizeBandForTextarea(target);
            finalWeight = shareToWeightFromRange(
                clampEmphasisShare(weightNum),
                band.minWeight,
                band.maxWeight
            );
        }
        writeManagedEmphasisGroupWeightsForTextarea(target, [{
            id: managedId,
            weight: finalWeight
        }]);
        // Persist share into bag percentages when normalize on
        const band = getEmphasisNormalizeBandForTextarea(target);
        if (band.enabled && emphasisEditingValueUnit === 'percent') {
            const store = getEmphasisNormalizationFieldStore();
            const share = clampEmphasisShare(weightNum);
            getEmphasisNormalizationDualWriteKeys(target.id).forEach((key) => {
                const prev = store[key] || {};
                const percentagesByKey = { ...(prev.percentagesByKey || {}) };
                percentagesByKey[`managed:${managedId}`] = share;
                percentagesByKey[managedId] = share;
                store[key] = { ...prev, percentagesByKey, enabled: true };
            });
            syncEmphasisNormalizationPreviewMetadata();
        }
        dispatchPromptTextareaInputEvent(target, { skipAutofill: true });
        hideCharacterAutocomplete();
        finishToolbarClose();
        // refreshEmphasisGroupsToolInstancesFromForgeState: public/scripts/comp/emphasisGroupsToolManager.js
        refreshEmphasisGroupsToolInstancesFromForgeState();
        return;
    }
    
    // Handle special "---" value (remove emphasis)
    if (emphasisEditingValue === "---") {
        let replaceStart = emphasisEditingSelection.start;
        let replaceEnd = emphasisEditingSelection.end;
        let emphasizedText;

        const extracted = extractEmphasisInnerForRemoval(value, replaceStart, replaceEnd);
        if (extracted) {
            const resolved = resolveEmphasisRemovalSpan(value, extracted.start, extracted.end, extracted.innerText);
            replaceStart = resolved.replaceStart;
            replaceEnd = resolved.replaceEnd;
            emphasizedText = resolved.replacementText;
        } else {
            const textToEmphasize = value.substring(replaceStart, replaceEnd).trim();
            const isInsideBrace = (textToEmphasize.startsWith('{') && textToEmphasize.endsWith('}')) ||
                                  (textToEmphasize.startsWith('[') && textToEmphasize.endsWith(']'));
            if (isInsideBrace) {
                if (textToEmphasize.startsWith('{') && textToEmphasize.endsWith('}')) {
                    emphasizedText = textToEmphasize.replace(/^\{+/, '').replace(/\}+$/, '');
                } else if (textToEmphasize.startsWith('[') && textToEmphasize.endsWith(']')) {
                    emphasizedText = textToEmphasize.replace(/^\[+/, '').replace(/\]+$/, '');
                } else {
                    emphasizedText = textToEmphasize;
                }
            } else {
                emphasizedText = textToEmphasize;
            }
        }

        const beforeText = value.substring(0, replaceStart);
        const afterText = value.substring(replaceEnd);
        const newValue = beforeText + emphasizedText + afterText;
        
        // setTextareaValuePreservingUndo: public/scripts/comp/textareaUtils.js
    setTextareaValuePreservingUndo(target, newValue);
        
        const newCursorPosition = replaceStart + emphasizedText.length;
        target.setSelectionRange(newCursorPosition, newCursorPosition);
        
        // Reset state and cleanup
        emphasisEditingActive = false;
        emphasisEditingTarget = null;
        emphasisEditingSelection = null;
        emphasisEditingMode = 'normal';
        emphasisEditingManagedId = null;
        
        // Trigger input event to update any dependent UI
        dispatchPromptTextareaInputEvent(target, { skipAutofill: true });
        hideCharacterAutocomplete();
        
        // Remove selection highlight
        removeEmphasisSelectionHighlight(target);
        
        // Update emphasis highlighting
        autoResizeTextarea(target);
        updateEmphasisHighlighting(target);
        
        // Close toolbar mode if in toolbar mode
        if (isToolbarMode && toolbar) {
            if (window.promptTextareaToolbar && window.promptTextareaToolbar.closeEmphasisMode) {
                window.promptTextareaToolbar.closeEmphasisMode(toolbar);
            }
        }
        
        return;
    }
    
    const weight = formatEmphasisWeight(emphasisEditingValue);

    // Get the text to emphasize and adjust selection range to trim boundaries
    let textToEmphasize = value.substring(emphasisEditingSelection.start, emphasisEditingSelection.end);
    
    // Trim the selection range to remove leading/trailing spaces
    const originalStart = emphasisEditingSelection.start;
    const originalEnd = emphasisEditingSelection.end;
    
    // Find the actual start and end of the text (ignoring leading/trailing spaces)
    let actualStart = originalStart;
    let actualEnd = originalEnd;
    
    // Move start forward to skip leading spaces
    while (actualStart < originalEnd && value[actualStart] === ' ') {
        actualStart++;
    }
    
    // Move end backward to skip trailing spaces
    while (actualEnd > actualStart && value[actualEnd - 1] === ' ') {
        actualEnd--;
    }
    
    // Update the selection range
    emphasisEditingSelection.start = actualStart;
    emphasisEditingSelection.end = actualEnd;
    
    // Get the trimmed text
    textToEmphasize = value.substring(actualStart, actualEnd);

    // Check if we're inside an existing emphasis block
    const traditionalEmphasisPattern = /(-?\d+\.\d+)::(.+?)::/;
    const autoTerminatingEmphasisPattern = /(-?\d+\.\d+)::(.+?)(?=\s*-?\d+\.?\d*::|::|$)/;
    const isInsideEmphasis = traditionalEmphasisPattern.test(textToEmphasize) || autoTerminatingEmphasisPattern.test(textToEmphasize);

    // Check if we're inside a {} or [] block
    const isInsideBrace = (textToEmphasize.startsWith('{') && textToEmphasize.endsWith('}')) ||
                          (textToEmphasize.startsWith('[') && textToEmphasize.endsWith(']'));

    let emphasizedText;
    if (emphasisEditingMode === 'brace') {
        let innerText;
        if (isInsideBrace) {
            innerText = textToEmphasize.replace(/^\{+|\[+/, '').replace(/\}+|\]+$/, '');
        } else if (isInsideEmphasis) {
            let match = textToEmphasize.match(traditionalEmphasisPattern);
            if (!match) {
                match = textToEmphasize.match(autoTerminatingEmphasisPattern);
            }
            innerText = match ? match[2] : textToEmphasize;
        } else {
            innerText = textToEmphasize;
        }
        const braceWeight = snapWeightForBraceMode(
            typeof emphasisEditingValue === 'string' ? parseFloat(emphasisEditingValue) : emphasisEditingValue
        );
        emphasizedText = buildBraceEmphasisText(innerText, braceWeight);
    } else if (isInsideEmphasis) {
        // We're inside an existing emphasis block, just update the weight
        let match = textToEmphasize.match(traditionalEmphasisPattern);
        if (match) {
            emphasizedText = textToEmphasize.replace(match[1], weight);
        } else {
            match = textToEmphasize.match(autoTerminatingEmphasisPattern);
            if (match) {
                emphasizedText = textToEmphasize.replace(match[1], weight);
            } else {
                emphasizedText = `${weight}::${textToEmphasize}::`;
            }
        }
    } else {
        // Create new emphasis block — respect field syntax mode (managed vs classic)
        // getEmphasisSyntaxModeForTextarea / buildManagedEmphasisGroupText:
        //   public/scripts/comp/emphasisGroupIdCodec.js
        const syntaxMode = getEmphasisSyntaxModeForTextarea(target);
        const needsTerminator = shouldAddTerminator(value, emphasisEditingSelection.end);
        const weightNum = typeof emphasisEditingValue === 'string'
            ? parseFloat(emphasisEditingValue)
            : emphasisEditingValue;

        if (syntaxMode === 'hidden' || syntaxMode === 'visible') {
            const bag = resolveEmphasisBagForTextarea(target) || {};
            const groupsById = pruneEmphasisGroupsByIdToLiveText(bag.groupsById || {}, value);
            const id = allocateNextManagedEmphasisGroupId(groupsById);
            if (id < 0) return;
            const managedMode = syntaxMode === 'visible' ? 'visible' : 'hidden';
            emphasizedText = buildManagedEmphasisGroupText(id, textToEmphasize, {
                mode: managedMode,
                weight: weightNum,
                omitClose: !needsTerminator
            });
            writeManagedEmphasisGroupWeightsForTextarea(target, [{ id, weight: clampEmphasisWeight(weightNum) }]);
            const store = getEmphasisNormalizationFieldStore();
            getEmphasisNormalizationDualWriteKeys(target.id).forEach((key) => {
                store[key] = {
                    ...(store[key] || {}),
                    syntaxMode,
                    groupsById: {
                        ...((store[key] && store[key].groupsById) || {}),
                        [id]: clampEmphasisWeight(weightNum)
                    }
                };
            });
            syncEmphasisNormalizationPreviewMetadata();
        } else {
            const groupInfo = getPreviousGroupInfo(value, emphasisEditingSelection.start);
            if (groupInfo.isAtEndOfGroup) {
                const previousWeight = groupInfo.previousWeight || weight;
                emphasizedText = `${weight}::${textToEmphasize} ${previousWeight}::`;
            } else {
                emphasizedText = `${weight}::${textToEmphasize}${needsTerminator ? ':: ' : ''}`;
            }
        }
    }

    // Replace the text, preserving the original spacing around the selection
    const beforeText = value.substring(0, emphasisEditingSelection.start);
    let afterText = value.substring(emphasisEditingSelection.end);

    // For brace mode, handle closing braces/brackets around the entire tag
    if (emphasisEditingMode === 'brace') {
        // Check if we have a text selection (not just cursor position)
        const hasTextSelection = emphasisEditingSelection.start !== emphasisEditingSelection.end;
        
        if (hasTextSelection) {
            // If there's a text selection, just replace the selected text with braces
            let newValue = beforeText + emphasizedText + afterText;
            // Add space after comma if needed
            newValue = newValue.replace(/,([^\s])/g, ', $1');
            // setTextareaValuePreservingUndo: public/scripts/comp/textareaUtils.js
    setTextareaValuePreservingUndo(target, newValue);
            // Set cursor position after the emphasized text
            const newCursorPosition = emphasisEditingSelection.start + emphasizedText.length;
            target.setSelectionRange(newCursorPosition, newCursorPosition);
        } else {
            // If no text selection, find the start and end of the tag by searching for delimiters
            let tagStart = emphasisEditingSelection.start;
            let tagEnd = emphasisEditingSelection.end;

            // Expand tagStart backwards to skip spaces, commas, and braces/brackets
            while (tagStart > 0) {
                const char = value[tagStart - 1];
                if (char === ' ' || char === '{' || char === '[' || char === '}' || char === ']') {
                    tagStart--;
                } else if (char === ',') {
                    // If comma, ensure a space follows it
                    if (value[tagStart] !== ' ') {
                        // Insert a space after the comma if missing
                        beforeTag = value.substring(0, tagStart) + ', ';
                        tagStart = beforeTag.length;
                    }
                    break;
                } else if (char === ':' || char === '|') {
                    break;
                } else {
                    break;
                }
            }
            // Expand tagEnd forwards to skip spaces, commas, and braces/brackets
            while (tagEnd < value.length) {
                const char = value[tagEnd];
                if (char === ' ' || char === '{' || char === '[' || char === '}' || char === ']') {
                    tagEnd++;
                } else if (char === ',') {
                    // If comma, ensure a space follows it
                    if (value[tagEnd + 1] !== ' ') {
                        // Insert a space after the comma if missing
                        tagEnd++;
                    }
                    break;
                } else if (char === ':' || char === '|') {
                    break;
                } else {
                    break;
                }
            }

            // Get the text around the tag
            const beforeTag = value.substring(0, tagStart);
            let afterTag = value.substring(tagEnd);
            if (/^,/.test(afterTag) && !/^,\\s/.test(afterTag)) {
                afterTag = ', ' + afterTag.slice(1);
            }

            let newValue = beforeTag + emphasizedText + afterTag;
            // Add space after comma if needed
            newValue = newValue.replace(/,([^\s])/g, ', $1');
            // setTextareaValuePreservingUndo: public/scripts/comp/textareaUtils.js
    setTextareaValuePreservingUndo(target, newValue);
            // Set cursor position after the emphasized text
            const newCursorPosition = newValue.indexOf(emphasizedText) + emphasizedText.length;
            target.setSelectionRange(newCursorPosition, newCursorPosition);
        }
    } else {
        // For other modes, handle spacing as before
        // Ensure there's a space before the emphasis block if needed (only for new blocks)
        let prefix = '';
        if (!isInsideEmphasis && !isInsideBrace && emphasisEditingSelection.start > 0) {
            const charBefore = value[emphasisEditingSelection.start - 1];
            if (charBefore && charBefore !== ' ' && charBefore !== '\n') {
                prefix = ' ';
            }
        }
        
        // Check if this is an end-of-group case by looking at the emphasizedText format
        const isEndOfGroupCase = emphasizedText.includes('::') && emphasizedText.split('::').length > 2;
        
        // For end-of-group cases, we still need the prefix for proper spacing
        
        let processedBefore = beforeText;
        let processedAfter = afterText;
        
        if (!isEndOfGroupCase) {
            // For normal cases, trim to avoid double spaces
            processedBefore = beforeText.replace(/\s+$/, '');
            processedAfter = afterText.replace(/^\s+/, '');
        } else {
            // For end-of-group cases, ensure exactly 1 space before and remove unneeded spaces after
            // Ensure there's exactly 1 space before the selection
            if (!beforeText.endsWith(' ')) {
                processedBefore = beforeText + ' ';
            } else {
                processedBefore = beforeText;
            }
            
            // Check if there's a space after the selection that shouldn't be there
            if (afterText.startsWith(' ')) {
                processedAfter = afterText.substring(1); // Remove the leading space
            } else {
                processedAfter = afterText;
            }
        }

        let newValue = processedBefore + prefix + emphasizedText + processedAfter;

        // Add space after comma if needed
        newValue = newValue.replace(/,([^\s])/g, ', $1');

        // setTextareaValuePreservingUndo: public/scripts/comp/textareaUtils.js
    setTextareaValuePreservingUndo(target, newValue);

        // Set cursor position after the emphasized text
        const newCursorPosition = processedBefore.length + prefix.length + emphasizedText.length;
        target.setSelectionRange(newCursorPosition, newCursorPosition);
    }

    // Reset state
    emphasisEditingActive = false;
    emphasisEditingTarget = null;
    emphasisEditingSelection = null;
    emphasisEditingMode = 'normal';
    emphasisEditingManagedId = null;

    // Trigger input event to update any dependent UI
    dispatchPromptTextareaInputEvent(target, { skipAutofill: true });
    hideCharacterAutocomplete();

    // Remove selection highlight
    removeEmphasisSelectionHighlight(target);

    // Update emphasis highlighting
    autoResizeTextarea(target);
    updateEmphasisHighlighting(target);

    // Close toolbar mode if in toolbar mode
    if (isToolbarMode && toolbar) {
        if (window.promptTextareaToolbar && window.promptTextareaToolbar.closeEmphasisMode) {
            window.promptTextareaToolbar.closeEmphasisMode(toolbar);
        }
    }
}
function switchEmphasisMode(direction) {
    if (!emphasisEditingTarget || !emphasisEditingSelection) return;

    const value = emphasisEditingTarget.value;
    const cursorPosition = emphasisEditingTarget.selectionStart;

    if (direction === 'toggle') {
        // Toggle between group and brace modes (UI only — never modify prompt text)
        if (emphasisEditingMode === 'group') {
            saveEmphasisModeParentContext();
            const groupStart = emphasisEditingSelection.start;
            const groupEnd = emphasisEditingSelection.end;
            let foundBrace = trySelectBraceInEmphasisGroup(value, groupStart, groupEnd, cursorPosition);

            if (!foundBrace) {
                const emphasisText = value.substring(groupStart, groupEnd);
                const tagPattern = /([a-zA-Z0-9_]+(?:\s+[a-zA-Z0-9_]+)*)/g;
                let tagMatch;
                let foundTag = false;

                while ((tagMatch = tagPattern.exec(emphasisText)) !== null) {
                    const tagStartInGroup = groupStart + tagMatch.index;
                    const tagEndInGroup = tagStartInGroup + tagMatch[0].length;

                    if (cursorPosition >= tagStartInGroup && cursorPosition <= tagEndInGroup) {
                        emphasisEditingMode = 'brace';
                        emphasisEditingSelection = {
                            start: tagStartInGroup,
                            end: tagEndInGroup
                        };
                        emphasisEditingValue = 1.0;
                        foundTag = true;
                        break;
                    }
                }

                if (!foundTag) {
                    const textBeforeCursor = value.substring(0, cursorPosition);
                    const textAfterCursor = value.substring(cursorPosition);

                    const wordBefore = textBeforeCursor.match(/\b[a-zA-Z0-9_]+$/);
                    const wordAfter = textAfterCursor.match(/^[a-zA-Z0-9_]+/);

                    if (wordBefore || wordAfter) {
                        const start = wordBefore ? cursorPosition - wordBefore[0].length : cursorPosition;
                        const end = wordAfter ? cursorPosition + wordAfter[0].length : cursorPosition;

                        emphasisEditingMode = 'brace';
                        emphasisEditingSelection = {
                            start: start,
                            end: end
                        };
                        emphasisEditingValue = 1.0;
                    }
                }
            }
        } else if (emphasisEditingMode === 'brace') {
            switchBraceToGroupOrNormal(value);
        }
    } else if (direction === 'right') {
        // Right arrow: switch to more specific mode (UI only)
        switch (emphasisEditingMode) {
            case 'normal':
                saveEmphasisModeParentContext();
                emphasisEditingMode = 'brace';
                emphasisEditingValue = 1.0;
                break;
            case 'group':
                saveEmphasisModeParentContext();
                {
                    const groupStart = emphasisEditingSelection.start;
                    const groupEnd = emphasisEditingSelection.end;
                    let foundBrace = trySelectBraceInEmphasisGroup(value, groupStart, groupEnd, cursorPosition);

                    if (!foundBrace) {
                        const emphasisText = value.substring(groupStart, groupEnd);
                        const tagPattern = /([a-zA-Z0-9_]+(?:\s+[a-zA-Z0-9_]+)*)/g;
                        let tagMatch;
                        let foundTag = false;

                        while ((tagMatch = tagPattern.exec(emphasisText)) !== null) {
                            const tagStartInGroup = groupStart + tagMatch.index;
                            const tagEndInGroup = tagStartInGroup + tagMatch[0].length;

                            if (cursorPosition >= tagStartInGroup && cursorPosition <= tagEndInGroup) {
                                emphasisEditingMode = 'brace';
                                emphasisEditingSelection = {
                                    start: tagStartInGroup,
                                    end: tagEndInGroup
                                };
                                emphasisEditingValue = 1.0;
                                foundTag = true;
                                break;
                            }
                        }

                        if (!foundTag) {
                            const textBeforeCursor = value.substring(0, cursorPosition);
                            const textAfterCursor = value.substring(cursorPosition);
                            const wordBefore = textBeforeCursor.match(/\b[a-zA-Z0-9_]+$/);
                            const wordAfter = textAfterCursor.match(/^[a-zA-Z0-9_]+/);

                            if (wordBefore || wordAfter) {
                                const start = wordBefore ? cursorPosition - wordBefore[0].length : cursorPosition;
                                const end = wordAfter ? cursorPosition + wordAfter[0].length : cursorPosition;

                                emphasisEditingMode = 'brace';
                                emphasisEditingSelection = { start, end };
                                emphasisEditingValue = 1.0;
                            }
                        }
                    }
                }
                break;
        }
    } else if (direction === 'left') {
        if (emphasisEditingMode === 'brace') {
            switchBraceToGroupOrNormal(value);
        }
    }

    // Update selection highlight to show the new emphasis mode
    if (emphasisEditingTarget && emphasisEditingSelection) {
        addEmphasisSelectionHighlight(emphasisEditingTarget, emphasisEditingSelection);
    }
}

function cancelEmphasisEditing() {
    // Check if we're in toolbar mode
    const target = emphasisEditingTarget;
    const container = target ? target.closest('.prompt-textarea-container, .character-prompt-textarea-container') : null;
    const toolbar = container ? container.querySelector('.prompt-textarea-toolbar') : null;
    const isToolbarMode = toolbar && toolbar.classList.contains('emphasis-mode');

    // Remove selection highlight
    if (target) {
        removeEmphasisSelectionHighlight(target);
    }
    
    // Close toolbar mode if in toolbar mode
    if (isToolbarMode && toolbar) {
        if (window.promptTextareaToolbar && window.promptTextareaToolbar.closeEmphasisMode) {
            window.promptTextareaToolbar.closeEmphasisMode(toolbar);
        }
    }

    // Reset state
    clearEmphasisModeParentContext();
    emphasisEditingActive = false;
    emphasisEditingTarget = null;
    emphasisEditingSelection = null;
    emphasisEditingMode = 'normal';
    emphasisEditingManagedId = null;
    emphasisEditingValueUnit = 'weight';
    
    // Refresh emphasis highlighting on the target
    if (target) {
        updateEmphasisHighlighting(target);
    }
}

function applySuggestedEmphasisEditing() {
    if (!emphasisEditingTarget || !emphasisEditingActive) return false;
    // resolveSuggestedEmphasisForTextarea: public/scripts/comp/emphasisGroupIdCodec.js
    const suggested = resolveSuggestedEmphasisForTextarea(
        emphasisEditingTarget,
        emphasisEditingManagedId
    );
    if (!suggested) return false;
    if (emphasisEditingValueUnit === 'percent' && Number.isFinite(suggested.share)) {
        emphasisEditingValue = clampEmphasisShare(suggested.share);
    } else if (Number.isFinite(suggested.weight)) {
        emphasisEditingValue = clampEmphasisWeight(suggested.weight);
    } else {
        return false;
    }
    if (emphasisEditingTarget && emphasisEditingSelection) {
        addEmphasisSelectionHighlight(emphasisEditingTarget, emphasisEditingSelection);
    }
    return true;
}

function updateEmphasisTooltipVisibility() {
    const tooltip = document.getElementById('emphasisTooltip');
    if (tooltip) {
        tooltip.classList.toggle('hidden', !autocompleteNavigationMode);
    }
}
