/**
 * @fileoverview Tag Lookup Module - Node.js compatible tag search and lookup functions
 * @description Extracted from tag-explorer.js for use in Node.js environment
 */

const fs = require('fs');
const path = require('path');
const SQLiteAsyncWrapper = require('./sqliteAsyncWrapper');
const { NodeHtmlMarkdown } = require('node-html-markdown');
const https = require('https');
const http = require('http');
const sharp = require('sharp');
const crypto = require('crypto');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

class TagLookup {
    constructor(globalResources = null) {
        if (!globalResources) {
            throw new Error('TagLookup requires globalResources instance and should only be instantiated by globalResources.js');
        }
        this.globalResources = globalResources;

        this.SOURCE_CUSTOM = 0;
        this.SOURCE_DANBOORU = 1;
        this.SOURCE_E621 = 2;
        this.MAX_TABLE_RESULTS = 30;
        this.MAX_BODY_PREVIEWS = 5;
        this.MAX_GROUPS_DISPLAY = 2;
        this.MAX_SECTION_SUMMARY = 15;

        this.db = null;
        this.dbPath = null;
        this.sqlStatements = null;
        this.cachedTagGroupsInfo = null;
        this.tagGroupPresenceCache = new Map();
        this.MAX_USAGE_CAP = 100000;
        this.htmlMarkdownConverter = null;
    }
    
/**
 * Get or initialize the HTML to Markdown converter
 * @returns {NodeHtmlMarkdown} The converter instance
 */
    getHtmlMarkdown() {
    if (!this.htmlMarkdownConverter) {
        this.htmlMarkdownConverter = new NodeHtmlMarkdown({
            // Preserve wiki links (span.tag-wiki-link) as plain text with tag name
            customTransformers: [
                {
                    filter: (node) => node.nodeName === 'SPAN' && node.classList && node.classList.contains('tag-wiki-link'),
                    replacement: (content, node) => {
                        const tagName = node.getAttribute('data-tag-name') || content;
                        return tagName;
                    }
                }
            ],
            // Preserve code blocks
            codeBlockStyle: 'fenced',
            // Preserve tables
            tables: true,
            // Preserve links
            useLinkReferenceDefinitions: false
        });
    }
    return this.htmlMarkdownConverter;
}

/**
 * Initialize the SQLite database
 * @param {string} databasesPath - Path to databases directory (passed from this.globalResources to avoid circular dependency)
 */
    async initializeDatabase(databasesPath = null) {
    try {
        // Get database path - use provided path or fall back to this.globalResources (for backward compatibility)
        if (!databasesPath) {
            // Lazy access to avoid circular dependency issues
            databasesPath = this.globalResources.getPath('databases');
        }
        this.dbPath = path.join(databasesPath, 'tag_wiki.db');
        
        // Check if database exists
        if (!fs.existsSync(this.dbPath)) {
            throw new Error(`Tag database not found at ${this.dbPath}`);
        }
        
        // Initialize async wrapper (checkpoint manager is automatically connected)
        this.db = new SQLiteAsyncWrapper(this.dbPath, 'tag_wiki', 60); // 60 minute idle timeout
        
        // Initialize database (opens connection)
        await this.db.initialize();
        
        // Add fetched_online column if it doesn't exist
        try {
            await this.db.run(`ALTER TABLE wikis ADD COLUMN fetched_online INTEGER DEFAULT 0`);
        } catch (error) {
            // Column already exists, ignore
        }
        
        // Clear expired failed fetches on startup
        await this.clearExpiredFailedFetches();
        
        return true;
    } catch (error) {
        console.error('Error initializing tag database:', error);
        console.error('Full error stack:', error.stack);
        return false;
    }
}

    getStatements() {
    if (!this.sqlStatements) {
        this.sqlStatements = {
            getTagById: `
                SELECT t.*, 
                       GROUP_CONCAT(DISTINCT w.source) AS wiki_sources
                FROM tags t
                LEFT JOIN tag_wikis tw ON tw.tag_id = t.id
                LEFT JOIN wikis w ON w.id = tw.wiki_id
                WHERE t.id = ?
                GROUP BY t.id
            `,
            getTagByNormalizedTitle: `
                SELECT t.*, 
                       GROUP_CONCAT(DISTINCT w.source) AS wiki_sources
                FROM tags t
                LEFT JOIN tag_wikis tw ON tw.tag_id = t.id
                LEFT JOIN wikis w ON w.id = tw.wiki_id
                WHERE t.normalized_title = ?
                GROUP BY t.id
            `,
            getTagByOtherNameExact: `
                SELECT t.*, 
                       GROUP_CONCAT(DISTINCT w.source) AS wiki_sources
                FROM tag_other_names onames
                JOIN tags t ON t.id = onames.tag_id
                LEFT JOIN tag_wikis tw ON tw.tag_id = t.id
                LEFT JOIN wikis w ON w.id = tw.wiki_id
                WHERE LOWER(REPLACE(onames.other_name, '_', ' ')) = ?
                GROUP BY t.id
                LIMIT 1
            `,
            searchTitleLike: `
                SELECT t.*, 
                       GROUP_CONCAT(DISTINCT w.source) AS wiki_sources
                FROM tags t
                LEFT JOIN tag_wikis tw ON tw.tag_id = t.id
                LEFT JOIN wikis w ON w.id = tw.wiki_id
                WHERE LOWER(t.title) LIKE ? ESCAPE '\\'
                GROUP BY t.id
                LIMIT ?
            `,
            searchOtherNamesLike: `
                SELECT DISTINCT t.*, 
                       GROUP_CONCAT(DISTINCT w.source) AS wiki_sources
                FROM tag_other_names onames
                JOIN tags t ON t.id = onames.tag_id
                LEFT JOIN tag_wikis tw ON tw.tag_id = t.id
                LEFT JOIN wikis w ON w.id = tw.wiki_id
                WHERE LOWER(onames.other_name) LIKE ? ESCAPE '\\'
                GROUP BY t.id
                LIMIT ?
            `,
            // Search tag_word_sequences for exact sequence matches (fast indexed lookup)
            searchWordSequencesExact: `
                SELECT DISTINCT t.*,
                       GROUP_CONCAT(DISTINCT w.source) AS wiki_sources
                FROM tag_word_sequences tws
                INNER JOIN tags t ON t.id = tws.tag_id
                LEFT JOIN tag_wikis tw ON tw.tag_id = t.id
                LEFT JOIN wikis w ON w.id = tw.wiki_id
                WHERE LOWER(tws.sequence) = LOWER(?)
                GROUP BY t.id
                ORDER BY tws.sequence_length DESC, t.title
                LIMIT ?
            `,
            // Search tag_word_sequences for prefix matches (fast indexed lookup)
            searchWordSequencesPrefix: `
                SELECT DISTINCT t.*,
                       GROUP_CONCAT(DISTINCT w.source) AS wiki_sources
                FROM tag_word_sequences tws
                INNER JOIN tags t ON t.id = tws.tag_id
                LEFT JOIN tag_wikis tw ON tw.tag_id = t.id
                LEFT JOIN wikis w ON w.id = tw.wiki_id
                WHERE LOWER(tws.sequence) LIKE LOWER(?) || '%' ESCAPE '\\'
                GROUP BY t.id
                ORDER BY tws.sequence_length DESC, t.title
                LIMIT ?
            `,
            // Search tag_word_sequences for inner matches (word appears anywhere in sequence, like %word%)
            searchWordSequencesInner: `
                SELECT DISTINCT t.*,
                       GROUP_CONCAT(DISTINCT w.source) AS wiki_sources
                FROM tag_word_sequences tws
                INNER JOIN tags t ON t.id = tws.tag_id
                LEFT JOIN tag_wikis tw ON tw.tag_id = t.id
                LEFT JOIN wikis w ON w.id = tw.wiki_id
                WHERE LOWER(tws.sequence) LIKE '%' || LOWER(?) || '%' ESCAPE '\\'
                GROUP BY t.id
                ORDER BY tws.sequence_length DESC, t.title
                LIMIT ?
            `,
            // Search tag_word_sequences for word at start (like word%)
            searchWordSequencesStart: `
                SELECT DISTINCT t.*,
                       GROUP_CONCAT(DISTINCT w.source) AS wiki_sources
                FROM tag_word_sequences tws
                INNER JOIN tags t ON t.id = tws.tag_id
                LEFT JOIN tag_wikis tw ON tw.tag_id = t.id
                LEFT JOIN wikis w ON w.id = tw.wiki_id
                WHERE LOWER(tws.sequence) LIKE LOWER(?) || '%' ESCAPE '\\'
                GROUP BY t.id
                ORDER BY tws.sequence_length DESC, t.title
                LIMIT ?
            `,
            // Search tag_word_sequences for word at end (like %word)
            searchWordSequencesEnd: `
                SELECT DISTINCT t.*,
                       GROUP_CONCAT(DISTINCT w.source) AS wiki_sources
                FROM tag_word_sequences tws
                INNER JOIN tags t ON t.id = tws.tag_id
                LEFT JOIN tag_wikis tw ON tw.tag_id = t.id
                LEFT JOIN wikis w ON w.id = tw.wiki_id
                WHERE LOWER(tws.sequence) LIKE '%' || LOWER(?) ESCAPE '\\'
                GROUP BY t.id
                ORDER BY tws.sequence_length DESC, t.title
                LIMIT ?
            `,
            // FTS5 search for body text (fast full-text search) - tagged wikis only
            searchBodyByKeywordFTS: `
                SELECT DISTINCT t.*
                FROM wikis_fts w_fts
                INNER JOIN wikis w ON w.id = w_fts.rowid
                INNER JOIN tag_wikis tw ON tw.wiki_id = w.id
                INNER JOIN tags t ON t.id = tw.tag_id
                WHERE wikis_fts MATCH ?
                LIMIT ?
            `,
            // Fallback LIKE search for body text (slower, but works when FTS5 doesn't match) - tagged wikis only
            // NOTE: This is only used for searchByDescription, not for fetchTagWikiMentions
            // fetchTagWikiMentions uses indexed tag_wiki_links instead
            searchBodyByKeyword: `
                SELECT DISTINCT t.*
                FROM tag_wikis tw
                INNER JOIN wikis w ON w.id = tw.wiki_id
                INNER JOIN tags t ON t.id = tw.tag_id
                WHERE LOWER(w.body) LIKE ? ESCAPE '\\'
                LIMIT ?
            `,
            searchWikiPageBodies: `
                SELECT DISTINCT wp.title
                FROM wiki_pages wp
                LEFT JOIN wikis w_d ON w_d.id = wp.danbooru_wiki_id
                LEFT JOIN wikis w_e ON w_e.id = wp.e621_wiki_id
                WHERE (LOWER(COALESCE(w_d.body, w_e.body, '')) LIKE ? ESCAPE '\\')
                  AND NOT EXISTS (SELECT 1 FROM tag_wikis tw WHERE tw.wiki_id IN (wp.danbooru_wiki_id, wp.e621_wiki_id))
                ORDER BY wp.title
                LIMIT ?
            `,
            getOtherNames: 'SELECT other_name FROM tag_other_names WHERE tag_id = ? ORDER BY other_name',
            getBodiesByTag: `
                SELECT w.id AS wiki_id, w.source, w.body, w.fetched_online
                FROM tag_wikis tw
                INNER JOIN wikis w ON w.id = tw.wiki_id
                WHERE tw.tag_id = ?
                ORDER BY w.source
            `,
            getBodyBySource: `
                SELECT w.body, w.fetched_online
                FROM tag_wikis tw
                INNER JOIN wikis w ON w.id = tw.wiki_id
                WHERE tw.tag_id = ? AND w.source = ?
                LIMIT 1
            `,
            getLinksFrom: `
                SELECT t.*
                FROM tag_links l
                JOIN tags t ON t.id = l.to_tag_id
                WHERE l.from_tag_id = ?
            `,
            getLinksTo: `
                SELECT t.*
                FROM tag_links l
                JOIN tags t ON t.id = l.from_tag_id
                WHERE l.to_tag_id = ?
            `,
            getLinkIdsFrom: 'SELECT to_tag_id AS tag_id FROM tag_links WHERE from_tag_id = ?',
            getLinkIdsTo: 'SELECT from_tag_id AS tag_id FROM tag_links WHERE to_tag_id = ?',
            // Get wikis that a tag appears in (soft links - all relationship types)
            getWikisTagAppearsIn: `
                SELECT w.*, l.relationship
                FROM tag_wiki_links l
                INNER JOIN wikis w ON w.id = l.wiki_id
                WHERE l.tag_id = ?
                ORDER BY l.relationship, w.title
            `,
            // Get tags that appear in a wiki (soft links - all relationship types)
            getTagsInWiki: `
                SELECT t.*, l.relationship
                FROM tag_wiki_links l
                INNER JOIN tags t ON t.id = l.tag_id
                WHERE l.wiki_id = ?
                ORDER BY l.relationship, t.title
            `,
            // Get related tags for a wiki (relationship = 1)
            getRelatedTagsInWiki: `
                SELECT t.*, l.relationship
                FROM tag_wiki_links l
                JOIN tags t ON t.id = l.tag_id
                WHERE l.wiki_id = ? AND l.relationship = 1
            `,
            // Get deprecated/replacement tags for a wiki (relationship = 2)
            getReplacementTagsInWiki: `
                SELECT t.*, l.relationship
                FROM tag_wiki_links l
                JOIN tags t ON t.id = l.tag_id
                WHERE l.wiki_id = ? AND l.relationship = 2
            `,
            // Get "not to be confused with" tags for a wiki (relationship = 3)
            getNotToBeConfusedTagsInWiki: `
                SELECT t.*, l.relationship
                FROM tag_wiki_links l
                JOIN tags t ON t.id = l.tag_id
                WHERE l.wiki_id = ? AND l.relationship = 3
            `,
            getTagGroupNames: `
                SELECT g.name, g.path
                FROM tag_d_groups tdg
                JOIN d_groups g ON g.id = tdg.group_id
                WHERE tdg.tag_id = ?
                ORDER BY g.name
            `,
            getTagGroupPagesForTag: `
                SELECT DISTINCT wp.id, wp.title
                FROM wiki_page_links wpl
                JOIN wiki_pages wp ON wp.id = wpl.page_id
                WHERE wpl.linked_tag_id = ?
                  AND (LOWER(wp.title) LIKE 'tag group:%' OR LOWER(wp.title) LIKE 'tag_group:%')
                ORDER BY wp.title
                LIMIT ?
            `,
            hasTagGroups: 'SELECT 1 FROM tag_d_groups WHERE tag_id = ? LIMIT 1',
            getWikiPagesReferencingTag: `
                SELECT DISTINCT wp.id, wp.title
                FROM wiki_page_links wpl
                JOIN wiki_pages wp ON wp.id = wpl.page_id
                WHERE wpl.linked_tag_id = ?
                  AND NOT (LOWER(wp.title) LIKE 'tag group:%' OR LOWER(wp.title) LIKE 'tag_group:%')
                ORDER BY wp.title
                LIMIT ?
            `,
            searchGroupPagesByTitle: `
                SELECT wp.id, wp.title, wp.category,
                       COALESCE(w_d.body, w_e.body) AS body,
                       CASE
                           WHEN w_d.id IS NOT NULL THEN 'danbooru'
                           WHEN w_e.id IS NOT NULL THEN 'e621'
                           ELSE 'summary'
                       END AS source
                FROM wiki_pages wp
                LEFT JOIN wikis w_d ON w_d.id = wp.danbooru_wiki_id
                LEFT JOIN wikis w_e ON w_e.id = wp.e621_wiki_id
                WHERE (LOWER(wp.title) LIKE 'tag group:%' OR LOWER(wp.title) LIKE 'tag_group:%')
                  AND LOWER(wp.title) LIKE ? ESCAPE '\\'
                LIMIT ?
            `,
            searchGroupPagesByBody: `
                SELECT wp.id, wp.title, wp.category,
                       COALESCE(w_d.body, w_e.body) AS body,
                       CASE
                           WHEN w_d.id IS NOT NULL THEN 'danbooru'
                           WHEN w_e.id IS NOT NULL THEN 'e621'
                           ELSE 'summary'
                       END AS source
                FROM wiki_pages wp
                LEFT JOIN wikis w_d ON w_d.id = wp.danbooru_wiki_id
                LEFT JOIN wikis w_e ON w_e.id = wp.e621_wiki_id
                WHERE (LOWER(wp.title) LIKE 'tag group:%' OR LOWER(wp.title) LIKE 'tag_group:%')
                  AND LOWER(COALESCE(w_d.body, w_e.body, '')) LIKE ? ESCAPE '\\'
                LIMIT ?
            `,
            getGroupMembers: `
                SELECT t.*
                FROM wiki_page_tags wpt
                JOIN tags t ON t.id = wpt.tag_id
                WHERE wpt.page_id = ?
                ORDER BY t.title
                LIMIT ?
            `,
            insertDynamicTag: `
                INSERT INTO tags (title, normalized_title, category, d_count, e_count, n_count, n_rand, is_locked, untrained)
                VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0)
            `,
            updateTagNovelCount: 'UPDATE tags SET n_count = ? WHERE id = ?',
            findWikiPageByTitle: `
                SELECT id, title, danbooru_wiki_id, e621_wiki_id, category
                FROM wiki_pages
                WHERE LOWER(title) = ?
                LIMIT 1
            `,
            getWikiPageById: `
                SELECT id, title, danbooru_wiki_id, e621_wiki_id, category
                FROM wiki_pages
                WHERE id = ?
                LIMIT 1
            `,
            getWikiBodyById: 'SELECT id, body, source FROM wikis WHERE id = ?',
            // Get wiki sections from database (indexed, fast)
            getWikiSections: `
                SELECT section_index, level, title, anchor, start_offset, end_offset, 
                       line_index, section_type, parent_section_id
                FROM wiki_sections
                WHERE wiki_id = ?
                ORDER BY section_index
            `,
            // Get section by anchor
            getSectionByAnchor: `
                SELECT section_index, level, title, anchor, start_offset, end_offset, 
                       line_index, section_type, parent_section_id
                FROM wiki_sections
                WHERE wiki_id = ? AND anchor = ?
                LIMIT 1
            `,
            // Get section by index (1-based for user input, converted to 0-based for query)
            getSectionByIndex: `
                SELECT section_index, level, title, anchor, start_offset, end_offset, 
                       line_index, section_type, parent_section_id
                FROM wiki_sections
                WHERE wiki_id = ? AND section_index = ?
                LIMIT 1
            `,
            // Get wiki links (wiki-to-wiki relationships)
            getWikiLinksFrom: `
                SELECT w.*
                FROM wiki_links wl
                JOIN wikis w ON w.id = wl.to_wiki_id
                WHERE wl.from_wiki_id = ?
            `,
            getWikiLinksTo: `
                SELECT w.*
                FROM wiki_links wl
                JOIN wikis w ON w.id = wl.from_wiki_id
                WHERE wl.to_wiki_id = ?
            `,
            // Get wiki ID for a tag and source
            getWikiIdForTag: `
                SELECT w.id, w.fetched_online
                FROM tag_wikis tw
                INNER JOIN wikis w ON w.id = tw.wiki_id
                WHERE tw.tag_id = ? AND w.source = ?
                LIMIT 1
            `,
            // Get tag ID for a wiki (from tag_wikis)
            getTagIdForWiki: `
                SELECT tag_id
                FROM tag_wikis
                WHERE wiki_id = ?
                LIMIT 1
            `,
            // Find wiki_page by wiki_id (check both danbooru_wiki_id and e621_wiki_id)
            findWikiPageByWikiId: `
                SELECT id, title
                FROM wiki_pages
                WHERE danbooru_wiki_id = ? OR e621_wiki_id = ?
                LIMIT 1
            `,
            // Check if tag has any wikis (fast check without loading body)
            hasWikiForTag: `
                SELECT 1
                FROM tag_wikis tw
                WHERE tw.tag_id = ?
                LIMIT 1
            `,
            // Insert wiki and link to tag (for dynamic tag creation)
            insertWikiForTag: `
                INSERT OR REPLACE INTO wikis (title, body, source, created_at, updated_at, fetched_online)
                VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1)
            `,
            insertTagWikiLink: `
                INSERT OR IGNORE INTO tag_wikis (tag_id, wiki_id) VALUES (?, ?)
            `,
            getWikiByTitleAndSource: `
                SELECT id, title, body, source, fetched_online
                FROM wikis
                WHERE LOWER(title) = LOWER(?) AND source = ?
                LIMIT 1
            `,
            deleteWikiPageById: 'DELETE FROM wiki_pages WHERE id = ?',
            // Dataset group queries
            getDGroupByPath: 'SELECT id, name, path, parent_id, pretty_name, description, icon FROM d_groups WHERE path = ? LIMIT 1',
            getDGroupById: 'SELECT id, name, path, parent_id, pretty_name, description, icon FROM d_groups WHERE id = ? LIMIT 1',
            getDGroupChildren: 'SELECT id, name, path, parent_id, pretty_name, description, icon FROM d_groups WHERE parent_id = ? ORDER BY name',
            getRootGroups: 'SELECT id, name, path, parent_id, pretty_name, description, icon FROM d_groups WHERE path = \'g\' OR parent_id IS NULL ORDER BY name',
            getDGroupArrayMetadata: 'SELECT child_name, pretty_name, icon FROM d_group_array_metadata WHERE parent_group_id = ?',
            // Search for groups by partial path or name
            searchDGroupsByPathEnd: `
                SELECT id, name, path, parent_id, pretty_name, description, icon
                FROM d_groups
                WHERE path LIKE ? ESCAPE '\\'
                   OR path LIKE ? ESCAPE '\\'
                ORDER BY 
                    CASE 
                        WHEN path = ? THEN 1
                        WHEN path LIKE ? ESCAPE '\\' THEN 2
                        ELSE 3
                    END,
                    path
                LIMIT 20
            `,
            searchDGroupsByName: `
                SELECT id, name, path, parent_id, pretty_name, description, icon
                FROM d_groups
                WHERE LOWER(name) LIKE LOWER(?) ESCAPE '\\'
                   OR LOWER(pretty_name) LIKE LOWER(?) ESCAPE '\\'
                ORDER BY 
                    CASE 
                        WHEN LOWER(name) = LOWER(?) THEN 1
                        WHEN LOWER(pretty_name) = LOWER(?) THEN 2
                        WHEN LOWER(name) LIKE LOWER(?) || '%' ESCAPE '\\' THEN 3
                        WHEN LOWER(pretty_name) LIKE LOWER(?) || '%' ESCAPE '\\' THEN 4
                        ELSE 5
                    END,
                    path
                LIMIT 20
            `,
            getDatasetGroupTags: `
                SELECT t.*
                FROM dataset_group_members dgm
                JOIN tags t ON t.id = dgm.tag_id
                WHERE dgm.group_id = ?
                ORDER BY t.title
            `,
            getDGroupPathChain: `
                WITH RECURSIVE group_path AS (
                    SELECT id, name, path, parent_id, pretty_name, description, icon, 0 as depth
                    FROM d_groups
                    WHERE id = ?
                    UNION ALL
                    SELECT g.id, g.name, g.path, g.parent_id, g.pretty_name, g.description, g.icon, gp.depth + 1
                    FROM d_groups g
                    INNER JOIN group_path gp ON g.id = gp.parent_id
                )
                SELECT id, name, path, parent_id, pretty_name, description, icon, depth
                FROM group_path
                ORDER BY depth DESC
            `,
            // Get content links for a wiki (file:, post:, image:, wiki:, external, and ID-based links)
            getWikiContentLinks: `
                SELECT link_type, link_id, link_url, link_page, display_text, start_offset, end_offset
                FROM wiki_content_links
                WHERE wiki_id = ?
                ORDER BY start_offset
            `
        };
    }
    return this.sqlStatements;
}

    normalizeTagName(tagName = '') {
    return tagName
        .trim()
        .toLowerCase()
        .replace(/[\s\-_]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

    /**
     * Text match tier for ranking (comparison-only; never mutates tag title).
     * 4 = separator-exact, 3 = separator-prefix, 2 = strong token coverage, 1 = partial token coverage, 0 = weak
     */
    commonPrefixLength(a = '', b = '') {
    const minLen = Math.min(a.length, b.length);
    let i = 0;
    while (i < minLen && a[i] === b[i]) {
        i++;
    }
    return i;
}

    getWordStemPrefix(word = '') {
    if (!word || word.length < 4) return null;
    const stemLen = Math.min(5, word.length - 1);
    if (stemLen < 4) return null;
    const stem = word.substring(0, stemLen);
    return stem === word ? null : stem;
}

    getTokenMatchScore(queryToken = '', titleToken = '') {
    const qt = queryToken.toLowerCase();
    const tt = titleToken.toLowerCase();
    if (!qt || !tt) return 0;
    if (qt === tt) return 100;
    if (qt.length >= 3 && tt.length >= 3 && (qt.startsWith(tt) || tt.startsWith(qt))) {
        return 90;
    }
    const stemLen = this.commonPrefixLength(qt, tt);
    const minLen = Math.min(qt.length, tt.length);
    const stemThreshold = Math.max(3, Math.min(4, Math.floor(minLen * 0.72)));
    if (stemLen >= 5) {
        return 88;
    }
    if (stemLen >= stemThreshold) {
        return 75;
    }
    if (qt.includes(tt) || tt.includes(qt)) {
        if (Math.min(qt.length, tt.length) >= 3) {
            return 55;
        }
    }
    const distance = this.levenshteinDistance(qt, tt);
    const maxLen = Math.max(qt.length, tt.length);
    const similarity = 1 - (distance / maxLen);
    if (similarity >= 0.72) {
        return Math.round(similarity * 65);
    }
    return 0;
}

    getQueryTokenCoverageScore(query, title) {
    const queryTokens = this.tokenizeSearchWords(query);
    const titleTokens = this.tokenizeSearchWords(title);
    if (queryTokens.length === 0) return 0;

    let sum = 0;
    let weightedSum = 0;
    let weightTotal = 0;
    for (let i = 0; i < queryTokens.length; i++) {
        const queryToken = queryTokens[i];
        let best = 0;
        for (const titleToken of titleTokens) {
            best = Math.max(best, this.getTokenMatchScore(queryToken, titleToken));
        }
        sum += best;
        const weight = queryTokens.length >= 2
            ? (i === 0 ? 1.4 : (i === queryTokens.length - 1 ? 1.0 : 1.1))
            : 1;
        weightedSum += best * weight;
        weightTotal += weight;
    }

    let coverage = Math.max(sum / queryTokens.length, weightedSum / weightTotal);
    if (titleTokens.length === queryTokens.length && queryTokens.length >= 2) {
        coverage += 8;
    } else if (titleTokens.length < queryTokens.length) {
        coverage -= 12;
    }
    return Math.min(100, coverage);
}

    getQueryMatchTier(query, title) {
    const queryNorm = this.normalizeTagName(query);
    const titleNorm = this.normalizeTagName(title);
    if (!queryNorm || !titleNorm) return 0;

    if (titleNorm === queryNorm) return 4;
    if (titleNorm.startsWith(queryNorm)) return 3;

    const queryTokens = this.tokenizeSearchWords(query);
    const titleTokens = this.tokenizeSearchWords(title);
    if (queryTokens.length === 0) return 0;

    const coverage = this.getQueryTokenCoverageScore(query, title);
    const allTokensPartial = queryTokens.every(qt =>
        titleTokens.some(tt => this.getTokenMatchScore(qt, tt) >= 40)
    );

    if (coverage >= 90 || (coverage >= 55 && allTokensPartial)) {
        return 2;
    }
    if (coverage >= 35) {
        if (queryTokens.length >= 2 && titleTokens.length === 1) {
            const singleToken = titleTokens[0];
            const matchedQueryWord = queryTokens.some(qt => qt === singleToken);
            return matchedQueryWord && coverage >= 45 ? 1 : 0;
        }
        return 1;
    }
    return 0;
}

    getQueryMatchInfo(query, title) {
    const tier = this.getQueryMatchTier(query, title);
    return {
        tier,
        matchCoverage: this.getQueryTokenCoverageScore(query, title),
        isExactMatch: tier === 4,
        isPrefixMatch: tier >= 3
    };
}

    /**
     * Title lookup variants for exact/LIKE matching (spaces vs hyphens vs underscores).
     */
    getTagNameLookupVariants(normalized) {
    if (!normalized) return [];
    const variants = new Set([normalized]);
    variants.add(normalized.replace(/ /g, '-'));
    variants.add(normalized.replace(/ /g, '_'));
    return [...variants].filter(Boolean);
}

    /**
     * Split a search query into word tokens; hyphens/underscores/special chars are word boundaries.
     */
    tokenizeSearchWords(query = '') {
    const lower = (query || '').trim().toLowerCase();
    const words = [];
    let current = '';

    for (let i = 0; i < lower.length; i++) {
        const char = lower[i];
        if (/[\s\-_]/.test(char) || /[^a-z0-9]/.test(char)) {
            if (current.trim()) {
                words.push(current.trim());
            }
            current = '';
        } else {
            current += char;
        }
    }
    if (current.trim()) {
        words.push(current.trim());
    }
    return words.filter(word => word.length > 0);
}

    /**
     * Multi-word sequence forms stored in tag_word_sequences (space- or §-separated).
     */
    buildSearchWordSequences(wordTokens) {
    const sequences = new Set();
    if (!wordTokens || wordTokens.length < 2) {
        return sequences;
    }

    for (let i = 0; i < wordTokens.length; i++) {
        for (let j = i + 2; j <= wordTokens.length; j++) {
            const slice = wordTokens.slice(i, j);
            sequences.add(slice.join(' '));
            sequences.add(slice.join(' § '));
        }
    }

    return sequences;
}

    escapeLikePattern(value = '') {
    return value
        .replace(/\\/g, '\\\\')
        .replace(/%/g, '\\%')
        .replace(/_/g, '\\_');
}

    buildLikePatterns(keyword = '') {
    const LIKE_PATTERN_VARIANTS = [
        { build: kw => kw, score: 100 },
        { build: kw => `${kw} %`, score: 95 },
        { build: kw => `% ${kw}`, score: 95 },
        { build: kw => `% ${kw} %`, score: 90 },
        { build: kw => `${kw}%`, score: 85 },
        { build: kw => `%${kw}`, score: 85 },
        { build: kw => `%${kw}%`, score: 75 }
    ];
    const escaped = this.escapeLikePattern(keyword);
    const variants = [];
    const seen = new Set();
    LIKE_PATTERN_VARIANTS.forEach(cfg => {
        const pattern = cfg.build(escaped);
        if (!pattern || seen.has(pattern)) {
            return;
        }
        seen.add(pattern);
        variants.push({ pattern, score: cfg.score });
    });
    return variants;
}

    hasWordBoundary(text = '', keyword = '') {
    if (!text || !keyword) return false;
    const boundaryPattern = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    return boundaryPattern.test(text);
}

    getUsageCount(row) {
    if (!row) return 0;
    const dCount = Math.min(this.MAX_USAGE_CAP, row.d_count || 0);
    const eCount = Math.min(this.MAX_USAGE_CAP, row.e_count || 0) * 4;
    const nCount = this.getNovelTrainingCount(row) * 12;
    return Math.max(dCount, eCount, nCount);
}

    getNovelTrainingCount(row) {
    if (!row) return 0;
    return Math.min(10000, row.n_count || 0);
}

    mapRowToTag(row) {
    if (!row) return null;
    const title = row.title;
    
    // Parse wiki sources from GROUP_CONCAT result
    let wikiSources = [];
    let hasWiki = false;
    if (row.wiki_sources) {
        wikiSources = row.wiki_sources.split(',').map(s => {
            const sourceNum = parseInt(s, 10);
            if (sourceNum === this.SOURCE_DANBOORU) return 'danbooru';
            if (sourceNum === this.SOURCE_E621) return 'e621';
            return 'custom';
        }).filter(Boolean);
        hasWiki = wikiSources.length > 0;
    }
    
    return {
        id: row.id,
        name: title.replace(/\s+/g, '_'),
        title,
        category: row.category,
        categoryName: this.getCategoryName(row.category),
        d_count: row.d_count || 0,
        e_count: row.e_count || 0,
        n_count: row.n_count || 0,
        n: this.getUsageCount(row),
        source: wikiSources.length > 0 ? wikiSources : ['database'],
        wikiSources: wikiSources,
        hasWiki: hasWiki
    };
}

    selectPrimaryBody(bodies) {
    if (!bodies) return '';
    if (bodies.custom && bodies.custom.body) return bodies.custom.body;
    if (bodies.danbooru && bodies.danbooru.body) return bodies.danbooru.body;
    if (bodies.e621 && bodies.e621.body) return bodies.e621.body;
    return '';
}

    stripWikiFormattingSync(text, options = {}) {
    if (!text) return '';
    const singleLine = !!options.singleLine;
    let cleaned = String(text);

    // Section index markers (database / legacy)
    cleaned = cleaned.replace(/\[SECTION:([^\]]+)\]/gi, '$1');
    cleaned = cleaned.replace(/\[ENDSECTION:[^\]]+\]/gi, '');

    // Non-displayable blocks — drop entirely
    cleaned = cleaned.replace(/\[table\][\s\S]*?\[\/table\]/gi, ' ');
    cleaned = cleaned.replace(/\[code\][\s\S]*?\[\/code\]/gi, ' ');
    cleaned = cleaned.replace(/\[nodtext\][\s\S]*?\[\/nodtext\]/gi, ' ');
    cleaned = cleaned.replace(/\[hr\]/gi, ' ');
    cleaned = cleaned.replace(/\[hr\.[^\]]*\]/gi, ' ');
    cleaned = cleaned.replace(/<(code|nowiki|pre)>[\s\S]*?<\/\1>/gi, ' ');

