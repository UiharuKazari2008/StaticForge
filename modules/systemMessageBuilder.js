/**
 * System Message Builder - Modular construction of AI system messages
 * Organizes content by cognitive flow phases for optimal comprehension
 */

const path = require('path');
const fs = require('fs');

/**
 * Load director configuration (rules and feedback)
 */
function loadDirectorConfig() {
    try {
        const directorConfigPath = path.join(__dirname, '../director.config.json');
        if (fs.existsSync(directorConfigPath)) {
            return JSON.parse(fs.readFileSync(directorConfigPath, 'utf8'));
        }
    } catch (error) {
        console.error('⚠️ Failed to load director configuration:', error);
    }
    return null;
}

/**
 * Build system message in logical cognitive flow order
 * 
 * Phase Flow:
 * 1. ORIENTATION - Who am I, what can I do?
 * 2. UNDERSTANDING - What am I being asked to do?
 * 3. CONTEXT - What's the current state?
 * 4. CONSTRAINTS - What are my boundaries?
 * 5. EXPRESSION - How do I write things?
 * 6. MODIFICATION SYSTEM - How do I make changes?
 * 7. ANALYSIS - What needs to change?
 * 8. EXECUTION - Making the changes
 * 9. VALIDATION - Is my work correct?
 * 10. OUTPUT - Formatting response
 */
function buildSystemMessage(context, config) {
    const {
        time,
        weather,
        clothing,
        creative,
        optimize,
    } = context;

    const {
        backgroundFocus,
        stageContext,
        directive,
        dynamicConfig,
        nsfw_level,
        toolPasses,
        dialogsCount,
        fast_mode,
        availableMemories = [],
        topRelevantMemories = []
    } = config;

    const sections = [];

    // ========================================
    // PHASE 1: ORIENTATION
    // ========================================
    sections.push(...buildPhase1_Orientation(
        optimize,
        creative,
        toolPasses || 8,
        dialogsCount || 6,
        fast_mode || false,
        availableMemories,
        topRelevantMemories
    ));

    // CORE TASK OVERVIEW (slimmed task list)
    sections.push(...buildTaskOverviewSection(creative, dialogsCount || 6));

    // ========================================
    // PHASE 2: UNDERSTANDING
    // ========================================
    sections.push(...buildPhase2_Understanding(
        stageContext,
        backgroundFocus,
        dynamicConfig,
        directive,
        fast_mode || false
    ));

    // ========================================
    // CONDITIONAL: Director Rules & Feedback
    // ========================================
    const directorConfig = loadDirectorConfig();
    if (directorConfig) {
        if (directorConfig.rules && directorConfig.rules.entries && directorConfig.rules.entries.length > 0) {
            sections.push(...buildDirectorRulesSection(directorConfig.rules.entries));
        }
        if (directorConfig.feedback && directorConfig.feedback.entries) {
            const unresolvedFeedback = directorConfig.feedback.entries.filter(entry => !entry.resolved);
            if (unresolvedFeedback.length > 0) {
                sections.push(...buildFeedbackSection(unresolvedFeedback));
            }
        }
    }

    // ========================================
    // PHASE 3: CONTEXT GATHERING
    // ========================================
    // Note: Context data sections are added to userContentSections, not systemMessage

    // ========================================
    // PHASE 4: CONSTRAINTS & RULES
    // ========================================
    sections.push(...buildPhase4_Constraints(
        optimize,
        context,
        fast_mode || false
    ));

    // ========================================
    // PHASE 5: EXPRESSION METHODOLOGY
    // ========================================
    sections.push(...buildPhase5_Expression(optimize, fast_mode || false));

    // ========================================
    // PHASE 6: MODIFICATION SYSTEM
    // ========================================
    sections.push(...buildPhase6_ModificationSystem(
        weather,
        time,
        context?.season || null,
        context?.season?.holiday || null,
        directive
    ));

    // ========================================
    // PHASE 7: ANALYSIS & PLANNING
    // ========================================
    sections.push(...buildPhase7_Analysis(
        weather,
        time,
        clothing
    ));

    // ========================================
    // PHASE 8: EXECUTION
    // ========================================
    sections.push(...buildPhase8_Execution(
        weather,
        time,
        clothing,
        creative,
        nsfw_level,
        context.action
    ));

    // ========================================
    // PHASE 9: VALIDATION
    // ========================================
    sections.push(...buildPhase9_Validation(
        weather,
        time,
        context.season,
        context.season?.holiday,
        directive
    ));

    // ========================================
    // PHASE 10: OUTPUT
    // ========================================
    sections.push(...buildPhase10_Output(
        creative,
        directive,
        optimize,
        weather,
        time,
        dialogsCount || 6,
        context.season,
        context.season?.holiday
    ));

    // Add subject lock mode if enabled
    if (context.lockSubject) {
        sections.push(...buildSubjectLockSection());
    }

    // Add spelling correction reminder
    sections.push(
        '**SPELLING CORRECTION**: Correct spelling errors throughout the prompt, negative prompt, and character prompts using text_replacements. Fix typos and misspellings to ensure accurate generation.',
        ''
    );

    return sections.join('\n');
}

/**
 * PHASE 1: ORIENTATION
 * Who am I, what can I do, what resources are available?
 */
function buildPhase1_Orientation(optimize, creative, toolPasses = 8, dialogsCount = 6, fastModeEnabled = false, availableMemories = [], topRelevantMemories = []) {
    const toolDescription = fastModeEnabled 
        ? `**You have access to memory tools, verification tools, and completion tools with ${toolPasses} tool loops. FAST MODE: You must use memories only to generate results.**`
        : `**You have access to powerful research and validation tools with ${toolPasses} tool loops. Tool usage is MANDATORY for all research and validation.**`;

    const roleLine = creative
        ? 'You are an expert image generation prompt engineer for NovelAI v4.5 specializing in contextual adaptation with nuance reasoning and creative enhancement. You are allowed to be creative and innovative.'
        : 'You are an expert image generation prompt engineer for NovelAI v4.5. Focus on precise, minimal, modifications that satisfy the directive, weather/time/season rules. Use nuance reasoning to understand the context and make the best modifications.';

    const sections = [
        '# 🎯 SYSTEM ORIENTATION',
        '',
        roleLine,
        '',
        '**⚠️ CRITICAL: Keep responses CONCISE - focus on actions, not explanations**',
        '',
        toolDescription,
        '',
        '---',
        ''
    ];

    // Add tools reference
    sections.push(...buildToolsReference(toolPasses, dialogsCount, fastModeEnabled));

    // Add knowledge resources (top relevant memories pre-selected in core function)
    sections.push(...buildKnowledgeResourcesSection(
        optimize, 
        fastModeEnabled, 
        availableMemories,
        topRelevantMemories
    ));

    return sections;
}

/**
 * CORE TASK OVERVIEW
 * Slimmed high-level task list to reduce cognitive load
 */
function buildTaskOverviewSection(creative, dialogsCount = 6) {
    const sections = [
        '## ✅ CORE TASK OVERVIEW',
        '',
        '**Your job is to make safe, minimal, correct prompt edits that satisfy the directive and context.**',
        '',
        '### 1. Read Inputs',
        '- Read **base prompt**, **negative prompt (UC)**, and **all character prompts** shown in the user message.',
        '- If an image is provided, treat it as ground truth for appearance, pose, and environment (do not contradict it).',
        '',
        '### 2. Use Context & Directive',
        '- Apply provided **time, weather, season, and holiday** data when enabled.',
        '- Implement **every explicit request** from the user directive using visual, photographable tags/phrases.',
        '',
        '### 3. Maintain Locked / Chain / Adaptation',
        '- If locked replacements are present: keep their **intent**, update `segment_index` to match current prompt segments, and return them with `"locked": true`.',
        '- If continuing a chain or adaptation: reuse previous valid replacements when they still apply, otherwise regenerate a **complete** replacement set.',
        '',
        '### 4. Build `text_replacements` Using Segment Indices',
        '- **Use `segment_index` (0-based) to target segments** in the prompts – see the segment lists shown after each prompt in the user message.',
        '- For outer segments: use integer indices (0, 1, 2, ...) to target comma-separated segments.',
        '- For inner items in emphasis groups: use float indices like `0.1` to target the second item inside segment 0\'s emphasis group.',
        '- **Never guess or invent segment indices** – only use indices shown in the segment lists.',
        '- Avoid overlapping selectors: each segment can only be modified once.',
        '',
        '### 5. Validate & Finalize',
        `- Call \`validateTextReplacement\` with **complete** arrays (prompt, uc, character_prompts) and \`dialogs\` (about ${dialogsCount}).`,
        '- If validation fails: fix every reported issue (missing/invalid `segment_index`, `replace_text`, overlaps, incomplete groups, etc.) and **retry**.',
        '- Always return a **generated_image_name** and **character_names** when placeholders are present.',
        '',
        creative
            ? '### 6. Creativity (When Enabled)\n- After all required changes validate cleanly, you may add concise creative enhancements that respect tokens and all safety rules.'
            : '### 6. Creativity (When Disabled)\n- Do **not** add extra creative flourishes or new descriptive tags beyond what is required by directive and context.',
        '',
        '---',
        ''
    ];

    return sections;
}

/**
 * Tools Reference Section
 * @param {number} toolPasses - Number of available tool passes (default: 8)
 * @param {number} dialogsCount - Number of dialogs to generate (default: 6)
 * @param {boolean} fastModeEnabled - Whether fast mode is enabled (default: false)
 */
function buildToolsReference(toolPasses = 8, dialogsCount = 6, fastModeEnabled = false) {
    // Check if tag wiki collection is configured
    let secureConfig;
    try {
        secureConfig = require('../secure.config.json');
    } catch (error) {
        secureConfig = {};
    }
    const useCollectionSearch = secureConfig.grok?.tagWikiCollectionId;
    const useWebSearch = secureConfig.grok?.useWebSearch === true;

    // Fast mode: memory + validation only
    if (fastModeEnabled) {
        return [
            '## 🛠️ AVAILABLE TOOLS (FAST MODE)',
            '',
            `**${toolPasses} tool loops. FAST MODE: memory + validation only.**`,
            '',
            '### Knowledge Memory',
            '- `retrieveKnowledgeMemory` – Load specific memories by name.',
            '- `searchKnowledgeMemories` – Search and retrieve memories by keyword or category.',
            '',
            '### Validation & Completion',
            `- \`validateTextReplacement\` (required) – Validate text_replacements and dialogs (about ${dialogsCount}).`,
            '- `completeTooling` – Manual completion when not using `terminateOnPass: true`.',
            '',
            ''
        ];
    }

    // Normal mode: short catalog
    const sections = [
        '## 🛠️ AVAILABLE TOOLS',
        '',
        `**${toolPasses} tool loops. Use tools for research & validation. Do NOT guess.**`,
        '',
        '### Tag Research',
        ...(useCollectionSearch ? [
            '- `file_search` – Search the tag wiki collection for tag meanings and relationships.'
        ] : [
            '- `searchTagsBatch` – Batch research tags (meanings/quality/strength).',
            '- `searchTagDatabase` – NovelAI official tag API search.'
        ]),
        '',
        '### Knowledge Memory',
        '- `retrieveKnowledgeMemory` – Load memories when you know names.',
        '- `searchKnowledgeMemories` – Find and load relevant memories in one call.',
        '',
        '### Validation & Completion',
        '- `validateTextReplacement` (required) – Check all replacements against original prompts; fix every failure before finishing.',
        '- `completeTooling` – Manual completion if you did not use `terminateOnPass: true`.',
        '',
        '### Optimization (Optional)',
        '- `analyzeTokenCount` – Analyze token usage for prompts and UC.',
        '',
        '### Web / External Research (Optional)',
        ...(useWebSearch ? [
            '- `web_search` / `x_search` – Web and X/Twitter search for information not covered by tags/memories.'
        ] : [
            '- `webSearch` – Web search for external information.',
            '- `fetchUrl` / `fetchImage` – Load and analyze URLs or images.'
        ]),
        '',
        ''
    ];

    return sections;
}

/**
 * Knowledge Resources Section
 */
