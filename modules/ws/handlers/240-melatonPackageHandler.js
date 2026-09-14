/**
 * Melaton package store WS — list / install / uninstall / enable.
 * Store: modules/melatonPackageStore.js
 * Docs: docs/client-api/ws/melatonPackages.md
 */
const fs = require('fs');
const path = require('path');
const wsPacketRegistry = require('../wsPacketRegistry');
const vfsDatabase = require('../../vfsDatabase');
const {
    createMelatonPackageStore,
    MelatonPackageError,
    inferFormatFromName
} = require('../../melatonPackageStore');

const OWNER = { owner: 'melatonPackages' };
const ADMIN_DESTRUCTIVE = { owner: 'melatonPackages', destructive: true };

let storeSingleton = null;

function getStore(handlers) {
    if (!storeSingleton) {
        storeSingleton = createMelatonPackageStore(handlers.globalResources, {
            getReservedPacketTypes: () => wsPacketRegistry.listRegisteredPackets().map((row) => row.type)
        });
    }
    return storeSingleton;
}

function requireAdmin(handlers, ws, message, clientInfo) {
    if (clientInfo.userType !== 'admin') {
        handlers.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
        return false;
    }
    return true;
}

function sendOk(wsServer, ws, type, requestId, data) {
    wsServer.sendToClient(ws, {
        type,
        requestId,
        data: Object.assign({ success: true }, data),
        timestamp: new Date().toISOString()
    });
}

function sendStoreError(handlers, ws, message, err) {
    const code = err instanceof MelatonPackageError ? err.code : 'PACKAGE_ERROR';
    handlers.sendError(ws, err.message || 'Package operation failed', code, message.requestId);
}

function broadcastPackagesUpdated(wsServer, reason, record) {
    wsServer.broadcastToAll({
        type: 'packages_updated',
        data: {
            reason: reason || 'change',
            package: record || null
        },
        timestamp: new Date().toISOString()
    });
}

function decodeInstallBytes(message) {
    if (Buffer.isBuffer(message.bytes)) return message.bytes;
    if (Array.isArray(message.bytes)) return Buffer.from(message.bytes);
    if (typeof message.base64 === 'string' && message.base64.trim()) {
        return Buffer.from(message.base64.trim(), 'base64');
    }
    return null;
}

async function readVfsPackageBuffer(handlers, fileId) {
    const file = await vfsDatabase.getUserFileById(fileId);
    if (!file || !file.content_hash) {
        throw new MelatonPackageError(`VFS file not found: ${fileId}`, 'PACKAGE_VFS');
    }
    const blobPath = path.join(handlers.globalResources.getPath('userFiles'), file.content_hash);
    if (!fs.existsSync(blobPath)) {
        throw new MelatonPackageError('VFS blob missing on disk', 'PACKAGE_VFS');
    }
    return {
        buffer: fs.readFileSync(blobPath),
        fileName: file.original_name || ''
    };
}

async function handlePackageList(handlers, ws, message, clientInfo, wsServer) {
    try {
        const store = getStore(handlers);
        sendOk(wsServer, ws, 'package_list_response', message.requestId, {
            packages: store.list()
        });
    } catch (err) {
        sendStoreError(handlers, ws, message, err);
    }
}

async function handlePackageInstall(handlers, ws, message, clientInfo, wsServer) {
    if (!requireAdmin(handlers, ws, message, clientInfo)) return;
    try {
        const store = getStore(handlers);
        let buffer = decodeInstallBytes(message);
        let fileName = String(message.fileName || message.filename || '');
        if (!buffer && message.vfsFileId) {
            const fromVfs = await readVfsPackageBuffer(handlers, message.vfsFileId);
            buffer = fromVfs.buffer;
            if (!fileName) fileName = fromVfs.fileName;
        }
        if (!buffer) {
            throw new MelatonPackageError('Provide base64, bytes, or vfsFileId', 'PACKAGE_BYTES');
        }
        const record = store.installFromBuffer(buffer, {
            expectedFormat: inferFormatFromName(fileName)
        });
        sendOk(wsServer, ws, 'package_install_response', message.requestId, { package: record });
        broadcastPackagesUpdated(wsServer, 'install', record);
    } catch (err) {
        sendStoreError(handlers, ws, message, err);
    }
}

async function handlePackageUninstall(handlers, ws, message, clientInfo, wsServer) {
    if (!requireAdmin(handlers, ws, message, clientInfo)) return;
    try {
        const id = String(message.id || message.packageId || '').trim();
        if (!id) {
            throw new MelatonPackageError('id is required', 'PACKAGE_ID');
        }
        const result = getStore(handlers).uninstall(id);
        sendOk(wsServer, ws, 'package_uninstall_response', message.requestId, result);
        broadcastPackagesUpdated(wsServer, 'uninstall', { id });
    } catch (err) {
        sendStoreError(handlers, ws, message, err);
    }
}

async function handlePackageSetEnabled(handlers, ws, message, clientInfo, wsServer) {
    if (!requireAdmin(handlers, ws, message, clientInfo)) return;
    try {
        const id = String(message.id || message.packageId || '').trim();
        if (!id) {
            throw new MelatonPackageError('id is required', 'PACKAGE_ID');
        }
        if (typeof message.enabled !== 'boolean') {
            throw new MelatonPackageError('enabled must be a boolean', 'PACKAGE_ENABLED');
        }
        const record = getStore(handlers).setEnabled(id, message.enabled);
        sendOk(wsServer, ws, 'package_set_enabled_response', message.requestId, { package: record });
        broadcastPackagesUpdated(wsServer, message.enabled ? 'enable' : 'disable', record);
    } catch (err) {
        sendStoreError(handlers, ws, message, err);
    }
}

function registerPackets(handlersCtx) {
    if (!handlersCtx) {
        console.warn('[240-melatonPackageHandler] registerPackets: missing handlersCtx');
        return;
    }

    const regFn = (type, fn, meta = {}) => {
        wsPacketRegistry.registerWsPacket(type, async (ctx) => {
            await fn(ctx.handlers, ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer);
        }, { ...OWNER, ...meta });
    };

    regFn('package_list', handlePackageList);
    regFn('package_install', handlePackageInstall, ADMIN_DESTRUCTIVE);
    regFn('package_uninstall', handlePackageUninstall, ADMIN_DESTRUCTIVE);
    regFn('package_set_enabled', handlePackageSetEnabled, ADMIN_DESTRUCTIVE);
}

module.exports = {
    registerPackets,
    resetMelatonPackageStoreForTests() {
        storeSingleton = null;
    }
};