    // Unwrap structural blocks — keep readable inner text
    const pairedBlocks = ['expand', 'section', 'quote', 'spoiler', 'colordiff', 'align'];
    for (const tag of pairedBlocks) {
        const blockRe = new RegExp(`\\[${tag}(?:=[^\\]]*)?\\]([\\s\\S]*?)\\[\\/${tag}\\]`, 'gi');
        cleaned = cleaned.replace(blockRe, ' $1 ');
    }

    // Inline formatting — unwrap, keep text
    const inlineTags = ['b', 'i', 'u', 's', 'sup', 'sub', 'tt', 'color', 'size'];
    for (let pass = 0; pass < 4; pass++) {
        let changed = false;
        for (const tag of inlineTags) {
            const inlineRe = new RegExp(`\\[${tag}(?:=[^\\]]*)?\\]([\\s\\S]*?)\\[\\/${tag}\\]`, 'gi');
            const next = cleaned.replace(inlineRe, '$1');
            if (next !== cleaned) changed = true;
            cleaned = next;
        }
        if (!changed) break;
    }

    // Resource / navigation links (not useful in one-line preview)
    cleaned = cleaned.replace(/\bfile:\d+(?:\|[^\s\]]+)?/gi, ' ');
    cleaned = cleaned.replace(/\bpost:\d+(?:\|[^\s\]]+)?/gi, ' ');
    cleaned = cleaned.replace(/\bimage:\d+(?:\|[^\s\]]+)?/gi, ' ');
    cleaned = cleaned.replace(/\bwiki:[^\s\]]+(?:\|[^\s\]]+)?/gi, ' ');
    cleaned = cleaned.replace(/!?(?:post|image|thumb)\s+#\d+/gi, ' ');
    cleaned = cleaned.replace(/\b(?:pool|topic|forum|comment|wiki)\s+#\d+(?:\/p\d+)?/gi, ' ');
    cleaned = cleaned.replace(/\b(?:asset|video|note|favgroup)\s+#\d+/gi, ' ');
    cleaned = cleaned.replace(/\b(?:source|parent|child|rating|fav)\s*:\s*\S+/gi, ' ');

    // Anchor links: [#anchor|text] or [#anchor]
    cleaned = cleaned.replace(/\[#([^\]]+)\|([^\]]+)\]/g, '$2');
    cleaned = cleaned.replace(/\[#([^\]]+)\]/g, '');

    // Wiki links: [[tag]] or [[display|tag]]
    let previousLength;
    do {
        previousLength = cleaned.length;
        cleaned = cleaned.replace(/\[\[([^\]]+?)\]\]/g, (match, content) => {
            if (content.includes('[[')) return match;
            if (content.includes('|')) {
                const parts = content.split('|');
                return parts[0].trim() || parts[parts.length - 1].trim();
            }
            return content.trim();
        });
    } while (cleaned.length !== previousLength && cleaned.includes('[['));

    // Tag search shortcuts
    cleaned = cleaned.replace(/\{\{([^}]+)\}\}/g, '$1');

    // External links: "text":url
    cleaned = cleaned.replace(/"([^"]+)":\[?https?:\/\/[^\]\s]+\]?/gi, '$1');
    cleaned = cleaned.replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/gi, '$1');
    cleaned = cleaned.replace(/\[([^\]]+)\]\(file:\/\/[^)]+\)/gi, ' ');

    // Headers: h1#id. Title or h4. Title
    cleaned = cleaned.replace(/h[1-6](?:#[^\s.]+)?\.\s*/gi, '');

    // List markers and blockquote markers
    cleaned = cleaned.replace(/^[ \t]*(?:\*{1,2}|-{1,2}|#{1,2}|\d+\.)\s+/gm, '');
    cleaned = cleaned.replace(/^bq\.\s*/gm, '');

    // Markdown headings / artifacts if mixed in
    cleaned = cleaned.replace(/^[ \t]*#{1,6}\s+/gm, '');

    // Inline / fenced code remnants
    cleaned = cleaned.replace(/```[\s\S]*?```/g, ' ');
    cleaned = cleaned.replace(/`([^`]+)`/g, '$1');

    // HTML tags and entities
    cleaned = cleaned.replace(/<[^>]+>/g, ' ');
    cleaned = cleaned.replace(/&(?:nbsp|amp|lt|gt|quot);/gi, ' ');

    // Underscores in tag names → spaces for readability
    cleaned = cleaned.replace(/_/g, ' ');

    if (singleLine) {
        cleaned = cleaned.replace(/\r\n?/g, ' ');
        cleaned = cleaned.replace(/\s+/g, ' ').trim();
    } else {
        cleaned = cleaned.replace(/\r\n?/g, '\n');
        cleaned = cleaned.replace(/[ \t]+/g, ' ');
        cleaned = cleaned.replace(/[ \t]*\n[ \t]*/g, '\n');
        cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
        cleaned = cleaned.trim();
    }

    return cleaned;
}

    stripWikiFormattingForPreview(text, maxLength = 320) {
    if (!text) return '';
    let cleaned = this.stripWikiFormattingSync(text, { singleLine: true });
    if (!cleaned) return '';
    if (cleaned.length > maxLength) {
        cleaned = cleaned.substring(0, maxLength).trim() + '…';
    }
    return cleaned;
}

    async attachPrimaryBodyPreviews(tags) {
    if (!tags || tags.length === 0 || !this.db) return tags;

    const wikiTags = tags.filter(tag => tag && tag.id && tag.hasWiki);
    if (wikiTags.length === 0) return tags;

    const tagIds = wikiTags.map(tag => tag.id);
    const placeholders = tagIds.map(() => '?').join(',');
    const query = `
        SELECT tw.tag_id, w.source, w.body
        FROM tag_wikis tw
        INNER JOIN wikis w ON w.id = tw.wiki_id
        WHERE tw.tag_id IN (${placeholders})
        ORDER BY tw.tag_id, w.source
    `;
    const rows = await this.db.all(query, tagIds);
    const bodiesByTagId = new Map();

    for (const row of rows) {
        if (!row || !row.body) continue;
        if (!bodiesByTagId.has(row.tag_id)) {
            bodiesByTagId.set(row.tag_id, []);
        }
        bodiesByTagId.get(row.tag_id).push(row);
    }

    for (const tag of wikiTags) {
        const bodyRows = bodiesByTagId.get(tag.id);
        if (!bodyRows || bodyRows.length === 0) continue;

        const hasCustom = bodyRows.some(row => row.source === this.SOURCE_CUSTOM);
        const filtered = hasCustom
            ? bodyRows.filter(row => row.source === this.SOURCE_CUSTOM)
            : bodyRows;
        const bodies = {};
        filtered.forEach(row => {
            let key = 'custom';
            if (row.source === this.SOURCE_DANBOORU) key = 'danbooru';
            if (row.source === this.SOURCE_E621) key = 'e621';
            bodies[key] = { body: row.body };
        });

        const primaryBody = this.selectPrimaryBody(bodies);
        if (!primaryBody) continue;

        const titleKey = (tag.title || tag.name || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
        const bodyKey = this.stripWikiFormattingForPreview(primaryBody, 2000).replace(/[^a-z0-9]/gi, '').toLowerCase();
        if (!bodyKey || bodyKey === titleKey || bodyKey.length < 3) continue;

        tag.primaryBody = this.stripWikiFormattingForPreview(primaryBody);
    }

    return tags;
}

    async buildBodiesForTag(tagId) {
    if (!tagId) return null;
    
    const { getBodiesByTag } = this.getStatements();
    const rows = await this.db.all(getBodiesByTag, [tagId]);
    if (!rows || rows.length === 0) return null;

    const hasSummary = rows.some(row => row.source === this.SOURCE_CUSTOM);
    const filtered = hasSummary ? rows.filter(row => row.source === this.SOURCE_CUSTOM) : rows;
    const bodies = {};

    filtered.forEach(row => {
        let key = 'custom';
        if (row.source === this.SOURCE_DANBOORU) key = 'danbooru';
        if (row.source === this.SOURCE_E621) key = 'e621';
        bodies[key] = {
            body: row.body,
            totalLength: row.body ? row.body.length : 0,
            wikiId: row.wiki_id || null,
            fetchedOnline: !!row.fetched_online
        };
    });

    return Object.keys(bodies).length > 0 ? bodies : null;
}

/**
 * Get wiki body text directly for a tag
 * @param {number} tagId - Tag ID
 * @param {number} sourceId - Source ID (this.SOURCE_DANBOORU=1, this.SOURCE_E621=2)
 * @returns {Promise<string|null>} Body text or null if not found
 */
    async getTagWikiBody(tagId, sourceId) {
    if (!tagId || !this.db) return null;
    
    const statements = this.getStatements();
    const bodyRow = await this.db.get(statements.getBodyBySource, [tagId, sourceId]);
    
    if (bodyRow && bodyRow.body) {
        // Return body with metadata about whether it was fetched online
        return {
            body: bodyRow.body,
            fetchedOnline: !!bodyRow.fetched_online
        };
    }
    
    return null;
}

    async getWikiByTitleAndSource(title, sourceId) {
        if (!title || !this.db) return null;
        
        const statements = this.getStatements();
        for (const variant of this.getWikiTitleLookupVariants(title)) {
            const wikiRow = await this.db.get(statements.getWikiByTitleAndSource, [variant, sourceId]);
            if (wikiRow && wikiRow.body) {
                return {
                    body: wikiRow.body,
                    fetchedOnline: !!wikiRow.fetched_online,
                    wikiId: wikiRow.id
                };
            }
        }
        
        return null;
    }

/**
 * Get wiki ID for a tag and source
 * @param {number} tagId - Tag ID
 * @param {number} sourceId - Source ID (this.SOURCE_DANBOORU=1, this.SOURCE_E621=2)
 * @returns {Promise<number|null>} Wiki ID or null if not found
 */
    async getWikiIdForTag(tagId, sourceId) {
    if (!tagId || !this.db) return null;
    
    const statements = this.getStatements();
    const wikiIdRow = await this.db.get(statements.getWikiIdForTag, [tagId, sourceId]);
    
    if (wikiIdRow) {
        return {
            id: wikiIdRow.id,
            fetchedOnline: !!wikiIdRow.fetched_online
        };
    }
    
    return null;
}

    async fetchOtherNames(tagId) {
    if (!tagId) return [];
    
    const { getOtherNames } = this.getStatements();
    const rows = await this.db.all(getOtherNames, [tagId]);
    return rows.map(row => row.other_name.replace(/_/g, ' '));
}

    async fetchLinks(tagId, direction = 'to', resolve = false) {
    if (!tagId) return [];
    
    const statements = this.getStatements();
    const rows = direction === 'to'
        ? await this.db.all(statements.getLinksFrom, [tagId])
        : await this.db.all(statements.getLinksTo, [tagId]);

    if (!resolve) {
        return rows.map(row => row.title);
    }

    return rows.map(row => ({
        title: row.title,
        usage: this.getUsageCount(row),
        category: row.category,
        categoryName: this.getCategoryName(row.category)
    }));
}

    async fetchTagGroups(tagId) {
    if (!tagId) return [];
    
    const { getTagGroupNames } = this.getStatements();
    const rows = await this.db.all(getTagGroupNames, [tagId]);
    return rows.map(row => {
        const name = (row.name || '').replace(/_/g, ' ');
        const path = row.path || null;
        const label = path && name ? `${name} (${path})` : (name || path || '');
        return {
            name,
            path,
            label
        };
    });
}

    async fetchTagGroupPages(tagId, tagTitle = '', options = {}) {
    if (!tagId && !tagTitle) return [];
    
    const statements = this.getStatements();
    const limit = Math.max(5, Math.min(options.limit || 50, 100));
    const seenIds = new Set();
    const seenTitles = new Set();
    const results = [];

    const pushRow = (row) => {
        if (!row || !row.title) {
            return;
        }
        if (row.id) {
            const key = `id:${row.id}`;
            if (seenIds.has(key)) {
                return;
            }
            seenIds.add(key);
        } else {
            const titleKey = row.title.toLowerCase();
            if (seenTitles.has(titleKey)) {
                return;
            }
            seenTitles.add(titleKey);
        }
        const formatted = this.formatWikiPageTitle(row.title);
        if (formatted) {
            results.push(formatted);
        }
    };

    const searchTerms = new Set();
    const addSearchTerm = (value) => {
        if (!value) return;
        const term = value.replace(/ /g, '_');
        searchTerms.add(term.toLowerCase());
    };

    addSearchTerm(tagTitle);
    if (tagId) {
        const aliases = await this.fetchOtherNames(tagId);
        aliases.forEach(alias => addSearchTerm(alias.replace(/_/g, ' ')));
    }

    if (searchTerms.size === 0) {
        return results;
    }

    for (const term of searchTerms) {
        const escaped = this.escapeLikePattern(term);
        const bodyPatterns = [
            `%[[${escaped}%`,
            `%|${escaped}%`,
            `%${escaped}%`
        ];
        for (const pattern of bodyPatterns) {
            const rows = await this.db.all(statements.searchGroupPagesByBody, [pattern, limit]) || [];
            rows.forEach(pushRow);
        }
        const titlePattern = `%${escaped}%`;
        const titleRows = await this.db.all(statements.searchGroupPagesByTitle, [titlePattern, limit]) || [];
        titleRows.forEach(pushRow);
    }

    return results.slice(0, limit);
}

    async fetchTagWikiMentions(tagId, limit = 50) {
    if (!tagId) return [];
    
    const { getWikisTagAppearsIn, getTagsInWiki, getTagIdForWiki, findWikiPageByWikiId, getTagById, getWikiPagesReferencingTag, getWikiPageById } = this.getStatements();
    
    // Return objects with title and relationship instead of just titles
    const results = new Map(); // tagId -> { title, relationship }
    const seenTagIds = new Set([tagId]); // Don't include the tag itself
    const processedWikiIds = new Set(); // Track processed wikis to avoid duplicates
    
    // Method 1: Use indexed tag_wiki_links to find all wikis where this tag appears
    // This includes both tagged and untagged wikis that mention the tag
    // Uses idx_tag_wiki_links_tag index - fast!
    const wikis = await this.db.all(getWikisTagAppearsIn, [tagId]);
    
    for (const wiki of wikis) {
        if (processedWikiIds.has(wiki.id)) continue;
        processedWikiIds.add(wiki.id);
        
        // For each wiki, find all tags that appear in it (using indexed tag_wiki_links)
        // This uses idx_tag_wiki_links_wiki index - fast!
        // getTagsInWiki returns tags with relationship field
        const tagsInWiki = await this.db.all(getTagsInWiki, [wiki.id]);
        
        for (const tagInWiki of tagsInWiki) {
            // Skip the tag itself
            if (tagInWiki.id === tagId || seenTagIds.has(tagInWiki.id)) continue;
            // Store with relationship and tagId (default to 0 if not present)
            const relationship = tagInWiki.relationship !== undefined ? tagInWiki.relationship : 0;
            results.set(tagInWiki.id, { title: tagInWiki.title, relationship, tagId: tagInWiki.id });
            seenTagIds.add(tagInWiki.id);
        }
        
        // Check if this wiki is linked to a tag (tagged wiki) - uses idx_tag_wikis_wiki_id index
        const tagWikiRow = await this.db.get(getTagIdForWiki, [wiki.id]);
        if (tagWikiRow && tagWikiRow.tag_id && tagWikiRow.tag_id !== tagId && !seenTagIds.has(tagWikiRow.tag_id)) {
            const linkedTag = await this.db.get(getTagById, [tagWikiRow.tag_id]);
            if (linkedTag && linkedTag.title) {
                // Tagged wiki has relationship 0 (appears) by default
                results.set(tagWikiRow.tag_id, { title: linkedTag.title, relationship: 0, tagId: tagWikiRow.tag_id });
                seenTagIds.add(tagWikiRow.tag_id);
            }
        }
        
        // Don't add untagged wiki page titles - they're not tags
    }
    
    // Method 2: Also check wiki_page_links for untagged wikis that reference this tag
    // This catches cases where wiki_page_links were created but tag_wiki_links might not exist
    // Uses idx_wiki_page_links_tag index - fast!
    const wikiPagesReferencingTag = await this.db.all(getWikiPagesReferencingTag, [tagId, limit]);
    for (const wikiPage of wikiPagesReferencingTag) {
        // Get wiki IDs from the wiki page
        const pageRow = await this.db.get(getWikiPageById, [wikiPage.id]);
        if (!pageRow) continue;
        
        // Process each wiki (danbooru and/or e621) linked to this page
        const wikiIds = [];
        if (pageRow.danbooru_wiki_id) wikiIds.push(pageRow.danbooru_wiki_id);
        if (pageRow.e621_wiki_id) wikiIds.push(pageRow.e621_wiki_id);
        
        for (const wikiId of wikiIds) {
            if (processedWikiIds.has(wikiId)) continue;
            processedWikiIds.add(wikiId);
            
            // Get all tags that appear in this untagged wiki (using indexed tag_wiki_links)
            // This uses idx_tag_wiki_links_wiki index - fast!
            const tagsInWiki = await this.db.all(getTagsInWiki, [wikiId]);
            for (const tagInWiki of tagsInWiki) {
                if (tagInWiki.id === tagId || seenTagIds.has(tagInWiki.id)) continue;
                const relationship = tagInWiki.relationship !== undefined ? tagInWiki.relationship : 0;
                results.set(tagInWiki.id, { title: tagInWiki.title, relationship, tagId: tagInWiki.id });
                seenTagIds.add(tagInWiki.id);
            }
            
            // Also check if this wiki is linked to a tag (in case it's both tagged and in wiki_pages)
            const tagWikiRow = await this.db.get(getTagIdForWiki, [wikiId]);
            if (tagWikiRow && tagWikiRow.tag_id && tagWikiRow.tag_id !== tagId && !seenTagIds.has(tagWikiRow.tag_id)) {
                const linkedTag = await this.db.get(getTagById, [tagWikiRow.tag_id]);
                if (linkedTag && linkedTag.title) {
                    results.set(tagWikiRow.tag_id, { title: linkedTag.title, relationship: 0, tagId: tagWikiRow.tag_id });
                    seenTagIds.add(tagWikiRow.tag_id);
                }
            }
        }
    }

    return Array.from(results.values()).slice(0, limit);
}

    async tagHasGroups(tagId) {
    if (!tagId) return false;
    if (this.tagGroupPresenceCache.has(tagId)) {
        return this.tagGroupPresenceCache.get(tagId);
    }
    
    const { hasTagGroups } = this.getStatements();
    const row = await this.db.get(hasTagGroups, [tagId]);
    const result = Boolean(row);
    this.tagGroupPresenceCache.set(tagId, result);
    return result;
}

    getCategoryAdjustment(row, options = {}) {
    const title = (row.title || '').trim();
    const multiWordTitle = /\s+/.test(title);
    const categoryName = this.getCategoryName(row.category);
    const hasGroups = options.hasGroups === true;
    const usage = options.usage || 0;
    const novelStrength = options.novelStrength || 0;
    let adjustment = 0;

    if (categoryName === 'Uncategorized') {
        adjustment -= multiWordTitle ? 80 : 320;
        if (!multiWordTitle && usage < 5000 && novelStrength < 1500) {
            adjustment -= 200;
        }
    }

    if ((categoryName === 'General' || categoryName === 'Meta') && !hasGroups) {
        adjustment -= 90;
        if (usage < 10000 && novelStrength < 2000) {
            adjustment -= 60;
        }
    }

    return adjustment;
}

    async fetchGroupMembers(pageId, limit = 20) {
    if (!pageId) return [];
    
    const { getGroupMembers } = this.getStatements();
    const rows = await this.db.all(getGroupMembers, [pageId, limit]);
    return rows.map(row => this.mapRowToTag(row)).filter(Boolean);
}

    async mapGroupPageToResult(page, searchTerm = '', memberLimit = 20) {
    if (!page || !page.id || !page.title) {
        return null;
    }
    const rawTitle = this.formatWikiPageTitle(page.title);
    const displayTitle = rawTitle.replace(/^tag_group:\s*/i, '').trim() || rawTitle;
    const members = (await this.fetchGroupMembers(page.id, memberLimit)).map(member => member.title).filter(Boolean);
    const result = {
        id: `group_${page.id}`,
        isGroup: true,
        title: rawTitle,
        displayTitle,
        category: page.category,
        categoryName: 'Tag Group',
        d_count: 0,
        e_count: 0,
        n_count: 0,
        groups: [{ label: rawTitle }],
        otherNames: [],
        groupMembers: members
    };

    if (page.body && page.body.trim().length > 0) {
        const processed = await this.processTagBody(rawTitle, page.body, searchTerm, 300);
        if (processed) {
            const sourceKey = (page.source && page.source.toLowerCase() === 'e621') ? 'e621' : 'danbooru';
            result.body = {
                [sourceKey]: {
                    body: processed.body,
                    truncated: processed.bodyTruncated || false,
                    totalLength: processed.bodyTotalLength || null,
                    preview: processed.bodyPreview || false,
                    memory: processed.bodyMemory || null,
                    memoryDescription: processed.bodyMemoryDescription || null,
                    sameAsTitle: processed.bodySameAsTitle || false,
                    source: sourceKey,
                    label: sourceKey === 'e621' ? 'e621' : 'Danbooru',
                    bodyTotalLines: processed.bodyTotalLines || null,
                    bodyPreviewLines: processed.bodyPreviewLines || null
                }
            };
        }
    }

    return result;
}

    async searchTagGroupsByTitle(searchTerm, limit = 5) {
    if (!searchTerm) return [];
    
    const statements = this.getStatements();
    const normalized = this.normalizeTagName(searchTerm);
    const likeTerm = `%${normalized}%`;
    const rows = await this.db.all(statements.searchGroupPagesByTitle, [likeTerm, Math.max(limit, 5)]);
    const results = [];
    const seen = new Set();
    for (const row of rows) {
        if (!row || !row.id || seen.has(row.id)) {
            continue;
        }
        const mapped = await this.mapGroupPageToResult(row, searchTerm);
        if (mapped) {
            results.push(mapped);
            seen.add(row.id);
            if (results.length >= limit) {
                break;
            }
        }
    }
    return results;
}

    async searchTagGroupsByKeywords(keywords = [], searchTerm = '', limit = 5) {
    
    const statements = this.getStatements();
    const normalizedKeywords = (keywords.length > 0 ? keywords : [this.normalizeTagName(searchTerm)]).filter(Boolean);
    if (normalizedKeywords.length === 0) {
        return [];
    }
    const scored = new Map();
    for (const word of normalizedKeywords) {
        const likeTerm = `%${word}%`;
        const rows = await this.db.all(statements.searchGroupPagesByBody, [likeTerm, limit * 4]);
        for (const row of rows) {
            if (!row || !row.id) continue;
            const existing = scored.get(row.id) || { row, score: 0 };
            existing.score += 1;
            scored.set(row.id, existing);
        }
    }

    const sorted = Array.from(scored.values()).sort((a, b) => b.score - a.score);
    const results = [];
    const seen = new Set();
    for (const entry of sorted) {
        if (seen.has(entry.row.id)) {
            continue;
        }
        const mapped = await this.mapGroupPageToResult(entry.row, searchTerm);
        if (mapped) {
            results.push(mapped);
            seen.add(entry.row.id);
            if (results.length >= limit) {
                break;
            }
        }
    }
    return results;
}

    dedupeTagsByTitle(tags) {
    const unique = [];
    const seen = new Set();
    for (const tag of tags) {
        if (!tag || !tag.title) continue;
        const key = tag.title.toLowerCase();
        if (!seen.has(key)) {
            seen.add(key);
            unique.push(tag);
        }
    }
    return unique;
}

    async enrichTag(tag, options = {}) {
    const enriched = { ...tag };

    if (options.includeBodies) {
        const bodies = await this.buildBodiesForTag(tag.id);
        if (bodies) {
            enriched.bodies = bodies;
            enriched.primaryBody = this.selectPrimaryBody(bodies);
        }
    }

    if (options.includeOtherNames) {
        const otherNames = await this.fetchOtherNames(tag.id);
        enriched.other_names = otherNames;
        enriched.otherNames = otherNames;
    }

    if (options.includeLinks) {
        enriched.linksTo = await this.fetchLinks(tag.id, 'to', options.resolveLinks);
        enriched.linkedBy = await this.fetchLinks(tag.id, 'by', options.resolveLinks);
    }

    if (options.includeGroups !== false) {
        enriched.groups = await this.fetchTagGroups(tag.id);
    }

    const tagGroupPages = await this.fetchTagGroupPages(tag.id, tag.title || tag.name);
    let tagWikiMentions = await this.fetchTagWikiMentions(tag.id);
    if (tagGroupPages.length > 0) {
        const groupSet = new Set(tagGroupPages.map(name => name.toLowerCase()));
        // tagWikiMentions is now an array of { title, relationship } objects
        tagWikiMentions = tagWikiMentions.filter(mention => {
            const name = typeof mention === 'string' ? mention : mention.title;
            return !groupSet.has((name || '').toLowerCase());
        });
    }

    enriched.tagGroupPages = tagGroupPages;
    // Convert to array of titles for backwards compatibility
    enriched.tagWikiMentions = tagWikiMentions.map(mention => typeof mention === 'string' ? mention : mention.title);

    return enriched;
}

    /**
     * Enrich multiple tags with wiki source information in a single query
     * @param {Array<Object>} tags - Array of tag objects with id property
     * @returns {Array<Object>} Tags enriched with wiki sources
     */
    async enrichTagsWithWikiSources(tags) {
        if (!tags || tags.length === 0) return tags;
        
        const tagIds = tags.map(t => t.id).filter(Boolean);
        if (tagIds.length === 0) return tags;
        
        // Build IN clause with placeholders
        const placeholders = tagIds.map(() => '?').join(',');
        const query = `
            SELECT tw.tag_id, w.source
            FROM tag_wikis tw
            INNER JOIN wikis w ON w.id = tw.wiki_id
            WHERE tw.tag_id IN (${placeholders})
            ORDER BY tw.tag_id, w.source
        `;
        
        const wikiSources = await this.db.all(query, tagIds);
        
        // Group sources by tag_id
        const sourcesByTagId = new Map();
        for (const row of wikiSources) {
            if (!sourcesByTagId.has(row.tag_id)) {
                sourcesByTagId.set(row.tag_id, []);
            }
            const sourceName = row.source === this.SOURCE_DANBOORU ? 'danbooru' : 
                              row.source === this.SOURCE_E621 ? 'e621' : 'custom';
            sourcesByTagId.get(row.tag_id).push(sourceName);
        }
        
        // Enrich tags with sources
        return tags.map(tag => {
            const sources = sourcesByTagId.get(tag.id) || [];
            return {
                ...tag,
                wikiSources: sources,
                hasWiki: sources.length > 0
            };
        });
    }

    async buildBodyPreviewMap(tag, searchTerm) {
    if (!tag || !tag.bodies) return null;
    const previews = {};

    for (const [source, bodyInfo] of Object.entries(tag.bodies)) {
        if (!bodyInfo || !bodyInfo.body) continue;
        const processed = await this.processTagBody(tag.title, bodyInfo.body, searchTerm, 250);
        if (processed) {
            const meta = this.getBodySourceMeta(source);
            // Use pre-indexed sections from database if available
            // Determine source from bodyInfo or default to danbooru
            const bodySource = source === 'e621' ? 'e621' : 'danbooru';
            const { sections } = await this.extractWikiSections(bodyInfo.body, bodyInfo.wikiId || null, bodySource);
            const sectionSummary = sections.slice(0, this.MAX_SECTION_SUMMARY).map(section => ({
                title: section.title,
                anchor: section.anchor,
                level: section.level
            }));
            previews[source] = {
                body: processed.body,
                truncated: processed.bodyTruncated || false,
                totalLength: processed.bodyTotalLength || null,
                preview: processed.bodyPreview || false,
                memory: processed.bodyMemory || null,
                memoryDescription: processed.bodyMemoryDescription || null,
                sameAsTitle: processed.bodySameAsTitle || false,
                source: meta.chunkSource,
                label: meta.label,
                bodyTotalLines: processed.bodyTotalLines || null,
                bodyPreviewLines: processed.bodyPreviewLines || null,
                sections: sectionSummary,
                totalSections: sections.length
            };
        }
    }

    return Object.keys(previews).length > 0 ? previews : null;
}

    async projectTagResult(tag, returnFields = [], resolveLinks = false, searchTerm = '') {
    const needsAll = returnFields.length === 0;
    const includeBodies = true;
    const includeOtherNames = needsAll || returnFields.includes('otherNames');
    const includeLinks = needsAll || returnFields.includes('linksTo') || returnFields.includes('linkedBy');

    const enriched = await this.enrichTag(tag, {
        includeBodies,
        includeOtherNames,
        includeLinks,
        resolveLinks
    });

    const bodyPreviews = await this.buildBodyPreviewMap(enriched, searchTerm);

    if (needsAll) {
        if (bodyPreviews) {
            enriched.body = bodyPreviews;
        }
        if (enriched.other_names) {
            delete enriched.other_names;
        }
        return enriched;
    }

    const baseResult = {
        title: enriched.title,
        name: enriched.name,
        category: enriched.category,
        categoryName: enriched.categoryName,
        d_count: enriched.d_count || 0,
        e_count: enriched.e_count || 0,
        n_count: enriched.n_count || 0,
        groups: enriched.groups || [],
        otherNames: enriched.otherNames || [],
        tagGroupPages: enriched.tagGroupPages || [],
        tagWikiMentions: enriched.tagWikiMentions || []
    };

    const result = { ...baseResult };
    for (const field of returnFields) {
        switch (field) {
            case 'title':
                result.title = enriched.title;
                break;
            case 'category':
                result.category = enriched.category;
                result.categoryName = enriched.categoryName;
                break;
            case 'usage':
                result.usage = enriched.n;
                break;
            case 'body':
                result.body = bodyPreviews;
                break;
            case 'linksTo':
                result.linksTo = enriched.linksTo || [];
                break;
            case 'linkedBy':
                result.linkedBy = enriched.linkedBy || [];
                break;
            case 'otherNames':
                result.otherNames = enriched.otherNames || [];
                break;
            case 'id':
                result.id = enriched.id;
                break;
            case 'counts':
                result.d_count = enriched.d_count;
                result.e_count = enriched.e_count;
                result.n_count = enriched.n_count;
                break;
        }
    }

    if (!returnFields.includes('body') && bodyPreviews) {
        result.body = bodyPreviews;
    }

    return result;
}

    getBodySourceMeta(sourceKey) {
    switch (sourceKey) {
        case 'custom':
            return { label: 'Summary', chunkSource: 'summary' };
        case 'danbooru':
            return { label: 'Danbooru', chunkSource: 'danbooru' };
        case 'e621':
            return { label: 'e621', chunkSource: 'e621' };
        default:
            return { label: sourceKey, chunkSource: sourceKey };
    }
}

    resolveBodySourceId(bodySource) {
    if (!bodySource) return null;
    const normalized = bodySource.toLowerCase();
    if (normalized === 'danbooru') return this.SOURCE_DANBOORU;
    if (normalized === 'e621') return this.SOURCE_E621;
    if (normalized === 'custom' || normalized === 'summary') return this.SOURCE_CUSTOM;
    return null;
}

    extractKeywords(description) {
    const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'from', 'by', 'as', 'is', 'are', 'was', 'were']);
    const tokens = description
        .toLowerCase()
        .replace(/[,:;]/g, ' ')
        .split(/[\s\-]+/)
        .filter(w => w.length > 2 && !stopWords.has(w));
    return tokens;
}

    formatCountCell(value) {
    if (value === undefined || value === null) return '-';
    const num = Number(value);
    if (Number.isNaN(num) || num === 0) return '-';
    return num.toLocaleString();
}

    formatNovelAIPercentage(value) {
    if (value === undefined || value === null) return '-';
    const num = Number(value);
    if (Number.isNaN(num) || num <= 0) return '-';
    const clamped = Math.min(10000, Math.max(1, num));
    const percent = Math.round((Math.log10(clamped + 1) / Math.log10(10000 + 1)) * 100);
    return `${percent}%`;
}

    formatTagTitle(tag) {
    return tag.displayTitle || tag.title || tag.searchTerm || '-';
}

    formatGroupEntries(groups = []) {
    if (!Array.isArray(groups)) return [];
    return groups
        .map(group => {
            if (!group) return null;
            if (typeof group === 'string') {
                return {
                    name: group,
                    path: null,
                    label: group
                };
            }
            const name = group.name || group.path || '';
            const path = group.path || null;
            const label = path && name
                ? `${name} (${path})`
                : (name || path || '');
            return {
                ...group,
                name,
                path,
                label
            };
        })
        .filter(Boolean);
}

    formatWikiPageTitle(title = '') {
    if (!title) return '';
    const trimmed = title.trim();
    if (!trimmed) return '';
    const lower = trimmed.toLowerCase();
    if (lower.startsWith('tag_group:') || lower.startsWith('tag group:')) {
        const suffixStart = trimmed.indexOf(':') + 1;
        const suffixRaw = suffixStart > 0 ? trimmed.slice(suffixStart) : '';
        const normalizedSuffix = suffixRaw.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
        const prefix = 'tag_group:';
        return normalizedSuffix ? `${prefix}${normalizedSuffix}` : prefix;
    }
    return trimmed.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
}

    getPrimaryGroupLabel(tag) {
    const entries = this.formatGroupEntries(tag.groups);
    return entries.length > 0 ? entries[0].label : null;
}

    formatOtherNames(tag) {
    if (!tag || !Array.isArray(tag.otherNames) || tag.otherNames.length === 0) {
        return null;
    }
    const uniqueNames = Array.from(new Set(tag.otherNames)).filter(Boolean);
    if (!uniqueNames.length) {
        return null;
    }
    const display = uniqueNames.slice(0, 10).join(', ');
    const extra = uniqueNames.length > 10 ? ` (+${uniqueNames.length - 10})` : '';
    return `${display}${extra}`;
}

    async hasWikiContent(tag) {
    if (!tag) return false;
    // Fast check: if tag has id, check database directly without loading body
    if (tag.id) {
        try {
            
            const { hasWikiForTag } = this.getStatements();
            const row = await this.db.get(hasWikiForTag, [tag.id]);
            if (row) return true;
        } catch (e) {
            // Fall through to slower checks if query fails
        }
    }
    // Slower checks (for tags that already have bodies loaded)
    if (tag.bodyMemory) return true;
    if (tag.primaryBody) return true;
    if (tag.bodies && Object.keys(tag.bodies).length > 0) return true;
    if (tag.body && typeof tag.body === 'object' && Object.keys(tag.body).length > 0) return true;
    if (typeof tag.body === 'string' && tag.body.trim().length > 0) return true;
    return false;
}

    formatCategoryCell(tag) {
    const category = (tag.categoryName || '').trim();
    const primaryGroup = this.getPrimaryGroupLabel(tag);
    if (!category) {
        return primaryGroup || '-';
    }
    const lower = category.toLowerCase();
    if (lower === 'general' || lower === 'meta') {
        return primaryGroup || category;
    }
    if (primaryGroup) {
        return `${category} (${primaryGroup})`;
    }
    return category;
}

    orderBodyPreviewEntries(previewMap) {
    const order = { custom: 0, summary: 0, danbooru: 1, e621: 2 };
    return Object.entries(previewMap).sort((a, b) => {
        const orderA = order[a[0]] ?? 99;
        const orderB = order[b[0]] ?? 99;
        return orderA - orderB;
    });
}

    appendSectionSummaryLines(targetLines, sections, totalSections) {
    if (!Array.isArray(sections) || sections.length === 0) {
        return;
    }
    const normalizedTotal = typeof totalSections === 'number' ? totalSections : sections.length;
    const minLevel = sections.reduce((min, section) => {
        if (!section || typeof section.level !== 'number') return min;
        return Math.min(min, section.level);
    }, Infinity);
    const baseLevel = Number.isFinite(minLevel) ? minLevel : 1;
    const summaryLabel = normalizedTotal > sections.length
        ? `Sections (${sections.length} of ${normalizedTotal}):`
        : `Sections (${sections.length}):`;
    targetLines.push(summaryLabel);
    
    // Helper to clean section title (remove [SECTION:...] markers and simplify)
    const cleanSectionTitle = (title) => {
        if (!title) return '';
        // Remove [SECTION:...] markers
        let cleaned = title.replace(/\[SECTION:([^\]]+)\]/gi, '$1');
        // Remove markdown formatting
        cleaned = cleaned.replace(/^#+\s*/, '').trim();
        return cleaned;
    };
    
    sections.forEach(section => {
        if (!section || !section.title) return;
        // Use section_index (0-based) + 1 for display (1-based)
        // If section.index is not available, use array index + 1
        const sectionNum = (typeof section.index === 'number' ? section.index : sections.indexOf(section)) + 1;
        const cleanedTitle = cleanSectionTitle(section.title);
        const effectiveLevel = (section.level || baseLevel) - baseLevel;
        const indent = '  '.repeat(Math.max(0, effectiveLevel));
        targetLines.push(`${indent}${sectionNum}. ${cleanedTitle}`);
    });
    if (normalizedTotal > sections.length) {
        targetLines.push(`- ... ${normalizedTotal - sections.length} more`);
    }
}

    async formatBodyPreviewBlock(tag) {
    const lines = [];
    const title = this.formatTagTitle(tag);
    const chunkTitle = tag.title || tag.searchTerm || 'Unknown';
    lines.push(`\n### ${title}`);

    if (Array.isArray(tag.groupMembers) && tag.groupMembers.length > 0) {
        const displayMembers = tag.groupMembers.slice(0, 10).join(', ');
        const extraMembers = tag.groupMembers.length > 10 ? ` (+${tag.groupMembers.length - 10})` : '';
        lines.push(`**Related Tags:** ${displayMembers}${extraMembers}`);
    }
    const otherNamesText = this.formatOtherNames(tag);
    if (otherNamesText) {
        lines.push(`**Also known as:** ${otherNamesText}`);
    }
    if (Array.isArray(tag.tagGroupPages) && tag.tagGroupPages.length > 0) {
        const displayGroups = tag.tagGroupPages.slice(0, 5).join(', ');
        const extraGroups = tag.tagGroupPages.length > 5 ? ` (+${tag.tagGroupPages.length - 5})` : '';
        lines.push(`**Tag Groups:** ${displayGroups}${extraGroups}`);
    }
    // Always try to get sorted mentions if we have a tag ID
    const tagId = tag.id;
    if (tagId) {
        const wikiMentions = await this.fetchTagWikiMentions(tagId);
        if (wikiMentions && wikiMentions.length > 0) {
            const tagTitle = tag.title || '';
            const { getTagById } = this.getStatements();
            
            // Extract "not to be confused" first (relationship 3)
            const notToBeConfused = wikiMentions
                .filter(mention => mention.relationship === 3)
                .map(mention => mention.title);
            
            // Helper function to extract words from a title, handling parentheses
            const extractWords = (title) => {
                const words = [];
                // Remove parentheses and extract their content as separate words
                const withoutParens = title.replace(/\(([^)]+)\)/g, (match, content) => {
                    // Add words from inside parentheses
                    const parenWords = content.trim().split(/\s+/).filter(w => w.length > 0);
                    words.push(...parenWords.map(w => w.toLowerCase()));
                    return ''; // Remove parentheses from title
                });
                // Add words from outside parentheses
                const mainWords = withoutParens.split(/\s+/).filter(w => w.length > 0);
                words.push(...mainWords.map(w => w.toLowerCase()));
                return words;
            };
            
            // Extract base words (with parentheses handling)
            const baseWords = extractWords(tagTitle);
            
            // Handle the rest (exclude relationship 3)
            const mentionsWithOverlap = wikiMentions
                .filter(mention => mention.relationship !== 3)
                .map(mention => {
                    // Extract mention words (with parentheses handling)
                    const mentionWords = extractWords(mention.title);
                    
                    // Calculate overlap using full word matching (not substring)
                    const baseWordsSet = new Set(baseWords);
                    const mentionWordsSet = new Set(mentionWords);
                    
                    let overlapScore = 0;
                    // Count exact word matches
                    for (const word of baseWordsSet) {
                        if (mentionWordsSet.has(word)) {
                            // Add score based on word length (longer words = more important)
                            overlapScore += word.length * 2;
                        }
                    }
                    
                    // Also check for phrase matches (consecutive words)
                    // Check if base words appear consecutively in mention
                    const basePhrase = baseWords.join(' ');
                    const mentionPhrase = mentionWords.join(' ');
                    if (mentionPhrase.includes(basePhrase) || basePhrase.includes(mentionPhrase)) {
                        overlapScore += basePhrase.length;
                    }
                    
                    // Relationship deranking: 2 (replaces) > 0 (appears) > 1 (related)
                    let relationshipDerank = 0;
                    if (mention.relationship === 1) relationshipDerank = 1000;
                    else if (mention.relationship === 0) relationshipDerank = 100;
                    else if (mention.relationship === 2) relationshipDerank = 0;
                    
                    return {
                        title: mention.title,
                        overlapScore: overlapScore - relationshipDerank
                    };
                })
                .sort((a, b) => b.overlapScore - a.overlapScore);
            
            // Display sorted mentions
            if (mentionsWithOverlap.length > 0) {
                const displayMentions = mentionsWithOverlap.slice(0, 5).map(m => m.title).join(', ');
                const extraMentions = mentionsWithOverlap.length > 5 ? ` (+${mentionsWithOverlap.length - 5})` : '';
                lines.push(`**Mentioned in:** ${displayMentions}${extraMentions}`);
            }
            
            // Display not_to_be_confused if any
            if (notToBeConfused.length > 0) {
                lines.push(`**Not to be confused with:** ${notToBeConfused.join(', ')}`);
            }
        } else if (Array.isArray(tag.tagWikiMentions) && tag.tagWikiMentions.length > 0) {
            // Fallback to simple list if fetchTagWikiMentions returns nothing
            const displayMentions = tag.tagWikiMentions.slice(0, 5).join(', ');
            const extraMentions = tag.tagWikiMentions.length > 5 ? ` (+${tag.tagWikiMentions.length - 5})` : '';
            lines.push(`**Mentioned in:** ${displayMentions}${extraMentions}`);
        }
    } else if (Array.isArray(tag.tagWikiMentions) && tag.tagWikiMentions.length > 0) {
        // Fallback if no tag ID
        const displayMentions = tag.tagWikiMentions.slice(0, 5).join(', ');
        const extraMentions = tag.tagWikiMentions.length > 5 ? ` (+${tag.tagWikiMentions.length - 5})` : '';
        lines.push(`**Mentioned in:** ${displayMentions}${extraMentions}`);
    }

    const finalize = () => {
        return lines.join('\n');
    };

    const previewMap = tag.body && typeof tag.body === 'object' ? tag.body : null;
    if (previewMap && Object.keys(previewMap).length > 0) {
        const orderedPreviews = this.orderBodyPreviewEntries(previewMap);
        orderedPreviews.forEach(([sourceKey, preview]) => {
            if (!preview) return;
            const metaDefaults = this.getBodySourceMeta(sourceKey);
            const meta = {
                label: preview.label || metaDefaults.label,
                chunkSource: preview.source || metaDefaults.chunkSource
            };
            if (preview.memory) {
                if (preview.memoryDescription) {
                    lines.push(`\n**${meta.label}:**`);
                    lines.push(`> ${preview.memoryDescription}`);
                }
                lines.push(`Memory: \`${preview.memory}\` | \`getBodyChunk("${chunkTitle}", 0, "${meta.chunkSource}")\``);
                return;
            }
            if (preview.body && preview.body.trim().length > 0) {
                lines.push(`\n**${meta.label}:**`);
                const bodyLines = preview.body.split('\n');
                const previewLines = [];
                let charCount = 0;
                for (let i = 0; i < bodyLines.length; i++) {
                    const line = bodyLines[i];
                    if (!line) continue;
                    const nextLength = charCount + line.length;
                    if ((previewLines.length < 3 && nextLength <= 500) || (previewLines.length < 3 && charCount === 0)) {
                        previewLines.push(`> ${line}`);
                        charCount += line.length;
                    } else if (previewLines.length >= 3 && nextLength <= 500) {
                        previewLines.push(`> ${line}`);
                        charCount += line.length;
                    } else {
                        break;
                    }
                }
                const isTruncated = preview.truncated || preview.preview;
                if (isTruncated) {
                    if (previewLines.length === 0) {
                        previewLines.push(`> ... [truncated]`);
                    } else {
                        const lastIndex = previewLines.length - 1;
                        if (!previewLines[lastIndex].endsWith(' ... [truncated]')) {
                            previewLines[lastIndex] = `${previewLines[lastIndex]} ... [truncated]`;
                        }
                    }
                }
                lines.push(...previewLines);

                if (isTruncated) {
                    const displayedLines = preview.bodyPreviewLines || previewLines.length;
                    const totalLines = preview.bodyTotalLines || previewLines.length;
                    const remainingLines = Math.max(totalLines - previewLines.length, 0);
                    const chunkCall = `\`getBodyChunk("${chunkTitle}", 0, "${meta.chunkSource}")\``;
                    if (remainingLines > 0) {
                        lines.push(`... ${remainingLines} more lines via ${chunkCall}`);
                    } else {
                        lines.push(chunkCall);
                    }
                    this.appendSectionSummaryLines(lines, preview.sections, preview.totalSections);
                }
            }
        });
        return finalize();
    }

    if (tag.bodyMemory) {
        const chunkSource = tag.bodyMemorySource || tag.bodySource || 'summary';
        if (tag.bodyMemoryDescription) {
            lines.push(`\n> ${tag.bodyMemoryDescription}`);
        }
        lines.push(`Memory: \`${tag.bodyMemory}\` | \`getBodyChunk("${chunkTitle}", 0, "${chunkSource}")\``);
        return finalize();
    }

    if (typeof tag.body === 'string' && tag.body.trim().length > 0) {
        lines.push(`\n**Description:**`);
        const bodyLines = tag.body.split('\n');
        const previewLines = [];
        let charCount = 0;
        for (let i = 0; i < bodyLines.length; i++) {
            const line = bodyLines[i];
            if (!line) continue;
            const nextLength = charCount + line.length;
            if ((previewLines.length < 3 && nextLength <= 500) || (previewLines.length < 3 && charCount === 0)) {
                previewLines.push(`> ${line}`);
                charCount += line.length;
            } else if (previewLines.length >= 3 && nextLength <= 500) {
                previewLines.push(`> ${line}`);
                charCount += line.length;
            } else {
                break;
            }
        }
        const isTruncated = tag.bodyTruncated || tag.bodyPreview;
        if (isTruncated) {
            if (previewLines.length === 0) {
                previewLines.push(`... [more]`);
            } else {
                const lastIndex = previewLines.length - 1;
                if (!previewLines[lastIndex].endsWith(' ... [more]')) {
                    previewLines[lastIndex] = `${previewLines[lastIndex]} ... [more]`;
                }
            }
        }
        lines.push(...previewLines);
        if (isTruncated) {
            const displayedLines = tag.bodyPreviewLines || previewLines.length;
            const totalLines = tag.bodyTotalLines || previewLines.length;
            const remainingLines = Math.max(totalLines - previewLines.length, 0);
            const chunkSource = tag.bodySource || 'danbooru';
            const chunkCall = `\`getBodyChunk("${chunkTitle}", 0, "${chunkSource}")\``;
            if (remainingLines > 0) {
                lines.push(`... ${remainingLines} more lines via ${chunkCall}`);
            } else {
                lines.push(chunkCall);
            }
            this.appendSectionSummaryLines(lines, tag.bodySections, tag.bodyTotalSections);
        }
        return finalize();
    }

    lines.push(`*No body preview available*`);
    return finalize();
}

    async formatTagCollectionSection(title, tags = [], options = {}) {
    const validTags = tags.filter(tag => tag && !tag.error);
    const lines = [];
    lines.push(`## ${title}`);

    if (validTags.length === 0) {
        if (options.showEmptyMessage !== false) {
            lines.push(`\n*No results found*`);
        }
        return lines.join('\n');
    }

    const displayTags = validTags.slice(0, this.MAX_TABLE_RESULTS);
    const noteParts = [];
    if (options.note) {
        noteParts.push(options.note);
    }
    if (validTags.length > this.MAX_TABLE_RESULTS) {
        noteParts.push(`Showing first ${this.MAX_TABLE_RESULTS} of ${validTags.length}`);
    }
    if (noteParts.length > 0) {
        lines.push(`*${noteParts.join(' | ')}*`);
    }

    lines.push(`\n| # | Tag | Danbooru Count | E621 Count | Training Confidence | Category | Has Wiki? |`);
    lines.push(`|---|-----|----------------|------------|---------------------|----------|-----------|`);
    const dividerIndex = typeof options.topResultDividerIndex === 'number' ? options.topResultDividerIndex : null;
    let dividerInserted = false;
    
    // Await all hasWikiContent checks in parallel
    const wikiChecks = await Promise.all(displayTags.map(tag => this.hasWikiContent(tag)));
    
    displayTags.forEach((tag, index) => {
        lines.push(`| ${index + 1} | ${this.formatTagTitle(tag)} | ${this.formatCountCell(tag.d_count)} | ${this.formatCountCell(tag.e_count)} | ${this.formatNovelAIPercentage(tag.n_count)} | ${this.formatCategoryCell(tag)} | ${wikiChecks[index] ? '✓' : '✗'} |`);
        if (!dividerInserted && dividerIndex !== null && dividerIndex > 0 && (index + 1) === dividerIndex) {
            lines.push('-- ^ TOP KEYWORD MATCHES ^-----');
            dividerInserted = true;
        }
    });

    if (validTags.length > displayTags.length) {
        lines.push(`\n*... ${validTags.length - displayTags.length} more*`);
    }

    const previewLimit = Math.min(options.previewLimit || this.MAX_BODY_PREVIEWS, displayTags.length);
    const previewTargets = displayTags.slice(0, previewLimit);
    const previewBlocks = await Promise.all(previewTargets.map(tag => this.formatBodyPreviewBlock(tag)));
    previewBlocks.forEach(block => {
        lines.push(block);
    });

    return lines.join('\n');
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Returns human-readable category name for a given category ID
 * 
 * @param {number} categoryId - Numeric category identifier
 * @returns {string} Category name
 */
    getCategoryName(categoryId) {
    // Handle numeric categories (danbooru format)
    if (typeof categoryId === 'number') {
        switch(categoryId) {
            case 0: return 'General';
            case 1: return 'Artist';
            case 3: return 'Copyright';
            case 4: return 'Character';
            case 5: return 'Meta';
            case 6: return 'Species';
            default: return 'Uncategorized';
        }
    }

    // Handle string categories (furry format)
    if (typeof categoryId === 'string') {
        switch(categoryId.toLowerCase()) {
            case 'character': return 'Character';
            case 'species': return 'Species';
            case 'copyright': return 'Copyright';
            case 'general': return 'General';
            case 'artist': return 'Artist';
            case 'meta': return 'Meta';
            default: return categoryId.charAt(0).toUpperCase() + categoryId.slice(1); // Capitalize first letter
        }
    }

    return 'Uncategorized';
}

/**
 * Calculates Levenshtein distance between two strings for fuzzy matching
 * 
 * @param {string} str1 - First string to compare
 * @param {string} str2 - Second string to compare
 * @returns {number} Edit distance (0 = identical, higher = more different)
 */
    levenshteinDistance(str1, str2) {
    const len1 = str1.length;
    const len2 = str2.length;
    const matrix = [];
    
    // Initialize matrix
    for (let i = 0; i <= len1; i++) {
        matrix[i] = [i];
    }
    for (let j = 0; j <= len2; j++) {
        matrix[0][j] = j;
    }
    
    // Fill matrix
    for (let i = 1; i <= len1; i++) {
        for (let j = 1; j <= len2; j++) {
            if (str1[i - 1] === str2[j - 1]) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j] + 1,     // deletion
                    matrix[i][j - 1] + 1,     // insertion
                    matrix[i - 1][j - 1] + 1  // substitution
                );
            }
        }
    }
    
    return matrix[len1][len2];
}

/**
 * Checks if a search term matches a tag title using fuzzy and pattern matching
 * 
 * Returns a match score indicating how well the search term matches:
 * - 100: Exact match
 * - 90: Exact match in parentheses or with underscores
 * - 80: Starts with search term
 * - 70: Ends with search term
 * - 60: Contains as whole word (separated by underscores)
 * - 50: Contains as substring
 * - 40-10: Fuzzy match based on Levenshtein distance
 * - 0: No match
 * 
 * @param {string} title - Tag title to search in (lowercase)
 * @param {string} searchTerm - Search term to match (lowercase, normalized)
 * @returns {number} Match score (0-100) or 0 if no match
 */
    getTitleMatchScore(title, searchTerm) {
    // Safety check
    if (!title || !searchTerm) return 0;
    
    // Normalize both for comparison: convert spaces/hyphens/parentheses to underscores
    const normalizedTitle = title.replace(/[\s\-\(\)]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
    const normalizedSearch = searchTerm.replace(/[\s\-\(\)]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
    
    // Exact match (highest priority)
    if (title === searchTerm || normalizedTitle === normalizedSearch) {
        return 100;
    }
    
    // Word boundary match in original title (treats spaces/punctuation as separators)
    if (this.hasWordBoundary(title, searchTerm)) {
        return 95;
    }
    
    // Try with hyphen in title (some tags use hyphens, some use underscores)
    const hyphenTitle = title.replace(/_/g, '-');
    const hyphenSearch = searchTerm.replace(/_/g, '-');
    if (hyphenTitle === searchTerm || hyphenTitle.toLowerCase() === hyphenSearch.toLowerCase()) {
        return 90;
    }
    
    // Check if search term appears in parentheses (e.g., "(nikke)")
    const parenPattern = new RegExp(`\\(${searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`, 'i');
    if (parenPattern.test(title)) {
        return 90;
    }
    
    // Check if title starts with search term (with underscore separator)
    const startsPattern = new RegExp(`^${normalizedSearch}_`, 'i');
    if (startsPattern.test(title)) {
        return 80;
    }
    
    // Check if title ends with search term (with underscore separator)
    const endsPattern = new RegExp(`_${normalizedSearch}$`, 'i');
    if (endsPattern.test(title)) {
        return 70;
    }
    
    // Check if search term appears as whole word separated by underscores (e.g., "_nikke_")
    const wholeWordPattern = new RegExp(`_${normalizedSearch}_`, 'i');
    if (wholeWordPattern.test(title)) {
        return 60;
    }
    
    // Check if title contains the normalized search term as substring
    if (title.includes(normalizedSearch)) {
        return 50;
    }
    
    // Check if title contains search term as substring (case-insensitive)
    if (title.includes(searchTerm)) {
        return 50;
    }
    
    // Fuzzy matching: check for similar strings
    // Extract words from title (split by underscores)
    const titleWords = title.split('_').filter(w => w.length > 0);
    let bestFuzzyScore = 0;
    
    for (const word of titleWords) {
        // Skip fuzzy matching if words are too different in length
        const lengthDiff = Math.abs(word.length - searchTerm.length);
        if (lengthDiff > Math.max(searchTerm.length * 0.5, 3)) {
            continue;
        }
        
        // Calculate similarity
        const distance = this.levenshteinDistance(word, searchTerm);
        const maxLen = Math.max(word.length, searchTerm.length);
        const similarity = (1 - distance / maxLen) * 100;
        
        // Only consider matches with >70% similarity
        if (similarity > 70 && similarity > bestFuzzyScore) {
            bestFuzzyScore = Math.round(similarity * 0.4); // Scale fuzzy matches lower
        }
    }
    
    return bestFuzzyScore;
}

// ============================================================================
// Search Functions
// ============================================================================

/**
 * Searches through tag data and returns matching tags with fuzzy matching
 * 
 * @param {Object<string, Object>} data - Tag database object with tags as values
 * @param {string} searchTerm - Search query string to match against tags
 * @param {Object} options - Search options
 * @param {number} options.category - Filter by category ID (optional)
 * @param {boolean} options.exactMatchOnly - Only return exact matches (default: false)
 * @param {boolean} options.allowFuzzy - Allow fuzzy matching (default: true)
 * @param {number} options.minUseCount - Minimum usage count filter (optional)
 * @param {number} options.limit - Max results to return (default: 10)
 * @returns {Array<Object>} Array of matching tag objects, sorted by relevance
 */
    async searchTags(searchTerm, options = {}) {
    const {
        category,
        minUseCount,
        limit = 10
    } = options;

    const query = searchTerm.trim();
    if (!query) return [];

    const normalized = this.normalizeTagName(query);
    
    const statements = this.getStatements();
    const matches = new Map();
    const sanitizedLimit = Math.max(limit, 1);

    const addMatch = (row, keyword, baseScore, matchType, sourceWeight = 0) => {
        if (!row) return;
        const existing = matches.get(row.id) || {
            row,
            rawScore: 0,
            keywords: new Set(),
            matchTypes: new Set(),
            sources: {}
        };
        existing.rawScore += baseScore;
        if (keyword) {
            existing.keywords.add(keyword);
            const currentWeight = existing.sources[keyword] || 0;
            if (sourceWeight > currentWeight) {
                existing.sources[keyword] = sourceWeight;
            }
        }
        if (matchType) {
            existing.matchTypes.add(matchType);
        }
        matches.set(row.id, existing);
    };

    const exactRow = await this.db.get(statements.getTagByNormalizedTitle, [normalized]);
    if (exactRow) {
        addMatch(exactRow, normalized, 600, 'exact', 4);
    } else {
        for (const variant of this.getTagNameLookupVariants(normalized)) {
            if (variant === normalized) continue;
            const variantRow = await this.db.get(statements.getTagByNormalizedTitle, [variant]);
            if (variantRow) {
                addMatch(variantRow, normalized, 580, 'exact', 4);
                break;
            }
        }
    }

    const aliasRow = await this.db.get(statements.getTagByOtherNameExact, [normalized]);
    if (aliasRow) {
        addMatch(aliasRow, normalized, 450, 'alias', 4);
    } else {
        for (const variant of this.getTagNameLookupVariants(normalized)) {
            if (variant === normalized) continue;
            const variantAlias = await this.db.get(statements.getTagByOtherNameExact, [variant]);
            if (variantAlias) {
                addMatch(variantAlias, normalized, 430, 'alias', 4);
                break;
            }
        }
    }

    for (const variant of this.getTagNameLookupVariants(normalized)) {
        const titlePatterns = this.buildLikePatterns(variant);
        for (const { pattern, score } of titlePatterns) {
            const rows = await this.db.all(statements.searchTitleLike, [pattern, sanitizedLimit]);
            for (const row of rows) {
                const calculated = this.getTitleMatchScore(row.title || '', query);
                let finalScore = Math.max(score, calculated, 25);
                const boundaryHit = this.hasWordBoundary(row.title || '', variant);
                if (boundaryHit) {
                    finalScore += 400;
                }
                const sourceWeight = boundaryHit ? 3 : 2;
                addMatch(row, normalized, finalScore, 'title_like', sourceWeight);
            }
        }
    }

    for (const variant of this.getTagNameLookupVariants(normalized)) {
        const otherNamePatterns = this.buildLikePatterns(variant);
        for (const { pattern, score } of otherNamePatterns) {
            const rows = await this.db.all(statements.searchOtherNamesLike, [pattern, sanitizedLimit]);
            for (const row of rows) {
                addMatch(row, normalized, score, 'other_name', 3);
            }
        }
    }

    const wordTokens = this.tokenizeSearchWords(query);
    // Search each word individually with same ranking as original LIKE search
    // This matches the behavior of the original searchWordsLike with buildLikePatterns
    for (const word of wordTokens) {
        if (!word || word.length === 0) continue;
        
        // Use same scoring as buildLikePatterns:
        // - Exact match: 100
        // - Word at start: 85 (word%)
        // - Word at end: 85 (%word)
        // - Word anywhere: 75 (%word%)
        
        // Exact sequence match (highest priority)
        const exactRows = await this.db.all(statements.searchWordSequencesExact, [word, sanitizedLimit]);
        for (const row of exactRows) {
            addMatch(row, normalized, 100, 'word_exact', 2);
        }
        
        // Word at start of sequence (word%)
        const startRows = await this.db.all(statements.searchWordSequencesStart, [word, sanitizedLimit]);
        for (const row of startRows) {
            addMatch(row, normalized, 85, 'word_start', 2);
        }
        
        // Word at end of sequence (%word)
        const endRows = await this.db.all(statements.searchWordSequencesEnd, [word, sanitizedLimit]);
        for (const row of endRows) {
            addMatch(row, normalized, 85, 'word_end', 2);
        }
        
        // Word anywhere in sequence (%word%) - inner match
        const innerRows = await this.db.all(statements.searchWordSequencesInner, [word, sanitizedLimit]);
        for (const row of innerRows) {
            addMatch(row, normalized, 75, 'word_inner', 2);
        }

        const stemPrefix = this.getWordStemPrefix(word);
        if (stemPrefix) {
            const stemStartRows = await this.db.all(statements.searchWordSequencesStart, [stemPrefix, sanitizedLimit]);
            for (const row of stemStartRows) {
                addMatch(row, normalized, 70, 'word_stem_start', 2);
            }
            const stemInnerRows = await this.db.all(statements.searchWordSequencesInner, [stemPrefix, sanitizedLimit]);
            for (const row of stemInnerRows) {
                addMatch(row, normalized, 60, 'word_stem_inner', 2);
            }
        }
    }
    
    // Multi-word sequences: match both space-separated titles and hyphen/special-indexed titles
    const multiWordSequences = this.buildSearchWordSequences(wordTokens);
    for (const seq of multiWordSequences) {
        const seqRows = await this.db.all(statements.searchWordSequencesExact, [seq, sanitizedLimit]);
        for (const row of seqRows) {
            const wordCount = seq.split(' ').filter(part => part && part !== '§').length;
            const score = 100 + (wordCount * 20);
            addMatch(row, normalized, score, 'sequence_exact', 3);
        }

        const prefixRows = await this.db.all(statements.searchWordSequencesPrefix, [seq, sanitizedLimit]);
        for (const row of prefixRows) {
            addMatch(row, normalized, 150, 'sequence_prefix', 2);
        }
    }

    let results = await Promise.all(Array.from(matches.values()).map(async entry => {
        const base = entry.rawScore;
        const keywordFactor = entry.keywords.size > 0 ? entry.keywords.size : 1;
        const usage = this.getUsageCount(entry.row);
        const novelStrength = this.getNovelTrainingCount(entry.row);
        const usageOnly = Math.max(usage - novelStrength, 0);
        const usageBonus = Math.min(usageOnly / 1500, 60);
        const trainingBonus = Math.min(novelStrength / 400, 220);
        const hasGroups = await this.tagHasGroups(entry.row.id);
        const categoryAdjustment = this.getCategoryAdjustment(entry.row, { hasGroups, usage, novelStrength });
        const sourceBonus = entry.sources ? Object.values(entry.sources).reduce((sum, weight) => sum + (weight * 60), 0) : 0;
        const finalScore = base + (keywordFactor * 50) + usageBonus + trainingBonus + categoryAdjustment + sourceBonus;
        return { ...entry, score: finalScore };
    }));

    if (category !== undefined) {
        results = results.filter(entry => entry.row.category === category);
    }

    if (minUseCount) {
        results = results.filter(entry => this.getUsageCount(entry.row) >= minUseCount);
    }

    results.sort((a, b) => {
        const tierA = this.getQueryMatchTier(query, a.row.title || '');
        const tierB = this.getQueryMatchTier(query, b.row.title || '');
        if (tierB !== tierA) return tierB - tierA;
        const covA = this.getQueryTokenCoverageScore(query, a.row.title || '');
        const covB = this.getQueryTokenCoverageScore(query, b.row.title || '');
        if (covB !== covA) return covB - covA;
        if (b.score !== a.score) return b.score - a.score;
        return this.getUsageCount(b.row) - this.getUsageCount(a.row);
    });

    return results.slice(0, sanitizedLimit).map(entry => {
        const tag = this.mapRowToTag(entry.row);
        if (tag) {
            const matchInfo = this.getQueryMatchInfo(query, tag.title || '');
            tag.searchScore = entry.score;
            tag.matchTier = matchInfo.tier;
            tag.matchCoverage = matchInfo.matchCoverage;
        }
        return tag;
    });
}

/**
 * Token-based word-by-word search for batch searches
 * Works word-by-word, checking if consecutive words form sequences
 * If a sequence doesn't match, searches each word individually
 * 
 * @param {string} searchTerm - Search query string
 * @param {Object} options - Search options
 * @returns {Array<Object>} Array of matching tag objects, sorted by relevance
 */
    async searchTagsTokenBased(searchTerm, options = {}) {
    const {
        category,
        minUseCount,
        limit = 10
    } = options;

    const query = searchTerm.trim();
    if (!query) return [];

    const normalized = this.normalizeTagName(query);
    
    const statements = this.getStatements();
    const matches = new Map();
    const sanitizedLimit = Math.max(limit, 1);

    const addMatch = (row, keyword, baseScore, matchType, sourceWeight = 0) => {
        if (!row) return;
        const existing = matches.get(row.id) || {
            row,
            rawScore: 0,
            keywords: new Set(),
            matchTypes: new Set(),
            sources: {}
        };
        existing.rawScore += baseScore;
        if (keyword) {
            existing.keywords.add(keyword);
            const currentWeight = existing.sources[keyword] || 0;
            if (sourceWeight > currentWeight) {
                existing.sources[keyword] = sourceWeight;
            }
        }
        if (matchType) {
            existing.matchTypes.add(matchType);
        }
        matches.set(row.id, existing);
    };

    // Check exact match first (including hyphen/underscore title variants)
    let exactRow = await this.db.get(statements.getTagByNormalizedTitle, [normalized]);
    if (!exactRow) {
        for (const variant of this.getTagNameLookupVariants(normalized)) {
            if (variant === normalized) continue;
            exactRow = await this.db.get(statements.getTagByNormalizedTitle, [variant]);
            if (exactRow) break;
        }
    }
    if (exactRow) {
        addMatch(exactRow, normalized, 600, 'exact', 4);
    }

    const wordTokens = this.tokenizeSearchWords(query);

    for (const word of wordTokens) {
        if (!word) continue;

        const exactRows = await this.db.all(statements.searchWordSequencesExact, [word, sanitizedLimit]);
        for (const row of exactRows) {
            addMatch(row, normalized, 100, 'word_exact', 2);
        }

        const startRows = await this.db.all(statements.searchWordSequencesStart, [word, sanitizedLimit]);
        for (const row of startRows) {
            addMatch(row, normalized, 85, 'word_start', 2);
        }

        const endRows = await this.db.all(statements.searchWordSequencesEnd, [word, sanitizedLimit]);
        for (const row of endRows) {
            addMatch(row, normalized, 85, 'word_end', 2);
        }

        const innerRows = await this.db.all(statements.searchWordSequencesInner, [word, sanitizedLimit]);
        for (const row of innerRows) {
            addMatch(row, normalized, 75, 'word_inner', 2);
        }

        const stemPrefix = this.getWordStemPrefix(word);
        if (stemPrefix) {
            const stemStartRows = await this.db.all(statements.searchWordSequencesStart, [stemPrefix, sanitizedLimit]);
            for (const row of stemStartRows) {
                addMatch(row, normalized, 70, 'word_stem_start', 2);
            }
            const stemInnerRows = await this.db.all(statements.searchWordSequencesInner, [stemPrefix, sanitizedLimit]);
            for (const row of stemInnerRows) {
                addMatch(row, normalized, 60, 'word_stem_inner', 2);
            }
        }
    }

    const multiWordSequences = this.buildSearchWordSequences(wordTokens);
    for (const seq of multiWordSequences) {
        const seqRows = await this.db.all(statements.searchWordSequencesExact, [seq, sanitizedLimit]);
        for (const row of seqRows) {
            const wordCount = seq.split(' ').filter(part => part && part !== '§').length;
            const score = 100 + (wordCount * 20);
            addMatch(row, normalized, score, 'sequence_exact', 3);
        }

        const prefixRows = await this.db.all(statements.searchWordSequencesPrefix, [seq, sanitizedLimit]);
        for (const row of prefixRows) {
            addMatch(row, normalized, 150, 'sequence_prefix', 2);
        }
    }

    // Also do exact title/alias matches (like original searchTags)
    const aliasRow = await this.db.get(statements.getTagByOtherNameExact, [normalized]);
    if (aliasRow) {
        addMatch(aliasRow, normalized, 450, 'alias', 4);
    }

    for (const variant of this.getTagNameLookupVariants(normalized)) {
        const titlePatterns = this.buildLikePatterns(variant);
        for (const { pattern, score } of titlePatterns) {
            const rows = await this.db.all(statements.searchTitleLike, [pattern, sanitizedLimit]);
            for (const row of rows) {
                const calculated = this.getTitleMatchScore(row.title || '', query);
                let finalScore = Math.max(score, calculated, 25);
                const boundaryHit = this.hasWordBoundary(row.title || '', variant);
                if (boundaryHit) {
                    finalScore += 400;
                }
                const sourceWeight = boundaryHit ? 3 : 2;
                addMatch(row, normalized, finalScore, 'title_like', sourceWeight);
            }
        }
    }

    for (const variant of this.getTagNameLookupVariants(normalized)) {
        const otherNamePatterns = this.buildLikePatterns(variant);
        for (const { pattern, score } of otherNamePatterns) {
            const rows = await this.db.all(statements.searchOtherNamesLike, [pattern, sanitizedLimit]);
            for (const row of rows) {
                addMatch(row, normalized, score, 'other_name', 3);
            }
        }
    }

    // Score and sort results (same logic as searchTags)
    let results = await Promise.all(Array.from(matches.values()).map(async entry => {
        const base = entry.rawScore;
        const keywordFactor = entry.keywords.size > 0 ? entry.keywords.size : 1;
        const usage = this.getUsageCount(entry.row);
        const novelStrength = this.getNovelTrainingCount(entry.row);
        const usageOnly = Math.max(usage - novelStrength, 0);
        const usageBonus = Math.min(usageOnly / 1500, 60);
        const trainingBonus = Math.min(novelStrength / 400, 220);
        const hasGroups = await this.tagHasGroups(entry.row.id);
        const categoryAdjustment = this.getCategoryAdjustment(entry.row, { hasGroups, usage, novelStrength });
        const sourceBonus = entry.sources ? Object.values(entry.sources).reduce((sum, weight) => sum + (weight * 60), 0) : 0;
        const finalScore = base + (keywordFactor * 50) + usageBonus + trainingBonus + categoryAdjustment + sourceBonus;
        return { ...entry, score: finalScore };
    }));

    if (category !== undefined) {
        results = results.filter(entry => entry.row.category === category);
    }

    if (minUseCount) {
        results = results.filter(entry => this.getUsageCount(entry.row) >= minUseCount);
    }

    results.sort((a, b) => {
        const tierA = this.getQueryMatchTier(query, a.row.title || '');
        const tierB = this.getQueryMatchTier(query, b.row.title || '');
        if (tierB !== tierA) return tierB - tierA;
        const covA = this.getQueryTokenCoverageScore(query, a.row.title || '');
        const covB = this.getQueryTokenCoverageScore(query, b.row.title || '');
        if (covB !== covA) return covB - covA;
        if (b.score !== a.score) return b.score - a.score;
        return this.getUsageCount(b.row) - this.getUsageCount(a.row);
    });

    return results.slice(0, sanitizedLimit).map(entry => {
        const tag = this.mapRowToTag(entry.row);
        if (tag) {
            const matchInfo = this.getQueryMatchInfo(query, tag.title || '');
            tag.searchScore = entry.score;
            tag.matchTier = matchInfo.tier;
            tag.matchCoverage = matchInfo.matchCoverage;
        }
        return tag;
    });
}

/**
 * Finds exact tag match by name (checks title and other_names)
 * 
 * @param {string} tagName - Tag name to find
 * @returns {Object|null} Tag object if found, null otherwise
 */
    async findTagExact(tagName) {
    if (!tagName || typeof tagName !== 'string') return null;
    
    const normalized = this.normalizeTagName(tagName);
    
    const statements = this.getStatements();
    let row = await this.db.get(statements.getTagByNormalizedTitle, [normalized]);
    if (!row) {
        for (const variant of this.getTagNameLookupVariants(normalized)) {
            if (variant === normalized) continue;
            row = await this.db.get(statements.getTagByNormalizedTitle, [variant]);
            if (row) break;
        }
    }
    if (!row) {
        row = await this.db.get(statements.getTagByOtherNameExact, [normalized]);
    }
    if (!row) {
        for (const variant of this.getTagNameLookupVariants(normalized)) {
            if (variant === normalized) continue;
            row = await this.db.get(statements.getTagByOtherNameExact, [variant]);
            if (row) break;
        }
    }

    if (!row) return null;

    const tag = this.mapRowToTag(row);
    return await this.enrichTag(tag, {
        includeBodies: true,
        includeOtherNames: true,
        includeLinks: true,
        resolveLinks: true
    });
}

/**
 * Resolves linked tags with configurable depth
 * 
 * @param {string} tagName - Tag name to resolve links for
 * @param {number} depth - How many levels deep to resolve (default: 1)
 * @param {string} direction - 'both'|'to'|'by' (default: 'both')
 * @returns {Object} Object with linksTo and/or linkedBy arrays
 */
    async getLinkedTags(tagName, depth = 1, direction = 'both') {
    const baseTag = await this.findTagExact(tagName);
    if (!baseTag) {
        return { linksTo: [], linkedBy: [] };
    }

    
    const statements = this.getStatements();
    const visited = new Set([baseTag.id]);
    const queue = [{ tagId: baseTag.id, currentDepth: 0 }];
    const linksTo = [];
    const linkedBy = [];

    while (queue.length > 0) {
        const { tagId, currentDepth } = queue.shift();
        if (currentDepth >= depth) {
            continue;
        }
        
        if (direction === 'both' || direction === 'to') {
            const targets = await this.db.all(statements.getLinkIdsFrom, [tagId]);
            for (const target of targets) {
                    if (currentDepth === 0) {
                    const row = await this.db.get(statements.getTagById, [target.tag_id]);
                    if (row) {
                        linksTo.push(this.mapRowToTag(row));
                    }
                }
                if (!visited.has(target.tag_id)) {
                    visited.add(target.tag_id);
                    queue.push({ tagId: target.tag_id, currentDepth: currentDepth + 1 });
                }
            }
        }

        if (direction === 'both' || direction === 'by') {
            const sources = await this.db.all(statements.getLinkIdsTo, [tagId]);
            for (const source of sources) {
                    if (currentDepth === 0) {
                    const row = await this.db.get(statements.getTagById, [source.tag_id]);
                    if (row) {
                        linkedBy.push(this.mapRowToTag(row));
                    }
                }
                if (!visited.has(source.tag_id)) {
                    visited.add(source.tag_id);
                    queue.push({ tagId: source.tag_id, currentDepth: currentDepth + 1 });
                }
            }
        }
    }

    return {
        linksTo: this.dedupeTagsByTitle(linksTo),
        linkedBy: this.dedupeTagsByTitle(linkedBy)
    };
}


/**
 * Formats tag details as compact markdown for token optimization
 * @param {Array<Object>} results - Array of tag detail objects
 * @returns {string} Markdown formatted string
 */
    async formatTagDetailsAsMarkdown(results) {
    const validTags = results.filter(tag => tag && !tag.error);
    const errors = results.filter(tag => tag && tag.error);
    const sections = [];

    if (validTags.length > 0) {
        sections.push(await this.formatTagCollectionSection('Tag Details', validTags, { showEmptyMessage: true }));
    } else {
        sections.push('## Tag Details\n*No results found*');
    }

    if (errors.length > 0) {
        sections.push('## Tag Detail Errors');
        errors.forEach(err => {
            sections.push(`- ${err.searchTerm || 'Unknown'}: ${err.error}`);
        });
    }

    return sections.join('\n\n');
}

/**
 * Formats search by description results as compact markdown for token optimization
 * @param {Array<Object>} results - Array of tag match objects
 * @param {string} description - The original search description
 * @returns {string} Markdown formatted string
 */
    async formatSearchByDescriptionAsMarkdown(results, description, options = {}) {
    const note = `Found ${results.length} match${results.length !== 1 ? 'es' : ''} for "${description}"`;
    return await this.formatTagCollectionSection(`Search Results for "${description}"`, results, {
        note,
        showEmptyMessage: true,
        previewLimit: options.previewLimit,
        topResultDividerIndex: options.topResultDividerIndex
    });
}

/**
 * Formats tag search results as compact markdown for token optimization
 * @param {Object} results - Results object mapping tag names to arrays of tag objects
 * @returns {string} Markdown formatted string
 */
    async formatSearchTagsBatchAsMarkdown(results) {
    const sections = [];
    for (const [searchTerm, tags] of Object.entries(results)) {
        const safeTags = tags || [];
        const note = safeTags.length ? `Found ${safeTags.length} result${safeTags.length !== 1 ? 's' : ''}` : undefined;
        sections.push(await this.formatTagCollectionSection(searchTerm, safeTags, { note, showEmptyMessage: true }));
    }
    return sections.filter(Boolean).join('\n\n');
}

    slugifyAnchor(value) {
    if (!value) return '';
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

/**
 * Converts DText wiki markup to Markdown format using HTML parser
 * Uses the Ruby DText parser to get HTML, then converts HTML to Markdown
 * @param {string} text - Raw DText formatted text
 * @param {string} source - Source ('danbooru' or 'e621', default: 'danbooru')
 * @param {string} baseUrl - Base URL for links (optional)
 * @returns {Promise<string>} Markdown formatted text (or HTML if parser fails)
 */
    async convertWikiMarkupToMarkdown(text, source = 'danbooru', baseUrl = null) {
    if (!text) return '';
    
    try {
        // Determine base URL if not provided
        if (!baseUrl) {
            baseUrl = source === 'e621' ? 'https://e621.net' : 'https://danbooru.donmai.us';
        }
        
        // Access this.globalResources lazily to avoid circular dependency
        // Get HTML from Ruby parser
        const html = await this.globalResources.parseDText(text, source, baseUrl);
        
        if (html && typeof html === 'string') {
            // Convert HTML to Markdown using local converter
            const markdown = this.getHtmlMarkdown().translate(html);
            return markdown;
        }
    } catch (error) {
        return text;
    }
    
    // If no parser available, return original text
    return text;
}

    async stripWikiFormatting(text) {
    if (!text) return '';

    let cleaned = this.stripWikiFormattingSync(text);
    cleaned = await this.convertWikiMarkupToMarkdown(cleaned);
    cleaned = this.stripWikiFormattingSync(cleaned);

    return cleaned;
}

/**
 * Extract wiki sections from database index
 * Sections are pre-indexed in the database - always use the database index
 * @param {string} bodyText - Raw DText formatted text (not used, kept for compatibility)
 * @param {number} wikiId - Required wiki ID to query indexed sections from database
 * @param {string} source - Source ('danbooru' or 'e621', for HTML parsing)
 * @param {string|number} sectionIdentifier - Optional section identifier (index, anchor, or title) to resolve
 * @returns {Promise<Object>} Object with { sections: Array, resolvedSection: Object|null }
 */
    async extractWikiSections(bodyText, wikiId = null, source = 'danbooru', sectionIdentifier = null) {
    // Sections are pre-indexed in the database - always use the database index
    if (!wikiId) {
        // wikiId is required - sections must be retrieved from database index
        throw new Error('extractWikiSections requires wikiId - sections must be retrieved from database index');
    }

    try {
        const { getWikiSections } = this.getStatements();
        const dbSections = await this.db.all(getWikiSections, [wikiId]);
        if (!dbSections || dbSections.length === 0) {
            // If wikiId was provided but no sections found, return empty
            // Sections should be pre-indexed during database creation
            return { sections: [], resolvedSection: null };
        }

        // Convert database format to expected format
        // Database stores start_offset and end_offset as DText offsets (for raw body extraction)
        const sections = dbSections.map(row => ({
            index: row.section_index,
            level: row.level,
            title: row.title,
            anchor: row.anchor,
            startOffset: row.start_offset,  // DText offset for extracting segment
            endOffset: row.end_offset,      // DText offset for extracting segment
            dtextStartOffset: row.start_offset,  // Alias for clarity
            dtextEndOffset: row.end_offset,      // Alias for clarity
            lineIndex: row.line_index,
            sectionType: row.section_type,
            parentSectionId: row.parent_section_id
        }));

        // Resolve section if identifier provided
        let resolvedSection = null;
        if (sectionIdentifier !== null && sectionIdentifier !== undefined) {
            resolvedSection = this.findSectionByIdentifier(sectionIdentifier, sections);
        }

        return { sections, resolvedSection };
    } catch (e) {
        // Database query failed - log error
        // Sections should be pre-indexed, so this indicates a data issue
        console.error(`Failed to get sections from database for wiki_id ${wikiId}:`, e.message);
        throw e;
    }
}

    findSectionByIdentifier(identifier, sections) {
    if (!identifier || !Array.isArray(sections) || sections.length === 0) {
        return null;
    }

    // Check if identifier is a numeric index (1-based, matching display)
    const numericIndex = typeof identifier === 'number' ? identifier : parseInt(identifier, 10);
    if (!isNaN(numericIndex) && numericIndex > 0) {
        // Convert 1-based user input to 0-based index
        const zeroBasedIndex = numericIndex - 1;
        const match = sections.find(section => {
            const sectionIndex = typeof section.index === 'number' ? section.index : sections.indexOf(section);
            return sectionIndex === zeroBasedIndex;
        });
        if (match) return match;
    }

    const normalizedInput = this.slugifyAnchor(String(identifier));

    let match = sections.find(section => this.slugifyAnchor(section.anchor) === normalizedInput);
    if (match) return match;

    match = sections.find(section => this.slugifyAnchor(section.title) === normalizedInput);
    if (match) return match;

    const lowerIdentifier = String(identifier).toLowerCase();
    return sections.find(section => section.title.toLowerCase().includes(lowerIdentifier));
}

/**
 * Processes body content with preview and memory creation
 * @param {string} tagTitle - The tag title
 * @param {string} bodyText - The full body text
 * @param {string} searchTerm - The original search term
 * @param {number} previewLength - Maximum preview length (default: 250)
 * @returns {Promise<Object>} Object with body preview, memory reference, and metadata
 */
    async processTagBody(tagTitle, bodyText, searchTerm, previewLength = 250) {
    if (!bodyText || bodyText.trim().length === 0) {
        return null;
    }
    
    const normalizedTitle = tagTitle.toLowerCase();
    const normalizedBody = bodyText.toLowerCase();
    
    // Check if memory already exists for this tag
    let bodyMemory = null;
    let bodyMemoryDescription = null;
    try {
        const knowledgeMemoryDb = this.globalResources.getKnowledgeMemoryDb();
        if (knowledgeMemoryDb) {
            const memoryName = `tag_body_${tagTitle.toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 50)}`;
            const existing = knowledgeMemoryDb.getKnowledgeMemory(memoryName, false);
            if (existing && existing.category === 'tag_wiki') {
                bodyMemory = memoryName;
                bodyMemoryDescription = existing.description || null;
            }
        }
    } catch (error) {
        // Silently fail - memory check is optional
    }

    const result = {
        bodyMemory: bodyMemory || undefined,
        bodyMemoryDescription: bodyMemoryDescription || undefined
    };
    
    // Strip wiki formatting for preview
    const cleanedBody = await this.stripWikiFormatting(bodyText);
    const cleanedBodyText = cleanedBody.replace(/_/g, ' ');
    const totalLines = cleanedBodyText.split('\n').length;
    
    // Check if body is essentially the same as title (normalized comparison)
    const normalizedCleanedBody = cleanedBodyText.trim().toLowerCase();
    const normalizedTitleForComparison = normalizedTitle.replace(/[^a-z0-9]/g, '');
    const normalizedBodyForComparison = normalizedCleanedBody.replace(/[^a-z0-9]/g, '');
    
    // If body is same as title or very short/minimal, mark it
    if (normalizedBodyForComparison === normalizedTitleForComparison || 
        normalizedCleanedBody.length < 3 || 
        normalizedCleanedBody === normalizedTitle) {
        result.bodySameAsTitle = true;
        // Don't return body content if it's just the title
        return null;
    }
    
    if (cleanedBodyText.length > previewLength) {
        const previewText = cleanedBodyText.substring(0, previewLength);
        result.body = previewText;
        result.bodyTruncated = true;
        result.bodyTotalLength = cleanedBodyText.length;
        result.bodyPreview = true;
        result.bodyTotalLines = totalLines;
        result.bodyPreviewLines = previewText.split('\n').length;
    } else {
        result.body = cleanedBodyText;
        result.bodyTruncated = false;
        result.bodyTotalLines = totalLines;
        result.bodyPreviewLines = totalLines;
    }
    
    return result;
}

/**
 * Helper function to search tags by wiki body content
 * @param {string} searchTerm - Search term to extract keywords from
 * @param {Object} options - Search options (category, minUseCount, limit)
 * @returns {Array<Object>} Array of tag objects matching body content
 */
    async searchTagsByBody(searchTerm, options = {}) {
    const { category, minUseCount, limit = 30 } = options;
    
    const keywords = this.extractKeywords(searchTerm);
    if (keywords.length === 0 && searchTerm.trim()) {
        keywords.push(searchTerm.trim().toLowerCase());
    }

    const statements = this.getStatements();
    const sanitizedLimit = Math.max(Math.round(keywords.length * 1.5), Math.min(limit || 30, this.MAX_TABLE_RESULTS));
    const matches = new Map();

    const addMatch = (row, keyword, baseScore, sourceWeight = 0) => {
        if (!row) return;
        const existing = matches.get(row.id) || { row, rawScore: 0, keywords: new Set(), sources: {} };
        existing.rawScore += baseScore;
        existing.keywords.add(keyword);
        if (sourceWeight > 0) {
            const currentWeight = existing.sources[keyword] || 0;
            if (sourceWeight > currentWeight) {
                existing.sources[keyword] = sourceWeight;
            }
        }
        matches.set(row.id, existing);
    };

    for (const word of keywords) {
        const normalizedWord = this.normalizeTagName(word);
        const patterns = this.buildLikePatterns(normalizedWord);
        const baseScore = patterns.length > 0 ? patterns[0].score : 50;
        
        // Try FTS5 first for body searches (faster)
        try {
            const ftsQuery = `"${word}" OR ${word.replace(/ /g, '_')}`;
            const ftsRows = await this.db.all(statements.searchBodyByKeywordFTS, [ftsQuery, sanitizedLimit]);
            for (const row of ftsRows) {
                const bodyScore = Math.max(50, baseScore); // FTS5 matches are higher quality
                addMatch(row, word, bodyScore, 2);
            }
        } catch (e) {
            // FTS5 not available or query failed, fall back to LIKE
        }
        
        // Fallback to LIKE search
        for (const { pattern, score } of patterns) {
            const rows = await this.db.all(statements.searchBodyByKeyword, [pattern, sanitizedLimit]);
            for (const row of rows) {
                const bodyScore = Math.max(10, score - 20);
                addMatch(row, word, bodyScore, 1);
            }
        }
    }

    let results = await Promise.all(Array.from(matches.values()).map(async entry => {
        const usage = this.getUsageCount(entry.row);
        const novelStrength = this.getNovelTrainingCount(entry.row);
        const usageOnly = Math.max(usage - novelStrength, 0);
        const usageBonus = Math.min(usageOnly / 1200, 60);
        const trainingBonus = Math.min(novelStrength / 350, 220);
        const keywordFactor = entry.keywords.size > 0 ? entry.keywords.size : 1;
        const hasGroups = await this.tagHasGroups(entry.row.id);
        const categoryAdjustment = this.getCategoryAdjustment(entry.row, { hasGroups, usage, novelStrength });
        const sourceBonus = entry.sources ? Object.values(entry.sources).reduce((sum, weight) => sum + (weight * 70), 0) : 0;
        const finalScore = entry.rawScore + (keywordFactor * 80) + usageBonus + trainingBonus + categoryAdjustment + sourceBonus;
        return { ...entry, score: finalScore };
    }));

    if (category !== undefined) {
        results = results.filter(entry => entry.row.category === category);
    }

    if (minUseCount) {
        results = results.filter(entry => this.getUsageCount(entry.row) >= minUseCount);
    }

    results.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return this.getUsageCount(b.row) - this.getUsageCount(a.row);
    });

    return results.slice(0, sanitizedLimit).map(entry => this.mapRowToTag(entry.row));
}

/**
 * Handles searchTagsBatch tool call
 * @param {Object} params - Tool parameters
 * @param {Object} buildOptions - Current build options (read-only)
 * @param {Object} toolContext - WebSocket context for progress updates
 * @returns {Object} Results with markdown and json properties for token optimization
 */
    async handleSearchTagsBatch(params, buildOptions = {}, toolContext = {}) {
    try {
        const { tags } = params;
        if (!tags || !Array.isArray(tags)) {
            return { error: "Expected 'tags' array parameter" };
        }

        const results = {};

        for (let i = 0; i < tags.length; i++) {
            const tagSpec = tags[i];
            const tagName = (tagSpec.name || '').replace(/_/g, ' ').trim();
            const requestedLimit = typeof tagSpec.limit === 'number' ? tagSpec.limit : 30;
            const effectiveLimit = Math.max(1, Math.min(requestedLimit, this.MAX_TABLE_RESULTS));
            const returnFields = Array.isArray(tagSpec.returnFields) ? tagSpec.returnFields : ['title', 'usage'];
            const searchOptions = {
                category: tagSpec.category,
                minUseCount: tagSpec.minUseCount,
                limit: effectiveLimit
            };

            // Use token-based word-by-word search for batch searches
            const nameMatches = await this.searchTagsTokenBased(tagName, searchOptions);
            const nameResults = await Promise.all(nameMatches.map(async tag => await this.projectTagResult(tag, returnFields, tagSpec.resolveLinks, tagName)));
            
            let combinedResults = nameResults;

            // If searchWikiBody is enabled, also search wiki body contents
            if (tagSpec.searchWikiBody === true) {
                const bodyMatches = await this.searchTagsByBody(tagName, searchOptions);
                const bodyResults = await Promise.all(bodyMatches.map(async tag => await this.projectTagResult(tag, returnFields, tagSpec.resolveLinks, tagName)));
                
                // Merge results, avoiding duplicates by tag ID
                const seenIds = new Set(nameResults.map(r => r.id).filter(Boolean));
                for (const bodyResult of bodyResults) {
                    if (bodyResult.id && !seenIds.has(bodyResult.id)) {
                        combinedResults.push(bodyResult);
                        seenIds.add(bodyResult.id);
                    } else if (!bodyResult.id) {
                        // If no ID, check by title to avoid duplicates
                        const titleKey = (bodyResult.title || bodyResult.displayTitle || '').toLowerCase();
                        const alreadyExists = combinedResults.some(r => 
                            (r.title || r.displayTitle || '').toLowerCase() === titleKey
                        );
                        if (!alreadyExists) {
                            combinedResults.push(bodyResult);
                        }
                    }
                }
                
                // Re-sort combined results by relevance (you may want to adjust sorting logic)
                combinedResults.sort((a, b) => {
                    // Prioritize name matches over body matches if both exist
                    const aIsNameMatch = nameResults.some(r => r.id === a.id);
                    const bIsNameMatch = nameResults.some(r => r.id === b.id);
                    if (aIsNameMatch && !bIsNameMatch) return -1;
                    if (!aIsNameMatch && bIsNameMatch) return 1;
                    // Then sort by usage count
                    const aUsage = (a.d_count || 0) + ((a.e_count || 0) * 4) + ((a.n_count || 0) * 12);
                    const bUsage = (b.d_count || 0) + ((b.e_count || 0) * 4) + ((b.n_count || 0) * 12);
                    return bUsage - aUsage;
                });
                
                // Limit to effectiveLimit
                combinedResults = combinedResults.slice(0, effectiveLimit);
            }

            if (tagSpec.includeGroups !== false) {
                const groupResults = await this.searchTagGroupsByTitle(tagName, Math.max(1, Math.min(5, effectiveLimit)));
                if (groupResults.length > 0) {
                    combinedResults = combinedResults.concat(groupResults);
                }
            }

            const key = tagSpec.name || tagName;
            results[key] = combinedResults;
        }

        return {
            markdown: await this.formatSearchTagsBatchAsMarkdown(results),
            json: results
        };
    } catch (error) {
        console.error(`❌ [handleSearchTagsBatch] Error:`, error);
        return { error: `Failed to search tags: ${error.message}` };
    }
}

/**
 * Handles getTagDetails tool call
 * @param {Object} params - Tool parameters
 * @param {Object} buildOptions - Current build options (read-only)
 * @returns {Array<Object>} Array of complete tag objects
 */
    async handleGetTagDetails(params, buildOptions = {}) {
    const { tags } = params;

    if (!tags || !Array.isArray(tags)) {
        return { error: "Expected 'tags' array parameter" };
    }

    const results = await Promise.all(tags.map(async tagSpec => {
        const searchTerm = (tagSpec.name || '').replace(/_/g, ' ').trim();
        const tag = await this.findTagExact(searchTerm);

        if (!tag) {
            return {
                searchTerm,
                error: "Tag not found"
            };
        }

        const returnFields = Array.isArray(tagSpec.returnFields) ? tagSpec.returnFields : [];
        const data = await this.projectTagResult(tag, returnFields, true, searchTerm);
        data.searchTerm = searchTerm;
        return data;
    }));

    const seenTitles = new Set();
    const dedupedResults = results.filter(result => {
        if (!result || result.error) {
            return true;
        }
        const titleKey = (result.title || result.displayTitle || result.searchTerm || '').toLowerCase();
        if (!titleKey) {
            return true;
        }
        if (seenTitles.has(titleKey)) {
            return false;
        }
        seenTitles.add(titleKey);
        return true;
    });

    return {
        markdown: await this.formatTagDetailsAsMarkdown(dedupedResults),
        json: dedupedResults
    };
}

/**
 * Handles resolveTagLinks tool call
 * @param {Object} params - Tool parameters
 * @param {Object} buildOptions - Current build options (read-only)
 * @returns {Object} Object with resolved links
 */
    async handleResolveTagLinks(params, buildOptions = {}) {
    const { tagName, depth = 1, direction = 'both', reason } = params;

    if (reason) {
        console.log(`  [REASON] ${reason}`);
    }

    const baseTag = await this.findTagExact(tagName);
    const links = await this.getLinkedTags(tagName, depth, direction);
    
    // Helper function to calculate balanced usage count (same logic as getUsageCount but works with tag objects)
    const getTagUsageCount = (tag) => {
        if (!tag) return 0;
        const dCount = Math.min(this.MAX_USAGE_CAP, tag.d_count || 0);
        const eCount = Math.min(this.MAX_USAGE_CAP, tag.e_count || 0) * 4; // Cap BEFORE multiplying
        const nCount = Math.min(10000, tag.n_count || 0) * 12; // Cap BEFORE multiplying
        return Math.max(dCount, eCount, nCount);
    };
    
    // Helper function to calculate novel training count (same logic as getNovelTrainingCount)
    // The effective maximum for trainingBonus contribution is 88000 (220 * 400)
    // Values above this don't contribute more to the bonus, but we still cap at this.MAX_USAGE_CAP
    // for consistency with the original getNovelTrainingCount function
    const getTagNovelTrainingCount = (tag) => {
        if (!tag) return 0;
        // Cap n_count at this.MAX_USAGE_CAP, matching getNovelTrainingCount
        // Note: trainingBonus = Math.min(novelStrength / 400, 220) caps the bonus at 220
        // which means novelStrength > 88000 doesn't contribute more
        return Math.min(this.MAX_USAGE_CAP, tag.n_count || 0);
    };
    
    // Helper function to calculate category adjustment (same logic as getCategoryAdjustment but works with tag objects)
    const getTagCategoryAdjustment = async (tag) => {
        if (!tag) return 0;
        const title = (tag.title || '').trim();
        const multiWordTitle = /\s+/.test(title);
        const categoryName = tag.categoryName || this.getCategoryName(tag.category);
        const hasGroups = await this.tagHasGroups(tag.id);
        const usage = getTagUsageCount(tag);
        const novelStrength = getTagNovelTrainingCount(tag);
        let adjustment = 0;

        if (categoryName === 'Uncategorized') {
            adjustment -= multiWordTitle ? 80 : 320;
            if (!multiWordTitle && usage < 5000 && novelStrength < 1500) {
                adjustment -= 200;
            }
        }

        if ((categoryName === 'General' || categoryName === 'Meta') && !hasGroups) {
            adjustment -= 90;
            if (usage < 10000 && novelStrength < 2000) {
                adjustment -= 60;
            }
        }

        return adjustment;
    };
    
    // Helper function to calculate sort score (same logic as searchTags)
    const getTagSortScore = async (tag) => {
        const usage = getTagUsageCount(tag);
        const novelStrength = getTagNovelTrainingCount(tag);
        const usageOnly = Math.max(usage - novelStrength, 0);
        const usageBonus = Math.min(usageOnly / 1500, 60);
        const trainingBonus = Math.min(novelStrength / 400, 220);
        const hasGroups = await this.tagHasGroups(tag.id);
        const categoryAdjustment = await getTagCategoryAdjustment(tag);
        
        return usageBonus + trainingBonus + categoryAdjustment;
    };
    
    // Enrich tags first
    const enrichedLinksTo = await Promise.all(links.linksTo.map(tag => this.enrichTag(tag, { includeBodies: false, includeOtherNames: false, includeLinks: false })));
    const enrichedLinkedBy = await Promise.all(links.linkedBy.map(tag => this.enrichTag(tag, { includeBodies: false, includeOtherNames: false, includeLinks: false })));
    
    // Deduplicate bidirectional links
    // If tag A links to tag B and tag B links to tag A, only keep in linksTo (skip in linkedBy)
    // This handles cases where: solo -> comic AND comic -> solo (only show comic in "Links To")
    // Use tag IDs for reliable comparison (tags from database should always have IDs)
    const linksToKeys = new Set();
    
    // Build set of keys (IDs) for tags in linksTo
    enrichedLinksTo.forEach(tag => {
        // Tags from database should always have IDs - use ID for reliable comparison
        if (tag.id) {
            linksToKeys.add(tag.id);
        } else if (tag.title) {
            // Fallback to title comparison if no ID (shouldn't happen, but safety)
            linksToKeys.add(tag.title.toLowerCase());
        }
    });
    
    // Filter linksTo - include all (bidirectional will be handled by filtering linkedBy)
    const linksToFiltered = [...enrichedLinksTo];
    
    // Filter linkedBy - exclude any that are also in linksTo (bidirectional links)
    const linkedByFiltered = enrichedLinkedBy.filter(link => {
        // Check by ID first (most reliable) - tags from database should have IDs
        const linkKey = link.id || (link.title ? link.title.toLowerCase() : null);
        if (!linkKey) return true; // Keep if no key (shouldn't happen, but safety)
        
        // Exclude if this tag also appears in linksTo (it's a bidirectional link)
        return !linksToKeys.has(linkKey);
    });
    
    // Sort by score (descending), then by usage count as tiebreaker
    const linksToScores = await Promise.all(linksToFiltered.map(tag => getTagSortScore(tag)));
    linksToFiltered.sort((a, b) => {
        const scoreA = linksToScores[linksToFiltered.indexOf(a)];
        const scoreB = linksToScores[linksToFiltered.indexOf(b)];
        if (scoreB !== scoreA) return scoreB - scoreA;
        return getTagUsageCount(b) - getTagUsageCount(a);
    });
    
    const linkedByScores = await Promise.all(linkedByFiltered.map(tag => getTagSortScore(tag)));
    linkedByFiltered.sort((a, b) => {
        const scoreA = linkedByScores[linkedByFiltered.indexOf(a)];
        const scoreB = linkedByScores[linkedByFiltered.indexOf(b)];
        if (scoreB !== scoreA) return scoreB - scoreA;
        return getTagUsageCount(b) - getTagUsageCount(a);
    });
    
    const result = {
        linksTo: linksToFiltered,
        linkedBy: linkedByFiltered
    };

    // Get untagged wiki pages for "Mentioned in" section (not tags, only wiki pages)
    // This includes tag groups (always on top) and other untagged wiki pages
    let wikiLinks = [];
    let notToBeConfused = [];
    if (baseTag) {
        
        const statements = this.getStatements();
        const { getTagGroupPagesForTag, getWikiPagesReferencingTag, getTagById } = statements;
        
        // Build set of tag IDs already in linksTo or linkedBy (to exclude from "Mentioned in")
        const excludedTagIds = new Set();
        result.linksTo.forEach(tag => {
            if (tag.id) excludedTagIds.add(tag.id);
        });
        result.linkedBy.forEach(tag => {
            if (tag.id) excludedTagIds.add(tag.id);
        });
        
        // Get tag groups (always on top)
        const tagGroups = await this.db.all(getTagGroupPagesForTag, [baseTag.id, 100]) || [];
        
        // Get other untagged wiki pages (not tag groups)
        const untaggedWikiPages = await this.db.all(getWikiPagesReferencingTag, [baseTag.id, 100]) || [];
        
        // Combine all untagged wiki pages, with tag groups first
        // These are all wiki pages (from wiki_pages table), not tags
        const allUntaggedPages = [...tagGroups, ...untaggedWikiPages];
        
        // Map to mention objects with title and isTagGroup flag
        const untaggedMentions = allUntaggedPages.map(page => ({
            title: page.title,
            isTagGroup: page.title.toLowerCase().startsWith('tag_group:') || page.title.toLowerCase().startsWith('tag group:')
        }));
        
        // Sort: tag groups first, then by title
        untaggedMentions.sort((a, b) => {
            if (a.isTagGroup && !b.isTagGroup) return -1;
            if (!a.isTagGroup && b.isTagGroup) return 1;
            return a.title.localeCompare(b.title);
        });
        
        wikiLinks = untaggedMentions;
        result.wikiLinks = wikiLinks;
        
        // Handle "not to be confused with" - these are tags from fetchTagWikiMentions with relationship 3
        const wikiMentions = await this.fetchTagWikiMentions(baseTag.id);
        const notToBeConfusedMentions = wikiMentions
            .filter(mention => mention.relationship === 3 && mention.tagId)
            .filter(mention => !excludedTagIds.has(mention.tagId)); // Exclude if already in linksTo/linkedBy
        
        if (notToBeConfusedMentions.length > 0) {
            notToBeConfused = await Promise.all(notToBeConfusedMentions.map(async mention => {
                const tagRow = await this.db.get(getTagById, [mention.tagId]);
                if (tagRow) {
                    const tag = this.mapRowToTag(tagRow);
                    return await this.enrichTag(tag, { includeBodies: false, includeOtherNames: false, includeLinks: false });
                }
                return null;
            }));
            notToBeConfused = notToBeConfused.filter(Boolean);
        }
        
        result.notToBeConfused = notToBeConfused;
    }

    const lines = [];
    lines.push(`## Tag Links for "${tagName.replace(/_/g, ' ')}"`);
    
    if (result.linksTo.length > 0) {
        lines.push(`\n**Links To (${result.linksTo.length}):**`);
        lines.push(`| Tag | Has Wiki? |`);
        lines.push(`|-----|-----------|`);
        const linksToWikiChecks = await Promise.all(result.linksTo.slice(0, 15).map(link => this.hasWikiContent(link)));
        result.linksTo.slice(0, 15).forEach((link, idx) => {
            lines.push(`| ${link.title} | ${linksToWikiChecks[idx] ? '✓' : '✗'} |`);
        });
        if (result.linksTo.length > 15) {
            lines.push(`\n*... ${result.linksTo.length - 15} more*`);
        }
    }
    
    if (result.linkedBy.length > 0) {
        lines.push(`\n**Linked By (${result.linkedBy.length}):**`);
        lines.push(`| Tag | Has Wiki? |`);
        lines.push(`|-----|-----------|`);
        const linkedByWikiChecks = await Promise.all(result.linkedBy.slice(0, 15).map(link => this.hasWikiContent(link)));
        result.linkedBy.slice(0, 15).forEach((link, idx) => {
            lines.push(`| ${link.title} | ${linkedByWikiChecks[idx] ? '✓' : '✗'} |`);
        });
        if (result.linkedBy.length > 15) {
            lines.push(`\n*... ${result.linkedBy.length - 15} more*`);
        }
    }

    if (wikiLinks.length > 0) {
        lines.push(`\n**Mentioned in (${wikiLinks.length}):**`);
        wikiLinks.slice(0, 50).forEach(page => {
            const title = typeof page === 'string' ? page : page.title;
            lines.push(`- ${title}`);
        });
        if (wikiLinks.length > 50) {
            lines.push(`\n*... ${wikiLinks.length - 50} more*`);
        }
    }
    
    if (notToBeConfused.length > 0) {
        lines.push(`\n**Not to be confused with (${notToBeConfused.length}):**`);
        notToBeConfused.forEach(link => {
            lines.push(`- ${link.title}`);
        });
    }

    if (result.linksTo.length === 0 && result.linkedBy.length === 0 && wikiLinks.length === 0 && notToBeConfused.length === 0) {
        lines.push(`\n*No links found*`);
    }
    
    return {
        markdown: lines.join('\n'),
        json: result
    };
}

/**
 * Handles searchByDescription tool call
 * @param {Object} params - Tool parameters
 * @param {Object} buildOptions - Current build options (read-only)
 * @returns {Array<Object>} Array of matching tags
 */
    async handleSearchByDescription(params, buildOptions = {}) {
    const { description, category, minUseCount, limit = 30, reason } = params;

    if (reason) {
        console.log(`  [REASON] ${reason}`);
    }

    if (!description || typeof description !== 'string') {
        return { error: 'Description is required' };
    }

    const keywords = this.extractKeywords(description);
    if (keywords.length === 0 && description.trim()) {
        keywords.push(description.trim().toLowerCase());
    }

    
    const statements = this.getStatements();
    const sanitizedLimit = Math.max(Math.round(keywords.length * 1.5), Math.min(limit || 30, this.MAX_TABLE_RESULTS));
    const matches = new Map();

    const addMatch = (row, keyword, baseScore, sourceWeight = 0) => {
        if (!row) return;
        const existing = matches.get(row.id) || { row, rawScore: 0, keywords: new Set(), sources: {} };
        existing.rawScore += baseScore;
        existing.keywords.add(keyword);
        if (sourceWeight > 0) {
            const currentWeight = existing.sources[keyword] || 0;
            if (sourceWeight > currentWeight) {
                existing.sources[keyword] = sourceWeight;
            }
        }
        matches.set(row.id, existing);
    };

    for (const word of keywords) {
        const normalizedWord = this.normalizeTagName(word);
        const patterns = this.buildLikePatterns(normalizedWord);
        for (const { pattern, score } of patterns) {
            const rows = await this.db.all(statements.searchTitleLike, [pattern, sanitizedLimit]);
            for (const row of rows) {
                const titleScore = this.getTitleMatchScore(row.title || '', word);
                let finalScore = Math.max(score, titleScore, 25);
                const boundaryHit = this.hasWordBoundary(row.title || '', word);
                if (boundaryHit) {
                    finalScore += 400;
                }
                const sourceWeight = boundaryHit ? 3 : 2;
                addMatch(row, word, finalScore, sourceWeight);
            }
        }
        // Try FTS5 first for body searches (faster)
        try {
            const ftsQuery = `"${word}" OR ${word.replace(/ /g, '_')}`;
            const ftsRows = await this.db.all(statements.searchBodyByKeywordFTS, [ftsQuery, sanitizedLimit]);
            for (const row of ftsRows) {
                const bodyScore = Math.max(50, score); // FTS5 matches are higher quality
                addMatch(row, word, bodyScore, 2);
            }
        } catch (e) {
            // FTS5 not available or query failed, fall back to LIKE
        }
        
        // Fallback to LIKE search
        for (const { pattern, score } of patterns) {
            const rows = await this.db.all(statements.searchBodyByKeyword, [pattern, sanitizedLimit]);
            for (const row of rows) {
                const bodyScore = Math.max(10, score - 20);
                addMatch(row, word, bodyScore, 1);
            }
        }
    }

    let results = await Promise.all(Array.from(matches.values()).map(async entry => {
        const usage = this.getUsageCount(entry.row);
        const novelStrength = this.getNovelTrainingCount(entry.row);
        const usageOnly = Math.max(usage - novelStrength, 0);
        const usageBonus = Math.min(usageOnly / 1200, 60);
        const trainingBonus = Math.min(novelStrength / 350, 220);
        const keywordFactor = entry.keywords.size > 0 ? entry.keywords.size : 1;
        const hasGroups = await this.tagHasGroups(entry.row.id);
        const categoryAdjustment = this.getCategoryAdjustment(entry.row, { hasGroups, usage, novelStrength });
        const sourceBonus = entry.sources ? Object.values(entry.sources).reduce((sum, weight) => sum + (weight * 70), 0) : 0;
        const finalScore = entry.rawScore + (keywordFactor * 80) + usageBonus + trainingBonus + categoryAdjustment + sourceBonus;
        return { ...entry, score: finalScore };
    }));

    if (category !== undefined) {
        results = results.filter(entry => entry.row.category === category);
    }

    if (minUseCount) {
        results = results.filter(entry => this.getUsageCount(entry.row) >= minUseCount);
    }

    results.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return this.getUsageCount(b.row) - this.getUsageCount(a.row);
    });

    const keywordBuckets = keywords.map(() => []);
    const usedIds = new Set();

    keywords.forEach((word, index) => {
        const matchesForWord = results.filter(entry => entry.keywords && entry.keywords.has(word) && !usedIds.has(entry.row.id));
        matchesForWord.sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            return this.getUsageCount(b.row) - this.getUsageCount(a.row);
        });
        matchesForWord.forEach(entry => {
            keywordBuckets[index].push(entry);
        });
    });

    const interleaved = [];
    let bucketIndex = 0;
    while (interleaved.length < sanitizedLimit) {
        const bucket = keywordBuckets[bucketIndex];
        while (bucket && bucket.length > 0) {
            const candidate = bucket.shift();
            if (usedIds.has(candidate.row.id)) {
                continue;
            }
            interleaved.push(candidate);
            usedIds.add(candidate.row.id);
            break;
        }
        bucketIndex = (bucketIndex + 1) % Math.max(keywords.length, 1);
        const remainingBuckets = keywordBuckets.some(bucket => bucket.length > 0);
        if (!remainingBuckets) {
            break;
        }
    }

    for (const entry of results) {
        if (interleaved.length >= sanitizedLimit) break;
        if (usedIds.has(entry.row.id)) continue;
        interleaved.push(entry);
        usedIds.add(entry.row.id);
    }

    const finalEntries = interleaved.slice(0, sanitizedLimit);

    const topResults = await Promise.all(finalEntries.map(async entry => {
        const tag = this.mapRowToTag(entry.row);
        const projected = await this.projectTagResult(tag, [], false, description);
        projected.matchScore = entry.score;
        projected.matchedWords = `${entry.keywords.size}/${keywords.length || 1}`;
        return projected;
    }));

    let combinedResults = topResults;
    const remaining = Math.max(0, sanitizedLimit - topResults.length);
    if (remaining > 0) {
        const groupResults = await this.searchTagGroupsByKeywords(keywords, description, remaining);
        if (groupResults.length > 0) {
            combinedResults = combinedResults.concat(groupResults);
        }
    }

    const previewLimit = Math.max(this.MAX_BODY_PREVIEWS, keywords.length || 1);
    const dividerIndex = Math.min(keywords.length || 0, combinedResults.length);

    return {
        markdown: await this.formatSearchByDescriptionAsMarkdown(combinedResults, description, {
            previewLimit,
            topResultDividerIndex: dividerIndex > 0 ? dividerIndex : null
        }),
        json: combinedResults
    };
}

