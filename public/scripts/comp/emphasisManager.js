// Global variables for emphasis editing (toolbar mode only)

// Global variables for emphasis editing
let emphasisEditingActive = false;
let emphasisEditingValue = 1.0;
let emphasisEditingTarget = null;
let emphasisEditingSelection = null;
let emphasisEditingMode = 'normal'; // 'normal', 'brace', 'group'

// Function to check if cursor is inside an emphasis block
function isCursorInsideEmphasisBlock(target) {
    if (!target) return null;
    
    const value = target.value;
    const cursorPosition = target.selectionStart;
    
    // Look for emphasis blocks in the format: number::text::
    const emphasisPattern = /(-?\d+(?:\.\d+)?)::([^:]+)::/g;
    let match;
    
    while ((match = emphasisPattern.exec(value)) !== null) {
        const blockStart = match.index;
        const blockEnd = match.index + match[0].length;
        
        // Check if cursor is inside this emphasis block
        if (cursorPosition >= blockStart && cursorPosition <= blockEnd) {
            return {
                start: blockStart,
                end: blockEnd,
                weight: match[1],
                text: match[2],
                fullMatch: match[0]
            };
        }
    }
    
    return null;
}

// Function to split an emphasis block at cursor position
function splitEmphasisBlock(target) {
    if (!target) return false;
    
    const emphasisInfo = isCursorInsideEmphasisBlock(target);
    if (!emphasisInfo) return false;
    
    const value = target.value;
    const cursorPosition = target.selectionStart;
    
    // Calculate the position within the emphasis block text (excluding the weight part)
    const textStart = emphasisInfo.start + emphasisInfo.weight.length + 2; // +2 for "::"
    const textEnd = emphasisInfo.end - 2; // -2 for "::"
    const textContent = emphasisInfo.text;
    
    // Calculate cursor position within the text content
    const cursorInText = cursorPosition - textStart;
    
    if (cursorInText < 0 || cursorInText > textContent.length) {
        return false; // Cursor not in the text part
    }
    
    // Simply insert the emphasis syntax at cursor position with the same weight
    const emphasisInsert = `::, ${emphasisInfo.weight}::`;
    
    // Insert the emphasis syntax at cursor position
    const beforeText = value.substring(0, cursorPosition);
    const afterText = value.substring(cursorPosition);
    const newValue = beforeText + emphasisInsert + afterText;
    
    target.value = newValue;
    
    // Position cursor after the inserted emphasis syntax
    const newCursorPosition = cursorPosition + emphasisInsert.length;
    target.setSelectionRange(newCursorPosition, newCursorPosition);
    
    // Trigger input event to update any dependent UI
    target.dispatchEvent(new Event('input', { bubbles: true }));
    
    return true;
}

// Function to apply emphasis directly to selected text
function applyEmphasisDirectly(target, weight, mode = 'normal') {
    console.log('applyEmphasisDirectly called with:', { target, weight, mode });
    
    if (!target) {
        console.log('No target provided');
        return false;
    }
    
    const value = target.value;
    const selectionStart = target.selectionStart;
    const selectionEnd = target.selectionEnd;
    
    console.log('Selection:', { selectionStart, selectionEnd, hasSelection: selectionStart !== selectionEnd });
    
    // Check if there's a valid text selection
    if (selectionStart === selectionEnd) {
        console.log('No text selected');
        return false; // No text selected
    }
    
    // Get the selected text
    const selectedText = value.substring(selectionStart, selectionEnd).trim();
    if (!selectedText) {
        return false; // Empty selection
    }
    
    // Check if selected text is just a number (prevent emphasis application)
    // This includes patterns like "2.0::", "2", "2.05", "1.5::", etc.
    const numberPattern = /^-?\d+(\.\d+)?(::)?$/;
    if (numberPattern.test(selectedText)) {
        return false; // Don't apply emphasis to pure numbers
    }
    
    // Ensure weight is a valid number
    let numericWeight;
    if (typeof weight === 'string') {
        numericWeight = parseFloat(weight);
        if (isNaN(numericWeight)) {
            numericWeight = 1.0;
        }
    } else {
        numericWeight = weight;
    }
    
    // Format the weight
    const formattedWeight = numericWeight.toFixed(1);
    
    // Check if the selected text is already emphasized
    const emphasisPattern = /^(-?\d+\.\d+)::(.+?)::$/;
    const isAlreadyEmphasized = emphasisPattern.test(selectedText);
    
    let emphasizedText;
    let finalStart = selectionStart;
    let finalEnd = selectionStart;
    
    if (isAlreadyEmphasized) {
        // Update existing emphasis - extract the inner text and re-emphasize
        const match = selectedText.match(emphasisPattern);
        if (match) {
            const innerText = match[2];
            if (mode === 'brace') {
                // Brace mode: create {} or [] blocks with more reasonable scaling
                let braceLevel;
                
                if (numericWeight > 1.0) {
                    // Positive emphasis: use {} - limit to reasonable number
                    braceLevel = Math.min(Math.round((numericWeight - 1.0) * 2), 5); // Max 5 braces
                    const braces = '{'.repeat(braceLevel);
                    emphasizedText = `${braces}${innerText}${'}'.repeat(braceLevel)}`;
                } else if (numericWeight < 1.0) {
                    // Negative emphasis: use [] - limit to reasonable number
                    braceLevel = Math.min(Math.round((1.0 - numericWeight) * 2), 5); // Max 5 brackets
                    const brackets = '['.repeat(braceLevel);
                    emphasizedText = `${brackets}${innerText}${']'.repeat(bracketLevel)}`;
                } else {
                    // No emphasis: just the text
                    emphasizedText = innerText;
                }
            } else {
                // Normal/Group mode: create emphasis block
                emphasizedText = `${formattedWeight}::${innerText}::`;
            }
            console.log('Updated existing emphasis:', { old: selectedText, new: emphasizedText });
        }
    } else {
        // Create new emphasis
        if (mode === 'brace') {
            // Brace mode: create {} or [] blocks with more reasonable scaling
            let braceLevel;
            
            if (numericWeight > 1.0) {
                // Positive emphasis: use {} - limit to reasonable number
                braceLevel = Math.min(Math.round((numericWeight - 1.0) * 2), 5); // Max 5 braces
                const braces = '{'.repeat(braceLevel);
                emphasizedText = `${braces}${selectedText}${'}'.repeat(braceLevel)}`;
            } else if (numericWeight < 1.0) {
                // Negative emphasis: use [] - limit to reasonable number
                braceLevel = Math.min(Math.round((1.0 - numericWeight) * 2), 5); // Max 5 brackets
                const brackets = '['.repeat(braceLevel);
                emphasizedText = `${brackets}${selectedText}${']'.repeat(braceLevel)}`;
            } else {
                // No emphasis: just the text
                emphasizedText = selectedText;
            }
        } else if (mode === 'group') {
            // Group mode: create emphasis block (same as normal for now)
            emphasizedText = `${formattedWeight}::${selectedText}::`;
        } else {
            // Normal mode: create emphasis block
            emphasizedText = `${formattedWeight}::${selectedText}::`;
        }
        console.log('Created new emphasis:', emphasizedText);
    }
    
    // Replace the selected text with the emphasized version
    const beforeText = value.substring(0, selectionStart);
    const afterText = value.substring(selectionEnd);
    const newValue = beforeText + emphasizedText + afterText;
    
    console.log('Replacing text:', { 
        original: value.substring(selectionStart, selectionEnd),
        emphasized: emphasizedText,
        newValue: newValue.substring(0, 100) + '...'
    });
    
    target.value = newValue;
    
    // Set cursor position after the emphasized text
    const newCursorPosition = selectionStart + emphasizedText.length;
    target.setSelectionRange(newCursorPosition, newCursorPosition);
    
    // Trigger input event to update any dependent UI
    target.dispatchEvent(new Event('input', { bubbles: true }));
    
    // Update emphasis highlighting
    if (window.autoResizeTextarea) {
        window.autoResizeTextarea(target);
    }
    if (window.updateEmphasisHighlighting) {
        window.updateEmphasisHighlighting(target);
    }
    
    // Return the emphasized text and its position for reselection
    return {
        success: true,
        emphasizedText: emphasizedText,
        start: selectionStart,
        end: selectionStart + emphasizedText.length
    };
}

