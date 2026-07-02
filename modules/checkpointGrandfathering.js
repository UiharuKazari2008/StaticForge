/**
 * Tiered checkpoint retention (hour → day → month) with configurable caps.
 * Used by JSONCheckpointManager, DatabaseCheckpointManager, and bundle manifests.
 */

const fs = require('fs');
const path = require('path');

const TIERS = ['hour', 'day', 'month'];
const TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})\.(\d{3})/;

const DEFAULT_GRANDFATHERING = {
    hour: { max: 24, rollover: 'day' },
    day: { max: 7, rollover: 'month' },
    month: { max: 12, rollover: null }
};

let _globalResourcesRef = null;

function setGlobalResourcesRef(globalResources) {
    _globalResourcesRef = globalResources || null;
}

function getCheckpointSettings(globalResources) {
    let cfg = {};
    const gr = globalResources || _globalResourcesRef;
    try {
        if (gr?.getConfig) {
            cfg = gr.getConfig({ path: 'checkpoints', clone: true }) || {};
        }
    } catch {
        cfg = {};
    }
    const grandfathering = { ...DEFAULT_GRANDFATHERING, ...(cfg.grandfathering || {}) };
    return {
        enabled: cfg.enabled !== false,
        grandfathering
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

function applyTierRetention(files, tier, tierConfig, checkpointDir) {
    if (!tierConfig || tierConfig.max == null || tierConfig.max <= 0) return;

    const buckets = new Map();
    for (const file of files) {
        const date = parseFilenameTimestamp(file.basename);
        const key = bucketKeyForTier(date, tier);
        if (!key) continue;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(file);
    }

    for (const bucketFiles of buckets.values()) {
        bucketFiles.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
        if (bucketFiles.length <= tierConfig.max) continue;

        const toRoll = bucketFiles.slice(tierConfig.max);
        toRoll.sort((a, b) => a.mtime.getTime() - b.mtime.getTime());

        for (const file of toRoll) {
            const rollover = tierConfig.rollover;
            if (rollover && TIERS.includes(rollover)) {
                moveCheckpointToTier(file, checkpointDir, rollover);
            } else {
                deleteCheckpointFile(file);
            }
        }
    }
}

function applyGrandfathering(checkpointDir, ext, globalResources, timestampPattern) {
    const settings = getCheckpointSettings(globalResources);
    if (!settings.enabled) return;

    const pattern = timestampPattern || TIMESTAMP_PATTERN;
    migrateLegacyFlatCheckpoints(checkpointDir, ext, pattern);
    ensureTierDirs(checkpointDir);

    const gf = settings.grandfathering;
    for (const tier of TIERS) {
        const tierFiles = listTierCheckpointFiles(checkpointDir, tier, ext, pattern);
        applyTierRetention(tierFiles, tier, gf[tier] || DEFAULT_GRANDFATHERING[tier], checkpointDir);
    }
}

function newCheckpointRelativePath(filename) {
    const base = path.basename(filename);
    return `hour/${base}`;
}

function applyBundleGrandfathering(bundlesDir, globalResources) {
    const settings = getCheckpointSettings(globalResources);
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

    const bucketManifests = (tier) => {
        const map = new Map();
        for (const m of manifests.filter((x) => x.tier === tier)) {
            const key = bucketKeyForTier(m.mtime, tier);
            if (!key) continue;
            if (!map.has(key)) map.set(key, []);
            map.get(key).push(m);
        }
        return map;
    };

    for (const tier of TIERS) {
        const tierConfig = gf[tier] || DEFAULT_GRANDFATHERING[tier];
        if (!tierConfig?.max || tierConfig.max <= 0) continue;
        const buckets = bucketManifests(tier);
        for (const bucketFiles of buckets.values()) {
            bucketFiles.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
            if (bucketFiles.length <= tierConfig.max) continue;
            const toRoll = bucketFiles.slice(tierConfig.max);
            toRoll.sort((a, b) => a.mtime.getTime() - b.mtime.getTime());
            for (const file of toRoll) {
                if (tierConfig.rollover && TIERS.includes(tierConfig.rollover)) {
                    moveCheckpointToTier(file, bundlesDir, tierConfig.rollover);
                    file.tier = tierConfig.rollover;
                } else {
                    deleteCheckpointFile(file);
                }
            }
        }
    }
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
    newCheckpointRelativePath,
    applyBundleGrandfathering,
    resolveBundleManifestPath,
    deleteCheckpointSidecars,
    ensureTierDirs
};
