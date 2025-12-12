/**
 * Parse a NovelAI-style prompt into segments using a strict left-to-right scanner.
 * Adds verbose logging so we can trace exactly how every segment is produced.
 */
/**
 * Parse a prompt into segments using left-to-right scanning.
 * 
 * HOW IT WORKS:
 * 
 * Segments are split ONLY at commas. Plain text and emphasis groups within a segment
 * are extracted as "inner items" but don't create separate segments.
 * 
 * RULES:
 * 
 * 1. Segment Boundaries:
 *    - Segments split ONLY at commas (top-level, not inside emphasis groups)
 *    - Plain text continues in the same segment until a comma
 *    - Emphasis groups don't create segment splits unless there's a comma
 * 
 * 2. Emphasis Groups (weight::text::):
 *    - Start: weight pattern (integer or float, optionally negative) followed by ::
 *    - End: closing :: delimiter
 *    - Weight parsing: supports integers, floats with unlimited precision, negative weights
 *    - Multiple emphasis groups without commas between them = same segment (inner items)
 * 
 * 3. Backtracking Logic:
 *    - When inside an emphasis group and a new weight is detected:
 *      a) Backtrack to find a comma before the new weight
 *      b) If comma found: split segment at comma, start new segment with new weight
 *      c) If no comma: continue in same segment (new weight becomes inner item)
 * 
 * 4. Group Closure:
 *    - When :: is encountered, the emphasis group closes
 *    - After closing, check what follows:
 *      - Comma: split segment here
 *      - New weight (no comma): extend segment, add as inner item
 *      - Plain text (no comma): continue in same segment
 * 
 * 5. Left-to-Right Scanning:
 *    - Character-by-character forward scan
 *    - Tracks state: insideGroup, segmentStart, lastTopLevelCommaIndex
 *    - No lookahead or complex regex - pure state machine
 * 
 * OUTPUT:
 * - Array of segment objects, each with:
 *   - text: trimmed segment text
 *   - start/end: exact byte offsets in original text
 *   - weight: leading weight if segment starts with emphasis group (null otherwise)
 *   - innerItems: array of inner items (only if 2+ items in segment)
 *   - innerItemPositions: array of {start, end} for each inner item
 *   - separatorAfter: text between this segment and next (typically ", ")
 * 
 * @param {string} text - The prompt text to parse
 * @returns {Array} Array of segment objects
 */
function parsePromptSegments(text) {
    if (!text || typeof text !== 'string') {
        return [];
    }

    const segments = [];
    const length = text.length;

    let segmentStart = 0;
    let i = 0;
    let insideGroup = false;
    let currentWeight = null;
    let lastTopLevelCommaIndex = -1;

    /**
     * Detect if a weight group starts at the given index.
     * Weight format: [-]number[.number]:: where number can have unlimited precision.
     * Returns weight info or null.
     */
    const detectWeightGroupStart = (idx) => {
        let j = idx;
        if (text[j] === '-') {
            j++;
        }
        let sawDigit = false;
        while (j < length && /\d/.test(text[j])) {
            j++;
            sawDigit = true;
        }
        if (j < length && text[j] === '.') {
            j++;
            while (j < length && /\d/.test(text[j])) {
                j++;
                sawDigit = true;
            }
        }
        if (!sawDigit) return null;
        if (text[j] === ':' && text[j + 1] === ':') {
            const weightText = text.slice(idx, j);
            const weight = parseFloat(weightText);
            return {
                weight: Number.isNaN(weight) ? null : weight,
                advance: (j + 2) - idx
            };
        }
        return null;
    };

    /**
     * Push a new segment to the segments array.
     * Records exact start/end positions accounting for leading whitespace.
     */
    const pushSegment = (startIdx, endIdx, reason) => {
        if (endIdx <= startIdx) {
            return;
        }
        const raw = text.slice(startIdx, endIdx);
        const trimmed = raw.trim();
        if (!trimmed) {
            return;
        }
        const leadingWhitespaceMatch = raw.match(/^\s*/);
        const leadingOffset = leadingWhitespaceMatch ? leadingWhitespaceMatch[0].length : 0;
        const meta = buildSegmentMeta(trimmed);
        meta.start = startIdx + leadingOffset;
        meta.end = meta.start + trimmed.length;
        segments.push(meta);
    };

    while (i < length) {
        if (!insideGroup) {
            const ch = text[i];
            if (ch === ',') {
                // Comma delimiter - split segment here
                pushSegment(segmentStart, i, 'comma');
                lastTopLevelCommaIndex = i;
                i += 1;
                while (i < length && /\s/.test(text[i])) {
                    i++;
                }
                segmentStart = i;
                continue;
            }

            const weightInfo = detectWeightGroupStart(i);
            if (weightInfo) {
                // New emphasis group detected
                if (lastTopLevelCommaIndex >= 0 && lastTopLevelCommaIndex >= segmentStart) {
                    // If we have a tracked comma before this, split there
                    pushSegment(segmentStart, lastTopLevelCommaIndex, 'auto_split_comma');
                    segmentStart = lastTopLevelCommaIndex + 1;
                }
                insideGroup = true;
                currentWeight = weightInfo.weight;
                i += weightInfo.advance;
                continue;
            }
        } else {
            // Check for new weight start while inside an unfinished group
            const upcomingWeight = detectWeightGroupStart(i);
            if (upcomingWeight) {
                // Backtrack from new weight position to find delimiter
                let backtrackIdx = i - 1;
                let foundComma = false;
                let commaIndex = -1;
                
                // Skip whitespace immediately before the weight
                while (backtrackIdx >= segmentStart && /\s/.test(text[backtrackIdx])) {
                    backtrackIdx--;
                }
                
                // Look for comma before the weight
                while (backtrackIdx >= segmentStart) {
                    if (text[backtrackIdx] === ',') {
                        foundComma = true;
                        commaIndex = backtrackIdx;
                        break;
                    }
                    if (!/\s/.test(text[backtrackIdx])) {
                        // Hit non-whitespace before finding comma - no split
                        break;
                    }
                    backtrackIdx--;
                }
                
                if (foundComma && commaIndex >= segmentStart) {
                    // Found comma - split segment at comma
                    pushSegment(segmentStart, commaIndex, 'backtrack_comma_split');
                    // Skip comma and whitespace
                    let newSegmentStart = commaIndex + 1;
                    while (newSegmentStart < length && /\s/.test(text[newSegmentStart])) {
                        newSegmentStart++;
                    }
                    // Start new segment with the new weight
                    segmentStart = newSegmentStart;
                    insideGroup = true;
                    currentWeight = upcomingWeight.weight;
                    i = segmentStart + upcomingWeight.advance;
                    continue;
                } else {
                    // No comma found - continue in same segment (will be inner item)
                    i += upcomingWeight.advance;
                continue;
            }
        }

            if (text[i] === ':' && text[i + 1] === ':') {
                // Emphasis group closing delimiter
                insideGroup = false;
                i += 2;
                const segmentEndIndex = i;
                
                // Check whitespace and comma after group close
                let afterCloseIdx = i;
                while (afterCloseIdx < length && /\s/.test(text[afterCloseIdx])) {
                    afterCloseIdx++;
                }
                let hasCommaAfter = false;
                if (text[afterCloseIdx] === ',') {
                    lastTopLevelCommaIndex = afterCloseIdx;
                    hasCommaAfter = true;
                    afterCloseIdx++;
                    while (afterCloseIdx < length && /\s/.test(text[afterCloseIdx])) {
                        afterCloseIdx++;
                    }
                }
                
                // Check if there's a new weight right after (no comma separation)
                const nextWeight = detectWeightGroupStart(afterCloseIdx);
                if (nextWeight && !hasCommaAfter) {
                    // New weight found without comma - extend current segment instead of closing it
                    i = afterCloseIdx + nextWeight.advance;
                    insideGroup = true;
                    currentWeight = nextWeight.weight;
                    continue;
                } else if (hasCommaAfter) {
                    // Comma found - push segment and start new one after comma
                    pushSegment(segmentStart, segmentEndIndex, 'group_close');
                    segmentStart = afterCloseIdx;
                    currentWeight = null;
                    i = afterCloseIdx;
                    continue;
                } else {
                    // No comma, no new weight - plain text continues in same segment
                    // Don't close segment, just continue scanning
                    insideGroup = false;
                    currentWeight = null;
                    i = afterCloseIdx;
            continue;
                }
            }
        }

        i += 1;
    }

    // Final segment - flush remaining content
    pushSegment(segmentStart, length, 'eof');

    annotateSegmentPositions(text, segments);

    return segments;
}

/**
 * Build segment metadata: detect leading weight::content:: and inner items.
 */