// Emphasis highlighting functionality
let emphasisHighlightingActive = false;
let emphasisHighlightingTarget = null;

// Text search functionality
let textSearchPopup = null;
let textSearchActive = false;
let textSearchTarget = null;
let textSearchQuery = '';
let textSearchResults = [];
let selectedSearchIndex = -1;
let searchHighlightOverlay = null;

function checkCanAddEmphasis(target) {
    const value = target.value;
    const cursorPosition = target.selectionStart;
    const textBeforeCursor = value.substring(0, cursorPosition);

    // First check if cursor is inside a {} or [] block
    const bracePattern = /\{([^}]*)\}|\[([^\]]*)\]/g;
    let braceMatch;
    while ((braceMatch = bracePattern.exec(value)) !== null) {
        const braceStart = braceMatch.index;
        const braceEnd = braceMatch.index + braceMatch[0].length;

        if (cursorPosition >= braceStart && cursorPosition <= braceEnd) {
            // Cursor is inside a {} or [] block, can add emphasis
            return true;
        }
    }

    // Check if cursor is at end of a tag pattern (same logic as autocomplete)
    const lastDelimiterIndex = Math.max(
        textBeforeCursor.lastIndexOf('{'),
        textBeforeCursor.lastIndexOf('}'),
        textBeforeCursor.lastIndexOf('['),
        textBeforeCursor.lastIndexOf(']'),
        textBeforeCursor.lastIndexOf(':'),
        textBeforeCursor.lastIndexOf('|'),
        textBeforeCursor.lastIndexOf(',')
    );
    const searchText = lastDelimiterIndex >= 0 ?
        textBeforeCursor.substring(lastDelimiterIndex + 1).trim() :
        textBeforeCursor.trim();

    // Check if we have a valid tag to emphasize
    return searchText.length >= 2 && /^[a-zA-Z0-9_]+$/.test(searchText);
}

// Emphasis editing functions (toolbar mode only)

