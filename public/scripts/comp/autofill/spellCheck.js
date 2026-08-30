// JULES: split from autocompleteUtils.js for #22

// Spell check navigation state
let spellCheckNavigationMode = false;
let selectedSpellCheckWordIndex = -1;
let selectedSpellCheckSuggestionIndex = -1;
let persistentSpellCheckData = null; // Current spell check data

function getSpellCheckInputSlice(spellMeta, value, spellOffset) {
    if (!spellMeta || !value) return null;
    const inputStart = spellMeta.inputStart != null ? spellMeta.inputStart : spellOffset;
    let inputEnd = spellMeta.inputEnd;
    if (inputEnd == null && spellMeta.originalText) {
        inputEnd = inputStart + spellMeta.originalText.length;
    }
    if (inputEnd == null || inputStart < 0 || inputEnd > value.length || inputStart >= inputEnd) {
        return null;
    }
    return {
        start: inputStart,
        end: inputEnd,
        text: value.substring(inputStart, inputEnd)
    };
}

function resolveSpellCheckTermBounds(target, spellMeta, liveBounds) {
    const cursorPos = typeof target.selectionStart === 'number' ? target.selectionStart : 0;
    if (spellMeta && spellMeta.termStart != null && spellMeta.termEnd != null) {
        const termStart = spellMeta.termStart;
        const termEnd = Math.max(spellMeta.termEnd, termStart);
        if (cursorPos >= termStart && cursorPos <= termEnd) {
            return {
                termStart: termStart,
                termEnd: termEnd,
                spellOffset: spellMeta.spellCheckTermOffset != null ? spellMeta.spellCheckTermOffset : termStart
            };
        }
    }
    if (liveBounds) {
        return {
            termStart: liveBounds.tokenStart,
            termEnd: liveBounds.tokenEnd,
            spellOffset: liveBounds.spellCheckTermOffset != null ? liveBounds.spellCheckTermOffset : liveBounds.tokenStart
        };
    }
    return {
        termStart: 0,
        termEnd: target && target.value ? target.value.length : 0,
        spellOffset: 0
    };
}

function isSpellCheckMetaAligned(spellMeta, value, spellOffset) {
    const slice = getSpellCheckInputSlice(spellMeta, value, spellOffset);
    if (!slice) return false;
    const original = spellMeta && spellMeta.originalText;
    if (typeof original === 'string') {
        return slice.text === original;
    }
    return typeof spellMeta.inputText === 'string' && slice.text === spellMeta.inputText;
}

function findSpellCheckWordReplaceRange(value, cursorPos, originalWord, termStart, termEnd, spellOffset, spellMeta, misspelledRowIndex) {
    if (!originalWord || termStart == null || termEnd == null) {
        return null;
    }

    const origLower = originalWord.toLowerCase();
    const occIndex = getMisspelledWordOccurrenceIndex(spellMeta, originalWord, misspelledRowIndex);

    const inputSlice = getSpellCheckInputSlice(spellMeta, value, spellOffset);
    if (!inputSlice) {
        return null;
    }

    if (spellMeta && Array.isArray(spellMeta.wordPositions) && isSpellCheckMetaAligned(spellMeta, value, spellOffset)) {
        const matching = spellMeta.wordPositions.filter(function (wp) {
            return wp && wp.word && wp.word.toLowerCase() === origLower;
        });
        if (occIndex >= 0 && occIndex < matching.length) {
            const wp = matching[occIndex];
            const start = spellOffset + wp.start;
            const end = spellOffset + wp.end;
            if (start >= inputSlice.start && end <= inputSlice.end && start < end) {
                return { start: start, end: end };
            }
        }
        const candidates = matching.map(function (wp) {
            return {
                start: spellOffset + wp.start,
                end: spellOffset + wp.end
            };
        }).filter(function (r) {
            return r.start >= inputSlice.start && r.end <= inputSlice.end && r.start < r.end;
        });
        const picked = pickReplaceRangeClosestToCursor(candidates, cursorPos);
        if (picked) {
            return picked;
        }
    }

    return findMisspelledWordInInputSlice(value, cursorPos, originalWord, inputSlice.start, inputSlice.end);
}