function buildSegmentMeta(segmentText) {
    const trimmed = segmentText.trim();
    const weightInfo = detectWeightGroupStartGeneric(trimmed, 0);
    const weight = weightInfo ? weightInfo.weight : null;
    const innerItems = extractInnerItemsFromSegment(trimmed);
    const finalInnerItems = innerItems.length > 1 ? innerItems : [];
        return {
            text: trimmed,
        weight,
        innerItems: finalInnerItems,
        innerItemPositions: finalInnerItems.map(() => ({ start: -1, end: -1 })),
        start: -1,
        end: -1,
        separatorAfter: ''
    };
}

/**
 * Annotate each parsed segment with start/end offsets and inner item positions.
 * 
 * HOW IT WORKS:
 * 
 * 1. Segment Positions:
 *    - Uses pre-computed segment.start/end from parsePromptSegments (ground truth)
 *    - Verifies positions are correct by slicing originalText and comparing to segment.text
 *    - Falls back to indexOf search only if verification fails
 * 
 * 2. Inner Item Positions:
 *    - For segments with innerItems, computes exact byte offsets for each inner item
 *    - Uses cursor-based search within segment text to find items in order
 *    - Converts relative positions within segment to absolute positions in originalText
 *    - This ensures innerItemPositions[i] corresponds exactly to innerItems[i]
 * 
 * 3. Separator Text:
 *    - Extracts exact separator text between consecutive segments from originalText
 *    - Stores in segment.separatorAfter (typically ", " or ",")
 * 
 * GROUND TRUTH:
 * - Positions computed here are used by resolveSelectTextFromSegments
 * - Any mismatch between computed positions and actual text indicates a bug
 * - Uses left-to-right cursor to ensure items are found in correct order
 * 
 * @param {string} originalText - Original prompt text
 * @param {Array} segments - Parsed segments (modified in place to add positions)
 */
function annotateSegmentPositions(originalText, segments) {
    if (!originalText || !Array.isArray(segments) || segments.length === 0) return;

    let searchIndex = 0;
    segments.forEach(segment => {
        if (!segment || !segment.text) return;

        // Verify pre-computed positions are correct (they should be from parsePromptSegments)
        if (typeof segment.start !== 'number' || segment.start < 0 ||
            typeof segment.end !== 'number' || segment.end <= segment.start ||
            originalText.substring(segment.start, segment.end) !== segment.text) {
            // Positions don't match - search for segment text
            const idx = originalText.indexOf(segment.text, searchIndex);
            if (idx === -1) {
                segment.start = -1;
                segment.end = -1;
                segment.innerItemPositions = (segment.innerItems || []).map(() => ({ start: -1, end: -1 }));
                return;
            }
            segment.start = idx;
            segment.end = idx + segment.text.length;
        }

        searchIndex = segment.end;

        // Compute positions for inner items within this segment
        if (segment.innerItems && segment.innerItems.length > 0) {
            const segmentSource = originalText.substring(segment.start, segment.end);
            let cursor = 0; // Cursor ensures we find items in order (left-to-right)
            segment.innerItemPositions = segment.innerItems.map(item => {
                if (!item) {
                    return { start: -1, end: -1 };
                }
                // Find item starting from cursor position (ensures order)
                const relativeIndex = segmentSource.indexOf(item, cursor);
                if (relativeIndex === -1) {
                    return { start: -1, end: -1 };
                }
                // Convert relative position to absolute position in originalText
                const absoluteStart = segment.start + relativeIndex;
                const absoluteEnd = absoluteStart + item.length;
                cursor = relativeIndex + item.length; // Advance cursor for next item
                return { start: absoluteStart, end: absoluteEnd };
            });
        } else {
            segment.innerItemPositions = [];
        }
    });

    for (let i = 0; i < segments.length - 1; i++) {
        const current = segments[i];
        const next = segments[i + 1];
        if (!current || !next) continue;

        if (typeof current.end === 'number' && current.end >= 0 &&
            typeof next.start === 'number' && next.start >= current.end) {
            current.separatorAfter = originalText.substring(current.end, next.start);
        } else {
            current.separatorAfter = ', ';
        }
    }

    const last = segments[segments.length - 1];
    if (last) {
        last.separatorAfter = '';
    }
}

function detectWeightGroupStartGeneric(source, idx) {
    if (!source || idx >= source.length) return null;
    let j = idx;
    if (source[j] === '-') {
        j++;
    }
    let sawDigit = false;
    while (j < source.length && /\d/.test(source[j])) {
        j++;
        sawDigit = true;
    }
    if (j < source.length && source[j] === '.') {
        j++;
        while (j < source.length && /\d/.test(source[j])) {
            j++;
            sawDigit = true;
        }
    }
    if (!sawDigit) return null;
    if (source[j] === ':' && source[j + 1] === ':') {
        const weightText = source.slice(idx, j);
        const weight = parseFloat(weightText);
    return {
        weight: Number.isNaN(weight) ? null : weight,
            prefixLength: (j + 2) - idx
        };
    }
    return null;
}

function findNextWeightStart(source, idx) {
    let pos = idx;
    while (pos < source.length) {
        if (/\s|,/.test(source[pos])) {
            pos++;
            continue;
        }
        const info = detectWeightGroupStartGeneric(source, pos);
        if (info) {
            return pos;
        }
        pos++;
    }
    return -1;
}

/**
 * Extract inner items from a segment's text.
 * 
 * HOW IT WORKS:
 * 
 * This function scans a segment left-to-right and extracts distinct inner items.
 * Inner items are only created when a segment contains 2+ items (single-item segments
 * have empty innerItems array).
 * 
 * RULES:
 * 1. Emphasis groups (weight::text::):
 *    - Start: weight pattern followed by ::
 *    - End: Either a closing :: OR the start of a new weight group
 *    - If a new weight group is detected, its opening :: serves as the closing :: 
 *      for the previous group
 *    - Example: "2.5::text 3.0::more::" 
 *      - "2.5::text" ends before "3.0::" (no closing ::)
 *      - "3.0::more::" has explicit closing ::
 * 
 * 2. Plain text:
 *    - Collected until a comma (splits the item) or a weight group start
 *    - Example: "text1, text2 2.5::weight::"
 *      - "text1" (ends at comma)
 *      - "text2" (ends before weight start)
 *      - "2.5::weight::" (emphasis group)
 * 
 * 3. Left-to-right scanning:
 *    - Character-by-character forward scan
 *    - No lookahead beyond immediate next character
 *    - No backtracking or corrections
 * 
 * OUTPUT:
 * - Returns array of inner item strings
 * - Each item is an exact substring of segmentText
 * - Items can be concatenated with spaces to reconstruct the segment
 * 
 * @param {string} segmentText - The segment text to extract inner items from
 * @returns {string[]} Array of inner item strings (empty if segment has only 1 item)
 */
function extractInnerItemsFromSegment(segmentText) {
    if (!segmentText) return [];
    const items = [];
    const len = segmentText.length;
    let i = 0;

    while (i < len) {
        // Skip whitespace
        while (i < len && /\s/.test(segmentText[i])) {
            i++;
        }
        if (i >= len) break;

        // Check if we hit a weight group start
        const weightInfo = detectWeightGroupStartGeneric(segmentText, i);
        if (weightInfo) {
            const groupStart = i;
            const contentStart = i + weightInfo.prefixLength;
            let j = contentStart;
            
            // Scan forward to find where this group ends
            // It ends either at :: or at the start of a new weight group
            while (j < len) {
                // Check if we hit a new weight group start - that's also the end of current group
                const nextWeight = detectWeightGroupStartGeneric(segmentText, j);
                if (nextWeight) {
                    // Found new weight - this is the end of current group
                    // The :: in the new weight closes the previous group
                    const completeGroup = segmentText.slice(groupStart, j).trim();
                    if (completeGroup) {
                        items.push(completeGroup);
                    }
                    i = j; // Move to start of new weight, will be handled in next iteration
                    break;
                }
                
                // Check if we hit closing ::
                if (segmentText[j] === ':' && j + 1 < len && segmentText[j + 1] === ':') {
                    // Found closing :: - include it
                    const completeGroup = segmentText.slice(groupStart, j + 2).trim();
                    if (completeGroup) {
                        items.push(completeGroup);
                    }
                    i = j + 2; // Move past ::
                    break;
                }
                
                j++;
            }
            
            if (j >= len) {
                // Reached end without finding closing delimiter
                const incompleteGroup = segmentText.slice(groupStart, len).trim();
                if (incompleteGroup) {
                    items.push(incompleteGroup);
                }
                i = len;
            }
            continue;
        }

        // Plain text - collect until comma or next weight
        const plainStart = i;
        while (i < len) {
            if (segmentText[i] === ',') {
                // Comma splits plain text into separate items
                const plainText = segmentText.slice(plainStart, i).trim();
                if (plainText) {
                    items.push(plainText);
                }
                i++; // Skip comma
                break;
            }
            
            const nextWeight = detectWeightGroupStartGeneric(segmentText, i);
            if (nextWeight) {
                // Weight group starts - end plain text here
                const plainText = segmentText.slice(plainStart, i).trim();
                if (plainText) {
                    items.push(plainText);
                }
                // i stays at weight position, will be handled in next iteration
                break;
            }
            
            i++;
        }
        
        if (i >= len && plainStart < len) {
            // End of segment - extract remaining plain text
            const plainText = segmentText.slice(plainStart, len).trim();
            if (plainText) {
                items.push(plainText);
            }
        }
    }

    // Fallback: if no items found, return the whole segment as single item
    if (items.length === 0 && segmentText.trim()) {
        items.push(segmentText.trim());
    }

    return items;
}

