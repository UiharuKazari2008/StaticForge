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
    if (currentValue === previousValue) return;

    // Diff to the edited span, then expand to word bounds so char-by-char "nsfw" still hits.
    let start = 0;
    const minLen = Math.min(previousValue.length, currentValue.length);
    while (start < minLen && previousValue.charCodeAt(start) === currentValue.charCodeAt(start)) start++;
    let endOld = previousValue.length;
    let endNew = currentValue.length;
    while (endOld > start && endNew > start
        && previousValue.charCodeAt(endOld - 1) === currentValue.charCodeAt(endNew - 1)) {
        endOld--;
        endNew--;
    }
    let checkStart = start;
    let checkEnd = endNew;
    while (checkStart > 0 && /[A-Za-z0-9_]/.test(currentValue[checkStart - 1])) checkStart--;
    while (checkEnd < currentValue.length && /[A-Za-z0-9_]/.test(currentValue[checkEnd])) checkEnd++;
    const editedSlice = currentValue.slice(checkStart, checkEnd);
    if (!/\bnsfw\b/i.test(editedSlice)) {
        previousTextareaValues.set(textarea, currentValue);
        return;
    }
    // Newly added only — skip if previous already had the word
    if (/\bnsfw\b/i.test(previousValue)) {
        previousTextareaValues.set(textarea, currentValue);
        return;
    }

    // NSFW tag was just added, remove it and set appropriate mode
    let cleanedValue = currentValue.replace(/\bnsfw\b/gi, '').trim();
    cleanedValue = cleanedValue.replace(/\s*,\s*,/g, ',').replace(/^,\s*/, '').replace(/,\s*$/, '');

    // setTextareaValuePreservingUndo: public/scripts/comp/textareaUtils.js
    setTextareaValuePreservingUndo(textarea, cleanedValue);

    let nsfwMode = 1;
    const isUcTextarea = textarea.id === 'manualUc' ||
                       textarea.id === 'manualPromptNegative' ||
                       textarea.classList.contains('uc-textarea') ||
                       textarea.closest('.character-uc-container') ||
                       textarea.getAttribute('data-type') === 'uc' ||
                       (textarea.id && textarea.id.endsWith('_uc'));
    if (isUcTextarea) {
        nsfwMode = -1;
    }

    // selectNsfwValue: public/scripts/comp/manualModalManager.js (or NSFW control)
    selectNsfwValue(nsfwMode);
    previousTextareaValues.set(textarea, cleanedValue);
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
    invalidateEmphasisSpanIndex(overlay);

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
    invalidateEmphasisSpanIndex(overlay);

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

let cachedU1TagMatcher = null;
let cachedU1TagMatcherVersion = null;

/** Cheap stamp so in-place length changes invalidate without holding the array ref. */
function getU1TagsVersion(tags) {
    if (!tags || !tags.length) return null;
    return tags.length + '\0' + tags[0] + '\0' + tags[tags.length - 1];
}

function isU1WordChar(ch) {
    return ch !== undefined && /[A-Za-z0-9_]/.test(ch);
}

/** Same as JS `\b` between index-1 and index (including string ends). */
function isU1WordBoundaryAt(str, index) {
    const left = index > 0 && isU1WordChar(str[index - 1]);
    const right = index < str.length && isU1WordChar(str[index]);
    return left !== right;
}

/**
 * Length-bucket matcher for NSFW u1 tags (longest-first, `\b`…`\b` semantics).
 * Avoids compiling one giant alternation regex on every list identity change.
 */
