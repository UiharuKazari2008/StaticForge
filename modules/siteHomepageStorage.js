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

function readDoorMetaUncached(siteDir) {
    let postPath = '/lookup';
    let noResultPath = 'noresult.html';
    let actionPath = '/lookup';

    const manifestPath = path.join(siteDir, 'manifest.json');
    if (fs.existsSync(manifestPath)) {
        try {
            const meta = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            if (meta && meta.door && typeof meta.door.action === 'string') {
                const actionRel = meta.door.action.replace(/^\/+/, '').split('?')[0];
                noResultPath = actionRel;
                actionPath = '/' + actionRel;
                postPath = actionPath;
            }
            if (meta && typeof meta.notFound === 'string') {
                // used by resolveSiteFile 404 fallback name only when custom
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
                actionPath = postPath;
            }
            if (meta && typeof meta.noResultPath === 'string') {
                noResultPath = meta.noResultPath.replace(/^\/+/, '');
            }
        } catch (_err) {
            // keep defaults
        }
    }

    return { postPath, noResultPath, actionPath };
}

function extractDoorPhrase(req, doorMeta) {
    const method = (req.method || 'GET').toUpperCase();
    const urlPath = (req.path || '/').split('?')[0] || '/';
    const actionPath = doorMeta.actionPath || doorMeta.postPath;

    if (method !== 'POST') {
        return undefined;
    }

    if (urlPath === doorMeta.postPath || urlPath === actionPath || urlPath === '/lookup') {
        return req.body && req.body.q != null ? String(req.body.q) : '';
    }

    return undefined;
}

function resolveSiteFile(siteDir, urlPath) {
    const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
    if (!rel || rel.includes('..') || rel.includes('\0')) {
        return { kind: 'missing' };
    }
    const base = path.basename(rel);
    if (base === 'manifest.json' || base === 'door.json') {
        return { kind: 'missing' };
    }
    const abs = path.resolve(siteDir, rel);
    const root = path.resolve(siteDir);
    if (abs !== root && !abs.startsWith(root + path.sep)) {
        return { kind: 'missing' };
    }
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
        return { kind: 'file', abs, rel };
    }
    const indexTry = path.join(abs, 'index.html');
    if (fs.existsSync(indexTry) && fs.statSync(indexTry).isFile()) {
        return { kind: 'file', abs: indexTry, rel: path.join(rel, 'index.html') };
    }
    const notFound = path.join(siteDir, '404.html');
    if (fs.existsSync(notFound)) {
        return { kind: '404', abs: notFound };
    }
    return { kind: 'missing' };
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

// Same answers as resolveSiteFile, with async stats (site gate request path).
async function resolveSiteFileAsync(siteDir, urlPath) {
    const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
    if (!rel || rel.includes('..') || rel.includes('\0')) {
        return { kind: 'missing' };
    }
    const base = path.basename(rel);
    if (base === 'manifest.json' || base === 'door.json') {
        return { kind: 'missing' };
    }
    const abs = path.resolve(siteDir, rel);
    const root = path.resolve(siteDir);
    if (abs !== root && !abs.startsWith(root + path.sep)) {
        return { kind: 'missing' };
    }
    if (await isFileAsync(abs)) {
        return { kind: 'file', abs, rel };
    }
    const indexTry = path.join(abs, 'index.html');
    if (await isFileAsync(indexTry)) {
        return { kind: 'file', abs: indexTry, rel: path.join(rel, 'index.html') };
    }
    const notFound = path.join(siteDir, '404.html');
    if (await existsAsync(notFound)) {
        return { kind: '404', abs: notFound };
    }
    return { kind: 'missing' };
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
    resolveSiteFile,
    resolveSiteFileAsync,
    contentTypeForRel,
    resolvePreviewSiteDir,
    readPreviewHtml
};
