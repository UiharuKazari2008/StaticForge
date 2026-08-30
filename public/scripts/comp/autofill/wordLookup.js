// JULES: split from autocompleteUtils.js for #22

// Dictionary / thesaurus navigation state
let wordLookupNavigationMode = false;
let selectedWordLookupWordIndex = -1;
let selectedWordLookupSuggestionIndex = -1;
let activeWordLookupWordIndex = 0;
let persistentWordLookupData = null; // Current word lookup data

function attachWordLookupTermBounds(wordLookupData, target, lookupQuery) {
    if (!wordLookupData || !target) {
        return wordLookupData;
    }
    const value = target.value || '';
    const query = String(lookupQuery != null ? lookupQuery : currentSearchQuery || '').trim();
    const cursorPos = typeof target.selectionStart === 'number' ? target.selectionStart : 0;
    const bounds = getAutocompleteSearchBounds(target) || currentSearchSessionBounds;

    let inputStart = null;
    let inputEnd = null;

    const selStart = target.selectionStart;
    const selEnd = target.selectionEnd;
    if (selStart !== selEnd) {
        inputStart = Math.min(selStart, selEnd);
        inputEnd = Math.max(selStart, selEnd);
    } else if (isAutofillProseMode(target)) {
        const prose = getProseWordBoundsAtCursor(value, cursorPos);
        if (prose.end > prose.start) {
            inputStart = prose.start;
            inputEnd = prose.end;
        }
    } else if (query && bounds) {
        const typedRange = resolveTypedInputReplaceRange(value, bounds, cursorPos, { queryText: query });
        if (typedRange) {
            inputStart = typedRange.start;
            inputEnd = typedRange.end;
        }
    }

    if (inputStart == null && query) {
        const found = findMisspelledWordInInputSlice(value, cursorPos, query, 0, value.length);
        if (found) {
            inputStart = found.start;
            inputEnd = found.end;
        }
    }

    const termStart = bounds ? bounds.tokenStart : 0;
    const termEnd = bounds ? bounds.tokenEnd : value.length;

    return Object.assign({}, wordLookupData, {
        termStart,
        termEnd,
        inputStart,
        inputEnd,
        inputText: inputStart != null ? value.substring(inputStart, inputEnd) : '',
        lookupQuery: query
    });
}

function getWordLookupWordOccurrenceIndex(wordLookupData, originalWord, wordRowIndex) {
    if (!wordLookupData || !Array.isArray(wordLookupData.words) || wordRowIndex < 0) {
        return -1;
    }
    const origLower = String(originalWord || '').toLowerCase();
    if (String(wordLookupData.words[wordRowIndex]?.word || '').toLowerCase() !== origLower) {
        return -1;
    }
    let occ = 0;
    for (let i = 0; i < wordRowIndex; i++) {
        if (String(wordLookupData.words[i]?.word || '').toLowerCase() === origLower) {
            occ++;
        }
    }
    return occ;
}

