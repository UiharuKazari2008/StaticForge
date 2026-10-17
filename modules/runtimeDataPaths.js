// Runtime data that the app writes lives outside the git tree, so merges, checkouts and
// cleans cannot overwrite or delete it.
//
// Data root:  DREAMSCAPE_DATA_DIR env  >  config.json "dataDir"  >  ~/dreamscape-data
// Apocrypha:  APOCRYPHA_DATA_DIR env   >  config.json "apocrypha.dataDir"  >  <data root>/apocrypha
//
// One-time migration: if the legacy in-repo dir (data/apocrypha) exists and the new dir
// does not, the legacy dir is copied over. The legacy copy is never deleted automatically.
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const LEGACY_APOCRYPHA_DIR = path.join(ROOT_DIR, 'data', 'apocrypha');

let cachedConfig = null;
function readConfigFile() {
    if (cachedConfig) return cachedConfig;
    try {
        cachedConfig = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'config.json'), 'utf8')) || {};
    } catch (_) {
        cachedConfig = {};
    }
    return cachedConfig;
}

function expandHome(p) {
    if (typeof p !== 'string' || !p.trim()) return '';
    const s = p.trim();
    if (s === '~' || s.startsWith('~/')) return path.join(os.homedir(), s.slice(1));
    return path.resolve(ROOT_DIR, s);
}

function getDataRoot(env = process.env, config = readConfigFile()) {
    return expandHome(env.DREAMSCAPE_DATA_DIR)
        || expandHome(config && config.dataDir)
        || path.join(os.homedir(), 'dreamscape-data');
}

function resolveApocryphaDir(env = process.env, config = readConfigFile()) {
    return expandHome(env.APOCRYPHA_DATA_DIR)
        || expandHome(config && config.apocrypha && config.apocrypha.dataDir)
        || path.join(getDataRoot(env, config), 'apocrypha');
}

/** Copy legacyDir -> targetDir once (only when target is missing). Returns what happened. */
function migrateDirOnce(legacyDir, targetDir, log = console) {
    if (path.resolve(legacyDir) === path.resolve(targetDir)) return 'same';
    if (fs.existsSync(targetDir)) return 'exists';
    if (!fs.existsSync(legacyDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
        return 'created';
    }
    fs.mkdirSync(path.dirname(targetDir), { recursive: true });
    const tmp = targetDir + '.migrating-' + process.pid;
    fs.cpSync(legacyDir, tmp, { recursive: true, preserveTimestamps: true });
    fs.renameSync(tmp, targetDir);
    if (log && log.log) log.log(`[runtimeData] copied ${legacyDir} -> ${targetDir} (legacy copy kept)`);
    return 'migrated';
}

let apocryphaDir = null;
function getApocryphaDir() {
    if (apocryphaDir) return apocryphaDir;
    const dir = resolveApocryphaDir();
    try {
        migrateDirOnce(LEGACY_APOCRYPHA_DIR, dir);
    } catch (e) {
        console.error('[runtimeData] apocrypha migration failed:', e.message);
    }
    apocryphaDir = dir;
    return dir;
}

module.exports = {
    LEGACY_APOCRYPHA_DIR,
    getDataRoot,
    resolveApocryphaDir,
    migrateDirOnce,
    getApocryphaDir
};