/**
 * Formats body chunk as markdown
 * @param {Object} chunkData - Chunk data object
 * @returns {string} Markdown formatted string
 */
    formatBodyChunkAsMarkdown(chunkData) {
    const lines = [];
    
    if (chunkData.error) {
        lines.push(`## Error\n`);
        lines.push(`*${chunkData.error}*`);
        if (chunkData.availableSections && chunkData.availableSections.length > 0) {
            lines.push(`\n**Available sections:**`);
            chunkData.availableSections.forEach(section => {
                lines.push(`- ${section.title} (\`${section.anchor}\`)`);
            });
            if (chunkData.totalSections && chunkData.totalSections > chunkData.availableSections.length) {
                lines.push(`- ... ${chunkData.totalSections - chunkData.availableSections.length} more`);
            }
        }
        return lines.join('\n');
    }
    
    lines.push(`## ${chunkData.tagName} - Body Chunk ${chunkData.chunkIndex + 1} of ${chunkData.totalChunks}\n`);
    lines.push(`**Progress:** ${chunkData.progress}`);
    if (chunkData.sectionInfo) {
        lines.push(`**Section:** ${chunkData.sectionInfo.title} (\`${chunkData.sectionInfo.anchor}\`)`);
    }

    if (chunkData.hasMore) {
        const nextSource = chunkData.bodySource || 'danbooru';
        lines.push(`=== **Has More:** Yes - use \`getBodyChunk("${chunkData.tagName}", ${chunkData.chunkIndex + 1}, "${nextSource}")\` for next chunk ===`);
    } else {
        lines.push(`**End of body**`);
    }

    if (chunkData.availableSections && chunkData.availableSections.length > 0) {
        lines.push(`\n**Available sections**${chunkData.totalSections ? ` (${Math.min(chunkData.availableSections.length, chunkData.totalSections)} of ${chunkData.totalSections})` : ''}:`);
        chunkData.availableSections.forEach(section => {
            const indent = '  '.repeat(Math.max(0, section.level - 1));
            lines.push(`${indent}- ${section.title} (\`${section.anchor}\`)`);
        });
        if (chunkData.totalSections && chunkData.totalSections > chunkData.availableSections.length) {
            lines.push(`- ... ${chunkData.totalSections - chunkData.availableSections.length} more`);
        }
        lines.push(`Use \`section: "anchor"\` with getBodyChunk to jump directly.`);
    }

    lines.push(`\n### Content\n--------------------\n`);
    
    // Format body text with proper line breaks
    const bodyLines = chunkData.chunkText.split('\n');
    bodyLines.forEach(line => {
        lines.push(`${line}`);
    });
    
    return lines.join('\n');
}

