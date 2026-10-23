'use strict';

const fs = require('fs');
const path = require('path');

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

function coverSitesRoot(projectRoot) {
    return path.join(projectRoot || path.join(__dirname, '..'), 'resources', 'site-homepages');
}

function isSafeSlug(slug) {
    return typeof slug === 'string' && SLUG_RE.test(slug);
}

function coverSiteDir(projectRoot, slug) {
    if (!isSafeSlug(slug)) return null;
    return path.join(coverSitesRoot(projectRoot), slug);
}

function slugHasCoverSite(projectRoot, slug) {
    const dir = coverSiteDir(projectRoot, slug);
    if (!dir || !fs.existsSync(dir)) return false;
    const resolved = resolveSiteFile(dir, '/');
    return resolved.kind === 'file';
}

function listAvailableSlugs(projectRoot) {
    const root = coverSitesRoot(projectRoot);
    if (!fs.existsSync(root)) return [];
    return fs.readdirSync(root, { withFileTypes: true })
        .filter((d) => d.isDirectory() && isSafeSlug(d.name))
        .filter((d) => slugHasCoverSite(projectRoot, d.name))
        .map((d) => d.name)
        .sort();
}

function resolvePreviewSiteDir(projectRoot, slug) {
    const siteDir = coverSiteDir(projectRoot, slug);
    if (!siteDir || !fs.existsSync(siteDir)) return null;
    const resolved = resolveSiteFile(siteDir, '/');
    if (resolved.kind !== 'file') return null;
    return { siteDir, resolved };
}

function readPreviewHtml(projectRoot, slug) {
    const hit = resolvePreviewSiteDir(projectRoot, slug);
    if (!hit) return null;
    return fs.readFileSync(hit.resolved.abs, 'utf8');
}

// The site gate reads the door meta on every unauthenticated request; cover sites only
// change on deploy, so a short TTL is enough. Callers get a copy.
const DOOR_META_TTL_MS = 2000;
const doorMetaCache = new Map();

function readDoorMeta(siteDir) {
    const now = Date.now();
    const hit = doorMetaCache.get(siteDir);
    if (hit && now - hit.at < DOOR_META_TTL_MS) {
        return { ...hit.value };
    }
    const value = readDoorMetaUncached(siteDir);
    if (doorMetaCache.size > 64) doorMetaCache.clear();
    doorMetaCache.set(siteDir, { at: now, value });
    return { ...value };
}

/**
 * The cover site's door, from manifest.json "door" (door.json still overrides the paths):
 *   action      the endpoint the search form POSTs to (not a file, e.g. "cgi-bin/kensaku.cgi")
 *   resultPage  the results page rendered for that POST, and for GET resultPage/action ?q=
 *   records     { "<id>": "<html>" } entries the site itself lists: a real lookup finds them
 * Older sites name a .html file as the action: then it is also the result page.
 */
