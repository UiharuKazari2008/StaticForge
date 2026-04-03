/**
 * Merge Danbooru Tag Datasets
 * Merges danbooru_tagwiki.json (wiki content + links) with dataset_tags.json (counts)
 * 
 * danbooru_tagwiki.json structure:
 *   - id, created_at, updated_at, scraped_at
 *   - title, body, category (numeric: 0=General, 1=Artist, 3=Copyright, 4=Character, 5=Meta)
 *   - n (Danbooru count - will become d_count)
 *   - other_names, is_linking_to, is_linked_by
 *   - is_locked, is_deleted
 * 
 * dataset_tags.json structure:
 *   - Key: tag name
 *   - Value: { tag_name, d_id, d_category (string), d_count, n_count, n_rand, words, z_category, d_group }
 */

const fs = require('fs');
const path = require('path');

// Configuration
const WIKI_DATASET_PATH = path.join(__dirname, '..', 'danbooru_tagwiki.json');
const COUNTS_DATASET_PATH = path.join(__dirname, '..', 'dataset_tags.json');
const OUTPUT_PATH = path.join(__dirname, '..', 'danbooru_tagwiki_merged.json');
const BACKUP_PATH = path.join(__dirname, '..', 'danbooru_tagwiki.json.backup');

/**
 * Normalize tag title for matching (handles underscores, spaces, case)
 */
function normalizeTitle(title) {
    if (!title) return '';
    return title.toLowerCase().replace(/[_\s]+/g, '_').trim();
}

/**
 * Load and parse JSON file
 */
function loadJSON(filePath) {
    console.log(`📂 Loading ${path.basename(filePath)}...`);
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const data = JSON.parse(content);
        const tagCount = Object.keys(data).filter(k => k !== '_indexes' && k !== '_tagGroups').length;
        console.log(`   ✓ Loaded ${tagCount} tags (+ metadata)`);
        return data;
    } catch (error) {
        console.error(`   ❌ Error loading ${filePath}:`, error.message);
        throw error;
    }
}

/**
 * Build a lookup map from dataset_tags.json
 */
function buildCountsMap(countsData) {
    console.log('🔍 Building counts lookup map...');
    const countsMap = new Map();
    let processed = 0;
    let hasNCount = 0;
    let hasDCount = 0;
    
    for (const [key, tagInfo] of Object.entries(countsData)) {
        processed++;
        
        // Handle structure: key is tag name, value is tag info object
        let tagName = tagInfo.tag_name || key;
        // Convert underscores to spaces in tag name for matching
        tagName = tagName.replace(/_/g, ' ');
        const normalizedTitle = normalizeTitle(tagName);
        
        if (!normalizedTitle) continue;
        
        // Extract all fields from dataset_tags.json
        const entry = {
            tag_name: tagName, // Store with spaces
            d_category: tagInfo.d_category !== undefined ? tagInfo.d_category : null,
            d_count: tagInfo.d_count || 0,
            n_count: tagInfo.n_count || 0,
            n_rand: tagInfo.n_rand || false,
            words: tagInfo.words || [],
            z_category: tagInfo.z_category || null,
            d_group: tagInfo.d_group || null,
            originalKey: key
        };
        
        if (entry.n_count > 0) hasNCount++;
        if (entry.d_count > 0) hasDCount++;
        
        // Store by normalized title
        if (!countsMap.has(normalizedTitle)) {
            countsMap.set(normalizedTitle, entry);
        } else {
            // If duplicate, merge (take maximum counts)
            const existing = countsMap.get(normalizedTitle);
            entry.d_count = Math.max(existing.d_count || 0, entry.d_count || 0);
            entry.n_count = Math.max(existing.n_count || 0, entry.n_count || 0);
            countsMap.set(normalizedTitle, entry);
        }
        
        if (processed % 100000 === 0) {
            console.log(`   Processed ${processed} entries...`);
        }
    }
    
    console.log(`   ✓ Built map with ${countsMap.size} unique tags`);
    console.log(`   ✓ Tags with n_count: ${hasNCount}`);
    console.log(`   ✓ Tags with d_count: ${hasDCount}`);
    return countsMap;
}

/**
 * Convert string category to numeric category
 */