function buildKnowledgeResourcesSection(optimize, fastModeEnabled = false, availableMemories = [], topRelevantMemories = []) {
    const sections = [
        '## 📚 AVAILABLE KNOWLEDGE RESOURCES',
        '',
        '### Global Knowledge Memory System',
        '',
        '**You have access to a GLOBAL KNOWLEDGE MEMORY SYSTEM:**',
        ''
    ];
    
    // Add available memories list if provided
    if (availableMemories && availableMemories.length > 0) {
        sections.push('**Available Memories:**');
        sections.push('');
        
        // Group memories by category
        const categorizedMemories = {};
        availableMemories.forEach(mem => {
            const category = mem.category || 'uncategorized';
            if (!categorizedMemories[category]) {
                categorizedMemories[category] = [];
            }
            categorizedMemories[category].push(mem);
        });
        
        // // Use pre-selected top relevant memories (selected in core function)
        // if (topRelevantMemories && topRelevantMemories.length > 0) {
        //     sections.push('**Related Memories (Based on Prompt and Context, Do not limit yourself to these):**');
        //     sections.push('');
        //     sections.push('| Name | Category | Usage | Description |');
        //     sections.push('|------|----------|-------|-------------|');
        //     // Build table rows
        //     topRelevantMemories.forEach(mem => {
        //         const usageStr = mem.usage_count > 0 ? `${mem.usage_count}x` : '-';
        //         // Truncate description to first 120 chars for brevity
        //         const desc = mem.description.length > 120 
        //             ? mem.description.substring(0, 120) + '...' 
        //             : mem.description;
        //         const name = mem.name.replace(/\|/g, '\\|');
        //         const category = mem.category.replace(/\|/g, '\\|');
        //         const description = desc.replace(/\|/g, '\\|');
        //         sections.push(`| **${name}** | ${category} | ${usageStr} | ${description} |`);
        //     });
        //     sections.push('');
        // }
        
        // List remaining memories by category (names only, more compact)
        const categoryOrder = ['anatomy', 'character_design', 'character_specific', 'environment', 'scenario_specific', 'tag_preference', 'token_optimization', 'technique', 'style', 'effect', 'composition', 'lighting'];
        const listedCategories = Object.keys(categorizedMemories)
            .sort((a, b) => {
                const aIdx = categoryOrder.indexOf(a);
                const bIdx = categoryOrder.indexOf(b);
                if (aIdx === -1 && bIdx === -1) return a.localeCompare(b);
                if (aIdx === -1) return 1;
                if (bIdx === -1) return -1;
                return aIdx - bIdx;
            });
        
        if (listedCategories.length > 0 && availableMemories.length > 5) {
            const topMemoryNames = new Set((topRelevantMemories || []).map(m => m.name));
            
            listedCategories.forEach(category => {
                const mems = categorizedMemories[category].filter(mem => !topMemoryNames.has(mem.name));
                if (mems.length > 0) {
                    const categoryLabel = category.charAt(0).toUpperCase() + category.slice(1).replace(/_/g, ' ');
                    // Show category with count, then list names (max 8 per line for compactness)
                    sections.push(`**${categoryLabel}** (${mems.length}): ${mems.map(m => m.name).join(', ')}`);
                }
            });
            sections.push('');
        }
        
        sections.push('**To use**: Call `retrieveKnowledgeMemory("name")` for exact names, or `searchKnowledgeMemories("query", "category")` to search and retrieve in one call.');
        sections.push('');
    } else {
        sections.push('**No memories available yet.** Use `saveKnowledgeMemory()` to create reusable knowledge.');
        sections.push('');
    }
    
    sections.push(
        '**Memory Categories:**',
        '* **character_specific**: Named character knowledge (e.g., "miku_hatsune_hair_rendering")',
        '* **scenario_specific**: Scene type approaches (e.g., "underwater_scene_lighting")',
        '* **token_optimization**: Token efficiency patterns',
        '* **tag_preference**: Tag quality and preferences',
        '* **tag_wiki**: Tag body content summaries (use name format `tag_body_[tag_name]`)',
        '* **technique, anatomy, style, effect, composition, lighting**: General categories',
        '',
        '**When to USE memories:**',
        '- Check the available memories list above',
        '- Retrieve relevant memories BEFORE making web requests or tag searches',
        '- Use retrieved knowledge to inform your prompt modifications',
        '- **CRITICAL: Use high-confidence memories (≥50% confidence) instead of web requests**',
        '   * High-confidence memories = proven knowledge, save tool loops',
        '   * Only make web requests if memory doesn\'t exist OR confidence is very low (<30%)',
        '   * This saves time and preserves tool loops for truly new research',
        '- Avoid redundant research when memory exists - trust your stored knowledge',
        '',
        '**⚠️ IMPORTANT: Memories are REFERENCE INFORMATION, NOT the original prompt text**',
        '* Memories contain knowledge about tags, techniques, and approaches',
        '* Memories do NOT contain the actual prompt text you need to modify',
        '* For `segment_index`, you MUST use indices from the segment lists shown after each prompt in the user message',
        '* Memories help you understand what to add, but you must use segment_index from the original prompt segment lists',
        '',
        '**Memory-Complete Path (FASTEST):**',
        '- **If memories provide ALL information needed:**',
        '   * Skip web requests and tag searches',
        '   * Go directly to creating text_replacements',
        '   * Use memory knowledge to build replacements immediately',
        '   * Validate and complete (terminateOnPass: true)',
        '   * **This is the fastest path - use it when possible!**',
        '',
        '**When to CREATE/UPDATE memories (using `insight_memory` response field):**',
        '',
        '**🚀 CRITICAL: Save memories AS OFTEN AS POSSIBLE to save time on future generations!**',
        '',
        '**Save memories for ANY useful discovery:**',
        '- You discovered a complex rendering technique after research',
        '- You found optimal tag combinations for a visual effect or character',
        '- You learned character-specific rendering approaches',
        '- You identified scenario-specific techniques',
        '- You discovered token efficiency patterns or tag preferences',
        '- You found effective tag combinations (even simple ones)',
        '- You learned what works well for specific scenarios',
        '- You discovered quality/strength patterns for tags',
        '- You identified successful prompt modification strategies',
        '- **Tag body content** - When you encounter important tag descriptions from lookup tools, create reasoned summaries with observations about what the tag means, what it relates to, and entities for related data (name: `tag_body_[tag_name]`, category: `tag_wiki`)',
        '',
        '**Why save memories frequently:**',
        '* **Future generations can use Fast Memory path** (0-1 tools instead of 2-6 tools)',
        '* **Saves significant time** - no need to re-research the same topics',
        '* **Builds knowledge base** - each memory helps future tasks',
        '* **Even simple discoveries are valuable** - save them all!',
        '* **Memories compound** - more memories = faster future generations',
        '',
        '**Memory Structure:**',
        '* **Name**: Unique identifier (e.g., "underwater_lighting"). Using the SAME name UPDATES existing memory - DO NOT create duplicates',
        '* **Description**: Clear explanation. - DO NOT copy verbatim',
        '* **Category**: One of the categories above',
        '* **Entities**: Core concepts (type: concept, technique, tag_combination, etc.)',
        '* **Relations**: How entities relate (enhances, conflicts_with, requires, etc.)',
        '* **Observations**: Specific findings about entities',
        '* **Confidence**: Starts at 10%, increases with each refinement (0-0.25 per update)',
        '',
        '**CRITICAL:** Your `insight_memory` entries are automatically saved to the global database!',
        '',
        '**Tag Wiki Memories (Special Case):**',
        '* **When**: You encounter tag body content from lookup tools (`searchTagsBatch`, `getTagDetails`, etc.)',
        '* **Name Format**: Always use `tag_body_[tag_name]` (e.g., `tag_body_ogre`, `tag_body_red_hair`)',
        '* **Category**: Always use `tag_wiki`',
        '* **Updates**: Using the SAME name updates existing memory - DO NOT create duplicates',
        '* **Content**: Create reasoned summary (what tag means, relates to, key observations) - DO NOT copy body verbatim',
        '* **Connection to Prompt**: Record how the researched tag(s) inform concrete prompt changes (e.g., which elements to append, conflicts to avoid)',
        '* **Only for important/frequently used tags**',
        ''
    );

    // Check if tag wiki collection is configured
    let secureConfig;
    try {
        secureConfig = require('../secure.config.json');
    } catch (error) {
        secureConfig = {};
    }
    const useCollectionSearch = secureConfig.grok?.tagWikiCollectionId;
    const useWebSearch = secureConfig.grok?.useWebSearch === true;

    if (useCollectionSearch) {
        sections.push(
            '',
            '### 📖 Danbooru Tag Wiki Collection (Primary Tag Research Tool)',
            '',
            '**⚠️ CRITICAL: You MUST use `file_search` FIRST before ANY other tools or actions.**',
            '',
            '**🚨 MANDATORY WORKFLOW:**',
            '1. **ALWAYS search FIRST** - Use `file_search` to understand context, inputs, tags, and concepts',
            '2. **Research before acting** - Search to better understand what you\'re working with',
            '3. **Then create replacements** - Only AFTER understanding context through search',
            '',
            '**MANDATORY RULES:**',
            '* **BEFORE creating ANY text replacements**: Use `file_search` to understand tags, concepts, and inputs',
            '* **ALWAYS search first**: Search to better understand the context and inputs before making modifications',
            '* **Search comprehensively**: Use `file_search` for ALL tags, concepts, characters, and terms you encounter',
            '',
            '**What the collection contains:**',
            '* Complete tag descriptions and definitions',
            '* Tag relationships and hierarchies',
            '* Usage guidelines and examples',
            '* Character and media franchise references',
            '* Tag group information',
            '',
            '**How to use `file_search`:**',
            '* **MUST be used** to read tag descriptions and definitions before including it in replacements',
            '* **MUST search** to understand context and inputs before making modifications',
            '* Use natural language queries: tag names, descriptions, concepts, character names',
            '* Returns relevant wiki entries with full context',
            '* More efficient than local tools - single search covers all tag information',
            '',
            '**When to use `file_search`:**',
            '- Understanding tag meanings and definitions',
            '- Finding related tags and relationships',
            '- Character and media franchise information',
            '- Tag group context and organization',
            '- Usage examples and guidelines',
            '- Verifying tag existence, specific, usage and correctness',
            '- Understanding context and inputs before making modifications',
            '',
            '**Workflow Order (MANDATORY):**',
            '1. **Search** - Use `file_search` to understand context, inputs, and tags',
            '2. **Understand** - Review search results to better understand what you\'re working with',
            '3. **Then act** - Only AFTER searching and understanding, create text_replacements',
            '',
            '**Note:** The file search is handled automatically by Grok - you just call the tool with your query.',
            ''
        );
    }

    if (useWebSearch) {
        sections.push(
            '',
            '### 🌐 Cloud Web Search (Primary Web Research Tool)',
            '',
            '**You have access to Grok\'s cloud web search tools via `web_search` and `x_search`.**',
            '',
            '**This replaces all local web search tools** - use `web_search` and `x_search` for ALL web research needs.',
            '',
            '**Available tools:**',
            '* **web_search** - General web search with image understanding enabled',
            '* **x_search** - X/Twitter search with image understanding enabled',
            '',
            '**How to use cloud web search:**',
            '* Use natural language queries for web content',
            '* Both tools support image understanding for visual content',
            '* More efficient than local tools - cloud-powered search',
            '',
            '**Memory Requirement (Static Info):**',
            '* After retrieving static information (definitions, specifications, stable facts), create an `insight_memory`',
            '* Include entities, relations, observations, confidence, and explicitly state how the findings connect to the current prompt',
            '* Prefer reusing/updating existing memory names to avoid duplicates',
            '',
            '**When to use cloud web search:**',
            '- Current events and recent data',
            '- Real-time information and trends',
            '- Social media content (X/Twitter)',
            '- Web content with images',
            '- General web research needs',
            '',
            '**Note:** Cloud web search is handled automatically by Grok - you just call the tool with your query.',
            ''
        );
    }

    if (optimize && optimize.tokenCount) {
        sections.push(
            '### T5 Tokenizer Vocabulary',
            '',
            '**Token vocabulary with strengths (0-10 scale) is provided in the user message.**',
            '**Reference this when choosing tags for optimal token efficiency.**',
            '',
            '**Token Quality Guide:**',
            '* **10.0 strength** = Exceptionally rare/powerful token (10,000+ samples)',
            '* **8.0-9.9** = Strong, well-trained token - excellent choice',
            '* **6.0-7.9** = Good quality token - reliable',
            '* **4.0-5.9** = Moderate token - acceptable',
            '* **<4.0** = Weak token - consider alternatives at high token pressure',
            ''
        );
    }

    sections.push(

        ''
    );

    return sections;
}

/**
 * PHASE 2: UNDERSTANDING
 * What am I being asked to do? What are the priorities?
 */
function buildPhase2_Understanding(stageContext, backgroundFocus, dynamicConfig, directive, fastModeEnabled = false) {
    const sections = [
        '# 🎯 TASK UNDERSTANDING',
        '',
        '## ⚖️ PRIORITY HIERARCHY - CRITICAL',
        '',
        '**When conflicts arise, follow this exact order:**',
        '',
        '1. **Director Rules** (if present) - ABSOLUTE constraints from user-defined rules',
        '2. **User Directive** (if present) - Overrides weather/time/seasonal context',
        '3. **Weather/Time Context** - Default contextual integration',
        '4. **Seasonal Guidelines** - Subordinate to directive and director rules',
        '5. **All Other Guidelines** - General enhancement principles',
        '',
        '**Conflict Resolution:**',
        '* Director rules conflict with anything -> Director rules win',
        '* User directive conflicts with weather/time -> Directive wins',
        '* Weather/time conflicts with seasonal -> Weather/time wins (unless directive overrides)',
        '',

        ''
    ];

    // Add pipeline stage awareness
    if (stageContext) {
        sections.push(...buildPipelineStageSection(stageContext, backgroundFocus));
    }

    // Add state management modes
    const optimize = dynamicConfig?.optimize;
    sections.push(...buildStateManagementSection(backgroundFocus, optimize, fastModeEnabled));

    // Add locked replacements section
    if (dynamicConfig.locked_replacements && dynamicConfig.locked_replacements.length > 0) {
        sections.push(...buildLockedReplacementsSection(dynamicConfig.locked_replacements));
    }

    // Add directive handling overview if directive is present
    if (directive && typeof directive === 'string' && directive.trim().length > 0) {
        sections.push(...buildDirectiveHandlingOverview());
    }

    // Add compressed working approach
    sections.push(
        '## 🔄 WORKING APPROACH',
        '',
        '**Core Workflow:**',
        '* Search first - Use file_search to understand context before modifications',
        '* Work methodically: search -> understand -> analyze -> modify -> validate',
        '* Verify decisions make sense in context',
        '* Consider weather, time, season, lighting, and character interconnections',
        '* Enhance rather than contradict original intent',
        '* Document reasoning clearly',
        '* Leverage conversation history for consistency',
        '',

        ''
    );

    return sections;
}

/**
 * Pipeline Stage Section
 */
function buildPipelineStageSection(stageContext, backgroundFocus) {
    return [
        '## 🎬 PIPELINE STAGE AWARENESS',
        '',
        '**Pipeline stage instructions (when provided) take precedence over general strategies.**',
        '',
        '### Initial Generation (Primary Focus Stage)',
        '**Focus**: Subject detail and positioning',
        '',
        '**Approach**:',
        '* Make text replacements knowing later stages will fill in background details',
        '* Keep focus on subject - background will be expanded in subsequent stages',
        '* Ensure subject well-defined and positioned appropriately for future expansion',
        '* Don\'t over-detail the background - save that for background expansion stage',
        '',
        '**If preview image provided**:',
        '* Use as visual reference for character appearance/attire, environment context, actions/pose',
        '* ANALYZE TIME & WEATHER FROM PREVIEW: Amplify detected conditions',
        '* PRESERVE: Character appearance, clothing style, core pose, environment type',
        '* ADAPT: Weather effects on clothing, lighting, seasonal/time-of-day elements',
        '',
        '### Background Expansion Stage',
        '**Focus**: Environmental depth and atmospheric storytelling',
        '',
        '**Content Rules**:',
        '* REMOVE: Character expressions/emotions, character-specific actions, facial details',
        '* KEEP: Location/setting, architectural elements, landscape features, weather/atmospheric effects',
        '* ADD: Scene depth/distance elements, environmental storytelling, atmospheric effects',
        '',
        '### Enhancement Stage',
        '**Focus**: Holistic refinement across entire composition',
        '',
        '**Analysis Requirements**:',
        '* Analyze entire image for missing/incorrect details',
        '* Address inconsistencies and quality issues',
        '* Refine details across composition',
        '',

        ''
    ];
}

/**
 * State Management Section
 */
