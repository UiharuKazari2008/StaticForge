// Disable/protect syntax and emphasis stripping

function stripEmphasisFromText(text) {
    if (!text) return '';

    let result = text;
    let prev;

    do {
        prev = result;

        // Weighted traditional emphasis: 1.3::content::
        result = result.replace(/(-?\d+(?:\.\d+)?)::(.+?)::/g, '$2');

        // Weighted auto-terminating emphasis: 1.3::content
        result = result.replace(/(-?\d+(?:\.\d+)?)::(.+?)(?=\s*-?\d+\.?\d*::|::|$)/g, '$2');

        // Unweighted ::content:: groups
        result = result.replace(/::(.+?)::/g, '$1');

        // Brace emphasis {content}, {{content}}
        result = result.replace(/\{+([^{}]*)\}+/g, '$1');

        // Bracket emphasis [content], [[content]]
        result = result.replace(/\[+([^\[\]]*)\]+/g, '$1');

        // Parentheses emphasis (content)
        result = result.replace(/\(([^()]*)\)/g, '$1');
    } while (result !== prev);

    return result;
}

// Function to remove all emphasis from selected text (or entire textarea when nothing is selected)
function removeAllEmphasisFromSelection(target) {
    if (!target) return;

    const value = target.value;
    const start = target.selectionStart;
    const end = target.selectionEnd;
    const hasSelection = start !== end;

    const textToClean = hasSelection ? value.substring(start, end) : value;
    const cleanedText = stripEmphasisFromText(textToClean);

    if (cleanedText === textToClean) return;

    const newValue = hasSelection
        ? value.substring(0, start) + cleanedText + value.substring(end)
        : cleanedText;

    // setTextareaValuePreservingUndo: public/scripts/comp/textareaUtils.js
    setTextareaValuePreservingUndo(target, newValue);

    if (hasSelection) {
        const newEnd = start + cleanedText.length;
        target.setSelectionRange(start, newEnd);
    } else {
        const newCursor = Math.min(start, cleanedText.length);
        target.setSelectionRange(newCursor, newCursor);
    }

    dispatchPromptTextareaInputEvent(target, { skipAutofill: true });
}

// Disable syntax functions
function isCursorInsideDisableBlock(target) {
    if (!target) return null;
    
    const value = target.value;
    const cursorPosition = target.selectionStart;
    
    // Look for disable blocks in the format: !/text/
    const disablePattern = /!\/[^\/]+\//g;
    let match;
    
    while ((match = disablePattern.exec(value)) !== null) {
        const blockStart = match.index;
        const blockEnd = match.index + match[0].length;
        
        // Check if cursor is inside this disable block
        if (cursorPosition >= blockStart && cursorPosition <= blockEnd) {
            return {
                start: blockStart,
                end: blockEnd,
                content: match[0].slice(2, -1), // Remove !/ and /
                fullMatch: match[0]
            };
        }
    }
    
    return null;
}

function removeInnerDisableBlocks(text) {
    // Remove all inner !/ / blocks from the text
    return text.replace(/!\/[^\/]+\//g, (match) => {
        // Extract content between !/ and /
        return match.slice(2, -1);
    });
}

