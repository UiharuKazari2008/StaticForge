/**
 * Managed emphasis group ID delimiters (Weight Rack compiled form).
 * Design: docs/design/emphasis-group-id-syntax.md
 *
 * In-prompt form (invisible):  <WJ><OPEN|CLOSE><id_bits> … <WJ><CLOSE><id_bits>
 * Legacy (still accepted):     :<WJ><OPEN|CLOSE><id_bits>:
 * Bits: ZWSP=0, ZWNJ=1. Id width EMPHASIS_GROUP_ID_BITS (256 slots).
 *
 * Keep in sync with public/scripts/comp/emphasisGroupIdCodec.js (client mirror).
 * Server expands ids → classic N::…:: using forge/request weight maps before NAI.
 */

'use strict';

const EMPHASIS_GROUP_ID_BITS = 8;
const EMPHASIS_GROUP_ID_MAX = (1 << EMPHASIS_GROUP_ID_BITS) - 1;

const ZW = {
    WJ: '\u2060',   // WORD JOINER — shared magic prefix
    OPEN: '\u2063', // INVISIBLE SEPARATOR — open barrier
    CLOSE: '\u2064', // INVISIBLE PLUS — close barrier
    BIT0: '\u200B', // ZWSP = 0
    BIT1: '\u200C'  // ZWNJ = 1
};

const OPEN_MAGIC = ZW.WJ + ZW.OPEN;
const CLOSE_MAGIC = ZW.WJ + ZW.CLOSE;

/** Format Cf chars used by managed barriers + common ZW clutter we strip unmanaged. */
const MANAGED_INVISIBLE_SET = new Set([
    ZW.WJ, ZW.OPEN, ZW.CLOSE, ZW.BIT0, ZW.BIT1,
    '\u200D', // ZWJ
    '\uFEFF', // BOM / ZWNBSP
    '\u2061', '\u2062', // invisible math (unused in magic but strip unmanaged)
    '\u00AD'  // soft hyphen
]);

function encodeEmphasisGroupIdBits(id) {
    const n = Math.max(0, Math.min(EMPHASIS_GROUP_ID_MAX, id | 0));
    let bits = '';
    for (let i = EMPHASIS_GROUP_ID_BITS - 1; i >= 0; i--) {
        bits += (n >> i) & 1 ? ZW.BIT1 : ZW.BIT0;
    }
    return bits;
}

function decodeEmphasisGroupIdBits(bits) {
    if (!bits || bits.length !== EMPHASIS_GROUP_ID_BITS) return null;
    let n = 0;
    for (let i = 0; i < bits.length; i++) {
        const ch = bits[i];
        if (ch === ZW.BIT1) n = (n << 1) | 1;
        else if (ch === ZW.BIT0) n = (n << 1);
        else return null;
    }
    return n;
}

/** Invisible open barrier (no surrounding colons). */
function buildEmphasisGroupOpenDelim(id) {
    return OPEN_MAGIC + encodeEmphasisGroupIdBits(id);
}

/** Invisible close barrier (no surrounding colons). */
function buildEmphasisGroupCloseDelim(id) {
    return CLOSE_MAGIC + encodeEmphasisGroupIdBits(id);
}

function buildManagedEmphasisGroupText(id, innerText, options = {}) {
    const mode = options.mode === 'visible' ? 'visible' : 'hidden';
    const body = String(innerText ?? '');
    const openCore = OPEN_MAGIC + encodeEmphasisGroupIdBits(id);
    const closeCore = CLOSE_MAGIC + encodeEmphasisGroupIdBits(id);
    if (mode === 'visible') {
        const w = formatClassicEmphasisWeight(options.weight ?? 1);
        const open = `:${openCore}:`;
        if (options.omitClose) return `${w}${open}${body}`;
        return `${w}${open}${body}:${closeCore}:`;
    }
    if (options.omitClose) return openCore + body;
    return openCore + body + closeCore;
}

/** True if text contains any managed open/close magic prefix. */
function hasManagedEmphasisGroupIds(text) {
    if (!text || typeof text !== 'string') return false;
    return text.includes(OPEN_MAGIC) || text.includes(CLOSE_MAGIC);
}

