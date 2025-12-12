// Dynamic Generation Response Schema
// Separated to avoid circular dependencies between dynamicGenerationHandlers and grokService

const { z } = require('zod');

/**
 * Creates a case-insensitive enum schema with preprocessor
 * Converts string values to lowercase before validation
 * @param {string[]} values - Array of enum values
 * @returns {z.ZodEnum} Zod enum schema with case-insensitive preprocessing
 */
function createCaseInsensitiveEnum(values) {
    return z.preprocess(
        (val) => {
            if (typeof val === 'string') {
                return val.toLowerCase();
            }
            return val;
        },
        z.enum(values)
    );
}

/**
 * Normalize segment_index to handle malformed values
 * Fixes cases where AI generates malformed values like "- " (minus with space)
 * Converts string numbers (like "0.1") to floats
 * For append actions, null/undefined defaults to -1 (append to end)
 * Validates that negative values must be exactly -1 (no values between 0 and -1)
 */
function normalizeSegmentIndex(val) {
    // Default null/undefined to -1 (for append-to-end)
    if (val === null || val === undefined) return -1;
    
    // Helper to validate and normalize a single value
    const normalizeSingle = (num) => {
        if (typeof num !== 'number') return num;
        // If negative, must be exactly -1 (no values between 0 and -1)
        if (num < 0 && num !== -1) {
            // Invalid negative value, default to -1
            return -1;
        }
        return num;
    };
    
    // Handle string values - convert to numbers (for floats like "0.1")
    if (typeof val === 'string') {
        const trimmed = val.trim();
        // Fix malformed "- " or "-" - normalize to -1
        if (trimmed === '-' || trimmed === '- ' || trimmed.startsWith('- ')) {
            return -1;
        }
        // Try to parse as number (handles both integers and floats like "0.1")
        const parsed = parseFloat(trimmed);
        if (!isNaN(parsed)) {
            return normalizeSingle(parsed);
        }
        // If not a valid number, return -1 as fallback
        return -1;
    }
    
    // Handle arrays
    if (Array.isArray(val)) {
        return val.map(item => {
            if (typeof item === 'string') {
                const trimmed = item.trim();
                if (trimmed === '-' || trimmed === '- ' || trimmed.startsWith('- ')) {
                    return -1;
                }
                // Try to parse as number
                const parsed = parseFloat(trimmed);
                if (!isNaN(parsed)) {
                    return normalizeSingle(parsed);
                }
                return -1; // Fallback
            }
            return normalizeSingle(item);
        });
    }
    
    // Handle number values
    if (typeof val === 'number') {
        return normalizeSingle(val);
    }
    
    return val;
}

/**
 * Normalize replacement category to match enum values
 * Maps common variations to the correct enum format
 */
function normalizeReplacementCategory(val) {
    if (typeof val !== 'string') return val;
    
    // Normalize to lowercase for comparison, then map to correct enum value
    const normalized = val.trim();
    const lower = normalized.toLowerCase();
    
    // Valid enum values
    const validCategories = ['Weather', 'Time of Day', 'Seasonal', 'Holiday', 'Spelling', 'Text Overlay', 'Conflict Resolution', 'Enhancement', 'Lighting', 'Atmosphere', 'Action Verbs', 'Directive'];
    
    // Map common variations to correct enum values
    const categoryMap = {
        'weather': 'Weather',
        'time of day': 'Time of Day',
        'timeofday': 'Time of Day',
        'time_of_day': 'Time of Day',
        'seasonal': 'Seasonal',
        'holiday': 'Holiday',
        'spelling': 'Spelling',
        'text overlay': 'Text Overlay',
        'textoverlay': 'Text Overlay',
        'text_overlay': 'Text Overlay',
        'conflict resolution': 'Conflict Resolution',
        'conflictresolution': 'Conflict Resolution',
        'conflict_resolution': 'Conflict Resolution',
        'enhancement': 'Enhancement',
        'lighting': 'Lighting',
        'atmosphere': 'Atmosphere',
        'action verbs': 'Action Verbs',
        'actionverbs': 'Action Verbs',
        'action_verbs': 'Action Verbs',
        'directive': 'Directive'
    };
    
    // Check exact match first (handles lowercase, uppercase, mixed case)
    if (categoryMap[lower]) {
        return categoryMap[lower];
    }
    
    // Check if it's already a valid enum value (case-insensitive)
    const lowerValid = validCategories.map(c => c.toLowerCase());
    const index = lowerValid.indexOf(lower);
    if (index !== -1) {
        return validCategories[index];
    }
    
    // Try fuzzy matching for common variations
    for (const [key, value] of Object.entries(categoryMap)) {
        if (lower === key || lower.replace(/\s+/g, '') === key.replace(/\s+/g, '') || 
            lower.replace(/_/g, ' ') === key.replace(/_/g, ' ')) {
            return value;
        }
    }
    
    // Return original value if no match - let Zod validation handle the error
    return val;
}

