// Global variables for emphasis editing (toolbar mode only)

// Global variables for emphasis editing
let emphasisEditingActive = false;
let emphasisEditingValue = 1.0;
let emphasisEditingTarget = null;
let emphasisEditingSelection = null;
let emphasisEditingMode = 'normal'; // 'normal', 'brace', 'group'
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
        emphasisEditingMode: (v) => { emphasisEditingMode = v; }
    };
    Object.keys(state).forEach((name) => {
        Object.defineProperty(window, name, {
            get: state[name],
            set: setters[name],
            configurable: true
        });
    });
})();

const EMPHASIS_WEIGHT_MIN = -6;
const EMPHASIS_WEIGHT_MAX = 6;
const EMPHASIS_WEIGHT_STEP = 0.1;
const EMPHASIS_WEIGHT_FINE_STEP = 0.01;
const DISABLE_SYNTAX_HIGHLIGHT = {
    background: 'rgba(175, 175, 175, 0.92)',
    border: 'rgba(231, 231, 231, 0.95)'
};

function clampEmphasisWeight(value) {
    const n = typeof value === 'string' ? parseFloat(value) : value;
    if (isNaN(n)) return 1.0;
    const clamped = Math.max(EMPHASIS_WEIGHT_MIN, Math.min(EMPHASIS_WEIGHT_MAX, n));
    return Math.round(clamped * 100) / 100;
}

function formatEmphasisWeight(value) {
    if (value === '---') return '---';
    // Auto precision up to 2 decimals: 1, 1.3, 1.54 (not 1.00, 1.30)
    return String(parseFloat(clampEmphasisWeight(value).toFixed(2)));
}

/** Toolbar display: always 1 decimal; 2 when value uses 0.01 precision. */
function formatEmphasisWeightDisplay(value) {
    if (value === '---') return '---';
    const n = clampEmphasisWeight(value);
    const oneDecimal = Math.round(n * 10) / 10;
    const twoDecimal = Math.round(n * 100) / 100;
    if (Math.abs(twoDecimal - oneDecimal) > 0.0001) {
        return twoDecimal.toFixed(2);
    }
    return oneDecimal.toFixed(1);
}

function getEmphasisAdjustStep(shiftKey) {
    return shiftKey ? EMPHASIS_WEIGHT_FINE_STEP : EMPHASIS_WEIGHT_STEP;
}

