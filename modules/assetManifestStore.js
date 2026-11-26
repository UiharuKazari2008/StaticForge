'use strict';

// The asset manifest (webPath -> size, mtime, hash) kept on disk between starts (#1230).
// Without it every boot rehashed the whole public/ tree: the in-memory previous list that
// hashServedFileIfChangedAsync compares against is empty after a restart. With it only a
// file whose size or mtime moved is read again.

const fs = require('fs');
const path = require('path');

const MANIFEST_VERSION = 1;

function manifestPath(projectRoot) {
    return path.join(projectRoot, '.cache', 'asset-manifest.json');
}

async function load(projectRoot) {
    try {
        const parsed = JSON.parse(await fs.promises.readFile(manifestPath(projectRoot), 'utf8'));
        if (!parsed || parsed.version !== MANIFEST_VERSION || !Array.isArray(parsed.assets)) return [];
        return parsed.assets.filter((e) => e && typeof e.path === 'string' && e.hash);
    } catch (_) {
        return [];
    }
}

// Atomic: write beside, rename over. A torn file would only cost one full rehash (load ignores it).
async function save(projectRoot, assets) {
    const target = manifestPath(projectRoot);
    const tmp = `${target}.${process.pid}.tmp`;
    try {
        await fs.promises.mkdir(path.dirname(target), { recursive: true });
        await fs.promises.writeFile(tmp, JSON.stringify({ version: MANIFEST_VERSION, assets }));
        await fs.promises.rename(tmp, target);
        return true;
    } catch (_) {
        try { await fs.promises.unlink(tmp); } catch (__) { /* gone */ }
        return false;
    }
}

// Run fn over items with at most `limit` in flight (one shared cursor, no per-item await chain).
async function runBounded(items, limit, fn) {
    let next = 0;
    const worker = async () => {
        while (next < items.length) {
            const item = items[next++];
            await fn(item);
        }
    };
    const n = Math.max(1, Math.min(limit, items.length));
    await Promise.all(Array.from({ length: n }, worker));
}

module.exports = { MANIFEST_VERSION, manifestPath, load, save, runBounded };
