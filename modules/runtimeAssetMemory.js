/**
 * In-memory copies of precompiled runtime assets.
 * Request handlers must use lookup() / singleFlight() and must not touch the fs module.
 * modules/runtimeAssetService.js
 * modules/runtimeAssetCompiler.js
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const assets = new Map();
const hashes = new Map();
const inflight = new Map();
// Hash-only entries (page assets that are not precompiled, e.g. /protected/*.js):
// the file each hash was read from and its mtime/size, so a refresh can rehash
// the ones edited since. Without this they kept their boot ?sha= until a restart.
const hashSources = new Map();

function normalizeWebPath(webPath) {
    let value = String(webPath || '').split('#')[0].split('?')[0];
    if (!value) {
        return '';
    }
    if (!value.startsWith('/')) {
        value = `/${value}`;
    }
    return value;
}

function contentTypeFor(webPath) {
    if (webPath.endsWith('.css')) {
        return 'text/css; charset=utf-8';
    }
    if (webPath.endsWith('.js')) {
        return 'text/javascript; charset=utf-8';
    }
    if (webPath.endsWith('.html')) {
        return 'text/html; charset=utf-8';
    }
    if (webPath.endsWith('.png')) {
        return 'image/png';
    }
    if (webPath.endsWith('.svg')) {
        return 'image/svg+xml';
    }
    if (webPath.endsWith('.webp')) {
        return 'image/webp';
    }
    return 'application/octet-stream';
}

function sha256(buf) {
    return crypto.createHash('sha256').update(buf).digest('hex');
}

function remember(webPath, body, meta = {}) {
    const key = normalizeWebPath(webPath);
    if (!key) {
        return null;
    }
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
    const hash = sha256(buf);
    const entry = {
        body: buf,
        hash,
        optimized: meta.optimized !== false,
        contentType: contentTypeFor(key),
        modified: meta.modified || Date.now()
    };
    assets.set(key, entry);
    hashes.set(key, hash);
    hashSources.delete(key);
    return entry;
}

// source: { abs, mtimeMs, size } of the file hashed; lets revalidateHashOnly() notice edits.
function rememberHash(webPath, hash, source) {
    const key = normalizeWebPath(webPath);
    if (!key || !hash) {
        return;
    }
    hashes.set(key, hash);
    if (source && source.abs) {
        hashSources.set(key, { abs: source.abs, mtimeMs: source.mtimeMs, size: source.size });
    }
}

// Rehash hash-only entries whose file changed (mtime or size). Returns the web paths updated.
async function revalidateHashOnly() {
    const updated = [];
    for (const [key, source] of hashSources) {
        let stat;
        try {
            stat = await fs.promises.stat(source.abs);
        } catch (err) {
            if (err.code === 'ENOENT') {
                hashes.delete(key);
                hashSources.delete(key);
                updated.push(key);
            }
            continue;
        }
        if (stat.mtimeMs === source.mtimeMs && stat.size === source.size) {
            continue;
        }
        // A precompiled body replaced this entry meanwhile: its hash is authoritative.
        if (!hashSources.has(key) || assets.has(key)) {
            continue;
        }
        const buf = await fs.promises.readFile(source.abs);
        hashes.set(key, sha256(buf));
        hashSources.set(key, { abs: source.abs, mtimeMs: stat.mtimeMs, size: stat.size });
        updated.push(key);
    }
    return updated;
}

function decorate(webPath, body, meta = {}) {
    const key = normalizeWebPath(webPath);
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
    return {
        body: buf,
        hash: sha256(buf),
        optimized: meta.optimized === true,
        contentType: contentTypeFor(key),
        modified: meta.modified || Date.now()
    };
}

function lookup(webPath) {
    return assets.get(normalizeWebPath(webPath)) || null;
}

function servedHash(webPath) {
    return hashes.get(normalizeWebPath(webPath)) || null;
}

function headerSourceHash(webPath) {
    const hit = lookup(webPath);
    if (!hit || !hit.body) {
        return null;
    }
    const newline = hit.body.indexOf(0x0a);
    const end = newline === -1 ? Math.min(hit.body.length, 4096) : newline;
    const line = hit.body.toString('utf8', 0, end);
    const match = line.match(/Source SHA256:\s*([a-f0-9]+)/i);
    return match ? match[1] : null;
}

function singleFlight(key, fn) {
    const existing = inflight.get(key);
    if (existing) {
        return existing;
    }
    const promise = Promise.resolve().then(fn);
    inflight.set(key, promise);
    // finally() returns a second promise. A rejection (missing source file) is
    // already handled by the caller; the derived promise must be caught or Node
    // reports it as an unhandled rejection.
    promise.finally(() => {
        if (inflight.get(key) === promise) {
            inflight.delete(key);
        }
    }).catch(() => {});
    return promise;
}

function clear() {
    assets.clear();
    hashes.clear();
    hashSources.clear();
}

function summary() {
    let outputBytes = 0;
    for (const entry of assets.values()) {
        outputBytes += entry.body.length;
    }
    return {
        totalFiles: assets.size,
        outputBytes
    };
}

function shouldSkipRel(rel) {
    const base = path.basename(rel);
    if (!base || base.startsWith('.')) {
        return true;
    }
    if (base.includes('.tmp.')) {
        return true;
    }
    if (base === '_sources.json' || base.endsWith('.json')) {
        return true;
    }
    return false;
}

async function walkFiles(dir, out) {
    let items;
    try {
        items = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch (err) {
        if (err.code === 'ENOENT') {
            return;
        }
        throw err;
    }
    for (const item of items) {
        const abs = path.join(dir, item.name);
        if (item.isDirectory()) {
            await walkFiles(abs, out);
            continue;
        }
        if (item.isFile()) {
            out.push(abs);
        }
    }
}

async function loadTree(outputRoot) {
    if (!outputRoot) {
        return 0;
    }
    const files = [];
    await walkFiles(outputRoot, files);
    let loaded = 0;
    for (const abs of files) {
        const rel = path.relative(outputRoot, abs).replace(/\\/g, '/');
        if (shouldSkipRel(rel)) {
            continue;
        }
        const [body, stat] = await Promise.all([
            fs.promises.readFile(abs),
            fs.promises.stat(abs)
        ]);
        remember(`/${rel}`, body, { optimized: true, modified: stat.mtimeMs });
        loaded++;
        if (loaded % 8 === 0) {
            await new Promise((resolve) => setImmediate(resolve));
        }
    }
    return loaded;
}

async function rememberAbs(abs, webPath) {
    const [body, stat] = await Promise.all([
        fs.promises.readFile(abs),
        fs.promises.stat(abs)
    ]);
    return remember(webPath, body, { optimized: true, modified: stat.mtimeMs });
}

module.exports = {
    normalizeWebPath,
    contentTypeFor,
    remember,
    rememberHash,
    revalidateHashOnly,
    decorate,
    lookup,
    servedHash,
    headerSourceHash,
    singleFlight,
    clear,
    summary,
    loadTree,
    rememberAbs
};
