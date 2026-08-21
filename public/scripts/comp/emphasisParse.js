// Emphasis prompt parsing, targets, overlays, syntax fix

const EMPHASIS_BRACE_BLOCK_PATTERN = /(\{+)([^{}]*)\}+|(\[+)([^\[]*)\]+/g;
const EMPHASIS_WEIGHT_PART = '-?\\d+(?:\\.\\d+)?';

/**
 * Absolute weight above this is never treated as a next-group opener.
 * Prevents "year 2025::" from splitting into weight 2025 (NovelAI weights are small).
 */
const EMPHASIS_NEXT_GROUP_WEIGHT_ABS_MAX = 100;

/** NovelAI pre-v4 brace strengthen factor (official). Each `{}` multiplies by this. */
const EMPHASIS_BRACE_STRENGTHEN_FACTOR = 1.05;
/** NovelAI pre-v4 bracket weaken factor = 1/1.05. */
const EMPHASIS_BRACE_WEAKEN_FACTOR = 1 / EMPHASIS_BRACE_STRENGTHEN_FACTOR;
const EMPHASIS_BRACE_LEVEL_MAX = 24;

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
        let nextGroupAt = nextGroupMatch ? nextGroupMatch.index : -1;
        // "year 2025::" — 2025 is content, not a new opener (weights are never hundreds+)
        if (nextGroupAt >= 0) {
            const nextWeightMatch = tail.slice(nextGroupAt).match(/^(?:,\s*|\s+)(-?\d+(?:\.\d+)?)::/);
            if (nextWeightMatch && Math.abs(parseFloat(nextWeightMatch[1])) > EMPHASIS_NEXT_GROUP_WEIGHT_ABS_MAX) {
                nextGroupAt = -1;
            }
        }
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
    // listManagedEmphasisBlocks: public/scripts/comp/emphasisGroupIdCodec.js
    if (hasManagedEmphasisGroupIds(value)) {
        const blocks = listManagedEmphasisBlocks(value);
        for (let i = 0; i < blocks.length; i++) {
            const b = blocks[i];
            if (selStart < b.end && selEnd > b.start) {
                return {
                    start: b.start,
                    end: b.end,
                    innerText: b.innerText,
                    managedId: b.id,
                    needsTerminator: b.needsTerminator
                };
            }
        }
    }

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
    // Managed unwrap: drop open/close, keep inner — no classic :: glue for prior omitClose.
    // listManagedEmphasisBlocks: public/scripts/comp/emphasisGroupIdCodec.js
    if (hasManagedEmphasisGroupIds(value)) {
        const managed = listManagedEmphasisBlocks(value).find(
            (b) => b.start === blockStart && b.end === blockEnd
        );
        if (managed) {
            return {
                replaceStart: managed.start,
                replaceEnd: managed.end,
                replacementText: managed.innerText
            };
        }
    }

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

/**
 * Round brace-derived weights to 4 decimals (NovelAI 1.05^n needs more than 2).
 * clampEmphasisWeightNormalize: public/scripts/comp/emphasisWeightMath.js
 */
function formatNovelAiBraceWeight(weight) {
    const n = typeof weight === 'number' ? weight : parseFloat(weight);
    if (!Number.isFinite(n)) return 1;
    return clampEmphasisWeightNormalize(n);
}

/** Numeric weight for brace/bracket nesting depth (NovelAI: 1.05^n / (1/1.05)^n). */
function weightFromBraceLevel(level, kind) {
    const lv = Math.max(0, Math.min(EMPHASIS_BRACE_LEVEL_MAX, level | 0));
    if (lv <= 0) return 1;
    const factor = kind === 'bracket'
        ? EMPHASIS_BRACE_WEAKEN_FACTOR
        : EMPHASIS_BRACE_STRENGTHEN_FACTOR;
    return formatNovelAiBraceWeight(Math.pow(factor, lv));
}

/**
 * Nearest brace/bracket level for a numeric weight (for snap / rebuild).
 * @returns {{ level: number, kind: 'brace'|'bracket'|null }}
 */
function braceLevelFromWeight(weight) {
    const w = formatNovelAiBraceWeight(weight);
    if (!Number.isFinite(w) || Math.abs(w - 1) < 0.00005) {
        return { level: 0, kind: null };
    }
    const kind = w > 1 ? 'brace' : 'bracket';
    let bestLevel = 1;
    let bestDist = Infinity;
    for (let level = 1; level <= EMPHASIS_BRACE_LEVEL_MAX; level++) {
        const cand = weightFromBraceLevel(level, kind);
        const dist = Math.abs(cand - w);
        if (dist < bestDist) {
            bestDist = dist;
            bestLevel = level;
        }
    }
    return { level: bestLevel, kind };
}

function weightFromBraceBlockText(blockText) {
    const openBraces = blockText.match(/^\{+/);
    if (openBraces) {
        const closeBraces = blockText.match(/\}+$/);
        const level = Math.min(openBraces[0].length, closeBraces ? closeBraces[0].length : 0);
        return weightFromBraceLevel(level, 'brace');
    }
    const openBrackets = blockText.match(/^\[+/);
    if (openBrackets) {
        const closeBrackets = blockText.match(/\]+$/);
        const level = Math.min(openBrackets[0].length, closeBrackets ? closeBrackets[0].length : 0);
        return weightFromBraceLevel(level, 'bracket');
    }
    return 1.0;
}

/** Snap to nearest NovelAI brace/bracket weight (1.05^n or (1/1.05)^n). */
function snapWeightForBraceMode(weight) {
    const { level, kind } = braceLevelFromWeight(weight);
    if (!kind || level <= 0) return 1;
    return weightFromBraceLevel(level, kind);
}

/**
 * Move ±N brace levels through 1.0 (brace ↔ plain ↔ bracket).
 * levelDelta > 0 strengthens; < 0 weakens.
 */
function stepBraceEmphasisWeight(weight, levelDelta) {
    const delta = levelDelta | 0;
    if (!delta) return snapWeightForBraceMode(weight);
    const info = braceLevelFromWeight(weight);
    let signed = 0;
    if (info.kind === 'brace') signed = info.level;
    else if (info.kind === 'bracket') signed = -info.level;
    signed += delta;
    if (signed === 0) return 1;
    if (signed > 0) return weightFromBraceLevel(signed, 'brace');
    return weightFromBraceLevel(-signed, 'bracket');
}

function buildBraceEmphasisText(innerText, weight) {
    const { level, kind } = braceLevelFromWeight(weight);
    if (!kind || level <= 0) return innerText;
    if (kind === 'brace') {
        const braces = '{'.repeat(level);
        return `${braces}${innerText}${'}'.repeat(level)}`;
    }
    const brackets = '['.repeat(level);
    return `${brackets}${innerText}${']'.repeat(level)}`;
}

function normalizeEmphasisInnerText(innerText) {
    return String(innerText || '').trim().replace(/\s+/g, ' ');
}

/** Minimum 1 — sum of comma-portion lengths (plan: each comma-spaced portion). */
function getEmphasisSectionLength(innerText) {
    const raw = String(innerText || '');
    let total = 0;
    raw.split(',').forEach((part) => {
        const trimmed = part.trim();
        if (trimmed) total += trimmed.length;
    });
    return Math.max(1, total || normalizeEmphasisInnerText(raw).length);
}

/**
 * Model-effective emphasis: longer sections amplify the same weight.
 * Second arg may be inner text OR a precomputed numeric length (from sectionLengths[]).
 */
function getEmphasisDeltaInfluence(weight, innerTextOrLength) {
    const w = typeof weight === 'number' ? weight : parseFloat(weight);
    const safeWeight = isNaN(w) ? 1 : Math.max(0, w);
    if (typeof innerTextOrLength === 'number' && Number.isFinite(innerTextOrLength)) {
        return safeWeight * Math.max(1, innerTextOrLength);
    }
    return safeWeight * getEmphasisSectionLength(innerTextOrLength);
}

function buildEmphasisTargetKeyLegacy(target) {
    const kind = target.type === 'brace' ? (target.braceKind || 'brace') : 'group';
    return `${target.type}|${kind}|${normalizeEmphasisInnerText(target.innerText)}`;
}

function buildEmphasisTargetKey(target) {
    const start = typeof target.start === 'number' ? target.start : -1;
    return `${start}|${buildEmphasisTargetKeyLegacy(target)}`;
}

function resolveEmphasisTargetWeightLookup(weightLookup, target, idx) {
    if (!weightLookup) return undefined;
    if (typeof weightLookup.has === 'function') {
        if (weightLookup.has(target.start)) return weightLookup.get(target.start);
        if (weightLookup.has(idx)) return weightLookup.get(idx);
    }
    return undefined;
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

/**
 * Spans for disable / stage-conditional segments (!/…/, !N/…/, !N+/…/, !-N/…/).
 * Omitted from unweighted context cards and ranking free-text.
 */
function listDisableEmphasisSpans(value) {
    const text = String(value || '');
    if (!text) return [];
    const spans = [];
    // Order: stage-conditional variants first, then plain !/…/
    const patterns = [
        /!-(\d+)\/([^\/]*)\//g,
        /!(\d+)\+\/([^\/]*)\//g,
        /!(\d+)\/([^\/]*)\//g,
        /!\/([^\/]*)\//g
    ];
    patterns.forEach((re) => {
        re.lastIndex = 0;
        let match;
        while ((match = re.exec(text)) !== null) {
            spans.push({ start: match.index, end: match.index + match[0].length });
        }
    });
    return spans.sort((a, b) => a.start - b.start);
}

/** Merge overlapping/adjacent [start,end) spans into a sorted non-overlapping list. */
function mergeEmphasisCoveredSpans(spans) {
    const sorted = (spans || [])
        .filter((s) => s && Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start)
        .sort((a, b) => a.start - b.start || a.end - b.end);
    if (!sorted.length) return [];
    const out = [{ start: sorted[0].start, end: sorted[0].end }];
    for (let i = 1; i < sorted.length; i++) {
        const cur = sorted[i];
        const last = out[out.length - 1];
        if (cur.start <= last.end) {
            last.end = Math.max(last.end, cur.end);
        } else {
            out.push({ start: cur.start, end: cur.end });
        }
    }
    return out;
}

/**
 * Unweighted prompt spans outside emphasis groups/braces and disable segments.
 * Each contiguous free span is one item (commas kept — not split into tags).
 * Treated as virtual 1.0:: context for Weight Rack ranking (not written back).
 */
function listUnweightedEmphasisPortions(value) {
    const text = String(value || '');
    if (!text) return [];

    // listEditorEmphasisTargets covers managed id spans; classic listAllEmphasisTargets does not.
    // listEditorEmphasisTargets: public/scripts/comp/emphasisGroupIdCodec.js
    const coveredTargets = typeof listEditorEmphasisTargets === 'function'
        ? listEditorEmphasisTargets(text, null)
        : listAllEmphasisTargets(text);

    const covered = mergeEmphasisCoveredSpans([
        ...coveredTargets.map((t) => ({ start: t.start, end: t.end })),
        ...listDisableEmphasisSpans(text)
    ]);

    const freeSpans = [];
    let cursor = 0;
    covered.forEach((span) => {
        if (span.start > cursor) {
            freeSpans.push({ start: cursor, end: span.start });
        }
        cursor = Math.max(cursor, span.end);
    });
    if (cursor < text.length) {
        freeSpans.push({ start: cursor, end: text.length });
    }

    const portions = [];
    freeSpans.forEach((span) => {
        const chunk = text.substring(span.start, span.end);
        // Drop pure separator spans (spaces/commas only)
        if (!chunk.replace(/[,\s]/g, '').length) return;
        // Strip leading/trailing commas and whitespace for display + span bounds
        const lead = chunk.match(/^[,\s]*/)?.[0].length || 0;
        const trail = chunk.match(/[,\s]*$/)?.[0].length || 0;
        const coreEnd = chunk.length - trail;
        if (coreEnd <= lead) return;
        const innerText = chunk.substring(lead, coreEnd);
        if (!innerText.replace(/[,\s]/g, '').length) return;
        portions.push({
            type: 'unweighted',
            start: span.start + lead,
            end: span.start + coreEnd,
            weight: 1,
            innerText,
            virtual: true
        });
    });
    return portions;
}

function buildEmphasisTargetText(target, weight, options = {}) {
    if (target.type === 'brace') {
        return buildBraceEmphasisText(target.innerText, weight);
    }
    const weightStr = options.normalizePrecision
        ? formatEmphasisWeightNormalize(weight)
        : formatEmphasisWeight(weight);
    if (target.needsTerminator) {
        // formatClassicClosedEmphasisGroup: public/scripts/comp/emphasisGroupIdCodec.js
        return formatClassicClosedEmphasisGroup(weightStr, target.innerText);
    }
    return `${weightStr}::${target.innerText}`;
}

function applyEmphasisTargetWeights(value, weightLookup, options = {}) {
    const targets = listAllEmphasisTargets(value);
    if (!targets.length) return value;

    let result = '';
    let lastEnd = 0;
    targets.forEach((target, idx) => {
        result += value.substring(lastEnd, target.start);
        const resolved = resolveEmphasisTargetWeightLookup(weightLookup, target, idx);
        const weight = resolved !== undefined ? resolved : target.weight;
        result += buildEmphasisTargetText(target, weight, options);
        lastEnd = target.end;
    });
    result += value.substring(lastEnd);
    return result;
}

/**
 * Zero-sum redistribute shares among active indices after one share changes.
 * Interactive Weight Rack use: delta mode only (delta off keeps assigned shares independent).
 */
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

/** Redistribute share delta among adjustable peers; locked stay fixed. Delta mode only. */
function rebalanceEmphasisSharesByDelta(shares, changedIndex, newShare, activeIndices, lockedIndices) {
    const result = shares.slice();
    const lockedSet = new Set(lockedIndices || []);
    const oldShare = shares[changedIndex] || 0;
    const clampedNew = Math.max(0, Math.min(100, newShare));
    result[changedIndex] = clampedNew;

    let delta = clampedNew - oldShare;
    if (delta === 0) return result;

    let adjustable = activeIndices.filter((i) => i !== changedIndex && !lockedSet.has(i));
    if (!adjustable.length) return result;

    if (delta > 0) {
        let remainingReduction = delta;
        let eligiblePeers = adjustable.slice();

        while (remainingReduction > 0.00001 && eligiblePeers.length > 0) {
            const othersSum = eligiblePeers.reduce((sum, i) => sum + (result[i] || 0), 0);
            if (othersSum <= 0) {
                const per = remainingReduction / eligiblePeers.length;
                let nextPeers = [];
                eligiblePeers.forEach((i) => {
                    const oldVal = result[i] || 0;
                    const newVal = Math.max(0, oldVal - per);
                    result[i] = newVal;
                    remainingReduction -= (oldVal - newVal);
                    if (newVal > 0) nextPeers.push(i);
                });
                eligiblePeers = nextPeers;
            } else {
                let nextPeers = [];
                const currentReduction = remainingReduction;
                eligiblePeers.forEach((i) => {
                    const oldVal = result[i] || 0;
                    const reduction = currentReduction * (oldVal / othersSum);
                    const newVal = Math.max(0, oldVal - reduction);
                    result[i] = newVal;
                    remainingReduction -= (oldVal - newVal);
                    if (newVal > 0) nextPeers.push(i);
                });
                eligiblePeers = nextPeers;
            }
        }

        if (remainingReduction > 0.00001) {
            result[changedIndex] = Math.max(0, result[changedIndex] - remainingReduction);
        }
    } else {
        let remainingGain = -delta;
        let eligiblePeers = adjustable.slice();

        while (remainingGain > 0.00001 && eligiblePeers.length > 0) {
            const othersSum = eligiblePeers.reduce((sum, i) => sum + (result[i] || 0), 0);
            if (othersSum <= 0) {
                const per = remainingGain / eligiblePeers.length;
                let nextPeers = [];
                eligiblePeers.forEach((i) => {
                    const oldVal = result[i] || 0;
                    const newVal = Math.min(100, oldVal + per);
                    result[i] = newVal;
                    remainingGain -= (newVal - oldVal);
                    if (newVal < 100) nextPeers.push(i);
                });
                eligiblePeers = nextPeers;
            } else {
                let nextPeers = [];
                const currentGain = remainingGain;
                eligiblePeers.forEach((i) => {
                    const oldVal = result[i] || 0;
                    const addition = currentGain * (oldVal / othersSum);
                    const newVal = Math.min(100, oldVal + addition);
                    result[i] = newVal;
                    remainingGain -= (newVal - oldVal);
                    if (newVal < 100) nextPeers.push(i);
                });
                eligiblePeers = nextPeers;
            }
        }

        if (remainingGain > 0.00001) {
            result[changedIndex] = Math.min(100, result[changedIndex] + remainingGain);
        }
    }

    return result;
}

function shareToWeightFromRange(share, min, max) {
    const range = max - min;
    if (range <= 0) return clampEmphasisWeightNormalize(max);
    const s = Math.max(0, Math.min(100, share || 0));
    return clampEmphasisWeightNormalize(min + (s / 100) * range);
}

/** Redistribute weight delta by weight × section length; locked stay fixed. Delta mode only. */
function rebalanceEmphasisWeightsByDelta(weights, changedIndex, newWeight, activeIndices, lockedIndices, sectionLengths) {
    const result = [];
    const lockedSet = new Set(lockedIndices || []);
    const lengthAt = (i) => {
        if (sectionLengths && sectionLengths[i] !== undefined) {
            return Math.max(1, sectionLengths[i]);
        }
        return 1;
    };
    const influenceAt = (i, weight) => getEmphasisDeltaInfluence(weight, lengthAt(i));

    (activeIndices || []).forEach((i) => {
        const w = weights && weights[i] !== undefined ? weights[i] : 1;
        result[i] = clampEmphasisWeightNormalize(w);
    });

    const oldWeight = result[changedIndex];
    const clampedNew = clampEmphasisWeightNormalize(newWeight);
    result[changedIndex] = clampedNew;

    const oldInfluence = oldWeight * lengthAt(changedIndex);
    const newInfluenceVal = clampedNew * lengthAt(changedIndex);
    const delta = newInfluenceVal - oldInfluence;

    if (Math.abs(delta) < 0.00001) return result;

    const adjustable = activeIndices.filter((i) => i !== changedIndex && !lockedSet.has(i));
    if (!adjustable.length) return result;

    if (delta > 0) {
        let remainingReduction = delta;
        let eligiblePeers = adjustable.slice();

        while (remainingReduction > 0.00001 && eligiblePeers.length > 0) {
            const othersInfluenceSum = eligiblePeers.reduce((sum, i) => sum + influenceAt(i, result[i]), 0);
            if (othersInfluenceSum <= 0) {
                const per = remainingReduction / eligiblePeers.length;
                let nextPeers = [];
                eligiblePeers.forEach((i) => {
                    const len = lengthAt(i);
                    const oldWeightVal = result[i] || 0;
                    const oldInfluenceVal = oldWeightVal * len;
                    const newInfluenceVal = Math.max(0, oldInfluenceVal - per);
                    const newWeightVal = clampEmphasisWeightNormalize(newInfluenceVal / len);
                    result[i] = newWeightVal;
                    remainingReduction -= (oldInfluenceVal - (newWeightVal * len));
                    if (newWeightVal > 0) nextPeers.push(i);
                });
                eligiblePeers = nextPeers;
            } else {
                let nextPeers = [];
                const currentReduction = remainingReduction;
                eligiblePeers.forEach((i) => {
                    const len = lengthAt(i);
                    const oldWeightVal = result[i] || 0;
                    const oldInfluenceVal = oldWeightVal * len;
                    const reduction = currentReduction * (oldInfluenceVal / othersInfluenceSum);
                    const newInfluenceVal = Math.max(0, oldInfluenceVal - reduction);
                    const newWeightVal = clampEmphasisWeightNormalize(newInfluenceVal / len);
                    result[i] = newWeightVal;
                    remainingReduction -= (oldInfluenceVal - (newWeightVal * len));
                    if (newWeightVal > 0) nextPeers.push(i);
                });
                eligiblePeers = nextPeers;
            }
        }

        if (remainingReduction > 0.00001) {
            const len = lengthAt(changedIndex);
            const currentInfluence = result[changedIndex] * len;
            const newInfluenceVal = Math.max(0, currentInfluence - remainingReduction);
            result[changedIndex] = clampEmphasisWeightNormalize(newInfluenceVal / len);
        }
    } else {
        let remainingGain = -delta;
        let eligiblePeers = adjustable.slice();

        while (remainingGain > 0.00001 && eligiblePeers.length > 0) {
            const othersInfluenceSum = eligiblePeers.reduce((sum, i) => sum + influenceAt(i, result[i]), 0);
            if (othersInfluenceSum <= 0) {
                const per = remainingGain / eligiblePeers.length;
                let nextPeers = [];
                eligiblePeers.forEach((i) => {
                    const len = lengthAt(i);
                    const oldWeightVal = result[i] || 0;
                    const oldInfluenceVal = oldWeightVal * len;
                    const newInfluenceVal = Math.min(EMPHASIS_WEIGHT_MAX * len, oldInfluenceVal + per);
                    const newWeightVal = clampEmphasisWeightNormalize(newInfluenceVal / len);
                    result[i] = newWeightVal;
                    remainingGain -= ((newWeightVal * len) - oldInfluenceVal);
                    if (newWeightVal < EMPHASIS_WEIGHT_MAX) nextPeers.push(i);
                });
                eligiblePeers = nextPeers;
            } else {
                let nextPeers = [];
                const currentGain = remainingGain;
                eligiblePeers.forEach((i) => {
                    const len = lengthAt(i);
                    const oldWeightVal = result[i] || 0;
                    const oldInfluenceVal = oldWeightVal * len;
                    const addition = currentGain * (oldInfluenceVal / othersInfluenceSum);
                    const newInfluenceVal = Math.min(EMPHASIS_WEIGHT_MAX * len, oldInfluenceVal + addition);
                    const newWeightVal = clampEmphasisWeightNormalize(newInfluenceVal / len);
                    result[i] = newWeightVal;
                    remainingGain -= ((newWeightVal * len) - oldInfluenceVal);
                    if (newWeightVal < EMPHASIS_WEIGHT_MAX) nextPeers.push(i);
                });
                eligiblePeers = nextPeers;
            }
        }

        if (remainingGain > 0.00001) {
            const len = lengthAt(changedIndex);
            const currentInfluence = result[changedIndex] * len;
            const newInfluenceVal = Math.min(EMPHASIS_WEIGHT_MAX * len, currentInfluence + remainingGain);
            result[changedIndex] = clampEmphasisWeightNormalize(newInfluenceVal / len);
        }
    }

    return result;
}

function sharesToWeights(shares, min, max, activeIndices, options = {}) {
    const useNormalizePrecision = options.normalizePrecision === true;
    const clampWeight = useNormalizePrecision ? clampEmphasisWeightNormalize : clampEmphasisWeight;
    const active = activeIndices && activeIndices.length
        ? activeIndices
        : shares.map((_, i) => i);
    const sum = active.reduce((s, i) => s + (shares[i] || 0), 0);
    const weights = [];
    const range = max - min;

    if (sum <= 0) {
        active.forEach((i) => { weights[i] = clampWeight(min); });
        return weights;
    }

    if (options.directRangeMapping) {
        active.forEach((i) => {
            weights[i] = clampWeight(min + ((shares[i] || 0) / 100) * range);
        });
        return weights;
    }

    active.forEach((i) => {
        weights[i] = clampWeight(min + ((shares[i] || 0) / sum) * range);
    });
    return weights;
}

function weightsToRangeShares(targets, activeIndices, min, max) {
    const shares = (targets || []).map(() => 0);
    (activeIndices || []).forEach((i) => {
        const target = targets[i];
        if (!target) return;
        const w = target.cardState?.directWeight ?? target.weight;
        if (isEligibleForEmphasisNormalize(w)) {
            shares[i] = weightToShare(w, min, max);
        }
    });
    return shares;
}

function weightsToRelativeShares(targets, activeIndices) {
    const shares = (targets || []).map(() => 0);
    const eligible = (activeIndices || []).filter((i) => {
        const target = targets[i];
        if (!target) return false;
        const w = target.cardState?.directWeight ?? target.weight;
        return isEligibleForEmphasisNormalize(w);
    });
    if (!eligible.length) return shares;

    const sum = eligible.reduce((s, i) => {
        const target = targets[i];
        const w = target.cardState?.directWeight ?? target.weight;
        return s + w;
    }, 0);

    if (sum <= 0) {
        const each = 100 / eligible.length;
        eligible.forEach((i) => { shares[i] = each; });
        return shares;
    }

    eligible.forEach((i) => {
        const target = targets[i];
        const w = target.cardState?.directWeight ?? target.weight;
        shares[i] = (w / sum) * 100;
    });
    return shares;
}

function weightToShare(weight, min, max, options = {}) {
    const range = max - min;
    if (range <= 0) return 100;
    const clampFn = options.normalizePrecision ? clampEmphasisWeightNormalize : clampEmphasisWeight;
    const w = clampFn(weight);
    return clampEmphasisShare(((w - min) / range) * 100);
}

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
            r = lerp(P.NEUTRAL.r, 155, t);
            g = lerp(P.NEUTRAL.g, 28, t);
            b = lerp(P.NEUTRAL.b, 28, t);
            borderR = r;
            borderG = g;
            borderB = b;
            backgroundA = t * 0.58;
            borderA = t * 0.78;
        } else {
            const hiStops = [
                { w: 2.0, r: 155, g: 28, b: 28 }, // dark red
                { w: 3.0, r: 255, g: 55, b: 45 }, // bright red
                { w: 4.0, r: 255, g: 32, b: 118 },
                { w: 5.0, r: 220, g: 48, b: 215 },
                { w: 6.0, r: 255, g: 12, b: 20 },
                { w: 7.5, r: 240, g: 0, b: 60 },
                { w: 9.0, r: 255, g: 0, b: 0 }
            ];
            const clamped = Math.max(2.0, Math.min(EMPHASIS_WEIGHT_MAX, w));
            let seg = 0;
            while (seg < hiStops.length - 1 && clamped > hiStops[seg + 1].w) {
                seg++;
            }
            const lo = hiStops[seg];
            const hi = hiStops[seg + 1];
            const segT = hi.w === lo.w ? 0 : (clamped - lo.w) / (hi.w - lo.w);
            r = lerp(lo.r, hi.r, segT);
            g = lerp(lo.g, hi.g, segT);
            b = lerp(lo.b, hi.b, segT);
            const spanT = (clamped - 2.0) / (EMPHASIS_WEIGHT_MAX - 2.0);
            backgroundA = 0.58 + (0.32 * spanT);
            borderR = Math.min(255, r + 22);
            borderG = Math.max(0, Math.round(g * 0.82));
            borderB = Math.min(255, b + 28);
            borderA = 0.78 + (0.18 * spanT);
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

    // findManagedEmphasisBlockAtCursor: public/scripts/comp/emphasisGroupIdCodec.js
    const managed = findManagedEmphasisBlockAtCursor(value, cursorPosition);
    if (managed && cursorPosition >= managed.start && cursorPosition <= managed.end) {
        const weight = Number.isFinite(managed.weight)
            ? managed.weight
            : (Number.isFinite(managed.textWeight) ? managed.textWeight : 1);
        return {
            start: managed.start,
            end: managed.end,
            weight: String(weight),
            text: managed.innerText,
            fullMatch: value.substring(managed.start, managed.end),
            isAutoTerminating: !managed.needsTerminator,
            managedId: managed.id
        };
    }
    
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

function isValidEmphasisWeightBeforeDelimiter(weight) {
    if (!weight) return false;
    return /^-?(?:0(?:\.\d+)?|[1-9]\d*(?:\.\d+)?|\.\d+)$/.test(weight);
}

function needsSpaceBeforeDoubleColon(text, index) {
    if (!text || index < 2 || text[index] !== ':' || text[index + 1] !== ':') return false;

    let j = index - 1;
    while (j >= 0 && text[j] === ' ') j--;
    if (j < 0 || !/[\d.\-]/.test(text[j])) return false;

    let digitStart = j;
    while (digitStart >= 0 && /[\d.\-]/.test(text[digitStart])) digitStart--;
    digitStart++;

    const weightStr = text.substring(digitStart, j + 1);
    const charBeforeDigits = digitStart > 0 ? text[digitStart - 1] : '';

    if (/[a-zA-Z_]/.test(charBeforeDigits)) return true;

    if (!isValidEmphasisWeightBeforeDelimiter(weightStr)) return true;

    if (digitStart === 0) return false;
    if (/[\s,]/.test(charBeforeDigits)) return false;
    if (charBeforeDigits === ':' && digitStart >= 2 && text[digitStart - 2] === ':') return false;

    return false;
}

function fixEmphasisDigitBeforeDoubleColon(text) {
    if (!text || !text.includes('::')) return text;

    const positions = [];
    for (let i = 0; i < text.length - 1; i++) {
        if (text[i] === ':' && text[i + 1] === ':') {
            positions.push(i);
            i++;
        }
    }

    for (let p = positions.length - 1; p >= 0; p--) {
        const i = positions[p];
        if (needsSpaceBeforeDoubleColon(text, i)) {
            let k = i - 1;
            while (k >= 0 && text[k] === ' ') k--;
            if (k >= i - 1) {
                text = text.slice(0, i) + ' ' + text.slice(i);
            }
        }
    }

    return text;
}

function fixEmphasisGroupCommaViolations(text) {
    if (!text || !text.includes('::')) return text;

    // Comma before any "::": "movements, ::" → "movements::", "foo, ::bar" → "foo::bar"
    text = text.replace(/([^:\d])\s*,\s*(?=::)/g, '$1');

    // Misplaced comma after next-group opener: "end:: 1.0::, start" → "end::, 1.0::start"
    text = text.replace(/(::)\s*(-?\d+(?:\.\d+)?)::\s*,\s*/g, '$1, $2::');

    // Word then weight::, text (no prior closer): "standing 1.21::, detailed" → "standing::, 1.21::detailed"
    text = text.replace(/([^\s:,]+)\s+(-?\d+(?:\.\d+)?)::,\s*/g, '$1::, $2::');

    // After outer comma, inner "::, " is duplicate: ", 3.54::, unborn" → ", 3.54::unborn"
    text = text.replace(/(,\s*)(-?\d+(?:\.\d+)?)::,\s*/g, '$1$2::');

    // Closing terminator inside a weight group: "kicking ::" → "kicking::"
    // Also: next group without comma ("kicking :: 1.1::"), comma after close ("clothed ::,"), disable close ("womb::/")
    // Never glue onto a digit — "2025 ::" must stay spaced (years / numbers are not closers to absorb).
    text = text.replace(
        /([^:,\s])\s+(::)(?=\s*(?:,\s*|\/|-?\d+(?:\.\d+)?::|\s*$))/g,
        (match, before, delim, offset, whole) => {
            if (/\d/.test(before)) return match;
            const closeIndex = offset + before.length;
            const ifStripped = whole.slice(0, closeIndex) + '::' + whole.slice(offset + match.length);
            if (needsSpaceBeforeDoubleColon(ifStripped, closeIndex)) {
                return match;
            }
            return before + delim;
        }
    );

    return text;
}

function normalizeEmphasisPromptSyntax(text, options = {}) {
    if (!text || typeof text !== 'string') return text;
    let out = fixEmphasisDigitBeforeDoubleColon(text);
    if (options.fixCommas !== false) {
        out = fixEmphasisGroupCommaViolations(out);
    }
    return out;
}

/**
 * True when the selection is an emphasis weight value being edited (not a direct-emphasis target).
 * Selection may include surrounding whitespace; must be a number with "::" immediately to the right.
 * Left side should be a weight boundary (start / whitespace / comma / prior "::"), not a glued word digit.
 */
function isSelectionEmphasisWeightValue(textarea) {
    if (!textarea) return false;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    if (start === end) return false;

    const value = textarea.value;
    const selected = value.substring(start, end);
    const trimmed = selected.trim();
    if (!/^-?\d+(?:\.\d+)?$/.test(trimmed)) return false;

    // "::" must sit immediately after the selection (weight delimiter)
    if (end >= value.length || value[end] !== ':' || value[end + 1] !== ':') return false;

    // Left of selection: allow start, whitespace, comma, or closing "::" of a prior group.
    // Reject letter/underscore glue (kuro1024::) — that is not an editable standalone weight token.
    if (start > 0) {
        const left = value[start - 1];
        if (/[a-zA-Z_]/.test(left)) return false;
        // Digits/dots immediately left mean selection is only part of a larger number — still OK to replace
        // as long as "::" is on the right (user editing part of the weight).
        if (!/[\s,]/.test(left) && !(left === ':' && start >= 2 && value[start - 2] === ':') && !/[\d.\-]/.test(left)) {
            return false;
        }
    }

    return true;
}

/**
 * Selection is numeric (whitespace ok) — typing should replace text, not apply direct emphasis.
 */
function isSelectionPlainNumberForReplace(textarea) {
    if (!textarea) return false;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    if (start === end) return false;
    const trimmed = textarea.value.substring(start, end).trim();
    return /^-?\d+(?:\.\d+)?$/.test(trimmed);
}

function formatEmphasisSplitWeight(weight) {
    const raw = String(weight ?? '').trim();
    if (/^-?\d+(?:\.\d+)?$/.test(raw)) {
        return raw;
    }
    const n = parseFloat(weight);
    if (!Number.isFinite(n)) return '1.5';
    return formatEmphasisWeightNormalize(n);
}

function buildEmphasisSplitInsert(leftPart, rightPart, weightStr, addComma) {
    let useComma = !!addComma;
    const hadTrailingSpace = /\s$/.test(leftPart);
    const hadLeadingSpace = /^\s/.test(rightPart);
    const rightStartsWithComma = /^\s*,/.test(rightPart);
    let leftCore = leftPart.replace(/\s+$/, '');
    let rightOut = rightPart;

    if (addComma) {
        useComma = true;
        if (hadLeadingSpace && !hadTrailingSpace) {
            if (leftCore && !leftCore.endsWith(',')) {
                leftCore += ',';
            }
        }
    }

    if (!useComma && /,\s+$/.test(leftPart)) {
        useComma = true;
        leftCore = leftPart.replace(/,\s+$/, '');
    } else if (!useComma && /,\s*$/.test(leftPart) && !/,\s+$/.test(leftPart)) {
        useComma = true;
        leftCore = leftPart.replace(/\s+$/, '');
    }

    // "tag|, name" → consume leading comma into insert; keep ", name" only when left already drove useComma
    if (!useComma && rightStartsWithComma) {
        useComma = true;
        rightOut = rightOut.replace(/^\s*,\s*/, '');
    }

    if (addComma && hadTrailingSpace && !hadLeadingSpace && !rightStartsWithComma) {
        const trimmedRight = rightOut.replace(/^\s+/, '');
        if (trimmedRight) {
            rightOut = `, ${trimmedRight}`;
        }
    }

    const spaceBeforeWeight = hadTrailingSpace || hadLeadingSpace;
    if (hadLeadingSpace && !rightStartsWithComma) {
        rightOut = rightOut.replace(/^\s+/, '');
    }
    if (/^\s+/.test(rightPart) && /,\s*$/.test(leftPart) && !/,\s+$/.test(leftPart)) {
        rightOut = rightPart.replace(/^\s+/, '').replace(/^,\s*/, '');
    }

    let insert;
    if (useComma) {
        // "tag, |::, w::name" — space stays on left so caret can sit after the comma
        if (leftCore.endsWith(',')) {
            leftCore += ' ';
        }
        insert = `::, ${weightStr}::`;
    } else {
        insert = '::';
        if (spaceBeforeWeight) insert += ' ';
        insert += `${weightStr}::`;
    }

    // Caret stays before insert when only the right side had space/comma (perceptual no-move)
    const caretBeforeInsert = !hadTrailingSpace && (hadLeadingSpace || rightStartsWithComma);

    return { leftCore, rightOut, insert, caretBeforeInsert };
}

function splitEmphasisBlockAtCursor(target, options = {}) {
    if (!target) return false;

    // isCursorInsideEmphasisBlock returns managed hits first (with managedId).
    // Those must use the managed splitter — classic weight.length+2 / "::" math corrupts ZWSP barriers.
    const emphasisInfo = isCursorInsideEmphasisBlock(target);
    if (emphasisInfo && emphasisInfo.managedId != null) {
        // splitManagedEmphasisBlockAtCursor: public/scripts/comp/emphasisGroupIdCodec.js
        return splitManagedEmphasisBlockAtCursor(target, options);
    }

    // Classic N:: — user may Alt+S before blur imports leftovers into managed ids
    if (emphasisInfo) {
        const value = target.value;
        const cursorPosition = target.selectionStart;
        const textStart = emphasisInfo.start + emphasisInfo.weight.length + 2;
        const cursorInText = cursorPosition - textStart;

        if (cursorInText <= 0 || cursorInText >= emphasisInfo.text.length) {
            return false;
        }

        const leftPart = emphasisInfo.text.substring(0, cursorInText);
        const rightPart = emphasisInfo.text.substring(cursorInText);
        if (!leftPart.replace(/\s+$/, '') || !rightPart.replace(/^\s+/, '').replace(/^\s*,\s*/, '')) {
            return false;
        }

        const weightStr = formatEmphasisSplitWeight(emphasisInfo.weight);
        const { leftCore, rightOut, insert, caretBeforeInsert } = buildEmphasisSplitInsert(
            leftPart, rightPart, weightStr, options.addComma
        );

        // Optional override: caret on left of typed "::" → before insert; right → after
        let placeBefore = caretBeforeInsert;
        if (options.caretSide === 'before') placeBefore = true;
        else if (options.caretSide === 'after') placeBefore = false;

        const newInner = leftCore + insert + rightOut;
        const before = value.substring(0, emphasisInfo.start);
        const blockPrefix = value.substring(emphasisInfo.start, textStart);
        const blockSuffix = emphasisInfo.isAutoTerminating
            ? value.substring(emphasisInfo.end)
            : value.substring(emphasisInfo.end - 2);

        const newValue = before + blockPrefix + newInner + blockSuffix;
        const caretBase = before.length + blockPrefix.length + leftCore.length;
        const newCaret = placeBefore ? caretBase : caretBase + insert.length;

        // setTextareaValuePreservingUndo: public/scripts/comp/textareaUtils.js
        setTextareaValuePreservingUndo(target, newValue);
        target.setSelectionRange(newCaret, newCaret);
        dispatchPromptTextareaInputEvent(target, { skipAutofill: true });

        return true;
    }

    // Managed invisible groups when classic detector missed (edge / probe cases)
    // splitManagedEmphasisBlockAtCursor: public/scripts/comp/emphasisGroupIdCodec.js
    return splitManagedEmphasisBlockAtCursor(target, options);
}

function splitEmphasisBlock(target, options = {}) {
    return splitEmphasisBlockAtCursor(target, options);
}

/** True when a weight:: group's inner text has ", "-separated parts that can be split. */
function canSplitEmphasisGroupAtCommas(target) {
    if (!target || target.type !== 'group') return false;
    const parts = String(target.innerText || '').split(', ').map((s) => s.trim()).filter(Boolean);
    return parts.length >= 2;
}

/**
 * Split a weight:: group at each ", " into separate same-weight groups.
 * @returns {string|null} new prompt value, or null if nothing to split
 */
function splitEmphasisGroupAtCommas(value, target) {
    if (!canSplitEmphasisGroupAtCommas(target)) return null;
    const text = String(value || '');
    const parts = String(target.innerText || '').split(', ').map((s) => s.trim()).filter(Boolean);
    const weightStr = formatEmphasisSplitWeight(target.weight);
    const replacement = target.needsTerminator
        ? parts.map((p) => `${weightStr}::${p}::`).join(', ')
        : parts.map((p) => `${weightStr}::${p}`).join(', ');
    return text.substring(0, target.start) + replacement + text.substring(target.end);
}

/**
 * Weight:: / managed group containing the caret (inclusive end).
 * listEditorEmphasisTargets / resolveEmphasisBagForTextarea: public/scripts/comp/emphasisGroupIdCodec.js
 */
function findEmphasisGroupTargetAtCursor(textarea) {
    if (!textarea) return null;
    const value = textarea.value || '';
    const pos = typeof textarea.selectionStart === 'number' ? textarea.selectionStart : 0;
    const bag = resolveEmphasisBagForTextarea(textarea);
    const targets = listEditorEmphasisTargets(value, bag);
    for (let i = 0; i < targets.length; i++) {
        const t = targets[i];
        if (t.type !== 'group') continue;
        if (pos >= t.start && pos <= t.end) return t;
    }
    return null;
}

function canSplitEmphasisGroupAtCommasAtCursor(textarea) {
    return canSplitEmphasisGroupAtCommas(findEmphasisGroupTargetAtCursor(textarea));
}

/**
 * Apply comma-split for a classic or managed group target. Does not refresh Weight Rack UI.
 * applyManagedEmphasisGroupSplitAtCommas: public/scripts/comp/emphasisGroupIdCodec.js
 * @returns {boolean}
 */
function applySplitEmphasisGroupAtCommas(textarea, target) {
    if (!textarea || !canSplitEmphasisGroupAtCommas(target)) return false;
    const value = textarea.value || '';

    if (target.managed && target.managedId != null) {
        // applyManagedEmphasisGroupSplitAtCommas: public/scripts/comp/emphasisGroupIdCodec.js
        return applyManagedEmphasisGroupSplitAtCommas(textarea, target);
    }

    const newValue = splitEmphasisGroupAtCommas(value, target);
    if (newValue == null || newValue === value) return false;
    // setTextareaValuePreservingUndo: public/scripts/comp/textareaUtils.js
    setTextareaValuePreservingUndo(textarea, newValue);
    // dispatchPromptTextareaInputEvent: public/scripts/comp/textareaUtils.js
    dispatchPromptTextareaInputEvent(textarea, { skipAutofill: true });
    return true;
}

/**
 * Split the emphasis group under the caret at each ", " (classic or managed).
 * refreshEmphasisGroupsToolInstancesFromForgeState: public/scripts/comp/emphasisGroupsToolManager.js
 * @returns {boolean}
 */
function splitEmphasisGroupAtCommasAtCursor(textarea) {
    const target = findEmphasisGroupTargetAtCursor(textarea);
    if (!applySplitEmphasisGroupAtCommas(textarea, target)) return false;
    // refreshEmphasisGroupsToolInstancesFromForgeState: public/scripts/comp/emphasisGroupsToolManager.js
    refreshEmphasisGroupsToolInstancesFromForgeState();
    return true;
}

/**
 * Separator between two group spans when only comma/space separates them.
 * Returns the exact between text, or null if merge is not allowed
 * (normal prompt text, newlines, tabs, etc.).
 */
function getEmphasisAdjacentGroupSeparator(value, left, right) {
    if (!left || !right || left.type !== 'group' || right.type !== 'group') return null;
    if (!(left.end <= right.start)) return null;
    const between = String(value || '').substring(left.end, right.start);
    // Merge only when separator is comma and/or space — nothing else
    if (!/^[ ,]*$/.test(between)) return null;
    return between;
}

/** True when only comma/space separate two group spans (left before right). */
function emphasisGroupsAreAdjacentInText(value, left, right) {
    return getEmphasisAdjacentGroupSeparator(value, left, right) !== null;
}

/**
 * Inner text for a merged group. Separator is taken exactly from the prompt:
 *   space only  → space
 *   comma (± spaces) → that comma/space sequence (never force a comma)
 *   nothing (abutting) → nothing
 * @returns {string|null}
 */
function buildMergedEmphasisGroupInner(value, left, right) {
    const between = getEmphasisAdjacentGroupSeparator(value, left, right);
    if (between === null) return null;
    const leftInner = String(left.innerText || '').trim();
    const rightInner = String(right.innerText || '').trim();
    if (!leftInner || !rightInner) return null;
    // Do not invent ", " — empty between stays empty
    return `${leftInner}${between}${rightInner}`;
}

/**
 * Merge two adjacent weight:: groups into one, keeping the prompt's separator.
 * Weight defaults to the average of both. Returns new prompt value or null.
 */
function mergeEmphasisAdjacentGroups(value, left, right) {
    const combined = buildMergedEmphasisGroupInner(value, left, right);
    if (combined == null) return null;

    const wLeft = Number(left.weight);
    const wRight = Number(right.weight);
    const avg = (Number.isFinite(wLeft) && Number.isFinite(wRight))
        ? (wLeft + wRight) / 2
        : (Number.isFinite(wLeft) ? wLeft : (Number.isFinite(wRight) ? wRight : 1));
    const weightStr = formatEmphasisSplitWeight(avg);
    const needsTerm = !!(left.needsTerminator || right.needsTerminator);
    const replacement = needsTerm
        ? `${weightStr}::${combined}::`
        : `${weightStr}::${combined}`;
    return String(value || '').substring(0, left.start) + replacement + String(value || '').substring(right.end);
}

/**
 * Merge-up neighbor only: the immediate previous target must be a weight:: group
 * with only comma/space between. Never skip brace/bracket (or other non-group)
 * blocks — those “prepend” the current item and block merge.
 * Returns neighbor index or -1.
 * @param {string} value
 * @param {Array} targets sorted by start
 * @param {number} index
 */
function findAdjacentEmphasisMergeNeighborIndex(value, targets, index) {
    const target = targets?.[index];
    if (!target || target.type !== 'group') return -1;
    if (index <= 0 || !Array.isArray(targets)) return -1;

    // Immediate previous target only — do not scan past braces/brackets
    const prev = targets[index - 1];
    if (!prev || prev.type !== 'group') return -1;
    if (!emphasisGroupsAreAdjacentInText(value, prev, target)) return -1;
    return index - 1;
}

function canMergeEmphasisGroupWithNeighbor(value, targets, index) {
    return findAdjacentEmphasisMergeNeighborIndex(value, targets, index) >= 0;
}

/**
 * When the user types the second ":" of "::" inside emphasis group text, treat it as Alt+S split.
 * Type-only — call from beforeinput/input when inserting exactly one ":". Never for paste.
 * @param {HTMLTextAreaElement} textarea
 * @param {{ phase?: 'beforeSecondColon'|'afterBothColons' }} [options]
 *   beforeSecondColon: beforeinput — first ":" already in value, second about to insert
 *   afterBothColons: input fallback — both ":" already inserted (mobile when beforeinput missing)
 * @returns {boolean}
 */
function tryAutoSplitEmphasisOnTypedColon(textarea, options = {}) {
    if (!textarea || textarea.selectionStart !== textarea.selectionEnd) return false;

    const phase = options.phase || 'beforeSecondColon';
    const pos = textarea.selectionStart;
    const value = textarea.value;

    let colonPos;
    let withoutColons;
    if (phase === 'afterBothColons') {
        if (pos < 2 || value.slice(pos - 2, pos) !== '::') return false;
        if (pos >= 3 && /[\d.]/.test(value[pos - 3])) return false;
        colonPos = pos - 2;
        withoutColons = value.slice(0, colonPos) + value.slice(pos);
    } else {
        if (pos < 1 || value[pos - 1] !== ':') return false;
        colonPos = pos - 1;
        if (colonPos >= 1 && /[\d.]/.test(value[colonPos - 1])) return false;
        withoutColons = value.slice(0, colonPos) + value.slice(colonPos + 1);
    }

    const probe = { value: withoutColons, selectionStart: colonPos, selectionEnd: colonPos };
    const emphasisInfo = isCursorInsideEmphasisBlock(probe);
    if (!emphasisInfo) return false;

    let leftPart;
    let rightPart;
    if (emphasisInfo.managedId != null) {
        // findManagedEmphasisBlockAtCursor: public/scripts/comp/emphasisGroupIdCodec.js
        // Classic weight.length+2 is wrong for invisible / visible managed barriers.
        const managed = findManagedEmphasisBlockAtCursor(withoutColons, colonPos);
        if (!managed || colonPos <= managed.openEnd || colonPos >= managed.closeStart) return false;
        leftPart = withoutColons.substring(managed.openEnd, colonPos);
        rightPart = withoutColons.substring(colonPos, managed.closeStart);
    } else {
        const textStart = emphasisInfo.start + emphasisInfo.weight.length + 2;
        const cursorInText = colonPos - textStart;
        if (cursorInText <= 0 || cursorInText >= emphasisInfo.text.length) return false;
        leftPart = emphasisInfo.text.substring(0, cursorInText);
        rightPart = emphasisInfo.text.substring(cursorInText);
    }
    if (!leftPart.replace(/\s+$/, '') || !rightPart.replace(/^\s+/, '').replace(/^\s*,\s*/, '')) {
        return false;
    }

    // Right of "::" (normal typing) → after insert; left-side space/comma keeps Alt+S before-insert caret
    const hadTrailingSpace = /\s$/.test(leftPart);
    const hadLeadingSpace = /^\s/.test(rightPart);
    const rightStartsWithComma = /^\s*,/.test(rightPart);
    const caretSide = (!hadTrailingSpace && (hadLeadingSpace || rightStartsWithComma))
        ? 'before'
        : 'after';

    // setTextareaValuePreservingUndo: public/scripts/comp/textareaUtils.js
    setTextareaValuePreservingUndo(textarea, withoutColons);
    textarea.setSelectionRange(colonPos, colonPos);
    return splitEmphasisBlockAtCursor(textarea, { caretSide });
}

/** True when trimmed text begins with a managed open (hidden magic or visible N:magic:). */
function nextTextStartsManagedEmphasisOpen(trimmedAfter) {
    if (!trimmedAfter) return false;
    // EMPHASIS_OPEN_MAGIC: public/scripts/comp/emphasisGroupIdCodec.js
    if (trimmedAfter.startsWith(EMPHASIS_OPEN_MAGIC)) return true;
    const weightColon = trimmedAfter.match(/^-?\d+\.?\d*:/);
    if (!weightColon) return false;
    return trimmedAfter.slice(weightColon[0].length).startsWith(EMPHASIS_OPEN_MAGIC);
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

    // Next managed open (visible 1.3:OPEN: or hidden OPEN) — same auto-term as classic N::
    if (allowAutoTerminationByNextGroup && nextTextStartsManagedEmphasisOpen(trimmedAfter)) {
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

    // Managed close delimiter ends at selectionStart
    // listManagedEmphasisBlocks: public/scripts/comp/emphasisGroupIdCodec.js
    if (hasManagedEmphasisGroupIds(textBefore)) {
        const blocks = listManagedEmphasisBlocks(textBefore);
        for (let i = 0; i < blocks.length; i++) {
            if (blocks[i].end === selectionStart) return true;
        }
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

    // listManagedEmphasisBlocks: public/scripts/comp/emphasisGroupIdCodec.js
    if (hasManagedEmphasisGroupIds(textBefore)) {
        const blocks = listManagedEmphasisBlocks(textBefore);
        for (let i = blocks.length - 1; i >= 0; i--) {
            const b = blocks[i];
            if (b.end !== selectionStart) continue;
            const w = Number.isFinite(b.textWeight) ? b.textWeight : null;
            return {
                isAtEndOfGroup: true,
                previousWeight: w != null ? String(w) : null,
                managedId: b.id
            };
        }
    }
    
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

