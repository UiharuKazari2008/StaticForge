/**
 * Master separation bundle — clone matrix, tar output, maintenance-wrapped.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const {
    DEFAULT_CLONE_PROFILE,
    REPLICATION_TAR_ENTRIES,
    isReplicationTransferMode
} = require('./replication/replicationContracts');
const manifestBuilder = require('./replication/manifestBuilder');
const replicationMaintenance = require('./replicationMaintenance');
const replicationAssetRegistry = require('./replicationAssetRegistry');

const SEPARATION_PREFIX = 'dreamscape-separation';
const SEPARATION_CLONE_KEYS = Object.freeze([
    'workspaceImages',
    'previewCache',
    'imageMetadata',
    'referenceBlobs',
    'vfsUserFiles',
    'wikiData',
    'wikiMedia',
    'autoComplete'
]);

let globalResourcesRef = null;
const activeJobs = new Map();

function initialize(globalResources) {
    globalResourcesRef = globalResources;
}

function getRoot() {
    if (globalResourcesRef) return globalResourcesRef.getPath('root');
    return path.resolve(__dirname, '..');
}

function normalizeCloneProfile(raw) {
    const profile = {
        ...DEFAULT_CLONE_PROFILE,
        referenceBlobs: false,
        vfsUserFiles: false,
        ...(raw && typeof raw === 'object' ? raw : {})
    };

    if (profile.previewCache && !profile.workspaceImages) {
        profile.imageMetadata = true;
    }

    for (const key of SEPARATION_CLONE_KEYS) {
        if (typeof profile[key] !== 'boolean') {
            profile[key] = DEFAULT_CLONE_PROFILE[key] === true
                || (key === 'referenceBlobs' || key === 'vfsUserFiles' ? false : profile[key] === true);
        }
    }

    return profile;
}

function listWorkspaceFilenames(root) {
    const workspaceFile = path.join(root, '.cache', 'workspace.json');
    if (!fs.existsSync(workspaceFile)) return [];
    try {
        const data = JSON.parse(fs.readFileSync(workspaceFile, 'utf8'));
        const filenames = new Set();
        for (const ws of Object.values(data.workspaces || data)) {
            if (!ws || typeof ws !== 'object') continue;
            for (const bucket of ['files', 'scraps', 'pinned']) {
                const list = ws[bucket];
                if (Array.isArray(list)) {
                    for (const name of list) filenames.add(name);
                }
            }
        }
        return Array.from(filenames);
    } catch (_err) {
        return [];
    }
}

function collectBasePaths(root) {
    const paths = [];
    const configFiles = [
        'config.json',
        'prompt.config.json',
        'director.config.json',
        'characters.json',
        'nax_generation_config.json',
        'dataset_tag_groups.json'
    ];
    for (const file of configFiles) {
        if (fs.existsSync(path.join(root, file))) paths.push(file);
    }

    const cacheFiles = [
        '.cache/workspace.json',
        '.cache/workspace-desktop.json',
        '.cache/favorites.json',
        '.cache/reference_metadata.db',
        '.cache/vfs.db',
        '.cache/replication_changelog.db'
    ];
    for (const file of cacheFiles) {
        if (fs.existsSync(path.join(root, file))) paths.push(file);
    }

    return paths;
}

function collectOptionalPaths(root, cloneProfile) {
    const paths = [];

    if (cloneProfile.workspaceImages && fs.existsSync(path.join(root, 'images'))) {
        paths.push('images');
    }

    if (cloneProfile.previewCache) {
        if (fs.existsSync(path.join(root, '.previews'))) paths.push('.previews');
        if (fs.existsSync(path.join(root, '.cache', 'preview'))) {
            paths.push('.cache/preview');
        }
    }

    if (cloneProfile.imageMetadata && fs.existsSync(path.join(root, '.cache', 'metadata.db'))) {
        paths.push('.cache/metadata.db');
    }

    if (cloneProfile.referenceBlobs) {
        if (fs.existsSync(path.join(root, '.cache', 'upload'))) paths.push('.cache/upload');
        if (fs.existsSync(path.join(root, '.cache', 'vibe'))) paths.push('.cache/vibe');
    }

    if (cloneProfile.vfsUserFiles && fs.existsSync(path.join(root, '.cache', 'userFiles'))) {
        paths.push('.cache/userFiles');
    }

    if (cloneProfile.wikiData) {
        const wikiDb = path.join(root, '.cache', 'tag_wiki.db');
        if (fs.existsSync(wikiDb)) paths.push('.cache/tag_wiki.db');
        if (fs.existsSync(path.join(root, '.cache', 'wiki'))) paths.push('.cache/wiki');
    }

    if (cloneProfile.wikiMedia) {
        const naxImages = path.join(root, '.cache', 'nax_images');
        if (fs.existsSync(naxImages)) paths.push('.cache/nax_images');
    }

    if (cloneProfile.autoComplete) {
        const autoFiles = [
            '.cache/tag_search.db',
            'dataset_tags.json',
            'dataset_tags_furry.json',
            'dataset_tag_groups.json',
            '.cache/tag_cache.json',
            '.cache/anime_search_index.json',
            '.cache/furry_search_index.json'
        ];
        for (const file of autoFiles) {
            if (fs.existsSync(path.join(root, file))) paths.push(file);
        }
    }

    return paths;
}

function buildSecureChildReplicationBlock(masterSecure, options) {
    const replication = masterSecure && masterSecure.replication
        ? { ...masterSecure.replication }
        : {};
    const childToken = crypto.randomBytes(32).toString('hex');
    const childInstanceId = options.childInstanceId || crypto.randomUUID();

    return {
        role: 'child',
        connectivity: options.connectivity || 'normal',
        instanceId: childInstanceId,
        displayName: options.childDisplayName || 'child-node',
        pairedAt: new Date().toISOString(),
        separationManifestId: options.manifestId,
        masterAccessUrl: options.masterAccessUrl || replication.masterAccessUrl || null,
        masterWsUrl: options.masterWsUrl || replication.masterWsUrl || null,
        masterPeerHost: options.masterPeerHost || replication.masterPeerHost || null,
        masterPeerPort: options.masterPeerPort || replication.masterPeerPort || null,
        replicationToken: childToken,
        cloneProfile: normalizeCloneProfile(options.cloneProfile),
        transferMode: options.transferMode || replication.transferMode || 'tape-stream-compressed',
        gallerySharedDefault: replication.gallerySharedDefault || 'manual',
        children: [],
        lastAppliedRemoteLsn: {}
    };
}

function buildChildSecureConfig(masterSecure, options) {
    const childSecure = JSON.parse(JSON.stringify(masterSecure || {}));
    delete childSecure.sessionSecret;
    delete childSecure.apiKeys;
    childSecure.replication = buildSecureChildReplicationBlock(masterSecure, options);
    return childSecure;
}

function runTarZst(root, relativePaths, archivePath, tarPrefix) {
    return new Promise((resolve, reject) => {
        const transform = `s,^,${tarPrefix}/,`;
        const tarArgs = ['-C', root, '--transform', transform, '-cf', '-', ...relativePaths];
        const tar = spawn('tar', tarArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
        const zstdArgs = ['-19', '--long=31', '-T0', '-o', archivePath];
        const zstd = spawn('zstd', zstdArgs, { stdio: ['pipe', 'inherit', 'pipe'] });

        let tarErr = '';
        let zstdErr = '';
        tar.stderr.on('data', (chunk) => { tarErr += chunk.toString(); });
        zstd.stderr.on('data', (chunk) => { zstdErr += chunk.toString(); });

        tar.stdout.pipe(zstd.stdin);
        tar.on('error', reject);
        zstd.on('error', reject);

        tar.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(`tar failed (${code}): ${tarErr}`));
            }
        });

        zstd.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(`zstd failed (${code}): ${zstdErr}`));
                return;
            }
            resolve(archivePath);
        });
    });
}

function runTarUncompressed(root, relativePaths, archivePath, tarPrefix) {
    return new Promise((resolve, reject) => {
        const transform = `s,^,${tarPrefix}/,`;
        const args = ['-C', root, '--transform', transform, '-cf', archivePath, ...relativePaths];
        const tar = spawn('tar', args, { stdio: ['ignore', 'inherit', 'pipe'] });
        let err = '';
        tar.stderr.on('data', (chunk) => { err += chunk.toString(); });
        tar.on('error', reject);
        tar.on('close', (code) => {
            if (code !== 0) reject(new Error(`tar failed (${code}): ${err}`));
            else resolve(archivePath);
        });
    });
}

async function createArchive(root, relativePaths, outputBase, transferMode, manifestJsonPath) {
    const tarPrefix = SEPARATION_PREFIX;
    const pathsWithManifest = [...relativePaths];
    const manifestRel = '_replication_manifest.json';
    const stagingManifest = path.join(root, manifestRel);
    fs.copyFileSync(manifestJsonPath, stagingManifest);
    pathsWithManifest.push(manifestRel);

    let archivePath;
    if (transferMode === 'tape-stream') {
        archivePath = `${outputBase}.tar`;
        await runTarUncompressed(root, pathsWithManifest, archivePath, tarPrefix);
    } else {
        archivePath = `${outputBase}.tar.zst`;
        await runTarZst(root, pathsWithManifest, archivePath, tarPrefix);
    }

    if (fs.existsSync(stagingManifest)) fs.unlinkSync(stagingManifest);
    return archivePath;
}

function broadcastProgress(phase, current, total, detail) {
    if (!globalResourcesRef) return;
    let wsServer;
    try {
        wsServer = globalResourcesRef.getWebSocketServer();
    } catch (_e) {
        return;
    }
    if (!wsServer || typeof wsServer.broadcastToAll !== 'function') return;
    wsServer.broadcastToAll({
        type: 'replication_progress',
        data: { phase, current, total, path: detail || null },
        timestamp: new Date().toISOString()
    });
}

async function createSeparationBundle(options = {}) {
    const root = options.root || getRoot();
    const cloneProfile = normalizeCloneProfile(options.cloneProfile);
    const transferMode = isReplicationTransferMode(options.transferMode)
        ? options.transferMode
        : 'tape-stream-compressed';

    const manifestId = options.manifestId || crypto.randomUUID();
    const childInstanceId = options.childInstanceId || crypto.randomUUID();
    const outputDir = options.outputDir || root;
    const outputBase = path.join(outputDir, `${SEPARATION_PREFIX}-${childInstanceId}`);

    let masterSecure = {};
    const securePath = path.join(root, 'secure.config.json');
    if (fs.existsSync(securePath)) {
        masterSecure = JSON.parse(fs.readFileSync(securePath, 'utf8'));
    }

    const masterReplication = masterSecure.replication || {};
    const childReplication = buildSecureChildReplicationBlock(masterSecure, {
        ...options,
        manifestId,
        childInstanceId,
        cloneProfile,
        transferMode
    });

    const maintenanceState = options.skipMaintenance
        ? null
        : replicationMaintenance.enterMaintenance({
            operation: 'separation',
            partnerInstanceId: childInstanceId,
            reason: 'Preparing separation bundle — writes disabled',
            transferMode
        });

    try {
        broadcastProgress('separation', 0, 4, 'collecting paths');

        const relativePaths = [
            ...collectBasePaths(root),
            ...collectOptionalPaths(root, cloneProfile)
        ];

        const childSecure = buildChildSecureConfig(masterSecure, {
            ...options,
            manifestId,
            childInstanceId,
            cloneProfile,
            transferMode
        });
        const childSecureStaging = path.join(root, '.cache', `_separation_secure_${manifestId}.json`);
        fs.writeFileSync(childSecureStaging, JSON.stringify(childSecure, null, 2));
        relativePaths.push(path.relative(root, childSecureStaging).split(path.sep).join('/'));

        const entries = await manifestBuilder.collectPathsAsync(root, relativePaths);
        const manifest = manifestBuilder.buildSeparationManifest({
            manifestId,
            instanceId: masterReplication.instanceId,
            masterInstanceId: masterReplication.instanceId,
            displayName: masterReplication.displayName,
            childInstanceId,
            childDisplayName: options.childDisplayName || childReplication.displayName,
            cloneProfile,
            transferMode,
            replicationToken: childReplication.replicationToken,
            masterAccessUrl: childReplication.masterAccessUrl,
            masterWsUrl: childReplication.masterWsUrl,
            masterPeerHost: childReplication.masterPeerHost,
            masterPeerPort: childReplication.masterPeerPort,
            entries,
            archiveName: path.basename(`${outputBase}.tar${transferMode === 'tape-stream' ? '' : '.zst'}`)
        });

        const sidecarManifestPath = `${outputBase}.manifest.json`;
        manifestBuilder.writeManifestFile(sidecarManifestPath, manifest);

        broadcastProgress('separation', 2, 4, 'creating archive');
        const archivePath = await createArchive(root, relativePaths, outputBase, transferMode, sidecarManifestPath);

        if (fs.existsSync(childSecureStaging)) fs.unlinkSync(childSecureStaging);

        broadcastProgress('separation', 4, 4, 'complete');

        if (replicationAssetRegistry.isInitialized()) {
            await replicationAssetRegistry.seedFromManifest(manifest);
        }

        return {
            manifestId,
            childInstanceId,
            manifest,
            manifestPath: sidecarManifestPath,
            archivePath,
            replicationToken: childReplication.replicationToken,
            cloneProfile,
            transferMode
        };
    } finally {
        if (maintenanceState && !maintenanceState.alreadyActive) {
            replicationMaintenance.exitMaintenance({ reason: 'Separation bundle sealed' });
        }
    }
}

function extractArchive(archivePath, destRoot) {
    return new Promise((resolve, reject) => {
        const isZst = archivePath.endsWith('.zst');
        if (isZst) {
            const zstd = spawn('zstd', ['-d', '-c', archivePath], { stdio: ['ignore', 'pipe', 'pipe'] });
            const tar = spawn('tar', ['-xf', '-', '-C', destRoot], { stdio: ['pipe', 'inherit', 'pipe'] });
            let err = '';
            zstd.stderr.on('data', (c) => { err += c.toString(); });
            tar.stderr.on('data', (c) => { err += c.toString(); });
            zstd.stdout.pipe(tar.stdin);
            zstd.on('error', reject);
            tar.on('error', reject);
            tar.on('close', (code) => {
                if (code !== 0) reject(new Error(`extract failed: ${err}`));
                else resolve();
            });
        } else {
            const tar = spawn('tar', ['-xf', archivePath, '-C', destRoot], { stdio: ['ignore', 'inherit', 'pipe'] });
            let err = '';
            tar.stderr.on('data', (c) => { err += c.toString(); });
            tar.on('error', reject);
            tar.on('close', (code) => {
                if (code !== 0) reject(new Error(`extract failed: ${err}`));
                else resolve();
            });
        }
    });
}

function findExtractedSecureConfig(root) {
    const cacheDir = path.join(root, '.cache');
    if (!fs.existsSync(cacheDir)) return null;
    const candidates = fs.readdirSync(cacheDir)
        .filter((name) => name.startsWith('_separation_secure_') && name.endsWith('.json'));
    if (candidates.length === 0) {
        const nested = path.join(root, SEPARATION_PREFIX, '.cache');
        if (fs.existsSync(nested)) {
            const nestedCandidates = fs.readdirSync(nested)
                .filter((name) => name.startsWith('_separation_secure_') && name.endsWith('.json'));
            if (nestedCandidates.length > 0) {
                return path.join(nested, nestedCandidates[0]);
            }
        }
        return null;
    }
    return path.join(cacheDir, candidates[candidates.length - 1]);
}

async function previewBootstrap({ manifestPath, archivePath }) {
    const manifest = manifestBuilder.readManifestFile(manifestPath);
    return {
        manifestId: manifest.manifestId,
        childInstanceId: manifest.childInstanceId,
        childDisplayName: manifest.childDisplayName,
        cloneProfile: manifest.cloneProfile,
        transferMode: manifest.transferMode,
        entryCount: manifest.entryCount,
        totalBytes: manifest.totalBytes,
        archivePath: archivePath || null,
        requiresTokenConfirm: true
    };
}

async function applySeparationBundle({ manifestPath, archivePath, confirmToken, root: rootOverride, manifestObject, archiveBuffer, archiveName }) {
    const root = rootOverride || getRoot();
    let resolvedManifestPath = manifestPath;
    let resolvedArchivePath = archivePath;
    let cleanupPaths = [];

    if (manifestObject && !resolvedManifestPath) {
        const tempDir = path.join(root, '.cache', 'separation_upload');
        fs.mkdirSync(tempDir, { recursive: true });
        resolvedManifestPath = path.join(tempDir, `${manifestObject.manifestId || 'manifest'}.manifest.json`);
        fs.writeFileSync(resolvedManifestPath, JSON.stringify(manifestObject, null, 2));
        cleanupPaths.push(resolvedManifestPath);
    }

    if (archiveBuffer && !resolvedArchivePath) {
        const tempDir = path.join(root, '.cache', 'separation_upload');
        fs.mkdirSync(tempDir, { recursive: true });
        resolvedArchivePath = path.join(tempDir, archiveName || 'bundle.tar.zst');
        fs.writeFileSync(resolvedArchivePath, archiveBuffer);
        cleanupPaths.push(resolvedArchivePath);
    }

    const manifest = manifestObject || manifestBuilder.readManifestFile(resolvedManifestPath);

    if (!confirmToken || confirmToken !== manifest.replicationToken) {
        throw new Error('Invalid bootstrap confirmation token');
    }

    const maintenanceState = replicationMaintenance.enterMaintenance({
        operation: 'separation-bootstrap',
        partnerInstanceId: manifest.masterInstanceId,
        reason: 'Applying separation bundle — writes disabled',
        transferMode: manifest.transferMode
    });

    try {
        broadcastProgress('bootstrap', 0, 3, 'extracting');
        await extractArchive(resolvedArchivePath, root);

        broadcastProgress('bootstrap', 2, 3, 'verifying');
        const verify = await manifestBuilder.verifyManifestEntriesAsync(root, manifest, { tarPrefix: SEPARATION_PREFIX });
        if (!verify.ok) {
            throw new Error(
                `Manifest verification failed: ${verify.missing.length} missing, ${verify.checksumMismatch.length} checksum mismatch`
            );
        }

        const stagedSecure = findExtractedSecureConfig(root);
        if (stagedSecure && fs.existsSync(stagedSecure)) {
            const childSecure = JSON.parse(fs.readFileSync(stagedSecure, 'utf8'));
            fs.writeFileSync(path.join(root, 'secure.config.json'), JSON.stringify(childSecure, null, 2));
            fs.unlinkSync(stagedSecure);
        }

        if (replicationAssetRegistry.isInitialized()) {
            await replicationAssetRegistry.seedFromManifest(manifest);
        }

        broadcastProgress('bootstrap', 3, 3, 'complete');

        return {
            success: true,
            manifestId: manifest.manifestId,
            childInstanceId: manifest.childInstanceId,
            cloneProfile: manifest.cloneProfile
        };
    } finally {
        if (!maintenanceState.alreadyActive) {
            replicationMaintenance.exitMaintenance({ reason: 'Separation bootstrap complete' });
        }
        for (const p of cleanupPaths) {
            try {
                if (fs.existsSync(p)) fs.unlinkSync(p);
            } catch (_e) { /* ignore */ }
        }
    }
}

