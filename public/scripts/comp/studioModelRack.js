/**
 * studioModel part - Rack (#860 migration): the Studio calls DreamStudio's Rack part needs, added
 * with studioModel.extend. Only this file touches the desktop for them.
 *
 * The phone's fields are the plain `1.2::text::` form (studioModel.visibleText), so the desktop's
 * own emphasis code runs on that text here: the target list (weight groups and {brace} / [bracket]
 * blocks, emphasisParse.js), the Weight Rack's share / weight / distribution math
 * (emphasisWeightMath.js, emphasisParse.js, emphasisSubgroup.js), merge / split / convert, and the
 * Normalize state each field keeps in Studio's emphasis store (emphasisGroupsToolManager.js), in the
 * desktop rack's own shape, so a field normalized on the phone is the same field on the desktop and
 * Auto Apply on Generate works whichever side set it.
 */
/* global listAllEmphasisTargets, buildEmphasisTargetKey, buildEmphasisTargetKeyLegacy, listUnweightedEmphasisPortions,
   buildEmphasisTargetText, findAdjacentEmphasisMergeNeighborIndex, mergeEmphasisAdjacentGroups, canSplitEmphasisGroupAtCommas,
   splitEmphasisGroupAtCommas, listEmphasisBlocks, listBraceEmphasisTargets, formatClassicClosedEmphasisGroup,
   formatEmphasisWeightNormalize, formatClassicEmphasisWeight, formatEmphasisWeight, computeEmphasisAutoDistribution,
   readEmphasisNormalizationFieldState, writeEmphasisNormalizationFieldState, resolveEmphasisBagForTextarea, lookupEmphasisSavedKeyEntry,
   getStudioCharacterItems, sharesToWeights, weightToShare, rebalanceEmphasisShares, rebalanceEmphasisSharesByDelta,
   rebalanceEmphasisWeightsByDelta, clampEmphasisShare, clampEmphasisWeightNormalize, clampEmphasisWeight, isEligibleForEmphasisNormalize,
   resolveIdealMaxWeightFromDistribution, emphasisWeightFromRelativeImportance, snapWeightForBraceMode, stepBraceEmphasisWeight,
   getEmphasisSectionLength, EMPHASIS_IMPORTANCE_UNBIASED, EMPHASIS_AUTO_SHARE_BAND_MIN, EMPHASIS_NORMALIZE_RANGE_STEP */
