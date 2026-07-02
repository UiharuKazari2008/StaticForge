const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const wsPacketRegistry = require('./ws/wsPacketRegistry');

class VfsWebSocketHandlers {
    constructor(handlers) {
        this.handlers = handlers;
        this.globalResources = handlers.globalResources;
    }

    getVfs() {
        return this.globalResources.getVfsManager();
    }

    // wsClient.sendMessage spreads payload on the message root; accept both shapes
    getPayload(message) {
        return message.data != null ? message.data : message;
    }

    broadcastVfsUpdated(wsServer, pathHint) {
        if (wsServer && wsServer.broadcast) {
            wsServer.broadcast({
                type: 'vfs_updated',
                data: { path: pathHint },
                timestamp: new Date().toISOString()
            });
        }
    }

    enrichListResult(result) {
        const uuid = this.globalResources.getVfsPathUuid();
        return {
            ...result,
            items: this.getVfs().enrichItemsWithPreviewUrls(result.items, uuid)
        };
    }

    async _gcContentBlobIfUnreferenced(contentHash) {
        if (!contentHash) return;
        const vfsDb = this.globalResources.getVfsDatabase();
        const remaining = await vfsDb.countUserFilesByContentHash(contentHash);
        if (remaining > 0) return;
        const vfs = this.getVfs();
        const blobPath = vfs.getFileBlobPath(contentHash);
        if (fs.existsSync(blobPath)) {
            try { fs.unlinkSync(blobPath); } catch (_) { /* ignore */ }
        }
        const previewPath = vfs.getFilePreviewPath(`${contentHash}.webp`);
        if (previewPath && fs.existsSync(previewPath)) {
            try { fs.unlinkSync(previewPath); } catch (_) { /* ignore */ }
        }
    }

    async handleVfsListDirectory(ws, message, clientInfo) {
        const { path: vfsPath, offset, limit, sortField, sortDirection, search } = this.getPayload(message);
        const result = await this.getVfs().listDirectory(vfsPath || '/', {
            offset: offset || 0,
            limit: limit || 300,
            sortField: sortField || 'name',
            sortDirection: sortDirection || 'asc',
            search: search || ''
        });
        this.handlers.sendToClient(ws, {
            type: 'vfs_list_directory_response',
            requestId: message.requestId,
            data: { success: true, ...this.enrichListResult(result) },
            timestamp: new Date().toISOString()
        });
    }

    async handleVfsGetPathStats(ws, message) {
        const { path: vfsPath } = this.getPayload(message);
        const stats = await this.getVfs().getPathStats(vfsPath || '/');
        this.handlers.sendToClient(ws, {
            type: 'vfs_get_path_stats_response',
            requestId: message.requestId,
            data: { success: true, stats },
            timestamp: new Date().toISOString()
        });
    }

    async handleVfsResolvePath(ws, message) {
        const { path: inputPath } = this.getPayload(message);
        const path = await this.getVfs().resolvePathInput(inputPath || '/');
        this.handlers.sendToClient(ws, {
            type: 'vfs_resolve_path_response',
            requestId: message.requestId,
            data: { success: true, path },
            timestamp: new Date().toISOString()
        });
    }

    async handleVfsCreateFolder(ws, message, clientInfo, wsServer) {
        const { path: vfsPath, name } = this.getPayload(message);
        const folder = await this.getVfs().createFolderAtPath(vfsPath, name);
        this.broadcastVfsUpdated(wsServer, vfsPath);
        this.handlers.sendToClient(ws, {
            type: 'vfs_create_folder_response',
            requestId: message.requestId,
            data: { success: true, folder },
            timestamp: new Date().toISOString()
        });
    }

    async handleVfsRenameFolder(ws, message, clientInfo, wsServer) {
        const { folderId, name } = this.getPayload(message);
        const folder = await this.getVfs().renameFolderAtPath(folderId, name);
        this.broadcastVfsUpdated(wsServer, null);
        this.handlers.sendToClient(ws, {
            type: 'vfs_rename_folder_response',
            requestId: message.requestId,
            data: { success: true, folder },
            timestamp: new Date().toISOString()
        });
    }

