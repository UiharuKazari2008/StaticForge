/**
 * Import NovelAI documentation from docs.novelai.net into offline wiki cache.
 *
 * Usage:
 *   node scripts/import-novelai-docs.js --url https://docs.novelai.net/en/image/precisereference --group "Image Generation"
 *   node scripts/import-novelai-docs.js --urls-file urls.txt --group "Image Generation" --follow-links
 *
 * Options:
 *   --url (repeatable)     Page URL(s) to import
 *   --urls-file            Text file with one URL per line
 *   --group (required)     Group label for new pages in site index
 *   --follow-links         BFS crawl internal docs.novelai.net links
 *   --site novelai         Site id (default: novelai)
 *   --lang en              Default language prefix for page ids (default: en)
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { parse } = require('node-html-parser');
const config = require('../config');

const DOCS_HOST = 'docs.novelai.net';
const RATE_MS = 250;
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;

const CACHE_ROOT = path.join(__dirname, '..', '.cache', 'wiki');

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function parseArgs(argv) {
    const opts = {
        urls: [],
        urlsFile: null,
        group: null,
        followLinks: false,
        site: 'novelai',
        lang: 'en'
    };

    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--follow-links') {
            opts.followLinks = true;
        } else if (arg === '--url' && argv[i + 1]) {
            opts.urls.push(argv[++i]);
        } else if (arg === '--urls-file' && argv[i + 1]) {
            opts.urlsFile = argv[++i];
        } else if (arg === '--group' && argv[i + 1]) {
            opts.group = argv[++i];
        } else if (arg === '--site' && argv[i + 1]) {
            opts.site = argv[++i];
        } else if (arg === '--lang' && argv[i + 1]) {
            opts.lang = argv[++i];
        } else if (arg === '--help' || arg === '-h') {
            console.log(fs.readFileSync(path.join(__dirname, 'README-novelai-docs.md'), 'utf8'));
            process.exit(0);
        }
    }

    if (opts.urlsFile) {
        const lines = fs.readFileSync(path.resolve(opts.urlsFile), 'utf8')
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter((l) => l && !l.startsWith('#'));
        opts.urls.push(...lines);
    }

    return opts;
}

function fetchHtml(url, retries = 0) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const client = urlObj.protocol === 'https:' ? https : http;
        const userAgent = config.userAgent || 'StaticForge/1.0';

        const req = client.request({
            hostname: urlObj.hostname,
            port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
            path: urlObj.pathname + urlObj.search,
            method: 'GET',
            headers: {
                'User-Agent': userAgent,
                Accept: 'text/html,application/xhtml+xml'
            },
            timeout: 30000
        }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                const next = new URL(res.headers.location, url).href;
                res.resume();
                resolve(fetchHtml(next, retries));
                return;
            }
            if (res.statusCode !== 200) {
                res.resume();
                reject(new Error(`HTTP ${res.statusCode} for ${url}`));
                return;
            }
            let data = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => resolve(data));
        });

        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error(`Timeout fetching ${url}`));
        });
        req.end();
    }).catch(async (err) => {
        if (retries < MAX_RETRIES) {
            await sleep(RETRY_DELAY);
            return fetchHtml(url, retries + 1);
        }
        throw err;
    });
}

function pageIdFromUrl(url, defaultLang) {
    const u = new URL(url);
    if (u.hostname !== DOCS_HOST) {
        return null;
    }
    let p = u.pathname.replace(/^\/+|\/+$/g, '');
    if (!p) {
        p = defaultLang;
    }
    return p;
}

function isDocsUrl(url) {
    try {
        const u = new URL(url);
        return u.hostname === DOCS_HOST;
    } catch {
        return false;
    }
}

function resolveUrl(baseUrl, href) {
    try {
        return new URL(href, baseUrl).href;
    } catch {
        return null;
    }
}

function assetFileName(assetUrl) {
    const u = new URL(assetUrl);
    const base = path.basename(u.pathname) || 'asset';
    const safe = base.replace(/[^a-zA-Z0-9._-]/g, '_');
    const hash = Buffer.from(assetUrl).toString('base64url').slice(0, 8);
    const ext = path.extname(safe) || path.extname(u.pathname) || '';
    const stem = path.basename(safe, ext) || 'file';
    return `${stem}-${hash}${ext || '.bin'}`;
}

function fetchBinary(url, retries = 0) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const client = urlObj.protocol === 'https:' ? https : http;
        const req = client.get(url, {
            headers: { 'User-Agent': config.userAgent || 'StaticForge/1.0' }
        }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                const next = new URL(res.headers.location, url).href;
                res.resume();
                resolve(fetchBinary(next, retries));
                return;
            }
            if (res.statusCode !== 200) {
                res.resume();
                reject(new Error(`HTTP ${res.statusCode} for ${url}`));
                return;
            }
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => resolve(Buffer.concat(chunks)));
        });
        req.on('error', reject);
    }).catch(async (err) => {
        if (retries < MAX_RETRIES) {
            await sleep(RETRY_DELAY);
            return fetchBinary(url, retries + 1);
        }
        throw err;
    });
}

async function downloadAsset(assetUrl, assetsDir) {
    const fileName = assetFileName(assetUrl);
    const dest = path.join(assetsDir, fileName);
    if (fs.existsSync(dest)) {
        return fileName;
    }
    const binary = await fetchBinary(assetUrl);
    fs.writeFileSync(dest, binary);
    return fileName;
}

function replaceTagName(el, newTag) {
    const next = parse(`<${newTag}>${el.innerHTML}</${newTag}>`).querySelector(newTag);
    if (!next) return;
    el.replaceWith(next);
}

function normalizeWikiMarkup(html, pageTitle) {
    const root = parse(html, { blockTextElements: { script: false, style: false } });

    root.querySelectorAll('script, style, noscript').forEach((el) => el.remove());

    const firstH1 = root.querySelector('h1');
    if (firstH1) {
        const link = firstH1.querySelector('a');
        const h1Text = firstH1.text.trim();
        const linkText = link ? link.text.trim() : '';
        const h1Class = firstH1.getAttribute('class') || '';
        const linkClass = link ? (link.getAttribute('class') || '') : '';
        const isTitleAnchor = h1Class.includes('header')
            || linkClass.includes('header')
            || (pageTitle && h1Text.toLowerCase() === String(pageTitle).trim().toLowerCase())
            || (linkText && pageTitle && linkText.toLowerCase() === String(pageTitle).trim().toLowerCase());
        if (isTitleAnchor) {
            firstH1.remove();
        }
    }

    const headingMap = [
        ['h6', 'h6'],
        ['h5', 'h6'],
        ['h4', 'h5'],
        ['h3', 'h5'],
        ['h2', 'h4'],
        ['h1', 'h4']
    ];
    for (const [from, to] of headingMap) {
        root.querySelectorAll(from).forEach((el) => replaceTagName(el, to));
    }

    root.querySelectorAll('blockquote').forEach((bq) => {
        const cls = bq.getAttribute('class') || '';
        if (!cls.includes('tag-wiki-quote')) {
            bq.setAttribute('class', cls ? `${cls} tag-wiki-quote` : 'tag-wiki-quote');
        }
    });

    root.querySelectorAll('ul, ol').forEach((list) => {
        const cls = list.getAttribute('class') || '';
        if (!cls.includes('tag-wiki-list')) {
            list.setAttribute('class', cls ? `${cls} tag-wiki-list` : 'tag-wiki-list');
        }
    });

    return root.toString();
}

function processContentHtml(html, pageUrl, siteId, assetsDir, lang) {
    const root = parse(html, { blockTextElements: { script: false, style: false } });

    root.querySelectorAll('a').forEach((a) => {
        const href = a.getAttribute('href');
        if (!href) return;

        if (href.startsWith('#')) {
            a.setAttribute('class', 'tag-wiki-anchor-link');
            return;
        }

        const abs = resolveUrl(pageUrl, href);
        if (!abs) return;

        if (isDocsUrl(abs)) {
            const pageId = pageIdFromUrl(abs, lang);
            if (pageId) {
                a.setAttribute('href', '#');
                a.setAttribute('class', 'wiki-static-link');
                a.setAttribute('data-wiki-site', siteId);
                a.setAttribute('data-wiki-page', pageId);
            }
        } else {
            a.setAttribute('href', abs);
            a.setAttribute('target', '_blank');
            a.setAttribute('rel', 'noopener noreferrer');
        }
    });

    const imgNodes = root.querySelectorAll('img');
    for (const img of imgNodes) {
        const src = img.getAttribute('src');
        if (!src || src.startsWith('data:')) continue;
        const abs = resolveUrl(pageUrl, src);
        if (!abs) continue;
        try {
            const fileName = assetFileName(abs);
            const dest = path.join(assetsDir, fileName);
            if (!fs.existsSync(dest)) {
                /* downloaded in separate pass */
            }
            img.setAttribute('src', `/private/wiki/${siteId}/assets/${fileName}`);
        } catch (err) {
            console.warn('Image rewrite skip:', abs, err.message);
        }
    }

    return root.toString();
}