const EMPHASIS_BRACE_BLOCK_PATTERN = /(\{+)([^{}]*)\}+|(\[+)([^\[]*)\]+/g;
const EMPHASIS_WEIGHT_PART = '-?\\d+(?:\\.\\d+)?';

function createEmphasisTraditionalPattern() {
    return new RegExp(`(${EMPHASIS_WEIGHT_PART})::(.+?)::`, 'g');
}

function createEmphasisAutoTerminatingPattern() {
    return new RegExp(`(${EMPHASIS_WEIGHT_PART})::(.+?)(?=\\s*${EMPHASIS_WEIGHT_PART}::|$)`, 'g');
}

const EMPHASIS_NEXT_GROUP_PATTERN = new RegExp(`(?:,\\s*|\\s+)${EMPHASIS_WEIGHT_PART}::`);

/** Parse emphasis blocks without treating the next group's weight:: as this block's closing ::. */
function listEmphasisBlocks(value) {
    const blocks = [];
    let searchFrom = 0;

    while (searchFrom < value.length) {
        const openRe = new RegExp(`${EMPHASIS_WEIGHT_PART}::`, 'g');
        openRe.lastIndex = searchFrom;
        const open = openRe.exec(value);
        if (!open) break;

        const start = open.index;
        const weightStr = open[0].slice(0, -2);
        const contentStart = start + open[0].length;
        const tail = value.substring(contentStart);

        const nextGroupMatch = tail.match(EMPHASIS_NEXT_GROUP_PATTERN);
        const nextGroupAt = nextGroupMatch ? nextGroupMatch.index : -1;
        const closeAt = tail.indexOf('::');

        let innerText;
        let end;
        let needsTerminator = false;

        if (closeAt >= 0 && (nextGroupAt < 0 || closeAt < nextGroupAt)) {
            innerText = tail.substring(0, closeAt);
            end = contentStart + closeAt + 2;
            needsTerminator = true;
        } else if (nextGroupAt >= 0) {
            innerText = tail.substring(0, nextGroupAt).replace(/\s+$/, '');
            end = contentStart + nextGroupAt;
            needsTerminator = false;
        } else {
            innerText = tail;
            end = value.length;
            needsTerminator = false;
        }

        const match = [value.substring(start, end), weightStr, innerText];
        match.index = start;

        blocks.push({
            start,
            end,
            weight: parseFloat(weightStr),
            weightStr,
            innerText,
            needsTerminator,
            match
        });

        searchFrom = end;
    }

    return blocks;
}

function parseEmphasisBlockSpan(blockText) {
    const traditional = new RegExp(`^(${EMPHASIS_WEIGHT_PART})::(.+)::$`);
    const autoTerminating = new RegExp(`^(${EMPHASIS_WEIGHT_PART})::(.+)$`);
    const tradMatch = blockText.match(traditional);
    if (tradMatch) {
        return {
            weight: parseFloat(tradMatch[1]),
            innerText: tradMatch[2],
            needsTerminator: true
        };
    }
    const autoMatch = blockText.match(autoTerminating);
    if (autoMatch) {
        return {
            weight: parseFloat(autoMatch[1]),
            innerText: autoMatch[2],
            needsTerminator: false
        };
    }
    return null;
}

function extractEmphasisInnerForRemoval(value, selStart, selEnd) {
    const overlap = findEmphasisBlockOverlappingSelection(value, selStart, selEnd);
    if (overlap) {
        return { start: overlap.start, end: overlap.end, innerText: overlap.innerText };
    }
    const parsed = parseEmphasisBlockSpan(value.substring(selStart, selEnd).trim());
    if (parsed) {
        return { start: selStart, end: selEnd, innerText: parsed.innerText };
    }
    return null;
}

/** When removing a group that auto-terminated the previous one, insert closing :: for the prior group. */
function resolveEmphasisRemovalSpan(value, blockStart, blockEnd, innerText) {
    const blocks = listEmphasisBlocks(value);
    let blockIndex = blocks.findIndex((b) => b.start === blockStart && b.end === blockEnd);
    if (blockIndex < 0) {
        blockIndex = blocks.findIndex((b) => blockStart >= b.start && blockEnd <= b.end);
        if (blockIndex >= 0) {
            blockStart = blocks[blockIndex].start;
            blockEnd = blocks[blockIndex].end;
            innerText = blocks[blockIndex].innerText;
        }
    }

    let replaceStart = blockStart;
    let replaceEnd = blockEnd;
    let replacementText = innerText;

    if (blockIndex > 0) {
        const prevBlock = blocks[blockIndex - 1];
        const currentBlock = blocks[blockIndex];
        if (!prevBlock.needsTerminator) {
            const between = value.substring(prevBlock.end, currentBlock.start);
            if (/^\s+$/.test(between)) {
                replacementText = (between.endsWith(' ') ? ':: ' : '::') + innerText;
            } else if (between === ', ') {
                replaceStart = prevBlock.end;
                replacementText = '::, ' + innerText;
            } else if (between === ',') {
                replaceStart = prevBlock.end;
                replacementText = '::,' + innerText;
            } else if (/^,\s+$/.test(between)) {
                replaceStart = prevBlock.end;
                replacementText = '::, ' + innerText;
            }
        }
    }

    return { replaceStart, replaceEnd, replacementText };
}

function findEmphasisBlockAtCursor(value, cursorPosition) {
    for (const block of listEmphasisBlocks(value)) {
        if (cursorPosition >= block.start && cursorPosition < block.end) {
            return {
                start: block.start,
                end: block.end,
                weight: block.weight,
                match: block.match
            };
        }
    }
    return null;
}

function forEachEmphasisBlockInValue(value, callback) {
    for (const block of listEmphasisBlocks(value)) {
        callback(block.match, block.start, block.end);
    }
}

function weightFromBraceBlockText(blockText) {
    const openBraces = blockText.match(/^\{+/);
    if (openBraces) {
        const closeBraces = blockText.match(/\}+$/);
        const level = Math.min(openBraces[0].length, closeBraces ? closeBraces[0].length : 0);
        return 1.0 + (level * 0.1);
    }
    const openBrackets = blockText.match(/^\[+/);
    if (openBrackets) {
        const closeBrackets = blockText.match(/\]+$/);
        const level = Math.min(openBrackets[0].length, closeBrackets ? closeBrackets[0].length : 0);
        return 1.0 - (level * 0.1);
    }
    return 1.0;
}

/** Braces only support 0.1 weight steps — snap and reject 0.01 precision. */
function snapWeightForBraceMode(weight) {
    return Math.round(clampEmphasisWeight(weight) * 10) / 10;
}

function buildBraceEmphasisText(innerText, weight) {
    const w = snapWeightForBraceMode(weight);
    if (w > 1.0) {
        const count = Math.round((w - 1.0) * 10);
        if (count <= 0) return innerText;
        const braces = '{'.repeat(count);
        return `${braces}${innerText}${'}'.repeat(count)}`;
    }
    if (w < 1.0) {
        const count = Math.round((1.0 - w) * 10);
        if (count <= 0) return innerText;
        const brackets = '['.repeat(count);
        return `${brackets}${innerText}${']'.repeat(count)}`;
    }
    return innerText;
}

function normalizeEmphasisInnerText(innerText) {
    return String(innerText || '').trim().replace(/\s+/g, ' ');
}

function buildEmphasisTargetKey(target) {
    const kind = target.type === 'brace' ? (target.braceKind || 'brace') : 'group';
    return `${target.type}|${kind}|${normalizeEmphasisInnerText(target.innerText)}`;
}

function isSpanInsideGroupSpan(start, end, groupSpans) {
    for (const g of groupSpans) {
        if (start >= g.start && end <= g.end) return true;
    }
    return false;
}

function listBraceEmphasisTargets(value, groupSpans) {
    const targets = [];
    const pattern = new RegExp(EMPHASIS_BRACE_BLOCK_PATTERN.source, 'g');
    let match;
    while ((match = pattern.exec(value)) !== null) {
        const start = match.index;
        const end = start + match[0].length;
        if (isSpanInsideGroupSpan(start, end, groupSpans)) continue;

        let braceKind;
        let innerText;
        if (match[1]) {
            braceKind = 'brace';
            innerText = match[2];
        } else {
            braceKind = 'bracket';
            innerText = match[4];
        }

        targets.push({
            type: 'brace',
            start,
            end,
            weight: weightFromBraceBlockText(match[0]),
            innerText,
            braceKind
        });
    }
    return targets;
}

/** All emphasis targets (weight:: groups + brace/bracket blocks outside groups), sorted by start. */
function listAllEmphasisTargets(value) {
    if (!value) return [];

    const groups = listEmphasisBlocks(value).map((b) => ({
        type: 'group',
        start: b.start,
        end: b.end,
        weight: b.weight,
        innerText: b.innerText,
        needsTerminator: b.needsTerminator
    }));

    const groupSpans = groups.map((g) => ({ start: g.start, end: g.end }));
    const braces = listBraceEmphasisTargets(value, groupSpans);

    return [...groups, ...braces].sort((a, b) => a.start - b.start);
}

function buildEmphasisTargetText(target, weight) {
    if (target.type === 'brace') {
        return buildBraceEmphasisText(target.innerText, weight);
    }
    const weightStr = formatEmphasisWeight(weight);
    if (target.needsTerminator) {
        return `${weightStr}::${target.innerText}::`;
    }
    return `${weightStr}::${target.innerText}`;
}

function applyEmphasisTargetWeights(value, weightByIndex) {
    const targets = listAllEmphasisTargets(value);
    if (!targets.length) return value;

    let result = '';
    let lastEnd = 0;
    targets.forEach((target, idx) => {
        result += value.substring(lastEnd, target.start);
        const weight = weightByIndex.has(idx) ? weightByIndex.get(idx) : target.weight;
        result += buildEmphasisTargetText(target, weight);
        lastEnd = target.end;
    });
    result += value.substring(lastEnd);
    return result;
}

function rebalanceEmphasisShares(shares, changedIndex, newShare, activeIndices) {
    const result = shares.slice();
    const clampedShare = Math.max(0, Math.min(100, newShare));
    result[changedIndex] = clampedShare;

    const others = activeIndices.filter((i) => i !== changedIndex);
    if (!others.length) return result;

    const remaining = 100 - clampedShare;
    const othersSum = others.reduce((sum, i) => sum + (shares[i] || 0), 0);

    if (othersSum <= 0) {
        const each = remaining / others.length;
        others.forEach((i) => { result[i] = each; });
    } else {
        others.forEach((i) => {
            result[i] = ((shares[i] || 0) / othersSum) * remaining;
        });
    }
    return result;
}

function sharesToWeights(shares, min, max, activeIndices) {
    const active = activeIndices && activeIndices.length
        ? activeIndices
        : shares.map((_, i) => i);
    const sum = active.reduce((s, i) => s + (shares[i] || 0), 0);
    const weights = [];
    const range = max - min;

    if (sum <= 0) {
        active.forEach((i) => { weights[i] = clampEmphasisWeight(min); });
        return weights;
    }

    active.forEach((i) => {
        weights[i] = clampEmphasisWeight(min + ((shares[i] || 0) / sum) * range);
    });
    return weights;
}

function weightToShare(weight, min, max) {
    const range = max - min;
    if (range <= 0) return 100;
    const w = clampEmphasisWeight(weight);
    return Math.max(0, Math.min(100, ((w - min) / range) * 100));
}

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

/** RGB + overlay alpha for one emphasis weight; extremes stay hue-distinct (+6 hot red, -6 strong blue). */
function computeEmphasisWeightColor(weight) {
    const w = typeof weight === 'string' ? parseFloat(weight) : weight;
    if (isNaN(w)) {
        return { r: 232, g: 232, b: 232, borderR: 232, borderG: 232, borderB: 232, backgroundA: 0, borderA: 0 };
    }

    const lerp = (a, b, t) => Math.round(a + (b - a) * t);
    const P = {
        GREEN: { r: 45, g: 215, b: 65 },
        ORANGE: { r: 255, g: 130, b: 25 },
        NEUTRAL: { r: 232, g: 232, b: 232 },
        LIGHT_BLUE: { r: 110, g: 195, b: 255 },
        STRONG_BLUE: { r: 15, g: 95, b: 255 },
        BRIGHT_RED: { r: 255, g: 55, b: 45 },
        INTENSE_RED: { r: 255, g: 12, b: 20 }
    };

    let r;
    let g;
    let b;
    let borderR;
    let borderG;
    let borderB;
    let backgroundA;
    let borderA;

    if (w >= 1.0) {
        if (w <= 1.0) {
            r = P.NEUTRAL.r;
            g = P.NEUTRAL.g;
            b = P.NEUTRAL.b;
            borderR = P.NEUTRAL.r;
            borderG = P.NEUTRAL.g;
            borderB = P.NEUTRAL.b;
            backgroundA = 0;
            borderA = 0;
        } else if (w < 2.0) {
            const t = Math.min(w - 1.0, 1.0);
            r = lerp(P.NEUTRAL.r, P.BRIGHT_RED.r, t);
            g = lerp(P.NEUTRAL.g, P.BRIGHT_RED.g, t);
            b = lerp(P.NEUTRAL.b, P.BRIGHT_RED.b, t);
            borderR = r;
            borderG = g;
            borderB = b;
            backgroundA = t * 0.58;
            borderA = t * 0.78;
        } else {
            const t = Math.min((w - 2.0) / (EMPHASIS_WEIGHT_MAX - 2.0), 1.0);
            // Higher positive = hotter, more saturated red (not muddy dark)
            r = lerp(P.BRIGHT_RED.r, P.INTENSE_RED.r, t);
            g = lerp(P.BRIGHT_RED.g, P.INTENSE_RED.g, t);
            b = lerp(P.BRIGHT_RED.b, P.INTENSE_RED.b, t);
            backgroundA = 0.55 + (0.42 * t);
            borderR = 255;
            borderG = lerp(100, 45, t);
            borderB = lerp(80, 35, t);
            borderA = 0.78 + (0.17 * t);
        }
    } else if (w > 0.0) {
        const t = w;
        r = lerp(P.GREEN.r, P.ORANGE.r, t);
        g = lerp(P.GREEN.g, P.ORANGE.g, t);
        b = lerp(P.GREEN.b, P.ORANGE.b, t);
        backgroundA = 0.52 * (1 - t);
        borderR = Math.min(255, r + 45);
        borderG = Math.min(255, g + 35);
        borderB = Math.min(255, b + 40);
        borderA = Math.min(1.0, backgroundA + 0.28);
    } else if (w === 0.0) {
        r = P.GREEN.r;
        g = P.GREEN.g;
        b = P.GREEN.b;
        backgroundA = 0.50;
        borderR = 85;
        borderG = 245;
        borderB = 95;
        borderA = 0.80;
    } else if (w > -1.0) {
        const t = Math.abs(w);
        r = lerp(P.GREEN.r, P.LIGHT_BLUE.r, t);
        g = lerp(P.GREEN.g, P.LIGHT_BLUE.g, t);
        b = lerp(P.GREEN.b, P.LIGHT_BLUE.b, t);
        backgroundA = 0.46 + (0.24 * t);
        borderR = Math.min(255, r + 45);
        borderG = Math.min(255, g + 35);
        borderB = Math.min(255, b + 40);
        borderA = Math.min(1.0, backgroundA + 0.30);
    } else {
        const t = Math.min((Math.abs(w) - 1.0) / (Math.abs(EMPHASIS_WEIGHT_MIN) - 1.0), 1.0);
        // More negative = deeper cool blue (not murky navy that reads like dark red)
        r = lerp(P.LIGHT_BLUE.r, P.STRONG_BLUE.r, t);
        g = lerp(P.LIGHT_BLUE.g, P.STRONG_BLUE.g, t);
        b = lerp(P.LIGHT_BLUE.b, P.STRONG_BLUE.b, t);
        backgroundA = 0.45 + (0.48 * t);
        borderR = lerp(140, 40, t);
        borderG = lerp(215, 130, t);
        borderB = 255;
        borderA = 0.72 + (0.23 * t);
    }

    return { r, g, b, borderR, borderG, borderB, backgroundA, borderA };
}

/** Programmatic input after emphasis edits; skipAutofill avoids opening autofill overlay. */
function dispatchPromptTextareaInputEvent(target, options = {}) {
    if (!target) return;
    if (options.skipAutofill) {
        target.dispatchEvent(new CustomEvent('input', { bubbles: true, detail: { skipAutofill: true } }));
        return;
    }
    target.dispatchEvent(new Event('input', { bubbles: true }));
}

/** UC tab stacks two fields in one container; each textarea lives in .prompt-textarea-emphasis-wrap (app.html). */
function getPromptTextareaOverlayHost(textarea) {
    const p = textarea && textarea.parentElement;
    if (p && p.classList.contains('prompt-textarea-emphasis-wrap')) {
        return p;
    }
    return p;
}

function findPromptEmphasisHighlightOverlay(textarea) {
    const host = getPromptTextareaOverlayHost(textarea);
    return host ? host.querySelector(':scope > .emphasis-highlight-overlay') : null;
}

function ensurePromptEmphasisHighlightOverlay(textarea) {
    const host = getPromptTextareaOverlayHost(textarea);
    if (!host) return null;

    let overlay = host.querySelector(':scope > .emphasis-highlight-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'emphasis-highlight-overlay';
        host.insertBefore(overlay, textarea);
        return overlay;
    }

    if (textarea.parentElement === host && overlay.nextSibling !== textarea) {
        host.insertBefore(overlay, textarea);
    }
    return overlay;
}

function ensurePromptSearchHighlightOverlay(textarea) {
    const host = getPromptTextareaOverlayHost(textarea);
    if (!host) return null;

    let overlay = host.querySelector(':scope > .search-highlight-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'search-highlight-overlay';
        host.insertBefore(overlay, textarea);
        return overlay;
    }

    if (textarea.parentElement === host && overlay.nextSibling !== textarea) {
        host.insertBefore(overlay, textarea);
    }
    return overlay;
}

// Function to check if cursor is inside an emphasis block
function isCursorInsideEmphasisBlock(target) {
    if (!target) return null;
    
    const value = target.value;
    const cursorPosition = target.selectionStart;
    
    // First check for auto-terminating emphasis blocks: number::text (without closing ::)
    const autoTerminatingPattern = /(-?\d+(?:\.\d+)?)::(.+?)(?=\s*-?\d+\.?\d*::|::|$)/g;
    let match;
    
    while ((match = autoTerminatingPattern.exec(value)) !== null) {
        const blockStart = match.index;
        const blockEnd = match.index + match[0].length;
        
        // Check if cursor is inside this emphasis block
        if (cursorPosition >= blockStart && cursorPosition <= blockEnd) {
            return {
                start: blockStart,
                end: blockEnd,
                weight: match[1],
                text: match[2],
                fullMatch: match[0],
                isAutoTerminating: true
            };
        }
    }
    
    // Then check for traditional emphasis blocks in the format: number::text::
    const emphasisPattern = /(-?\d+(?:\.\d+)?)::(.+?)::/g;
    
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
                fullMatch: match[0],
                isAutoTerminating: false
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
    
    // setTextareaValuePreservingUndo: public/scripts/comp/textareaUtils.js
    setTextareaValuePreservingUndo(target, newValue);
    
    // Position cursor after the inserted emphasis syntax
    const newCursorPosition = cursorPosition + emphasisInsert.length;
    target.setSelectionRange(newCursorPosition, newCursorPosition);
    
    // Trigger input event to update any dependent UI
    dispatchPromptTextareaInputEvent(target, { skipAutofill: true });
    
    return true;
}

// Function to determine if a terminator (::) should be added
function shouldAddTerminator(text, selectionEnd, options = {}) {
    const { allowAutoTerminationByNextGroup = true } = options;
    // Get text after the selection
    const textAfter = text.substring(selectionEnd);
    
    // Skip whitespace and commas at the beginning
    const trimmedAfter = textAfter.replace(/^[\s,]+/, '');
    
    // If there's no meaningful text after, we need a terminator
    if (!trimmedAfter) {
        return true;
    }
    
    // If the next meaningful text starts with a number followed by ::, we can skip the
    // closing terminator when auto-termination is allowed.
    const nextEmphasisPattern = /^-?\d+\.?\d*::/;
    if (allowAutoTerminationByNextGroup && nextEmphasisPattern.test(trimmedAfter)) {
        return false;
    }
    
    // If the next meaningful text starts with ::, we don't need a terminator
    if (trimmedAfter.startsWith('::')) {
        return false;
    }
    
    // Otherwise, we need a terminator to prevent the emphasis from continuing
    return true;
}

// Function to check if we're at the end of an existing group
function isAtEndOfExistingGroup(text, selectionStart) {
    // Look backwards from the selection start to find if we're at the end of a group
    const textBefore = text.substring(0, selectionStart);
    
    // Check if we're right after a closing :: (end of traditional emphasis group)
    if (textBefore.endsWith('::')) {
        return true;
    }
    
    // Check if we're right after an auto-terminating emphasis block
    // Look for pattern: number::text (without closing ::) followed by whitespace/comma
    const autoTerminatingPattern = /(-?\d+\.?\d*)::(.+?)(?=\s*-?\d+\.?\d*::|::|$)/g;
    let match;
    let lastMatchEnd = -1;
    
    while ((match = autoTerminatingPattern.exec(textBefore)) !== null) {
        lastMatchEnd = match.index + match[0].length;
    }
    
    // If the last auto-terminating emphasis block ends right before our selection
    if (lastMatchEnd === selectionStart) {
        return true;
    }
    
    return false;
}

// Function to get information about the previous group
function getPreviousGroupInfo(text, selectionStart) {
    const textBefore = text.substring(0, selectionStart);
    
    // Check if we're right after a closing :: (end of traditional emphasis group)
    if (textBefore.endsWith('::') || textBefore.endsWith('::,') || textBefore.endsWith(':: ')) {
        // Find the previous traditional emphasis group
        const traditionalPattern = /(-?\d+\.?\d*)::(.+?)::/g;
        let match;
        let lastMatch = null;
        
        while ((match = traditionalPattern.exec(textBefore)) !== null) {
            lastMatch = match;
        }
        
        if (lastMatch) {
            return {
                isAtEndOfGroup: true,
                previousWeight: lastMatch[1]
            };
        }
    }
    
    // Check if we're right after an auto-terminating emphasis block
    const autoTerminatingPattern = /(-?\d+\.?\d*)::(.+?)(?=\s*-?\d+\.?\d*::|::|$)/g;
    let match;
    let lastMatch = null;
    let lastMatchEnd = -1;
    
    while ((match = autoTerminatingPattern.exec(textBefore)) !== null) {
        lastMatch = match;
        lastMatchEnd = match.index + match[0].length;
    }
    
    // If the last auto-terminating emphasis block ends right before our selection
    if (lastMatch && lastMatchEnd === selectionStart) {
        return {
            isAtEndOfGroup: true,
            previousWeight: lastMatch[1]
        };
    }
    
    return {
        isAtEndOfGroup: false,
        previousWeight: null
    };
}

// Function to apply emphasis directly to selected text
function applyEmphasisDirectly(target, weight, mode = 'normal') {
    if (!target) {
        console.log('No target provided');
        return false;
    }
    
    const value = target.value;
    const selectionStart = target.selectionStart;
    const selectionEnd = target.selectionEnd;
    
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
    // This includes patterns like "2", "2.05", "1.5", "-3.14", etc.
    const pureNumberPattern = /^-?\d+(\.\d+)?$/;
    if (pureNumberPattern.test(selectedText)) {
        console.log('Selected text is a pure number, not applying emphasis:', selectedText);
        return false; // Don't apply emphasis to pure numbers
    }
    
    // Check if selected text is a number followed by "::" (part of emphasis syntax)
    const numberWithColonsPattern = /^-?\d+(\.\d+)?::$/;
    if (numberWithColonsPattern.test(selectedText)) {
        console.log('Selected text is a number with colons, not applying emphasis:', selectedText);
        return false; // Don't apply emphasis to numbers that are part of emphasis weights
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
    numericWeight = clampEmphasisWeight(numericWeight);
    if (mode === 'brace') {
        numericWeight = snapWeightForBraceMode(numericWeight);
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
        emphasizedText = `${formattedWeight}::${innerText}${overlappingGroup.needsTerminator ? '::' : ''}`;
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
            emphasizedText = `${formattedWeight}::${innerText}${needsTerminator ? '::' : ''}`;
        } else if (mode === 'group') {
            const needsTerminator = shouldAddTerminator(value, selectionEnd, {
                allowAutoTerminationByNextGroup: false
            });
            emphasizedText = `${formattedWeight}::${selectedText}${needsTerminator ? '::' : ''}`;
        } else {
            const needsTerminator = shouldAddTerminator(value, selectionEnd, {
                allowAutoTerminationByNextGroup: false
            });
            emphasizedText = `${formattedWeight}::${selectedText}${needsTerminator ? '::' : ''}`;
        }
    }

    const beforeText = value.substring(0, replaceStart);
    const afterText = value.substring(replaceEnd);
    const newValue = beforeText + emphasizedText + afterText;
    
    console.log('Replacing text:', { 
        original: value.substring(selectionStart, selectionEnd),
        emphasized: emphasizedText,
        newValue: newValue.substring(0, 100) + '...'
    });
    
    // setTextareaValuePreservingUndo: public/scripts/comp/textareaUtils.js
    setTextareaValuePreservingUndo(target, newValue);
    
    // Set cursor position after the emphasized text
    const newCursorPosition = replaceStart + emphasizedText.length;
    target.setSelectionRange(newCursorPosition, newCursorPosition);
    
    // Trigger input event to update any dependent UI
    dispatchPromptTextareaInputEvent(target, { skipAutofill: true });
    hideCharacterAutocomplete();

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
        start: replaceStart,
        end: replaceStart + emphasizedText.length
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
    const braceHit = findEmphasisBraceBlockAtCursor(value, 0, value.length, cursorPosition);
    if (braceHit) {
        return true;
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

    clearEmphasisModeParentContext();
    emphasisEditingTarget = target;
    const value = target.value;
    const cursorPosition = target.selectionStart;

    let insideEmphasis = false;
    let emphasisMode = 'normal'; // 'normal', 'brace', 'group'

    const emphasisBlock = findEmphasisBlockAtCursor(value, cursorPosition);
    if (emphasisBlock) {
        insideEmphasis = true;
        emphasisEditingValue = emphasisBlock.weight;

        const selectionStart = target.selectionStart;
        const selectionEnd = target.selectionEnd;
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
        }
    }

    if (!insideEmphasis) {
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
            const autoBounds = findAutoDetectTagBounds(value, cursorPosition);
            const blockText = value.substring(autoBounds.start, autoBounds.end);

            if (blockText.length < 2) return;

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
            emphasisEditingValue = clampEmphasisWeight(currentValue + delta);
            if (emphasisEditingMode === 'brace') {
                emphasisEditingValue = snapWeightForBraceMode(emphasisEditingValue);
            }
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
    
    // Check if we're in toolbar mode (needed for both "---" and normal cases)
    const container = target.closest('.prompt-textarea-container, .character-prompt-textarea-container');
    const toolbar = container ? container.querySelector('.prompt-textarea-toolbar') : null;
    const isToolbarMode = toolbar && toolbar.classList.contains('emphasis-mode');
    
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
        // Create new emphasis block - determine if we need a terminator
        const needsTerminator = shouldAddTerminator(value, emphasisEditingSelection.end);
        
        // Check if we're at the end of an existing group and need to start a new number emphasis
        const groupInfo = getPreviousGroupInfo(value, emphasisEditingSelection.start);
        if (groupInfo.isAtEndOfGroup) {
            // We're at the end of a group, just apply the emphasis to the selected text
            const previousWeight = groupInfo.previousWeight || weight;
            emphasizedText = `${weight}::${textToEmphasize} ${previousWeight}::`;
        } else {
            // Normal case - use terminator logic
            emphasizedText = `${weight}::${textToEmphasize}${needsTerminator ? ':: ' : ''}`;
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

// Store previous textarea values for NSFW tag detection
const previousTextareaValues = new WeakMap();

// Emphasis highlighting — one overlay pass per frame; plain text skips the regex pipeline
const emphasisHighlightValueCache = new WeakMap();

function promptNeedsFullSyntaxHighlight(text) {
    if (!text) return false;
    return /::|[{}[\]|]|<|>|!/.test(text);
}

function scheduleEmphasisHighlightUpdate(textarea) {
    if (!textarea) return;
    // scheduleTextInputSideEffect: public/scripts/comp/textareaUtils.js
    scheduleTextInputSideEffect(textarea, () => {
        updateEmphasisHighlighting(textarea);
    });
}

function throttledUpdateEmphasisHighlighting(textarea) {
    scheduleEmphasisHighlightUpdate(textarea);
}

function startEmphasisHighlighting(textarea) {
    if (emphasisHighlightingActive && emphasisHighlightingTarget === textarea) return;
    
    // Skip emphasis highlighting for plain-text prompt fields (search highlighting only)
    if (textarea && textarea.closest('.creative-directive-container, .prompt-textarea-container.director-prompt')) return;

    emphasisHighlightingActive = true;
    emphasisHighlightingTarget = textarea;

    // Add event listeners for real-time highlighting using safe event listeners
    addTextareaInputSideEffect(textarea, () => {
        autoResizeTextarea(textarea);
        updateEmphasisHighlighting(textarea);
    }, 'emphasisHighlighting');

    // Initial highlighting
    autoResizeTextarea(textarea);
    updateEmphasisHighlighting(textarea);
}

function stopEmphasisHighlighting() {
    if (emphasisHighlightingTarget) {
        // cancelTextInputSideEffect: public/scripts/comp/textareaUtils.js
        cancelTextInputSideEffect(emphasisHighlightingTarget);
        emphasisHighlightValueCache.delete(emphasisHighlightingTarget);
        // Clean up the emphasis highlighting event listener
        removeSafeEventListener(emphasisHighlightingTarget, 'input', 'emphasisHighlighting');
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

    const value = textarea.value;

    // NSFW tag detection and auto-setting
    handleNsfwTagDetection(textarea, value);

    const currentValue = textarea.value;
    const overlay = ensurePromptEmphasisHighlightOverlay(textarea);
    if (!overlay) return;

    const cachedValue = emphasisHighlightValueCache.get(textarea);
    if (cachedValue === currentValue) {
        overlay.scrollTop = textarea.scrollTop;
        overlay.scrollLeft = textarea.scrollLeft;
        return;
    }
    emphasisHighlightValueCache.set(textarea, currentValue);

    if (!promptNeedsFullSyntaxHighlight(currentValue)) {
        overlay.textContent = currentValue;
    } else {
        overlay.innerHTML = highlightEmphasisInText(currentValue);
    }

    // Sync scroll position
    overlay.scrollTop = textarea.scrollTop;
    overlay.scrollLeft = textarea.scrollLeft;
}

function initializeEmphasisOverlay(textarea) {
    if (!textarea) return;
    
    // Skip emphasis highlighting for creative directive container (only use search highlighting)
    if (textarea.closest('.creative-directive-container, .prompt-textarea-container.director-prompt')) return;

    const value = textarea.value;
    const highlightedValue = highlightEmphasisInText(value);

    const overlay = ensurePromptEmphasisHighlightOverlay(textarea);
    if (!overlay) return;

    overlay.innerHTML = highlightedValue;

    // Sync scroll position
    overlay.scrollTop = textarea.scrollTop;
    overlay.scrollLeft = textarea.scrollLeft;
}

/** Solid text color for emphasis toolbar value — mirrors highlight ramps; 1.0 = light gray (not transparent). */
function getEmphasisToolbarColor(weight) {
    if (weight === '---') return '#ff6b6b';
    const c = computeEmphasisWeightColor(weight);
    return `rgb(${c.r}, ${c.g}, ${c.b})`;
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

function highlightEmphasisInText(text) {
    if (!text) return '';

    let highlightedText = text;

    // Function to calculate dynamic colors based on weight
    function getEmphasisColors(weight) {
        const c = computeEmphasisWeightColor(weight);
        return {
            background: `rgba(${c.r}, ${c.g}, ${c.b}, ${c.backgroundA.toFixed(2)})`,
            border: `rgba(${c.borderR}, ${c.borderG}, ${c.borderB}, ${c.borderA.toFixed(2)})`
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
        const tagPattern = getU1TagPattern();
        if (!tagPattern) return content;

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

    // Step 0: Protect stage-conditional blocks (!-N/, !N+/, !N/) — same delimiters as embedded expander stage rules
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
    // This prevents any inner highlighting from being applied to disabled content
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

    // Step 2: Process all other highlighting patterns (disable blocks are now protected)
    // Find ALL emphasis patterns (both traditional and auto-terminating) from the original string
    const allEmphasis = [];
    let match;
    
    // Find traditional patterns
    while ((match = EMPHASIS_PATTERNS.weightEmphasis.exec(highlightedText)) !== null) {
        allEmphasis.push({
            type: 'traditional',
            match: match[0],
            weight: match[1],
            content: match[2],
            index: match.index,
            length: match[0].length
        });
    }
    EMPHASIS_PATTERNS.weightEmphasis.lastIndex = 0;
    
    // Find auto-terminating patterns
    while ((match = EMPHASIS_PATTERNS.weightEmphasisAutoTerminating.exec(highlightedText)) !== null) {
        allEmphasis.push({
            type: 'auto',
            match: match[0],
            weight: match[1],
            content: match[2],
            index: match.index,
            length: match[0].length
        });
    }
    
    // Filter out overlaps - traditional patterns take priority
    const filtered = [];
    for (const item of allEmphasis) {
        const overlaps = allEmphasis.some(other => {
            if (other === item) return false;
            if (other.type !== 'traditional') return false;
            const itemEnd = item.index + item.length;
            const otherEnd = other.index + other.length;
            // Check if they overlap
            return (item.index >= other.index && item.index < otherEnd) ||
                   (itemEnd > other.index && itemEnd <= otherEnd);
        });
        if (!overlaps) filtered.push(item);
    }
    
    // Process all from end to start to preserve indices
    filtered.sort((a, b) => b.index - a.index);
    
    for (const item of filtered) {
        const weightNum = parseFloat(item.weight);
        const colors = getEmphasisColors(weightNum);
        const highlightedContent = applyNSFWHighlighting(item.content);
        const replacement = item.type === 'traditional'
            ? `<span class="emphasis-highlight" style="background: ${colors.background}; border-color: ${colors.border};">${item.weight}::${highlightedContent}::</span>`
            : `<span class="emphasis-highlight" style="background: ${colors.background}; border-color: ${colors.border};">${item.weight}::${highlightedContent}</span>`;
        highlightedText = highlightedText.substring(0, item.index) + replacement + 
                         highlightedText.substring(item.index + item.length);
    }

    // Highlight brace emphasis {text} - convert to weight equivalent
    highlightedText = highlightedText.replace(EMPHASIS_PATTERNS.braceEmphasis, (match, openBraces, content, closeBraces) => {
        const braceLevel = Math.min(openBraces.length, closeBraces.length);
        const weight = 1.0 + (braceLevel * 0.1); // Convert brace level to weight (+0.1 per level)
        const colors = getEmphasisColors(weight);

        // Apply NSFW highlighting to the content inside braces
        const highlightedContent = applyNSFWHighlighting(content);

        return `<span class="emphasis-highlight" style="background: ${colors.background}; border-color: ${colors.border};">${openBraces}${highlightedContent}${closeBraces}</span>`;
    });

    // Highlight bracket emphasis [text] - convert to weight equivalent
    highlightedText = highlightedText.replace(EMPHASIS_PATTERNS.bracketEmphasis, (match, openBrackets, content, closeBrackets) => {
        const bracketLevel = Math.min(openBrackets.length, closeBrackets.length);
        const weight = 1.0 - (bracketLevel * 0.1); // Convert bracket level to weight (-0.1 per level)
        const colors = getEmphasisColors(weight);

        // Apply NSFW highlighting to the content inside brackets
        const highlightedContent = applyNSFWHighlighting(content);

        return `<span class="emphasis-highlight" style="background: ${colors.background}; border-color: ${colors.border};">${openBrackets}${highlightedContent}${closeBrackets}</span>`;
    });

    // Highlight text replacements <text> - no emphasis levels, just visual highlighting
    // Match patterns that look like valid text replacement keys (letters, numbers, underscores) - case insensitive
    // Handle bracketed incrementing syntax ![...]#
    highlightedText = highlightedText.replace(EMPHASIS_PATTERNS.bracketedIncrementing, (match, exclamation, content, underscores, suffix, hash) => {
        const backgroundColor = '#e91e63'; // Bracketed incrementing color (pink)

        // Escape special characters for HTML display
        const escapedMatch = match.replace(/!/g, '&#33;')
                                 .replace(/\[/g, '&#91;')
                                 .replace(/\]/g, '&#93;')
                                 .replace(/~/g, '&#126;')
                                 .replace(/\+/g, '&#43;')
                                 .replace(/_/g, '&#95;')
                                 .replace(/#/g, '&#35;');

        return `<span class="emphasis-highlight" style="background: ${backgroundColor}; border-color: ${backgroundColor};">${escapedMatch}</span>`;
    });

    // Handle bracketed syntax ![...] with optional suffixes
    highlightedText = highlightedText.replace(EMPHASIS_PATTERNS.bracketedReplacement, (match, exclamation, content, underscores, suffix) => {
        const backgroundColor = '#9c27b0'; // Bracketed replacement color (purple)

        // Escape special characters for HTML display
        const escapedMatch = match.replace(/!/g, '&#33;')
                                 .replace(/\[/g, '&#91;')
                                 .replace(/\]/g, '&#93;')
                                 .replace(/~/g, '&#126;')
                                 .replace(/\+/g, '&#43;')
                                 .replace(/_/g, '&#95;');

        return `<span class="emphasis-highlight" style="background: ${backgroundColor}; border-color: ${backgroundColor};">${escapedMatch}</span>`;
    });


    // Handle incrementing syntax !KEY# (must come before bracketed)
    highlightedText = highlightedText.replace(EMPHASIS_PATTERNS.incrementingSyntax, (match, exclamation, content) => {
        const backgroundColor = '#ff9800'; // Incrementing syntax color (orange)

        // Escape the ! character for HTML display
        const escapedMatch = match.replace(/!/g, '&#33;');

        return `<span class="emphasis-highlight" style="background: ${backgroundColor}; border-color: ${backgroundColor};">${escapedMatch}</span>`;
    });

    // Handle bracketed incrementing syntax ![...]#
    highlightedText = highlightedText.replace(EMPHASIS_PATTERNS.bracketedIncrementing, (match, exclamation, content, underscores, suffix, hash) => {
        const backgroundColor = '#e91e63'; // Bracketed incrementing color (pink)

        // Escape special characters for HTML display
        const escapedMatch = match.replace(/!/g, '&#33;')
                                 .replace(/\[/g, '&#91;')
                                 .replace(/\]/g, '&#93;')
                                 .replace(/~/g, '&#126;')
                                 .replace(/\+/g, '&#43;')
                                 .replace(/_/g, '&#95;')
                                 .replace(/#/g, '&#35;');

        return `<span class="emphasis-highlight" style="background: ${backgroundColor}; border-color: ${backgroundColor};">${escapedMatch}</span>`;
    });

    // Sequential combined pool ~+# — before ~+ / ~
    highlightedText = highlightedText.replace(EMPHASIS_PATTERNS.pickCombineIncrementing, (match, exclamation, content) => {
        const backgroundColor = '#ff9800';
        const escapedMatch = match.replace(/!/g, '&#33;').replace(/~/g, '&#126;').replace(/\+/g, '&#43;').replace(/#/g, '&#35;');
        return `<span class="emphasis-highlight" style="background: ${backgroundColor}; border-color: ${backgroundColor};">${escapedMatch}</span>`;
    });

    // Sticky-prefix pick ~# — before ~+ / ~
    highlightedText = highlightedText.replace(EMPHASIS_PATTERNS.pickIncrementingSuffix, (match, exclamation, content) => {
        const backgroundColor = '#f57c00';
        const escapedMatch = match.replace(/!/g, '&#33;').replace(/~/g, '&#126;').replace(/#/g, '&#35;');
        return `<span class="emphasis-highlight" style="background: ${backgroundColor}; border-color: ${backgroundColor};">${escapedMatch}</span>`;
    });

    // Handle PICK replacements with ~ and ~+ suffixes
    highlightedText = highlightedText.replace(EMPHASIS_PATTERNS.pickReplacement, (match, exclamation, content, suffix) => {
        const backgroundColor = '#628a33'; // PICK replacement color

        // Escape the ! and suffix characters for HTML display
        const escapedMatch = match.replace(/!/g, '&#33;').replace(/~/g, '&#126;').replace(/\+/g, '&#43;');

        return `<span class="emphasis-highlight" style="background: ${backgroundColor}; border-color: ${backgroundColor};">${escapedMatch}</span>`;
    });
    
    // Handle regular replacements with word boundary matching
    highlightedText = highlightedText.replace(EMPHASIS_PATTERNS.regularReplacement, (match, exclamation, content) => {
        const backgroundColor = '#8bc34a8a'; // Regular replacement color

        // Escape the ! character for HTML display
        const escapedMatch = match.replace(/!/g, '&#33;');

        return `<span class="emphasis-highlight" style="background: ${backgroundColor}; border-color: ${backgroundColor};">${escapedMatch}</span>`;
    });

    // Highlight NSFW tags in remaining text (outside of emphasis blocks)
    // Only process text that's not already inside emphasis-highlight spans
    highlightedText = highlightedText.replace(/([^<]*?)(?=<span class="emphasis-highlight"|$)/g, (match, text) => {
        const tagPattern = getU1TagPattern();
        if (!tagPattern || !text.trim()) return match;

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

    // Step 3: Restore disable blocks with dark gray highlighting
    disableBlocks.forEach(block => {
        const escapedMatch = block.original.replace(/!/g, '&#33;')
                                         .replace(/\//g, '&#47;');

        highlightedText = highlightedText.replace(block.id, 
            `<span class="emphasis-highlight" style="background: ${DISABLE_SYNTAX_HIGHLIGHT.background}; border-color: ${DISABLE_SYNTAX_HIGHLIGHT.border};">${escapedMatch}</span>`
        );
    });

    // Step 4: Restore stage-conditional blocks
    stageConditionalBlocks.forEach(block => {
        const escapedMatch = block.original.replace(/!/g, '&#33;')
                                         .replace(/\//g, '&#47;');
        highlightedText = highlightedText.replace(block.id,
            `<span class="emphasis-highlight" style="background: ${DISABLE_SYNTAX_HIGHLIGHT.background}; border-color: ${DISABLE_SYNTAX_HIGHLIGHT.border};">${escapedMatch}</span>`
        );
    });

    return highlightedText;
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

// Strip emphasis syntax from a text fragment (weight prefixes, :: groups, braces, brackets)
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

// Initialize token info container click handlers
function initializeTokenInfoClickHandlers() {
    // Add click handlers to all token-info-containers
    document.addEventListener('click', (e) => {
        const tokenInfo = e.target.closest('.token-info-container');
        if (!tokenInfo) return;
        
        // Find the associated textarea
        const toolbar = tokenInfo.closest('.prompt-textarea-toolbar');
        if (!toolbar) return;
        
        // Find the textarea - it's a sibling of the toolbar within the container
        const container = toolbar.parentElement;
        if (!container) return;
        
        // Look for textarea in the container (UC tab has two fields; prefer the one that was focused)
        let textarea = null;
        if (window.promptTextareaToolbar && window.promptTextareaToolbar.activeTextarea &&
            container.contains(window.promptTextareaToolbar.activeTextarea)) {
            textarea = window.promptTextareaToolbar.activeTextarea;
        }
        if (!textarea) {
            textarea = container.querySelector('textarea.prompt-textarea, textarea.character-prompt-textarea') ||
                container.querySelector('#manualPrompt, #manualUc, #manualPromptNegative');
        }

        if (textarea) {
            // Open token display modal
            openTokenDisplayModal(textarea);
        }
    });
}

// Helper function to escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}


// ============================================================================
// Token Display Modal System
// ============================================================================

// Open token display modal with highlighted tokens
function openTokenDisplayModal(textarea) {
    if (!textarea || !t5Tokenizer) {
        console.error('Cannot open token modal: missing textarea or tokenizer');
        return;
    }
    
    const rawText = textarea.value;
    const text = stripPromptBlocksForEffectivePrompt(rawText || '', { stageIndex: 0, pipelineStageGeneration: false });
    if (!text.trim()) {
        showGlassToast('info', 'Info', 'No text to analyze', false, 3000, '<i class="fas fa-info-circle"></i>');
        return;
    }
    
    try {
        // Analyze text to get detailed tokens (using stripped text)
        const analysis = t5Tokenizer.analyzeTexts([text], true);
        if (!analysis?.results?.[0]?.detailedTokens) {
            showGlassToast('error', 'Error', 'Failed to analyze tokens', false, 5000, '<i class="nai-cross"></i>');
            return;
        }
        
        const tokens = analysis.results[0].detailedTokens;
        
        // Generate highlighted token display
        const tokenDisplay = generateTokenDisplay(tokens, text);
        document.getElementById('tokenModalDisplay').innerHTML = tokenDisplay;
        
        // Open modal
        const modal = document.getElementById('tokenDisplayModal');
        if (modal) {
            openModal(modal);
        }
        
    } catch (error) {
        console.error('Error opening token modal:', error);
        showGlassToast('error', 'Error', 'Failed to analyze tokens', false, 5000, '<i class="nai-cross"></i>');
    }
}

// Generate HTML display for tokens with highlighting
function generateTokenDisplay(tokens, originalText) {
    // Display tokens with alternating background colors like in the images
    let output = '';
    let colorIndex = 0;
    
    for (const token of tokens) {
        const displayText = token.text.replace(/▁/g, ' ');
        const tokenElement = createTokenElement(token, displayText, colorIndex);
        output += tokenElement;
        colorIndex = (colorIndex + 1) % 3; // Cycle through 3 colors
    }
    
    return output;
}

// Create HTML element for a single token
function createTokenElement(token, displayText, colorIndex = 0) {
    const escapedText = escapeHtml(displayText);
    
    // Determine background color based on alternating pattern
    let backgroundColor;
    switch (colorIndex) {
        case 0:
            backgroundColor = 'rgba(128, 64, 128, 0.4)'; // Dark purple
            break;
        case 1:
            backgroundColor = 'rgba(64, 128, 64, 0.4)'; // Dark green
            break;
        case 2:
            backgroundColor = 'rgba(64, 96, 128, 0.4)'; // Dark blue
            break;
        default:
            backgroundColor = 'rgba(128, 64, 128, 0.4)';
    }
    
    // Special handling for special tokens
    if (token.isSpecial) {
        backgroundColor = 'rgba(150, 150, 150, 0.4)'; // Gray for special tokens
    } else if (!token.isValid) {
        backgroundColor = 'rgba(200, 64, 64, 0.4)'; // Red for invalid tokens
    }
    
    // Create tooltip content
    const tooltipContent = createTokenTooltip(token);
    
    return `<span class="token-highlight" data-token-id="${token.tokenId}" title="${escapedText}" style="background: ${backgroundColor};">${escapedText}<div class="token-tooltip">${tooltipContent}</div></span>`;
}

// Create tooltip content for token
function createTokenTooltip(token) {
    const parts = [];
    
    parts.push(`ID: ${token.tokenId}`);
    parts.push(`Text: "${token.text}"`);
    
    if (token.isSpecial) {
        parts.push('Type: Special Token');
    } else if (!token.isValid) {
        parts.push('Type: Invalid Token');
    } else {
        parts.push(`Strength: ${token.strength.toFixed(4)}`);
        parts.push('Type: Valid Token');
    }
    
    return parts.join('<br>');
}

// Setup token modal event listeners
function setupTokenModal() {
    // Close button
    const closeBtn = document.getElementById('closeTokenModalBtn');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            const modal = document.getElementById('tokenDisplayModal');
            if (modal) {
                closeModal(modal);
            }
        });
    }
    
    // Close on backdrop click
    const modal = document.getElementById('tokenDisplayModal');
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeModal(modal);
            }
        });
    }
}

// Initialize token modal system on page load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        initializeTokenInfoClickHandlers();
        setupTokenModal();
    });
} else {
    initializeTokenInfoClickHandlers();
    setupTokenModal();
}