function getU1TagMatcher() {
    // u1: public/scripts/comp/tagSets.js
    if (typeof u1 === 'undefined' || !u1 || !u1.length) return null;
    const version = getU1TagsVersion(u1);
    if (cachedU1TagMatcher && cachedU1TagMatcherVersion === version) {
        return cachedU1TagMatcher;
    }

    const byLength = new Map();
    for (let i = 0; i < u1.length; i++) {
        const tag = u1[i];
        if (typeof tag !== 'string' || !tag) continue;
        const lower = tag.toLowerCase();
        const len = lower.length;
        let set = byLength.get(len);
        if (!set) {
            set = new Set();
            byLength.set(len, set);
        }
        set.add(lower);
    }
    const lengths = Array.from(byLength.keys()).sort((a, b) => b - a);
    if (!lengths.length) {
        cachedU1TagMatcher = null;
        cachedU1TagMatcherVersion = version;
        return null;
    }

    const matcher = {
        replace(content, onMatch) {
            if (!content) return content;
            const lower = content.toLowerCase();
            let out = '';
            let i = 0;
            while (i < content.length) {
                if (!isU1WordBoundaryAt(content, i)) {
                    out += content[i];
                    i++;
                    continue;
                }
                let matchedLen = 0;
                for (let li = 0; li < lengths.length; li++) {
                    const len = lengths[li];
                    if (i + len > content.length) continue;
                    if (!isU1WordBoundaryAt(content, i + len)) continue;
                    if (byLength.get(len).has(lower.slice(i, i + len))) {
                        matchedLen = len;
                        break;
                    }
                }
                if (matchedLen) {
                    const matched = content.slice(i, i + matchedLen);
                    out += onMatch(matched, i);
                    i += matchedLen;
                } else {
                    out += content[i];
                    i++;
                }
            }
            return out;
        }
    };
    cachedU1TagMatcher = matcher;
    cachedU1TagMatcherVersion = version;
    return matcher;
}

/** @deprecated Prefer getU1TagMatcher — kept name for any external stub. */
function getU1TagPattern() {
    return getU1TagMatcher();
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

/** Insert {start,end} into a start-sorted covered list (binary). */
function emphasisCoveredRangesInsert(ranges, start, end) {
    let lo = 0;
    let hi = ranges.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (ranges[mid].start <= start) lo = mid + 1;
        else hi = mid;
    }
    ranges.splice(lo, 0, { start, end });
}

/**
 * True when [start,end) is inside a covered range.
 * `ranges` must be sorted by start (non-overlapping as built by collect/list).
 * Stops at the first range that starts past the hit.
 */
function emphasisRangeIsCovered(ranges, start, end) {
    let lo = 0;
    let hi = ranges.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (ranges[mid].start <= start) lo = mid + 1;
        else hi = mid;
    }
    if (lo === 0) return false;
    return end <= ranges[lo - 1].end;
}

/** Point coverage: index inside a sorted covered range. */
function emphasisIndexIsCovered(ranges, index) {
    return emphasisRangeIsCovered(ranges, index, index + 1);
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
            emphasisCoveredRangesInsert(covered, b.start, b.end);
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
        emphasisCoveredRangesInsert(covered, m.index, end);
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
        emphasisCoveredRangesInsert(covered, m.index, end);
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
        emphasisCoveredRangesInsert(covered, m.index, end);
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
        emphasisCoveredRangesInsert(covered, m.index, end);
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
    const covered = [];

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
            emphasisCoveredRangesInsert(covered, b.start, b.end);
        });
    }

    let m;
    while ((m = EMPHASIS_PATTERNS.weightEmphasis.exec(value)) !== null) {
        if (emphasisIndexIsCovered(covered, m.index)) continue;
        const openLen = m[1].length + 2;
        const end = m.index + m[0].length;
        out.push({
            id: null,
            start: m.index,
            openEnd: m.index + openLen,
            closeStart: end - 2,
            end,
            kind: 'classic'
        });
        emphasisCoveredRangesInsert(covered, m.index, end);
    }
    EMPHASIS_PATTERNS.weightEmphasis.lastIndex = 0;

    while ((m = EMPHASIS_PATTERNS.braceEmphasis.exec(value)) !== null) {
        if (emphasisIndexIsCovered(covered, m.index)) continue;
        const end = m.index + m[0].length;
        out.push({
            id: null,
            start: m.index,
            openEnd: m.index + m[1].length,
            closeStart: m.index + m[1].length + m[2].length,
            end,
            kind: 'brace'
        });
        emphasisCoveredRangesInsert(covered, m.index, end);
    }
    EMPHASIS_PATTERNS.braceEmphasis.lastIndex = 0;

    while ((m = EMPHASIS_PATTERNS.bracketEmphasis.exec(value)) !== null) {
        if (m[0].includes('!') || m[2].includes('|')) continue;
        if (emphasisIndexIsCovered(covered, m.index)) continue;
        const end = m.index + m[0].length;
        out.push({
            id: null,
            start: m.index,
            openEnd: m.index + m[1].length,
            closeStart: m.index + m[1].length + m[2].length,
            end,
            kind: 'bracket'
        });
        emphasisCoveredRangesInsert(covered, m.index, end);
    }
    EMPHASIS_PATTERNS.bracketEmphasis.lastIndex = 0;

    return out.sort((a, b) => a.start - b.start);
}