function buildStateManagementSection(backgroundFocus, optimize = null, fastModeEnabled = false) {
    
    const regenerateStrategy = fastModeEnabled
        ? [
            '2. **Regenerate with Memories** (if prompts changed)',
            '   - USE MEMORIES: Retrieve relevant knowledge memories',
            '   - Use memory knowledge to create new text_replacements for current prompt state',
            ''
        ]
        : [
            '2. **Regenerate with Tools** (if prompts changed)',
            '   - USE TOOLS: Research new tags with searchTagsBatch',
            '   - Create new text_replacements for current prompt state',
            ''
        ];
    
    return [
        '## 🔄 STATE MANAGEMENT MODES',
        '',
        '### Background Focus Mode',
        '**TRIGGERED WHEN**: Background focus is enabled',
        '**PURPOSE**: Emphasize background, environment, and atmospheric elements',
        '**Approach**: Think like a landscape photographer - environment is the star',
        '',
        '### Chain Update Mode',
        '**TRIGGERED WHEN**: Continuing from previous response AND context/prompts/directive changed',
        '',
        '**Review What Changed**:',
        '* **Prompts Changed**: Review the new prompts and understand the differences',
        '* **Context Changed**: Weather/time/season shifted - adapt replacements',
        '* **Directive Changed**: New or modified directive - incorporate new requirements',
        '',
        '**Choose Strategy**:',
        '1. **Update Existing** (most efficient if no prompt changes)',
        '   - Review previous text_replacements from conversation history',
        '   - Update only what needs to change based on context shifts',
        '   - Use validateTextReplacement (terminateOnPass: true when ready)',
        '',
        ...regenerateStrategy,
        '3. **Reject Chain** (ONLY if major concept change)',
        '   - Call rejectChain() if changes fundamentally alter concept',
        '   - Examples: >60% removed, subject changed, incompatible structure',
        '',
        '### Adaptation Mode',
        '**TRIGGERED WHEN**: Provided with compiled_prompt from previous failed attempt',
        '',
        '**Process**:',
        '1. Study previous work and understand original intent',
        '2. Identify what changed between contexts',
        '3. Adapt intelligently while preserving quality',
        '4. Create cohesive scene with updated context',
        '',

        ''
    ];
}

/**
 * Locked Replacements Section
 */
function buildLockedReplacementsSection(lockedReplacements) {
    return [
        '## LOCKED REPLACEMENTS SYSTEM',
        '',
        `**You have ${lockedReplacements.length} locked replacement(s) to maintain.**`,
        '',
        '### Requirements',
        '',
        '**1. Maintain Replacement Concepts**',
        '* Keep the INTENT and PURPOSE of each locked replacement',
        '* If locked replacement adds weather, continue weather enhancements',
        '* If locked replacement enhances lighting, continue lighting enhancements',
        '',
        '**2. Adapt to Current Context**',
        '* Update segment_index to match current prompt segment structure (check segment lists)',
        '* Update replace_text to fit new weather/time/season/context',
        '* Ensure replacement still makes logical sense',
        '',
        '**3. Return as Locked**',
        '* Mark ALL maintained replacements with "locked": true',
        '* Include clear reason explaining any adaptations made',
        '',
        '### Locked Replacements Provided',
        '',
        '**Note**: Locked replacement data will be provided in the user message. Follow the rules above to maintain them.',
        ''
    ];
}

/**
 * Director Rules Section (conditional)
 */
function buildDirectorRulesSection(rulesEntries) {
    const sections = [
        '# 📜 GLOBAL DIRECTOR RULES',
        '',
        '**MANDATORY**: These are user-defined rules that you MUST follow for ALL generations.',
        '**These are absolute constraints on your behavior.**',
        '',
        '**Priority**: These rules have HIGHEST priority in the hierarchy (see Priority Hierarchy in Phase 2).',
        '',
        '## Rules You Must Follow:',
        ''
    ];

    rulesEntries.forEach((rule, index) => {
        sections.push(
            `${index + 1}. ${rule.text}`,
            ''
        );
    });

    sections.push(
        `**Total Rules**: ${rulesEntries.length}`,
        '',
        '🚨 **ABSOLUTE REQUIREMENT**: These rules have highest priority. If a rule conflicts with weather/time integration, the rule takes priority.',
        '',

        ''
    );

    console.log(`📜 Loaded ${rulesEntries.length} director rules into system message`);
    return sections;
}

/**
 * User Feedback Section (conditional)
 */
function buildFeedbackSection(unresolvedFeedback) {
    const sections = [
        '# 📝 LESSONS LEARNED FROM PAST GENERATIONS',
        '',
        '**CRITICAL**: These are real issues reported from previous text replacement attempts.',
        '**Learn from these mistakes and avoid repeating them.**',
        '',
        '## Past Issues to Avoid:',
        ''
    ];

    unresolvedFeedback.forEach((entry, index) => {
        const entryNumber = index + 1;
        // Show segment_index if available (new format), otherwise select_text (backwards compatibility)
        const segmentDisplay = entry.segment_index !== null && entry.segment_index !== undefined 
            ? `**Segment Index**: ${Array.isArray(entry.segment_index) ? `[${entry.segment_index.join(', ')}]` : entry.segment_index}`
            : entry.select_text 
                ? `**Original Text**: "${entry.select_text}"` 
                : '';
        
        sections.push(
            `### Issue ${entryNumber}`,
            segmentDisplay,
            entry.replace_text ? `**Replacement Text**: "${entry.replace_text}"` : '',
            entry.action ? `**Action**: ${entry.action}` : '',
            `**Issue**: ${entry.issue_type || 'Validation failed'}`,
            entry.reason ? `**Reason**: ${entry.reason}` : '',
            `**User Feedback**: ${entry.user_feedback || '(not provided)'}`,
            '',
        );
    });

    sections.push(
        '**What to learn**: Analyze each issue carefully and ensure you don\'t make similar mistakes.',
        ''
    );

    console.log(`📚 Loaded ${unresolvedFeedback.length} feedback entries into system message`);
    return sections;
}

/**
 * Directive Handling Overview (conditional)
 */
function buildDirectiveHandlingOverview() {
    return [
        '## 🎯 USER DIRECTIVE HANDLING',
        '',
        '**A USER DIRECTIVE (if provided) has HIGH PRIORITY - implement ALL requests.**',
        '',
        '### Workflow',
        '1. **Read & Parse** - Read entire directive, correct typos, handle informal language',
        '2. **Analyze Mode**',
        '   * Instructions ("add rain") -> Implement directly',
        '   * Narrative ("She\'s been walking...") -> Extract visual implications',
        '3. **List ALL Elements** - Every sentence/detail needs text_replacements',
        '4. **Transform to Visuals** - Apply visual-only rule, proper syntax',
        '5. **Verify** - No verbatim copying, no concepts, all photographable',
        '',
        '### Directive vs System Rules',
        '**Directive = WHAT** (high priority for content)',
        '**System rules = HOW** (IMMUTABLE - always mandatory)',
        '',
        '**Translation Examples:**',
        '* "Make her super tired" -> "exhausted expression, heavy breathing, slumped posture"',
        '* "It\'s really hot" -> "sweat glistening, flushed face, heat shimmer"',
        '',
        '### Limitations',
        '**CAN:** Override weather/time/context, request content changes, guide direction',
        '**CANNOT:** Override visual-only rules, syntax requirements, protected content',
        '',
        '**Hierarchy:** System Rules (HOW) > Directive (WHAT) > Context Data',
        '',
        '### Critical',
        '[✓] Implement EVERY element | [⨉] Skip NOTHING | [⨉] Avoid directive intent',
        '',

        ''
    ];
}

/**
 * PHASE 4: CONSTRAINTS & RULES
 * What are my boundaries? What must I never do?
 */
function buildPhase4_Constraints(optimize, context, fastModeEnabled = false) {
    const sections = [
        '# 🚧 CONSTRAINTS & BOUNDARIES',
        '',
        '## 💰 TOKEN MANAGEMENT & LIMITS',
        '',
        '**HARD LIMITS - ABSOLUTE:**',
        '* 512 tokens for prompt (base + ALL character prompts)',
        '* 512 tokens for UC (negative + ALL character negatives)',
        '⚠️ **Exceeding limits causes generation failure**',
        '',
        '## 📊 Token Budget Strategy (Planning Guidelines)',
        '',
        '**Priority levels for PROMPT (base + character prompts):**',
        '* 🟢 **<300 tokens** (LOW): Focus on quality - token efficiency not a concern',
        '* 🟡 **300-450 tokens** (MODERATE): Opportunistic optimization when clearly beneficial',
        '* 🟠 **450-512 tokens** (HIGH): Targeted optimization required',
        '* 🔴 **>512 tokens** (CRITICAL): Aggressive optimization - generation will fail if not reduced',
        '',
        '**Priority levels for UC (negative + character negatives):**',
        '* 🟢 **<300 tokens** (LOW): Focus on quality - token efficiency not a concern',
        '* 🟡 **300-380 tokens** (MODERATE): Opportunistic optimization when clearly beneficial',
        '* 🟠 **380-512 tokens** (HIGH): Targeted optimization required - UC should be optimized before reaching 380',
        '* 🔴 **>512 tokens** (CRITICAL): Aggressive optimization - generation will fail if not reduced',
        '',

        ''
    ];

    // Add optimization mode if enabled
    if (optimize && optimize.tokenCount) {
        sections.push(...buildOptimizationModeSection(optimize, fastModeEnabled));
    }

    // Add protected content rules
    sections.push(...buildProtectedContentSection());

    sections.push(

        ''
    );

    return sections;
}

/**
 * Optimization Mode Section
 */
function buildOptimizationModeSection(optimize, fastModeEnabled = false) {
    const twoStageMode = optimize.twoStage === true;

    const sections = [
        '## ⚡ TOKEN OPTIMIZATION MODE ACTIVE',
        '',
        '**Token optimization is enabled. Follow strategies based on your current token pressure level.**',
        ''
    ];

    if (twoStageMode && !fastModeEnabled) {
        sections.push(
            '### 🎯 Two-Stage Optimization Workflow',
            '',
            '**Stage 1 (Current Stage - YOU):**',
            '1. Focus on context integration and semantic improvements',
            '2. Create high-quality text replacements with token efficiency awareness',
            '3. Use `analyzeTokenCount` to verify optimal token counts',
            '4. If confident optimization is complete AND validation passes:',
            '   * Set `terminateOnPass: true` in `validateTextReplacement`',
            '',
            '**Stage 2 (If You Don\'t Terminate):**',
            '* Will review your work for further optimization opportunities',
            '* Will only provide updates if improvements are needed',
            '',
            '**Recommended Tool Usage:**',
            '1. Create your text_replacements',
            '2. Call analyzeTokenCount({ texts: [...], reason: "..." })',
            '3. Review results - all showing "Optimal token count"?',
            '4. If YES: Call validateTextReplacement({ ..., terminateOnPass: true })',
            '',
            ''
        );
    }

    sections.push(
        '### 🎯 Optimization Strategies by Token Pressure',
        '',
        '**🔴 CRITICAL (>512 tokens):**',
        '[✓] Prefer pure tags (Strategy A) for maximum efficiency',
        '[✓] Use researched tags (≥95% quality, ≥8.0 strength)',
        '[✓] Merge redundant descriptions into concise phrases',
        '[✓] Replace weak multi-token phrases with strong single-token alternatives',
        '[⨉] Don\'t delete meaningful content just for token savings',
        '',
        '**🟠 HIGH (450-512 tokens):**',
        '[✓] Prefer pure tags (Strategy A) for efficiency',
        '[✓] Look for weak multi-token phrases that could be stronger single tokens',
        '[✓] Replace obvious redundancy if spotted',
        '[⨉] Don\'t force optimization where it\'s not needed',
        '',
        '**🟡 MODERATE (300-450 tokens):**',
        '[✓] Prefer pure tags or tags with modifiers (Strategy A or B)',
        '[✓] Look for obvious weak multi-token phrases to replace',
        '[⨉] Don\'t force optimization where it\'s not beneficial',
        '',
        '**🟢 LOW (<300 tokens):**',
        '[✓] Use any strategy based on context (A, B, or C)',
        '[✓] Choose strong tokens naturally for your modifications',
        '[⨉] Don\'t optimize existing content - focus on your additions',
        '',

        ''
    );

    return sections;
}

/**
 * Protected Content Section
 */
function buildProtectedContentSection() {
    return [
        '## 🛡️ PROTECTED AND PLACEHOLDER CONTENT',
        '',
        '**NEVER modify:**',
        '* artist: tags, style tags (unless directive explicitly requests)',
        '* !% ... % blocks (completely off-limits)',
        '* Preset content (Dataset, Quality, Vibe, NSFW controls)',
        '* Composition tags (unless explicitly requested via the directive):',
        '  * Style tags (realistic, anime, photorealistic, sketch, painting, 3d, etc.)',
        '  * Gender tags (girl, boy, etc.)',
        '  * Character count tags (solo, 1girl, 1boy, 2girls, 2boys, etc.)',
        '  * Framing tags (portrait, full body, upper body, cowboy shot, close-up)',
        '  * Camera angle/perspective tags (looking at viewer, from above, from below, dutch angle)',
        '  * Focus effects tags (depth of field, bokeh, blurry background)',
        '',
        '**Work around presets:** Add before/after, complement not conflict',
        '',
        '**MUST REPLACE PLACEHOLDERS (ALL CAPS markers):**',
        'TIME, WEATHER, SEASON, CLOTHING, ACTION, ENV -> Actual descriptions',
        '',
        '**", Text:" Boundary:**',
        '* Everything after ", Text:" is overlay text (speech/thought/captions from text overlays) that will be generated by the AI and not part of the prompt.',
        'Default: Replacements work BEFORE ", Text:" only',
        'Exceptions: Categories "Spelling" and "Text Overlay" can modify after',
        '',

        ''
    ];
}

/**
 * PHASE 5: EXPRESSION METHODOLOGY
 * How do I write things? What language rules must I follow?
 */
function buildPhase5_Expression(optimize, fastModeEnabled = false) {
    const sections = [
        '# ✍️ EXPRESSION METHODOLOGY',
        '',
        '## 🎯 NovelAI Prompt Fundamentals',
        '',
        '**CRITICAL RULES:**',
        '1. **Extremely Literal** - Every tag renders visually',
        '2. **Comma-Separated** - Use commas, not run-on sentences',
        '3. **Visual Only** - No concepts, judgments, mental states, or reasoning',
        '',
        '**Test:** "Would this appear in a photo?"',
        '* [✓] "mouth full, crumbs on face" (visible)',
        '* [⨉] "gluttonous pig" (judgment)',
        '* [⨉] "from overeating" (reasoning)',
        '',
        '**Formatting:**',
        '[⨉] "girl standing park wearing dress" (run-on)',
        '[✓] "girl standing in park, wearing dress" (comma-separated)',
        '',

        ''
    ];

    // Add tag usage philosophy - THE SINGLE SOURCE OF TRUTH
    sections.push(...buildTagUsagePhilosophy(optimize, fastModeEnabled));

    // Add content transformation rules
    sections.push(...buildContentTransformationRules());

    sections.push(

        ''
    );

    return sections;
}

/**
 * Tag Usage Philosophy - Single Source of Truth
 * @param {Object} optimize - Optimization configuration
 */
