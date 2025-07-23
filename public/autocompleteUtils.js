// Overlay and list elements
const characterAutocompleteOverlay = document.getElementById('characterAutocompleteOverlay');
let characterAutocompleteList = null;

// State variables
let characterAutocompleteTimeout = null;
let currentCharacterAutocompleteTarget = null;
let selectedCharacterAutocompleteIndex = -1;
let autocompleteNavigationMode = false;
let autocompleteExpanded = false;
let characterSearchResults = [];
let selectedEnhancerGroupIndex = -1;

// Character autocomplete functions
function handleCharacterAutocompleteInput(e) {
    // Don't trigger autocomplete if we're in navigation mode
    if (autocompleteNavigationMode) {
        autocompleteNavigationMode = false;
        return;
    }

    // Handle backspace - if actively navigating, start normal search delay
    if (e.inputType === 'deleteContentBackward') {
        // If user is actively navigating or has an item selected, start normal search
        if (autocompleteNavigationMode || selectedCharacterAutocompleteIndex >= 0) {
            // Clear existing timeout
            if (characterAutocompleteTimeout) {
                clearTimeout(characterAutocompleteTimeout);
            }

            // Set timeout to search after user stops typing (normal delay)
            characterAutocompleteTimeout = setTimeout(() => {
                if (searchText.startsWith('<') || searchText.length >= 2) {
                    searchCharacters(searchText, target);
                } else {
                    hideCharacterAutocomplete();
                }
            }, 500);
            return;
        } else {
            // Not actively navigating, hide autocomplete
            hideCharacterAutocomplete();
            return;
        }
    }

    const target = e.target;
    const value = target.value;
    const cursorPosition = target.selectionStart;

    // Get the text before the cursor
    const textBeforeCursor = value.substring(0, cursorPosition);

    // Find the last delimiter (:, |, ,) before the cursor, or start from the beginning
    const lastDelimiterIndex = Math.max(
        textBeforeCursor.lastIndexOf('{'),
        textBeforeCursor.lastIndexOf('}'),
        textBeforeCursor.lastIndexOf('['),
        textBeforeCursor.lastIndexOf(']'),
        textBeforeCursor.lastIndexOf(':'),
        textBeforeCursor.lastIndexOf('|'),
        textBeforeCursor.lastIndexOf(',')
    );
    let searchText = lastDelimiterIndex >= 0 ?
        textBeforeCursor.substring(lastDelimiterIndex + 1).trim() :
        textBeforeCursor.trim();

    // Special handling for text replacement searches starting with <
    // If the search text starts with <, we need to preserve it for the search
    if (searchText.startsWith('<')) {
        // Keep the < in the search text
        searchText = searchText;
    } else {
        // Check if there's a < character before the cursor that should be included
        const lastLessThanIndex = textBeforeCursor.lastIndexOf('<');
        if (lastLessThanIndex > lastDelimiterIndex) {
            // There's a < after the last delimiter, include it in the search
            searchText = textBeforeCursor.substring(lastLessThanIndex).trim();
        }
    }

    // Clear existing timeout
    if (characterAutocompleteTimeout) {
        clearTimeout(characterAutocompleteTimeout);
    }

    // Set timeout to search after user stops typing
    characterAutocompleteTimeout = setTimeout(() => {
        // For text replacement searches (starting with <), search immediately even with 1 character
        if (searchText.startsWith('<') || searchText.length >= 2) {
            searchCharacters(searchText, target);
        } else {
            hideCharacterAutocomplete();
        }
    }, 500);
}