function findMisspelledWordInInputSlice(value, cursorPos, originalWord, sliceStart, sliceEnd) {
    if (!originalWord || sliceStart == null || sliceEnd == null) {
        return null;
    }
    const inputText = value.substring(sliceStart, sliceEnd);
    const localCursor = Math.max(0, Math.min(cursorPos - sliceStart, inputText.length));
    const origLower = originalWord.toLowerCase();
    const ranges = getWordRangesInSpan(inputText);
    const matching = ranges.filter(function (r) {
        return r.word.toLowerCase() === origLower;
    });

    if (matching.length === 0) {
        return null;
    }

    for (let i = 0; i < matching.length; i++) {
        const r = matching[i];
        if (localCursor >= r.start && localCursor <= r.end) {
            return { start: sliceStart + r.start, end: sliceStart + r.end };
        }
    }

    const trimmedEnd = inputText.trimEnd().length;
    if (localCursor >= trimmedEnd) {
        const last = matching[matching.length - 1];
        return { start: sliceStart + last.start, end: sliceStart + last.end };
    }

    return pickReplaceRangeClosestToCursor(matching.map(function (r) {
        return { start: sliceStart + r.start, end: sliceStart + r.end };
    }), cursorPos);
}

function attachSpellCheckTermBounds(spellData, target) {
    if (!spellData || !target) {
        return spellData;
    }
    const bounds = getAutocompleteSearchBounds(target);
    if (!bounds) {
        return spellData;
    }
    const value = target.value || '';
    const spellOffset = bounds.spellCheckTermOffset != null ? bounds.spellCheckTermOffset : bounds.tokenStart;
    const originalText = spellData.originalText != null ? String(spellData.originalText) : (bounds.spellCheckText || '');
    const inputEnd = Math.min(spellOffset + originalText.length, value.length);
    const inputText = value.substring(spellOffset, inputEnd);
    return Object.assign({}, spellData, {
        termStart: bounds.tokenStart,
        termEnd: bounds.tokenEnd,
        spellCheckTermOffset: spellOffset,
        inputStart: spellOffset,
        inputEnd: inputEnd,
        inputText: inputText
    });
}

function normalizeSpellCheckData(spellData) {
    if (!spellData || typeof spellData !== 'object') {
        return spellData;
    }

    const misspelled = Array.isArray(spellData.misspelled) ? spellData.misspelled : [];
    const rawSuggestions = spellData.suggestions && typeof spellData.suggestions === 'object'
        ? spellData.suggestions
        : {};
    const filteredMisspelled = [];
    const filteredSuggestions = {};

    for (const word of misspelled) {
        const actionable = filterSpellCheckSuggestionsForWord(word, rawSuggestions[word]);
        if (!actionable.length) {
            continue;
        }
        filteredMisspelled.push(word);
        filteredSuggestions[word] = actionable;
    }

    return Object.assign({}, spellData, {
        misspelled: filteredMisspelled,
        suggestions: filteredSuggestions,
        hasErrors: filteredMisspelled.length > 0
    });
}

function filterSpellCheckSuggestionsForWord(word, suggestions) {
    if (!Array.isArray(suggestions)) return [];
    const wordLower = String(word).toLowerCase();
    const seen = new Set();
    const out = [];
    for (const suggestion of suggestions) {
        if (suggestion == null) continue;
        const key = String(suggestion).toLowerCase();
        if (key === wordLower || seen.has(key)) continue;
        seen.add(key);
        out.push(suggestion);
    }
    return out;
}