    async handleVfsRenameFile(ws, message, clientInfo, wsServer) {
        const { fileId, name } = this.getPayload(message);
        const trimmed = (name || '').trim();
        if (!trimmed) throw new Error('File name is required');
        const vfsDb = this.globalResources.getVfsDatabase();
        const file = await vfsDb.getUserFileById(fileId);
        if (!file) throw new Error('File not found');
        const updated = await vfsDb.updateUserFile(fileId, { original_name: trimmed });
        this.broadcastVfsUpdated(wsServer, null);
        this.handlers.sendToClient(ws, {
            type: 'vfs_rename_file_response',
            requestId: message.requestId,
            data: { success: true, file: updated },
            timestamp: new Date().toISOString()
        });
    }

    async handleVfsDeleteFolder(ws, message, clientInfo, wsServer) {
        const { folderId } = this.getPayload(message);
        await this.getVfs().deleteFolderById(folderId);
        this.broadcastVfsUpdated(wsServer, null);
        this.handlers.sendToClient(ws, {
            type: 'vfs_delete_folder_response',
            requestId: message.requestId,
            data: { success: true },
            timestamp: new Date().toISOString()
        });
    }

    async handleVfsMoveItems(ws, message, clientInfo, wsServer) {
        try {
            const { items, targetPath } = this.getPayload(message);
            const results = await this.getVfs().moveItems(items, targetPath);
            const movedDesktop = (items || []).some(i =>
                i.isDesktopShortcut || i.shortcutType || i.shortcutId
                || i.isVfsShortcutEntry || i.vfsEntryId
            ) || (targetPath || '').includes('/Desktop');
            if (movedDesktop && wsServer?.broadcast) {
                wsServer.broadcast({
                    type: 'desktop_shortcut_updated',
                    data: { batch: true },
                    timestamp: new Date().toISOString()
                });
            }
            this.broadcastVfsUpdated(wsServer, targetPath);
            this.handlers.sendToClient(ws, {
                type: 'vfs_move_items_response',
                requestId: message.requestId,
                data: { success: true, results },
                timestamp: new Date().toISOString()
            });
        } catch (err) {
            this.handlers.sendError(ws, err.message || 'Failed to move items', 'vfs_move_items', message.requestId);
        }
    }

    async handleVfsFolderHasUserFiles(ws, message) {
        const { folderIds } = this.getPayload(message);
        const hasUserFiles = await this.getVfs().folderTreeHasUserFiles(folderIds);
        this.handlers.sendToClient(ws, {
            type: 'vfs_folder_has_user_files_response',
            requestId: message.requestId,
            data: { success: true, hasUserFiles },
            timestamp: new Date().toISOString()
        });
    }

    async handleVfsCopyItems(ws, message, clientInfo, wsServer) {
        const { items, targetPath, userFileCopyMode } = this.getPayload(message);
        const results = await this.getVfs().copyItems(items, targetPath, { userFileCopyMode });
        const copiedDesktop = (items || []).some(i =>
            i.isDesktopShortcut || i.shortcutType || i.shortcutId
            || i.isVfsShortcutEntry || i.vfsEntryId
            || i.targetKind === 'vfs-folder'
        ) || (targetPath || '').includes('/Desktop');
        if (copiedDesktop && wsServer?.broadcast) {
            wsServer.broadcast({
                type: 'desktop_shortcut_updated',
                data: { batch: true },
                timestamp: new Date().toISOString()
            });
        }
        this.broadcastVfsUpdated(wsServer, targetPath);
        this.handlers.sendToClient(ws, {
            type: 'vfs_copy_items_response',
            requestId: message.requestId,
            data: { success: true, results },
            timestamp: new Date().toISOString()
        });
    }

    async handleVfsDeleteEntry(ws, message, clientInfo, wsServer) {
        const { entryId } = this.getPayload(message);
        await this.getVfs().deleteEntryById(entryId);
        this.broadcastVfsUpdated(wsServer, null);
        this.handlers.sendToClient(ws, {
            type: 'vfs_delete_entry_response',
            requestId: message.requestId,
            data: { success: true },
            timestamp: new Date().toISOString()
        });
    }