function handleCharacterAutocompleteKeydown(e) {
    // Handle emphasis editing popup
    if (emphasisEditingActive) {
        switch (e.key) {
            case 'ArrowUp':
                e.preventDefault();
                emphasisEditingValue = Math.min(emphasisEditingValue + 0.1, 5.0);
                updateEmphasisEditingPopup();
                break;
            case 'ArrowDown':
                e.preventDefault();
                emphasisEditingValue = Math.max(emphasisEditingValue - 0.1, -3.0);
                updateEmphasisEditingPopup();
                break;
            case 'ArrowLeft':
                e.preventDefault();
                switchEmphasisMode('left');
                break;
            case 'ArrowRight':
                e.preventDefault();
                switchEmphasisMode('right');
                break;
            case 'Enter':
                e.preventDefault();
                applyEmphasisEditing();
                return;
            case 'Escape':
                e.preventDefault();
                cancelEmphasisEditing();
                return;
            default:
                // Any other key applies the emphasis
                applyEmphasisEditing();
                return;
        }
        return;
    }

    // Handle autocomplete navigation - only when autocomplete is visible AND we're in navigation mode
    if (characterAutocompleteOverlay && !characterAutocompleteOverlay.classList.contains('hidden')) {
        const items = characterAutocompleteList ? characterAutocompleteList.querySelectorAll('.character-autocomplete-item') : [];

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                autocompleteNavigationMode = true;
                // Expand to show all items when navigating down
                if (selectedCharacterAutocompleteIndex === -1) {
                    expandAutocompleteToShowAll();
                }
                selectedCharacterAutocompleteIndex = Math.min(selectedCharacterAutocompleteIndex + 1, items.length - 1);
                updateCharacterAutocompleteSelection();
                updateEmphasisTooltipVisibility();
                break;
            case 'ArrowUp':
                e.preventDefault();
                autocompleteNavigationMode = true;
                // If at the first item and pressing up, exit autocomplete
                if (selectedCharacterAutocompleteIndex <= 0) {
                    hideCharacterAutocomplete();
                    autocompleteNavigationMode = false;
                    return;
                }
                selectedCharacterAutocompleteIndex = Math.max(selectedCharacterAutocompleteIndex - 1, -1);
                updateCharacterAutocompleteSelection();
                updateEmphasisTooltipVisibility();
                break;
            case 'ArrowLeft':
            case 'ArrowRight':
                // Only handle left/right arrows when actively selecting items in the menu
                if (selectedCharacterAutocompleteIndex >= 0) {
                    e.preventDefault();
                    if (e.key === 'ArrowRight') {
                        // Insert the selected item
                        if (items[selectedCharacterAutocompleteIndex]) {
                            const selectedItem = items[selectedCharacterAutocompleteIndex];
                            if (selectedItem.dataset.type === 'textReplacement') {
                                // For text replacements, insert the actual text, not the placeholder
                                const placeholder = selectedItem.dataset.placeholder;
                                const actualText = textReplacements[placeholder] || placeholder;
                                insertTextReplacement(actualText);
                            } else if (selectedItem.dataset.type === 'tag') {
                                selectTag(selectedItem.dataset.tagName);
                            } else {
                                const character = JSON.parse(selectedItem.dataset.characterData);
                                selectCharacterItem(character);
                            }
                        }
                    }
                } else {
                    // When not actively selecting, allow normal text navigation
                    hideCharacterAutocomplete();
                    autocompleteNavigationMode = false;
                }
                break;
            case 'Enter':
                e.preventDefault();
                autocompleteNavigationMode = true;
                if (selectedCharacterAutocompleteIndex >= 0 && items[selectedCharacterAutocompleteIndex]) {
                    const selectedItem = items[selectedCharacterAutocompleteIndex];
                    if (selectedItem.dataset.type === 'textReplacement') {
                        selectTextReplacement(selectedItem.dataset.placeholder);
                    } else if (selectedItem.dataset.type === 'tag') {
                        selectTag(selectedItem.dataset.tagName);
                    } else {
                        const character = JSON.parse(selectedItem.dataset.characterData);
                        selectCharacterItem(character);
                    }
                }
                break;
            case 'Escape':
                e.preventDefault();
                hideCharacterAutocomplete();
                autocompleteNavigationMode = false;
                break;
            case 'e':
            case 'E':
                // Only handle 'E' key when we're in navigation mode (autocomplete is active)
                if (autocompleteNavigationMode) {
                    e.preventDefault();
                    // Start emphasis editing for current tag
                    startEmphasisEditing(currentCharacterAutocompleteTarget);
                }
                break;
            case 'Backspace':
                // When actively navigating in autocomplete, don't close it on backspace
                if (autocompleteNavigationMode || selectedCharacterAutocompleteIndex >= 0) {
                    // Allow normal backspace behavior but keep autocomplete open
                    // The input handler will handle the actual text deletion and search
                    return;
                }
                break;
        }
    }
    // Note: We don't handle any keys when autocomplete is not visible or not in navigation mode
    // This allows all keys to work normally in text input
}

async function searchCharacters(query, target) {
    try {
        // Check if query starts with < - only return text replacements in this case
        const isTextReplacementSearch = query.startsWith('<');

        let searchResults = [];

        if (!isTextReplacementSearch) {
            // Only search server if not starting with <
            const response = await fetchWithAuth(`/search/prompt?m=${manualModel.value}&q=${encodeURIComponent(query)}`);

            if (!response.ok) {
                throw new Error('Failed to search characters and tags');
            }

            searchResults = await response.json();
        }

        // Handle PICK_ prefix stripping for search but preserve in inserted text
        let searchQuery = query;
        let hasPickPrefix = false;

        if (query.startsWith('PICK_')) {
            searchQuery = query.substring(5); // Remove PICK_ prefix for searching
            hasPickPrefix = true;
        }

        // For text replacement searches, strip the < character from the search query
        if (isTextReplacementSearch) {
            searchQuery = searchQuery.substring(1); // Remove the < character
        }

        // Search through text replacements
        const textReplacementResults = Object.keys(textReplacements)
            .filter(key => {
                const keyToSearch = key.startsWith('PICK_') ? key.substring(5) : key;
                // If searchQuery is empty (just < was typed), return all items
                if (searchQuery === '') {
                    return true;
                }
                return keyToSearch.toLowerCase().includes(searchQuery.toLowerCase());
            })
            .map(key => ({
                type: 'textReplacement',
                name: key,
                description: textReplacements[key],
                placeholder: key, // The placeholder name like <NAME> or <PICK_NAME>
                // If we searched with PICK_ prefix, ensure the result preserves it
                displayName: hasPickPrefix && !key.startsWith('PICK_') ? `PICK_${key}` : key
            }));

        // Combine search results with text replacement results
        const allResults = [...searchResults, ...textReplacementResults];
        characterSearchResults = allResults;

        // Always show autocomplete, even with no results
        showCharacterAutocompleteSuggestions(allResults, target);
    } catch (error) {
        console.error('Character and tag search error:', error);
        hideCharacterAutocomplete();
    }
}