function toggleDisableSyntax(target) {
    if (!target) return;
    
    const value = target.value;
    const selectionStart = target.selectionStart;
    const selectionEnd = target.selectionEnd;
    const hasSelection = selectionStart !== selectionEnd;
    
    // Check if cursor is inside a disable block
    const disableInfo = isCursorInsideDisableBlock(target);
    
    if (disableInfo) {
        // Remove the disable block
        const beforeText = value.substring(0, disableInfo.start);
        const afterText = value.substring(disableInfo.end);
        const newValue = beforeText + disableInfo.content + afterText;
        
        // setTextareaValuePreservingUndo: public/scripts/comp/textareaUtils.js
    setTextareaValuePreservingUndo(target, newValue);
        
        // Set cursor position after the content
        const newCursorPosition = disableInfo.start + disableInfo.content.length;
        target.setSelectionRange(newCursorPosition, newCursorPosition);
        
        // Trigger input event to update any dependent UI
        dispatchPromptTextareaInputEvent(target, { skipAutofill: true });
        
        // Update emphasis highlighting
        if (window.autoResizeTextarea) {
            window.autoResizeTextarea(target);
        }
        if (window.updateEmphasisHighlighting) {
            window.updateEmphasisHighlighting(target);
        }
        
        return;
    }
    
    // If there's a selection, wrap it with disable syntax
    if (hasSelection) {
        const selectedText = value.substring(selectionStart, selectionEnd).trim();
        if (!selectedText) return;
        
        // Remove any inner disable blocks from the selected text
        const cleanedText = removeInnerDisableBlocks(selectedText);
        
        // Wrap with disable syntax
        const disabledText = `!/${cleanedText}/`;
        
        // Replace the selected text
        const beforeText = value.substring(0, selectionStart);
        const afterText = value.substring(selectionEnd);
        const newValue = beforeText + disabledText + afterText;
        
        // setTextareaValuePreservingUndo: public/scripts/comp/textareaUtils.js
    setTextareaValuePreservingUndo(target, newValue);
        
        // Cursor after "!" and before first "/" so a stage index can be typed (!0/, !1+/, !-2/, or leave empty for !/…/)
        const newCursorPosition = selectionStart + 1;
        target.setSelectionRange(newCursorPosition, newCursorPosition);
        
        // Trigger input event to update any dependent UI
        dispatchPromptTextareaInputEvent(target, { skipAutofill: true });
        
        // Update emphasis highlighting
        if (window.autoResizeTextarea) {
            window.autoResizeTextarea(target);
        }
        if (window.updateEmphasisHighlighting) {
            window.updateEmphasisHighlighting(target);
        }
        
        return;
    }
    
    // If no selection and cursor is not inside a disable block, do nothing
}

function isCursorInsideProtectBlock(target) {
    if (!target) return null;

    const value = target.value;
    const cursorPosition = target.selectionStart;
    const protectPattern = /!%[^%]+%/g;
    let match;

    while ((match = protectPattern.exec(value)) !== null) {
        const blockStart = match.index;
        const blockEnd = match.index + match[0].length;

        if (cursorPosition >= blockStart && cursorPosition <= blockEnd) {
            return {
                start: blockStart,
                end: blockEnd,
                content: match[0].slice(2, -1),
                fullMatch: match[0]
            };
        }
    }

    return null;
}

function removeInnerProtectBlocks(text) {
    return text.replace(/!%[^%]+%/g, (match) => match.slice(2, -1));
}

function toggleProtectSyntax(target) {
    if (!target) return;

    const value = target.value;
    const selectionStart = target.selectionStart;
    const selectionEnd = target.selectionEnd;
    const hasSelection = selectionStart !== selectionEnd;

    const protectInfo = isCursorInsideProtectBlock(target);

    if (protectInfo) {
        const beforeText = value.substring(0, protectInfo.start);
        const afterText = value.substring(protectInfo.end);
        const newValue = beforeText + protectInfo.content + afterText;

        // setTextareaValuePreservingUndo: public/scripts/comp/textareaUtils.js
        setTextareaValuePreservingUndo(target, newValue);

        const newCursorPosition = protectInfo.start + protectInfo.content.length;
        target.setSelectionRange(newCursorPosition, newCursorPosition);
        dispatchPromptTextareaInputEvent(target, { skipAutofill: true });

        if (window.autoResizeTextarea) {
            window.autoResizeTextarea(target);
        }
        if (window.updateEmphasisHighlighting) {
            window.updateEmphasisHighlighting(target);
        }

        return;
    }

    if (hasSelection) {
        const selectedText = value.substring(selectionStart, selectionEnd).trim();
        if (!selectedText) return;

        const cleanedText = removeInnerProtectBlocks(selectedText);
        const protectedText = `!%${cleanedText}%`;
        const beforeText = value.substring(0, selectionStart);
        const afterText = value.substring(selectionEnd);
        const newValue = beforeText + protectedText + afterText;

        setTextareaValuePreservingUndo(target, newValue);

        const newCursorPosition = selectionStart + protectedText.length;
        target.setSelectionRange(newCursorPosition, newCursorPosition);
        dispatchPromptTextareaInputEvent(target, { skipAutofill: true });

        if (window.autoResizeTextarea) {
            window.autoResizeTextarea(target);
        }
        if (window.updateEmphasisHighlighting) {
            window.updateEmphasisHighlighting(target);
        }
    }
}

// ============================================================================
// Token Display Modal System
// ============================================================================

let tokenInfoClickHandlersWired = false;