const EMPHASIS_CARET_CLASSES = [
    'emphasis-caret-start-near', 'emphasis-caret-start-in', 'emphasis-caret-start-out',
    'emphasis-caret-end-near', 'emphasis-caret-end-in', 'emphasis-caret-end-out'
];
const emphasisCaretBoundsCache = new WeakMap();
let emphasisCaretSyncRaf = 0;

function invalidateEmphasisSpanIndex(overlay) {
    if (!overlay) return;
    overlay._emphasisSpanIndex = null;
    overlay._emphasisCaretMarked = null;
}

function getEmphasisCaretBounds(textarea, value) {
    const cached = emphasisCaretBoundsCache.get(textarea);
    if (cached && cached.value === value) return cached.bounds;
    const bounds = listEmphasisWeightGroupBoundsForCaret(value);
    emphasisCaretBoundsCache.set(textarea, { value, bounds });
    return bounds;
}

function getEmphasisSpanIndex(overlay) {
    if (overlay._emphasisSpanIndex) return overlay._emphasisSpanIndex;
    const list = overlay.querySelectorAll('.emphasis-weight-group');
    const byId = new Map();
    const byStart = new Map();
    for (let i = 0; i < list.length; i++) {
        const el = list[i];
        if (el.dataset.empId) byId.set(el.dataset.empId, el);
        if (el.dataset.empStart) byStart.set(el.dataset.empStart, el);
    }
    const index = { list, byId, byStart };
    overlay._emphasisSpanIndex = index;
    return index;
}

function clearEmphasisCaretMarks(overlay) {
    const marked = overlay._emphasisCaretMarked;
    if (!marked) return;
    for (let i = 0; i < marked.length; i++) {
        marked[i].classList.remove(...EMPHASIS_CARET_CLASSES);
    }
    overlay._emphasisCaretMarked = null;
}

function emphasisBoundNearCaret(value, caret, bound, prox, skipInvisible) {
    const rawStart = Math.min(Math.abs(caret - bound.start), Math.abs(caret - bound.openEnd));
    const rawEnd = Math.min(Math.abs(caret - bound.closeStart), Math.abs(caret - bound.end));
    const rawBudget = skipInvisible ? prox + 64 : prox;
    if (rawStart > rawBudget && rawEnd > rawBudget) return null;

    const distStart = Math.min(
        emphasisCaretDistanceToBoundary(value, caret, bound.start),
        emphasisCaretDistanceToBoundary(value, caret, bound.openEnd)
    );
    const distEnd = Math.min(
        emphasisCaretDistanceToBoundary(value, caret, bound.closeStart),
        emphasisCaretDistanceToBoundary(value, caret, bound.end)
    );
    if (distStart > prox && distEnd > prox) return null;
    return { distStart, distEnd };
}

function findEmphasisSpanForBound(index, bound, used) {
    if (bound.kind === 'managed' && bound.id != null) {
        const byId = index.byId.get(String(bound.id));
        if (byId && !used.has(byId)) return byId;
    }
    const byStart = index.byStart.get(String(bound.start));
    if (byStart && !used.has(byStart)) return byStart;
    for (let i = 0; i < index.list.length; i++) {
        const el = index.list[i];
        if (used.has(el)) continue;
        const s = Number(el.dataset.empStart);
        const e = Number(el.dataset.empEnd);
        if (!Number.isFinite(s) || !Number.isFinite(e)) {
            if (!el.dataset.empStart) return el;
            continue;
        }
        if (!(e <= bound.start || s >= bound.end)) return el;
    }
    return null;
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

    clearEmphasisCaretMarks(overlay);
    if (document.activeElement !== textarea) return;
    if (textarea.selectionStart !== textarea.selectionEnd) return;

    const value = textarea.value || '';
    const caret = textarea.selectionStart;
    const bounds = getEmphasisCaretBounds(textarea, value);
    if (!bounds.length) return;

    // hasManagedEmphasisGroupIds: public/scripts/comp/emphasisGroupIdCodec.js
    const skipInvisible = hasManagedEmphasisGroupIds(value);
    // _managedCaretMoveDir: public/scripts/comp/emphasisGroupIdCodec.js
    const leaveDir = Number.isFinite(textarea._managedCaretMoveDir) ? textarea._managedCaretMoveDir : 0;
    const prox = EMPHASIS_GROUP_CARET_PROXIMITY;
    const index = getEmphasisSpanIndex(overlay);
    const used = new Set();
    const marked = [];

    for (let i = 0; i < bounds.length; i++) {
        const bound = bounds[i];
        const near = emphasisBoundNearCaret(value, caret, bound, prox, skipInvisible);
        if (!near) continue;
        const el = findEmphasisSpanForBound(index, bound, used);
        if (!el) continue;
        used.add(el);
        marked.push(el);

        if (near.distStart <= prox) {
            const startInside = resolveEmphasisCaretEdgeMembership(caret, leaveDir, bound, 'start');
            el.classList.add('emphasis-caret-start-near');
            el.classList.add(startInside ? 'emphasis-caret-start-in' : 'emphasis-caret-start-out');
        }
        if (near.distEnd <= prox) {
            const endInside = resolveEmphasisCaretEdgeMembership(caret, leaveDir, bound, 'end');
            el.classList.add('emphasis-caret-end-near');
            el.classList.add(endInside ? 'emphasis-caret-end-in' : 'emphasis-caret-end-out');
        }
    }

    if (marked.length) overlay._emphasisCaretMarked = marked;
}