(function () {
    'use strict';
    const M = window.studioModel;
    if (!M || typeof M.extend !== 'function') return;

    const has = (name) => typeof window[name] === 'function';
    const konst = (read, fallback) => { try { const v = read(); return v == null ? fallback : v; } catch (_) { return fallback; } };

    /** The desktop textarea behind a phone field id ('prompt', 'uc', 'negative', 'directive', 'c:0:prompt'). */
    function textareaOf(fid) {
        const ids = { prompt: 'manualPrompt', uc: 'manualUc', negative: 'manualPromptNegative', directive: 'creativeDirectiveInput' };
        if (ids[fid]) return M._el(ids[fid]);
        const c = /^c:(\d+):(prompt|uc)$/.exec(String(fid));
        if (!c || !has('getStudioCharacterItems')) return null;
        const item = (getStudioCharacterItems() || [])[Number(c[1])];
        return item && item.id ? M._el(`${item.id}_${c[2]}`) : null;
    }

    /** A target's text (a bracket block's without the closing brackets the desktop's pattern keeps). */
    const innerOf = (t) => (t.type === 'brace' && t.braceKind === 'bracket' ? String(t.innerText || '').replace(/\]+$/, '') : t.innerText);

    M.extend({
        /** True when the desktop's emphasis code is loaded (the rack needs it). */
        rackReady: () => ['listAllEmphasisTargets', 'applyEmphasisTargetWeights', 'sharesToWeights', 'computeEmphasisAutoDistribution', 'clampEmphasisShare'].every(has),

        /** A field's emphasis targets in prompt order: weight groups and {brace} / [bracket] blocks outside them. */
        rackTargets(text) {
            if (!has('listAllEmphasisTargets')) return [];
            // keys as the desktop makes them; the text without the extra closing brackets the desktop's
            // bracket pattern leaves in a nested block ('[[a]]' reads as 'a]': written back it would gain a ']')
            return listAllEmphasisTargets(String(text || '')).map((t) => Object.assign({}, t, { key: buildEmphasisTargetKey(t), legacy: buildEmphasisTargetKeyLegacy(t), innerText: innerOf(t) }));
        },

        /** The plain text between targets (the desktop rack's context cards). */
        rackPortions: (text) => (has('listUnweightedEmphasisPortions') ? listUnweightedEmphasisPortions(String(text || '')) : []),

        /** The text with new weights (by target start); precise = Normalize's 4 places, else 2; braces snap to their levels. */
        rackApply(text, weightByStart, precise) {
            const v = String(text || '');
            const opts = precise ? { normalizePrecision: true } : {};
            let out = '';
            let at = 0;
            listAllEmphasisTargets(v).forEach((t) => {
                out += v.slice(at, t.start);
                const w = weightByStart.has(t.start) ? weightByStart.get(t.start) : t.weight;
                out += weightByStart.has(t.start) ? buildEmphasisTargetText(Object.assign({}, t, { innerText: innerOf(t) }), w, opts) : v.slice(t.start, t.end);
                at = t.end;
            });
            return out + v.slice(at);
        },

        /** Merge with Previous Group (the desktop card's): the text, or null when it cannot merge. */
        rackMerge(text, targets, k) {
            const v = String(text || '');
            if (findAdjacentEmphasisMergeNeighborIndex(v, targets, k) !== k - 1) return null;
            return mergeEmphasisAdjacentGroups(v, targets[k - 1], targets[k]);
        },
        rackCanMerge: (text, targets, k) => has('findAdjacentEmphasisMergeNeighborIndex') && findAdjacentEmphasisMergeNeighborIndex(String(text || ''), targets, k) === k - 1,
        rackCanSplit: (target) => has('canSplitEmphasisGroupAtCommas') && canSplitEmphasisGroupAtCommas(target),
        rackSplit: (text, target) => splitEmphasisGroupAtCommas(String(text || ''), target),

        /**
         * Convert {}/[] (the desktop's, emphasisGroupIdCodec.js importBraceEmphasisIntoManagedText):
         * each brace / bracket block outside a weight group becomes a weight group at its NovelAI
         * weight (1.05^n, 1/1.05^n). Returns the spans, last first, with their replacement text.
         */
        rackBraceSpans(text) {
            const v = String(text || '');
            if (!v || !has('listBraceEmphasisTargets')) return [];
            const guard = listEmphasisBlocks(v).map((b) => ({ start: b.start, end: b.end }));
            return listBraceEmphasisTargets(v, guard)
                .filter((t) => String(t.innerText || '').length > 0)
                .sort((a, b) => b.start - a.start)
                .map((t) => ({ start: t.start, end: t.end, text: formatClassicClosedEmphasisGroup(formatEmphasisWeightNormalize(Number.isFinite(t.weight) ? t.weight : 1), innerOf(t)) }));
        },

        /**
         * Split Emphasis around the selection (the desktop's splitEmphasisAroundSelection, in the
         * plain form): inside a group, the text before, the selection and the text after each become a
         * group at its weight; outside one, the selection becomes a group at 1. Returns the span to
         * replace and its text, or null.
         */
        rackSplitAround(text, s, e) {
            const v = String(text || '');
            if (!(e > s)) return null;
            const wfmt = (w) => (has('formatClassicEmphasisWeight') ? formatClassicEmphasisWeight(w) : formatEmphasisWeight(w));
            const close = (w, inner) => formatClassicClosedEmphasisGroup(wfmt(w), inner);
            const block = listEmphasisBlocks(v).find((b) => {
                const open = b.start + b.match[0].indexOf('::') + 2;
                const closeAt = b.needsTerminator ? b.end - 2 : b.end;
                return s >= open && e <= closeAt;
            });
            if (block) {
                const open = block.start + block.match[0].indexOf('::') + 2;
                const closeAt = block.needsTerminator ? block.end - 2 : block.end;
                const left = v.slice(open, s);
                const mid = v.slice(s, e);
                const right = v.slice(e, closeAt);
                const w = Number.isFinite(block.weight) ? block.weight : 1;
                const out = `${left.trim() ? close(w, left) : ''}${close(w, mid)}${right.trim() ? close(w, right) : ''}`;
                return { from: block.start, to: block.end, text: out };
            }
            const sel = v.slice(s, e);
            if (!sel.trim()) return null;
            return { from: s, to: e, text: close(1, sel) };
        },

        /** The desktop rack's attention distribution for a field (its cross-prompt pool reads Studio's fields). */
        rackDistribution(fid, targets, active, importanceByLocalIndex) {
            const textarea = textareaOf(fid);
            try {
                return computeEmphasisAutoDistribution(targets, active, { textarea, useCrossPromptPool: !!textarea, importanceByLocalIndex });
            } catch (err) {
                console.warn('[studioModel] rack distribution', fid, err);
                return { relativeImportances: [], suggestedOptimalByLocalIndex: [], relativeImportancesByLocalIndex: [], idealMaxWeight: 1 };
            }
        },

        /** The desktop's emphasis math and constants the rack's Normalize uses. */
        rackMath: () => ({
            sharesToWeights,
            weightToShare,
            rebalanceShares: rebalanceEmphasisShares,
            rebalanceSharesByDelta: rebalanceEmphasisSharesByDelta,
            rebalanceWeightsByDelta: rebalanceEmphasisWeightsByDelta,
            clampShare: clampEmphasisShare,
            clampN: clampEmphasisWeightNormalize,
            clampW: clampEmphasisWeight,
            eligible: isEligibleForEmphasisNormalize,
            idealMax: resolveIdealMaxWeightFromDistribution,
            weightFromRel: emphasisWeightFromRelativeImportance,
            snapBrace: snapWeightForBraceMode,
            stepBrace: stepBraceEmphasisWeight,
            sectionLength: getEmphasisSectionLength,
            UNBIASED: konst(() => EMPHASIS_IMPORTANCE_UNBIASED, 50),
            BAND_MIN: konst(() => EMPHASIS_AUTO_SHARE_BAND_MIN, 50),
            RANGE_STEP: konst(() => EMPHASIS_NORMALIZE_RANGE_STEP, 0.25)
        }),

        /** The field's saved Normalize state (the desktop rack's bag), or null. */
        rackLoadState(fid) {
            const ta = textareaOf(fid);
            if (!ta || !ta.id || !has('readEmphasisNormalizationFieldState')) return null;
            return readEmphasisNormalizationFieldState(ta.id);
        },
        /** A saved share / card entry for a target (the desktop's key lookup, then the list place). */
        rackSavedEntry: (store, target) => (has('lookupEmphasisSavedKeyEntry') ? lookupEmphasisSavedKeyEntry(store, target) : undefined),

        /**
         * Saves the field's Normalize state (null: Normalize off). The field's weight map for Studio's
         * hidden marks (groupsById) is kept as it is, as the desktop rack keeps it.
         */
        rackSaveState(fid, bag) {
            const ta = textareaOf(fid);
            if (!ta || !ta.id || !has('writeEmphasisNormalizationFieldState')) return;
            const prev = has('resolveEmphasisBagForTextarea') ? resolveEmphasisBagForTextarea(ta) : null;
            const ids = prev && prev.groupsById && typeof prev.groupsById === 'object' && Object.keys(prev.groupsById).length ? { ...prev.groupsById } : null;
            if (!bag) writeEmphasisNormalizationFieldState(ta.id, ids ? { groupsById: ids } : null);
            else writeEmphasisNormalizationFieldState(ta.id, ids ? { ...bag, groupsById: ids } : bag);
        }
    });
})();