/**
 * Get the number of top-level keys in a Zod schema
 * @param {Object} schema - Zod schema object
 * @returns {number} Number of top-level keys
 */
function getZodSchemaKeyCount(schema) {
    if (schema && schema._def && schema._def.shape) {
        return Object.keys(schema._def.shape).length;
    }
    return 1; // fallback
}

/**
 * Check if character prompts contain placeholder names
 * @param {Array} characterPrompts - Array of character prompt objects
 * @returns {boolean} True if any character has a placeholder name
 */
function hasPlaceholderCharacterNames(characterPrompts = []) {
    if (!Array.isArray(characterPrompts) || characterPrompts.length === 0) {
        return false;
    }
    
    const placeholderPatterns = [
        /^Character\s*#?\d+$/i,  // "Character 1", "Character #1", "Character1"
        /^Character\s+\d+$/i,     // "Character 1"
        /^Girl\s*#?\d+$/i,       // "Girl 1", "Girl #1"
        /^Boy\s*#?\d+$/i,        // "Boy 1", "Boy #1"
        /^Person\s*#?\d+$/i       // "Person 1", "Person #1"
    ];
    
    return characterPrompts.some(char => {
        const name = char.chara_name || char.name || '';
        return placeholderPatterns.some(pattern => pattern.test(name.trim()));
    });
}

/**
 * Create the Zod schema for dynamic generation responses
 * @param {number} expectedCharacterPrompts - Number of character prompts expected
 * @param {Array} characterPrompts - Array of character prompt objects (optional, for placeholder detection)
 * @param {number} dialogsCount - Number of dialogs expected (0 or undefined means dialogs are disabled)
 * @returns {ZodObject} Zod schema for validation
 */