function applySpellCorrectionReplace(target, replaceStart, replaceEnd, suggestion, cursorPos, options) {
    const keepOpenAndRerun = !!(options && options.keepOpenAndRerun);

    if (!shouldAutofillAcceptReplace(target)) {
        if (!keepOpenAndRerun) {
            insertTextAtPromptCursor(target, suggestion);
            hideCharacterAutocompleteAfterAccept();
            return true;
        }
        clearSpellCheckNavigationState();
        persistentSpellCheckData = null;
        markAutofillOverlayClosedFromInput();
        // Suppress insertTextAtPromptCursor's input while accept may be in-flight; rerun below.
        const wasInFlight = autofillOverlayAcceptInFlight;
        autofillOverlayAcceptInFlight = true;
        try {
            insertTextAtPromptCursor(target, suggestion);
        } finally {
            autofillOverlayAcceptInFlight = wasInFlight;
        }
        setTimeout(function () {
            rerunAutofillSearchAfterSpellCorrection(target);
        }, 0);
        return true;
    }

    const currentValue = target.value;
    const newValue = currentValue.substring(0, replaceStart) + suggestion + currentValue.substring(replaceEnd);
    const newCursorPos = cursorAfterTextReplace(cursorPos, replaceStart, replaceEnd, suggestion.length);
    if (keepOpenAndRerun) {
        clearSpellCheckNavigationState();
        persistentSpellCheckData = null;
        markAutofillOverlayClosedFromInput();
    } else {
        hideCharacterAutocompleteAfterAccept();
    }
    setTextareaValuePreservingUndo(target, newValue);
    if (keepOpenAndRerun) {
        // Keep session span aligned with post-replace text so caret-leave dismiss stays accurate.
        currentCharacterAutocompleteTarget = target;
        autofillSessionTarget = target;
        if (!autofillSessionId) {
            autofillSessionId = 'af_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            autofillSessionPacketRequestId = null;
        }
        target.setSelectionRange(newCursorPos, newCursorPos);
        currentSearchSessionBounds = getAutocompleteSearchBounds(target);
    }
    setTimeout(function () {
        if (!keepOpenAndRerun) {
            target.setSelectionRange(newCursorPos, newCursorPos);
            target.focus();
            return;
        }
        // Do not yank the caret back if the user already moved it / dismissed.
        if (document.activeElement !== target
            || !autofillSessionId
            || autofillSessionTarget !== target
            || shouldAbortAutocompleteSearchSession()) {
            return;
        }
        if (typeof target.selectionStart === 'number' && target.selectionStart !== newCursorPos) {
            // Caret moved after replace — honor it; only refresh if still in the search token.
            if (!isCaretInActiveAutofillSearchArea(target) || shouldAbortAutocompleteSearchSession()) {
                abortAutofillFromCaretLeave(target);
                return;
            }
            rerunAutofillSearchAfterSpellCorrection(target);
            return;
        }
        target.setSelectionRange(newCursorPos, newCursorPos);
        target.focus({ preventScroll: true });
        rerunAutofillSearchAfterSpellCorrection(target);
    }, 0);
    if (!keepOpenAndRerun) {
        target.dispatchEvent(new CustomEvent('input', { bubbles: true, detail: { skipAutofill: true } }));
    }
    return true;
}


function collapsedSpellCheckInsertAvailable() {
    const section = characterAutocompleteList?.querySelector('.spell-check-section');
    return !!(section && spellCheckSectionHasSuggestions(section));
}

function removeSpellCheckSection() {
    const section = characterAutocompleteList?.querySelector('.spell-check-section');
    if (section) section.remove();
}

function getSpellCheckWordCount(section) {
    if (!section) return 0;
    const rows = section.querySelectorAll('.spell-check-word');
    return rows ? rows.length : 0;
}

function clearSpellCheckNavigationState() {
    spellCheckNavigationMode = false;
    selectedSpellCheckWordIndex = -1;
    selectedSpellCheckSuggestionIndex = -1;
    updateSpellCheckSelection();
}

function canSpellCheckNavigationEnter() {
    const spellCheckSection = characterAutocompleteList?.querySelector('.spell-check-section');
    return spellCheckSectionHasSuggestions(spellCheckSection);
}

function enterSpellCheckNavigation(preferLastWord = false) {
    const spellCheckSection = characterAutocompleteList?.querySelector('.spell-check-section');
    if (!spellCheckSectionHasSuggestions(spellCheckSection)) {
        return false;
    }

    clearWordLookupNavigationState();
    clearMainAutocompleteSelection();
    spellCheckNavigationMode = true;
    autocompleteNavigationMode = true;
    userActivelyNavigating = true;

    const wordSections = spellCheckSection.querySelectorAll('.spell-check-word');
    selectedSpellCheckWordIndex = preferLastWord ? wordSections.length - 1 : 0;
    selectedSpellCheckSuggestionIndex = 0;
    updateSpellCheckSelection();
    engageAutofillNavigation();
    return true;
}

