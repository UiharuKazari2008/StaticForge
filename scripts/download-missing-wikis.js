/**
 * Download missing wiki pages and load them into the existing tag database.
 * Does not recreate tag_wiki.db.
 *
 * Usage:
 *   node scripts/download-missing-wikis.js
 *
 * Resume: already-saved JSON rows and wikis already in the DB are skipped.
 * Progress is flushed every 20 downloads and on Ctrl+C.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const config = require('../config');

// Configuration
const MISSING_WIKIS_FILE = path.join(__dirname, '..', 'data', 'tags_missing_wikis.json');
const OUTPUT_DIR = path.join(__dirname, '..', 'data');
const DANBOORU_WIKIS_PATH = path.join(OUTPUT_DIR, 'danbooru_missing_wikis.json');
const E621_WIKIS_PATH = path.join(OUTPUT_DIR, 'e621_missing_wikis.json');
const DATABASE_PATH = path.join(__dirname, '..', '.cache', 'tag_wiki.db');
const DANBOORU_API_BASE = 'https://danbooru.donmai.us';
const E621_API_BASE = 'https://e621.net';
const SOURCE_DANBOORU = 1;
const SOURCE_E621 = 2;
const DANBOORU_ALIAS_CSV = path.join(__dirname, '..', 'data', 'dumps', 'danbooru_tag_aliases.csv');
const E621_ALIAS_CSV = path.join(__dirname, '..', 'data', 'dumps', 'e621_tag_aliases.csv');
const FETCH_CONCURRENCY = 4;
const SAVE_EVERY = 20;

// Rate limiting: wait 250ms between requests
const RATE_LIMIT_DELAY = 250;
// Retry configuration
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;

const progress = {
    danbooru: [],
    e621: []
};
let shuttingDown = false;
let progressReady = false;

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
    let normalized = decodeItemTitle(title);
    normalized = normalized.replace(/^(?:species|invalid):/i, '');
    return normalized.replace(/\s+/g, '_').trim();
}

function decodeItemTitle(title) {
    let value = String(title || '').trim();
    for (let i = 0; i < 2; i++) {
        try {
            const decoded = decodeURIComponent(value);
            if (decoded === value) break;
            value = decoded;
        } catch (_) {
            break;
        }
    }
    return value;
}

function parseCsvLine(line) {
    const fields = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (inQuotes) {
            if (char === '"') {
                if (line[i + 1] === '"') {
                    field += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                field += char;
            }
        } else if (char === '"') {
            inQuotes = true;
        } else if (char === ',') {
            fields.push(field);
            field = '';
        } else {
            field += char;
        }
    }
    fields.push(field);
    return fields;
}

function loadAliasMap(csvPath) {
    const map = new Map();
    if (!csvPath || !fs.existsSync(csvPath)) return map;
    const lines = fs.readFileSync(csvPath, 'utf8').split(/\r?\n/);
    if (!lines.length) return map;
    const headers = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
    const antecedentIdx = headers.includes('antecedent_name')
        ? headers.indexOf('antecedent_name')
        : headers.indexOf('alias');
    const consequentIdx = headers.includes('consequent_name')
        ? headers.indexOf('consequent_name')
        : headers.indexOf('tag');
    const statusIdx = headers.indexOf('status');
    if (antecedentIdx < 0 || consequentIdx < 0) return map;
    for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        const cols = parseCsvLine(lines[i]);
        const status = (cols[statusIdx] || '').toLowerCase();
        if (statusIdx >= 0 && status && status !== 'active' && status !== 't' && status !== 'true') {
            continue;
        }
        const from = (cols[antecedentIdx] || '').trim().toLowerCase();
        const to = (cols[consequentIdx] || '').trim();
        if (from && to) map.set(from, to);
    }
    console.log(`   aliases: ${map.size} from ${path.basename(csvPath)}`);
    return map;
}

function resolveAliasTitle(title, aliasMap) {
    let key = normalizeTitleForUrl(title).toLowerCase();
    if (!aliasMap || aliasMap.size === 0) return key;
    for (let i = 0; i < 5; i++) {
        const next = aliasMap.get(key);
        if (!next) break;
        const normalizedNext = String(next).replace(/\s+/g, '_').toLowerCase();
        if (normalizedNext === key) break;
        key = normalizedNext;
    }
    return key;
}

async function mapPool(items, limit, worker) {
    let cursor = 0;
    async function run() {
        while (cursor < items.length && !shuttingDown) {
            const index = cursor++;
            await worker(items[index], index);
        }
    }
    const n = Math.max(1, Math.min(limit, items.length));
    await Promise.all(Array.from({ length: n }, run));
}

function titleKey(title) {
    return normalizeTitleForUrl(title).toLowerCase();
}

function loadExistingWikis(filePath) {
    if (!fs.existsSync(filePath)) return [];
    try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (Array.isArray(data.wikis)) return data.wikis;
        if (Array.isArray(data)) return data;
        return [];
    } catch (error) {
        console.warn(`   ⚠ Could not parse ${path.basename(filePath)}: ${error.message}`);
        return [];
    }
}

function saveWikis(filePath, source, wikis) {
    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({
        _metadata: {
            generated_at: new Date().toISOString(),
            source,
            total_wikis: wikis.length,
            resumed: true,
            source_file: path.basename(MISSING_WIKIS_FILE)
        },
        wikis
    }));
    fs.renameSync(tmp, filePath);
}

function persistProgress() {
    if (!progressReady) return;
    saveWikis(DANBOORU_WIKIS_PATH, 'danbooru', progress.danbooru);
    saveWikis(E621_WIKIS_PATH, 'e621', progress.e621);
}

function loadDoneFromDb(source) {
    if (!fs.existsSync(DATABASE_PATH)) return new Set();
    const Database = require('better-sqlite3');
    const db = new Database(DATABASE_PATH, { readonly: true });
    try {
        const rows = db.prepare('SELECT title FROM wikis WHERE source = ?').all(source);
        return new Set(rows.map((row) => titleKey(row.title)));
    } catch (error) {
        console.warn(`   ⚠ Could not read existing DB wikis: ${error.message}`);
        return new Set();
    } finally {
        db.close();
    }
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
async function fetchDanbooruWikiByTitle(title, aliasMap) {
    const urlTitle = resolveAliasTitle(title, aliasMap);
    const encodedTitle = encodeURIComponent(urlTitle);
    try {
        const direct = await fetchJson(`${DANBOORU_API_BASE}/wiki_pages/${encodedTitle}.json`);
        if (direct && !Array.isArray(direct) && (direct.body || direct.title)) {
            return { wiki: direct, resolvedTitle: urlTitle };
        }

        const results = await fetchJson(`${DANBOORU_API_BASE}/wiki_pages.json?search[title]=${encodedTitle}&limit=1`);
        if (results && Array.isArray(results) && results.length > 0) {
            const exactMatch = results.find((w) => {
                if (!w.title) return false;
                const normalizedWiki = w.title.toLowerCase().replace(/\s+/g, '_');
                return normalizedWiki === urlTitle || w.title.toLowerCase() === urlTitle;
            });
            return { wiki: exactMatch || results[0], resolvedTitle: urlTitle };
        }
        const aliases = await fetchJson(`${DANBOORU_API_BASE}/tag_aliases.json?search[antecedent_name]=${encodedTitle}&limit=1`);
        const consequent = aliases && aliases[0] && aliases[0].consequent_name;
        if (consequent) {
            const aliasTitle = String(consequent).replace(/\s+/g, '_');
            const aliasWiki = await fetchJson(`${DANBOORU_API_BASE}/wiki_pages/${encodeURIComponent(aliasTitle)}.json`);
            if (aliasWiki && !Array.isArray(aliasWiki) && (aliasWiki.body || aliasWiki.title)) {
                return { wiki: aliasWiki, resolvedTitle: aliasTitle.toLowerCase() };
            }
        }
        return { wiki: null, resolvedTitle: urlTitle };
    } catch (error) {
        console.error(`   ❌ Error fetching Danbooru wiki "${title}": ${error.message}`);
        return { wiki: null, resolvedTitle: urlTitle };
    }
}

async function fetchE621WikiByTitle(title, aliasMap) {
    const urlTitle = resolveAliasTitle(title, aliasMap);
    const encodedTitle = encodeURIComponent(urlTitle);
    try {
        const direct = await fetchJson(`${E621_API_BASE}/wiki_pages/${encodedTitle}.json`);
        if (direct && !Array.isArray(direct) && (direct.body || direct.title)) {
            return { wiki: direct, resolvedTitle: urlTitle };
        }

        const results = await fetchJson(`${E621_API_BASE}/wiki_pages.json?search[title]=${encodedTitle}&limit=10`);
        if (results && Array.isArray(results) && results.length > 0) {
            const exactMatch = results.find((w) => {
                if (!w.title) return false;
                const normalizedWikiTitle = w.title.toLowerCase().replace(/\s+/g, '_');
                return normalizedWikiTitle === urlTitle || w.title.toLowerCase() === urlTitle;
            });
            return { wiki: exactMatch || results[0], resolvedTitle: urlTitle };
        }
        const aliases = await fetchJson(`${E621_API_BASE}/tag_aliases.json?search[antecedent_name]=${encodedTitle}&limit=1`);
        const consequent = aliases && aliases[0] && aliases[0].consequent_name;
        if (consequent) {
            const aliasTitle = String(consequent).replace(/\s+/g, '_');
            const aliasWiki = await fetchJson(`${E621_API_BASE}/wiki_pages/${encodeURIComponent(aliasTitle)}.json`);
            if (aliasWiki && !Array.isArray(aliasWiki) && (aliasWiki.body || aliasWiki.title)) {
                return { wiki: aliasWiki, resolvedTitle: aliasTitle.toLowerCase() };
            }
        }
        return { wiki: null, resolvedTitle: urlTitle };
    } catch (error) {
        console.error(`   ❌ Error fetching e621 wiki "${title}": ${error.message}`);
        return { wiki: null, resolvedTitle: urlTitle };
    }
}

/**
 * Extract wiki data from API response
 */
