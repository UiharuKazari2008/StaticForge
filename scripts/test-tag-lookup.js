#!/usr/bin/env node
/**
 * Quick smoke-test runner for modules/tag-lookup.js
 *
 * Executes every exported function with representative inputs, printing results
 * so you can visually confirm they look reasonable. Designed to be run via:
 *
 *    node scripts/test-tag-lookup.js
 *
 * Requires that .cache/tag_wiki.db exists (created by scripts/create-tag-database.js).
 */

const util = require('util');
const globalResources = require('../modules/globalResources');

const SAMPLE_TAG = process.env.TAG_LOOKUP_SAMPLE_TAG || 'solo';
const SAMPLE_TAG_ALT = process.env.TAG_LOOKUP_SAMPLE_TAG_ALT || 'solo';
const SAMPLE_DESCRIPTION = process.env.TAG_LOOKUP_SAMPLE_DESCRIPTION || 'solo fat rapi';
const SAMPLE_TAGS_ARRAY = (() => {
    const raw = process.env.TAG_LOOKUP_SAMPLE_TAGS;
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.map(tag => String(tag)) : null;
    } catch (error) {
        console.warn('⚠️  Failed to parse TAG_LOOKUP_SAMPLE_TAGS (expected JSON array):', error.message);
        return null;
    }
})();

function logHeader(title) {
    console.log('\n============================================================');
    console.log(title);
    console.log('============================================================');
}

function inspect(value, depth = 4) {
    return util.inspect(value, { depth, colors: true, maxArrayLength: 20 });
}

function summarizeTags(tags, limit = 3) {
    if (!Array.isArray(tags)) return tags;
    return tags.slice(0, limit).map(tag => ({
        title: tag?.title,
        category: tag?.categoryName || tag?.category,
        counts: {
            d: tag?.d_count,
            e: tag?.e_count,
            n: tag?.n_count
        }
    }));
}

async function testCoreFunctions() {
    const tagLookup = globalResources.getTagDatabase();
    
    logHeader('findTagExact');
    const exact = await tagLookup.findTagExact(SAMPLE_TAG);
    console.log(inspect(exact, 2));

    logHeader('searchTags');
    const searches = await tagLookup.searchTags(SAMPLE_TAG_ALT, { limit: 5 });
    console.log(inspect(summarizeTags(searches)));

    logHeader('getLinkedTags');
    const links = await tagLookup.getLinkedTags(SAMPLE_TAG, 1, 'both');
    console.log(inspect({
        linksTo: summarizeTags(links.linksTo),
        linkedBy: summarizeTags(links.linkedBy)
    }));

    logHeader('getCategoryName');
    console.log('Category 0 =>', tagLookup.getCategoryName(0));
    console.log('Category 1 =>', tagLookup.getCategoryName(1));
    console.log('Category 3 =>', tagLookup.getCategoryName(3));

    logHeader('levenshteinDistance / getTitleMatchScore');
    console.log('levenshteinDistance("solo", "sola") =>', tagLookup.levenshteinDistance('solo', 'sola'));
    console.log('getTitleMatchScore("solo_combat", "solo") =>', tagLookup.getTitleMatchScore('solo_combat', 'solo'));

    logHeader('getTagGroupsInfo');
    console.log(inspect(tagLookup.getTagGroupsInfo(), 2));

    return { exact };
}

