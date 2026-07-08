/**
 * Separation / cargo manifest builder — inventory, checksums, cloneProfile, tokens.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { REPLICATION_TAR_ENTRIES } = require('./replicationContracts');

function sha256File(filePath) {
    const st = fs.statSync(filePath);
    const hash = crypto.createHash('sha256');
    if (st.size > 64 * 1024 * 1024) {
        return sha256FileStream(filePath);
    }
    hash.update(fs.readFileSync(filePath));
    return hash.digest('hex');
}

function sha256FileStream(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(filePath);
        stream.on('data', (chunk) => hash.update(chunk));
        stream.on('error', reject);
        stream.on('end', () => resolve(hash.digest('hex')));
    });
}

async function walkFilesAsync(root, relPath, entries, { prefix = '' } = {}) {
    const full = path.join(root, relPath);
    if (!fs.existsSync(full)) return;
    const st = fs.statSync(full);
    if (st.isDirectory()) {
        for (const name of fs.readdirSync(full)) {
            await walkFilesAsync(root, path.join(relPath, name), entries, { prefix });
        }
    } else {
        const normalized = relPath.split(path.sep).join('/');
        const archivePath = prefix ? `${prefix}/${normalized}` : normalized;
        const digest = st.size > 64 * 1024 * 1024
            ? await sha256FileStream(full)
            : sha256File(full);
        entries.push({
            path: archivePath,
            relPath: normalized,
            bytes: st.size,
            sha256: digest
        });
    }
}

function walkFiles(root, relPath, entries, { prefix = '' } = {}) {
    const full = path.join(root, relPath);
    if (!fs.existsSync(full)) return;
    const st = fs.statSync(full);
    if (st.isDirectory()) {
        for (const name of fs.readdirSync(full)) {
            walkFiles(root, path.join(relPath, name), entries, { prefix });
        }
    } else {
        const normalized = relPath.split(path.sep).join('/');
        const archivePath = prefix ? `${prefix}/${normalized}` : normalized;
        entries.push({
            path: archivePath,
            relPath: normalized,
            bytes: st.size,
            sha256: null
        });
    }
}

async function collectPathsAsync(root, relativePaths) {
    const entries = [];
    for (const rel of relativePaths) {
        await walkFilesAsync(root, rel, entries);
    }
    entries.sort((a, b) => a.path.localeCompare(b.path));
    return entries;
}

function collectPaths(root, relativePaths) {
    const entries = [];
    for (const rel of relativePaths) {
        walkFiles(root, rel, entries);
    }
    entries.sort((a, b) => a.path.localeCompare(b.path));
    return entries;
}

function buildSeparationManifest({
    manifestId,
    instanceId,
    masterInstanceId,
    displayName,
    childInstanceId,
    childDisplayName,
    cloneProfile,
    transferMode,
    replicationToken,
    masterAccessUrl,
    masterWsUrl,
    masterPeerHost,
    masterPeerPort,
    entries,
    archiveName,
    format = 1
}) {
    const totalBytes = entries.reduce((sum, e) => sum + (e.bytes || 0), 0);
    const manifestChecksum = crypto.createHash('sha256');
    const inventoryForHash = entries.map((e) => `${e.path}:${e.sha256}:${e.bytes}`).join('\n');
    manifestChecksum.update(inventoryForHash);

    return {
        format,
        type: 'separation',
        manifestId,
        created: new Date().toISOString(),
        instanceId: masterInstanceId || instanceId,
        masterInstanceId: masterInstanceId || instanceId,
        displayName: displayName || '',
        childInstanceId,
        childDisplayName: childDisplayName || '',
        cloneProfile: { ...cloneProfile },
        transferMode,
        replicationToken,
        masterAccessUrl: masterAccessUrl || null,
        masterWsUrl: masterWsUrl || null,
        masterPeerHost: masterPeerHost || null,
        masterPeerPort: masterPeerPort || null,
        archiveName,
        tarManifestEntry: REPLICATION_TAR_ENTRIES.MANIFEST,
        entries,
        totalBytes,
        inventorySha256: manifestChecksum.digest('hex'),
        entryCount: entries.length
    };
}

function writeManifestFile(manifestPath, manifest) {
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    return manifestPath;
}

function readManifestFile(manifestPath) {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

function verifyManifestEntries(root, manifest, { tarPrefix = '' } = {}) {
    return verifyManifestEntriesAsync(root, manifest, { tarPrefix });
}

async function verifyManifestEntriesAsync(root, manifest, { tarPrefix = '' } = {}) {
    const missing = [];
    const checksumMismatch = [];

    for (const entry of manifest.entries || []) {
        let rel = entry.relPath || entry.path;
        if (tarPrefix && rel.startsWith(`${tarPrefix}/`)) {
            rel = rel.slice(tarPrefix.length + 1);
        } else if (rel.startsWith('dreamscape-separation/')) {
            rel = rel.replace(/^dreamscape-separation\//, '');
        }
        const full = path.join(root, rel);
        if (!fs.existsSync(full)) {
            missing.push(rel);
            continue;
        }
        if (entry.sha256) {
            let actual = sha256File(full);
            if (actual && typeof actual.then === 'function') {
                actual = await actual;
            }
            if (actual !== entry.sha256) {
                checksumMismatch.push({ path: rel, expected: entry.sha256, actual });
            }
        }
    }

    return {
        ok: missing.length === 0 && checksumMismatch.length === 0,
        missing,
        checksumMismatch
    };
}

module.exports = {
    sha256File,
    sha256FileStream,
    walkFiles,
    walkFilesAsync,
    collectPaths,
    collectPathsAsync,
    buildSeparationManifest,
    writeManifestFile,
    readManifestFile,
    verifyManifestEntries,
    verifyManifestEntriesAsync
};