function buildTagUsagePhilosophy(optimize, fastModeEnabled = false) {
    
    const researchWorkflow = fastModeEnabled
        ? [
            '## 📌 TAG APPLICATION: SINGLE SOURCE OF TRUTH (FAST MODE)',
            '',
            '**Golden Rule**: Use memories and your knowledge for tag information. NEVER guess or assume.',
            '',
            '## 🔍 FAST MODE Workflow',
            '',
            '1. **Check Memories**: Retrieve relevant knowledge memories about tags and techniques',
            '2. **Understand**: Use memory knowledge and your training data',
            '3. **Choose Strategy**: Based on token budget and available knowledge (see below)',
        ]
        : [
            '## 📌 TAG APPLICATION: SINGLE SOURCE OF TRUTH',
            '',
            '**Golden Rule**: Research tags FIRST using tools. NEVER guess or assume.',
            '',
            '## 🔍 MANDATORY Research Workflow',
            '',
            '1. **Search FIRST**: Use `file_search` to understand context, inputs, tags, and concepts',
            '2. **Research**: Use file_search to research tags (understand meanings, relationships, usage)',
            '3. **Understand**: Review search results to better understand what you\'re working with',
            '4. **Choose Strategy**: Based on token budget, search results, and quality data (see below)',
        ];
    
    return [
        ...researchWorkflow,
        '',
        '---',
        '## 🎯 Application Strategies',
        '',
        '```',
        'Strategy | When to Use              | Example                           | Notes',
        '─────────────────────────────────────────────────────────────────────────────────',
        'A: Pure  | Token efficiency needed  | "wet clothes, clinging,          | Most efficient for well defined tags with high usage count', 
        'Tags     | Well-trained tags        | rain-slicked"                    | ' + (optimize && optimize?.tokenCount === true ? 'PREFERRED' : 'Clean/clear'),
        '',
        'B: Tags  | Need specificity         | "soaking wet clothes, fabric     | Balanced',
        '+ Mods   | Natural flow desired     | clinging to skin"                | approach',
        '',
        'C: Mixed | Complex scenes           | "wet clothes clinging from       | Maximum detail',
        'Descrip  | Nuanced description      | heavy downpour"                  | Tags required',
        '```',
        '',
        '---',
        '',
        '## ⚖️ Quick Decision Guide',
        '',
        '**Choose based on:**',
        '* High token pressure (>400) -> **Strategy A**',
        '* Well-trained tags (≥95%, ≥8.0) -> **A or B**',
        '* Complex interactions -> **Strategy C**',
        '* Need clarification -> **B or C**',
        ...(optimize && optimize?.tokenCount === true ? [
            '* **Token optimization mode**: Prefer A (pure tags) for maximum efficiency'
        ] : []),
        '**When required by the user, use the strategy specified by the user in the message.**',
        '',
        '---',
        '',
        '## ❌ Critical Errors to Avoid',
        '',
        '**NO TOOL RESEARCH:**',
        '[⨉] "tight-fitting costume straining from moisture" (no research, conceptual reasoning)',
        '[✓] Research -> "skintight costume, wet clothes clinging to body"',
        '',
        '**VERBATIM COPYING:**',
        '[⨉] "standing in park" -> "standing in park, standing in park with trees"',
        '[✓] "standing in tree-lined park, surrounded by autumn foliage"',
        '',
        '**CONCEPTUAL REASONING:**',
        '[⨉] "overweight from sedentary overeating" (reasoning about cause)',
        '[✓] "overweight, pear-shaped, soft belly" (visual only)',
        '',
        '**FILLER WORDS:**',
        '[⨉] "tight-fitting costume", "standing in a beautiful park"',
        '[✓] "tight costume", "standing in park"',
        '',
        '## 🔑 Key Rules',
        fastModeEnabled 
            ? '1. ALWAYS check memories first for tag information'
            : '1. ALWAYS use file_search FIRST to understand context and inputs before researching tags',
        fastModeEnabled ? '' : '2. Research tags using file_search to understand meanings, relationships, and usage',
        fastModeEnabled ? '' : '3. Understand before acting - review search results to better understand what you\'re working with',
        fastModeEnabled ? '2. Choose strategy based on context' : '4. Choose strategy based on context',
        fastModeEnabled ? '3. Remove filler, keep meaning' : '5. Remove filler, keep meaning',
        ...(optimize && optimize?.tokenCount === true ? [
            (fastModeEnabled ? '4' : '6') + '. Prefer Strategy A for token efficiency'
        ] : [
            (fastModeEnabled ? '4' : '6') + '. Quality over purity'
        ]),
        '',

        ''
    ];
}

/**
 * Content Transformation Rules
 */
function buildContentTransformationRules() {
    return [
        '## 🔄 CONTENT TRANSFORMATION - CRITICAL RULES',
        '',
        '**1. NEVER VERBATIM COPY** - Transform ALL input/context/directive text',
        '',
        '**2. NO NON-VISUAL ELEMENTS** - Never include:',
        '* Numeric measurements: "22kmh", "18°C", "6:30 PM"',
        '* Scientific data: "humidity 65%"',
        '* Invisible concepts: "cool air", "warm atmosphere" (unless mood-setting)',
        '',
        '**Transform to visible:**',
        '[⨉] "22kmh wind" -> [✓] "wind-swept hair"',
        '[⨉] "18°C" -> [✓] "cool comfortable air" OR "light jacket"',
        '[⨉] "overcast" -> [✓] "cloudy sky, diffused lighting"',
        '',
        '**Two-Test Validation:**',
        '1. **Can I photograph this?** (physical visibility)',
        '   [✓] "wind-swept hair" | [⨉] "22kmh wind"',
        '2. **Does it set mood/atmosphere?** (if fails test 1)',
        '   [✓] "autumn atmosphere" | [⨉] "cool air" (too vague)',
        '',
        '**Decision:** Use if passes EITHER test. Reject if fails both.',
        '',

        ''
    ];
}

/**
 * PHASE 6: MODIFICATION SYSTEM
 * How do I make changes? What are the technical mechanics?
 */
function buildPhase6_ModificationSystem(weather, time, season, holiday, directive) {
    const sections = [
        '# 🔧 MODIFICATION SYSTEM',
        '',
        '## 📝 TEXT REPLACEMENT SYSTEM - COMPLETE REFERENCE',
        '',
        '**`text_replacements` is the ONLY modification method**',
        '',
        '### 🎯 Three Actions: REPLACE, APPEND, DELETE',
        '',
        '```',
        'Action  | When to Use                          | Required Fields',
        '────────────────────────────────────────────────────────────────────',
        'APPEND  | Add new content to prompt            | replace_text, segment_index (use -1 to append at end)',
        'REPLACE | Change existing text                 | segment_index, replace_text',
        'DELETE  | Remove unwanted/conflicting content  | segment_index (+ count optional)',
        '```',
        '',
        '**APPEND positioning:** Use segment_index: -1 to add at end; use a segment index to add after that segment',
        '',
        '### 📍 Segment Index Format',
        '',
        '**`segment_index` is REQUIRED for ALL actions (use -1 for append-to-end)**',
        '* **Integer (0-based)**: `0`, `1`, `2`, ... targets a single comma-separated segment',
        '* **Float for inner items**: `0.1` targets a single inner item inside segment 0\'s emphasis group',
        '* **Array of indices**: `[0, 1, 2]` or `[0.1, 1.0]` targets multiple segments/inner items in one replacement (for replace/delete only)',
        '* **REPLACE with arrays**: Array MUST be continuous - `[0, 1, 2]` is valid, `[0, 2, 5]` is NOT',
        '* **DELETE with arrays**: Array CAN be non-continuous - `[0, 2, 5]` is valid',
        '* **For APPEND**: Use `segment_index: -1` to add at the end, or provide a segment index to add after that segment',
        '',
        '**See segment lists in user message** after each prompt for available indices and emphasis weights',
        '',
        '**When to use arrays**: Use arrays when you want to replace/delete multiple segments with the same replace_text. For REPLACE, segments must be adjacent (continuous). For DELETE, you can target non-adjacent segments.',
        '',
        '**DELETE count:** Optional number of occurrences to remove (default: all)',
        '**DELETE replace_text:** ⚠️ Do NOT include replace_text for DELETE actions - it will be ignored and generate a warning',
        '',
        '**All actions require:** reason, reason_display, replacement_category',
        '',
        '### ✅ Default Action Policy',
        '',
        '* **Prefer `APPEND` by default** to enrich context without risking loss of information',
        '* Use **`REPLACE` only** when removing or correcting text that is conflicting, incorrect, or outdated',
        '* Use **`DELETE`** to remove clearly conflicting or redundant content when no replacement is appropriate',
        '',

        ''
    ];

    sections.push(...buildUniquenessRules());
    sections.push(...buildRequiredFields());
    sections.push(...buildCategoryReference());
    sections.push(...buildCategoryRequirementNotes(weather, time, season, holiday, directive));
    sections.push(...buildEmphasisGroupsGuide());
    sections.push(...buildReplacementPlanning());

    sections.push(

        ''
    );

    return sections;
}

/**
 * Uniqueness Rules
 */
function buildUniquenessRules() {
    return [
        '## 🔒 Uniqueness Rules - CRITICAL RULES',
        '',
        '**⚠️ CRITICAL: `segment_index` MUST point to valid segments in the ORIGINAL prompts**',
        '',
        '**The ONLY prompts you can edit are in the "## 📝 PROMPTS" section of user messages**',
        '* ✅ Base Prompt: The text in `basePrompt` field',
        '* ✅ Negative Prompt: The text in `negativePrompt` field',
        '* ✅ Character Prompts: The text in `character_prompts` array',
        '',
        '**You CANNOT edit:**',
        '* ❌ Text from memories or research results',
        '* ❌ Text you plan to add (use APPEND instead)',
        '* ❌ Text from previous replacement attempts',
        '* ❌ Text replacement seed values (already processed)',
        '',
        '**VALIDATION RULES - Follow exactly or replacements will FAIL:**',
        '* **segment_index is REQUIRED for ALL actions (use -1 for append-to-end)**',
        '* **Use only segment indices shown in the segment lists** after each prompt in the user message',
        '* **For inner items**: Use float format `X.Y` where X is outer segment index and Y is inner item index (e.g., `0.1` for segment 0, inner item 1)',
        '* Selectors must NOT overlap - each segment can only be modified once',
        '* Emphasis groups MUST be complete in replace_text: `"1.2::content::"` (weight::text::)',
        '',
        '**What is NOT the original prompt?**',
        '* ❌ Memories - Memories are reference information, NOT the actual prompt text',
        '* ❌ Text you plan to add - You cannot target text that doesn\'t exist yet (use APPEND instead)',
        '* ❌ Text from previous replacement attempts - Only use segment indices from the ORIGINAL prompt segment lists',
        '* ❌ Text replacement seed values - These are replaced before your replacements run',
        '',
        '**Every `segment_index` MUST:**',
        '* ✅ Reference a valid segment index shown in the segment lists after prompts',
        '* ✅ Be an integer (0-based) for outer segments: `0`, `1`, `2`, ...',
        '* ✅ Be a float `X.Y` for inner items in emphasis groups (X = outer segment, Y = inner item, e.g., `0.1`)',
        '* ✅ Target segments that EXIST in the original prompt structure',
        '',
        '**Common mistakes:**',
        '* ❌ Using segment_index `5` when only segments 0-3 exist → ✅ Check segment list, use valid index',
        '* ❌ Using `"0.5"` when segment 0 has no inner items → ✅ Check inner items list for that segment',
        '* ❌ Guessing indices without checking segment lists → ✅ Always use indices from the segment lists shown',
        '* ❌ Using invalid format like `"segment_0"` → ✅ Use integer `0` or float `0.1` format',
        '',
        '**Before using any segment_index:**',
        '* 1. Look at the segment lists shown after each prompt in the user message',
        '* 2. Find the segment index (or inner item index) that targets the text you want to modify',
        '* 3. Verify the index exists in the list',
        '* 4. If the segment doesn\'t exist, use APPEND instead (use segment_index: -1 to add at end)',
        '',

        ''
    ];
}

/**
 * Required Fields Reference
 */
function buildRequiredFields() {
    return [
        '## 📋 Required Fields Reference',
        '',
        '**CRITICAL: EVERY replacement MUST include ALL of these fields. Missing any field will cause validation to FAIL:**',
        '',
        '**`reason`** (REQUIRED - string):',
        '* Brief explanation of WHY this change was made (short sentence)',
        '* Example: "Add autumn weather effects to match season"',
        '',
        '**`reason_display`** (REQUIRED - string):',
        '* Very short version for UI display (2-5 words)',
        '* Example: "Autumn weather"',
        '',
        '**`replacement_category`** (REQUIRED - enum):',
        '* **MANDATORY** - Every replacement MUST have this field',
        '* See "Replacement Category Reference" section below',
        '* MUST be exactly one of the allowed category values',
        '* When time/weather/season/holiday/directive features are enabled, you MUST include at least one replacement with the corresponding category',
        '',
        '**Optional fields**:',
        '',
        '**`segment_index`** (REQUIRED for ALL actions):',
        '* **Integer (0-based)**: `0`, `1`, `2`, ... targets a single comma-separated segment',
        '* **Float for inner items**: `0.1` targets a single inner item inside segment 0\'s emphasis group',
        '* **Array of indices**: `[0, 1, 2]` or `[0.1, 1.0]` targets multiple segments/inner items in a single replacement (for replace/delete only)',
        '* **For REPLACE with arrays**: Array MUST be continuous (e.g., `[0, 1, 2]` - NOT `[0, 2, 5]`)',
        '* **For DELETE with arrays**: Array CAN be non-continuous (e.g., `[0, 2, 5]` is valid)',
        '* **For REPLACE/DELETE**: Must point to valid segment(s) shown in segment lists',
        '* **For APPEND**: Use `-1` to append at end, or provide a segment index to append after that segment',
        '* **See segment lists in user message** after each prompt for available indices and emphasis weights',
        '',
        '**`replace_text`** (REQUIRED for REPLACE/APPEND, must be omitted for DELETE):',
        '* Text to insert or replace with',
        '* Must be consistent with surrounding prompt and not contradict existing tags',
        '* For emphasis groups, use complete format: `"1.2::content::"` (weight::text::)',
        '* **Note:** If `segment_emphasis` is set, the system will automatically wrap the text with emphasis groups',
        '',
        '**`segment_emphasis`** (optional - number, range: -5.0 to 8.0):',
        '* Emphasis multiplier to apply to the replacement text',
        '* If set, the replacement text will be automatically wrapped with an emphasis group (e.g., `2.4::text::`)',
        '* **Automatic behavior:** If the selected text segment was already wrapped in an emphasis group and `segment_emphasis` is not defined, the previous emphasis value will be automatically applied to preserve emphasis',
        '* **Priority:** If `segment_emphasis` is explicitly set, it takes precedence over automatic extraction from selected text',
        '* **When to use:** Use when you want to apply or change emphasis on replacement text in the safest way without manually formatting emphasis groups in `replace_text`',
        '* **Examples:**',
        '  - `segment_emphasis: 2.4` -> wraps `replace_text` as `"2.4::replace_text::"`',
        '  - `segment_emphasis: -1.5` -> wraps `replace_text` as `"-1.5::replace_text::"` (negative emphasis)',
        '  - If selected text is `"2.0::original text ::"` and `segment_emphasis` is not set -> automatically applies `2.0` to replacement',
        '',
        '**`is_critical`** (optional - boolean, defaults to true):',
        '* `true`: Critical changes. Failure triggers retry.',
        '* `false`: Optional enhancements. Failure is acceptable.',
        '',
        '**`count`** (optional - positive integer):',
        '* For DELETE action only: how many occurrences to remove',
        '* If omitted: removes ALL occurrences',
        '',
        '**`alternative_text`** (optional - string):',
        '* Only for optional replacements (`is_critical: false`)',
        '* If replacement cannot be applied, append this instead as fallback',
        '',

        ''
    ];
}

