/**
 * Create SQLite Database from Danbooru Tag Datasets
 * Directly creates SQLite database from danbooru_tagwiki.json and dataset_tags.json
 * 
 * Features:
 * - Uses IDs for efficient linking (tags linked by ID, not title)
 * - Supports multiple sources (danbooru, furry, e621) with s_count per source
 * - Hierarchical z_category table with parent relationships
 * - Handles duplicate tags across sources:
 *   - Tags are identified by normalized_title (case-insensitive, spaces normalized)
 *   - If same tag exists in multiple sources, data is merged:
 *     * Body: Prefers longer/more complete body
 *     * Category: Uses first non-null value
 *     * Source counts: Stored separately per source in tag_sources table
 *     * Other names, words, links: Combined (union of all sources)
 *   - Example: "1girl" in danbooru and furry → single tag with two source entries
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { buildTitleSearchIndexData } = require('../modules/tagTitleIndex');
const { isAfterV45Cutoff } = require('../modules/tagModelCutoff');
const { initializeTagSearchDatabase, applyCachedNovelCounts } = require('../modules/tagSearchDatabase');

// Configuration
const WIKI_DATASET_PATH = path.join(__dirname, '..', 'danbooru_tagwiki.json');
const COUNTS_DATASET_PATH = path.join(__dirname, '..', 'dataset_tags.json');
const FURRY_DATASET_PATH = path.join(__dirname, '..', 'dataset_tags_furry.json');
const E621_WIKI_CSV_PATH = path.join(__dirname, '..', 'wiki_pages-2025-11-21.csv');
const DUMPS_DIR = path.join(__dirname, '..', 'data', 'dumps');
const DATABASE_PATH = path.join(__dirname, '..', '.cache', 'tag_wiki.db');
const DATABASE_BUILD_PATH = `${DATABASE_PATH}.building`;
const DATASET_GROUPS_PATH = path.join(__dirname, '..', 'dataset_tag_groups.json');

// Source identifiers (numeric: 0=memory, 1=danbooru, 2=e621)
const SOURCE_MEMORY = 0;
const SOURCE_DANBOORU = 1;
const SOURCE_E621 = 2;

// Relationship identifiers (numeric for compression)
// Note: "own" relationship is handled by tag_wikis table (primary relationship), not stored here
const RELATIONSHIP_APPEARS = 0;     // Tag appears/mentioned in wiki (general reference)
const RELATIONSHIP_RELATED = 1;     // Tag is in "Related:" (e621), "Related tags:" (e621), or "See also" (danbooru) section
const RELATIONSHIP_REPLACES = 2;    // Tag is deprecated, this tag should be used instead
const RELATIONSHIP_NOT_TO_BE_CONFUSED = 3;  // Tag is in "Not to be confused with" section (negative link - corrects user)

/**
 * Normalize tag title for matching (handles underscores, spaces, case)
 */
function normalizeTitle(title) {
    if (!title) return '';
    return title.toLowerCase().replace(/[_\s]+/g, ' ').trim();
}

/**
 * Check if a date string is after May 29, 2025 (V4.5 training cutoff).
 * @param {string|null} dateStr - Date string to check
 * @returns {boolean} True if date is after May 29, 2025, false otherwise
 */
function isUntrainedDate(dateStr) {
    return isAfterV45Cutoff(dateStr);
}

function findNewestCsv(dir, matcher) {
    if (!fs.existsSync(dir)) return null;
    const files = fs.readdirSync(dir).filter((name) => matcher.test(name));
    files.sort((a, b) => {
        const aTime = fs.statSync(path.join(dir, a)).mtimeMs;
        const bTime = fs.statSync(path.join(dir, b)).mtimeMs;
        return bTime - aTime;
    });
    return files.length ? path.join(dir, files[0]) : null;
}

function resolveE621WikiCsvPath() {
    return findNewestCsv(DUMPS_DIR, /^e621_wiki_pages.*\.csv$/i)
        || findNewestCsv(path.join(__dirname, '..'), /^wiki_pages-.*\.csv$/i)
        || (fs.existsSync(E621_WIKI_CSV_PATH) ? E621_WIKI_CSV_PATH : null);
}

function resolveDumpCsv(basenamePrefix) {
    const exact = path.join(DUMPS_DIR, `${basenamePrefix}.csv`);
    if (fs.existsSync(exact)) return exact;
    return findNewestCsv(DUMPS_DIR, new RegExp(`^${basenamePrefix}.*\\.csv$`, 'i'));
}

/**
 * Tokenize tag title with special syntax termination rules
 * 
 * Special syntax that terminates sequences:
 * - `[` `{` - Opening brackets: next non-special character terminates sequence
 * - `]` `}` - Closing brackets: next non-special character terminates sequence  
 * - `::` - Emphasis group terminator: hard stop, nothing can be added after
 * - `float::` (e.g., `2.5::`) - Emphasis group start, `::` after terminates
 * - `,` - Comma separates tags/phrases: next character terminates (space optional)
 * - `!` - Text expander placeholder start: space terminates
 * 
 * @param {string} title - Tag title to tokenize
 * @param {string} specialToken - Token to use for special characters (default: '§')
 * @returns {Array<Object>} Array of token objects: { type: 'word'|'special'|'terminator', value: string, position: number }
 */
function tokenizeTagTitleWithTerminators(title, specialToken = '§') {
    if (!title) return [];
    
    const tokens = [];
    let currentWord = '';
    let i = 0;
    const len = title.length;
    
    while (i < len) {
        const char = title[i];
        const nextChar = i + 1 < len ? title[i + 1] : null;
        const prevChar = i > 0 ? title[i - 1] : null;
        
        // Check for emphasis group terminator "::"
        if (char === ':' && nextChar === ':') {
            // Flush current word if any
            if (currentWord.trim()) {
                tokens.push({
                    type: 'word',
                    value: currentWord.trim().toLowerCase(),
                    position: i - currentWord.length
                });
                currentWord = '';
            }
            // Add terminator token (hard stop)
            tokens.push({
                type: 'terminator',
                value: '::',
                position: i
            });
            i += 2; // Skip both colons
            continue;
        }
        
        // Check for emphasis group start pattern: "float::" (e.g., "2.5::")
        // Pattern: number(s) followed by "::"
        if (/[0-9]/.test(char)) {
            let numStr = '';
            let j = i;
            // Collect number (including decimal point)
            while (j < len && (/[0-9.]/.test(title[j]))) {
                numStr += title[j];
                j++;
            }
            // Check if followed by "::"
            if (j + 1 < len && title[j] === ':' && title[j + 1] === ':') {
                // Flush current word if any
                if (currentWord.trim()) {
                    tokens.push({
                        type: 'word',
                        value: currentWord.trim().toLowerCase(),
                        position: i - currentWord.length
                    });
                    currentWord = '';
                }
                // Add emphasis start token
                tokens.push({
                    type: 'special',
                    value: specialToken, // Represent the number as special
                    position: i
                });
                // Add terminator for "::"
                tokens.push({
                    type: 'terminator',
                    value: '::',
                    position: j
                });
                i = j + 2; // Skip number and "::"
                continue;
            }
        }
        
        // Check for opening brackets: `[` or `{`
        if (char === '[' || char === '{') {
            // Flush current word if any
            if (currentWord.trim()) {
                tokens.push({
                    type: 'word',
                    value: currentWord.trim().toLowerCase(),
                    position: i - currentWord.length
                });
                currentWord = '';
            }
            // Add opening bracket as special token
            tokens.push({
                type: 'special',
                value: specialToken,
                position: i
            });
            // The next non-special character will terminate sequences
            i++;
            continue;
        }
        
        // Check for closing brackets: `]` or `}`
        if (char === ']' || char === '}') {
            // Flush current word if any
            if (currentWord.trim()) {
                tokens.push({
                    type: 'word',
                    value: currentWord.trim().toLowerCase(),
                    position: i - currentWord.length
                });
                currentWord = '';
            }
            // Add closing bracket as special token
            tokens.push({
                type: 'special',
                value: specialToken,
                position: i
            });
            // The next non-special character will terminate sequences
            i++;
            continue;
        }
        
        // Check for comma: `,` (separates tags/phrases)
        if (char === ',') {
            // Flush current word if any
            if (currentWord.trim()) {
                tokens.push({
                    type: 'word',
                    value: currentWord.trim().toLowerCase(),
                    position: i - currentWord.length
                });
                currentWord = '';
            }
            // Add comma as terminator (next character terminates)
            tokens.push({
                type: 'terminator',
                value: ',',
                position: i
            });
            i++;
            continue;
        }
        
        // Check for text expander start: `!` (space terminates)
        if (char === '!') {
            // Flush current word if any
            if (currentWord.trim()) {
                tokens.push({
                    type: 'word',
                    value: currentWord.trim().toLowerCase(),
                    position: i - currentWord.length
                });
                currentWord = '';
            }
            // Add text expander start as special token
            tokens.push({
                type: 'special',
                value: specialToken,
                position: i
            });
            // Space will terminate sequences after this
            i++;
            continue;
        }
        
        // Check for other special characters (parentheses, etc.)
        if (/[^a-z0-9\s]/.test(char)) {
            // Flush current word if any
            if (currentWord.trim()) {
                tokens.push({
                    type: 'word',
                    value: currentWord.trim().toLowerCase(),
                    position: i - currentWord.length
                });
                currentWord = '';
            }
            // Add as generic special token
            tokens.push({
                type: 'special',
                value: specialToken,
                position: i
            });
            i++;
            continue;
        }
        
        // Regular character (letter, number, or space)
        if (char === ' ') {
            // Flush current word if any
            if (currentWord.trim()) {
                tokens.push({
                    type: 'word',
                    value: currentWord.trim().toLowerCase(),
                    position: i - currentWord.length
                });
                currentWord = '';
            }
            // Skip spaces (they're just separators)
            i++;
            continue;
        }
        
        // Accumulate word character
        currentWord += char;
        i++;
    }
    
    // Flush any remaining word
    if (currentWord.trim()) {
        tokens.push({
            type: 'word',
            value: currentWord.trim().toLowerCase(),
            position: i - currentWord.length
        });
    }
    
    return tokens;
}

/**
 * Generate word sequences from tokenized title with termination rules
 * 
 * Sequences stop at terminators and don't cross certain boundaries:
 * - Stop at `::` (emphasis terminator) - hard stop, nothing can be added after
 * - Stop at `,` (tag separator) - next character terminates (space optional)
 * - Stop after `[` `{` `]` `}` (bracket boundaries) - next non-special character terminates
 * - Stop after `!` if followed by space (text expander) - space terminates
 * 
 * @param {string} title - Tag title
 * @param {string} specialToken - Token for special characters (default: '§')
 * @returns {Array<Object>} Array of sequence objects: { sequence: string, length: number, startPos: number, endPos: number }
 */
function generateTagSequencesWithTerminators(title, specialToken = '§') {
    if (!title) return [];
    
    const tokens = tokenizeTagTitleWithTerminators(title, specialToken);
    const sequences = [];
    const lowerTitle = title.toLowerCase();
    
    // Generate sequences from tokens, respecting termination rules
    for (let startPos = 0; startPos < tokens.length; startPos++) {
        // Skip if starting at a terminator
        if (tokens[startPos].type === 'terminator') {
            continue;
        }
        
        let sequence = '';
        let wordCount = 0;
        let lastBracketPos = -1; // Track last bracket position
        
        for (let endPos = startPos; endPos < tokens.length; endPos++) {
            const token = tokens[endPos];
            const nextToken = endPos + 1 < tokens.length ? tokens[endPos + 1] : null;
            
            // Hard stop at terminators (:: or ,)
            if (token.type === 'terminator') {
                // Store sequence up to this point (before terminator)
                if (wordCount > 0 && sequence.trim()) {
                    sequences.push({
                        sequence: sequence.trim(),
                        length: wordCount,
                        startPos: tokens[startPos].position,
                        endPos: endPos > 0 ? tokens[endPos - 1].position + (tokens[endPos - 1].value.length || 0) : tokens[startPos].position
                    });
                }
                break; // Hard stop, can't continue past terminator
            }
            
            // Track brackets - sequences shouldn't cross bracket boundaries
            if (token.type === 'special' && token.value === specialToken) {
                // Check if this is a bracket by looking at original title
                const origChar = lowerTitle[token.position];
                if (origChar === '[' || origChar === '{' || origChar === ']' || origChar === '}') {
                    lastBracketPos = endPos;
                    // If we're starting after a bracket, don't include content before it
                    if (startPos > lastBracketPos && endPos === startPos) {
                        // This sequence starts after a bracket, include the bracket token
                        sequence += token.value;
                    }
                }
            }
            
            // Check for text expander termination: `!` followed by space
            if (token.type === 'special' && token.value === specialToken) {
                const origChar = lowerTitle[token.position];
                if (origChar === '!' && nextToken && nextToken.type === 'word') {
                    // Text expander: space terminates, but we can include the word after !
                    // Continue to include the word
                }
            }
            
            // Build sequence
            if (sequence) {
                // Add space before word tokens, but not before/after special token
                if (token.type === 'word' && 
                    sequence[sequence.length - 1] !== specialToken && 
                    sequence[sequence.length - 1] !== ' ') {
                    sequence += ' ';
                }
            }
            
            sequence += token.value;
            
            // Count words (not special tokens or terminators)
            if (token.type === 'word') {
                wordCount++;
            }
            
            // Store sequence if it has at least one word
            if (wordCount > 0) {
                const normalizedSequence = sequence.trim();
                if (normalizedSequence.length > 0) {
                    sequences.push({
                        sequence: normalizedSequence,
                        length: wordCount,
                        startPos: tokens[startPos].position,
                        endPos: token.position + (token.value.length || 0)
                    });
                }
            }
            
            // Check for bracket boundary termination
            // After a closing bracket `]` or `}`, stop if next token is a word
            if (token.type === 'special' && token.value === specialToken) {
                const origChar = lowerTitle[token.position];
                if ((origChar === ']' || origChar === '}') && nextToken && nextToken.type === 'word') {
                    // Store sequence up to this point
                    if (wordCount > 0 && sequence.trim()) {
                        sequences.push({
                            sequence: sequence.trim(),
                            length: wordCount,
                            startPos: tokens[startPos].position,
                            endPos: token.position + (token.value.length || 0)
                        });
                    }
                    // Don't break - allow sequences that start after the bracket
                }
            }
        }
    }
    
    // Also extract sequences from within parentheses (for flexible matching)
    // These are independent sequences that can be matched separately
    const parenMatches = lowerTitle.matchAll(/\(([^)]+)\)/g);
    for (const match of parenMatches) {
        const parenContent = match[1].trim();
        if (parenContent.length > 0) {
            const parenWords = parenContent.split(/\s+/).filter(w => w.length > 0);
            // Generate sequences from parenthetical content
            for (let startPos = 0; startPos < parenWords.length; startPos++) {
                for (let length = 1; length <= parenWords.length - startPos; length++) {
                    const sequence = parenWords.slice(startPos, startPos + length).join(' ');
                    sequences.push({
                        sequence: sequence,
                        length: length,
                        startPos: match.index + 1 + parenContent.indexOf(parenWords[startPos]),
                        endPos: match.index + 1 + parenContent.indexOf(parenWords[startPos + length - 1]) + parenWords[startPos + length - 1].length
                    });
                }
            }
        }
    }
    
    // Deduplicate sequences (same sequence, length, startPos)
    const seen = new Set();
    return sequences.filter(seq => {
        const key = `${seq.sequence}|${seq.length}|${seq.startPos}`;
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

/**
 * Comprehensive wiki body normalization for storage
 * Applies minimal transforms needed for storage and reference extraction
 * KEEPS RAW DTEXT FORMAT - no markdown conversion
 * This ensures we store the original DText syntax for later conversion to markdown/HTML
 * 
 * Converts:
 * - Newlines to standard format
 * - Tag group prefixes to normalized form
 * - Post/thumb references to special wiki link format [[file@postthumbid]] (static "file" prefix)
 * - External links to file:// format for reference tracking
 * 
 * Does NOT convert:
 * - MediaWiki headers (h1., h2., etc.) - kept as DText
 * - MediaWiki syntax ([b], [i], [section=], etc.) - kept as DText
 * - Code blocks, spoiler tags - kept as DText
 * 
 * @param {string} text - Raw wiki body text
 * @param {string} wikiTitle - Title of the wiki (for post/thumb link conversion)
 * @param {number} source - Source identifier (0=custom, 1=danbooru, 2=e621)
 * @returns {Object} Object with { body: normalizedBody, postThumbRefs: array, externalUrlRefs: array }
 */
function normalizeWikiBody(text, wikiTitle = '', source = 0) {
    if (!text || typeof text !== 'string') {
        return { body: text || '', postThumbRefs: [], externalUrlRefs: [] };
    }
    
    let normalized = text;
    const postThumbRefs = []; // Array of { id, type: 'post'|'thumb', source, wikiTitle }
    const externalUrlRefs = []; // Array of { uniqueId, url, source, wikiTitle }
    let nextUrlId = 1; // Counter for unique URL IDs
    
    // 1. Normalize newlines: convert \r\n and \r to \n (standardize line endings)
    normalized = normalized.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    
    // 2. Normalize tag_group: prefix - convert "tag group:" to "tag_group:" (with underscore)
    // Remove any spaces after the colon
    normalized = normalized.replace(/tag\s+group:\s*/gi, 'tag_group:');
    // Also handle cases where it's already "tag_group:" but has spaces after colon
    normalized = normalized.replace(/tag_group:\s+/gi, 'tag_group:');
    
    // 3. Convert post/thumb references to special wiki link format [[file@postthumbid]]
    // Must happen before other conversions to preserve the IDs
    // Pattern: post #12345, !post #12345, thumb #12345, !thumb #12345
    // Uses static "file" prefix for consistency
    normalized = normalized.replace(/(!?)(post|thumb)\s+#(\d+)/gi, (match, exclamation, type, id) => {
        const refType = type.toLowerCase() === 'post' ? 'post' : 'thumb';
        const refId = parseInt(id, 10);
        
        // Store reference for later download
        postThumbRefs.push({
            id: refId,
            type: refType,
            source: source,
            wikiTitle: wikiTitle || ''
        });
        
        // Convert to special wiki link format: [[file@postthumbid]] (static "file" prefix)
        return `[[file@${refType}${refId}]]`;
    });
    
    // 4. Convert external links: "text":http://url or "text":[http://url] -> file://<uniqueid> format
    // Store URLs for later download
    normalized = normalized.replace(/"([^"]+)":\[?(https?:\/\/[^\s\]\)]+)\]?/gi, (match, linkText, url) => {
        // Generate unique ID for this URL
        const uniqueId = `url${nextUrlId++}`;
        
        // Store reference for later download
        externalUrlRefs.push({
            uniqueId: uniqueId,
            url: url,
            linkText: linkText,
            source: source,
            wikiTitle: wikiTitle || ''
        });
        
        // Convert to file:// format: [text](file://uniqueid)
        return `[${linkText}](file://${uniqueId})`;
    });
    
    // Also handle markdown-style links that might already exist: [text](http://url)
    normalized = normalized.replace(/\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)/gi, (match, linkText, url) => {
        // Skip if already converted to file://
        if (url.startsWith('file://')) {
            return match;
        }
        
        // Generate unique ID for this URL
        const uniqueId = `url${nextUrlId++}`;
        
        // Store reference for later download
        externalUrlRefs.push({
            uniqueId: uniqueId,
            url: url,
            linkText: linkText,
            source: source,
            wikiTitle: wikiTitle || ''
        });
        
        // Convert to file:// format
        return `[${linkText}](file://${uniqueId})`;
    });
    
    // NOTE: We do NOT convert to markdown here - keep raw DText format
    // Headers stay as h1., h2., etc.
    // MediaWiki syntax stays as [b], [i], [section=], etc.
    // This allows us to convert to markdown or HTML on-demand when retrieving
    
    return {
        body: normalized,
        postThumbRefs: postThumbRefs,
        externalUrlRefs: externalUrlRefs
    };
}

/**
 * Convert wiki markup to markdown (extracted from tag-lookup.js)
 */
function convertWikiMarkupToMarkdown(text) {
    if (!text) return '';
    let converted = text;

    const replacements = [
        { regex: /\[b\]([\s\S]*?)\[\/b\]/gi, replacement: '**$1**' },
        { regex: /\[i\]([\s\S]*?)\[\/i\]/gi, replacement: '*$1*' },
        { regex: /\[u\]([\s\S]*?)\[\/u\]/gi, replacement: '__$1__' },
        { regex: /\[s\]([\s\S]*?)\[\/s\]/gi, replacement: '~~$1~~' },
        { regex: /\[tt\]([\s\S]*?)\[\/tt\]/gi, replacement: '`$1`' },
        { regex: /\[code\]([\s\S]*?)\[\/code\]/gi, replacement: '```\n$1\n```' },
        { regex: /'''([\s\S]+?)'''/g, replacement: '**$1**' },
        { regex: /''([\s\S]+?)''/g, replacement: '*$1*' }
    ];

    replacements.forEach(({ regex, replacement }) => {
        converted = converted.replace(regex, replacement);
    });

    converted = converted.replace(/\[quote(?:=[^\]]+)?\]([\s\S]*?)\[\/quote\]/gi, (_, content) => {
        const trimmed = content.trim();
        if (!trimmed) return '';
        return trimmed.split('\n').map(line => `> ${line}`.trimEnd()).join('\n');
    });

    // Handle nested [section=...] tags - multiple opening tags can be closed by a single [/section]
    // Convert to markdown headers with special markers to identify collapsible sections
    // Format: [section=name] -> ### [SECTION:name]
    // This makes it easy to identify and extract collapsible sections later
    // Process from start to end, tracking section depth
    let processed = '';
    let remaining = converted;
    const sectionStack = [];
    
    while (remaining.length > 0) {
        const sectionOpenMatch = remaining.match(/\[section=([^\]]+)\]/i);
        const sectionCloseMatch = remaining.match(/\[\/section\]/i);
        
        // Determine which comes first
        let nextMatch = null;
        let matchType = null;
        
        if (sectionOpenMatch && sectionCloseMatch) {
            if (sectionOpenMatch.index < sectionCloseMatch.index) {
                nextMatch = sectionOpenMatch;
                matchType = 'open';
            } else {
                nextMatch = sectionCloseMatch;
                matchType = 'close';
            }
        } else if (sectionOpenMatch) {
            nextMatch = sectionOpenMatch;
            matchType = 'open';
        } else if (sectionCloseMatch) {
            nextMatch = sectionCloseMatch;
            matchType = 'close';
        }
        
        if (!nextMatch) {
            // No more sections, append remaining text
            processed += remaining;
            break;
        }
        
        // Append text before the match
        processed += remaining.substring(0, nextMatch.index);
        
        if (matchType === 'open') {
            const sectionName = nextMatch[1].trim();
            sectionStack.push(sectionName);
            // Use special marker format: ### [SECTION:name]
            processed += `\n### [SECTION:${sectionName}]\n`;
            remaining = remaining.substring(nextMatch.index + nextMatch[0].length);
        } else {
            // Close all open sections
            if (sectionStack.length > 0) {
                sectionStack.length = 0;
            }
            processed += '\n';
            remaining = remaining.substring(nextMatch.index + nextMatch[0].length);
        }
    }
    
    converted = processed;
    converted = converted.replace(/\[hr\]/gi, '\n---\n');

    return converted;
}

/**
 * Slugify anchor value (extracted from tag-lookup.js)
 */
