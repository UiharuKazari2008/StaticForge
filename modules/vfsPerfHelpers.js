'use strict';

// Async file-system helpers for VFS listings (#620). Listing paths used to stat
// thousands of files and walk big trees with sync calls, blocking the event loop.

const fs = require('fs');
const path = require('path');

const yieldToLoop = () => new Promise((resolve) => setImmediate(resolve));

/**
 * Map items through an async fn with at most `limit` calls in flight.
 * Result order matches input order.
 */
async function mapWithConcurrency(items, limit, fn) {
    const list = Array.isArray(items) ? items : [];
    const out = new Array(list.length);
    let next = 0;
    const width = Math.max(1, Math.min(limit || 1, list.length));
    const workers = [];
    for (let w = 0; w < width; w++) {
        workers.push((async () => {
            while (next < list.length) {
                const i = next++;
                out[i] = await fn(list[i], i);
            }
        })());
    }
    await Promise.all(workers);
    return out;
}

/**
 * Stat files in `dir` by name. Returns Map(name -> { size, mtime }) where mtime is
 * whole seconds; missing or unreadable files map to { size: 0, mtime: null }.
 */
async function statNamesInDir(dir, names, limit = 64) {
    const map = new Map();
    const unique = [...new Set(names || [])];
    await mapWithConcurrency(unique, limit, async (name) => {
        try {
            const st = await fs.promises.stat(path.join(dir, name));
            map.set(name, { size: st.size, mtime: Math.floor(st.mtimeMs / 1000) });
        } catch (_) {
            map.set(name, { size: 0, mtime: null });
        }
    });
    return map;
}

/**
 * Recursive folder sizes computed in the background with fs.promises.opendir.
 * get() never blocks: it returns the last known value (0 before the first walk
 * finishes) and starts a walk when the value is missing or older than ttlMs.
 * Walks for the same key share one in-flight promise. Every subfolder reached
 * gets its own cache entry, so drilling down is served from the same walk.
 */
class DirSizeCache {
    constructor({ ttlMs = 60000, statConcurrency = 32, yieldEvery = 256 } = {}) {
        this.ttlMs = ttlMs;
        this.statConcurrency = statConcurrency;
        this.yieldEvery = yieldEvery;
        this._entries = new Map();
        this._inflight = new Map();
        this._work = 0;
    }

    // spec: { key(absPath) -> string, include(dirent, childParts) -> bool }
    get(absPath, parts, spec) {
        const key = spec.key(absPath);
        const cached = this._entries.get(key);
        if (!cached || Date.now() - cached.at >= this.ttlMs) {
            this._walk(absPath, parts, spec).catch(() => {});
        }
        return cached ? cached.bytes : 0;
    }

    // Resolves once a fresh value is known (used by tests and warmers).
    async getAsync(absPath, parts, spec) {
        const key = spec.key(absPath);
        const cached = this._entries.get(key);
        if (cached && Date.now() - cached.at < this.ttlMs) return cached.bytes;
        return this._walk(absPath, parts, spec);
    }

    clear() {
        this._entries.clear();
    }

    async _tick() {
        if (++this._work % this.yieldEvery === 0) await yieldToLoop();
    }

    _walk(absPath, parts, spec) {
        const key = spec.key(absPath);
        const running = this._inflight.get(key);
        if (running) return running;
        const job = this._sumDir(absPath, parts, spec)
            .then((bytes) => {
                this._entries.set(key, { bytes, at: Date.now() });
                return bytes;
            })
            .finally(() => {
                this._inflight.delete(key);
            });
        this._inflight.set(key, job);
        return job;
    }

    async _sumDir(absPath, parts, spec) {
        let dir;
        try {
            dir = await fs.promises.opendir(absPath);
        } catch (_) {
            return 0;
        }
        const files = [];
        const dirs = [];
        try {
            for await (const ent of dir) {
                const childParts = parts ? [...parts, ent.name] : null;
                if (!spec.include(ent, childParts)) continue;
                const fp = path.join(absPath, ent.name);
                if (ent.isDirectory()) dirs.push([fp, childParts]);
                else if (ent.isFile()) files.push(fp);
                await this._tick();
            }
        } catch (_) { /* partial listing: keep what was read */ }

        let total = 0;
        const sizes = await mapWithConcurrency(files, this.statConcurrency, async (fp) => {
            await this._tick();
            try {
                return (await fs.promises.stat(fp)).size;
            } catch (_) {
                return 0;
            }
        });
        for (const s of sizes) total += s;

        for (const [fp, childParts] of dirs) {
            const childKey = spec.key(fp);
            const cached = this._entries.get(childKey);
            if (cached && Date.now() - cached.at < this.ttlMs) {
                total += cached.bytes;
            } else {
                total += await this._walk(fp, childParts, spec);
            }
        }
        return total;
    }
}

const HASH_SLICE_BYTES = 4 * 1024 * 1024;

/**
 * md5 hex of a buffer, hashed in 4 MB slices with a yield between slices so a
 * 100 MB upload does not hold the event loop for the whole digest.
 */
async function md5HexAsync(buffer) {
    const crypto = require('crypto');
    const hash = crypto.createHash('md5');
    if (!buffer || buffer.length <= HASH_SLICE_BYTES) {
        return hash.update(buffer || Buffer.alloc(0)).digest('hex');
    }
    for (let i = 0; i < buffer.length; i += HASH_SLICE_BYTES) {
        hash.update(buffer.subarray(i, Math.min(buffer.length, i + HASH_SLICE_BYTES)));
        await yieldToLoop();
    }
    return hash.digest('hex');
}

/**
 * Write `buffer` to `filePath` unless the file already exists (content-addressed blobs).
 * Same outcome as `if (!existsSync(p)) writeFileSync(p, buffer)`, without sync calls.
 */
async function writeFileIfMissing(filePath, buffer) {
    try {
        await fs.promises.writeFile(filePath, buffer, { flag: 'wx' });
        return true;
    } catch (err) {
        if (err && err.code === 'EEXIST') return false;
        throw err;
    }
}

module.exports = {
    md5HexAsync,
    writeFileIfMissing,
    mapWithConcurrency,
    statNamesInDir,
    DirSizeCache,
    yieldToLoop
};