function createDynamicGenerationResponseSchema(expectedCharacterPrompts = 0, characterPrompts = null, dialogsCount = null) {
    const hasPlaceholders = characterPrompts ? hasPlaceholderCharacterNames(characterPrompts) : false;
    // Match the same logic used throughout the codebase for determining if dialogs are enabled
    // If dialogsCount is explicitly 0, dialogs are disabled. If null/undefined, default behavior may vary.
    // For schema validation: only enable dialogs if dialogsCount is explicitly set and > 0
    const dialogsEnabled = dialogsCount != null && dialogsCount > 0;
    
    // Base schema without dialogs
    const baseSchema = z.object({
    text_replacements: z.object({
        prompt: z.array(z.object({
            reason: z.string()
                .describe("Plain text brief description of the reason for this replacement (short sentence)"),
            reason_display: z.string()
                .describe("Very short explanation for display in UI (2-5 words)"),
            segment_index: z.preprocess(
                normalizeSegmentIndex,
                z.union([
                    z.number().min(-1), 
                    z.array(z.number().min(-1)).min(1)
                ])
            ).describe("REQUIRED: 0-based index(es) of the comma-separated segment(s) in the base prompt to target. Use a single number (e.g., 0, 1, 2 for segments, or 0.1, 0.2 for inner items within emphasis groups) or an array (e.g., [0, 1, 2] for REPLACE - must be continuous, or [0, 2, 5] for DELETE - can be non-continuous). REQUIRED for all actions. For APPEND: use -1 to append at end, or provide a segment index to append after that segment."),
            replace_text: z.string().nullable().optional()
                .describe("Text to insert or replace with. REQUIRED for replace/append actions, MUST be omitted entirely for delete actions."),
            action: z.preprocess(
                (val) => {
                    if (typeof val === 'string') {
                        return val.toLowerCase();
                    }
                    return val;
                },
                z.enum(['replace', 'append', 'delete']).nullable().default('replace')
            ).describe("Replacement action: replace (default), append, or delete"),
            count: z.number().int().positive().nullable().optional()
                .describe("For delete only: number of occurrences to remove left-to-right (omit to delete all)"),
            is_critical: z.boolean().nullable().default(true)
                .describe("Whether this replacement is critical (true) requiring retry if failed, or optional (false) allowing graceful fallback"),
            alternative_text: z.string().nullable().optional()
                .describe("For optional replacements: safer generic text to append if the replacement cannot be applied."),
            replacement_category: z.preprocess(
                normalizeReplacementCategory,
                z.enum(['Weather', 'Time of Day', 'Seasonal', 'Holiday', 'Spelling', 'Text Overlay', 'Conflict Resolution', 'Enhancement', 'Lighting', 'Atmosphere', 'Action Verbs', 'Directive'])
            ).describe("Category enum: 'Weather' (weather conditions), 'Time of Day' (time/lighting), 'Seasonal' (season elements), 'Holiday' (festive), 'Lighting' (light quality/sources), 'Atmosphere' (mood/ambiance), 'Enhancement' (quality improvements), 'Action Verbs' (character actions/poses), 'Text Overlay' (modify text after ', Text:' boundary), 'Spelling' (typo fixes), 'Conflict Resolution' (remove conflicts), 'Directive' (user request not fitting other categories). NOTE: Only 'Spelling' and 'Text Overlay' can modify text after ', Text:' boundary"),
            segment_emphasis: z.number().min(-5).max(8).nullable().optional()
                .describe("Emphasis Multiplier to apply to the replacement text. If set, The new text will be wrapped with a emphasis group safely (e.g., 2.4::text::). If the selected text segment was a group (e.g., already wrapped in emphasis groups) and this value is not defined, the previous emphasis value will be applied automatically."),
            append_after: z.union([z.string(), z.number().int().min(0)]).nullable().optional()
                .describe("ADVANCED: For APPEND only - Insert text after a specific word or word position within the segment. Use string (e.g., 'happy') to append after that word, or number (e.g., 2) to append after the Nth word (0-indexed). Only use when you need granular insertion within a segment. Default behavior appends after the entire segment."),
            append_delimiter: createCaseInsensitiveEnum(['space', 'comma', 'none']).nullable().optional()
                .describe("ADVANCED: For APPEND only - Delimiter to use before inserted text when append_after is set. 'space' adds a space, 'comma' adds a comma, 'none' adds nothing (for append_standalone='direct'). Only used with append_after."),
            append_standalone: createCaseInsensitiveEnum(['standalone', 'simple', 'direct']).nullable().optional()
                .describe("ADVANCED: For APPEND only - How to handle spacing/punctuation: 'standalone' (tag in a list - auto-handles commas), 'simple' (word insertion - auto-adds space if needed), 'direct' (literal insertion - you control all spacing). Only used with append_after. Default: 'simple'"),
            replace_part: z.string().nullable().optional()
                .describe("ADVANCED: For REPLACE only - Replace a specific part within the segment instead of the entire segment. Useful for spelling corrections or partial word replacements. Provide the exact text within the segment to replace. Only use when you need granular replacement without affecting the rest of the segment."),
            index: z.number().int().nullable().optional()
                .describe("Current increment value for incrementing logic (used by server for state management)"),
            increment_data: z.string().max(64).nullable().optional()
                .describe("Additional state data for incrementation (max 64 chars, used by server for state management)"),
            references: z.array(z.object({
                type: createCaseInsensitiveEnum(['web_search', 'tag_search', 'tag_description', 'tokenizer', 'memory_retrieval'])
                    .describe("Reference type: web_search (web lookup), tag_search (tag database search), tag_description (tag description search), tokenizer (token analysis), memory_retrieval (memory retrieval)"),
                query: z.string().nullable().optional()
                    .describe("Search query or description (for web_search, tag_search, tag_description)"),
                url: z.string().nullable().optional()
                    .describe("URL (for web_search only)"),
                tags: z.array(z.string()).nullable().optional()
                    .describe("Tag names found/used (for tag_search, tag_description)"),
                description: z.string().nullable().optional()
                    .describe("Brief description of what was found or analyzed (for tag_description, tokenizer, memory_retrieval)")
            })).nullable().optional()
                .describe("Optional array of research sources used for this replacement (for client-side display only)")
        })).describe("Find-and-replace operations for the main prompt"),
        uc: z.array(z.object({
            reason: z.string()
                .describe("Plain text brief description of the reason for this replacement (short sentence)"),
            reason_display: z.string()
                .describe("Very short explanation for display in UI (2-5 words)"),
            segment_index: z.preprocess(
                normalizeSegmentIndex,
                z.union([
                    z.number().min(-1), 
                    z.array(z.number().min(-1)).min(1)
                ])
            ).describe("REQUIRED: 0-based index(es) of the comma-separated segment(s) in the negative prompt (UC) to target. Use a single number (e.g., 0, 1, 2 for segments, or 0.1, 0.2 for inner items within emphasis groups) or an array (e.g., [0, 1, 2] for REPLACE - must be continuous, or [0, 2, 5] for DELETE - can be non-continuous). REQUIRED for all actions. For APPEND: use -1 to append at end, or provide a segment index to append after that segment."),
            replace_text: z.string().nullable().optional()
                .describe("Text to insert or replace with in the negative prompt. REQUIRED for replace/append actions, MUST be omitted entirely for delete actions."),
            action: z.preprocess(
                (val) => {
                    if (typeof val === 'string') {
                        return val.toLowerCase();
                    }
                    return val;
                },
                z.enum(['replace', 'append', 'delete']).nullable().default('replace')
            ).describe("Replacement action: replace (default), append, or delete"),
            count: z.number().int().positive().nullable().optional()
                .describe("For delete only: number of occurrences to remove left-to-right (omit to delete all)"),
            is_critical: z.boolean().nullable().default(true)
                .describe("Whether this replacement is critical (true) requiring retry if failed, or optional (false) allowing graceful fallback"),
            alternative_text: z.string().nullable().optional()
                .describe("For optional replacements: safer generic text to append if the replacement cannot be applied."),
            replacement_category: z.preprocess(
                normalizeReplacementCategory,
                z.enum(['Weather', 'Time of Day', 'Seasonal', 'Holiday', 'Spelling', 'Text Overlay', 'Conflict Resolution', 'Enhancement', 'Lighting', 'Atmosphere', 'Action Verbs', 'Directive'])
            ).describe("Category enum: 'Weather' (weather conditions), 'Time of Day' (time/lighting), 'Seasonal' (season elements), 'Holiday' (festive), 'Lighting' (light quality/sources), 'Atmosphere' (mood/ambiance), 'Enhancement' (quality improvements), 'Action Verbs' (character actions/poses), 'Text Overlay' (modify text after ', Text:' boundary), 'Spelling' (typo fixes), 'Conflict Resolution' (remove conflicts), 'Directive' (user request not fitting other categories). NOTE: Only 'Spelling' and 'Text Overlay' can modify text after ', Text:' boundary"),
            segment_emphasis: z.number().min(-5).max(8).nullable().optional()
                .describe("Emphasis Multiplier to apply to the replacement text. If set, The new text will be wrapped with a emphasis group safely (e.g., 2.4::text::). If the selected text segment was a group (e.g., already wrapped in emphasis groups) and this value is not defined, the previous emphasis value will be applied automatically."),
            append_after: z.union([z.string(), z.number().int().min(0)]).nullable().optional()
                .describe("ADVANCED: For APPEND only - Insert text after a specific word or word position within the segment. Use string (e.g., 'happy') to append after that word, or number (e.g., 2) to append after the Nth word (0-indexed). Only use when you need granular insertion within a segment. Default behavior appends after the entire segment."),
            append_delimiter: createCaseInsensitiveEnum(['space', 'comma', 'none']).nullable().optional()
                .describe("ADVANCED: For APPEND only - Delimiter to use before inserted text when append_after is set. 'space' adds a space, 'comma' adds a comma, 'none' adds nothing (for append_standalone='direct'). Only used with append_after."),
            append_standalone: createCaseInsensitiveEnum(['standalone', 'simple', 'direct']).nullable().optional()
                .describe("ADVANCED: For APPEND only - How to handle spacing/punctuation: 'standalone' (tag in a list - auto-handles commas), 'simple' (word insertion - auto-adds space if needed), 'direct' (literal insertion - you control all spacing). Only used with append_after. Default: 'simple'"),
            replace_part: z.string().nullable().optional()
                .describe("ADVANCED: For REPLACE only - Replace a specific part within the segment instead of the entire segment. Useful for spelling corrections or partial word replacements. Provide the exact text within the segment to replace. Only use when you need granular replacement without affecting the rest of the segment."),
            index: z.number().int().nullable().optional()
                .describe("Current increment value for incrementing logic (used by server for state management)"),
            increment_data: z.string().max(64).nullable().optional()
                .describe("Additional state data for incrementation (max 64 chars, used by server for state management)"),
            references: z.array(z.object({
                type: createCaseInsensitiveEnum(['web_search', 'tag_search', 'tag_description', 'tokenizer', 'memory_retrieval'])
                    .describe("Reference type: web_search (web lookup), tag_search (tag database search), tag_description (tag description search), tokenizer (token analysis), memory_retrieval (memory retrieval)"),
                query: z.string().nullable().optional()
                    .describe("Search query or description (for web_search, tag_search, tag_description)"),
                url: z.string().nullable().optional()
                    .describe("URL (for web_search only)"),
                tags: z.array(z.string()).nullable().optional()
                    .describe("Tag names found/used (for tag_search, tag_description)"),
                description: z.string().nullable().optional()
                    .describe("Brief description of what was found or analyzed (for tag_description, tokenizer, memory_retrieval)")
            })).nullable().optional()
                .describe("Optional array of research sources used for this replacement (for client-side display only)")
        })).describe("Find-and-replace operations for the negative prompt"),
        character_prompts: z.array(z.object({
            prompt: z.array(z.object({
                reason: z.string()
                    .describe("Plain text brief description of the reason for this replacement (short sentence)"),
                reason_display: z.string()
                    .describe("Very short explanation for display in UI (2-5 words)"),
                segment_index: z.preprocess(
                    normalizeSegmentIndex,
                    z.union([
                        z.number().min(-1), 
                        z.array(z.number().min(-1)).min(1)
                    ])
                ).describe("REQUIRED: 0-based index(es) of the comma-separated segment(s) in THIS character's positive prompt to target. Use a single number (e.g., 0, 1, 2 for segments, or 0.1, 0.2 for inner items within emphasis groups) or an array (e.g., [0, 1, 2] for REPLACE - must be continuous, or [0, 2, 5] for DELETE - can be non-continuous). REQUIRED for all actions. For APPEND: use -1 to append at end, or provide a segment index to append after that segment."),
                replace_text: z.string().nullable().optional()
                    .describe("Text to insert or replace with in this character's positive prompt. REQUIRED for replace/append actions, MUST be omitted entirely for delete actions."),
                action: z.preprocess(
                    (val) => {
                        if (typeof val === 'string') {
                            return val.toLowerCase();
                        }
                        return val;
                    },
                    z.enum(['replace', 'append', 'delete']).nullable().default('replace')
                ).describe("Replacement action: replace (default), append, or delete"),
                count: z.number().int().positive().nullable().optional()
                    .describe("For delete only: number of occurrences to remove left-to-right (omit to delete all)"),
                is_critical: z.boolean().nullable().default(true)
                    .describe("Whether this replacement is critical (true) requiring retry if failed, or optional (false) allowing graceful fallback"),
                alternative_text: z.string().nullable().optional()
                    .describe("For optional replacements: safer generic text to append if the replacement cannot be applied."),
                replacement_category: z.preprocess(
                    normalizeReplacementCategory,
                    z.enum(['Weather', 'Time of Day', 'Seasonal', 'Holiday', 'Spelling', 'Text Overlay', 'Conflict Resolution', 'Enhancement', 'Lighting', 'Atmosphere', 'Action Verbs', 'Directive'])
                ).describe("Category enum: 'Weather' (weather conditions), 'Time of Day' (time/lighting), 'Seasonal' (season elements), 'Holiday' (festive), 'Lighting' (light quality/sources), 'Atmosphere' (mood/ambiance), 'Enhancement' (quality improvements), 'Action Verbs' (character actions/poses), 'Text Overlay' (text after ', Text:'), 'Spelling' (typo fixes), 'Conflict Resolution' (remove conflicts), 'Directive' (user request not fitting other categories). NOTE: Only 'Spelling' and 'Text Overlay' can modify text after ', Text:' boundary"),
                segment_emphasis: z.number().min(-5).max(8).nullable().optional()
                    .describe("Emphasis Multiplier to apply to the replacement text. If set, The new text will be wrapped with a emphasis group safely (e.g., 2.4::text::). If the selected text segment was a group (e.g., already wrapped in emphasis groups) and this value is not defined, the previous emphasis value will be applied automatically."),
                append_after: z.union([z.string(), z.number().int().min(0)]).nullable().optional()
                    .describe("ADVANCED: For APPEND only - Insert text after a specific word or word position within the segment. Use string (e.g., 'happy') to append after that word, or number (e.g., 2) to append after the Nth word (0-indexed). Only use when you need granular insertion within a segment. Default behavior appends after the entire segment."),
                append_delimiter: createCaseInsensitiveEnum(['space', 'comma', 'none']).nullable().optional()
                    .describe("ADVANCED: For APPEND only - Delimiter to use before inserted text when append_after is set. 'space' adds a space, 'comma' adds a comma, 'none' adds nothing (for append_standalone='direct'). Only used with append_after."),
                append_standalone: createCaseInsensitiveEnum(['standalone', 'simple', 'direct']).nullable().optional()
                    .describe("ADVANCED: For APPEND only - How to handle spacing/punctuation: 'standalone' (tag in a list - auto-handles commas), 'simple' (word insertion - auto-adds space if needed), 'direct' (literal insertion - you control all spacing). Only used with append_after. Default: 'simple'"),
                replace_part: z.string().nullable().optional()
                    .describe("ADVANCED: For REPLACE only - Replace a specific part within the segment instead of the entire segment. Useful for spelling corrections or partial word replacements. Provide the exact text within the segment to replace. Only use when you need granular replacement without affecting the rest of the segment."),
                index: z.number().int().nullable().optional()
                    .describe("Current increment value for incrementing logic (used by server for state management)"),
                increment_data: z.string().max(64).nullable().optional()
                    .describe("Additional state data for incrementation (max 64 chars, used by server for state management)"),
                references: z.array(z.object({
                    type: createCaseInsensitiveEnum(['web_search', 'tag_search', 'tag_description', 'tokenizer', 'memory_retrieval'])
                        .describe("Reference type: web_search (web lookup), tag_search (tag database search), tag_description (tag description search), tokenizer (token analysis), memory_retrieval (memory retrieval)"),
                    query: z.string().nullable().optional()
                        .describe("Search query or description (for web_search, tag_search, tag_description)"),
                    url: z.string().nullable().optional()
                        .describe("URL (for web_search only)"),
                    tags: z.array(z.string()).nullable().optional()
                        .describe("Tag names found/used (for tag_search, tag_description)"),
                    description: z.string().nullable().optional()
                        .describe("Brief description of what was found or analyzed (for tag_description, tokenizer, memory_retrieval)")
                })).nullable().optional()
                    .describe("Optional array of research sources used for this replacement (for client-side display only)")
            })).describe("Find-and-replace operations for this character prompt"),
            uc: z.array(z.object({
                reason: z.string()
                    .describe("Plain text brief description of the reason for this replacement (short sentence)"),
                reason_display: z.string()
                    .describe("Very short explanation for display in UI (2-5 words)"),
                segment_index: z.preprocess(
                    normalizeSegmentIndex,
                    z.union([
                        z.number().min(-1), 
                        z.array(z.number().min(-1)).min(1)
                    ])
                ).describe("REQUIRED: 0-based index(es) of the comma-separated segment(s) in THIS character's negative prompt (UC) to target. Use a single number (e.g., 0, 1, 2 for segments, or 0.1, 0.2 for inner items within emphasis groups) or an array (e.g., [0, 1, 2] for REPLACE - must be continuous, or [0, 2, 5] for DELETE - can be non-continuous). REQUIRED for all actions. For APPEND: use -1 to append at end, or provide a segment index to append after that segment."),
                replace_text: z.string().nullable().optional()
                    .describe("Text to insert or replace with in this character's negative prompt. REQUIRED for replace/append actions, MUST be omitted entirely for delete actions."),
                action: z.preprocess(
                    (val) => {
                        if (typeof val === 'string') {
                            return val.toLowerCase();
                        }
                        return val;
                    },
                    z.enum(['replace', 'append', 'delete']).nullable().default('replace')
                ).describe("Replacement action: replace (default), append, or delete"),
                count: z.number().int().positive().nullable().optional()
                    .describe("For delete only: number of occurrences to remove left-to-right (omit to delete all)"),
                is_critical: z.boolean().nullable().default(true)
                    .describe("Whether this replacement is critical (true) requiring retry if failed, or optional (false) allowing graceful fallback"),
                alternative_text: z.string().nullable().optional()
                    .describe("For optional replacements: safer generic text to append if the replacement cannot be applied."),
                replacement_category: z.preprocess(
                    normalizeReplacementCategory,
                    z.enum(['Weather', 'Time of Day', 'Seasonal', 'Holiday', 'Spelling', 'Text Overlay', 'Conflict Resolution', 'Enhancement', 'Lighting', 'Atmosphere', 'Action Verbs', 'Directive'])
                ).describe("Category enum: 'Weather' (weather conditions), 'Time of Day' (time/lighting), 'Seasonal' (season elements), 'Holiday' (festive), 'Lighting' (light quality/sources), 'Atmosphere' (mood/ambiance), 'Enhancement' (quality improvements), 'Action Verbs' (character actions/poses), 'Text Overlay' (text after ', Text:'), 'Spelling' (typo fixes), 'Conflict Resolution' (remove conflicts), 'Directive' (user request not fitting other categories). NOTE: Only 'Spelling' and 'Text Overlay' can modify text after ', Text:' boundary"),
                segment_emphasis: z.number().min(-5).max(8).nullable().optional()
                    .describe("Emphasis Multiplier to apply to the replacement text. If set, The new text will be wrapped with a emphasis group safely (e.g., 2.4::text::). If the selected text segment was a group (e.g., alrady wrapped in emphasis groups) and this value is not defined, the previous emphasis value will be applied automatically."),
                append_after: z.union([z.string(), z.number().int().min(0)]).nullable().optional()
                    .describe("ADVANCED: For APPEND only - Insert text after a specific word or word position within the segment. Use string (e.g., 'happy') to append after that word, or number (e.g., 2) to append after the Nth word (0-indexed). Only use when you need granular insertion within a segment. Default behavior appends after the entire segment."),
                append_delimiter: createCaseInsensitiveEnum(['space', 'comma', 'none']).nullable().optional()
                    .describe("ADVANCED: For APPEND only - Delimiter to use before inserted text when append_after is set. 'space' adds a space, 'comma' adds a comma, 'none' adds nothing (for append_standalone='direct'). Only used with append_after."),
                append_standalone: createCaseInsensitiveEnum(['standalone', 'simple', 'direct']).nullable().optional()
                    .describe("ADVANCED: For APPEND only - How to handle spacing/punctuation: 'standalone' (tag in a list - auto-handles commas), 'simple' (word insertion - auto-adds space if needed), 'direct' (literal insertion - you control all spacing). Only used with append_after. Default: 'simple'"),
                replace_part: z.string().nullable().optional()
                    .describe("ADVANCED: For REPLACE only - Replace a specific part within the segment instead of the entire segment. Useful for spelling corrections or partial word replacements. Provide the exact text within the segment to replace. Only use when you need granular replacement without affecting the rest of the segment."),
                index: z.number().int().nullable().optional()
                    .describe("Current increment value for incrementing logic (used by server for state management)"),
                increment_data: z.string().max(64).nullable().optional()
                    .describe("Additional state data for incrementation (max 64 chars, used by server for state management)"),
                references: z.array(z.object({
                    type: createCaseInsensitiveEnum(['web_search', 'tag_search', 'tag_description', 'tokenizer', 'memory_retrieval'])
                        .describe("Reference type: web_search (web lookup), tag_search (tag database search), tag_description (tag description search), tokenizer (token analysis), memory_retrieval (memory retrieval)"),
                    query: z.string().nullable().optional()
                        .describe("Search query or description (for web_search, tag_search, tag_description)"),
                    url: z.string().nullable().optional()
                        .describe("URL (for web_search only)"),
                    tags: z.array(z.string()).nullable().optional()
                        .describe("Tag names found/used (for tag_search, tag_description)"),
                    description: z.string().nullable().optional()
                        .describe("Brief description of what was found or analyzed (for tag_description, tokenizer, memory_retrieval)")
                })).nullable().optional()
                    .describe("Optional array of research sources used for this replacement (for client-side display only)")
            })).describe("Find-and-replace operations for this character negative prompt")
        })).nullable().optional().describe("Array of find-and-replace operations for character prompts (one per character)")
        }).describe("MANDATORY structured find-and-replace operations - CRITICAL: Always use prompt array to add comprehensive weather descriptions"),
    errors: z.array(z.string()).nullable().optional()
        .describe("Array of error messages from directive processing (for client-side display)"),
    warnings: z.array(z.string()).nullable().optional()
        .describe("Array of warning messages from directive processing (for client-side display)"),
    insight_memory: z.array(z.object({
        name: z.string()
            .describe("Unique memory name (snake_case, e.g., 'water_droplet_physics_rendering'). Must be globally applicable, not context-specific. Will be automatically saved to global knowledge database."),
        description: z.string()
            .describe("Clear, self-contained description of what this memory contains and when to use it. Future AI won't have your current context."),
        category: createCaseInsensitiveEnum(["technique", "style", "anatomy", "effect", "composition", "lighting", "color_theory", "perspective", "material", "clothing", "character_design", "environment", "character_specific", "scenario_specific", "token_optimization", "tag_preference", "tag_wiki"])
            .describe("Memory category for organization and discovery"),
        entities: z.array(z.object({
            id: z.string()
                .describe("Unique entity ID within this memory (e.g., 'volumetric_fog_technique')"),
            type: createCaseInsensitiveEnum(["concept", "technique", "tag_combination", "visual_element", "principle", "character_trait", "dialog_pattern", "token_preference", "tag_preference", "scenario_approach"])
                .describe("Entity type"),
            name: z.string()
                .describe("Human-readable entity name"),
            attributes: z.record(z.any()).nullable().optional()
                .describe("Key-value attributes (e.g., {tags: ['volumetric lighting', 'atmosphere'], difficulty: 'moderate'})")
        }))
            .describe("Entities in the knowledge graph (concepts, techniques, tag combinations)"),
        relations: z.array(z.object({
            from: z.string()
                .describe("Source entity ID"),
            to: z.string()
                .describe("Target entity ID"),
            type: createCaseInsensitiveEnum(["enhances", "conflicts_with", "requires", "similar_to", "part_of", "enables"])
                .describe("Relationship type"),
            weight: z.number().min(0).max(1).nullable().optional()
                .describe("Relationship strength (0-1, default 1.0)")
        })).nullable().optional()
            .describe("Relationships between entities"),
        observations: z.array(z.object({
            entity_id: z.string()
                .describe("Entity this observation is about"),
            content: z.string()
                .describe("Specific observation, finding, or best practice"),
            importance: z.number().min(0).max(1).nullable().optional()
                .describe("Importance level (0-1, default 0.5)")
        })).nullable().optional()
            .describe("Specific observations about entities"),
        confidence: z.number().min(0).max(0.25).nullable().optional()
            .describe("Confidence increase for this memory update (0-0.25). New memories start at 10% and can gain up to 25% per refinement (capped at 100%). Provide the amount to add based on how much you refined/improved the memory. Default: 0.25 (maximum increase)")
    })).nullable().optional()
        .describe("Global knowledge memories that will be automatically saved to the shared knowledge database. ONLY include timeless, reusable knowledge - NEVER context-specific data (weather, time, character). These memories will be accessible to all future generations across all users. CONFIDENCE SYSTEM: New memories start at 10% confidence. Each refinement can increase confidence by up to 25% (capped at 100%). You should review and refine memories multiple times to increase their confidence level."),
    generated_image_name: z.string().min(3).max(100)
        .describe("Generate a name for the generated image. Should be descriptive, concise (3-100 chars), and capture the essence of the scene. Use natural readable format with proper capitalization (e.g., 'Rainy Evening Contemplation', 'Summer Beach Joy', 'Cozy Winter Reading'). Consider: main subject, setting, mood, time/weather if significant. Make it memorable and evocative. Do not use basic or generic terms"),
    character_names: hasPlaceholders
        ? z.array(z.string()).min(1)
            .describe("REQUIRED: Array of character names corresponding to character prompts. MUST replace generic names like 'Character #1', 'Character 1', etc. with contextually appropriate names. Consider cultural context, setting, and character traits. Use proper capitalization (e.g., ['Sakura', 'Emma', 'Alex']). Order must match character_prompts array order. Array must have at least one element when placeholder names are detected.")
        : z.array(z.string()).nullable().optional()
            .describe("Array of character names corresponding to character prompts. Replace generic names like 'Character #1', 'Character 1', etc. with contextually appropriate names. Consider cultural context, setting, and character traits. Use proper capitalization (e.g., ['Sakura', 'Emma', 'Alex']). Order must match character_prompts array order.")
    });
    
    const dialogItemSchema = z.object({
        type: createCaseInsensitiveEnum(["speech", "thought"])
            .describe("Type: 'speech' (spoken) or 'thought' (internal)"),
        text: z.string().min(1).max(200)
            .describe("Text (1-200 chars) in character's voice/tone"),
        top: z.number().min(5).max(95)
            .describe("Top position % (5-95)"),
        left: z.number().min(5).max(95)
            .describe("Left position % (5-95)"),
        alignment: createCaseInsensitiveEnum(["left", "right"])
            .describe("Alignment: 'left' or 'right'")
    }).strict();
    
    // Only validate dialogs when dialogs are explicitly enabled (dialogsCount > 0)
    // When dialogs are disabled, return empty schema so dialogs field is not validated/required
    const dialogsSchema = dialogsEnabled 
        ? z.object({ 
            dialogs: z.array(dialogItemSchema)
                .min(0)  // Allow empty array when terminateOnPass=true
                .max(dialogsCount)  // Max is the configured dialogsCount
                .describe(`${dialogsCount} dialogs (speech/thoughts). Required when terminateOnPass=true (can be []). Each dialog needs all required fields.`)
        }) 
        : z.object({});  // Empty schema - dialogs field is completely optional and not validated when disabled
    
    return baseSchema.and(dialogsSchema);
}

module.exports = {
    createDynamicGenerationResponseSchema,
    getZodSchemaKeyCount,
    hasPlaceholderCharacterNames
};