function slugifyAnchor(value) {
    if (!value) return '';
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

/**
 * Normalize heading title and extract anchor (extracted from tag-lookup.js)
 */
function normalizeHeadingTitle(rawTitle, sectionIndex, anchorCounts) {
    let title = rawTitle || '';
    const anchors = [];

    // Extract anchors from [#anchor|text] or [#anchor]
    title = title.replace(/\[#([^\]\|]+)(?:\|[^\]]+)?\]/g, (_, anchor) => {
        if (anchor) {
            anchors.push(anchor.trim());
        }
        return '';
    });

    // Remove anchor links in double brackets
    title = title.replace(/\[\[#([^\]\|]+)(?:\|[^\]]+)?\]\]/g, '');
    // Remove wiki links with display text: [[display|tag]] -> tag
    title = title.replace(/\[\[([^\|\]]+)\|([^\]]+)\]\]/g, '$2');
    // Remove wiki links: [[tag]] -> tag
    title = title.replace(/\[\[([^\]]+)\]\]/g, '$1');
    // Convert wiki markup to markdown
    title = convertWikiMarkupToMarkdown(title);
    // Normalize whitespace
    title = title.replace(/\s+/g, ' ').trim();

    // Generate anchor from first anchor found or from title
    const anchorBaseSource = anchors.length > 0 ? anchors[0] : title;
    let anchorBase = slugifyAnchor(anchorBaseSource);
    if (!anchorBase) {
        anchorBase = `section-${sectionIndex + 1}`;
    }

    // Handle duplicate anchors
    const currentCount = anchorCounts.get(anchorBase) || 0;
    anchorCounts.set(anchorBase, currentCount + 1);
    const anchor = currentCount === 0 ? anchorBase : `${anchorBase}-${currentCount}`;

    // Fallback title if empty
    if (!title) {
        title = `Section ${sectionIndex + 1}`;
    }

    return { title, anchor };
}

/**
 * Extract wiki sections from body text (extracted from tag-lookup.js)
 * IMPORTANT: This function expects raw DText body text (not markdown).
 * Body should be normalized via normalizeWikiBody() which does minimal normalization
 * (newlines, tag_group prefix, post/thumb refs, external URLs) but keeps DText syntax.
 * 
 * This function handles DText headers (h1., h2., etc.) and [section=] tags directly.
 * 
 * Returns array of section objects with normalized titles and anchors
 * @param {string} bodyText - Raw DText wiki body text (from normalizeWikiBody())
 * @returns {Array<Object>} Array of section objects with: index, level, title, anchor, startOffset, endOffset, lineIndex
 */
function extractWikiSections(bodyText) {
    if (!bodyText || typeof bodyText !== 'string') {
        return { sections: [], bodyWithEndMarkers: bodyText };
    }

    // Body text is raw DText format (h1., h2., etc. headers, [b], [i], [section=] tags)
    // Offsets are calculated based on this raw DText text
    const lines = bodyText.split('\n');
    const sections = [];
    const anchorCounts = new Map();
    let offset = 0;

    const registerSection = (level, rawTitle, lineIdx, startOffset, sectionType = 0) => {
        // normalizeHeadingTitle will further normalize the section title (removes wiki links, converts markup, etc.)
        const { title, anchor } = normalizeHeadingTitle(rawTitle || '', sections.length, anchorCounts);
        const sectionLevel = Math.max(1, Math.min(level || 3, 6));
        
        // Find parent section: the most recent section with a lower level number
        let parentSectionIndex = null;
        for (let i = sections.length - 1; i >= 0; i--) {
            if (sections[i].level < sectionLevel) {
                parentSectionIndex = i;
                break;
            }
        }
        
        // section_index is 0-based (first section = 0, second = 1, etc.)
        // This is stored in database and converted to 1-based for display
        sections.push({
            index: sections.length,  // 0-based index (primary identifier for section lookup)
            level: sectionLevel,
            title,
            anchor,
            startOffset,
            lineIndex: lineIdx,
            sectionType: sectionType,  // 0=normal, 1=collapsible
            parentSectionIndex: parentSectionIndex  // Index of parent section (will be converted to ID later)
        });
    };

    // First pass: Extract [section=] blocks (they span multiple lines)
    // We need to handle these before line-by-line processing
    const sectionBlocks = [];
    const sectionBlockRegex = /\[section=([^\]]+)\]([\s\S]*?)(?:\[\/section\]|(?=\[section=)|$)/gi;
    let sectionMatch;
    while ((sectionMatch = sectionBlockRegex.exec(bodyText)) !== null) {
        const sectionTitle = sectionMatch[1].trim();
        const sectionContent = sectionMatch[2].replace(/\[\/section\]\s*$/, '').trim();
        const sectionStartOffset = sectionMatch.index;
        const sectionEndOffset = sectionMatch.index + sectionMatch[0].length;
        
        // Find the line index for this section
        const textBeforeSection = bodyText.substring(0, sectionStartOffset);
        const lineIndex = textBeforeSection.split('\n').length - 1;
        
        sectionBlocks.push({
            title: sectionTitle,
            startOffset: sectionStartOffset,
            endOffset: sectionEndOffset,
            lineIndex: lineIndex,
            level: 3, // Default to h3 level for collapsible sections
            sectionType: 1 // Collapsible
        });
    }
    
    // Second pass: Extract regular headers line-by-line
    lines.forEach((line, lineIndex) => {
        const trimmed = line.trim();
        let matched = false;

        // Match DText headers: h1., h2., h3., h4., h5., h6.
        // Format: h1. Title or h1#id. Title
        const dtextHeaderMatch = trimmed.match(/^h([1-6])(?:#([^\s\.]+))?\.\s*(.+)$/i);
        if (dtextHeaderMatch) {
            const level = parseInt(dtextHeaderMatch[1], 10);
            const sectionTitle = dtextHeaderMatch[3];
            registerSection(level, sectionTitle, lineIndex, offset, 0);
            matched = true;
        }
        
        // Match [h1] through [h6] header tags
        const headerTagMatch = trimmed.match(/^\[h([1-6])\](.+)\[\/h\1\]$/i);
        if (headerTagMatch) {
            const level = parseInt(headerTagMatch[1], 10);
            const sectionTitle = headerTagMatch[2];
            registerSection(level, sectionTitle, lineIndex, offset, 0);
            matched = true;
        }

        offset += line.length + 1;
    });
    
    // Third pass: Add [section=] blocks as sections (after regular headers to maintain order)
    // Sort by start offset to maintain document order
    sectionBlocks.sort((a, b) => a.startOffset - b.startOffset);
    for (const sectionBlock of sectionBlocks) {
        // Check if this section overlaps with any existing section
        const overlaps = sections.some(s => 
            (sectionBlock.startOffset >= s.startOffset && sectionBlock.startOffset < s.endOffset) ||
            (sectionBlock.endOffset > s.startOffset && sectionBlock.endOffset <= s.endOffset)
        );
        
        if (!overlaps) {
            registerSection(sectionBlock.level, sectionBlock.title, sectionBlock.lineIndex, sectionBlock.startOffset, sectionBlock.sectionType);
        }
    }
    
    // Sort all sections by start offset to ensure correct order
    sections.sort((a, b) => a.startOffset - b.startOffset);
    // Re-index sections after sorting
    sections.forEach((section, idx) => {
        section.index = idx;
    });

    if (sections.length === 0) {
        return { sections: [], bodyWithEndMarkers: bodyText };
    }

    // Calculate end offsets based on raw DText body text
    // These offsets will match the stored raw body in the database
    sections.forEach((section, idx) => {
        section.endOffset = idx + 1 < sections.length ? sections[idx + 1].startOffset : bodyText.length;
    });

    // Return sections and raw body (no end markers - use offsets from sections table for extraction)
    // End markers were an optimization, but storing raw DText is cleaner
    // Section extraction can use start_offset and end_offset from the database
    return { sections, bodyWithEndMarkers: bodyText };
}

/**
 * Extract wiki-style links ([[tag]] or [[tag|display]]) from body text
 * Returns array of { title, position } objects
 */
function extractWikiLinks(bodyText = '') {
    if (!bodyText || typeof bodyText !== 'string') {
        return [];
    }
    const links = [];
    const regex = /\[\[([^\]]+)\]\]/g;
    let match;
    while ((match = regex.exec(bodyText)) !== null) {
        let target = match[1];
        if (!target) continue;
        target = target.split('|')[0];
        target = target.split('#')[0];
        target = target.replace(/_/g, ' ').trim();
        if (!target) continue;
        const lower = target.toLowerCase();
        if (lower.startsWith('tag group:') || lower.startsWith('tag_group:') ||
            lower.startsWith('help:') || lower.startsWith('e621:')) {
            continue;
        }
        links.push({
            title: target,
            position: match.index
        });
    }
    return links;
}

/**
 * Extract tag/wiki name from e621/danbooru URL
 * Handles various URL patterns: view, create, edit, search, etc.
 * @param {URL} urlObj - Parsed URL object
 * @returns {Object|null} Object with { tagName, wikiTitle, source } or null
 */
function extractTagOrWikiFromUrl(urlObj) {
    if (!urlObj || !urlObj.hostname) return null;
    
    const hostname = urlObj.hostname.toLowerCase();
    const pathname = urlObj.pathname || '';
    const searchParams = urlObj.searchParams;
    
    // e621.net patterns
    if (hostname === 'e621.net') {
        // Tag view: /tags/{id} or /tags?name={tag_name}
        if (pathname.startsWith('/tags/')) {
            const tagId = pathname.split('/tags/')[1]?.split('/')[0];
            if (tagId && /^\d+$/.test(tagId)) {
                return { tagId: tagId, source: 'e621', type: 'tag_view' };
            }
        }
        if (pathname === '/tags' && searchParams.has('name')) {
            const tagName = searchParams.get('name');
            if (tagName) {
                return { tagName: decodeURIComponent(tagName), source: 'e621', type: 'tag_view' };
            }
        }
        
        // Wiki view: /wiki_pages/{id} or /wiki_pages?title={title}
        if (pathname.startsWith('/wiki_pages/')) {
            const wikiId = pathname.split('/wiki_pages/')[1]?.split('/')[0];
            if (wikiId && /^\d+$/.test(wikiId)) {
                return { wikiId: wikiId, source: 'e621', type: 'wiki_view' };
            }
        }
        if (pathname === '/wiki_pages') {
            if (searchParams.has('title')) {
                const wikiTitle = searchParams.get('title');
                if (wikiTitle) {
                    return { wikiTitle: decodeURIComponent(wikiTitle), source: 'e621', type: 'wiki_view' };
                }
            }
        }
        
        // Tag create/edit: /tags/new, /tags/{id}/edit
        if (pathname === '/tags/new' || pathname.match(/^\/tags\/\d+\/edit/)) {
            // Check query params for tag name
            if (searchParams.has('name')) {
                const tagName = searchParams.get('name');
                if (tagName) {
                    return { tagName: decodeURIComponent(tagName), source: 'e621', type: 'tag_create_edit' };
                }
            }
        }
        
        // Wiki create/edit: /wiki_pages/new, /wiki_pages/{id}/edit
        if (pathname === '/wiki_pages/new' || pathname.match(/^\/wiki_pages\/\d+\/edit/)) {
            // Check query params or form data for title
            if (searchParams.has('title')) {
                const wikiTitle = searchParams.get('title');
                if (wikiTitle) {
                    return { wikiTitle: decodeURIComponent(wikiTitle), source: 'e621', type: 'wiki_create_edit' };
                }
            }
            if (searchParams.has('wiki_page[title]')) {
                const wikiTitle = searchParams.get('wiki_page[title]');
                if (wikiTitle) {
                    return { wikiTitle: decodeURIComponent(wikiTitle), source: 'e621', type: 'wiki_create_edit' };
                }
            }
        }
    }
    
    // danbooru.donmai.us patterns
    if (hostname === 'danbooru.donmai.us') {
        // Tag view: /tags/{id}
        if (pathname.startsWith('/tags/')) {
            const tagId = pathname.split('/tags/')[1]?.split('/')[0];
            if (tagId && /^\d+$/.test(tagId)) {
                return { tagId: tagId, source: 'danbooru', type: 'tag_view' };
            }
        }
        if (pathname === '/tags' && searchParams.has('search[name]')) {
            const tagName = searchParams.get('search[name]');
            if (tagName) {
                return { tagName: decodeURIComponent(tagName), source: 'danbooru', type: 'tag_view' };
            }
        }
        
        // Wiki view: /wiki_pages/{id} or /wiki_pages?search[title]={title}
        if (pathname.startsWith('/wiki_pages/')) {
            const wikiId = pathname.split('/wiki_pages/')[1]?.split('/')[0];
            if (wikiId && /^\d+$/.test(wikiId)) {
                return { wikiId: wikiId, source: 'danbooru', type: 'wiki_view' };
            }
        }
        if (pathname === '/wiki_pages' || pathname === '/wiki_pages/') {
            if (searchParams.has('search[title]')) {
                const wikiTitle = searchParams.get('search[title]');
                if (wikiTitle) {
                    return { wikiTitle: decodeURIComponent(wikiTitle), source: 'danbooru', type: 'wiki_view' };
                }
            }
            if (searchParams.has('title')) {
                const wikiTitle = searchParams.get('title');
                if (wikiTitle) {
                    return { wikiTitle: decodeURIComponent(wikiTitle), source: 'danbooru', type: 'wiki_view' };
                }
            }
        }
        
        // Tag create/edit: /tags/new, /tags/{id}/edit
        if (pathname === '/tags/new' || pathname.match(/^\/tags\/\d+\/edit/)) {
            if (searchParams.has('tag[name]')) {
                const tagName = searchParams.get('tag[name]');
                if (tagName) {
                    return { tagName: decodeURIComponent(tagName), source: 'danbooru', type: 'tag_create_edit' };
                }
            }
            if (searchParams.has('search[name]')) {
                const tagName = searchParams.get('search[name]');
                if (tagName) {
                    return { tagName: decodeURIComponent(tagName), source: 'danbooru', type: 'tag_create_edit' };
                }
            }
        }
        
        // Wiki create/edit: /wiki_pages/new, /wiki_pages/{id}/edit
        if (pathname === '/wiki_pages/new' || pathname.match(/^\/wiki_pages\/\d+\/edit/)) {
            if (searchParams.has('wiki_page[title]')) {
                const wikiTitle = searchParams.get('wiki_page[title]');
                if (wikiTitle) {
                    return { wikiTitle: decodeURIComponent(wikiTitle), source: 'danbooru', type: 'wiki_create_edit' };
                }
            }
            if (searchParams.has('search[title]')) {
                const wikiTitle = searchParams.get('search[title]');
                if (wikiTitle) {
                    return { wikiTitle: decodeURIComponent(wikiTitle), source: 'danbooru', type: 'wiki_create_edit' };
                }
            }
        }
    }
    
    return null;
}

/**
 * Extract content links from DText body (file:, post:, image:, wiki: formats)
 * @param {string} bodyText - Raw DText wiki body text
 * @returns {Array<Object>} Array of link objects with: type, id, displayText, startOffset, endOffset
 */
function extractWikiContentLinks(bodyText) {
    if (!bodyText || typeof bodyText !== 'string') {
        return [];
    }
    
    const links = [];
    
    // Pattern for file:, post:, image:, wiki: links
    // Format: file:123, post:456, image:789, wiki:title
    // Can also have display text: file:123|display text
    const linkPatterns = [
        // file:123 or file:123|display
        { type: 'file', regex: /\bfile:(\d+)(?:\|([^\]]+))?/gi },
        // post:456 or post:456|display
        { type: 'post', regex: /\bpost:(\d+)(?:\|([^\]]+))?/gi },
        // image:789 or image:789|display
        { type: 'image', regex: /\bimage:(\d+)(?:\|([^\]]+))?/gi },
        // wiki:title or wiki:title|display
        { type: 'wiki', regex: /\bwiki:([^\s\]]+)(?:\|([^\]]+))?/gi }
    ];
    
    // Handle "Links Using ID" formats from Danbooru DText documentation
    // Format: type #id or type #id/page
    const idLinkPatterns = [
        { type: 'post', regex: /\bpost\s+#(\d+)/gi },
        { type: 'topic', regex: /\btopic\s+#(\d+)(?:\/p(\d+))?/gi }, // topic #1234 or topic #1234/p2
        { type: 'forum', regex: /\bforum\s+#(\d+)/gi },
        { type: 'comment', regex: /\bcomment\s+#(\d+)/gi },
        { type: 'pool', regex: /\bpool\s+#(\d+)/gi },
        { type: 'favgroup', regex: /\bfavgroup\s+#(\d+)/gi },
        { type: 'wiki', regex: /\bwiki\s+#(\d+)/gi },
        { type: 'user', regex: /\buser\s+#(\d+)/gi },
        { type: 'ban', regex: /\bban\s+#(\d+)/gi },
        { type: 'feedback', regex: /\bfeedback\s+#(\d+)/gi },
        { type: 'appeal', regex: /\bappeal\s+#(\d+)/gi },
        { type: 'flag', regex: /\bflag\s+#(\d+)/gi },
        { type: 'note', regex: /\bnote\s+#(\d+)/gi },
        { type: 'bur', regex: /\bBUR\s+#(\d+)/gi }, // Bulk Update Request
        { type: 'alias', regex: /\balias\s+#(\d+)/gi },
        { type: 'implication', regex: /\bimplication\s+#(\d+)/gi },
        { type: 'mod_action', regex: /\bmod\s+action\s+#(\d+)/gi },
        { type: 'artist', regex: /\bartist\s+#(\d+)/gi },
        { type: 'issue', regex: /\bissue\s+#(\d+)/gi }, // GitHub issue
        { type: 'pixiv', regex: /\bpixiv\s+#(\d+)/gi },
        { type: 'pawoo', regex: /\bpawoo\s+#(\d+)/gi },
        { type: 'seiga', regex: /\bseiga\s+#(\d+)/gi },
        { type: 'nijie', regex: /\bnijie\s+#(\d+)/gi },
        { type: 'twitter', regex: /\btwitter\s+#(\d+)/gi },
        { type: 'deviantart', regex: /\bdeviantart\s+#(\d+)/gi },
        { type: 'artstation', regex: /\bartstation\s+#(\d+)/gi },
        { type: 'sankaku', regex: /\bsankaku\s+#(\d+)/gi },
        { type: 'gelbooru', regex: /\bgelbooru\s+#(\d+)/gi },
        { type: 'yandere', regex: /\byandere\s+#(\d+)/gi }
    ];
    
    // Process ID-based link patterns
    for (const { type, regex } of idLinkPatterns) {
        while ((match = regex.exec(bodyText)) !== null) {
            const id = match[1];
            const page = match[2] || null; // For topic #1234/p2 format
            let displayText = `${type} #${id}`;
            if (page) {
                displayText += `/p${page}`;
            }
            
            links.push({
                type: type,
                id: id,
                page: page, // Store page number for topic links
                displayText: displayText,
                startOffset: match.index,
                endOffset: match.index + match[0].length
            });
        }
    }
    
    // Handle !post #12345 format (image display, not link)
    const legacyPostExclamationPattern = /!post\s+#(\d+)/gi;
    while ((match = legacyPostExclamationPattern.exec(bodyText)) !== null) {
        links.push({
            type: 'post_image',
            id: match[1],
            displayText: `post #${match[1]}`,
            startOffset: match.index,
            endOffset: match.index + match[0].length
        });
    }
    
    // Handle thumb #12345 and !thumb #12345 formats (thumbnail display)
    const thumbPattern = /!?thumb\s+#(\d+)/gi;
    while ((match = thumbPattern.exec(bodyText)) !== null) {
        links.push({
            type: 'post_thumb',
            id: match[1],
            displayText: `thumb #${match[1]}`,
            startOffset: match.index,
            endOffset: match.index + match[0].length
        });
    }
    
    // Handle external links: "text":url or "text":[url]
    // Also detect e621.net and danbooru.donmai.us search URLs
    const externalLinkPattern = /"([^"]+)":\[?([^\s\]]+)\]?/g;
    while ((match = externalLinkPattern.exec(bodyText)) !== null) {
        const text = match[1];
        const url = match[2];
        // Only store if it's a valid URL
        if (/^https?:\/\//i.test(url)) {
            let linkType = 'external';
            let searchQuery = null;
            
            // Check if it's an e621 or danbooru search URL
            try {
                const urlObj = new URL(url);
                const hostname = urlObj.hostname.toLowerCase();
                
                // Detect e621.net search URLs
                // Format: https://e621.net/tags?commit=Search&search[name_matches]=*birth*&search[category]=0&search[order]=count
                if (hostname === 'e621.net' && urlObj.pathname === '/tags' && urlObj.searchParams.has('commit')) {
                    linkType = 'search';
                    // Extract search query from search[name_matches] parameter
                    // Try both URL-encoded and unencoded parameter names
                    const nameMatches = urlObj.searchParams.get('search[name_matches]') || 
                                       urlObj.searchParams.get('search%5Bname_matches%5D') ||
                                       (() => {
                                           // Manual parsing for URL-encoded parameters
                                           const decodedSearch = decodeURIComponent(urlObj.search);
                                           const match = decodedSearch.match(/search\[name_matches\]=([^&]+)/);
                                           return match ? match[1] : null;
                                       })();
                    if (nameMatches) {
                        // Clean up wildcards and formatting
                        searchQuery = decodeURIComponent(nameMatches).replace(/\*/g, '').trim();
                        // If it's wrapped in quotes, remove them
                        searchQuery = searchQuery.replace(/^["']|["']$/g, '');
                    }
                }
                // Detect danbooru.donmai.us search URLs  
                // Format: https://danbooru.donmai.us/wiki_pages?search[name_matches]=*birth*
                else if (hostname === 'danbooru.donmai.us' && 
                         (urlObj.pathname === '/wiki_pages' || urlObj.pathname === '/wiki_pages/')) {
                    // Check if it has search parameters (either encoded or not)
                    const hasSearchParam = urlObj.searchParams.has('search[name_matches]') || 
                                          urlObj.searchParams.has('search%5Bname_matches%5D') ||
                                          urlObj.search.includes('search[name_matches]') ||
                                          urlObj.search.includes('search%5Bname_matches%5D');
                    if (hasSearchParam) {
                        linkType = 'search';
                        const nameMatches = urlObj.searchParams.get('search[name_matches]') || 
                                           urlObj.searchParams.get('search%5Bname_matches%5D') ||
                                           (() => {
                                               // Manual parsing for URL-encoded parameters
                                               const decodedSearch = decodeURIComponent(urlObj.search);
                                               const match = decodedSearch.match(/search\[name_matches\]=([^&]+)/);
                                               return match ? match[1] : null;
                                           })();
                        if (nameMatches) {
                            // Clean up wildcards and formatting
                            searchQuery = decodeURIComponent(nameMatches).replace(/\*/g, '').trim();
                            // If it's wrapped in quotes, remove them
                            searchQuery = searchQuery.replace(/^["']|["']$/g, '');
                        }
                    }
                }
                
                // Try to extract tag/wiki name from any e621/danbooru URL (view, create, edit, etc.)
                if (linkType === 'external') {
                    const extracted = extractTagOrWikiFromUrl(urlObj);
                    if (extracted) {
                        // Store the extracted information for later collection
                        // We'll collect these in the missing wikis export
                        if (extracted.tagName) {
                            linkType = 'tag_reference';
                            searchQuery = extracted.tagName; // Reuse searchQuery field to store tag name
                        } else if (extracted.wikiTitle) {
                            linkType = 'wiki_reference';
                            searchQuery = extracted.wikiTitle; // Reuse searchQuery field to store wiki title
                        }
                    }
                }
            } catch (e) {
                // URL parsing failed, treat as regular external link
                // Error will be silently ignored and link will be stored as 'external'
            }
            
            links.push({
                type: linkType,
                id: null,
                url: url,
                searchQuery: searchQuery, // Store extracted search query
                displayText: text,
                startOffset: match.index,
                endOffset: match.index + match[0].length
            });
        }
    }
    
    // Also handle markdown-style links that might already exist: [text](http://url)
    // Check for e621/danbooru search URLs in these too
    const markdownLinkPattern = /\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)/gi;
    while ((match = markdownLinkPattern.exec(bodyText)) !== null) {
        const text = match[1];
        const url = match[2];
        // Skip if already converted to file:// (already processed above)
        if (url.startsWith('file://')) {
            continue;
        }
        
        if (/^https?:\/\//i.test(url)) {
            let linkType = 'external';
            let searchQuery = null;
            
            // Check if it's an e621 or danbooru search URL
            try {
                const urlObj = new URL(url);
                const hostname = urlObj.hostname.toLowerCase();
                
                // Detect e621.net search URLs
                if (hostname === 'e621.net' && urlObj.pathname === '/tags' && urlObj.searchParams.has('commit')) {
                    linkType = 'search';
                    const nameMatches = urlObj.searchParams.get('search[name_matches]') || 
                                       urlObj.searchParams.get('search%5Bname_matches%5D') ||
                                       (() => {
                                           const decodedSearch = decodeURIComponent(urlObj.search);
                                           const match = decodedSearch.match(/search\[name_matches\]=([^&]+)/);
                                           return match ? match[1] : null;
                                       })();
                    if (nameMatches) {
                        searchQuery = decodeURIComponent(nameMatches).replace(/\*/g, '').trim();
                        searchQuery = searchQuery.replace(/^["']|["']$/g, '');
                    }
                }
                // Detect danbooru.donmai.us search URLs
                else if (hostname === 'danbooru.donmai.us' && 
                         (urlObj.pathname === '/wiki_pages' || urlObj.pathname === '/wiki_pages/')) {
                    const hasSearchParam = urlObj.searchParams.has('search[name_matches]') || 
                                          urlObj.searchParams.has('search%5Bname_matches%5D') ||
                                          urlObj.search.includes('search[name_matches]') ||
                                          urlObj.search.includes('search%5Bname_matches%5D');
                    if (hasSearchParam) {
                        linkType = 'search';
                        const nameMatches = urlObj.searchParams.get('search[name_matches]') || 
                                           urlObj.searchParams.get('search%5Bname_matches%5D') ||
                                           (() => {
                                               const decodedSearch = decodeURIComponent(urlObj.search);
                                               const match = decodedSearch.match(/search\[name_matches\]=([^&]+)/);
                                               return match ? match[1] : null;
                                           })();
                        if (nameMatches) {
                            searchQuery = decodeURIComponent(nameMatches).replace(/\*/g, '').trim();
                            searchQuery = searchQuery.replace(/^["']|["']$/g, '');
                        }
                    }
                }
                
                // Try to extract tag/wiki name from any e621/danbooru URL (view, create, edit, etc.)
                if (linkType === 'external') {
                    const extracted = extractTagOrWikiFromUrl(urlObj);
                    if (extracted) {
                        // Store the extracted information for later collection
                        if (extracted.tagName) {
                            linkType = 'tag_reference';
                            searchQuery = extracted.tagName; // Reuse searchQuery field to store tag name
                        } else if (extracted.wikiTitle) {
                            linkType = 'wiki_reference';
                            searchQuery = extracted.wikiTitle; // Reuse searchQuery field to store wiki title
                        }
                    }
                }
            } catch (e) {
                // URL parsing failed, treat as regular external link
            }
            
            links.push({
                type: linkType,
                id: null,
                url: url,
                searchQuery: searchQuery,
                displayText: text,
                startOffset: match.index,
                endOffset: match.index + match[0].length
            });
        }
    }
    
    // Process each link pattern
    for (const { type, regex } of linkPatterns) {
        while ((match = regex.exec(bodyText)) !== null) {
            const id = match[1];
            const displayText = match[2] || (type === 'post' ? `${type} #${id}` : (type === 'wiki' ? id : `${type}:${id}`));
            
            links.push({
                type: type,
                id: id,
                displayText: displayText,
                startOffset: match.index,
                endOffset: match.index + match[0].length
            });
        }
    }
    
    // Sort by start offset to maintain order
    links.sort((a, b) => a.startOffset - b.startOffset);
    
    return links;
}

/**
 * Detect relationship type for a tag link in wiki body
 * @param {string} bodyText - Full wiki body text (normalized markdown format)
 * @param {string} linkTitle - The linked tag title
 * @param {number} linkPosition - Character position of the link in bodyText
 * @returns {number} Relationship type (0=appears, 1=related, 2=replaces, 3=not_to_be_confused)
 */
function detectLinkRelationship(bodyText, linkTitle, linkPosition) {
    if (!bodyText || !linkTitle || linkPosition === undefined) {
        return RELATIONSHIP_APPEARS; // Default
    }
    
    const beforeLink = bodyText.substring(0, linkPosition).toLowerCase();
    const afterLink = bodyText.substring(linkPosition).toLowerCase();
    
    // Get context around the link (300 chars before)
    const contextStart = Math.max(0, linkPosition - 300);
    const contextBefore = bodyText.substring(contextStart, linkPosition).toLowerCase();
    
    // Check for "Related:" section (e621) - look for "related:" heading before the link
    // Also check for "Related tags:" which is equivalent to "See also"
    const relatedPatterns = [
        /h[1-5]\.\s*related\s*:?\s*\n/i,
        /h[1-5]\.\s*related\s+tags\s*:?\s*\n/i,
        /\[section=related\]/i,
        /\[section=related\s+tags\]/i,
        /^related\s*:?\s*$/im,
        /^related\s+tags\s*:?\s*$/im,
        /##\s*related\s*:?\s*$/im,
        /###\s*related\s*:?\s*$/im,
        /##\s*related\s+tags\s*:?\s*$/im,
        /###\s*related\s+tags\s*:?\s*$/im,
        /###\s*\[SECTION:related\]/i,
        /###\s*\[SECTION:related\s+tags\]/i
    ];
    
    // Check if link is in a "Related:" section
    for (const pattern of relatedPatterns) {
        const match = beforeLink.match(pattern);
        if (match) {
            // Check if there's a deprecated section between Related and this link
            const between = bodyText.substring(match.index + match[0].length, linkPosition).toLowerCase();
            // Only return RELATED if we don't see deprecated patterns between Related and the link
            if (!between.match(/deprecated|see\s+["']|use\s+["']|replaced\s+by/i)) {
                return RELATIONSHIP_RELATED;
            }
        }
    }
    
    // Check for "See also" section (danbooru) - look for "see also" heading before the link
    // Also check for "Related tags:" which is equivalent
    // Can appear in regular headers or in [section=...] collapsible sections
    const seeAlsoPatterns = [
        /h[1-5]\.\s*see\s+also\s*:?\s*\n/i,
        /h[1-5]\.\s*related\s+tags\s*:?\s*\n/i,
        /\[section=see\s+also\]/i,
        /\[section=related\s+tags\]/i,
        /^see\s+also\s*:?\s*$/im,
        /^related\s+tags\s*:?\s*$/im,
        /##\s*see\s+also\s*:?\s*$/im,
        /###\s*see\s+also\s*:?\s*$/im,
        /##\s*related\s+tags\s*:?\s*$/im,
        /###\s*related\s+tags\s*:?\s*$/im,
        /###\s*\[SECTION:see\s+also\]/i,
        /###\s*\[SECTION:related\s+tags\]/i,
        /#{1,6}\s+\[SECTION:see\s+also\]/i,
        /#{1,6}\s+\[SECTION:related\s+tags\]/i
    ];
    
    for (const pattern of seeAlsoPatterns) {
        const match = beforeLink.match(pattern);
        if (match) {
            // Check if there's a deprecated section between See also and this link
            const between = bodyText.substring(match.index + match[0].length, linkPosition).toLowerCase();
            if (!between.match(/deprecated|see\s+["']|use\s+["']|replaced\s+by/i)) {
                return RELATIONSHIP_RELATED;
            }
        }
    }
    
    // Check for "Not to be confused with" section - negative links that correct the user
    // Can appear in regular headers or in [section=...] collapsible sections
    const notToBeConfusedPatterns = [
        /h[1-5]\.\s*not\s+to\s+be\s+confused\s+with\s*:?\s*\n/i,
        /\[section=not\s+to\s+be\s+confused\s+with\]/i,
        /^not\s+to\s+be\s+confused\s+with\s*:?\s*$/im,
        /##\s*not\s+to\s+be\s+confused\s+with\s*:?\s*$/im,
        /###\s*not\s+to\s+be\s+confused\s+with\s*:?\s*$/im,
        /###\s*\[SECTION:not\s+to\s+be\s+confused\s+with\]/i,
        /#{1,6}\s+\[SECTION:not\s+to\s+be\s+confused\s+with\]/i
    ];
    
    // Check if link is in a "Not to be confused with" section
    for (const pattern of notToBeConfusedPatterns) {
        const match = beforeLink.match(pattern);
        if (match) {
            // Check if there's a deprecated section between "Not to be confused with" and this link
            const between = bodyText.substring(match.index + match[0].length, linkPosition).toLowerCase();
            if (!between.match(/deprecated|see\s+["']|use\s+["']|replaced\s+by/i)) {
                return RELATIONSHIP_NOT_TO_BE_CONFUSED;
            }
        }
    }
    
    // Check for deprecated patterns - must be careful, just having the word doesn't mean deprecated
    // Look for patterns like "deprecated", "see [[tag]]", "use [[tag]]", etc.
    // The link must appear close to these patterns
    const deprecatedPatterns = [
        /deprecated[^[]*\[\[/gi,
        /see\s+\[\[/gi,
        /use\s+\[\[/gi,
        /replaced\s+by\s+\[\[/gi,
        /use\s+instead\s+\[\[/gi,
        /should\s+use\s+\[\[/gi,
        /deprecated.*?\[\[/gi
    ];
    
    // Check context before the link for deprecated indicators
    // Look for deprecated patterns within 200 chars before the link
    for (const pattern of deprecatedPatterns) {
        const matches = [...contextBefore.matchAll(pattern)];
        for (const depMatch of matches) {
            const depEnd = depMatch.index + depMatch[0].length;
            const distance = (linkPosition - contextStart) - depEnd;
            // Only consider it deprecated if the pattern is within 200 chars of the link
            if (distance >= 0 && distance < 200) {
                // Additional check: make sure we're not in a "Related:", "See also", or "Not to be confused with" section
                // (those take precedence)
                const hasRelatedBefore = relatedPatterns.some(p => {
                    const m = beforeLink.match(p);
                    return m && m.index > depMatch.index;
                });
                const hasSeeAlsoBefore = seeAlsoPatterns.some(p => {
                    const m = beforeLink.match(p);
                    return m && m.index > depMatch.index;
                });
                const hasNotToBeConfusedBefore = notToBeConfusedPatterns.some(p => {
                    const m = beforeLink.match(p);
                    return m && m.index > depMatch.index;
                });
                
                if (!hasRelatedBefore && !hasSeeAlsoBefore && !hasNotToBeConfusedBefore) {
                    return RELATIONSHIP_REPLACES;
                }
            }
        }
    }
    
    // Default: tag just appears in the wiki
    return RELATIONSHIP_APPEARS;
}

/**
 * Load JSON file
 */
function loadJSON(filePath) {
    console.log(`📂 Loading ${path.basename(filePath)}...`);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const count = Object.keys(data).filter(k => k !== '_metadata').length;
    console.log(`   ✓ Loaded ${count} entries (+ metadata)`);
    return data;
}

function utf8SolidEnd(buf) {
    const n = buf.length;
    if (n === 0) return 0;
    let i = n - 1;
    if (buf[i] < 0x80) return n;
    while (i > 0 && (buf[i] & 0xc0) === 0x80) i--;
    const lead = buf[i];
    let need = 1;
    if ((lead & 0xe0) === 0xc0) need = 2;
    else if ((lead & 0xf0) === 0xe0) need = 3;
    else if ((lead & 0xf8) === 0xf0) need = 4;
    else return i;
    return (n - i >= need) ? n : i;
}

/**
 * Stream CSV rows (quoted multiline fields allowed). Reuses one row object; copy if you store it.
 */
function forEachCsvRow(filePath, onRow) {
    console.log(`📂 Streaming ${path.basename(filePath)}...`);
    const fd = fs.openSync(filePath, 'r');
    const chunk = Buffer.alloc(1024 * 1024);
    let leftoverUtf = Buffer.alloc(0);
    let pending = '';
    let headers = null;
    let currentLine = [];
    let currentField = '';
    let inQuotes = false;
    let rowCount = 0;
    const row = {};

    const emitLine = (fields) => {
        if (!headers) {
            headers = fields;
            if (headers[0] && headers[0].charCodeAt(0) === 0xFEFF) {
                headers[0] = headers[0].slice(1);
            }
            return;
        }
        for (let h = 0; h < headers.length; h++) {
            row[headers[h]] = fields[h] || '';
        }
        onRow(row);
        rowCount++;
    };

    const consume = (text, isLast) => {
        let i = 0;
        const len = text.length;
        while (i < len) {
            const char = text[i];
            const hasNext = i + 1 < len;
            if (!hasNext && !isLast && (char === '"' || char === '\r')) {
                return text.slice(i);
            }
            const nextChar = hasNext ? text[i + 1] : '';
            if (char === '"') {
                if (inQuotes && nextChar === '"') {
                    currentField += '"';
                    i += 2;
                } else {
                    inQuotes = !inQuotes;
                    i++;
                }
            } else if (char === ',' && !inQuotes) {
                currentLine.push(currentField);
                currentField = '';
                i++;
            } else if ((char === '\n' || (char === '\r' && nextChar === '\n')) && !inQuotes) {
                currentLine.push(currentField);
                emitLine(currentLine);
                currentLine = [];
                currentField = '';
                i += (char === '\r' && nextChar === '\n') ? 2 : 1;
            } else {
                const start = i;
                i++;
                while (i < len) {
                    const c = text[i];
                    if (c === '"') break;
                    if (!inQuotes && (c === ',' || c === '\n' || c === '\r')) break;
                    i++;
                }
                currentField += text.slice(start, i);
            }
        }
        return '';
    };

    try {
        let n;
        while ((n = fs.readSync(fd, chunk, 0, chunk.length, null)) > 0) {
            const data = leftoverUtf.length
                ? Buffer.concat([leftoverUtf, chunk.slice(0, n)])
                : chunk.slice(0, n);
            const solid = utf8SolidEnd(data);
            leftoverUtf = solid < data.length ? Buffer.from(data.slice(solid)) : Buffer.alloc(0);
            pending += data.toString('utf8', 0, solid);
            pending = consume(pending, false);
        }
        pending = consume(pending, true);
        if (currentField || currentLine.length > 0) {
            currentLine.push(currentField);
            emitLine(currentLine);
        }
    } finally {
        fs.closeSync(fd);
    }
    console.log(`   ✓ Streamed ${rowCount} rows`);
    return rowCount;
}

/**
 * Parse CSV file with multi-line support.
 * Prefer forEachCsvRow for large dumps.
 */
function parseCSV(filePath) {
    const rows = [];
    forEachCsvRow(filePath, (row) => {
        rows.push(Object.assign({}, row));
    });
    return rows;
}

/**
 * Create database schema
 */
function createSchema(db) {
    console.log('\n📐 Creating database schema...');
    
    // Wikis table - stores all wiki content from different sources
    // Note: Wikis are stored independently and linked to tags via tag_wikis table
    // Title is stored here for unlinked wikis (like tag groups) that don't have a corresponding tag
    // Key is (title, source) for efficient lookups
    db.exec(`
        CREATE TABLE IF NOT EXISTS wikis (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,  -- Title/name of the wiki (tag name for tag wikis, page title for unlinked wikis)
            body TEXT NOT NULL,
            source INTEGER NOT NULL,  -- 0=custom, 1=danbooru, 2=e621
            created_at TEXT,
            updated_at TEXT,
            UNIQUE(title, source)  -- One wiki entry per unique title+source combination
        );
    `);
    
    // Tag wikis linking table - links tags to their wikis
    db.exec(`
        CREATE TABLE IF NOT EXISTS tag_wikis (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tag_id INTEGER NOT NULL,
            wiki_id INTEGER NOT NULL,
            FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE,
            FOREIGN KEY (wiki_id) REFERENCES wikis(id) ON DELETE CASCADE,
            UNIQUE(tag_id, wiki_id)  -- One link per tag-wiki pair
        );
    `);
    
    // Tags table - main tag data
    // Note: is_deleted tags are filtered out during insertion, not stored
    // Note: created_at, updated_at, scraped_at are wiki-specific and stored in wikis table, linked via tag_wikis
    db.exec(`
        CREATE TABLE IF NOT EXISTS tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL UNIQUE,
            normalized_title TEXT NOT NULL,
            category INTEGER,  -- 0=General, 1=Artist, 3=Copyright, 4=Character, 5=Meta, 6=Species
            d_count INTEGER DEFAULT 0,  -- Danbooru count
            e_count INTEGER DEFAULT 0,  -- E621/Furry count
            n_count INTEGER,  -- NovelAI count (NULL if 0 or missing, filled from tag_search.db cache)
            n_rand BOOLEAN DEFAULT 0,
            is_locked BOOLEAN DEFAULT 0,
            untrained BOOLEAN DEFAULT 0,  -- 1 if created after May 29, 2025 (v5+ suggest)
            created_at TEXT
        );
    `);
    
    // Z-categories - hierarchical category system
    db.exec(`
        CREATE TABLE IF NOT EXISTS z_categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            parent_id INTEGER,
            FOREIGN KEY (parent_id) REFERENCES z_categories(id) ON DELETE SET NULL
        );
    `);
    
    // Tag z-category associations
    db.exec(`
        CREATE TABLE IF NOT EXISTS tag_z_categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tag_id INTEGER NOT NULL,
            z_category_id INTEGER NOT NULL,
            FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE,
            FOREIGN KEY (z_category_id) REFERENCES z_categories(id) ON DELETE CASCADE,
            UNIQUE(tag_id, z_category_id)
        );
    `);
    
    // Tag other names
    db.exec(`
        CREATE TABLE IF NOT EXISTS tag_other_names (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tag_id INTEGER NOT NULL,
            other_name TEXT NOT NULL,
            FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE,
            UNIQUE(tag_id, other_name)
        );
    `);
    
    // Tag words
    db.exec(`
        CREATE TABLE IF NOT EXISTS tag_words (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tag_id INTEGER NOT NULL,
            word TEXT NOT NULL,
            FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE,
            UNIQUE(tag_id, word)
        );
        
        -- Tag word sequences: Pre-computed word sequences for fast predictive matching
        -- This enables O(1) lookup for "does this word sequence match any tag?"
        -- Special characters (parentheses, brackets, etc.) are replaced with generic token "§" for compression
        -- Example: For tag "rapi (red hood) (nikke)"
        -- We store: "rapi", "rapi §", "rapi § red", "rapi § red hood", "rapi § red hood §", etc.
        -- Plus sub-sequences: "red", "red hood", "hood", "nikke"
        -- This allows instant lookup: "rapi §" → [tag_id] (matches tags with parentheticals)
        -- Query: "red hood" → [tag_id] (matches content within parentheses)
        CREATE TABLE IF NOT EXISTS tag_word_sequences (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tag_id INTEGER NOT NULL,
            sequence TEXT NOT NULL,  -- The word sequence with "§" for special chars (e.g., "rapi § red hood")
            sequence_length INTEGER NOT NULL,  -- Number of words in sequence (special tokens not counted)
            start_position INTEGER NOT NULL,  -- Position in tag where sequence starts (0-indexed)
            FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE,
            UNIQUE(tag_id, sequence, start_position)
        );

        CREATE TABLE IF NOT EXISTS tag_search_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
    `);
    
    // Tag links - links tags to other tags
    db.exec(`
        CREATE TABLE IF NOT EXISTS tag_links (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            from_tag_id INTEGER NOT NULL,
            to_tag_id INTEGER NOT NULL,
            FOREIGN KEY (from_tag_id) REFERENCES tags(id) ON DELETE CASCADE,
            FOREIGN KEY (to_tag_id) REFERENCES tags(id) ON DELETE CASCADE,
            UNIQUE(from_tag_id, to_tag_id)  -- One link per tag pair (direction is determined by from/to)
        );
    `);
    
    // Tag wiki links - links tags to wikis (soft links)
    // relationship: 0=appears (tag appears/mentioned), 1=related (in Related/See also), 2=replaces (deprecated tag)
    // Note: "own" relationship is handled by tag_wikis table, not stored here
    db.exec(`
        CREATE TABLE IF NOT EXISTS tag_wiki_links (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tag_id INTEGER NOT NULL,
            wiki_id INTEGER NOT NULL,
            relationship INTEGER NOT NULL,  -- 0=appears, 1=related, 2=replaces
            FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE,
            FOREIGN KEY (wiki_id) REFERENCES wikis(id) ON DELETE CASCADE,
            UNIQUE(tag_id, wiki_id, relationship)  -- One link per tag-wiki-relationship combination
        );
    `);
    
    // Wiki links - links wikis to other wikis
    db.exec(`
        CREATE TABLE IF NOT EXISTS wiki_links (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            from_wiki_id INTEGER NOT NULL,
            to_wiki_id INTEGER NOT NULL,
            FOREIGN KEY (from_wiki_id) REFERENCES wikis(id) ON DELETE CASCADE,
            FOREIGN KEY (to_wiki_id) REFERENCES wikis(id) ON DELETE CASCADE,
            UNIQUE(from_wiki_id, to_wiki_id)  -- One link per wiki pair (direction is determined by from/to)
        );
    `);
    
    // Wiki sections - stores extracted sections/headers from wiki bodies (indexed for fast lookup)
    // section_index is the primary identifier for sections (0-based in DB, 1-based in display)
    // Users can request sections by numeric index (1-based) or by anchor
    db.exec(`
        CREATE TABLE IF NOT EXISTS wiki_sections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            wiki_id INTEGER NOT NULL,
            section_index INTEGER NOT NULL,  -- Primary identifier: Order of section in the wiki (0-based, displayed as 1-based)
            level INTEGER NOT NULL,  -- Heading level (1-6, where 1 is highest)
            title TEXT NOT NULL,  -- Normalized section title
            anchor TEXT NOT NULL,  -- URL-friendly anchor identifier (secondary lookup method)
            start_offset INTEGER NOT NULL,  -- Character offset where section starts
            end_offset INTEGER NOT NULL,  -- Character offset where section ends
            line_index INTEGER NOT NULL,  -- Line number where section starts (0-based)
            section_type INTEGER DEFAULT 0,  -- 0=normal header, 1=collapsible section (from [section=...] tags)
            parent_section_id INTEGER,  -- ID of parent section (for hierarchy), NULL for root sections
            FOREIGN KEY (wiki_id) REFERENCES wikis(id) ON DELETE CASCADE,
            FOREIGN KEY (parent_section_id) REFERENCES wiki_sections(id) ON DELETE CASCADE,
            UNIQUE(wiki_id, section_index)  -- One section per wiki per index (primary key for lookup)
        );
    `);
    
    // Wiki content links - stores file:, post:, image:, wiki: references from DText
    // Links are stored with their IDs and can be converted to source URLs (e621.net, danbooru.donmai.us)
    db.exec(`
        CREATE TABLE IF NOT EXISTS wiki_content_links (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            wiki_id INTEGER NOT NULL,
            link_type TEXT NOT NULL,  -- 'file', 'post', 'image', 'wiki', 'external', 'search', 'topic', 'forum', etc.
            link_id TEXT,  -- ID for file/post/image/wiki (NULL for external links)
            link_url TEXT,  -- Full URL for external links or search URLs (NULL for ID-based links)
            link_page TEXT,  -- Page number for topic links (e.g., '2' for topic #1234/p2)
            display_text TEXT,  -- Display text for the link (from DText or generated)
            search_query TEXT,  -- Extracted search query for search-type links (e621/danbooru search URLs)
            start_offset INTEGER NOT NULL,  -- Character offset where link starts in body
            end_offset INTEGER NOT NULL,  -- Character offset where link ends in body
            FOREIGN KEY (wiki_id) REFERENCES wikis(id) ON DELETE CASCADE,
            CHECK((link_id IS NOT NULL) != (link_url IS NOT NULL) OR link_type = 'search')  -- Either ID or URL (search type requires URL)
        );
    `);
    
    // Wiki pages - stores metadata for wiki pages that are NOT tags (tag groups, unlinked pages)
    // The actual wiki content is stored in the wikis table and linked via danbooru_wiki_id/e621_wiki_id
    // This table is used for:
    //   - Tag groups (pages with "tag group:" or "tag_group:" prefix)
    //   - Other unlinked wiki pages that aren't associated with tags
    db.exec(`
        CREATE TABLE IF NOT EXISTS wiki_pages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL UNIQUE,
            danbooru_wiki_id INTEGER,  -- Link to wikis table for Danbooru wiki content
            e621_wiki_id INTEGER,  -- Link to wikis table for e621 wiki content
            category INTEGER,
            created_at TEXT,
            updated_at TEXT,
            untrained INTEGER DEFAULT 0,  -- 1 if created after May 29, 2025 (v5+ wiki flag; pages remain browsable)
            FOREIGN KEY (danbooru_wiki_id) REFERENCES wikis(id) ON DELETE SET NULL,
            FOREIGN KEY (e621_wiki_id) REFERENCES wikis(id) ON DELETE SET NULL
        );
    `);
    
    // Wiki page links (links between wiki pages and tags/groups)
    db.exec(`
        CREATE TABLE IF NOT EXISTS wiki_page_links (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            page_id INTEGER NOT NULL,
            linked_tag_id INTEGER,  -- Can be NULL if linking to another wiki page
            linked_page_id INTEGER,  -- Can be NULL if linking to a tag
            FOREIGN KEY (page_id) REFERENCES wiki_pages(id) ON DELETE CASCADE,
            FOREIGN KEY (linked_tag_id) REFERENCES tags(id) ON DELETE CASCADE,
            FOREIGN KEY (linked_page_id) REFERENCES wiki_pages(id) ON DELETE CASCADE,
            CHECK((linked_tag_id IS NOT NULL) != (linked_page_id IS NOT NULL)),
            UNIQUE(page_id, linked_tag_id, linked_page_id)  -- One link per page-target pair
        );
    `);
    
    // Wiki page to tag associations (when wiki page title matches a tag)
    db.exec(`
        CREATE TABLE IF NOT EXISTS wiki_page_tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            page_id INTEGER NOT NULL,
            tag_id INTEGER NOT NULL,
            FOREIGN KEY (page_id) REFERENCES wiki_pages(id) ON DELETE CASCADE,
            FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE,
            UNIQUE(page_id, tag_id)
        );
    `);
    
    // D-groups - hierarchical group structure
    db.exec(`
        CREATE TABLE IF NOT EXISTS d_groups (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            path TEXT NOT NULL UNIQUE,  -- Full path like "g/attire/attire/top"
            parent_id INTEGER,
            pretty_name TEXT,  -- Display name from _metadata.prettyName
            description TEXT,  -- Description from _metadata.description
            icon TEXT,  -- Icon from _metadata.icon
            FOREIGN KEY (parent_id) REFERENCES d_groups(id) ON DELETE SET NULL
        );
    `);
    
    // D-group array metadata - stores metadata for array children (arrayNames, arrayIcons)
    // This stores metadata that parents have for their array children
    db.exec(`
        CREATE TABLE IF NOT EXISTS d_group_array_metadata (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            parent_group_id INTEGER NOT NULL,
            child_name TEXT NOT NULL,  -- Name of the array child
            pretty_name TEXT,  -- Display name from parent._metadata.arrayNames[child_name]
            icon TEXT,  -- Icon from parent._metadata.arrayIcons[child_name]
            FOREIGN KEY (parent_group_id) REFERENCES d_groups(id) ON DELETE CASCADE,
            UNIQUE(parent_group_id, child_name)
        );
    `);
    
    // Tag d-group associations
    db.exec(`
        CREATE TABLE IF NOT EXISTS tag_d_groups (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tag_id INTEGER NOT NULL,
            group_id INTEGER NOT NULL,
            FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE,
            FOREIGN KEY (group_id) REFERENCES d_groups(id) ON DELETE CASCADE,
            UNIQUE(tag_id, group_id)
        );
    `);
    
    // Dataset group members - stores which tags belong to which groups from dataset_tag_groups.json
    db.exec(`
        CREATE TABLE IF NOT EXISTS dataset_group_members (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            group_id INTEGER NOT NULL,
            tag_id INTEGER NOT NULL,
            FOREIGN KEY (group_id) REFERENCES d_groups(id) ON DELETE CASCADE,
            FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE,
            UNIQUE(group_id, tag_id)
        );
    `);
    
    console.log('   ✓ Schema created');
}

/**
 * Create lightweight indexes (single column, small tables)
 * These can be created early as they're relatively fast
 */
function createLightweightIndexes(db) {
    console.log('\n📇 Creating lightweight indexes...');
    
    // Tags indexes (simple single-column)
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_tags_title ON tags(title);
        CREATE INDEX IF NOT EXISTS idx_tags_normalized ON tags(normalized_title);
        CREATE INDEX IF NOT EXISTS idx_tags_category ON tags(category);
    `);
    
    // Tags count indexes
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_tags_d_count ON tags(d_count DESC);
        CREATE INDEX IF NOT EXISTS idx_tags_e_count ON tags(e_count DESC);
        CREATE INDEX IF NOT EXISTS idx_tags_n_count ON tags(n_count DESC);
    `);
    
    // Z-categories indexes
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_z_categories_parent ON z_categories(parent_id);
        CREATE INDEX IF NOT EXISTS idx_tag_z_categories_tag ON tag_z_categories(tag_id);
        CREATE INDEX IF NOT EXISTS idx_tag_z_categories_category ON tag_z_categories(z_category_id);
    `);
    
    // Other names indexes (simple)
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_other_names_tag ON tag_other_names(tag_id);
        CREATE INDEX IF NOT EXISTS idx_other_names_name ON tag_other_names(other_name);
    `);
    
    // Words indexes (simple)
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_words_tag ON tag_words(tag_id);
        CREATE INDEX IF NOT EXISTS idx_words_word ON tag_words(word);
    `);
    
    // Tag word sequences indexes (simple single-column - composite moved to heavy)
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_tag_word_sequences_tag ON tag_word_sequences(tag_id);
        CREATE INDEX IF NOT EXISTS idx_tag_word_sequences_sequence ON tag_word_sequences(sequence);
        CREATE INDEX IF NOT EXISTS idx_tag_word_sequences_length ON tag_word_sequences(sequence_length);
    `);
    
    // D-groups indexes
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_d_groups_path ON d_groups(path);
        CREATE INDEX IF NOT EXISTS idx_d_groups_parent ON d_groups(parent_id);
        CREATE INDEX IF NOT EXISTS idx_tag_d_groups_tag ON tag_d_groups(tag_id);
        CREATE INDEX IF NOT EXISTS idx_tag_d_groups_group ON tag_d_groups(group_id);
        CREATE INDEX IF NOT EXISTS idx_dataset_group_members_group ON dataset_group_members(group_id);
        CREATE INDEX IF NOT EXISTS idx_dataset_group_members_tag ON dataset_group_members(tag_id);
        CREATE INDEX IF NOT EXISTS idx_d_group_array_metadata_parent ON d_group_array_metadata(parent_group_id);
        CREATE INDEX IF NOT EXISTS idx_d_group_array_metadata_child ON d_group_array_metadata(child_name);
    `);
    
    // Tag links indexes (single column only - composite moved to heavy)
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_tag_links_from ON tag_links(from_tag_id);
        CREATE INDEX IF NOT EXISTS idx_tag_links_to ON tag_links(to_tag_id);
    `);
    
    // Tag wiki links indexes (single column only - composite moved to heavy)
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_tag_wiki_links_tag ON tag_wiki_links(tag_id);
        CREATE INDEX IF NOT EXISTS idx_tag_wiki_links_wiki ON tag_wiki_links(wiki_id);
        CREATE INDEX IF NOT EXISTS idx_tag_wiki_links_relationship ON tag_wiki_links(relationship);
    `);
    
    // Wiki links indexes (single column only - composite moved to heavy)
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_wiki_links_from ON wiki_links(from_wiki_id);
        CREATE INDEX IF NOT EXISTS idx_wiki_links_to ON wiki_links(to_wiki_id);
    `);
    
    // Wikis indexes (simple single-column only)
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_wikis_source ON wikis(source);
        CREATE INDEX IF NOT EXISTS idx_wikis_title ON wikis(title);
    `);
    
    // Wiki sections indexes (single column only - composite moved to heavy)
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_wiki_sections_wiki ON wiki_sections(wiki_id);
        CREATE INDEX IF NOT EXISTS idx_wiki_sections_anchor ON wiki_sections(anchor);
        CREATE INDEX IF NOT EXISTS idx_wiki_sections_title ON wiki_sections(title);
        CREATE INDEX IF NOT EXISTS idx_wiki_sections_parent ON wiki_sections(parent_section_id);
        CREATE INDEX IF NOT EXISTS idx_wiki_sections_type ON wiki_sections(section_type);
    `);
    
    // Wiki content links indexes
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_wiki_content_links_wiki ON wiki_content_links(wiki_id);
        CREATE INDEX IF NOT EXISTS idx_wiki_content_links_type ON wiki_content_links(link_type);
        CREATE INDEX IF NOT EXISTS idx_wiki_content_links_id ON wiki_content_links(link_id);
    `);
    
    // Tag wikis indexes (single column only - composite moved to heavy)
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_tag_wikis_tag_id ON tag_wikis(tag_id);
        CREATE INDEX IF NOT EXISTS idx_tag_wikis_wiki_id ON tag_wikis(wiki_id);
    `);
    
    // Wiki pages indexes (simple single-column only)
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_wiki_pages_title ON wiki_pages(title);
        CREATE INDEX IF NOT EXISTS idx_wiki_pages_danbooru_wiki ON wiki_pages(danbooru_wiki_id);
        CREATE INDEX IF NOT EXISTS idx_wiki_pages_e621_wiki ON wiki_pages(e621_wiki_id);
        CREATE INDEX IF NOT EXISTS idx_wiki_page_links_page ON wiki_page_links(page_id);
        CREATE INDEX IF NOT EXISTS idx_wiki_page_links_tag ON wiki_page_links(linked_tag_id);
        CREATE INDEX IF NOT EXISTS idx_wiki_page_links_page_id ON wiki_page_links(linked_page_id);
        CREATE INDEX IF NOT EXISTS idx_wiki_page_tags_page ON wiki_page_tags(page_id);
        CREATE INDEX IF NOT EXISTS idx_wiki_page_tags_tag ON wiki_page_tags(tag_id);
    `);
    
    console.log('   ✓ Lightweight indexes created');
}

/**
 * Create heavy indexes (FTS5, function-based, composite indexes on large tables)
 * These are created AFTER all data insertion for better performance
 */
function createHeavyIndexes(db) {
    console.log('\n📇 Creating heavy indexes (FTS5, function-based, composite)...');
    
    // FTS5 virtual table for fast full-text search on wiki bodies
    // This is very heavy and should be created after all data is inserted
    console.log('   Creating FTS5 virtual table...');
    db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS wikis_fts USING fts5(
            body,
            title,
            source UNINDEXED,  -- Store but don't index (for filtering)
            content='wikis',
            content_rowid='id'
        );
    `);
    
    // Triggers to keep FTS5 table in sync with wikis table
    db.exec(`
        CREATE TRIGGER IF NOT EXISTS wikis_fts_insert AFTER INSERT ON wikis BEGIN
            INSERT INTO wikis_fts(rowid, body, title, source) 
            VALUES (new.id, new.body, new.title, new.source);
        END;
        
        CREATE TRIGGER IF NOT EXISTS wikis_fts_update AFTER UPDATE ON wikis BEGIN
            UPDATE wikis_fts 
            SET body = new.body, title = new.title, source = new.source 
            WHERE rowid = new.id;
        END;
        
        CREATE TRIGGER IF NOT EXISTS wikis_fts_delete AFTER DELETE ON wikis BEGIN
            DELETE FROM wikis_fts WHERE rowid = old.id;
        END;
    `);
    
    // Populate FTS5 with existing data
    console.log('   Populating FTS5 index...');
    db.exec(`
        INSERT INTO wikis_fts(rowid, body, title, source)
        SELECT id, body, title, source FROM wikis
    `);
    console.log('   ✓ FTS5 index created and populated');

    // Trigram FTS on tag titles for substring / near-match title lookup
    console.log('   Creating tags_title_fts (trigram)...');
    db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS tags_title_fts USING fts5(
            tag_id UNINDEXED,
            title,
            tokenize='trigram'
        );
    `);
    db.exec(`
        INSERT INTO tags_title_fts(tag_id, title)
        SELECT id, LOWER(title) FROM tags
    `);
    console.log('   ✓ tags_title_fts created and populated');
    
    // Function-based indexes (LOWER() - expensive to compute)
    console.log('   Creating function-based indexes...');
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_tags_title_lower ON tags(LOWER(title));
        CREATE INDEX IF NOT EXISTS idx_other_names_name_lower ON tag_other_names(LOWER(other_name));
        CREATE INDEX IF NOT EXISTS idx_words_word_lower ON tag_words(LOWER(word));
        CREATE INDEX IF NOT EXISTS idx_tag_words_prefix ON tag_words(substr(word, 1, 3), word);
        CREATE INDEX IF NOT EXISTS idx_tag_word_sequences_sequence_lower ON tag_word_sequences(LOWER(sequence));
        CREATE INDEX IF NOT EXISTS idx_wikis_title_lower ON wikis(LOWER(title));
        CREATE INDEX IF NOT EXISTS idx_wiki_pages_title_lower ON wiki_pages(LOWER(title));
    `);
    console.log('   ✓ Function-based indexes created');
    
    // Composite indexes on large tables (tag-to-tag, tag-to-wiki, wiki-to-wiki)
    console.log('   Creating composite indexes on link tables...');
    db.exec(`
        -- Tag links composite indexes (tag-to-tag)
        CREATE INDEX IF NOT EXISTS idx_tag_links_from_to ON tag_links(from_tag_id, to_tag_id);
        
        -- Tag wiki links composite indexes (tag-to-wiki)
        CREATE INDEX IF NOT EXISTS idx_tag_wiki_links_tag_relationship ON tag_wiki_links(tag_id, relationship);
        CREATE INDEX IF NOT EXISTS idx_tag_wiki_links_wiki_relationship ON tag_wiki_links(wiki_id, relationship);
        
        -- Wiki links composite indexes (wiki-to-wiki)
        CREATE INDEX IF NOT EXISTS idx_wiki_links_from_to ON wiki_links(from_wiki_id, to_wiki_id);
        
        -- Wikis composite indexes
        CREATE INDEX IF NOT EXISTS idx_wikis_title_source ON wikis(title, source);
        CREATE INDEX IF NOT EXISTS idx_wikis_id_source ON wikis(id, source);  -- For getBodyBySource join optimization
        
        -- Wiki sections composite indexes
        CREATE INDEX IF NOT EXISTS idx_wiki_sections_index ON wiki_sections(wiki_id, section_index);
        CREATE INDEX IF NOT EXISTS idx_wiki_sections_wiki_parent ON wiki_sections(wiki_id, parent_section_id);
        
        -- Tag wikis composite indexes
        CREATE INDEX IF NOT EXISTS idx_tag_wikis_tag_wiki ON tag_wikis(tag_id, wiki_id);
        
        -- Tag word sequences composite indexes (for fast predictive matching)
        -- This enables queries like: "Find all tags containing sequence 'red hood'"
        CREATE INDEX IF NOT EXISTS idx_tag_word_sequences_sequence_length ON tag_word_sequences(sequence, sequence_length);
        CREATE INDEX IF NOT EXISTS idx_tag_word_sequences_tag_length ON tag_word_sequences(tag_id, sequence_length);
    `);
    console.log('   ✓ Composite indexes created');
    console.log('   ✓ All heavy indexes created');
}

/**
 * Create database views for unified access
 */
function createViews(db) {
    console.log('\n👁️  Creating database views...');
    
    // Unified view of all wikis (tagged and untagged)
    // This combines wikis linked to tags via tag_wikis and wikis linked to pages via wiki_pages
    // If a wiki is linked to both a tag and a page, it appears as tagged (prioritized)
    db.exec(`
        CREATE VIEW IF NOT EXISTS all_wikis AS
        -- Tagged wikis (wikis linked to tags) - prioritized
        SELECT DISTINCT
            w.id AS wiki_id,
            w.title,
            w.body,
            w.source,
            w.created_at,
            w.updated_at,
            tw.tag_id,
            NULL AS page_id,
            1 AS is_tagged
        FROM wikis w
        INNER JOIN tag_wikis tw ON w.id = tw.wiki_id
        
        UNION
        
        -- Untagged wikis (wikis linked to pages but NOT to tags)
        SELECT DISTINCT
            w.id AS wiki_id,
            w.title,
            w.body,
            w.source,
            w.created_at,
            w.updated_at,
            NULL AS tag_id,
            wp.id AS page_id,
            0 AS is_tagged
        FROM wikis w
        INNER JOIN wiki_pages wp ON (w.id = wp.danbooru_wiki_id OR w.id = wp.e621_wiki_id)
        WHERE w.id NOT IN (SELECT wiki_id FROM tag_wikis)
        
        ORDER BY title, source;
    `);
    
    console.log('   ✓ Created view: all_wikis');
    console.log('   ✓ All views created');
}

/**
 * Convert category string to number
 */
function categoryStringToNumber(categoryName) {
    if (typeof categoryName === 'number') return categoryName;
    if (typeof categoryName !== 'string') return 0;
    
    switch (categoryName.toLowerCase()) {
        case 'general': return 0;
        case 'artist': return 1;
        case 'copyright': return 3;
        case 'character': return 4;
        case 'meta': return 5;
        default: return 0;
    }
}

/**
 * Build d-groups hierarchy from dataset_tag_groups.json (phase 1: structure only)
 * Recursively processes nested structure to create groups with parent relationships
 */
function buildDGroupsHierarchy(db, datasetGroups) {
    console.log('\n🔍 Building d-groups hierarchy...');
    
    // First pass: collect all groups with their metadata
    const groupsToInsert = []; // { name, path, parentPath, prettyName, description, icon, isArray }
    const arrayMetadataToInsert = []; // { parentPath, childName, prettyName, icon }
    
    /**
     * Recursively collect groups and metadata
     * @param {Object} obj - Current level of the groups object
     * @param {string} parentPath - Full path of parent (e.g., "g/attire")
     */
    function collectGroups(obj, parentPath = 'g') {
        // Extract metadata from current level
        const metadata = obj._metadata || {};
        const prettyName = metadata.prettyName || null;
        const description = metadata.description || null;
        const icon = metadata.icon || null;
        
        // Process array metadata (for children that are arrays)
        const arrayNames = metadata.arrayNames || {};
        const arrayIcons = metadata.arrayIcons || {};
        
        for (const [key, value] of Object.entries(obj)) {
            // Skip metadata
            if (key === '_metadata') continue;
            
            // Build current path
            const currentPath = parentPath === 'g' ? `g/${key}` : `${parentPath}/${key}`;
            
            // Check if this is a leaf node (array of tags) or a branch (object)
            if (Array.isArray(value)) {
                // Leaf node - collect group for this array
                const arrayPrettyName = arrayNames[key] || null;
                const arrayIcon = arrayIcons[key] || null;
                
                groupsToInsert.push({
                    name: key,
                    path: currentPath,
                    parentPath: parentPath,
                    prettyName: arrayPrettyName, // Array metadata goes on the group itself
                    description: null,
                    icon: arrayIcon,
                    isArray: true
                });
                
                // Store array metadata reference (parent knows about this child)
                if (arrayPrettyName || arrayIcon) {
                    arrayMetadataToInsert.push({
                        parentPath: parentPath,
                        childName: key,
                        prettyName: arrayPrettyName,
                        icon: arrayIcon
                    });
                }
            } else if (typeof value === 'object' && value !== null) {
                // Branch node - collect group and recurse
                const childMetadata = value._metadata || {};
                const childPrettyName = childMetadata.prettyName || null;
                const childDescription = childMetadata.description || null;
                const childIcon = childMetadata.icon || null;
                
                groupsToInsert.push({
                    name: key,
                    path: currentPath,
                    parentPath: parentPath,
                    prettyName: childPrettyName,
                    description: childDescription,
                    icon: childIcon,
                    isArray: false
                });
                
                // Recurse into children
                collectGroups(value, currentPath);
            }
        }
    }
    
    // Collect all groups first
    collectGroups(datasetGroups);
    
    // Second pass: insert all groups with metadata (need parent IDs, so insert in order)
    const groupPathMap = new Map(); // path -> id
    const insertDGroup = db.prepare(`
        INSERT INTO d_groups (name, path, parent_id, pretty_name, description, icon) 
        VALUES (?, ?, ?, ?, ?, ?)
    `);
    
    const insertArrayMetadata = db.prepare(`
        INSERT INTO d_group_array_metadata (parent_group_id, child_name, pretty_name, icon)
        VALUES (?, ?, ?, ?)
    `);
    
    // Sort groups by path depth (parents before children) to ensure parent IDs exist
    groupsToInsert.sort((a, b) => {
        const aDepth = a.path.split('/').length;
        const bDepth = b.path.split('/').length;
        if (aDepth !== bDepth) return aDepth - bDepth;
        return a.path.localeCompare(b.path);
    });
    
    // Insert groups in order (parents first)
    for (const group of groupsToInsert) {
        const parentId = group.parentPath === 'g' ? null : groupPathMap.get(group.parentPath);
        insertDGroup.run(
            group.name,
            group.path,
            parentId,
            group.prettyName,
            group.description,
            group.icon
        );
        
        // Get the inserted ID
        const result = db.prepare('SELECT last_insert_rowid() as id').get();
        if (result) {
            groupPathMap.set(group.path, result.id);
        }
    }
    
    // Insert array metadata (now we have all group IDs)
    for (const arrayMeta of arrayMetadataToInsert) {
        const parentId = arrayMeta.parentPath === 'g' ? null : groupPathMap.get(arrayMeta.parentPath);
        if (parentId) {
            insertArrayMetadata.run(
                parentId,
                arrayMeta.childName,
                arrayMeta.prettyName,
                arrayMeta.icon
            );
        }
    }
    
    console.log(`   ✓ Created ${groupPathMap.size} d-groups with metadata`);
    console.log(`   ✓ Created ${arrayMetadataToInsert.length} array metadata entries`);
    return groupPathMap;
}

/**
 * Populate dataset_group_members with tag-to-group memberships from dataset_tag_groups.json (phase 2: after tags inserted)
 */
function populateDatasetGroupMembers(db, datasetGroups, tagIdMap, groupPathMap) {
    console.log('\n🔗 Populating dataset group members...');
    
    const groupMembersToInsert = []; // { groupId, tagId } - collected for batch insert
    
    /**
     * Recursively process the groups structure to collect memberships
     * @param {Object} obj - Current level of the groups object
     * @param {string} parentPath - Full path of parent (e.g., "g/attire")
     */
    function processGroups(obj, parentPath = 'g') {
        for (const [key, value] of Object.entries(obj)) {
            // Skip metadata
            if (key === '_metadata') continue;
            
            // Build current path
            const currentPath = parentPath === 'g' ? `g/${key}` : `${parentPath}/${key}`;
            
            // Check if this is a leaf node (array of tags) or a branch (object)
            if (Array.isArray(value)) {
                // Leaf node - collect tag memberships for this group
                const groupId = groupPathMap.get(currentPath);
                if (groupId) {
                    for (const tagName of value) {
                        if (typeof tagName === 'string') {
                            const normalizedTagName = normalizeTitle(tagName);
                            const tagId = tagIdMap.get(normalizedTagName);
                            if (tagId) {
                                groupMembersToInsert.push({ groupId, tagId });
                            }
                        }
                    }
                }
            } else if (typeof value === 'object' && value !== null) {
                // Branch node - recurse into children
                processGroups(value, currentPath);
            }
        }
    }
    
    // Start processing from root
    processGroups(datasetGroups);
    
    // Insert all group members in a single transaction
    if (groupMembersToInsert.length > 0) {
        console.log(`   Inserting ${groupMembersToInsert.length} tag-to-group memberships...`);
        const insertGroupMember = db.prepare(`
            INSERT OR IGNORE INTO dataset_group_members (group_id, tag_id) VALUES (?, ?)
        `);
        
        const insertMembersTransaction = db.transaction((members) => {
            for (const member of members) {
                insertGroupMember.run(member.groupId, member.tagId);
            }
        });
        
        insertMembersTransaction(groupMembersToInsert);
        console.log(`   ✓ Inserted ${groupMembersToInsert.length} group memberships`);
    } else {
        console.log('   ✓ No group memberships to insert');
    }
}

/**
 * Build z-category map and insert into database from merged tags
 */
function buildZCategoriesFromMergedTags(db, mergedTags) {
    console.log('\n🔍 Building z-categories...');
    
    const zCategoryMap = new Map(); // name -> id
    const zCategoryParents = new Map(); // name -> parent name
    
    // Collect all z_categories from merged tags
    for (const [normalizedTitle, tag] of Object.entries(mergedTags)) {
        if (tag.z_category && Array.isArray(tag.z_category)) {
            for (const zCat of tag.z_category) {
                if (typeof zCat === 'string') {
                    zCategoryMap.set(zCat, null); // Will be assigned ID
                } else if (typeof zCat === 'object' && zCat.name) {
                    zCategoryMap.set(zCat.name, null);
                    if (zCat.parent) {
                        zCategoryParents.set(zCat.name, zCat.parent);
                    }
                }
            }
        }
    }
    
    // Insert z-categories (use INSERT OR IGNORE to handle duplicates)
    const insertZCategory = db.prepare(`
        INSERT OR IGNORE INTO z_categories (name, parent_id) VALUES (?, ?)
    `);
    
    const getZCategoryId = db.prepare(`
        SELECT id FROM z_categories WHERE name = ?
    `);
    
    // Insert root categories first
    for (const [name, parentName] of zCategoryParents.entries()) {
        if (!zCategoryParents.has(parentName)) {
            // This is a root category
            insertZCategory.run(name, null);
            const row = getZCategoryId.get(name);
            if (row) {
                zCategoryMap.set(name, row.id);
            }
        }
    }
    
    // Insert remaining categories
    for (const name of zCategoryMap.keys()) {
        if (zCategoryMap.get(name) === null) {
            const parentName = zCategoryParents.get(name);
            const parentId = parentName ? zCategoryMap.get(parentName) : null;
            insertZCategory.run(name, parentId);
            const row = getZCategoryId.get(name);
            if (row) {
                zCategoryMap.set(name, row.id);
            }
        }
    }
    
    console.log(`   ✓ Created ${zCategoryMap.size} z-categories`);
    return zCategoryMap;
}

/**
 * Merge dataset_tags.json into danbooru_tagwiki.json (anime/danbooru dataset)
 * Returns merged object with tags and their wikis connected
 */
function mergeAnimeDataset(wikiData, countsData) {
    console.log('\n🔀 Merging anime dataset (dataset_tags.json -> danbooru_tagwiki.json)...');
    
    const mergedTags = {}; // normalized_title -> merged tag object
    const countsMap = new Map(); // normalized_title -> counts data
    
    // Build counts map
    for (const [key, tag] of Object.entries(countsData)) {
        if (key === '_metadata') continue;
        const normalized = normalizeTitle(key);
        countsMap.set(normalized, tag);
    }
    
    // Merge wiki data with counts data
    let processed = 0;
    let matched = 0;
    let unmatched = 0;
    const totalTags = Object.keys(wikiData).filter(k => k !== '_metadata').length;
    
    for (const [key, tag] of Object.entries(wikiData)) {
        if (key === '_metadata') continue;
        if (!tag || typeof tag !== 'object' || !tag.title) continue;
        if (tag.is_deleted === true) continue;
        
        processed++;
        if (processed % 10000 === 0) {
            console.log(`   Progress: ${processed}/${totalTags} (${Math.round(processed/totalTags*100)}%)`);
        }
        
        const normalizedTitle = normalizeTitle(tag.title || key);
        const title = (tag.title || key).replace(/_/g, ' ').trim();
        const countEntry = countsMap.get(normalizedTitle);
        
        // Create merged tag object
        const body = tag.body && tag.body !== "The wiki page does not exist." 
            ? tag.body.replace(/\r\n/g, '\n').replace(/\r/g, '\n') // Only normalize newlines here, full normalization happens during collection
            : null;
        
        const mergedTag = {
            title: title,
            normalized_title: normalizedTitle,
            body: body,
            category: tag.category !== undefined && tag.category !== null 
                ? (typeof tag.category === 'number' ? tag.category : parseInt(tag.category) || null)
                : (countEntry && countEntry.d_category 
                    ? categoryStringToNumber(countEntry.d_category)
                    : null),
            d_count: countEntry && countEntry.d_count !== undefined && countEntry.d_count !== null
                ? (typeof countEntry.d_count === 'number' ? countEntry.d_count : parseInt(countEntry.d_count) || 0)
                : (tag.n !== undefined && tag.n !== null
                    ? (typeof tag.n === 'number' ? tag.n : parseInt(tag.n) || 0)
                    : 0),
            n_count: countEntry && countEntry.n_count !== undefined && countEntry.n_count !== null && countEntry.n_count !== 0
                ? (typeof countEntry.n_count === 'number' ? countEntry.n_count : parseInt(countEntry.n_count) || null)
                : (tag.n_count !== undefined && tag.n_count !== null && tag.n_count !== 0
                    ? (typeof tag.n_count === 'number' ? tag.n_count : parseInt(tag.n_count) || null)
                    : null),
            n_rand: tag.n_rand === true || tag.n_rand === 1 ? 1 : 0,
            is_locked: tag.is_locked === true || tag.is_locked === 1 ? 1 : 0,
            other_names: tag.other_names && Array.isArray(tag.other_names) ? tag.other_names.map(n => n.replace(/_/g, ' ')) : [],
            words: countEntry && countEntry.words && Array.isArray(countEntry.words) ? countEntry.words.map(w => w.replace(/_/g, ' ')) : [],
            z_category: countEntry && countEntry.z_category ? countEntry.z_category : [],
            d_group: countEntry && countEntry.d_group ? countEntry.d_group : [],
            is_linking_to: tag.is_linking_to && Array.isArray(tag.is_linking_to) ? tag.is_linking_to.map(l => l.replace(/_/g, ' ')) : [],
            is_linked_by: tag.is_linked_by && Array.isArray(tag.is_linked_by) ? tag.is_linked_by.map(l => l.replace(/_/g, ' ')) : [],
            created_at: tag.created_at ? String(tag.created_at) : null,
            updated_at: tag.updated_at ? String(tag.updated_at) : null,
            source: SOURCE_DANBOORU
        };
        
        // Initialize bodiesBySource for tracking bodies by source
        if (mergedTag.body) {
            mergedTag.bodiesBySource = { [SOURCE_DANBOORU]: mergedTag.body };
        }
        
        // Handle duplicates (same normalized title)
        if (mergedTags[normalizedTitle]) {
            // Merge: prefer longer body, combine arrays
            const existing = mergedTags[normalizedTitle];
            
            // Track bodies by source - preserve both if they exist (though both are from Danbooru in this case)
            if (!existing.bodiesBySource) {
                existing.bodiesBySource = {};
                if (existing.body) {
                    existing.bodiesBySource[existing.source || SOURCE_DANBOORU] = existing.body;
                }
            }
            
            // Add new body if it exists (same source, but prefer longer)
            if (mergedTag.body) {
                existing.bodiesBySource[SOURCE_DANBOORU] = mergedTag.body;
            }
            
            // Keep the longer body as the primary body
            if (mergedTag.body && (!existing.body || mergedTag.body.length > existing.body.length)) {
                existing.body = mergedTag.body;
                existing.source = mergedTag.source; // Update source to match where the body came from
                // Update timestamps to match the source of the body we're using
                if (mergedTag.created_at) existing.created_at = mergedTag.created_at;
                if (mergedTag.updated_at) existing.updated_at = mergedTag.updated_at;
            }
            existing.d_count = Math.max(existing.d_count || 0, mergedTag.d_count || 0);
            // Merge n_count: only update if new value is not null and not 0
            // If existing is set, don't overwrite with null/0
            if (mergedTag.n_count !== null && mergedTag.n_count !== 0) {
                existing.n_count = existing.n_count !== null ? Math.max(existing.n_count, mergedTag.n_count) : mergedTag.n_count;
            }
            // If existing is null and new is null/0, keep it as null (already null)
            // Combine arrays (union)
            existing.other_names = [...new Set([...existing.other_names, ...mergedTag.other_names])];
            existing.words = [...new Set([...existing.words, ...mergedTag.words])];
            existing.is_linking_to = [...new Set([...existing.is_linking_to, ...mergedTag.is_linking_to])];
            existing.is_linked_by = [...new Set([...existing.is_linked_by, ...mergedTag.is_linked_by])];
            if (!existing.category && mergedTag.category !== null) {
                existing.category = mergedTag.category;
            }
            matched++;
        } else {
            mergedTags[normalizedTitle] = mergedTag;
            if (countEntry) {
                matched++;
            } else {
                unmatched++;
            }
        }
    }
    
    console.log(`   ✓ Merged ${Object.keys(mergedTags).length} tags (${matched} matched with counts, ${unmatched} wiki-only)`);
    return mergedTags;
}

/**
 * Merge dataset_tags_furry.json into wiki_pages-*.csv (furry/e621 dataset)
 * Returns merged object with tags and their wikis connected
 * Also returns unlinked wiki pages (from CSV that don't have tags in furry dataset)
 */
function mergeFurryDataset(furryData, wikiCsvSource, options = {}) {
    console.log('\n🔀 Merging furry dataset (dataset_tags_furry.json -> wiki_pages-*.csv)...');
    
    if (!furryData || !wikiCsvSource) {
        console.log('   ⚠️  No furry data to merge');
        return { tags: {}, unlinkedWikis: [] };
    }
    const skipUnlinked = options.skipUnlinked === true;
    
    // Build furry data map
    const furryMap = new Map(); // normalized_title -> furry tag data
    for (const [key, tag] of Object.entries(furryData)) {
        if (key === '_metadata') continue;
        const tagName = tag.tag_name || key;
        const normalizedTitle = normalizeTitle(tagName);
        furryMap.set(normalizedTitle, { ...tag, tagName });
    }
    
    // Build wiki CSV map (collect ALL wikis, not just those with tags)
    // IMPORTANT: Preserve original title format from CSV (keep underscores as-is)
    // We only normalize for matching/lookup, but store the original format
    const wikiMap = new Map(); // normalized_title -> wiki data
    const ingestWikiRow = (row) => {
        const originalTitle = (row.title || '').trim();
        if (!originalTitle) return;
        // Skip help: and e621: prefixed pages
        if (originalTitle.toLowerCase().startsWith('help:') || originalTitle.toLowerCase().startsWith('e621:')) {
            return;
        }
        
        // Use original title for storage (preserve underscores), but normalize for matching
        const normalizedTitle = normalizeTitle(originalTitle);
        if (skipUnlinked && !furryMap.has(normalizedTitle)) return;
        let body = row.body || null;
        if (body) {
            // Only normalize newlines here, full normalization happens during collection
            body = body.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
            if (body.trim() === '' || body === "The wiki page does not exist.") {
                body = null;
            }
        }
        
        // Convert underscores to spaces for consistent title format
        // This ensures CSV titles match tag titles (which also convert underscores to spaces)
        let normalizedTitleFormat = originalTitle.replace(/_/g, ' ').trim();
        
        // Normalize tag group prefix: "Tag group:", "tag group:" -> "tag_group:" (no space after colon)
        if (normalizedTitleFormat.toLowerCase().startsWith('tag group:') || normalizedTitleFormat.toLowerCase().startsWith('tag_group:')) {
            normalizedTitleFormat = normalizedTitleFormat.replace(/^tag\s+group:\s*/i, 'tag_group:');
            normalizedTitleFormat = normalizedTitleFormat.replace(/^tag_group:\s+/i, 'tag_group:');
        }
        
        wikiMap.set(normalizedTitle, {
            title: normalizedTitleFormat, // Use normalized format (spaces, not underscores) for consistency
            body: body,
            is_locked: row.is_locked !== undefined && row.is_locked !== null 
                ? (row.is_locked === true || row.is_locked === 1 || row.is_locked === '1' ? 1 : 0)
                : 0,
            created_at: row.created_at || null,
            updated_at: row.updated_at || null
        });
    };
    if (typeof wikiCsvSource === 'string') {
        if (!fs.existsSync(wikiCsvSource)) {
            console.log('   ⚠️  No furry data to merge');
            return { tags: {}, unlinkedWikis: [] };
        }
        forEachCsvRow(wikiCsvSource, ingestWikiRow);
    } else if (Array.isArray(wikiCsvSource) && wikiCsvSource.length > 0) {
        for (const row of wikiCsvSource) ingestWikiRow(row);
    } else {
        console.log('   ⚠️  No furry data to merge');
        return { tags: {}, unlinkedWikis: [] };
    }
    
    // Merge furry tags with wikis (only include tags that exist in furry dataset)
    const mergedTags = {};
    const unlinkedWikis = []; // Wiki pages from CSV that don't have tags in furry dataset
    let processed = 0;
    let withWiki = 0;
    let withoutWiki = 0;
    const processedWikiTitles = new Set(); // Track which wikis are linked to tags
    
    for (const [normalizedTitle, tag] of furryMap.entries()) {
        processed++;
        if (processed % 10000 === 0) {
            console.log(`   Progress: ${processed}/${furryMap.size} (${Math.round(processed/furryMap.size*100)}%)`);
        }
        
        // Normalize title format: convert underscores to spaces for consistency
        // This ensures tags and CSV wikis use the same format
        const title = tag.tagName.replace(/_/g, ' ').trim();
        const normalizedTitle = normalizeTitle(title);
        const wikiData = wikiMap.get(normalizedTitle);
        
        // Only include tags that have counts (from furry dataset)
        // Note: Wikis without tags will be added as wiki pages separately
        const eCategoryStr = tag.e_category ? String(tag.e_category).toLowerCase() : null;
        const category = eCategoryStr ? categoryStringToNumber(eCategoryStr) : null;
        const eCount = tag.e_count !== undefined && tag.e_count !== null
            ? (typeof tag.e_count === 'number' ? tag.e_count : parseInt(tag.e_count) || 0)
            : 0;
        
        const mergedTag = {
            title: title,
            normalized_title: normalizedTitle,
            body: wikiData && wikiData.body ? wikiData.body : null,
            category: category,
            d_count: null,
            e_count: eCount,
            n_count: tag.n_count !== undefined && tag.n_count !== null && tag.n_count !== 0
                ? (typeof tag.n_count === 'number' ? tag.n_count : parseInt(tag.n_count) || null)
                : null,
            n_rand: 0,
            is_locked: wikiData ? wikiData.is_locked : 0,
            other_names: tag.e_name && tag.e_name !== tag.tagName ? [tag.e_name.replace(/_/g, ' ')] : [],
            words: [],
            z_category: [],
            d_group: tag.e_group && Array.isArray(tag.e_group) ? tag.e_group : [],
            is_linking_to: [],
            is_linked_by: [],
            created_at: wikiData ? wikiData.created_at : null,
            updated_at: wikiData ? wikiData.updated_at : null,
            source: SOURCE_E621
        };
        
        if (wikiData && wikiData.body) {
            withWiki++;
            processedWikiTitles.add(normalizedTitle); // Mark this wiki as linked to a tag
        } else {
            withoutWiki++;
        }
        
        mergedTags[normalizedTitle] = mergedTag;
    }
    
    // Collect unlinked wiki pages (from CSV that don't have tags in furry dataset)
    // Skip when the official wiki dump will insert these later.
    if (!skipUnlinked) {
        for (const [normalizedTitle, wikiData] of wikiMap.entries()) {
            // Skip if already linked to a tag
            if (processedWikiTitles.has(normalizedTitle)) continue;
            
            // Only add if it has a body and it's not a "does not exist" message
            const trimmedBody = wikiData.body ? wikiData.body.trim() : '';
            if (trimmedBody !== '' && 
                trimmedBody !== "The wiki page does not exist." && 
                !trimmedBody.startsWith("This wiki page does not exist.")) {
                unlinkedWikis.push({
                    title: wikiData.title,
                    normalized_title: normalizedTitle,
                    body: wikiData.body,
                    created_at: wikiData.created_at,
                    updated_at: wikiData.updated_at,
                    source: SOURCE_E621
                });
            }
        }
    }
    
    console.log(`   ✓ Merged ${Object.keys(mergedTags).length} tags (${withWiki} with wiki, ${withoutWiki} without wiki)\n     Found ${unlinkedWikis.length} unlinked wiki pages from CSV`);
    return { tags: mergedTags, unlinkedWikis: unlinkedWikis };
}

/**
 * Merge anime and furry datasets together
 * Handles deduplication and merging of tags that exist in both
 */
function mergeAnimeAndFurry(animeTags, furryTags) {
    console.log('\n🔀 Merging anime and furry datasets...');
    
    const merged = {};
    let animeOnly = 0;
    let furryOnly = 0;
    let mergedCount = 0;
    
    // Process anime tags
    for (const [normalizedTitle, tag] of Object.entries(animeTags)) {
        // Track bodies by source to preserve both if tag exists in multiple sources
        const mergedTag = { ...tag };
        if (mergedTag.body) {
            mergedTag.bodiesBySource = { [tag.source || SOURCE_DANBOORU]: mergedTag.body };
        }
        merged[normalizedTitle] = mergedTag;
        animeOnly++;
    }
    
    // Process furry tags (merge with anime if exists)
    for (const [normalizedTitle, tag] of Object.entries(furryTags)) {
        if (merged[normalizedTitle]) {
            // Merge: combine data from both sources
            const existing = merged[normalizedTitle];
            
            // Track bodies by source - preserve both if they exist
            if (!existing.bodiesBySource) {
                existing.bodiesBySource = {};
                if (existing.body) {
                    existing.bodiesBySource[existing.source || SOURCE_DANBOORU] = existing.body;
                }
            }
            
            // Add furry body if it exists
            if (tag.body) {
                existing.bodiesBySource[tag.source || SOURCE_E621] = tag.body;
            }
            
            // Keep the longer body as the primary body for backwards compatibility
            const existingBody = existing.bodiesBySource[existing.source || SOURCE_DANBOORU] || existing.body;
            const tagBody = tag.body;
            if (tagBody && (!existingBody || tagBody.length > existingBody.length)) {
                existing.body = tagBody;
                existing.source = tag.source; // Update source for primary body
                // Update timestamps to match the source of the primary body
                if (tag.created_at) existing.created_at = tag.created_at;
                if (tag.updated_at) existing.updated_at = tag.updated_at;
            } else if (existingBody) {
                existing.body = existingBody;
            }
            
            // Merge counts (keep both d_count and e_count)
            existing.e_count = tag.e_count || 0;
            
            // Merge n_count: only update if new value is not null and not 0
            // If existing is set, don't overwrite with null/0
            if (tag.n_count !== null && tag.n_count !== 0) {
                existing.n_count = existing.n_count !== null ? Math.max(existing.n_count, tag.n_count) : tag.n_count;
            }
            // If existing is null and new is null/0, keep it as null (already null)
            
            // Merge category (use first non-null)
            if (!existing.category && tag.category !== null) {
                existing.category = tag.category;
            }
            
            // Merge is_locked (true if either is true)
            existing.is_locked = existing.is_locked || tag.is_locked;
            
            // Combine arrays (union)
            existing.other_names = [...new Set([...existing.other_names, ...tag.other_names])];
            existing.words = [...new Set([...existing.words, ...tag.words])];
            existing.d_group = [...new Set([...existing.d_group, ...tag.d_group])];
            existing.is_linking_to = [...new Set([...existing.is_linking_to, ...tag.is_linking_to])];
            existing.is_linked_by = [...new Set([...existing.is_linked_by, ...tag.is_linked_by])];
            
            // Update timestamps if furry has newer data (but only if we didn't already update them above)
            // Check if we used the tag body by comparing current body with tag body
            const usedTagBody = tag.body && existing.body === tag.body;
            if (!usedTagBody) {
                if (tag.updated_at && (!existing.updated_at || tag.updated_at > existing.updated_at)) {
                    existing.updated_at = tag.updated_at;
                }
            }
            
            mergedCount++;
        } else {
            // Furry-only tag
            const mergedTag = { ...tag };
            if (mergedTag.body) {
                mergedTag.bodiesBySource = { [tag.source || SOURCE_E621]: mergedTag.body };
            }
            merged[normalizedTitle] = mergedTag;
            furryOnly++;
        }
    }
    
    animeOnly -= mergedCount; // Adjust count
    
    console.log(`   ✓ Merged ${Object.keys(merged).length} total tags:`);
    console.log(`     - ${animeOnly} anime-only`);
    console.log(`     - ${furryOnly} furry-only`);
    console.log(`     - ${mergedCount} in both (merged)`);
    
    return merged;
}

function parseDumpPostCount(row) {
    const n = parseInt(row.post_count, 10);
    return Number.isFinite(n) ? n : 0;
}

function parseDumpCategory(row) {
    if (row.category === undefined || row.category === null || row.category === '') {
        return null;
    }
    const raw = String(row.category).trim();
    if (/^\d+$/.test(raw)) {
        return parseInt(raw, 10);
    }
    return categoryStringToNumber(raw);
}

function isDumpTruthy(value) {
    const raw = String(value || '').toLowerCase();
    return raw === 't' || raw === 'true' || raw === '1';
}

function mergeOfficialTagDump(mergedTags, csvPath, source) {
    if (!csvPath || !fs.existsSync(csvPath)) {
        return { updated: 0, added: 0 };
    }
    console.log(`\n📥 Merging official tag dump (${path.basename(csvPath)})...`);
    let updated = 0;
    forEachCsvRow(csvPath, (row) => {
        const rawName = row.name || row.tag_name || '';
        if (!rawName) return;
        if (isDumpTruthy(row.is_deleted)) return;
        const title = String(rawName).replace(/_/g, ' ').trim();
        const normalizedTitle = normalizeTitle(title);
        if (!normalizedTitle) return;
        const postCount = parseDumpPostCount(row);
        const createdAt = row.created_at || null;
        const existing = mergedTags[normalizedTitle];
        if (existing) {
            if (createdAt && (!existing.created_at || createdAt < existing.created_at)) {
                existing.created_at = createdAt;
            }
            if (source === SOURCE_DANBOORU) {
                existing.d_count = Math.max(existing.d_count || 0, postCount);
            } else {
                existing.e_count = Math.max(existing.e_count || 0, postCount);
            }
            if (!existing.category) {
                const category = parseDumpCategory(row);
                if (category !== null) existing.category = category;
            }
            updated++;
            return;
        }
    });
    console.log(`   ✓ Dump tags: ${updated} existing tags dated`);
    return { updated, added: 0 };
}

function mergeOfficialWikiDump(allWikisMap, csvPath, source) {
    if (!csvPath || !fs.existsSync(csvPath)) {
        return 0;
    }
    console.log(`\n📥 Merging official wiki dump (${path.basename(csvPath)})...`);
    let added = 0;
    forEachCsvRow(csvPath, (row) => {
        const originalTitle = (row.title || '').trim();
        if (!originalTitle) return;
        const lower = originalTitle.toLowerCase();
        if (lower.startsWith('help:') || lower.startsWith('e621:')) return;
        if (isDumpTruthy(row.is_deleted)) return;
        let body = row.body || null;
        if (body) {
            body = body.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
            if (body.trim() === '' || body === 'The wiki page does not exist.') {
                body = null;
            }
        }
        if (!body) return;
        let title = originalTitle.replace(/_/g, ' ').trim();
        if (title.toLowerCase().startsWith('tag group:') || title.toLowerCase().startsWith('tag_group:')) {
            title = title.replace(/^tag\s+group:\s*/i, 'tag_group:');
            title = title.replace(/^tag_group:\s+/i, 'tag_group:');
        }
        const wikiKey = `${title}|${source}`;
        if (allWikisMap.has(wikiKey)) {
            const existing = allWikisMap.get(wikiKey);
            if (!existing.created_at && row.created_at) {
                existing.created_at = row.created_at;
            }
            return;
        }
        const normalized = normalizeWikiBody(body, title, source);
        allWikisMap.set(wikiKey, {
            title,
            body: normalized.body,
            source,
            created_at: row.created_at || null,
            updated_at: row.updated_at || null
        });
        added++;
    });
    console.log(`   ✓ Dump wikis added: ${added}`);
    return added;
}

/**
 * Main function to create database
 */
function removeSqliteSidecars(dbPath) {
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
        const sidecar = dbPath + suffix;
        if (!fs.existsSync(sidecar)) continue;
        try {
            fs.unlinkSync(sidecar);
            console.log(`🗑️  Deleted ${path.basename(sidecar)}`);
        } catch (error) {
            console.warn(`⚠️  Could not delete ${path.basename(sidecar)}: ${error.message}`);
        }
    }
}

function main() {
    console.log('🚀 Creating SQLite tag database...\n');
    
    try {
        const cacheDir = path.dirname(DATABASE_PATH);
        if (!fs.existsSync(cacheDir)) {
            fs.mkdirSync(cacheDir, { recursive: true });
        }
        removeSqliteSidecars(DATABASE_BUILD_PATH);
        
        // Step 1: Load datasets
        console.log('📂 Loading datasets...');
        const wikiData = loadJSON(WIKI_DATASET_PATH);
        const countsData = loadJSON(COUNTS_DATASET_PATH);
        
        // Load furry dataset (if exists)
        let furryData = null;
        if (fs.existsSync(FURRY_DATASET_PATH)) {
            furryData = loadJSON(FURRY_DATASET_PATH);
        } else {
            console.log(`\n⚠️  Furry dataset not found: ${path.basename(FURRY_DATASET_PATH)}`);
        }
        
        const e621WikiCsvPath = resolveE621WikiCsvPath();
        const e621WikiDumpPath = resolveDumpCsv('e621_wiki_pages');
        const skipUnlinkedFurry = !!(
            e621WikiCsvPath &&
            e621WikiDumpPath &&
            path.resolve(e621WikiCsvPath) === path.resolve(e621WikiDumpPath)
        );
        if (e621WikiCsvPath) {
            console.log(`\n📚 e621 wiki CSV: ${path.basename(e621WikiCsvPath)}`);
        } else {
            console.log(`\n⚠️  E621 wiki CSV not found`);
        }
        
        // Step 2: Merge datasets
        // Merge anime dataset (dataset_tags.json -> danbooru_tagwiki.json)
        const animeTags = mergeAnimeDataset(wikiData, countsData);
        
        // Merge furry dataset (dataset_tags_furry.json -> wiki_pages-*.csv)
        const furryResult = furryData && e621WikiCsvPath
            ? mergeFurryDataset(furryData, e621WikiCsvPath, { skipUnlinked: skipUnlinkedFurry })
            : { tags: {}, unlinkedWikis: [] };
        const furryTags = furryResult.tags;
        const unlinkedFurryWikis = furryResult.unlinkedWikis || [];
        
        // Merge anime and furry datasets
        const mergedTags = mergeAnimeAndFurry(animeTags, furryTags);
        mergeOfficialTagDump(mergedTags, resolveDumpCsv('danbooru_tags'), SOURCE_DANBOORU);
        mergeOfficialTagDump(mergedTags, resolveDumpCsv('e621_tags'), SOURCE_E621);
        
        // Initialize allWikisMap early so we can collect unlinked wikis as we go
        const allWikisMap = new Map(); // (title, source) -> { title, body, source, created_at, updated_at }
        const allPostThumbRefs = []; // Collect all post/thumb references for JSON export
        const allExternalUrlRefs = []; // Collect all external URL references for JSON export
        
        console.log(`\n✅ Dataset merging complete!`);
        console.log(`   Total merged tags: ${Object.keys(mergedTags).length}`);
        
        // Open a sidecar DB so a live tag_wiki.db connection cannot reuse a truncated WAL.
        console.log('💾 Opening database...');
        const db = new Database(DATABASE_BUILD_PATH);
        
        // Enable optimizations for bulk insert workload
        db.pragma('journal_mode = WAL');
        db.pragma('synchronous = NORMAL');
        db.pragma('cache_size = -128000');  // 128MB cache (increased for bulk inserts)
        db.pragma('temp_store = MEMORY');
        db.pragma('mmap_size = 536870912');  // 512MB memory-mapped I/O (increased)
        db.pragma('foreign_keys = ON');  // Enable foreign key constraints
        db.pragma('page_size = 4096');  // Optimal page size for most systems
        
        // Create schema
        createSchema(db);
        
        // Build z-categories from merged tags
        const zCategoryMap = buildZCategoriesFromMergedTags(db, mergedTags);
        
        // Load and build d-groups hierarchy (structure only, before tags are inserted)
        let datasetGroups = null;
        let dGroupPathMap = new Map(); // path -> group_id
        if (fs.existsSync(DATASET_GROUPS_PATH)) {
            datasetGroups = loadJSON(DATASET_GROUPS_PATH);
            dGroupPathMap = buildDGroupsHierarchy(db, datasetGroups);
        } else {
            console.log(`\n⚠️  Dataset groups file not found: ${path.basename(DATASET_GROUPS_PATH)}`);
        }
        
        // Prepare statements
        // Prepare statements for wikis (will be created before tags are linked)
        const insertWiki = db.prepare(`
            INSERT OR IGNORE INTO wikis (title, body, source, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
        `);
        
        const getWikiId = db.prepare(`
            SELECT id FROM wikis WHERE title = ? AND source = ?
        `);
        
        const insertTagWiki = db.prepare(`
            INSERT OR IGNORE INTO tag_wikis (tag_id, wiki_id) VALUES (?, ?)
        `);
        
        const insertTag = db.prepare(`
            INSERT INTO tags (title, normalized_title, category, d_count, e_count, n_count, n_rand, is_locked, untrained, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        
        const insertOtherName = db.prepare(`
            INSERT INTO tag_other_names (tag_id, other_name) VALUES (?, ?)
        `);
        
        const insertWord = db.prepare(`
            INSERT INTO tag_words (tag_id, word) VALUES (?, ?)
        `);
        
        const insertZCategory = db.prepare(`
            INSERT INTO tag_z_categories (tag_id, z_category_id) VALUES (?, ?)
        `);
        
        const insertDGroup = db.prepare(`
            INSERT INTO tag_d_groups (tag_id, group_id) VALUES (?, ?)
        `);
        
        const getDGroupIdByPath = db.prepare(`
            SELECT id FROM d_groups WHERE path = ?
        `);
        
        const insertTagLink = db.prepare(`
            INSERT INTO tag_links (from_tag_id, to_tag_id)
            VALUES (?, ?)
        `);
        
        const insertTagWikiLink = db.prepare(`
            INSERT INTO tag_wiki_links (tag_id, wiki_id, relationship)
            VALUES (?, ?, ?)
        `);
        
        const insertWikiLink = db.prepare(`
            INSERT INTO wiki_links (from_wiki_id, to_wiki_id)
            VALUES (?, ?)
        `);
        
        const insertWikiSection = db.prepare(`
            INSERT INTO wiki_sections (wiki_id, section_index, level, title, anchor, start_offset, end_offset, line_index, section_type, parent_section_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        
        const insertWikiContentLink = db.prepare(`
            INSERT INTO wiki_content_links (wiki_id, link_type, link_id, link_url, link_page, display_text, search_query, start_offset, end_offset)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        
        // ID generators - start from 1, increment for each new item
        // These will be assigned when building arrays, so we can insert predictably
        let nextTagId = 1;
        let nextWikiPageId = 1;
        
        // Step 1: Collect ALL unique wikis from merged tags
        // IMPORTANT: Normalize bodies BEFORE collecting so offsets are correct for section extraction
        console.log('\n📚 Collecting all unique wikis from merged tags...');
        
        // Collect wikis from merged tags
        // IMPORTANT: If a tag has bodies from multiple sources, store BOTH wikis (one per source)
        // This preserves the source information for references (post/thumb IDs, external URLs)
        for (const [normalizedTitle, tag] of Object.entries(mergedTags)) {
            // Use bodiesBySource if available (from merged tags), otherwise fall back to single body
            const bodiesBySource = tag.bodiesBySource || (tag.body ? { [tag.source || SOURCE_DANBOORU]: tag.body } : {});
            
            // Store wiki for each source that has a body
            for (const [source, body] of Object.entries(bodiesBySource)) {
                if (!body || body.trim() === '') continue;
                
                // Filter out "does not exist" messages
                const trimmedBody = body.trim();
                if (trimmedBody === "The wiki page does not exist." || 
                    trimmedBody.startsWith("This wiki page does not exist.")) {
                    continue;
                }
                
                const bodySource = parseInt(source, 10);
                const wikiKey = `${tag.title}|${bodySource}`;
                
                if (!allWikisMap.has(wikiKey)) {
                    // Apply ALL normalizations/transforms BEFORE storing
                    // This ensures section offsets are correct and data is consistent
                    const normalized = normalizeWikiBody(body, tag.title, bodySource);
                    
                    // Collect post/thumb references (source indicates which API to query)
                    if (normalized.postThumbRefs && normalized.postThumbRefs.length > 0) {
                        allPostThumbRefs.push(...normalized.postThumbRefs);
                    }
                    
                    // Collect external URL references
                    if (normalized.externalUrlRefs && normalized.externalUrlRefs.length > 0) {
                        allExternalUrlRefs.push(...normalized.externalUrlRefs);
                    }
                    
                    allWikisMap.set(wikiKey, {
                        title: tag.title, // Tag name is the wiki title
                        body: normalized.body, // Store fully normalized body
                        source: bodySource, // Store for the source this body came from
                        created_at: tag.created_at || null,
                        updated_at: tag.updated_at || null
                    });
                }
            }
        }
        
        console.log(`   ✓ Collected ${allWikisMap.size} unique wikis from tags`);
        
        // Collect unlinked wikis (tag groups and other unlinked pages) BEFORE insertion
        // This ensures all wikis are in allWikisMap when we insert them
        console.log('\n📚 Collecting unlinked wiki pages...');
        
        // Collect tag groups from danbooru JSON as unlinked wiki pages
        const unlinkedDanbooruWikis = [];
        for (const [key, group] of Object.entries(wikiData)) {
            if (key === '_metadata') continue;
            if (!group || typeof group !== 'object' || !group.title) continue;
            if (group.is_deleted === true) continue;
            
            let title = group.title.trim();
            // Normalize tag group prefix: "Tag group:", "tag group:" -> "tag_group:"
            // Remove any spaces after the colon
            title = title.replace(/^tag\s+group:\s*/i, 'tag_group:');
            // Also handle cases where it's already "tag_group:" but has spaces after colon
            title = title.replace(/^tag_group:\s+/i, 'tag_group:');
            const isTagGroup = title.toLowerCase().startsWith('tag_group:');
            if (!isTagGroup) continue;
            
            let body = group.body && group.body !== "The wiki page does not exist."
                ? group.body.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
                    : null;
            
            // Filter out "does not exist" messages (check after normalization)
            if (!body || body.trim() === '') continue;
            const trimmedBody = body.trim();
            if (trimmedBody === "The wiki page does not exist." || 
                trimmedBody.startsWith("This wiki page does not exist.")) {
                continue;
            }
            
            // Normalize "tag group:" to "tag_group:" in body (normalizeWikiBody will also do this, but do it here for consistency)
            // Remove any spaces after the colon
            body = body.replace(/tag\s+group:\s*/gi, 'tag_group:');
            // Also handle cases where it's already "tag_group:" but has spaces after colon
            body = body.replace(/tag_group:\s+/gi, 'tag_group:');
            
            // Convert underscores in wiki links
            body = body.replace(/\[\[([^\]]+)\]\]/g, (match, linkText) => {
                const parts = linkText.split('|');
                const convertedTagName = parts[0].replace(/_/g, ' ');
                const convertedLink = parts.length > 1 
                    ? `${convertedTagName}|${parts.slice(1).join('|')}`
                    : convertedTagName;
                return `[[${convertedLink}]]`;
            });
            
            unlinkedDanbooruWikis.push({
                title: title, // Already normalized to "tag_group:"
                normalized_title: normalizeTitle(title),
                body: body,
                created_at: group.created_at || null,
                updated_at: group.updated_at || null,
                source: SOURCE_DANBOORU,
                is_linking_to: group.is_linking_to || [],
                is_linked_by: group.is_linked_by || []
            });
        }
        
        // Combine unlinked wikis from both sources
        const allUnlinkedWikis = [...unlinkedDanbooruWikis, ...unlinkedFurryWikis];
        
        // Track which wiki keys are unlinked wikis (for later identification)
        const unlinkedWikiKeys = new Set();
        
        // Collect unlinked wikis into allWikisMap (these will be added as wiki pages, not tags)
        // Note: This includes tag groups - they're just wiki pages, no special handling needed
        console.log(`   Collecting ${allUnlinkedWikis.length} unlinked wiki pages into wiki map...`);
        for (const wiki of allUnlinkedWikis) {
            // Skip if no body (must have body to be inserted)
            if (!wiki.body || wiki.body.trim() === '') continue;
            
            // Filter out "does not exist" messages
            const trimmedBody = wiki.body.trim();
            if (trimmedBody === "The wiki page does not exist." || 
                trimmedBody.startsWith("This wiki page does not exist.")) {
                continue;
            }
            
            const wikiKey = `${wiki.title}|${wiki.source}`;
            
            // Only add to allWikisMap if it doesn't already exist
            // If it already exists (from tags), we'll use the existing entry
            if (!allWikisMap.has(wikiKey)) {
                // Apply ALL normalizations/transforms BEFORE storing
                // This ensures section offsets are correct and data is consistent
                const normalized = normalizeWikiBody(wiki.body, wiki.title, wiki.source);
                
                // Collect post/thumb references
                if (normalized.postThumbRefs && normalized.postThumbRefs.length > 0) {
                    allPostThumbRefs.push(...normalized.postThumbRefs);
                }
                
                // Collect external URL references
                if (normalized.externalUrlRefs && normalized.externalUrlRefs.length > 0) {
                    allExternalUrlRefs.push(...normalized.externalUrlRefs);
                }
                
                allWikisMap.set(wikiKey, {
                    title: wiki.title, // Wiki page title
                    body: normalized.body, // Store fully normalized body
                    source: wiki.source,
                    created_at: wiki.created_at || null,
                    updated_at: wiki.updated_at || null,
                    is_linking_to: wiki.is_linking_to || [],
                    is_linked_by: wiki.is_linked_by || []
                });
            } else {
                // Wiki already exists in allWikisMap (from tags), but we still need to track it as unlinked
                // Merge is_linking_to and is_linked_by if they exist
                const existingWiki = allWikisMap.get(wikiKey);
                if (existingWiki && wiki.is_linking_to) {
                    const normalized = wiki.is_linking_to.map(link => link.replace(/_/g, ' ').trim().toLowerCase());
                    existingWiki.is_linking_to = [...new Set([...(existingWiki.is_linking_to || []), ...normalized])];
                }
                if (existingWiki && wiki.is_linked_by) {
                    const normalized = wiki.is_linked_by.map(link => link.replace(/_/g, ' ').trim().toLowerCase());
                    existingWiki.is_linked_by = [...new Set([...(existingWiki.is_linked_by || []), ...normalized])];
                }
            }
            
            // Track this as an unlinked wiki (only after we've confirmed it has a body and is in allWikisMap)
            unlinkedWikiKeys.add(wikiKey);
        }
        console.log(`   ✓ Collected ${unlinkedWikiKeys.size} unlinked wiki pages into wiki map`);
        mergeOfficialWikiDump(allWikisMap, resolveDumpCsv('danbooru_wiki_pages'), SOURCE_DANBOORU);
        mergeOfficialWikiDump(allWikisMap, resolveDumpCsv('e621_wiki_pages'), SOURCE_E621);
        const e621WikiDump = resolveE621WikiCsvPath();
        if (e621WikiDump && e621WikiDump !== resolveDumpCsv('e621_wiki_pages')) {
            mergeOfficialWikiDump(allWikisMap, e621WikiDump, SOURCE_E621);
        }
        
        if (allPostThumbRefs.length > 0) {
            console.log(`   ✓ Found ${allPostThumbRefs.length} post/thumb references to export`);
        }
        if (allExternalUrlRefs.length > 0) {
            console.log(`   ✓ Found ${allExternalUrlRefs.length} external URL references to export`);
        }
        
        // Insert all unique wikis into database
        // Bodies are already normalized, so we can extract sections with correct offsets
        console.log(`   Inserting ${allWikisMap.size} unique wikis into database...`);
        const wikiIdMap = new Map(); // (title, source) -> wiki_id
        const wikiSectionsToInsert = []; // { wikiId, sections[] }
        const insertWikisTransaction = db.transaction((wikis) => {
            for (const wiki of wikis) {
                const wikiKey = `${wiki.title}|${wiki.source}`;
                
                // Extract sections from raw DText body (offsets will be correct)
                // Store raw body WITHOUT end markers - we'll use offsets from sections table for extraction
                const { sections } = extractWikiSections(wiki.body);
                
                // Store raw DText body (no end markers - use offsets from sections table for extraction)
                // Use INSERT OR IGNORE to handle duplicates (e.g., same wiki from tags and unlinked)
                const insertResult = insertWiki.run(wiki.title, wiki.body, wiki.source, wiki.created_at, wiki.updated_at);
                
                // Get the wiki ID - use lastInsertRowid if insert succeeded, otherwise query for existing
                let wikiId = null;
                if (insertResult.changes > 0) {
                    // Insert succeeded, use lastInsertRowid
                    wikiId = insertResult.lastInsertRowid;
                } else {
                    // Insert was ignored (duplicate), query for existing ID
                    // This should always succeed if INSERT OR IGNORE ignored the insert
                    const existingResult = getWikiId.get(wiki.title, wiki.source);
                    if (existingResult) {
                        wikiId = existingResult.id;
                    } else {
                        // This should never happen - indicates title format mismatch
                        // The wiki exists (INSERT OR IGNORE ignored it) but query failed
                        // This means the title format doesn't match - check for encoding/format issues
                        throw new Error(`Wiki "${wiki.title}" (source: ${wiki.source}) was not inserted but also not found. Title format mismatch - check if underscores/spaces are consistent.`);
                    }
                }
                
                if (wikiId) {
                    wikiIdMap.set(wikiKey, wikiId);
                    
                    // Body is already stored in allWikisMap as raw DText (no end markers needed)
                    // Link extraction will use the raw body directly
                    
                    if (sections.length > 0) {
                        wikiSectionsToInsert.push({ wikiId, sections });
                    }
                    
                    // Extract and store content links (file:, post:, image:, wiki:, external URLs, search URLs, and ID-based links)
                    const contentLinks = extractWikiContentLinks(wiki.body);
                    if (contentLinks.length > 0) {
                        for (const link of contentLinks) {
                            insertWikiContentLink.run(
                                wikiId,
                                link.type,
                                link.id || null,
                                link.url || null,
                                link.page || null, // Page number for topic links
                                link.displayText || null,
                                link.searchQuery || null, // Search query for search-type links
                                link.startOffset,
                                link.endOffset
                            );
                        }
                    }
                } else {
                    // Truly not found - this should not happen if insertion succeeded
                    // This means the wiki was inserted but we can't find it, which is a serious issue
                    console.error(`   ❌ CRITICAL: Wiki inserted but ID not found: "${wiki.title}" (source: ${wiki.source}, changes: ${insertResult.changes})`);
                }
            }
        });
        insertWikisTransaction(Array.from(allWikisMap.values()));
        console.log(`   ✓ Inserted ${wikiIdMap.size} unique wikis`);
        
        // Insert all wiki sections (parent relationships calculated before insertion)
        if (wikiSectionsToInsert.length > 0) {
            console.log(`   Inserting ${wikiSectionsToInsert.reduce((sum, w) => sum + w.sections.length, 0)} wiki sections...`);
            
            const insertSectionsTransaction = db.transaction((sectionsData) => {
                for (const { wikiId, sections } of sectionsData) {
                    // Build map of section index -> section_id as we insert
                    // Sections are already in order (by index), so parents will be inserted before children
                    const sectionIdMap = new Map(); // section.index -> section_id (built as we insert)
                    
                    // Sort sections by index to ensure parents are inserted before children
                    // (In a proper hierarchy, parents always have lower indices than children)
                    const sortedSections = [...sections].sort((a, b) => a.index - b.index);
                    
                    for (const section of sortedSections) {
                        // Calculate parent_section_id before insertion
                        // Parent should already be in the map since we're inserting in order
                        let parentSectionId = null;
                        if (section.parentSectionIndex !== null && section.parentSectionIndex !== undefined) {
                            parentSectionId = sectionIdMap.get(section.parentSectionIndex) || null;
                            // If parent not found, it means parent has higher index (shouldn't happen in proper hierarchy)
                            // In that case, parent_section_id remains null (will be corrected if needed)
                        }
                        
                        // Insert section with parent_section_id already set (no UPDATE needed)
                        const result = insertWikiSection.run(
                            wikiId,
                            section.index,
                            section.level,
                            section.title,
                            section.anchor,
                            section.startOffset,
                            section.endOffset,
                            section.lineIndex,
                            section.sectionType || 0,  // 0=normal, 1=collapsible
                            parentSectionId  // Set during insertion - all work done ahead of time
                        );
                        
                        // Track the inserted section ID for future parent lookups
                        const insertedId = result.lastInsertRowid;
                        sectionIdMap.set(section.index, insertedId);
                    }
                }
            });
            insertSectionsTransaction(wikiSectionsToInsert);
            console.log(`   ✓ Inserted wiki sections with hierarchy`);
        }
        
        // Step 2: Process merged tags - collect all data first, then insert in single transactions
        console.log('\n📝 Processing merged tags...');
        const tagIdMap = new Map(); // normalized_title -> tag_id
        const titleToIdMap = new Map(); // title -> tag_id (for linking)
        const totalTags = Object.keys(mergedTags).length;
        let processedCount = 0;
        const progressInterval = Math.max(10000, Math.floor(totalTags / 20));
        
        // Collect all tag data into arrays (no database operations)
        console.log('   Collecting tag data...');
        const tagsToInsert = []; // New tags to insert (with pre-generated IDs)
        const tagWikisToInsert = []; // { tagId, wikiId } - links tags to wikis
        const otherNamesToInsert = []; // { tagId, name }
        const wordsToInsert = []; // { tagId, word }
        const wordSequencesToInsert = []; // { tagId, sequence, sequenceLength, startPosition }
        const zCategoriesToInsert = []; // { tagId, zCategoryId }
        const dGroupsToInsert = []; // { tagId, groupId }
        
        for (const [normalizedTitle, tag] of Object.entries(mergedTags)) {
            processedCount++;
            if (processedCount % progressInterval === 0) {
                const percent = Math.round((processedCount / totalTags) * 100);
                console.log(`   Progress: ${processedCount}/${totalTags} (${percent}%) - Collecting...`);
            }
            
            // Generate tag ID upfront
            const tagId = Number(nextTagId++);
            
            // Store ID mappings immediately
            tagIdMap.set(normalizedTitle, tagId);
            titleToIdMap.set(tag.title.toLowerCase(), tagId);
            
            // Add tag with pre-generated ID
            const tagData = {
                id: tagId,
                normalizedTitle: tag.normalized_title,
                title: tag.title,
                category: tag.category,
                dCount: tag.d_count || 0,
                eCount: tag.e_count || 0,
                nCount: tag.n_count,
                nRand: tag.n_rand || 0,
                isLocked: tag.is_locked || 0,
                untrained: isUntrainedDate(tag.created_at) ? 1 : 0,
                createdAt: tag.created_at || null
            };
            tagsToInsert.push(tagData);
            
            // Link to wiki(s) if available - check both danbooru and e621 sources
            // A tag can have wikis from both sources with the same title
            for (let source = SOURCE_DANBOORU; source <= SOURCE_E621; source++) {
                const wikiKey = `${tag.title}|${source}`;
                const wikiId = wikiIdMap.get(wikiKey);
                if (wikiId) {
                    tagWikisToInsert.push({ tagId, wikiId });
                }
            }
            
            // Collect other_names
            if (tag.other_names && Array.isArray(tag.other_names)) {
                for (const name of tag.other_names) {
                    otherNamesToInsert.push({ tagId, name });
                }
            }
            
            // Collect words and word sequences (always from title; merge source tag.words)
            const indexedWords = new Set();
            if (tag.words && Array.isArray(tag.words)) {
                for (const word of tag.words) {
                    const w = String(word || '').toLowerCase().trim();
                    if (w && !indexedWords.has(w)) {
                        indexedWords.add(w);
                        wordsToInsert.push({ tagId, word: w });
                    }
                }
            }

            const title = tag.title || '';
            if (title) {
                const { words: titleWords, sequences } = buildTitleSearchIndexData(title);
                for (const word of titleWords) {
                    if (!indexedWords.has(word)) {
                        indexedWords.add(word);
                        wordsToInsert.push({ tagId, word });
                    }
                }
                for (const seq of sequences) {
                    wordSequencesToInsert.push({
                        tagId,
                        sequence: seq.sequence,
                        sequenceLength: seq.sequenceLength,
                        startPosition: seq.startPosition
                    });
                }
            } else if (tag.words && Array.isArray(tag.words) && tag.words.length > 0) {
                const words = tag.words.map(w => String(w || '').toLowerCase().trim()).filter(Boolean);
                for (let startPos = 0; startPos < words.length; startPos++) {
                    for (let length = 1; length <= words.length - startPos; length++) {
                        const sequence = words.slice(startPos, startPos + length).join(' ');
                        wordSequencesToInsert.push({
                            tagId,
                            sequence,
                            sequenceLength: length,
                            startPosition: startPos
                        });
                    }
                }
            }
            
            // Collect z_categories
            if (tag.z_category && Array.isArray(tag.z_category)) {
                for (const zCat of tag.z_category) {
                    const zCatName = typeof zCat === 'string' ? zCat : zCat.name;
                    const zCatId = zCategoryMap.get(zCatName);
                    if (zCatId) {
                        zCategoriesToInsert.push({ tagId, zCategoryId: zCatId });
                    }
                }
            }
            
            // Collect d_groups
            if (tag.d_group && Array.isArray(tag.d_group)) {
                for (const dGroupPath of tag.d_group) {
                    const groupId = dGroupPathMap.get(dGroupPath);
                    if (groupId) {
                        dGroupsToInsert.push({ tagId, groupId });
                    }
                }
            }
        }
        
        console.log(`   ✓ Collected ${tagsToInsert.length} tags, ${tagWikisToInsert.length} tag-wiki links, ${otherNamesToInsert.length} other names, ${wordsToInsert.length} words, ${wordSequencesToInsert.length} word sequences, ${zCategoriesToInsert.length} z-categories, ${dGroupsToInsert.length} d-groups`);
        
        // Step 2: Insert all tags first (no references needed)
        console.log('   Inserting tags in a single transaction...');
        let insertedCount = 0;
        let mergedCount = 0;
        
        // Count duplicates that were handled during collection
        const totalProcessed = processedCount;
        const totalUnique = tagsToInsert.length;
        mergedCount = totalProcessed - totalUnique;
        
        if (mergedCount > 0) {
            console.log(`   ℹ️  Found ${mergedCount} duplicate normalized titles in source data (reused IDs, skipped insertion)`);
        }
        
        // Update insertTag to use explicit ID
        const insertTagWithId = db.prepare(`
            INSERT INTO tags (id, title, normalized_title, category, d_count, e_count, n_count, n_rand, is_locked, untrained, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        
        const insertTagsTransaction = db.transaction((tags) => {
            for (const tagData of tags) {
                try {
                    insertTagWithId.run(
                        tagData.id,
                        tagData.title,
                        tagData.normalizedTitle,
                        tagData.category,
                        tagData.dCount,
                        tagData.eCount,
                        tagData.nCount,
                        tagData.nRand,
                        tagData.isLocked,
                        tagData.untrained,
                        tagData.createdAt
                    );
                    insertedCount++;
                } catch (e) {
                    // Should not happen since we deduplicated during merge
                    console.warn(`   ⚠️  Failed to insert tag: ${tagData.title} (error: ${e.message})`);
                    mergedCount++;
                }
            }
        });
        insertTagsTransaction(tagsToInsert);
        console.log(`   ✓ Inserted ${insertedCount} tags (${mergedCount} skipped as duplicates)`);
        
        // Step 3: Link tags to wikis (after tags are created)
        if (tagWikisToInsert.length > 0) {
            console.log(`   Linking ${tagWikisToInsert.length} tags to wikis in a single transaction...`);
            const insertTagWikisTransaction = db.transaction((tagWikis) => {
                for (const tagWiki of tagWikis) {
                    try {
                        insertTagWiki.run(tagWiki.tagId, tagWiki.wikiId);
                    } catch (e) {
                        console.error(`   ⚠️  Failed to link tag to wiki: ${tagWiki.tagId} -> ${tagWiki.wikiId} (error: ${e.message})`);
                        // Ignore duplicates (UNIQUE constraint on tag_id, wiki_id)
                    }
                }
            });
            insertTagWikisTransaction(tagWikisToInsert);
            console.log(`   ✓ Linked ${tagWikisToInsert.length} tags to wikis`);
        }
        
        // Merged tags are already handled during collection phase
        // No need to report separately as they were merged into single tag objects
        
        // Step 4: Insert other_names in a single transaction (using pre-generated tag IDs)
        if (otherNamesToInsert.length > 0) {
            console.log('   Inserting other names in a single transaction...');
            const insertOtherNamesTransaction = db.transaction((otherNames) => {
                for (const item of otherNames) {
                    try {
                        insertOtherName.run(item.tagId, item.name);
                    } catch (e) {
                        // Ignore duplicates
                    }
                }
            });
            insertOtherNamesTransaction(otherNamesToInsert);
        }
        
        // Step 5: Insert words in a single transaction (using pre-generated tag IDs)
        if (wordsToInsert.length > 0) {
            console.log('   Inserting words in a single transaction...');
            const insertWordsTransaction = db.transaction((words) => {
                for (const item of words) {
                    try {
                        insertWord.run(item.tagId, item.word);
                    } catch (e) {
                        // Ignore duplicates
                    }
                }
            });
            insertWordsTransaction(wordsToInsert);
        }
        
        // Step 5b: Insert word sequences in a single transaction (for predictive matching)
        if (wordSequencesToInsert.length > 0) {
            console.log(`   Inserting ${wordSequencesToInsert.length} word sequences in a single transaction...`);
            const insertWordSequence = db.prepare(`
                INSERT INTO tag_word_sequences (tag_id, sequence, sequence_length, start_position) 
                VALUES (?, ?, ?, ?)
            `);
            const insertWordSequencesTransaction = db.transaction((sequences) => {
                for (const item of sequences) {
                    try {
                        insertWordSequence.run(item.tagId, item.sequence, item.sequenceLength, item.startPosition);
                    } catch (e) {
                        // Ignore duplicates
                    }
                }
            });
            insertWordSequencesTransaction(wordSequencesToInsert);
            console.log(`   ✓ Inserted word sequences for predictive matching`);
        }
        
        // Step 6: Insert z-categories in a single transaction (using pre-generated tag IDs)
        if (zCategoriesToInsert.length > 0) {
            console.log('   Inserting z-categories in a single transaction...');
            const insertZCategoriesTransaction = db.transaction((zCats) => {
                for (const item of zCats) {
                    try {
                        insertZCategory.run(item.tagId, item.zCategoryId);
                    } catch (e) {
                        // Ignore duplicates
                    }
                }
            });
            insertZCategoriesTransaction(zCategoriesToInsert);
        }
        
        // Step 7: Insert d-groups in a single transaction (using pre-generated tag IDs)
        if (dGroupsToInsert.length > 0) {
            console.log('   Inserting d-groups in a single transaction...');
            const insertDGroupsTransaction = db.transaction((dGroups) => {
                for (const item of dGroups) {
                    if (item.groupId) {
                        try {
                            insertDGroup.run(item.tagId, item.groupId);
                        } catch (e) {
                            // Ignore duplicates
                        }
                    }
                }
            });
            insertDGroupsTransaction(dGroupsToInsert);
        }
        
        console.log(`   ✓ Processed ${processedCount} tags (${insertedCount} inserted, ${mergedCount} merged)`);
        
        // Populate dataset group members now that we have tagIdMap
        if (datasetGroups && dGroupPathMap.size > 0) {
            populateDatasetGroupMembers(db, datasetGroups, tagIdMap, dGroupPathMap);
        }
        
        // Process tag links (after all tags are inserted) - collect all first, then single transaction
        console.log('\n🔗 Processing tag links...');
        const allTagLinks = []; // Tag-to-tag links
        const allTagWikiLinks = []; // Tag-to-wiki links
        const allWikiLinks = []; // Wiki-to-wiki links
        const uniqueTagLinkKeys = new Set();
        const uniqueTagWikiLinkKeys = new Set();
        const uniqueWikiLinkKeys = new Set();
        const processedTagTitles = new Set();

        // Helper to add tag-to-tag link
        const addTagToTagLink = (fromTagId, toTagId) => {
            if (!fromTagId || !toTagId || fromTagId === toTagId) return false;
            
            const key = `${fromTagId}->${toTagId}`;
            if (uniqueTagLinkKeys.has(key)) {
                return false;
            }
            uniqueTagLinkKeys.add(key);
            allTagLinks.push({ fromTagId, toTagId });
            return true;
        };
        
        // Helper to add tag-to-wiki link (soft link - tag appears in wiki)
        const addTagToWikiLink = (tagId, wikiId, relationship) => {
            if (!tagId || !wikiId) return false;
            
            const key = `${tagId}->${wikiId}:${relationship}`;
            if (uniqueTagWikiLinkKeys.has(key)) {
                return false;
            }
            uniqueTagWikiLinkKeys.add(key);
            allTagWikiLinks.push({ tagId, wikiId, relationship });
            return true;
        };

        // Helper to add wiki-to-wiki link
        const addWikiToWikiLink = (fromWikiId, toWikiId) => {
            if (!fromWikiId || !toWikiId || fromWikiId === toWikiId) return false;
            
            const key = `${fromWikiId}->${toWikiId}`;
            if (uniqueWikiLinkKeys.has(key)) {
                return false;
            }
            uniqueWikiLinkKeys.add(key);
            allWikiLinks.push({ fromWikiId, toWikiId });
            return true;
        };

        const addBidirectionalLink = (tagId1, tagId2) => {
            if (tagId1 === tagId2) return;
            addTagToTagLink(tagId1, tagId2);
            addTagToTagLink(tagId2, tagId1);  // Bidirectional means both directions
        };

        const resolveLinkTargetId = (rawTitle, currentNormalizedTitle, currentTitleLower) => {
            if (!rawTitle) return null;
            let cleanLinkTitle = rawTitle.replace(/_/g, ' ').trim();
            if (!cleanLinkTitle) return null;
            const lower = cleanLinkTitle.toLowerCase();
            if (lower.startsWith('tag group:') || lower.startsWith('tag_group:') ||
                lower.startsWith('help:') || lower.startsWith('e621:')) {
                return null;
            }
            if (lower === currentTitleLower) {
                return null;
            }
            const normalizedLinkTitle = normalizeTitle(cleanLinkTitle);
            if (!normalizedLinkTitle || normalizedLinkTitle === currentNormalizedTitle) {
                return null;
            }
            const toTagId = titleToIdMap.get(lower) || tagIdMap.get(normalizedLinkTitle);
            return toTagId || null;
        };

        const addLinkByTitle = (rawTitle, fromTagId, currentNormalizedTitle, currentTitleLower, options = {}) => {
            const { bidirectional = false, reverse = false } = options;
            const toTagId = resolveLinkTargetId(rawTitle, currentNormalizedTitle, currentTitleLower);
            if (!toTagId) return;
            if (bidirectional) {
                addBidirectionalLink(fromTagId, toTagId);
            } else if (reverse) {
                // is_linked_by means "other tag links to this tag", so create link: other -> this
                addTagToTagLink(toTagId, fromTagId);
            } else {
                // is_linking_to means "this tag links to other tag", so create link: this -> other
                addTagToTagLink(fromTagId, toTagId);
            }
        };

        const addBodyLinks = (bodyText, fromTagId, currentNormalizedTitle, currentTitleLower, wikiId) => {
            if (!bodyText) return;
            const wikiLinks = extractWikiLinks(bodyText);
            wikiLinks.forEach(link => {
                const linkTitle = link.title;
                const linkPosition = link.position;
                const cleanLinkTitle = linkTitle.replace(/_/g, ' ').trim();
                const lower = cleanLinkTitle.toLowerCase();
                const normalizedLinkTitle = normalizeTitle(cleanLinkTitle);
                
                // Check if link is a tag
                const mentionedTagId = titleToIdMap.get(lower) || tagIdMap.get(normalizedLinkTitle);
                
                if (mentionedTagId) {
                    // It's a tag - create tag-to-tag link (bidirectional)
                addLinkByTitle(linkTitle, fromTagId, currentNormalizedTitle, currentTitleLower, { bidirectional: true });
                    
                    // Detect relationship type and create soft link
                    if (wikiId && mentionedTagId !== fromTagId) {
                        const relationship = detectLinkRelationship(bodyText, linkTitle, linkPosition);
                        addTagToWikiLink(mentionedTagId, wikiId, relationship);
                    }
                } else if (wikiId && !lower.startsWith('tag group:') && !lower.startsWith('tag_group:') &&
                          !lower.startsWith('help:') && !lower.startsWith('e621:') &&
                          lower !== currentTitleLower) {
                    // It's not a tag - check if it's a wiki
                    // Try to find the linked wiki by title (check all sources)
                    for (let source = SOURCE_DANBOORU; source <= SOURCE_E621; source++) {
                        const linkedWikiKey = `${cleanLinkTitle}|${source}`;
                        const linkedWikiId = wikiIdMap.get(linkedWikiKey);
                        if (linkedWikiId && linkedWikiId !== wikiId) {
                            // Create wiki-to-wiki link
                            addWikiToWikiLink(wikiId, linkedWikiId);
                            break; // Found it, no need to check other sources
                        }
                    }
                }
            });
        };
        
        // Process tag links from merged tags
        for (const [normalizedTitle, tag] of Object.entries(mergedTags)) {
            const fromTagId = tagIdMap.get(normalizedTitle);
            if (!fromTagId) continue;
            processedTagTitles.add(normalizedTitle);
            const currentTitleLower = tag.title.toLowerCase();
            
            // Process is_linking_to (deduplicate first)
            if (tag.is_linking_to && Array.isArray(tag.is_linking_to)) {
                // Normalize and deduplicate link titles
                const normalizedLinks = tag.is_linking_to.map(link => link.replace(/_/g, ' ').trim().toLowerCase());
                const uniqueLinks = [...new Set(normalizedLinks)];
                for (const linkTitle of uniqueLinks) {
                    addLinkByTitle(linkTitle, fromTagId, normalizedTitle, currentTitleLower);
                }
            }
            
            // Process is_linked_by (deduplicate first)
            if (tag.is_linked_by && Array.isArray(tag.is_linked_by)) {
                // Normalize and deduplicate link titles
                const normalizedLinks = tag.is_linked_by.map(link => link.replace(/_/g, ' ').trim().toLowerCase());
                const uniqueLinks = [...new Set(normalizedLinks)];
                for (const linkTitle of uniqueLinks) {
                    addLinkByTitle(linkTitle, fromTagId, normalizedTitle, currentTitleLower, { reverse: true });
                }
            }

            // Parse wiki body (already merged, contains both danbooru and e621 content)
            // Use normalized body from stored wiki to ensure consistency with section offsets
            if (tag.body && typeof tag.body === 'string') {
                // Get wiki_id for this tag's wiki to create soft links
                const wikiKey = `${tag.title}|${tag.source}`;
                const wikiId = wikiIdMap.get(wikiKey);
                
                // Get normalized body from stored wiki (same one used for section extraction)
                const storedWiki = allWikisMap.get(wikiKey);
                const normalizedBody = storedWiki ? storedWiki.body : normalizeWikiBody(tag.body, tag.title, tag.source).body;
                
                addBodyLinks(normalizedBody, fromTagId, normalizedTitle, currentTitleLower, wikiId);
            }
        }
        
        // Process all tag links in a single transaction
        if (allTagLinks.length > 0) {
            console.log(`   Processing ${allTagLinks.length} tag-to-tag links in a single transaction...`);
            const tagLinkTransaction = db.transaction((links) => {
            for (const link of links) {
                try {
                        insertTagLink.run(link.fromTagId, link.toTagId);
                } catch (e) {
                    // Ignore duplicates
                }
            }
        });
            tagLinkTransaction(allTagLinks);
            console.log(`   ✓ Processed ${allTagLinks.length} tag-to-tag links`);
        }
        
        // Process all tag-wiki links in a single transaction
        if (allTagWikiLinks.length > 0) {
            console.log(`   Processing ${allTagWikiLinks.length} tag-to-wiki links in a single transaction...`);
            const tagWikiLinkTransaction = db.transaction((links) => {
                for (const link of links) {
                    try {
                        insertTagWikiLink.run(link.tagId, link.wikiId, link.relationship);
                    } catch (e) {
                        // Ignore duplicates
                    }
                }
            });
            tagWikiLinkTransaction(allTagWikiLinks);
            console.log(`   ✓ Processed ${allTagWikiLinks.length} tag-to-wiki links`);
        }
        
        // Process all wiki links in a single transaction
        if (allWikiLinks.length > 0) {
            console.log(`   Processing ${allWikiLinks.length} wiki-to-wiki links in a single transaction...`);
            const wikiLinkTransaction = db.transaction((links) => {
                for (const link of links) {
                    try {
                        insertWikiLink.run(link.fromWikiId, link.toWikiId);
                    } catch (e) {
                        // Ignore duplicates
                    }
                }
            });
            wikiLinkTransaction(allWikiLinks);
            console.log(`   ✓ Processed ${allWikiLinks.length} wiki-to-wiki links`);
        }
        
        // Insert unlinked wikis as wiki pages (includes tag groups and other unlinked pages)
        const wikiPageIdMap = new Map(); // title -> page_id (for linking)
        const wikiPageDataMap = new Map(); // title -> { body, is_linking_to, is_linked_by } (for link processing)
        
        if (unlinkedWikiKeys.size > 0) {
            console.log(`\n📄 Processing ${unlinkedWikiKeys.size} unlinked wiki pages...`);
            
            // Group unlinked wikis by title to merge danbooru and e621 sources BEFORE insertion
            const unlinkedWikisByTitle = new Map(); // title -> merged wiki page data
            
            // Process all unlinked wiki keys - iterate over keys to ensure we don't miss any
            for (const wikiKey of unlinkedWikiKeys) {
                // Get wiki from allWikisMap
                const wiki = allWikisMap.get(wikiKey);
                if (!wiki) {
                    // Wiki not in allWikisMap - this shouldn't happen, but try to find it in database
                    const [title, sourceStr] = wikiKey.split('|');
                    const source = parseInt(sourceStr);
                    const dbResult = getWikiId.get(title, source);
                    if (dbResult) {
                        // Found in database, add to wikiIdMap and continue processing
                        wikiIdMap.set(wikiKey, dbResult.id);
                        // Try to reconstruct wiki data from database (we'll skip body links for these)
                        const reconstructedWiki = {
                            title: title,
                            source: source,
                        created_at: null,
                        updated_at: null,
                            is_linking_to: [],
                            is_linked_by: []
                        };
                        // Process this wiki (it will have empty body/links, but at least the page will be created)
                        const entry = unlinkedWikisByTitle.get(title) || {
                            title: title,
                            danbooruWikiId: null,
                            e621WikiId: null,
                            danbooruCreatedAt: null,
                            e621CreatedAt: null,
                            danbooruUpdatedAt: null,
                            e621UpdatedAt: null,
                            danbooruUntrained: 0,
                            e621Untrained: 0,
                            danbooruBody: null,
                            e621Body: null,
                            is_linking_to: [],
                            is_linked_by: []
                        };
                        if (source === SOURCE_DANBOORU) {
                            entry.danbooruWikiId = dbResult.id;
                        } else if (source === SOURCE_E621) {
                            entry.e621WikiId = dbResult.id;
                        }
                        unlinkedWikisByTitle.set(title, entry);
                    } else {
                        console.warn(`   ⚠️  Wiki not found in allWikisMap or database: "${title}" (source: ${source}, key: "${wikiKey}")`);
                    }
                    continue;
                }
                
                // Get wiki ID from wikiIdMap (using the same key format)
                let wikiId = wikiIdMap.get(wikiKey);
                
                // Fallback: if not in wikiIdMap, query database directly
                if (!wikiId) {
                    const dbResult = getWikiId.get(wiki.title, wiki.source);
                    if (dbResult) {
                        wikiId = dbResult.id;
                        wikiIdMap.set(wikiKey, wikiId);
                    } else {
                        // This should not happen - wiki should have been inserted
                        console.warn(`   ⚠️  Wiki not found in wikiIdMap or database: "${wiki.title}" (source: ${wiki.source}, key: "${wikiKey}")`);
                        continue;
                    }
                }
                
                // Group by title to merge both sources
                if (!unlinkedWikisByTitle.has(wiki.title)) {
                    unlinkedWikisByTitle.set(wiki.title, {
                        title: wiki.title,
                        danbooruWikiId: null,
                        e621WikiId: null,
                        danbooruCreatedAt: null,
                        e621CreatedAt: null,
                        danbooruUpdatedAt: null,
                        e621UpdatedAt: null,
                        danbooruUntrained: 0,
                        e621Untrained: 0,
                        danbooruBody: null,
                        e621Body: null,
                        is_linking_to: [],
                        is_linked_by: []
                    });
                }
                
                const entry = unlinkedWikisByTitle.get(wiki.title);
                if (wiki.source === SOURCE_DANBOORU) {
                    entry.danbooruWikiId = wikiId;
                    entry.danbooruCreatedAt = wiki.created_at;
                    entry.danbooruUpdatedAt = wiki.updated_at;
                    entry.danbooruUntrained = isUntrainedDate(wiki.created_at) ? 1 : 0;
                    entry.danbooruBody = wiki.body;
                    // Normalize and add links (replace underscores with spaces, lowercase)
                    if (wiki.is_linking_to && Array.isArray(wiki.is_linking_to)) {
                        const normalized = wiki.is_linking_to.map(link => link.replace(/_/g, ' ').trim().toLowerCase());
                        entry.is_linking_to.push(...normalized);
                    }
                    if (wiki.is_linked_by && Array.isArray(wiki.is_linked_by)) {
                        const normalized = wiki.is_linked_by.map(link => link.replace(/_/g, ' ').trim().toLowerCase());
                        entry.is_linked_by.push(...normalized);
                    }
                } else if (wiki.source === SOURCE_E621) {
                    entry.e621WikiId = wikiId;
                    entry.e621CreatedAt = wiki.created_at;
                    entry.e621UpdatedAt = wiki.updated_at;
                    entry.e621Untrained = isUntrainedDate(wiki.created_at) ? 1 : 0;
                    entry.e621Body = wiki.body;
                    // Normalize and add links (replace underscores with spaces, lowercase)
                    if (wiki.is_linking_to && Array.isArray(wiki.is_linking_to)) {
                        const normalized = wiki.is_linking_to.map(link => link.replace(/_/g, ' ').trim().toLowerCase());
                        entry.is_linking_to.push(...normalized);
                    }
                    if (wiki.is_linked_by && Array.isArray(wiki.is_linked_by)) {
                        const normalized = wiki.is_linked_by.map(link => link.replace(/_/g, ' ').trim().toLowerCase());
                        entry.is_linked_by.push(...normalized);
                    }
                }
            }
            
            // Merge data for each title (earliest created_at, latest updated_at, merge arrays)
            const mergedWikiPages = [];
            for (const [title, entry] of unlinkedWikisByTitle.entries()) {
                // Use the earliest created_at and latest updated_at
                const createdAt = entry.danbooruCreatedAt && entry.e621CreatedAt
                    ? (entry.danbooruCreatedAt < entry.e621CreatedAt ? entry.danbooruCreatedAt : entry.e621CreatedAt)
                    : (entry.danbooruCreatedAt || entry.e621CreatedAt);
                const updatedAt = entry.danbooruUpdatedAt && entry.e621UpdatedAt
                    ? (entry.danbooruUpdatedAt > entry.e621UpdatedAt ? entry.danbooruUpdatedAt : entry.e621UpdatedAt)
                    : (entry.danbooruUpdatedAt || entry.e621UpdatedAt);
                
                // Mark as untrained if either source is untrained
                const untrained = (entry.danbooruUntrained === 1 || entry.e621Untrained === 1) ? 1 : 0;
                
                // Prefer e621 body if both exist, otherwise use available one
                const body = entry.e621Body || entry.danbooruBody;
                
                // Normalize and deduplicate arrays (normalize underscores to spaces and lowercase)
                const normalizedLinkingTo = entry.is_linking_to.map(link => link.replace(/_/g, ' ').trim().toLowerCase());
                const normalizedLinkedBy = entry.is_linked_by.map(link => link.replace(/_/g, ' ').trim().toLowerCase());
                const is_linking_to = [...new Set(normalizedLinkingTo)];
                const is_linked_by = [...new Set(normalizedLinkedBy)];
                
                mergedWikiPages.push({
                    title: entry.title,
                    danbooruWikiId: entry.danbooruWikiId,
                    e621WikiId: entry.e621WikiId,
                    createdAt,
                    updatedAt,
                    untrained,
                    body,
                    is_linking_to,
                    is_linked_by
                });
            }
            
            // Insert all merged wiki pages in a single transaction
            console.log(`   Inserting ${mergedWikiPages.length} merged unlinked wiki pages...`);
            const insertWikiPage = db.prepare(`
                INSERT INTO wiki_pages (title, danbooru_wiki_id, e621_wiki_id, category, created_at, updated_at, untrained)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `);
            
            const insertUnlinkedWikisTransaction = db.transaction((pages) => {
                for (const page of pages) {
                    try {
                        const result = insertWikiPage.run(
                            page.title,
                            page.danbooruWikiId,
                            page.e621WikiId,
                            null, // category (unlinked wikis don't have categories)
                            page.createdAt,
                            page.updatedAt,
                            page.untrained
                        );
                        const pageId = result.lastInsertRowid;
                        wikiPageIdMap.set(page.title.toLowerCase(), pageId);
                        
                        // Store wiki data for link processing (include wiki IDs)
                        wikiPageDataMap.set(page.title.toLowerCase(), {
                            title: page.title,
                            body: page.body,
                            is_linking_to: page.is_linking_to,
                            is_linked_by: page.is_linked_by,
                            danbooruWikiId: page.danbooruWikiId,
                            e621WikiId: page.e621WikiId
                        });
                    } catch (e) {
                        console.warn(`   ⚠️  Failed to insert wiki page: ${page.title} (error: ${e.message})`);
                    }
                }
            });
            
            insertUnlinkedWikisTransaction(mergedWikiPages);
            console.log(`   ✓ Inserted ${wikiPageIdMap.size} unlinked wiki pages`);
            
            // Now process links from wiki page bodies and is_linking_to/is_linked_by
            const wikiPageLinksToInsert = []; // { pageId, linkedTagId, linkedPageId }
            const uniqueLinkKeys = new Set(); // For deduplication
            
            for (const [titleLower, pageId] of wikiPageIdMap.entries()) {
                const wikiData = wikiPageDataMap.get(titleLower);
                if (!wikiData) continue;
                
                // Get wiki IDs for this page (danbooru and/or e621)
                // These are stored in wikiPageDataMap
                const wikiIds = [];
                if (wikiData.danbooruWikiId) wikiIds.push(wikiData.danbooruWikiId);
                if (wikiData.e621WikiId) wikiIds.push(wikiData.e621WikiId);
                
                // Parse wiki body for links
                const wikiLinks = extractWikiLinks(wikiData.body);
                for (const link of wikiLinks) {
                    const linkTitle = link.title;
                    const linkPosition = link.position;
                    const normalizedLinkTitle = normalizeTitle(linkTitle);
                    const linkedTagId = tagIdMap.get(normalizedLinkTitle);
                    
                    if (linkedTagId) {
                        // Link found in body points to a tag
                        const key = `${pageId}|tag|${linkedTagId}`;
                        if (!uniqueLinkKeys.has(key)) {
                            uniqueLinkKeys.add(key);
                            wikiPageLinksToInsert.push({
                                pageId: pageId,
                                linkedTagId: linkedTagId,
                                linkedPageId: null
                            });
                        }
                        
                        // IMPORTANT: Also create tag_wiki_links entries for tags that appear in untagged wikis
                        // This ensures they're indexed and can be found by fetchTagWikiMentions
                        for (const wikiId of wikiIds) {
                            if (wikiId) {
                                const relationship = detectLinkRelationship(wikiData.body, linkTitle, linkPosition);
                                addTagToWikiLink(linkedTagId, wikiId, relationship);
                            }
                        }
                    } else {
                        // Check if it points to another wiki page
                        const linkedPageId = wikiPageIdMap.get(linkTitle.toLowerCase());
                        if (linkedPageId && linkedPageId !== pageId) {
                            const key = `${pageId}|page|${linkedPageId}`;
                            if (!uniqueLinkKeys.has(key)) {
                                uniqueLinkKeys.add(key);
                                wikiPageLinksToInsert.push({
                                    pageId: pageId,
                                    linkedTagId: null,
                                    linkedPageId: linkedPageId
                                });
                            }
                        }
                    }
                }
                
                // Process is_linking_to (deduplicate first)
                if (wikiData.is_linking_to && Array.isArray(wikiData.is_linking_to)) {
                    // Already normalized and deduplicated during merge, but ensure uniqueness
                    const uniqueLinks = [...new Set(wikiData.is_linking_to)];
                    for (const linkTitle of uniqueLinks) {
                        const cleanLinkTitle = linkTitle.replace(/_/g, ' ').trim();
                        const normalizedLinkTitle = normalizeTitle(cleanLinkTitle);
                        const linkedTagId = tagIdMap.get(normalizedLinkTitle);
                        
                        if (linkedTagId) {
                            const key = `${pageId}|tag|${linkedTagId}`;
                            if (!uniqueLinkKeys.has(key)) {
                                uniqueLinkKeys.add(key);
                                wikiPageLinksToInsert.push({
                                    pageId: pageId,
                                    linkedTagId: linkedTagId,
                                    linkedPageId: null
                                });
                            }
                            
                            // IMPORTANT: Also create tag_wiki_links entries for tags in is_linking_to
                            // Use relationship 0 (appears) for is_linking_to entries
                            for (const wikiId of wikiIds) {
                                if (wikiId) {
                                    addTagToWikiLink(linkedTagId, wikiId, RELATIONSHIP_APPEARS);
                                }
                            }
                        } else {
                            const linkedPageId = wikiPageIdMap.get(cleanLinkTitle.toLowerCase());
                            if (linkedPageId && linkedPageId !== pageId) {
                                const key = `${pageId}|page|${linkedPageId}`;
                                if (!uniqueLinkKeys.has(key)) {
                                    uniqueLinkKeys.add(key);
                                    wikiPageLinksToInsert.push({
                                        pageId: pageId,
                                        linkedTagId: null,
                                        linkedPageId: linkedPageId
                                    });
                                }
                            }
                        }
                    }
                }
                
                // Process is_linked_by (deduplicate first)
                if (wikiData.is_linked_by && Array.isArray(wikiData.is_linked_by)) {
                    // Already normalized and deduplicated during merge, but ensure uniqueness
                    const uniqueLinks = [...new Set(wikiData.is_linked_by)];
                    for (const linkTitle of uniqueLinks) {
                        const cleanLinkTitle = linkTitle.replace(/_/g, ' ').trim();
                        const normalizedLinkTitle = normalizeTitle(cleanLinkTitle);
                        const linkedTagId = tagIdMap.get(normalizedLinkTitle);
                        
                        if (linkedTagId) {
                            // is_linked_by means "other tag links to this page"
                            // Since wiki_page_links stores links FROM pages, we can't directly store "tag links to page"
                            // Instead, we'll create a link from the page to the tag (reverse relationship)
                            // Note: This is a limitation - we'd need tag_page_links table to properly store "tag links to page"
                            // For now, we'll skip is_linked_by for wiki pages as it requires a different structure
                            // The relationship can be derived by querying: "which tags link to this page?" = query tag_links where to_tag_id matches page title
                        } else {
                            const linkedPageId = wikiPageIdMap.get(cleanLinkTitle.toLowerCase());
                            if (linkedPageId && linkedPageId !== pageId) {
                                // is_linked_by means "other page links to this page", so create link: other -> this
                                const key = `${linkedPageId}|page|${pageId}`;
                                if (!uniqueLinkKeys.has(key)) {
                                    uniqueLinkKeys.add(key);
                                    wikiPageLinksToInsert.push({
                                        pageId: linkedPageId,
                                        linkedTagId: null,
                                        linkedPageId: pageId
                                    });
                                }
                            }
                        }
                    }
                }
            }
            
            // Insert wiki page links in a single transaction
            if (wikiPageLinksToInsert.length > 0) {
                console.log(`   Processing ${wikiPageLinksToInsert.length} wiki page links from body parsing...`);
                const insertWikiPageLink = db.prepare(`
                    INSERT INTO wiki_page_links (page_id, linked_tag_id, linked_page_id)
                    VALUES (?, ?, ?)
                `);
                
                const insertWikiPageLinksTransaction = db.transaction((links) => {
                    for (const link of links) {
                        try {
                            insertWikiPageLink.run(
                                link.pageId,
                                link.linkedTagId,
                                link.linkedPageId
                            );
                            } catch (e) {
                            // Ignore duplicates
                            }
                        }
                    });
                
                insertWikiPageLinksTransaction(wikiPageLinksToInsert);
                console.log(`   ✓ Processed ${wikiPageLinksToInsert.length} wiki page links`);
            }
        }
        
        // Create lightweight indexes first (fast, can be done during insertion)
        createLightweightIndexes(db);
        
        // Create heavy indexes after all data is inserted (FTS5, function-based, composite)
        createHeavyIndexes(db);
        
        // Create views for unified access
        createViews(db);
        
        // Analyze tables for query optimization
        console.log('\n📊 Analyzing tables...');
        db.exec('ANALYZE');
        console.log('   ✓ Analysis complete');

        console.log('\n📥 Filling missing n_count from NovelAI tag search cache...');
        initializeTagSearchDatabase(path.join(__dirname, '..', '.cache'));
        const novelFill = applyCachedNovelCounts(db);
        console.log(`   ✓ Filled ${novelFill.filled} missing n_count values (${novelFill.candidates} cache tags)`);
        
        // Get final statistics from database
        console.log('\n📊 Calculating final statistics...');
        const getTotalTags = db.prepare('SELECT COUNT(*) as count FROM tags').get();
        const getDanbooruTags = db.prepare('SELECT COUNT(*) as count FROM tags WHERE d_count > 0 OR id IN (SELECT tag_id FROM tag_wikis WHERE wiki_id IN (SELECT id FROM wikis WHERE source = ?))').get(SOURCE_DANBOORU);
        const getDanbooruWikis = db.prepare('SELECT COUNT(*) as count FROM wikis WHERE source = ?').get(SOURCE_DANBOORU);
        const getFurryTags = db.prepare('SELECT COUNT(*) as count FROM tags WHERE e_count > 0 OR id IN (SELECT tag_id FROM tag_wikis WHERE wiki_id IN (SELECT id FROM wikis WHERE source = ?))').get(SOURCE_E621);
        const getFurryWikis = db.prepare('SELECT COUNT(*) as count FROM wikis WHERE source = ?').get(SOURCE_E621);
        const getNovelaiTags = db.prepare('SELECT COUNT(*) as count FROM tags WHERE n_count IS NOT NULL').get();
        const getMergedTags = db.prepare('SELECT COUNT(*) as count FROM tags WHERE (d_count > 0 OR id IN (SELECT tag_id FROM tag_wikis WHERE wiki_id IN (SELECT id FROM wikis WHERE source = ?))) AND (e_count > 0 OR id IN (SELECT tag_id FROM tag_wikis WHERE wiki_id IN (SELECT id FROM wikis WHERE source = ?)))').get(SOURCE_DANBOORU, SOURCE_E621);
        const getZCategories = db.prepare('SELECT COUNT(*) as count FROM z_categories').get();
        const getWikiPages = db.prepare('SELECT COUNT(*) as count FROM wiki_pages').get();
        
        const totalTagsCount = getTotalTags.count;
        const danbooruTagsCount = getDanbooruTags.count;
        const danbooruWikisCount = getDanbooruWikis.count;
        const furryTagsCount = getFurryTags.count;
        const furryWikisCount = getFurryWikis.count;
        const novelaiTagsCount = getNovelaiTags.count;
        const mergedTagsCount = getMergedTags.count;
        const zCategoriesCount = getZCategories.count;
        const wikiPagesCount = getWikiPages.count;
        
        // Export post/thumb references to JSON for later download
        if (allPostThumbRefs && allPostThumbRefs.length > 0) {
            console.log('\n💾 Exporting post/thumb references to JSON...');
            const postThumbRefsPath = path.join(__dirname, '..', 'data', 'wiki_post_thumb_refs.json');
            const refsData = {
                _metadata: {
                    generated_at: new Date().toISOString(),
                    total_references: allPostThumbRefs.length,
                    sources: {
                        danbooru: allPostThumbRefs.filter(r => r.source === SOURCE_DANBOORU).length,
                        e621: allPostThumbRefs.filter(r => r.source === SOURCE_E621).length,
                        custom: allPostThumbRefs.filter(r => r.source === SOURCE_MEMORY).length
                    },
                    types: {
                        post: allPostThumbRefs.filter(r => r.type === 'post').length,
                        thumb: allPostThumbRefs.filter(r => r.type === 'thumb').length
                    }
                },
                references: allPostThumbRefs
            };
            
            // Ensure data directory exists
            const dataDir = path.dirname(postThumbRefsPath);
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }
            
            fs.writeFileSync(postThumbRefsPath, JSON.stringify(refsData, null, 2), 'utf8');
            console.log(`   ✓ Exported ${allPostThumbRefs.length} post/thumb references to ${path.basename(postThumbRefsPath)}`);
        }
        
        // Export tags missing wikis and referenced tags that need to be downloaded
        console.log('\n💾 Exporting tags missing wikis to JSON...');
        const missingWikisPath = path.join(__dirname, '..', 'data', 'tags_missing_wikis.json');
        
        // Get all tags that don't have wikis linked
        const tagsWithoutWikis = db.prepare(`
            SELECT DISTINCT t.id, t.title, t.d_count, t.e_count
            FROM tags t
            LEFT JOIN tag_wikis tw ON t.id = tw.tag_id
            WHERE tw.tag_id IS NULL
            ORDER BY t.title
        `).all();
        
        // Get all referenced tags from tag_links that don't have wikis
        const referencedTagsWithoutWikis = db.prepare(`
            SELECT DISTINCT t.id, t.title, t.d_count, t.e_count
            FROM tags t
            INNER JOIN (
                SELECT DISTINCT from_tag_id as tag_id FROM tag_links
                UNION
                SELECT DISTINCT to_tag_id as tag_id FROM tag_links
            ) refs ON t.id = refs.tag_id
            LEFT JOIN tag_wikis tw ON t.id = tw.tag_id
            WHERE tw.tag_id IS NULL
            ORDER BY t.title
        `).all();
        
        // Get all referenced tags from tag_wiki_links that don't have wikis (these are tags mentioned in wikis but don't have their own)
        const mentionedTagsWithoutWikis = db.prepare(`
            SELECT DISTINCT t.id, t.title, t.d_count, t.e_count
            FROM tags t
            INNER JOIN tag_wiki_links twl ON t.id = twl.tag_id
            LEFT JOIN tag_wikis tw ON t.id = tw.tag_id
            WHERE tw.tag_id IS NULL
            ORDER BY t.title
        `).all();
        
        // Combine all tags missing wikis (deduplicate by id)
        const allMissingWikiTags = new Map();
        for (const tag of [...tagsWithoutWikis, ...referencedTagsWithoutWikis, ...mentionedTagsWithoutWikis]) {
            if (!allMissingWikiTags.has(tag.id)) {
                allMissingWikiTags.set(tag.id, tag);
            }
        }
        
        // Get all referenced wiki pages that don't exist as wikis
        // These include:
        // 1. Wiki links (type='wiki' with link_id)
        // 2. Wiki references from URLs (type='wiki_reference' with search_query)
        const referencedWikiPages = db.prepare(`
            SELECT DISTINCT 
                COALESCE(wcl.link_id, wcl.search_query) as wiki_title,
                w.source
            FROM wiki_content_links wcl
            INNER JOIN wikis w ON wcl.wiki_id = w.id
            WHERE (
                (wcl.link_type = 'wiki' AND wcl.link_id IS NOT NULL)
                OR (wcl.link_type = 'wiki_reference' AND wcl.search_query IS NOT NULL)
            )
            AND NOT EXISTS (
                SELECT 1 FROM wikis w2 
                WHERE w2.title = COALESCE(wcl.link_id, wcl.search_query)
            )
        `).all();
        
        // Also get all referenced tags from URLs (tag_reference type)
        const referencedTagsFromUrls = db.prepare(`
            SELECT DISTINCT wcl.search_query as tag_name, w.source
            FROM wiki_content_links wcl
            INNER JOIN wikis w ON wcl.wiki_id = w.id
            WHERE wcl.link_type = 'tag_reference' 
            AND wcl.search_query IS NOT NULL
            AND NOT EXISTS (
                SELECT 1 FROM tags t 
                INNER JOIN tag_wikis tw ON t.id = tw.tag_id
                INNER JOIN wikis w2 ON tw.wiki_id = w2.id
                WHERE LOWER(t.title) = LOWER(wcl.search_query)
                AND w2.source = w.source
            )
        `).all();
        
        // Separate by source (danbooru vs e621)
        // Store tags and wiki pages with frequency/usage information for sorting
        // Tags: { title, usage, referenceCount }
        // Wiki pages: { title, referenceCount }
        const danbooruTags = []; // Array of { title, usage, referenceCount }
        const e621Tags = []; // Array of { title, usage, referenceCount }
        const danbooruWikiPages = new Map(); // title -> { title, referenceCount }
        const e621WikiPages = new Map(); // title -> { title, referenceCount }
        
        // Minimum usage threshold for tags
        const MIN_TAG_USAGE = 150;
        
        // Process tags missing wikis - check which source they need wikis for
        for (const tag of allMissingWikiTags.values()) {
            const tagId = tag.id;
            const isDanbooruTag = tag.d_count && tag.d_count > 0;
            const isE621Tag = tag.e_count && tag.e_count > 0;
            
            // Check if tag has danbooru wiki (regardless of whether it has e621 wiki)
            const hasDanbooruWiki = db.prepare(`
                SELECT COUNT(*) as count
                FROM tag_wikis tw
                INNER JOIN wikis w ON tw.wiki_id = w.id
                WHERE tw.tag_id = ? AND w.source = ?
            `).get(tagId, SOURCE_DANBOORU);
            
            // Check if tag has e621 wiki (regardless of whether it has danbooru wiki)
            const hasE621Wiki = db.prepare(`
                SELECT COUNT(*) as count
                FROM tag_wikis tw
                INNER JOIN wikis w ON tw.wiki_id = w.id
                WHERE tw.tag_id = ? AND w.source = ?
            `).get(tagId, SOURCE_E621);
            
            // Check if tag is referenced in danbooru wikis (reference frequency)
            const referencedInDanbooru = db.prepare(`
                SELECT COUNT(*) as count
                FROM tag_wiki_links twl
                INNER JOIN wikis w ON twl.wiki_id = w.id
                WHERE twl.tag_id = ? AND w.source = ?
            `).get(tagId, SOURCE_DANBOORU);
            
            // Check if tag is referenced in e621 wikis (reference frequency)
            const referencedInE621 = db.prepare(`
                SELECT COUNT(*) as count
                FROM tag_wiki_links twl
                INNER JOIN wikis w ON twl.wiki_id = w.id
                WHERE twl.tag_id = ? AND w.source = ?
            `).get(tagId, SOURCE_E621);
            
            // Add to danbooru list if:
            // - It's a danbooru tag (d_count > 0) but doesn't have a danbooru wiki, OR
            // - It's referenced in danbooru wikis but doesn't have a danbooru wiki
            // Only add if usage >= MIN_TAG_USAGE or has references
            if ((isDanbooruTag || (referencedInDanbooru && referencedInDanbooru.count > 0)) && 
                (!hasDanbooruWiki || hasDanbooruWiki.count === 0)) {
                // Filter: must have at least MIN_TAG_USAGE usage if it's a tag with usage
                const usage = tag.d_count || 0;
                const referenceCount = referencedInDanbooru ? referencedInDanbooru.count : 0;
                
                // Add if: has usage >= MIN_TAG_USAGE OR has references (referenced tags get priority even with low usage)
                // For tags that exist in the dataset (isDanbooruTag), require MIN_TAG_USAGE
                // For tags only referenced, allow if they have references
                if (isDanbooruTag) {
                    // Tag exists in dataset - must have >= MIN_TAG_USAGE
                    if (usage >= MIN_TAG_USAGE) {
                        danbooruTags.push({
                            title: tag.title,
                            usage: usage,
                            referenceCount: referenceCount
                        });
                    }
                } else {
                    // Tag only referenced - allow if it has references
                    if (referenceCount > 0) {
                        danbooruTags.push({
                            title: tag.title,
                            usage: usage,
                            referenceCount: referenceCount
                        });
                    }
                }
            }
            
            // Add to e621 list if:
            // - It's an e621 tag (e_count > 0) but doesn't have an e621 wiki, OR
            // - It's referenced in e621 wikis but doesn't have an e621 wiki
            // Only add if usage >= MIN_TAG_USAGE or has references
            if ((isE621Tag || (referencedInE621 && referencedInE621.count > 0)) && 
                (!hasE621Wiki || hasE621Wiki.count === 0)) {
                // Filter: must have at least MIN_TAG_USAGE usage if it's a tag with usage
                const usage = tag.e_count || 0;
                const referenceCount = referencedInE621 ? referencedInE621.count : 0;
                
                // Add if: has usage >= MIN_TAG_USAGE OR has references (referenced tags get priority even with low usage)
                // For tags that exist in the dataset (isE621Tag), require MIN_TAG_USAGE
                // For tags only referenced, allow if they have references
                if (isE621Tag) {
                    // Tag exists in dataset - must have >= MIN_TAG_USAGE
                    if (usage >= MIN_TAG_USAGE) {
                        e621Tags.push({
                            title: tag.title,
                            usage: usage,
                            referenceCount: referenceCount
                        });
                    }
                } else {
                    // Tag only referenced - allow if it has references
                    if (referenceCount > 0) {
                        e621Tags.push({
                            title: tag.title,
                            usage: usage,
                            referenceCount: referenceCount
                        });
                    }
                }
            }
        }
        
        // Get reference counts for wiki pages (how many times each wiki page is referenced)
        const wikiPageReferenceCounts = db.prepare(`
            SELECT 
                COALESCE(wcl.link_id, wcl.search_query) as wiki_title,
                w.source,
                COUNT(*) as reference_count
            FROM wiki_content_links wcl
            INNER JOIN wikis w ON wcl.wiki_id = w.id
            WHERE (
                (wcl.link_type = 'wiki' AND wcl.link_id IS NOT NULL)
                OR (wcl.link_type = 'wiki_reference' AND wcl.search_query IS NOT NULL)
            )
            GROUP BY COALESCE(wcl.link_id, wcl.search_query), w.source
        `).all();
        
        // Process referenced wiki pages with frequency counts
        for (const ref of referencedWikiPages) {
            const wikiTitle = ref.wiki_title;
            if (!wikiTitle) continue;
            
            const source = ref.source;
            
            // Get reference count for this wiki page
            const refCount = wikiPageReferenceCounts.find(r => 
                r.wiki_title === wikiTitle && r.source === source
            );
            const referenceCount = refCount ? refCount.reference_count : 1; // Default to 1 if not found
            
            if (source === SOURCE_DANBOORU) {
                if (!danbooruWikiPages.has(wikiTitle)) {
                    danbooruWikiPages.set(wikiTitle, {
                        title: wikiTitle,
                        referenceCount: referenceCount
                    });
                } else {
                    // Update reference count if higher
                    const existing = danbooruWikiPages.get(wikiTitle);
                    if (referenceCount > existing.referenceCount) {
                        existing.referenceCount = referenceCount;
                    }
                }
            } else if (source === SOURCE_E621) {
                if (!e621WikiPages.has(wikiTitle)) {
                    e621WikiPages.set(wikiTitle, {
                        title: wikiTitle,
                        referenceCount: referenceCount
                    });
                } else {
                    // Update reference count if higher
                    const existing = e621WikiPages.get(wikiTitle);
                    if (referenceCount > existing.referenceCount) {
                        existing.referenceCount = referenceCount;
                    }
                }
            }
        }
        
        // Process referenced tags from URLs (tag_reference type)
        for (const ref of referencedTagsFromUrls) {
            const tagName = ref.tag_name;
            if (!tagName) continue;
            
            const source = ref.source;
            const normalizedTagName = normalizeTitle(tagName);
            
            // Check if tag exists and has wiki for this source
            const tagExists = db.prepare(`
                SELECT t.id, t.title, t.d_count, t.e_count
                FROM tags t
                WHERE LOWER(t.title) = LOWER(?) OR LOWER(t.normalized_title) = LOWER(?)
            `).get(tagName, normalizedTagName);
            
            if (tagExists) {
                // Tag exists - check if it needs wiki for this source
                const tagId = tagExists.id;
                const hasWiki = db.prepare(`
                    SELECT COUNT(*) as count
                    FROM tag_wikis tw
                    INNER JOIN wikis w ON tw.wiki_id = w.id
                    WHERE tw.tag_id = ? AND w.source = ?
                `).get(tagId, source);
                
                if (!hasWiki || hasWiki.count === 0) {
                    // Tag exists but doesn't have wiki for this source
                    const usage = source === SOURCE_DANBOORU ? (tagExists.d_count || 0) : (tagExists.e_count || 0);
                    
                    // Get reference count
                    const referenceCount = db.prepare(`
                        SELECT COUNT(*) as count
                        FROM tag_wiki_links twl
                        INNER JOIN wikis w ON twl.wiki_id = w.id
                        WHERE twl.tag_id = ? AND w.source = ?
                    `).get(tagId, source);
                    
                    const refCount = referenceCount ? referenceCount.count : 0;
                    
                    // Filter: must have at least MIN_TAG_USAGE usage for tags that exist
                    if (usage >= MIN_TAG_USAGE) {
                        const tagData = {
                            title: tagExists.title,
                            usage: usage,
                            referenceCount: refCount
                        };
                        
                        if (source === SOURCE_DANBOORU) {
                            // Check if already added
                            const exists = danbooruTags.find(t => t.title === tagExists.title);
                            if (!exists) {
                                danbooruTags.push(tagData);
                            }
                        } else if (source === SOURCE_E621) {
                            const exists = e621Tags.find(t => t.title === tagExists.title);
                            if (!exists) {
                                e621Tags.push(tagData);
                            }
                        }
                    }
                }
            } else {
                // Tag doesn't exist - skip (can't filter by usage if tag doesn't exist)
                // We'll only include tags that exist in the database for proper filtering
            }
        }
        
        // Sort tags by usage + reference count (highest first)
        // Priority: usage count, then reference count
        danbooruTags.sort((a, b) => {
            const scoreA = (a.usage || 0) + (a.referenceCount || 0) * 10; // References weighted 10x
            const scoreB = (b.usage || 0) + (b.referenceCount || 0) * 10;
            if (scoreB !== scoreA) return scoreB - scoreA;
            return a.title.localeCompare(b.title);
        });
        
        e621Tags.sort((a, b) => {
            const scoreA = (a.usage || 0) + (a.referenceCount || 0) * 10; // References weighted 10x
            const scoreB = (b.usage || 0) + (b.referenceCount || 0) * 10;
            if (scoreB !== scoreA) return scoreB - scoreA;
            return a.title.localeCompare(b.title);
        });
        
        // Sort wiki pages by reference count (highest first)
        const sortedDanbooruWikiPages = Array.from(danbooruWikiPages.values()).sort((a, b) => {
            if (b.referenceCount !== a.referenceCount) return b.referenceCount - a.referenceCount;
            return a.title.localeCompare(b.title);
        });
        
        const sortedE621WikiPages = Array.from(e621WikiPages.values()).sort((a, b) => {
            if (b.referenceCount !== a.referenceCount) return b.referenceCount - a.referenceCount;
            return a.title.localeCompare(b.title);
        });
        
        // Extract just titles for final arrays (sorted by frequency)
        const uniqueDanbooruTags = danbooruTags.map(t => t.title);
        const uniqueE621Tags = e621Tags.map(t => t.title);
        const uniqueDanbooruWikiPages = sortedDanbooruWikiPages.map(w => w.title);
        const uniqueE621WikiPages = sortedE621WikiPages.map(w => w.title);
        
        // Combine tags and wiki pages for each source (tags first, then wiki pages, both sorted by frequency)
        const danbooruAll = [...uniqueDanbooruTags, ...uniqueDanbooruWikiPages];
        const e621All = [...uniqueE621Tags, ...uniqueE621WikiPages];
        
        // Store counts for summary
        const missingWikisDanbooruCount = danbooruAll.length;
        const missingWikisE621Count = e621All.length;
        
        const missingWikisData = {
            _metadata: {
                generated_at: new Date().toISOString(),
                total_tags_missing_wikis: allMissingWikiTags.size,
                total_referenced_wiki_pages: referencedWikiPages.length,
                total_tags_from_urls: referencedTagsFromUrls.length,
                breakdown: {
                    danbooru: {
                        tags: uniqueDanbooruTags.length,
                        wiki_pages: uniqueDanbooruWikiPages.length,
                        tags_from_urls: referencedTagsFromUrls.filter(r => r.source === SOURCE_DANBOORU).length,
                        total: danbooruAll.length
                    },
                    e621: {
                        tags: uniqueE621Tags.length,
                        wiki_pages: uniqueE621WikiPages.length,
                        tags_from_urls: referencedTagsFromUrls.filter(r => r.source === SOURCE_E621).length,
                        total: e621All.length
                    }
                },
                sorting: {
                    tags: "Sorted by usage count + reference count (highest first), filtered to >= 150 usage for tags with usage data",
                    wiki_pages: "Sorted by reference frequency (highest first)",
                    min_tag_usage: MIN_TAG_USAGE
                },
                note: "Includes tags missing wikis, referenced wiki pages, and tags/wiki pages referenced in URLs (view/create/edit/search patterns). Arrays are sorted by frequency/usage."
            },
            danbooru: danbooruAll,
            e621: e621All
        };
        
        // Ensure data directory exists
        const missingWikisDataDir = path.dirname(missingWikisPath);
        if (!fs.existsSync(missingWikisDataDir)) {
            fs.mkdirSync(missingWikisDataDir, { recursive: true });
        }
        
        fs.writeFileSync(missingWikisPath, JSON.stringify(missingWikisData, null, 2), 'utf8');
        console.log(`   ✓ Exported ${allMissingWikiTags.size} tags missing wikis`);
        console.log(`   ✓ Exported ${referencedWikiPages.length} referenced wiki pages`);
        console.log(`   ✓ Danbooru: ${danbooruAll.length} items (${uniqueDanbooruTags.length} tags, ${uniqueDanbooruWikiPages.length} wiki pages)`);
        console.log(`   ✓ E621: ${e621All.length} items (${uniqueE621Tags.length} tags, ${uniqueE621WikiPages.length} wiki pages)`);
        console.log(`   ✓ Saved to ${path.basename(missingWikisPath)}`);
        
        try {
            db.pragma('wal_checkpoint(TRUNCATE)');
        } catch (_) {}
        db.close();
        for (const suffix of ['-wal', '-shm', '-journal']) {
            const sidecar = DATABASE_BUILD_PATH + suffix;
            if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
        }
        removeSqliteSidecars(DATABASE_PATH);
        fs.renameSync(DATABASE_BUILD_PATH, DATABASE_PATH);
        
        const fileSize = (fs.statSync(DATABASE_PATH).size / 1024 / 1024).toFixed(2);
        console.log('\n✅ Database creation complete!');
        console.log(`\n📊 Summary:`);
        console.log(`   Database: ${path.basename(DATABASE_PATH)} (${fileSize} MB)`);
        console.log(`   Total tags: ${totalTagsCount}`);
        console.log(`   Danbooru tags: ${danbooruTagsCount}`);
        console.log(`   Danbooru wikis: ${danbooruWikisCount}`);
        console.log(`   Furry tags: ${furryTagsCount}`);
        console.log(`   Furry wikis: ${furryWikisCount}`);
        console.log(`   NovelAI tags: ${novelaiTagsCount}`);
        console.log(`   Z-categories: ${zCategoriesCount}`);
        console.log(`   Wiki pages: ${wikiPagesCount}`);
        console.log(`   Merged tags: ${mergedTagsCount}`);
        if (allPostThumbRefs && allPostThumbRefs.length > 0) {
            console.log(`   Post/thumb references: ${allPostThumbRefs.length}`);
        }
        if (allExternalUrlRefs && allExternalUrlRefs.length > 0) {
            console.log(`   External URL references: ${allExternalUrlRefs.length}`);
        }
        
        // Note: Missing wikis counts are already logged in the export section above
        
    } catch (error) {
        console.error('\n❌ Database creation failed:', error);
        if (error && String(error.code || '').startsWith('SQLITE_IOERR')) {
            console.error('   Stop Dreamscape (it still has tag_wiki.db open) and re-run this script.');
        }
        process.exit(1);
    }
}

// Run if executed directly
if (require.main === module) {
    main();
}

module.exports = { 
    main, 
    normalizeTitle, 
    categoryStringToNumber,
    tokenizeTagTitleWithTerminators,
    generateTagSequencesWithTerminators,
    normalizeWikiBody,
    extractWikiSections,
    extractWikiContentLinks,
    extractWikiLinks,
    detectLinkRelationship
};

