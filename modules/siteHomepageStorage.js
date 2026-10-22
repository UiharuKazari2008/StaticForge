'use strict';

const fs = require('fs');
const path = require('path');

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const BUNDLED_AVAILABLE = path.join(__dirname, '..', 'resources', 'site-homepages');

function cacheRoot(projectRoot) {
    return path.join(projectRoot, '.cache', 'site-homepage');
}

function availableDir(projectRoot) {
    return path.join(cacheRoot(projectRoot), 'available');
}

function installedDir(projectRoot, slug) {
    return path.join(cacheRoot(projectRoot), slug);
}

function isSafeSlug(slug) {
    return typeof slug === 'string' && SLUG_RE.test(slug);
}

function ensureAvailableCatalog(projectRoot) {
    const avail = availableDir(projectRoot);
    fs.mkdirSync(avail, { recursive: true });
    if (!fs.existsSync(BUNDLED_AVAILABLE)) return;
    const bundled = fs.readdirSync(BUNDLED_AVAILABLE, { withFileTypes: true });
    for (const ent of bundled) {
        if (!ent.isDirectory() || !isSafeSlug(ent.name)) continue;
        const dest = path.join(avail, ent.name);
        if (fs.existsSync(dest)) continue;
        copyTreeSync(path.join(BUNDLED_AVAILABLE, ent.name), dest);
    }
}

function listAvailableSlugs(projectRoot) {
    ensureAvailableCatalog(projectRoot);
    const avail = availableDir(projectRoot);
    if (!fs.existsSync(avail)) return [];
    return fs.readdirSync(avail, { withFileTypes: true })
        .filter((d) => d.isDirectory() && isSafeSlug(d.name))
        .map((d) => d.name)
        .sort();
}

function copyTreeSync(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) {
        const from = path.join(src, name);
        const to = path.join(dest, name);
        const st = fs.statSync(from);
        if (st.isDirectory()) {
            copyTreeSync(from, to);
        } else if (st.isFile()) {
            fs.copyFileSync(from, to);
        }
    }
}

function installHomepage(projectRoot, slug) {
    if (!isSafeSlug(slug)) {
        throw new Error('Invalid homepage slug');
    }
    ensureAvailableCatalog(projectRoot);
    const src = path.join(availableDir(projectRoot), slug);
    if (!fs.existsSync(src)) {
        throw new Error('Homepage slug is not available');
    }
    const dest = installedDir(projectRoot, slug);
    fs.rmSync(dest, { recursive: true, force: true });
    copyTreeSync(src, dest);
    return dest;
}

function readDoorMeta(siteDir) {
    const doorPath = path.join(siteDir, 'door.json');
    let postPath = '/';
    let noResultPath = 'noresult.html';
    if (fs.existsSync(doorPath)) {
        try {
            const meta = JSON.parse(fs.readFileSync(doorPath, 'utf8'));
            if (meta && typeof meta.postPath === 'string' && meta.postPath.startsWith('/')) {
                postPath = meta.postPath.split('?')[0];
            }
            if (meta && typeof meta.noResultPath === 'string') {
                noResultPath = meta.noResultPath.replace(/^\/+/, '');
            }
        } catch (_err) {
            // keep defaults
        }
    }
    return { postPath, noResultPath };
}

function resolveSiteFile(siteDir, urlPath) {
    const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
    if (!rel || rel.includes('..') || rel.includes('\0')) {
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
        '.txt': 'text/plain; charset=utf-8'
    };
    return map[ext] || 'application/octet-stream';
}

module.exports = {
    isSafeSlug,
    cacheRoot,
    availableDir,
    installedDir,
    ensureAvailableCatalog,
    listAvailableSlugs,
    installHomepage,
    readDoorMeta,
    resolveSiteFile,
    contentTypeForRel
};
