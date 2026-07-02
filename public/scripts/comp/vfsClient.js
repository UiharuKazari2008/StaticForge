// VFS client helpers — public/scripts/comp/vfsClient.js

const vfsClient = {
    _vfsPathUuid: null,

    ensureVfsPathUuid() {
        if (this._vfsPathUuid) return this._vfsPathUuid;
        const stored = localStorage.getItem('vfsPathUuid');
        if (stored) {
            this._vfsPathUuid = stored;
            return stored;
        }
        return null;
    },

    setVfsPathUuid(uuid) {
        if (uuid) {
            this._vfsPathUuid = uuid;
            localStorage.setItem('vfsPathUuid', uuid);
        }
    },

    getBasePath() {
        const uuid = this.ensureVfsPathUuid();
        return uuid ? `/${uuid}` : null;
    },

    async listDirectory(path, options = {}) {
        return wsClient.sendMessage('vfs_list_directory', { path, ...options });
    },

    async getPathStats(path) {
        return wsClient.sendMessage('vfs_get_path_stats', { path });
    },

    async resolvePath(path) {
        const resp = await wsClient.sendMessage('vfs_resolve_path', { path });
        return resp?.path || path;
    },

    async folderTreeHasUserFiles(folderIds) {
        return wsClient.sendMessage('vfs_folder_has_user_files', { folderIds });
    },

    async createFolder(path, name) {
        return wsClient.sendMessage('vfs_create_folder', { path, name });
    },

    async renameFolder(folderId, name) {
        return wsClient.sendMessage('vfs_rename_folder', { folderId, name });
    },

    async renameFile(fileId, name) {
        return wsClient.sendMessage('vfs_rename_file', { fileId, name });
    },

    async deleteFolder(folderId) {
        return wsClient.sendMessage('vfs_delete_folder', { folderId });
    },

    async moveItems(items, targetPath) {
        return wsClient.sendMessage('vfs_move_items', { items, targetPath });
    },

    async copyItems(items, targetPath, options = {}) {
        return wsClient.sendMessage('vfs_copy_items', { items, targetPath, ...options });
    },

    async deleteEntry(entryId) {
        return wsClient.sendMessage('vfs_delete_entry', { entryId });
    },

    async moveToTrash(items, sourcePath) {
        return wsClient.sendMessage('vfs_move_to_trash', { items, sourcePath });
    },

    async restoreFromTrash(trashItemId) {
        return wsClient.sendMessage('vfs_restore_from_trash', { trashItemId });
    },

    async emptyTrash(workspaceId) {
        return wsClient.sendMessage('vfs_empty_trash', { workspaceId });
    },

    async permanentlyDelete(items, sourcePath) {
        return wsClient.sendMessage('vfs_permanently_delete', { items, sourcePath });
    },

    async renameShortcutEntry(entryId, name) {
        return wsClient.sendMessage('vfs_rename_shortcut_entry', { entryId, name });
    },

    async renameEntry(entryId, name) {
        return wsClient.sendMessage('vfs_rename_entry', { entryId, name });
    },

    async uploadFile(path, fileData, originalFilename, mimeType) {
        return wsClient.sendMessage('vfs_upload_file', { path, fileData, originalFilename, mimeType });
    },

    async replaceFile(fileId, fileData, mimeType) {
        return wsClient.sendMessage('vfs_replace_file', { fileId, fileData, mimeType });
    },

    async downloadFile(fileId) {
        return wsClient.sendMessage('vfs_download_file', { fileId });
    },

    async downloadSystemFile(systemFileKey) {
        return wsClient.sendMessage('vfs_download_system_file', { systemFileKey });
    },

    async readSystemFile(systemFileKey) {
        return wsClient.sendMessage('vfs_read_system_file', { systemFileKey });
    },

    async convertReferenceToFile(hash, workspaceId, mode) {
        return wsClient.sendMessage('vfs_convert_reference_to_file', { hash, workspaceId, mode });
    },

    async convertFileToReference(fileId, workspaceId, mode) {
        return wsClient.sendMessage('vfs_convert_file_to_reference', { fileId, workspaceId, mode });
    },

    async createDesktopEmptyFolder(workspaceId, position, name) {
        return wsClient.sendMessage('desktop_create_empty_folder', { workspaceId, position, name });
    },

    async updateShortcutFolders(workspaceId, updates) {
        return wsClient.sendMessage('desktop_update_shortcut_folders', { workspaceId, updates });
    },

    async createFolderFromSelection(workspaceId, shortcutIds, position) {
        return wsClient.sendMessage('desktop_create_folder_from_selection', { workspaceId, shortcutIds, position });
    }
};

function bootstrapVfsPathUuidFromOptions(data) {
    if (data && data.vfsPathUuid) {
        vfsClient.setVfsPathUuid(data.vfsPathUuid);
    }
}
