/**
 * Download Missing Wiki Pages from Danbooru and e621
 * 
 * This script:
 * 1. Reads tags_missing_wikis.json
 * 2. Fetches wiki pages from Danbooru or e621 API
 * 3. Extracts raw DText body content
 * 4. Saves to JSON files that can be loaded into the database
 * 
 * Features:
 * - Rate limiting (250ms between requests)
 * - Progress logging
 * - Error handling and retry logic
 * - Skips already downloaded files
 * - Supports both Danbooru and e621 APIs
 * - Handles both tags and wiki pages
 * 
 * Output format:
 * - danbooru_missing_wikis.json - Array of wiki objects with title, body, created_at, updated_at
 * - e621_missing_wikis.json - Array of wiki objects with title, body, created_at, updated_at
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const config = require('../config');

// Configuration
const MISSING_WIKIS_FILE = path.join(__dirname, '..', 'data', 'tags_missing_wikis.json');
const OUTPUT_DIR = path.join(__dirname, '..', 'data');
const DANBOORU_API_BASE = 'https://danbooru.donmai.us';
const E621_API_BASE = 'https://e621.net';
const SOURCE_DANBOORU = 1;
const SOURCE_E621 = 2;

// Rate limiting: wait 250ms between requests
const RATE_LIMIT_DELAY = 250;
// Retry configuration
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;
// Consecutive failure limit
const MAX_CONSECUTIVE_FAILURES = 10;

/**
 * Sleep for specified milliseconds
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Normalize tag/wiki title for URL encoding
 */
function normalizeTitleForUrl(title) {
    if (!title) return '';
    let normalized = title.trim();
    normalized = normalized.replace(/^(?:species|invalid):/i, '');
    return normalized.replace(/\s+/g, '_').trim();
}

/**
 * Fetch JSON data from URL using native https/http
 */
function fetchJson(url, retries = 0) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const client = urlObj.protocol === 'https:' ? https : http;
        
        const defaultUserAgent = config.userAgent || 'StaticForge/1.0 (https://staticforge.app)';
        
        const options = {
            hostname: urlObj.hostname,
            port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
            path: urlObj.pathname + urlObj.search,
            method: 'GET',
            headers: {
                'User-Agent': defaultUserAgent,
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
                        resolve(null); // Wiki doesn't exist
                        return;
                    }
                    if (res.statusCode === 429 && retries < MAX_RETRIES) {
                        // Rate limited, retry
                        setTimeout(() => {
                            fetchJson(url, retries + 1).then(resolve).catch(reject);
                        }, RETRY_DELAY * (retries + 1));
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
            if (retries < MAX_RETRIES) {
                setTimeout(() => {
                    fetchJson(url, retries + 1).then(resolve).catch(reject);
                }, RETRY_DELAY * (retries + 1));
            } else {
                reject(error);
            }
        });

        req.on('timeout', () => {
            req.destroy();
            if (retries < MAX_RETRIES) {
                setTimeout(() => {
                    fetchJson(url, retries + 1).then(resolve).catch(reject);
                }, RETRY_DELAY * (retries + 1));
            } else {
                reject(new Error('Request timeout'));
            }
        });
    });
}

/**
 * Fetch wiki page from Danbooru API by title
 * Handles both wiki pages and tag wikis (tags have wiki pages with same title)
 */
async function fetchDanbooruWikiByTitle(title) {
    // Danbooru API: search by exact title
    const encodedTitle = encodeURIComponent(normalizeTitleForUrl(title));
    const url = `${DANBOORU_API_BASE}/wiki_pages.json?search[title]=${encodedTitle}&limit=1`;
    
    try {
        const results = await fetchJson(url);
        if (results && Array.isArray(results) && results.length > 0) {
            // Find exact match (case-insensitive, handle spaces/underscores)
            const normalizedSearch = title.toLowerCase().replace(/\s+/g, '_');
            const exactMatch = results.find(w => {
                if (!w.title) return false;
                const normalizedWiki = w.title.toLowerCase().replace(/\s+/g, '_');
                return normalizedWiki === normalizedSearch || 
                       w.title.toLowerCase() === title.toLowerCase();
            });
            if (exactMatch) {
                return exactMatch;
            }
            // Return first result if no exact match
            return results[0];
        }
        
        // If not found as wiki page, check if it's a tag (tags can have wikis with same title)
        // Try fetching tag to see if it exists and has a wiki_id
        const tagUrl = `${DANBOORU_API_BASE}/tags.json?search[name]=${encodedTitle}&limit=1`;
        const tagResults = await fetchJson(tagUrl);
        if (tagResults && Array.isArray(tagResults) && tagResults.length > 0) {
            const tag = tagResults[0];
            // If tag has wiki_id, fetch the wiki directly
            if (tag.wiki_page_id || tag.wiki_id) {
                const wikiId = tag.wiki_page_id || tag.wiki_id;
                const wikiUrl = `${DANBOORU_API_BASE}/wiki_pages/${wikiId}.json`;
                const wikiResult = await fetchJson(wikiUrl);
                if (wikiResult) {
                    return wikiResult;
                }
            }
        }
        
        return null;
    } catch (error) {
        console.error(`   ❌ Error fetching Danbooru wiki "${title}": ${error.message}`);
        return null;
    }
}