function flushEmphasisGroupCaretSync() {
    emphasisCaretSyncRaf = 0;
    const el = document.activeElement;
    if (!el || el.tagName !== 'TEXTAREA') return;
    if (!el.classList.contains('prompt-textarea') && !el.classList.contains('character-prompt-textarea')) return;
    if (el.closest('.creative-directive-container, .prompt-textarea-container.director-prompt')) return;

    const key = el.selectionStart + '\0' + el.selectionEnd + '\0' + (el.value || '');
    if (el._emphasisCaretSyncKey === key) return;
    el._emphasisCaretSyncKey = key;
    // capturePromptTextareaSelection: public/scripts/comp/emphasisSelection.js
    capturePromptTextareaSelection(el, { clearIfCollapsed: true });
    syncEmphasisGroupBoundaryCarets(el);
}

function handleEmphasisGroupCaretSelectionChange() {
    const el = document.activeElement;
    if (!el || el.tagName !== 'TEXTAREA') return;
    if (!el.classList.contains('prompt-textarea') && !el.classList.contains('character-prompt-textarea')) return;
    if (emphasisCaretSyncRaf) return;
    emphasisCaretSyncRaf = requestAnimationFrame(flushEmphasisGroupCaretSync);
}

document.addEventListener('selectionchange', handleEmphasisGroupCaretSelectionChange);

function highlightEmphasisInText(text, weightSource) {
    if (!text) return '';

    const weightSpecs = collectEmphasisWeightGroupSpecs(text, weightSource);
    const weightPlaceholders = [];
    // One forward pass: plain slices + placeholder ids (no reverse whole-string slice per group).
    let highlightedText;
    if (!weightSpecs.length) {
        highlightedText = text;
    } else {
        const chunks = [];
        let cursor = 0;
        for (let i = 0; i < weightSpecs.length; i++) {
            const spec = weightSpecs[i];
            if (spec.start > cursor) chunks.push(text.slice(cursor, spec.start));
            const id = `__EMPWG_${i}__`;
            weightPlaceholders.push({ id, spec });
            chunks.push(id);
            cursor = spec.end;
        }
        if (cursor < text.length) chunks.push(text.slice(cursor));
        highlightedText = chunks.join('');
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
        const matcher = getU1TagMatcher();
        if (!matcher) return content;

        return matcher.replace(content, (match, offset) => {
            // Colon neighbors from match index — no indexOf rescan of the whole segment.
            const before = offset > 0 ? content[offset - 1] : '';
            const after = content[offset + match.length] || '';
            const hasSingleColonBefore = before === ':' && (offset < 2 || content[offset - 2] !== ':');
            const hasSingleColonAfter = after === ':' && content[offset + match.length + 1] !== ':';
            if (hasSingleColonBefore || hasSingleColonAfter) return match;
            return `<span class="emphasis-highlight" style="background: ${NSFW_TAG_HIGHLIGHT.background}; box-shadow: inset 0 0 0 1px ${NSFW_TAG_HIGHLIGHT.ring};">${match}</span>`;
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