function findWordLookupReplaceRange(target, originalWord, wordRowIndex) {
    if (!target || !originalWord) {
        return null;
    }
    const value = target.value || '';
    const cursorPos = typeof target.selectionStart === 'number' ? target.selectionStart : 0;
    const origLower = String(originalWord).toLowerCase();
    const wlMeta = persistentWordLookupData || {};
    let rowIndex = typeof wordRowIndex === 'number' && wordRowIndex >= 0 ? wordRowIndex : -1;
    if (rowIndex < 0 && wordLookupNavigationMode && selectedWordLookupWordIndex >= 0) {
        rowIndex = selectedWordLookupWordIndex;
    }

    const selStart = target.selectionStart;
    const selEnd = target.selectionEnd;
    if (selStart !== selEnd) {
        const a = Math.min(selStart, selEnd);
        const b = Math.max(selStart, selEnd);
        const sel = value.substring(a, b);
        if (sel.trim().toLowerCase() === origLower || sel.toLowerCase() === origLower) {
            return { start: a, end: b };
        }
    }

    const occIndex = getWordLookupWordOccurrenceIndex(wlMeta, originalWord, rowIndex);

    if (wlMeta.inputStart != null && wlMeta.inputEnd != null && wlMeta.inputText) {
        const sliceText = value.substring(wlMeta.inputStart, wlMeta.inputEnd);
        if (sliceText === wlMeta.inputText) {
            if (sliceText.toLowerCase() === origLower) {
                return { start: wlMeta.inputStart, end: wlMeta.inputEnd };
            }
            const inStored = findWordInSpanByOccurrence(value, wlMeta.inputStart, wlMeta.inputEnd, originalWord, occIndex);
            if (inStored) {
                return inStored;
            }
        }
    }

    const liveBounds = getAutocompleteSearchBounds(target);
    const bounds = currentSearchSessionBounds || liveBounds;
    if (bounds) {
        const termStart = bounds.tokenStart;
        const termEnd = bounds.termEnd;
        const typedRange = resolveTypedInputReplaceRange(value, bounds, cursorPos, { queryText: originalWord });
        if (typedRange) {
            const t = value.substring(typedRange.start, typedRange.end);
            if (t.toLowerCase() === origLower) {
                return { start: typedRange.start, end: typedRange.end };
            }
        }
        const inTerm = findWordInSpanByOccurrence(value, termStart, termEnd, originalWord, occIndex);
        if (inTerm) {
            return inTerm;
        }
        return findMisspelledWordInInputSlice(value, cursorPos, originalWord, termStart, termEnd);
    }

    if (isAutofillProseMode(target)) {
        const prose = getProseWordBoundsAtCursor(value, cursorPos);
        if (prose.word.toLowerCase() === origLower) {
            return { start: prose.start, end: prose.end };
        }
    }

    const sliceStart = wlMeta.termStart != null ? wlMeta.termStart : 0;
    const sliceEnd = wlMeta.termEnd != null ? wlMeta.termEnd : value.length;
    const inSlice = findWordInSpanByOccurrence(value, sliceStart, sliceEnd, originalWord, occIndex);
    if (inSlice) {
        return inSlice;
    }

    return findMisspelledWordInInputSlice(value, cursorPos, originalWord, 0, value.length);
}

function primeWordLookupReplaceContext(target, lookupQuery, boundData) {
    if (boundData) {
        persistentWordLookupData = boundData;
        return boundData;
    }
    if (!target) {
        return null;
    }
    const query = String(lookupQuery || getWikiTermFromPromptTextareaForKeyboard(target) || currentSearchQuery || '').trim();
    const base = getActiveWordLookupData() || { hasData: true, words: [] };
    persistentWordLookupData = attachWordLookupTermBounds(base, target, query);
    return persistentWordLookupData;
}

function collapsedWordLookupInsertAvailable() {
    const section = getWordLookupSection();
    return !!(section && getFirstWordLookupSuggestionButton(section));
}

function getWordLookupSection() {
    return characterAutocompleteList?.querySelector('.word-lookup-section');
}

function removeWordLookupSection() {
    const section = getWordLookupSection();
    if (section) section.remove();
}

function getWordLookupWordRows(section) {
    if (!section) return [];
    return section.querySelectorAll(':scope > .word-lookup-word-list > .word-lookup-word-row');
}

function getWordLookupWordCount(section) {
    return getWordLookupWordRows(section).length;
}

function clearWordLookupNavigationState() {
    wordLookupNavigationMode = false;
    selectedWordLookupWordIndex = -1;
    selectedWordLookupSuggestionIndex = -1;
    updateWordLookupSelection();
}

function canWordLookupNavigationEnter() {
    const wordLookupSection = getWordLookupSection();
    return !!(wordLookupSection && getWordLookupWordCount(wordLookupSection) > 0);
}

function enterWordLookupNavigation(preferLastWord = false) {
    const wordLookupSection = getWordLookupSection();
    if (!wordLookupSection || getWordLookupWordCount(wordLookupSection) === 0) {
        return false;
    }

    clearSpellCheckNavigationState();
    clearMainAutocompleteSelection();
    wordLookupNavigationMode = true;
    autocompleteNavigationMode = true;
    userActivelyNavigating = true;

    const wordCount = getWordLookupWordCount(wordLookupSection);
    selectedWordLookupWordIndex = preferLastWord ? wordCount - 1 : 0;
    selectedWordLookupSuggestionIndex = 0;
    updateWordLookupSelection();
    engageAutofillNavigation();
    return true;
}

