/**
 * Tiered checkpoint retention (hour → day → month) with configurable caps.
 * Used by JSONCheckpointManager, DatabaseCheckpointManager, and bundle manifests.
 */

const fs = require('fs');
const path = require('path');

const TIERS = ['hour', 'day', 'month'];
const TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})\.(\d{3})/;

const DEFAULT_GRANDFATHERING = {
    hour: { max: 4, rollover: null, perBucketMax: 1 },
    day: { max: 0, rollover: null, perBucketMax: 1 },
    month: { max: 0, rollover: null, perBucketMax: 1 }
};

const CHECKPOINT_FILE_EXT_PATTERN = /^(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.\d{3})(\..+)$/;

let _globalResourcesRef = null;

function setGlobalResourcesRef(globalResources) {
    _globalResourcesRef = globalResources || null;
}

function mergeGrandfatheringConfig(base, patch) {
    const result = { ...base };
    if (!patch) return result;
    for (const tier of TIERS) {
        if (patch[tier]) {
            result[tier] = { ...(result[tier] || DEFAULT_GRANDFATHERING[tier]), ...patch[tier] };
        }
    }
    return result;
}

function getCheckpointSettings(globalResources, resourceKey = null) {
    let cfg = {};
    const gr = globalResources || _globalResourcesRef;
    try {
        if (gr?.getConfig) {
            cfg = gr.getConfig({ path: 'checkpoints', clone: true }) || {};
        }
    } catch {
        cfg = {};
    }
    let grandfathering = mergeGrandfatheringConfig(DEFAULT_GRANDFATHERING, cfg.grandfathering);
    if (resourceKey && cfg.overrides?.[resourceKey]) {
        grandfathering = mergeGrandfatheringConfig(grandfathering, cfg.overrides[resourceKey]);
    }
    return {
        enabled: cfg.enabled !== false,
        grandfathering,
        resourceKey: resourceKey || null
    };
}

function isGrandfatheringEnabled(globalResources) {
    return getCheckpointSettings(globalResources).enabled;
}

function tierDir(checkpointDir, tier) {
    return path.join(checkpointDir, tier);
}