    async handleVfsRenameShortcutEntry(ws, message, clientInfo, wsServer) {
        const { entryId, name } = this.getPayload(message);
        const entry = await this.getVfs().renameShortcutEntry(entryId, name);
        this.broadcastVfsUpdated(wsServer, null);
        this.handlers.sendToClient(ws, {
            type: 'vfs_rename_shortcut_entry_response',
            requestId: message.requestId,
            data: { success: true, entry },
            timestamp: new Date().toISOString()
        });
    }

    async handleVfsRenameEntry(ws, message, clientInfo, wsServer) {
        const { entryId, name } = this.getPayload(message);
        const entry = await this.getVfs().renameEntry(entryId, name);
        this.broadcastVfsUpdated(wsServer, null);
        this.handlers.sendToClient(ws, {
            type: 'vfs_rename_entry_response',
            requestId: message.requestId,
            data: { success: true, entry },
            timestamp: new Date().toISOString()
        });
    }

    async handleVfsUploadFile(ws, message, clientInfo, wsServer) {
        const { path: vfsPath, fileData, originalFilename, mimeType, tempFile } = this.getPayload(message);
        let buffer;
        if (tempFile) {
            const tempPath = path.join(this.globalResources.getPath('tempDownload'), tempFile);
            buffer = fs.readFileSync(tempPath);
        } else if (fileData) {
            const base64 = fileData.replace(/^data:[^;]+;base64,/, '');
            buffer = Buffer.from(base64, 'base64');
        } else {
            throw new Error('No file data provided');
        }
        const location = this.getVfs().resolveLocationFromPath(vfsPath);
        const file = await this.getVfs().saveUserFileBuffer(buffer, {
            originalName: originalFilename || 'file',
            mimeType: mimeType || 'application/octet-stream',
            scope: location.scope,
            workspaceId: location.workspaceId,
            folderId: location.folderId
        });
        this.broadcastVfsUpdated(wsServer, vfsPath);
        const uuid = this.globalResources.getVfsPathUuid();
        this.handlers.sendToClient(ws, {
            type: 'vfs_upload_file_response',
            requestId: message.requestId,
            data: {
                success: true,
                file: this.getVfs().enrichItemsWithPreviewUrls([this.getVfs().makeFileItem(file)], uuid)[0]
            },
            timestamp: new Date().toISOString()
        });
    }

    async handleVfsReplaceFile(ws, message, clientInfo, wsServer) {
        const { fileId, fileData, mimeType, tempFile } = this.getPayload(message);
        const vfsDb = this.globalResources.getVfsDatabase();
        const existing = await vfsDb.getUserFileById(fileId);
        if (!existing) throw new Error('File not found');

        let buffer;
        if (tempFile) {
            buffer = fs.readFileSync(path.join(this.globalResources.getPath('tempDownload'), tempFile));
        } else {
            const base64 = fileData.replace(/^data:[^;]+;base64,/, '');
            buffer = Buffer.from(base64, 'base64');
        }

        const newMime = mimeType || existing.mime_type;
        const existingTop = (existing.mime_type || '').split('/')[0];
        const newTop = newMime.split('/')[0];
        if (existingTop !== newTop) {
            throw new Error('Replacement file must have the same mime type family');
        }

        const hash = crypto.createHash('md5').update(buffer).digest('hex');
        const oldHash = existing.content_hash;
        const blobPath = this.getVfs().getFileBlobPath(hash);
        if (!fs.existsSync(blobPath)) {
            fs.writeFileSync(blobPath, buffer);
        }

        const updated = await vfsDb.updateUserFile(fileId, {
            content_hash: hash,
            mime_type: newMime,
            size: buffer.length
        });
        if (oldHash && oldHash !== hash) {
            await this._gcContentBlobIfUnreferenced(oldHash);
        }
        this.broadcastVfsUpdated(wsServer, null);
        this.handlers.sendToClient(ws, {
            type: 'vfs_replace_file_response',
            requestId: message.requestId,
            data: { success: true, file: updated },
            timestamp: new Date().toISOString()
        });
    }

