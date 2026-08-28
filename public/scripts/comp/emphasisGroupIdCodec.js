/**
 * Client mirror of modules/emphasisGroupIdSyntax.js (invisible managed emphasis ids).
 * KEEP IN SYNC with the server module — builders emit no colons; scanner also accepts legacy :magic+bits:.
 *
 * Also exposes developer console helpers:
 *   debugConvertManualPromptsToManagedEmphasis()
 *   debugExpandManagedEmphasisLocally(text, bag, fieldHint)
 */

const EMPHASIS_GROUP_ID_BITS = 8;
const EMPHASIS_GROUP_ID_MAX = (1 << EMPHASIS_GROUP_ID_BITS) - 1;

const EMPHASIS_ZW = {
    WJ: '\u2060',
    OPEN: '\u2063',
    CLOSE: '\u2064',
    BIT0: '\u200B',
    BIT1: '\u200C'
};

const EMPHASIS_OPEN_MAGIC = EMPHASIS_ZW.WJ + EMPHASIS_ZW.OPEN;
const EMPHASIS_CLOSE_MAGIC = EMPHASIS_ZW.WJ + EMPHASIS_ZW.CLOSE;

const EMPHASIS_MANAGED_INVISIBLE_SET = new Set([
    EMPHASIS_ZW.WJ, EMPHASIS_ZW.OPEN, EMPHASIS_ZW.CLOSE, EMPHASIS_ZW.BIT0, EMPHASIS_ZW.BIT1,
    '\u200D', '\uFEFF', '\u2061', '\u2062', '\u00AD'
]);

function encodeEmphasisGroupIdBits(id) {
    const n = Math.max(0, Math.min(EMPHASIS_GROUP_ID_MAX, id | 0));
    let bits = '';
    for (let i = EMPHASIS_GROUP_ID_BITS - 1; i >= 0; i--) {
        bits += (n >> i) & 1 ? EMPHASIS_ZW.BIT1 : EMPHASIS_ZW.BIT0;
    }
    return bits;
}

function decodeEmphasisGroupIdBits(bits) {
    if (!bits || bits.length !== EMPHASIS_GROUP_ID_BITS) return null;
    let n = 0;
    for (let i = 0; i < bits.length; i++) {
        const ch = bits[i];
        if (ch === EMPHASIS_ZW.BIT1) n = (n << 1) | 1;
        else if (ch === EMPHASIS_ZW.BIT0) n = (n << 1);
        else return null;
    }
    return n;
}

function buildEmphasisGroupOpenDelim(id) {
    return EMPHASIS_OPEN_MAGIC + encodeEmphasisGroupIdBits(id);
}

function buildEmphasisGroupCloseDelim(id) {
    return EMPHASIS_CLOSE_MAGIC + encodeEmphasisGroupIdBits(id);
}

function buildManagedEmphasisGroupText(id, innerText, options = {}) {
    const mode = options.mode === 'visible' ? 'visible' : 'hidden';
    const body = String(innerText ?? '');
    const openCore = EMPHASIS_OPEN_MAGIC + encodeEmphasisGroupIdBits(id);
    const closeCore = EMPHASIS_CLOSE_MAGIC + encodeEmphasisGroupIdBits(id);
    if (mode === 'visible') {
        const w = formatClassicEmphasisWeight(options.weight ?? 1);
        const open = `:${openCore}:`;
        if (options.omitClose) return `${w}${open}${body}`;
        return `${w}${open}${body}:${closeCore}:`;
    }
    if (options.omitClose) return openCore + body;
    return openCore + body + closeCore;
}

function hasManagedEmphasisGroupIds(text) {
    if (!text || typeof text !== 'string') return false;
    return text.includes(EMPHASIS_OPEN_MAGIC) || text.includes(EMPHASIS_CLOSE_MAGIC);
}

function listManagedEmphasisDelimiters(text) {
    const opens = [];
    const closes = [];
    if (!text || typeof text !== 'string') return { opens, closes };

    const magicLen = EMPHASIS_OPEN_MAGIC.length;
    const idLen = EMPHASIS_GROUP_ID_BITS;
    const invisibleDelimLen = magicLen + idLen;

    for (let i = 0; i <= text.length - invisibleDelimLen; i++) {
        if (text[i] !== EMPHASIS_ZW.WJ) continue;
        const magic = text.substring(i, i + magicLen);
        let kind = null;
        if (magic === EMPHASIS_OPEN_MAGIC) kind = 'open';
        else if (magic === EMPHASIS_CLOSE_MAGIC) kind = 'close';
        else continue;

        const bitsStart = i + magicLen;
        const bits = text.substring(bitsStart, bitsStart + idLen);
        const id = decodeEmphasisGroupIdBits(bits);
        if (id === null) continue;

        const bitsEnd = bitsStart + idLen;
        const legacy = i > 0 && text[i - 1] === ':' && bitsEnd < text.length && text[bitsEnd] === ':';
        let index = legacy ? i - 1 : i;
        let end = legacy ? bitsEnd + 1 : bitsEnd;
        let textWeight = null;
        if (legacy && kind === 'open') {
            const colonAt = i - 1;
            let j = colonAt - 1;
            while (j >= 0 && ((text[j] >= '0' && text[j] <= '9') || text[j] === '.')) j--;
            if (j >= 0 && text[j] === '-') j--;
            const weightCandidate = text.slice(j + 1, colonAt);
            if (/^-?\d+(?:\.\d+)?$/.test(weightCandidate)) {
                index = j + 1;
                textWeight = parseFloat(weightCandidate);
            }
        }

        const entry = { index, end, id, kind, legacy: !!legacy, textWeight };
        if (kind === 'open') opens.push(entry);
        else closes.push(entry);
        i = end - 1;
    }
    return { opens, closes };
}

function listManagedEmphasisBlocks(text) {
    const { opens, closes } = listManagedEmphasisDelimiters(text);
    const usedCloses = new Set();
    const blocks = [];

    for (const open of opens) {
        let close = null;
        for (let c = 0; c < closes.length; c++) {
            if (usedCloses.has(c)) continue;
            const cand = closes[c];
            if (cand.id !== open.id) continue;
            if (cand.index < open.end) continue;
            close = cand;
            usedCloses.add(c);
            break;
        }

        let contentStart = open.end;
        let contentEnd;
        let end;
        let needsTerminator = false;

        if (close) {
            contentEnd = close.index;
            end = close.end;
            needsTerminator = true;
        } else {
            let nextOpenAt = text.length;
            for (const o of opens) {
                if (o.index > open.index && o.index < nextOpenAt) nextOpenAt = o.index;
            }
            contentEnd = nextOpenAt;
            end = nextOpenAt;
            needsTerminator = false;
        }

        blocks.push({
            id: open.id,
            start: open.index,
            end,
            openEnd: open.end,
            closeStart: close ? close.index : end,
            innerText: text.substring(contentStart, contentEnd),
            needsTerminator,
            legacy: !!open.legacy,
            textWeight: Number.isFinite(open.textWeight) ? open.textWeight : null
        });
    }

    return blocks.sort((a, b) => a.start - b.start);
}

/**
 * Close delimiters not claimed by open→close pairing (wrong id sitting inside an
 * auto-terminated open’s span is the usual Token Analysis leftover-<unk> case).
 */
function listUnpairedManagedEmphasisCloses(text) {
    if (!text || !hasManagedEmphasisGroupIds(text)) return [];
    const { opens, closes } = listManagedEmphasisDelimiters(text);
    const used = new Set();
    for (const open of opens) {
        for (let c = 0; c < closes.length; c++) {
            if (used.has(c)) continue;
            const cand = closes[c];
            if (cand.id !== open.id) continue;
            if (cand.index < open.end) continue;
            used.add(c);
            break;
        }
    }
    return closes.filter((_d, c) => !used.has(c));
}

/** Remove unpaired closes; returns { text, removed: number, orphanIds: number[] }. */
function removeUnpairedManagedEmphasisCloses(text) {
    const value = String(text || '');
    const orphans = listUnpairedManagedEmphasisCloses(value).sort((a, b) => b.index - a.index);
    if (!orphans.length) {
        return { text: value, removed: 0, orphanIds: [] };
    }
    let out = value;
    for (const d of orphans) {
        out = out.slice(0, d.index) + out.slice(d.end);
    }
    return {
        text: out,
        removed: orphans.length,
        orphanIds: orphans.map((d) => d.id)
    };
}

function formatClassicEmphasisWeight(weight) {
    const n = typeof weight === 'number' ? weight : parseFloat(weight);
    if (!Number.isFinite(n)) return '1';
    const rounded = Math.round(n * 10000) / 10000;
    return String(parseFloat(rounded.toFixed(4)));
}

/**
 * Closed classic wire form. If the body ends with a digit, keep a space before "::"
 * so parsers do not treat "2025::" as a new weight opener (e.g. "3::year 2025 ::").
 */
function formatClassicClosedEmphasisGroup(weightStr, innerText) {
    let inner = String(innerText ?? '');
    const core = inner.replace(/[ \t]+$/, '');
    if (/\d$/.test(core)) {
        inner = `${core} `;
    }
    return `${weightStr}::${inner}::`;
}

function resolveWeightForEmphasisGroupId(id, weightSource) {
    if (!weightSource || typeof weightSource !== 'object') return null;

    if (weightSource.groupsById && typeof weightSource.groupsById === 'object') {
        const entry = weightSource.groupsById[id] ?? weightSource.groupsById[String(id)];
        if (typeof entry === 'number' && Number.isFinite(entry)) return entry;
        if (entry && typeof entry === 'object') {
            const w = entry.weight ?? entry.directWeight;
            if (typeof w === 'number' && Number.isFinite(w)) return w;
        }
    }

    if (weightSource.weightsById && typeof weightSource.weightsById === 'object') {
        const w = weightSource.weightsById[id] ?? weightSource.weightsById[String(id)];
        if (typeof w === 'number' && Number.isFinite(w)) return w;
    }

    const direct = weightSource[id] ?? weightSource[String(id)];
    if (typeof direct === 'number' && Number.isFinite(direct)) return direct;
    return null;
}

const EMPHASIS_NORM_FIELD_HINT_ALIASES = {
    prompt: ['manualPrompt', 'input_prompt'],
    uc: ['manualUc', 'input_uc', 'negative_prompt'],
    prompt_negative: ['manualPromptNegative', 'input_prompt_negative']
};

function coalesceEmphasisWeightSource(emphasisNormalization, fieldHint) {
    if (!emphasisNormalization || typeof emphasisNormalization !== 'object') return null;
    if (emphasisNormalization.groupsById || emphasisNormalization.weightsById) {
        return emphasisNormalization;
    }
    if (fieldHint) {
        const candidates = [fieldHint].concat(EMPHASIS_NORM_FIELD_HINT_ALIASES[fieldHint] || []);
        for (const key of candidates) {
            if (emphasisNormalization[key]) {
                return coalesceEmphasisWeightSource(emphasisNormalization[key], null);
            }
        }
    }
    const merged = { groupsById: {} };
    let any = false;
    for (const value of Object.values(emphasisNormalization)) {
        if (!value || typeof value !== 'object') continue;
        const bag = value.groupsById || value.weightsById;
        if (!bag || typeof bag !== 'object') continue;
        any = true;
        if (value.groupsById) {
            Object.assign(merged.groupsById, value.groupsById);
        } else {
            Object.entries(value.weightsById).forEach(([k, w]) => {
                merged.groupsById[k] = { weight: w };
            });
        }
    }
    return any ? merged : null;
}

function expandEmphasisGroupIds(text, weightSource, options = {}) {
    if (!text || typeof text !== 'string') {
        return { text, warnings: [], expanded: 0 };
    }
    if (!hasManagedEmphasisGroupIds(text)) {
        return { text, warnings: [], expanded: 0 };
    }

    const blocks = listManagedEmphasisBlocks(text);
    if (!blocks.length) {
        return { text, warnings: ['managed_magic_without_blocks'], expanded: 0 };
    }

    const warnings = [];
    let expanded = 0;
    let out = text;
    for (let i = blocks.length - 1; i >= 0; i--) {
        const block = blocks[i];
        let weight = resolveWeightForEmphasisGroupId(block.id, weightSource);
        if ((weight === null || weight === undefined) && Number.isFinite(block.textWeight)) {
            weight = block.textWeight;
        }
        let replacement;
        if (weight === null || weight === undefined) {
            warnings.push(`missing_weight_for_id_${block.id}`);
            replacement = block.innerText;
        } else {
            const wStr = formatClassicEmphasisWeight(weight);
            if (block.needsTerminator || options.alwaysTerminate) {
                // formatClassicClosedEmphasisGroup: keep space before :: when body ends in a digit
                replacement = formatClassicClosedEmphasisGroup(wStr, block.innerText);
            } else {
                replacement = `${wStr}::${block.innerText}`;
            }
            expanded++;
        }
        out = out.slice(0, block.start) + replacement + out.slice(block.end);
    }

    return { text: out, warnings, expanded };
}

function stripUnmanagedEmphasisInvisibles(text) {
    if (!text || typeof text !== 'string') return text;
    if (![...EMPHASIS_MANAGED_INVISIBLE_SET].some((ch) => text.includes(ch))) return text;

    const { opens, closes } = listManagedEmphasisDelimiters(text);
    const protectedRanges = [];
    opens.forEach((d) => protectedRanges.push([d.index, d.end]));
    closes.forEach((d) => protectedRanges.push([d.index, d.end]));
    protectedRanges.sort((a, b) => a[0] - b[0]);

    const isProtected = (idx) => {
        for (const [start, end] of protectedRanges) {
            if (idx >= start && idx < end) return true;
            if (start > idx) break;
        }
        return false;
    };

    let out = '';
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (EMPHASIS_MANAGED_INVISIBLE_SET.has(ch) && !isProtected(i)) continue;
        out += ch;
    }
    return out;
}

function assertNoManagedEmphasisGroupIds(text) {
    if (!text || typeof text !== 'string') {
        return { text, strippedCount: 0 };
    }
    if (!hasManagedEmphasisGroupIds(text)) {
        return { text, strippedCount: 0 };
    }

    const { opens, closes } = listManagedEmphasisDelimiters(text);
    const ranges = [...opens, ...closes].sort((a, b) => b.index - a.index);
    let out = text;
    let strippedCount = 0;
    for (const d of ranges) {
        out = out.slice(0, d.index) + out.slice(d.end);
        strippedCount++;
    }
    if (out.includes(EMPHASIS_OPEN_MAGIC) || out.includes(EMPHASIS_CLOSE_MAGIC)) {
        out = out.split(EMPHASIS_OPEN_MAGIC).join('').split(EMPHASIS_CLOSE_MAGIC).join('');
        strippedCount++;
    }
    return { text: out, strippedCount };
}

function prepareEmphasisTextForNovelAI(text, emphasisNormalization, fieldHint) {
    const weightSource = coalesceEmphasisWeightSource(emphasisNormalization, fieldHint);
    const expanded = expandEmphasisGroupIds(text, weightSource);
    let out = expanded.text;
    out = stripUnmanagedEmphasisInvisibles(out);
    const asserted = assertNoManagedEmphasisGroupIds(out);
    return {
        text: asserted.text,
        expanded: expanded.expanded,
        warnings: expanded.warnings,
        strippedLeftoverDelims: asserted.strippedCount
    };
}

/** Strip managed delimiters for token counting (inner text kept). */
function stripManagedEmphasisDelimitersForCounting(text) {
    if (!text || typeof text !== 'string') return text;
    if (!hasManagedEmphasisGroupIds(text)) return text;
    const blocks = listManagedEmphasisBlocks(text);
    let out = text;
    for (let i = blocks.length - 1; i >= 0; i--) {
        const block = blocks[i];
        out = out.slice(0, block.start) + block.innerText + out.slice(block.end);
    }
    // Drop orphan / unmatched delims too — stripUnmanaged protects listed opens/closes,
    // which would leave ZW as <unk> after counting (see character_0_prompt dump).
    out = stripUnmanagedEmphasisInvisibles(out);
    return assertNoManagedEmphasisGroupIds(out).text;
}

/** True when trimmed text ends with classic :: or a managed group close (needsComma guards). */
function textEndsWithEmphasisGroupClose(text) {
    const t = String(text || '').trim();
    if (!t) return false;
    if (t.endsWith('::')) return true;
    if (!hasManagedEmphasisGroupIds(t)) return false;
    const blocks = listManagedEmphasisBlocks(t);
    for (let i = blocks.length - 1; i >= 0; i--) {
        if (blocks[i].end === t.length) return true;
    }
    return false;
}

/**
 * Resolve forge bag for a textarea (id + dual-write aliases).
 * getEmphasisNormalizationFieldStore: public/scripts/comp/emphasisGroupsToolManager.js
 */
function resolveEmphasisBagForTextarea(textarea) {
    const fieldKey = textarea && textarea.id ? textarea.id : '';
    if (!fieldKey) return null;
    // getEmphasisNormalizationFieldStore: public/scripts/comp/emphasisGroupsToolManager.js
    const store = getEmphasisNormalizationFieldStore();
    if (store[fieldKey]) return store[fieldKey];
    const dualKeys = getEmphasisNormalizationDualWriteKeys(fieldKey);
    for (let i = 0; i < dualKeys.length; i++) {
        if (store[dualKeys[i]]) return store[dualKeys[i]];
    }
    return null;
}

/**
 * Editor target list: managed id groups (+ braces) when present, else classic listAllEmphasisTargets.
 * listAllEmphasisTargets / listBraceEmphasisTargets: public/scripts/comp/emphasisParse.js
 */
function listEditorEmphasisTargets(value, weightSource) {
    if (!value) return [];
    if (!hasManagedEmphasisGroupIds(value)) {
        return listAllEmphasisTargets(value);
    }
    const bag = weightSource || null;
    const groups = listManagedEmphasisBlocks(value).map((b) => {
        const resolved = resolveWeightForEmphasisGroupId(b.id, bag);
        return {
            type: 'group',
            managed: true,
            managedId: b.id,
            start: b.start,
            end: b.end,
            openEnd: b.openEnd,
            closeStart: b.closeStart,
            weight: Number.isFinite(resolved) ? resolved : 1,
            innerText: b.innerText,
            needsTerminator: b.needsTerminator
        };
    });
    const groupSpans = groups.map((g) => ({ start: g.start, end: g.end }));
    // listBraceEmphasisTargets: public/scripts/comp/emphasisParse.js
    const braces = listBraceEmphasisTargets(value, groupSpans);
    return [...groups, ...braces].sort((a, b) => a.start - b.start);
}

function findManagedEmphasisBlockAtCursor(value, cursorPosition, weightSource) {
    if (!hasManagedEmphasisGroupIds(value)) return null;
    const blocks = listManagedEmphasisBlocks(value);
    const block = blocks.find((b) => cursorPosition >= b.start && cursorPosition <= b.end);
    if (!block) return null;
    const resolved = resolveWeightForEmphasisGroupId(block.id, weightSource);
    const weight = Number.isFinite(resolved)
        ? resolved
        : (Number.isFinite(block.textWeight) ? block.textWeight : 1);
    return {
        id: block.id,
        start: block.start,
        end: block.end,
        openEnd: block.openEnd,
        closeStart: block.closeStart,
        innerText: block.innerText,
        weight,
        needsTerminator: block.needsTerminator,
        legacy: !!block.legacy
    };
}

function listManagedEmphasisInvisibleSpans(text) {
    if (!hasManagedEmphasisGroupIds(text)) return [];
    const { opens, closes } = listManagedEmphasisDelimiters(text);
    const spans = [];
    opens.concat(closes).forEach((d) => {
        // Visible mode open includes weight digits in d.index.. — only protect :MAGIC+bits:
        let start = d.index;
        if (d.kind === 'open' && d.legacy && Number.isFinite(d.textWeight)) {
            let colon = d.index;
            while (colon < d.end && text[colon] !== ':') colon++;
            start = colon;
        }
        spans.push({ start, end: d.end, kind: d.kind });
    });
    return spans.sort((a, b) => a.start - b.start);
}

/** True for managed delimiter glyphs only (not regular spaces). */
function isManagedInvisibleChar(ch) {
    return EMPHASIS_MANAGED_INVISIBLE_SET.has(ch);
}

/** ZWSP delimiters only — regular spaces between groups must stay parkable. */
function isManagedCaretSkipChar(ch) {
    return isManagedInvisibleChar(ch);
}

/** True when `index` is already followed by a comma (spaces/tabs ignored). */
function hasAdjacentCommaAt(text, index) {
    let i = Math.max(0, Math.min(String(text || '').length, index | 0));
    const s = String(text || '');
    while (i < s.length && (s[i] === ' ' || s[i] === '\t')) i++;
    return i < s.length && s[i] === ',';
}

/** True when `index` is already followed by a space/tab (ZWSP delimiters are not spaces). */
function hasAdjacentSpaceAt(text, index) {
    const s = String(text || '');
    const i = Math.max(0, Math.min(s.length, index | 0));
    return i < s.length && (s[i] === ' ' || s[i] === '\t');
}

