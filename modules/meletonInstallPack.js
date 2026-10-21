/**
 * MeletonFX install pack: one highly compressed zip of the service-worker manifest,
 * written when cache data is recreated (web_server initializeCacheData). The installer
 * downloads this single stream instead of one request per file.
 *
 * Text and markup are deflated at level 9. Bytes that are already compressed (images,
 * fonts, audio) are stored as-is so the pack does not spend CPU growing them.
 * The agent bundle (modules/agentAssetBundle.js) stays a separate lazy zip.
 *
 * public/scripts/launch/updateEngine.js (manifestHashMaterial, fileGroup)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { Worker, isMainThread } = require('worker_threads');
const { Zip, ZipDeflate, ZipPassThrough, strToU8 } = require('fflate');
const updateEngine = require('../public/scripts/launch/updateEngine');

const PACK_NAME = 'pack.zip';
const META_NAME = 'pack-meta.json';
const ZIP_LEVEL = 9;
const STORE_EXT = new Set([
    'webp', 'png', 'jpg', 'jpeg', 'gif', 'avif', 'ico',
    'woff', 'woff2', 'ttf', 'otf', 'eot',
    'mp3', 'ogg', 'wav', 'mp4', 'webm',
    'zip', 'gz', 'br', 'wasm'
]);

let outputDir = null;
let building = false;
let ready = null;

function init(options = {}) {
    if (options.outputDir) outputDir = options.outputDir;
    ready = readMeta();
}

function directory() {
    return outputDir;
}

function zipPath() {
    return path.join(outputDir, PACK_NAME);
}

function metaPath() {
    return path.join(outputDir, META_NAME);
}

function hashManifest(files) {
    return crypto.createHash('sha256').update(updateEngine.manifestHashMaterial(files)).digest('hex');
}

function extensionOf(url) {
    const clean = String(url || '').split('?')[0];
    const dot = clean.lastIndexOf('.');
    if (dot < 0) return '';
    return clean.slice(dot + 1).toLowerCase();
}

function readMeta() {
    if (!outputDir) return null;
    try {
        const meta = JSON.parse(fs.readFileSync(metaPath(), 'utf8'));
        if (!meta || !meta.hash || !Number.isFinite(meta.bytes)) return null;
        if (!fs.existsSync(zipPath())) return null;
        return meta;
    } catch (_) {
        return null;
    }
}

function status() {
    return {
        ready: !building && !!ready,
        building,
        hash: ready ? ready.hash : null,
        bytes: ready ? ready.bytes : 0,
        count: ready ? ready.count : 0,
        path: ready ? zipPath() : null
    };
}

function yieldTick() {
    return new Promise((resolve) => setImmediate(resolve));
}

// Level-9 deflate of ~2800 files is seconds of CPU. Run on the main thread it held
// the event loop per file (up to ~100ms each), at boot and on every runtime rebuild
// or subset pack (client update). writeZipSync runs in a worker thread instead.
function writeZipSync(tmpZip, listing, progress) {
    const fd = fs.openSync(tmpZip, 'w');
    let bytes = 0;
    let failure = null;
    let done = false;
    try {
        const zip = new Zip();
        zip.ondata = (err, chunk, final) => {
            if (err) {
                failure = failure || err;
                return;
            }
            if (chunk && chunk.length) {
                fs.writeSync(fd, chunk);
                bytes += chunk.length;
            }
            if (final) done = true;
        };
        const metaEntry = new ZipDeflate('pack.json', { level: ZIP_LEVEL });
        zip.add(metaEntry);
        metaEntry.push(strToU8(JSON.stringify({
            hash: listing.hash,
            files: listing.files.map((file) => ({
                entry: file.entry,
                url: file.url,
                hash: file.hash,
                size: file.size,
                group: file.group
            }))
        })), true);
        let written = 0;
        for (const file of listing.files) {
            if (failure) break;
            const payload = new Uint8Array(fs.readFileSync(file.diskPath));
            const entry = STORE_EXT.has(extensionOf(file.entry))
                ? new ZipPassThrough(file.entry)
                : new ZipDeflate(file.entry, { level: ZIP_LEVEL });
            zip.add(entry);
            entry.push(payload, true);
            written += 1;
            if (progress && (written === listing.files.length || written % 400 === 0)) progress(written, listing.files.length);
        }
        if (!failure) zip.end();
    } finally {
        fs.closeSync(fd);
    }
    if (failure) throw failure;
    if (!done) throw new Error('meletonInstallPack: zip did not finish');
    return bytes;
}

function writeZip(tmpZip, listing, log) {
    return new Promise((resolve, reject) => {
        let worker;
        try {
            worker = new Worker(__filename, { workerData: { tmpZip, listing } });
        } catch (error) {
            // No worker threads: build here, as before.
            try {
                resolve(writeZipSync(tmpZip, listing, log));
            } catch (syncError) {
                reject(syncError);
            }
            return;
        }
        let settled = false;
        worker.on('message', (message) => {
            if (!message) return;
            if (message.type === 'progress') {
                if (log) log(message.written, message.total);
            } else if (message.type === 'done') {
                settled = true;
                resolve(message.bytes);
            } else if (message.type === 'error') {
                settled = true;
                reject(new Error(message.message));
            }
        });
        worker.on('error', (error) => {
            if (settled) return;
            settled = true;
            reject(error);
        });
        worker.on('exit', (code) => {
            if (settled) return;
            settled = true;
            reject(new Error(`meletonInstallPack: zip worker exited with code ${code}`));
        });
    });
}

async function collectListing(manifest, resolveFile) {
    const files = [];
    const seen = new Set();
    let skipped = 0;
    const unresolved = [];
    for (const file of manifest) {
        if (!file || !file.url || !file.hash) {
            skipped += 1;
            continue;
        }
        const diskPath = resolveFile ? resolveFile(file) : null;
        if (!diskPath) {
            skipped += 1;
            unresolved.push(file.url);
            continue;
        }
        const entry = updateEngine.zipEntryName(file.url);
        if (seen.has(entry)) {
            skipped += 1;
            continue;
        }
        seen.add(entry);
        files.push({
            entry,
            url: file.url,
            hash: file.hash,
            size: Number(file.size) || 0,
            group: updateEngine.fileGroup(file),
            diskPath
        });
        if (files.length % 200 === 0) await yieldTick();
    }
    return { files, skipped, unresolved };
}

// A pack whose rows did not resolve to a file is reused only while they still do not.
// Otherwise the same manifest kept serving a pack without them (#512: a server that
// could not map the new icon sizes yet built it, and every later boot reused it).
function unresolvedNowResolve(current, manifest, resolveFile) {
    // Meta written before this list existed: a pack that skipped rows is rebuilt once
    if (current && Number(current.skipped) > 0 && !Array.isArray(current.unresolved)) return true;
    const urls = current && Array.isArray(current.unresolved) ? current.unresolved : [];
    if (!urls.length || !resolveFile) return false;
    const wanted = new Set(urls);
    for (const file of manifest) {
        if (file && wanted.has(file.url) && resolveFile(file)) return true;
    }
    return false;
}

/**
 * Zip only the requested manifest rows. Does not replace the full pack on disk.
 * Returns { hash, bytes, count, path, cleanup }.
 */