/**
 * Handles getBodyChunk tool call
 * @param {Object} params - Tool parameters
 * @param {Object} buildOptions - Current build options (read-only)
 * @returns {Object} Body chunk data with markdown and json properties
 */
    async handleGetBodyChunk(params, buildOptions = {}) {
    const { tagName, chunkIndex = 0, bodySource, reason, section } = params;

    if (reason) {
        console.log(`  [REASON] ${reason}`);
    }

    if (!bodySource) {
        const errorResult = { error: 'bodySource is required (danbooru, e621, or summary)' };
        return {
            ...errorResult,
            markdown: this.formatBodyChunkAsMarkdown(errorResult),
            json: errorResult
        };
    }

    const sourceId = this.resolveBodySourceId(bodySource);
    if (sourceId === null) {
        const errorResult = { error: `Unknown body source "${bodySource}". Use danbooru, e621, or summary.` };
        return {
            ...errorResult,
            markdown: this.formatBodyChunkAsMarkdown(errorResult),
            json: errorResult
        };
    }

    
    const statements = this.getStatements();
    let tag = await this.findTagExact(tagName);
    let wikiPage = null;
    let wikiBodyText = null;
    let wikiSections = null;
    let wikiId = null;
    let chunkTitle = tagName;

    if (tag) {
        chunkTitle = tag.title || chunkTitle;
        // Get wiki_id for this tag and source
        const wikiIdRow = await this.db.get(statements.getWikiIdForTag, [tag.id, sourceId]);
        if (wikiIdRow) {
            wikiId = wikiIdRow.id;
        }
    }

    if (!tag) {
        const normalizedPageName = (tagName || '').replace(/_/g, ' ').toLowerCase();
        wikiPage = await this.db.get(statements.findWikiPageByTitle, [normalizedPageName]);
        if (wikiPage) {
            chunkTitle = wikiPage.title || tagName;
            const resolveWikiBody = () => {
                let bodyId = null;
                if (sourceId === this.SOURCE_DANBOORU && wikiPage.danbooru_wiki_id) {
                    bodyId = wikiPage.danbooru_wiki_id;
                } else if (sourceId === this.SOURCE_E621 && wikiPage.e621_wiki_id) {
                    bodyId = wikiPage.e621_wiki_id;
                } else if ((sourceId === this.SOURCE_CUSTOM || bodySource === 'summary') && (wikiPage.danbooru_wiki_id || wikiPage.e621_wiki_id)) {
                    bodyId = wikiPage.danbooru_wiki_id || wikiPage.e621_wiki_id;
                }
                return bodyId;
            };
            const targetBodyId = resolveWikiBody();
            if (targetBodyId) {
                wikiId = targetBodyId;
                const wikiBodyRow = await this.db.get(statements.getWikiBodyById, [targetBodyId]);
                if (wikiBodyRow && wikiBodyRow.body) {
                    wikiBodyText = wikiBodyRow.body;
                    // Determine source from wikiBodyRow or sourceId
                    const wikiSource = (wikiBodyRow.source === 'e621' || sourceId === this.SOURCE_E621) ? 'e621' : 'danbooru';
                    // Use indexed sections from database
                    const sectionsResult = await this.extractWikiSections(wikiBodyText, wikiId, wikiSource);
                    wikiSections = sectionsResult.sections;
                }
            }
        }
    }

    if (!tag && (!wikiPage || !wikiBodyText)) {
        const errorResult = { error: `Tag or wiki page "${tagName}" has no body for source "${bodySource}"` };
        return {
            ...errorResult,
            markdown: this.formatBodyChunkAsMarkdown(errorResult),
            json: errorResult
        };
    }

    let bodyText = null;
    let sections = null;
    let markdownText = null;

    if (wikiBodyText) {
        bodyText = wikiBodyText;
        sections = wikiSections;
    } else {
        const bodyRow = await this.db.get(statements.getBodyBySource, [tag.id, sourceId]);
    
        if (!bodyRow || !bodyRow.body) {
        const errorResult = { error: `Tag "${tagName}" has no body for source "${bodySource}"` };
        return {
            ...errorResult,
            markdown: this.formatBodyChunkAsMarkdown(errorResult),
            json: errorResult
            };
        }
        
        // Extract body text
        bodyText = bodyRow.body;
    }
    
    // Extract sections from database index (will have DText offsets)
    const sourceStr = bodySource === 'e621' ? 'e621' : 'danbooru';
    const sectionsResult = await this.extractWikiSections(bodyText, wikiId, sourceStr, section || null);
    sections = sectionsResult.sections;
    const matchedSection = sectionsResult.resolvedSection;
    
    // Convert full body to markdown for chunking (when no section is specified)
    markdownText = await this.convertWikiMarkupToMarkdown(bodyText, sourceStr, null);
    
    const availableSections = sections.slice(0, this.MAX_SECTION_SUMMARY).map(sectionEntry => ({
        title: sectionEntry.title,
        anchor: sectionEntry.anchor,
        level: sectionEntry.level
    }));
    let targetText = markdownText || bodyText; // Use markdown if available
    let sectionInfo = null;

    if (section) {
        if (sections.length === 0) {
            const errorResult = {
                error: `Tag "${tagName}" has no named sections to match "${section}"`,
                availableSections,
                totalSections: 0
            };
            return {
                ...errorResult,
                markdown: this.formatBodyChunkAsMarkdown(errorResult),
                json: errorResult
            };
        }
        
        // Section was resolved by extractWikiSections
        if (!matchedSection) {
            const errorResult = {
                error: `Section "${section}" not found for tag "${tagName}"`,
                availableSections,
                totalSections: sections.length
            };
            return {
                ...errorResult,
                markdown: this.formatBodyChunkAsMarkdown(errorResult),
                json: errorResult
            };
        }
        
        // Extract the segment from raw DText first, then parse it
        const dtextStart = matchedSection.dtextStartOffset || matchedSection.startOffset;
        const dtextEnd = matchedSection.dtextEndOffset || matchedSection.endOffset;
        const dtextSegment = bodyText.slice(dtextStart, dtextEnd);
        // Parse the segment to markdown
        targetText = await this.convertWikiMarkupToMarkdown(dtextSegment, sourceStr, null);
        sectionInfo = {
            title: matchedSection.title,
            anchor: matchedSection.anchor,
            level: matchedSection.level,
            index: matchedSection.index + 1,
            totalSections: sections.length
        };
    }

    const chunkSize = 1000;
    const startIndex = chunkIndex * chunkSize;

    if (startIndex >= targetText.length) {
        const scopeMessage = sectionInfo ? `section "${sectionInfo.title}"` : 'body length';
        const errorResult = { error: `Chunk ${chunkIndex} is beyond the ${scopeMessage}` };
        return {
            ...errorResult,
            markdown: this.formatBodyChunkAsMarkdown(errorResult),
            json: errorResult
        };
    }

    const endIndex = Math.min(targetText.length, startIndex + chunkSize);
    const chunk = targetText.substring(startIndex, endIndex);
    const totalChunks = Math.ceil(targetText.length / chunkSize);

    const result = {
        tagName: chunkTitle,
        bodySource,
        chunkIndex,
        totalChunks,
        chunkText: chunk.replace(/_/g, ' '), // Already markdown, just replace underscores
        hasMore: endIndex < targetText.length,
        progress: sectionInfo ? `Section "${sectionInfo.title}" chunk ${chunkIndex + 1} of ${totalChunks}` : `Chunk ${chunkIndex + 1} of ${totalChunks}`,
        sectionInfo,
        availableSections: availableSections.length > 0 ? availableSections : undefined,
        totalSections: sections.length || undefined
    };
    
    return {
        markdown: this.formatBodyChunkAsMarkdown(result),
        json: result
    };
}