/**
 * Fetch wiki page from e621 API by title
 * Handles both wiki pages and tag wikis (tags have wiki pages with same title)
 */
async function fetchE621WikiByTitle(title) {
    // e621 API: search by exact title
    const encodedTitle = encodeURIComponent(normalizeTitleForUrl(title));
    const url = `${E621_API_BASE}/wiki_pages.json?search[title]=${encodedTitle}&limit=10`;
    
    try {
        const results = await fetchJson(url);
        if (results && Array.isArray(results) && results.length > 0) {
            // Find exact match (case-insensitive, handle underscores/spaces)
            const normalizedTitle = title.toLowerCase().replace(/\s+/g, '_');
            const exactMatch = results.find(w => {
                if (!w.title) return false;
                const normalizedWikiTitle = w.title.toLowerCase().replace(/\s+/g, '_');
                return normalizedWikiTitle === normalizedTitle || 
                       w.title.toLowerCase() === title.toLowerCase();
            });
            if (exactMatch) {
                return exactMatch;
            }
            // Return first result if no exact match
            return results[0];
        }
        
        // If not found as wiki page, check if it's a tag (tags can have wikis with same title)
        // Try fetching tag to see if it exists and has wiki information
        const tagUrl = `${E621_API_BASE}/tags.json?search[name]=${encodedTitle}&limit=1`;
        const tagResults = await fetchJson(tagUrl);
        if (tagResults && Array.isArray(tagResults) && tagResults.length > 0) {
            const tag = tagResults[0];
            // e621 tags don't have wiki_id directly, but wiki pages have same title as tag
            // So we already tried that above - if not found, the tag doesn't have a wiki
        }
        
        return null;
    } catch (error) {
        console.error(`   ❌ Error fetching e621 wiki "${title}": ${error.message}`);
        return null;
    }
}

/**
 * Extract wiki data from API response
 */
function extractWikiData(apiResult, source) {
    if (!apiResult) return null;
    
    // Handle different API response formats
    // Danbooru uses 'body' field, e621 uses 'body' field
    // Both should contain raw DText
    const body = apiResult.body || apiResult.body_text || apiResult.body_html || '';
    const title = apiResult.title || apiResult.name || apiResult.other_names?.[0] || '';
    
    // Handle date formats (ISO string, timestamp, etc.)
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
    
    const isLocked = apiResult.is_locked === true || apiResult.is_locked === 1 || apiResult.locked === true;
    
    // Skip if no body or empty body
    if (!body || typeof body !== 'string' || body.trim() === '' || body === "The wiki page does not exist.") {
        return null;
    }
    
    // Normalize title: replace underscores with spaces (for consistency)
    const normalizedTitle = title.replace(/_/g, ' ').trim();
    
    return {
        title: normalizedTitle,
        body: body, // Raw DText body
        created_at: createdAt,
        updated_at: updatedAt,
        is_locked: isLocked ? 1 : 0
    };
}

/**
 * Download wikis for a specific source
 */
async function downloadWikisForSource(items, source, sourceName) {
    console.log(`\n📥 Downloading ${sourceName} wikis...`);
    console.log(`   Total items: ${items.length}`);
    
    const downloadedWikis = [];
    let successCount = 0;
    let notFoundCount = 0;
    let errorCount = 0;
    let consecutiveFailures = 0;
    
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const progress = `[${i + 1}/${items.length}]`;
        
        // Rate limiting
        if (i > 0) {
            await sleep(RATE_LIMIT_DELAY);
        }
        
        try {
            let wikiData = null;
            
            if (source === SOURCE_DANBOORU) {
                wikiData = await fetchDanbooruWikiByTitle(item);
            } else if (source === SOURCE_E621) {
                wikiData = await fetchE621WikiByTitle(item);
            }
            
            if (wikiData) {
                const extracted = extractWikiData(wikiData, source);
                if (extracted) {
                    downloadedWikis.push(extracted);
                    successCount++;
                    consecutiveFailures = 0;
                    console.log(`   ${progress} ✓ ${item}`);
                } else {
                    notFoundCount++;
                    consecutiveFailures++;
                    console.log(`   ${progress} ⚠ ${item} (no body or empty)`);
                }
            } else {
                notFoundCount++;
                consecutiveFailures++;
                console.log(`   ${progress} ⚠ ${item} (not found)`);
            }
            
            // Stop if too many consecutive failures
            if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
                console.log(`\n   ⚠️  Stopping after ${MAX_CONSECUTIVE_FAILURES} consecutive failures`);
                break;
            }
            
            // Progress update every 10 items
            if ((i + 1) % 10 === 0) {
                console.log(`   Progress: ${successCount} downloaded, ${notFoundCount} not found, ${errorCount} errors`);
            }
        } catch (error) {
            errorCount++;
            consecutiveFailures++;
            console.error(`   ${progress} ❌ ${item}: ${error.message}`);
            
            // Stop if too many consecutive failures
            if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
                console.log(`\n   ⚠️  Stopping after ${MAX_CONSECUTIVE_FAILURES} consecutive failures`);
                break;
            }
        }
    }
    
    console.log(`\n   ✓ ${sourceName} download complete:`);
    console.log(`     - Downloaded: ${successCount}`);
    console.log(`     - Not found: ${notFoundCount}`);
    console.log(`     - Errors: ${errorCount}`);
    
    return downloadedWikis;
}

