// Emphasis textarea highlight overlay

let emphasisHighlightingActive = false;
let emphasisHighlightingTarget = null;
// Pre-compiled regex patterns for better performance
const EMPHASIS_PATTERNS = {
    weightEmphasis: /(-?\d+\.?\d*)::((?:(?!-?\d+\.?\d*::).)+?)::/g,
    weightEmphasisAutoTerminating: /(-?\d+\.?\d*)::((?:(?!-?\d+\.?\d*::).)+?)(?=\s*-?\d+\.?\d*::|::|$)/g,
    braceEmphasis: /(\{+)([^}]+)(\}+)/g,
    bracketEmphasis: /(\[+)([^\]]+)(\]+)/g,
    bracketedIncrementing: /(!)\[([^\]]+)\](_*)(~\+|~)?(#)/g,
    bracketedReplacement: /(!)\[([^\]]+)\](_*)(~\+|~)?/g,
    disableSyntax: /(!)\/([^\/]+)\//g,
    incrementingSyntax: /(!)([a-zA-Z0-9_]+)#/g,
    pickCombineIncrementing: /(!)([a-zA-Z0-9_]+)~\+#/g,
    pickIncrementingSuffix: /(!)([a-zA-Z0-9_]+)~#/g,
    // Do not treat ~+ / ~ as pick when followed by # (~+# and ~# are separate patterns).
    pickReplacement: /(!)([a-zA-Z0-9_]+)(~\+(?!#)|~(?!#))/g,
    regularReplacement: /(!)([a-zA-Z0-9_]+)\b/g
};

// Store previous textarea values for NSFW tag detection
const previousTextareaValues = new WeakMap();

// Emphasis highlighting — debounced overlay pass; plain text skips the regex pipeline
const emphasisHighlightValueCache = new WeakMap();
const emphasisHighlightDebounceTimers = new WeakMap();
const EMPHASIS_HIGHLIGHT_DEBOUNCE_MS = 50;

function promptNeedsFullSyntaxHighlight(text) {
    if (!text) return false;
    return /::|[{}[\]|]|<|>|!/.test(text);
}

function cancelEmphasisHighlightUpdate(textarea) {
    if (!textarea) return;
    const timer = emphasisHighlightDebounceTimers.get(textarea);
    if (timer) {
        clearTimeout(timer);
        emphasisHighlightDebounceTimers.delete(textarea);
    }
}

function scheduleEmphasisHighlightUpdate(textarea, immediate = false) {
    if (!textarea) return;
    if (textarea.closest('.creative-directive-container, .prompt-textarea-container.director-prompt')) return;

    if (immediate) {
        cancelEmphasisHighlightUpdate(textarea);
        // scheduleTextInputSideEffect: public/scripts/comp/textareaUtils.js
        scheduleTextInputSideEffect(textarea, () => {
            updateEmphasisHighlighting(textarea);
        });
        return;
    }

    let timer = emphasisHighlightDebounceTimers.get(textarea);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
        emphasisHighlightDebounceTimers.delete(textarea);
        if (!textarea.isConnected) return;
        // isTextInputComposing: public/scripts/comp/textareaUtils.js
        if (typeof isTextInputComposing === 'function' && isTextInputComposing(textarea)) return;
        scheduleTextInputSideEffect(textarea, () => {
            updateEmphasisHighlighting(textarea);
        });
    }, EMPHASIS_HIGHLIGHT_DEBOUNCE_MS);
    emphasisHighlightDebounceTimers.set(textarea, timer);
}

function throttledUpdateEmphasisHighlighting(textarea) {
    scheduleEmphasisHighlightUpdate(textarea);
}

function startEmphasisHighlighting(textarea) {
    if (emphasisHighlightingActive && emphasisHighlightingTarget === textarea) return;
    
    // Skip emphasis highlighting for plain-text prompt fields (search highlighting only)
    if (textarea && textarea.closest('.creative-directive-container, .prompt-textarea-container.director-prompt')) return;

    emphasisHighlightingActive = true;
    emphasisHighlightingTarget = textarea;

    // wirePromptTextareaVisualUpdates: public/scripts/comp/textareaUtils.js
    wirePromptTextareaVisualUpdates(textarea);

    // autoResizeTextarea: public/scripts/comp/utilities.js
    autoResizeTextarea(textarea);
    updateEmphasisHighlighting(textarea);
}