function showCharacterAutocompleteSuggestions(results, target) {
    if (!characterAutocompleteList || !characterAutocompleteOverlay) {
        console.error('Character autocomplete elements not found');
        return;
    }

    currentCharacterAutocompleteTarget = target;
    selectedCharacterAutocompleteIndex = -1;

    // Store all results for potential expansion
    window.allAutocompleteResults = results;

    // Check if we can add emphasis option
    const canAddEmphasis = checkCanAddEmphasis(target);

    // Show all results if expanded, otherwise show only first 5 items
    const displayResults = autocompleteExpanded ? results : results.slice(0, 5);

    // Populate character autocomplete list
    characterAutocompleteList.innerHTML = '';

    // If no results, show a "no results" message
    if (results.length === 0) {
        const noResultsItem = document.createElement('div');
        noResultsItem.className = 'character-autocomplete-item no-results';
        noResultsItem.innerHTML = `
            <div class="character-info-row">
                <span class="character-name">No results found</span>
                <span class="character-copyright">Try a different search term</span>
            </div>
        `;
        characterAutocompleteList.appendChild(noResultsItem);
    } else {
        // Add emphasis tooltip at the bottom if applicable
        // Note: This will be shown/hidden based on navigation mode
        if (canAddEmphasis) {
            const emphasisTooltip = document.createElement('div');
            emphasisTooltip.className = 'character-autocomplete-tooltip';
            emphasisTooltip.id = 'emphasisTooltip';
            emphasisTooltip.style.display = 'none'; // Hidden by default
            emphasisTooltip.innerHTML = `
                <span>Press E to add emphasis</span>
            `;
            characterAutocompleteList.appendChild(emphasisTooltip);
        }

        displayResults.forEach((result, index) => {
            const item = document.createElement('div');
            item.className = 'character-autocomplete-item';

            if (result.type === 'textReplacement') {
                // Handle text replacement results
                item.dataset.type = 'textReplacement';
                item.dataset.placeholder = result.placeholder;

                // Use displayName if available, otherwise use placeholder
                const displayName = result.displayName || result.placeholder;

                item.innerHTML = `
                    <div class="character-info-row">
                        <span class="character-name">${displayName}</span>
                        <span class="character-copyright">Text Replacement</span>
                    </div>
                    <div class="character-info-row">
                        <div class="placeholder-desc"><span class="placeholder-desc-text">${result.description}</span></div>
                    </div>
                `;

                item.addEventListener('click', () => selectTextReplacement(result.placeholder));
            } else if (result.type === 'tag') {
                // Handle tag results
                item.dataset.type = 'tag';
                item.dataset.tagName = result.name;
                item.dataset.modelType = result.model.toLowerCase().includes('furry') ? 'furry' : 'anime';

                item.innerHTML = `
                    <div class="character-info-row">
                        <span class="character-name">${result.name}</span>
                        <span class="character-copyright">${modelKeys[result.model.toLowerCase()]?.type || 'NovelAI'}${modelKeys[result.model.toLowerCase()]?.version ? ' <span class="badge">' + modelKeys[result.model.toLowerCase()]?.version + '</span>' : ''}</span>
                    </div>
                `;

                item.addEventListener('click', () => selectTag(result.name));
            } else {
                // Handle character results
                item.dataset.type = 'character';
                item.dataset.characterData = JSON.stringify(result.character);

                // Parse name and copyright from character data
                const character = result.character;
                const name = character.name || result.name;
                const copyright = character.copyright || '';

                item.innerHTML = `
                    <div class="character-info-row">
                        <span class="character-name">${name}</span>
                        <span class="character-copyright">${copyright}</span>
                    </div>
                `;

                item.addEventListener('click', () => selectCharacterItem(result.character));
            }

            characterAutocompleteList.appendChild(item);
        });

        // Add "show more" indicator if there are more results and not expanded
        if (results.length > 5 && !autocompleteExpanded) {
            const moreItem = document.createElement('div');
            moreItem.className = 'character-autocomplete-item more-indicator';
            moreItem.innerHTML = `
                <div class="character-info-row">
                    <span class="character-name">Press ↓ to show all ${results.length} results</span>
                </div>
            `;
            characterAutocompleteList.appendChild(moreItem);
        }
    }

    // Position overlay relative to viewport
    const rect = target.getBoundingClientRect();
    characterAutocompleteOverlay.style.left = rect.left + 'px';
    characterAutocompleteOverlay.style.top = (rect.bottom + 5) + 'px';
    characterAutocompleteOverlay.style.width = rect.width + 'px';

    characterAutocompleteOverlay.classList.remove('hidden');

    // Auto-select first item if there are results and user is in navigation mode
    if (results.length > 0 && (autocompleteNavigationMode || selectedCharacterAutocompleteIndex >= 0)) {
        selectedCharacterAutocompleteIndex = 0;
        updateCharacterAutocompleteSelection();
    }
}

function updateCharacterAutocompleteSelection() {
    if (!characterAutocompleteList) return;

    const items = characterAutocompleteList.querySelectorAll('.character-autocomplete-item');
    items.forEach((item, index) => {
        item.classList.toggle('selected', index === selectedCharacterAutocompleteIndex);
    });

    // Scroll the selected item into view
    if (selectedCharacterAutocompleteIndex >= 0 && items[selectedCharacterAutocompleteIndex]) {
        const selectedItem = items[selectedCharacterAutocompleteIndex];
        selectedItem.scrollIntoView({
            block: 'nearest',
            behavior: 'smooth'
        });
    }
}

function selectCharacterItem(character) {
    try {
        showCharacterDetail(character);
    } catch (error) {
        console.error('Error displaying character data:', error);
        showError('Failed to display character data');
    }
}

function selectTextReplacement(placeholder) {
    if (!currentCharacterAutocompleteTarget) return;

    const target = currentCharacterAutocompleteTarget;
    const currentValue = target.value;
    const cursorPosition = target.selectionStart;

    // Get the text before the cursor
    const textBeforeCursor = currentValue.substring(0, cursorPosition);

    // Find the last delimiter (:, |, ,) before the cursor, or start from the beginning
    const lastDelimiterIndex = Math.max(
        textBeforeCursor.lastIndexOf('{'),
        textBeforeCursor.lastIndexOf('}'),
        textBeforeCursor.lastIndexOf('['),
        textBeforeCursor.lastIndexOf(']'),
        textBeforeCursor.lastIndexOf(':'),
        textBeforeCursor.lastIndexOf('|'),
        textBeforeCursor.lastIndexOf(',')
    );
    const startOfCurrentTerm = lastDelimiterIndex >= 0 ? lastDelimiterIndex + 1 : 0;

    // Get the text after the cursor
    const textAfterCursor = currentValue.substring(cursorPosition);

    // Build the new prompt
    let newPrompt = '';

    // Keep the text before the current term (trim any trailing delimiters and spaces)
    const textBefore = currentValue.substring(0, startOfCurrentTerm).replace(/[,\s]*$/, '');
    newPrompt = textBefore;

    // Add the placeholder wrapped in angle brackets
    const wrappedPlaceholder = `<${placeholder}>`;
    if (newPrompt) {
        // Check if the text before ends with : or | - don't add comma in those cases
        if (textBefore.endsWith(':')) {
            newPrompt += wrappedPlaceholder;
        } else if (textBefore.endsWith('|')) {
            newPrompt += ' ' + wrappedPlaceholder;
        } else {
            newPrompt += ', ' + wrappedPlaceholder;
        }
    } else {
        newPrompt = wrappedPlaceholder;
    }

    // Add the text after the cursor (trim any leading delimiters and spaces)
    const textAfter = textAfterCursor.replace(/^[,\s]*/, '');
    if (textAfter) {
        newPrompt += ', ' + textAfter;
    }

    // Update the target field
    target.value = newPrompt;

    // Set cursor position after the inserted placeholder
    const newCursorPosition = newPrompt.length - textAfter.length;
    target.setSelectionRange(newCursorPosition, newCursorPosition);

    // Hide character autocomplete
    hideCharacterAutocomplete();

    // Focus back on the target field
    if (target) {
        target.focus();
        autoResizeTextarea(target);
        updateEmphasisHighlighting(target);
    }
}