/**
 * Main function
 */
async function main() {
    console.log('🚀 Starting wiki page download...\n');
    
    // Check if missing wikis file exists
    if (!fs.existsSync(MISSING_WIKIS_FILE)) {
        console.error(`❌ Missing wikis file not found: ${path.basename(MISSING_WIKIS_FILE)}`);
        console.error('   Please run create-tag-database.js first to generate the file.');
        process.exit(1);
    }
    
    // Load missing wikis data
    console.log(`📂 Loading ${path.basename(MISSING_WIKIS_FILE)}...`);
    const missingWikisData = JSON.parse(fs.readFileSync(MISSING_WIKIS_FILE, 'utf8'));
    
    const danbooruItems = missingWikisData.danbooru || [];
    const e621Items = missingWikisData.e621 || [];
    
    console.log(`   ✓ Loaded ${danbooruItems.length} Danbooru items, ${e621Items.length} E621 items`);
    
    if (danbooruItems.length === 0 && e621Items.length === 0) {
        console.log('\n✅ No missing wikis to download!');
        return;
    }
    
    // Ensure output directory exists
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }
    
    // Download Danbooru wikis
    const danbooruWikis = [];
    if (danbooruItems.length > 0) {
        danbooruWikis.push(...await downloadWikisForSource(danbooruItems, SOURCE_DANBOORU, 'Danbooru'));
    }
    
    // Download e621 wikis
    const e621Wikis = [];
    if (e621Items.length > 0) {
        e621Wikis.push(...await downloadWikisForSource(e621Items, SOURCE_E621, 'E621'));
    }
    
    // Save downloaded wikis to JSON files
    if (danbooruWikis.length > 0) {
        const danbooruOutputPath = path.join(OUTPUT_DIR, 'danbooru_missing_wikis.json');
        const danbooruOutput = {
            _metadata: {
                generated_at: new Date().toISOString(),
                source: 'danbooru',
                total_wikis: danbooruWikis.length,
                source_file: path.basename(MISSING_WIKIS_FILE)
            },
            wikis: danbooruWikis
        };
        
        fs.writeFileSync(danbooruOutputPath, JSON.stringify(danbooruOutput, null, 2), 'utf8');
        console.log(`\n💾 Saved ${danbooruWikis.length} Danbooru wikis to ${path.basename(danbooruOutputPath)}`);
    }
    
    if (e621Wikis.length > 0) {
        const e621OutputPath = path.join(OUTPUT_DIR, 'e621_missing_wikis.json');
        const e621Output = {
            _metadata: {
                generated_at: new Date().toISOString(),
                source: 'e621',
                total_wikis: e621Wikis.length,
                source_file: path.basename(MISSING_WIKIS_FILE)
            },
            wikis: e621Wikis
        };
        
        fs.writeFileSync(e621OutputPath, JSON.stringify(e621Output, null, 2), 'utf8');
        console.log(`\n💾 Saved ${e621Wikis.length} E621 wikis to ${path.basename(e621OutputPath)}`);
    }
    
    console.log('\n✅ Wiki download complete!');
    console.log(`\n📊 Summary:`);
    console.log(`   Danbooru wikis downloaded: ${danbooruWikis.length}`);
    console.log(`   E621 wikis downloaded: ${e621Wikis.length}`);
    console.log(`   Total: ${danbooruWikis.length + e621Wikis.length}`);
    
    if (danbooruWikis.length > 0 || e621Wikis.length > 0) {
        console.log(`\n   Next steps:`);
        console.log(`   1. Review the downloaded wiki files in data/`);
        console.log(`   2. Merge them into your existing datasets or load directly into the database`);
    }
}

// Run if executed directly
if (require.main === module) {
    main().catch(error => {
        console.error('\n❌ Download failed:', error);
        process.exit(1);
    });
}

module.exports = {
    main,
    fetchDanbooruWikiByTitle,
    fetchE621WikiByTitle,
    extractWikiData
};

