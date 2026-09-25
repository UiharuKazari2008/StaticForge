// Emphasis selection and cursor/brace helpers

function findEmphasisBlockOverlappingSelection(value, selStart, selEnd) {
    for (const block of listEmphasisBlocks(value)) {
        if (selStart < block.end && selEnd > block.start) {
            return {
                start: block.start,
                end: block.end,
                innerText: block.innerText,
                needsTerminator: block.needsTerminator
            };
        }
    }
    return null;
}

function findBraceBlockOverlappingSelection(value, selStart, selEnd) {
    const pattern = new RegExp(EMPHASIS_BRACE_BLOCK_PATTERN.source, 'g');
    let match;
    while ((match = pattern.exec(value)) !== null) {
        const start = match.index;
        const end = start + match[0].length;
        if (selStart < end && selEnd > start) {
            const blockText = match[0];
            return {
                start,
                end,
                innerText: blockText.replace(/^\{+|\[+/, '').replace(/\}+|\]+$/, '')
            };
        }
    }
    return null;
}

function findEmphasisBraceBlockAtCursor(value, searchStart, searchEnd, cursorPosition) {
    const slice = value.substring(searchStart, searchEnd);
    const pattern = new RegExp(EMPHASIS_BRACE_BLOCK_PATTERN.source, 'g');
    let match;
    while ((match = pattern.exec(slice)) !== null) {
        const start = searchStart + match.index;
        const end = start + match[0].length;
        if (cursorPosition >= start && cursorPosition <= end) {
            return {
                start,
                end,
                weight: weightFromBraceBlockText(match[0])
            };
        }
    }
    return null;
}

function getEmphasisGroupContentBounds(emphasisMatch) {
    const contentStart = emphasisMatch.index + emphasisMatch[1].length + 2;
    const contentEnd = contentStart + emphasisMatch[2].length;
    return { contentStart, contentEnd };
}

function trySelectBraceInEmphasisGroup(value, groupStart, groupEnd, cursorPosition) {
    const braceHit = findEmphasisBraceBlockAtCursor(value, groupStart, groupEnd, cursorPosition);
    if (!braceHit) return false;
    emphasisEditingMode = 'brace';
    emphasisEditingSelection = { start: braceHit.start, end: braceHit.end };
    emphasisEditingValue = braceHit.weight;
    return true;
}

function isDecimalPointAt(value, index) {
    if (index <= 0 || index >= value.length - 1) return false;
    return /\d/.test(value[index - 1]) && /\d/.test(value[index + 1]);
}

function findEmphasisBlockEndBefore(value, pos) {
    let best = 0;
    forEachEmphasisBlockInValue(value, (match, start, end) => {
        if (end <= pos) {
            best = Math.max(best, end);
        }
    });
    return best;
}

function findEmphasisBlockStartAfter(value, pos) {
    let best = value.length;
    forEachEmphasisBlockInValue(value, (match, start) => {
        if (start >= pos) {
            best = Math.min(best, start);
        }
    });
    return best;
}

function trimTagSelectionBounds(value, start, end) {
    let blockStart = start;
    let blockEnd = end;
    while (blockStart < blockEnd && value[blockStart] === ' ') {
        blockStart++;
    }
    while (blockEnd > blockStart && value[blockEnd - 1] === ' ') {
        blockEnd--;
    }
    return { start: blockStart, end: blockEnd };
}