    async handleVfsDownloadFile(ws, message) {
        const { fileId } = this.getPayload(message);
        const uuid = this.globalResources.getVfsPathUuid();
        this.handlers.sendToClient(ws, {
            type: 'vfs_download_file_response',
            requestId: message.requestId,
            data: {
                success: true,
                downloadUrl: `/${uuid}/files/${fileId}`,
                fileId
            },
            timestamp: new Date().toISOString()
        });
    }

    async handleVfsDownloadSystemFile(ws, message) {
        const { systemFileKey } = this.getPayload(message);
        if (!systemFileKey) {
            throw new Error('systemFileKey is required');
        }
        const vfs = this.getVfs();
        const info = vfs.resolveSystemFileDownload(systemFileKey);
        const uuid = this.globalResources.getVfsPathUuid();
        const encoded = vfs.encodeSystemFileKey(systemFileKey);
        this.handlers.sendToClient(ws, {
            type: 'vfs_download_system_file_response',
            requestId: message.requestId,
            data: {
                success: true,
                downloadUrl: `/${uuid}/system/${encoded}`,
                filename: info.name,
                mimeType: info.mimeType,
                size: info.size
            },
            timestamp: new Date().toISOString()
        });
    }

    async handleVfsReadSystemFile(ws, message, clientInfo) {
        const { systemFileKey } = this.getPayload(message);
        if (!systemFileKey) {
            throw new Error('systemFileKey is required');
        }
        const payload = await this.getVfs().readSystemFile(systemFileKey, { clientInfo });
        this.handlers.sendToClient(ws, {
            type: 'vfs_read_system_file_response',
            requestId: message.requestId,
            data: { success: true, ...payload },
            timestamp: new Date().toISOString()
        });
    }

    async handleDesktopCreateEmptyFolder(ws, message, clientInfo, wsServer) {
        const payload = this.getPayload(message);
        const workspaceId = payload.workspaceId ||
            this.globalResources.getWorkspaceManager().getActiveWorkspace(clientInfo.sessionId);
        const position = payload.position || null;
        const name = payload.name || 'New Folder';

        const folder = await this.globalResources.getVfsDatabase().createFolder({
            scope: 'workspace',
            workspaceId,
            parentId: null,
            name
        });

        const shortcut = {
            name,
            type: 'folder',
            folderId: null,
            position: position || { index: 0, pos: 0 },
            data: { vfsFolderId: folder.id }
        };

        const result = this.globalResources.getWorkspaceManager().addDesktopShortcut(workspaceId, shortcut);

        wsServer.broadcast({
            type: 'desktop_shortcut_added',
            data: { workspaceId, shortcut: result.shortcut },
            timestamp: new Date().toISOString()
        });

        this.handlers.sendToClient(ws, {
            type: 'desktop_create_empty_folder_response',
            requestId: message.requestId,
            data: {
                success: true,
                folderId: folder.id,
                shortcutId: result.shortcut.id,
                shortcut: result.shortcut,
                vfsPath: `/Workspaces/${workspaceId}/Desktop/${folder.id}`
            },
            timestamp: new Date().toISOString()
        });
    }

    async handleDesktopUpdateShortcutFolders(ws, message, clientInfo, wsServer) {
        const { workspaceId, updates } = this.getPayload(message);
        const wm = this.globalResources.getWorkspaceManager();
        for (const u of updates || []) {
            wm.updateDesktopShortcut(workspaceId, u.shortcutId, { folderId: u.folderId });
        }
        wsServer.broadcast({
            type: 'desktop_shortcut_updated',
            data: { workspaceId, batch: true },
            timestamp: new Date().toISOString()
        });
        this.handlers.sendToClient(ws, {
            type: 'desktop_update_shortcut_folders_response',
            requestId: message.requestId,
            data: { success: true },
            timestamp: new Date().toISOString()
        });
    }