function categoryStringToNumber(categoryStr) {
    if (typeof categoryStr === 'number') return categoryStr;
    if (!categoryStr) return 0;
    
    const lower = categoryStr.toLowerCase();
    switch(lower) {
        case 'general': return 0;
        case 'artist': return 1;
        case 'copyright': return 3;
        case 'character': return 4;
        case 'meta': return 5;
        default: return 0;
    }
}

/**
 * Merge counts into wiki data
 */
function mergeDatasets(wikiData, countsMap, rebuildIndexes = false) {
    console.log('🔀 Merging datasets...');
    
    let matched = 0;
    let unmatched = 0;
    let updatedNCount = 0;
    let updatedDCount = 0;
    let addedFields = 0;
    let skipped = 0;
    const unmatchedTags = [];
    
    // First pass: Identify numeric keys that duplicate title keys
    const titleKeyMap = new Map(); // title -> key
    const numericKeysToRemove = [];
    
    for (const [key, tag] of Object.entries(wikiData)) {
        if (key === '_indexes' || key === '_tagGroups') continue;
        if (!tag || typeof tag !== 'object' || !tag.title) continue;
        
        const title = tag.title.replace(/_/g, ' '); // Normalize title
        const normalizedTitle = normalizeTitle(title);
        
        // If key is numeric and title is different, check for duplicate
        if (key.match(/^\d+$/) && key !== title) {
            // Check if title already exists as a key (with or without underscores)
            const titleKey = title.replace(/\s+/g, ' ').trim();
            const titleKeyUnderscore = titleKey.replace(/\s+/g, '_');
            
            if (titleKey in wikiData || titleKeyUnderscore in wikiData) {
                // Duplicate found - mark numeric key for removal
                numericKeysToRemove.push(key);
            }
        }
        
        // Build map of title -> original key
        if (!titleKeyMap.has(normalizedTitle)) {
            titleKeyMap.set(normalizedTitle, key);
        }
    }
    
    // Process each tag in wiki data
    const tagsToDelete = [];
    const newTagsStructure = {}; // Regular tags
    const newTagGroupsStructure = {}; // Tag groups (title starts with "tag_group:")
    const keyMapping = new Map(); // old key -> new key
    
    // Get total count for progress
    const totalTags = Object.keys(wikiData).filter(k => k !== '_indexes' && k !== '_tagGroups').length;
    let processedCount = 0;
    const progressInterval = Math.max(10000, Math.floor(totalTags / 20)); // Progress every 5% or 10k tags
    
    console.log(`   Processing ${totalTags} tags...`);
    
    for (const [key, tag] of Object.entries(wikiData)) {
        processedCount++;
        
        // Print progress
        if (processedCount % progressInterval === 0) {
            const percent = Math.round((processedCount / totalTags) * 100);
            console.log(`   Progress: ${processedCount}/${totalTags} (${percent}%) - Matched: ${matched}, Tags: ${Object.keys(newTagsStructure).length}, Groups: ${Object.keys(newTagGroupsStructure).length}`);
        }
        // Skip metadata entries (will handle separately)
        if (key === '_indexes' || key === '_tagGroups') {
            continue;
        }
        
        if (!tag || typeof tag !== 'object' || !tag.title) {
            skipped++;
            continue;
        }
        
        // Skip deleted tags
        if (tag.is_deleted === true) {
            tagsToDelete.push(key);
            skipped++;
            continue;
        }
        
        // Skip numeric keys that duplicate title keys
        if (numericKeysToRemove.includes(key)) {
            skipped++;
            continue;
        }
        
        // Remove ID fields
        delete tag.id;
        delete tag.d_id;
        
        // Check if this is a tag group BEFORE converting underscores (tag_group: vs tag group:)
        const isTagGroup = tag.title && (tag.title.toLowerCase().startsWith('tag_group:') || tag.title.toLowerCase().startsWith('tag group:'));
        
        // Convert underscores to spaces in title
        if (tag.title) {
            tag.title = tag.title.replace(/_/g, ' ');
        }
        
        // Convert underscores to spaces in other_names array
        if (tag.other_names && Array.isArray(tag.other_names)) {
            tag.other_names = tag.other_names.map(name => name.replace(/_/g, ' '));
        }
        
        // Convert underscores to spaces in is_linking_to array
        if (tag.is_linking_to && Array.isArray(tag.is_linking_to)) {
            tag.is_linking_to = tag.is_linking_to.map(link => link.replace(/_/g, ' '));
        }
        
        // Convert underscores to spaces in is_linked_by array
        if (tag.is_linked_by && Array.isArray(tag.is_linked_by)) {
            tag.is_linked_by = tag.is_linked_by.map(link => link.replace(/_/g, ' '));
        }
        
        const normalizedTitle = normalizeTitle(tag.title);
        const countEntry = countsMap.get(normalizedTitle);
        
        // Clean up body field - set to undefined if it's "The wiki page does not exist."
        if (tag.body === "The wiki page does not exist." || tag.body === "The wiki page does not exist") {
            delete tag.body; // Remove the field entirely (undefined in JSON)
        } else if (tag.body) {
            // Normalize newlines: convert \r\n and \r to \n
            tag.body = tag.body.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        }
        
        if (countEntry) {
            // Match found - merge data
            
            // Convert existing n to d_count if not already set
            if (tag.n !== undefined && tag.n !== null && !tag.d_count) {
                tag.d_count = tag.n;
            }
            
            // Update d_count from dataset (take maximum)
            const oldDCount = tag.d_count || tag.n || 0;
            const newDCount = countEntry.d_count || 0;
            if (newDCount > 0 && newDCount !== oldDCount) {
                tag.d_count = newDCount;
                updatedDCount++;
            } else if (newDCount > 0) {
                tag.d_count = newDCount; // Ensure it's set
            }
            
            // Add/update n_count (NovelAI count)
            const oldNCount = tag.n_count || 0;
            const newNCount = countEntry.n_count || 0;
            if (newNCount > 0 && newNCount !== oldNCount) {
                tag.n_count = newNCount;
                updatedNCount++;
            } else if (newNCount > 0) {
                tag.n_count = newNCount; // Ensure it's set
            }
            
            // Update category if missing (convert d_category string to numeric)
            if (countEntry.d_category !== null && countEntry.d_category !== undefined) {
                const numericCategory = categoryStringToNumber(countEntry.d_category);
                if (tag.category === undefined || tag.category === null) {
                    tag.category = numericCategory;
                    addedFields++;
                } else if (tag.category !== numericCategory) {
                    // If both exist and differ, keep wiki's category but also store d_category string
                    tag.d_category = countEntry.d_category;
                }
            }
            
            // Store d_category string for reference (even if we have numeric category)
            if (countEntry.d_category) {
                tag.d_category = countEntry.d_category;
            }
            
            // Add optional fields if they exist and are useful
            if (countEntry.words && Array.isArray(countEntry.words) && countEntry.words.length > 0) {
                // Convert underscores to spaces in words array
                tag.words = countEntry.words.map(word => word.replace(/_/g, ' '));
            }
            if (countEntry.z_category && Array.isArray(countEntry.z_category) && countEntry.z_category.length > 0) {
                tag.z_category = countEntry.z_category;
            }
            if (countEntry.d_group && Array.isArray(countEntry.d_group) && countEntry.d_group.length > 0) {
                tag.d_group = countEntry.d_group;
            }
            if (countEntry.n_rand !== null && countEntry.n_rand !== undefined) {
                tag.n_rand = countEntry.n_rand;
            }
            
            // Remove duplicate n field if d_count exists (d_count is the canonical field)
            if (tag.d_count !== undefined && tag.d_count !== null) {
                delete tag.n; // Remove n since d_count is the duplicate
            } else if (tag.n !== undefined && tag.n !== null) {
                // If we only have n, convert it to d_count
                tag.d_count = tag.n;
                delete tag.n;
            }
            
            matched++;
        } else {
            // No match found - convert n to d_count and remove duplicate
            if (tag.n !== undefined && tag.n !== null) {
                if (!tag.d_count) {
                    tag.d_count = tag.n;
                }
                delete tag.n; // Remove n since d_count is the canonical field
            } else if (!tag.d_count) {
                tag.d_count = 0;
            }
            
            unmatched++;
            if (unmatched <= 100) {
                unmatchedTags.push(tag.title);
            }
        }
        
        // Determine the new key for this tag
        // Title already has spaces (converted at line 206)
        let newKey;
        
        // If current key is numeric and title is different, use title as key
        if (key.match(/^\d+$/) && key !== tag.title) {
            newKey = tag.title.trim();
        } else {
            // Convert underscores to spaces in key
            newKey = key.replace(/_/g, ' ').trim();
        }
        
        // For tag groups, remove "tag_group:" or "tag group:" prefix from key
        if (isTagGroup) {
            newKey = newKey.replace(/^tag[_\s]group:\s*/i, '').trim();
        }
        
        // Select the appropriate structure (tags or tag_groups)
        const targetStructure = isTagGroup ? newTagGroupsStructure : newTagsStructure;
        
        // Handle key conflicts (merge data from duplicates intelligently)
        if (newKey in targetStructure) {
            const existing = targetStructure[newKey];
            
            // Merge strategy: combine data from both, preferring non-empty values
            // Merge arrays (union, no duplicates)
            if (tag.other_names && Array.isArray(tag.other_names) && tag.other_names.length > 0) {
                const existingNames = new Set(existing.other_names || []);
                const mergedNames = [...(existing.other_names || []), ...tag.other_names.filter(n => !existingNames.has(n))];
                existing.other_names = mergedNames;
            }
            
            if (tag.is_linking_to && Array.isArray(tag.is_linking_to) && tag.is_linking_to.length > 0) {
                const existingLinks = new Set(existing.is_linking_to || []);
                const mergedLinks = [...(existing.is_linking_to || []), ...tag.is_linking_to.filter(l => !existingLinks.has(l))];
                existing.is_linking_to = mergedLinks;
            }
            
            if (tag.is_linked_by && Array.isArray(tag.is_linked_by) && tag.is_linked_by.length > 0) {
                const existingLinkedBy = new Set(existing.is_linked_by || []);
                const mergedLinkedBy = [...(existing.is_linked_by || []), ...tag.is_linked_by.filter(l => !existingLinkedBy.has(l))];
                existing.is_linked_by = mergedLinkedBy;
            }
            
            // Merge body (prefer longer/more complete body)
            if (tag.body && (!existing.body || tag.body.length > existing.body.length)) {
                existing.body = tag.body;
            }
            
            // Merge counts (take maximum)
            if (tag.d_count && (!existing.d_count || tag.d_count > existing.d_count)) {
                existing.d_count = tag.d_count;
            }
            if (tag.n_count && (!existing.n_count || tag.n_count > existing.n_count)) {
                existing.n_count = tag.n_count;
            }
            
            // Merge other fields (prefer non-null values)
            for (const [field, value] of Object.entries(tag)) {
                if (field === 'title' || field === 'other_names' || field === 'is_linking_to' || field === 'is_linked_by' || field === 'body' || field === 'd_count' || field === 'n_count') {
                    continue; // Already handled
                }
                if (value !== null && value !== undefined && value !== '' && (!existing[field] || existing[field] === null || existing[field] === '')) {
                    existing[field] = value;
                }
            }
            
            // Track that we merged
            skipped++; // Count as processed but merged
        } else {
            targetStructure[newKey] = tag;
            keyMapping.set(key, newKey);
        }
    }
    
    console.log(`   ✓ Completed processing all ${processedCount} tags`);
    
    // Replace old structure with new one - restructure as { tags: {...}, tag_groups: {...} }
    console.log(`   Rebuilding structure...`);
    // Clear old data
    Object.keys(wikiData).forEach(k => {
        delete wikiData[k];
    });
    
    // Build new structure
    wikiData.tags = newTagsStructure;
    wikiData.tag_groups = newTagGroupsStructure;
    console.log(`   ✓ Structure rebuilt`);
    
    // Count merges more efficiently (O(n) instead of O(n²))
    const newKeyCounts = new Map();
    for (const newKey of keyMapping.values()) {
        newKeyCounts.set(newKey, (newKeyCounts.get(newKey) || 0) + 1);
    }
    let mergedCount = 0;
    for (const count of newKeyCounts.values()) {
        if (count > 1) mergedCount++;
    }
    
    console.log(`   ✓ Matched: ${matched} tags`);
    console.log(`   ✓ Excluded deleted tags: ${tagsToDelete.length}`);
    console.log(`   ✓ Removed duplicate numeric keys: ${numericKeysToRemove.length}`);
    console.log(`   ✓ Rebuilt keys (underscores→spaces, numeric→title): ${keyMapping.size} tags`);
    if (mergedCount > 0) {
        console.log(`   ✓ Merged duplicate entries: ${mergedCount} conflicts resolved`);
    }
    console.log(`   ✓ Updated n_count: ${updatedNCount} tags`);
    console.log(`   ✓ Updated d_count: ${updatedDCount} tags`);
    console.log(`   ✓ Added missing fields: ${addedFields} tags`);
    console.log(`   ✓ Unmatched: ${unmatched} tags`);
    console.log(`   ✓ Skipped: ${skipped} entries`);
    
    if (unmatchedTags.length > 0) {
        console.log(`\n   📋 Sample unmatched tags (first 10):`);
        unmatchedTags.slice(0, 10).forEach(title => {
            console.log(`      - ${title}`);
        });
    }
    
    // Note: Indexes removed - preparing for SQLite database migration
    console.log(`\n   ✓ Separated into tags and tag_groups`);
    console.log(`   ✓ Tags: ${Object.keys(newTagsStructure).length}`);
    console.log(`   ✓ Tag groups: ${Object.keys(newTagGroupsStructure).length}`);
    
    return {
        matched,
        updatedNCount,
        updatedDCount,
        addedFields,
        unmatched,
        skipped,
        tagCount: Object.keys(newTagsStructure).length,
        tagGroupCount: Object.keys(newTagGroupsStructure).length
    };
}