/**
 * Get dataset group contents with tags and tree structure (from database)
 * @param {Array} path - Path to the group (e.g., ['attire', 'sexual', 'lingerie'])
 * @param {boolean} includeFullTable - If true, include full tag table data
 * @returns {Object} Group contents with tags and tree structure
 */
    async getDatasetGroupContents(path, includeFullTable = false) {
    try {
        
        const statements = this.getStatements();
        
        // Convert path array to database path format (e.g., ['attire', 'sexual', 'lingerie'] -> 'g/attire/sexual/lingerie')
        const dbPath = path.length > 0 ? `g/${path.join('/')}` : 'g';
        
        // First try exact match
        let targetGroup = await this.db.get(statements.getDGroupByPath, [dbPath]);
        
        // If not found, try fuzzy matching (partial path or ending)
        if (!targetGroup && path.length > 0) {
            // Try 1: Search for paths ending with the given path
            const exactEnd = `g/${path.join('/')}`;
            const pathEndPattern = `%/${path.join('/')}`;
            const pathContainsPattern = `%/${path.join('/')}%`;
            const candidates = await this.db.all(statements.searchDGroupsByPathEnd, [
                pathEndPattern,      // Paths ending with the given path (WHERE clause 1)
                pathContainsPattern, // Paths containing the given path (WHERE clause 2)
                exactEnd,            // For ordering: exact match first
                pathEndPattern       // For ordering: ending match second
            ]);
            
            if (candidates.length > 0) {
                // Prefer exact match, then paths that end with the given path
                targetGroup = candidates.find(g => g.path === exactEnd) || candidates[0];
            }
            
            // Try 2: If still not found, search by name (last element)
            if (!targetGroup) {
                const lastName = path[path.length - 1];
                const nameCandidates = await this.db.all(statements.searchDGroupsByName, [
                    `%${lastName}%`, `%${lastName}%`, lastName, lastName, `${lastName}%`, `${lastName}%`
                ]);
                
                if (nameCandidates.length > 0) {
                    // Prefer groups that are leaf nodes (have tags) and match the name exactly
                    for (const g of nameCandidates) {
                        const tags = await this.db.all(statements.getDatasetGroupTags, [g.id]);
                        if (tags.length > 0 && g.name.toLowerCase() === lastName.toLowerCase()) {
                            targetGroup = g;
                            break;
                        }
                    }
                    if (!targetGroup) {
                        targetGroup = nameCandidates[0];
                    }
                }
            }
            
            // Try 3: If still not found and path has parent, search for similar names under parent (including nested)
            if (!targetGroup && path.length >= 2) {
                const parentPath = path.slice(0, -1);
                const lastName = path[path.length - 1];
                const parentDbPath = `g/${parentPath.join('/')}`;
                
                // Get parent group to find its children
                const parentGroup = await this.db.get(statements.getDGroupByPath, [parentDbPath]);
                if (parentGroup) {
                    // Recursive async function to search children and nested children
                    const findSimilarGroup = async (group, searchName) => {
                        const children = await this.db.all(statements.getDGroupChildren, [group.id]);
                        
                        // First, check direct children
                        for (const child of children) {
                            const childNameLower = child.name.toLowerCase();
                            const searchNameLower = searchName.toLowerCase();
                            
                            // Check if one name contains the other (for cases like "bottomwear" -> "bottom")
                            const nameSimilar = childNameLower.includes(searchNameLower) || 
                                                searchNameLower.includes(childNameLower) ||
                                                // Or check if they share a significant prefix (first 4+ chars)
                                                (childNameLower.length >= 4 && searchNameLower.length >= 4 && 
                                                 childNameLower.substring(0, 4) === searchNameLower.substring(0, 4));
                            
                            if (nameSimilar) {
                                // Verify this group has tags (is a leaf node)
                                const tags = await this.db.all(statements.getDatasetGroupTags, [child.id]);
                                if (tags.length > 0) {
                                    return child;
                                }
                            }
                            
                            // Also check nested children (one level deep)
                            const nestedMatch = await findSimilarGroup(child, searchName);
                            if (nestedMatch) {
                                return nestedMatch;
                            }
                        }
                        
                        return null;
                    };
                    
                    const similarGroup = await findSimilarGroup(parentGroup, lastName);
                    if (similarGroup) {
                        targetGroup = similarGroup;
                    }
                }
            }
        }
        
        if (!targetGroup) {
            // Try to provide helpful suggestions
            let suggestions = null;
            if (path.length >= 2) {
                const parentPath = path.slice(0, -1);
                const parentDbPath = `g/${parentPath.join('/')}`;
                const parentGroup = await this.db.get(statements.getDGroupByPath, [parentDbPath]);
                
                if (parentGroup) {
                    const siblings = await this.db.all(statements.getDGroupChildren, [parentGroup.id]);
                    if (siblings.length > 0) {
                        const siblingNames = siblings.slice(0, 5).map(s => s.name).join(', ');
                        suggestions = `Available groups under "${parentPath.join(' > ')}": ${siblingNames}${siblings.length > 5 ? '...' : ''}`;
                    }
                }
            }
            
            return {
                error: `Path not found: ${path.join(' > ')}`,
                path: path,
                suggestions: suggestions || (path.length > 0 ? 'Try providing a more specific path or check available groups' : null)
            };
        }
        
        // If we found a match but it's not the exact path, note it
        const matchedPath = targetGroup.path === 'g' ? [] : targetGroup.path.substring(2).split('/');
        const pathMismatch = matchedPath.join('/') !== path.join('/');
        
        // Get all tags in this group from dataset_group_members
        const tagRows = await this.db.all(statements.getDatasetGroupTags, [targetGroup.id]);
        
        if (tagRows.length === 0) {
            // Check if this group has children (it's a branch, not a leaf)
            const children = await this.db.all(statements.getDGroupChildren, [targetGroup.id]);
            if (children.length > 0) {
                return {
                    error: `Path "${path.join(' > ')}" does not point to a tag array. It points to a group with ${children.length} children.`,
                    path: path,
                    hasChildren: true,
                    childrenCount: children.length
                };
            }
        }
        
        // Rank tags by usage
        const rankedTags = tagRows.map(row => {
            const tag = this.mapRowToTag(row);
            return {
                id: tag.id,
                name: tag.name,
                title: tag.title,
                usage: this.getUsageCount(row),
                category: tag.category,
                categoryName: this.getCategoryName(tag.category),
                d_count: row.d_count || 0,
                e_count: row.e_count || 0,
                n_count: row.n_count || 0,
                is_locked: row.is_locked || false,
                untrained: row.untrained || false
            };
        });
        
        // Sort by usage (descending)
        rankedTags.sort((a, b) => b.usage - a.usage);
        
        // Build full tree structure from root to target (showing all siblings at each level)
        // Get path chain from root to target
        const pathChain = await this.db.all(statements.getDGroupPathChain, [targetGroup.id]);
        
        const tree = [];
        const targetPathArray = matchedPath;
        
        for (let i = 0; i < pathChain.length; i++) {
            const group = pathChain[i];
            const children = await this.db.all(statements.getDGroupChildren, [group.id]);
            
            // Convert database path back to array path for display
            const pathArray = group.path === 'g' ? [] : group.path.substring(2).split('/');
            
            // Get metadata from database
            const prettyName = group.pretty_name || group.name;
            const description = group.description || '';
            const icon = group.icon || null;
            
            // Get array metadata for children (from d_group_array_metadata table)
            const arrayMetadataMap = new Map();
            const arrayMetadata = await this.db.all(statements.getDGroupArrayMetadata, [group.id]);
            for (const meta of arrayMetadata) {
                arrayMetadataMap.set(meta.child_name, {
                    prettyName: meta.pretty_name,
                    icon: meta.icon
                });
            }
            
            // Build children list with metadata from database (show ALL children, not just one level)
            const childrenList = await Promise.all(children.map(async child => {
                // Check if child is a leaf (has tags) or branch (has children)
                const childTags = await this.db.all(statements.getDatasetGroupTags, [child.id]);
                const childChildren = await this.db.all(statements.getDGroupChildren, [child.id]);
                const isTagArray = childTags.length > 0 && childChildren.length === 0;
                
                // Get metadata for child from database
                let childPrettyName = child.pretty_name || child.name;
                let childIcon = child.icon || null;
                
                // If this is an array child, check array metadata from parent
                if (isTagArray && arrayMetadataMap.has(child.name)) {
                    const arrayMeta = arrayMetadataMap.get(child.name);
                    if (arrayMeta.prettyName) {
                        childPrettyName = arrayMeta.prettyName;
                    }
                    if (arrayMeta.icon) {
                        childIcon = arrayMeta.icon;
                    }
                }
                
                // Check if this child is on the path to target (for highlighting)
                const childPathArray = child.path === 'g' ? [] : child.path.substring(2).split('/');
                const isOnPath = i < targetPathArray.length && 
                    childPathArray.length === targetPathArray.slice(0, childPathArray.length).length &&
                    childPathArray.every((seg, idx) => seg === targetPathArray[idx]);
                const isTarget = childPathArray.join('/') === targetPathArray.join('/');
                
                return {
                    name: child.name,
                    prettyName: childPrettyName,
                    description: child.description || '',
                    path: childPathArray,
                    hasChildren: childChildren.length > 0,
                    itemCount: isTagArray ? childTags.length : childChildren.length,
                    icon: childIcon,
                    isTagArray: isTagArray,
                    isOnPath: isOnPath,
                    isTarget: isTarget
                };
            }));
            
            // Sort children: target first, then path children, then others
            childrenList.sort((a, b) => {
                if (a.isTarget) return -1;
                if (b.isTarget) return 1;
                if (a.isOnPath && !b.isOnPath) return -1;
                if (!a.isOnPath && b.isOnPath) return 1;
                return a.prettyName.localeCompare(b.prettyName);
            });
            
            tree.push({
                level: i,
                path: pathArray,
                name: group.name,
                prettyName: prettyName,
                description: description,
                icon: icon,
                children: childrenList,
                isCurrentLevel: i === pathChain.length - 1
            });
        }
        
        // Get metadata for the target group from database
        let targetMetadata = null;
        if (targetGroup.pretty_name || targetGroup.icon) {
            targetMetadata = {
                prettyName: targetGroup.pretty_name || targetGroup.name,
                icon: targetGroup.icon || null
            };
        } else {
            // Check if parent has array metadata for this group
            if (targetGroup.parent_id) {
                const parentGroup = await this.db.get(statements.getDGroupById, [targetGroup.parent_id]);
                if (parentGroup) {
                    const arrayMetadata = await this.db.all(statements.getDGroupArrayMetadata, [parentGroup.id]);
                    for (const meta of arrayMetadata) {
                        if (meta.child_name === targetGroup.name) {
                            targetMetadata = {
                                prettyName: meta.pretty_name || targetGroup.name,
                                icon: meta.icon || null
                            };
                            break;
                        }
                    }
                }
            }
        }
        
        // Build display path strings using pretty names from tree
        const buildDisplayPath = (pathArray) => {
            if (pathArray.length === 0) return 'root';
            const displayParts = [];
            for (let i = 0; i < pathArray.length; i++) {
                // Build the path up to this point
                const currentPath = pathArray.slice(0, i + 1);
                // Find the corresponding level in the tree that matches this path
                const level = tree.find(l => {
                    if (l.path.length !== currentPath.length) return false;
                    return l.path.every((seg, idx) => seg === currentPath[idx]);
                });
                if (level) {
                    const displayName = level.prettyName || level.name;
                    displayParts.push(displayName);
                } else {
                    // Fallback to path element if level not found
                    displayParts.push(pathArray[i]);
                }
            }
            return displayParts.join(' > ');
        };
        
        const displayPathString = buildDisplayPath(pathMismatch ? matchedPath : path);
        const originalPathString = path.join(' > ');
        const matchedDisplayPathString = pathMismatch ? buildDisplayPath(matchedPath) : undefined;
        
        return {
            path: path,
            matchedPath: pathMismatch ? matchedPath : undefined,
            pathString: originalPathString,
            matchedPathString: matchedDisplayPathString,
            displayPathString: displayPathString,
            metadata: targetMetadata,
            tags: rankedTags,
            tagCount: rankedTags.length,
            tree: tree,
            summary: `Found ${rankedTags.length} tags in group "${displayPathString}"${pathMismatch ? ` (matched from "${originalPathString}")` : ''}`
        };
    } catch (error) {
        console.error('Error getting dataset group contents:', error);
        return {
            error: `Failed to get group contents: ${error.message}`,
            path: path
        };
    }
}

