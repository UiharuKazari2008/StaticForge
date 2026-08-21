// Weight Rack auto-distribution — attention-equalized ranks for normalize range
// (math in emphasisWeightMath.js; soft inverse-√tokens keeps short concepts visible)

function countEmphasisGroupTokens(innerText) {
    const text = String(innerText || '').trim();
    if (!text) return 1;
    // countTokensForText: public/scripts/comp/presetTokenCount.js
    if (typeof countTokensForText === 'function') {
        return Math.max(1, countTokensForText(text));
    }
    if (typeof t5Tokenizer !== 'undefined' && t5Tokenizer) {
        return Math.max(1, t5Tokenizer.countTokens(text));
    }
    return Math.max(1, text.split(/\s+/).filter(Boolean).length);
}

/** Same-polarity field group for cross-prompt Weight Rack math. */
function getEmphasisSiblingPolarity(textarea) {
    const id = textarea?.id || '';
    if (id === 'manualUc' || id.endsWith('_uc')) return 'uc';
    if (id === 'manualPromptNegative' || id.endsWith('_promptNegative')) return 'negative';
    return 'prompt';
}

function getEmphasisSiblingTextareas(textarea) {
    if (!textarea) return [];
    const polarity = getEmphasisSiblingPolarity(textarea);
    // promptTextareaToolbar: public/scripts/comp/promptTextareaToolbar.js
    let promptTextareas = [];
    let ucTextareas = [];
    if (typeof promptTextareaToolbar !== 'undefined' && promptTextareaToolbar?.collectEditorTokenTextareas) {
        const collected = promptTextareaToolbar.collectEditorTokenTextareas();
        promptTextareas = collected.promptTextareas || [];
        ucTextareas = collected.ucTextareas || [];
    } else {
        const manualPrompt = document.getElementById('manualPrompt');
        const manualUc = document.getElementById('manualUc');
        const manualPromptNegative = document.getElementById('manualPromptNegative');
        if (manualPrompt) promptTextareas.push(manualPrompt);
        if (manualUc) ucTextareas.push(manualUc);
        if (manualPromptNegative) promptTextareas.push(manualPromptNegative);
        promptTextareas.push(...Array.from(document.querySelectorAll('[id$="_prompt"].character-prompt-textarea')));
        promptTextareas.push(...Array.from(document.querySelectorAll('[id$="_promptNegative"].character-prompt-textarea')));
        ucTextareas.push(...Array.from(document.querySelectorAll('[id$="_uc"].character-prompt-textarea')));
    }

    let pool;
    if (polarity === 'uc') {
        pool = ucTextareas;
    } else if (polarity === 'negative') {
        pool = promptTextareas.filter((ta) => {
            const id = ta.id || '';
            return id === 'manualPromptNegative' || id.endsWith('_promptNegative');
        });
    } else {
        pool = promptTextareas.filter((ta) => {
            const id = ta.id || '';
            return id !== 'manualPromptNegative' && !id.endsWith('_promptNegative');
        });
    }
    return pool.filter((ta) => ta && ta !== textarea);
}

function countTokensForEmphasisContextText(raw) {
    let stripped = typeof stripPromptBlocksForEffectivePrompt === 'function'
        ? stripPromptBlocksForEffectivePrompt(raw || '', { stageIndex: 0, pipelineStageGeneration: false })
        : String(raw || '');
    // stripManagedEmphasisDelimitersForCounting: public/scripts/comp/emphasisGroupIdCodec.js
    if (typeof stripManagedEmphasisDelimitersForCounting === 'function') {
        stripped = stripManagedEmphasisDelimitersForCounting(stripped);
    }
    let tokens = 0;
    if (typeof t5Tokenizer !== 'undefined' && t5Tokenizer) {
        tokens = t5Tokenizer.countTokens(stripped);
    } else if (typeof countTokensForText === 'function') {
        tokens = countTokensForText(stripped);
    } else {
        tokens = stripped.split(/\s+/).filter(Boolean).length;
    }
    return Math.max(0, tokens);
}