async function testToolHandlers(exactTag) {
    const tagLookup = globalResources.getTagDatabase();
    const sampleTagName = exactTag?.title || SAMPLE_TAG;

    logHeader('handleSearchTagsBatch');
    const batchTagSpecs = (SAMPLE_TAGS_ARRAY && SAMPLE_TAGS_ARRAY.length > 0)
        ? SAMPLE_TAGS_ARRAY.map(tagName => ({ name: tagName, limit: 5 }))
        : [
            { name: sampleTagName, limit: 5, returnFields: ['title', 'usage', 'body'], resolveLinks: false },
            { name: SAMPLE_TAG_ALT, limit: 3 }
        ];
    const batch = await tagLookup.handleSearchTagsBatch({ tags: batchTagSpecs });
    console.log(batch.markdown);

    logHeader('handleGetTagDetails');
    const details = await tagLookup.handleGetTagDetails({
        tags: [{ name: sampleTagName }, { name: SAMPLE_TAG_ALT, returnFields: ['title', 'category', 'usage'] }]
    });
    console.log(details.markdown);

    logHeader('handleResolveTagLinks');
    const resolved = await tagLookup.handleResolveTagLinks({
        tagName: sampleTagName,
        depth: 1,
        direction: 'both',
        reason: 'test resolve'
    });
    console.log(resolved.markdown);

    logHeader('handleSearchByDescription');
    const descriptionResults = await tagLookup.handleSearchByDescription({
        description: SAMPLE_DESCRIPTION,
        limit: 30,
        reason: 'test description search'
    });
    console.log(descriptionResults.markdown);

    const preferredBodySource = (() => {
        if (exactTag?.bodies?.custom) return 'summary';
        if (exactTag?.bodies?.danbooru) return 'danbooru';
        if (exactTag?.bodies?.e621) return 'e621';
        return 'danbooru';
    })();

    logHeader('handleGetBodyChunk');
    const chunkResult = await tagLookup.handleGetBodyChunk({
        tagName: sampleTagName,
        chunkIndex: 0,
        bodySource: preferredBodySource,
        reason: `test body chunk (${preferredBodySource})`
    });
    console.log(chunkResult.markdown);

    const availableSections = chunkResult?.json?.availableSections;
    const totalSections = chunkResult?.json?.totalSections || 0;
    
    if (Array.isArray(availableSections) && availableSections.length > 0) {
        // Test section lookup by numeric index (1-based, primary method)
        logHeader(`handleGetBodyChunk (section: 1 - by index)`);
        const sectionByIndex = await tagLookup.handleGetBodyChunk({
            tagName: sampleTagName,
            chunkIndex: 0,
            bodySource: preferredBodySource,
            section: 1,  // Use numeric index (1-based, matches display)
            reason: `test body chunk section by index (1)`
        });
        console.log(sectionByIndex.markdown);
        
        // Test section lookup by anchor (fallback method)
        const sectionAnchor = availableSections[0].anchor;
        if (sectionAnchor) {
            logHeader(`handleGetBodyChunk (section: ${sectionAnchor} - by anchor)`);
            const sectionByAnchor = await tagLookup.handleGetBodyChunk({
                tagName: sampleTagName,
                chunkIndex: 0,
                bodySource: preferredBodySource,
                section: sectionAnchor,
                reason: `test body chunk section by anchor (${sectionAnchor})`
            });
            console.log(sectionByAnchor.markdown);
        }
        
        // Test multiple sections by index if available
        if (totalSections > 1) {
            const testIndex = Math.min(2, totalSections);
            logHeader(`handleGetBodyChunk (section: ${testIndex} - by index)`);
            const sectionByIndex2 = await tagLookup.handleGetBodyChunk({
                tagName: sampleTagName,
                chunkIndex: 0,
                bodySource: preferredBodySource,
                section: testIndex,  // Test second section
                reason: `test body chunk section by index (${testIndex})`
            });
            console.log(sectionByIndex2.markdown);
        }
    }

    logHeader('handleGetDatasetGroupContents');
    
    // First, find the path where the tag "fat" is located
    logHeader('Finding dataset group path for tag "fat"');
    const fatTag = await tagLookup.findTagExact('fat');
    let fatGroupPath = null;
    
    if (fatTag && fatTag.id) {
        // Query database to find which dataset group contains "fat"
        const Database = require('better-sqlite3');
        const dbPath = require('path').join(__dirname, '../.cache/tag_wiki.db');
        try {
            const db = new Database(dbPath, { readonly: true });
            const findGroupForTag = db.prepare(`
                SELECT dg.id, dg.path, dg.name, dg.pretty_name
                FROM dataset_group_members dgm
                JOIN d_groups dg ON dg.id = dgm.group_id
                WHERE dgm.tag_id = ?
                LIMIT 1
            `);
            const groupRow = findGroupForTag.get(fatTag.id);
            if (groupRow) {
                // Convert database path to array (e.g., "g/body/bodytype/chubby" -> ["body", "bodytype", "chubby"])
                const pathStr = groupRow.path;
                if (pathStr && pathStr.startsWith('g/')) {
                    fatGroupPath = pathStr.substring(2).split('/').filter(p => p);
                    console.log(`Found tag "fat" in group: ${fatGroupPath.join(' > ')}`);
                    console.log(`Group name: ${groupRow.pretty_name || groupRow.name}`);
                }
            }
            db.close();
        } catch (dbError) {
            console.warn('⚠️  Could not query database for fat tag group:', dbError.message);
        }
    }
    
    // Test with the found path, or fall back to common paths
    const testPaths = fatGroupPath 
        ? [fatGroupPath]
        : [
            ['attire', 'sexual', 'lingerie'],
            ['attire', 'bra', 'models'],
            ['body', 'bodytype', 'chubby']
        ];
    
    let groupResult = null;
    for (const testPath of testPaths) {
        try {
            groupResult = await tagLookup.handleGetDatasetGroupContents({
                path: testPath,
                includeFullTable: false,
                reason: `test dataset group contents: ${testPath.join(' > ')}`
            });
            if (!groupResult.error) {
                console.log(`Testing path: ${testPath.join(' > ')}`);
                console.log(groupResult.markdown);
                break;
            }
        } catch (error) {
            console.warn(`Path ${testPath.join(' > ')} failed:`, error.message);
        }
    }
    
    if (groupResult && !groupResult.error) {
        // Test with includeFullTable=true
        logHeader('handleGetDatasetGroupContents (includeFullTable=true)');
        const fullTableResult = await tagLookup.handleGetDatasetGroupContents({
            path: groupResult.json.path,
            includeFullTable: true,
            reason: 'test dataset group contents with full table'
        });
        console.log(fullTableResult.markdown);
        
        // Test partial path matching (fuzzy search)
        if (groupResult.json.path && groupResult.json.path.length > 1) {
            logHeader('handleGetDatasetGroupContents (partial path - last element only)');
            const partialPath = [groupResult.json.path[groupResult.json.path.length - 1]];
            const partialResult = await tagLookup.handleGetDatasetGroupContents({
                path: partialPath,
                includeFullTable: false,
                reason: `test partial path matching: ${partialPath.join(' > ')}`
            });
            if (!partialResult.error) {
                console.log(partialResult.markdown);
            } else {
                console.warn('⚠️  Partial path test failed:', partialResult.error);
            }
        }
    } else {
        console.warn('⚠️  Could not find a valid dataset group path to test');
    }
}

async function main() {
    try {
        // Initialize globalResources first
        await globalResources.initialize();
        
        const { exact } = await testCoreFunctions();
        await testToolHandlers(exact);
        console.log('\n✅ tag-lookup smoke tests completed');
        process.exit(0);
    } catch (error) {
        console.error('\n❌ tag-lookup smoke tests failed:', error);
        process.exitCode = 1;
    }
}

main();
