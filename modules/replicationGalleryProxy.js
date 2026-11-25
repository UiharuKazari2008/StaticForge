/**
 * Merge remote master gallery file lists into local gallery index.
 */

const replicationRemoteFetch = require('./replicationRemoteFetch');
const { canGalleryUseRemoteMaster } = require('./replication/replicationContracts');
const pictureIds = require('./pictureIds');

// The picture's base (#1156): a legacy `_upscaled` name or a linked upscale ID resolves to its original's stem. A remote
// ID whose link this server has not seen is its own base.
function getBaseName(filename) {
    return pictureIds.baseOf(String(filename || ''));
}

async function fetchRemoteGalleryFilenames(globalResources, { workspaceId, viewType } = {}) {
    const config = globalResources.getReplicationService().getReplicationConfig();
    if (!canGalleryUseRemoteMaster(config)) {
        return [];
    }
    const reachable = await replicationRemoteFetch.probeMasterReachable(false, globalResources);
    if (!reachable) {
        return [];
    }

    const params = new URLSearchParams({
        workspaceId: workspaceId || 'default',
        viewType: viewType || 'images'
    });
    const base = (config.masterAccessUrl || '').replace(/\/$/, '');
    const token = config.replicationReadToken || config.replicationToken || '';
    const headers = {
        'User-Agent': 'StaticForge-Replication/1.0',
        ...(token ? { 'X-Replication-Token': token } : {})
    };
    const url = `${base}/replication/gallery/workspace-files?${params.toString()}`;
    const { buffer } = await replicationRemoteFetch.httpRequestBuffer(url, { headers, timeoutMs: 8000 });
    let json;
    try {
        json = JSON.parse(buffer.toString('utf8'));
    } catch (_err) {
        return [];
    }
    if (json.success === false) {
        return [];
    }
    return Array.isArray(json.data?.files) ? json.data.files : [];
}

function mergeRemoteGalleryBaseArray(localBaseArray, remoteFilenames, localFilenameSet) {
    const merged = [...localBaseArray];
    const seenBases = new Set(localBaseArray.map((item) => item.base));
    const now = Date.now();

    for (const filename of remoteFilenames) {
        if (!filename || localFilenameSet.has(filename)) continue;
        const base = getBaseName(filename);
        if (seenBases.has(base)) continue;
        seenBases.add(base);
        const isUpscale = pictureIds.isUpscale(filename);
        const entry = {
            base,
            original: isUpscale ? null : filename,
            upscaled: isUpscale ? filename : null,
            mtime: now,
            remoteOnly: true
        };
        if (!entry.original && !entry.upscaled) {
            entry.original = filename;
        }
        merged.push(entry);
    }

    merged.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
    return merged;
}

module.exports = {
    fetchRemoteGalleryFilenames,
    mergeRemoteGalleryBaseArray,
    getBaseName
};