function startSeparationJob(options) {
    const jobId = crypto.randomUUID();
    const job = {
        id: jobId,
        status: 'running',
        phase: 'starting',
        progress: { current: 0, total: 4 },
        result: null,
        error: null,
        startedAt: new Date().toISOString(),
        finishedAt: null
    };
    activeJobs.set(jobId, job);

    createSeparationBundle(options)
        .then((result) => {
            job.status = 'complete';
            job.result = result;
            job.finishedAt = new Date().toISOString();
            job.phase = 'complete';
        })
        .catch((error) => {
            job.status = 'error';
            job.error = error.message || String(error);
            job.finishedAt = new Date().toISOString();
            job.phase = 'error';
        });

    return jobId;
}

function getSeparationJob(jobId) {
    return activeJobs.get(jobId) || null;
}

function getBundlePathsForManifest(manifestId) {
    const root = getRoot();
    const matches = fs.readdirSync(root)
        .filter((name) => name.includes(manifestId) || name.includes(`separation-${manifestId}`));
    const manifestPath = path.join(root, `${SEPARATION_PREFIX}-${manifestId}.manifest.json`);
    const altManifest = matches.find((n) => n.endsWith('.manifest.json'));
    return {
        manifestPath: fs.existsSync(manifestPath) ? manifestPath : (altManifest ? path.join(root, altManifest) : null),
        archiveCandidates: matches.filter((n) => n.endsWith('.tar') || n.endsWith('.tar.zst'))
    };
}

module.exports = {
    SEPARATION_PREFIX,
    SEPARATION_CLONE_KEYS,
    initialize,
    normalizeCloneProfile,
    collectBasePaths,
    collectOptionalPaths,
    createSeparationBundle,
    previewBootstrap,
    applySeparationBundle,
    startSeparationJob,
    getSeparationJob,
    getBundlePathsForManifest,
    buildSecureChildReplicationBlock
};