/**
 * Blur-only: strip inner leading junk + trailing commas/spaces. Relocate a trailing
 * separator outside the close when the host is not already followed by one.
 * Digit-ending bodies keep one inner space ("2025 ::") and only move leftover spaces.
 * Do not run while focused — a trailing space may still be the next inner word.
 */
function resolveTrimmedEmphasisInner(inner, hostText, afterIndex) {
    const t = String(inner || '').replace(/^[ \t,]+/g, '');
    const core = t.replace(/[ \t,]+$/g, '');
    const trailing = t.slice(core.length);
    const keepInnerSpace = /\d$/.test(core);
    const trimmed = keepInnerSpace ? `${core} ` : core;
    let outsideSuffix = '';
    if (/[,]/.test(trailing) && !hasAdjacentCommaAt(hostText, afterIndex)) {
        outsideSuffix = ', ';
    } else if (/[ \t]/.test(trailing) && !hasAdjacentSpaceAt(hostText, afterIndex)) {
        const extra = keepInnerSpace ? trailing.replace(/^[ \t]/, '') : trailing;
        if (!keepInnerSpace || /[ \t]/.test(extra)) {
            outsideSuffix = ' ';
        }
    }
    return { trimmed, outsideSuffix };
}

/**
 * Trim leading/trailing spaces and commas inside managed group bodies (keep internal commas/spaces).
 * Prevents "word␠[close]" where Backspace at the outer edge deletes ZWSP instead of the space,
 * and blur leftovers like "double chin,<ZWSPEND>" where protectEmphasisSpansForCommaFormat
 * would otherwise leave the trailing comma inside the protected span.
 *
 * Trailing inner commas/spaces: if the same separator is already outside after the group,
 * strip from inside. If not, move it outside after the close so the separator is not lost.
 *
 * Auto-terminated groups (omitClose) extend to the next open's start, so a trailing ", "
 * before `1.3:…` is an inter-group separator — keep it or blur merges `crazy1.3:`.
 */
function trimManagedEmphasisInnerEdges(text) {
    if (!text || !hasManagedEmphasisGroupIds(text)) return text;
    const blocks = listManagedEmphasisBlocks(text);
    let out = text;
    for (let i = blocks.length - 1; i >= 0; i--) {
        const b = blocks[i];
        const inner = String(b.innerText || '');
        // Next managed group starts exactly where this auto-term span ends.
        const abutsNextManaged = !b.needsTerminator
            && blocks.some((other) => other.start === b.end && other.id !== b.id);
        let trimmed;
        let outsideSuffix = '';
        if (abutsNextManaged) {
            const strippedLead = inner.replace(/^[ \t,]+/g, '');
            // Empty auto-term tails are inter-group separators — keep them for empty-block removal.
            trimmed = strippedLead ? strippedLead : inner;
        } else {
            const resolved = resolveTrimmedEmphasisInner(inner, out, b.end);
            trimmed = resolved.trimmed;
            outsideSuffix = resolved.outsideSuffix;
        }
        if (trimmed === inner && !outsideSuffix) continue;
        const open = out.slice(b.start, b.openEnd);
        const close = out.slice(b.closeStart, b.end);
        out = out.slice(0, b.start) + open + trimmed + close + outsideSuffix + out.slice(b.end);
    }
    return out;
}

/**
 * Trim leading/trailing spaces and commas inside classic N::…:: bodies (same blur cleanup as managed).
 * Trailing inner commas/spaces move outside when no adjacent outside separator follows the group.
 */
function trimClassicEmphasisInnerEdges(text) {
    if (!text || !text.includes('::')) return text;
    return text.replace(/(-?\d+\.?\d*)::([^:]*?)::/g, (match, weight, inner, offset, full) => {
        const resolved = resolveTrimmedEmphasisInner(inner, full, offset + match.length);
        if (resolved.trimmed === inner && !resolved.outsideSuffix) return match;
        // formatClassicClosedEmphasisGroup: public/scripts/comp/emphasisGroupIdCodec.js
        return formatClassicClosedEmphasisGroup(weight, resolved.trimmed) + resolved.outsideSuffix;
    });
}

/** True when a group body has no visible tag text (only spaces, tabs, commas). */
function isEmptyEmphasisInnerText(inner) {
    return !String(inner || '').replace(/[ \t,]+/g, '');
}

/**
 * Join left/right after deleting an empty emphasis span. Collapses duplicated
 * commas/pipes and avoids gluing adjacent tags into one word.
 */
function joinAfterEmphasisBlockRemoval(left, right) {
    const leftSpace = /[ \t]+$/.test(left);
    const rightSpace = /^[ \t]+/.test(right);
    const L = String(left || '').replace(/[ \t]+$/, '');
    let R = String(right || '').replace(/^[ \t]+/, '');
    if (!R.replace(/[ \t,|]+/g, '')) R = '';
    const leftComma = /,$/.test(L);
    const rightComma = /^,/.test(R);
    const leftPipe = /\|$/.test(L);
    const rightPipe = /^\|/.test(R);

    if (leftComma && rightComma) {
        R = R.replace(/^,\s*/, '');
        return R ? `${L} ${R}` : L.replace(/,+$/, '');
    }
    if (leftPipe && rightPipe) {
        R = R.replace(/^\|\s*/, '');
        return R ? `${L} ${R}` : L.replace(/\|+$/, '');
    }
    if (leftComma && !R) return L.replace(/,+$/, '');
    if (rightComma && !L) return R.replace(/^,+/, '').replace(/^[ \t]+/, '');
    if (leftPipe && !R) return L.replace(/\|+$/, '');
    if (rightPipe && !L) return R.replace(/^\|+/, '').replace(/^[ \t]+/, '');
    if ((leftComma || leftPipe) && R) return `${L} ${R}`;

    const lCh = L.slice(-1);
    const rCh = R.charAt(0);
    if (lCh && rCh && /[^\s,|]/.test(lCh) && /[^\s,|]/.test(rCh)) {
        return `${L} ${R}`;
    }
    if ((leftSpace || rightSpace) && L && R && !/[\n,|]$/.test(L) && !/^[\n,|]/.test(R)) {
        return `${L} ${R}`;
    }
    return L + R;
}

/**
 * Drop closed/auto-term classic groups whose inner text is empty or comma/space only.
 * listEmphasisBlocks: public/scripts/comp/emphasisParse.js
 */
function removeEmptyClassicEmphasisGroups(text) {
    const value = String(text || '');
    if (!value.includes('::')) return value;
    let out = value;
    for (let guard = 0; guard < 256; guard++) {
        const empty = listEmphasisBlocks(out).filter((b) => isEmptyEmphasisInnerText(b.innerText));
        if (!empty.length) break;
        const b = empty[empty.length - 1];
        const next = joinAfterEmphasisBlockRemoval(out.slice(0, b.start), out.slice(b.end));
        if (next === out) break;
        out = next;
    }
    return out;
}

/**
 * Drop paired/auto-term managed ZWSP groups with no visible inner text.
 * Invisible empty OPEN…CLOSE spans steal caret/selection even though they look blank.
 */
function removeEmptyManagedEmphasisBlocks(text) {
    const value = String(text || '');
    if (!value || !hasManagedEmphasisGroupIds(value)) {
        return { text: value, removed: 0, removedIds: [] };
    }
    let out = value;
    const removedIds = [];
    for (let guard = 0; guard < 256; guard++) {
        const empty = listManagedEmphasisBlocks(out).filter((b) => isEmptyEmphasisInnerText(b.innerText));
        if (!empty.length) break;
        const b = empty[empty.length - 1];
        // Auto-term empty: drop only the open delimiter so an inner ", " stays between groups.
        const to = b.needsTerminator ? b.end : b.openEnd;
        const next = joinAfterEmphasisBlockRemoval(out.slice(0, b.start), out.slice(to));
        if (next === out) break;
        out = next;
        removedIds.push(b.id);
    }
    removedIds.reverse();
    return { text: out, removed: removedIds.length, removedIds };
}

/**
 * Blur/format settle for managed ZWSP: drop unpaired closes, strip dead invisibles,
 * trim inner edge commas/spaces, then delete empty groups. Orphan closes must be
 * removed before stripUnmanaged (strip protects all listed closes, including unpaired).
 */
function normalizeManagedEmphasisEditorText(text) {
    const original = String(text || '');
    let out = original;
    const orphanHeal = removeUnpairedManagedEmphasisCloses(out);
    out = orphanHeal.text;
    out = stripUnmanagedEmphasisInvisibles(out);
    out = trimManagedEmphasisInnerEdges(out);
    const emptyHeal = removeEmptyManagedEmphasisBlocks(out);
    out = emptyHeal.text;
    return {
        text: out,
        changed: out !== original,
        orphanClosesRemoved: orphanHeal.removed,
        orphanIds: orphanHeal.orphanIds,
        emptyBlocksRemoved: emptyHeal.removed,
        emptyBlockIds: emptyHeal.removedIds
    };
}

/** Drop spaces/tabs immediately after an open-delimiter index (content start). */
function trimSpacesAfterManagedOpen(text, openEnd) {
    let i = Math.max(0, Math.min(openEnd, (text || '').length));
    while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i++;
    if (i === openEnd) return { text, openEnd, removed: 0 };
    return {
        text: text.slice(0, openEnd) + text.slice(i),
        openEnd,
        removed: i - openEnd
    };
}

/**
 * True when `pos` is the seam between a close delimiter and the next group's open
 * (abutting groups with nothing between — including no comma/space).
 */
function isManagedAbuttingGroupSeam(spans, pos) {
    if (!spans || !spans.length) return false;
    const p = pos | 0;
    return !!spans.find((s) => s.kind === 'close' && s.end === p)
        && !!spans.find((s) => s.kind === 'open' && s.start === p);
}

/**
 * After crossing a barrier, keep going past ZWSP (and any adjacent barriers)
 * so one arrow press lands on the next visible character.
 * Stops at an abutting close|open seam so the caret can park between two groups.
 * Regular spaces are not skipped — they are the separator between groups.
 */
function resolveCaretAfterManagedJump(text, pos, dir, spans) {
    let i = Math.max(0, Math.min(text.length, pos));
    // Already on a group seam — do not tunnel into the neighbor.
    if (isManagedAbuttingGroupSeam(spans, i)) return i;
    for (let guard = 0; guard < 64; guard++) {
        if (dir > 0) {
            while (i < text.length && isManagedCaretSkipChar(text[i])) i++;
        } else {
            while (i > 0 && isManagedCaretSkipChar(text[i - 1])) i--;
        }
        if (isManagedAbuttingGroupSeam(spans, i)) return i;
        let hit = null;
        for (let s = 0; s < spans.length; s++) {
            const span = spans[s];
            if (dir > 0 && i >= span.start && i < span.end) {
                hit = span;
                break;
            }
            if (dir < 0 && i > span.start && i <= span.end) {
                hit = span;
                break;
            }
        }
        if (!hit) break;
        const next = dir > 0 ? hit.end : hit.start;
        // Leaving a close into an abutting open (or open into abutting close): park on the seam.
        if (dir > 0 && hit.kind === 'close' && isManagedAbuttingGroupSeam(spans, next)) return next;
        if (dir < 0 && hit.kind === 'open' && isManagedAbuttingGroupSeam(spans, next)) return next;
        i = next;
    }
    return i;
}

/** Find the outermost delimiter edge behind (Backspace) or ahead (Delete) of pos. */
function resolveManagedDeleteSkipEdge(text, pos, dir, spans) {
    let i = Math.max(0, Math.min(text.length, pos));
    for (let guard = 0; guard < 32; guard++) {
        if (dir < 0) {
            if (i <= 0 || !isManagedInvisibleChar(text[i - 1])) break;
            let hit = null;
            for (let s = 0; s < spans.length; s++) {
                const span = spans[s];
                if (i > span.start && i <= span.end) {
                    hit = span;
                    break;
                }
            }
            i = hit ? hit.start : i - 1;
        } else {
            if (i >= text.length || !isManagedInvisibleChar(text[i])) break;
            let hit = null;
            for (let s = 0; s < spans.length; s++) {
                const span = spans[s];
                if (i >= span.start && i < span.end) {
                    hit = span;
                    break;
                }
            }
            i = hit ? hit.end : i + 1;
        }
    }
    return i;
}

/** Close token for an id in the textarea's current syntax mode. */
function buildManagedEmphasisCloseToken(id, mode) {
    const core = buildEmphasisGroupCloseDelim(id);
    return mode === 'visible' ? `:${core}:` : core;
}

/** Shared post-mutate refresh for managed boundary edits. */
function refreshManagedEmphasisFieldAfterBoundaryEdit(textarea, caretDir) {
    if (Number.isFinite(caretDir)) {
        textarea._managedCaretMoveDir = caretDir;
    }
    // dispatchPromptTextareaInputEvent: public/scripts/comp/emphasisParse.js
    dispatchPromptTextareaInputEvent(textarea, { skipAutofill: true });
    if (typeof updateEmphasisHighlighting === 'function') {
        updateEmphasisHighlighting(textarea);
    }
    // refreshEmphasisGroupsToolInstancesFromForgeState: public/scripts/comp/emphasisGroupsToolManager.js
    if (typeof refreshEmphasisGroupsToolInstancesFromForgeState === 'function') {
        refreshEmphasisGroupsToolInstancesFromForgeState();
    }
    if (typeof promptTextareaToolbar !== 'undefined' && promptTextareaToolbar) {
        promptTextareaToolbar.updateEmphasisGroupChip(
            textarea,
            promptTextareaToolbar.getToolbarFromTextarea(textarea)
        );
    }
}

/**
 * Place or move the managed close (end marker) at insertAt within a known block on `value`.
 * @param {{ removeIfAtEnd?: boolean, exitedFrom?: number }} [options]
 *   removeIfAtEnd — Trim end menu: toggle-remove when already at close
 *   exitedFrom — start index for text that leaves the group (default insertAt); typed "::"
 *     uses colonPos so spaces glued before "::" are dropped
 * @returns {boolean}
 */
function placeManagedEmphasisCloseInText(textarea, value, live, insertAt, options = {}) {
    if (!textarea || !live) return false;
    if (insertAt < live.openEnd || insertAt > live.closeStart) return false;

    // Match the open’s wire form when known (legacy = visible); else field Show Syntax mode.
    let mode = live.legacy ? 'visible' : getEmphasisSyntaxModeForTextarea(textarea);
    if (mode !== 'visible') mode = 'hidden';
    const closeToken = buildManagedEmphasisCloseToken(live.id, mode);
    const exitedFrom = Number.isFinite(options.exitedFrom) ? options.exitedFrom : insertAt;

    let next;
    let newCaret;
    if (live.needsTerminator) {
        if (insertAt === live.closeStart) {
            if (!options.removeIfAtEnd) return false;
            next = value.slice(0, live.closeStart) + value.slice(live.end);
            newCaret = live.closeStart;
            // setTextareaValuePreservingUndo: public/scripts/comp/textareaUtils.js
            setTextareaValuePreservingUndo(textarea, next);
            textarea.setSelectionRange(newCaret, newCaret);
            refreshManagedEmphasisFieldAfterBoundaryEdit(textarea, 0);
            return true;
        }
        if (insertAt > live.closeStart) return false;
        next = value.slice(0, insertAt)
            + closeToken
            + value.slice(Math.max(exitedFrom, insertAt), live.closeStart)
            + value.slice(live.end);
        newCaret = insertAt + closeToken.length;
    } else {
        if (insertAt <= live.openEnd) return false;
        next = value.slice(0, insertAt)
            + closeToken
            + value.slice(Math.max(exitedFrom, insertAt));
        newCaret = insertAt + closeToken.length;
    }

    setTextareaValuePreservingUndo(textarea, next);
    textarea.setSelectionRange(newCaret, newCaret);
    refreshManagedEmphasisFieldAfterBoundaryEdit(textarea, 1);
    return true;
}

/**
 * Trim end: move (or toggle-remove) the group close to the caret.
 * Caret must be inside a managed group body (or on its close span).
 * @returns {boolean}
 */
function trimManagedEmphasisEndAtCaret(textarea) {
    if (!textarea || textarea.selectionStart !== textarea.selectionEnd) return false;
    const value = textarea.value || '';
    if (!hasManagedEmphasisGroupIds(value)) return false;
    const pos = textarea.selectionStart;
    const spans = listManagedEmphasisInvisibleSpans(value);
    const closeHit = spans.find((s) => s.kind === 'close' && pos >= s.start && pos < s.end);
    if (closeHit) {
        return removeManagedEmphasisEndMarkerAtCaret(textarea);
    }

    const bag = resolveEmphasisBagForTextarea(textarea) || {};
    const block = findManagedEmphasisBlockAtCursor(value, pos, bag);
    if (!block) return false;
    if (pos < block.openEnd || pos > block.closeStart) return false;

    let insertAt = pos;
    while (insertAt > block.openEnd && (value[insertAt - 1] === ' ' || value[insertAt - 1] === '\t')) {
        insertAt--;
    }
    if (insertAt <= block.openEnd) return false;

    const live = listManagedEmphasisBlocks(value).find((b) => b.id === block.id);
    return placeManagedEmphasisCloseInText(textarea, value, live, insertAt, { removeIfAtEnd: true });
}

/**
 * Trim start: move the group open to the caret so text before the caret leaves the group.
 * @returns {boolean}
 */
function trimManagedEmphasisStartAtCaret(textarea) {
    if (!textarea || textarea.selectionStart !== textarea.selectionEnd) return false;
    const value = textarea.value || '';
    if (!hasManagedEmphasisGroupIds(value)) return false;
    const pos = textarea.selectionStart;
    const bag = resolveEmphasisBagForTextarea(textarea) || {};
    const block = findManagedEmphasisBlockAtCursor(value, pos, bag);
    if (!block) return false;
    if (pos <= block.openEnd || pos > block.closeStart) return false;

    let cutAt = pos;
    while (cutAt < block.closeStart && (value[cutAt] === ' ' || value[cutAt] === '\t')) {
        cutAt++;
    }
    if (cutAt >= block.closeStart) return false;

    const openToken = value.slice(block.start, block.openEnd);
    const closeToken = value.slice(block.closeStart, block.end);
    const exited = value.slice(block.openEnd, cutAt);
    const kept = value.slice(cutAt, block.closeStart);
    if (!kept) return false;

    const next = value.slice(0, block.start)
        + exited
        + openToken
        + kept
        + closeToken
        + value.slice(block.end);
    const newCaret = block.start + exited.length + openToken.length;

    // setTextareaValuePreservingUndo: public/scripts/comp/textareaUtils.js
    setTextareaValuePreservingUndo(textarea, next);
    textarea.setSelectionRange(newCaret, newCaret);
    refreshManagedEmphasisFieldAfterBoundaryEdit(textarea, 0);
    return true;
}

/** True when Trim end can run at the current caret. */
function canTrimManagedEmphasisEndAtCaret(textarea) {
    if (!textarea || textarea.selectionStart !== textarea.selectionEnd) return false;
    const value = textarea.value || '';
    if (!hasManagedEmphasisGroupIds(value)) return false;
    const pos = textarea.selectionStart;
    const spans = listManagedEmphasisInvisibleSpans(value);
    if (spans.some((s) => s.kind === 'close' && pos >= s.start && pos < s.end)) return true;
    const bag = resolveEmphasisBagForTextarea(textarea) || {};
    const block = findManagedEmphasisBlockAtCursor(value, pos, bag);
    if (!block) return false;
    return pos > block.openEnd && pos <= block.closeStart;
}

/** True when Trim start can run at the current caret. */
function canTrimManagedEmphasisStartAtCaret(textarea) {
    if (!textarea || textarea.selectionStart !== textarea.selectionEnd) return false;
    const value = textarea.value || '';
    if (!hasManagedEmphasisGroupIds(value)) return false;
    const pos = textarea.selectionStart;
    const bag = resolveEmphasisBagForTextarea(textarea) || {};
    const block = findManagedEmphasisBlockAtCursor(value, pos, bag);
    if (!block) return false;
    return pos > block.openEnd && pos < block.closeStart;
}

/**
 * Remove a managed group's end (close) marker so it auto-terminates to the next open / EOF.
 * Delete at or inside the close span. Caret lands at the former closeStart.
 * @returns {boolean}
 */
function removeManagedEmphasisEndMarkerAtCaret(textarea) {
    if (!textarea || textarea.selectionStart !== textarea.selectionEnd) return false;
    const value = textarea.value || '';
    if (!hasManagedEmphasisGroupIds(value)) return false;
    const pos = textarea.selectionStart;
    const spans = listManagedEmphasisInvisibleSpans(value);
    const closeHit = spans.find((s) => s.kind === 'close' && pos >= s.start && pos < s.end);
    if (!closeHit) return false;

    // replaceTextareaRangePreservingUndo: public/scripts/comp/textareaUtils.js
    replaceTextareaRangePreservingUndo(textarea, closeHit.start, closeHit.end, '');
    textarea.setSelectionRange(closeHit.start, closeHit.start);
    refreshManagedEmphasisFieldAfterBoundaryEdit(textarea, 0);
    return true;
}