/**
 * Handles getDatasetGroupContents tool call
 * @param {Object} params - Tool parameters
 * @param {Object} buildOptions - Current build options (read-only)
 * @returns {Object} Group contents with markdown and json properties
 */
    async handleGetDatasetGroupContents(params, buildOptions = {}) {
    const { path, includeFullTable = false, reason } = params;
    
    if (reason) {
        console.log(`  [REASON] ${reason}`);
    }
    
    // Support both string and array paths
    let pathArray = path;
    if (typeof path === 'string') {
        // Convert string path to array (handle both " > " and "/" separators)
        pathArray = path.split(/\s*>\s*|\s*\/\s*/).filter(p => p.trim().length > 0);
    }
    
    if (!pathArray || !Array.isArray(pathArray) || pathArray.length === 0) {
        const errorResult = { error: 'Path is required and must be a non-empty array or string' };
        return {
            ...errorResult,
            markdown: `## Error\n\n${errorResult.error}`,
            json: errorResult
        };
    }
    
    const result = await this.getDatasetGroupContents(pathArray, includeFullTable);
    
    if (result.error) {
        return {
            ...result,
            markdown: `## Error\n\n${result.error}`,
            json: result
        };
    }
    
    // Format as markdown - use metadata for display names
    const displayPath = result.displayPathString || result.matchedPathString || result.pathString;
    const displayName = result.metadata?.prettyName || displayPath.split(' > ').pop() || displayPath;
    
    let markdown = `# ${displayName}\n\n`;
    markdown += `*Path: ${displayPath}*\n\n`;
    
    // Show if path was matched (fuzzy search) - don't show the matched text item
    if (result.matchedPath && result.matchedPathString && result.matchedPathString !== result.pathString) {
        const originalPath = result.pathString;
        const matchedPath = result.displayPathString || result.matchedPathString;
        markdown += `*Matched from: ${originalPath} → ${matchedPath}*\n\n`;
    }
    
    if (result.metadata?.description) {
        markdown += `${result.metadata.description}\n\n`;
    }
    
    markdown += `**Tag Count:** ${result.tagCount}\n\n`;
    
    // Tree structure - show full hierarchy for navigation (progression to target)
    if (result.tree && result.tree.length > 0) {
        markdown += `## Hierarchy\n\n`;
        const targetPathStr = (result.matchedPath || result.path).join('/');
        const displayedPaths = new Set(); // Track what we've already displayed to avoid duplicates
        
        result.tree.forEach((level, idx) => {
            const levelPathStr = level.path.join('/');
            const levelDepth = level.path.length;
            const indent = '  '.repeat(levelDepth);
            const pathStr = level.path.length > 0 ? level.path.join(' > ') : 'root';
            const isOnPath = levelPathStr === targetPathStr || targetPathStr.startsWith(levelPathStr + '/');
            const displayName = level.prettyName || level.name || (level.path.length === 0 ? 'Root' : 'Unknown');
            const pathElementName = level.path.length > 0 ? level.path[level.path.length - 1] : 'root';
            const nameDisplay = displayName.toLowerCase() === pathElementName.toLowerCase() 
                ? displayName 
                : `${displayName} (${pathElementName})`;
            
            // Only show the level itself if we haven't shown it yet (it might be shown as a child of previous level)
            if (!displayedPaths.has(levelPathStr)) {
                if (isOnPath) {
                    markdown += `${indent}- **→ ${nameDisplay}** - \`${pathStr}\`\n`;
                } else {
                    markdown += `${indent}- ${nameDisplay} - \`${pathStr}\`\n`;
                }
                displayedPaths.add(levelPathStr);
            }
            
            // Show children for each level along the path
            // Children should be indented one level deeper than their parent
            if (level.children && level.children.length > 0) {
                level.children.forEach(child => {
                    const childPathStr = child.path.join('/');
                    // Only show if we haven't displayed it yet
                    if (!displayedPaths.has(childPathStr)) {
                        // Indent children one level deeper than their parent (relative indentation)
                        const childIndent = '  '.repeat(levelDepth + 1);
                        const childType = child.isTagArray ? 'Tags' : 'Group';
                        const childPathDisplay = child.path.length > 0 ? child.path.join(' > ') : 'root';
                        const isTarget = childPathStr === targetPathStr;
                        const childDisplayName = child.prettyName || child.name || 'Unknown';
                        const childPathElementName = child.path.length > 0 ? child.path[child.path.length - 1] : 'root';
                        const childNameDisplay = childDisplayName.toLowerCase() === childPathElementName.toLowerCase()
                            ? childDisplayName
                            : `${childDisplayName} (${childPathElementName})`;
                        if (isTarget) {
                            markdown += `${childIndent}- **→ ${childNameDisplay}** (${childType}, ${child.itemCount}) - \`${childPathDisplay}\`\n`;
                        } else {
                            markdown += `${childIndent}- ${childNameDisplay} (${childType}, ${child.itemCount}) - \`${childPathDisplay}\`\n`;
                        }
                        displayedPaths.add(childPathStr);
                    }
                });
            }
        });
        markdown += `\n`;
    }
    
    // Tags list - show simplified list by default, full table only if includeFullTable is true
    if (includeFullTable) {
        // Full table format using formatTagCollectionSection
        // Enrich tags with body data for previews - use projectTagResult to get proper body format
        const enrichedTags = await Promise.all((result.tags || []).map(async tag => {
            const enriched = await this.projectTagResult({
                id: tag.id,
                name: tag.name,
                title: tag.title
            }, [], false, tag.name || tag.title || '');
            return {
                id: enriched.id || tag.id || null,
                title: enriched.title || tag.title || tag.name || '',
                displayTitle: enriched.title || tag.title || tag.name || '',
                d_count: tag.d_count !== undefined ? tag.d_count : null,
                e_count: tag.e_count !== undefined ? tag.e_count : null,
                n_count: tag.n_count !== undefined ? tag.n_count : null,
                category: enriched.category !== undefined ? enriched.category : tag.category !== undefined ? tag.category : null,
                categoryName: enriched.categoryName || tag.categoryName || null,
                searchTerm: tag.name || tag.title || '',
                error: tag.notFound ? 'Tag not found in database' : null,
                body: enriched.body,
                bodyMemory: enriched.bodyMemory,
                bodySource: enriched.bodySource,
                bodyMemorySource: enriched.bodyMemorySource,
                bodyMemoryDescription: enriched.bodyMemoryDescription,
                bodySections: enriched.bodySections,
                bodyTotalSections: enriched.bodyTotalSections,
                tagWikiMentions: enriched.tagWikiMentions,
                groupMembers: enriched.groupMembers,
                tagGroupPages: enriched.tagGroupPages
            };
        }));
        
        const note = `Found ${enrichedTags.length} tag${enrichedTags.length !== 1 ? 's' : ''} in group "${result.matchedPathString || result.pathString}"`;
        markdown += await this.formatTagCollectionSection('Tags (Ranked by Usage)', enrichedTags, {
            note: note,
            showEmptyMessage: true,
            previewLimit: this.MAX_BODY_PREVIEWS
        });
    } else {
        // Simplified list format (default)
        markdown += `## Tags\n\n`;
        if (result.tags && result.tags.length > 0) {
            const note = `Found ${result.tags.length} tag${result.tags.length !== 1 ? 's' : ''} in group "${result.matchedPathString || result.pathString}"`;
            markdown += `*${note}*\n\n`;
            result.tags.forEach((tag) => {
                const category = tag.categoryName ? ` (${tag.categoryName})` : '';
                const displayTagName = tag.name.replace(/_/g, ' ');
                markdown += `- **${displayTagName}**${category}\n`;
            });
        } else {
            markdown += `*No tags found*\n`;
        }
    }
    
    // Check if the current group has a wiki page or tag_group page
    
    const statements = this.getStatements();
    const groupPath = result.matchedPath || result.path;
    let groupWikiPage = null;
    
    if (groupPath && groupPath.length > 0) {
        // Try to find a wiki page or tag_group page for this group
        // Try different variations: last element, last two elements, full path
        const searchTerms = [];
        if (groupPath.length >= 1) {
            searchTerms.push(groupPath[groupPath.length - 1]); // Last element
        }
        if (groupPath.length >= 2) {
            searchTerms.push(groupPath.slice(-2).join('_')); // Last two elements
        }
        if (groupPath.length >= 3) {
            searchTerms.push(groupPath.slice(-3).join('_')); // Last three elements
        }
        searchTerms.push(groupPath.join('_')); // Full path
        
        // Also try with the pretty name if available
        if (result.metadata && result.metadata.prettyName) {
            const prettyNameNormalized = result.metadata.prettyName.toLowerCase().replace(/[^a-z0-9]+/g, '_');
            searchTerms.push(prettyNameNormalized);
        }
        
        // Search for tag_group pages
        for (const term of searchTerms) {
            const searchPattern = `%${term.toLowerCase()}%`;
            const groupPages = await this.db.all(statements.searchGroupPagesByTitle, [searchPattern, 5]);
            if (groupPages && groupPages.length > 0) {
                // Prefer exact match on the last element
                groupWikiPage = groupPages.find(p => {
                    const titleLower = p.title.toLowerCase();
                    return titleLower.includes(`tag_group:${term}`) || titleLower.includes(`tag group:${term}`);
                }) || groupPages[0];
                if (groupWikiPage) break;
            }
        }
        
        // If no tag_group found, try regular wiki pages
        if (!groupWikiPage) {
            for (const term of searchTerms.slice(0, 2)) { // Only try last element and last two
                const normalizedTerm = term.replace(/_/g, ' ').toLowerCase();
                const wikiPageMeta = await this.db.get(statements.findWikiPageByTitle, [normalizedTerm]);
                if (wikiPageMeta) {
                    // Get the actual wiki body from the wikis table
                    let wikiBody = null;
                    let source = 'danbooru';
                    if (wikiPageMeta.danbooru_wiki_id) {
                        const wikiRow = await this.db.get(statements.getWikiBodyById, [wikiPageMeta.danbooru_wiki_id]);
                        if (wikiRow && wikiRow.body) {
                            wikiBody = wikiRow.body;
                            source = 'danbooru';
                        }
                    }
                    if (!wikiBody && wikiPageMeta.e621_wiki_id) {
                        const wikiRow = await this.db.get(statements.getWikiBodyById, [wikiPageMeta.e621_wiki_id]);
                        if (wikiRow && wikiRow.body) {
                            wikiBody = wikiRow.body;
                            source = 'e621';
                        }
                    }
                    if (wikiBody) {
                        groupWikiPage = {
                            id: wikiPageMeta.id,
                            title: wikiPageMeta.title,
                            body: wikiBody,
                            source: source
                        };
                        break;
                    }
                }
            }
        }
    }
    
    // Show body preview for the group wiki/tag_group page if found
    if (groupWikiPage && groupWikiPage.body) {
        markdown += `\n## Group Documentation\n\n`;
        const bodyPreview = (await this.convertWikiMarkupToMarkdown(groupWikiPage.body, groupWikiPage.source || 'danbooru', null)).replace(/_/g, ' ');
        const previewLength = Math.min(500, bodyPreview.length);
        const preview = bodyPreview.substring(0, previewLength);
        markdown += preview;
        if (bodyPreview.length > previewLength) {
            markdown += `\n\n*... ${bodyPreview.length - previewLength} more characters*`;
        }
        markdown += `\n\n*Source: ${groupWikiPage.title} (${groupWikiPage.source || 'unknown'})*\n`;
    }
    
    return {
        markdown: markdown,
        json: result
    };
}