function stopEmphasisHighlighting() {
    if (emphasisHighlightingTarget) {
        cancelEmphasisHighlightUpdate(emphasisHighlightingTarget);
        // cancelTextInputSideEffect: public/scripts/comp/textareaUtils.js
        cancelTextInputSideEffect(emphasisHighlightingTarget);
        emphasisHighlightValueCache.delete(emphasisHighlightingTarget);
    }
    
    emphasisHighlightingActive = false;
    emphasisHighlightingTarget = null;
}

function handleNsfwTagDetection(textarea, currentValue) {
    if (!textarea || !currentValue) return;

    const previousValue = previousTextareaValues.get(textarea) || '';
    const currentValueLower = currentValue.toLowerCase();
    const previousValueLower = previousValue.toLowerCase();

    // Check if "nsfw" was added (appears in current but not in previous)
    const nsfwRegex = /\bnsfw\b/gi;
    const hasNsfwNow = nsfwRegex.test(currentValueLower);
    const hadNsfwBefore = nsfwRegex.test(previousValueLower);

    if (hasNsfwNow && !hadNsfwBefore) {
        // NSFW tag was just added, remove it and set appropriate mode

        // Remove all instances of "nsfw" (case insensitive)
        let cleanedValue = currentValue.replace(nsfwRegex, '').trim();

        // Clean up extra spaces and commas
        cleanedValue = cleanedValue.replace(/\s*,\s*,/g, ',').replace(/^,\s*/, '').replace(/,\s*$/, '');

        // setTextareaValuePreservingUndo: public/scripts/comp/textareaUtils.js
        setTextareaValuePreservingUndo(textarea, cleanedValue);

        // Determine NSFW mode based on textarea type
        let nsfwMode = 1; // Default for prompts

        // Check if this is a UC textarea
        const isUcTextarea = textarea.id === 'manualUc' ||
                           textarea.id === 'manualPromptNegative' ||
                           textarea.classList.contains('uc-textarea') ||
                           textarea.closest('.character-uc-container') ||
                           textarea.getAttribute('data-type') === 'uc' ||
                           (textarea.id && textarea.id.endsWith('_uc')); // Character UC textareas

        if (isUcTextarea) {
            nsfwMode = -1; // Remove mode for UC textareas
        }

        // Set the NSFW value
        selectNsfwValue(nsfwMode);
        previousTextareaValues.set(textarea, cleanedValue);
        return;
    }

    // Store current value for next comparison
    previousTextareaValues.set(textarea, currentValue);
}

function updateEmphasisHighlighting(textarea) {
    if (!textarea) return;

    // isTextInputComposing: public/scripts/comp/textareaUtils.js
    if (typeof isTextInputComposing === 'function' && isTextInputComposing(textarea)) {
        return;
    }
    
    // Skip emphasis highlighting for creative directive container (only use search highlighting)
    if (textarea.closest('.creative-directive-container, .prompt-textarea-container.director-prompt')) return;

    // Keep golden selection highlight while emphasis editor is active
    if (emphasisEditingActive && emphasisEditingTarget === textarea && emphasisEditingSelection) {
        addEmphasisSelectionHighlight(textarea, emphasisEditingSelection);
        return;
    }

    const value = textarea.value;

    // NSFW tag detection and auto-setting
    handleNsfwTagDetection(textarea, value);

    const currentValue = textarea.value;
    const overlay = ensurePromptEmphasisHighlightOverlay(textarea);
    if (!overlay) return;

    const cachedValue = emphasisHighlightValueCache.get(textarea);
    if (cachedValue === currentValue) {
        overlay.scrollTop = textarea.scrollTop;
        overlay.scrollLeft = textarea.scrollLeft;
        return;
    }
    emphasisHighlightValueCache.set(textarea, currentValue);

    if (!promptNeedsFullSyntaxHighlight(currentValue)) {
        overlay.textContent = currentValue;
    } else {
        overlay.innerHTML = highlightEmphasisInText(currentValue);
    }

    // Sync scroll position
    overlay.scrollTop = textarea.scrollTop;
    overlay.scrollLeft = textarea.scrollLeft;
}

function initializeEmphasisOverlay(textarea) {
    if (!textarea) return;
    
    // Skip emphasis highlighting for creative directive container (only use search highlighting)
    if (textarea.closest('.creative-directive-container, .prompt-textarea-container.director-prompt')) return;

    const value = textarea.value;
    const highlightedValue = highlightEmphasisInText(value);

    const overlay = ensurePromptEmphasisHighlightOverlay(textarea);
    if (!overlay) return;

    overlay.innerHTML = highlightedValue;

    // Sync scroll position
    overlay.scrollTop = textarea.scrollTop;
    overlay.scrollLeft = textarea.scrollLeft;
}