function insertTextReplacement(actualText) {
    if (!currentCharacterAutocompleteTarget) return;

    const target = currentCharacterAutocompleteTarget;
    const currentValue = target.value;
    const cursorPosition = target.selectionStart;

    // Get the text before the cursor
    const textBeforeCursor = currentValue.substring(0, cursorPosition);

    // Find the last delimiter (:, |, ,) before the cursor, or start from the beginning
    const lastDelimiterIndex = Math.max(
        textBeforeCursor.lastIndexOf('{'),
        textBeforeCursor.lastIndexOf('}'),
        textBeforeCursor.lastIndexOf('['),
        textBeforeCursor.lastIndexOf(']'),
        textBeforeCursor.lastIndexOf(':'),
        textBeforeCursor.lastIndexOf('|'),
        textBeforeCursor.lastIndexOf(',')
    );
    const startOfCurrentTerm = lastDelimiterIndex >= 0 ? lastDelimiterIndex + 1 : 0;

    // Get the text after the cursor
    const textAfterCursor = currentValue.substring(cursorPosition);

    // Build the new prompt
    let newPrompt = '';

    // Keep the text before the current term (trim any trailing delimiters and spaces)
    const textBefore = currentValue.substring(0, startOfCurrentTerm).replace(/[,\s]*$/, '');
    newPrompt = textBefore;

    // Add the actual text (not wrapped in angle brackets)
    if (newPrompt) {
        // Check if the text before ends with : or | - don't add comma in those cases
        if (textBefore.endsWith(':')) {
            newPrompt += actualText;
        } else if (textBefore.endsWith('|')) {
            newPrompt += ' ' + actualText;
        } else {
            newPrompt += ', ' + actualText;
        }
    } else {
        newPrompt = actualText;
    }

    // Add the text after the cursor (trim any leading delimiters and spaces)
    const textAfter = textAfterCursor.replace(/^[,\s]*/, '');
    if (textAfter) {
        newPrompt += ', ' + textAfter;
    }

    // Update the target field
    target.value = newPrompt;

    // Set cursor position after the inserted text
    const newCursorPosition = newPrompt.length - textAfter.length;
    target.setSelectionRange(newCursorPosition, newCursorPosition);

    // Hide character autocomplete
    hideCharacterAutocomplete();

    // Focus back on the target field
    if (target) {
        target.focus();
        autoResizeTextarea(target);
        updateEmphasisHighlighting(target);
    }
}

function selectTag(tagName) {
    if (!currentCharacterAutocompleteTarget) return;

    const target = currentCharacterAutocompleteTarget;
    const currentValue = target.value;
    const cursorPosition = target.selectionStart;

    // Get the text before the cursor
    const textBeforeCursor = currentValue.substring(0, cursorPosition);

    // Find the last delimiter (:, |, ,) before the cursor, or start from the beginning
    const lastDelimiterIndex = Math.max(
        textBeforeCursor.lastIndexOf('{'),
        textBeforeCursor.lastIndexOf('}'),
        textBeforeCursor.lastIndexOf('['),
        textBeforeCursor.lastIndexOf(']'),
        textBeforeCursor.lastIndexOf(':'),
        textBeforeCursor.lastIndexOf('|'),
        textBeforeCursor.lastIndexOf(',')
    );
    const startOfCurrentTerm = lastDelimiterIndex >= 0 ? lastDelimiterIndex + 1 : 0;

    // Get the text after the cursor
    const textAfterCursor = currentValue.substring(cursorPosition);

    // Build the new prompt
    let newPrompt = '';

    // Keep the text before the current term (trim any trailing delimiters and spaces)
    const textBefore = currentValue.substring(0, startOfCurrentTerm).replace(/[,\s]*$/, '');
    newPrompt = textBefore;

    // Add the tag name
    if (newPrompt) {
        // Check if the text before ends with : or | - don't add comma in those cases
        if (textBefore.endsWith(':')) {
            newPrompt += tagName;
        } else if (textBefore.endsWith('|')) {
            newPrompt += ' ' + tagName;
        } else {
            newPrompt += ', ' + tagName;
        }
    } else {
        newPrompt = tagName;
    }

    // Add the text after the cursor (trim any leading delimiters and spaces)
    const textAfter = textAfterCursor.replace(/^[,\s]*/, '');
    if (textAfter) {
        newPrompt += ', ' + textAfter;
    }

    // Update the target field
    target.value = newPrompt;

    // Set cursor position after the inserted tag
    const newCursorPosition = newPrompt.length - textAfter.length;
    target.setSelectionRange(newCursorPosition, newCursorPosition);

    // Hide character autocomplete
    hideCharacterAutocomplete();

    // Focus back on the target field
    if (target) {
        target.focus();
        autoResizeTextarea(target);
        updateEmphasisHighlighting(target);
    }
}