function getSelectedWordLookupSuggestionButton() {
    if (!wordLookupNavigationMode) return null;

    const wordLookupSection = getWordLookupSection();
    if (!wordLookupSection) return null;

    const wordSections = getWordLookupWordRows(wordLookupSection);
    if (!wordSections.length || selectedWordLookupWordIndex < 0 || selectedWordLookupWordIndex >= wordSections.length) {
        return null;
    }

    const currentWordSection = wordSections[selectedWordLookupWordIndex];
    const suggestionBtns = currentWordSection.querySelectorAll('.word-lookup-row-expanded .suggestion-btn');
    if (!suggestionBtns || selectedWordLookupSuggestionIndex < 0 || selectedWordLookupSuggestionIndex >= suggestionBtns.length) {
        return null;
    }

    return suggestionBtns[selectedWordLookupSuggestionIndex];
}

function tryApplySelectedWordLookupSuggestion(target) {
    const selectedBtn = getSelectedWordLookupSuggestionButton();
    if (!selectedBtn || !target) return false;
    const row = selectedBtn.closest('.word-lookup-word-row');
    const wordRowIndex = row ? parseInt(row.dataset.wordIndex, 10) : -1;
    return applyWordLookupInsert(target, selectedBtn.dataset.original, selectedBtn.dataset.suggestion, wordRowIndex);
}

function getFirstWordLookupSuggestionButton(wordLookupSection) {
    // Enter/click only — never used for Tab Replace (thesaurus excluded while collapsed; see resolveTabAutofillAcceptTarget).
    const firstRow = wordLookupSection?.querySelector('.word-lookup-word-row');
    if (!firstRow) return null;
    return firstRow.querySelector('.word-lookup-row-compact .suggestion-btn')
        || firstRow.querySelector('.word-lookup-row-expanded .suggestion-btn');
}

function getBestWordLookupResult() {
    for (const [, results] of serviceResults) {
        if (!results || !Array.isArray(results)) continue;
        const wordLookupResult = results.find(result => result.type === 'wordLookup');
        if (wordLookupResult && wordLookupResult.data && wordLookupResult.data.hasData) {
            return wordLookupResult;
        }
    }
    return null;
}

function getActiveWordLookupData() {
    const wordLookupResult = getBestWordLookupResult();
    const target = currentCharacterAutocompleteTarget;
    if (wordLookupResult && wordLookupResult.data && wordLookupResult.data.hasData) {
        persistentWordLookupData = target
            ? attachWordLookupTermBounds(wordLookupResult.data, target, currentSearchQuery)
            : wordLookupResult.data;
        return persistentWordLookupData;
    }
    if (persistentWordLookupData && persistentWordLookupData.hasData) {
        return persistentWordLookupData;
    }
    persistentWordLookupData = null;
    return null;
}

function applyWordLookupWordDisplay(section, activeIndex) {
    if (!section) {
        section = getWordLookupSection();
    }
    if (!section) return;

    if (typeof activeIndex !== 'number' || activeIndex < 0) {
        activeIndex = 0;
    }
    activeWordLookupWordIndex = activeIndex;

    section.querySelectorAll('.word-lookup-word-row').forEach(row => {
        const rowIndex = parseInt(row.dataset.wordIndex, 10);
        const isActive = rowIndex === activeIndex;
        row.classList.toggle('expanded', isActive);
    });
}

function wireWordLookupSuggestionButtons(container, target) {
    if (!container) return;
    container.querySelectorAll('.suggestion-btn').forEach((btn, suggestionIndex) => {
        const wordRowIndex = parseInt(btn.closest('.word-lookup-word-row')?.dataset.wordIndex, 10);
        const rowIndex = Number.isFinite(wordRowIndex) ? wordRowIndex : -1;
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            applyWordLookupInsert(target, btn.dataset.original, btn.dataset.suggestion, rowIndex);
        });
        touchSlopUtils.registerTouchSlopTracking(btn);
        btn.addEventListener('touchend', (e) => {
            const maxDelta = touchSlopUtils.finalizeTouchSlop(btn, e);
            if (!touchSlopUtils.isTouchSlopTap(maxDelta)) return;
            e.preventDefault();
            applyWordLookupInsert(target, btn.dataset.original, btn.dataset.suggestion, rowIndex);
        }, { passive: false });
    });
}

function buildWordLookupSynonymButtons(entry) {
    const synonyms = entry.synonyms || [];
    if (synonyms.length === 0) return '';
    return synonyms.map(synonym => `
        <button class="suggestion-btn" data-original="${entry.word}" data-suggestion="${synonym}">
            ${synonym}
        </button>
    `).join('');
}