function parseFilenameTimestamp(filename) {
    const base = path.basename(filename);
    const match = base.match(TIMESTAMP_PATTERN);
    if (!match) return null;
    const [, y, mo, d, h, mi, s, ms] = match;
    return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}.${ms}`);
}

function bucketKeyForTier(date, tier) {
    if (!date || Number.isNaN(date.getTime())) return null;
    const y = date.getFullYear();
    const mo = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    if (tier === 'hour') return `${y}${mo}${d}${h}`;
    if (tier === 'day') return `${y}${mo}${d}`;
    if (tier === 'month') return `${y}${mo}`;
    return null;
}

function splitCheckpointRef(filename) {
    if (!filename || typeof filename !== 'string') {
        return { tier: 'hour', basename: filename };
    }
    const normalized = filename.replace(/\\/g, '/');
    const parts = normalized.split('/');
    if (parts.length >= 2 && TIERS.includes(parts[0])) {
        return { tier: parts[0], basename: parts.slice(1).join('/') };
    }
    return { tier: null, basename: normalized };
}

function resolveCheckpointFilePath(checkpointDir, filename) {
    if (!filename) return null;
    const { tier, basename } = splitCheckpointRef(filename);
    if (tier) {
        const tierPath = path.join(checkpointDir, tier, basename);
        if (fs.existsSync(tierPath)) return tierPath;
    }
    for (const t of TIERS) {
        const p = path.join(checkpointDir, t, basename);
        if (fs.existsSync(p)) return p;
    }
    const legacy = path.join(checkpointDir, basename);
    if (fs.existsSync(legacy)) return legacy;
    return tier ? path.join(checkpointDir, tier, basename) : legacy;
}

function ensureTierDirs(checkpointDir) {
    for (const tier of TIERS) {
        const dir = tierDir(checkpointDir, tier);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }
}

function migrateLegacyFlatCheckpoints(checkpointDir, ext, timestampPattern) {
    if (!fs.existsSync(checkpointDir)) return;
    ensureTierDirs(checkpointDir);
    const hourDest = tierDir(checkpointDir, 'hour');
    let entries;
    try {
        entries = fs.readdirSync(checkpointDir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const ent of entries) {
        if (!ent.isFile()) continue;
        if (ent.name.startsWith('branch_')) continue;
        if (ext && !ent.name.endsWith(ext)) continue;
        if (!timestampPattern.test(ent.name)) continue;
        const src = path.join(checkpointDir, ent.name);
        const dest = path.join(hourDest, ent.name);
        if (fs.existsSync(dest)) continue;
        try {
            fs.renameSync(src, dest);
            for (const suffix of ['-wal', '-shm']) {
                const sideSrc = src + suffix;
                if (fs.existsSync(sideSrc)) {
                    fs.renameSync(sideSrc, dest + suffix);
                }
            }
        } catch (err) {
            console.warn(`⚠️ Could not migrate legacy checkpoint ${ent.name}:`, err.message);
        }
    }
}

function listTierCheckpointFiles(checkpointDir, tier, ext, timestampPattern) {
    const dir = tierDir(checkpointDir, tier);
    if (!fs.existsSync(dir)) return [];
    const files = [];
    for (const name of fs.readdirSync(dir)) {
        if (name.startsWith('branch_')) continue;
        if (ext && !name.endsWith(ext)) continue;
        if (!timestampPattern.test(name)) continue;
        const filePath = path.join(dir, name);
        try {
            const stats = fs.statSync(filePath);
            files.push({
                filename: `${tier}/${name}`,
                basename: name,
                tier,
                filePath,
                mtime: stats.mtime,
                size: stats.size
            });
        } catch {
            // skip unreadable
        }
    }
    return files;
}

function listAllCheckpointFiles(checkpointDir, ext, timestampPattern) {
    migrateLegacyFlatCheckpoints(checkpointDir, ext, timestampPattern);
    const all = [];
    for (const tier of TIERS) {
        all.push(...listTierCheckpointFiles(checkpointDir, tier, ext, timestampPattern));
    }
    all.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    return all;
}

function deleteCheckpointSidecars(filePath) {
    for (const suffix of ['-wal', '-shm']) {
        const side = filePath + suffix;
        if (fs.existsSync(side)) {
            try {
                fs.unlinkSync(side);
            } catch {
                // ignore
            }
        }
    }
}

function moveCheckpointToTier(fileEntry, checkpointDir, destTier) {
    ensureTierDirs(checkpointDir);
    const destDir = tierDir(checkpointDir, destTier);
    const destPath = path.join(destDir, fileEntry.basename);
    if (fs.existsSync(destPath)) {
        try {
            fs.unlinkSync(destPath);
            deleteCheckpointSidecars(destPath);
        } catch {
            return false;
        }
    }
    try {
        fs.renameSync(fileEntry.filePath, destPath);
        for (const suffix of ['-wal', '-shm']) {
            const sideSrc = fileEntry.filePath + suffix;
            if (fs.existsSync(sideSrc)) {
                fs.renameSync(sideSrc, destPath + suffix);
            }
        }
        return true;
    } catch (err) {
        console.warn(`⚠️ Could not roll checkpoint to ${destTier}:`, err.message);
        return false;
    }
}

function deleteCheckpointFile(fileEntry) {
    try {
        if (fs.existsSync(fileEntry.filePath)) {
            fs.unlinkSync(fileEntry.filePath);
        }
        deleteCheckpointSidecars(fileEntry.filePath);
        return true;
    } catch (err) {
        console.warn(`⚠️ Could not delete checkpoint ${fileEntry.basename}:`, err.message);
        return false;
    }
}

function getFileBucketDate(file) {
    const fromName = parseFilenameTimestamp(file.basename);
    if (fromName && !Number.isNaN(fromName.getTime())) return fromName;
    if (file.mtime && !Number.isNaN(file.mtime.getTime())) return file.mtime;
    return null;
}

function rollOrDeleteCheckpoint(file, tierConfig, checkpointDir) {
    const rollover = tierConfig.rollover;
    if (rollover && TIERS.includes(rollover)) {
        moveCheckpointToTier(file, checkpointDir, rollover);
    } else {
        deleteCheckpointFile(file);
    }
}

/**
 * Apply retention for one tier.
 * max = number of time buckets to keep at this tier (e.g. 4 recent hours).
 * perBucketMax = newest snapshots kept within the same bucket (default 1).
 */
function applyTierRetention(files, tier, tierConfig, checkpointDir) {
    if (!tierConfig || tierConfig.max == null || tierConfig.max <= 0) return;

    const perBucketMax = Math.max(1, tierConfig.perBucketMax ?? 1);
    const buckets = new Map();
    for (const file of files) {
        const date = getFileBucketDate(file);
        const key = bucketKeyForTier(date, tier);
        if (!key) continue;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(file);
    }

    const bucketReps = [];
    for (const bucketFiles of buckets.values()) {
        bucketFiles.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
        const kept = bucketFiles.slice(0, perBucketMax);
        const excess = bucketFiles.slice(perBucketMax);
        for (const file of excess) {
            rollOrDeleteCheckpoint(file, tierConfig, checkpointDir);
        }
        if (kept.length > 0) {
            bucketReps.push(kept[0]);
        }
    }

    if (bucketReps.length <= tierConfig.max) return;

    bucketReps.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    const toRoll = bucketReps.slice(tierConfig.max);
    toRoll.sort((a, b) => a.mtime.getTime() - b.mtime.getTime());
    for (const file of toRoll) {
        rollOrDeleteCheckpoint(file, tierConfig, checkpointDir);
    }
}

function purgeTierCheckpoints(checkpointDir, tier, ext, timestampPattern) {
    const files = listTierCheckpointFiles(checkpointDir, tier, ext, timestampPattern);
    for (const file of files) {
        deleteCheckpointFile(file);
    }
}

function applyGrandfathering(checkpointDir, ext, globalResources, timestampPattern, resourceKey = null) {
    const settings = getCheckpointSettings(globalResources, resourceKey);
    if (!settings.enabled) return;

    const pattern = timestampPattern || TIMESTAMP_PATTERN;
    migrateLegacyFlatCheckpoints(checkpointDir, ext, pattern);
    ensureTierDirs(checkpointDir);

    const gf = settings.grandfathering;
    for (const tier of TIERS) {
        const tierConfig = gf[tier] || DEFAULT_GRANDFATHERING[tier];
        if (!tierConfig || tierConfig.max == null || tierConfig.max <= 0) {
            purgeTierCheckpoints(checkpointDir, tier, ext, pattern);
            continue;
        }
        const tierFiles = listTierCheckpointFiles(checkpointDir, tier, ext, pattern);
        applyTierRetention(tierFiles, tier, tierConfig, checkpointDir);
    }
}

function newCheckpointRelativePath(filename) {
    const base = path.basename(filename);
    return `hour/${base}`;
}

function applyBundleGrandfathering(bundlesDir, globalResources) {
    const settings = getCheckpointSettings(globalResources, 'bundles');
    if (!settings.enabled || !fs.existsSync(bundlesDir)) return;

    ensureTierDirs(bundlesDir);

    // Migrate UUID manifest files from bundles root → hour/
    const hourDir = tierDir(bundlesDir, 'hour');
    for (const name of fs.readdirSync(bundlesDir)) {
        if (!/^[a-f0-9-]{36}\.json$/i.test(name)) continue;
        const src = path.join(bundlesDir, name);
        if (!fs.statSync(src).isFile()) continue;
        const dest = path.join(hourDir, name);
        if (!fs.existsSync(dest)) {
            try {
                fs.renameSync(src, dest);
            } catch {
                // ignore
            }
        }
    }

    const gf = settings.grandfathering;

    const loadBundleManifests = () => {
        const manifests = [];
        for (const tier of TIERS) {
            const dir = tierDir(bundlesDir, tier);
            if (!fs.existsSync(dir)) continue;
            for (const name of fs.readdirSync(dir)) {
                if (!/^[a-f0-9-]{36}\.json$/i.test(name)) continue;
                const filePath = path.join(dir, name);
                let createdAt = null;
                try {
                    const raw = fs.readFileSync(filePath, 'utf8');
                    const data = JSON.parse(raw);
                    createdAt = data.createdAt ? new Date(data.createdAt) : fs.statSync(filePath).mtime;
                } catch {
                    createdAt = fs.statSync(filePath).mtime;
                }
                manifests.push({
                    filename: `${tier}/${name}`,
                    basename: name,
                    tier,
                    filePath,
                    mtime: createdAt,
                    size: fs.statSync(filePath).size
                });
            }
        }
        return manifests;
    };

    for (const tier of TIERS) {
        const tierFiles = loadBundleManifests().filter((m) => m.tier === tier);
        applyTierRetention(tierFiles, tier, gf[tier] || DEFAULT_GRANDFATHERING[tier], bundlesDir);
    }
}

function detectCheckpointExt(checkpointDir) {
    const tryDir = (dir) => {
        if (!fs.existsSync(dir)) return null;
        for (const name of fs.readdirSync(dir)) {
            if (name.startsWith('branch_')) continue;
            const match = name.match(CHECKPOINT_FILE_EXT_PATTERN);
            if (match) return match[2];
        }
        return null;
    };

    for (const tier of TIERS) {
        const ext = tryDir(tierDir(checkpointDir, tier));
        if (ext) return ext;
    }
    return tryDir(checkpointDir);
}

function cleanupLegacyFlatDatabaseCheckpoints(checkpointDir, dbName, dbExt, globalResources = null, resourceKey = null) {
    if (!fs.existsSync(checkpointDir) || !dbName || !dbExt) return;

    let hasTiered = false;
    for (const tier of TIERS) {
        const dir = tierDir(checkpointDir, tier);
        if (!fs.existsSync(dir)) continue;
        if (fs.readdirSync(dir).some((n) => TIMESTAMP_PATTERN.test(n))) {
            hasTiered = true;
            break;
        }
    }

    const escapedName = dbName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedExt = dbExt.replace('.', '\\.');
    const legacyPattern = new RegExp(`^${escapedName}_checkpoint_.+${escapedExt}$`);
    const legacyFiles = [];

    for (const name of fs.readdirSync(checkpointDir)) {
        if (!legacyPattern.test(name)) continue;
        const filePath = path.join(checkpointDir, name);
        try {
            const stats = fs.statSync(filePath);
            legacyFiles.push({ name, filePath, mtime: stats.mtime });
        } catch {
            // skip unreadable
        }
    }
    if (legacyFiles.length === 0) return;

    if (hasTiered) {
        for (const file of legacyFiles) {
            try {
                fs.unlinkSync(file.filePath);
                deleteCheckpointSidecars(file.filePath);
                console.log(`🗑️ Removed legacy flat checkpoint: ${file.name}`);
            } catch (err) {
                console.warn(`⚠️ Could not remove legacy checkpoint ${file.name}:`, err.message);
            }
        }
        return;
    }

    const settings = getCheckpointSettings(globalResources, resourceKey || dbName);
    const maxKeep = settings.grandfathering?.hour?.max ?? DEFAULT_GRANDFATHERING.hour.max;
    if (legacyFiles.length <= maxKeep) return;

    legacyFiles.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    for (const file of legacyFiles.slice(maxKeep)) {
        try {
            fs.unlinkSync(file.filePath);
            deleteCheckpointSidecars(file.filePath);
            console.log(`🗑️ Removed legacy flat checkpoint: ${file.name}`);
        } catch (err) {
            console.warn(`⚠️ Could not remove legacy checkpoint ${file.name}:`, err.message);
        }
    }
}

/**
 * Run tiered retention across every resource under .cache/checkpoints/ (boot + repair).
 */
function reconcileAllCheckpointRetention(globalResources) {
    const settings = getCheckpointSettings(globalResources);
    if (!settings.enabled) return { dirs: 0 };

    const gr = globalResources || _globalResourcesRef;
    let cacheRoot;
    try {
        cacheRoot = gr?.getPath?.('cache') || path.join(__dirname, '..', '.cache');
    } catch {
        cacheRoot = path.join(__dirname, '..', '.cache');
    }

    const checkpointsRoot = path.join(cacheRoot, 'checkpoints');
    if (!fs.existsSync(checkpointsRoot)) return { dirs: 0 };

    const { removeOrphanCheckpointSidecars } = require('./checkpointPaths');
    const isoStyle = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.\d{3}\./;
    let dirs = 0;

    for (const name of fs.readdirSync(checkpointsRoot)) {
        const dir = path.join(checkpointsRoot, name);
        let stat;
        try {
            stat = fs.statSync(dir);
        } catch {
            continue;
        }
        if (!stat.isDirectory()) continue;

        if (name === 'bundles') {
            applyBundleGrandfathering(dir, globalResources);
            dirs++;
            continue;
        }

        const ext = detectCheckpointExt(dir);
        if (!ext) continue;

        applyGrandfathering(dir, ext, globalResources, isoStyle, name);
        if (ext === '.db') {
            cleanupLegacyFlatDatabaseCheckpoints(dir, name, ext, globalResources, name);
        }
        removeOrphanCheckpointSidecars(dir);
        for (const tier of TIERS) {
            removeOrphanCheckpointSidecars(tierDir(dir, tier));
        }
        dirs++;
    }

    return { dirs };
}

function resolveBundleManifestPath(bundlesDir, id) {
    if (!id) return null;
    for (const tier of TIERS) {
        const p = path.join(bundlesDir, tier, `${id}.json`);
        if (fs.existsSync(p)) return p;
    }
    const legacy = path.join(bundlesDir, `${id}.json`);
    if (fs.existsSync(legacy)) return legacy;
    return path.join(bundlesDir, 'hour', `${id}.json`);
}

module.exports = {
    TIERS,
    TIMESTAMP_PATTERN,
    DEFAULT_GRANDFATHERING,
    setGlobalResourcesRef,
    getCheckpointSettings,
    mergeGrandfatheringConfig,
    isGrandfatheringEnabled,
    tierDir,
    parseFilenameTimestamp,
    bucketKeyForTier,
    splitCheckpointRef,
    resolveCheckpointFilePath,
    migrateLegacyFlatCheckpoints,
    listAllCheckpointFiles,
    listTierCheckpointFiles,
    applyGrandfathering,
    purgeTierCheckpoints,
    applyTierRetention,
    rollOrDeleteCheckpoint,
    newCheckpointRelativePath,
    applyBundleGrandfathering,
    reconcileAllCheckpointRetention,
    detectCheckpointExt,
    cleanupLegacyFlatDatabaseCheckpoints,
    resolveBundleManifestPath,
    deleteCheckpointSidecars,
    ensureTierDirs
};
