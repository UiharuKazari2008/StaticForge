/**
 * Tag Wiki Data Loader
 * Utility module for loading and indexing tag wiki data
 * Separated from tag-lookup.js to avoid circular dependencies
 */

const fs = require('fs');
const path = require('path');

/**
 * Loads e621 tag data from JSON file and normalizes it to danbooru format
 * 
 * @param {string} filePath - Path to e621_wiki_fixed.json file
 * @returns {Object} Tag database object with indexes (normalized format)
 */
function loadE621WikiData(filePath) {
    try {
        const fullPath = path.resolve(filePath);
        const fileContent = fs.readFileSync(fullPath, 'utf8');
        const data = JSON.parse(fileContent);
        
        // e621 format has a "wiki" object containing the tags
        const wikiData = data.wiki || {};
        
        // Build indexes for faster searching
        console.log('Building e621 search indexes...');
        const indexes = {
            byTitle: new Map(),           // title.toLowerCase() -> tag
            byOtherName: new Map(),       // otherName.toLowerCase() -> array of tags
            byCategory: new Map(),        // category -> array of tags
            titleLowercase: new Map()     // Original title -> lowercase title
        };
        
        let processed = 0;
        for (const [key, tag] of Object.entries(wikiData)) {
            processed++;
            
            // Normalize e621 tag to danbooru format
            const normalizedTag = {
                id: tag.id,
                title: tag.title,
                body: tag.body || '',
                category: 0, // e621 doesn't have categories, default to 0 (General)
                n: 0, // e621 doesn't have usage counts
                other_names: [], // e621 doesn't have other_names array
                source: 'e621'
            };
            
            // Index by title (normalized) - convert underscores to spaces
            const titleLower = normalizedTag.title?.toLowerCase().replace(/_/g, ' ');
            indexes.byTitle.set(titleLower, normalizedTag);
            indexes.titleLowercase.set(normalizedTag.title, titleLower);
            
            // e621 doesn't have other_names or categories, so skip those indexes
            
            // Index by category (all go to category 0 for e621)
            if (!indexes.byCategory.has(0)) {
                indexes.byCategory.set(0, []);
            }
            indexes.byCategory.get(0).push(normalizedTag);
            
            if (processed % 50000 === 0) {
                console.log(`  Indexed ${processed}/${Object.keys(wikiData).length} e621 tags...`);
            }
        }
        
        console.log(`Built indexes for ${processed} e621 tags\n`);
        
        // Create normalized data object (similar to danbooru format)
        const normalizedData = {};
        for (const [key, tag] of Object.entries(wikiData)) {
            normalizedData[tag.title] = {
                id: tag.id,
                title: tag.title,
                body: tag.body || '',
                category: 0,
                n: 0,
                other_names: [],
                source: 'e621'
            };
        }
        
        // Attach indexes and tag groups to data object
        normalizedData._indexes = indexes;
        normalizedData._tagGroups = []; // e621 doesn't have tag groups
        
        return normalizedData;
    } catch (error) {
        throw new Error(`Failed to load e621 tag data: ${error.message}`);
    }
}

/**
 * Loads tag data from JSON file and builds search indexes
 * 
 * @param {string} filePath - Path to tags.json file
 * @returns {Object} Tag database object with indexes
 */
function loadTagWikiData(filePath) {
    try {
        const fullPath = path.resolve(filePath);
        const fileContent = fs.readFileSync(fullPath, 'utf8');
        const data = JSON.parse(fileContent);
        
        // Build indexes for faster searching
        console.log('Building search indexes...');
        const indexes = {
            byTitle: new Map(),           // title.toLowerCase() -> tag
            byOtherName: new Map(),       // otherName.toLowerCase() -> array of tags
            byCategory: new Map(),        // category -> array of tags
            titleLowercase: new Map()     // Original title -> lowercase title
        };
        
        let processed = 0;
        for (const tag of Object.values(data)) {
            processed++;
            
            // Index by title (normalized) - convert underscores to spaces
            const titleLower = tag?.title?.toLowerCase().replace(/_/g, ' ');
            indexes.byTitle.set(titleLower, tag);
            indexes.titleLowercase.set(tag.title, titleLower);
            
            // Index by other names - convert underscores to spaces
            if (tag.other_names && Array.isArray(tag.other_names)) {
                for (const otherName of tag.other_names) {
                    const otherNameLower = otherName?.toLowerCase()?.replace(/_/g, ' ');
                    if (!indexes.byOtherName.has(otherNameLower)) {
                        indexes.byOtherName.set(otherNameLower, []);
                    }
                    indexes.byOtherName.get(otherNameLower).push(tag);
                }
            }
            
            // Index by category
            if (!indexes.byCategory.has(tag.category)) {
                indexes.byCategory.set(tag.category, []);
            }
            indexes.byCategory.get(tag.category).push(tag);
            
            if (processed % 50000 === 0) {
                console.log(`  Indexed ${processed}/${Object.keys(data).length} tags...`);
            }
        }
        
        console.log(`Built indexes for ${processed} tags\n`);
        
        // Extract tag groups for context
        const tagGroups = new Set();
        for (const tag of Object.values(data)) {
            if (tag.title.startsWith('tag_group:')) {
                // Extract clean group name (remove tag_group: prefix)
                const groupName = tag.title.replace('tag_group:', '').trim();
                tagGroups.add(groupName);
            }
        }
        console.log(`Found ${tagGroups.size} tag groups\n`);
        
        // Attach indexes and tag groups to data object
        data._indexes = indexes;
        data._tagGroups = Array.from(tagGroups).sort();
        
        return data;
    } catch (error) {
        throw new Error(`Failed to load tag data: ${error.message}`);
    }
}

module.exports = {
    loadTagWikiData,
    loadE621WikiData
};