/**
 * Typed "::" inside a managed group: add a missing close, or move an existing close to the caret.
 * Consumes the typed colons (does not leave "::" in the prompt). Type-only — not for paste.
 * Prefer this over classic Alt+S colon-split when managed ids are present.
 * @param {HTMLTextAreaElement} textarea
 * @param {{ phase?: 'beforeSecondColon'|'afterBothColons' }} [options]
 * @returns {boolean}
 */
function tryManagedEmphasisEndMarkerOnTypedColon(textarea, options = {}) {
    if (!textarea || textarea.selectionStart !== textarea.selectionEnd) return false;

    const phase = options.phase || 'beforeSecondColon';
    const pos = textarea.selectionStart;
    const value = textarea.value || '';
    if (!hasManagedEmphasisGroupIds(value)) return false;

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

    const bag = resolveEmphasisBagForTextarea(textarea) || {};
    const block = findManagedEmphasisBlockAtCursor(withoutColons, colonPos, bag);
    if (!block) return false;
    if (colonPos < block.openEnd || colonPos > block.closeStart) return false;

    // Glue spaces before "::" like classic "kicking ::" → end at "kicking"
    // Keep one space after a trailing digit ("2025 ::") so expand/parse stay safe.
    let insertAt = colonPos;
    while (insertAt > block.openEnd
        && (withoutColons[insertAt - 1] === ' ' || withoutColons[insertAt - 1] === '\t')) {
        insertAt--;
    }
    if (insertAt > block.openEnd && /\d/.test(withoutColons[insertAt - 1])) {
        insertAt += 1;
        if (insertAt > colonPos) insertAt = colonPos;
    }
    if (insertAt <= block.openEnd) return false;

    const live = listManagedEmphasisBlocks(withoutColons).find((b) => b.id === block.id);
    if (!live) return false;

    // Already closed at caret: in hidden mode, swallow "::" so it doesn't litter.
    // In Show Syntax / visible wire form, do not eat the colons — they look like the end
    // marker the user is trying to type (and would "instantly disappear").
    if (live.needsTerminator && insertAt === live.closeStart) {
        const visibleWire = live.legacy
            || getEmphasisSyntaxModeForTextarea(textarea) === 'visible';
        if (visibleWire) return false;
        // setTextareaValuePreservingUndo: public/scripts/comp/textareaUtils.js
        setTextareaValuePreservingUndo(textarea, withoutColons);
        textarea.setSelectionRange(insertAt, insertAt);
        textarea._managedCaretMoveDir = 1;
        dispatchPromptTextareaInputEvent(textarea, { skipAutofill: true });
        return true;
    }

    return placeManagedEmphasisCloseInText(textarea, withoutColons, live, insertAt, {
        exitedFrom: colonPos
    });
}

/**
 * Backspace/Delete: jump ZWSP delimiters so the visible character is removed, not the barrier.
 * e.g. caret after close delim with "word␠[close]|" → delete the space, keep the close delim,
 * caret lands outside after the close so the next Backspace continues on outer text.
 * Delete on/inside a close span removes the end marker (group auto-terminates).
 */
function handleManagedEmphasisDeleteKeydown(e) {
    if (!e || (e.key !== 'Backspace' && e.key !== 'Delete')) return;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const textarea = e.target;
    if (!textarea || textarea.tagName !== 'TEXTAREA') return;
    // A prior beforeinput/keydown already rewrote the value — block the native delete.
    if (textarea._managedDeleteGuard) {
        e.preventDefault();
        return;
    }
    const value = textarea.value || '';
    if (!hasManagedEmphasisGroupIds(value)) return;
    if (textarea.selectionStart !== textarea.selectionEnd) return;

    const pos = textarea.selectionStart;
    const spans = listManagedEmphasisInvisibleSpans(value);
    if (!spans.length) return;

    // Delete end marker: caret at or inside the close span (hidden ZWSP or visible :MAGIC:)
    if (e.key === 'Delete') {
        const closeHit = spans.find((s) => s.kind === 'close' && pos >= s.start && pos < s.end);
        if (closeHit) {
            e.preventDefault();
            textarea._managedDeleteGuard = true;
            removeManagedEmphasisEndMarkerAtCaret(textarea);
            queueMicrotask(() => { textarea._managedDeleteGuard = false; });
            return;
        }
    }

    if (e.key === 'Backspace') {
        if (pos <= 0 || !isManagedInvisibleChar(value[pos - 1])) return;
        e.preventDefault();
        textarea._managedDeleteGuard = true;
        const edge = resolveManagedDeleteSkipEdge(value, pos, -1, spans);
        if (edge <= 0) {
            textarea.setSelectionRange(0, 0);
            queueMicrotask(() => { textarea._managedDeleteGuard = false; });
            return;
        }
        // If caret sits mid-delimiter, keep the full span (not a truncated half).
        let keepEnd = pos;
        for (let s = 0; s < spans.length; s++) {
            const span = spans[s];
            if (pos > span.start && pos < span.end) {
                keepEnd = Math.max(keepEnd, span.end);
            }
        }
        // Replace "visibleChar + delimiterRun" with "delimiterRun" so ZWSP stays intact.
        // replaceTextareaRangePreservingUndo: public/scripts/comp/textareaUtils.js
        const delimRun = value.slice(edge, keepEnd);
        replaceTextareaRangePreservingUndo(textarea, edge - 1, keepEnd, delimRun);
        // 'end' selectMode lands caret after the kept delimiter (outside the group).
        // dispatchPromptTextareaInputEvent: public/scripts/comp/emphasisParse.js
        dispatchPromptTextareaInputEvent(textarea, { skipAutofill: true });
        queueMicrotask(() => { textarea._managedDeleteGuard = false; });
        return;
    }

    // Delete — skip open / other invisible runs; remove visible char after
    if (pos >= value.length || !isManagedInvisibleChar(value[pos])) return;
    e.preventDefault();
    textarea._managedDeleteGuard = true;
    let keepStart = pos;
    for (let s = 0; s < spans.length; s++) {
        const span = spans[s];
        if (pos > span.start && pos < span.end) {
            keepStart = Math.min(keepStart, span.start);
        }
    }
    const edge = resolveManagedDeleteSkipEdge(value, keepStart, 1, spans);
    if (edge >= value.length) {
        textarea.setSelectionRange(edge, edge);
        queueMicrotask(() => { textarea._managedDeleteGuard = false; });
        return;
    }
    // Replace "delimiterRun + visibleChar" with "delimiterRun"; caret stays before the run.
    const delimRun = value.slice(keepStart, edge);
    replaceTextareaRangePreservingUndo(textarea, keepStart, edge + 1, delimRun);
    textarea.setSelectionRange(keepStart, keepStart);
    dispatchPromptTextareaInputEvent(textarea, { skipAutofill: true });
    queueMicrotask(() => { textarea._managedDeleteGuard = false; });
}

/**
 * If caret is inside a delimiter run, land on the content-facing edge (inside the group).
 * Does not touch outer edges — arrow leave must be able to park at close.end / open.start.
 */
function snapCaretIfInsideManagedDelimiter(textarea) {
    if (!textarea || textarea.selectionStart !== textarea.selectionEnd) return false;
    if (!hasManagedEmphasisGroupIds(textarea.value || '')) return false;
    const value = textarea.value || '';
    const pos = textarea.selectionStart;
    const spans = listManagedEmphasisInvisibleSpans(value);
    for (let i = 0; i < spans.length; i++) {
        const span = spans[i];
        if (pos > span.start && pos < span.end) {
            const land = span.kind === 'close' ? span.start : span.end;
            if (land !== pos) {
                textarea.setSelectionRange(land, land);
                return true;
            }
            return false;
        }
    }
    return false;
}

/** Collapsed caret in managed content (openEnd..closeStart). Outer delimiter edges = outside. */
function isCaretInManagedEmphasisContent(value, pos) {
    if (!value || !hasManagedEmphasisGroupIds(value)) return false;
    const p = Math.max(0, Math.min(pos | 0, value.length));
    const blocks = listManagedEmphasisBlocks(value);
    for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i];
        if (p >= b.openEnd && p <= b.closeStart) return true;
    }
    return false;
}

/**
 * After autofill/suggested accept: if caret touches a group from the outside (or sits
 * mid-delimiter), park on the outer edge and remember leave direction so typing won't pull in.
 */
function preferManagedCaretOutsideIfTouching(textarea) {
    if (!textarea || textarea.selectionStart !== textarea.selectionEnd) return false;
    const value = textarea.value || '';
    if (!hasManagedEmphasisGroupIds(value)) return false;
    const pos = textarea.selectionStart;
    const spans = listManagedEmphasisInvisibleSpans(value);
    if (!spans.length) return false;

    for (let i = 0; i < spans.length; i++) {
        const span = spans[i];
        if (pos > span.start && pos < span.end) {
            const land = span.kind === 'close' ? span.end : span.start;
            textarea.setSelectionRange(land, land);
            textarea._managedCaretMoveDir = span.kind === 'close' ? 1 : -1;
            return true;
        }
    }

    const closeAt = spans.find((s) => s.kind === 'close' && s.end === pos);
    const openAt = spans.find((s) => s.kind === 'open' && s.start === pos);
    if (closeAt && openAt) {
        textarea._managedCaretMoveDir = 0;
        return true;
    }
    if (closeAt) {
        textarea._managedCaretMoveDir = 1;
        return true;
    }
    if (openAt) {
        textarea._managedCaretMoveDir = -1;
        return true;
    }
    return false;
}

/**
 * Prefer typing inside the group only when explicitly entering a delimiter edge.
 * Open outer edge (span.start): pull in only when moving right (dir > 0).
 * Close outer edge (span.end): pull in only when moving left (dir < 0).
 * dir 0 / leave-direction at outer edges stay outside so you can exit and type after a group
 * (ZWSP means close.end and close.start look identical — defaulting dir 0 to "pull in"
 * trapped trailing groups and caret after a typed "::" end marker).
 * Between abutting groups: click / parked seam (dir 0) stays between for typing;
 * explicit enter direction pulls into that neighbor.
 * @param {HTMLTextAreaElement} textarea
 * @param {number} [direction] 1 = moving right, -1 = moving left, 0/omit = unknown/click
 */
function snapCaretIntoManagedGroupForTyping(textarea, direction) {
    if (!textarea || textarea.selectionStart !== textarea.selectionEnd) return false;
    if (!hasManagedEmphasisGroupIds(textarea.value || '')) return false;
    const value = textarea.value || '';
    const pos = textarea.selectionStart;
    const spans = listManagedEmphasisInvisibleSpans(value);
    if (!spans.length) return false;

    if (snapCaretIfInsideManagedDelimiter(textarea)) return true;

    const dir = Number.isFinite(direction) ? direction : (textarea._managedCaretMoveDir || 0);
    const closeAt = spans.find((s) => s.kind === 'close' && s.end === pos);
    const openAt = spans.find((s) => s.kind === 'open' && s.start === pos);

    // Abutting boundary between two groups
    if (closeAt && openAt) {
        if (dir > 0) {
            textarea.setSelectionRange(openAt.end, openAt.end);
            return true;
        }
        if (dir < 0) {
            textarea.setSelectionRange(closeAt.start, closeAt.start);
            return true;
        }
        return false;
    }

    // Outer edges: pull in only on explicit enter. Leave / unknown / click stay outside.
    if (openAt) {
        if (dir <= 0) return false;
        const trimmed = trimSpacesAfterManagedOpen(value, openAt.end);
        if (trimmed.removed) {
            // setTextareaValuePreservingUndo: public/scripts/comp/textareaUtils.js
            setTextareaValuePreservingUndo(textarea, trimmed.text);
            // dispatchPromptTextareaInputEvent: public/scripts/comp/emphasisParse.js
            dispatchPromptTextareaInputEvent(textarea, { skipAutofill: true });
            textarea.setSelectionRange(openAt.end, openAt.end);
            return true;
        }
        textarea.setSelectionRange(openAt.end, openAt.end);
        return true;
    }
    if (closeAt) {
        if (dir >= 0) return false;
        textarea.setSelectionRange(closeAt.start, closeAt.start);
        return true;
    }
    return false;
}

/** Snap collapsed caret out of a managed delimiter run onto a content edge (inside the group). */
function snapCaretOutOfManagedDelimiters(textarea) {
    return snapCaretIntoManagedGroupForTyping(textarea, textarea && textarea._managedCaretMoveDir);
}

/**
 * Synchronous ArrowLeft/Right guard: jump across ZWSP barriers in one press so
 * leaving a group does not feel like a no-op. Do not treat spaces as leave
 * barriers — a trailing space may still be the start of the next inner word.
 */
function handleManagedEmphasisCaretKeydown(e) {
    if (!e || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    // Autofill spell/thesaurus already consumed ←/→ for suggestion browse.
    if (e.defaultPrevented) return;
    // isAutofillHorizontalSubNavigation: public/scripts/comp/autocompleteUtils.js
    if (isAutofillHorizontalSubNavigation()) return;
    // Shift+Arrow must extend selection across open/close (merge-by-delete). Jumping
    // collapses the range every time the caret hits a delimiter border.
    if (e.shiftKey) return;
    const textarea = e.target;
    if (!textarea || textarea.tagName !== 'TEXTAREA') return;
    let value = textarea.value || '';
    if (!hasManagedEmphasisGroupIds(value)) return;
    if (textarea.selectionStart !== textarea.selectionEnd) return;

    const dir = e.key === 'ArrowRight' ? 1 : -1;
    textarea._managedCaretMoveDir = dir;
    let pos = textarea.selectionStart;
    let spans = listManagedEmphasisInvisibleSpans(value);
    if (!spans.length) return;

    const applyValue = (next) => {
        // setTextareaValuePreservingUndo: public/scripts/comp/textareaUtils.js
        setTextareaValuePreservingUndo(textarea, next);
        value = next;
        spans = listManagedEmphasisInvisibleSpans(value);
        // dispatchPromptTextareaInputEvent: public/scripts/comp/emphasisParse.js
        dispatchPromptTextareaInputEvent(textarea, { skipAutofill: true });
    };

    // Parked between abutting groups: first stop stays here (type between);
    // another arrow in the same direction enters that neighbor.
    const closeAt = spans.find((s) => s.kind === 'close' && s.end === pos);
    const openAt = spans.find((s) => s.kind === 'open' && s.start === pos);
    if (closeAt && openAt) {
        e.preventDefault();
        if (dir > 0) {
            const land = resolveCaretAfterManagedJump(value, openAt.end, 1, spans);
            textarea.setSelectionRange(land, land);
        } else {
            const land = resolveCaretAfterManagedJump(value, closeAt.start, -1, spans);
            textarea.setSelectionRange(land, land);
        }
        return;
    }

    const parkIfAbuttingSeam = (land) => {
        if (isManagedAbuttingGroupSeam(spans, land)) {
            // Stay outside so beforeinput typing inserts between the groups.
            textarea._managedCaretMoveDir = 0;
        }
        textarea.setSelectionRange(land, land);
    };

    const next = pos + dir;
    for (let i = 0; i < spans.length; i++) {
        const span = spans[i];
        if (dir > 0 && next > span.start && next <= span.end) {
            e.preventDefault();
            parkIfAbuttingSeam(resolveCaretAfterManagedJump(value, span.end, 1, spans));
            return;
        }
        if (dir < 0 && next >= span.start && next < span.end) {
            e.preventDefault();
            let spanStart = span.start;
            if (span.kind === 'open') {
                const trimmed = trimSpacesAfterManagedOpen(value, span.end);
                if (trimmed.removed) {
                    applyValue(trimmed.text);
                    spanStart = span.start;
                }
            }
            parkIfAbuttingSeam(resolveCaretAfterManagedJump(value, spanStart, -1, spans));
            return;
        }
    }

    // Already parked on a zero-width edge (looks stuck): skip the next barrier.
    if (dir > 0 && pos < value.length && isManagedCaretSkipChar(value[pos])) {
        e.preventDefault();
        const land = resolveCaretAfterManagedJump(value, pos, 1, spans);
        if (land !== pos) parkIfAbuttingSeam(land);
        return;
    }
    if (dir < 0 && pos > 0 && isManagedCaretSkipChar(value[pos - 1])) {
        e.preventDefault();
        const land = resolveCaretAfterManagedJump(value, pos, -1, spans);
        if (land !== pos) parkIfAbuttingSeam(land);
    }
}

/**
 * After ArrowLeft/Right move, jump fully across a managed delimiter if caret landed inside.
 * Prefer handleManagedEmphasisCaretKeydown (preventDefault) — this is a safety net.
 */
function nudgeCaretPastManagedDelimiters(textarea, direction) {
    if (!textarea || textarea.selectionStart !== textarea.selectionEnd) return false;
    if (!hasManagedEmphasisGroupIds(textarea.value || '')) return false;
    const value = textarea.value || '';
    const pos = textarea.selectionStart;
    const spans = listManagedEmphasisInvisibleSpans(value);
    for (let i = 0; i < spans.length; i++) {
        const span = spans[i];
        if (direction > 0 && pos >= span.start && pos < span.end) {
            const land = resolveCaretAfterManagedJump(value, span.end, 1, spans);
            textarea.setSelectionRange(land, land);
            return true;
        }
        if (direction < 0 && pos > span.start && pos <= span.end) {
            const land = resolveCaretAfterManagedJump(value, span.start, -1, spans);
            textarea.setSelectionRange(land, land);
            return true;
        }
    }
    // Parked on a zero-width barrier — finish the jump.
    if (direction > 0 && pos < value.length && isManagedCaretSkipChar(value[pos])) {
        const land = resolveCaretAfterManagedJump(value, pos, 1, spans);
        if (land !== pos) {
            textarea.setSelectionRange(land, land);
            return true;
        }
    }
    if (direction < 0 && pos > 0 && isManagedCaretSkipChar(value[pos - 1])) {
        const land = resolveCaretAfterManagedJump(value, pos, -1, spans);
        if (land !== pos) {
            textarea.setSelectionRange(land, land);
            return true;
        }
    }
    return false;
}

/**
 * Portable clipboard text for a selection.
 * Fully-contained managed groups → classic N::…:: (field bag weights).
 * Partial overlap → overlapping inner text only (never promote a partial select to the whole group).
 */
function expandManagedEmphasisRangeForClipboard(value, start, end, weightSource) {
    const text = String(value || '');
    let from = Math.max(0, Math.min(start | 0, end | 0));
    let to = Math.max(0, Math.max(start | 0, end | 0));
    from = Math.min(from, text.length);
    to = Math.min(to, text.length);
    if (from >= to) return '';

    if (!hasManagedEmphasisGroupIds(text)) {
        return stripUnmanagedEmphasisInvisibles(text.slice(from, to));
    }

    const blocks = listManagedEmphasisBlocks(text)
        .filter((b) => b.end > from && b.start < to)
        .sort((a, b) => a.start - b.start);
    if (!blocks.length) {
        return stripUnmanagedEmphasisInvisibles(text.slice(from, to));
    }

    let out = '';
    let cursor = from;
    for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        if (cursor < block.start) {
            out += text.slice(cursor, Math.min(block.start, to));
            cursor = Math.min(block.start, to);
        }
        if (cursor >= to) break;

        const fullyContained = block.start >= from && block.end <= to;
        if (fullyContained) {
            const slice = text.slice(block.start, block.end);
            const expanded = expandEmphasisGroupIds(slice, weightSource, { alwaysTerminate: true });
            out += expanded.text;
            cursor = block.end;
            continue;
        }

        // Partial overlap: copy only the overlapping inner span (no weight / delimiters).
        const innerStart = block.openEnd;
        const innerEnd = block.closeStart > block.openEnd ? block.closeStart : block.end;
        const overlapStart = Math.max(from, innerStart);
        const overlapEnd = Math.min(to, innerEnd);
        if (overlapStart < overlapEnd) {
            out += text.slice(overlapStart, overlapEnd);
        }
        cursor = Math.min(to, block.end);
    }
    if (cursor < to) {
        out += text.slice(cursor, to);
    }
    return stripUnmanagedEmphasisInvisibles(out);
}

function selectionOverlapsManagedEmphasis(value, start, end) {
    if (!hasManagedEmphasisGroupIds(value)) return false;
    const from = Math.min(start, end);
    const to = Math.max(start, end);
    return listManagedEmphasisBlocks(value).some((b) => b.end > from && b.start < to);
}

/** True when selection fully contains at least one managed group (weights must travel). */
function selectionFullyContainsManagedEmphasis(value, start, end) {
    if (!hasManagedEmphasisGroupIds(value)) return false;
    const from = Math.min(start, end);
    const to = Math.max(start, end);
    return listManagedEmphasisBlocks(value).some((b) => b.start >= from && b.end <= to);
}