function selectTextReplacementFullText(placeholder) {
    if (!currentCharacterAutocompleteTarget) return;

    const target = currentCharacterAutocompleteTarget;
    const currentValue = target.value;
    const cursorPosition = target.selectionStart;

    // Get the text before the cursor
    const textBeforeCursor = currentValue.substring(0, cursorPosition);

    // Find the last delimiter (:, |, ,) before the cursor, or start from the beginning
    const lastDelimiterIndex = Math.max(
        textBeforeCursor.lastIndexOf('{'),
        textBeforeCursor.lastIndexOf('}'),
        textBeforeCursor.lastIndexOf('['),
        textBeforeCursor.lastIndexOf(']'),
        textBeforeCursor.lastIndexOf(':'),
        textBeforeCursor.lastIndexOf('|'),
        textBeforeCursor.lastIndexOf(',')
    );
    const startOfCurrentTerm = lastDelimiterIndex >= 0 ? lastDelimiterIndex + 1 : 0;

    // Get the text after the cursor
    const textAfterCursor = currentValue.substring(cursorPosition);

    // Build the new prompt
    let newPrompt = '';

    // Keep the text before the current term (trim any trailing delimiters and spaces)
    const textBefore = currentValue.substring(0, startOfCurrentTerm).replace(/[,\s]*$/, '');
    newPrompt = textBefore;

    // Add the full text replacement description
    const fullText = textReplacements[placeholder];
    if (newPrompt) {
        // Check if the text before ends with : or | - don't add comma in those cases
        if (textBefore.endsWith(':')) {
            newPrompt += fullText;
        } else if (textBefore.endsWith('|')) {
            newPrompt += ' ' + fullText;
        } else {
            newPrompt += ', ' + fullText;
        }
    } else {
        newPrompt = fullText;
    }

    // Add the text after the cursor (trim any leading delimiters and spaces)
    const textAfter = textAfterCursor.replace(/^[,\s]*/, '');
    if (textAfter) {
        newPrompt += ', ' + textAfter;
    }

    // Update the target field
    target.value = newPrompt;

    // Set cursor position after the inserted text
    const newCursorPosition = newPrompt.length - textAfter.length;
    target.setSelectionRange(newCursorPosition, newCursorPosition);

    // Hide character autocomplete
    hideCharacterAutocomplete();

    // Focus back on the target field
    if (target) {
        target.focus();
        autoResizeTextarea(target);
        updateEmphasisHighlighting(target);
    }
}

function selectCharacterWithoutEnhancers(character) {
    try {
        if (!currentCharacterAutocompleteTarget) return;

        const target = currentCharacterAutocompleteTarget;
        const currentValue = target.value;
        const cursorPosition = target.selectionStart;

        // Get the text before the cursor
        const textBeforeCursor = currentValue.substring(0, cursorPosition);

        // Find the last delimiter (:, |, ,) before the cursor, or start from the beginning
        const lastDelimiterIndex = Math.max(
            textBeforeCursor.lastIndexOf('{'),
            textBeforeCursor.lastIndexOf('}'),
            textBeforeCursor.lastIndexOf('['),
            textBeforeCursor.lastIndexOf(']'),
            textBeforeCursor.lastIndexOf(':'),
            textBeforeCursor.lastIndexOf('|'),
            textBeforeCursor.lastIndexOf(',')
        );
        const startOfCurrentTerm = lastDelimiterIndex >= 0 ? lastDelimiterIndex + 1 : 0;

        // Get the text after the cursor
        const textAfterCursor = currentValue.substring(cursorPosition);

        // Build the new prompt
        let newPrompt = '';

        // Keep the text before the current term (trim any trailing delimiters and spaces)
        const textBefore = currentValue.substring(0, startOfCurrentTerm).replace(/[,\s]*$/, '');
        newPrompt = textBefore;

        // Add just the character prompt without any enhancers
        if (character.prompt) {
            if (newPrompt) {
                // Check if the text before ends with : or | - don't add comma in those cases
                if (textBefore.endsWith(':')) {
                    newPrompt += character.prompt;
                } else if (textBefore.endsWith('|')) {
                    newPrompt += ' ' + character.prompt;
                } else {
                    newPrompt += ', ' + character.prompt;
                }
            } else {
                newPrompt = character.prompt;
            }
        }

        // Add the text after the cursor (trim any leading delimiters and spaces)
        const textAfter = textAfterCursor.replace(/^[,\s]*/, '');
        if (textAfter) {
            if (newPrompt) {
                newPrompt += ', ' + textAfter;
            } else {
                newPrompt = textAfter;
            }
        }

        // Update the target field
        target.value = newPrompt;

        // Set cursor position after the inserted text
        const newCursorPosition = newPrompt.length - textAfter.length;
        target.setSelectionRange(newCursorPosition, newCursorPosition);

        // Hide character autocomplete
        hideCharacterAutocomplete();

        // Focus back on the target field
        if (target) {
            target.focus();
            autoResizeTextarea(target);
            updateEmphasisHighlighting(target);
        }
    } catch (error) {
        console.error('Error loading character data:', error);
        showError('Failed to load character data');
    }
}