/**
 * Clean up null and empty values from the dataset
 */
function cleanNullValues(data) {
    let cleaned = 0;
    
    // Process both tags and tag_groups
    const structures = [data.tags, data.tag_groups].filter(s => s);
    
    let totalToClean = 0;
    for (const structure of structures) {
        totalToClean += Object.keys(structure).length;
    }
    
    let cleanedCount = 0;
    const progressInterval = Math.max(10000, Math.floor(totalToClean / 20));
    
    for (const structure of structures) {
        for (const [key, tag] of Object.entries(structure)) {
            cleanedCount++;
            
            if (cleanedCount % progressInterval === 0) {
                const percent = Math.round((cleanedCount / totalToClean) * 100);
                console.log(`   Cleaning: ${cleanedCount}/${totalToClean} (${percent}%) - Removed ${cleaned} fields`);
            }
            
            if (!tag || typeof tag !== 'object') {
                continue;
            }
            
            // Remove ID fields if they still exist
            delete tag.id;
            delete tag.d_id;
            
            // Remove null, undefined, and empty string values
            for (const [field, value] of Object.entries(tag)) {
                if (value === null || value === undefined || value === '') {
                    delete tag[field];
                    cleaned++;
                } else if (Array.isArray(value) && value.length === 0) {
                    delete tag[field];
                    cleaned++;
                }
            }
        }
    }
    
    if (cleaned > 0) {
        console.log(`   ✓ Cleaned ${cleaned} null/empty fields`);
    }
}