/**
 * Scan for managed open/close barriers (invisible + legacy colon-wrapped).
 * Returns { opens, closes } with index at delim start (colon if legacy).
 */
function listManagedEmphasisDelimiters(text) {
    const opens = [];
    const closes = [];
    if (!text || typeof text !== 'string') return { opens, closes };

    const magicLen = OPEN_MAGIC.length; // WJ+mark — same length for open/close
    const idLen = EMPHASIS_GROUP_ID_BITS;
    const invisibleDelimLen = magicLen + idLen;

    for (let i = 0; i <= text.length - invisibleDelimLen; i++) {
        if (text[i] !== ZW.WJ) continue;
        const magic = text.substring(i, i + magicLen);
        let kind = null;
        if (magic === OPEN_MAGIC) kind = 'open';
        else if (magic === CLOSE_MAGIC) kind = 'close';
        else continue;

        const bitsStart = i + magicLen;
        const bits = text.substring(bitsStart, bitsStart + idLen);
        const id = decodeEmphasisGroupIdBits(bits);
        if (id === null) continue;

        const bitsEnd = bitsStart + idLen;
        // Legacy colon wrap: :MAGIC+bits:
        const legacy = i > 0 && text[i - 1] === ':' && bitsEnd < text.length && text[bitsEnd] === ':';
        let index = legacy ? i - 1 : i;
        let end = legacy ? bitsEnd + 1 : bitsEnd;
        let textWeight = null;
        // Visible mode: N:<OPEN>:… — absorb leading weight into open span
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

/**
 * Pair open→close by matching id (nearest unused close after open).
 * Unclosed opens span to next open of any id or EOS.
 */
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
            // Auto-terminate before next open or EOS
            let nextOpenAt = text.length;
            for (const o of opens) {
                if (o.index > open.index && o.index < nextOpenAt) nextOpenAt = o.index;
            }
            contentEnd = nextOpenAt;
            end = nextOpenAt;
            needsTerminator = false;
        }

        const innerText = text.substring(contentStart, contentEnd);
        blocks.push({
            id: open.id,
            start: open.index,
            end,
            openEnd: open.end,
            closeStart: close ? close.index : end,
            innerText,
            needsTerminator,
            legacy: !!open.legacy,
            textWeight: Number.isFinite(open.textWeight) ? open.textWeight : null
        });
    }

    return blocks.sort((a, b) => a.start - b.start);
}

/**
 * Closes that were never paired to an open (dead markers / paste debris).
 * Keep in sync with public/scripts/comp/emphasisGroupIdCodec.js
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

/** Remove unpaired closes only — do not strip lone commas/spaces around them. */
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
    // Prefer compact representation (1, 1.5, 1.35) without trailing zeros
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

/**
 * Resolve weight for an id from forge/request maps.
 * Accepts:
 *   - groupsById: { [id]: number | { weight } }
 *   - flat weightsById
 *   - field-scoped normalization bags
 */
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

    // Direct map id → number
    const direct = weightSource[id] ?? weightSource[String(id)];
    if (typeof direct === 'number' && Number.isFinite(direct)) return direct;

    return null;
}

/**
 * Flatten request emphasis_normalization into a single weight source.
 * Field-keyed bags: { prompt: { groupsById }, … } or already flat.
 * Client store keys are textarea ids (manualPrompt); sanitize uses semantic hints (prompt).
 */
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
        // character_N bags: client keys are char_*_prompt / char_*_uc (counter ids), not index-
        // aligned. Exact match fails → fall through to merge. When managed ids ship, dual-write
        // semantic character_N keys at request build time (see invariants rule).
    }
    // Merge all field bags' groupsById (last write wins on id collision)
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

/**
 * Expand managed id delimiters to classic N::…:: using weightSource.
 * Missing weights → leave bare inner text (strip delimiters), push warning.
 */
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
    // Replace from end so indices stay valid
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

/**
 * Strip format/invisible chars that are not part of a valid managed delimiter.
 * Valid open/close sequences are preserved.
 */
