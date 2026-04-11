'use strict';

/**
 * Line-level stage conditionals (parallel to Text Expanders [Embedded] `stages` / range config).
 *
 * Syntax (content may be empty):
 *   !N/content/     — include only when effective stage index equals N (pipeline mode), or only N===0 when not in pipeline mode
 *   !N+/content/    — include when effective stage >= N
 *   !-N/content/    — include when effective stage <= N (stages start at 0)
 *
 * Non-pipeline generation uses effective stage 0 always, so only !0/…, !0+/…, and !-N/… (N>=0) can include content; other exact indices are dropped.
 *
 * @param {string} text
 * @param {{ stageIndex?: number, pipelineStageGeneration?: boolean } | null | undefined} stageData
 * @returns {string}
 */
function applyStageConditionalPromptBlocks(text, stageData) {
    if (!text || typeof text !== 'string') return '';
    const pipelineStageGeneration = !!(stageData && stageData.pipelineStageGeneration);
    const rawStage = stageData && typeof stageData.stageIndex === 'number' ? stageData.stageIndex : 0;
    const effectiveStage = pipelineStageGeneration ? rawStage : 0;

    let result = text;
    let prev;
    let guard = 0;
    do {
        prev = result;
        result = result.replace(/!-(\d+)\/([^\/]*)\//g, (match, numStr, content) => {
            const k = parseInt(numStr, 10);
            return effectiveStage <= k ? content : '';
        });
        result = result.replace(/!(\d+)\+\/([^\/]*)\//g, (match, numStr, content) => {
            const k = parseInt(numStr, 10);
            return effectiveStage >= k ? content : '';
        });
        result = result.replace(/!(\d+)\/([^\/]*)\//g, (match, numStr, content) => {
            const k = parseInt(numStr, 10);
            return effectiveStage === k ? content : '';
        });
        guard++;
    } while (prev !== result && guard < 32);

    return result;
}

/**
 * Legacy disable blocks: !/content/ removed entirely.
 * @param {string} text
 * @returns {string}
 */
function stripDisabledPromptBlocks(text) {
    if (!text || typeof text !== 'string') return '';
    return text.replace(/!\/[^\/]*\//g, '');
}

/**
 * Stage conditionals then disable blocks (order matches applyTextReplacements).
 * @param {string} text
 * @param {{ stageIndex?: number, pipelineStageGeneration?: boolean } | null | undefined} stageData
 * @returns {string}
 */
function stripPromptBlocksForEffectivePrompt(text, stageData) {
    let s = applyStageConditionalPromptBlocks(text, stageData || { stageIndex: 0, pipelineStageGeneration: false });
    s = stripDisabledPromptBlocks(s);
    return s;
}

module.exports = {
    applyStageConditionalPromptBlocks,
    stripDisabledPromptBlocks,
    stripPromptBlocksForEffectivePrompt
};