async function buildSubset(options = {}) {
    const manifest = Array.isArray(options.manifest) ? options.manifest : [];
    const hash = hashManifest(manifest);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meleton-subset-'));
    const dest = path.join(dir, PACK_NAME);
    const { files } = await collectListing(manifest, options.resolveFile);
    const bytes = await writeZip(dest, { hash, files }, options.log);
    return {
        hash,
        bytes,
        count: files.length,
        path: dest,
        cleanup() {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    };
}

/**
 * Build the pack when the manifest hash changed. resolveFile(file) → absolute path or null.
 * Returns { rebuilt, hash, bytes, count, skipped }.
 */
async function rebuild(options = {}) {
    const dir = options.outputDir || outputDir;
    if (!dir) throw new Error('meletonInstallPack: outputDir is required');
    outputDir = dir;
    const manifest = Array.isArray(options.manifest) ? options.manifest : [];
    const hash = hashManifest(manifest);
    const current = !options.force && readMeta();
    if (current && current.hash === hash && !unresolvedNowResolve(current, manifest, options.resolveFile)) {
        ready = current;
        return { rebuilt: false, hash, bytes: current.bytes, count: current.count, skipped: 0 };
    }

    building = true;
    ready = null;
    fs.mkdirSync(dir, { recursive: true });
    const { files, skipped, unresolved } = await collectListing(manifest, options.resolveFile);

    const tmpZip = path.join(dir, `${PACK_NAME}.tmp`);
    try {
        const bytes = await writeZip(tmpZip, { hash, files }, options.log);
        fs.renameSync(tmpZip, zipPath());
        const meta = {
            hash,
            bytes,
            count: files.length,
            skipped,
            unresolved,
            builtAt: Date.now()
        };
        fs.writeFileSync(metaPath(), JSON.stringify(meta));
        ready = meta;
        return { rebuilt: true, hash, bytes, count: files.length, skipped };
    } catch (error) {
        try { fs.unlinkSync(tmpZip); } catch (_) { /* no partial */ }
        ready = readMeta();
        throw error;
    } finally {
        building = false;
    }
}

if (!isMainThread) {
    const { parentPort, workerData } = require('worker_threads');
    if (workerData && workerData.tmpZip) {
        try {
            const bytes = writeZipSync(workerData.tmpZip, workerData.listing, (written, total) => {
                parentPort.postMessage({ type: 'progress', written, total });
            });
            parentPort.postMessage({ type: 'done', bytes });
        } catch (error) {
            parentPort.postMessage({ type: 'error', message: error && error.message ? error.message : String(error) });
        }
    }
}

module.exports = {
    init,
    rebuild,
    buildSubset,
    status,
    hashManifest,
    directory,
    ZIP_LEVEL,
    STORE_EXT
};
