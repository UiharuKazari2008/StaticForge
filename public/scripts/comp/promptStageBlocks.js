/**
 * Line-level stage conditionals (parallel to Text Expanders [Embedded] stage configuration).
 * See modules/promptStageBlocks.js — keep in sync.
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

function stripDisabledPromptBlocks(text) {
    if (!text || typeof text !== 'string') return '';
    return text.replace(/!\/[^\/]*\//g, '');
}

function stripPromptBlocksForEffectivePrompt(text, stageData) {
    let s = applyStageConditionalPromptBlocks(text, stageData || { stageIndex: 0, pipelineStageGeneration: false });
    s = stripDisabledPromptBlocks(s);
    return s;
}
