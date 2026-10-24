/**
 * Resize public/static_images/app_icons masters into .cache/runtime-assets on source hash change.
 * modules/runtimeAssetCompiler.js
 * modules/runtimeAssetService.js
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');

const APP_ICONS_WEB_ROOT = '/static_images/app_icons';
const APP_ICONS_PUBLIC_REL = 'static_images/app_icons';
const SOURCES_META_NAME = '_sources.json';

/**
 * Display sizes used across desktop shell / explorer / chrome, with a 2x for each:
 * 16 / 24 / 32 / 48 px icons (tray, captions, taskbar, start menu, desktop) get 1x and 2x
 * files, so srcset never has to fall back to the 192 / 384 px versions.
 * Keep in step with APP_ICON_SRCSET_SIZES in public/scripts/comp/modalUtils.js.
 */
const ICON_SIZES = [16, 24, 32, 48, 64, 96, 128, 192, 384];
/** Canonical URL (no size segment) serves this size. */
const DEFAULT_SIZE = 384;

const SOURCE_HASH_ALGO = 'sha256';

/**
 * Other large bitmaps shown small, compiled into the same sizes and URL scheme:
 * served name → source under public/. logo_icon.png is 731 px and is drawn at 18-80 px
 * (start button, logon, title bars).
 */
const EXTRA_MASTERS = {
    'dreamscape-logo.png': 'static_images/logo_icon.png'
};

function getPublicIconsDir(projectRoot) {
    return path.join(projectRoot, 'public', APP_ICONS_PUBLIC_REL);
}

function getOutputIconsDir(projectRoot) {
    return path.join(projectRoot, '.cache', 'runtime-assets', APP_ICONS_PUBLIC_REL);
}

function getSourcesMetaPath(projectRoot) {
    return path.join(getOutputIconsDir(projectRoot), SOURCES_META_NAME);
}

function hashBuffer(buf) {
    return crypto.createHash(SOURCE_HASH_ALGO).update(buf).digest('hex');
}

/**
 * A Vista icon's own small frames (its 16 / 24 / 32 / 48 px images are drawn apart, not scaled):
 * app_icons/frames/<stem>/<size>.png is used as-is for that size; other sizes scale the master.
 */
function iconFrames(projectRoot, filename) {
    const dir = path.join(getPublicIconsDir(projectRoot), 'frames', String(filename).replace(/\.png$/i, ''));
    const frames = {};
    let names = [];
    try { names = fs.readdirSync(dir); } catch (_err) { return frames; }
    names.forEach((name) => {
        const m = /^(\d+)\.png$/i.exec(name);
        if (m && ICON_SIZES.includes(Number(m[1]))) frames[Number(m[1])] = fs.readFileSync(path.join(dir, name));
    });
    return frames;
}

/** The master's hash, with its frames folded in so a changed frame recompiles. */
function iconSourceHash(projectRoot, filename, sourceBuf) {
    const frames = iconFrames(projectRoot, filename);
    const sizes = Object.keys(frames).map(Number).sort((a, b) => a - b);
    if (!sizes.length) return hashBuffer(sourceBuf);
    const h = crypto.createHash(SOURCE_HASH_ALGO).update(sourceBuf);
    sizes.forEach((size) => h.update(`|${size}|`).update(frames[size]));
    return h.digest('hex');
}

function isAppIconWebPath(webPath) {
    const normalized = (webPath || '').split('?')[0];
    return normalized === APP_ICONS_WEB_ROOT
        || normalized.startsWith(`${APP_ICONS_WEB_ROOT}/`);
}