function stripUnmanagedEmphasisInvisibles(text) {
    if (!text || typeof text !== 'string') return text;
    if (![...MANAGED_INVISIBLE_SET].some((ch) => text.includes(ch))) return text;

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
        if (MANAGED_INVISIBLE_SET.has(ch) && !isProtected(i)) continue;
        out += ch;
    }
    return out;
}

/**
 * After expand: remove any leftover managed magic (must never reach NAI).
 * Returns { text, strippedCount }.
 */
function assertNoManagedEmphasisGroupIds(text) {
    if (!text || typeof text !== 'string') {
        return { text, strippedCount: 0 };
    }
    if (!hasManagedEmphasisGroupIds(text)) {
        return { text, strippedCount: 0 };
    }

    // Nuke any remaining open/close barriers to bare nothing (keep surrounding text)
    const { opens, closes } = listManagedEmphasisDelimiters(text);
    const ranges = [...opens, ...closes].sort((a, b) => b.index - a.index);
    let out = text;
    let strippedCount = 0;
    for (const d of ranges) {
        out = out.slice(0, d.index) + out.slice(d.end);
        strippedCount++;
    }
    // Residual magic fragments
    if (out.includes(OPEN_MAGIC) || out.includes(CLOSE_MAGIC)) {
        out = out.split(OPEN_MAGIC).join('').split(CLOSE_MAGIC).join('');
        strippedCount++;
    }
    return { text: out, strippedCount };
}

/**
 * Full server prep for one string:
 * orphan-close heal → expand ids → strip unmanaged ZW → leftover assert.
 * Orphan heal must run before expand so unpaired closes are not absorbed into
 * auto-terminated (or closed) group bodies. Does not remove lone commas.
 */
function prepareEmphasisTextForNovelAI(text, emphasisNormalization, fieldHint) {
    const weightSource = coalesceEmphasisWeightSource(emphasisNormalization, fieldHint);
    let working = String(text || '');
    if (hasManagedEmphasisGroupIds(working)) {
        working = removeUnpairedManagedEmphasisCloses(working).text;
    }
    const expanded = expandEmphasisGroupIds(working, weightSource);
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

/**
 * Strip managed delimiters for token counting / equality (inner text kept).
 * Classic N:: is not stripped here — callers that need classic strip use stripEmphasisSyntax.
 */
function stripManagedEmphasisDelimitersForCounting(text) {
    if (!text || typeof text !== 'string') return text;
    if (!hasManagedEmphasisGroupIds(text)) return text;
    // Drop unpaired closes first so they are not counted inside auto-term inners.
    let out = removeUnpairedManagedEmphasisCloses(text).text;
    const blocks = listManagedEmphasisBlocks(out);
    for (let i = blocks.length - 1; i >= 0; i--) {
        const block = blocks[i];
        out = out.slice(0, block.start) + block.innerText + out.slice(block.end);
    }
    // Orphan / unmatched delims stay "protected" in stripUnmanaged — strip them for counts.
    out = stripUnmanagedEmphasisInvisibles(out);
    return assertNoManagedEmphasisGroupIds(out).text;
}

module.exports = {
    EMPHASIS_GROUP_ID_BITS,
    EMPHASIS_GROUP_ID_MAX,
    ZW,
    OPEN_MAGIC,
    CLOSE_MAGIC,
    encodeEmphasisGroupIdBits,
    decodeEmphasisGroupIdBits,
    buildEmphasisGroupOpenDelim,
    buildEmphasisGroupCloseDelim,
    buildManagedEmphasisGroupText,
    hasManagedEmphasisGroupIds,
    listManagedEmphasisDelimiters,
    listManagedEmphasisBlocks,
    listUnpairedManagedEmphasisCloses,
    removeUnpairedManagedEmphasisCloses,
    formatClassicEmphasisWeight,
    formatClassicClosedEmphasisGroup,
    resolveWeightForEmphasisGroupId,
    coalesceEmphasisWeightSource,
    expandEmphasisGroupIds,
    stripUnmanagedEmphasisInvisibles,
    assertNoManagedEmphasisGroupIds,
    prepareEmphasisTextForNovelAI,
    stripManagedEmphasisDelimitersForCounting
};
