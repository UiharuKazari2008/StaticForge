/**
 * Fandom / generic MediaWiki offline cache: api.php import, local image mirroring,
 * and an import/page relationship graph for cascade delete.
 * Generic (non-Fandom) sites are kind `mediawiki` and must expose /api.php.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parse } = require('node-html-parser');
const { NodeHtmlMarkdown } = require('node-html-markdown');
const Database = require('better-sqlite3');
const { browserRequest } = require('./browserHttp');

const RATE_MS = 350;
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;
const DEFAULT_MAX_FOLLOW = 25;
const HARD_MAX_FOLLOW = 80;
const FANDOM_IMAGE_HOST_RE = /(?:static|vignette)\.wikia\.nocookie\.net|(?:^|\.)fandom\.com/i;
const SKIP_TITLE_RE = /^(?:File|Image|Special|Template|Module|Category|User|Talk|Help|MediaWiki|Forum|Thread|Message_Wall|User_blog):/i;
const FANDOM_LANG_PATH_RE = /^\/([a-z]{2}(?:-[a-z]{2,4})?)\/wiki\//i;
const MEDIAWIKI_HARD_MAX_FOLLOW = 25;
const MEDIAWIKI_DEFAULT_MAX_FOLLOW = 25;
const MEDIAWIKI_PROBE_TIMEOUT_MS = 8000;
const WMF_HOST_RE = /(?:^|\.)(?:wikipedia|wikimedia|wiktionary|wikibooks|wikiquote|wikisource|wikinews|wikiversity|wikivoyage|mediawiki)\.org$/i;
const MIRAHEZE_HOST_RE = /(?:^|\.)miraheze\.org$/i;
const MEDIAWIKI_SKIP_TITLE_RE = /^(?:Wikipedia|Portal|Draft|TimedText|Project):/i;
const REMOTE_IMG_RE = /^https?:\/\//i;

const nhm = new NodeHtmlMarkdown({
    codeBlockStyle: 'fenced',
    tables: true,
    useLinkReferenceDefinitions: false
});

let graphDb = null;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function getWikiBasePath(globalResources) {
    if (globalResources && typeof globalResources.getPath === 'function') {
        return path.join(globalResources.getPath('cache'), 'wiki');
    }
    return path.join(__dirname, '..', '.cache', 'wiki');
}

function getGraphDbPath(globalResources) {
    return path.join(getWikiBasePath(globalResources), 'fandom-graph.db');
}

function readJsonSafe(filePath, fallback) {
    try {
        if (!fs.existsSync(filePath)) return fallback;
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (err) {
        console.warn('[fandomWiki] readJsonSafe:', filePath, err.message);
        return fallback;
    }
}

function writeJson(filePath, data) {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function sanitizeWikiId(raw) {
    const id = String(raw || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
    return id || null;
}

function sanitizePageId(raw) {
    let id = String(raw || '').trim();
    try { id = decodeURIComponent(id); } catch (_) { /* keep */ }
    id = id.replace(/\\/g, '/').replace(/\.\./g, '').replace(/^\/+|\/+$/g, '');
    id = id.replace(/ /g, '_');
    if (!id || id.includes('\0')) return null;
    return id;
}

function encodeWikiPath(pageId) {
    return String(pageId || '').split('/').filter(Boolean).map((part) => encodeURIComponent(part)).join('/');
}

function fandomPageUrl(host, pageId, lang) {
    const pathId = encodeWikiPath(pageId);
    if (!pathId) return `https://${host}/`;
    if (lang) return `https://${host}/${lang}/wiki/${pathId}`;
    return `https://${host}/wiki/${pathId}`;
}