function isAppIconsMasterRelPath(relFromPublic) {
    const normalized = (relFromPublic || '').replace(/\\/g, '/').replace(/^\//, '');
    return normalized === APP_ICONS_PUBLIC_REL
        || normalized.startsWith(`${APP_ICONS_PUBLIC_REL}/`);
}

function parseAppIconWebPath(webPath) {
    if (!isAppIconWebPath(webPath)) {
        return null;
    }
    const rel = webPath.split('?')[0].slice(APP_ICONS_WEB_ROOT.length).replace(/^\//, '');
    if (!rel || rel === SOURCES_META_NAME) {
        return null;
    }
    const parts = rel.split('/');
    if (parts.length === 1) {
        return { filename: parts[0], size: DEFAULT_SIZE, isDefault: true };
    }
    if (parts.length === 2) {
        const size = Number(parts[0]);
        if (!ICON_SIZES.includes(size)) {
            return null;
        }
        return { filename: parts[1], size, isDefault: false };
    }
    return null;
}

function readSourcesMeta(projectRoot) {
    const metaPath = getSourcesMetaPath(projectRoot);
    if (!fs.existsSync(metaPath)) {
        return {};
    }
    try {
        return JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    } catch (_err) {
        return {};
    }
}

function writeSourcesMeta(projectRoot, meta) {
    const outDir = getOutputIconsDir(projectRoot);
    fs.mkdirSync(outDir, { recursive: true });
    const metaPath = getSourcesMetaPath(projectRoot);
    const tmp = `${metaPath}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, metaPath);
}

function atomicWriteBinary(filePath, buffer) {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${filePath}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, buffer);
    fs.renameSync(tmp, filePath);
}

function iconStem(filename) {
    return String(filename || '').replace(/\.(png|webp)$/i, '');
}

function masterPngName(filename) {
    return `${iconStem(filename)}.png`;
}

function masterSourcePath(projectRoot, filename) {
    const name = masterPngName(filename);
    if (Object.prototype.hasOwnProperty.call(EXTRA_MASTERS, name)) {
        return path.join(projectRoot, 'public', EXTRA_MASTERS[name]);
    }
    return path.join(getPublicIconsDir(projectRoot), name);
}

function listMasterIcons(projectRoot) {
    const dir = getPublicIconsDir(projectRoot);
    const names = fs.existsSync(dir)
        ? fs.readdirSync(dir).filter((name) => /\.png$/i.test(name) && !name.startsWith('.'))
        : [];
    Object.keys(EXTRA_MASTERS).forEach((name) => {
        if (!names.includes(name) && fs.existsSync(masterSourcePath(projectRoot, name))) {
            names.push(name);
        }
    });
    return names.sort();
}

function outputPathFor(projectRoot, filename, size, isDefault) {
    const root = getOutputIconsDir(projectRoot);
    if (isDefault) {
        return path.join(root, filename);
    }
    return path.join(root, String(size), filename);
}

function webPathFor(filename, size, isDefault) {
    if (isDefault) {
        return `${APP_ICONS_WEB_ROOT}/${filename}`;
    }
    return `${APP_ICONS_WEB_ROOT}/${size}/${filename}`;
}

function servedNamesForMaster(filename) {
    const stem = iconStem(filename);
    return [`${stem}.png`, `${stem}.webp`];
}

function outputsExistForIcon(projectRoot, filename) {
    for (const name of servedNamesForMaster(filename)) {
        if (!fs.existsSync(outputPathFor(projectRoot, name, DEFAULT_SIZE, true))) {
            return false;
        }
        for (const size of ICON_SIZES) {
            if (!fs.existsSync(outputPathFor(projectRoot, name, size, false))) {
                return false;
            }
        }
    }
    return true;
}

async function compileOneIcon(projectRoot, filename, sourceBuf, sourceHash, options = {}) {
    const outRoot = getOutputIconsDir(projectRoot);
    fs.mkdirSync(outRoot, { recursive: true });

    let sourceBytes = sourceBuf.length;
    let outputBytes = 0;

    const stem = iconStem(filename);
    const frames = iconFrames(projectRoot, filename);
    for (const size of ICON_SIZES) {
        const png = frames[size] ? await sharp(frames[size]).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer() : await sharp(sourceBuf)
            .resize(size, size, {
                fit: 'contain',
                background: { r: 0, g: 0, b: 0, alpha: 0 },
                kernel: sharp.kernel.lanczos3
            })
            .png({ compressionLevel: 9, adaptiveFiltering: true })
            .toBuffer();
        // Re-encode the resized PNG. Same canvas; do not resize again.
        const webp = await sharp(png).webp({ lossless: true, effort: 6, alphaQuality: 100 }).toBuffer();

        atomicWriteBinary(outputPathFor(projectRoot, `${stem}.png`, size, false), png);
        atomicWriteBinary(outputPathFor(projectRoot, `${stem}.webp`, size, false), webp);
        outputBytes += png.length + webp.length;

        if (size === DEFAULT_SIZE) {
            atomicWriteBinary(outputPathFor(projectRoot, `${stem}.png`, size, true), png);
            atomicWriteBinary(outputPathFor(projectRoot, `${stem}.webp`, size, true), webp);
            outputBytes += png.length + webp.length;
        }
    }

    if (options.force !== true) {
        // no-op; force only skips the hash short-circuit upstream
    }

    return {
        status: 'compiled',
        filename,
        sourceHash,
        sourceBytes,
        outputBytes
    };
}

async function compileAppIcons(projectRoot, options = {}) {
    const force = options.force === true;
    const masters = listMasterIcons(projectRoot);
    const meta = readSourcesMeta(projectRoot);
    const nextMeta = {};
    let compiled = 0;
    let skipped = 0;
    const errors = [];
    const stats = {
        totalFiles: masters.length,
        compiledFiles: 0,
        sourceBytes: 0,
        outputBytes: 0,
        bytesSaved: 0,
        percentBytesSaved: 0
    };

    for (const filename of masters) {
        try {
            const abs = masterSourcePath(projectRoot, filename);
            const sourceBuf = fs.readFileSync(abs);
            const sourceHash = iconSourceHash(projectRoot, filename, sourceBuf);
            nextMeta[filename] = {
                sourceHash,
                sizes: ICON_SIZES.slice(),
                defaultSize: DEFAULT_SIZE
            };

            const prev = meta[filename];
            if (!force && prev && prev.sourceHash === sourceHash && outputsExistForIcon(projectRoot, filename)) {
                skipped++;
                continue;
            }

            const result = await compileOneIcon(projectRoot, filename, sourceBuf, sourceHash, { force });
            compiled++;
            stats.compiledFiles++;
            stats.sourceBytes += result.sourceBytes;
            stats.outputBytes += result.outputBytes;
        } catch (err) {
            errors.push({ file: path.relative(projectRoot, masterSourcePath(projectRoot, filename)), error: err.message });
            if (meta[filename]) {
                nextMeta[filename] = meta[filename];
            }
        }
    }

    // Drop outputs for removed masters
    for (const filename of Object.keys(meta)) {
        if (nextMeta[filename]) {
            continue;
        }
        try {
            for (const name of servedNamesForMaster(filename)) {
                const defaultPath = outputPathFor(projectRoot, name, DEFAULT_SIZE, true);
                if (fs.existsSync(defaultPath)) {
                    fs.unlinkSync(defaultPath);
                }
                for (const size of ICON_SIZES) {
                    const sized = outputPathFor(projectRoot, name, size, false);
                    if (fs.existsSync(sized)) {
                        fs.unlinkSync(sized);
                    }
                }
            }
        } catch (_err) {
            // best-effort cleanup
        }
    }

    writeSourcesMeta(projectRoot, nextMeta);

    stats.bytesSaved = Math.max(0, stats.sourceBytes - stats.outputBytes);
    stats.percentBytesSaved = stats.sourceBytes > 0
        ? Math.round((stats.bytesSaved / stats.sourceBytes) * 1000) / 10
        : 0;

    return {
        compiled,
        skipped,
        errors,
        stats,
        sizes: ICON_SIZES.slice(),
        defaultSize: DEFAULT_SIZE
    };
}

function resolveServedAppIconPath(projectRoot, webPath, debugMode) {
    const parsed = parseAppIconWebPath(webPath);
    if (!parsed) {
        return null;
    }
    if (debugMode && parsed.isDefault && /\.png$/i.test(parsed.filename)) {
        const master = masterSourcePath(projectRoot, parsed.filename);
        if (fs.existsSync(master)) {
            return master;
        }
    }
    const compiled = outputPathFor(projectRoot, parsed.filename, parsed.size, parsed.isDefault);
    if (fs.existsSync(compiled)) {
        return compiled;
    }
    if (parsed.isDefault && /\.png$/i.test(parsed.filename)) {
        const master = masterSourcePath(projectRoot, parsed.filename);
        if (fs.existsSync(master)) {
            return master;
        }
    }
    return null;
}

function listOptimisedAppIconManifestEntries(projectRoot) {
    const outDir = getOutputIconsDir(projectRoot);
    const entries = [];
    if (!fs.existsSync(outDir)) {
        return entries;
    }

    function walk(dir, relPrefix) {
        let items;
        try {
            items = fs.readdirSync(dir);
        } catch (_err) {
            return;
        }
        for (const item of items) {
            if (item === SOURCES_META_NAME || item.startsWith('.') || item.endsWith('.tmp')) {
                continue;
            }
            const abs = path.join(dir, item);
            let stats;
            try {
                stats = fs.statSync(abs);
            } catch (_err) {
                continue;
            }
            const rel = relPrefix ? `${relPrefix}/${item}` : item;
            if (stats.isDirectory()) {
                walk(abs, rel);
                continue;
            }
            if (!/\.webp$/i.test(item)) {
                continue;
            }
            const webPath = `${APP_ICONS_WEB_ROOT}/${rel}`;
            const hash = hashBuffer(fs.readFileSync(abs));
            entries.push({
                path: webPath,
                hash,
                size: stats.size,
                modified: stats.mtime.getTime()
            });
        }
    }

    walk(outDir, '');
    entries.sort((a, b) => a.path.localeCompare(b.path));
    return entries;
}

async function ensureCompiledForRequest(projectRoot, webPath) {
    const parsed = parseAppIconWebPath(webPath);
    if (!parsed) {
        return { changed: false };
    }
    const masterName = masterPngName(parsed.filename);
    const abs = masterSourcePath(projectRoot, masterName);
    if (!fs.existsSync(abs)) {
        return { changed: false };
    }
    const sourceBuf = fs.readFileSync(abs);
    const sourceHash = iconSourceHash(projectRoot, masterName, sourceBuf);
    const meta = readSourcesMeta(projectRoot);
    const prev = meta[masterName];
    if (prev && prev.sourceHash === sourceHash && outputsExistForIcon(projectRoot, masterName)) {
        return { changed: false };
    }
    await compileOneIcon(projectRoot, masterName, sourceBuf, sourceHash, {});
    meta[masterName] = {
        sourceHash,
        sizes: ICON_SIZES.slice(),
        defaultSize: DEFAULT_SIZE
    };
    writeSourcesMeta(projectRoot, meta);
    return { changed: true, rel: path.relative(projectRoot, abs) };
}

module.exports = {
    APP_ICONS_WEB_ROOT,
    APP_ICONS_PUBLIC_REL,
    ICON_SIZES,
    DEFAULT_SIZE,
    EXTRA_MASTERS,
    isAppIconWebPath,
    isAppIconsMasterRelPath,
    parseAppIconWebPath,
    compileAppIcons,
    resolveServedAppIconPath,
    listOptimisedAppIconManifestEntries,
    ensureCompiledForRequest,
    getPublicIconsDir,
    getOutputIconsDir
};
