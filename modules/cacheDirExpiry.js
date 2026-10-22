const fsp = require('fs').promises;
const path = require('path');

const DEFAULT_TRACES_MAX_AGE_DAYS = 14;
const DEFAULT_DYNGEN_PREVIEW_MAX_AGE_DAYS = 7;

function parseDaysEnv(value, fallback) {
    if (value === undefined || value === '') return fallback;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function getTracesMaxAgeMs() {
    const days = parseDaysEnv(process.env.STATICFORGE_TRACES_MAX_AGE_DAYS, DEFAULT_TRACES_MAX_AGE_DAYS);
    return days * 24 * 60 * 60 * 1000;
}

function getDynGenPreviewMaxAgeMs() {
    const days = parseDaysEnv(process.env.STATICFORGE_DYNGEN_PREVIEW_MAX_AGE_DAYS, DEFAULT_DYNGEN_PREVIEW_MAX_AGE_DAYS);
    return days * 24 * 60 * 60 * 1000;
}

/**
 * Remove trace JSON files and matching attachment dirs older than maxAgeMs.
 * Then remove orphan attachment dirs whose mtime is past cutoff and whose sibling .json is missing or also old.
 */
async function expireTracesDir(tracesDir, maxAgeMs) {
    let jsonRemoved = 0;
    let dirsRemoved = 0;

    const cutoff = Date.now() - maxAgeMs;
    let entries;
    try {
        entries = await fsp.readdir(tracesDir, { withFileTypes: true });
    } catch (e) {
        return { jsonRemoved, dirsRemoved };
    }

    for (const ent of entries) {
        if (!ent.isFile() || !ent.name.endsWith('.json')) continue;
        const full = path.join(tracesDir, ent.name);
        let st;
        try {
            st = await fsp.stat(full);
        } catch {
            continue;
        }
        if (st.mtimeMs >= cutoff) continue;
        try {
            await fsp.unlink(full);
            jsonRemoved++;
            const base = ent.name.replace(/\.json$/, '');
            const dirPath = path.join(tracesDir, base);
            const dst = await fsp.stat(dirPath).catch(() => null);
            if (dst && dst.isDirectory()) {
                await fsp.rm(dirPath, { recursive: true, force: true });
                dirsRemoved++;
            }
        } catch {
            // best-effort
        }
    }

    let entries2;
    try {
        entries2 = await fsp.readdir(tracesDir, { withFileTypes: true });
    } catch {
        return { jsonRemoved, dirsRemoved };
    }

    for (const ent of entries2) {
        if (!ent.isDirectory()) continue;
        const full = path.join(tracesDir, ent.name);
        const jsonPath = path.join(tracesDir, `${ent.name}.json`);
        let dirSt;
        try {
            dirSt = await fsp.stat(full);
        } catch {
            continue;
        }
        if (dirSt.mtimeMs >= cutoff) continue;

        let jst = null;
        try {
            jst = await fsp.stat(jsonPath);
        } catch {
            jst = null;
        }
        if (jst) {
            try {
                if (jst.mtimeMs >= cutoff) continue;
                await fsp.unlink(jsonPath);
                jsonRemoved++;
            } catch {
                continue;
            }
        }
        try {
            await fsp.rm(full, { recursive: true, force: true });
            dirsRemoved++;
        } catch {
            // best-effort
        }
    }

    return { jsonRemoved, dirsRemoved };
}

async function expireDynGenPreviewDir(dynGenDir, maxAgeMs) {
    let removed = 0;
    const cutoff = Date.now() - maxAgeMs;
    let names;
    try {
        names = await fsp.readdir(dynGenDir);
    } catch {
        return removed;
    }
    for (const name of names) {
        if (!name.endsWith('.png')) continue;
        const full = path.join(dynGenDir, name);
        let st;
        try {
            st = await fsp.stat(full);
        } catch {
            continue;
        }
        if (!st.isFile() || st.mtimeMs >= cutoff) continue;
        try {
            await fsp.unlink(full);
            removed++;
        } catch {
            // best-effort
        }
    }
    return removed;
}

/**
 * @param {import('./globalResources')} globalResources
 * @returns {Promise<{ tracesJson: number, traceDirs: number, dynGenPng: number }>}
 */
async function runCacheDirExpiry(globalResources) {
    if (process.env.STATICFORGE_CACHE_EXPIRY_DISABLED === '1' || process.env.STATICFORGE_CACHE_EXPIRY_DISABLED === 'true') {
        return { tracesJson: 0, traceDirs: 0, dynGenPng: 0 };
    }

    const cacheDir = globalResources.getPath('cache');
    const tracesDir = path.join(cacheDir, 'traces');
    const dynGenDir = path.join(cacheDir, 'dynGenPreview');

    const { jsonRemoved, dirsRemoved } = await expireTracesDir(tracesDir, getTracesMaxAgeMs());
    const dynGenPng = await expireDynGenPreviewDir(dynGenDir, getDynGenPreviewMaxAgeMs());

    const total = jsonRemoved + dirsRemoved + dynGenPng;
    if (total > 0) {
        const logger = globalResources.logger;
        logger.info(
            `Cache expiry: removed ${jsonRemoved} trace JSON, ${dirsRemoved} trace attachment dirs, ${dynGenPng} dynGenPreview PNGs`
        );
    }

    return { tracesJson: jsonRemoved, traceDirs: dirsRemoved, dynGenPng };
}

/** How often to run expiry while the server is up (6 hours). */
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Delay before first run after boot so startup is not blocked on huge directories. */
const FIRST_RUN_DELAY_MS = 90 * 1000;

module.exports = {
    runCacheDirExpiry,
    expireTracesDir,
    expireDynGenPreviewDir,
    getTracesMaxAgeMs,
    getDynGenPreviewMaxAgeMs,
    DEFAULT_TRACES_MAX_AGE_DAYS,
    DEFAULT_DYNGEN_PREVIEW_MAX_AGE_DAYS,
    CLEANUP_INTERVAL_MS,
    FIRST_RUN_DELAY_MS
};
