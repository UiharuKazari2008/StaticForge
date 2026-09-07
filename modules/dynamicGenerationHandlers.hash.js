const crypto = require('crypto');

/**
 * Generate a consistent prompt hash for cache validation
 * @param {string} prompt - The main prompt
 * @param {string} uc - The negative prompt
 * @param {Array} characterPrompts - Character prompts array
 * @param {string} [inputPromptNegative] - Raw inline prompt-negative (merged into prompt on server)
 * @returns {string} MD5 hash of the prompts
 */
function generatePromptHash(prompt, uc, characterPrompts, inputPromptNegative = '') {
    return crypto.createHash('md5')
        .update(JSON.stringify({
            prompt: prompt,
            uc: uc,
            characterPrompts: characterPrompts || [],
            input_prompt_negative: inputPromptNegative || ''
        }))
        .digest('hex');
}

/**
 * Generate a consistent request hash for dynamic generation context parameters
 * Used for cache validation and context locking validation
 * NOTE: Does NOT include directive - directive has its own hash
 * @param {Object} dynamicConfig - The dynamic generation configuration
 * @param {Object} datasetConfig - The dataset configuration (optional)
 * @returns {string} MD5 hash of the context parameters
 */
function generateRequestHash(dynamicConfig, datasetConfig = null) {
    // Use boolean existence for context data, not raw values
    return crypto.createHash('md5')
        .update(JSON.stringify({
            tod: !!dynamicConfig.tod,
            weather: !!dynamicConfig.weather,
            season: !!dynamicConfig.season,
            activity: !!dynamicConfig.activity,
            action: !!dynamicConfig.action,
            location: !!dynamicConfig.location,
            optimize: typeof dynamicConfig.optimize === 'object' && dynamicConfig.optimize !== null ? {
                enabled: !!dynamicConfig.optimize.enabled,
                tokenCount: !!dynamicConfig.optimize.tokenCount,
                twoStage: !!dynamicConfig.optimize.twoStage
            } : !!dynamicConfig.optimize,
            pipelineAware: !!dynamicConfig.pipelineAware,
            initialPromptAware: !!dynamicConfig.initialPromptAware,
            creative: !!dynamicConfig.creative,
            clothing: !!dynamicConfig.clothing,
            observeHoliday: !!dynamicConfig.observeHoliday,
            nsfw_level: !!datasetConfig?.nsfw
        }))
        .digest('hex');
}

/**
 * Generate a consistent directive hash
 * @param {string} directive - The directive text
 * @returns {string} MD5 hash of the directive
 */
function generateDirectiveHash(directive) {
    return crypto.createHash('md5')
        .update(directive || '')
        .digest('hex');
}

/**
 * Generate a hash for the generated system message text
 * Hashes the actual system message content instead of the inputs
 * @param {string} systemMessageText - The generated system message text
 * @returns {string} MD5 hash of the system message text
 */
function generateSystemMessageHashFromText(systemMessageText) {
    if (!systemMessageText || typeof systemMessageText !== 'string') {
        throw new Error('System message text must be a non-empty string');
    }
    return crypto.createHash('md5')
        .update(systemMessageText)
        .digest('hex');
}

module.exports = {
    generatePromptHash,
    generateRequestHash,
    generateDirectiveHash,
    generateSystemMessageHashFromText
};