function extractWikiData(apiResult, source, requestedTitle) {
    if (!apiResult) return null;
    
    // Handle different API response formats
    // Danbooru uses 'body' field, e621 uses 'body' field
    // Both should contain raw DText
    const body = apiResult.body || apiResult.body_text || apiResult.body_html || '';
    const title = decodeItemTitle(requestedTitle || apiResult.title || apiResult.name || apiResult.other_names?.[0] || '');
    
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
 * Download remaining wikis for a source, appending to existing JSON (resume-safe).
 */
async function downloadWikisForSource(items, source, sourceName, aliasMap, existingWikis, outputPath) {
    const done = new Set(existingWikis.map((wiki) => titleKey(wiki.title)));
    const dbDone = loadDoneFromDb(source);
    for (const key of dbDone) done.add(key);

    const remaining = items.filter((item) => !done.has(titleKey(item)));
    console.log(`\n📥 Downloading ${sourceName} wikis...`);
    console.log(`   Queue: ${items.length}  saved: ${existingWikis.length}  already in DB: ${dbDone.size}  remaining: ${remaining.length}`);

    if (remaining.length === 0) {
        console.log(`   ✓ Nothing left to download for ${sourceName}`);
        return existingWikis;
    }

    let successCount = 0;
    let notFoundCount = 0;
    let errorCount = 0;
    let doneCount = 0;
    let lastSaveCount = existingWikis.length;

    await mapPool(remaining, FETCH_CONCURRENCY, async (item, index) => {
        if (shuttingDown) return;
        await sleep(RATE_LIMIT_DELAY);
        const line = `[${index + 1}/${remaining.length}]`;
        try {
            const fetched = source === SOURCE_DANBOORU
                ? await fetchDanbooruWikiByTitle(item, aliasMap)
                : await fetchE621WikiByTitle(item, aliasMap);
            const wikiData = fetched && fetched.wiki;
            const resolvedTitle = fetched && fetched.resolvedTitle;
            if (wikiData) {
                const extracted = extractWikiData(wikiData, source, item);
                if (extracted) {
                    existingWikis.push(extracted);
                    done.add(titleKey(item));
                    done.add(titleKey(extracted.title));
                    successCount++;
                    const aliasNote = resolvedTitle && normalizeTitleForUrl(item).toLowerCase() !== resolvedTitle
                        ? ` → ${resolvedTitle.replace(/_/g, ' ')}`
                        : '';
                    console.log(`   ${line} ✓ ${item}${aliasNote}`);
                    if (existingWikis.length - lastSaveCount >= SAVE_EVERY) {
                        lastSaveCount = existingWikis.length;
                        saveWikis(outputPath, sourceName.toLowerCase(), existingWikis);
                    }
                } else {
                    notFoundCount++;
                }
            } else {
                notFoundCount++;
            }
        } catch (error) {
            errorCount++;
            console.error(`   ${line} ❌ ${item}: ${error.message}`);
        }
        doneCount++;
        if (doneCount % 50 === 0 || doneCount === remaining.length) {
            console.log(`   Progress: ${successCount} downloaded, ${notFoundCount} not found, ${errorCount} errors (${doneCount}/${remaining.length})`);
        }
    });

    saveWikis(outputPath, sourceName.toLowerCase(), existingWikis);
    console.log(`\n   ✓ ${sourceName} download complete:`);
    console.log(`     - Downloaded this run: ${successCount}`);
    console.log(`     - Not found: ${notFoundCount}`);
    console.log(`     - Errors: ${errorCount}`);
    console.log(`     - Saved total: ${existingWikis.length}`);
    return existingWikis;
}

async function loadIntoExistingDb() {
    if (!fs.existsSync(DATABASE_PATH)) {
        console.log('\n⚠ No tag_wiki.db yet — JSON is saved. Create the DB, then re-run this script to load.');
        return;
    }
    console.log('\n📚 Loading downloaded wikis into the existing database...');
    await require('./load-downloaded-wikis').main();
}

/**
 * Download remaining missing wikis, then load them into the existing tag DB.
 * Does not recreate tag_wiki.db. Re-run to resume.
 *
 *   node scripts/download-missing-wikis.js
 *   node scripts/download-missing-wikis.js --load-only
 */
async function main() {
    const loadOnly = process.argv.includes('--load-only');
    console.log('🚀 Wiki download + load (does not recreate the tag database)\n');

    if (loadOnly) {
        await loadIntoExistingDb();
        return;
    }

    if (!fs.existsSync(MISSING_WIKIS_FILE)) {
        console.error(`❌ Missing wikis file not found: ${path.basename(MISSING_WIKIS_FILE)}`);
        console.error('   Run create-tag-database.js first to generate the file.');
        process.exit(1);
    }

    console.log(`📂 Loading ${path.basename(MISSING_WIKIS_FILE)}...`);
    const missingWikisData = JSON.parse(fs.readFileSync(MISSING_WIKIS_FILE, 'utf8'));
    const danbooruItems = missingWikisData.danbooru || [];
    const e621Items = missingWikisData.e621 || [];
    console.log(`   ✓ Queue: ${danbooruItems.length} Danbooru, ${e621Items.length} E621`);

    progress.danbooru = loadExistingWikis(DANBOORU_WIKIS_PATH);
    progress.e621 = loadExistingWikis(E621_WIKIS_PATH);
    progressReady = true;
    if (progress.danbooru.length || progress.e621.length) {
        console.log(`   Resume files: ${progress.danbooru.length} Danbooru, ${progress.e621.length} E621 already saved`);
    }

    const danbooruAliases = loadAliasMap(DANBOORU_ALIAS_CSV);
    const e621Aliases = loadAliasMap(E621_ALIAS_CSV);

    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    if (danbooruItems.length > 0 && !shuttingDown) {
        await downloadWikisForSource(
            danbooruItems,
            SOURCE_DANBOORU,
            'Danbooru',
            danbooruAliases,
            progress.danbooru,
            DANBOORU_WIKIS_PATH
        );
    }

    if (e621Items.length > 0 && !shuttingDown) {
        await downloadWikisForSource(
            e621Items,
            SOURCE_E621,
            'E621',
            e621Aliases,
            progress.e621,
            E621_WIKIS_PATH
        );
    }

    persistProgress();
    console.log('\n💾 Progress saved');
    console.log(`   Danbooru: ${progress.danbooru.length}  E621: ${progress.e621.length}`);

    await loadIntoExistingDb();

    if (shuttingDown) {
        console.log('\n⏸ Stopped early. Re-run to resume remaining titles.');
    } else {
        console.log('\n✅ Wiki download + load complete.');
        console.log('   Re-run this script to retry titles that were not found.');
    }
}

function requestStop() {
    if (shuttingDown) {
        persistProgress();
        process.exit(1);
    }
    shuttingDown = true;
    console.log('\n⏸ Stopping after in-flight requests — progress will be saved, then loaded into the DB.');
}

if (require.main === module) {
    process.on('SIGINT', requestStop);
    process.on('SIGTERM', requestStop);
    main().catch(error => {
        persistProgress();
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