async function collectAndDownloadImages(html, pageUrl, assetsDir) {
    const root = parse(html);
    const urls = new Set();
    root.querySelectorAll('img').forEach((img) => {
        const src = img.getAttribute('src');
        if (!src || src.startsWith('data:')) return;
        const abs = resolveUrl(pageUrl, src);
        if (abs) urls.add(abs);
    });
    for (const assetUrl of urls) {
        await sleep(RATE_MS);
        try {
            await downloadAsset(assetUrl, assetsDir);
            console.log('  asset:', path.basename(assetFileName(assetUrl)));
        } catch (err) {
            console.warn('  asset failed:', assetUrl, err.message);
        }
    }
}

function extractContentHtml(pageHtml) {
    const doc = parse(pageHtml);
    const content = doc.querySelector('#content');
    if (!content) {
        throw new Error('Missing #content element');
    }
    const article = content.querySelector('article');
    const inner = article ? article.innerHTML : content.innerHTML;
    const root = parse(inner);
    root.querySelectorAll('main, article').forEach((el) => {
        el.replaceWith(parse(el.innerHTML));
    });
    return root.toString().trim();
}

function extractTitle(pageHtml, pageId) {
    const doc = parse(pageHtml);
    const h1 = doc.querySelector('h1');
    if (h1) {
        return h1.text.trim();
    }
    const title = doc.querySelector('title');
    if (title) {
        return title.text.trim();
    }
    const parts = pageId.split('/');
    return parts[parts.length - 1] || pageId;
}

