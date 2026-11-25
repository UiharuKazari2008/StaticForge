/**
 * Master asset read routes — CORS + session or replication-token auth.
 */

const fs = require('fs');
const path = require('path');
const replicationTokenAuth = require('../../replicationTokenAuth');
const imageStore = require('../../imageStore');
// was never required here: every asset request threw a ReferenceError (found with #1156)
const replicationRemoteFetch = require('../../replicationRemoteFetch');
const { REPLICATION_ERROR_CODES, REPLICATION_TOKEN_SCOPES } = require('../replicationContracts');

function setReplicationCors(req, res) {
    const origin = req.headers.origin;
    if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'X-Replication-Token, Authorization, Content-Type');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Type, ETag, Last-Modified');
}

function replicationReadAuth(globalResources) {
    return (req, res, next) => {
        setReplicationCors(req, res);

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

function resolveContentType(kind, filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.jxl') return 'image/jxl';
    if (ext === '.webp') return 'image/webp';
    if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
    if (ext === '.png') return 'image/png';
    if (ext === '.json') return 'application/json';
    if (kind === 'gallery-preview' || kind === 'reference-preview') return 'image/webp';
    if (kind === 'gallery-image') return 'image/png';
    return 'application/octet-stream';
}

// A gallery picture is served as its STORED bytes under its name (#1156): `<id>.jxl` for a picture ID, x.jxl for a
// legacy x.png kept as JXL, x.png when it still is one; the Content-Type follows the file. That is also what the
// journal hashes (replicationJournal.recordGallerySave), so checksum and bytes agree, and the fetching peer stores
// what it gets with imageStore.writePicture (replicationRemoteFetch.readAssetBuffer). ?format=png serves a PNG
// instead (imageStore.exportPngPath: for a peer from before this change, which wrote the bytes raw under x.png).
async function resolveServedPath(globalResources, kind, key, req = null) {
    const localPath = replicationRemoteFetch.resolveLocalPath(globalResources, kind, key);
    if (!localPath) return null;
    if (kind === 'gallery-image' && imageStore.cleanName(key) === key) {
        const dir = path.dirname(localPath);
        if (req && req.query && String(req.query.format || '').toLowerCase() === 'png') {
            return imageStore.exportPngPath(key, dir);
        }
        const loc = await imageStore.locate(key, dir);
        return loc ? loc.path : null;
    }
    return localPath;
}

function register(app, globalResources) {
    const readAuth = replicationReadAuth(globalResources);

    app.options('/replication/assets/:kind/:key(*)', (req, res) => {
        setReplicationCors(req, res);
        res.status(204).end();
    });

    app.head('/replication/assets/:kind/:key(*)', readAuth, async (req, res) => {
        const kind = req.params.kind;
        const key = decodeURIComponent(req.params.key || '');
        const localPath = await resolveServedPath(globalResources, kind, key, req);
        const stat = localPath ? await fs.promises.stat(localPath).catch(() => null) : null;
        if (!stat) {
            return res.status(404).end();
        }
        res.setHeader('Content-Type', resolveContentType(kind, localPath));
        res.setHeader('Content-Length', stat.size);
        res.setHeader('Cache-Control', 'private, max-age=259200');
        return res.status(200).end();
    });

    app.get('/replication/assets/:kind/:key(*)', readAuth, async (req, res) => {
        const kind = req.params.kind;
        const key = decodeURIComponent(req.params.key || '');
        if (!key) {
            return res.status(400).json({ success: false, error: 'Missing asset key' });
        }

        const localPath = await resolveServedPath(globalResources, kind, key, req);
        const stat = localPath ? await fs.promises.stat(localPath).catch(() => null) : null;
        if (!stat) {
            return res.status(404).json({
                success: false,
                code: REPLICATION_ERROR_CODES.ASSET_UNAVAILABLE,
                error: 'Asset not found on master',
                kind,
                key
            });
        }

        res.setHeader('Content-Type', resolveContentType(kind, localPath));
        res.setHeader('Content-Length', stat.size);
        res.setHeader('Cache-Control', 'private, max-age=259200');
        res.setHeader('Last-Modified', stat.mtime.toUTCString());
        return res.sendFile(path.basename(localPath), { root: path.dirname(localPath) });
    });
}

module.exports = { register };
