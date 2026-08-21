/**
 * Replication gallery read routes — workspace file lists for shared gallery browse.
 */

const replicationTokenAuth = require('../../replicationTokenAuth');
const replicationRemoteFetch = require('../../replicationRemoteFetch');
const { REPLICATION_ERROR_CODES, REPLICATION_TOKEN_SCOPES } = require('../replicationContracts');

function sendReplicationError(res, status, err) {
    res.status(status).json({
        success: false,
        error: err.message || 'Replication gallery error',
        code: err.code || REPLICATION_ERROR_CODES.ASSET_UNAVAILABLE,
        timestamp: new Date().toISOString()
    });
}

function replicationReadAuth(globalResources) {
    return (req, res, next) => {
        if (req.session && req.session.authenticated) {
            return next();
        }
        if (req.authMethod === 'application_key' || req.authMethod === 'temp_token') {
            return next();
        }

        const config = globalResources.getReplicationService().getReplicationConfig();
        const token = replicationTokenAuth.getReplicationTokenFromRequest(req);
        if (!replicationTokenAuth.validateReplicationToken(config, token, {
            scope: REPLICATION_TOKEN_SCOPES.READ
        })) {
            return res.status(403).json({
                success: false,
                code: REPLICATION_ERROR_CODES.TOKEN_INVALID,
                error: 'Invalid replication read token'
            });
        }
        return next();
    };
}

async function listWorkspaceGalleryFiles(globalResources, workspaceId, viewType) {
    const wm = globalResources.getWorkspaceManager();
    const workspace = wm.getWorkspace(workspaceId);
    if (!workspace) {
        throw Object.assign(new Error(`Workspace ${workspaceId} not found`), { statusCode: 404 });
    }

    let metadataDb = null;
    try {
        metadataDb = globalResources.getMetadataDatabase();
    } catch (_err) { /* database not initialized yet or offline */ }

    let files;
    if (viewType === 'scraps') {
        if (metadataDb) {
            files = await metadataDb.listWorkspaceGalleryFilenames(workspaceId, 'scraps');
        } else {
            files = Array.isArray(workspace.scraps) ? [...workspace.scraps] : [];
        }
    } else if (viewType === 'pinned') {
        if (metadataDb) {
            files = await metadataDb.listGalleryWorkspacePinFilenames(workspaceId);
        } else {
            files = Array.isArray(workspace.pinned) ? [...workspace.pinned] : [];
        }
    } else {
        if (metadataDb) {
            const workspaceFiles = new Set();
            const defaultFiles = await metadataDb.listWorkspaceGalleryFilenames('default', 'files');
            defaultFiles.forEach((file) => workspaceFiles.add(file));
            if (workspaceId !== 'default') {
                const specificFiles = await metadataDb.listWorkspaceGalleryFilenames(workspaceId, 'files');
                specificFiles.forEach((file) => workspaceFiles.add(file));
            }
            files = Array.from(workspaceFiles);
        } else {
            const workspaceFiles = new Set();
            const defaultWorkspace = wm.getWorkspace('default');
            if (defaultWorkspace && defaultWorkspace.files) {
                defaultWorkspace.files.forEach((file) => workspaceFiles.add(file));
            }
            if (workspaceId !== 'default' && workspace.files) {
                workspace.files.forEach((file) => workspaceFiles.add(file));
            }
            files = Array.from(workspaceFiles);
        }
    }

    return {
        workspaceId,
        workspaceName: workspace.name,
        viewType: viewType || 'images',
        files: Array.isArray(files) ? files : []
    };
}

async function fetchMasterGalleryList(globalResources, { workspaceId, viewType } = {}) {
    const config = globalResources.getReplicationService().getReplicationConfig();
    const base = (config.masterAccessUrl || '').replace(/\/$/, '');
    if (!base) {
        throw new Error('masterAccessUrl not configured');
    }
    const params = new URLSearchParams({
        workspaceId: workspaceId || 'default',
        viewType: viewType || 'images'
    });
    const token = config.replicationReadToken || config.replicationToken || '';
    const headers = token ? { 'X-Replication-Token': token } : {};
    const res = await fetch(`${base}/replication/gallery/workspace-files?${params.toString()}`, { headers });
    const json = await res.json();
    if (!res.ok || json.success === false) {
        throw new Error(json.error || `Master gallery HTTP ${res.status}`);
    }
    return json.data;
}

function register(app, globalResources) {
    const readAuth = replicationReadAuth(globalResources);

    app.get('/replication/gallery/workspace-files', readAuth, async (req, res) => {
        try {
            const workspaceId = req.query.workspaceId || 'default';
            const viewType = req.query.viewType || 'images';
            const data = await listWorkspaceGalleryFiles(globalResources, workspaceId, viewType);
            res.json({
                success: true,
                data,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            const status = error.statusCode || 500;
            sendReplicationError(res, status, error);
        }
    });

    app.get('/replication/gallery/remote', async (req, res) => {
        try {
            const config = globalResources.getReplicationService().getReplicationConfig();
            if (!config.masterAccessUrl) {
                return sendReplicationError(res, 400, new Error('masterAccessUrl not configured'));
            }
            if (config.connectivity === 'airgapped') {
                return sendReplicationError(res, 400, Object.assign(new Error('Remote gallery blocked in airgapped mode'), {
                    code: REPLICATION_ERROR_CODES.CONNECTIVITY_BLOCKED
                }));
            }

            const reachable = await replicationRemoteFetch.probeMasterReachable(false, globalResources);
            if (!reachable) {
                return sendReplicationError(res, 503, new Error('Master is not reachable'));
            }

            const workspaceId = req.query.workspaceId || 'default';
            const viewType = req.query.viewType || 'images';
            const data = await fetchMasterGalleryList(globalResources, { workspaceId, viewType });
            res.json({
                success: true,
                data,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            sendReplicationError(res, 500, error);
        }
    });
}

module.exports = { register };