/** Solid text color for emphasis toolbar value — mirrors highlight ramps; 1.0 = light gray (not transparent). */
function getEmphasisToolbarColor(weight) {
    if (weight === '---') return '#ff6b6b';
    const c = computeEmphasisWeightColor(weight);
    return `rgb(${c.r}, ${c.g}, ${c.b})`;
}

/** Inline emphasis highlight colors — same ramp as prompt overlay spans. */
function getEmphasisHighlightStyle(weight) {
    if (weight === '---') {
        return {
            color: '#ff6b6b',
            background: 'transparent',
            borderColor: 'transparent'
        };
    }
    const c = computeEmphasisWeightColor(weight);
    return {
        color: `rgb(${c.r}, ${c.g}, ${c.b})`,
        background: `rgba(${c.r}, ${c.g}, ${c.b}, ${c.backgroundA.toFixed(2)})`,
        borderColor: `rgba(${c.borderR}, ${c.borderG}, ${c.borderB}, ${c.borderA.toFixed(2)})`
    };
}

let cachedU1TagPattern = null;
let cachedU1TagPatternSource = null;

function getU1TagPattern() {
    if (!window.u1 || !window.u1.length) return null;
    if (cachedU1TagPattern && cachedU1TagPatternSource === window.u1) {
        return cachedU1TagPattern;
    }
    const sortedTags = [...window.u1].sort((a, b) => b.length - a.length);
    cachedU1TagPattern = new RegExp(`\\b(${sortedTags.map(tag => tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'gi');
    cachedU1TagPatternSource = window.u1;
    return cachedU1TagPattern;
}

function highlightEmphasisInText(text) {
    if (!text) return '';

    let highlightedText = text;

    // Function to calculate dynamic colors based on weight
    function getEmphasisColors(weight) {
        const c = computeEmphasisWeightColor(weight);
        return {
            background: `rgba(${c.r}, ${c.g}, ${c.b}, ${c.backgroundA.toFixed(2)})`,
            border: `rgba(${c.borderR}, ${c.borderG}, ${c.borderB}, ${c.borderA.toFixed(2)})`
        };
    }

    // Function to get group colors based on group index
    function getGroupColors(groupIndex) {
        const colors = [
            { border: 'rgba(255, 99, 132, 0.75)', background: 'rgba(255, 99, 132, 0.1)' },   // Red
            { border: 'rgba(54, 162, 235, 0.75)', background: 'rgba(54, 162, 235, 0.1)' },   // Blue
            { border: 'rgba(255, 205, 86, 0.75)', background: 'rgba(255, 205, 86, 0.1)' },   // Yellow
            { border: 'rgba(75, 192, 192, 0.75)', background: 'rgba(75, 192, 192, 0.1)' },   // Teal
            { border: 'rgba(153, 102, 255, 0.75)', background: 'rgba(153, 102, 255, 0.1)' }, // Purple
            { border: 'rgba(255, 159, 64, 0.75)', background: 'rgba(255, 159, 64, 0.1)' },   // Orange
            { border: 'rgba(199, 199, 199, 0.75)', background: 'rgba(199, 199, 199, 0.1)' }, // Gray
            { border: 'rgba(83, 102, 255, 0.75)', background: 'rgba(83, 102, 255, 0.1)' }    // Indigo
        ];
        return colors[groupIndex % colors.length];
    }

    function applyNSFWHighlighting(content) {
        const tagPattern = getU1TagPattern();
        if (!tagPattern) return content;

        return content.replace(tagPattern, (match, tag) => {
            // Check if this tag is part of a single colon pattern (like "tag:value")
            const tagIndex = content.indexOf(match);
            const beforeTag = content.substring(0, tagIndex);
            const afterTag = content.substring(tagIndex + match.length);
            
            // If there's a single colon before or after the tag, it's likely part of a tag:value pattern
            const hasSingleColonBefore = beforeTag.endsWith(':') && !beforeTag.endsWith('::');
            const hasSingleColonAfter = afterTag.startsWith(':') && !afterTag.startsWith('::');
            
            if (hasSingleColonBefore || hasSingleColonAfter) {
                return match; // Don't highlight, return as-is
            }
            
            return `<span class="emphasis-highlight" style="background: ${NSFW_TAG_HIGHLIGHT.background}; box-shadow: inset 0 0 0 1px ${NSFW_TAG_HIGHLIGHT.ring};">${tag}</span>`;
        });
    }

    function wrapGroupInnerContent(content) {
        return applyNSFWHighlighting(content);
    }

    // First, split text into groups by | and apply group highlighting
    const groups = highlightedText.split('|');
    if (groups.length > 1) {
        highlightedText = groups.map((group, index) => {
            if (group) {
                const colors = getGroupColors(index);
                return `<span class="emphasis-group" style="border: 2px dashed ${colors.border}; padding: 0; margin: -4px; border-radius: 4px; display: inline;">${group}</span>`;
            }
            return group;
        }).join('|');
    }

    // Step 0: Protect stage-conditional blocks (!-N/, !N+/, !N/) — same delimiters as embedded expander stage rules
    const stageConditionalBlocks = [];
    const protectStageBlock = (match) => {
        const blockId = `__STAGE_COND_BLOCK_${stageConditionalBlocks.length}__`;
        stageConditionalBlocks.push({ id: blockId, original: match });
        return blockId;
    };
    highlightedText = highlightedText.replace(/!-(\d+)\/([^\/]*)\//g, protectStageBlock);
    highlightedText = highlightedText.replace(/!(\d+)\+\/([^\/]*)\//g, protectStageBlock);
    highlightedText = highlightedText.replace(/!(\d+)\/([^\/]*)\//g, protectStageBlock);

    // Step 1: Protect disable blocks from further processing
    // This prevents any inner highlighting from being applied to disabled content
    const disableBlocks = [];
    highlightedText = highlightedText.replace(EMPHASIS_PATTERNS.disableSyntax, (match, exclamation, content) => {
        const blockId = `__DISABLE_BLOCK_${disableBlocks.length}__`;
        disableBlocks.push({
            id: blockId,
            original: match,
            content: content
        });
        return blockId;
    });

    // Step 2: Process all other highlighting patterns (disable blocks are now protected)
    // Find ALL emphasis patterns (both traditional and auto-terminating) from the original string
    const allEmphasis = [];
    let match;
    
    // Find traditional patterns
    while ((match = EMPHASIS_PATTERNS.weightEmphasis.exec(highlightedText)) !== null) {
        allEmphasis.push({
            type: 'traditional',
            match: match[0],
            weight: match[1],
            content: match[2],
            index: match.index,
            length: match[0].length
        });
    }
    EMPHASIS_PATTERNS.weightEmphasis.lastIndex = 0;
    
    // Find auto-terminating patterns
    while ((match = EMPHASIS_PATTERNS.weightEmphasisAutoTerminating.exec(highlightedText)) !== null) {
        allEmphasis.push({
            type: 'auto',
            match: match[0],
            weight: match[1],
            content: match[2],
            index: match.index,
            length: match[0].length
        });
    }
    
    // Filter out overlaps - traditional patterns take priority
    const filtered = [];
    for (const item of allEmphasis) {
        const overlaps = allEmphasis.some(other => {
            if (other === item) return false;
            if (other.type !== 'traditional') return false;
            const itemEnd = item.index + item.length;
            const otherEnd = other.index + other.length;
            // Check if they overlap
            return (item.index >= other.index && item.index < otherEnd) ||
                   (itemEnd > other.index && itemEnd <= otherEnd);
        });
        if (!overlaps) filtered.push(item);
    }
    
    // Process all from end to start to preserve indices
    filtered.sort((a, b) => b.index - a.index);
    
    for (const item of filtered) {
        const weightNum = parseFloat(item.weight);
        const colors = getEmphasisColors(weightNum);
        const highlightedContent = wrapGroupInnerContent(item.content);
        const replacement = item.type === 'traditional'
            ? `<span class="emphasis-highlight" style="background: ${colors.background}; border-color: ${colors.border};">${item.weight}::${highlightedContent}::</span>`
            : `<span class="emphasis-highlight" style="background: ${colors.background}; border-color: ${colors.border};">${item.weight}::${highlightedContent}</span>`;
        highlightedText = highlightedText.substring(0, item.index) + replacement + 
                         highlightedText.substring(item.index + item.length);
    }

    // Highlight brace emphasis {text} - convert to weight equivalent
    highlightedText = highlightedText.replace(EMPHASIS_PATTERNS.braceEmphasis, (match, openBraces, content, closeBraces) => {
        const braceLevel = Math.min(openBraces.length, closeBraces.length);
        const weight = 1.0 + (braceLevel * 0.1); // Convert brace level to weight (+0.1 per level)
        const colors = getEmphasisColors(weight);

        // Apply NSFW highlighting to the content inside braces
        const highlightedContent = applyNSFWHighlighting(content);

        return `<span class="emphasis-highlight" style="background: ${colors.background}; border-color: ${colors.border};">${openBraces}${highlightedContent}${closeBraces}</span>`;
    });

    // Highlight bracket emphasis [text] - convert to weight equivalent
    highlightedText = highlightedText.replace(EMPHASIS_PATTERNS.bracketEmphasis, (match, openBrackets, content, closeBrackets) => {
        const bracketLevel = Math.min(openBrackets.length, closeBrackets.length);
        const weight = 1.0 - (bracketLevel * 0.1); // Convert bracket level to weight (-0.1 per level)
        const colors = getEmphasisColors(weight);

        // Apply NSFW highlighting to the content inside brackets
        const highlightedContent = applyNSFWHighlighting(content);

        return `<span class="emphasis-highlight" style="background: ${colors.background}; border-color: ${colors.border};">${openBrackets}${highlightedContent}${closeBrackets}</span>`;
    });

    // Highlight text replacements <text> - no emphasis levels, just visual highlighting
    // Match patterns that look like valid text replacement keys (letters, numbers, underscores) - case insensitive
    // Handle bracketed incrementing syntax ![...]#
    highlightedText = highlightedText.replace(EMPHASIS_PATTERNS.bracketedIncrementing, (match, exclamation, content, underscores, suffix, hash) => {
        const backgroundColor = '#e91e63'; // Bracketed incrementing color (pink)

        // Escape special characters for HTML display
        const escapedMatch = match.replace(/!/g, '&#33;')
                                 .replace(/\[/g, '&#91;')
                                 .replace(/\]/g, '&#93;')
                                 .replace(/~/g, '&#126;')
                                 .replace(/\+/g, '&#43;')
                                 .replace(/_/g, '&#95;')
                                 .replace(/#/g, '&#35;');

        return `<span class="emphasis-highlight" style="background: ${backgroundColor}; border-color: ${backgroundColor};">${escapedMatch}</span>`;
    });

    // Handle bracketed syntax ![...] with optional suffixes
    highlightedText = highlightedText.replace(EMPHASIS_PATTERNS.bracketedReplacement, (match, exclamation, content, underscores, suffix) => {
        const backgroundColor = '#9c27b0'; // Bracketed replacement color (purple)

        // Escape special characters for HTML display
        const escapedMatch = match.replace(/!/g, '&#33;')
                                 .replace(/\[/g, '&#91;')
                                 .replace(/\]/g, '&#93;')
                                 .replace(/~/g, '&#126;')
                                 .replace(/\+/g, '&#43;')
                                 .replace(/_/g, '&#95;');

        return `<span class="emphasis-highlight" style="background: ${backgroundColor}; border-color: ${backgroundColor};">${escapedMatch}</span>`;
    });


    // Handle incrementing syntax !KEY# (must come before bracketed)
    highlightedText = highlightedText.replace(EMPHASIS_PATTERNS.incrementingSyntax, (match, exclamation, content) => {
        const backgroundColor = '#ff9800'; // Incrementing syntax color (orange)

        // Escape the ! character for HTML display
        const escapedMatch = match.replace(/!/g, '&#33;');

        return `<span class="emphasis-highlight" style="background: ${backgroundColor}; border-color: ${backgroundColor};">${escapedMatch}</span>`;
    });

    // Handle bracketed incrementing syntax ![...]#
    highlightedText = highlightedText.replace(EMPHASIS_PATTERNS.bracketedIncrementing, (match, exclamation, content, underscores, suffix, hash) => {
        const backgroundColor = '#e91e63'; // Bracketed incrementing color (pink)

        // Escape special characters for HTML display
        const escapedMatch = match.replace(/!/g, '&#33;')
                                 .replace(/\[/g, '&#91;')
                                 .replace(/\]/g, '&#93;')
                                 .replace(/~/g, '&#126;')
                                 .replace(/\+/g, '&#43;')
                                 .replace(/_/g, '&#95;')
                                 .replace(/#/g, '&#35;');

        return `<span class="emphasis-highlight" style="background: ${backgroundColor}; border-color: ${backgroundColor};">${escapedMatch}</span>`;
    });

    // Sequential combined pool ~+# — before ~+ / ~
    highlightedText = highlightedText.replace(EMPHASIS_PATTERNS.pickCombineIncrementing, (match, exclamation, content) => {
        const backgroundColor = '#ff9800';
        const escapedMatch = match.replace(/!/g, '&#33;').replace(/~/g, '&#126;').replace(/\+/g, '&#43;').replace(/#/g, '&#35;');
        return `<span class="emphasis-highlight" style="background: ${backgroundColor}; border-color: ${backgroundColor};">${escapedMatch}</span>`;
    });

    // Sticky-prefix pick ~# — before ~+ / ~
    highlightedText = highlightedText.replace(EMPHASIS_PATTERNS.pickIncrementingSuffix, (match, exclamation, content) => {
        const backgroundColor = '#f57c00';
        const escapedMatch = match.replace(/!/g, '&#33;').replace(/~/g, '&#126;').replace(/#/g, '&#35;');
        return `<span class="emphasis-highlight" style="background: ${backgroundColor}; border-color: ${backgroundColor};">${escapedMatch}</span>`;
    });

    // Handle PICK replacements with ~ and ~+ suffixes
    highlightedText = highlightedText.replace(EMPHASIS_PATTERNS.pickReplacement, (match, exclamation, content, suffix) => {
        const backgroundColor = '#628a33'; // PICK replacement color

        // Escape the ! and suffix characters for HTML display
        const escapedMatch = match.replace(/!/g, '&#33;').replace(/~/g, '&#126;').replace(/\+/g, '&#43;');

        return `<span class="emphasis-highlight" style="background: ${backgroundColor}; border-color: ${backgroundColor};">${escapedMatch}</span>`;
    });
    
    // Handle regular replacements with word boundary matching
    highlightedText = highlightedText.replace(EMPHASIS_PATTERNS.regularReplacement, (match, exclamation, content) => {
        const backgroundColor = '#8bc34a8a'; // Regular replacement color

        // Escape the ! character for HTML display
        const escapedMatch = match.replace(/!/g, '&#33;');

        return `<span class="emphasis-highlight" style="background: ${backgroundColor}; border-color: ${backgroundColor};">${escapedMatch}</span>`;
    });

    // Highlight NSFW tags in remaining text (outside of emphasis blocks)
    // Only process text that's not already inside emphasis-highlight spans
    highlightedText = highlightedText.replace(/([^<]*?)(?=<span class="emphasis-highlight"|$)/g, (match, text) => {
        const tagPattern = getU1TagPattern();
        if (!tagPattern || !text.trim()) return match;

        return text.replace(tagPattern, (tagMatch, tag) => {
            // Check if this tag is part of a single colon pattern (like "tag:value")
            // If so, don't highlight it as NSFW
            const tagIndex = text.indexOf(tagMatch);
            const beforeTag = text.substring(0, tagIndex);
            const afterTag = text.substring(tagIndex + tagMatch.length);
            
            // If there's a single colon before or after the tag, it's likely part of a tag:value pattern
            const hasSingleColonBefore = beforeTag.endsWith(':') && !beforeTag.endsWith('::');
            const hasSingleColonAfter = afterTag.startsWith(':') && !afterTag.startsWith('::');
            
            if (hasSingleColonBefore || hasSingleColonAfter) {
                return tagMatch; // Don't highlight, return as-is
            }
            
            return `<span class="emphasis-highlight" style="background: ${NSFW_TAG_HIGHLIGHT.background}; box-shadow: inset 0 0 0 1px ${NSFW_TAG_HIGHLIGHT.ring};">${tag}</span>`;
        });
    });

    // Step 3: Restore disable blocks with dark gray highlighting
    disableBlocks.forEach(block => {
        const escapedMatch = block.original.replace(/!/g, '&#33;')
                                         .replace(/\//g, '&#47;');

        highlightedText = highlightedText.replace(block.id, 
            `<span class="emphasis-highlight" style="background: ${DISABLE_SYNTAX_HIGHLIGHT.background}; border-color: ${DISABLE_SYNTAX_HIGHLIGHT.border};">${escapedMatch}</span>`
        );
    });

    // Step 4: Restore stage-conditional blocks
    stageConditionalBlocks.forEach(block => {
        const escapedMatch = block.original.replace(/!/g, '&#33;')
                                         .replace(/\//g, '&#47;');
        highlightedText = highlightedText.replace(block.id,
            `<span class="emphasis-highlight" style="background: ${DISABLE_SYNTAX_HIGHLIGHT.background}; border-color: ${DISABLE_SYNTAX_HIGHLIGHT.border};">${escapedMatch}</span>`
        );
    });

    return highlightedText;
}