// Index building removed - preparing for SQLite database migration

/**
 * Clean up tag groups by removing unneeded properties
 * Keeps only: title, body, is_linking_to, is_linked_by, category
 * @param {Object} tagGroups - The tag_groups object
 */
function cleanTagGroups(tagGroups) {
    console.log('\n🧹 Cleaning tag groups...');
    
    const propertiesToKeep = ['title', 'body', 'is_linking_to', 'is_linked_by', 'category', 'updated_at', 'created_at'];
    let removedCount = 0;
    
    for (const [key, group] of Object.entries(tagGroups)) {
        if (!group || typeof group !== 'object') continue;
        
        const originalKeys = Object.keys(group);
        for (const prop of originalKeys) {
            if (!propertiesToKeep.includes(prop)) {
                delete group[prop];
                removedCount++;
            }
        }
    }
    
    console.log(`   ✓ Removed ${removedCount} unneeded properties from tag groups`);
}

/**
 * Main merge function
 */
function main() {
    console.log('🚀 Starting Danbooru dataset merge...\n');
    console.log('📋 Merge Plan:');
    console.log('   Source 1: danbooru_tagwiki.json (wiki content, links, metadata)');
    console.log('   Source 2: dataset_tags.json (counts: d_count, n_count, additional fields)');
    console.log('   Output: danbooru_tagwiki_merged.json (merged dataset with indexes)\n');
    
    try {
        // Step 1: Load datasets
        const wikiData = loadJSON(WIKI_DATASET_PATH);
        const countsData = loadJSON(COUNTS_DATASET_PATH);
        
        // Step 2: Create backup
        console.log('\n💾 Creating backup...');
        if (fs.existsSync(WIKI_DATASET_PATH)) {
            fs.copyFileSync(WIKI_DATASET_PATH, BACKUP_PATH);
            console.log(`   ✓ Backup created: ${path.basename(BACKUP_PATH)}`);
        }
        
        // Step 3: Build counts lookup map
        console.log('\n');
        const countsMap = buildCountsMap(countsData);
        
        // Step 4: Merge datasets (no indexes - preparing for SQLite)
        console.log('\n');
        const stats = mergeDatasets(wikiData, countsMap, false);
        
        // Step 5: Clean up tag groups (remove unneeded properties)
        if (wikiData.tag_groups && Object.keys(wikiData.tag_groups).length > 0) {
            cleanTagGroups(wikiData.tag_groups);
        }
        
        // Step 6: Clean up null/empty values and save merged dataset
        console.log('\n💾 Cleaning up and saving merged dataset...');
        cleanNullValues(wikiData);
        
        console.log(`   Serializing JSON (this may take a while for large datasets)...`);
        const startSerialize = Date.now();
        const jsonString = JSON.stringify(wikiData, null, 2);
        const serializeTime = ((Date.now() - startSerialize) / 1000).toFixed(1);
        console.log(`   ✓ JSON serialized in ${serializeTime}s, writing to file...`);
        
        const startWrite = Date.now();
        fs.writeFileSync(OUTPUT_PATH, jsonString, 'utf8');
        const writeTime = ((Date.now() - startWrite) / 1000).toFixed(1);
        const fileSize = (fs.statSync(OUTPUT_PATH).size / 1024 / 1024).toFixed(2);
        console.log(`   ✓ Saved to: ${path.basename(OUTPUT_PATH)} (${fileSize} MB, write time: ${writeTime}s)`);
        
        // Step 7: Summary
        console.log('\n✅ Merge complete!');
        console.log('\n📊 Summary:');
        console.log(`   Total tags: ${stats.tagCount}`);
        console.log(`   Tag groups: ${stats.tagGroupCount}`);
        console.log(`   Matched tags: ${stats.matched}`);
        console.log(`   Updated n_count: ${stats.updatedNCount}`);
        console.log(`   Updated d_count: ${stats.updatedDCount}`);
        console.log(`   Added missing fields: ${stats.addedFields}`);
        console.log(`   Unmatched tags: ${stats.unmatched}`);
        console.log(`   Skipped entries: ${stats.skipped}`);
        console.log(`\n   Backup: ${path.basename(BACKUP_PATH)}`);
        console.log(`   Output: ${path.basename(OUTPUT_PATH)}`);
        console.log('\n📝 Notes:');
        console.log('   - Structure: { tags: {...}, tag_groups: {...} }');
        console.log('   - Tag groups separated (title starts with "tag_group:")');
        console.log('   - Tag groups cleaned (only title, body, is_linking_to, is_linked_by, category kept)');
        console.log('   - Indexes removed (preparing for SQLite database migration)');
        console.log('   - n_count (NovelAI) and d_count (Danbooru) are both preserved');
        console.log('   - Duplicate n field removed (d_count is the canonical field)');
        console.log('   - Empty body fields ("The wiki page does not exist.") removed');
        console.log('   - Body newlines normalized (\\r\\n and \\r → \\n)');
        console.log('   - Keys converted: underscores → spaces, numeric IDs → tag titles');
        console.log('   - Duplicate handling: merges complementary data (arrays union, max counts, longer body)');
        console.log('   - Null/empty fields cleaned up');
        console.log('   - Additional fields (words, z_category, d_group) added where available');
        console.log('   - The merged file is ready to replace danbooru_tagwiki.json');
        
    } catch (error) {
        console.error('\n❌ Merge failed:', error);
        process.exit(1);
    }
}

// Run if executed directly
if (require.main === module) {
    main();
}

