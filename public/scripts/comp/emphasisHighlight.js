// Emphasis textarea highlight overlay

let emphasisHighlightingActive = false;
let emphasisHighlightingTarget = null;
// Pre-compiled regex patterns for better performance
const EMPHASIS_PATTERNS = {
    weightEmphasis: /(-?\d+\.?\d*)::((?:(?!-?\d+\.?\d*::).)+?)::/g,
    weightEmphasisAutoTerminating: /(-?\d+\.?\d*)::((?:(?!-?\d+\.?\d*::).)+?)(?=\s*-?\d+\.?\d*::|::|$)/g,
    braceEmphasis: /(\{+)([^}]+)(\}+)/g,
    bracketEmphasis: /(\[+)([^\]]+)(\]+)/g,
    bracketedIncrementing: /(!)\[([^\]]+)\](_*)(~\+|~)?(#)/g,
    bracketedReplacement: /(!)\[([^\]]+)\](_*)(~\+|~)?/g,
    disableSyntax: /(!)\/([^\/]+)\//g,
    incrementingSyntax: /(!)([a-zA-Z0-9_]+)#/g,
    pickCombineIncrementing: /(!)([a-zA-Z0-9_]+)~\+#/g,
    pickIncrementingSuffix: /(!)([a-zA-Z0-9_]+)~#/g,
    // Do not treat ~+ / ~ as pick when followed by # (~+# and ~# are separate patterns).
    pickReplacement: /(!)([a-zA-Z0-9_]+)(~\+(?!#)|~(?!#))/g,
    regularReplacement: /(!)([a-zA-Z0-9_]+)\b/g
};

/** Caret proximity (chars) for showing weight-group edge bars. */
const EMPHASIS_GROUP_CARET_PROXIMITY = 5;

// Store previous textarea values for NSFW tag detection
const previousTextareaValues = new WeakMap();

// Emphasis highlighting — debounced overlay pass; plain text skips the regex pipeline
const emphasisHighlightValueCache = new WeakMap();
const emphasisHighlightDebounceTimers = new WeakMap();
const EMPHASIS_HIGHLIGHT_DEBOUNCE_MS = 50;

function promptNeedsFullSyntaxHighlight(text) {
    if (!text) return false;
    // hasManagedEmphasisGroupIds: public/scripts/comp/emphasisGroupIdCodec.js
    if (typeof hasManagedEmphasisGroupIds === 'function' && hasManagedEmphasisGroupIds(text)) {
        return true;
    }
    return /::|[{}[\]|]|<|>|!|\u2060/.test(text);
}

function getEmphasisHighlightCacheSignature(textarea, value) {
    // resolveEmphasisBagForTextarea: public/scripts/comp/emphasisGroupIdCodec.js
    const bag = typeof resolveEmphasisBagForTextarea === 'function'
        ? resolveEmphasisBagForTextarea(textarea)
        : null;
    if (!bag || !bag.groupsById) return value;
    const groups = bag.groupsById;
    // Avoid JSON.stringify on every keystroke — fingerprint ids + weights only.
    let sig = value + '\0' + (bag.syntaxMode || '');
    for (const id in groups) {
        if (!Object.prototype.hasOwnProperty.call(groups, id)) continue;
        const entry = groups[id];
        const w = (entry && typeof entry === 'object') ? entry.weight : entry;
        sig += '\0' + id + ':' + w;
    }
    return sig;
}

function cancelEmphasisHighlightUpdate(textarea) {
    if (!textarea) return;
    const timer = emphasisHighlightDebounceTimers.get(textarea);
    if (timer) {
        clearTimeout(timer);
        emphasisHighlightDebounceTimers.delete(textarea);
    }
}

function scheduleEmphasisHighlightUpdate(textarea, immediate = false) {
    if (!textarea) return;
    if (textarea.closest('.creative-directive-container, .prompt-textarea-container.director-prompt')) return;

    if (immediate) {
        cancelEmphasisHighlightUpdate(textarea);
        // scheduleTextInputSideEffect: public/scripts/comp/textareaUtils.js
        scheduleTextInputSideEffect(textarea, () => {
            updateEmphasisHighlighting(textarea);
        });
        return;
    }

    let timer = emphasisHighlightDebounceTimers.get(textarea);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
        emphasisHighlightDebounceTimers.delete(textarea);
        if (!textarea.isConnected) return;
        // isTextInputComposing: public/scripts/comp/textareaUtils.js
        if (typeof isTextInputComposing === 'function' && isTextInputComposing(textarea)) return;
        scheduleTextInputSideEffect(textarea, () => {
            updateEmphasisHighlighting(textarea);
        });
    }, EMPHASIS_HIGHLIGHT_DEBOUNCE_MS);
    emphasisHighlightDebounceTimers.set(textarea, timer);
}