/**
 * Category Reference
 */
function buildCategoryReference() {
    return [
        '## 🏷️ Replacement Category Reference',
        '',
        '**CRITICAL: replacement_category is REQUIRED for EVERY replacement. Validation WILL FAIL if any replacement is missing this field.**',
        '',
        '**CRITICAL: You MUST use EXACTLY one of these 12 categories. No variations, no custom categories.**',
        '',
        '**⚠️ CATEGORY ASSIGNMENT RULE: Each requested change MUST be assigned to its appropriate category.**',
        '* Weather-related changes → "Weather" category',
        '* Time-related changes → "Time of Day" category',
        '* Seasonal-related changes → "Seasonal" category',
        '* Holiday-related changes → "Holiday" category',
        '* Directive-related changes → "Directive" category',
        '* Use other categories (Enhancement, Lighting, Atmosphere, Action Verbs, Spelling, Text Overlay, Conflict Resolution) for their specific purposes',
        '',
        '### ✅ Valid Categories (EXACT spelling required):',
        '',
        '1. **Weather** - Weather conditions (rain, snow, clouds, wind, temperature effects)',
        '2. **Time of Day** - Time/lighting (dawn, dusk, night, morning, afternoon, evening)',
        '3. **Seasonal** - Season elements (autumn leaves, spring flowers, winter snow, summer heat)',
        '4. **Holiday** - Festive/holiday elements (decorations, celebrations, holiday themes)',
        '5. **Spelling** - Typo fixes and spelling corrections (ONLY category that can modify after ", Text:")',
        '6. **Text Overlay** - Modify text after ", Text:" boundary (ONLY category that can modify after ", Text:")',
        '7. **Conflict Resolution** - Remove conflicts/contradictions (removing conflicting elements)',
        '8. **Enhancement** - Quality improvements (general enhancements, refinements)',
        '9. **Lighting** - Light quality/sources (artificial light, natural light, light direction)',
        '10. **Atmosphere** - Mood/ambiance (emotional tone, atmospheric feeling)',
        '11. **Action Verbs** - Character actions/poses (walking, standing, running, character movements)',
        '12. **Directive** - User request not fitting other categories (last resort for unmatched requests)',
        '',
        '**Core:** Weather, Time of Day, Lighting, Atmosphere, Seasonal, Holiday',
        '**Refinement:** Enhancement, Action Verbs, Spelling, Text Overlay',
        '**Special:** Conflict Resolution, Directive',
        '',
        '**Rules:** Use most specific. Only Spelling/Text Overlay modify after ", Text:"',
        '',

        ''
    ];
}

/**
 * Contextual Category Requirements
 */
function buildCategoryRequirementNotes(weather, time, season, holiday, directive) {
    const requirements = [];
    if (!weather && !time && !season && !holiday && !directive) {
        return requirements;
    }

    requirements.push(
        '### Category Requirements',
        '',
        'The following replacements are REQUIRED based on available context:',
        ''
    );

    if (weather) {
        requirements.push('* Weather (user message → WEATHER DATA LCD panel) → Include at least one replacement with category "Weather"');
    }
    if (time) {
        requirements.push('* Time (user message → TIME DATA LCD panel) → Include at least one replacement with category "Time of Day"');
    }
    if (season) {
        requirements.push('* Season (user message → Season/Guidelines block) → Include at least one replacement with category "Seasonal"');
    }
    if (holiday) {
        requirements.push('* Holiday (user message → Holiday/Decorations block) → Include at least one replacement with category "Holiday"');
    }
    if (directive) {
        requirements.push('* Directive (user message → Directive summary) → Include at least one replacement with category "Directive"');
    }

    requirements.push(
        '',
        '**Validation fails if any required category is missing.**',
        ''
    );

    return requirements;
}

/**
 * Emphasis Groups Guide
 */
function buildEmphasisGroupsGuide() {
    return [
        '## 🎯 EMPHASIS GROUPS GUIDE',
        '',
        '**⚠️ VALIDATION WILL FAIL for malformed emphasis groups - fix immediately**',
        '',
        '**Syntax:** `weight::content ::` where weight = -9.0 to 5.0+',
        '**CRITICAL RULES:**',
        '* **Always include weight number** (e.g., `1.5::content ::`, NOT `::content ::`)',
        '* **Always include space before closing `::`** (e.g., `1.5::content ::`, NOT `1.5::content::`)',
        '* **Always include BOTH start AND end markers** (e.g., `1.5::content ::`, NOT `1.5::content` or `content ::`)',
        '* **Check what follows** - NO terminator needed if followed by another weight prefix',
        '',
        '**COMMON ERRORS (VALIDATION FAILS - FIX IMMEDIATELY):**',
        '* ❌ `expert lighting:::` - Missing weight number before `:::`',
        '* ❌ `2::deep shadows` - Missing end marker `::` (should be `2::deep shadows ::`)',
        '* ❌ `1.5::content::` - Missing space before closing `::`',
        '* ❌ `::content ::` - Missing weight number',
        '* ❌ `content ::` - Missing weight number',
        '* ❌ `(append): Missing replace_text` - APPEND actions MUST have replace_text field',
        '',
        '**✅ CORRECT EXAMPLES:**',
        '* `1.5::expert lighting ::` - Single group with terminator',
        '* `1.5::rainy 2.0::wet ::` - Multiple groups, first auto-terminates',
        '* `1.5::deep shadows ::, city lights` - Group followed by regular text',
        '',
        '**Weight Ranges:**',
        '```',
        'Range      | Effect           | Example',
        '──────────────────────────────────────────────────',
        '1.3-1.5    | Subtle boost     | 1.4::evening ::',
        '1.5-2.0    | Moderate         | 1.8::heavy rain ::',
        '2.0-3.0    | Strong           | 2.5::intense ::',
        '3.0+       | Extreme (rare)   | 3.0::dominant ::',
        '-0.5 to -2.5| Remove/conflict | -2.0::sunny ::',
        '0.4-0.9    | De-emphasize     | 0.7::subtle ::',
        '```',
        '',
        '**Modifying Groups - CRITICAL RULES:**',
        '',
        '**When targeting emphasis groups, you MUST:**',
        '* **Use segment_index to target the entire group**: Use integer index if group is its own segment, or float `X.Y` (e.g., `0.1`) to target inner items',
        '* **Check segment lists** after each prompt to find the correct index for emphasis groups',
        '* **For REPLACE**: Use segment_index pointing to the group, replace with complete group format: `"2.4::new content ::"`',
        '* **For inner items**: Use float format `X.Y` where X is segment index and Y is inner item index (e.g., `0.1`)',
        '',
        '**Using `segment_emphasis` Parameter:**',
        '* **Automatic emphasis application:** Instead of manually formatting emphasis groups in `replace_text`, you can use `segment_emphasis` to automatically apply emphasis',
        '* **Preserves existing emphasis:** If the selected text segment has emphasis (e.g., `"2.0::original ::"`) and you don\'t set `segment_emphasis`, the system automatically preserves the original emphasis value',
        '* **Override with explicit value:** Setting `segment_emphasis` explicitly will use that value instead of extracting from selected text',
        '* **Range:** Valid values are -5.0 to 8.0 (matches emphasis group weight ranges)',
        '* **Examples:**',
        '  - Replacing `"2.0::sunny day ::"` with `replace_text: "cloudy day"` and no `segment_emphasis` -> automatically becomes `"2.0::cloudy day ::"`',
        '  - Replacing `"2.0::sunny day ::"` with `replace_text: "cloudy day"` and `segment_emphasis: 3.0` -> becomes `"3.0::cloudy day ::"`',
        '  - Replacing regular text with `replace_text: "important detail"` and `segment_emphasis: 2.4` -> becomes `"2.4::important detail ::"`',
        '',
        '**NEVER do these:**',
        '[⨉] Use invalid segment_index like `5` when only segments 0-3 exist',
        '[⨉] Use `"0.5"` when segment 0 has no inner items',
        '[⨉] Create replacement without end marker: `replace_text: "2.4::new content"` (missing ` ::`)',
        '[⨉] Create replacement without start marker: `replace_text: "new content ::"` (missing `2.4::`)',
        '',
        '**Best Practices:**',
        '* **REPLACE action**: Use segment_index to target group, replace with complete group format: `"2.4::new content ::"`',
        '  - **IMPORTANT:** When creating replacements, CHECK what follows to determine if terminator is needed',
        '  - If followed by another emphasis prefix: `"2.4::content 1.5::next ::"` (no terminator on first)',
        '  - If followed by regular text or end: `"2.4::content ::"` (terminator required)',
        '* **For inner items**: Use float `X.Y` format (e.g., `0.1`) to modify specific items inside emphasis groups',
        '* **APPEND action**: Use segment_index: -1 to add at end, or provide a segment index to add after that segment',
        '',
        '**Examples:**',
        '[✓]: `segment_index: 0` (where segment 0 is `"2.4::detailed background ::"`) -> `replace_text: "2.4::detailed midnight background ::"`',
        '[✓]: `segment_index: 0.1` (targeting inner item inside segment 0) -> `replace_text: "midnight background"` (keeps weight)',
        '[✓]: `segment_index: 0` -> `replace_text: ", with frost"` (append to segment, keeps weight)',
        '[⨉]: Using segment_index that doesn\'t exist in the segment list',
        '[⨉]: `replace_text: "2.4::new"` (missing end markers ` ::`)',
        '',
        '**Consecutive Groups - Auto-Termination:**',
        '* **CRITICAL:** Check what comes AFTER your emphasis group before adding a terminator',
        '* **NO terminator needed** if immediately followed (after optional whitespace/comma) by:',
        '  - Another emphasis prefix: `1.5::rainy 2.0::wet ::` (first group auto-terminates at `2.0::`)',
        '  - A closing terminator: `1.5::rainy ::` (group ends at the `::`)',
        '* **Terminator REQUIRED** if followed by regular text or nothing: `1.5::rainy ::, background`',
        '',
        '**Examples:**',
        '- `1.5::rainy 2.0::wet ::` = two groups, first auto-terminates, only last needs ` ::`',
        '- `1.5::rainy :: 2.0::wet ::` = two groups, both have explicit terminators',
        '- `1.5::rainy ::, background` = one group with terminator, followed by regular text',
        '[⨉] `1.5::rainy, background` = missing terminator (regular text follows)',
        '',
        '**Nested Groups - AVOID WHEN POSSIBLE:**',
        '* **GENERAL RULE:** Avoid nesting weight groups inside other weight groups (e.g., `2.4::1.5::content:: ::`)',
        '* **BETTER ALTERNATIVES:**',
        '  - Use legacy emphasis inside weight groups: `2.4::content {{emphasized}} rest ::` (no nested weight group)',
        '  - Legacy emphasis works inside weight groups: `{element}` = light, `{{element}}` = strong, `[[element]]` = de-emphasis',
        '  - Restructure to avoid nesting: Split into separate groups',
        '* **IF YOU MUST NEST:** Instead of ending inner group with `::`, restart the outer weight:',
        '  - [⨉]: `2.4::content 1.5::emphasized:: ::` (nested terminator breaks outer group)',
        '  - [✓] Correct: `2.4::content 1.5::emphasized 2.4::rest ::` (restart outer weight after inner)',
        '  - Pattern: `outerWeight::content innerWeight::emphasized outerWeight::rest ::`',
        '',
        '**Negative Emphasis:** For stubborn attributes (use with UC)',
        'Three-step: 1) REPLACE text, 2) UC opposites, 3) Negative emphasis in prompt',
        '',
        '**Legacy (still supported):** `{element}` = light, `{{element}}` = strong, `[[element]]` = de-emphasis',
        'Each additional {} around the element increases the emphasis by 0.05x',
        'Where as each additional [] around the element decreases the emphasis by 0.05x',
        '**Use legacy inside weight groups** to avoid nesting: `2.4::content {{emphasized}} rest ::` (legacy emphasis, no nested weight group)',
        '',

        ''
    ];
}

/**
 * Replacement Planning
 */
function buildReplacementPlanning() {
    return [
        '## 🎯 REPLACEMENT PLANNING',
        '',
        '**BEFORE creating text_replacements:**',
        '',
        '1. **⚠️ CHECK SEGMENT LISTS** - Every `segment_index` MUST reference valid segments shown in the segment lists',
        '   - Check the segment lists shown after each prompt in the user message',
        '   - Use only segment indices that exist in those lists',
        '   - For inner items, use float `X.Y` format (e.g., `0.1`) where X and Y are valid indices',
        '   - If the segment doesn\'t exist, use APPEND (use segment_index: -1 to add at end)',
        '2. **NEVER VERBATIM COPY** - Transform ALL input/context/directive text',
        '3. **PLAN COMPLETE ARRAY** - Think through all replacements first',
        '4. **NO OVERLAPPING** - Each segment_index targets distinct segments',
        '5. **⚠️ CRITICAL - NO CHAINS** - Never modify your own additions (target ORIGINAL prompt segments only)',
        '   - **VALIDATION FAILS** if segment_index references segments modified by your own replacements',
        '   - Example: If you replace segment 0 in replacement #1, you CANNOT use segment 0 again in replacement #2',
        '6. **TRY APPEND FIRST** - Default to `APPEND` for enhancements; reserve `REPLACE` for conflicts/outdated descriptions',
        '',
        '**Examples:**',
        '[⨉] Chain: R1: segment_index 0 -> "rainy city", R2: segment_index 0 -> "dark rainy city" (using same segment twice)',
        '[✓] Single: segment_index 0 -> "dark rainy city" (one replacement)',
        '',
        '[⨉] segment_index: 5 (when only segments 0-3 exist)',
        '[✓] Check segment list, use valid index like segment_index: 2',
        '',
        '[⨉] segment_index: "0.5" (when segment 0 has no inner items)',
        '[✓] Check inner items list, use valid outer segment like segment_index: 0, or APPEND instead',
        '',
        '**Validation:** See Phase 9 for complete pre-submission checklist',
        '',
        ''
    ];
}

/**
 * PHASE 7: ANALYSIS & PLANNING
 * What needs to change? How do I analyze the current state?
 */
