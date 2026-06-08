const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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
            this.handlers.sendToClient(ws, {
                type: 'error',
                message: err.message || 'Failed to move items',
                details: 'vfs_move_items',
                requestId: message.requestId,
                timestamp: new Date().toISOString()
            });
        }
    }

    async handleVfsCopyItems(ws, message, clientInfo, wsServer) {
        const { items, targetPath, userFileCopyMode } = this.getPayload(message);
        const results = await this.getVfs().copyItems(items, targetPath, { userFileCopyMode });
        this.broadcastVfsUpdated(wsServer, targetPath);
        this.handlers.sendToClient(ws, {
            type: 'vfs_copy_items_response',
            requestId: message.requestId,
            data: { success: true, results },
            timestamp: new Date().toISOString()
        });
    }

    async handleVfsDeleteEntry(ws, message, clientInfo, wsServer) {
        const vfsDb = this.globalResources.getVfsDatabase();
        const { entryId } = this.getPayload(message);
        await vfsDb.deleteEntry(entryId);
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
        const blobPath = this.getVfs().getFileBlobPath(hash);
        fs.writeFileSync(blobPath, buffer);

        const updated = await vfsDb.updateUserFile(fileId, {
            content_hash: hash,
            mime_type: newMime,
            size: buffer.length
        });
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
        await vfsDb.deleteUserFile(fileId);
        const blobPath = this.getVfs().getFileBlobPath(file.content_hash);
        if (fs.existsSync(blobPath)) {
            try { fs.unlinkSync(blobPath); } catch (_) { /* ignore */ }
        }
        this.broadcastVfsUpdated(wsServer, null);
        this.handlers.sendToClient(ws, {
            type: 'vfs_delete_file_response',
            requestId: message.requestId,
            data: { success: true },
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
            await vfsDb.deleteUserFile(fileId);
            const blobPath = this.getVfs().getFileBlobPath(file.content_hash);
            if (fs.existsSync(blobPath)) {
                try { fs.unlinkSync(blobPath); } catch (_) { /* ignore */ }
            }
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

module.exports = VfsWebSocketHandlers;