/**
 * Intercept copy/cut/drag only when the selection would otherwise put managed
 * delimiters on the clipboard, or fully contains a weighted group.
 * Pure inner-text selections (no delimiter bytes) stay native.
 */
function selectionNeedsManagedClipboardExpand(value, start, end) {
    if (!hasManagedEmphasisGroupIds(value)) return false;
    const from = Math.min(start, end);
    const to = Math.max(start, end);
    if (from >= to) return false;
    const blocks = listManagedEmphasisBlocks(value);
    for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i];
        if (b.end <= from || b.start >= to) continue;
        if (b.start >= from && b.end <= to) return true;
        // Touches open or close delimiter span → would copy invisible markers.
        if (from < b.openEnd && to > b.start) return true;
        if (b.closeStart < b.end && from < b.end && to > b.closeStart) return true;
    }
    return false;
}

function clipboardPayloadNeedsEmphasisSettle(text) {
    const value = String(text || '');
    if (!value) return false;
    if (hasManagedEmphasisGroupIds(value)) return true;
    // listAllEmphasisTargets: public/scripts/comp/emphasisParse.js
    return listAllEmphasisTargets(value).some((t) => t.type === 'group');
}

/**
 * Classic (or plain) text for the current selection — expands managed groups via field bag.
 */
function getManagedEmphasisClipboardTextForSelection(textarea) {
    if (!textarea) return '';
    const value = textarea.value || '';
    const start = typeof textarea.selectionStart === 'number' ? textarea.selectionStart : 0;
    const end = typeof textarea.selectionEnd === 'number' ? textarea.selectionEnd : 0;
    const from = Math.min(start, end);
    const to = Math.max(start, end);
    if (from >= to) return '';
    const bag = resolveEmphasisBagForTextarea(textarea) || {};
    return expandManagedEmphasisRangeForClipboard(value, from, to, bag);
}

/**
 * Cut selection: expand for clipboard payload, delete exactly the selection,
 * prune bag ids only for groups fully removed by that range.
 * @returns {string} classic clipboard text
 */
function cutManagedEmphasisSelection(textarea) {
    if (!textarea || !textarea.id) return '';
    const value = textarea.value || '';
    const start = typeof textarea.selectionStart === 'number' ? textarea.selectionStart : 0;
    const end = typeof textarea.selectionEnd === 'number' ? textarea.selectionEnd : 0;
    const from = Math.min(start, end);
    const to = Math.max(start, end);
    if (from >= to) return '';

    const bag = resolveEmphasisBagForTextarea(textarea) || {};
    const classic = expandManagedEmphasisRangeForClipboard(value, from, to, bag);

    const removedIds = hasManagedEmphasisGroupIds(value)
        ? listManagedEmphasisBlocks(value)
            .filter((b) => b.start >= from && b.end <= to)
            .map((b) => b.id)
        : [];

    // replaceTextareaRangePreservingUndo: public/scripts/comp/textareaUtils.js
    replaceTextareaRangePreservingUndo(textarea, from, to, '');
    textarea.setSelectionRange(from, from);

    if (removedIds.length) {
        const prev = resolveEmphasisBagForTextarea(textarea) || bag;
        const groupsById = { ...(prev.groupsById || {}) };
        removedIds.forEach((id) => {
            delete groupsById[id];
            delete groupsById[String(id)];
        });
        const store = getEmphasisNormalizationFieldStore();
        const keys = getEmphasisNormalizationDualWriteKeys(textarea.id);
        (keys.length ? keys : [textarea.id]).forEach((key) => {
            store[key] = {
                ...(store[key] || prev),
                groupsById: { ...groupsById }
            };
        });
        syncEmphasisNormalizationPreviewMetadata();
        refreshEmphasisGroupsToolInstancesFromForgeState();
    }

    // dispatchPromptTextareaInputEvent: public/scripts/comp/emphasisParse.js
    dispatchPromptTextareaInputEvent(textarea, { skipAutofill: true });
    if (updateEmphasisHighlighting) {
        updateEmphasisHighlighting(textarea);
    }
    if (promptTextareaToolbar) {
        promptTextareaToolbar.updateEmphasisGroupChip(
            textarea,
            promptTextareaToolbar.getToolbarFromTextarea(textarea)
        );
    }
    return classic;
}

/**
 * After paste: import classic N:: into current hidden|visible mode + heal orphan ZW.
 * Restores caret near the post-paste hint when the rewrite shifts length.
 */
function settleManagedEmphasisAfterPaste(textarea, caretHint) {
    if (!textarea || !textarea.id) return null;
    const before = textarea.value || '';
    const hint = Number.isFinite(caretHint) ? caretHint : (
        typeof textarea.selectionStart === 'number' ? textarea.selectionStart : before.length
    );
    const result = importUnmanagedEmphasisGroupsForTextarea(textarea);
    const after = textarea.value || '';
    let pos = hint;
    if (result && before !== after) {
        // Length delta from classic→managed is usually negative; clamp to new length.
        pos = Math.max(0, Math.min(hint + (after.length - before.length), after.length));
    } else {
        pos = Math.max(0, Math.min(hint, after.length));
    }
    textarea.setSelectionRange(pos, pos);
    textarea._emphasisLastCaret = pos;
    // Always notify — importUnmanaged does not dispatch input on its own.
    // dispatchPromptTextareaInputEvent: public/scripts/comp/emphasisParse.js
    dispatchPromptTextareaInputEvent(textarea, { skipAutofill: true });
    if (!result && updateEmphasisHighlighting) {
        updateEmphasisHighlighting(textarea);
    }
    return result;
}

function handleManagedEmphasisClipboardCopyCut(e, textarea, isCut) {
    if (!e || !textarea) return;
    const start = typeof textarea.selectionStart === 'number' ? textarea.selectionStart : 0;
    const end = typeof textarea.selectionEnd === 'number' ? textarea.selectionEnd : 0;
    if (start === end) return;
    const value = textarea.value || '';
    // Partial inner-text selections stay native — do not expand/cut the whole group.
    if (!selectionNeedsManagedClipboardExpand(value, start, end)) return;

    const classic = isCut
        ? cutManagedEmphasisSelection(textarea)
        : getManagedEmphasisClipboardTextForSelection(textarea);
    if (classic == null) return;
    e.preventDefault();
    if (e.clipboardData && e.clipboardData.setData) {
        e.clipboardData.setData('text/plain', classic);
    }
    // isAndroidClipboardBridgeActive / copyTextToClipboard:
    //   public/scripts/utils/dreamscapeClipboard.js
    if (isAndroidClipboardBridgeActive()) {
        copyTextToClipboard(classic).catch(() => { /* clipboardData already set */ });
    }
}

function handleManagedEmphasisClipboardPaste(e, textarea) {
    if (!e || !textarea || !textarea.id) return;

    const start = typeof textarea.selectionStart === 'number' ? textarea.selectionStart : 0;
    const end = typeof textarea.selectionEnd === 'number' ? textarea.selectionEnd : 0;
    const from = Math.min(start, end);
    const to = Math.max(start, end);

    // isAndroidClipboardBridgeActive / readClipboardTextFast:
    //   public/scripts/utils/dreamscapeClipboard.js
    if (isAndroidClipboardBridgeActive()) {
        // Peek via bridge only when we may need settle — still async.
        e.preventDefault();
        readClipboardTextFast().then((text) => {
            const clip = text == null ? '' : String(text);
            // replaceTextareaRangePreservingUndo: public/scripts/comp/textareaUtils.js
            replaceTextareaRangePreservingUndo(textarea, from, to, clip);
            if (clipboardPayloadNeedsEmphasisSettle(clip)) {
                settleManagedEmphasisAfterPaste(textarea, from + clip.length);
            } else {
                textarea.setSelectionRange(from + clip.length, from + clip.length);
                dispatchPromptTextareaInputEvent(textarea, { skipAutofill: true });
            }
        }).catch(() => { /* no clipboard text */ });
        return;
    }

    const clip = e.clipboardData && e.clipboardData.getData
        ? e.clipboardData.getData('text/plain')
        : null;
    if (clip == null) return;
    // Plain text paste: leave native. Only take over when weights / managed markers need settle.
    if (!clipboardPayloadNeedsEmphasisSettle(clip)) return;

    e.preventDefault();
    // replaceTextareaRangePreservingUndo: public/scripts/comp/textareaUtils.js
    replaceTextareaRangePreservingUndo(textarea, from, to, clip);
    settleManagedEmphasisAfterPaste(textarea, from + clip.length);
}

function wireManagedEmphasisClipboard(textarea) {
    if (!textarea || textarea.dataset.managedClipboardWired === '1') return;
    textarea.dataset.managedClipboardWired = '1';
    // addSafeEventListener: public/scripts/comp/utilities.js
    addSafeEventListener(textarea, 'copy', (e) => {
        handleManagedEmphasisClipboardCopyCut(e, textarea, false);
    }, 'managedClipboardCopy');
    addSafeEventListener(textarea, 'cut', (e) => {
        handleManagedEmphasisClipboardCopyCut(e, textarea, true);
    }, 'managedClipboardCut');
    addSafeEventListener(textarea, 'paste', (e) => {
        handleManagedEmphasisClipboardPaste(e, textarea);
    }, 'managedClipboardPaste');
    // Cross-field text drag — only when a full weighted group (or delimiters) are in play.
    addSafeEventListener(textarea, 'dragstart', (e) => {
        handleManagedEmphasisDragStart(e, textarea);
    }, 'managedClipboardDragStart');
    addSafeEventListener(textarea, 'dragover', (e) => {
        handleManagedEmphasisDragOver(e, textarea);
    }, 'managedClipboardDragOver');
    addSafeEventListener(textarea, 'drop', (e) => {
        handleManagedEmphasisDrop(e, textarea);
    }, 'managedClipboardDrop');
    addSafeEventListener(textarea, 'dragend', (e) => {
        handleManagedEmphasisDragEnd(e, textarea);
    }, 'managedClipboardDragEnd');
}

/** Active inter-prompt text drag (weights survive even if the browser keeps raw managed markers). */
let _emphasisInternalDrag = null;
const EMPHASIS_DRAG_MIME = 'application/x-staticforge-emphasis';

function buildEmphasisDragWeightMap(textarea, start, end) {
    const value = textarea.value || '';
    const bag = resolveEmphasisBagForTextarea(textarea) || {};
    const from = Math.min(start, end);
    const to = Math.max(start, end);
    const weightsById = {};
    if (!hasManagedEmphasisGroupIds(value)) return weightsById;
    // Only stash weights for groups fully inside the drag — partials are plain text.
    listManagedEmphasisBlocks(value)
        .filter((b) => b.start >= from && b.end <= to)
        .forEach((b) => {
            let w = resolveWeightForEmphasisGroupId(b.id, bag);
            if (!Number.isFinite(w) && Number.isFinite(b.textWeight)) w = b.textWeight;
            if (Number.isFinite(w)) {
                weightsById[b.id] = w;
                weightsById[String(b.id)] = w;
            }
        });
    return weightsById;
}

function findEmphasisGroupWeightInSiblingFields(groupId, excludeFieldId) {
    if (_emphasisInternalDrag && _emphasisInternalDrag.weightsById) {
        const w = _emphasisInternalDrag.weightsById[groupId]
            ?? _emphasisInternalDrag.weightsById[String(groupId)];
        if (Number.isFinite(w)) {
            return { weight: w, sourceFieldId: _emphasisInternalDrag.sourceFieldId || null };
        }
    }
    // collectManualEditorEmphasisTextareas: below in this file
    const fields = collectManualEditorEmphasisTextareas();
    for (let i = 0; i < fields.length; i++) {
        const ta = fields[i];
        if (!ta || !ta.id || ta.id === excludeFieldId) continue;
        const bag = resolveEmphasisBagForTextarea(ta);
        const w = resolveWeightForEmphasisGroupId(groupId, bag);
        if (Number.isFinite(w)) return { weight: w, sourceFieldId: ta.id };
    }
    return null;
}

/**
 * When managed ids land without local bag weights (cross-field drag of raw markers),
 * copy weights from the drag session or other prompt fields. Remap ids on collision.
 * @returns {{ text: string, groupsById: object, migrated: number, remapped: number }}
 */
function migrateManagedEmphasisWeightsFromSiblingFields(textarea, groupsById) {
    const value = String(textarea && textarea.value != null ? textarea.value : '');
    const bag = pruneEmphasisGroupsByIdToLiveText(groupsById, value);
    if (!hasManagedEmphasisGroupIds(value)) {
        return { text: value, groupsById: bag, migrated: 0, remapped: 0 };
    }
    const mode = getEmphasisSyntaxModeForTextarea(textarea) === 'visible' ? 'visible' : 'hidden';
    const fieldId = textarea && textarea.id ? textarea.id : '';
    const blocks = listManagedEmphasisBlocks(value);
    // Ids that already have a local weight — do not steal for remapped drops.
    const locallyWeighted = new Set();
    blocks.forEach((b) => {
        if (Number.isFinite(resolveWeightForEmphasisGroupId(b.id, { groupsById: bag }))) {
            locallyWeighted.add(b.id);
        } else if (Number.isFinite(b.textWeight)) {
            bag[b.id] = b.textWeight;
            locallyWeighted.add(b.id);
        }
    });

    let out = value;
    let migrated = 0;
    let remapped = 0;
    // Prefer drag-session ids when deciding which same-id block is the newcomer.
    const dragIds = _emphasisInternalDrag && _emphasisInternalDrag.weightsById
        ? new Set(Object.keys(_emphasisInternalDrag.weightsById).map((k) => Number(k)).filter(Number.isFinite))
        : null;

    for (let i = blocks.length - 1; i >= 0; i--) {
        const b = blocks[i];
        if (Number.isFinite(resolveWeightForEmphasisGroupId(b.id, { groupsById: bag }))) continue;

        const found = findEmphasisGroupWeightInSiblingFields(b.id, fieldId);
        if (!found || !Number.isFinite(found.weight)) continue;

        const idConflict = locallyWeighted.has(b.id);
        const treatAsDragged = dragIds ? dragIds.has(b.id) : true;
        if (idConflict && treatAsDragged) {
            const newId = allocateNextManagedEmphasisGroupId(bag);
            if (newId < 0) continue;
            bag[newId] = found.weight;
            const managed = buildManagedEmphasisGroupText(newId, b.innerText, {
                mode,
                weight: found.weight,
                omitClose: !b.needsTerminator
            });
            out = out.slice(0, b.start) + managed + out.slice(b.end);
            locallyWeighted.add(newId);
            remapped++;
            migrated++;
            continue;
        }
        if (!idConflict) {
            bag[b.id] = found.weight;
            locallyWeighted.add(b.id);
            migrated++;
        }
    }
    return { text: out, groupsById: bag, migrated, remapped };
}

function handleManagedEmphasisDragStart(e, textarea) {
    if (!e || !textarea || !e.dataTransfer) return;
    const start = typeof textarea.selectionStart === 'number' ? textarea.selectionStart : 0;
    const end = typeof textarea.selectionEnd === 'number' ? textarea.selectionEnd : 0;
    if (start === end) return;
    const value = textarea.value || '';
    // Segment / partial inner drags stay fully native.
    if (!selectionNeedsManagedClipboardExpand(value, start, end)) {
        _emphasisInternalDrag = null;
        return;
    }

    const from = Math.min(start, end);
    const to = Math.max(start, end);
    const classic = getManagedEmphasisClipboardTextForSelection(textarea);
    const weightsById = buildEmphasisDragWeightMap(textarea, from, to);

    _emphasisInternalDrag = {
        sourceFieldId: textarea.id || '',
        sourceTextarea: textarea,
        removeFrom: from,
        removeTo: to,
        removedIds: listManagedEmphasisBlocks(value)
            .filter((b) => b.start >= from && b.end <= to)
            .map((b) => b.id),
        weightsById,
        classic,
        droppedOn: null
    };

    try {
        e.dataTransfer.setData('text/plain', classic);
        e.dataTransfer.setData(EMPHASIS_DRAG_MIME, JSON.stringify({
            sourceFieldId: textarea.id || '',
            weightsById,
            classic
        }));
        e.dataTransfer.effectAllowed = 'copyMove';
    } catch (_err) {
        // Some browsers reject custom MIME types — text/plain classic is enough.
        try { e.dataTransfer.setData('text/plain', classic); } catch (_e2) { /* ignore */ }
    }
}

function handleManagedEmphasisDragOver(e, textarea) {
    if (!e || !e.dataTransfer) return;
    const types = e.dataTransfer.types ? Array.from(e.dataTransfer.types) : [];
    // Only claim drops that carry our emphasis payload (or text while a weighted drag is active).
    if (!types.includes(EMPHASIS_DRAG_MIME)
        && !(_emphasisInternalDrag && types.includes('text/plain'))) {
        return;
    }
    e.preventDefault();
    const sameField = _emphasisInternalDrag
        && _emphasisInternalDrag.sourceTextarea === textarea;
    e.dataTransfer.dropEffect = sameField ? 'move' : 'copy';
}

function handleManagedEmphasisDrop(e, textarea) {
    if (!e || !textarea || !textarea.id || !e.dataTransfer) return;

    let clip = null;
    try { clip = e.dataTransfer.getData('text/plain'); } catch (_err) { clip = null; }
    let meta = null;
    try {
        const raw = e.dataTransfer.getData(EMPHASIS_DRAG_MIME);
        if (raw) meta = JSON.parse(raw);
    } catch (_err) { meta = null; }

    if (meta && meta.weightsById) {
        if (!_emphasisInternalDrag) {
            _emphasisInternalDrag = {
                sourceFieldId: meta.sourceFieldId || '',
                sourceTextarea: null,
                removeFrom: 0,
                removeTo: 0,
                removedIds: [],
                weightsById: meta.weightsById,
                classic: meta.classic || clip || '',
                droppedOn: textarea
            };
        } else {
            _emphasisInternalDrag.weightsById = {
                ..._emphasisInternalDrag.weightsById,
                ...meta.weightsById
            };
        }
    }

    const preferClassic = (meta && meta.classic) || clip;
    // Plain / segment drops: leave native so same-field moves keep working.
    if (!meta && !clipboardPayloadNeedsEmphasisSettle(preferClassic)) return;
    if (preferClassic == null || preferClassic === '') return;

    e.preventDefault();
    e.stopPropagation();

    const start = typeof textarea.selectionStart === 'number' ? textarea.selectionStart : 0;
    const end = typeof textarea.selectionEnd === 'number' ? textarea.selectionEnd : 0;
    let from = Math.min(start, end);
    let to = Math.max(start, end);

    // Same-field move of a full weighted selection: clear source range before insert.
    const sameFieldMove = _emphasisInternalDrag
        && _emphasisInternalDrag.sourceTextarea === textarea
        && e.dataTransfer.dropEffect !== 'copy';
    if (sameFieldMove) {
        const rf = _emphasisInternalDrag.removeFrom;
        const rt = _emphasisInternalDrag.removeTo;
        if (rt > rf) {
            // replaceTextareaRangePreservingUndo: public/scripts/comp/textareaUtils.js
            replaceTextareaRangePreservingUndo(textarea, rf, rt, '');
            if (from >= rt) {
                const delta = rt - rf;
                from -= delta;
                to -= delta;
            } else if (from >= rf && from < rt) {
                from = rf;
                to = rf;
            }
            _emphasisInternalDrag.sourceCleared = true;
        }
    }

    const insertText = preferClassic;
    // replaceTextareaRangePreservingUndo: public/scripts/comp/textareaUtils.js
    replaceTextareaRangePreservingUndo(textarea, from, to, insertText);
    if (_emphasisInternalDrag) _emphasisInternalDrag.droppedOn = textarea;
    settleManagedEmphasisAfterPaste(textarea, from + insertText.length);
}

function handleManagedEmphasisDragEnd(e, textarea) {
    const session = _emphasisInternalDrag;
    _emphasisInternalDrag = null;
    if (!session || session.sourceTextarea !== textarea) return;
    if (session.sourceCleared) return;
    // Cross-field move (rare): remove source span + prune bag when dropEffect says move.
    const effect = e && e.dataTransfer ? e.dataTransfer.dropEffect : 'none';
    if (effect !== 'move') return;
    if (session.droppedOn && session.droppedOn === textarea) return;
    if (!session.droppedOn) return;
    const src = session.sourceTextarea;
    if (!src || !src.id) return;
    if (session.removeTo > session.removeFrom) {
        cutManagedEmphasisSelectionAt(src, session.removeFrom, session.removeTo, session.removedIds);
    }
}

/**
 * Remove a known managed range and prune bag ids (drag-move cleanup).
 */
