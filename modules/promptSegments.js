const globalResources = require('./globalResources');

/**
 * Parse a NovelAI-style prompt into comma-separated segments, respecting emphasis groups.
 * - Splits on commas that are NOT inside a weight group (e.g., 1.5::...::)
 * - Returns array of { text, weight, innerItems }
 *   - text: trimmed full segment text
 *   - weight: numeric weight if segment starts with weight::content::, otherwise null
 *   - innerItems: for weighted segments, items split by comma inside the group content (trimmed)
 */
function parsePromptSegments(text) {
    if (!text || typeof text !== 'string') return [];

    const segments = [];
    let current = '';
    let i = 0;
    let inGroup = false;

    while (i < text.length) {
        // Detect start of weight group when not already inside one
        if (!inGroup) {
            const match = text.slice(i).match(/^(-?\d+(?:\.\d+)?)::/);
            if (match) {
                inGroup = true;
                current += match[0];
                i += match[0].length;
                continue;
            }
        } else {
            // Detect end of group
            if (text[i] === ':' && text[i + 1] === ':') {
                inGroup = false;
                current += '::';
                i += 2;
                continue;
            }
        }

        const ch = text[i];
        if (!inGroup && ch === ',') {
            // Top-level comma: end of segment
            const trimmed = current.trim();
            if (trimmed) {
                segments.push(buildSegmentMeta(trimmed));
            }
            current = '';
            i += 1;
            continue;
        }

        current += ch;
        i += 1;
    }

    const finalTrimmed = current.trim();
    if (finalTrimmed) {
        segments.push(buildSegmentMeta(finalTrimmed));
    }

    return segments;
}

/**
 * Build segment metadata: detect leading weight::content:: and inner items.
 */
function buildSegmentMeta(segmentText) {
    const trimmed = segmentText.trim();
    const weightMatch = trimmed.match(/^(-?\d+(?:\.\d+)?)::([\s\S]*?)::\s*$/);

    if (!weightMatch) {
        return {
            text: trimmed,
            weight: null,
            innerItems: []
        };
    }

    const weight = parseFloat(weightMatch[1]);
    const innerContent = weightMatch[2].trim();
    const innerItems = innerContent
        ? innerContent.split(',').map(s => s.trim()).filter(Boolean)
        : [];

    return {
        text: trimmed,
        weight: Number.isNaN(weight) ? null : weight,
        innerItems
    };
}

/**
 * Extract separator format from original prompt text between two specific segments
 * Returns the separator pattern (', ' or ',') used between the segments
 */
function extractSeparatorFormat(originalText, seg1Text, seg2Text) {
    if (!originalText || !seg1Text || !seg2Text) return ', '; // Default to comma-space
    
    const idx1 = originalText.indexOf(seg1Text);
    if (idx1 === -1) return ', ';
    
    const afterSeg1 = originalText.substring(idx1 + seg1Text.length);
    const idx2 = afterSeg1.indexOf(seg2Text);
    if (idx2 === -1) return ', ';
    
    const separator = afterSeg1.substring(0, idx2);
    // Extract just the comma and any following whitespace
    if (separator.trim().startsWith(',')) {
        // Check if there's a space after the comma
        const commaIdx = separator.indexOf(',');
        if (commaIdx !== -1 && separator.length > commaIdx + 1 && separator[commaIdx + 1] === ' ') {
            return ', ';
        }
        return ',';
    }
    
    return ', '; // Default fallback
}

/**
 * Hydrate segment_index to select_text for all text replacements.
 * This converts segment indices (0, 1, 2, -1, 0.1, etc.) into actual text from the prompt segments.
 * 
 * @param {Object} textReplacements - The text_replacements object from AI response
 * @param {Object} buildOptions - Build options containing basePrompt, negativePrompt, characterPrompts
 */