/**
 * Extract separator format from original prompt text between two specific segments
 * Returns the separator pattern (', ' or ',') used between the segments
 */
function extractSeparatorFormat(originalText, seg1Input, seg2Input) {
    const normalizeSegment = (seg) => {
        if (!seg) return null;
        if (typeof seg === 'string') {
            return { text: seg, start: -1, end: -1, separatorAfter: '' };
        }
        return seg;
    };

    const seg1 = normalizeSegment(seg1Input);
    const seg2 = normalizeSegment(seg2Input);

    if (!seg1 || !seg2) return ', ';

    if (typeof seg1.end === 'number' && seg1.end >= 0 &&
        typeof seg2.start === 'number' && seg2.start >= seg1.end &&
        originalText && seg1.end <= originalText.length && seg2.start <= originalText.length) {
        const separator = originalText.substring(seg1.end, seg2.start);
        if (separator && separator.length > 0) {
            return separator;
        }
    }

    if (typeof seg1.separatorAfter === 'string' && seg1.separatorAfter.length > 0) {
        return seg1.separatorAfter;
    }

    const seg1Text = seg1.text;
    const seg2Text = seg2.text;
    if (!originalText || !seg1Text || !seg2Text) return ', ';
    
    const idx1 = originalText.indexOf(seg1Text);
    if (idx1 === -1) return ', ';
    
    const afterSeg1 = originalText.substring(idx1 + seg1Text.length);
    const idx2 = afterSeg1.indexOf(seg2Text);
    if (idx2 === -1) return ', ';
    
    const separator = afterSeg1.substring(0, idx2);
    if (separator && separator.length > 0) {
        return separator;
    }

            return ', ';
        }

/**
 * Log and flag select_text mismatches so they can be investigated.
 */
function logSelectTextAlarm(contextLabel, message) {
    const label = contextLabel || 'prompt';
    console.error(`🚨 SELECT_TEXT_MISMATCH [${label}] ${message}`);
}

function sliceOriginalText(originalText, start, end) {
    if (!originalText || typeof start !== 'number' || typeof end !== 'number') {
        return null;
    }
    if (start < 0 || end < 0 || end < start || end > originalText.length) {
        return null;
    }
    return originalText.substring(start, end);
}

/**
 * Resolve a single segment index to select_text.
 * 
 * HOW IT WORKS:
 * 
 * 1. Integer indices (e.g., 16):
 *    - Reference a whole segment
 *    - Uses segment.start/end to slice exact text from originalText
 *    - Verifies extracted text matches segment.text (logs alarm if mismatch)
 * 
 * 2. Dot notation indices (e.g., "16.0", "16.1", 16.1):
 *    - References an inner item within a segment
 *    - Format: "outer.inner" where outer is segment index, inner is inner item index (0-based)
 *    - Example: "16.0" (string) = segment 16, inner item 0 (first inner item)
 *    - Example: "16.1" or 16.1 = segment 16, inner item 1 (second inner item)
 *    - Parsing: splits on '.' to get outer and inner indices (not float math)
 *    - Note: 16.0 as a number equals 16 in JavaScript, so use string "16.0" to access inner item 0
 *    - Numbers with fractional parts (16.1, 16.2, etc.) work correctly
 *    - Uses innerItemPositions[inner] to get exact byte offsets
 *    - Verifies extracted text matches innerItems[inner] (logs alarm if mismatch)
 * 
 * 3. Validation:
 *    - All extracted text must exactly match expected text (byte-for-byte)
 *    - Positions must be valid (start >= 0, end > start)
 *    - Logs SELECT_TEXT_MISMATCH alarm for any discrepancies
 * 
 * GROUND TRUTH:
 * - Uses pre-computed segment.start/end and innerItemPositions from parsePromptSegments
 * - These positions are guaranteed accurate because they come from left-to-right scanning
 * - Any mismatch indicates a bug in segmentation or hydration logic
 * 
 * @param {number|string} segmentIdx - Segment index (integer or "17") or inner item index (number like 17.0, 17.1 or string like "17.0", "17.1")
 * @param {Array} segments - Parsed segments from parsePromptSegments
 * @param {string} originalText - Original prompt text
 * @param {string} contextLabel - Label for logging context
 * @returns {Object} { text: string, start: number, end: number, alarm: boolean }
 */
function resolveSingleSegmentIndex(segmentIdx, segments, originalText, contextLabel) {
    const result = { text: null, start: -1, end: -1, alarm: false };
    
    // Handle string or number input - split on dot if present
    let outerIdx = null;
    let innerIdx = null;
    
    if (typeof segmentIdx === 'string') {
        // String format: "17" or "17.0" or "17.1"
        if (segmentIdx === '-1') {
            return result; // Special case: append to end
        }
        const parts = segmentIdx.split('.');
        outerIdx = parseInt(parts[0], 10);
        if (parts.length > 1 && parts[1] !== undefined && parts[1] !== '') {
            innerIdx = parseInt(parts[1], 10);
        }
    } else if (typeof segmentIdx === 'number') {
        if (Number.isNaN(segmentIdx)) {
            return result;
        }
        if (segmentIdx === -1) {
            // Special case: append to end (select_text stays null)
            return result;
        }
        
        // Check if number has fractional part (not exactly an integer)
        const isInteger = segmentIdx === Math.floor(segmentIdx);
        if (!isInteger) {
            // Has fractional part - treat as inner item (e.g., 17.1, 17.2)
            outerIdx = Math.floor(segmentIdx);
            // Extract decimal digits: 17.1 -> 1, 17.12 -> 1 (only first digit)
            const decimalPart = segmentIdx - outerIdx;
            innerIdx = Math.round(decimalPart * 10);
        } else {
            // Exact integer (17, not 17.0) - whole segment
            outerIdx = segmentIdx;
            innerIdx = null;
        }
    } else {
        return result;
    }

    // Handle inner item access (e.g., 17.0, 17.1)
    if (innerIdx !== null) {
        const outerSegment = segments[outerIdx];

        if (!outerSegment) {
            logSelectTextAlarm(contextLabel, `Inner segment index ${segmentIdx} references missing outer segment ${outerIdx}`);
            result.alarm = true;
            return result;
        }

        // Check if segment has inner items (only segments with 2+ items have innerItems)
        const innerItems = outerSegment.innerItems || [];
        if (innerItems.length === 0) {
            logSelectTextAlarm(contextLabel, `Inner segment index ${segmentIdx} references segment ${outerIdx} which has no inner items`);
            result.alarm = true;
            return result;
        }

        const innerText = innerItems[innerIdx];
        if (!innerText) {
            logSelectTextAlarm(contextLabel, `Inner segment index ${segmentIdx} references missing inner item ${innerIdx} (segment ${outerIdx} has ${innerItems.length} inner items)`);
            result.alarm = true;
            return result;
        }

        // Use pre-computed innerItemPositions (ground truth from annotateSegmentPositions)
        const innerPositions = outerSegment.innerItemPositions || [];
        const pos = innerPositions[innerIdx];
    if (pos && pos.start >= 0 && pos.end >= pos.start) {
        const actual = sliceOriginalText(originalText, pos.start, pos.end);
        if (actual !== null) {
            // Verify extracted text matches expected inner item text (byte-for-byte)
            if (actual !== innerText) {
                logSelectTextAlarm(contextLabel, `Inner segment index ${segmentIdx} text mismatch. expected="${innerText}", actual="${actual}"`);
                result.alarm = true;
            }
            result.text = actual;
            result.start = pos.start;
            result.end = pos.end;
            return result;
        }
    }

    // Fallback: search within outer segment text (should rarely happen if positions are correct)
    if (outerSegment.start >= 0 && outerSegment.end >= outerSegment.start) {
        const segmentSource = sliceOriginalText(originalText, outerSegment.start, outerSegment.end) || outerSegment.text || '';
        // Use cursor-based search to find inner item in order (matching annotateSegmentPositions logic)
        let cursor = 0;
        const relativeIndex = segmentSource.indexOf(innerText, cursor);
        if (relativeIndex !== -1) {
            const absoluteStart = outerSegment.start + relativeIndex;
            const absoluteEnd = absoluteStart + innerText.length;
            const actual = sliceOriginalText(originalText, absoluteStart, absoluteEnd);
            if (actual === innerText) {
                result.text = actual;
                result.start = absoluteStart;
                result.end = absoluteEnd;
                logSelectTextAlarm(contextLabel, `Inner segment index ${segmentIdx} lacked cached offsets but was reconstructed`);
                result.alarm = true;
                return result;
            }
        }
    }

        // Final fallback: use inner item text (no positional data available)
        result.text = innerText;
        result.alarm = true;
        logSelectTextAlarm(contextLabel, `Inner segment index ${segmentIdx} lacks positional data; using inner text fallback`);
        return result;
    }

    // Integer index - whole segment (no inner item specified)
    const segment = segments[outerIdx];
    if (!segment) {
        logSelectTextAlarm(contextLabel, `Segment index ${segmentIdx} not found`);
        result.alarm = true;
        return result;
    }

    // Use pre-computed start/end positions (ground truth from parsePromptSegments)
    if (segment.start >= 0 && segment.end >= segment.start) {
        const actual = sliceOriginalText(originalText, segment.start, segment.end);
        if (actual !== null) {
            // Verify extracted text matches expected segment text (byte-for-byte)
            if (segment.text && actual !== segment.text) {
                logSelectTextAlarm(contextLabel, `Segment index ${segmentIdx} text mismatch. expected="${segment.text}", actual="${actual}"`);
                result.alarm = true;
            }
            result.text = actual;
            result.start = segment.start;
            result.end = segment.end;
            return result;
        }
    }

    // Fallback: missing positional data
    if (segment.text) {
        logSelectTextAlarm(contextLabel, `Segment index ${segmentIdx} missing positional data, using stored text fallback`);
        result.text = segment.text;
    } else {
        logSelectTextAlarm(contextLabel, `Segment index ${segmentIdx} missing both positional data and text`);
    }
    result.alarm = true;
    return result;
}