function cutManagedEmphasisSelectionAt(textarea, removeFrom, removeTo, removedIds) {
    if (!textarea || !textarea.id) return;
    // replaceTextareaRangePreservingUndo: public/scripts/comp/textareaUtils.js
    replaceTextareaRangePreservingUndo(textarea, removeFrom, removeTo, '');
    if (removedIds && removedIds.length) {
        const prev = resolveEmphasisBagForTextarea(textarea) || {};
        const groupsById = { ...(prev.groupsById || {}) };
        removedIds.forEach((id) => {
            delete groupsById[id];
            delete groupsById[String(id)];
        });
        const store = getEmphasisNormalizationFieldStore();
        const keys = getEmphasisNormalizationDualWriteKeys(textarea.id);
        (keys.length ? keys : [textarea.id]).forEach((key) => {
            store[key] = {
                ...(store[key] || prev),
                groupsById: { ...groupsById }
            };
        });
        syncEmphasisNormalizationPreviewMetadata();
        refreshEmphasisGroupsToolInstancesFromForgeState();
    }
    dispatchPromptTextareaInputEvent(textarea, { skipAutofill: true });
    if (updateEmphasisHighlighting) updateEmphasisHighlighting(textarea);
}

function wireManagedEmphasisCaretGuards(textarea) {
    if (!textarea) return;
    if (textarea.dataset.managedCaretWired !== '1') {
        textarea.dataset.managedCaretWired = '1';
        // addSafeEventListener: public/scripts/comp/utilities.js (or event helpers)
        addSafeEventListener(textarea, 'keydown', handleManagedEmphasisCaretKeydown, 'managedCaretSkip');
        addSafeEventListener(textarea, 'keydown', handleManagedEmphasisDeleteKeydown, 'managedCaretDelete');
        addSafeEventListener(textarea, 'click', () => {
            const value = textarea.value || '';
            const pos = textarea.selectionStart;
            if (textarea.selectionStart !== textarea.selectionEnd
                || !hasManagedEmphasisGroupIds(value)) {
                textarea._managedCaretMoveDir = 0;
                // syncEmphasisGroupBoundaryCarets: public/scripts/comp/emphasisHighlight.js
                syncEmphasisGroupBoundaryCarets(textarea);
                return;
            }
            const spans = listManagedEmphasisInvisibleSpans(value);
            const closeAt = spans.find((s) => s.kind === 'close' && s.end === pos);
            const openAt = spans.find((s) => s.kind === 'open' && s.start === pos);
            // Outer edges after a click: stay outside so typing appends past/before the group.
            // Mid-delimiter still settles onto a real edge.
            if (closeAt && !openAt) {
                textarea._managedCaretMoveDir = 1;
                snapCaretIfInsideManagedDelimiter(textarea);
                syncEmphasisGroupBoundaryCarets(textarea);
                return;
            }
            if (openAt && !closeAt) {
                textarea._managedCaretMoveDir = -1;
                snapCaretIfInsideManagedDelimiter(textarea);
                syncEmphasisGroupBoundaryCarets(textarea);
                return;
            }
            if (closeAt && openAt) {
                textarea._managedCaretMoveDir = 0;
                syncEmphasisGroupBoundaryCarets(textarea);
                return;
            }
            textarea._managedCaretMoveDir = 0;
            snapCaretIfInsideManagedDelimiter(textarea);
            syncEmphasisGroupBoundaryCarets(textarea);
        }, 'managedCaretSnap');
        // Arrow leave parks on outer edges — only fix caret stuck mid-delimiter, do not pull back in.
        // Abutting enter-by-direction is handled in keydown.
        addSafeEventListener(textarea, 'keyup', (e) => {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                // isAutofillHorizontalSubNavigation: public/scripts/comp/autocompleteUtils.js
                if (isAutofillHorizontalSubNavigation()) return;
                snapCaretIfInsideManagedDelimiter(textarea);
                syncEmphasisGroupBoundaryCarets(textarea);
                return;
            }
            if (e.key === 'Home' || e.key === 'End') {
                // Shift+Home/End extends selection — do not snap/collapse at group edges.
                if (e.shiftKey) return;
                // End lands at close.end of a trailing group / Home at open.start — force inside
                // (dir 0 no longer pulls in, so End uses -1 and Home uses +1).
                const enterDir = e.key === 'End' ? -1 : 1;
                textarea._managedCaretMoveDir = enterDir;
                snapCaretIntoManagedGroupForTyping(textarea, enterDir);
                syncEmphasisGroupBoundaryCarets(textarea);
            }
        }, 'managedCaretSnapKey');
        // Before insert: only pull across a delimiter when moving into the group (dir-aware).
        // Leave / park-outside keeps typed text outside.
        addSafeEventListener(textarea, 'beforeinput', (e) => {
            if (!e) return;
            if (e.inputType === 'deleteContentBackward' || e.inputType === 'deleteContentForward') {
                // Mirror keydown delete for mobile / OS that synthesize beforeinput without keydown.
                const fakeKey = e.inputType === 'deleteContentBackward' ? 'Backspace' : 'Delete';
                handleManagedEmphasisDeleteKeydown({
                    key: fakeKey,
                    target: textarea,
                    preventDefault: () => e.preventDefault(),
                    altKey: false,
                    ctrlKey: false,
                    metaKey: false
                });
                return;
            }
            if (e.inputType !== 'insertText' && e.inputType !== 'insertCompositionText'
                && e.inputType !== 'insertFromPaste' && e.inputType !== 'insertLineBreak') {
                return;
            }
            snapCaretIntoManagedGroupForTyping(textarea, textarea._managedCaretMoveDir || 0);
        }, 'managedCaretSnapType');
    }
    // Copy/cut expand managed → classic; paste imports classic into current mode.
    wireManagedEmphasisClipboard(textarea);
}

/** Editor modes only: hidden | visible. Global across all prompt/UC/negative fields. */
const EMPHASIS_SYNTAX_MODE_LS_KEY = 'staticforge_emphasis_syntax_mode';

function getGlobalEmphasisSyntaxMode() {
    const store = typeof getEmphasisNormalizationFieldStore === 'function'
        ? getEmphasisNormalizationFieldStore()
        : null;
    // Only an explicit global preference counts — do not invent "hidden" from a random field bag.
    if (store && (store.syntaxMode === 'visible' || store.syntaxMode === 'hidden')) {
        return store.syntaxMode;
    }
    try {
        const ls = localStorage.getItem(EMPHASIS_SYNTAX_MODE_LS_KEY);
        if (ls === 'visible' || ls === 'hidden') return ls;
    } catch (_e) { /* ignore */ }
    return null;
}

function detectEmphasisSyntaxMode(text) {
    if (!hasManagedEmphasisGroupIds(text)) return 'hidden';
    const { opens } = listManagedEmphasisDelimiters(text);
    if (opens.some((o) => o.legacy)) return 'visible';
    return 'hidden';
}

/**
 * Show Syntax for this field: explicit global → field bag → detect from delimiters in text.
 * Never force global default "hidden" over a visible field (that made typed "::" insert
 * invisible closes / swallow colons while the user still sees Show Syntax numbers).
 */
function getEmphasisSyntaxModeForTextarea(textarea) {
    const globalMode = getGlobalEmphasisSyntaxMode();
    if (globalMode === 'visible' || globalMode === 'hidden') return globalMode;
    const bag = resolveEmphasisBagForTextarea(textarea);
    if (bag && bag.syntaxMode === 'visible') return 'visible';
    if (bag && bag.syntaxMode === 'hidden') return 'hidden';
    return detectEmphasisSyntaxMode(textarea?.value || '');
}

/**
 * Apply Show Syntax globally to every manual-editor prompt field (prompt / UC / negative / chars).
 * Rewrites managed delimiters + forge bags; persists preference in forge store + localStorage.
 */
function setGlobalEmphasisSyntaxMode(mode) {
    if (mode !== 'hidden' && mode !== 'visible') return null;

    const store = getEmphasisNormalizationFieldStore();
    store.syntaxMode = mode;
    try {
        localStorage.setItem(EMPHASIS_SYNTAX_MODE_LS_KEY, mode);
    } catch (_e) { /* ignore */ }

    const results = [];
    const textareas = collectManualEditorEmphasisTextareas();
    textareas.forEach((textarea) => {
        results.push(setEmphasisSyntaxModeForTextarea(textarea, mode, { skipGlobalPersist: true }));
        if (typeof promptTextareaToolbar !== 'undefined' && promptTextareaToolbar) {
            promptTextareaToolbar.updateEmphasisGroupChip(
                textarea,
                promptTextareaToolbar.getToolbarFromTextarea(textarea)
            );
        }
    });
    syncEmphasisNormalizationPreviewMetadata();
    refreshEmphasisGroupsToolInstancesFromForgeState();
    return { mode, fields: results.length };
}

/**
 * Switch editor syntax mode for one textarea. Updates text + forge bag.syntaxMode / groupsById.
 * Modes: hidden | visible (Show Syntax toggle). Classic N:: is imported into the active mode.
 * @param {{ skipGlobalPersist?: boolean }} [options]
 */
function setEmphasisSyntaxModeForTextarea(textarea, mode, options = {}) {
    if (!textarea || !textarea.id) return null;
    if (mode !== 'hidden' && mode !== 'visible') return null;

    const fieldKey = textarea.id;
    const store = getEmphasisNormalizationFieldStore();
    if (!options.skipGlobalPersist) {
        store.syntaxMode = mode;
        try {
            localStorage.setItem(EMPHASIS_SYNTAX_MODE_LS_KEY, mode);
        } catch (_e) { /* ignore */ }
    }
    const dualKeys = getEmphasisNormalizationDualWriteKeys(fieldKey);
    const keys = dualKeys.length ? dualKeys : [fieldKey];
    const prev = resolveEmphasisBagForTextarea(textarea) || {};
    let groupsById = { ...(prev.groupsById || {}) };
    let text = textarea.value || '';

    const imported = importClassicEmphasisIntoManagedText(text, groupsById, mode);
    text = imported.text;
    groupsById = imported.groupsById;
    const rewritten = rewriteManagedEmphasisTextMode(text, groupsById, mode);
    text = rewritten.text;
    groupsById = rewritten.groupsById;

    if (text !== textarea.value) {
        setTextareaValuePreservingUndo(textarea, text);
        dispatchPromptTextareaInputEvent(textarea, { skipAutofill: true });
    }

    const nextBag = {
        ...prev,
        syntaxMode: mode,
        groupsById: { ...groupsById }
    };
    keys.forEach((key) => {
        store[key] = { ...nextBag, groupsById: { ...groupsById } };
    });
    if (!options.skipGlobalPersist) {
        syncEmphasisNormalizationPreviewMetadata();
        refreshEmphasisGroupsToolInstancesFromForgeState();
    }
    if (updateEmphasisHighlighting) {
        updateEmphasisHighlighting(textarea);
    }
    return { mode, text, groupsById };
}

function collectLiveManagedEmphasisGroupIds(text) {
    const ids = new Set();
    if (!text || !hasManagedEmphasisGroupIds(text)) return ids;
    listManagedEmphasisBlocks(text).forEach((b) => {
        if (Number.isFinite(b.id)) ids.add(b.id);
    });
    return ids;
}

/**
 * Drop bag entries whose ids are not in the current prompt text.
 * Select-all paste of classic N:: used to keep every historical id, fill 0–255,
 * then allocateNext always returned 0 — every group shared one weight.
 */
function pruneEmphasisGroupsByIdToLiveText(groupsById, text) {
    const live = collectLiveManagedEmphasisGroupIds(text);
    const bag = {};
    live.forEach((id) => {
        const entry = groupsById?.[id] ?? groupsById?.[String(id)];
        if (entry !== undefined) bag[id] = entry;
    });
    return bag;
}

function emphasisGroupsByIdKeySignature(groupsById) {
    return Object.keys(groupsById || {})
        .map((k) => Number(k))
        .filter((n) => Number.isFinite(n) && n >= 0 && n <= EMPHASIS_GROUP_ID_MAX)
        .sort((a, b) => a - b)
        .join(',');
}

function allocateNextManagedEmphasisGroupId(groupsById) {
    const used = new Set();
    Object.keys(groupsById || {}).forEach((k) => {
        const n = Number(k);
        if (Number.isFinite(n) && n >= 0 && n <= EMPHASIS_GROUP_ID_MAX) used.add(n);
    });
    for (let id = 0; id <= EMPHASIS_GROUP_ID_MAX; id++) {
        if (!used.has(id)) return id;
    }
    // Never collide onto 0 — that makes every group share one weight.
    return -1;
}

/**
 * Import classic N:: groups that are not already managed into the bag + managed text.
 * mode: 'hidden' | 'visible'
 */
function importClassicEmphasisIntoManagedText(text, groupsById, mode) {
    const value = String(text || '');
    const bag = pruneEmphasisGroupsByIdToLiveText(groupsById, value);
    const managedSpans = hasManagedEmphasisGroupIds(value)
        ? listManagedEmphasisBlocks(value).map((b) => ({ start: b.start, end: b.end }))
        : [];
    const classic = listAllEmphasisTargets(value)
        .filter((t) => t.type === 'group')
        .filter((t) => !isEmptyEmphasisInnerText(t.innerText))
        .filter((t) => !managedSpans.some((s) => t.start >= s.start && t.end <= s.end))
        .sort((a, b) => a.start - b.start);

    if (!classic.length) {
        return { text: value, groupsById: bag, imported: 0 };
    }

    let out = value;
    let imported = 0;
    for (let i = classic.length - 1; i >= 0; i--) {
        const t = classic[i];
        const id = allocateNextManagedEmphasisGroupId(bag);
        if (id < 0) break;
        const weight = Number.isFinite(t.weight) ? t.weight : 1;
        bag[id] = weight;
        const managed = buildManagedEmphasisGroupText(id, t.innerText, { mode, weight });
        out = out.slice(0, t.start) + managed + out.slice(t.end);
        imported++;
    }
    return { text: out, groupsById: bag, imported };
}

/**
 * Pre-v4 NovelAI braces/brackets → managed weight groups.
 * Official: `{tag}` → 1.05^n, `[tag]` → (1/1.05)^n (via weightFromBraceBlockText).
 * Skips spans already inside classic N:: or managed id groups.
 * listBraceEmphasisTargets / listEmphasisBlocks: public/scripts/comp/emphasisParse.js
 */
function importBraceEmphasisIntoManagedText(text, groupsById, mode) {
    const value = String(text || '');
    const bag = pruneEmphasisGroupsByIdToLiveText(groupsById, value);
    const protectedSpans = listEmphasisBlocks(value).map((b) => ({ start: b.start, end: b.end }));
    if (hasManagedEmphasisGroupIds(value)) {
        listManagedEmphasisBlocks(value).forEach((b) => {
            protectedSpans.push({ start: b.start, end: b.end });
        });
    }
    const braces = listBraceEmphasisTargets(value, protectedSpans)
        .filter((t) => String(t.innerText || '').length > 0)
        .sort((a, b) => a.start - b.start);

    if (!braces.length) {
        return { text: value, groupsById: bag, imported: 0 };
    }

    let out = value;
    let imported = 0;
    for (let i = braces.length - 1; i >= 0; i--) {
        const t = braces[i];
        const id = allocateNextManagedEmphasisGroupId(bag);
        if (id < 0) break;
        const weight = Number.isFinite(t.weight) ? t.weight : 1;
        bag[id] = weight;
        const managed = buildManagedEmphasisGroupText(id, t.innerText, { mode, weight });
        out = out.slice(0, t.start) + managed + out.slice(t.end);
        imported++;
    }
    return { text: out, groupsById: bag, imported };
}

function countConvertibleBraceEmphasis(text) {
    const value = String(text || '');
    if (!value) return 0;
    const protectedSpans = listEmphasisBlocks(value).map((b) => ({ start: b.start, end: b.end }));
    if (hasManagedEmphasisGroupIds(value)) {
        listManagedEmphasisBlocks(value).forEach((b) => {
            protectedSpans.push({ start: b.start, end: b.end });
        });
    }
    return listBraceEmphasisTargets(value, protectedSpans)
        .filter((t) => String(t.innerText || '').length > 0)
        .length;
}

/**
 * Convert pre-v4 {}/[] in one textarea → managed ids + forge bags (current syntax mode).
 */
function convertBraceEmphasisGroupsForTextarea(textarea) {
    if (!textarea || !textarea.id) return null;
    const mode = getEmphasisSyntaxModeForTextarea(textarea) === 'visible' ? 'visible' : 'hidden';
    const prev = resolveEmphasisBagForTextarea(textarea) || {};
    const groupsById = { ...(prev.groupsById || {}) };
    const imported = importBraceEmphasisIntoManagedText(textarea.value || '', groupsById, mode);
    if (!imported.imported) return { imported: 0, text: textarea.value || '', groupsById };

    // setTextareaValuePreservingUndo: public/scripts/comp/textareaUtils.js
    setTextareaValuePreservingUndo(textarea, imported.text);
    // dispatchPromptTextareaInputEvent: public/scripts/comp/utilities.js
    dispatchPromptTextareaInputEvent(textarea, { skipAutofill: true });

    const store = getEmphasisNormalizationFieldStore();
    const keys = getEmphasisNormalizationDualWriteKeys(textarea.id);
    (keys.length ? keys : [textarea.id]).forEach((key) => {
        store[key] = {
            ...(store[key] || prev),
            syntaxMode: mode,
            groupsById: { ...imported.groupsById }
        };
    });
    syncEmphasisNormalizationPreviewMetadata();
    refreshEmphasisGroupsToolInstancesFromForgeState();
    // updateEmphasisHighlighting: public/scripts/comp/emphasisHighlight.js
    updateEmphasisHighlighting(textarea);
    return {
        imported: imported.imported,
        text: imported.text,
        groupsById: imported.groupsById
    };
}

function rewriteManagedEmphasisTextMode(text, groupsById, mode) {
    const blocks = listManagedEmphasisBlocks(text);
    if (!blocks.length) return { text, groupsById: { ...(groupsById || {}) } };
    const bag = { ...(groupsById || {}) };
    let out = text;
    for (let i = blocks.length - 1; i >= 0; i--) {
        const b = blocks[i];
        let weight = resolveWeightForEmphasisGroupId(b.id, { groupsById: bag });
        if (!Number.isFinite(weight) && Number.isFinite(b.textWeight)) weight = b.textWeight;
        if (!Number.isFinite(weight)) weight = 1;
        bag[b.id] = weight;
        if (mode === 'visible') {
            const managed = buildManagedEmphasisGroupText(b.id, b.innerText, {
                mode: 'visible',
                weight,
                omitClose: !b.needsTerminator
            });
            out = out.slice(0, b.start) + managed + out.slice(b.end);
        } else {
            const managed = buildManagedEmphasisGroupText(b.id, b.innerText, {
                mode: 'hidden',
                weight,
                omitClose: !b.needsTerminator
            });
            out = out.slice(0, b.start) + managed + out.slice(b.end);
        }
    }
    return { text: out, groupsById: bag };
}

function countEmphasisGroupsForIdReindex(text) {
    const value = String(text || '');
    if (!value) return 0;
    const managedSpans = [];
    let n = 0;
    if (hasManagedEmphasisGroupIds(value)) {
        listManagedEmphasisBlocks(value).forEach((b) => {
            n++;
            managedSpans.push({ start: b.start, end: b.end });
        });
    }
    // listAllEmphasisTargets: public/scripts/comp/emphasisParse.js
    listAllEmphasisTargets(value)
        .filter((t) => t.type === 'group')
        .forEach((t) => {
            if (managedSpans.some((s) => t.start >= s.start && t.end <= s.end)) return;
            n++;
        });
    return n;
}

function weightForReindexManagedBlock(block, groupsById, idCounts) {
    const collided = (idCounts.get(block.id) || 0) > 1;
    if (collided && Number.isFinite(block.textWeight)) return block.textWeight;
    let weight = resolveWeightForEmphasisGroupId(block.id, { groupsById });
    if (!Number.isFinite(weight) && Number.isFinite(block.textWeight)) weight = block.textWeight;
    if (!Number.isFinite(weight)) weight = 1;
    return weight;
}

function managedEmphasisGroupIdsAreSequential(text, groupsById) {
    const blocks = hasManagedEmphasisGroupIds(text) ? listManagedEmphasisBlocks(text) : [];
    if (!blocks.length) return false;
    for (let i = 0; i < blocks.length; i++) {
        if (blocks[i].id !== i) return false;
    }
    return emphasisGroupsByIdKeySignature(groupsById) === blocks.map((_b, i) => i).join(',');
}

/**
 * Rewrite every managed group to document-order ids 0..n-1 and a compact bag.
 * Sequential same-id spans still split (first-open/first-close); nested same-id
 * groups cannot be recovered. Collided ids prefer visible textWeight per span.
 */