function readDoorMetaUncached(siteDir) {
    let postPath = null;
    let resultPage = 'noresult.html';
    let field = 'q';
    let records = {};
    let forms = {};

    const manifestPath = path.join(siteDir, 'manifest.json');
    if (fs.existsSync(manifestPath)) {
        try {
            const meta = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            const door = meta && meta.door;
            if (door && typeof door.action === 'string') {
                const actionRel = door.action.replace(/^\/+/, '').split('?')[0];
                postPath = '/' + actionRel;
                resultPage = typeof door.resultPage === 'string'
                    ? door.resultPage.replace(/^\/+/, '').split('?')[0]
                    : actionRel;
            }
            if (door && typeof door.field === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(door.field)) {
                field = door.field;
            }
            if (door && door.records && typeof door.records === 'object') {
                for (const [key, html] of Object.entries(door.records)) {
                    if (typeof html === 'string') records[normalizeDoorQuery(key)] = html;
                }
            }
            // "forms": { "cgi-bin/formmail.cgi": "toiawase-kanryo.html" }: a contact form's POST
            // endpoint and the page it answers with (a static file itself takes no POST)
            if (meta && meta.forms && typeof meta.forms === 'object') {
                for (const [endpoint, page] of Object.entries(meta.forms)) {
                    if (typeof page === 'string') {
                        forms['/' + endpoint.replace(/^\/+/, '').split('?')[0]] = page.replace(/^\/+/, '');
                    }
                }
            }
        } catch (_err) {
            // fall through
        }
    }

    const doorPath = path.join(siteDir, 'door.json');
    if (fs.existsSync(doorPath)) {
        try {
            const meta = JSON.parse(fs.readFileSync(doorPath, 'utf8'));
            if (meta && typeof meta.postPath === 'string' && meta.postPath.startsWith('/')) {
                postPath = meta.postPath.split('?')[0];
            }
            if (meta && typeof meta.noResultPath === 'string') {
                resultPage = meta.noResultPath.replace(/^\/+/, '');
            }
        } catch (_err) {
            // keep defaults
        }
    }

    return {
        postPath: postPath || '/lookup',
        actionPath: postPath || '/lookup',
        noResultPath: resultPage,
        resultPage,
        field,
        records,
        forms
    };
}

/** A lookup id as the records are keyed: NFKC (full-width digits), trimmed, upper case. */
function normalizeDoorQuery(raw) {
    if (raw == null) return '';
    return String(raw).normalize('NFKC').trim().toUpperCase();
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
}

/**
 * The result page for a lookup. Markers in the page:
 *   <!--door:none-->…<!--/door:none-->  the "nothing found" block: replaced by the record that
 *                                       matches, kept for a miss, dropped when there is no query
 *   <!--door:q-->                       the query as typed (escaped)
 */
function renderDoorResult(html, doorMeta, query) {
    const q = query == null ? '' : String(query);
    const key = normalizeDoorQuery(q);
    const record = key && doorMeta && doorMeta.records ? doorMeta.records[key] : null;
    let out = html.replace(/<!--door:none-->([\s\S]*?)<!--\/door:none-->/g, (_m, none) => {
        if (!key) return '';
        return record != null ? record : none;
    });
    out = out.replace(/<!--door:q-->/g, escapeHtml(q));
    return { html: out, found: record != null };
}

/** Requests the door answers: POST to its action (phrase or lookup), legacy POST /lookup. */
function extractDoorPhrase(req, doorMeta, options = {}) {
    const method = (req.method || 'GET').toUpperCase();
    const urlPath = (req.path || '/').split('?')[0] || '/';
    if (method !== 'POST') {
        return undefined;
    }
    const field = doorMeta.field || 'q';
    const read = () => (req.body && req.body[field] != null ? String(req.body[field])
        : (req.body && req.body.q != null ? String(req.body.q) : ''));
    if (urlPath === doorMeta.postPath || urlPath === doorMeta.actionPath) {
        return read();
    }
    // /lookup is the old shared door every site answered: a probe that matched all of them.
    // Only Dreamscape's own clients (options.clientKnock) still use it.
    if (urlPath === '/lookup' && options.clientKnock) {
        return read();
    }
    return undefined;
}

/** A request path as nginx resolves it: percent-decoded, no NUL, no dot segments. */
function decodeSitePath(urlPath) {
    let decoded = urlPath;
    try {
        decoded = decodeURIComponent(urlPath);
    } catch (_err) {
        return null;
    }
    if (decoded.includes('\0') || decoded.includes('\\')) return null;
    return decoded;
}

function isBlockedSiteName(rel) {
    const base = path.basename(rel).toLowerCase();
    return base === 'manifest.json' || base === 'door.json';
}

function notFoundOrMissing(siteDir, exists) {
    const notFound = path.join(siteDir, '404.html');
    return exists(notFound) ? { kind: '404', abs: notFound } : { kind: 'missing' };
}

/**
 * kind: 'file' | '404' | 'missing' | 'redirect' (a directory without its slash: Location) |
 * 'forbidden' (a directory without index.html, as nginx without autoindex).
 */
