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

function getEmphasisDistributionContextTokens(textarea) {
    // promptTextareaToolbar: public/scripts/comp/promptTextareaToolbar.js
    if (typeof promptTextareaToolbar !== 'undefined' && promptTextareaToolbar?._groupTotalsReady) {
        const gt = promptTextareaToolbar._groupTotals;
        return Math.max(0, (gt.editablePrompt || 0) + (gt.nePrompt || 0));
    }

    let promptTokens = 0;
    if (textarea && typeof t5Tokenizer !== 'undefined' && t5Tokenizer) {
        const raw = textarea.value || '';
        const stripped = typeof stripPromptBlocksForEffectivePrompt === 'function'
            ? stripPromptBlocksForEffectivePrompt(raw, { stageIndex: 0, pipelineStageGeneration: false })
            : raw;
        promptTokens = t5Tokenizer.countTokens(stripped);
    }
    // getActivePresetTokenDelta: public/scripts/comp/presetTokenCount.js
    if (typeof getActivePresetTokenDelta === 'function') {
        promptTokens += getActivePresetTokenDelta(textarea?.value || '').prompt || 0;
    }
    return Math.max(0, promptTokens);
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
            idealMaxWeight: 1
        };
    }

    const globalTokens = Math.max(
        1,
        options.contextTokenTotal !== undefined
            ? options.contextTokenTotal
            : getEmphasisDistributionContextTokens(options.textarea)
    );
    const groupTokenCounts = active.map((i) => countEmphasisGroupTokens(targets[i]?.innerText));
    const groupTokenTotal = groupTokenCounts.reduce((sum, n) => sum + n, 0);
    const groupCoverage = Math.min(1, groupTokenTotal / globalTokens);

    // computeEmphasisDistributionFromTokenCounts: public/scripts/comp/emphasisWeightMath.js
    const dist = computeEmphasisDistributionFromTokenCounts(groupTokenCounts, globalTokens, {
        activeIndices: active
    });

    return {
        globalTokens,
        groupTokenCounts,
        groupTokenTotal,
        groupCoverage,
        importances: dist.importances,
        relativeImportances: dist.relativeImportances,
        idealMaxWeight: dist.idealMaxWeight
    };
}