function getSelectedSpellCheckSuggestionButton() {
    if (!spellCheckNavigationMode) return null;

    const spellCheckSection = characterAutocompleteList?.querySelector('.spell-check-section');
    if (!spellCheckSection) return null;

    const wordSections = spellCheckSection.querySelectorAll('.spell-check-word');
    if (!wordSections || selectedSpellCheckWordIndex < 0 || selectedSpellCheckWordIndex >= wordSections.length) {
        return null;
    }

    const currentWordSection = wordSections[selectedSpellCheckWordIndex];
    const suggestionBtns = currentWordSection.querySelectorAll('.spell-check-row-expanded .suggestion-btn');
    if (!suggestionBtns || selectedSpellCheckSuggestionIndex < 0 || selectedSpellCheckSuggestionIndex >= suggestionBtns.length) {
        return null;
    }

    return suggestionBtns[selectedSpellCheckSuggestionIndex];
}

function tryApplySelectedSpellCheckSuggestion(target) {
    const selectedBtn = getSelectedSpellCheckSuggestionButton();
    if (!selectedBtn || !target) return false;
    const rowIndex = spellCheckNavigationMode && selectedSpellCheckWordIndex >= 0
        ? selectedSpellCheckWordIndex
        : getSpellCheckRowIndexFromButton(selectedBtn);
    return applySpellCorrection(target, selectedBtn.dataset.original, selectedBtn.dataset.suggestion, rowIndex);
}

function getFirstSpellCheckSuggestionButton(spellCheckSection) {
    const firstWordSection = spellCheckSection?.querySelector('.spell-check-word');
    if (!firstWordSection) return null;
    return firstWordSection.querySelector('.spell-check-row-compact .suggestion-btn')
        || firstWordSection.querySelector('.spell-check-row-expanded .suggestion-btn');
}

function applySpellCheckWordDisplay(section, activeIndex) {
    if (!section) {
        section = characterAutocompleteList?.querySelector('.spell-check-section');
    }
    if (!section) return;

    if (typeof activeIndex !== 'number' || activeIndex < 0) {
        activeIndex = 0;
    }

    section.querySelectorAll('.spell-check-word').forEach(row => {
        const rowIndex = parseInt(row.dataset.wordIndex, 10);
        row.classList.toggle('expanded', rowIndex === activeIndex);
    });
}

function getSpellCheckRowIndexFromButton(btn) {
    if (!btn || !btn.closest) return -1;
    const row = btn.closest('.spell-check-word');
    if (!row) return -1;
    const fromBtn = parseInt(btn.dataset.wordIndex, 10);
    if (Number.isFinite(fromBtn) && fromBtn >= 0) {
        return fromBtn;
    }
    const fromRow = parseInt(row.dataset.wordIndex, 10);
    return Number.isFinite(fromRow) ? fromRow : -1;
}

function wireSpellCheckSuggestionButtons(container, target) {
    if (!container) return;
    container.querySelectorAll('.suggestion-btn').forEach((btn, suggestionIndex) => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            applySpellCorrection(target, btn.dataset.original, btn.dataset.suggestion, getSpellCheckRowIndexFromButton(btn));
        });
        touchSlopUtils.registerTouchSlopTracking(btn);
        btn.addEventListener('touchend', (e) => {
            const maxDelta = touchSlopUtils.finalizeTouchSlop(btn, e);
            if (!touchSlopUtils.isTouchSlopTap(maxDelta)) return;
            e.preventDefault();
            applySpellCorrection(target, btn.dataset.original, btn.dataset.suggestion, getSpellCheckRowIndexFromButton(btn));
        }, { passive: false });
    });
}

function buildSpellCheckSuggestionButtons(word, suggestions, wordIndex) {
    const actionable = filterSpellCheckSuggestionsForWord(word, suggestions);
    if (!actionable.length) return '';
    const rowIndexAttr = typeof wordIndex === 'number' && wordIndex >= 0 ? ` data-word-index="${wordIndex}"` : '';
    return actionable.map(function (suggestion) {
        return `
        <button class="suggestion-btn" data-original="${word}" data-suggestion="${suggestion}"${rowIndexAttr}>
            ${suggestion}
        </button>
    `;
    }).join('');
}

