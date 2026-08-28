/**
 * Load Downloaded Wiki Pages into Tag Database
 * 
 * This script:
 * 1. Reads danbooru_missing_wikis.json and/or e621_missing_wikis.json
 * 2. Normalizes wiki bodies using the same logic as create-tag-database.js
 * 3. Inserts wikis into the database
 * 4. Links wikis to tags if tags exist
 * 5. Extracts sections, content links, etc.
 * 
 * Features:
 * - Reuses normalization functions from create-tag-database.js
 * - Handles both tags and unlinked wiki pages
 * - Skips already existing wikis
 * - Updates indexes and FTS5
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

// Import functions from create-tag-database.js
const { 
    normalizeTitle, 
    normalizeWikiBody, 
    extractWikiSections,
    extractWikiContentLinks,
    extractWikiLinks,
    detectLinkRelationship
} = require('./create-tag-database');
const { isAfterV45Cutoff } = require('../modules/tagModelCutoff');

// Configuration
const DATABASE_PATH = path.join(__dirname, '..', '.cache', 'tag_wiki.db');
const DANBOORU_WIKIS_PATH = path.join(__dirname, '..', 'data', 'danbooru_missing_wikis.json');
const E621_WIKIS_PATH = path.join(__dirname, '..', 'data', 'e621_missing_wikis.json');

// Source identifiers
const SOURCE_DANBOORU = 1;
const SOURCE_E621 = 2;

// Relationship identifiers
const RELATIONSHIP_APPEARS = 0;
const RELATIONSHIP_RELATED = 1;
const RELATIONSHIP_REPLACES = 2;
const RELATIONSHIP_NOT_TO_BE_CONFUSED = 3;

/**
 * Main function
 */