    async handleDesktopCreateFolderFromSelection(ws, message, clientInfo, wsServer) {
        const { workspaceId, shortcutIds, position } = this.getPayload(message);
        const wm = this.globalResources.getWorkspaceManager();
        const folder = await this.globalResources.getVfsDatabase().createFolder({
            scope: 'workspace',
            workspaceId,
            parentId: null,
            name: 'New Folder'
        });

        const folderShortcut = {
            name: 'New Folder',
            type: 'folder',
            folderId: null,
            position: position || { index: 0, pos: 0 },
            data: { vfsFolderId: folder.id }
        };
        const folderResult = wm.addDesktopShortcut(workspaceId, folderShortcut);

        for (const sid of shortcutIds || []) {
            wm.updateDesktopShortcut(workspaceId, sid, { folderId: folder.id });
        }

        wsServer.broadcast({
            type: 'desktop_shortcut_added',
            data: { workspaceId, shortcut: folderResult.shortcut },
            timestamp: new Date().toISOString()
        });

        this.handlers.sendToClient(ws, {
            type: 'desktop_create_folder_from_selection_response',
            requestId: message.requestId,
            data: {
                success: true,
                folderId: folder.id,
                folderShortcutId: folderResult.shortcut.id
            },
            timestamp: new Date().toISOString()
        });
    }

    async handleVfsDeleteFile(ws, message, clientInfo, wsServer) {
        const vfsDb = this.globalResources.getVfsDatabase();
        const { fileId } = this.getPayload(message);
        const file = await vfsDb.getUserFileById(fileId);
        if (!file) throw new Error('File not found');
        const contentHash = file.content_hash;
        const { success } = await vfsDb.deleteUserFile(fileId);
        if (!success) throw new Error('File not found');
        await this._gcContentBlobIfUnreferenced(contentHash);
        this.broadcastVfsUpdated(wsServer, null);
        this.handlers.sendToClient(ws, {
            type: 'vfs_delete_file_response',
            requestId: message.requestId,
            data: { success: true },
            timestamp: new Date().toISOString()
        });
    }

    async handleVfsMoveToTrash(ws, message, clientInfo, wsServer) {
        const { items, sourcePath } = this.getPayload(message);
        const results = await this.getVfs().moveItemsToTrash(items, sourcePath);
        this.broadcastVfsUpdated(wsServer, sourcePath);
        this.handlers.sendToClient(ws, {
            type: 'vfs_move_to_trash_response',
            requestId: message.requestId,
            data: { success: true, results },
            timestamp: new Date().toISOString()
        });
    }

    async handleVfsRestoreFromTrash(ws, message, clientInfo, wsServer) {
        const { trashItemId } = this.getPayload(message);
        const result = await this.getVfs().restoreFromTrash(trashItemId);
        this.broadcastVfsUpdated(wsServer, result.originalPath || `/Workspaces/${result.workspaceId}/Trash`);
        this.handlers.sendToClient(ws, {
            type: 'vfs_restore_from_trash_response',
            requestId: message.requestId,
            data: { success: true, ...result },
            timestamp: new Date().toISOString()
        });
    }

    async handleVfsEmptyTrash(ws, message, clientInfo, wsServer) {
        const { workspaceId } = this.getPayload(message);
        if (!workspaceId) throw new Error('workspaceId is required');
        const result = await this.getVfs().emptyTrash(workspaceId);
        this.broadcastVfsUpdated(wsServer, `/Workspaces/${workspaceId}/Trash`);
        this.handlers.sendToClient(ws, {
            type: 'vfs_empty_trash_response',
            requestId: message.requestId,
            data: { success: true, ...result },
            timestamp: new Date().toISOString()
        });
    }

    async handleVfsPermanentlyDelete(ws, message, clientInfo, wsServer) {
        const { items, sourcePath } = this.getPayload(message);
        const results = await this.getVfs().permanentlyDeleteItems(items, sourcePath);
        this.broadcastVfsUpdated(wsServer, sourcePath);
        this.handlers.sendToClient(ws, {
            type: 'vfs_permanently_delete_response',
            requestId: message.requestId,
            data: { success: true, results },
            timestamp: new Date().toISOString()
        });
    }