/** Tag bounds when opening emphasis editor with no selection. */
function findAutoDetectTagBounds(value, cursorPosition) {
    const braceHit = findEmphasisBraceBlockAtCursor(value, 0, value.length, cursorPosition);
    if (braceHit) {
        return {
            start: braceHit.start,
            end: braceHit.end,
            mode: 'brace',
            weight: braceHit.weight
        };
    }

    // findManagedEmphasisBlockAtCursor: public/scripts/comp/emphasisGroupIdCodec.js
    const managedBlock = findManagedEmphasisBlockAtCursor(value, cursorPosition);
    if (managedBlock) {
        return {
            start: managedBlock.start,
            end: managedBlock.end,
            mode: 'group',
            weight: managedBlock.weight,
            managedId: managedBlock.id
        };
    }

    const emphasisBlock = findEmphasisBlockAtCursor(value, cursorPosition);
    if (emphasisBlock) {
        return {
            start: emphasisBlock.start,
            end: emphasisBlock.end,
            mode: 'group',
            weight: emphasisBlock.weight
        };
    }

    const textBeforeCursor = value.substring(0, cursorPosition);
    const textAfterCursor = value.substring(cursorPosition);

    let blockStart = findEmphasisBlockEndBefore(value, cursorPosition);

    // Managed open/close ends are term boundaries (same role as classic ::)
    // listManagedEmphasisBlocks: public/scripts/comp/emphasisGroupIdCodec.js
    if (hasManagedEmphasisGroupIds(value)) {
        const managedBlocks = listManagedEmphasisBlocks(value);
        for (let i = 0; i < managedBlocks.length; i++) {
            const b = managedBlocks[i];
            if (b.end <= cursorPosition) {
                blockStart = Math.max(blockStart, b.end);
            }
            if (b.openEnd <= cursorPosition && b.openEnd > blockStart
                && cursorPosition <= b.closeStart) {
                blockStart = Math.max(blockStart, b.openEnd);
            }
        }
    }

    const commaIdx = textBeforeCursor.lastIndexOf(',');
    if (commaIdx >= 0) blockStart = Math.max(blockStart, commaIdx + 1);
    const semicolonIdx = textBeforeCursor.lastIndexOf(';');
    if (semicolonIdx >= 0) blockStart = Math.max(blockStart, semicolonIdx + 1);
    const pipeIdx = textBeforeCursor.lastIndexOf('|');
    if (pipeIdx >= 0) blockStart = Math.max(blockStart, pipeIdx + 1);

    const periodIdx = textBeforeCursor.lastIndexOf('.');
    if (periodIdx >= 0 && !isDecimalPointAt(value, periodIdx)) {
        blockStart = Math.max(blockStart, periodIdx + 1);
    }

    let blockEnd = findEmphasisBlockStartAfter(value, cursorPosition);

    if (hasManagedEmphasisGroupIds(value)) {
        const managedBlocks = listManagedEmphasisBlocks(value);
        for (let i = 0; i < managedBlocks.length; i++) {
            const b = managedBlocks[i];
            if (b.start >= cursorPosition) {
                blockEnd = Math.min(blockEnd, b.start);
            }
            if (b.closeStart >= cursorPosition && b.closeStart < blockEnd
                && cursorPosition >= b.openEnd) {
                blockEnd = Math.min(blockEnd, b.closeStart);
            }
        }
    }

    const forwardDelimiters = [',', ';', '|'];
    for (const delimiter of forwardDelimiters) {
        const idx = textAfterCursor.indexOf(delimiter);
        if (idx >= 0) {
            blockEnd = Math.min(blockEnd, cursorPosition + idx);
        }
    }

    let periodOffset = 0;
    while (periodOffset < textAfterCursor.length) {
        const idx = textAfterCursor.indexOf('.', periodOffset);
        if (idx < 0) break;
        const absIdx = cursorPosition + idx;
        if (!isDecimalPointAt(value, absIdx)) {
            blockEnd = Math.min(blockEnd, absIdx);
            break;
        }
        periodOffset = idx + 1;
    }

    const trimmed = trimTagSelectionBounds(value, blockStart, blockEnd);
    blockStart = trimmed.start;
    blockEnd = trimmed.end;

    const blockText = value.substring(blockStart, blockEnd);
    if (/^\{+.*\}+$|^\[+.*\]+$/.test(blockText)) {
        return {
            start: blockStart,
            end: blockEnd,
            mode: 'brace',
            weight: weightFromBraceBlockText(blockText)
        };
    }

    const braceInTag = findEmphasisBraceBlockAtCursor(value, blockStart, blockEnd, cursorPosition);
    if (braceInTag) {
        return {
            start: braceInTag.start,
            end: braceInTag.end,
            mode: 'brace',
            weight: braceInTag.weight
        };
    }

    return { start: blockStart, end: blockEnd, mode: 'normal' };
}