function buildWordLookupDefinitionsHtml(definitions) {
    if (!definitions || definitions.length === 0) return '';
    return definitions.map(definition => {
        const posLabel = definition.pos ? `<span class="word-lookup-pos">${definition.pos}.</span> ` : '';
        return `<div class="word-lookup-definition">${posLabel}${definition.gloss}</div>`;
    }).join('');
}

function selectWordLookupRow(wordIndex) {
    const section = getWordLookupSection();
    if (!section) return;
    activeWordLookupWordIndex = wordIndex;
    selectedWordLookupWordIndex = wordIndex;
    selectedWordLookupSuggestionIndex = 0;
    wordLookupNavigationMode = true;
    autocompleteNavigationMode = true;
    clearMainAutocompleteSelection();
    applyWordLookupWordDisplay(section, wordIndex);
    updateWordLookupSelection();
}

function createWordLookupWordRow(entry, target, wordIndex) {
    const definitions = entry.definitions || [];
    const synonymButtonsHtml = buildWordLookupSynonymButtons(entry);
    const definitionsHtml = buildWordLookupDefinitionsHtml(definitions);

    const lookupHint = entry.lookupWord && entry.lookupWord.toLowerCase() !== String(entry.word).toLowerCase()
        ? `<div class="word-lookup-lookup-hint">via "${entry.lookupWord}"</div>`
        : '';

    const row = document.createElement('div');
    row.className = 'word-lookup-word-row';
    row.dataset.wordIndex = String(wordIndex);

    const compact = document.createElement('div');
    compact.className = 'word-lookup-row-compact';
    compact.innerHTML = `
        <span class="word-lookup-term-inline">"${entry.word}"</span>
        ${synonymButtonsHtml ? `<div class="suggestions-list word-lookup-inline-synonyms">${synonymButtonsHtml}</div>` : ''}
    `;
    compact.addEventListener('click', (e) => {
        if (e.target.closest('.suggestion-btn')) return;
        e.preventDefault();
        selectWordLookupRow(wordIndex);
    });
    touchSlopUtils.registerTouchSlopTracking(compact);
    compact.addEventListener('touchend', (e) => {
        if (e.target.closest('.suggestion-btn')) return;
        const maxDelta = touchSlopUtils.finalizeTouchSlop(compact, e);
        if (!touchSlopUtils.isTouchSlopTap(maxDelta)) return;
        e.preventDefault();
        selectWordLookupRow(wordIndex);
    }, { passive: false });
    row.appendChild(compact);
    wireWordLookupSuggestionButtons(compact, target);

    const expanded = document.createElement('div');
    expanded.className = 'word-lookup-row-expanded';
    expanded.innerHTML = `
        <div class="word-lookup-term">"${entry.word}"</div>
        ${lookupHint}
        ${definitionsHtml ? `<div class="word-lookup-definitions-panel">${definitionsHtml}</div>` : ''}
        ${synonymButtonsHtml ? `
            <div class="word-lookup-synonyms-label">Synonyms</div>
            <div class="suggestions-list">${synonymButtonsHtml}</div>
        ` : ''}
    `;
    row.appendChild(expanded);
    wireWordLookupSuggestionButtons(expanded, target);
    wireAutofillItemContextMenu(row);

    return row;
}