function collectInternalLinks(html, pageUrl, lang) {
    const root = parse(html);
    const out = new Set();
    root.querySelectorAll('a[href]').forEach((a) => {
        const href = a.getAttribute('href');
        if (!href || href.startsWith('#')) return;
        const abs = resolveUrl(pageUrl, href);
        if (abs && isDocsUrl(abs)) {
            const id = pageIdFromUrl(abs, lang);
            if (id) out.add(abs);
        }
    });
    return out;
}

function readSiteIndex(siteDir) {
    const p = path.join(siteDir, 'index.json');
    return readJson(p, { pages: [] });
}

function readHomeIndex() {
    return readJson(path.join(CACHE_ROOT, 'index.json'), { sites: [] });
}

function readJson(filePath, fallback) {
    if (!fs.existsSync(filePath)) return { ...fallback };
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return { ...fallback };
    }
}

function writeJson(filePath, data) {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function upsertPage(siteIndex, entry) {
    const idx = siteIndex.pages.findIndex((p) => p.id === entry.id);
    if (idx >= 0) {
        siteIndex.pages[idx] = { ...siteIndex.pages[idx], ...entry };
    } else {
        siteIndex.pages.push(entry);
    }
    siteIndex.pages.sort((a, b) => (a.title || a.id).localeCompare(b.title || b.id));
}

async function ensureSiteIcon(siteDir, siteId) {
    const assetsDir = path.join(siteDir, 'assets');
    ensureDir(assetsDir);
    const iconPath = path.join(assetsDir, 'icon.png');
    if (fs.existsSync(iconPath)) {
        return;
    }
    const iconUrl = 'https://docs.novelai.net/assets/favicon.png';
    try {
        const binary = await fetchBinary(iconUrl);
        fs.writeFileSync(iconPath, binary);
        console.log(`  site icon: ${iconPath}`);
    } catch (err) {
        console.warn('  site icon download failed:', err.message);
    }
}

function ensureSiteRegistry(siteId, siteName) {
    const home = readHomeIndex();
    if (!home.sites) home.sites = [];
    const icon = `/private/wiki/${siteId}/assets/icon.png`;
    const existing = home.sites.find((s) => s.id === siteId);
    if (!existing) {
        home.sites.push({
            id: siteId,
            name: siteName || 'NovelAI Documentation',
            icon
        });
    } else {
        existing.name = siteName || existing.name;
        existing.icon = icon;
    }
    writeJson(path.join(CACHE_ROOT, 'index.json'), home);
}

async function importPage(url, opts, siteDir, siteIndex, visited) {
    const pageId = pageIdFromUrl(url, opts.lang);
    if (!pageId) {
        console.warn('Skip non-docs URL:', url);
        return [];
    }
    if (visited.has(pageId)) {
        return [];
    }
    visited.add(pageId);

    const pagesDir = path.join(siteDir, 'pages');
    const assetsDir = path.join(siteDir, 'assets');
    ensureDir(pagesDir);
    ensureDir(assetsDir);

    console.log(`Fetching ${url} -> ${pageId}`);
    await sleep(RATE_MS);
    const pageHtml = await fetchHtml(url);
    const rawContent = extractContentHtml(pageHtml);
    await collectAndDownloadImages(rawContent, url, assetsDir);
    let processed = processContentHtml(rawContent, url, opts.site, assetsDir, opts.lang);
    const title = extractTitle(pageHtml, pageId);
    processed = normalizeWikiMarkup(processed, title);

    const pageFile = path.join(pagesDir, `${pageId}.html`);
    ensureDir(path.dirname(pageFile));
    fs.writeFileSync(pageFile, processed, 'utf8');

    upsertPage(siteIndex, {
        id: pageId,
        title,
        group: opts.group,
        sourceUrl: url
    });

    console.log(`  saved: ${pageId} (${title})`);

    const discovered = [];
    if (opts.followLinks) {
        const links = collectInternalLinks(rawContent, url, opts.lang);
        for (const link of links) {
            discovered.push(link);
        }
    }
    return discovered;
}

async function main() {
    const opts = parseArgs(process.argv);
    if (!opts.urls.length) {
        console.error('Provide at least one --url or --urls-file');
        process.exit(1);
    }
    if (!opts.group) {
        console.error('--group is required for new pages');
        process.exit(1);
    }

    const siteDir = path.join(CACHE_ROOT, opts.site);
    ensureDir(siteDir);
    await ensureSiteIcon(siteDir, opts.site);
    ensureSiteRegistry(opts.site, 'NovelAI Documentation');

    let siteIndex = readSiteIndex(siteDir);
    if (!siteIndex.pages) siteIndex.pages = [];

    const queue = [...opts.urls];
    const visited = new Set();

    while (queue.length > 0) {
        const url = queue.shift();
        try {
            const more = await importPage(url, opts, siteDir, siteIndex, visited);
            if (opts.followLinks) {
                for (const nextUrl of more) {
                    if (!visited.has(pageIdFromUrl(nextUrl, opts.lang))) {
                        queue.push(nextUrl);
                    }
                }
            }
        } catch (err) {
            console.error(`Failed ${url}:`, err.message);
        }
    }

    writeJson(path.join(siteDir, 'index.json'), siteIndex);
    console.log(`Done. ${siteIndex.pages.length} pages in ${opts.site} index.`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