/**
 * Get information about tag groups from the database
 * Returns tag groups that can be used in system prompts
 * Cached after first call
 */
    getTagGroupsInfo() {
    // Return cached result if available
    if (this.cachedTagGroupsInfo !== null) {
        return this.cachedTagGroupsInfo;
    }

    try {
        const filePath = path.join(__dirname, '../dataset_tag_groups.json');
        const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));

        const formattedGroups = Object.entries(raw).map(([key, value]) => {
            if (!value || typeof value !== 'object') {
                return null;
            }

            const metadata = value._metadata || {};
            const readableName = (metadata.prettyName || key).replace(/_/g, ' ');
            const description = metadata.description || `Category of related tags for ${readableName}`;

            return {
                name: readableName,
                description
            };
        }).filter(Boolean);

        this.cachedTagGroupsInfo = {
            tagGroups: formattedGroups,
            summary: `Found ${formattedGroups.length} tag categories`
        };
    } catch (error) {
        console.warn('Failed to load dataset tag groups:', error.message);
        this.cachedTagGroupsInfo = {
            tagGroups: [],
            summary: 'No tag groups available'
        };
    }

    return this.cachedTagGroupsInfo;
}

/**
 * Get hierarchical category structure for system message
 * @returns {Array} Array of formatted strings representing the category hierarchy
 */
    async getDatasetCategoryHierarchy() {
    try {
        
        const statements = this.getStatements();
        const sections = [];
        
        // Get root group (path = 'g')
        let rootGroup = await this.db.get(statements.getDGroupByPath, ['g']);
        
        // If not found, try to get root groups by parent_id
        if (!rootGroup) {
            const rootGroups = await this.db.all(statements.getRootGroups, []);
            if (rootGroups.length > 0) {
                rootGroup = rootGroups[0];
            }
        }
        
        if (!rootGroup) {
            console.error('No root group found in database');
            return ['*Category hierarchy not available - root group not found*'];
        }
        
        // Recursive async function to build tree structure
        const buildTree = async (groupId, currentPath = [], depth = 0, maxDepth = 4) => {
            if (depth > maxDepth) return [];
            
            const indent = '  '.repeat(depth);
            const items = [];
            
            // Get children of this group
            const children = await this.db.all(statements.getDGroupChildren, [groupId]);
            
            for (const child of children) {
                const newPath = [...currentPath, child.name];
                const pathString = JSON.stringify(newPath);
                
                // Check if this group has tags (is a leaf node)
                const tags = await this.db.all(statements.getDatasetGroupTags, [child.id]);
                const tagCount = tags.length;
                
                // Check if it has children (is a branch node)
                const childGroups = await this.db.all(statements.getDGroupChildren, [child.id]);
                const hasChildren = childGroups.length > 0;
                
                if (tagCount > 0) {
                    // This is a tag array (leaf node)
                    const displayName = child.pretty_name || child.name;
                    items.push(`${indent}* **${displayName}** (${tagCount} tags) - Path: \`${pathString}\``);
                } else if (hasChildren) {
                    // This is a category (branch node)
                    const displayName = child.pretty_name || child.name;
                    items.push(`${indent}* **${displayName}** (\`${child.name}\`) - Path: \`${pathString}\``);
                    
                    // Recursively process children
                    const childItems = await buildTree(child.id, newPath, depth + 1, maxDepth);
                    if (childItems.length > 0) {
                        items.push(...childItems);
                    }
                } else {
                    // Empty group (no tags, no children) - still show it
                    const displayName = child.pretty_name || child.name;
                    items.push(`${indent}* **${displayName}** (\`${child.name}\`) - Path: \`${pathString}\` (empty)`);
                }
            }
            
            return items;
        };
        
        const treeItems = await buildTree(rootGroup.id, [], 0, 4);
        sections.push(...treeItems);
        
        return sections;
    } catch (error) {
        console.error('Error building dataset category hierarchy:', error);
        return ['*Error loading category hierarchy*'];
    }
}

    /**
     * Normalize title for booru API lookup (Danbooru/e621).
     * Strips NovelAI namespace prefixes and converts spaces to underscores.
     */
    normalizeTitleForUrl(title) {
        if (!title) return '';
        let normalized = title.trim();
        normalized = normalized.replace(/\\/g, '');
        normalized = normalized.replace(/^(?:species|invalid):/i, '');
        return normalized.replace(/\s+/g, '_').trim();
    }

    /**
     * Canonical underscore tag name for booru wiki/tag API calls.
     */
    resolveBooruWikiTagName(title) {
        return this.normalizeTitleForUrl(title);
    }

    /**
     * Title variants for wiki row lookup (DB may store spaces or underscores).
     */
    getWikiTitleLookupVariants(title) {
        const variants = new Set();
        if (!title) return [];
        const raw = String(title).trim();
        const booru = this.resolveBooruWikiTagName(raw);
        const spaced = booru.replace(/_/g, ' ');
        variants.add(raw.toLowerCase());
        if (booru) variants.add(booru.toLowerCase());
        if (spaced) variants.add(spaced.toLowerCase());
        return [...variants];
    }

    formatBooruTagDisplayTitle(booruName) {
        if (!booruName) return '';
        return String(booruName).replace(/_/g, ' ').trim();
    }

    /**
     * Fetch JSON data from URL
     */
    async fetchJson(url, retries = 0) {
        return new Promise((resolve, reject) => {
            const urlObj = new URL(url);
            const client = urlObj.protocol === 'https:' ? https : http;
            
            const userAgent = 'StaticForge/1.0 (https://staticforge.app)';
            
            const options = {
                hostname: urlObj.hostname,
                port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
                path: urlObj.pathname + urlObj.search,
                method: 'GET',
                headers: {
                    'User-Agent': userAgent,
                    'Accept': 'application/json'
                },
                timeout: 30000
            };

            const req = client.get(options, (res) => {
                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    try {
                        if (res.statusCode === 404) {
                            resolve(null);
                            return;
                        }
                        if (res.statusCode === 429 && retries < 3) {
                            setTimeout(() => {
                                this.fetchJson(url, retries + 1).then(resolve).catch(reject);
                            }, 1000 * (retries + 1));
                            return;
                        }
                        if (res.statusCode !== 200) {
                            reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
                            return;
                        }
                        resolve(JSON.parse(data));
                    } catch (error) {
                        reject(new Error(`Failed to parse JSON: ${error.message}`));
                    }
                });
            });

            req.on('error', (error) => {
                if (retries < 3) {
                    setTimeout(() => {
                        this.fetchJson(url, retries + 1).then(resolve).catch(reject);
                    }, 1000 * (retries + 1));
                } else {
                    reject(error);
                }
            });

            req.on('timeout', () => {
                req.destroy();
                if (retries < 3) {
                    setTimeout(() => {
                        this.fetchJson(url, retries + 1).then(resolve).catch(reject);
                    }, 1000 * (retries + 1));
                } else {
                    reject(new Error('Request timeout'));
                }
            });
        });
    }

    /**
     * Fetch wiki page from Danbooru API by title
     */
    async fetchDanbooruWikiByTitle(title) {
        const DANBOORU_API_BASE = 'https://danbooru.donmai.us';
        const urlTitle = this.normalizeTitleForUrl(title);
        const encodedTitle = encodeURIComponent(urlTitle);
        const url = `${DANBOORU_API_BASE}/wiki_pages.json?search[title]=${encodedTitle}&limit=1`;
        
        try {
            const results = await this.fetchJson(url);
            if (results && Array.isArray(results) && results.length > 0) {
                const normalizedSearch = urlTitle.toLowerCase();
                const exactMatch = results.find(w => {
                    if (!w.title) return false;
                    const normalizedWiki = w.title.toLowerCase().replace(/\s+/g, '_');
                    return normalizedWiki === normalizedSearch || 
                        w.title.toLowerCase() === urlTitle.toLowerCase();
                });
                if (exactMatch) {
                    return exactMatch;
                }
                return results[0];
            }
            
            // Try fetching tag to see if it has a wiki_id
            const tagUrl = `${DANBOORU_API_BASE}/tags.json?search[name]=${encodedTitle}&limit=1`;
            const tagResults = await this.fetchJson(tagUrl);
            if (tagResults && Array.isArray(tagResults) && tagResults.length > 0) {
                const tag = tagResults[0];
                if (tag.wiki_page_id || tag.wiki_id) {
                    const wikiId = tag.wiki_page_id || tag.wiki_id;
                    const wikiUrl = `${DANBOORU_API_BASE}/wiki_pages/${wikiId}.json`;
                    const wikiResult = await this.fetchJson(wikiUrl);
                    if (wikiResult) {
                        return wikiResult;
                    }
                }
            }
            
            return null;
        } catch (error) {
            console.error(`Error fetching Danbooru wiki "${title}": ${error.message}`);
            return null;
        }
    }

    /**
     * Fetch wiki page from e621 API by title
     */
    async fetchE621WikiByTitle(title) {
        const E621_API_BASE = 'https://e621.net';
        const urlTitle = this.normalizeTitleForUrl(title);
        const encodedTitle = encodeURIComponent(urlTitle);
        const url = `${E621_API_BASE}/wiki_pages.json?search[title]=${encodedTitle}&limit=10`;
        
        try {
            const results = await this.fetchJson(url);
            if (results && Array.isArray(results) && results.length > 0) {
                const normalizedTitle = urlTitle.toLowerCase();
                const exactMatch = results.find(w => {
                    if (!w.title) return false;
                    const normalizedWikiTitle = w.title.toLowerCase().replace(/\s+/g, '_');
                    return normalizedWikiTitle === normalizedTitle || 
                        w.title.toLowerCase() === urlTitle.toLowerCase();
                });
                if (exactMatch) {
                    return exactMatch;
                }
                return results[0];
            }
            
            // Try fetching tag
            const tagUrl = `${E621_API_BASE}/tags.json?search[name]=${encodedTitle}&limit=1`;
            const tagResults = await this.fetchJson(tagUrl);
            if (tagResults && Array.isArray(tagResults) && tagResults.length > 0) {
                // e621 tags don't have wiki_id directly, wiki pages have same title as tag
                // Already tried above, so if not found, tag doesn't have a wiki
            }
            
            return null;
        } catch (error) {
            console.error(`Error fetching e621 wiki "${title}": ${error.message}`);
            return null;
        }
    }

    /**
     * Build wildcard pattern for booru tag name search from user query.
     */
    buildOnlineSearchPattern(query) {
        const normalized = this.normalizeTitleForUrl(query);
        if (!normalized) return '';
        const tokens = normalized.split('_').filter(Boolean);
        if (tokens.length === 0) return '';
        if (tokens.length === 1) return `*${tokens[0]}*`;
        return `*${tokens.join('*')}*`;
    }

    normalizeTagMatchKey(title) {
        return this.normalizeTitleForUrl(title).toLowerCase();
    }

    mapOnlineTagResult(tag, sourceName) {
        const name = this.resolveBooruWikiTagName(tag.name || '');
        return {
            id: null,
            title: this.formatBooruTagDisplayTitle(name),
            name,
            category: tag.category,
            categoryName: this.getCategoryName(tag.category),
            source: [sourceName],
            hasWiki: false,
            onlineOnly: true,
            matchType: 'online-tag'
        };
    }

    mapOnlineWikiPageResult(page, sourceName) {
        const name = this.resolveBooruWikiTagName(page.title || page.name || '');
        return {
            id: null,
            title: this.formatBooruTagDisplayTitle(name),
            name,
            category: page.category_id ?? page.category,
            categoryName: this.getCategoryName(page.category_id ?? page.category),
            source: [sourceName],
            hasWiki: true,
            onlineOnly: true,
            matchType: 'online'
        };
    }

    async searchDanbooruTagsOnline(query, limit = 25) {
        const pattern = this.buildOnlineSearchPattern(query);
        const normalized = this.normalizeTitleForUrl(query);
        if (!pattern && !normalized) return [];

        const DANBOORU_API_BASE = 'https://danbooru.donmai.us';
        const urls = [];
        if (normalized) {
            urls.push(`${DANBOORU_API_BASE}/tags.json?search[name]=${encodeURIComponent(normalized)}&limit=${limit}`);
        }
        if (pattern) {
            urls.push(`${DANBOORU_API_BASE}/tags.json?search[name_matches]=${encodeURIComponent(pattern)}&limit=${limit}`);
        }

        try {
            const byName = new Map();
            for (const url of urls) {
                const results = await this.fetchJson(url);
                if (!results || !Array.isArray(results)) continue;
                for (const tag of results) {
                    if (!tag.name) continue;
                    byName.set(tag.name.toLowerCase(), tag);
                }
            }
            return [...byName.values()].map(tag => this.mapOnlineTagResult(tag, 'danbooru'));
        } catch (error) {
            console.error(`Error searching Danbooru tags online for "${query}": ${error.message}`);
            return [];
        }
    }

    async searchDanbooruWikiPagesOnline(query, limit = 25) {
        const normalized = this.normalizeTitleForUrl(query);
        const pattern = this.buildOnlineSearchPattern(query);
        if (!normalized && !pattern) return [];

        const DANBOORU_API_BASE = 'https://danbooru.donmai.us';
        const urls = [];
        if (normalized) {
            urls.push(`${DANBOORU_API_BASE}/wiki_pages.json?search[title]=${encodeURIComponent(normalized)}&limit=${limit}`);
        }
        if (pattern) {
            urls.push(`${DANBOORU_API_BASE}/wiki_pages.json?search[title_matches]=${encodeURIComponent(pattern)}&limit=${limit}`);
        }

        try {
            const byTitle = new Map();
            for (const url of urls) {
                const results = await this.fetchJson(url);
                if (!results || !Array.isArray(results)) continue;
                for (const page of results) {
                    if (!page.title) continue;
                    byTitle.set(page.title.toLowerCase(), page);
                }
            }
            return [...byTitle.values()].map(page => this.mapOnlineWikiPageResult(page, 'danbooru'));
        } catch (error) {
            console.error(`Error searching Danbooru wiki pages online for "${query}": ${error.message}`);
            return [];
        }
    }

    async searchE621TagsOnline(query, limit = 25) {
        const pattern = this.buildOnlineSearchPattern(query);
        const normalized = this.normalizeTitleForUrl(query);
        if (!pattern && !normalized) return [];

        const E621_API_BASE = 'https://e621.net';
        const urls = [];
        if (normalized) {
            urls.push(`${E621_API_BASE}/tags.json?search[name]=${encodeURIComponent(normalized)}&limit=${limit}`);
        }
        if (pattern) {
            urls.push(`${E621_API_BASE}/tags.json?search[name_matches]=${encodeURIComponent(pattern)}&limit=${limit}`);
        }

        try {
            const byName = new Map();
            for (const url of urls) {
                const results = await this.fetchJson(url);
                if (!results || !Array.isArray(results)) continue;
                for (const tag of results) {
                    if (!tag.name) continue;
                    byName.set(tag.name.toLowerCase(), tag);
                }
            }
            return [...byName.values()].map(tag => this.mapOnlineTagResult(tag, 'e621'));
        } catch (error) {
            console.error(`Error searching e621 tags online for "${query}": ${error.message}`);
            return [];
        }
    }

    async searchE621WikiPagesOnline(query, limit = 25) {
        const normalized = this.normalizeTitleForUrl(query);
        const pattern = this.buildOnlineSearchPattern(query);
        if (!normalized && !pattern) return [];

        const E621_API_BASE = 'https://e621.net';
        const urls = [];
        if (normalized) {
            urls.push(`${E621_API_BASE}/wiki_pages.json?search[title]=${encodeURIComponent(normalized)}&limit=${limit}`);
        }
        if (pattern) {
            urls.push(`${E621_API_BASE}/wiki_pages.json?search[title_matches]=${encodeURIComponent(pattern)}&limit=${limit}`);
        }

        try {
            const byTitle = new Map();
            for (const url of urls) {
                const results = await this.fetchJson(url);
                if (!results || !Array.isArray(results)) continue;
                for (const page of results) {
                    if (!page.title) continue;
                    byTitle.set(page.title.toLowerCase(), page);
                }
            }
            return [...byTitle.values()].map(page => this.mapOnlineWikiPageResult(page, 'e621'));
        } catch (error) {
            console.error(`Error searching e621 wiki pages online for "${query}": ${error.message}`);
            return [];
        }
    }

    /**
     * Search Danbooru and e621 tag/wiki APIs in parallel.
     * @param {string} query - User search query (spaces/species: prefix normalized internally)
     * @param {Object} options - { source: 'both'|'danbooru'|'e621', limit: number }
     */
    async searchOnlineWikiTags(query, options = {}) {
        const { source = 'both', limit = 25 } = options;

        const tasks = [];
        if (source === 'both' || source === 'danbooru') {
            tasks.push(this.searchDanbooruTagsOnline(query, limit));
            tasks.push(this.searchDanbooruWikiPagesOnline(query, limit));
        }
        if (source === 'both' || source === 'e621') {
            tasks.push(this.searchE621TagsOnline(query, limit));
            tasks.push(this.searchE621WikiPagesOnline(query, limit));
        }

        const resultSets = await Promise.all(tasks);
        const byKey = new Map();

        for (const set of resultSets) {
            for (const tag of set) {
                const key = this.normalizeTagMatchKey(tag.name || tag.title);
                if (!key) continue;
                if (byKey.has(key)) {
                    const existing = byKey.get(key);
                    existing.source = [...new Set([...existing.source, ...tag.source])];
                } else {
                    byKey.set(key, { ...tag, source: [...tag.source] });
                }
            }
        }

        return [...byKey.values()];
    }

    /**
     * Merge local tag search results with online booru tag search results.
     */
    mergeLocalAndOnlineWikiSearch(localResults, onlineResults) {
        const localWithWiki = [];
        const localNoWiki = [];

        for (const tag of localResults) {
            const key = this.normalizeTagMatchKey(tag.title || tag.name);
            if (!key) continue;
            if (tag.hasWiki) {
                localWithWiki.push(tag);
            } else {
                localNoWiki.push(tag);
            }
        }

        const onlineByKey = new Map();
        for (const tag of onlineResults) {
            const key = this.normalizeTagMatchKey(tag.name || tag.title);
            if (!key) continue;
            if (onlineByKey.has(key)) {
                const existing = onlineByKey.get(key);
                existing.source = [...new Set([...existing.source, ...tag.source])];
            } else {
                onlineByKey.set(key, { ...tag, source: [...(tag.source || [])] });
            }
        }

        const merged = [];
        const localOnly = [];
        const remainingNoWiki = [];

        const absorbOnline = (tag, localSources) => {
            const key = this.normalizeTagMatchKey(tag.title || tag.name);
            const online = onlineByKey.get(key);
            if (!online) return false;
            const combinedHasWiki = !!(tag.hasWiki || online.hasWiki);
            merged.push({
                ...tag,
                name: tag.name || online.name || this.resolveBooruWikiTagName(tag.title),
                source: [...new Set([...localSources, ...online.source])],
                hasWiki: combinedHasWiki,
                onlineOnly: false,
                matchType: 'merged'
            });
            onlineByKey.delete(key);
            return true;
        };

        for (const tag of localWithWiki) {
            const localSources = tag.wikiSources || tag.source || [];
            if (!absorbOnline(tag, localSources)) {
                localOnly.push({
                    ...tag,
                    source: localSources,
                    matchType: 'local'
                });
            }
        }

        for (const tag of localNoWiki) {
            const localSources = tag.wikiSources || tag.source || [];
            if (!absorbOnline(tag, localSources)) {
                remainingNoWiki.push(tag);
            }
        }

        const onlineWikiOnly = [];
        const onlineTagOnly = [];
        for (const tag of onlineByKey.values()) {
            const entry = {
                ...tag,
                onlineOnly: true,
                matchType: tag.matchType || (tag.hasWiki ? 'online' : 'online-tag')
            };
            if (entry.hasWiki) {
                onlineWikiOnly.push(entry);
            } else {
                onlineTagOnly.push(entry);
            }
        }

        const noWiki = remainingNoWiki.map(tag => ({
            ...tag,
            source: tag.wikiSources || tag.source || [],
            matchType: 'no-wiki',
            hasWiki: false
        }));

        const onlineOnly = [...onlineWikiOnly, ...onlineTagOnly];

        return {
            results: [...merged, ...localOnly, ...onlineOnly, ...noWiki],
            merged,
            localOnly,
            onlineOnly,
            onlineWikiOnly,
            onlineTagOnly,
            noWiki
        };
    }

    /**
     * Extract wiki data from API response
     */
    extractWikiData(apiResult) {
        if (!apiResult) return null;
        
        const body = apiResult.body || apiResult.body_text || apiResult.body_html || '';
        const title = apiResult.title || apiResult.name || apiResult.other_names?.[0] || '';
        
        let createdAt = null;
        let updatedAt = null;
        
        if (apiResult.created_at) {
            createdAt = typeof apiResult.created_at === 'string' 
                ? apiResult.created_at 
                : new Date(apiResult.created_at).toISOString();
        }
        
        if (apiResult.updated_at) {
            updatedAt = typeof apiResult.updated_at === 'string' 
                ? apiResult.updated_at 
                : new Date(apiResult.updated_at).toISOString();
        }
        
        if (!body || typeof body !== 'string' || body.trim() === '' || body === "The wiki page does not exist.") {
            return null;
        }
        
        const normalizedTitle = title.replace(/_/g, ' ').trim();
        
        return {
            title: normalizedTitle,
            body: body,
            created_at: createdAt,
            updated_at: updatedAt
        };
    }

    /**
     * Fetch wiki from API and save to database
     * @param {number} tagId - Tag ID
     * @param {string} tagTitle - Tag title
     * @param {number} sourceId - Source ID (SOURCE_DANBOORU=1, SOURCE_E621=2)
     * @returns {Promise<{wikiId: number|null, body: string|null}>} Wiki ID and body, or null if not found
     */
    async fetchAndSaveWikiForTag(tagId, tagTitle, sourceId) {
        // Allow fetching even if tagId is null (tag doesn't exist in database yet)
        tagTitle = this.resolveBooruWikiTagName(tagTitle);
        if (!tagTitle || !this.db) {
            console.log(`[Wiki Fetch] Skipping fetch: tagId=${tagId}, tagTitle=${tagTitle}, db=${!!this.db}`);
            return { wikiId: null, body: null, fetchedOnline: false };
        }
        
        const onlineTitle = tagTitle;

        // Check failed fetch cache (7 days)
        const cacheKey = `${onlineTitle}|${sourceId}`;
        const failedFetch = await this.getFailedFetchCache(cacheKey);
        if (failedFetch) {
            const daysSince = (Date.now() - failedFetch.timestamp) / (1000 * 60 * 60 * 24);
            if (daysSince < 7) {
                console.log(`[Wiki Fetch] Skipping fetch for "${onlineTitle}" - failed ${Math.floor(daysSince)} days ago (cache expires in ${Math.floor(7 - daysSince)} days)`);
                return { wikiId: null, body: null, fetchedOnline: false };
            } else {
                // Cache expired, remove it
                await this.clearFailedFetchCache(cacheKey);
            }
        }
        
        try {
            console.log(`[Wiki Fetch] Fetching wiki for tag "${onlineTitle}" from source ${sourceId === this.SOURCE_DANBOORU ? 'Danbooru' : 'e621'}`);
            
            // Fetch from API
            let apiResult = null;
            if (sourceId === this.SOURCE_DANBOORU) {
                apiResult = await this.fetchDanbooruWikiByTitle(tagTitle);
            } else if (sourceId === this.SOURCE_E621) {
                apiResult = await this.fetchE621WikiByTitle(tagTitle);
            } else {
                console.log(`[Wiki Fetch] Invalid source ID: ${sourceId}`);
                return { wikiId: null, body: null, fetchedOnline: false };
            }
            
            if (!apiResult) {
                console.log(`[Wiki Fetch] No API result for "${onlineTitle}" from source ${sourceId}`);
                // Cache the failed fetch
                await this.setFailedFetchCache(cacheKey);
                return { wikiId: null, body: null, fetchedOnline: false };
            }
            
            console.log(`[Wiki Fetch] Got API result for "${tagTitle}", extracting data...`);
            
            // Extract wiki data
            const wikiData = this.extractWikiData(apiResult);
            if (!wikiData) {
                console.log(`[Wiki Fetch] Failed to extract wiki data from API result`);
                // Cache the failed fetch
                await this.setFailedFetchCache(cacheKey);
                return { wikiId: null, body: null, fetchedOnline: false };
            }
            
            console.log(`[Wiki Fetch] Extracted wiki data, normalizing body (length: ${wikiData.body?.length || 0})...`);
            
            // Normalize wiki body using extracted functions
            const normalized = this._normalizeWikiBody(wikiData.body || '', wikiData.title, sourceId);
            
            // Insert wiki
            const statements = this.getStatements();
            const insertResult = await this.db.run(statements.insertWikiForTag, [
                wikiData.title,
                normalized.body,
                sourceId
            ]);
            
            // Get wikiId - if REPLACE was used, lastID should still return the rowid
            let wikiId = insertResult.lastID;
            if (!wikiId || wikiId === 0) {
                // If lastID is 0 or falsy, query for the wiki ID (shouldn't happen with INSERT OR REPLACE, but safety check)
                const existingWiki = await this.db.get(`
                    SELECT id FROM wikis WHERE title = ? AND source = ?
                `, [wikiData.title, sourceId]);
                if (existingWiki) {
                    wikiId = existingWiki.id;
                } else {
                    throw new Error(`Failed to get wiki ID after insert for "${wikiData.title}"`);
                }
            }
            
            // Clean up old related data before inserting new (safe even if wiki didn't exist before)
            await this.db.run('DELETE FROM wiki_sections WHERE wiki_id = ?', [wikiId]);
            await this.db.run('DELETE FROM wiki_content_links WHERE wiki_id = ?', [wikiId]);
            await this.db.run('DELETE FROM tag_wiki_links WHERE wiki_id = ?', [wikiId]);
            
            // Link wiki to tag
            if (tagId) {
                await this.db.run(statements.insertTagWikiLink, [tagId, wikiId]);
            }
            
            // Extract and insert sections
            const { sections } = this._extractWikiSections(normalized.body);
            if (sections.length > 0) {
                const sectionIdMap = new Map();
                const sortedSections = [...sections].sort((a, b) => a.index - b.index);
                
                for (const section of sortedSections) {
                    let parentSectionId = null;
                    if (section.parentSectionIndex !== null && section.parentSectionIndex !== undefined) {
                        parentSectionId = sectionIdMap.get(section.parentSectionIndex) || null;
                    }
                    
                    const result = await this.db.run(`
                        INSERT INTO wiki_sections (wiki_id, section_index, level, title, anchor, start_offset, end_offset, line_index, section_type, parent_section_id)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `, [
                        wikiId,
                        section.index,
                        section.level,
                        section.title,
                        section.anchor,
                        section.startOffset,
                        section.endOffset,
                        section.lineIndex,
                        section.sectionType || 0,
                        parentSectionId
                    ]);
                    
                    sectionIdMap.set(section.index, result.lastID);
                }
            }
            
            // Extract and insert content links
            const contentLinks = this._extractWikiContentLinks(normalized.body);
            if (contentLinks.length > 0) {
                for (const link of contentLinks) {
                    await this.db.run(`
                        INSERT INTO wiki_content_links (wiki_id, link_type, link_id, link_url, link_page, display_text, search_query, start_offset, end_offset)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `, [
                        wikiId,
                        link.type,
                        link.id || null,
                        link.url || null,
                        link.page || null,
                        link.displayText || null,
                        link.searchQuery || null,
                        link.startOffset,
                        link.endOffset
                    ]);
                }
            }
            
            // Extract tag-to-tag relationships from wiki links
            const wikiLinks = this._extractWikiLinks(normalized.body);
            if (wikiLinks.length > 0) {
                // Get all tags for linking
                const allTags = await this.db.all('SELECT id, title, normalized_title FROM tags');
                const tagIdMap = new Map();
                const titleToIdMap = new Map();
                
                for (const tag of allTags) {
                    tagIdMap.set(tag.normalized_title.toLowerCase(), tag.id);
                    titleToIdMap.set(tag.title.toLowerCase(), tag.id);
                }
                
                for (const link of wikiLinks) {
                    const linkTitle = link.title;
                    const linkPosition = link.position;
                    const normalizedLinkTitle = this._normalizeTitle(linkTitle);
                    const linkedTagId = tagIdMap.get(normalizedLinkTitle) || titleToIdMap.get(linkTitle.toLowerCase());
                    
                    if (linkedTagId && linkedTagId !== tagId) {
                        const relationship = this._detectLinkRelationship(normalized.body, linkTitle, linkPosition);
                        await this.db.run(`
                            INSERT OR IGNORE INTO tag_wiki_links (tag_id, wiki_id, relationship)
                            VALUES (?, ?, ?)
                        `, [linkedTagId, wikiId, relationship]);
                    }
                }
            }
            
            // Update FTS5 index (use INSERT OR REPLACE to handle updates)
            await this.db.run(`
                INSERT OR REPLACE INTO wikis_fts(rowid, body, title, source)
                VALUES (?, ?, ?, ?)
            `, [wikiId, normalized.body, wikiData.title, sourceId]);
            
        console.log(`[Wiki Fetch] Successfully normalized wiki body (length: ${normalized.body.length}), returning...`);
        
        // Download post/thumb images before returning
        if (normalized.postThumbRefs && normalized.postThumbRefs.length > 0) {
            console.log(`[Wiki Fetch] Found ${normalized.postThumbRefs.length} post/thumb references, downloading images...`);
            await this.downloadWikiImages(normalized.postThumbRefs, sourceId);
        }
        return { wikiId, body: normalized.body, fetchedOnline: true };
    } catch (error) {
        console.error(`[Wiki Fetch] Error fetching and saving wiki for tag ${tagId} (${tagTitle}):`, error);
        console.error(`[Wiki Fetch] Error stack:`, error.stack);
        // Cache the failed fetch
        await this.setFailedFetchCache(cacheKey);
        return { wikiId: null, body: null, fetchedOnline: false };
    }
}