function throttledUpdateEmphasisHighlighting(textarea) {
    scheduleEmphasisHighlightUpdate(textarea);
}

function startEmphasisHighlighting(textarea) {
    if (emphasisHighlightingActive && emphasisHighlightingTarget === textarea) return;
    
    // Skip emphasis highlighting for plain-text prompt fields (search highlighting only)
    if (textarea && textarea.closest('.creative-directive-container, .prompt-textarea-container.director-prompt')) return;

    // Clear previous target so detached textareas are not retained by the strong global
    if (emphasisHighlightingTarget && emphasisHighlightingTarget !== textarea) {
        stopEmphasisHighlighting();
    }

    emphasisHighlightingActive = true;
    emphasisHighlightingTarget = textarea;

    // wirePromptTextareaVisualUpdates: public/scripts/comp/textareaUtils.js
    wirePromptTextareaVisualUpdates(textarea);

    // autoResizeTextarea: public/scripts/comp/utilities.js
    autoResizeTextarea(textarea);
    updateEmphasisHighlighting(textarea);
}

function stopEmphasisHighlighting() {
    if (emphasisHighlightingTarget) {
        cancelEmphasisHighlightUpdate(emphasisHighlightingTarget);
        // cancelTextInputSideEffect: public/scripts/comp/textareaUtils.js
        cancelTextInputSideEffect(emphasisHighlightingTarget);
        emphasisHighlightValueCache.delete(emphasisHighlightingTarget);
    }
    
    emphasisHighlightingActive = false;
    emphasisHighlightingTarget = null;
}

function handleNsfwTagDetection(textarea, currentValue) {
    if (!textarea || !currentValue) return;

    const previousValue = previousTextareaValues.get(textarea) || '';
    const currentValueLower = currentValue.toLowerCase();
    const previousValueLower = previousValue.toLowerCase();

    // Check if "nsfw" was added (appears in current but not in previous)
    const nsfwRegex = /\bnsfw\b/gi;
    const hasNsfwNow = nsfwRegex.test(currentValueLower);
    const hadNsfwBefore = nsfwRegex.test(previousValueLower);

    if (hasNsfwNow && !hadNsfwBefore) {
        // NSFW tag was just added, remove it and set appropriate mode

        // Remove all instances of "nsfw" (case insensitive)
        let cleanedValue = currentValue.replace(nsfwRegex, '').trim();

        // Clean up extra spaces and commas
        cleanedValue = cleanedValue.replace(/\s*,\s*,/g, ',').replace(/^,\s*/, '').replace(/,\s*$/, '');

        // setTextareaValuePreservingUndo: public/scripts/comp/textareaUtils.js
        setTextareaValuePreservingUndo(textarea, cleanedValue);

        // Determine NSFW mode based on textarea type
        let nsfwMode = 1; // Default for prompts

        // Check if this is a UC textarea
        const isUcTextarea = textarea.id === 'manualUc' ||
                           textarea.id === 'manualPromptNegative' ||
                           textarea.classList.contains('uc-textarea') ||
                           textarea.closest('.character-uc-container') ||
                           textarea.getAttribute('data-type') === 'uc' ||
                           (textarea.id && textarea.id.endsWith('_uc')); // Character UC textareas

        if (isUcTextarea) {
            nsfwMode = -1; // Remove mode for UC textareas
        }

        // Set the NSFW value
        selectNsfwValue(nsfwMode);
        previousTextareaValues.set(textarea, cleanedValue);
        return;
    }

    // Store current value for next comparison
    previousTextareaValues.set(textarea, currentValue);
}

function updateEmphasisHighlighting(textarea) {
    if (!textarea) return;

    // isTextInputComposing: public/scripts/comp/textareaUtils.js
    if (typeof isTextInputComposing === 'function' && isTextInputComposing(textarea)) {
        return;
    }
    
    // Skip emphasis highlighting for creative directive container (only use search highlighting)
    if (textarea.closest('.creative-directive-container, .prompt-textarea-container.director-prompt')) return;

    // Keep golden selection highlight while emphasis editor is active
    if (emphasisEditingActive && emphasisEditingTarget === textarea && emphasisEditingSelection) {
        addEmphasisSelectionHighlight(textarea, emphasisEditingSelection);
        return;
    }

    const currentValue = textarea.value;
    const overlay = ensurePromptEmphasisHighlightOverlay(textarea);
    if (!overlay) return;

    const cacheSig = getEmphasisHighlightCacheSignature(textarea, currentValue);
    const cachedValue = emphasisHighlightValueCache.get(textarea);
    if (cachedValue === cacheSig) {
        overlay.scrollTop = textarea.scrollTop;
        overlay.scrollLeft = textarea.scrollLeft;
        syncEmphasisGroupBoundaryCarets(textarea);
        return;
    }

    // NSFW tag detection only when the painted value actually changed (may rewrite value)
    handleNsfwTagDetection(textarea, currentValue);
    const paintValue = textarea.value;
    const paintSig = paintValue === currentValue
        ? cacheSig
        : getEmphasisHighlightCacheSignature(textarea, paintValue);
    emphasisHighlightValueCache.set(textarea, paintSig);

    if (!promptNeedsFullSyntaxHighlight(paintValue)) {
        overlay.textContent = paintValue;
    } else {
        // resolveEmphasisBagForTextarea: public/scripts/comp/emphasisGroupIdCodec.js
        const bag = typeof resolveEmphasisBagForTextarea === 'function'
            ? resolveEmphasisBagForTextarea(textarea)
            : null;
        overlay.innerHTML = highlightEmphasisInText(paintValue, bag);
    }

    // Sync scroll position
    overlay.scrollTop = textarea.scrollTop;
    overlay.scrollLeft = textarea.scrollLeft;
    syncEmphasisGroupBoundaryCarets(textarea);
}