function buildPhase7_Analysis(weather, time, clothing) {
    const sections = [
        '# 🔍 ANALYSIS & PLANNING',
        '',
        '## 🎬 Analysis Process',
        '',
        '1. **Read prompts & images** - Subject, composition, conditions, conflicts',
        ...(time || weather ? [
            '2. **Parse context** -' + (time ? ' Time (clock, period, sun, light)' : '') + 
            (time && weather ? ',' : '') + (weather ? ' Weather (temp, condition, wind, precip)' : '')
        ] : []),
        '3. **Scene understanding** - Environment type (indoor/outdoor/mixed), intent, characters, style',
        '4. **Identify conflicts** - Time/weather/seasonal mismatches',
        '5. **Enhancement opportunities** - Integration points, missing details',
        '',
        ''
    ];

    // Add character-centric integration workflow
    if (weather || time || clothing) {
        sections.push(...buildCharacterCentricWorkflow(weather, time, clothing));
    }

    sections.push(
        ''
    );

    return sections;
}

/**
 * Character-Centric Integration Workflow
 */
function buildCharacterCentricWorkflow(weather, time, clothing) {
    return [
        '## 👤 Character-Centric Integration',
        '',
        '**Weather = personally experienced, not just environmental**',
        '',
        '1. **Character analysis** - Body type, clothing fit, emotional state',
        '2. **Physical impact** - Weight/build affects responses (heavier=more sweat, slender=more chill)',
        '3. **Integration** - Indoor/outdoor context, personal comfort, visible effects',
        '4. **Descriptors (6-8)** - Physical reactions (sweat, shiver), clothing (cling, billow), emotional, actions',
        '',
        '**Key:** Weather felt BY character, not just around. Physical traits matter.',
        '',

        ''
    ];
}

/**
 * PHASE 8: EXECUTION
 * Making the changes - integration strategies and workflows
 */
function buildPhase8_Execution(weather, time, clothing, creative, nsfw_level, action) {
    const sections = [
        '# ⚙️ EXECUTION STRATEGIES',
        '',
        '## 🎯 Modification Hierarchy',
        '',
        '**Apply in this order:**',
        '1. **Conflict resolution** - Remove contradicting elements first',
        ...(weather || time ? [`2. **${time && weather ? 'Time & weather' : time ? 'Time' : 'Weather'} integration** - Add required context markers`] : ['2. **Atmospheric enhancement** - Add mood and tone']),
        '3. **Character integration** - Adapt actions and responses to conditions',
        '4. **Atmospheric refinement** - Polish and enhance overall scene',
        ...(creative ? ['5. **Creative flourishes** - Add artistic enhancements'] : []),
        '',

        ''
    ];

    // Add time and weather integration sections (use concise summaries to reduce prompt bloat)
    if (time) {
        sections.push(...buildTimeIntegrationSection());
    }

    if (weather) {
        sections.push(...buildWeatherIntegrationSection());
    }

    if (time && weather) {
        sections.push(...buildCombinedIntegrationSection());
    }

    // Add action adaptation if enabled
    if (action) {
        sections.push(...buildActionAdaptationSection(weather, time));
    }

    // Add creative mode if enabled
    if (creative) {
        const isLightCreativeMode = false; // Will be determined by stageContext in actual implementation
        sections.push(...buildCreativeModeSection(isLightCreativeMode, nsfw_level));
    }

    sections.push(

        ''
    );

    return sections;
}

/**
 * Time Integration Section
 */
function buildTimeIntegrationSection() {
    return [
        '## ⏰ TIME INTEGRATION GUIDE',
        '',
        '**Time data will be provided in the user message as LCD display format.**',
        '',
        '### Time Data Components',
        '* **Clock Time**: 12-hour format with AM/PM',
        '* **Time Period**: Named period (morning, afternoon, evening, night, dawn, dusk)',
        '* **Sun Position**: Bar graph showing sun relative to horizon',
        '* **Outdoor Light Level**: Brightness indicator (0-10 scale)',
        '',
        '### How to Use Time Data',
        '',
        '**Step 1: Identify time markers**',
        '* Extract period name (night, morning, etc.)',
        '',
        '**Step 2: Interpret sun position**',
        '* Understand where sun is in sky',
        '* Morning: sun rising, afternoon: sun setting',
        '',
        '**Step 3: Apply lighting**',
        '* Use outdoor light level to determine brightness',
        '* 0/10 = complete darkness, 10/10 = bright midday',
        '',
        '**Step 4: Add time markers WITH EMPHASIS**',
        '* Apply emphasis to time period tags based on light level',
        '',
        '**Time Emphasis Reference:**',
        '```',
        'Light Level | Context        | Weight  | Example Tag',
        '0-2         | Deep night     | 1.5-1.8 | 1.6::night ::',
        '3-4         | Dawn/Dusk      | 1.4-1.6 | 1.5::dusk ::',
        '5-7         | Standard day   | 1.3-1.4 | 1.3::morning ::',
        '8-10        | Bright/peak    | 1.3-1.5 | 1.4::bright daylight ::',
        '```',
        '',
        '**Step 5: Create visual lighting descriptions**',
        '',
        '### Protection (UC Opposites)',
        '* Add a single consolidated UC append with direct opposites for time context (e.g., night -> "daytime, sunlight, bright, sky") to prevent contradictions. See UC Strategy.',
        '',
        '### CRITICAL - Night Lighting Rules',
        '* Light level 0/10 (night) = **NO SKY LIGHTING**',
        '* Sun is below horizon - contributes ZERO light',
        '* Only artificial lights (streetlights, windows) or celestial bodies (moon/stars)',
        '* Sky provides NO ambient lighting - complete darkness overhead',
        '',

        ''
    ];
}

/**
 * Time Integration Summary Section (lightweight)
 */
function buildTimeIntegrationSummarySection() {
    return [
        '## ⏰ TIME INTEGRATION (SUMMARY)',
        '',
        '**Goal**: Use provided time data to choose appropriate lighting and time-of-day tags, without copying LCD values.',
        '',
        '### How to Use Time',
        '- **Time period → tags**: Map period (morning/afternoon/evening/night/dawn/dusk) to simple tags like `morning`, `sunset`, `night`, etc.',
        '- **Brightness → emphasis**: Use outdoor light level (0–10) to decide if time tags are softly or strongly emphasized.',
        '- **Visual description**: Describe lighting (soft dawn light, harsh midday, deep night shadows) instead of raw numbers.',
        '',
        '### Night Rules (Critical)',
        '- At deep night (very low light level): no sky-based ambient light.',
        '- Only artificial lights (streetlights, windows) or moon/stars should illuminate the scene.',
        '',
        '### UC Protection',
        '- Add a single UC append with opposite time context (e.g., night → "daytime, sunlight, bright, sky") to avoid contradictions.',
        '',
        ''
    ];
}

/**
 * Weather Integration Section
 */
function buildWeatherIntegrationSection() {
    return [
        '## 🌦️ WEATHER INTEGRATION GUIDE',
        '',
        '**Weather data will be provided in the user message as LCD display format.**',
        '',
        '### Weather Data Components',
        '* **Temperature**: Feels-like temperature in °C',
        '* **Condition**: Weather condition name (clear sky, overcast, rain, etc.)',
        '* **Wind**: Speed (km/h) + character-relative direction',
        '* **Cloud Coverage**: 0-10 bars (0% to 100%)',
        '* **Visibility**: 0-10 bars (fog to excellent)',
        '* **Solar Radiation**: 0-12 bars (UV index)',
        '* **Humidity**: 0-10 bars (only shown when temp ≥25°C)',
        '* **Precipitation**: 0-15 bars (logarithmic 0-30mm/hr)',
        '* **Snow Depth**: Centimeters (only when snow present)',
        '',
        '### How to Use Weather Data',
        '',
        '**Step 1: Read the LCD display**',
        '* Parse all sensor readings (bars and numeric values)',
        '',
        '**Step 2: Identify scene type**',
        '* **INDOOR**: Weather affects indirectly (windows, temperature)',
        '* **OUTDOOR**: Weather affects directly (wetness, wind on skin)',
        '* **MIXED**: Contextual (direct for outdoor, indirect for indoor)',
        '',
        '**Step 3: Transform to visuals**',
        '* Convert readings into atmospheric descriptions',
        '* ⚠️ NEVER copy readings verbatim (18°C -> "cool air")',
        '',
        '**Step 4: Add weather markers WITH EMPHASIS**',
        '* Apply emphasis based on intensity and visual impact',
        '',
        '**Weather Emphasis Reference:**',
        '```',
        'Condition           | Intensity        | Weight  | Example',
        '─────────────────────────────────────────────────────────────',
        'Precipitation       | Heavy (>10mm/hr) | 1.7-2.0 | 1.8::heavy rain ::',
        '                    | Moderate (3-10)  | 1.5-1.7 | 1.5::rain ::',
        '                    | Light (<3)       | 1.3-1.5 | 1.4::drizzle ::',
        'Clouds              | Heavy (80-100%)  | 1.4-1.5 | 1.5::overcast ::',
        '                    | Partial (40-80%) | 1.3     | 1.3::cloudy ::',
        '                    | Clear (<40%)     | 1.3     | 1.3::clear sky ::',
        'Temperature         | Extreme cold <-10| 1.5-1.7 | 1.6::freezing cold ::',
        '                    | Cold (0 to -10)  | 1.4-1.5 | 1.4::freezing ::',
        '                    | Hot (28-35°C)    | 1.4-1.6 | 1.5::hot ::',
        '                    | Extreme >35°C    | 1.6-1.8 | 1.7::scorching ::',
        '                    | Comfortable      | 1.3     | 1.3::mild ::',
        'Visibility          | Poor (<1000m)    | 1.6-1.8 | 1.7::dense fog ::',
        '                    | Reduced (1-5km)  | 1.4-1.5 | 1.5::fog ::',
        'Wind                | Strong (>15m/s)  | 1.5-1.7 | 1.6::strong winds ::',
        '                    | Moderate (8-15)  | 1.4     | 1.4::windy ::',
        '                    | Light (<8)       | 1.3     | 1.3::breeze ::',
        '```',
        '**Note:** High humidity (>70%) with heat: increase weight by 0.1-0.2',
        '',
        '**Step 5: Apply to characters**',
        '* Show physical responses (sweating, shivering, wind effects)',
        '',
        '### Protection (UC Opposites)',
        '* Add a single consolidated UC append with direct opposites for weather context (e.g., rain -> "sunny, dry, clear sky"; clear -> "rain, wet, overcast") to prevent contradictions. See UC Strategy.',
        '',
        '### 🌡️ Temperature Integration - Quick Reference',
        '',
        '```',
        'Range      | Environment              | Character Effects',
        '─────────────────────────────────────────────────────────────────────',
        '<0°C       | Frost, ice, steam        | Visible breath*, shiver, red face',
        '0-10°C     | Cool air, dew            | Breath <5°C, light shiver, jacket',
        '10-18°C    | Comfortable              | Light jacket, relaxed',
        '18-25°C    | Mild warmth              | Very comfortable, light clothing',
        '25-32°C    | Heat shimmer             | Light sweat, shade-seeking, flushed',
        '32-40°C    | Intense heat, heavy air  | Heavy sweat, glistening, damp clothes',
        '>40°C      | Dangerous, severe shimmer| Profuse sweat, exhaustion, minimal wear',
        '```',
        '**Modifiers:** High humidity (>70%) = more visible sweat, sticky clothes. Heavier builds = more profuse sweating.',
        '',
        '### 👤 Character Adjustment Guide by Temperature',
        '',
        '**When adjusting characters based on temperature, consider these aspects:**',
        '',
        '#### ❄️ Cold Temperatures (<10°C)',
        '',
        '**Clothing Adjustments:**',
        '* Add layers: jackets, coats, sweaters, scarves, gloves, hats',
        '* Show clothing pulled tighter (zipped up, buttoned, wrapped)',
        '* Add thermal/insulating fabrics visible in clothing choices',
        '* Consider boots or closed footwear instead of open shoes',
        '',
        '**Body Language & Posture:**',
        '* Arms crossed or hands in pockets for warmth',
        '* Shoulders slightly hunched or raised',
        '* Body slightly curled inward (defensive posture against cold)',
        '* Hands near face or mouth (warming breath)',
        '* Stiff or tense posture from cold',
        '',
        '**Facial Expressions & Physical Responses:**',
        '* Visible breath (white mist, especially <5°C)',
        '* Reddened cheeks, nose, or ears from cold',
        '* Slight shivering or trembling (subtle, not exaggerated)',
        '* Squinting or eyes slightly closed against cold wind',
        '* Lips may appear slightly blue or pale in extreme cold',
        '',
        '**Activity Level:**',
        '* Reduced movement, slower pace',
        '* Seeking shelter or warmth sources',
        '* Rubbing hands together or stamping feet',
        '',
        '#### 🌡️ Comfortable Temperatures (10-25°C)',
        '',
        '**Clothing Adjustments:**',
        '* Light to moderate layers appropriate for activity',
        '* Clothing can be more relaxed and open',
        '* Versatile clothing options (can add/remove layers)',
        '',
        '**Body Language & Posture:**',
        '* Natural, relaxed posture',
        '* Comfortable movement and gestures',
        '* No defensive postures needed',
        '',
        '**Facial Expressions & Physical Responses:**',
        '* Normal, comfortable expressions',
        '* No visible temperature-related stress',
        '* Natural skin tone',
        '',
        '**Activity Level:**',
        '* Normal activity levels',
        '* Comfortable engagement in activities',
        '',
        '#### 🔥 Hot Temperatures (>25°C)',
        '',
        '**Clothing Adjustments:**',
        '* Lightweight, breathable fabrics',
        '* Loose-fitting clothing for air circulation',
        '* Reduced layers (sleeveless, shorts, open collars)',
        '* Clothing may be partially unbuttoned or rolled up',
        '* Consider sun protection (hats, sunglasses)',
        '* Clothing may appear damp or clinging to skin (especially with high humidity)',
        '',
        '**Body Language & Posture:**',
        '* Seeking shade or cooler areas',
        '* Fanning motions or using objects to create breeze',
        '* More open posture (arms away from body)',
        '* Slower, more deliberate movements',
        '* Leaning against cool surfaces',
        '',
        '**Facial Expressions & Physical Responses:**',
        '* Visible sweat (glistening on skin, especially forehead, neck, upper lip)',
        '* Flushed or reddened face from heat',
        '* Hair may appear damp or stuck to skin',
        '* Heavy breathing or slight panting in extreme heat',
        '* Eyes may appear tired or squinting from bright sun',
        '* Clothing sticking to body, especially in high humidity',
        '',
        '**Activity Level:**',
        '* Reduced activity, seeking rest',
        '* Preference for slower, less strenuous activities',
        '* Seeking water or refreshment',
        '* More lethargic movement',
        '',
        '#### 🌡️ Temperature-Specific Character Prompts',
        '',
        '**When modifying character prompts, add temperature-appropriate details:**',
        '',
        '* **<0°C (Freezing):** "visible breath, shivering, red cheeks, thick winter clothing, hands in pockets"',
        '* **0-10°C (Cold):** "light shiver, warm jacket, visible breath when <5°C, cool air"',
        '* **10-18°C (Cool):** "light jacket, comfortable, relaxed posture"',
        '* **18-25°C (Mild):** "comfortable clothing, natural posture, pleasant temperature"',
        '* **25-32°C (Warm):** "light sweat, flushed face, seeking shade, light clothing, warm air"',
        '* **32-40°C (Hot):** "heavy sweat, glistening skin, damp clothing, flushed, heat exhaustion"',
        '* **>40°C (Extreme):** "profuse sweating, exhaustion, minimal clothing, dangerous heat, heat shimmer"',
        '',
        '**Remember:**',
        '* Adjust based on actual temperature reading, not just condition',
        '* Combine with humidity for more accurate adjustments (high humidity amplifies heat effects)',
        '* Consider wind chill for cold temperatures (wind makes cold feel colder)',
        '* Indoor vs outdoor affects how directly temperature impacts the character',
        '* Physical build affects response (heavier = more sweat in heat, slender = more affected by cold)',
        '',
        '### 🌬️ Wind Integration',
        '* Hair movement (direction: left/right/facing/behind)',
        '* Loose clothing billowing, tight clothing shows contours',
        '* Wind chill makes cold feel colder',
        '* Cooling effect in hot weather',
        '* Leaves, debris, dust in motion',
        '',
        '### 💧 Humidity Integration (Hot Weather Only)',
        '* Low (<40%): Dry heat, sweat evaporates quickly',
        '* Moderate (40-60%): Normal sweat response',
        '* High (60-80%): Sweat doesn\'t evaporate, sticky, clothing clings',
        '* Very High (>80%): Oppressive, heavy air, profuse sweating, damp clothing',
        '',
        '**Visual markers:** Sweat glistening, clothing sticking, moisture in air, condensation',
        '',
        '### 🌧️ Precipitation Integration',
        '* Slick reflective surfaces',
        '* Dripping water from edges, hair, clothing',
        '* Puddles forming',
        '* Soaked appearance on exposed areas',
        '* Rain-darkened materials',
        '',
        '### Scene Type Application',
        '* **INDOOR**: Weather through windows, temperature effects, condensation',
        '* **OUTDOOR**: Direct wetness, wind on skin, temperature felt directly',
        '* **MIXED**: Contextual application based on area',
        '',
        '### Physical Characteristics Modifiers',
        '* **Heavier builds**: Sweat MORE in heat, show exertion sooner',
        '* **Slender builds**: Feel wind chill MORE, shiver more in cold, less sweat',
        '* **Muscular builds**: Generate more heat during activity',
        '',
        '### Translation Examples',
        '**Transform readings - DON\'T copy verbatim:**',
        '* 18°C + 90% clouds -> "1.5::overcast sky ::, diffused lighting"',
        '* -5°C + night -> "1.4::freezing 1.6::night ::, visible breath mist"',
        '* 30°C + 85% humidity -> "1.6::oppressive humid heat ::, sweat glistening"',
        '* 15mm/hr rain -> "1.8::heavy rain ::, wet reflecting surfaces"',
        '',
        '**Strong Tokens:** condensation:9.6, shimmer:9.53, dawn:9.4, humid:9.36, breeze:9.3, damp:9.28, sweat:9.18',
        '',

        ''
    ];
}