function showWordLookupSection(wordLookupData, target) {
    if (!wordLookupData || !wordLookupData.hasData || !Array.isArray(wordLookupData.words)) {
        removeWordLookupSection();
        return;
    }

    const wordsWithData = wordLookupData.words.filter(entry =>
        (entry.synonyms && entry.synonyms.length > 0) ||
        (entry.definitions && entry.definitions.length > 0)
    );
    if (wordsWithData.length === 0) {
        removeWordLookupSection();
        return;
    }

    if (activeWordLookupWordIndex >= wordsWithData.length) {
        activeWordLookupWordIndex = 0;
    }

    removeWordLookupSection();

    const hasSynonyms = wordsWithData.some(entry => entry.synonyms && entry.synonyms.length > 0);
    const sectionTitle = hasSynonyms ? 'Thesaurus' : 'Dictionary';

    const wordLookupSection = document.createElement('div');
    wordLookupSection.className = 'word-lookup-section';

    const header = document.createElement('div');
    header.className = 'word-lookup-header';
    header.innerHTML = `<i class="fas fa-book"></i><span>${sectionTitle}</span>`;
    wordLookupSection.appendChild(header);

    const wordList = document.createElement('div');
    wordList.className = 'word-lookup-word-list';

    wordsWithData.forEach((entry, wordIndex) => {
        wordList.appendChild(createWordLookupWordRow(entry, target, wordIndex));
    });

    wordLookupSection.appendChild(wordList);

    const spellCheckSection = characterAutocompleteList?.querySelector('.spell-check-section');
    if (spellCheckSection) {
        spellCheckSection.insertAdjacentElement('afterend', wordLookupSection);
    } else {
        insertSideSectionAtTop(wordLookupSection);
    }

    let displayIndex = activeWordLookupWordIndex;
    if (wordLookupNavigationMode && selectedWordLookupWordIndex >= 0) {
        displayIndex = selectedWordLookupWordIndex;
    } else if (displayIndex >= wordsWithData.length) {
        displayIndex = 0;
    }
    activeWordLookupWordIndex = displayIndex;
    if (wordLookupNavigationMode) {
        selectedWordLookupWordIndex = displayIndex;
        applyWordLookupWordDisplay(wordLookupSection, displayIndex);

        const activeRow = wordLookupSection.querySelector(`.word-lookup-word-row[data-word-index="${displayIndex}"]`);
        const suggestionBtns = activeRow?.querySelectorAll('.word-lookup-row-expanded .suggestion-btn');
        if (!suggestionBtns || suggestionBtns.length === 0) {
            selectedWordLookupSuggestionIndex = -1;
        } else if (selectedWordLookupSuggestionIndex < 0) {
            selectedWordLookupSuggestionIndex = 0;
        } else if (selectedWordLookupSuggestionIndex >= suggestionBtns.length) {
            selectedWordLookupSuggestionIndex = suggestionBtns.length - 1;
        }
        updateWordLookupSelection();
    } else {
        wordLookupSection.querySelectorAll('.word-lookup-word-row').forEach(row => {
            row.classList.remove('expanded');
        });
    }
}

function applyWordLookupInsert(target, originalWord, synonym, wordRowIndex) {
    if (!target || !originalWord || synonym == null) {
        return false;
    }
    const cursorPos = target.selectionStart;
    const wordRange = findWordLookupReplaceRange(target, originalWord, wordRowIndex);
    if (wordRange) {
        return applySpellCorrectionReplace(target, wordRange.start, wordRange.end, synonym, cursorPos);
    }
    if (typeof showGlassToast === 'function') {
        showGlassToast('error', null, `Could not find "${originalWord}" to replace`, false, 3000, '<i class="fas fa-exclamation-triangle"></i>');
    }
    return false;
}

function updateWordLookupSelection() {
    const wordLookupSection = getWordLookupSection();
    if (!wordLookupSection) return;

    const wordCount = getWordLookupWordCount(wordLookupSection);
    wordLookupSection.classList.toggle('nav-active', wordLookupNavigationMode && wordCount > 1);

    wordLookupSection.querySelectorAll('.suggestion-btn').forEach(btn => {
        btn.classList.remove('selected');
    });
    wordLookupSection.querySelectorAll('.word-lookup-word-row').forEach(row => {
        row.classList.remove('selected');
    });

    if (wordLookupNavigationMode && selectedWordLookupWordIndex >= 0) {
        applyWordLookupWordDisplay(wordLookupSection, selectedWordLookupWordIndex);

        const wordSections = getWordLookupWordRows(wordLookupSection);
        if (wordSections.length && selectedWordLookupWordIndex < wordSections.length) {
            const selectedWordSection = wordSections[selectedWordLookupWordIndex];
            selectedWordSection.classList.add('selected');
            markAutofillListNavigationActivity();

            let scrollTarget = selectedWordSection;
            if (selectedWordLookupSuggestionIndex >= 0) {
                const suggestionBtns = selectedWordSection.querySelectorAll('.word-lookup-row-expanded .suggestion-btn');
                if (suggestionBtns && selectedWordLookupSuggestionIndex < suggestionBtns.length) {
                    suggestionBtns[selectedWordLookupSuggestionIndex].classList.add('selected');
                    scrollTarget = suggestionBtns[selectedWordLookupSuggestionIndex];
                }
            }
            scheduleScrollToAutocompleteOption(scrollTarget);
        }
    } else {
        wordLookupSection.querySelectorAll('.word-lookup-word-row').forEach(row => {
            row.classList.remove('expanded');
        });
    }
    scheduleAutofillKeyguideUpdate();
}
