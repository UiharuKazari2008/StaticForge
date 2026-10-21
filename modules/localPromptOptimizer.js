// Local Prompt Optimizer
// parseEmphasis: NovelAI emphasis syntax, used by dynamicGenerationHandlers. The
// token-saving optimizer this class was built around (T5 vocabulary index, synonym
// and tag lookups) had no callers and was removed.

class LocalPromptOptimizer {
    constructor(globalResources) {
        if (!globalResources) {
            throw new Error('LocalPromptOptimizer requires globalResources');
        }
        this.globalResources = globalResources;
        this.initialized = false;
    }

    async initialize() {
        this.initialized = true;
        return true;
    }

    /**
     * Parse NovelAI emphasis syntax
     * Returns { weight, text, cleanText, rawText, hasEmphasis }
     */
    parseEmphasis(text) {
        let weight = 1.0;
        let cleanText = text;
        let hasNumericEmphasis = false;
        
        // First check for auto-terminating pattern: number::text (without closing ::)
        const autoTerminatingPattern = /^(\d+\.?\d*)::(.+?)(?=\s*\d+\.?\d*::|::|$)/;
        const autoTerminatingMatch = text.match(autoTerminatingPattern);
        
        if (autoTerminatingMatch) {
            weight = parseFloat(autoTerminatingMatch[1]);
            cleanText = autoTerminatingMatch[2].trim();
            hasNumericEmphasis = true;
        } else {
            // Pattern: number::text::
            const numericPattern = /^(\d+\.?\d*)::(.+?)::$/;
            const numericMatch = text.match(numericPattern);
            
            if (numericMatch) {
                weight = parseFloat(numericMatch[1]);
                cleanText = numericMatch[2].trim();
                hasNumericEmphasis = true;
            }
        }
        
        // Count curly braces (each pair = ~1.05x weight)
        let braceCount = 0;
        let tempText = cleanText;
        
        while (tempText.startsWith('{') && tempText.endsWith('}')) {
            braceCount++;
            tempText = tempText.substring(1, tempText.length - 1).trim();
        }
        
        if (braceCount > 0) {
            weight *= Math.pow(1.05, braceCount);
            cleanText = tempText;
        }
        
        // Count square brackets (each pair = ~0.95x weight)
        let bracketCount = 0;
        tempText = cleanText;
        
        while (tempText.startsWith('[') && tempText.endsWith(']')) {
            bracketCount++;
            tempText = tempText.substring(1, tempText.length - 1).trim();
        }
        
        if (bracketCount > 0) {
            weight *= Math.pow(0.95, bracketCount);
            cleanText = tempText;
        }
        
        return {
            weight,
            text: cleanText,
            rawText: text,
            hasEmphasis: hasNumericEmphasis || braceCount > 0 || bracketCount > 0,
            braceCount,
            bracketCount
        };
    }
}

module.exports = LocalPromptOptimizer;