/**
 * Get failed fetch cache entry
 */
async getFailedFetchCache(cacheKey) {
    if (!this.db) return null;
    
    try {
        // Try to get from database table (if it exists)
        const result = await this.db.get(`
            SELECT timestamp FROM wiki_failed_fetches 
            WHERE cache_key = ?
        `, [cacheKey]);
        
        if (result) {
            return { timestamp: result.timestamp };
        }
    } catch (error) {
        // Table might not exist yet, that's okay
    }
    
    return null;
}

/**
 * Set failed fetch cache entry (7 days)
 */
async setFailedFetchCache(cacheKey) {
    if (!this.db) return;
    
    try {
        // Create table if it doesn't exist
        await this.db.run(`
            CREATE TABLE IF NOT EXISTS wiki_failed_fetches (
                cache_key TEXT PRIMARY KEY,
                timestamp INTEGER NOT NULL
            )
        `);
        
        // Insert or update cache entry
        await this.db.run(`
            INSERT OR REPLACE INTO wiki_failed_fetches (cache_key, timestamp)
            VALUES (?, ?)
        `, [cacheKey, Date.now()]);
    } catch (error) {
        console.error(`[Wiki Fetch] Error setting failed fetch cache:`, error);
    }
}

/**
 * Clear failed fetch cache entry
 */
async clearFailedFetchCache(cacheKey) {
    if (!this.db) return;
    
    try {
        await this.db.run(`
            DELETE FROM wiki_failed_fetches WHERE cache_key = ?
        `, [cacheKey]);
    } catch (error) {
        // Ignore errors
    }
}

/**
 * Clear expired failed fetch cache entries (older than 7 days)
 */
async clearExpiredFailedFetches() {
    if (!this.db) return;
    
    try {
        const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
        await this.db.run(`
            DELETE FROM wiki_failed_fetches WHERE timestamp < ?
        `, [sevenDaysAgo]);
    } catch (error) {
        // Ignore errors
    }
}

    // ============================================================================
    // Helper methods for wiki normalization (extracted from create-tag-database.js)
    // ============================================================================

    /**
     * Normalize title for tag/wiki matching
     */
    _normalizeTitle(title) {
        if (!title) return '';
        return title.toLowerCase().replace(/[_\s]+/g, ' ').trim();
    }

    /**
     * Normalize wiki body text
     */
    _normalizeWikiBody(text, wikiTitle = '', source = 0) {
        if (!text || typeof text !== 'string') {
            return { body: text || '', postThumbRefs: [], externalUrlRefs: [] };
        }
        
        let normalized = text;
        const postThumbRefs = [];
        const externalUrlRefs = [];
        let nextUrlId = 1;
        
        // 1. Normalize newlines
        normalized = normalized.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        
        // 2. Normalize tag_group: prefix
        normalized = normalized.replace(/tag\s+group:\s*/gi, 'tag_group:');
        normalized = normalized.replace(/tag_group:\s+/gi, 'tag_group:');
        
        // 3. Convert post/thumb references
        normalized = normalized.replace(/(!?)(post|thumb)\s+#(\d+)/gi, (match, exclamation, type, id) => {
            const refType = type.toLowerCase() === 'post' ? 'post' : 'thumb';
            const refId = parseInt(id, 10);
            postThumbRefs.push({
                id: refId,
                type: refType,
                source: source,
                wikiTitle: wikiTitle || ''
            });
            return `[[file@${refType}${refId}]]`;
        });
        
        // 4. Convert external links
        normalized = normalized.replace(/"([^"]+)":\[?(https?:\/\/[^\s\]\)]+)\]?/gi, (match, linkText, url) => {
            const uniqueId = `url${nextUrlId++}`;
            externalUrlRefs.push({
                uniqueId: uniqueId,
                url: url,
                linkText: linkText,
                source: source,
                wikiTitle: wikiTitle || ''
            });
            return `[${linkText}](file://${uniqueId})`;
        });
        
        normalized = normalized.replace(/\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)/gi, (match, linkText, url) => {
            if (url.startsWith('file://')) {
                return match;
            }
            const uniqueId = `url${nextUrlId++}`;
            externalUrlRefs.push({
                uniqueId: uniqueId,
                url: url,
                linkText: linkText,
                source: source,
                wikiTitle: wikiTitle || ''
            });
            return `[${linkText}](file://${uniqueId})`;
        });
        
        return {
            body: normalized,
            postThumbRefs: postThumbRefs,
            externalUrlRefs: externalUrlRefs
        };
    }

    /**
     * Extract wiki sections from body text
     */
    _extractWikiSections(bodyText) {
        if (!bodyText || typeof bodyText !== 'string') {
            return { sections: [], bodyWithEndMarkers: bodyText };
        }
        
        const lines = bodyText.split('\n');
        const sections = [];
        const anchorCounts = new Map();
        let offset = 0;
        
        const slugifyAnchor = (value) => {
            if (!value) return '';
            return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        };
        
        const normalizeHeadingTitle = (rawTitle, sectionIndex, anchorCounts) => {
            let title = rawTitle || '';
            const anchors = [];
            
            title = title.replace(/\[#([^\]\|]+)(?:\|[^\]]+)?\]/g, (_, anchor) => {
                if (anchor) anchors.push(anchor.trim());
                return '';
            });
            title = title.replace(/\[\[#([^\]\|]+)(?:\|[^\]]+)?\]\]/g, '');
            title = title.replace(/\[\[([^\|\]]+)\|([^\]]+)\]\]/g, '$2');
            title = title.replace(/\[\[([^\]]+)\]\]/g, '$1');
            title = title.replace(/\s+/g, ' ').trim();
            
            const anchorBaseSource = anchors.length > 0 ? anchors[0] : title;
            let anchorBase = slugifyAnchor(anchorBaseSource);
            if (!anchorBase) {
                anchorBase = `section-${sectionIndex + 1}`;
            }
            
            const currentCount = anchorCounts.get(anchorBase) || 0;
            anchorCounts.set(anchorBase, currentCount + 1);
            const anchor = currentCount === 0 ? anchorBase : `${anchorBase}-${currentCount}`;
            
            if (!title) {
                title = `Section ${sectionIndex + 1}`;
            }
            
            return { title, anchor };
        };
        
        const registerSection = (level, rawTitle, lineIdx, startOffset, sectionType = 0) => {
            const { title, anchor } = normalizeHeadingTitle(rawTitle || '', sections.length, anchorCounts);
            const sectionLevel = Math.max(1, Math.min(level || 3, 6));
            
            let parentSectionIndex = null;
            for (let i = sections.length - 1; i >= 0; i--) {
                if (sections[i].level < sectionLevel) {
                    parentSectionIndex = i;
                    break;
                }
            }
            
            sections.push({
                index: sections.length,
                level: sectionLevel,
                title,
                anchor,
                startOffset,
                lineIndex: lineIdx,
                sectionType: sectionType,
                parentSectionIndex: parentSectionIndex
            });
        };
        
        // Extract [section=] blocks
        const sectionBlocks = [];
        const sectionBlockRegex = /\[section=([^\]]+)\]([\s\S]*?)(?:\[\/section\]|(?=\[section=)|$)/gi;
        let sectionMatch;
        while ((sectionMatch = sectionBlockRegex.exec(bodyText)) !== null) {
            const sectionTitle = sectionMatch[1].trim();
            const sectionStartOffset = sectionMatch.index;
            const sectionEndOffset = sectionMatch.index + sectionMatch[0].length;
            const textBeforeSection = bodyText.substring(0, sectionStartOffset);
            const lineIndex = textBeforeSection.split('\n').length - 1;
            
            sectionBlocks.push({
                title: sectionTitle,
                startOffset: sectionStartOffset,
                endOffset: sectionEndOffset,
                lineIndex: lineIndex,
                level: 3,
                sectionType: 1
            });
        }
        
        // Extract regular headers
        lines.forEach((line, lineIndex) => {
            const trimmed = line.trim();
            
            const dtextHeaderMatch = trimmed.match(/^h([1-6])(?:#([^\s\.]+))?\.\s*(.+)$/i);
            if (dtextHeaderMatch) {
                const level = parseInt(dtextHeaderMatch[1], 10);
                const sectionTitle = dtextHeaderMatch[3];
                registerSection(level, sectionTitle, lineIndex, offset, 0);
            }
            
            const headerTagMatch = trimmed.match(/^\[h([1-6])\](.+)\[\/h\1\]$/i);
            if (headerTagMatch) {
                const level = parseInt(headerTagMatch[1], 10);
                const sectionTitle = headerTagMatch[2];
                registerSection(level, sectionTitle, lineIndex, offset, 0);
            }
            
            offset += line.length + 1;
        });
        
        // Add [section=] blocks
        sectionBlocks.sort((a, b) => a.startOffset - b.startOffset);
        for (const sectionBlock of sectionBlocks) {
            const overlaps = sections.some(s => 
                (sectionBlock.startOffset >= s.startOffset && sectionBlock.startOffset < s.endOffset) ||
                (sectionBlock.endOffset > s.startOffset && sectionBlock.endOffset <= s.endOffset)
            );
            if (!overlaps) {
                registerSection(sectionBlock.level, sectionBlock.title, sectionBlock.lineIndex, sectionBlock.startOffset, sectionBlock.sectionType);
            }
        }
        
        sections.sort((a, b) => a.startOffset - b.startOffset);
        sections.forEach((section, idx) => {
            section.index = idx;
        });
        
        if (sections.length === 0) {
            return { sections: [], bodyWithEndMarkers: bodyText };
        }
        
        sections.forEach((section, idx) => {
            section.endOffset = idx + 1 < sections.length ? sections[idx + 1].startOffset : bodyText.length;
        });
        
        return { sections, bodyWithEndMarkers: bodyText };
    }

    /**
     * Extract wiki-style links ([[tag]] or [[tag|display]])
     */
    _extractWikiLinks(bodyText = '') {
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
     * Extract content links from wiki body
     */
    _extractWikiContentLinks(bodyText) {
        if (!bodyText || typeof bodyText !== 'string') {
            return [];
        }
        
        const links = [];
        let match;
        
        // Simple implementation - extract basic patterns
        const linkPatterns = [
            { type: 'file', regex: /\bfile:(\d+)(?:\|([^\]]+))?/gi },
            { type: 'post', regex: /\bpost:(\d+)(?:\|([^\]]+))?/gi },
            { type: 'image', regex: /\bimage:(\d+)(?:\|([^\]]+))?/gi },
            { type: 'wiki', regex: /\bwiki:([^\s\]]+)(?:\|([^\]]+))?/gi }
        ];
        
        const idLinkPatterns = [
            { type: 'post', regex: /\bpost\s+#(\d+)/gi },
            { type: 'topic', regex: /\btopic\s+#(\d+)(?:\/p(\d+))?/gi },
            { type: 'forum', regex: /\bforum\s+#(\d+)/gi },
            { type: 'comment', regex: /\bcomment\s+#(\d+)/gi },
            { type: 'pool', regex: /\bpool\s+#(\d+)/gi },
            { type: 'wiki', regex: /\bwiki\s+#(\d+)/gi }
        ];
        
        for (const { type, regex } of idLinkPatterns) {
            while ((match = regex.exec(bodyText)) !== null) {
                const id = match[1];
                const page = match[2] || null;
                let displayText = `${type} #${id}`;
                if (page) displayText += `/p${page}`;
                links.push({
                    type: type,
                    id: id,
                    page: page,
                    displayText: displayText,
                    startOffset: match.index,
                    endOffset: match.index + match[0].length
                });
            }
        }
        
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
        
        links.sort((a, b) => a.startOffset - b.startOffset);
        return links;
    }

    /**
     * Detect relationship type for a tag link in wiki body
     */
    _detectLinkRelationship(bodyText, linkTitle, linkPosition) {
        const RELATIONSHIP_APPEARS = 0;
        const RELATIONSHIP_RELATED = 1;
        const RELATIONSHIP_REPLACES = 2;
        const RELATIONSHIP_NOT_TO_BE_CONFUSED = 3;
        
        if (!bodyText || !linkTitle || linkPosition === undefined) {
            return RELATIONSHIP_APPEARS;
        }
        
        const beforeLink = bodyText.substring(0, linkPosition).toLowerCase();
        const contextStart = Math.max(0, linkPosition - 300);
        const contextBefore = bodyText.substring(contextStart, linkPosition).toLowerCase();
        
        const relatedPatterns = [
            /h[1-5]\.\s*related\s*:?\s*\n/i,
            /h[1-5]\.\s*related\s+tags\s*:?\s*\n/i,
            /\[section=related\]/i,
            /\[section=related\s+tags\]/i
        ];
        
        for (const pattern of relatedPatterns) {
            const match = beforeLink.match(pattern);
            if (match) {
                const between = bodyText.substring(match.index + match[0].length, linkPosition).toLowerCase();
                if (!between.match(/deprecated|see\s+["']|use\s+["']|replaced\s+by/i)) {
                    return RELATIONSHIP_RELATED;
                }
            }
        }
        
        const seeAlsoPatterns = [
            /h[1-5]\.\s*see\s+also\s*:?\s*\n/i,
            /h[1-5]\.\s*related\s+tags\s*:?\s*\n/i,
            /\[section=see\s+also\]/i,
            /\[section=related\s+tags\]/i
        ];
        
        for (const pattern of seeAlsoPatterns) {
            const match = beforeLink.match(pattern);
            if (match) {
                const between = bodyText.substring(match.index + match[0].length, linkPosition).toLowerCase();
                if (!between.match(/deprecated|see\s+["']|use\s+["']|replaced\s+by/i)) {
                    return RELATIONSHIP_RELATED;
                }
            }
        }
        
        const notToBeConfusedPatterns = [
            /h[1-5]\.\s*not\s+to\s+be\s+confused\s+with\s*:?\s*\n/i,
            /\[section=not\s+to\s+be\s+confused\s+with\]/i
        ];
        
        for (const pattern of notToBeConfusedPatterns) {
            const match = beforeLink.match(pattern);
            if (match) {
                const between = bodyText.substring(match.index + match[0].length, linkPosition).toLowerCase();
                if (!between.match(/deprecated|see\s+["']|use\s+["']|replaced\s+by/i)) {
                    return RELATIONSHIP_NOT_TO_BE_CONFUSED;
                }
            }
        }
        
        const deprecatedPatterns = [
            /deprecated[^[]*\[\[/gi,
            /see\s+\[\[/gi,
            /use\s+\[\[/gi,
            /replaced\s+by\s+\[\[/gi
        ];
        
        for (const pattern of deprecatedPatterns) {
            const matches = [...contextBefore.matchAll(pattern)];
            for (const depMatch of matches) {
                const depEnd = depMatch.index + depMatch[0].length;
                const distance = (linkPosition - contextStart) - depEnd;
                if (distance >= 0 && distance < 200) {
                    return RELATIONSHIP_REPLACES;
                }
            }
        }
        
    return RELATIONSHIP_APPEARS;
}

/**
 * Download wiki post/thumb images
 * @param {Array} postThumbRefs - Array of { id, type: 'post'|'thumb', source, wikiTitle }
 * @param {number} sourceId - Source ID (SOURCE_DANBOORU=1, SOURCE_E621=2)
 */
async downloadWikiImages(postThumbRefs, sourceId) {
    if (!postThumbRefs || postThumbRefs.length === 0) {
        return;
    }
    
    const OUTPUT_DIR = path.join(this.globalResources.getPath('cache'), 'wiki_files');
    const DANBOORU_API_BASE = 'https://danbooru.donmai.us';
    const E621_API_BASE = 'https://e621.net';
    const RATE_LIMIT_DELAY = 250;
    
    // Ensure output directory exists
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }
    
    // Filter out already downloaded files
    const toDownload = postThumbRefs.filter(ref => {
        const refType = ref.type || 'post';
        const outputPath = path.join(OUTPUT_DIR, `${refType}${ref.id}.jpg`);
        return !fs.existsSync(outputPath);
    });
    
    if (toDownload.length === 0) {
        console.log(`[Wiki Fetch] All ${postThumbRefs.length} images already downloaded`);
        return;
    }
    
    console.log(`[Wiki Fetch] Downloading ${toDownload.length} images (${postThumbRefs.length - toDownload.length} already exist)...`);
    
    // Download images sequentially to respect rate limits
    for (let i = 0; i < toDownload.length; i++) {
        const ref = toDownload[i];
        const postId = ref.id;
        const refType = ref.type || 'post';
        const outputPath = path.join(OUTPUT_DIR, `${refType}${postId}.jpg`);
        
        try {
            // Fetch post data
            const isE621 = sourceId === this.SOURCE_E621;
            const apiBase = isE621 ? E621_API_BASE : DANBOORU_API_BASE;
            const postUrl = `${apiBase}/posts/${postId}.json`;
            
            const postData = await this.fetchJson(postUrl);
            if (!postData) {
                console.log(`[Wiki Fetch] Post ${postId} not found (404)`);
                continue;
            }
            
            // Get image URL and file extension
            const supportedImageFormats = ['jpg', 'jpeg', 'png', 'webp', 'avif', 'tiff', 'tif'];
            const supportedVideoFormats = ['webm', 'mp4', 'mov', 'avi'];
            const animatedFormats = ['gif', 'apng'];
            let imageUrl;
            let previewUrl = null;
            let fileExt;
            let isVideo = false;
            let isAnimated = false;
            
            if (isE621) {
                const e621Post = postData.post || postData;
                const file = e621Post.file || {};
                const preview = e621Post.preview || {};
                const sample = e621Post.sample || {};
                
                fileExt = file.ext;
                previewUrl = preview.url || sample.url;
                
                if (fileExt && supportedVideoFormats.includes(fileExt.toLowerCase())) {
                    isVideo = true;
                    imageUrl = file.url || previewUrl;
                    if (!file.url) {
                        isVideo = false; // Use preview instead
                    }
                } else if (fileExt && animatedFormats.includes(fileExt.toLowerCase())) {
                    isAnimated = true;
                    imageUrl = file.url || sample.url || previewUrl;
                    previewUrl = previewUrl || sample.url || file.url;
                } else if (fileExt && supportedImageFormats.includes(fileExt.toLowerCase())) {
                    imageUrl = file.url || sample.url || previewUrl;
                } else {
                    // Unsupported format, use preview
                    imageUrl = previewUrl || sample.url || file.url;
                }
            } else {
                fileExt = postData.file_ext;
                previewUrl = postData.preview_file_url;
                
                if (fileExt && supportedVideoFormats.includes(fileExt.toLowerCase())) {
                    isVideo = true;
                    imageUrl = postData.file_url || postData.large_file_url;
                    if (!imageUrl) {
                        imageUrl = postData.preview_file_url;
                        isVideo = false;
                    }
                } else if (fileExt && animatedFormats.includes(fileExt.toLowerCase())) {
                    isAnimated = true;
                    imageUrl = postData.file_url || postData.large_file_url || postData.preview_file_url;
                } else if (fileExt && supportedImageFormats.includes(fileExt.toLowerCase())) {
                    imageUrl = postData.file_url || postData.large_file_url || postData.preview_file_url;
                } else {
                    // Unsupported format, use preview
                    imageUrl = postData.preview_file_url || postData.large_file_url || postData.file_url;
                }
            }
            
            if (!imageUrl) {
                console.log(`[Wiki Fetch] Post ${postId} has no image URL`);
                continue;
            }
            
            // Ensure URL is absolute
            if (imageUrl.startsWith('//')) {
                imageUrl = 'https:' + imageUrl;
            } else if (imageUrl.startsWith('/')) {
                imageUrl = apiBase + imageUrl;
            }
            if (previewUrl) {
                if (previewUrl.startsWith('//')) {
                    previewUrl = 'https:' + previewUrl;
                } else if (previewUrl.startsWith('/')) {
                    previewUrl = apiBase + previewUrl;
                }
            }
            
            // Download and convert image
            try {
                await this.downloadWikiImage(imageUrl, outputPath, fileExt, isVideo, isAnimated, previewUrl);
                console.log(`[Wiki Fetch] Downloaded ${refType}${postId}.jpg`);
            } catch (error) {
                // If download failed and we have a preview URL, try that
                if (previewUrl && previewUrl !== imageUrl) {
                    console.log(`[Wiki Fetch] Failed to download main image, trying preview URL...`);
                    try {
                        await this.downloadWikiImage(previewUrl, outputPath, null, false, false, null);
                        console.log(`[Wiki Fetch] Downloaded ${refType}${postId}.jpg from preview`);
                    } catch (previewError) {
                        console.error(`[Wiki Fetch] Failed to download preview for ${refType} ${postId}: ${previewError.message}`);
                    }
                } else {
                    throw error;
                }
            }
            
            // Rate limiting
            if (i < toDownload.length - 1) {
                await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));
            }
        } catch (error) {
            console.error(`[Wiki Fetch] Error downloading image for ${refType} ${postId}:`, error.message);
        }
    }
    
    console.log(`[Wiki Fetch] Finished downloading images`);
}

/**
 * Check if ffmpeg is available
 */
async checkFfmpegAvailable() {
    try {
        await execAsync('ffmpeg -version');
        return true;
    } catch (error) {
        return false;
    }
}

/**
 * Extract a frame from a video/GIF file and convert to JPG using ffmpeg
 */
async convertVideoOrGifToJpg(inputPath, outputPath) {
    const ffmpegAvailable = await this.checkFfmpegAvailable();
    if (!ffmpegAvailable) {
        throw new Error('ffmpeg is not installed or not available in PATH');
    }
    
    try {
        // Extract a frame at 1 second (or first frame if shorter)
        const tempJpgPath = outputPath + '.temp.jpg';
        const ffmpegCommand = `ffmpeg -i "${inputPath}" -ss 00:00:01 -vframes 1 -q:v 2 "${tempJpgPath}" -y`;
        
        try {
            await execAsync(ffmpegCommand);
        } catch (error) {
            // If frame extraction at 1 second failed, try extracting the first frame
            const ffmpegCommandFirstFrame = `ffmpeg -i "${inputPath}" -vframes 1 -q:v 2 "${tempJpgPath}" -y`;
            await execAsync(ffmpegCommandFirstFrame);
        }
        
        // Check if the temp file was created
        if (!fs.existsSync(tempJpgPath)) {
            throw new Error('Failed to extract frame');
        }
        
        // Process the extracted frame with sharp: resize to max 1024x1024, convert to JPEG
        const frameBuffer = fs.readFileSync(tempJpgPath);
        const processedBuffer = await sharp(frameBuffer)
            .resize(1024, 1024, {
                fit: 'inside',
                withoutEnlargement: true
            })
            .jpeg({ quality: 85 })
            .toBuffer();
        
        // Write to temporary file first, then rename atomically
        const tempPath = outputPath + '.tmp';
        fs.writeFileSync(tempPath, processedBuffer);
        
        // Clean up temp files
        try {
            fs.unlinkSync(tempJpgPath);
        } catch (cleanupError) {
            // Ignore cleanup errors
        }
        
        fs.renameSync(tempPath, outputPath);
        return true;
    } catch (error) {
        // Clean up temp files on error
        const tempJpgPath = outputPath + '.temp.jpg';
        if (fs.existsSync(tempJpgPath)) {
            try {
                fs.unlinkSync(tempJpgPath);
            } catch (cleanupError) {
                // Ignore cleanup errors
            }
        }
        throw error;
    }
}

/**
 * Download and process a single wiki image
 */
async downloadWikiImage(imageUrl, outputPath, fileExt = null, isVideo = false, isAnimated = false, previewUrl = null) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(imageUrl);
        const client = urlObj.protocol === 'https:' ? https : http;
        
        const timeout = (isVideo || isAnimated) ? 120000 : 60000;
        
        const options = {
            hostname: urlObj.hostname,
            port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
            path: urlObj.pathname + urlObj.search,
            method: 'GET',
            headers: {
                'User-Agent': 'StaticForge/1.0 (https://staticforge.app)'
            },
            timeout: timeout
        };
        
        const req = client.get(options, async (res) => {
            // Handle redirects
            if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
                const redirectUrl = res.headers.location;
                if (redirectUrl) {
                    req.destroy();
                    const absoluteUrl = redirectUrl.startsWith('http') ? redirectUrl : `${urlObj.protocol}//${urlObj.host}${redirectUrl}`;
                    this.downloadWikiImage(absoluteUrl, outputPath, fileExt, isVideo, isAnimated, previewUrl).then(resolve).catch(reject);
                    return;
                }
            }
            
            if (res.statusCode !== 200) {
                req.destroy();
                reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
                return;
            }
            
            const chunks = [];
            res.on('data', (chunk) => {
                chunks.push(chunk);
            });
            
            res.on('end', async () => {
                try {
                    const buffer = Buffer.concat(chunks);
                    
                    // Handle videos and animated formats (GIF, webm, mp4, etc.)
                    if (isVideo || (isAnimated && fileExt && fileExt.toLowerCase() === 'gif')) {
                        // Save to temp file first
                        const tempInputPath = outputPath + '.temp.' + (fileExt || 'webm');
                        fs.writeFileSync(tempInputPath, buffer);
                        
                        try {
                            // Convert using ffmpeg
                            await this.convertVideoOrGifToJpg(tempInputPath, outputPath);
                            console.log(`[Wiki Fetch] Converted ${fileExt || 'video'} to JPG`);
                        } finally {
                            // Clean up temp input file
                            try {
                                fs.unlinkSync(tempInputPath);
                            } catch (cleanupError) {
                                // Ignore cleanup errors
                            }
                        }
                        resolve(true);
                        return;
                    }
                    
                    // For regular images, try to process with sharp
                    try {
                        // Process image with sharp: resize to max 1024x1024, convert to JPEG
                        const processedBuffer = await sharp(buffer)
                            .resize(1024, 1024, {
                                fit: 'inside',
                                withoutEnlargement: true
                            })
                            .jpeg({ quality: 85 })
                            .toBuffer();
                        
                        // Write to temporary file first, then rename atomically
                        const tempPath = outputPath + '.tmp';
                        fs.writeFileSync(tempPath, processedBuffer);
                        fs.renameSync(tempPath, outputPath);
                        resolve(true);
                    } catch (sharpError) {
                        // If sharp fails (unsupported format), try ffmpeg if available
                        if (fileExt && (fileExt.toLowerCase() === 'gif' || ['webm', 'mp4', 'mov', 'avi'].includes(fileExt.toLowerCase()))) {
                            const tempInputPath = outputPath + '.temp.' + fileExt;
                            fs.writeFileSync(tempInputPath, buffer);
                            
                            try {
                                await this.convertVideoOrGifToJpg(tempInputPath, outputPath);
                                console.log(`[Wiki Fetch] Converted ${fileExt} to JPG using ffmpeg`);
                                resolve(true);
                            } finally {
                                try {
                                    fs.unlinkSync(tempInputPath);
                                } catch (cleanupError) {
                                    // Ignore cleanup errors
                                }
                            }
                        } else {
                            throw sharpError;
                        }
                    }
                } catch (error) {
                    const tempPath = outputPath + '.tmp';
                    if (fs.existsSync(tempPath)) {
                        try {
                            fs.unlinkSync(tempPath);
                        } catch (cleanupError) {
                            // Ignore cleanup errors
                        }
                    }
                    reject(error);
                }
            });
        });
        
        req.on('error', (error) => {
            reject(error);
        });
        
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
    });
}
}

// Export class - globalResources will be passed during initialization
module.exports = TagLookup;