/**
 * Resolve multiple segment indices to a combined select_text.
 * 
 * HOW IT WORKS:
 * 
 * 1. Resolves each index individually using resolveSingleSegmentIndex
 * 2. Combines the texts in order with separators between them
 * 3. Separators are extracted from originalText between selections
 * 4. Verifies the combined text matches the actual slice from originalText
 * 
 * SEPARATOR HANDLING:
 * - Extracts exact separator text between selections from originalText
 * - Falls back to segment.separatorAfter if direct slice fails
 * - Logs alarm if separators can't be determined accurately
 * 
 * VALIDATION:
 * - Verifies combined text matches originalText[start:end] (byte-for-byte)
 * - Uses positions from first valid selection to last valid selection
 * - Logs SELECT_TEXT_MISMATCH alarm if verification fails
 * 
 * @param {Array} segmentIdxArray - Array of segment indices (integers or floats)
 * @param {Array} segments - Parsed segments from parsePromptSegments
 * @param {string} originalText - Original prompt text
 * @param {string} contextLabel - Label for logging context
 * @returns {Object} { text: string, start: number, end: number, alarm: boolean }
 */
function resolveMultiSegmentIndex(segmentIdxArray, segments, originalText, contextLabel) {
    const result = { text: null, start: -1, end: -1, alarm: false };
    if (!Array.isArray(segmentIdxArray) || segmentIdxArray.length === 0) {
        return result;
    }

    // Resolve each index individually
    const selections = segmentIdxArray.map(idx => resolveSingleSegmentIndex(idx, segments, originalText, contextLabel));
    const validSelections = selections.filter(sel => sel.text !== null && sel.text !== undefined);

    if (validSelections.length === 0) {
        result.alarm = selections.some(sel => sel.alarm);
        return result;
    }

    // Combine selections with separators from originalText
    let combinedText = '';
    for (let i = 0; i < validSelections.length; i++) {
        const current = validSelections[i];
        combinedText += current.text;

        if (i < validSelections.length - 1) {
            const next = validSelections[i + 1];
            // Extract separator between current and next selection
            if (current.end >= 0 && next.start >= current.end) {
                const between = sliceOriginalText(originalText, current.end, next.start);
                if (between !== null) {
                    combinedText += between;
                } else {
                    // Fallback: use segment separator format
                    const sep = extractSeparatorFormat(
                        originalText,
                        { text: current.text, start: current.start, end: current.end, separatorAfter: '' },
                        { text: next.text, start: next.start, end: next.end, separatorAfter: '' }
                    );
                    combinedText += sep;
                    logSelectTextAlarm(contextLabel, `Unable to slice separator between indices; fallback="${sep}"`);
                    result.alarm = true;
                }
            } else {
                // Invalid positional order - use fallback separator
                const sep = extractSeparatorFormat(
                    originalText,
                    { text: current.text, start: current.start, end: current.end, separatorAfter: '' },
                    { text: next.text, start: next.start, end: next.end, separatorAfter: '' }
                );
                combinedText += sep;
                logSelectTextAlarm(contextLabel, `Invalid positional order between multi-segment indices, fallback separator used`);
                result.alarm = true;
            }
        }

        if (current.alarm) {
            result.alarm = true;
        }
    }

    result.text = combinedText;

    // Verify combined text matches actual slice from originalText
    const firstValid = validSelections.find(sel => sel.start >= 0);
    const lastValid = [...validSelections].reverse().find(sel => sel.end >= 0);
    if (firstValid && lastValid && firstValid.start <= lastValid.end) {
        result.start = firstValid.start;
        result.end = lastValid.end;
        const actualSlice = sliceOriginalText(originalText, result.start, result.end);
        if (actualSlice !== null && actualSlice !== result.text) {
            // Verification failed - use actual slice as ground truth
            logSelectTextAlarm(contextLabel, `Combined multi-segment text mismatch. expected prompt slice="${actualSlice}", built="${result.text}"`);
            result.alarm = true;
            result.text = actualSlice; // Use actual slice as ground truth
        }
    } else {
        logSelectTextAlarm(contextLabel, `Unable to determine positional bounds for multi-segment selection`);
        result.alarm = true;
    }

    return result;
}

/**
 * Resolve a segment index (or array of indices) to select_text from original prompt.
 * 
 * This is the main entry point for converting segment_index values from AI responses
 * into actual select_text that can be used for text replacement.
 * 
 * SUPPORTED FORMATS:
 * - Integer: 16 (whole segment)
 * - Float: 16.1 (inner item 1 of segment 16)
 * - Array: [16, 17] (multiple segments combined)
 * - Special: -1 (append to end, returns null text)
 * 
 * USAGE:
 * This function is called by hydrateTextReplacements to convert segment_index
 * values into select_text before applying replacements.
 * 
 * GROUND TRUTH:
 * - Uses segment.start/end and innerItemPositions computed by parsePromptSegments
 * - Verifies all extracted text matches expected text (byte-for-byte)
 * - Logs SELECT_TEXT_MISMATCH alarm for any discrepancies
 * 
 * @param {number|Array} segmentIdx - Segment index or array of indices
 * @param {Array} segments - Parsed segments from parsePromptSegments
 * @param {string} originalText - Original prompt text
 * @param {string} contextLabel - Label for logging context
 * @returns {Object} { text: string|null, start: number, end: number, alarm: boolean }
 */
function resolveSelectTextFromSegments(segmentIdx, segments, originalText, contextLabel = 'prompt') {
    if (segmentIdx === null || segmentIdx === undefined) {
        return { text: null, start: -1, end: -1, alarm: false };
    }

    if (Array.isArray(segmentIdx)) {
        return resolveMultiSegmentIndex(segmentIdx, segments, originalText, contextLabel);
    }

    return resolveSingleSegmentIndex(segmentIdx, segments, originalText, contextLabel);
}

/**
 * Merge appends that select the same value by combining their replace_text values
 * @param {Array} replacements - Array of replacements to process
 */