function wireSpellCheckAddWordButton(container, word) {
    const addWordBtn = container?.querySelector('.add-word-btn');
    if (!addWordBtn) return;
    addWordBtn.addEventListener('click', (e) => {
        e.preventDefault();
        addWordToDictionary(word);
    });
    touchSlopUtils.registerTouchSlopTracking(addWordBtn);
    addWordBtn.addEventListener('touchend', (e) => {
        const maxDelta = touchSlopUtils.finalizeTouchSlop(addWordBtn, e);
        if (!touchSlopUtils.isTouchSlopTap(maxDelta)) return;
        e.preventDefault();
        addWordToDictionary(word);
    }, { passive: false });
}

function selectSpellCheckRow(wordIndex) {
    const section = characterAutocompleteList?.querySelector('.spell-check-section');
    if (!section) return;
    selectedSpellCheckWordIndex = wordIndex;
    selectedSpellCheckSuggestionIndex = 0;
    spellCheckNavigationMode = true;
    autocompleteNavigationMode = true;
    clearWordLookupNavigationState();
    clearMainAutocompleteSelection();
    applySpellCheckWordDisplay(section, wordIndex);
    updateSpellCheckSelection();
}

function createSpellCheckWordRow(word, suggestions, target, wordIndex) {
    const suggestionButtonsHtml = buildSpellCheckSuggestionButtons(word, suggestions, wordIndex);

    const row = document.createElement('div');
    row.className = 'spell-check-word';
    row.dataset.wordIndex = String(wordIndex);

    const compact = document.createElement('div');
    compact.className = 'spell-check-row-compact';
    compact.innerHTML = `
        <span class="spell-check-term-inline">"${word}"</span>
        ${suggestionButtonsHtml ? `<div class="suggestions-list spell-check-inline-synonyms">${suggestionButtonsHtml}</div>` : ''}
    `;
    compact.addEventListener('click', (e) => {
        if (e.target.closest('.suggestion-btn')) return;
        e.preventDefault();
        selectSpellCheckRow(wordIndex);
    });
    touchSlopUtils.registerTouchSlopTracking(compact);
    compact.addEventListener('touchend', (e) => {
        if (e.target.closest('.suggestion-btn')) return;
        const maxDelta = touchSlopUtils.finalizeTouchSlop(compact, e);
        if (!touchSlopUtils.isTouchSlopTap(maxDelta)) return;
        e.preventDefault();
        selectSpellCheckRow(wordIndex);
    }, { passive: false });
    row.appendChild(compact);
    wireSpellCheckSuggestionButtons(compact, target);

    const expanded = document.createElement('div');
    expanded.className = 'spell-check-row-expanded';
    expanded.innerHTML = `
        <div class="misspelled-word">"${word}"</div>
        ${suggestionButtonsHtml ? `
            <div class="spell-check-suggestions-label">Suggestions</div>
            <div class="suggestions-list">${suggestionButtonsHtml}</div>
        ` : ''}
        <button class="add-word-btn" data-word="${word}">
            <i class="fas fa-plus"></i> Add
        </button>
    `;
    row.appendChild(expanded);
    wireSpellCheckSuggestionButtons(expanded, target);
    wireSpellCheckAddWordButton(expanded, word);
    wireAutofillItemContextMenu(row);

    return row;
}