function isPromptEmphasisSelectionTextarea(el) {
    return el && el.matches
        && el.matches('textarea.prompt-textarea, textarea.character-prompt-textarea')
        && !el.closest('.creative-directive-container, .prompt-textarea-container.director-prompt');
}

function capturePromptTextareaSelection(textarea, options) {
    if (!textarea || typeof textarea.selectionStart !== 'number') return null;
    const rawStart = textarea.selectionStart;
    const rawEnd = textarea.selectionEnd;
    const start = Math.min(rawStart, rawEnd);
    const end = Math.max(rawStart, rawEnd);
    textarea._emphasisLastCaret = start;
    if (start !== end) {
        textarea._emphasisSavedSelection = {
            start,
            end,
            length: (textarea.value || '').length
        };
        return textarea._emphasisSavedSelection;
    }
    if (options && options.clearIfCollapsed && !textarea._emphasisSelGesture) {
        textarea._emphasisSavedSelection = null;
    }
    return textarea._emphasisSavedSelection || {
        start,
        end,
        length: (textarea.value || '').length
    };
}

function beginPromptTextareaSelectionGesture(textarea) {
    if (!textarea) return null;
    textarea._emphasisSelGesture = true;
    return capturePromptTextareaSelection(textarea);
}

function clearPromptTextareaSavedSelection(textarea) {
    if (!textarea) return;
    textarea._emphasisSelGesture = false;
    textarea._emphasisSavedSelection = null;
}

function restorePromptTextareaSavedSelection(textarea, options) {
    if (!textarea || typeof textarea.selectionStart !== 'number') return false;
    if (textarea.selectionStart !== textarea.selectionEnd) return false;
    const saved = textarea._emphasisSavedSelection;
    if (!saved || saved.start === saved.end) return false;
    const value = textarea.value || '';
    if (value.length !== saved.length) return false;
    const start = Math.max(0, Math.min(saved.start, value.length));
    const end = Math.max(start, Math.min(saved.end, value.length));
    if (start === end) return false;
    if (!options || options.focus !== false) {
        textarea.focus();
    }
    textarea.setSelectionRange(start, end);
    return true;
}

function handlePromptTextareaSelectionGesturePointer(event) {
    if (!event || !event.target || !event.target.closest) return;
    const toolbar = event.target.closest('.prompt-textarea-toolbar');
    if (toolbar) {
        const container = toolbar.closest('.prompt-textarea-container, .character-prompt-textarea-container');
        let textarea = null;
        // promptTextareaToolbar.getTextareaFromToolbar: public/scripts/comp/promptTextareaToolbar.js
        if (promptTextareaToolbar) {
            textarea = promptTextareaToolbar.getTextareaFromToolbar(toolbar);
        }
        if (!textarea && container) {
            textarea = container.querySelector('textarea.prompt-textarea, textarea.character-prompt-textarea');
        }
        beginPromptTextareaSelectionGesture(textarea);
        return;
    }
    const textarea = event.target.closest('textarea.prompt-textarea, textarea.character-prompt-textarea');
    if (!isPromptEmphasisSelectionTextarea(textarea)) return;
    if (event.pointerType === 'mouse') return;
    beginPromptTextareaSelectionGesture(textarea);
}

document.addEventListener('touchstart', handlePromptTextareaSelectionGesturePointer, { capture: true, passive: true });
document.addEventListener('pointerdown', handlePromptTextareaSelectionGesturePointer, { capture: true });