function sumEmphasisPolarityPoolTokens(textarea) {
    const polarity = getEmphasisSiblingPolarity(textarea);
    const pool = [textarea, ...getEmphasisSiblingTextareas(textarea)].filter(Boolean);
    let total = 0;
    pool.forEach((ta) => {
        const raw = ta.value || '';
        total += countTokensForEmphasisContextText(raw);
        // getActivePresetTokenDelta: public/scripts/comp/presetTokenCount.js
        if (typeof getActivePresetTokenDelta === 'function') {
            const delta = getActivePresetTokenDelta(raw);
            total += polarity === 'uc' ? (delta.uc || 0) : (delta.prompt || 0);
        }
    });
    return Math.max(0, total);
}

function getEmphasisDistributionContextTokens(textarea) {
    const polarity = getEmphasisSiblingPolarity(textarea);

    // Negatives must never use the full prompt+UC group totals — always sum same-polarity fields.
    if (polarity === 'negative') {
        return sumEmphasisPolarityPoolTokens(textarea);
    }

    // promptTextareaToolbar: public/scripts/comp/promptTextareaToolbar.js
    if (typeof promptTextareaToolbar !== 'undefined' && promptTextareaToolbar?._groupTotalsReady) {
        const gt = promptTextareaToolbar._groupTotals;
        if (polarity === 'uc') {
            return Math.max(0, (gt.editableUc || 0) + (gt.neUc || 0));
        }
        // Prompt polarity: toolbar editablePrompt includes negatives — subtract by summing
        // positive-only pool when negatives exist in the editor.
        const hasNegatives = !!document.getElementById('manualPromptNegative')
            || document.querySelector('[id$="_promptNegative"].character-prompt-textarea');
        if (hasNegatives) {
            return sumEmphasisPolarityPoolTokens(textarea);
        }
        return Math.max(0, (gt.editablePrompt || 0) + (gt.nePrompt || 0));
    }

    return sumEmphasisPolarityPoolTokens(textarea);
}

/**
 * Full ranking pool: local editable groups + sibling same-polarity groups + unweighted 1.0 portions.
 * localIndex is set only for local editable targets (maps back into Weight Rack cards).
 */
function buildEmphasisDistributionPool(textarea, localTargets, localActiveIndices, options = {}) {
    const active = localActiveIndices && localActiveIndices.length
        ? localActiveIndices
        : (localTargets || []).map((_, i) => i);
    const entries = [];

    active.forEach((i) => {
        const target = localTargets[i];
        if (!target) return;
        entries.push({
            kind: 'local',
            localIndex: i,
            innerText: target.innerText,
            weight: target.weight,
            virtual: false,
            importanceBias: options.importanceByLocalIndex?.[i]
        });
    });

    // Local unweighted free spans (virtual 1.0 context; not split on commas)
    // listUnweightedEmphasisPortions: public/scripts/comp/emphasisParse.js
    if (typeof listUnweightedEmphasisPortions === 'function') {
        listUnweightedEmphasisPortions(textarea?.value || '').forEach((portion) => {
            entries.push({
                kind: 'unweighted',
                localIndex: null,
                innerText: portion.innerText,
                weight: 1,
                virtual: true,
                start: portion.start,
                end: portion.end,
                sourceTextareaId: textarea?.id || ''
            });
        });
    }

    getEmphasisSiblingTextareas(textarea).forEach((sib) => {
        const value = sib.value || '';
        // listEditorEmphasisTargets / resolveEmphasisBagForTextarea: public/scripts/comp/emphasisGroupIdCodec.js
        const sibTargets = typeof listEditorEmphasisTargets === 'function'
            ? listEditorEmphasisTargets(value, resolveEmphasisBagForTextarea(sib))
            : (typeof listAllEmphasisTargets === 'function' ? listAllEmphasisTargets(value) : []);
        sibTargets.forEach((target) => {
            entries.push({
                kind: 'sibling',
                localIndex: null,
                innerText: target.innerText,
                weight: target.weight,
                virtual: false,
                sourceTextareaId: sib.id || ''
            });
        });
        if (typeof listUnweightedEmphasisPortions === 'function') {
            listUnweightedEmphasisPortions(value).forEach((portion) => {
                entries.push({
                    kind: 'unweighted',
                    localIndex: null,
                    innerText: portion.innerText,
                    weight: 1,
                    virtual: true,
                    start: portion.start,
                    end: portion.end,
                    sourceTextareaId: sib.id || ''
                });
            });
        }
    });

    return entries;
}