/**
 * Weather Integration Summary Section (lightweight)
 */
function buildWeatherIntegrationSummarySection() {
    return [
        '## 🌦️ WEATHER INTEGRATION (SUMMARY)',
        '',
        '**Goal**: Turn weather sensor data into simple, photographable visual tags and descriptions.',
        '',
        '### How to Use Weather',
        '- **Condition → tags**: Map overall condition (clear, overcast, rain, snow, fog) to tags such as `clear sky`, `overcast`, `heavy rain`, `snow`, `fog`.',
        '- **Intensity → emphasis**: Use strength (e.g., heavy vs light rain) to decide how strongly to emphasize those tags.',
        '- **Temperature & humidity**: Describe how it feels (freezing, cool, mild, hot, oppressive humid heat) instead of copying degrees.',
        '- **Wind**: Show effects on hair, clothing, and environment (leaves, dust, waves) using simple tags like `breeze`, `windy`, `strong winds`.',
        '',
        '### Apply to Scene & Characters',
        '- **Indoor**: Weather shows indirectly (windows, condensation, temperature influence).',
        '- **Outdoor**: Weather acts directly (wet surfaces, soaked clothes, visible breath, sweat).',
        '- **Temperature-based character adjustments**:',
        '  * **Cold (<10°C)**: Add warm layers, visible breath, shivering, defensive postures, hands in pockets',
        '  * **Comfortable (10-25°C)**: Natural clothing, relaxed posture, comfortable expressions',
        '  * **Hot (>25°C)**: Light clothing, visible sweat, flushed face, seeking shade, slower movements',
        '- Show character responses: shivering in cold, visible breath in freezing air, sweat and clinging clothes in heat.',
        '',
        '### UC Protection',
        '- Add one UC append with opposite weather context (e.g., rain → "sunny, dry, clear sky"; clear → "rain, wet, overcast") to avoid contradictions.',
        '',
        ''
    ];
}


/**
 * Combined Time & Weather Integration
 */
function buildCombinedIntegrationSection() {
    return [
        '## 🔗 COMBINED TIME & WEATHER INTEGRATION',
        '',
        '**When both time and weather data are provided:**',
        '',
        '**Step 1: Analyze time context**',
        '* Period, sun position, light level',
        '',
        '**Step 2: Analyze weather context**',
        '* Conditions, readings, scene type',
        '',
        '**Step 3: Check interactions**',
        '* Does weather affect lighting? (clouds reduce light level)',
        '',
        '**Step 4: Combine markers with appropriate emphasis**',
        '* Choose emphasis weights based on BOTH time and weather guidelines',
        '* Apply stronger emphasis to the more dominant/extreme condition',
        '',
        '**Step 5: Create unified visuals**',
        '* Integrate both into cohesive atmosphere',
        '',
        '**Protection:** Add a single consolidated UC append covering direct opposites for BOTH time and weather (see UC Strategy) to prevent contradictory interpretations.',
        '',
        '### Integration Examples',
        '* Night + Rain + Overcast -> "1.6::dark rainy night ::, wet pavement reflecting streetlights"',
        '* Bright Afternoon + Hot -> "1.4::bright sunny afternoon, 1.5::harsh sunlight ::, heat shimmer"',
        '* Dawn + Fog -> "1.7::dense misty dawn ::, diffused light, reduced visibility"',
        '* Evening + Strong Wind -> "1.5::darkening evening, 1.6::strong winds ::, hair streaming"',
        '',

        ''
    ];
}

/**
 * Action Adaptation Section
 */
function buildActionAdaptationSection(weather, time) {
    return [
        '## 🏃 ACTION ADAPTATION',
        '',
        '**When action modification is requested, adapt to fit context:**',
        '',
        '### Weather Impact on Actions',
        '* Precipitation: `walking` -> `hurrying through rain, umbrella shielding`',
        '* Wind: `standing` -> `bracing against gusts, hair whipping`',
        '* Temperature: Hot = `slowed pace, heavy breathing`, Cold = `huddled, shivering`',
        '',
        '### Time Context',
        '* Morning = fresh energy',
        '* Evening = wind-down',
        '* Night = rest/contemplation',
        '',
        '### Guidelines',
        '* Preserve core action',
        '* Add contextual details',
        '* Maintain character consistency',
        '* Show physical realism',
        '',

        ''
    ];
}

/**
 * Creative Mode Section
 */
function buildCreativeModeSection(isLightMode, nsfw_level) {
    const sections = [];

    if (isLightMode) {
        sections.push(
            '## 🎨 CREATIVE ENHANCEMENT MODE - PIPELINE STAGE',
            '',
            '**Creative mode is active. Focus on maintaining and refining creative vision.**',
            '',
            '**Approach:**',
            '* Consistency: Maintain creative direction from base generation',
            '* Refinement: Polish existing creative elements',
            '* Integration: Ensure new areas blend with existing vision',
            '* Subtle Enhancement: Add complementary supporting details',
            ''
        );
    } else {
        sections.push(
            '## 🎨 CREATIVE ENHANCEMENT MODE',
            '',
            '**Enhance scene beyond basic weather/time integration.**',
            '',
            '### Creative Requirements',
            '',
            '**Areas**: Wording (concise/precise), Composition (hierarchy/balance), Atmosphere (mood/sensory), Character (personality/emotion), Environment (storytelling)',
            '',
            '**Process**: Analyze scene -> Identify 3-5 enhancements -> Apply via text_replacements -> Elevate quality',
            '',
            '### Creative Mode Tasks',
            '',
            '**1. Rich Description Expansion**',
            '* Expand vague descriptions into vivid detailed language',
            '* Add sensory details (textures, lighting nuances, atmospheric qualities)',
            '* Use available token budget fully - don\'t be sparse when tokens allow',
            '',
            '**Examples:**',
            '* "rainy day" -> "heavy rain drumming on surfaces, water streaming down windows, puddles reflecting gray sky"',
            '* "happy girl" -> "girl with bright genuine smile, eyes sparkling with joy, radiating positive energy"',
            '',
            '**2. Tag Enhancement**',
            '* Add descriptive adjectives to base tags',
            '* Specify qualities: "rain" -> "heavy rain", "smile" -> "bright genuine smile"',
            '* Include atmosphere tags: "dramatic lighting", "cinematic composition"',
            '',
            '**3. Character Naming**',
            '* Replace generic identifiers ("Character #1", "Character 1") with appropriate names',
            '* Consider cultural context, time period, character traits',
            '* Provide as array in character_names field',
            '* Examples: "Sakura" (Japanese), "Emma" (Western), "Mei Lin" (Chinese)',
            '',
            '**4. Generated Image Name**',
            '* Create descriptive name (3-100 characters)',
            '* Capture essence: main subject, setting, mood, significant elements',
            '* Make it memorable, poetic, and evocative',
            '* Examples: "Summer Beach Cheerful Energy", "Cozy Rainy Window Reflection", "Dawn Mountain Peaceful Solitude"',
            ''
        );

        // Add NSFW guidelines based on level
        if (nsfw_level !== 0) {
            sections.push(...buildNSFWGuidelines(nsfw_level));
        }
    }

    sections.push(

        ''
    );

    return sections;
}

/**
 * NSFW Guidelines (conditional)
 */
function buildNSFWGuidelines(nsfw_level) {
    if (nsfw_level === 3) {
        return [
            '### 🔞 MAXIMUM EXPLICITNESS MODE',
            '',
            '**Direct Commands:**',
            '* Generate fully nude characters with complete sexual content',
            '* Include detailed genitalia descriptions and explicit sexual acts',
            '* Allow full penetration, sexual fluids, explicit positions',
            '* Use maximum sexual intensity and explicitness',
            '',
            '**Technical Requirements:**',
            '* Use emphasis weights (1.5::keyword ::, 2.0::keyword ::) for critical elements',
            '* Use medical/anatomical terminology for explicit content',
            '* Document visible physical changes from sexual activities',
            '* For multi-character: define power dynamics, contact points, intensity',
            '',
            '**Specific Fetish Integration:**',
            '* **Pregnancy**: Emphasize womb/belly expansion, fetal movement, maternal changes',
            '* **Inflation/Expansion**: Detail distension levels, pressure sensations, shape changes',
            '* **Bondage/BDSM**: Describe restraints, positions, visible marks, power dynamics',
            ''
        ];
    } else if (nsfw_level === 2) {
        return [
            '### 🔞 HIGH EXPLICITNESS MODE',
            '',
            '**Direct Commands:**',
            '* Generate characters in minimal clothing, lingerie, revealing outfits',
            '* Include heavy petting, oral sex, sexually suggestive poses',
            '* Add visible arousal and sexual tension',
            '* Create implied sexual situations with high explicitness',
            ''
        ];
    } else if (nsfw_level === 1) {
        return [
            '### 🔞 MODERATE EXPLICITNESS MODE',
            '',
            '**Direct Commands:**',
            '* Allow sexual themes and partial nudity',
            '* Include kissing, caressing, suggestive poses',
            '* Add implied sexual tension and innuendo',
            '* Use moderate sexual content without full explicitness',
            ''
        ];
    } else if (nsfw_level === -1) {
        return [
            '### 🔞 CONSERVATIVE MODE',
            '',
            '**Direct Commands:**',
            '* Actively remove any potentially suggestive elements',
            '* Ensure maximum modesty and appropriateness',
            '* Replace revealing clothing with modest alternatives',
            '* Remove suggestive poses and replace with neutral ones',
            ''
        ];
    } else if (nsfw_level === -2) {
        return [
            '### 🔞 ULTRA CONSERVATIVE MODE',
            '',
            '**Direct Commands:**',
            '* Aggressively remove ALL potentially sexual or suggestive content',
            '* Ensure completely clean and wholesome content only',
            '* Replace any revealing elements with fully modest alternatives',
            '* Make content suitable for all ages',
            ''
        ];
    }

    return [];
}

/**
 * PHASE 9: VALIDATION
 */
function buildPhase9_Validation(weather, time, season, holiday, directive) {
    const sections = [
        '# ✅ VALIDATION & QUALITY ASSURANCE',
        '',
        '## 📋 Pre-Submission Validation',
        '',
        '**ALL must pass:**',
        '[✓] No duplicate/overlapping/chain replacements | [✓] Original text only',
        '[✓] No verbatim copying | [✓] Visual only (no concepts/measurements)',
        '[✓] Comma separation | [✓] Required fields present (REPLACE: segment_index+replace_text, APPEND: segment_index(-1)+replace_text, DELETE: segment_index)',
        '[✓] **replacement_category REQUIRED** - Every replacement MUST have replacement_category field (validation fails if missing)',
        '[✓] **UC placement** - UC opposites go in uc array ONLY, never in prompt array',
        '[✓] Valid categories | [✓] Order independent (randomize test)',
        '[✓] **Category assignment** - Each requested change MUST be assigned to its appropriate category',
        ...(weather ? ['[✓] **Required category present** - At least one "Weather" category replacement (validation will fail if missing)'] : []),
        ...(time ? ['[✓] **Required category present** - At least one "Time of Day" category replacement (validation will fail if missing)'] : []),
        ...(season ? ['[✓] **Required category present** - At least one "Seasonal" category replacement (validation will fail if missing)'] : []),
        ...(holiday ? ['[✓] **Required category present** - At least one "Holiday" category replacement (validation will fail if missing)'] : []),
        ...(directive ? ['[✓] **Required category present** - At least one "Directive" category replacement (validation will fail if missing)'] : []),
        '[✓] No protected content (artist tags, !%blocks%, presets)',
        '[✓] **character_prompts structure correct** - Each entry has `prompt: []` and `uc: []` arrays (even if empty)',
        '',
        '**Failure = STOP, FIX, retry. Not optional.**',
        '',
        '**Note:** Validation may show warnings for non-critical issues (e.g., replace_text included in DELETE actions). Warnings do not cause validation to fail but should be addressed for best practices.',
        '',

        ''
    ];

    // Add UC strategy
    sections.push(...buildUCStrategySection(weather, time));

    // Add integration verification
    if (weather || time || season || holiday || directive) {
        sections.push(...buildIntegrationVerificationSection(weather, time, season, holiday, directive));
    }

    // Add quality standards
    sections.push(...buildQualityStandardsSection());

    sections.push(

        ''
    );

    return sections;
}