function reindexManagedEmphasisGroupIdsInText(text, groupsById, mode) {
    const value = String(text || '');
    const blocks = hasManagedEmphasisGroupIds(value) ? listManagedEmphasisBlocks(value) : [];
    if (!blocks.length) {
        return { text: value, groupsById: {}, remapped: 0, oldIds: [] };
    }
    if (blocks.length > EMPHASIS_GROUP_ID_MAX + 1) {
        return { text: value, groupsById: { ...(groupsById || {}) }, remapped: 0, oldIds: [], overflow: true };
    }

    const idCounts = new Map();
    blocks.forEach((b) => idCounts.set(b.id, (idCounts.get(b.id) || 0) + 1));

    const newBag = {};
    const oldIds = blocks.map((b) => b.id);
    let out = value;
    for (let i = blocks.length - 1; i >= 0; i--) {
        const b = blocks[i];
        const weight = weightForReindexManagedBlock(b, groupsById, idCounts);
        newBag[i] = weight;
        out = out.slice(0, b.start) + buildManagedEmphasisGroupText(i, b.innerText, {
            mode: mode === 'visible' ? 'visible' : 'hidden',
            weight,
            omitClose: !b.needsTerminator
        }) + out.slice(b.end);
    }
    return { text: out, groupsById: newBag, remapped: blocks.length, oldIds };
}

function remapManagedIdKeyedStore(store, oldIds, uniqueOldIds, indexFallback) {
    if (!store || typeof store !== 'object') return store;
    const out = {};
    Object.keys(store).forEach((key) => {
        if (/^managed:\d+$/.test(key) || /^\d+$/.test(key)) return;
        out[key] = store[key];
    });
    oldIds.forEach((oldId, newId) => {
        let value;
        if (uniqueOldIds.has(oldId)) {
            value = store[`managed:${oldId}`] ?? store[oldId] ?? store[String(oldId)];
        }
        if (value === undefined && Array.isArray(indexFallback)) value = indexFallback[newId];
        if (value === undefined) return;
        out[`managed:${newId}`] = value;
        out[newId] = value;
    });
    return out;
}

function remapEmphasisBagAfterGroupIdReindex(prevBag, reindexed) {
    const next = { ...(prevBag || {}) };
    const oldIds = Array.isArray(reindexed.oldIds) ? reindexed.oldIds : [];
    const uniqueOldIds = new Set();
    const seen = new Set();
    oldIds.forEach((id) => {
        if (seen.has(id)) uniqueOldIds.delete(id);
        else {
            seen.add(id);
            uniqueOldIds.add(id);
        }
    });
    const percentages = Array.isArray(next.percentages) ? next.percentages : null;
    if (next.percentagesByKey && typeof next.percentagesByKey === 'object') {
        next.percentagesByKey = remapManagedIdKeyedStore(next.percentagesByKey, oldIds, uniqueOldIds, percentages);
    }
    if (next.cards && typeof next.cards === 'object') {
        next.cards = remapManagedIdKeyedStore(next.cards, oldIds, uniqueOldIds, null);
    }
    if (next.preNormalizeWeights && typeof next.preNormalizeWeights === 'object') {
        next.preNormalizeWeights = remapManagedIdKeyedStore(next.preNormalizeWeights, oldIds, uniqueOldIds, null);
    }
    next.groupsById = { ...(reindexed.groupsById || {}) };
    return next;
}

/**
 * Import leftover classic N::, then assign sequential managed ids 0, 1, 2… in this field.
 */
function reindexManagedEmphasisGroupIdsForTextarea(textarea) {
    if (!textarea || !textarea.id) return null;
    const mode = getEmphasisSyntaxModeForTextarea(textarea) === 'visible' ? 'visible' : 'hidden';
    const prev = resolveEmphasisBagForTextarea(textarea) || {};
    let value = textarea.value || '';
    let groupsById = pruneEmphasisGroupsByIdToLiveText(prev.groupsById || {}, value);

    const imported = importClassicEmphasisIntoManagedText(value, groupsById, mode);
    value = imported.text;
    groupsById = imported.groupsById;

    if (!imported.imported && managedEmphasisGroupIdsAreSequential(value, groupsById)) {
        return {
            remapped: 0,
            imported: 0,
            alreadySequential: true,
            overflow: false,
            text: value,
            groupsById
        };
    }

    const reindexed = reindexManagedEmphasisGroupIdsInText(value, groupsById, mode);
    if (reindexed.overflow) {
        return {
            remapped: 0,
            imported: imported.imported || 0,
            alreadySequential: false,
            overflow: true,
            text: value,
            groupsById
        };
    }
    if (!reindexed.remapped && !imported.imported) {
        return {
            remapped: 0,
            imported: 0,
            alreadySequential: false,
            overflow: false,
            text: value,
            groupsById
        };
    }

    if (reindexed.text !== textarea.value) {
        // setTextareaValuePreservingUndo: public/scripts/comp/textareaUtils.js
        setTextareaValuePreservingUndo(textarea, reindexed.text);
        // dispatchPromptTextareaInputEvent: public/scripts/comp/emphasisParse.js
        dispatchPromptTextareaInputEvent(textarea, { skipAutofill: true });
    }

    const nextBag = remapEmphasisBagAfterGroupIdReindex(prev, reindexed);
    nextBag.syntaxMode = mode;
    nextBag.groupsById = { ...reindexed.groupsById };

    const store = getEmphasisNormalizationFieldStore();
    const keys = getEmphasisNormalizationDualWriteKeys(textarea.id);
    (keys.length ? keys : [textarea.id]).forEach((key) => {
        store[key] = { ...(store[key] || prev), ...nextBag, groupsById: { ...reindexed.groupsById } };
    });
    syncEmphasisNormalizationPreviewMetadata();
    refreshEmphasisGroupsToolInstancesFromForgeState();
    // updateEmphasisHighlighting: public/scripts/comp/emphasisHighlight.js
    updateEmphasisHighlighting(textarea);
    return {
        remapped: reindexed.remapped,
        imported: imported.imported || 0,
        alreadySequential: false,
        overflow: false,
        text: reindexed.text,
        groupsById: reindexed.groupsById
    };
}

/**
 * On blur / paste settle: migrate managed ids missing local weights from sibling
 * prompt bags (or the active drag session), drop unpaired managed closes, strip
 * dead ZW, trim edge commas/spaces, drop empty ZWSP/classic groups, then convert
 * classic N:: leftovers into the field's current hidden|visible mode and write groupsById.
 */
function importUnmanagedEmphasisGroupsForTextarea(textarea) {
    if (!textarea || !textarea.id) return null;
    const mode = getEmphasisSyntaxModeForTextarea(textarea) === 'visible' ? 'visible' : 'hidden';
    const prev = resolveEmphasisBagForTextarea(textarea) || {};
    let value = textarea.value || '';
    const originalValue = value;
    let groupsById = pruneEmphasisGroupsByIdToLiveText(prev.groupsById || {}, value);
    const bagSigStart = emphasisGroupsByIdKeySignature(prev.groupsById || {});
    let orphanClosesRemoved = 0;
    let orphanIds = [];
    let migrated = 0;
    let remapped = 0;

    // Cross-field drag of raw managed markers: pull weights from other prompt bags.
    const migratedBag = migrateManagedEmphasisWeightsFromSiblingFields(textarea, groupsById);
    if (migratedBag.migrated || migratedBag.remapped || migratedBag.text !== value) {
        value = migratedBag.text;
        groupsById = migratedBag.groupsById;
        migrated = migratedBag.migrated;
        remapped = migratedBag.remapped;
    }

    const imported = importClassicEmphasisIntoManagedText(value, groupsById, mode);
    if (imported.imported) {
        value = imported.text;
        groupsById = imported.groupsById;
    }
    // Empty classic N:::: is not imported (would become invisible ZWSP); strip it here.
    value = removeEmptyClassicEmphasisGroups(value);

    // normalizeManagedEmphasisEditorText: unpaired closes → strip dead ZW → trim edges → drop empty groups
    const normalized = normalizeManagedEmphasisEditorText(value);
    orphanClosesRemoved = normalized.orphanClosesRemoved;
    orphanIds = normalized.orphanIds;
    if (normalized.changed) {
        value = normalized.text;
    }

    groupsById = pruneEmphasisGroupsByIdToLiveText(groupsById, value);
    const bagChanged = bagSigStart !== emphasisGroupsByIdKeySignature(groupsById);
    const textChanged = value !== originalValue;

    if (!textChanged && !bagChanged && !migrated && !remapped && !imported.imported) {
        return null;
    }

    if (textChanged) {
        setTextareaValuePreservingUndo(textarea, value);
    }
    const store = getEmphasisNormalizationFieldStore();
    const keys = getEmphasisNormalizationDualWriteKeys(textarea.id);
    (keys.length ? keys : [textarea.id]).forEach((key) => {
        store[key] = {
            ...(store[key] || prev),
            syntaxMode: mode,
            groupsById: { ...groupsById }
        };
    });
    syncEmphasisNormalizationPreviewMetadata();
    refreshEmphasisGroupsToolInstancesFromForgeState();
    if (updateEmphasisHighlighting) {
        updateEmphasisHighlighting(textarea);
    }
    if (promptTextareaToolbar) {
        promptTextareaToolbar.updateEmphasisGroupChip(textarea, promptTextareaToolbar.getToolbarFromTextarea(textarea));
    }
    return {
        imported: imported.imported || 0,
        migrated,
        remapped,
        orphanClosesRemoved,
        orphanIds,
        text: value,
        groupsById
    };
}

function writeManagedEmphasisGroupWeightsForTextarea(textarea, updates) {
    if (!textarea?.id || !updates?.length) return;
    const fieldKey = textarea.id;
    // getEmphasisNormalizationFieldStore / syncEmphasisNormalizationPreviewMetadata:
    //   public/scripts/comp/emphasisGroupsToolManager.js
    const store = getEmphasisNormalizationFieldStore();
    const dualKeys = getEmphasisNormalizationDualWriteKeys(fieldKey);
    const keys = dualKeys.length ? dualKeys : [fieldKey];
    let groupsById = {};
    keys.forEach((key) => {
        const prev = store[key] && typeof store[key] === 'object' ? store[key] : {};
        groupsById = { ...(prev.groupsById || {}), ...groupsById };
        updates.forEach((u) => {
            if (u.weight == null || u.remove) {
                delete groupsById[u.id];
                delete groupsById[String(u.id)];
            } else {
                groupsById[u.id] = u.weight;
            }
        });
    });

    // Visible mode: keep leading N: in sync with forge weights
    const mode = getEmphasisSyntaxModeForTextarea(textarea);
    if (mode === 'visible' && hasManagedEmphasisGroupIds(textarea.value || '')) {
        const rewritten = rewriteManagedEmphasisTextMode(textarea.value || '', groupsById, 'visible');
        if (rewritten.text !== textarea.value) {
            setTextareaValuePreservingUndo(textarea, rewritten.text);
        }
    }

    groupsById = pruneEmphasisGroupsByIdToLiveText(groupsById, textarea.value || '');
    keys.forEach((key) => {
        const prev = store[key] && typeof store[key] === 'object' ? store[key] : {};
        store[key] = { ...prev, groupsById: { ...groupsById } };
    });

    syncEmphasisNormalizationPreviewMetadata();
}

/**
 * Normalize band for a field from open Weight Rack or forge bag.enabled (WR need not be open).
 * @returns {{ enabled: boolean, distribution: boolean, minWeight: number, maxWeight: number, bag: object|null, instance: object|null }}
 */
function getEmphasisNormalizeBandForTextarea(textarea) {
    const bag = resolveEmphasisBagForTextarea(textarea);
    // emphasisGroupsToolManager.getInstanceByTextareaId: public/scripts/comp/emphasisGroupsToolManager.js
    const instance = (textarea?.id && typeof emphasisGroupsToolManager !== 'undefined'
        && emphasisGroupsToolManager
        && emphasisGroupsToolManager.getInstanceByTextareaId)
        ? emphasisGroupsToolManager.getInstanceByTextareaId(textarea.id)
        : null;
    if (instance && instance.normalizeEnabled) {
        return {
            enabled: true,
            distribution: !!instance.distributionMode,
            minWeight: Number.isFinite(instance.minWeight) ? instance.minWeight : 1,
            maxWeight: Number.isFinite(instance.maxWeight) ? instance.maxWeight : 2,
            bag: bag || null,
            instance
        };
    }
    if (bag && bag.enabled) {
        return {
            enabled: true,
            distribution: !!(bag.distribution || bag.distributionMode),
            minWeight: Number.isFinite(bag.minWeight) ? bag.minWeight : 1,
            maxWeight: Number.isFinite(bag.maxWeight) ? bag.maxWeight : 2,
            bag,
            instance: null
        };
    }
    return {
        enabled: false,
        distribution: false,
        minWeight: 1,
        maxWeight: 2,
        bag: bag || null,
        instance: null
    };
}

/**
 * Direct-emphasis digit string → weight. Normalize on: digits are track % (0–100).
 * Normalize off: legacy 1 → 1.0, 15 → 1.5.
 */
function resolveDirectEmphasisWeightFromDigits(digits, isAlt, textarea) {
    if (!digits || !digits.length) return null;
    const band = getEmphasisNormalizeBandForTextarea(textarea);
    let weight;
    let sharePercent = null;
    if (band.enabled) {
        const pct = Math.max(0, Math.min(100, parseInt(digits, 10)));
        if (!Number.isFinite(pct)) return null;
        sharePercent = pct;
        // shareToWeightFromRange: public/scripts/comp/emphasisParse.js
        weight = shareToWeightFromRange(pct, band.minWeight, band.maxWeight);
    } else if (digits.length === 1) {
        weight = parseInt(digits, 10);
    } else {
        weight = parseFloat(digits.charAt(0) + '.' + digits.slice(1));
    }
    if (!Number.isFinite(weight)) return null;
    if (isAlt) weight = -Math.abs(weight);
    else if (band.enabled) weight = Math.abs(weight);
    weight = clampEmphasisWeight(weight);
    return { weight, sharePercent, band };
}

/**
 * Optimal weight for a new group when normalize is on: equal share of (n+1) on the band.
 */
function computeOptimalEmphasisWeightForNewGroup(textarea) {
    const band = getEmphasisNormalizeBandForTextarea(textarea);
    if (!band.enabled) return 1;
    const value = textarea?.value || '';
    let n = 0;
    if (hasManagedEmphasisGroupIds(value)) {
        n = listManagedEmphasisBlocks(value).length;
    } else {
        n = listAllEmphasisTargets(value).filter((t) => t.type === 'group').length;
    }
    const equalShare = 100 / Math.max(1, n + 1);
    return shareToWeightFromRange(equalShare, band.minWeight, band.maxWeight);
}

/**
 * Resolve share % for a managed block from forge percentages / open WR / weight→share.
 */
function resolveEmphasisShareForManagedBlock(textarea, block, bandIn) {
    const band = bandIn || getEmphasisNormalizeBandForTextarea(textarea);
    if (!band.enabled || !block) return null;
    const bag = band.bag || resolveEmphasisBagForTextarea(textarea) || {};
    const keyHint = block.managed
        ? `managed:${block.managedId ?? block.id}`
        : null;
    if (band.instance && Array.isArray(band.instance.targets) && Array.isArray(band.instance.shares)) {
        const idx = band.instance.targets.findIndex((t) =>
            t && t.managed && (t.managedId === block.id || t.managedId === block.managedId)
        );
        if (idx >= 0 && Number.isFinite(band.instance.shares[idx])) {
            return clampEmphasisShare(band.instance.shares[idx]);
        }
        if (band.distribution && idx >= 0) {
            const imp = band.instance.targets[idx]?.cardState?.importance;
            if (Number.isFinite(imp)) return clampEmphasisShare(imp);
        }
    }
    if (bag.percentagesByKey && typeof bag.percentagesByKey === 'object') {
        const byId = bag.percentagesByKey[`managed:${block.id}`]
            ?? bag.percentagesByKey[block.id]
            ?? bag.percentagesByKey[String(block.id)];
        if (Number.isFinite(byId)) return clampEmphasisShare(byId);
        if (keyHint && Number.isFinite(bag.percentagesByKey[keyHint])) {
            return clampEmphasisShare(bag.percentagesByKey[keyHint]);
        }
    }
    if (Array.isArray(bag.percentages) && hasManagedEmphasisGroupIds(textarea.value || '')) {
        const blocks = listManagedEmphasisBlocks(textarea.value || '');
        const idx = blocks.findIndex((b) => b.id === block.id);
        if (idx >= 0 && Number.isFinite(bag.percentages[idx])) {
            return clampEmphasisShare(bag.percentages[idx]);
        }
    }
    const w = Number.isFinite(block.weight)
        ? block.weight
        : resolveWeightForEmphasisGroupId(block.id, bag);
    if (Number.isFinite(w)) {
        return weightToShare(w, band.minWeight, band.maxWeight, { normalizePrecision: true });
    }
    return null;
}

/**
 * Suggested share/weight for the active group (WR open or bag.enabled).
 * @returns {{ share: number|null, weight: number|null }|null}
 */
function resolveSuggestedEmphasisForTextarea(textarea, managedId) {
    const band = getEmphasisNormalizeBandForTextarea(textarea);
    if (!band.enabled) return null;
    if (band.instance && Number.isFinite(managedId)) {
        const idx = band.instance.targets?.findIndex((t) =>
            t && t.managed && t.managedId === managedId
        );
        if (idx >= 0) {
            const suggested = band.instance._suggestedByLocalIndex?.[idx];
            if (Number.isFinite(suggested)) {
                const share = weightToShare(
                    suggested,
                    band.minWeight,
                    band.maxWeight,
                    { normalizePrecision: true }
                );
                return { share: clampEmphasisShare(share), weight: suggested };
            }
            if (band.distribution) {
                return {
                    share: EMPHASIS_IMPORTANCE_UNBIASED,
                    weight: shareToWeightFromRange(
                        EMPHASIS_IMPORTANCE_UNBIASED,
                        band.minWeight,
                        band.maxWeight
                    )
                };
            }
        }
    }
    // Equal-share fallback when no length-based suggestion
    const equal = 100 / Math.max(
        1,
        (hasManagedEmphasisGroupIds(textarea?.value || '')
            ? listManagedEmphasisBlocks(textarea.value).length
            : listAllEmphasisTargets(textarea?.value || '').filter((t) => t.type === 'group').length) || 1
    );
    return {
        share: clampEmphasisShare(equal),
        weight: shareToWeightFromRange(equal, band.minWeight, band.maxWeight)
    };
}

/**
 * Wrap selection (or update overlapping managed group) in current hidden/visible mode.
 * @returns {{ success: boolean, start?: number, end?: number, id?: number, weight?: number }|false}
 */
function wrapOrUpdateManagedEmphasisSelection(textarea, weight, options = {}) {
    if (!textarea) return false;
    const value = textarea.value || '';
    const selStart = options.start != null ? options.start : textarea.selectionStart;
    const selEnd = options.end != null ? options.end : textarea.selectionEnd;
    if (selStart === selEnd) return false;

    const selectedText = value.substring(selStart, selEnd);
    if (!selectedText.trim()) return false;

    let numericWeight = typeof weight === 'string' ? parseFloat(weight) : weight;
    if (!Number.isFinite(numericWeight)) numericWeight = 1;
    numericWeight = clampEmphasisWeight(numericWeight);

    const mode = getEmphasisSyntaxModeForTextarea(textarea) === 'visible' ? 'visible' : 'hidden';
    const bag = resolveEmphasisBagForTextarea(textarea) || {};
    const groupsById = pruneEmphasisGroupsByIdToLiveText(bag.groupsById || {}, value);

    const block = findManagedEmphasisBlockAtCursor(value, selStart, bag)
        || findManagedEmphasisBlockAtCursor(value, Math.max(selStart, selEnd - 1), bag);

    let id;
    let replaceStart = selStart;
    let replaceEnd = selEnd;
    let innerText = selectedText;

    if (block && selStart >= block.start && selEnd <= block.end) {
        id = block.id;
        replaceStart = block.start;
        replaceEnd = block.end;
        // Full-group replace keeps inner; partial selection inside updates weight on whole group
        if (selStart <= block.openEnd && selEnd >= block.closeStart) {
            innerText = block.innerText;
        } else if (selStart >= block.openEnd && selEnd <= block.closeStart) {
            // Selection wholly in content — still reweight existing group (direct emphasis on group)
            innerText = block.innerText;
        } else {
            innerText = block.innerText;
        }
        groupsById[id] = numericWeight;
    } else {
        id = allocateNextManagedEmphasisGroupId(groupsById);
        if (id < 0) return false;
        groupsById[id] = numericWeight;
        // Strip classic wrap if selection is already classic emphasis
        const traditional = selectedText.match(new RegExp(`^(${EMPHASIS_WEIGHT_PART})::(.+)::$`));
        const autoTerm = selectedText.match(new RegExp(`^(${EMPHASIS_WEIGHT_PART})::(.+)$`));
        if (traditional) innerText = traditional[2];
        else if (autoTerm) innerText = autoTerm[2];
    }

    const wrapped = buildManagedEmphasisGroupText(id, innerText, { mode, weight: numericWeight });
    const next = value.slice(0, replaceStart) + wrapped + value.slice(replaceEnd);
    // setTextareaValuePreservingUndo: public/scripts/comp/textareaUtils.js
    setTextareaValuePreservingUndo(textarea, next);

    const store = getEmphasisNormalizationFieldStore();
    getEmphasisNormalizationDualWriteKeys(textarea.id).forEach((key) => {
        store[key] = {
            ...(store[key] || bag),
            groupsById: { ...groupsById },
            syntaxMode: mode
        };
    });
    syncEmphasisNormalizationPreviewMetadata();
    // refreshEmphasisGroupsToolInstancesFromForgeState: public/scripts/comp/emphasisGroupsToolManager.js
    refreshEmphasisGroupsToolInstancesFromForgeState();
    if (updateEmphasisHighlighting) {
        updateEmphasisHighlighting(textarea);
    }
    if (promptTextareaToolbar) {
        promptTextareaToolbar.updateEmphasisGroupChip(
            textarea,
            promptTextareaToolbar.getToolbarFromTextarea(textarea)
        );
    }
    dispatchPromptTextareaInputEvent(textarea, { skipAutofill: true });

    return {
        success: true,
        start: replaceStart,
        end: replaceStart + wrapped.length,
        id,
        weight: numericWeight,
        emphasizedText: wrapped
    };
}