function listLocalUnweightedContextCards(textarea) {
    // listUnweightedEmphasisPortions: public/scripts/comp/emphasisParse.js
    if (typeof listUnweightedEmphasisPortions !== 'function') return [];
    return listUnweightedEmphasisPortions(textarea?.value || '').map((portion) => ({
        type: 'unweighted',
        start: portion.start,
        end: portion.end,
        weight: 1,
        innerText: portion.innerText,
        virtual: true,
        disabled: true
    }));
}

/**
 * Map pool-relative ranks onto local active indices only.
 * Importance bias (0–100, 50 unbiased): soft multiplier, then hard rank laws outside 25–75.
 */
function mapPoolDistributionToLocal(poolEntries, poolDist, localActiveIndices, options = {}) {
    const active = localActiveIndices || [];
    const localPoolIdx = [];
    poolEntries.forEach((entry, poolIdx) => {
        if (entry.kind === 'local' && entry.localIndex != null && active.includes(entry.localIndex)) {
            localPoolIdx.push({ poolIdx, localIndex: entry.localIndex, importanceBias: entry.importanceBias });
        }
    });

    const poolRelative = Array.isArray(poolDist.relativeImportances) ? poolDist.relativeImportances : [];
    const baseRelatives = localPoolIdx.map(({ poolIdx }) => Number(poolRelative[poolIdx]) || 0);
    const biases = localPoolIdx.map(({ importanceBias }) => (
        Number.isFinite(importanceBias) ? importanceBias : EMPHASIS_IMPORTANCE_UNBIASED
    ));
    // applyEmphasisImportanceBiasToRelativeShares: public/scripts/comp/emphasisWeightMath.js
    const renorm = typeof applyEmphasisImportanceBiasToRelativeShares === 'function'
        ? applyEmphasisImportanceBiasToRelativeShares(baseRelatives, biases)
        : (typeof normalizeEmphasisShareArray === 'function'
            ? normalizeEmphasisShareArray(baseRelatives.map((base, i) => base * Math.max(0.01, biases[i] / 50)))
            : baseRelatives);

    const relativeImportances = [];
    const suggestedOptimalByLocalIndex = [];
    const idealMax = poolDist.idealMaxWeight;
    localPoolIdx.forEach((row, idx) => {
        const rel = renorm[idx] ?? 0;
        relativeImportances[row.localIndex] = rel;
        // emphasisWeightFromRelativeImportance: public/scripts/comp/emphasisWeightMath.js
        if (typeof emphasisWeightFromRelativeImportance === 'function') {
            suggestedOptimalByLocalIndex[row.localIndex] = emphasisWeightFromRelativeImportance(rel, idealMax);
        } else {
            suggestedOptimalByLocalIndex[row.localIndex] = idealMax;
        }
    });

    return {
        relativeImportances,
        suggestedOptimalByLocalIndex,
        absMaxWeight: typeof EMPHASIS_AUTO_TOP_MAX === 'number' ? EMPHASIS_AUTO_TOP_MAX : idealMax
    };
}