    async handleVfsConvertReferenceToFile(ws, message, clientInfo, wsServer) {
        const { hash, workspaceId, mode } = this.getPayload(message);
        const refDb = this.globalResources.getReferenceMetadataDatabase();
        const uploadPath = this.globalResources.getPath('uploadCache');
        const userFilesPath = this.globalResources.getPath('userFiles');
        const srcPath = path.join(uploadPath, hash);
        if (!fs.existsSync(srcPath)) throw new Error('Reference file not found on disk');

        const buffer = fs.readFileSync(srcPath);
        const file = await this.getVfs().saveUserFileBuffer(buffer, {
            originalName: hash,
            mimeType: 'image/png',
            scope: 'workspace',
            workspaceId,
            folderId: null
        });

        if (mode === 'move') {
            refDb.removeReferenceFromWorkspace(hash, workspaceId);
        }

        this.handlers.sendToClient(ws, {
            type: 'vfs_convert_reference_to_file_response',
            requestId: message.requestId,
            data: { success: true, file, mode },
            timestamp: new Date().toISOString()
        });
        this.broadcastVfsUpdated(wsServer, `/Workspaces/${workspaceId}`);
    }

    async handleVfsConvertFileToReference(ws, message, clientInfo, wsServer) {
        const { fileId, workspaceId, mode } = this.getPayload(message);
        const vfsDb = this.globalResources.getVfsDatabase();
        const file = await vfsDb.getUserFileById(fileId);
        if (!file) throw new Error('File not found');

        const buffer = fs.readFileSync(this.getVfs().getFileBlobPath(file.content_hash));
        const hash = file.content_hash;
        const uploadPath = path.join(this.globalResources.getPath('uploadCache'), hash);
        if (!fs.existsSync(uploadPath)) {
            fs.writeFileSync(uploadPath, buffer);
        }

        const refDb = this.globalResources.getReferenceMetadataDatabase();
        refDb.setFileCache(hash, { size: buffer.length });
        refDb.addReferenceToWorkspace(hash, workspaceId);

        if (mode === 'move') {
            const contentHash = file.content_hash;
            await vfsDb.deleteUserFile(fileId);
            await this._gcContentBlobIfUnreferenced(contentHash);
        }

        this.handlers.sendToClient(ws, {
            type: 'vfs_convert_file_to_reference_response',
            requestId: message.requestId,
            data: { success: true, hash, mode },
            timestamp: new Date().toISOString()
        });
        this.broadcastVfsUpdated(wsServer, `/Workspaces/${workspaceId}`);
    }
}

/** Destructive vfs/desktop types — keep in sync with isDestructiveOperation in websocketHandlers.js */
const VFS_DESTRUCTIVE = {
    destructive: true
};

/**
 * Register all vfs_* and desktop_* WebSocket packet handlers on wsPacketRegistry.
 * @param {import('./websocketHandlers').WebSocketMessageHandlers} handlersCtx
 */