function initializeEmphasisOverlay(textarea) {
    if (!textarea) return;
    
    // Skip emphasis highlighting for creative directive container (only use search highlighting)
    if (textarea.closest('.creative-directive-container, .prompt-textarea-container.director-prompt')) return;

    const value = textarea.value;
    // resolveEmphasisBagForTextarea: public/scripts/comp/emphasisGroupIdCodec.js
    const bag = typeof resolveEmphasisBagForTextarea === 'function'
        ? resolveEmphasisBagForTextarea(textarea)
        : null;
    const highlightedValue = highlightEmphasisInText(value, bag);

    const overlay = ensurePromptEmphasisHighlightOverlay(textarea);
    if (!overlay) return;

    overlay.innerHTML = highlightedValue;

    // Sync scroll position
    overlay.scrollTop = textarea.scrollTop;
    overlay.scrollLeft = textarea.scrollLeft;
    syncEmphasisGroupBoundaryCarets(textarea);
}

/** Solid text color for emphasis toolbar value — mirrors highlight ramps; 1.0 = light gray (not transparent). */
function getEmphasisToolbarColor(weight) {
    if (weight === '---') return '#ff6b6b';
    const c = computeEmphasisWeightColor(weight);
    return `rgb(${c.r}, ${c.g}, ${c.b})`;
}

/** Inline emphasis highlight colors — same ramp as prompt overlay spans. */
function getEmphasisHighlightStyle(weight) {
    if (weight === '---') {
        return {
            color: '#ff6b6b',
            background: 'transparent',
            borderColor: 'transparent'
        };
    }
    const c = computeEmphasisWeightColor(weight);
    return {
        color: `rgb(${c.r}, ${c.g}, ${c.b})`,
        background: `rgba(${c.r}, ${c.g}, ${c.b}, ${c.backgroundA.toFixed(2)})`,
        borderColor: `rgba(${c.borderR}, ${c.borderG}, ${c.borderB}, ${c.borderA.toFixed(2)})`
    };
}

let cachedU1TagPattern = null;
let cachedU1TagPatternSource = null;