function computeEmphasisAutoDistribution(targets, activeIndices, options = {}) {
    const active = activeIndices && activeIndices.length
        ? activeIndices
        : (targets || []).map((_, i) => i);
    if (!active.length) {
        return {
            globalTokens: 1,
            groupTokenCounts: [],
            groupTokenTotal: 0,
            groupCoverage: 0,
            importances: [],
            relativeImportances: [],
            idealMaxWeight: 1,
            suggestedOptimalByLocalIndex: [],
            absMaxWeight: 1,
            poolEntries: [],
            contextCards: []
        };
    }

    const textarea = options.textarea;
    const usePool = options.useCrossPromptPool !== false && textarea;
    const contextCards = usePool ? listLocalUnweightedContextCards(textarea) : [];

    const globalTokens = Math.max(
        1,
        options.contextTokenTotal !== undefined
            ? options.contextTokenTotal
            : getEmphasisDistributionContextTokens(textarea)
    );

    if (!usePool) {
        const groupTokenCounts = active.map((i) => countEmphasisGroupTokens(targets[i]?.innerText));
        const groupTokenTotal = groupTokenCounts.reduce((sum, n) => sum + n, 0);
        const groupCoverage = Math.min(1, groupTokenTotal / globalTokens);
        // computeEmphasisDistributionFromTokenCounts: public/scripts/comp/emphasisWeightMath.js
        const dist = computeEmphasisDistributionFromTokenCounts(groupTokenCounts, globalTokens, {
            activeIndices: active
        });
        let relativeImportances = dist.relativeImportances;
        if (options.importanceByLocalIndex && typeof applyEmphasisImportanceBiasToRelativeShares === 'function') {
            const biases = active.map((i) => {
                const b = options.importanceByLocalIndex[i];
                return Number.isFinite(b) ? b : EMPHASIS_IMPORTANCE_UNBIASED;
            });
            relativeImportances = applyEmphasisImportanceBiasToRelativeShares(relativeImportances, biases);
        }
        const suggestedOptimalByLocalIndex = [];
        active.forEach((i, rank) => {
            const rel = relativeImportances[rank] ?? 0;
            suggestedOptimalByLocalIndex[i] = emphasisWeightFromRelativeImportance(rel, dist.idealMaxWeight);
        });
        return {
            globalTokens,
            groupTokenCounts,
            groupTokenTotal,
            groupCoverage,
            importances: dist.importances,
            relativeImportances,
            idealMaxWeight: dist.idealMaxWeight,
            suggestedOptimalByLocalIndex,
            absMaxWeight: typeof EMPHASIS_AUTO_TOP_MAX === 'number' ? EMPHASIS_AUTO_TOP_MAX : dist.idealMaxWeight,
            poolEntries: [],
            contextCards,
            relativeImportancesByLocalIndex: (() => {
                const byLocal = [];
                active.forEach((i, rank) => {
                    byLocal[i] = relativeImportances[rank] ?? 0;
                });
                return byLocal;
            })()
        };
    }

    const poolEntries = buildEmphasisDistributionPool(textarea, targets, active, {
        importanceByLocalIndex: options.importanceByLocalIndex
    });
    const poolCounts = poolEntries.map((e) => countEmphasisGroupTokens(e.innerText));
    const poolActive = poolEntries.map((_, i) => i);
    // computeEmphasisDistributionFromTokenCounts: public/scripts/comp/emphasisWeightMath.js
    const poolDist = computeEmphasisDistributionFromTokenCounts(poolCounts, globalTokens, {
        activeIndices: poolActive
    });
    const mapped = mapPoolDistributionToLocal(poolEntries, poolDist, active, options);

    // Compact relativeImportances aligned to active rank order (for existing callers)
    const relativeImportances = active.map((i) => mapped.relativeImportances[i] ?? 0);
    const groupTokenCounts = active.map((i) => countEmphasisGroupTokens(targets[i]?.innerText));
    const groupTokenTotal = groupTokenCounts.reduce((sum, n) => sum + n, 0);
    const groupCoverage = Math.min(1, groupTokenTotal / globalTokens);
    const importances = groupTokenCounts.map((n) => clampEmphasisShare((n / globalTokens) * 100));

    return {
        globalTokens,
        groupTokenCounts,
        groupTokenTotal,
        groupCoverage,
        importances,
        relativeImportances,
        idealMaxWeight: poolDist.idealMaxWeight,
        suggestedOptimalByLocalIndex: mapped.suggestedOptimalByLocalIndex,
        absMaxWeight: mapped.absMaxWeight,
        poolEntries,
        contextCards,
        relativeImportancesByLocalIndex: mapped.relativeImportances
    };
}
