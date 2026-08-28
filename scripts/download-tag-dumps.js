/**
 * Download official Danbooru / e621 tag and wiki CSV dumps into data/dumps/.
 *
 * Usage:
 *   node scripts/download-tag-dumps.js
 *
 * Then rebuild the tag DB:
 *   node scripts/create-tag-database.js
 *
 * Then download + load missing wiki pages (does not recreate the DB; resume-safe):
 *   node scripts/download-missing-wikis.js
 *
 * Wiki dumps are stored in full (including pages created after July 2026).
 * Tag suggestion gating happens at search time from tags.created_at.
 *
 * Danbooru official tags.csv.gz currently 404s. Fallback:
 *   Hugging Face deepghs/site_tags snapshot (synced 2025-09-25)
 *   plus Danbooru /tags.json for created_at >= 2025-09-25.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const zlib = require('zlib');
const config = require('../config');

const OUTPUT_DIR = path.join(__dirname, '..', 'data', 'dumps');
const USER_AGENT = config.userAgent || 'StaticForge/1.0 (https://staticforge.app)';
const RATE_LIMIT_DELAY = 250;
const DANBOORU_TAGS_GZ = 'https://danbooru.donmai.us/data/tags.csv.gz';
const DANBOORU_WIKI_GZ = 'https://danbooru.donmai.us/data/wiki_pages.csv.gz';
const HF_DANBOORU_TAGS = 'https://huggingface.co/datasets/deepghs/site_tags/resolve/main/danbooru.donmai.us/tags.csv';
const HF_SNAPSHOT_DATE = '2025-09-25';

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function fetchBuffer(url, options = {}) {
    const timeout = options.timeout || 300000;
    const maxRetries = options.maxRetries == null ? 5 : options.maxRetries;
    return new Promise((resolve, reject) => {
        const request = (currentUrl, redirects, retries) => {
            if (redirects > 8) {
                reject(new Error(`Too many redirects for ${url}`));
                return;
            }
            const urlObj = new URL(currentUrl);
            const req = https.get({
                hostname: urlObj.hostname,
                port: urlObj.port || 443,
                path: urlObj.pathname + urlObj.search,
                headers: {
                    'User-Agent': USER_AGENT,
                    'Accept': options.accept || '*/*'
                },
                timeout
            }, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    const next = new URL(res.headers.location, currentUrl);
                    if (next.protocol === 'http:') next.protocol = 'https:';
                    res.resume();
                    request(next.toString(), redirects + 1, retries);
                    return;
                }
                if (res.statusCode === 429 || res.statusCode === 502 || res.statusCode === 503) {
                    res.resume();
                    if (retries >= maxRetries) {
                        reject(new Error(`HTTP ${res.statusCode} for ${currentUrl}`));
                        return;
                    }
                    const retryAfter = Number(res.headers['retry-after']);
                    const wait = Number.isFinite(retryAfter) ? retryAfter * 1000 : 1500 * (retries + 1);
                    setTimeout(() => request(currentUrl, redirects, retries + 1), wait);
                    return;
                }
                if (res.statusCode !== 200) {
                    reject(new Error(`HTTP ${res.statusCode} for ${currentUrl}`));
                    res.resume();
                    return;
                }
                const chunks = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () => resolve(Buffer.concat(chunks)));
            });
            req.on('error', (error) => {
                if (retries >= maxRetries) {
                    reject(error);
                    return;
                }
                setTimeout(() => request(currentUrl, redirects, retries + 1), 1500 * (retries + 1));
            });
            req.on('timeout', () => {
                req.destroy();
                if (retries >= maxRetries) {
                    reject(new Error(`Timeout fetching ${currentUrl}`));
                    return;
                }
                setTimeout(() => request(currentUrl, redirects, retries + 1), 1500 * (retries + 1));
            });
        };
        request(url, 0, 0);
    });
}

async function fetchJson(url) {
    const body = await fetchBuffer(url, { accept: 'application/json', timeout: 60000 });
    return JSON.parse(body.toString('utf8'));
}

function maybeGunzip(buffer, gz) {
    if (!gz) return buffer;
    if (buffer[0] === 0x1f && buffer[1] === 0x8b) {
        return zlib.gunzipSync(buffer);
    }
    return buffer;
}

function csvEscape(value) {
    const s = value == null ? '' : String(value);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
}

function formatDeprecated(value) {
    if (value === true || value === 'True' || value === 'true' || value === 't' || value === '1') {
        return 'True';
    }
    if (value === false || value === 'False' || value === 'false' || value === 'f' || value === '0') {
        return 'False';
    }
    return value == null ? '' : String(value);
}

function tagToCsvLine(tag, headers) {
    return headers.map((header) => {
        if (header === 'is_deprecated') return csvEscape(formatDeprecated(tag.is_deprecated));
        if (header === 'words') {
            if (Array.isArray(tag.words)) return csvEscape(JSON.stringify(tag.words));
            return csvEscape(tag.words || '');
        }
        const value = tag[header];
        return csvEscape(value == null ? '' : value);
    }).join(',');
}

function readCsvHeader(filePath) {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(4096);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    const firstLine = buf.slice(0, n).toString('utf8').split(/\r?\n/)[0];
    return firstLine.split(',').map((h) => h.trim());
}