function mergeOverlappingAppends(replacements) {
    if (!Array.isArray(replacements)) return;
    
    // Group appends by select_text
    const appendGroups = new Map(); // Map<select_text, Array<{rep, index}>>
    const indicesToRemove = new Set();
    
    // First pass: identify appends with the same select_text
    replacements.forEach((rep, index) => {
        if (!rep) return;
        const action = (rep.action || 'replace').toLowerCase();
        if (action === 'append' && rep.select_text) {
            const trimmedSelect = rep.select_text.trim();
            if (trimmedSelect) {
                if (!appendGroups.has(trimmedSelect)) {
                    appendGroups.set(trimmedSelect, []);
                }
                appendGroups.get(trimmedSelect).push({ rep, index });
            }
        }
    });
    
    // Second pass: merge appends with the same select_text
    for (const [selectText, appendList] of appendGroups.entries()) {
        if (appendList.length > 1) {
            // Multiple appends selecting the same value - merge them
            const mergedReplaceTexts = appendList
                .map(item => item.rep.replace_text || '')
                .filter(t => t.trim());
            
            if (mergedReplaceTexts.length > 0) {
                const mergedReplaceText = mergedReplaceTexts.join(', ');
                
                // Use the first append as the base and merge replace_text
                const firstAppend = appendList[0];
                firstAppend.rep.replace_text = mergedReplaceText;
                
                // Mark other appends for removal
                for (let i = 1; i < appendList.length; i++) {
                    indicesToRemove.add(appendList[i].index);
                }
                
                console.log(`🔗 Merged ${appendList.length} appends selecting "${selectText}" into single append`);
            }
        }
    }
    
    // Remove merged appends (in reverse order to maintain indices)
    const sortedIndices = Array.from(indicesToRemove).sort((a, b) => b - a);
    for (const index of sortedIndices) {
        replacements.splice(index, 1);
    }
}

/**
 * Track a mitigation action that was applied during hydration
 * @param {Object} rep - Replacement object
 * @param {string} type - Type of mitigation (e.g., 'converted_to_append', 'deconflicted', 'merged', etc.)
 * @param {string} description - Description of what was done
 * @param {string} indent - Indentation prefix for tree logging
 */
function addMitigation(rep, type, description, indent = '') {
    if (!rep.mitigations) {
        rep.mitigations = [];
    }
    rep.mitigations.push({ type, description, timestamp: Date.now() });
    console.log(`${indent}  🔧 [MITIGATION] ${type}: ${description}`);
}

/**
 * Build a lightweight summary of anchor metadata for UI visibility
 * @param {string} anchorText
 * @param {string} source
 * @returns {Object|null}
 */
function buildAnchorDetails(anchorText, source = 'unknown') {
    if (!anchorText || typeof anchorText !== 'string') {
        return null;
    }
    const trimmed = anchorText.trim();
    if (!trimmed) {
        return null;
    }
    const previewLimit = 140;
    return {
        source,
        preview: trimmed.length > previewLimit ? `${trimmed.substring(0, previewLimit)}...` : trimmed,
        length: trimmed.length
    };
}

/**
 * Pressure level classifications for tracking issues
 */
const PRESSURE_LEVELS = {
    LOW: 'low',          // Simple, understandable issues - likely intentional
    MODERATE: 'moderate', // Issues that need attention - moderate complexity
    HIGH: 'high',        // "WTF" issues - confusing or problematic
    INVALID: 'invalid'   // Flat out invalid - will definitely fail
};

/**
 * Parse a segment index to extract outer segment index and inner item index (if any)
 * Handles both string ("17.0") and number (17, 17.1) formats
 * @param {number|string|Array} segmentIdx - Segment index to parse
 * @returns {Object} { outer: number|null, inner: number|null, isInnerItem: boolean }
 */
function parseSegmentIndex(segmentIdx) {
    if (segmentIdx === null || segmentIdx === undefined || segmentIdx === -1) {
        return { outer: segmentIdx, inner: null, isInnerItem: false };
    }
    
    if (Array.isArray(segmentIdx)) {
        // Multi-segment index - no inner item
        return { outer: null, inner: null, isInnerItem: false, isArray: true };
    }
    
    if (typeof segmentIdx === 'string') {
        // String format: "17" or "17.0" or "17.1"
        const parts = segmentIdx.split('.');
        const outer = parseInt(parts[0], 10);
        if (parts.length > 1 && parts[1] !== undefined && parts[1] !== '') {
            const inner = parseInt(parts[1], 10);
            return { outer, inner, isInnerItem: true };
        }
        return { outer, inner: null, isInnerItem: false };
    }
    
    if (typeof segmentIdx === 'number') {
        // Check if number has fractional part (not exactly an integer)
        const isInteger = segmentIdx === Math.floor(segmentIdx);
        if (!isInteger) {
            // Has fractional part - treat as inner item (e.g., 17.1, 17.2)
            const outer = Math.floor(segmentIdx);
            const decimalPart = segmentIdx - outer;
            const inner = Math.round(decimalPart * 10);
            return { outer, inner, isInnerItem: true };
        }
        // Exact integer - whole segment
        return { outer: segmentIdx, inner: null, isInnerItem: false };
    }
    
    return { outer: null, inner: null, isInnerItem: false };
}

/**
 * Classify pressure level for a replacement issue
 */
function classifyPressure(rep, issue) {
    const segmentIdx = rep.segment_index;
    const action = (rep.action || 'replace').toLowerCase();
    
    // Invalid cases
    if (segmentIdx === null || segmentIdx === undefined) {
        return { level: PRESSURE_LEVELS.INVALID, reason: 'Missing segment_index' };
    }
    
    // Check for non-existent segment indices
    if (typeof segmentIdx === 'number' && segmentIdx >= 0) {
        // Will be checked against actual segments later
    }
    
    // Check for inner item access after parent replacement
    const parsed = parseSegmentIndex(segmentIdx);
    if (parsed.isInnerItem) {
        // Inner item access - moderate to high risk
        return { level: PRESSURE_LEVELS.MODERATE, reason: 'Inner item access - may be invalidated by parent replacement' };
    }
    
    // Simple understandable issues (low pressure)
    if (issue === 'prefix_overlap') {
        return { level: PRESSURE_LEVELS.LOW, reason: 'Prefix overlap - likely intentional redundancy' };
    }
    
    // Moderate issues
    if (issue === 'targeting_modified_segment') {
        return { level: PRESSURE_LEVELS.MODERATE, reason: 'Targeting segment modified by earlier replacement' };
    }
    
    return { level: PRESSURE_LEVELS.LOW, reason: 'Normal operation' };
}

/**
 * Check if two text ranges overlap
 * @param {number} start1 - Start of first range
 * @param {number} end1 - End of first range
 * @param {number} start2 - Start of second range
 * @param {number} end2 - End of second range
 * @returns {boolean} True if ranges overlap
 */
function rangesOverlap(start1, end1, start2, end2) {
    return start1 < end2 && start2 < end1;
}

/**
 * Check if replace_text starts with select_text (prefix overlap)
 * @param {string} replaceText - Replacement text
 * @param {string} selectText - Select text
 * @returns {boolean} True if replace_text starts with select_text
 */
function hasPrefixOverlap(replaceText, selectText) {
    if (!replaceText || !selectText) return false;
    const trimmedReplace = replaceText.trim();
    const trimmedSelect = selectText.trim();
    return trimmedReplace.startsWith(trimmedSelect) || trimmedSelect.startsWith(trimmedReplace);
}

/**
 * Remove overlapping prefix from replacement text
 * @param {string} replaceText - Full replacement text
 * @param {string} selectText - Select text that overlaps as prefix
 * @returns {string} Replacement text with prefix removed
 */
function removePrefixOverlap(replaceText, selectText) {
    if (!replaceText || !selectText) return replaceText;
    const trimmedReplace = replaceText.trim();
    const trimmedSelect = selectText.trim();
    if (trimmedReplace.startsWith(trimmedSelect)) {
        return trimmedReplace.substring(trimmedSelect.length).trim();
    }
    return replaceText;
}

/**
 * Container-based change tracking system
 * Maintains segment positions without shifting indexes as changes are applied
 */
class ChangeContainer {
    constructor(originalText, segments) {
        this.originalText = originalText;
        this.segments = segments;
        this.changes = []; // Array of {segmentIndex, originalText, newText, type}
        this.currentText = originalText;
    }
    
    /**
     * Get the current state of a segment, considering all applied changes
     */
    getSegmentText(segmentIndex) {
        // Check if this segment has been modified
        const change = this.changes.find(c => c.segmentIndex === segmentIndex);
        if (change) {
            return change.newText;
        }
        
        // Check if segment index is still valid
        if (segmentIndex >= 0 && segmentIndex < this.segments.length) {
            return this.segments[segmentIndex].text;
        }
        
        return null;
    }
    
    /**
     * Apply a change to the container (simulated - doesn't actually modify originalText)
     */
    applyChange(segmentIndex, originalText, newText, type = 'replace') {
        this.changes.push({ segmentIndex, originalText, newText, type });
        
        // Simulate the change in currentText for overlap detection
        const index = this.currentText.indexOf(originalText);
        if (index !== -1) {
            if (type === 'replace') {
                this.currentText = this.currentText.substring(0, index) + newText + this.currentText.substring(index + originalText.length);
            } else if (type === 'delete') {
                this.currentText = this.currentText.substring(0, index) + this.currentText.substring(index + originalText.length);
            }
        }
    }
    