function resolveWith(siteDir, urlPath, stat) {
    const exists = (abs) => !!stat(abs);
    const decoded = decodeSitePath(urlPath || '/');
    if (decoded == null) return notFoundOrMissing(siteDir, exists);
    const trailing = decoded.length > 1 && decoded.endsWith('/');
    const rel = decoded === '/' ? '' : decoded.replace(/^\/+/, '').replace(/\/+$/, '');
    if (rel.split('/').some((seg) => seg === '..' || seg === '.')) return notFoundOrMissing(siteDir, exists);
    if (rel && isBlockedSiteName(rel)) return notFoundOrMissing(siteDir, exists);
    const root = path.resolve(siteDir);
    const abs = path.resolve(root, rel || '.');
    if (abs !== root && !abs.startsWith(root + path.sep)) return notFoundOrMissing(siteDir, exists);
    const st = stat(abs);
    if (st && st.isSymbolicLink()) return notFoundOrMissing(siteDir, exists);
    if (st && st.isFile()) {
        // /index.html/ is a directory request on a static server: 404
        if (trailing) return notFoundOrMissing(siteDir, exists);
        return { kind: 'file', abs, rel };
    }
    if (st && st.isDirectory()) {
        if (rel && !trailing) return { kind: 'redirect', location: decoded + '/' };
        const indexTry = path.join(abs, 'index.html');
        const ist = stat(indexTry);
        if (ist && ist.isFile() && !ist.isSymbolicLink()) {
            return { kind: 'file', abs: indexTry, rel: rel ? path.join(rel, 'index.html') : 'index.html' };
        }
        return { kind: 'forbidden' };
    }
    return notFoundOrMissing(siteDir, exists);
}

function lstatSync(abs) {
    try {
        return fs.lstatSync(abs);
    } catch (_err) {
        return null;
    }
}

function resolveSiteFile(siteDir, urlPath) {
    return resolveWith(siteDir, urlPath, lstatSync);
}

async function isFileAsync(abs) {
    try {
        return (await fs.promises.stat(abs)).isFile();
    } catch (_err) {
        return false;
    }
}

async function existsAsync(abs) {
    try {
        await fs.promises.stat(abs);
        return true;
    } catch (_err) {
        return false;
    }
}

// Same answers as resolveSiteFile (site gate request path)
async function resolveSiteFileAsync(siteDir, urlPath) {
    const cache = new Map();
    const stats = [];
    // Collect the paths resolveWith asks for, stat them asynchronously, then answer from that
    const probe = (abs) => { stats.push(abs); return cache.has(abs) ? cache.get(abs) : undefined; };
    for (let round = 0; round < 4; round++) {
        stats.length = 0;
        const result = resolveWith(siteDir, urlPath, (abs) => {
            const hit = probe(abs);
            return hit === undefined ? null : hit;
        });
        const missing = stats.filter((abs) => !cache.has(abs));
        if (!missing.length) return result;
        await Promise.all(missing.map(async (abs) => {
            try {
                cache.set(abs, await fs.promises.lstat(abs));
            } catch (_err) {
                cache.set(abs, null);
            }
        }));
    }
    return resolveWith(siteDir, urlPath, lstatSync);
}

function contentTypeForRel(rel) {
    const ext = path.extname(rel || '').toLowerCase();
    const map = {
        '.html': 'text/html; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon',
        '.txt': 'text/plain; charset=utf-8',
        '.pdf': 'application/pdf',
        '.csv': 'text/csv; charset=utf-8'
    };
    return map[ext] || 'application/octet-stream';
}

module.exports = {
    isSafeSlug,
    coverSitesRoot,
    coverSiteDir,
    slugHasCoverSite,
    listAvailableSlugs,
    readDoorMeta,
    extractDoorPhrase,
    renderDoorResult,
    normalizeDoorQuery,
    resolveSiteFile,
    resolveSiteFileAsync,
    contentTypeForRel,
    resolvePreviewSiteDir,
    readPreviewHtml
};