async function resolveE621DumpUrl(kind) {
    try {
        const listing = JSON.parse((await fetchBuffer('https://e621.net/db_exports.json', {
            accept: 'application/json',
            timeout: 30000
        })).toString('utf8'));
        const rows = Array.isArray(listing) ? listing : [];
        const row = rows.find((entry) => entry && (entry.name === kind || entry.file_name === `${kind}.csv.gz`));
        if (row && row.url) {
            console.log(`   e621 ${kind}: ${row.file_name} (${row.updated_at || 'unknown date'})`);
            return row.url;
        }
    } catch (_) {
        // fall through to HTML / CDN
    }

    try {
        const html = (await fetchBuffer('https://e621.net/db_exports', { timeout: 30000 })).toString('utf8');
        const hrefMatch = html.match(new RegExp(`https://[^"'\\s]+/${kind}\\.csv\\.gz`, 'i'));
        if (hrefMatch) {
            return hrefMatch[0];
        }
    } catch (_) {
        // fall through to CDN
    }

    return `https://static1.e621.net/data/db_export/${kind}.csv.gz`;
}

async function downloadFile(spec) {
    console.log(`⬇️  ${spec.name}`);
    console.log(`   ${spec.url}`);
    const raw = await fetchBuffer(spec.url);
    const body = maybeGunzip(raw, spec.gz);
    const outPath = path.join(OUTPUT_DIR, spec.name);
    fs.writeFileSync(outPath, body);
    const mb = (body.length / 1024 / 1024).toFixed(1);
    console.log(`   ✓ ${mb} MB → ${path.relative(path.join(__dirname, '..'), outPath)}`);
    return outPath;
}

async function appendDanbooruApiDelta(outPath, headers) {
    console.log(`   + Danbooru API delta since ${HF_SNAPSHOT_DATE}`);
    let beforeId = null;
    let added = 0;
    let pages = 0;
    const stream = fs.createWriteStream(outPath, { flags: 'a' });
    try {
        while (true) {
            const params = [
                'limit=1000',
                'search[order]=date',
                `search[created_at]=${HF_SNAPSHOT_DATE}..`,
                'only=id,name,post_count,category,created_at,updated_at,is_deprecated'
            ];
            if (beforeId) params.push(`page=b${beforeId}`);
            const url = `https://danbooru.donmai.us/tags.json?${params.join('&')}`;
            const batch = await fetchJson(url);
            if (!Array.isArray(batch) || batch.length === 0) break;
            for (const tag of batch) {
                stream.write(`${tagToCsvLine(tag, headers)}\n`);
            }
            added += batch.length;
            pages += 1;
            beforeId = batch[batch.length - 1].id;
            if (pages % 20 === 0) {
                console.log(`   … ${added} delta tags (${pages} pages)`);
            }
            if (batch.length < 1000) break;
            await sleep(RATE_LIMIT_DELAY);
        }
    } finally {
        await new Promise((resolve, reject) => {
            stream.end((error) => (error ? reject(error) : resolve()));
        });
    }
    console.log(`   ✓ API delta: ${added} tags`);
    return added;
}

async function downloadDanbooruTagsFromHuggingFaceAndApi() {
    const outPath = await downloadFile({
        name: 'danbooru_tags.csv',
        url: HF_DANBOORU_TAGS,
        gz: false
    });
    const stat = fs.statSync(outPath);
    if (stat.size > 0) {
        const tail = Buffer.alloc(1);
        const fd = fs.openSync(outPath, 'r');
        fs.readSync(fd, tail, 0, 1, stat.size - 1);
        fs.closeSync(fd);
        if (tail[0] !== 0x0a) fs.appendFileSync(outPath, '\n');
    }
    const headers = readCsvHeader(outPath);
    await appendDanbooruApiDelta(outPath, headers);
}

async function downloadDanbooruTags() {
    try {
        await downloadFile({
            name: 'danbooru_tags.csv',
            url: DANBOORU_TAGS_GZ,
            gz: true
        });
    } catch (error) {
        console.warn(`   official dump skipped: ${error.message}`);
        console.log('   falling back to Hugging Face snapshot + API delta');
        await downloadDanbooruTagsFromHuggingFaceAndApi();
    }
}

async function main() {
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    await downloadDanbooruTags();
    await sleep(RATE_LIMIT_DELAY);

    try {
        await downloadFile({
            name: 'danbooru_wiki_pages.csv',
            url: DANBOORU_WIKI_GZ,
            gz: true
        });
    } catch (error) {
        console.warn(`   skipped: ${error.message}`);
    }
    await sleep(RATE_LIMIT_DELAY);

    try {
        await downloadFile({
            name: 'danbooru_tag_aliases.csv',
            url: 'https://huggingface.co/datasets/deepghs/site_tags/resolve/main/danbooru.donmai.us/tag_aliases.csv',
            gz: false
        });
    } catch (error) {
        console.warn(`   danbooru aliases skipped: ${error.message}`);
    }
    await sleep(RATE_LIMIT_DELAY);

    for (const kind of ['tags', 'wiki_pages', 'tag_aliases']) {
        const url = await resolveE621DumpUrl(kind);
        await downloadFile({
            name: `e621_${kind}.csv`,
            url,
            gz: true
        });
        await sleep(RATE_LIMIT_DELAY);
    }

    console.log('\n✅ Dumps saved to data/dumps/');
    console.log('   Next: node scripts/rebuild-tag-database.js');
    console.log('   Missing wikis (does not recreate DB): node scripts/download-missing-wikis.js');
}

if (require.main === module) {
    main().catch((error) => {
        console.error('❌ Dump download failed:', error.message);
        process.exit(1);
    });
}

module.exports = { main };