function showCharacterDetail(character) {
    try {
        // Reset selected enhancer group index
        selectedEnhancerGroupIndex = -1;

        // Instead of using a separate overlay, replace the content inside the existing autocomplete overlay
        const autocompleteList = document.querySelector('.character-autocomplete-list');

        if (!autocompleteList) {
            console.error('Character autocomplete list not found');
            return;
        }

        // Create enhancers HTML
        let enhancersHTML = '';

        // Add "None" option first
        enhancersHTML += `
            <div class="enhancer-group" 
                 data-enhancer-group="null" 
                 data-character='${JSON.stringify(character)}'
                 onclick="selectEnhancerGroupFromDetail(null, ${JSON.stringify(character).replace(/"/g, '&quot;')})">
                <div class="enhancer-group-header">
                    <span class="enhancer-group-name">None</span>
                    <span class="enhancer-group-count">0</span>
                </div>
            </div>
        `;

        // Ensure character.enhancers exists and is an array
        if (character.enhancers && Array.isArray(character.enhancers)) {
            // Add enhancer groups
            character.enhancers.forEach((enhancerGroup, groupIndex) => {
                // Handle mixed structure: convert strings to single-item arrays
                let processedGroup;
                if (typeof enhancerGroup === 'string') {
                    // Convert string to single-item array
                    processedGroup = [enhancerGroup];
                } else if (Array.isArray(enhancerGroup)) {
                    // Already an array, use as-is
                    processedGroup = enhancerGroup;
                } else {
                    console.warn(`Enhancer group ${groupIndex} is neither string nor array:`, enhancerGroup);
                    return; // Skip this group
                }

                enhancersHTML += `
                    <div class="enhancer-group" 
                         data-enhancer-group='${JSON.stringify(processedGroup)}'
                         data-character='${JSON.stringify(character)}'
                         onclick="selectEnhancerGroupFromDetail(${JSON.stringify(processedGroup).replace(/"/g, '&quot;')}, ${JSON.stringify(character).replace(/"/g, '&quot;')})">
                        <div class="enhancer-group-header">
                            <span class="enhancer-group-name">Group ${groupIndex + 1}</span>
                            <span class="enhancer-group-count">${processedGroup.length}</span>
                        </div>
                        <div class="enhancer-items">
                            ${processedGroup.map(item => {
                                // Ensure item is a string
                                if (typeof item !== 'string') {
                                    console.warn(`Enhancer item is not a string:`, item);
                                    return '';
                                }
                                const isNegative = item.startsWith('--');
                                const displayItem = isNegative ? item.substring(2) : item;
                                return `<span class="enhancer-item ${isNegative ? 'negative' : ''}">${displayItem}</span>`;
                            }).join('')}
                        </div>
                    </div>
                `;
            });
        } else {
            enhancersHTML += '<div class="no-enhancers">No enhancers available</div>';
        }

        // Replace the autocomplete content with character detail
        autocompleteList.innerHTML = `
            <div class="character-detail-content">
                <div class="character-detail-header">
                    <div class="character-name-copyright">
                        <span class="character-name">${character.name || 'Unknown Character'}</span>
                        <span class="character-copyright">${character.copyright || ''}</span>
                    </div>
                    <button class="close-character-detail" onclick="hideCharacterDetail()">&times;</button>
                </div>
                <div class="character-detail-body">
                    <div class="character-prompt">
                        <strong>Prompt:</strong> <span>${character.prompt || 'No prompt available'}</span>
                    </div>
                    <div class="character-enhancers">
                        <strong>Enhancers:</strong>
                        <div class="enhancers-list">
                            ${enhancersHTML}
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Ensure the autocomplete overlay maintains its width
        if (characterAutocompleteOverlay) {
            characterAutocompleteOverlay.style.width = characterAutocompleteOverlay.style.width || '400px';
        }

        // The autocomplete overlay is already visible, so no need to show/hide anything
    } catch (error) {
        console.error('Error showing character detail:', error);
        console.error('Character that caused error:', character);
        showError('Failed to display character details');
    }
}

function selectEnhancerGroup(enhancerGroup, character) {
    if (!currentCharacterAutocompleteTarget) return;

    const target = currentCharacterAutocompleteTarget;

    // Update the target field with character prompt
    if (character.prompt) {
        target.value = character.prompt;
    }

    // Add enhancer items to the prompt if selected
    if (enhancerGroup && Array.isArray(enhancerGroup) && enhancerGroup.length > 0) {
        const currentPrompt = target.value;
        const enhancerText = enhancerGroup.join(', ');
        target.value = currentPrompt + ', ' + enhancerText;
    }

    // Hide character detail overlay and autocomplete
    hideCharacterDetail();
    hideCharacterAutocomplete();

    // Focus back on the target field
    if (target) {
        target.focus();
        updateEmphasisHighlighting(target);
    }
}

function selectEnhancerGroupFromDetail(enhancerGroup, character) {
    if (!currentCharacterAutocompleteTarget) return;

    const target = currentCharacterAutocompleteTarget;
    const currentValue = target.value;
    const cursorPosition = target.selectionStart;

    // Get the text before the cursor
    const textBeforeCursor = currentValue.substring(0, cursorPosition);

    // Find the last comma before the cursor, or start from the beginning
    const lastCommaIndex = textBeforeCursor.lastIndexOf(',');
    const startOfCurrentTerm = lastCommaIndex >= 0 ? lastCommaIndex + 1 : 0;

    // Get the text after the cursor
    const textAfterCursor = currentValue.substring(cursorPosition);

    // Build the new prompt
    let newPrompt = '';

    // Keep the text before the current term (trim any trailing commas and spaces)
    const textBefore = currentValue.substring(0, startOfCurrentTerm).replace(/[,\s]*$/, '');
    newPrompt = textBefore;

    // Add character prompt if this is the first item or we're at the beginning
    if (character.prompt) {
        if (startOfCurrentTerm === 0) {
            // This is the first item, use the character prompt
            newPrompt = character.prompt;
        } else {
            // Add character prompt after existing text
            if (newPrompt) {
                newPrompt += ', ' + character.prompt;
            } else {
                newPrompt = character.prompt;
            }
        }
    }

    // Add enhancer items if selected
    if (enhancerGroup && Array.isArray(enhancerGroup) && enhancerGroup.length > 0) {
        const enhancerText = enhancerGroup.join(', ');
        if (newPrompt) {
            newPrompt += ', ' + enhancerText;
        } else {
            newPrompt = enhancerText;
        }
    }

    // Add the text after the cursor (trim any leading commas and spaces)
    const textAfter = textAfterCursor.replace(/^[,\s]*/, '');
    if (textAfter) {
        if (newPrompt) {
            newPrompt += ', ' + textAfter;
        } else {
            newPrompt = textAfter;
        }
    }

    // Update the target field
    target.value = newPrompt;

    // Set cursor position after the inserted text
    const newCursorPosition = newPrompt.length - textAfter.length;
    target.setSelectionRange(newCursorPosition, newCursorPosition);

    // Hide character autocomplete (which now contains the detail view)
    hideCharacterAutocomplete();

    // Focus back on the target field
    if (target) {
        target.focus();
        autoResizeTextarea(target);
        updateEmphasisHighlighting(target);
    }
}

function applyFormattedText(textarea, lostFocus) {
    // Store cursor position if textarea is in focus
    const cursorPosition = !lostFocus ? textarea.selectionStart : -1;

    let text = textarea.value;

    // Process text based on focus state
    if (lostFocus) {
        // When losing focus, clean up the text
        text = text
            .split('\n').map(item => item.trim()).join(' ')
            .split(',').map(item => item.trim()).join(', ')
            .split('|').map(item => item.trim()).filter(Boolean).join(' | ');

        // Remove leading | or , and trim start
        text = text.replace(/^(\||,)+\s*/, '');
    } else {
        // When focused, just clean up basic formatting
        text = text
            .split('\n').map(item => item.trim()).join(' ')
            .split(',').map(item => item.trim()).join(', ')
            .split('|').map(item => item.trim()).join(' | ');
    }

    // Fix curly brace groups: ensure each group has equal number of { and }
    // Only process if there is a "}," to terminate it
    if (text.includes('},')) {
        text = text.replace(/(\{+)([^{}]*)(\}*)/g, (match, openBraces, content, closeBraces, offset, str) => {
            const after = str.slice(offset + match.length, offset + match.length + 1);
            if (closeBraces.length > 0 && after === ',') {
                const openCount = openBraces.length;
                return openBraces + content + '}'.repeat(openCount);
            }
            return match;
        });
    }

    // Fix square bracket groups: ensure each group has equal number of [ and ]
    // Only process if there is "]," to terminate it
    if (text.includes('],')) {
        text = text.replace(/(\[+)([^\[\]]*)(\]*)/g, (match, openBrackets, content, closeBrackets, offset, str) => {
            const after = str.slice(offset + match.length, offset + match.length + 1);
            if (closeBrackets.length > 0 && after === ',') {
                const openCount = openBrackets.length;
                return openBrackets + content + ']'.repeat(openCount);
            }
            return match;
        });
    }

    // If not focused, remove empty tags (consecutive commas with only spaces between)
    if (lostFocus) {
        // Remove any sequence of commas (with any amount of spaces between) that does not have text between them
        // e.g. ",   ,", ", ,", ",,"
        text = text.replace(/(?:^|,)\s*(?=,|$)/g, ''); // Remove empty segments
        // Remove any leading or trailing commas left after cleanup
        text = text.replace(/^,|,$/g, '');
        // Remove extra spaces after cleanup
        text = text.replace(/,\s+/g, ', ');
        text = text.replace(/\s+,/g, ',');
    }

    textarea.value = text;

    // Restore cursor position if textarea was in focus
    if (!lostFocus && cursorPosition >= 0) {
        // Ensure cursor position doesn't exceed the new text length
        const newPosition = Math.min(cursorPosition, text.length);
        textarea.setSelectionRange(newPosition, newPosition);
        textarea.focus();
    }
}

function handleCharacterDetailArrowKeys(key) {
    const enhancerGroups = document.querySelectorAll('.character-detail-content .enhancer-group');
    if (enhancerGroups.length === 0) return;

    // Remove previous selection
    enhancerGroups.forEach(group => group.classList.remove('selected'));

    if (key === 'ArrowUp') {
        selectedEnhancerGroupIndex = selectedEnhancerGroupIndex <= 0 ? enhancerGroups.length - 1 : selectedEnhancerGroupIndex - 1;
    } else if (key === 'ArrowDown') {
        selectedEnhancerGroupIndex = selectedEnhancerGroupIndex >= enhancerGroups.length - 1 ? 0 : selectedEnhancerGroupIndex + 1;
    }

    // Add selection to current item
    if (selectedEnhancerGroupIndex >= 0 && selectedEnhancerGroupIndex < enhancerGroups.length) {
        enhancerGroups[selectedEnhancerGroupIndex].classList.add('selected');

        // Scroll the selected item into view
        enhancerGroups[selectedEnhancerGroupIndex].scrollIntoView({
            behavior: 'smooth',
            block: 'nearest'
        });
    }
}

function handleCharacterDetailEnter() {
    const enhancerGroups = document.querySelectorAll('.character-detail-content .enhancer-group');
    if (selectedEnhancerGroupIndex >= 0 && selectedEnhancerGroupIndex < enhancerGroups.length) {
        const selectedGroup = enhancerGroups[selectedEnhancerGroupIndex];

        // Get the data from data attributes (much more reliable than parsing onclick)
        const enhancerGroupData = selectedGroup.getAttribute('data-enhancer-group');
        const characterData = selectedGroup.getAttribute('data-character');

        if (enhancerGroupData && characterData) {
            try {
                // Parse the data attributes
                const enhancerGroup = enhancerGroupData === 'null' ? null : JSON.parse(enhancerGroupData);
                const character = JSON.parse(characterData);

                selectEnhancerGroupFromDetail(enhancerGroup, character);
            } catch (error) {
                console.error('Error parsing data attributes:', error);
                console.error('enhancerGroupData:', enhancerGroupData);
                console.error('characterData:', characterData);

                // Fallback: try to trigger the click event instead
                selectedGroup.click();
            }
        } else {
            // Fallback: try to trigger the click event instead
            selectedGroup.click();
        }
    }
}

function hideCharacterAutocomplete() {
    if (characterAutocompleteOverlay) {
        characterAutocompleteOverlay.classList.add('hidden');
    }
    currentCharacterAutocompleteTarget = null;
    selectedCharacterAutocompleteIndex = -1;
    characterSearchResults = [];
    autocompleteNavigationMode = false;
    autocompleteExpanded = false;
    updateEmphasisTooltipVisibility();
}

function hideCharacterDetail() {
    // Since we're now replacing the content inside the autocomplete overlay,
    // we need to restore the original autocomplete list content
    const autocompleteList = document.querySelector('.character-autocomplete-list');

    if (autocompleteList && characterSearchResults.length > 0) {
        // Restore the original autocomplete suggestions
        showCharacterAutocompleteSuggestions(characterSearchResults, currentCharacterAutocompleteTarget);
    } else {
        // If no search results, just hide the overlay
        hideCharacterAutocomplete();
    }
}

function updateAutocompletePositions() {
    // Update character autocomplete position
    if (characterAutocompleteOverlay && !characterAutocompleteOverlay.classList.contains('hidden') && currentCharacterAutocompleteTarget) {
        const rect = currentCharacterAutocompleteTarget.getBoundingClientRect();
        characterAutocompleteOverlay.style.left = rect.left + 'px';
        characterAutocompleteOverlay.style.top = (rect.bottom + 5) + 'px';
        characterAutocompleteOverlay.style.width = rect.width + 'px';
    }

    // Update preset autocomplete position
    if (presetAutocompleteOverlay && !presetAutocompleteOverlay.classList.contains('hidden') && currentPresetAutocompleteTarget) {
        const rect = currentPresetAutocompleteTarget.getBoundingClientRect();
        const overlayHeight = Math.min(400, window.innerHeight * 0.5);
        const spaceAbove = rect.top;
        const spaceBelow = window.innerHeight - rect.bottom;

        presetAutocompleteOverlay.style.left = rect.left + 'px';
        presetAutocompleteOverlay.style.width = rect.width + 'px';

        // Check if there's enough space above, otherwise show below
        if (spaceAbove >= overlayHeight) {
            // Position above
            presetAutocompleteOverlay.style.top = (rect.top - 5) + 'px';
            presetAutocompleteOverlay.style.transform = 'translateY(-100%)';
            presetAutocompleteOverlay.style.maxHeight = overlayHeight + 'px';
        } else {
            // Position below if not enough space above
            presetAutocompleteOverlay.style.top = (rect.bottom + 5) + 'px';
            presetAutocompleteOverlay.style.transform = 'none';
            presetAutocompleteOverlay.style.maxHeight = Math.min(spaceBelow - 10, overlayHeight) + 'px';
        }
    }
}

function selectPresetItem(presetName) {
    if (!currentPresetAutocompleteTarget) return;

    const target = currentPresetAutocompleteTarget;
    target.value = presetName;

    // Hide preset autocomplete
    hidePresetAutocomplete();

    // Focus back on the target field
    if (target) {
        target.focus();
    }
}

function hidePresetAutocomplete() {
    if (presetAutocompleteOverlay) {
        presetAutocompleteOverlay.classList.add('hidden');
    }
    currentPresetAutocompleteTarget = null;
    selectedPresetAutocompleteIndex = -1;
    presetSearchResults = [];
}

function expandAutocompleteToShowAll() {
    if (!window.allAutocompleteResults || !characterAutocompleteList) return;

    autocompleteExpanded = true;

    // Clear current list
    characterAutocompleteList.innerHTML = '';

    // Add all results
    window.allAutocompleteResults.forEach((result, index) => {
        const item = document.createElement('div');
        item.className = 'character-autocomplete-item';

        if (result.type === 'textReplacement') {
            item.dataset.type = 'textReplacement';
            item.dataset.placeholder = result.placeholder;

            // Use displayName if available, otherwise use placeholder
            const displayName = result.displayName || result.placeholder;

            item.innerHTML = `
                <div class="character-info-row">
                    <span class="character-name">${displayName}</span>
                    <span class="character-copyright">Text Replacement</span>
                </div>
                <div class="character-info-row">
                    <div class="placeholder-desc"><span class="placeholder-desc-text">${result.description}</span></div>
                </div>
            `;

            item.addEventListener('click', () => selectTextReplacement(result.placeholder));
        } else if (result.type === 'tag') {
            item.dataset.type = 'tag';
            item.dataset.tagName = result.name;
            item.dataset.modelType = result.model.toLowerCase().includes('furry') ? 'furry' : 'anime';

            item.innerHTML = `
                <div class="character-info-row">
                    <span class="character-name">${result.name}</span>
                    <span class="character-copyright">${modelKeys[result.model.toLowerCase()]?.type || 'NovelAI'}${modelKeys[result.model.toLowerCase()]?.version ? ' <span class="badge">' + modelKeys[result.model.toLowerCase()]?.version + '</span>' : ''}</span>
                </div>
            `;

            item.addEventListener('click', () => selectTag(result.name));
        } else {
            item.dataset.type = 'character';
            item.dataset.characterData = JSON.stringify(result.character);

            const character = result.character;
            const name = character.name || result.name;
            const copyright = character.copyright || '';

            item.innerHTML = `
                <div class="character-info-row">
                    <span class="character-name">${name}</span>
                    <span class="character-copyright">${copyright}</span>
                </div>
            `;

            item.addEventListener('click', () => selectCharacterItem(result.character));
        }

        characterAutocompleteList.appendChild(item);
    });

    // Maintain selection after expanding
    if (selectedCharacterAutocompleteIndex >= 0) {
        updateCharacterAutocompleteSelection();
    }
}