function showSpellCheckSuggestions(spellCheckData, target) {
    spellCheckData = normalizeSpellCheckData(spellCheckData);
    if (!spellCheckData || !spellCheckData.hasErrors || !spellCheckData.misspelled || spellCheckData.misspelled.length === 0) {
        removeSpellCheckSection();
        return;
    }

    removeSpellCheckSection();

    const spellCheckSection = document.createElement('div');
    spellCheckSection.className = 'spell-check-section';
    spellCheckSection.innerHTML = `
        <div class="spell-check-header">
            <i class="fas fa-spell-check"></i>
            <span>Spell Check</span>
            ${spellCheckData.originalText ? `<div class="original-text">"${spellCheckData.originalText}"</div>` : ''}
        </div>
    `;

    const wordList = document.createElement('div');
    wordList.className = 'spell-check-word-list';

    spellCheckData.misspelled.forEach((word, wordIndex) => {
        const suggestions = spellCheckData.suggestions[word] || [];
        wordList.appendChild(createSpellCheckWordRow(word, suggestions, target, wordIndex));
    });

    spellCheckSection.appendChild(wordList);
    insertSideSectionAtTop(spellCheckSection);

    if (spellCheckNavigationMode) {
        const wordSections = spellCheckSection.querySelectorAll('.spell-check-word');
        if (!wordSections || wordSections.length === 0) {
            selectedSpellCheckWordIndex = -1;
            selectedSpellCheckSuggestionIndex = -1;
            spellCheckNavigationMode = false;
            return;
        }

        if (selectedSpellCheckWordIndex < 0) {
            selectedSpellCheckWordIndex = 0;
        } else if (selectedSpellCheckWordIndex >= wordSections.length) {
            selectedSpellCheckWordIndex = wordSections.length - 1;
        }

        applySpellCheckWordDisplay(spellCheckSection, selectedSpellCheckWordIndex);

        const selectedWordSection = wordSections[selectedSpellCheckWordIndex];
        const suggestionBtns = selectedWordSection.querySelectorAll('.spell-check-row-expanded .suggestion-btn');
        if (!suggestionBtns || suggestionBtns.length === 0) {
            selectedSpellCheckSuggestionIndex = -1;
        } else if (selectedSpellCheckSuggestionIndex < 0) {
            selectedSpellCheckSuggestionIndex = 0;
        } else if (selectedSpellCheckSuggestionIndex >= suggestionBtns.length) {
            selectedSpellCheckSuggestionIndex = suggestionBtns.length - 1;
        }

        updateSpellCheckSelection();
    } else {
        spellCheckSection.querySelectorAll('.spell-check-word').forEach(row => {
            row.classList.remove('expanded');
        });
    }
}

function updateSpellCheckSelection() {
    const spellCheckSection = characterAutocompleteList?.querySelector('.spell-check-section');
    if (!spellCheckSection) return;

    const wordCount = getSpellCheckWordCount(spellCheckSection);
    spellCheckSection.classList.toggle('nav-active', spellCheckNavigationMode && wordCount > 1);

    spellCheckSection.querySelectorAll('.spell-check-word').forEach(wordSection => {
        wordSection.classList.remove('selected');
        wordSection.querySelectorAll('.suggestion-btn').forEach(btn => {
            btn.classList.remove('selected');
        });
    });

    if (spellCheckNavigationMode && selectedSpellCheckWordIndex >= 0) {
        applySpellCheckWordDisplay(spellCheckSection, selectedSpellCheckWordIndex);

        const wordSections = spellCheckSection.querySelectorAll('.spell-check-word');
        if (wordSections && selectedSpellCheckWordIndex < wordSections.length) {
            const selectedWordSection = wordSections[selectedSpellCheckWordIndex];
            selectedWordSection.classList.add('selected');
            markAutofillListNavigationActivity();

            let scrollTarget = selectedWordSection;
            if (selectedSpellCheckSuggestionIndex >= 0) {
                const suggestionBtns = selectedWordSection.querySelectorAll('.spell-check-row-expanded .suggestion-btn');
                if (suggestionBtns && selectedSpellCheckSuggestionIndex < suggestionBtns.length) {
                    suggestionBtns[selectedSpellCheckSuggestionIndex].classList.add('selected');
                    scrollTarget = suggestionBtns[selectedSpellCheckSuggestionIndex];
                }
            }
            scheduleScrollToAutocompleteOption(scrollTarget);
        }
    } else {
        spellCheckSection.querySelectorAll('.spell-check-word').forEach(row => {
            row.classList.remove('expanded');
        });
    }
    scheduleAutofillKeyguideUpdate();
}

function getBestSpellCheckResult() {
    let bestSpellCheckResult = null;
    let bestScore = 0;

    for (const [, results] of serviceResults) {
        if (!results || !Array.isArray(results)) continue;
        const spellCheckResult = results.find(result => result.type === 'spellcheck');
        if (!spellCheckResult || !spellCheckResult.data || !spellCheckResult.data.hasErrors) continue;

        const misspelledCount = spellCheckResult.data.misspelled.length;
        const totalSuggestions = Object.values(spellCheckResult.data.suggestions || {})
            .reduce((sum, suggestions) => sum + suggestions.length, 0);
        const score = misspelledCount * 10 + totalSuggestions;

        if (score > bestScore) {
            bestScore = score;
            bestSpellCheckResult = spellCheckResult;
        }
    }

    return bestSpellCheckResult;
}