/**
 * Alt+S / caret split for a managed emphasis group (same trim/comma rules as classic).
 * buildEmphasisSplitInsert / formatEmphasisSplitWeight: public/scripts/comp/emphasisParse.js
 * @returns {boolean}
 */
function splitManagedEmphasisBlockAtCursor(textarea, options = {}) {
    if (!textarea) return false;
    if (textarea.selectionStart !== textarea.selectionEnd) return false;
    const value = textarea.value || '';
    if (!hasManagedEmphasisGroupIds(value)) return false;

    const bag = resolveEmphasisBagForTextarea(textarea) || {};
    const pos = textarea.selectionStart;
    const block = findManagedEmphasisBlockAtCursor(value, pos, bag);
    if (!block) return false;
    if (pos <= block.openEnd || pos >= block.closeStart) return false;

    const leftPart = value.substring(block.openEnd, pos);
    const rightPart = value.substring(pos, block.closeStart);
    if (!leftPart.replace(/\s+$/, '') || !rightPart.replace(/^\s+/, '').replace(/^\s*,\s*/, '')) {
        return false;
    }

    const weight = Number.isFinite(block.weight) ? block.weight : 1;
    // formatEmphasisSplitWeight / buildEmphasisSplitInsert: public/scripts/comp/emphasisParse.js
    const weightStr = formatEmphasisSplitWeight(weight);
    const { leftCore, rightOut, insert, caretBeforeInsert } = buildEmphasisSplitInsert(
        leftPart, rightPart, weightStr, options.addComma
    );

    let placeBefore = caretBeforeInsert;
    if (options.caretSide === 'before') placeBefore = true;
    else if (options.caretSide === 'after') placeBefore = false;

    // Classic insert is `::…weight::`; managed uses the same between-text without the :: wrappers.
    const weightSuffix = `${weightStr}::`;
    let between = insert.startsWith('::') ? insert.slice(2) : insert;
    if (between.endsWith(weightSuffix)) between = between.slice(0, -weightSuffix.length);

    const managedMode = getEmphasisSyntaxModeForTextarea(textarea) === 'visible' ? 'visible' : 'hidden';
    const groupsById = pruneEmphasisGroupsByIdToLiveText(bag.groupsById || {}, value);
    const idLeft = block.id;
    const idRight = allocateNextManagedEmphasisGroupId(groupsById);
    if (idRight < 0) return false;
    groupsById[idLeft] = weight;
    groupsById[idRight] = weight;

    const leftGroup = buildManagedEmphasisGroupText(idLeft, leftCore, { mode: managedMode, weight });
    const rightGroup = buildManagedEmphasisGroupText(idRight, rightOut, { mode: managedMode, weight });
    const replacement = leftGroup + between + rightGroup;
    const next = value.slice(0, block.start) + replacement + value.slice(block.end);

    const leftContentEnd = leftGroup.indexOf(leftCore) + leftCore.length;
    const rightContentStart = leftGroup.length + between.length + rightGroup.indexOf(rightOut);
    const newCaret = block.start + (placeBefore ? leftContentEnd : rightContentStart);

    // setTextareaValuePreservingUndo: public/scripts/comp/textareaUtils.js
    setTextareaValuePreservingUndo(textarea, next);
    writeManagedEmphasisGroupWeightsForTextarea(textarea, [
        { id: idLeft, weight },
        { id: idRight, weight }
    ]);
    // getEmphasisNormalizationFieldStore / DualWriteKeys: public/scripts/comp/emphasisGroupsToolManager.js
    const store = getEmphasisNormalizationFieldStore();
    getEmphasisNormalizationDualWriteKeys(textarea.id).forEach((key) => {
        const prev = store[key] || {};
        const percentagesByKey = { ...(prev.percentagesByKey || {}) };
        const leftShare = percentagesByKey[`managed:${idLeft}`]
            ?? percentagesByKey[idLeft]
            ?? percentagesByKey[String(idLeft)];
        if (Number.isFinite(leftShare)) {
            percentagesByKey[`managed:${idRight}`] = leftShare;
            percentagesByKey[idRight] = leftShare;
            percentagesByKey[String(idRight)] = leftShare;
        }
        store[key] = {
            ...prev,
            groupsById: { ...groupsById },
            syntaxMode: managedMode,
            percentagesByKey
        };
    });
    syncEmphasisNormalizationPreviewMetadata();
    // dispatchPromptTextareaInputEvent: public/scripts/comp/textareaUtils.js
    dispatchPromptTextareaInputEvent(textarea, { skipAutofill: true });
    textarea.setSelectionRange(newCaret, newCaret);
    // refreshEmphasisGroupsToolInstancesFromForgeState: public/scripts/comp/emphasisGroupsToolManager.js
    refreshEmphasisGroupsToolInstancesFromForgeState();
    return true;
}

/**
 * Split a managed group at ", " into same-weight managed siblings.
 * @returns {{ text: string, groupsById: object }|null}
 */
function splitManagedEmphasisGroupAtCommas(value, target, groupsById, mode) {
    if (!target?.managed || target.managedId == null) return null;
    if (!canSplitEmphasisGroupAtCommas(target)) return null;
    const parts = String(target.innerText || '').split(', ').map((s) => s.trim()).filter(Boolean);
    if (parts.length < 2) return null;

    const bag = pruneEmphasisGroupsByIdToLiveText(groupsById, value);
    const weight = Number.isFinite(target.weight)
        ? target.weight
        : (Number.isFinite(resolveWeightForEmphasisGroupId(target.managedId, { groupsById: bag }))
            ? resolveWeightForEmphasisGroupId(target.managedId, { groupsById: bag })
            : 1);
    const managedMode = mode === 'visible' ? 'visible' : 'hidden';
    delete bag[target.managedId];
    delete bag[String(target.managedId)];

    const chunks = [];
    for (let pi = 0; pi < parts.length; pi++) {
        const id = allocateNextManagedEmphasisGroupId(bag);
        if (id < 0) return null;
        bag[id] = weight;
        chunks.push(buildManagedEmphasisGroupText(id, parts[pi], { mode: managedMode, weight }));
    }
    const replacement = chunks.join(', ');
    const text = String(value || '').substring(0, target.start) + replacement + String(value || '').substring(target.end);
    return { text, groupsById: bag };
}

/**
 * Apply managed comma-split to a textarea (forge bag + undo + input). Does not refresh Weight Rack.
 * canSplitEmphasisGroupAtCommas: public/scripts/comp/emphasisParse.js
 * @returns {boolean}
 */
function applyManagedEmphasisGroupSplitAtCommas(textarea, target) {
    if (!textarea || !target?.managed || target.managedId == null) return false;
    if (!canSplitEmphasisGroupAtCommas(target)) return false;
    const value = textarea.value || '';
    const bag = resolveEmphasisBagForTextarea(textarea) || {};
    const mode = getEmphasisSyntaxModeForTextarea(textarea);
    const split = splitManagedEmphasisGroupAtCommas(value, target, bag.groupsById || {}, mode);
    if (!split) return false;

    // setTextareaValuePreservingUndo: public/scripts/comp/textareaUtils.js
    setTextareaValuePreservingUndo(textarea, split.text);
    const store = getEmphasisNormalizationFieldStore();
    getEmphasisNormalizationDualWriteKeys(textarea.id).forEach((key) => {
        store[key] = {
            ...(store[key] || bag),
            groupsById: { ...split.groupsById },
            syntaxMode: mode === 'visible' ? 'visible' : 'hidden'
        };
    });
    syncEmphasisNormalizationPreviewMetadata();
    // dispatchPromptTextareaInputEvent: public/scripts/comp/textareaUtils.js
    dispatchPromptTextareaInputEvent(textarea, { skipAutofill: true });
    return true;
}

/**
 * Merge two adjacent managed groups; keep left id, average weight.
 * @returns {{ text: string, groupsById: object }|null}
 */
function mergeManagedEmphasisAdjacentGroups(value, left, right, groupsById, mode) {
    if (!left?.managed || !right?.managed) return null;
    if (left.managedId == null || right.managedId == null) return null;
    const combined = buildMergedEmphasisGroupInner(value, left, right);
    if (combined == null) return null;

    const bag = { ...(groupsById || {}) };
    const wLeft = Number.isFinite(left.weight) ? left.weight : resolveWeightForEmphasisGroupId(left.managedId, { groupsById: bag });
    const wRight = Number.isFinite(right.weight) ? right.weight : resolveWeightForEmphasisGroupId(right.managedId, { groupsById: bag });
    const avg = (Number.isFinite(wLeft) && Number.isFinite(wRight))
        ? (wLeft + wRight) / 2
        : (Number.isFinite(wLeft) ? wLeft : (Number.isFinite(wRight) ? wRight : 1));
    const keepId = left.managedId;
    delete bag[right.managedId];
    delete bag[String(right.managedId)];
    bag[keepId] = avg;
    const managedMode = mode === 'visible' ? 'visible' : 'hidden';
    const replacement = buildManagedEmphasisGroupText(keepId, combined, { mode: managedMode, weight: avg });
    const text = String(value || '').substring(0, left.start) + replacement + String(value || '').substring(right.end);
    return { text, groupsById: bag };
}

/** textarea.id → semantic sanitize keys (dual-write). */
function getEmphasisNormalizationDualWriteKeys(textareaId) {
    if (!textareaId) return [];
    if (textareaId === 'manualPrompt') return ['manualPrompt', 'prompt'];
    if (textareaId === 'manualUc') return ['manualUc', 'uc'];
    if (textareaId === 'manualPromptNegative') return ['manualPromptNegative', 'prompt_negative'];
    // Character fields: textarea ids vs request/forge semantic keys (manualModalManager dual-write).
    const charPrompt = /^character_(\d+)_prompt$/.exec(textareaId);
    if (charPrompt) return [textareaId, `character_${charPrompt[1]}`];
    const charUc = /^character_(\d+)_uc$/.exec(textareaId);
    if (charUc) return [textareaId, `character_${charUc[1]}_uc`];
    const charPn = /^character_(\d+)_promptNegative$/.exec(textareaId);
    if (charPn) return [textareaId, `character_${charPn[1]}_prompt_negative`];
    return [textareaId];
}

/**
 * Convert classic N:: groups in one string → invisible managed ids.
 * Returns { text, groupsById, groups: [{ id, weight, snippet }] }.
 * listAllEmphasisTargets: public/scripts/comp/emphasisParse.js
 */
function convertClassicEmphasisTextToManaged(text) {
    const value = String(text || '');
    const targets = listAllEmphasisTargets(value)
        .filter((t) => t.type === 'group')
        .sort((a, b) => a.start - b.start);

    const groupsById = {};
    const groups = [];
    targets.forEach((t, i) => {
        const weight = Number.isFinite(t.weight) ? t.weight : 1;
        groupsById[i] = weight;
        groups.push({
            id: i,
            weight,
            snippet: String(t.innerText || '').slice(0, 48)
        });
    });

    let out = value;
    for (let i = targets.length - 1; i >= 0; i--) {
        const t = targets[i];
        const managed = buildManagedEmphasisGroupText(i, t.innerText);
        out = out.slice(0, t.start) + managed + out.slice(t.end);
    }

    return { text: out, groupsById, groups };
}

function collectManualEditorEmphasisTextareas() {
    const out = [];
    const mainIds = ['manualPrompt', 'manualUc', 'manualPromptNegative'];
    mainIds.forEach((id) => {
        const el = document.getElementById(id);
        if (el) out.push(el);
    });
    document.querySelectorAll(
        '#characterPromptsContainer textarea.character-prompt-textarea.prompt-textarea'
    ).forEach((el) => {
        if (el && el.id) out.push(el);
    });
    return out;
}

/**
 * Developer console: convert all manual-editor classic emphasis groups to invisible
 * managed ids, write forge emphasis_normalization bags (textarea.id + semantic aliases).
 * Then Generate to verify server expand.
 *
 * getEmphasisNormalizationFieldStore / syncEmphasisNormalizationPreviewMetadata:
 *   public/scripts/comp/emphasisGroupsToolManager.js
 */
function debugConvertManualPromptsToManagedEmphasis() {
    const store = getEmphasisNormalizationFieldStore();
    const summary = {};
    let totalGroups = 0;

    collectManualEditorEmphasisTextareas().forEach((textarea) => {
        const fieldKey = textarea.id;
        if (!fieldKey) return;
        const converted = convertClassicEmphasisTextToManaged(textarea.value || '');
        if (!converted.groups.length) {
            summary[fieldKey] = { groups: [], note: 'no classic N:: groups' };
            return;
        }

        textarea.value = converted.text;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));

        const bag = {
            groupsById: { ...converted.groupsById },
            syntaxMode: 'hidden'
        };
        const existing = store[fieldKey];
        if (existing && typeof existing === 'object') {
            if (existing.enabled) bag.enabled = true;
            if (existing.minWeight != null) bag.minWeight = existing.minWeight;
            if (existing.maxWeight != null) bag.maxWeight = existing.maxWeight;
            if (existing.percentages) bag.percentages = existing.percentages;
            if (existing.percentagesByKey) bag.percentagesByKey = existing.percentagesByKey;
            if (existing.cards) bag.cards = existing.cards;
            if (existing.delta != null) bag.delta = existing.delta;
            if (existing.distribution != null) bag.distribution = existing.distribution;
        }

        getEmphasisNormalizationDualWriteKeys(fieldKey).forEach((key) => {
            store[key] = { ...bag, groupsById: { ...converted.groupsById } };
        });

        totalGroups += converted.groups.length;
        summary[fieldKey] = {
            groups: converted.groups,
            dualWriteKeys: getEmphasisNormalizationDualWriteKeys(fieldKey)
        };
    });

    syncEmphasisNormalizationPreviewMetadata();
    // refreshEmphasisGroupsToolInstancesFromForgeState: public/scripts/comp/emphasisGroupsToolManager.js
    refreshEmphasisGroupsToolInstancesFromForgeState();

    console.log(
        `[managed-emphasis] converted ${totalGroups} group(s). Generate to verify server expand.`,
        summary
    );
    console.log(
        'Tip: debugExpandManagedEmphasisLocally(textarea.value, getEmphasisNormalizationFieldStore().manualPrompt) for a local preview.'
    );
    return summary;
}

/**
 * Local mirror of server prepareEmphasisTextForNovelAI for eyeballing without generating.
 */
function debugExpandManagedEmphasisLocally(text, bagOrNorm, fieldHint) {
    const norm = bagOrNorm && (bagOrNorm.groupsById || bagOrNorm.weightsById)
        ? bagOrNorm
        : (bagOrNorm || getEmphasisNormalizationFieldStore());
    const hint = fieldHint != null
        ? fieldHint
        : (norm && norm.groupsById ? null : 'prompt');
    const result = prepareEmphasisTextForNovelAI(text, norm, hint);
    console.log('[managed-emphasis] local expand:', result);
    return result;
}

/**
 * Console verifier for managed-emphasis corrections (token strip, orphans, Shift+Arrow,
 * Show Syntax globals, Token Analysis wiring, weight-group carets). Returns a report;
 * always JSON.stringifies to clipboard for review (Chrome collapses objects).
 *
 * Usage: copy(JSON.stringify(debugVerifyManagedEmphasisCorrections(), null, 2))
 *    or: debugVerifyManagedEmphasisCorrections()
 */