    /**
     * Check if a segment has been modified
     */
    isSegmentModified(segmentIndex) {
        return this.changes.some(c => c.segmentIndex === segmentIndex);
    }
    
    /**
     * Get all modifications to a segment range
     */
    getModificationsInRange(startIndex, endIndex) {
        return this.changes.filter(c => 
            c.segmentIndex >= startIndex && c.segmentIndex <= endIndex
        );
    }
}

/**
 * Tendai: Hydrate Tanei (segment_index) to Tendai (select_text) for all Tsubo with deconfliction.
 * This converts segment indices (0, 1, 2, -1, 0.1, etc.) into actual text from the prompt segments.
 * Performs overlap detection, deconfliction, and type conversion before returning adjusted replacements.
 * 
 * @param {Object} textReplacements - The text_replacements object from AI response (Tanei - dehydrated state)
 * @param {Object} buildOptions - Build options containing basePrompt, negativePrompt, characterPrompts
 * @returns {Object} { replacements: adjusted text_replacements (Tendai - hydrated state), metadata: { pressure, promptPressure, lockedSegments } }
 */
function hydrateTextReplacements(textReplacements, buildOptions) {
    if (!textReplacements || !buildOptions) {
        return { 
            replacements: textReplacements, 
            metadata: { 
                pressure: { low: 0, moderate: 0, high: 0, invalid: 0 },
                promptPressure: { modifiedPercent: 0, lockedSegments: [] },
                lockedSegments: []
            }
        };
    }
    
    // Global metadata tracking
    const metadata = {
        pressure: { low: 0, moderate: 0, high: 0, invalid: 0 },
        promptPressure: {},
        lockedSegments: []
    };
    
    /**
     * Process a single replacement array with full deconfliction
     * @param {string} contextPath - Path for logging (e.g., "prompt", "uc", "character_prompts[0].prompt")
     */
    const hydrateFromSegments = (replacements, segments, originalText, contextPath = '') => {
        if (!Array.isArray(replacements) || !Array.isArray(segments)) return replacements;
        
        console.log(`\n🌳 [TENDAI HYDRATION TREE] Starting Tanei → Tendai hydration for: ${contextPath || 'root'}`);
        console.log(`   📊 Processing ${replacements.length} replacement(s) across ${segments.length} segment(s)`);
        
        // Initialize mitigation tracking and pressure tracking for all replacements
        replacements.forEach(rep => {
            if (rep) {
                if (!rep.mitigations) {
                    rep.mitigations = [];
                }
                if (!rep.pressure) {
                    rep.pressure = { level: PRESSURE_LEVELS.LOW, issues: [] };
                }
            }
        });
        
        // Create change container for tracking modifications
        const container = new ChangeContainer(originalText, segments);
        
        // Track locked segments (segments being modified)
        const lockedSegments = new Set();
        let totalSegmentsLength = 0;
        let modifiedSegmentsLength = 0;
        
        // Calculate total segment length for prompt pressure calculation
        segments.forEach(seg => {
            if (seg && seg.text) {
                totalSegmentsLength += seg.text.length;
            }
        });
        
        // First pass: Tendai - Hydrate all select_text values (Tanei → Tendai)
        console.log(`\n   📝 [PASS 1] Hydrating select_text from segment_index...`);
        replacements.forEach((rep, idx) => {
            if (!rep) return;
            
            const action = (rep.action || 'replace').toLowerCase();
            const segmentIdx = rep.segment_index;
            const indent = '     │  ';
            
            console.log(`\n${indent}├─ [${idx}] ${action.toUpperCase()} - segment_index: ${Array.isArray(segmentIdx) ? `[${segmentIdx.join(', ')}]` : segmentIdx}`);
            console.log(`${indent}│   Reason: ${rep.reason || '(not provided)'}`);
            
            if (segmentIdx === null || segmentIdx === undefined) {
                const pressure = classifyPressure(rep, 'missing_segment_index');
                rep.pressure = { level: pressure.level, issues: [pressure.reason] };
                metadata.pressure[pressure.level]++;
                console.log(`${indent}│   ❌ INVALID: Missing segment_index`);
                metadata.pressure.invalid++;
                return;
            }
            if (action === 'append' && segmentIdx === -1) {
                console.log(`${indent}│   ✅ Append-to-end (no select_text needed)`);
                return; // Append-to-end, no select_text needed
            }
            
            const contextLabel = `${contextPath || 'prompt'}[${idx}]`;
            const selection = resolveSelectTextFromSegments(segmentIdx, segments, originalText, contextLabel);
            
            if (selection?.text) {
                rep.select_text = selection.text;
                
                // Parse segment index to determine type and extract components
                const parsed = parseSegmentIndex(segmentIdx);
                
                if (parsed.isArray) {
                    console.log(`${indent}│   📦 Multi-segment select_text: "${selection.text.substring(0, 60)}${selection.text.length > 60 ? '...' : ''}"`);
                } else if (parsed.isInnerItem) {
                    console.log(`${indent}│   🎯 Inner item access: segment[${parsed.outer}].innerItems[${parsed.inner}] = "${selection.text.substring(0, 60)}${selection.text.length > 60 ? '...' : ''}"`);
                    
                    // Lock the outer segment (inner items modify the parent segment)
                    lockedSegments.add(parsed.outer);
                        const pressure = classifyPressure(rep, 'inner_item_access');
                        rep.pressure = { level: pressure.level, issues: [...(rep.pressure?.issues || []), pressure.reason] };
                        metadata.pressure[pressure.level]++;
                    } else {
                    console.log(`${indent}│   📍 Segment[${segmentIdx}] = "${selection.text.substring(0, 60)}${selection.text.length > 60 ? '...' : ''}"`);
                }
                
            if (selection.alarm) {
                const pressure = classifyPressure(rep, 'select_text_mismatch');
                rep.pressure = { level: pressure.level, issues: [...(rep.pressure?.issues || []), pressure.reason] };
                metadata.pressure[pressure.level]++;
                rep.select_text_alarm = true;
                    }
                } else {
                    console.log(`${indent}│   ❌ WARNING: Could not hydrate Tanei (segment_index ${segmentIdx}) to Tendai`);
                    const pressure = classifyPressure(rep, 'failed_hydration');
                    rep.pressure = { level: PRESSURE_LEVELS.HIGH, issues: [...(rep.pressure?.issues || []), 'Failed to hydrate Tanei (segment_index) to Tendai'] };
                    metadata.pressure.high++;
            }
        });
        
        // Step 2: Process replacements in order with overlap detection and deconfliction
        console.log(`\n   🔄 [PASS 2] Processing deconfliction and type conversion...`);
        const processedReplacements = replacements.map((rep, idx) => {
            if (!rep) return rep;
            
            const action = (rep.action || 'replace').toLowerCase();
            const selectText = rep.select_text;
            const replaceText = rep.replace_text || '';
            const segmentIdx = rep.segment_index;
            const indent = '     │  ';
            const subIndent = '     │    │  ';
            
            console.log(`\n${indent}├─ [${idx}] Processing ${action.toUpperCase()}`);
            
            // Skip if no select_text and not append-to-end
            if (!selectText && action !== 'append') {
                console.log(`${indent}│   ⏭️  Skipping: No select_text`);
                return rep;
            }
            if (action === 'append' && segmentIdx === -1) {
                console.log(`${indent}│   ✅ Append-to-end (no adjustments needed)`);
                return rep; // Append-to-end, no adjustments needed
            }
            
            // Check for prefix overlap (replace -> append conversion opportunity)
            if (action === 'replace' && selectText && replaceText && hasPrefixOverlap(replaceText, selectText)) {
                const newReplaceText = removePrefixOverlap(replaceText, selectText);
                if (newReplaceText !== replaceText && newReplaceText.length > 0) {
                    console.log(`${indent}│   🔄 Converting REPLACE → APPEND (prefix overlap detected)`);
                    rep.action = 'append';
                    rep.replace_text = newReplaceText;
                    // Store the overlapping prefix as anchor_text for anchoring
                    rep.anchor_text = selectText; // The prefix that overlaps
                    rep.anchor_details = buildAnchorDetails(selectText, 'prefix_overlap');
                    const pressure = classifyPressure(rep, 'prefix_overlap');
                    rep.pressure = { level: pressure.level, issues: [...(rep.pressure?.issues || []), pressure.reason] };
                    metadata.pressure[pressure.level]++;
                    addMitigation(rep, 'converted_to_append', 
                        `Replace action converted to append due to prefix overlap. Anchor preserved: "${selectText.substring(0, 50)}${selectText.length > 50 ? '...' : ''}". Removed overlapping prefix from replace_text.`, indent);
                    // Continue processing as append
                }
            }
            
            // Handle granular append (append_after) - create proper select_text with padding/anchor
            if (action === 'append' && rep.append_after !== null && rep.append_after !== undefined && selectText) {
                const appendAfter = rep.append_after;
                const appendDelimiter = rep.append_delimiter || 'space';
                const appendStandalone = rep.append_standalone || 'simple';
                
                let anchorText = '';
                let padding = '';
                
                // Find position after the specified word/position
                if (typeof appendAfter === 'string') {
                    // Find after this specific word - use word as anchor with possible padding
                    const wordIndex = selectText.indexOf(appendAfter);
                    if (wordIndex !== -1) {
                        const afterWordEnd = wordIndex + appendAfter.length;
                        anchorText = selectText.substring(0, afterWordEnd);
                        
                        // Determine padding based on delimiter and standalone mode
                        if (appendStandalone === 'standalone') {
                            padding = ', '; // Tag in list
                        } else if (appendStandalone === 'simple') {
                            padding = ' '; // Word insertion
                        } else if (appendStandalone === 'direct') {
                            padding = appendDelimiter === 'none' ? '' : (appendDelimiter === 'comma' ? ', ' : ' ');
                        }
                    }
                } else if (typeof appendAfter === 'number') {
                    // Find after Nth word (0-indexed) - use words up to that point as anchor
                    const words = selectText.split(/\s+/);
                    if (appendAfter >= 0 && appendAfter < words.length) {
                        let charPos = 0;
                        for (let i = 0; i <= appendAfter; i++) {
                            const wordStart = selectText.indexOf(words[i], charPos);
                            if (i === appendAfter) {
                                const wordEnd = wordStart + words[i].length;
                                anchorText = selectText.substring(0, wordEnd);
                                
                                // Determine padding
                                if (appendStandalone === 'standalone') {
                                    padding = ', ';
                                } else if (appendStandalone === 'simple') {
                                    padding = ' ';
                                } else if (appendStandalone === 'direct') {
                                    padding = appendDelimiter === 'none' ? '' : (appendDelimiter === 'comma' ? ', ' : ' ');
                                }
                                break;
                            }
                            charPos = wordStart + words[i].length;
                        }
                    }
                }
                
                if (anchorText) {
                    // Update select_text to include anchor with padding
                    rep.select_text = anchorText + padding;
                    rep.anchor_text = anchorText; // Store original anchor for reference
                    rep.anchor_details = buildAnchorDetails(anchorText, 'granular_append');
                    console.log(`${indent}│   🎯 Granular append: anchor="${anchorText.substring(0, 40)}...", padding="${padding}"`);
                    addMitigation(rep, 'granular_append_anchor', 
                        `Created anchor text "${anchorText.substring(0, 50)}${anchorText.length > 50 ? '...' : ''}" with padding for granular append.`, indent);
                }
            }
            
            // Handle granular replace (replace_part) - create proper select_text with padding/anchor
            if (action === 'replace' && rep.replace_part && rep.replace_part.trim() && selectText) {
                const replacePart = rep.replace_part;
                const partIndex = selectText.indexOf(replacePart);
                
                if (partIndex !== -1) {
                    // Create select_text that includes context around the part to replace
                    // Include some padding before/after for better matching
                    const beforeContext = Math.max(0, partIndex - 5); // 5 chars before
                    const afterContext = Math.min(selectText.length, partIndex + replacePart.length + 5); // 5 chars after
                    
                    const anchorText = selectText.substring(beforeContext, partIndex);
                    const fullSelectText = selectText.substring(beforeContext, afterContext);
                    
                    rep.select_text = fullSelectText;
                    rep.replace_part_anchor = anchorText; // Store anchor for reference
                    rep.replace_part_target = replacePart; // Store what to replace
                    
                    console.log(`${indent}│   🎯 Granular replace: anchor="${anchorText.substring(0, 30)}...", target="${replacePart.substring(0, 30)}..."`);
                    addMitigation(rep, 'granular_replace_anchor', 
                        `Created anchor text with context for granular replace. Target: "${replacePart.substring(0, 50)}${replacePart.length > 50 ? '...' : ''}"`, indent);
                } else {
                    console.warn(`${indent}│   ⚠️  Could not find replace_part "${replacePart}" in segment "${selectText.substring(0, 50)}..."`);
                }
            }
            
            // Parse segment index to get outer segment for modification checks
            const parsedIdx = parseSegmentIndex(segmentIdx);
            const outerSegmentIdx = parsedIdx.isInnerItem ? parsedIdx.outer : (parsedIdx.outer !== null && parsedIdx.outer >= 0 ? parsedIdx.outer : null);
            
            // Check if target segment has been modified by previous replacements
            if (action === 'replace' || action === 'delete') {
                if (outerSegmentIdx !== null && container.isSegmentModified(outerSegmentIdx)) {
                    console.log(`${indent}│   ⚠️  Target segment[${outerSegmentIdx}]${parsedIdx.isInnerItem ? `.innerItems[${parsedIdx.inner}]` : ''} already modified - updating select_text`);
                    // Segment was already modified - need to find the new text
                    const currentText = container.getSegmentText(outerSegmentIdx);
                    if (currentText && currentText !== selectText) {
                        // Update select_text to match current state
                        const oldSelect = rep.select_text;
                        rep.select_text = currentText;
                        const pressure = classifyPressure(rep, 'targeting_modified_segment');
                        rep.pressure = { level: pressure.level, issues: [...(rep.pressure?.issues || []), pressure.reason] };
                        metadata.pressure[pressure.level]++;
                        addMitigation(rep, 'updated_select_text', 
                            `Select text updated to match previously modified segment (was "${oldSelect?.substring(0, 50)}${oldSelect?.length > 50 ? '...' : ''}", now "${currentText?.substring(0, 50)}${currentText?.length > 50 ? '...' : ''}")`, indent);
                        console.log(`${subIndent}Updated: "${oldSelect?.substring(0, 40)}..." → "${currentText?.substring(0, 40)}..."`);
                    }
                }
            }
            
            // For append actions, check if target segment exists and handle modified targets
            // NOTE: applyDynamicReplacements processes ALL REPLACEs first, then ALL APPENDs
            // So we need to check if ANY REPLACE (regardless of array order) will modify this segment
            if (action === 'append' && outerSegmentIdx !== null && outerSegmentIdx !== -1) {
                // First, check if segment was already modified by a REPLACE processed earlier (in array order)
                const currentText = container.getSegmentText(outerSegmentIdx);
                if (currentText && currentText !== selectText) {
                    console.log(`${indent}│   ⚠️  Append target segment[${outerSegmentIdx}]${parsedIdx.isInnerItem ? `.innerItems[${parsedIdx.inner}]` : ''} already modified - updating anchor`);
                    const oldSelect = rep.select_text;
                    rep.select_text = currentText;
                    const pressure = classifyPressure(rep, 'targeting_modified_segment');
                    rep.pressure = { level: pressure.level, issues: [...(rep.pressure?.issues || []), pressure.reason] };
                    metadata.pressure[pressure.level]++;
                    addMitigation(rep, 'updated_append_target', 
                        `Append anchor updated to match previously modified segment (was "${oldSelect?.substring(0, 50)}${oldSelect?.length > 50 ? '...' : ''}", now "${currentText?.substring(0, 50)}${currentText?.length > 50 ? '...' : ''}")`, indent);
                    console.log(`${subIndent}Updated: "${oldSelect?.substring(0, 40)}..." → "${currentText?.substring(0, 40)}..."`);
                } else {
                    // Scan ALL replacements for REPLACE/DELETE on this segment (regardless of array order)
                    // Since REPLACEs process before APPENDs in applyDynamicReplacements, APPEND needs updated anchor
                    for (let scanIdx = 0; scanIdx < replacements.length; scanIdx++) {
                        const scanRep = replacements[scanIdx];
                        if (!scanRep) continue;
                        const scanAction = (scanRep.action || 'replace').toLowerCase();
                        if (scanAction !== 'replace' && scanAction !== 'delete') continue;
                        
                        const scanSegmentIdx = scanRep.segment_index;
                        const scanParsed = parseSegmentIndex(scanSegmentIdx);
                        const scanOuterIdx = scanParsed.isInnerItem ? scanParsed.outer : (scanParsed.outer !== null && scanParsed.outer >= 0 ? scanParsed.outer : null);
                        
                        if (scanOuterIdx === outerSegmentIdx && scanRep.replace_text) {
                            // A REPLACE will modify this segment before APPEND processes - update APPEND's anchor
                            console.log(`${indent}│   ⚠️  REPLACE detected on segment[${outerSegmentIdx}] (will process before APPEND) - updating APPEND anchor`);
                            const oldSelect = rep.select_text;
                            rep.select_text = scanRep.replace_text; // Use the REPLACE's result as anchor
                            const pressure = classifyPressure(rep, 'targeting_modified_segment');
                            rep.pressure = { level: pressure.level, issues: [...(rep.pressure?.issues || []), pressure.reason] };
                            metadata.pressure[pressure.level]++;
                            addMitigation(rep, 'updated_append_anchor_for_replace', 
                                `Append anchor updated to match REPLACE result (was "${oldSelect?.substring(0, 50)}${oldSelect?.length > 50 ? '...' : ''}", now "${scanRep.replace_text.substring(0, 50)}${scanRep.replace_text.length > 50 ? '...' : ''}") - REPLACEs process before APPENDs`, indent);
                            console.log(`${subIndent}Updated for REPLACE: "${oldSelect?.substring(0, 40)}..." → "${scanRep.replace_text.substring(0, 40)}..."`);
                            break; // Only handle first REPLACE (in case of multiple)
                        }
                    }
                }
            }
            
            // Track this change in container (only for replace/delete, not appends)
            const finalAction = (rep.action || 'replace').toLowerCase();
            const finalSelectText = rep.select_text;
            const finalReplaceText = rep.replace_text || '';
            
            // Use parsed index to get outer segment (inner items modify parent segment)
            const finalParsedIdx = parseSegmentIndex(segmentIdx);
            const finalOuterSegmentIdx = finalParsedIdx.isInnerItem ? finalParsedIdx.outer : (finalParsedIdx.outer !== null && finalParsedIdx.outer >= 0 ? finalParsedIdx.outer : null);
            
            if (finalAction === 'replace' && finalSelectText && finalOuterSegmentIdx !== null) {
                lockedSegments.add(finalOuterSegmentIdx);
                modifiedSegmentsLength += finalReplaceText.length;
                container.applyChange(finalOuterSegmentIdx, finalSelectText, finalReplaceText, 'replace');
                const innerInfo = finalParsedIdx.isInnerItem ? `.innerItems[${finalParsedIdx.inner}]` : '';
                console.log(`${indent}│   ✅ Applied REPLACE to segment[${finalOuterSegmentIdx}]${innerInfo}`);
            } else if (finalAction === 'delete' && finalSelectText && finalOuterSegmentIdx !== null) {
                lockedSegments.add(finalOuterSegmentIdx);
                modifiedSegmentsLength += finalSelectText.length; // Count deleted length
                container.applyChange(finalOuterSegmentIdx, finalSelectText, '', 'delete');
                const innerInfo = finalParsedIdx.isInnerItem ? `.innerItems[${finalParsedIdx.inner}]` : '';
                console.log(`${indent}│   ✅ Applied DELETE to segment[${finalOuterSegmentIdx}]${innerInfo}`);
            } else if (finalAction === 'append') {
                const appendInfo = finalOuterSegmentIdx !== null && finalOuterSegmentIdx !== -1 
                    ? ` after segment[${finalOuterSegmentIdx}]${finalParsedIdx.isInnerItem ? `.innerItems[${finalParsedIdx.inner}]` : ''}`
                    : ' (to end)';
                console.log(`${indent}│   ✅ Queued APPEND${appendInfo}`);
            }
            
            return rep;
        });
        
        // Calculate prompt pressure
        const modifiedPercent = totalSegmentsLength > 0 
            ? (modifiedSegmentsLength / totalSegmentsLength) * 100 
            : 0;
        
        const pathMetadata = {
            pressure: { ...metadata.pressure },
            promptPressure: {
                modifiedPercent: modifiedPercent,
                totalSegments: segments.length,
                modifiedSegments: lockedSegments.size,
                lockedSegments: Array.from(lockedSegments).sort((a, b) => a - b)
            },
            lockedSegments: Array.from(lockedSegments).sort((a, b) => a - b)
        };
        
        console.log(`\n   📊 [SUMMARY] Pressure: ${metadata.pressure.low} low, ${metadata.pressure.moderate} moderate, ${metadata.pressure.high} high, ${metadata.pressure.invalid} invalid`);
        console.log(`   📊 [SUMMARY] Prompt Pressure: ${modifiedPercent.toFixed(1)}% modified (${lockedSegments.size}/${segments.length} segments locked)`);
        console.log(`   📊 [SUMMARY] Locked segments: [${pathMetadata.lockedSegments.join(', ')}]`);
        
        return { replacements: processedReplacements, metadata: pathMetadata };
    };
    
    const basePrompt = buildOptions.basePrompt || '';
    const negativePrompt = buildOptions.negativePrompt || '';
    const baseSegments = parsePromptSegments(basePrompt);
    const ucSegments = parsePromptSegments(negativePrompt);
    
    // Process each section and collect metadata
    const results = {};
    
    if (textReplacements.prompt) {
        const result = hydrateFromSegments(textReplacements.prompt, baseSegments, basePrompt, 'prompt');
        if (result) {
            textReplacements.prompt = result.replacements;
            results.prompt = result.metadata;
            // Merge pressure metrics
            Object.keys(result.metadata.pressure).forEach(level => {
                metadata.pressure[level] += result.metadata.pressure[level];
            });
        }
    }
    
    if (textReplacements.uc) {
        const result = hydrateFromSegments(textReplacements.uc, ucSegments, negativePrompt, 'uc');
        if (result) {
            textReplacements.uc = result.replacements;
            results.uc = result.metadata;
            // Merge pressure metrics
            Object.keys(result.metadata.pressure).forEach(level => {
                metadata.pressure[level] += result.metadata.pressure[level];
            });
        }
    }
    
    if (textReplacements.character_prompts && buildOptions.characterPrompts && buildOptions.characterPrompts.length > 0) {
        results.character_prompts = [];
        textReplacements.character_prompts.forEach((charReplacements, index) => {
            if (charReplacements && buildOptions.characterPrompts[index]) {
                const charPrompt = buildOptions.characterPrompts[index].prompt || '';
                const charUc = buildOptions.characterPrompts[index].uc || '';
                const charPromptSegments = parsePromptSegments(charPrompt);
                const charUcSegments = parsePromptSegments(charUc);
                
                const charResult = {};
                
                if (charReplacements.prompt) {
                    const result = hydrateFromSegments(charReplacements.prompt, charPromptSegments, charPrompt, `character_prompts[${index}].prompt`);
                    if (result) {
                        charReplacements.prompt = result.replacements;
                        charResult.prompt = result.metadata;
                        // Merge pressure metrics
                        Object.keys(result.metadata.pressure).forEach(level => {
                            metadata.pressure[level] += result.metadata.pressure[level];
                        });
                    }
                }
                if (charReplacements.uc) {
                    const result = hydrateFromSegments(charReplacements.uc, charUcSegments, charUc, `character_prompts[${index}].uc`);
                    if (result) {
                        charReplacements.uc = result.replacements;
                        charResult.uc = result.metadata;
                        // Merge pressure metrics
                        Object.keys(result.metadata.pressure).forEach(level => {
                            metadata.pressure[level] += result.metadata.pressure[level];
                        });
                    }
                }
                
                results.character_prompts[index] = charResult;
            }
        });
    }
    
    // Aggregate all locked segments
    const allLockedSegments = [];
    if (results.prompt) allLockedSegments.push(...results.prompt.lockedSegments.map(s => ({ path: 'prompt', segment: s })));
    if (results.uc) allLockedSegments.push(...results.uc.lockedSegments.map(s => ({ path: 'uc', segment: s })));
    if (results.character_prompts) {
        results.character_prompts.forEach((charResult, idx) => {
            if (charResult?.prompt) {
                allLockedSegments.push(...charResult.prompt.lockedSegments.map(s => ({ path: `character_prompts[${idx}].prompt`, segment: s })));
            }
            if (charResult?.uc) {
                allLockedSegments.push(...charResult.uc.lockedSegments.map(s => ({ path: `character_prompts[${idx}].uc`, segment: s })));
            }
        });
    }
    
    metadata.promptPressure = results;
    metadata.lockedSegments = allLockedSegments;
    
    console.log(`\n🌳 [HYDRATION COMPLETE] Total pressure: ${metadata.pressure.low} low, ${metadata.pressure.moderate} moderate, ${metadata.pressure.high} high, ${metadata.pressure.invalid} invalid`);
    
    return { replacements: textReplacements, metadata };
}

module.exports = {
    parsePromptSegments,
    hydrateTextReplacements,
    extractSeparatorFormat,
    mergeOverlappingAppends,
    resolveSelectTextFromSegments
};