function startEmphasisEditing(target) {
    if (!target) return;

    emphasisEditingTarget = target;
    const value = target.value;
    const cursorPosition = target.selectionStart;
    const textBeforeCursor = value.substring(0, cursorPosition);

    // First, check if cursor is inside an existing emphasis block
    const emphasisPattern = /(-?\d+\.\d+)::([^:]+)::/g;
    let emphasisMatch;
    let insideEmphasis = false;
    let emphasisMode = 'normal'; // 'normal', 'brace', 'group'

    while ((emphasisMatch = emphasisPattern.exec(value)) !== null) {
        const emphasisStart = emphasisMatch.index;
        const emphasisEnd = emphasisMatch.index + emphasisMatch[0].length;

        if (cursorPosition >= emphasisStart && cursorPosition <= emphasisEnd) {
            // Cursor is inside an existing emphasis block
            insideEmphasis = true;
            emphasisEditingValue = parseFloat(emphasisMatch[1]);
            emphasisEditingSelection = {
                start: emphasisStart,
                end: emphasisEnd
            };

            // Check if there's a {} block inside this emphasis block
            const emphasisText = emphasisMatch[2];
            const bracePattern = /\{([^}]*)\}/g;
            let braceMatch;
            while ((braceMatch = bracePattern.exec(emphasisText)) !== null) {
                const braceStartInEmphasis = emphasisStart + emphasisMatch.index;
                const braceEndInEmphasis = braceStartInEmphasis + braceMatch[0].length;

                if (cursorPosition >= braceStartInEmphasis && cursorPosition <= braceEndInEmphasis) {
                    // Cursor is inside a {} block within the emphasis block
                    emphasisMode = 'brace';
                    emphasisEditingSelection = {
                        start: braceStartInEmphasis,
                        end: braceEndInEmphasis
                    };
                    break;
                }
            }

            if (emphasisMode !== 'brace') {
                emphasisMode = 'group';
            }
            break;
        }
    }

    if (!insideEmphasis) {
        // Check if cursor is inside a {} or [] block
        const bracePattern = /\{([^}]*)\}|\[([^\]]*)\]/g;
        let braceMatch;
        let insideBrace = false;

        while ((braceMatch = bracePattern.exec(value)) !== null) {
            const braceStart = braceMatch.index;
            const braceEnd = braceMatch.index + braceMatch[0].length;

            if (cursorPosition >= braceStart && cursorPosition <= braceEnd) {
                // Cursor is inside a {} or [] block
                insideBrace = true;
                emphasisMode = 'brace';
                // Calculate weight based on number of {} or [] around it
                const braceText = braceMatch[0];
                const isBracket = braceText.startsWith('[');

                if (isBracket) {
                    // [] block - negative emphasis
                    const openBrackets = (braceText.match(/\[/g) || []).length;
                    const closeBrackets = (braceText.match(/\]/g) || []).length;
                    const bracketLevel = openBrackets - closeBrackets;
                    emphasisEditingValue = 1.0 - (bracketLevel * 0.1);
                } else {
                    // {} block - positive emphasis
                    const openBraces = (braceText.match(/\{/g) || []).length;
                    const closeBraces = (braceText.match(/\}/g) || []).length;
                    const braceLevel = openBraces - closeBraces;
                    emphasisEditingValue = 1.0 + (braceLevel * 0.1);
                }

                emphasisEditingSelection = {
                    start: braceStart,
                    end: braceEnd
                };
                break;
            }
        }

        // If not inside a brace, check if we're at the start/end of a brace block within an emphasis group
        if (!insideBrace) {
            const emphasisPattern = /(-?\d+\.\d+)::([^:]+)::/g;
            let emphasisMatch;

            while ((emphasisMatch = emphasisPattern.exec(value)) !== null) {
                const emphasisStart = emphasisMatch.index;
                const emphasisEnd = emphasisMatch.index + emphasisMatch[0].length;
                const emphasisText = emphasisMatch[2];

                // Check if cursor is at the start or end of a brace block within this emphasis
                if (cursorPosition >= emphasisStart && cursorPosition <= emphasisEnd) {
                    const relativePos = cursorPosition - emphasisStart;
                    const emphasisContent = emphasisText;

                    // Check if cursor is at the start of a brace block
                    const braceStartMatch = emphasisContent.match(/^(\{+|\[+)/);
                    if (braceStartMatch && relativePos <= braceStartMatch[0].length) {
                        insideBrace = true;
                        emphasisMode = 'brace';
                        const braceLevel = braceStartMatch[0].length;
                        emphasisEditingValue = braceStartMatch[0].startsWith('[') ?
                            1.0 - (braceLevel * 0.1) : 1.0 + (braceLevel * 0.1);
                        emphasisEditingSelection = {
                            start: emphasisStart + emphasisMatch.index + 1,
                            end: emphasisStart + emphasisMatch.index + 1 + braceStartMatch[0].length
                        };
                        break;
                    }

                    // Check if cursor is at the end of a brace block
                    const braceEndMatch = emphasisContent.match(/(\}+|]+)$/);
                    if (braceEndMatch && relativePos >= emphasisContent.length - braceEndMatch[0].length) {
                        insideBrace = true;
                        emphasisMode = 'brace';
                        const braceLevel = braceEndMatch[0].length;
                        emphasisEditingValue = braceEndMatch[0].startsWith(']') ?
                            1.0 - (braceLevel * 0.1) : 1.0 + (braceLevel * 0.1);
                        emphasisEditingSelection = {
                            start: emphasisStart + emphasisMatch.index + 1 + emphasisContent.length - braceEndMatch[0].length,
                            end: emphasisStart + emphasisMatch.index + 1 + emphasisContent.length
                        };
                        break;
                    }
                }
            }
        }

        if (!insideBrace) {
            // Check if there's a text selection
            const selectionStart = target.selectionStart;
            const selectionEnd = target.selectionEnd;
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
                // For new blocks, search back to find the block boundary
                const searchBackIndex = Math.max(
                    textBeforeCursor.lastIndexOf(','),
                    textBeforeCursor.lastIndexOf('|'),
                    textBeforeCursor.lastIndexOf(':'),
                    textBeforeCursor.lastIndexOf('{'),
                    textBeforeCursor.lastIndexOf('}'),
                    textBeforeCursor.lastIndexOf('['),
                    textBeforeCursor.lastIndexOf(']')
                );

                const blockStart = searchBackIndex >= 0 ? searchBackIndex + 1 : 0;

                // Search forward to find the end of the current tag
                const textAfterCursor = value.substring(cursorPosition);
                const searchForwardIndex = Math.min(
                    textAfterCursor.indexOf(',') >= 0 ? textAfterCursor.indexOf(',') : Infinity,
                    textAfterCursor.indexOf('|') >= 0 ? textAfterCursor.indexOf('|') : Infinity,
                    textAfterCursor.indexOf(':') >= 0 ? textAfterCursor.indexOf(':') : Infinity,
                    textAfterCursor.indexOf('{') >= 0 ? textAfterCursor.indexOf('{') : Infinity,
                    textAfterCursor.indexOf('}') >= 0 ? textAfterCursor.indexOf('}') : Infinity,
                    textAfterCursor.indexOf('[') >= 0 ? textAfterCursor.indexOf('[') : Infinity,
                    textAfterCursor.indexOf(']') >= 0 ? textAfterCursor.indexOf(']') : Infinity
                );

                const blockEnd = searchForwardIndex !== Infinity ? cursorPosition + searchForwardIndex : value.length;
                const blockText = value.substring(blockStart, blockEnd).trim();

                if (blockText.length < 2) return;

                // Check if the current tag is already emphasized
                const currentTagEmphasisPattern = new RegExp(`(-?\\d+\\.\\d+)::${blockText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}::`);
                const currentTagMatch = value.match(currentTagEmphasisPattern);

                if (currentTagMatch) {
                    // Current tag is already emphasized, adjust its weight
                    emphasisEditingValue = parseFloat(currentTagMatch[1]);
                    emphasisEditingSelection = {
                        start: currentTagMatch.index,
                        end: currentTagMatch.index + currentTagMatch[0].length
                    };
                    emphasisMode = 'group';
                } else {
                    // Create new emphasis block - start with "---" value
                    emphasisEditingValue = "---";
                    emphasisEditingSelection = {
                        start: blockStart,
                        end: blockEnd
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
    const blurHandler = () => {
        if (emphasisEditingActive) {
            cancelEmphasisEditing();
        }
        // Remove the listener after it's used (with null check)
        if (emphasisEditingTarget && emphasisEditingTarget.removeEventListener) {
            emphasisEditingTarget.removeEventListener('blur', blurHandler);
        }
    };
    emphasisEditingTarget.addEventListener('blur', blurHandler);
}

// Add border highlight around selected text for emphasis editing
function addEmphasisSelectionHighlight(textarea, selection) {
    if (!textarea || !selection) return;
    
    // Create or get the emphasis overlay
    let overlay = textarea.parentElement.querySelector('.emphasis-highlight-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'emphasis-highlight-overlay';
        overlay.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            pointer-events: none;
            z-index: 1;
            font-family: inherit;
            font-size: inherit;
            line-height: inherit;
            white-space: pre-wrap;
            word-wrap: break-word;
            overflow: hidden;
            background: transparent;
        `;
        
        // Ensure textarea container has relative positioning
        const container = textarea.parentElement;
        const containerStyle = window.getComputedStyle(container);
        if (containerStyle.position === 'static') {
            container.style.position = 'relative';
        }
        
        container.appendChild(overlay);
    }
    
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
    if (textarea && textarea.emphasisSelectionHighlight) {
        textarea.emphasisSelectionHighlight.remove();
        delete textarea.emphasisSelectionHighlight;
    }
    
    // Also remove any selection highlight overlay
    const overlay = textarea.parentElement.querySelector('.emphasis-highlight-overlay');
    if (overlay) {
        overlay.remove();
    }
}

function adjustEmphasisEditing(delta) {
    // Handle special "---" value (remove emphasis)
    if (emphasisEditingValue === "---") {
        if (delta > 0) {
            emphasisEditingValue = 1.0;
        } else {
            emphasisEditingValue = 0.9;
        }
    } else {
        // Convert to number if it's a string (for integer inputs)
        let currentValue = typeof emphasisEditingValue === 'string' ? parseFloat(emphasisEditingValue) : emphasisEditingValue;
        
        // Check if we're crossing the "---" threshold
        if (currentValue <= 0.9 && currentValue + delta > 0.9) {
            emphasisEditingValue = "---";
        } else if (currentValue >= 1.0 && currentValue + delta < 1.0) {
            emphasisEditingValue = "---";
        } else {
            emphasisEditingValue = Math.max(-1.0, Math.min(5.0, currentValue + delta));
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
        emphasisEditingValue = parseFloat(value.toString());
    }
    
    // Update selection highlight to show the new emphasis value
    if (emphasisEditingTarget && emphasisEditingSelection) {
        addEmphasisSelectionHighlight(emphasisEditingTarget, emphasisEditingSelection);
    }
}

function adjustEmphasisEditingFromWheel(event) {
    event.preventDefault();
    const delta = event.deltaY > 0 ? -0.1 : 0.1;
    adjustEmphasisEditing(delta);
}

function applyEmphasisEditing() {
    if (!emphasisEditingTarget || !emphasisEditingSelection) return;

    const target = emphasisEditingTarget;
    const value = target.value;
    
    // Check if we're in toolbar mode (needed for both "---" and normal cases)
    const container = target.closest('.prompt-textarea-container, .character-prompt-textarea-container');
    const toolbar = container ? container.querySelector('.prompt-textarea-toolbar') : null;
    const isToolbarMode = toolbar && toolbar.classList.contains('emphasis-mode');
    
    // Handle special "---" value (remove emphasis)
    if (emphasisEditingValue === "---") {
        // Get the text to emphasize (trim any leading/trailing spaces)
        const textToEmphasize = value.substring(emphasisEditingSelection.start, emphasisEditingSelection.end).trim();
        
        // Check if we're inside an existing emphasis block
        const emphasisPattern = /(-?\d+\.\d+)::([^:]+)::/;
        const isInsideEmphasis = emphasisPattern.test(textToEmphasize);
        
        // Check if we're inside a {} or [] block
        const isInsideBrace = (textToEmphasize.startsWith('{') && textToEmphasize.endsWith('}')) ||
                              (textToEmphasize.startsWith('[') && textToEmphasize.endsWith(']'));
        
        let emphasizedText;
        if (isInsideEmphasis) {
            // Extract the text content from emphasis block
            const match = textToEmphasize.match(emphasisPattern);
            emphasizedText = match ? match[2] : textToEmphasize;
        } else if (isInsideBrace) {
            // Extract the text content from brace block
            if (textToEmphasize.startsWith('{') && textToEmphasize.endsWith('}')) {
                emphasizedText = textToEmphasize.replace(/^\{+/, '').replace(/\}+$/, '');
            } else if (textToEmphasize.startsWith('[') && textToEmphasize.endsWith(']')) {
                emphasizedText = textToEmphasize.replace(/^\[+/, '').replace(/\]+$/, '');
            } else {
                emphasizedText = textToEmphasize;
            }
        } else {
            // No emphasis to remove, just use the text as is
            emphasizedText = textToEmphasize;
        }
        
        // Replace the text with the cleaned version
        const beforeText = value.substring(0, emphasisEditingSelection.start);
        const afterText = value.substring(emphasisEditingSelection.end);
        const newValue = beforeText + emphasizedText + afterText;
        
        target.value = newValue;
        
        // Set cursor position after the cleaned text
        const newCursorPosition = emphasisEditingSelection.start + emphasizedText.length;
        target.setSelectionRange(newCursorPosition, newCursorPosition);
        
        // Reset state and cleanup
        emphasisEditingActive = false;
        emphasisEditingTarget = null;
        emphasisEditingSelection = null;
        emphasisEditingMode = 'normal';
        
        // Trigger input event to update any dependent UI
        target.dispatchEvent(new Event('input', { bubbles: true }));
        
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
    
    const weight = emphasisEditingValue.toFixed(1);

    // Get the text to emphasize (trim any leading/trailing spaces)
    const textToEmphasize = value.substring(emphasisEditingSelection.start, emphasisEditingSelection.end).trim();

    // Check if we're inside an existing emphasis block
    const emphasisPattern = /(-?\d+\.\d+)::([^:]+)::/;
    const isInsideEmphasis = emphasisPattern.test(textToEmphasize);

    // Check if we're inside a {} or [] block
    const isInsideBrace = (textToEmphasize.startsWith('{') && textToEmphasize.endsWith('}')) ||
                          (textToEmphasize.startsWith('[') && textToEmphasize.endsWith(']'));

    let emphasizedText;
    if (emphasisEditingMode === 'brace') {
        // Brace mode: create or update {} or [] blocks
        if (isInsideBrace) {
            // Update existing brace block - extract the actual text content
            let innerText;
            if (textToEmphasize.startsWith('{') && textToEmphasize.endsWith('}')) {
                // Remove all { and } from the beginning and end
                innerText = textToEmphasize.replace(/^\{+/, '').replace(/\}+$/, '');
            } else if (textToEmphasize.startsWith('[') && textToEmphasize.endsWith(']')) {
                // Remove all [ and ] from the beginning and end
                innerText = textToEmphasize.replace(/^\[+/, '').replace(/\]+$/, '');
            } else {
                innerText = textToEmphasize;
            }

            const braceLevel = Math.round((emphasisEditingValue - 1.0) * 10);

            if (braceLevel > 0) {
                // Positive emphasis: use {} - ensure clean conversion from []
                const braces = '{'.repeat(braceLevel + 1);
                emphasizedText = `${braces}${innerText}${'}'.repeat(braceLevel + 1)}`;
            } else if (braceLevel < 0) {
                // Negative emphasis: use [] - ensure clean conversion from {}
                const bracketLevel = Math.abs(Math.round((1.0 - emphasisEditingValue) * 10));
                const brackets = '['.repeat(bracketLevel);
                emphasizedText = `${brackets}${innerText}${']'.repeat(bracketLevel)}`;
            } else {
                // No emphasis: just the text - remove all braces/brackets
                emphasizedText = innerText;
            }
        } else {
            // Create new brace block
            const braceLevel = Math.round((emphasisEditingValue - 1.0) * 10);

            if (braceLevel > 0) {
                // Positive emphasis: use {}
                const braces = '{'.repeat(braceLevel + 1);
                emphasizedText = `${braces}${textToEmphasize}${'}'.repeat(braceLevel + 1)}`;
            } else if (braceLevel < 0) {
                // Negative emphasis: use [] (inverted calculation)
                const bracketLevel = Math.abs(Math.round((1.0 - emphasisEditingValue) * 10));
                const brackets = '['.repeat(bracketLevel);
                emphasizedText = `${brackets}${textToEmphasize}${']'.repeat(bracketLevel)}`;
            } else {
                // No emphasis: just the text
                emphasizedText = textToEmphasize;
            }
        }
    } else if (isInsideEmphasis) {
        // We're inside an existing emphasis block, just update the weight
        const match = textToEmphasize.match(emphasisPattern);
        if (match) {
            emphasizedText = textToEmphasize.replace(match[1], weight);
        } else {
            emphasizedText = `${weight}::${textToEmphasize}::`;
        }
    } else {
        // Create new emphasis block - no extra spaces inside
        emphasizedText = `${weight}::${textToEmphasize}::`;
    }

    // Replace the text, preserving the original spacing around the selection
    const beforeText = value.substring(0, emphasisEditingSelection.start);
    let afterText = value.substring(emphasisEditingSelection.end);

    // For brace mode, handle closing braces/brackets around the entire tag
    if (emphasisEditingMode === 'brace') {
        // Find the start and end of the tag by searching for delimiters
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
        target.value = newValue;
        // Set cursor position after the emphasized text
        const newCursorPosition = newValue.indexOf(emphasizedText) + emphasizedText.length;
        target.setSelectionRange(newCursorPosition, newCursorPosition);
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

        // Remove any trailing space from beforeText and leading space from afterText
        // to avoid double spaces
        const trimmedBefore = beforeText.replace(/\s+$/, '');
        const trimmedAfter = afterText.replace(/^\s+/, '');

        let newValue = trimmedBefore + prefix + emphasizedText + (trimmedAfter ? ' ' + trimmedAfter : '');

        // Add space after comma if needed
        newValue = newValue.replace(/,([^\s])/g, ', $1');

        target.value = newValue;

        // Set cursor position after the emphasized text
        const newCursorPosition = trimmedBefore.length + prefix.length + emphasizedText.length;
        target.setSelectionRange(newCursorPosition, newCursorPosition);
    }

    // Reset state
    emphasisEditingActive = false;
    emphasisEditingTarget = null;
    emphasisEditingSelection = null;
    emphasisEditingMode = 'normal';

    // Trigger input event to update any dependent UI
    target.dispatchEvent(new Event('input', { bubbles: true }));

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

// Emphasis highlighting functions
function startEmphasisHighlighting(textarea) {
    if (emphasisHighlightingActive && emphasisHighlightingTarget === textarea) return;

    emphasisHighlightingActive = true;
    emphasisHighlightingTarget = textarea;

    // Add event listeners for real-time highlighting
    textarea.addEventListener('input', () => {
        autoResizeTextarea(textarea);
        updateEmphasisHighlighting(textarea);
    });

    // Initial highlighting
    autoResizeTextarea(textarea);
    updateEmphasisHighlighting(textarea);
}

function stopEmphasisHighlighting() {
    emphasisHighlightingActive = false;
    emphasisHighlightingTarget = null;
}

function updateEmphasisHighlighting(textarea) {
    if (!textarea) return;

    const value = textarea.value;
    const highlightedValue = highlightEmphasisInText(value);

    // Create or update the highlighting overlay
    let overlay = textarea.parentElement.querySelector('.emphasis-highlight-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'emphasis-highlight-overlay';
        textarea.parentElement.appendChild(overlay);
    }

    overlay.innerHTML = highlightedValue;

    // Sync scroll position
    overlay.scrollTop = textarea.scrollTop;
    overlay.scrollLeft = textarea.scrollLeft;
}

function initializeEmphasisOverlay(textarea) {
    if (!textarea) return;

    const value = textarea.value;
    const highlightedValue = highlightEmphasisInText(value);

    // Create or update the highlighting overlay
    let overlay = textarea.parentElement.querySelector('.emphasis-highlight-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'emphasis-highlight-overlay';
        textarea.parentElement.appendChild(overlay);
    }

    overlay.innerHTML = highlightedValue;

    // Sync scroll position
    overlay.scrollTop = textarea.scrollTop;
    overlay.scrollLeft = textarea.scrollLeft;
}

function highlightEmphasisInText(text) {
    if (!text) return '';

    let highlightedText = text;

    // Function to calculate dynamic colors based on weight
    function getEmphasisColors(weight) {
        let backgroundR, backgroundG, backgroundB, backgroundA;
        let borderR, borderG, borderB, borderA;

        if (weight >= 1.0 && weight <= 5.0) {
            // Positive emphasis: 1-3.0 with stronger 1-3 range and gradual 3-5 range
            if (weight <= 2.0) {
                // Stronger changes in 1-3 range
                const ratio = (weight - 1.0) / 2.0; // 0 to 1 over 1-3 range
                backgroundR = 255;
                backgroundG = Math.round(69 - (46 * ratio));
                backgroundB = Math.round(0 + (23 * ratio));
                backgroundA = 0.05 + (0.67 * ratio);
            } else {
                // More gradual changes in 3-5 range
                const gradualRatio = (weight - 3.0) / 2.0; // 0 to 1 over 3-5 range
                backgroundR = 255;
                backgroundG = 23; // Already at minimum from 1-3 range
                backgroundB = 23; // Already at maximum from 1-3 range
                backgroundA = 0.72 + (0.28 * gradualRatio); // Subtle alpha increase
            }

            // Brighter border for contrast
            borderR = Math.min(255, backgroundR + 30);
            borderG = Math.min(255, backgroundG + 30);
            borderB = Math.min(255, backgroundB + 30);
            borderA = Math.min(1.0, backgroundA + 0.2);
        } else if (weight >= -2.0 && weight <= 1.0) {
            // Negative emphasis: -4-1.0 = rgba(23, 134, 255, 0.69) to rgba(0, 91, 163, 0.25)
            const ratio = Math.max((weight + 2.0) / 3.0, 0.0); // Adjusted for -4 to 1 range
            backgroundR = Math.round(23 - (23 * ratio));
            backgroundG = Math.round(134 - (43 * ratio));
            backgroundB = 255;
            backgroundA = 0.69 - (0.44 * ratio);

            // Brighter border for contrast
            borderR = Math.min(255, backgroundR + 30);
            borderG = Math.min(255, backgroundG + 30);
            borderB = Math.min(255, backgroundB + 30);
            borderA = Math.min(1.0, backgroundA + 0.2);
        } else {
            // Default neutral color
            backgroundR = 76; backgroundG = 175; backgroundB = 80; backgroundA = 0.2;
            borderR = 106; borderG = 205; borderB = 110; borderA = 0.4;
        }

        return {
            background: `rgba(${backgroundR}, ${backgroundG}, ${backgroundB}, ${backgroundA.toFixed(2)})`,
            border: `rgba(${borderR}, ${borderG}, ${borderB}, ${borderA.toFixed(2)})`
        };
    }

    // Function to get group colors based on group index
    function getGroupColors(groupIndex) {
        const colors = [
            { border: 'rgba(255, 99, 132, 0.75)', background: 'rgba(255, 99, 132, 0.1)' },   // Red
            { border: 'rgba(54, 162, 235, 0.75)', background: 'rgba(54, 162, 235, 0.1)' },   // Blue
            { border: 'rgba(255, 205, 86, 0.75)', background: 'rgba(255, 205, 86, 0.1)' },   // Yellow
            { border: 'rgba(75, 192, 192, 0.75)', background: 'rgba(75, 192, 192, 0.1)' },   // Teal
            { border: 'rgba(153, 102, 255, 0.75)', background: 'rgba(153, 102, 255, 0.1)' }, // Purple
            { border: 'rgba(255, 159, 64, 0.75)', background: 'rgba(255, 159, 64, 0.1)' },   // Orange
            { border: 'rgba(199, 199, 199, 0.75)', background: 'rgba(199, 199, 199, 0.1)' }, // Gray
            { border: 'rgba(83, 102, 255, 0.75)', background: 'rgba(83, 102, 255, 0.1)' }    // Indigo
        ];
        return colors[groupIndex % colors.length];
    }

    // Function to apply NSFW highlighting to content
    function applyNSFWHighlighting(content) {
        if (!window.u1) return content;

        // Create a regex pattern from all u1 tags, sorted by length (longest first to avoid partial matches)
        const sortedTags = [...window.u1].sort((a, b) => b.length - a.length);
        const tagPattern = new RegExp(`\\b(${sortedTags.map(tag => tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'gi');

        return content.replace(tagPattern, (match, tag) => {
            // Check if this tag is part of a single colon pattern (like "tag:value")
            const tagIndex = content.indexOf(match);
            const beforeTag = content.substring(0, tagIndex);
            const afterTag = content.substring(tagIndex + match.length);
            
            // If there's a single colon before or after the tag, it's likely part of a tag:value pattern
            const hasSingleColonBefore = beforeTag.endsWith(':') && !beforeTag.endsWith('::');
            const hasSingleColonAfter = afterTag.startsWith(':') && !afterTag.startsWith('::');
            
            if (hasSingleColonBefore || hasSingleColonAfter) {
                return match; // Don't highlight, return as-is
            }
            
            return `<span class="emphasis-highlight" style="background: #ff49dd85; border-color: #ff49ddc9;">${tag}</span>`;
        });
    }

    // First, split text into groups by | and apply group highlighting
    const groups = highlightedText.split('|');
    if (groups.length > 1) {
        highlightedText = groups.map((group, index) => {
            if (group) {
                const colors = getGroupColors(index);
                return `<span class="emphasis-group" style="border: 2px dashed ${colors.border}; padding: 0; margin: -4px; border-radius: 4px; display: inline;">${group}</span>`;
            }
            return group;
        }).join('|');
    }

    // Highlight weight::text:: format (ensure it's exactly two colons)
    highlightedText = highlightedText.replace(/(-?\d+\.?\d*)::([^:]+)::/g, (match, weight, content) => {
        const weightNum = parseFloat(weight);
        const colors = getEmphasisColors(weightNum);

        // Apply NSFW highlighting to the content inside emphasis
        const highlightedContent = applyNSFWHighlighting(content);

        return `<span class="emphasis-highlight" style="background: ${colors.background}; border-color: ${colors.border};">${weight}::${highlightedContent}::</span>`;
    });

    // Highlight brace emphasis {text} - convert to weight equivalent
    highlightedText = highlightedText.replace(/(\{+)([^}]+)(\}+)/g, (match, openBraces, content, closeBraces) => {
        const braceLevel = Math.min(openBraces.length, closeBraces.length);
        const weight = 1.0 + (braceLevel * 0.1); // Convert brace level to weight (+0.1 per level)
        const colors = getEmphasisColors(weight);

        // Apply NSFW highlighting to the content inside braces
        const highlightedContent = applyNSFWHighlighting(content);

        return `<span class="emphasis-highlight" style="background: ${colors.background}; border-color: ${colors.border};">${openBraces}${highlightedContent}${closeBraces}</span>`;
    });

    // Highlight bracket emphasis [text] - convert to weight equivalent
    highlightedText = highlightedText.replace(/(\[+)([^\]]+)(\]+)/g, (match, openBrackets, content, closeBrackets) => {
        const bracketLevel = Math.min(openBrackets.length, closeBrackets.length);
        const weight = 1.0 - (bracketLevel * 0.1); // Convert bracket level to weight (-0.1 per level)
        const colors = getEmphasisColors(weight);

        // Apply NSFW highlighting to the content inside brackets
        const highlightedContent = applyNSFWHighlighting(content);

        return `<span class="emphasis-highlight" style="background: ${colors.background}; border-color: ${colors.border};">${openBrackets}${highlightedContent}${closeBrackets}</span>`;
    });

    // Highlight text replacements <text> - no emphasis levels, just visual highlighting
    // Match patterns that look like valid text replacement keys (letters, numbers, underscores) - case insensitive
    // Handle PICK replacements with ~ suffix
    highlightedText = highlightedText.replace(/(!)([a-zA-Z0-9_]+)(~)/g, (match, exclamation, content, tilde) => {
        const backgroundColor = '#628a33'; // PICK replacement color

        // Escape the ! and ~ characters for HTML display
        const escapedMatch = match.replace(/!/g, '&#33;').replace(/~/g, '&#126;');

        return `<span class="emphasis-highlight" style="background: ${backgroundColor}; border-color: ${backgroundColor};">${escapedMatch}</span>`;
    });
    
    // Handle regular replacements with word boundary matching
    highlightedText = highlightedText.replace(/(!)([a-zA-Z0-9_]+)\b/g, (match, exclamation, content) => {
        const backgroundColor = '#8bc34a8a'; // Regular replacement color

        // Escape the ! character for HTML display
        const escapedMatch = match.replace(/!/g, '&#33;');

        return `<span class="emphasis-highlight" style="background: ${backgroundColor}; border-color: ${backgroundColor};">${escapedMatch}</span>`;
    });

    // Highlight NSFW tags in remaining text (outside of emphasis blocks)
    // Only process text that's not already inside emphasis-highlight spans
    highlightedText = highlightedText.replace(/([^<]*?)(?=<span class="emphasis-highlight"|$)/g, (match, text) => {
        if (!window.u1 || !text.trim()) return match;

        // Create a regex pattern from all u1 tags, sorted by length (longest first)
        const sortedTags = [...window.u1].sort((a, b) => b.length - a.length);
        const tagPattern = new RegExp(`\\b(${sortedTags.map(tag => tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'gi');

        return text.replace(tagPattern, (tagMatch, tag) => {
            // Check if this tag is part of a single colon pattern (like "tag:value")
            // If so, don't highlight it as NSFW
            const tagIndex = text.indexOf(tagMatch);
            const beforeTag = text.substring(0, tagIndex);
            const afterTag = text.substring(tagIndex + tagMatch.length);
            
            // If there's a single colon before or after the tag, it's likely part of a tag:value pattern
            const hasSingleColonBefore = beforeTag.endsWith(':') && !beforeTag.endsWith('::');
            const hasSingleColonAfter = afterTag.startsWith(':') && !afterTag.startsWith('::');
            
            if (hasSingleColonBefore || hasSingleColonAfter) {
                return tagMatch; // Don't highlight, return as-is
            }
            
            return `<span class="emphasis-highlight" style="background: #ff49dd85; border-color: #ff49ddc9;">${tag}</span>`;
        });
    });

    return highlightedText;
}

// Helper function to clean up emphasis groups and brace blocks, and copy values
function cleanupEmphasisGroupsAndCopyValue(target, selection, currentValue) {
    const value = target.value;
    let cleanedValue = value;
    let newSelection = { ...selection };
    let copiedValue = currentValue;

    // First, clean up emphasis groups
    const emphasisPattern = /(-?\d+\.\d+)::([^:]+)::/g;
    let emphasisMatch;

    while ((emphasisMatch = emphasisPattern.exec(cleanedValue)) !== null) {
        const emphasisStart = emphasisMatch.index;
        const emphasisEnd = emphasisMatch.index + emphasisMatch[0].length;

        // If the current selection overlaps with an emphasis group, clean it up
        if (selection.start <= emphasisEnd && selection.end >= emphasisStart) {
            const beforeEmphasis = cleanedValue.substring(0, emphasisStart);
            const afterEmphasis = cleanedValue.substring(emphasisEnd);
            const emphasisContent = emphasisMatch[2]; // The text inside the emphasis
            const emphasisWeight = parseFloat(emphasisMatch[1]);

            // Copy the emphasis value
            copiedValue = emphasisWeight;

            // Replace the emphasis group with just the content
            cleanedValue = beforeEmphasis + emphasisContent + afterEmphasis;

            // Update the selection to point to the cleaned content
            newSelection = {
                start: emphasisStart,
                end: emphasisStart + emphasisContent.length
            };
            break;
        }
    }

    // Then, clean up brace blocks ({} and [])
    const bracePattern = /\{+([^{}]*)\}+|\[+([^\[\]]*)\]+/g;
    let braceMatch;

    while ((braceMatch = bracePattern.exec(cleanedValue)) !== null) {
        const braceStart = braceMatch.index;
        const braceEnd = braceMatch.index + braceMatch[0].length;

        // If the current selection overlaps with a brace block, clean it up
        if (selection.start <= braceEnd && selection.end >= braceStart) {
            const beforeBrace = cleanedValue.substring(0, braceStart);
            const afterBrace = cleanedValue.substring(braceEnd);
            const braceContent = braceMatch[1] || braceMatch[2]; // The text inside the braces
            const isBracket = braceMatch[0].startsWith('[');

            // Calculate brace value
            if (isBracket) {
                const bracketLevel = (braceMatch[0].match(/\[/g) || []).length;
                copiedValue = 1.0 - (bracketLevel * 0.1);
            } else {
                const braceLevel = (braceMatch[0].match(/\{/g) || []).length;
                copiedValue = 1.0 + (braceLevel * 0.1);
            }

            // Replace the brace block with just the content
            cleanedValue = beforeBrace + braceContent + afterBrace;

            // Update the selection to point to the cleaned content
            newSelection = {
                start: braceStart,
                end: braceStart + braceContent.length
            };
            break;
        }
    }

    // Update the target value
    target.value = cleanedValue;

    return {
        newSelection,
        copiedValue,
        cleanedValue
    };
}

function switchEmphasisMode(direction) {
    if (!emphasisEditingTarget || !emphasisEditingSelection) return;

    const value = emphasisEditingTarget.value;
    const cursorPosition = emphasisEditingTarget.selectionStart;

    if (direction === 'toggle') {
        // Toggle between group and brace modes
        if (emphasisEditingMode === 'group') {
            // Switch from group to brace mode
            const emphasisText = value.substring(emphasisEditingSelection.start, emphasisEditingSelection.end);
            const bracePattern = /\{([^}]*)\}|\[([^\]]*)\]/g;
            let braceMatch;
            let foundBrace = false;

            while ((braceMatch = bracePattern.exec(emphasisText)) !== null) {
                const braceStartInEmphasis = emphasisEditingSelection.start + emphasisText.indexOf(braceMatch[0]);
                const braceEndInEmphasis = braceStartInEmphasis + braceMatch[0].length;

                if (cursorPosition >= braceStartInEmphasis && cursorPosition <= braceEndInEmphasis) {
                    emphasisEditingMode = 'brace';
                    emphasisEditingSelection = {
                        start: braceStartInEmphasis,
                        end: braceEndInEmphasis
                    };
                    // Calculate brace level from the text
                    const braceText = braceMatch[0];
                    const isBracket = braceText.startsWith('[');

                    if (isBracket) {
                        const openBrackets = (braceText.match(/\[/g) || []).length;
                        const closeBrackets = (braceText.match(/\]/g) || []).length;
                        const bracketLevel = openBrackets - closeBrackets;
                        emphasisEditingValue = 1.0 - (bracketLevel * 0.1);
                    } else {
                        const openBraces = (braceText.match(/\{/g) || []).length;
                        const closeBraces = (braceText.match(/\}/g) || []).length;
                        const braceLevel = openBraces - closeBraces;
                        emphasisEditingValue = 1.0 + (braceLevel * 0.1);
                    }
                    foundBrace = true;
                    break;
                }
            }

            if (!foundBrace) {
                // Find the current word/tag within the group
                const groupText = emphasisText;
                const tagPattern = /([a-zA-Z0-9_]+(?:\s+[a-zA-Z0-9_]+)*)/g;
                let tagMatch;
                let foundTag = false;

                while ((tagMatch = tagPattern.exec(groupText)) !== null) {
                    const tagStartInGroup = emphasisEditingSelection.start + tagMatch.index;
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
                    // Use cursor position to find the word
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
            // Switch from brace to group mode
            const emphasisPattern = /(-?\d+\.\d+)::([^:]+)::/g;
            let emphasisMatch;
            let foundGroup = false;

            // Store the current brace value before switching
            const currentBraceValue = emphasisEditingValue;

            while ((emphasisMatch = emphasisPattern.exec(value)) !== null) {
                const emphasisStart = emphasisMatch.index;
                const emphasisEnd = emphasisMatch.index + emphasisMatch[0].length;

                // Check if we're inside this emphasis group (but not switching between outer/inner)
                if (emphasisEditingSelection.start >= emphasisStart && emphasisEditingSelection.end <= emphasisEnd) {
                    // Don't allow switching to a group that contains the current selection
                    // This prevents switching between outer and inner groups
                    continue;
                }

                // Check if this emphasis group is inside our current selection
                if (emphasisStart >= emphasisEditingSelection.start && emphasisEnd <= emphasisEditingSelection.end) {
                    emphasisEditingMode = 'group';
                    emphasisEditingSelection = {
                        start: emphasisStart,
                        end: emphasisEnd
                    };
                    // Copy the brace value to the group value
                    emphasisEditingValue = currentBraceValue;
                    foundGroup = true;
                    break;
                }
            }

            if (!foundGroup) {
                // If no group found, create a new emphasis block from the brace
                const braceText = value.substring(emphasisEditingSelection.start, emphasisEditingSelection.end);
                const innerText = braceText.replace(/^\{+|\[+/, '').replace(/\}+|\]+$/, '');

                // Calculate weight from brace level
                const braceLevel = (braceText.match(/\{/g) || []).length - (braceText.match(/\}/g) || []).length;
                const bracketLevel = (braceText.match(/\[/g) || []).length - (braceText.match(/\]/g) || []).length;

                if (braceLevel > 0) {
                    emphasisEditingValue = 1.0 + (braceLevel * 0.1);
                } else if (bracketLevel > 0) {
                    emphasisEditingValue = 1.0 - (bracketLevel * 0.1);
                } else {
                    emphasisEditingValue = 1.0;
                }

                // Create new emphasis block and clean up existing groups
                const result = cleanupEmphasisGroupsAndCopyValue(emphasisEditingTarget, emphasisEditingSelection, emphasisEditingValue);
                emphasisEditingMode = 'normal';
                emphasisEditingSelection = result.newSelection;
                emphasisEditingValue = result.copiedValue;
            }
        }
    } else if (direction === 'right') {
        // Right arrow: switch to more specific mode
        switch (emphasisEditingMode) {
            case 'normal':
                // Switch to brace mode - add {} around current selection
                emphasisEditingMode = 'brace';
                emphasisEditingValue = 1.0;
                break;
            case 'group':
                // Switch to brace mode - focus on {} or [] block inside the group
                const emphasisText = value.substring(emphasisEditingSelection.start, emphasisEditingSelection.end);
                const bracePattern = /\{([^}]*)\}|\[([^\]]*)\]/g;
                let braceMatch;
                let foundBrace = false;
                while ((braceMatch = bracePattern.exec(emphasisText)) !== null) {
                    const braceStartInEmphasis = emphasisEditingSelection.start + emphasisText.indexOf(braceMatch[0]);
                    const braceEndInEmphasis = braceStartInEmphasis + braceMatch[0].length;

                    if (cursorPosition >= braceStartInEmphasis && cursorPosition <= braceEndInEmphasis) {
                        emphasisEditingMode = 'brace';
                        emphasisEditingSelection = {
                            start: braceStartInEmphasis,
                            end: braceEndInEmphasis
                        };
                        // Calculate brace level from the text
                        const braceText = braceMatch[0];
                        const isBracket = braceText.startsWith('[');

                        if (isBracket) {
                            const openBrackets = (braceText.match(/\[/g) || []).length;
                            const closeBrackets = (braceText.match(/\]/g) || []).length;
                            const bracketLevel = openBrackets - closeBrackets;
                            emphasisEditingValue = 1.0 - (bracketLevel * 0.1);
                        } else {
                            const openBraces = (braceText.match(/\{/g) || []).length;
                            const closeBraces = (braceText.match(/\}/g) || []).length;
                            const braceLevel = openBraces - closeBraces;
                            emphasisEditingValue = 1.0 + (braceLevel * 0.1);
                        }
                        foundBrace = true;
                        break;
                    }
                }

                // If no specific brace found, find the current tag/item within the group
                if (!foundBrace) {
                    // Find the current tag/item within the group
                    const groupText = emphasisText;
                    const tagPattern = /([a-zA-Z0-9_]+(?:\s+[a-zA-Z0-9_]+)*)/g;
                    let tagMatch;
                    let foundTag = false;

                    while ((tagMatch = tagPattern.exec(groupText)) !== null) {
                        const tagStartInGroup = emphasisEditingSelection.start + tagMatch.index;
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

                    // If still no tag found, use the cursor position to find the word
                    if (!foundTag) {
                        const textBeforeCursor = value.substring(0, cursorPosition);
                        const textAfterCursor = value.substring(cursorPosition);

                        // Find the word boundaries
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
                break;
        }
    } else if (direction === 'left') {
                        // Left arrow: switch to less specific mode
        switch (emphasisEditingMode) {
            case 'brace':
                // Try to switch back to group mode first
                const emphasisPattern = /(-?\d+\.\d+)::([^:]+)::/g;
                let emphasisMatch;
                let foundGroup = false;

                // Store the current brace value before switching
                const currentBraceValue = emphasisEditingValue;

                while ((emphasisMatch = emphasisPattern.exec(value)) !== null) {
                    const emphasisStart = emphasisMatch.index;
                    const emphasisEnd = emphasisMatch.index + emphasisMatch[0].length;

                    // Check if we're inside this emphasis group (but not switching between outer/inner)
                    if (emphasisEditingSelection.start >= emphasisStart && emphasisEditingSelection.end <= emphasisEnd) {
                        // Don't allow switching to a group that contains the current selection
                        // This prevents switching between outer and inner groups
                        continue;
                    }

                    // Check if this emphasis group is inside our current selection
                    if (emphasisStart >= emphasisEditingSelection.start && emphasisEnd <= emphasisEditingSelection.end) {
                        emphasisEditingMode = 'group';
                        emphasisEditingSelection = {
                            start: emphasisStart,
                            end: emphasisEnd
                        };
                        // Copy the brace value to the group value
                        emphasisEditingValue = currentBraceValue;
                        foundGroup = true;
                        break;
                    }
                }

                // If no group found, switch back to normal mode
                if (!foundGroup) {
                    emphasisEditingMode = 'normal';
                    // Copy the brace value to normal mode and clean up existing groups
                    const result = cleanupEmphasisGroupsAndCopyValue(emphasisEditingTarget, emphasisEditingSelection, currentBraceValue);
                    emphasisEditingSelection = result.newSelection;
                    emphasisEditingValue = result.copiedValue;
                }
                break;
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
    emphasisEditingActive = false;
    emphasisEditingTarget = null;
    emphasisEditingSelection = null;
    emphasisEditingMode = 'normal';
    
    // Refresh emphasis highlighting on the target
    if (target) {
        updateEmphasisHighlighting(target);
    }
}

function updateEmphasisTooltipVisibility() {
    const tooltip = document.getElementById('emphasisTooltip');
    if (tooltip) {
        tooltip.classList.toggle('hidden', !autocompleteNavigationMode);
    }
}

// Text search functionality
function startTextSearch(target) {
    if (!target || (target.tagName !== 'TEXTAREA' && target.tagName !== 'INPUT')) return;

    textSearchActive = true;
    textSearchTarget = target;
    textSearchQuery = '';
    textSearchResults = [];
    selectedSearchIndex = -1;

    // Add input event listener to exit search when typing
    const inputHandler = () => {
        if (textSearchActive) {
            closeTextSearch();
        }
    };
    
    // Add keydown event listener to exit search when editing
    const keydownHandler = (e) => {
        if (textSearchActive && !e.ctrlKey && !e.metaKey && !e.altKey) {
            // Don't exit for navigation keys, but exit for typing
            if (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Delete') {
                closeTextSearch();
            }
        }
    };
    
    // Store the handlers so we can remove them later
    target._searchInputHandler = inputHandler;
    target._searchKeydownHandler = keydownHandler;
    
    target.addEventListener('input', inputHandler);
    target.addEventListener('keydown', keydownHandler);

    // Show text search popup
    showTextSearchPopup();
}

function showTextSearchPopup() {
    // Create popup if it doesn't exist
    if (!textSearchPopup) {
        textSearchPopup = document.createElement('div');
        textSearchPopup.id = 'textSearchPopup';
        textSearchPopup.className = 'text-search-popup';
        textSearchPopup.innerHTML = `
            <div class="text-search-popup-content">
                <div class="text-search-label">Search</div>
                <div class="text-search-input-container">
                    <input type="text" id="textSearchInput" class="text-search-input" placeholder="Enter search term..." />
                </div>
                <div class="text-search-match-count" id="textSearchMatchCount">0</div>
                <div class="text-search-controls">
                    <button class="btn-secondary text-search-prev" onclick="navigateSearchResult(-1)" title="Previous">↑</button>
                    <button class="btn-secondary text-search-next" onclick="navigateSearchResult(1)" title="Next">↓</button>
                    <button class="btn-secondary text-search-close" onclick="closeTextSearch()" title="Close">×</button>
                </div>
            </div>
        `;
        document.body.appendChild(textSearchPopup);

        // Add event listener to input
        const searchInput = textSearchPopup.querySelector('#textSearchInput');
        searchInput.addEventListener('input', (e) => {
            textSearchQuery = e.target.value;
            performTextSearch();
        });
        searchInput.addEventListener('keydown', handleTextSearchKeydown);
    }

    // Position popup near the textarea
    const rect = textSearchTarget.getBoundingClientRect();
    textSearchPopup.style.left = (rect.left + rect.width / 2 - 175) + 'px';
    textSearchPopup.style.top = (rect.top - 50) + 'px';
            textSearchPopup.classList.remove('hidden');

    // Focus the input
    const searchInput = textSearchPopup.querySelector('#textSearchInput');
    searchInput.focus();
    searchInput.select();
}

function performTextSearch() {
    if (!textSearchTarget || !textSearchQuery.trim()) {
        textSearchResults = [];
        selectedSearchIndex = -1;
        updateTextSearchResults();
        clearSearchHighlights();
        return;
    }

    const text = textSearchTarget.value;
    const query = textSearchQuery.toLowerCase();
    const results = [];
    
    // Find all occurrences of the search term (case insensitive)
    let index = 0;
    while ((index = text.toLowerCase().indexOf(query, index)) !== -1) {
        results.push({
            start: index,
            end: index + query.length,
            text: text.substring(index, index + query.length)
        });
        index += 1; // Move to next character to avoid infinite loop
    }

    textSearchResults = results;
    selectedSearchIndex = results.length > 0 ? 0 : -1;
    
    updateTextSearchResults();
    highlightSearchResults();
}

function updateTextSearchResults() {
    const matchCountElement = textSearchPopup?.querySelector('#textSearchMatchCount');
    if (!matchCountElement) return;

    if (textSearchResults.length === 0) {
        matchCountElement.textContent = '0';
        return;
    }

    // Show current match number and total (e.g., "2/5")
    const currentMatch = selectedSearchIndex >= 0 ? selectedSearchIndex + 1 : 0;
    matchCountElement.textContent = `${currentMatch}/${textSearchResults.length}`;
}

function navigateSearchResult(direction) {
    if (textSearchResults.length === 0) return;

    if (direction === -1) {
        // Previous
        selectedSearchIndex = selectedSearchIndex > 0 ? selectedSearchIndex - 1 : textSearchResults.length - 1;
    } else {
        // Next
        selectedSearchIndex = selectedSearchIndex < textSearchResults.length - 1 ? selectedSearchIndex + 1 : 0;
    }

    updateTextSearchResults();
    highlightSearchResults();
    scrollToHighlightedResult();
}

function highlightSearchResults() {
    if (!textSearchTarget || textSearchResults.length === 0) {
        clearSearchHighlights();
        return;
    }

    // Create or update highlight overlay
    if (!searchHighlightOverlay) {
        searchHighlightOverlay = document.createElement('div');
        searchHighlightOverlay.className = 'search-highlight-overlay';
        textSearchTarget.parentElement.appendChild(searchHighlightOverlay);
    }

    const text = textSearchTarget.value;
    
    // Build highlighted text by processing each character and inserting spans at the right positions
    let highlightedText = '';
    let currentPos = 0;
    
    // Sort results by start position to process them in order
    const sortedResults = [...textSearchResults].sort((a, b) => a.start - b.start);
    
    for (const result of sortedResults) {
        // Add text before this match
        highlightedText += text.substring(currentPos, result.start);
        
        // Add the highlighted match
        const originalIndex = textSearchResults.indexOf(result);
        const isSelected = originalIndex === selectedSearchIndex;
        const highlightClass = isSelected ? 'search-highlight-selected' : 'search-highlight';
        const matchText = text.substring(result.start, result.end);
        
        highlightedText += `<span class="${highlightClass}">${matchText}</span>`;
        
        // Update position
        currentPos = result.end;
    }
    
    // Add remaining text after the last match
    highlightedText += text.substring(currentPos);

    searchHighlightOverlay.innerHTML = highlightedText;
    searchHighlightOverlay.scrollTop = textSearchTarget.scrollTop;
    searchHighlightOverlay.scrollLeft = textSearchTarget.scrollLeft;
}

function clearSearchHighlights() {
    if (searchHighlightOverlay) {
        searchHighlightOverlay.remove();
        searchHighlightOverlay = null;
    }
}

function scrollToHighlightedResult() {
    if (selectedSearchIndex >= 0 && selectedSearchIndex < textSearchResults.length) {
        const result = textSearchResults[selectedSearchIndex];
        
        // Ensure the highlighted text is visible by scrolling
        const textBeforeSelection = textSearchTarget.value.substring(0, result.start);
        const tempSpan = document.createElement('span');
        tempSpan.style.font = window.getComputedStyle(textSearchTarget).font;
        tempSpan.style.visibility = 'hidden';
        tempSpan.style.position = 'absolute';
        tempSpan.style.whiteSpace = 'pre';
        tempSpan.textContent = textBeforeSelection;
        document.body.appendChild(tempSpan);
        
        const textWidth = tempSpan.offsetWidth;
        document.body.removeChild(tempSpan);
        
        // Scroll to make the selection visible
        const container = textSearchTarget.parentElement;
        const containerWidth = container.offsetWidth;
        const scrollLeft = textWidth - containerWidth / 2;
        
        if (scrollLeft > 0) {
            textSearchTarget.scrollLeft = scrollLeft;
        }
    }
}

function jumpToSearchResult() {
    if (selectedSearchIndex >= 0 && selectedSearchIndex < textSearchResults.length) {
        const result = textSearchResults[selectedSearchIndex];
        textSearchTarget.setSelectionRange(result.start, result.end);
        textSearchTarget.focus();
        
        // Ensure the selected text is visible
        const textBeforeSelection = textSearchTarget.value.substring(0, result.start);
        const tempSpan = document.createElement('span');
        tempSpan.style.font = window.getComputedStyle(textSearchTarget).font;
        tempSpan.style.visibility = 'hidden';
        tempSpan.style.position = 'absolute';
        tempSpan.style.whiteSpace = 'pre';
        tempSpan.textContent = textBeforeSelection;
        document.body.appendChild(tempSpan);
        
        const textWidth = tempSpan.offsetWidth;
        document.body.removeChild(tempSpan);
        
        // Scroll to make the selection visible
        const container = textSearchTarget.parentElement;
        const containerWidth = container.offsetWidth;
        const scrollLeft = textWidth - containerWidth / 2;
        
        if (scrollLeft > 0) {
            textSearchTarget.scrollLeft = scrollLeft;
        }
    }
}

function handleTextSearchKeydown(e) {
    switch (e.key) {
        case 'ArrowUp':
            e.preventDefault();
            navigateSearchResult(-1);
            break;
        case 'ArrowDown':
            e.preventDefault();
            navigateSearchResult(1);
            break;
        case 'Enter':
            e.preventDefault();
            if (selectedSearchIndex >= 0) {
                jumpToSearchResult();
                closeTextSearch();
            }
            break;
        case 'Escape':
            e.preventDefault();
            closeTextSearch();
            break;
    }
}

function closeTextSearch() {
    // Remove event listeners if they exist
    if (textSearchTarget && textSearchTarget._searchInputHandler) {
        textSearchTarget.removeEventListener('input', textSearchTarget._searchInputHandler);
        textSearchTarget._searchInputHandler = null;
    }
    if (textSearchTarget && textSearchTarget._searchKeydownHandler) {
        textSearchTarget.removeEventListener('keydown', textSearchTarget._searchKeydownHandler);
        textSearchTarget._searchKeydownHandler = null;
    }
    
    textSearchActive = false;
    textSearchTarget = null;
    textSearchQuery = '';
    textSearchResults = [];
    selectedSearchIndex = -1;
    
    clearSearchHighlights();
    
    if (textSearchPopup) {
        textSearchPopup.classList.add('hidden');
    }
    
    // Return focus to the original textarea
    if (textSearchTarget) {
        textSearchTarget.focus();
    }
}

// Expose global variables for toolbar access
Object.defineProperty(window, 'emphasisEditingValue', {
    get: () => emphasisEditingValue,
    set: (value) => { emphasisEditingValue = value; }
});

Object.defineProperty(window, 'emphasisEditingMode', {
    get: () => emphasisEditingMode,
    set: (value) => { emphasisEditingMode = value; }
});

Object.defineProperty(window, 'emphasisEditingTarget', {
    get: () => emphasisEditingTarget,
    set: (value) => { emphasisEditingTarget = value; }
});

Object.defineProperty(window, 'emphasisEditingSelection', {
    get: () => emphasisEditingSelection,
    set: (value) => { emphasisEditingSelection = value; }
});

Object.defineProperty(window, 'emphasisEditingActive', {
    get: () => emphasisEditingActive,
    set: (value) => { emphasisEditingActive = value; }
});

// Expose the direct emphasis application function
Object.defineProperty(window, 'applyEmphasisDirectly', {
    value: applyEmphasisDirectly
});

// Expose the emphasis block detection and splitting functions
Object.defineProperty(window, 'isCursorInsideEmphasisBlock', {
    value: isCursorInsideEmphasisBlock
});

Object.defineProperty(window, 'splitEmphasisBlock', {
    value: splitEmphasisBlock
});