function debugVerifyManagedEmphasisCorrections() {
    const ZW = {
        WJ: '\u2060', OPEN: '\u2063', CLOSE: '\u2064', BIT0: '\u200B', BIT1: '\u200C'
    };
    const countZW = (s) => {
        const o = { WJ: 0, OPEN: 0, CLOSE: 0, BIT0: 0, BIT1: 0, total: 0 };
        if (!s) return o;
        for (let i = 0; i < s.length; i++) {
            const c = s[i];
            if (c === ZW.WJ) o.WJ++;
            else if (c === ZW.OPEN) o.OPEN++;
            else if (c === ZW.CLOSE) o.CLOSE++;
            else if (c === ZW.BIT0) o.BIT0++;
            else if (c === ZW.BIT1) o.BIT1++;
        }
        o.total = o.WJ + o.OPEN + o.CLOSE + o.BIT0 + o.BIT1;
        return o;
    };
    const countUnk = (text) => {
        if (!t5Tokenizer || typeof t5Tokenizer.analyzeTexts !== 'function') return null;
        const toks = t5Tokenizer.analyzeTexts([text], true)?.results?.[0]?.detailedTokens || [];
        return {
            tokens: toks.length,
            unk: toks.filter((t) => t.tokenId === 2 || t.text === '<unk>').length,
            eos: toks.filter((t) => t.tokenId === 1 || t.text === '</s>').length
        };
    };
    const srcIncludes = (fn, needle) => {
        if (typeof fn !== 'function') return false;
        try { return Function.prototype.toString.call(fn).includes(needle); }
        catch (_e) { return false; }
    };
    const pass = (id, ok, detail) => ({ id, ok: !!ok, detail: detail == null ? null : detail });

    const checks = [];
    const fn = {
        strip: typeof stripManagedEmphasisDelimitersForCounting === 'function',
        assert: typeof assertNoManagedEmphasisGroupIds === 'function',
        build: typeof buildManagedEmphasisGroupText === 'function',
        closeTok: typeof buildManagedEmphasisCloseToken === 'function',
        getGlobal: typeof getGlobalEmphasisSyntaxMode === 'function',
        setGlobal: typeof setGlobalEmphasisSyntaxMode === 'function',
        getMode: typeof getEmphasisSyntaxModeForTextarea === 'function',
        caretKd: typeof handleManagedEmphasisCaretKeydown === 'function',
        openModal: typeof openTokenDisplayModal === 'function',
        stripBar: !!(typeof promptTextareaToolbar !== 'undefined' && promptTextareaToolbar
            && typeof promptTextareaToolbar.stripTextForTokenCount === 'function'),
        highlight: typeof highlightEmphasisInText === 'function',
        listBlocks: typeof listManagedEmphasisBlocks === 'function',
        normalize: typeof normalizeManagedEmphasisEditorText === 'function',
        trimManaged: typeof trimManagedEmphasisInnerEdges === 'function',
        stripUnmanaged: typeof stripUnmanagedEmphasisInvisibles === 'function',
        removeEmptyManaged: typeof removeEmptyManagedEmphasisBlocks === 'function',
        removeEmptyClassic: typeof removeEmptyClassicEmphasisGroups === 'function'
    };
    checks.push(pass('api.stripManaged', fn.strip));
    checks.push(pass('api.assertNoManaged', fn.assert));
    checks.push(pass('api.buildManagedGroup', fn.build));
    checks.push(pass('api.buildCloseToken', fn.closeTok, 'trim-end / close restore'));
    checks.push(pass('api.getGlobalSyntax', fn.getGlobal));
    checks.push(pass('api.setGlobalSyntax', fn.setGlobal));
    checks.push(pass('api.stripTextForTokenCount', fn.stripBar));
    checks.push(pass('api.openTokenDisplayModal', fn.openModal));
    checks.push(pass('api.highlightEmphasisInText', fn.highlight));
    checks.push(pass('api.normalizeManagedEditor', fn.normalize));
    checks.push(pass('api.trimManagedInnerEdges', fn.trimManaged));
    checks.push(pass('api.stripUnmanagedInvisibles', fn.stripUnmanaged));
    checks.push(pass('api.removeEmptyManagedBlocks', fn.removeEmptyManaged));
    checks.push(pass('api.removeEmptyClassicGroups', fn.removeEmptyClassic));

    checks.push(pass(
        'src.stripUsesAssertLeftovers',
        fn.strip && srcIncludes(stripManagedEmphasisDelimitersForCounting, 'assertNoManagedEmphasisGroupIds'),
        'orphan delim strip after unwrap'
    ));
    checks.push(pass(
        'src.normalizeOrder',
        fn.normalize && srcIncludes(normalizeManagedEmphasisEditorText, 'removeUnpairedManagedEmphasisCloses')
            && srcIncludes(normalizeManagedEmphasisEditorText, 'stripUnmanagedEmphasisInvisibles')
            && srcIncludes(normalizeManagedEmphasisEditorText, 'trimManagedEmphasisInnerEdges')
            && srcIncludes(normalizeManagedEmphasisEditorText, 'removeEmptyManagedEmphasisBlocks'),
        'unpaired → strip dead ZW → trim edges → drop empty groups'
    ));
    checks.push(pass(
        'src.caretShiftPassthrough',
        fn.caretKd && srcIncludes(handleManagedEmphasisCaretKeydown, 'shiftKey'),
        'Shift+Arrow must not jump/collapse'
    ));
    checks.push(pass(
        'src.modalUsesStripPipeline',
        fn.openModal && (
            srcIncludes(openTokenDisplayModal, 'stripTextForTokenCount')
            || srcIncludes(openTokenDisplayModal, 'stripManagedEmphasisDelimitersForCounting')
        ),
        'Token Analysis must strip managed ZW'
    ));
    checks.push(pass(
        'src.keyupShiftHomeEndGuard',
        fn.caretKd && typeof wireManagedEmphasisCaretGuards === 'function'
            && srcIncludes(wireManagedEmphasisCaretGuards, 'shiftKey'),
        'Shift+Home/End must not snap'
    ));

    let samples = null;
    if (fn.build && fn.strip) {
        const hidden = buildManagedEmphasisGroupText(0, 'censored', { mode: 'hidden', weight: 1 });
        const visible = buildManagedEmphasisGroupText(3, 'horns', { mode: 'visible', weight: 1.466 });
        const orphanClose = buildManagedEmphasisCloseToken
            ? buildManagedEmphasisCloseToken(9, 'hidden')
            : (EMPHASIS_CLOSE_MAGIC + encodeEmphasisGroupIdBits(9));
        const mangled = `${buildManagedEmphasisGroupText(1, 'openOnly', { mode: 'visible', weight: 2.2, omitClose: true })}, ${orphanClose}`;
        const strippedHidden = stripManagedEmphasisDelimitersForCounting(hidden);
        const strippedVisible = stripManagedEmphasisDelimitersForCounting(visible);
        const strippedMangled = stripManagedEmphasisDelimitersForCounting(mangled);
        samples = {
            hidden: {
                rawZw: countZW(hidden),
                stripped: strippedHidden,
                strippedZw: countZW(strippedHidden),
                tok: countUnk(strippedHidden)
            },
            visible: {
                rawZw: countZW(visible),
                stripped: strippedVisible,
                strippedZw: countZW(strippedVisible),
                tok: countUnk(strippedVisible)
            },
            mangledOrphan: {
                rawZw: countZW(mangled),
                stripped: strippedMangled,
                strippedZw: countZW(strippedMangled),
                tok: countUnk(strippedMangled)
            }
        };
        checks.push(pass('fx.hiddenStripClean', strippedHidden === 'censored' && countZW(strippedHidden).total === 0, strippedHidden));
        checks.push(pass('fx.visibleStripInner', strippedVisible === 'horns' && countZW(strippedVisible).total === 0, strippedVisible));
        checks.push(pass(
            'fx.orphanStripClean',
            countZW(strippedMangled).total === 0 && !hasManagedEmphasisGroupIds(strippedMangled),
            { stripped: strippedMangled, zw: countZW(strippedMangled) }
        ));
        if (samples.hidden.tok) {
            checks.push(pass('fx.hiddenUnkZero', samples.hidden.tok.unk === 0, samples.hidden.tok));
        }
        if (samples.visible.tok) {
            checks.push(pass('fx.visibleUnkZero', samples.visible.tok.unk === 0, samples.visible.tok));
        }
        if (samples.mangledOrphan.tok) {
            checks.push(pass('fx.orphanUnkZero', samples.mangledOrphan.tok.unk === 0, samples.mangledOrphan.tok));
        }
        if (fn.stripBar) {
            const bar = promptTextareaToolbar.stripTextForTokenCount(mangled);
            checks.push(pass(
                'fx.barStripMatches',
                countZW(bar).total === 0 && bar.replace(/\s+/g, ' ').includes('openOnly'),
                bar
            ));
        }
    }

    if (fn.normalize && fn.build) {
        const orphanClose = buildManagedEmphasisCloseToken
            ? buildManagedEmphasisCloseToken(9, 'hidden')
            : (EMPHASIS_CLOSE_MAGIC + encodeEmphasisGroupIdBits(9));
        // Orphan close after ", " must not leave trailing comma/space debris
        const orphanDebris = `${buildManagedEmphasisGroupText(1, 'openOnly', { mode: 'hidden', omitClose: true })}, ${orphanClose}`;
        const orphanNorm = normalizeManagedEmphasisEditorText(orphanDebris);
        checks.push(pass(
            'fx.normalizeOrphanNoTrailingComma',
            orphanNorm.changed
                && orphanNorm.orphanClosesRemoved === 1
                && !orphanNorm.text.includes(',')
                && countZW(orphanNorm.text).CLOSE === 0
                && orphanNorm.text.includes('openOnly'),
            { in: orphanDebris, out: orphanNorm.text, orphanClosesRemoved: orphanNorm.orphanClosesRemoved }
        ));

        // Stray BIT0/BIT1 mid-text (dead ZW, not part of a valid delimiter)
        const deadBits = `hello${ZW.BIT0}${ZW.BIT1}world`;
        const deadNorm = normalizeManagedEmphasisEditorText(deadBits);
        checks.push(pass(
            'fx.normalizeDeadBitsStripped',
            deadNorm.changed && deadNorm.text === 'helloworld' && countZW(deadNorm.text).total === 0,
            { inZw: countZW(deadBits), out: deadNorm.text }
        ));

        // Paired group with trailing inner comma/space → comma moves outside (not dropped)
        const edgeComma = buildManagedEmphasisGroupText(4, 'double chin,', { mode: 'hidden' });
        const edgeNorm = normalizeManagedEmphasisEditorText(edgeComma);
        const edgeInner = fn.listBlocks
            ? (listManagedEmphasisBlocks(edgeNorm.text)[0]?.innerText || '')
            : '';
        const edgeAfter = fn.listBlocks
            ? edgeNorm.text.slice((listManagedEmphasisBlocks(edgeNorm.text)[0]?.end) || 0)
            : '';
        checks.push(pass(
            'fx.normalizeEdgeCommaMovedOutside',
            edgeNorm.changed && edgeInner === 'double chin' && /^,\s/.test(edgeAfter),
            { out: edgeNorm.text, inner: edgeInner, after: edgeAfter }
        ));

        // Trailing inner comma kept stripped (not duplicated) when outside already has ", "
        const edgeDup = `${buildManagedEmphasisGroupText(5, 'horns,', { mode: 'hidden' })}, next`;
        const edgeDupNorm = normalizeManagedEmphasisEditorText(edgeDup);
        const edgeDupBlocks = fn.listBlocks ? listManagedEmphasisBlocks(edgeDupNorm.text) : [];
        const edgeDupInner = edgeDupBlocks[0]?.innerText || '';
        const edgeDupAfter = edgeDupBlocks[0]
            ? edgeDupNorm.text.slice(edgeDupBlocks[0].end)
            : '';
        checks.push(pass(
            'fx.normalizeEdgeCommaNoDuplicate',
            edgeDupNorm.changed
                && edgeDupInner === 'horns'
                && /^,\s*next/.test(edgeDupAfter)
                && !/^,\s*,/.test(edgeDupAfter),
            { out: edgeDupNorm.text, inner: edgeDupInner, after: edgeDupAfter }
        ));

        // Trailing inner space → move outside when no adjacent outside space (abutting next group)
        const edgeSpaceA = buildManagedEmphasisGroupText(6, 'alpha ', { mode: 'hidden' });
        const edgeSpaceB = buildManagedEmphasisGroupText(7, 'beta', { mode: 'hidden' });
        const edgeSpaceNorm = normalizeManagedEmphasisEditorText(edgeSpaceA + edgeSpaceB);
        const edgeSpaceBlocks = fn.listBlocks ? listManagedEmphasisBlocks(edgeSpaceNorm.text) : [];
        const edgeSpaceInner = edgeSpaceBlocks[0]?.innerText || '';
        const edgeSpaceMid = edgeSpaceBlocks[0] && edgeSpaceBlocks[1]
            ? edgeSpaceNorm.text.slice(edgeSpaceBlocks[0].end, edgeSpaceBlocks[1].start)
            : '';
        checks.push(pass(
            'fx.normalizeEdgeSpaceMovedOutside',
            edgeSpaceNorm.changed && edgeSpaceInner === 'alpha' && edgeSpaceMid === ' ',
            { inner: edgeSpaceInner, mid: edgeSpaceMid }
        ));

        // Trailing inner space stripped (not duplicated) when outside already has a space
        const edgeSpaceDup = `${buildManagedEmphasisGroupText(8, 'gamma ', { mode: 'hidden' })} next`;
        const edgeSpaceDupNorm = normalizeManagedEmphasisEditorText(edgeSpaceDup);
        const edgeSpaceDupBlocks = fn.listBlocks ? listManagedEmphasisBlocks(edgeSpaceDupNorm.text) : [];
        const edgeSpaceDupInner = edgeSpaceDupBlocks[0]?.innerText || '';
        const edgeSpaceDupAfter = edgeSpaceDupBlocks[0]
            ? edgeSpaceDupNorm.text.slice(edgeSpaceDupBlocks[0].end)
            : '';
        checks.push(pass(
            'fx.normalizeEdgeSpaceNoDuplicate',
            edgeSpaceDupNorm.changed
                && edgeSpaceDupInner === 'gamma'
                && /^ next/.test(edgeSpaceDupAfter)
                && !/^  /.test(edgeSpaceDupAfter),
            { inner: edgeSpaceDupInner, after: edgeSpaceDupAfter }
        ));

        // Digit-ending body keeps one inner space; that protective space is not moved outside
        const edgeDigit = buildManagedEmphasisGroupText(10, '2025', { mode: 'hidden' });
        const edgeDigitNorm = normalizeManagedEmphasisEditorText(edgeDigit);
        const edgeDigitInner = fn.listBlocks
            ? (listManagedEmphasisBlocks(edgeDigitNorm.text)[0]?.innerText || '')
            : '';
        const edgeDigitAfter = fn.listBlocks
            ? edgeDigitNorm.text.slice((listManagedEmphasisBlocks(edgeDigitNorm.text)[0]?.end) || 0)
            : '';
        checks.push(pass(
            'fx.normalizeDigitKeepsInnerSpace',
            edgeDigitInner === '2025 ' && !/^[ \t]/.test(edgeDigitAfter),
            { inner: edgeDigitInner, after: edgeDigitAfter }
        ));

        const emptyHidden = `alpha, ${buildManagedEmphasisGroupText(11, '', { mode: 'hidden' })}, beta`;
        const emptyHiddenNorm = normalizeManagedEmphasisEditorText(emptyHidden);
        checks.push(pass(
            'fx.normalizeEmptyHiddenRemoved',
            emptyHiddenNorm.changed
                && emptyHiddenNorm.emptyBlocksRemoved === 1
                && emptyHiddenNorm.text === 'alpha, beta'
                && countZW(emptyHiddenNorm.text).total === 0,
            { in: emptyHidden, out: emptyHiddenNorm.text, emptyBlocksRemoved: emptyHiddenNorm.emptyBlocksRemoved }
        ));

        const emptyVisible = `gamma ${buildManagedEmphasisGroupText(12, '  ', { mode: 'visible', weight: 1.35 })} delta`;
        const emptyVisibleNorm = normalizeManagedEmphasisEditorText(emptyVisible);
        checks.push(pass(
            'fx.normalizeEmptyVisibleRemoved',
            emptyVisibleNorm.changed
                && emptyVisibleNorm.emptyBlocksRemoved === 1
                && emptyVisibleNorm.text === 'gamma delta'
                && countZW(emptyVisibleNorm.text).total === 0
                && !emptyVisibleNorm.text.includes('1.35'),
            { out: emptyVisibleNorm.text, emptyBlocksRemoved: emptyVisibleNorm.emptyBlocksRemoved }
        ));

        const emptyKeep = `keep ${buildManagedEmphasisGroupText(13, 'horns', { mode: 'hidden' })} end`;
        const emptyKeepNorm = normalizeManagedEmphasisEditorText(emptyKeep);
        const emptyKeepBlocks = fn.listBlocks ? listManagedEmphasisBlocks(emptyKeepNorm.text) : [];
        checks.push(pass(
            'fx.normalizeNonEmptyKept',
            emptyKeepBlocks.length === 1
                && emptyKeepBlocks[0]?.innerText === 'horns'
                && (emptyKeepNorm.emptyBlocksRemoved || 0) === 0,
            { out: emptyKeepNorm.text, inner: emptyKeepBlocks[0]?.innerText }
        ));

        const classicEmpty = removeEmptyClassicEmphasisGroups('hello, 1.2::::, world');
        checks.push(pass(
            'fx.classicEmptyClosedRemoved',
            classicEmpty === 'hello, world',
            classicEmpty
        ));

        const emptyAuto = `${buildManagedEmphasisGroupText(14, '', { mode: 'hidden', omitClose: true })}${buildManagedEmphasisGroupText(15, 'kept', { mode: 'hidden' })}`;
        const emptyAutoNorm = normalizeManagedEmphasisEditorText(emptyAuto);
        const emptyAutoBlocks = fn.listBlocks ? listManagedEmphasisBlocks(emptyAutoNorm.text) : [];
        checks.push(pass(
            'fx.normalizeEmptyAutoTermRemoved',
            emptyAutoNorm.emptyBlocksRemoved === 1
                && emptyAutoBlocks.length === 1
                && emptyAutoBlocks[0]?.innerText === 'kept'
                && countZW(emptyAutoNorm.text).OPEN === 1,
            { out: emptyAutoNorm.text, ids: emptyAutoBlocks.map((b) => b.id), emptyBlocksRemoved: emptyAutoNorm.emptyBlocksRemoved }
        ));

        const emptyAutoComma = `tag ${buildManagedEmphasisGroupText(16, ', ', { mode: 'hidden', omitClose: true })}${buildManagedEmphasisGroupText(17, 'kept', { mode: 'hidden' })}`;
        const emptyAutoCommaNorm = normalizeManagedEmphasisEditorText(emptyAutoComma);
        const emptyAutoCommaBlocks = fn.listBlocks ? listManagedEmphasisBlocks(emptyAutoCommaNorm.text) : [];
        const emptyAutoCommaBefore = emptyAutoCommaBlocks[0]
            ? emptyAutoCommaNorm.text.slice(0, emptyAutoCommaBlocks[0].start)
            : '';
        checks.push(pass(
            'fx.normalizeEmptyAutoTermKeepsComma',
            emptyAutoCommaNorm.emptyBlocksRemoved === 1
                && emptyAutoCommaBlocks.length === 1
                && emptyAutoCommaBlocks[0]?.innerText === 'kept'
                && /tag,\s*$/.test(emptyAutoCommaBefore),
            { out: emptyAutoCommaNorm.text, before: emptyAutoCommaBefore }
        ));

        const classicSpace = trimClassicEmphasisInnerEdges('1.2::alpha ::1.3::beta::');
        checks.push(pass(
            'fx.classicEdgeSpaceMovedOutside',
            classicSpace === '1.2::alpha:: 1.3::beta::',
            classicSpace
        ));
    }

    if (fn.getGlobal) {
        const g = getGlobalEmphasisSyntaxMode();
        checks.push(pass('fx.globalSyntaxValue', g === 'hidden' || g === 'visible', g));
    }

    if (fn.highlight && fn.build) {
        const vis = buildManagedEmphasisGroupText(2, 'sample tags', { mode: 'visible', weight: 1.5 });
        const html = highlightEmphasisInText(vis, { groupsById: { 2: 1.5 } });
        checks.push(pass(
            'fx.highlightWeightCaretClass',
            typeof html === 'string' && html.includes('emphasis-weight-group'),
            html.slice(0, 160)
        ));
    }

    const liveFields = [];
    document.querySelectorAll('textarea.prompt-textarea, textarea.character-prompt-textarea').forEach((ta) => {
        if (!ta.id || !fn.strip) return;
        const raw = ta.value || '';
        if (!raw || (typeof hasManagedEmphasisGroupIds === 'function' && !hasManagedEmphasisGroupIds(raw))) return;
        const stripped = fn.stripBar
            ? promptTextareaToolbar.stripTextForTokenCount(raw)
            : stripManagedEmphasisDelimitersForCounting(raw);
        const rawTok = countUnk(raw);
        const stripTok = countUnk(stripped);
        const row = {
            id: ta.id,
            rawZw: countZW(raw),
            strippedZw: countZW(stripped),
            blocks: fn.listBlocks ? listManagedEmphasisBlocks(raw).length : null,
            syntaxMode: fn.getMode ? getEmphasisSyntaxModeForTextarea(ta) : null,
            unkRaw: rawTok ? rawTok.unk : null,
            unkStripped: stripTok ? stripTok.unk : null,
            caretWired: ta.dataset.managedCaretWired === '1'
        };
        liveFields.push(row);
        checks.push(pass(
            `live.${ta.id}.strippedZwZero`,
            row.strippedZw.total === 0,
            row.strippedZw
        ));
        if (row.unkStripped != null) {
            checks.push(pass(
                `live.${ta.id}.unkStrippedZero`,
                row.unkStripped === 0,
                { unkRaw: row.unkRaw, unkStripped: row.unkStripped }
            ));
        }
    });

    const uc = document.getElementById('manualUc');
    const pn = document.getElementById('manualPromptNegative');
    checks.push(pass('wire.manualUcCaret', !!(uc && uc.dataset.managedCaretWired === '1')));
    checks.push(pass('wire.manualPromptNegativeCaret', !!(pn && pn.dataset.managedCaretWired === '1')));
    const mp = document.getElementById('manualPrompt');
    checks.push(pass('wire.manualPromptCaret', !!(mp && mp.dataset.managedCaretWired === '1')));

    const failed = checks.filter((c) => !c.ok).map((c) => c.id);
    const report = {
        ok: failed.length === 0,
        passed: checks.filter((c) => c.ok).length,
        failed,
        checks,
        samples,
        liveFields,
        globalSyntax: fn.getGlobal ? getGlobalEmphasisSyntaxMode() : null,
        note: failed.length
            ? 'Failures usually mean soft-reload not applied yet, or remaining mangled live fields.'
            : 'All correction checks passed.'
    };
    const json = JSON.stringify(report, null, 2);
    console.log('[managed-emphasis-verify]', json);
    try {
        copy(json);
        console.log('Copied JSON — paste it here');
    } catch (_e) {
        console.log(json);
    }
    return report;
}

function convertMetadataEmphasisToManaged(metadata) {
    if (!metadata || typeof metadata !== 'object') return metadata;
    const mode = getGlobalEmphasisSyntaxMode() === 'visible' ? 'visible' : 'hidden';
    const bags = {};

    const convertField = (text, keys) => {
        const value = text == null ? '' : String(text);
        if (!value.includes('::')) return text;
        const imported = importClassicEmphasisIntoManagedText(value, {}, mode);
        if (!imported.imported) return text;
        keys.forEach((key) => {
            bags[key] = {
                syntaxMode: mode,
                groupsById: { ...imported.groupsById }
            };
        });
        return imported.text;
    };

    metadata.prompt = convertField(metadata.prompt, ['manualPrompt', 'prompt']);
    metadata.uc = convertField(metadata.uc, ['manualUc', 'uc']);
    if (metadata.input_prompt_negative != null || metadata.prompt_negative != null) {
        const pn = metadata.input_prompt_negative ?? metadata.prompt_negative ?? '';
        const next = convertField(pn, ['manualPromptNegative', 'prompt_negative']);
        metadata.input_prompt_negative = next;
        metadata.prompt_negative = next;
    }

    const convertCharacterList = (list) => {
        if (!Array.isArray(list)) return;
        list.forEach((ch, index) => {
            if (!ch || typeof ch !== 'object') return;
            ch.prompt = convertField(ch.prompt, [`character_${index}`, `character_${index}_prompt`]);
            ch.uc = convertField(ch.uc, [`character_${index}_uc`]);
            if (ch.input_prompt_negative != null || ch.prompt_negative != null) {
                const pn = ch.input_prompt_negative ?? ch.prompt_negative ?? '';
                const next = convertField(pn, [`character_${index}_prompt_negative`]);
                ch.input_prompt_negative = next;
                ch.prompt_negative = next;
            }
        });
    };
    convertCharacterList(metadata.allCharacterPrompts);
    convertCharacterList(metadata.characterPrompts);

    if (Object.keys(bags).length) {
        metadata.forge_data = {
            ...(metadata.forge_data && typeof metadata.forge_data === 'object' ? metadata.forge_data : {}),
            emphasis_normalization: {
                ...(metadata.forge_data?.emphasis_normalization || {}),
                ...bags
            }
        };
    }
    return metadata;
}