function registerVfsPackets(handlersCtx) {
    if (!handlersCtx || !handlersCtx.vfsHandlers) {
        console.warn('[vfsWebSocketHandlers] registerVfsPackets: missing handlersCtx.vfsHandlers');
        return;
    }

    const vfs = handlersCtx.vfsHandlers;

    const reg = (type, fn, meta = {}) => {
        wsPacketRegistry.registerWsPacket(type, async (ctx) => {
            await fn(ctx);
        }, { owner: 'vfs', ...meta });
    };

    reg('vfs_list_directory', (ctx) => vfs.handleVfsListDirectory(ctx.ws, ctx.message, ctx.clientInfo));
    reg('vfs_get_path_stats', (ctx) => vfs.handleVfsGetPathStats(ctx.ws, ctx.message));
    reg('vfs_resolve_path', (ctx) => vfs.handleVfsResolvePath(ctx.ws, ctx.message));
    reg('vfs_folder_has_user_files', (ctx) => vfs.handleVfsFolderHasUserFiles(ctx.ws, ctx.message));
    reg('vfs_create_folder', (ctx) => vfs.handleVfsCreateFolder(ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer), VFS_DESTRUCTIVE);
    reg('vfs_rename_folder', (ctx) => vfs.handleVfsRenameFolder(ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer), VFS_DESTRUCTIVE);
    reg('vfs_rename_file', (ctx) => vfs.handleVfsRenameFile(ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer), VFS_DESTRUCTIVE);
    reg('vfs_delete_folder', (ctx) => vfs.handleVfsDeleteFolder(ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer), VFS_DESTRUCTIVE);
    reg('vfs_move_items', (ctx) => vfs.handleVfsMoveItems(ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer), VFS_DESTRUCTIVE);
    reg('vfs_copy_items', (ctx) => vfs.handleVfsCopyItems(ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer), VFS_DESTRUCTIVE);
    reg('vfs_delete_entry', (ctx) => vfs.handleVfsDeleteEntry(ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer), VFS_DESTRUCTIVE);
    reg('vfs_rename_shortcut_entry', (ctx) => vfs.handleVfsRenameShortcutEntry(ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer), VFS_DESTRUCTIVE);
    reg('vfs_rename_entry', (ctx) => vfs.handleVfsRenameEntry(ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer), VFS_DESTRUCTIVE);
    reg('vfs_upload_file', (ctx) => vfs.handleVfsUploadFile(ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer), VFS_DESTRUCTIVE);
    reg('vfs_replace_file', (ctx) => vfs.handleVfsReplaceFile(ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer), VFS_DESTRUCTIVE);
    reg('vfs_download_file', (ctx) => vfs.handleVfsDownloadFile(ctx.ws, ctx.message));
    reg('vfs_download_system_file', (ctx) => vfs.handleVfsDownloadSystemFile(ctx.ws, ctx.message));
    reg('vfs_read_system_file', (ctx) => vfs.handleVfsReadSystemFile(ctx.ws, ctx.message, ctx.clientInfo));
    reg('vfs_delete_file', (ctx) => vfs.handleVfsDeleteFile(ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer), VFS_DESTRUCTIVE);
    reg('vfs_move_to_trash', (ctx) => vfs.handleVfsMoveToTrash(ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer), VFS_DESTRUCTIVE);
    reg('vfs_restore_from_trash', (ctx) => vfs.handleVfsRestoreFromTrash(ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer), VFS_DESTRUCTIVE);
    reg('vfs_empty_trash', (ctx) => vfs.handleVfsEmptyTrash(ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer), VFS_DESTRUCTIVE);
    reg('vfs_permanently_delete', (ctx) => vfs.handleVfsPermanentlyDelete(ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer), VFS_DESTRUCTIVE);
    reg('vfs_convert_reference_to_file', (ctx) => vfs.handleVfsConvertReferenceToFile(ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer), VFS_DESTRUCTIVE);
    reg('vfs_convert_file_to_reference', (ctx) => vfs.handleVfsConvertFileToReference(ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer), VFS_DESTRUCTIVE);

    reg('desktop_create_empty_folder', (ctx) => vfs.handleDesktopCreateEmptyFolder(ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer), VFS_DESTRUCTIVE);
    reg('desktop_update_shortcut_folders', (ctx) => vfs.handleDesktopUpdateShortcutFolders(ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer), VFS_DESTRUCTIVE);
    reg('desktop_create_folder_from_selection', (ctx) => vfs.handleDesktopCreateFolderFromSelection(ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer), VFS_DESTRUCTIVE);

    reg('desktop_get_settings', (ctx) => handlersCtx.handleDesktopGetSettings(ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer));
    reg('desktop_get_shortcuts', (ctx) => handlersCtx.handleDesktopGetShortcuts(ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer));
    reg('desktop_add_shortcut', (ctx) => handlersCtx.handleDesktopAddShortcut(ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer), VFS_DESTRUCTIVE);
    reg('desktop_update_shortcut', (ctx) => handlersCtx.handleDesktopUpdateShortcut(ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer), VFS_DESTRUCTIVE);
    reg('desktop_remove_shortcut', (ctx) => handlersCtx.handleDesktopRemoveShortcut(ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer), VFS_DESTRUCTIVE);
    reg('desktop_update_positions', (ctx) => handlersCtx.handleDesktopUpdatePositions(ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer), VFS_DESTRUCTIVE);
}

module.exports = VfsWebSocketHandlers;
module.exports.registerVfsPackets = registerVfsPackets;