function hydrateTextReplacements(textReplacements, buildOptions) {
    if (!textReplacements || !buildOptions) return;
    
    const hydrateFromSegments = (replacements, segments, originalText) => {
        if (!Array.isArray(replacements) || !Array.isArray(segments)) return;
        
        // Determine separator format from original text
        const separator = extractSeparatorFormat(originalText, segments);
        
        replacements.forEach(rep => {
            if (!rep) return;
            const idx = rep.segment_index;
            if (idx === null || idx === undefined) return;
            
            const action = (rep.action || 'replace').toLowerCase();
            if (action === 'append' && idx === -1) return;
            
            const indexToText = (singleIdx) => {
                if (singleIdx === -1) return null;
                if (typeof singleIdx === 'number') {
                    if (singleIdx % 1 !== 0) { // Is a float
                        const outer = Math.floor(singleIdx);
                        const inner = Math.round((singleIdx - outer) * 10);
                        if (outer >= 0 && outer < segments.length) {
                            const innerItems = segments[outer].innerItems || [];
                            if (inner >= 0 && inner < innerItems.length) {
                                return innerItems[inner];
                            }
                        }
                    } else { // Is an integer
                        if (singleIdx >= 0 && singleIdx < segments.length) {
                            return segments[singleIdx].text;
                        }
                    }
                }
                return null;
            };
            
            if (Array.isArray(idx)) {
                const segmentTexts = idx.map(indexToText).filter(text => text !== null);
                if (segmentTexts.length > 0) {
                    // ALWAYS set select_text as a string - join with separators matching original format
                    // For each pair of segments, determine the separator between them
                    const joinedParts = [];
                    for (let i = 0; i < segmentTexts.length; i++) {
                        if (i > 0) {
                            // Find the separator between this segment and the previous one in original text
                            const prevSegIdx = idx[i - 1];
                            const currSegIdx = idx[i];
                            if (typeof prevSegIdx === 'number' && typeof currSegIdx === 'number' && 
                                prevSegIdx >= 0 && prevSegIdx < segments.length &&
                                currSegIdx >= 0 && currSegIdx < segments.length) {
                                const sep = extractSeparatorFormat(originalText, segments[prevSegIdx].text, segments[currSegIdx].text);
                                joinedParts.push(sep);
                            } else {
                                joinedParts.push(', '); // Fallback
                            }
                        }
                        joinedParts.push(segmentTexts[i]);
                    }
                    rep.select_text = joinedParts.join('');
                }
            } else {
                const segmentText = indexToText(idx);
                if (segmentText) {
                    // ALWAYS set select_text as a string
                    rep.select_text = segmentText;
                }
            }
        });
    };
    
    const basePrompt = buildOptions.basePrompt || '';
    const negativePrompt = buildOptions.negativePrompt || '';
    const baseSegments = parsePromptSegments(basePrompt);
    const ucSegments = parsePromptSegments(negativePrompt);
    
    if (textReplacements.prompt) {
        hydrateFromSegments(textReplacements.prompt, baseSegments, basePrompt);
    }
    
    if (textReplacements.uc) {
        hydrateFromSegments(textReplacements.uc, ucSegments, negativePrompt);
    }
    
    if (textReplacements.character_prompts && buildOptions.characterPrompts && buildOptions.characterPrompts.length > 0) {
        textReplacements.character_prompts.forEach((charReplacements, index) => {
            if (charReplacements && buildOptions.characterPrompts[index]) {
                const charPrompt = buildOptions.characterPrompts[index].prompt || '';
                const charUc = buildOptions.characterPrompts[index].uc || '';
                const charPromptSegments = parsePromptSegments(charPrompt);
                const charUcSegments = parsePromptSegments(charUc);
                
                if (charReplacements.prompt) {
                    hydrateFromSegments(charReplacements.prompt, charPromptSegments, charPrompt);
                }
                if (charReplacements.uc) {
                    hydrateFromSegments(charReplacements.uc, charUcSegments, charUc);
                }
            }
        });
    }
}

module.exports = {
    parsePromptSegments,
    hydrateTextReplacements,
    extractSeparatorFormat
};