function getU1TagPattern() {
    if (!window.u1 || !window.u1.length) return null;
    if (cachedU1TagPattern && cachedU1TagPatternSource === window.u1) {
        return cachedU1TagPattern;
    }
    const sortedTags = [...window.u1].sort((a, b) => b.length - a.length);
    cachedU1TagPattern = new RegExp(`\\b(${sortedTags.map(tag => tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'gi');
    cachedU1TagPatternSource = window.u1;
    return cachedU1TagPattern;
}

/**
 * Whether typing at `caret` would land inside this group (mirrors snapCaretIntoManagedGroupForTyping).
 * leaveDir only applies on delimiter/outer edges — not when parked on content-facing openEnd/closeStart.
 */
function isEmphasisCaretTypingInsideGroup(caret, leaveDir, b) {
    const { start, openEnd, closeStart, end } = b;

    if (caret > openEnd && caret < closeStart) return true;
    if (caret === openEnd || caret === closeStart) return true;

    if (caret > start && caret < openEnd) return leaveDir > 0;
    if (caret > closeStart && caret < end) return leaveDir < 0;
    if (caret === start) return leaveDir > 0;
    if (caret === end) return leaveDir < 0;

    return false;
}

/** Per-edge inside/outside for tail direction (start vs end can differ mid-group). */
function resolveEmphasisCaretEdgeMembership(caret, leaveDir, bound, edge) {
    const { start, openEnd, closeStart, end } = bound;

    if (edge === 'start') {
        if (caret < start) return false;
        if (caret > openEnd) return true;
        if (caret === openEnd) return true;
        if (caret === start) return leaveDir > 0;
        if (caret > start && caret < openEnd) return leaveDir > 0;
        return false;
    }

    if (caret > end) return false;
    if (caret < closeStart) return true;
    if (caret === closeStart) return true;
    if (caret === end) return leaveDir < 0;
    if (caret > closeStart && caret < end) return leaveDir < 0;
    return false;
}

function escapeEmphasisHighlightText(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function emphasisRangeIsCovered(ranges, start, end) {
    return ranges.some((r) => start >= r.start && end <= r.end);
}

/** Collect all weight-group spans from raw prompt text (indices match textarea.value). */
function collectEmphasisWeightGroupSpecs(text, weightSource) {
    const specs = [];
    const covered = [];

    if (typeof hasManagedEmphasisGroupIds === 'function'
        && typeof listManagedEmphasisBlocks === 'function'
        && hasManagedEmphasisGroupIds(text)) {
        listManagedEmphasisBlocks(text).forEach((b) => {
            if (emphasisRangeIsCovered(covered, b.start, b.end)) return;
            let weight = typeof resolveWeightForEmphasisGroupId === 'function'
                ? resolveWeightForEmphasisGroupId(b.id, weightSource)
                : null;
            if (!Number.isFinite(weight) && Number.isFinite(b.textWeight)) weight = b.textWeight;
            if (!Number.isFinite(weight)) weight = 1;
            specs.push({
                kind: 'managed',
                id: b.id,
                start: b.start,
                openEnd: b.openEnd,
                closeStart: b.closeStart,
                end: b.end,
                innerText: b.innerText,
                openPart: text.slice(b.start, b.openEnd),
                closePart: text.slice(b.closeStart, b.end),
                weight
            });
            covered.push({ start: b.start, end: b.end });
        });
    }

    let m;
    while ((m = EMPHASIS_PATTERNS.weightEmphasis.exec(text)) !== null) {
        const end = m.index + m[0].length;
        if (emphasisRangeIsCovered(covered, m.index, end)) continue;
        const openLen = m[1].length + 2;
        specs.push({
            kind: 'classic',
            id: null,
            start: m.index,
            openEnd: m.index + openLen,
            closeStart: end - 2,
            end,
            innerText: m[2],
            openPart: `${m[1]}::`,
            closePart: '::',
            weight: parseFloat(m[1])
        });
        covered.push({ start: m.index, end });
    }
    EMPHASIS_PATTERNS.weightEmphasis.lastIndex = 0;

    while ((m = EMPHASIS_PATTERNS.weightEmphasisAutoTerminating.exec(text)) !== null) {
        const end = m.index + m[0].length;
        if (emphasisRangeIsCovered(covered, m.index, end)) continue;
        const openLen = m[1].length + 2;
        specs.push({
            kind: 'auto',
            id: null,
            start: m.index,
            openEnd: m.index + openLen,
            closeStart: end,
            end,
            innerText: m[2],
            openPart: `${m[1]}::`,
            closePart: '',
            weight: parseFloat(m[1])
        });
        covered.push({ start: m.index, end });
    }
    EMPHASIS_PATTERNS.weightEmphasisAutoTerminating.lastIndex = 0;

    while ((m = EMPHASIS_PATTERNS.braceEmphasis.exec(text)) !== null) {
        const end = m.index + m[0].length;
        if (emphasisRangeIsCovered(covered, m.index, end)) continue;
        const braceLevel = Math.min(m[1].length, m[3].length);
        specs.push({
            kind: 'brace',
            id: null,
            start: m.index,
            openEnd: m.index + m[1].length,
            closeStart: m.index + m[1].length + m[2].length,
            end,
            innerText: m[2],
            openPart: m[1],
            closePart: m[3],
            weight: weightFromBraceLevel(braceLevel, 'brace')
        });
        covered.push({ start: m.index, end });
    }
    EMPHASIS_PATTERNS.braceEmphasis.lastIndex = 0;

    while ((m = EMPHASIS_PATTERNS.bracketEmphasis.exec(text)) !== null) {
        if (m[0].includes('!') || m[2].includes('|')) continue;
        const end = m.index + m[0].length;
        if (emphasisRangeIsCovered(covered, m.index, end)) continue;
        const bracketLevel = Math.min(m[1].length, m[3].length);
        specs.push({
            kind: 'bracket',
            id: null,
            start: m.index,
            openEnd: m.index + m[1].length,
            closeStart: m.index + m[1].length + m[2].length,
            end,
            innerText: m[2],
            openPart: m[1],
            closePart: m[3],
            weight: weightFromBraceLevel(bracketLevel, 'bracket')
        });
        covered.push({ start: m.index, end });
    }
    EMPHASIS_PATTERNS.bracketEmphasis.lastIndex = 0;

    return specs.sort((a, b) => a.start - b.start);
}

/** Visible/code-unit distance to a boundary, skipping managed invisible glyphs so ZWSP does not inflate “near”. */
function emphasisCaretDistanceToBoundary(value, caret, boundary) {
    const a = Math.min(caret, boundary);
    const b = Math.max(caret, boundary);
    let dist = 0;
    for (let i = a; i < b; i++) {
        const ch = value[i];
        // isManagedInvisibleChar: public/scripts/comp/emphasisGroupIdCodec.js
        if (typeof isManagedInvisibleChar === 'function' && isManagedInvisibleChar(ch)) continue;
        dist++;
    }
    return dist;
}

/**
 * Live weight-group bounds from textarea.value (authoritative for caret sync).
 */
function listEmphasisWeightGroupBoundsForCaret(value) {
    const out = [];
    if (!value) return out;

    if (typeof hasManagedEmphasisGroupIds === 'function'
        && typeof listManagedEmphasisBlocks === 'function'
        && hasManagedEmphasisGroupIds(value)) {
        listManagedEmphasisBlocks(value).forEach((b) => {
            out.push({
                id: b.id,
                start: b.start,
                openEnd: b.openEnd,
                closeStart: b.closeStart,
                end: b.end,
                kind: 'managed'
            });
        });
    }

    let m;
    while ((m = EMPHASIS_PATTERNS.weightEmphasis.exec(value)) !== null) {
        const covered = out.some((b) => m.index >= b.start && m.index < b.end);
        if (covered) continue;
        const openLen = m[1].length + 2;
        out.push({
            id: null,
            start: m.index,
            openEnd: m.index + openLen,
            closeStart: m.index + m[0].length - 2,
            end: m.index + m[0].length,
            kind: 'classic'
        });
    }
    EMPHASIS_PATTERNS.weightEmphasis.lastIndex = 0;

    while ((m = EMPHASIS_PATTERNS.braceEmphasis.exec(value)) !== null) {
        const covered = out.some((b) => m.index >= b.start && m.index < b.end);
        if (covered) continue;
        out.push({
            id: null,
            start: m.index,
            openEnd: m.index + m[1].length,
            closeStart: m.index + m[1].length + m[2].length,
            end: m.index + m[0].length,
            kind: 'brace'
        });
    }
    EMPHASIS_PATTERNS.braceEmphasis.lastIndex = 0;

    while ((m = EMPHASIS_PATTERNS.bracketEmphasis.exec(value)) !== null) {
        if (m[0].includes('!') || m[2].includes('|')) continue;
        const covered = out.some((b) => m.index >= b.start && m.index < b.end);
        if (covered) continue;
        out.push({
            id: null,
            start: m.index,
            openEnd: m.index + m[1].length,
            closeStart: m.index + m[1].length + m[2].length,
            end: m.index + m[0].length,
            kind: 'bracket'
        });
    }
    EMPHASIS_PATTERNS.bracketEmphasis.lastIndex = 0;

    return out.sort((a, b) => a.start - b.start);
}

/**
 * Toggle near-boundary caret chrome on painted weight groups.
 * Tail = typing membership; show when caret is within EMPHASIS_GROUP_CARET_PROXIMITY of that edge.
 */
function syncEmphasisGroupBoundaryCarets(textarea) {
    if (!textarea) return;
    // findPromptEmphasisHighlightOverlay: public/scripts/comp/emphasisParse.js
    const overlay = typeof findPromptEmphasisHighlightOverlay === 'function'
        ? findPromptEmphasisHighlightOverlay(textarea)
        : null;
    if (!overlay) return;

    const CARETS = [
        'emphasis-caret-start-near', 'emphasis-caret-start-in', 'emphasis-caret-start-out',
        'emphasis-caret-end-near', 'emphasis-caret-end-in', 'emphasis-caret-end-out'
    ];
    const spans = [...overlay.querySelectorAll('.emphasis-weight-group')];
    spans.forEach((el) => CARETS.forEach((c) => el.classList.remove(c)));

    if (document.activeElement !== textarea) return;
    if (textarea.selectionStart !== textarea.selectionEnd) return;

    const value = textarea.value || '';
    const caret = textarea.selectionStart;
    // _managedCaretMoveDir: public/scripts/comp/emphasisGroupIdCodec.js
    const leaveDir = Number.isFinite(textarea._managedCaretMoveDir) ? textarea._managedCaretMoveDir : 0;
    const prox = EMPHASIS_GROUP_CARET_PROXIMITY;
    const liveBounds = listEmphasisWeightGroupBoundsForCaret(value);

    const usedSpans = new Set();
    const findSpanForBound = (bound) => {
        if (bound.kind === 'managed' && bound.id != null) {
            const byId = spans.find((el) => !usedSpans.has(el) && el.dataset.empId === String(bound.id));
            if (byId) return byId;
        }
        const byStart = spans.find((el) => !usedSpans.has(el) && Number(el.dataset.empStart) === bound.start);
        if (byStart) return byStart;
        // Fallback: first unused span whose painted range overlaps (stale HTML offsets)
        return spans.find((el) => {
            if (usedSpans.has(el)) return false;
            const s = Number(el.dataset.empStart);
            const e = Number(el.dataset.empEnd);
            if (!Number.isFinite(s) || !Number.isFinite(e)) return !el.dataset.empStart;
            return !(e <= bound.start || s >= bound.end);
        });
    };

    liveBounds.forEach((bound) => {
        const el = findSpanForBound(bound);
        if (!el) return;
        usedSpans.add(el);

        const distStart = Math.min(
            emphasisCaretDistanceToBoundary(value, caret, bound.start),
            emphasisCaretDistanceToBoundary(value, caret, bound.openEnd)
        );
        const distEnd = Math.min(
            emphasisCaretDistanceToBoundary(value, caret, bound.closeStart),
            emphasisCaretDistanceToBoundary(value, caret, bound.end)
        );

        if (distStart <= prox) {
            const startInside = resolveEmphasisCaretEdgeMembership(caret, leaveDir, bound, 'start');
            el.classList.add('emphasis-caret-start-near');
            el.classList.add(startInside ? 'emphasis-caret-start-in' : 'emphasis-caret-start-out');
        }
        if (distEnd <= prox) {
            const endInside = resolveEmphasisCaretEdgeMembership(caret, leaveDir, bound, 'end');
            el.classList.add('emphasis-caret-end-near');
            el.classList.add(endInside ? 'emphasis-caret-end-in' : 'emphasis-caret-end-out');
        }
    });
}

function handleEmphasisGroupCaretSelectionChange() {
    const el = document.activeElement;
    if (!el || el.tagName !== 'TEXTAREA') return;
    if (!el.classList.contains('prompt-textarea') && !el.classList.contains('character-prompt-textarea')) return;
    if (el.closest('.creative-directive-container, .prompt-textarea-container.director-prompt')) return;
    syncEmphasisGroupBoundaryCarets(el);
}

document.addEventListener('selectionchange', handleEmphasisGroupCaretSelectionChange);

function highlightEmphasisInText(text, weightSource) {
    if (!text) return '';

    const weightSpecs = collectEmphasisWeightGroupSpecs(text, weightSource);
    let highlightedText = text;
    const weightPlaceholders = [];

    for (let i = weightSpecs.length - 1; i >= 0; i--) {
        const spec = weightSpecs[i];
        const id = `__EMPWG_${weightPlaceholders.length}__`;
        weightPlaceholders.push({ id, spec });
        highlightedText = highlightedText.slice(0, spec.start) + id + highlightedText.slice(spec.end);
    }

    // Function to calculate dynamic colors based on weight
    function getEmphasisColors(weight) {
        const c = computeEmphasisWeightColor(weight);
        return {
            background: `rgba(${c.r}, ${c.g}, ${c.b}, ${c.backgroundA.toFixed(2)})`,
            border: `rgba(${c.borderR}, ${c.borderG}, ${c.borderB}, ${Math.max(0.32, c.borderA).toFixed(2)})`,
            caret: `rgb(${c.borderR}, ${c.borderG}, ${c.borderB})`
        };
    }

    function ensureEmphasisGroupOutlineBorder(borderCss) {
        return borderCss || 'rgba(232, 232, 232, 0.32)';
    }

    function groupHighlightStyle(colors) {
        const border = ensureEmphasisGroupOutlineBorder(colors.border);
        const caret = colors.caret || 'rgb(232, 232, 232)';
        return `background: ${colors.background}; box-shadow: inset 0 0 0 1px ${border}; --emphasis-group-caret: ${caret};`;
    }

    function wrapWeightGroupHighlight(innerHtml, colors, bounds, extra = {}) {
        let dataAttrs = '';
        if (bounds && Number.isFinite(bounds.start) && Number.isFinite(bounds.end)) {
            const openEnd = Number.isFinite(bounds.openEnd) ? bounds.openEnd : bounds.start;
            const closeStart = Number.isFinite(bounds.closeStart) ? bounds.closeStart : bounds.end;
            dataAttrs = ` data-emp-start="${bounds.start}" data-emp-open-end="${openEnd}" data-emp-close-start="${closeStart}" data-emp-end="${bounds.end}"`;
            if (extra.id != null && Number.isFinite(Number(extra.id))) {
                dataAttrs += ` data-emp-id="${extra.id}"`;
            }
        }
        const openPart = extra.openPart != null ? extra.openPart : '';
        const closePart = extra.closePart != null ? extra.closePart : '';
        const startEdge = '<span class="emphasis-group-edge emphasis-group-edge-start" aria-hidden="true"></span>';
        const endEdge = '<span class="emphasis-group-edge emphasis-group-edge-end" aria-hidden="true"></span>';
        return `<span class="emphasis-highlight emphasis-weight-group"${dataAttrs} style="${groupHighlightStyle(colors)}">${startEdge}${openPart}${innerHtml}${closePart}${endEdge}</span>`;
    }

    function getGroupColors(groupIndex) {
        const colors = [
            { border: 'rgba(255, 99, 132, 0.75)', background: 'rgba(255, 99, 132, 0.1)' },
            { border: 'rgba(54, 162, 235, 0.75)', background: 'rgba(54, 162, 235, 0.1)' },
            { border: 'rgba(255, 205, 86, 0.75)', background: 'rgba(255, 205, 86, 0.1)' },
            { border: 'rgba(75, 192, 192, 0.75)', background: 'rgba(75, 192, 192, 0.1)' },
            { border: 'rgba(153, 102, 255, 0.75)', background: 'rgba(153, 102, 255, 0.1)' },
            { border: 'rgba(255, 159, 64, 0.75)', background: 'rgba(255, 159, 64, 0.1)' },
            { border: 'rgba(199, 199, 199, 0.75)', background: 'rgba(199, 199, 199, 0.1)' },
            { border: 'rgba(83, 102, 255, 0.75)', background: 'rgba(83, 102, 255, 0.1)' }
        ];
        return colors[groupIndex % colors.length];
    }

    function applyNSFWHighlighting(content) {
        const tagPattern = getU1TagPattern();
        if (!tagPattern) return content;

        return content.replace(tagPattern, (match, tag) => {
            const tagIndex = content.indexOf(match);
            const beforeTag = content.substring(0, tagIndex);
            const afterTag = content.substring(tagIndex + match.length);
            const hasSingleColonBefore = beforeTag.endsWith(':') && !beforeTag.endsWith('::');
            const hasSingleColonAfter = afterTag.startsWith(':') && !afterTag.startsWith('::');
            if (hasSingleColonBefore || hasSingleColonAfter) return match;
            return `<span class="emphasis-highlight" style="background: ${NSFW_TAG_HIGHLIGHT.background}; box-shadow: inset 0 0 0 1px ${NSFW_TAG_HIGHLIGHT.ring};">${tag}</span>`;
        });
    }

    function applyNSFWToPlainSegments(html) {
        return html.replace(/([^<]*?)(?=<span class="emphasis-highlight"|$)/g, (match, segment) => {
            if (!segment) return match;
            return applyNSFWHighlighting(segment);
        });
    }

    function applyReplacementSyntaxHighlights(chunk) {
        let out = chunk;
        out = out.replace(EMPHASIS_PATTERNS.bracketedIncrementing, (match) => {
            const backgroundColor = '#e91e63';
            const escapedMatch = match.replace(/!/g, '&#33;')
                .replace(/\[/g, '&#91;')
                .replace(/\]/g, '&#93;')
                .replace(/~/g, '&#126;')
                .replace(/\+/g, '&#43;')
                .replace(/_/g, '&#95;')
                .replace(/#/g, '&#35;');
            return `<span class="emphasis-highlight" style="background: ${backgroundColor}; border-color: ${backgroundColor};">${escapedMatch}</span>`;
        });
        out = out.replace(EMPHASIS_PATTERNS.bracketedReplacement, (match) => {
            const backgroundColor = '#9c27b0';
            const escapedMatch = match.replace(/!/g, '&#33;')
                .replace(/\[/g, '&#91;')
                .replace(/\]/g, '&#93;')
                .replace(/~/g, '&#126;')
                .replace(/\+/g, '&#43;')
                .replace(/_/g, '&#95;');
            return `<span class="emphasis-highlight" style="background: ${backgroundColor}; border-color: ${backgroundColor};">${escapedMatch}</span>`;
        });
        out = out.replace(EMPHASIS_PATTERNS.incrementingSyntax, (match) => {
            const backgroundColor = '#ff9800';
            const escapedMatch = match.replace(/!/g, '&#33;');
            return `<span class="emphasis-highlight" style="background: ${backgroundColor}; border-color: ${backgroundColor};">${escapedMatch}</span>`;
        });
        out = out.replace(EMPHASIS_PATTERNS.pickCombineIncrementing, (match) => {
            const backgroundColor = '#ff9800';
            const escapedMatch = match.replace(/!/g, '&#33;').replace(/~/g, '&#126;').replace(/\+/g, '&#43;').replace(/#/g, '&#35;');
            return `<span class="emphasis-highlight" style="background: ${backgroundColor}; border-color: ${backgroundColor};">${escapedMatch}</span>`;
        });
        out = out.replace(EMPHASIS_PATTERNS.pickIncrementingSuffix, (match) => {
            const backgroundColor = '#f57c00';
            const escapedMatch = match.replace(/!/g, '&#33;').replace(/~/g, '&#126;').replace(/#/g, '&#35;');
            return `<span class="emphasis-highlight" style="background: ${backgroundColor}; border-color: ${backgroundColor};">${escapedMatch}</span>`;
        });
        out = out.replace(EMPHASIS_PATTERNS.pickReplacement, (match) => {
            const backgroundColor = '#628a33';
            const escapedMatch = match.replace(/!/g, '&#33;').replace(/~/g, '&#126;').replace(/\+/g, '&#43;');
            return `<span class="emphasis-highlight" style="background: ${backgroundColor}; border-color: ${backgroundColor};">${escapedMatch}</span>`;
        });
        out = out.replace(EMPHASIS_PATTERNS.regularReplacement, (match) => {
            const backgroundColor = '#8bc34a8a';
            const escapedMatch = match.replace(/!/g, '&#33;');
            return `<span class="emphasis-highlight" style="background: ${backgroundColor}; border-color: ${backgroundColor};">${escapedMatch}</span>`;
        });
        return out;
    }

    function wrapGroupInnerContent(content) {
        let out = escapeEmphasisHighlightText(content);
        out = applyReplacementSyntaxHighlights(out);
        out = applyNSFWToPlainSegments(out);
        return out;
    }

    // Split by | for pipe-group chrome (weight groups already placeholder-protected).
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

    // Step 0: Protect stage-conditional blocks (!-N/, !N+/, !N/)
    const stageConditionalBlocks = [];
    const protectStageBlock = (match) => {
        const blockId = `__STAGE_COND_BLOCK_${stageConditionalBlocks.length}__`;
        stageConditionalBlocks.push({ id: blockId, original: match });
        return blockId;
    };
    highlightedText = highlightedText.replace(/!-(\d+)\/([^\/]*)\//g, protectStageBlock);
    highlightedText = highlightedText.replace(/!(\d+)\+\/([^\/]*)\//g, protectStageBlock);
    highlightedText = highlightedText.replace(/!(\d+)\/([^\/]*)\//g, protectStageBlock);

    // Step 1: Protect disable blocks from further processing
    const disableBlocks = [];
    highlightedText = highlightedText.replace(EMPHASIS_PATTERNS.disableSyntax, (match, exclamation, content) => {
        const blockId = `__DISABLE_BLOCK_${disableBlocks.length}__`;
        disableBlocks.push({
            id: blockId,
            original: match,
            content: content
        });
        return blockId;
    });

    // Highlight text replacements (!KEY, ![...], ~+, etc.)
    highlightedText = applyReplacementSyntaxHighlights(highlightedText);

    // Highlight NSFW tags in remaining text (outside of emphasis blocks)
    highlightedText = applyNSFWToPlainSegments(highlightedText);

    // Step 3: Restore disable blocks with dark gray highlighting
    disableBlocks.forEach(block => {
        const escapedMatch = block.original.replace(/!/g, '&#33;')
                                         .replace(/\//g, '&#47;');

        highlightedText = highlightedText.replace(block.id, 
            `<span class="emphasis-highlight" style="background: ${DISABLE_SYNTAX_HIGHLIGHT.background}; box-shadow: inset 0 0 0 1px ${DISABLE_SYNTAX_HIGHLIGHT.border};">${escapedMatch}</span>`
        );
    });

    // Step 4: Restore stage-conditional blocks
    stageConditionalBlocks.forEach(block => {
        const escapedMatch = block.original.replace(/!/g, '&#33;')
                                         .replace(/\//g, '&#47;');
        highlightedText = highlightedText.replace(block.id,
            `<span class="emphasis-highlight" style="background: ${DISABLE_SYNTAX_HIGHLIGHT.background}; box-shadow: inset 0 0 0 1px ${DISABLE_SYNTAX_HIGHLIGHT.border};">${escapedMatch}</span>`
        );
    });

    // Restore weight groups last — indices/bounds come from raw text scan.
    weightPlaceholders.forEach(({ id, spec }) => {
        const colors = getEmphasisColors(spec.weight);
        const innerHtml = wrapGroupInnerContent(spec.innerText);
        const html = wrapWeightGroupHighlight(innerHtml, colors, spec, {
            id: spec.id,
            openPart: spec.openPart,
            closePart: spec.closePart
        });
        highlightedText = highlightedText.replace(id, html);
    });

    return highlightedText;
}