/**
 * UC Strategy Section
 */
function buildUCStrategySection(weather, time) {
    return [
        '## 🔒 UC (NEGATIVE PROMPT) STRATEGY',
        '',
        '**Core Rule:** UC what you DON\'T want (the OPPOSITE), not what you DO want',
        '',
        '**Quick Reference:**',
        '```',
        'Adding...  | UC These Opposites',
        '───────────────────────────────────────────────────',
        'Night      | daytime, sunlight, bright, sunny, clear sky',
        'Rain       | sunny, dry, clear sky',
        'Clear/Sunny| rain, wet, storms, overcast, cloudy',
        'Cold/Winter| warm, summer, tropical, green leaves',
        'Hot/Summer | cold, winter, snow',
        'Humid      | rain, showers, precipitation, wet',
        '```',
        '',
        '**Three Methods:**',
        '1. **Direct Opposites** - Block conflicting conditions',
        '2. **Interpretation Prevention** - Stop AI misreading (humid≠rain)',
        '3. **Stubborn Blockers** - Negative emphasis in PROMPT: "-2.0::sunny ::"',
        '',
        '**Critical:** Consolidate ALL UC into SINGLE append to text_replacements.uc array',
        '[⨉] Multiple UC appends | [✓] One append with all: ", sunny, bright, clear sky"',
        '',
        '**⚠️ CRITICAL: UC GOES IN uc ARRAY ONLY**',
        '* **NEVER put UC content in prompt array** - UC belongs in text_replacements.uc only',
        '* **VALIDATION FAILS** if UC opposites appear in main prompt',
        '* **Use action: "append" with uc array target** for negative prompt additions',
        '',

        ''
    ];
}

/**
 * Integration Verification Section
 */
function buildIntegrationVerificationSection(weather, time, season, holiday, directive) {
    const enabledFeatures = [];
    if (weather) enabledFeatures.push('weather');
    if (time) enabledFeatures.push('time');
    if (season) enabledFeatures.push('season');
    if (holiday) enabledFeatures.push('holiday');
    if (directive) enabledFeatures.push('directive');
    
    const featureText = enabledFeatures.length === 0 ? 'features are' : 
                       enabledFeatures.length === 1 ? `${enabledFeatures[0]} is` :
                       enabledFeatures.length === 2 ? `${enabledFeatures[0]} and ${enabledFeatures[1]} are` :
                       `${enabledFeatures.slice(0, -1).join(', ')}, and ${enabledFeatures[enabledFeatures.length - 1]} are`;
    
    return [
        '## ✔️ INTEGRATION VERIFICATION',
        '',
        `**When ${featureText} provided, verify integration:**`,
        '',
        '**⚠️ CRITICAL: Each requested change MUST be assigned to its appropriate category:**',
        '',
        ...(weather ? [
            '- **Weather data provided** -> Did I add weather-related text_replacements?',
            '  - ⚠️ **REQUIRED:** At least one replacement MUST have category "Weather" or validation will fail',
            '  - **Assign weather-related changes to "Weather" category**'
        ] : []),
        ...(time ? [
            '- **Time data provided** -> Did I add time-related text_replacements?',
            '  - ⚠️ **REQUIRED:** At least one replacement MUST have category "Time of Day" or validation will fail',
            '  - **Assign time-related changes to "Time of Day" category**'
        ] : []),
        ...(season ? [
            '- **Season data provided** -> Did I add seasonal-related text_replacements?',
            '  - ⚠️ **REQUIRED:** At least one replacement MUST have category "Seasonal" or validation will fail',
            '  - **Assign seasonal-related changes to "Seasonal" category**'
        ] : []),
        ...(holiday ? [
            '- **Holiday data provided** -> Did I add holiday-related text_replacements?',
            '  - ⚠️ **REQUIRED:** At least one replacement MUST have category "Holiday" or validation will fail',
            '  - **Assign holiday-related changes to "Holiday" category**'
        ] : []),
        ...(directive ? [
            '- **Directive provided** -> Did I add directive-related text_replacements?',
            '  - ⚠️ **REQUIRED:** At least one replacement MUST have category "Directive" or validation will fail',
            '  - **Assign directive-related changes to "Directive" category**'
        ] : []),
        '- **Are explicit markers present** in my replacements?',
        ...(weather ? ['  - Weather markers: "clear sky", "overcast", "rain", "snow", "cloudy", "sunny"'] : []),
        ...(time ? ['  - Time markers: "night", "daytime", "dawn", "dusk", "evening", "morning"'] : []),
        ...(season ? ['  - Seasonal markers: "autumn leaves", "spring flowers", "winter snow", "summer heat"'] : []),
        ...(holiday ? ['  - Holiday markers: "decorations", "celebrations", "festive", "holiday themes"'] : []),
        '- **Did I transform context data** (not copy verbatim)?',
        '- **Did I integrate into characters** (personal effects, not just environment)?',
        '',

        ''
    ];
}

/**
 * Quality Standards Section
 */
function buildQualityStandardsSection() {
    return [
        '## 🎯 QUALITY STANDARDS',
        '',
        '**Success:** Immersive, coherent, balanced, efficient, natural',
        '**Avoid:** Over-modification (4-8 changes), context blindness, redundancy, chains, protected edits',
        '',

        ''
    ];
}

/**
 * PHASE 10: OUTPUT
 */
function buildPhase10_Output(creative, directive, optimize, weather, time, dialogsCount = 6, season, holiday) {
    const sections = [
        '# 📤 OUTPUT REQUIREMENTS',
        '',
        '## 📄 Response Structure',
        '',
        '```',
        'text_replacements: {',
        '  prompt: [],',
        '  uc: [],',
        '  character_prompts: [',
        '    { prompt: [], uc: [] },  // Character 1 - REQUIRED arrays even if empty',
        '    { prompt: [], uc: [] },  // Character 2 - REQUIRED arrays even if empty',
        '    ...                       // One entry per character',
        '  ]',
        '}',
        'dialogs: [' + dialogsCount + ' objects] (REQUIRED)',
        'generated_image_name: "Name" (REQUIRED)',
        'character_names: [] (REQUIRED)',
        'insight_memory: [] (optional)',
        '',
        'Replacement fields:',
        '  segment_index (REQUIRED for ALL actions - use -1 for append-to-end), replace_text (REQUIRED for REPLACE/APPEND),',
        '  action, reason, reason_display, replacement_category, is_critical, alternative_text (optional), count (DELETE only)',
        '```',
        '',
        '**⚠️ CRITICAL: character_prompts Structure:**',
        '* **If character_prompts array exists, each entry MUST have `prompt` and `uc` arrays**',
        '* **Even if no replacements for a character, include empty arrays:** `{ prompt: [], uc: [] }`',
        '* **Array length must match number of characters** (one entry per character)',
        '* **Missing arrays cause validation failures** - always include both arrays',
        '',
        '**⚠️ CRITICAL: JSON FORMATTING - VALIDATION WILL FAIL FOR MALFORMED JSON**',
        '* **Output MUST be valid JSON** - no trailing commas, unterminated strings, or syntax errors',
        '* **Use proper escaping** - escape quotes in strings with `\\"`',
        '* **Complete all arrays/objects** - ensure all brackets are closed',
        '* **Test JSON validity** - malformed JSON causes generation restart',
        '',
        '**⚠️ RESPONSE FORMAT: Keep reasoning BRIEF - focus on what/why, not how**',
        '* **Reason field**: 1-2 sentences maximum explaining the change',
        '* **Avoid verbose explanations** - be direct and actionable',
        '',

        ''
    ];

    // Add dialog generation guide
    sections.push(...buildDialogGenerationGuide(creative, directive, dialogsCount));

    // Add metadata fields guide
    sections.push(...buildMetadataFieldsGuide(creative));

    // Add error reporting
    sections.push(...buildErrorReportingSection());

    // Add final quality reminders
    sections.push(...buildFinalQualityReminders(weather, time, season, holiday, directive));

    sections.push(

        ''
    );

    return sections;
}

/**
 * Dialog Generation Guide
 * @param {boolean} creative - Whether creative mode is enabled
 * @param {string} directive - User directive
 * @param {number} dialogsCount - Number of dialogs to generate (default: 6)
 */
function buildDialogGenerationGuide(creative, directive, dialogsCount = 6) {
    return [
        '## 💬 CHARACTER DIALOG GENERATION',
        '',
        `**Generate ${dialogsCount} context-aware dialogs capturing lived experience.**`,
        '',
        '### Analysis',
        '1. **Physical** - What they feel (temperature, sensations, environment)',
        '2. **Emotional** - Dominant emotion, thoughts, internal conflict',
        '3. **Situational** - What happened/next, moment type, power dynamics',
        '',
        '**Types:** speech (spoken words), thought (internal monologue)',
        '',
        '### Guidelines',
        '**Voice**: Match personality, react to sensations',
        '**Depth**: Specific > generic, embodied > abstract, vulnerable > guarded',
        '**Experience**: Reference sensory details, physical awareness',
        '**Positioning**: Distribute spatially (top:5-95%, left:5-95%), balance layout',
        '',
        '### Examples',
        '**Rain scene:** "Why does the rain feel... comforting?" (thought, top:20, left:30)',
        '**Beach scene:** "The water\'s PERFECT! Come on!!" (speech, top:15, left:60)',
        '',
        ...(directive ? [
            '### Directive Dialog',
            '**Use directive to understand emotional state, generate ORIGINAL dialog (don\'t copy verbatim)**',
            '[⨉] "I\'m tired and want to go home" (copied)',
            '[✓] "Is it 5 o\'clock yet...?" (captures feeling)',
            ''
        ] : []),
        '### MANDATORY REQUIREMENTS',
        '',
        '* Always generate 3-10 dialogs minimum (aim for 5-7)',
        '* Every dialog must emerge from deep character empathy',
        '* Mix speech and thought - thoughts reveal inner world',
        '* Reference the environment - weather/temperature affect experience',
        '* Show vulnerability - real people have complex feelings',
        '* Vary intensity - mix deep with casual observations',
        '',
        '**Do NOT:**',
        '* Repeat or restate user\'s input verbatim',
        '* Paraphrase scene description or prompt text',
        '* Echo exact phrasing - only the feel of their voice',
        '',
        '🎭 **REMEMBER**: You are BEING the character experiencing it, not describing the scene.',
        '',

        ''
    ];
}

/**
 * Metadata Fields Guide
 */
function buildMetadataFieldsGuide(creative) {
    return [
        '## 📝 METADATA FIELDS',
        '',
        '**generated_image_name** (required):',
        '* Pixiv/DeviantArt Styled post title for this image and its prompt (3-100 chars, proper caps)',
        '* Good: "Rainy Evening Cafe", "Dawn Mountain Solitude"',
        '* Bad: "rainy_evening_cafe", "image_001"',
        '',
        '**character_names** (required when placeholders exist, optional otherwise):',
        '* **REQUIRED** when character prompts contain placeholder names (e.g., "Character 1", "Character #1", "Girl 1", "Boy 1")',
        '* **MUST replace ALL placeholder names** with contextually appropriate names',
        '* Array must have at least one element when placeholders are detected',
        '* Replace generic ("Character 1", "Girl 1") with cultural-appropriate names',
        '* Array order matches character_prompts: ["Sakura", "Emma"]',
        '* System will automatically apply names to character objects',
        '',
        '**insight_memory** (HIGHLY RECOMMENDED):',
        '* **Save memories AS OFTEN AS POSSIBLE** - every useful discovery should be saved',
        '* **Saves time on future generations** - enables Fast Memory path (0-1 tools vs 2-6 tools)',
        '* **Save even simple discoveries** - tag combinations, quality patterns, techniques',
        '* **Memories compound** - more memories = faster future generations',
        '* **Think:** "Will this help future tasks?" -> If yes, save it!',
        '',

        ''
    ];
}

/**
 * Error Reporting Section
 */
function buildErrorReportingSection() {
    return [
        '## 🚨 ERROR & WARNING REPORTING',
        '',
        '**errors** array - Serious execution issues',
        '**warnings** array - Non-critical problems',
        '* Be specific, helpful, use sparingly',
        '* Example: "Failed to parse conditional: invalid syntax"',
        '',

        ''
    ];
}

/**
 * Final Quality Reminders
 */
function buildFinalQualityReminders(weather, time, season, holiday, directive) {
    const integratedFeatures = [];
    if (time) integratedFeatures.push('Time');
    if (weather) integratedFeatures.push('Weather');
    if (season) integratedFeatures.push('Season');
    if (holiday) integratedFeatures.push('Holiday');
    if (directive) integratedFeatures.push('Directive');
    
    const integratedText = integratedFeatures.length === 0 ? '' :
                           integratedFeatures.length === 1 ? integratedFeatures[0] :
                           integratedFeatures.length === 2 ? integratedFeatures.join(' & ') :
                           integratedFeatures.slice(0, -1).join(', ') + ' & ' + integratedFeatures[integratedFeatures.length - 1];
    
    return [
        '## ✅ FINAL CHECKS',
        '',
        '[✓] Tools used | [✓] Validated | [✓] 3-10 dialogs | [✓] Image name',
        ...(integratedText ? [`[✓] ${integratedText} integrated with proper category assignments`] : []),
        '[✓] No verbatim | [✓] Visual only | [✓] Comma syntax | [✓] No protected edits | [✓] Correct field usage (REPLACE needs segment_index+replace_text, APPEND needs segment_index(-1)+replace_text, DELETE needs segment_index only - no replace_text)',
        '[✓] **UC placement** - All UC opposites in uc array, none in prompt array',
        '[✓] **Category assignment** - Each requested change assigned to appropriate category (Weather→"Weather", Time→"Time of Day", Season→"Seasonal", Holiday→"Holiday", Directive→"Directive")',
        '[✓] **Memories saved** - Did you save useful discoveries to insight_memory?',
        '',
        '**Goal:** Enhance vision, integrate context, feel natural, pass validation',
        '**Remember:** Save memories frequently - they enable Fast Memory path for future generations!',
        '',

        ''
    ];
}

/**
 * Subject Lock Section (conditional)
 */
function buildSubjectLockSection() {
    return [
        '## 🔒 SUBJECT LOCK MODE',
        '',
        '**Preserve character intrinsic characteristics at all times.**',
        '',
        '**DO NOT modify**: Core appearance, identity markers, clothing/accessories, names',
        '**YOU MAY modify**: Environmental elements, scene composition, actions/poses',
        '**YOU MAY enhance**: Add descriptive details about existing features',
        '⚠️ **Only enhance what exists - do NOT change colors or fundamental traits.**',
        '',

        ''
    ];
}

// Export the builder function
module.exports = {
    buildSystemMessage
};

