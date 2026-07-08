// Emphasis prompt parsing, targets, overlays, syntax fix

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

/** Minimum 1 — used so delta redistribution can account for section length. */
function getEmphasisSectionLength(innerText) {
    return Math.max(1, normalizeEmphasisInnerText(innerText).length);
}

/** Model-effective emphasis: longer sections amplify the same weight. */
function getEmphasisDeltaInfluence(weight, innerText) {
    const w = typeof weight === 'number' ? weight : parseFloat(weight);
    const safeWeight = isNaN(w) ? 1 : Math.max(0, w);
    return safeWeight * getEmphasisSectionLength(innerText);
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

function buildEmphasisTargetText(target, weight, options = {}) {
    if (target.type === 'brace') {
        return buildBraceEmphasisText(target.innerText, weight);
    }
    const weightStr = options.normalizePrecision
        ? formatEmphasisWeightNormalize(weight)
        : formatEmphasisWeight(weight);
    if (target.needsTerminator) {
        return `${weightStr}::${target.innerText}::`;
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

/** Redistribute share delta proportionally among adjustable peers; locked indices stay fixed. */
function rebalanceEmphasisSharesByDelta(shares, changedIndex, newShare, activeIndices, lockedIndices) {
    const result = shares.slice();
    const lockedSet = new Set(lockedIndices || []);
    const oldShare = shares[changedIndex] || 0;
    const clampedNew = Math.max(0, Math.min(100, newShare));
    result[changedIndex] = clampedNew;

    const delta = clampedNew - oldShare;
    if (delta === 0) return result;

    const adjustable = activeIndices.filter((i) => i !== changedIndex && !lockedSet.has(i));
    if (!adjustable.length) return result;

    if (delta > 0) {
        const othersSum = adjustable.reduce((sum, i) => sum + (shares[i] || 0), 0);
        if (othersSum <= 0) {
            const per = delta / adjustable.length;
            adjustable.forEach((i) => {
                result[i] = Math.max(0, (shares[i] || 0) - per);
            });
        } else {
            adjustable.forEach((i) => {
                const reduction = delta * ((shares[i] || 0) / othersSum);
                result[i] = Math.max(0, (shares[i] || 0) - reduction);
            });
        }
    } else {
        const gain = -delta;
        const othersSum = adjustable.reduce((sum, i) => sum + (shares[i] || 0), 0);
        if (othersSum <= 0) {
            const per = gain / adjustable.length;
            adjustable.forEach((i) => {
                result[i] = Math.min(100, (shares[i] || 0) + per);
            });
        } else {
            adjustable.forEach((i) => {
                const addition = gain * ((shares[i] || 0) / othersSum);
                result[i] = Math.min(100, (shares[i] || 0) + addition);
            });
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

/** Redistribute weight delta by each peer's weight × section length; locked indices stay fixed. */
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

    const delta = clampedNew - oldWeight;
    if (Math.abs(delta) < 0.00001) return result;

    const adjustable = activeIndices.filter((i) => i !== changedIndex && !lockedSet.has(i));
    if (!adjustable.length) return result;

    if (delta > 0) {
        const othersInfluenceSum = adjustable.reduce((sum, i) => sum + influenceAt(i, result[i]), 0);
        if (othersInfluenceSum <= 0) {
            const per = delta / adjustable.length;
            adjustable.forEach((i) => {
                result[i] = clampEmphasisWeightNormalize((result[i] || 0) - per);
            });
        } else {
            adjustable.forEach((i) => {
                const len = lengthAt(i);
                const influence = influenceAt(i, result[i]);
                const influenceReduction = delta * (influence / othersInfluenceSum);
                const newInfluence = Math.max(0, influence - influenceReduction);
                result[i] = clampEmphasisWeightNormalize(newInfluence / len);
            });
        }
    } else {
        const gain = -delta;
        const othersInfluenceSum = adjustable.reduce((sum, i) => sum + influenceAt(i, result[i]), 0);
        if (othersInfluenceSum <= 0) {
            const per = gain / adjustable.length;
            adjustable.forEach((i) => {
                result[i] = clampEmphasisWeightNormalize((result[i] || 0) + per);
            });
        } else {
            adjustable.forEach((i) => {
                const len = lengthAt(i);
                const influence = influenceAt(i, result[i]);
                const influenceGain = gain * (influence / othersInfluenceSum);
                const newInfluence = influence + influenceGain;
                result[i] = clampEmphasisWeightNormalize(newInfluence / len);
            });
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
            r = lerp(P.NEUTRAL.r, P.BRIGHT_RED.r, t);
            g = lerp(P.NEUTRAL.g, P.BRIGHT_RED.g, t);
            b = lerp(P.NEUTRAL.b, P.BRIGHT_RED.b, t);
            borderR = r;
            borderG = g;
            borderB = b;
            backgroundA = t * 0.58;
            borderA = t * 0.78;
        } else {
            const hiStops = [
                { w: 2.0, r: 255, g: 148, b: 38 },
                { w: 3.0, r: 255, g: 72, b: 48 },
                { w: 4.0, r: 255, g: 32, b: 118 },
                { w: 5.0, r: 220, g: 48, b: 215 },
                { w: 6.0, r: 255, g: 12, b: 20 }
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
            backgroundA = 0.52 + (0.45 * spanT);
            borderR = Math.min(255, r + 22);
            borderG = Math.max(0, Math.round(g * 0.82));
            borderB = Math.min(255, b + 28);
            borderA = 0.76 + (0.2 * spanT);
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

    text = text.replace(/([^:\d])\s*,\s*(?=::(\s|,|$))/g, '$1');

    text = text.replace(/(,\s*)(-?\d+(?:\.\d+)?)::,\s*/g, '$1$2::');

    text = text.replace(
        /([^:,\s])\s+(::)(?=\s*(?:,\s*|\/|-?\d+(?:\.\d+)?::|\s*$))/g,
        (match, before, delim, offset, whole) => {
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

    if (!useComma && /^\s*,/.test(rightOut)) {
        useComma = true;
    }

    if (addComma && hadTrailingSpace && !hadLeadingSpace && !/^\s*,/.test(rightPart)) {
        const trimmedRight = rightOut.replace(/^\s+/, '');
        if (trimmedRight) {
            rightOut = `, ${trimmedRight}`;
        }
    }

    const spaceBeforeWeight = hadTrailingSpace || hadLeadingSpace;
    if (hadLeadingSpace && !/^\s*,/.test(rightPart)) {
        rightOut = rightOut.replace(/^\s+/, '');
    }
    if (/^\s+/.test(rightPart) && /,\s*$/.test(leftPart) && !/,\s+$/.test(leftPart)) {
        rightOut = rightPart.replace(/^\s+/, '').replace(/^,\s*/, '');
    }

    let insert;
    if (useComma) {
        insert = leftCore.endsWith(',')
            ? ` ::, ${weightStr}::`
            : `::, ${weightStr}::`;
    } else {
        insert = '::';
        if (spaceBeforeWeight) insert += ' ';
        insert += `${weightStr}::`;
    }

    return { leftCore, rightOut, insert };
}

function splitEmphasisBlockAtCursor(target, options = {}) {
    if (!target) return false;

    const emphasisInfo = isCursorInsideEmphasisBlock(target);
    if (!emphasisInfo) return false;

    const value = target.value;
    const cursorPosition = target.selectionStart;
    const textStart = emphasisInfo.start + emphasisInfo.weight.length + 2;
    const cursorInText = cursorPosition - textStart;

    if (cursorInText < 0 || cursorInText > emphasisInfo.text.length) {
        return false;
    }

    const leftPart = emphasisInfo.text.substring(0, cursorInText);
    const rightPart = emphasisInfo.text.substring(cursorInText);
    const weightStr = formatEmphasisSplitWeight(emphasisInfo.weight);
    const { leftCore, rightOut, insert } = buildEmphasisSplitInsert(leftPart, rightPart, weightStr, options.addComma);

    const newInner = leftCore + insert + rightOut;
    const blockPrefix = value.substring(emphasisInfo.start, textStart);
    const blockSuffix = emphasisInfo.isAutoTerminating
        ? value.substring(emphasisInfo.end)
        : value.substring(emphasisInfo.end - 2);

    const newValue = blockPrefix + newInner + blockSuffix;

    // setTextareaValuePreservingUndo: public/scripts/comp/textareaUtils.js
    setTextareaValuePreservingUndo(target, newValue);
    target.setSelectionRange(cursorPosition, cursorPosition);
    dispatchPromptTextareaInputEvent(target, { skipAutofill: true });

    return true;
}

function splitEmphasisBlock(target, options = {}) {
    return splitEmphasisBlockAtCursor(target, options);
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