async function main() {
    console.log('🚀 Loading downloaded wiki pages into database...\n');
    
    // Check if database exists
    if (!fs.existsSync(DATABASE_PATH)) {
        console.error(`❌ Database not found: ${path.basename(DATABASE_PATH)}`);
        console.error('   Please run create-tag-database.js first to create the database.');
        process.exit(1);
    }
    
    // Open database
    console.log('💾 Opening database...');
    const db = new Database(DATABASE_PATH);
    db.pragma('foreign_keys = ON');
    
    // Check if downloaded wiki files exist
    const danbooruWikis = [];
    const e621Wikis = [];
    
    if (fs.existsSync(DANBOORU_WIKIS_PATH)) {
        console.log(`📂 Loading ${path.basename(DANBOORU_WIKIS_PATH)}...`);
        const danbooruData = JSON.parse(fs.readFileSync(DANBOORU_WIKIS_PATH, 'utf8'));
        danbooruWikis.push(...(danbooruData.wikis || []));
        console.log(`   ✓ Loaded ${danbooruWikis.length} Danbooru wikis`);
    }
    
    if (fs.existsSync(E621_WIKIS_PATH)) {
        console.log(`📂 Loading ${path.basename(E621_WIKIS_PATH)}...`);
        const e621Data = JSON.parse(fs.readFileSync(E621_WIKIS_PATH, 'utf8'));
        e621Wikis.push(...(e621Data.wikis || []));
        console.log(`   ✓ Loaded ${e621Wikis.length} E621 wikis`);
    }
    
    if (danbooruWikis.length === 0 && e621Wikis.length === 0) {
        console.log('\n✅ No downloaded wikis to load!');
        console.log('   Run download-missing-wikis.js first to download wikis.');
        db.close();
        return;
    }
    
    // Prepare statements
    const insertWiki = db.prepare(`
        INSERT OR IGNORE INTO wikis (title, body, source, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
    `);
    
    const getWikiId = db.prepare(`
        SELECT id FROM wikis WHERE title = ? AND source = ?
    `);
    
    const getTagId = db.prepare(`
        SELECT id FROM tags WHERE LOWER(title) = LOWER(?) OR LOWER(normalized_title) = LOWER(?)
    `);
    
    const insertTagWiki = db.prepare(`
        INSERT OR IGNORE INTO tag_wikis (tag_id, wiki_id) VALUES (?, ?)
    `);
    
    const insertWikiPage = db.prepare(`
        INSERT OR IGNORE INTO wiki_pages (title, danbooru_wiki_id, e621_wiki_id, created_at, updated_at, untrained)
        VALUES (?, ?, ?, ?, ?, ?)
    `);
    
    const insertWikiSection = db.prepare(`
        INSERT INTO wiki_sections (wiki_id, section_index, level, title, anchor, start_offset, end_offset, line_index, section_type, parent_section_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const insertWikiContentLink = db.prepare(`
        INSERT INTO wiki_content_links (wiki_id, link_type, link_id, link_url, link_page, display_text, search_query, start_offset, end_offset)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const insertTagWikiLink = db.prepare(`
        INSERT OR IGNORE INTO tag_wiki_links (tag_id, wiki_id, relationship)
        VALUES (?, ?, ?)
    `);
    
    const insertWikiLink = db.prepare(`
        INSERT OR IGNORE INTO wiki_links (from_wiki_id, to_wiki_id)
        VALUES (?, ?)
    `);
    
    // Process Danbooru wikis
    if (danbooruWikis.length > 0) {
        console.log(`\n📝 Processing ${danbooruWikis.length} Danbooru wikis...`);
        await processWikis(db, danbooruWikis, SOURCE_DANBOORU, insertWiki, getWikiId, getTagId, insertTagWiki, insertWikiPage, insertWikiSection, insertWikiContentLink, insertTagWikiLink, insertWikiLink);
    }
    
    // Process e621 wikis
    if (e621Wikis.length > 0) {
        console.log(`\n📝 Processing ${e621Wikis.length} E621 wikis...`);
        await processWikis(db, e621Wikis, SOURCE_E621, insertWiki, getWikiId, getTagId, insertTagWiki, insertWikiPage, insertWikiSection, insertWikiContentLink, insertTagWikiLink, insertWikiLink);
    }
    
    // Update FTS5 index for new wikis
    console.log('\n📇 Updating FTS5 index...');
    db.exec(`
        INSERT INTO wikis_fts(rowid, body, title, source)
        SELECT id, body, title, source FROM wikis
        WHERE id NOT IN (SELECT rowid FROM wikis_fts)
    `);
    console.log('   ✓ FTS5 index updated');
    
    // Close database
    db.close();
    
    console.log('\n✅ Wiki loading complete!');
}

/**
 * Process wikis for a specific source
 */
async function processWikis(db, wikis, source, insertWiki, getWikiId, getTagId, insertTagWiki, insertWikiPage, insertWikiSection, insertWikiContentLink, insertTagWikiLink, insertWikiLink) {
    let insertedCount = 0;
    let linkedToTagsCount = 0;
    let unlinkedCount = 0;
    let skippedCount = 0;
    
    // Get all tag IDs for linking
    const allTags = db.prepare('SELECT id, title, normalized_title FROM tags').all();
    const tagIdMap = new Map(); // normalized_title -> tag_id
    const titleToIdMap = new Map(); // title (lowercase) -> tag_id
    
    for (const tag of allTags) {
        tagIdMap.set(tag.normalized_title.toLowerCase(), tag.id);
        titleToIdMap.set(tag.title.toLowerCase(), tag.id);
    }
    
    // Get all existing wiki IDs
    const existingWikis = db.prepare('SELECT id, title, source FROM wikis').all();
    const existingWikiMap = new Map(); // (title|source) -> wiki_id
    
    for (const wiki of existingWikis) {
        const key = `${wiki.title}|${wiki.source}`;
        existingWikiMap.set(key, wiki.id);
    }
    
    // Process each wiki
    for (let i = 0; i < wikis.length; i++) {
        const wiki = wikis[i];
        const progress = `[${i + 1}/${wikis.length}]`;
        
        try {
            // Check if wiki already exists
            const wikiKey = `${wiki.title}|${source}`;
            let wikiId = existingWikiMap.get(wikiKey);
            
            if (!wikiId) {
                // Normalize wiki body
                const normalized = normalizeWikiBody(wiki.body || '', wiki.title, source);
                
                // Insert wiki
                const result = insertWiki.run(
                    wiki.title,
                    normalized.body,
                    source,
                    wiki.created_at || null,
                    wiki.updated_at || null
                );
                
                if (result.changes > 0) {
                    wikiId = result.lastInsertRowid;
                    insertedCount++;
                    existingWikiMap.set(wikiKey, wikiId);
                    console.log(`   ${progress} ✓ Inserted: ${wiki.title}`);
                } else {
                    // Wiki already exists (INSERT OR IGNORE), get its ID
                    const existing = getWikiId.get(wiki.title, source);
                    if (existing) {
                        wikiId = existing.id;
                        existingWikiMap.set(wikiKey, wikiId);
                    } else {
                        skippedCount++;
                        console.log(`   ${progress} ⚠ Skipped: ${wiki.title} (insert failed)`);
                        continue;
                    }
                }
            } else {
                skippedCount++;
                continue;
            }
            
            // Check if this wiki belongs to a tag
            const normalizedWikiTitle = normalizeTitle(wiki.title);
            const tagId = tagIdMap.get(normalizedWikiTitle) || titleToIdMap.get(wiki.title.toLowerCase());
            
            if (tagId) {
                // Link wiki to tag
                insertTagWiki.run(tagId, wikiId);
                linkedToTagsCount++;
                console.log(`      → Linked to tag ID ${tagId}`);
                
                // Process wiki body links for tag-to-tag relationships
                if (wiki.body) {
                    const normalized = normalizeWikiBody(wiki.body, wiki.title, source);
                    const wikiLinks = extractWikiLinks(normalized.body);
                    
                    for (const link of wikiLinks) {
                        const linkTitle = link.title;
                        const linkPosition = link.position;
                        const normalizedLinkTitle = normalizeTitle(linkTitle);
                        const linkedTagId = tagIdMap.get(normalizedLinkTitle) || titleToIdMap.get(linkTitle.toLowerCase());
                        
                        if (linkedTagId && linkedTagId !== tagId) {
                            // Create tag-to-wiki link (soft link)
                            const relationship = detectLinkRelationship(normalized.body, linkTitle, linkPosition);
                            insertTagWikiLink.run(linkedTagId, wikiId, relationship);
                        }
                    }
                }
            } else {
                // Unlinked wiki page (tag group or other unlinked page)
                unlinkedCount++;
                
                // Check if it's a tag group
                const isTagGroup = wiki.title.toLowerCase().startsWith('tag_group:');
                
                // Insert as wiki page if not already exists
                if (source === SOURCE_DANBOORU) {
                    insertWikiPage.run(
                        wiki.title,
                        wikiId,
                        null,
                        wiki.created_at || null,
                        wiki.updated_at || null,
                        isAfterV45Cutoff(wiki.created_at) ? 1 : 0
                    );
                } else if (source === SOURCE_E621) {
                    insertWikiPage.run(
                        wiki.title,
                        null,
                        wikiId,
                        wiki.created_at || null,
                        wiki.updated_at || null,
                        isAfterV45Cutoff(wiki.created_at) ? 1 : 0
                    );
                }
                
                console.log(`      → Added as unlinked wiki page`);
            }
            
            // Extract and insert sections
            if (wiki.body) {
                const normalized = normalizeWikiBody(wiki.body, wiki.title, source);
                const { sections } = extractWikiSections(normalized.body);
                
                if (sections.length > 0) {
                    // Build section ID map for parent relationships
                    const sectionIdMap = new Map();
                    const sortedSections = [...sections].sort((a, b) => a.index - b.index);
                    
                    for (const section of sortedSections) {
                        let parentSectionId = null;
                        if (section.parentSectionIndex !== null && section.parentSectionIndex !== undefined) {
                            parentSectionId = sectionIdMap.get(section.parentSectionIndex) || null;
                        }
                        
                        const result = insertWikiSection.run(
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
                        );
                        
                        sectionIdMap.set(section.index, result.lastInsertRowid);
                    }
                }
                
                // Extract and insert content links
                const contentLinks = extractWikiContentLinks(normalized.body);
                for (const link of contentLinks) {
                    insertWikiContentLink.run(
                        wikiId,
                        link.type,
                        link.id || null,
                        link.url || null,
                        link.page || null,
                        link.displayText || null,
                        link.searchQuery || null,
                        link.startOffset,
                        link.endOffset
                    );
                }
            }
        } catch (error) {
            console.error(`   ${progress} ❌ Error processing ${wiki.title}: ${error.message}`);
        }
    }
    
    console.log(`\n   ✓ Summary:`);
    console.log(`     - Inserted: ${insertedCount}`);
    console.log(`     - Linked to tags: ${linkedToTagsCount}`);
    console.log(`     - Unlinked pages: ${unlinkedCount}`);
    console.log(`     - Skipped (already exists): ${skippedCount}`);
}

// Run if executed directly
if (require.main === module) {
    main().catch(error => {
        console.error('\n❌ Loading failed:', error);
        process.exit(1);
    });
}

module.exports = {
    main
};