function mediaWikiPageUrl(origin, articlepath, pageId) {
    const pathId = encodeWikiPath(pageId);
    const originBase = String(origin || '').replace(/\/$/, '');
    const tpl = String(articlepath || '/wiki/$1');
    if (!pathId) return `${originBase}/`;
    if (tpl.includes('$1')) {
        const pathPart = tpl.replace('$1', pathId);
        if (/^https?:\/\//i.test(pathPart)) return pathPart;
        return `${originBase}${pathPart.startsWith('/') ? pathPart : `/${pathPart}`}`;
    }
    return `${originBase}/wiki/${pathId}`;
}

function pageSourceUrl(parsed, pageId) {
    const id = pageId || (parsed && parsed.pageId);
    if (parsed && parsed.kind === 'mediawiki') {
        return mediaWikiPageUrl(parsed.origin, parsed.articlepath, id);
    }
    return fandomPageUrl(parsed.host, id, parsed && parsed.lang);
}

function isNovelAiHost(host) {
    const h = String(host || '').toLowerCase();
    return h === 'docs.novelai.net' || h === 'journal.novelai.net'
        || h === 'blog.novelai.net' || h === 'novelai.medium.com';
}

function isRemoteAssetUrl(abs) {
    if (!abs) return false;
    if (FANDOM_IMAGE_HOST_RE.test(abs)) return true;
    try {
        const u = new URL(abs);
        if (/(?:^|\.)wikimedia\.org$/i.test(u.hostname)) return true;
        if (/\/(?:images|commons)\//i.test(u.pathname)) return true;
        if (/Special:FilePath|Special:Redirect\/file/i.test(u.pathname)) return true;
        if (/\.(?:png|jpe?g|gif|webp|svg|ico)(?:\?|$)/i.test(u.pathname)) return true;
    } catch {
        return /\/(?:images|commons)\//i.test(abs);
    }
    return false;
}

function absoluteHttpUrl(raw, origin) {
    const s = String(raw || '').trim();
    if (!s) return '';
    if (s.startsWith('//')) return `https:${s}`;
    if (/^https?:\/\//i.test(s)) return s;
    if (s.startsWith('/') && origin) return `${String(origin).replace(/\/$/, '')}${s}`;
    return s;
}

function extractPageIdFromArticlePath(u, articlepath) {
    if (!u) return null;
    const titleParam = u.searchParams && u.searchParams.get('title');
    if (titleParam) return sanitizePageId(titleParam);
    const tpl = String(articlepath || '/wiki/$1');
    const marker = tpl.includes('$1') ? tpl.replace('$1', '') : '/wiki/';
    const pathName = u.pathname || '';
    if (marker && marker !== '/' && pathName.toLowerCase().startsWith(marker.toLowerCase())) {
        return sanitizePageId(pathName.slice(marker.length));
    }
    if (marker === '/' && pathName.length > 1 && !/\/index\.php$/i.test(pathName)) {
        return sanitizePageId(pathName.slice(1));
    }
    const wikiIdx = pathName.toLowerCase().indexOf('/wiki/');
    if (wikiIdx >= 0) return sanitizePageId(pathName.slice(wikiIdx + 6));
    const last = pathName.split('/').filter(Boolean).pop();
    if (last && !/^index\.php$/i.test(last) && !/^api\.php$/i.test(last)) {
        return sanitizePageId(last);
    }
    return null;
}

function apiCandidates(u) {
    const origin = u.origin;
    const pathname = u.pathname || '/';
    const out = [];
    const add = (p) => {
        const href = /^https?:\/\//i.test(p) ? p : `${origin}${p.startsWith('/') ? p : `/${p}`}`;
        if (href && !out.includes(href)) out.push(href);
    };
    if (/\/api\.php$/i.test(pathname)) {
        add(pathname);
        return out.slice(0, 4);
    }
    const prefixWiki = pathname.match(/^(.*?)\/wiki\//i);
    const prefixW = pathname.match(/^(\/[^/]+)?\/w\//i);
    if (WMF_HOST_RE.test(u.hostname) || MIRAHEZE_HOST_RE.test(u.hostname)) {
        add('/w/api.php');
        add('/api.php');
        return out.slice(0, 4);
    }
    if (prefixW) add(`${prefixW[1] || ''}/w/api.php`);
    if (prefixWiki && prefixWiki[1]) {
        add(`${prefixWiki[1]}/api.php`);
        add(`${prefixWiki[1]}/w/api.php`);
    }
    add('/w/api.php');
    add('/api.php');
    add('/wiki/api.php');
    return out.slice(0, 4);
}

function parseJsonBody(body) {
    if (body && typeof body === 'object' && !Buffer.isBuffer(body) && !(body instanceof Uint8Array)) {
        return body;
    }
    let text = Buffer.isBuffer(body) ? body.toString('utf8') : String(body == null ? '' : body);
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    return JSON.parse(text);
}

function retryDelayMs(res, retries) {
    const headers = (res && res.headers) || {};
    const raw = headers['retry-after'] || headers['Retry-After'];
    const ra = parseInt(raw, 10);
    if (Number.isFinite(ra) && ra >= 0) return Math.min(Math.max(ra, 1) * 1000, 30000);
    return Math.min(RETRY_DELAY * (2 ** retries), 15000);
}

function isRetryableStatus(code) {
    return code === 429 || code === 503 || code === 502;
}

function assetPathKey(assetUrl) {
    try {
        const u = new URL(assetUrl);
        const parts = u.pathname.split('/').filter(Boolean);
        const revIdx = parts.findIndex((p) => p === 'revision');
        return revIdx > 0 ? parts.slice(0, revIdx).join('/') : u.pathname;
    } catch {
        return null;
    }
}

function fandomDisplayUrl(siteId, pageId) {
    if (!siteId) return 'rdf://wiki.fandom.jp/';
    if (!pageId) return `rdf://wiki.fandom.jp/${siteId}`;
    return `rdf://wiki.fandom.jp/${siteId}/${pageId}`;
}

function openGraph(globalResources) {
    if (graphDb) return graphDb;
    const dbPath = getGraphDbPath(globalResources);
    ensureDir(path.dirname(dbPath));
    graphDb = new Database(dbPath);
    graphDb.pragma('journal_mode = WAL');
    graphDb.exec(`
        CREATE TABLE IF NOT EXISTS pages (
            wiki_id TEXT NOT NULL,
            page_id TEXT NOT NULL,
            title TEXT NOT NULL,
            source_url TEXT,
            origin TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT,
            PRIMARY KEY (wiki_id, page_id)
        );
        CREATE TABLE IF NOT EXISTS imports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            wiki_id TEXT NOT NULL,
            root_page_id TEXT NOT NULL,
            source_url TEXT NOT NULL,
            group_name TEXT,
            follow_links INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS import_pages (
            import_id INTEGER NOT NULL,
            wiki_id TEXT NOT NULL,
            page_id TEXT NOT NULL,
            role TEXT NOT NULL,
            PRIMARY KEY (import_id, wiki_id, page_id),
            FOREIGN KEY (import_id) REFERENCES imports(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS page_links (
            from_wiki_id TEXT NOT NULL,
            from_page_id TEXT NOT NULL,
            to_wiki_id TEXT NOT NULL,
            to_page_id TEXT NOT NULL,
            PRIMARY KEY (from_wiki_id, from_page_id, to_wiki_id, to_page_id)
        );
        CREATE INDEX IF NOT EXISTS idx_import_pages_page ON import_pages(wiki_id, page_id);
        CREATE INDEX IF NOT EXISTS idx_imports_root ON imports(wiki_id, root_page_id);
    `);
    return graphDb;
}

function parseFandomUrl(raw) {
    const text = String(raw || '').trim();
    if (!text) return null;
    let u;
    try {
        u = new URL(text.includes('://') ? text : `https://${text}`);
    } catch {
        return null;
    }
    const host = u.hostname.toLowerCase();
    const m = host.match(/^([a-z0-9-]+)\.fandom\.com$/i);
    if (!m) return null;
    const subdomain = sanitizeWikiId(m[1]);
    if (!subdomain) return null;
    const langMatch = FANDOM_LANG_PATH_RE.exec(u.pathname);
    const lang = langMatch ? langMatch[1].toLowerCase() : null;
    let pageId = '';
    const wikiIdx = u.pathname.toLowerCase().indexOf('/wiki/');
    if (wikiIdx >= 0) {
        pageId = sanitizePageId(u.pathname.slice(wikiIdx + 6));
    } else {
        pageId = sanitizePageId(u.pathname);
    }
    if (!pageId) return null;
    const wikiId = lang ? sanitizeWikiId(`${subdomain}-${lang}`) : subdomain;
    const fandomHost = `${subdomain}.fandom.com`;
    return {
        wikiId,
        pageId,
        lang,
        subdomain,
        fandomHost,
        host: fandomHost,
        sourceUrl: fandomPageUrl(fandomHost, pageId, lang),
        apiBase: lang ? `https://${fandomHost}/${lang}/api.php` : `https://${fandomHost}/api.php`
    };
}

async function fetchJsonProbe(url, host, retries = 0) {
    try {
        const res = await browserRequest(url, null, {
            acceptResType: 'json',
            timeoutMs: MEDIAWIKI_PROBE_TIMEOUT_MS,
            extra: {
                origin: `https://${host}`,
                referer: `https://${host}/`
            }
        });
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && retries < 2) {
            return fetchJsonProbe(new URL(res.headers.location, url).href, host, retries + 1);
        }
        if (isRetryableStatus(res.statusCode) && retries < 1) {
            await sleep(retryDelayMs(res, retries));
            return fetchJsonProbe(url, host, retries + 1);
        }
        if (res.statusCode !== 200) {
            const err = new Error(`HTTP ${res.statusCode} for ${url}`);
            err.statusCode = res.statusCode;
            throw err;
        }
        const data = parseJsonBody(res.body);
        if (!data || typeof data !== 'object') throw new Error('Not JSON');
        return data;
    } catch (err) {
        const msg = String(err && err.message || '');
        if (/HTTP 40[034]|HTTP 410|Not JSON|timeout/i.test(msg)) throw err;
        if (retries < 1) {
            await sleep(retryDelayMs(null, retries));
            return fetchJsonProbe(url, host, retries + 1);
        }
        throw err;
    }
}

async function fetchJson(url, host, retries = 0) {
    try {
        const res = await browserRequest(url, null, {
            acceptResType: 'json',
            timeoutMs: 45000,
            extra: {
                origin: `https://${host}`,
                referer: `https://${host}/`
            }
        });
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            return fetchJson(new URL(res.headers.location, url).href, host, retries);
        }
        if (isRetryableStatus(res.statusCode) && retries < MAX_RETRIES) {
            await sleep(retryDelayMs(res, retries));
            return fetchJson(url, host, retries + 1);
        }
        if (res.statusCode !== 200) {
            throw new Error(`HTTP ${res.statusCode} for ${url}`);
        }
        return parseJsonBody(res.body);
    } catch (err) {
        const msg = String(err && err.message || '');
        if (/HTTP 404|HTTP 410/.test(msg)) throw err;
        if (retries < MAX_RETRIES) {
            await sleep(retryDelayMs(null, retries));
            return fetchJson(url, host, retries + 1);
        }
        throw err;
    }
}

async function fetchBinary(url, host, retries = 0) {
    try {
        const res = await browserRequest(url, null, {
            acceptResType: 'image',
            timeoutMs: 45000,
            extra: {
                origin: `https://${host}`,
                referer: `https://${host}/`
            }
        });
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            return fetchBinary(new URL(res.headers.location, url).href, host, retries);
        }
        if (res.statusCode === 404 || res.statusCode === 410) {
            throw new Error(`HTTP ${res.statusCode} for ${url}`);
        }
        if (isRetryableStatus(res.statusCode) && retries < MAX_RETRIES) {
            await sleep(retryDelayMs(res, retries));
            return fetchBinary(url, host, retries + 1);
        }
        if (res.statusCode !== 200) {
            throw new Error(`HTTP ${res.statusCode} for ${url}`);
        }
        return res.body;
    } catch (err) {
        const msg = String(err && err.message || '');
        if (/HTTP 404|HTTP 410/.test(msg)) throw err;
        if (retries < MAX_RETRIES) {
            await sleep(retryDelayMs(null, retries));
            return fetchBinary(url, host, retries + 1);
        }
        throw err;
    }
}

function apiUrl(apiBase, params) {
    const u = new URL(apiBase);
    Object.entries(params).forEach(([k, v]) => {
        if (v != null && v !== '') u.searchParams.set(k, String(v));
    });
    return u.href;
}

function siteInfoFromGeneral(general, parsed) {
    const g = general || {};
    return {
        name: g.sitename || (parsed && parsed.wikiId ? `${parsed.wikiId} Wiki` : (parsed && parsed.host) || 'Wiki'),
        logo: g.logo || null,
        articlepath: g.articlepath || '/wiki/$1',
        scriptpath: g.scriptpath || '',
        server: g.server || '',
        lang: g.lang || null,
        generator: g.generator || '',
        mainpage: g.mainpage || 'Main Page',
        wikiid: g.wikiid || null,
        base: g.base || null
    };
}

function isMediaWikiSiteInfo(info) {
    if (!info) return false;
    if (/mediawiki/i.test(String(info.generator || ''))) return true;
    return !!(info.articlepath && info.name);
}

async function probeSiteInfo(apiBase, host) {
    const data = await fetchJsonProbe(apiUrl(apiBase, {
        action: 'query',
        format: 'json',
        meta: 'siteinfo',
        siprop: 'general'
    }), host);
    const general = data && data.query && data.query.general;
    if (!general) return null;
    const info = siteInfoFromGeneral(general, { host, wikiId: host });
    if (!isMediaWikiSiteInfo(info)) return null;
    return info;
}

async function fetchSiteInfo(parsed) {
    if (parsed && parsed.siteInfo) return parsed.siteInfo;
    const data = await fetchJson(apiUrl(parsed.apiBase, {
        action: 'query',
        format: 'json',
        meta: 'siteinfo',
        siprop: 'general'
    }), parsed.host);
    const general = data?.query?.general || {};
    return siteInfoFromGeneral(general, parsed);
}

async function detectMediaWikiSite(raw) {
    const text = String(raw || '').trim();
    if (!text) {
        throw new Error('URL must be a *.fandom.com/wiki/… page or a MediaWiki site that exposes /api.php');
    }
    let u;
    try {
        u = new URL(text.includes('://') ? text : `https://${text}`);
    } catch {
        throw new Error('URL must be a *.fandom.com/wiki/… page or a MediaWiki site that exposes /api.php');
    }
    if (!/^https?:$/i.test(u.protocol)) {
        throw new Error('Wiki URL must be http(s)');
    }
    const host = u.hostname.toLowerCase();
    if (/\.fandom\.com$/i.test(host) || host === 'fandom.com') {
        return null;
    }
    if (isNovelAiHost(host)) {
        throw new Error('NovelAI URLs use import_static_wiki, not MediaWiki api.php');
    }

    const candidates = apiCandidates(u);
    const results = await Promise.all(candidates.map(async (cand) => {
        try {
            const info = await probeSiteInfo(cand, host);
            return info ? { cand, info } : null;
        } catch {
            return null;
        }
    }));
    const hit = results.find(Boolean);
    if (!hit) {
        throw new Error(
            `Not a MediaWiki site (no working /api.php). Tried: ${candidates.join(', ')}. `
            + 'Only *.fandom.com, NovelAI docs/journal/blog, and MediaWiki wikis that expose api.php can be imported.'
        );
    }

    const origin = `${u.protocol}//${u.host}`;
    let pageId = extractPageIdFromArticlePath(u, hit.info.articlepath);
    if (!pageId) {
        pageId = sanitizePageId(String(hit.info.mainpage || 'Main Page'));
    }
    if (!pageId) {
        throw new Error('Could not determine wiki page title from URL');
    }
    const wikiId = sanitizeWikiId(host.replace(/\./g, '-'));
    if (!wikiId) throw new Error('Could not derive wiki id from host');
    return {
        kind: 'mediawiki',
        wikiId,
        pageId,
        lang: hit.info.lang || null,
        host,
        origin,
        fandomHost: null,
        sourceUrl: mediaWikiPageUrl(origin, hit.info.articlepath, pageId),
        apiBase: hit.cand,
        articlepath: hit.info.articlepath,
        scriptpath: hit.info.scriptpath,
        siteInfo: hit.info
    };
}

function parseMediaWikiArticleUrl(abs, ctx) {
    if (!ctx || ctx.kind !== 'mediawiki' || !ctx.origin) return null;
    let u;
    try { u = new URL(abs); } catch { return null; }
    let ctxHost;
    try { ctxHost = new URL(ctx.origin).hostname.toLowerCase(); } catch { return null; }
    if (u.hostname.toLowerCase() !== ctxHost) return null;
    const pageId = extractPageIdFromArticlePath(u, ctx.articlepath || '/wiki/$1');
    if (!pageId || SKIP_TITLE_RE.test(pageId) || MEDIAWIKI_SKIP_TITLE_RE.test(pageId)) return null;
    return { wikiId: ctx.wikiId, pageId };
}

async function fetchImageInfoUrls(parsed, fileNames) {
    const names = (fileNames || []).filter(Boolean).slice(0, 80);
    if (!names.length || !parsed || !parsed.apiBase) return [];
    const urls = [];
    for (let i = 0; i < names.length; i += 40) {
        const batch = names.slice(i, i + 40).map((n) => (/^File:/i.test(n) ? n : `File:${n}`));
        await sleep(RATE_MS);
        try {
            const data = await fetchJson(apiUrl(parsed.apiBase, {
                action: 'query',
                format: 'json',
                titles: batch.join('|'),
                prop: 'imageinfo',
                iiprop: 'url',
                iiurlwidth: 1280
            }), parsed.host);
            const pages = (data && data.query && data.query.pages) || {};
            for (const p of Object.values(pages)) {
                const ii = p.imageinfo && p.imageinfo[0];
                const url = (ii && (ii.thumburl || ii.url)) || null;
                if (url) urls.push(url);
            }
        } catch (err) {
            console.warn('[fandomWiki] imageinfo failed:', err.message);
        }
    }
    return urls;
}

async function fetchParsedPage(parsed) {
    const data = await fetchJson(apiUrl(parsed.apiBase, {
        action: 'parse',
        format: 'json',
        utf8: 1,
        page: parsed.pageId.replace(/_/g, ' '),
        prop: 'text|displaytitle|images|links|categories|revid',
        disablelimitreport: 1,
        disableeditsection: 1,
        redirects: 1
    }), parsed.host);
    if (data.error) {
        throw new Error(data.error.info || data.error.code || 'MediaWiki parse failed');
    }
    const p = data.parse || {};
    const html = (p.text && (p.text['*'] || p.text)) || '';
    if (!html || typeof html !== 'string') throw new Error(`Empty parse for ${parsed.pageId}`);
    const canonicalId = sanitizePageId(String(p.title || parsed.pageId).replace(/<[^>]+>/g, '')) || parsed.pageId;
    const title = String(p.displaytitle || p.title || parsed.pageId)
        .replace(/<[^>]+>/g, '')
        .trim();
    const links = (p.links || [])
        .filter((l) => (l.ns === 0 || l.ns === '0') && (l['*'] || l.title))
        .map((l) => sanitizePageId(l['*'] || l.title))
        .filter(Boolean);
    const redirects = Array.isArray(p.redirects) ? p.redirects : [];
    return { html, title, links, images: p.images || [], canonicalId, redirects };
}

function resolveUrl(baseUrl, href) {
    try {
        return new URL(href, baseUrl).href;
    } catch {
        return null;
    }
}

function assetFileName(assetUrl) {
    let u;
    try {
        u = new URL(assetUrl);
    } catch {
        return `asset-${crypto.createHash('sha1').update(String(assetUrl)).digest('hex').slice(0, 10)}.bin`;
    }
    const parts = u.pathname.split('/').filter(Boolean);
    const revIdx = parts.findIndex((p) => p === 'revision');
    const rawName = (revIdx > 0 ? parts[revIdx - 1] : parts[parts.length - 1]) || 'asset';
    const safe = rawName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const hash = crypto.createHash('sha1').update(assetUrl).digest('hex').slice(0, 10);
    const ext = path.extname(safe) || '';
    const stem = (ext ? safe.slice(0, -ext.length) : safe) || 'file';
    return `${stem}-${hash}${ext || '.bin'}`;
}

function sniffImageExt(buf, fallbackExt) {
    const fb = fallbackExt && /^\.[a-z0-9]+$/i.test(fallbackExt) ? fallbackExt.toLowerCase() : '.bin';
    if (!Buffer.isBuffer(buf) || buf.length < 12) return fb;
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return '.png';
    if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return '.jpg';
    if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return '.gif';
    if (buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01 && buf[3] === 0x00) return '.ico';
    if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return '.webp';
    const head = buf.slice(0, Math.min(buf.length, 512)).toString('utf8');
    if (/<svg[\s>]/i.test(head)) return '.svg';
    return fb;
}

function withSniffedExt(fileName, buf) {
    const current = path.extname(fileName);
    const sniffed = sniffImageExt(buf, current);
    if (!current) return `${fileName}${sniffed}`;
    if (sniffed === current.toLowerCase()) return fileName;
    return `${fileName.slice(0, -current.length)}${sniffed}`;
}

function resolveAssetDest(assetsDir, fileName) {
    const dest = path.join(assetsDir, fileName);
    if (fs.existsSync(dest)) return { fileName, dest };
    const ext = path.extname(fileName);
    const stem = ext ? fileName.slice(0, -ext.length) : fileName;
    try {
        const match = fs.readdirSync(assetsDir).find((f) => f === stem || f.startsWith(`${stem}.`));
        if (match) return { fileName: match, dest: path.join(assetsDir, match) };
    } catch (_) { /* ignore */ }
    return { fileName, dest };
}

function collectImageUrls(html, pageUrl) {
    const root = parse(html);
    const urls = new Set();
    const add = (raw) => {
        if (!raw || raw.startsWith('data:')) return;
        // data-image-key is a filename, not a URL
        if (!/^[a-z][a-z0-9+.-]*:/i.test(raw) && !raw.startsWith('/') && !raw.startsWith('.') && !raw.includes('/')) return;
        const abs = resolveUrl(pageUrl, raw);
        if (!abs || !/^https?:\/\//i.test(abs)) return;
        try {
            const u = new URL(abs);
            const pathName = u.pathname || '';
            const isCdn = /(?:static|vignette)\.wikia\.nocookie\.net$/i.test(u.hostname)
                || /(?:^|\.)(?:wikimedia|wikipedia|wiktionary)\.org$/i.test(u.hostname)
                || /\/(?:images|commons|static)\//i.test(pathName)
                || /Special:FilePath|Special:Redirect\/file/i.test(pathName);
            const isWikiArticle = /\/wiki\//i.test(pathName) && !isCdn;
            if (isWikiArticle) return;
            if (!isCdn && !/\.(png|jpe?g|gif|webp|svg|ico)(\?|$)/i.test(pathName)) return;
        } catch {
            return;
        }
        urls.add(abs);
    };
    root.querySelectorAll('img').forEach((img) => {
        ['src', 'data-src', 'data-original', 'data-image-key'].forEach((attr) => add(img.getAttribute(attr)));
        const srcset = img.getAttribute('srcset') || img.getAttribute('data-srcset') || '';
        srcset.split(',').forEach((part) => add(part.trim().split(/\s+/)[0]));
    });
    root.querySelectorAll('source').forEach((el) => {
        const srcset = el.getAttribute('srcset') || '';
        srcset.split(',').forEach((part) => add(part.trim().split(/\s+/)[0]));
    });
    root.querySelectorAll('[style]').forEach((el) => {
        const style = el.getAttribute('style') || '';
        for (const m of style.matchAll(/url\(\s*['"]?([^'")\s]+)['"]?\s*\)/gi)) {
            add(m[1]);
        }
    });
    root.querySelectorAll('.pi-image img, .portable-infobox img, .infobox img, figure img').forEach((img) => {
        ['src', 'data-src', 'data-original'].forEach((attr) => add(img.getAttribute(attr)));
    });
    const byFile = new Map();
    for (const url of urls) {
        let u;
        try { u = new URL(url); } catch { continue; }
        const parts = u.pathname.split('/').filter(Boolean);
        const revIdx = parts.findIndex((p) => p === 'revision');
        const key = revIdx > 0 ? parts.slice(0, revIdx).join('/') : u.pathname;
        const scale = /scale-to-width-down\/(\d+)/.exec(u.pathname);
        const width = scale ? Number(scale[1]) : 99999;
        const prev = byFile.get(key);
        if (!prev || width > prev.width) byFile.set(key, { url, width });
    }
    return [...byFile.values()].map((v) => v.url);
}

function stripFandomChrome(html) {
    const root = parse(html, { blockTextElements: { script: false, style: false } });
    root.querySelectorAll('script, style, noscript, iframe, link, meta').forEach((el) => el.remove());
    const dropSelectors = [
        '.navbox', '.navbox-styles', '.custom-tabs', '.custom-tabs-default',
        '.fl-wrapper', '.mw-editsection', '.toc', '#toc',
        '.printfooter', '.mw-normal-catlinks', '.catlinks',
        '.page-header', '.page-footer', '.wds-community-header',
        '.global-navigation', '.notifications-placeholder',
        '.rail-module', '#WikiaRail', '.mcf-card',
        '.mw-empty-elt'
    ];
    dropSelectors.forEach((sel) => {
        root.querySelectorAll(sel).forEach((el) => el.remove());
    });
    return root.toString();
}

function rewriteContent(html, pageUrl, siteId, pageMap, linkCtx) {
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
        let parsed;
        try {
            parsed = parseFandomUrl(abs);
        } catch {
            parsed = null;
        }
        const mwParsed = (!parsed && linkCtx) ? parseMediaWikiArticleUrl(abs, linkCtx) : null;
        const article = (parsed && parsed.pageId && !SKIP_TITLE_RE.test(parsed.pageId))
            ? parsed
            : mwParsed;
        if (article && article.pageId) {
            a.setAttribute('href', '#');
            a.setAttribute('class', 'wiki-static-link');
            a.setAttribute('data-wiki-site', article.wikiId);
            a.setAttribute('data-wiki-page', article.pageId);
            if (pageMap && article.wikiId === siteId) pageMap.add(article.pageId);
        } else if (FANDOM_IMAGE_HOST_RE.test(abs) || isRemoteAssetUrl(abs)) {
            const img = a.querySelector('img');
            const local = img && img.getAttribute('data-local-src');
            if (local) {
                a.setAttribute('href', local);
                a.removeAttribute('target');
                a.removeAttribute('rel');
                a.setAttribute('class', 'wiki-static-asset-link');
            } else {
                a.setAttribute('href', '#');
                a.removeAttribute('target');
                a.setAttribute('class', 'wiki-static-asset-link');
            }
        } else {
            a.setAttribute('href', abs);
            a.setAttribute('target', '_blank');
            a.setAttribute('rel', 'noopener noreferrer');
            a.setAttribute('class', 'tag-wiki-external-link');
        }
    });

    root.querySelectorAll('img').forEach((img) => {
        const local = img.getAttribute('data-local-src');
        if (local) {
            img.setAttribute('src', local);
        }
        img.removeAttribute('srcset');
        img.removeAttribute('data-src');
        img.removeAttribute('data-srcset');
        img.removeAttribute('data-original');
        img.removeAttribute('data-image-key');
        img.removeAttribute('srcset');
        const cls = (img.getAttribute('class') || '').replace(/\blazyload\b/g, '').trim();
        if (cls) img.setAttribute('class', cls);
        else img.removeAttribute('class');
        img.removeAttribute('loading');
    });

    root.querySelectorAll('source').forEach((el) => el.remove());

    root.querySelectorAll('[style]').forEach((el) => {
        const style = el.getAttribute('style') || '';
        if (/url\(\s*['"]?https?:/i.test(style) && (FANDOM_IMAGE_HOST_RE.test(style) || isRemoteAssetUrl(style))) {
            el.setAttribute('style', style.replace(/url\(\s*['"]?https?:[^)]+\)/gi, ''));
        }
    });

    return root.toString();
}

function assertNoHotlinks(html, opts) {
    const stripRemote = !!(opts && opts.stripRemote);
    const leftover = [];
    const root = parse(html);
    root.querySelectorAll('img').forEach((img) => {
        ['src', 'srcset', 'data-src', 'data-srcset'].forEach((attr) => {
            const v = img.getAttribute(attr);
            if (v && FANDOM_IMAGE_HOST_RE.test(v)) leftover.push(v);
        });
    });
    leftover.forEach((url) => {
        root.querySelectorAll('img').forEach((img) => {
            ['src', 'srcset', 'data-src', 'data-srcset'].forEach((attr) => {
                const v = img.getAttribute(attr) || '';
                if (v.includes(url) || FANDOM_IMAGE_HOST_RE.test(v)) {
                    img.removeAttribute(attr);
                }
            });
            if (!img.getAttribute('src')) img.remove();
        });
    });
    if (stripRemote) {
        root.querySelectorAll('img').forEach((img) => {
            ['src', 'srcset', 'data-src', 'data-srcset', 'data-original'].forEach((attr) => {
                const v = img.getAttribute(attr) || '';
                if (REMOTE_IMG_RE.test(v) && !v.includes('/private/wiki/')) {
                    img.removeAttribute(attr);
                }
            });
            const src = img.getAttribute('src') || '';
            if (!src || (REMOTE_IMG_RE.test(src) && !src.includes('/private/wiki/'))) img.remove();
        });
    }
    root.querySelectorAll('[style]').forEach((el) => {
        const style = el.getAttribute('style') || '';
        if (/url\(\s*['"]?https?:/i.test(style) && (FANDOM_IMAGE_HOST_RE.test(style) || stripRemote)) {
            el.setAttribute('style', style.replace(/url\(\s*['"]?https?:[^)]+\)/gi, ''));
        }
    });
    return root.toString();
}

function replaceTagName(el, newTag) {
    const next = parse(`<${newTag}>${el.innerHTML}</${newTag}>`).querySelector(newTag);
    if (!next) return;
    el.replaceWith(next);
}

function normalizeWikiMarkup(html) {
    const root = parse(html, { blockTextElements: { script: false, style: false } });
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

function upsertHomeSite(globalResources, siteId, siteName, iconUrl, extra = null) {
    const base = getWikiBasePath(globalResources);
    const homePath = path.join(base, 'index.json');
    const home = readJsonSafe(homePath, { sites: [] });
    if (!home.sites) home.sites = [];
    const existing = home.sites.find((s) => s.id === siteId);
    const meta = extra && typeof extra === 'object' ? extra : {};
    const kind = meta.kind || 'fandom';
    if (!existing) {
        const row = {
            id: siteId,
            name: siteName,
            kind
        };
        if (iconUrl) row.icon = iconUrl;
        if (meta.fandomHost) row.fandomHost = meta.fandomHost;
        if (meta.lang) row.lang = meta.lang;
        if (meta.origin) row.origin = meta.origin;
        if (meta.articlepath) row.articlepath = meta.articlepath;
        if (meta.scriptpath) row.scriptpath = meta.scriptpath;
        if (meta.apiBase) row.apiBase = meta.apiBase;
        home.sites.push(row);
    } else {
        existing.name = siteName || existing.name;
        existing.kind = kind || existing.kind || 'fandom';
        if (meta.fandomHost) existing.fandomHost = meta.fandomHost;
        if (meta.lang) existing.lang = meta.lang;
        if (meta.origin) existing.origin = meta.origin;
        if (meta.articlepath) existing.articlepath = meta.articlepath;
        if (meta.scriptpath) existing.scriptpath = meta.scriptpath;
        if (meta.apiBase) existing.apiBase = meta.apiBase;
        if (iconUrl) existing.icon = iconUrl;
        else if (existing.icon && /\/assets\/icon\.png$/.test(existing.icon)) {
            const abs = path.join(base, siteId, 'assets', 'icon.png');
            if (!fs.existsSync(abs)) delete existing.icon;
        }
    }
    writeJson(homePath, home);
}

function upsertSitePage(globalResources, siteId, entry) {
    const siteDir = path.join(getWikiBasePath(globalResources), siteId);
    const indexPath = path.join(siteDir, 'index.json');
    const siteIndex = readJsonSafe(indexPath, { pages: [] });
    if (!siteIndex.pages) siteIndex.pages = [];
    const idx = siteIndex.pages.findIndex((p) => p.id === entry.id);
    if (idx >= 0) siteIndex.pages[idx] = { ...siteIndex.pages[idx], ...entry };
    else siteIndex.pages.push(entry);
    siteIndex.pages.sort((a, b) => String(a.title || a.id).localeCompare(String(b.title || b.id)));
    writeJson(indexPath, siteIndex);
}

function removeSitePage(globalResources, siteId, pageId) {
    const siteDir = path.join(getWikiBasePath(globalResources), siteId);
    const indexPath = path.join(siteDir, 'index.json');
    const siteIndex = readJsonSafe(indexPath, { pages: [] });
    siteIndex.pages = (siteIndex.pages || []).filter((p) => p.id !== pageId);
    writeJson(indexPath, siteIndex);
    const pagesDir = path.resolve(siteDir, 'pages');
    const pagePath = path.resolve(pagesDir, `${pageId}.html`);
    if (pagePath.startsWith(pagesDir + path.sep)) {
        ['.html', '.md', '.json'].forEach((ext) => {
            const p = pagePath.replace(/\.html$/, ext);
            if (fs.existsSync(p)) fs.unlinkSync(p);
        });
    }
}

async function ensureSiteIcon(globalResources, parsed, siteInfo) {
    const assetsDir = path.join(getWikiBasePath(globalResources), parsed.wikiId, 'assets');
    ensureDir(assetsDir);
    const existingNames = ['icon.png', 'icon.webp', 'icon.jpg', 'icon.ico', 'icon.svg'];
    for (const name of existingNames) {
        const abs = path.join(assetsDir, name);
        try {
            if (fs.existsSync(abs) && fs.statSync(abs).size > 600) {
                return `/private/wiki/${parsed.wikiId}/assets/${name}`;
            }
        } catch (_) { /* try download */ }
    }
    const origin = parsed.origin || `https://${parsed.host}`;
    const logo = absoluteHttpUrl(siteInfo && siteInfo.logo ? String(siteInfo.logo) : '', origin);
    const candidates = parsed.kind === 'mediawiki'
        ? [
            logo,
            `${origin}/favicon.ico`,
            `${origin}/favicon.png`
        ]
        : [
            logo,
            logo.replace('images.wikia.com', 'static.wikia.nocookie.net'),
            `https://static.wikia.nocookie.net/${parsed.wikiId}/images/favicon.ico`,
            `https://${parsed.host}/wiki/Special:FilePath/Site-logo.png`,
            `https://${parsed.host}/wiki/Special:FilePath/Wiki.png`
        ];
    const uniqueCandidates = candidates.filter((u, i, arr) => u && arr.indexOf(u) === i);
    for (const url of uniqueCandidates) {
        try {
            await sleep(RATE_MS);
            const bin = await fetchBinary(url, parsed.host);
            if (!bin || bin.length < 600) continue;
            const fileName = withSniffedExt('icon.png', bin);
            fs.writeFileSync(path.join(assetsDir, fileName), bin);
            return `/private/wiki/${parsed.wikiId}/assets/${fileName}`;
        } catch (_) { /* try next */ }
    }
    return null;
}

async function downloadImages(html, pageUrl, siteId, assetsDir, host, onProgress, extraUrls) {
    const urls = collectImageUrls(html, pageUrl);
    if (Array.isArray(extraUrls)) {
        for (const extra of extraUrls) {
            if (extra && !urls.includes(extra)) urls.push(extra);
        }
    }
    const map = new Map();
    let i = 0;
    for (const assetUrl of urls) {
        i += 1;
        if (onProgress) {
            onProgress({ phase: 'images', current: i, total: urls.length, message: assetUrl });
        }
        let { fileName, dest } = resolveAssetDest(assetsDir, assetFileName(assetUrl));
        if (!fs.existsSync(dest)) {
            await sleep(RATE_MS);
            try {
                const binary = await fetchBinary(assetUrl, host);
                fileName = withSniffedExt(fileName, binary);
                dest = path.join(assetsDir, fileName);
                fs.writeFileSync(dest, binary);
            } catch (err) {
                console.warn('[fandomWiki] asset failed:', assetUrl, err.message);
                continue;
            }
        } else {
            try {
                const binary = fs.readFileSync(dest);
                const corrected = withSniffedExt(fileName, binary);
                if (corrected !== fileName) {
                    const dest2 = path.join(assetsDir, corrected);
                    if (!fs.existsSync(dest2)) fs.renameSync(dest, dest2);
                    else fs.unlinkSync(dest);
                    fileName = corrected;
                    dest = dest2;
                }
            } catch (_) { /* keep existing name */ }
        }
        const localPath = `/private/wiki/${siteId}/assets/${fileName}`;
        map.set(assetUrl, localPath);
        const key = assetPathKey(assetUrl);
        if (key && !map.has(key)) map.set(key, localPath);
    }

    function localFor(raw) {
        if (!raw || raw.startsWith('data:')) return null;
        const abs = resolveUrl(pageUrl, raw);
        if (!abs) return null;
        if (map.has(abs)) return map.get(abs);
        const key = assetPathKey(abs);
        return key && map.has(key) ? map.get(key) : null;
    }

    const root = parse(html);
    root.querySelectorAll('img').forEach((img) => {
        const candidates = [
            img.getAttribute('data-src'),
            img.getAttribute('src'),
            img.getAttribute('data-original')
        ];
        const srcset = img.getAttribute('srcset') || img.getAttribute('data-srcset') || '';
        srcset.split(',').forEach((part) => candidates.push(part.trim().split(/\s+/)[0]));
        let local = null;
        for (const raw of candidates) {
            local = localFor(raw);
            if (local) break;
        }
        if (local) img.setAttribute('data-local-src', local);
    });
    root.querySelectorAll('[style]').forEach((el) => {
        const style = el.getAttribute('style') || '';
        if (!/url\(/i.test(style)) return;
        const next = style.replace(/url\(\s*['"]?([^'")\s]+)['"]?\s*\)/gi, (all, raw) => {
            const local = localFor(raw);
            return local ? `url('${local}')` : all;
        });
        el.setAttribute('style', next);
    });
    return root.toString();
}

function recordPageGraph(db, { wikiId, pageId, title, sourceUrl, origin, importId, role, childPageIds }) {
    const now = new Date().toISOString();
    const existing = db.prepare('SELECT origin FROM pages WHERE wiki_id = ? AND page_id = ?').get(wikiId, pageId);
    if (existing) {
        db.prepare(`
            UPDATE pages SET title = ?, source_url = ?, updated_at = ?,
                origin = CASE WHEN origin = 'manual' OR ? = 'manual' THEN 'manual' ELSE origin END
            WHERE wiki_id = ? AND page_id = ?
        `).run(title, sourceUrl, now, origin, wikiId, pageId);
    } else {
        db.prepare(`
            INSERT INTO pages (wiki_id, page_id, title, source_url, origin, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(wikiId, pageId, title, sourceUrl, origin, now, now);
    }
    if (importId) {
        db.prepare(`
            INSERT OR IGNORE INTO import_pages (import_id, wiki_id, page_id, role)
            VALUES (?, ?, ?, ?)
        `).run(importId, wikiId, pageId, role);
    }
    if (childPageIds && childPageIds.length) {
        const ins = db.prepare(`
            INSERT OR IGNORE INTO page_links (from_wiki_id, from_page_id, to_wiki_id, to_page_id)
            VALUES (?, ?, ?, ?)
        `);
        for (const childId of childPageIds) {
            ins.run(wikiId, pageId, wikiId, childId);
        }
    }
}

function writePageFiles(pagesDir, pageId, html, meta) {
    const pageFile = path.join(pagesDir, `${pageId}.html`);
    ensureDir(path.dirname(pageFile));
    fs.writeFileSync(pageFile, html, 'utf8');
    let markdown = '';
    try { markdown = nhm.translate(html) || ''; } catch (_) { markdown = ''; }
    if (markdown) fs.writeFileSync(pageFile.replace(/\.html$/, '.md'), markdown, 'utf8');
    writeJson(pageFile.replace(/\.html$/, '.json'), meta);
}

async function importOnePage(globalResources, parsed, opts, importId, role) {
    const siteId = parsed.wikiId;
    const siteDir = path.join(getWikiBasePath(globalResources), siteId);
    const pagesDir = path.join(siteDir, 'pages');
    const assetsDir = path.join(siteDir, 'assets');
    ensureDir(pagesDir);
    ensureDir(assetsDir);

    const requestedId = parsed.pageId;
    if (opts.onProgress) {
        opts.onProgress({ phase: 'parse', pageId: requestedId, message: parsed.sourceUrl });
    }
    await sleep(RATE_MS);
    const parsedPage = await fetchParsedPage(parsed);
    const canonicalId = parsedPage.canonicalId || requestedId;
    parsed.pageId = canonicalId;
    parsed.sourceUrl = pageSourceUrl(parsed, canonicalId);

    let html = stripFandomChrome(parsedPage.html);
    let extraImageUrls = [];
    if (parsed.kind === 'mediawiki') {
        extraImageUrls = await fetchImageInfoUrls(parsed, parsedPage.images);
    }
    html = await downloadImages(html, parsed.sourceUrl, siteId, assetsDir, parsed.host, opts.onProgress, extraImageUrls);
    const discovered = new Set();
    const linkCtx = parsed.kind === 'mediawiki' ? parsed : null;
    html = rewriteContent(html, parsed.sourceUrl, siteId, discovered, linkCtx);
    html = assertNoHotlinks(html, { stripRemote: parsed.kind === 'mediawiki' });
    html = normalizeWikiMarkup(html);

    const origin = role === 'root' ? 'manual' : 'follow';
    const importedAt = new Date().toISOString();
    writePageFiles(pagesDir, canonicalId, html, {
        id: canonicalId,
        title: parsedPage.title,
        sourceUrl: parsed.sourceUrl,
        importedAt,
        origin,
        requestedId: requestedId !== canonicalId ? requestedId : undefined
    });

    upsertSitePage(globalResources, siteId, {
        id: canonicalId,
        title: parsedPage.title,
        group: opts.group || 'Imported',
        sourceUrl: parsed.sourceUrl
    });

    if (requestedId && requestedId !== canonicalId) {
        writePageFiles(pagesDir, requestedId, html, {
            id: requestedId,
            title: parsedPage.title,
            sourceUrl: pageSourceUrl(parsed, requestedId),
            importedAt,
            origin,
            canonicalId
        });
        upsertSitePage(globalResources, siteId, {
            id: requestedId,
            title: parsedPage.title,
            group: opts.group || 'Imported',
            sourceUrl: pageSourceUrl(parsed, requestedId),
            canonicalId
        });
    }

    const db = openGraph(globalResources);
    recordPageGraph(db, {
        wikiId: siteId,
        pageId: canonicalId,
        title: parsedPage.title,
        sourceUrl: parsed.sourceUrl,
        origin,
        importId,
        role,
        childPageIds: [...discovered]
    });

    const children = (opts.followLinks ? parsedPage.links : [])
        .filter((id) => id && id !== canonicalId && !SKIP_TITLE_RE.test(id)
            && !(parsed.kind === 'mediawiki' && MEDIAWIKI_SKIP_TITLE_RE.test(id)));
    return { title: parsedPage.title, children, pageId: canonicalId };
}

async function importFandomPage(globalResources, options) {
    let parsed = parseFandomUrl(options.url);
    let kind = 'fandom';
    if (!parsed) {
        parsed = await detectMediaWikiSite(options.url);
        kind = parsed && parsed.kind ? parsed.kind : 'mediawiki';
    }
    if (!parsed) {
        throw new Error('URL must be a *.fandom.com/wiki/… page, a NovelAI docs/journal/blog URL, or a MediaWiki site that exposes /api.php');
    }
    parsed.kind = parsed.kind || kind;
    kind = parsed.kind;
    const followLinks = !!options.followLinks;
    const hardMax = kind === 'mediawiki' ? MEDIAWIKI_HARD_MAX_FOLLOW : HARD_MAX_FOLLOW;
    const defaultFollow = kind === 'mediawiki' ? MEDIAWIKI_DEFAULT_MAX_FOLLOW : DEFAULT_MAX_FOLLOW;
    const maxPages = Math.min(
        hardMax,
        Math.max(1, Number(options.maxPages) || (followLinks ? defaultFollow : 1))
    );
    const onProgress = options.onProgress || null;

    await sleep(RATE_MS);
    const siteInfo = await fetchSiteInfo(parsed);
    if (kind === 'mediawiki') {
        parsed.articlepath = siteInfo.articlepath || parsed.articlepath || '/wiki/$1';
        parsed.scriptpath = siteInfo.scriptpath || parsed.scriptpath || '';
        if (!parsed.origin) parsed.origin = `${parsed.host ? 'https://' : ''}${parsed.host}`;
        parsed.sourceUrl = pageSourceUrl(parsed, parsed.pageId);
    }
    const iconUrl = await ensureSiteIcon(globalResources, parsed, siteInfo);
    upsertHomeSite(globalResources, parsed.wikiId, siteInfo.name, iconUrl, {
        kind,
        fandomHost: parsed.fandomHost || (kind === 'fandom' ? parsed.host : null),
        lang: parsed.lang || siteInfo.lang || null,
        origin: parsed.origin || null,
        articlepath: parsed.articlepath || null,
        scriptpath: parsed.scriptpath || null,
        apiBase: parsed.apiBase || null
    });

    const db = openGraph(globalResources);
    const recordImport = options.recordImport !== false && options.recordImport !== 'false';
    let importId = Number(options.updateImportId) || 0;
    if (recordImport && !importId) {
        const existing = db.prepare(
            'SELECT id FROM imports WHERE wiki_id = ? AND root_page_id = ? ORDER BY id DESC LIMIT 1'
        ).get(parsed.wikiId, parsed.pageId);
        if (existing && (options.updateExisting === true || options.updateExisting === 'true')) {
            importId = Number(existing.id);
        }
    }
    if (recordImport && !importId) {
        const createdAt = new Date().toISOString();
        const importInfo = db.prepare(`
            INSERT INTO imports (wiki_id, root_page_id, source_url, group_name, follow_links, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(parsed.wikiId, parsed.pageId, parsed.sourceUrl, options.group || 'Imported', followLinks ? 1 : 0, createdAt);
        importId = Number(importInfo.lastInsertRowid);
    } else if (!recordImport) {
        importId = null;
    }

    const queue = [{ parsed, role: 'root' }];
    const visited = new Set();
    const imported = [];

    while (queue.length && imported.length < maxPages) {
        const item = queue.shift();
        const key = `${item.parsed.wikiId}/${item.parsed.pageId}`;
        if (visited.has(key)) continue;
        visited.add(key);
        if (onProgress) {
            onProgress({
                phase: 'page',
                current: imported.length + 1,
                total: Math.min(maxPages, imported.length + 1 + queue.length),
                pageId: item.parsed.pageId
            });
        }
        try {
            const result = await importOnePage(globalResources, item.parsed, {
                group: options.group || 'Imported',
                followLinks,
                onProgress
            }, importId, item.role);
            imported.push({
                wikiId: item.parsed.wikiId,
                pageId: result.pageId || item.parsed.pageId,
                title: result.title,
                role: item.role
            });
            if (followLinks) {
                for (const childId of result.children) {
                    const childKey = `${parsed.wikiId}/${childId}`;
                    if (visited.has(childKey) || imported.length + queue.length >= maxPages) continue;
                    queue.push({
                        parsed: {
                            ...parsed,
                            pageId: childId,
                            sourceUrl: pageSourceUrl(parsed, childId)
                        },
                        role: 'child'
                    });
                }
            }
        } catch (err) {
            console.error('[fandomWiki] import failed:', item.parsed.pageId, err.message);
            if (item.role === 'root') throw err;
        }
    }

    if (onProgress) {
        onProgress({ phase: 'done', current: imported.length, total: imported.length, importId });
    }

    return {
        importId,
        wikiId: parsed.wikiId,
        wikiName: siteInfo.name,
        rootPageId: parsed.pageId,
        sourceUrl: parsed.sourceUrl,
        kind,
        origin: parsed.origin || null,
        articlepath: parsed.articlepath || null,
        pages: imported
    };
}

function isManualPage(db, wikiId, pageId) {
    const row = db.prepare('SELECT 1 FROM imports WHERE wiki_id = ? AND root_page_id = ? LIMIT 1').get(wikiId, pageId);
    return !!row;
}

function previewDeleteImport(globalResources, importId) {
    const db = openGraph(globalResources);
    const imp = db.prepare('SELECT * FROM imports WHERE id = ?').get(importId);
    if (!imp) return null;
    const attached = db.prepare('SELECT wiki_id, page_id, role FROM import_pages WHERE import_id = ?').all(importId);
    const deletePages = [];
    const omitShared = [];
    const omitManual = [];
    for (const row of attached) {
        const other = db.prepare(`
            SELECT COUNT(*) AS n FROM import_pages
            WHERE wiki_id = ? AND page_id = ? AND import_id != ?
        `).get(row.wiki_id, row.page_id, importId);
        const shared = other.n > 0;
        const manual = isManualPage(db, row.wiki_id, row.page_id) && row.role !== 'root';
        const page = db.prepare('SELECT title FROM pages WHERE wiki_id = ? AND page_id = ?').get(row.wiki_id, row.page_id);
        const info = {
            wikiId: row.wiki_id,
            pageId: row.page_id,
            title: page?.title || row.page_id,
            role: row.role
        };
        if (row.role === 'root' && !shared) {
            deletePages.push(info);
        } else if (shared) {
            omitShared.push(info);
        } else if (manual) {
            omitManual.push(info);
        } else {
            deletePages.push(info);
        }
    }
    return {
        importId,
        wikiId: imp.wiki_id,
        rootPageId: imp.root_page_id,
        deletePages,
        omitShared,
        omitManual
    };
}

function deleteImport(globalResources, importId, { removeChildren = true } = {}) {
    const db = openGraph(globalResources);
    const preview = previewDeleteImport(globalResources, importId);
    if (!preview) throw new Error('Import not found');
    const toDelete = preview.deletePages.filter((p) => removeChildren || p.role === 'root');
    const txn = db.transaction(() => {
        db.prepare('DELETE FROM import_pages WHERE import_id = ?').run(importId);
        db.prepare('DELETE FROM imports WHERE id = ?').run(importId);
        for (const page of toDelete) {
            const still = db.prepare('SELECT 1 FROM import_pages WHERE wiki_id = ? AND page_id = ? LIMIT 1').get(page.wikiId, page.pageId);
            if (still) continue;
            db.prepare('DELETE FROM page_links WHERE (from_wiki_id = ? AND from_page_id = ?) OR (to_wiki_id = ? AND to_page_id = ?)')
                .run(page.wikiId, page.pageId, page.wikiId, page.pageId);
            db.prepare('DELETE FROM pages WHERE wiki_id = ? AND page_id = ?').run(page.wikiId, page.pageId);
            removeSitePage(globalResources, page.wikiId, page.pageId);
        }
    });
    txn();
    return { ...preview, deleted: toDelete };
}

function getFandomIndex(globalResources, { showAll = false } = {}) {
    const db = openGraph(globalResources);
    const base = getWikiBasePath(globalResources);
    const home = readJsonSafe(path.join(base, 'index.json'), { sites: [] });
    const fandomSites = (home.sites || []).filter((s) => s.kind === 'fandom');
    const groups = [];

    if (showAll) {
        for (const site of fandomSites) {
            const siteIndex = readJsonSafe(path.join(base, site.id, 'index.json'), { pages: [] });
            groups.push({
                name: site.name || site.id,
                siteId: site.id,
                icon: site.icon || null,
                pages: (siteIndex.pages || []).map((p) => ({
                    id: p.id,
                    title: p.title || p.id,
                    siteId: site.id
                }))
            });
        }
    } else {
        const imports = db.prepare('SELECT * FROM imports ORDER BY created_at DESC').all();
        const byWiki = new Map();
        for (const site of fandomSites) {
            byWiki.set(site.id, {
                name: site.name || site.id,
                siteId: site.id,
                icon: site.icon || null,
                pages: []
            });
        }
        for (const imp of imports) {
            if (!byWiki.has(imp.wiki_id)) {
                byWiki.set(imp.wiki_id, {
                    name: imp.wiki_id,
                    siteId: imp.wiki_id,
                    icon: `/private/wiki/${imp.wiki_id}/assets/icon.png`,
                    pages: []
                });
            }
            const page = db.prepare('SELECT title FROM pages WHERE wiki_id = ? AND page_id = ?').get(imp.wiki_id, imp.root_page_id);
            const group = byWiki.get(imp.wiki_id);
            if (!group.pages.some((p) => p.id === imp.root_page_id)) {
                group.pages.push({
                    id: imp.root_page_id,
                    title: page?.title || imp.root_page_id,
                    siteId: imp.wiki_id,
                    importId: imp.id
                });
            }
        }
        groups.push(...byWiki.values());
    }

    const pageCount = db.prepare('SELECT COUNT(*) AS n FROM pages').get().n;
    const importCount = db.prepare('SELECT COUNT(*) AS n FROM imports').get().n;
    return {
        showAll: !!showAll,
        wikiCount: fandomSites.length,
        pageCount,
        importCount,
        groups
    };
}

function inferSiteKind(site) {
    if (site && site.kind) return site.kind;
    if (site && site.id === 'novelai') return 'novelai';
    return 'static';
}

function listStoredSites(globalResources) {
    const base = getWikiBasePath(globalResources);
    const home = readJsonSafe(path.join(base, 'index.json'), { sites: [] });
    return (home.sites || []).map((s) => {
        const siteIndex = readJsonSafe(path.join(base, s.id, 'index.json'), { pages: [] });
        const pages = siteIndex.pages || [];
        return {
            id: s.id,
            name: s.name || s.id,
            kind: inferSiteKind(s),
            icon: s.icon || null,
            fandomHost: s.fandomHost || (s.kind === 'fandom' ? `${s.id}.fandom.com` : null),
            lang: s.lang || null,
            origin: s.origin || null,
            articlepath: s.articlepath || null,
            scriptpath: s.scriptpath || null,
            apiBase: s.apiBase || null,
            pageCount: pages.length,
            sourceUrls: pages.map((p) => p.sourceUrl).filter(Boolean).slice(0, 3)
        };
    });
}

function getManagerState(globalResources) {
    const db = openGraph(globalResources);
    const base = getWikiBasePath(globalResources);
    const home = readJsonSafe(path.join(base, 'index.json'), { sites: [] });
    const sites = listStoredSites(globalResources);
    const siteNames = Object.fromEntries((home.sites || []).map((s) => [s.id, s.name]));
    const imports = db.prepare('SELECT * FROM imports ORDER BY created_at DESC').all().map((imp) => {
        const page = db.prepare('SELECT title FROM pages WHERE wiki_id = ? AND page_id = ?').get(imp.wiki_id, imp.root_page_id);
        const attached = db.prepare('SELECT COUNT(*) AS n FROM import_pages WHERE import_id = ?').get(imp.id).n;
        const preview = previewDeleteImport(globalResources, imp.id);
        return {
            id: imp.id,
            wikiId: imp.wiki_id,
            wikiName: siteNames[imp.wiki_id] || imp.wiki_id,
            rootPageId: imp.root_page_id,
            title: page?.title || imp.root_page_id,
            sourceUrl: imp.source_url,
            group: imp.group_name,
            followLinks: !!imp.follow_links,
            createdAt: imp.created_at,
            pageCount: attached,
            exclusiveChildCount: (preview?.deletePages || []).filter((p) => p.role === 'child').length,
            sharedCount: (preview?.omitShared || []).length,
            manualOmitCount: (preview?.omitManual || []).length,
            preview
        };
    });
    const staticPageCount = sites.reduce((n, s) => n + (s.pageCount || 0), 0);
    return {
        imports,
        sites,
        stats: {
            wikis: sites.length,
            fandomWikis: sites.filter((s) => s.kind === 'fandom').length,
            pages: Math.max(db.prepare('SELECT COUNT(*) AS n FROM pages').get().n, staticPageCount),
            imports: imports.length
        }
    };
}

async function updateImport(globalResources, importId, options = {}) {
    const db = openGraph(globalResources);
    const imp = db.prepare('SELECT * FROM imports WHERE id = ?').get(importId);
    if (!imp) throw new Error('Import not found');
    return importFandomPage(globalResources, {
        url: imp.source_url,
        followLinks: !!imp.follow_links,
        group: imp.group_name || 'Imported',
        updateImportId: importId,
        onProgress: options.onProgress || null
    });
}

async function updateFandomSite(globalResources, siteId, options = {}) {
    const base = getWikiBasePath(globalResources);
    const siteIndex = readJsonSafe(path.join(base, siteId, 'index.json'), { pages: [] });
    const urls = (siteIndex.pages || []).map((p) => p.sourceUrl).filter(Boolean);
    if (!urls.length) {
        throw new Error('No source URLs stored for this wiki; re-import from a page URL');
    }
    const onProgress = options.onProgress || null;
    const imported = [];
    let i = 0;
    for (const url of urls) {
        i += 1;
        if (onProgress) onProgress({ phase: 'page', current: i, total: urls.length, pageId: url });
        const result = await importFandomPage(globalResources, {
            url,
            followLinks: false,
            recordImport: false,
            group: options.group || 'Imported',
            onProgress
        });
        imported.push(...(result.pages || []));
    }
    return { siteId, pages: imported };
}

function closeGraph() {
    if (graphDb) {
        graphDb.close();
        graphDb = null;
    }
}

module.exports = {
    parseFandomUrl,
    detectMediaWikiSite,
    fandomDisplayUrl,
    fandomPageUrl,
    mediaWikiPageUrl,
    importFandomPage,
    getFandomIndex,
    getManagerState,
    listStoredSites,
    previewDeleteImport,
    deleteImport,
    updateImport,
    updateFandomSite,
    closeGraph,
    getWikiBasePath
};
